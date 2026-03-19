import type { HttpFlow, HttpHeaders } from '../../shared/types';

export type TrafficRowColorMode = 'off' | 'status' | 'content-type';

function getContentType(headers?: HttpHeaders): string {
  if (!headers) return '';
  return String(headers['content-type'] || '').toLowerCase();
}

function getStatusAccentColor(flow: HttpFlow): string {
  if (flow.state === 'error' || flow.state === 'blocked') {
    return 'var(--color-pb-error)';
  }

  const status = flow.response?.statusCode;
  if (!status) {
    return 'var(--color-pb-text-dim)';
  }
  if (status < 300) {
    return 'var(--color-pb-success)';
  }
  if (status < 400) {
    return 'var(--color-pb-info)';
  }
  if (status < 500) {
    return 'var(--color-pb-warning)';
  }
  return 'var(--color-pb-error)';
}

function getContentTypeAccentColor(flow: HttpFlow): string {
  if (flow.state === 'error' || flow.state === 'blocked') {
    return 'var(--color-pb-error)';
  }

  const contentType = getContentType(flow.response?.headers);
  if (!contentType) {
    return 'var(--color-pb-text-dim)';
  }
  if (contentType.includes('json') || contentType.includes('javascript') || contentType.includes('graphql')) {
    return 'var(--color-pb-info)';
  }
  if (contentType.includes('html') || contentType.includes('css')) {
    return 'var(--color-pb-accent)';
  }
  if (contentType.includes('image') || contentType.includes('font')) {
    return 'var(--color-pb-success)';
  }
  if (contentType.includes('xml') || contentType.includes('text')) {
    return 'var(--color-pb-warning)';
  }
  if (contentType.includes('audio') || contentType.includes('video')) {
    return 'var(--color-pb-warning)';
  }
  return 'var(--color-pb-accent)';
}

export function getTrafficRowAccentColor(flow: HttpFlow, mode: TrafficRowColorMode): string {
  switch (mode) {
    case 'status':
      return getStatusAccentColor(flow);
    case 'content-type':
      return getContentTypeAccentColor(flow);
    case 'off':
    default:
      return 'transparent';
  }
}

