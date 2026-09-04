import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionKeyProviderKind } from '../session-key-capability';
import { copyText } from '../utils/clipboard';

interface SessionKeyHelpProvider {
  officialURL: string;
  cookieOrigin: string;
  cookieName: string;
  providerNameKey: string;
}

/**
 * Public discovery metadata only. Session Key values never enter this table,
 * links, clipboard helpers, or browser storage.
 */
export const SESSION_KEY_HELP_PROVIDERS: Record<SessionKeyProviderKind, SessionKeyHelpProvider> = {
  claude: {
    officialURL: 'https://claude.ai/',
    cookieOrigin: 'https://claude.ai',
    cookieName: 'sessionKey',
    providerNameKey: 'sessionKeyHelp.providerClaude',
  },
  codex: {
    officialURL: 'https://chatgpt.com/',
    cookieOrigin: 'https://chatgpt.com',
    cookieName: '__Secure-next-auth.session-token',
    providerNameKey: 'sessionKeyHelp.providerChatGPT',
  },
};

type CopyStatus = 'idle' | 'cookie_name' | 'instructions' | 'error';

export function SessionKeyHelp({ providerKind }: { providerKind: SessionKeyProviderKind }) {
  const { t } = useTranslation();
  const panelID = useId();
  const [expanded, setExpanded] = useState(false);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  const provider = SESSION_KEY_HELP_PROVIDERS[providerKind];
  const providerName = t(provider.providerNameKey);
  const instructions = t('sessionKeyHelp.instructionsText', {
    provider: providerName,
    officialURL: provider.officialURL,
    cookieOrigin: provider.cookieOrigin,
    cookieName: provider.cookieName,
  });

  const copy = async (value: string, success: CopyStatus) => {
    try {
      await copyText(value);
      setCopyStatus(success);
    } catch {
      setCopyStatus('error');
    }
  };

  const statusMessage =
    copyStatus === 'cookie_name'
      ? t('sessionKeyHelp.cookieNameCopied')
      : copyStatus === 'instructions'
        ? t('sessionKeyHelp.instructionsCopied')
        : copyStatus === 'error'
          ? t('sessionKeyHelp.copyFailed')
          : '';

  return (
    <div className="contents text-[11px] font-mono" data-session-key-help={providerKind}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelID}
        className="underline underline-offset-2"
        style={{ color: 'var(--primary-text)', background: 'transparent' }}
        onClick={() => {
          setExpanded((value) => !value);
          setCopyStatus('idle');
        }}
      >
        {t('sessionKeyHelp.trigger')}
      </button>

      {expanded && (
        <div
          id={panelID}
          className="mt-2 basis-full space-y-2 rounded border px-3 py-2 leading-relaxed"
          style={{
            color: 'var(--muted-foreground)',
            borderColor: 'var(--border)',
            background: 'rgba(var(--sink-rgb), 0.18)',
          }}
        >
          <p>{t('sessionKeyHelp.intro', { provider: providerName })}</p>
          <ol className="list-decimal space-y-1 pl-4">
            <li>{t('sessionKeyHelp.stepOpen', { provider: providerName })}</li>
            <li>{t('sessionKeyHelp.stepDevTools', { cookieOrigin: provider.cookieOrigin })}</li>
            <li>
              {t('sessionKeyHelp.stepCopyPrefix')}{' '}
              <code className="break-all" style={{ color: 'var(--foreground)' }}>
                {provider.cookieName}
              </code>{' '}
              {t('sessionKeyHelp.stepCopySuffix')}
            </li>
          </ol>
          <p style={{ color: 'var(--primary-text)' }}>{t('sessionKeyHelp.security')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={provider.officialURL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border px-2 py-1"
              style={{ color: 'var(--primary-text)', borderColor: 'var(--border)' }}
            >
              {t('sessionKeyHelp.openProvider', { provider: providerName })}
            </a>
            <button
              type="button"
              className="rounded border px-2 py-1"
              style={{ color: 'var(--foreground)', borderColor: 'var(--border)' }}
              onClick={() => void copy(provider.cookieName, 'cookie_name')}
            >
              {t('sessionKeyHelp.copyCookieName')}
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1"
              style={{ color: 'var(--foreground)', borderColor: 'var(--border)' }}
              onClick={() => void copy(instructions, 'instructions')}
            >
              {t('sessionKeyHelp.copyInstructions')}
            </button>
          </div>
          {statusMessage && (
            <p
              role={copyStatus === 'error' ? 'alert' : 'status'}
              aria-live="polite"
              style={{ color: copyStatus === 'error' ? '#fca5a5' : '#4ade80' }}
            >
              {statusMessage}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
