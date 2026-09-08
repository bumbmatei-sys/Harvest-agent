import '@testing-library/jest-dom/vitest';

/**
 * THE-334 — `Element.getAnimations`, which happy-dom does not implement.
 *
 * Base UI's `ScrollArea` viewport calls `viewport.getAnimations()` on every
 * scroll-state effect (`scroll-area/viewport/ScrollAreaViewport.js`), and in
 * happy-dom that is `undefined`, so the call THROWS. ⚠️ It throws from inside an
 * effect, so no assertion fails and no test goes red — vitest counts it as an
 * UNHANDLED ERROR and the run EXITS 1 WITH EVERY TEST PASSING, which is exactly
 * the failure mode this repo already has one documented instance of (the stray
 * `sonner` timer, card 86bbwjkvc). One is enough.
 *
 * 🔴 This is an ENVIRONMENT GAP, not a product defect, so it is fixed in the
 * environment rather than by avoiding the primitive: `scroll-area` is what makes
 * a nine-tab group scroll inside the full-height nav flyout, and hand-rolling an
 * `overflow-y-auto` div to dodge a missing DOM method would be trading a real
 * primitive for a test harness's omission.
 *
 * `[]` is what a real browser returns when nothing is animating, which is always
 * true here: happy-dom runs no animations at all.
 */
if (typeof Element !== 'undefined' && typeof Element.prototype.getAnimations !== 'function') {
  Element.prototype.getAnimations = function getAnimations() {
    return [];
  };
}
