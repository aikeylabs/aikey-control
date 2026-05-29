# Contributing to aikey-control

The control plane: web console, admin APIs, multi-tenant team features. Ships in two editions — **Personal** (single-user, SQLite, bundled into the CLI install) and **Production** (multi-tenant, PostgreSQL, separate services).

If you are new to AiKey, read the [profile overview](https://github.com/aikeylabs/.github/blob/main/profile/README.md) first.

## Before you start

- Edition awareness is the #1 source of bugs in this repo. A change that "works on Personal" can be wrong on Production (different DB dialect, different process layout). Code that lives only in one edition must be explicitly scoped, not hidden behind a runtime check.
- Schema changes are one-way doors. Adding a column, a table, or a migration needs a written rationale in the PR description plus matching baseline fixtures (`pkg/dbmigrate/versions/`).
- Web UI changes that drop a feature, sort, filter, or tooltip from the existing console are not "redesigns" — they are regressions. Please call out anything you intend to remove **before** writing the PR.

## Local setup

Backend (Go):

```bash
git clone https://github.com/aikeylabs/aikey-control.git
cd aikey-control
go work sync     # workspace links the service modules
go build ./...
go test ./...
```

Frontend (React + Vite, under `service/*/web/`):

```bash
cd service/<service-name>/web
npm install
npm run dev
```

Some services share UI assets via Go-module composition — see the workspace `go.work` for the linkage. Editing shared components requires checking that the trial composer bundle still picks up the change (`make restart-trial1` from the repo root).

## Running locally

Three edition-specific restart targets in the repo Makefile:

- `make restart-personal` — Personal edition, SQLite, port `:8090`. **Recommended for everyday work.**
- `make restart-trial1` — Trial composer, single-binary bundle.
- `make restart-server` — Production stack with PostgreSQL via docker-compose. Use when validating schema work.

## Tests

- Unit: `go test ./...`
- Integration: `go test -tags=integration -p 1 ./...`. Requires Docker.
- E2E: see the repo's E2E folder. Read-only checks ("HTTP 200, payload non-empty") are not sufficient for credential, seat, or binding flows — create real data with a real client, then assert it round-trips through the DB.

## Migrations

- All DDL (baseline + every migration) lives in [`aikey-config-tool/pkg/dbmigrate/versions/`](https://github.com/aikeylabs/aikey-control/tree/main/aikey-config-tool/pkg/dbmigrate/versions) — this is the canonical source-of-truth, not stray SQL files.
- Each `Migration` carries dialect-aware SQL (`UpgradeSQL` + `UpgradeSQLite`, `RollbackSQL` + `RollbackSQLite`).
- Every migration must be idempotent (re-running on an already-applied DB must be a no-op success).
- Every migration must have a rollback or be explicitly marked irreversible (rare — needs a written justification in the PR).
- Scope by edition: do not run a migration against a component that the edition does not deploy.

## PR flow

1. Open an issue or RFC discussion for anything touching schema, auth, multi-tenancy boundaries, or the production deployment.
2. Single logical change per PR. Refactor + behavior change in the same PR is not OK; split them.
3. The PR template's "edition impact" section is mandatory for this repo.
4. CI must be green. The PR-gate scanner (`make test-config-split-pr`) is part of CI; it catches stale references to removed config fields.

## Code style

- Go: `gofmt -s -l .` + `go vet ./...`. Reviewable file size: aim for 800-1500 lines per file. Splitting a god-file into 50-line shards just to make agents happy is **not** the goal.
- React: project uses TypeScript + Tailwind. Match the existing component patterns in `service/*/web/src/components/`. Don't introduce a third state management library; reuse the existing one.

## Security

`aikeyfounder@gmail.com`. See [SECURITY.md](https://github.com/aikeylabs/.github/blob/main/SECURITY.md).

## Code of Conduct

[CODE_OF_CONDUCT.md](https://github.com/aikeylabs/.github/blob/main/CODE_OF_CONDUCT.md).
