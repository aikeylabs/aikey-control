import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { renderBlockingEntry } from './vite-plugin-render-blocking-entry';

// User-edition Vite config.

// Backend the dev proxy forwards to. Default preserves the historical value.
const API_TARGET = process.env.AIKEY_API_TARGET || 'http://localhost:8080';

export default defineConfig({
  plugins: [react(), renderBlockingEntry()],
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
      //
      // 2026-09-04: honour AIKEY_API_TARGET, matching master/web. The target was
      // hardcoded here, so pointing this console at a local-server on any port
      // other than 8080 silently did nothing — every request went to 8080 and
      // the page rendered as if the backend were down. The DEFAULT is unchanged,
      // so existing setups behave exactly as before.
      ...Object.fromEntries(
        ['/accounts', '/v1', '/auth', '/health', '/internal'].map((p) => [
          p,
          { target: API_TARGET, changeOrigin: true },
        ]),
      ),
      // NOTE: '/user' is NOT proxied — it's a React SPA route, not a backend API.
    },
  },
});
