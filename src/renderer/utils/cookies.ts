import type { HttpHeaders } from '../../shared/types';

export interface ParsedRequestCookie {
  name: string;
  value: string;
  raw: string;
}

export interface ParsedResponseCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: string;
  maxAge?: string;
  sameSite?: string;
  secure: boolean;
  httpOnly: boolean;
  raw: string;
}

function getHeaderValues(value?: string | string[]): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function splitCookiePair(value: string): { name: string; value: string } | null {
  const separatorIndex = value.indexOf('=');
  if (separatorIndex <= 0) {
    return null;
  }

  const name = value.slice(0, separatorIndex).trim();
  const cookieValue = value.slice(separatorIndex + 1).trim();
  if (!name) {
    return null;
  }

  return { name, value: cookieValue };
}

export function parseRequestCookies(headers: HttpHeaders): ParsedRequestCookie[] {
  const cookieHeaders = getHeaderValues(headers.cookie);
  const parsedCookies: ParsedRequestCookie[] = [];

  for (const header of cookieHeaders) {
    for (const part of header.split(';')) {
      const raw = part.trim();
      if (!raw) continue;

      const pair = splitCookiePair(raw);
      if (!pair) continue;
      parsedCookies.push({ ...pair, raw });
    }
  }

  return parsedCookies;
}

export function parseResponseCookies(headers: HttpHeaders): ParsedResponseCookie[] {
  return getHeaderValues(headers['set-cookie'])
    .map((header) => {
      const parts = header.split(';').map((part) => part.trim()).filter(Boolean);
      if (parts.length === 0) {
        return null;
      }

      const cookiePair = splitCookiePair(parts[0]);
      if (!cookiePair) {
        return null;
      }

      const cookie: ParsedResponseCookie = {
        ...cookiePair,
        secure: false,
        httpOnly: false,
        raw: header,
      };

      for (const attributePart of parts.slice(1)) {
        const [attributeName, ...attributeValueParts] = attributePart.split('=');
        const lowerAttributeName = attributeName.toLowerCase();
        const attributeValue = attributeValueParts.join('=').trim();

        switch (lowerAttributeName) {
          case 'domain':
            cookie.domain = attributeValue || undefined;
            break;
          case 'path':
            cookie.path = attributeValue || undefined;
            break;
          case 'expires':
            cookie.expires = attributeValue || undefined;
            break;
          case 'max-age':
            cookie.maxAge = attributeValue || undefined;
            break;
          case 'samesite':
            cookie.sameSite = attributeValue || undefined;
            break;
          case 'secure':
            cookie.secure = true;
            break;
          case 'httponly':
            cookie.httpOnly = true;
            break;
          default:
            break;
        }
      }

      return cookie;
    })
    .filter((cookie): cookie is ParsedResponseCookie => cookie !== null);
}
