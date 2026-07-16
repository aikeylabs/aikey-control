/**
 * My Agents — /user/my-agents  (alpha.5 online-agent, member self-service)
 *
 * The agents this member owns (parent = my seat). A member creates an agent,
 * points a third-party agent product at its base_url + team OAuth VK, and the
 * agent borrows the member's own OAuth token. Two-pool model: an agent draws
 * from the member's OWN agent pool by default (company pools are an advanced
 * path); see the Create Agent flow.
 *
 * This is the list + create + disable surface. The full "fuel the agent"
 * wizard (add accounts / log in / connectivity self-check) enriches the create
 * modal in a follow-up; this MVP creates against the member's own pool.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { userAccountsApi, type MyAgentDTO } from '@/shared/api/user/accounts';
import { Badge } from '@/shared/ui/Badge';
import { ModalPortal } from '@/shared/ui/ModalShell';
import { copyText } from '@/shared/utils/clipboard';

function sourceBadge(src: MyAgentDTO['source']) {
  const isApiKey = src.type === 'api_key';
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant={isApiKey ? 'gray' : 'green'}>{isApiKey ? 'API-KEY' : 'OAUTH'}</Badge>
      <span style={{ color: 'var(--muted-foreground)' }}>{src.name || (src.owner_pool ? 'My pool' : '—')}</span>
    </span>
  );
}

// ── Copyable connection field (base_url / VK) with reveal-once eye ─────────────

function CopyField({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [revealed, setRevealed] = useState(!secret);
  const [copied, setCopied] = useState(false);
  const shown = revealed ? value : value.replace(/./g, '•').slice(0, 40);
  return (
    <div className="space-y-1">
      <label className="block text-[10px] font-mono tracking-wider" style={{ color: 'var(--muted-foreground)' }}>{label}</label>
      <div className="flex items-center gap-2">
        <code className="flex-1 px-3 py-2 text-xs rounded truncate" style={{ background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--foreground)' }}>{shown}</code>
        {secret && (
          <button
            onClick={() => setRevealed(r => !r)}
            title={revealed ? 'Hide' : 'Reveal'}
            className="text-[10px] font-mono px-2 py-2 rounded border"
            style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
          >
            {revealed ? '🙈' : '👁'}
          </button>
        )}
        <button
          onClick={() => { copyText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
          className="text-[10px] font-mono px-2.5 py-2 rounded border whitespace-nowrap"
          style={{ borderColor: copied ? 'rgba(74,222,128,0.4)' : 'var(--border)', color: copied ? '#4ade80' : 'var(--muted-foreground)' }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

// ── Create Agent (two-step: name → connection reveal) ─────────────────────────

function CreateAgentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [alias, setAlias] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<MyAgentDTO | null>(null);

  function reset() {
    setAlias(''); setErr(null); setCreated(null); setSubmitting(false);
  }
  function close() { reset(); onClose(); }

  async function submit() {
    const name = alias.trim();
    if (!name) return;
    setSubmitting(true);
    setErr(null);
    try {
      // Omit oauth_group_id → the server attaches the agent to the member's own
      // per-provider agent pool (auto-provisioned on first agent).
      const agent = await userAccountsApi.createAgent({ alias: name });
      qc.invalidateQueries({ queryKey: ['my-agents'] });
      setCreated(agent); // → step 2: reveal base_url + VK
    } catch (e) {
      const anyE = e as { response?: { data?: { message?: string; error?: string } } };
      setErr(anyE.response?.data?.message || anyE.response?.data?.error || 'Failed to create agent');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={!submitting ? close : undefined} />
      <div
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded border"
        style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', boxShadow: '0 24px 64px rgba(0,0,0,0.7)' }}
      >
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 className="text-sm font-mono font-bold tracking-wider" style={{ color: 'var(--foreground)' }}>
            {created ? 'AGENT CREATED' : 'CREATE AGENT'}
          </h3>
          <button onClick={close} disabled={submitting} style={{ color: 'var(--muted-foreground)' }}>✕</button>
        </div>

        {!created ? (
          <>
            <div className="px-6 py-5 space-y-3">
              <label className="block text-[10px] font-mono tracking-wider" style={{ color: 'var(--muted-foreground)' }}>AGENT NAME</label>
              <input className="w-full px-3 py-2 text-sm" placeholder="my-research-agent" value={alias} onChange={e => setAlias(e.target.value)} disabled={submitting} />
              <p className="text-[10px] font-mono leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
                The agent draws from your own agent pool. After creating it, add and log in your OAuth accounts to make it usable.
              </p>
              {err && (
                <div className="text-[10px] font-mono px-3 py-2 rounded" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>{err}</div>
              )}
            </div>
            <div className="flex justify-end gap-3 px-6 py-4" style={{ borderTop: '1px solid var(--border)' }}>
              <button onClick={close} className="px-4 py-2 text-xs font-mono font-bold rounded border" style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}>Cancel</button>
              <button onClick={submit} disabled={!alias.trim() || submitting} className="btn btn-primary text-xs px-4 py-2 disabled:opacity-40">
                {submitting ? 'Creating...' : 'Create'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-6 py-5 space-y-4">
              <p className="text-[10px] font-mono leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
                Point your third-party agent's API base at this base_url, using the key below as the Bearer token.
              </p>
              {created.base_url_blocked ? (
                <div className="text-[10px] font-mono px-3 py-2 rounded" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b' }}>
                  base_url is not configured on this deployment. Ask your admin to set the oauth-routing ingress domain.
                </div>
              ) : (
                <CopyField label="BASE URL" value={created.base_url ?? ''} />
              )}
              {created.vk_pending ? (
                <div className="text-[10px] font-mono px-3 py-2 rounded space-y-2" style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.25)', color: '#60a5fa' }}>
                  <p>No key yet — your agent pool has no accounts. Add and log in an OAuth account to activate this agent; its key then appears on re-open.</p>
                  {/* Hand off to the canonical add-account + login surface
                      (Team OAuth / pool-login) instead of duplicating that flow
                      here — reuse, not re-implement. */}
                  <Link to="/user/team-oauth" onClick={close} className="inline-block font-bold" style={{ color: '#60a5fa', textDecoration: 'underline' }}>
                    Add &amp; log in accounts in Team OAuth →
                  </Link>
                </div>
              ) : (
                <>
                  <CopyField label="TEAM OAUTH VK (shown once)" value={created.vk ?? ''} secret />
                  <p className="text-[10px] font-mono" style={{ color: '#f59e0b' }}>⚠ This key is shown only once. Copy it now — it cannot be retrieved later.</p>
                </>
              )}
            </div>
            <div className="flex justify-end gap-3 px-6 py-4" style={{ borderTop: '1px solid var(--border)' }}>
              <button onClick={close} className="btn btn-primary text-xs px-6 py-2">Done</button>
            </div>
          </>
        )}
      </div>
    </ModalPortal>
  );
}

// ── Disable button ────────────────────────────────────────────────────────────

function AgentRowActions({ agent }: { agent: MyAgentDTO }) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  async function del() {
    setLoading(true);
    try {
      await userAccountsApi.deleteAgent(agent.seat_id);
      qc.invalidateQueries({ queryKey: ['my-agents'] });
    } catch {
      // surfaced globally
    } finally {
      setLoading(false);
    }
  }
  return (
    <button
      onClick={del}
      disabled={loading}
      className="text-[10px] font-mono px-2.5 py-1 rounded border whitespace-nowrap disabled:opacity-40"
      style={{ color: '#f97316', borderColor: 'rgba(249,115,22,0.3)', backgroundColor: 'rgba(249,115,22,0.06)' }}
    >
      {loading ? '...' : 'Disable'}
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MyAgentsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const { data: agents, isLoading, isError } = useQuery({
    queryKey: ['my-agents'],
    queryFn: userAccountsApi.myAgents,
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-mono font-bold tracking-widest" style={{ color: 'var(--foreground)' }}>MY AGENTS</h1>
          <p className="text-xs font-mono mt-1" style={{ color: 'var(--muted-foreground)' }}>Online agents you own — GET /accounts/me/agents</p>
        </div>
        <button onClick={() => setCreateOpen(true)} className="btn btn-primary text-xs px-4 py-2">+ New Agent</button>
      </div>

      <div className="rounded border overflow-hidden" style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap">
            <thead>
              <tr>
                <th className="px-5 py-3 text-left">AGENT</th>
                <th className="px-5 py-3 text-left">SOURCE</th>
                <th className="px-5 py-3 text-left">STATUS</th>
                <th className="px-5 py-3 text-left">CREATED</th>
                <th className="px-5 py-3 text-right">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {isLoading && (
                <tr><td colSpan={5} className="px-5 py-8 text-center" style={{ color: 'var(--muted-foreground)' }}>LOADING...</td></tr>
              )}
              {isError && (
                <tr><td colSpan={5} className="px-5 py-8 text-center" style={{ color: 'var(--destructive)' }}>Failed to load agents.</td></tr>
              )}
              {agents && agents.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-10 text-center" style={{ color: 'var(--muted-foreground)' }}>No agents yet. Create one to expose a team OAuth VK to a third-party agent.</td></tr>
              )}
              {agents?.map(agent => (
                <tr key={agent.seat_id}>
                  <td className="px-5 py-4" style={{ color: 'var(--soft-foreground)' }}>{agent.alias}</td>
                  <td className="px-5 py-4">{sourceBadge(agent.source)}</td>
                  <td className="px-5 py-4">
                    <span className={`badge ${agent.status === 'active' ? 'badge-active' : 'badge-neutral'}`}>{agent.status}</span>
                  </td>
                  <td className="px-5 py-4" style={{ color: 'var(--muted-foreground)' }}>
                    {agent.created_at ? new Date(agent.created_at).toLocaleDateString(navigator.language) : '—'}
                  </td>
                  <td className="px-5 py-4 text-right"><AgentRowActions agent={agent} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <CreateAgentModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
