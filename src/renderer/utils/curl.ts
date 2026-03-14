import type { HttpFlow, HttpHeaders } from '../../shared/types';

function shellEscape(str: string): string {
  // Escape single quotes for shell usage
  return str.replace(/'/g, "'\\''");
}

function headerValue(value: string | string[]): string {
  return Array.isArray(value) ? value.join(', ') : value;
}

export function flowToCurl(flow: HttpFlow): string {
  const parts: string[] = [];
  const { request } = flow;

  parts.push(`curl '${shellEscape(request.url)}'`);

  // Method — omit for GET since it's the default
  if (request.method !== 'GET') {
    parts.push(`  -X ${request.method}`);
  }

  // Request headers
  const headers = request.headers;
  let hasCompressedEncoding = false;

  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    const val = headerValue(value);

    if (lower === 'accept-encoding') {
      const enc = val.toLowerCase();
      if (enc.includes('gzip') || enc.includes('br') || enc.includes('deflate')) {
        hasCompressedEncoding = true;
      }
    }

    parts.push(`  -H '${shellEscape(`${name}: ${val}`)}'`);
  }

  // Request body
  if (request.body) {
    const bodyStr = typeof request.body === 'string'
      ? request.body
      : Buffer.isBuffer(request.body)
        ? request.body.toString('utf-8')
        : null;

    if (bodyStr !== null) {
      parts.push(`  --data-raw '${shellEscape(bodyStr)}'`);
    } else {
      parts.push(`  --data-binary @-`);
    }
  }

  if (hasCompressedEncoding) {
    parts.push(`  --compressed`);
  }

  return parts.join(' \\\n');
}
