/**
 * Locale-aware date/time formatters.
 *
 * Every helper here reads `navigator.language` so the same UI string
 * renders as `11/04` for a European user and `4/11` for a US user.
 * Previously most pages built display strings by hand
 * (`${month}/${date}`), which always produced US order — confusing
 * for non-US users who read it as Day/Month.
 *
 * **Never use these for API wire format.** `usage.ts::dateParam` and
 * any other query parameter that hits the backend still needs
 * YYYY-MM-DD (server-side tz handling expects that); see the comment
 * in that file.
 *
 * Design: thin wrappers over `Intl.DateTimeFormat` /
 * `Intl.RelativeTimeFormat`. We memoise one formatter per
 * (locale, option-signature) pair because constructing a new
 * `Intl.DateTimeFormat` on every render is measurable in Chrome's
 * profiler (~0.1ms × N chart ticks). The call sites below are in the
 * chart-render hot path, so the cache pays off.
 */

/** UI display locale.
 *
 * Pinned to "en-US" as of 2026-04-24 per CLAUDE.md "代码与 UI 语言"
 * rule: all user-facing UI strings ship in English until a proper
 * i18n layer (message catalogue + user-picked locale) is introduced.
 * Before this change the helper read `navigator.language`, which
 * leaked locale-specific phrasings into places that hadn't actually
 * been translated — e.g. `Intl.RelativeTimeFormat` rendered
 * `rtf.format(0, 'second')` as "现在" / "jetzt" for Chinese / German
 * browsers, producing a mixed-language UI (the label "Updated" was
 * always English, the suffix was not). Numeric date formats
 * ({month/day ordering, weekday names}) were similarly locale-
 * dependent.
 *
 * When real i18n lands, this is the single swap point: return the
 * active locale from the provider (useLocale() / i18n store) and
 * every cached formatter below automatically re-keys under it. */
function locale(): string {
  return 'en-US';
}

// --- memoised formatters --------------------------------------------------

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = locale() + '|' + JSON.stringify(options);
  let f = dtfCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale(), options);
    dtfCache.set(key, f);
  }
  return f;
}

const rtfCache = new Map<string, Intl.RelativeTimeFormat>();
function rtf(options: Intl.RelativeTimeFormatOptions = { numeric: 'auto' }): Intl.RelativeTimeFormat {
  const key = locale() + '|' + JSON.stringify(options);
  let f = rtfCache.get(key);
  if (!f) {
    f = new Intl.RelativeTimeFormat(locale(), options);
    rtfCache.set(key, f);
  }
  return f;
}

// --- date display ---------------------------------------------------------

/** Short date for chart x-axis ticks: "4/11" (en-US) / "11/4" (en-GB)
 * / "11.4." (de) / "4月11日" (ja-JP). Month + day only; no year. */
export function formatDateShort(d: Date | string | number): string {
  const date = toDate(d);
  if (!date) return '';
  return dtf({ month: 'numeric', day: 'numeric' }).format(date);
}

/** Full date: "Apr 24, 2026" (en-US) / "24 Apr 2026" (en-GB) /
 * "24.04.2026" (de) / "2026/4/24" (ja-JP). Used for tooltips,
 * timestamps in tables, etc. */
export function formatDate(d: Date | string | number): string {
  const date = toDate(d);
  if (!date) return '';
  return dtf({ year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

/** Numeric year-month-day for compact displays that want locale
 * order: "04/24/2026" (en-US) / "24/04/2026" (en-GB) /
 * "24.04.2026" (de). Differs from `formatDate` in that months are
 * numeric, which packs tighter in tables. */
export function formatDateNumeric(d: Date | string | number): string {
  const date = toDate(d);
  if (!date) return '';
  return dtf({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** ISO-style YYYY-MM-DD, locale-independent by design. Use for
 * tabular displays where sortability matters more than readability,
 * or where the audience spans multiple locales and ISO is the
 * lowest-ambiguity option. Not to be confused with the API-side
 * dateParam (wire format). */
export function formatDateISO(d: Date | string | number): string {
  const date = toDate(d);
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** HH:MM in the user's locale. Note en-US picks 12-hour "3:45 PM",
 * EU / Asia mostly pick 24-hour "15:45". We let `Intl` decide so
 * the time format matches the rest of the user's OS. */
export function formatTime(d: Date | string | number): string {
  const date = toDate(d);
  if (!date) return '';
  return dtf({ hour: 'numeric', minute: '2-digit' }).format(date);
}

/** Date + time combined. Used for "last used at" in tables and the
 * detailed drawer. */
export function formatDateTime(d: Date | string | number): string {
  const date = toDate(d);
  if (!date) return '';
  return dtf({
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

// --- relative time --------------------------------------------------------

/** Relative past-time ("just now", "5 min ago", "3 d", "2 mo ago",
 * etc.) in the user's locale. Returns "" when the input is absent
 * / future / unparsable — callers render something else in that
 * slot rather than a broken relative string.
 *
 * Consolidates the 6 duplicate in-page `relativeTime()` /
 * `formatRelative()` helpers that each reinvented the wheel in
 * English-only form.
 */
export function formatRelativeTime(d: Date | string | number, now: Date = new Date()): string {
  const date = toDate(d);
  if (!date) return '';
  const diffMs = now.getTime() - date.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) {
    // Future timestamp — Intl.RelativeTimeFormat does handle this but
    // it reads awkwardly here (e.g. "in 2 min" for a recently stored
    // event can mean clock skew, not actually in the future). Fall
    // back to the absolute date so the user sees something sensible.
    return formatDate(date);
  }
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) {
    // "just now" — Intl.RelativeTimeFormat renders `rtf.format(0, 'second')`
    // as "now" (en) / "jetzt" (de) / "現在" (ja), matching expectation.
    return rtf().format(0, 'second');
  }
  if (mins < 60) return rtf().format(-mins, 'minute');
  const hours = Math.floor(mins / 60);
  if (hours < 24) return rtf().format(-hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 30) return rtf().format(-days, 'day');
  const months = Math.floor(days / 30);
  if (months < 12) return rtf().format(-months, 'month');
  const years = Math.floor(months / 12);
  return rtf().format(-years, 'year');
}

// --- internals ------------------------------------------------------------

function toDate(d: Date | string | number): Date | null {
  if (d instanceof Date) return isNaN(d.getTime()) ? null : d;
  if (typeof d === 'number') {
    const x = new Date(d);
    return isNaN(x.getTime()) ? null : x;
  }
  if (typeof d === 'string' && d) {
    const x = new Date(d);
    return isNaN(x.getTime()) ? null : x;
  }
  return null;
}
