/**
 * Unit tests for derive.ts §6.6 T formula implementation (M6 Stage 4).
 *
 * Guards:
 *   - 24h window filter (samples older than 24h excluded)
 *   - Terminal-status filter ('running' / 'error' excluded)
 *   - §6.6 formula correctness across edge cases
 *   - Auto + manual rows both contribute (decision 3.11: verdict
 *     equivalence — only the rate limit is separated, not the
 *     score aggregation)
 *   - Per-version split when questions rotated within 24h
 *   - 0 samples → T = null, band = info
 */

import { describe, expect, it, test } from 'vitest';

import type { CascadeHistoryEntry, TrustSummary } from './api';
import {
  computeHealthSummary,
  computeT24h,
  dedupByBaseUrl,
  deriveBand,
  summaryToRow,
} from './derive';


function makeRow(
  overrides: Partial<CascadeHistoryEntry> & { triggered_at: number; status: string },
): CascadeHistoryEntry {
  return {
    verify_id: overrides.verify_id ?? `v-${overrides.triggered_at}`,
    triggered_at: overrides.triggered_at,
    completed_at: overrides.completed_at ?? overrides.triggered_at + 30,
    status: overrides.status,
    duration_ms: overrides.duration_ms ?? 30_000,
    error_message: overrides.error_message ?? null,
    questions_version: overrides.questions_version ?? null,
    trigger_source: overrides.trigger_source ?? null,
  };
}

const NOW = 2_000_000_000;  // arbitrary fixed epoch for deterministic tests


describe('computeT24h — empty / null edge cases', () => {
  it('0 samples → T null, band info', () => {
    const r = computeT24h([], null, NOW);
    expect(r.T).toBe(null);
    expect(r.S_local).toBe(null);
    expect(r.n_samples).toBe(0);
    expect(r.band).toBe('info');
    expect(r.version_buckets).toEqual([]);
  });

  it('only error rows (no terminal verdict) → 0 samples', () => {
    const r = computeT24h(
      [
        makeRow({ triggered_at: NOW - 60, status: 'error' }),
        makeRow({ triggered_at: NOW - 120, status: 'running' }),
      ],
      null,
      NOW,
    );
    expect(r.n_samples).toBe(0);
    expect(r.T).toBe(null);
  });
});


describe('computeT24h — 24h window filter', () => {
  it('25h-old sample is excluded', () => {
    const r = computeT24h(
      [
        makeRow({ triggered_at: NOW - 60, status: 'passed' }),
        makeRow({ triggered_at: NOW - 25 * 3600, status: 'passed' }),
      ],
      null,
      NOW,
    );
    expect(r.n_samples).toBe(1);
    expect(r.T).toBe(100);
  });

  it('exactly 24h boundary (sample older than window) excluded', () => {
    const r = computeT24h(
      [
        makeRow({ triggered_at: NOW - 86400, status: 'passed' }),
        makeRow({ triggered_at: NOW - 86399, status: 'passed' }),
      ],
      null,
      NOW,
    );
    expect(r.n_samples).toBe(1);
  });
});


describe('computeT24h — §6.6 formula correctness', () => {
  it('all passed, no server data → T = S_local = 100, band trust', () => {
    const r = computeT24h(
      [
        makeRow({ triggered_at: NOW - 100, status: 'passed' }),
        makeRow({ triggered_at: NOW - 200, status: 'passed' }),
        makeRow({ triggered_at: NOW - 300, status: 'passed' }),
      ],
      null,
      NOW,
    );
    expect(r.S_local).toBe(100);
    expect(r.S_server).toBe(null);
    expect(r.crowd_conf).toBe(0);
    expect(r.alpha_eff).toBe(0);
    expect(r.T).toBe(100);
    expect(r.band).toBe('trust');
    expect(r.pass_count).toBe(3);
  });

  it('1 fail / 5 → pass_rate = 4/5 = 80, T = 80, band trust', () => {
    const r = computeT24h(
      [
        makeRow({ triggered_at: NOW - 100, status: 'passed' }),
        makeRow({ triggered_at: NOW - 200, status: 'passed' }),
        makeRow({ triggered_at: NOW - 300, status: 'passed' }),
        makeRow({ triggered_at: NOW - 400, status: 'passed' }),
        makeRow({ triggered_at: NOW - 500, status: 'failed' }),
      ],
      null,
      NOW,
    );
    expect(r.n_samples).toBe(5);
    expect(r.pass_count).toBe(4);
    expect(r.S_local).toBe(80);
    expect(r.T).toBe(80);
    expect(r.band).toBe('trust');
  });

  it('inconclusive counts as a sample but not a pass', () => {
    const r = computeT24h(
      [
        makeRow({ triggered_at: NOW - 100, status: 'passed' }),
        makeRow({ triggered_at: NOW - 200, status: 'inconclusive' }),
      ],
      null,
      NOW,
    );
    expect(r.n_samples).toBe(2);
    expect(r.pass_count).toBe(1);
    expect(r.S_local).toBe(50);
  });

  it('legacy short status names "pass" / "fail" recognised', () => {
    const r = computeT24h(
      [
        makeRow({ triggered_at: NOW - 100, status: 'pass' }),
        makeRow({ triggered_at: NOW - 200, status: 'fail' }),
      ],
      null,
      NOW,
    );
    expect(r.n_samples).toBe(2);
    expect(r.pass_count).toBe(1);
    expect(r.S_local).toBe(50);
  });
});


describe('computeT24h — auto + manual verdict equivalence (decision 3.11)', () => {
  it('auto and manual rows both contribute to S_local', () => {
    const r = computeT24h(
      [
        makeRow({ triggered_at: NOW - 100, status: 'passed', trigger_source: 'auto_l1' }),
        makeRow({ triggered_at: NOW - 200, status: 'passed', trigger_source: 'manual' }),
        makeRow({ triggered_at: NOW - 300, status: 'failed', trigger_source: 'manual' }),
      ],
      null,
      NOW,
    );
    // Note: not filtered by trigger_source — decision 3.11 only separates
    // the rate-limit query, not the score aggregation.
    expect(r.n_samples).toBe(3);
    expect(r.pass_count).toBe(2);
  });
});


describe('computeT24h — per-version split (questions rotation)', () => {
  it('single version → no breakdown', () => {
    const r = computeT24h(
      [
        makeRow({ triggered_at: NOW - 100, status: 'passed', questions_version: 'v1' }),
        makeRow({ triggered_at: NOW - 200, status: 'passed', questions_version: 'v1' }),
      ],
      null,
      NOW,
    );
    expect(r.version_buckets).toEqual([]);
  });

  it('two versions in 24h → per-version breakdown sorted by sample count', () => {
    const r = computeT24h(
      [
        makeRow({ triggered_at: NOW - 100, status: 'passed', questions_version: 'v2' }),
        makeRow({ triggered_at: NOW - 200, status: 'failed', questions_version: 'v2' }),
        makeRow({ triggered_at: NOW - 300, status: 'passed', questions_version: 'v1' }),
        makeRow({ triggered_at: NOW - 400, status: 'passed', questions_version: 'v1' }),
        makeRow({ triggered_at: NOW - 500, status: 'passed', questions_version: 'v1' }),
      ],
      null,
      NOW,
    );
    expect(r.version_buckets).toHaveLength(2);
    // v1 has 3 samples, v2 has 2 — v1 first (sample-count desc)
    expect(r.version_buckets[0].questions_version).toBe('v1');
    expect(r.version_buckets[0].n_samples).toBe(3);
    expect(r.version_buckets[0].S_local).toBe(100);
    expect(r.version_buckets[0].band).toBe('trust');

    expect(r.version_buckets[1].questions_version).toBe('v2');
    expect(r.version_buckets[1].n_samples).toBe(2);
    expect(r.version_buckets[1].S_local).toBe(50);
  });

  it('legacy null versions get their own bucket (only if 2+ distinct)', () => {
    const r = computeT24h(
      [
        makeRow({ triggered_at: NOW - 100, status: 'passed', questions_version: null }),
        makeRow({ triggered_at: NOW - 200, status: 'passed', questions_version: 'v2' }),
      ],
      null,
      NOW,
    );
    expect(r.version_buckets).toHaveLength(2);
    const nullBucket = r.version_buckets.find((b) => b.questions_version === null);
    expect(nullBucket?.n_samples).toBe(1);
  });
});


describe('computeT24h — server S_server (forward-looking Stage 5)', () => {
  it('S_server present but crowd_conf=0 → α_eff=0 → T = S_local', () => {
    // Sanity: even when summary provides s_l2, we keep crowd_conf=0
    // until Stage 5 plumbs the field. T must NOT magically equal a
    // server-weighted average yet.
    const r = computeT24h(
      [
        makeRow({ triggered_at: NOW - 100, status: 'passed' }),
        makeRow({ triggered_at: NOW - 200, status: 'failed' }),
      ],
      { s_l2: 70, last_verified_at: NOW - 100 },
      NOW,
    );
    expect(r.S_server).toBe(70);
    expect(r.crowd_conf).toBe(0);
    expect(r.alpha_eff).toBe(0);
    // T should still equal S_local because α_eff=0:
    expect(r.T).toBe(50);
  });
});


describe('deriveBand sanity', () => {
  it('null → info, ≥80 trust, 60-79 suspect, <60 risk', () => {
    expect(deriveBand(null)).toBe('info');
    expect(deriveBand(85)).toBe('trust');
    expect(deriveBand(80)).toBe('trust');
    expect(deriveBand(79)).toBe('suspect');
    expect(deriveBand(60)).toBe('suspect');
    expect(deriveBand(59)).toBe('risk');
    expect(deriveBand(0)).toBe('risk');
  });
});

// ---------------------------------------------------------------------------
// Stage 7 (2026-05-22): computeHealthSummary + dedupByBaseUrl
//
// (top-level imports are already in place at the file head; vitest
// requires all imports be at top-level, so we reference them here.)

function makeSummary(over: Partial<TrustSummary>): TrustSummary {
  const now = Math.floor(Date.now() / 1000);
  return {
    alias_name: 'a1',
    provider_id: 'anthropic',
    model: 'claude-opus-4-7',
    updated_at: now,
    last_verified_at: now - 60,
    last_verify_result: 'passed',
    s_l1: null,
    s_l2: null,
    s_l3: null,
    s_combined: 90,
    // 2026-05-23 redesign added s_display as a separate field. Tests
    // that override s_combined for displayScore() assertions can leave
    // s_display as null — displayScore prefers s_display when set, falls
    // back to s_combined when not. Per-test overrides set s_display
    // explicitly where the new field's behaviour matters.
    s_display: null,
    anomaly_suggested: false,
    signals_summary: null,
    is_in_use: true,
    is_oauth: false,
    is_supported_scope: true,
    base_url: 'https://api.anthropic.com',
    ...over,
  };
}

describe('computeHealthSummary', () => {
  test('returns null overallPct when no rows', () => {
    const h = computeHealthSummary([]);
    expect(h.overallPct).toBeNull();
    expect(h.totalCount).toBe(0);
    expect(h.checkedCount).toBe(0);
    expect(h.description).toMatch(/No sources/i);
  });

  test('mean over only 24h-checked rows', () => {
    // 3 rows: one fresh score 100, one fresh score 60, one STALE score 0
    // (last_verified_at = 2 days ago). The stale row must NOT pull the
    // mean down.
    const now = Math.floor(Date.now() / 1000);
    const items: TrustSummary[] = [
      makeSummary({ alias_name: 'a', s_combined: 100, last_verified_at: now - 30 }),
      makeSummary({ alias_name: 'b', s_combined: 60, last_verified_at: now - 60 }),
      makeSummary({
        alias_name: 'c',
        s_combined: 0,
        last_verified_at: now - 86400 * 2,
        last_verify_result: 'failed',
      }),
    ];
    const h = computeHealthSummary(items);
    expect(h.overallPct).toBe(80); // mean(100, 60)
    expect(h.checkedCount).toBe(2); // only a + b inside 24h
    expect(h.totalCount).toBe(3);
  });

  test('healthyCount counts trust-band rows (>= 80)', () => {
    const items: TrustSummary[] = [
      makeSummary({ alias_name: 'a', s_combined: 95 }),
      makeSummary({ alias_name: 'b', s_combined: 80 }),
      makeSummary({ alias_name: 'c', s_combined: 70 }),
      makeSummary({ alias_name: 'd', s_combined: 50 }),
    ];
    const h = computeHealthSummary(items);
    expect(h.healthyCount).toBe(2); // a + b
    expect(h.needsReviewCount).toBe(2); // c (suspect) + d (risk)
  });

  test('description tier transitions on overallPct', () => {
    const now = Math.floor(Date.now() / 1000);
    const stableItems: TrustSummary[] = [
      makeSummary({ alias_name: 'a', s_combined: 95, last_verified_at: now - 60 }),
    ];
    expect(computeHealthSummary(stableItems).description).toMatch(/stable/i);

    const suspectItems: TrustSummary[] = [
      makeSummary({ alias_name: 'a', s_combined: 70, last_verified_at: now - 60 }),
    ];
    expect(computeHealthSummary(suspectItems).description).toMatch(/review/i);

    const riskyItems: TrustSummary[] = [
      makeSummary({ alias_name: 'a', s_combined: 30, last_verified_at: now - 60 }),
    ];
    expect(computeHealthSummary(riskyItems).description).toMatch(/recheck/i);
  });

  test('overallPct null when rows exist but none verified in 24h', () => {
    const now = Math.floor(Date.now() / 1000);
    const items: TrustSummary[] = [
      makeSummary({
        alias_name: 'a',
        s_combined: 90,
        last_verified_at: now - 86400 * 3,
      }),
    ];
    const h = computeHealthSummary(items);
    expect(h.overallPct).toBeNull();
    expect(h.description).toMatch(/No recent checks/i);
  });
});

describe('dedupByBaseUrl', () => {
  test('groups two aliases sharing same base_url into one entry', () => {
    const rows = [
      summaryToRow(makeSummary({ alias_name: 'a', s_combined: 90 })),
      summaryToRow(makeSummary({ alias_name: 'b', s_combined: 70 })),
    ];
    const groups = dedupByBaseUrl(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].base_url).toBe('https://api.anthropic.com');
    expect(groups[0].rows).toHaveLength(2);
  });

  test('representative is worst-band row (risk surfaces first)', () => {
    const rows = [
      summaryToRow(makeSummary({ alias_name: 'fresh', s_combined: 95 })),
      summaryToRow(makeSummary({ alias_name: 'risky', s_combined: 30 })),
    ];
    const groups = dedupByBaseUrl(rows);
    expect(groups[0].representative.alias_name).toBe('risky');
    expect(groups[0].band).toBe('risk');
  });

  test('null base_url collapses into "Unknown gateway"', () => {
    const rows = [
      summaryToRow(makeSummary({ alias_name: 'a', base_url: null })),
      summaryToRow(makeSummary({ alias_name: 'b', base_url: null })),
      summaryToRow(makeSummary({ alias_name: 'c', base_url: 'https://x.example/v1' })),
    ];
    const groups = dedupByBaseUrl(rows);
    expect(groups).toHaveLength(2);
    const unknown = groups.find((g) => g.label === 'Unknown gateway');
    expect(unknown).toBeDefined();
    expect(unknown!.rows).toHaveLength(2);
  });

  test('OAuth row with null base_url groups under "<Provider> OAuth (official)" — NOT "Unknown gateway"', () => {
    // 2026-05-23 fix. OAuth credentials don't carry a user-configurable
    // base_url (vault deliberately omits it), but the upstream IS known
    // — it's the official provider API. Pre-fix this row fell into
    // "Unknown gateway" alongside genuinely-missing-baseurl rows, which
    // misled users (and looked like a backend bug).
    const rows = [
      summaryToRow(
        makeSummary({
          alias_name: 'FreySilvaqzs@qualityservice.com',
          provider_id: 'anthropic',
          base_url: null,
          is_oauth: true,
        }),
      ),
    ];
    const groups = dedupByBaseUrl(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe('Anthropic OAuth (official)');
    // MUST NOT be "Unknown gateway" — that label is reserved for the
    // genuinely-missing-baseurl catchall.
    expect(groups[0]!.label).not.toBe('Unknown gateway');
  });

  test('OAuth rows from different providers split into separate groups', () => {
    // Anthropic OAuth and OpenAI OAuth are different "gateways" even
    // when both have null base_url — don't collapse them together.
    const rows = [
      summaryToRow(
        makeSummary({
          alias_name: 'user1@anthropic',
          provider_id: 'anthropic',
          base_url: null,
          is_oauth: true,
        }),
      ),
      summaryToRow(
        makeSummary({
          alias_name: 'user2@openai',
          provider_id: 'openai',
          base_url: null,
          is_oauth: true,
        }),
      ),
    ];
    const groups = dedupByBaseUrl(rows);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.label).sort()).toEqual([
      'Anthropic OAuth (official)',
      'OpenAI OAuth (official)',
    ]);
  });

  test('OAuth and non-OAuth null-base_url do NOT collide into the same group', () => {
    // Mixed bag: one OAuth row (well-known upstream) + one personal-API-
    // key row with vault unreachable / pre-baseurl-column (genuinely
    // unknown). They must produce 2 distinct groups.
    const rows = [
      summaryToRow(
        makeSummary({
          alias_name: 'oauth-acct',
          provider_id: 'anthropic',
          base_url: null,
          is_oauth: true,
        }),
      ),
      summaryToRow(
        makeSummary({
          alias_name: 'personal-no-baseurl',
          provider_id: 'anthropic',
          base_url: null,
          is_oauth: false,
        }),
      ),
    ];
    const groups = dedupByBaseUrl(rows);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.label === 'Anthropic OAuth (official)')).toBeDefined();
    expect(groups.find((g) => g.label === 'Unknown gateway')).toBeDefined();
  });

  test('sorts groups latest-verified-first', () => {
    const now = Math.floor(Date.now() / 1000);
    const rows = [
      summaryToRow(
        makeSummary({
          alias_name: 'old',
          base_url: 'https://old.example/v1',
          last_verified_at: now - 3600,
        }),
      ),
      summaryToRow(
        makeSummary({
          alias_name: 'fresh',
          base_url: 'https://fresh.example/v1',
          last_verified_at: now - 30,
        }),
      ),
    ];
    const groups = dedupByBaseUrl(rows);
    expect(groups[0].label).toBe('fresh.example/v1');
    expect(groups[1].label).toBe('old.example/v1');
  });

  test('label strips scheme + trailing slash', () => {
    const rows = [
      summaryToRow(makeSummary({ alias_name: 'a', base_url: 'https://aicoding.2233.ai/v1/' })),
    ];
    const groups = dedupByBaseUrl(rows);
    expect(groups[0].label).toBe('aicoding.2233.ai/v1');
  });

  test('malformed base_url falls back to raw string', () => {
    const rows = [
      summaryToRow(makeSummary({ alias_name: 'a', base_url: 'not-a-url' })),
    ];
    const groups = dedupByBaseUrl(rows);
    expect(groups[0].label).toBe('not-a-url');
  });
});
