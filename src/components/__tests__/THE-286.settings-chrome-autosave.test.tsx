import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import SectionHeading from '../settings/SectionHeading';
import SettingsAccordion from '../settings/SettingsAccordion';
import {
  AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_ERROR_TOAST_ID, AUTOSAVE_SAVED_TOAST_ID, AUTOSAVE_EXCLUDED,
} from '../settings/autosave';
import { DELETE_CONFIRM_COPY } from '../../lib/member-erasure-copy';
import UNTOUCHED from './__fixtures__/the-286-untouched.json';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-286 — the shared settings chrome, autosave, and ONE section as proof
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ─── 🔴 What this slice turned out to be, against what the brief expected ────
 *
 * The brief asked for `SectionHeading.tsx` (59 lines) and `SettingsAccordion.tsx`
 * (141 lines) to be BUILT. Both already existed at exactly those sizes, shipped
 * by THE-183, and `AdminSettings` already mounts the accordion with grouped
 * regions and a cordoned danger zone. The brief's own arithmetic says so: it
 * counts "13 files in settings/ totalling ~3,700 lines", and settings/ holds 15
 * source files totalling 3,925 — the 13 are what is left once these two chrome
 * files are taken out.
 *
 * So the chrome was not built here. What was missing is the autosave mechanism
 * and a section that actually INHERITS the chrome instead of drawing a second
 * copy of it, and that is what this suite pins.
 *
 * ─── Where the geometry lives ────────────────────────────────────────────────
 *
 * Tests 12 and 13 (44px targets, nav clearance, dialog z-order) are NOT here.
 * happy-dom has no layout engine — `getBoundingClientRect()` returns zeros and
 * `getComputedStyle` calls a flex container `block` — so they are asked over CDP
 * in real Chromium by `THE-286.settings-chrome-autosave.layout.test.tsx`.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.resolve(__dirname, '../../..');
const readSrc = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const SECTION = 'src/components/settings/GivingStatementsSection.tsx';

/**
 * Source with every comment removed — block, line and JSX.
 *
 * ⚠️ Load-bearing for most guards below. These files DISCUSS the thing being
 * forbidden: this section's header names the `bg-surface-raised rounded-2xl`
 * card it stopped drawing, `autosave.ts` cites PR `#428`, and
 * PlanUpgradeSection's own comment quotes the `$39` literal that outlived a
 * reprice. Grepping raw text would fail on the documentation and pass on the
 * defect — exactly backwards.
 */
function code(rel: string): string {
  return readSrc(rel)
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')  // JSX  {/* … */}
    .replace(/\/\*[\s\S]*?\*\//g, ' ')                // block /* … */
    .replace(/^[ \t]*\/\/.*$/gm, ' ');                  // line //
}

/* ── Firestore / firebase / sonner doubles ────────────────────────────────── */

/** Typed with the arguments the section really passes, so `mock.calls[n][1]`
 *  is the write payload rather than an element of an empty tuple. */
type DocRef = { path: string };
type WritePayload = Record<string, unknown>;
type Snapshot = { exists: () => boolean; data: () => Record<string, unknown> };

const updateDoc = vi.hoisted(() =>
  vi.fn(async (_ref: DocRef, _data: Record<string, unknown>): Promise<void> => undefined));
const getDoc = vi.hoisted(() =>
  vi.fn(async (_ref: DocRef): Promise<{ exists: () => boolean; data: () => Record<string, unknown> }> => ({
    exists: () => true,
    data: () => ({ tenantId: 't1', config: { givingStatements: { ein: '', address: '', footer: '' } } }),
  })));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...rest: string[]) => ({ path: rest.join('/') }),
  getDoc,
  updateDoc,
}));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));

/**
 * MEMBER_DATA_MAP lives in a SERVER module — it pulls firebase-admin at import
 * time, which is exactly why `DELETE_CONFIRM_COPY` is a checked-in cache of the
 * derivation in the first place (a `"use client"` component cannot import it).
 * Mocked the same way `member-erasure.test.ts` and
 * `PersonalInformationModal.delete-copy.test.tsx` mock it — the MAP itself is
 * the real one, so test 8 compares the shipped copy against the live
 * derivation and not against another copy of itself.
 */
vi.mock('@/lib/firebase-admin', async () => {
  const m = await import('@/test/mocks/firestore-tree');
  return { adminDb: m.adminDb, adminAuth: m.adminAuth, getReceiptsBucket: m.getReceiptsBucket };
});
vi.mock('firebase-admin/firestore', async () => {
  const m = await import('@/test/mocks/firestore-tree');
  return { FieldValue: m.FieldValue };
});

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

/* ── mounting ─────────────────────────────────────────────────────────────── */

let host: HTMLDivElement;
let root: Root;

const TENANT_DOC: Snapshot = {
  exists: () => true,
  data: () => ({ tenantId: 't1', config: { givingStatements: { ein: '', address: '', footer: '' } } }),
};

beforeEach(() => {
  vi.clearAllMocks();
  // Set both implementations explicitly rather than leaning on what
  // `clearAllMocks` leaves behind: a `getDoc` that resolves to nothing means
  // the section never primes its baseline, and every field then looks changed.
  getDoc.mockResolvedValue(TENANT_DOC);
  updateDoc.mockResolvedValue(undefined);
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

/** Mount the proof section and let its lazy load settle. */
async function mountSection() {
  const { GivingStatementsSection } = await import('../settings/GivingStatementsSection');
  await act(async () => { root.render(<GivingStatementsSection />); });
  // The section's loader is a chain of dynamic imports and awaited promises;
  // flushing the microtask queue under fake timers needs the real queue to turn.
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  return host;
}

const field = (name: string) =>
  host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-autosave="${name}"]`)!;

/** Type into a controlled input the way React's synthetic onChange sees it. */
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value',
    )!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/**
 * ⚠️ `focusout`, NOT `blur`. React delivers `onBlur` from the native focusOUT
 * event, because `blur` does not bubble and React's listener sits on the root
 * container. Dispatching `blur` here fires nothing and every blur assertion
 * below would pass vacuously.
 */
async function blur(el: HTMLElement) {
  await act(async () => { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 — the shared chrome
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('1 · SectionHeading and SettingsAccordion render the new language', () => {
  it('the heading is the eyebrow, tone-aware, and desktop-gated', async () => {
    await act(async () => {
      root.render(
        <div>
          <SectionHeading>Church Setup</SectionHeading>
          <SectionHeading tone="danger">Danger Zone</SectionHeading>
        </div>,
      );
    });
    const headings = [...host.querySelectorAll('[data-settings-heading]')];
    expect(headings.map((h) => h.getAttribute('data-settings-heading'))).toEqual(['default', 'danger']);

    // The eyebrow AdminSettings already draws above its own page title — one
    // type size, not a new one — and the ink token for each tone.
    for (const h of headings) {
      const cls = h.className;
      for (const token of ['text-[11px]', 'uppercase', 'tracking-[0.16em]', 'font-semibold']) {
        expect(cls, `the heading lost ${token}`).toContain(token);
      }
      // Desktop-gated by construction: a heading is in-flow DOM, so rendering
      // it below `sm` would push every row under it down a phone screen.
      expect(cls).toContain('hidden');
      expect(cls).toContain('sm:block');
    }
    expect(headings[0].className).toContain('text-faint');
    expect(headings[1].className).toContain('text-danger');
  });

  it('the accordion groups consecutive rows into named regions and cordons the danger one', async () => {
    await act(async () => {
      root.render(
        <SettingsAccordion
          sections={[
            { id: 'a', group: 'Church Setup', label: 'A', icon: null, content: <p>BODY_ONE</p> },
            { id: 'b', group: 'Church Setup', label: 'B', icon: null, content: <p>BODY_TWO</p> },
            { id: 'c', group: 'Danger Zone', label: 'C', icon: null, content: <p>BODY_THREE</p>, danger: true },
            { id: 'hidden', group: 'Gone', label: 'H', icon: null, content: <p>BODY_HIDDEN</p>, hidden: true },
          ]}
        />,
      );
    });

    const regions = [...host.querySelectorAll('[data-settings-region]')];
    // Consecutive rows sharing a label are ONE region; a group whose rows are
    // all hidden leaves no orphan heading behind.
    expect(regions.map((r) => r.getAttribute('data-settings-region'))).toEqual(['Church Setup', 'Danger Zone']);
    expect([...host.querySelectorAll('[data-settings-row]')].map((r) => r.getAttribute('data-settings-row')))
      .toEqual(['a', 'b', 'c']);

    // The danger region is separated, not merely last: a rule plus a full
    // section gap of padding, and the gap is Rule 4's number.
    const danger = regions[1].className;
    expect(danger).toContain('sm:border-t');
    expect(danger).toContain('sm:pt-[28px]');

    // Exactly one row open at a time — a single piece of state across the screen.
    const buttons = [...host.querySelectorAll('button')];
    await act(async () => { buttons[0].click(); });
    expect(host.textContent).toContain('BODY_ONE');
    await act(async () => { buttons[1].click(); });
    expect(host.textContent, 'two rows were open at once').not.toContain('BODY_ONE');
    expect(host.textContent).toContain('BODY_TWO');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2 — 🔴 the point of the slice
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('2 · the proof section inherits the chrome without its own styling', () => {
  const section = () => code(SECTION);

  it('draws no card, no input chrome and no heading of its own', () => {
    const src = section();

    // (a) The accordion row already IS the card. The section used to draw a
    //     second one inside it — two borders, two radii, two surfaces for one
    //     panel — which is precisely "its own styling instead of inheriting".
    for (const own of [
      'bg-surface-raised', 'rounded-2xl', 'rounded-xl', 'border-line-subtle',
      'shadow-[var(--ds-sh-sm)]',
    ]) {
      expect(src, `the section draws its own ${own} — that is the accordion row's job`)
        .not.toContain(own);
    }

    // (b) No bespoke input chrome. It used to spell this three times.
    for (const own of ['focus:ring-gold', 'px-4 py-2.5', 'focus:border-transparent']) {
      expect(src, `the section spells its own input chrome (${own})`).not.toContain(own);
    }

    // (c) No second copy of SectionHeading's eyebrow. BrandingSection spells
    //     `text-[11px] uppercase tracking-[0.14em]` three times — a fourth
    //     definition of the heading is what this slice exists to stop.
    expect(src, 'the section re-spells the eyebrow instead of using SectionHeading')
      .not.toMatch(/text-\[11px\][^\n]*uppercase|uppercase[^\n]*tracking-\[0\.1[46]em\]/);

    // (d) No inline style at all. The old bottom clearance was
    //     `style={{ paddingBottom: 120 }}` — a magic number in an attribute no
    //     stylesheet can see and no media query can reach.
    expect(src, 'the section carries an inline style').not.toMatch(/style=\{\{/);
  });

  it('takes its field chrome from the installed primitives and its density from form-layout', () => {
    const src = section();
    // The primitives, not a private re-implementation. All 29 are already
    // installed; this adds none.
    for (const primitive of ['@/components/ui/field', '@/components/ui/input', '@/components/ui/textarea']) {
      expect(src, `the section does not use ${primitive}`).toContain(primitive);
    }
    for (const el of ['<Field', '<FieldLabel', '<Input', '<Textarea', '<FieldError']) {
      expect(src, `${el} is not used`).toContain(el);
    }
    // Density is Rule 4's, spelled once via the module rather than re-derived.
    expect(src, 'the section invents its own density').toContain('CONTROL_DENSITY');
    expect(src).toContain("from '../layout/form-layout'");
  });

  it('invents no width — every max-w comes from form-layout', () => {
    expect(section(), 'the section invents a width').not.toMatch(/max-w-/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3 — autosave on change or blur
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('3 · a field autosaves on change or blur and shows a toast', () => {
  it('writes once the debounce elapses, and confirms with a toast', async () => {
    await mountSection();
    await type(field('ein'), '12-3456789');

    // Nothing yet: this is the whole point of the debounce.
    expect(updateDoc).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS); });

    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect(updateDoc.mock.calls[0][1]).toMatchObject({ 'config.givingStatements.ein': '12-3456789' });
    expect(toast.success).toHaveBeenCalledWith('Saved', { id: AUTOSAVE_SAVED_TOAST_ID });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('writes immediately on blur rather than waiting out the debounce', async () => {
    await mountSection();
    await type(field('address'), '123 Faith St');
    await blur(field('address'));

    // No timer advance at all — a person who has moved on has finished.
    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect(updateDoc.mock.calls[0][1]).toMatchObject({ 'config.givingStatements.address': '123 Faith St' });

    // And the blur ABSORBED the queued debounce rather than racing it: letting
    // the timer land afterwards would write the same value a second time.
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2); });
    expect(updateDoc).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when a field is blurred untouched', async () => {
    await mountSection();
    await blur(field('ein'));
    await blur(field('address'));
    await blur(field('footer'));
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2); });
    // "Changed" is measured against what the server is known to hold, so
    // tabbing through a panel costs nothing.
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('agrees with the server writer, and stops clobbering `country`', async () => {
    // 🔴 The old Save button replaced the WHOLE `config.givingStatements` map
    // with the three fields this panel knows about. The server route
    // (app/api/giving-statements/config/route.ts) writes a FOURTH — `country`,
    // defaulted to 'US' and read by the statement generator — with
    // `{ merge: true }` precisely so it is not clobbered. A whole-map write
    // from the client erased it. One dotted path per field has the server's
    // merge semantics and cannot.
    await mountSection();
    await type(field('ein'), '12-3456789');
    await blur(field('ein'));
    const payload = updateDoc.mock.calls[0][1] as WritePayload;
    expect(Object.keys(payload).some((k) => k.startsWith('config.givingStatements.')),
      'the write is not a per-field path').toBe(true);
    expect(Object.keys(payload), 'a whole-map write would erase config.givingStatements.country')
      .not.toContain('config.givingStatements');

    // And the VALUE shape matches the server's: a trimmed string, never null.
    // The old client wrote `ein.trim() || null` while the route wrote
    // `body.ein.trim()`, so two writers disagreed about the same field.
    expect(payload['config.givingStatements.ein']).toBe('12-3456789');
    const route = readSrc('src/app/api/giving-statements/config/route.ts');
    expect(route, 'the server writer changed shape — re-check this agreement')
      .toContain('givingStatements.ein = body.ein.trim()');
  });

  it('writes an emptied field as a trimmed string rather than null', async () => {
    getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ tenantId: 't1', config: { givingStatements: { ein: '99', address: '', footer: '' } } }),
    });
    await mountSection();
    await type(field('ein'), '');
    await blur(field('ein'));
    const payload = updateDoc.mock.calls[0][1] as WritePayload;
    expect(payload['config.givingStatements.ein'], 'an emptied field writes null again').toBe('');
  });

  it('writes one field without clobbering its siblings', async () => {
    await mountSection();
    await type(field('ein'), '99');
    await blur(field('ein'));
    // A DOTTED path. Writing the whole `config.givingStatements` map would let
    // three independent autosaves each put their own stale copy of the other
    // two fields back.
    const payload = updateDoc.mock.calls[0][1] as WritePayload;
    expect(Object.keys(payload)).toContain('config.givingStatements.ein');
    expect(Object.keys(payload)).not.toContain('config.givingStatements');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4 — 🔴 THE MOST IMPORTANT TEST HERE
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('4 · a FAILED autosave surfaces visibly and does not silently discard the edit', () => {
  beforeEach(() => { updateDoc.mockRejectedValue(new Error('permission-denied')); });
  afterEach(() => { updateDoc.mockReset(); updateDoc.mockResolvedValue(undefined); });

  it('says so in a toast, keeps the edit on screen, and leaves a durable marker', async () => {
    await mountSection();
    await type(field('ein'), '12-3456789');
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS); });

    // (a) 🔴 LOUD. Not a console line — the failure reaches the person.
    expect(toast.error).toHaveBeenCalledTimes(1);
    const [message, opts] = toast.error.mock.calls[0] as [string, { id: string }];
    expect(message).toMatch(/could not save/i);
    // The copy must promise the work is not lost, because that is the thing a
    // person needs to know before they retype it.
    expect(message).toMatch(/still here/i);
    // A fixed id, so a run of failures offline replaces rather than stacks.
    expect(opts.id).toBe(AUTOSAVE_ERROR_TOAST_ID);
    expect(toast.success).not.toHaveBeenCalled();

    // (b) 🔴 THE EDIT SURVIVES. The value the person typed is still in the
    //     field — the hook does not own it and cannot revert it.
    expect(field('ein').value).toBe('12-3456789');

    // (c) 🔴 DURABLE. A toast fades, and a settings field is exactly the
    //     surface someone edits and walks away from. The failure is also in
    //     the DOM, with role="alert" so it reaches a screen reader.
    const alert = host.querySelector('[role="alert"]');
    expect(alert, 'a failed autosave left no visible marker in the field').not.toBeNull();
    expect(alert!.textContent).toMatch(/not saved/i);
    expect(alert!.textContent).toMatch(/still here/i);
  });

  it('the marker persists — it is not a transient that clears itself', async () => {
    await mountSection();
    await type(field('ein'), '12');
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS); });
    expect(host.querySelector('[role="alert"]')).not.toBeNull();

    // Well past any toast lifetime. The field is still marked.
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(host.querySelector('[role="alert"]'), 'the failure marker cleared itself').not.toBeNull();
    expect(field('ein').value).toBe('12');
  });

  it('offers a retry that actually re-writes, and clears once it lands', async () => {
    await mountSection();
    await type(field('ein'), '12-3456789');
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS); });
    expect(host.querySelector('[role="alert"]')).not.toBeNull();

    updateDoc.mockReset();
    updateDoc.mockResolvedValue(undefined);
    const retry = [...host.querySelectorAll('button')].find((b) => /retry/i.test(b.textContent || ''))!;
    expect(retry, 'a failed autosave offered no retry').toBeTruthy();
    await act(async () => { retry.click(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect(updateDoc.mock.calls[0][1]).toMatchObject({ 'config.givingStatements.ein': '12-3456789' });
    expect(host.querySelector('[role="alert"]'), 'the marker survived a successful retry').toBeNull();
  });

  it('a stale failure cannot raise an alarm about a value already saved', async () => {
    // An older write failing AFTER a newer one succeeded is news about content
    // the server already has. Raising it would be an alarm nobody can act on.
    await mountSection();
    let failSlow: (e: Error) => void = () => {};
    updateDoc.mockReset();
    updateDoc.mockImplementationOnce(() => new Promise<void>((_, rej) => { failSlow = rej; }));
    updateDoc.mockResolvedValue(undefined);

    await type(field('ein'), 'first');
    await blur(field('ein'));            // write 1 — hangs
    await type(field('ein'), 'second');
    await blur(field('ein'));            // write 2 — succeeds
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    await act(async () => { failSlow(new Error('too late')); await vi.advanceTimersByTimeAsync(0); });

    expect(toast.error, 'a superseded failure raised an alarm').not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5 — the debounce bound
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('5 · writes are debounced', () => {
  it('collapses a burst of keystrokes into exactly one write', async () => {
    await mountSection();
    const el = field('ein');
    // Ten characters typed a beat apart — the EIN field's real length. Without
    // a bound this is ten Firestore writes for one value.
    for (const v of ['1', '12', '12-', '12-3', '12-34', '12-345', '12-3456', '12-34567', '12-345678', '12-3456789']) {
      await type(el, v);
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    }
    expect(updateDoc, 'a write escaped before the debounce elapsed').not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS); });
    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect(updateDoc.mock.calls[0][1]).toMatchObject({ 'config.givingStatements.ein': '12-3456789' });
  });

  it('the bound is 2000ms, and nothing lands one tick early', async () => {
    // Asserted against the exported constant rather than a literal read out of
    // a timer, and pinned to the number AdminDocs already spends.
    expect(AUTOSAVE_DEBOUNCE_MS).toBe(2000);

    await mountSection();
    await type(field('ein'), 'x');
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 1); });
    expect(updateDoc).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(updateDoc).toHaveBeenCalledTimes(1);
  });

  it('typing a character and deleting it again costs nothing', async () => {
    await mountSection();
    await type(field('ein'), 'x');
    await type(field('ein'), '');
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2); });
    expect(updateDoc, 'a no-op edit spent a write').not.toHaveBeenCalled();
  });

  it('a queued write is flushed on unmount rather than dropped', async () => {
    await mountSection();
    await type(field('ein'), 'queued');
    // Closing the accordion row inside the debounce window used to discard
    // everything typed since the last write.
    await act(async () => { root.unmount(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect(updateDoc.mock.calls[0][1]).toMatchObject({ 'config.givingStatements.ein': 'queued' });
    root = createRoot(host); // afterEach unmounts
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6 — 🔴 the exclusion list
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('6 · money-path and destructive fields do NOT autosave', () => {
  /**
   * 🔴 A SOURCE SWEEP, NOT A SPOT CHECK. The list in `autosave.ts` is
   * documentation; this is the enforcement. Adding autosave to any money-path
   * or destructive file fails here whether or not anybody remembers to update
   * the list.
   */
  it.each(AUTOSAVE_EXCLUDED.map((e) => [e.field, e.file, e.why] as const))(
    'never autosaves %s (%s)',
    (_fieldName, file, why) => {
      const src = readSrc(file);
      expect(src, `${file} imports the autosave hook — it is on the exclusion list`)
        .not.toMatch(/from ['"][^'"]*settings\/autosave['"]/);
      expect(src, `${file} calls useAutosaveField`).not.toContain('useAutosaveField');
      // A stated reason, so the list cannot grow entries nobody justified.
      expect(why.length, `${file} is excluded without a stated reason`).toBeGreaterThan(60);
    },
  );

  it('covers the money path and every destructive action by name', () => {
    const files = new Set(AUTOSAVE_EXCLUDED.map((e) => e.file));
    for (const required of [
      'src/components/settings/PlanUpgradeSection.tsx',   // runDodoPlanChange / armPlanRefresh
      'src/components/settings/AddOnsSection.tsx',        // a purchase and a downgrade
      'src/components/settings/BillingTermToggle.tsx',    // what is charged, and over what period
      'src/components/settings/PaymentSection.tsx',       // where donations are paid out
      'src/components/settings/DomainSection.tsx',        // repoints a live site
      'src/components/settings/SmsSection.tsx',           // credentials, and a real billed send
      'src/components/AdminSettings.tsx',                 // Cancel Subscription
      'src/components/PersonalInformationModal.tsx',      // Delete Account
    ]) {
      expect(files, `${required} is not on the autosave exclusion list`).toContain(required);
    }
  });

  it('the plan change is still explicit and confirmed, and still arms the refresh window', () => {
    const plan = readSrc('src/components/settings/PlanUpgradeSection.tsx');
    expect(plan, 'the plan change no longer runs through runDodoPlanChange').toContain('runDodoPlanChange');
    expect(plan, 'the THE-217 refresh window is no longer armed').toContain('armPlanRefresh()');
    // It is reached from a click handler, not from a field's onChange.
    expect(plan, 'a plan change became a field change').not.toMatch(/onChange=\{[^}]*runDodoPlanChange/);
  });

  it('Cancel Subscription still goes through its confirm panel', () => {
    const settings = readSrc('src/components/AdminSettings.tsx');
    expect(settings).toContain('setShowCancelConfirm(true)');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7 & 8 — the account-deletion flow (no-regression)
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('7 · the account-deletion flow is byte-identical', () => {
  const MODAL = 'src/components/PersonalInformationModal.tsx';

  it('the file is untouched, to the byte', async () => {
    const { createHash } = await import('node:crypto');
    const now = createHash('sha256').update(readFileSync(path.join(ROOT, MODAL))).digest('hex');
    expect(now, 'PersonalInformationModal.tsx changed — it carries the account-deletion flow')
      .toBe(UNTOUCHED.protectedFlows[MODAL as keyof typeof UNTOUCHED.protectedFlows]);
  });

  it('all eight outcome messages are present, verbatim', () => {
    const src = readSrc(MODAL);
    // Every outcome ENDS IN SOMETHING RENDERED. That is the whole point of the
    // machine: the member tapped Delete and the screen did not move.
    const OUTCOMES = [
      'You are not signed in. Sign in again and retry.',
      'Could not reach the server. Check your connection and try again.',
      'Your account and sign-in have been deleted. Signing you out now.',
      'For your security, confirm your password to finish deleting your account.',
      'Enter your password to continue.',
      'Incorrect password. Try again.',
    ];
    for (const message of OUTCOMES) {
      expect(src, `the outcome message "${message}" is gone`).toContain(message);
    }
    // The two multi-line ones (the federated-account instruction and the
    // server-step failure) are set via the same setter; count the setter calls
    // so a removed branch fails even though its copy is interpolated.
    const setterCalls = [...src.matchAll(/setDeleteMessage\(/g)].length;
    expect(setterCalls, 'a deleteMessage branch was added or removed').toBe(10); // 8 outcomes + 2 clears
  });

  it('the state machine, the silent-failure fix and the re-auth path are intact', () => {
    const src = readSrc(MODAL);
    expect(src).toContain("type DeleteFlowState = 'idle' | 'deleting' | 'reauth' | 'error' | 'done'");
    // The re-auth happens IN PLACE, with the same call the change-password flow
    // makes — not turned into "sign out and sign back in".
    expect(src, 'the re-auth path left the delete flow').toContain('reauthenticateWithCredential');
    expect(src).toContain('handleReauthAndDelete');
    // Both deletions happen on the server, in order. The client-side deleteDoc
    // was the bug that destroyed a sign-in and left the profile behind.
    expect(src).toContain('/api/account/delete');
  });
});

describe('8 · DELETE_CONFIRM_COPY still equals the live MEMBER_DATA_MAP derivation', () => {
  it('is deep-equal to the derivation, not a hand-maintained copy', async () => {
    const { MEMBER_DATA_MAP } = await import('@/lib/member-erasure');
    const { deriveErasureCopy, assertCopyCoversMap } = await import('../../lib/member-erasure-copy');
    // The map covers the copy, and the copy IS the derivation — so the delete
    // panel can never describe a set of collections the erasure does not touch.
    assertCopyCoversMap(MEMBER_DATA_MAP);
    expect(
      DELETE_CONFIRM_COPY,
      'DELETE_CONFIRM_COPY has drifted from the live MEMBER_DATA_MAP derivation',
    ).toEqual(deriveErasureCopy(MEMBER_DATA_MAP));
  });

  it('and the module it derives from is untouched', async () => {
    const { createHash } = await import('node:crypto');
    const rel = 'src/lib/member-erasure-copy.ts';
    const now = createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');
    expect(now).toBe(UNTOUCHED.protectedFlows[rel as keyof typeof UNTOUCHED.protectedFlows]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 9 — 🔴 nothing writes plan from the client
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('9 · nothing writes plan from the client', () => {
  /** Every client-side source file, swept — not a spot check on one section. */
  function clientFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === '__tests__' || entry === 'node_modules') continue;
        clientFiles(full, out);
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        out.push(full);
      }
    }
    return out;
  }

  it('no client module writes a `plan` field to Firestore — the webhook is the single writer', () => {
    // A Firestore write from the browser carrying a top-level `plan` key. The
    // webhook owns that field; anything here would be a second writer racing it.
    const WRITE = /\b(?:updateDoc|setDoc)\s*\(([\s\S]{0,600}?)\)\s*;/g;
    const offenders: string[] = [];

    for (const file of clientFiles(path.join(ROOT, 'src'))) {
      const rel = path.relative(ROOT, file);
      // API routes are server-side and are not "the client".
      if (rel.startsWith('src/app/api/')) continue;
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(WRITE)) {
        if (/(^|[{,\s])plan\s*:/.test(m[1]) || /['"]plan['"]\s*:/.test(m[1])) {
          offenders.push(`${rel}: ${m[0].slice(0, 120).replace(/\s+/g, ' ')}`);
        }
      }
    }
    expect(offenders, 'a client module writes `plan` — the webhook is the single writer').toEqual([]);
  });

  it('PlanUpgradeSection reaches the server for a plan change instead of writing it', () => {
    const plan = readSrc('src/components/settings/PlanUpgradeSection.tsx');
    expect(plan, 'PlanUpgradeSection writes Firestore directly').not.toMatch(/\bupdateDoc\s*\(/);
    expect(plan, 'PlanUpgradeSection writes Firestore directly').not.toMatch(/\bsetDoc\s*\(/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 10 & 11 — the two feature switches and the prices
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('10 · PaymentSection still renders unavailable and DomainSection is still hidden', () => {
  it('THE-256 — Stripe Connect stays behind its switch and the Connect UI is not restored', () => {
    // The switch is DEFINED in its own module (which imports nothing, so a
    // route handler can read it) and CONSUMED here.
    expect(code('src/lib/stripe-connect-feature.ts'), 'the Stripe Connect master switch was flipped')
      .toMatch(/STRIPE_CONNECT_ENABLED\s*=\s*false/);
    const src = readSrc('src/components/settings/PaymentSection.tsx');
    expect(src, 'PaymentSection stopped reading the switch').toContain('STRIPE_CONNECT_ENABLED');
    expect(src, 'PaymentSection no longer renders the unavailable state')
      .toContain('STRIPE_CONNECT_HIDDEN_MESSAGE');
    expect(code('src/lib/stripe-connect-feature.ts')).toMatch(/Temporarily unavailable/);
    // The Connect UI is mounted only behind the switch, never unconditionally.
    expect(src).toMatch(/STRIPE_CONNECT_ENABLED\s*\?\s*<StripeConnectPanel\s*\/>/);
  });

  it('#428 — custom domains stay behind their switch', () => {
    expect(code('src/lib/custom-domain-feature.ts'), 'the custom-domain master switch was flipped')
      .toMatch(/CUSTOM_DOMAIN_ENABLED\s*=\s*false/);
    const src = readSrc('src/components/settings/DomainSection.tsx');
    expect(src, 'DomainSection stopped reading the switch').toContain('CUSTOM_DOMAIN_ENABLED');
    expect(src, 'the hidden branch left DomainSection').toMatch(/!CUSTOM_DOMAIN_ENABLED\s*\?/);
  });

  it('and both files are untouched to the byte', async () => {
    const { createHash } = await import('node:crypto');
    for (const rel of [
      'src/components/settings/PaymentSection.tsx',
      'src/components/settings/DomainSection.tsx',
    ]) {
      const now = createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');
      expect(now, `${rel} changed`)
        .toBe(UNTOUCHED.otherSettingsSections[rel as keyof typeof UNTOUCHED.otherSettingsSections]);
    }
  });
});

describe('11 · no price literal appears — prices go through formatPlanPrice', () => {
  it('the plan card renders formatPlanPrice and spells no money literal', () => {
    const rel = 'src/components/settings/PlanUpgradeSection.tsx';
    expect(readSrc(rel), 'the plan card stopped using formatPlanPrice')
      .toContain('formatPlanPrice(planId, billingPeriod)');

    // A price literal outlived a reprice here once already: `monthlyPrice`/
    // `yearlyPrice` literals rendered while formatPlanPrice sat imported and
    // unused two lines away. The file's own comment still quotes "$39/mo" while
    // explaining that defect, which is why this reads code and not prose.
    const literals = [...code(rel).matchAll(/\$\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0]);
    expect(literals, 'a price literal is back in the plan card').toEqual([]);
  });

  it('no settings section spells a money literal', () => {
    const dir = path.join(ROOT, 'src/components/settings');
    const offenders: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (!/\.tsx?$/.test(entry)) continue;
      const body = code(`src/components/settings/${entry}`);
      for (const m of body.matchAll(/\$\d[\d,]*(?:\.\d+)?/g)) offenders.push(`${entry}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 14 — colour, emoji, palettes
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('14 · no colour hardcoded, no emoji, all four palettes resolve', () => {
  const TOUCHED = [SECTION, 'src/components/settings/autosave.ts'];

  it('hardcodes no colour', () => {
    for (const rel of TOUCHED) {
      // `code()`, not raw text: autosave.ts cites PR #428 in prose and `#428`
      // is a valid hex triple.
      expect(code(rel), `${rel} hardcodes a colour`)
        .not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d|hsla?\(\s*\d/);
    }
    // And no literal palette class either — the old section spelled
    // `text-green-600` for its success state.
    for (const rel of TOUCHED) {
      expect(code(rel), `${rel} spells a literal palette colour`)
        .not.toMatch(/\b(?:text|bg|border)-(?:red|green|blue|yellow|amber|emerald|slate|gray|grey|zinc)-\d{2,3}\b/);
    }
  });

  it('🔴 uses no emoji as UI — lucide-react is already imported', () => {
    // The section used to render `✓ Saved`. U+2713 is a dingbat standing in for
    // an icon, which is exactly what "no emoji as UI" forbids.
    const EMOJI = /[←-⇿⌀-➿⬀-⯿️\u{1F000}-\u{1FAFF}]/u;
    for (const rel of TOUCHED) {
      const found = code(rel).match(EMOJI);
      expect(found, `${rel} renders ${found?.[0]} as UI`).toBeNull();
    }
    expect(readSrc(SECTION), 'the section draws no icon from lucide-react').toContain("from 'lucide-react'");
  });

  it('every colour it does spell is a token the four palettes define — Classic first', () => {
    const globals = readSrc('src/app/globals.css');
    // Classic is the default since #409, so it is the one asserted first.
    const PALETTES = ['classic', 'harvest', 'light', 'dark'];
    for (const p of PALETTES) {
      expect(globals.toLowerCase(), `the ${p} palette is gone`).toContain(p);
    }
    // The tokens this slice's files actually name, and the bridge entries the
    // primitives resolve through. Every one is defined in globals.css already —
    // this slice adds none.
    for (const token of ['--text-faint', '--text-muted', '--destructive', '--muted-foreground']) {
      expect(globals, `${token} is not defined — this slice must not define it`).toContain(token);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 15 & 16 — the blast radius
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('15 · the other 12 sections are byte-identical', () => {
  it('there are exactly 12 of them, and this slice touched one', () => {
    // settings/ holds 15 source files: 2 chrome + 12 others + the 1 proof
    // section — which is the brief's own "13 files … ~3,700 lines" once the
    // chrome is taken out. `autosave.ts` is this slice's new file and is not
    // one of the 15.
    expect(Object.keys(UNTOUCHED.otherSettingsSections)).toHaveLength(12);
  });

  /**
   * ⚠️ A LATER TICKET HAS CONVERTED TWO MORE SECTIONS, so blanket byte-identity
   * across all twelve no longer states something true.
   *
   * Each is named here with the ticket that edited it and why, exactly as
   * `EDITED_SINCE_MEASUREMENT` does in admin-data-screens.desktop-layout.test.tsx
   * and preauth-funnel.desktop-layout.test.tsx (established by THE-195/THE-201).
   * The files stay IN `otherSettingsSections` rather than being dropped from it,
   * and they are exempted from ONE assertion — the digest — and nothing else.
   *
   * 🔴 This does not weaken the guard, for three reasons the list below enforces:
   * the exemption is per file and pinned WHOLE (widening it is an edit to the
   * literal on the next line, visible in review); an exempted file MUST actually
   * differ, so the entry cannot outlive the edit that justified it; and the ten
   * files nobody has touched are still hard-pinned by digest. What THE-286 was
   * really claiming about these two — that its own slice did not rewire them —
   * is now the stronger per-path claim in AdminSettings.regroup.test.tsx (a6)
   * and in THE-296's own suite.
   */
  const EDITED_SINCE_MEASUREMENT: ReadonlyArray<{ file: string; ticket: string; why: string }> = [
    {
      file: 'src/components/settings/OnboardingSection.tsx',
      ticket: 'THE-296',
      why:
        'Converted onto this slice\'s own chrome and autosave — it was the last section ' +
        'AdminSettings mounts that still carried a SAVE BUTTON, which is the control ' +
        'useAutosaveField was extracted to replace, and it reported a failed save through ' +
        'alert(): a blocking modal that leaves NO record once dismissed, which is the silent ' +
        'discard this mechanism exists to prevent. Add, edit and reorder now autosave via ' +
        'onCommit; DELETE became a two-tap confirmed action, because the Save button had been ' +
        'the accident-brake on it and removing the button without replacing that brake would ' +
        'have made the conversion a regression in safety. The tenant config keys, the two ' +
        'collections and the five default questions are unchanged and asserted by path.',
    },
    {
      file: 'src/components/settings/IntegrationsSection.tsx',
      ticket: 'THE-296',
      why:
        'Restyled onto the same chrome: the numbered palette classes this slice forbids ' +
        '(text-green-600, text-yellow-600, border-red-200, bg-red-50, hover:bg-yellow-50) became ' +
        'semantic tokens plus a lucide icon, so a connection state is no longer carried by hue ' +
        'alone, and every px-4 py-2 control — 36px, under the touch floor on the buttons that ' +
        'START AND END AN OAUTH GRANT — took the 44px floor below sm and Rule 4 above it. It ' +
        'gained the explicit nav clearance too. NO autosave was added and none may be: every ' +
        'control here is an explicit action, and the section is in AUTOSAVE_EXCLUDED. All ten ' +
        'Composio endpoints, both Primary writes and the send-only Gmail copy are unchanged.',
    },
    {
      file: 'src/components/settings/AddOnsSection.tsx',
      ticket: 'THE-300',
      why:
        'Converted onto the same chrome as part of the BILLING mount site slice. It keeps its '
        + 'own panel card — deliberately, and this is the one place the accordion rule does not '
        + 'transfer: BillingAndPayments mounts this section BARE and the section returns null on '
        + 'a Stripe tenant and again when the environment can sell no add-ons, so a card drawn by '
        + 'the parent would render empty on exactly the tenants with nothing to buy. What changed '
        + 'is the chrome it was spelling wrong: the held-state badge and the error banner used '
        + 'NUMBERED palette classes (one fixed hue across all four palettes, Classic never checked), '
        + 'and every money control was under the touch floor — the quantity steppers measured ~26px '
        + 'and the buy/commit buttons ~32px, on controls that place a real charge. They now take '
        + "ICON_BUTTON and ACTION_HEIGHT, imported from OnboardingSection rather than re-spelled. "
        + 'NO autosave was added and none may be: this file is in AUTOSAVE_EXCLUDED. The Dodo '
        + 'endpoints, the preview/commit flow and the entitlement lift are untouched.',
    },
    {
      file: 'src/components/settings/BillingTermToggle.tsx',
      ticket: 'THE-300',
      why:
        'Same slice, and it changes what a church PAYS. TWO changes, both real. The discount '
        + 'badge and the claim line carried a NUMBERED palette class, so the saving was signalled '
        + 'by one fixed hue in every palette and Classic was never checked against it; both now '
        + 'take the tenant accent the rest of the control already speaks, dimmed by element '
        + 'opacity rather than a slash suffix, which is invalid on a variable-backed token. And '
        + 'the segment transition narrowed from `all` to `colors`: only the fill and the ink move '
        + 'on selection, while a transition over `all` animates height and width too, which is '
        + 'what makes an immediate post-resize measurement a lie (THE-295 read 1018px against a '
        + 'real 224px). ⚠️ NO TOUCH FLOOR WAS ADDED, and a draft of this ticket wrongly added '
        + 'one: measured in Chromium at 380px the segments are 44.75px with a floor and 44.75px '
        + 'without, because the grid-cols-3 track already stretches all three to the tallest. The '
        + 'floor moved no pixel and was removed; the height is asserted by measurement instead. '
        + 'No term, no price, no percentage and no element moved: the toggle sits inside '
        + "PlanUpgradeSection's tree, whose element count is pinned at a delta of exactly 6 by "
        + 'the marketing-card baseline.',
    },
    {
      file: 'src/components/settings/SmsSection.tsx',
      ticket: 'THE-314',
      why:
        'Rewritten from a Twilio CREDENTIAL FORM into the number purchase panel, because Harvest '
        + 'stopped asking churches to bring their own carrier account and started RESELLING on its '
        + 'own. There are no credentials left for this section to collect: the account SID, auth '
        + 'token and from-number fields are gone, and in their place the panel searches for an '
        + 'available number, buys one, shows the number with its status and its monthly cost, and '
        + 'releases it behind a two-step confirm. The confirm is not decoration — the vendor '
        + 'documents no port-out, so releasing is irreversible and the church loses a number it '
        + 'may have published. Every control takes the 44px floor below sm and Rule 4 above it, on '
        + 'buttons that now place a real recurring charge. NO autosave was added and none may be: '
        + 'buying and releasing a phone number are explicit actions, and this file is in '
        + 'AUTOSAVE_EXCLUDED. It never writes entitlement — it asks /api/sms/numbers and re-reads '
        + 'what that route recorded, rather than rendering the outcome it requested.',
    },
  ];

  it('the digest exemption list is exactly the edits that justify it', async () => {
    const { createHash } = await import('node:crypto');
    // Pinned whole — file AND ticket — so widening it is an edit to this line.
    expect(EDITED_SINCE_MEASUREMENT.map((e) => `${e.ticket} ${e.file}`)).toEqual([
      'THE-296 src/components/settings/OnboardingSection.tsx',
      'THE-296 src/components/settings/IntegrationsSection.tsx',
      'THE-300 src/components/settings/AddOnsSection.tsx',
      'THE-300 src/components/settings/BillingTermToggle.tsx',
      // ⚠️ APPENDED, never substituted: the four entries above stay exactly as
      // they were, so this list keeps reading as the history of every edit since
      // the measurement rather than as a snapshot of the latest one.
      'THE-314 src/components/settings/SmsSection.tsx',
    ]);
    for (const { file, why } of EDITED_SINCE_MEASUREMENT) {
      expect(UNTOUCHED.otherSettingsSections, `${file} is exempted but was never recorded`)
        .toHaveProperty(file);
      // The digest MUST actually differ. If a later change reverts the edit this
      // fails and the entry has to come out, so the list cannot outlive it.
      const now = createHash('sha256').update(readFileSync(path.join(ROOT, file))).digest('hex');
      expect(now, `${file} is exempted but unchanged — drop it from the list`)
        .not.toBe(UNTOUCHED.otherSettingsSections[file as keyof typeof UNTOUCHED.otherSettingsSections]);
      expect(why.length, `${file} is exempted without a stated reason`).toBeGreaterThan(80);
    }
  });

  const EXEMPT = EDITED_SINCE_MEASUREMENT.map((e) => e.file);

  it.each(Object.entries(UNTOUCHED.otherSettingsSections))('%s is unchanged', async (rel, digest) => {
    if (EXEMPT.includes(rel)) return;
    const { createHash } = await import('node:crypto');
    const now = createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');
    expect(now, `${rel} changed — this slice converts ONE section`).toBe(digest);
  });

  it('and the chrome itself is unchanged — it was already built', async () => {
    const { createHash } = await import('node:crypto');
    for (const [rel, digest] of Object.entries(UNTOUCHED.chrome)) {
      const now = createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');
      expect(now, `${rel} changed — the chrome shipped in THE-183 and this slice reuses it`).toBe(digest);
    }
  });
});

describe('16 · firestore.rules and functions/ are byte-identical', () => {
  it.each(Object.entries(UNTOUCHED.rulesAndFunctions))('%s is unchanged', async (rel, digest) => {
    const { createHash } = await import('node:crypto');
    const now = createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');
    expect(now, `${rel} changed — it is out of bounds for this slice`).toBe(digest);
  });
});
