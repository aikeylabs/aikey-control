/**
 * SessionKeyHelp — the one-line hint beside the Session Key input.
 *
 * # Why this file exists (2026-08-18)
 *
 * `aikey-control-master` has imported `aikey-control-web/shared/components/SessionKeyHelp.tsx`
 * since commit 76195ac (2026-08-15), which is merged into `origin/develop-v1.0.5`.
 * The file was never landed here, so `npm run build` in aikey-control-master/web
 * has failed outright since that date — taking the Production SPA, and every
 * sealed cluster package that bundles it, with it. See
 * `shared/session-key-capability.ts` for the full chain.
 *
 * # 🚫 What this deliberately does NOT do
 *
 * It invents no product facts. The obvious thing to write here is where a person
 * finds their Session Key — which app, which menu, which screen — and every word
 * of that would be me guessing at somebody else's feature. A wrong procedure in a
 * help hint is worse than no procedure: it sends people looking in a place that
 * does not exist and they conclude the product is broken.
 *
 * So it states only what the caller already established: WHICH key this field
 * wants. That is derived from `providerKind`, which comes from
 * `sessionKeyProviderKind`, which follows the proxy. Nothing else is claimed.
 *
 * 🔴 Richer guidance — a link to the real instructions, and the Codex wording —
 * is pending the owner of the Session Key feature. The i18n block behind this
 * screen (`oauthGroups.sessionKeyLogin`) is Claude-only today and carries no
 * `help` key, which is part of the same unfinished landing.
 *
 * 🚫 English only, and not routed through i18n. Every other string on this screen
 * comes from `oauthGroups.sessionKeyLogin`; adding a key for placeholder copy
 * would put a placeholder into the translation catalogue, where it reads as
 * settled wording. When the real copy lands it should go into that block with the
 * rest, and this component should take it from there.
 *
 * 🔴 This file is BYTE-EQUAL in aikey-control/web and aikey-control-master/web,
 * enforced by hook-components.dual-edit.test.ts — `@/shared/components/*` is not
 * vite-aliased, so the two builds can otherwise resolve different copies.
 * 🚫 Edit both, or neither.
 */
import React from 'react';

import type { SessionKeyProviderKind } from '@/shared/session-key-capability';

export interface SessionKeyHelpProps {
  /** Which product's Session Key this field expects. */
  providerKind: SessionKeyProviderKind;
  className?: string;
}

/**
 * The product name shown to the operator.
 *
 * 🔴 A lookup rather than a conditional, so a third kind added to
 * `SessionKeyProviderKind` fails to compile here instead of silently falling
 * back to the Claude wording on a screen that would then be wrong.
 */
const PRODUCT_NAME: Record<SessionKeyProviderKind, string> = {
  claude: 'Claude',
  codex: 'Codex',
};

export function SessionKeyHelp({ providerKind, className }: SessionKeyHelpProps) {
  return (
    <span
      className={className ?? 'text-[10px] font-mono'}
      style={{ color: 'var(--muted-foreground)' }}
      data-testid="session-key-help"
      data-provider-kind={providerKind}
    >
      Expects a {PRODUCT_NAME[providerKind]} Session Key
    </span>
  );
}
