/**
 * /user/vault — User Vault page (v3.1 layout).
 *
 * Renders the local vault (Personal API keys + OAuth accounts) in the
 * same visual language as /user/overview v3.1 (identity strip → metric
 * row → keys card with toolbar + table + footer → page footer).
 *
 * Data flow is unchanged from v2: every vault-touching action goes
 * through the Go importpkg handler which spawns the Rust aikey cli
 * (`_internal vault-op` / `_internal query` / `_internal update-alias`).
 * The session cookie is shared with /user/import; unlock once, both
 * pages are unlocked.
 *
 * Per-key telemetry (`last_used_at`, `use_count`) is returned by the
 * cli as of v1.0.6-alpha. Proxy-side increment wiring is future work;
 * values are 0 / null until then, and the UI renders those honestly
 * ("never" and "0 uses"). The Activity-7D hero sparkline is client-
 * side mocked per 2026-04-23 plan C.
 *
 * Design anchors:
 *   .superdesign/design_iterations/user_vault_3_1.html
 *   roadmap20260320/技术实现/阶段3-增强版KEY管理/个人vault-Web页面-技术方案.md
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { importApi, type ProviderRoute } from '@/shared/api/user/import';
import { formatDate, formatRelativeTime } from '@/shared/utils/datetime-intl';
import {
  vaultApi,
  oauthApi,
  pickHookReadiness,
  type VaultRecord,
  type PersonalVaultRecord,
  type OAuthVaultRecord,
  type VaultExtra,
  type VaultLastTest,
  type TestResponse,
  type OAuthSession,
} from '@/shared/api/user/vault';
import { useHookReadinessStore } from '@/store';
import { HookReadinessBanner } from '@/shared/components/HookReadinessBanner';
import {
  HookWireRcModal,
  useHookWireRcModal,
} from '@/shared/components/HookWireRcModal';
import { friendlyTestError } from './friendlyTestError';
import { SearchableSelect } from '@/shared/ui/SearchableSelect';
import { ProviderMultiSelect } from '@/shared/ui/ProviderMultiSelect';
import { ENTRY_BY_FAMILY } from '@/shared/generated/provider-registry';
import {
  useTeamVaultStore,
  type TeamVaultStatus,
} from '@/store/teamVault';
import type { TeamFetchError } from '@/shared/api/team/managed-keys';

// ── Derived types ────────────────────────────────────────────────────────

type TypeFilter = 'all' | 'personal' | 'team' | 'oauth';
type SortKey = 'created' | 'last_test' | 'alias';

// ── Team-row adapter ─────────────────────────────────────────────────────
//
// Phase 3A-2 (vault page Personal+Team merged display, see roadmap update
// 20260511-vault-page-team-key-merged-display.md): Team records (B-side
// shape, fetched cross-origin) get adapted into a row-shape compatible
// with the existing VaultRecord renderer so the table doesn't fork into
// "Personal table + Team table". The shims (created_at=0, last_used_at=
// null, status mirrors effective_status) keep the existing helpers
// (formatCreatedShort / sort comparators / status chip) honest without
// special-casing every call site.
//
// What's intentionally NOT carried over from VaultRecord:
//   - secret_prefix/_suffix/_len: server never echoes ciphertext over
//     the wire (decision 2 — credential material stays in vault).
//   - route_token / route_url / base_url: not part of B's UserKeyDTO;
//     team rows don't open the drawer in this phase.
//   - in_use_for: future Phase 3B work (Active state for team rows
//     was deferred per design decision 8).
/**
 * A candidate pool account behind a seat-group VK (N6 projection, Stage A).
 * The `assigned` one is master's static rank-0 default pick — the proxy's live
 * selection (which may fall back when an account is cooled/exhausted) is Stage B.
 */
interface SeatGroupAccountRef {
  account_id: string;
  identity: string; // email / alias for display
  provider_code: string;
  priority: number;
  assigned: boolean; // master-assigned default (static)
}

interface TeamRowRecord {
  target: 'team';
  id: string; // == virtual_key_id, used as the rowKey scope segment
  virtual_key_id: string;
  alias: string;
  protocol_family: string;
  supported_providers: string[];
  share_status: 'pending' | 'claimed' | 'revoked';
  effective_status: 'active' | 'inactive';
  expires_at?: string;
  // route_url + route_token (2026-05-11): emitted inline by CLI's
  // `_internal query` for team records (Phase 3B revised). Drawer
  // surfaces both so users see the same "what URL / what bearer"
  // information the Personal drawer shows. route_token is null
  // on locked vault list responses (mirrors Personal semantics);
  // empty/undefined on older CLI bundles → row falls back gracefully.
  route_url?: string;
  route_token?: string | null;
  // Shims so existing helpers/Row component don't crash on team rows:
  created_at: number; // 0 — server doesn't echo create time in current DTO
  last_used_at: number | null; // null until usage telemetry rides through
  use_count: number; // 0 (same)
  status: 'active' | 'inactive'; // mirrors effective_status for the chip
  in_use_for?: string[]; // empty in 3A; populated in 3B when Active wires up
  /**
   * Generic extension blob (2026-05-22) — see VaultExtra in
   * shared/api/user/vault.ts. Surfaced uniformly for all three
   * target kinds (personal / oauth / team) as of 2026-05-22 — the
   * managed_virtual_keys_cache upsert was refactored from INSERT OR
   * REPLACE to ON CONFLICT DO UPDATE specifically so this field
   * survives every `aikey key sync`.
   */
  extra?: VaultExtra | null;
  /**
   * N6 seat_group projection (Stage A): when this team VK is bound to a
   * credential-sharing group, `seat_group_id` is the group and `group_accounts`
   * is the candidate pool (identity / provider / priority + master's assigned
   * default). null/absent for direct-bind VKs. Emitted by the CLI's
   * `_internal query` from the vault cache.
   */
  seat_group_id?: string | null;
  group_accounts?: SeatGroupAccountRef[] | null;
}

/** Row union for the unified vault table — broader than `VaultRecord`
 *  (which is owned by the local vaultApi and stays Personal/OAuth only).
 *  Mutations + drawer continue to operate on `VaultRecord` exclusively;
 *  the page filters out team rows before handing them to those code paths. */
type VaultRowRecord = VaultRecord | TeamRowRecord;

// ── Helpers ──────────────────────────────────────────────────────────────

function rowKey(r: VaultRowRecord): string {
  return `${r.target}:${r.id}`;
}

/** Team key share lifecycle → human chip text. Server-side semantics:
 *  - 'pending'  : key was issued by the team but the user has not run
 *                 `aikey use` to claim it yet (no local binding minted).
 *  - 'claimed'  : key is mounted into the local vault cache and routable.
 *  - 'revoked'  : team admin disabled the share; key won't authenticate
 *                 even if the local cache still holds metadata.
 */
function teamShareLabel(s: 'pending' | 'claimed' | 'revoked', t: TFunction): string {
  switch (s) {
    case 'pending':
      return t('vault.shareStatusPending');
    case 'claimed':
      return t('vault.shareStatusClaimed');
    case 'revoked':
      return t('vault.shareStatusRevoked');
  }
}

/** "expires Mar 5" / "expired" / null when no expiry. ISO string from
 *  the team server, no time-of-day shown — daily resolution is enough
 *  for a vault row sub-line. Date is formatted via datetime-intl
 *  (locale-aware, in lock-step with the active i18n language) and the
 *  surrounding phrase comes from the message catalogue. */
function formatExpiresAtIso(iso: string | undefined | null, t: TFunction): string | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  if (parsed < Date.now()) return t('vault.expired');
  return t('vault.expiresOn', { date: formatDate(new Date(parsed)) });
}

/**
 * Per-group in-use derivation. Reads server-emitted `in_use_for` (the list
 * of providers this record is the active binding for) and tests it against
 * the current group's provider. Falls back to the legacy global `in_use`
 * boolean for back-compat when the CLI is too old to populate `in_use_for`.
 *
 * Why this exists (regression record 2026-04-30):
 *   `in_use` is a single bool per record; it's true if the record is
 *   bound for ANY provider it supports. Web groups records by their
 *   supported providers, so a multi-provider key (or a key whose alias
 *   collides with another active key's alias) showed `in_use=true` under
 *   groups it wasn't actually active for. Bug surfaced as user reporting
 *   "two inuse under anthropic" — the OAuth account that's actually
 *   anthropic-active + an openai-personal-key whose alias appeared in
 *   the active personal set. CLI's interactive picker was correct
 *   because it reads bindings per-provider.
 *
 *   `in_use_for: string[]` carries the per-(record, provider) info; new
 *   bundles render the badge ONLY when this group's provider is in the
 *   list. `in_use` stays as a derivative (`in_use_for.length > 0`) for
 *   forward-compat with older Web bundles still on flat semantics.
 */
function recordInUseForGroup(r: VaultRowRecord, groupProvider: string): boolean {
  if (Array.isArray(r.in_use_for)) {
    // 2026-05-08 V-layer family-grouping (update/20260508-display-family-grouping.md):
    // groupProvider 是 family 名 (e.g. "kimi");in_use_for 是 provider_code 数组
    // (e.g. ["kimi_code"] 或 ["moonshot"] —— `aikey use` 写入时已被 canonical 化)。
    // 直接 .includes 在 split 后会漏命中:in_use_for=["kimi_code"] 与 groupProvider="kimi"
    // 不字面匹配。fallback 到 family 比对。
    //
    // Phase 3B revised (2026-05-11): team rows populate `in_use_for` inline
    // in the CLI emit (commands_internal/query.rs :: team_records_for_emit)
    // — same field, same shape as Personal/OAuth — so they hit this branch
    // exactly the same way. No special-casing needed for the IN USE visual
    // to fire on a team row that the CLI has bound to this provider.
    return r.in_use_for.some(code =>
      code === groupProvider || familyOfProviderCode(code) === groupProvider
    );
  }
  // Back-compat: older CLI emits only the boolean. Render based on the flat
  // value — strictly speaking this still over-fires for multi-provider
  // collisions, but it's the best we can do without per-provider info.
  // Team rows: TeamRowRecord doesn't define `in_use` (only `in_use_for`,
  // which is always an array — checked above), so narrow first to keep
  // the discriminated union honest. This fallback only fires for old-CLI
  // Personal/OAuth records that predate the per-provider field.
  if (r.target === 'team') return false;
  return r.in_use === true;
}

/** True when an alias looks like an ID (snake_case, kebab-case, no @).
 *  Controls whether we render it in Inter (friendly) or JetBrains Mono
 *  (code-identity). See user_vault_3_1.html §.alias-main.mono. */
function isMonoAlias(s: string | null | undefined): boolean {
  if (!s) return false;
  if (s.includes('@')) return false;
  if (s.includes(' ')) return false;
  return /^[a-z0-9._\-]+$/.test(s);
}

function formatCreatedShort(unix: number | null | undefined): string {
  if (!unix) return '—';
  const d = new Date(unix * 1000);
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  return `${Y}-${M}-${D}`;
}

/** Human "4 min ago" / "Yesterday" / "2026-04-23" rendering — now
 * locale-aware via `formatRelativeTime` (previously hardcoded
 * English). Still falls back to the ISO-style `formatCreatedShort`
 * for deltas beyond a month so old records read stably. */
function formatRelative(unix: number | null | undefined): string {
  if (!unix) return 'never';
  const diffSec = Date.now() / 1000 - unix;
  if (diffSec >= 30 * 86400) return formatCreatedShort(unix);
  return formatRelativeTime(unix * 1000) || 'never';
}

/**
 * Two-line table cell for the "Last test" column (2026-05-22 v3).
 * Three vertical signal-bar segments (Ping / API / Chat, left → right)
 * + relative timestamp underneath. No labels — shape alone carries the
 * meaning, like cellular signal bars.
 *
 * Colour rule per user-spec ("一个图形就能够表示了吧 ... 通了的显示绿色,
 * 未通的显示黄色, 没有测试到的直接显示红色"):
 *
 *   stage passed                     → GREEN  (this layer is healthy)
 *   stage itself failed              → AMBER  (this layer is what broke)
 *   stage never ran (predecessor     → RED    (didn't even get a chance)
 *     already failed)
 *
 * Walk left→right; the first stage that fails paints amber, every
 * stage after it paints red (suite stops at the first hard fail in
 * the user's mental model even if the backend actually probed all
 * three — what they care about is "where did the chain break?").
 *
 * Legacy snapshots (pre-2026-05-22) carry only `status` (pass/fail).
 * Treat undefined phase booleans as `status === 'pass'` so old rows
 * render sensibly until re-tested.
 */
// Health score derived from the same Ping → API → Chat signal-chain the
// LastTestCell renders. Higher = healthier. Powers the within-group sort
// when the user clicks the "Last test" column header.
//   4 = all three stages passed              (green / green / green)
//   3 = ping + api passed, chat broke        (chat is deepest layer)
//   2 = ping passed, api broke
//   1 = ping broke                           (cannot even reach upstream)
//   0 = no test recorded yet                 (unknown — bottom of list)
// Legacy snapshots carry only `status`; treat pass as all-green (4) and
// fail as ping-broken (1) — same fallback the cell uses.
function lastTestHealthScore(lt: VaultLastTest | null | undefined): number {
  if (!lt) return 0;
  const legacyPass = lt.status === 'pass';
  const phases = [
    lt.ping_ok ?? legacyPass,
    lt.api_ok  ?? legacyPass,
    lt.chat_ok ?? legacyPass,
  ];
  const firstFailIdx = phases.findIndex((ok) => !ok);
  if (firstFailIdx === -1) return 4;
  return firstFailIdx + 1; // ping fail → 1, api fail → 2, chat fail → 3
}

function LastTestCell(props: { value: VaultLastTest | null }) {
  const lt = props.value;
  if (!lt) {
    return (
      <div
        className="text-[12px]"
        style={{ color: 'var(--muted-foreground)', opacity: 0.55 }}
      >
        —
      </div>
    );
  }
  const legacyPass = lt.status === 'pass';
  const phases: Array<{ name: string; ok: boolean }> = [
    { name: 'Ping', ok: lt.ping_ok ?? legacyPass },
    { name: 'API',  ok: lt.api_ok  ?? legacyPass },
    { name: 'Chat', ok: lt.chat_ok ?? legacyPass },
  ];
  // Locate the first failing stage. Once a stage fails, everything to
  // its right is treated as "didn't get to run" (red), regardless of
  // its own boolean — that's the user's signal-chain mental model.
  const firstFailIdx = phases.findIndex(p => !p.ok);
  const okColor    = 'var(--success, #22c55e)';
  const failColor  = '#f59e0b';                       // amber — this stage broke
  const downstream = 'var(--destructive, #ef4444)';   // red — never got a chance

  const segmentColor = (i: number): string => {
    if (firstFailIdx === -1) return okColor;        // all green
    if (i < firstFailIdx)    return okColor;        // upstream of break: passed
    if (i === firstFailIdx)  return failColor;      // the broken link
    return downstream;                              // chain broken — never tested
  };

  // Tooltip carries the human-readable detail (per-phase status + when
  // the probe ran). The cell itself is pure shape — no text — so the
  // column stays visually quiet at scale (16+ rows). Hover gives anyone
  // who needs the timestamp / phase names access without committing
  // pixels to it.
  const tooltip = [
    ...phases.map((p, i) => {
      const state = firstFailIdx === -1 || i < firstFailIdx
        ? 'ok'
        : i === firstFailIdx ? 'failed' : 'not reached';
      return `${p.name}: ${state}`;
    }),
    `Tested ${formatRelative(lt.at)}`,
  ].join(' · ');

  // Wi-Fi-style ascending bars: short → medium → tall, bottom-aligned.
  // The growing height mirrors the suite's stage progression — Ping is
  // the shallowest reach (TCP), API is one layer deeper (HTTP auth),
  // Chat is the deepest (full model round-trip). Reading left→right
  // tracks how far the connection actually got. Bottom-aligned so the
  // baseline of the icon stays steady regardless of which bar is lit.
  //
  // Geometry refreshed 2026-05-23 to match the v1 mockup
  // (.superdesign/design_iterations/vault_original_refine_1.html
  //  `.signal-bars`): thinner bars (4→3px), slightly taller stack
  // (14→15px max), and most importantly border-radius 1→999px so each
  // bar reads as a rounded pill instead of a flat-top rectangle. The
  // pill ends are the v1 signature "premium" touch.
  const BAR_HEIGHTS = [7, 11, 15];   // short / medium / tall (px)
  const BAR_WIDTH   = 3;             // thinner — matches v1 signal-bars
  const BAR_GAP     = 2;             // tight spacing reads as one icon
  const ICON_HEIGHT = BAR_HEIGHTS[BAR_HEIGHTS.length - 1];

  return (
    <div
      style={{
        display: 'inline-flex',
        gap: BAR_GAP,
        alignItems: 'flex-end',     // bottom-align so bars grow upward
        height: ICON_HEIGHT,
      }}
      title={tooltip}
    >
      {phases.map((_, i) => (
        <span
          key={i}
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: BAR_WIDTH,
            height: BAR_HEIGHTS[i],
            borderRadius: 999,
            background: segmentColor(i),
          }}
        />
      ))}
    </div>
  );
}

/** "expires in 27d" / "expires in 4h" / "expired" / null when unknown.
 *  Phrasing comes from the message catalogue with i18next plural
 *  (`_one`/`_other`) + {{count}} interpolation so the relative-time
 *  suffix follows the active language. */
function formatExpiresIn(unix: number | null | undefined, t: TFunction): string | null {
  if (!unix) return null;
  const diff = unix - Date.now() / 1000;
  if (diff <= 0) return t('vault.expired');
  if (diff < 3600) return t('vault.expiresInMinutes', { count: Math.max(1, Math.floor(diff / 60)) });
  if (diff < 86400) return t('vault.expiresInHours', { count: Math.floor(diff / 3600) });
  return t('vault.expiresInDays', { count: Math.floor(diff / 86400) });
}

/** Canonical brand color for a provider, matching the 3.1 template's
 *  `--chart-*` palette. Unknown / unmapped providers fall through to a
 *  neutral gray rather than inventing new colors (keeps the chip system
 *  disciplined the way import-page chips are). */
function providerBrandColor(provider: string | null | undefined): string {
  const p = (provider ?? '').toLowerCase();
  if (p.includes('anthropic') || p.includes('claude')) return 'var(--chart-anthropic)';
  if (p.includes('openai')) return 'var(--chart-openai)';
  if (p.includes('codex')) return 'var(--chart-codex)';
  if (p.includes('kimi') || p.includes('moonshot')) return 'var(--chart-kimi)';
  if (p.includes('gemini') || p.includes('google')) return 'var(--chart-gemini)';
  return 'var(--chart-neutral)';
}

/** Short display name for the Provider column. Strips "_oauth" / "_api"
 *  suffixes and lowercases. Returns the raw per-credential provider (so
 *  "claude" OAuth rows and "anthropic" API-key rows are visually distinct
 *  in the Provider column). For grouping or "which API protocol" semantics
 *  use providerProtocolFamily() instead. */
function providerDisplayName(r: VaultRowRecord): string {
  // Team rows have no broker `provider` field; the closest analogue is
  // protocol_family, which the team server already returns lower-cased.
  // Personal rows: provider_code (broker code, may carry _oauth/_api
  // tail). OAuth rows: broker provider name.
  let raw: string;
  if (r.target === 'personal') raw = r.provider_code ?? 'unknown';
  else if (r.target === 'team') raw = r.protocol_family || 'unknown';
  else raw = r.provider;
  return raw.toLowerCase().replace(/_oauth$|_api$/, '');
}

/** Shell wrapper that honours the currently-routed account for a given
 *  provider family. Users don't need `aikey` at all at call time — they
 *  just run e.g. `claude` / `codex` / `kimi` and the aikey proxy maps
 *  the request to whichever alias is currently in use for that family.
 *
 *  Returns null when we don't ship a dedicated wrapper for the provider
 *  (caller should fall back to the generic `aikey` hint). Mapping is
 *  intentionally narrow — only covers the 3 families that actually have
 *  first-class shell wrappers today; adding more is a config change, not
 *  a UI guess. */
function providerShellCommand(family: string | null | undefined): string | null {
  const p = (family ?? '').toLowerCase();
  if (p.includes('anthropic') || p.includes('claude')) return 'claude';
  if (p.includes('openai') || p.includes('codex')) return 'codex';
  if (p.includes('kimi') || p.includes('moonshot')) return 'kimi';
  return null;
}

/** V-layer helper: provider_code → display family for vault group rendering.
 *
 *  2026-05-08 显示层 family-grouping (详见 update/20260508-display-family-grouping.md)
 *
 *  Source of truth: CLI registry (`aikey-cli/data/provider_registry.yaml`
 *  RegistryEntry.family) + Rust `provider_registry::family_of()` helper.
 *  This frontend mapping mirrors only the multi-platform families (currently
 *  just Kimi) so the vault page can group personal keys by family even when
 *  the V data is delivered via `supported_providers` (per-record provider_code
 *  array) rather than the per-record `protocol_family` field.
 *
 *  Why duplicated here: vault `grouped` memo iterates `supported_providers` for
 *  multi-provider expansion (e.g. 0011 gateway key supports anthropic+openai
 *  → shows in BOTH groups). Each element is a provider_code, not a family. To
 *  family-group correctly without exposing extra response fields, the V layer
 *  maps each provider_code → family at render time.
 *
 *  Single-platform providers (anthropic / openai / google_gemini / ...) return
 *  input unchanged — matches CLI registry's `family defaults to code` rule.
 */
function familyOfProviderCode(code: string): string {
  const lc = (code ?? '').trim().toLowerCase();
  if (lc === 'kimi_code' || lc === 'moonshot' || lc === 'kimi') return 'kimi';
  // Add other multi-platform families here when they appear in the registry.
  // Single-platform: family == code (e.g. anthropic, openai, deepseek).
  return lc;
}


/** Route-token tail "vk_9f2a…a7e3" from full route_token. */
function shortRouteToken(rt: string | null | undefined): string | null {
  if (!rt) return null;
  const stripped = rt.replace(/^aikey_vk_/, '');
  if (stripped.length <= 10) return `vk_${stripped}`;
  return `vk_${stripped.slice(0, 4)}…${stripped.slice(-4)}`;
}

// ── Main component ───────────────────────────────────────────────────────

export default function UserVaultPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  // Vault session (shared with /user/import).
  const { data: vault, refetch: refetchVault, dataUpdatedAt } = useQuery({
    queryKey: ['vault-status'],
    queryFn: importApi.vaultStatus,
    refetchInterval: 10_000,
    staleTime: 0,
  });
  const unlocked = Boolean(vault?.unlocked);
  // `initialized` defaults to true on legacy local-server builds; see
  // VaultStatus.initialized doc comment in api/user/import.ts.
  const initialized = vault?.initialized ?? true;

  // Unlock banner state.
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);

  // First-run "Set Master Password" state (shown only when initialized=false).
  // Per 20260430-个人vault-Web首次设置-方案A.md §1.1 — two password fields,
  // both client-side; backend only receives `password` (confirm is a UI
  // guard, not a payload field).
  const [initPassword, setInitPassword] = useState('');
  const [initConfirm, setInitConfirm] = useState('');
  const [initError, setInitError] = useState<string | null>(null);

  const unlockMut = useMutation({
    mutationFn: importApi.vaultUnlock,
    onSuccess: (res) => {
      if (res.status === 'ok' && res.unlocked) {
        setUnlockPassword('');
        setUnlockError(null);
        refetchVault();
        // Force a re-fetch of vault-list under the new (unlocked) queryKey.
        // Without this invalidation, a stale 'locked'-keyed cache entry can
        // keep `route_token: null` in records — and any open drawer (the
        // user pre-clicked a row before unlocking) would keep displaying
        // the masked value until manual refresh. See the live-record effect
        // below for the matching front-end half of this fix.
        qc.invalidateQueries({ queryKey: ['vault-list'] });
      } else {
        setUnlockError(res.error_message || t('vault.unlockFailedFallback'));
      }
    },
    onError: (e: Error) => setUnlockError(e.message),
  });

  const initMut = useMutation({
    mutationFn: importApi.vaultInit,
    onSuccess: (res) => {
      if (res.status === 'ok' && res.unlocked) {
        // Init succeeded → the backend already minted a session, so we
        // are unlocked in one step (no separate unlock prompt needed).
        setInitPassword('');
        setInitConfirm('');
        setInitError(null);
        refetchVault();
      } else if (res.error_code === 'I_VAULT_ALREADY_INITIALIZED') {
        // Race or stale UI: someone else (CLI or another tab) initialised
        // the vault between our last status poll and this submit. Just
        // refresh — the next render will show the regular unlock card.
        setInitError(null);
        refetchVault();
      } else {
        setInitError(res.error_message || t('vault.setMasterPasswordFailedFallback'));
      }
    },
    onError: (e: Error) => setInitError(e.message),
  });

  const submitInit = () => {
    // Match the CLI's first-run policy (main.rs:3384-3391): only require
    // that the two prompts agree. CLI does not enforce a minimum length —
    // Argon2id + AES-GCM handle any non-empty password, and adding a web
    // floor would be a UX inconsistency between the two entry points.
    // Empty-string is already blocked by the SET button's `disabled` guard
    // on `!initPassword || !initConfirm`.
    if (initPassword !== initConfirm) {
      setInitError(t('vault.passwordsDoNotMatch'));
      return;
    }
    setInitError(null);
    initMut.mutate({ password: initPassword });
  };

  const lockMut = useMutation({
    mutationFn: importApi.vaultLock,
    onSuccess: () => {
      refetchVault();
      qc.removeQueries({ queryKey: ['vault-list'] });
    },
  });

  // Auto-lock countdown state was previously held here, ticking once per
  // second — that forced a full-page re-render every tick and measurably
  // degraded scroll smoothness (the mm:ss mm:ss mm:ss cadence would
  // re-render IdentityStrip / MetricsRow / the SVG sparklines / every
  // table Row on each beat). The countdown is now owned by UnlockBanner
  // itself so only that banner re-paints per second; the rest of the page
  // re-renders only on real data / UI changes.

  // Vault list (runs in both locked and unlocked states — locked path
  // returns metadata-only records).
  const {
    data: listData,
    isLoading: listLoading,
    error: listError,
  } = useQuery({
    queryKey: ['vault-list', unlocked ? 'unlocked' : 'locked'],
    queryFn: vaultApi.list,
    staleTime: 30_000,
    // Why keepPreviousData: when `unlocked` flips (lock → unlock or back), the
    // queryKey changes and React Query would otherwise return undefined while
    // the new query loads. That transient empty array tripped the live-record
    // useEffect into closing any open drawer (records.find → undefined → close).
    // Keeping the previous data spans the gap so the drawer survives the
    // transition; once the new fetch resolves the effect swaps in the live
    // record naturally.
    placeholderData: keepPreviousData,
  });

  // ── Team-vault store wiring (Phase 3A-2) ──────────────────────────────
  //
  // The team-vault store fetches the team-server's /accounts/me/all-keys
  // cross-origin (see roadmap update 20260511 §5). It owns the lifecycle
  // (idle → loading → loaded | not-logged-in | unauth | unreachable |
  // parse-error). We fire `refresh` once on mount; subsequent retries
  // are user-driven via the TeamFetchBanner.
  const teamStatus = useTeamVaultStore((s) => s.status);
  const teamError = useTeamVaultStore((s) => s.error);
  const teamRefresh = useTeamVaultStore((s) => s.refresh);
  useEffect(() => {
    // Idempotent: store guards against concurrent inflight calls.
    // The store is now a reachability probe — its records[] is not
    // the display source (CLI emits team rows inline in vault.list).
    void teamRefresh();
  }, [teamRefresh]);

  // Phase 3B revised (2026-05-11): CLI vault.list now emits team
  // records inline with target='team' (see commands_internal/query.rs ::
  // team_records_for_emit), so the display source is `listData.records`
  // directly — no separate teamVaultStore.records read, no overlay
  // merge, no shim conversion via teamRecordToRow. The teamVaultStore
  // stays mounted as the "team server reachability indicator"
  // (teamStatus/teamError power the TeamFetchBanner).
  const records = useMemo<VaultRowRecord[]>(
    () => ((listData?.records as VaultRowRecord[]) ?? []),
    [listData],
  );

  // Counts: emitted by Go-side splitting CLI's `personal_count` +
  // `team_count` (set when team rows are inlined into `entries`).
  // `total` is the visible-row union — drives the "All" pill count.
  const counts = useMemo(() => {
    const personal = listData?.counts.personal ?? 0;
    const oauth = listData?.counts.oauth ?? 0;
    const team = listData?.counts.team ?? 0;
    return { personal, oauth, team, total: personal + oauth + team };
  }, [listData]);

  // v4.3 (2026-05-01): provider_routes table — the authoritative declaration
  // of "for this host, the proxy will route to base_url + version". Drawer
  // uses it to display the EFFECTIVE upstream URL for each key, so users
  // can tell apart kimi-coding vs moonshot entries (which both belong to
  // provider_code=kimi but route to different hosts/endpoints) without
  // having to read the raw stored base_url and second-guess what the
  // proxy will do with it. Same logic as aikey-proxy applyBaseURL stitch
  // (via pkg/providerroutes.Stitch). Cached aggressively.
  const { data: rules } = useQuery({
    queryKey: ['import-rules'],
    queryFn: importApi.rules,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const providerRoutes = rules?.provider_routes;
  const hostToRoute = useMemo(() => {
    const m = new Map<string, ProviderRoute>();
    if (!providerRoutes) return m;
    for (const r of providerRoutes) m.set(r.host.toLowerCase(), r);
    return m;
  }, [providerRoutes]);
  const providerToRoute = useMemo(() => {
    const m = new Map<string, ProviderRoute>();
    if (!providerRoutes) return m;
    for (const r of providerRoutes) {
      if (!m.has(r.provider)) m.set(r.provider, r);
    }
    return m;
  }, [providerRoutes]);

  // Filters + sort. Status filter removed 2026-04-24 — in practice
  // 99% of keys are `status:'active'`, errored keys are rare and when
  // they do appear the row-level status chip is already visually
  // distinct (red vs green pill) so the filter pills duplicate the
  // signal without meaningfully narrowing the list.
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('created');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filteredList = records.filter((r) => {
      if (typeFilter !== 'all' && r.target !== typeFilter) return false;
      if (q) {
        const alias = (r.alias ?? '').toLowerCase();
        const provider = providerDisplayName(r);
        const family = (r.protocol_family ?? '').toLowerCase();
        const prefix =
          r.target === 'personal' ? (r.secret_prefix ?? '').toLowerCase() : '';
        if (
          !alias.includes(q) &&
          !provider.includes(q) &&
          !family.includes(q) &&
          !prefix.includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
    return filteredList.slice().sort((a, b) => {
      switch (sortKey) {
        case 'alias': {
          const aa = (a.alias ?? '').toLowerCase();
          const bb = (b.alias ?? '').toLowerCase();
          return aa.localeCompare(bb);
        }
        case 'last_test': {
          // Sort by the persisted connectivity-test timestamp (Vault page
          // "Last test" column). Records without a recorded test fall to
          // the bottom (treated as 0). Tie-breaker: pass before fail at
          // identical timestamps so a passing key never gets buried under
          // a same-second failure when the user is scanning health.
          const at = a.extra?.last_test?.at ?? 0;
          const bt = b.extra?.last_test?.at ?? 0;
          if (bt !== at) return bt - at;
          const aPass = a.extra?.last_test?.status === 'pass' ? 1 : 0;
          const bPass = b.extra?.last_test?.status === 'pass' ? 1 : 0;
          return bPass - aPass;
        }
        case 'created':
        default:
          return b.created_at - a.created_at;
      }
    });
  }, [records, typeFilter, search, sortKey]);

  // Row-level interactions (rename / delete / drawer).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [drawerRecord, setDrawerRecord] = useState<VaultRowRecord | null>(null);
  // Drawer open "mode" (2026-04-24 user request):
  //   - 'persistent' → opened by the explicit View details button; stays
  //     open even as the user scrolls the table behind the drawer.
  //   - 'peek' → opened by a row click or the IN USE chip; auto-closes on
  //     scroll so a passing click doesn't leave a drawer dangling while
  //     the user scans the list further down.
  const [drawerMode, setDrawerMode] = useState<'persistent' | 'peek'>('persistent');

  // Pull the readiness setter up here so all mutations can see it.
  // Hook coverage v1 review (2026-04-27 round 2): ANY vault response
  // that goes through the merge_hook_status path on the CLI side
  // (use / add / batch_import / delete_target) carries the three hook
  // fields. Each mutation's onSuccess MUST feed them back into the
  // store — otherwise the banner won't surface for users on the pure-
  // Web onboarding path who only Add (never Use).
  const setHookReadinessFromMutation = useHookReadinessStore((s) => s.setReadiness);
  // Hook coverage v1 update 2026-05-07: also auto-pop the wire-rc modal
  // on the FIRST mutation in this session that detects rc_wired=false.
  // The hook is local-edition gated and session-throttled internally —
  // see useHookWireRcModal in HookWireRcModal.tsx.
  const wireRcModal = useHookWireRcModal();

  const renameMut = useMutation({
    mutationFn: vaultApi.rename,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vault-list'] });
      // Phase 3B revised (2026-05-11): team rename writes
      // `managed_virtual_keys_cache.local_alias` in the CLI vault.
      // The invalidate above re-fetches vault.list which emits team
      // records inline with `alias` already set to local_alias ??
      // server_alias. The displayed alias updates on the next React
      // Query tick, and survives page reload because the CLI emit
      // always re-reads local_alias.
    },
    onError: (err: unknown) => {
      // Phase 3B defense: rename was previously silent on error (no toast),
      // so users would type a new alias, hit save, and see the field reset
      // with no feedback when the server returned (e.g.) I_CREDENTIAL_CONFLICT
      // or the team server was unreachable. Surface it.
      const message = err instanceof Error ? err.message : String(err);
      pushToast({ kind: 'error', title: t('vault.toastRenameFailedTitle'), sub: message });
    },
  });
  const deleteMut = useMutation({
    mutationFn: vaultApi.delete,
    onSuccess: (res) => {
      // CLI's handle_delete_target merges hook status; refresh the store.
      // eligible=false: delete is not "user-explicitly-setting-active";
      // banner still surfaces if rc unwired (X2).
      const r = pickHookReadiness(res);
      setHookReadinessFromMutation(r);
      wireRcModal.openIfNeeded(r, false);
      qc.invalidateQueries({ queryKey: ['vault-list'] });
    },
  });
  const addMut = useMutation({
    mutationFn: vaultApi.add,
    onSuccess: (res) => {
      // First-time Web-Add path — this is precisely the user journey
      // the hook coverage v1 banner is built for. Feed envelope fields
      // into the store so the banner can decide whether to show
      // "Almost ready" / "Shell undetectable" / etc.
      // eligible=true: add is the canonical onboarding event (X2).
      const r = pickHookReadiness(res);
      setHookReadinessFromMutation(r);
      wireRcModal.openIfNeeded(r, true);
      qc.invalidateQueries({ queryKey: ['vault-list'] });
    },
  });

  // ── aikey use (routing switch) state ──────────────────────────────────
  //
  // Mirrors the `switchTo` single-source-of-truth contract in the design
  // spec (user_vault_3_1_1.html). One function drives row buttons AND the
  // popover-pick path so optimistic / rollback / toast are always in sync.
  //
  // "unset" is deliberately unsupported: clicking an already-in-use row is
  // a no-op (per 2026-04-24 user decision — keeps the "one active per
  // provider" rule safe from accidental provider-idle states).
  type ToastKind = 'success' | 'error';
  interface ToastEntry {
    id: number;
    kind: ToastKind;
    title: string;
    sub?: string;
    cliHint?: string;
    undo?: () => void;
  }
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const toastIdRef = useRef(0);
  const [justSwitchedIds, setJustSwitchedIds] = useState<Set<string>>(() => new Set());
  const [switchingIds, setSwitchingIds] = useState<Set<string>>(() => new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());

  // ── Test Connection popup (2026-05-22) ────────────────────────────────
  // Page-level state so the popup survives a closed drawer (the user can
  // collapse the drawer to keep an eye on the list while a slow probe
  // runs). The record reference is the *adapter row*, not just an id, so
  // the popup header can render the alias / provider chip immediately
  // without re-resolving from the list. `null` = popup hidden.
  const [testPopupRecord, setTestPopupRecord] = useState<VaultRowRecord | null>(null);
  // `testPhase` is the popup's state machine:
  //   'running' — request in flight; popup shows spinner + "Probing X"
  //   'done'    — backend returned a result; popup shows last_test + suite_results
  //   'error'   — request failed (network / timeout / I_PROXY_NOT_RUNNING);
  //               popup shows the error code + suggested next step
  const [testPhase, setTestPhase] = useState<'running' | 'done' | 'error'>('running');
  const [testResult, setTestResult] = useState<TestResponse | null>(null);
  const [testError, setTestError] = useState<{ code?: string; httpStatus?: number; message: string } | null>(null);

  const switchMut = useMutation({
    mutationFn: vaultApi.use,
    onSuccess: (res) => {
      // Hook coverage v1: feed envelope's hook fields into the shared
      // store so <HookReadinessBanner> can render the right CTA.
      // eligible=true: explicit "use this key" click is the canonical
      // active-routing event (X2).
      const r = pickHookReadiness(res);
      setHookReadinessFromMutation(r);
      wireRcModal.openIfNeeded(r, true);
      qc.invalidateQueries({ queryKey: ['vault-list'] });
    },
  });

  const pushToast = useCallback((t: Omit<ToastEntry, 'id'>): number => {
    toastIdRef.current += 1;
    const id = toastIdRef.current;
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 5000);
    return id;
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  // Optimistic cache surgery: mark target in_use, clear in_use on any sibling
  // sharing the same protocol_family (the grouping key + routing scope).
  // `setQueryData` returns a new tuple so React Query re-renders subscribers
  // immediately. Returns the pre-switch "previous active of same family"
  // (for undo) and a rollback function that restores the pre-edit snapshot.
  //
  // Why family (not raw providerDisplayName): the CLI-side `write_bindings_
  // canonical` helper normalizes every binding write to the canonical
  // protocol code and UPSERTs, which effectively clears any prior
  // different-alias sibling (e.g. activating a codex OAuth clears the
  // prior openai-personal binding because both collapse to provider_code=
  // "openai"). The optimistic UI mirrors that same family boundary so
  // the pre-server-confirm state matches what the server ends up writing.
  type ListShape = { records: VaultRecord[]; counts: typeof counts; locked: boolean };
  // applyOptimisticSwitch only touches the local vault-list cache (Personal +
  // OAuth records). Team rows live in `useTeamVaultStore` — their optimistic
  // state would belong there instead. For Phase 3B we accept a tiny UX gap:
  // clicking Use on a team row triggers the real CLI write but the optimistic
  // green-dot doesn't appear until the next list refresh. Adding optimistic
  // updates for the team-store would mean replicating the family-mutex logic
  // (clear OTHER family's binding too) which is out of scope; the post-mutation
  // refetch below covers the visual catch-up.
  function applyOptimisticSwitch(target: VaultRecord): {
    previousForUndo: VaultRecord | null;
    rollback: () => void;
  } {
    const qKey = ['vault-list'];
    const snapshot = qc.getQueryData<ListShape>(qKey);
    const targetFamily = target.protocol_family ?? 'unknown';
    const previousHolder: { value: VaultRecord | null } = { value: null };
    qc.setQueryData<ListShape | undefined>(qKey, (old) => {
      if (!old) return old;
      const newRecords = old.records.map((rec) => {
        if (rowKey(rec) === rowKey(target)) {
          return { ...rec, in_use: true } as VaultRecord;
        }
        if ((rec.protocol_family ?? 'unknown') === targetFamily && rec.in_use === true) {
          previousHolder.value = rec;
          return { ...rec, in_use: false } as VaultRecord;
        }
        return rec;
      });
      return { ...old, records: newRecords };
    });
    return {
      previousForUndo: previousHolder.value,
      rollback: () => {
        if (snapshot) qc.setQueryData(qKey, snapshot);
      },
    };
  }

  // Single entry point for "route all of provider X through this key". Used
  // by both the inline row Use button AND the popover pick. Guarded against
  // re-entrant clicks via `switchingIds`.
  // groupProvider scopes the "already active?" early-return to the group
  // the user clicked under. Without it, clicking Use on a multi-provider
  // record that's active in some OTHER group would no-op silently because
  // the legacy flat `in_use === true` check fired (regression 2026-04-30).
  function switchTo(target: VaultRowRecord, groupProvider: string) {
    if (recordInUseForGroup(target, groupProvider)) return;
    if (!unlocked) {
      pushToast({
        kind: 'error',
        title: t('vault.toastUnlockFirstTitle'),
        sub: t('vault.toastUnlockFirstSub'),
      });
      return;
    }
    const tk = rowKey(target);
    if (switchingIds.has(tk)) return;
    setSwitchingIds((prev) => {
      const n = new Set(prev);
      n.add(tk);
      return n;
    });
    // Optimistic switch: only safe for Personal+OAuth rows whose state
    // lives in the vault-list cache. Team rows skip the optimistic step
    // (see applyOptimisticSwitch comment); the real binding write still
    // happens, the visual catch-up arrives when the team store next refetches.
    const { previousForUndo, rollback } =
      target.target === 'team'
        ? { previousForUndo: null, rollback: () => {} }
        : applyOptimisticSwitch(target as VaultRecord);
    switchMut.mutate(
      { target: target.target, id: target.id },
      {
        onSettled: () => {
          setSwitchingIds((prev) => {
            const n = new Set(prev);
            n.delete(tk);
            return n;
          });
        },
        onSuccess: () => {
          // Flash route-pulse once (650ms window matches .just-switched CSS).
          setJustSwitchedIds((prev) => {
            const n = new Set(prev);
            n.add(tk);
            return n;
          });
          setTimeout(() => {
            setJustSwitchedIds((prev) => {
              const n = new Set(prev);
              n.delete(tk);
              return n;
            });
          }, 650);
          const providerTag = providerDisplayName(target).toUpperCase();
          const aliasLabel = target.alias ?? '(unnamed)';
          const cli = 'aikey use ' + (target.alias ?? '');
          pushToast({
            kind: 'success',
            title: providerTag + ' now routes through ' + aliasLabel,
            sub: (previousForUndo ? 'was ' + (previousForUndo.alias ?? '(unnamed)') + ' · ' : '') + cli,
            cliHint: cli,
            // Undo routes the same group context — the previous holder was
            // active for THIS group before we replaced it, so re-applying it
            // means switching back under the same group.
            undo: previousForUndo ? () => switchTo(previousForUndo!, groupProvider) : undefined,
          });
        },
        onError: (err: unknown) => {
          rollback();
          const message = err instanceof Error ? err.message : String(err);
          // Phase 3B (2026-05-11): map team-key business-state errors to
          // clearer copy. Each kind maps a CLI error_code (now mapped to
          // 422 in Go's WriteErr) to a UX-appropriate hint:
          //   - I_KEY_NOT_DELIVERED: ciphertext missing AND auto-sync failed
          //   - I_KEY_DISABLED:      revoked / scope-disabled / seat suspended
          //   - I_KEY_STALE:         local cache version older than server
          // The button-disabled gates above SHOULD prevent the disabled +
          // stale cases from firing on team rows, but a personal/oauth row
          // could in theory hit I_KEY_DISABLED too if a future CLI change
          // flags those — the toasts stay generic enough to cover both.
          if (message.includes('I_KEY_NOT_DELIVERED') || message.includes('was not delivered')) {
            pushToast({
              kind: 'error',
              title: t('vault.toastTeamKeyNotDeliveredTitle'),
              sub: t('vault.toastTeamKeyNotDeliveredSub'),
            });
            return;
          }
          if (message.includes('I_KEY_DISABLED') || message.includes('is disabled')) {
            pushToast({
              kind: 'error',
              title: t('vault.toastKeyNotUsableTitle'),
              sub: t('vault.toastKeyNotUsableSub'),
            });
            return;
          }
          if (message.includes('I_KEY_STALE') || message.includes('is stale')) {
            pushToast({
              kind: 'error',
              title: t('vault.toastKeyStaleTitle'),
              sub: t('vault.toastKeyStaleSub'),
            });
            return;
          }
          pushToast({
            kind: 'error',
            title: t('vault.toastSetRoutingFailedTitle'),
            sub: message,
          });
        },
      },
    );
  }

  // ── Test Connection orchestration (2026-05-22) ─────────────────────────
  //
  // Open the popup, fire POST /api/user/vault/test, await the result,
  // optimistically patch the row's `extra.last_test` so the "Last test"
  // column updates without a full list refetch (the backend already
  // persisted to vault — we just mirror the change in cached state).
  // Errors surface to the popup, NOT a toast, so the user can see why a
  // probe failed without losing the popup context.
  //
  // Why no useMutation: the test endpoint is per-row, fire-and-show; we
  // don't need queryClient invalidation (the optimistic patch above is
  // enough), and the popup wants its own loading state distinct from
  // mutation pending. Plain async fn is the smaller hammer.
  function runTest(target: VaultRowRecord) {
    setTestPopupRecord(target);
    setTestPhase('running');
    setTestResult(null);
    setTestError(null);
    vaultApi
      .test({ target: target.target, id: target.id })
      .then((res) => {
        setTestResult(res);
        setTestPhase('done');
        if (!res.persisted) return;
        // 2026-05-22 fix (2nd attempt): the list query's actual key
        // includes the unlocked flag (`['vault-list', 'unlocked' |
        // 'locked']`). Earlier I hardcoded `['vault-list']` which wrote
        // a ghost cache entry no consumer reads. Then I tried
        // invalidateQueries but the column still didn't refresh in
        // practice — most likely because invalidate respects staleTime
        // and React Query 5's default behaviour didn't trigger an
        // immediate refetch for our setup. Belt-and-braces here:
        //   1) Optimistic setQueryData on BOTH possible keys (the
        //      page is currently in one state but the other cache
        //      entry may still get read if the user toggles lock
        //      state quickly).
        //   2) refetchQueries to force a network round-trip and
        //      reconcile with the source-of-truth (vault DB).
        const patch = (rec: VaultRowRecord): VaultRowRecord => {
          if (rec.target === target.target && rec.id === target.id) {
            const nextExtra: VaultExtra = {
              ...(rec.extra ?? {}),
              last_test: res.last_test,
            };
            return { ...rec, extra: nextExtra } as VaultRowRecord;
          }
          return rec;
        };
        for (const lockState of ['unlocked', 'locked'] as const) {
          qc.setQueryData<{ records: VaultRowRecord[] } & Record<string, unknown> | undefined>(
            ['vault-list', lockState],
            (old) => {
              if (!old || !Array.isArray(old.records)) return old;
              return { ...old, records: old.records.map(patch) };
            },
          );
        }
        // Force a fresh fetch so the next render reconciles with the
        // vault DB even if optimistic patch missed (e.g. a future
        // schema change adds a third cache key).
        qc.refetchQueries({ queryKey: ['vault-list'] });
      })
      .catch((err: Error & { code?: string; response?: { status?: number } }) => {
        // Surface the raw HTTP status alongside the (CLI / axios) error
        // code so the popup's friendly-text mapping can branch on
        // 5xx-class failures without re-inspecting the thrown object.
        const httpStatus = err.response?.status;
        setTestError({
          code: err.code,
          httpStatus,
          message: err.message || 'Test failed for an unknown reason',
        });
        setTestPhase('error');
      });
  }

  function closeTestPopup() {
    setTestPopupRecord(null);
    setTestPhase('running');
    setTestResult(null);
    setTestError(null);
  }

  // Group filtered records by every protocol family they support, preserving
  // the sort order of the filtered list (first-seen family pins the group
  // position).
  //
  // Multi-provider expansion (regression record 2026-04-30):
  //   A personal key with `supported_providers: ["anthropic", "openai"]`
  //   (e.g. an OpenRouter / 0011 aggregator key) MUST appear under BOTH
  //   the `anthropic` group AND the `openai` group — that's how the CLI
  //   `aikey use` picker shows it, and the Web should match. The previous
  //   implementation grouped only by the single `protocol_family` string,
  //   so multi-provider keys ended up in just one group and the user
  //   couldn't see / pick / use them under the other family. The fix
  //   iterates `supported_providers` for personal records (which the
  //   CLI populates from `entries.supported_providers`); OAuth records
  //   fall back to single-family grouping because OAuth credentials are
  //   inherently single-provider.
  //
  //   `recordInUseForGroup` then ensures the in-use badge fires only
  //   under the group whose provider is in `in_use_for` — so a key bound
  //   only to openai shows in BOTH groups but with the badge ONLY under
  //   openai. That's exactly the user's mental model from the CLI picker.
  const grouped = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, VaultRowRecord[]>();
    const addToGroup = (fam: string, r: VaultRowRecord) => {
      if (!map.has(fam)) {
        map.set(fam, []);
        order.push(fam);
      }
      map.get(fam)!.push(r);
    };
    for (const r of filtered) {
      // For personal keys with multi-provider support_providers, expand into
      // every family the key supports. OAuth records are inherently
      // single-provider — the credential is bound to one external account.
      //
      // 2026-05-08 V-layer family-grouping (update/20260508-display-family-grouping.md):
      // 每个 supported_provider 通过 familyOfProviderCode() 映射到 display family —
      // 多平台 family (Kimi: kimi_code/moonshot/kimi) 收敛到同一 group;
      // 单平台 family (anthropic/openai/...) family==code,行为不变。
      const families: string[] = (() => {
        // rc.3 fix (2026-05-12): team rows also need supported_providers
        // expansion. CLI emits the field for team records (commands_internal/
        // query.rs::team_records_for_emit), so aggregator-style team keys
        // that span multiple families (e.g. anthropic + openai) appear in
        // BOTH groups instead of just the primary protocol_family. OAuth
        // stays on the single-family path — OAuth sessions are per-provider
        // by construction (one identity per provider site).
        if (r.target === 'personal' || r.target === 'team') {
          const sp = (r as PersonalVaultRecord | TeamRowRecord).supported_providers;
          if (Array.isArray(sp) && sp.length > 0) {
            // Map each provider_code → family, dedup, preserve order.
            const seen = new Set<string>();
            const fams: string[] = [];
            for (const p of sp) {
              const raw = (p ?? '').toString().trim();
              if (!raw) continue;
              const fam = familyOfProviderCode(raw);
              if (!seen.has(fam)) {
                seen.add(fam);
                fams.push(fam);
              }
            }
            if (fams.length > 0) return fams;
          }
        }
        // OAuth path: protocol_family already comes family-resolved from backend
        // (commands_internal/query.rs::protocol_family_of returns registry.family).
        return [r.protocol_family ?? 'unknown'];
      })();
      for (const fam of families) addToGroup(fam, r);
    }
    return order.map((provider) => ({
      provider,
      color: providerBrandColor(provider),
      records: map.get(provider)!,
    }));
  }, [filtered]);

  // Pagination by GROUP (protocol family). User choice 2026-04-24:
  // each page shows up to N provider groups in full, so group headers
  // never split across pages and the in-page rhythm (header +
  // children) stays intact. Page size tuned to 3 — typical vaults hold
  // 3-6 providers, so one page usually covers the full set; heavier
  // vaults with 10+ providers still read well 3-at-a-time.
  const GROUPS_PER_PAGE = 3;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(grouped.length / GROUPS_PER_PAGE));
  // Clamp page when the grouped list shrinks (filter / search narrows
  // the dataset). Without this, deep-paging then narrowing the filter
  // leaves the user on an empty page with no visible recovery button.
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(1);
  }, [totalPages, currentPage]);
  const pagedGroups = useMemo(
    () => grouped.slice((currentPage - 1) * GROUPS_PER_PAGE, currentPage * GROUPS_PER_PAGE),
    [grouped, currentPage],
  );
  const pageKeyCount = useMemo(
    () => pagedGroups.reduce((sum, g) => sum + g.records.length, 0),
    [pagedGroups],
  );

  function toggleGroup(provider: string) {
    setCollapsedGroups((prev) => {
      const n = new Set(prev);
      if (n.has(provider)) n.delete(provider);
      else n.add(provider);
      return n;
    });
  }

  // Keep the open drawer in sync with the live records list. Two cases:
  //   - record removed (delete / sync churn) → close the drawer.
  //   - record updated (unlock revealed `route_token`, key renamed, etc.)
  //     → swap in the latest version so the drawer shows live values
  //     without forcing the user to close + reopen. The previous version
  //     of this effect only handled removal, so unlocking the vault while
  //     a drawer was open left it stuck on the locked snapshot
  //     (route_token=null). The reference-equality check guards against
  //     re-rendering when nothing actually changed.
  useEffect(() => {
    if (!drawerRecord) return;
    const live = records.find((r) => rowKey(r) === rowKey(drawerRecord));
    if (!live) {
      setDrawerRecord(null);
    } else if (live !== drawerRecord) {
      setDrawerRecord(live);
    }
  }, [records, drawerRecord]);

  // Peek-mode drawer auto-dismissal + wheel forwarding.
  //
  // When the overlay is showing, the user's wheel / trackpad events
  // land on the overlay (pointer-events: auto) and never reach the
  // page's real scroll container — so the table stays frozen and the
  // peek drawer just sits there. The fix has two moving parts:
  //
  //   1. `dismissIfOutsideDrawer`  — any wheel/touchmove outside the
  //      drawer closes the peek (user wants to browse, not stay in
  //      the drawer).
  //   2. Wheel forwarding           — on the *first* dismissing wheel
  //      we also forward its delta to the underlying scroll host
  //      (typically the UserShell main pane), so the table moves in
  //      sync with the gesture instead of the user feeling the first
  //      scroll was "eaten" by the drawer close. Subsequent wheels
  //      in the same gesture hit the container naturally because the
  //      effect's cleanup has already removed this listener (the
  //      overlay is unmounted together with drawerRecord).
  //
  // `forwarded` flag guards against multiple wheels landing in the
  // same React tick before the effect re-evaluates — without it the
  // table would double-scroll.
  useEffect(() => {
    if (!drawerRecord || drawerMode !== 'peek') return;

    // Find the nearest scrollable ancestor starting from the vault
    // page root — that's the UserShell main pane / document scroller
    // depending on layout. Element is truly scrollable when it has
    // overflow auto|scroll AND content taller than its client box.
    const findScrollHost = (start: HTMLElement | null): HTMLElement | null => {
      let cur: HTMLElement | null = start;
      while (cur && cur !== document.body) {
        const s = getComputedStyle(cur);
        if (
          (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
          cur.scrollHeight > cur.clientHeight
        ) {
          return cur;
        }
        cur = cur.parentElement;
      }
      const root = document.scrollingElement as HTMLElement | null;
      if (root && root.scrollHeight > root.clientHeight) return root;
      return null;
    };

    let forwarded = false;
    const onWheel = (e: WheelEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest && t.closest('.drawer')) return;
      if (forwarded) return;
      forwarded = true;
      const anchor = document.querySelector<HTMLElement>('.vault-page');
      const host = findScrollHost(anchor);
      if (host) {
        // Normalise deltaMode: 0=pixel, 1=line, 2=page. Most
        // trackpads are 0; mouse wheel may be 1 or 2.
        const lineHeight = 16;
        let top = e.deltaY;
        let left = e.deltaX;
        if (e.deltaMode === 1) { top *= lineHeight; left *= lineHeight; }
        else if (e.deltaMode === 2) { top *= host.clientHeight; left *= host.clientWidth; }
        host.scrollBy({ top, left, behavior: 'auto' });
      }
      setDrawerRecord(null);
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest && t.closest('.drawer')) return;
      setDrawerRecord(null);
    };
    // `capture: true` so stopPropagation inside the drawer doesn't
    // blind us to events outside. `passive: true` since we never
    // preventDefault — we observe + forward programmatically.
    window.addEventListener('wheel', onWheel, { capture: true, passive: true });
    window.addEventListener('touchmove', onTouchMove, { capture: true, passive: true });
    return () => {
      window.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('touchmove', onTouchMove, { capture: true });
    };
  }, [drawerRecord, drawerMode]);

  function beginEdit(r: VaultRowRecord) {
    setEditingId(rowKey(r));
    setEditDraft(r.alias ?? '');
  }
  function cancelEdit() {
    setEditingId(null);
    setEditDraft('');
  }
  function saveEdit(r: VaultRowRecord) {
    const trimmed = editDraft.trim();
    if (!trimmed || trimmed === r.alias) {
      cancelEdit();
      return;
    }
    // r.id semantics: personal=alias, oauth=provider_account_id, team=virtual_key_id.
    // Server PATCH /api/user/vault/entry/alias accepts all three (Phase 3B
    // 2026-05-11 widened the team branch); CLI dispatch goes through
    // apply_rename_core which writes managed_virtual_keys_cache.local_alias
    // for team rows (per-device label, mirrors the OAuth local_alias model).
    renameMut.mutate({ target: r.target, id: r.id, new_value: trimmed }, { onSuccess: cancelEdit });
  }
  function confirmDelete(r: VaultRecord) {
    deleteMut.mutate(
      { target: r.target, id: r.id },
      {
        onSuccess: () => {
          setDeletingId(null);
          if (drawerRecord && rowKey(drawerRecord) === rowKey(r)) {
            setDrawerRecord(null);
          }
        },
      },
    );
  }

  // Add Key modal state.
  const [addOpen, setAddOpen] = useState(false);

  // "Updated Xm ago" microcopy next to the refresh button. `nowTick`
  // advances on a 30s interval so the rendered string refreshes even
  // when the query itself hasn't refetched — otherwise "Updated 0m ago"
  // would stick until the next 10s polling beat lands.
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const updatedAgo = useMemo(() => {
    void nowTick; // re-compute on every tick
    return dataUpdatedAt ? formatRelative(Math.floor(dataUpdatedAt / 1000)) : '—';
  }, [dataUpdatedAt, nowTick]);

  // Totals — still used by the card-header chip row ("N active / N
  // error"). The Total keys / Health / Activity metric cards were
  // removed 2026-04-23 (user request) so `healthPct` / `totalUses` went
  // with them; if you're reviving those cards, reintroduce the memos.
  const activeCount = useMemo(
    () => records.filter((r) => r.status === 'active').length,
    [records],
  );
  const errorCount = useMemo(
    () => records.filter((r) => r.status !== 'active').length,
    [records],
  );

  return (
    <div className="vault-page vault-skin-v1 h-full flex flex-col min-w-0 min-h-0 overflow-hidden">
      <style>{VAULT_CSS}</style>
      <style>{VAULT_PAGE_SKIN_V1}</style>

      {/* The shell already draws breadcrumb / Invite; we render the 3.1
          content stack inside the scroll region. */}
      <div className="flex-1 overflow-y-auto">
        {/* Full-width content. The old max-w-[1200px] cap mirrored the
            design mock's centered desktop preview, but on 1440+ px
            external displays it left large empty gutters and wasted
            horizontal space in the keys card. Removed 2026-04-23. */}
        <div className="px-6 py-5 space-y-5">
          {/* Hook coverage v1 banner — populated by switchMut.onSuccess.
              Update 2026-05-07: passing onEnableClick wires the CTA to
              re-open the wire-rc modal (Personal + Trial only — modal
              auto-pops on first rc-unwired mutation; banner is the
              session-persistent fallback / re-opener). */}
          <HookReadinessBanner onEnableClick={wireRcModal.openManually} />
          <HookWireRcModal open={wireRcModal.open} onClose={wireRcModal.close} />
          {/* Phase 3A-2 team-fetch banner: surfaces categorical errors
              (not-logged-in / unauth / unreachable / parse-error) above
              the page so the user understands why the Team rows are
              hidden. Refresh button restarts the cross-origin fetch. */}
          <TeamFetchBanner
            status={teamStatus}
            error={teamError}
            onRetry={() => { void teamRefresh(); }}
          />
          <IdentityStrip onRefresh={() => refetchVault()} updatedAgo={updatedAgo} />

          <UnlockBanner
            unlocked={unlocked}
            initialized={initialized}
            ttlSeconds={vault?.ttl_seconds ?? null}
            password={unlockPassword}
            onPasswordChange={setUnlockPassword}
            onUnlock={() => unlockMut.mutate({ password: unlockPassword })}
            unlockPending={unlockMut.isPending}
            unlockError={unlockError}
            onLock={() => lockMut.mutate()}
            initPassword={initPassword}
            onInitPasswordChange={setInitPassword}
            initConfirm={initConfirm}
            onInitConfirmChange={setInitConfirm}
            onInitSubmit={submitInit}
            initPending={initMut.isPending}
            initError={initError}
          />

          {/* Hero metric row (Total keys / Health / Activity · 7D) was
              removed 2026-04-23 per user request — the card-header
              chips right below already convey "N stored / N active /
              N error", and usage trend data isn't fed by a real
              pipeline yet. */}

          {/* Toolbar (search + filter pills + sort tabs) lives OUTSIDE
              the table card, matching the FilterBar pattern used across
              the design system. Puts the filter controls above a
              standalone card so the card only frames the tabular data. */}
          <FilterStrip
            search={search}
            onSearchChange={setSearch}
            typeFilter={typeFilter}
            onTypeFilterChange={setTypeFilter}
            counts={counts}
            locked={!unlocked}
            onOpenAdd={() => setAddOpen(true)}
          />

          {/* When the vault has zero records, render JUST the empty
              placeholder — skip the .card wrapper + CardHeader entirely.
              The previous nested layout (card → CardHeader showing
              "0 stored / 0 active" → .vault-empty with its own bg +
              border) read as "card inside card" against the dark page,
              which the user flagged as unnecessarily heavy for a
              placeholder (2026-05-23). Loading / error / filter-empty
              states keep the card wrapper so CardHeader stays useful. */}
          {!listLoading && !listError && records.length === 0 ? (
            <VaultEmptyPanel />
          ) : (
          <section className="card overflow-hidden">
            <CardHeader
              counts={counts}
              activeCount={activeCount}
              errorCount={errorCount}
            />

            <div className="overflow-x-auto">
              {listLoading && <EmptyState message={t('vault.emptyLoading')} />}
              {listError && <EmptyState message={`${t('vault.loadFailed')}${(listError as Error).message}`} />}
              {!listLoading && !listError && records.length > 0 && filtered.length === 0 && (
                <EmptyState message={t('vault.emptyNoMatch')} />
              )}
              {filtered.length > 0 && (
                <table className="vault">
                  <thead>
                    <tr>
                      <th
                        style={{ width: '36%' }}
                        className={`th-sortable ${sortKey === 'alias' ? 'active' : ''}`}
                        onClick={() => setSortKey('alias')}
                        aria-sort={sortKey === 'alias' ? 'ascending' : 'none'}
                      >
                        {t('vault.aliasLabel')}<span className="th-hint">{t('vault.aliasEditableHint')}</span>
                        {sortKey === 'alias' && <span className="th-sort-arrow">↓</span>}
                      </th>
                      <th style={{ width: '22%' }}>{t('vault.colProtocols')}</th>
                      <th style={{ width: '14%' }}>{t('vault.colStatus')}</th>
                      <th
                        style={{ width: '12%' }}
                        className={`th-sortable ${sortKey === 'created' ? 'active' : ''}`}
                        onClick={() => setSortKey('created')}
                        aria-sort={sortKey === 'created' ? 'descending' : 'none'}
                      >
                        {t('vault.colCreated')}
                        {sortKey === 'created' && <span className="th-sort-arrow">↓</span>}
                      </th>
                      <th
                        style={{ width: '16%', textAlign: 'center' }}
                        className={`th-sortable ${sortKey === 'last_test' ? 'active' : ''}`}
                        onClick={() => setSortKey('last_test')}
                        aria-sort={sortKey === 'last_test' ? 'descending' : 'none'}
                        title={t('vault.colLastTestTitle')}
                      >
                        {t('vault.colLastTest')}
                        {sortKey === 'last_test' && <span className="th-sort-arrow">↓</span>}
                      </th>
                      <th style={{ width: 130, textAlign: 'right' }}>{t('vault.colActions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedGroups.map((g) => {
                      const collapsed = collapsedGroups.has(g.provider);
                      const personalCount = g.records.filter((r) => r.target === 'personal').length;
                      const oauthCount = g.records.filter((r) => r.target === 'oauth').length;
                      const teamCount = g.records.filter((r) => r.target === 'team').length;
                      // Within-group sort:
                      //   - sortKey='last_test' → sort purely by health desc
                      //     (most-healthy first, untested last), tiebreaker
                      //     by recency. Group order itself is NOT affected
                      //     (user spec 2026-05-23: 组顺序不要改, only re-rank
                      //     rows within each provider group).
                      //   - other sortKeys → keep the Phase 3A-2 design
                      //     decision 4 layout: Personal → Team → OAuth,
                      //     preserving the global sort order inside each
                      //     bucket. Team rows are read-only and visually
                      //     quieter, so wedging them between Personal (top
                      //     of mind) and OAuth (less touched) keeps the
                      //     most-used surfaces visually adjacent.
                      const targetOrder: Record<string, number> = {
                        personal: 0,
                        team: 1,
                        oauth: 2,
                      };
                      const sortedRecords = sortKey === 'last_test'
                        ? [...g.records].sort((a, b) => {
                            const aScore = lastTestHealthScore(a.extra?.last_test);
                            const bScore = lastTestHealthScore(b.extra?.last_test);
                            if (bScore !== aScore) return bScore - aScore;
                            const at = a.extra?.last_test?.at ?? 0;
                            const bt = b.extra?.last_test?.at ?? 0;
                            return bt - at;
                          })
                        : [...g.records].sort(
                            (a, b) => (targetOrder[a.target] ?? 9) - (targetOrder[b.target] ?? 9),
                          );
                      return (
                        <React.Fragment key={g.provider}>
                          <GroupHeaderRow
                            provider={g.provider}
                            color={g.color}
                            totalCount={g.records.length}
                            personalCount={personalCount}
                            oauthCount={oauthCount}
                            teamCount={teamCount}
                            collapsed={collapsed}
                            onToggle={() => toggleGroup(g.provider)}
                          />
                          {sortedRecords.map((r, idx) => {
                            const k = rowKey(r);
                            // Phase 3B (2026-05-11): team rows now support
                            // Use + inline Rename + drawer. Delete is the
                            // ONLY action that stays gated for team rows
                            // (server-managed lifecycle — local delete
                            // wouldn't actually revoke; only the team admin
                            // can revoke a key). All other callbacks pass
                            // through unchanged: vaultApi accepts target='team'
                            // for use+rename, and the drawer renders a
                            // VirtualKey section in place of Credential.
                            const isTeam = r.target === 'team';
                            return (
                              <Row
                                key={k}
                                record={r}
                                groupProvider={g.provider}
                                locked={!unlocked}
                                isEditing={editingId === k}
                                editDraft={editDraft}
                                onEditDraftChange={setEditDraft}
                                onBeginEdit={() => beginEdit(r)}
                                onCancelEdit={cancelEdit}
                                onSaveEdit={() => saveEdit(r)}
                                renamePending={renameMut.isPending}
                                isDeleting={deletingId === k}
                                onBeginDelete={() => { if (!isTeam) setDeletingId(k); }}
                                onCancelDelete={() => setDeletingId(null)}
                                onConfirmDelete={() => { if (!isTeam) confirmDelete(r as VaultRecord); }}
                                deletePending={deleteMut.isPending}
                                onOpenDrawer={(mode) => {
                                  setDrawerRecord(r);
                                  setDrawerMode(mode ?? 'persistent');
                                }}
                                isLastInGroup={idx === sortedRecords.length - 1}
                                isGroupCollapsed={collapsed}
                                switchPending={switchingIds.has(k)}
                                justSwitched={justSwitchedIds.has(k)}
                                onSwitch={() => switchTo(r, g.provider)}
                                onTest={() => runTest(r)}
                                testRunning={
                                  testPhase === 'running'
                                  && !!testPopupRecord
                                  && testPopupRecord.target === r.target
                                  && testPopupRecord.id === r.id
                                }
                              />
                            );
                          })}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <CardFooter
              pageKeyCount={pageKeyCount}
              filteredCount={filtered.length}
              totalCount={counts.total}
              currentPage={currentPage}
              totalPages={totalPages}
              groupsPerPage={GROUPS_PER_PAGE}
              onPrev={() => setCurrentPage((p) => Math.max(1, p - 1))}
              onNext={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            />
          </section>
          )}

          <PageFooter />
        </div>
      </div>

      {addOpen && (
        <AddKeyModal
          onClose={() => setAddOpen(false)}
          onSubmitPersonal={(payload) =>
            addMut.mutateAsync(payload).then(() => setAddOpen(false))
          }
          // BR (2026-05-25 vault-oauth-add-no-list-refresh): when the
          // OAuth broker inside AddKeyModal reports `connected=true`,
          // the token has just landed in vault — invalidate the
          // vault-list cache so the new row appears without a manual
          // page refresh. Personal API key adds invalidate via
          // `addMut.onSuccess` (line 796); OAuth doesn't go through
          // addMut (broker is its own state machine) so we wire this
          // separate signal in.
          onOAuthConnected={() =>
            qc.invalidateQueries({ queryKey: ['vault-list'] })
          }
          pending={addMut.isPending}
          providerToRoute={providerToRoute}
        />
      )}

      {drawerRecord && (
        <DetailDrawer
          record={drawerRecord}
          locked={!unlocked}
          onClose={() => setDrawerRecord(null)}
          onBeginRename={() => {
            beginEdit(drawerRecord);
            setDrawerRecord(null);
          }}
          onDelete={() => {
            setDeletingId(rowKey(drawerRecord));
            setDrawerRecord(null);
          }}
          // Phase 3B (2026-05-11): drawer "Use" button — same single-source-
          // of-truth as the inline row Use. groupProvider here is the
          // record's protocol_family because the drawer doesn't carry the
          // group context (drawer is opened from a row that already lives
          // in exactly one protocol group, so family is unambiguous).
          onUse={() => switchTo(drawerRecord, drawerRecord.protocol_family ?? 'unknown')}
          // Test connection moved to the row Actions column 2026-05-22;
          // popup state is still owned at page level so the popup
          // overlays the page rather than the drawer.
          inUse={recordInUseForGroup(drawerRecord, drawerRecord.protocol_family ?? 'unknown')}
          switchPending={switchingIds.has(rowKey(drawerRecord))}
          hostToRoute={hostToRoute}
          providerToRoute={providerToRoute}
        />
      )}

      {testPopupRecord && (
        <TestConnectionPopup
          record={testPopupRecord}
          phase={testPhase}
          result={testResult}
          error={testError}
          onClose={closeTestPopup}
          onRetry={() => runTest(testPopupRecord)}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

// ── Identity strip ───────────────────────────────────────────────────────

function IdentityStrip({
  onRefresh,
  updatedAgo,
}: {
  onRefresh: () => void;
  updatedAgo: string;
}) {
  const { t } = useTranslation();
  return (
    <section className="flex items-center justify-between flex-wrap gap-3">
      {/* Minimal page header — just the title text on the left, the
          refresh status + button on the right. The redundant "N KEYS ·
          N PERSONAL · N OAUTH" subtitle was dropped because the same
          counts are already surfaced by:
            - the CardHeader chips ("N stored / N active / N error")
              just below this strip on the Vault card itself, and
            - the FilterStrip filter pills ("All N / Key N / OAuth N").
          A leading shield icon was also removed; identity is carried
          by the topbar breadcrumb + sidebar active rail. Aligns with
          the icon-less, subtitle-less H1 used on Trust Check /
          Performance / Usage / Account / Usage Ledger. */}
      <div className="min-w-0">
        <div className="text-lg font-bold font-mono tracking-wide truncate" style={{ color: 'var(--display-foreground)' }}>{t('vault.myVault')}</div>
      </div>
      <div className="flex items-center gap-2">
        <span
          className="text-[12px] font-mono flex items-center gap-1.5"
          style={{ color: 'var(--muted-foreground)' }}
          title={t('vault.lastRefreshed')}
        >
          <RefreshIcon className="w-3 h-3" />
          {t('vault.updatedPrefix')}{updatedAgo}
        </span>
        <button
          className="btn btn-ghost text-xs px-2.5 py-1.5 flex items-center gap-1.5"
          onClick={onRefresh}
          title={t('vault.refresh')}
          aria-label={t('vault.refresh')}
        >
          <RotateIcon className="w-3.5 h-3.5" />
        </button>
      </div>
    </section>
  );
}

// ── Unlock banner ────────────────────────────────────────────────────────

function UnlockBanner(props: {
  unlocked: boolean;
  /** When false the vault has not been initialised (no master_salt row
   *  in vault.db). Per 20260430-个人vault-Web首次设置-方案A.md §1.1 the
   *  banner switches into "Set Master Password" mode in this state —
   *  same card, different CTA — instead of dumping the user on a
   *  password prompt for a vault that doesn't exist. */
  initialized: boolean;
  /** Raw TTL seconds from the latest `/vault/status` response. The
   *  banner owns the per-second countdown internally so the page
   *  doesn't re-render every tick — that change fixes a scroll-jank
   *  regression where all Rows / metrics were rebuilt each second. */
  ttlSeconds: number | null;
  password: string;
  onPasswordChange: (s: string) => void;
  onUnlock: () => void;
  unlockPending: boolean;
  unlockError: string | null;
  onLock: () => void;
  // First-run set-master-password fields (only used when initialized=false).
  initPassword: string;
  onInitPasswordChange: (s: string) => void;
  initConfirm: string;
  onInitConfirmChange: (s: string) => void;
  onInitSubmit: () => void;
  initPending: boolean;
  initError: string | null;
}) {
  const { t } = useTranslation();
  // Local tick state — isolated here so only this component re-renders
  // each second. Starts fresh whenever the parent hands us a new
  // ttlSeconds (happens on unlock, on mutations that extend, and on
  // the /vault/status poll every 10s).
  const [remaining, setRemaining] = useState<number | null>(props.ttlSeconds);
  useEffect(() => {
    setRemaining(props.ttlSeconds);
  }, [props.ttlSeconds]);
  useEffect(() => {
    if (!props.unlocked || remaining === null) return;
    const id = setInterval(() => {
      setRemaining((s) => (s === null || s <= 0 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [props.unlocked, remaining === null]);

  // Locked banner is collapsed by default — matches the /user/import
  // layout so the two pages feel like siblings. Clicking UNLOCK expands
  // the inline password form; Cancel collapses it back.
  const [expanded, setExpanded] = useState(false);
  const [initExpanded, setInitExpanded] = useState(false);
  // Auto-collapse whenever the caller transitions to unlocked so the
  // next lock cycle starts from the collapsed state.
  useEffect(() => {
    if (props.unlocked) {
      setExpanded(false);
      setInitExpanded(false);
    }
  }, [props.unlocked]);

  // First-run state: vault has never been initialised. Render the
  // "Set Master Password" branch — same card structure as the locked
  // branch but with a SET-MASTER-PASSWORD CTA and a confirm field.
  if (!props.initialized) {
    return (
      <div className="unlock-banner locked">
        <LockIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--primary)' }} />
        <span className="flex-1 flex items-center gap-2 min-w-0">
          <span
            className="font-mono text-sm font-bold uppercase tracking-wider"
            style={{ color: 'var(--soft-foreground)' }}
          >
            {t('vault.vaultNotSetUp')}
          </span>
          <span
            className="text-xs font-mono truncate"
            style={{ color: 'var(--muted-foreground)' }}
          >
            {t('vault.vaultNotSetUpHint')}
          </span>
        </span>
        {!initExpanded ? (
          <button
            className="btn btn-primary px-4 py-1.5 text-[11px]"
            onClick={() => setInitExpanded(true)}
          >
            {t('vault.setMasterPasswordCta')}
          </button>
        ) : (
          <div className="flex flex-col items-end gap-1.5">
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                props.onInitSubmit();
              }}
            >
              <input
                type="password"
                className="field-input"
                placeholder={t('vault.masterPasswordPlaceholder')}
                style={{ width: 180 }}
                value={props.initPassword}
                onChange={(e) => props.onInitPasswordChange(e.target.value)}
                autoFocus
                disabled={props.initPending}
              />
              <input
                type="password"
                className="field-input"
                placeholder={t('vault.confirmPlaceholder')}
                style={{ width: 140 }}
                value={props.initConfirm}
                onChange={(e) => props.onInitConfirmChange(e.target.value)}
                disabled={props.initPending}
              />
              <button
                type="submit"
                className="btn btn-primary px-3 py-1.5 text-[11px]"
                disabled={props.initPending || !props.initPassword || !props.initConfirm}
              >
                {props.initPending ? t('vault.setting') : t('vault.set')}
              </button>
              <button
                type="button"
                className="btn btn-ghost text-[11px] px-2 py-1.5"
                onClick={() => {
                  setInitExpanded(false);
                  props.onInitPasswordChange('');
                  props.onInitConfirmChange('');
                }}
                disabled={props.initPending}
              >
                {t('vault.cancel')}
              </button>
            </form>
            {props.initError && (
              <span
                className="text-[11px] font-mono"
                style={{ color: '#fca5a5' }}
              >
                {props.initError}
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  if (props.unlocked) {
    return (
      <div className="unlock-banner">
        <span className="dot" aria-hidden="true" />
        <LockOpenIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--success)' }} />
        {/* Casing aligned 2026-04-24 with the locked-banner structure:
            uppercase bold status label + em-dash + sentence-case
            descriptive clause. Previously the outer span had `uppercase`
            applied to the whole line, which turned the auto-lock
            countdown ("AUTO-LOCK IN 14M 55S") into shouty status copy
            and broke the locked/unlocked typographic parity. */}
        <span className="flex-1 flex items-center gap-2 min-w-0">
          <span
            className="font-mono text-sm font-bold uppercase tracking-wider"
            style={{ color: 'var(--foreground)' }}
          >
            {t('vault.vaultUnlocked')}
          </span>
          {remaining !== null && (
            <span
              className="text-xs font-mono truncate"
              style={{ color: 'var(--muted-foreground)' }}
            >
              {t('vault.autoLockIn')}{' '}
              <span style={{ color: 'var(--foreground)' }}>
                {Math.floor(remaining / 60)}m{' '}
                {String(remaining % 60).padStart(2, '0')}s
              </span>
            </span>
          )}
        </span>
        <button
          className="btn btn-outline text-[11px] px-2.5 py-1 flex items-center gap-1"
          onClick={props.onLock}
        >
          <LockIcon className="w-3 h-3" />
          {t('vault.lockNow')}
        </button>
      </div>
    );
  }
  return (
    <div className="unlock-banner locked">
      <LockIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--primary)' }} />
      {/* Casing + structure aligned with /user/import's Vault Locked
          banner (2026-04-24): uppercase bold status label + sentence-
          case descriptive clause separated by an em-dash. Matches the
          sibling-page voice instead of the earlier all-caps string. */}
      <span className="flex-1 flex items-center gap-2 min-w-0">
        <span
          className="font-mono text-sm font-bold uppercase tracking-wider"
          style={{ color: 'var(--soft-foreground)' }}
        >
          {t('vault.vaultLocked')}
        </span>
        <span
          className="text-xs font-mono truncate"
          style={{ color: 'var(--muted-foreground)' }}
        >
          {t('vault.vaultLockedHint')}
        </span>
      </span>
      {!expanded ? (
        // Collapsed default — mirrors /user/import. Only a single
        // UNLOCK button; the password field stays hidden until the user
        // commits to unlocking.
        <button
          className="btn btn-primary px-4 py-1.5 text-[11px]"
          onClick={() => setExpanded(true)}
        >
          {t('vault.unlock')}
        </button>
      ) : (
        <div className="flex flex-col items-end gap-1.5">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              props.onUnlock();
            }}
          >
            <input
              type="password"
              className="field-input"
              placeholder={t('vault.masterPasswordPlaceholder')}
              style={{ width: 220 }}
              value={props.password}
              onChange={(e) => props.onPasswordChange(e.target.value)}
              autoFocus
            />
            <button
              type="submit"
              className="btn btn-primary px-3 py-1.5 text-[11px]"
              disabled={props.unlockPending || !props.password}
            >
              {props.unlockPending ? t('vault.unlocking') : t('vault.unlock')}
            </button>
            <button
              type="button"
              className="btn btn-ghost text-[11px] px-2 py-1.5"
              onClick={() => {
                setExpanded(false);
                props.onPasswordChange('');
              }}
            >
              {t('vault.cancel')}
            </button>
          </form>
          {props.unlockError && (
            <span
              className="text-[11px] font-mono"
              style={{ color: '#fca5a5' }}
            >
              {props.unlockError}
            </span>
          )}
        </div>
      )}
    </div>
  );
}


// formatCompactNumber removed 2026-05-22 — its only consumer was the
// per-row "12K uses" sub-line in the "Last used" column, which was
// itself replaced by the new "Last test" column (status pill + latency).
// `use_count` is still surfaced inside the drawer's Meta section as a
// raw integer so the count remains visible for power users; the K/M
// abbreviation isn't needed there.

// ── Card header ──────────────────────────────────────────────────────────

function CardHeader({
  counts,
  activeCount,
  errorCount,
}: {
  counts: { personal: number; oauth: number; team: number; total: number };
  activeCount: number;
  errorCount: number;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap"
      style={{
        borderBottom: '1px solid var(--border)',
        /* Darker header band (rgba(0,0,0,0.2) over var(--card)) gives
           the table body the same "lighter panel / darker lid"
           hierarchy used across the design system. */
        backgroundColor: 'rgba(0,0,0,0.2)',
      }}
    >
      <div className="flex items-center gap-3 min-w-0 flex-wrap">
        <h3 className="text-xs font-mono font-bold tracking-wider uppercase whitespace-nowrap" style={{ color: 'var(--muted-foreground)' }}>{t('vault.allKeys')}</h3>
        <span className="chip">{counts.total}{t('vault.storedSuffix')}</span>
        {activeCount > 0 && (
          <span className="chip success">
            <span className="status-dot" style={{ width: 5, height: 5 }} />
            {activeCount}{t('vault.activeSuffix')}
          </span>
        )}
        {errorCount > 0 && (
          <span className="chip danger">
            <span className="status-dot error" style={{ width: 5, height: 5 }} />
            {errorCount}{t('vault.errorSuffix')}
          </span>
        )}
      </div>
      {/* Removed 2026-04-24 per user request:
          - "ROUTING · N PROVIDERS" chip + its RoutePopover (per-row
            Use button + drawer "Route via this key" already cover the
            same action surface).
          - Export button (placeholder for a v1.0 feature that never
            landed).
          Import + Add key buttons moved 2026-04-25 to the FilterStrip
          toolbar above the card — master pages keep filters + actions
          together in the top toolbar. */}
    </div>
  );
}

// ── Filter strip ─────────────────────────────────────────────────────────

function FilterStrip(props: {
  search: string;
  onSearchChange: (s: string) => void;
  typeFilter: TypeFilter;
  onTypeFilterChange: (v: TypeFilter) => void;
  counts: { personal: number; oauth: number; team: number; total: number };
  locked: boolean;
  onOpenAdd: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      /* FilterStrip follows master's FilterBar layout (naked toolbar,
         no frame / no bg, left-aligned, right-side controls via
         ml-auto). Sizes bumped 2026-04-25 so the toolbar feels
         generous rather than cramped — master uses w-52 / py-1.5 /
         text-xs which reads tiny against a full vault table, so here
         we upsize to w-72 / py-2 / text-sm while keeping the same
         structure.
         Import + Add key CTAs moved here from CardHeader 2026-04-25
         per UX — top toolbar is master's standard "filters + actions"
         pattern (search / pills on the left, action buttons on the
         ml-auto right). */
      className="flex items-center gap-4 flex-wrap"
    >
      <div className="flex items-center gap-4 flex-wrap min-w-0">
        <div className="relative">
          <SearchIcon
            className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'var(--muted-foreground)' }}
          />
          <input
            type="text"
            className="pl-10 pr-3 py-2 text-sm w-72"
            placeholder={t('vault.searchAliasPlaceholder')}
            value={props.search}
            onChange={(e) => props.onSearchChange(e.target.value)}
            aria-label={t('vault.searchKeysAria')}
          />
        </div>

        {/* Type filter — segmented capsule. Status filter removed
            2026-04-24 (near-all keys are active in practice, row-
            level status chip carries the signal when an error shows
            up). The "Type" label prefix was removed 2026-04-25 — the
            All/API/OAuth pill labels already read as type filters. */}
        <div className="filter-group" role="radiogroup" aria-label={t('vault.filterByTypeAria')}>
          <FilterPill
            active={props.typeFilter === 'all'}
            onClick={() => props.onTypeFilterChange('all')}
            label={t('vault.filterAll')}
            count={props.counts.total}
          />
          <FilterPill
            active={props.typeFilter === 'personal'}
            onClick={() => props.onTypeFilterChange('personal')}
            icon={<KeyRoundIcon className="w-2.5 h-2.5" />}
            label={t('vault.filterKey')}
            count={props.counts.personal}
          />
          <FilterPill
            active={props.typeFilter === 'team'}
            onClick={() => props.onTypeFilterChange('team')}
            icon={<UsersIcon className="w-2.5 h-2.5" />}
            label={t('vault.filterTeam')}
            count={props.counts.team}
          />
          <FilterPill
            active={props.typeFilter === 'oauth'}
            onClick={() => props.onTypeFilterChange('oauth')}
            icon={<UserCheckIcon className="w-2.5 h-2.5" />}
            label={t('vault.filterOAuth')}
            count={props.counts.oauth}
          />
        </div>
      </div>

      {/* Right-aligned actions. Sort tabs were moved into the table's
          <thead> 2026-04-25 — column headers themselves are now click-
          to-sort. Import + Add key fill that ml-auto slot now. */}
      <div className="flex items-center gap-4 ml-auto flex-shrink-0">
        {/* Gap between Import and Add key doubled (gap-2 → gap-4)
            2026-04-25 so the two CTAs don't read as a single lump. */}
        <a
          className="btn btn-outline text-[11px] px-2.5 py-1 flex items-center gap-1"
          href="/user/import"
          title={t('vault.importTitle')}
        >
          <UploadIcon className="w-3 h-3" />
          {t('vault.import')}
        </a>
        <button
          className="btn btn-primary btn-primary-dim text-[11px] px-3 py-1 flex items-center gap-1"
          onClick={props.onOpenAdd}
          disabled={props.locked}
          title={props.locked ? t('vault.addKeyLockedTitle') : t('vault.addKeyTitle')}
        >
          <PlusIcon className="w-3 h-3" />
          {t('vault.addKey')}
        </button>
      </div>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  label,
  count,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}) {
  return (
    <button className={`filter-pill${active ? ' active' : ''}`} onClick={onClick}>
      {icon}
      {label}
      {typeof count === 'number' && <span className="count">{count}</span>}
    </button>
  );
}

// ── Team fetch banner ────────────────────────────────────────────────────
//
// Phase 3A-2: surfaces the team-vault store's failure modes above the table
// so users know WHY their team keys aren't showing (vs. a silent empty
// "Team" filter). The four failure kinds map to distinct UX surfaces per
// design decision 6 (roadmap update 20260511 §6):
//
//   - not-logged-in:  user hasn't run `aikey login` yet against any team
//                     server. NOT shown — most personal-edition users will
//                     never log into a team and we don't want to nag them.
//   - unauth:         had a session, JWT expired or revoked. Re-login CTA.
//   - unreachable:    team server down or wrong base URL. Retry CTA.
//   - parse-error:    server returned 200 but unexpected shape. Retry CTA
//                     (transient bug or version skew, log captures detail).
//
// Hidden during idle / loading / loaded so the banner only fires on real
// failures and doesn't oscillate during refresh.
function TeamFetchBanner(props: {
  status: TeamVaultStatus;
  error: TeamFetchError | null;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const { status, error, onRetry } = props;
  // Suppress not-logged-in (single-user installs) and the happy-path
  // states (idle/loading/loaded). Only loud failure modes get a banner.
  if (status === 'idle' || status === 'loading' || status === 'loaded') return null;
  if (status === 'not-logged-in') return null;

  let title: string;
  let body: React.ReactNode;
  let canRetry = true;
  switch (status) {
    case 'unauth':
      title = t('vault.teamSessionExpired');
      body = (
        <>
          {t('vault.teamSessionExpiredBody')}{' '}
          <code className="font-mono">aikey login</code> {t('vault.teamSessionExpiredBodyTail')}
        </>
      );
      break;
    case 'unreachable':
      title = t('vault.teamServerUnreachable');
      body = (
        <>
          {t('vault.teamUnreachableBody')}
          {error && error.kind === 'unreachable' && (error.status || error.detail) ? (
            <>
              {' ('}
              {error.status ? `HTTP ${error.status}` : null}
              {error.status && error.detail ? ', ' : ''}
              {error.detail || ''}
              {')'}
            </>
          ) : null}
          {t('vault.teamUnreachableBodyTail')}
        </>
      );
      break;
    case 'parse-error':
      title = t('vault.teamServerUnexpectedResponse');
      body = (
        <>
          {t('vault.teamParseErrorBody')}
          {error && error.kind === 'parse-error' && error.detail
            ? ` (${error.detail})`
            : ''}
          {t('vault.teamParseErrorBodyTail')}
        </>
      );
      break;
    default:
      // exhaustive — `status` is narrowed away from the handled kinds above.
      return null;
  }
  return (
    <div
      className="team-banner"
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.75rem',
        padding: '0.625rem 0.875rem',
        border: '1px solid rgba(249,115,22,0.35)',
        borderRadius: 6,
        background: 'rgba(249,115,22,0.06)',
        color: 'var(--warning)',
        fontSize: 12,
      }}
    >
      <InfoIcon className="w-3.5 h-3.5" style={{ marginTop: 2, flexShrink: 0 }} />
      <div style={{ flex: 1, lineHeight: 1.5 }}>
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div style={{ marginTop: 2, color: 'var(--muted-foreground)' }}>{body}</div>
      </div>
      {canRetry && (
        <button
          type="button"
          className="btn btn-ghost text-[11px] px-2 py-1"
          onClick={onRetry}
          title={t('vault.retryTeamFetchTitle')}
        >
          {t('vault.retry')}
        </button>
      )}
    </div>
  );
}

// ── Row ──────────────────────────────────────────────────────────────────

// React.memo: 20+ rows × Provider chip + chips + icons don't need to
// re-diff on unrelated parent state (filter changes, drawer open, etc.)
// as long as THIS row's props are unchanged. Major scroll-smoothness
// win since the page already re-renders on poll beats.

// ── Toast stack ──────────────────────────────────────────────────────
//
// Bottom-center stack for routing-switch feedback. Each toast has a 5s
// timer (CSS animation); the stack removes its entry via `onDismiss`.
function ToastStack(props: {
  toasts: Array<{
    id: number;
    kind: 'success' | 'error';
    title: string;
    sub?: string;
    undo?: () => void;
  }>;
  onDismiss: (id: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="true">
      {props.toasts.map((toast) => (
        <div key={toast.id} className={`toast${toast.kind === 'error' ? ' error' : ''}`} data-open="true">
          <span className="toast-icon">
            {toast.kind === 'success' ? (
              <ZapIcon className="w-3 h-3" />
            ) : (
              <InfoIcon className="w-3 h-3" />
            )}
          </span>
          <div className="toast-body">
            <div className="toast-title">{toast.title}</div>
            {toast.sub && <div className="toast-sub">{toast.sub}</div>}
          </div>
          <div className="toast-actions">
            {toast.undo && (
              <button
                type="button"
                className="toast-undo"
                onClick={() => {
                  toast.undo!();
                  props.onDismiss(toast.id);
                }}
              >
                {t('vault.undo')}
              </button>
            )}
            <button
              type="button"
              className="toast-dismiss"
              onClick={() => props.onDismiss(toast.id)}
              aria-label={t('vault.dismiss')}
            >
              <XIcon className="w-3 h-3" />
            </button>
          </div>
          <span className="toast-timer" />
        </div>
      ))}
    </div>
  );
}

// ── Group header row ─────────────────────────────────────────────────
//
// Renders a single <tr.group-row> spanning all table columns. Shows the
// provider name + entry count. Click the chevron button to collapse /
// expand the group's children (state lives in parent; this component
// only fires onToggle). The prior right-side ROUTING chip was removed
// 2026-04-24 per user request — per-row .in-use marker (yellow tint +
// IN USE pill on the active child) carries the same info without
// duplicating it at the group level.
function GroupHeaderRow(props: {
  provider: string;
  color: string;
  totalCount: number;
  personalCount: number;
  oauthCount: number;
  /** Phase 3A-2: team-key contribution to the group, rendered as a third
   *  count chip alongside KEY/OAUTH so the user sees the merged composition. */
  teamCount: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const { provider, color, totalCount, personalCount, oauthCount, teamCount, collapsed, onToggle } = props;
  const parts: string[] = [];
  if (personalCount > 0) parts.push(`${personalCount} KEY`);
  if (teamCount > 0) parts.push(`${teamCount} TEAM`);
  if (oauthCount > 0) parts.push(`${oauthCount} OAUTH`);
  const entryWord = totalCount === 1 ? t('vault.groupEntrySingular') : t('vault.groupEntryPlural');
  return (
    <tr className="group-row" data-collapsed={collapsed ? 'true' : 'false'} data-group-provider={provider}>
      <td colSpan={6}>
        <div className="gr-inner">
          <button
            type="button"
            className="gr-toggle"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-label={t('vault.toggleGroupAria', { provider })}
          >
            <ChevronDownIcon className="w-3 h-3" />
          </button>
          {/* Replaced 2026-04-30: was a 8px gr-dot color circle, but it
              visually collided with the per-row green active-dot (also a
              circle) under in-use rows. Now render the provider name as a
              colored chip so the group identifier and the per-row active
              indicator stay visually distinct. The chip's background uses
              the same provider brand color, foreground is white for
              contrast. */}
          <span
            className="gr-chip"
            style={{ background: color }}
            aria-hidden="false"
          >
            {provider}
          </span>
          {/* 2026-05-12 single-platform brand alias rendered OUTSIDE the
              chip in muted text — e.g. `anthropic` chip + ` (claude)`.
              Source of truth: generated provider-registry.ts (codegen'd
              from aikey-cli/data/provider_registry.yaml display_alias
              field). Multi-platform families (kimi) have no family-level
              alias by design — the per-row labels (kimi(kimi-code) /
              kimi(moonshot)) carry the platform discriminator. */}
          {ENTRY_BY_FAMILY.get(provider)?.displayAlias && (
            <span
              className="gr-alias"
              style={{ color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: '11.5px' }}
              aria-hidden="true"
            >
              ({ENTRY_BY_FAMILY.get(provider)!.displayAlias})
            </span>
          )}
          <span className="gr-meta">
            · {totalCount} {entryWord}
            {parts.length > 0 && (
              <>
                <span className="gr-sep">·</span>
                {parts.map((p, i) => (
                  <React.Fragment key={p}>
                    {p}
                    {i < parts.length - 1 && <span className="gr-sep">·</span>}
                  </React.Fragment>
                ))}
              </>
            )}
          </span>
        </div>
      </td>
    </tr>
  );
}

const Row = React.memo(function Row(props: {
  /** Row union widened to include team rows (Phase 3A-2 introduction,
   *  Phase 3B revision 2026-05-11). The Row branches on
   *  `r.target === 'team'` to suppress only the destructive Delete
   *  action; everything else — Use, Rename (writes CLI `local_alias`,
   *  not the server alias), drawer open with route_url / Route token —
   *  is enabled in Phase 3B. See roadmap update 20260511 decision 3
   *  for the per-action gate breakdown. */
  record: VaultRowRecord;
  locked: boolean;
  isEditing: boolean;
  editDraft: string;
  onEditDraftChange: (v: string) => void;
  onBeginEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  renamePending: boolean;
  isDeleting: boolean;
  onBeginDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  deletePending: boolean;
  /** Opens the DetailDrawer. `mode` defaults to 'persistent'; 'peek'
   *  is used by row-level / IN-USE-chip clicks so the drawer auto-closes
   *  when the user scrolls past it (see VaultPage drawerMode). */
  onOpenDrawer: (mode?: 'persistent' | 'peek') => void;
  /** True when this row is the last under its group header — controls the
   *  tree-indent connector ending for the tr.group-child::before pseudo. */
  isLastInGroup?: boolean;
  /** True when the group this row belongs to is collapsed — hide the row
   *  via .group-hidden class while keeping it in the DOM for scroll stability. */
  isGroupCollapsed?: boolean;
  /** Pending UI state for the Use button — disables + shows progress cursor. */
  switchPending?: boolean;
  /** Briefly apply .just-switched for the route-pulse keyframe animation
   *  after a successful switch (600ms). Parent sets then clears this prop. */
  justSwitched?: boolean;
  onSwitch?: () => void;
  /** Test connection icon button (2026-05-22) — runs the connectivity
   *  probe against this row's credential and persists the result to
   *  `extra.$.last_test`. Moved from the drawer to the row to match the
   *  other inline actions; an icon-only button keeps the column width
   *  unchanged. Same handler the drawer used to dispatch; nothing about
   *  the popup state machine changes. */
  onTest?: () => void;
  /** True while a probe is in flight for this specific row. Disables
   *  the icon + shows a tooltip so the user can see the click was
   *  picked up. */
  testRunning?: boolean;
  /** The provider code of the group this row is rendered under. Drives
   *  per-(record, provider) `in_use` derivation via recordInUseForGroup —
   *  see the helper's doc-comment for the regression history. Required so
   *  multi-provider keys / alias-collisions don't show in_use badge under
   *  groups they're not actually bound to. */
  groupProvider: string;
}) {
  const { t } = useTranslation();
  const r = props.record;
  const inUse = recordInUseForGroup(r, props.groupProvider);
  const lockedTitle = props.locked ? t('vault.unlockToUseAction') : undefined;
  const providerName = providerDisplayName(r);
  const isTeam = r.target === 'team';
  const isOAuth = r.target === 'oauth';
  const aliasMono = isMonoAlias(r.alias);
  const kindLabel = isTeam ? 'TEAM' : isOAuth ? 'OAUTH' : 'KEY';
  const kindClass = isTeam ? ' team' : isOAuth ? ' oauth' : '';

  // Secondary alias line: route_token tail + contextual hint.
  const rtTail = shortRouteToken(
    r.target === 'personal'
      ? (r as PersonalVaultRecord).route_token
      : null,
  );
  let subLine: React.ReactNode;
  if (r.target === 'personal') {
    const p = r as PersonalVaultRecord;
    subLine = (
      <>
        {rtTail ?? ''}
        {rtTail && p.provider_code && <span className="mx-1 opacity-40">·</span>}
        {p.provider_code && <span>{p.provider_code}</span>}
      </>
    );
  } else if (r.target === 'team') {
    // Team rows: show share lifecycle + optional expiry. The share state
    // is the most actionable signal (pending = user hasn't claimed yet,
    // revoked = key is dead even if metadata lingers); expiry is a hint
    // about the team-managed lifecycle so users aren't surprised when
    // the team admin's rotation kicks in.
    const expires = formatExpiresAtIso(r.expires_at, t);
    // N6 seat_group (Stage A): on a group VK, surface the shared-group marker +
    // the master-assigned DEFAULT pool account identity (the one routed to by
    // default). The full candidate list is in the drawer. NOTE: "default" is
    // master's static rank-0 pick; the proxy's live selection (which may fall
    // back when an account is cooled) is Stage B.
    const defaultAcct = r.group_accounts?.find((a) => a.assigned) ?? r.group_accounts?.[0];
    subLine = (
      <>
        {t('vault.teamKeyPrefix')}{teamShareLabel(r.share_status, t)}
        {r.seat_group_id && (
          <>
            <span className="mx-1 opacity-40">·</span>
            <span style={{ color: 'var(--primary-dim)' }}>{t('vault.seatGroupShared')}</span>
            {defaultAcct && (
              <>
                <span className="mx-1 opacity-40">·</span>
                <span title={t('vault.seatGroupDefaultAccount')}>{defaultAcct.identity}</span>
              </>
            )}
          </>
        )}
        {expires && (
          <>
            <span className="mx-1 opacity-40">·</span>
            <span>{expires}</span>
          </>
        )}
      </>
    );
  } else {
    const o = r as OAuthVaultRecord;
    const expires = formatExpiresIn(o.token_expires_at, t);
    subLine = (
      <>
        {providerName}{t('vault.sessionSuffix')}
        {expires && (
          <>
            <span className="mx-1 opacity-40">·</span>
            <span>{expires}</span>
          </>
        )}
      </>
    );
  }

  const trClasses = [
    'group-child',
    'row-clickable',
    props.isLastInGroup ? 'last-in-group' : '',
    props.isGroupCollapsed ? 'group-hidden' : '',
    inUse ? 'in-use' : '',
    props.justSwitched ? 'just-switched' : '',
  ].filter(Boolean).join(' ');

  // Row-level click opens the detail drawer (2026-04-24 user request:
  // "non in-use rows should also open a drawer showing Route via this
  // key hint + aikey activate CTA"). Skip when the click landed on an
  // interactive descendant — inline action buttons, the alias edit
  // input, etc. — so each cell-level action keeps its own semantics.
  // Phase 3B (2026-05-11): the prior Phase 3A guard `if (isTeam) return`
  // was removed — team rows used to lack a drawer surface (honest "no
  // detail" feedback was the right call back then). Phase 3B inlined
  // route_url + Route token + Virtual Key id into the team drawer, so
  // there IS something to show now; row-click should peek-open in lock-
  // step with Personal / OAuth for UX consistency.
  const onRowClick = (e: React.MouseEvent<HTMLTableRowElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest('button, input, textarea, a, [role="button"]')) return;
    // Row-level open is a "peek" — casual click while scanning; the
    // drawer auto-closes on scroll so it doesn't linger.
    props.onOpenDrawer('peek');
  };

  return (
    <tr className={trClasses} onClick={onRowClick}>
      <td>
        {props.isEditing ? (
          <div className="flex items-center gap-1.5">
            <input
              className="inline-input"
              autoFocus
              value={props.editDraft}
              onChange={(e) => props.onEditDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') props.onSaveEdit();
                if (e.key === 'Escape') props.onCancelEdit();
              }}
              style={{ width: 220 }}
            />
            <button
              className="btn btn-primary text-[10px] px-2 py-0.5 flex items-center"
              onClick={props.onSaveEdit}
              disabled={props.renamePending}
              title={t('vault.saveAlias')}
            >
              <CheckIcon className="w-3 h-3" />
            </button>
            <button
              className="btn btn-ghost text-[10px] px-1.5 py-0.5 flex items-center"
              onClick={props.onCancelEdit}
              title={t('vault.cancel')}
            >
              <XIcon className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <>
            <div
              className={`alias-main${aliasMono ? ' mono' : ''}`}
              style={r.alias ? undefined : { color: 'var(--muted-foreground)', fontStyle: 'italic' }}
            >
              {inUse && (
                /* CLI-style "active" dot — mirrors the green ● aikey
                   route prints next to the currently-routing row so
                   web and terminal read as one visual system. Placed
                   before the alias text, sibling to the IN USE chip.
                   Per-(record, provider) — see recordInUseForGroup. */
                <span
                  className="active-dot"
                  aria-hidden="true"
                  title={t('vault.currentlyRouting')}
                />
              )}
              {r.alias || t('vault.unnamed')}
              {/* IN USE chip moved to the Actions column (2026-04-25)
                  so every row's rightmost cell has the same routing
                  affordance — a "Use" button when the key is idle,
                  an "IN USE" chip when it's already the active route.
                  The green ● left of the alias retains the inline
                  signal; this keeps alias-cell tidy and the status
                  legible in the column users scan for actions. */}
            </div>
            <div className="alias-sub">{subLine}</div>
          </>
        )}
      </td>

      <td>
        <span className="provider-cell">
          <span
            className="prov-dot"
            style={{ background: providerBrandColor(providerName) }}
            aria-hidden="true"
          />
          <span className="name">{providerName}</span>
          <span className={`kind-pill${kindClass}`}>{kindLabel}</span>
        </span>
      </td>

      <td>
        {r.status === 'active' ? (
          <span className="chip success">
            <span className="status-dot" style={{ width: 5, height: 5 }} />
            {t('vault.statusActive')}
          </span>
        ) : (
          <span className="chip danger">
            <span className="status-dot error" style={{ width: 5, height: 5 }} />
            {String(r.status).toUpperCase()}
          </span>
        )}
      </td>

      <td
        className="font-mono text-[11.5px]"
        style={{ color: 'var(--muted-foreground)' }}
      >
        {formatCreatedShort(r.created_at)}
      </td>

      <td style={{ textAlign: 'center' }}>
        {/* Last connectivity test (2026-05-22). Replaced the prior
            "Last used" column (last_used_at + use_count) — that
            telemetry is still collected on the row record and surfaced
            in the drawer Meta section, but this column now shows the
            health signal users actually care about ("is this key
            working right now?"). Em-dash placeholder until the user
            has run a test on this key. Applies uniformly to personal
            / oauth / team — the 2026-05-22 upsert refactor made team
            rows safe to persist too.
            Cell center-aligned 2026-05-23: the LastTestCell renders as
            a tiny 13×15px signal-bars icon — left-aligned it floats
            against the wide column and reads as disconnected from the
            header. Centering anchors header + cell to the same axis. */}
        <LastTestCell value={r.extra?.last_test ?? null} />
      </td>

      <td style={{ textAlign: 'right' }}>
        {/* Phase 3B (2026-05-11): team rows now share the row-actions
            slot with Personal/OAuth (Use + View + Rename), with one
            difference — Delete is hidden for team rows. The DB-level
            delete cannot revoke a team-issued key (only the team admin
            can revoke server-side); rendering a Delete button that
            silently does nothing local would be misleading. */}
        {props.isDeleting ? (
          <div className="flex items-center gap-1 justify-end">
            <span
              className="text-[11px] font-mono mr-1"
              style={{ color: '#fca5a5' }}
            >
              {t('vault.deleteForever')}
            </span>
            <button
              className="btn btn-danger text-[10px] px-2.5 py-1"
              onClick={props.onConfirmDelete}
              disabled={props.deletePending || props.locked}
              title={
                props.locked
                  ? t('vault.deleteLockedTitle')
                  : props.deletePending
                  ? t('vault.deletingTitle')
                  : t('vault.confirmDeleteTitle')
              }
            >
              {t('vault.delete')}
            </button>
            <button
              className="btn btn-ghost text-[10px] px-2 py-1"
              onClick={props.onCancelDelete}
            >
              {t('vault.cancel')}
            </button>
          </div>
        ) : (
          <div className="row-actions">
            {/* Same cell, two states:
                  • in_use:false → "Use" switcher button (unchanged action)
                  • in_use:true  → "IN USE" chip (clickable, opens drawer
                                   in peek mode with shell-usage hint)
                Keeping both variants in the same slot means the user's
                eye scans one column for "is this routing? can I make
                it route?" rather than hunting across alias + actions
                cells. */}
            {props.onSwitch && !inUse && (() => {
              // Phase 3B (2026-05-11): team rows whose effective_status is
              // 'inactive' (revoked / suspended / scope-disabled / not yet
              // claimed) cannot be used — the CLI bridge's local_state gate
              // would reject the binding write with I_KEY_DISABLED.
              //
              // 2026-05-11 user request: instead of greying the button, **hide
              // it entirely** for inactive team keys. The disabled-with-
              // tooltip pattern still looks like an offer of an action that
              // happens not to be available; hiding makes it clear that the
              // row is read-only until the team admin re-issues / re-claims
              // it. Other actions (View / Rename) still render, so the row
              // stays informative — see the EyeIcon "View details" button
              // below which is enabled regardless.
              const teamUnusable = isTeam && (r as TeamRowRecord).effective_status !== 'active';
              if (teamUnusable) return null;
              const useTitle = props.locked
                ? t('vault.useLockedTitle')
                : 'Route all requests through ' + (r.alias ?? t('vault.unnamed')) + '  (aikey use)';
              return (
                <button
                  type="button"
                  className="row-use-btn"
                  title={useTitle}
                  onClick={props.onSwitch}
                  disabled={props.locked || !!props.switchPending}
                  aria-label={t('vault.setAsActiveKeyAria')}
                >
                  <ZapIcon className="w-3 h-3" />
                  {t('vault.use')}
                </button>
              );
            })()}
            {inUse && (
              <button
                type="button"
                className="in-use-chip"
                title={t('vault.inUseChipTitle')}
                aria-label={t('vault.inUseChipAria')}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onOpenDrawer('peek');
                }}
              >
                <ZapIcon className="w-2.5 h-2.5" />
                {t('vault.inUse')}
              </button>
            )}
            <button
              className="icon-btn"
              title={t('vault.viewDetails')}
              onClick={(e) => {
                e.stopPropagation();
                // Explicit View Details → persistent drawer (stays open
                // while the user scrolls / explores the list).
                props.onOpenDrawer('persistent');
              }}
            >
              <EyeIcon className="w-3.5 h-3.5" />
            </button>
            {/* Test connection (2026-05-22). Icon-only inline action that
                opens the popup + runs the probe + persists to vault.
                Always enabled — the probe itself doesn't need the vault
                unlocked (decryption happens server-side in aikey-proxy).
                If the proxy is down the popup surfaces an actionable
                error rather than the button being mysteriously greyed. */}
            {props.onTest && (
              <button
                className="icon-btn"
                title={props.testRunning ? t('vault.probeInProgressTitle') : t('vault.testConnection')}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onTest?.();
                }}
                disabled={!!props.testRunning}
                aria-label={t('vault.testConnection')}
              >
                <ActivityIcon className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              className="icon-btn primary"
              title={lockedTitle ?? t('vault.renameAliasTitle')}
              onClick={props.onBeginEdit}
              disabled={props.locked}
            >
              <EditIcon className="w-3.5 h-3.5" />
            </button>
            {!isTeam && (
              <button
                className="icon-btn danger"
                title={lockedTitle ?? t('vault.deleteTitle')}
                onClick={props.onBeginDelete}
                disabled={props.locked}
              >
                <TrashIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
},
// Custom compare: the call site passes inline arrow callbacks, so the
// default shallow compare would always fail and memo would be a no-op.
// We intentionally ignore the callback props — closures capture the
// `record` and parent state references, and since `record` equality
// gates re-render, any callback that needs fresh data will see it on
// the render triggered by a record-change.
(prev, next) => {
  if (prev.record !== next.record) return false;
  if (prev.locked !== next.locked) return false;
  if (prev.isEditing !== next.isEditing) return false;
  if (prev.isDeleting !== next.isDeleting) return false;
  if (prev.renamePending !== next.renamePending) return false;
  if (prev.deletePending !== next.deletePending) return false;
  if (prev.isLastInGroup !== next.isLastInGroup) return false;
  if (prev.isGroupCollapsed !== next.isGroupCollapsed) return false;
  if (prev.switchPending !== next.switchPending) return false;
  if (prev.justSwitched !== next.justSwitched) return false;
  // testRunning toggles the inline Test connection button's disabled
  // state — without this compare the spinner state goes stale and a
  // second click during a long probe looks like nothing happened.
  if (prev.testRunning !== next.testRunning) return false;
  // editDraft only matters when this row is the one being edited.
  if (next.isEditing && prev.editDraft !== next.editDraft) return false;
  return true;
});

// ── Card footer ──────────────────────────────────────────────────────────

function CardFooter({
  pageKeyCount,
  filteredCount,
  totalCount,
  currentPage,
  totalPages,
  groupsPerPage,
  onPrev,
  onNext,
}: {
  /** Keys rendered on the current page (after group-based slicing). */
  pageKeyCount: number;
  /** Keys matching the current search/filter, across all pages. */
  filteredCount: number;
  /** Keys stored in the vault in total (pre-filter). */
  totalCount: number;
  currentPage: number;
  totalPages: number;
  groupsPerPage: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const prevDisabled = currentPage <= 1;
  const nextDisabled = currentPage >= totalPages;
  // Count copy is context-aware:
  // - multi-page: "Showing N on this page · M filtered · Y total"
  // - single-page, filtered: "Showing N of Y keys" (same as pre-pagination)
  // - single-page, unfiltered: "Showing N of Y keys" (same as pre-pagination)
  // The two-level counter avoids lying when pagination hides keys.
  return (
    <div
      className="px-5 py-2.5 flex items-center justify-between text-[12px] font-mono gap-4 flex-wrap"
      style={{
        borderTop: '1px solid var(--border)',
        color: 'var(--muted-foreground)',
        /* Same dark overlay as the top CardHeader — mirrored "top/
           bottom lid" so the tbody reads as the lighter content band
           between. Was var(--surface-1) which looked like an odd
           dark strip; the overlay matches master's rhythm. */
        background: 'rgba(0,0,0,0.2)',
      }}
    >
      <span>
        {totalPages > 1 ? (
          <>
            {t('vault.footerShowing')}<span style={{ color: 'var(--foreground)' }}>{pageKeyCount}</span>{t('vault.footerShowingOnPage')}
            <span style={{ color: 'var(--foreground)' }}>{filteredCount}</span>{t('vault.footerFiltered')}
            <span style={{ color: 'var(--foreground)' }}>{totalCount}</span>{t('vault.footerTotal')}
          </>
        ) : (
          <>
            {t('vault.footerShowing')}<span style={{ color: 'var(--foreground)' }}>{filteredCount}</span>{t('vault.footerOf')}
            <span style={{ color: 'var(--foreground)' }}>{totalCount}</span>{t('vault.footerKeys')}
          </>
        )}
      </span>
      {/* Real pagination (2026-04-24): slicing happens by PROTOCOL GROUP,
          not by row — so a group header never appears twice or gets its
          children split across pages. groupsPerPage=3 in the default
          configuration; tune via the constant at the top of VaultPage. */}
      <div className="flex items-center gap-2">
        <button
          className="btn btn-ghost text-[10px] px-2 py-1"
          onClick={onPrev}
          disabled={prevDisabled}
          title={prevDisabled ? t('vault.firstPageTitle') : t('vault.prevPageTitle')}
          aria-label={t('vault.prevPageTitle')}
        >
          <ChevronLeftIcon className="w-3 h-3" />
          {t('vault.prev')}
        </button>
        <span title={`${groupsPerPage} provider group${groupsPerPage === 1 ? '' : 's'} per page`}>
          {t('vault.pageLabel')}<span style={{ color: 'var(--foreground)' }}>{currentPage}</span> /{' '}
          <span style={{ color: 'var(--foreground)' }}>{totalPages}</span>
        </span>
        <button
          className="btn btn-ghost text-[10px] px-2 py-1"
          onClick={onNext}
          disabled={nextDisabled}
          title={nextDisabled ? t('vault.noMorePagesTitle') : t('vault.nextPageTitle')}
          aria-label={t('vault.nextPageTitle')}
        >
          {t('vault.next')}
          <ChevronRightIcon className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ── Page footer ──────────────────────────────────────────────────────────

function PageFooter() {
  const { t } = useTranslation();
  return (
    <section
      className="flex flex-col gap-2 text-[12px] font-mono pt-1 pb-6"
      style={{ color: 'var(--muted-foreground)' }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <a href="/user/cli-guide" className="hover:text-[color:var(--foreground)] flex items-center gap-1.5">
            <BookOpenIcon className="w-3 h-3" />
            {t('vault.footerDocs')}
          </a>
          <a href="#" className="hover:text-[color:var(--foreground)] flex items-center gap-1.5">
            <LifeBuoyIcon className="w-3 h-3" />
            {t('vault.footerSupport')}
          </a>
          <a href="#" className="hover:text-[color:var(--foreground)] flex items-center gap-1.5">
            <ShieldCheckIcon className="w-3 h-3" />
            {t('vault.footerSecurity')}
          </a>
        </div>
        <span>{t('vault.controlVault')}</span>
      </div>
      {/*
        Why a footer encryption disclosure on the vault page (2026-04-22):
        Users land here after typing their master password and reasonably ask
        "is this thing actually secure?". Naming the primitives in plain text
        makes the security model auditable at a glance — Argon2id for the
        password-to-key derivation, AES-256-GCM for at-rest authenticated
        encryption of every vault entry. "Never leaves this device" is the
        privacy claim: master password material never crosses the network
        and is never written to disk in any reversible form (the only
        long-lived artefact is the public Argon2 hash).

        Tone (2026-04-27): replaced the param-explicit form
        "Argon2id (m=64 MiB, t=3, p=4)" with "Defense-in-depth" framing.
        The numeric params are accurate but they read as documentation,
        not assurance. Industry terms ("authenticated encryption",
        "key derivation", "defense-in-depth") signal authority while
        staying technically faithful — exact params are still discoverable
        in VAULT_SPEC.md and the storage module for security reviewers.
      */}
      <div className="flex items-center gap-1.5 text-[11px] opacity-80">
        <LockIcon className="w-3 h-3" />
        <span>
          {t('vault.defenseInDepthVault')}{' '}
          <span style={{ color: 'var(--foreground)' }}>AES-256-GCM</span>{t('vault.authenticatedEncryption')}
          <span style={{ color: 'var(--foreground)' }}>Argon2id</span>{t('vault.keyDerivationTail')}
        </span>
      </div>
    </section>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-16">
      <span className="text-sm font-mono" style={{ color: 'var(--muted-foreground)' }}>
        {message}
      </span>
    </div>
  );
}

// Full-pane empty panel — rendered when the vault holds zero records.
// Visual parity with /user/virtual-keys' tk-empty card (key-in-ring +
// title + description + Import link) so the two "no keys" states read
// as a family. Description is vault-specific: only points at the Import
// page (no "ask admin" alternative, since the vault is the user's own
// local store).
function VaultEmptyPanel() {
  const { t } = useTranslation();
  return (
    <div className="flex p-7">
      <div className="vault-empty">
        <div className="vault-empty-ring">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.6}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
          </svg>
        </div>
        <div className="vault-empty-title">{t('vault.emptyTitle')}</div>
        <p className="vault-empty-desc">
          {t('vault.emptyDescPrefix')}{' '}
          <Link to="/user/import" className="vault-empty-link">{t('vault.import')}</Link>
        </p>
      </div>
    </div>
  );
}

// ── Detail drawer ────────────────────────────────────────────────────────

function DetailDrawer(props: {
  /** Phase 3B (2026-05-11): widened to VaultRowRecord to accept team rows.
   *  Personal/OAuth code paths are unchanged; team rows render a
   *  Virtual-Key section instead of Credential and skip the Delete button. */
  record: VaultRowRecord;
  locked: boolean;
  onClose: () => void;
  onBeginRename: () => void;
  onDelete: () => void;
  /** Use button (Phase 3B): wired to switchTo so the drawer's primary
   *  action is "route via this key" — same single-source-of-truth as the
   *  inline row Use button. */
  onUse: () => void;
  // (Test connection moved to the row Actions column 2026-05-22 — no
  // onTest prop on the drawer anymore.)
  /** True when this record is the active binding for its protocol family.
   *  Drawer hides the Use button + shows an "IN USE" chip when true. */
  inUse: boolean;
  switchPending?: boolean;
  /** v4.3 (2026-05-01): host → ProviderRoute map for resolving the EFFECTIVE
   *  upstream URL the proxy will route to (matches pkg/providerroutes.Stitch
   *  semantics). Empty map while rules query is loading — drawer falls back
   *  to stored / official_base_url. */
  hostToRoute: Map<string, ProviderRoute>;
  /** v4.3: provider_code → first-matching ProviderRoute, used as the family-
   *  level fallback when the stored base_url's host isn't in the table. */
  providerToRoute: Map<string, ProviderRoute>;
}) {
  const { t } = useTranslation();
  const r = props.record;
  const hostToRoute = props.hostToRoute;
  const providerToRoute = props.providerToRoute;
  // `copiedField` drives the check-icon flash on any drawer copy button
  // (base_url, route token, CLI reveal command). A single slot is enough
  // because the buttons are mutually exclusive — clicking a second one
  // immediately reassigns the flash to the new field. Cleared after ~1.2s
  // via setTimeout.
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') props.onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props]);

  // Reveal-via-HTTP (setRevealed / doReveal / 60s auto-mask) removed
  // 2026-04-24 (security review round 2): plaintext never crosses the
  // browser boundary. The Secret row below shows only masked prefix/suffix
  // from the unlocked list response; the CLI command box provides the
  // one-path-to-plaintext route.

  function copy(text: string) {
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    else fallbackCopy(text);
  }

  // Copy + 1.2s check-icon flash for drawer field copy buttons. The
  // `fieldKey` identifies which button should light up (base_url vs
  // route_token vs …) so simultaneous buttons don't cross-flash.
  function copyField(fieldKey: string, text: string) {
    copy(text);
    setCopiedField(fieldKey);
    window.setTimeout(
      () => setCopiedField((k) => (k === fieldKey ? null : k)),
      1200,
    );
  }

  const alias = r.alias ?? (r.target === 'oauth' ? t('vault.unnamedOAuthAccount') : t('vault.unnamed'));
  const aliasMono = isMonoAlias(r.alias);
  const lockedTitle = props.locked ? t('vault.unlockToUseAction') : undefined;
  const isPersonal = r.target === 'personal';
  const isTeam = r.target === 'team';
  const isOAuth = r.target === 'oauth';
  const personal = isPersonal ? (r as PersonalVaultRecord) : null;
  // OAuth narrowing tightened (Phase 3B 2026-05-11): was previously
  // `!isPersonal` which incorrectly captured team rows too. Team rows
  // have neither org_uuid nor account_tier nor token_expires_at — the
  // OAuth-conditional META rows below would crash on `r.org_uuid`
  // accesses if we left the cast wide. New narrowing keeps OAuth-only
  // fields walled off behind isOAuth.
  const oauth = isOAuth ? (r as OAuthVaultRecord) : null;
  const team = isTeam ? (r as TeamRowRecord) : null;
  const providerName = providerDisplayName(r);

  return (
    <>
      <div className="drawer-overlay" data-open="true" onClick={props.onClose} />
      <aside className="drawer" data-open="true" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div className="content">
            <div className={`alias-title${aliasMono ? ' mono' : ''}`}>{alias}</div>
            <div className="meta-row">
              <span className="provider-cell">
                <span
                  className="prov-dot"
                  style={{ background: providerBrandColor(providerName) }}
                />
                <span
                  className="name font-mono"
                  style={{ color: 'var(--muted-foreground)' }}
                >
                  {providerName}
                </span>
                <span className={`kind-pill${isTeam ? ' team' : isOAuth ? ' oauth' : ''}`}>
                  {isTeam ? 'TEAM' : isOAuth ? 'OAUTH' : 'KEY'}
                </span>
              </span>
              {r.status === 'active' ? (
                <span className="chip success">
                  <span className="status-dot" style={{ width: 5, height: 5 }} />
                  {t('vault.statusActive')}
                </span>
              ) : (
                <span className="chip danger">
                  <span className="status-dot error" style={{ width: 5, height: 5 }} />
                  {String(r.status).toUpperCase()}
                </span>
              )}
            </div>
          </div>
          <button
            className="drawer-close"
            onClick={props.onClose}
            title={t('vault.closeEsc')}
            aria-label={t('vault.closeDrawerAria')}
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="drawer-body">
          {/* Phase 3B (2026-05-11) — Virtual Key section: team-row analog
              of the Credential section. The wire shape from B's
              UserKeyDTO carries no ciphertext / base_url / route_url
              (decision 2: credential material stays in vault), so this
              section deliberately surfaces only the routing identifier
              + protocol context. The personal Credential block below
              short-circuits via `{isPersonal && personal && (…)}` for
              team rows, so we don't fight it — we render this above
              and let Credential go empty for team. */}
          {isTeam && team && (
            <div className="drawer-section">
              <div className="drawer-section-title">
                <KeyRoundIcon className="w-3 h-3" />
                {t('vault.virtualKey')}
              </div>
              <div className="drawer-field">
                <span className="k">{t('vault.drawerAlias')}</span>
                <span className="v">
                  <span className={isMonoAlias(team.alias) ? 'mono' : ''}>{team.alias}</span>
                  <button
                    type="button"
                    className="copy-btn"
                    title={`Copy ${team.alias}`}
                    aria-label={t('vault.copyAliasAria')}
                    onClick={() => copyField('alias', team.alias)}
                  >
                    {copiedField === 'alias' ? (
                      <CheckIcon className="w-3 h-3" />
                    ) : (
                      <ClipboardIcon className="w-3 h-3" />
                    )}
                  </button>
                </span>
              </div>
              <div className="drawer-field">
                <span className="k">{t('vault.virtualKeyId')}</span>
                <span className="v mono">
                  {/* Short + full-on-hover; copy button mirrors the
                      Personal "Route token" row pattern so the two
                      stable routing identifiers feel symmetric. */}
                  <span title={team.virtual_key_id}>
                    {shortRouteToken(team.virtual_key_id) ?? team.virtual_key_id}
                  </span>
                  <button
                    type="button"
                    className="copy-btn"
                    title={`Copy ${team.virtual_key_id}`}
                    onClick={() => copyField('vk_id', team.virtual_key_id)}
                  >
                    {copiedField === 'vk_id' ? (
                      <CheckIcon className="w-3 h-3" />
                    ) : (
                      <ClipboardIcon className="w-3 h-3" />
                    )}
                  </button>
                </span>
              </div>
              {team.supported_providers.length > 0 && (
                <div className="drawer-field">
                  <span className="k">{t('vault.supports')}</span>
                  <span className="v">
                    {team.supported_providers.map((p) => (
                      <span key={p} className="kind-pill" style={{ marginRight: 4 }}>
                        {p}
                      </span>
                    ))}
                  </span>
                </div>
              )}
              <div className="drawer-field">
                <span className="k">{t('vault.share')}</span>
                <span className="v">
                  <span className={`chip ${team.share_status === 'claimed' ? 'success' : team.share_status === 'revoked' ? 'danger' : 'warning'}`}>
                    {teamShareLabel(team.share_status, t)}
                  </span>
                </span>
              </div>
              {/* route_url + Route token (2026-05-11): same pair shown in
                  the Personal/OAuth drawer above. Sourced inline from
                  CLI's `_internal query` team records (Phase 3B revised),
                  so SDK base URL and the team bearer (`aikey_team_<vk_id>`)
                  surface here without crossing the team-server origin.
                  Hidden on older CLI bundles that don't emit the fields.
                  Route token is masked on locked-vault responses, matching
                  the Personal lock-aware pattern. */}
              {team.route_url && (
                <div className="drawer-field">
                  <span className="k">route_url</span>
                  <span className="v stack">
                    <span className="mono">{team.route_url}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span className="hint">{t('vault.sdkBaseUrlHint')}</span>
                      <button
                        type="button"
                        className="inline-copy"
                        title={t('vault.copyRouteUrlTitle')}
                        aria-label={t('vault.copyRouteUrlTitle')}
                        onClick={() => copyField('route_url', team.route_url!)}
                      >
                        {copiedField === 'route_url' ? (
                          <CheckIcon className="w-3.5 h-3.5" />
                        ) : (
                          <ClipboardIcon className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </span>
                  </span>
                </div>
              )}
              <div className="drawer-field">
                <span className="k">{t('vault.routeTokenAria')}</span>
                <span className="v stack">
                  {team.route_token ? (
                    <div className="drawer-tokenbox" tabIndex={0} aria-label={t('vault.routeTokenAria')}>
                      {team.route_token}
                      <button
                        type="button"
                        className="copy-btn"
                        title={t('vault.copyRouteTokenTitle')}
                        aria-label={t('vault.copyRouteTokenTitle')}
                        onClick={() => copyField('route_token', team.route_token!)}
                      >
                        {copiedField === 'route_token' ? (
                          <CheckIcon className="w-3.5 h-3.5" />
                        ) : (
                          <ClipboardIcon className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  ) : (
                    <div
                      className="drawer-tokenbox drawer-tokenbox-locked"
                      aria-label={t('vault.routeTokenLockedAria')}
                      style={{ color: 'var(--muted-foreground)' }}
                    >
                      <span style={{ letterSpacing: '0.15em' }}>
                        {'•'.repeat(40)}
                      </span>
                      <span
                        className="drawer-tokenbox-hint"
                        style={{
                          display: 'block',
                          marginTop: 6,
                          fontSize: '11px',
                          fontStyle: 'italic',
                          opacity: 0.75,
                        }}
                      >
                        {t('vault.unlockToRevealToken')}
                      </span>
                    </div>
                  )}
                </span>
              </div>
              <div className="drawer-field">
                <span className="k">{t('vault.source')}</span>
                <span className="v" style={{ color: 'var(--muted-foreground)', fontSize: 11 }}>
                  {t('vault.teamSourceDesc')}
                </span>
              </div>
            </div>
          )}
          {/* N6 seat_group (Stage A): pool candidate accounts behind this group
              VK — identity / provider / priority + the master-assigned default.
              "Default" is master's STATIC rank-0 pick; the proxy's live selection
              (which may fall back when an account is cooled) is Stage B. */}
          {isTeam && team && team.seat_group_id && (
            <div className="drawer-section">
              <div className="drawer-section-title">
                <KeyRoundIcon className="w-3 h-3" />
                {t('vault.seatGroupGroupAccounts')}
              </div>
              {(team.group_accounts ?? []).length === 0 ? (
                <div className="drawer-field">
                  <span className="v" style={{ color: 'var(--muted-foreground)', fontSize: 11 }}>
                    {t('vault.seatGroupNoAccounts')}
                  </span>
                </div>
              ) : (
                (team.group_accounts ?? [])
                  .slice()
                  .sort((a, b) => a.priority - b.priority)
                  .map((a) => (
                    <div className="drawer-field" key={a.account_id}>
                      <span className="k">
                        {a.identity}
                        {a.assigned && (
                          <span className="chip success" style={{ marginLeft: 6 }}>
                            {t('vault.seatGroupDefault')}
                          </span>
                        )}
                      </span>
                      <span className="v" style={{ color: 'var(--muted-foreground)', fontSize: 11 }}>
                        {a.provider_code} · {t('vault.seatGroupPriority', { priority: a.priority })}
                      </span>
                    </div>
                  ))
              )}
              <div className="drawer-field">
                <span
                  className="v"
                  style={{ color: 'var(--muted-foreground)', fontSize: 11, fontStyle: 'italic' }}
                >
                  {t('vault.seatGroupDefaultHint')}
                </span>
              </div>
            </div>
          )}
          {/* Credential — Personal/OAuth only. The whole section short-
              circuits inside via {isPersonal && personal && (…)} and
              {!isPersonal && oauth && (…)} blocks; for team rows the
              outer card was rendering as an empty shell, which read as
              "Credential is broken" on the page. Skip the entire wrapper
              for team rows so the layout is honest about what data we have. */}
          {!isTeam && (
          <div className="drawer-section">
            <div className="drawer-section-title">
              <KeyRoundIcon className="w-3 h-3" />
              {t('vault.credential')}
            </div>
            <div className="drawer-field">
              <span className="k">{t('vault.drawerAlias')}</span>
              <span className="v">
                {/* OAuth: render the email icon on the alias row only when
                    alias and display_identity coincide (the user hasn't
                    renamed). After v1.0.1-alpha.1 this is signalled by
                    `local_alias === null`; renamed accounts move the icon
                    to the Identity row below so the alias-as-label reads
                    cleanly without the misleading email visual. */}
                {oauth
                  && oauth.display_identity
                  && oauth.local_alias == null
                  && oauth.alias === oauth.display_identity && (
                  <MailIcon className="w-3 h-3" />
                )}
                {alias}
                <button
                  type="button"
                  className="copy-btn"
                  title={`Copy ${alias}`}
                  aria-label={t('vault.copyAliasAria')}
                  onClick={() => copyField('alias', alias)}
                >
                  {copiedField === 'alias' ? (
                    <CheckIcon className="w-3 h-3" />
                  ) : (
                    <ClipboardIcon className="w-3 h-3" />
                  )}
                </button>
                <span className="ro-pill">{t('vault.editablePill')}</span>
              </span>
            </div>
            {isPersonal && personal && (
              <>
                {/* Provider + Type removed from Credential 2026-04-24 —
                    the drawer header meta-row already shows the provider
                    chip + KEY/OAUTH kind pill + status chip. Duplicating
                    the same facts a row below just pushed the actionable
                    Credential fields (Secret / base_url / route_url /
                    Route token) further down. Moved to Meta so detail-
                    hunters can still find them without cluttering the
                    hero area.

                    (The wrapping `{isPersonal && personal && (<>...</>)}`
                    stays — Secret / base_url / route_url etc. below
                    still depend on `personal` being non-null.) */}
                {/* base_url shown BEFORE Secret (2026-05-06): users typically
                    glance at the upstream URL first to confirm which provider
                    endpoint a key targets, then deal with the secret. */}
                {(() => {
                  // v4.4 (2026-06-03): show the EFFECTIVE upstream URL the
                  // proxy will actually route to. Matches aikey-proxy's
                  // pkg/providerroutes.Stitch byte-for-byte for the two
                  // load-bearing cases — see bugfix
                  // "20260603-drawer-base-url-source-of-truth-split.md".
                  //
                  // History (2026-05-01 v4.3 → 2026-06-03 v4.4): the prior
                  // version had a third fallback that looked up
                  // providerToRoute.get(provider_code) and showed the
                  // provider's official endpoint when the user-stored host
                  // wasn't in the routes table. This silently lied — Stitch
                  // does NOT do that swap. A user who pasted the wrong URL
                  // (e.g. "https://platform.claude.com/settings/keys" into
                  // an anthropic entry) saw "https://api.anthropic.com/v1"
                  // here while the proxy actually forwarded to
                  // platform.claude.com and 404'd. Removed the fallback so
                  // the drawer surfaces the real destination.
                  //
                  // Resolution order (mirrors Stitch §resolveStitchComponents):
                  //   1. user-supplied base_url host hits hostToRoute →
                  //      table-canonical base_url + version (table replaces
                  //      vault path; Stitch does the same — discards user
                  //      path, uses table base_url path)
                  //   2. host miss → keep vault's scheme/host/path verbatim,
                  //      no version re-attach (Stitch "fail open with a
                  //      best-effort path stitch", stitch.go §88-93)
                  //   3. stored is null but official_base_url known → show
                  //      official as last-resort (rare; entries created via
                  //      provider templates with no user URL ever set)
                  //   4. nothing usable → "unknown provider" placeholder
                  const stored = personal.base_url ?? null;
                  let effectiveUrl: string | null = null;
                  let source: 'table-host' | 'stored' | 'official' | 'unknown' = 'unknown';

                  if (stored) {
                    try {
                      const u = new URL(stored);
                      const host = u.hostname.toLowerCase();
                      const route = hostToRoute.get(host);
                      if (route) {
                        // Host in table: use table-canonical base_url +
                        // version. Stitch discards vault path entirely in
                        // this branch (stitch.go §79-86).
                        effectiveUrl = route.version
                          ? `${route.base_url}${route.version}`
                          : route.base_url;
                        source = 'table-host';
                      } else {
                        // Host miss: keep vault scheme/host + trimmed path.
                        // This mirrors Stitch §88-93 — proxy forwards to
                        // this same host (does NOT swap to provider default).
                        // Showing provider_code default here would be a lie:
                        // legitimate BYOK proxies route on custom hosts and
                        // expect to remain untouched.
                        const cleanPath = u.pathname.replace(/\/$/, '');
                        effectiveUrl = `${u.protocol}//${u.host}${cleanPath}`;
                        source = 'stored';
                      }
                    } catch {
                      // Malformed URL — fall through to raw-stored display
                      // so the user sees their broken input verbatim.
                    }
                  }
                  if (!effectiveUrl && stored) {
                    effectiveUrl = stored;
                    source = 'stored';
                  }
                  if (!effectiveUrl && personal.official_base_url) {
                    effectiveUrl = personal.official_base_url;
                    source = 'official';
                  }

                  if (!effectiveUrl) {
                    return (
                      <div className="drawer-field">
                        <span className="k">base_url</span>
                        <span className="v">
                          <span className="mono dim">{t('vault.unknownProvider')}</span>
                        </span>
                      </div>
                    );
                  }

                  // Hint = where the value came from. 2026-06-03: dropped
                  // 'table-provider' (was the lie surface — see comment
                  // block above). 'hintEffectiveProviderDefault' i18n key
                  // kept in locale files (unused at this call site) until a
                  // sweep removes it; safer than removing now and breaking
                  // some other future reader.
                  const hintLabel: Record<typeof source, string> = {
                    'table-host': t('vault.hintEffectiveHostMatch'),
                    'stored':     t('vault.hintStoredAsIs'),
                    'official':   t('vault.hintProviderDefaultLegacy'),
                    'unknown':    '',
                  };

                  return (
                    <div className="drawer-field">
                      <span className="k">base_url</span>
                      <span className="v stack">
                        <span className="mono">{effectiveUrl}</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span className="hint">{hintLabel[source]}</span>
                          <button
                            type="button"
                            className="inline-copy"
                            title={t('vault.copyEffectiveUpstreamUrlTitle')}
                            aria-label={t('vault.copyEffectiveUpstreamUrlTitle')}
                            onClick={() => copyField('base_url', effectiveUrl!)}
                          >
                            {copiedField === 'base_url' ? (
                              <CheckIcon className="w-3.5 h-3.5" />
                            ) : (
                              <ClipboardIcon className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </span>
                      </span>
                    </div>
                  );
                })()}
                {/* Secret + reveal command merged into a single row
                    (2026-05-06 cleanup). Top: masked preview (the only
                    plaintext-adjacent thing the browser ever sees — full
                    plaintext never crosses the HTTP surface, 2026-04-24
                    security review round 2). Middle: the `aikey get`
                    reveal command in the same lightweight mono+inline-copy
                    style as base_url / route_url — no boxed text-area,
                    keeps short single-line commands visually quiet.
                    Bottom: terse hint. */}
                {(() => {
                  const cliCmd = `aikey get ${r.alias}`;
                  const copied = copiedField === 'cli_get';
                  return (
                    <div className="drawer-field">
                      <span className="k">{t('vault.apiKey')}</span>
                      <span className="v stack" style={{ width: '100%' }}>
                        <div className="secret-view masked" style={{ width: '100%' }}>
                          <div className="plain">
                            {personal.secret_prefix === null ? (
                              // Locked / too-short: a short bar of dots — the
                              // suffix span is absent in this branch, so we
                              // don't need to leave room for it on the right.
                              <span className="mid">{'•'.repeat(12)}</span>
                            ) : (
                              <>
                                <span className="prefix">{personal.secret_prefix}</span>
                                <span className="mid">
                                  {/*
                                    2026-05-09: fixed 8-dot bar instead of
                                    `Math.min(24, len-16)`. The dots are
                                    purely "there's hidden stuff here" filler
                                    — the actual hidden length is irrelevant
                                    to the user, and the previous up-to-24
                                    cap pushed the suffix off-screen on the
                                    drawer's narrow column for keys ≥ 32 chars.
                                    8 keeps prefix(12) + mid(8) + suffix(4) =
                                    24 chars visible, fitting any drawer width
                                    while still communicating "key is masked
                                    here".
                                  */}
                                  {'•'.repeat(8)}
                                </span>
                                <span className="suffix">{personal.secret_suffix}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span className="mono">{cliCmd}</span>
                          <button
                            type="button"
                            className="inline-copy"
                            title={t('vault.copyRevealCommandTitle')}
                            aria-label={t('vault.copyRevealCommandAria')}
                            onClick={() => copyField('cli_get', cliCmd)}
                          >
                            {copied ? (
                              <CheckIcon className="w-3.5 h-3.5" />
                            ) : (
                              <ClipboardIcon className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </span>
                        <span className="hint">{t('vault.revealInTerminal')}</span>
                      </span>
                    </div>
                  );
                })()}
                {/* route_url — the aikey-proxy URL clients should actually
                    point at. Mirrors `aikey route` output so users can
                    copy the same value from the drawer without switching
                    to the terminal. Surfaced by CLI
                    `_internal query list_*` as `route_url`; undefined on
                    older CLI builds (graceful fallback: skip the row). */}
                {personal.route_url && (
                  <div className="drawer-field">
                    <span className="k">route_url</span>
                    {/* Same compact layout as base_url (2026-04-24):
                        URL alone on line 1, hint + copy icon together
                        on line 2. Keeps the two URL rows visually
                        consistent. */}
                    <span className="v stack">
                      <span className="mono">{personal.route_url}</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span className="hint">{t('vault.sdkBaseUrlHint')}</span>
                        <button
                          type="button"
                          className="inline-copy"
                          title={t('vault.copyRouteUrlTitle')}
                          aria-label={t('vault.copyRouteUrlTitle')}
                          onClick={() => copyField('route_url', personal.route_url!)}
                        >
                          {copiedField === 'route_url' ? (
                            <CheckIcon className="w-3.5 h-3.5" />
                          ) : (
                            <ClipboardIcon className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </span>
                    </span>
                  </div>
                )}
                {/*
                  Route token row — always rendered so the drawer's
                  field layout stays stable across lock state. When
                  locked, show a masked placeholder + a hint pointing
                  at unlock; never expose the real token until the
                  vault session is alive (token is null in the locked
                  list response).
                  2026-05-09: previously the row was hidden when locked
                  (`personal.route_token &&` gate). Users couldn't tell
                  whether the field even existed for that key.
                  .drawer-tokenbox — a <div> (not <textarea>) per the
                  template. word-break: break-all wraps the full token
                  naturally, corner-anchored .copy-btn sits inside the
                  box's reserved bottom-right padding (unlocked branch
                  only).
                */}
                <div className="drawer-field">
                  <span className="k">{t('vault.routeTokenAria')}</span>
                  <span className="v stack">
                    {personal.route_token ? (
                      <div className="drawer-tokenbox" tabIndex={0} aria-label={t('vault.routeTokenAria')}>
                        {personal.route_token}
                        <button
                          type="button"
                          className="copy-btn"
                          title={t('vault.copyRouteTokenTitle')}
                          aria-label={t('vault.copyRouteTokenTitle')}
                          onClick={() => copyField('route_token', personal.route_token!)}
                        >
                          {copiedField === 'route_token' ? (
                            <CheckIcon className="w-3.5 h-3.5" />
                          ) : (
                            <ClipboardIcon className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    ) : (
                      <div
                        className="drawer-tokenbox drawer-tokenbox-locked"
                        aria-label={t('vault.routeTokenLockedAria')}
                        style={{ color: 'var(--muted-foreground)' }}
                      >
                        <span style={{ letterSpacing: '0.15em' }}>
                          {'•'.repeat(40)}
                        </span>
                        <span
                          className="drawer-tokenbox-hint"
                          style={{
                            display: 'block',
                            marginTop: 6,
                            fontSize: '11px',
                            fontStyle: 'italic',
                            opacity: 0.75,
                          }}
                        >
                          {t('vault.unlockToRevealToken')}
                        </span>
                      </div>
                    )}
                  </span>
                </div>
              </>
            )}
            {!isPersonal && oauth && (
              <>
                {/* Provider + Type moved to Meta section (2026-04-24) —
                    see the sibling personal-branch comment for
                    rationale. Header meta-row already carries both. */}
                {/* Identity row appears when the user has renamed the
                    account (local_alias is set) — that's when alias and
                    underlying identity diverge and showing both carries
                    real information. v1.0.1-alpha.1 made the rename path
                    write `local_alias` instead of overwriting
                    `display_identity`, so this condition is the
                    structural signal: pre-split vaults always have
                    local_alias === null and the row stays merged. */}
                {(() => {
                  const identity = oauth.display_identity ?? oauth.external_id;
                  if (!identity) return null;
                  const renamed = oauth.local_alias != null;
                  if (!renamed) return null;
                  return (
                    <div className="drawer-field">
                      <span className="k">{t('vault.identity')}</span>
                      <span className="v">
                        <MailIcon className="w-3 h-3" />
                        {identity}
                      </span>
                    </div>
                  );
                })()}
                {/* Session row removed 2026-04-24 — it was a pure
                    placeholder ("Token never shown in browser") and
                    carried no actionable info for the user; any future
                    session-state detail (expiry, rotation) belongs in
                    the Meta section below next to Expires. */}
                {/* Org UUID + Tier moved to Meta (2026-05-06) — they
                    describe the upstream account ("which organization /
                    plan tier") rather than the credential itself, so
                    they belong with Protocol / Type / Status. Keeps the
                    Credential section focused on what the user can copy
                    or route through (alias / identity / route_url /
                    route_token). */}
                {/* route_url + route_token (2026-05-06): same pair shown for
                    personal keys above. The CLI computes both via
                    `provider_info(code).proxy_path` + the per-account token
                    the proxy registers, so values match `aikey route` 1:1.
                    Both rows hidden when their field is missing (older CLI
                    bundles or pre-route-token vaults). */}
                {oauth.route_url && (
                  <div className="drawer-field">
                    <span className="k">route_url</span>
                    <span className="v stack">
                      <span className="mono">{oauth.route_url}</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span className="hint">{t('vault.sdkBaseUrlHint')}</span>
                        <button
                          type="button"
                          className="inline-copy"
                          title={t('vault.copyRouteUrlTitle')}
                          aria-label={t('vault.copyRouteUrlTitle')}
                          onClick={() => copyField('route_url', oauth.route_url!)}
                        >
                          {copiedField === 'route_url' ? (
                            <CheckIcon className="w-3.5 h-3.5" />
                          ) : (
                            <ClipboardIcon className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </span>
                    </span>
                  </div>
                )}
                {/*
                  Route token row — always rendered; same lock-aware
                  pattern as the personal branch above. OAuth route
                  tokens come from a different storage table
                  (provider_account_route_tokens), but the UX surface
                  is identical: locked → masked dots + hint, unlocked →
                  real token + copy button. 2026-05-09.
                */}
                <div className="drawer-field">
                  <span className="k">{t('vault.routeTokenAria')}</span>
                  <span className="v stack">
                    {oauth.route_token ? (
                      <div className="drawer-tokenbox" tabIndex={0} aria-label={t('vault.routeTokenAria')}>
                        {oauth.route_token}
                        <button
                          type="button"
                          className="copy-btn"
                          title={t('vault.copyRouteTokenTitle')}
                          aria-label={t('vault.copyRouteTokenTitle')}
                          onClick={() => copyField('route_token', oauth.route_token!)}
                        >
                          {copiedField === 'route_token' ? (
                            <CheckIcon className="w-3.5 h-3.5" />
                          ) : (
                            <ClipboardIcon className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    ) : (
                      <div
                        className="drawer-tokenbox drawer-tokenbox-locked"
                        aria-label={t('vault.routeTokenLockedAria')}
                        style={{ color: 'var(--muted-foreground)' }}
                      >
                        <span style={{ letterSpacing: '0.15em' }}>
                          {'•'.repeat(40)}
                        </span>
                        <span
                          className="drawer-tokenbox-hint"
                          style={{
                            display: 'block',
                            marginTop: 6,
                            fontSize: '11px',
                            fontStyle: 'italic',
                            opacity: 0.75,
                          }}
                        >
                          {t('vault.unlockToRevealToken')}
                        </span>
                      </div>
                    )}
                  </span>
                </div>
              </>
            )}
          </div>
          )}
          {/* Actions — .drawer-actions layout per user_vault_3_1_1.html:
              full-width primary CTA (Route) up top, three secondary
              actions below. Logic is unchanged from the prior block —
              only the visual chrome switched to .action-btn. The new
              "Route via this key" button copies the CLI command
              `aikey activate <alias>` to the clipboard instead of
              triggering a server-side routing switch (safer default:
              user explicitly runs the command when/where they want;
              works even when vault is locked). */}
          <div className="drawer-section">
            <div className="drawer-section-title">
              <WrenchIcon className="w-3 h-3" />
              {t('vault.actions')}
            </div>
            <div className="drawer-actions">
              {/* Phase 3B R12 (2026-05-11): unified primary CTA — all
                  targets (Personal / OAuth / Team) use the same
                  Activate-in-terminal copy-CLI pattern for visual +
                  conceptual consistency. Team rows use the alias
                  (CLI's `aikey activate` resolver accepts alias /
                  vk_id / local_alias for team keys, identical
                  resolution chain to `aikey use`). The inline row
                  Use button still calls vaultApi.use directly for
                  one-click convenience; the drawer button is the
                  copy-CLI variant for muscle memory + scriptability.
                  Spec: requirements/2026-05-11-aikey-web-local-first
                  -team-merge.md R12. */}
              {r.alias && (
                <button
                  type="button"
                  className={`action-btn primary-route${props.inUse ? ' routing' : ''}`}
                  title={
                    props.inUse
                      ? `This key is active in your global shell — command: aikey activate ${r.alias}`
                      : `Copy CLI command: aikey activate ${r.alias}`
                  }
                  onClick={() => copyField('route_cmd', `aikey activate ${r.alias}`)}
                >
                  {copiedField === 'route_cmd' ? (
                    <>
                      <CheckIcon className="w-3.5 h-3.5" />
                      {t('vault.commandCopied')}
                    </>
                  ) : (
                    <>
                      <ZapIcon className="w-3.5 h-3.5" />
                      {props.inUse ? t('vault.activeInTerminal') : t('vault.activateInTerminal')}
                    </>
                  )}
                </button>
              )}
              {/* Usage hint for the primary Route CTA — clarifies that
                  the button *copies* a shell command rather than triggering
                  a server-side switch. Sits between the full-width Route
                  button (above) and the three secondary actions (below)
                  so the explanation reads adjacent to the action it
                  describes. Copy style switches post-click:
                    - default: shows the 2-step instruction
                    - after click: shows the exact command the user just
                      copied, so they can verify before pasting */}
              {r.alias && (() => {
                // In-use keys collapse to a single hint pointing the user
                // straight at the provider CLI ("Run `claude` directly in
                // any terminal") — the Activate command and "to re-apply"
                // were redundant when the key is already active in shell
                // (2026-05-06 user request). Not-in-use keys keep the
                // single Activate-command hint as the primary action.
                // Phase 3B R12 (2026-05-11): team rows now also render
                // this hint since the primary CTA above is the unified
                // copy-CLI button. `aikey activate <team-alias>` works
                // identically to personal/oauth aliases via CLI's
                // resolution chain.
                const shellCmd = providerShellCommand(r.protocol_family ?? null);
                const justCopied = copiedField === 'route_cmd';
                const isInUse = props.inUse;
                if (isInUse) {
                  if (!justCopied && !shellCmd) return null;
                  return (
                    <div className="drawer-actions-hint" role="note">
                      {justCopied ? (
                        <>
                          <CheckIcon className="w-3 h-3" />
                          <span>{t('vault.copiedPasteInTerminal')}</span>
                        </>
                      ) : (
                        <>
                          <PlayIcon className="w-3 h-3" />
                          <span>
                            Run <code className="font-mono">{shellCmd}</code> directly in any terminal.
                          </span>
                        </>
                      )}
                    </div>
                  );
                }
                return (
                  <div className="drawer-actions-hint" role="note">
                    {justCopied ? (
                      <>
                        <CheckIcon className="w-3 h-3" />
                        <span>{t('vault.copiedPasteInTerminal')}</span>
                      </>
                    ) : (
                      <>
                        <ZapIcon className="w-3 h-3" />
                        <span>
                          Copy <code className="font-mono">aikey activate {r.alias}</code>, run in a terminal.
                        </span>
                      </>
                    )}
                  </div>
                );
              })()}
              {/* Secondary actions wrapper — 80% centered row (2026-04-24
                  user request: buttons narrower than full width, hint
                  above still spans 100%). Wrapping in .drawer-actions-row
                  lets the parent flex-column layout center the row
                  without affecting the hint's width. */}
              <div className="drawer-actions-row">
              {/* "Reveal & copy" button removed 2026-04-24 — the drawer's
                  "Get via CLI" copyable command is now the single plaintext
                  path. No in-browser reveal exists. */}
              {/* Test connection moved to the row Actions column 2026-05-22
                  (icon-only). The drawer keeps Rename + Delete; the probe
                  is per-credential and reads better as an inline row
                  action next to View / Use / Rename / Delete than as a
                  drawer-level button that requires opening the drawer
                  first. */}
              <button
                type="button"
                className="action-btn"
                onClick={props.onBeginRename}
                disabled={props.locked}
                title={lockedTitle ?? t('vault.renameThisAlias')}
              >
                <EditIcon className="w-3.5 h-3.5" />
                {t('vault.renameAlias')}
              </button>
              <button
                type="button"
                className="action-btn danger"
                onClick={isTeam ? undefined : props.onDelete}
                disabled={props.locked || isTeam}
                title={
                  isTeam
                    ? t('vault.teamDeleteBlockedTitle')
                    : (lockedTitle ?? t('vault.deleteCannotBeUndone'))
                }
              >
                <TrashIcon className="w-3.5 h-3.5" />
                {t('vault.delete')}
              </button>
              </div>
            </div>
          </div>


          {/* Meta — field order: Provider, Type, Status, Last used,
              Created, Use count, Expires (OAuth only), Target. Provider
              and Type moved here 2026-04-24 from the Credential section
              — the drawer header already highlights them (provider dot
              + KEY/OAUTH pill + status chip), so duplicating them
              inside Credential was burying the actionable rows (Secret /
              base_url / route_url / Route token) below the fold.
              Keeping them available in Meta preserves the values for
              anyone who wants to read / copy them. Fields without data
              (last_model / fingerprint / 7D usage from the template)
              are omitted here until the proxy telemetry pipeline
              lands. */}
          <div className="drawer-section drawer-section--meta">
            <div className="drawer-section-title">
              <InfoIcon className="w-3 h-3" />
              {t('vault.meta')}
            </div>
            <div className="drawer-field">
              <span className="k">{t('vault.protocol')}</span>
              <span className="v">
                {providerName}
                <span className="ro-pill">RO</span>
              </span>
            </div>
            <div className="drawer-field">
              <span className="k">{t('vault.type')}</span>
              <span className="v">
                {isTeam ? t('vault.typeTeamKey') : isPersonal ? 'KEY' : t('vault.typeOAuthSession')}
                <span className="ro-pill">RO</span>
              </span>
            </div>
            {/* Org UUID + Tier (OAuth-only, moved here 2026-05-06 from
                the Credential section). Conditional on the field being
                non-null so personal-key drawers and OAuth accounts
                missing the data both stay clean. */}
            {oauth?.org_uuid && (
              <div className="drawer-field">
                <span className="k">{t('vault.orgUuid')}</span>
                <span className="v mono dim">{oauth.org_uuid}</span>
              </div>
            )}
            {oauth?.account_tier && (
              <div className="drawer-field">
                <span className="k">{t('vault.tier')}</span>
                <span className="v">{oauth.account_tier}</span>
              </div>
            )}
            <div className="drawer-field">
              <span className="k">{t('vault.colStatus')}</span>
              <span className="v">
                {r.status === 'active' ? (
                  <>
                    <span className="status-dot" style={{ width: 5, height: 5 }} />
                    <span style={{ color: 'var(--success)' }}>{t('vault.statusActiveWord')}</span>
                  </>
                ) : (
                  <>
                    <span className="status-dot error" style={{ width: 5, height: 5 }} />
                    <span style={{ color: '#fca5a5' }}>{String(r.status)}</span>
                  </>
                )}
              </span>
            </div>
            {/* Phase 3B (2026-05-11) — META only renders rows that carry
                real data. Team rows have shimmed last_used_at=null /
                created_at=0 / use_count=0 because B's UserKeyDTO doesn't
                include usage telemetry today; rendering them would show
                "never · 0 uses · 1970-01-01" which is misleading. Skip
                those rows entirely for team and only emit them when
                there's real data behind. */}
            {(!isTeam || r.last_used_at) && (
              <div className="drawer-field">
                <span className="k">{t('vault.lastUsed')}</span>
                <span className="v">
                  {formatRelative(r.last_used_at)}
                  {r.last_used_at && (
                    <span className="mono dim">
                      · {formatCreatedShort(r.last_used_at)}
                    </span>
                  )}
                </span>
              </div>
            )}
            {(!isTeam || r.created_at > 0) && (
              <div className="drawer-field">
                <span className="k">{t('vault.created')}</span>
                <span className="v">{formatCreatedShort(r.created_at)}</span>
              </div>
            )}
            {(!isTeam || (r.use_count ?? 0) > 0) && (
              <div className="drawer-field">
                <span className="k">{t('vault.useCount')}</span>
                <span className="v mono">{r.use_count ?? 0}</span>
              </div>
            )}
            {oauth?.token_expires_at && (
              <div className="drawer-field">
                <span className="k">{t('vault.expires')}</span>
                <span className="v">
                  {formatExpiresIn(oauth.token_expires_at, t)}
                  <span className="mono dim">
                    · {formatCreatedShort(oauth.token_expires_at)}
                  </span>
                </span>
              </div>
            )}
            {/* Team-only Expires (ISO date from B). formatExpiresAtIso
                returns null on missing / unparseable input so the row
                quietly drops out for team keys without an expiry. */}
            {team?.expires_at && (
              <div className="drawer-field">
                <span className="k">{t('vault.expires')}</span>
                <span className="v">{formatExpiresAtIso(team.expires_at, t)}</span>
              </div>
            )}
            <div className="drawer-field">
              <span className="k">{t('vault.target')}</span>
              <span className="v mono dim">{r.target}</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

// ── Test Connection popup ───────────────────────────────────────────────
//
// Modal driven by the drawer's Test Connection button (2026-05-22). Lives
// alongside the drawer rather than inside it so the drawer can stay open
// after the user fires a probe — the popup overlays the row context the
// drawer already provides.
//
// Phases:
//   running — request in flight; status row shows spinner and we hide
//             the suite table to avoid layout flicker (no rows yet).
//   done    — render the aggregate status pill + latency + error code
//             (when fail) + the per-target suite table. "Run again"
//             button calls onRetry so the user can re-probe without
//             closing.
//   error   — request failed before producing a result (network /
//             timeout / proxy not running). Show the error_code +
//             message and a Retry button.
//
// Why no stepped progress bars: the backend doesn't stream — it returns
// a single envelope when the suite finishes. Building a fake stepped
// progress UI would lie about what's happening. A spinner with the
// alias being probed reads as honest.
// `friendlyTestError` moved to ./friendlyTestError.tsx — extracted so the
// fence test can import the pure logic without dragging the whole page
// module (page-level imports pull http-client → runtime.ts which touches
// `window` at module init and fails under vitest's node env). See bugfix
// 20260523-test-connection-proxy-down-shows-local-server-error.md.

function TestConnectionPopup(props: {
  record: VaultRowRecord;
  phase: 'running' | 'done' | 'error';
  result: TestResponse | null;
  error: { code?: string; httpStatus?: number; message: string } | null;
  onClose: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const { record, phase, result, error, onClose, onRetry } = props;
  const lt = result?.last_test ?? null;
  const persistedAt = phase === 'done' && lt ? lt : null;
  const isPass = persistedAt?.status === 'pass';
  // Pull the display alias the same way the drawer does so the popup
  // header lines up visually when both are open.
  const headerLabel = record.target === 'oauth'
    ? ((record as OAuthVaultRecord).alias ?? (record as OAuthVaultRecord).display_identity ?? record.id)
    : record.alias;

  return (
    <>
      <div
        className="drawer-overlay"
        data-open="true"
        style={{ zIndex: 60 }}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('vault.connectivityTestResultAria')}
        style={{
          position: 'fixed',
          inset: 0,
          margin: 'auto',
          zIndex: 70,
          width: 'min(640px, calc(100vw - 32px))',
          maxHeight: 'calc(100vh - 64px)',
          height: 'fit-content',
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          boxShadow: '0 25px 60px rgba(0,0,0,0.55)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <ActivityIcon className="w-4 h-4" />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t('vault.testConnectionPopupTitle')}</div>
              <div
                className="font-mono"
                style={{
                  fontSize: 11,
                  color: 'var(--muted-foreground)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={headerLabel ?? record.id}
              >
                {record.target.toUpperCase()} · {headerLabel ?? record.id}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="drawer-close"
            onClick={onClose}
            title={t('vault.closeEsc')}
            aria-label={t('vault.closePopupAria')}
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <div style={{ padding: 18, overflowY: 'auto' }}>
          {phase === 'running' && (
            <div
              style={{
                padding: '36px 0',
                textAlign: 'center',
                color: 'var(--muted-foreground)',
              }}
            >
              {/* Spinner: a plain div with `.aikey-spinner` class. The
                  class lives in the global keys-page-css.ts stylesheet
                  (search for `@keyframes aikey-spin`) — unscoped so it
                  reaches the popup even though the popup is a fixed
                  overlay outside .vault-page's subtree. Switched from
                  SVG <animateTransform> 2026-05-22: SMIL animates fine
                  live but reads as static in screenshots / screen
                  recordings, which kept getting reported as a bug. CSS
                  animation behaves identically in both live and
                  captured frames. */}
              <div
                className="aikey-spinner"
                style={{ display: 'block', margin: '0 auto 12px' }}
                aria-hidden="true"
              />
              <div style={{ fontSize: 13 }}>{t('vault.probingThroughProxy')}</div>
              <div className="font-mono" style={{ fontSize: 11, marginTop: 6 }}>
                {t('vault.probeDurationHint')}
              </div>
            </div>
          )}

          {phase === 'error' && error && (() => {
            // Map raw (code, httpStatus) → user-readable text. Two
            // dimensions here: WHY-it-failed wording (the title) and
            // WHAT-to-do-next (the suggestion). Falls through to the
            // raw axios message for codes we haven't classified, so
            // we never hide real backend errors — just paper over the
            // most common transient ones.
            const friendly = friendlyTestError(error, t);
            return (
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '12px 14px',
                    background: 'rgba(220, 38, 38, 0.08)',
                    border: '1px solid rgba(220, 38, 38, 0.35)',
                    borderRadius: 8,
                    marginBottom: 12,
                  }}
                >
                  <span
                    className="status-dot error"
                    style={{ width: 8, height: 8, background: 'var(--destructive)' }}
                  />
                  <span style={{ color: 'var(--destructive)', fontWeight: 600, fontSize: 13 }}>
                    {friendly.title}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted-foreground)', lineHeight: 1.5 }}>
                  {friendly.detail}
                </div>
                {friendly.action && (
                  <div className="font-mono" style={{ marginTop: 12, fontSize: 11 }}>
                    {friendly.action}
                  </div>
                )}
                {/* Raw error info kept in a muted footer for ops /
                    debugging — small + monospace so it doesn't compete
                    with the friendly message above. */}
                <div
                  className="font-mono"
                  style={{
                    marginTop: 14,
                    fontSize: 10,
                    color: 'var(--muted-foreground)',
                    opacity: 0.55,
                  }}
                >
                  {error.httpStatus ? `HTTP ${error.httpStatus} · ` : ''}
                  {error.code ?? t('vault.noCode')}
                  {error.message && error.message !== friendly.detail ? ` · ${error.message}` : ''}
                </div>
              </div>
            );
          })()}

          {phase === 'done' && lt && persistedAt && (
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 14px',
                  background: isPass ? 'rgba(34, 197, 94, 0.08)' : 'rgba(220, 38, 38, 0.08)',
                  border: `1px solid ${isPass ? 'rgba(34, 197, 94, 0.35)' : 'rgba(220, 38, 38, 0.35)'}`,
                  borderRadius: 8,
                  marginBottom: 12,
                }}
              >
                <span
                  className="status-dot"
                  style={{
                    width: 10,
                    height: 10,
                    background: isPass ? 'var(--success)' : 'var(--destructive)',
                  }}
                />
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: isPass ? 'var(--success)' : 'var(--destructive)',
                  }}
                >
                  {isPass ? t('vault.connectionHealthy') : t('vault.connectionFailed')}
                </span>
                {persistedAt.latency_ms != null && (
                  <span className="font-mono" style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
                    · {persistedAt.latency_ms}ms
                  </span>
                )}
                {persistedAt.error_code && (
                  <span className="font-mono" style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
                    · {persistedAt.error_code}
                  </span>
                )}
              </div>
              {/* Top banner used to dump the raw error_message JSON here.
                  Removed 2026-05-22: the FailureDetails section below
                  already parses the same body into (type chip + message),
                  so showing the raw JSON twice was just visual clutter.
                  Banner stays a one-line status summary; per-provider
                  detail is FailureDetails' job. */}
              {result && !result.persisted && (
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--muted-foreground)',
                    fontStyle: 'italic',
                    marginBottom: 12,
                  }}
                >
                  {t('vault.persistNote')}
                </div>
              )}
              {Array.isArray(persistedAt.suite_results) && persistedAt.suite_results.length > 0 && (
                <>
                  <SuiteResultsTable rows={persistedAt.suite_results} />
                  <FailureDetails rows={persistedAt.suite_results} />
                </>
              )}
            </div>
          )}
        </div>

        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            alignItems: 'center',
          }}
        >
          {phase !== 'running' && (
            <button
              type="button"
              onClick={onRetry}
              title={t('vault.runProbeAgainTitle')}
              style={POPUP_BTN_STYLE}
            >
              <RefreshIcon className="w-3.5 h-3.5" />
              <span>{t('vault.runAgain')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            style={POPUP_BTN_PRIMARY_STYLE}
          >
            {t('vault.close')}
          </button>
        </div>
      </div>
    </>
  );
}

// Compact per-target breakdown of the suite. Each row is a separate
// probe (e.g. a personal key bound to anthropic + openai produces two
// rows). Status comes straight from the CLI's run_connectivity_suite
// JSON output — see SuiteOutcome.json_results.
function SuiteResultsTable(props: { rows: unknown[] }) {
  const { t } = useTranslation();
  const rows = props.rows as Array<Record<string, unknown>>;
  if (!rows.length) return null;
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ background: 'var(--muted)' }}>
            <th style={cellHeadStyle}>{t('vault.suiteColProvider')}</th>
            <th style={cellHeadStyle}>{t('vault.suiteColPing')}</th>
            <th style={cellHeadStyle}>{t('vault.suiteColApi')}</th>
            <th style={cellHeadStyle}>{t('vault.suiteColChat')}</th>
            <th style={cellHeadStyle}>{t('vault.suiteColLatency')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const label = String(row.label ?? row.provider ?? '—');
            const pingOk = row.ping_ok === true;
            const apiOk = row.api_ok === true;
            const chatOk = row.chat_ok === true;
            const apiStatus = typeof row.api_status === 'number' ? row.api_status : null;
            const chatStatus = typeof row.chat_status === 'number' ? row.chat_status : null;
            const apiMs = typeof row.api_ms === 'number' ? row.api_ms : null;
            const chatMs = typeof row.chat_ms === 'number' ? row.chat_ms : null;
            // Latency = chat_ms preferred (it's the end-to-end signal),
            // fall back to api_ms when chat hasn't run / failed.
            const latencyMs = chatOk && chatMs != null ? chatMs : apiMs;
            // Per-phase fail colour: Ping fail = red (network gone),
            // API/Chat fail = amber (reach worked, downstream rejected).
            const pingFailColor = 'var(--destructive, #ef4444)';
            const stageFailColor = '#f59e0b';
            return (
              <tr key={i} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                <td style={cellStyle}>{label}</td>
                <td style={cellStyle}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: pingOk ? 'var(--success)' : pingFailColor,
                    }}
                  />{' '}
                  {pingOk ? t('vault.probeOk') : t('vault.probeFail')}
                </td>
                <td style={cellStyle}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: apiOk ? 'var(--success)' : stageFailColor,
                    }}
                  />{' '}
                  {apiOk ? t('vault.probeOk') : apiStatus != null ? `HTTP ${apiStatus}` : t('vault.probeFail')}
                </td>
                <td style={cellStyle}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: chatOk ? 'var(--success)' : stageFailColor,
                    }}
                  />{' '}
                  {chatOk ? t('vault.probeOk') : chatStatus != null ? `HTTP ${chatStatus}` : t('vault.probeFail')}
                </td>
                <td style={cellStyle} className="font-mono">
                  {latencyMs != null ? `${latencyMs}ms` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Per-row error detail panel, rendered under SuiteResultsTable when any
// row has a non-OK API or Chat status. Surfaces the actual upstream
// response body so users diagnosing a 401 / 400 / 429 see the JSON
// reason — not just the bare status code. Skipped silently for fully-
// passing suites so the popup stays compact in the happy path.
//
// Why a separate panel rather than expanding the table cell:
//   - Body snippets are ~280-400 chars, too wide for an inline cell;
//   - Status code in the cell stays scannable (PASS/FAIL/HTTP 401);
//   - The detail section reads top-to-bottom like a stack trace, which
//     matches the "first thing that failed" mental model.
/**
 * Best-effort parse of an upstream provider's error response body into
 * a `(type, message)` pair. Tries the three shapes that account for ~all
 * provider responses we see:
 *
 *   Anthropic: { "type": "error", "error": { "type": "...", "message": "..." }, "request_id": "..." }
 *   OpenAI:    { "error": { "message": "...", "type": "...", "code": "..." } }
 *   Aggregator/proxy front-ends: { "error": "free-form string" }
 *
 * If the body isn't valid JSON, or none of the known shapes match, we
 * surface the raw body as `message` and leave `type` null — never lose
 * the underlying signal, just stop dumping it as monospace JSON.
 */
function parseProviderErrorBody(body: string | null): {
  type: string | null;
  message: string;
} {
  if (!body) return { type: null, message: '' };
  const trimmed = body.trim();
  if (!trimmed) return { type: null, message: '' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { type: null, message: trimmed };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { type: null, message: trimmed };
  }
  const obj = parsed as Record<string, unknown>;
  // Shape A — { error: { type, message } } (Anthropic, OpenAI, ...)
  const inner = obj.error;
  if (inner && typeof inner === 'object') {
    const iobj = inner as Record<string, unknown>;
    const t = typeof iobj.type === 'string' ? iobj.type : null;
    const m = typeof iobj.message === 'string' ? iobj.message : '';
    if (t || m) return { type: t, message: m || trimmed };
  }
  // Shape B — { error: "free-form string" }
  if (typeof inner === 'string') {
    return { type: null, message: inner };
  }
  // Shape C — { type, message } at the top level
  if (typeof obj.message === 'string') {
    return {
      type: typeof obj.type === 'string' ? obj.type : null,
      message: obj.message,
    };
  }
  return { type: null, message: trimmed };
}

function FailureDetails(props: { rows: unknown[] }) {
  const { t } = useTranslation();
  const rows = props.rows as Array<Record<string, unknown>>;
  type FailEntry = {
    provider: string;
    stage: 'API' | 'Chat';
    status: number | null;
    body: string | null;
  };
  const failures: FailEntry[] = [];
  for (const row of rows) {
    const provider = String(row.label ?? row.provider ?? '—');
    // A stage failed AND has data only when it actually ran. The CLI
    // short-circuits later stages on earlier failure (e.g. API 404 → skip
    // Chat, leaving chat_status=null/body=null/chat_ms=0). Those
    // skipped stages would otherwise show up as empty cards in the
    // details panel — "anthropic · Chat" with nothing under it — which
    // adds noise without adding signal. The Wi-Fi bars already show
    // "downstream skipped" via the red segment, so suppress the empty
    // detail card here.
    const apiRan = row.api_status != null || typeof row.api_body_snippet === 'string';
    if (row.api_ok !== true && apiRan) {
      failures.push({
        provider,
        stage: 'API',
        status: typeof row.api_status === 'number' ? row.api_status : null,
        body: typeof row.api_body_snippet === 'string' ? row.api_body_snippet : null,
      });
    }
    const chatRan = row.chat_status != null || typeof row.chat_body_snippet === 'string';
    if (row.chat_ok !== true && chatRan) {
      failures.push({
        provider,
        stage: 'Chat',
        status: typeof row.chat_status === 'number' ? row.chat_status : null,
        body: typeof row.chat_body_snippet === 'string' ? row.chat_body_snippet : null,
      });
    }
  }
  if (failures.length === 0) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--muted-foreground)',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          marginBottom: 8,
        }}
      >
        {t('vault.failureDetailsLabel')}{failures.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {failures.map((f, i) => {
          const parsed = parseProviderErrorBody(f.body);
          return (
            <div
              key={i}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '10px 12px',
                background: 'rgba(245, 158, 11, 0.06)',
              }}
            >
              {/* Header row: dot · provider · stage · HTTP status · type chip */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 8,
                  marginBottom: parsed.message ? 6 : 0,
                  fontSize: 11,
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: '#f59e0b',
                  }}
                />
                <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>
                  {f.provider}
                </span>
                <span style={{ color: 'var(--muted-foreground)' }}>·</span>
                <span style={{ color: 'var(--muted-foreground)' }}>{f.stage}</span>
                {f.status != null && (
                  <>
                    <span style={{ color: 'var(--muted-foreground)' }}>·</span>
                    <span className="font-mono" style={{ color: '#f59e0b' }}>
                      HTTP {f.status}
                    </span>
                  </>
                )}
                {parsed.type && (
                  <span
                    className="font-mono"
                    style={{
                      display: 'inline-block',
                      padding: '1px 7px',
                      borderRadius: 999,
                      background: 'rgba(245, 158, 11, 0.18)',
                      border: '1px solid rgba(245, 158, 11, 0.45)',
                      color: '#f59e0b',
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: 0.2,
                    }}
                  >
                    {parsed.type}
                  </span>
                )}
              </div>
              {/* Message: plain prose, NOT a monospace JSON dump. Long
                  upstream messages wrap naturally; we cap height so a
                  pathological 2 KB rant doesn't eat the popup. */}
              {parsed.message && (
                <div
                  style={{
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: 'var(--foreground)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 160,
                    overflowY: 'auto',
                  }}
                >
                  {parsed.message}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Popup footer button styles. Defined inline (rather than as a CSS
// class on .vault-page) because the popup is rendered as a portal-like
// fixed overlay; its descendants sit *outside* the .vault-page subtree
// when you look at the DOM through the React tree, so vault-page-
// scoped class selectors like `.vault-page .action-btn` were not
// matching them and the buttons rendered as unstyled text. Using inline
// styles keeps the rule co-located with the popup and avoids touching
// the shared VAULT_CSS for a one-place visual.
const POPUP_BTN_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 14px',
  fontSize: 12,
  fontWeight: 500,
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--foreground)',
  cursor: 'pointer',
  lineHeight: 1.2,
};
const POPUP_BTN_PRIMARY_STYLE: React.CSSProperties = {
  ...POPUP_BTN_STYLE,
  background: 'var(--muted)',
  borderColor: 'var(--border)',
};

const cellHeadStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px',
  fontWeight: 600,
  fontSize: 11,
  color: 'var(--muted-foreground)',
};
const cellStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 11,
  verticalAlign: 'middle',
};

// ── Add Key modal ────────────────────────────────────────────────────────

type AddKind = 'api' | 'oauth';

// ── Provider presets ────────────────────────────────────────────────────
//
// OAuth 预设保留在本地: `aikey auth login <provider>` 仅支持 3 家 (claude /
// codex / kimi),与 API Key 的"协议清单"语义不同,不复用 ProviderMultiSelect。
// API Key 的 providers 预设已统一迁到 shared/ui/ProviderMultiSelect 的
// `KNOWN_PROTOCOLS`,同 import 页面一套 (带品牌别名 + CJK 搜索)。

const OAUTH_PROVIDER_PRESETS: string[] = ['claude', 'codex', 'kimi'];

// AddKeyModal client-side validation. Mirrors CLI core
// `commands_account::validate_alias` (non-empty / ≤128 chars / no
// control chars) and adds light UX-only minimums (alias ≥ 2 chars,
// secret ≥ 8 chars) plus base_url URL-format check. Server still
// re-validates — this is just to fail-fast in the modal so the user
// doesn't round-trip the CLI bridge for trivial mistakes.
const ALIAS_MIN_LEN = 2;
const ALIAS_MAX_LEN = 128;
const SECRET_MIN_LEN = 8;
type AddKeyField = 'alias' | 'secret' | 'baseUrl';
interface AddKeyValidationError {
  field: AddKeyField;
  message: string;
}
function validateAddKey(
  args: {
    alias: string;
    secret: string;
    baseUrl: string;
  },
  // i18n translator passed in from the calling component (this is a pure
  // helper, not a React component, so it can't call useTranslation()).
  t: (key: string, opts?: Record<string, unknown>) => string,
): AddKeyValidationError | null {
  const alias = args.alias.trim();
  if (!alias) return { field: 'alias', message: t('vault.aliasRequired') };
  if (alias.length < ALIAS_MIN_LEN) {
    return { field: 'alias', message: t('vault.aliasMinLen', { n: ALIAS_MIN_LEN }) };
  }
  if (alias.length > ALIAS_MAX_LEN) {
    return { field: 'alias', message: t('vault.aliasMaxLen', { n: ALIAS_MAX_LEN }) };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(alias)) {
    return { field: 'alias', message: t('vault.aliasControlChars') };
  }
  if (!args.secret) return { field: 'secret', message: t('vault.secretRequired') };
  if (args.secret.length < SECRET_MIN_LEN) {
    return { field: 'secret', message: t('vault.secretMinLen', { n: SECRET_MIN_LEN }) };
  }
  // base_url is optional; when present it must be a parseable absolute
  // http(s) URL — relative paths or missing scheme are common typos.
  const baseUrl = args.baseUrl.trim();
  if (baseUrl) {
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      return { field: 'baseUrl', message: t('vault.baseUrlInvalid') };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { field: 'baseUrl', message: t('vault.baseUrlScheme') };
    }
  }
  return null;
}

function AddKeyModal(props: {
  onClose: () => void;
  onSubmitPersonal: (payload: {
    alias: string;
    secret_plaintext: string;
    provider?: string;
    providers?: string[];
    base_url?: string;
  }) => Promise<unknown>;
  /**
   * Fired when the OAuth broker reports a fresh `connected` state — i.e.
   * the broker just wrote a new OAuth token to the vault. Parent uses
   * this to invalidate the vault-list React Query so the new row shows
   * up without a manual page refresh. Bugfix
   * 20260525-vault-oauth-add-no-list-refresh.md.
   *
   * Why a callback instead of having the modal call `useQueryClient()`
   * itself: the query key (`['vault-list']`) lives in the parent
   * component along with the actual `useQuery({ queryKey: ... })`
   * declaration, so keeping invalidation in the parent avoids a key
   * literal leaking into the modal (and forming a second source of
   * truth that could drift). Same pattern as `onSubmitPersonal` →
   * `addMut.mutateAsync().onSuccess` for Personal API key adds.
   */
  onOAuthConnected?: () => void;
  pending: boolean;
  /**
   * Single source of truth: provider id → ProviderRoute (host, base_url,
   * version). Built by the parent from `/api/user/import/rules`'s
   * `provider_routes` array, which mirrors
   * `aikey-cli/data/provider_fingerprint.yaml::provider_routes` —
   * the v4.3 (2026-05-01) successor to family_base_urls.
   *
   * 2026-05-08: added so the Add Key form auto-fills base_url when the
   * user picks a protocol. Re-uses the parent's already-cached
   * `providerToRoute` map (built once per session via React Query
   * staleTime: Infinity), so no duplicate fetch and no drift from YAML.
   *
   * Earlier draft of this prop tried `family_base_urls` but the backend
   * stopped emitting it after v4.3 collapsed family_base_urls +
   * host_to_base_url into provider_routes — fixed 2026-05-08 after
   * chrome MCP debug showed `family_base_urls: undefined`.
   */
  providerToRoute?: Map<string, { base_url: string; version: string }>;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<AddKind>('api');
  const [alias, setAlias] = useState('');
  // API-Key kind accepts multiple providers (aggregator gateways like
  // openrouter frequently serve several protocols through one key).
  const [providers, setProviders] = useState<string[]>(['openai']);
  // OAuth kind is single-select — `aikey auth login <provider>` takes
  // exactly one provider name.
  const [oauthProvider, setOauthProvider] = useState('claude');
  const [secret, setSecret] = useState('');
  const [revealSecret, setRevealSecret] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [err, setErr] = useState<string | null>(null);
  // Field that should flash red when validation fails. Cleared after
  // ~1.2s so the user can retry without manually dismissing the flash.
  const [flashField, setFlashField] = useState<AddKeyField | null>(null);

  // ── Guided flow state (2026-05-23) ─────────────────────────────────
  // mode: guided two-page wizard vs simple single-page form.
  //   default = guided (spec §2 — most users benefit from connectivity
  //   feedback before save). 'simple' for power users who want speed.
  // page: only used when (mode === 'guided' && kind === 'api');
  //   1 = Add credential, 2 = Test + name.
  // The other three combinations (Simple+API, *+OAuth) skip the wizard
  // and render the existing single-page body, so we keep the
  // simple/oauth UX untouched.
  const [mode, setMode] = useState<'guided' | 'simple'>('guided');
  const [page, setPage] = useState<1 | 2>(1);
  // Page-2 testRaw state machine. 'idle' = no test yet; 'running' =
  // probe in flight; 'done' = result available; 'error' = transport /
  // backend failure (separate from "probe ran but chat failed", which
  // is testResult.status === 'fail').
  const [testState, setTestState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [testResult, setTestResult] = useState<VaultLastTest | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  // OAuth flow terminal state, surfaced from the OAuthBrokerCard. When
  // true the broker has written the token to vault and the modal can
  // advance to page 2 (Test + name) per spec §4.4 / §5. We also keep
  // the broker's provider_account_id (needed to drive `vaultApi.test`
  // against the new OAuth row) and display_identity (default alias).
  const [oauthConnected, setOauthConnected] = useState(false);
  const [oauthAccountId, setOauthAccountId] = useState<string | null>(null);
  const [oauthIdentity, setOauthIdentity] = useState<string | null>(null);
  useEffect(() => {
    // Reset on kind / oauthProvider change so a switched provider
    // doesn't ghost the previous session's account_id.
    setOauthConnected(false);
    setOauthAccountId(null);
    setOauthIdentity(null);
  }, [kind, oauthProvider]);

  // useGuided gates the two-page wizard shell. For API kind both pages
  // are used; for OAuth kind only page 1 is meaningful (page 2's
  // pre-save Run-test is API-only — OAuth tokens are minted by the
  // broker, not pasted) but the Guided shell still drives the new
  // OAuthBrokerCard 3-step UI that replaces the old "go run aikey
  // auth login" CLI hint. Simple mode for OAuth still shows the CLI
  // hint (OAuthGuide) — that's the power-user / scripted path.
  const useGuided = mode === 'guided';

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') props.onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props]);

  // Auto-clear flashField after the CSS animation finishes.
  useEffect(() => {
    if (!flashField) return;
    const t = window.setTimeout(() => setFlashField(null), 1200);
    return () => clearTimeout(t);
  }, [flashField]);

  // Spec §12 — input changes invalidate the previous test result. The
  // user just changed something material; the green/yellow/red dots
  // they're staring at no longer describe what they have. Reset to
  // 'idle' so the probe table re-renders waiting.
  useEffect(() => {
    setTestState('idle');
    setTestResult(null);
    setTestError(null);
  }, [secret, providers, baseUrl, kind]);

  // Spec §11 — mode / kind changes always reset to page 1 so the user
  // doesn't land on an empty page 2 after switching from OAuth to API.
  useEffect(() => {
    setPage(1);
  }, [mode, kind]);

  /**
   * Run a pre-save connectivity probe via the testRaw endpoint. Reuses
   * the same aggregator (`aggregate_test_outcome`) that the post-save
   * `vaultApi.test` uses, so the popup's status / phase booleans /
   * error_code render identically here vs the Vault page Last test
   * column — internal-command-reuses-public-core principle.
   *
   * Errors:
   *   - Transport / 5xx failures go to testState='error' with a
   *     human message (proxy not running, server restarting, etc.).
   *   - Probe "ran but failed" (status='fail') goes to testState='done'
   *     with testResult.status='fail' — the user sees the colored row
   *     and the repair card guidance.
   */
  async function runTest() {
    // OAuth kind: the broker already wrote the row to vault, so we use
    // the post-save vaultApi.test (by account_id) instead of testRaw
    // (which is the pre-save plaintext-secret path). Per spec §5.1 we
    // run the same 4-phase probe — only the entry point differs.
    if (kind === 'oauth') {
      if (!oauthAccountId) {
        setTestError(t('vault.oauthNoAccountIdTest'));
        setTestState('error');
        return;
      }
      setTestState('running');
      setTestError(null);
      try {
        const res = await vaultApi.test({ target: 'oauth', id: oauthAccountId });
        setTestResult(res.last_test);
        setTestState('done');
      } catch (e) {
        const err = e as { code?: string; message?: string; response?: { status?: number } };
        const status = err?.response?.status;
        let msg = err?.message || t('vault.testFailedUnknown');
        if (typeof status === 'number' && status >= 500) {
          msg = t('vault.localServerRestarting');
        } else if (err?.code === 'ERR_NETWORK') {
          msg = t('vault.localServerUnreachable');
        }
        setTestError(msg);
        setTestState('error');
      }
      return;
    }
    // API-key kind: pre-save testRaw path (plaintext secret in body).
    if (!secret.trim() || providers.length === 0) {
      setTestError(t('vault.needSecretAndProtocol'));
      setTestState('error');
      return;
    }
    setTestState('running');
    setTestError(null);
    try {
      const aliasHint = alias.trim() || `add-key-${providers[0] || 'probe'}`;
      const res = await vaultApi.testRaw({
        providers,
        secret: secret.trim(),
        alias_hint: aliasHint,
        base_url: baseUrl.trim() || undefined,
      });
      setTestResult(res.last_test);
      setTestState('done');
    } catch (e) {
      // Map axios / network errors to one-line guidance. The Add-Key
      // modal has less screen real-estate than the standalone Test
      // Connection popup, so we keep this terser than friendlyTestError.
      const err = e as { code?: string; message?: string; response?: { status?: number } };
      const status = err?.response?.status;
      let msg = err?.message || t('vault.testFailedUnknown');
      if (typeof status === 'number' && status >= 500) {
        msg = t('vault.localServerRestarting');
      } else if (err?.code === 'ERR_NETWORK') {
        msg = t('vault.localServerUnreachable');
      }
      setTestError(msg);
      setTestState('error');
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    // OAuth kind: the row was minted by the broker during step 3 on
    // page 1. Save here means: optionally rename the local_alias (if
    // the user typed something other than the default detected
    // identity), then close the modal. The vault list refetch is
    // already wired through the react-query invalidation in the
    // page-level mutation handlers.
    if (kind === 'oauth') {
      if (!oauthAccountId) {
        setErr(t('vault.oauthNoAccountIdSave'));
        return;
      }
      const newAlias = alias.trim();
      // Only call rename when the user actually changed the alias —
      // an empty input means "keep the default (detected identity)",
      // which is what's already set on the row.
      if (newAlias && newAlias !== (oauthIdentity || '').trim()) {
        try {
          await vaultApi.rename({ target: 'oauth', id: oauthAccountId, new_value: newAlias });
        } catch (e2) {
          setErr((e2 as Error).message);
          return;
        }
      }
      props.onClose();
      return;
    }
    if (kind !== 'api') return;
    // Client-side validation. Mirrors the CLI core's `validate_alias`
    // (non-empty / ≤128 chars / no control chars, see
    // commands_account::validate_alias) plus light UX-only rules
    // (min length, base_url format) so users see a clear inline error
    // before the round-trip to the CLI bridge. The bridge still
    // re-validates server-side as the source of truth.
    const v = validateAddKey({ alias, secret, baseUrl }, t);
    if (v) {
      setErr(v.message);
      // Re-trigger flash even if same field fails twice in a row
      // (set null first, then to field on next tick).
      setFlashField(null);
      window.setTimeout(() => setFlashField(v.field), 0);
      return;
    }
    try {
      // Pass `providers` as an array when the user picked ≥ 1 preset /
      // custom value; backend writes entries.supported_providers = JSON
      // array and entries.provider_code = providers[0] (routing default).
      // An empty array degrades to "leave provider unset" — the user
      // can attach a provider later by renaming + retry from the CLI.
      const payload: {
        alias: string;
        secret_plaintext: string;
        providers?: string[];
        provider?: string;
        base_url?: string;
      } = {
        alias: alias.trim(),
        secret_plaintext: secret,
        base_url: baseUrl.trim() || undefined,
      };
      if (providers.length > 0) {
        payload.providers = providers;
        payload.provider = providers[0];
      }
      await props.onSubmitPersonal(payload);
      // Spec §5.1 + Sub-1B follow-up persistence: the user just saw a
      // testRaw result on page 2. Fire (best-effort) a vaultApi.test()
      // by the now-existing alias so the same byte-shape lands in the
      // new row's `extra.$.last_test`, making the Vault page "Last
      // test" column light up immediately instead of waiting until the
      // user manually clicks the row's Test connection button.
      //
      // Why fire-and-forget: createPersonal already succeeded so the
      // row is committed. A test failure here is a UX nicety miss, not
      // a data correctness problem — the user can always re-run Test
      // connection from the row to repopulate.
      if (useGuided && testState === 'done' && testResult) {
        const finalAlias = alias.trim() || aliasPlaceholder(providers);
        vaultApi
          .test({ target: 'personal', id: finalAlias })
          .catch(() => { /* best-effort sync — see comment above */ });
      }
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  }

  return (
    <div
      className="modal-overlay"
      data-open="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="modal-panel modal-panel-guided">
        <div className="modal-header">
          <span className="inline-flex items-center gap-2 font-semibold text-[13.5px]">
            <PlusCircleIcon className="w-4 h-4" style={{ color: 'var(--primary)' }} />
            {t('vault.addKeyHeading')}
            <span
              className="text-[10px] font-mono tracking-widest uppercase ml-1"
              style={{ color: 'var(--muted-foreground)' }}
            >
              {t('vault.storedLocallyNeverLeaves')}
            </span>
          </span>
          <div className="header-controls inline-flex items-center gap-2">
            {/* Mode switch (spec §2). Always rendered so the user has
                a consistent control surface regardless of kind. */}
            <div className="mode-switch" aria-label={t('vault.modeSwitchAria')}>
              <button
                type="button"
                className={mode === 'guided' ? 'active' : ''}
                onClick={() => setMode('guided')}
              >
                {t('vault.modeGuided')}
              </button>
              <button
                type="button"
                className={mode === 'simple' ? 'active' : ''}
                onClick={() => setMode('simple')}
              >
                {t('vault.modeSimple')}
              </button>
            </div>
            <button
              className="icon-btn"
              title={t('vault.close')}
              onClick={props.onClose}
              aria-label={t('vault.close')}
            >
              <XIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
        <form onSubmit={submit} className="contents">
          {useGuided ? (
            <GuidedBody
              page={page}
              setPage={setPage}
              mode={mode}
              kind={kind}
              setKind={setKind}
              alias={alias}
              setAlias={setAlias}
              providers={providers}
              setProviders={setProviders}
              oauthProvider={oauthProvider}
              setOauthProvider={setOauthProvider}
              secret={secret}
              setSecret={setSecret}
              revealSecret={revealSecret}
              setRevealSecret={setRevealSecret}
              baseUrl={baseUrl}
              setBaseUrl={setBaseUrl}
              flashField={flashField}
              err={err}
              providerToRoute={props.providerToRoute}
              testState={testState}
              testResult={testResult}
              testError={testError}
              onRunTest={runTest}
              oauthAccountId={oauthAccountId}
              onOauthConnectedChange={(connected, info) => {
                setOauthConnected(connected);
                if (connected) {
                  setOauthAccountId(info?.providerAccountId ?? null);
                  setOauthIdentity(info?.displayIdentity ?? null);
                  // Spec §13.6: OAuth alias default = detected identity
                  // (the email / handle the broker pulled). Auto-fill
                  // only when the user hasn't typed anything yet.
                  if (!alias.trim() && info?.displayIdentity) {
                    setAlias(info.displayIdentity);
                  }
                  // BR (2026-05-25 vault-oauth-add-no-list-refresh): the
                  // broker has just written a new OAuth token to vault, so
                  // the cached vault-list query is stale. Fire the parent's
                  // invalidate so the new row shows up immediately —
                  // before this, users had to manually refresh the page.
                  props.onOAuthConnected?.();
                } else {
                  setOauthAccountId(null);
                  setOauthIdentity(null);
                }
              }}
              aliasPlaceholder={
                kind === 'oauth' && oauthIdentity
                  ? oauthIdentity
                  : aliasPlaceholder(providers, props.providerToRoute)
              }
              baseUrlPlaceholder={baseUrlPlaceholder(providers, props.providerToRoute)}
            />
          ) : (
            <SimpleBody
              kind={kind}
              setKind={setKind}
              alias={alias}
              setAlias={setAlias}
              providers={providers}
              setProviders={setProviders}
              oauthProvider={oauthProvider}
              setOauthProvider={setOauthProvider}
              secret={secret}
              setSecret={setSecret}
              revealSecret={revealSecret}
              setRevealSecret={setRevealSecret}
              baseUrl={baseUrl}
              setBaseUrl={setBaseUrl}
              flashField={flashField}
              err={err}
              providerToRoute={props.providerToRoute}
              baseUrlPlaceholder={baseUrlPlaceholder(providers, props.providerToRoute)}
              onOauthConnectedChange={(connected, info) => {
                setOauthConnected(connected);
                if (connected) {
                  setOauthAccountId(info?.providerAccountId ?? null);
                  setOauthIdentity(info?.displayIdentity ?? null);
                  if (!alias.trim() && info?.displayIdentity) {
                    setAlias(info.displayIdentity);
                  }
                  // BR (2026-05-25 vault-oauth-add-no-list-refresh):
                  // broker wrote token to vault → invalidate parent's
                  // vault-list cache so new row appears without manual
                  // refresh. Mirror of the GuidedBody branch above.
                  props.onOAuthConnected?.();
                } else {
                  setOauthAccountId(null);
                  setOauthIdentity(null);
                }
              }}
            />
          )}
          <div className="modal-footer">
            <span
              className={useGuided
                ? 'trust inline-flex items-center gap-1'
                : 'text-[10px] font-mono uppercase tracking-widest inline-flex items-center gap-1'
              }
              style={useGuided ? undefined : { color: 'var(--muted-foreground)' }}
            >
              <ShieldCheckIcon className="w-3 h-3" style={{ color: 'var(--success)' }} />
              {useGuided ? t('vault.encryptedOnSaveGuided') : t('vault.encryptedOnSaveSimple')}
            </span>
            <div className="actions flex items-center gap-2">
              <button
                type="button"
                className="btn btn-ghost btn-md text-[11px] px-3 py-1.5"
                onClick={props.onClose}
              >
                {/* spec §11: "Not now" hints at draft semantics on
                    guided page 2; falls back to "Cancel" otherwise. */}
                {useGuided && page === 2 ? t('vault.notNow') : t('vault.cancel')}
              </button>
              {useGuided && page === 2 && (
                <button
                  type="button"
                  className="btn btn-outline btn-md text-[11px] px-3 py-1.5 flex items-center gap-1"
                  onClick={() => setPage(1)}
                >
                  <ChevronLeftIcon className="w-3 h-3" />
                  {t('vault.back')}
                </button>
              )}
              {/* Next button visibility (spec §4.4 + §5):
                  - API kind: always available on page 1 (user is going
                    to page 2's pre-save Run-test).
                  - OAuth kind: only after the broker has minted the
                    session (oauthConnected) — before that, there's no
                    account_id to drive vaultApi.test on page 2. */}
              {useGuided && page === 1 && (kind === 'api' || (kind === 'oauth' && oauthConnected)) && (
                <button
                  type="button"
                  className="btn btn-primary btn-md text-[11px] px-4 py-1.5 flex items-center gap-1"
                  onClick={() => setPage(2)}
                >
                  {t('vault.next')}
                  <ChevronRightIcon className="w-3 h-3" />
                </button>
              )}
              {/* Save key on page 2 (or simple mode for API kind).
                  For OAuth kind, "Save key" means "rename the new row
                  to the typed alias and close" — the secret is already
                  in vault. */}
              {((!useGuided || page === 2)) && (kind === 'api' || (kind === 'oauth' && oauthConnected)) && (
                <button
                  type="submit"
                  className="btn btn-primary btn-primary-dim btn-md text-[11px] px-4 py-1.5 flex items-center gap-1"
                  disabled={props.pending}
                >
                  {props.pending ? t('vault.saving') : (
                    <>
                      <CheckIcon className="w-3 h-3" />
                      {/* spec §14.1: Save anyway keeps btn-primary
                          (gold), NEVER demoted to outline — the user
                          actively chose to save a failed-test key.
                          Only surface "Save anyway" in Guided mode —
                          Simple mode doesn't display test context, so
                          showing "Save anyway" there would baffle the
                          user (no visible failure to disclaim). */}
                      {useGuided && testState === 'done' && testResult?.status === 'fail'
                        ? t('vault.saveAnyway')
                        : t('vault.saveKey')}
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Add Key body components (2026-05-23) ─────────────────────────────
//
// SimpleBody = the legacy single-page form (kept byte-for-byte from
// the pre-Guided refactor so the simple/OAuth UX stays unchanged).
// GuidedBody = the new two-page wizard (spec §1-§5). The two share
// internal AddKeyField helpers (renderApiFields / renderKindSeg) so
// the input markup doesn't drift between modes.

type AddKeyFieldShared = {
  kind: AddKind;
  setKind: (k: AddKind) => void;
  alias: string;
  setAlias: (s: string) => void;
  providers: string[];
  setProviders: (s: string[]) => void;
  oauthProvider: string;
  setOauthProvider: (s: string) => void;
  secret: string;
  setSecret: (s: string) => void;
  revealSecret: boolean;
  setRevealSecret: (b: boolean | ((p: boolean) => boolean)) => void;
  baseUrl: string;
  setBaseUrl: (s: string) => void;
  flashField: AddKeyField | null;
  err: string | null;
  providerToRoute?: Map<string, { base_url: string; version: string }>;
  baseUrlPlaceholder: string;
};

// Compute the alias placeholder per spec §13.6:
//   API kind: `<protocol>-prod` (e.g. "openai-prod")
//   OAuth:    `<provider>-account` (no identity in pre-save UI yet)
function aliasPlaceholder(
  providers: string[],
  _providerToRoute?: Map<string, { base_url: string; version: string }>,
): string {
  const first = providers[0] || 'openai';
  return `${first}-prod`;
}

// Compute the base_url placeholder from providerToRoute (single source
// of truth = provider_fingerprint.yaml). Switching protocol updates the
// hint without ever touching the input value — user input is
// authoritative; empty = backend uses provider default.
function baseUrlPlaceholder(
  providers: string[],
  providerToRoute?: Map<string, { base_url: string; version: string }>,
): string {
  const first = providers[0];
  const route = first ? providerToRoute?.get(first) : undefined;
  return route ? `${route.base_url}${route.version}` : 'https://api.openai.com/v1';
}

function KindSeg(props: { kind: AddKind; setKind: (k: AddKind) => void; helpHidden?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="form-row">
      <span className="form-label">
        <ShapesIcon className="w-3 h-3" />
        {t('vault.kind')}
      </span>
      <div className="seg">
        <button
          type="button"
          className={props.kind === 'api' ? 'active' : ''}
          onClick={() => props.setKind('api')}
        >
          <KeyIcon className="w-3 h-3" />
          {t('vault.kindApiKey')}
        </button>
        <button
          type="button"
          className={props.kind === 'oauth' ? 'active' : ''}
          onClick={() => props.setKind('oauth')}
        >
          <UserCheckIcon className="w-3 h-3" />
          {t('vault.kindOAuth')}
        </button>
      </div>
      {!props.helpHidden && (
        <span className="form-help">
          {t('vault.kindHelp')}
        </span>
      )}
    </div>
  );
}

// ApiFields renders the secret + base_url block, and optionally the
// alias + protocols pair. showAlias=false skips alias (Guided mode
// shows it on page 2's name-strip instead — spec §19.1).
function ApiFields(props: AddKeyFieldShared & { showAlias: boolean; aliasPlaceholder?: string }) {
  const { t } = useTranslation();
  const aliasPh = props.aliasPlaceholder || aliasPlaceholder(props.providers);
  return (
    <>
      <div className={props.showAlias ? 'grid grid-cols-2 gap-3' : ''}>
        {props.showAlias && (
          <div className="form-row">
            <label className="form-label" htmlFor="add-alias-simple">
              <TagIcon className="w-3 h-3" />
              {t('vault.aliasLabel')}<span className="req">*</span>
            </label>
            <input
              id="add-alias-simple"
              type="text"
              className={`field-input${props.flashField === 'alias' ? ' field-input-flash' : ''}`}
              placeholder={aliasPh}
              autoFocus
              value={props.alias}
              onChange={(e) => props.setAlias(e.target.value)}
            />
          </div>
        )}
        <div className="form-row">
          <label className="form-label">
            <GlobeIcon className="w-3 h-3" />
            {t('vault.protocols')}<span className="req">*</span>
          </label>
          <ProviderMultiSelect
            values={props.providers}
            onChange={props.setProviders}
            placeholder={t('vault.searchOrAddProtocol')}
          />
          <span className="form-help">
            {t('vault.protocolsHelp')}
          </span>
        </div>
      </div>
      <div className="form-row">
        <label className="form-label" htmlFor="add-secret">
          <KeyIcon className="w-3 h-3" />
          {t('vault.plaintextSecret')}<span className="req">*</span>
        </label>
        <span className="field-input-wrap">
          <input
            id="add-secret"
            type={props.revealSecret ? 'text' : 'password'}
            className={`field-input${props.secret.length > 0 ? ' field-input-has-reveal' : ''}${props.flashField === 'secret' ? ' field-input-flash' : ''}`}
            placeholder="sk-..."
            autoComplete="off"
            spellCheck={false}
            value={props.secret}
            onChange={(e) => props.setSecret(e.target.value)}
          />
          {props.secret.length > 0 && (
            <button
              type="button"
              className="field-reveal-btn"
              onClick={() => props.setRevealSecret((r: boolean) => !r)}
              title={props.revealSecret ? t('vault.hideValueTitle') : t('vault.revealValueTitle')}
              aria-label={props.revealSecret ? t('vault.hideSecretAria') : t('vault.revealSecretAria')}
            >
              {props.revealSecret ? <EyeOffIcon className="w-3.5 h-3.5" /> : <EyeIcon className="w-3.5 h-3.5" />}
            </button>
          )}
        </span>
        <span className="form-help">
          {t('vault.secretHelp')}
        </span>
      </div>
      <div className="form-row">
        <label className="form-label" htmlFor="add-baseurl">
          <LinkIcon className="w-3 h-3" />
          base_url{' '}
          <span
            className="normal-case tracking-normal"
            style={{ color: 'var(--muted-foreground)' }}
          >
            {t('vault.optionalSuffix')}
          </span>
        </label>
        <span className="field-input-wrap">
          <input
            id="add-baseurl"
            type="text"
            className={`field-input${props.baseUrl.length > 0 ? ' field-input-has-reveal' : ''}${props.flashField === 'baseUrl' ? ' field-input-flash' : ''}`}
            placeholder={props.baseUrlPlaceholder}
            value={props.baseUrl}
            onChange={(e) => props.setBaseUrl(e.target.value)}
          />
          {props.baseUrl.length > 0 && (
            <button
              type="button"
              className="field-reveal-btn"
              onClick={() => props.setBaseUrl('')}
              title={t('vault.clearBaseUrlTitle')}
              aria-label={t('vault.clearBaseUrlAria')}
            >
              <XIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </span>
        <span className="form-help">
          {t('vault.baseUrlHelp')}
        </span>
      </div>
      {props.err && (
        <span className="text-[12px] font-mono" style={{ color: '#fca5a5' }}>
          {props.err}
        </span>
      )}
    </>
  );
}

function SimpleBody(props: AddKeyFieldShared & {
  /** Forwarded to OAuthBrokerCard. Save button is gated on
   *  oauthConnected (parent state), so this must propagate. */
  onOauthConnectedChange?: (
    connected: boolean,
    info?: { providerAccountId?: string; displayIdentity?: string },
  ) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="modal-body">
      <KindSeg kind={props.kind} setKind={props.setKind} />
      {props.kind === 'api' ? (
        <ApiFields {...props} showAlias={true} />
      ) : (
        <>
          {/* Simple-mode OAuth uses the same browser broker flow as Guided
              — no CLI hint. After the token lands the parent's Save button
              writes the user-typed alias and closes. */}
          <OAuthBrokerCard
            provider={props.oauthProvider}
            onProviderChange={props.setOauthProvider}
            onConnectedChange={props.onOauthConnectedChange}
          />
          <div className="form-row">
            <label className="form-label" htmlFor="add-alias-oauth-simple">
              <TagIcon className="w-3 h-3" />
              {t('vault.aliasOptionalLabel')}<span style={{ color: 'var(--muted-foreground)' }}>{t('vault.optionalSuffix')}</span>
            </label>
            <input
              id="add-alias-oauth-simple"
              type="text"
              className={`field-input${props.flashField === 'alias' ? ' field-input-flash' : ''}`}
              placeholder={t('vault.detectedIdentityUsedIfBlank')}
              value={props.alias}
              onChange={(e) => props.setAlias(e.target.value)}
            />
          </div>
        </>
      )}
    </div>
  );
}

// Spec §5.1: 4 probe phases with fixed "What it proves" copy.
const PROBE_PHASES: ReadonlyArray<{ id: 'ping' | 'proxy' | 'api' | 'chat'; label: string; proves: string }> = [
  { id: 'ping',  label: 'Ping(D)', proves: 'upstream reachable' },
  // 2026-05-26 Phase 2.E: proxy phase now exercises the real "this key →
  // local proxy → upstream provider" chain via aikey_probe_raw_*.
  { id: 'proxy', label: 'Proxy',   proves: 'proxy + this key → provider' },
  { id: 'api',   label: 'API',     proves: 'credential accepted' },
  { id: 'chat',  label: 'Chat',    proves: 'completion works' },
];

// Map (phase, testState, testResult) → (tone, status text, latency text).
//   tone: '' (waiting) | 'good' (green) | 'warn' (yellow) | 'bad' (red)
//
// 2026-05-26 Phase 2.E (spec: roadmap20260320/技术实现/update/20260526-pre-
// save-proxy-probe-raw.md §6.1): Proxy row now reads real proxy_* fields off
// testResult, populated by the Rust aggregator from outcome.proxy after CLI
// flipped vault_op::test_raw to probe_raw mode. Pre-Phase-2.E it was
// hard-coded to "skipped" because the old aikey_active_* path was misleading.
function probeRowState(
  phase: 'ping' | 'proxy' | 'api' | 'chat',
  testState: 'idle' | 'running' | 'done' | 'error',
  testResult: VaultLastTest | null,
  // i18n translator threaded from GuidedBody (pure helper, not a component).
  t: (key: string) => string,
): { tone: '' | 'good' | 'warn' | 'bad'; status: string; latency: string } {
  if (testState === 'idle' || testState === 'error') {
    return { tone: '', status: t('vault.probeStatusWaiting'), latency: '-' };
  }
  if (testState === 'running') {
    return { tone: '', status: '…', latency: '-' };
  }
  if (!testResult) {
    return { tone: '', status: t('vault.probeStatusWaiting'), latency: '-' };
  }
  if (phase === 'proxy') {
    // Read CLI's proxy probe result. Three render branches:
    //   1. proxy_ok=true → green "ok"
    //   2. proxy_error_code set (PROXY_TOO_OLD_NO_PROBE_RAW etc) → bad "fail" with hint
    //   3. proxy_ok absent (older CLI / proxy off) → "skipped" (legacy fallback)
    const rec = testResult as unknown as {
      proxy_ok?: boolean;
      proxy_ms?: number;
      proxy_status?: number;
      proxy_status_hint?: string;
      proxy_error_code?: string;
    };
    if (typeof rec.proxy_ok !== 'boolean') {
      // Backward compat: aggregator didn't set proxy_* (old CLI / proxy not
      // running on this run). Keep the legacy "skipped" UX rather than empty row.
      return { tone: '', status: t('vault.probeStatusSkipped'), latency: '-' };
    }
    const latency = typeof rec.proxy_ms === 'number' && rec.proxy_ms > 0
      ? `${Math.round(rec.proxy_ms)} ms`
      : '-';
    if (rec.proxy_ok) {
      return { tone: 'good', status: t('vault.probeStatusOk'), latency };
    }
    // proxy_ok=false → error path. Use proxy_error_code (when present) as the
    // status label so user sees "PROXY_TOO_OLD..." not just "fail"; full hint
    // text is shown in the friendly-error mapping below the table.
    const status = rec.proxy_error_code
      || (typeof rec.proxy_status === 'number' ? String(rec.proxy_status) : t('vault.probeStatusFail'));
    return { tone: 'bad', status, latency };
  }
  // Pull per-phase booleans from the aggregated record.
  const okMap = {
    ping: testResult.ping_ok,
    api:  testResult.api_ok,
    chat: testResult.chat_ok,
  } as const;
  const ok = okMap[phase];
  // Extract per-phase latency from suite_results (raw probe JSON).
  // testRaw produces one row per provider; for multi-provider keys we
  // take the first row's timing — it's representative for the dot/text
  // pair the user sees on this page (full per-provider breakdown is
  // out of scope for the Add-Key card, only the standalone Test
  // Connection popup digs that deep).
  const msField = { ping: 'ping_ms', api: 'api_ms', chat: 'chat_ms' }[phase];
  const sr = (testResult.suite_results || [])[0] as Record<string, unknown> | undefined;
  let latency = '-';
  if (sr) {
    const v = sr[msField];
    if (typeof v === 'number' && v > 0) latency = `${Math.round(v)} ms`;
  }
  if (ok) {
    return { tone: 'good', status: t('vault.probeStatusOk'), latency };
  }
  // Failure phase: use destructive red for ping/api (hard failures),
  // warn for chat (model-policy rejection — auth + network are fine,
  // user can still save and retest later).
  const tone: 'warn' | 'bad' = phase === 'chat' ? 'warn' : 'bad';
  // Per-phase status code lives in suite_results, not in the aggregated
  // error_code (which is first-failing-phase only). Each phase gets its
  // own HTTP status so the user can read API vs Chat results side-by-
  // side instead of always seeing the same code in two rows.
  let status = t('vault.probeStatusFail');
  if (sr) {
    const phaseStatus = sr[phase === 'ping' ? 'ping_ok' : `${phase}_status`];
    if (typeof phaseStatus === 'number') status = `${phaseStatus}`;
  }
  return { tone, status, latency };
}

// Map testResult → health card title/copy/tone + repair card content.
// Spec §5.1 + §10.5: first-failing-phase chain (Ping → API → Chat).
function healthFromResult(
  testState: 'idle' | 'running' | 'done' | 'error',
  testResult: VaultLastTest | null,
  testError: string | null,
  // i18n translator threaded from GuidedBody (pure helper, not a component).
  t: (key: string) => string,
): { title: string; copy: string; tone: '' | 'good' | 'warn' | 'bad'; repair: { tone: '' | 'good' | 'warn' | 'bad'; text: string } } {
  if (testState === 'idle') {
    return {
      title: t('vault.healthNotTestedTitle'), copy: t('vault.healthNotTestedCopy'), tone: '',
      repair: { tone: '', text: t('vault.repairNotTested') },
    };
  }
  if (testState === 'running') {
    return {
      title: t('vault.healthProbingTitle'), copy: t('vault.healthProbingCopy'), tone: '',
      repair: { tone: '', text: t('vault.repairProbing') },
    };
  }
  if (testState === 'error') {
    // Distinguish client-side validation (user hasn't filled all required
    // inputs yet) from infrastructure failures (aikey-proxy down, etc.).
    // Showing "check aikey-proxy" when the real issue is an empty secret
    // confuses the user; the repair card has to point them back to page 1
    // instead.
    // Classify "user hasn't filled required inputs yet" vs an infra failure.
    // Matches both the English validation copy and its zh translation
    // (vault.needSecretAndProtocol) so the locale doesn't change the branch.
    const isValidationErr = !!testError && /Need a secret|at least one protocol|需要.*密钥.*协议/i.test(testError);
    return {
      title: isValidationErr ? t('vault.healthMissingInput') : t('vault.healthProbeCouldNotRun'),
      copy: testError || t('vault.healthUnknownError'),
      tone: 'bad',
      repair: {
        tone: 'bad',
        text: isValidationErr
          ? t('vault.repairMissingInput')
          : t('vault.repairProbeCouldNotRun'),
      },
    };
  }
  // done
  if (!testResult) {
    return {
      title: t('vault.healthNoResult'), copy: '', tone: '',
      repair: { tone: '', text: '' },
    };
  }
  if (testResult.status === 'pass') {
    return {
      title: t('vault.healthHealthy'), copy: t('vault.healthHealthyCopy'), tone: 'good',
      repair: { tone: 'good', text: t('vault.repairReadyToSave') },
    };
  }
  // Fail — pick first failing phase per spec.
  if (!testResult.ping_ok) {
    return {
      title: t('vault.healthUpstreamUnreachable'), copy: t('vault.healthUpstreamUnreachableCopy'), tone: 'bad',
      repair: { tone: 'bad', text: t('vault.repairUpstreamUnreachable') },
    };
  }
  // Provider error bodies are JSON ({"error":{"message":"..."}}). Dumping
  // them raw into health-copy makes the card balloon to 5+ lines of
  // unreadable braces — parseProviderErrorBody extracts the human bit
  // and falls back to the raw string if shape doesn't match. Same helper
  // the standalone Test connection popup uses, so error formatting is
  // consistent across both surfaces.
  const rawMsg = typeof testResult.error_message === 'string' ? testResult.error_message : '';
  const parsed = parseProviderErrorBody(rawMsg);
  if (!testResult.api_ok) {
    return {
      title: t('vault.healthCredentialRejected'), copy: parsed.message || t('vault.healthAuthFailed'), tone: 'bad',
      repair: { tone: 'bad', text: t('vault.repairCredentialRejected') },
    };
  }
  // !chat_ok only
  return {
    title: t('vault.healthChatProbeFailed'), copy: parsed.message || t('vault.healthChatProbeFailedCopy'), tone: 'warn',
    repair: { tone: 'warn', text: t('vault.repairChatProbeFailed') },
  };
}

function GuidedBody(props: AddKeyFieldShared & {
  page: 1 | 2;
  setPage: (p: 1 | 2) => void;
  mode: 'guided' | 'simple';
  testState: 'idle' | 'running' | 'done' | 'error';
  testResult: VaultLastTest | null;
  testError: string | null;
  onRunTest: () => void;
  /** Drives the page-2 "Test connectivity" enabled-state when kind ===
   *  'oauth' — without an account_id from the broker, there's nothing
   *  to test against. */
  oauthAccountId?: string | null;
  /** Forwarded to OAuthBrokerCard so the parent can advance to page 2
   *  (Test + name) once the broker writes the OAuth session to vault.
   *  Info carries the new row's account_id + display_identity, used by
   *  page 2 to drive vaultApi.test(target='oauth') and default the
   *  alias placeholder. */
  onOauthConnectedChange?: (
    connected: boolean,
    info?: { providerAccountId?: string; displayIdentity?: string },
  ) => void;
  aliasPlaceholder: string;
}) {
  const { t } = useTranslation();
  const health = healthFromResult(props.testState, props.testResult, props.testError, t);
  return (
    <div className={`body-shell${props.mode === 'simple' ? ' simple-mode' : ''}`}>
      <aside className="rail">
        <div className="rail-kicker">{t('vault.guidedSetup')}</div>
        <button
          type="button"
          className={`step${props.page === 1 ? ' active' : ''}`}
          onClick={() => props.setPage(1)}
          title={t('vault.backToStep1')}
        >
          <span className="step-num">1</span>
          <div className="step-body">
            <strong>{t('vault.stepAddCredential')}</strong>
            <span>{t('vault.stepAddCredentialSub')}</span>
          </div>
        </button>
        <button
          type="button"
          className={`step${props.page === 2 ? ' active' : ''}`}
          onClick={() => {
            // Same gate as the footer Next button: page 2 requires a
            // credential to test against. Going back from 2→1 always OK.
            const canAdvance = props.kind === 'api'
              ? (props.secret.length > 0 && props.providers.length > 0)
              : !!props.oauthAccountId;
            if (canAdvance) props.setPage(2);
          }}
          title={
            props.kind === 'api'
              ? t('vault.fillSecretFirst')
              : (props.oauthAccountId ? t('vault.goToTest') : t('vault.finishOAuthFirst'))
          }
        >
          <span className="step-num">2</span>
          <div className="step-body">
            <strong>{t('vault.stepTestAndName')}</strong>
            <span>{t('vault.stepTestAndNameSub')}</span>
          </div>
        </button>
        <div className="rail-note">{t('vault.railNote')}</div>
      </aside>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Page 1 — Add credential. */}
        <section className={`page${props.page === 1 ? ' active' : ''}`}>
          <div className="page-head">
            <div>
              <h1 className="page-title">{t('vault.pageAddCredentialTitle')}</h1>
              <p className="page-copy">{t('vault.pageAddCredentialCopy')}</p>
            </div>
            <span className="status-chip">
              <ShapesIcon className="w-3 h-3" />
              {t('vault.page1of2')}
            </span>
          </div>
          <KindSeg kind={props.kind} setKind={props.setKind} />
          {props.kind === 'api' ? (
            <ApiFields {...props} showAlias={false} />
          ) : (
            <OAuthBrokerCard
              provider={props.oauthProvider}
              onProviderChange={props.setOauthProvider}
              onConnectedChange={props.onOauthConnectedChange}
            />
          )}
        </section>
        {/* Page 2 — Test, then name. */}
        <section className={`page${props.page === 2 ? ' active' : ''}`}>
          <div className="page-head">
            <div>
              <h1 className="page-title">{t('vault.pageTestNameTitle')}</h1>
              <p className="page-copy">{t('vault.pageTestNameCopy')}</p>
            </div>
            <span className="status-chip">
              <ActivityIcon className="w-3 h-3" />
              {t('vault.page2of2')}
            </span>
          </div>
          <div className="card">
            <div className="connectivity-top">
              <div>
                <div className="card-label">
                  <ActivityIcon className="w-3 h-3" />
                  {t('vault.connectivity')}
                </div>
                <p className={`health-title${health.tone ? ' ' + health.tone : ''}`}>{health.title}</p>
                <p className="health-copy">{health.copy}</p>
              </div>
              {(() => {
                // Disable Test connectivity when the inputs can't
                // possibly produce a meaningful probe. Gating differs
                // by kind:
                //   - API key: needs a secret + at least one protocol.
                //   - OAuth:   needs the broker to have minted an
                //              account_id (state='connected') first;
                //              there's no plaintext secret in this flow.
                const isOauth = props.kind === 'oauth';
                const missingSecret = !isOauth && !props.secret.trim();
                const missingProtocols = !isOauth && props.providers.length === 0;
                const cannotRun = isOauth
                  ? !props.oauthAccountId
                  : (missingSecret || missingProtocols);
                const blockReason = isOauth
                  ? (props.oauthAccountId ? '' : t('vault.finishOAuthOnPage1'))
                  : missingSecret && missingProtocols
                    ? t('vault.fillSecretAndProtocolPage1')
                    : missingSecret
                      ? t('vault.fillSecretPage1')
                      : missingProtocols
                        ? t('vault.pickProtocolPage1')
                        : '';
                return (
                  <button
                    type="button"
                    className="btn btn-outline btn-sm flex items-center gap-1"
                    onClick={props.onRunTest}
                    disabled={props.testState === 'running' || cannotRun}
                    title={cannotRun ? blockReason : undefined}
                  >
                    {props.testState === 'running' ? (
                      <>
                        <span className="aikey-spinner" style={{ width: 12, height: 12 }} />
                        {t('vault.testing')}
                      </>
                    ) : props.testState === 'done' || props.testState === 'error' ? (
                      <>
                        <RefreshIcon className="w-3 h-3" />
                        {t('vault.testAgain')}
                      </>
                    ) : (
                      <>
                        <ActivityIcon className="w-3 h-3" />
                        {t('vault.testConnectivity')}
                      </>
                    )}
                  </button>
                );
              })()}
            </div>
          </div>
          <div className="probe-table" aria-label={t('vault.connectivityPhasesAria')}>
            <div className="probe-head">
              <div>{t('vault.probeColPhase')}</div>
              <div>{t('vault.probeColStatus')}</div>
              <div>{t('vault.probeColLatency')}</div>
              <div>{t('vault.probeColProves')}</div>
            </div>
            {PROBE_PHASES.map((p) => {
              const row = probeRowState(p.id, props.testState, props.testResult, t);
              // Localise the per-phase "what it proves" copy. PROBE_PHASES
              // keeps English source strings (code-language rule); the key
              // is derived from the phase id so the data model stays English.
              const provesKey = {
                ping: 'vault.probeProvesPing',
                proxy: 'vault.probeProvesProxy',
                api: 'vault.probeProvesApi',
                chat: 'vault.probeProvesChat',
              }[p.id];
              return (
                <div key={p.id} className={`probe-row${row.tone ? ' ' + row.tone : ''}`} data-phase={p.id}>
                  <div className="probe-phase"><span className="result-dot" />{p.label}</div>
                  <div className="mono">{row.status}</div>
                  <div className="mono">{row.latency}</div>
                  <div className="mono">{t(provesKey)}</div>
                </div>
              );
            })}
          </div>
          <div className={`repair${health.repair.tone ? ' ' + health.repair.tone : ''}`}>
            <LifeBuoyIcon className="w-3.5 h-3.5" />
            <span>{health.repair.text}</span>
          </div>
          <div className="name-strip">
            <div className="form-row">
              <label className="form-label" htmlFor="credential-name">
                <TagIcon className="w-3 h-3" />
                {t('vault.aliasNameShownInVault')}
              </label>
              <input
                id="credential-name"
                type="text"
                className={`field-input${props.flashField === 'alias' ? ' field-input-flash' : ''}`}
                placeholder={props.aliasPlaceholder}
                value={props.alias}
                onChange={(e) => props.setAlias(e.target.value)}
              />
              <span className="form-help">{t('vault.blankUsesGeneratedAlias')}</span>
              {props.testState === 'done' && props.testResult?.status === 'fail' && (
                <span className="risk-line show">
                  <InfoIcon className="w-3 h-3" />
                  {t('vault.testDidNotPass')}
                </span>
              )}
            </div>
          </div>
          {props.err && (
            <span className="text-[12px] font-mono" style={{ color: '#fca5a5' }}>
              {props.err}
            </span>
          )}
        </section>
      </div>
    </div>
  );
}

// ── OAuthBrokerCard (2026-05-23) ─────────────────────────────────────
// Web-driven OAuth login flow (spec §6 + §13.2). Replaces the legacy
// "go run aikey auth login <provider>" CLI hint in the Guided modal so
// users can finish OAuth without leaving the browser.
//
// State machine — five states per spec §10:
//   idle      — waiting for user to click Open <provider> auth
//   opening   — POST /oauth/login Phase-1 in flight
//   awaiting  — auth_url ready; user is authorizing in another tab
//                (Claude: also accepts paste in this state)
//   polling   — Codex auth_code / Kimi device_code; we poll the broker
//                until completed (the user just waits)
//   connected — token landed; provider_account_id + display_identity
//                populated; modal can advance to page 2 / save
//   failed    — terminal; user sees error + can click "Try again"
//
// Provider differential — three flow_types, three step-3 UIs:
//   claude (setup_token): user pastes <code>#<state>, 900ms debounce
//                         submits to POST /oauth/login Phase-2
//   codex  (auth_code):   broker hosts localhost:1455 callback;
//                         web polls GET /oauth/status until completed
//   kimi   (device_code): broker returns user_code + verification_url;
//                         web polls POST /oauth/poll periodically
//
// Why a single component rather than three sibling components: the three
// flows share the rail-step structure and only differ in step-3 widget.
// Branching inside one component keeps the state machine in one place
// and makes "switch provider mid-flow" cheap (resetState() handles it).
//
// Why we DON'T persist anything until the broker says "completed": OAuth
// tokens never live in the browser. The broker writes to vault on its
// own via aikey-proxy (Plan D). Web only displays the result.

const CLAUDE_PASTE_DEBOUNCE_MS = 900; // spec §10.3
const POLL_INTERVAL_MS = 2_000; // Codex / Kimi
const MAX_POLL_ATTEMPTS = 90; // ~3 minutes total

type BrokerState =
  | 'idle'
  | 'opening'
  | 'awaiting'
  | 'polling'
  | 'connected'
  | 'failed';

type CodeStatus = 'waiting' | 'submitting' | 'accepted' | 'failed';

function OAuthBrokerCard(props: {
  provider: string;
  onProviderChange: (v: string) => void;
  /**
   * Fired whenever the internal state machine crosses into / out of the
   * 'connected' terminal. Parent uses it to surface a footer "Next"
   * button once the broker has written the token to vault, so the user
   * can advance to page 2 (Test + name) per spec §4.4 / §5.
   *
   * The second arg carries the broker's `provider_account_id` (the
   * vault row id we just minted) + `display_identity` (the detected
   * email / handle the broker pulled from the OAuth provider). Page 2
   * uses the account_id to drive `vaultApi.test({target:'oauth', id})`,
   * and the identity as the default alias placeholder (spec §13.6).
   */
  onConnectedChange?: (
    connected: boolean,
    info?: { providerAccountId?: string; displayIdentity?: string },
  ) => void;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<BrokerState>('idle');
  const [session, setSession] = useState<OAuthSession | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  // Claude paste flow.
  const [codeInput, setCodeInput] = useState('');
  const [codeStatus, setCodeStatus] = useState<CodeStatus>('waiting');
  const [codeHelp, setCodeHelp] = useState(t('vault.autoSubmitAfterPaste'));

  // Per-provider flow descriptor (spec §13.2). Centralised so step
  // titles / button labels / state text stay in one place when we
  // wire up additional providers later.
  const flowMeta = useMemo(() => {
    const map: Record<string, {
      title: string;
      pill: string;
      step2Title: string;
      step3Title: string;
      openButton: string;
      initialState: string;
      showCodeInput: boolean;
    }> = {
      claude: {
        title: t('vault.claudeFlowTitle'),
        pill: 'setup_token',
        step2Title: t('vault.claudeStep2Title'),
        step3Title: t('vault.claudeStep3Title'),
        openButton: t('vault.openClaudeAuth'),
        initialState: t('vault.requestAuthUrlFromBroker'),
        showCodeInput: true,
      },
      codex: {
        title: t('vault.codexFlowTitle'),
        pill: 'auth_code',
        step2Title: t('vault.codexStep2Title'),
        step3Title: t('vault.codexStep3Title'),
        openButton: t('vault.openCodexAuth'),
        initialState: t('vault.requestAuthUrlFromBroker'),
        showCodeInput: false,
      },
      kimi: {
        title: t('vault.kimiFlowTitle'),
        pill: 'device_code',
        step2Title: t('vault.kimiStep2Title'),
        step3Title: t('vault.kimiStep3Title'),
        openButton: t('vault.openKimiDevicePage'),
        initialState: t('vault.requestDeviceCodeFromBroker'),
        showCodeInput: false,
      },
    };
    return map[props.provider] || map.claude;
  }, [props.provider, t]);

  // Reset everything on provider change — spec §12: switching provider
  // invalidates any in-flight session because broker state is tied to
  // a (provider, session_id) pair.
  useEffect(() => {
    setState('idle');
    setSession(null);
    setErrorText(null);
    setCodeInput('');
    setCodeStatus('waiting');
    setCodeHelp(t('vault.autoSubmitAfterPaste'));
  }, [props.provider, t]);

  // Tell the parent whenever we cross into / out of 'connected'. The
  // token is already in vault at this point — parent uses the signal to
  // surface page 2 (Test + name) per spec §4.4 / §5. We forward the
  // broker's provider_account_id + display_identity so page 2 can drive
  // vaultApi.test by id and default the alias placeholder.
  useEffect(() => {
    const info = state === 'connected'
      ? {
          providerAccountId: session?.account_id,
          displayIdentity: session?.display_identity,
        }
      : undefined;
    props.onConnectedChange?.(state === 'connected', info);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, session?.account_id, session?.display_identity]);

  // Polling loop for Codex (auth_code) / Kimi (device_code).
  useEffect(() => {
    if (state !== 'polling' || !session?.id) return;
    let attempts = 0;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      attempts += 1;
      try {
        const next = props.provider === 'kimi'
          ? await oauthApi.poll({ session_id: session.id })
          : await oauthApi.status(session.id);
        if (cancelled) return;
        // Broker contract: status='success' on completion (types.go:66
        // `pending / success / failed / expired`). Earlier this check
        // expected 'completed' which never matched — OAuth would
        // succeed at the broker but the UI would loop on "正在检测身份…"
        // until poll-attempt timeout. CLI poll path already expected
        // 'success' (aikey-cli commands_auth/mod.rs:590), so the two
        // clients had drifted on the same wire field.
        if (next.status === 'success' && next.account_id) {
          setSession(next);
          setState('connected');
          return;
        }
        if (next.status === 'failed' || next.error) {
          setSession(next);
          setErrorText(next.error?.message || t('vault.authorizationFailed'));
          setState('failed');
          return;
        }
        // pending — schedule the next tick
        if (attempts < MAX_POLL_ATTEMPTS) {
          setTimeout(tick, POLL_INTERVAL_MS);
        } else {
          setErrorText(t('vault.pollTimedOut'));
          setState('failed');
        }
      } catch (e) {
        if (cancelled) return;
        setErrorText((e as Error).message || t('vault.pollingFailed'));
        setState('failed');
      }
    };
    const timer = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state, session?.id, props.provider]);

  // Claude code paste — debounced auto-submit per spec §10.3 (900ms).
  useEffect(() => {
    if (props.provider !== 'claude') return;
    if (!session?.id) return;
    const trimmed = codeInput.trim();
    if (!trimmed) {
      setCodeStatus('waiting');
      setCodeHelp(t('vault.autoSubmitAfterPaste'));
      return;
    }
    setCodeStatus('submitting');
    setCodeHelp(t('vault.submittingCode'));
    const timer = setTimeout(async () => {
      // Validation: code must contain a # separator (`<code>#<state>`).
      // Spec §19.5 — only check for #, not length / charset (real codes
      // contain `_` and `-`).
      if (!trimmed.includes('#')) {
        setCodeStatus('failed');
        setCodeHelp(t('vault.pasteFullCodeState'));
        return;
      }
      try {
        const next = await oauthApi.submitCode({
          session_id: session.id,
          provider: props.provider,
          code: trimmed,
        });
        setSession(next);
        if (next.error || next.status === 'failed') {
          setCodeStatus('failed');
          setCodeHelp(next.error?.message || t('vault.brokerRejectedCode'));
          setErrorText(next.error?.message || t('vault.authorizationFailed'));
          setState('failed');
        } else {
          setCodeStatus('accepted');
          setCodeHelp(t('vault.oauthSessionSavedLocally'));
          setState('connected');
        }
      } catch (e) {
        setCodeStatus('failed');
        const msg = (e as Error).message || t('vault.submissionFailed');
        setCodeHelp(msg);
      }
    }, CLAUDE_PASTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [codeInput, session?.id, props.provider]);

  async function startOAuth() {
    setState('opening');
    setErrorText(null);
    try {
      const next = await oauthApi.start({ provider: props.provider });
      setSession(next);
      // Open the auth URL in a new tab so the user doesn't lose the
      // modal state. Browsers may block popups when the click handler
      // isn't on the synchronous path — but we got here directly from
      // a click, so this should land. If it doesn't, the user can hit
      // Copy URL to paste manually.
      const url = next.auth_url || next.verification_url;
      if (url) {
        window.open(url, '_blank', 'noopener');
      }
      // Pick polling vs paste based on flow_type.
      if (next.flow_type === 'setup_token') {
        setState('awaiting'); // user will paste; effect handles submission
      } else {
        setState('polling'); // Codex / Kimi: web polls broker
      }
    } catch (e) {
      const err = e as Error & { code?: string };
      setErrorText(err.message || t('vault.failedToStartOAuth'));
      setState('failed');
    }
  }

  function copyAuthUrl() {
    const url = session?.auth_url || session?.verification_url;
    if (!url) return;
    navigator.clipboard?.writeText(url).catch(() => {
      // Fallback for non-clipboard contexts — silently ignore.
    });
  }

  // OAuth pulse colour (spec §10.4): warning while in-progress, success
  // on connected, destructive on failed. Drives the dot beside Step 2's
  // state text.
  const pulseColor = state === 'connected'
    ? 'var(--success)'
    : state === 'failed'
      ? 'var(--destructive, #ef4444)'
      : 'var(--warning)';

  // Step-2 state text. Drives the "Ready to start…" → "Creating session…"
  // → "Paste code…" / "Waiting for callback" / "Polling device authorization"
  // → "OAuth connected" copy.
  let stateText = flowMeta.initialState;
  if (state === 'opening') stateText = t('vault.creatingSession');
  else if (state === 'awaiting') stateText = t('vault.pasteCodeAfterAuth');
  else if (state === 'polling' && props.provider === 'codex') stateText = t('vault.waitingForCallback');
  else if (state === 'polling' && props.provider === 'kimi') stateText = t('vault.pollingDeviceAuth');
  else if (state === 'connected') stateText = t('vault.oauthConnectedContinue');
  else if (state === 'failed') stateText = errorText || t('vault.authorizationFailed');

  // Open-button label tri-state (spec §13.4).
  let openButtonLabel = flowMeta.openButton;
  if (state === 'opening') openButtonLabel = t('vault.opening');
  else if (state === 'awaiting' || state === 'polling') openButtonLabel = props.provider === 'kimi' ? t('vault.openDevicePageAgain') : t('vault.openAuthAgain');
  else if (state === 'connected') openButtonLabel = t('vault.oauthConnected');

  // Identity field follows spec §13.5.
  let identity = t('vault.waitingForBrowserSignIn');
  if (state === 'opening' || state === 'awaiting' || state === 'polling') identity = t('vault.detectingIdentity');
  else if (state === 'connected' && session?.display_identity) identity = session.display_identity;

  return (
    <div className="oauth-broker-card">
      <div className="oauth-flow-title">
        <strong>{flowMeta.title}</strong>
        <span className="flow-pill">{flowMeta.pill}</span>
      </div>
      <div className="flow-steps">
        {/* Step 1 — Choose provider */}
        <div className="flow-step">
          <span>1</span>
          <div className="flow-step-body">
            <div className="flow-step-title">{t('vault.chooseOAuthProvider')}</div>
            <div className="flow-step-control">
              <select
                className="field-select"
                value={props.provider}
                onChange={(e) => props.onProviderChange(e.target.value)}
              >
                <option value="claude">claude</option>
                <option value="codex">codex</option>
                <option value="kimi">kimi</option>
              </select>
              <span className="form-help">{t('vault.supportedByLocalBroker')}</span>
            </div>
          </div>
        </div>
        {/* Step 2 — Open auth URL */}
        <div className="flow-step">
          <span>2</span>
          <div className="flow-step-body">
            <div className="flow-step-title">{flowMeta.step2Title}</div>
            <div className="inline-state">
              <span className="pulse" style={{ background: pulseColor }} />
              <span>{stateText}</span>
            </div>
            <div className="flow-step-control" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                className="btn btn-md btn-outline flex items-center gap-1"
                onClick={startOAuth}
                disabled={state === 'opening' || state === 'connected'}
              >
                {state === 'opening' ? (
                  <span className="aikey-spinner" style={{ width: 12, height: 12 }} />
                ) : state === 'connected' ? (
                  <CheckIcon className="w-3 h-3" />
                ) : (
                  <UploadIcon className="w-3 h-3" />
                )}
                {openButtonLabel}
              </button>
              {(state === 'awaiting' || state === 'polling') && (session?.auth_url || session?.verification_url) && (
                <button
                  type="button"
                  className="copy-auth-url"
                  onClick={copyAuthUrl}
                  title={t('vault.copyAuthorizationUrlTitle')}
                >
                  <ClipboardIcon className="w-3 h-3" />
                  {t('vault.copyUrl')}
                </button>
              )}
            </div>
            {props.provider === 'kimi' && state !== 'idle' && session?.user_code && (
              <div className="form-help" style={{ marginTop: 4 }}>
                {t('vault.deviceUserCode')}<span className="font-mono">{session.user_code}</span>
              </div>
            )}
          </div>
        </div>
        {/* Step 3 — paste / wait / approve */}
        <div className="flow-step">
          <span>3</span>
          <div className="flow-step-body">
            <div className="flow-step-title">{flowMeta.step3Title}</div>
            {flowMeta.showCodeInput && (state === 'awaiting' || state === 'polling' || state === 'failed' || state === 'connected') && (
              <>
                <div className="oauth-code-input show">
                  <input
                    type="text"
                    className="field-input mono"
                    placeholder={t('vault.pasteCodeStateFromClaude')}
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value)}
                    disabled={state === 'connected'}
                  />
                  <span className={`code-status ${codeStatus === 'submitting' ? 'loading' : codeStatus === 'accepted' ? 'success' : codeStatus === 'failed' ? 'error' : ''}`}>
                    {codeStatus === 'submitting' && <span className="aikey-spinner" style={{ width: 10, height: 10 }} />}
                    {codeStatus === 'accepted' && <CheckIcon className="w-3 h-3" />}
                    {codeStatus === 'failed' && <XIcon className="w-3 h-3" />}
                    {codeStatus}
                  </span>
                </div>
                <span className="form-help">{codeHelp}</span>
              </>
            )}
            {!flowMeta.showCodeInput && state === 'polling' && (
              <span className="form-help">
                {props.provider === 'codex'
                  ? t('vault.codexPollingHelp')
                  : t('vault.kimiPollingHelp')}
              </span>
            )}
            {state === 'connected' && (
              <span className="form-help" style={{ color: 'var(--success)' }}>
                {t('vault.oauthSavedContinuePage2')}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="form-row">
        <label className="form-label">
          <MailIcon className="w-3 h-3" />
          {t('vault.detectedIdentity')}
        </label>
        <input
          className="field-input"
          value={identity}
          readOnly
          tabIndex={-1}
        />
        <span className="form-help">{t('vault.detectionStartsAfterAuth')}</span>
      </div>
    </div>
  );
}

function OAuthGuide({
  provider,
  onProviderChange,
}: {
  provider: string;
  onProviderChange: (v: string) => void;
}) {
  const cmd = `aikey auth login ${provider}`;
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(cmd).then(done).catch(() => {
        fallbackCopy(cmd);
        done();
      });
    } else {
      fallbackCopy(cmd);
      done();
    }
  };
  return (
    <>
      <div className="form-row">
        <span className="form-label">
          <GlobeIcon className="w-3 h-3" />
          Provider
        </span>
        <SearchableSelect
          value={provider}
          onChange={onProviderChange}
          options={OAUTH_PROVIDER_PRESETS.map((p) => ({ value: p, label: p }))}
          placeholder="Search or type a provider…"
          allowCustom
        />
        <span className="form-help">
          Custom providers are passed verbatim to <span className="font-mono">aikey auth login &lt;provider&gt;</span>.
        </span>
      </div>
      <div
        className="p-3 rounded"
        style={{
          background: 'rgba(56,189,248,0.06)',
          border: '1px solid rgba(56,189,248,0.25)',
        }}
      >
        <div
          className="text-[11px] font-mono mb-2"
          style={{ color: '#7dd3fc' }}
        >
          Run this in your terminal to authorize — the session token lands in your local vault automatically:
        </div>
        <div className="flex items-center gap-2">
          <code
            className="flex-1 p-2 font-mono text-[12px]"
            style={{
              background: 'rgba(0,0,0,0.5)',
              border: '1px solid var(--border)',
            }}
          >
            {cmd}
          </code>
          <button
            type="button"
            className="btn btn-outline text-[11px] px-3 py-1.5 inline-flex items-center gap-1"
            style={
              copied
                ? {
                    borderColor: 'rgba(74,222,128,0.4)',
                    color: '#4ade80',
                    backgroundColor: 'rgba(74,222,128,0.08)',
                  }
                : undefined
            }
            onClick={handleCopy}
          >
            {copied && <CheckIcon className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div
          className="text-[10px] font-mono mt-2"
          style={{ color: 'var(--muted-foreground)' }}
        >
          After login completes, close this dialog — the new OAuth row will appear on next list refresh.
        </div>
      </div>
    </>
  );
}

function fallbackCopy(text: string) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
}

// ── Icon library ─────────────────────────────────────────────────────────

function SvgIcon({
  d,
  className = 'w-3.5 h-3.5',
  style,
}: {
  d: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      className={className}
      style={style}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

// heroicons v2 outline paths
const ICON_EYE =
  'M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178zM15 12a3 3 0 11-6 0 3 3 0 016 0z';
const ICON_EYE_OFF =
  'M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.243 4.243L9.88 9.88';
const ICON_CLIPBOARD =
  'M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184';
const ICON_EDIT =
  'M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10';
const ICON_TRASH =
  'M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0';
const ICON_CHECK = 'M4.5 12.75l6 6 9-13.5';
const ICON_X = 'M6 18L18 6M6 6l12 12';
const ICON_MAIL =
  'M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75';
const ICON_INFO =
  'M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z';
const ICON_WRENCH =
  'M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z';
const ICON_KEY_ROUND =
  'M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z';
const ICON_KEY =
  'M21 7.5l-2.25-2.25m0 0L16.5 3m2.25 2.25L16.5 7.5m2.25-2.25v6.75a2.25 2.25 0 01-2.25 2.25h-1.5M5.25 6H3m6 3.75l-6 6m0 0l2.25 2.25m-2.25-2.25l2.25-2.25m0 0L9 13.5m2.25 6.75h6a2.25 2.25 0 002.25-2.25V16.5';
const ICON_LOCK =
  'M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z';
const ICON_LOCK_OPEN =
  'M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z';
const ICON_SHIELD_CHECK =
  'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z';
const ICON_SEARCH =
  'M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z';
const ICON_PLUS = 'M12 4.5v15m7.5-7.5h-15';
const ICON_PLUS_CIRCLE =
  'M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z';
const ICON_UPLOAD =
  'M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5';
const ICON_REFRESH =
  'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99';
const ICON_ROTATE =
  'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99';
const ICON_BOOK_OPEN =
  'M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25';
const ICON_LIFE_BUOY =
  'M16.712 4.33a9.027 9.027 0 011.652 1.306c.51.51.944 1.064 1.306 1.652M16.712 4.33l-3.448 4.138m3.448-4.138a9.014 9.014 0 00-9.424 0M19.67 7.288l-4.138 3.448m4.138-3.448a9.014 9.014 0 010 9.424m-4.138-5.976a3.736 3.736 0 00-.88-1.388 3.737 3.737 0 00-1.388-.88m2.268 2.268a3.765 3.765 0 010 2.528m-2.268-4.796a3.765 3.765 0 00-2.528 0m4.796 4.796c-.181.506-.475.982-.88 1.388a3.736 3.736 0 01-1.388.88m2.268-2.268l4.138 3.448m0 0a9.027 9.027 0 01-1.306 1.652c-.51.51-1.064.944-1.652 1.306m0 0l-3.448-4.138m3.448 4.138a9.014 9.014 0 01-9.424 0m5.976-4.138a3.765 3.765 0 01-2.528 0m0 0a3.736 3.736 0 01-1.388-.88 3.737 3.737 0 01-.88-1.388m2.268 2.268L7.288 19.67m0 0a9.024 9.024 0 01-1.652-1.306 9.027 9.027 0 01-1.306-1.652m0 0l4.138-3.448M4.33 16.712a9.014 9.014 0 010-9.424m4.138 5.976a3.765 3.765 0 010-2.528m0 0c.181-.506.475-.982.88-1.388a3.736 3.736 0 011.388-.88m-2.268 2.268L4.33 7.288m6.406 1.18L7.288 4.33m0 0a9.024 9.024 0 00-1.652 1.306A9.025 9.025 0 004.33 7.288';
const ICON_CHEVRON_LEFT = 'M15.75 19.5L8.25 12l7.5-7.5';
const ICON_CHEVRON_RIGHT = 'M8.25 4.5l7.5 7.5-7.5 7.5';
const ICON_CHEVRON_DOWN = 'M19.5 8.25l-7.5 7.5-7.5-7.5';
const ICON_ZAP = 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z';
/* heroicons v2 "play" — filled triangle used for the shell-command hint
   ("Run `claude` in any terminal ..."), visually distinct from ZapIcon
   so the two hint lines read as different actions. */
const ICON_PLAY =
  'M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347c-.75.412-1.667-.13-1.667-.986V5.653z';
const ICON_USER_CHECK =
  'M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z';
/* heroicons v2 "users" — three-figure cluster used for the Team filter
   pill + Team kind chip (Phase 3A-2). Visually distinct from
   ICON_USER_CHECK (single user) so the two type filters don't collide. */
const ICON_USERS =
  'M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z';
const ICON_SHAPES =
  'M6.429 9.75L2.25 12l4.179 2.25m0-4.5l5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L21.75 12l-4.179 2.25m0 0l4.179 2.25L12 21.75 2.25 16.5l4.179-2.25m11.142 0l-5.571 3-5.571-3';
const ICON_TAG =
  'M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z';
const ICON_GLOBE =
  'M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418';
const ICON_LINK =
  'M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244';
// Lucide-style ECG/heartbeat line — used for the "Test connection"
// action so the icon reads as "live signal / health probe" without
// inventing new visual language.
const ICON_ACTIVITY =
  'M22 12h-4l-3 9L9 3l-3 9H2';

function EyeIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_EYE} {...p} />; }
function EyeOffIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_EYE_OFF} {...p} />; }
function ClipboardIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_CLIPBOARD} {...p} />; }
function EditIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_EDIT} {...p} />; }
function TrashIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_TRASH} {...p} />; }
function CheckIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_CHECK} {...p} />; }
function XIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_X} {...p} />; }
function MailIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_MAIL} {...p} />; }
function InfoIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_INFO} {...p} />; }
function WrenchIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_WRENCH} {...p} />; }
function KeyRoundIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_KEY_ROUND} {...p} />; }
function KeyIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_KEY} {...p} />; }
function LockIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_LOCK} {...p} />; }
function LockOpenIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_LOCK_OPEN} {...p} />; }
function ShieldCheckIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_SHIELD_CHECK} {...p} />; }
function SearchIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_SEARCH} {...p} />; }
function PlusIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_PLUS} {...p} />; }
function PlusCircleIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_PLUS_CIRCLE} {...p} />; }
function UploadIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_UPLOAD} {...p} />; }
function RefreshIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_REFRESH} {...p} />; }
function RotateIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_ROTATE} {...p} />; }
function BookOpenIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_BOOK_OPEN} {...p} />; }
function LifeBuoyIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_LIFE_BUOY} {...p} />; }
function ChevronLeftIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_CHEVRON_LEFT} {...p} />; }
function ChevronRightIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_CHEVRON_RIGHT} {...p} />; }
function ChevronDownIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_CHEVRON_DOWN} {...p} />; }
function ZapIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_ZAP} {...p} />; }
function PlayIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_PLAY} {...p} />; }
function UserCheckIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_USER_CHECK} {...p} />; }
function UsersIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_USERS} {...p} />; }
function ShapesIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_SHAPES} {...p} />; }
function TagIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_TAG} {...p} />; }
function GlobeIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_GLOBE} {...p} />; }
function LinkIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_LINK} {...p} />; }
function ActivityIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_ACTIVITY} {...p} />; }

// ── CSS ──────────────────────────────────────────────────────────────────
// Phase 3B (2026-05-11): VAULT_CSS extracted to a shared module so the
// virtual-keys page (canonical Team Keys page on B server) can render
// identical chip / pill / table / drawer / toast styles by mounting
// `.vault-page` on its outer wrapper and rendering the same <style>.
// Source of truth: pages/user/_shared/keys-page-css.ts.
import { KEYS_PAGE_CSS } from '../_shared/keys-page-css';
import { VAULT_PAGE_SKIN_V1 } from '../_shared/vault-page-skin';
const VAULT_CSS = KEYS_PAGE_CSS;
