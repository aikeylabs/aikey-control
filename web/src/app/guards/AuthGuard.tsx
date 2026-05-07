import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useUserAuthStore } from '@/store';
import { runtimeConfig } from '@/app/config/runtime';

interface AuthGuardProps {
  children: React.ReactNode;
  loginPath?: string;
}

/**
 * Redirect to login if no JWT token is present.
 *
 * This is the user-edition AuthGuard. In `local_bypass` mode (personal
 * edition with no remote auth backend), /user routes are open: the
 * backend uses LocalIdentityMiddleware so no JWT is needed.
 *
 * In JWT mode (trial / production user-side login), the user store's
 * token is required — missing token redirects to `loginPath`
 * (default /user/login).
 *
 * Storage: `useUserAuthStore` is backed by localStorage key `aikey-auth-user`.
 * The master-edition admin guard (formerly inline here, now in master repo)
 * uses a separate `useMasterAuthStore` so both sessions can coexist.
 */
export function AuthGuard({ children, loginPath = '/user/login' }: AuthGuardProps) {
  const { pathname } = useLocation();

  // local_bypass: /user routes are open (personal edition).
  if (runtimeConfig.authMode === 'local_bypass') {
    return <>{children}</>;
  }

  const token = useUserAuthStore((s) => s.token);

  if (!token) {
    return <Navigate to={loginPath} state={{ from: pathname }} replace />;
  }

  return <>{children}</>;
}
