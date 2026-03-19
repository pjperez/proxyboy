const SSL_PINNING_ERROR_CODES = new Set([
  'ERR_CERT_AUTHORITY_INVALID',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_SIGNATURE_FAILURE',
  'CERTIFICATE_VERIFY_FAILED',
]);

const SSL_PINNING_MESSAGE_PATTERNS = [
  'certificate verify failed',
  'unable to verify the first certificate',
  'self signed certificate in certificate chain',
  'self-signed certificate',
  'pinning',
  'certificate validation',
  'ssl alert certificate unknown',
];

function normalizeErrorMessage(error: unknown): string {
  if (!error) {
    return '';
  }

  if (error instanceof Error) {
    return `${error.name} ${error.message}`.trim();
  }

  return String(error);
}

export function isSuspectedSslPinningError(error: unknown): boolean {
  const message = normalizeErrorMessage(error).toLowerCase();
  if (!message) {
    return false;
  }

  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';

  if (code && SSL_PINNING_ERROR_CODES.has(code)) {
    return true;
  }

  return SSL_PINNING_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern));
}

export function buildSslPinningGuidance(error: unknown): string {
  const detail = normalizeErrorMessage(error) || 'The TLS handshake was rejected by the target app or service.';
  return [
    'ProxyBoy suspects this request failed because the client rejected the MITM certificate during TLS setup.',
    detail,
    'This usually means certificate pinning or another strict certificate trust check.',
  ].join('\n');
}

