import React, { act } from 'react';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

/**
 * THE-142 — the modal content column.
 *
 * The founder reported Contact, FAQ and Privacy & Terms rendering edge to edge
 * on desktop: body copy and accordion rows spanning a whole monitor, with no
 * container and no border. They are not pages, and only one of the four modals
 * named on the card is a dialog:
 *
 *   ContactModal          full-screen overlay — fixed inset-0, own back header
 *   FAQModal              full-screen overlay — same shape
 *   PrivacyTermsModal     full-screen overlay — same shape
 *   EnterpriseContactModal  centered DIALOG — scrim + sm:w-[500px] panel
 *
 * So three of them never had a max-width to lose; the constraint has to come
 * from inside, which is what ModalContentContainer is. The fourth already had
 * its constraint and keeps it — see the exception list in the second test.
 *
 * Colour is asserted the way #322/#323 did it: by generating the REAL Tailwind
 * CSS from tailwind.config.ts and resolving what each class actually emits,
 * against the actual :root and dark blocks in globals.css. Reading the class
 * names and believing them is how `bg-surface-gold` shipped as a well-formed
 * name with no rule behind it.
 */

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');
const GLOBALS = path.join(ROOT, 'src/app/globals.css');
const CONTAINER_FILE = path.join(SRC, 'components/ModalContentContainer.tsx');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── the Firebase surface these modals drag in ──────────────────────────────
// addDoc is captured rather than stubbed away: the fifth test reads what the
// contact form actually handed to Firestore.

const { authMock, addDocCalls } = vi.hoisted(() => ({
  authMock: { currentUser: { uid: 'u1', email: 'member@church.org' } },
  addDocCalls: [] as Array<{ collection: unknown; doc: Record<string, unknown> }>,
}));

vi.mock('../../firebase', () => ({ auth: authMock, db: {}, messaging: Promise.resolve(null) }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ __name: name }),
  addDoc: async (col: unknown, doc: Record<string, unknown>) => {
    addDocCalls.push({ collection: col, doc });
    return { id: 'doc-1' };
  },
}));
vi.mock('../../utils/tenant-scope', () => ({ getTenantScope: async () => 'tenant-1' }));

import ContactModal from '../ContactModal';
import FAQModal from '../FAQModal';
import PrivacyTermsModal from '../PrivacyTermsModal';
import EnterpriseContactModal from '../EnterpriseContactModal';
import { MEMBER_FAQS } from '../../lib/member-faqs';
import { LEGAL_LINKS, visibleLegalLinks } from '../../lib/legal-links';

// ── rendering ──────────────────────────────────────────────────────────────
// createRoot + act, as the rest of this suite does: @testing-library/react is
// installed but its @testing-library/dom peer is not, so it cannot be imported.

function mount(el: React.ReactElement): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(el);
  });
  return container;
}

/**
 * Click the button whose visible text contains `label`. These accordions are
 * single-open, so clicking indiscriminately closes whatever was opened last —
 * the target has to be named.
 */
function clickByLabel(root: HTMLElement, label: string) {
  const button = Array.from(root.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes(label),
  );
  expect(button, `no button labelled "${label}"`).toBeDefined();
  act(() => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

const classesOf = (el: Element) => el.className.toString().trim().split(/\s+/).filter(Boolean);

// ── the four, by label ─────────────────────────────────────────────────────
// `constraintLabel` is the data-modal-container value that carries each modal's
// width constraint. Named, never matched by looking for something that smells
// like a width class.

interface ModalSpec {
  name: string;
  kind: 'overlay' | 'dialog';
  constraintLabel: string;
  render: () => React.ReactElement;
}

const MODALS: ModalSpec[] = [
  {
    name: 'ContactModal',
    kind: 'overlay',
    constraintLabel: 'gutter',
    render: () => <ContactModal isOpen onClose={() => {}} />,
  },
  {
    name: 'FAQModal',
    kind: 'overlay',
    constraintLabel: 'gutter',
    render: () => <FAQModal isOpen onClose={() => {}} />,
  },
  {
    name: 'PrivacyTermsModal',
    kind: 'overlay',
    constraintLabel: 'gutter',
    render: () => <PrivacyTermsModal isOpen onClose={() => {}} isAdmin={false} />,
  },
  {
    name: 'EnterpriseContactModal',
    kind: 'dialog',
    constraintLabel: 'dialog-panel',
    render: () => <EnterpriseContactModal isOpen onClose={() => {}} />,
  },
];

const OVERLAYS = MODALS.filter((m) => m.kind === 'overlay');

/**
 * The one modal that does NOT take the shared container, stated here rather
 * than left as an absence. It is a centered dialog whose panel constraint was
 * never lost, and it has no importer anywhere in src — it is unreachable from
 * the member app, so restyling it would change nothing a member can see. A
 * future modal cannot be quietly parked here: this list is asserted exactly.
 */
const CONTAINER_EXEMPT = ['EnterpriseContactModal'];

// ── real Tailwind output ───────────────────────────────────────────────────

interface Emitted {
  cls: string;
  minWidth: number;
  decls: Record<string, string>;
}

let emitted: Emitted[] = [];
let lightVars: Record<string, string> = {};
let darkVars: Record<string, string> = {};

function varsIn(css: string, match: (sel: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(css).walkRules((rule) => {
    if (!match(rule.selector)) return;
    rule.walkDecls((d) => {
      if (d.prop.startsWith('--')) out[d.prop] = d.value.trim();
    });
  });
  return out;
}

/** Every class any of the four modals puts on a labelled container element. */
function allContainerClasses(): string[] {
  const out = new Set<string>();
  for (const spec of MODALS) {
    const root = mount(spec.render());
    for (const el of Array.from(root.querySelectorAll('[data-modal-container]'))) {
      for (const c of classesOf(el)) out.add(c);
    }
  }
  return [...out];
}

beforeAll(async () => {
  const css = readFileSync(GLOBALS, 'utf8');
  lightVars = varsIn(css, (s) => s === ':root');
  darkVars = varsIn(css, (s) => /\.dark|\[data-theme="dark"\]/.test(s));

  const tailwind = (await import('tailwindcss')).default;
  const base = (await import('../../../tailwind.config')).default;
  const raw = allContainerClasses().join(' ');
  document.body.innerHTML = '';

  const out = await postcss([
    tailwind({ ...base, content: [{ raw, extension: 'html' }] } as never),
  ]).process('@tailwind utilities;', { from: undefined });

  const unescape = (sel: string) => sel.replace(/^\./, '').replace(/\\/g, '');
  const collect = (node: postcss.Rule, minWidth: number) => {
    const decls: Record<string, string> = {};
    node.walkDecls((d) => {
      decls[d.prop] = d.value.trim();
    });
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
  // A class that emits nothing at all is the silent failure this guards
  // against, so prove the generation itself worked before anything reads it.
  expect(emitted.length, 'Tailwind produced no rules for the container classes').toBeGreaterThan(0);
}, 120_000);

/** Declarations in force for `classes` at `viewport`, later rules winning. */
function effective(classes: string[], viewport: number): Record<string, string> {
  const wanted = new Set(classes);
  const out: Record<string, string> = {};
  for (const rule of emitted) {
    if (!wanted.has(rule.cls) || rule.minWidth > viewport) continue;
    Object.assign(out, rule.decls);
  }
  return out;
}

/** A CSS length in px, or null when it is not a fixed length (auto, 100%, …). */
function px(value: string | undefined): number | null {
  if (!value) return null;
  const rem = value.match(/^(-?[\d.]+)rem$/);
  if (rem) return Number(rem[1]) * 16;
  const p = value.match(/^(-?[\d.]+)px$/);
  if (p) return Number(p[1]);
  return null;
}

/** The width of a box's content area given the space its parent offers it. */
function contentWidth(decls: Record<string, string>, available: number): number {
  const declared = decls.width === '100%' ? available : px(decls.width);
  const capped = px(decls['max-width']);
  let box = declared ?? available;
  if (capped !== null) box = Math.min(box, capped);
  const pad =
    (px(decls['padding-left']) ?? px(decls.padding) ?? 0) +
    (px(decls['padding-right']) ?? px(decls.padding) ?? 0);
  const border =
    (px(decls['border-left-width']) ?? px(decls['border-width']) ?? 0) +
    (px(decls['border-right-width']) ?? px(decls['border-width']) ?? 0);
  return box - pad - border;
}

/** The labelled constraint element of a rendered modal. */
function constraintEl(spec: ModalSpec): HTMLElement {
  const root = mount(spec.render());
  const el = root.querySelector<HTMLElement>(
    `[data-modal-container="${spec.constraintLabel}"]`,
  );
  expect(
    el,
    `${spec.name} renders no [data-modal-container="${spec.constraintLabel}"] — its content is unconstrained`,
  ).not.toBeNull();
  return el!;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e !== '__tests__' && e !== 'node_modules') walk(p, out);
    } else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

/** Files under src that spell a given data-modal-container label. */
function filesDeclaring(label: string): string[] {
  return walk(SRC)
    .filter((f) => readFileSync(f, 'utf8').includes(`data-modal-container="${label}"`))
    .map((f) => path.relative(SRC, f));
}

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);

// The desktop width the founder reported on, and a small phone. Production is
// mobile-first with bottom tabs, so both have to hold.
const DESKTOP = 1440;
const PHONE = 380;

beforeEach(() => {
  document.body.innerHTML = '';
  addDocCalls.length = 0;
});

// ───────────────────────────────────────────────────────────────────────────

it('each of the four modals constrains its content width', () => {
  const unconstrained: string[] = [];
  for (const spec of MODALS) {
    const decls = effective(classesOf(constraintEl(spec)), DESKTOP);
    const cap = px(decls['max-width']) ?? px(decls.width);
    if (cap === null) {
      unconstrained.push(`${spec.name}: emits no fixed max-width/width at ${DESKTOP}px`);
      continue;
    }
    // The defect was body text running the full width of a monitor. A cap that
    // is not comfortably narrower than the viewport has not fixed anything.
    if (cap >= DESKTOP / 2) {
      unconstrained.push(`${spec.name}: capped at ${cap}px, still most of a ${DESKTOP}px monitor`);
    }
  }
  expect(unconstrained, 'content runs edge to edge on desktop').toEqual([]);
});

it('all four use the same container, not four different ones', () => {
  // 1. One definition, not a copy per file. A second file spelling the gutter
  //    is four containers wearing one name, which is the state this started in.
  expect(filesDeclaring('gutter'), 'the shared container is defined in more than one place').toEqual([
    'components/ModalContentContainer.tsx',
  ]);
  expect(filesDeclaring('surface')).toEqual(['components/ModalContentContainer.tsx']);

  // 2. The three overlays render byte-identical container classes. Any drift —
  //    a wider column here, extra padding there — fails, which is the point.
  const rendered = OVERLAYS.map((spec) => {
    const root = mount(spec.render());
    const els = Array.from(root.querySelectorAll('[data-modal-container]'));
    return {
      name: spec.name,
      signature: els.map((e) => `${e.getAttribute('data-modal-container')}:${e.className}`).join('|'),
      count: els.length,
    };
  });
  for (const r of rendered) {
    expect(r.count, `${r.name} renders ${r.count} container elements, expected 2`).toBe(2);
  }
  const signatures = [...new Set(rendered.map((r) => r.signature))];
  expect(
    signatures.length,
    `the overlays no longer share one container:\n${rendered.map((r) => `${r.name} → ${r.signature}`).join('\n')}`,
  ).toBe(1);

  // 3. Padding lives in the container, not in each modal. A scroll body that
  //    re-adds its own is per-file layout creeping back.
  for (const spec of OVERLAYS) {
    const scroller = constraintEl(spec).parentElement!;
    const offenders = classesOf(scroller).filter((c) => /^(p[xytrbl]?-|max-w-|w-\[)/.test(c));
    expect(offenders, `${spec.name}'s scroll body carries its own layout: ${offenders.join(' ')}`).toEqual([]);
  }

  // 4. The one modal outside the shared container, named rather than absent.
  expect(
    MODALS.filter((m) => m.kind === 'dialog').map((m) => m.name),
    'a modal was quietly exempted from the shared container',
  ).toEqual(CONTAINER_EXEMPT);
  expect(filesDeclaring('dialog-panel')).toEqual(['components/EnterpriseContactModal.tsx']);
});

it('the content sits on a bordered surface', () => {
  for (const spec of OVERLAYS) {
    const root = mount(spec.render());
    const surface = root.querySelector<HTMLElement>('[data-modal-container="surface"]')!;
    const decls = effective(classesOf(surface), DESKTOP);

    for (const prop of ['border-width', 'border-color', 'background-color', 'border-radius']) {
      expect(decls[prop], `${spec.name}'s content surface declares no ${prop}`).toBeDefined();
    }
    expect(px(decls['border-width']), `${spec.name}'s surface border is not a visible width`).toBeGreaterThan(0);
    expect(px(decls['border-radius']), `${spec.name}'s surface has square corners`).toBeGreaterThan(0);
  }
});

it('no rendered legal or FAQ text changed', () => {
  // Pinned at d5165be, BEFORE this change. Hashing the source entries catches an
  // edit to member-faqs.ts / legal-links.ts; asserting the same strings reach
  // the DOM catches a modal that stops rendering them. Either alone would miss
  // half the ways this copy can move.
  const FAQ_PINS: Array<[string, string]> = [
    ['85ada654aed7f218', 'How do I get into my ministry on Harvest?'],
    ['27a12f93b632772e', 'Why can I not see something another member can?'],
    ['6989760cbcf6c11a', 'How does giving work, and who receives the money?'],
    ['82014533d25fab66', 'What is the Chat assistant, and where do its answers come from?'],
    ['cffc017ffa6db997', 'Where does my course progress go?'],
    ['c70b0a9774088127', 'Who can see my information?'],
    ['9c19b602bfc6da0a', 'How do I leave, or delete my account?'],
  ];
  const LEGAL_PINS: Array<[string, string]> = [
    ['df4668d0dcdd863a', 'Privacy Policy'],
    ['25ff27323047cc3c', 'Terms of Service'],
    ['d02b8e04062b35ca', 'Refund & Cancellation'],
  ];

  expect(MEMBER_FAQS, 'an FAQ entry was added or removed').toHaveLength(FAQ_PINS.length);
  expect(LEGAL_PINS, 'a legal link was added or removed').toHaveLength(LEGAL_LINKS.length);

  const drifted: string[] = [];
  MEMBER_FAQS.forEach((faq, i) => {
    const actual = sha([faq.question, ...faq.answer].join(' '));
    if (actual !== FAQ_PINS[i][0]) drifted.push(`FAQ ${i} "${FAQ_PINS[i][1]}" → now "${faq.question}"`);
  });
  LEGAL_LINKS.forEach((link, i) => {
    const actual = sha([link.label, link.description].join(' '));
    if (actual !== LEGAL_PINS[i][0]) drifted.push(`legal ${i} "${LEGAL_PINS[i][1]}" → now "${link.label}"`);
  });
  expect(drifted, 'THE-142 is layout only — this copy must be byte-identical').toEqual([]);

  // …and every pinned string is still on screen. One entry at a time: the
  // accordion keeps a single answer open.
  const faqRoot = mount(<FAQModal isOpen onClose={() => {}} />);
  for (const faq of MEMBER_FAQS) {
    expect(faqRoot.textContent ?? '', `FAQModal stopped rendering: ${faq.question}`).toContain(faq.question);
    clickByLabel(faqRoot, faq.question);
    const open = faqRoot.textContent ?? '';
    for (const paragraph of faq.answer) {
      expect(open, `FAQModal stopped rendering an answer of: ${faq.question}`).toContain(paragraph);
    }
    clickByLabel(faqRoot, faq.question);
  }

  for (const isAdmin of [false, true]) {
    const root = mount(<PrivacyTermsModal isOpen onClose={() => {}} isAdmin={isAdmin} />);
    const text = root.textContent ?? '';
    for (const link of visibleLegalLinks(isAdmin)) {
      expect(text, `PrivacyTermsModal (isAdmin=${isAdmin}) stopped rendering: ${link.label}`).toContain(link.label);
      expect(text, `PrivacyTermsModal (isAdmin=${isAdmin}) dropped a description`).toContain(link.description);
    }
  }
});

it('the contact form still submits the same three fields', async () => {
  // The card describes /api/contact, which takes name + email + message. That
  // route is the MARKETING site's — CORS-pinned to theharvest.site — and this
  // modal does not call it. The member-facing form writes to Firestore
  // directly, and its own required trio is the same three. `subject` rides
  // along as a fourth; the route defaults it when the marketing form omits it.
  const REQUIRED = ['name', 'email', 'message'];
  const SUPPORT_FIELDS = ['name', 'email', 'subject', 'message'];

  const root = mount(<ContactModal isOpen onClose={() => {}} />);
  clickByLabel(root, 'Contact Support');

  const form = root.querySelector('form')!;
  const named = Array.from(form.querySelectorAll<HTMLInputElement>('input[name], textarea[name]')).map(
    (el) => el.name,
  );
  expect(named, 'the support form gained or lost a field').toEqual(SUPPORT_FIELDS);
  for (const field of REQUIRED) {
    const el = form.querySelector<HTMLInputElement>(`[name="${field}"]`)!;
    expect(el.required, `${field} is no longer required`).toBe(true);
  }

  // And the submit path itself — same collection, same document shape.
  for (const [field, value] of [
    ['name', 'Ada'],
    ['email', 'ada@church.org'],
    ['subject', 'Hello'],
    ['message', 'Please help'],
  ] as const) {
    const el = form.querySelector<HTMLInputElement>(`[name="${field}"]`)!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')!.set!;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

  expect(addDocCalls, 'the support form no longer writes anything').toHaveLength(1);
  const { collection, doc } = addDocCalls[0];
  expect((collection as { __name: string }).__name).toBe('platform_inbox');
  expect(doc.type).toBe('contact');
  expect(Object.keys(doc.data as object).sort()).toEqual([...SUPPORT_FIELDS].sort());
  expect(doc.data, 'the submitted values are not what was typed').toEqual({
    name: 'Ada',
    email: 'ada@church.org',
    subject: 'Hello',
    message: 'Please help',
  });
});

it('both themes resolve every colour class to a defined property', () => {
  const COLOUR_PROPS = ['background-color', 'border-color', 'color'];
  const problems: string[] = [];

  for (const spec of OVERLAYS) {
    const root = mount(spec.render());
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-modal-container]'))) {
      // Every breakpoint, not just desktop — a class that only exists above sm
      // still has to theme.
      const decls = effective(classesOf(el), DESKTOP);
      for (const prop of COLOUR_PROPS) {
        const value = decls[prop];
        if (!value) continue;
        const named = [...value.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]);
        if (!named.length) {
          problems.push(`${spec.name}: ${prop}: ${value} names no token`);
          continue;
        }
        for (const token of named) {
          if (!(token in lightVars)) problems.push(`${spec.name}: ${token} is undefined in :root`);
          if (!(token in darkVars)) problems.push(`${spec.name}: ${token} has no dark value — it stays light`);
          if (lightVars[token] === darkVars[token]) {
            problems.push(`${spec.name}: ${token} is identical in both themes`);
          }
        }
      }
    }
  }
  expect([...new Set(problems)], 'a container colour does not survive the theme switch').toEqual([]);
});

it('no colour is hardcoded', () => {
  const source = readFileSync(CONTAINER_FILE, 'utf8');
  // Strip the block comment: it discusses the design, and a hex quoted in prose
  // is not a rendered colour.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '');

  const literals = [
    ...code.matchAll(/#[0-9a-fA-F]{3,8}\b/g),
    ...code.matchAll(/\b(?:rgba?|hsla?)\(/g),
    ...code.matchAll(/\b(?:bg|text|border|ring|divide|from|via|to)-\[[^\]]*(?:#|rgb|hsl)[^\]]*\]/g),
  ].map((m) => m[0]);
  expect(literals, 'a literal colour in the container opts it out of theming').toEqual([]);

  // Tailwind's default cool greys compile here and never theme — the same guard
  // theming-gaps.ts applies to src as a whole, restated for the new file.
  const neutrals = [
    ...code.matchAll(/\b(?:bg|text|border|ring|divide)-(?:gray|slate|zinc|neutral|stone)-\d{2,3}\b/g),
  ].map((m) => m[0]);
  expect(neutrals, 'off-palette neutrals do not theme').toEqual([]);

  // Every colour the container emits comes from a token, not a value. box-shadow
  // is excluded deliberately: `shadow-sm` is Tailwind's own black-at-5%, it is
  // the idiom every card in these three modals already uses, and a shadow that
  // does not show on a dark ground is the app-wide behaviour rather than a
  // regression this change introduces.
  const root = mount(<FAQModal isOpen onClose={() => {}} />);
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-modal-container]'))) {
    const decls = effective(classesOf(el), DESKTOP);
    for (const prop of ['background-color', 'border-color', 'color']) {
      if (!decls[prop]) continue;
      expect(decls[prop], `${prop} is a literal, not a token`).toMatch(/var\(--/);
    }
  }
});

it('no horizontal overflow at a narrow viewport', () => {
  // 348px is what these modals measured before this change: a 380px phone less
  // the p-4 their scroll body already had. The container has to hand back the
  // same figure, or a desktop fix has cost the phone.
  const BEFORE = PHONE - 32;

  for (const spec of OVERLAYS) {
    const root = mount(spec.render());
    const gutter = root.querySelector<HTMLElement>('[data-modal-container="gutter"]')!;
    const surface = root.querySelector<HTMLElement>('[data-modal-container="surface"]')!;

    for (const viewport of [PHONE, 640, DESKTOP]) {
      const gutterDecls = effective(classesOf(gutter), viewport);
      const inner = contentWidth(gutterDecls, viewport);
      const content = contentWidth(effective(classesOf(surface), viewport), inner);

      expect(inner, `${spec.name} overflows a ${viewport}px viewport`).toBeLessThanOrEqual(viewport);
      expect(content, `${spec.name} content overflows at ${viewport}px`).toBeLessThanOrEqual(viewport);
      expect(content, `${spec.name} content is not positive at ${viewport}px`).toBeGreaterThan(0);

      // Nothing may pull the box back out past the viewport edge.
      for (const prop of ['margin-left', 'margin-right']) {
        const m = px(gutterDecls[prop]);
        expect(m === null || m >= 0, `${spec.name} has a negative ${prop}`).toBe(true);
      }
    }

    // The phone keeps exactly the column it had.
    const phoneContent = contentWidth(
      effective(classesOf(surface), PHONE),
      contentWidth(effective(classesOf(gutter), PHONE), PHONE),
    );
    expect(
      phoneContent,
      `${spec.name} is ${phoneContent}px at ${PHONE}px, was ${BEFORE}px before the container`,
    ).toBe(BEFORE);
  }

  // No font size below 11px, anywhere the container introduces one.
  const tooSmall = [...readFileSync(CONTAINER_FILE, 'utf8').matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n < 11);
  expect(tooSmall, 'text below 11px is unreadable on a phone').toEqual([]);
});
