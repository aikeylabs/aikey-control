/**
 * Single source of truth for the device display time zone. Personal usage also
 * uses it for calendar boundaries; organization reports use their own policy.
 * "auto" follows the browser/OS and a manual value is an IANA identifier.
 *
 * Personal and Team Web can run on different origins, so cross-app links carry
 * the legacy-compatible one-shot `usage_tz` handoff. The receiving origin stores it locally and
 * removes it from the address bar when this module is first read.
 */

export const USAGE_TIME_ZONE_AUTO = 'auto';
export const USAGE_TIME_ZONE_STORAGE_KEY = 'aikey:usage-time-zone';
export const USAGE_TIME_ZONE_HANDOFF_PARAM = 'usage_tz';

export interface TimeZoneOption {
  value: string;
  label: string;
}

/** Product-friendly names backed by canonical IANA identifiers. */
export const FEATURED_TIME_ZONE_OPTIONS: readonly TimeZoneOption[] = [
  { value: 'Asia/Shanghai', label: 'Beijing / Shanghai — China Standard Time (UTC+08:00)' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong — Hong Kong Time (UTC+08:00)' },
  { value: 'Asia/Macau', label: 'Macau — China Standard Time (UTC+08:00)' },
  { value: 'Asia/Taipei', label: 'Taipei — Taipei Standard Time (UTC+08:00)' },
  { value: 'Asia/Urumqi', label: 'Urumqi — Xinjiang Time (UTC+06:00)' },
  { value: 'UTC', label: 'UTC — Coordinated Universal Time (UTC+00:00)' },
] as const;

const CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function systemUsageTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isValidIanaTimeZone(value: string): boolean {
  if (!value || value === USAGE_TIME_ZONE_AUTO) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function normalizePreference(value: string | null): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed || trimmed === USAGE_TIME_ZONE_AUTO) return USAGE_TIME_ZONE_AUTO;
  return isValidIanaTimeZone(trimmed) ? trimmed : USAGE_TIME_ZONE_AUTO;
}

function consumeCrossAppHandoff(): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get(USAGE_TIME_ZONE_HANDOFF_PARAM);
    if (raw === null) return;

    const preference = normalizePreference(raw);
    if (preference === USAGE_TIME_ZONE_AUTO) {
      window.localStorage.removeItem(USAGE_TIME_ZONE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(USAGE_TIME_ZONE_STORAGE_KEY, preference);
    }
    url.searchParams.delete(USAGE_TIME_ZONE_HANDOFF_PARAM);
    window.history.replaceState(window.history.state, '', url.toString());
  } catch (error) {
    console.warn('[aikey] usage time zone handoff could not be applied', error);
  }
}

let handoffConsumed = false;
function ensureHandoffConsumed(): void {
  if (handoffConsumed) return;
  handoffConsumed = true;
  consumeCrossAppHandoff();
}

export function getUsageTimeZonePreference(): string {
  ensureHandoffConsumed();
  if (typeof window === 'undefined') return USAGE_TIME_ZONE_AUTO;
  try {
    const stored = window.localStorage.getItem(USAGE_TIME_ZONE_STORAGE_KEY);
    const normalized = normalizePreference(stored);
    if (stored && normalized === USAGE_TIME_ZONE_AUTO) {
      console.warn('[aikey] invalid stored usage time zone; following the system time zone');
    }
    return normalized;
  } catch (error) {
    console.warn('[aikey] usage time zone preference is unavailable; following the system time zone', error);
    return USAGE_TIME_ZONE_AUTO;
  }
}

export function setUsageTimeZonePreference(value: string): void {
  const normalized = normalizePreference(value);
  if (value.trim() !== USAGE_TIME_ZONE_AUTO && normalized === USAGE_TIME_ZONE_AUTO) {
    throw new Error('Enter a valid IANA time zone, for example Asia/Shanghai.');
  }
  if (typeof window === 'undefined') {
    throw new Error('Browser storage is unavailable, so the usage time zone could not be saved.');
  }
  try {
    if (normalized === USAGE_TIME_ZONE_AUTO) {
      window.localStorage.removeItem(USAGE_TIME_ZONE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(USAGE_TIME_ZONE_STORAGE_KEY, normalized);
    }
  } catch {
    throw new Error('Browser storage is unavailable. Allow site storage and try again.');
  }
}

export function getEffectiveUsageTimeZone(): string {
  const preference = getUsageTimeZonePreference();
  return preference === USAGE_TIME_ZONE_AUTO ? systemUsageTimeZone() : preference;
}

/** Returns YYYY-MM-DD in the selected personal-usage calendar. */
export function usageCalendarDate(date = new Date(), timeZone = getEffectiveUsageTimeZone()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

/** Calendar arithmetic independent of the host runtime time zone and DST. */
export function addUsageCalendarDays(value: string, delta: number): string {
  const match = CALENDAR_DATE_RE.exec(value);
  if (!match) throw new Error(`Invalid calendar date: ${value}`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + delta));
  return date.toISOString().slice(0, 10);
}

export function usageCalendarDateDaysAgo(days: number, now = new Date()): string {
  return addUsageCalendarDays(usageCalendarDate(now), -days);
}

/**
 * Treat an API daily bucket as a calendar label, not a UTC timestamp. The UTC
 * instant is deliberate: callers must format it with timeZone:"UTC".
 */
export function calendarDateAsUTCDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = CALENDAR_DATE_RE.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

/** Stable compact timestamp for personal usage-detail rows. */
export function formatUsageDateTimeCompact(ms: number, timeZone = getEffectiveUsageTimeZone()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('month')}-${value('day')} ${value('hour')}:${value('minute')}`;
}

export function usageTimeZoneOptions(...include: string[]): string[] {
  let zones: string[] = [];
  try {
    const supportedValuesOf = (Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }).supportedValuesOf;
    zones = supportedValuesOf?.('timeZone') ?? [];
  } catch {
    // Older browsers use the curated fallback below.
  }
  zones.push('UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Shanghai', 'Asia/Tokyo');
  for (const zone of include) {
    if (isValidIanaTimeZone(zone)) zones.push(zone);
  }
  return [...new Set(zones)].sort((a, b) => a.localeCompare(b, 'en-US'));
}

/** Featured human names first, followed by every runtime-supported IANA zone. */
export function displayTimeZoneOptions(...include: string[]): TimeZoneOption[] {
  const featuredValues = new Set(FEATURED_TIME_ZONE_OPTIONS.map((option) => option.value));
  return [
    ...FEATURED_TIME_ZONE_OPTIONS,
    ...usageTimeZoneOptions(...include)
      .filter((zone) => !featuredValues.has(zone))
      .map((zone) => ({ value: zone, label: zone })),
  ];
}
