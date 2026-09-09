// ModelMappingBanner — P3.5 four-surface visibility (web surface).
//
// Reads the proxy's read-only model-mapping health via the local-server relay
// GET /api/user/diagnostics/mapping → proxy /v1/diagnostics/pipeline (task 7.9).
// The proxy's `mappingHealth` is the SINGLE source of truth (3.5: one judgment
// function, no per-surface marker strings) — this component only RENDERS its
// verdict, it never re-derives the state.
//
// Surfaces ONLY the "degraded" state ("a mapping is configured but recent
// requests didn't match it — it may not be taking effect"). Per 3.6, that state
// is NOT user-fixable (mappings ship with the installer), so the banner is
// DISMISSABLE rather than a nagging non-closable strip. "ok" / "inactive" /
// proxy-unreachable render nothing (silent — never a business-state lie: this is
// a transport-independent read, undefined data just means "no signal yet").
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { httpClient } from '@/shared/api/http-client';

interface MappingDiagnostics {
  registry?: { digest?: string };
  model_mapping?: { status?: string; reason?: string };
}

export function ModelMappingBanner() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery<MappingDiagnostics | null>({
    queryKey: ['diagnostics', 'model-mapping'],
    queryFn: async () => {
      try {
        const res = await httpClient.get<MappingDiagnostics>('/api/user/diagnostics/mapping');
        return res.data;
      } catch {
        // Proxy down / older binary without the endpoint → no signal, stay silent.
        return null;
      }
    },
    retry: false,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const status = data?.model_mapping?.status;
  if (dismissed || status !== 'degraded') return null;

  const digest = data?.registry?.digest ?? '';
  const reason = data?.model_mapping?.reason || t('vault.mappingDegraded');

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        marginBottom: 12,
        // Match the sibling advisory banner (HookReadinessBanner dismissible
        // base): tokens, not raw amber literals, and the same 4px radius so
        // the two advisory strips read as one visual language. This is the
        // advisory (dismissible) severity — the actionable variant adds the
        // gold gradient + primary inset rail, which we deliberately do NOT use.
        borderRadius: 4,
        border: '1px solid var(--border)',
        background: 'var(--surface-warn, rgba(var(--btn-primary-border-rgb), 0.08))',
        color: 'var(--foreground)',
        fontSize: 12,
        fontFamily: 'var(--font-mono)',
      }}
    >
      <span aria-hidden="true" style={{ color: 'var(--primary-text)' }}>▲</span>
      <span style={{ flex: 1 }}>
        {reason}
        {digest && (
          <span style={{ color: 'var(--muted-foreground)', marginLeft: 6 }}>
            (registry {digest})
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t('vault.mappingDismiss')}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--muted-foreground)',
          cursor: 'pointer',
          fontSize: 14,
          lineHeight: 1,
          padding: '0 4px',
        }}
      >
        ×
      </button>
    </div>
  );
}
