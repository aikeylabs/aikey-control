/**
 * Compliance Audit (self view) — /user/compliance
 *
 * Phase 3 (2026-06-02). The LOCAL counterpart to the master/team audit page:
 * shows the compliance events detected on THIS machine for the local user.
 * No tenant (single-user) — loads immediately. Filters: severity / category /
 * action. Row click → detail drawer with per-finding metadata + snippet.
 * Offset pagination.
 *
 * Snippet visibility (2026-08-09 用户拍板, reversing the 2026-06-03 decision):
 * the list and the drawer show the MASKED snippet (`redacted_snippet`) by
 * default; the un-redacted `context_snippet` sits behind a per-finding eye
 * toggle. Rationale: on your OWN machine, a masked `***CN_NAME***` cannot tell
 * you which of your own values tripped the rule, which is the entire point of a
 * self-view. DC5 is 「原文不出**客户信任边界**」, not 「原文不可见」 — on THIS page
 * (the Personal local lane) the data never left the box (local-server on
 * 127.0.0.1) and is purged after 30 days.
 *
 * 🔴 2026-08-11 — DC5 was 「原文不出本机」 until the user overturned it. The
 * detector's `mayCarryRawSnippet` is now TIERED: `team === false` still means
 * `ictx.LocalIntake` (this page, unchanged), but `team === true` means
 * `ictx.PrivacyTier >= 3`, and the master intake wire NOW DECLARES
 * `context_snippet`. So "the master wire has no such field at all" is no longer
 * a thing to reason from anywhere in this file.
 *
 * Structure mirrors aikey-control-master/web .../master/compliance/audit so the
 * two views stay visually consistent; the only differences are: no tenant
 * prompt/column, and the FilterBar search box is repurposed for the category
 * filter (there's no tenant to search).
 */
import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { complianceApi, type ComplianceEventDTO, type ComplianceFindingDTO } from '@/shared/api/user/compliance';
import { derivePasswordTier } from './password-tier-state';
import { appsApi } from '@/shared/api/user/apps';
import { Badge } from '@/shared/ui/Badge';
import { PageHeader } from '@/shared/ui/PageHeader';
import { InfoHint } from '@/shared/ui/InfoHint';
import { Pagination, useStoredPageSize } from '@/shared/ui/Pagination';
import { formatDateTime } from '@/shared/utils/datetime-intl';
// Mask-token highlighting is shared with the master audit + triage drawers —
// one regex, three pages (see mask-highlight.tsx for why).
import {
  renderMaskedSnippet,
  resolveWireLabelFocus,
  // The box those spans sit in — shared for the same reason the regex is
  // (2026-08-11): the masked and the revealed state must be the SAME box.
  SNIPPET_BOX_CLASS,
  snippetBoxStyle,
} from '@/shared/utils/mask-highlight';
import { engineLoadBadge, engineLoadStateIsUnreadable } from './engine-load-state';
import { DetailDrawer, DrawerField } from '@/shared/ui/DetailDrawer';
import { FilterTokenBar, type FilterToken, type FilterTokenDimension } from '@/shared/ui/FilterTokenBar';
import { complianceEntityTypeOptions } from '@/shared/compliance/entity-types';
import { PageQueryErrors } from '@/shared/components/PageQueryErrors';
import {
  COMPLIANCE_ACTION_SUMMARY_ACTIONS,
  COMPLIANCE_ACTION_SUMMARY_COLOR,
  COMPLIANCE_ACTION_SUMMARY_LABEL_KEY,
  complianceActionBadgeVariant,
  complianceActionFilterOptions,
} from '@/shared/compliance/action-taken';

const PAGE_SIZE = 15;

function severityVariant(s: string): 'red' | 'yellow' | 'green' | 'gray' {
  switch (s) {
    case 'critical': return 'red';
    case 'high': return 'yellow';
    case 'medium': return 'gray';
    default: return 'gray';
  }
}

// Action chip styling, the action filter and the summary cards all come from
// the shared value domain (@/shared/compliance/action-taken), which is fenced
// against the database CHECK constraint. This page used to carry its own
// four-case switch ending in `default: return 'green'`, which painted the
// `audit` outcome — "we detected something and forwarded it anyway" — in
// allow's green, i.e. as "nothing matched" (2026-08-10).
const actionVariant = complianceActionBadgeVariant;

// Reveal toggle — lucide "eye" / "eye-off", inlined with the SAME path data as
// pages/user/access-tokens (this app's other reveal control) and the master
// console's compliance-audit + orgs/agents twins. One glyph for "show me what is
// hidden" everywhere in both consoles; no icon-library dep. Keep byte-identical.
function EyeIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.06 12.35a1 1 0 010-.7 10.75 10.75 0 0119.88 0 1 1 0 010 .7 10.75 10.75 0 01-19.88 0z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.73 5.08a10.74 10.74 0 0111.21 6.57 1 1 0 010 .7 10.75 10.75 0 01-1.45 2.49" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.08 14.16a3 3 0 01-4.24-4.24" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.48 17.5a10.75 10.75 0 01-15.42-5.15 1 1 0 010-.7 10.75 10.75 0 014.45-5.14" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2 2l20 20" />
    </svg>
  );
}

const SEV_RANK: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };
function topSeverity(e: ComplianceEventDTO): string {
  let top = '';
  for (const f of e.findings) {
    if (top === '' || (SEV_RANK[f.severity] ?? -1) > (SEV_RANK[top] ?? -1)) top = f.severity;
  }
  return top;
}

// Locked timestamp (YYYY-MM-DD HH:mm:ss) so the audit time reads the same
// regardless of browser locale — cleaner than locale toLocaleString().
function fmtTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const COMPLIANCE_SLUG = 'ai-compliance-detector';

// Pluggable data source so this exact page (full UI: masked-snippet column, pill
// badges, summary cards, packs drawer, detail drawer) is reused verbatim by BOTH
// the Personal local self-view AND the team-server member self-view. Only the
// data source differs (2026-06-12 用户需求: 完全复用, 仅数据只看自己).
//   - Personal (A side): LOCAL_SOURCE below — local-server endpoints + app toggle.
//   - Team member (master /user/compliance): injects member-scoped endpoints +
//     filterControl:undefined → switch renders read-only "企业已强制开启".
export interface ComplianceFilterControl {
  probe: () => Promise<{ installed: boolean; enabled: boolean; locked: boolean }>;
  set: (next: boolean) => Promise<{ enabled: boolean }>;
}
export interface ComplianceViewSource {
  listEvents: typeof complianceApi.listEvents;
  getEffectivePacks: typeof complianceApi.getEffectivePacks;
  /** undefined = org-enforced read-only (team member can't toggle org compliance). */
  filterControl?: ComplianceFilterControl;
  titleKey: string;
  /**
   * The FULL page description. For the local lane this is a privacy DISCLOSURE
   * whose exact content is mandated by `shared/i18n/privacy-claim-scope.test.ts`
   * (2026-08-11): it must state that the snippet IS uploaded on Team/Cluster,
   * that a fresh install already permits it, that the destination is the org's
   * own server, and that conversation audit is a separate lane. It is long by
   * requirement, not by accident — do not shorten it to fix a layout.
   */
  descriptionKey: string;
  /**
   * Optional one-line headline shown in the header INSTEAD of `descriptionKey`
   * (2026-09-04, user request "顶部文案简化到一行以内"). When set, the full
   * `descriptionKey` text moves into an InfoHint beside the title — it is still
   * rendered, one interaction away, never dropped. Omit it and the full text
   * stays in the header exactly as before.
   *
   * 🔴 The disclosure must remain REACHABLE on the page. privacy-claim-scope
   * only checks the i18n CATALOG, so deleting the hint would leave that fence
   * green while the notice silently disappeared — `disclosure-reachable.test.ts`
   * is the fence that covers the render side.
   */
  descriptionShortKey?: string;
  /**
   * i18n key for the note rendered in place of the eye when a finding carries no
   * un-redacted original text. REQUIRED (not defaulted) because the REASON is
   * lane-specific and getting it wrong actively misleads:
   *
   *   - LOCAL lane  — raw text IS normally stored here; absence means the event
   *     predates the 2026-08-09 reveal decision, so "upgrade the detector" is
   *     genuinely the fix.
   *   - TEAM lane   — raw text may or may not be present, and the reason is
   *     never "which detector build ran". 🔴 2026-08-11: it used to be NEVER
   *     present (gate was `LocalIntake && !team`, master had no column). Now the
   *     gate is `ictx.PrivacyTier >= 3` on the team branch and master stores the
   *     column, so presence tracks the ORG'S POLICY — a fresh Team/Cluster
   *     install seeds tier 3, an upgraded one stays at 1 until an admin raises
   *     it, and the snippet is cleared after 90 days regardless.
   *     Telling a team member to upgrade the detector still sends them on a fix
   *     that cannot work — the lever is on the server, not on their machine —
   *     so the 2026-08-10 bug this field exists to prevent is unchanged, only
   *     its explanation is.
   *
   * 🔴 The discriminator is THIS INJECTED SOURCE, never `runtimeConfig.authMode`:
   * the unified-origin gateway patches forwarded team pages to
   * `authMode:'local_bypass'`, so at runtime a team page is indistinguishable
   * from a local one. See principles/gateway-local-bypass-masquerade.md.
   */
  originalUnavailableKey: string;
  /**
   * TEAM lane only — where the eye's text comes from when it does NOT come from
   * `context_snippet`.
   *
   * WHY THIS IS AN INJECTED SOURCE AND NOT A BRANCH IN THIS FILE
   * ------------------------------------------------------------
   * The two lanes answer "show me the original" from two different stores, and
   * the difference is not cosmetic:
   *
   *   - LOCAL — the detector kept the un-redacted window ON THE FINDING
   *     (`context_snippet`). It is the matched span, it is already in the row
   *     this page rendered, and revealing it costs nothing and records nothing.
   *   - TEAM  — no such column exists. The text lives in conversation_records on
   *     the team server, and reaching it is a per-event server round trip that
   *     is RECORDED (one revealed original = one access record). It is also the
   *     WHOLE TURN, not the matched span, because the finding's byte offsets and
   *     the stored turn text are in different coordinate systems.
   *
   * So this page owns only what is common — the per-finding eye control, its
   * open/closed state, and the "there is nothing to reveal" note — and the lane
   * owns the fetch, the eight can't-show-it reasons, and the copy that says what
   * the reader is looking at. Undefined ⇒ the local lane's `context_snippet`
   * behaviour, unchanged.
   *
   * 🔴 The lane is decided by THIS field, never by `runtimeConfig.authMode`: the
   * unified-origin gateway patches forwarded team pages to 'local_bypass', so at
   * runtime a team page looks exactly like a local one
   * (principles/gateway-local-bypass-masquerade.md).
   */
  originalTurn?: ComplianceOriginalTurnSource;
}

/** See ComplianceViewSource.originalTurn for why this indirection exists. */
export interface ComplianceOriginalTurnSource {
  /**
   * Can this event's original be revealed at all? false ⇒ NO eye is rendered
   * and `originalUnavailableKey` is shown instead.
   *
   * 🔴 Not just tidiness: on the team lane the reveal is a recorded read, so an
   * eye offered when we already know the answer is empty would stamp the access
   * trail with reads that revealed nothing — inflating exactly the record that
   * answers "who read whose conversations". A dead button is also worse than no
   * button.
   */
  canReveal: (event: ComplianceEventDTO) => boolean;
  /**
   * Rendered inside the expanded eye. Owns the fetch, the状态 copy, and — because
   * what it shows is the whole turn rather than the matched span — the caption
   * that says so.
   */
  Panel: (props: { event: ComplianceEventDTO }) => ReactNode;
}

/**
 * SINGLE EXIT for "can this finding's original text be revealed?".
 *
 * Two callers need the same answer and must never drift: the per-finding eye
 * (below) and the event-level "why is there no original here" note (also below,
 * rendered once per drawer). Spelling the lane dispatch twice is how the two
 * would end up disagreeing — the note claiming there is nothing to see while an
 * eye sits right above it.
 *
 * Lane dispatch, unchanged:
 *   - TEAM  (`source.originalTurn` injected) — the answer is a property of the
 *     EVENT (the conversation turn is fetched per event, and the read is
 *     RECORDED), so `finding` is not consulted at all.
 *   - LOCAL (no injected source) — the answer is the finding's own
 *     `context_snippet`, which the detector attaches per finding.
 *
 * 🔴 The lane comes from the injected source, NEVER from `runtimeConfig.authMode`
 * (principles/gateway-local-bypass-masquerade.md).
 */
function canRevealOriginal(
  source: ComplianceViewSource,
  event: ComplianceEventDTO,
  finding: ComplianceFindingDTO,
): boolean {
  return source.originalTurn ? source.originalTurn.canReveal(event) : !!finding.context_snippet;
}

const LOCAL_SOURCE: ComplianceViewSource = {
  listEvents: complianceApi.listEvents,
  getEffectivePacks: complianceApi.getEffectivePacks,
  filterControl: {
    probe: async () => {
      const list = await appsApi.list();
      if (!list.apps.some((a) => a.slug === COMPLIANCE_SLUG)) {
        return { installed: false, enabled: false, locked: false };
      }
      const s = await appsApi.filterStatus(COMPLIANCE_SLUG);
      return { installed: true, enabled: s.enabled, locked: s.locked ?? false };
    },
    set: (next) => appsApi.filterSet(COMPLIANCE_SLUG, next),
  },
  titleKey: 'compliancePage.pageTitle',
  descriptionKey: 'compliancePage.pageDescription',
  descriptionShortKey: 'compliancePage.pageDescriptionShort',
  // Local lane: raw text is normally kept on this box, so an absence really is
  // "recorded before the reveal decision / by an older detector" and upgrading
  // the detector really does fix it.
  originalUnavailableKey: 'compliancePage.originalUnavailable',
};

/**
 * The LOCAL lane's "no original text" note key, DERIVED from LOCAL_SOURCE —
 * exported (2026-09-03) so the team wrapper's this-machine scope can point at
 * the local lane's own key without re-typing the literal. Two fences shape
 * this: snippet-reveal.test.ts R3 (the literal must appear exactly once in
 * this file, inside LOCAL_SOURCE) and the master repo's
 * team-lane-original-note.test.ts (the wrapper must not carry the literal at
 * all — a literal there is how the 2026-08-10 wrong-lane note happened).
 */
export const LOCAL_ORIGINAL_UNAVAILABLE_KEY: string = LOCAL_SOURCE.originalUnavailableKey;

/**
 * `headerExtra` (2026-09-03): an optional node rendered at the head of the
 * page-header actions, BEFORE the detection switch. The team wrapper uses it
 * for a team / this-machine scope switch — the gateway-forwarded team page
 * reads master's member endpoint, while events from personal / custom-provider
 * routes live only in the local store, so without a switch those records had
 * no UI at all (winpc2 report 2026-09-03, "compliance page shows nothing" while
 * the local API held 9 mask events). A prop rather than a source field because
 * it is presentation the wrapper owns, not data the page reads.
 */
export default function ComplianceSelfViewPage({ source = LOCAL_SOURCE, headerExtra }: { source?: ComplianceViewSource; headerExtra?: ReactNode } = {}) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selected, setSelected] = useState<ComplianceEventDTO | null>(null);
  const [offset, setOffset] = useState(0);
  // User-selectable page size (global localStorage preference, 2026-07-29);
  // doubles as the wire `limit`, so it must be part of the queryKey.
  const [pageSize, setPageSize] = useStoredPageSize(PAGE_SIZE);
  const [packsOpen, setPacksOpen] = useState(false);
  // Per-finding "show the un-redacted text" toggles, keyed by finding_id.
  // Deliberately NOT persisted and reset whenever the drawer opens another
  // event: revealing raw text should be a per-look decision, never a sticky
  // preference that quietly un-masks every event you open afterwards.
  const [revealedFindings, setRevealedFindings] = useState<Set<string>>(new Set());
  function toggleReveal(findingId: string) {
    setRevealedFindings((prev) => {
      const next = new Set(prev);
      if (next.has(findingId)) next.delete(findingId);
      else next.add(findingId);
      return next;
    });
  }
  function openEvent(e: ComplianceEventDTO | null) {
    setRevealedFindings(new Set());
    setSelected(e);
  }

  // ── Compliance master switch (feature on/off) ────────────────────────────
  // Reuses the app filter enable/disable: filter_stages NULL = off, set = on;
  // the CLI bumps vault change_seq → the local proxy reloads within ~5s and
  // spawns / kills the detector child. Mirrors the toggle in /user/settings
  // (2nd usage — replicate the pattern, don't abstract prematurely). G3 adds
  // the master-policy `locked` state (org-mandated on → can't disable here).
  const [filterState, setFilterState] = useState<
    { kind: 'loading' } | { kind: 'not-installed' } | { kind: 'ready'; enabled: boolean; locked: boolean } | { kind: 'error' }
  >({ kind: 'loading' });
  const [filterSaving, setFilterSaving] = useState(false);
  const [filterMsg, setFilterMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // No filterControl = team member self-view: org compliance is enforced and
      // not member-toggleable → render the switch read-only "已强制开启" (locked).
      if (!source.filterControl) {
        if (!cancelled) setFilterState({ kind: 'ready', enabled: true, locked: true });
        return;
      }
      try {
        const st = await source.filterControl.probe();
        if (cancelled) return;
        setFilterState(st.installed
          ? { kind: 'ready', enabled: st.enabled, locked: st.locked }
          : { kind: 'not-installed' });
      } catch {
        if (!cancelled) setFilterState({ kind: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, [source]);

  async function onToggleFilter(next: boolean) {
    if (filterState.kind !== 'ready' || filterSaving || filterState.locked) return;
    if (!source.filterControl) return; // enforced read-only (team member)
    setFilterSaving(true);
    setFilterMsg('');
    try {
      const res = await source.filterControl.set(next);
      setFilterState({ kind: 'ready', enabled: res.enabled, locked: false });
    } catch (err) {
      const e = err as Error & { code?: string };
      setFilterMsg(
        e.code === 'I_APP_COMPLIANCE_LOCKED'
          ? t('compliancePage.toggleOrgEnforced')
          : e.code === 'I_VAULT_LOCKED' || e.code === 'I_VAULT_NO_SESSION'
          ? t('compliancePage.toggleLocked')
          : (e.message ?? t('compliancePage.toggleFailed')),
      );
    } finally {
      setFilterSaving(false);
    }
  }

  const severity = searchParams.get('severity') ?? '';
  const category = searchParams.get('category') ?? '';
  const action = searchParams.get('action') ?? '';
  const entityType = searchParams.get('entity_type') ?? '';

  // ── Aggregated token filter (2026-08-11 user request) ─────────────────────
  // Replaces the FilterBar severity-select + action-select + category-input
  // row with the same FilterTokenBar the master twin uses — this file's header
  // states the two views are kept structurally aligned, and after the master
  // side moved (2026-07-29) this page was the last one still showing three
  // different filter idioms on one row.
  //
  // All three are SERVER params (they ride the listEvents query, not an
  // in-memory filter), so the token set is the URL: one source of truth,
  // shareable, and refresh-safe. `setOffset(0)` stays wired to every filter
  // change — paging into offset 40 and then narrowing the filter to 12 rows
  // would otherwise show an empty page.
  const COMPLIANCE_FILTER_PARAMS = ['severity', 'action', 'category', 'entity_type'] as const;
  const filterTokens: FilterToken[] = COMPLIANCE_FILTER_PARAMS.flatMap((param) => {
    const v = searchParams.get(param);
    return v ? [{ key: param, value: v }] : [];
  });
  function setFilterTokens(next: FilterToken[]) {
    setOffset(0);
    setSearchParams((prev) => {
      // One atomic rewrite of the filter params — a per-param update would
      // rebuild from the same pre-click snapshot and re-add what another
      // deleted. Params NOT in the list (page size, forward-compat keys) are
      // preserved by starting from `prev`.
      const sp = new URLSearchParams(prev);
      for (const param of COMPLIANCE_FILTER_PARAMS) sp.delete(param);
      for (const tk of next) sp.set(tk.key, tk.value);
      return sp;
    }, { replace: true });
  }

  const { data, isLoading, isError } = useQuery({
    // source.titleKey in the key (2026-09-03): the team wrapper now SWAPS the
    // injected source (team server / this machine) at runtime. Without a
    // source discriminator the key is identical across the swap, and
    // react-query would keep serving the other ledger's cached page instead of
    // refetching — a silent wrong-ledger view, the exact confusion the switch
    // exists to end. titleKey is distinct per source and already on the object.
    queryKey: ['compliance-self', source.titleKey, { severity, category, action, entityType, offset, pageSize }],
    queryFn: () => source.listEvents({
      severity: severity || undefined,
      category: category || undefined,
      action: action || undefined,
      entity_type: entityType || undefined,
      limit: pageSize,
      offset,
    }),
  });

  const events = data?.events ?? [];
  const total = data?.total ?? 0;

  // Effective packs (built-in + server-distributed) — lazily fetched when the
  // drawer opens. Relayed local-server → proxy → live detector IPC.
  const packsQuery = useQuery({
    queryKey: ['compliance-packs', source.titleKey],
    queryFn: () => source.getEffectivePacks(),
    enabled: packsOpen,
  });
  const packsReport = packsQuery.data?.available ? packsQuery.data.report : undefined;
  // Password-lane level — single exit in password-tier-state.ts (fenced there):
  // absent/unknown ⇒ undefined ⇒ the drawer renders nothing for it.
  const passwordTier = derivePasswordTier(packsReport);

  // Per-action breakdown, rendered inline in the table header (2026-08-11 user
  // decision: 「概况挪到表头位置，折叠展开不需要了」).
  //
  // 🔴 The expand/collapse and its four big stat cards are GONE, and nothing was
  // lost with them: the expanded grid showed the same four numbers the collapsed
  // strip already printed inline, plus a 总计 card duplicating the record-count
  // chip that sits in this very header. Two rows became one and a click became
  // zero.
  //
  // Counts reuse the existing list endpoint with an `action` override (limit:1,
  // read total) — accurate across ALL matching rows, not just the current page,
  // and no new backend. They deliberately do NOT carry the `action` filter, so
  // the breakdown keeps answering "how do this filter's events split by
  // outcome" even while one outcome is selected.
  const countQ = (act: string | undefined, key: string) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useQuery({
      // 🔴 Carries every filter EXCEPT `action` — that is the axis being broken
      // down. entity_type included (2026-08-11): without it, filtering to
      // CN_PHONE would narrow the table while the header still counted every
      // event, and a breakdown that disagrees with the rows under it is read as
      // a bug in the numbers.
      queryKey: ['compliance-count', key, { severity, category, entityType }],
      queryFn: () => source.listEvents({
        severity: severity || undefined,
        category: category || undefined,
        entity_type: entityType || undefined,
        action: act,
        limit: 1,
        offset: 0,
      }),
    });
  // One count per action, driven off the shared module constant so a new action
  // can never be missing from the breakdown — and so the number and order of
  // these useQuery calls is fixed across renders (rules-of-hooks).
  const summaryCards = COMPLIANCE_ACTION_SUMMARY_ACTIONS.map((action) => ({
    label: t(COMPLIANCE_ACTION_SUMMARY_LABEL_KEY[action]),
    q: countQ(action, action),
    color: COMPLIANCE_ACTION_SUMMARY_COLOR[action],
  }));

  const filterDimensions: FilterTokenDimension[] = useMemo(() => [
    {
      key: 'severity',
      label: t('compliancePage.dimSeverity'),
      options: [
        { value: 'critical', label: t('compliancePage.sevCritical') },
        { value: 'high', label: t('compliancePage.sevHigh') },
        { value: 'medium', label: t('compliancePage.sevMedium') },
        { value: 'low', label: t('compliancePage.sevLow') },
      ],
    },
    {
      key: 'action',
      label: t('compliancePage.dimAction'),
      // Whole domain by construction — a hand-listed subset is how `audit`
      // became unfilterable, and an operator reads an empty filter result as
      // "it never happened". 🔴 No leading `{ value: '' }` entry any more:
      // clearing a token is removing the chip, so an "all actions" OPTION
      // would be a second way to express the same state.
      options: complianceActionFilterOptions(t, 'compliancePage'),
    },
    // Category is a free server param (e.g. "credential") with no enumerable
    // option source, so it stays pure free text — exactly as on the master
    // twin. That is also what the old search box was repurposed for.
    { key: 'category', label: t('compliancePage.dimCategory'), options: [], freeText: true },
    {
      key: 'entity_type',
      label: t('compliancePage.dimEntityType'),
      // Option C (2026-08-11 user decision): value = stored entity_type, label
      // = 「ADDR (CN_ADDRESS)」. freeText keeps a newly-shipped entity type
      // reachable even before this table lists it.
      options: complianceEntityTypeOptions(),
      freeText: true,
    },
  ], [t]);

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title={t(source.titleKey)}
        description={t(source.descriptionShortKey ?? source.descriptionKey)}
        titleHint={
          source.descriptionShortKey ? (
            <InfoHint label={t(source.titleKey)} testId="compliance-disclosure">
              {t(source.descriptionKey)}
            </InfoHint>
          ) : undefined
        }
        actions={
          <div className="flex items-center gap-3">
            {headerExtra}
            {/* Feature master switch — distinct from the pack-level info (layered:
                whole-detection on/off here, which packs are effective in the drawer). */}
            {filterState.kind === 'ready' && (
              <div className="flex items-center gap-2">
                {/* Locked by org policy (G3): a lock note explains the org mandate
                    force-runs the detector; the switch is also greyed + disabled. */}
                {filterState.locked && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ color: 'var(--muted-foreground)', backgroundColor: 'var(--border)' }} title={t('compliancePage.toggleOrgEnforced')}>
                    🔒 {t('compliancePage.toggleOrgEnforcedShort')}
                  </span>
                )}
                {/* Pill toggle — mirrors the Trust Check (置信度检测) realtime toggle
                    (.tc-realtime-toggle in trust-check/trust-check-css.ts) for
                    cross-page consistency: same pill + track/knob/label structure +
                    exact values. Keep the two in sync if either changes. */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={filterState.enabled}
                  aria-label={t('compliancePage.toggleLabel')}
                  disabled={filterSaving || filterState.locked}
                  title={filterState.locked ? t('compliancePage.toggleOrgEnforced') : undefined}
                  onClick={() => onToggleFilter(!filterState.enabled)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    padding: '6px 12px 6px 8px', borderRadius: 6,
                    background: 'var(--surface-sunken)', border: '1px solid var(--border)',
                    color: 'var(--foreground)', fontSize: 12,
                    fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)",
                    fontWeight: 600, letterSpacing: '0.04em',
                    cursor: filterState.locked ? 'not-allowed' : filterSaving ? 'wait' : 'pointer',
                    opacity: filterSaving || filterState.locked ? 0.5 : 1,
                    transition: 'background 120ms ease, border-color 120ms ease',
                  }}
                >
                  <span aria-hidden style={{
                    position: 'relative', display: 'inline-block', width: 28, height: 16,
                    background: filterState.enabled ? 'var(--primary-dim)' : 'var(--surface-inset)',
                    borderRadius: 999, flexShrink: 0, transition: 'background 140ms ease',
                  }}>
                    <span style={{
                      position: 'absolute', top: 2, left: 2, width: 12, height: 12,
                      background: filterState.enabled ? 'var(--primary-foreground, #18181b)' : 'var(--foreground)',
                      borderRadius: '50%',
                      transform: filterState.enabled ? 'translateX(12px)' : 'none',
                      transition: 'transform 140ms ease',
                    }} />
                  </span>
                  <span style={{
                    fontSize: 11, letterSpacing: '0.06em', whiteSpace: 'nowrap',
                    color: filterState.enabled ? undefined : 'var(--muted-foreground)',
                    opacity: filterState.enabled ? 1 : 0.85,
                  }}>
                    {t('compliancePage.toggleLabel')}
                  </span>
                </button>
              </div>
            )}
            <button
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border text-xs font-mono transition-colors"
              style={{ borderColor: 'rgba(250,204,21,0.35)', color: 'var(--primary-text)', backgroundColor: 'rgba(250,204,21,0.06)' }}
              onClick={() => setPacksOpen(true)}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              {t('effectivePacks.viewButton')}
            </button>
          </div>
        }
      />
      {/* events list error renders in-table (isError row); packsQuery would be silent */}
      <PageQueryErrors sources={[packsQuery.error]} />

      {/* Toggle status line: surface a save error / vault-lock / not-installed
          hint. Quiet when the switch is ready + idle. */}
      {(filterMsg || filterState.kind === 'not-installed') && (
        <div className="text-xs font-mono" style={{ color: filterState.kind === 'not-installed' ? 'var(--muted-foreground)' : '#f87171' }}>
          {filterState.kind === 'not-installed' ? t('compliancePage.toggleNotInstalled') : filterMsg}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="max-w-full">
          <FilterTokenBar
            dimensions={filterDimensions}
            tokens={filterTokens}
            onChange={setFilterTokens}
            // md (2026-08-11 user decision): three short enum dimensions — the
            // lg palette read as oversized for a filter row this sparse.
            size="md"
            // Personal console: match the vault / virtual-keys search box, which is a
            // plain <input> on var(--muted) — one tier lighter than the master
            // console's var(--card) filter row (2026-08-11 user request).
            tone="muted"
          />
        </div>
        {filterTokens.length > 0 && (
          <button
            onClick={() => setFilterTokens([])}
            className="text-xs font-mono px-3 py-2 min-h-[38px] rounded border"
            style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
          >
            {t('compliancePage.reset')}
          </button>
        )}
      </div>

      <div className="rounded-md border overflow-hidden" style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'inset 0 -1px 0 0 var(--border)' }}>
        <div className="px-5 py-4 flex items-center justify-between gap-4" style={{ borderBottom: '1px solid var(--border)' }}>
          {/* 🔴 Title AND breakdown are ONE left-hand group (2026-08-11 user
              decision), matching /user/virtual-keys' card header — there the
              label and its count chips sit together on the left and nothing is
              pushed to the middle. Centring the breakdown (the first attempt)
              made it read as a third, unrelated column.
              🚫 Still no 「概况 · N 条记录」 prefix: the title says what this
              table is and the count is the chip on the right, so printing it
              here would be the same fact three times in one row. */}
          <div className="flex items-center gap-3 min-w-0 overflow-x-auto">
            <h2 className="text-xs font-mono font-bold tracking-wider shrink-0" style={{ color: 'var(--muted-foreground)' }}>{t('compliancePage.sectionTitle')}</h2>
            {summaryCards.map((c) => (
              <span key={c.label} className="shrink-0 whitespace-nowrap text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
                {c.label} <b style={{ color: c.color }}>{c.q.isLoading ? '…' : (c.q.data?.total ?? 0)}</b>
              </span>
            ))}
          </div>
          <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full border shrink-0" style={{ color: 'var(--primary-text)', borderColor: 'rgba(250,204,21,0.35)', backgroundColor: 'rgba(250,204,21,0.06)' }}>
            {t('compliancePage.recordCount', { count: total })}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left border-collapse table-fixed">
            <colgroup>
              <col style={{ width: '16%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '24%' }} />
              <col style={{ width: '41%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead>
              <tr>
                {[
                  'compliancePage.columnTime',
                  'compliancePage.columnAction',
                  'compliancePage.columnFindings',
                  'compliancePage.columnPreview',
                  'compliancePage.columnModel',
                ].map((k) => (
                  <th key={k} className="px-4 py-3 text-[10px] font-mono font-semibold tracking-wider uppercase" style={{ color: 'var(--muted-foreground)', borderBottom: '1px solid var(--border)', backgroundColor: 'rgba(var(--sink-rgb), 0.35)', position: 'sticky', top: 0, zIndex: 1 }}>
                    {t(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>{t('compliancePage.loading')}</td></tr>
              ) : isError ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-xs font-mono" style={{ color: 'var(--destructive-text)' }}>{t('compliancePage.loadFailed')}</td></tr>
              ) : events.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>{t('compliancePage.noEvents')}</td></tr>
              ) : (
                events.map((e) => (
                  <tr key={e.event_id} className="cursor-pointer transition-colors hover:bg-[rgba(250,204,21,0.045)]" style={{ borderBottom: '1px solid var(--border)' }} onClick={() => openEvent(e)}>
                    <td className="px-4 py-3.5 text-xs font-mono" style={{ color: 'var(--foreground)' }}>{fmtTime(e.created_at)}</td>
                    <td className="px-4 py-3.5"><Badge variant={actionVariant(e.action_taken)}>{e.action_taken.toUpperCase()}</Badge></td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {topSeverity(e) && <Badge variant={severityVariant(topSeverity(e))}>{topSeverity(e).toUpperCase()}</Badge>}
                        {[...new Set(e.findings.map((f) => f.category))].map((c) => (
                          <span key={c} className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(var(--lift-rgb), 0.05)', color: 'var(--muted-foreground)' }}>{c}</span>
                        ))}
                        <span className="text-[10px] font-mono tabular-nums" style={{ color: 'var(--muted-foreground)', opacity: 0.75 }}>×{e.findings.length}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      {(() => {
                        const f0 = e.findings[0];
                        // 🔴 MASKED form ONLY — never context_snippet. The invariant the
                        // 2026-08-09 decision rests on is "raw text appears only behind
                        // the eye", and the list has no per-row reveal control. Falling
                        // back to context_snippet here would put raw values on screen
                        // with no way to hide them again. A row whose finding has no
                        // masked form shows the em-dash; its raw text is one click away
                        // in the drawer.
                        const snip = (f0?.redacted_snippet || '').replace(/\s+/g, ' ').trim();
                        return snip ? (
                          <div className="text-[11px] font-mono truncate" style={{ color: 'var(--muted-foreground)' }}>
                            {renderMaskedSnippet(snip)}
                          </div>
                        ) : (
                          <span className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)', opacity: 0.4 }}>—</span>
                        );
                      })()}
                    </td>
                    <td className="px-5 py-3.5 text-xs font-mono whitespace-nowrap" style={{ color: 'var(--muted-foreground)' }}>{e.target_model || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Server-paged (limit/offset + total), so the shared bar runs in
            page-number mode — its numbered buttons replace the old "第 n / m 页"
            readout. `offset` stays the state; convert at the boundary. */}
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <Pagination
            page={Math.floor(offset / pageSize) + 1}
            pageSize={pageSize}
            onPageSize={setPageSize}
            total={total}
            onPage={(p) => setOffset((p - 1) * pageSize)}
          />
        </div>
      </div>

      <DetailDrawer
        open={!!selected}
        onClose={() => openEvent(null)}
        title={t('compliancePage.drawerTitle')}
        subtitle={selected?.event_id?.slice(0, 12)}
      >
        {selected && (
          <div>
            <DrawerField label={t('compliancePage.fieldEventId')} value={<span className="break-all text-[11px]">{selected.event_id}</span>} />
            <DrawerField label={t('compliancePage.columnTime')} value={formatDateTime(selected.created_at)} />
            <DrawerField label={t('compliancePage.columnAction')} value={<Badge variant={actionVariant(selected.action_taken)}>{selected.action_taken.toUpperCase()}</Badge>} />
            <DrawerField label={t('compliancePage.columnModel')} value={selected.target_model || '—'} />
            <DrawerField label={t('compliancePage.fieldPromptLength')} value={selected.prompt_length} />
            {selected.detect_latency_ms != null && (
              <DrawerField label={t('compliancePage.fieldDetectLatency')} value={`${selected.detect_latency_ms} ms`} />
            )}
            <DrawerField label={t('compliancePage.columnFindings')} value={
              <div className="space-y-3 pt-1.5 pl-1.5">
                {/* Per-finding values are computed in the map BODY rather than in a
                    render-time IIFE (2026-08-11): the eye now sits in the card
                    HEADER, above the snippet, so `canReveal` / `revealed` have to
                    exist before the first JSX line. Same shape as the admin audit
                    drawer's `map((f, idx) => { … return ( … ); })`. */}
                {selected.findings.map((f, idx) => {
                  const raw = f.context_snippet ?? '';
                  const masked = f.redacted_snippet ?? '';
                  const revealed = revealedFindings.has(f.finding_id);
                  // 🔴 WHERE the original comes from is the injected source's
                  // decision, not this file's. Local lane: the finding's own
                  // `context_snippet` (the matched span, already in hand).
                  // Team lane: `source.originalTurn`, which fetches the whole
                  // TURN per event and is a RECORDED read — so the eye is
                  // offered only when that source says it can answer. See
                  // ComplianceViewSource.originalTurn for the full rationale.
                  const teamOriginal = source.originalTurn;
                  const canReveal = canRevealOriginal(source, selected, f);
                  // 🔴 ONE SLOT, TWO STATES (2026-08-11 用户: 「改成原地替换」).
                  // The eye SWAPS what occupies the single block below; it never
                  // appends a second one. Both lanes now behave identically:
                  //   - LOCAL — `shown` flips from the masked text to the raw
                  //     span inside the ONE box (this was always true here).
                  //   - TEAM  — the fetched turn takes the box's PLACE, rendered
                  //     by the lane that knows what it is. Until 2026-08-11 the
                  //     masked snippet stayed put and the turn opened BELOW it;
                  //     the reason given was that the snippet had to survive as
                  //     the anchor for the placeholder highlight. That reason
                  //     does not survive the swap: expanded, the reader is
                  //     looking at raw values, and there is no placeholder left
                  //     to highlight (see `focus` below, which goes null).
                  //
                  // 🔴 WHAT THE SLOT SHOWS IS TEXT AND ONLY TEXT (2026-08-11
                  // 用户: 「这段话不需要了」+「能不能在原框框内显示，不要在下方」).
                  // Neither lane may put a heading, a caption or a notice around
                  // it. LOCAL never had any. TEAM briefly did — heading + note +
                  // text stacked inside this slot — and that is what the second
                  // complaint was about; the panel is now a single text element
                  // and its own fence asserts the two copy keys are gone
                  // (master .../user/compliance/original-turn-eye.test.ts §B).
                  // The turn is STILL not the masked span; what keeps that from
                  // being mis-implemented is the offsets ban fenced in the panel,
                  // not a sentence on screen.
                  // Holds the SOURCE (not a boolean) so the JSX below narrows it
                  // without a non-null assertion — `.Panel` is only reachable on
                  // the branch that proved the lane exists.
                  const showOriginalInPlace = revealed ? teamOriginal : undefined;
                  const shown = revealed && raw ? raw : masked;
                  // ── 发出形态, shown IN the snippet ────────────────────────
                  // The window around this match routinely contains OTHER
                  // findings' placeholders, so「哪一个是我的」was unanswerable
                  // from the numberless snippet alone. The focus names this
                  // card's own token; the renderer prints it under the number
                  // it was forwarded as (`{{PHONE_1}}`) and greys the rest.
                  //
                  // 🔴 UNRESOLVABLE RENDERS THE SNIPPET AS-IS — no note, no
                  // hint, no version warning. Absence is normal and permanent:
                  // the Personal lane never has a wire_label at all (local
                  // events go detector → control.db without passing the proxy —
                  // 方案 L's accepted asymmetry), and on the team lane it is
                  // absent for every audit-only finding, ceiling-capped piece
                  // and restore degrade. Reading that as「版本太旧、去升级」is
                  // the 2026-08-10 bug (workflow/CI/bugfix/20260810-team-
                  // compliance-selfview-blames-old-detector.md). Fenced:
                  // ./wire-label-display.test.ts.
                  //
                  // Only ever applied to the MASKED text: behind the eye the
                  // raw values are on screen and there is no placeholder to
                  // point at.
                  const focus = shown === masked ? resolveWireLabelFocus(f, selected.findings) : null;
                  return (
                  <div key={f.finding_id} className="rounded-md border p-2.5" style={{ position: 'relative', borderColor: 'var(--border)', backgroundColor: 'rgba(var(--lift-rgb), 0.02)' }}>
                    {/* sequence badge — overhangs the card's top-left corner (出框) */}
                    <span
                      className="inline-flex items-center justify-center text-[10px] font-mono font-bold rounded-full shrink-0"
                      style={{ position: 'absolute', top: -9, left: -9, width: 20, height: 20, color: 'var(--primary-dim)', border: '1px solid rgba(202,138,4,0.5)', backgroundColor: 'var(--card)', zIndex: 1 }}
                    >{idx + 1}</span>
                    <div className="flex items-center gap-2 mb-1.5">
                      <Badge variant={severityVariant(f.severity)}>{f.severity.toUpperCase()}</Badge>
                      <span className="text-xs font-mono font-bold" style={{ color: 'var(--foreground)' }}>{f.entity_type}</span>
                      <span className="text-[10px] font-mono ml-auto whitespace-nowrap" style={{ color: 'var(--muted-foreground)' }}>{f.category} · {f.confidence}</span>
                      {/* Fixed eye slot — reserved even when the eye cannot be
                          offered, so the glyphs line up across finding cards.
                          Byte-identical to the admin audit drawer's slot
                          (master .../compliance/audit/index.tsx), which is the
                          layout anchor this card was aligned to on 2026-08-11
                          (用户: 「个人版合规检测抽屉的样式需要简单化，对齐 master
                          页面的」). NOTHING WAS REMOVED: the eye kept its two-state
                          i18n text on `title` + `aria-label`, so the label is
                          still readable on hover and to a screen reader — it just
                          stopped costing every finding card a full extra row.

                          Snippet + eye rules (2026-08-09 用户拍板 — see the file
                          header) are unchanged: default = masked, and the eye
                          renders ONLY when there IS something to reveal. A button
                          that does nothing when clicked is worse than no button,
                          and `context_snippet` is legitimately absent for events
                          recorded between 2026-06-03 and that change, or by an
                          older detector — and on the team lane it is absent
                          whenever the ORG POLICY does not permit it (🔴 2026-08-11:
                          this used to read "absent by DESIGN on the team lane";
                          the team lane now carries the snippet at
                          `compliance_privacy_tier >= 3`, which a fresh
                          Team/Cluster install seeds, so absence there is a policy
                          state or an expired 90-day retention, not a guarantee).
                          That absence gets a note rather than a
                          dead control — but the note is EVENT-level and rendered
                          once, below the whole list (see it after this map). */}
                      <span className="inline-flex items-center justify-center shrink-0" style={{ width: 26 }}>
                        {canReveal && (
                          <button
                            type="button"
                            onClick={() => toggleReveal(f.finding_id)}
                            title={revealed ? t('compliancePage.hideOriginal') : t('compliancePage.revealOriginal')}
                            aria-label={revealed ? t('compliancePage.hideOriginal') : t('compliancePage.revealOriginal')}
                            aria-expanded={revealed}
                            className="inline-flex items-center justify-center p-1 rounded border"
                            style={{ borderColor: 'var(--border)', color: revealed ? 'var(--primary)' : 'var(--muted-foreground)' }}
                          >
                            {revealed ? <EyeOffIcon /> : <EyeIcon />}
                          </button>
                        )}
                      </span>
                    </div>
                    {f.detector && <p className="text-[10px] font-mono" style={{ color: 'var(--muted-foreground)' }}>{t('compliancePage.fieldDetector')}: {f.detector}</p>}
                    {/* 🔴 THE TERNARY IS THE MECHANISM (2026-08-11 原地替换).
                        Two sibling `&&` guards would render the snippet AND the
                        turn the moment the eye opens — that is precisely the
                        append shape this replaced. Fenced in
                        ./snippet-reveal.test.ts (R4), which slices this branch
                        out by name and asserts the snippet is unreachable while
                        the panel is mounted.

                        The team panel mounts ONLY while an eye is open, so the
                        RECORDED read happens on the click and not on the drawer
                        opening. */}
                    {showOriginalInPlace ? (
                      <showOriginalInPlace.Panel event={selected} />
                    ) : shown ? (
                      // ONE box, both states (2026-08-11 用户:「显示原文的样式，
                      // 需要也有背景框框，和 mask 后的保持一致性的样式」). Geometry
                      // and fill come from the shared source so the collapsed and
                      // expanded outlines coincide; the only difference is the
                      // text, plus an INSET warm left edge marking un-masked
                      // values (inset so it cannot move the outline — see
                      // snippetBoxStyle).
                      <div className={SNIPPET_BOX_CLASS} style={snippetBoxStyle(revealed && raw ? 'raw' : 'masked')}>
                        {renderMaskedSnippet(shown, focus)}
                      </div>
                    ) : null}
                  </div>
                  );
                })}
                {/* ── "why is there no original here" — ONCE PER DRAWER ──────────
                    2026-08-10 用户反馈: 「这段话，只需要在抽屉显示一次即可」. A real
                    event carried 8 findings, so the same paragraph rendered 8
                    times inside one drawer.

                    🔴 WHY EVENT-LEVEL AND NOT PER FINDING (do not move it back
                    into the map above): "is there an original I can look at" is a
                    property of the EVENT, not of a single matched span.
                      · TEAM lane — `originalTurn.canReveal(event)` does not even
                        take a finding: the original is one conversation TURN
                        fetched per event, so the answer is identical for every
                        finding by construction. N copies of one sentence was
                        always N copies of the same fact.
                      · LOCAL lane — `context_snippet` is a per-finding column,
                        but the detector's gate that fills it (mayCarryRawSnippet)
                        is evaluated per EVENT, so an event's findings are
                        all-or-nothing in practice; an old event (recorded before
                        the 2026-08-09 reveal decision) repeated the note once per
                        finding for the same single reason.
                      Consequence, accepted deliberately: in the pathological
                      mixed case (a finding whose byte offsets are degenerate, so
                      contextSnippet() returned "" while its siblings got text) the
                      eyeless finding now shows no note. The note's own text would
                      have been wrong there anyway ("recorded by an older
                      detector" — it wasn't), and an event-level fact stated once
                      beats a per-finding fact that is only ever right by accident.

                    🔴 WHY BELOW THE LIST rather than above it: two of the three
                    team-lane notes say 「上方的脱敏片段…」/"The masked snippet
                    above…". Those sentences are privacy copy under a fence
                    (privacy-claim-scope.test.ts / team-lane-original-note.test.ts)
                    and must not be reworded, so the note has to sit where the
                    masked snippets really are above it. Hence: after the cards,
                    and only when at least one card actually rendered a masked
                    snippet for it to refer to.

                    WHICH sentence is `source.originalUnavailableKey` — the reason
                    is lane-specific and comes from the injected source, never from
                    authMode (see the field's doc). */}
                {(() => {
                  const anyRevealable = selected.findings.some((f) => canRevealOriginal(source, selected, f));
                  const anyMasked = selected.findings.some((f) => !!f.redacted_snippet);
                  if (anyRevealable || !anyMasked) return null;
                  return (
                    <p className="text-[10px] font-mono leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
                      {t(source.originalUnavailableKey)}
                    </p>
                  );
                })()}
              </div>
            } />
          </div>
        )}
      </DetailDrawer>

      {/* Effective compliance packs (built-in + server-distributed) */}
      <DetailDrawer
        open={packsOpen}
        onClose={() => setPacksOpen(false)}
        title={t('effectivePacks.drawerTitle')}
      >
        {packsQuery.isLoading ? (
          <p className="text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>{t('compliancePage.loading')}</p>
        ) : !packsReport ? (
          <p className="text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>{t('effectivePacks.unavailable')}</p>
        ) : (
          <div className="space-y-4">
            {/* Password-lane level (阶段8/合规密码档分级). Rendered only when the
                enforcing node reported it — see passwordTier derivation. */}
            {passwordTier && (
              <div className="flex items-start gap-2 rounded border px-2.5 py-1.5" style={{ borderColor: 'var(--border)' }}>
                <Badge variant={passwordTier === 'advanced' ? 'yellow' : 'gray'} className="shrink-0">
                  {t(passwordTier === 'advanced' ? 'compliancePage.passwordTier.advancedBadge' : 'compliancePage.passwordTier.basicBadge')}
                </Badge>
                <div className="min-w-0">
                  <div className="text-xs font-mono" style={{ color: 'var(--foreground)' }}>{t('compliancePage.passwordTier.rowLabel')}</div>
                  <div className="text-[10px] font-mono mt-0.5 break-words" style={{ color: 'var(--muted-foreground)' }}>
                    {t(passwordTier === 'advanced' ? 'compliancePage.passwordTier.advancedDesc' : 'compliancePage.passwordTier.basicDesc')}
                  </div>
                </div>
              </div>
            )}
            <div>
              <h3 className="text-[10px] font-mono tracking-wider mb-2" style={{ color: 'var(--muted-foreground)' }}>{t('effectivePacks.builtInSection')}</h3>
              <div className="grid grid-cols-2 gap-2">
                {packsReport.built_in.map((p) => (
                  <div key={p.name} className="flex items-center gap-2 rounded border px-2.5 py-1.5" style={{ borderColor: 'var(--border)' }}>
                    <Badge variant="gray" className="shrink-0">{t('effectivePacks.builtInBadge')}</Badge>
                    <span className="text-xs font-mono truncate" style={{ color: 'var(--foreground)' }}>{p.name}</span>
                  </div>
                ))}
              </div>
            </div>
            {(packsReport.engines ?? []).length > 0 && (
              <div>
                <h3 className="text-[10px] font-mono tracking-wider mb-2" style={{ color: 'var(--muted-foreground)' }}>{t('effectivePacks.enginesSection')}</h3>
                {/* Why the badges below can read UNKNOWN, stated once for the
                    whole section rather than repeated on five rows (2026-08-14,
                    D8). A lone UNKNOWN badge is honest but unhelpful; this line
                    is the "where the real answer is" half, the same shape the
                    address row's note uses for the enforcement rung (D7). */}
                {engineLoadStateIsUnreadable(packsReport.engines ?? []) && (
                  <p className="text-[10px] font-mono mb-2 break-words" style={{ color: 'var(--muted-foreground)' }}>
                    {t('effectivePacks.engineLoadUnknownNote')}
                  </p>
                )}
                <div className="space-y-1.5">
                  {(packsReport.engines ?? []).map((e) => (
                    <div key={e.name} className="flex items-start gap-2 rounded border px-2.5 py-1.5" style={{ borderColor: 'var(--border)' }}>
                      {/* 🔴 Do NOT branch on `e.loaded` here. It has three
                          meanings (true / false / not-knowable-by-this-backend)
                          and the absent case must not collapse into "OFF".
                          engineLoadBadge() is the single exit — see
                          ./engine-load-state.ts. */}
                      <Badge variant={engineLoadBadge(e.loaded).variant} className="shrink-0">{t(engineLoadBadge(e.loaded).labelKey)}</Badge>
                      <div className="min-w-0">
                        <div className="text-xs font-mono font-bold" style={{ color: 'var(--foreground)' }}>{e.name}</div>
                        <div className="text-[10px] font-mono mt-0.5 break-words" style={{ color: 'var(--muted-foreground)' }}>
                          {e.entities.join(', ')}
                        </div>
                        {/* The engine's own note, on its OWN line (2026-08-11).
                            It used to be glued to the entity list with a `·`, so
                            the one thing a reader most needs — the enforcement
                            RUNG — read as the tail of a long grey run-on.
                            `address.recognizer` publishes `lane=<rung>`, and
                            "detected" is NOT "masked", which the green 已启用
                            badge alone actively misreads as "your addresses are
                            being masked". (This comment used to name the rung
                            as `audit`; the factory default moved to `mask` on
                            2026-08-13 and the hard-coded name went stale within
                            a day. Never name it here — the rung is node-local
                            runtime state with exactly one source of truth,
                            actionpolicy default_policy.json + the node's
                            operator override. See D7, 2026-08-14.)

                            🔴 Printed VERBATIM from the report. Do not parse
                            `lane=` here and do not restate the engine's
                            properties in this file — a second copy in the SPA is
                            the split-truth that produced the missing address row
                            in the first place. Two backends serve this page and
                            they know different amounts, which is why the SPA must
                            stay dumb: Personal reads the LIVE detector through
                            the local proxy (ai-compliance-detector
                            cmd/detector/list_packs.go buildBuiltInEngineList, so
                            its note carries the real `lane=<rung>`), while the
                            team console reads master's mirror (aikey-control-master
                            .../compliance/handler_my_packs.go), which cannot see
                            a node's runtime policy and therefore states no rung
                            at all. */}
                        {e.note && (
                          <div className="text-[10px] font-mono mt-0.5 break-words" style={{ color: 'var(--muted-foreground)' }}>
                            {e.note}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <h3 className="text-[10px] font-mono tracking-wider mb-2" style={{ color: 'var(--muted-foreground)' }}>{t('effectivePacks.distributedSection')}</h3>
              {packsReport.pulled.length === 0 ? (
                <p className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>{t('effectivePacks.noDistributed')}</p>
              ) : (
                <div className="space-y-1">
                  {packsReport.pulled.map((p) => (
                    <div key={p.pack_id} className="rounded border px-2 py-1" style={{ borderColor: 'var(--border)' }}>
                      <div className="flex items-center gap-2">
                        <Badge variant={p.status === 'active' ? 'green' : 'gray'} className="shrink-0">{p.status.toUpperCase()}</Badge>
                        <span className="text-xs font-mono font-bold" style={{ color: 'var(--foreground)' }}>{p.name}</span>
                        <span className="text-[10px] font-mono" style={{ color: 'var(--muted-foreground)' }}>v{p.version}</span>
                      </div>
                      <p className="text-[10px] font-mono mt-1" style={{ color: 'var(--muted-foreground)' }}>
                        {p.rule_count} {t('effectivePacks.rules')} · {p.phrase_count} {t('effectivePacks.phrases')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}
