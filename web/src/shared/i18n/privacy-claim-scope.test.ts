// @ts-nocheck — vitest-only file using Node built-ins (fs / path / process.cwd).
// Same pragma rationale as layouts/UserShell.dual-edit.test.ts: the project does
// not ship @types/node, so the project-wide strict `tsc --noEmit` would reject
// these imports even though vitest runs the file fine.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Non-egress privacy claims in the UI catalogs — scope fence.
 *
 * ══ WHY THIS FILE EXISTS ═══════════════════════════════════════════════════
 *
 * aikey moves user text along TWO independent lanes, and for years the copy
 * described the first one's property as the whole system's:
 *
 *   · COMPLIANCE lane (`compliance_findings`) — the matched original really
 *     does stay on the box. Three gates: the detector's raw `context_snippet`
 *     is not put on the intake wire (`mayCarryRawSnippet`), a team-routed event
 *     is not enqueued to the local uploader, and master's intake decodes with
 *     `DisallowUnknownFields` so a raw field would 400 rather than land.
 *
 *   · CONVERSATION AUDIT lane (`conversation_records`) — when the org's capture
 *     switch is on (**the Cluster installer's default**, see
 *     `cluster-install.sh --conversation-audit`), the proxy uploads the FULL
 *     pre-mask prompt and reply to the team server, where they are retained and
 *     an administrator reads or exports them by seat.
 *     `make -C aikey-test test-audit-eye` reads that text back verbatim.
 *
 * So a sentence like "原文不会离开本机 / never leaves your device", written
 * without naming a lane, is simply FALSE on any deployment with capture on —
 * and on an on-premise B2B install this copy IS the employee privacy notice.
 * Four such sentences shipped at once (2026-08-10c), all descended from one bad
 * rule in the truth source (requirements/2026-08-10-compliance-event-
 * conversation-turn-join-key.md R7 claimed master "cannot read" a turn, which
 * its own §3 P2 contradicts). §7 of that file is now the copy contract.
 *
 * ══ WHY A CATALOG-WIDE SCAN AND NOT FOUR STRING ASSERTIONS ═════════════════
 *
 * The concept is "any user-facing string asserting that something never leaves
 * this machine". Its exits are not four known keys — the exit is *the catalog*,
 * because the next such sentence gets written next to a different feature by
 * someone who has never read this file. Pinning the four strings would go green
 * on the fifth. So: scan everything, and require every hit to be on an
 * allowlist that says, in prose, why the claim is true THERE. Adding a new
 * absolute claim then costs an argument, which is the intended price.
 *
 * ══ 能红 (each of these must turn this file red) ════════════════════════════
 *   - put "原文不会离开本机" / "never leaves your device" back on
 *     compliancePage.pageDescription, settings.compliance.description, or any
 *     other key → red (not allowlisted).
 *   - restore the unqualified "所有数据均保留在你的本机上 / All data stays on
 *     your machine" subject on the Trust Check disclaimer → red (the qualifier
 *     assertions below).
 *   - restore "your prompts, answers, and KEYs stay on disk" on the trust-local
 *     tooltip → red (that names exactly what the OTHER lane uploads).
 *   - allowlist a key with a hand-wave instead of a reason → red (`why` length).
 *   - rewrite an allowlisted string so it no longer claims anything, and leave
 *     the entry behind → red (the allowlist must not rot into a blanket).
 *   - edit this file in one repo only → red (dual-edit mirror check).
 */

// ── Where the catalogs are ───────────────────────────────────────────────────

const WEB_ROOT = process.cwd();
const SELF = 'src/shared/i18n/privacy-claim-scope.test.ts';

/**
 * This file is dual-edited into aikey-control/web and aikey-control-master/web
 * and must stay byte-identical, so the peer root is DERIVED rather than written
 * as a literal (a literal would differ per repo and defeat the compare).
 */
const PEER_WEB_ROOT = WEB_ROOT.includes('aikey-control-master')
  ? WEB_ROOT.replace('aikey-control-master', 'aikey-control')
  : WEB_ROOT.replace(`${path.sep}aikey-control${path.sep}`, `${path.sep}aikey-control-master${path.sep}`);

const read = (root: string, p: string) => fs.readFileSync(path.join(root, p), 'utf-8');
const catalog = (locale: string) =>
  JSON.parse(read(WEB_ROOT, `src/shared/i18n/locales/${locale}/common.json`)) as Record<string, unknown>;

const CATALOGS: Record<string, Record<string, unknown>> = { en: catalog('en'), zh: catalog('zh') };

/** Flatten to dotted key → string, so a hit can be named precisely. */
function flatten(node: unknown, prefix = '', out: Record<string, string> = {}) {
  if (typeof node === 'string') {
    out[prefix] = node;
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}
const FLAT: Record<string, Record<string, string>> = {
  en: flatten(CATALOGS.en),
  zh: flatten(CATALOGS.zh),
};

// ── What counts as an absolute non-egress claim ──────────────────────────────
//
// Deliberately narrow: only sentences that assert data does not leave / is not
// uploaded. Phrases that are merely *about* locality ("stored in the local
// vault", "runs on this machine") are not claims about egress and are not
// swept in — a fence that flags everything gets an allowlist the size of the
// catalog and stops meaning anything.

const CLAIM_PATTERNS: { id: string; re: RegExp }[] = [
  { id: 'en:never-leaves-device', re: /never leaves (this|your|the) (device|machine|box|computer|host)/i },
  { id: 'en:does-not-leave-device', re: /does not leave (this|your|the) (device|machine|box|computer|host)/i },
  { id: 'en:all-data-stays', re: /all (of your |your )?data stays/i },
  { id: 'en:never-uploaded', re: /never uploaded|never sent to|is never sent|are never sent/i },
  { id: 'zh:not-leave-host', re: /不出本机|不(会)?离开本机/ },
  { id: 'zh:all-data-local', re: /所有数据[^。；]{0,12}(本机|本地)/ },
  { id: 'zh:never-uploaded', re: /从不上传|绝不上传|不会上传|永不上传/ },
  { id: 'zh:text-stays-local', re: /(原文|正文)[^。；，]{0,10}(只留在本机|留在本机|保留在本机)/ },
];

const claimsIn = (text: string) => CLAIM_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.id);

// ── The allowlist ────────────────────────────────────────────────────────────
//
// One entry per i18n key (claims in en and zh of the same key share an entry —
// they are one sentence in two languages). `why` must state the SUBJECT the
// claim is scoped to and what makes it true for that subject. "It's fine" does
// not pass the length check below, on purpose.

type Allowed = { key: string; why: string };

const ALLOWED: Allowed[] = [
  {
    key: 'trustCheck.disclaimerDataLocalTail',
    why:
      'Subject is scoped to Trust Check (zh 降智检测) by the prefix key, and the sentence enumerates what does not go up: probe Q&A, observation metrics, KEYs, Check results. trust-local writes only to ~/.aikey/data/trust-local/trust_local.sqlite and its only outbound call is a READ of the trust-central arbitration stub. The tail also explicitly refuses to speak for the other lanes, which is what the unqualified predecessor ("所有数据均保留在你的本机上") wrongly did.',
  },
  {
    key: 'trustCheck.localDescription',
    why:
      'Scoped to what trust_local.sqlite holds, and that inventory is now stated: probe questions/answers, per-chat timing metrics and hit flags. Verified against server_local/storage/models.py — an `observation` row payload is {sse_summary, d_hits} and a `cascade_verify` row is the probe\'s own Q&A. The user\'s conversation text is NOT in this DB, and the sentence now says so rather than claiming "your prompts and answers stay on disk", which named exactly the data the conversation-audit lane uploads.',
  },
  {
    key: 'compliancePage.pageDescription',
    why:
      'Scoped to the compliance event: the matched original is never uploaded WITH THE COMPLIANCE EVENT (mayCarryRawSnippet keeps context_snippet off the intake wire; DisallowUnknownFields 400s it structurally). The sentence then states outright that this says nothing about another lane retaining the conversation text — needed because a Personal user can also be a team member whose proxy is capturing for conversation audit.',
  },
  {
    key: 'settings.compliance.description',
    why:
      'Same compliance-lane scoping as compliancePage.pageDescription, plus the fact a reader of a TOGGLE needs: this switch does not govern the conversation-audit lane, so turning compliance detection off does not stop conversation capture.',
  },
  {
    key: 'vault.keyDerivationTail',
    why:
      'Different subject — the vault MASTER PASSWORD, not user content. It is consumed locally by the KDF to unwrap the vault; nothing derived from it is transmitted. Pre-existing string, unchanged by the 2026-08-10c privacy-copy audit, and re-stated here only so the scan has a reason on file rather than a silent exemption.',
  },
  {
    key: 'vault.secretHelp',
    why:
      'Different subject — a credential the user types into the add-key form, which is encrypted into the local vault. ⚠️ OUT OF SCOPE of the 2026-08-10c audit (that pass covered conversation/original TEXT claims only) and NOT re-verified against the vault-bridge write path here. Listed so the scan stays green without hiding it; if someone audits credential-material copy, start with this entry.',
  },
];

const ALLOWED_KEYS = new Set(ALLOWED.map((a) => a.key));

// ─────────────────────────────────────────────────────────────────────────────

describe('privacy claims in the i18n catalogs are scoped to a lane', () => {
  it('🔴 every "never leaves / never uploaded" claim is on the allowlist', () => {
    const offenders: string[] = [];
    for (const [locale, flat] of Object.entries(FLAT)) {
      for (const [key, text] of Object.entries(flat)) {
        const hits = claimsIn(text);
        if (hits.length && !ALLOWED_KEYS.has(key)) {
          offenders.push(`${locale}.${key} [${hits.join(',')}] → ${text.slice(0, 160)}`);
        }
      }
    }
    expect(
      offenders,
      'A user-facing string asserts data never leaves this machine. aikey has TWO lanes and the\n' +
        'conversation-audit one uploads the full prompt and reply whenever the org switch is on\n' +
        '(the Cluster default). Either scope the sentence to a lane, or add an entry to ALLOWED\n' +
        'here explaining why the claim holds for that subject.\n' +
        'Contract: workflow/CI/requirements/2026-08-10-compliance-event-conversation-turn-join-key.md §7\n\nOffenders:\n',
    ).toEqual([]);
  });

  it('🔴 every allowlist entry carries an actual justification', () => {
    for (const { key, why } of ALLOWED) {
      expect(why.length, `ALLOWED[${key}].why must say what the claim is scoped to and why it holds`)
        .toBeGreaterThan(120);
    }
    expect(new Set(ALLOWED.map((a) => a.key)).size, 'duplicate allowlist keys').toBe(ALLOWED.length);
  });

  it('🔴 the allowlist does not rot into a blanket exemption', () => {
    // An entry whose string no longer makes any claim is a standing permission
    // for a future edit to re-introduce one silently. Prune it instead.
    const stale: string[] = [];
    for (const { key } of ALLOWED) {
      const present = Object.values(FLAT).some((flat) => key in flat);
      if (!present) continue; // key belongs to the peer repo's catalog only
      const stillClaims = Object.values(FLAT).some((flat) => flat[key] && claimsIn(flat[key]).length > 0);
      if (!stillClaims) stale.push(key);
    }
    expect(stale, 'these keys no longer make a non-egress claim — remove them from ALLOWED').toEqual([]);
  });
});

describe('the four sentences fixed on 2026-08-10c stay fixed', () => {
  const en = (k: string) => FLAT.en[k];
  const zh = (k: string) => FLAT.zh[k];

  it('🔴 the Trust Check disclaimer names the feature instead of claiming "all data"', () => {
    // The bold main clause used to be an unlimited whole-system assertion, with
    // the scope arriving only in the trailing sentence — i.e. after the part a
    // reader actually takes away.
    const prefixEn = en('trustCheck.disclaimerDataLocalPrefix');
    const prefixZh = zh('trustCheck.disclaimerDataLocalPrefix');
    expect(prefixEn, 'the subject must be the feature, not "all data"').toMatch(/trust check/i);
    expect(prefixEn).not.toMatch(/all (of your |your )?data/i);
    expect(prefixZh, 'zh 功能名 per requirements/2026-07-03-trust-check-zh-naming.md').toMatch(/降智检测/);
    expect(prefixZh).not.toMatch(/所有数据/);
    // …and the tail must keep refusing to speak for the other lanes.
    expect(en('trustCheck.disclaimerDataLocalTail')).toMatch(/conversation audit/i);
    expect(zh('trustCheck.disclaimerDataLocalTail')).toMatch(/对话审计/);
  });

  it('🔴 the trust-local tooltip does not claim the user\'s prompts and answers stay local', () => {
    // "your prompts, answers, and KEYs stay on disk" was wrong twice over:
    // trust_local.sqlite does not hold conversation text at all, and that text
    // is precisely what conversation audit uploads.
    const enText = en('trustCheck.localDescription');
    const zhText = zh('trustCheck.localDescription');
    expect(enText, 'must not name the user\'s prompts/answers as the thing kept local')
      .not.toMatch(/your prompts[^.]{0,60}(stay|remain)/i);
    expect(zhText).not.toMatch(/你的提示[^。]{0,30}(保留在本地|留在本地)/);
    expect(enText, 'must state the inventory excludes conversation text')
      .toMatch(/not the text of your conversations/i);
    expect(zhText).toMatch(/不含你与模型对话的正文/);
  });

  it('🔴 the compliance self-view header scopes its claim to the compliance event', () => {
    const enText = en('compliancePage.pageDescription');
    const zhText = zh('compliancePage.pageDescription');
    expect(enText, 'the unqualified sentence must not come back')
      .not.toMatch(/never leaves your device/i);
    expect(zhText).not.toMatch(/原文不会离开本机/);
    expect(enText, 'the claim must be tied to the compliance event').toMatch(/with the compliance event/i);
    expect(zhText).toMatch(/不随合规事件上报/);
    // The reason this page in particular needed it: a Personal user can also be
    // a team member whose proxy is capturing, so silence here reads as a promise.
    expect(enText).toMatch(/conversation audit/i);
    expect(zhText).toMatch(/对话审计/);
  });

  it('🔴 the compliance toggle says what it does NOT govern', () => {
    // Only aikey-control ships this settings card; skip cleanly on the peer.
    const enText = en('settings.compliance.description');
    if (enText === undefined) return;
    const zhText = zh('settings.compliance.description');
    expect(enText).not.toMatch(/never leaves this machine/i);
    expect(zhText).not.toMatch(/原文不会离开本机/);
    expect(enText, 'a toggle must say the other lane is not affected').toMatch(/conversation audit/i);
    expect(zhText).toMatch(/对话审计/);
  });
});

describe('dual-edit', () => {
  it('🔴 this fence is byte-identical in aikey-control/web and aikey-control-master/web', () => {
    // Both catalogs carry these strings (master mirrors the reused pages), so a
    // one-sided edit means one console's copy is unguarded.
    let peer: string;
    try {
      peer = read(PEER_WEB_ROOT, SELF);
    } catch {
      // Peer repo not checked out (single-repo CI). Nothing to compare; the
      // scan above still fully protects this repo's own catalogs.
      return;
    }
    expect(peer, `${SELF} drifted between the two web repos — dual-edit it`).toBe(read(WEB_ROOT, SELF));
  });
});
