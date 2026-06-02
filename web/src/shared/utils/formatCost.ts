/**
 * Format an estimated USD cost for display (cost-pricing Stage 4).
 *
 * Small amounts (< $10) render 4 decimals so sub-cent estimates stay
 * legible (a single cheap request can be $0.0001); larger amounts render
 * 2 decimals with thousands separators. Locale is locked to en-US per the
 * project's code-and-ui-language convention — money/number formatting must
 * NOT vary with the browser locale.
 *
 * Returns the number with a "$" prefix only (no "≈"); callers that want
 * the "estimated" connotation prepend "≈ " (see CostCell). NaN/Infinity
 * coalesce to $0 so a bad value never renders "$NaN".
 */
export function formatCost(usd: number): string {
  const v = Number.isFinite(usd) ? usd : 0;
  const decimals = Math.abs(v) < 10 ? 4 : 2;
  return (
    '$' +
    v.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  );
}
