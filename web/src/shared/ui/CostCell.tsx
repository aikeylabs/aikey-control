import { useTranslation } from 'react-i18next';

import { formatCost } from '@/shared/utils/formatCost';

export interface CostCellProps {
  /** Estimated USD cost for the row. Undefined/null coalesce to $0. */
  value?: number;
  /**
   * Number of requests in this row that had NO price (model absent from
   * the price table). When > 0, a "⚠ N unpriced" badge is appended so the
   * user knows the estimate is partial. 0 / undefined → no badge (avoids
   * visual noise when everything priced).
   */
  unpricedCount?: number;
}

/**
 * CostCell renders an estimated USD cost as "≈ $X.XX" in muted text, with
 * an optional "⚠ N unpriced" badge. Shared across the usage-ledger by-key
 * / by-app lists (Stage 4) and apps-detail top-models (Stage 5).
 *
 * The "≈" framing is deliberate: these are reference estimates from a
 * published price table, not billed amounts (see the page footnote). The
 * badge stays in muted color (no new palette value) — the ⚠ glyph is the
 * signal — per the project's visual-consistency rule.
 */
export function CostCell({ value, unpricedCount }: CostCellProps) {
  const { t } = useTranslation();
  return (
    <span style={{ color: 'var(--muted-foreground)', fontVariantNumeric: 'tabular-nums' }}>
      ≈ {formatCost(value ?? 0)}
      {unpricedCount && unpricedCount > 0 ? (
        <span
          title={t('usageLedger.unpricedTooltip')}
          style={{ marginLeft: 6, fontSize: '0.85em', whiteSpace: 'nowrap' }}
        >
          ⚠ {t('usageLedger.unpricedBadge', { count: unpricedCount })}
        </span>
      ) : null}
    </span>
  );
}
