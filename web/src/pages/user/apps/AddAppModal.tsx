/**
 * Phase 4 阶段 4 — Add App modal (2026-05-25).
 *
 * Pairs with the Add App button on /user/apps. Lets users self-register a
 * third-party agent (e.g. claude-mem) without running the CLI. On success,
 * the parent swaps this modal for the TokenRevealModal which shows the
 * one-time bearer.
 *
 * Server-side invariants (enforced in commands_internal/app.rs +
 * pkg/userapi/app/handlers.go):
 *   - app_kind is ALWAYS third-party — no first-party path from the Web
 *   - follow_user_active is ALWAYS false — third-party must use the
 *     register-time snapshot of `aikey use`
 *   - FIRST_PARTY_SLUGS are rejected with I_FIRST_PARTY_SLUG_RESERVED
 *
 * So this form deliberately omits app_kind / first-party / follow toggles.
 * The user only chooses slug + name (optional) + upstreams.
 *
 * Inline unlock branch mirrors SwitchKeyModal — registration requires
 * unlock (issues a bearer + writes vault rows), so the modal handles
 * the locked state itself rather than punting to the parent.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { appsApi, type AppRegisterResponse } from '@/shared/api/user/apps';
import { importApi } from '@/shared/api/user/import';
import { ProviderMultiSelect } from '@/shared/ui/ProviderMultiSelect';

export interface AddAppModalProps {
  onClose: () => void;
  /** Called once the backend confirms the registration. Parent uses the
   *  payload to drive the TokenRevealModal. */
  onRegistered: (res: AppRegisterResponse) => void;
}

// Slug validation matches the CLI side (aikey-cli commands_app/mod.rs::validate_slug):
// 3-64 chars, leading lowercase letter, then a-z / 0-9 / hyphen. Keep this in sync
// if the CLI rule changes; the backend would reject mismatches but a friendly UX
// catches them before the network round-trip.
const SLUG_RE = /^[a-z][a-z0-9-]{2,63}$/;

/** Returns an i18n key for the violated rule, or null when the slug is
 *  valid. Caller resolves the key with t() so the message is localised.
 *  (Module-level fn has no access to the t hook, hence keys not strings.) */
function validateSlugClient(slug: string): string | null {
  if (slug === '') return 'apps.slugRequired';
  if (slug.length < 3) return 'apps.slugMinChars';
  if (slug.length > 64) return 'apps.slugMaxChars';
  if (!SLUG_RE.test(slug)) {
    return 'apps.slugShapeError';
  }
  return null;
}

export function AddAppModal({ onClose, onRegistered }: AddAppModalProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [upstreams, setUpstreams] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);

  // Inline unlock state — same shape as SwitchKeyModal so users don't have
  // to leave the modal and lose their form input.
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
      } else {
        setUnlockError(res.error_message || t('apps.unlockFailed'));
      }
    },
    onError: (e: Error) => setUnlockError(e.message),
  });

  const registerMut = useMutation({
    mutationFn: () =>
      appsApi.register({
        slug: slug.trim(),
        // Empty name → backend defaults to slug. Sending undefined would
        // also work but explicit empty string is clearer about intent.
        name: name.trim() === '' ? undefined : name.trim(),
        upstreams,
      }),
    onSuccess: (res) => {
      // Invalidate list so the new row appears the moment the user
      // closes the token-reveal modal.
      qc.invalidateQueries({ queryKey: ['user-apps-list'] });
      onRegistered(res);
    },
    onError: (e: Error & { code?: string }) => {
      // Surface the structured code if present so the message points the
      // user at the right fix (e.g. "pick a different slug" for the
      // reserved-slug error).
      const hint =
        e.code === 'I_FIRST_PARTY_SLUG_RESERVED'
          ? t('apps.firstPartySlugReservedHint')
          : e.code === 'I_INVALID_SLUG'
          ? t('apps.invalidSlugHint')
          : '';
      setServerError(`${e.message}${hint}`);
    },
  });

  const slugError = useMemo(() => {
    if (slug === '') return null; // don't shout before user types
    return validateSlugClient(slug);
  }, [slug]);

  const upstreamsError = upstreams.length === 0 ? t('apps.pickAtLeastOneProvider') : null;
  const canSubmit =
    !slugError &&
    slug !== '' &&
    upstreams.length > 0 &&
    !registerMut.isPending &&
    !vaultLocked &&
    vaultInitialized;

  // Reset server error when the user edits the form (gives them a clean slate).
  useEffect(() => {
    setServerError(null);
  }, [slug, name, upstreams]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const ce = validateSlugClient(slug);
    if (ce) return; // button is disabled but defend the submit handler too
    if (upstreams.length === 0) return;
    registerMut.mutate();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-app-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}
    >
      <div
        className="rounded-md border shadow-lg w-full max-w-[560px] max-h-[88vh] flex flex-col"
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
            id="add-app-title"
            className="text-base font-semibold font-mono"
            style={{ color: 'var(--foreground)' }}
          >
            {t('apps.addModalTitle')}
          </h2>
          <p
            className="text-[12px] mt-1"
            style={{ color: 'var(--muted-foreground)' }}
          >
            {t('apps.addModalDescPre')} <span className="font-mono">claude-mem</span>
            {t('apps.addModalDescSuffix')}
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
                {t('apps.unlockToRegister')}{' '}
                <code className="font-mono">aikey use</code> {t('apps.unlockToRegisterSuffix')}
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
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              {/* Slug */}
              <div>
                <label
                  htmlFor="add-app-slug"
                  className="block text-[12px] font-mono uppercase tracking-wider mb-1"
                  style={{ color: 'var(--muted-foreground)' }}
                >
                  {t('apps.slugLabel')} <span style={{ color: 'var(--destructive, #ef4444)' }}>*</span>
                </label>
                <input
                  id="add-app-slug"
                  type="text"
                  autoFocus
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="claude-mem"
                  className="w-full rounded border bg-transparent outline-none text-[13px] font-mono px-3 py-2"
                  style={{
                    color: 'var(--foreground)',
                    borderColor: slugError ? 'var(--destructive, #ef4444)' : 'var(--border)',
                  }}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={registerMut.isPending}
                />
                <div
                  className="text-[11px] mt-1"
                  style={{
                    color: slugError ? 'var(--destructive, #ef4444)' : 'var(--muted-foreground)',
                  }}
                >
                  {slugError ? t(slugError) : t('apps.slugHelp')}
                </div>
              </div>

              {/* Display name (optional) */}
              <div>
                <label
                  htmlFor="add-app-name"
                  className="block text-[12px] font-mono uppercase tracking-wider mb-1"
                  style={{ color: 'var(--muted-foreground)' }}
                >
                  {t('apps.displayNameLabel')} <span style={{ color: 'var(--muted-foreground)' }}>{t('apps.optional')}</span>
                </label>
                <input
                  id="add-app-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={slug || 'Claude Memory'}
                  className="w-full rounded border bg-transparent outline-none text-[13px] px-3 py-2"
                  style={{
                    color: 'var(--foreground)',
                    borderColor: 'var(--border)',
                  }}
                  disabled={registerMut.isPending}
                />
                <div
                  className="text-[11px] mt-1"
                  style={{ color: 'var(--muted-foreground)' }}
                >
                  {t('apps.displayNameHelp')}
                </div>
              </div>

              {/* Upstreams */}
              <div>
                <label
                  className="block text-[12px] font-mono uppercase tracking-wider mb-1"
                  style={{ color: 'var(--muted-foreground)' }}
                >
                  {t('apps.upstreamProvidersLabel')} <span style={{ color: 'var(--destructive, #ef4444)' }}>*</span>
                </label>
                <ProviderMultiSelect
                  values={upstreams}
                  onChange={setUpstreams}
                  placeholder={t('apps.pickProvidersPlaceholder')}
                  showRequired={upstreams.length === 0}
                />
                <div
                  className="text-[11px] mt-1"
                  style={{
                    color: upstreamsError ? 'var(--destructive, #ef4444)' : 'var(--muted-foreground)',
                  }}
                >
                  {upstreamsError ?? (
                    <>
                      {t('apps.useCurrentDefaultKey')}{' '}
                      <code className="font-mono">aikey use</code>{t('apps.useCurrentDefaultKeySuffix')}
                    </>
                  )}
                </div>
              </div>

              {/* Server error surfacing */}
              {serverError ? (
                <div
                  className="rounded border p-2 text-[12px] font-mono"
                  style={{
                    background: 'var(--card)',
                    color: 'var(--destructive, #ef4444)',
                    borderColor: 'var(--destructive, #ef4444)',
                  }}
                  role="alert"
                >
                  {serverError}
                </div>
              ) : null}
            </form>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-5 py-3 border-t flex items-center justify-end gap-2"
          style={{ borderColor: 'var(--border)' }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={registerMut.isPending}
            className="rounded border px-3 py-1.5 text-[12px] font-mono uppercase tracking-wider disabled:opacity-50"
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
            onClick={() => {
              if (!canSubmit) return;
              registerMut.mutate();
            }}
            disabled={!canSubmit}
            className="rounded px-3 py-1.5 text-[12px] font-mono uppercase tracking-wider disabled:opacity-50"
            style={{
              background: canSubmit ? '#ca8a04' : 'var(--secondary, #3f3f46)',
              color: canSubmit ? 'var(--primary-foreground, #18181b)' : 'var(--muted-foreground)',
            }}
          >
            {registerMut.isPending ? t('apps.registering') : t('apps.register')}
          </button>
        </div>
      </div>
    </div>
  );
}
