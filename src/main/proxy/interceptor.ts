import { HttpFlow, HttpRequest, HttpResponse, BreakpointRule, MapLocalRule, Rule } from '../../shared/types';
import * as fs from 'fs';

export class Interceptor {
  private breakpointRules: BreakpointRule[] = [];
  private mapLocalRules: MapLocalRule[] = [];
  private pausedFlows: Map<string, {
    resolve: (action: 'forward' | 'drop') => void;
    flow: HttpFlow;
  }> = new Map();

  setRules(rules: Rule[]): void {
    this.breakpointRules = rules.filter((r): r is BreakpointRule => r.type === 'breakpoint' && r.enabled);
    this.mapLocalRules = rules.filter((r): r is MapLocalRule => r.type === 'map-local' && r.enabled);
  }

  matchesUrl(pattern: string, url: string, isRegex?: boolean): boolean {
    if (isRegex) {
      try {
        return new RegExp(pattern).test(url);
      } catch {
        return false;
      }
    }
    // Glob-style matching: * matches anything
    const regex = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regex}$`, 'i').test(url);
  }

  shouldBreakpoint(flow: HttpFlow, phase: 'request' | 'response'): BreakpointRule | null {
    for (const rule of this.breakpointRules) {
      if (rule.breakOn !== phase && rule.breakOn !== 'both') continue;
      if (!this.matchesUrl(rule.matchCriteria.urlPattern, flow.request.url, rule.matchCriteria.isRegex)) continue;
      if (rule.matchCriteria.methods && !rule.matchCriteria.methods.includes(flow.request.method)) continue;
      return rule;
    }
    return null;
  }

  getMapLocalRule(url: string, method: string): MapLocalRule | null {
    for (const rule of this.mapLocalRules) {
      if (!this.matchesUrl(rule.matchCriteria.urlPattern, url, rule.matchCriteria.isRegex)) continue;
      if (rule.matchCriteria.methods && !rule.matchCriteria.methods.includes(method)) continue;
      return rule;
    }
    return null;
  }

  getMapLocalResponse(rule: MapLocalRule): { statusCode: number; headers: Record<string, string>; body: Buffer } | null {
    try {
      const body = fs.readFileSync(rule.localFilePath);
      const ext = rule.localFilePath.split('.').pop()?.toLowerCase();
      const contentTypeMap: Record<string, string> = {
        json: 'application/json',
        xml: 'application/xml',
        html: 'text/html',
        txt: 'text/plain',
        css: 'text/css',
        js: 'application/javascript',
      };
      const headers: Record<string, string> = {
        'content-type': contentTypeMap[ext || ''] || 'application/octet-stream',
        'content-length': String(body.length),
        'x-proxyboy-map-local': 'true',
        ...(rule.responseHeaders as Record<string, string> || {}),
      };
      return {
        statusCode: rule.statusCode || 200,
        headers,
        body,
      };
    } catch {
      return null;
    }
  }

  pauseFlow(flowId: string, flow: HttpFlow): Promise<'forward' | 'drop'> {
    return new Promise((resolve) => {
      this.pausedFlows.set(flowId, { resolve, flow });
    });
  }

  resumeFlow(flowId: string, action: 'forward' | 'drop'): void {
    const paused = this.pausedFlows.get(flowId);
    if (paused) {
      paused.resolve(action);
      this.pausedFlows.delete(flowId);
    }
  }

  getPausedFlows(): Map<string, { flow: HttpFlow }> {
    return new Map(
      Array.from(this.pausedFlows.entries()).map(([k, v]) => [k, { flow: v.flow }])
    );
  }
}
