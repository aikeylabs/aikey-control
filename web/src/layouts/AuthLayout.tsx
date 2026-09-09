import React from 'react';
import { Outlet } from 'react-router-dom';

/**
 * Centered layout for login / auth pages.
 *
 * 🔴 DUAL-EDIT: byte-identical in aikey-control/web and aikey-control-master/web.
 * The trial composer resolves `@/layouts/AuthLayout` to the MASTER copy even for
 * user routes, so an edit to one copy alone changes the OTHER console's login
 * page in Trial and nowhere else.
 *
 * The card width used to be that silent difference: master widened md→lg on
 * 2026-07-18 (user request, to match the CLI login card) while user/web stayed
 * md — so the user login card was 448px in Personal and 512px in Trial, for no
 * reason anybody had chosen. The width is a PROP now: each route states the one
 * it wants, the difference is visible at the call site, and the file itself has
 * nothing left to drift.
 */
export type AuthCardWidth = 'md' | 'lg';

const CARD_WIDTH: Record<AuthCardWidth, string> = {
  md: 'max-w-md',
  lg: 'max-w-lg',
};

export function AuthLayout({ width = 'md' }: { width?: AuthCardWidth } = {}) {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: 'var(--background)' }}
    >
      {/* Background texture pattern */}
      <div
        className="absolute inset-0 opacity-5 pointer-events-none"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, var(--border) 0px, transparent 1px, transparent 40px), repeating-linear-gradient(90deg, var(--border) 0px, transparent 1px, transparent 40px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Glow effect */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 60% 40% at 50% 50%, rgba(var(--primary-rgb), 0.04) 0%, transparent 70%)',
        }}
      />

      <div className={`relative z-10 w-full ${CARD_WIDTH[width]} px-4`}>
        <Outlet />
      </div>
    </div>
  );
}
