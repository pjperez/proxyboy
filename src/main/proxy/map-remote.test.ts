import { describe, expect, it } from 'vitest';
import { resolveMapRemoteUrl } from './map-remote';

describe('resolveMapRemoteUrl', () => {
  it('preserves the original path and query by default', () => {
    const target = resolveMapRemoteUrl(
      {
        id: 'rule-1',
        type: 'map-remote',
        name: 'Rewrite API',
        enabled: true,
        matchCriteria: { urlPattern: '*://api.example.com/*' },
        destinationUrl: 'https://staging.example.net/base',
        createdAt: 1,
        updatedAt: 1,
      },
      'https://api.example.com/users?page=2',
    );

    expect(target.toString()).toBe('https://staging.example.net/users?page=2');
  });

  it('keeps the destination path when preservePath is disabled', () => {
    const target = resolveMapRemoteUrl(
      {
        id: 'rule-2',
        type: 'map-remote',
        name: 'Swap host only',
        enabled: true,
        matchCriteria: { urlPattern: '*://api.example.com/*' },
        destinationUrl: 'https://staging.example.net/base-path?from=rule',
        preservePath: false,
        createdAt: 1,
        updatedAt: 1,
      },
      'https://api.example.com/users?page=2',
    );

    expect(target.toString()).toBe('https://staging.example.net/base-path?from=rule');
  });
});
