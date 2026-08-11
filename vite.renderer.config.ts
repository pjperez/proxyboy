import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

// The main process applies a CSP via onHeadersReceived, but that header is only
// honored for http(s) responses. In production the renderer is loaded via
// `file://`, where response headers cannot be set, so we embed the CSP as a
// <meta> tag at build time. This only runs for production builds (apply: 'build');
// in development Vite's HMR needs inline scripts, which the dev-server CSP permits.
function productionCspMeta(): Plugin {
  return {
    name: 'proxyboy-production-csp',
    apply: 'build',
    transformIndexHtml(html) {
      const csp = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "connect-src 'self' ws: wss:",
        "font-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
      ].join('; ');
      return html.replace(
        '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        `<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );
    },
  };
}

export default defineConfig((env) => ({
  plugins: [react(), productionCspMeta()],
  resolve: {
    alias: {
      '@renderer': '/src/renderer',
      '@shared': '/src/shared',
    },
  },
}));
