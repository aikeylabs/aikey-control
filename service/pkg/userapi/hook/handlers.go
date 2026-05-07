// Package hook serves the Web-modal "Allow" path for shell-hook rc wiring.
//
// Per 20260507-web-hook-rc-modal-自动注入.md: when the user clicks "Allow"
// in the <HookReadinessBanner>'s confirmation modal, the SPA POSTs to
// /api/user/hook/install. We forward the request to the CLI bridge
// (`aikey _internal hook-op wire-rc`), which actually writes the marker
// block into ~/.zshrc / ~/.bashrc.
//
// **Edition guard**: this handler is only mounted on local-user / trial-full
// editions — see userapi.Handlers.RegisterHook. Production multi-tenant
// deployments don't expose this route at all because the cli bridge would
// be writing the *server's* dotfiles, not the user's terminal.
//
// Auth: route is mounted behind the same authMW as vault CRUD; vault unlock
// is NOT required because the wire-rc op only touches files under the
// user's $HOME and never derives a vault key.
package hook

import (
	"log/slog"
	"net/http"

	"github.com/AiKeyLabs/aikey-control/service/pkg/userapi/cli"
)

// Handlers exposes the HTTP surface for hook-op actions.
//
// Currently the only action is wire-rc (POST /api/user/hook/install).
// Future additions (uninstall-rc, status-rc) plug in here.
type Handlers struct {
	Bridge *cli.Bridge
	Logger *slog.Logger
}

// NewHandlers constructs a hook Handlers bundle. Logger may be nil.
func NewHandlers(bridge *cli.Bridge, logger *slog.Logger) *Handlers {
	return &Handlers{Bridge: bridge, Logger: logger}
}

// InstallHandler implements POST /api/user/hook/install.
//
// Forwards to `aikey _internal hook-op` action=`wire-rc`. The cli
// always returns status=ok with a data envelope of three fields:
//
//	hook_file_installed: bool
//	hook_rc_wired:       bool
//	hook_failure_reason: string|null
//
// — symmetric with the vault-op envelope's hook fields, so the SPA's
// existing setReadiness handler covers it without a separate adapter.
//
// Failure modes (each surfaced via hook_failure_reason in the body, with
// HTTP still 200):
//
//   - "aikey_no_hook"        — env var AIKEY_NO_HOOK=1 (user opted out)
//   - "shell_undetectable"   — $SHELL is neither zsh nor bash
//   - "home_unset"           — $HOME / $USERPROFILE both missing (rare)
//   - "io_error"             — fs error during file write
//
// HTTP-level errors (cli not found, timeout, malformed reply, unparseable
// envelope) flow through cli.WriteInvokeError / WriteCliError and get
// proper 4xx/5xx codes — those are infrastructure failures, not the
// "operation completed but rc could not be wired" semantic.
func (h *Handlers) InstallHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		cli.WriteErr(w, cli.ErrBadRequest, "method must be POST")
		return
	}

	res, err := h.Bridge.InvokeHookOp(r.Context(), "wire-rc", "")
	if err != nil {
		cli.WriteInvokeError(w, err)
		return
	}
	if res.Status != "ok" {
		cli.WriteCliError(w, res)
		return
	}
	cli.WriteEnvelope(w, res)
}
