import { ProxyEngine } from '../../main/proxy/engine';
import { CertificateManager } from '../../main/proxy/certificate';
import { HttpFlow } from '../../shared/types';

export async function capture(options: { port: string; host: string }): Promise<void> {
  const port = parseInt(options.port, 10);
  const host = options.host;

  console.log(`\n  🔵 ProxyBoy — Headless Capture Mode`);
  console.log(`  ─────────────────────────────────────`);

  const certManager = new CertificateManager(process.cwd() + '/.proxyboy-certs');
  const engine = new ProxyEngine(
    { port, host, enableSsl: true },
    certManager,
  );

  let requestCount = 0;

  engine.on('flow:complete', (flow: HttpFlow) => {
    requestCount++;
    const status = flow.response?.statusCode || '---';
    const duration = flow.response?.duration ? `${flow.response.duration}ms` : '---';
    const statusColor = !flow.response ? '' :
      flow.response.statusCode < 300 ? '\x1b[32m' :
      flow.response.statusCode < 400 ? '\x1b[33m' : '\x1b[31m';
    const reset = '\x1b[0m';

    console.log(
      `  ${statusColor}${String(status).padEnd(4)}${reset} ` +
      `${flow.request.method.padEnd(7)} ` +
      `${duration.padStart(8)} ` +
      `${flow.request.url.slice(0, 80)}`
    );
  });

  engine.on('proxy:error', (error: Error) => {
    console.error(`  ❌ Proxy error: ${error.message}`);
  });

  try {
    await engine.start();
    console.log(`  ✅ Proxy listening on ${host}:${port}`);
    console.log(`  📡 Capturing HTTP/HTTPS traffic...\n`);
    console.log(`  Press Ctrl+C to stop\n`);

    process.on('SIGINT', async () => {
      console.log(`\n\n  ⏹ Stopping proxy...`);
      console.log(`  📊 Total requests captured: ${requestCount}`);
      await engine.stop();
      process.exit(0);
    });
  } catch (error: any) {
    console.error(`  ❌ Failed to start proxy: ${error.message}`);
    process.exit(1);
  }
}
