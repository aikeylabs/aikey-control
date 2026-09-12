// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * EVERY TABLE HEADER BAND IS --table-header, AND THE BAR ABOVE IT IS NOT GREY.
 *
 * # Why this exists (2026-09-11)
 *
 * 2026-09-05 made column headers deeper "for all tables" by carving
 * --table-header (#e4e9f2 in light) out of --overlay-sink. The token and the
 * global `table th` rule landed; the pages did not all follow. Header rules in
 * BOTH consoles kept painting their own background with a token that is
 * #ffffff in light — --overlay-sink, rgba(var(--sink-rgb), α),
 * --surface-sunken — so on those pages the header band simply vanished.
 *
 * Nothing could see it. In dark every one of those tokens resolves to the same
 * near-black as --table-header, and each one passed tsc, the build and
 * no-raw-neutral.test.ts — they ARE tokens, just the wrong role.
 *
 * The inverse defect sat one element up: the card title bar above the header
 * painted grey (the vault skin borrowed the header ramp for it; cluster-health
 * used the Tailwind literal `bg-black/20`, which no colour fence reads), so the
 * header no longer read as the one band under a white card.
 *
 * Bugfix: workflow/CI/bugfix/2026-09-11-table-headers-miss-the-header-token.md
 * Spec:   workflow/CI/requirements/2026-05-12-ui-card-table-color-hierarchy.md
 *
 * # Why a scan and not a shared component
 *
 * There is no shared Table component — every page hand-rolls its header, in
 * inline styles, in `const headStyle`, or in a page-scoped CSS string. That is
 * the root cause and it is not fixed here; until it is, "one band" can only be
 * enforced by reading all of them.
 *
 * 能红: give any <th> a backgroundColor, or any CSS `… th { background: … }`,
 * other than var(--table-header) / var(--table-header-sticky); paint the vault
 * title bar with --skin-head; or give a divider strip (border-b / border-t) a
 * Tailwind `bg-black/…` class.
 */

const SRC = path.resolve(process.cwd(), 'src');
/** The two web trees share this file byte-for-byte; the exemptions differ. */
const TREE: 'master' | 'personal' = fs.existsSync(path.resolve(SRC, 'pages/master')) ? 'master' : 'personal';

const HEADER_OK = /^var\(--table-header(?:-sticky)?\)$/;

/**
 * 🚫 Keep this to headers that are a different KIND of thing. "This page looks
 * better with a lighter header" is the drift the fence exists to catch.
 */
const EXEMPT: Array<{ tree: 'master' | 'personal'; file: string; why: string }> = [
  {
    tree: 'master',
    file: 'pages/master/dashboard/index.tsx',
    why: 'the 24-hour usage HEATMAP. Its <th> are axis labels over a grid of coloured '
      + 'cells and opt out of table chrome altogether (border:none; background:none).',
  },
  {
    tree: 'personal',
    file: 'pages/user/_shared/vault-page-skin.ts',
    why: 'the /vault skin paints its header as rgba(var(--skin-head), .32), a ramp derived '
      + 'to land on exactly #e4e9f2 in light (see the note on --skin-head) while keeping '
      + 'its warmer dark band. Its title bar is fenced separately below.',
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Blank out comments, keeping line numbers, so a Why note never trips the scan. */
function stripComments(s: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  return s
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:'"`\\])(\/\/[^\n]*)/g, (_m, p, c) => p + blank(c));
}

/** A JSX opening tag from `<th` to its closing `>`, skipping `>` inside `{…}`. */
function openTag(src: string, at: number): string {
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return src.slice(at, i + 1);
  }
  return src.slice(at);
}

const lineOf = (src: string, i: number) => src.slice(0, i).split('\n').length;
const exempt = () => new Set(EXEMPT.filter((e) => e.tree === TREE).map((e) => path.resolve(SRC, e.file)));

describe('table header band is one token', () => {
  it('no <th> paints its own background with anything but --table-header', () => {
    const skip = exempt();
    const offenders: string[] = [];
    for (const file of walk(SRC).filter((f) => f.endsWith('.tsx'))) {
      if (skip.has(file)) continue;
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      for (const m of src.matchAll(/<th\b/g)) {
        const tag = openTag(src, m.index!);
        // Follow `style={headStyle}` / `{ ...headStyle }` to the const in the same file —
        // that is where two of the broken headers kept their colour.
        let text = tag;
        for (const r of tag.matchAll(/\.\.\.(\w+)|style=\{(\w+)\}/g)) {
          const def = new RegExp(`const ${r[1] ?? r[2]}\\s*=\\s*(\\{[^;]*\\})`).exec(src);
          if (def) text += def[1];
        }
        for (const b of text.matchAll(/background(?:Color)?\s*:\s*(?:(['"`])(.*?)\1|([^,}\n]+))/g)) {
          const value = (b[2] ?? b[3]).trim();
          if (!HEADER_OK.test(value)) offenders.push(`${path.relative(SRC, file)}:${lineOf(src, m.index!)}  <th> ${value}`);
        }
      }
    }
    expect(offenders, `These column headers paint their own background instead of the header
token. The ones that broke used --overlay-sink / rgba(var(--sink-rgb), α) /
--surface-sunken: identical to --table-header in dark, #ffffff in light — so
the header band vanished in light and nothing in dark could show it.

Use backgroundColor: 'var(--table-header)' (or omit it; \`table th\` already paints it):

${offenders.join('\n')}
`).toEqual([]);
  });

  it('no page CSS rule paints a th with anything but --table-header', () => {
    const skip = exempt();
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (skip.has(file)) continue;
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      for (const r of src.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
        const targetsTh = r[1].split(',').some((s) => /(?:^|[\s>+~])th(?:[.:[#][^\s>+~]*)?$/.test(s.trim()));
        if (!targetsTh) continue;
        for (const b of r[2].matchAll(/background(?:-color)?\s*:\s*([^;]+)/g)) {
          const value = b[1].replace(/!important/, '').trim();
          if (!HEADER_OK.test(value)) {
            offenders.push(`${path.relative(SRC, file)}:${lineOf(src, r.index! + r[1].length)}  ${r[1].trim()} { background: ${value} }`);
          }
        }
      }
    }
    expect(offenders, `These page-scoped CSS rules paint a table header with something other than
the header token. A page rule beats the global \`table th\`, so this is exactly
how a page silently drops out of "every header is one band".

Use background: var(--table-header):

${offenders.join('\n')}
`).toEqual([]);
  });

  it('no divider strip is painted with a Tailwind bg-black/ literal', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC).filter((f) => f.endsWith('.tsx'))) {
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const cls = m[1] ?? m[2];
        if (/\bborder-[bt]\b/.test(cls) && /(?:^|\s)(?:hover:)?bg-black\//.test(cls)) {
          offenders.push(`${path.relative(SRC, file)}:${lineOf(src, m.index!)}  ${cls.trim()}`);
        }
      }
    }
    expect(offenders, `These card title / footer strips use a Tailwind black-alpha class. It is not
a theme token, so in light it composites to a grey slab over the white card —
the cluster-health title bars above "PROXY nodes", "Instability signals" and
"Cluster events" did exactly that.

Use bg-[rgba(var(--sink-rgb),0.2)] (black in dark, white in light):

${offenders.join('\n')}
`).toEqual([]);
  });

  it.skipIf(TREE !== 'personal')('the /vault title bar is not painted with the header ramp', () => {
    const css = stripComments(fs.readFileSync(path.resolve(SRC, 'pages/user/_shared/vault-page-skin.ts'), 'utf8'));
    const rule = /\.card > div:first-of-type\s*\{([^}]*)\}/.exec(css);
    expect(rule, 'the vault skin card-title-bar rule is gone').not.toBeNull();
    expect(rule![1], `The vault title bar paints with --skin-head again. That is the header ramp:
at .2 it is #eef0f5 in light, a grey strip on top of the header band.`).not.toMatch(/--skin-head/);
    expect(css, 'the light vault skin no longer defines a white --skin-lid')
      .toMatch(/\[data-theme='light'\] \.vault-page\.vault-skin-v1 \{[^}]*--skin-lid:\s*255,\s*255,\s*255;/);
  });

  it('the global `table th` rule still paints --table-header', () => {
    const css = fs.readFileSync(path.resolve(SRC, 'index.css'), 'utf8');
    const rule = /table th \{([^}]*)\}/.exec(css);
    expect(rule, 'the `table th` rule is gone from index.css').not.toBeNull();
    expect(rule![1], `Most headers declare nothing and take their band from here.`)
      .toMatch(/background-color:\s*var\(--table-header\)/);
  });

  /** An exemption list rots in the SAFE-LOOKING direction: a renamed file exempts nothing. */
  it('every exemption still points at a real file', () => {
    for (const e of EXEMPT.filter((x) => x.tree === TREE)) {
      expect(fs.existsSync(path.resolve(SRC, e.file)), `${e.file} is exempted (${e.why}) but does not exist`).toBe(true);
    }
  });
});
