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
- **`web/src/`** — React/TypeScript SPA components for the user-facing UI

This repository **does not** contain backend admin tooling, production deployment artifacts, or the team-trial bundler. Those components are maintained in separate private repositories.

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
