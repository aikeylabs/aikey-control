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
 *   · COMPLIANCE lane (`compliance_findings`) — 🔴 **as of 2026-08-11 this lane
 *     ALSO uploads original text.** It used not to: `mayCarryRawSnippet` was
 *     `LocalIntake && !team` and master's wire had no `context_snippet` field at
 *     all. The user overturned that (three rulings: 原文可以出本机 · 合规事件可以
 *     携带原文 · 出厂默认开启), so the gate is now TIERED —
 *     `team === false → LocalIntake` (Personal, unchanged) and
 *     `team === true → PrivacyTier >= 3`, where the tier is the server-pushed
 *     org policy `organizations.compliance_privacy_tier`. A fresh Team/Cluster
 *     install SEEDS tier 3, so out of the box an employee's matched original
 *     (<=512 bytes, kept 90 days) lands on the org's own team server.
 *     An UPGRADE keeps schema DEFAULT 1, so existing customers do not silently
 *     start collecting. Both facts have to appear in the copy.
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
 * ══ WHAT SURVIVED THE 2026-08-11 REVERSAL, AND WHAT DID NOT ════════════════
 *
 * The reversal narrows the promise; it does not delete it. Keep these apart:
 *
 *   ❌ VOID  「原文不出本机」/ "never leaves this machine"   — both lanes.
 *   ❌ VOID  「命中原文不随合规事件上报」/ "never uploaded with the compliance
 *            event" — this was the phrasing THIS FILE used to REQUIRE, on the
 *            reasoning that scoping to the compliance lane made it safe. The
 *            scope no longer saves it.
 *   ✅ TRUE  「原文不出客户信任边界」 — the snippet lands on the CUSTOMER'S OWN
 *            server and never on an AiKey one. This is the contract sentence.
 *   ✅ TRUE  「检测在本机进行」 — detection genuinely runs in the local detector.
 *   ✅ TRUE  「个人版原文只留在本机」 — the `team === false` branch is untouched.
 *
 * ⇒ The direction of every fix is "narrow toward the half that is still true",
 *   never "delete the promise" and never "claim we upload everything".
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
 *   - restore "命中原文不随合规事件上报" / "never uploaded with the compliance
 *     event" anywhere → red (the 2026-08-11 assertions below). This is the one
 *     that a well-meaning editor is most likely to "restore", because it reads
 *     like a privacy improvement and it is what the older docs still say.
 *   - drop the default-on disclosure from either compliance-lane string → red.
 *     Shipping "we may upload" without "and a fresh install already does" is
 *     the incomplete-notice failure this reversal is most likely to produce.
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
  // 🔴 2026-08-11 — the blind spot that let the worst sentence in the tree ship.
  // `complianceMy.originalNotRetained` read "a compliance event never carries the
  // original text" / 「合规事件本身从不携带原文」 and NONE of the patterns above
  // matched it: it says "carries", not "leaves" or "uploaded". The scan is
  // supposed to cover the CONCEPT "asserts content does not go up", so a verb
  // this file had not thought of is a hole in the concept, not a missing string.
  { id: 'en:never-carries', re: /never carries|does not carry|carries no (original|raw|prompt)/i },
  { id: 'zh:never-carries', re: /(从不|绝不|永不|不)携带原文/ },
  // 🔴 2026-08-11 — the claim this very file used to REQUIRE. It is now false on
  // Team/Cluster, so it must be swept like any other absolute claim; without
  // this pattern, "restoring" it would go green.
  { id: 'en:not-with-compliance-event', re: /(never|not) uploaded with the compliance event/i },
  { id: 'zh:not-with-compliance-event', re: /不随合规事件上报/ },
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
      '🔴 REWRITTEN 2026-08-11. The claim that survives here is scoped to the PERSONAL edition ("个人版：命中原文只留在本机"), where mayCarryRawSnippet still evaluates `ictx.LocalIntake` on the `team === false` branch and nothing uploads the raw text at all. The sentence no longer makes any claim for Team/Cluster — it states the opposite outright, including the 512-byte cap, the 90-day retention, the fact that a fresh install has this ON, and the one promise that did survive: the snippet reaches the org\'s OWN server and never an AiKey one. The previous rationale ("never uploaded WITH THE COMPLIANCE EVENT ... DisallowUnknownFields 400s it structurally") is void: the wire now has the field and master strips-by-policy instead of rejecting.',
  },
  {
    key: 'settings.compliance.description',
    why:
      '🔴 REWRITTEN 2026-08-11. Same Personal-scoped surviving claim as compliancePage.pageDescription, plus the two things a reader of a TOGGLE specifically needs: (1) this switch does not govern the conversation-audit lane, so turning compliance detection off does not stop conversation capture; (2) turning it ON is what starts the snippet upload on Team/Cluster, and on a fresh install the org policy already permits it — a toggle whose copy hides its own default is the incomplete-notice failure mode.',
  },
  {
    key: 'vault.keyDerivationTail',
    why:
      'Different subject — the vault MASTER PASSWORD, not user content. It is consumed locally by the KDF to unwrap the vault; nothing derived from it is transmitted. Pre-existing string, unchanged by the 2026-08-10c privacy-copy audit, and re-stated here only so the scan has a reason on file rather than a silent exemption.',
  },
  {
    key: 'vault.secretHelp',
    why:
      'Different subject — a credential the user types into the add-key form, which is encrypted into the local vault. 🔴 VERIFIED 2026-08-11 (the entry above used to say "NOT re-verified"; that caveat is now discharged). Write path is POST /api/user/vault/entry, and /api/user/ is LOCAL-owned by construction in the composing gateway — teamAPIPrefixes lists only B-owned namespaces and the dispatch falls through to the local handler by default, so a team-logged-in user typing a key here still writes to the local vault, not to the org server. Handlers: service/pkg/userapi/handlers.go:215-219 and appkit/user-local/handler.go:21-23. No push/sync path exists that sends personal vault material to an AiKey or org server, and the key is only used in aikey-control (control-master mirrors the catalog string but mounts no page that renders it). The cluster EmployeeKeyMode="central" case does not weaken this: it moves material the OTHER way (central node -> use site, and in central mode the real key never lands on the employee machine at all), so it is not an upload of this field. Scope of "never uploaded" = never to AiKey or your org server; it is NOT a claim that the credential never travels the network — the pre-save probe (/api/user/vault/test-raw, plaintext in body to the LOCAL server) and ordinary proxying both present it to the PROVIDER, which is the credential\'s whole purpose and is what a reader of an add-key form understands.',
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

  it('🔴 the compliance self-view header scopes its claim to the EDITION, not the lane', () => {
    const enText = en('compliancePage.pageDescription');
    const zhText = zh('compliancePage.pageDescription');
    expect(enText, 'the unqualified sentence must not come back')
      .not.toMatch(/never leaves your device/i);
    expect(zhText).not.toMatch(/原文不会离开本机/);
    // 🔴 2026-08-11 — INVERTED. This pair used to be
    //     expect(enText).toMatch(/with the compliance event/i)
    //     expect(zhText).toMatch(/不随合规事件上报/)
    // i.e. the fence REQUIRED the sentence that is now false. Deleting the pair
    // outright would have lost the guard entirely, so it is inverted rather than
    // removed: the exact claim the fence once mandated is now the one it forbids.
    expect(enText, 'the compliance lane DOES upload a snippet on Team/Cluster now')
      .not.toMatch(/never uploaded with the compliance event/i);
    expect(zhText).not.toMatch(/不随合规事件上报/);
    // What replaces it: the copy must actually SAY the upload happens, name the
    // destination as the customer's own server (the promise that survived), and
    // — the part most likely to be dropped — say a fresh install already does it.
    expect(enText, 'must disclose that the snippet is uploaded').toMatch(/uploaded with the compliance event/i);
    expect(zhText).toMatch(/随合规事件上传/);
    expect(enText, 'must name the destination as the org\'s own server').toMatch(/own team server/i);
    expect(zhText).toMatch(/组织自建的团队服务端/);
    expect(enText, '🔴 default-on must be disclosed, not just "may"').toMatch(/by default/i);
    expect(zhText).toMatch(/默认开启/);
    // The surviving promise must still be stated, or the copy over-corrects into
    // "we upload everything" — which is its own kind of false notice.
    expect(enText, 'the trust-boundary promise must survive').toMatch(/never reaches any AiKey server/i);
    expect(zhText).toMatch(/不会进入 AiKey/);
    // The reason this page in particular needed it: a Personal user can also be
    // a team member whose proxy is capturing, so silence here reads as a promise.
    expect(enText).toMatch(/conversation audit/i);
    expect(zhText).toMatch(/对话审计/);
  });

  it('🔴 the compliance toggle says what it does NOT govern, and what it defaults to', () => {
    // Only aikey-control ships this settings card; skip cleanly on the peer.
    const enText = en('settings.compliance.description');
    if (enText === undefined) return;
    const zhText = zh('settings.compliance.description');
    expect(enText).not.toMatch(/never leaves this machine/i);
    expect(zhText).not.toMatch(/原文不会离开本机/);
    // 🔴 2026-08-11 — same inversion as above.
    expect(enText).not.toMatch(/never uploaded with the compliance event/i);
    expect(zhText).not.toMatch(/不随合规事件上报/);
    expect(enText, 'a toggle must say the other lane is not affected').toMatch(/conversation audit/i);
    expect(zhText).toMatch(/对话审计/);
    expect(enText, '🔴 a toggle must disclose its own default').toMatch(/by default/i);
    expect(zhText).toMatch(/默认开启/);
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
