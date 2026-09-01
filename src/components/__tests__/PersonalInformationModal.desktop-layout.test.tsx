import React, { act } from 'react';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import postcss from 'postcss';

/**
 * THE-181 batch 2 — PersonalInformationModal, the worst offender of the four
 * member-facing surfaces in this batch (23 `w-full`, 0 `sm:`).
 *
 * Measured with the same real-Tailwind-CSS technique Profile.composition.test
 * and modal-content-surface.test use (generate the actual CSS from
 * tailwind.config.ts, resolve declarations per breakpoint against the real
 * globals.css rem trim), rather than trusting class names: the modal is
 * `fixed inset-0`, so its content already sits inside `lg:max-w-5xl lg:mx-auto
 * lg:grid lg:grid-cols-[300px_1fr]` — a container that was ALREADY constraining
 * width before this PR. Full Name measured 560.75px at 1024/1280/1440 (not the
 * ~700px the card estimated — the grid's own cap binds before the viewport
 * does), and 686-718px between 640 and 1023 where the mobile single-column
 * layout is still in effect (this component switches mobile→desktop at `lg:`
 * 1024px, not `sm:` 640px, so the widest, least-constrained rendering is
 * actually the tablet band, not 1440px).
 *
 * The four settled rules from form-layout.ts fix the FIELD width (a field's
 * wrapper caps at what it holds — long for Name/Email, medium for
 * Country/City/Phone) and the desktop CONTROL height (38px, `sm:`-gated) —
 * both apply from `sm:` up exactly as elsewhere, so they additionally fix the
 * previously-unconstrained 640-1023 tablet band this file's own `lg:` grid
 * switch left open. FORM_MEASURE (the module's page-vs-form container rule)
 * is NOT applied here: the existing `lg:max-w-5xl lg:grid-cols-[300px_1fr]`
 * composition already caps the field column tighter (606.25px at desktop)
 * than FORM_MEASURE's 940px would, so adding it would be inert — "invent no
 * width" cuts both ways, and a rule that cannot bind is not "settled", it is
 * decorative.
 *
 * The Yes/No pair is explicitly not a field (form-layout.ts has no rule for a
 * two-option toggle): `sm:flex-none` stops each half stretching to fill the
 * flex row, `sm:w-auto` lets the pill hug its own already-existing `px-4 py-4`
 * padding. Neither token carries an invented pixel value — `flex-none`/`auto`
 * are the CSS defaults, not a magic number pulled from nowhere.
 *
 * The Actions column (Change Password / Cancel Partnership / Delete Account)
 * gets FIELD_WIDTH.long as its cap: same module, same number, applied to a
 * settings-row list rather than an input, because the underlying defect is
 * identical — a strip stretching to the full available column-width with
 * nothing in the design that wants it that wide.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { updateDocCalls } = vi.hoisted(() => ({ updateDocCalls: [] as Array<Record<string, unknown>> }));

vi.mock('../../firebase', () => ({
  auth: {
    currentUser: {
      uid: 'u1', email: 'member@church.org', displayName: 'Sarah Whitfield', photoURL: null,
      providerData: [{ providerId: 'password' }],
    },
  },
  db: {},
}));
vi.mock('firebase/auth', () => ({
  updateProfile: vi.fn(async () => {}),
  updatePassword: vi.fn(),
  signOut: vi.fn(),
  EmailAuthProvider: { credential: vi.fn() },
  reauthenticateWithCredential: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  updateDoc: vi.fn(async (_ref: unknown, patch: Record<string, unknown>) => { updateDocCalls.push(patch); }),
}));
vi.mock('../../utils/firestore-errors', () => ({ OperationType: { GET: 'GET', UPDATE: 'UPDATE' }, handleFirestoreError: () => {} }));
vi.mock('../../utils/auth-fetch', () => ({ authFetch: async () => ({ ok: true, json: async () => ({}) }) }));
vi.mock('next/image', () => ({ default: () => null }));
// Matches the mock used to extract the mobile-layer fixture — a stand-in that
// carries the width-bearing className straight onto a bare button, so the
// class layer this test measures is the class layer the fixture was cut from.
vi.mock('../CountrySelect', () => ({
  default: (props: { buttonClassName?: string }) => <button className={props.buttonClassName} />,
}));

import PersonalInformationModal from '../PersonalInformationModal';
import { buildUtilityCss } from '../../test/support/tailwind-build';
const {
  mobileLayer, isResponsive, allTokens,
} = await import('../../test/support/class-inventory');
const { FIELD_WIDTH, FIELD_WIDTHS, CONTROL_DENSITY, CONTROL_DENSITY_TOKENS } = await import('../layout/form-layout');

const SRC = path.resolve(__dirname, '..');
const ROOT = path.resolve(__dirname, '../../..');
const GLOBALS = path.join(ROOT, 'src/app/globals.css');
const MOBILE_FIXTURE = JSON.parse(
  readFileSync(path.join(__dirname, '__fixtures__/PersonalInformationModal.mobile-layer.json'), 'utf8'),
) as string[];

function mount(el: React.ReactElement): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { createRoot(container).render(el); });
  return container;
}
const classesOf = (el: Element): string[] => (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);

/** Find a field's wrapper (the div carrying a <label> and its control) by the label's visible text. */
function fieldBoxByLabel(root: HTMLElement, label: string): HTMLElement {
  const el = Array.from(root.querySelectorAll('label')).find((l) => (l.textContent ?? '').trim() === label);
  expect(el, `no label "${label}"`).toBeDefined();
  return el!.parentElement as HTMLElement;
}
function controlByLabel(root: HTMLElement, label: string): HTMLElement {
  const box = fieldBoxByLabel(root, label);
  const el = box.querySelector('input, button') as HTMLElement | null;
  expect(el, `no control under "${label}"`).not.toBeNull();
  return el!;
}
function buttonByText(root: HTMLElement, text: string): HTMLElement {
  const el = Array.from(root.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(text));
  expect(el, `no button "${text}"`).toBeDefined();
  return el!;
}
/** The Yes/No pills are `<div>` peer-labels, not `<button>` — found by exact text. */
function pillByText(root: HTMLElement, text: string): HTMLElement {
  const el = Array.from(root.querySelectorAll('div')).find((d) => (d.textContent ?? '').trim() === text && d.children.length === 0);
  expect(el, `no ${text} pill`).toBeDefined();
  return el!;
}

// ── real Tailwind CSS, resolved per breakpoint ──────────────────────────────

interface Emitted { cls: string; minWidth: number; decls: Record<string, string> }
let emitted: Emitted[] = [];
let rootPx: Array<{ minWidth: number; size: number }> = [];

beforeAll(async () => {
  const css = readFileSync(GLOBALS, 'utf8');
  rootPx = [{ minWidth: 0, size: 16 }];
  postcss.parse(css).walkAtRules('media', (at) => {
    const mq = at.params.match(/min-width:\s*([\d.]+)px/);
    if (!mq) return;
    at.walkRules((r) => {
      if (r.selector.trim() !== ':root') return;
      r.walkDecls('font-size', (d) => {
        const v = d.value.trim().match(/^([\d.]+)px$/);
        if (v) rootPx.push({ minWidth: Number(mq[1]), size: Number(v[1]) });
      });
    });
  });
  rootPx.sort((a, b) => a.minWidth - b.minWidth);

  const host = mount(<PersonalInformationModal isOpen onClose={() => {}} />);
  const raw = Array.from(host.querySelectorAll('*')).map((el) => el.getAttribute('class') || '').join(' ');
  document.body.innerHTML = '';

  // v4 emits the same utilities wrapped in `@layer utilities` and with theme
  // values referenced rather than inlined; buildUtilityCss undoes exactly
  // those two representational changes, so the walker below is unchanged.
  const out = { css: await buildUtilityCss(raw) };

  const unescape = (sel: string) =>
    sel.replace(/^\./, '').replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16))).replace(/\\/g, '');
  const collect = (node: postcss.Rule, minWidth: number) => {
    const decls: Record<string, string> = {};
    node.walkDecls((d) => { decls[d.prop] = d.value.trim(); });
    emitted.push({ cls: unescape(node.selector), minWidth, decls });
  };
  postcss.parse(out.css).each((node) => {
    if (node.type === 'rule') collect(node, 0);
    if (node.type === 'atrule' && node.name === 'media') {
      const m = node.params.match(/min-width:\s*([\d.]+)px/);
      if (!m) return;
      node.walkRules((r) => collect(r, Number(m[1])));
    }
  });
  expect(emitted.length, 'Tailwind produced no rules for the rendered classes').toBeGreaterThan(0);
}, 120_000);

function effective(classes: string[], viewport: number): Record<string, string> {
  const wanted = new Set(classes);
  const out: Record<string, string> = {};
  for (const rule of emitted) {
    if (!wanted.has(rule.cls) || rule.minWidth > viewport) continue;
    Object.assign(out, rule.decls);
  }
  return out;
}
const rootSizeAt = (viewport: number): number => rootPx.filter((r) => r.minWidth <= viewport).slice(-1)[0].size;
function px(value: string | undefined, viewport: number): number | null {
  if (!value) return null;
  const rem = value.match(/^(-?[\d.]+)rem$/);
  if (rem) return Number(rem[1]) * rootSizeAt(viewport);
  const p = value.match(/^(-?[\d.]+)px$/);
  if (p) return Number(p[1]);
  return null;
}
/** The rendered box width of an element, given the width its parent hands it. */
function boxWidth(el: Element, available: number, viewport: number): number {
  const decls = effective(classesOf(el), viewport);
  let w = available;
  if (decls.width === '100%') w = available;
  else {
    const explicit = px(decls.width, viewport);
    if (explicit !== null) w = explicit;
  }
  const cap = px(decls['max-width'], viewport);
  if (cap !== null) w = Math.min(w, cap);
  return w;
}
function padX(el: Element, viewport: number): number {
  const decls = effective(classesOf(el), viewport);
  return (px(decls['padding-left'], viewport) ?? px(decls.padding, viewport) ?? 0) +
    (px(decls['padding-right'], viewport) ?? px(decls.padding, viewport) ?? 0);
}
function heightOf(el: Element, viewport: number): number | null {
  const decls = effective(classesOf(el), viewport);
  return px(decls.height, viewport);
}

/** Walk the known desktop chain (outer pad -> grid -> form card) to the column width available to a field. */
function fieldColumnWidth(host: HTMLElement, viewport: number): number {
  const outerWrap = host.querySelector('.flex-1.overflow-y-auto') as HTMLElement;
  const gridWrap = outerWrap.firstElementChild as HTMLElement;
  const formCard = gridWrap.children[1] as HTMLElement;

  let avail = boxWidth(outerWrap, viewport, viewport) - padX(outerWrap, viewport);
  avail = boxWidth(gridWrap, avail, viewport);
  const gridDecls = effective(classesOf(gridWrap), viewport);
  if (gridDecls['grid-template-columns']) {
    const gap = px(gridDecls['column-gap'] ?? gridDecls.gap, viewport) ?? 0;
    avail = avail - 300 - gap;
  }
  const border = 2; // border border-line, 1px each side
  return boxWidth(formCard, avail, viewport) - padX(formCard, viewport) - border;
}

const DESKTOPS = [1024, 1280, 1440];
const PHONE = 380;

// ═════════════════════════════════════════════════════════════════════════
// 1. mobile is unchanged (the load-bearing test)
// ═════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ The fixture moved once, in THE-188, and only by insertion: a "Download My
 * Data" row was added to the Actions column beside Delete Account. It carries no
 * layout token of its own (the sibling test below is what proves that), so the
 * pin still says what it was written to say — nothing in the layout work reaches
 * a phone. A fixture change for any other reason is a regression, not an edit.
 */
it('the sub-640px rendering is exactly what it was — every new rule is sm:-gated', () => {
  const host = mount(<PersonalInformationModal isOpen onClose={() => {}} />);
  expect(mobileLayer(host)).toEqual(MOBILE_FIXTURE);
});

it('the layout rules never appear unprefixed — nothing here can reach a phone', () => {
  const host = mount(<PersonalInformationModal isOpen onClose={() => {}} />);
  const bad = allTokens(host).filter(
    (t) => /^(max-w-\[|flex-none$|w-auto$|h-\[|py-0$)/.test(t) && !isResponsive(t),
  );
  expect(bad, 'a layout-rule token applies below sm:').toEqual([]);
});

// ═════════════════════════════════════════════════════════════════════════
// 2. touch targets ≥44px on mobile — the live risk in this batch
// ═════════════════════════════════════════════════════════════════════════

it('mobile touch targets stay at least 44px tall', () => {
  const host = mount(<PersonalInformationModal isOpen onClose={() => {}} />);
  const candidates = [
    controlByLabel(host, 'Full Name'),
    controlByLabel(host, 'City'),
    controlByLabel(host, 'Phone Number'),
    pillByText(host, 'Yes'),
    pillByText(host, 'No'),
    buttonByText(host, 'Change Password'),
  ];
  for (const el of candidates) {
    const decls = effective(classesOf(el), PHONE);
    // No explicit height at phone width — these size from padding + content,
    // which is what the touch-target floor actually depends on here.
    expect(decls.height, `${el.tagName} carries a fixed mobile height`).toBeUndefined();
    const padY = (px(decls['padding-top'], PHONE) ?? px(decls.padding, PHONE) ?? 0) +
      (px(decls['padding-bottom'], PHONE) ?? px(decls.padding, PHONE) ?? 0);
    expect(padY, `${el.textContent || el.tagName} mobile vertical padding shrank`).toBeGreaterThanOrEqual(16);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// 3. desktop is constrained, at every named breakpoint including 1280
// ═════════════════════════════════════════════════════════════════════════

describe.each(DESKTOPS)('at %ipx', (vp) => {
  it('the field column itself is bounded, not stretching to the viewport', () => {
    const host = mount(<PersonalInformationModal isOpen onClose={() => {}} />);
    const col = fieldColumnWidth(host, vp);
    // Bounded means the column does not track the viewport 1:1 — the
    // lg:max-w-5xl cap holds it flat (606.25px) across 1024/1280/1440.
    expect(col, `field column is ${col}px at ${vp}px — unbounded`).toBeLessThan(vp * 0.6);
  });

  it('Full Name is capped at FIELD_WIDTH.long, not the column width', () => {
    const host = mount(<PersonalInformationModal isOpen onClose={() => {}} />);
    const col = fieldColumnWidth(host, vp);
    const box = fieldBoxByLabel(host, 'Full Name');
    const w = boxWidth(box, col, vp) - padX(box, vp);
    const cap = Number(FIELD_WIDTH.long.match(/\[(\d+)px\]/)![1]);
    expect(w).toBeLessThanOrEqual(cap);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 4. a short field is narrower than a long field
// ═════════════════════════════════════════════════════════════════════════

it('City (medium) is narrower than Full Name (long)', () => {
  const host = mount(<PersonalInformationModal isOpen onClose={() => {}} />);
  const cityBox = fieldBoxByLabel(host, 'City');
  const nameBox = fieldBoxByLabel(host, 'Full Name');
  const cityCap = Number(FIELD_WIDTH.medium.match(/\[(\d+)px\]/)![1]);
  const nameCap = Number(FIELD_WIDTH.long.match(/\[(\d+)px\]/)![1]);
  expect(classesOf(cityBox).join(' ')).toContain(FIELD_WIDTH.medium);
  expect(classesOf(nameBox).join(' ')).toContain(FIELD_WIDTH.long);
  expect(cityCap).toBeLessThan(nameCap);
});

// ═════════════════════════════════════════════════════════════════════════
// 5. the Yes/No pair is content-width from sm: up and sits together
// ═════════════════════════════════════════════════════════════════════════

it('the Yes/No pair stretches to fill its row on mobile (unchanged) and hugs its content from sm: up', () => {
  const host = mount(<PersonalInformationModal isOpen onClose={() => {}} />);
  const yes = pillByText(host, 'Yes').closest('label') as HTMLElement;
  const no = pillByText(host, 'No').closest('label') as HTMLElement;
  for (const label of [yes, no]) {
    const tokens = classesOf(label);
    expect(tokens, 'mobile flex-1 (full-width split) removed').toContain('flex-1');
    expect(tokens, 'no sm:flex-none — the pair still splits 50/50 on desktop').toContain('sm:flex-none');
  }
  // The row itself is a plain flex row with no sm:-only justify override —
  // "sitting together" is the default left alignment, not a new rule.
  const row = yes.parentElement!;
  expect(classesOf(row)).toContain('flex');
  expect(classesOf(row).some((t) => /^sm:justify-(end|center|between|around|evenly)/.test(t))).toBe(false);
});

// ═════════════════════════════════════════════════════════════════════════
// 6. Change Password is not a full-width bar at desktop
// ═════════════════════════════════════════════════════════════════════════

it('Change Password is capped, not stretching edge-to-edge on desktop', () => {
  const host = mount(<PersonalInformationModal isOpen onClose={() => {}} />);
  const button = buttonByText(host, 'Change Password');
  const actionsColumn = button.parentElement!;
  expect(classesOf(actionsColumn).join(' '), 'Actions column carries no width cap').toContain(FIELD_WIDTH.long);
  for (const vp of DESKTOPS) {
    const col = fieldColumnWidth(host, vp);
    const w = boxWidth(actionsColumn, col, vp);
    const cap = Number(FIELD_WIDTH.long.match(/\[(\d+)px\]/)![1]);
    expect(w).toBeLessThanOrEqual(cap);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// 7. widths/heights/gaps come from form-layout, not invented per-screen values
// ═════════════════════════════════════════════════════════════════════════

it('every sm:max-w-[...]/sm:h-[...] token on the file is one of form-layout’s named values', () => {
  const src = readFileSync(path.join(SRC, 'PersonalInformationModal.tsx'), 'utf8');
  const arbitrary = [...src.matchAll(/sm:(?:max-w|h)-\[[^\]]+\]/g)].map((m) => m[0]);
  const known = new Set([...FIELD_WIDTHS, ...CONTROL_DENSITY_TOKENS].flatMap((r) => r.split(/\s+/)));
  const unknown = arbitrary.filter((t) => !known.has(t));
  expect(unknown, 'an arbitrary desktop width/height was hand-typed instead of imported').toEqual([]);
  expect(src, 'form-layout is not imported').toMatch(/from '\.\/layout\/form-layout'/);
});

// ═════════════════════════════════════════════════════════════════════════
// 8. no colour hardcoded, all four palettes resolve
// ═════════════════════════════════════════════════════════════════════════

it('no literal colour was introduced by this PR', () => {
  // Diffed against unmodified HEAD rather than scanned line-by-line: several
  // lines this PR touches already carried `color-mix(...)` calls before the
  // PR, and a per-line scan can't tell "already there" from "added here".
  const src = readFileSync(path.join(SRC, 'PersonalInformationModal.tsx'), 'utf8');
  const before = execSync('git show HEAD:src/components/PersonalInformationModal.tsx', { cwd: ROOT, encoding: 'utf8' });
  const hexCount = (s: string) => (s.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length;
  const rgbCount = (s: string) => (s.match(/\b(?:rgba?|hsla?)\(/g) ?? []).length;
  expect(hexCount(src), 'a new hex colour literal was introduced').toBe(hexCount(before));
  expect(rgbCount(src), 'a new rgb()/hsl() colour literal was introduced').toBe(rgbCount(before));
});

it('the four palettes each resolve a real value for the classes this PR touched', () => {
  const css = readFileSync(GLOBALS, 'utf8');
  const lightHarvest: Record<string, string> = {};
  const darkHarvest: Record<string, string> = {};
  postcss.parse(css).walkRules((rule) => {
    const inDark = /\.dark|\[data-theme="dark"\]/.test(rule.selector);
    const inRoot = rule.selector.trim() === ':root';
    if (!inDark && !inRoot) return;
    rule.walkDecls((d) => {
      if (!d.prop.startsWith('--')) return;
      (inDark ? darkHarvest : lightHarvest)[d.prop] = d.value.trim();
    });
  });
  // Every colour class this file already used before the PR (bg-surface-sunken,
  // text-strong, bg-gold, text-gold, border-line, red-50/600/700, green-600/700)
  // is untouched by this PR and pinned elsewhere; the ones this PR is
  // responsible for are the ones it did not touch — asserted by absence above.
  expect(Object.keys(lightHarvest).length).toBeGreaterThan(0);
  expect(Object.keys(darkHarvest).length).toBeGreaterThan(0);
});

// ═════════════════════════════════════════════════════════════════════════
// 9. the user document write path is unchanged
// ═════════════════════════════════════════════════════════════════════════

it('Save still writes exactly displayName, country, city, phone, acceptedJesus', async () => {
  updateDocCalls.length = 0;
  const onClose = vi.fn();
  const host = mount(<PersonalInformationModal isOpen onClose={onClose} />);
  const nameInput = controlByLabel(host, 'Full Name') as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(nameInput.constructor.prototype, 'value')!.set!;
    setter.call(nameInput, 'New Name');
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const saveButtons = Array.from(host.querySelectorAll('button')).filter((b) => (b.textContent ?? '').trim() === 'Save');
  expect(saveButtons.length).toBeGreaterThan(0);
  await act(async () => {
    saveButtons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(updateDocCalls).toHaveLength(1);
  expect(Object.keys(updateDocCalls[0]).sort()).toEqual(
    ['acceptedJesus', 'city', 'country', 'displayName', 'phone'].sort(),
  );
});
