import { HttpFlow, HttpRequest, HttpResponse, BreakpointRule, MapLocalRule, Rule } from '../../shared/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class Interceptor {
  private breakpointRules: BreakpointRule[] = [];
  private mapLocalRules: MapLocalRule[] = [];
  private regexCache: Map<string, RegExp> = new Map();
  private pausedFlows: Map<string, {
    resolve: (action: 'forward' | 'drop') => void;
    flow: HttpFlow;
  }> = new Map();

  setRules(rules: Rule[]): void {
    this.breakpointRules = rules.filter((r): r is BreakpointRule => r.type === 'breakpoint' && r.enabled);
    this.mapLocalRules = rules.filter((r): r is MapLocalRule => r.type === 'map-local' && r.enabled);
    this.regexCache.clear();
  }

  getBreakpointRuleCount(): number {
    return this.breakpointRules.length;
  }

  getBreakpointRulesDebug(): Array<{ name: string; pattern: string; breakOn: string }> {
    return this.breakpointRules.map(r => ({
      name: r.name,
      pattern: r.matchCriteria.urlPattern,
      breakOn: r.breakOn,
    }));
  }

  private hasNestedQuantifiers(pattern: string): boolean {
    // Detect patterns like (a+)+, (.*){2}, (a*)+, etc.
    return /(\(.*[+*].*\))[+*{\d]/.test(pattern) || /([+*]\))[+*]/.test(pattern);
  }

  private getCachedRegex(pattern: string, flags?: string): RegExp | null {
    const key = `${pattern}|||${flags || ''}`;
    let cached = this.regexCache.get(key);
    if (!cached) {
      try {
        cached = new RegExp(pattern, flags);
        this.regexCache.set(key, cached);
      } catch {
        return null;
      }
    }
    return cached;
  }

  matchesUrl(pattern: string, url: string, isRegex?: boolean): boolean {
    if (isRegex) {
      if (pattern.length > 500) return false;
      if (this.hasNestedQuantifiers(pattern)) return false;
      const re = this.getCachedRegex(pattern);
      return re ? re.test(url) : false;
    }
    // Glob-style matching: * matches anything
    const globRegex = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    const re = this.getCachedRegex(`^${globRegex}$`, 'i');
    return re ? re.test(url) : false;
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
      const resolvedPath = fs.realpathSync(path.resolve(rule.localFilePath));
      const lowerPath = resolvedPath.toLowerCase();

      // Block system directories
      if (lowerPath.startsWith('c:\\windows')) {
        console.warn('[Interceptor] Map-local path blocked (system directory):', resolvedPath);
        return null;
      }

      // Block known sensitive paths
      const sensitivePatterns = [
        'appdata\\local\\google',
        'appdata\\roaming\\mozilla',
      ];
      if (sensitivePatterns.some(p => lowerPath.includes(p))) {
        console.warn('[Interceptor] Map-local path blocked (sensitive path):', resolvedPath);
        return null;
      }

      // Block paths outside user home directory
      const userHome = os.homedir();
      if (!lowerPath.startsWith(userHome.toLowerCase())) {
        console.warn('[Interceptor] Map-local path blocked (outside user home):', resolvedPath);
        return null;
      }

      const body = fs.readFileSync(resolvedPath);
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
    } catch (err) {
      console.warn(`[Interceptor] Map-local file read error for rule "${rule.name}" at path "${rule.localFilePath}":`, err);
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

  clearPausedFlows(): void {
    for (const [, paused] of this.pausedFlows) {
      paused.resolve('forward');
    }
    this.pausedFlows.clear();
  }

  getPausedFlows(): Map<string, { flow: HttpFlow }> {
    return new Map(
      Array.from(this.pausedFlows.entries()).map(([k, v]) => [k, { flow: v.flow }])
    );
  }
}
