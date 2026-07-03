/**
 * Builds a cross-app (cross-origin) navigation URL that carries the
 * current UI language as a one-shot `?lang=` handoff parameter.
 *
 * Why: the Personal web (local-server) and the Team web (team server)
 * run on DIFFERENT origins, and localStorage — where i18next caches the
 * user's language pick under 'aikey-lang' — is isolated per origin. A
 * plain `<a href>` hard-jump therefore lands on the other app with
 * whatever language THAT origin last knew (or the browser default),
 * making the UI language flip back and forth on every cross-app hop.
 * See workflow/CI/bugfix/2026-07-02-cross-app-language-flicker.md.
 *
 * The receiving app's i18n detector reads `?lang=` first (see
 * ../i18n/i18n.ts detection order), caches it into its own
 * localStorage, then strips the parameter from the address bar — so the
 * handoff is one-shot and a later manual switch on that origin isn't
 * overridden by a stale URL param on refresh.
 *
 * This file is byte-identical between user/web and master/web
 * (dual-edit invariant, same as UserShell.tsx) — each side resolves
 * '../i18n/i18n' to its OWN i18next singleton on purpose; do NOT turn
 * this into a cross-package import or B's bundle would pull in A's
 * i18n init side effects.
 */
import i18n from '../i18n/i18n';

/** Collapse the active language to the two supported buckets, matching
 * `nonExplicitSupportedLngs` in i18n.ts (zh-CN / zh-TW → 'zh'). */
function currentLangTag(): 'en' | 'zh' {
  const lng = i18n.resolvedLanguage || i18n.language || 'en';
  return lng.startsWith('zh') ? 'zh' : 'en';
}

/**
 * `base` is the other side's origin (no trailing slash — as returned by
 * getOtherBaseUrl()); `path` may already carry its own query string
 * (e.g. `/user/vault?focus=...`). None of the cross-app paths use
 * URL hashes today; if one ever does, insert `lang` before the hash.
 *
 * `base` accepts null only because callers hold `string | null` from
 * getOtherBaseUrl() and gate RENDERING (not this call) on it being
 * non-null — TS can't narrow through those render guards. A null base
 * degrades to a same-origin relative link, which is strictly saner than
 * the `"null/user/..."` string the old template literals would have
 * produced in that (unreachable) case.
 */
export function buildCrossAppUrl(base: string | null, path: string): string {
  const joiner = path.includes('?') ? '&' : '?';
  return `${base ?? ''}${path}${joiner}lang=${currentLangTag()}`;
}
