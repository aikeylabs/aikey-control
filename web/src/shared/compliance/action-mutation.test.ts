/**
 * Fence for bugfix 2026-09-04-warn-rows-look-masked.
 *
 * The defect this guards: the compliance self-view rendered `redacted_snippet`
 * for every row, so a `warn` event (content forwarded UNCHANGED) looked exactly
 * like a `mask` event (content rewritten). A reader could not tell a leak from
 * a successful mask.
 *
 * 能红证明: flip `sentUnchanged` to `return false` (or drop 'warn' from the set)
 * and the first case below fails — that is precisely the shipped behaviour
 * before this fix.
 */
import { describe, it, expect } from 'vitest';
import { sentUnchanged } from './action-mutation';

describe('sentUnchanged — did the model receive the original text?', () => {
  it('warn forwarded the original: the masked snippet beside it is display-only', () => {
    // The winpc2 2026-09-04 case: a TierWarn address went upstream in the clear
    // while the page showed {{ADDR}}. This is THE assertion that was missing.
    expect(sentUnchanged('warn')).toBe(true);
  });

  it('allow and audit also leave the content untouched', () => {
    expect(sentUnchanged('allow')).toBe(true);
    expect(sentUnchanged('audit')).toBe(true);
  });

  it('mask rewrote the body — must NOT be labelled as sent-as-is', () => {
    // Mislabelling a real mask would be the mirror-image defect: it would tell
    // the reader their masked value leaked when it did not.
    expect(sentUnchanged('mask')).toBe(false);
  });

  it('block forwarded nothing at all — no "sent as-is" claim applies', () => {
    expect(sentUnchanged('block')).toBe(false);
  });

  it('is case-insensitive — the list renders the action uppercased', () => {
    expect(sentUnchanged('WARN')).toBe(true);
    expect(sentUnchanged('MASK')).toBe(false);
  });

  it('an unknown or absent action makes no claim (fails closed)', () => {
    // A future action this build does not know must not be advertised as
    // "the original was sent" — that is a promise about enforcement we cannot
    // keep without knowing the semantics.
    expect(sentUnchanged('quarantine')).toBe(false);
    expect(sentUnchanged('')).toBe(false);
    expect(sentUnchanged(null)).toBe(false);
    expect(sentUnchanged(undefined)).toBe(false);
  });
});
