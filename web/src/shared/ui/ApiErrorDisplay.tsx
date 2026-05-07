import type { ApiError } from '@/shared/utils/api-error';

interface ApiErrorDisplayProps {
  error: ApiError;
  /** Compact mode: single-line code+message only, no meta rows. Used inside dense lists. */
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
  const isData = error.code.startsWith('DATA_');
  const isExt  = error.code.startsWith('EXT_');

  if (compact) {
    return (
      <div className="space-y-0.5">
        <span className="text-[10px] font-mono font-bold" style={{ color: '#f87171' }}>
          [{error.code}] {error.message}
        </span>
        {isExt && error.upstream_message && (
          <span className="block text-[10px] font-mono" style={{ color: '#fca5a5' }}>
            ↳ {error.provider && <>{error.provider}: </>}
            {error.upstream_status && <>{error.upstream_status} — </>}
            {error.upstream_message}
          </span>
        )}
        {isData && error.field && (
          <span className="block text-[10px] font-mono" style={{ color: '#fca5a5' }}>
            ↳ field: {error.field}{error.rule && ` (${error.rule})`}
          </span>
        )}
      </div>
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
            <MetaRow label="Field" value={error.field} />
          )}
          {error.rule && (
            <MetaRow label="Rule" value={error.rule} />
          )}
        </div>
      )}

      {/* EXT meta: provider + upstream status + upstream message */}
      {isExt && (
        <div className="space-y-0.5">
          {error.provider && (
            <MetaRow label="Provider" value={error.provider} />
          )}
          {error.upstream_status !== undefined && (
            <MetaRow label="Upstream status" value={String(error.upstream_status)} />
          )}
          {error.upstream_message && (
            <MetaRow label="Upstream message" value={error.upstream_message} highlight />
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
