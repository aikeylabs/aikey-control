package identity

import (
	"context"
	"errors"
	"fmt"
	"html/template"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/AiKeyLabs/aikey-control/service/pkg/shared"
)

// SeatReconciler links pending OrgSeats to a newly-activated account.
// Implemented by organization.Service (structural typing — no import cycle).
type SeatReconciler interface {
	// ReconcileByEmail idempotently binds all pending_claim seats with
	// invited_email = email to accountID.  Returns seats bound (0 = already done).
	ReconcileByEmail(ctx context.Context, email, accountID string) (int, error)
}

// VKShareReconciler transitions VK share_status from pending_claim to claimed
// after seat reconciliation. Implemented by managedkey.Service (structural typing).
// Why: when a VK is issued BEFORE the member logs in, share_status stays
// pending_claim even after the seat becomes active. This reconciler closes that gap.
type VKShareReconciler interface {
	ReconcileVKShareStatusByEmail(ctx context.Context, email string) (int, error)
}

// ActivationMessage carries the context needed to render and send an
// activation email.  A struct (rather than positional args) keeps the
// Mailer interface stable as we add more context (device, IP, locale…).
//
// Why: varying Subject per send — on OS/time — lowers the probability
// that anti-spam engines flag repeated logins as duplicate content, AND
// gives the user a visible cue to tell successive login emails apart.
type ActivationMessage struct {
	ToEmail        string
	ActivationURL  string
	OSPlatform     string    // darwin/linux/windows; empty ⇒ "unknown device"
	SentAt         time.Time // used for Subject variation + Date header; caller sets to time.Now().UTC()
	LoginSessionID string    // used to build an RFC 5322 Message-ID that correlates with server logs
}

// Mailer sends activation emails.
// Replace LogMailer with a real SMTP/SES implementation for production.
type Mailer interface {
	SendActivationEmail(ctx context.Context, msg ActivationMessage) error
}

// DualMailer sends activation emails via a primary mailer (e.g. SMTP) and
// also logs the activation URL for diagnostics. Used by trial-server sandbox
// where SMTP delivery may be unreliable but logs are always accessible.
type DualMailer struct {
	primary Mailer
	log     *LogMailer
	logger  *slog.Logger
}

// NewDualMailer creates a mailer that sends via primary AND logs the URL.
func NewDualMailer(primary Mailer, log *LogMailer, logger *slog.Logger) *DualMailer {
	return &DualMailer{primary: primary, log: log, logger: logger}
}

func (m *DualMailer) SendActivationEmail(ctx context.Context, msg ActivationMessage) error {
	// Always log first (guaranteed to succeed) so sandbox E2E can extract the URL.
	_ = m.log.SendActivationEmail(ctx, msg)
	// Then attempt SMTP — log error but don't fail the login flow.
	if err := m.primary.SendActivationEmail(ctx, msg); err != nil {
		m.logger.Warn("SMTP send failed, activation URL is in log above",
			slog.String("to", msg.ToEmail), slog.String("error", err.Error()))
		return nil // Don't block login — URL is in the log.
	}
	return nil
}

// LogMailer writes activation URLs to the structured logger — local dev only.
type LogMailer struct{ logger *slog.Logger }

// NewLogMailer creates a LogMailer that logs activation URLs instead of sending email.
func NewLogMailer(logger *slog.Logger) *LogMailer { return &LogMailer{logger: logger} }

func (m *LogMailer) SendActivationEmail(_ context.Context, msg ActivationMessage) error {
	// Also print prominently to stderr so the link is easy to click in dev.
	fmt.Fprintf(os.Stderr, "\n"+
		"┌─────────────────────────────────────────────────────┐\n"+
		"│  [DEV] Activation email — replace LogMailer in prod │\n"+
		"│  To: %-47s│\n"+
		"│                                                     │\n"+
		"│  Click to activate:                                 │\n"+
		"│  %-51s│\n"+
		"└─────────────────────────────────────────────────────┘\n\n",
		msg.ToEmail, msg.ActivationURL)
	m.logger.Info("activation email (log-only — replace LogMailer in production)",
		slog.String("to", msg.ToEmail),
		slog.String("activation_url", msg.ActivationURL))
	return nil
}

// CLILoginService orchestrates the aikey login OAuth device flow.
//
// Flow: Start → [email click] → Activate → [CLI polls] → Poll → (token issued)
//       Fallback: Activate shows login_token → Exchange → (token issued)
//       Renewal:  Refresh
// ReferralRecorder is an optional side-path interface for recording invite referrals.
// Errors from this interface must never block the login flow.
type ReferralRecorder interface {
	RecordReferral(ctx context.Context, referrerAccountID, referredEmail string) error
	CompleteReferral(ctx context.Context, referredEmail, referredAccountID string) error
}

type CLILoginService struct {
	identityRepo   Repository
	sessionRepo    LoginSessionRepository
	refreshRepo    RefreshTokenRepository
	reconciler     SeatReconciler
	vkReconciler   VKShareReconciler // optional; nil = VK share reconciliation skipped
	tokens         *shared.TokenService
	mailer         Mailer
	referrals      ReferralRecorder // optional; nil = referrals disabled
	baseURL        string
	webBaseURL     string // frontend URL for post-activation redirects; defaults to baseURL
	logger         *slog.Logger
}

// NewCLILoginService creates a CLILoginService.
func NewCLILoginService(
	identityRepo Repository,
	sessionRepo LoginSessionRepository,
	refreshRepo RefreshTokenRepository,
	reconciler SeatReconciler,
	tokens *shared.TokenService,
	mailer Mailer,
	baseURL string,
	webBaseURL string,
	logger *slog.Logger,
) *CLILoginService {
	wb := strings.TrimRight(webBaseURL, "/")
	if wb == "" {
		wb = strings.TrimRight(baseURL, "/")
	}
	return &CLILoginService{
		identityRepo: identityRepo,
		sessionRepo:  sessionRepo,
		refreshRepo:  refreshRepo,
		reconciler:   reconciler,
		tokens:       tokens,
		mailer:       mailer,
		baseURL:      strings.TrimRight(baseURL, "/"),
		webBaseURL:   wb,
		logger:       logger,
	}
}

// SetReferralRecorder attaches an optional referral recorder.
// Must be called before serving requests. Nil disables referral tracking.
func (s *CLILoginService) SetReferralRecorder(r ReferralRecorder) {
	s.referrals = r
}

// SetVKShareReconciler attaches an optional VK share-status reconciler.
// When set, Activate() will also transition pending_claim VKs to claimed
// after seat reconciliation succeeds. Nil disables VK share reconciliation.
func (s *CLILoginService) SetVKShareReconciler(r VKShareReconciler) {
	s.vkReconciler = r
}

// ── Init ─────────────────────────────────────────────────────────────────────

// InitResult is returned immediately after Init — the CLI opens a browser to the
// login page and begins polling; the browser then calls Begin() with the user's email.
type InitResult struct {
	LoginSessionID      string
	DeviceCode          string
	PollIntervalSeconds int
	ExpiresInSeconds    int
}

// Init creates an empty login session (no email yet) and returns the session
// credentials.  The CLI opens the web login page with these credentials so that
// the user can enter their email in the browser.
func (s *CLILoginService) Init(ctx context.Context, clientName, clientVersion, osPlatform string) (*InitResult, error) {
	deviceCode, _, err := shared.GenerateOpaqueToken()
	if err != nil {
		return nil, fmt.Errorf("generate device code: %w", err)
	}
	// Placeholder activation_token — replaced when Begin() is called.
	// A unique value is required here to satisfy the UNIQUE INDEX on the column.
	placeholderToken, _, err := shared.GenerateOpaqueToken()
	if err != nil {
		return nil, fmt.Errorf("generate placeholder token: %w", err)
	}

	now := time.Now().UTC()
	session := &LoginSession{
		LoginSessionID:  shared.NewID(),
		DeviceCode:      deviceCode,
		ActivationToken: placeholderToken,
		Email:           "", // set by Begin()
		ClientName:      clientName,
		ClientVersion:   clientVersion,
		OSPlatform:      osPlatform,
		Status:          LoginSessionStatusPendingEmailEntry,
		ExpiresAt:       now.Add(LoginSessionTTL),
	}
	if err := s.sessionRepo.Create(ctx, session); err != nil {
		return nil, fmt.Errorf("create login session: %w", err)
	}

	return &InitResult{
		LoginSessionID:      session.LoginSessionID,
		DeviceCode:          deviceCode,
		PollIntervalSeconds: PollIntervalSeconds,
		ExpiresInSeconds:    int(LoginSessionTTL.Seconds()),
	}, nil
}

// ── Begin ─────────────────────────────────────────────────────────────────────

// BeginParams carries the email submitted via the web login page.
type BeginParams struct {
	SessionID  string
	DeviceCode string
	Email      string
	ReferrerID string // optional: account_id of the user who shared the invite link
}

// BeginResult is returned to the web login page after the activation email is sent.
type BeginResult struct {
	MaskedEmail string
}

// Begin attaches an email to a pending_email_entry session and sends the activation
// email.  Called from the browser login page after the user submits their address.
func (s *CLILoginService) Begin(ctx context.Context, p BeginParams) (*BeginResult, error) {
	email := normalizeEmail(p.Email)
	if email == "" {
		return nil, shared.DataMissingField("email")
	}

	session, err := s.sessionRepo.FindByID(ctx, p.SessionID)
	if err != nil {
		return nil, fmt.Errorf("find session: %w", err)
	}
	// Why the device_code check still runs before any status branching:
	// device_code is the unforgeable shared secret between the CLI and the
	// browser. Without it, anyone who gleans a session_id from a URL could
	// trigger email sends on behalf of a victim. Matches the original design.
	if session == nil || session.DeviceCode != p.DeviceCode {
		return nil, shared.BizLoginSessionNotFound(p.SessionID)
	}
	if session.IsExpired() {
		return nil, shared.BizLoginSessionExpired()
	}

	now := time.Now().UTC()

	switch session.Status {
	case LoginSessionStatusPendingEmailEntry:
		// First-time Begin: current flow.
		return s.beginFirstSend(ctx, session, email, now, p.ReferrerID)

	case LoginSessionStatusPendingEmailActivation:
		// Resend or change-email on a session that has already had one
		// activation email sent. Enforce cooldown, rotate activation_token
		// (invalidating the old email link), and send a new mail.
		return s.beginResendOrChangeEmail(ctx, session, email, now, p.ReferrerID)

	default:
		// approved_pending_claim / token_issued / denied / cancelled / expired:
		// the flow is past the point where a new activation email makes
		// sense. Tell the user so they can restart, rather than returning
		// a misleading "session not found".
		return nil, shared.BizLoginSessionTerminated(session.Status)
	}
}

// beginFirstSend is the original first-Begin path: set email + token, send mail.
func (s *CLILoginService) beginFirstSend(ctx context.Context, session *LoginSession, email string, now time.Time, referrerID string) (*BeginResult, error) {
	activationToken, _, err := shared.GenerateOpaqueToken()
	if err != nil {
		return nil, fmt.Errorf("generate activation token: %w", err)
	}
	if err := s.sessionRepo.SetEmail(ctx, session.LoginSessionID, session.DeviceCode, email, activationToken); err != nil {
		// A concurrent caller may have moved the session to pending_email_activation
		// between our earlier FindByID and this SetEmail. Bounce to the resend
		// path; it performs its own validation atomically.
		if errors.Is(err, ErrLoginSessionWrongState) {
			refreshed, rerr := s.sessionRepo.FindByID(ctx, session.LoginSessionID)
			if rerr == nil && refreshed != nil {
				return s.beginResendOrChangeEmail(ctx, refreshed, email, now, referrerID)
			}
		}
		return nil, fmt.Errorf("set email on session: %w", err)
	}

	s.dispatchActivationEmail(ctx, session, email, activationToken, now)
	s.recordReferralIfAny(ctx, referrerID, email)
	return &BeginResult{MaskedEmail: maskEmail(email)}, nil
}

// beginResendOrChangeEmail handles the case where the session is already in
// pending_email_activation. Shared path for two UX flows:
//   - user didn't receive the email, clicks "Resend" → same email
//   - user typed the wrong address, clicks "Change email" → different email
//
// Both rotate the activation_token so the old email link stops working.
func (s *CLILoginService) beginResendOrChangeEmail(ctx context.Context, session *LoginSession, email string, now time.Time, referrerID string) (*BeginResult, error) {
	// Cooldown check — prevents the form from being hammered and caps the
	// outbound mail rate per session. Per-email / global rate-limits are a
	// separate layer (TODO, out of scope for this fix).
	if session.LastEmailSentAt != nil {
		elapsed := now.Sub(*session.LastEmailSentAt)
		if elapsed < LoginResendCooldown {
			remaining := LoginResendCooldown - elapsed
			secs := int(remaining.Round(time.Second).Seconds())
			if secs < 1 {
				secs = 1
			}
			return nil, shared.BizLoginResendCooldown(secs)
		}
	}

	activationToken, _, err := shared.GenerateOpaqueToken()
	if err != nil {
		return nil, fmt.Errorf("generate activation token: %w", err)
	}
	if err := s.sessionRepo.ResendEmail(ctx, session.LoginSessionID, session.DeviceCode, email, activationToken); err != nil {
		if errors.Is(err, ErrLoginSessionWrongState) {
			// Race: status moved away between FindByID and Update. Re-read
			// and surface a terminal/expired error rather than a cryptic
			// "not found".
			refreshed, rerr := s.sessionRepo.FindByID(ctx, session.LoginSessionID)
			if rerr == nil && refreshed != nil {
				if refreshed.IsExpired() {
					return nil, shared.BizLoginSessionExpired()
				}
				return nil, shared.BizLoginSessionTerminated(refreshed.Status)
			}
		}
		return nil, fmt.Errorf("resend email on session: %w", err)
	}

	s.dispatchActivationEmail(ctx, session, email, activationToken, now)
	// Record referral only on first observed email (avoid double-counting on resend).
	if session.Email == "" || session.Email != email {
		s.recordReferralIfAny(ctx, referrerID, email)
	}
	return &BeginResult{MaskedEmail: maskEmail(email)}, nil
}

func (s *CLILoginService) dispatchActivationEmail(ctx context.Context, session *LoginSession, email, activationToken string, sentAt time.Time) {
	activationURL := fmt.Sprintf(
		"%s/v1/auth/cli/login/activate?token=%s",
		s.webBaseURL, activationToken,
	)
	if err := s.mailer.SendActivationEmail(ctx, ActivationMessage{
		ToEmail:        email,
		ActivationURL:  activationURL,
		OSPlatform:     session.OSPlatform,
		SentAt:         sentAt,
		LoginSessionID: session.LoginSessionID,
	}); err != nil {
		s.logger.Warn("send activation email failed",
			slog.String("email", email), slog.Any("error", err))
	}
}

func (s *CLILoginService) recordReferralIfAny(ctx context.Context, referrerID, email string) {
	if referrerID == "" || s.referrals == nil {
		return
	}
	if err := s.referrals.RecordReferral(ctx, referrerID, email); err != nil {
		s.logger.Warn("record referral failed (non-fatal)",
			slog.String("referrer", referrerID),
			slog.String("email", email),
			slog.Any("error", err))
	}
}

// ── Start ────────────────────────────────────────────────────────────────────

// StartParams carries CLI input for initiating a login session.
type StartParams struct {
	Email         string
	ClientName    string
	ClientVersion string
	OSPlatform    string
}

// StartResult is returned to the CLI immediately after Start.
type StartResult struct {
	LoginSessionID      string
	DeviceCode          string
	MaskedEmail         string
	PollIntervalSeconds int
	ExpiresInSeconds    int
}

// Start creates a login session and sends an activation email.
// The CLI retains device_code and login_session_id for subsequent Poll calls.
func (s *CLILoginService) Start(ctx context.Context, p StartParams) (*StartResult, error) {
	email := normalizeEmail(p.Email)
	if email == "" {
		return nil, shared.DataMissingField("email")
	}

	deviceCode, _, err := shared.GenerateOpaqueToken()
	if err != nil {
		return nil, fmt.Errorf("generate device code: %w", err)
	}
	activationToken, _, err := shared.GenerateOpaqueToken()
	if err != nil {
		return nil, fmt.Errorf("generate activation token: %w", err)
	}

	now := time.Now().UTC()
	session := &LoginSession{
		LoginSessionID:  shared.NewID(),
		DeviceCode:      deviceCode,
		ActivationToken: activationToken,
		Email:           email,
		ClientName:      p.ClientName,
		ClientVersion:   p.ClientVersion,
		OSPlatform:      p.OSPlatform,
		Status:          LoginSessionStatusPendingEmailActivation,
		ExpiresAt:       now.Add(LoginSessionTTL),
	}
	if err := s.sessionRepo.Create(ctx, session); err != nil {
		return nil, fmt.Errorf("create login session: %w", err)
	}

	activationURL := fmt.Sprintf(
		"%s/v1/auth/cli/login/activate?token=%s",
		s.webBaseURL, activationToken,
	)
	if err := s.mailer.SendActivationEmail(ctx, ActivationMessage{
		ToEmail:        email,
		ActivationURL:  activationURL,
		OSPlatform:     p.OSPlatform,
		SentAt:         time.Now().UTC(),
		LoginSessionID: session.LoginSessionID,
	}); err != nil {
		// Email failure is non-fatal: log a warning, CLI will poll until expiry.
		s.logger.Warn("send activation email failed",
			slog.String("email", email), slog.Any("error", err))
	}

	return &StartResult{
		LoginSessionID:      session.LoginSessionID,
		DeviceCode:          deviceCode,
		MaskedEmail:         maskEmail(email),
		PollIntervalSeconds: PollIntervalSeconds,
		ExpiresInSeconds:    int(LoginSessionTTL.Seconds()),
	}, nil
}

// ── Activate ─────────────────────────────────────────────────────────────────

// ActivateResult describes the activation outcome; rendered as an HTML page.
type ActivateResult struct {
	Success     bool
	Email       string
	LoginToken  string // fallback copy-paste token; empty on failure
	Message     string
	RedirectURL string // full URL for post-activation redirect (e.g. http://localhost:3000/user/overview)
}

// Activate processes the email-link click.
//
// Steps:
//  1. Validate activation token and session state.
//  2. Find or create the GlobalAccount (no password — OAuth-only).
//  3. Idempotently reconcile OrgSeats by email.
//  4. Generate the fallback login_token and mark session approved_pending_claim.
func (s *CLILoginService) Activate(ctx context.Context, activationToken string) (*ActivateResult, error) {
	session, err := s.sessionRepo.FindByActivationToken(ctx, activationToken)
	if err != nil {
		return nil, fmt.Errorf("find session: %w", err)
	}
	if session == nil {
		return &ActivateResult{Message: "Activation link is invalid or has already been used."}, nil
	}
	if session.IsExpired() {
		return &ActivateResult{Message: "Activation link has expired. Please run aikey login again."}, nil
	}

	// Idempotent: session was already activated by a prior click.
	if session.Status == LoginSessionStatusApprovedPendingClaim ||
		session.Status == LoginSessionStatusTokenIssued {
		lt := ""
		if session.LoginToken != nil {
			lt = *session.LoginToken
		}
		// Still issue a web JWT so the "Go to Console" button works on repeat clicks.
		idempotentRedirect := s.webBaseURL + "/user/overview"
		if account, err := s.identityRepo.FindByEmail(ctx, session.Email); err == nil && account != nil {
			if webJWT, err := s.tokens.IssueAccessToken(account.AccountID, account.Email); err == nil {
				idempotentRedirect += "#auth_token=" + webJWT
			}
		}
		return &ActivateResult{
			Success:     true,
			Email:       session.Email,
			LoginToken:  lt,
			Message:     "Already activated. Your CLI should complete login automatically.",
			RedirectURL: idempotentRedirect,
		}, nil
	}
	if session.Status == LoginSessionStatusDenied {
		return &ActivateResult{Message: "This login request has been denied."}, nil
	}

	// Find or create GlobalAccount.
	account, err := s.identityRepo.FindByEmail(ctx, session.Email)
	if err != nil {
		return nil, fmt.Errorf("find account: %w", err)
	}
	if account != nil && !account.IsActive() {
		_ = s.sessionRepo.Deny(ctx, session.LoginSessionID)
		return &ActivateResult{
			Message: "Your account has been suspended or deleted. Please contact support.",
		}, nil
	}
	if account == nil {
		// First-time activation — create an OAuth-only account (no password).
		account = &GlobalAccount{
			AccountID:     shared.NewID(),
			Email:         session.Email,
			AccountStatus: AccountStatusActive,
			// PasswordHash intentionally empty — members authenticate via aikey login only.
		}
		if err := s.identityRepo.Create(ctx, account); err != nil {
			return nil, fmt.Errorf("create account: %w", err)
		}
	}

	// Idempotently reconcile any pending OrgSeats for this email.
	reconciled, reconcileErr := s.reconciler.ReconcileByEmail(ctx, session.Email, account.AccountID)
	if reconcileErr != nil {
		// Non-fatal: log warning; session continues to approved_pending_claim.
		s.logger.Warn("seat reconciliation error",
			slog.String("email", session.Email), slog.Any("error", reconcileErr))
	} else if reconciled > 0 {
		s.logger.Info("seats reconciled on activation",
			slog.Int("count", reconciled), slog.String("email", session.Email))
	}

	// Reconcile VK share_status: transition pending_claim → claimed for VKs
	// that were issued BEFORE the member logged in. Must run after seat
	// reconciliation so that the seat is already active when the subquery runs.
	if s.vkReconciler != nil {
		vkClaimed, vkErr := s.vkReconciler.ReconcileVKShareStatusByEmail(ctx, session.Email)
		if vkErr != nil {
			// Non-fatal: log warning; the snapshot refresh will still show not_claimed
			// but the next login or manual claim will fix it.
			s.logger.Warn("VK share_status reconciliation error",
				slog.String("email", session.Email), slog.Any("error", vkErr))
		} else if vkClaimed > 0 {
			s.logger.Info("VK share_status reconciled on activation",
				slog.Int("count", vkClaimed), slog.String("email", session.Email))
		}
	}

	// Side-path: complete any pending referrals for this email (non-blocking).
	if s.referrals != nil {
		if err := s.referrals.CompleteReferral(ctx, session.Email, account.AccountID); err != nil {
			s.logger.Warn("complete referral failed (non-fatal)",
				slog.String("email", session.Email), slog.Any("error", err))
		}
	}

	// Generate the fallback copy-paste login_token (used only if CLI misses poll).
	loginTokenPlain, _, err := shared.GenerateOpaqueToken()
	if err != nil {
		return nil, fmt.Errorf("generate login token: %w", err)
	}

	if err := s.sessionRepo.Approve(ctx, session.LoginSessionID, loginTokenPlain, account.AccountID); err != nil {
		return nil, fmt.Errorf("approve session: %w", err)
	}

	// Issue a web JWT so the "Go to Console" redirect can authenticate.
	// This is a short-lived access token; the CLI will separately exchange
	// its login_token for its own token pair.
	redirectURL := s.webBaseURL + "/user/overview"
	if webJWT, err := s.tokens.IssueAccessToken(account.AccountID, account.Email); err == nil {
		redirectURL += "#auth_token=" + webJWT
	}

	return &ActivateResult{
		Success:     true,
		Email:       session.Email,
		LoginToken:  loginTokenPlain,
		Message:     "Email verified. Your CLI should complete login automatically.",
		RedirectURL: redirectURL,
	}, nil
}

// ── Poll ──────────────────────────────────────────────────────────────────────

// PollStatus is the status code returned to the CLI on each poll.
type PollStatus string

const (
	PollStatusPending      PollStatus = "pending"       // waiting for email activation
	PollStatusApproved     PollStatus = "approved"      // tokens included in this response
	PollStatusDenied       PollStatus = "denied"        // session denied; do not retry
	PollStatusExpired      PollStatus = "expired"       // session timed out
	PollStatusTokenClaimed PollStatus = "token_claimed" // tokens already issued to CLI
)

// OAuthTokenResult is the OAuth token pair returned to the CLI.
type OAuthTokenResult struct {
	AccessToken  string
	RefreshToken string
	TokenType    string
	ExpiresIn    int
	AccountID    string
	Email        string
}

// PollResult is the response to a Poll request.
type PollResult struct {
	Status PollStatus
	Token  *OAuthTokenResult // non-nil only when Status == PollStatusApproved
}

// Poll returns the current login session state and issues tokens when the session
// has been approved via email activation.
func (s *CLILoginService) Poll(ctx context.Context, sessionID, deviceCode string) (*PollResult, error) {
	session, err := s.sessionRepo.FindByID(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("find session: %w", err)
	}
	if session == nil || session.DeviceCode != deviceCode {
		return nil, shared.BizLoginSessionNotFound(sessionID)
	}

	// Treat wall-clock expiry as expired regardless of DB status.
	if session.IsExpired() && (session.Status == LoginSessionStatusPendingEmailActivation ||
		session.Status == LoginSessionStatusPendingEmailEntry) {
		return &PollResult{Status: PollStatusExpired}, nil
	}

	switch session.Status {
	case LoginSessionStatusPendingEmailEntry, LoginSessionStatusPendingEmailActivation:
		return &PollResult{Status: PollStatusPending}, nil

	case LoginSessionStatusDenied, LoginSessionStatusCancelled:
		return &PollResult{Status: PollStatusDenied}, nil

	case LoginSessionStatusExpired:
		return &PollResult{Status: PollStatusExpired}, nil

	case LoginSessionStatusTokenIssued:
		// Tokens were already claimed by a previous successful poll.
		// CLI should use the copy-paste exchange path with the login_token.
		return &PollResult{Status: PollStatusTokenClaimed}, nil

	case LoginSessionStatusApprovedPendingClaim:
		if session.AccountID == nil {
			s.logger.Error("session approved but account_id is nil",
				slog.String("session_id", sessionID))
			return nil, shared.SysInternal()
		}
		tokenResult, err := s.issueTokens(ctx, *session.AccountID, session.LoginSessionID)
		if err != nil {
			return nil, err
		}
		return &PollResult{Status: PollStatusApproved, Token: tokenResult}, nil
	}

	return &PollResult{Status: PollStatusPending}, nil
}

// ── Exchange ──────────────────────────────────────────────────────────────────

// Exchange redeems the one-time login_token (shown on the web activation page)
// for OAuth tokens.  Used as a fallback when CLI polling did not complete.
func (s *CLILoginService) Exchange(ctx context.Context, sessionID, loginToken string) (*OAuthTokenResult, error) {
	session, err := s.sessionRepo.FindByID(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("find session: %w", err)
	}
	if session == nil {
		return nil, shared.BizLoginSessionNotFound(sessionID)
	}
	if session.IsExpired() {
		return nil, shared.BizLoginSessionExpired()
	}
	if session.Status == LoginSessionStatusDenied || session.Status == LoginSessionStatusCancelled {
		return nil, shared.BizLoginSessionDenied()
	}
	if session.Status != LoginSessionStatusApprovedPendingClaim &&
		session.Status != LoginSessionStatusTokenIssued {
		return nil, shared.BizLoginTokenInvalid()
	}
	if session.LoginToken == nil || *session.LoginToken != loginToken {
		return nil, shared.BizLoginTokenInvalid()
	}
	if session.LoginTokenUsed {
		return nil, shared.BizLoginTokenAlreadyUsed()
	}
	if session.AccountID == nil {
		return nil, shared.SysInternal()
	}

	// Mark used before issuing so concurrent retries cannot both succeed.
	if err := s.sessionRepo.MarkLoginTokenUsed(ctx, session.LoginSessionID); err != nil {
		return nil, fmt.Errorf("mark login token used: %w", err)
	}

	return s.issueTokens(ctx, *session.AccountID, session.LoginSessionID)
}

// ── Refresh ───────────────────────────────────────────────────────────────────

// Refresh issues a new access token using a valid refresh token.
// The refresh token itself is not rotated (single-use rotation is a future upgrade).
func (s *CLILoginService) Refresh(ctx context.Context, refreshTokenPlain string) (*OAuthTokenResult, error) {
	hash := shared.HashToken(refreshTokenPlain)
	rt, err := s.refreshRepo.FindByHash(ctx, hash)
	if err != nil {
		return nil, fmt.Errorf("find refresh token: %w", err)
	}
	if rt == nil {
		return nil, shared.BizRefreshTokenInvalid()
	}
	if rt.Revoked {
		return nil, shared.BizRefreshTokenRevoked()
	}
	if time.Now().UTC().After(rt.ExpiresAt) {
		return nil, shared.BizRefreshTokenInvalid()
	}

	account, err := s.identityRepo.FindByID(ctx, rt.AccountID)
	if err != nil || account == nil {
		return nil, shared.BizAuthTokenInvalid()
	}
	if !account.IsActive() {
		return nil, shared.BizAuthAccountInactive()
	}

	accessToken, err := s.tokens.IssueAccessToken(account.AccountID, account.Email)
	if err != nil {
		return nil, fmt.Errorf("issue access token: %w", err)
	}
	_ = s.identityRepo.UpdateLastLogin(ctx, account.AccountID)

	return &OAuthTokenResult{
		AccessToken:  accessToken,
		RefreshToken: refreshTokenPlain, // same token; client overwrites local cache
		TokenType:    "Bearer",
		ExpiresIn:    int(shared.AccessTokenTTL.Seconds()),
		AccountID:    account.AccountID,
		Email:        account.Email,
	}, nil
}

// ── helpers ───────────────────────────────────────────────────────────────────

// issueTokens creates an access+refresh token pair and marks the session token_issued.
func (s *CLILoginService) issueTokens(ctx context.Context, accountID, sessionID string) (*OAuthTokenResult, error) {
	account, err := s.identityRepo.FindByID(ctx, accountID)
	if err != nil || account == nil {
		return nil, shared.SysInternal()
	}
	if !account.IsActive() {
		return nil, shared.BizAuthAccountInactive()
	}

	accessToken, err := s.tokens.IssueAccessToken(account.AccountID, account.Email)
	if err != nil {
		return nil, fmt.Errorf("issue access token: %w", err)
	}

	rtPlain, rtHash, err := shared.GenerateOpaqueToken()
	if err != nil {
		return nil, fmt.Errorf("generate refresh token: %w", err)
	}
	rt := &RefreshToken{
		TokenID:        shared.NewID(),
		AccountID:      account.AccountID,
		TokenHash:      rtHash,
		LoginSessionID: &sessionID,
		ExpiresAt:      time.Now().UTC().Add(RefreshTokenTTL),
	}
	if err := s.refreshRepo.Create(ctx, rt); err != nil {
		return nil, fmt.Errorf("store refresh token: %w", err)
	}

	if err := s.sessionRepo.IssueToken(ctx, sessionID); err != nil {
		s.logger.Warn("mark session token_issued failed", slog.Any("error", err))
	}
	_ = s.identityRepo.UpdateLastLogin(ctx, account.AccountID)

	return &OAuthTokenResult{
		AccessToken:  accessToken,
		RefreshToken: rtPlain,
		TokenType:    "Bearer",
		ExpiresIn:    int(shared.AccessTokenTTL.Seconds()),
		AccountID:    account.AccountID,
		Email:        account.Email,
	}, nil
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func maskEmail(email string) string {
	idx := strings.IndexByte(email, '@')
	if idx <= 0 {
		return email
	}
	local := email[:idx]
	domain := email[idx:]
	if len(local) <= 1 {
		return local + "***" + domain
	}
	return string(local[0]) + "***" + domain
}

// ── Activation HTML page ──────────────────────────────────────────────────────

// ServeActivationPage renders the email-activation result as an HTML page.
// Called by GET /v1/auth/cli/login/activate after Activate() completes.
func ServeActivationPage(w http.ResponseWriter, result *ActivateResult) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if !result.Success {
		w.WriteHeader(http.StatusBadRequest)
	}
	_ = activationTmpl.Execute(w, result)
}

// ── Web login page ────────────────────────────────────────────────────────────

// ServeLoginPage renders the browser-side email-entry UI for aikey login.
// Called by GET /auth/cli/login?s={session_id}&d={device_code}
func ServeLoginPage(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = loginPageTmpl.Execute(w, nil)
}

var loginPageTmpl = template.Must(template.New("login-page").Parse(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AiKey Login</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0f0f11;--card:#27272a;--border:#3f3f46;--fg:#f4f4f5;
  --muted:#a1a1aa;--primary:#facc15;--primary-fg:#18181b;
  --font:'JetBrains Mono','SF Mono',monospace;
  --sans:Inter,system-ui,sans-serif;
}
body{
  font-family:var(--sans);background:var(--bg);color:var(--fg);
  min-height:100vh;display:flex;align-items:center;justify-content:center;
  padding:1rem;-webkit-font-smoothing:antialiased;
  background-image:radial-gradient(circle at 50% 0%,rgba(250,204,21,.05) 0%,transparent 40%);
}
.card{
  background:var(--card);border:1px solid var(--border);border-radius:8px;
  width:100%;max-width:480px;position:relative;overflow:hidden;
  box-shadow:0 20px 40px -10px rgba(0,0,0,.8),0 0 30px rgba(250,204,21,.03);
}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;
  background:linear-gradient(90deg,transparent,var(--primary),transparent);opacity:.6}
.header{padding:2rem 2rem 1.5rem;text-align:center;border-bottom:1px solid rgba(255,255,255,.05);
  background:rgba(255,255,255,.01)}
.logo{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;
  border-radius:6px;border:1px solid rgba(250,204,21,.3);background:rgba(250,204,21,.1);
  box-shadow:0 0 15px rgba(250,204,21,.15);margin-bottom:.75rem}
.logo svg{width:20px;height:20px;color:var(--primary)}
.title{font-family:var(--font);font-size:1.25rem;font-weight:700;letter-spacing:.2em}
.title span{color:var(--primary)}
.subtitle{font-size:.65rem;font-family:var(--font);color:var(--muted);letter-spacing:.15em;
  text-transform:uppercase;margin-top:.5rem}
.content{padding:2rem}
.desc{font-size:.875rem;color:var(--muted);text-align:center;margin-bottom:1.5rem;font-family:var(--font);line-height:1.6}
label{display:block;font-size:.65rem;font-family:var(--font);font-weight:700;color:var(--muted);
  letter-spacing:.1em;text-transform:uppercase;margin-bottom:.5rem}
.input-wrap{position:relative;margin-bottom:1.5rem}
.input-wrap svg{position:absolute;left:1rem;top:50%;transform:translateY(-50%);width:16px;height:16px;color:var(--muted)}
input[type=email]{
  width:100%;height:48px;padding:0 1rem 0 2.75rem;
  background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.1);border-radius:6px;
  color:var(--fg);font-size:.875rem;font-family:var(--font);outline:none;
  transition:border-color .2s,box-shadow .2s;
}
input[type=email]:focus{border-color:var(--primary);box-shadow:0 0 15px rgba(250,204,21,.15);background:rgba(0,0,0,.5)}
input[type=email]::placeholder{color:rgba(161,161,170,.5)}
.btn-primary{
  width:100%;height:48px;border:1px solid rgba(250,204,21,.5);border-radius:6px;
  background:var(--primary);color:var(--primary-fg);font-family:var(--font);font-weight:700;
  font-size:.8rem;letter-spacing:.15em;text-transform:uppercase;cursor:pointer;
  display:flex;align-items:center;justify-content:center;gap:.5rem;
  box-shadow:0 0 15px rgba(250,204,21,.15);transition:all .2s;
}
.btn-primary:hover:not(:disabled){background:#fde047;box-shadow:0 0 25px rgba(250,204,21,.3);transform:translateY(-1px)}
.btn-primary:disabled{opacity:.5;cursor:not-allowed;transform:none}
.btn-outline{
  width:100%;height:44px;border:1px solid var(--border);border-radius:6px;
  background:transparent;color:var(--fg);font-family:var(--font);font-size:.7rem;
  letter-spacing:.1em;text-transform:uppercase;cursor:pointer;transition:all .2s;
}
.btn-outline:hover{background:rgba(255,255,255,.05);border-color:var(--muted)}
.err-msg{color:#f87171;font-size:.8rem;font-family:var(--font);margin-bottom:1rem;display:none}
.hint{font-size:.75rem;font-family:var(--font);color:var(--muted);margin-top:1rem;text-align:center;line-height:1.6}
/* Step 2 */
.check-icon{width:64px;height:64px;border-radius:50%;border:1px solid rgba(250,204,21,.3);
  background:rgba(250,204,21,.1);display:flex;align-items:center;justify-content:center;
  margin:0 auto 1.5rem;box-shadow:0 0 20px rgba(250,204,21,.2)}
.check-icon svg{width:32px;height:32px;color:var(--primary)}
.success-title{font-size:1.1rem;font-family:var(--font);font-weight:700;text-align:center;margin-bottom:.5rem}
.success-email{color:var(--primary);font-family:var(--font)}
.tips{padding:1rem;border-radius:6px;border:1px solid rgba(255,255,255,.1);background:rgba(0,0,0,.2);
  font-size:.75rem;font-family:var(--font);color:var(--muted);margin:1.5rem 0;text-align:left;line-height:1.7}
.tips ul{padding-left:1.25rem;margin:0}
.tips li{margin-bottom:.25rem}
.link-btn{font-size:.75rem;font-family:var(--font);color:var(--muted);background:none;border:none;
  cursor:pointer;text-decoration:underline;text-underline-offset:4px;margin-top:.75rem;display:block;width:100%;text-align:center}
.link-btn:hover{color:var(--fg)}
/* Error */
.err-icon{color:#f87171}
.err-title{font-size:1.1rem;font-family:var(--font);font-weight:700;text-align:center;margin-bottom:.5rem;color:#f87171}
/* Footer */
.footer{padding:.75rem 2rem;background:rgba(0,0,0,.3);border-top:1px solid var(--border);
  display:flex;justify-content:space-between;align-items:center}
.footer span,.footer a{font-size:.6rem;font-family:var(--font);color:var(--muted);letter-spacing:.15em;text-transform:uppercase;text-decoration:none}
.footer a{color:var(--primary);display:inline-flex;align-items:center;gap:4px}
.footer a:hover{opacity:.8}
</style>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
</head>
<body>

<div class="card">
  <!-- Header -->
  <div class="header">
    <div class="logo">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"/></svg>
    </div>
    <h1 class="title">AIKEY <span>USER</span></h1>
    <p class="subtitle">Member Workspace Access</p>
  </div>

  <div class="content">
    <!-- Step 1: Email input -->
    <div id="form-view">
      <p class="desc">Enter your email to receive a magic link for accessing your allocated virtual keys.</p>
      <form id="login-form">
        <label for="email-input">Corporate Email</label>
        <div class="input-wrap">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"/></svg>
          <input type="email" id="email-input" placeholder="member@acme.corp" required autofocus>
        </div>
        <p id="err-msg" class="err-msg"></p>
        <button type="submit" class="btn-primary" id="submit-btn">
          <span>Send Magic Link</span>
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>
        </button>
      </form>
      <p class="hint">Keep this tab open &mdash; your terminal is waiting for you to complete login.</p>
    </div>

    <!-- Step 2: Email sent -->
    <div id="success-view" style="display:none">
      <div class="check-icon">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0l-9.75 6-9.75-6"/></svg>
      </div>
      <h2 class="success-title">Check your inbox</h2>
      <p style="text-align:center;font-size:.875rem;color:var(--muted);font-family:var(--font);margin-bottom:0">
        We sent a magic link to<br><span class="success-email" id="masked-email"></span>
      </p>
      <div class="tips">
        <ul>
          <li>Click the link in the email to sign in automatically.</li>
          <li>The link expires in 15 minutes.</li>
          <li>If you don&#39;t see it, check your spam folder.</li>
        </ul>
      </div>
      <p id="resend-err" class="err-msg" style="text-align:center"></p>
      <button id="resend-btn" class="btn-outline" type="button" style="margin-bottom:.5rem">Resend email</button>
      <button id="change-email-btn" class="link-btn" type="button">Use a different email</button>
    </div>

    <!-- Error view -->
    <div id="error-view" style="display:none">
      <div class="check-icon" style="border-color:rgba(248,113,113,.3);background:rgba(248,113,113,.1);box-shadow:0 0 20px rgba(248,113,113,.2)">
        <svg class="err-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5" width="32" height="32"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/></svg>
      </div>
      <h2 class="err-title">Session Error</h2>
      <p id="err-detail" style="text-align:center;font-size:.875rem;color:var(--muted);font-family:var(--font)">An unexpected error occurred.</p>
      <p class="hint">Please run <code style="background:rgba(255,255,255,.1);padding:2px 6px;border-radius:4px;font-family:var(--font);font-size:.8em">aikey login</code> in your terminal to start a new session.</p>
    </div>
  </div>

  <!-- Footer -->
  <div class="footer">
    <span>AiKey User Access</span>
    <a href="/user/cli-guide" target="_blank" rel="noopener noreferrer">
      <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z"/></svg>
      CLI Guide
    </a>
  </div>
</div>
<script>
(function(){
  var params=new URLSearchParams(location.search);
  var s=params.get('s'),d=params.get('d');
  if(!s||!d){
    show('error-view');
    document.getElementById('err-detail').textContent='Missing session parameters. Please run aikey login again.';
    return;
  }
  // Auto-fill email from Base64URL-encoded query param (set by aikey login --email)
  var emailParam=params.get('email');
  if(emailParam){
    try{
      var b64=emailParam.replace(/-/g,'+').replace(/_/g,'/');
      while(b64.length%4)b64+='=';
      var decoded=atob(b64);
      if(decoded){
        document.getElementById('email-input').value=decoded;
      }
    }catch(e){}
  }
  // Read referrer_id from localStorage (set by invite link, 30-day TTL).
  // Side-path: errors silently ignored — never blocks login.
  var referrerId='';
  try{
    var refRaw=localStorage.getItem('aikey-referrer');
    if(refRaw){
      var ref=JSON.parse(refRaw);
      if(ref.id&&ref.expires>Date.now()){referrerId=ref.id;}
      else{localStorage.removeItem('aikey-referrer');}
    }
  }catch(e){}
  // Remember the last email we successfully submitted so resend + change-email
  // flows don't have to ask the user again.
  var lastEmail='';
  var sendIconHTML='<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>';
  var resendBtn=document.getElementById('resend-btn');
  var resendErr=document.getElementById('resend-err');
  var changeEmailBtn=document.getElementById('change-email-btn');
  var submitBtn=document.getElementById('submit-btn');
  var resendCooldownTimer=null;
  var resendDefaultLabel='Resend email';

  function startResendCooldown(secs){
    if(resendCooldownTimer){clearInterval(resendCooldownTimer);}
    resendBtn.disabled=true;
    var remaining=secs;
    function tick(){
      if(remaining<=0){
        clearInterval(resendCooldownTimer);
        resendCooldownTimer=null;
        resendBtn.disabled=false;
        resendBtn.textContent=resendDefaultLabel;
        return;
      }
      resendBtn.textContent='Resend in '+remaining+'s';
      remaining--;
    }
    tick();
    resendCooldownTimer=setInterval(tick,1000);
  }

  // Parse error body. Returns {code, message, retryAfterSeconds}. Falls back
  // to {message: raw text} when the server did not send JSON.
  // Note: DomainError.ResponseBody() flattens Meta into the top-level object,
  // so retry_after_seconds is at j.retry_after_seconds (not j.meta.*).
  function parseErr(r){
    return r.json().then(function(j){
      return {
        code: j.error || '',
        message: j.message || ('Error '+r.status),
        retryAfterSeconds: j.retry_after_seconds || 0,
        status: r.status,
      };
    }, function(){
      return {code:'', message:'Error '+r.status, retryAfterSeconds:0, status:r.status};
    });
  }

  function sendBegin(email, opts){
    opts = opts || {};
    var payload={session_id:s,device_code:d,email:email};
    if(referrerId){payload.referrer_id=referrerId;}
    return fetch('/v1/auth/cli/login/begin',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    }).then(function(r){
      if(!r.ok){return parseErr(r).then(function(e){throw e;});}
      return r.json();
    });
  }

  // Step 1 — first send from the form view.
  document.getElementById('login-form').addEventListener('submit',function(e){
    e.preventDefault();
    var email=document.getElementById('email-input').value.trim();
    var errEl=document.getElementById('err-msg');
    errEl.style.display='none';
    submitBtn.disabled=true;
    submitBtn.innerHTML='Sending\u2026';

    sendBegin(email).then(function(data){
      lastEmail=email;
      document.getElementById('masked-email').textContent=data.masked_email;
      show('success-view');
      // After a successful send we're in the cooldown window too.
      startResendCooldown(30);
      submitBtn.disabled=false;
      submitBtn.innerHTML='<span>Send Magic Link</span>'+sendIconHTML;
    }).catch(function(err){
      // If the session is already past pending_email_entry (e.g. browser
      // reload of an old tab), fall through to the success view so the user
      // can use Resend / Change-email instead of hitting a dead end.
      if(err.code==='BIZ_LOGIN_SESSION_TERMINATED'){
        show('error-view');
        document.getElementById('err-detail').textContent=err.message;
        return;
      }
      errEl.textContent=err.message;
      errEl.style.display='block';
      submitBtn.disabled=false;
      submitBtn.innerHTML='<span>Send Magic Link</span>'+sendIconHTML;
    });
  });

  // Step 2 — Resend button on the success view. Same email, rotated token.
  resendBtn.addEventListener('click',function(){
    if(!lastEmail)return;
    resendErr.style.display='none';
    resendBtn.disabled=true;
    resendBtn.textContent='Sending\u2026';
    sendBegin(lastEmail).then(function(data){
      document.getElementById('masked-email').textContent=data.masked_email;
      startResendCooldown(30);
    }).catch(function(err){
      if(err.code==='BIZ_LOGIN_RESEND_COOLDOWN' && err.retryAfterSeconds){
        startResendCooldown(err.retryAfterSeconds);
        return; // don't show red error — the countdown is the feedback
      }
      if(err.code==='BIZ_LOGIN_SESSION_TERMINATED' || err.code==='BIZ_LOGIN_SESSION_EXPIRED'){
        show('error-view');
        document.getElementById('err-detail').textContent=err.message;
        return;
      }
      resendBtn.disabled=false;
      resendBtn.textContent=resendDefaultLabel;
      resendErr.textContent=err.message;
      resendErr.style.display='block';
    });
  });

  // Step 2 — Use a different email. Goes back to the form pre-filled with the
  // current email so the user can edit rather than retype.
  changeEmailBtn.addEventListener('click',function(){
    document.getElementById('email-input').value=lastEmail;
    submitBtn.disabled=false;
    submitBtn.innerHTML='<span>Send Magic Link</span>'+sendIconHTML;
    show('form-view');
  });

  function show(id){
    ['form-view','success-view','error-view'].forEach(function(v){
      document.getElementById(v).style.display=(v===id?'block':'none');
    });
  }
})();
</script>
</body>
</html>`))

// ── Activation HTML page ──────────────────────────────────────────────────────

var activationTmpl = template.Must(template.New("activate").Parse(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AiKey Login</title>
<style>
body{font-family:system-ui,sans-serif;max-width:500px;margin:80px auto;padding:0 24px;color:#111}
h1{font-size:1.4rem;margin-bottom:8px}
p{line-height:1.5;color:#374151}
.token-wrap{position:relative;margin:12px 0}
.token{background:#f4f4f5;border:1px solid #e4e4e7;padding:10px 48px 10px 14px;border-radius:6px;
       font-family:monospace;font-size:.9rem;word-break:break-all;
       user-select:all;cursor:text;line-height:1.5}
.copy-btn{position:absolute;top:50%;right:8px;transform:translateY(-50%);
          background:#fff;border:1px solid #d1d5db;border-radius:4px;
          padding:3px 8px;font-size:.78rem;cursor:pointer;color:#374151;
          transition:background .15s,color .15s}
.copy-btn:hover{background:#f4f4f5}
.copy-btn.copied{background:#16a34a;border-color:#16a34a;color:#fff}
.hint{color:#6b7280;font-size:.85rem}
.ok{color:#16a34a}
.err{color:#dc2626}
hr{margin:24px 0;border:none;border-top:1px solid #e5e7eb}
code{background:#f4f4f5;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:.9em}
</style>
</head>
<body>
{{if .Success}}
<h1 class="ok">&#10003; Email Verified</h1>
<p>{{.Message}}</p>
{{if .LoginToken}}
<hr>
<p class="hint">If your terminal did not complete login automatically, copy the one-time token below and paste it when prompted:</p>
<div class="token-wrap">
  <div class="token" id="token-text">{{.LoginToken}}</div>
  <button class="copy-btn" id="copy-btn" onclick="copyToken()">Copy</button>
</div>
<p class="hint">This token is valid for a single use and will expire shortly.</p>
<script>
function copyToken(){
  var text=document.getElementById('token-text').textContent.trim();
  var btn=document.getElementById('copy-btn');
  navigator.clipboard.writeText(text).then(function(){
    btn.textContent='Copied!';
    btn.classList.add('copied');
    setTimeout(function(){btn.textContent='Copy';btn.classList.remove('copied');},2000);
  }).catch(function(){
    var sel=window.getSelection();
    var range=document.createRange();
    range.selectNodeContents(document.getElementById('token-text'));
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('copy');
    sel.removeAllRanges();
    btn.textContent='Copied!';
    btn.classList.add('copied');
    setTimeout(function(){btn.textContent='Copy';btn.classList.remove('copied');},2000);
  });
}
</script>
{{end}}
<hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb">
<p style="font-size:.9rem;color:#374151">Redirecting to your console in <strong id="countdown">5</strong>s…</p>
<a href="{{.RedirectURL}}" style="display:inline-block;margin-top:8px;padding:8px 18px;background:#111;color:#fff;border-radius:6px;text-decoration:none;font-size:.9rem">Go to Console &rarr;</a>
<script>
(function(){
  var n=5;
  var el=document.getElementById('countdown');
  var redirect='{{.RedirectURL}}';
  var t=setInterval(function(){
    n--;
    if(el)el.textContent=n;
    if(n<=0){clearInterval(t);location.href=redirect;}
  },1000);
})();
</script>
{{else}}
<h1 class="err">&#10007; Activation Failed</h1>
<p>{{.Message}}</p>
<p class="hint">Please run <code>aikey login</code> in your terminal to start a new session.</p>
{{end}}
</body>
</html>`))
