import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { AppProviders } from '@/app/providers';
import { router } from '@/app/router';
import { useMasterAuthStore, useUserAuthStore } from '@/store';
import { runtimeConfig } from '@/app/config/runtime';
import './index.css';

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

  // Update the Zustand in-memory store directly (works outside React).
  const isUser = window.location.pathname.startsWith('/user');
  if (isUser) {
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
