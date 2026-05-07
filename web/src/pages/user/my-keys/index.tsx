/**
 * My Keys page — /user/my-keys
 * Lists all virtual keys for the current user; allows viewing binding summary (no plaintext keys).
 *
 * Security: the Web console only calls /summary (metadata-only). Plaintext provider keys
 * are exclusively delivered through the CLI /delivery endpoint and re-encrypted into the
 * local vault — they are never exposed in a browser context.
 */
import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { deliveryApi, type UserKeyDTO, type KeySummaryDTO } from '@/shared/api/user/delivery';
import { PageHeader } from '@/shared/ui/PageHeader';

// ── Summary modal ─────────────────────────────────────────────────────────────

function SummaryModal({ summary, onClose }: { summary: KeySummaryDTO; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }} />
      <div
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded border"
        style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', boxShadow: '0 24px 64px rgba(0,0,0,0.8)' }}
      >
        <div className="px-6 py-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(99,179,237,0.15)', border: '1px solid rgba(99,179,237,0.3)' }}>
              <svg className="w-4 h-4" fill="none" stroke="#63b3ed" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
            </div>
            <div>
              <h3 className="text-sm font-mono font-bold" style={{ color: 'var(--foreground)' }}>Binding Summary</h3>
              <p className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
                {summary.alias} · {summary.slots.length} protocol channel{summary.slots.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
            {summary.slots.map((slot) => (
              <div key={slot.protocol_type} className="space-y-2">
                <div className="text-[10px] font-mono font-bold tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                  {slot.protocol_type}
                </div>
                {slot.targets.map((t) => (
                  <div key={t.binding_id} className="space-y-1.5 p-3 rounded border" style={{ borderColor: 'var(--border)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-bold" style={{ color: 'var(--foreground)' }}>
                        {t.provider_code}
                      </span>
                      <span
                        className="px-2 py-0.5 rounded text-[10px] font-mono font-bold border"
                        style={{
                          color: t.fallback_role === 'primary' ? '#4ade80' : 'var(--muted-foreground)',
                          borderColor: t.fallback_role === 'primary' ? 'rgba(74,222,128,0.3)' : 'var(--border)',
                          backgroundColor: t.fallback_role === 'primary' ? 'rgba(74,222,128,0.08)' : 'transparent',
                        }}
                      >
                        {t.fallback_role}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
                      Base URL: <span style={{ color: 'var(--foreground)' }}>{t.base_url}</span>
                    </div>
                    <div className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
                      Priority: {t.priority}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="p-2 rounded text-[11px] font-mono" style={{ backgroundColor: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', color: '#fbbf24' }}>
            Real API keys are only available through the CLI. Use <code>aikey delivery pull</code> to sync keys to your local vault.
          </div>

          {summary.expires_at && (
            <div className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
              Expires: <span style={{ color: 'var(--foreground)' }}>{new Date(summary.expires_at).toLocaleString()}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end px-6 py-4" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} className="btn btn-primary text-xs px-6 py-2">Close</button>
        </div>
      </div>
    </>
  );
}

// ── Status badge helper ───────────────────────────────────────────────────────

function KeyStatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, { color: string; bg: string; border: string }> = {
    active:    { color: '#4ade80', bg: 'rgba(74,222,128,0.08)',   border: 'rgba(74,222,128,0.3)' },
    suspended: { color: '#fbbf24', bg: 'rgba(251,191,36,0.08)',   border: 'rgba(251,191,36,0.3)' },
    revoked:   { color: '#f87171', bg: 'rgba(248,113,113,0.08)',  border: 'rgba(248,113,113,0.3)' },
  };
  const s = colorMap[status] ?? { color: 'var(--muted-foreground)', bg: 'transparent', border: 'var(--border)' };
  return (
    <span
      className="px-2 py-0.5 rounded text-[10px] font-mono font-bold border"
      style={{ color: s.color, backgroundColor: s.bg, borderColor: s.border }}
    >
      {status}
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MyKeysPage() {
  const [summary, setSummary] = useState<KeySummaryDTO | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const { data: keys = [], isLoading, isError } = useQuery({
    queryKey: ['my-keys'],
    queryFn: deliveryApi.allKeys,
  });

  const viewMut = useMutation({
    mutationFn: (virtualKeyId: string) => deliveryApi.getSummary(virtualKeyId),
    onSuccess: (result) => {
      setSummary(result);
      setViewingId(null);
    },
    onSettled: () => setViewingId(null),
  });

  return (
    <div className="p-6 space-y-5">
      {/* origin-name: description said "Virtual Keys" pre-2026-04-22 rename */}
      <div data-origin-name="Virtual Keys associated with your account" style={{ display: 'contents' }}>
        <PageHeader title="My Keys" description="Team Keys associated with your account" />
      </div>

      <div className="rounded border overflow-hidden" style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)', backgroundColor: 'rgba(0,0,0,0.2)' }}>
          <h2 className="text-xs font-mono font-bold tracking-wider" style={{ color: 'var(--muted-foreground)' }}>Key List</h2>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded border" style={{ color: 'var(--muted-foreground)', borderColor: 'var(--border)' }}>
            {keys.length} records
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left border-collapse">
            <thead>
              <tr>
                {['Alias', 'Provider', 'Status', 'Share Status', 'Expires', 'Actions'].map((h) => (
                  <th key={h} className="px-5 py-3 text-[10px] font-mono tracking-wider" style={{ color: 'var(--muted-foreground)', backgroundColor: 'rgba(0,0,0,0.2)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>Loading...</td></tr>
              ) : isError ? (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-xs font-mono" style={{ color: '#f87171' }}>Failed to load</td></tr>
              ) : keys.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>No keys</td></tr>
              ) : (
                keys.map((k: UserKeyDTO) => (
                  <tr key={k.virtual_key_id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="px-5 py-3 text-sm font-mono font-bold" style={{ color: 'var(--foreground)' }}>{k.alias}</td>
                    <td className="px-5 py-3 text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>{k.provider_code || '—'}</td>
                    <td className="px-5 py-3"><KeyStatusBadge status={k.key_status} /></td>
                    <td className="px-5 py-3 text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>{k.share_status}</td>
                    <td className="px-5 py-3 text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
                      {k.expires_at ? new Date(k.expires_at).toLocaleDateString(navigator.language) : 'Never'}
                    </td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => { setViewingId(k.virtual_key_id); viewMut.mutate(k.virtual_key_id); }}
                        disabled={viewMut.isPending && viewingId === k.virtual_key_id}
                        className="text-[10px] font-mono px-3 py-1.5 rounded border disabled:opacity-40"
                        style={{ color: '#63b3ed', borderColor: 'rgba(99,179,237,0.3)', backgroundColor: 'rgba(99,179,237,0.06)' }}
                      >
                        {viewMut.isPending && viewingId === k.virtual_key_id ? 'Loading...' : 'View Details'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {summary && <SummaryModal summary={summary} onClose={() => setSummary(null)} />}
    </div>
  );
}
