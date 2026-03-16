import { ipcMain, BrowserWindow, dialog } from 'electron';
import * as path from 'path';
import { IPC_CHANNELS } from '../../shared/constants';
import { ProxyEngine } from '../proxy/engine';
import { CertificateManager } from '../proxy/certificate';
import { AgentClient } from '../agent/client';
import { setSystemProxy, clearSystemProxy, isSystemProxyEnabled } from '../utils/windows-proxy';
import { ProxyState, Rule, HttpFlow } from '../../shared/types';
import { flowsToHar } from '../utils/har';
import { randomUUID } from 'crypto';
import { saveFlow, clearAllFlows, saveRule, getRules, getFlows as getStoredFlows, deleteRule as dbDeleteRule } from '../storage/queries';
import * as fs from 'fs';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

export function registerIpcHandlers(
  mainWindow: BrowserWindow,
  proxyEngine: ProxyEngine,
  certManager: CertificateManager,
): void {
  let agentWindow: BrowserWindow | null = null;

  // Broadcast to all windows that care about agent events
  const broadcastAgent = (channel: string, data: any) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
    if (agentWindow && !agentWindow.isDestroyed()) {
      agentWindow.webContents.send(channel, data);
    }
  };

  const agentClient = new AgentClient(proxyEngine, broadcastAgent);

  // Proxy control
  ipcMain.handle(IPC_CHANNELS.PROXY_START, async (_event, port?: number) => {
    try {
      if (port) {
        proxyEngine.setPort(port);
      }
      await proxyEngine.start();
      return { success: true, port: proxyEngine.getPort() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROXY_STOP, async () => {
    try {
      await proxyEngine.stop();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROXY_INSTALL_CERT, async () => {
    try {
      return certManager.installCaCertWindows();
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROXY_CERT_STATUS, async () => {
    try {
      return {
        exists: certManager.hasCaCert(),
        installed: await certManager.isCaCertInstalled(),
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROXY_SET_SYSTEM, async (_event, enabled: boolean) => {
    try {
      if (enabled) {
        const port = proxyEngine.getPort();
        await setSystemProxy('127.0.0.1', port);
      } else {
        await clearSystemProxy();
      }
      return { success: true, enabled };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROXY_STATUS, async (): Promise<ProxyState> => {
    return {
      running: proxyEngine.isRunning(),
      port: proxyEngine.getPort(),
      host: '127.0.0.1',
      isSystemProxy: await isSystemProxyEnabled(),
      totalRequests: proxyEngine.getFlowCount(),
      activeConnections: 0,
      sslEnabled: true,
    };
  });

  // Traffic
  ipcMain.handle(IPC_CHANNELS.TRAFFIC_GET_FLOWS, (_event) => {
    try {
      return proxyEngine.getFlows().map(sanitizeFlow);
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.TRAFFIC_GET_FLOW, (_event, id: string) => {
    try {
      const flow = proxyEngine.getFlow(id);
      return flow ? sanitizeFlow(flow) : null;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.TRAFFIC_CLEAR, () => {
    try {
      proxyEngine.clearFlows();
      clearAllFlows();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Rules
  const rules: Map<string, Rule> = new Map();

  // Load persisted rules from DB
  try {
    const savedRules = getRules();
    for (const rule of savedRules) {
      rules.set(rule.id, rule);
    }
    if (rules.size > 0) {
      proxyEngine.getInterceptor().setRules(Array.from(rules.values()));
    }
  } catch (err) {
    console.error('Failed to load rules from database:', err);
  }

  try {
    const persistedFlows = getStoredFlows().reverse();
    for (const flow of persistedFlows) {
      proxyEngine.addFlow(flow);
    }
  } catch (err) {
    console.error('Failed to load persisted flows from database:', err);
  }

  agentClient.setRuleManager({
    createRule(rule: Rule) {
      rules.set(rule.id, rule);
      proxyEngine.getInterceptor().setRules(Array.from(rules.values()));
      saveRule(rule);
      mainWindow.webContents.send(IPC_CHANNELS.RULES_CREATED, rule);
    },
  });

  ipcMain.handle(IPC_CHANNELS.RULES_GET_ALL, () => {
    try {
      return Array.from(rules.values());
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.RULES_CREATE, (_event, ruleData: any) => {
    try {
      const rule: Rule = {
        ...ruleData,
        id: randomUUID(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      rules.set(rule.id, rule);
      proxyEngine.getInterceptor().setRules(Array.from(rules.values()));
      saveRule(rule);
      return rule;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.RULES_UPDATE, (_event, ruleData: Rule) => {
    try {
      ruleData.updatedAt = Date.now();
      rules.set(ruleData.id, ruleData);
      proxyEngine.getInterceptor().setRules(Array.from(rules.values()));
      saveRule(ruleData);
      return ruleData;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.RULES_DELETE, (_event, id: string) => {
    try {
      rules.delete(id);
      proxyEngine.getInterceptor().setRules(Array.from(rules.values()));
      dbDeleteRule(id);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.RULES_TOGGLE, (_event, id: string) => {
    try {
      const rule = rules.get(id);
      if (rule) {
        rule.enabled = !rule.enabled;
        rule.updatedAt = Date.now();
        rules.set(id, rule);
        proxyEngine.getInterceptor().setRules(Array.from(rules.values()));
        saveRule(rule);
        return rule;
      }
      return null;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Breakpoint
  ipcMain.handle(IPC_CHANNELS.BREAKPOINT_RESUME, (_event, data: any) => {
    try {
      proxyEngine.getInterceptor().resumeFlow(data.flowId, data.action);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Debug: inspect interceptor state
  ipcMain.handle('debug:interceptor-state', () => {
    try {
      return {
        breakpointRules: proxyEngine.getInterceptor().getBreakpointRulesDebug(),
        ruleCount: proxyEngine.getInterceptor().getBreakpointRuleCount(),
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // DNS configuration
  ipcMain.handle(IPC_CHANNELS.DNS_GET_CONFIG, () => {
    try {
      const resolver = proxyEngine.getDnsResolver();
      return { mode: resolver.getMode(), servers: resolver.getServers() };
    } catch (error: any) {
      return { mode: 'system', servers: [] };
    }
  });

  ipcMain.handle(IPC_CHANNELS.DNS_SET_SERVERS, (_event, servers: string[]) => {
    try {
      proxyEngine.getDnsResolver().setServers(servers);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.DNS_CLEAR_CACHE, () => {
    try {
      proxyEngine.getDnsResolver().clearCache();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
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
    try {
      return { initialized: agentClient.isInitialized() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_PERMISSION_RESPONSE, (_event, data: { id: string; approved: boolean }) => {
    try {
      agentClient.respondToPermission(data.id, data.approved);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_SET_AUTO_APPROVE, (_event, autoApprove: boolean) => {
    try {
      agentClient.setAutoApprove(autoApprove);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_OPEN_WINDOW, async () => {
    try {
      if (agentWindow && !agentWindow.isDestroyed()) {
        agentWindow.focus();
        return { success: true };
      }

      agentWindow = new BrowserWindow({
        width: 520,
        height: 720,
        minWidth: 380,
        minHeight: 400,
        title: 'ProxyBoy AI',
        titleBarStyle: 'hidden',
        titleBarOverlay: {
          color: '#1a1b26',
          symbolColor: '#c0caf5',
          height: 36,
        },
        backgroundColor: '#1a1b26',
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          sandbox: true,
        },
      });

      try {
        if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
          await agentWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL + '?view=agent');
        } else {
          await agentWindow.loadFile(
            path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
            { query: { view: 'agent' } },
          );
        }
      } catch (loadError: any) {
        console.error('Failed to load agent window URL:', loadError);
        if (agentWindow && !agentWindow.isDestroyed()) {
          agentWindow.destroy();
        }
        agentWindow = null;
        return { success: false, error: loadError.message };
      }

      // Harden agent window
      agentWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      agentWindow.webContents.on('will-navigate', (event, url) => {
        if (MAIN_WINDOW_VITE_DEV_SERVER_URL && url.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL)) return;
        event.preventDefault();
      });

      agentWindow.on('closed', () => {
        agentWindow = null;
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.AGENT_WINDOW_CLOSED);
        }
      });

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_CLOSE_WINDOW, () => {
    try {
      if (agentWindow && !agentWindow.isDestroyed()) {
        agentWindow.close();
        agentWindow = null;
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // App
  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => {
    try {
      return { version: '1.0.0', name: 'ProxyBoy' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.APP_PICK_FILE, async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Select File',
        properties: ['openFile'],
      });
      if (canceled || !filePaths.length) return { success: false, canceled: true };
      return { success: true, path: filePaths[0] };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // HAR Export
  ipcMain.handle(IPC_CHANNELS.APP_EXPORT_HAR, async (_event, flowIds?: string[]) => {
    try {
      const flows = proxyEngine.getFlows();
      const toExport = flowIds
        ? flows.filter(f => flowIds.includes(f.id))
        : flows;

      const har = flowsToHar(toExport);

      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Export HAR',
        defaultPath: `proxyboy-${new Date().toISOString().slice(0, 10)}.har`,
        filters: [{ name: 'HAR Files', extensions: ['har'] }],
      });

      if (canceled || !filePath) return { success: false, canceled: true };

      fs.writeFileSync(filePath, har, 'utf8');
      return { success: true, path: filePath, count: toExport.length };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // HAR Import
  ipcMain.handle(IPC_CHANNELS.APP_IMPORT_HAR, async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Import HAR',
        filters: [{ name: 'HAR Files', extensions: ['har'] }],
        properties: ['openFile'],
      });

      if (canceled || !filePaths.length) return { success: false, canceled: true };

      // File size check
      const stats = fs.statSync(filePaths[0]);
      if (stats.size > 100 * 1024 * 1024) {
        return { success: false, error: 'HAR file is too large (max 100 MB).' };
      }

      let har: any;
      try {
        const content = fs.readFileSync(filePaths[0], 'utf8');
        har = JSON.parse(content);
      } catch {
        return { success: false, error: 'Invalid HAR file: could not parse JSON.' };
      }

      if (!har?.log?.entries || !Array.isArray(har.log.entries)) {
        return { success: false, error: 'Invalid HAR file: missing or malformed log.entries.' };
      }

      const entries: any[] = har.log.entries;

      const importedFlows: any[] = entries.map((entry: any, i: number) => {
        const id = `har-import-${Date.now()}-${i}`;
        const reqUrl = entry.request?.url || '';
        let parsedUrl: URL;
        try { parsedUrl = new URL(reqUrl); } catch { parsedUrl = new URL('http://unknown'); }

        const reqHeaders: Record<string, string> = {};
        (entry.request?.headers || []).forEach((h: any) => { reqHeaders[h.name.toLowerCase()] = h.value; });

        const resHeaders: Record<string, string> = {};
        (entry.response?.headers || []).forEach((h: any) => { resHeaders[h.name.toLowerCase()] = h.value; });

        const timestamp = new Date(entry.startedDateTime || Date.now()).getTime();

        return {
          id,
          request: {
            id: `${id}-req`,
            method: entry.request?.method || 'GET',
            url: reqUrl,
            protocol: parsedUrl.protocol === 'https:' ? 'https' : 'http',
            host: parsedUrl.host || '',
            path: parsedUrl.pathname + parsedUrl.search,
            headers: reqHeaders,
            body: entry.request?.postData?.text || undefined,
            bodySize: entry.request?.bodySize || 0,
            timestamp,
          },
          response: entry.response ? {
            id: `${id}-res`,
            requestId: `${id}-req`,
            statusCode: entry.response.status || 0,
            statusMessage: entry.response.statusText || '',
            headers: resHeaders,
            body: entry.response.content?.text || undefined,
            bodySize: entry.response.content?.size || entry.response.bodySize || 0,
            timestamp: timestamp + (entry.time || 0),
            duration: entry.time || 0,
          } : undefined,
          state: 'complete' as const,
          tags: ['har-import'],
          createdAt: timestamp,
        };
      });

      for (const flow of importedFlows) {
        proxyEngine.addFlow(flow);
        mainWindow.webContents.send(IPC_CHANNELS.TRAFFIC_NEW_FLOW, sanitizeFlow(flow));
        mainWindow.webContents.send(IPC_CHANNELS.TRAFFIC_FLOW_COMPLETE, sanitizeFlow(flow));
      }

      return { success: true, count: importedFlows.length, path: filePaths[0] };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Forward proxy events to renderer
  proxyEngine.on('flow:start', (flow: HttpFlow) => {
    mainWindow.webContents.send(IPC_CHANNELS.TRAFFIC_NEW_FLOW, sanitizeFlow(flow));
  });

  proxyEngine.on('flow:complete', (flow: HttpFlow) => {
    mainWindow.webContents.send(IPC_CHANNELS.TRAFFIC_FLOW_COMPLETE, sanitizeFlow(flow));
    saveFlow(flow);
  });

  // Forward breakpoint events to renderer
  proxyEngine.on('breakpoint:paused', (data: any) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.BREAKPOINT_PAUSED, data);
    }
  });
}

function sanitizeFlow(flow: HttpFlow): any {
  const responseContentType = flow.response?.headers?.['content-type']
    ? String(flow.response.headers['content-type']).toLowerCase()
    : '';
  const isImageResponse = responseContentType.startsWith('image/');

  // Detect if a Buffer contains binary (non-UTF8-safe) data
  const isBinaryBuffer = (buf: Buffer): boolean => {
    const sample = buf.subarray(0, Math.min(512, buf.length));
    let nonPrintable = 0;
    for (let i = 0; i < sample.length; i++) {
      const b = sample[i];
      if (b === 0 || (b < 32 && b !== 9 && b !== 10 && b !== 13)) nonPrintable++;
    }
    return nonPrintable > sample.length * 0.1;
  };

  const serializeBody = (body: Buffer | string | undefined, forceBase64: boolean): { text: string | undefined; isBase64: boolean } => {
    if (!body) return { text: undefined, isBase64: false };
    if (typeof body === 'string') return { text: body, isBase64: false };
    if (forceBase64 || isBinaryBuffer(body)) {
      return { text: body.toString('base64'), isBase64: true };
    }
    return { text: body.toString('utf8').slice(0, 100000), isBase64: false };
  };

  const reqBody = serializeBody(flow.request.body as Buffer | string | undefined, false);
  const resBody = serializeBody(
    flow.response?.body as Buffer | string | undefined,
    isImageResponse,
  );

  return {
    ...flow,
    request: {
      ...flow.request,
      body: reqBody.text,
      _isBase64: reqBody.isBase64 || undefined,
    },
    response: flow.response
      ? {
          ...flow.response,
          body: resBody.text,
          _isBase64: resBody.isBase64 || undefined,
        }
      : undefined,
  };
}
