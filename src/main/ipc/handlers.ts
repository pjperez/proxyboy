import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { ProxyEngine } from '../proxy/engine';
import { CertificateManager } from '../proxy/certificate';
import { AgentClient } from '../agent/client';
import { ProxyState, Rule, HttpFlow } from '../../shared/types';
import { randomUUID } from 'crypto';

export function registerIpcHandlers(
  mainWindow: BrowserWindow,
  proxyEngine: ProxyEngine,
  certManager: CertificateManager,
): void {
  const agentClient = new AgentClient(proxyEngine, mainWindow);
  // Proxy control
  ipcMain.handle(IPC_CHANNELS.PROXY_START, async (_event, port?: number) => {
    try {
      await proxyEngine.start();
      return { success: true, port: proxyEngine.getPort() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROXY_STOP, async () => {
    await proxyEngine.stop();
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.PROXY_INSTALL_CERT, async () => {
    return certManager.installCaCertWindows();
  });

  ipcMain.handle(IPC_CHANNELS.PROXY_CERT_STATUS, async () => {
    return {
      exists: certManager.hasCaCert(),
      installed: await certManager.isCaCertInstalled(),
    };
  });

  ipcMain.handle(IPC_CHANNELS.PROXY_STATUS, (): ProxyState => {
    return {
      running: proxyEngine.isRunning(),
      port: proxyEngine.getPort(),
      host: '127.0.0.1',
      isSystemProxy: false,
      totalRequests: proxyEngine.getFlows().length,
      activeConnections: 0,
      sslEnabled: true,
    };
  });

  // Traffic
  ipcMain.handle(IPC_CHANNELS.TRAFFIC_GET_FLOWS, (_event) => {
    return proxyEngine.getFlows().map(sanitizeFlow);
  });

  ipcMain.handle(IPC_CHANNELS.TRAFFIC_GET_FLOW, (_event, id: string) => {
    const flow = proxyEngine.getFlow(id);
    return flow ? sanitizeFlow(flow) : null;
  });

  ipcMain.handle(IPC_CHANNELS.TRAFFIC_CLEAR, () => {
    proxyEngine.clearFlows();
    return { success: true };
  });

  // Rules
  const rules: Map<string, Rule> = new Map();

  ipcMain.handle(IPC_CHANNELS.RULES_GET_ALL, () => {
    return Array.from(rules.values());
  });

  ipcMain.handle(IPC_CHANNELS.RULES_CREATE, (_event, ruleData: any) => {
    const rule: Rule = {
      ...ruleData,
      id: randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    rules.set(rule.id, rule);
    proxyEngine.getInterceptor().setRules(Array.from(rules.values()));
    return rule;
  });

  ipcMain.handle(IPC_CHANNELS.RULES_UPDATE, (_event, ruleData: Rule) => {
    ruleData.updatedAt = Date.now();
    rules.set(ruleData.id, ruleData);
    proxyEngine.getInterceptor().setRules(Array.from(rules.values()));
    return ruleData;
  });

  ipcMain.handle(IPC_CHANNELS.RULES_DELETE, (_event, id: string) => {
    rules.delete(id);
    proxyEngine.getInterceptor().setRules(Array.from(rules.values()));
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.RULES_TOGGLE, (_event, id: string) => {
    const rule = rules.get(id);
    if (rule) {
      rule.enabled = !rule.enabled;
      rule.updatedAt = Date.now();
      rules.set(id, rule);
      proxyEngine.getInterceptor().setRules(Array.from(rules.values()));
      return rule;
    }
    return null;
  });

  // Breakpoint
  ipcMain.handle(IPC_CHANNELS.BREAKPOINT_RESUME, (_event, data: any) => {
    proxyEngine.getInterceptor().resumeFlow(data.flowId, data.action);
    return { success: true };
  });

  // Agent
  ipcMain.handle(IPC_CHANNELS.AGENT_SEND_MESSAGE, async (_event, data: { message: string; conversationId?: string }) => {
    try {
      const content = await agentClient.sendMessage(data.message);
      return { success: true, content };
    } catch (error: any) {
      console.error('Agent error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_STATUS, () => {
    return { initialized: agentClient.isInitialized() };
  });

  // App
  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => {
    return { version: '1.0.0', name: 'ProxyBoy' };
  });

  // Forward proxy events to renderer
  proxyEngine.on('flow:start', (flow: HttpFlow) => {
    mainWindow.webContents.send(IPC_CHANNELS.TRAFFIC_NEW_FLOW, sanitizeFlow(flow));
  });

  proxyEngine.on('flow:complete', (flow: HttpFlow) => {
    mainWindow.webContents.send(IPC_CHANNELS.TRAFFIC_FLOW_COMPLETE, sanitizeFlow(flow));
  });
}

function sanitizeFlow(flow: HttpFlow): any {
  return {
    ...flow,
    request: {
      ...flow.request,
      body: flow.request.body
        ? (typeof flow.request.body === 'string' ? flow.request.body : flow.request.body.toString('utf8').slice(0, 10000))
        : undefined,
    },
    response: flow.response
      ? {
          ...flow.response,
          body: flow.response.body
            ? (typeof flow.response.body === 'string' ? flow.response.body : flow.response.body.toString('utf8').slice(0, 10000))
            : undefined,
        }
      : undefined,
  };
}
