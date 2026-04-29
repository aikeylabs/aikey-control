package identity

import (
	"context"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/AiKeyLabs/aikey-control-service/pkg/shared"
)

// ── In-memory mocks ───────────────────────────────────────────────────────────

// memAccountRepo implements Repository using an in-memory map.
type memAccountRepo struct {
	accounts      map[string]*GlobalAccount // keyed by account_id
	byEmail       map[string]*GlobalAccount // keyed by email
	lastLoginCalls []string                 // account IDs that received UpdateLastLogin
}

func newMemAccountRepo() *memAccountRepo {
	return &memAccountRepo{
		accounts: make(map[string]*GlobalAccount),
		byEmail:  make(map[string]*GlobalAccount),
	}
}

func (r *memAccountRepo) Create(_ context.Context, a *GlobalAccount) error {
	a.CreatedAt = time.Now().UTC()
	r.accounts[a.AccountID] = a
	r.byEmail[a.Email] = a
	return nil
}

func (r *memAccountRepo) FindByID(_ context.Context, id string) (*GlobalAccount, error) {
	return r.accounts[id], nil
}

func (r *memAccountRepo) FindByEmail(_ context.Context, email string) (*GlobalAccount, error) {
	return r.byEmail[email], nil
}

func (r *memAccountRepo) UpdateLastLogin(_ context.Context, id string) error {
	r.lastLoginCalls = append(r.lastLoginCalls, id)
	return nil
}

// memSessionRepo implements LoginSessionRepository using an in-memory map.
type memSessionRepo struct {
	sessions      map[string]*LoginSession // keyed by session_id
	byActivation  map[string]*LoginSession // keyed by activation_token
	byDeviceCode  map[string]*LoginSession // keyed by device_code
}

func newMemSessionRepo() *memSessionRepo {
	return &memSessionRepo{
		sessions:     make(map[string]*LoginSession),
		byActivation: make(map[string]*LoginSession),
		byDeviceCode: make(map[string]*LoginSession),
	}
}

func (r *memSessionRepo) Create(_ context.Context, s *LoginSession) error {
	s.CreatedAt = time.Now().UTC()
	r.sessions[s.LoginSessionID] = s
	r.byActivation[s.ActivationToken] = s
	r.byDeviceCode[s.DeviceCode] = s
	return nil
}

func (r *memSessionRepo) FindByID(_ context.Context, id string) (*LoginSession, error) {
	return r.sessions[id], nil
}

func (r *memSessionRepo) FindByDeviceCode(_ context.Context, code string) (*LoginSession, error) {
	return r.byDeviceCode[code], nil
}

func (r *memSessionRepo) FindByActivationToken(_ context.Context, token string) (*LoginSession, error) {
	return r.byActivation[token], nil
}

func (r *memSessionRepo) Approve(_ context.Context, sessionID, loginToken, accountID string) error {
	s := r.sessions[sessionID]
	if s == nil {
		return nil
	}
	s.Status = LoginSessionStatusApprovedPendingClaim
	s.LoginToken = &loginToken
	s.AccountID = &accountID
	return nil
}

func (r *memSessionRepo) IssueToken(_ context.Context, sessionID string) error {
	if s := r.sessions[sessionID]; s != nil {
		s.Status = LoginSessionStatusTokenIssued
	}
	return nil
}

func (r *memSessionRepo) MarkLoginTokenUsed(_ context.Context, sessionID string) error {
	if s := r.sessions[sessionID]; s != nil {
		s.LoginTokenUsed = true
	}
	return nil
}

func (r *memSessionRepo) SetEmail(_ context.Context, sessionID, deviceCode, email, activationToken string) error {
	s := r.sessions[sessionID]
	if s == nil || s.DeviceCode != deviceCode || s.Status != LoginSessionStatusPendingEmailEntry {
		return ErrLoginSessionWrongState
	}
	delete(r.byActivation, s.ActivationToken)
	s.Email = email
	s.ActivationToken = activationToken
	s.Status = LoginSessionStatusPendingEmailActivation
	now := time.Now().UTC()
	s.LastEmailSentAt = &now
	r.byActivation[activationToken] = s
	return nil
}

func (r *memSessionRepo) ResendEmail(_ context.Context, sessionID, deviceCode, email, activationToken string) error {
	s := r.sessions[sessionID]
	if s == nil || s.DeviceCode != deviceCode || s.Status != LoginSessionStatusPendingEmailActivation {
		return ErrLoginSessionWrongState
	}
	delete(r.byActivation, s.ActivationToken)
	s.Email = email
	s.ActivationToken = activationToken
	now := time.Now().UTC()
	s.LastEmailSentAt = &now
	r.byActivation[activationToken] = s
	return nil
}

func (r *memSessionRepo) Deny(_ context.Context, sessionID string) error {
	if s := r.sessions[sessionID]; s != nil {
		s.Status = LoginSessionStatusDenied
	}
	return nil
}

// memRefreshRepo implements RefreshTokenRepository using an in-memory map.
type memRefreshRepo struct {
	tokens map[string]*RefreshToken // keyed by token_hash
	byID   map[string]*RefreshToken // keyed by token_id
}

func newMemRefreshRepo() *memRefreshRepo {
	return &memRefreshRepo{
		tokens: make(map[string]*RefreshToken),
		byID:   make(map[string]*RefreshToken),
	}
}

func (r *memRefreshRepo) Create(_ context.Context, rt *RefreshToken) error {
	rt.CreatedAt = time.Now().UTC()
	r.tokens[rt.TokenHash] = rt
	r.byID[rt.TokenID] = rt
	return nil
}

func (r *memRefreshRepo) FindByHash(_ context.Context, hash string) (*RefreshToken, error) {
	return r.tokens[hash], nil
}

func (r *memRefreshRepo) Revoke(_ context.Context, tokenID string) error {
	if rt := r.byID[tokenID]; rt != nil {
		rt.Revoked = true
	}
	return nil
}

// memSeatReconciler implements SeatReconciler and records which emails were reconciled.
type memSeatReconciler struct {
	// seats maps invited_email → account_id that claimed it, or "" if pending
	seats      map[string]string
	reconciled []string // emails that were reconciled in this test run
}

func newMemSeatReconciler(pendingEmails ...string) *memSeatReconciler {
	r := &memSeatReconciler{seats: make(map[string]string)}
	for _, e := range pendingEmails {
		r.seats[e] = "" // pending claim
	}
	return r
}

func (r *memSeatReconciler) ReconcileByEmail(_ context.Context, email, accountID string) (int, error) {
	if _, ok := r.seats[email]; ok && r.seats[email] == "" {
		r.seats[email] = accountID
		r.reconciled = append(r.reconciled, email)
		return 1, nil
	}
	return 0, nil
}

// capturingMailer captures activation URLs instead of sending email.
type capturingMailer struct {
	lastURL     string
	lastEmail   string
	lastOS      string
	lastSentAt  time.Time
}

func (m *capturingMailer) SendActivationEmail(_ context.Context, msg ActivationMessage) error {
	m.lastEmail = msg.ToEmail
	m.lastURL = msg.ActivationURL
	m.lastOS = msg.OSPlatform
	m.lastSentAt = msg.SentAt
	return nil
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
}

func testTokenSvc() *shared.TokenService {
	return shared.NewTokenService([]byte(strings.Repeat("t", 32)))
}

type testFixture struct {
	accountRepo  *memAccountRepo
	sessionRepo  *memSessionRepo
	refreshRepo  *memRefreshRepo
	reconciler   *memSeatReconciler
	mailer       *capturingMailer
	svc          *CLILoginService
}

// newFixture builds a CLILoginService wired to all in-memory repos.
// Pass pendingEmails to pre-seed pending org seats.
func newFixture(pendingEmails ...string) *testFixture {
	f := &testFixture{
		accountRepo: newMemAccountRepo(),
		sessionRepo: newMemSessionRepo(),
		refreshRepo: newMemRefreshRepo(),
		reconciler:  newMemSeatReconciler(pendingEmails...),
		mailer:      &capturingMailer{},
	}
	f.svc = NewCLILoginService(
		f.accountRepo,
		f.sessionRepo,
		f.refreshRepo,
		f.reconciler,
		testTokenSvc(),
		f.mailer,
		"http://localhost:8080",
		"http://localhost:3000",
		testLogger(),
	)
	return f
}

// activateURL extracts the activation token from a captured activation URL.
func activationTokenFromURL(url string) string {
	const prefix = "?token="
	idx := strings.LastIndex(url, prefix)
	if idx < 0 {
		return ""
	}
	return url[idx+len(prefix):]
}

// ── Tests: Start ─────────────────────────────────────────────────────────────

func TestStart_ReturnsSessionAndSendsEmail(t *testing.T) {
	f := newFixture()
	ctx := context.Background()

	result, err := f.svc.Start(ctx, StartParams{
		Email:         "alice@example.com",
		ClientName:    "aikey-cli",
		ClientVersion: "0.4.0",
		OSPlatform:    "darwin",
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}

	if result.LoginSessionID == "" {
		t.Error("LoginSessionID must not be empty")
	}
	if result.DeviceCode == "" {
		t.Error("DeviceCode must not be empty")
	}
	if result.MaskedEmail == "" || result.MaskedEmail == "alice@example.com" {
		t.Errorf("MaskedEmail should be masked, got %q", result.MaskedEmail)
	}
	if result.PollIntervalSeconds <= 0 {
		t.Error("PollIntervalSeconds must be positive")
	}
	if result.ExpiresInSeconds <= 0 {
		t.Error("ExpiresInSeconds must be positive")
	}

	// Session persisted.
	sess, _ := f.sessionRepo.FindByID(ctx, result.LoginSessionID)
	if sess == nil {
		t.Fatal("session not persisted")
	}
	if sess.Status != LoginSessionStatusPendingEmailActivation {
		t.Errorf("status = %q, want pending_email_activation", sess.Status)
	}
	if sess.Email != "alice@example.com" {
		t.Errorf("email = %q", sess.Email)
	}

	// Activation email captured.
	if f.mailer.lastEmail != "alice@example.com" {
		t.Errorf("email sent to %q, want alice@example.com", f.mailer.lastEmail)
	}
	if !strings.Contains(f.mailer.lastURL, "/v1/auth/cli/login/activate?token=") {
		t.Errorf("activation URL looks wrong: %q", f.mailer.lastURL)
	}
}

func TestStart_NormalizesEmail(t *testing.T) {
	f := newFixture()
	ctx := context.Background()

	_, err := f.svc.Start(ctx, StartParams{Email: "  ALICE@EXAMPLE.COM  "})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}

	if f.mailer.lastEmail != "alice@example.com" {
		t.Errorf("email not normalised, got %q", f.mailer.lastEmail)
	}
}

func TestStart_EmptyEmailRejected(t *testing.T) {
	f := newFixture()
	_, err := f.svc.Start(context.Background(), StartParams{Email: ""})
	if err == nil {
		t.Fatal("expected error for empty email")
	}
}

// ── Tests: Begin (resend + change-email) ─────────────────────────────────────
//
// Ref: workflow/CI/bugfix/2026-04-21-login-begin-resend-and-change-email.md
//
// Before the fix, a second Begin on the same session returned the misleading
// "login session not found" (BIZ_LOGIN_SESSION_NOT_FOUND). The resend /
// change-email flow is now explicit, enforces a 30-second per-session cooldown
// (LoginResendCooldown), and rotates activation_token so old email links die.

// initSession runs just the Init half of the flow, leaving the session in
// pending_email_entry so the test can exercise Begin directly.
func initSession(t *testing.T, f *testFixture) (sessionID, deviceCode string) {
	t.Helper()
	result, err := f.svc.Init(context.Background(), "aikey-cli", "0.4.0", "darwin")
	if err != nil {
		t.Fatalf("Init: %v", err)
	}
	return result.LoginSessionID, result.DeviceCode
}

// shiftLastEmailSentBack moves last_email_sent_at backwards in time so the
// cooldown window has "already elapsed" from the service layer's perspective.
// Relies on memSessionRepo holding live pointers.
func shiftLastEmailSentBack(t *testing.T, repo *memSessionRepo, sessionID string, by time.Duration) {
	t.Helper()
	s := repo.sessions[sessionID]
	if s == nil || s.LastEmailSentAt == nil {
		t.Fatalf("session %q has no last_email_sent_at to shift", sessionID)
	}
	shifted := s.LastEmailSentAt.Add(-by)
	s.LastEmailSentAt = &shifted
}

func TestBegin_FirstSendSucceedsAndMoves_ToPendingActivation(t *testing.T) {
	f := newFixture()
	sessionID, deviceCode := initSession(t, f)

	_, err := f.svc.Begin(context.Background(), BeginParams{
		SessionID: sessionID, DeviceCode: deviceCode, Email: "alice@example.com",
	})
	if err != nil {
		t.Fatalf("Begin first send: %v", err)
	}

	s := f.sessionRepo.sessions[sessionID]
	if s.Status != LoginSessionStatusPendingEmailActivation {
		t.Fatalf("status = %q, want pending_email_activation", s.Status)
	}
	if s.LastEmailSentAt == nil {
		t.Fatal("LastEmailSentAt must be stamped after first Begin")
	}
	if f.mailer.lastEmail != "alice@example.com" {
		t.Fatalf("mailer.lastTo = %q, want alice@example.com", f.mailer.lastEmail)
	}
}

func TestBegin_ResendBeforeCooldown_ReturnsCooldownWithRetryAfter(t *testing.T) {
	f := newFixture()
	sessionID, deviceCode := initSession(t, f)
	ctx := context.Background()

	if _, err := f.svc.Begin(ctx, BeginParams{SessionID: sessionID, DeviceCode: deviceCode, Email: "alice@example.com"}); err != nil {
		t.Fatalf("first Begin: %v", err)
	}

	_, err := f.svc.Begin(ctx, BeginParams{SessionID: sessionID, DeviceCode: deviceCode, Email: "alice@example.com"})
	if err == nil {
		t.Fatal("expected cooldown error on back-to-back Begin, got nil")
	}
	de, ok := err.(*shared.DomainError)
	if !ok {
		t.Fatalf("expected *shared.DomainError, got %T: %v", err, err)
	}
	if de.Code != shared.CodeBizLoginResendCooldown {
		t.Fatalf("code = %q, want %q", de.Code, shared.CodeBizLoginResendCooldown)
	}
	if _, has := de.Meta["retry_after_seconds"]; !has {
		t.Error("cooldown error must carry retry_after_seconds in Meta for frontend countdown")
	}
}

func TestBegin_ResendAfterCooldown_SendsNewEmailAndRotatesToken(t *testing.T) {
	f := newFixture()
	sessionID, deviceCode := initSession(t, f)
	ctx := context.Background()

	if _, err := f.svc.Begin(ctx, BeginParams{SessionID: sessionID, DeviceCode: deviceCode, Email: "alice@example.com"}); err != nil {
		t.Fatalf("first Begin: %v", err)
	}
	tok1 := f.sessionRepo.sessions[sessionID].ActivationToken

	// Simulate the cooldown elapsing.
	shiftLastEmailSentBack(t, f.sessionRepo, sessionID, LoginResendCooldown+time.Second)

	if _, err := f.svc.Begin(ctx, BeginParams{SessionID: sessionID, DeviceCode: deviceCode, Email: "alice@example.com"}); err != nil {
		t.Fatalf("resend Begin: %v", err)
	}

	s := f.sessionRepo.sessions[sessionID]
	if s.ActivationToken == tok1 {
		t.Error("activation_token must rotate on resend — old email links must stop working")
	}
	if s.Email != "alice@example.com" {
		t.Errorf("email changed unexpectedly: %q", s.Email)
	}
	// The old token must no longer resolve via FindByActivationToken (invariant
	// that keeps the old email's magic link dead).
	stale, _ := f.sessionRepo.FindByActivationToken(ctx, tok1)
	if stale != nil {
		t.Error("old activation_token still resolves — leftover magic link stays live")
	}
}

func TestBegin_ChangeEmailAfterCooldown_UpdatesRecipientAndRotatesToken(t *testing.T) {
	f := newFixture()
	sessionID, deviceCode := initSession(t, f)
	ctx := context.Background()

	if _, err := f.svc.Begin(ctx, BeginParams{SessionID: sessionID, DeviceCode: deviceCode, Email: "typo@example.com"}); err != nil {
		t.Fatalf("first Begin: %v", err)
	}
	tok1 := f.sessionRepo.sessions[sessionID].ActivationToken

	shiftLastEmailSentBack(t, f.sessionRepo, sessionID, LoginResendCooldown+time.Second)

	if _, err := f.svc.Begin(ctx, BeginParams{SessionID: sessionID, DeviceCode: deviceCode, Email: "correct@example.com"}); err != nil {
		t.Fatalf("change-email Begin: %v", err)
	}

	s := f.sessionRepo.sessions[sessionID]
	if s.Email != "correct@example.com" {
		t.Errorf("email must update to the new address, got %q", s.Email)
	}
	if s.ActivationToken == tok1 {
		t.Error("activation_token must rotate even when only the email changed")
	}
	if f.mailer.lastEmail != "correct@example.com" {
		t.Errorf("mailer recipient not updated: %q", f.mailer.lastEmail)
	}
}

func TestBegin_TerminalState_ReturnsTerminatedNotNotFound(t *testing.T) {
	f := newFixture()
	sessionID, deviceCode := initSession(t, f)
	ctx := context.Background()

	if _, err := f.svc.Begin(ctx, BeginParams{SessionID: sessionID, DeviceCode: deviceCode, Email: "alice@example.com"}); err != nil {
		t.Fatalf("first Begin: %v", err)
	}
	// Force-transition to a terminal state (simulates the user having already
	// activated via email on another tab).
	f.sessionRepo.sessions[sessionID].Status = LoginSessionStatusTokenIssued

	_, err := f.svc.Begin(ctx, BeginParams{SessionID: sessionID, DeviceCode: deviceCode, Email: "alice@example.com"})
	if err == nil {
		t.Fatal("expected error when Begin called on terminal session")
	}
	de, ok := err.(*shared.DomainError)
	if !ok {
		t.Fatalf("expected *shared.DomainError, got %T: %v", err, err)
	}
	if de.Code != shared.CodeBizLoginSessionTerminated {
		t.Fatalf("code = %q, want %q — the old code BIZ_LOGIN_SESSION_NOT_FOUND was misleading",
			de.Code, shared.CodeBizLoginSessionTerminated)
	}
}

func TestBegin_WrongDeviceCode_StillReturnsNotFound(t *testing.T) {
	// device_code mismatch MUST stay BIZ_LOGIN_SESSION_NOT_FOUND — it is a
	// security-critical check preventing session-id-from-URL hijack. Don't
	// accidentally broaden the terminated-state message to cover this case.
	f := newFixture()
	sessionID, _ := initSession(t, f)

	_, err := f.svc.Begin(context.Background(), BeginParams{
		SessionID: sessionID, DeviceCode: "wrong-device-code", Email: "alice@example.com",
	})
	if err == nil {
		t.Fatal("expected error when device_code mismatches")
	}
	de, ok := err.(*shared.DomainError)
	if !ok {
		t.Fatalf("expected *shared.DomainError, got %T: %v", err, err)
	}
	if de.Code != shared.CodeBizLoginSessionNotFound {
		t.Fatalf("code = %q, want %q", de.Code, shared.CodeBizLoginSessionNotFound)
	}
}

// ── Tests: Activate ───────────────────────────────────────────────────────────

// fullStart runs Start and returns (loginSessionID, deviceCode, activationToken).
func fullStart(t *testing.T, f *testFixture, email string) (sessionID, deviceCode, activationToken string) {
	t.Helper()
	result, err := f.svc.Start(context.Background(), StartParams{
		Email:      email,
		ClientName: "aikey-cli",
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	tok := activationTokenFromURL(f.mailer.lastURL)
	if tok == "" {
		t.Fatal("could not extract activation token from email URL")
	}
	return result.LoginSessionID, result.DeviceCode, tok
}

func TestActivate_NewAccount_SeatReconciled(t *testing.T) {
	f := newFixture("bob@example.com") // pre-seeded pending seat
	ctx := context.Background()

	sessionID, _, activationTok := fullStart(t, f, "bob@example.com")

	result, err := f.svc.Activate(ctx, activationTok)
	if err != nil {
		t.Fatalf("Activate: %v", err)
	}
	if !result.Success {
		t.Fatalf("Activate failed: %s", result.Message)
	}
	if result.Email != "bob@example.com" {
		t.Errorf("email = %q", result.Email)
	}
	if result.LoginToken == "" {
		t.Error("LoginToken must be present for copy-paste fallback")
	}

	// Account created.
	acc, _ := f.accountRepo.FindByEmail(ctx, "bob@example.com")
	if acc == nil {
		t.Fatal("account should have been created")
	}
	if acc.AccountStatus != AccountStatusActive {
		t.Errorf("status = %q, want active", acc.AccountStatus)
	}
	if acc.PasswordHash != "" {
		t.Error("OAuth-only accounts must not have a password hash")
	}

	// Seat reconciled.
	if len(f.reconciler.reconciled) != 1 || f.reconciler.reconciled[0] != "bob@example.com" {
		t.Errorf("seat not reconciled; got %v", f.reconciler.reconciled)
	}

	// Session moved to approved_pending_claim.
	sess, _ := f.sessionRepo.FindByID(ctx, sessionID)
	if sess.Status != LoginSessionStatusApprovedPendingClaim {
		t.Errorf("session status = %q, want approved_pending_claim", sess.Status)
	}
	if sess.AccountID == nil || *sess.AccountID != acc.AccountID {
		t.Error("session.AccountID not set to new account")
	}
}

func TestActivate_ExistingAccount_NoNewAccountCreated(t *testing.T) {
	f := newFixture()
	ctx := context.Background()

	// Pre-create account.
	existing := &GlobalAccount{
		AccountID:     "acc-existing",
		Email:         "carol@example.com",
		AccountStatus: AccountStatusActive,
	}
	_ = f.accountRepo.Create(ctx, existing)

	_, _, activationTok := fullStart(t, f, "carol@example.com")

	result, err := f.svc.Activate(ctx, activationTok)
	if err != nil || !result.Success {
		t.Fatalf("Activate: err=%v result=%+v", err, result)
	}

	// Account count must still be 1.
	if len(f.accountRepo.accounts) != 1 {
		t.Errorf("expected 1 account, got %d", len(f.accountRepo.accounts))
	}
}

func TestActivate_InvalidToken_ReturnsGracefulMessage(t *testing.T) {
	f := newFixture()

	result, err := f.svc.Activate(context.Background(), "totally-bogus-token")
	if err != nil {
		t.Fatalf("unexpected hard error: %v", err)
	}
	if result.Success {
		t.Error("should not succeed with bogus token")
	}
	if result.Message == "" {
		t.Error("should return a human-readable message")
	}
}

func TestActivate_ExpiredSession_ReturnsGracefulMessage(t *testing.T) {
	f := newFixture()
	ctx := context.Background()

	_, _, activationTok := fullStart(t, f, "dave@example.com")

	// Force session to expire.
	sess, _ := f.sessionRepo.FindByActivationToken(ctx, activationTok)
	sess.ExpiresAt = time.Now().UTC().Add(-1 * time.Minute)

	result, err := f.svc.Activate(ctx, activationTok)
	if err != nil {
		t.Fatalf("unexpected hard error: %v", err)
	}
	if result.Success {
		t.Error("should not succeed for expired session")
	}
}

func TestActivate_SuspendedAccount_DeniesSession(t *testing.T) {
	f := newFixture()
	ctx := context.Background()

	suspended := &GlobalAccount{
		AccountID:     "acc-suspended",
		Email:         "eve@example.com",
		AccountStatus: AccountStatusSuspended,
	}
	_ = f.accountRepo.Create(ctx, suspended)

	sessionID, _, activationTok := fullStart(t, f, "eve@example.com")

	result, err := f.svc.Activate(ctx, activationTok)
	if err != nil {
		t.Fatalf("unexpected hard error: %v", err)
	}
	if result.Success {
		t.Error("suspended account must not succeed")
	}

	sess, _ := f.sessionRepo.FindByID(ctx, sessionID)
	if sess.Status != LoginSessionStatusDenied {
		t.Errorf("session status = %q, want denied", sess.Status)
	}
}

func TestActivate_Idempotent_SecondClickReturnsSameState(t *testing.T) {
	f := newFixture()
	ctx := context.Background()

	_, _, activationTok := fullStart(t, f, "frank@example.com")

	r1, err := f.svc.Activate(ctx, activationTok)
	if err != nil || !r1.Success {
		t.Fatalf("first Activate: %v / %+v", err, r1)
	}

	r2, err := f.svc.Activate(ctx, activationTok)
	if err != nil || !r2.Success {
		t.Fatalf("second Activate: %v / %+v", err, r2)
	}
	if r2.LoginToken != r1.LoginToken {
		t.Errorf("idempotent: LoginToken changed from %q to %q", r1.LoginToken, r2.LoginToken)
	}
}

// ── Tests: Poll ───────────────────────────────────────────────────────────────

func TestPoll_PendingBeforeActivation(t *testing.T) {
	f := newFixture()
	ctx := context.Background()

	sessionID, deviceCode, _ := fullStart(t, f, "gina@example.com")

	poll, err := f.svc.Poll(ctx, sessionID, deviceCode)
	if err != nil {
		t.Fatalf("Poll: %v", err)
	}
	if poll.Status != PollStatusPending {
		t.Errorf("status = %q, want pending", poll.Status)
	}
	if poll.Token != nil {
		t.Error("Token must be nil while pending")
	}
}

func TestPoll_ApprovedAfterActivation_IssuesTokens(t *testing.T) {
	f := newFixture()
	ctx := context.Background()

	sessionID, deviceCode, activationTok := fullStart(t, f, "hana@example.com")

	if _, err := f.svc.Activate(ctx, activationTok); err != nil {
		t.Fatalf("Activate: %v", err)
	}

	poll, err := f.svc.Poll(ctx, sessionID, deviceCode)
	if err != nil {
		t.Fatalf("Poll: %v", err)
	}
	if poll.Status != PollStatusApproved {
		t.Errorf("status = %q, want approved", poll.Status)
	}
	if poll.Token == nil {
		t.Fatal("Token must not be nil when approved")
	}
	if poll.Token.AccessToken == "" {
		t.Error("AccessToken must not be empty")
	}
	if poll.Token.RefreshToken == "" {
		t.Error("RefreshToken must not be empty")
	}
	if poll.Token.Email != "hana@example.com" {
		t.Errorf("Email = %q", poll.Token.Email)
	}
	if poll.Token.ExpiresIn <= 0 {
		t.Error("ExpiresIn must be positive")
	}

	// access_token must be a valid JWT.
	ts := testTokenSvc()
	claims, err := ts.Verify(poll.Token.AccessToken)
	if err != nil {
		t.Fatalf("access token is not a valid JWT: %v", err)
	}
	if claims.Email != "hana@example.com" {
		t.Errorf("claims.Email = %q", claims.Email)
	}

	// Session moved to token_issued.
	sess, _ := f.sessionRepo.FindByID(ctx, sessionID)
	if sess.Status != LoginSessionStatusTokenIssued {
		t.Errorf("session status = %q, want token_issued", sess.Status)
	}

	// refresh_token stored as hash.
	rtHash := shared.HashToken(poll.Token.RefreshToken)
	rt, _ := f.refreshRepo.FindByHash(ctx, rtHash)
	if rt == nil {
		t.Fatal("refresh token not persisted")
	}
	if rt.Revoked {
		t.Error("refresh token must not be revoked immediately")
	}
}

func TestPoll_WrongDeviceCode_ReturnsError(t *testing.T) {
	f := newFixture()
	ctx := context.Background()

	sessionID, _, _ := fullStart(t, f, "ivan@example.com")

	_, err := f.svc.Poll(ctx, sessionID, "wrong-device-code")
	if err == nil {
		t.Fatal("expected error for wrong device code")
	}
}

func TestPoll_UnknownSession_ReturnsError(t *testing.T) {
	f := newFixture()

	_, err := f.svc.Poll(context.Background(), "nonexistent-session", "any-code")
	if err == nil {
		t.Fatal("expected error for nonexistent session")
	}
}

func TestPoll_ExpiredSession_ReturnsExpiredStatus(t *testing.T) {
	f := newFixture()
	ctx := context.Background()

	sessionID, deviceCode, _ := fullStart(t, f, "julia@example.com")

	// Force expiry.
	sess, _ := f.sessionRepo.FindByID(ctx, sessionID)
	sess.ExpiresAt = time.Now().UTC().Add(-1 * time.Minute)

	poll, err := f.svc.Poll(ctx, sessionID, deviceCode)
	if err != nil {
		t.Fatalf("Poll: %v", err)
	}
	if poll.Status != PollStatusExpired {
		t.Errorf("status = %q, want expired", poll.Status)
	}
}

func TestPoll_SecondPollAfterTokenIssued_ReturnsTokenClaimed(t *testing.T) {
	f := newFixture()
	ctx := context.Background()

	sessionID, deviceCode, activationTok := fullStart(t, f, "kate@example.com")
	if _, err := f.svc.Activate(ctx, activationTok); err != nil {
		t.Fatalf("Activate: %v", err)
	}

	// First poll: issues tokens.
	if _, err := f.svc.Poll(ctx, sessionID, deviceCode); err != nil {
		t.Fatalf("first Poll: %v", err)
	}

	// Second poll: session is now token_issued.
	poll, err := f.svc.Poll(ctx, sessionID, deviceCode)
	if err != nil {
		t.Fatalf("second Poll: %v", err)
	}
	if poll.Status != PollStatusTokenClaimed {
		t.Errorf("status = %q, want token_claimed", poll.Status)
	}
}

// ── Tests: Exchange (copy-paste fallback) ─────────────────────────────────────

func TestExchange_ValidLoginToken_IssuesTokens(t *testing.T) {
	f := newFixture()
	ctx := context.Background()

	sessionID, _, activationTok := fullStart(t, f, "leo@example.com")

	actResult, err := f.svc.Activate(ctx, activationTok)
	if err != nil || !actResult.Success {
		t.Fatalf("Activate: %v / %+v", err, actResult)
	}
	loginToken := actResult.LoginToken

	tokenResult, err := f.svc.Exchange(ctx, sessionID, loginToken)
	if err != nil {
		t.Fatalf("Exchange: %v", err)
	}
	if tokenResult.AccessToken == "" {
		t.Error("AccessToken must not be empty")
	}
	if tokenResult.RefreshToken == "" {
		t.Error("RefreshToken must not be empty")
	}

	// login_token must be marked used.
	sess, _ := f.sessionRepo.FindByID(ctx, sessionID)
	if !sess.LoginTokenUsed {
		t.Error("login_token must be marked used after Exchange")
	}
}

func TestExchange_ReusedLoginToken_Rejected(t *testing.T) {
	f := newFixture()
	ctx := context.Background()

	sessionID, _, activationTok := fullStart(t, f, "mia@example.com")
	actResult, _ := f.svc.Activate(ctx, activationTok)
	loginToken := actResult.LoginToken

	// First exchange succeeds.
	if _, err := f.svc.Exchange(ctx, sessionID, loginToken); err != nil {
		t.Fatalf("first Exchange: %v", err)
	}

	// Second exchange with the same token must fail.
	_, err := f.svc.Exchange(ctx, sessionID, loginToken)
	if err == nil {
		t.Fatal("expected error re-using login_token")
	}
}

func TestExchange_WrongLoginToken_Rejected(t *testing.T) {
	f := newFixture()
	ctx := context.Background()

	sessionID, _, activationTok := fullStart(t, f, "ned@example.com")
	if _, err := f.svc.Activate(ctx, activationTok); err != nil {
		t.Fatalf("Activate: %v", err)
	}

	_, err := f.svc.Exchange(ctx, sessionID, "wrong-token")
	if err == nil {
		t.Fatal("expected error for wrong login_token")
	}
}

func TestExchange_SessionNotYetActivated_Rejected(t *testing.T) {
	f := newFixture()
	ctx := context.Background()

	sessionID, _, _ := fullStart(t, f, "ora@example.com")

	// No Activate call — session still pending.
	_, err := f.svc.Exchange(ctx, sessionID, "any-token")
	if err == nil {
		t.Fatal("expected error for non-activated session")
	}
}

// ── Tests: Refresh ────────────────────────────────────────────────────────────

// fullLogin runs Start → Activate → Poll and returns the token result.
func fullLogin(t *testing.T, f *testFixture, email string) *OAuthTokenResult {
	t.Helper()
	ctx := context.Background()

	sessionID, deviceCode, activationTok := fullStart(t, f, email)
	if _, err := f.svc.Activate(ctx, activationTok); err != nil {
		t.Fatalf("Activate: %v", err)
	}
	poll, err := f.svc.Poll(ctx, sessionID, deviceCode)
	if err != nil || poll.Token == nil {
		t.Fatalf("Poll: err=%v token=%v", err, poll)
	}
	return poll.Token
}

func TestRefresh_ValidToken_IssuesNewAccessToken(t *testing.T) {
	f := newFixture()
	ctx := context.Background()

	tok := fullLogin(t, f, "pat@example.com")

	refreshResult, err := f.svc.Refresh(ctx, tok.RefreshToken)
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	if refreshResult.AccessToken == "" {
		t.Error("new AccessToken must not be empty")
	}
	// Refresh token is returned unchanged (no rotation in current implementation).
	if refreshResult.RefreshToken != tok.RefreshToken {
		t.Errorf("RefreshToken changed unexpectedly")
	}
	// Note: access token byte-equality is not checked because JWTs issued within
	// the same second share identical timestamps and thus produce the same signed string.

	// New access token must be a valid JWT for the right account.
	ts := testTokenSvc()
	claims, err := ts.Verify(refreshResult.AccessToken)
	if err != nil {
		t.Fatalf("new access token invalid: %v", err)
	}
	if claims.Email != "pat@example.com" {
		t.Errorf("claims.Email = %q", claims.Email)
	}
}

func TestRefresh_InvalidToken_Rejected(t *testing.T) {
	f := newFixture()

	_, err := f.svc.Refresh(context.Background(), "bogus-refresh-token")
	if err == nil {
		t.Fatal("expected error for invalid refresh token")
	}
}

func TestRefresh_RevokedToken_Rejected(t *testing.T) {
	f := newFixture()
	ctx := context.Background()

	tok := fullLogin(t, f, "quinn@example.com")

	// Revoke the token.
	hash := shared.HashToken(tok.RefreshToken)
	rt, _ := f.refreshRepo.FindByHash(ctx, hash)
	_ = f.refreshRepo.Revoke(ctx, rt.TokenID)

	_, err := f.svc.Refresh(ctx, tok.RefreshToken)
	if err == nil {
		t.Fatal("expected error for revoked refresh token")
	}
}

func TestRefresh_ExpiredToken_Rejected(t *testing.T) {
	f := newFixture()
	ctx := context.Background()

	tok := fullLogin(t, f, "rose@example.com")

	// Force token expiry.
	hash := shared.HashToken(tok.RefreshToken)
	rt, _ := f.refreshRepo.FindByHash(ctx, hash)
	rt.ExpiresAt = time.Now().UTC().Add(-1 * time.Minute)

	_, err := f.svc.Refresh(ctx, tok.RefreshToken)
	if err == nil {
		t.Fatal("expected error for expired refresh token")
	}
}

// ── Tests: Full flow (invite → login) ────────────────────────────────────────

// TestFullFlow_InvitedSeat_StartsActivatesPolls runs the complete happy path:
// admin pre-invites a seat, member runs aikey login, clicks email link, CLI polls.
func TestFullFlow_InvitedSeat_PollingReceivesTokens(t *testing.T) {
	// Arrange: seat pre-invited by admin.
	const memberEmail = "sam@example.com"
	f := newFixture(memberEmail)
	ctx := context.Background()

	// Step 1: CLI calls Start (aikey login).
	startResult, err := f.svc.Start(ctx, StartParams{
		Email:         memberEmail,
		ClientName:    "aikey-cli",
		ClientVersion: "0.4.0",
		OSPlatform:    "darwin",
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	sessionID := startResult.LoginSessionID
	deviceCode := startResult.DeviceCode

	// Step 2: Poll returns pending before email activation.
	pending, err := f.svc.Poll(ctx, sessionID, deviceCode)
	if err != nil {
		t.Fatalf("early Poll: %v", err)
	}
	if pending.Status != PollStatusPending {
		t.Errorf("before activation: status = %q, want pending", pending.Status)
	}

	// Step 3: Member clicks activation link in email.
	activationTok := activationTokenFromURL(f.mailer.lastURL)
	actResult, err := f.svc.Activate(ctx, activationTok)
	if err != nil || !actResult.Success {
		t.Fatalf("Activate: err=%v result=%+v", err, actResult)
	}

	// Step 4: CLI polls again — should receive tokens.
	approved, err := f.svc.Poll(ctx, sessionID, deviceCode)
	if err != nil {
		t.Fatalf("Poll after activation: %v", err)
	}
	if approved.Status != PollStatusApproved {
		t.Fatalf("after activation: status = %q, want approved", approved.Status)
	}
	tokens := approved.Token
	if tokens == nil {
		t.Fatal("Token must be set when approved")
	}

	// Validate tokens.
	ts := testTokenSvc()
	claims, err := ts.Verify(tokens.AccessToken)
	if err != nil {
		t.Fatalf("access token invalid: %v", err)
	}
	if claims.Email != memberEmail {
		t.Errorf("claims.Email = %q, want %q", claims.Email, memberEmail)
	}
	if tokens.RefreshToken == "" {
		t.Error("RefreshToken must be present")
	}

	// Validate seat reconciliation.
	if len(f.reconciler.reconciled) != 1 {
		t.Errorf("seat not reconciled; got %v", f.reconciler.reconciled)
	}

	// Validate account created with correct email (OAuth-only, no password).
	acc, _ := f.accountRepo.FindByEmail(ctx, memberEmail)
	if acc == nil {
		t.Fatal("account not created")
	}
	if acc.PasswordHash != "" {
		t.Error("OAuth-only accounts must have empty PasswordHash")
	}

	// Validate refresh token can obtain a new access token.
	refreshed, err := f.svc.Refresh(ctx, tokens.RefreshToken)
	if err != nil {
		t.Fatalf("Refresh after full login: %v", err)
	}
	if refreshed.AccountID != acc.AccountID {
		t.Errorf("refreshed AccountID = %q, want %q", refreshed.AccountID, acc.AccountID)
	}
}

// TestFullFlow_InvitedSeat_CopyPasteFallback runs the copy-paste branch:
// CLI polls time out; member uses the login_token from the activation page.
func TestFullFlow_InvitedSeat_CopyPasteFallback(t *testing.T) {
	const memberEmail = "tina@example.com"
	f := newFixture(memberEmail)
	ctx := context.Background()

	startResult, _ := f.svc.Start(ctx, StartParams{Email: memberEmail, ClientName: "aikey-cli"})
	sessionID := startResult.LoginSessionID

	// Member activates via email link.
	activationTok := activationTokenFromURL(f.mailer.lastURL)
	actResult, err := f.svc.Activate(ctx, activationTok)
	if err != nil || !actResult.Success {
		t.Fatalf("Activate: %v / %+v", err, actResult)
	}
	loginToken := actResult.LoginToken

	// CLI missed the polling window; exchange the copy-paste token instead.
	tokens, err := f.svc.Exchange(ctx, sessionID, loginToken)
	if err != nil {
		t.Fatalf("Exchange: %v", err)
	}
	if tokens.AccessToken == "" || tokens.RefreshToken == "" {
		t.Error("Exchange must return both tokens")
	}
	if tokens.Email != memberEmail {
		t.Errorf("Email = %q, want %q", tokens.Email, memberEmail)
	}

	// Attempt to reuse the login_token must fail.
	_, err = f.svc.Exchange(ctx, sessionID, loginToken)
	if err == nil {
		t.Fatal("second Exchange with same token must fail")
	}
}

// TestFullFlow_NoInvitedSeat_AccountCreatedNoReconciliation verifies that a user
// can still log in (account created) even without a pre-invited seat.
func TestFullFlow_NoInvitedSeat_AccountCreatedNoReconciliation(t *testing.T) {
	f := newFixture() // no pre-seeded seats
	ctx := context.Background()

	sessionID, deviceCode, activationTok := fullStart(t, f, "uma@example.com")
	if _, err := f.svc.Activate(ctx, activationTok); err != nil {
		t.Fatalf("Activate: %v", err)
	}
	poll, err := f.svc.Poll(ctx, sessionID, deviceCode)
	if err != nil || poll.Status != PollStatusApproved {
		t.Fatalf("Poll: err=%v status=%v", err, poll.Status)
	}

	// Account still created.
	acc, _ := f.accountRepo.FindByEmail(ctx, "uma@example.com")
	if acc == nil {
		t.Fatal("account should be created even without an invited seat")
	}

	// No reconciliation call was made (no seat to reconcile).
	if len(f.reconciler.reconciled) != 0 {
		t.Errorf("unexpected reconciliation: %v", f.reconciler.reconciled)
	}
}
