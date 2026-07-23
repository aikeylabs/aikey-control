/**
 * TeamVaultRecord — A-side type for a Team Key fetched from B (the
 * team server) and rendered inside A's vault page (Phase 3A).
 *
 * Distinct from PersonalVaultRecord / OAuthVaultRecord:
 *   - target='team' tags the vault-render dispatcher
 *   - NO ciphertext / nonce / token field — credential material stays
 *     in the CLI vault (decision: 凭据物质不出 vault 边界,
 *     20260511-vault-page-team-key-merged-display.md §2 决策 3)
 *   - Only `use` action available (Reveal/Rename/Delete intentionally
 *     not supported on team rows)
 *
 * Field shape mirrors B's UserKeyDTO (aikey-control-master/service/
 * pkg/userapi/handlers.go::AllMyKeys), but only the fields the vault
 * page actually renders are required — extras are tolerated and
 * ignored, so B can evolve the wire shape additively without breaking
 * A's parser.
 */

/**
 * BindingAxis (P1f / design D-12/D-13): one (protocol, provider) binding of a
 * virtual key, as two SEPARATE axes. Protocol is the wire protocol the upstream
 * endpoint speaks (from the route row — endpoint truth, NOT derived from the
 * provider). Provider is the brand code (e.g. 'zhipu'); `provider_display_alias`
 * is the brand alias (e.g. 'GLM'). The web renders — it never computes protocol
 * from provider (前端 §7).
 */
export interface BindingAxis {
  protocol: string;
  provider: string;
  provider_display_alias: string;
  /** Local CLI selection slot (Claude/Anthropic, Codex/OpenAI, Kimi, ...). */
  client_route?: string;
  /** Exact proxy endpoint for this binding. */
  route_url?: string | null;
}

export interface TeamVaultRecord {
  /** Discriminator for the VaultRecord union — `'team'` matches the
   * `target` field convention from `阶段3-增强版KEY管理/个人vault-Web页
   * 面-技术方案.md` §2.0 (where `'team'` was reserved as a future
   * extension; Phase 3A delivers it). */
  target: 'team';

  /** Cross-app stable identifier — used for sort stability and active
   * matching (later Phase 3.5+). Must come from B, never minted locally. */
  virtual_key_id: string;

  /** User-visible name. Set by the team admin when the key was issued
   * to this user; A renders it as-is. */
  alias: string;

  /** @deprecated (P1f / D-12): MISNAMED — holds the PROVIDER family, not the
   * protocol. Kept for backward compat with older CLIs that don't emit
   * `bindings`. New code groups by `bindings[].protocol`. */
  protocol_family: string;

  /** P1f / design D-12/D-13: the two-axis binding read model — protocol and
   * provider are SEPARATE axes. Protocol comes from the route row (endpoint
   * truth), provider is the brand code, `provider_display_alias` is the brand
   * alias (e.g. 'GLM' for zhipu). ARRAY from the start (length 1 today;
   * multi-binding when the per-binding cache lands) so the contract never
   * migrates scalar→array. Emitted by the CLI `_internal query`; the web must
   * NOT derive protocol from provider itself (前端 §7). Optional so an older
   * CLI without it falls back to `protocol_family`. */
  bindings?: BindingAxis[];

  /** All providers this key can route to. Used by the vault page's
   * "supports" column when one virtual key covers multiple providers
   * (e.g. an aggregator credential). */
  supported_providers: string[];

  /** B-side share lifecycle: 'pending' (issued, not yet claimed),
   * 'claimed' (active for this user), 'revoked' (no longer usable). */
  share_status: 'pending' | 'claimed' | 'revoked';

  /** Effective active/inactive state — derived B-side from
   * share_status × key_status. A treats this as opaque truth.
   * 'needs_login' (2026-07-03): OAUTH-GROUP VK whose routed pool account needs one
   * login — amber "待登录" + login CTA, not a red "inactive".
   * 'pending_download' (2026-07-06): direct-bind VK whose key material hasn't been
   * delivered locally (and no cluster node route) — amber, actionable: unlock+reload
   * or `aikey key sync` downloads it. See update/20260706-绑定材料守卫与Web解锁态全量sync.md. */
  effective_status: 'active' | 'inactive' | 'needs_login' | 'pending_download';

  /** RFC3339 UTC timestamp when the key expires (CLI rotates before).
   * Optional because not every team key has an explicit expiry. */
  expires_at?: string;

  /** aikey-proxy URL the CLI sets up for this team key's protocol
   *  family (e.g. `http://127.0.0.1:27200/anthropic`). Emitted by CLI's
   *  `_internal query list_personal_with_masked` for team records via
   *  `route_url_for(provider_code)`. Phase 3B R23 revised
   *  (2026-05-11): cross-fetched onto B's Team Keys drawer so the user
   *  sees the same "what URL do I point my client at?" answer the
   *  Personal vault drawer shows. */
  route_url?: string;

  /** Opaque bearer the aikey-proxy uses to identify this team key.
   *  Server-issued during claim, cached in the CLI vault's
   *  `managed_virtual_keys_cache.route_token` column. Null on locked
   *  vault list responses — drawer falls back to "Unlock to reveal"
   *  hint, mirroring the Personal route_token row. */
  route_token?: string | null;
}

/** Type guard: narrow a VaultRecord union to TeamVaultRecord. Use in
 * vault-page row dispatch and action restriction logic. */
export function isTeamVaultRecord(r: { target?: string }): r is TeamVaultRecord {
  return r?.target === 'team';
}
