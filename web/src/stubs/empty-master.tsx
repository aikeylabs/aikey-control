/**
 * Stub for master-only modules in user-only builds.
 *
 * vite.config.ts aliases every `@/pages/master/*` path and `@/layouts/AppShell`
 * to this file when `VITE_AUTH_MODE=local_bypass`. The router's
 * `buildMasterRoutes()` returns `[]` in that mode so no route in the user
 * app ever mounts these components — the stub exists only to satisfy the
 * import graph while keeping the real master-page modules (and their
 * transitive deps) out of the build output.
 *
 * Why a real React component, not just `null`:
 *   - `React.lazy(() => import('@/layouts/AppShell').then(m => ({ default: m.AppShell })))`
 *     requires the imported module to expose a named `AppShell` export that
 *     resolves to a valid React component type.
 *   - `React.lazy(() => import('@/pages/master/dashboard'))` requires a
 *     `default` export that is a valid React component type.
 *   Using `() => null` for both keeps TypeScript happy and is the smallest
 *   possible payload when this file is aliased in. In practice the component
 *   is never rendered, so the body doesn't matter for runtime.
 */
const EmptyMaster: React.FC = () => null;

export default EmptyMaster;
export const AppShell = EmptyMaster;
