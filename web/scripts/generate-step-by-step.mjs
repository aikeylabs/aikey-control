#!/usr/bin/env node
/**
 * Codegen: workflow/Docs/enterprise-delivery/快速开始.md §4 (员工：安装 + 日常使用)
 *          → public/step-by-step/index.html (+ copied screenshots)
 *
 * Why build-time rather than runtime (user decision 2026-08-18):
 *   The employee walkthrough IS the delivery doc — rendering it at build time
 *   keeps a single source of truth (edit the markdown, rebuild, done), adds no
 *   endpoint, no runtime parser, and ships as plain static files every edition
 *   already serves. The CLI Guide links here ("完整图文步骤").
 *
 * Outputs to ALL THREE web trees (same pattern as generate-provider-registry:
 *   one script, cross-repo writes, outputs checked into git so a standalone
 *   checkout builds without the private workflow tree):
 *   - aikey-control/web/public/step-by-step/
 *   - aikey-control-master/web/public/step-by-step/
 *   - aikey-trial-server/web/public/step-by-step/
 *
 * Fences:
 *   - Source present + a referenced image missing → HARD FAIL (exit 1).
 *   - Source tree absent (external checkout) → keep committed output, warn.
 *   - A markdown line shape this mini-renderer does not understand → HARD
 *     FAIL, so new syntax in the doc can never render as silent garbage.
 *
 * 2026-08-25 — TABLES. §4 grew a "这一段的三个关卡" summary table and a
 * capability/compatibility matrix, and this renderer threw on every `|` line,
 * which blocked `npm run build` in BOTH control webs (their `prebuild` runs this
 * script) and therefore release.sh's Web-user and Web-prod builds too.
 *
 * 🔴 The throw was right and stays. The bug was not "it fails loudly", it was
 * "it cannot render a table" — so the fix teaches it tables rather than making
 * the fence lenient. A renderer that skips shapes it does not know would have
 * dropped a compatibility matrix off the employee walkthrough and told no one.
 * Docs: workflow/CI/bugfix/20260825-step-by-step-codegen-cannot-render-tables.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..'); // aikeylabs/

// Test-only overrides, same convention as generate-provider-registry.mjs
// (AIKEY_CODEGEN_*). They exist so the tests can drive THIS script — real child
// process, real exit codes — over tiny fixtures, instead of re-implementing the
// renderer in the test and passing whenever both copies share a misunderstanding.
// 🚫 Never set in any build, make target or release path.
const SRC_MD =
  process.env.AIKEY_CODEGEN_STEPBYSTEP_MD ||
  path.join(repoRoot, 'workflow/Docs/enterprise-delivery/快速开始.md');
// Screenshots are resolved relative to the markdown, so a fixture that
// references one only needs to put it next to the fixture.
const SRC_ASSETS = path.dirname(SRC_MD);
const OUT_TREES = process.env.AIKEY_CODEGEN_STEPBYSTEP_OUT_DIR
  ? [process.env.AIKEY_CODEGEN_STEPBYSTEP_OUT_DIR]
  : [
      path.join(repoRoot, 'aikey-control/web/public/step-by-step'),
      path.join(repoRoot, 'aikey-control-master/web/public/step-by-step'),
      path.join(repoRoot, 'aikey-trial-server/web/public/step-by-step'),
    ];

if (!fs.existsSync(SRC_MD)) {
  console.warn(
    '⚠ step-by-step: source markdown not found (standalone checkout?) — keeping committed output as-is',
  );
  process.exit(0);
}

const md = fs.readFileSync(SRC_MD, 'utf8');
// §4 = from its own H2 to the next H2. Anchored on the heading text, not line
// numbers, so the doc can grow above it without breaking this extraction.
const start = md.indexOf('## 4. 员工：安装 + 日常使用');
if (start < 0) throw new Error('§4 heading not found in 快速开始.md — did the doc get restructured?');
const rest = md.slice(start);
const nextH2 = rest.indexOf('\n## ');
const section = nextH2 > 0 ? rest.slice(0, nextH2) : rest;

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Inline markdown: bold, inline code, links (doc-relative .md links become
// plain text — they have no web counterpart and a dead link is worse), images
// are handled at block level.
function inline(s) {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) =>
    /^https?:\/\//.test(href)
      ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`
      : `<span class="doc-ref">${text}</span>`,
  );
  return out;
}

/** Split one `| a | b |` row into its cells.
 *
 *  A `\|` inside a cell is an escaped pipe (the only way markdown lets a cell
 *  contain one) and is unescaped after the split, so `a \| b` stays ONE cell
 *  reading `a | b` rather than silently becoming two. */
function tableCells(row) {
  const inner = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}

/** `|---|:--:|` — the row markdown requires between a header and its body. */
function isTableDelimiterRow(row) {
  const cs = tableCells(row);
  return cs.length > 0 && cs.every((c) => /^:?-+:?$/.test(c));
}

const images = [];
const lines = section.split('\n');
const body = [];
let i = 0;
while (i < lines.length) {
  const line = lines[i];
  if (line.startsWith('```')) {
    const buf = [];
    i++;
    while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
    i++; // closing fence
    body.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
    continue;
  }
  if (line.startsWith('|')) {
    // A table is header + delimiter + N body rows; consume the whole run.
    const rows = [];
    while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
    // 🔴 Strict on purpose, in both directions:
    //   · no delimiter row → this is not a table, and guessing what it is would
    //     be the silent-garbage outcome the fences exist to prevent;
    //   · a body row with a different cell count → markdown viewers silently
    //     drop or pad the extras, so the doc author would never learn that the
    //     page they shipped is missing a column.
    if (rows.length < 2 || !isTableDelimiterRow(rows[1])) {
      throw new Error(
        `step-by-step: table without a |---| delimiter row (line: ${rows[0]})`,
      );
    }
    const header = tableCells(rows[0]);
    const bodyRows = rows.slice(2).map(tableCells);
    for (const r of bodyRows) {
      if (r.length !== header.length) {
        throw new Error(
          `step-by-step: table row has ${r.length} cells, header has ${header.length} (row: ${r.join(' | ')})`,
        );
      }
    }
    const head = header.map((c) => `<th>${inline(c)}</th>`).join('');
    const rowsHtml = bodyRows
      .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
      .join('');
    // Wrapped: these matrices are wider than the 820px column on a phone, and a
    // table that scrolls inside its own box beats a page that scrolls sideways.
    body.push(
      `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rowsHtml}</tbody></table></div>`,
    );
    continue;
  }
  if (/^#### /.test(line)) body.push(`<h4>${inline(line.slice(5))}</h4>`);
  else if (/^### /.test(line)) body.push(`<h3>${inline(line.slice(4))}</h3>`);
  else if (/^## /.test(line)) body.push(`<h2>${inline(line.slice(3))}</h2>`);
  else if (/^!\[/.test(line)) {
    const m = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (!m) throw new Error(`step-by-step: unrenderable image line: ${line}`);
    images.push(m[2]);
    body.push(`<figure><img src="${m[2]}" alt="${esc(m[1])}" loading="lazy"><figcaption>${inline(m[1])}</figcaption></figure>`);
  } else if (/^> /.test(line) || line === '>') {
    const buf = [];
    while (i < lines.length && (lines[i].startsWith('>') || lines[i] === '>')) {
      buf.push(lines[i].replace(/^>\s?/, ''));
      i++;
    }
    body.push(`<blockquote>${buf.map((l) => (l.trim() ? `<p>${inline(l)}</p>` : '')).join('')}</blockquote>`);
    continue;
  } else if (/^\s*[-*] /.test(line)) {
    const buf = [];
    while (i < lines.length && /^\s*[-*] /.test(lines[i])) {
      buf.push(`<li>${inline(lines[i].replace(/^\s*[-*] /, ''))}</li>`);
      i++;
    }
    body.push(`<ul>${buf.join('')}</ul>`);
    continue;
  } else if (line.trim() === '' || line.trim() === '---') {
    // blank / rule: paragraph separation handled by block tags
  } else if (/^#/.test(line)) {
    // Heading levels this page has no style for (h1, h5+). `|` is no longer
    // listed here because the branch above consumes every table row before
    // anything can reach this point.
    throw new Error(`step-by-step: unrenderable markdown line shape: ${line}`);
  } else {
    body.push(`<p>${inline(line)}</p>`);
  }
  i++;
}

// Image fence: every referenced screenshot must exist.
const missing = images.filter((rel) => !fs.existsSync(path.join(SRC_ASSETS, rel)));
if (missing.length) {
  console.error('✗ step-by-step: referenced screenshots missing:\n  ' + missing.join('\n  '));
  process.exit(1);
}

const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AiKey · 员工安装与日常使用 · 图文步骤</title>
<style>
:root{--bg:#18181b;--card:#27272a;--border:rgba(244,244,245,.085);--fg:#f4f4f5;
  --muted:#a1a1aa;--faint:#71717a;--primary:#facc15;--primary-dim:#ca8a04;
  --mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --sans:"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
*{box-sizing:border-box}
body{margin:0;background:
  radial-gradient(circle at 78% -10%,rgba(250,204,21,.05),transparent 32rem),#18181b;
  color:var(--fg);font:15px/1.7 var(--sans);-webkit-font-smoothing:antialiased}
header{position:sticky;top:0;z-index:10;height:56px;display:flex;align-items:center;
  justify-content:space-between;padding:0 24px;border-bottom:1px solid rgba(255,255,255,.05);
  background:rgba(0,0,0,.35);backdrop-filter:blur(12px)}
.brand{display:flex;align-items:center;gap:10px;font:700 14px var(--mono)}
.mark{width:26px;height:26px;border-radius:6px;background:#0c0c0e;border:1px solid var(--primary-dim);
  display:grid;place-items:center;font-size:10px;color:#fef3c7}
header a{color:var(--muted);font:700 11px var(--mono);letter-spacing:.08em;text-decoration:none}
header a:hover{color:var(--primary)}
main{max-width:820px;margin:0 auto;padding:40px 20px 80px}
h2{font:700 clamp(24px,3.4vw,32px)/1.25 var(--mono);letter-spacing:-.02em;margin:0 0 8px}
h3{font:700 19px var(--mono);margin:44px 0 10px;padding-top:22px;border-top:1px solid rgba(255,255,255,.06)}
h4{font:700 15px var(--mono);color:var(--primary);margin:28px 0 8px}
p{margin:12px 0;color:#d4d4d8}
a{color:var(--primary)}
code{font:12.5px var(--mono);background:rgba(22,22,26,.9);border:1px solid var(--border);
  border-radius:4px;padding:1px 5px;color:var(--primary)}
pre{background:rgba(22,22,26,.88);border:1px solid var(--border);border-radius:8px;
  padding:14px;overflow-x:auto;box-shadow:inset 0 1px 0 rgba(0,0,0,.25)}
pre code{background:none;border:0;padding:0;display:block;line-height:1.6}
blockquote{margin:14px 0;padding:10px 14px;border-left:3px solid var(--primary-dim);
  border-radius:0 7px 7px 0;background:rgba(250,204,21,.05);color:var(--muted);font-size:13.5px}
blockquote p{margin:4px 0;color:inherit}
ul{margin:10px 0;padding-left:22px;color:#d4d4d8}
.table-wrap{margin:16px 0;overflow-x:auto;border:1px solid var(--border);border-radius:8px}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{padding:9px 12px;text-align:left;vertical-align:top;
  border-bottom:1px solid rgba(255,255,255,.06)}
th{font:700 11px var(--mono);letter-spacing:.06em;color:var(--muted);
  background:rgba(0,0,0,.25);white-space:nowrap}
td{color:#d4d4d8}
tbody tr:last-child td{border-bottom:0}
figure{margin:18px 0}
figure img{max-width:100%;border:1px solid var(--border);border-radius:8px;
  box-shadow:0 18px 50px rgba(0,0,0,.35)}
figcaption{margin-top:6px;font:11px var(--mono);color:var(--faint)}
.doc-ref{color:#d4d4d8;font-weight:600}
.src-note{margin-top:56px;padding-top:18px;border-top:1px solid rgba(255,255,255,.06);
  font:11px var(--mono);color:var(--faint)}
</style>
</head>
<body>
<header>
  <div class="brand"><span class="mark">AK</span>AiKey</div>
  <nav><a href="/user/cli-guide">CLI GUIDE</a></nav>
</header>
<main>
${body.join('\n')}
<p class="src-note">本页由交付文档《快速开始 · §4 员工：安装 + 日常使用》在构建期生成 —— 文档更新后重新构建即为最新。</p>
</main>
</body>
</html>
`;

for (const out of OUT_TREES) {
  fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(out, 'index.html'), html);
  for (const rel of images) {
    fs.copyFileSync(path.join(SRC_ASSETS, rel), path.join(out, rel));
  }
  console.log(`✓ generated ${path.relative(repoRoot, out)} (${images.length} screenshots)`);
}
