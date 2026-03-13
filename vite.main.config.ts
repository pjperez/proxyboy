import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  resolve: {
    conditions: ['node'],
  },
  build: {
    rollupOptions: {
      external: ['@github/copilot-sdk'],
    },
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/sql.js/dist/sql-wasm.wasm',
          dest: '.',
        },
      ],
    }),
  ],
});
