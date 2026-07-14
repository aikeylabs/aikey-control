import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom';

import { buildUserRoutes } from '@/app/routes/user';
import TeamUnreachablePage from '@/pages/user/team-unreachable';

// User-edition router — mounts user routes via the shared buildUserRoutes()
// table that's also consumed by aikey-trial-server/web's composer.

// withTeamDownFallback appends a catch-all to the PROTECTED /user block (the one
// with an 'overview' child, i.e. inside UserShell) so an unmatched /user/* path
// still renders WITH the sidebar/menu.
//
// Why here and not in the shared buildUserRoutes(): the fallback is
// Personal-only. The team-down flag is injected exclusively by the Personal
// composing gateway (serveTeamDownShell) — Trial has no gateway and builds its
// own router (aikey-trial-server/web/router.tsx), so it must NOT inherit this
// catch-all. Keeping it out of the shared table is the zero-risk choice and
// mirrors Trial's own withVirtualKeysOnUser post-process technique.
//
// When the flag is present → the gateway served the local shell because the
// team server (B) was unreachable → show the in-shell "team unreachable" page
// (menu stays, only the content region degrades). When absent (a genuinely
// mistyped /user/* path) → redirect to overview, consistent with this file's
// existing legacy-path → overview convention (my-keys / pending-keys / my-seats).
function UserRouteFallback() {
  if (window.__AIKEY_TEAM_DOWN__) {
    return <TeamUnreachablePage />;
  }
  return <Navigate to="/user/overview" replace />;
}

function withTeamDownFallback(routes: RouteObject[]): RouteObject[] {
  return routes.map((r) => {
    if (
      r.path === '/user' &&
      Array.isArray(r.children) &&
      r.children.some((c) => c.path === 'overview')
    ) {
      // Cast: r is the non-index /user parent (guarded by path + overview child
      // above), but the RouteObject union's index/non-index discriminant can't
      // be narrowed through the object spread — the cast re-asserts what the
      // guard already proved.
      return {
        ...r,
        children: [...r.children, { path: '*', element: <UserRouteFallback /> }],
      } as RouteObject;
    }
    return r;
  });
}

export const router = createBrowserRouter([
  // Default redirect: open the user overview.
  { path: '/', element: <Navigate to="/user/overview" replace /> },

  ...withTeamDownFallback(buildUserRoutes()),
]);
