/**
 * The ONE place that turns a built-in engine's `loaded` field into what the
 * member sees. (2026-08-14, D8.)
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The packs drawer used to render the badge inline as
 *
 *     <Badge variant={e.loaded ? 'green' : 'gray'}>{e.loaded ? ON : OFF}</Badge>
 *
 * — a two-way branch on a field that has THREE meanings, because two different
 * backends serve this page and they know different amounts:
 *
 *   PERSONAL lane — the report comes from the live detector through the local
 *     proxy (aikey-proxy GET /admin/compliance/packs → detector IPC). `loaded`
 *     is the real runtime wiring state of THIS machine's detector, computed at
 *     its startup. true/false are both trustworthy.
 *
 *   TEAM lane — the report comes from master's mirror
 *     (aikey-control-master .../compliance/handler_my_packs.go). Master
 *     distributes packs; it never sees a node's runtime state, it receives no
 *     engine health, and one org has N enforcing nodes under the centralized
 *     gateway. So master omits the field entirely.
 *
 * Until master stopped hand-typing constants, an engine that failed to come up
 * on the enforcing node was still shown to members with a green 已启用 badge.
 * The failure was silent by construction: fail-open means a detector whose CRF
 * model did not load keeps serving and only WARNs to its own stderr.
 *
 * 🔴 THE ABSENT CASE MUST NOT COLLAPSE INTO `false`. `loaded ?? false` looks
 * like a harmless default and is the same class of lie pointing the other way:
 * it would tell every team member that every engine is 未启用 while all of them
 * run. Absent means UNKNOWN, and unknown gets its own badge plus a pointer to
 * the surface that does answer it.
 *
 * The badge alone cannot carry that nuance, which is why `unknown` also drives
 * the section note (`effectivePacks.engineLoadUnknownNote`). Same shape as D7's
 * fix for the CN_ADDRESS enforcement rung one field over: master states what it
 * cannot know, and where the real answer is readable.
 *
 * Fenced by ./engine-load-state.test.ts — which also asserts the drawer routes
 * through this function rather than re-deriving the branch inline
 * (principles/documented-contract-needs-enforcement.md: give the concept one
 * exit, then assert the exit is used).
 */
import type { BadgeVariant } from '@/shared/ui/Badge';

export type EngineLoadState = 'on' | 'off' | 'unknown';

export interface EngineLoadBadge {
  state: EngineLoadState;
  variant: BadgeVariant;
  /** i18n key under `effectivePacks.` — resolved by the caller's `t()`. */
  labelKey: string;
}

/**
 * Maps a built-in engine's reported load state to its badge.
 *
 * `undefined` is the backend saying "I cannot see this", not "it is off" — see
 * the file header. Variants are existing anchors, not new styles: `green` is
 * already ON, `gray` is already OFF, and `dim` (no fill, muted text) is the
 * established quiet tier — visually distinct from both, so "unknown" can never
 * be mistaken for a verdict at a glance.
 */
export function engineLoadBadge(loaded: boolean | undefined): EngineLoadBadge {
  if (loaded === undefined || loaded === null) {
    return { state: 'unknown', variant: 'dim', labelKey: 'effectivePacks.engineUnknown' };
  }
  return loaded
    ? { state: 'on', variant: 'green', labelKey: 'effectivePacks.engineOn' }
    : { state: 'off', variant: 'gray', labelKey: 'effectivePacks.engineOff' };
}

/**
 * True when the served report cannot speak to load state at all, i.e. the
 * drawer must explain why every badge reads UNKNOWN rather than leaving the
 * member to guess. Derived from the data, never from `authMode` — the unified
 * origin gateway patches forwarded team pages to `local_bypass`
 * (principles/gateway-local-bypass-masquerade.md), so the lane is decided by
 * what the backend actually sent.
 */
export function engineLoadStateIsUnreadable(
  engines: ReadonlyArray<{ loaded?: boolean }>,
): boolean {
  return engines.some((e) => engineLoadBadge(e.loaded).state === 'unknown');
}
