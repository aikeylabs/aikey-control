import React, { useEffect } from 'react';
import { Outlet, NavLink, useParams, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useMasterAuthStore, useOrgStore } from '@/store';
import { orgsApi } from '@/shared/api/master/orgs';
import { runtimeConfig } from '@/app/config/runtime';

// ── Sidebar nav items ──────────────────────────────────────────────────────

interface NavItem {
  label: string;
  icon: React.ReactNode;
  path: (orgId: string) => string;
  group?: string;
}

function KeyIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
    </svg>
  );
}

function ChannelsIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
    </svg>
  );
}

function ServerIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 003 3h10.5a3 3 0 003-3m-16.5 0V9.75m0 0a3 3 0 013-3h10.5a3 3 0 013 3m-16.5 0h16.5m-3 0a3 3 0 00-3 3M6.75 9.75a3 3 0 003 3" />
    </svg>
  );
}

function ReceiptIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 14.25l6-6m4.5-3.493V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0c1.1.128 1.907 1.077 1.907 2.185zM9.75 9h.008v.008H9.75V9zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 4.5h.008v.008h-.008V13.5zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
    </svg>
  );
}

function ShieldAlertIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

function ChevronDownIcon({ className = 'w-3 h-3' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

function UnlockIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  );
}

// ── Breadcrumb helper ──────────────────────────────────────────────────────

const ROUTE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  seats: 'Org Seats',
  'virtual-keys': 'Virtual Keys',
  bindings: 'Protocol Channels',
  'provider-accounts': 'Provider Accounts',
  'control-events': 'Control Events',
  'usage-ledger': 'Usage Ledger',
};

function useBreadcrumb() {
  const { pathname } = useLocation();
  const segments = pathname.split('/').filter(Boolean);
  // e.g. ['master', 'orgs', 'abc', 'seats'] or ['master', 'dashboard']
  const last = segments[segments.length - 1];
  return ROUTE_LABELS[last] ?? last;
}

// ── User initials helper ───────────────────────────────────────────────────

function initials(email: string): string {
  const parts = email.split('@')[0].split(/[._-]/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

// ── AppShell ──────────────────────────────────────────────────────────────

export function AppShell() {
  const { orgId: orgIdFromParams } = useParams<{ orgId: string }>();
  const user = useMasterAuthStore((s) => s.user);
  const clearAuth = useMasterAuthStore((s) => s.clearAuth);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const pageLabel = useBreadcrumb();

  const currentOrgId = useOrgStore((s) => s.currentOrgId);
  const setCurrentOrgId = useOrgStore((s) => s.setCurrentOrgId);

  // Load orgs and set current org on first load
  const { data: orgs } = useQuery({
    queryKey: ['orgs'],
    queryFn: () => orgsApi.list(),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!orgs || orgs.length === 0) return;
    if (orgIdFromParams) {
      // Validate orgId from URL — redirect to first org if invalid.
      const validOrg = orgs.find((o) => o.org_id === orgIdFromParams);
      if (validOrg) {
        if (orgIdFromParams !== currentOrgId) setCurrentOrgId(orgIdFromParams);
      } else {
        // Invalid orgId in URL (e.g. "virtual-keys" parsed as :orgId) — fix it.
        const fallbackOrgId = orgs[0].org_id;
        setCurrentOrgId(fallbackOrgId);
        // Replace the bad orgId segment in the URL.
        const fixedPath = pathname.replace(`/orgs/${orgIdFromParams}`, `/orgs/${fallbackOrgId}`);
        navigate(fixedPath, { replace: true });
      }
    } else if (!currentOrgId || !orgs.find((o) => o.org_id === currentOrgId)) {
      setCurrentOrgId(orgs[0].org_id);
    }
  }, [orgs, orgIdFromParams, currentOrgId, setCurrentOrgId, pathname, navigate]);

  // Effective orgId for sidebar links
  const orgId = currentOrgId ?? orgs?.[0]?.org_id ?? '';

  const logoText = runtimeConfig.branding.logoText;

  function isActive(path: string) {
    return pathname === path || pathname.startsWith(path + '/');
  }

  return (
    <div className="flex h-screen overflow-hidden antialiased" style={{ backgroundColor: 'var(--background)' }}>
      {/* ── Sidebar ── */}
      <aside
        className="flex-shrink-0 flex flex-col z-20"
        style={{
          width: 280,
          backgroundColor: 'var(--sidebar)',
          borderRight: '1px solid var(--sidebar-border)',
          boxShadow: '4px 0 24px rgba(0,0,0,0.5)',
        }}
      >
        {/* Logo */}
        <div
          className="h-16 flex items-center justify-center relative flex-shrink-0"
          style={{ borderBottom: '1px solid var(--sidebar-border)' }}
        >
          {/* Top glow line */}
          <div
            className="absolute top-0 left-0 w-full h-px"
            style={{
              backgroundColor: 'var(--primary)',
              opacity: 0.5,
              boxShadow: '0 0 10px rgba(250,204,21,0.5)',
            }}
          />
          <div
            className="flex items-center gap-2 font-mono font-bold tracking-widest text-lg"
            style={{ color: 'var(--foreground)' }}
          >
            <KeyIcon className="w-5 h-5" />
            <span>{logoText}</span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3">
          {/* Top-level: Dashboard */}
          <NavLink
            to="/master/dashboard"
            className={`nav-item ${isActive('/master/dashboard') ? 'active' : ''}`}
          >
            <DashboardIcon />
            <span className="ml-3">Dashboard</span>
          </NavLink>

          {/* Group: Assets & Control */}
          <div className="nav-group-title">Assets &amp; Control</div>

          <NavLink
            to={`/master/orgs/${orgId}/seats`}
            className={`nav-item ${isActive(`/master/orgs/${orgId}/seats`) ? 'active' : ''}`}
          >
            <UsersIcon />
            <span className="ml-3">Org Seats</span>
          </NavLink>

          <NavLink
            to={`/master/orgs/${orgId}/virtual-keys`}
            className={`nav-item ${isActive(`/master/orgs/${orgId}/virtual-keys`) ? 'active' : ''}`}
          >
            <KeyIcon />
            <span className="ml-3">Virtual Keys</span>
          </NavLink>

          <NavLink
            to={`/master/orgs/${orgId}/bindings`}
            className={`nav-item ${isActive(`/master/orgs/${orgId}/bindings`) ? 'active' : ''}`}
          >
            <ChannelsIcon />
            <span className="ml-3">Protocol Channels</span>
          </NavLink>

          <NavLink
            to={`/master/orgs/${orgId}/provider-accounts`}
            className={`nav-item ${isActive(`/master/orgs/${orgId}/provider-accounts`) ? 'active' : ''}`}
          >
            <ServerIcon />
            <span className="ml-3">Provider Accounts</span>
          </NavLink>

          {/* Group: FinOps & Audit */}
          <div className="nav-group-title">FinOps &amp; Audit</div>

          <NavLink
            to={`/master/orgs/${orgId}/usage-ledger`}
            className={`nav-item ${isActive(`/master/orgs/${orgId}/usage-ledger`) ? 'active' : ''}`}
          >
            <ReceiptIcon />
            <span className="ml-3">Usage Ledger</span>
          </NavLink>

          <NavLink
            to={`/master/orgs/${orgId}/control-events`}
            className={`nav-item ${isActive(`/master/orgs/${orgId}/control-events`) ? 'active' : ''}`}
          >
            <ShieldAlertIcon />
            <span className="ml-3">Control Events</span>
          </NavLink>
        </nav>

        {/* Bottom: Vault Status + User */}
        <div
          className="p-4 flex-shrink-0"
          style={{
            borderTop: '1px solid var(--sidebar-border)',
            backgroundColor: 'rgba(0,0,0,0.2)',
          }}
        >
          {/* Vault status */}
          <div
            className="flex items-center justify-between mb-3 px-3 py-2 rounded"
            style={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
            }}
          >
            <span
              className="text-xs font-mono font-bold"
              style={{ color: 'var(--muted-foreground)' }}
            >
              Vault Status
            </span>
            <div className="flex items-center gap-2">
              <span
                className="text-xs font-mono font-bold"
                style={{ color: 'var(--foreground)' }}
              >
                Secure
              </span>
              <div className="w-2 h-2 rounded-full dot-glow-green" />
            </div>
          </div>

          {/* User info */}
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded flex items-center justify-center text-xs font-mono font-bold flex-shrink-0"
              style={{
                backgroundColor: 'var(--secondary)',
                border: '1px solid var(--border)',
                color: 'var(--foreground)',
              }}
            >
              {user?.email ? initials(user.email) : 'AD'}
            </div>
            <div className="flex-1 min-w-0">
              <div
                className="text-sm font-medium truncate"
                style={{ color: 'var(--foreground)' }}
              >
                {user?.email ?? 'admin@org.com'}
              </div>
              <div className="text-xs font-mono truncate" style={{ color: 'var(--muted-foreground)' }}>
                {user?.role ?? 'Platform Admin'}
              </div>
            </div>
            {/* Logout */}
            <button
              onClick={clearAuth}
              className="text-xs"
              style={{ color: 'var(--muted-foreground)' }}
              title="Sign out"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Top header */}
        <header
          className="vault-header h-16 flex items-center justify-between px-6 flex-shrink-0 z-10"
        >
          {/* Breadcrumb */}
          <div className="flex items-center text-sm font-mono" style={{ color: 'var(--muted-foreground)' }}>
            <span>Control Panel</span>
            <span className="mx-2 opacity-50">/</span>
            <span className="font-bold" style={{ color: 'var(--foreground)' }}>
              {pageLabel}
            </span>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-4">
            <div
              className="flex items-center px-3 py-1.5 rounded text-xs font-mono"
              style={{
                border: '1px solid var(--border)',
                backgroundColor: 'rgba(0,0,0,0.2)',
              }}
            >
              <span style={{ color: 'var(--muted-foreground)' }} className="mr-2">
                Org:
              </span>
              <span className="font-bold mr-1" style={{ color: 'var(--foreground)' }}>
                {orgs?.find((o) => o.org_id === orgId)?.name ?? (orgId ? orgId.slice(0, 8) : '—')}
              </span>
              <ChevronDownIcon />
            </div>

            <div
              className="flex items-center px-3 py-1.5 rounded text-xs font-mono"
              style={{
                border: '1px solid var(--border)',
                backgroundColor: 'rgba(0,0,0,0.2)',
              }}
            >
              <span style={{ color: 'var(--muted-foreground)' }} className="mr-2">
                Env:
              </span>
              <div className="w-1.5 h-1.5 rounded-full dot-glow-red mr-2" />
              <span className="font-bold mr-1" style={{ color: 'var(--foreground)' }}>
                Production
              </span>
              <ChevronDownIcon />
            </div>

            <button className="btn btn-primary py-1.5 px-4 text-xs flex items-center gap-2">
              <UnlockIcon />
              Issue Key
            </button>
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
