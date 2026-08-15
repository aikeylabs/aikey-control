import { describe, expect, it } from 'vitest';

import { shouldAttachBrowserToken } from './browser-auth';

describe('shouldAttachBrowserToken', () => {
  it('suppresses stale browser auth on the Personal composing gateway', () => {
    expect(shouldAttachBrowserToken({
      authMode: 'local_bypass',
      controlPlaneMode: 'personal',
    })).toBe(false);
  });

  it('suppresses stale browser auth on a gateway-forwarded Team page', () => {
    expect(shouldAttachBrowserToken({
      authMode: 'local_bypass',
      controlPlaneMode: 'production',
      teamGateway: true,
    })).toBe(false);
  });

  it('keeps browser auth for standalone Trial identity resolution', () => {
    expect(shouldAttachBrowserToken({
      authMode: 'local_bypass',
      controlPlaneMode: 'trial',
    })).toBe(true);
  });

  it('keeps browser auth for a direct JWT team console', () => {
    expect(shouldAttachBrowserToken({
      authMode: 'jwt',
      controlPlaneMode: 'production',
    })).toBe(true);
  });
});
