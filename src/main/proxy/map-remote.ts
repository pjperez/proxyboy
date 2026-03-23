import type { MapRemoteRule } from '../../shared/types';

export function resolveMapRemoteUrl(rule: MapRemoteRule, requestUrl: string): URL {
  const sourceUrl = new URL(requestUrl);
  const destinationUrl = new URL(rule.destinationUrl);

  if (rule.preservePath !== false) {
    destinationUrl.pathname = sourceUrl.pathname;
    destinationUrl.search = sourceUrl.search;
  }

  return destinationUrl;
}
