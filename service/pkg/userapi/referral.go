package user

import (
	"net/http"

	"github.com/AiKeyLabs/aikey-control/service/pkg/referral"
	"github.com/AiKeyLabs/aikey-control/service/pkg/shared"
)

// ReferralHandler exposes referral endpoints.
type ReferralHandler struct {
	repo referral.Repository
}

// NewReferralHandler creates a ReferralHandler.
func NewReferralHandler(repo referral.Repository) *ReferralHandler {
	return &ReferralHandler{repo: repo}
}

// MyReferrals handles GET /accounts/me/referrals
func (h *ReferralHandler) MyReferrals(w http.ResponseWriter, r *http.Request) {
	accountID := shared.AccountID(r.Context())
	refs, err := h.repo.ListByReferrer(r.Context(), accountID)
	if err != nil {
		shared.DomainErrorResponse(w, shared.SysInternal())
		return
	}
	if refs == nil {
		refs = []*referral.Referral{}
	}
	shared.JSON(w, http.StatusOK, refs)
}
