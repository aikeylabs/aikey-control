import React from 'react';
import { Outlet } from 'react-router-dom';

/**
 * Centered layout for login / auth pages.
 */
export function AuthLayout() {
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
            'radial-gradient(ellipse 60% 40% at 50% 50%, rgba(250, 204, 21, 0.04) 0%, transparent 70%)',
        }}
      />

      <div className="relative z-10 w-full max-w-md px-4">
        <Outlet />
      </div>
    </div>
  );
}
