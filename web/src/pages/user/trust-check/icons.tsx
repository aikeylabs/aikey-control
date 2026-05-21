/**
 * Inline lucide-style icons used across the Trust Check page.
 *
 * Kept page-local (not in shared/) because (a) no other page consumes
 * them yet, (b) we want to stay out of cross-cutting code while another
 * session is editing shared/. Promote to shared/ if M5.2 ops dashboard
 * ends up needing the same glyphs.
 *
 * All icons share the same outline preset (width=2, round caps/joins,
 * 24×24 viewBox) so they line up visually next to button text. Default
 * size is 14px to match the surrounding 12-13px mono text.
 */
import type { ReactNode } from 'react';

export function SvgIcon({ children, size = 14 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function RefreshIcon() {
  return (
    <SvgIcon>
      <path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-9-9 9 9 0 0 1 9-9" />
      <path d="M21 3v6h-6" />
    </SvgIcon>
  );
}

export function ScanIcon() {
  return (
    <SvgIcon>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <path d="M7 12h10" />
    </SvgIcon>
  );
}

export function KeyIcon() {
  return (
    <SvgIcon>
      <circle cx="7.5" cy="15.5" r="3.5" />
      <path d="M21 2 11 12" />
      <path d="m15 6 3 3" />
      <path d="m17 8 4-4" />
    </SvgIcon>
  );
}

export function GaugeIcon() {
  return (
    <SvgIcon>
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </SvgIcon>
  );
}

export function SpinDotInline() {
  return (
    <SvgIcon>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </SvgIcon>
  );
}

export function CloseIcon() {
  return (
    <SvgIcon>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </SvgIcon>
  );
}

export function ChevronRightIcon() {
  return (
    <SvgIcon>
      <path d="m9 18 6-6-6-6" />
    </SvgIcon>
  );
}
