// Vault-only visual skin layered on top of the shared KEYS_PAGE_CSS.
//
// Why a separate file:
//   .vault-page is shared by 9 pages (vault, virtual-keys, account, overview,
//   import, apps/index, apps/detail, apps/SwitchKeyModal, VaultStatusPill).
//   Editing keys-page-css.ts would propagate visual changes across all of
//   them. The v1 reference design only applies to /vault, so we scope this
//   skin behind .vault-page.vault-skin-v1 and the vault page opts in via
//   that extra class on its outer wrapper.
//
// Reference design:
//   .superdesign/design_iterations/vault_original_refine_1.html
//
// What this skin does — full v1 "framing language" alignment:
//
// 1. Body atmosphere — amber radial gradient at top-right corner gives the
//    page a warm anchor (matches v1 `radial-gradient(circle at 72% -8%, …)`).
//    Sits on the page wrapper so it doesn't bleed across edges.
//
// 2. Card chrome — flat surface-2 + heavy border becomes panel-tinted bg
//    with a soft 1px border, a tall outer drop-shadow (18px), and an
//    inset 1px white top highlight. This is the "card floats above body"
//    effect that v1 uses to separate the table from the rest of the page.
//
// 3. Card head — bottom divider softened from var(--border) (full strength)
//    to line-soft (~4% white). Background tinted slightly darker so the
//    head reads as a quieter strip above the thead.
//
// 4. Table thead — pure 50%-black overlay swapped for a warmer dark
//    rgba(23,23,25,0.32) (matches v1's `--row` family). Bottom border
//    matches the card-head softener so the table head→body transition
//    reads as one connected band.
//
// 5. td bottom border — base has color-mix at 35% which paints fairly
//    visible row lines; v1 keeps these at ~3% so rows feel like one
//    continuous list separated by tone, not by lines. Drop to 2.5%.
//
// 6. Zebra striping — alternating row backgrounds (matches v1 `--row` /
//    `--row-alt`). Adds visual rhythm without adding lines. Hover wins
//    over zebra via the existing hover rule's higher specificity.
//
// 7. Search input — flat surface-1 swapped for a slightly lighter tactile
//    bg with an inset top white highlight, mirroring v1's `#34343c +
//    inset 0 1px 0 rgba(255,255,255,0.035)` keyboard-style depth.
//
// 8. IdentityStrip — title bumped to 22px / 800 / mono; icon box tinted
//    with amber bg + amber border + soft amber glow; count numbers
//    wrapped in <strong> for hierarchy.
//
// 9. alias-main / alias-sub — alias bumped to 14.5px / 700 with tight
//    letter-spacing; sub-line dimmed further. Widens the primary/
//    secondary contrast so the alias reads as the row's anchor.
//
// 10. .in-use row — re-introduces a 2px amber inset rail + light amber
//     gradient on the row cells. The full per-row tint was removed
//     2026-04-24 (cyan IN-USE chip was deemed sufficient on its own);
//     v1 reference treats the active key with a visible left-rail
//     accent. We keep the cyan chip as the primary signal and the rail
//     is much lighter than v1 mockup's full gradient.
//
// Things deliberately NOT changed here (already align with v1):
//   - .unlock-banner.locked  — base CSS already paints amber gradient +
//     3px amber inset rail (lines 206-213 of keys-page-css.ts).
//   - .filter-pill.active    — base CSS already paints amber pill.
//   - .row-use-btn           — base CSS already shows amber border + hover.
//   - .in-use-chip           — base CSS already paints cyan/sky-blue chip.
//   - .group-row             — base CSS already paints surface-1 band +
//     top/bottom border, which matches v1's `rgba(19,19,22,0.42)` band.

export const VAULT_PAGE_SKIN_V1 = `
/* ── Body atmosphere — amber radial glow + soft vertical gradient ── */
.vault-page.vault-skin-v1 {
  background:
    radial-gradient(circle at 78% -10%, rgba(250, 204, 21, 0.05), transparent 32rem),
    linear-gradient(180deg, rgba(255, 255, 255, 0.012) 0%, transparent 42rem),
    var(--background);
}

/* IdentityStrip overrides removed 2026-05-23: the leading shield icon
   and "N KEYS · N PERSONAL · N OAUTH" subtitle were deleted from the
   page (counts already shown on CardHeader + FilterStrip; identity
   carried by topbar breadcrumb), and the title font-size was rolled
   back to plain Tailwind text-lg (18px) so /user/vault aligns with
   the other page H1s on Trust Check / Performance / Usage / Account.
   Color still comes from the inline var(--display-foreground) set on
   the title div — same token the sidebar brand + breadcrumb + sibling
   page H1s use, so no skin-side override needed. */

/* ── Card chrome: float above body with soft border + outer shadow ── */
.vault-page.vault-skin-v1 .card {
  background: rgba(32, 32, 36, 0.86) !important;
  border: 1px solid rgba(244, 244, 245, 0.085) !important;
  border-radius: 11px !important;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.025) inset,
    0 18px 50px rgba(0, 0, 0, 0.22) !important;
}

/* ── Card head: softer divider + slightly tinted band ────────────── */
.vault-page.vault-skin-v1 .card > div:first-of-type {
  background-color: rgba(23, 23, 25, 0.2) !important;
  border-bottom: 1px solid rgba(244, 244, 245, 0.04) !important;
}

/* ── Search input: tactile bg + inset top highlight ─────────────── */
.vault-page.vault-skin-v1 .search-input {
  background: rgba(52, 52, 60, 0.9);
  border: 1px solid rgba(244, 244, 245, 0.065);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);
}
.vault-page.vault-skin-v1 .search-input:focus {
  border-color: rgba(250, 204, 21, 0.5);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    0 0 0 2px rgba(250, 204, 21, 0.15);
}

/* ── Table thead: warmer dark band + softer bottom border ───────── */
.vault-page.vault-skin-v1 table.vault th {
  background: rgba(23, 23, 25, 0.32) !important;
  border-bottom: 1px solid rgba(244, 244, 245, 0.04) !important;
  letter-spacing: 0.08em;
}
.vault-page.vault-skin-v1 table.vault th.th-sortable:hover {
  background: rgba(23, 23, 25, 0.48) !important;
}

/* ── Data rows: zebra striping + super-faint bottom border ──────── */
.vault-page.vault-skin-v1 table.vault tbody tr:not(.group-row):not(:hover):not(.in-use) {
  background: rgba(38, 38, 42, 0.42);
}
.vault-page.vault-skin-v1 table.vault tbody tr:not(.group-row):not(:hover):not(.in-use):nth-of-type(even) {
  background: rgba(35, 35, 39, 0.42);
}
.vault-page.vault-skin-v1 table.vault td {
  border-bottom: 1px solid rgba(244, 244, 245, 0.025) !important;
}

/* ── Group row: slightly stronger separator band ────────────────── */
.vault-page.vault-skin-v1 table.vault tbody tr.group-row > td {
  background: rgba(19, 19, 22, 0.55) !important;
  border-top: 1px solid rgba(244, 244, 245, 0.04) !important;
  border-bottom: 1px solid rgba(244, 244, 245, 0.04) !important;
}

/* ── Alias hierarchy boost: bigger/heavier alias, dimmer sub ──── */
.vault-page.vault-skin-v1 .alias-main {
  font-size: 14.5px;
  font-weight: 700;
  letter-spacing: -0.005em;
  /* Soft off-white tier (--soft-foreground = #dcd8d1) — sits between
     --foreground (pure white) and --display-foreground (heading dim).
     Promoted to a token in index.css 2026-05-23 v3 because now used by
     vault alias + vault "Vault Locked" + import "Vault Locked".
     Scoped to .vault-skin-v1; sibling pages on .vault-page keep
     their original color. */
  color: var(--soft-foreground);
}
.vault-page.vault-skin-v1 .alias-sub {
  font-size: 10.5px;
  opacity: 0.7;
  letter-spacing: 0.02em;
}

/* ── Meta-section field values: gentle dim ────────────────────────
   Scoped to .drawer-section--meta (marker class added on the Meta
   drawer-section JSX). Other sections (Credential, Routing, etc.)
   keep the keys-page-css.ts default --foreground (#f4f4f5 white) so
   primary credential info stays "loud" while ancillary metadata
   (Protocol / Created / Last test / Org UUID / Tier ...) reads as
   "secondary".
   Picked --display-foreground (#c8c4ba) over --muted-foreground —
   user feedback "调暗一些，不要太暗": muted-fg was too gray; soft-fg
   (#dcd8d1) too close to white; display-fg sits in the middle.
   Colored descendants (.status-dot, .label --success green, etc.)
   keep their own colors via higher CSS specificity. */
.vault-page.vault-skin-v1 .drawer-section--meta .drawer-field .v {
  color: var(--display-foreground);
}

/* ── In-use row: amber rail + single row-wide gradient ──────────────
   Gradient lives on the <tr>, NOT on each <td>. Putting it on td makes
   every cell restart its own amber→transparent fade, which reads as
   ~6 stacked gradients across the row. Row-level keeps a single
   continuous fade from the left rail outward. */
.vault-page.vault-skin-v1 table.vault tbody tr.in-use {
  background: linear-gradient(
    90deg,
    rgba(250, 204, 21, 0.075),
    transparent 34%
  );
  box-shadow: inset 2px 0 0 0 rgba(250, 204, 21, 0.78);
}
.vault-page.vault-skin-v1 table.vault tbody tr.in-use:hover {
  box-shadow: inset 2px 0 0 0 rgba(250, 204, 21, 0.92);
}
`;
