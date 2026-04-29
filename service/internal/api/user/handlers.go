package user

import "github.com/AiKeyLabs/aikey-control-service/internal/api/user/importpkg"

// Handlers groups all user-domain HTTP handlers.
//
// Page rendering lives in aikey-control/web (React + Vite); the built SPA is
// embedded into aikey-trial-server/web/embed.go at binary compile time and
// served for every unmatched non-API path. There is therefore no Go-side
// page handler in this package — only the bulk-import API surface below.
type Handlers struct {
	Referral *ReferralHandler
	// Import hosts the /api/user/{import,vault}/* endpoints used by the
	// bulk-import Web UI. See importpkg.Handlers.Register for the route map.
	Import *importpkg.Handlers
}
