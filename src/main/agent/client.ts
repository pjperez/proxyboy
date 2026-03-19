// Dynamic import for ESM-only @github/copilot-sdk (Electron main is CJS)
async function loadSdk() {
  const sdk = await (Function('return import("@github/copilot-sdk")')() as Promise<typeof import('@github/copilot-sdk')>);
  return sdk;
}

import { ProxyEngine } from '../proxy/engine';
import { SYSTEM_PROMPT, buildContextPrompt } from './prompts';
import { IPC_CHANNELS } from '../../shared/constants';
import { HttpFlow, Rule, BreakpointRule, MapLocalRule } from '../../shared/types';
import { randomUUID } from 'crypto';

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
]);

function redactHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    safe[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? '[REDACTED]' : value;
  }
  return safe;
}

function previewBody(body?: Buffer | string): string | null {
  if (!body) return null;
  if (Buffer.isBuffer(body)) {
    const sample = body.subarray(0, Math.min(512, body.length));
    let nonPrintable = 0;
    for (let i = 0; i < sample.length; i++) {
      const b = sample[i];
      if (b === 0 || (b < 32 && b !== 9 && b !== 10 && b !== 13)) nonPrintable++;
    }
    if (nonPrintable > sample.length * 0.1) {
      return `[binary data ${body.length} bytes]`;
    }
    return body.toString('utf8').slice(0, 5000);
  }
  return body.slice(0, 5000);
}

export interface SearchTrafficArgs {
  query?: string;
  method?: string;
  statusCode?: number;
  minDuration?: number;
  graphqlOperationName?: string;
}

export function matchesSearchTraffic(flow: HttpFlow, args: SearchTrafficArgs): boolean {
  if (args.query) {
    const query = args.query.toLowerCase();
    if (!flow.request.url.toLowerCase().includes(query)) {
      return false;
    }
  }

  if (args.method && flow.request.method !== args.method.toUpperCase()) {
    return false;
  }

  if (args.statusCode && flow.response?.statusCode !== args.statusCode) {
    return false;
  }

  if (args.minDuration && (!flow.response || flow.response.duration < args.minDuration)) {
    return false;
  }

  if (args.graphqlOperationName) {
    const graphqlOperationName = flow.request.graphqlOperationName?.toLowerCase() || '';
    if (!graphqlOperationName.includes(args.graphqlOperationName.toLowerCase())) {
      return false;
    }
  }

  return true;
}

export interface RuleManager {
  createRule(rule: Rule): void;
}

export class AgentClient {
  private client: any = null;
  private session: any = null;
  private proxyEngine: ProxyEngine;
  private broadcast: (channel: string, data: any) => void;
  private ruleManager: RuleManager | null = null;
  private initialized = false;
  private sdk: any = null;
  private autoApprove = false;
  private pendingPermissions = new Map<string, { resolve: (value: { kind: string }) => void }>();
  private sessionPromise: Promise<void> | null = null;
  private sessionEventUnsubscribe: (() => void) | null = null;

  constructor(proxyEngine: ProxyEngine, broadcast: (channel: string, data: any) => void) {
    this.proxyEngine = proxyEngine;
    this.broadcast = broadcast;
  }

  setAutoApprove(value: boolean): void {
    this.autoApprove = value;
  }

  respondToPermission(id: string, approved: boolean): void {
    const pending = this.pendingPermissions.get(id);
    if (pending) {
      pending.resolve({ kind: approved ? 'approved' : 'denied' });
      this.pendingPermissions.delete(id);
    }
  }

  setRuleManager(ruleManager: RuleManager): void {
    this.ruleManager = ruleManager;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.sdk = await loadSdk();
      // Use the native copilot binary instead of the JS entry point.
      // The SDK's default uses process.execPath (electron.exe) to run
      // the JS CLI, which fails because Electron's argv handling differs
      // from Node's. The native binary avoids this entirely.
      const { join } = await import('path');
      const { existsSync } = await import('fs');

      // Try multiple possible locations for the native binary
      const candidates = [
        join(__dirname, '..', '..', 'node_modules', '@github', 'copilot-win32-x64', 'copilot.exe'),
        join(process.cwd(), 'node_modules', '@github', 'copilot-win32-x64', 'copilot.exe'),
      ];
      const cliPath = candidates.find(p => existsSync(p));

      if (!cliPath) {
        throw new Error('Copilot CLI native binary not found');
      }

      this.client = new this.sdk.CopilotClient({ cliPath });
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
      graphqlOperationName: flow.request.graphqlOperationName || null,
      graphqlOperationType: flow.request.graphqlOperationType || null,
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
        description: 'Search captured traffic by query, method, status code, min duration, or GraphQL operation name',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            method: { type: 'string' },
            statusCode: { type: 'number' },
            minDuration: { type: 'number' },
            graphqlOperationName: { type: 'string' },
          },
        },
        handler: async (args: any) => {
          const filters = (args || {}) as SearchTrafficArgs;
          let flows = engine.getFlows();
          flows = flows.filter((flow: HttpFlow) => matchesSearchTraffic(flow, filters));
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
            id: flow.id,
            request: {
              method: flow.request.method,
              url: flow.request.url,
              headers: redactHeaders(flow.request.headers),
              bodySize: flow.request.bodySize,
              body: previewBody(flow.request.body),
            },
            response: flow.response ? {
              statusCode: flow.response.statusCode,
              statusMessage: flow.response.statusMessage,
              headers: redactHeaders(flow.response.headers),
              bodySize: flow.response.bodySize,
              body: previewBody(flow.response.body),
              duration: flow.response.duration,
            } : null,
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
          const rule: BreakpointRule = { id: randomUUID(), type: 'breakpoint' as const, name: args.name, enabled: true, matchCriteria: { urlPattern: args.urlPattern }, breakOn: args.breakOn || 'both', createdAt: Date.now(), updatedAt: Date.now() };
          if (this.ruleManager) {
            this.ruleManager.createRule(rule);
          } else {
            engine.getInterceptor().setRules([rule]);
          }
          return { success: true, rule };
        },
      }),
      defineTool('createMapLocalRule', {
        description: 'Create a rule to serve a local file instead of forwarding the request',
        parameters: { type: 'object', properties: { name: { type: 'string' }, urlPattern: { type: 'string' }, localFilePath: { type: 'string' }, statusCode: { type: 'number' } }, required: ['name', 'urlPattern', 'localFilePath'] },
        handler: async (args: any) => {
          const rule: MapLocalRule = { id: randomUUID(), type: 'map-local' as const, name: args.name, enabled: true, matchCriteria: { urlPattern: args.urlPattern }, localFilePath: args.localFilePath, statusCode: args.statusCode || 200, createdAt: Date.now(), updatedAt: Date.now() };
          if (this.ruleManager) {
            this.ruleManager.createRule(rule);
          } else {
            engine.getInterceptor().setRules([rule]);
          }
          return { success: true, rule };
        },
      }),
      defineTool('getProxyStatus', {
        description: 'Get current proxy status including running state and flow counts',
        parameters: { type: 'object', properties: {} },
        handler: async () => ({ running: engine.isRunning(), totalFlows: engine.getFlowCount(), errorFlows: engine.getErrorFlowCount() }),
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

  private async _createSession(contextPrompt: string): Promise<void> {
    console.log('[Agent] Creating session...');
    this.session = await this.client!.createSession({
      systemMessage: {
        content: SYSTEM_PROMPT + contextPrompt,
      },
      tools: this.buildTools(),
      streaming: true,
      onPermissionRequest: async (request: any) => {
        if (this.autoApprove) {
          return { kind: 'approved' };
        }

        const id = randomUUID();
        const toolName = request?.toolName || request?.name || 'unknown';
        const args = request?.arguments || request?.args || {};

        this.broadcast(IPC_CHANNELS.AGENT_PERMISSION_REQUEST, {
          id,
          toolName,
          arguments: args,
        });

        return new Promise<{ kind: string }>((resolve) => {
          const timeoutId = setTimeout(() => {
            if (this.pendingPermissions.has(id)) {
              this.pendingPermissions.delete(id);
              resolve({ kind: 'denied' });
            }
          }, 60000);

          this.pendingPermissions.set(id, {
            resolve: (value: { kind: string }) => {
              clearTimeout(timeoutId);
              resolve(value);
            },
          });
        });
      },
    });

    // Stream events to renderer and store unsubscribe for cleanup
    this.sessionEventUnsubscribe = this.session.on((event: any) => {
      if (event.type === 'assistant.message_delta') {
        this.broadcast(IPC_CHANNELS.AGENT_MESSAGE_DELTA, {
          content: event.data.deltaContent,
        });
      }
      if (event.type === 'tool.execution_start') {
        this.broadcast(IPC_CHANNELS.AGENT_TOOL_CALL, {
          name: event.data?.toolName || 'unknown',
          args: event.data?.arguments || {},
        });
      }
    });
    console.log('[Agent] Session created');
  }

  async sendMessage(message: string): Promise<string> {
    if (!this.client || !this.initialized) {
      await this.initialize();
    }

    const contextPrompt = buildContextPrompt({
      running: this.proxyEngine.isRunning(),
      totalRequests: this.proxyEngine.getFlowCount(),
      port: this.proxyEngine.getPort(),
    });

    if (!this.session) {
      if (!this.sessionPromise) {
        this.sessionPromise = this._createSession(contextPrompt);
      }
      await this.sessionPromise;
      this.sessionPromise = null;
    }

    console.log('[Agent] Sending message:', message.slice(0, 100));

    // Use event-driven streaming instead of sendAndWait
    return new Promise<string>((resolve, reject) => {
      let fullContent = '';
      // Safety net — only fires if session.idle never comes
      const timeout = setTimeout(() => {
        cleanup();
        const content = fullContent || 'No response from agent.';
        this.broadcast(IPC_CHANNELS.AGENT_MESSAGE_COMPLETE, { content });
        resolve(content);
      }, 300000);

      const unsubMessage = this.session.on('assistant.message', (event: any) => {
        fullContent = event.data?.content || fullContent;
      });

      const unsubDelta = this.session.on('assistant.message_delta', (event: any) => {
        fullContent += event.data?.deltaContent || '';
      });

      const unsubIdle = this.session.on('session.idle', () => {
        cleanup();
        const content = fullContent || 'No response from agent.';
        this.broadcast(IPC_CHANNELS.AGENT_MESSAGE_COMPLETE, { content });
        resolve(content);
      });

      const unsubError = this.session.on('session.error', (event: any) => {
        cleanup();
        reject(new Error(event.data?.message || 'Session error'));
      });

      const cleanup = () => {
        clearTimeout(timeout);
        unsubMessage();
        unsubDelta();
        unsubIdle();
        unsubError();
      };

      // Fire and forget - events handle the rest
      this.session.send({ prompt: message }).catch((err: any) => {
        cleanup();
        reject(err);
      });
    });
  }

  async stop(): Promise<void> {
    if (this.sessionEventUnsubscribe) {
      this.sessionEventUnsubscribe();
      this.sessionEventUnsubscribe = null;
    }
    if (this.client) {
      await this.client.stop();
      this.client = null;
      this.session = null;
      this.initialized = false;
      this.sessionPromise = null;
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
