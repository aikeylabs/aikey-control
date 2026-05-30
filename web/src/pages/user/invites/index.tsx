/**
 * Invites page — /user/invites (Phase 4F, spec §6.14.2)
 *
 * Generate / revoke anonymous install-attribution invite codes. Distinct
 * from /user/referrals which tracks email-based account referrals; the
 * Phase 4F invite system attaches NO email to the inviter, only the
 * machine's anonymous installer_id from ~/.aikey/identity.
 *
 * Privacy boundary (spec §6.14.6):
 *   - We DO NOT display a list of the user's own invite codes — there
 *     is no identity-based list endpoint on either local-api or
 *     main-site. The spec requires users to self-save their links;
 *     this page enforces that with a hard "save this link" prompt
 *     after every successful Generate.
 *   - Revoke needs the user to paste back the code they previously
 *     saved.
 */
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { PageHeader } from '@/shared/ui/PageHeader';
import { Badge } from '@/shared/ui/Badge';
import { copyText } from '@/shared/utils/clipboard';
import { inviteLocalAPI, type CreateInviteResponse } from '@/shared/api/user/invites';

interface GenerateResult {
  url: string;
  code: string;
  createdAt: string;
}

interface RevokeFeedback {
  variant: 'green' | 'yellow' | 'red' | 'neutral';
  text: string;
}

export default function UserInvitesPage() {
  const { t } = useTranslation();
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [latest, setLatest] = useState<GenerateResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const [revokeInput, setRevokeInput] = useState('');
  const [revoking, setRevoking] = useState(false);
  const [revokeFeedback, setRevokeFeedback] = useState<RevokeFeedback | null>(null);

  async function handleGenerate() {
    // User-gesture requirement (spec §6.14.2): this button is the
    // ONLY entry point — no programmatic / auto-fire trigger.
    setGenerating(true);
    setGenerateError(null);
    setCopied(false);
    setAcknowledged(false);
    try {
      const resp: CreateInviteResponse = await inviteLocalAPI.create({});
      setLatest({ url: resp.url, code: resp.code, createdAt: resp.created_at });
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : t('invites.unknownError'));
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy() {
    if (!latest) return;
    await copyText(latest.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleRevoke() {
    const code = revokeInput.trim();
    if (!code) return;
    setRevoking(true);
    setRevokeFeedback(null);
    try {
      const resp = await inviteLocalAPI.revoke(code);
      switch (resp.status) {
        case 'revoked':
          setRevokeFeedback({ variant: 'green', text: t('invites.revokedToast', { code }) });
          setRevokeInput('');
          break;
        case 'not_found':
          setRevokeFeedback({ variant: 'yellow', text: t('invites.codeNotFound') });
          break;
        case 'forbidden':
          setRevokeFeedback({ variant: 'red', text: t('invites.codeForbidden') });
          break;
        default:
          setRevokeFeedback({ variant: 'neutral', text: resp.message ?? t('invites.unexpectedStatus', { status: resp.status }) });
      }
    } catch (err) {
      setRevokeFeedback({
        variant: 'red',
        text: err instanceof Error ? err.message : t('invites.revokeFailed'),
      });
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <PageHeader
        title={t('invites.pageTitle')}
        description={t('invites.pageDescription')}
      />

      {/* Generate card */}
      <div
        className="rounded border p-6 relative overflow-hidden"
        style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
      >
        <div
          className="absolute top-0 left-0 w-1 h-full"
          style={{ backgroundColor: 'var(--primary-dim)', boxShadow: '0 0 10px rgba(202, 138, 4, 0.5)' }}
        />
        <h2 className="text-xs font-mono font-bold tracking-wider uppercase mb-3" style={{ color: 'var(--muted-foreground)' }}>
          {t('invites.generateHeading')}
        </h2>
        <p className="text-xs font-mono mb-4" style={{ color: 'var(--muted-foreground)', lineHeight: 1.6 }}>
          <Trans
            i18nKey="invites.generateBody"
            components={{
              strong: <strong style={{ color: 'var(--foreground)' }} />,
            }}
          />
        </p>

        <button
          onClick={handleGenerate}
          disabled={generating}
          className="btn btn-outline text-[11px] px-4 py-2"
          style={{
            // Dim-amber outline button — same single-source-of-truth
            // token (--primary-dim) as the topbar divider, trust-check
            // Run checks button, and the left-rail accent above on this
            // same card. Bright --primary reserved for hover/active.
            color: 'var(--primary-dim)',
            borderColor: 'rgba(202, 138, 4, 0.4)',
            opacity: generating ? 0.6 : 1,
          }}
        >
          {generating ? t('invites.generating') : t('invites.generateButton')}
        </button>

        {generateError ? (
          <div
            className="mt-4 rounded border p-3 text-xs font-mono"
            style={{ color: '#f87171', borderColor: 'rgba(248,113,113,0.4)', backgroundColor: 'rgba(248,113,113,0.05)' }}
          >
            {generateError}
          </div>
        ) : null}

        {latest ? (
          <div className="mt-5 space-y-3">
            <div
              className="rounded border p-3 flex items-center justify-between gap-3"
              style={{ backgroundColor: 'rgba(0,0,0,0.3)', borderColor: 'var(--border)' }}
            >
              <code
                className="text-xs font-mono truncate flex-1"
                style={{ color: 'var(--primary)' }}
                data-testid="invite-url"
              >
                {latest.url}
              </code>
              <button
                onClick={handleCopy}
                className="btn btn-outline text-[10px] px-3 py-1.5 flex-shrink-0"
                style={{
                  color: copied ? '#4ade80' : 'var(--foreground)',
                  borderColor: copied ? 'rgba(74,222,128,0.3)' : 'var(--border)',
                }}
              >
                {copied ? t('invites.copied') : t('invites.copyLink')}
              </button>
            </div>

            <div
              className="rounded border p-3 text-xs font-mono"
              style={{
                color: '#facc15',
                borderColor: 'rgba(250,204,21,0.4)',
                backgroundColor: 'rgba(250,204,21,0.05)',
                lineHeight: 1.6,
              }}
            >
              <Trans
                i18nKey="invites.saveLinkWarning"
                values={{ code: latest.code }}
                components={{
                  strong: <strong />,
                  code: <code className="px-1 rounded" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }} />,
                }}
              />
              {!acknowledged ? (
                <div className="mt-2">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      onChange={(e) => setAcknowledged(e.target.checked)}
                    />
                    <span>{t('invites.savedLinkLabel')}</span>
                  </label>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* Revoke card */}
      <div
        className="rounded border p-6"
        style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
      >
        <h2 className="text-xs font-mono font-bold tracking-wider uppercase mb-3" style={{ color: 'var(--muted-foreground)' }}>
          {t('invites.revokeHeading')}
        </h2>
        <p className="text-xs font-mono mb-4" style={{ color: 'var(--muted-foreground)', lineHeight: 1.6 }}>
          {t('invites.revokeBody')}
        </p>

        <div className="flex gap-2">
          <input
            type="text"
            value={revokeInput}
            onChange={(e) => setRevokeInput(e.target.value)}
            placeholder={t('invites.revokePlaceholder')}
            disabled={revoking}
            className="flex-1 rounded border px-3 py-2 text-xs font-mono"
            style={{
              backgroundColor: 'rgba(0,0,0,0.3)',
              borderColor: 'var(--border)',
              color: 'var(--foreground)',
            }}
          />
          <button
            onClick={handleRevoke}
            disabled={revoking || !revokeInput.trim()}
            className="btn btn-outline text-[11px] px-4 py-2"
            style={{
              color: '#f87171',
              borderColor: 'rgba(248,113,113,0.4)',
              opacity: revoking || !revokeInput.trim() ? 0.6 : 1,
            }}
          >
            {revoking ? t('invites.revoking') : t('invites.revokeButton')}
          </button>
        </div>

        {revokeFeedback ? (
          <div className="mt-3">
            <Badge variant={revokeFeedback.variant}>
              {revokeFeedback.text}
            </Badge>
          </div>
        ) : null}
      </div>

      {/* Privacy note */}
      <div className="text-[10px] font-mono" style={{ color: 'var(--muted-foreground)', lineHeight: 1.6 }}>
        <Trans
          i18nKey="invites.privacyNote"
          components={{
            code: <code className="px-1 rounded" style={{ backgroundColor: 'var(--muted)' }} />,
          }}
        />
      </div>
    </div>
  );
}
