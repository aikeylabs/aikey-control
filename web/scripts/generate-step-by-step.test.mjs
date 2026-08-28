/**
 * The step-by-step codegen's own tests (2026-08-25).
 *
 * # Why this file exists
 *
 * The generator hard-failed on every markdown TABLE row, and §4 of the delivery
 * doc grew two tables — so `npm run build` broke in both control webs (their
 * `prebuild` runs this script) and in release.sh's Web-user / Web-prod builds.
 * Nothing caught it, because this generator had no tests at all: its only fence
 * was the throw itself, and a throw is only useful if someone runs the script.
 *
 * These drive the REAL script in a child process over tiny fixtures, the same
 * way generate-provider-registry.test.mjs does. A test that re-implements the
 * renderer passes whenever both copies share a misunderstanding, which is
 * exactly the class of bug being fenced here.
 *
 * # What is deliberately NOT relaxed
 *
 * The generator throws on shapes it cannot render, and half of these cases
 * assert it still does. The bug was never "it fails loudly" — it was "it cannot
 * render a table". A renderer that quietly skips unknown shapes would have
 * dropped a compatibility matrix out of the employee walkthrough silently, and
 * the first person to notice would have been a customer.
 *
 * Docs: workflow/CI/bugfix/20260825-step-by-step-codegen-cannot-render-tables.md
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, 'generate-step-by-step.mjs');

/** The heading the script anchors §4 extraction on. Every fixture needs it. */
const H2 = '## 4. 员工：安装 + 日常使用';

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aikey-stepbystep-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Run the real generator over a fixture. Returns {ok, stderr, html}. */
function run(markdown, { files = {} } = {}) {
  const md = path.join(tmp, 'fixture.md');
  fs.writeFileSync(md, markdown, 'utf8');
  for (const [rel, content] of Object.entries(files)) {
    const dest = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  }
  const out = path.join(tmp, 'out');
  try {
    execFileSync(process.execPath, [SCRIPT], {
      env: {
        ...process.env,
        AIKEY_CODEGEN_STEPBYSTEP_MD: md,
        AIKEY_CODEGEN_STEPBYSTEP_OUT_DIR: out,
      },
      stdio: 'pipe',
    });
  } catch (err) {
    return { ok: false, stderr: String(err.stderr ?? '') + String(err.stdout ?? ''), html: '' };
  }
  return { ok: true, stderr: '', html: fs.readFileSync(path.join(out, 'index.html'), 'utf8') };
}

/** Collapse whitespace so assertions read like the markup, not like the file. */
const flat = (s) => s.replace(/\s+/g, ' ');

describe('tables render (the shape that broke the build on 2026-08-25)', () => {
  const TABLE = [
    H2,
    '',
    '| 线路 | 关键路径 |',
    '|---|---|',
    '| 环境准备 | Windows 11 机器 |',
    '| 个人版安装 | 执行安装脚本 |',
    '',
  ].join('\n');

  it('emits a real table, header row separate from body rows', () => {
    const { ok, html, stderr } = run(TABLE);
    expect(ok, stderr).toBe(true);
    expect(flat(html)).toContain('<th>线路</th><th>关键路径</th>');
    expect(flat(html)).toContain('<td>环境准备</td><td>Windows 11 机器</td>');
    expect(flat(html)).toContain('<td>个人版安装</td><td>执行安装脚本</td>');
    // 🔴 The delimiter row is structure, not content. Rendering it as a body row
    // of dashes is the failure mode that looks fine in a diff and awful on screen.
    expect(html).not.toMatch(/<td>\s*-+\s*<\/td>/);
  });

  it('wraps the table so a wide matrix scrolls in its own box', () => {
    // The page column is 820px; these matrices are four columns of prose. A
    // table that overflows the BODY makes the whole page scroll sideways on a
    // phone, which is how the rest of the walkthrough becomes unreadable.
    const { html } = run(TABLE);
    expect(html).toMatch(/<div class="table-wrap"><table>/);
    expect(html).toContain('.table-wrap{');
    expect(html).toContain('overflow-x:auto');
  });

  it('runs inline markdown inside cells (bold, code, links)', () => {
    const md = [
      H2,
      '',
      '| 能力 | 怎么用 |',
      '|---|---|',
      '| **CLI** | 跑 `aikey login` |',
      '| 文档 | [官网](https://aikeylabs.com) |',
      '',
    ].join('\n');
    const { ok, html, stderr } = run(md);
    expect(ok, stderr).toBe(true);
    expect(html).toContain('<td><strong>CLI</strong></td>');
    expect(html).toContain('<code>aikey login</code>');
    expect(html).toContain('<a href="https://aikeylabs.com" target="_blank"');
  });

  it('degrades a doc-relative link in a cell to text, not a dead href', () => {
    // Same rule the rest of the renderer follows: this page is not the doc tree,
    // so `#41-…` and `X.md` have no destination here. A link that goes nowhere
    // is worse than bold text, because the reader only finds out by clicking.
    const md = [H2, '', '| 去哪一节 |', '|---|', '| [§4.1](#41-装客户端离线包) |', ''].join('\n');
    const { ok, html } = run(md);
    expect(ok).toBe(true);
    expect(html).toContain('<span class="doc-ref">§4.1</span>');
    expect(html).not.toContain('href="#41-');
  });

  it('keeps an escaped pipe inside one cell', () => {
    const md = [H2, '', '| 值 | 说明 |', '|---|---|', '| a \\| b | 一个值 |', ''].join('\n');
    const { ok, html, stderr } = run(md);
    expect(ok, stderr).toBe(true);
    expect(html).toContain('<td>a | b</td>');
    expect(html).toContain('<td>一个值</td>');
  });

  it('renders the tables the real §4 actually contains', () => {
    // Guards the specific regression: the doc in the tree must build. If §4 grows
    // a shape this renderer cannot handle, this reds here rather than in whoever's
    // release is running that day.
    const real = path.resolve(
      __dirname,
      '../../../workflow/Docs/enterprise-delivery/快速开始.md',
    );
    if (!fs.existsSync(real)) {
      // Standalone checkout: the private workflow tree is absent. Skipping is
      // honest here — the committed output is what ships in that case.
      return;
    }
    const source = fs.readFileSync(real, 'utf8');
    // 🔴 Stand in for the screenshots. Without them the image fence fires first
    // and this case returns having asserted NOTHING about rendering — a green
    // test over the wrong subject, which is worse than no test. (First draft of
    // this file did exactly that.) The bytes are irrelevant; only existence is
    // checked, and the image fence itself is covered by its own cases above.
    const files = Object.fromEntries(
      [...source.matchAll(/^!\[[^\]]*\]\(([^)]+)\)\s*$/gm)].map((m) => [m[1], 'x']),
    );
    const { ok, html, stderr } = run(source, { files });
    expect(ok, stderr).toBe(true);
    // Both of §4's tables, rendered — not merely "did not throw".
    expect(html.match(/<div class="table-wrap"><table>/g) ?? []).toHaveLength(2);
    expect(html).toContain('<th>线路</th>');
    expect(html).toContain('<th>能力项</th>');
  });
});

describe('shapes it cannot render still fail loudly', () => {
  it('a |row| with no delimiter row is refused, and says so', () => {
    const md = [H2, '', '| a | b |', '| c | d |', ''].join('\n');
    const { ok, stderr } = run(md);
    expect(ok).toBe(false);
    expect(stderr).toMatch(/delimiter row/);
  });

  it('a body row with the wrong cell count is refused', () => {
    // Markdown viewers pad or drop the mismatch silently — so the author ships a
    // table with a column missing and nothing tells them.
    const md = [H2, '', '| a | b |', '|---|---|', '| only-one |', ''].join('\n');
    const { ok, stderr } = run(md);
    expect(ok).toBe(false);
    expect(stderr).toMatch(/has 1 cells, header has 2/);
  });

  it('an unstyled heading level is still refused', () => {
    // The original fence, unchanged: this page styles h2/h3/h4 only.
    const md = [H2, '', '##### 太深的标题', ''].join('\n');
    const { ok, stderr } = run(md);
    expect(ok).toBe(false);
    expect(stderr).toMatch(/unrenderable markdown line shape/);
  });

  it('a referenced screenshot that does not exist is refused', () => {
    const md = [H2, '', '![装完的样子](assets/nope.png)', ''].join('\n');
    const { ok, stderr } = run(md);
    expect(ok).toBe(false);
    expect(stderr).toMatch(/screenshots missing/);
  });

  it('a screenshot that exists is copied next to the page', () => {
    const md = [H2, '', '![装完的样子](assets/shot.png)', ''].join('\n');
    const { ok, stderr } = run(md, { files: { 'assets/shot.png': 'not-really-a-png' } });
    expect(ok, stderr).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'out/assets/shot.png')).valueOf()).toBe(true);
  });
});

describe('the fixture harness is not vacuous', () => {
  it('a plain paragraph fixture really produces the page', () => {
    // If the env overrides silently stopped working, every "ok" above would be
    // measuring the committed output or an empty file instead of this run.
    const { ok, html, stderr } = run([H2, '', '一段普通文字。', ''].join('\n'));
    expect(ok, stderr).toBe(true);
    expect(html).toContain('<p>一段普通文字。</p>');
    expect(html).toContain('<h2>4. 员工：安装 + 日常使用</h2>');
  });
});
