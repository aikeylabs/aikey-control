/**
 * Console theme (light / dark) — single source of truth for the React side.
 *
 * WHY THIS EXISTS
 * ---------------
 * 2026-09-03: the consoles gained a light theme. The dark "Industrial Vault"
 * theme is unchanged and stays the default.
 *
 * 🔴 DARK IS THE ABSENT STATE. `index.css` declares the dark palette on bare
 * `:root`; light is `[data-theme='light']`. Nothing ever sets
 * `data-theme="dark"` — dark is what you get when the attribute is missing.
 *
 * That is not a stylistic choice, it is the safety argument for the whole
 * change. Every path that fails to run our code — a stale cached bundle, the
 * frame before JS settles, the Trial composer's forwarded user pages, a
 * screenshot harness, a thrown error in boot — lands on `:root` and renders
 * today's console exactly. The failure mode of this theme system is "you get
 * what you already had", which is the only failure mode acceptable for a
 * change that must not regress dark.
 *
 * WHY THE APPLY LOGIC IS DUPLICATED IN index.html
 * -----------------------------------------------
 * A small inline script in `index.html` applies the theme before first paint,
 * because waiting for this module would show a flash of dark on a light-mode
 * machine. The duplication is ~6 lines and unavoidable: a module that has to be
 * fetched and evaluated cannot beat the first paint. The two must agree on the
 * storage key and the attribute; both are stated here and referenced there.
 *
 * 🔴 DUAL-EDIT: byte-identical in aikey-control/web and aikey-control-master/web
 * (covered by `src/shared/utils` in DRIFT_CHECK_PATHS — see
 * `make -C workflow/CI web-drift-check`).
 *
 * Spec: roadmap20260320/技术实现/update/20260903-控制台新增浅色主题-深色不变.md
 * Design source: roadmap20260320/技术实现/UI/resources/theme_3.css
 */

export type Theme = 'light' | 'dark';

/** Shared with the pre-paint boot script in index.html. Keep the two in sync. */
export const THEME_STORAGE_KEY = 'aikey-theme';

/**
 * `theme-color` drives the browser/OS chrome around the page (mobile address
 * bar, PWA title bar). The static tags in index.html are keyed off
 * `prefers-color-scheme`, which is wrong once the user makes an explicit
 * choice, so the applied theme overrides them.
 */
const THEME_COLOR: Record<Theme, string> = {
  light: '#ecebe9', // theme-literal-ok: = --background in [data-theme='light']
  // 🔴 REAL HEXES ONLY — a <meta name="theme-color"> cannot take var(). These
  // two must be kept in step with --background in index.css by hand.
  dark: '#18181b', // theme-literal-ok: = --background on :root; a meta tag cannot take var()
};

/**
 * Storage can throw outright, not just return null: Safari private mode and
 * some embedded webviews raise on access. A theme preference is never worth
 * breaking the console over, so every access is guarded and failure degrades to
 * "no stored preference" (i.e. follow the OS, i.e. dark unless it says light).
 */
function readStored(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function writeStored(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* preference simply won't persist; the session still switches */
  }
}

function systemTheme(): Theme {
  // Asks for LIGHT rather than dark on purpose: dark is the fallback for every
  // uncertain answer (no matchMedia, no preference expressed), which keeps the
  // "absent means dark" invariant true here too.
  try {
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Writes the DOM. The ONLY place the attribute is set outside the boot script. */
export function applyTheme(theme: Theme): void {
  const el = document.documentElement;
  if (theme === 'light') el.setAttribute('data-theme', 'light');
  else el.removeAttribute('data-theme');

  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) meta.setAttribute('content', THEME_COLOR[theme]);
}

/** What is on screen right now — read from the DOM, not from storage. */
export function getTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

/** The effective theme when no explicit choice is stored. */
export function resolveTheme(): Theme {
  return readStored() ?? systemTheme();
}

/** User made a choice: persist it and apply it. */
export function setTheme(theme: Theme): void {
  writeStored(theme);
  applyTheme(theme);
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'light' ? 'dark' : 'light';
  setTheme(next);
  return next;
}

/**
 * Follow the OS while — and only while — the user has expressed no preference.
 * Returns an unsubscribe function.
 *
 * `addListener` is the deprecated pre-Safari-14 spelling; it is kept because
 * the consoles are shipped into customer environments whose browser versions we
 * do not control, and losing live OS-follow there is a silent degradation.
 */
export function watchSystemTheme(): () => void {
  let mq: MediaQueryList;
  try {
    mq = window.matchMedia('(prefers-color-scheme: light)');
  } catch {
    return () => {};
  }
  const onChange = (e: MediaQueryListEvent) => {
    if (readStored() === null) applyTheme(e.matches ? 'light' : 'dark');
  };
  if (mq.addEventListener) {
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }
  mq.addListener(onChange);
  return () => mq.removeListener(onChange);
}
