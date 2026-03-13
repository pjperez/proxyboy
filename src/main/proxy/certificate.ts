import * as forge from 'node-forge';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export class CertificateManager {
  private caKeyPath: string;
  private caCertPath: string;
  private caKey: forge.pki.PrivateKey | null = null;
  private caCert: forge.pki.Certificate | null = null;

  constructor(customDir?: string) {
    const certsDir = customDir || path.join(app.getPath('userData'), 'certs');
    if (!fs.existsSync(certsDir)) {
      fs.mkdirSync(certsDir, { recursive: true });
    }
    this.caKeyPath = path.join(certsDir, 'proxyboy-ca.key.pem');
    this.caCertPath = path.join(certsDir, 'proxyboy-ca.cert.pem');
  }

  async initialize(): Promise<void> {
    if (fs.existsSync(this.caKeyPath) && fs.existsSync(this.caCertPath)) {
      this.loadExisting();
    } else {
      this.generateNew();
    }
  }

  private loadExisting(): void {
    const keyPem = fs.readFileSync(this.caKeyPath, 'utf8');
    const certPem = fs.readFileSync(this.caCertPath, 'utf8');
    this.caKey = forge.pki.privateKeyFromPem(keyPem);
    this.caCert = forge.pki.certificateFromPem(certPem);
  }

  private generateNew(): void {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();

    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

    const attrs = [
      { name: 'commonName', value: 'ProxyBoy CA' },
      { name: 'organizationName', value: 'ProxyBoy' },
      { name: 'countryName', value: 'US' },
    ];

    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([
      { name: 'basicConstraints', cA: true },
      { name: 'keyUsage', keyCertSign: true, digitalSignature: true, cRLSign: true },
      { name: 'subjectKeyIdentifier' },
    ]);

    cert.sign(keys.privateKey, forge.md.sha256.create());

    this.caKey = keys.privateKey;
    this.caCert = cert;

    fs.writeFileSync(this.caKeyPath, forge.pki.privateKeyToPem(keys.privateKey));
    fs.writeFileSync(this.caCertPath, forge.pki.certificateToPem(cert));
  }

  getCaCertPath(): string {
    return this.caCertPath;
  }

  getCaKeyPath(): string {
    return this.caKeyPath;
  }

  getSslCaDir(): string {
    return path.dirname(this.caCertPath);
  }
}
