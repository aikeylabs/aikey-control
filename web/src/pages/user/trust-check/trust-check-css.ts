// Page-scoped CSS for /user/trust-check.
//
// All rules scoped under .trust-check-page (the wrapper className) — this
// keeps the page visually self-contained while reusing the global tokens
// (`--primary`, `--background`, `--card`, `--muted-foreground`, `--border`,
// `--destructive`, `--warning`, `--success`-equivalent) defined in
// src/index.css. We deliberately do NOT redefine those tokens here;
// adding new colors would violate the "ui-redesign-feature-and-visual-
// consistency" principle ("不能即兴定样式").
//
// The visual reference is
// `.superdesign/design_iterations/degrade_detector_web_1_2_1_1_1.html`
// (dark amber theme, lucide-style icons, Inter / JetBrains Mono fonts).
// Tokens in that template used a `--dd-*` prefix; here we map them to
// aikey-control's pre-existing `--*` equivalents one-to-one to avoid
// introducing a parallel design language:
//
//   --dd-primary           → --primary           (#facc15)
//   --dd-background        → --background        (#18181b)
//   --dd-foreground        → --foreground        (#f4f4f5)
//   --dd-card              → --card              (#27272a)
//   --dd-muted-foreground  → --muted-foreground  (#a1a1aa)
//   --dd-border            → --border            (#3f3f46)
//   --dd-success           → #4ade80   (KEYS_PAGE_CSS already uses this hex)
//   --dd-warning           → --warning           (#f97316)
//   --dd-info              → #60a5fa   (KEYS_PAGE_CSS already uses this hex)
//   --dd-suspect           → --warning           (alias)
//   --dd-risk              → --destructive       (#ef4444)
//
// trust-check-specific extras live as scoped declarations under
// .trust-check-page below.

export const TRUST_CHECK_CSS = `
.trust-check-page {
  /* Page-local palette aliases — pure indirection over global tokens
     so the JSX/class names read intent ("trusted" / "suspect" / "risky")
     not raw color names. */
  --tc-trust: #4ade80;
  --tc-suspect: var(--warning);
  --tc-risk: var(--destructive);
  --tc-info: #60a5fa;

  padding: 24px;
  color: var(--foreground);
  font-family: var(--font-sans, Inter, system-ui, sans-serif);
}

/* ── Header ────────────────────────────────────────────────── */

.trust-check-page .tc-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 20px;
}
.trust-check-page .tc-title {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: 0.02em;
  margin: 0;
}
.trust-check-page .tc-subtitle {
  font-size: 12px;
  font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
  color: var(--muted-foreground);
  opacity: 0.75;
  margin-top: 4px;
}
.trust-check-page .tc-header-actions {
  display: flex;
  gap: 8px;
}

/* ── Buttons (small, mono-typeset to match the template look) ───── */

.trust-check-page .tc-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  background: #1f1f23;
  border: 1px solid var(--border);
  color: var(--foreground);
  font-size: 12px;
  font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
.trust-check-page .tc-btn:hover:not(:disabled) {
  background: #27272a;
  border-color: var(--muted-foreground);
}
.trust-check-page .tc-btn-primary {
  background: var(--primary);
  color: var(--primary-foreground, #18181b);
  border-color: rgba(250, 204, 21, 0.55);
}
.trust-check-page .tc-btn-primary:hover:not(:disabled) {
  background: #fde047;
}
.trust-check-page .tc-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Metric cards ──────────────────────────────────────────── */

.trust-check-page .tc-metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}
@media (max-width: 1024px) {
  .trust-check-page .tc-metrics { grid-template-columns: repeat(2, 1fr); }
}
.trust-check-page .tc-metric {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px 18px;
  position: relative;
  overflow: hidden;
}
.trust-check-page .tc-metric::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 2px;
  background: var(--metric-color, var(--primary));
  opacity: 0.7;
}
.trust-check-page .tc-metric-label {
  font-size: 11px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted-foreground);
  opacity: 0.65;
  margin-bottom: 6px;
}
.trust-check-page .tc-metric-value {
  font-size: 30px;
  font-weight: 800;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: var(--foreground);
  line-height: 1;
}
.trust-check-page .tc-metric-note {
  margin-top: 6px;
  font-size: 11px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: var(--muted-foreground);
  opacity: 0.7;
}

/* ── Table panel ───────────────────────────────────────────── */

.trust-check-page .tc-panel {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.trust-check-page .tc-panel-header {
  padding: 16px 18px 12px;
  border-bottom: 1px solid var(--border);
}

/* tabs row */
.trust-check-page .tc-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
}
.trust-check-page .tc-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--muted-foreground);
  font-size: 11px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-weight: 700;
  letter-spacing: 0.08em;
  cursor: pointer;
}
.trust-check-page .tc-tab-btn.active {
  background: rgba(250, 204, 21, 0.10);
  color: var(--primary);
  border-color: rgba(250, 204, 21, 0.35);
}
.trust-check-page .tc-tab-hint {
  font-size: 11px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: var(--muted-foreground);
  opacity: 0.55;
  margin-left: 10px;
}

/* filter chips */
.trust-check-page .tc-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.trust-check-page .tc-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 999px;
  background: #1f1f23;
  border: 1px solid var(--border);
  color: var(--muted-foreground);
  font-size: 11px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  cursor: pointer;
}
.trust-check-page .tc-chip.active {
  background: rgba(250, 204, 21, 0.12);
  color: var(--primary);
  border-color: rgba(250, 204, 21, 0.35);
}

/* search row */
.trust-check-page .tc-search-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.trust-check-page .tc-search {
  flex: 1;
  min-width: 200px;
  padding: 8px 12px;
  border-radius: 6px;
  background: #1f1f23;
  border: 1px solid var(--border);
  color: var(--foreground);
  font-size: 13px;
  font-family: var(--font-sans, Inter, sans-serif);
}
.trust-check-page .tc-select-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  background: #1f1f23;
  border: 1px solid var(--border);
  color: var(--muted-foreground);
  font-size: 11px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
}

/* table */
.trust-check-page .tc-table-scroll { overflow-x: auto; }
.trust-check-page .tc-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.trust-check-page .tc-table th {
  text-align: left;
  font-size: 11px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted-foreground);
  opacity: 0.65;
  padding: 12px 18px;
  background: #1c1c1f;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.trust-check-page .tc-table td {
  padding: 12px 18px;
  vertical-align: middle;
  border-bottom: 1px solid rgba(63, 63, 70, 0.5);
}
.trust-check-page .tc-table tr.selected td { background: rgba(250, 204, 21, 0.04); }
.trust-check-page .tc-table tr:hover td { background: rgba(63, 63, 70, 0.18); }

/* id stack — primary line bold + secondary mono line */
.trust-check-page .tc-id {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.trust-check-page .tc-id-primary {
  font-weight: 700;
  color: var(--foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
}
.trust-check-page .tc-id-secondary {
  font-size: 11px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: var(--muted-foreground);
  opacity: 0.65;
}

/* status pill + score bar */
.trust-check-page .tc-score-wrap { display: flex; flex-direction: column; gap: 4px; min-width: 130px; }
.trust-check-page .tc-score-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-weight: 700;
}
.trust-check-page .tc-score-head > span:first-child { font-size: 16px; color: var(--foreground); }
.trust-check-page .tc-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.trust-check-page .tc-pill-trust  { background: rgba(74, 222, 128, 0.15); color: var(--tc-trust); }
.trust-check-page .tc-pill-suspect{ background: rgba(249, 115, 22, 0.15); color: var(--tc-suspect); }
.trust-check-page .tc-pill-risk   { background: rgba(239, 68, 68, 0.15);  color: var(--tc-risk); }
.trust-check-page .tc-pill-info   { background: rgba(96, 165, 250, 0.15); color: var(--tc-info); }

.trust-check-page .tc-score-bar {
  height: 4px;
  border-radius: 999px;
  background: rgba(63, 63, 70, 0.6);
  overflow: hidden;
  position: relative;
}
.trust-check-page .tc-score-fill {
  height: 100%;
  width: var(--score, 0%);
  background: linear-gradient(90deg, var(--tc-risk), var(--tc-suspect) 50%, var(--tc-trust) 100%);
  border-radius: inherit;
}
.trust-check-page .tc-mono {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 12px;
  color: var(--muted-foreground);
}

/* status running indicator */
.trust-check-page .tc-status-running {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(250, 204, 21, 0.12);
  border: 1px solid rgba(250, 204, 21, 0.35);
  font-size: 11px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: var(--primary);
}
.trust-check-page .tc-spin-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary);
  box-shadow: 0 0 8px rgba(250, 204, 21, 0.55);
  animation: tc-spin-pulse 1.2s ease-in-out infinite;
}
.trust-check-page .tc-spin-dot-lg {
  width: 14px;
  height: 14px;
  display: inline-block;
}
@keyframes tc-spin-pulse {
  0%, 100% { opacity: 0.45; }
  50%      { opacity: 1; }
}

/* ── Banner (offline) + Empty/Loading state ────────────────────── */

.trust-check-page .tc-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--card);
  font-size: 12px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: var(--foreground);
  margin-bottom: 16px;
}
.trust-check-page .tc-banner code {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(250, 204, 21, 0.10);
  color: var(--primary);
}
.trust-check-page .tc-banner-offline {
  border-color: rgba(239, 68, 68, 0.55);
  background: rgba(239, 68, 68, 0.08);
}
.trust-check-page .tc-banner-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--tc-risk);
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.65);
  margin-top: 5px;
  flex-shrink: 0;
  animation: tc-spin-pulse 1.5s ease-in-out infinite;
}

.trust-check-page .tc-empty {
  padding: 36px 18px;
  text-align: center;
  color: var(--muted-foreground);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.trust-check-page .tc-empty-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--foreground);
}
.trust-check-page .tc-empty-note {
  font-size: 11px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  opacity: 0.75;
  max-width: 480px;
}

/* ── Verify action cell (button + error chip stacked) ─────────── */

.trust-check-page .tc-action-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
}
.trust-check-page .tc-err-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-weight: 600;
  letter-spacing: 0.04em;
  /* Truncate long messages — full text is in title attribute. */
  max-width: 140px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.trust-check-page .tc-err-rate-limited {
  background: rgba(96, 165, 250, 0.15);
  color: var(--tc-info);
}
.trust-check-page .tc-err-fail {
  background: rgba(239, 68, 68, 0.15);
  color: var(--tc-risk);
}
.trust-check-page .tc-err-inconclusive {
  background: rgba(249, 115, 22, 0.15);
  color: var(--tc-suspect);
}
.trust-check-page .tc-err-generic {
  background: rgba(239, 68, 68, 0.15);
  color: var(--tc-risk);
}

/* ── Clickable row (Day 4) ─────────────────────────────────────── */

.trust-check-page .tc-row-clickable { cursor: pointer; }

/* ── BAND view sections (Day 4) ────────────────────────────────── */

.trust-check-page .tc-band-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 12px 0;
}
.trust-check-page .tc-band-section {
  border-top: 1px solid var(--border);
}
.trust-check-page .tc-band-section:first-child { border-top: none; }
.trust-check-page .tc-band-section-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px 6px;
  background: #1c1c1f;
}
.trust-check-page .tc-band-section-count {
  font-size: 11px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: var(--muted-foreground);
  opacity: 0.7;
}

/* ── Drawer (Day 4) ───────────────────────────────────────────── */

.trust-check-page .tc-drawer-dimmer {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  /* Below the drawer but above page chrome. */
  z-index: 40;
  animation: tc-fade-in 120ms ease forwards;
}
.trust-check-page .tc-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(520px, 100vw);
  background: var(--card);
  border-left: 1px solid var(--border);
  z-index: 41;
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.35);
  animation: tc-slide-in 160ms ease forwards;
}
@keyframes tc-fade-in {
  from { opacity: 0; } to { opacity: 1; }
}
@keyframes tc-slide-in {
  from { transform: translateX(100%); } to { transform: translateX(0); }
}
.trust-check-page .tc-drawer-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 18px 22px;
  border-bottom: 1px solid var(--border);
  background: #1c1c1f;
}
.trust-check-page .tc-drawer-eyebrow {
  font-size: 11px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted-foreground);
  opacity: 0.6;
  margin-bottom: 4px;
}
.trust-check-page .tc-drawer-title {
  font-size: 16px;
  margin: 0;
  font-weight: 700;
  word-break: break-all;
}
.trust-check-page .tc-drawer-close {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted-foreground);
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
}
.trust-check-page .tc-drawer-close:hover {
  color: var(--foreground);
  background: rgba(63, 63, 70, 0.4);
}
.trust-check-page .tc-drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}
.trust-check-page .tc-drawer-section {
  padding: 18px 22px;
  border-bottom: 1px solid rgba(63, 63, 70, 0.5);
}
.trust-check-page .tc-drawer-section-title {
  font-size: 11px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted-foreground);
  opacity: 0.7;
  margin: 0 0 12px;
}
.trust-check-page .tc-drawer-section-count {
  opacity: 0.55;
  margin-left: 4px;
}
.trust-check-page .tc-drawer-empty {
  font-size: 12px;
  color: var(--muted-foreground);
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
}

/* sub-scores grid */
.trust-check-page .tc-subscores {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 12px;
}
.trust-check-page .tc-subscore {
  background: #1f1f23;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px;
  text-align: center;
}
.trust-check-page .tc-subscore.highlight {
  border-color: rgba(250, 204, 21, 0.45);
  background: rgba(250, 204, 21, 0.06);
}
.trust-check-page .tc-subscore-label {
  font-size: 10px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted-foreground);
  opacity: 0.7;
}
.trust-check-page .tc-subscore-value {
  font-size: 22px;
  font-weight: 800;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  margin: 4px 0;
}
.trust-check-page .tc-subscore-hint {
  font-size: 10px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: var(--muted-foreground);
  opacity: 0.6;
}
.trust-check-page .tc-drawer-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 11px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: var(--muted-foreground);
  opacity: 0.8;
}
.trust-check-page .tc-drawer-meta code {
  background: rgba(250, 204, 21, 0.08);
  color: var(--primary);
  padding: 1px 5px;
  border-radius: 4px;
}

/* cascade history list */
.trust-check-page .tc-history {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.trust-check-page .tc-history-row {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #1f1f23;
  overflow: hidden;
}
.trust-check-page .tc-history-row.expanded { border-color: rgba(250, 204, 21, 0.35); }
.trust-check-page .tc-history-row-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: transparent;
  border: 0;
  color: var(--foreground);
  cursor: pointer;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
}
.trust-check-page .tc-history-row-head:hover { background: rgba(63, 63, 70, 0.4); }
.trust-check-page .tc-history-row-id {
  margin-left: auto;
  font-size: 11px;
  color: var(--muted-foreground);
  opacity: 0.7;
}
.trust-check-page .tc-history-detail {
  padding: 8px 12px 12px;
  font-size: 12px;
  border-top: 1px solid var(--border);
  background: rgba(0, 0, 0, 0.18);
}
.trust-check-page .tc-history-error {
  color: var(--tc-risk);
  margin-bottom: 6px;
}
.trust-check-page .tc-history-detail-note {
  color: var(--muted-foreground);
  opacity: 0.7;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 11px;
}

/* signals dl */
.trust-check-page .tc-signals {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
}
.trust-check-page .tc-signals-row {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 12px;
  align-items: baseline;
  font-size: 12px;
}
.trust-check-page .tc-signals-row dt {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: var(--muted-foreground);
  opacity: 0.7;
}
.trust-check-page .tc-signals-row dd {
  margin: 0;
  word-break: break-all;
}
.trust-check-page .tc-signals-row dd code {
  font-size: 11px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  background: rgba(96, 165, 250, 0.10);
  color: var(--tc-info);
  padding: 1px 5px;
  border-radius: 4px;
  display: inline-block;
}

/* ── Inline scoring detail (Day 5) ────────────────────────────── */

.trust-check-page .tc-history-detail-loading {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: var(--muted-foreground);
}
.trust-check-page .tc-scoring-detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.trust-check-page .tc-scoring-questions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.trust-check-page .tc-scoring-question {
  background: #18181b;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
}
.trust-check-page .tc-scoring-question-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 11px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: var(--muted-foreground);
}
.trust-check-page .tc-scoring-question-head code {
  background: rgba(250, 204, 21, 0.10);
  color: var(--primary);
  padding: 1px 5px;
  border-radius: 4px;
}
.trust-check-page .tc-scoring-q-score {
  margin-left: auto;
  padding: 1px 8px;
  border-radius: 999px;
  background: rgba(96, 165, 250, 0.15);
  color: var(--tc-info);
  font-weight: 600;
}
.trust-check-page .tc-scoring-q-text {
  font-size: 12px;
  color: var(--foreground);
  margin-bottom: 4px;
  white-space: pre-wrap;
}
.trust-check-page .tc-scoring-a-text {
  font-size: 12px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: var(--muted-foreground);
  white-space: pre-wrap;
}
.trust-check-page .tc-scoring-a-label {
  color: var(--tc-info);
  margin-right: 6px;
  font-weight: 700;
}
.trust-check-page .tc-scoring-raw {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.25);
}
.trust-check-page .tc-scoring-raw summary {
  cursor: pointer;
  padding: 6px 10px;
  font-size: 11px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: var(--muted-foreground);
}
.trust-check-page .tc-scoring-raw pre {
  margin: 0;
  padding: 8px 10px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  color: var(--muted-foreground);
  overflow-x: auto;
  max-height: 240px;
}
`;
