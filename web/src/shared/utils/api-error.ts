import axios from 'axios';

export interface ApiError {
  /** Machine-readable error code from the server */
  code: string;
  /** Human-readable error description from the server */
  message: string;
  /** Actionable next-step hint generated on the frontend */
  suggestion?: string;
  // DATA error meta
  field?: string;
  rule?: string;
  // EXT error meta
  provider?: string;
  upstream_status?: number;
  upstream_message?: string;
  expected_provider?: string;
  actual_provider?: string;
  expected_group_id?: string;
  actual_group_id?: string;
  expected_account_id?: string;
  actual_account_id?: string;
  routed_count?: number;
}

// ── Suggestions map (kept in sync with service/internal/shared/errors.go) ─────
//
// Describes what the user should do next for each error code.
// Descriptions for the error itself come from the server message field.

const SUGGESTIONS: Record<string, string> = {
  // BIZ — Auth
  BIZ_AUTH_EMAIL_TAKEN:         'Use a different email address or log in to the existing account.',
  BIZ_AUTH_INVALID_CREDENTIALS: 'Check your email and password and try again. Use "Forgot password" if needed.',
  BIZ_AUTH_ACCOUNT_INACTIVE:    'Contact your administrator to reactivate the account.',
  BIZ_AUTH_TOKEN_INVALID:       'The token is not recognised. Verify the value and try again.',
  BIZ_AUTH_TOKEN_REVOKED:       'This virtual key has been revoked. Issue a new key from your keys page.',
  BIZ_AUTH_TOKEN_EXPIRED:       'This virtual key has expired. Issue a new key or extend the expiry from your keys page.',
  BIZ_AUTH_TOKEN_RECYCLED:      'A newer token has been issued for this seat. Fetch the latest key from the CLI.',
  BIZ_AUTH_TOKEN_NOT_ACTIVE:    'This virtual key is not in an active state. Check its status on your keys page.',
  BIZ_AUTH_ACCESS_DENIED:       'You do not have permission to perform this action. Contact your administrator.',

  // BIZ — Member SSO
  BIZ_SSO_PROVIDER_DISABLED: 'Ask your administrator to enable and configure this SSO provider.',
  BIZ_SSO_STATE_INVALID:     'Restart aikey login and begin a new SSO attempt.',
  BIZ_SSO_EXCHANGE_FAILED:   'Try signing in again. If the problem continues, ask your administrator to verify the SSO configuration.',
  BIZ_SSO_TENANT_MISMATCH:   'Use an account from your organization’s configured SSO tenant.',
  BIZ_SSO_IDENTITY_CONFLICT: 'Sign in with the account already linked to this SSO identity or contact your administrator.',

  // BIZ — Org
  BIZ_ORG_NOT_FOUND: 'The organization was not found. It may have been deleted or the ID is incorrect.',

  // BIZ — Seat
  BIZ_SEAT_NOT_FOUND:       'The seat was not found. It may have been removed or the ID is incorrect.',
  BIZ_SEAT_EMAIL_TAKEN:     'This email already has a seat in this org. Check the Seats page for the existing entry.',
  BIZ_SEAT_ALREADY_CLAIMED: 'This seat has already been claimed. Each seat can only be claimed once.',

  // BIZ — Virtual Key
  BIZ_KEY_NOT_FOUND:          'The virtual key was not found. It may have been revoked or the ID is incorrect.',
  BIZ_KEY_NOT_ACTIVE:         'The virtual key is not active. Go to your keys page to check its current status.',
  BIZ_KEY_DUPLICATE_PROTOCOL: 'Each protocol can only be bound once per virtual key. Remove the duplicate entry.',

  // BIZ — Binding
  BIZ_BIND_NOT_FOUND:          'The protocol channel was not found. It may have been deleted.',
  BIZ_BIND_PROTOCOL_MISMATCH:  'The selected credential uses a different protocol than the channel. Choose a compatible credential.',
  BIZ_BIND_NO_ACTIVE:          'No active protocol channel exists for this key. Go to Protocol Channels and add a binding.',
  BIZ_BIND_NOT_DELIVERED:      'The binding could not be delivered to the proxy. Check that the credential is valid and the provider is reachable.',
  BIZ_BIND_ALIAS_TAKEN:        'This binding alias is already in use in this org. Choose a different alias.',
  BIZ_BIND_DUPLICATE_TARGET:   'An active binding for this protocol/provider pair already exists on this virtual key. Use a different provider or retire the existing binding first.',
  BIZ_VK_GROUP_EXCLUSIVE:      'A virtual key cannot mix an OAuth group with direct credentials. Issue a separate virtual key for this credential.',
  // 2026-07-13: a revoked key used to keep squatting on its alias forever, so
  // this fired on every re-issue and the old copy ("choose a different alias")
  // left the admin with no idea WHY — the key they'd just revoked was invisible
  // to them as the culprit. Revoking now releases the alias (v1.0.1-alpha.5), so
  // a live key is the only thing that can still hold it — say so.
  BIZ_KEY_ALIAS_TAKEN:        'An ACTIVE virtual key on this seat already uses this alias. Revoke that key first (revoking frees its alias), or choose a different alias.',
  BIZ_CRED_NAME_TAKEN:        'A credential with this name already exists. Use a different display name.',
  BIZ_PROV_CODE_TAKEN:        'A provider with this code already exists. Use a different provider code.',

  // BIZ — OAuth login binding / routing
  BIZ_OAUTH_LOGIN_BINDING_CHANGED: 'Refresh the account list and restart sign-in so the session uses the current provider and pool binding.',
  BIZ_OAUTH_LOGIN_CONTEXT_UNAVAILABLE: 'Refresh the account list. If the account is still unavailable, ask an administrator to repair its pool/provider binding.',
  BIZ_OAUTH_ROUTED_ACCOUNT_AMBIGUOUS: 'Refresh this page or upgrade the client so it sends the exact credential selected for this pool.',

  // BIZ — Credential
  BIZ_CRED_NOT_FOUND: 'The credential was not found. It may have been deleted from Provider Accounts.',
  BIZ_CRED_INACTIVE:  'This credential is not active. Go to Provider Accounts and rotate or replace it.',
  BIZ_CRED_HAS_ACTIVE_REFS: 'Migrate its active channels to another credential (Migrate action), or remove the account from its OAuth account pool, then delete again.',

  // BIZ — Provider
  BIZ_PROV_NOT_FOUND: 'The provider was not found. It may have been removed.',

  // DATA
  DATA_INVALID_BODY:  'The request could not be parsed. Check that the request body is valid JSON.',
  DATA_MISSING_FIELD: 'A required field is missing. Check that all required fields are included.',
  DATA_INVALID_FIELD: 'A field value is invalid. Review the validation rule shown above and correct the input.',

  // EXT — upstream provider errors (upstream_message in the error gives the raw provider reason)
  EXT_PROVIDER_UPSTREAM:      'The upstream provider returned an error. Check the upstream message above and verify your configuration.',
  EXT_PROVIDER_AUTH_FAILURE:  'The provider rejected the API key. Rotate the credential in Provider Accounts and try again.',
  EXT_PROVIDER_RATE_LIMITED:  'The provider is throttling requests. Wait a moment and retry, or switch to a different credential.',
  EXT_PROVIDER_UNAVAILABLE:   'The provider is unreachable. Check provider status, verify the base URL, or try again later.',

  // SYS
  SYS_ALLOCATION_ENGINE_UNAVAILABLE: 'The account is already disabled. Wait a moment and retry the delete action; do not re-enable it while reconciliation is pending.',
  SYS_INTERNAL: 'An unexpected server error occurred. The details have been logged. Contact support if the issue persists.',
  SYS_DB:       'A database error occurred. The details have been logged. Contact support if the issue persists.',
  SYS_CONFIG:   'A service configuration error occurred. Contact your administrator.',
};

/**
 * Parses an unknown thrown value (typically from an Axios request) into a
 * structured ApiError with an optional next-step suggestion and any structured
 * meta fields returned by the server (field, rule, provider, upstream_status, etc.).
 */
export function parseApiError(err: unknown): ApiError {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as Record<string, unknown> | undefined;
    if (data?.error && typeof data.error === 'string') {
      const code = data.error;
      const apiErr: ApiError = {
        code,
        message: typeof data.message === 'string' ? data.message : code,
        suggestion: SUGGESTIONS[code],
      };
      // Propagate structured meta fields from the server response
      if (typeof data.field === 'string')            apiErr.field = data.field;
      if (typeof data.rule === 'string')             apiErr.rule = data.rule;
      if (typeof data.provider === 'string')         apiErr.provider = data.provider;
      if (typeof data.upstream_status === 'number')  apiErr.upstream_status = data.upstream_status;
      if (typeof data.upstream_message === 'string') apiErr.upstream_message = data.upstream_message;
      if (typeof data.expected_provider === 'string')   apiErr.expected_provider = data.expected_provider;
      if (typeof data.actual_provider === 'string')     apiErr.actual_provider = data.actual_provider;
      if (typeof data.expected_group_id === 'string')   apiErr.expected_group_id = data.expected_group_id;
      if (typeof data.actual_group_id === 'string')     apiErr.actual_group_id = data.actual_group_id;
      if (typeof data.expected_account_id === 'string') apiErr.expected_account_id = data.expected_account_id;
      if (typeof data.actual_account_id === 'string')   apiErr.actual_account_id = data.actual_account_id;
      if (typeof data.routed_count === 'number')        apiErr.routed_count = data.routed_count;
      return apiErr;
    }
    const status = err.response?.status;
    if (status) {
      const code = `HTTP_${status}`;
      return {
        code,
        message: err.message ?? `Request failed with status ${status}`,
        suggestion:
          status === 401 ? SUGGESTIONS.BIZ_AUTH_TOKEN_INVALID :
          status === 403 ? SUGGESTIONS.BIZ_AUTH_ACCESS_DENIED :
          status === 404 ? SUGGESTIONS.BIZ_PROV_NOT_FOUND :
          status === 409 ? SUGGESTIONS.BIZ_SEAT_EMAIL_TAKEN :
          status === 422 ? SUGGESTIONS.BIZ_BIND_PROTOCOL_MISMATCH :
          SUGGESTIONS.SYS_INTERNAL,
      };
    }
  }
  if (err instanceof Error) {
    return { code: 'CLIENT_ERROR', message: err.message };
  }
  return { code: 'UNKNOWN_ERROR', message: String(err) };
}

/** Format an ApiError as a short single-line string for inline display. */
export function formatApiError(err: ApiError): string {
  return `[${err.code}] ${err.message}`;
}

// ── Friendly labels (1-2 words) for dense lists ──────────────────────────────
//
// Used in compact UI surfaces (e.g. batch issue Done step) where a long
// sentence-form server message overwhelms the row. Click-to-expand surfaces
// the raw message + suggestion when needed. Codes not listed fall back to
// "Error" — labels are an enrichment, never a correctness gate.
const LABELS: Record<string, string> = {
  // BIZ — Auth
  BIZ_AUTH_EMAIL_TAKEN:         'Email Taken',
  BIZ_AUTH_INVALID_CREDENTIALS: 'Invalid Credentials',
  BIZ_AUTH_ACCOUNT_INACTIVE:    'Account Inactive',
  BIZ_AUTH_TOKEN_INVALID:       'Invalid Token',
  BIZ_AUTH_TOKEN_REVOKED:       'Token Revoked',
  BIZ_AUTH_TOKEN_EXPIRED:       'Token Expired',
  BIZ_AUTH_TOKEN_RECYCLED:      'Token Recycled',
  BIZ_AUTH_TOKEN_NOT_ACTIVE:    'Token Inactive',
  BIZ_AUTH_ACCESS_DENIED:       'Access Denied',

  // BIZ — Org / Seat
  BIZ_ORG_NOT_FOUND:        'Org Not Found',
  BIZ_SEAT_NOT_FOUND:       'Seat Not Found',
  BIZ_SEAT_EMAIL_TAKEN:     'Seat Exists',
  BIZ_SEAT_ALREADY_CLAIMED: 'Already Claimed',

  // BIZ — Virtual Key
  BIZ_KEY_NOT_FOUND:          'Key Not Found',
  BIZ_KEY_NOT_ACTIVE:         'Key Not Active',
  BIZ_KEY_DUPLICATE_PROTOCOL: 'Duplicate Protocol',
  BIZ_KEY_ALIAS_TAKEN:        'Alias Taken',

  // BIZ — Binding
  BIZ_BIND_NOT_FOUND:         'Channel Not Found',
  BIZ_BIND_PROTOCOL_MISMATCH: 'Protocol Mismatch',
  BIZ_BIND_NO_ACTIVE:         'No Active Channel',
  BIZ_BIND_NOT_DELIVERED:     'Delivery Failed',
  BIZ_BIND_ALIAS_TAKEN:       'Alias Taken',
  BIZ_VK_GROUP_EXCLUSIVE:     'Issue a Separate Key',
  BIZ_BIND_DUPLICATE_TARGET:  'Already Issued',

  // BIZ — OAuth login binding / routing
  BIZ_OAUTH_LOGIN_BINDING_CHANGED:     'Binding Changed',
  BIZ_OAUTH_LOGIN_CONTEXT_UNAVAILABLE: 'Login Unavailable',
  BIZ_OAUTH_ROUTED_ACCOUNT_AMBIGUOUS:   'Pick Required',

  // BIZ — Credential / Provider
  BIZ_CRED_NAME_TAKEN: 'Name Taken',
  BIZ_PROV_CODE_TAKEN: 'Code Taken',
  BIZ_CRED_NOT_FOUND:  'Credential Not Found',
  BIZ_CRED_INACTIVE:   'Credential Inactive',
  BIZ_CRED_HAS_ACTIVE_REFS: 'Still In Use',
  BIZ_PROV_NOT_FOUND:  'Provider Not Found',

  // DATA
  DATA_INVALID_BODY:  'Invalid Request',
  DATA_MISSING_FIELD: 'Missing Field',
  DATA_INVALID_FIELD: 'Invalid Field',

  // EXT — upstream
  EXT_PROVIDER_UPSTREAM:     'Upstream Error',
  EXT_PROVIDER_AUTH_FAILURE: 'Provider Auth Failed',
  EXT_PROVIDER_RATE_LIMITED: 'Rate Limited',
  EXT_PROVIDER_UNAVAILABLE:  'Provider Unreachable',

  // SYS
  SYS_ALLOCATION_ENGINE_UNAVAILABLE: 'Retry Delete',
  SYS_INTERNAL: 'Server Error',
  SYS_DB:       'Database Error',
  SYS_CONFIG:   'Config Error',
};

/**
 * Returns a 1-2 word friendly label for an error code (e.g.
 * `BIZ_BIND_DUPLICATE_TARGET` → `"Already Issued"`). Falls back to
 * `"Error"` for codes not in the map. Drives the compact one-line summary
 * in dense list UIs; the raw code + message remain accessible via the
 * expand-on-click path.
 */
export function friendlyLabelFor(code: string): string {
  return LABELS[code] ?? 'Error';
}
