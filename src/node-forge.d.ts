/**
 * Minimal ambient declarations for node-forge (the library ships no types).
 * Only the surface used by the gRPC integration test is declared here.
 */
declare module 'node-forge' {
  export interface ForgeCertificate {
    publicKey: unknown;
    serialNumber: string;
    validity: { notBefore: Date; notAfter: Date };
    setSubject(attrs: unknown[]): void;
    setIssuer(attrs: unknown[]): void;
    setExtensions(exts: unknown[]): void;
    sign(key: unknown, md: unknown): void;
    subject: { attributes: unknown[] };
  }
  export interface ForgeKeyPair {
    publicKey: unknown;
    privateKey: unknown;
  }
  export const pki: {
    rsa: {
      generateKeyPair(bits: number): ForgeKeyPair;
    };
    createCertificate(): ForgeCertificate;
    certificateToPem(cert: ForgeCertificate): string;
    privateKeyToPem(key: unknown): string;
  };
  export const md: {
    sha256: { create(): unknown };
  };
}
