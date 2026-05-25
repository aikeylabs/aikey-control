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
  /* Uses --display-foreground (warm off-white) — shared with sidebar
     brand, topbar breadcrumb, all page H1s. Single source of truth in
     index.css. Avoids inheriting the pure-white --foreground that
     reads as "billboard" against the dark surface. */
  color: var(--display-foreground);
}
.trust-check-page .tc-subtitle {
  font-size: 12px;
  font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
  color: var(--muted-foreground);
  opacity: 0.75;
  margin-top: 4px;
}
.trust-check-page .tc-header-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
}
.trust-check-page .tc-header-title .tc-subtitle {
  flex-basis: 100%;
}
.trust-check-page .tc-observer-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 700;
  user-select: none;
}
.trust-check-page .tc-observer-on {
  background: rgba(74, 222, 128, 0.10);
  border: 1px solid rgba(74, 222, 128, 0.35);
  color: var(--tc-trust);
}
.trust-check-page .tc-observer-off {
  background: rgba(161, 161, 170, 0.10);
  border: 1px solid rgba(161, 161, 170, 0.35);
  color: var(--muted-foreground);
}
.trust-check-page .tc-observer-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.trust-check-page .tc-observer-on .tc-observer-dot {
  animation: tc-pulse 1.8s ease-in-out infinite;
  box-shadow: 0 0 0 0 currentColor;
}
@keyframes tc-pulse {
  0%, 100% { box-shadow: 0 0 0 0 currentColor; opacity: 1; }
  50%      { box-shadow: 0 0 0 4px transparent; opacity: 0.6; }
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
  /* Default = dim amber (--primary-dim #ca8a04, single source of truth
     in index.css), hover = bright amber (--primary #facc15). Creates
     a "rests at dim, lights up on interaction" depth instead of the
     previous always-loud bright-yellow that visually screamed even at
     rest. Matches the dim-amber treatment on /user/invites + topbar
     divider. */
  background: var(--primary-dim);
  color: var(--primary-foreground, #18181b);
  border-color: rgba(202, 138, 4, 0.55);
}
.trust-check-page .tc-btn-primary:hover:not(:disabled) {
  background: var(--primary);
  border-color: rgba(250, 204, 21, 0.7);
}
.trust-check-page .tc-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Real-time detection toggle (2026-05-23, top-right header) ──
   Switch-style control: track + sliding knob + adjacent label. ON
   uses --primary-dim amber to match the page's accent; OFF uses a
   neutral grey track so the default-off state reads as "calm" not
   "broken." */
.trust-check-page .tc-realtime-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 6px 8px;
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
.trust-check-page .tc-realtime-toggle:hover:not(:disabled) {
  background: #27272a;
  border-color: var(--muted-foreground);
}
.trust-check-page .tc-realtime-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.trust-check-page .tc-realtime-toggle-track {
  position: relative;
  display: inline-block;
  width: 28px;
  height: 16px;
  background: #3f3f46;
  border-radius: 999px;
  flex-shrink: 0;
  transition: background 140ms ease;
}
.trust-check-page .tc-realtime-toggle.on .tc-realtime-toggle-track {
  background: var(--primary-dim);
}
.trust-check-page .tc-realtime-toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  background: var(--foreground);
  border-radius: 50%;
  transition: transform 140ms ease;
}
.trust-check-page .tc-realtime-toggle.on .tc-realtime-toggle-knob {
  transform: translateX(12px);
  background: var(--primary-foreground, #18181b);
}
.trust-check-page .tc-realtime-toggle-label {
  font-size: 11px;
  letter-spacing: 0.06em;
  white-space: nowrap;
}
.trust-check-page .tc-realtime-toggle.off .tc-realtime-toggle-label {
  color: var(--muted-foreground);
  opacity: 0.85;
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
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: #1f1f23;
  border: 1px solid var(--border);
  color: var(--muted-foreground);
  font-size: 11px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  cursor: pointer;
}
/* Stage 7 (2026-05-22): template ".filter-chip" leading dot. The dot
 * tracks chip state (muted when inactive, primary when active) so the
 * chip's visual weight scales with selection. */
.trust-check-page .tc-chip::before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--muted-foreground);
  opacity: 0.45;
  transition: background-color 0.12s ease, opacity 0.12s ease;
}
.trust-check-page .tc-chip.active {
  background: rgba(250, 204, 21, 0.12);
  color: var(--primary);
  border-color: rgba(250, 204, 21, 0.35);
}
.trust-check-page .tc-chip.active::before {
  background: var(--primary);
  opacity: 1;
}
/* Clear-button chip is purely a visual exit, no dot. */
.trust-check-page .tc-chip-clear::before { display: none; }
.trust-check-page .tc-chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.trust-check-page .tc-chip-clear {
  /* Subtler than the toggleable chips; visual "exit" action. */
  background: transparent;
  color: var(--muted-foreground);
  border-style: dashed;
}
.trust-check-page .tc-chip-clear:hover {
  color: var(--foreground);
  border-color: var(--muted-foreground);
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

/* weakest-layer subtitle — surfaces the L? <80 signal the headline
   harmonic-mean score hides. Set in table.tsx when any single layer
   falls below the trust band (<80). See derive.ts::summaryToRow for
   the layer selection logic. */
.trust-check-page .tc-score-weakest {
  margin-top: 4px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 11px;
  font-weight: 500;
  color: var(--tc-suspect, #f59e0b);
  letter-spacing: 0.02em;
  cursor: help;
}
.trust-check-page .tc-score-weakest-icon {
  font-size: 12px;
  line-height: 1;
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
/* Rotating ring spinner (2026-05-23) — replaces the previous pulse-dot
   that was misnamed "spin-dot" but only animated opacity, not rotation.
   Same CSS pattern as keys-page-css.ts .aikey-spinner (proven to behave
   identically in live + screenshot/recording capture, unlike SMIL): a
   ring with one quadrant highlighted in --primary, spinning 360° in
   0.9s linear infinite. Sized 12x12 (lg=18x18) since a ring needs more
   pixels than a dot to read clearly. */
.trust-check-page .tc-spin-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid rgba(244, 244, 245, 0.15);
  border-top-color: var(--primary);
  display: inline-block;
  box-sizing: border-box;
  flex-shrink: 0;
  animation: tc-spin 0.9s linear infinite;
  will-change: transform;
}
.trust-check-page .tc-spin-dot-lg {
  width: 18px;
  height: 18px;
  border-width: 2.5px;
}
@keyframes tc-spin {
  to { transform: rotate(360deg); }
}
/* Reusable rotation utility for SVG icons that need to spin (e.g.
   <SpinDotInline /> in icons.tsx — the lucide loader-2 arc inside
   the "Checking" button). The SVG is static-shape by default; this
   class drives the same 0.9s linear spin used by .tc-spin-dot. */
.trust-check-page .tc-spin-svg {
  animation: tc-spin 0.9s linear infinite;
  transform-origin: center;
  will-change: transform;
}
/* Kept for .tc-banner-dot — the red error-indicator pulse below is a
   DIFFERENT pattern (attention-grabbing alert dot, not a loader) and
   genuinely wants opacity pulse rather than rotation. */
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
/* When the banner needs to fit both the explanation AND a Start
   button, switch to a 3-column flex (dot | body fills | action). */
.trust-check-page .tc-banner-body {
  flex: 1;
}
.trust-check-page .tc-banner-action {
  flex-shrink: 0;
  align-self: center;
}
.trust-check-page .tc-banner-err {
  color: var(--destructive);
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
.trust-check-page .tc-empty-link {
  background: transparent;
  border: 0;
  padding: 0;
  color: var(--primary);
  font-family: inherit;
  font-size: inherit;
  text-decoration: underline;
  cursor: pointer;
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
.trust-check-page .tc-err-error {
  /* Distinct from 'fail': same red intent but with a yellow accent ring
   * to signal "upstream/config issue, retry may help". Stage 2.6 added
   * status='error' for UPSTREAM_429 / MISSING_APP_KEY etc. */
  background: rgba(239, 68, 68, 0.15);
  color: var(--tc-risk);
  box-shadow: inset 0 0 0 1px rgba(250, 204, 21, 0.45);
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
  /* Every card carries a 'description' title tooltip explaining the
     detection method + scoring formula + how to read the number. The
     help cursor signals "hover for explanation" on all cards, not
     only the empty ones. */
  cursor: help;
}
.trust-check-page .tc-subscore.highlight {
  border-color: rgba(250, 204, 21, 0.45);
  background: rgba(250, 204, 21, 0.06);
}
/* "missing" = value is null. Hatch pattern signals "intentionally
   empty, hover for why" rather than "this looks broken". Cursor is
   already help via the base rule. */
.trust-check-page .tc-subscore.missing {
  background: repeating-linear-gradient(
    -45deg,
    rgba(63, 63, 70, 0.08),
    rgba(63, 63, 70, 0.08) 6px,
    transparent 6px,
    transparent 12px
  );
}
.trust-check-page .tc-subscore.missing .tc-subscore-value {
  color: var(--muted-foreground);
  opacity: 0.5;
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

/* ── Drawer footer — Remove detection history (2026-05-23) ──────
   Sits flush at the bottom of the drawer (outside .tc-drawer-body so
   it doesn't scroll with the panels above). The action is reversible
   in effect — the credential survives, only trust-local's tracking
   rows go — so the visual weight stays "secondary", not "danger". */
.trust-check-page .tc-drawer-footer {
  flex-shrink: 0;
  border-top: 1px solid var(--border);
  background: #1c1c1f;
  padding: 14px 22px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.trust-check-page .tc-drawer-footer-hint {
  font-size: 11px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  line-height: 1.5;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
}
.trust-check-page .tc-drawer-footer-hint-info {
  color: var(--muted-foreground);
  background: rgba(63, 63, 70, 0.25);
}
.trust-check-page .tc-drawer-footer-hint-warn {
  color: #fbbf24;
  background: rgba(250, 204, 21, 0.08);
  border-color: rgba(250, 204, 21, 0.35);
}
.trust-check-page .tc-drawer-footer-hint-error {
  color: #f87171;
  background: rgba(248, 113, 113, 0.08);
  border-color: rgba(248, 113, 113, 0.4);
}
.trust-check-page .tc-drawer-footer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.trust-check-page .tc-drawer-footer-cancel {
  background: transparent;
  color: var(--muted-foreground);
  border: 1px solid var(--border);
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
}
.trust-check-page .tc-drawer-footer-cancel:hover {
  color: var(--foreground);
  background: rgba(63, 63, 70, 0.35);
}
.trust-check-page .tc-drawer-footer-remove {
  background: transparent;
  color: var(--muted-foreground);
  border: 1px solid var(--border);
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 100ms ease, color 100ms ease, border-color 100ms ease;
}
.trust-check-page .tc-drawer-footer-remove:hover:not(:disabled) {
  color: var(--foreground);
  background: rgba(63, 63, 70, 0.4);
}
/* Armed state — second click will execute. Uses amber, not red, since
   the action only clears tracking history (credential is preserved).
   Red would over-signal danger and steer users to misread the scope. */
.trust-check-page .tc-drawer-footer-remove.armed {
  color: #1c1c1f;
  background: #fbbf24;
  border-color: #fbbf24;
}
.trust-check-page .tc-drawer-footer-remove.armed:hover:not(:disabled) {
  background: #f59e0b;
  border-color: #f59e0b;
}
.trust-check-page .tc-drawer-footer-remove:disabled {
  cursor: not-allowed;
  opacity: 0.45;
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
/* F1 2026-05-23: per-observation detail text (D5 reason or D4/D6 score)
   rendered inline in the row head, between the timestamp and the
   trace-id chip. Muted-foreground so the rule pill + timestamp stay
   the visual anchor. */
.trust-check-page .tc-obs-detail {
  font-size: 11px;
  color: var(--muted-foreground);
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  opacity: 0.85;
  /* Avoid pushing the trace id chip off-row on long D5 reasons. */
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

/* ── Stage 7 (2026-05-22): Health overview panel ─────────────────
 *
 * Replaces the 4-card metric grid. Layout:
 *   - left:  circular gauge (~140px) drawn with conic-gradient on a
 *            ::before, inner well masks the centre out
 *   - right: title + one-line description + 3-stat grid
 *
 * Ring fill % is driven by --health-pct (set inline from React).
 * Ring stroke colour is --health-color (also inline; band-derived).
 * Both fall back to muted-foreground when unset (loading state).
 * ────────────────────────────────────────────────────────────────── */

.trust-check-page .tc-health-panel {
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  gap: 24px;
  align-items: center;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px 24px;
  margin-bottom: 24px;
  position: relative;
  overflow: hidden;
}
.trust-check-page .tc-health-panel::before {
  /* subtle accent strip — same idiom the old metric cards used to
     give the row a visual "anchor", tinted by primary instead of a
     per-card colour. */
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 2px;
  background: var(--primary);
  opacity: 0.45;
}

/* ── Health ring ───────────────────────────────────────────────── */

.trust-check-page .tc-health-ring {
  --health-pct: 0%;
  --health-color: var(--muted-foreground);
  position: relative;
  width: 140px;
  height: 140px;
  border-radius: 50%;
  background:
    conic-gradient(
      var(--health-color) var(--health-pct),
      rgba(255, 255, 255, 0.08) 0
    );
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.trust-check-page .tc-health-ring-inner {
  width: 108px;
  height: 108px;
  border-radius: 50%;
  background: var(--card);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}
.trust-check-page .tc-health-score {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-weight: 800;
  font-size: 36px;
  line-height: 1;
  color: var(--foreground);
}
.trust-check-page .tc-health-score-label {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--muted-foreground);
  opacity: 0.7;
}

/* ── Right-hand copy + stats ───────────────────────────────────── */

.trust-check-page .tc-health-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.trust-check-page .tc-health-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.trust-check-page .tc-health-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--foreground);
}
.trust-check-page .tc-health-desc {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--muted-foreground);
  line-height: 1.45;
}
.trust-check-page .tc-health-window {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(250, 204, 21, 0.10);
  border: 1px solid rgba(250, 204, 21, 0.30);
  color: var(--primary);
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 11px;
  letter-spacing: 0.05em;
}

.trust-check-page .tc-health-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.trust-check-page .tc-health-stat {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
}
.trust-check-page .tc-health-stat-label {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted-foreground);
  opacity: 0.7;
  margin-bottom: 6px;
}
.trust-check-page .tc-health-stat-value {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-weight: 700;
  font-size: 22px;
  line-height: 1;
  color: var(--foreground);
}
.trust-check-page .tc-health-stat-note {
  margin-top: 6px;
  font-size: 11px;
  color: var(--muted-foreground);
  opacity: 0.7;
}

@media (max-width: 1024px) {
  .trust-check-page .tc-health-panel {
    grid-template-columns: 1fr;
    text-align: center;
  }
  .trust-check-page .tc-health-ring {
    justify-self: center;
  }
  .trust-check-page .tc-health-stats {
    grid-template-columns: 1fr;
  }
  .trust-check-page .tc-health-head {
    flex-direction: column;
    align-items: center;
  }
}

/* ── Stage 7 (2026-05-22): BAND view = baseurl dedup ───────────── */

.trust-check-page .tc-band-note {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  color: var(--muted-foreground);
}
.trust-check-page .tc-mono {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  opacity: 0.85;
}

.trust-check-page .tc-baseurl-list {
  display: flex;
  flex-direction: column;
}
.trust-check-page .tc-baseurl-row {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 0.8fr) auto;
  gap: 16px;
  align-items: center;
  padding: 14px 18px;
  border-top: 1px solid var(--border);
  cursor: pointer;
  transition: background-color 0.12s ease;
  position: relative;
}
.trust-check-page .tc-baseurl-row:first-child { border-top: none; }
.trust-check-page .tc-baseurl-row:hover { background: rgba(255, 255, 255, 0.02); }
.trust-check-page .tc-baseurl-row.selected { background: rgba(250, 204, 21, 0.06); }
.trust-check-page .tc-baseurl-row::before {
  /* band-color stripe on the left edge — same idiom the metric cards
     used, repurposed to make at-a-glance health visible per row. */
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--muted-foreground);
}
.trust-check-page .tc-baseurl-row.tc-band-trust::before    { background: var(--tc-trust); }
.trust-check-page .tc-baseurl-row.tc-band-suspect::before  { background: var(--warning); }
.trust-check-page .tc-baseurl-row.tc-band-risk::before     { background: var(--destructive); }

.trust-check-page .tc-baseurl-cell {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.trust-check-page .tc-baseurl-gateway strong {
  font-size: 14px;
  font-weight: 700;
  color: var(--foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.trust-check-page .tc-baseurl-sub {
  font-size: 11px;
  color: var(--muted-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.trust-check-page .tc-baseurl-action {
  justify-self: end;
}

@media (max-width: 800px) {
  .trust-check-page .tc-baseurl-row {
    grid-template-columns: 1fr;
    gap: 6px;
  }
  .trust-check-page .tc-baseurl-action {
    justify-self: start;
  }
}

/* ─── Disclaimer (page footer) ──────────────────────────────────────
 * 2026-05-23: legally + statistically motivated. Headline scores (the
 * "Score" card in the drawer) had been read as definitive provider
 * verdicts on single-run data, exposing us to provider pushback. The
 * disclaimer + the harmonic-mean display redesign + the "replicate ≥ 3
 * times" guidance form one coordinated answer to that risk.
 *
 * Style is intentionally low-contrast / quiet — like print-edition
 * footnotes, not modal-dialog legalese. We want users to read it once
 * + remember the framing without feeling lectured every time.
 * ───────────────────────────────────────────────────────────────── */
.trust-check-page .tc-disclaimer {
  margin-top: 40px;
  padding: 20px 24px;
  border: 1px solid var(--border, #2a2a2a);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.015);
  color: var(--muted-foreground, #888);
  font-size: 12px;
  line-height: 1.65;
}
.trust-check-page .tc-disclaimer-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted-foreground, #888);
  margin: 0 0 12px 0;
}
.trust-check-page .tc-disclaimer ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.trust-check-page .tc-disclaimer li {
  padding-left: 20px;
  position: relative;
  margin-bottom: 8px;
}
.trust-check-page .tc-disclaimer li:last-child {
  margin-bottom: 0;
}
.trust-check-page .tc-disclaimer li::before {
  content: '·';
  position: absolute;
  left: 8px;
  top: -1px;
  color: var(--muted-foreground, #888);
  font-weight: 700;
}
.trust-check-page .tc-disclaimer strong {
  color: var(--foreground, #ccc);
  font-weight: 500;
}
`;
