# aikey-control

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

User-facing source code for the **AiKey Control** stack — the personal-edition service modules and web UI components that ship with `local-install` and the team-trial bundle.

中文文档: [README.zh.md](README.zh.md)

## Status

🚧 **Active development**. This repository was extracted from a larger monorepo on 2026-04-29 as part of a public/private split. The full development history prior to this split is preserved in the private master repository at `AiKeyLabs/aikey-control-master` (maintainer-only access).

## Scope

This repository contains:

- **`service/pkg/`** — shared Go packages (identity, snapshot, managedkey, shared utilities) consumed by both the user-side service and the master service
- **`service/internal/referral/`** — referral tracking
- **`service/internal/api/user/`** — user-facing API handlers (delivery, vault, import, etc.)
- **`service/appkit/{core,user}/`** — service assembly layer for user-only mode
- **`web/src/{app,layouts,features,pages/user,shared}/`** — React/TypeScript SPA components for the user-facing UI

This repository **does not** contain:

- Master / admin console UI (`pages/master/`, `shared/api/master/`)
- Master service modules (organization, provider credential management)
- Production deployment artifacts (Docker compose, control-plane service binaries)
- Trial-server assembly (the all-in-one team-trial bundler)

Those components live in private repositories (`aikey-control-master`, `aikey-trial-server`).

## What ships with the binaries

End users install via:

```
curl -fsSL https://raw.githubusercontent.com/aikeylabs/launch/main/install.sh | bash
```

The official `local-install` binary is built from this repository's source plus the private bundler. The binary is signed (cosign + platform-native signing) and accompanied by an SBOM.

## Build (development)

The source here is a slice of a larger codebase and may not build standalone in this snapshot — Phase 1 of the split is a code-visibility milestone, not a self-contained build. Phase 2 will introduce a standalone `go.mod` and CI to validate `go build ./...` against this repository alone.

## Contributing

External contributors welcome on the public surface — pkg/* packages, user-side API handlers, web pages under `pages/user/`. Please open an issue first for non-trivial changes.

## Security

Report vulnerabilities privately to security@aikey.dev (do not file public issues).

## License

[Apache License 2.0](LICENSE) © AiKey Labs
