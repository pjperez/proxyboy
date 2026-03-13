import { ProxyEngine } from '../proxy/engine';
import { HttpFlow } from '../../shared/types';
import { randomUUID } from 'crypto';

export interface AgentToolContext {
  proxyEngine: ProxyEngine;
}

export function registerAgentTools(client: any, context: AgentToolContext): void {
  const { proxyEngine } = context;

  // Tool: Get recent traffic
  client.registerToolHandler('getRecentTraffic', async (args: { count?: number }) => {
    const flows = proxyEngine.getFlows();
    const count = args.count || 20;
    const recent = flows.slice(-count);
    return {
      count: recent.length,
      total: flows.length,
      flows: recent.map(summarizeFlow),
    };
  });

  // Tool: Search traffic
  client.registerToolHandler('searchTraffic', async (args: {
    query?: string;
    method?: string;
    statusCode?: number;
    minDuration?: number;
  }) => {
    let flows = proxyEngine.getFlows();

    if (args.query) {
      const q = args.query.toLowerCase();
      flows = flows.filter(f =>
        f.request.url.toLowerCase().includes(q) ||
        (f.request.body && String(f.request.body).toLowerCase().includes(q)) ||
        (f.response?.body && String(f.response.body).toLowerCase().includes(q))
      );
    }
    if (args.method) {
      flows = flows.filter(f => f.request.method === args.method!.toUpperCase());
    }
    if (args.statusCode) {
      flows = flows.filter(f => f.response?.statusCode === args.statusCode);
    }
    if (args.minDuration) {
      flows = flows.filter(f => f.response && f.response.duration >= args.minDuration!);
    }

    return {
      count: flows.length,
      flows: flows.slice(0, 50).map(summarizeFlow),
    };
  });

  // Tool: Analyze a specific flow
  client.registerToolHandler('analyzeFlow', async (args: { flowId: string }) => {
    const flow = proxyEngine.getFlow(args.flowId);
    if (!flow) return { error: 'Flow not found' };

    return {
      id: flow.id,
      request: {
        method: flow.request.method,
        url: flow.request.url,
        headers: flow.request.headers,
        bodySize: flow.request.bodySize,
        body: flow.request.body ? String(flow.request.body).slice(0, 5000) : null,
      },
      response: flow.response ? {
        statusCode: flow.response.statusCode,
        statusMessage: flow.response.statusMessage,
        headers: flow.response.headers,
        bodySize: flow.response.bodySize,
        body: flow.response.body ? String(flow.response.body).slice(0, 5000) : null,
        duration: flow.response.duration,
      } : null,
      state: flow.state,
      tags: flow.tags,
    };
  });

  // Tool: Get error flows (4xx/5xx)
  client.registerToolHandler('getErrorFlows', async () => {
    const flows = proxyEngine.getFlows().filter(f =>
      f.response && f.response.statusCode >= 400
    );
    return {
      count: flows.length,
      flows: flows.slice(0, 50).map(summarizeFlow),
    };
  });

  // Tool: Create breakpoint rule
  client.registerToolHandler('createBreakpointRule', async (args: {
    name: string;
    urlPattern: string;
    methods?: string[];
    breakOn?: 'request' | 'response' | 'both';
    isRegex?: boolean;
  }) => {
    const rule = {
      id: randomUUID(),
      type: 'breakpoint' as const,
      name: args.name,
      enabled: true,
      matchCriteria: {
        urlPattern: args.urlPattern,
        methods: args.methods,
        isRegex: args.isRegex || false,
      },
      breakOn: args.breakOn || 'both',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    proxyEngine.getInterceptor().setRules([rule]);
    return { success: true, rule };
  });

  // Tool: Create map-local rule
  client.registerToolHandler('createMapLocalRule', async (args: {
    name: string;
    urlPattern: string;
    localFilePath: string;
    statusCode?: number;
    methods?: string[];
    isRegex?: boolean;
  }) => {
    const rule = {
      id: randomUUID(),
      type: 'map-local' as const,
      name: args.name,
      enabled: true,
      matchCriteria: {
        urlPattern: args.urlPattern,
        methods: args.methods,
        isRegex: args.isRegex || false,
      },
      localFilePath: args.localFilePath,
      statusCode: args.statusCode || 200,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    proxyEngine.getInterceptor().setRules([rule]);
    return { success: true, rule };
  });

  // Tool: Get proxy status
  client.registerToolHandler('getProxyStatus', async () => {
    return {
      running: proxyEngine.isRunning(),
      totalFlows: proxyEngine.getFlows().length,
      errorFlows: proxyEngine.getFlows().filter(f => f.response && f.response.statusCode >= 400).length,
    };
  });

  // Tool: Toggle proxy
  client.registerToolHandler('toggleProxy', async (args: { action: 'start' | 'stop' }) => {
    if (args.action === 'start') {
      await proxyEngine.start();
      return { success: true, running: true };
    } else {
      await proxyEngine.stop();
      return { success: true, running: false };
    }
  });
}

function summarizeFlow(flow: HttpFlow): object {
  return {
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
  };
}
