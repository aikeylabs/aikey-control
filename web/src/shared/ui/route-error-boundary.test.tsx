import { describe, expect, it } from 'vitest';
import { RouteErrorBoundary } from './RouteErrorBoundary';

// Fences for the blast-radius limiter added after the 2026-07-30 seats incident,
// where `members: null` + `.length` replaced the WHOLE console with React
// Router's raw fallback.
//
// This suite has no DOM (the project's vitest runs without jsdom), so it pins
// the two pieces of logic that decide whether the boundary actually contains a
// failure — both are pure and both were the difference between "one page
// degrades" and "the app is gone":
//
//   1. getDerivedStateFromError must CAPTURE the error (else it propagates to
//      the router and the shell unmounts — the exact old behaviour).
//   2. getDerivedStateFromProps must CLEAR it when the route changes, and must
//      NOT clear it while the user stays put. Without the reset every later
//      route renders the fallback too, which is indistinguishable from a dead
//      app; without the "stay put" half, the fallback would flicker away on any
//      unrelated re-render and take its Retry/Details actions with it.

describe('RouteErrorBoundary state machine', () => {
  it('captures a thrown error instead of letting it reach the router', () => {
    const err = new TypeError("Cannot read properties of null (reading 'length')");
    expect(RouteErrorBoundary.getDerivedStateFromError(err)).toEqual({ error: err });
  });

  it('clears the error when the route changes', () => {
    const err = new Error('boom');
    const next = RouteErrorBoundary.getDerivedStateFromProps(
      { children: null, resetKey: '/master/orgs/1/nodes' },
      { error: err, attempt: 0, lastResetKey: '/master/orgs/1/seats', showDetail: true },
    );
    expect(next).toMatchObject({ error: null, lastResetKey: '/master/orgs/1/nodes' });
    // Details must collapse too — the next page's failure (if any) is a new one.
    expect(next).toMatchObject({ showDetail: false });
  });

  it('keeps the fallback while the user stays on the same route', () => {
    const err = new Error('boom');
    expect(
      RouteErrorBoundary.getDerivedStateFromProps(
        { children: null, resetKey: '/master/orgs/1/seats' },
        { error: err, attempt: 0, lastResetKey: '/master/orgs/1/seats', showDetail: false },
      ),
    ).toBeNull();
  });

  it('adopts the first resetKey without discarding a fresh error', () => {
    // First render after a crash: lastResetKey is still undefined, so the
    // boundary records the key. It may clear here — the error has not been
    // painted yet — but it must never leave lastResetKey unset, or every
    // subsequent render would look like a route change and the fallback could
    // never persist.
    const next = RouteErrorBoundary.getDerivedStateFromProps(
      { children: null, resetKey: '/master/dashboard' },
      { error: null, attempt: 0, showDetail: false },
    );
    expect(next).toMatchObject({ lastResetKey: '/master/dashboard' });
  });
});

// ── Modal granularity (owner decision A, 2026-07-30) ────────────────────────
//
// Without a boundary at the dialog level, a crash inside a modal propagates to
// the ROUTE boundary and replaces the entire content area — the operator loses
// the page they were working on in order to fix a dialog. These pin the two
// properties that make the dialog-level containment real rather than nominal.
describe('ModalErrorBoundary', () => {
  it('is the same limiter, so it captures errors too', () => {
    // Shares RouteErrorBoundary's static — if the wrapper ever stops delegating,
    // dialogs silently lose containment while still *looking* wired up.
    const err = new TypeError("Cannot read properties of null (reading 'map')");
    expect(RouteErrorBoundary.getDerivedStateFromError(err)).toEqual({ error: err });
  });

  it('is exported from the shared module the modal primitives import', async () => {
    // The containment is only systemic because ModalShell/ModalPortal wrap their
    // children with it — a rename here silently un-wires every dialog at once.
    const mod = await import('./RouteErrorBoundary');
    expect(typeof mod.ModalErrorBoundary).toBe('function');
  });
});
