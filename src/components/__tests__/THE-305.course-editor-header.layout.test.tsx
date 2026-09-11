// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom, and this is load-bearing — the same reason THE-286's,
// THE-296's and THE-300's layout suites give. Every question in this file is a
// LAYOUT question and happy-dom cannot answer one: with the real compiled
// stylesheet injected, `getBoundingClientRect()` returns all zeros and
// `getComputedStyle(el).display` answers `block` for a flex container. Under the
// repo's default happy-dom environment the globals are replaced with
// browser-semantics ones, and a request to the browser's own debugger port then
// fails same-origin, so the measuring browser can never be attached to.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { setUpOrFail } from '../../test/support/suite-setup';
import { execFileSync } from 'node:child_process';
import { DENSITY_PX } from '../layout/form-layout';

const ROOT = path.resolve(__dirname, '../../..');
function baseRef(): string {
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  for (const ref of ['origin/main', 'refs/remotes/origin/main', 'main']) {
    try { return git(['rev-parse', '--verify', `${ref}^{commit}`]); } catch { /* next */ }
  }
  try {
    const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']).split(/\s+/);
    if (parents.length === 3) return parents[1];
  } catch { /* fall through */ }
  throw new Error('the base commit could not be resolved, so this would measure nothing');
}

/**
 * THE-305 — the course editor header, measured in a real browser.
 *
 * ── WHAT IS ACTUALLY AT RISK HERE ───────────────────────────────────────────
 * The change deletes two elements from the editor's top bar (a back arrow and a
 * three-line-wrapping <h1>) and swaps nine emoji for lucide svgs at the sizes
 * the emoji rendered at. Both directions of that are width-relevant, so both are
 * measured rather than reasoned about:
 *
 *   the deletion   strictly REMOVES width pressure from the top bar, which is
 *                  the row that also carries the status pill and three buttons.
 *                  The claim is that removing the heading did not let the row
 *                  reflow into something that overflows at some other width.
 *   the icons      an emoji is one text glyph; an svg is a box with its own
 *                  intrinsic width. Three of them landed in the lesson meta row
 *                  and one in the Featured Course row, so a naive swap could
 *                  widen either.
 *
 * ── ⚠️ WIDTH IS NOT MONOTONIC ───────────────────────────────────────────────
 * #426 measured a card falling TWICE, narrowest at 1280. So all five viewports
 * are measured, not just the extremes, and 1280 is not treated as "between"
 * 1024 and 1440.
 *
 * ── ⚠️ SETTLE BEFORE MEASURING ──────────────────────────────────────────────
 * The editor's Featured Course row carries `transition: all 0.2s`, and THE-295
 * read 1018px against a real 224px by measuring immediately after a resize.
 * `evaluateAt` awaits the browser's own settle (two animation frames) before it
 * evaluates, which is why every number below goes through it.
 */

/* ── the editor renders against a real backend; none of it is needed here ─── */
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u', email: 'a@t.com' } } }));
vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => 'tenant-1',
  getWriteTenantScope: async () => 'tenant-1',
}));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}), doc: () => ({}), query: () => ({}), where: () => ({}),
  addDoc: async () => ({ id: 'c' }), updateDoc: async () => {}, deleteDoc: async () => {},
  setDoc: async () => {}, getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  getDocs: async () => ({ forEach: () => {} }),
}));
vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'GET', WRITE: 'WRITE', UPDATE: 'UPDATE', DELETE: 'DELETE' },
  handleFirestoreError: () => {},
}));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('../ImageUpload', () => ({ ImageUpload: () => <div data-image-upload="" /> }));
vi.mock('../RichTextEditor', () => ({ default: () => <div data-rich-text="" /> }));

/** The ladder every layout suite in this repo uses. */
const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;
/** iPhone 14/15 logical height — a question about a fixed bottom bar is about
 *  the viewport's BOTTOM, and the harness's 1200px default is no phone. */
const PHONE_HEIGHT = 844;
/** Below Tailwind's `sm` (640px) this floor applies; at and above it Rule 4 does. */
const TOUCH_TARGET_MIN_PX = 44;

interface Box { x: number; width: number; height: number; right: number; label: string; tag: string }

let browser: MeasuringBrowser;

setUpOrFail(async () => {
  const css = await buildAppCss();
  const { default: AdminCourseEditor } = await import('../AdminCourseEditor');

  /*
   * Rendered as STATIC MARKUP rather than mounted: the editor loads authors and
   * categories from Firestore on mount, and this file's questions are about the
   * chrome (the top bar, the tab bar, the Course Info panel), all of which is in
   * the first paint. The real component and its real class/style strings are
   * used — nothing about the header is re-typed into a fixture here.
   */
  const body = renderToStaticMarkup(
    <div data-editor-under-test>
      {React.createElement(AdminCourseEditor, { course: null, onClose: () => {} })}
      {/*
        The bottom nav, at its real layer, with a realistic 44px item inside it.

        CLEARANCE IS MADE EXPLICIT rather than inherited. The admin shell still
        carries the safe-area padding utility that THE-295 established emits no
        rule at all when compiled — it is inert there, and #437 fixed only the
        member shell — so the nav is exactly as tall as its content and nothing
        below may depend on that class reserving anything. It is deliberately not
        spelled here: this fixture models the nav's LAYER and HEIGHT, which is
        what the editor has to clear, and THE-295 owns the inventory of that
        class's real uses.
      */}
      <div
        data-nav
        className="fixed bottom-0 left-0 right-0 z-[100] bg-surface-raised border-t border-line"
      >
        <span style={{ display: 'inline-block', height: '44px' }} />
      </div>
    </div>,
  );

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the305-'));
  const file = path.join(dir, 'editor.html');
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>` +
    `<style>body{margin:0}</style></head><body>${body}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);
}, 180_000);

afterAll(async () => { await browser?.close(); });

/** The document's own overflow at `viewport`, plus the widest box in it. */
async function overflowAt(viewport: number) {
  return browser.evaluateAt<{ scrollWidth: number; clientWidth: number; widest: Box | null }>(
    viewport,
    `(() => {
      const root = document.querySelector('[data-editor-under-test]');
      let widest = null;
      for (const el of root.querySelectorAll('*')) {
        const b = el.getBoundingClientRect();
        if (b.width === 0) continue;
        if (!widest || b.right > widest.right) {
          widest = {
            x: b.x, width: b.width, height: b.height, right: b.right,
            tag: el.tagName.toLowerCase(),
            label: (el.getAttribute('placeholder') || (el.textContent || '').trim().slice(0, 30)),
          };
        }
      }
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        widest,
      };
    })()`,
    PHONE_HEIGHT,
  );
}

/** Every interactive control the editor paints, with its real box. */
async function controlsAt(viewport: number) {
  return browser.evaluateAt<Box[]>(
    viewport,
    `(() => {
      const root = document.querySelector('[data-editor-under-test]');
      return [...root.querySelectorAll('button, select, input, textarea')]
        .filter((el) => !el.closest('[data-nav]'))
        .map((el) => {
          const b = el.getBoundingClientRect();
          return {
            x: b.x, width: b.width, height: b.height, right: b.right,
            tag: el.tagName.toLowerCase(),
            label: (el.getAttribute('placeholder') || (el.textContent || '').trim().slice(0, 30) || el.tagName),
          };
        })
        .filter((b) => b.width > 0 && b.height > 0);
    })()`,
    PHONE_HEIGHT,
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. 🔴 No horizontal overflow, at all five widths.
// ═════════════════════════════════════════════════════════════════════════════
describe('no horizontal overflow at 380 / 768 / 1024 / 1280 / 1440', () => {
  for (const viewport of VIEWPORTS) {
    it(`the document does not scroll sideways at ${viewport}px`, async () => {
      const { scrollWidth, clientWidth, widest } = await overflowAt(viewport);
      expect(
        scrollWidth,
        `the page scrolls sideways at ${viewport}px — widest box: ` +
        `<${widest?.tag}> "${widest?.label}" right=${widest?.right}`,
      ).toBeLessThanOrEqual(clientWidth);
    });

    it(`no element reaches past the viewport at ${viewport}px`, async () => {
      // scrollWidth alone can be satisfied by an ancestor clipping the overflow.
      // The widest box's own right edge is the stronger question.
      const { widest, clientWidth } = await overflowAt(viewport);
      expect(widest, 'nothing was measured at all — the fixture rendered empty').not.toBeNull();
      expect(
        Math.round(widest!.right),
        `<${widest!.tag}> "${widest!.label}" reaches ${widest!.right}px at ${viewport}px`,
      ).toBeLessThanOrEqual(clientWidth + 1);
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Touch targets: the 44px floor below sm, Rule 4's band above it.
// ═════════════════════════════════════════════════════════════════════════════
describe('every control is a real target below sm, and Rule 4 holds above', () => {
  /**
   * ⚠️ Rule 4 is deliberately NOT 44px, and this file does not fight it.
   * `DENSITY_PX.control` is 38 and `AdminCRM.desktop-layout.test.tsx` asserts
   * `DENSITY_PX.control < 44` on purpose: 44 is a THUMB floor, and a desktop
   * pointer is not a thumb. So the floor is asserted below `sm` only.
   */
  it('keeps Rule 4\'s desktop band exactly where it was', () => {
    expect(DENSITY_PX.control, 'Rule 4\'s desktop control height moved').toBe(38);
    expect(DENSITY_PX.control, 'the deliberate sub-44 desktop density was raised').toBeLessThan(TOUCH_TARGET_MIN_PX);
  });

  it('gives every control THE-305 added a 44px target at 380px', async () => {
    // Scoped to what this ticket is answerable for. The editor's own Save
    // Draft / Publish / tab buttons predate it and carry their own inline
    // padding; widening that band is a different ticket and would be a
    // gratuitous change to a screen this one is only de-duplicating.
    const controls = await controlsAt(380);
    expect(controls.length, 'no controls were measured — the fixture rendered empty').toBeGreaterThan(0);

    // The Featured Course row is the control this ticket actually reshaped: the
    // emoji span became an svg inside the same clickable row.
    const featured = await browser.evaluateAt<Box | null>(380, `(() => {
      const rows = [...document.querySelectorAll('[data-editor-under-test] div')].filter((d) => {
        const t = d.textContent || '';
        return t.includes('Featured Course') && t.includes('Pinned at the top of the course library');
      });
      if (!rows.length) return null;
      const el = rows[0];
      const b = el.getBoundingClientRect();
      return { x: b.x, width: b.width, height: b.height, right: b.right, tag: 'row', label: 'Featured Course' };
    })()`, PHONE_HEIGHT);

    expect(featured, 'the Featured Course row was not found').not.toBeNull();
    expect(
      featured!.height,
      'the Featured Course row is below the 44px touch floor on a phone',
    ).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
  });

  it('does not force the 44px floor onto desktop', async () => {
    // The other half of the same rule: at 1280 the band is allowed to be the
    // settled 38-40px, and a test that demanded 44 everywhere would break it.
    const controls = await controlsAt(1280);
    expect(controls.length).toBeGreaterThan(0);
    // Nothing here asserts a maximum; the claim is only that this ticket did not
    // introduce a floor that fights Rule 4. Recorded as an explicit no-op so the
    // absence is deliberate rather than forgotten.
    expect(DENSITY_PX.control).toBeLessThan(TOUCH_TARGET_MIN_PX);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Clearance under the bottom nav, made explicit.
// ═════════════════════════════════════════════════════════════════════════════
describe('the editor clears the fixed bottom nav', () => {
  it('introduces no new dialog that would have to clear the nav', () => {
    // #437 raised the shared primitives to scrim z-[101] / panel z-[102], so a
    // NEW dialog would be fine — but the honest claim for this ticket is that it
    // adds none, and that is checkable rather than assertable-by-assertion.
    const diff = execFileSync('git', ['diff', baseRef(), '--', 'src/components/AdminCourseEditor.tsx'],
      { cwd: ROOT, encoding: 'utf8' });
    const added = diff.split('\n').filter((l) => /^\+[^+]/.test(l));
    const layered = added.filter((l) => /z-\[|zIndex|position:\s*['"]?fixed/.test(l));
    expect(layered, 'THE-305 introduced a new layer that must clear the bottom nav').toEqual([]);
  });

  it('leaves the nav sitting above the editor at every width', async () => {
    for (const viewport of VIEWPORTS) {
      const z = await browser.evaluateAt<{ nav: string; editorMax: number }>(viewport, `(() => {
        const nav = document.querySelector('[data-nav]');
        const root = document.querySelector('[data-editor-under-test]');
        let max = 0;
        for (const el of root.querySelectorAll('*')) {
          if (el.closest('[data-nav]')) continue;
          const v = parseInt(getComputedStyle(el).zIndex, 10);
          if (!Number.isNaN(v)) max = Math.max(max, v);
        }
        return { nav: getComputedStyle(nav).zIndex, editorMax: max };
      })()`, PHONE_HEIGHT);
      expect(
        Number(z.nav),
        `the editor paints above the bottom nav at ${viewport}px`,
      ).toBeGreaterThan(z.editorMax);
    }
  });
});
