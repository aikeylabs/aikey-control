/**
 * Map CLI vault-op `use` error responses to user-readable strings shown in
 * the virtual-keys drawer. Stage 7-2 of the active-state cross-shell sync
 * plan (2026-04-27) — Error-code list comes from the CLI's `handle_use`
 * team branch in commands_internal/vault_op.rs.
 *
 * Why a dedicated mapper (and not just `err.message`):
 * - HTTP 401 from the unlock middleware is a different fix path than
 *   "key revoked": the user needs to navigate to the vault page first
 * - Stale local cache (I_KEY_STALE) tells the user to run
 *   `aikey key sync`, not retry blindly
 * - Falling back to the raw error message is fine but loses the
 *   call-to-action on the common cases
 *
 * Keep this map in sync if the CLI introduces new codes — see CLAUDE.md
 * §"systemic-fix-propagation" — propagate from CLI -> Go handler error
 * envelope -> here. Not having a mapping is OK (we fall back to the raw
 * message), but the common cases should be explicit.
 *
 * Pure function — extracted to its own module so it can be unit tested
 * without dragging in the React component tree (the host page does not
 * yet have a frontend test runner; this module is ready for one).
 */
export function mapUseError(err: unknown): string {
  // Errors from axios / fetch wrappers can shape the payload several ways
  // depending on whether httpClient unwrapped the envelope or not. Read all
  // common shapes defensively and pick the first non-empty signal.
  const e = err as {
    error_code?: string;
    error_message?: string;
    response?: {
      status?: number;
      data?: { error_code?: string; error_message?: string };
    };
    message?: string;
  };
  const status = e?.response?.status;
  const code = e?.error_code ?? e?.response?.data?.error_code;
  const msg =
    e?.error_message ??
    e?.response?.data?.error_message ??
    e?.message ??
    'Failed to set as active.';
  if (status === 401 || code === 'I_VAULT_LOCKED') {
    return 'Vault is locked. Unlock it on the Vault page first, then retry.';
  }
  switch (code) {
    case 'I_KEY_DISABLED':
      return 'This key is disabled (revoked or out of scope) and cannot be activated.';
    case 'I_KEY_STALE':
      return 'This key is stale. Run `aikey key sync` (or refresh from server) and retry.';
    case 'I_CREDENTIAL_NOT_FOUND':
      return 'Key not found in local cache. Run `aikey key sync` to refresh.';
    case 'I_KEY_NO_PROVIDER':
      return 'This key has no provider assignment.';
    default:
      return msg;
  }
}
