import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useMasterAuthStore, useUserAuthStore } from '@/store';
import { runtimeConfig } from '@/app/config/runtime';

interface AuthGuardProps {
  children: React.ReactNode;
  loginPath?: string;
}

/**
 * Redirect to login if no JWT token is present in the relevant store.
 *
 * In local_bypass mode (personal + trial editions), /user routes are open —
 * the backend uses LocalIdentityMiddleware so no JWT is needed.
 * /master routes still require admin JWT even in local_bypass mode.
 *
 * Master routes use `useMasterAuthStore` (localStorage: aikey-auth-master).
 * User routes use `useUserAuthStore` (localStorage: aikey-auth-user).
 * This allows both sessions to coexist in the same browser.
 */
export function AuthGuard({ children, loginPath = '/master/login' }: AuthGuardProps) {
  const { pathname } = useLocation();
  const isUser = pathname.startsWith('/user');

  // local_bypass: /user routes are open (personal edition has no master
  // routes at all; trial edition keeps master behind its own JWT guard).
  if (runtimeConfig.authMode === 'local_bypass' && isUser) {
    return <>{children}</>;
  }

  const masterToken = useMasterAuthStore((s) => s.token);
  const userToken = useUserAuthStore((s) => s.token);
  const token = isUser ? userToken : masterToken;

  if (!token) {
    return <Navigate to={loginPath} state={{ from: pathname }} replace />;
  }

  return <>{children}</>;
}
