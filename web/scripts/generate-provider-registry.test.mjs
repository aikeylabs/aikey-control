/**
 * P2.9 / test-plan T-16, T-17 — the codegen's own tests.
 *
 * These drive the REAL script (child process, real exit codes) over fixture
 * YAMLs, rather than re-implementing its logic in the test. A test that
 * reimplements the thing it checks passes whenever both copies share a
 * misunderstanding — which is the same failure this whole change is about.
 *
 * The fixtures are deliberately tiny: every row exists to exercise one branch,
 * and the expected values are written out longhand so a wrong one is visible on
 * the page rather than derived from the same code under test.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, 'generate-provider-registry.mjs');

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aikey-codegen-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Run the real codegen over fixture YAMLs. Returns {ok, stderr, output}. */
function runCodegen({ registry, fingerprint }) {
  const registryPath = path.join(tmp, 'provider_registry.yaml');
  const fingerprintPath = path.join(tmp, 'provider_fingerprint.yaml');
  const outDir = path.join(tmp, 'out');
  fs.writeFileSync(registryPath, registry, 'utf8');
  fs.writeFileSync(fingerprintPath, fingerprint, 'utf8');
  fs.mkdirSync(outDir, { recursive: true });
  try {
    execFileSync(process.execPath, [SCRIPT], {
      env: {
        ...process.env,
        AIKEY_CODEGEN_REGISTRY_YAML: registryPath,
        AIKEY_CODEGEN_FINGERPRINT_YAML: fingerprintPath,
        AIKEY_CODEGEN_OUT_DIR: outDir,
      },
      stdio: 'pipe',
    });
  } catch (err) {
    return { ok: false, stderr: String(err.stderr ?? ''), output: '' };
  }
  return {
    ok: true,
    stderr: '',
    output: fs.readFileSync(path.join(outDir, 'provider-registry.ts'), 'utf8'),
  };
}

/** Pull one emitted constant out of the generated module without evaluating it. */
function endpointsOf(output, key) {
  const m = output.match(
    new RegExp(`\\["${key.replace('|', '\\|')}", (\\[.*?\\])\\],`),
  );
  return m ? JSON.parse(m[1]) : undefined;
}

function protocolCatalogOf(output) {
  const m = output.match(
    /export const PROTOCOL_CATALOG: readonly \{ value: string; providerCount: number \}\[\] = (\[[\s\S]*?\]);/,
  );
  return m ? JSON.parse(m[1]) : undefined;
}

const REGISTRY = `providers:
  - code: alpha
    proxy_path: alpha/v1
    env_api_key: ALPHA_API_KEY
    env_base_url: ALPHA_BASE_URL
    default_base_url: https://api.alpha.example/v1
    picker: true
    display: alpha
  - code: beta
    proxy_path: beta/v1
    env_api_key: BETA_API_KEY
    env_base_url: BETA_BASE_URL
    default_base_url: https://api.beta.example/v1
    picker: true
    display: beta
  - code: hidden
    proxy_path: ""
    env_api_key: ""
    env_base_url: ""
    default_base_url: ""
    picker: false
    display: Hidden Provider
`;

describe('provider-registry codegen', () => {
  it('emits url = base_url + version, and base_url verbatim when version is empty', () => {
    const { ok, output } = runCodegen({
      registry: REGISTRY,
      fingerprint: `provider_routes:
  - { host: "api.alpha.example", protocol: openai_compatible, provider: alpha, base_url: "https://api.alpha.example", version: "/v1" }
  - { host: "api.beta.example",  protocol: openai_compatible, provider: beta,  base_url: "https://api.beta.example/inference", version: "" }
`,
    });
    expect(ok).toBe(true);
    expect(endpointsOf(output, 'alpha|openai_compatible')).toEqual([
      {
        url: 'https://api.alpha.example/v1',
        host: 'api.alpha.example',
        pathPrefix: '',
        isDefault: false,
      },
    ]);
    // 🔴 The empty-version case. Appending "/v1" here would invent an address
    // that does not exist — the real table has two such rows (perplexity,
    // github_models) and a naive concatenation breaks both.
    expect(endpointsOf(output, 'beta|openai_compatible')).toEqual([
      {
        url: 'https://api.beta.example/inference',
        host: 'api.beta.example',
        pathPrefix: '',
        isDefault: false,
      },
    ]);
  });

  it('carries path_prefix and the default flag through per row', () => {
    const { ok, output } = runCodegen({
      registry: REGISTRY,
      fingerprint: `provider_routes:
  - { host: "cn.alpha.example", path_prefix: "/anthropic", protocol: anthropic, provider: alpha, base_url: "https://cn.alpha.example/anthropic", version: "/v1", default: true }
  - { host: "io.alpha.example", path_prefix: "/anthropic", protocol: anthropic, provider: alpha, base_url: "https://io.alpha.example/anthropic", version: "/v1" }
`,
    });
    expect(ok).toBe(true);
    expect(endpointsOf(output, 'alpha|anthropic')).toEqual([
      {
        url: 'https://cn.alpha.example/anthropic/v1',
        host: 'cn.alpha.example',
        pathPrefix: '/anthropic',
        isDefault: true,
      },
      {
        url: 'https://io.alpha.example/anthropic/v1',
        host: 'io.alpha.example',
        pathPrefix: '/anthropic',
        isDefault: false,
      },
    ]);
  });

  it('derives PROTOCOL_CATALOG from picker-visible providers only', () => {
    const { ok, output } = runCodegen({
      registry: REGISTRY,
      fingerprint: `provider_routes:
  - { host: "api.alpha.example", protocol: openai_compatible, provider: alpha,  base_url: "https://api.alpha.example", version: "/v1" }
  - { host: "api.beta.example",  protocol: anthropic,         provider: beta,   base_url: "https://api.beta.example", version: "/v1" }
  - { host: "api.hidden.example", protocol: exotic_protocol,  provider: hidden, base_url: "https://api.hidden.example", version: "/v1" }
`,
    });
    expect(ok).toBe(true);
    // 🔴 `exotic_protocol` is carried ONLY by a picker:false provider, so it must
    // not be offered — exactly the mechanism that keeps `gemini` out (R-8).
    // No exclusion list is involved; flipping `hidden` to picker:true would put
    // it back, which is the property that makes the mechanism trustworthy.
    expect(protocolCatalogOf(output)).toEqual([
      { value: 'anthropic', providerCount: 1 },
      { value: 'openai_compatible', providerCount: 1 },
    ]);
    // …but its endpoints stay resolvable, so existing credentials still render.
    expect(endpointsOf(output, 'hidden|exotic_protocol')).toHaveLength(1);
  });

  it('marks tier-B from the row inline comment, and only those rows', () => {
    const { ok, output } = runCodegen({
      registry: REGISTRY,
      fingerprint: `provider_routes:
  - { host: "api.alpha.example", protocol: openai_compatible, provider: alpha, base_url: "https://api.alpha.example", version: "/v1" }
  - { host: "api.beta.example",  protocol: openai_compatible, provider: beta,  base_url: "https://api.beta.example", version: "/v1" }   # tier-B 待官方复核
`,
    });
    expect(ok).toBe(true);
    expect(endpointsOf(output, 'beta|openai_compatible')[0].tier).toBe('b');
    // An unmarked row must NOT carry the flag, or the badge stops meaning anything.
    expect(endpointsOf(output, 'alpha|openai_compatible')[0].tier).toBeUndefined();
  });

  // T-17
  it('FAILS THE BUILD when a routed provider has no registry identity', () => {
    const { ok, stderr } = runCodegen({
      registry: REGISTRY,
      fingerprint: `provider_routes:
  - { host: "api.alpha.example", protocol: openai_compatible, provider: alpha, base_url: "https://api.alpha.example", version: "/v1" }
  - { host: "api.ghost.example", protocol: openai_compatible, provider: ghost_corp, base_url: "https://api.ghost.example", version: "/v1" }
`,
    });
    // 🔴 Not "emits an entry with an empty display". A blank row renders as a
    // blank row and no test notices; a non-zero exit stops the build.
    expect(ok, 'codegen must exit non-zero, not emit a nameless provider').toBe(false);
    expect(stderr).toContain('ghost_corp');
    expect(stderr).toContain('provider_registry.yaml');
  });

  it('fails when the fingerprint has no provider_routes at all', () => {
    const { ok, stderr } = runCodegen({ registry: REGISTRY, fingerprint: 'version: 1\n' });
    expect(ok).toBe(false);
    expect(stderr).toContain('provider_routes');
  });

  it('fails when no picker-visible provider declares any protocol', () => {
    const { ok, stderr } = runCodegen({
      registry: REGISTRY,
      fingerprint: `provider_routes:
  - { host: "api.hidden.example", protocol: openai_compatible, provider: hidden, base_url: "https://api.hidden.example", version: "/v1" }
`,
    });
    // An empty catalogue would render an empty protocol dropdown — a dialog that
    // silently cannot be used. Better to stop the build.
    expect(ok).toBe(false);
    expect(stderr).toContain('picker-visible');
  });

  it('is deterministic — same input, byte-identical output', () => {
    const args = {
      registry: REGISTRY,
      fingerprint: `provider_routes:
  - { host: "api.alpha.example", protocol: openai_compatible, provider: alpha, base_url: "https://api.alpha.example", version: "/v1" }
`,
    };
    // Non-determinism here would make the CI drift gate (P2.8,
    // \`git diff --exit-code\`) fail at random and get disabled.
    expect(runCodegen(args).output).toBe(runCodegen(args).output);
  });
});
