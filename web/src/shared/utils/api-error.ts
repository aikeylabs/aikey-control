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
  BIZ_KEY_ALIAS_TAKEN:        'This virtual key alias is already in use for this seat. Choose a different alias.',
  BIZ_CRED_NAME_TAKEN:        'A credential with this name already exists. Use a different display name.',
  BIZ_PROV_CODE_TAKEN:        'A provider with this code already exists. Use a different provider code.',

  // BIZ — Credential
  BIZ_CRED_NOT_FOUND: 'The credential was not found. It may have been deleted from Provider Accounts.',
  BIZ_CRED_INACTIVE:  'This credential is not active. Go to Provider Accounts and rotate or replace it.',

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
