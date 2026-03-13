// Dynamic import for ESM-only @github/copilot-sdk (Electron main is CJS)
async function loadSdk() {
  const sdk = await (Function('return import("@github/copilot-sdk")')() as Promise<typeof import('@github/copilot-sdk')>);
  return sdk;
}

import { BrowserWindow } from 'electron';
import { ProxyEngine } from '../proxy/engine';
import { SYSTEM_PROMPT, buildContextPrompt } from './prompts';
import { IPC_CHANNELS } from '../../shared/constants';
import { HttpFlow } from '../../shared/types';
import { randomUUID } from 'crypto';

export class AgentClient {
  private client: any = null;
  private session: any = null;
  private proxyEngine: ProxyEngine;
  private mainWindow: BrowserWindow;
  private initialized = false;
  private sdk: any = null;

  constructor(proxyEngine: ProxyEngine, mainWindow: BrowserWindow) {
    this.proxyEngine = proxyEngine;
    this.mainWindow = mainWindow;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.sdk = await loadSdk();
      // In Electron, process.execPath is the Electron binary, not Node.
      // ELECTRON_RUN_AS_NODE=1 makes the spawned electron act as Node.
      // We also strip Copilot env vars that leak from the parent Copilot CLI
      // process to avoid confusing the child CLI instance.
      const cleanEnv: Record<string, string | undefined> = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
      delete cleanEnv.COPILOT_CLI;
      delete cleanEnv.COPILOT_RUN_APP;
      delete cleanEnv.COPILOT_LOADER_PID;
      delete cleanEnv.COPILOT_CLI_BINARY_VERSION;

      this.client = new this.sdk.CopilotClient({
        env: cleanEnv,
      });
      await this.client.start();
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize Copilot agent:', error);
      throw error;
    }
  }

  private buildTools() {
    const engine = this.proxyEngine;
    const { defineTool } = this.sdk;

    const summarizeFlow = (flow: HttpFlow) => ({
      id: flow.id,
      method: flow.request.method,
      url: flow.request.url,
      status: flow.response?.statusCode || null,
      duration: flow.response?.duration || null,
      bodySize: flow.response?.bodySize || 0,
      contentType: flow.response?.headers['content-type'] || null,
      state: flow.state,
      tags: flow.tags,
      timestamp: flow.createdAt,
    });

    return [
      defineTool('getRecentTraffic', {
        description: 'Get the most recent captured HTTP flows',
        parameters: { type: 'object', properties: { count: { type: 'number', description: 'Number of flows to return (default 20)' } } },
        handler: async (args: any) => {
          const flows = engine.getFlows();
          const count = args?.count || 20;
          return { count: Math.min(count, flows.length), total: flows.length, flows: flows.slice(-count).map(summarizeFlow) };
        },
      }),
      defineTool('searchTraffic', {
        description: 'Search captured traffic by query, method, status code, or min duration',
        parameters: { type: 'object', properties: { query: { type: 'string' }, method: { type: 'string' }, statusCode: { type: 'number' }, minDuration: { type: 'number' } } },
        handler: async (args: any) => {
          let flows = engine.getFlows();
          if (args?.query) { const q = args.query.toLowerCase(); flows = flows.filter((f: HttpFlow) => f.request.url.toLowerCase().includes(q)); }
          if (args?.method) { flows = flows.filter((f: HttpFlow) => f.request.method === args.method.toUpperCase()); }
          if (args?.statusCode) { flows = flows.filter((f: HttpFlow) => f.response?.statusCode === args.statusCode); }
          if (args?.minDuration) { flows = flows.filter((f: HttpFlow) => f.response && f.response.duration >= args.minDuration); }
          return { count: flows.length, flows: flows.slice(0, 50).map(summarizeFlow) };
        },
      }),
      defineTool('analyzeFlow', {
        description: 'Get full details of a specific flow including headers and body',
        parameters: { type: 'object', properties: { flowId: { type: 'string' } }, required: ['flowId'] },
        handler: async (args: any) => {
          const flow = engine.getFlow(args.flowId);
          if (!flow) return { error: 'Flow not found' };
          return {
            id: flow.id, request: { method: flow.request.method, url: flow.request.url, headers: flow.request.headers, bodySize: flow.request.bodySize, body: flow.request.body ? String(flow.request.body).slice(0, 5000) : null },
            response: flow.response ? { statusCode: flow.response.statusCode, statusMessage: flow.response.statusMessage, headers: flow.response.headers, bodySize: flow.response.bodySize, body: flow.response.body ? String(flow.response.body).slice(0, 5000) : null, duration: flow.response.duration } : null,
            state: flow.state, tags: flow.tags,
          };
        },
      }),
      defineTool('getErrorFlows', {
        description: 'Get all captured flows with 4xx or 5xx status codes',
        parameters: { type: 'object', properties: {} },
        handler: async () => {
          const flows = engine.getFlows().filter((f: HttpFlow) => f.response && f.response.statusCode >= 400);
          return { count: flows.length, flows: flows.slice(0, 50).map(summarizeFlow) };
        },
      }),
      defineTool('createBreakpointRule', {
        description: 'Create a breakpoint rule to pause matching traffic',
        parameters: { type: 'object', properties: { name: { type: 'string' }, urlPattern: { type: 'string' }, breakOn: { type: 'string', enum: ['request', 'response', 'both'] } }, required: ['name', 'urlPattern'] },
        handler: async (args: any) => {
          const rule = { id: randomUUID(), type: 'breakpoint' as const, name: args.name, enabled: true, matchCriteria: { urlPattern: args.urlPattern }, breakOn: args.breakOn || 'both', createdAt: Date.now(), updatedAt: Date.now() };
          engine.getInterceptor().setRules([rule]);
          return { success: true, rule };
        },
      }),
      defineTool('createMapLocalRule', {
        description: 'Create a rule to serve a local file instead of forwarding the request',
        parameters: { type: 'object', properties: { name: { type: 'string' }, urlPattern: { type: 'string' }, localFilePath: { type: 'string' }, statusCode: { type: 'number' } }, required: ['name', 'urlPattern', 'localFilePath'] },
        handler: async (args: any) => {
          const rule = { id: randomUUID(), type: 'map-local' as const, name: args.name, enabled: true, matchCriteria: { urlPattern: args.urlPattern }, localFilePath: args.localFilePath, statusCode: args.statusCode || 200, createdAt: Date.now(), updatedAt: Date.now() };
          engine.getInterceptor().setRules([rule]);
          return { success: true, rule };
        },
      }),
      defineTool('getProxyStatus', {
        description: 'Get current proxy status including running state and flow counts',
        parameters: { type: 'object', properties: {} },
        handler: async () => ({ running: engine.isRunning(), totalFlows: engine.getFlows().length, errorFlows: engine.getFlows().filter((f: HttpFlow) => f.response && f.response.statusCode >= 400).length }),
      }),
      defineTool('toggleProxy', {
        description: 'Start or stop the proxy',
        parameters: { type: 'object', properties: { action: { type: 'string', enum: ['start', 'stop'] } }, required: ['action'] },
        handler: async (args: any) => {
          if (args.action === 'start') { await engine.start(); return { success: true, running: true }; }
          else { await engine.stop(); return { success: true, running: false }; }
        },
      }),
    ];
  }

  async sendMessage(message: string): Promise<string> {
    if (!this.client || !this.initialized) {
      await this.initialize();
    }

    const contextPrompt = buildContextPrompt({
      running: this.proxyEngine.isRunning(),
      totalRequests: this.proxyEngine.getFlows().length,
      port: this.proxyEngine.getPort(),
    });

    if (!this.session) {
      this.session = await this.client!.createSession({
        systemMessage: {
          content: SYSTEM_PROMPT + contextPrompt,
        },
        tools: this.buildTools(),
        onPermissionRequest: this.sdk.approveAll,
      });

      // Stream events to renderer
      this.session.on((event: any) => {
        if (event.type === 'assistant.message_delta') {
          this.mainWindow.webContents.send(IPC_CHANNELS.AGENT_MESSAGE_DELTA, {
            content: event.data.deltaContent,
          });
        }
      });
    }

    const response = await this.session.sendAndWait({ prompt: message });
    const content = response?.data?.content || 'No response from agent.';

    this.mainWindow.webContents.send(IPC_CHANNELS.AGENT_MESSAGE_COMPLETE, {
      content,
    });

    return content;
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.stop();
      this.client = null;
      this.session = null;
      this.initialized = false;
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
