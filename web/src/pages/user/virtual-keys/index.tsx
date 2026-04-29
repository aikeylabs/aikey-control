/**
 * Team Keys page — /user/virtual-keys
 *
 * URL path stays `virtual-keys` (matches the internal concept — sentinel
 * tokens that route through the proxy). The user-facing label was
 * renamed "Virtual Keys" → "Team Keys" 2026-04-22 because end users see
 * only keys their team/org assigned them, so "Team Keys" better matches
 * intent. Master console retains "Virtual Keys" (operator technical view).
 *
 * v3 style pass (2026-04-23): visuals aligned with
 * .superdesign/design_iterations/user_virtual_keys_3.html.
 * LOGIC UNCHANGED — all state / queries / handlers preserved.
 * Additive filter pills (All / Issued / Pending / Shared) in the reference
 * are intentionally omitted; they would add new filter logic outside the
 * "style only" scope. When we add them we'll wire real state for them.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { deliveryApi, type UserKeyDTO, type KeySummaryDTO } from '@/shared/api/user/delivery';
import { vaultApi, pickHookReadiness } from '@/shared/api/user/vault';
import { useHookReadinessStore } from '@/store';
import { HookReadinessBanner } from '@/shared/components/HookReadinessBanner';
import { copyText } from '@/shared/utils/clipboard';
import { mapUseError } from '@/shared/utils/mapUseError';

// Per-provider chip colours — keep in sync with overview / usage-ledger.
function providerChipClass(code: string): string {
  const k = (code || '').toLowerCase();
  if (k.includes('anthropic') || k.includes('claude')) return 'provider-chip anthropic';
  if (k.includes('openai') || k.includes('gpt')) return 'provider-chip openai';
  if (k.includes('kimi') || k.includes('moonshot')) return 'provider-chip kimi';
  if (k.includes('google') || k.includes('gemini')) return 'provider-chip google';
  return 'provider-chip';
}

function statusMeta(keyStatus: string): { cls: string; label: string } {
  if (keyStatus === 'active') return { cls: 'status-issued', label: 'Issued' };
  if (keyStatus === 'pending_claim') return { cls: 'status-pending', label: 'Pending' };
  if (keyStatus === 'revoked') return { cls: 'status-revoked', label: 'Revoked' };
  if (keyStatus === 'expired') return { cls: 'status-revoked', label: 'Expired' };
  return { cls: 'status-revoked', label: keyStatus || 'Unknown' };
}

export default function UserVirtualKeysPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [summary, setSummary] = useState<KeySummaryDTO | null>(null);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [useStatus, setUseStatus] = useState<{ kind: 'ok'; msg: string } | { kind: 'err'; msg: string } | null>(null);
  const qc = useQueryClient();

  const { data: rawAll, isLoading } = useQuery({ queryKey: ['my-keys'], queryFn: deliveryApi.allKeys });
  const allKeys = rawAll ?? [];

  const filtered = allKeys.filter((k) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return k.alias.toLowerCase().includes(q) || k.virtual_key_id.toLowerCase().includes(q);
  });

  const selected = allKeys.find((k) => k.virtual_key_id === selectedId) ?? null;

  const viewMut = useMutation({
    mutationFn: (id: string) => deliveryApi.getSummary(id),
    onSuccess: (result) => { setSummary(result); setDrawerError(null); },
    onError: (err: unknown) => {
      setSummary(null);
      const status = (err as { response?: { status?: number } })?.response?.status;
      setDrawerError(status === 403
        ? 'This key has been revoked or is no longer accessible.'
        : 'Failed to load key details.');
    },
  });

  const claimMut = useMutation({
    mutationFn: (id: string) => deliveryApi.claimKey(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-keys'] });
    },
  });

  // Stage 7-2: "Set as active" mutation — POSTs to /api/user/vault/use
  // with target=team. Backend (Stage 7-1) resolves vk_id via the canonical
  // bridge → CLI vault-op → refresh_implicit_profile_activation, which
  // writes ~/.aikey/active.env so any open terminal picks up the new key
  // on its next prompt (precmd seq diff). UI just needs to show pending /
  // success / error states and invalidate the list cache so freshly active
  // / formerly active rows reflect the swap.
  const setHookReadiness = useHookReadinessStore((s) => s.setReadiness);
  const useMutTeam = useMutation({
    mutationFn: (id: string) => vaultApi.use({ target: 'team', id }),
    onSuccess: (res) => {
      setUseStatus({
        kind: 'ok',
        msg: 'Active key switched. Open terminals will pick it up on next prompt.',
      });
      // Hook coverage v1: feed the three hook-status fields into the
      // shared readiness store so <HookReadinessBanner> renders the
      // right CTA (or hides) based on the freshly observed state.
      setHookReadiness(pickHookReadiness(res));
      qc.invalidateQueries({ queryKey: ['my-keys'] });
    },
    onError: (err: unknown) => {
      setUseStatus({ kind: 'err', msg: mapUseError(err) });
    },
  });

  function handleRowClick(k: UserKeyDTO) {
    setSelectedId(k.virtual_key_id);
    setDrawerError(null);
    setUseStatus(null);
    if (k.key_status === 'active') {
      setSummary(null);
      viewMut.mutate(k.virtual_key_id);
    } else {
      setSummary(null);
    }
  }

  function handleClose() {
    setSelectedId(null);
    setSummary(null);
    setDrawerError(null);
    setUseStatus(null);
  }

  return (
    <div className="tk-page flex flex-1 overflow-hidden">
      <style>{TK_CSS}</style>

      {/* List Area */}
      <div
        className="flex-1 flex flex-col min-w-0 overflow-hidden relative"
        style={{ borderRight: selected ? '1px solid var(--border)' : undefined }}
      >
        {/* Hook readiness banner — shows after a vault mutation when the
            Web bridge couldn't (or didn't) wire the shell rc. Reads from
            useHookReadinessStore which the mutation onSuccess populates. */}
        <div style={{ padding: '0 16px', marginTop: 12 }}>
          <HookReadinessBanner />
        </div>

        {/* Filter bar */}
        <div className="filter-bar">
          <label className="search">
            <span className="ico"><SearchIcon /></span>
            <input
              type="text"
              placeholder="Search by alias or ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <span className="count-chip">
            <span className="num">{filtered.length}</span> Keys
          </span>
        </div>

        {/* Table OR empty-state card.
            When there are no keys at all (not just filtered-out), render a
            full empty-state card with a key-in-ring visual — same pattern
            the account page uses for "No seats assigned yet" so the two
            empty states read as a family. Searching on zero-keys still
            gets the card (nothing to filter); a search that filters out
            real keys still renders the table with an in-row "no match"
            line so the user can tell it's search, not a data issue. */}
        {!isLoading && allKeys.length === 0 ? (
          <div className="flex-1 flex p-7">
            <div className="tk-empty">
              <div className="tk-empty-ring">
                <KeyIconLarge />
              </div>
              <div className="tk-empty-title">No keys assigned yet</div>
              <p className="tk-empty-desc">
                Keys your team or organisation grants you will show up here.
                Ask a <strong className="tk-empty-strong">team admin</strong> to share a key,
                or import your own from the{' '}
                <Link to="/user/import" className="tk-empty-link">Import</Link> page.
              </p>
            </div>
          </div>
        ) : (
        <div className="flex-1 overflow-y-auto px-7 pb-7">
          <div className="table-wrap">
            <table className="keys">
              <colgroup>
                <col style={{ width: '28%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '14%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Alias / ID</th>
                  <th>Protocols</th>
                  <th>Status</th>
                  <th>Share</th>
                  <th>Expires</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={6} className="empty-cell">Loading...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={6} className="empty-cell">No keys match your search.</td></tr>
                ) : (
                  filtered.map((k) => {
                    const isSelected = selectedId === k.virtual_key_id;
                    const status = statusMeta(k.key_status);
                    return (
                      <tr
                        key={k.virtual_key_id}
                        className={isSelected ? 'selected' : undefined}
                        onClick={() => handleRowClick(k)}
                      >
                        <td>
                          <div className="cell-alias">{k.alias}</div>
                          <div className="cell-id">{k.virtual_key_id.slice(0, 12)}…</div>
                        </td>
                        <td>
                          {k.provider_code ? (
                            <span className={providerChipClass(k.provider_code)}>{k.provider_code}</span>
                          ) : (
                            <span className="dim-dash">—</span>
                          )}
                        </td>
                        <td>
                          <span className={`status ${status.cls}`}>
                            <span className="dot" />
                            {status.label}
                          </span>
                        </td>
                        <td>
                          <ShareBadge shareStatus={k.share_status} />
                        </td>
                        <td>
                          {k.expires_at ? (
                            <span className="expires">
                              {new Date(k.expires_at).toLocaleDateString(undefined, {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                              })}
                            </span>
                          ) : (
                            <span className="expires"><span className="dim">Never</span></span>
                          )}
                        </td>
                        <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right' }}>
                          {k.share_status === 'pending_claim' ? (
                            <button
                              onClick={() => claimMut.mutate(k.virtual_key_id)}
                              disabled={claimMut.isPending}
                              className="tk-btn tk-btn-primary tk-btn-sm"
                            >
                              {claimMut.isPending ? 'Claiming…' : 'Claim'}
                            </button>
                          ) : k.key_status === 'active' ? (
                            <button className="tk-btn tk-btn-outline tk-btn-sm">
                              Details
                            </button>
                          ) : (
                            <span className="dim-dash">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}
      </div>

      {/* Detail drawer — kept, restyled with v3 tokens */}
      {selected && (
        <div className="tk-drawer">
          <div className="tk-drawer-header">
            <div className="min-w-0">
              <h2 className="tk-drawer-title">{selected.alias}</h2>
              <div className="tk-drawer-sub">
                <KeyIconSmall />
                <span className="truncate">{selected.virtual_key_id}</span>
                <CopyButton text={selected.virtual_key_id} />
              </div>
            </div>
            <button onClick={handleClose} className="tk-close" aria-label="Close">
              <CloseIcon />
            </button>
          </div>

          <div className="tk-drawer-body">
            {/* Basic info */}
            <div className="tk-info">
              <DrawerRow
                label="Status"
                value={
                  <span className={`status ${statusMeta(selected.key_status).cls}`}>
                    <span className="dot" />
                    {statusMeta(selected.key_status).label}
                  </span>
                }
              />
              <DrawerRow
                label="Share status"
                value={<ShareBadge shareStatus={selected.share_status} />}
              />
              <DrawerRow
                label="Protocol"
                value={
                  selected.provider_code ? (
                    <span className={providerChipClass(selected.provider_code)}>{selected.provider_code}</span>
                  ) : (
                    <span className="dim-dash">—</span>
                  )
                }
              />
              <DrawerRow
                label="Expires at"
                value={
                  <span className="tk-value">
                    {selected.expires_at
                      ? new Date(selected.expires_at).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })
                      : <span className="dim">Never</span>}
                  </span>
                }
              />
            </div>

            {/* Protocols & routing */}
            {viewMut.isPending && (
              <div className="tk-loading">Loading binding details…</div>
            )}
            {drawerError && (
              <div className="tk-error">{drawerError}</div>
            )}
            {summary && summary.slots.length > 0 && (
              <div>
                <h3 className="tk-section-title">
                  <NetworkIcon /> Protocols &amp; routing
                </h3>
                {summary.slots.map((slot) => (
                  <div key={slot.protocol_type} className="tk-slot">
                    <div className="tk-slot-head">
                      <span>{slot.protocol_type.toUpperCase()}</span>
                    </div>
                    <div className="tk-slot-body">
                      {slot.targets.map((t) => (
                        <div
                          key={t.binding_id}
                          className={`tk-target ${t.fallback_role === 'primary' ? 'primary' : 'fallback'}`}
                        >
                          <div className="tk-target-head">
                            <span className="tk-target-provider">{t.provider_code}</span>
                            <span className={`tk-role ${t.fallback_role === 'primary' ? 'primary' : 'fallback'}`}>
                              {t.fallback_role.toUpperCase()}
                            </span>
                          </div>
                          <div className="tk-target-url">
                            <span className="dim">Base URL:</span> <span>{t.base_url}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <p className="tk-note">
                  Provider secret keys are securely stored in the master vault and are never exposed to seat members.
                </p>
              </div>
            )}

            {/* Stage 7-2: "Set as active" — switches the routing target
                via POST /api/user/vault/use. Only offered for usable keys
                (`key_status === 'active'`); revoked / expired / pending
                keys fall back to the CLI hint below.

                Why no global toast: the existing virtual-keys page has no
                toast plumbing and this status is naturally drawer-scoped
                ("you set THIS key as active"). Inline status keeps the
                feedback close to the action and zero-imports. */}
            {selected.key_status === 'active' && (
              <div className="tk-cli">
                <h4 className="tk-section-title" style={{ marginTop: 0 }}>
                  <TerminalIcon /> Make this key active
                </h4>
                <p className="tk-cli-hint">
                  Route traffic for this key's protocol(s) through it. Open terminals will pick up the change on their next prompt — no <code>source</code> needed.
                </p>
                <button
                  type="button"
                  className="tk-cli-button"
                  onClick={() => {
                    setUseStatus(null);
                    useMutTeam.mutate(selected.virtual_key_id);
                  }}
                  disabled={useMutTeam.isPending}
                >
                  {useMutTeam.isPending ? 'Setting active…' : 'Set as active'}
                </button>
                {useStatus && (
                  <div
                    className={useStatus.kind === 'ok' ? 'tk-use-ok' : 'tk-use-err'}
                    role="status"
                  >
                    {useStatus.msg}
                  </div>
                )}
              </div>
            )}

            {/* Fallback CLI hint for non-active (revoked / pending) keys */}
            {selected.key_status !== 'active' && (
              <div className="tk-cli">
                <h4 className="tk-section-title" style={{ marginTop: 0 }}>
                  <TerminalIcon /> Use this key locally
                </h4>
                <p className="tk-cli-hint">
                  This key is not currently active. Run the following command to authenticate and fetch its configuration:
                </p>
                <div className="tk-cli-box">
                  <code>aikey login</code>
                  <CopyButton text="aikey login" />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Inline helpers ─────────────────────────────────────────────────── */

function DrawerRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="tk-info-row">
      <span className="tk-info-label">{label}</span>
      <span className="tk-info-value">{value}</span>
    </div>
  );
}

function ShareBadge({ shareStatus }: { shareStatus: string }) {
  // Map the backend's share_status strings to a v3-style icon + label pair.
  // Unknown values fall back to plain text so no data is hidden when the
  // backend surfaces a new state we haven't mapped yet.
  const s = (shareStatus || '').toLowerCase();
  if (s === 'claimed' || s === 'private' || s === 'owner_only') {
    return (
      <span className="share-badge">
        <LockIcon /> <span className="dim">Private</span>
      </span>
    );
  }
  if (s === 'shared' || s === 'team') {
    return (
      <span className="share-badge">
        <UsersIcon /> <span>Team</span>
      </span>
    );
  }
  if (s === 'owner') {
    return (
      <span className="share-badge">
        <UserIcon /> <span className="dim">Owner</span>
      </span>
    );
  }
  if (s === 'pending_claim') {
    return (
      <span className="share-badge">
        <ClockIcon /> <span>Pending</span>
      </span>
    );
  }
  return <span className="share-badge"><span className="dim">{shareStatus || '—'}</span></span>;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); copyText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="tk-copy-btn"
      style={{ color: copied ? '#4ade80' : undefined }}
      title="Copy"
      type="button"
    >
      <CopyIcon />
    </button>
  );
}

/* ── Inline icons ───────────────────────────────────────────────────── */

function SearchIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
    </svg>
  );
}
function KeyIconSmall() {
  return (
    <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
    </svg>
  );
}

function KeyIconLarge() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
function NetworkIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
    </svg>
  );
}
function TerminalIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} style={{ color: '#60a5fa' }}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  );
}
function UserIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

/* ── Scoped CSS ─────────────────────────────────────────────────────── */

const TK_CSS = `
.tk-page {
  --tk-surface-2: #1f1f23;
  --tk-surface-3: #2a2a2f;
  --tk-line: rgba(255,255,255,0.06);
  --tk-line-strong: rgba(255,255,255,0.10);
  --tk-text-dim: #8b8b94;
  --tk-sky: #60a5fa;
  --tk-violet: #a78bfa;
}

/* ── Filter bar ─────────────────────────────────────────────────── */
.tk-page .filter-bar {
  padding: 16px 28px;
  display: flex; align-items: center; gap: 12px;
}
.tk-page .search {
  position: relative;
  width: 320px;
}
.tk-page .search input {
  width: 100%;
  height: 36px;
  padding: 0 12px 0 34px;
  background: var(--tk-surface-2);
  border: 1px solid var(--tk-line-strong);
  border-radius: 6px;
  color: var(--foreground);
  font-family: monospace;
  font-size: 12.5px;
  outline: none;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}
.tk-page .search input::placeholder { color: var(--tk-text-dim); }
.tk-page .search input:focus {
  border-color: rgba(250, 204, 21,0.45);
  box-shadow: 0 0 0 3px rgba(250, 204, 21,0.08);
}
.tk-page .search .ico {
  position: absolute; left: 12px; top: 50%;
  transform: translateY(-50%);
  color: var(--tk-text-dim);
  pointer-events: none;
}
.tk-page .count-chip {
  display: inline-flex; align-items: center; gap: 6px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--tk-line-strong);
  border-radius: 6px;
  font-family: monospace;
  font-size: 11px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--tk-text-dim);
  background: var(--tk-surface-2);
}
.tk-page .count-chip .num { color: var(--foreground); font-weight: 700; }

/* ── Table ──────────────────────────────────────────────────────── */
.tk-page .table-wrap {
  background: var(--tk-surface-2);
  border: 1px solid var(--tk-line);
  border-radius: 8px;
  overflow: hidden;
}
.tk-page table.keys {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.tk-page table.keys thead th {
  text-align: left;
  padding: 14px 20px;
  font-family: monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--tk-text-dim);
  background: rgba(0,0,0,0.2);
  border-bottom: 1px solid var(--tk-line);
}
.tk-page table.keys thead th:last-child { text-align: right; }
.tk-page table.keys tbody td {
  padding: 16px 20px;
  font-size: 13px;
  border-bottom: 1px solid var(--tk-line);
  vertical-align: middle;
}
/* Keep the last row's bottom border — stacks with the card's outer
   bottom border to produce the master-style "double line" at the end
   of the table. */
.tk-page table.keys tbody tr { cursor: pointer; transition: background 120ms ease; }
.tk-page table.keys tbody tr:hover { background: rgba(255,255,255,0.02); }
.tk-page table.keys tbody tr.selected {
  background: rgba(250, 204, 21,0.05);
  box-shadow: inset 2px 0 0 0 var(--primary);
}
.tk-page table.keys tbody tr.selected .cell-alias { color: var(--primary); }

.tk-page .empty-cell {
  text-align: center;
  padding: 48px 20px;
  font-family: monospace;
  font-size: 12px;
  color: var(--tk-text-dim);
}

/* Full-pane empty state — "No keys assigned yet" with a key-in-ring
   visual, rendered in place of the table when allKeys.length === 0.
   Same card/ring pattern as the account page's "No seats" state so the
   two empty states read as a visual family. Note: avoid the class name
   'ring' — Tailwind ships a utility of that name which applies a blue
   box-shadow and would fight our styling; we use 'tk-empty-ring'. */
.tk-page .tk-empty {
  flex: 1;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center;
  padding: 48px 32px;
  background: var(--tk-surface-2);
  border: 1px solid var(--tk-line);
  border-radius: 8px;
}
.tk-page .tk-empty-ring {
  width: 56px; height: 56px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 999px;
  background: rgba(0,0,0,0.25);
  border: 1px solid var(--tk-line-strong);
  color: var(--primary);
  margin-bottom: 14px;
  box-shadow: 0 0 0 6px rgba(250, 204, 21,0.04);
}
.tk-page .tk-empty-title {
  font-family: monospace;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--muted-foreground);
  opacity: 0.85;
  margin-bottom: 10px;
}
.tk-page .tk-empty-desc {
  font-size: 13px;
  line-height: 1.6;
  color: var(--tk-text-dim);
  max-width: 420px;
}
.tk-page .tk-empty-strong {
  color: var(--foreground);
  font-weight: 700;
}
.tk-page .tk-empty-link {
  font-family: monospace;
  color: var(--primary);
  font-size: 12.5px;
  text-decoration: none;
  border-bottom: 1px solid rgba(250, 204, 21,0.35);
  transition: border-color 150ms ease, color 150ms ease;
}
.tk-page .tk-empty-link:hover {
  color: #fde047;
  border-bottom-color: rgba(250, 204, 21,0.7);
}

.tk-page .cell-alias {
  font-family: monospace;
  font-size: 13px;
  font-weight: 600;
  color: var(--foreground);
}
.tk-page .cell-id {
  font-family: monospace;
  font-size: 12px;
  color: var(--tk-text-dim);
  margin-top: 4px;
}

/* ── Provider chip ──────────────────────────────────────────────── */
.tk-page .provider-chip {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: monospace;
  font-size: 11px; font-weight: 700;
  letter-spacing: 0.1em; text-transform: uppercase;
  padding: 4px 9px;
  border-radius: 3px;
  border: 1px solid var(--tk-line-strong);
  color: var(--foreground);
  background: rgba(255,255,255,0.03);
}
.tk-page .provider-chip.openai    { color: var(--tk-violet); background: rgba(167,139,250,0.08); border-color: rgba(167,139,250,0.3); }
.tk-page .provider-chip.anthropic { color: var(--primary); background: rgba(250, 204, 21,0.08); border-color: rgba(250, 204, 21,0.3); }
.tk-page .provider-chip.google    { color: var(--tk-sky); background: rgba(96,165,250,0.08); border-color: rgba(96,165,250,0.3); }
.tk-page .provider-chip.kimi      { color: var(--tk-sky); background: rgba(96,165,250,0.08); border-color: rgba(96,165,250,0.3); }

/* ── Status ─────────────────────────────────────────────────────── */
.tk-page .status {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: monospace;
  font-size: 11px; font-weight: 700;
  letter-spacing: 0.05em; text-transform: uppercase;
}
.tk-page .status .dot {
  width: 7px; height: 7px; border-radius: 50%;
  display: inline-block; flex-shrink: 0;
}
.tk-page .status-issued { color: #6ee7b7; }
.tk-page .status-issued .dot { background: #10b981; box-shadow: 0 0 6px rgba(16,185,129,0.5); }
.tk-page .status-pending { color: #fdba74; }
.tk-page .status-pending .dot { background: #f97316; box-shadow: 0 0 6px rgba(249,115,22,0.5); }
.tk-page .status-revoked { color: var(--tk-text-dim); }
.tk-page .status-revoked .dot { background: var(--tk-text-dim); }

/* ── Share badge ────────────────────────────────────────────────── */
.tk-page .share-badge {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: monospace;
  font-size: 11.5px;
  color: var(--foreground);
}
.tk-page .share-badge .dim { color: var(--tk-text-dim); }

/* ── Expires cell ──────────────────────────────────────────────── */
.tk-page .expires {
  font-family: monospace;
  font-size: 12px;
  color: var(--foreground);
}
.tk-page .expires .dim { color: var(--tk-text-dim); }
.tk-page .dim-dash { color: var(--tk-text-dim); }

/* ── Action buttons ────────────────────────────────────────────── */
.tk-page .tk-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  font-family: monospace;
  font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.05em;
  border-radius: 6px;
  transition: all 180ms ease;
  cursor: pointer;
  border: 1px solid transparent;
}
.tk-page .tk-btn-sm { padding: 6px 12px; font-size: 10.5px; }
.tk-page .tk-btn-primary {
  background: var(--primary); color: var(--primary-foreground);
  border-color: rgba(250, 204, 21,0.6);
  box-shadow: 0 0 0 1px rgba(250, 204, 21,0.15), 0 6px 20px -10px rgba(250, 204, 21,0.5);
}
.tk-page .tk-btn-primary:hover:not(:disabled) { background: #fde047; transform: translateY(-1px); }
.tk-page .tk-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
.tk-page .tk-btn-outline {
  background: transparent;
  color: var(--foreground);
  border-color: var(--tk-line-strong);
}
.tk-page .tk-btn-outline:hover { background: rgba(255,255,255,0.04); border-color: var(--tk-text-dim); }

/* ── Drawer ────────────────────────────────────────────────────── */
.tk-page .tk-drawer {
  width: 400px;
  flex-shrink: 0;
  display: flex; flex-direction: column;
  background: var(--background);
  box-shadow: -10px 0 30px rgba(0,0,0,0.5);
  position: relative;
  z-index: 20;
}
.tk-page .tk-drawer-header {
  padding: 18px 22px;
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  border-bottom: 1px solid var(--tk-line);
  background: var(--tk-surface-2);
}
.tk-page .tk-drawer-title {
  font-family: monospace;
  font-size: 16px;
  font-weight: 700;
  color: var(--foreground);
}
.tk-page .tk-drawer-sub {
  display: flex; align-items: center; gap: 8px;
  font-family: monospace;
  font-size: 12px;
  color: var(--tk-text-dim);
  margin-top: 6px;
}
.tk-page .tk-drawer-sub .truncate {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 220px;
}
.tk-page .tk-close {
  color: var(--tk-text-dim);
  background: transparent;
  border: none;
  padding: 4px;
  cursor: pointer;
  transition: color 120ms ease;
}
.tk-page .tk-close:hover { color: var(--foreground); }
.tk-page .tk-copy-btn {
  background: transparent;
  border: none;
  color: var(--tk-text-dim);
  cursor: pointer;
  padding: 2px;
  transition: color 120ms ease;
}
.tk-page .tk-copy-btn:hover { color: var(--foreground); }

.tk-page .tk-drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 22px 28px;
  display: flex; flex-direction: column; gap: 24px;
}
.tk-page .tk-info {
  display: flex; flex-direction: column; gap: 12px;
  font-family: monospace;
  font-size: 12px;
}
.tk-page .tk-info-row {
  display: flex; align-items: center; justify-content: space-between;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--tk-line);
}
.tk-page .tk-info-row:last-child { border-bottom: none; }
.tk-page .tk-info-label {
  font-size: 10.5px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--tk-text-dim);
}
.tk-page .tk-info-value {
  text-align: right;
}
.tk-page .tk-value { color: var(--foreground); }
.tk-page .tk-value .dim { color: var(--tk-text-dim); }

.tk-page .tk-loading {
  font-family: monospace;
  font-size: 12px;
  color: var(--tk-text-dim);
  text-align: center;
  padding: 16px;
}
.tk-page .tk-error {
  font-family: monospace;
  font-size: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(248,113,113,0.3);
  background: rgba(248,113,113,0.05);
  color: #f87171;
  border-radius: 6px;
}

.tk-page .tk-section-title {
  display: flex; align-items: center; gap: 8px;
  font-family: monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--tk-text-dim);
  margin-bottom: 12px;
}
.tk-page .tk-slot {
  background: rgba(0,0,0,0.2);
  border: 1px solid var(--tk-line);
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 12px;
}
.tk-page .tk-slot-head {
  padding: 8px 14px;
  border-bottom: 1px solid var(--tk-line);
  background: rgba(255,255,255,0.02);
  font-family: monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--foreground);
}
.tk-page .tk-slot-body {
  padding: 14px;
  display: flex; flex-direction: column; gap: 14px;
}
.tk-page .tk-target {
  padding-left: 12px;
  border-left: 2px solid var(--muted);
}
.tk-page .tk-target.primary { border-left-color: var(--primary); }
.tk-page .tk-target-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 4px;
}
.tk-page .tk-target-provider {
  font-family: monospace;
  font-size: 12px;
  font-weight: 700;
  color: var(--foreground);
}
.tk-page .tk-role {
  font-family: monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(255,255,255,0.05);
  color: var(--tk-text-dim);
}
.tk-page .tk-role.primary {
  background: rgba(250, 204, 21,0.15);
  color: var(--primary);
}
.tk-page .tk-target-url {
  font-family: monospace;
  font-size: 11.5px;
  color: var(--foreground);
  word-break: break-all;
}
.tk-page .tk-target-url .dim { color: var(--tk-text-dim); }
.tk-page .tk-note {
  font-family: monospace;
  font-size: 11.5px;
  font-style: italic;
  line-height: 1.5;
  color: var(--tk-text-dim);
  padding: 10px 12px;
  border-left: 2px solid rgba(250, 204, 21,0.45);
  background: rgba(250, 204, 21,0.04);
  border-radius: 3px;
}

.tk-page .tk-cli {
  padding: 14px 16px;
  background: rgba(0,0,0,0.15);
  border: 1px solid var(--tk-line);
  border-radius: 6px;
}
.tk-page .tk-cli-hint {
  font-family: monospace;
  font-size: 11.5px;
  color: var(--tk-text-dim);
  margin-bottom: 10px;
}
.tk-page .tk-cli-box {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 8px 12px;
  background: #000;
  border: 1px solid var(--tk-line);
  border-radius: 4px;
}
.tk-page .tk-cli-box code {
  font-family: monospace;
  font-size: 12px;
  color: var(--primary);
}
/* Stage 7-2 — Set as active button + status. Keep visually distinct from
   the CLI box (which is a passive copy target) by using the project's
   primary CSS var for fill, so it reads as the page's recommended action. */
.tk-page .tk-cli-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  font-size: 12px;
  font-weight: 500;
  color: #fff;
  background: var(--primary);
  border: 1px solid var(--primary);
  border-radius: 4px;
  cursor: pointer;
  transition: opacity 120ms ease;
}
.tk-page .tk-cli-button:hover:not(:disabled) {
  opacity: 0.9;
}
.tk-page .tk-cli-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.tk-page .tk-use-ok,
.tk-page .tk-use-err {
  margin-top: 10px;
  padding: 8px 12px;
  font-size: 11.5px;
  border-radius: 4px;
  line-height: 1.4;
}
.tk-page .tk-use-ok {
  color: var(--success, #22c55e);
  background: rgba(34, 197, 94, 0.08);
  border: 1px solid rgba(34, 197, 94, 0.25);
}
.tk-page .tk-use-err {
  color: var(--danger, #ef4444);
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.25);
}
`;
