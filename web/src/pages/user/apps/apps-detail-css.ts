// Scoped page CSS for /user/apps/<slug>.
//
// Visual baseline (2026-05-23 flatten + align pass):
//   Aligned with /user/usage-ledger — same zinc-900/zinc-800/zinc-700
//   surface stack via the project's global `--background` / `--card` /
//   `--border` tokens. Earlier iterations used a custom oklch palette
//   that read "too dark" + "cards too busy" vs the rest of the app.
//
// All rules scoped under `.connected-app-page` so they don't leak into
// the global stylesheet. Where the design needs colors not in the
// project palette (chart bar/line accents, primary amber yellow), we
// hardcode the values inline — those are page-local accents, not
// candidates for promotion to global tokens.

export const APPS_DETAIL_CSS = `
.connected-app-page {
  --cap-token-bar:    #ca8a04;  /* dark amber, matches usage-ledger token bars */
  --cap-request-line: #71717a;  /* zinc-500, muted secondary signal */
}

.connected-app-page .cap-mono-label {
  color: var(--muted-foreground);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.connected-app-page .cap-surface {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
}

/* Inner sub-panel — used as a layout container WITHIN an outer
   cap-surface card. No border / no background so the outer card
   stays the only frame on screen, matching the usage-ledger pattern
   of "outer card, plain content inside". */
.connected-app-page .cap-surface-subtle {
  background: transparent;
  border: 0;
}

/* ── Hero ─────────────────────────────────────────────────────────── */

.connected-app-page .cap-hero {
  padding: 22px 18px;
}
.connected-app-page .cap-hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 20px;
  align-items: start;
}
.connected-app-page .cap-app-icon {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: var(--secondary);
  border: 1px solid var(--border);
  color: #ca8a04;
}

.connected-app-page .cap-chip {
  background: var(--secondary);
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--muted-foreground);
  font-family: var(--font-mono);
}
.connected-app-page .cap-chip-active {
  background: rgba(202, 138, 4, 0.12);
  border-color: rgba(202, 138, 4, 0.5);
  color: #ca8a04;
}

.connected-app-page .cap-btn {
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  font-family: var(--font-mono);
  transition: border-color 120ms ease, background 120ms ease, color 120ms ease, opacity 120ms ease;
}
.connected-app-page .cap-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.connected-app-page .cap-btn-primary {
  background: #ca8a04;
  border: 1px solid #ca8a04;
  color: #18181b;
}
.connected-app-page .cap-btn-secondary {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--foreground);
}
.connected-app-page .cap-btn-secondary:not(:disabled):hover {
  background: var(--secondary);
}
.connected-app-page .cap-btn-danger {
  background: transparent;
  border: 1px solid rgba(239, 68, 68, 0.5);
  color: #ef4444;
}
.connected-app-page .cap-btn-danger:not(:disabled):hover {
  background: rgba(239, 68, 68, 0.08);
}

/* ── Section header + body ────────────────────────────────────────── */

.connected-app-page .cap-section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px 10px;
}
.connected-app-page .cap-section-body {
  padding: 10px 18px 18px;
}

/* ── Callout (follow-user-active) ─────────────────────────────────── */

.connected-app-page .cap-callout {
  background: rgba(202, 138, 4, 0.07);
  border: 1px solid rgba(202, 138, 4, 0.32);
  border-radius: 6px;
}

/* ── Rows: binding / bearer / model ───────────────────────────────── */
/*
   No row borders / no row backgrounds — rows are visually grouped via
   whitespace gap inside the parent list, matching usage-ledger's
   "BY PROTOCOL" + "USAGE BY KEY" pattern. The outer card frame is the
   only border the user sees in this section.
*/

.connected-app-page .cap-row {
  display: grid;
  align-items: center;
  gap: 14px;
  padding: 8px 0;
}
.connected-app-page .cap-row + .cap-row {
  border-top: 1px solid var(--border);
}
.connected-app-page .cap-row-binding {
  grid-template-columns: 190px minmax(0, 1fr) auto;
}
.connected-app-page .cap-row-bearer {
  grid-template-columns: minmax(0, 1fr) auto;
}
.connected-app-page .cap-row-model {
  grid-template-columns: minmax(0, 1fr) auto;
}

/* ── Usage section ────────────────────────────────────────────────── */

.connected-app-page .cap-metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  margin-bottom: 16px;
}
/* Metrics are columns inside the section, NOT mini-cards. Vertical
   divider lines (border-right) separate them without adding 4 nested
   frames inside the §B Usage card. First / last metric drop the
   outer padding-side so the row reads flush with the section body. */
.connected-app-page .cap-metric-card {
  padding: 4px 18px;
  border-right: 1px solid var(--border);
}
.connected-app-page .cap-metric-card:first-child {
  padding-left: 0;
}
.connected-app-page .cap-metric-card:last-child {
  padding-right: 0;
  border-right: 0;
}

.connected-app-page .cap-usage-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(260px, 0.8fr);
  gap: 24px;
}
/* Vertical divider between chart (left) and top-models (right) — both
   sub-panels lost their own borders to keep the chrome minimal; this
   single 1px line carries the visual separation. */
.connected-app-page .cap-usage-grid > :first-child {
  border-right: 1px solid var(--border);
  padding-right: 24px;
}
@media (max-width: 1180px) {
  .connected-app-page .cap-usage-grid > :first-child {
    border-right: 0;
    border-bottom: 1px solid var(--border);
    padding-right: 0;
    padding-bottom: 16px;
  }
}

.connected-app-page .cap-chart-card,
.connected-app-page .cap-models-card {
  padding: 0;
}

.connected-app-page .cap-chart-wrap {
  position: relative;
  height: 240px;
  margin-top: 10px;
}

.connected-app-page .cap-model-meter {
  height: 4px;
  margin-top: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--secondary);
}
.connected-app-page .cap-model-meter > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #ca8a04;
}

/* ── Audit placeholder ────────────────────────────────────────────── */

/* Same chrome as cap-surface so the Audit Log placeholder doesn't
   visually stand out as a different sub-system — it's just an empty
   section, not a special call-to-action. */
.connected-app-page .cap-audit-placeholder {
  padding: 18px;
  color: var(--muted-foreground);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
}

/* ── Responsive ───────────────────────────────────────────────────── */

@media (max-width: 1180px) {
  .connected-app-page .cap-hero-grid {
    grid-template-columns: 1fr;
  }
  .connected-app-page .cap-action-row {
    justify-content: flex-start !important;
  }
  .connected-app-page .cap-metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .connected-app-page .cap-usage-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .connected-app-page .cap-metric-grid {
    grid-template-columns: 1fr;
  }
  .connected-app-page .cap-row-binding {
    grid-template-columns: minmax(0, 1fr);
  }
}
`;
