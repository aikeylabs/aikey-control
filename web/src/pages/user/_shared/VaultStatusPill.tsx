/**
 * VaultStatusPill — compact header chip surfacing vault lock state on
 * pages where some operations require unlock (Phase 4 Connected Apps).
 *
 * Why this component:
 *   - The Apps list / detail pages are READ-FREE (list/get don't require
 *     unlock per 2026-05-21 policy), so they have no "vault is locked"
 *     error to fall back on. Without a proactive surface, users only
 *     learn vault is locked when they click Pause/Revoke/Switch Key and
 *     get a 401.
 *   - Adding a full UnlockBanner (à la /user/vault) is overkill here —
 *     vault is a prerequisite, not the subject of the page.
 *
 * Visual rules (per 2026-05-22 yellow-tone alignment):
 *   - LOCKED  → bright yellow (#facc15) — the only place on the page
 *               that uses bright yellow; reserved for the unlock action
 *               to keep visual attention.
 *   - UNLOCKED → muted; just a small countdown so the user knows session
 *               state without being distracted.
 *
 * Click on locked pill → inline password prompt (no modal, no nav).
 * On success: invalidates `['vault-status']`, plus any queryKeys passed
 * via `invalidateOnUnlock` (so the caller can refresh its own data if
 * unlocking unblocks something visually — e.g. routing buttons).
 *
 * NOT included here (kept inline in /user/vault):
 *   - First-run "Set Master Password" flow. If the vault isn't even
 *     initialized, this pill renders nothing and a small "Initialize
 *     vault first" hint — sending the user to /user/vault to do that
 *     once. Apps page isn't the right place for first-run UX.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { importApi } from '@/shared/api/user/import';

export interface VaultStatusPillProps {
  /** Extra queryKeys to invalidate after a successful unlock. */
  invalidateOnUnlock?: readonly unknown[][];
}

export function VaultStatusPill({ invalidateOnUnlock }: VaultStatusPillProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data: status, refetch } = useQuery({
    queryKey: ['vault-status'],
    queryFn: importApi.vaultStatus,
    refetchInterval: 10_000,
    staleTime: 0,
  });

  const unlocked = Boolean(status?.unlocked);
  const initialized = status?.initialized ?? true;
  const ttl = status?.ttl_seconds ?? null;

  // Local countdown — same approach as UnlockBanner: tick once per
  // second without dragging the parent's render. Reset whenever the
  // upstream ttl changes (after unlock, after a mutation extends it).
  const [remaining, setRemaining] = useState<number | null>(ttl);
  useEffect(() => {
    setRemaining(ttl);
  }, [ttl]);
  useEffect(() => {
    if (!unlocked || remaining === null) return;
    const id = setInterval(() => {
      setRemaining((s) => (s === null || s <= 0 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [unlocked, remaining === null]);

  const [expanded, setExpanded] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const unlockMut = useMutation({
    mutationFn: importApi.vaultUnlock,
    onSuccess: (res) => {
      if (res.status === 'ok' && res.unlocked) {
        setPassword('');
        setError(null);
        setExpanded(false);
        refetch();
        qc.invalidateQueries({ queryKey: ['vault-status'] });
        invalidateOnUnlock?.forEach((key) =>
          qc.invalidateQueries({ queryKey: key }),
        );
      } else {
        setError(res.error_message || t('shared.unlockFailed'));
      }
    },
    onError: (e: Error) => setError(e.message),
  });

  // ── Branch: vault not initialised yet ────────────────────────────────
  if (!initialized) {
    return (
      <a
        href="/user/vault"
        className="inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider"
        style={{
          background: 'transparent',
          color: 'var(--muted-foreground)',
          borderColor: 'var(--border)',
          textDecoration: 'none',
        }}
        title={t('shared.vaultNotInitialisedTitle')}
      >
        {t('shared.vaultNotSetSetUp')}
      </a>
    );
  }

  // ── Branch: unlocked ─────────────────────────────────────────────────
  if (unlocked) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-[11px] font-mono"
        style={{
          background: 'transparent',
          color: 'var(--muted-foreground)',
          borderColor: 'var(--border)',
        }}
        title={t('shared.vaultUnlockedTitle')}
      >
        {t('shared.vaultUnlocked')}
        {remaining !== null ? ` · ${fmtTtl(remaining)}` : ''}
      </span>
    );
  }

  // ── Branch: locked + collapsed ───────────────────────────────────────
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider"
        style={{
          background: '#facc15',
          color: '#18181b',
          border: '1px solid #facc15',
        }}
      >
        {t('shared.vaultLockedUnlock')}
      </button>
    );
  }

  // ── Branch: locked + expanded (inline password prompt) ───────────────
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!password) return;
        unlockMut.mutate({ password });
      }}
      className="inline-flex items-center gap-1.5 rounded border px-2 py-1"
      style={{
        background: 'var(--card)',
        borderColor: '#facc15',
      }}
    >
      <input
        type="password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={t('shared.masterPasswordPlaceholder')}
        className="bg-transparent outline-none text-[12px] font-mono px-1 py-0.5 w-44"
        style={{ color: 'var(--foreground)' }}
        disabled={unlockMut.isPending}
      />
      <button
        type="submit"
        disabled={!password || unlockMut.isPending}
        className="rounded px-2 py-0.5 text-[11px] font-mono uppercase tracking-wider disabled:opacity-50"
        style={{
          background: '#facc15',
          color: '#18181b',
        }}
      >
        {unlockMut.isPending ? '…' : t('shared.unlock')}
      </button>
      <button
        type="button"
        onClick={() => {
          setExpanded(false);
          setPassword('');
          setError(null);
        }}
        className="rounded px-2 py-0.5 text-[11px] font-mono uppercase tracking-wider"
        style={{
          background: 'transparent',
          color: 'var(--muted-foreground)',
        }}
      >
        ×
      </button>
      {error ? (
        <span
          className="text-[11px] font-mono ml-1"
          style={{ color: 'var(--destructive, #ef4444)' }}
        >
          {error}
        </span>
      ) : null}
    </form>
  );
}

function fmtTtl(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
