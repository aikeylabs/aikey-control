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
 * Key source coverage (2026-05-25 expanded to all three sources):
 *   - Personal vault aliases (vault.list, target='personal'), matched by
 *     `provider_code === upstream`. key_source_type = 'personal',
 *     key_source_ref = alias.
 *   - OAuth accounts (vault.list, target='oauth'), matched by
 *     `protocol_family === upstream` (the canonical post-mapping value;
 *     broker-vocabulary `provider` like "claude"/"codex" is irrelevant
 *     here because CLI side stores upstream by canonical short form).
 *     key_source_type = 'personal_oauth_account',
 *     key_source_ref = provider_account_id.
 *   - Team-managed virtual keys (delivery.allKeys, filtered by
 *     `provider_code === upstream` AND `key_status === 'active'`).
 *     key_source_type = 'managed_virtual_key', key_source_ref =
 *     virtual_key_id. Team-keys query gracefully no-ops on Personal
 *     edition (no team backend) — empty result simply omits team
 *     candidates from the picker.
 *
 * Each source is bucketed in the picker (Personal / OAuth / Team) so the
 * user sees groupings rather than a flat list mixing types.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { appsApi, type KeySourceType } from '@/shared/api/user/apps';
import { deliveryApi } from '@/shared/api/user/delivery';
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
  id: string;                                  // vault record id (alias / provider_account_id / virtual_key_id)
  label: string;                               // user-friendly display
  source: 'personal' | 'oauth' | 'team';       // drives key_source_type at switch time
  ref: string;                                 // value sent as key_source_ref
  detail?: string;                             // small subline (e.g., last-4 / oauth identity / team alias)
}

export function SwitchKeyModal({
  slug,
  upstream,
  currentKeyRef,
  onClose,
  onSwitched,
}: SwitchKeyModalProps) {
  const { t } = useTranslation();
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
        setUnlockError(res.error_message || t('apps.unlockFailed'));
      }
    },
    onError: (e: Error) => setUnlockError(e.message),
  });

  // Fetch vault records; the list endpoint returns merged
  // personal + oauth (+ team but team is out of scope here). Filter per
  // upstream by the matching field for each target type:
  //   - personal → provider_code
  //   - oauth    → protocol_family
  // Both are canonical short forms (CLI normalises via
  // oauth_provider_to_canonical at write time), so direct equality holds.
  //
  // Disabled while vault is locked — vault.list requires unlock and
  // would just 401. We render the inline unlock branch instead.
  const vaultQuery = useQuery({
    queryKey: ['user-vault-list-for-switch'],
    queryFn: vaultApi.list,
    enabled: !vaultLocked,
  });

  // Team-managed virtual keys live on a separate API (not vault.list).
  // On Personal edition the backend has no team server so this 404s
  // (or returns empty) — caught by retry: false + the error branch
  // simply contributes zero candidates. We don't surface an error
  // banner for a graceful-empty case.
  const teamKeysQuery = useQuery({
    queryKey: ['user-team-keys-for-switch'],
    queryFn: deliveryApi.allKeys,
    enabled: !vaultLocked,
    retry: false,
  });

  const candidates = useMemo<CandidateRow[]>(() => {
    const records = vaultQuery.data?.records ?? [];
    const out: CandidateRow[] = [];
    for (const r of records) {
      if (r.target === 'personal') {
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
        continue;
      }
      if (r.target === 'oauth') {
        if (r.protocol_family !== upstream) continue;
        // Label: prefer effective alias (local_alias || display_identity);
        // fall back to provider_account_id when neither is present (very
        // old vault rows with no email captured).
        const label = r.alias ?? r.display_identity ?? r.provider_account_id;
        // Detail line surfaces the upstream identity (typically email)
        // even when the user renamed the account, so two OAuth accounts
        // with similar local labels stay distinguishable.
        const identity = r.display_identity ?? r.provider_account_id;
        const detail = r.alias && r.alias !== identity
          ? `oauth · ${identity}`
          : `oauth · ${r.provider} · ${r.account_tier ?? 'tier-?'}`;
        out.push({
          id: r.id,
          label,
          source: 'oauth',
          ref: r.provider_account_id,
          detail,
        });
        continue;
      }
      // r.target === 'team' is intentionally ignored here — team keys
      // come from deliveryApi.allKeys below, not vault.list.
    }
    // Team-managed virtual keys. Filter by exact provider_code match
    // (canonical short form, same as personal). Skip non-active VKs —
    // expired/revoked keys would just 401 at request time, no point
    // letting the user pick them.
    const teamKeys = teamKeysQuery.data ?? [];
    for (const k of teamKeys) {
      if (k.provider_code !== upstream) continue;
      if (k.key_status !== 'active') continue;
      out.push({
        id: k.virtual_key_id,
        label: k.alias,
        source: 'team',
        ref: k.virtual_key_id,
        detail: `team · vk:${k.virtual_key_id.slice(0, 8)}…`,
      });
    }
    return out;
  }, [vaultQuery.data, teamKeysQuery.data, upstream]);

  const switchM = useMutation({
    mutationFn: () => {
      if (!selectedRef) {
        return Promise.reject(new Error(t('apps.selectKeyFirst')));
      }
      // Derive key_source_type from the chosen candidate's source so
      // OAuth and team selections write the correct discriminator (the
      // resolver uses this to know which vault table to read at runtime).
      const selectedCand = candidates.find((c) => c.ref === selectedRef);
      const keySourceType: KeySourceType =
        selectedCand?.source === 'oauth'
          ? 'personal_oauth_account'
          : selectedCand?.source === 'team'
          ? 'managed_virtual_key'
          : 'personal';
      return appsApi.route({
        slug,
        upstream,
        key_source_type: keySourceType,
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
            {t('apps.switchUpstreamKey')} — <span style={{ color: '#ca8a04' }}>{upstream}</span>
          </h2>
          <p
            className="text-[12px] mt-1"
            style={{ color: 'var(--muted-foreground)' }}
          >
            {t('apps.switchAppLabel')} <span className="font-mono">{slug}</span>{t('apps.switchAppSuffix')}
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
              {t('apps.vaultNotInitialised')}{' '}
              <a
                href="/user/vault"
                className="underline"
                style={{ color: 'var(--foreground)' }}
              >
                /user/vault
              </a>{' '}
              {t('apps.vaultNotInitialisedSuffix')}
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
                {t('apps.vaultLocked')}
              </div>
              <p
                className="text-[12px] mb-3"
                style={{ color: 'var(--muted-foreground)' }}
              >
                {t('apps.unlockToListKeys')}{' '}
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
                  placeholder={t('apps.masterPasswordPlaceholder')}
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
                  {unlockMut.isPending ? t('apps.unlocking') : t('apps.unlock')}
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
              {t('apps.loadingVault')}
            </div>
          ) : vaultQuery.isError ? (
            <div
              className="text-[13px] py-4"
              style={{ color: 'var(--destructive, #ef4444)' }}
            >
              {t('apps.failedToLoadVault')} {(vaultQuery.error as Error)?.message}
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
              {t('apps.noKeysForUpstream')}{' '}
              <span className="font-mono" style={{ color: 'var(--foreground)' }}>
                {upstream}
              </span>
              {t('apps.noKeysOptions')}
              <ul className="list-disc list-inside mt-2 space-y-0.5">
                <li>
                  {t('apps.personalApiKey')}{' '}
                  <span className="font-mono" style={{ color: 'var(--foreground)' }}>
                    aikey add &lt;alias&gt; --provider {upstream}
                  </span>
                </li>
                <li>{t('apps.oauthAccountOption')}</li>
                <li>{t('apps.teamKeyOption', { upstream })}</li>
              </ul>
            </div>
          ) : (
            <div role="radiogroup" aria-label={t('apps.availableKeysAria')} className="flex flex-col gap-2">
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
            <strong>{t('apps.whyThisMatters')}</strong> {t('apps.switchExplainer')}
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
              {t('apps.cancel')}
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
              title={vaultLocked ? t('apps.unlockVaultFirst') : undefined}
              className="rounded px-3 py-1.5 text-[12px] font-mono uppercase tracking-wider disabled:opacity-50"
              style={{
                background: '#ca8a04',
                color: 'var(--primary-foreground, #18181b)',
              }}
            >
              {switchM.isPending ? t('apps.switching') : t('apps.switch')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
