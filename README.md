# aikey-control

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

User-facing source code for the **AiKey Control** stack — the personal-edition service modules and web UI components that ship with `local-install` and the team-trial bundle.

中文文档: [README.zh.md](README.zh.md)

## Status

🚧 **Active development**. This repository contains user-facing service modules and web UI components. Backend services are maintained separately.

## Scope

This repository contains:

- **`service/pkg/`** — Go packages exposing the user-side service surface (CLI bridge, vault, intake, shared utilities)
- **`service/appkit/user-local/`** — service assembly layer for the local-server binary
- **`web/src/`** — React/TypeScript SPA components for the user-facing UI (see [Theming](#theming-light--dark))

This repository **does not** contain backend admin tooling, production deployment artifacts, or the team-trial bundler. Those components are maintained in separate private repositories.

## What ships with the binaries

End users install via:

```
curl -fsSL https://raw.githubusercontent.com/aikeylabs/launch/main/install.sh | bash
```

The official `local-install` binary is built from this repository's source plus the private bundler. The binary is signed (cosign + platform-native signing) and accompanied by an SBOM.


## Theming (light + dark)

The console ships two palettes. The dark "Industrial Vault" theme is the default and is unchanged;
a light theme was added alongside it.

`data-theme` is written to `<html>` by a blocking script in `index.html` before first paint. With no
stored preference it follows the OS and keeps following it live; users toggle it from the header.

**Dark is the attribute-ABSENT state.** The dark palette lives on bare `:root`; light is
`[data-theme='light']`. Nothing ever writes `data-theme="dark"`. That is a safety property: any path
that fails to run the boot script — a stale bundle, the frame before JS settles, a screenshot
harness — lands on `:root` and renders the original console exactly.

**Geometry and type are not theme-scoped.** `--radius-*`, `--font-*` and density are one shared set
of values, so light inherits the dark theme's 2/4/6px radii and monospace chrome. Adding a radius or
font override to the light block would change dark too.

**The light accent is two-tier**: `--primary` (`#e8502a`, 3.14:1 on the canvas) for fills and icons,
`--primary-text` (`#b23a17`, 5.02:1) for accent text. The dark theme's `#facc15` is 1.53:1 on white
and cannot be reused.

**Page code must not hardcode neutral colours.** `src/shared/utils/no-raw-neutral.test.ts` enforces
zero. A raw neutral cannot follow the theme, and the worst cases vanish rather than merely look
wrong — `rgba(255,255,255,.02)` is invisible on a white card. Use the tokens instead:

| Instead of | Use |
|------------|-----|
| `#18181b` / `#1f1f23` / `#27272a` | `var(--background)` / `var(--surface-sunken)` / `var(--card)` |
| `#3f3f46` | `var(--border)` (borders) / `var(--surface-inset)` (fills) |
| `#a1a1aa` / `#71717a` | `var(--muted-foreground)` / `var(--faint-foreground)` |
| `rgba(255,255,255,α)` / `rgba(0,0,0,α)` | `rgba(var(--lift-rgb), α)` / `rgba(var(--sink-rgb), α)` |
| modal backdrop or drop shadow | `rgba(var(--scrim-rgb), α)` |
| sticky nav background / recessed well | `var(--backdrop-chrome)` / `var(--well-recessed)` |

`src/index.css` holds the full token set and is byte-identical to the team console's copy.

## Build (development)

The source here is a slice of a larger codebase and may not build standalone in this snapshot — Phase 1 of the split is a code-visibility milestone, not a self-contained build. Phase 2 will introduce a standalone `go.mod` and CI to validate `go build ./...` against this repository alone.

## Contributing

External contributors welcome on the public surface — pkg/* packages, user-side API handlers, web pages under `pages/user/`. Please open an issue first for non-trivial changes.

## Security

Report vulnerabilities privately to security@aikey.dev (do not file public issues).

## License

[Apache License 2.0](LICENSE) © AiKey Labs
