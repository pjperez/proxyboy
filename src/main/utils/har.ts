import { HttpFlow } from '../../shared/types';

interface HarLog {
  version: string;
  creator: { name: string; version: string };
  entries: HarEntry[];
}

interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    headers: Array<{ name: string; value: string }>;
    queryString: Array<{ name: string; value: string }>;
    bodySize: number;
    postData?: { mimeType: string; text: string };
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    headers: Array<{ name: string; value: string }>;
    content: { size: number; mimeType: string; text?: string };
    bodySize: number;
  };
  timings: { send: number; wait: number; receive: number };
}

export function flowsToHar(flows: HttpFlow[]): string {
  const har: { log: HarLog } = {
    log: {
      version: '1.2',
      creator: {
        name: 'ProxyBoy',
        version: '1.0.0',
      },
      entries: flows
        .filter(f => f.response)
        .map(flowToHarEntry),
    },
  };

  return JSON.stringify(har, null, 2);
}

function flowToHarEntry(flow: HttpFlow): HarEntry {
  const headers = (obj: Record<string, any>): Array<{ name: string; value: string }> =>
    Object.entries(obj || {}).map(([name, value]) => ({ name, value: String(value) }));

  const url = new URL(flow.request.url);
  const queryString = Array.from(url.searchParams.entries()).map(([name, value]) => ({ name, value }));

  const entry: HarEntry = {
    startedDateTime: new Date(flow.request.timestamp).toISOString(),
    time: flow.response?.duration || 0,
    request: {
      method: flow.request.method,
      url: flow.request.url,
      httpVersion: 'HTTP/1.1',
      headers: headers(flow.request.headers),
      queryString,
      bodySize: flow.request.bodySize,
    },
    response: {
      status: flow.response!.statusCode,
      statusText: flow.response!.statusMessage,
      httpVersion: 'HTTP/1.1',
      headers: headers(flow.response!.headers),
      content: {
        size: flow.response!.bodySize,
        mimeType: String(flow.response!.headers['content-type'] || 'application/octet-stream'),
        text: flow.response!.body ? String(flow.response!.body) : undefined,
      },
      bodySize: flow.response!.bodySize,
    },
    timings: {
      send: 0,
      wait: flow.response?.duration || 0,
      receive: 0,
    },
  };

  if (flow.request.body) {
    entry.request.postData = {
      mimeType: String(flow.request.headers['content-type'] || 'application/octet-stream'),
      text: String(flow.request.body),
    };
  }

  return entry;
}
