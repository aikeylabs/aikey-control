// Package user assembles the user-only control-service handler (no master routes).
// Used by aikey-local-server (personal edition binary).
//
// This package does NOT import api/master — binaries compiled with this
// package will not contain any master handler code (physical isolation).
package user

import (
	"database/sql"
	"net/http"

	"github.com/AiKeyLabs/aikey-control-service/internal/api"

	"github.com/AiKeyLabs/aikey-control-service/appkit/core"
)

// NewHandler assembles the user-only control-service (user + shared routes,
// no master routes) and returns a single http.Handler.
func NewHandler(db *sql.DB, cfg core.Config) http.Handler {
	base, err := core.NewBase(db, cfg)
	if err != nil {
		return errorHandler("control-service init: " + err.Error())
	}

	// No master handlers — MasterMux is nil.
	handler := api.NewRouter(api.RouterDeps{
		Identity:     base.IdentityH,
		CLILogin:     base.CLILoginH,
		Resolve:      base.ResolveH,
		Delivery:     base.DeliveryH,
		UsageFacade:  base.UsageFacade,
		MasterMux:    nil, // personal edition: no master routes
		User:         base.UserHandlers,
		Auth:         base.AuthMiddleware,
		ServiceToken: cfg.ServiceToken,
		Logger:       base.Logger,
		Mode:         cfg.Mode,
		SystemStatus: api.SystemStatusConfig{
			BaseURL:      cfg.BaseURL,
			Version:      cfg.Version,
			CollectorURL: cfg.CollectorURL,
			QueryURL:     cfg.QueryURL,
		},
	})
	handler = api.WithCORS(handler, cfg.CORSOrigins)

	return handler
}

func errorHandler(msg string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, msg, http.StatusInternalServerError)
	})
}
