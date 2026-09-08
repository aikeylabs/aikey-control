import { useId, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * InfoHint — an ⓘ affordance that reveals one sentence of explanation.
 *
 * Introduced for the switching-threshold rows (openspec change
 * `aliyun-aigw-p0-upstream-fallback`, task 4.46), where five rows each carried
 * two or three lines of prose and the numbers that matter were losing to the
 * text explaining them.
 *
 * # 🔴 Three ways in, not one
 *
 * hover · keyboard focus · click. Dropping any of them does not "fold" the
 * explanation for that group of users — it DELETES it:
 *
 *   · hover does not exist on a touch screen;
 *   · a mouse user never discovers a focus-only affordance;
 *   · a click-only bubble makes every reader take an action to read a caption.
 *
 * # 🔴 The bubble is real DOM, always present
 *
 * 🚫 Not a CSS `content: attr(data-tooltip)` pseudo-element, which is the
 * cheaper build and the one already in this codebase for the collapsed sidebar.
 * That form cannot be read by a screen reader, cannot wrap onto a second line,
 * and cannot hold anything but a short string — and these hints are full
 * sentences.
 *
 * Because the node always exists, `aria-describedby` resolves whether or not the
 * bubble is visible, so a screen reader announces the explanation on focus
 * without the user having to discover that it can be opened at all. When it is
 * not visible it is `sr-only` rather than `display:none`, which would take it
 * back out of the accessibility tree and undo exactly that.
 */
interface InfoHintProps {
  /** What the trigger is called, e.g. "About: overall wait limit". Spoken by a
   *  screen reader in place of the glyph, which on its own says nothing. */
  label: string;
  /** The explanation. A sentence, not a phrase. */
  children: ReactNode;
  /** Optional hook for tests / fences. */
  testId?: string;
  /**
   * The character in the trigger. Defaults to `i` — an aside about the thing
   * next to it, which is what the threshold rows use it for.
   *
   * `?` is the other legitimate value, for the case where the hint answers a
   * question the reader is actually asking ("what does this page set?") rather
   * than adding a footnote they did not ask for. It is a glyph swap ONLY: the
   * three ways in and the always-present bubble are the component's contract and
   * do not vary with it, which is why this is a prop rather than a second
   * component someone would build with hover as the only trigger.
   */
  glyph?: 'i' | '?';
}

export function InfoHint({ label, children, testId, glyph = 'i' }: InfoHintProps) {
  const id = useId();
  // Click PINS the bubble open — the touch-screen path, and also what a mouse
  // user reaches for when a sentence is long enough to want to read twice.
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const shown = pinned || hovered || focused;

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={pinned}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={(e) => {
          // Rows are clickable on some hosts; reading a caption is not a request
          // to activate whatever is underneath.
          e.stopPropagation();
          setPinned((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && pinned) {
            e.stopPropagation();
            setPinned(false);
          }
        }}
        className="text-xs font-mono"
        style={{
          color: 'var(--muted-foreground)',
          border: '1px solid var(--border)',
          borderRadius: '999px',
          width: '1.15rem',
          height: '1.15rem',
          lineHeight: 1,
          padding: 0,
          background: 'transparent',
          cursor: 'help',
        }}
        data-testid={testId}
      >
        <span aria-hidden="true">{glyph}</span>
      </button>
      <span
        id={id}
        role="note"
        /* 🔴 sr-only when hidden, never `display:none` / `hidden`: the point of
           always rendering it is that `aria-describedby` keeps resolving. */
        className={shown ? 'absolute z-50 block' : 'sr-only'}
        style={
          shown
            ? {
                top: 'calc(100% + 6px)',
                left: 0,
                width: '20rem',
                maxWidth: '70vw',
                background: 'var(--card)',
                color: 'var(--foreground)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                boxShadow: '0 6px 18px rgba(var(--scrim-rgb), 0.45)',
                padding: '8px 10px',
                fontSize: '11px',
                lineHeight: 1.5,
                whiteSpace: 'normal',
              }
            : undefined
        }
        data-testid={testId ? `${testId}-bubble` : undefined}
        data-shown={shown ? 'true' : 'false'}
      >
        {children}
      </span>
    </span>
  );
}
