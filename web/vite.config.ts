import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// User-edition Vite config. The master-edition build composes this user
// slice with its own master pages — see the private aikey-control-master
// repo for that wiring (it imports user pages via npm dep + adds master
// pages locally).

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
  define: {
    // Compile-time auth-mode constant retained for backward compat with code
    // paths that read it. The user repo is always built in `local_bypass`
    // mode (no remote JWT auth in personal edition).
    __AIKEY_AUTH_MODE__: JSON.stringify('local_bypass'),
  },
  server: {
    port: 3000,
    proxy: {
      // Proxy backend API routes to the local Go service in dev.
      '/accounts': { target: 'http://localhost:8080', changeOrigin: true },
      '/v1': { target: 'http://localhost:8080', changeOrigin: true },
      '/auth': { target: 'http://localhost:8080', changeOrigin: true },
      '/health': { target: 'http://localhost:8080', changeOrigin: true },
      '/internal': { target: 'http://localhost:8080', changeOrigin: true },
      // NOTE: '/user' is NOT proxied — it's a React SPA route, not a backend API.
    },
  },
});
