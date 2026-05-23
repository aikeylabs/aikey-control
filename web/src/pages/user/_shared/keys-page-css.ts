// Auto-extracted CSS shared between vault and virtual-keys pages.
// Source of truth: this file. Both pages import + render <style>{KEYS_PAGE_CSS}</style>.
// All rules scoped under .vault-page; pages opt in via that class on outer wrapper.
// Phase 3B 'C plan' style alignment: virtual-keys page uses .vault-page wrapper
// to inherit the same chip/pill/table/drawer styling. See requirements/
// 2026-05-11-aikey-web-local-first-team-merge.md R10 (vault-style alignment).

export const KEYS_PAGE_CSS = `
  /* Page-scoped tokens. Defines surface tones (--surface-1/-2) and brand
     dot palette so the page is self-contained and matches
     user_overview_3_1. Must live inside .vault-page so the closing brace
     on the last line is balanced — orphan declarations get dropped by
     the CSS parser, which previously left .card background transparent
     and the "All keys" header reading near-black. */
  .vault-page {
  --chart-anthropic: #ca8a04;
  --chart-kimi:      #38bdf8;
  --chart-openai:    #a78bfa;
  --chart-codex:     #22d3ee;
  --chart-gemini:    #f472b6;
  --chart-neutral:   #52525b;
  --success:         #4ade80;
  --warning:         #f97316;
  --destructive:     #ef4444;
  --info:            #60a5fa;
  --surface-1:       #1f1f23;
  --surface-2:       #27272a;
}

/* ---- Buttons ------------------------------------------------- */
.vault-page .btn {
  display: inline-flex; align-items: center; gap: 0.35rem;
  font-weight: 600; border-radius: var(--radius-sm);
  transition: background 150ms ease, border-color 150ms ease, color 120ms ease;
  cursor: pointer; border: 1px solid transparent; white-space: nowrap;
  font-size: 0.75rem;
  padding: 0.375rem 0.75rem;
  font-family: var(--font-mono);
  letter-spacing: 0.05em;
}
.vault-page .btn-primary {
  background: var(--primary); color: var(--primary-foreground);
  border-color: rgba(250, 204, 21, 0.55);
}
.vault-page .btn-primary:hover:not(:disabled) { background: #fde047; }
.vault-page .btn-outline {
  background: var(--surface-1); color: var(--foreground);
  border-color: var(--border);
}
.vault-page .btn-outline:hover:not(:disabled) { background: var(--surface-2); border-color: var(--muted-foreground); }
.vault-page .btn-ghost { background: transparent; color: var(--muted-foreground); }
.vault-page .btn-ghost:hover:not(:disabled) { color: var(--foreground); background: var(--surface-1); }
.vault-page .btn-danger {
  background: rgba(239, 68, 68, 0.1); color: #fca5a5;
  border-color: rgba(239, 68, 68, 0.35);
}
.vault-page .btn-danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.18); color: #fecaca;
  border-color: rgba(239, 68, 68, 0.55);
}
.vault-page .btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* Custom tooltip for disabled buttons — renders the \`title\` text as a
   styled bubble on hover/focus so users immediately understand *why*
   an action is greyed out (most often: "Unlock vault to …"). The
   native browser tooltip also still fires as a fallback but its
   500ms+ delay is too slow for "why can't I click this?" copy. We
   intentionally scope to :disabled so enabled buttons don't double
   up with both a visual hover state and a floating bubble. */
.vault-page .btn[title]:disabled,
.vault-page .icon-btn[title]:disabled,
.vault-page .row-use-btn[title]:disabled { position: relative; }

.vault-page .btn[title]:disabled:hover::after,
.vault-page .btn[title]:disabled:focus-visible::after,
.vault-page .icon-btn[title]:disabled:hover::after,
.vault-page .icon-btn[title]:disabled:focus-visible::after,
.vault-page .row-use-btn[title]:disabled:hover::after,
.vault-page .row-use-btn[title]:disabled:focus-visible::after {
  content: attr(title);
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  padding: 5px 10px;
  background: var(--card);
  color: var(--foreground);
  border: 1px solid var(--border);
  border-radius: 5px;
  white-space: nowrap;
  font-size: 12px;
  font-family: var(--font-sans);
  font-weight: 500;
  letter-spacing: 0;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
  pointer-events: none;
  z-index: 100;
}
.vault-page .btn[title]:disabled:hover::before,
.vault-page .btn[title]:disabled:focus-visible::before,
.vault-page .icon-btn[title]:disabled:hover::before,
.vault-page .icon-btn[title]:disabled:focus-visible::before,
.vault-page .row-use-btn[title]:disabled:hover::before,
.vault-page .row-use-btn[title]:disabled:focus-visible::before {
  content: "";
  position: absolute;
  bottom: calc(100% + 2px);
  left: 50%;
  transform: translateX(-50%) rotate(45deg);
  width: 8px; height: 8px;
  background: var(--card);
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  pointer-events: none;
  z-index: 99;
}

/* ---- Chips & dots ------------------------------------------- */
.vault-page .chip {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 3px 7px; font-size: 10.5px;
  font-family: var(--font-mono);
  border-radius: 4px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  color: var(--muted-foreground);
  letter-spacing: 0.04em;
}
.vault-page .chip.success { color: rgba(134,239,172,0.65); background: rgba(74,222,128,0.04);  border-color: rgba(74,222,128,0.16); }
.vault-page .chip.warning { color: var(--warning); background: rgba(249,115,22,0.09);  border-color: rgba(249,115,22,0.32); }
.vault-page .chip.danger  { color: #fca5a5;       background: rgba(239,68,68,0.1);     border-color: rgba(239,68,68,0.35); }
.vault-page .chip.info    { color: var(--info);   background: rgba(96,165,250,0.08);   border-color: rgba(96,165,250,0.3); }

.vault-page .kind-pill {
  display: inline-flex; align-items: center;
  padding: 2px 6px;
  font-family: var(--font-mono);
  font-size: 9.5px; font-weight: 600;
  letter-spacing: 0.05em; text-transform: uppercase;
  border-radius: 3px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted-foreground);
}
.vault-page .kind-pill.oauth {
  color: #c4b5fd;
  border-color: rgba(167,139,250,0.35);
  background: rgba(167,139,250,0.06);
}
/* Phase 3A-2 (team-key merged display): teal/cyan distinct from
   purple OAuth + neutral KEY. The hue mirrors the cross-app menu's
   "team area" treatment so the user reads "team-managed" at a glance
   without learning a new color code. */
.vault-page .kind-pill.team {
  color: #5eead4;
  border-color: rgba(45,212,191,0.35);
  background: rgba(45,212,191,0.06);
}

.vault-page .status-dot {
  width: 6px; height: 6px; border-radius: 999px;
  background: var(--success);
  box-shadow: 0 0 3px rgba(74, 222, 128, 0.35);
  flex-shrink: 0; display: inline-block;
  opacity: 0.75;
}
.vault-page .status-dot.idle  { background: var(--muted-foreground); box-shadow: none; }
.vault-page .status-dot.stale { background: var(--warning); box-shadow: 0 0 6px rgba(249,115,22,0.6); }
.vault-page .status-dot.error { background: var(--destructive); box-shadow: 0 0 6px rgba(239,68,68,0.7); }

.vault-page .prov-dot {
  width: 6px; height: 6px; border-radius: 2px;
  display: inline-block; flex-shrink: 0;
  opacity: 0.55;
}

/* ---- Cards / metrics --------------------------------------- */
/* Inset bottom box-shadow + outer 1px border stack into two adjacent
   horizontal lines at the card bottom — mirrors master's "double-line"
   table ending. Same pattern as .draft-row on /user/import. */
.vault-page .card {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: inset 0 -1px 0 0 var(--border);
}

/* ---- Unlock banner ----------------------------------------- */
.vault-page .unlock-banner {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.6rem 0.95rem;
  border-radius: var(--radius-sm);
  background: rgba(74, 222, 128, 0.05);
  border: 1px solid rgba(74, 222, 128, 0.25);
  font-size: 12.5px; color: var(--foreground);
}
.vault-page .unlock-banner .dot {
  width: 6px; height: 6px; border-radius: 999px;
  background: var(--success); box-shadow: 0 0 6px rgba(74,222,128,0.7);
  flex-shrink: 0;
}
/* Locked-state theme matches /user/import's .unlock-banner (gold gradient
   + primary inset rail) so the two pages feel like siblings during the
   unlock flow. Avoids the orange/warning look we had before — orange
   implies error, but "locked" is simply a gated state, not a failure. */
.vault-page .unlock-banner.locked {
  background: linear-gradient(90deg, rgba(250, 204, 21,0.08) 0%, rgba(250, 204, 21,0.02) 100%);
  border: 1px solid rgba(250, 204, 21,0.35);
  box-shadow: inset 3px 0 0 0 var(--primary);
}
.vault-page .unlock-banner.locked .dot {
  background: var(--primary); box-shadow: 0 0 6px rgba(250, 204, 21,0.6);
}

/* ---- Inputs ------------------------------------------------ */
.vault-page .field-input,
.vault-page .search-input {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--foreground);
  font-size: 12.5px;
  padding: 6px 10px;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.vault-page .field-input:focus,
.vault-page .search-input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(250, 204, 21,0.15);
}
.vault-page .search-input { padding-left: 30px; width: 100%; }
/* Monospace override for form fields carrying code-like values (e.g. the
   route-token textarea in the drawer). Required because the project-wide
   "input, select, textarea { font-family: var(--font-sans) !important }"
   rule in index.css wins over the Tailwind font-mono class otherwise.
   Using the .field-input.font-mono combo as the selector avoids
   introducing a new class name — both pieces are already existing
   classes the component composes. */
.vault-page .field-input.font-mono {
  font-family: var(--font-mono) !important;
}

/* Segmented capsule container — one outer border wraps a row of
   pills; inner pills are borderless and share the container's frame.
   Replaces the earlier row-of-standalone-pills (each with its own
   border + hairline) which visually competed with the table's own
   frame. */
/* Toolbar sizes bumped 2026-04-25 — user flagged the inputs/pills
   as "too small/cramped" against the full-width vault table. Pills
   and seg buttons now match the 36px search input height so the
   whole row reads as a coherent, generously-sized toolbar. */
.vault-page .filter-group {
  display: inline-flex; align-items: stretch;
  padding: 3px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 999px;
  gap: 0;
}

.vault-page .filter-pill {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 6px 14px;
  font-family: var(--font-mono);
  font-size: 12px; letter-spacing: 0.05em;
  color: var(--muted-foreground);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 999px;
  transition: color 120ms ease, background 120ms ease;
  cursor: pointer;
}
.vault-page .filter-pill:hover:not(.active) {
  color: var(--foreground);
  background: rgba(255, 255, 255, 0.04);
}
.vault-page .filter-pill.active {
  background: rgba(250, 204, 21, 0.12);
  color: var(--primary);
  font-weight: 600;
}
.vault-page .filter-pill .count {
  font-size: 11px; color: var(--muted-foreground); opacity: 0.8; margin-left: 3px;
}
.vault-page .filter-pill.active .count { color: var(--primary); opacity: 1; }

.vault-page .filter-group-label {
  font-family: var(--font-mono);
  font-size: 11px; letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted-foreground);
  opacity: 0.7; padding-right: 4px;
}

.vault-page .seg {
  display: inline-flex; padding: 3px;
  background: var(--surface-1); border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.vault-page .seg button {
  font-family: var(--font-mono);
  font-size: 11.5px; letter-spacing: 0.05em;
  padding: 5px 12px; border-radius: 3px;
  color: var(--muted-foreground);
  background: transparent; border: none; cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.vault-page .seg button:hover { color: var(--foreground); }
.vault-page .seg button.active {
  background: var(--surface-2); color: var(--foreground);
  box-shadow: inset 0 0 0 1px var(--border);
}

/* ---- Vault table ------------------------------------------- */
.vault-page table.vault { width: 100%; border-collapse: collapse; }
.vault-page table.vault th {
  /* 2026-05-12: thead bg deepened to match /user/virtual-keys's thead
     appearance. Virtual-keys' card is transparent, so its rgba(0,0,0,0.2)
     overlay lands on the page bg (#18181b) and reads as ~rgb(19,19,22).
     Vault's card now uses var(--surface-2) (#27272a), so the same 0.2
     overlay would read as ~rgb(31,31,33) — visibly lighter. Bumping the
     thead overlay to 0.5 makes the rendered color match across both
     pages without changing the card surface or the CardHeader strip. */
  font-family: var(--font-mono);
  font-size: 10px; letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted-foreground);
  font-weight: 600;
  text-align: left;
  background: rgba(0, 0, 0, 0.5);
  border-bottom: 1px solid var(--border);
  padding: 12px 20px;
  white-space: nowrap;
}
.vault-page table.vault th .th-hint {
  font-size: 9.5px; letter-spacing: 0.05em;
  text-transform: none;
  color: var(--muted-foreground);
  opacity: 0.55; font-weight: 500; margin-left: 0.3rem;
}
/* Click-to-sort column headers. Muted by default, brighten on hover,
   and the active-sort column gets foreground + a ↓ arrow to mirror
   master's "click the column header" pattern. */
.vault-page table.vault th.th-sortable {
  cursor: pointer;
  user-select: none;
  transition: color 120ms ease, background 120ms ease;
}
.vault-page table.vault th.th-sortable:hover {
  color: var(--foreground);
  background: rgba(0, 0, 0, 0.62);
}
.vault-page table.vault th.th-sortable.active {
  color: var(--foreground);
}
.vault-page table.vault th .th-sort-arrow {
  display: inline-block;
  margin-left: 4px;
  font-size: 10px;
  color: var(--primary);
  vertical-align: baseline;
}
.vault-page table.vault td {
  border-bottom: 1px solid color-mix(in oklab, var(--border) 35%, transparent);
  /* 2026-04-24 bump: cell padding 9→11 and height 36→42; text
     13→14 via .alias-main / .provider-cell .name / span.mono
     individually. Gives the table a more generous row rhythm. */
  padding: 11px 14px; font-size: 13.5px;
  vertical-align: middle; height: 42px;
}
/* Keep the last row's bottom border so it stacks with the CardFooter's
   top border directly below — mirrors master's "double-line at table
   bottom" pattern (last-row border + footer border-top abut with no
   gap, reads as a crisp two-line divider). */
.vault-page table.vault tbody tr {
  transition: background 120ms ease, box-shadow 120ms ease;
}
.vault-page table.vault tbody tr:hover {
  background: rgba(250, 204, 21, 0.035);
  box-shadow: inset 2px 0 0 0 rgba(250, 204, 21, 0.6);
}
.vault-page table.vault tbody tr:hover .row-actions { opacity: 1; }
/* Whole-row click opens the detail drawer (2026-04-24). Cursor hints
   at affordance; inline buttons still take precedence via the
   closest('button, input, ...') skip check in the JS handler. */
.vault-page table.vault tbody tr.row-clickable { cursor: pointer; }
.vault-page table.vault tbody tr.row-clickable button,
.vault-page table.vault tbody tr.row-clickable input,
.vault-page table.vault tbody tr.row-clickable textarea,
.vault-page table.vault tbody tr.row-clickable a { cursor: auto; }
.vault-page table.vault tbody tr.row-clickable .in-use-chip { cursor: pointer; }

/* ── in-use row: persistent row-level tint removed 2026-04-24 per
   user request — the .in-use-chip (sky-blue) inside the alias cell
   is the sole indicator now, so the in-use row flows with every
   other row in hover / height / background. .just-switched still
   fires a one-shot pulse after a successful switch for transient
   feedback; keyframe kept sans inset bar so it pulses a halo only. */
@keyframes route-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.4); }
  50%  { box-shadow: 0 0 0 6px rgba(56, 189, 248, 0); }
  100% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0); }
}

/* ── Test Connection popup spinner ─────────────────────────────────────
   The popup itself is a fixed overlay so its descendants live OUTSIDE
   .vault-page in the DOM tree — that means any selector scoped to
   .vault-page (like the rest of this file) won't reach the spinner.
   Use an unscoped @keyframes + .aikey-spinner class so the rule applies
   wherever the spinner mounts. Earlier attempts that scoped the
   keyframes to a popup component via inline <style>{...}</style> were
   flaky in practice (some render timings didn't pick up the keyframe
   name); routing through the global stylesheet that lives in the same
   <style> tag VAULT_CSS injects guarantees the rule is parsed before
   the spinner ever paints. SMIL <animateTransform> was a previous
   attempt — it animates fine but interacts poorly with screenshot
   tools that capture a single frame, so users report it as "static".
   CSS animation has stable visual behaviour in both live and recorded
   captures. */
@keyframes aikey-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
.aikey-spinner {
  display: inline-block;
  width: 32px;
  height: 32px;
  border: 3px solid var(--border, #2a2a2a);
  border-top-color: var(--accent, #3b82f6);
  border-radius: 50%;
  animation: aikey-spin 0.9s linear infinite;
  /* GPU-promoted layer so the rotation transform compositor-paints in
     its own layer instead of triggering layout/paint on every frame.
     Cheap insurance against rare slow-redraw cases. */
  will-change: transform;
}
.vault-page table.vault tbody tr.in-use.just-switched {
  animation: route-pulse 600ms ease-out 1;
}

/* ── Row inline Use button ─ only on non-active rows (design spec). */
.vault-page .row-use-btn {
  display: inline-flex; align-items: center; gap: 4px;
  height: 28px;
  padding: 0 9px;
  margin-right: 2px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-sans);
  letter-spacing: 0.01em;
  color: var(--primary);
  background: transparent;
  border: 1px solid rgba(250, 204, 21, 0.35);
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease;
}
.vault-page .row-use-btn:hover:not(:disabled) {
  background: rgba(250, 204, 21, 0.1);
  border-color: rgba(250, 204, 21, 0.7);
}
.vault-page .row-use-btn:disabled {
  opacity: 0.5;
  cursor: progress;
}
.vault-page .row-use-btn:focus-visible {
  outline: none;
  border-color: rgba(250, 204, 21, 0.9);
  box-shadow: 0 0 0 2px rgba(250, 204, 21, 0.15);
}

/* ── Protocol grouping (tree view) ──────────────────────────────────
   Group header tr.group-row injected before each provider; children
   tagged .group-child so their first cell gains a tree-indent guide.
   Collapse state toggled via data-collapsed on the header + .group-hidden
   class added/removed on children. */
/* Group header background is neutral — the provider-agnostic yellow
   gradient we had before (2026-04-23) made the whole table read warm
   because every provider (anthropic / openai / kimi / …) got the same
   yellow stripe regardless of its brand color. Leave yellow to the
   in-use / routing signal below where it carries meaning. */
.vault-page table.vault tbody tr.group-row > td {
  padding: 9px 14px 9px 10px;
  background: var(--surface-1);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.vault-page table.vault tbody tr.group-row:first-child > td { border-top: none; }
.vault-page table.vault tbody tr.group-row:hover > td {
  background: var(--surface-2);
}
.vault-page .gr-inner {
  display: flex; align-items: center; gap: 10px;
  min-height: 28px;
}
.vault-page .gr-toggle {
  width: 22px; height: 22px;
  border-radius: 6px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted-foreground);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
  flex-shrink: 0;
}
.vault-page .gr-toggle:hover {
  background: var(--surface-2);
  color: var(--foreground);
  border-color: var(--muted-foreground);
}
.vault-page .gr-toggle svg { transition: transform 160ms ease; }
.vault-page tr.group-row[data-collapsed="true"] .gr-toggle svg { transform: rotate(-90deg); }
/* .gr-dot removed 2026-04-30 — the 8px color circle collided visually
   with the per-row active-dot (same shape, different meaning). Replaced
   by .gr-chip below: provider name on a colored background pill. */
.vault-page .gr-dot { display: none !important; }

.vault-page .gr-chip {
  /* Compact pill that combines the brand color (background) with the
     provider name (label). Replaces the deprecated gr-dot+gr-name pair.
     Foreground stays white because the brand colors are mid-saturation
     (good contrast for white text). The chip's height ties to the
     containing .gr-inner row height (28px) so the row doesn't grow. */
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 6px;
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: 0.02em;
  text-transform: lowercase;
  color: #ffffff;
  flex-shrink: 0;
  /* Subtle shadow so the chip reads as a tactile element rather than
     sitting flat on the row background. */
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18), inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}

/* .gr-name kept as a dead rule for any remaining references (none in
   tree as of 2026-04-30). The chip now carries both color + name. */
.vault-page .gr-name {
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  color: var(--muted-foreground);
  letter-spacing: 0.005em;
  text-transform: lowercase;
}
.vault-page .gr-meta {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted-foreground);
  opacity: 0.78;
}
.vault-page .gr-meta .gr-sep { opacity: 0.4; margin: 0 4px; }
/* .gr-status / .gr-alias / .gr-idle-dot removed 2026-04-24 — the
   ROUTING/IDLE badge on each group header is gone; the per-row
   .in-use marker (yellow tint + IN USE pill on the active child)
   carries the same signal without doubling it up. */

/* Child rows — tree indent + horizontal connector on first cell. */
.vault-page tr.group-child td:first-child {
  position: relative;
  padding-left: 38px;
}
.vault-page tr.group-child td:first-child::before {
  content: "";
  position: absolute;
  left: 22px; top: 0; bottom: 0; width: 1px;
  background: linear-gradient(
    180deg,
    transparent 0,
    rgba(255, 255, 255, 0.08) 14%,
    rgba(255, 255, 255, 0.08) 86%,
    transparent 100%
  );
  pointer-events: none;
}
.vault-page tr.group-child td:first-child::after {
  content: "";
  position: absolute;
  left: 22px; top: 50%;
  width: 10px; height: 1px;
  background: rgba(255, 255, 255, 0.12);
  pointer-events: none;
}
.vault-page tr.group-child.last-in-group td:first-child::before {
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.08) 0,
    rgba(255, 255, 255, 0.08) 50%,
    transparent 50%,
    transparent 100%
  );
}
.vault-page tr.group-child.group-hidden { display: none; }

/* Header routing chip + .rp-* popover CSS removed 2026-04-24 along
   with the RoutePopover component — switch-routing action surface is
   now the per-row Use button + drawer "Route via this key". */


/* ── Toast stack (switch feedback + undo) ──────────────────────────── */
.vault-page .toast-stack {
  position: fixed;
  bottom: 20px; left: 50%;
  transform: translateX(-50%);
  z-index: 95;
  display: flex; flex-direction: column;
  gap: 8px;
  pointer-events: none;
}
.vault-page .toast {
  display: flex; align-items: flex-start; gap: 10px;
  min-width: 320px;
  max-width: 480px;
  padding: 10px 12px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.5), 0 2px 4px rgba(0, 0, 0, 0.3);
  color: var(--foreground);
  transform: translateY(12px);
  opacity: 0;
  transition: opacity 180ms ease, transform 220ms cubic-bezier(.3,0,.2,1);
  pointer-events: auto;
  position: relative;
  overflow: hidden;
}
.vault-page .toast[data-open="true"] { transform: translateY(0); opacity: 1; }
.vault-page .toast.error { border-color: rgba(239, 68, 68, 0.45); }
.vault-page .toast .toast-icon {
  width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  border-radius: 999px;
  background: rgba(250, 204, 21, 0.14);
  color: var(--primary);
}
.vault-page .toast.error .toast-icon {
  background: rgba(239, 68, 68, 0.14);
  color: var(--destructive);
}
.vault-page .toast .toast-body { flex: 1; min-width: 0; }
.vault-page .toast .toast-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--foreground);
}
.vault-page .toast .toast-sub {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--muted-foreground);
  margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.vault-page .toast .toast-actions {
  display: inline-flex; align-items: center; gap: 6px;
  flex-shrink: 0;
}
.vault-page .toast .toast-undo {
  font-size: 11px; font-weight: 600;
  color: var(--primary);
  background: transparent;
  border: 1px solid rgba(250, 204, 21, 0.4);
  border-radius: 5px;
  padding: 3px 8px;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
.vault-page .toast .toast-undo:hover {
  background: rgba(250, 204, 21, 0.1);
  border-color: rgba(250, 204, 21, 0.7);
}
.vault-page .toast .toast-dismiss {
  width: 22px; height: 22px;
  border-radius: 5px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid transparent;
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
}
.vault-page .toast .toast-dismiss:hover { color: var(--foreground); }
.vault-page .toast .toast-timer {
  position: absolute;
  left: 0; bottom: 0; height: 2px;
  background: var(--primary);
  opacity: 0.6;
  width: 100%;
  transform-origin: left center;
  animation: toast-timer 5000ms linear forwards;
}
.vault-page .toast.error .toast-timer { background: var(--destructive); }
@keyframes toast-timer {
  from { transform: scaleX(1); }
  to   { transform: scaleX(0); }
}

.vault-page .alias-main {
  font-family: var(--font-sans);
  font-weight: 500; font-size: 14px;
  color: var(--foreground);
}
/* Green "active" dot rendered before the alias on routing rows —
   visual parity with the CLI's ● indicator in aikey route. */
.vault-page .alias-main .active-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #4ade80;
  box-shadow: 0 0 6px rgba(74, 222, 128, 0.75);
  margin-right: 8px;
  vertical-align: middle;
  position: relative;
  top: -1px;
  flex-shrink: 0;
}
/* ── IN-USE chip (alias cell) ────────────────────────────────────────
   Replaces the earlier alias-in-use-dot green pip. Appears to the right
   of the alias on the currently-routing row, paired with the yellow
   accent on the whole tr.in-use. */
.vault-page .in-use-chip {
  /* Sized to match .row-use-btn (28px height) but with a wider
     horizontal padding + flex-shrink:0 + white-space:nowrap so the
     "IN USE" label never wraps to a second line when the actions
     column gets tight. */
  display: inline-flex; align-items: center; gap: 5px;
  height: 28px;
  padding: 0 12px;
  margin-right: 2px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  white-space: nowrap;
  flex-shrink: 0;
  border-radius: 6px;
  /* Sky-blue palette (#38bdf8 = rgb 56 189 248) — CLI's cyan "active
     routing" accent. Distinct from the yellow brand chrome so status
     reads as a separate axis from interactive chrome. */
  background: rgba(56, 189, 248, 0.14);
  color: #38bdf8;
  border: 1px solid rgba(56, 189, 248, 0.45);
  vertical-align: middle;
  position: relative;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
.vault-page .in-use-chip:hover {
  background: rgba(56, 189, 248, 0.28);
  border-color: rgba(56, 189, 248, 0.75);
}
.vault-page .in-use-chip:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.45);
}
.vault-page .in-use-chip::before {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 4px;
  border: 1px solid rgba(56, 189, 248, 0.6);
  animation: in-use-pulse 2.4s ease-out infinite;
  pointer-events: none;
}
@keyframes in-use-pulse {
  0%   { opacity: 0.7; transform: scale(1);    }
  70%  { opacity: 0;   transform: scale(1.15); }
  100% { opacity: 0;   transform: scale(1.15); }
}
.vault-page .alias-sub {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--muted-foreground);
  opacity: 0.75; margin-top: 1px;
}
.vault-page .alias-main.mono {
  font-family: var(--font-mono);
  font-size: 12.5px;
}

.vault-page .provider-cell {
  display: inline-flex; align-items: center; gap: 0.5rem;
  min-width: 0;
}
.vault-page .provider-cell .name {
  font-size: 13.5px; color: var(--muted-foreground);
}

.vault-page .row-actions {
  display: inline-flex; align-items: center; gap: 4px;
  opacity: 0.4; transition: opacity 150ms ease;
}
.vault-page .icon-btn {
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--muted-foreground);
  border: 1px solid transparent;
  background: transparent;
  transition: color 120ms ease, background 120ms ease, border-color 120ms ease;
  cursor: pointer;
}
.vault-page .icon-btn:hover:not(:disabled) {
  color: var(--foreground);
  background: var(--surface-1);
  border-color: var(--border);
}
.vault-page .icon-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.vault-page .icon-btn.primary:hover:not(:disabled) { color: var(--primary); border-color: rgba(250, 204, 21,0.4); }
.vault-page .icon-btn.danger:hover:not(:disabled)  { color: #fca5a5; background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.4); }

.vault-page .inline-input {
  background: rgba(0,0,0,0.5); border: 1px solid var(--primary);
  border-radius: var(--radius-sm); padding: 4px 8px;
  color: var(--foreground); font-family: var(--font-mono);
  font-size: 13px; outline: none;
  box-shadow: 0 0 0 2px rgba(250, 204, 21,0.15);
}

/* ---- Drawer ------------------------------------------------ */
.vault-page ~ .drawer-overlay,
.drawer-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 90;
  opacity: 0; pointer-events: none;
  transition: opacity 180ms ease;
}
.drawer-overlay[data-open="true"] { opacity: 1; pointer-events: auto; }

.drawer {
  position: fixed; top: 0; right: 0; bottom: 0;
  width: 460px; max-width: calc(100vw - 40px);
  background: var(--surface-2, #27272a);
  border-left: 1px solid var(--border);
  box-shadow: -20px 0 40px -10px rgba(0,0,0,0.6);
  z-index: 95;
  display: flex; flex-direction: column;
  transform: translateX(100%);
  transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
}
.drawer[data-open="true"] { transform: translateX(0); }

.drawer-head {
  padding: 18px 22px 14px;
  display: flex; align-items: flex-start; gap: 12px;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, rgba(250, 204, 21,0.04) 0%, transparent 100%);
}
.drawer-head .content { flex: 1; min-width: 0; }
.drawer-head .alias-title {
  font-family: var(--font-sans);
  font-size: 17px; font-weight: 600;
  color: var(--foreground);
  word-break: break-all;
}
.drawer-head .alias-title.mono { font-family: var(--font-mono); letter-spacing: -0.01em; }
.drawer-head .meta-row {
  display: flex; align-items: center; gap: 6px;
  margin-top: 8px; flex-wrap: wrap; font-size: 12px;
}
.drawer-head .provider-cell {
  display: inline-flex; align-items: center; gap: 0.5rem;
  min-width: 0;
}
.drawer-head .provider-cell .name { font-size: 12.5px; }
.drawer-head .prov-dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; flex-shrink: 0; }
.drawer-head .kind-pill {
  display: inline-flex; align-items: center;
  padding: 2px 6px;
  font-family: var(--font-mono);
  font-size: 9.5px; font-weight: 600;
  letter-spacing: 0.05em; text-transform: uppercase;
  border-radius: 3px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted-foreground);
}
.drawer-head .kind-pill.oauth {
  color: #c4b5fd;
  border-color: rgba(167,139,250,0.35);
  background: rgba(167,139,250,0.06);
}
.drawer-head .chip {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 3px 7px; font-size: 10.5px;
  font-family: var(--font-mono);
  border-radius: 4px;
  background: rgba(0,0,0,0.2);
  border: 1px solid var(--border);
  color: var(--muted-foreground);
}
.drawer-head .chip.success { color: #6ee7b7; background: rgba(74,222,128,0.08); border-color: rgba(74,222,128,0.3); }
.drawer-head .chip.danger { color: #fca5a5; background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.35); }
.drawer-head .status-dot {
  width: 6px; height: 6px; border-radius: 999px;
  background: #4ade80;
  box-shadow: 0 0 6px rgba(74, 222, 128, 0.7);
  flex-shrink: 0; display: inline-block;
}
.drawer-head .status-dot.error { background: #ef4444; box-shadow: 0 0 6px rgba(239,68,68,0.7); }

.drawer-close {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 6px;
  color: var(--muted-foreground);
  background: transparent; border: 1px solid transparent;
  cursor: pointer;
  transition: color 120ms ease, background 120ms ease, border-color 120ms ease;
  flex-shrink: 0;
}
.drawer-close:hover {
  color: var(--foreground);
  background: rgba(0,0,0,0.15);
  border-color: var(--border);
}

/* Drawer visual refresh aligned with user_vault_3_1_1.html (2026-04-24):
   more generous padding / taller fields / flat group rhythm, dedicated
   .drawer-tokenbox for the route-token wrap, .inline-copy ghost button,
   .drawer-actions CTA row with a primary-route highlight. Logic/handlers
   unchanged — this is pure visual polish per user request. */
.drawer-body {
  /* min-height: 0 is the flex-child scrolling escape hatch — without
     it a flex item defaults to min-height: auto which prevents it
     from shrinking below its content's intrinsic size, so overflow-y:
     auto never triggers and the tail of the content (including the
     Actions row with Route / Reveal / Rename / Delete) disappears
     below the viewport. User bug report 2026-04-24. */
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  /* Tightened padding / section gap 2026-04-24 in the same pass as
     .drawer-field — keeps the rhythm consistent when the whole drawer
     became more compact. */
  padding: 18px 24px 22px;
  color: var(--foreground);
  display: flex; flex-direction: column; gap: 22px;
}
.drawer-section { margin-bottom: 0; }
.drawer-section:last-child { margin-bottom: 0; }
.drawer-section-title {
  font-family: var(--font-mono);
  font-size: 11px; font-weight: 700;
  letter-spacing: 0.05em; text-transform: uppercase;
  color: var(--muted-foreground);
  margin-bottom: 10px;
  display: flex; align-items: center; gap: 8px;
  opacity: 0.78;
}
.drawer-section-title svg { opacity: 0.9; }

/* Flat group — fields stack with a 1px bottom rule separating them,
   no extra frame / background. Matches template .drawer-group. */
.drawer-group {
  display: flex; flex-direction: column;
}
.drawer-field {
  display: grid;
  grid-template-columns: 112px 1fr;
  gap: 6px 16px;
  /* Tightened 2026-04-24 (padding 13→9px, min-height 44→34px) so longer
     drawers fit without forcing a scroll, and the rows read more
     compact — the prior spacing made OAuth keys with lots of fields
     (Identity + Org + Tier + Meta + Actions) feel sparse. */
  padding: 9px 2px;
  /* Softer separator than the table / card frames use — these are
     intra-group dividers, not structural boundaries, so a mid-opacity
     tint reads as a rhythm marker rather than another hairline to
     compete with the drawer-head bottom rule (2026-04-24). */
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 14px;
  align-items: start;
  min-height: 38px;
}
.drawer-field:last-child { border-bottom: none; }
.drawer-field .k {
  font-family: var(--font-mono);
  color: var(--muted-foreground);
  letter-spacing: 0.2em;
  text-transform: uppercase;
  font-size: 11px;
  padding-top: 4px;
  opacity: 0.68;
}
.drawer-field .v {
  color: var(--foreground);
  word-break: break-word;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  min-width: 0;
  line-height: 1.45;
}
.drawer-field .v.stack {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}
.drawer-field .v .dim  { color: var(--muted-foreground); }
.drawer-field .v .mono { font-family: var(--font-mono); }
.drawer-field .v .truncate {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 100%;
}
.drawer-field .v .hint {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--muted-foreground);
  opacity: 0.62;
  letter-spacing: 0.05em;
  text-transform: lowercase;
}
.drawer-field .v .status-dot {
  width: 6px; height: 6px; border-radius: 999px;
  background: #4ade80;
  box-shadow: 0 0 6px rgba(74,222,128,0.7);
  display: inline-block;
}
.drawer-field .v .status-dot.error { background: #ef4444; box-shadow: 0 0 6px rgba(239,68,68,0.7); }

/* Status line (Meta section) — label coloured to match the dot. */
.drawer-field .status-line {
  display: inline-flex; align-items: center; gap: 8px;
}
.drawer-field .status-line .label { color: var(--success); font-weight: 500; }

/* Inline copy — ghost button for plain-text values (base_url, etc). */
.vault-page .inline-copy {
  color: var(--muted-foreground);
  background: transparent;
  border: none;
  padding: 3px;
  border-radius: 3px;
  cursor: pointer;
  display: inline-flex; align-items: center;
  opacity: 0.7;
  transition: opacity 120ms ease, color 120ms ease, background 120ms ease;
}
.vault-page .inline-copy:hover {
  color: var(--foreground);
  background: rgba(255,255,255,0.05);
  opacity: 1;
}

/* Route-token wrap box — free word-break, corner-anchored copy button.
   Replaces the earlier readonly <textarea>; a div renders the value more
   cleanly than a form element (no focus ring conflict w/ browser default,
   no double-scrollbar on long tokens, and obeys drawer typography). */
.vault-page .drawer-tokenbox {
  position: relative;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 11px 44px 32px 12px;
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--foreground);
  word-break: break-all;
  max-height: 96px;
  overflow-y: auto;
  width: 100%;
  line-height: 1.5;
  scrollbar-width: thin;
}
.vault-page .drawer-tokenbox::-webkit-scrollbar { width: 6px; }
.vault-page .drawer-tokenbox::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.12); border-radius: 3px;
}
.vault-page .drawer-tokenbox .copy-btn {
  position: absolute;
  bottom: 6px; right: 6px;
  width: 26px; height: 26px;
  color: var(--muted-foreground);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: color 120ms ease, background 120ms ease;
}
.vault-page .drawer-tokenbox .copy-btn:hover {
  background: rgba(255,255,255,0.06);
  color: var(--foreground);
}


/* Actions row — inline (not a sticky footer). Route is the primary CTA
   and spans the full first row; secondary actions share the second. */
.vault-page .drawer-actions {
  /* 2026-04-24 restructure: buttons constrained to 80% and centered,
     but the hint text between primary + secondary still spans 100% so
     the instructional copy (e.g. "Run claude in any terminal ...")
     can stretch without awkward wrapping inside a narrower column.
     Flex-column stacks the items; width constraints are applied to
     individual descendants (.primary-route, .drawer-actions-row)
     while .drawer-actions-hint stays at the default auto width
     (= full container). */
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.vault-page .drawer-actions .action-btn.primary-route {
  /* Override the base flex:1 1 140px: center-locked 80% column. */
  flex: 0 0 auto;
  width: 80%;
  align-self: center;
}
.vault-page .drawer-actions-row {
  display: flex;
  gap: 10px;
  width: 80%;
  align-self: center;
}
.vault-page .drawer-actions-row .action-btn {
  /* Inside the constrained 80% row, secondary buttons share space
     evenly (flex:1). Keeps Rename / Delete pairing even-width. */
  flex: 1 1 0;
  min-width: 0;
}
/* Usage hint under the Route CTA — claims the full row width so it
   breaks between the primary (full-width) Route button and the
   secondary-action row below. Mono font matches surrounding code
   references; inline "code" children get a subtle surface background
   so the copied command stands out from the sentence prose. */
.vault-page .drawer-actions-hint {
  flex-basis: 100%;
  display: inline-flex;
  align-items: flex-start;
  gap: 8px;
  margin: -2px 2px 2px 2px;
  font-family: var(--font-sans);
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--muted-foreground);
}
.vault-page .drawer-actions-hint svg {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--primary);
  opacity: 0.75;
}
.vault-page .drawer-actions-hint code {
  display: inline-block;
  padding: 1px 5px;
  font-size: 11.5px;
  color: var(--foreground);
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 3px;
  margin: 0 1px;
}
.vault-page .drawer-actions .action-btn {
  flex: 1 1 140px;
  min-width: 0;
  padding: 10px 14px;
  font-size: 12.5px;
  font-weight: 500;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  border-radius: 7px;
  background: rgba(255,255,255,0.025);
  border: 1px solid var(--border);
  color: var(--foreground);
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.vault-page .drawer-actions .action-btn:hover:not(:disabled) {
  background: rgba(255,255,255,0.06);
  border-color: rgba(255,255,255,0.15);
}
.vault-page .drawer-actions .action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.vault-page .drawer-actions .action-btn svg { opacity: 0.75; flex-shrink: 0; }
.vault-page .drawer-actions .action-btn:hover:not(:disabled) svg { opacity: 1; }

/* Primary — Route via this key. Warm-yellow glow theme.
   Sizing (width, flex, align-self) handled by the structural rule
   higher up (search for ".action-btn.primary-route { flex: 0 0 auto"). */
/* Both Activate (clickable) and Active (already in-shell) use the same
   muted yellow background — keeps the button tone consistent across states
   so the user reads the LABEL for state, not the color (2026-05-06).
   Only hover differs: clickable state lights up, in-use state stays flat. */
.vault-page .drawer-actions .action-btn.primary-route {
  background: rgba(250, 204, 21, 0.06);
  border-color: rgba(250, 204, 21, 0.35);
  color: var(--primary);
  font-weight: 600;
  box-shadow: none;
}
.vault-page .drawer-actions .action-btn.primary-route:hover:not(:disabled):not(.routing) {
  background: rgba(250, 204, 21, 0.12);
  border-color: rgba(250, 204, 21, 0.5);
}
.vault-page .drawer-actions .action-btn.primary-route.routing {
  cursor: default;
}
.vault-page .drawer-actions .action-btn.primary-route.routing:hover {
  background: rgba(250, 204, 21, 0.06);
  border-color: rgba(250, 204, 21, 0.35);
}
/* Danger — Delete. */
.vault-page .drawer-actions .action-btn.danger {
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.05);
  border-color: rgba(239, 68, 68, 0.25);
}
.vault-page .drawer-actions .action-btn.danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.14);
  color: #fecaca;
  border-color: rgba(239, 68, 68, 0.45);
}

.ro-pill {
  display: inline-flex; align-items: center;
  font-family: var(--font-mono);
  font-size: 9px; font-weight: 600;
  letter-spacing: 0.05em;
  padding: 1px 5px; border-radius: 2px;
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border);
  color: var(--muted-foreground);
  margin-left: 2px;
}

.secret-view {
  flex: 1; min-width: 0;
  /* Matches 3.1 template — uses the page background token so the
     secret chip reads as "sunken" relative to the drawer surface-2
     panel, not as a darker-than-panel overlay. */
  background: var(--background);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 7px 8px 7px 10px;
  display: flex; align-items: center; gap: 6px;
  font-family: var(--font-mono);
  font-size: 12px; overflow: hidden;
}
.secret-view .plain {
  flex: 1; min-width: 0;
  color: var(--foreground);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.secret-view .plain .prefix { color: #a5b4fc; }
.secret-view .plain .suffix { color: #fcd34d; }
.secret-view .plain .mid    { color: var(--foreground); letter-spacing: 0; }
.secret-view.masked .plain .mid {
  color: var(--muted-foreground); letter-spacing: 0.05em;
}
.secret-view .icon-btn {
  width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 3px;
  color: var(--muted-foreground);
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  transition: color 120ms ease, background 120ms ease, border-color 120ms ease;
}
.secret-view .icon-btn:hover:not(:disabled) {
  color: var(--foreground);
  background: rgba(255,255,255,0.04);
  border-color: var(--border);
}
.secret-view .icon-btn:disabled { opacity: 0.35; cursor: not-allowed; }

/* Drawer action buttons — same .btn system as the toolbar. */
.drawer-section .btn {
  display: inline-flex; align-items: center; gap: 0.35rem;
  font-weight: 600; border-radius: var(--radius-sm);
  border: 1px solid transparent; cursor: pointer;
  font-family: var(--font-mono);
  letter-spacing: 0.05em;
  transition: background 150ms ease, border-color 150ms ease, color 120ms ease;
}
.drawer-section .btn-outline {
  background: var(--surface-1, #1f1f23);
  color: var(--foreground);
  border-color: var(--border);
}
.drawer-section .btn-outline:hover:not(:disabled) {
  background: var(--surface-2, #27272a);
  border-color: var(--muted-foreground);
}
.drawer-section .btn-danger {
  background: rgba(239, 68, 68, 0.1); color: #fca5a5;
  border-color: rgba(239, 68, 68, 0.35);
}
.drawer-section .btn-danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.18); color: #fecaca;
  border-color: rgba(239, 68, 68, 0.55);
}
.drawer-section .btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* ---- Modal ------------------------------------------------- */
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.55);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 100;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; pointer-events: none;
  transition: opacity 180ms ease;
}
.modal-overlay[data-open="true"] { opacity: 1; pointer-events: auto; }
.modal-panel {
  width: 540px; max-width: calc(100vw - 40px);
  max-height: calc(100vh - 80px);
  background: var(--surface-2, #27272a);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: 0 30px 60px -20px rgba(0,0,0,0.6);
  display: flex; flex-direction: column;
  transform: translateY(8px);
  transition: transform 180ms ease;
}
.modal-overlay[data-open="true"] .modal-panel { transform: translateY(0); }
.modal-header, .modal-footer {
  padding: 14px 18px;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
}
.modal-header { border-bottom: 1px solid var(--border); }
.modal-footer {
  border-top: 1px solid var(--border);
  background: rgba(0,0,0,0.15);
  border-bottom-left-radius: var(--radius-md);
  border-bottom-right-radius: var(--radius-md);
}
.modal-body {
  padding: 16px 18px; overflow-y: auto;
  display: flex; flex-direction: column; gap: 0.9rem;
  color: var(--foreground);
}
.modal-body .form-row, .modal-panel-guided .page .form-row { display: flex; flex-direction: column; gap: 0.3rem; }
.modal-body .form-label, .modal-panel-guided .page .form-label {
  display: inline-flex; align-items: center; gap: 0.35rem;
  /* Aligned with table <th> style 2026-04-25: mono + bold +
     uppercase + muted-foreground. Previously too light (no explicit
     font-weight) which made labels blend into field values. */
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted-foreground);
}
.modal-body .form-help, .modal-panel-guided .page .form-help {
  font-size: 12px; color: var(--muted-foreground);
}
.modal-body .req, .modal-panel-guided .page .req { color: var(--destructive, #ef4444); }
.modal-body .field-input, .modal-panel-guided .page .field-input {
  background: var(--surface-1, #1f1f23);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--foreground);
  font-size: 12.5px; padding: 6px 10px;
  width: 100%;
}
.modal-body .field-input-wrap, .modal-panel-guided .page .field-input-wrap { position: relative; width: 100%; min-width: 0; display: block; }
.modal-body .field-input-has-reveal, .modal-panel-guided .page .field-input-has-reveal { padding-right: 30px !important; }
.modal-body .field-reveal-btn, .modal-panel-guided .page .field-reveal-btn {
  position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
  background: transparent; border: none; cursor: pointer; padding: 4px;
  color: var(--muted-foreground); display: inline-flex;
  align-items: center; justify-content: center; border-radius: 3px;
}
.modal-body .field-reveal-btn:hover, .modal-panel-guided .page .field-reveal-btn:hover { color: var(--foreground); background: rgba(255,255,255,0.04); }
.modal-body .field-reveal-btn:focus-visible, .modal-panel-guided .page .field-reveal-btn:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
.modal-body .field-input:focus, .modal-panel-guided .page .field-input:focus {
  outline: none; border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(250, 204, 21,0.15);
}
/* Validation-fail flash — red border + glow pulses twice over ~1s
   so the user's eye is drawn to the offending field even if they
   missed the inline error message. Class is auto-removed after 1.2s
   (timer in AddKeyModal). 2026-04-25. */
.modal-body .field-input.field-input-flash, .modal-panel-guided .page .field-input.field-input-flash {
  animation: modal-field-flash 0.5s ease-in-out 2;
  border-color: rgba(239, 68, 68, 0.8) !important;
}
.modal-body .field-input.field-input-flash:focus, .modal-panel-guided .page .field-input.field-input-flash:focus {
  border-color: rgba(239, 68, 68, 0.9) !important;
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2) !important;
}
@keyframes modal-field-flash {
  0%, 100% {
    background: var(--surface-1, #1f1f23);
    box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
  }
  50% {
    background: rgba(239, 68, 68, 0.08);
    box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.25);
  }
}
.modal-body .seg, .modal-panel-guided .page .seg {
  display: inline-flex; padding: 2px;
  background: var(--surface-1, #1f1f23); border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.modal-body .seg button, .modal-panel-guided .page .seg button {
  font-family: var(--font-mono);
  font-size: 10px; letter-spacing: 0.05em;
  padding: 3px 9px; border-radius: 3px;
  color: var(--muted-foreground);
  background: transparent; border: none; cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
}
.modal-body .seg button.active, .modal-panel-guided .page .seg button.active {
  background: var(--surface-2, #27272a); color: var(--foreground);
  box-shadow: inset 0 0 0 1px var(--border);
}
.modal-footer .btn {
  display: inline-flex; align-items: center; gap: 0.35rem;
  font-weight: 600; border-radius: var(--radius-sm);
  border: 1px solid transparent; cursor: pointer;
  font-family: var(--font-mono);
  letter-spacing: 0.05em;
}
.modal-footer .btn-primary {
  background: var(--primary); color: var(--primary-foreground);
  border-color: rgba(250, 204, 21, 0.55);
}
.modal-footer .btn-ghost { background: transparent; color: var(--muted-foreground); }
.modal-footer .btn-ghost:hover { color: var(--foreground); background: rgba(0,0,0,0.15); }

.modal-header .icon-btn {
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--muted-foreground);
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
}
.modal-header .icon-btn:hover {
  color: var(--foreground);
  background: rgba(0,0,0,0.15);
  border-color: var(--border);
}

/* ---- Empty-state panel -------------------------------------- */
/* Rendered when records.length === 0. Mirrors /user/virtual-keys'
   tk-empty card so both "no keys" states read as a visual family. */
.vault-page .vault-empty {
  flex: 1;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center;
  padding: 48px 32px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.vault-page .vault-empty-ring {
  width: 56px; height: 56px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 999px;
  background: rgba(0,0,0,0.25);
  border: 1px solid var(--border);
  color: var(--primary);
  margin-bottom: 14px;
  box-shadow: 0 0 0 6px rgba(250, 204, 21,0.04);
}
.vault-page .vault-empty-title {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--foreground);
  margin-bottom: 10px;
}
.vault-page .vault-empty-desc {
  font-size: 13px;
  line-height: 1.6;
  color: var(--muted-foreground);
  max-width: 420px;
}
.vault-page .vault-empty-link {
  font-family: var(--font-mono);
  color: var(--primary);
  font-size: 12.5px;
  text-decoration: none;
  border-bottom: 1px solid rgba(250, 204, 21,0.35);
  transition: border-color 150ms ease, color 150ms ease;
}
.vault-page .vault-empty-link:hover {
  color: #fde047;
  border-bottom-color: rgba(250, 204, 21,0.7);
}

/* Scrollbar polish — matches Overview v3.1. */
.vault-page ::-webkit-scrollbar { width: 10px; height: 10px; }
.vault-page ::-webkit-scrollbar-track { background: transparent; }
.vault-page ::-webkit-scrollbar-thumb {
  background: var(--surface-2);
  border: 2px solid var(--background);
  border-radius: 6px;
}
.vault-page ::-webkit-scrollbar-thumb:hover { background: var(--muted-foreground); }

/* ============================================================
   Add Key Guided flow (spec §17 visual contract)
   ============================================================
   Scoped under .modal-panel-guided so the existing 540px modal layout
   used by other dialogs is untouched. The Guided modal is wider (780px)
   to fit the left rail + page content + probe table grid.

   Why a sibling class instead of a data-attr on .modal-panel: existing
   styles already key off the bare class; piggy-backing on it via
   modifier keeps the cascade flat and easy to override.
*/
.modal-panel-guided {
  width: 780px !important;
}
.modal-panel-guided .modal-header-sub {
  /* "stored locally, never leaves device" trust ribbon — spec §13.1.
     mono uppercase 10px, dim color, NOT decorative — when this string
     is missing the user loses the local-first promise (spec §18.1). */
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted-foreground);
  margin-left: 6px;
}
.modal-panel-guided .mode-switch {
  display: inline-flex;
  padding: 2px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.modal-panel-guided .mode-switch button {
  border: 0;
  background: transparent;
  color: var(--muted-foreground);
  border-radius: 3px;
  padding: 4px 8px;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.modal-panel-guided .mode-switch button.active {
  background: var(--surface-2);
  color: var(--foreground);
  box-shadow: inset 0 0 0 1px var(--border);
}
.modal-panel-guided .header-controls {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

/* Body shell: 170px rail + page. simple-mode collapses to single column. */
.modal-panel-guided .body-shell {
  display: grid;
  grid-template-columns: 170px minmax(0, 1fr);
  min-height: 480px;
  overflow: hidden;
  flex: 1;
  min-height: 0;
}
.modal-panel-guided .body-shell.simple-mode {
  grid-template-columns: 1fr;
}
.modal-panel-guided .body-shell.simple-mode .rail {
  display: none;
}
.modal-panel-guided .rail {
  background: rgba(0, 0, 0, 0.14);
  border-right: 1px solid var(--border);
  padding: 18px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.modal-panel-guided .rail-kicker {
  color: var(--muted-foreground);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 3px;
}
.modal-panel-guided .step {
  display: grid;
  grid-template-columns: 24px 1fr;
  align-items: start;
  gap: 9px;
  padding: 9px 8px;
  border-radius: var(--radius-sm);
  color: var(--muted-foreground);
  border: 1px solid transparent;
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
  /* Buttonized rail: strip native <button> chrome but keep cursor + text alignment. */
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  width: 100%;
}
.modal-panel-guided .step:hover {
  background: rgba(255, 255, 255, 0.03);
}
.modal-panel-guided .step.active {
  color: var(--foreground);
  background: rgba(250, 204, 21, 0.07);
  border-color: rgba(250, 204, 21, 0.18);
}
.modal-panel-guided .step-num {
  width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 999px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  color: var(--muted-foreground);
}
.modal-panel-guided .step.active .step-num {
  color: var(--primary);
  border-color: rgba(250, 204, 21, 0.35);
  background: rgba(250, 204, 21, 0.1);
}
.modal-panel-guided .step-body strong {
  display: block;
  font-size: 12px;
  font-weight: 650;
  line-height: 1.2;
}
.modal-panel-guided .step-body span {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  line-height: 1.35;
  color: var(--muted-foreground);
}
.modal-panel-guided .rail-note {
  margin-top: auto;
  padding: 10px;
  border-radius: var(--radius-sm);
  background: var(--surface-1);
  border: 1px solid var(--border);
  color: var(--muted-foreground);
  font-size: 11px;
  line-height: 1.45;
}

/* Page transitions: spec §17.4 page-in 180ms fade-up. */
.modal-panel-guided .page {
  display: none;
  flex-direction: column;
  gap: 0.9rem;
  animation: ak-page-in 180ms ease-out both;
  padding: 16px 18px;
  overflow-y: auto;
  min-width: 0;
}
.modal-panel-guided .page.active {
  display: flex;
}
@keyframes ak-page-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.modal-panel-guided .page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}
.modal-panel-guided .page-title {
  margin: 0;
  font-size: 18px;
  line-height: 1.2;
  font-weight: 650;
  letter-spacing: -0.02em;
}
.modal-panel-guided .page-copy {
  margin: 5px 0 0;
  color: var(--muted-foreground);
  font-size: 12px;
  line-height: 1.5;
  max-width: 520px;
}
.modal-panel-guided .status-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  height: 26px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-1);
  color: var(--muted-foreground);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

/* Card / Connectivity summary — page 2 top block. */
.modal-panel-guided .card {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px;
}
.modal-panel-guided .card-label {
  display: flex; align-items: center; gap: 6px;
  color: var(--muted-foreground);
  font-family: var(--font-mono);
  font-size: 10px; font-weight: 700;
  letter-spacing: 0.05em; text-transform: uppercase;
  margin-bottom: 8px;
}
.modal-panel-guided .connectivity-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.modal-panel-guided .health-title {
  font-size: 14px;
  font-weight: 650;
  color: var(--muted-foreground);
  margin: 0;
}
.modal-panel-guided .health-title.good { color: var(--success); }
.modal-panel-guided .health-title.warn { color: var(--warning); }
.modal-panel-guided .health-title.bad  { color: var(--destructive, #ef4444); }
.modal-panel-guided .health-copy {
  margin: 6px 0 0;
  color: var(--muted-foreground);
  font-size: 12px;
  line-height: 1.42;
}

/* Probe table — 4 columns (Phase / Status / Latency / What it proves). */
.modal-panel-guided .probe-table {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--surface-1);
}
.modal-panel-guided .probe-head,
.modal-panel-guided .probe-row {
  display: grid;
  grid-template-columns: 1.15fr 0.75fr 1fr 1.35fr;
  align-items: center;
}
.modal-panel-guided .probe-head {
  background: rgba(0, 0, 0, 0.2);
  border-bottom: 1px solid var(--border);
  color: var(--muted-foreground);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.modal-panel-guided .probe-head > div,
.modal-panel-guided .probe-row > div {
  padding: 9px 11px;
  min-width: 0;
}
.modal-panel-guided .probe-row {
  border-bottom: 1px solid rgba(255,255,255,0.05);
  font-size: 12.5px;
  color: var(--foreground);
}
.modal-panel-guided .probe-row:last-child {
  border-bottom: 0;
}
.modal-panel-guided .probe-phase {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}
.modal-panel-guided .result-dot {
  width: 7px; height: 7px;
  border-radius: 999px;
  background: var(--muted-foreground);
  opacity: 0.7;
}
.modal-panel-guided .probe-row.good .result-dot {
  background: var(--success);
  box-shadow: 0 0 6px rgba(74, 222, 128, 0.55);
  opacity: 1;
}
.modal-panel-guided .probe-row.warn .result-dot {
  background: var(--warning);
  box-shadow: 0 0 6px rgba(250, 204, 21, 0.4);
  opacity: 1;
}
/* destructive red — spec §5.1 gap fix (4th row state for hard
   failures like 5xx / state mismatch / chat-stage rejection). */
.modal-panel-guided .probe-row.bad .result-dot {
  background: var(--destructive, #ef4444);
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.5);
  opacity: 1;
}
.modal-panel-guided .probe-table .mono {
  font-family: var(--font-mono);
  color: var(--muted-foreground);
  font-size: 11.5px;
}

/* Repair card — actionable guidance below probe table. */
.modal-panel-guided .repair {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  padding: 10px 11px;
  border-radius: var(--radius-sm);
  background: rgba(96, 165, 250, 0.06);
  border: 1px solid rgba(96, 165, 250, 0.22);
  color: var(--muted-foreground);
  font-size: 12px;
  line-height: 1.45;
}
.modal-panel-guided .repair.warn {
  background: rgba(250, 204, 21, 0.07);
  border-color: rgba(250, 204, 21, 0.25);
}
.modal-panel-guided .repair.bad {
  background: rgba(239, 68, 68, 0.07);
  border-color: rgba(239, 68, 68, 0.25);
}
.modal-panel-guided .repair.good {
  background: rgba(74, 222, 128, 0.05);
  border-color: rgba(74, 222, 128, 0.22);
}

/* Name strip — alias input + risk line on page 2. */
.modal-panel-guided .name-strip {
  display: grid;
  gap: 8px;
  padding: 12px;
  border-radius: var(--radius-md);
  background: rgba(0, 0, 0, 0.12);
  border: 1px solid var(--border);
}
.modal-panel-guided .risk-line {
  display: none;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  color: var(--warning);
  font-size: 11.5px;
}
.modal-panel-guided .risk-line.show {
  display: flex;
}

/* Trust ribbon — footer left side, mono uppercase. */
.modal-panel-guided .modal-footer .trust {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted-foreground);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.modal-panel-guided .modal-footer .trust svg {
  color: var(--success);
}

/* btn-outline + btn-sm/md — spec §17.1 button sizes. */
.modal-panel-guided .btn-outline {
  background: var(--surface-1);
  color: var(--foreground);
  border: 1px solid var(--border);
}
.modal-panel-guided .btn-outline:hover {
  background: var(--surface-2);
  border-color: var(--muted-foreground);
}
.modal-panel-guided .btn-sm {
  height: 30px;
  padding: 0 10px;
  font-size: 10.5px;
}
.modal-panel-guided .btn-md {
  height: 34px;
  padding: 0 13px;
  font-size: 11px;
}

/* Page-2 actions row: footer adds Back + Save next to Cancel. Save
   anyway keeps btn-primary class — spec §14.1 explicit: never demote
   to outline / grey, the user has actively chosen to save. */
.modal-panel-guided .modal-footer .actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* OAuth Broker Card (spec §6 + design HTML lines 1158-1217). Lives
   inside the Guided modal page 1 when kind = OAuth. The 3-step flow
   (provider / open auth / paste-or-wait) drives all three OAuth
   providers (claude setup_token / codex auth_code / kimi device_code)
   off the same component — see vault/index.tsx::OAuthBrokerCard. */
.modal-panel-guided .oauth-broker-card {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: var(--radius-md);
  background: rgba(0, 0, 0, 0.16);
  border: 1px solid var(--border);
}
.modal-panel-guided .oauth-flow-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.modal-panel-guided .oauth-flow-title strong {
  font-size: 12.5px;
  font-weight: 650;
  color: var(--foreground);
}
.modal-panel-guided .flow-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 23px;
  padding: 0 7px;
  border-radius: 999px;
  border: 1px solid rgba(250, 204, 21, 0.22);
  background: rgba(250, 204, 21, 0.07);
  color: var(--primary);
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  white-space: nowrap;
}
.modal-panel-guided .flow-steps {
  display: grid;
  gap: 9px;
}
.modal-panel-guided .flow-step {
  display: grid;
  grid-template-columns: 20px 1fr;
  gap: 8px;
  align-items: start;
  color: var(--muted-foreground);
  font-size: 12px;
  line-height: 1.4;
}
.modal-panel-guided .flow-step > span:first-child {
  width: 20px;
  height: 20px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--primary);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
}
.modal-panel-guided .flow-step-body {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.modal-panel-guided .flow-step-title {
  color: var(--foreground);
  font-size: 12px;
  font-weight: 650;
}
.modal-panel-guided .flow-step-control {
  display: grid;
  gap: 6px;
}
.modal-panel-guided .field-select {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--foreground);
  font-size: 12.5px;
  padding: 6px 10px;
  min-height: 35px;
}
.modal-panel-guided .inline-state {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted-foreground);
  font-size: 12px;
}
.modal-panel-guided .pulse {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  box-shadow: 0 0 0 4px rgba(250, 204, 21, 0.08);
}
.modal-panel-guided .oauth-code-input {
  display: none;
  gap: 8px;
  align-items: center;
}
.modal-panel-guided .oauth-code-input.show {
  display: grid;
  grid-template-columns: 1fr auto;
}
.modal-panel-guided .code-status {
  min-width: 96px;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  color: var(--muted-foreground);
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.modal-panel-guided .code-status.loading { color: var(--primary); }
.modal-panel-guided .code-status.success { color: var(--success); }
.modal-panel-guided .code-status.error   { color: var(--destructive, #ef4444); }
.modal-panel-guided .copy-auth-url {
  width: fit-content;
  color: var(--muted-foreground);
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.modal-panel-guided .copy-auth-url:hover { color: var(--primary); }

/* Responsive: spec §17.5 breakpoint 780px. Modal goes full-screen,
   rail becomes horizontal, probe-table hides 3rd + 4th columns. */
@media (max-width: 780px) {
  .modal-panel-guided {
    width: 100% !important;
    max-width: none;
    max-height: none;
    min-height: 100vh;
    border-radius: 0;
  }
  .modal-panel-guided .body-shell {
    grid-template-columns: 1fr;
  }
  .modal-panel-guided .rail {
    border-right: 0;
    border-bottom: 1px solid var(--border);
    flex-direction: row;
    overflow-x: auto;
  }
  .modal-panel-guided .rail-kicker,
  .modal-panel-guided .rail-note {
    display: none;
  }
  .modal-panel-guided .step {
    min-width: 190px;
  }
  .modal-panel-guided .probe-head,
  .modal-panel-guided .probe-row {
    grid-template-columns: 1fr 0.65fr;
  }
  .modal-panel-guided .probe-head > div:nth-child(3),
  .modal-panel-guided .probe-head > div:nth-child(4),
  .modal-panel-guided .probe-row > div:nth-child(3),
  .modal-panel-guided .probe-row > div:nth-child(4) {
    display: none;
  }
}
`;
