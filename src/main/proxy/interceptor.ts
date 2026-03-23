import { HttpFlow, BreakpointRule, MapLocalRule, MapRemoteRule, Rule, AllowListRule, BlockListRule, CaptureFilterMode, ScriptRule } from '../../shared/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class Interceptor {
  private breakpointRules: BreakpointRule[] = [];
  private mapLocalRules: MapLocalRule[] = [];
  private mapRemoteRules: MapRemoteRule[] = [];
  private allowListRules: AllowListRule[] = [];
  private blockListRules: BlockListRule[] = [];
  private requestScriptRules: ScriptRule[] = [];
  private responseScriptRules: ScriptRule[] = [];
  private captureMode: CaptureFilterMode = 'capture-all';
  private regexCache: Map<string, RegExp> = new Map();
  private pausedFlows: Map<string, {
    resolve: (action: 'forward' | 'drop') => void;
    flow: HttpFlow;
  }> = new Map();

  setRules(rules: Rule[]): void {
    this.breakpointRules = rules.filter((r): r is BreakpointRule => r.type === 'breakpoint' && r.enabled);
    this.mapLocalRules = rules.filter((r): r is MapLocalRule => r.type === 'map-local' && r.enabled);
    this.mapRemoteRules = rules.filter((r): r is MapRemoteRule => r.type === 'map-remote' && r.enabled);
    this.allowListRules = rules.filter((r): r is AllowListRule => r.type === 'allow-list' && r.enabled);
    this.blockListRules = rules.filter((r): r is BlockListRule => r.type === 'block-list' && r.enabled);
    this.requestScriptRules = rules
      .filter((r): r is ScriptRule => r.type === 'script' && r.enabled)
      .filter((r) => r.phase === 'request' || r.phase === 'both');
    this.responseScriptRules = rules
      .filter((r): r is ScriptRule => r.type === 'script' && r.enabled)
      .filter((r) => r.phase === 'response' || r.phase === 'both');
    this.regexCache.clear();
  }

  setCaptureMode(mode: CaptureFilterMode): void {
    this.captureMode = mode;
  }

  getCaptureMode(): CaptureFilterMode {
    return this.captureMode;
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

  private hasUnsafeRegexPattern(pattern: string): boolean {
    if (pattern.length > 200) return true;

    const quantifiedGroupWithComplexInner =
      /\((?:[^()\\]|\\.)*(?:[+*]|\{\d+(?:,\d*)?\}|\|)(?:[^()\\]|\\.)*\)(?:[+*]|\{\d+(?:,\d*)?\})/;
    const repeatedQuantifiers =
      /(?:[+*]|\{\d+(?:,\d*)?\})(?:\s*)(?:[+*]|\{\d+(?:,\d*)?\})/;
    const backReference = /\\[1-9]/;
    const lookaround = /\(\?<([=!])|\(\?[=!]/;

    return (
      quantifiedGroupWithComplexInner.test(pattern) ||
      repeatedQuantifiers.test(pattern) ||
      backReference.test(pattern) ||
      lookaround.test(pattern)
    );
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
      if (this.hasUnsafeRegexPattern(pattern)) return false;
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

  private matchesRule(rule: Rule, url: string, method: string): boolean {
    if (!this.matchesUrl(rule.matchCriteria.urlPattern, url, rule.matchCriteria.isRegex)) {
      return false;
    }

    if (rule.matchCriteria.methods?.length && !rule.matchCriteria.methods.includes(method)) {
      return false;
    }

    return true;
  }

  shouldCapture(url: string, method: string): boolean {
    if (this.captureMode === 'block-list') {
      return !this.blockListRules.some((rule) => this.matchesRule(rule, url, method));
    }

    if (this.captureMode === 'allow-list') {
      if (this.allowListRules.length === 0) {
        return true;
      }
      return this.allowListRules.some((rule) => this.matchesRule(rule, url, method));
    }

    return true;
  }

  shouldBreakpoint(flow: HttpFlow, phase: 'request' | 'response'): BreakpointRule | null {
    for (const rule of this.breakpointRules) {
      if (rule.breakOn !== phase && rule.breakOn !== 'both') continue;
      if (!this.matchesRule(rule, flow.request.url, flow.request.method)) continue;
      return rule;
    }
    return null;
  }

  getMapLocalRule(url: string, method: string): MapLocalRule | null {
    for (const rule of this.mapLocalRules) {
      if (!this.matchesRule(rule, url, method)) continue;
      return rule;
    }
    return null;
  }

  getMapRemoteRule(url: string, method: string): MapRemoteRule | null {
    for (const rule of this.mapRemoteRules) {
      if (!this.matchesRule(rule, url, method)) continue;
      return rule;
    }
    return null;
  }

  getScriptRules(url: string, method: string, phase: 'request' | 'response'): ScriptRule[] {
    const source = phase === 'request' ? this.requestScriptRules : this.responseScriptRules;
    return source.filter((rule) => this.matchesRule(rule, url, method));
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

      // Block paths outside user home directory.
      // This is intentionally restrictive — users who need files from other
      // drives can copy/symlink them into their home directory. Relaxing this
      // would allow the AI agent's createMapLocalRule tool to read arbitrary
      // system files.
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
