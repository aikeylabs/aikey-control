// Package intake implements the bulk-import HTTP surface (parse / confirm /
// rules) plus a small VK list cache. It is a thin orchestration shell: every
// vault-touching operation is delegated to the Rust aikey CLI via stdin-JSON
// IPC (see aikey-cli/src/commands_internal). Go never reads or writes
// vault.db and never performs AES-GCM.
//
// Companion packages (post 2026-04-30 deep split):
//
//   - pkg/userapi/cli — Bridge subprocess + shared error model
//   - pkg/userapi/session   — vault session store + RequireUnlock middleware
//   - pkg/userapi/vault     — unlock/lock/status/init + Vault-page CRUD
//
// The top-level orchestrator (pkg/userapi.Handlers) wires all four together
// and exposes a single Register() that mounts every /api/user/{vault,import}/*
// route on the caller's mux.
//
// Package name note: Go keyword `import` cannot be used for a package name,
// hence `intake` (documented decision in
// roadmap20260320/技术实现/阶段3-增强版KEY管理/批量导入-实施计划.md §Stage 4).
package intake

import (
	"github.com/AiKeyLabs/aikey-control/service/pkg/userapi/cli"
)

// ImportHandlers bundles the /api/user/import/* endpoints. Each handler is
// a thin envelope around one cli subcommand; the cli owns the business logic
// (parse engine, vault writes, audit log) and this layer only marshals JSON.
type ImportHandlers struct {
	Bridge  *cli.Bridge
	VKCache *VKCache
}
