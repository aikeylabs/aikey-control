/**
 * Light / dark switch for the console header.
 *
 * 2026-09-03: added with the light theme. Dark remains the default and is
 * unchanged; see `shared/utils/theme.ts` for why dark is the attribute-absent
 * state and why that matters.
 *
 * Deliberately a single icon button, not a three-way light/dark/system control.
 * WHY: the system option is already the DEFAULT behaviour — with nothing stored
 * we follow the OS and keep following it live. A visible "System" segment would
 * therefore add a control whose only job is to return you to where you started,
 * on every page of a dense operator console. Interaction simplicity first
 * (workflow/CI/IDE/claude/principles/interaction-simplicity-first.md): the
 * cheapest control that expresses the choice wins. Clearing the stored override
 * to resume following the OS is not exposed yet; add it if anyone asks.
 *
 * 🔴 DUAL-EDIT: byte-identical in aikey-control/web and aikey-control-master/web
 * (covered by `src/shared/ui` in DRIFT_CHECK_PATHS).
 */
import { useEffect, useState } from 'react';
import { getTheme, toggleTheme, watchSystemTheme, type Theme } from '@/shared/utils/theme';

export function ThemeToggle({ className = '' }: { className?: string }) {
  // Seeded from the DOM, which the boot script has already set — so the first
  // render matches what is on screen and the icon never flips after mount.
  const [theme, setThemeState] = useState<Theme>(() => getTheme());

  useEffect(() => {
    const stop = watchSystemTheme();
    // The OS can change the theme underneath us while no override is stored;
    // re-read so the icon keeps describing what is actually on screen.
    const sync = () => setThemeState(getTheme());
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => {
      stop();
      observer.disconnect();
    };
  }, []);

  const next = theme === 'light' ? 'dark' : 'light';

  return (
    <button
      type="button"
      onClick={() => setThemeState(toggleTheme())}
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
      // Names the RESULT of pressing, not the current state — a control says
      // what happens, not where you are.
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {theme === 'light' ? (
        // Currently light → offer dark: show a moon.
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        // Currently dark → offer light: show a sun.
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="3.1" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M8 1v1.6M8 13.4V15M15 8h-1.6M2.6 8H1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1M12.9 12.9l-1.1-1.1M4.2 4.2 3.1 3.1"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}

export default ThemeToggle;
