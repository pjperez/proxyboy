import { describe, expect, it } from 'vitest';
import { buildSslPinningGuidance, isSuspectedSslPinningError } from './ssl-pinning';

describe('isSuspectedSslPinningError', () => {
  it('recognizes known certificate validation error codes', () => {
    expect(isSuspectedSslPinningError({ code: 'ERR_CERT_AUTHORITY_INVALID' })).toBe(true);
    expect(isSuspectedSslPinningError({ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' })).toBe(true);
  });

  it('recognizes TLS verification failure messages', () => {
    expect(isSuspectedSslPinningError(new Error('certificate verify failed'))).toBe(true);
    expect(isSuspectedSslPinningError('SSL alert certificate unknown from peer')).toBe(true);
  });

  it('does not flag unrelated network errors', () => {
    expect(isSuspectedSslPinningError(new Error('connect ECONNRESET'))).toBe(false);
    expect(isSuspectedSslPinningError({ code: 'ETIMEDOUT', message: 'timed out' })).toBe(false);
  });
});

describe('buildSslPinningGuidance', () => {
  it('includes both guidance and the original error detail', () => {
    const guidance = buildSslPinningGuidance(new Error('certificate verify failed'));

    expect(guidance).toContain('ProxyBoy suspects this request failed because the client rejected the MITM certificate');
    expect(guidance).toContain('certificate verify failed');
    expect(guidance).toContain('certificate pinning');
  });
});

