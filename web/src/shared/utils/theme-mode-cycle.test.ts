// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { THEME_STORAGE_KEY, applyTheme, cycleMode, getMode, setMode } from './theme';

/**
 * The three-state theme control (2026-09-05).
 *
 * Runs without jsdom: theme.ts touches `localStorage`, `window` and `document`
 * only at CALL time, so plain global stubs are enough and the suite stays in
 * the fast node environment.
 */

let store: Record<string, string>;
let root: { attrs: Record<string, string> };

function stubEnvironment(prefersLight: boolean, storageThrows = false) {
  store = {};
  root = { attrs: {} };
  const el = {
    setAttribute: (k: string, v: string) => {
      root.attrs[k] = v;
    },
    removeAttribute: (k: string) => {
      delete root.attrs[k];
    },
    getAttribute: (k: string) => root.attrs[k] ?? null,
  };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => {
      if (storageThrows) throw new Error('SecurityError');
      return store[k] ?? null;
    },
    setItem: (k: string, v: string) => {
      if (storageThrows) throw new Error('SecurityError');
      store[k] = v;
    },
    removeItem: (k: string) => {
      if (storageThrows) throw new Error('SecurityError');
      delete store[k];
    },
  });
  vi.stubGlobal('window', {
    matchMedia: (q: string) => ({ matches: q.includes('light') ? prefersLight : !prefersLight }),
  });
  vi.stubGlobal('document', { documentElement: el, querySelector: () => null });
}

afterEach(() => vi.unstubAllGlobals());

describe('theme mode cycles light -> dark -> system', () => {
  beforeEach(() => stubEnvironment(false));

  it('starts at system when nothing is stored', () => {
    expect(getMode()).toBe('system');
  });

  it('cycles in order and returns to system', () => {
    expect(cycleMode()).toBe('light');
    expect(cycleMode()).toBe('dark');
    expect(cycleMode()).toBe('system');
    expect(cycleMode()).toBe('light');
  });

  /**
   * 🔴 The load-bearing one. The pre-paint boot script in index.html reads the
   * same key and treats anything that is not 'light'/'dark' as "no preference".
   * Writing the string "system" would leave the two readers disagreeing about
   * what storage MEANS, and the boot script cannot be fixed after the fact — it
   * runs before any module exists.
   */
  it('stores system as the ABSENCE of the key, never as a value', () => {
    setMode('light');
    expect(store[THEME_STORAGE_KEY]).toBe('light');
    setMode('system');
    expect(
      THEME_STORAGE_KEY in store,
      'system must clear the key, not write "system" into it',
    ).toBe(false);
    expect(Object.values(store)).not.toContain('system');
  });

  it('system resolves from the OS, in both directions', () => {
    stubEnvironment(true);
    setMode('system');
    expect(root.attrs['data-theme'], 'OS prefers light -> attribute present').toBe('light');

    stubEnvironment(false);
    setMode('system');
    expect(
      'data-theme' in root.attrs,
      'OS prefers dark -> attribute ABSENT (dark is the un-attributed state)',
    ).toBe(false);
  });

  it('an explicit choice overrides the OS', () => {
    stubEnvironment(true); // OS says light
    setMode('dark');
    expect('data-theme' in root.attrs).toBe(false);
    expect(store[THEME_STORAGE_KEY]).toBe('dark');
  });

  it('storage that throws degrades to system instead of crashing', () => {
    stubEnvironment(false, true);
    expect(() => getMode()).not.toThrow();
    expect(getMode()).toBe('system');
    expect(() => cycleMode()).not.toThrow();
  });

  it('applyTheme never writes data-theme="dark"', () => {
    applyTheme('dark');
    expect(root.attrs['data-theme']).toBeUndefined();
    applyTheme('light');
    expect(root.attrs['data-theme']).toBe('light');
  });
});

describe('the toggle exposes all three stops', () => {
  it('ThemeToggle branches on every mode, not just light/dark', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../ui/ThemeToggle.tsx'), 'utf8');
    expect(src, 'the toggle no longer cycles').toContain('cycleMode()');
    expect(src, 'system has no icon branch — it would be invisible').toMatch(
      /mode === 'dark' \? \(/,
    );
    // Anti-vacuous: three distinct <svg> branches must exist, one per stop.
    expect((src.match(/<svg width="16"/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
