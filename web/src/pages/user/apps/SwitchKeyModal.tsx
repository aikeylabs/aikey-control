/**
 * Phase 4 阶段 3 — Switch Key modal.
 *
 * Opens from the App Detail page's Key Bindings section. Lets the user
 * pick a vault credential to bind to ONE upstream provider for ONE app.
 *
 * Why scoped per-upstream: each upstream (anthropic / openai / kimi)
 * needs its own binding, so the picker is single-upstream by design.
 * The modal doesn't expose a "switch all" because the keys aren't
 * interchangeable across providers.
 *
 * MVP key source coverage:
 *   - Personal vault aliases (vaultApi.list, target='personal')
 *
 * Future (deferred to a follow-up turn so this PR stays scoped):
 *   - OAuth accounts (target='oauth') — needs filtering by provider_code
 *   - Team-managed virtual keys — needs the team-keys API; B-side data
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { appsApi } from '@/shared/api/user/apps';
import { importApi } from '@/shared/api/user/import';
import { vaultApi } from '@/shared/api/user/vault';

export interface SwitchKeyModalProps {
  slug: string;
  upstream: string;
  /** Current binding ref so we can pre-select it in the picker. */
  currentKeyRef?: string;
  onClose: () => void;
  /** Called after a successful switch — caller invalidates queries. */
  onSwitched?: () => void;
}

interface CandidateRow {
  id: string;          // vault record id (== alias for personal)
  label: string;       // user-friendly display
  source: 'personal'; // MVP: personal only; OAuth/team later
  ref: string;         // value sent as key_source_ref
  detail?: string;     // small subline (e.g., last-4 of secret)
}

export function SwitchKeyModal({
  slug,
  upstream,
  currentKeyRef,
  onClose,
  onSwitched,
}: SwitchKeyModalProps) {
  const qc = useQueryClient();
  const [selectedRef, setSelectedRef] = useState<string | undefined>(currentKeyRef);

  // Mini-unlock state (only used in the locked branch — kept at the top
  // level so the unlock mutation invalidates the vault list query and
  // the modal re-renders into the picker branch automatically).
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);

  const vaultStatusQuery = useQuery({
    queryKey: ['vault-status'],
    queryFn: importApi.vaultStatus,
    refetchInterval: 10_000,
    staleTime: 0,
  });
  const vaultLocked = !vaultStatusQuery.data?.unlocked;
  const vaultInitialized = vaultStatusQuery.data?.initialized ?? true;

  const unlockMut = useMutation({
    mutationFn: importApi.vaultUnlock,
    onSuccess: (res) => {
      if (res.status === 'ok' && res.unlocked) {
        setUnlockPassword('');
        setUnlockError(null);
        qc.invalidateQueries({ queryKey: ['vault-status'] });
        qc.invalidateQueries({ queryKey: ['user-vault-list-for-switch'] });
      } else {
        setUnlockError(res.error_message || 'unlock failed');
      }
    },
    onError: (e: Error) => setUnlockError(e.message),
  });

  // Fetch vault records; we filter to those whose provider matches the
  // upstream. The vault list endpoint returns personal + OAuth merged,
  // but for MVP we limit to personal rows (see file header).
  //
  // Disabled while vault is locked — vault.list requires unlock and
  // would just 401. We render the inline unlock branch instead.
  const vaultQuery = useQuery({
    queryKey: ['user-vault-list-for-switch'],
    queryFn: vaultApi.list,
    enabled: !vaultLocked,
  });

  const candidates = useMemo<CandidateRow[]>(() => {
    const records = vaultQuery.data?.records ?? [];
    const out: CandidateRow[] = [];
    for (const r of records) {
      if (r.target !== 'personal') continue;
      // Personal records carry `provider_code` (the canonical short
      // form, e.g. "anthropic"). The CLI side stores upstream by the
      // same canonical short form (handled by oauth_provider_to_canonical
      // at write time), so a direct equality check suffices.
      if (r.provider_code !== upstream) continue;
      out.push({
        id: r.id,
        label: r.alias,
        source: 'personal',
        ref: r.alias,
        detail: r.secret_suffix
          ? `personal · …${r.secret_suffix}`
          : 'personal',
      });
    }
    return out;
  }, [vaultQuery.data, upstream]);

  const switchM = useMutation({
    mutationFn: () => {
      if (!selectedRef) {
        return Promise.reject(new Error('Select a key first'));
      }
      return appsApi.route({
        slug,
        upstream,
        key_source_type: 'personal',
        key_source_ref: selectedRef,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-apps-list'] });
      qc.invalidateQueries({ queryKey: ['user-apps-detail', slug] });
      onSwitched?.();
      onClose();
    },
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="switch-key-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}
    >
      <div
        className="rounded-md border shadow-lg w-full max-w-[540px] max-h-[80vh] flex flex-col"
        style={{
          background: 'var(--card)',
          borderColor: 'var(--border)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-5 py-4 border-b"
          style={{ borderColor: 'var(--border)' }}
        >
          <h2
            id="switch-key-title"
            className="text-base font-semibold font-mono"
            style={{ color: 'var(--foreground)' }}
          >
            Switch upstream key — <span style={{ color: '#ca8a04' }}>{upstream}</span>
          </h2>
          <p
            className="text-[12px] mt-1"
            style={{ color: 'var(--muted-foreground)' }}
          >
            App: <span className="font-mono">{slug}</span>. The new binding applies to the next request the agent makes.
          </p>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto flex-1">
          {!vaultInitialized ? (
            <div
              className="rounded border p-4 text-[13px]"
              style={{
                background: 'var(--secondary, #3f3f46)',
                borderColor: 'var(--border)',
                color: 'var(--muted-foreground)',
              }}
            >
              Vault not initialised yet. Open{' '}
              <a
                href="/user/vault"
                className="underline"
                style={{ color: 'var(--foreground)' }}
              >
                /user/vault
              </a>{' '}
              to set a master password first, then come back here.
            </div>
          ) : vaultLocked ? (
            <div
              className="rounded border p-4"
              style={{
                background: 'var(--card)',
                borderColor: '#facc15',
              }}
            >
              <div
                className="font-mono text-[12px] uppercase tracking-wider mb-2"
                style={{ color: '#facc15' }}
              >
                Vault locked
              </div>
              <p
                className="text-[12px] mb-3"
                style={{ color: 'var(--muted-foreground)' }}
              >
                Unlock the vault to list your saved keys and switch the
                binding for{' '}
                <span className="font-mono" style={{ color: 'var(--foreground)' }}>
                  {upstream}
                </span>
                .
              </p>
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!unlockPassword) return;
                  unlockMut.mutate({ password: unlockPassword });
                }}
              >
                <input
                  type="password"
                  autoFocus
                  value={unlockPassword}
                  onChange={(e) => setUnlockPassword(e.target.value)}
                  placeholder="Master password"
                  className="rounded border bg-transparent outline-none text-[13px] font-mono px-2 py-1.5 flex-1"
                  style={{
                    color: 'var(--foreground)',
                    borderColor: 'var(--border)',
                  }}
                  disabled={unlockMut.isPending}
                />
                <button
                  type="submit"
                  disabled={!unlockPassword || unlockMut.isPending}
                  className="rounded px-3 py-1.5 text-[12px] font-mono uppercase tracking-wider disabled:opacity-50"
                  style={{
                    background: '#facc15',
                    color: '#18181b',
                  }}
                >
                  {unlockMut.isPending ? 'Unlocking…' : 'Unlock'}
                </button>
              </form>
              {unlockError ? (
                <div
                  className="text-[12px] font-mono mt-2"
                  style={{ color: 'var(--destructive, #ef4444)' }}
                >
                  {unlockError}
                </div>
              ) : null}
            </div>
          ) : vaultQuery.isLoading ? (
            <div
              className="text-[13px] text-center py-8"
              style={{ color: 'var(--muted-foreground)' }}
            >
              Loading vault…
            </div>
          ) : vaultQuery.isError ? (
            <div
              className="text-[13px] py-4"
              style={{ color: 'var(--destructive, #ef4444)' }}
            >
              Failed to load vault: {(vaultQuery.error as Error)?.message}
            </div>
          ) : candidates.length === 0 ? (
            <div
              className="rounded border p-4 text-[13px]"
              style={{
                background: 'var(--secondary, #3f3f46)',
                borderColor: 'var(--border)',
                color: 'var(--muted-foreground)',
              }}
            >
              No personal keys found for upstream{' '}
              <span className="font-mono" style={{ color: 'var(--foreground)' }}>
                {upstream}
              </span>
              . Add a key first via{' '}
              <span className="font-mono" style={{ color: 'var(--foreground)' }}>
                aikey add &lt;alias&gt; --provider {upstream}
              </span>{' '}
              or use the Vault page.
            </div>
          ) : (
            <div role="radiogroup" aria-label="Available keys" className="flex flex-col gap-2">
              {candidates.map((c) => {
                const checked = c.ref === selectedRef;
                return (
                  <label
                    key={c.id}
                    className="flex items-start gap-3 rounded border p-3 cursor-pointer"
                    style={{
                      background: checked ? 'var(--secondary, #3f3f46)' : 'transparent',
                      borderColor: checked ? '#ca8a04' : 'var(--border)',
                    }}
                  >
                    <input
                      type="radio"
                      name="key-pick"
                      checked={checked}
                      onChange={() => setSelectedRef(c.ref)}
                      className="mt-0.5"
                      style={{ accentColor: '#ca8a04' }}
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className="font-mono text-[13px]"
                        style={{ color: 'var(--foreground)' }}
                      >
                        {c.label}
                      </div>
                      {c.detail ? (
                        <div
                          className="text-[11px] mt-0.5 font-mono"
                          style={{ color: 'var(--muted-foreground)' }}
                        >
                          {c.detail}
                        </div>
                      ) : null}
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          {/* Explainer link */}
          <p
            className="text-[11px] mt-4"
            style={{ color: 'var(--muted-foreground)' }}
          >
            <strong>Why this matters:</strong> AiKey snapshotted your default key into a per-app binding when the app registered. Switching overrides that snapshot for this app only — other apps and the CLI continue using your global default.
          </p>
        </div>

        {/* Footer */}
        <div
          className="px-5 py-3 border-t flex items-center justify-between gap-2"
          style={{ borderColor: 'var(--border)' }}
        >
          {switchM.error ? (
            <div
              className="text-[12px] font-mono"
              style={{ color: 'var(--destructive, #ef4444)' }}
            >
              {(switchM.error as Error).message}
            </div>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border px-3 py-1.5 text-[12px] font-mono uppercase tracking-wider"
              style={{
                background: 'transparent',
                color: 'var(--foreground)',
                borderColor: 'var(--border)',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => switchM.mutate()}
              disabled={
                !selectedRef ||
                switchM.isPending ||
                selectedRef === currentKeyRef ||
                vaultLocked ||
                !vaultInitialized
              }
              title={vaultLocked ? 'Unlock vault first' : undefined}
              className="rounded px-3 py-1.5 text-[12px] font-mono uppercase tracking-wider disabled:opacity-50"
              style={{
                background: '#ca8a04',
                color: 'var(--primary-foreground, #18181b)',
              }}
            >
              {switchM.isPending ? 'Switching…' : 'Switch'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
