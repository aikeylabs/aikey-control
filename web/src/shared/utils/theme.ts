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
  // 🔴 REAL HEXES ONLY — a <meta name="theme-color"> cannot take var(), so these
  // must track --background in index.css BY HAND. There are THREE producers of
  // the light one: this map, the boot script in index.html, and index.html's
  // media-keyed <meta> tag. All three had drifted by 2026-09-05 — still #ecebe9
  // (and #fcfaf7) two palette re-cuts after the light canvas moved to #f5f7fa,
  // so the mobile address bar painted a colour the page had not used in weeks.
  // Fence: theme-color-producers-agree.test.ts
  light: '#f5f7fa', // theme-literal-ok: = --background in [data-theme='light']
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

/**
 * What the USER chose — a different question from what is on screen.
 *
 * 🔴 'system' is stored as the ABSENCE of the key, never as the string
 * "system". That is load-bearing, not tidiness: the pre-paint boot script in
 * index.html reads the same key and treats anything that is not 'light' /
 * 'dark' as "no preference". Writing "system" would happen to work there today,
 * but it would leave the two readers disagreeing about what storage MEANS — and
 * the boot script is the one that cannot be fixed after the fact, because it
 * runs before this module exists. Absence keeps "no preference" and "dark is
 * the un-attributed state" the same fact.
 */
export type ThemeMode = Theme | 'system';

function clearStored(): void {
  try {
    localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    /* nothing to clear, or storage is unavailable — either way: follow the OS */
  }
}

/** The user's choice. No stored preference means "follow the OS". */
export function getMode(): ThemeMode {
  return readStored() ?? 'system';
}

/** Apply a mode: persist an explicit choice, or clear back to following the OS. */
export function setMode(mode: ThemeMode): ThemeMode {
  if (mode === 'system') {
    clearStored();
    applyTheme(systemTheme());
  } else {
    writeStored(mode);
    applyTheme(mode);
  }
  return mode;
}

/**
 * light → dark → system → light.
 *
 * 🔴 'system' is a real stop on the cycle, not a hidden reset. Until 2026-09-05
 * this was a two-state toggle, which made the FIRST press one-way: it wrote an
 * override and nothing in the UI could ever clear it, so a console that had
 * been following the OS silently stopped following it and the user had no way
 * back. The previous revision of this file said as much — "clearing the stored
 * override to resume following the OS is not exposed yet; add it if anyone
 * asks". Someone asked.
 *
 * Still ONE cycling button rather than a three-segment control: a segmented
 * control spends permanent header width on a choice made once, and its third
 * segment's only job is to return you to the default. Interaction simplicity
 * first — workflow/CI/IDE/claude/principles/interaction-simplicity-first.md.
 */
export function cycleMode(): ThemeMode {
  const order: ThemeMode[] = ['light', 'dark', 'system'];
  const next = order[(order.indexOf(getMode()) + 1) % order.length];
  return setMode(next);
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
