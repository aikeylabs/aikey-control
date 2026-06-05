import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { AppProviders } from '@/app/providers';
import { router } from '@/app/router';
import { useMasterAuthStore, useUserAuthStore } from '@/store';
import { runtimeConfig } from '@/app/config/runtime';
import { resolveStoreFromPathname } from '@/app/router/go-alias';
import './index.css';
import './shared/i18n/i18n';

// ---------------------------------------------------------------------------
// Fragment auth: pick up JWT from URL hash BEFORE React mounts.
//
// `aikey web` opens the browser with  #auth_token=<jwt>
// We extract it here so Zustand + localStorage are primed before any
// component renders or AuthGuard checks.  The fragment never reaches the
// server (no access-log leak).
//
// Skipped in local_bypass mode (personal edition) — no JWT involved.
//
// IMPORTANT: We must update BOTH localStorage (for the axios interceptor)
// AND the Zustand in-memory store (for AuthGuard).  Zustand persist
// hydration happens at store creation time (import), which runs BEFORE
// this function — so writing only to localStorage would leave the
// in-memory state as null, causing a false redirect to session-expired.
//
// Store-selection (2026-06-02 bugfix): the CLI sends users to
// `/go/<alias>#auth_token=<jwt>`, which redirects to the real path via
// GoAliasRedirect. A naive `pathname.startsWith('/user')` check on the
// CURRENT pathname misclassifies `/go/*` as master because the redirect
// hasn't fired yet. Result: user JWTs wrote to the master store, leaving
// the user store empty → AuthGuard kicked the user to /user/session-expired
// (reproduced 2026-06-02). The fix resolves /go/<alias> through the same
// GO_TARGETS table the router uses, so the store choice tracks the final
// destination, not the current intermediate path. Forward-compatible: if
// future aliases point at /master/*, this still routes correctly.
// ---------------------------------------------------------------------------
(function ingestFragmentToken() {
  if (runtimeConfig.authMode === 'local_bypass') return;

  const hash = window.location.hash;
  if (!hash || !hash.includes('auth_token=')) return;

  const match = hash.match(/auth_token=([^&]+)/);
  if (!match) return;

  const token = decodeURIComponent(match[1]);
  if (!token) return;

  // Decode JWT payload to extract user info (best-effort, no verification)
  let user = { id: '', email: '', role: 'member' };
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    user = {
      id: payload.sub ?? payload.account_id ?? '',
      email: payload.email ?? '',
      role: payload.role ?? 'member',
    };
  } catch {
    // keep defaults
  }

  // Route the token to the correct store. resolveStoreFromPathname lives
  // in go-alias.tsx so its decision table stays bound to GO_TARGETS at
  // compile time (single source of truth — see godoc on the function).
  if (resolveStoreFromPathname(window.location.pathname) === 'user') {
    useUserAuthStore.getState().setAuth(token, user);
  } else {
    useMasterAuthStore.getState().setAuth(token, user);
  }

  // Clear hash so the token doesn't linger in the address bar / history
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
})();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </React.StrictMode>
);
