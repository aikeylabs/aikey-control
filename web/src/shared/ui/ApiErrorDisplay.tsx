import { useTranslation } from 'react-i18next';

import type { ApiError } from '@/shared/utils/api-error';
import { friendlyLabelFor } from '@/shared/utils/api-error';

interface ApiErrorDisplayProps {
  error: ApiError;
  /**
   * Compact mode: collapsed single-line "friendly label" with click-to-expand
   * raw code + message + meta + suggestion. Used inside dense lists where a
   * full sentence overwhelms the row (e.g. batch issue Done step).
   */
  compact?: boolean;
}

/**
 * Renders a structured API error with:
 *  - Error code + message (all errors)
 *  - Field + rule details (DATA_* errors)
 *  - Provider name + upstream HTTP status + upstream message (EXT_* errors)
 *  - Actionable next-step suggestion
 */
export function ApiErrorDisplay({ error, compact = false }: ApiErrorDisplayProps) {
  const { t } = useTranslation();
  const isData = error.code.startsWith('DATA_');
  const isExt  = error.code.startsWith('EXT_');

  if (compact) {
    // Native <details>/<summary> for click-to-expand: zero state, accessible
    // by default (keyboard, screen reader), and serializes consistently for
    // tests/snapshots. The summary shows a short friendly label
    // ("Already Issued") so the row stays scannable; expanding reveals the
    // raw code + message + meta + suggestion for operators who need it.
    return (
      <details className="group">
        <summary
          className="cursor-pointer text-[10px] font-mono font-bold list-none flex items-center gap-1.5"
          style={{ color: '#f87171' }}
        >
          <span
            className="inline-block transition-transform group-open:rotate-90"
            style={{ color: '#fca5a5' }}
          >
            ▶
          </span>
          {friendlyLabelFor(error.code)}
        </summary>
        <div className="mt-1.5 space-y-1 pl-3 border-l" style={{ borderColor: 'rgba(239,68,68,0.3)' }}>
          <p className="text-[10px] font-mono" style={{ color: '#f87171' }}>
            [{error.code}] {error.message}
          </p>
          {isExt && error.upstream_message && (
            <p className="text-[10px] font-mono" style={{ color: '#fca5a5' }}>
              ↳ {error.provider && <>{error.provider}: </>}
              {error.upstream_status && <>{error.upstream_status} — </>}
              {error.upstream_message}
            </p>
          )}
          {isData && error.field && (
            <p className="text-[10px] font-mono" style={{ color: '#fca5a5' }}>
              ↳ field: {error.field}{error.rule && ` (${error.rule})`}
            </p>
          )}
          {error.suggestion && (
            <p className="text-[10px] font-mono leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
              → {error.suggestion}
            </p>
          )}
        </div>
      </details>
    );
  }

  return (
    <div
      className="px-3 py-2.5 rounded border space-y-2"
      style={{ backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.3)' }}
    >
      {/* Code + message */}
      <p className="text-[10px] font-mono font-bold" style={{ color: '#f87171' }}>
        [{error.code}] {error.message}
      </p>

      {/* DATA meta: field + rule */}
      {isData && (error.field || error.rule) && (
        <div className="flex flex-wrap gap-x-4 gap-y-0.5">
          {error.field && (
            <MetaRow label={t('errorDisplay.field')} value={error.field} />
          )}
          {error.rule && (
            <MetaRow label={t('errorDisplay.rule')} value={error.rule} />
          )}
        </div>
      )}

      {/* EXT meta: provider + upstream status + upstream message */}
      {isExt && (
        <div className="space-y-0.5">
          {error.provider && (
            <MetaRow label={t('errorDisplay.provider')} value={error.provider} />
          )}
          {error.upstream_status !== undefined && (
            <MetaRow label={t('errorDisplay.upstreamStatus')} value={String(error.upstream_status)} />
          )}
          {error.upstream_message && (
            <MetaRow label={t('errorDisplay.upstreamMessage')} value={error.upstream_message} highlight />
          )}
        </div>
      )}

      {/* Next-step suggestion */}
      {error.suggestion && (
        <p className="text-[10px] font-mono leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
          → {error.suggestion}
        </p>
      )}
    </div>
  );
}

function MetaRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5 text-[10px] font-mono">
      <span style={{ color: 'var(--muted-foreground)' }}>{label}:</span>
      <span style={{ color: highlight ? '#fca5a5' : '#f87171' }}>{value}</span>
    </div>
  );
}
