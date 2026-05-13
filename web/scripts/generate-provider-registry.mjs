#!/usr/bin/env node
/**
 * Codegen: aikey-cli/data/provider_registry.yaml → src/shared/generated/provider-registry.ts
 *
 * Why this file exists:
 *   The CLI's provider_registry.yaml is the single source of truth for
 *   provider display labels (display + display_alias), canonical codes,
 *   and family grouping. Per the 2026-05-12 unified-SoT requirement,
 *   the web side must NOT maintain a parallel handwritten copy.
 *
 *   This script reads the YAML and emits a typed TS module that web code
 *   imports for picker labels, vault chip group titles, and
 *   ProviderMultiSelect's `KNOWN_PROTOCOLS` derivation.
 *
 * Lifecycle:
 *   - Runs automatically on `npm run prebuild` (and therefore on every
 *     `npm run build` / `build:user` / `build:full`).
 *   - The generated file IS checked into git so `import` works without
 *     setup and CI can `git diff --exit-code` to catch drift.
 *   - Manual invocation: `npm run gen:provider-registry`.
 *
 * Scope of what's mirrored:
 *   Only entries with `picker: true` and only the fields the web side
 *   needs for display + grouping. Internals like proxy_path / env_api_key
 *   stay CLI-only — bringing them over would couple web to CLI internals
 *   it has no business knowing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const YAML_PATH = path.join(REPO_ROOT, 'aikey-cli/data/provider_registry.yaml');
// Emit identical copies to both web bundles' src/shared/generated/.
// Why two paths: master/web's vite resolves `@/...` to its own src/, not
// user/web's, and pages shared via the file:-link package import `@/shared/...`
// — so vault/index.tsx (sourced from user/web) needs the generated file at
// BOTH locations to resolve in both bundles. The YAML remains the single
// source of truth; both TS files are deterministic copies regenerated
// together. See workflow/CI/requirements/2026-05-12-provider-display-label-spec.md.
const OUT_PATHS = [
  path.resolve(__dirname, '../src/shared/generated/provider-registry.ts'),
  path.join(REPO_ROOT, 'aikey-control-master/web/src/shared/generated/provider-registry.ts'),
];

const yamlText = fs.readFileSync(YAML_PATH, 'utf8');
const parsed = YAML.parse(yamlText);

if (!parsed || !Array.isArray(parsed.providers)) {
  console.error(`✗ ${YAML_PATH}: top-level "providers" array missing`);
  process.exit(1);
}

const entries = parsed.providers
  .filter((p) => p && p.picker === true)
  .map((p) => ({
    code: String(p.code),
    family: p.family ? String(p.family) : String(p.code),
    display: p.display ? String(p.display) : String(p.code),
    displayAlias: p.display_alias ? String(p.display_alias) : undefined,
    oauthAliases: Array.isArray(p.oauth_aliases)
      ? p.oauth_aliases.map((a) => String(a))
      : [],
  }));

if (entries.length === 0) {
  console.error(`✗ no picker-enabled providers found in ${YAML_PATH}`);
  process.exit(1);
}

const banner = `// AUTO-GENERATED FROM aikey-cli/data/provider_registry.yaml.
// DO NOT EDIT BY HAND. Run \`npm run gen:provider-registry\` or
// \`npm run prebuild\` to regenerate after changing the YAML.
//
// Single source of truth: see workflow/CI/requirements/
// 2026-05-12-provider-display-label-spec.md.
`;

const entryType = `export interface ProviderRegistryEntry {
  /** Canonical provider_code stored in vault bindings. */
  code: string;
  /** Family code for UI grouping (defaults to \`code\` for single-platform families). */
  family: string;
  /** Base display label rendered prominently (chip text / picker row). */
  display: string;
  /** Brand alias rendered in muted parentheses next to \`display\`. Absent
   *  for families whose \`display\` already encodes a platform discriminator
   *  (Kimi) or whose canonical code is itself the recognizable brand. */
  displayAlias?: string;
  /** Aliases recognized for OAuth-broker normalization and search. */
  oauthAliases: readonly string[];
}`;

const body = entries
  .map((e) => {
    const aliasField =
      e.displayAlias !== undefined ? `\n    displayAlias: ${JSON.stringify(e.displayAlias)},` : '';
    return `  {
    code: ${JSON.stringify(e.code)},
    family: ${JSON.stringify(e.family)},
    display: ${JSON.stringify(e.display)},${aliasField}
    oauthAliases: ${JSON.stringify(e.oauthAliases)},
  },`;
  })
  .join('\n');

const helpers = `
/** Lookup table: code → entry. Includes oauth aliases mapped to the canonical entry. */
export const ENTRY_BY_CODE: ReadonlyMap<string, ProviderRegistryEntry> = (() => {
  const m = new Map<string, ProviderRegistryEntry>();
  for (const e of PROVIDER_REGISTRY) {
    m.set(e.code.toLowerCase(), e);
    for (const alias of e.oauthAliases) m.set(alias.toLowerCase(), e);
  }
  return m;
})();

/** Lookup table: family → first entry in that family. Useful for vault group
 *  chip rendering where we group by family and need the family-level
 *  display_alias (single-platform families). Multi-platform families like
 *  \`kimi\` return whichever entry comes first in the YAML; its display_alias
 *  is undefined by design so the group chip stays plain "kimi". */
export const ENTRY_BY_FAMILY: ReadonlyMap<string, ProviderRegistryEntry> = (() => {
  const m = new Map<string, ProviderRegistryEntry>();
  for (const e of PROVIDER_REGISTRY) {
    if (!m.has(e.family)) m.set(e.family, e);
  }
  return m;
})();

/** Render the display + parenthetical alias as a single string. Used where
 *  the renderer cannot dim a substring (e.g. plain-text lists). For the
 *  vault chip + CLI picker we render the parts separately so the alias
 *  can be visually muted. */
export function displayLabelFull(e: ProviderRegistryEntry): string {
  return e.displayAlias ? \`\${e.display} (\${e.displayAlias})\` : e.display;
}
`;

const out = `${banner}
${entryType}

export const PROVIDER_REGISTRY: readonly ProviderRegistryEntry[] = [
${body}
];
${helpers}`;

for (const outPath of OUT_PATHS) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, out, 'utf8');
  console.log(`✓ generated ${path.relative(REPO_ROOT, outPath)} (${entries.length} entries)`);
}
