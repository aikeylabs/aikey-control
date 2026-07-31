import i18next from 'i18next';
import { calendarDateAsUTCDate, getEffectiveUsageTimeZone } from '@/shared/usage/usage-time-zone';

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
 * As of 2026-04-24 this was pinned to "en-US" per CLAUDE.md "代码与
 * UI 语言" rule. With Phase 0 i18n it now follows the *active i18n
 * language* (an explicit user-picked / localStorage-cached choice),
 * NOT the raw `navigator.language`. The original navigator-based
 * reading leaked locale-specific phrasings into places that hadn't
 * been translated — e.g. `Intl.RelativeTimeFormat` rendered
 * `rtf.format(0, 'second')` as "现在" / "jetzt" for Chinese / German
 * browsers, producing a mixed-language UI (the label "Updated" was
 * always English, the suffix was not). Numeric date formats
 * ({month/day ordering, weekday names}) were similarly locale-
 * dependent. Driving off the explicit i18n language avoids that:
 * formats only switch to zh-CN when the user actually selects 中文,
 * and en-US remains the safe default for every other case.
 *
 * This is the single swap point: it reads the active locale from the
 * i18next singleton and every cached formatter below automatically
 * re-keys under it. */
function locale(): string {
  const lng = i18next.resolvedLanguage || i18next.language || 'en';
  return lng.startsWith('zh') ? 'zh-CN' : 'en-US';
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
  const calendarDate = calendarDateAsUTCDate(d);
  if (calendarDate) {
    return dtf({ month: 'numeric', day: 'numeric', timeZone: 'UTC' }).format(calendarDate);
  }
  const date = toDate(d);
  if (!date) return '';
  return dtf({ month: 'numeric', day: 'numeric', timeZone: getEffectiveUsageTimeZone() }).format(date);
}

/** Full date: "Apr 24, 2026" (en-US) / "24 Apr 2026" (en-GB) /
 * "24.04.2026" (de) / "2026/4/24" (ja-JP). Used for tooltips,
 * timestamps in tables, etc. */
export function formatDate(d: Date | string | number): string {
  const calendarDate = calendarDateAsUTCDate(d);
  if (calendarDate) return dtf({ year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(calendarDate);
  const date = toDate(d);
  if (!date) return '';
  return dtf({ year: 'numeric', month: 'short', day: 'numeric', timeZone: getEffectiveUsageTimeZone() }).format(date);
}

/** Numeric year-month-day for compact displays that want locale
 * order: "04/24/2026" (en-US) / "24/04/2026" (en-GB) /
 * "24.04.2026" (de). Differs from `formatDate` in that months are
 * numeric, which packs tighter in tables. */
export function formatDateNumeric(d: Date | string | number): string {
  const calendarDate = calendarDateAsUTCDate(d);
  if (calendarDate) return dtf({ year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }).format(calendarDate);
  const date = toDate(d);
  if (!date) return '';
  return dtf({ year: 'numeric', month: '2-digit', day: '2-digit', timeZone: getEffectiveUsageTimeZone() }).format(date);
}

/** ISO-style YYYY-MM-DD, locale-independent by design. Use for
 * tabular displays where sortability matters more than readability,
 * or where the audience spans multiple locales and ISO is the
 * lowest-ambiguity option. Not to be confused with the API-side
 * dateParam (wire format). */
export function formatDateISO(d: Date | string | number): string {
  if (calendarDateAsUTCDate(d) && typeof d === 'string') return d;
  const date = toDate(d);
  if (!date) return '';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: getEffectiveUsageTimeZone(), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

/** HH:MM in the user's locale. Note en-US picks 12-hour "3:45 PM",
 * EU / Asia mostly pick 24-hour "15:45". We let `Intl` decide so
 * the time format matches the rest of the user's OS. */
export function formatTime(d: Date | string | number): string {
  const date = toDate(d);
  if (!date) return '';
  return dtf({ hour: 'numeric', minute: '2-digit', timeZone: getEffectiveUsageTimeZone() }).format(date);
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
    timeZone: getEffectiveUsageTimeZone(),
  }).format(date);
}

/** Date + time for the conversation-audit module: the VIEWER's local timezone,
 * 24-hour clock, WITH an explicit timezone label (e.g. "Jun 17, 2026, 16:00
 * GMT+8").
 *
 * Why local-with-label (not bare-local, not forced-UTC):
 *  - Forced UTC (an earlier attempt) made an admin in UTC+8 read "08:00" for a
 *    16:00 event — they correctly reported it as wrong; on an audit surface a
 *    reviewer wants to see their own wall clock, not a mental +8 conversion.
 *  - Bare local (the generic `formatDateTime`) shows the right clock but gives
 *    no hint *which* zone, which is ambiguous when the reader must reason about
 *    exactly *when* something happened.
 * So: render in the viewer's local zone (matches their wall clock) and append
 * the resolved zone via `timeZoneName: 'short'` so the value is self-describing.
 * `hour12: false` removes AM/PM noise. Locale still follows the active UI
 * language. NOTE: the server-side .md export
 * (`aikey-data/query-service/.../conversation_export.go`) still renders UTC and
 * is labelled "UTC"; because both sides are labelled there is no ambiguity even
 * though the wall-clock numbers differ for a non-UTC viewer. */
export function formatDateTimeAudit(d: Date | string | number): string {
  const date = toDate(d);
  if (!date) return '';
  return dtf({
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: getEffectiveUsageTimeZone(),
    timeZoneName: 'short',
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
