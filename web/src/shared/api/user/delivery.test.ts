import { describe, expect, it } from 'vitest';

import { routedGroupAccount } from './routed-group-account';

describe('routedGroupAccount', () => {
  it('uses the proxy live route instead of the static default', () => {
    const accounts = [
      { account_id: 'default', assigned: true, current_routed: false },
      { account_id: 'fallback', assigned: false, current_routed: true },
    ];

    expect(routedGroupAccount(accounts)?.account_id).toBe('fallback');
  });

  it('returns no route when the live projection explicitly marks all accounts false', () => {
    const accounts = [
      { account_id: 'default', assigned: true, current_routed: false },
      { account_id: 'fallback', assigned: false, current_routed: false },
    ];

    expect(routedGroupAccount(accounts)).toBeUndefined();
  });

  it('falls back to the static default only before a live projection exists', () => {
    const accounts = [
      { account_id: 'default', assigned: true },
      { account_id: 'fallback', assigned: false },
    ];

    expect(routedGroupAccount(accounts)?.account_id).toBe('default');
  });
});
