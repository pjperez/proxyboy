import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig((env) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': '/src/renderer',
      '@shared': '/src/shared',
    },
  },
}));
