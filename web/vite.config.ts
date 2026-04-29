import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Why physical stub-aliasing for master paths (2026-04-22):
//
// Earlier iteration moved master-page imports into `buildMasterRoutes()` and
// relied on `if (isUserOnlyBuild) return []` + DCE to drop them. That DOES
// remove master code from the main bundle but Rollup still walks every
// `import('@/pages/master/...')` expression for chunk-graph analysis BEFORE
// the DCE pass, so master chunks (AppShell-*.js, dashboard pages, etc.)
// were still emitted into dist/ — just never fetched at runtime.
//
// To actually keep master source out of the shipped artifact, we alias each
// master module path to `src/stubs/empty-master.tsx` when VITE_AUTH_MODE is
// `local_bypass`. Rollup then resolves the dynamic imports to that tiny
// stub file; tree-shaking collapses the stub to near-zero bytes in the
// emitted chunks (the routes are never mounted anyway).
//
// Scope discipline — we alias ONLY:
//   * `@/pages/master/*`  (master page components; regex pattern)
//   * `@/layouts/AppShell` (master-shell layout)
// but NOT:
//   * `@/shared/api/master/*` — these are API DTOs that user pages import
//     for adapter typing; redirecting them would break the user app.
const IS_USER_ONLY = process.env.VITE_AUTH_MODE === 'local_bypass';
const MASTER_STUB = path.resolve(__dirname, './src/stubs/empty-master.tsx');

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // Specific-path master aliases MUST come before the generic `@` alias
      // so Vite picks them up first.
      ...(IS_USER_ONLY
        ? [
            { find: /^@\/pages\/master\/.*$/, replacement: MASTER_STUB },
            { find: '@/layouts/AppShell', replacement: MASTER_STUB },
          ]
        : []),
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
  define: {
    // Expose build-time auth mode for tree-shaking master routes in user-only build.
    // Values: 'jwt' (default, full build) or 'local_bypass' (user-only build).
    __AIKEY_AUTH_MODE__: JSON.stringify(process.env.VITE_AUTH_MODE || 'jwt'),
  },
  server: {
    port: 3000,
    proxy: {
      // Proxy all backend API routes to the Go service.
      // This avoids CORS issues and mirrors the production same-origin setup.
      '/accounts': { target: 'http://localhost:8080', changeOrigin: true },
      '/orgs': { target: 'http://localhost:8080', changeOrigin: true },
      '/providers': { target: 'http://localhost:8080', changeOrigin: true },
      '/virtual-keys': { target: 'http://localhost:8080', changeOrigin: true },
      '/dashboard': { target: 'http://localhost:8080', changeOrigin: true },
      // All /v1/* routes → control service (usage facade proxies internally to query-service)
      '/v1': { target: 'http://localhost:8080', changeOrigin: true },
      '/auth': { target: 'http://localhost:8080', changeOrigin: true },
      '/health': { target: 'http://localhost:8080', changeOrigin: true },
      // NOTE: '/user' is NOT proxied — it is a React SPA route, not a backend API.
      '/internal': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
});
