// Package core provides the shared service assembly layer for the control-service.
//
// Both the full (team trial) and user-only (personal edition) appkit variants
// call NewBase() to create the common infrastructure (repos, services, mailer,
// encryption, etc.) without importing any handler packages.
package core

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"

	"github.com/AiKeyLabs/aikey-control-service/internal/api"
	"github.com/AiKeyLabs/aikey-control-service/internal/api/user"
	"github.com/AiKeyLabs/aikey-control-service/internal/api/user/importpkg"
	"github.com/AiKeyLabs/aikey-control-service/pkg/identity"
	"github.com/AiKeyLabs/aikey-control-service/pkg/managedkey"
	"github.com/AiKeyLabs/aikey-control-service/internal/organization"
	"github.com/AiKeyLabs/aikey-control-service/internal/provider"
	"github.com/AiKeyLabs/aikey-control-service/internal/referral"
	"github.com/AiKeyLabs/aikey-control-service/pkg/shared"
	"github.com/AiKeyLabs/aikey-control-service/pkg/snapshot"
)

// Config holds configuration for the control-service handler assembly.
type Config struct {
	DBDialect            string
	JWTSecret            []byte
	MasterKeyB64         string
	ServiceToken         string
	DefaultAdminEmail    string
	DefaultAdminPassword string
	CORSOrigins          []string
	BaseURL              string
	WebBaseURL           string
	Logger               *slog.Logger
	SMTPHost             string
	SMTPPort             int
	SMTPUser             string
	SMTPPassword         string
	SMTPFrom             string
	UsageFacade          http.Handler
	AlwaysLogActivationURL bool
	AuthMode             string // "jwt" (default) or "local_bypass"
	Mode                 string // "local-user" or "trial-full" or ""

	// Version is the build version advertised by GET /system/status.
	// If empty, /system/status still works but omits the version field.
	Version string
	// CollectorURL / QueryURL advertised by /system/status. Empty in trial
	// (single-port deployments), set in production where collector-service
	// and query-service run on separate hosts/ports.
	CollectorURL string
	QueryURL     string
}

// Base holds the assembled infrastructure that both full and user-only
// variants need to construct their HTTP handlers.
type Base struct {
	DB          *sql.DB
	Logger      *slog.Logger
	Cfg         Config

	// Auth middleware (JWTMiddleware or LocalIdentityMiddleware).
	AuthMiddleware func(http.Handler) http.Handler

	// Domain services.
	IdentitySvc   *identity.Service
	OrgSvc        *organization.Service
	ProviderSvc   *provider.Service
	ManagedKeySvc *managedkey.Service

	// Repositories (needed by handlers that take repo interfaces directly).
	IdentityRepo identity.Repository
	VKRepo       managedkey.VirtualKeyRepository
	BindingRepo  managedkey.BindingRepository
	SeatRepo     organization.SeatRepository
	ReferralRepo referral.Repository

	// Snapshot service (cross-domain, used by both master and user handlers).
	SnapshotSvc *snapshot.Service

	// Pre-built shared handlers.
	IdentityH *api.IdentityHandler
	CLILoginH *api.CLILoginHandler
	ResolveH  *api.ResolveHandler
	DeliveryH *api.DeliveryHandler

	// Pre-built user handlers.
	UserHandlers *user.Handlers

	// Usage facade.
	UsageFacade http.Handler
}

// NewBase assembles the shared control-service infrastructure.
// Does NOT create master handlers — the caller decides whether to import
// the master package and create master handlers.
func NewBase(db *sql.DB, cfg Config) (*Base, error) {
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}

	// Encryption.
	masterKey, err := shared.MasterKeyFromBase64(cfg.MasterKeyB64)
	if err != nil {
		logger.Error("appkit: load master key", slog.Any("error", err))
		return nil, err
	}
	enc, err := shared.NewAESEncryptor(masterKey)
	if err != nil {
		logger.Error("appkit: init encryptor", slog.Any("error", err))
		return nil, err
	}

	// JWT token service — needed for CLI login even in local_bypass mode.
	tokens := shared.NewTokenService(cfg.JWTSecret)

	// Auth middleware — select based on mode.
	var authMiddleware func(http.Handler) http.Handler
	if cfg.AuthMode == "local_bypass" {
		authMiddleware = shared.LocalIdentityMiddleware(tokens)
	} else {
		authMiddleware = shared.JWTMiddleware(tokens)
	}

	// Repositories.
	ddb := shared.NewDB(db, cfg.DBDialect)

	identityRepo := identity.NewSQLRepository(ddb)
	loginSessionRepo := identity.NewLoginSessionRepository(ddb)
	refreshTokenRepo := identity.NewRefreshTokenRepository(ddb)
	orgRepo := organization.NewSQLOrgRepository(ddb)
	seatRepo := organization.NewSQLSeatRepository(ddb)
	providerRepo := provider.NewSQLProviderRepository(ddb)
	credRepo := provider.NewSQLCredentialRepository(ddb)
	referralRepo := referral.NewSQLRepository(ddb)

	// Why: managedkey repos are branched by dialect to prevent PostgreSQL-specific
	// SQL from silently failing on SQLite (Trial mode).
	var (
		bindingRepo managedkey.BindingRepository
		vkRepo      managedkey.VirtualKeyRepository
		eventRepo   managedkey.ControlEventRepository
		credLookup  managedkey.CredentialLookup
	)
	if cfg.DBDialect == shared.DialectSQLite {
		bindingRepo = managedkey.NewSQLiteBindingRepository(ddb)
		vkRepo = managedkey.NewSQLiteVirtualKeyRepository(ddb)
		eventRepo = managedkey.NewSQLiteControlEventRepository(ddb)
		credLookup = managedkey.NewSQLiteCredentialLookup(ddb)
	} else {
		bindingRepo = managedkey.NewPostgresBindingRepository(ddb)
		vkRepo = managedkey.NewPostgresVirtualKeyRepository(ddb)
		eventRepo = managedkey.NewPostgresControlEventRepository(ddb)
		credLookup = managedkey.NewPostgresCredentialLookup(ddb)
	}

	// Services.
	identitySvc := identity.NewService(identityRepo)
	orgSvc := organization.NewService(orgRepo, seatRepo)
	providerSvc := provider.NewService(providerRepo, credRepo, enc)
	managedKeySvc := managedkey.NewService(bindingRepo, vkRepo, eventRepo, credLookup)

	// Seed local-owner account for local-user mode (idempotent).
	if cfg.Mode == "local-user" {
		existing, _ := identityRepo.FindByID(context.Background(), shared.LocalOwnerAccountID)
		if existing == nil {
			localAccount := &identity.GlobalAccount{
				AccountID:     shared.LocalOwnerAccountID,
				Email:         shared.LocalOwnerEmail,
				AccountStatus: "active",
			}
			if err := identityRepo.Create(context.Background(), localAccount); err != nil {
				logger.Error("seed local-owner account", slog.Any("error", err))
			} else {
				logger.Info("local-owner account created")
			}
		}
	}

	// Seed default data — skipped in local-user mode (no admin, no org needed).
	if cfg.Mode != "local-user" {
		if cfg.DefaultAdminEmail != "" && cfg.DefaultAdminPassword != "" {
			_, err := identitySvc.Register(context.Background(), identity.RegisterParams{
				Email:    cfg.DefaultAdminEmail,
				Password: cfg.DefaultAdminPassword,
			})
			if err != nil {
				if de, ok := err.(*shared.DomainError); ok && de.Code == "BIZ_AUTH_EMAIL_TAKEN" {
					logger.Info("default admin already exists", slog.String("email", cfg.DefaultAdminEmail))
				} else {
					logger.Error("seed admin", slog.Any("error", err))
				}
			} else {
				logger.Info("default admin created", slog.String("email", cfg.DefaultAdminEmail))
			}
		}
		SeedProviders(context.Background(), providerSvc, logger)
		if cfg.DefaultAdminEmail != "" {
			SeedDefaultOrg(context.Background(), orgSvc, cfg.DefaultAdminEmail, logger)
		}
	}

	// Mailer.
	var mailer identity.Mailer
	logMailer := identity.NewLogMailer(logger)
	if cfg.SMTPPassword != "" {
		smtpMailer := identity.NewSMTPMailer(
			cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUser,
			cfg.SMTPPassword, cfg.SMTPFrom, logger,
		)
		if cfg.AlwaysLogActivationURL {
			mailer = identity.NewDualMailer(smtpMailer, logMailer, logger)
			logger.Info("using SMTP+Log dual mailer (trial mode)", slog.String("host", cfg.SMTPHost))
		} else {
			mailer = smtpMailer
			logger.Info("using SMTP mailer", slog.String("host", cfg.SMTPHost))
		}
	} else {
		mailer = logMailer
		logger.Warn("SMTP not configured — using LogMailer (activation URLs logged to console)")
	}

	cliLoginSvc := identity.NewCLILoginService(
		identityRepo, loginSessionRepo, refreshTokenRepo,
		orgSvc, tokens, mailer, cfg.BaseURL, cfg.WebBaseURL, logger,
	)

	referralRecorder := referral.NewRecorder(referralRepo)
	cliLoginSvc.SetReferralRecorder(referralRecorder)
	cliLoginSvc.SetVKShareReconciler(managedKeySvc)

	// Shared handlers.
	snapshotSvc := snapshot.NewServiceWithDialect(db, cfg.DBDialect, seatRepo, vkRepo, bindingRepo, providerSvc, identityRepo)
	identityH := api.NewIdentityHandler(identitySvc, tokens)
	cliLoginH := api.NewCLILoginHandler(cliLoginSvc)
	resolveH := api.NewResolveHandler(vkRepo, bindingRepo, providerSvc)
	deliveryH := api.NewDeliveryHandler(vkRepo, bindingRepo, seatRepo, providerSvc, managedKeySvc, snapshotSvc)

	// User handlers. Page rendering is fully React/SPA (see user.Handlers
	// docblock); this layer owns only referral + bulk-import APIs.
	userHandlers := &user.Handlers{
		Referral: user.NewReferralHandler(referralRepo),
		Import:   importpkg.NewHandlers(nil, logger),
	}

	// Usage facade.
	usageFacade := cfg.UsageFacade
	if usageFacade == nil {
		usageFacade = http.NotFoundHandler()
	}

	return &Base{
		DB:             db,
		Logger:         logger,
		Cfg:            cfg,
		AuthMiddleware: authMiddleware,
		IdentitySvc:    identitySvc,
		OrgSvc:         orgSvc,
		ProviderSvc:    providerSvc,
		ManagedKeySvc:  managedKeySvc,
		IdentityRepo:   identityRepo,
		VKRepo:         vkRepo,
		BindingRepo:    bindingRepo,
		SeatRepo:       seatRepo,
		ReferralRepo:   referralRepo,
		SnapshotSvc:    snapshotSvc,
		IdentityH:      identityH,
		CLILoginH:      cliLoginH,
		ResolveH:       resolveH,
		DeliveryH:      deliveryH,
		UserHandlers:   userHandlers,
		UsageFacade:    usageFacade,
	}, nil
}

// SeedProviders ensures built-in AI provider definitions exist.
func SeedProviders(ctx context.Context, svc *provider.Service, logger *slog.Logger) {
	existing, err := svc.ListProviders(ctx)
	if err != nil {
		logger.Error("seed providers: list failed", slog.Any("error", err))
		return
	}
	if len(existing) > 0 {
		return
	}
	builtins := []provider.Provider{
		{ProviderCode: "openai", DisplayName: "OpenAI", ProtocolType: provider.ProtocolOpenAICompatible, DefaultBaseURL: "https://api.openai.com/v1"},
		{ProviderCode: "anthropic", DisplayName: "Anthropic", ProtocolType: provider.ProtocolAnthropic, DefaultBaseURL: "https://api.anthropic.com"},
		{ProviderCode: "kimi", DisplayName: "Kimi (Moonshot)", ProtocolType: provider.ProtocolOpenAICompatible, DefaultBaseURL: "https://api.moonshot.cn/v1"},
	}
	for _, p := range builtins {
		if _, err := svc.CreateProvider(ctx, p); err != nil {
			logger.Error("seed provider", slog.String("code", p.ProviderCode), slog.Any("error", err))
		}
	}
}

// SeedDefaultOrg creates a default organization and assigns the admin a seat.
func SeedDefaultOrg(ctx context.Context, svc *organization.Service, adminEmail string, logger *slog.Logger) {
	existing, err := svc.ListOrgs(ctx)
	if err != nil {
		logger.Error("seed org: list failed", slog.Any("error", err))
		return
	}
	if len(existing) > 0 {
		return
	}
	org, err := svc.CreateOrg(ctx, "Default")
	if err != nil {
		logger.Error("seed org: create failed", slog.Any("error", err))
		return
	}
	_, err = svc.CreateSeat(ctx, organization.CreateSeatParams{
		OrgID:        org.OrgID,
		InvitedEmail: adminEmail,
	})
	if err != nil {
		logger.Error("seed admin seat", slog.Any("error", err))
	}
}
