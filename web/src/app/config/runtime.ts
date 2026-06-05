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
