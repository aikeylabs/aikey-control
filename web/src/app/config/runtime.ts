/**
 * Runtime configuration – loaded at startup.
 * Values can be overridden via window.__AIKEY_CONFIG__ injected by the server.
 */
export interface RuntimeConfig {
  apiBaseUrl: string;
  authMode: 'jwt' | 'local_bypass';
  /** 2026-06-03: which deployment kind hosts this bundle, used by UserShell
   *  to short-circuit the otherBaseUrl-based `isSingleBinaryComposed`
   *  detection.
   *
   *  - 'trial'      : aikey-full-trial single binary serving master + user
   *                   on one port. The "other side" doesn't exist — sidebar
   *                   nav must render every item locally (no cross-app
   *                   trailers). Without this signal, a stale
   *                   `aikey-cross-app:personal-base-url` localStorage
   *                   entry (left over from a past `aikey login` to a
   *                   team server) makes the detection think a team URL
   *                   exists, and Vault / Performance / Apps / Trust Check /
   *                   Compliance Audit / Invites all silently render as
   *                   cross-app trailers pointing at that stale URL.
   *  - 'personal'   : Personal local-server (Standalone aikey-local-server,
   *                   port 8090, user routes only). The other side (when
   *                   present) IS a real team server.
   *  - 'production' : Team / production server (Standalone). The other
   *                   side is the user's personal local-server (loopback).
   *  - undefined    : unknown / default. Detection falls back to the
   *                   otherBaseUrl origin comparison, same as pre-fix.
   */
  controlPlaneMode?: 'trial' | 'personal' | 'production';
  /** 2026-07-03 unified-origin gateway (option 6): base path the PERSONAL
   *  usage charts read from. Injected as "/api/user/usage/personal" only by
   *  the Personal local-server embed; every other host omits it and the
   *  shared usage client falls back to "/v1/usage/personal" — which is the
   *  team server's own path on a direct visit, and is forwarded to the team
   *  server by the composing gateway on a composed visit. One field, four
   *  deployment quadrants, no heuristics — do NOT infer this from
   *  authMode/controlPlaneMode (the gateway patch masquerades team pages as
   *  local_bypass, which would misroute team usage to local data). */
  usageApiBase?: string;
  /** 2026-07-03 composing gateway, dual-homed family #3: base for the
   *  /accounts/me/* VAULT-BRIDGE data endpoints (all-keys / pending-keys /
   *  seats / sync-version / managed-keys-snapshot). Same four-quadrant rule
   *  as usageApiBase: ONLY the Personal local-server embed injects
   *  "/api/user/vault-bridge" (local merged-vault views for A pages);
   *  everywhere else the shared clients fall back to "/accounts/me" — B's
   *  own path on a direct visit, forwarded to B by the gateway on a
   *  composed visit (Team Keys delivery state). */
  vaultBridgeApiBase?: string;
  /** 2026-07-04 composing gateway: TRUE only in a B page forwarded + patched
   *  by the local gateway (the injected `__AIKEY_CONFIG__` carries it). It is
   *  the authoritative "this local_bypass page is actually a forwarded TEAM
   *  page" signal — Personal-local, Trial, and direct-B visits never set it.
   *
   *  WHY it exists: usageApiBase fixed WHICH backend the usage charts read,
   *  but the pages ALSO derive their query IDENTITY (org_id=personal vs
   *  account_id) from `authMode==='local_bypass'` — the exact "infer from
   *  authMode" mistake usageApiBase's doc warns against. A forwarded team page
   *  is local_bypass, so it wrongly queried org_id=personal against the team
   *  server (which has no personal-org rows) → empty team-usage/detail/
   *  performance/overview. Gate `isLocalMode` on `!teamGateway` so the
   *  forwarded page uses the member's account_id instead. */
  teamGateway?: boolean;
  /** 2026-08-18 App install guide (/user/app-guide, master-repo-local page):
   *  optional URLs of the desktop packages a TEAM deployment hosts. Declared
   *  here only because the two repos' RuntimeConfig interfaces share one
   *  global `window.__AIKEY_CONFIG__` declaration and must stay identical
   *  (TS2717 otherwise). The Personal console itself never reads it. */
  appDownloads?: {
    darwinDmg?: string;
    windowsZip?: string;
  };
  featureFlags: {
    usageLedger: boolean;
    controlEvents: boolean;
    providerRotation: boolean;
    userConsoleEntry: boolean;
  };
  branding: {
    appName: string;
    logoText: string;
  };
  buildVersion: string;
}

const defaultConfig: RuntimeConfig = {
  // Dev: empty string → requests go through Vite proxy (same-origin, no CORS).
  // Production: same-origin by default, or override via window.__AIKEY_CONFIG__.
  apiBaseUrl: '',
  authMode: 'jwt',
  featureFlags: {
    usageLedger: false,
    controlEvents: true,
    providerRotation: true,
    userConsoleEntry: false,
  },
  branding: {
    // Single short brand string shared across user / master / cli-guide /
    // session-expired / login footers. Renamed 2026-04-22 from
    // "AiKey Control" → "AiKey" to match the user-web shell title and
    // browser-tab `<title>` (index.html). Server can still override via
    // `window.__AIKEY_CONFIG__.branding.{appName,logoText}` if a deployment
    // wants distinct labels per surface.
    appName: 'AiKey',
    logoText: 'AiKey',
  },
  buildVersion: '0.1.0',
};

declare global {
  interface Window {
    __AIKEY_CONFIG__?: Partial<RuntimeConfig>;
    // Injected by the Personal composing gateway (aikey-trial-server
    // serveTeamDownShell) ONLY when it served the LOCAL shell as a team-page
    // fallback because the team server (B) was unreachable. Absent in every
    // other context (normal local pages, Trial, direct-B). The Personal
    // router's catch-all renders the in-shell "team unreachable" page when it
    // is present. A transient degrade signal — not app config.
    __AIKEY_TEAM_DOWN__?: { code: string; path: string };
  }
}

/**
 * Merge server-injected config with defaults.
 * The server may inject window.__AIKEY_CONFIG__ in the HTML to override values.
 */
export function loadRuntimeConfig(): RuntimeConfig {
  const override = window.__AIKEY_CONFIG__ ?? {};
  return {
    ...defaultConfig,
    ...override,
    featureFlags: {
      ...defaultConfig.featureFlags,
      ...(override.featureFlags ?? {}),
    },
    branding: {
      ...defaultConfig.branding,
      ...(override.branding ?? {}),
    },
  };
}

export const runtimeConfig = loadRuntimeConfig();
