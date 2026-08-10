import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('electron', () => ({
  app: { getPath: () => path.join(os.tmpdir(), 'proxyboy-cert-test') },
}));

// execFile is promisified at module load in certificate.ts, so we must mock
// child_process before importing the module under test. The mock impl is
// re-pointed per test via mockExecFile.mockImplementation(...).
const mockExecFile = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
}));

import { CertificateManager } from './certificate';

describe('CertificateManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-cert-'));
    mockExecFile.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('creates the certs directory if it does not exist', () => {
      const certsDir = path.join(tmpDir, 'nested', 'certs');
      expect(fs.existsSync(certsDir)).toBe(false);
      // eslint-disable-next-line no-new
      new CertificateManager(certsDir);
      expect(fs.existsSync(certsDir)).toBe(true);
    });

    it('does not throw when the directory already exists', () => {
      const certsDir = path.join(tmpDir, 'certs');
      fs.mkdirSync(certsDir, { recursive: true });
      expect(() => new CertificateManager(certsDir)).not.toThrow();
    });
  });

  describe('paths', () => {
    it('getSslCaDir returns the configured directory', () => {
      const mgr = new CertificateManager(tmpDir);
      expect(mgr.getSslCaDir()).toBe(tmpDir);
    });

    it('getCaCertPath points at certs/ca.pem inside the sslCaDir', () => {
      const mgr = new CertificateManager(tmpDir);
      const expected = path.join(tmpDir, 'certs', 'ca.pem');
      expect(mgr.getCaCertPath()).toBe(expected);
    });
  });

  describe('hasCaCert', () => {
    it('returns false when the CA cert file does not exist', () => {
      const mgr = new CertificateManager(tmpDir);
      expect(mgr.hasCaCert()).toBe(false);
    });

    it('returns true once the CA cert file is present', () => {
      const mgr = new CertificateManager(tmpDir);
      const certPath = mgr.getCaCertPath();
      fs.mkdirSync(path.dirname(certPath), { recursive: true });
      fs.writeFileSync(certPath, 'fake-ca-cert');
      expect(mgr.hasCaCert()).toBe(true);
    });
  });

  describe('initialize', () => {
    it('resolves without error (no-op)', async () => {
      const mgr = new CertificateManager(tmpDir);
      await expect(mgr.initialize()).resolves.toBeUndefined();
    });
  });

  describe('installCaCertWindows', () => {
    it('fails with a helpful message when the CA cert has not been generated yet', async () => {
      const mgr = new CertificateManager(tmpDir);
      const result = await mgr.installCaCertWindows();
      expect(result.success).toBe(false);
      expect(result.message).toContain('CA certificate not found');
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it('attempts certutil and reports success when cert exists', async () => {
      const mgr = new CertificateManager(tmpDir);
      fs.mkdirSync(path.dirname(mgr.getCaCertPath()), { recursive: true });
      fs.writeFileSync(mgr.getCaCertPath(), 'fake-ca-cert');

      mockExecFile.mockImplementation((_cmd: any, _args: any, cb: any) => {
        cb(null, { stdout: 'CertUtil: -addstore command completed successfully.', stderr: '' });
      });

      const result = await mgr.installCaCertWindows();
      expect(result.success).toBe(true);
      expect(mockExecFile).toHaveBeenCalled();
    });

    it('reports cancellation when the user dismisses the security dialog', async () => {
      const mgr = new CertificateManager(tmpDir);
      fs.mkdirSync(path.dirname(mgr.getCaCertPath()), { recursive: true });
      fs.writeFileSync(mgr.getCaCertPath(), 'fake-ca-cert');

      mockExecFile.mockImplementation((_cmd: any, _args: any, cb: any) => {
        const err: any = new Error('failed');
        err.stderr = 'The operation was cancelled by the user.';
        cb(err, { stdout: '', stderr: err.stderr });
      });

      const result = await mgr.installCaCertWindows();
      expect(result.success).toBe(false);
      expect(result.message).toContain('cancelled');
    });

    it('reports a generic failure for other execFile errors', async () => {
      const mgr = new CertificateManager(tmpDir);
      fs.mkdirSync(path.dirname(mgr.getCaCertPath()), { recursive: true });
      fs.writeFileSync(mgr.getCaCertPath(), 'fake-ca-cert');

      mockExecFile.mockImplementation((_cmd: any, _args: any, cb: any) => {
        const err: any = new Error('access denied');
        err.message = 'access denied';
        cb(err, { stdout: '', stderr: '' });
      });

      const result = await mgr.installCaCertWindows();
      expect(result.success).toBe(false);
      expect(result.message).toContain('access denied');
    });
  });

  describe('isCaCertInstalled', () => {
    it('returns false when certutil verification fails', async () => {
      const mgr = new CertificateManager(tmpDir);
      mockExecFile.mockImplementation((_cmd: any, _args: any, cb: any) => {
        cb(new Error('not found'), { stdout: '', stderr: 'not found' });
      });
      expect(await mgr.isCaCertInstalled()).toBe(false);
    });

    it('returns true when certutil output contains ProxyBoy', async () => {
      const mgr = new CertificateManager(tmpDir);
      mockExecFile.mockImplementation((_cmd: any, _args: any, cb: any) => {
        cb(null, { stdout: 'ProxyBoy CA\nCertUtil: -verifystore command completed successfully.', stderr: '' });
      });
      expect(await mgr.isCaCertInstalled()).toBe(true);
    });
  });
});
