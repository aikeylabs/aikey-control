// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const EN = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'src/shared/i18n/locales/en/common.json'), 'utf-8'));
const ZH = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'src/shared/i18n/locales/zh/common.json'), 'utf-8'));
const OWN_MENU = fs.readFileSync(path.resolve(process.cwd(), 'src/shared/cross-app-menu/own-menu.ts'), 'utf-8');
const SHELL = fs.readFileSync(path.resolve(process.cwd(), 'src/layouts/UserShell.tsx'), 'utf-8');

// 2026-08-10 term unification: the page formerly called "Agents" is
// en "Access Token" / zh "令牌管理", and it moved from the APPS sidebar group to
// KEYS (user decisions).
//
// Two things this has to keep straight, and both are easy to break by a careless
// find-and-replace in either direction:
//
//  1. "Agent" now means ONLY the third-party tool (Claude Code / Codex) that
//     consumes a token. Copy that talks about that tool must KEEP the word —
//     resolving the pun was the whole point of the rename.
//  2. zh is 令牌, deliberately NOT the transliteration "Token": the billing unit
//     (input_tokens / token 配额) is also called token and sits two menu items
//     away under 用量.
describe('Access Token term unification (was "Agents")', () => {
  it('names the page Access Token / 令牌管理 everywhere it identifies itself', () => {
    expect(EN.userShell.navMyAgents).toBe('Access Token');
    expect(ZH.userShell.navMyAgents).toBe('访问令牌');
    expect(EN.accessTokens.title).toBe('ACCESS TOKEN');
    expect(ZH.accessTokens.title).toBe('访问令牌');
    // The label is also a logic anchor: NAV_LABEL_I18N_KEY is keyed BY the label
    // string, so a label change that misses this map silently drops translation.
    expect(SHELL).toContain("'Access Token': 'navMyAgents'");
  });

  it('keeps zh on 令牌, never the transliteration "Token 管理"', () => {
    expect(ZH.userShell.navMyAgents).not.toMatch(/Token/);
    expect(ZH.accessTokens.title).not.toMatch(/Token/);
  });

  it('sits in the KEYS group, beside the other credential surfaces', () => {
    // own-menu.ts is the TS half of the cross-app contract; personal_menu.go is
    // the Go half and ts_drift_test asserts id+path parity between them.
    expect(OWN_MENU).toMatch(/id: 'personal-access-tokens',\s*\n\s*group: 'KEYS',/);
    // In the shell the item must live in the Keys group's items array — pinned by
    // its neighbour, since Team OAuth is what it was placed after.
    const keysBlock = SHELL.slice(SHELL.indexOf("title: 'Keys'"), SHELL.indexOf("title: 'Cost'"));
    expect(keysBlock).toContain("path: '/user/access-tokens'");
    expect(keysBlock).toContain("label: 'Access Token'");
  });

  it('leaves the third-party-tool sense of "agent" alone', () => {
    // These three strings describe the CONSUMING product, not the seat. If a
    // later sweep renames them the copy starts telling users to point their
    // "third-party access token" at a base URL, which is meaningless.
    expect(EN.accessTokens.create.connHint).toMatch(/third-party agent/);
    expect(ZH.accessTokens.create.connHint).toMatch(/第三方 Agent/);
    expect(EN.accessTokens.vk.hint).toMatch(/third-party agent/);
    expect(ZH.accessTokens.vk.hint).toMatch(/第三方 Agent/);
    expect(EN.accessTokens.vk.rotateConfirm.body).toMatch(/third-party agent/);
    expect(ZH.accessTokens.vk.rotateConfirm.body).toMatch(/第三方 Agent/);
    // The empty state carries BOTH senses in ONE sentence — the sharpest test
    // that the rename was done by meaning and not by substitution. Assert the
    // two senses coexist, NOT the exact wording: an earlier version pinned the
    // sentence tail and went red on a legitimate copy edit, which trains people
    // to weaken the fence instead of reading it.
    expect(EN.accessTokens.empty).toMatch(/access tokens/);      // the seat sense
    expect(EN.accessTokens.empty).toMatch(/third-party agent/);  // the tool sense
    expect(ZH.accessTokens.empty).toMatch(/访问令牌/);
    expect(ZH.accessTokens.empty).toMatch(/第三方 Agent/);
  });

  // 2026-08-10 round 2 (user decision): 令牌 and VK are DIFFERENT products, not
  // two names for one thing — they are two different routes:
  //   令牌 / Access Token  → prefix aikey_team_oauth_*, goes to the centralized
  //                          ingress gateway → hub → worker → OAuth account pool.
  //                          For agents running on a server (user's laptop can be off).
  //   VK / 虚拟密钥        → bare-hex token used by the LOCAL aikey-proxy, resolved
  //                          through a binding to one provider credential.
  // So the token page must speak only of 令牌; VK stays the Team Keys vocabulary.
  it('never says VK on the token page — that word belongs to the local-proxy route', () => {
    const walk = (o: unknown, p = ''): [string, string][] =>
      typeof o === 'string' ? [[p, o]]
        : o && typeof o === 'object'
          ? Object.entries(o).flatMap(([k, v]) => walk(v, p ? `${p}.${k}` : k))
          : [];
    for (const [lang, dict] of [['en', EN], ['zh', ZH]] as const) {
      for (const [key, value] of walk(dict.accessTokens)) {
        expect(value, `${lang} accessTokens.${key} still says VK/虚拟密钥`)
          .not.toMatch(/\bVK\b|虚拟密钥|[Vv]irtual key/);
      }
    }
  });

  it('leaves VK as the Team Keys vocabulary elsewhere', () => {
    // The counterpart of the rule above: this is a SPLIT, not a global purge.
    // If a later sweep renames these too, the local-proxy route loses its name.
    expect(ZH.vault.virtualKey).toMatch(/虚拟密钥/);
  });

  it('no longer calls the seat an agent in its own copy', () => {
    for (const [lang, dict] of [['en', EN], ['zh', ZH]] as const) {
      const seatSense = lang === 'en'
        ? [dict.accessTokens.cardAll, dict.accessTokens.subtitle, dict.accessTokens.newAgent, dict.accessTokens.loadError]
        : [dict.accessTokens.cardAll, dict.accessTokens.subtitle, dict.accessTokens.newAgent, dict.accessTokens.loadError];
      for (const s of seatSense) {
        expect(s, `${lang}: "${s}" still calls the seat an agent`).not.toMatch(/agent/i);
      }
    }
  });
});
