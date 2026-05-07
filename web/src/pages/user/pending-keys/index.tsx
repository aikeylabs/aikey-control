/**
 * Pending Keys page — /user/pending-keys
 * Lists virtual keys awaiting claim, allows one-click claim + view delivery key.
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { deliveryApi, type PendingKeyDTO, type DeliveryDTO } from '@/shared/api/user/delivery';
import { Badge } from '@/shared/ui/Badge';
import { copyText } from '@/shared/utils/clipboard';
import { PageHeader } from '@/shared/ui/PageHeader';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    copyText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono font-bold rounded border transition-colors"
      style={{
        borderColor: copied ? 'rgba(74,222,128,0.4)' : 'var(--border)',
        color: copied ? '#4ade80' : 'var(--muted-foreground)',
        backgroundColor: copied ? 'rgba(74,222,128,0.08)' : 'transparent',
      }}
    >
      {copied ? (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
      ) : (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
      )}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// ── Delivery result modal ────────────────────────────────────────────────────

function DeliveryModal({ delivery, onClose }: { delivery: DeliveryDTO; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }} />
      <div
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded border"
        style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', boxShadow: '0 24px 64px rgba(0,0,0,0.8)' }}
      >
        <div className="px-6 py-5 space-y-4">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(74,222,128,0.15)', border: '1px solid rgba(74,222,128,0.3)' }}>
              <svg className="w-4 h-4" fill="none" stroke="#4ade80" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            </div>
            <div>
              <h3 className="text-sm font-mono font-bold" style={{ color: 'var(--foreground)' }}>Key Claimed</h3>
              <p className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
                {delivery.alias} · {delivery.slots.length} protocol channel{delivery.slots.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          {/* One section per protocol slot; targets ordered by priority */}
          <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
            {delivery.slots.map((slot) => (
              <div key={slot.protocol_type} className="space-y-2">
                <div className="text-[10px] font-mono font-bold tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                  {slot.protocol_type}
                </div>
                {slot.binding_targets.map((t) => (
                  <div key={t.binding_id} className="space-y-2 p-3 rounded border" style={{ borderColor: 'var(--border)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                    <span className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
                      {t.provider_code}{t.fallback_role === 'fallback' ? ' · fallback' : ''}
                    </span>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] font-mono" style={{ color: 'var(--muted-foreground)' }}>API Key</label>
                      <CopyButton text={t.provider_key} />
                    </div>
                    <div
                      className="w-full px-3 py-2 rounded border font-mono text-xs break-all select-all"
                      style={{ backgroundColor: 'rgba(0,0,0,0.4)', borderColor: 'var(--border)', color: 'var(--foreground)', wordBreak: 'break-all' }}
                    >
                      {t.provider_key}
                    </div>
                    <div className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
                      Base URL: <span style={{ color: 'var(--foreground)' }}>{t.base_url}</span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {delivery.expires_at && (
            <div className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
              Expires: <span style={{ color: 'var(--foreground)' }}>{new Date(delivery.expires_at).toLocaleString()}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end px-6 py-4" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} className="btn btn-primary text-xs px-6 py-2">Done</button>
        </div>
      </div>
    </>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function PendingKeysPage() {
  const qc = useQueryClient();
  const [delivery, setDelivery] = useState<DeliveryDTO | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const { data: keys = [], isLoading, isError } = useQuery({
    queryKey: ['pending-keys'],
    queryFn: deliveryApi.pendingKeys,
  });

  const claimMut = useMutation({
    mutationFn: async (virtualKeyId: string) => {
      await deliveryApi.claimKey(virtualKeyId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-keys'] });
      qc.invalidateQueries({ queryKey: ['my-keys'] });
      setClaimingId(null);
    },
    onSettled: () => setClaimingId(null),
  });

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Pending Keys" description="Unclaimed virtual keys awaiting your action" />

      <div className="rounded border overflow-hidden" style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)', backgroundColor: 'rgba(0,0,0,0.2)' }}>
          <h2 className="text-xs font-mono font-bold tracking-wider" style={{ color: 'var(--muted-foreground)' }}>Pending Claims</h2>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded border" style={{ color: 'var(--muted-foreground)', borderColor: 'var(--border)' }}>
            {keys.length} records
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left border-collapse">
            <thead>
              <tr>
                {['Alias', 'Provider', 'Expires', 'Actions'].map((h) => (
                  <th key={h} className="px-5 py-3 text-[10px] font-mono tracking-wider" style={{ color: 'var(--muted-foreground)', backgroundColor: 'rgba(0,0,0,0.2)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={4} className="px-5 py-10 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>Loading...</td></tr>
              ) : isError ? (
                <tr><td colSpan={4} className="px-5 py-10 text-center text-xs font-mono" style={{ color: '#f87171' }}>Failed to load</td></tr>
              ) : keys.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-12 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>No pending keys</td></tr>
              ) : (
                keys.map((k) => (
                  <tr key={k.virtual_key_id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="px-5 py-3 text-sm font-mono font-bold" style={{ color: 'var(--foreground)' }}>{k.alias}</td>
                    <td className="px-5 py-3 text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>{k.provider_code || '—'}</td>
                    <td className="px-5 py-3 text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
                      {k.expires_at ? new Date(k.expires_at).toLocaleDateString(navigator.language) : 'Never'}
                    </td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => { setClaimingId(k.virtual_key_id); claimMut.mutate(k.virtual_key_id); }}
                        disabled={claimMut.isPending && claimingId === k.virtual_key_id}
                        className="text-[10px] font-mono px-3 py-1.5 rounded border disabled:opacity-40"
                        style={{ color: '#4ade80', borderColor: 'rgba(74,222,128,0.3)', backgroundColor: 'rgba(74,222,128,0.06)' }}
                      >
                        {claimMut.isPending && claimingId === k.virtual_key_id ? 'Claiming...' : 'Claim Key'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {delivery && <DeliveryModal delivery={delivery} onClose={() => setDelivery(null)} />}
    </div>
  );
}
