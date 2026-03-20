import { describe, expect, it } from 'vitest';
import { buildUpdateFeedUrl, isAutoUpdateSupported } from './updater';

describe('buildUpdateFeedUrl', () => {
  it('builds the public update feed URL for a GitHub repository', () => {
    expect(buildUpdateFeedUrl('pjperez/proxyboy', '1.2.3', 'win32', 'x64')).toBe(
      'https://update.electronjs.org/pjperez/proxyboy/win32-x64/1.2.3',
    );
  });
});

describe('isAutoUpdateSupported', () => {
  it('supports packaged Windows builds', () => {
    expect(isAutoUpdateSupported('win32', true)).toBe(true);
  });

  it('rejects unpackaged or unsupported platforms', () => {
    expect(isAutoUpdateSupported('win32', false)).toBe(false);
    expect(isAutoUpdateSupported('darwin', true)).toBe(false);
    expect(isAutoUpdateSupported('linux', true)).toBe(false);
  });
});
