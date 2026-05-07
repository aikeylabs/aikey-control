/**
 * Axios HTTP client with JWT injection and 401 handling.
 */
import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { runtimeConfig } from '@/app/config/runtime';

function getToken(): string | null {
  try {
    // User session lives in its own localStorage key (`aikey-auth-user`).
    // The master-edition console (private repo) uses a separate store; the
    // two coexist in the same browser without bleeding into each other.
    const raw = localStorage.getItem('aikey-auth-user');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { token?: string } };
    return parsed?.state?.token ?? null;
  } catch {
    return null;
  }
}

/** Whether the current page is a user-side route. Always true in this build. */
function isUserPath(): boolean {
  return window.location.pathname.startsWith('/user');
}

function redirectToLogin() {
  // User console: session comes from CLI (`aikey web`), not password login.
  // Redirect to a session-expired page instead of a login form.
  window.location.href = '/user/session-expired';
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

  // Attach Bearer token on every request.
  // In local_bypass mode, /user pages don't need JWT (backend uses
  // LocalIdentityMiddleware). /master pages still send their JWT.
  client.interceptors.request.use((req) => {
    const skipToken =
      runtimeConfig.authMode === 'local_bypass' && isUserPath();
    if (!skipToken) {
      const token = getToken();
      if (token && req.headers) {
        req.headers['Authorization'] = `Bearer ${token}`;
      }
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
