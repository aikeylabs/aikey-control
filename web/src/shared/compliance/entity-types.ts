/**
 * Compliance finding ENTITY TYPES — the filter vocabulary for the two
 * compliance-audit surfaces (2026-08-11 user request).
 *
 * # Why this file exists, and why user/web owns it
 *
 * An operator reads 「ADDR」 in a redacted snippet and reasonably wants to filter
 * by it. But `ADDR` is not stored anywhere: findings store `entity_type`
 * (`CN_ADDRESS`), and the short code is produced at masking time by
 * `defaultLabelCodes` in
 * `ai-compliance-detector/internal/compliance/planner/planner.go`.
 *
 * That map is MANY-TO-ONE — `CN_PHONE` and `PHONE` both render as `PHONE` — so
 * the short code cannot be the filter value without becoming ambiguous at the
 * storage layer. 🔴 User decision (option C): the VALUE is the stored
 * entity_type, and the LABEL shows both, e.g. 「ADDR (CN_ADDRESS)」. The operator
 * recognises the code they saw AND can tell which stored type they picked when
 * two rows share a code.
 *
 * 🚫 This is a display-side vocabulary, not a second source of truth for masking. The
 * detector is a separate Go module the console cannot import, and nothing here
 * feeds detection — a stale entry mislabels a filter row, it cannot mislabel a
 * mask. The dimension is also `freeText`, so an entity type shipped after this
 * table was written stays filterable by typing it.
 *
 * user/web is the single frontend owner. Master and Trial resolve this path
 * through their explicit Vite/tsconfig aliases; do not create a master/web
 * physical copy. shared-alias-parity.test.ts enforces that boundary.
 *
 * Provenance: `defaultLabelCodes` + the entity set observed in
 * `compliance_findings.entity_type`. Keep additions in sync when the detector
 * gains an entity; see complianceEntityTypeOptions' fallback for what happens
 * when they drift.
 */

/** entity_type → the short code the masked snippet shows. */
export const COMPLIANCE_ENTITY_SHORT_CODE: Record<string, string> = {
  // planner.go defaultLabelCodes
  CN_ADDRESS: 'ADDR',
  CN_ID_CARD: 'IDCARD',
  ID_CARD: 'IDCARD',
  CN_PHONE: 'PHONE',
  PHONE: 'PHONE',
  CREDIT_CARD: 'BANKCARD',
  BANK_CARD: 'BANKCARD',
  EMAIL_ADDRESS: 'EMAIL',
  EMAIL: 'EMAIL',
  CREDENTIAL_JWT: 'JWT',
  CREDENTIAL_PASSWORD: 'PASSWD',
  DE_TAX_ID: 'DETAX',
  FI_PERSONAL_IDENTITY_CODE: 'FIPID',
  PL_PESEL: 'PLPESEL',
  SE_PERSONNUMMER: 'SEPNR',
  TR_NATIONAL_ID: 'TRNID',
};

/**
 * The entity types offered as pickable filter values.
 *
 * 🔴 Includes types with NO short code (`NSFW_POLITICAL`, `DATE_TIME`,
 * `CREDENTIAL_API_KEY`, `US_DRIVER_LICENSE`, `NSFW_PORN`). They are real,
 * frequent findings — `NSFW_POLITICAL` is the second most common type in the
 * reporting deployment — and they are masked through `maskFor`'s fallback
 * rather than the code table. Listing only the coded ones would hide the
 * majority of findings from the filter.
 */
const COMPLIANCE_ENTITY_TYPES: string[] = [
  'CN_ADDRESS',
  'CN_ID_CARD',
  'CN_PHONE',
  'CREDENTIAL_API_KEY',
  'CREDENTIAL_JWT',
  'CREDENTIAL_PASSWORD',
  'CREDIT_CARD',
  'DATE_TIME',
  'DE_TAX_ID',
  'EMAIL_ADDRESS',
  'FI_PERSONAL_IDENTITY_CODE',
  'NSFW_POLITICAL',
  'NSFW_PORN',
  'PL_PESEL',
  'SE_PERSONNUMMER',
  'TR_NATIONAL_ID',
  'US_DRIVER_LICENSE',
];

/**
 * Filter options: value = stored entity_type, label = 「SHORT (ENTITY_TYPE)」,
 * or the bare entity type when it has no short code (option C).
 */
export function complianceEntityTypeOptions(): Array<{ value: string; label: string }> {
  return COMPLIANCE_ENTITY_TYPES.map((value) => {
    const short = COMPLIANCE_ENTITY_SHORT_CODE[value];
    return { value, label: short ? `${short} (${value})` : value };
  });
}
