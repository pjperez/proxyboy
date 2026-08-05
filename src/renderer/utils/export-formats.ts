import type { HttpFlow, HttpHeaders } from '../../shared/types';

function headerValue(value: string | string[]): string {
  return Array.isArray(value) ? value.join(', ') : value;
}

function jsString(value: string): string {
  return JSON.stringify(value);
}

function powershellSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function getBodyText(flow: HttpFlow): string | null {
  const body = flow.request.body;
  if (body == null) {
    return null;
  }
  if (typeof body === 'string') {
    return body;
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(body)) {
    return body.toString('utf8');
  }
  return String(body);
}

function shouldSkipHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === 'host' || lower === 'content-length' || lower === 'connection';
}

export function flowToFetch(flow: HttpFlow): string {
  const { request } = flow;
  const headers = Object.entries(request.headers)
    .filter(([name]) => !shouldSkipHeader(name))
    .map(([name, value]) => `    ${jsString(name)}: ${jsString(headerValue(value))}`)
    .join(',\n');

  const bodyText = getBodyText(flow);
  const lines = [
    'fetch(' + jsString(request.url) + ', {',
    `  method: ${jsString(request.method)},`,
  ];

  if (headers) {
    lines.push('  headers: {');
    lines.push(headers);
    lines.push('  },');
  }

  if (bodyText != null && request.method.toUpperCase() !== 'GET' && request.method.toUpperCase() !== 'HEAD') {
    lines.push(`  body: ${jsString(bodyText)},`);
  }

  lines.push('});');
  return lines.join('\n');
}

export function flowToPowerShell(flow: HttpFlow): string {
  const { request } = flow;
  const headers = Object.entries(request.headers)
    .filter(([name]) => !shouldSkipHeader(name))
    .map(([name, value]) => `  ${powershellSingleQuoted(name)} = ${powershellSingleQuoted(headerValue(value))}`)
    .join('\n');

  const bodyText = getBodyText(flow);
  const lines = [
    `$uri = ${powershellSingleQuoted(request.url)}`,
    `$method = ${powershellSingleQuoted(request.method)}`,
  ];

  if (headers) {
    lines.push('$headers = @{');
    lines.push(headers);
    lines.push('}');
  } else {
    lines.push('$headers = @{}');
  }

  if (bodyText != null && request.method.toUpperCase() !== 'GET' && request.method.toUpperCase() !== 'HEAD') {
    lines.push(`$body = ${powershellSingleQuoted(bodyText)}`);
    lines.push('Invoke-RestMethod -Uri $uri -Method $method -Headers $headers -Body $body');
  } else {
    lines.push('Invoke-RestMethod -Uri $uri -Method $method -Headers $headers');
  }

  return lines.join('\n');
}

export function formatHeaders(headers: HttpHeaders): string {
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${headerValue(value)}`)
    .join('\n');
}
