import { describe, expect, it } from 'vitest';
import { formatDate, formatDateISO, formatDateShort } from './datetime-intl';

describe('formatDateShort', () => {
  it('renders a YYYY-MM-DD usage bucket as its calendar label', () => {
    // Regression: new Date('2026-07-24') is UTC midnight, which rendered as
    // 7/23 on a negative-offset browser even though the bucket itself is 7/24.
    expect(formatDateShort('2026-07-24')).toBe('7/24');
  });

  it('keeps date-only values as calendar labels in every absolute-date helper', () => {
    expect(formatDate('2026-07-24')).toContain('2026');
    expect(formatDateISO('2026-07-24')).toBe('2026-07-24');
  });
});
