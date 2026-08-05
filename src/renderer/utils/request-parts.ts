export interface QueryParam {
  key: string;
  value: string;
}

export interface FormField {
  key: string;
  value: string;
}

export function parseQueryParams(url: string): QueryParam[] {
  try {
    const parsed = new URL(url);
    return Array.from(parsed.searchParams.entries()).map(([key, value]) => ({ key, value }));
  } catch {
    const queryIndex = url.indexOf('?');
    if (queryIndex === -1) {
      return [];
    }
    const search = url.slice(queryIndex + 1);
    return search
      .split('&')
      .filter(Boolean)
      .map((pair) => {
        const [rawKey, ...rest] = pair.split('=');
        return {
          key: decodeURIComponent(rawKey || ''),
          value: decodeURIComponent(rest.join('=') || ''),
        };
      });
  }
}

export function parseUrlEncodedForm(body: string): FormField[] {
  if (!body.trim()) {
    return [];
  }

  return body
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const [rawKey, ...rest] = pair.split('=');
      try {
        return {
          key: decodeURIComponent((rawKey || '').replace(/\+/g, ' ')),
          value: decodeURIComponent((rest.join('=') || '').replace(/\+/g, ' ')),
        };
      } catch {
        return {
          key: rawKey || '',
          value: rest.join('=') || '',
        };
      }
    });
}

export function isUrlEncodedForm(contentType: string): boolean {
  return contentType.toLowerCase().includes('application/x-www-form-urlencoded');
}
