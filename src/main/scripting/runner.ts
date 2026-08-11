import * as vm from 'vm';
import type { HttpHeaders, HttpRequest, HttpResponse, ScriptRule } from '../../shared/types';

type BodyEncoding = 'utf8' | 'base64';

interface MutableRequest {
  method: string;
  url: string;
  protocol: 'http' | 'https';
  host: string;
  path: string;
  headers: HttpHeaders;
  body?: string;
  bodyEncoding: BodyEncoding;
}

interface MutableResponse {
  statusCode: number;
  statusMessage: string;
  headers: HttpHeaders;
  body?: string;
  bodyEncoding: BodyEncoding;
}

export interface ScriptExecutionResult {
  blocked: boolean;
  notes: string[];
  request: HttpRequest;
  response?: HttpResponse;
  requestModified: boolean;
  responseModified: boolean;
  requestBodyModified: boolean;
  responseBodyModified: boolean;
  requestTargetModified: boolean;
  responseMetaModified: boolean;
}

const SCRIPT_TIMEOUT_MS = 1000;
const MAX_COMPILED_SCRIPT_CACHE_SIZE = 128;
const compiledScriptCache = new Map<string, vm.Script>();

// NOTE: `vm` is not a true security boundary. The prelude below reconstructs the
// request/response inside the context (via JSON round-trip) so scripts only ever
// see context-realm objects; all helpers are defined in-context so their
// constructors resolve to the context's (code-generation-blocked) Function.
// Any host-realm object handed into the sandbox would re-open the escape
// (`obj.constructor("return process")()`), so `__pb` carries primitives only.
const PRELUDE = `"use strict";
const __b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function __utf8Encode(value) {
  const bytes = [];
  for (let i = 0; i < value.length; i++) {
    let cp = value.codePointAt(i);
    if (cp > 0xFFFF) i++;
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xC0 | (cp >> 6), 0x80 | (cp & 0x3F));
    else if (cp < 0x10000) bytes.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
    else bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
  }
  return bytes;
}
function __utf8Decode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b < 0x80) out += String.fromCharCode(b);
    else if ((b & 0xE0) === 0xC0) out += String.fromCharCode(((b & 0x1F) << 6) | (bytes[++i] & 0x3F));
    else if ((b & 0xF0) === 0xE0) out += String.fromCharCode(((b & 0x0F) << 12) | ((bytes[++i] & 0x3F) << 6) | (bytes[++i] & 0x3F));
    else { const cp = ((b & 0x07) << 18) | ((bytes[++i] & 0x3F) << 12) | ((bytes[++i] & 0x3F) << 6) | (bytes[++i] & 0x3F); out += String.fromCodePoint(cp); }
  }
  return out;
}
__pb.notes = [];
globalThis.parseJson = function parseJson(text) { return JSON.parse(text); };
globalThis.stringifyJson = function stringifyJson(value) { return JSON.stringify(value, null, 2); };
globalThis.setJsonBody = function setJsonBody(target, value) {
  target.body = JSON.stringify(value, null, 2);
  target.bodyEncoding = 'utf8';
  target.headers['content-type'] = 'application/json';
};
globalThis.block = function block(message) {
  if (!__pb.allowBlocking) {
    __pb.notes.push('Blocking is only available while handling live request scripts.');
    return;
  }
  __pb.blocked = true;
  if (message != null) {
    __pb.notes.push(String(message));
  }
};
globalThis.console = {
  log: (...args) => __pb.notes.push(args.map((arg) => String(arg)).join(' ')),
  warn: (...args) => __pb.notes.push(args.map((arg) => String(arg)).join(' ')),
};
globalThis.btoa = function btoa(value) {
  const bytes = __utf8Encode(String(value));
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = i + 1 < bytes.length ? bytes[i + 1] : 0, b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += __b64chars[b0 >> 2];
    out += __b64chars[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? __b64chars[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? __b64chars[b2 & 63] : '=';
  }
  return out;
};
globalThis.atob = function atob(value) {
  const s = String(value).replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = [];
  let buffer = 0, bits = 0;
  for (let i = 0; i < s.length; i++) {
    const idx = __b64chars.indexOf(s[i]);
    if (idx === -1) continue;
    buffer = (buffer << 6) | idx;
    bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 0xFF); }
  }
  return __utf8Decode(bytes);
};
globalThis.request = __pb.requestJson != null ? JSON.parse(__pb.requestJson) : undefined;
globalThis.response = __pb.responseJson != null ? JSON.parse(__pb.responseJson) : undefined;
`;

function getCompiledScriptCacheKey(rule: ScriptRule): string {
  return `${rule.id}:${rule.updatedAt}:${rule.phase}:${rule.code}`;
}

function getCompiledScript(rule: ScriptRule): vm.Script {
  const cacheKey = getCompiledScriptCacheKey(rule);
  const cachedScript = compiledScriptCache.get(cacheKey);
  if (cachedScript) {
    compiledScriptCache.delete(cacheKey);
    compiledScriptCache.set(cacheKey, cachedScript);
    return cachedScript;
  }

  const compiledScript = new vm.Script(`${PRELUDE}\n${rule.code}`);
  compiledScriptCache.set(cacheKey, compiledScript);
  if (compiledScriptCache.size > MAX_COMPILED_SCRIPT_CACHE_SIZE) {
    const oldestKey = compiledScriptCache.keys().next().value;
    if (oldestKey) {
      compiledScriptCache.delete(oldestKey);
    }
  }

  return compiledScript;
}

export function clearCompiledScriptCache(): void {
  compiledScriptCache.clear();
}

export function getCompiledScriptCacheSize(): number {
  return compiledScriptCache.size;
}

function cloneHeaders(headers: HttpHeaders): HttpHeaders {
  return Object.assign(Object.create(null), Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]),
  ));
}

function isProbablyTextBuffer(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(512, buf.length));
  let nonPrintable = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const b = sample[i];
    if (b === 0 || (b < 32 && b !== 9 && b !== 10 && b !== 13)) {
      nonPrintable += 1;
    }
  }
  return nonPrintable <= sample.length * 0.1;
}

function bodyToEditable(body?: Buffer | string): { body?: string; bodyEncoding: BodyEncoding } {
  if (body == null) {
    return { body: undefined, bodyEncoding: 'utf8' };
  }

  if (typeof body === 'string') {
    return { body, bodyEncoding: 'utf8' };
  }

  if (isProbablyTextBuffer(body)) {
    return { body: body.toString('utf8'), bodyEncoding: 'utf8' };
  }

  return { body: body.toString('base64'), bodyEncoding: 'base64' };
}

function editableBodyToRuntime(body: string | undefined, encoding: BodyEncoding): Buffer | string | undefined {
  if (body == null) {
    return undefined;
  }

  return encoding === 'base64'
    ? Buffer.from(body, 'base64')
    : Buffer.from(body, 'utf8');
}

function cloneRequest(request: HttpRequest): HttpRequest {
  return {
    ...request,
    headers: cloneHeaders(request.headers),
    body: Buffer.isBuffer(request.body) ? Buffer.from(request.body) : request.body,
  };
}

function cloneResponse(response?: HttpResponse): HttpResponse | undefined {
  if (!response) {
    return undefined;
  }

  return {
    ...response,
    headers: cloneHeaders(response.headers),
    body: Buffer.isBuffer(response.body) ? Buffer.from(response.body) : response.body,
  };
}

function toMutableRequest(request: HttpRequest): MutableRequest {
  const body = bodyToEditable(request.body);
  return {
    method: request.method,
    url: request.url,
    protocol: request.protocol,
    host: request.host,
    path: request.path,
    headers: cloneHeaders(request.headers),
    body: body.body,
    bodyEncoding: body.bodyEncoding,
  };
}

function toMutableResponse(response: HttpResponse): MutableResponse {
  const body = bodyToEditable(response.body);
  return {
    statusCode: response.statusCode,
    statusMessage: response.statusMessage,
    headers: cloneHeaders(response.headers),
    body: body.body,
    bodyEncoding: body.bodyEncoding,
  };
}

function areBodiesEqual(left?: Buffer | string, right?: Buffer | string): boolean {
  if (left == null && right == null) {
    return true;
  }

  if (Buffer.isBuffer(left) && Buffer.isBuffer(right)) {
    return left.equals(right);
  }

  return String(left ?? '') === String(right ?? '');
}

function requestsEqual(left: HttpRequest, right: HttpRequest): boolean {
  return left.method === right.method
    && left.url === right.url
    && left.protocol === right.protocol
    && left.host === right.host
    && left.path === right.path
    && JSON.stringify(left.headers) === JSON.stringify(right.headers)
    && areBodiesEqual(left.body, right.body);
}

function responsesEqual(left: HttpResponse | undefined, right: HttpResponse | undefined): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  return left.statusCode === right.statusCode
    && left.statusMessage === right.statusMessage
    && JSON.stringify(left.headers) === JSON.stringify(right.headers)
    && areBodiesEqual(left.body, right.body);
}

function toRuntimeRequest(base: HttpRequest, mutable: MutableRequest | null): HttpRequest {
  if (!mutable) {
    return base;
  }
  const body = editableBodyToRuntime(mutable.body, mutable.bodyEncoding);
  const bodySize = Buffer.isBuffer(body) ? body.length : body ? Buffer.byteLength(body, 'utf8') : 0;
  return {
    ...base,
    method: mutable.method,
    url: mutable.url,
    protocol: mutable.protocol,
    host: mutable.host,
    path: mutable.path,
    headers: cloneHeaders(mutable.headers),
    body,
    bodySize,
  };
}

function toRuntimeResponse(base: HttpResponse, mutable: MutableResponse | null): HttpResponse {
  if (!mutable) {
    return base;
  }
  const body = editableBodyToRuntime(mutable.body, mutable.bodyEncoding);
  const bodySize = Buffer.isBuffer(body) ? body.length : body ? Buffer.byteLength(body, 'utf8') : 0;
  return {
    ...base,
    statusCode: mutable.statusCode,
    statusMessage: mutable.statusMessage,
    headers: cloneHeaders(mutable.headers),
    body,
    bodySize,
  };
}

export function executeScriptRule(
  rule: ScriptRule,
  request: HttpRequest,
  response?: HttpResponse,
  allowBlocking = true,
): ScriptExecutionResult {
  const originalRequest = cloneRequest(request);
  const originalResponse = cloneResponse(response);
  const mutableRequest = toMutableRequest(request);
  const mutableResponse = response ? toMutableResponse(response) : undefined;

  // Only primitives cross the host→context boundary. The request/response travel
  // as JSON strings; the prelude rebuilds them inside the context so every object
  // the script touches is context-realm and cannot be used to smuggle host code in.
  const pb = Object.assign(Object.create(null), {
    allowBlocking: allowBlocking,
    blocked: false,
    requestJson: JSON.stringify(mutableRequest),
    responseJson: mutableResponse ? JSON.stringify(mutableResponse) : null,
  });

  const sandbox = Object.assign(Object.create(null), { __pb: pb });
  const context = vm.createContext(sandbox, {
    codeGeneration: {
      strings: false,
      wasm: false,
    },
  });

  const script = getCompiledScript(rule);
  script.runInContext(context, { timeout: SCRIPT_TIMEOUT_MS });

  const nextRequest = toRuntimeRequest(originalRequest, sandbox.request);
  const nextResponse = sandbox.response && originalResponse
    ? toRuntimeResponse(originalResponse, sandbox.response)
    : originalResponse;

  const blocked = pb.blocked === true;
  const notes = Array.isArray(pb.notes) ? Array.from(pb.notes as unknown[]) as string[] : [];

  const requestBodyModified = !areBodiesEqual(originalRequest.body, nextRequest.body);
  const responseBodyModified = !areBodiesEqual(originalResponse?.body, nextResponse?.body);
  const requestTargetModified = originalRequest.method !== nextRequest.method
    || originalRequest.url !== nextRequest.url
    || originalRequest.protocol !== nextRequest.protocol
    || originalRequest.host !== nextRequest.host
    || originalRequest.path !== nextRequest.path;
  const responseMetaModified = originalResponse != null && nextResponse != null
    ? (
      originalResponse.statusCode !== nextResponse.statusCode
      || originalResponse.statusMessage !== nextResponse.statusMessage
      || JSON.stringify(originalResponse.headers) !== JSON.stringify(nextResponse.headers)
    )
    : false;

  return {
    blocked,
    notes,
    request: nextRequest,
    response: nextResponse,
    requestModified: !requestsEqual(originalRequest, nextRequest),
    responseModified: !responsesEqual(originalResponse, nextResponse),
    requestBodyModified,
    responseBodyModified,
    requestTargetModified,
    responseMetaModified,
  };
}

