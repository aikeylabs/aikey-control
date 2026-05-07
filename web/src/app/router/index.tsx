import { createBrowserRouter, Navigate } from 'react-router-dom';

import { buildUserRoutes } from '@/app/routes/user';

// User-edition router — mounts user routes via the shared buildUserRoutes()
// table that's also consumed by aikey-trial-server/web's composer.

export const router = createBrowserRouter([
  // Default redirect: open the user overview.
  { path: '/', element: <Navigate to="/user/overview" replace /> },

  ...buildUserRoutes(),
]);
