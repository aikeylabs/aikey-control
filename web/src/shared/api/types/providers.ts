/**
 * Cross-edition provider/credential types.
 * Used by both master console and user-facing adapters (for shape mapping).
 */

export interface ProviderDTO {
  provider_id: string;
  provider_code: string;
  display_name: string;
  protocol_type: string;
  default_base_url: string;
  status: string;
}

export interface CredentialDTO {
  credential_id: string;
  org_id: string;
  provider_id: string;
  display_name: string;
  base_url_override?: string;
  /**
   * Per-credential wire protocol (P1g / design D-13). Optional: omitted =
   * inherits the provider's default — that's the sentinel, not missing data.
   * Lets one provider brand carry several protocols; prefer it over
   * `ProviderDTO.protocol_type` when rendering.
   */
  protocol_type?: string;
  current_revision: string;
  status: string;
  created_at: string;
  updated_at: string;
}
