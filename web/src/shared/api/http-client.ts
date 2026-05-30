/**
 * Axios HTTP client with JWT injection and 401 handling.
 */
import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { runtimeConfig } from '@/app/config/runtime';
import i18n from '@/shared/i18n/i18n';

function getToken(): string | null {
  try {
    // Master and user sessions use separate localStorage keys.
    const isUser = window.location.pathname.startsWith('/user');
    const primaryKey = isUser ? 'aikey-auth-user' : 'aikey-auth-master';
    let raw = localStorage.getItem(primaryKey);

    // Phase 3B R19 (2026-05-11): in local_bypass / trial mode, /user
    // pages fall back to the master session JWT when the dedicated
    // aikey-auth-user slot is empty. Trial composes /user/* and
    // /master/* on a single backend with one JWT secret, so a master
    // login authoritatively identifies the same user on /user
    // endpoints too. Without this fallback, /user/account always
    // shows the anonymous local-owner identity (local@localhost) even
    // after the admin signed in via /master/login — defeating the
    // "trial defaults to JWT with graceful fallback" intent.
    //
    // Production (jwt mode) is unaffected: the master JWT is bound
    // to master-side claims and won't satisfy /user JWTMiddleware
    // requirements there, but jwt-mode trial doesn't exist as a
    // production target.
    if (!raw && isUser && runtimeConfig.authMode === 'local_bypass') {
      raw = localStorage.getItem('aikey-auth-master');
    }

    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { token?: string } };
    return parsed?.state?.token ?? null;
  } catch {
    return null;
  }
}

/** Whether the current page is under /user (as opposed to /master). */
function isUserPath(): boolean {
  return window.location.pathname.startsWith('/user');
}

function redirectToLogin() {
  // User console: session comes from CLI (`aikey web`), not password login.
  // Redirect to a session-expired page instead of a login form.
  window.location.href = isUserPath() ? '/user/session-expired' : '/master/login';
}

function createHttpClient(config?: AxiosRequestConfig): AxiosInstance {
  const client = axios.create({
    baseURL: runtimeConfig.apiBaseUrl,
    timeout: 30_000,
    headers: {
      'Content-Type': 'application/json',
    },
    ...config,
  });

  // Attach Bearer token on every request when one is available.
  //
  // Phase 3B R19 (2026-05-11): always send the token when present —
  // previously local_bypass + /user paths skipped the token entirely,
  // which forced /user/account to render anonymous local-owner data
  // even after the admin logged in via /master/login. Backend's
  // LocalIdentityMiddleware uses the token when valid and falls back
  // to anonymous (LocalOwnerAccountID) when absent or unverifiable —
  // so "always send if present" is safe in both auth modes:
  //   - jwt mode + valid token   → real identity
  //   - jwt mode + no token      → 401 (handled by response interceptor)
  //   - local_bypass + valid     → real identity (via JWT verify branch)
  //   - local_bypass + absent    → local-owner fallback
  client.interceptors.request.use((req) => {
    const token = getToken();
    if (token && req.headers) {
      req.headers['Authorization'] = `Bearer ${token}`;
    }
    // Send the active UI language so backend error messages come back
    // localized. CLI/curl send no Accept-Language → backend defaults to en;
    // the web app sends en/zh to match what the user is reading.
    if (req.headers) {
      req.headers['Accept-Language'] = i18n.resolvedLanguage || i18n.language || 'en';
    }
    return req;
  });

  // Handle 401 globally.
  // In local_bypass mode, /user API calls should never 401 (LocalIdentity
  // middleware always succeeds), so skip the redirect for /user paths.
  client.interceptors.response.use(
    (res) => res,
    (err) => {
      const shouldHandle =
        axios.isAxiosError(err) &&
        err.response?.status === 401 &&
        !(runtimeConfig.authMode === 'local_bypass' && isUserPath());

      if (shouldHandle) {
        const url = err.config?.url ?? '';
        const isLoginEndpoint = url.includes('/accounts/login');
        if (!isLoginEndpoint) {
          const isUser = isUserPath();
          localStorage.removeItem(isUser ? 'aikey-auth-user' : 'aikey-auth-master');
          redirectToLogin();
        }
      }
      return Promise.reject(err);
    }
  );

  return client;
}

export const httpClient = createHttpClient();
