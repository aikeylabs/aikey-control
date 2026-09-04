/**
 * Light / dark switch for the console header.
 *
 * 2026-09-03: added with the light theme. Dark remains the default and is
 * unchanged; see `shared/utils/theme.ts` for why dark is the attribute-absent
 * state and why that matters.
 *
 * 2026-09-05: a single icon button that CYCLES light → dark → system, after a
 * user asked for the theme to follow the OS.
 *
 * 🔴 What was actually broken: following the OS was already the default, but the
 * two-state toggle made the first press ONE-WAY. It wrote an override and
 * nothing in the UI could clear it, so a console that had been tracking the OS
 * silently stopped and stayed stopped. The previous revision of this comment
 * argued a "System" segment would only "return you to where you started" — true
 * of a segmented control, but it missed that there was no way to get back at
 * all. Absence of a control is not the same as absence of a need.
 *
 * Still ONE button, not three segments: a segmented control spends permanent
 * header width, on every page of a dense operator console, on a choice made
 * once. Interaction simplicity first
 * (workflow/CI/IDE/claude/principles/interaction-simplicity-first.md) — the
 * cheapest control that expresses the choice wins, and a cycling button is
 * cheaper than three segments.
 *
 * 🔴 The icon now names the MODE, not the colour on screen. In system mode it
 * shows a half-filled disc regardless of whether the OS resolved to light or
 * dark — otherwise "system" would be indistinguishable from whichever of the
 * two it currently matches, which is exactly the state the user could not see
 * before.
 *
 * 🔴 DUAL-EDIT: byte-identical in aikey-control/web and aikey-control-master/web
 * (covered by `src/shared/ui` in DRIFT_CHECK_PATHS).
 */
import { useEffect, useState } from 'react';
import { cycleMode, getMode, watchSystemTheme, type ThemeMode } from '@/shared/utils/theme';

export function ThemeToggle({ className = '' }: { className?: string }) {
  // Seeded from STORAGE, not from the DOM: the DOM only knows the resolved
  // colour, and 'system' is precisely the mode the resolved colour cannot tell
  // you about. Storage is what the boot script read, so the first render still
  // agrees with what is on screen.
  const [mode, setModeState] = useState<ThemeMode>(() => getMode());

  useEffect(() => {
    // Keeps the page following the OS live while mode === 'system'. The watcher
    // is a no-op once an override is stored, so it is safe to leave running.
    const stop = watchSystemTheme();
    return stop;
  }, []);

  const NEXT: Record<ThemeMode, ThemeMode> = { light: 'dark', dark: 'system', system: 'light' };
  const next = NEXT[mode];
  const label =
    mode === 'system'
      ? `Theme: system (following your OS) · Switch to ${next}`
      : `Theme: ${mode} · Switch to ${next}`;

  return (
    <button
      type="button"
      onClick={() => setModeState(cycleMode())}
      className={`flex items-center justify-center rounded transition-colors ${className}`}
      style={{
        width: '2rem',
        height: '2rem',
        color: 'var(--muted-foreground)',
        border: '1px solid transparent',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--overlay-hover)';
        e.currentTarget.style.color = 'var(--foreground)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
        e.currentTarget.style.color = 'var(--muted-foreground)';
      }}
      // Says BOTH: where you are and what happens next. With three stops the
      // result alone is ambiguous — "switch to light" is reachable from two of
      // them, and 'system' is invisible in the rendered colour.
      aria-label={label}
      title={label}
    >
      {mode === 'light' ? (
        // Light mode: a sun.
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="3.1" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M8 1v1.6M8 13.4V15M15 8h-1.6M2.6 8H1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1M12.9 12.9l-1.1-1.1M4.2 4.2 3.1 3.1"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      ) : mode === 'dark' ? (
        // Dark mode: a moon.
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        // System mode: a half-filled disc — the conventional "auto / contrast"
        // glyph. Deliberately NOT the sun or the moon: in this mode the console
        // may be showing either, and the control has to say "whatever the OS
        // says", not "light" or "dark".
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="5.8" stroke="currentColor" strokeWidth="1.4" />
          <path d="M8 2.2a5.8 5.8 0 0 1 0 11.6Z" fill="currentColor" />
        </svg>
      )}
    </button>
  );
}

export default ThemeToggle;
