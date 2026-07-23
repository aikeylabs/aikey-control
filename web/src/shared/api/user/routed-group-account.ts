/**
 * Single display rule for which OAuth-pool account is selected across user pages.
 *
 * The proxy's live projection is authoritative when present. A projection where
 * every candidate is explicitly false means the pool has no usable route; the UI
 * must not resurrect the administrator's static default. Only legacy/master
 * snapshots where the field is absent may temporarily fall back to `assigned`.
 */
export function routedGroupAccount<
  T extends { assigned: boolean; current_routed?: boolean },
>(accounts: T[] | null | undefined): T | undefined {
  if (!accounts || accounts.length === 0) return undefined;

  const current = accounts.find((account) => account.current_routed === true);
  if (current) return current;

  const liveProjectionPresent = accounts.some(
    (account) => typeof account.current_routed === 'boolean',
  );
  if (liveProjectionPresent) return undefined;

  return accounts.find((account) => account.assigned) ?? accounts[0];
}
