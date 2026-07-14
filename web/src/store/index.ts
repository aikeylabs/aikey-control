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
}

// modalShownThisSession / MODAL_SHOWN_KEY were REMOVED (2026-07-10 escalation,
// see 20260710-hook接线可见性升级.md): the once-per-session auto-pop gate let
// two clicks ("Not now" + banner Dismiss) permanently hide the fact that
// terminal auto-sync is off — keys the user activates on the Web never reach
// their CLI, silently. The modal now re-pops on EVERY eligible use/add while
// rc stays unwired; "Not now" only skips the current occurrence (the modal
// is only ever triggered by mutation onSuccess, so it cannot re-pop
// spontaneously).

export const useHookReadinessStore = create<HookReadinessState>()((set) => ({
  readiness: null,
  setReadiness: (r) => set({ readiness: r }),
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
  // Opt-out wins over everything (2026-07-10): the read-only status probe
  // reports REAL file/rc state alongside reason=aikey_no_hook, so checking
  // fileInstalled/!rcWired first would surface an almost-ready banner to a
  // user who explicitly set AIKEY_NO_HOOK=1. Silence is the contract.
  if (r.failureReason === 'aikey_no_hook') return 'disabled';
  if (r.fileInstalled && r.rcWired) return 'wired';
  if (r.fileInstalled && !r.rcWired) return 'almost-ready';
  const reason: HookFailureReason | null = r.failureReason;
  if (reason === 'shell_undetectable') return 'shell-undetectable';
  if (reason === 'home_unset') return 'env-misconfigured';
  return 'io-error';
}

/**
 * Banner persistence policy per kind (2026-07-10 escalation).
 *
 * Only `almost-ready` is non-dismissible: it is the one state the user can
 * fix with a single click (the modal's Allow), so persistence pays off
 * 100%. Environment-error kinds (shell-undetectable / env-misconfigured /
 * io-error) can't be fixed from the browser — an un-closable banner there
 * would just train users to ignore banners. `wired` / `disabled` render
 * nothing, so the flag is moot (kept true for completeness).
 *
 * Pure function, unit-tested alongside hookBannerKind.
 */
export function bannerPolicy(kind: HookBannerKind): { dismissible: boolean } {
  return { dismissible: kind !== 'almost-ready' };
}

/**
 * Whether a READ-ONLY probe result (GET /api/user/hook/status) should be
 * adopted into the store (2026-07-10, found live on a fresh dev5 VM).
 *
 * `fileInstalled=false + failureReason=null` from the probe just means the
 * hook file was never rendered — the normal pre-first-use state of a fresh
 * install. Adopting it would surface the io-error ("filesystem error")
 * banner to a user who did nothing wrong: a false alarm that trains users
 * to ignore banners. The probe abstains; the same shape arriving in a
 * MUTATION envelope stays authoritative (there it means the use-funnel's
 * Layer-1 write really failed) — mutation paths call setReadiness directly
 * and never go through this gate.
 */
export function probedReadinessIsAuthoritative(r: HookReadiness): boolean {
  return r.fileInstalled || r.failureReason !== null;
}
