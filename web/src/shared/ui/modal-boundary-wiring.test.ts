import { describe, expect, it } from 'vitest';
import SRC from './ModalShell.tsx?raw';

// 🔴 The dialog-level containment is systemic ONLY because the shared modal
// primitives wrap their children with it (owner decision A, 2026-07-30). Every
// dialog built on them inherits containment for free — and loses it just as
// silently if someone unwraps the children while refactoring.
//
// Measured 2026-07-30: removing `<ModalErrorBoundary>` from ModalShell leaves
// BOTH `tsc` and the behavioural suite green, because the change is purely
// structural. Nothing except a source-level assertion can see it, so this fence
// reads the source (via vite's `?raw`) rather than being elegant.
//
// 能红: delete the wrapper in either primitive → the matching case fails.
describe('modal primitives keep their error boundary wired', () => {
  it('imports the boundary', () => {
    expect(SRC).toContain("import { ModalErrorBoundary } from './RouteErrorBoundary'");
  });

  it('ModalShell wraps its BODY children (header + close X must survive)', () => {
    expect(SRC).toContain('<ModalErrorBoundary>{children}</ModalErrorBoundary>');
  });

  it('ModalPortal wraps its children before portalling', () => {
    expect(SRC).toContain('const guarded = <ModalErrorBoundary>{children}</ModalErrorBoundary>');
  });
});
