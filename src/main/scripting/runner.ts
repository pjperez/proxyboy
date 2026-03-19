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

function toRuntimeRequest(base: HttpRequest, mutable: MutableRequest): HttpRequest {
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

function toRuntimeResponse(base: HttpResponse, mutable: MutableResponse): HttpResponse {
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

export function executeScriptRule(
  rule: ScriptRule,
  request: HttpRequest,
  response?: HttpResponse,
  allowBlocking = true,
): ScriptExecutionResult {
  const notes: string[] = [];
  const originalRequest = cloneRequest(request);
  const originalResponse = cloneResponse(response);
  const mutableRequest = toMutableRequest(request);
  const mutableResponse = response ? toMutableResponse(response) : undefined;
  let blocked = false;

  Object.setPrototypeOf(mutableRequest, null);
  Object.setPrototypeOf(mutableRequest.headers, null);
  if (mutableResponse) {
    Object.setPrototypeOf(mutableResponse, null);
    Object.setPrototypeOf(mutableResponse.headers, null);
  }

  const sandbox = Object.assign(Object.create(null), {
    request: mutableRequest,
    response: mutableResponse,
    block: (message?: unknown) => {
      if (!allowBlocking) {
        notes.push('Blocking is only available while handling live request scripts.');
        return;
      }
      blocked = true;
      if (message != null) {
        notes.push(String(message));
      }
    },
    parseJson: (text: string) => JSON.parse(text),
    stringifyJson: (value: unknown) => JSON.stringify(value, null, 2),
    setJsonBody: (target: MutableRequest | MutableResponse, value: unknown) => {
      target.body = JSON.stringify(value, null, 2);
      target.bodyEncoding = 'utf8';
      target.headers['content-type'] = 'application/json';
    },
    atob: (value: string) => Buffer.from(value, 'base64').toString('utf8'),
    btoa: (value: string) => Buffer.from(value, 'utf8').toString('base64'),
    console: {
      log: (...args: unknown[]) => notes.push(args.map((arg) => String(arg)).join(' ')),
      warn: (...args: unknown[]) => notes.push(args.map((arg) => String(arg)).join(' ')),
    },
  });
  Object.setPrototypeOf(sandbox.console, null);
  const context = vm.createContext(sandbox, {
    codeGeneration: {
      strings: false,
      wasm: false,
    },
  });

  const script = new vm.Script(`"use strict";\n${rule.code}`);
  script.runInContext(context, { timeout: SCRIPT_TIMEOUT_MS });

  const nextRequest = toRuntimeRequest(originalRequest, mutableRequest);
  const nextResponse = mutableResponse && originalResponse
    ? toRuntimeResponse(originalResponse, mutableResponse)
    : originalResponse;

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

