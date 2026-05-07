import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { HookReadiness, HookFailureReason } from '@/shared/api/user/vault';

// ── Org Slice ────────────────────────────────────────────────────────────────
// Declared before auth stores so clearAuth can reference useOrgStore.getState().

interface OrgState {
  currentOrgId: string | null;
  setCurrentOrgId: (id: string) => void;
}

export const useOrgStore = create<OrgState>()(
  persist(
    (set) => ({
      currentOrgId: null,
      setCurrentOrgId: (id) => set({ currentOrgId: id }),
    }),
    { name: 'aikey-org' }
  )
);

// ── Auth ────────────────────────────────────────────────────────────────────
// Master and User consoles use separate stores so both sessions can coexist
// in the same browser.  Legacy `useAuthStore` is a thin facade that reads
// from whichever store matches the current URL path.

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  setAuth: (token: string, user: AuthUser) => void;
  clearAuth: () => void;
}

export const useMasterAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      // Also wipe the persisted org selection so a re-login always starts
      // with a fresh org resolved from the server, not a stale cached ID.
      clearAuth: () => {
        set({ token: null, user: null });
        useOrgStore.getState().setCurrentOrgId('');
      },
    }),
    {
      name: 'aikey-auth-master',
      partialize: (s) => ({ token: s.token, user: s.user }),
    }
  )
);

export const useUserAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      clearAuth: () => {
        set({ token: null, user: null });
        useOrgStore.getState().setCurrentOrgId('');
      },
    }),
    {
      name: 'aikey-auth-user',
      partialize: (s) => ({ token: s.token, user: s.user }),
    }
  )
);

/**
 * Legacy facade — always calls both hooks (safe for React rules-of-hooks)
 * and returns the value from the store matching the current URL path.
 */
export function useAuthStore<T>(selector: (s: AuthState) => T): T {
  const masterVal = useMasterAuthStore(selector);
  const userVal = useUserAuthStore(selector);
  const isUser = typeof window !== 'undefined' && window.location.pathname.startsWith('/user');
  return isUser ? userVal : masterVal;
}

// ── UI Slice ────────────────────────────────────────────────────────────────

interface UIState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useUIStore = create<UIState>()((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));

// ── Hook Readiness Slice ────────────────────────────────────────────────────
//
// Hook coverage v1 (2026-04-27): Web vault/use mutations now return three
// hook-status fields (file_installed / rc_wired / failure_reason). The
// store caches the most recent values so the readiness banner can render
// across page navigations without re-fetching. Updated by every successful
// vault mutation; the banner subscribes here.
//
// NOT persisted — readiness changes whenever the user runs `aikey hook
// install` or `aikey use` from CLI, and we want the next vault response
// to refresh stale state. sessionStorage handles dismissal separately.

interface HookReadinessState {
  /** Most recent reading; null = no vault op observed yet this session. */
  readiness: HookReadiness | null;
  setReadiness: (r: HookReadiness) => void;

  /**
   * Whether the wire-rc modal has been shown (auto-popped or user-opened)
   * this browser session. Used by the page handlers to limit auto-pop to
   * the FIRST mutation that detects rc_wired=false — subsequent mutations
   * fall back to the persistent banner (whose CTA can re-open the modal
   * on demand).
   *
   * Persisted in sessionStorage under MODAL_SHOWN_KEY so a page reload
   * during the same session doesn't re-pop the modal. Clears on browser
   * session end (intentionally NOT localStorage — drift is rare but the
   * modal is the cheapest fix path for it).
   *
   * Per 20260507-web-hook-rc-modal-自动注入.md §H4.
   */
  modalShownThisSession: boolean;
  markModalShown: () => void;
}

const MODAL_SHOWN_KEY = 'aikey:hookWireRcModalShown';

function readModalShown(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(MODAL_SHOWN_KEY) === '1';
  } catch {
    return false;
  }
}

export const useHookReadinessStore = create<HookReadinessState>()((set) => ({
  readiness: null,
  setReadiness: (r) => set({ readiness: r }),
  modalShownThisSession: readModalShown(),
  markModalShown: () => {
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem(MODAL_SHOWN_KEY, '1');
      } catch {
        // sessionStorage unavailable (private mode, quota exceeded) — fall
        // through to in-memory only. Worst case: modal can re-pop within
        // this tab's lifetime, which is the prior behavior anyway.
      }
    }
    set({ modalShownThisSession: true });
  },
}));

/**
 * Distill the §2.4 banner state machine from a HookReadiness.
 * Pure function (no React hooks) so it's easy to unit test.
 *
 * Returns one of:
 *   - 'wired'              — full hook ready, no banner
 *   - 'almost-ready'       — Layer 1 ok, rc not wired (typical Web-only path)
 *   - 'shell-undetectable' — Layer 1 failed because $SHELL ≠ zsh/bash
 *   - 'env-misconfigured'  — Layer 1 failed because $HOME unset (rare;
 *                            typically containerized service env). Same
 *                            "fix the environment" remediation as
 *                            shell-undetectable, but with HOME-specific
 *                            copy so users don't waste time chmod'ing.
 *   - 'disabled'           — AIKEY_NO_HOOK=1 set, suppress banner
 *   - 'io-error'           — Layer 1 failed for a real fs/permission reason
 */
export type HookBannerKind =
  | 'wired'
  | 'almost-ready'
  | 'shell-undetectable'
  | 'env-misconfigured'
  | 'disabled'
  | 'io-error';

export function hookBannerKind(r: HookReadiness | null): HookBannerKind {
  if (!r) return 'wired';
  if (r.fileInstalled && r.rcWired) return 'wired';
  if (r.fileInstalled && !r.rcWired) return 'almost-ready';
  const reason: HookFailureReason | null = r.failureReason;
  if (reason === 'shell_undetectable') return 'shell-undetectable';
  if (reason === 'home_unset') return 'env-misconfigured';
  if (reason === 'aikey_no_hook') return 'disabled';
  return 'io-error';
}
