import { describe, expect, it } from 'vitest';
import {
  addUsageCalendarDays,
  calendarDateAsUTCDate,
  displayTimeZoneOptions,
  formatUsageDateTimeCompact,
  isValidIanaTimeZone,
  usageCalendarDate,
} from './usage-time-zone';

describe('personal usage time zone', () => {
  it('uses the selected IANA zone for the calendar day', () => {
    const instant = new Date('2026-07-24T03:30:00Z');
    expect(usageCalendarDate(instant, 'America/New_York')).toBe('2026-07-23');
    expect(usageCalendarDate(instant, 'Asia/Shanghai')).toBe('2026-07-24');
  });

  it('does calendar arithmetic without DST or host-time-zone drift', () => {
    expect(addUsageCalendarDays('2026-03-08', -1)).toBe('2026-03-07');
    expect(addUsageCalendarDays('2026-03-08', 1)).toBe('2026-03-09');
  });

  it('recognizes IANA zones and rejects offsets or arbitrary strings', () => {
    expect(isValidIanaTimeZone('Asia/Shanghai')).toBe(true);
    expect(isValidIanaTimeZone('UTC+08:00')).toBe(false);
    expect(isValidIanaTimeZone('not-a-zone')).toBe(false);
  });

  it('offers Beijing and other China-region names while storing IANA values', () => {
    const options = displayTimeZoneOptions();
    expect(options).toContainEqual({
      value: 'Asia/Shanghai',
      label: 'Beijing / Shanghai — China Standard Time (UTC+08:00)',
    });
    expect(options.map((option) => option.value)).toEqual(expect.arrayContaining([
      'Asia/Hong_Kong', 'Asia/Macau', 'Asia/Taipei', 'Asia/Urumqi',
    ]));
    expect(options.some((option) => option.value === 'Asia/Beijing')).toBe(false);
  });

  it('parses a daily bucket as a UTC-stable calendar label', () => {
    expect(calendarDateAsUTCDate('2026-07-24')?.toISOString()).toBe('2026-07-24T00:00:00.000Z');
    expect(calendarDateAsUTCDate('2026-02-31')).toBeNull();
    expect(calendarDateAsUTCDate('2026-07-24T00:00:00Z')).toBeNull();
  });

  it('formats detail timestamps in the selected usage zone', () => {
    const instant = Date.parse('2026-07-24T03:30:00Z');
    expect(formatUsageDateTimeCompact(instant, 'America/New_York')).toBe('07-23 23:30');
    expect(formatUsageDateTimeCompact(instant, 'Asia/Shanghai')).toBe('07-24 11:30');
  });
});
