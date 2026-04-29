/**
 * My Account page — /user/account
 *
 * v3 layout (2026-04-23): derived from
 * `.superdesign/design_iterations/user_account_3.html`.
 *
 *  - Inline title + subtitle (no PageHeader).
 *  - "Identity & Session" card with yellow accent bar, TOKEN VALID status
 *    chip, 2×2 field grid, action row with last-refresh stamp.
 *  - "My Organizations & Seats" card with icon-ring empty state + CTAs;
 *    populated case renders one row per seat with status + key counts.
 */
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { userAccountsApi, type SeatSummaryDTO } from '@/shared/api/user/accounts';
import { deliveryApi } from '@/shared/api/user/delivery';
import { formatRelativeTime } from '@/shared/utils/datetime-intl';

export default function MyAccountPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const meQuery = useQuery({ queryKey: ['me'], queryFn: userAccountsApi.me });
  const seatsQuery = useQuery({ queryKey: ['my-seats'], queryFn: userAccountsApi.mySeats });
  const keysQuery = useQuery({ queryKey: ['my-all-keys'], queryFn: deliveryApi.allKeys });

  const me = meQuery.data;
  const seats = seatsQuery.data ?? [];
  const allKeys = keysQuery.data ?? [];

  const lastRefreshed = useMemo(() => {
    const t = meQuery.dataUpdatedAt;
    if (!t) return null;
    return relativeTime(new Date(t));
  }, [meQuery.dataUpdatedAt]);

  const refreshProfile = () => {
    queryClient.invalidateQueries({ queryKey: ['me'] });
    queryClient.invalidateQueries({ queryKey: ['my-seats'] });
    queryClient.invalidateQueries({ queryKey: ['my-all-keys'] });
  };

  const keysPerSeat = (seatId: string) => {
    const seatKeys = allKeys.filter((k) => k.seat_id === seatId);
    return {
      active: seatKeys.filter((k) => k.key_status === 'active').length,
      pending: seatKeys.filter((k) => k.share_status === 'pending_claim').length,
    };
  };

  return (
    <div className="account-page p-6">
      <style>{ACCOUNT_CSS}</style>

      {/* Full-width layout — was capped at max-w-[900px] mx-auto but on
          1440+ px external displays that left big empty gutters and
          made the Identity card feel underweighted relative to other
          user pages. Matches the vault-page full-width decision. */}
      {/* Title row — mb-6 gap mirrors the shared PageHeader component
          used across master pages (same component also used by other
          user pages like /referrals, /pending-keys). */}
      <div className="mb-6">
        <h1 className="text-lg font-bold font-mono tracking-wide" style={{ color: 'var(--foreground)' }}>
          My Account
        </h1>
        <p
          className="text-[12px] font-mono mt-0.5"
          style={{ color: 'var(--muted-foreground)', opacity: 0.7 }}
        >
          Account details and organization memberships
        </p>
      </div>

      <div className="space-y-5">
        {/* ── Identity & Session ── */}
        <section className="card accent">
          <div className="card-header">
            <span className="card-title">
              <FingerprintIcon />
              Identity &amp; Session
            </span>
            <span
              className="inline-flex items-center gap-1.5 text-[10px] font-mono"
              style={{ color: 'var(--muted-foreground)' }}
            >
              <span className="status-dot" aria-hidden="true" />
              TOKEN VALID
            </span>
          </div>

          <div className="p-5 pl-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-5">
              <Field label="Email" value={me?.email} mono={false} />
              <Field
                label="Account ID"
                value={me?.account_id ? truncateId(me.account_id) : undefined}
                title={me?.account_id}
                mono
              />
              <div>
                <div className="field-label">Role</div>
                <div>
                  <span className="role-badge">
                    <span className="dot" aria-hidden="true" />
                    {(me?.role ?? 'member').toUpperCase()}
                  </span>
                </div>
              </div>
              <Field
                label="Created"
                value={me?.created_at ? new Date(me.created_at).toLocaleDateString(navigator.language) : undefined}
                mono
              />
            </div>

            <div
              className="mt-5 pt-4 flex items-center gap-2 flex-wrap"
              style={{ borderTop: '1px solid var(--border)' }}
            >
              <button
                type="button"
                className="ov-btn ov-btn-outline text-[11.5px]"
                onClick={refreshProfile}
                disabled={meQuery.isFetching}
              >
                <RefreshIcon />
                {meQuery.isFetching ? 'Refreshing…' : 'Refresh profile'}
              </button>
              <button
                type="button"
                className="ov-btn ov-btn-outline text-[11.5px]"
                onClick={() => navigate('/user/cli-guide')}
              >
                <TerminalIcon />
                Run aikey login
              </button>
              <button
                type="button"
                className="ov-btn ov-btn-ghost text-[11.5px]"
                onClick={() => navigate('/user/cli-guide')}
              >
                <BookIcon />
                CLI guide
              </button>
              <span
                className="ml-auto text-[12px] font-mono"
                style={{ color: 'var(--muted-foreground)' }}
              >
                Last refresh:{' '}
                <span style={{ color: '#d4d4d8' }}>{lastRefreshed ?? '—'}</span>
              </span>
            </div>
          </div>
        </section>

        {/* ── Organizations & Seats ── */}
        <section className="card">
          <div className="card-header">
            <span className="card-title" style={{ color: 'var(--muted-foreground)' }}>
              <BuildingIcon />
              My Organizations &amp; Seats
            </span>
            <span
              className="text-[12px] font-mono"
              style={{ color: 'var(--muted-foreground)' }}
            >
              {seats.length} seat{seats.length === 1 ? '' : 's'}
            </span>
          </div>

          {seats.length === 0 ? (
            <div className="empty">
              {/* Avoid the class name `ring` — Tailwind ships a utility of the same
                  name that attaches a blue box-shadow, which overrides our styling. */}
              <div className="empty-ring">
                <BuildingSolidIcon />
              </div>
              <div
                className="text-[13px] font-medium"
                style={{ color: 'var(--muted-foreground)' }}
              >
                No seats assigned yet
              </div>
              <p className="text-[12px] font-mono mt-1 max-w-sm">
                Ask a team admin to invite you, or spin up your own workspace to start
                importing keys.
              </p>
              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  className="ov-btn ov-btn-outline text-[11.5px]"
                  onClick={() => window.open('mailto:?subject=AiKey%20invite%20request', '_blank')}
                >
                  <MailIcon />
                  Request an invite
                </button>
                <button
                  type="button"
                  className="ov-btn ov-btn-ghost text-[11.5px]"
                  onClick={() => navigate('/user/cli-guide')}
                >
                  <BookIcon />
                  Learn about seats
                </button>
              </div>
            </div>
          ) : (
            <ul>
              {seats.map((s, idx) => {
                const counts = keysPerSeat(s.seat_id);
                return (
                  <li key={s.seat_id} className="seat-row">
                    <div className="seat-row-head">
                      <div className="min-w-0">
                        <div className="text-[10px] font-mono tracking-widest uppercase" style={{ color: 'var(--muted-foreground)' }}>
                          Organization
                        </div>
                        <div
                          className="text-[13px] font-mono font-semibold truncate"
                          style={{ color: '#d4d4d8' }}
                          title={s.org_id}
                        >
                          {truncateId(s.org_id)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <SeatStatusChip status={s.seat_status} />
                        {idx === 0 && <span className="chip-muted">DEFAULT</span>}
                      </div>
                    </div>
                    <div className="seat-row-meta">
                      <Meta label="Seat ID" value={truncateId(s.seat_id)} />
                      <Meta
                        label="Joined"
                        value={s.claimed_at ? new Date(s.claimed_at).toLocaleDateString(navigator.language) : '—'}
                      />
                      <div>
                        <div className="field-label">Allocated keys</div>
                        <div className="text-[13px] font-mono">
                          <span style={{ color: '#4ade80', fontWeight: 600 }}>
                            {counts.active} active
                          </span>
                          <span className="mx-2" style={{ color: 'var(--muted-foreground)' }}>
                            ·
                          </span>
                          {counts.pending > 0 ? (
                            <span style={{ color: 'var(--primary)', fontWeight: 600 }}>
                              {counts.pending} pending
                            </span>
                          ) : (
                            <span style={{ color: 'var(--muted-foreground)' }}>0 pending</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/* ── helpers ────────────────────────────────────────────────────────── */

function truncateId(id: string): string {
  if (!id) return '—';
  if (id.length <= 16) return id;
  return `${id.slice(0, 16)}…`;
}

/** Locale-aware relative time via the shared `Intl.RelativeTimeFormat`
 * helper. Falls back to the absolute date when the delta is too far
 * out for a relative string to read naturally. */
function relativeTime(d: Date): string {
  return formatRelativeTime(d) || d.toLocaleDateString(navigator.language);
}

function Field({
  label,
  value,
  mono,
  title,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  title?: string;
}) {
  const isEmpty = !value;
  return (
    <div>
      <div className="field-label">{label}</div>
      <div
        className={`field-value ${mono ? 'mono' : ''} ${isEmpty ? 'dim' : ''}`}
        title={title}
      >
        {value ?? '—'}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="field-label">{label}</div>
      <div className="text-[13px] font-mono" style={{ color: '#d4d4d8' }}>
        {value}
      </div>
    </div>
  );
}

function SeatStatusChip({ status }: { status: string }) {
  if (status === 'active') {
    return (
      <span className="chip-status" style={chipColors('#4ade80')}>
        <span className="chip-dot" style={{ background: '#4ade80' }} />
        {status.toUpperCase()}
      </span>
    );
  }
  if (status === 'pending_claim') {
    return (
      <span className="chip-status" style={chipColors('var(--primary)')}>
        {status.toUpperCase()}
      </span>
    );
  }
  if (status === 'suspended' || status === 'revoked') {
    return (
      <span className="chip-status" style={chipColors('#f87171')}>
        {status.toUpperCase()}
      </span>
    );
  }
  return <span className="chip-muted">{status.toUpperCase()}</span>;
}

function chipColors(color: string) {
  return {
    color,
    background:
      color === '#4ade80'
        ? 'rgba(74,222,128,0.08)'
        : color === '#f87171'
          ? 'rgba(248,113,113,0.08)'
          : 'rgba(250, 204, 21,0.08)',
    borderColor:
      color === '#4ade80'
        ? 'rgba(74,222,128,0.3)'
        : color === '#f87171'
          ? 'rgba(248,113,113,0.3)'
          : 'rgba(250, 204, 21,0.3)',
  };
}

/* ── Inline icons ───────────────────────────────────────────────────── */

function FingerprintIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.864 4.243A7.5 7.5 0 0119.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 004.5 10.5a48.667 48.667 0 00-1.233 8.568M12 10.5a3 3 0 11-6 0 3 3 0 016 0zm-3 0v6.75" />
    </svg>
  );
}
function RefreshIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
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
function BookIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  );
}
function BuildingIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
    </svg>
  );
}
function BuildingSolidIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
    </svg>
  );
}
function MailIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
    </svg>
  );
}

/* Suppress unused-import warning for SeatSummaryDTO if callers ever narrow seats. */
export type { SeatSummaryDTO };

/* ── Scoped CSS ─────────────────────────────────────────────────────── */

const ACCOUNT_CSS = `
.account-page .card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  position: relative;
  overflow: hidden;
}
.account-page .card.accent::before {
  content: "";
  position: absolute; left: 0; top: 0; bottom: 0;
  width: 3px;
  /* Dark-yellow (#ca8a04 amber-600) rather than the bright --primary
     (#facc15) — matches the in-use indicator + chart accents + bulk
     import buttons elsewhere in the app, keeping the bright yellow
     reserved for interactive chrome (buttons / focus rings). */
  background: #ca8a04;
  box-shadow: 0 0 10px rgba(202, 138, 4, 0.45);
}
.account-page .card-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.75rem 1.1rem;
  border-bottom: 1px solid var(--border);
  background: rgba(0, 0, 0, 0.15);
}
.account-page .card-title {
  display: inline-flex; align-items: center; gap: 0.5rem;
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted-foreground);
  font-weight: 700;
}
.account-page .card.accent .card-title { color: var(--muted-foreground); }

.account-page .status-dot {
  width: 6px; height: 6px; border-radius: 999px;
  background: #4ade80;
  box-shadow: 0 0 6px rgba(74, 222, 128, 0.7);
}

.account-page .field-label {
  font-family: monospace;
  font-size: 10px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted-foreground);
  margin-bottom: 0.4rem;
}
.account-page .field-value {
  font-size: 15px;
  color: #d4d4d8;
  font-weight: 500;
  word-break: break-all;
}
.account-page .field-value.mono {
  font-family: monospace;
  font-size: 13px;
  font-weight: 400;
}
.account-page .field-value.dim {
  color: var(--muted-foreground);
}

.account-page .role-badge {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 3px 8px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 11px;
  letter-spacing: 0.05em;
  background: rgba(0,0,0,0.25);
  border: 1px solid var(--border);
  color: var(--muted-foreground);
}
.account-page .role-badge .dot {
  width: 6px; height: 6px; border-radius: 999px;
  background: #4ade80;
  box-shadow: 0 0 6px rgba(74, 222, 128, 0.6);
}

.account-page .empty {
  padding: 3rem 1rem;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center;
  color: var(--muted-foreground);
}
.account-page .empty .empty-ring {
  width: 44px; height: 44px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 999px;
  background: rgba(0,0,0,0.25);
  border: 1px solid var(--border);
  color: var(--muted-foreground);
  margin-bottom: 0.8rem;
}

.account-page .seat-row {
  padding: 1rem 1.1rem;
  border-bottom: 1px solid var(--border);
}
/* Keep the last seat row's bottom border — stacks with the card's
   outer bottom border to produce the master-style "double line" at
   the end of the list. */
.account-page .seat-row-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}
.account-page .seat-row-meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}

.account-page .chip-status {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 2px 7px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 10.5px;
  letter-spacing: 0.05em;
  border: 1px solid transparent;
}
.account-page .chip-dot {
  width: 5px; height: 5px; border-radius: 999px;
}
.account-page .chip-muted {
  display: inline-flex; align-items: center;
  padding: 2px 7px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 10px;
  letter-spacing: 0.05em;
  background: rgba(255,255,255,0.03);
  border: 1px solid var(--border);
  color: var(--muted-foreground);
}

.account-page .ov-btn {
  display: inline-flex; align-items: center; gap: 0.4rem;
  font-weight: 600;
  border-radius: 6px;
  transition: background 150ms ease, border-color 150ms ease, color 120ms ease;
  cursor: pointer;
  border: 1px solid transparent;
  white-space: nowrap;
  padding: 5px 12px;
  background: transparent;
}
.account-page .ov-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.account-page .ov-btn-outline {
  background: rgba(0,0,0,0.25);
  color: var(--muted-foreground);
  border-color: var(--border);
}
.account-page .ov-btn-outline:hover:not(:disabled) {
  color: var(--foreground);
  border-color: var(--muted-foreground);
  background: rgba(255,255,255,0.03);
}
.account-page .ov-btn-ghost { color: var(--muted-foreground); }
.account-page .ov-btn-ghost:hover {
  color: var(--foreground);
  background: rgba(255,255,255,0.03);
}
`;
