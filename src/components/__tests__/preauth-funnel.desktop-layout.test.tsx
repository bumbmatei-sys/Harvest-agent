import { describe, it, expect, vi, beforeAll } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * BATCH I — THE PRE-AUTH FUNNEL. THE ANSWER WAS "NO CHANGE".
 *
 * This file is the record that the four paid-signup screens were measured, not
 * the record of a change — because there is no change. Every assertion below
 * describes `main` as it already stood at 5583096, and every source file in
 * scope is byte-identical to that revision (section 1 proves it).
 *
 * WHAT WAS MEASURED. Each screen was mounted and its width-constraint chain
 * read off the RENDERED tree — not grepped out of the source — then resolved
 * against seven viewports. All four were already capped:
 *
 *     Onboarding          452px    (inline, on the shell's content column)
 *     AuthPage            452px    (inline, on the shell's content column)
 *     ChurchOnboarding    452px    (inline, on the shell's content column)
 *     FirstRunSetup       560px    (inline; px-5 inside it ⇒ 520px of content)
 *
 * WHY NOTHING WAS ADOPTED. The narrowest rule in `layout/form-layout.ts` is
 * FORM_MEASURE at 940px. Applying any rule in that module to a 452px column
 * would have made these screens WIDER — a regression on a one-question stepper,
 * not a fix. So the module is untouched and unimported here; section 9 pins
 * that, deliberately WITHOUT a digest, because a digest of a file three other
 * batches edited today is a merge conflict for no gain.
 *
 * These are not ordinary screens. A church reaches them between choosing a plan
 * and paying, so the sections below spend most of their weight on the things a
 * layout edit would have quietly broken had one been made: consent (4), the
 * abandoned-signup thread back (5), the light-mode decision (6), the billing
 * period (7) and Turnstile's single-use token (8).
 *
 * HERMETIC BY CONSTRUCTION. `actions/checkout` uses fetch-depth 1, so the
 * runner holds exactly one commit and any older SHA is unresolvable. The single
 * `git show` in this file lives in the recorder and runs only under
 * UPDATE_LAYOUT_BASELINE; every assertion reads the fixture. Section 10 keeps
 * it that way.
 *
 * Controls are found by their visible label — button text, placeholder,
 * accessible name — never by a class or value pattern, so no assertion here can
 * pass merely by matching a string this batch would have introduced.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ── Mocks: enough backend to let each screen paint, nothing more ─────────── */

const { tenantCtx, setDocMock, updateDocMock, createUserMock, signInMock } = vi.hoisted(() => ({
  tenantCtx: { branding: {}, tenantId: 'grace', tenantName: 'Grace Community Church', tenantPlan: 'plus' as string | null },
  setDocMock: vi.fn(async () => {}),
  updateDocMock: vi.fn(async () => {}),
  createUserMock: vi.fn(async () => ({ user: { uid: 'u1', email: 'new@church.org', getIdToken: async () => 'tok' } })),
  signInMock: vi.fn(async () => ({ user: { uid: 'u1', email: 'new@church.org', getIdToken: async () => 'tok' } })),
}));

vi.mock('../../firebase', () => ({
  auth: { currentUser: { uid: 'u1', email: 'new@church.org', getIdToken: async () => 'tok' } },
  db: {}, messaging: Promise.resolve(null), VAPID_KEY: 'vapid',
}));
vi.mock('firebase/auth', () => ({
  signInWithPopup: vi.fn(), GoogleAuthProvider: class {},
  createUserWithEmailAndPassword: createUserMock, signInWithEmailAndPassword: signInMock,
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('firebase/messaging', () => ({ getToken: vi.fn(async () => 'push-token') }));
vi.mock('firebase/firestore', () => ({
  doc: (_d: unknown, ...s: string[]) => ({ __path: s.join('/') }),
  getDoc: vi.fn(async () => ({ exists: () => true, data: () => ({}) })),
  setDoc: setDocMock, updateDoc: updateDocMock, arrayUnion: (...a: unknown[]) => a,
}));
vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'get', WRITE: 'write' }, handleFirestoreError: () => {},
}));
vi.mock('../../contexts/TenantContext', () => ({ useTenant: () => tenantCtx }));
vi.mock('../../utils/tenant-scope', () => ({ getTenantScope: async () => 'grace', getWriteTenantScope: async () => 'grace' }));
vi.mock('../../utils/tenant.utils', () => ({ isSubdomainAvailable: async () => true }));
vi.mock('../../utils/auth-fetch', () => ({ authFetch: async () => ({ ok: true, json: async () => ({}) }) }));

// The bot gate hands a token straight back, the way a solved widget does;
// without one the submit control stays disabled and never renders enabled.
// The mount itself is asserted from SOURCE in section 8, never from this stub.
vi.mock('@marsidev/react-turnstile', () => ({
  Turnstile: ({ onSuccess }: { onSuccess: (t: string) => void }) => {
    React.useEffect(() => { onSuccess('turnstile-token'); }, [onSuccess]);
    return null;
  },
}));
// motion/react animates opacity and transform only — neither bears on width.
vi.mock('motion/react', () => ({
  motion: new Proxy({}, { get: () => ({ children, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement('div', { className: (rest as { className?: string }).className }, children) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, {}, children),
}));

import React from 'react';

const {
  classInventory, mobileLayer, allTokens, isResponsive, breakpointOf, BREAKPOINT_MIN_PX,
} = await import('../../test/support/class-inventory');

const SRC = path.resolve(__dirname, '..');
const REPO = path.resolve(__dirname, '../../..');
const readSrc = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/* ── The four screens, and the viewports they were measured at ────────────── */

const FUNNEL = ['Onboarding.tsx', 'AuthPage.tsx', 'ChurchOnboarding.tsx', 'FirstRunSetup.tsx'] as const;

/** 380/480/639 are phone widths; 768/1024/1280/1440 are the desktop ladder. */
const VIEWPORTS = [380, 480, 639, 768, 1024, 1280, 1440] as const;
const MOBILE_VIEWPORTS = VIEWPORTS.filter((w) => w < 640);

const setURL = (url: string) =>
  (window as unknown as { happyDOM?: { setURL: (u: string) => void } }).happyDOM?.setURL(url);

let container: HTMLDivElement;
let root: Root | null = null;

async function mount(node: React.ReactElement): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(node); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  return container;
}
async function unmount() {
  await act(async () => { root?.unmount(); });
  root = null;
  container?.remove();
}

const openers: Record<string, () => Promise<HTMLDivElement>> = {
  'Onboarding.tsx': async () => {
    setURL('https://grace.theharvest.app/onboarding');
    const C = (await import('../Onboarding')).default;
    return mount(<C onComplete={() => {}} />);
  },
  'AuthPage.tsx': async () => {
    setURL('https://grace.theharvest.app/auth?signup=1');
    const C = (await import('../AuthPage')).default;
    return mount(<C onNavigate={() => {}} />);
  },
  'ChurchOnboarding.tsx': async () => {
    setURL('https://grace.theharvest.app/church-onboarding?billing=yearly');
    const C = (await import('../ChurchOnboarding')).default;
    return mount(<C onComplete={() => {}} signupPlan={'plus' as never} />);
  },
  'FirstRunSetup.tsx': async () => {
    setURL('https://grace.theharvest.app/');
    const C = (await import('../FirstRunSetup')).default;
    return mount(<C tenantId="grace" onFinished={() => {}} />);
  },
};

/* ── Resolving a width from the rendered tree ─────────────────────────────── */

/** Tailwind spacing: `px-5` ⇒ 5 × 4px. Only the px-* family affects width here. */
function paddingXPx(el: Element, viewport: number): number {
  const tokens = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
  let px = 0;
  for (const t of tokens) {
    const bp = breakpointOf(t);
    if (bp && BREAKPOINT_MIN_PX[bp] > viewport) continue; // not active at this width
    const utility = t.slice(t.length - t.replace(/^.*:/, '').length);
    const m = /^px-(\d+(?:\.\d+)?)$/.exec(utility);
    if (m) px = Number(m[1]) * 4;
    const arb = /^px-\[(\d+)px\]$/.exec(utility);
    if (arb) px = Number(arb[1]);
  }
  return px * 2; // both sides
}

/** An element's own hard cap in px, from an inline `max-width` in px. */
function inlineCapPx(el: Element): number | null {
  const m = /max-width:\s*(\d+(?:\.\d+)?)px/.exec(el.getAttribute('style') ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * The screen's content column: the one element carrying a hard pixel cap that
 * actually holds content. The decorative gold halo also carries a `max-width`,
 * but it is `aria-hidden`, `pointer-events-none`, absolutely positioned and
 * sits inside `overflow-hidden` — it cannot widen the page or the content, so
 * it is excluded here and pinned separately in section 1.
 */
function contentColumn(rootEl: ParentNode): Element {
  const capped = Array.from(rootEl.querySelectorAll('*')).filter(
    (el) => inlineCapPx(el) !== null && el.getAttribute('aria-hidden') !== 'true',
  );
  expect(capped.length, 'expected exactly one content column carrying a hard pixel cap').toBe(1);
  return capped[0];
}

interface Measurement {
  /** The declared cap on the content column, independent of viewport. */
  capPx: number;
  /** The column's rendered border-box width at this viewport. */
  borderBoxPx: number;
  /** Width actually available to content inside it. */
  contentPx: number;
}

/**
 * Resolve the content column's width at `viewport` by walking the ancestor
 * chain: each ancestor's horizontal padding takes width away from its children,
 * and each cap clamps it.
 */
function measure(rootEl: HTMLDivElement, viewport: number): Measurement {
  const column = contentColumn(rootEl);
  const chain: Element[] = [];
  for (let n: Element | null = column; n && n !== rootEl; n = n.parentElement) chain.unshift(n);

  let avail = viewport;
  for (const el of chain) {
    const cap = inlineCapPx(el);
    if (cap !== null) avail = Math.min(avail, cap);
    if (el !== column) avail -= paddingXPx(el, viewport); // ancestor padding
  }
  const borderBoxPx = Math.max(0, avail);
  return { capPx: inlineCapPx(column)!, borderBoxPx, contentPx: Math.max(0, borderBoxPx - paddingXPx(column, viewport)) };
}

/**
 * The tokens actually in force at `viewport` — the mobile layer plus every
 * responsive token whose breakpoint has been reached. This is what makes a
 * per-width fingerprint meaningful in a DOM that has no CSS engine: the class
 * attribute is width-independent, but the SET THAT APPLIES is not.
 */
function renderedAt(rootEl: ParentNode, viewport: number): string[] {
  return classInventory(rootEl).map(({ index, tag, tokens }) => {
    const active = tokens.filter((t) => {
      if (!isResponsive(t)) return true;
      const bp = breakpointOf(t)!;
      return BREAKPOINT_MIN_PX[bp] <= viewport;
    });
    return `${index}\t${tag}\t${active.join(' ')}`;
  });
}

/* ── Touch targets, named by label ────────────────────────────────────────── */

/** The visible/accessible name of a control — never a class or value pattern. */
function labelOf(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria;
  const ph = el.getAttribute('placeholder');
  if (ph) return `placeholder:${ph}`;
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 60);
  const alt = el.querySelector('img')?.getAttribute('alt');
  if (alt) return `img:${alt}`;
  return `${el.tagName.toLowerCase()}#${Array.from(el.parentElement?.children ?? []).indexOf(el)}`;
}

/** A control's resolved vertical size in px, where it is declared at all. */
function heightPxOf(el: Element): number | null {
  const style = el.getAttribute('style') ?? '';
  const inline = /(?:^|;)\s*(?:min-)?height:\s*(\d+(?:\.\d+)?)px/.exec(style);
  if (inline) return Number(inline[1]);
  const tokens = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    if (isResponsive(t)) continue; // the phone layer is what a touch target is judged on
    const arb = /^h-\[(\d+(?:\.\d+)?)px\]$/.exec(t);
    if (arb) return Number(arb[1]);
    const named = /^h-(\d+(?:\.\d+)?)$/.exec(t);
    if (named) return Number(named[1]) * 4;
  }
  return null;
}

const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"]';

/** Every control on a screen, keyed by label, with its declared size. */
function touchTargets(rootEl: ParentNode): Record<string, { heightPx: number | null; sizeTokens: string[] }> {
  const out: Record<string, { heightPx: number | null; sizeTokens: string[] }> = {};
  Array.from(rootEl.querySelectorAll(INTERACTIVE)).forEach((el, i) => {
    const key = `${i}:${labelOf(el)}`;
    const sizeTokens = (el.getAttribute('class') ?? '')
      .split(/\s+/).filter((t) => /^(h-|min-h-|py-|p-)/.test(t)).sort();
    out[key] = { heightPx: heightPxOf(el), sizeTokens };
  });
  return out;
}

/* ── Baseline ─────────────────────────────────────────────────────────────── */

/**
 * The revision this batch measured, and the one the fixture was recorded from.
 * Batch I changes no source, so every digest below must still match the working
 * tree — that equality IS the "no change" result (section 1).
 *
 * To re-record — only when one of these screens is deliberately changing:
 *
 *     UPDATE_LAYOUT_BASELINE=1 npx vitest run \
 *       src/components/__tests__/preauth-funnel.desktop-layout.test.tsx
 */
const PRE_PR_REVISION = '5583096';
const FIXTURES = path.join(__dirname, '__fixtures__');
const FIXTURE = path.join(FIXTURES, 'preauth-funnel.json');
const RECORDING = !!process.env.UPDATE_LAYOUT_BASELINE;

interface ScreenBaseline {
  capPx: number;
  measurements: Record<string, Measurement>;
  renderingHash: Record<string, string>;
  mobileLayer: string[];
  allTokens: string[];
  touchTargets: Record<string, { heightPx: number | null; sizeTokens: string[] }>;
}
interface Baseline {
  recordedFrom: string;
  /** Digest of each in-scope file AT PRE_PR_REVISION, via the one gated `git show`. */
  sourceDigests: Record<string, string>;
  screens: Record<string, ScreenBaseline>;
}
let BASELINE!: Baseline;

/** The ONLY git-dependent helper. Reachable from the recording block alone. */
const atPrePr = (rel: string): string =>
  execSync(`git show ${PRE_PR_REVISION}:src/components/${rel}`, { cwd: REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

beforeAll(async () => {
  if (RECORDING) {
    const screens: Record<string, ScreenBaseline> = {};
    const sourceDigests: Record<string, string> = {};
    for (const file of FUNNEL) {
      sourceDigests[file] = sha(atPrePr(file));
      const el = await openers[file]();
      const measurements: Record<string, Measurement> = {};
      const renderingHash: Record<string, string> = {};
      for (const w of VIEWPORTS) {
        measurements[String(w)] = measure(el, w);
        renderingHash[String(w)] = sha(renderedAt(el, w).join('\n'));
      }
      screens[file] = {
        capPx: contentColumn(el) ? inlineCapPx(contentColumn(el))! : 0,
        measurements, renderingHash,
        mobileLayer: mobileLayer(el), allTokens: allTokens(el),
        touchTargets: touchTargets(el),
      };
      await unmount();
    }
    writeFileSync(FIXTURE, `${JSON.stringify({ recordedFrom: PRE_PR_REVISION, sourceDigests, screens }, null, 2)}\n`);
  }
  BASELINE = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Baseline;
});

/* ═══════════════════════════════════════════════════════════════════════════
   1 — the verdict: nothing was too wide, so nothing was changed
   ═══════════════════════════════════════════════════════════════════════════ */

describe('each funnel screen is constrained at desktop widths', () => {
  /** The measured cap per screen. These are the numbers the batch reports. */
  const EXPECTED_CAP: Record<string, number> = {
    'Onboarding.tsx': 452,
    'AuthPage.tsx': 452,
    'ChurchOnboarding.tsx': 452,
    'FirstRunSetup.tsx': 560,
  };

  for (const file of FUNNEL) {
    it(`${file} caps its content column at ${EXPECTED_CAP[file]}px`, async () => {
      const el = await openers[file]();
      try {
        const column = contentColumn(el);
        expect(inlineCapPx(column)).toBe(EXPECTED_CAP[file]);
      } finally { await unmount(); }
    });

    it(`${file} stops growing past its cap from 768px up to 1440px`, async () => {
      const el = await openers[file]();
      try {
        const desktop = VIEWPORTS.filter((w) => w >= 768);
        const widths = desktop.map((w) => measure(el, w).borderBoxPx);
        // Identical at every desktop width — the screen does not track the viewport.
        expect(new Set(widths).size, `widths across ${desktop.join('/')}: ${widths.join('/')}`).toBe(1);
        expect(widths[0]).toBe(EXPECTED_CAP[file]);
        // …and it matches what was measured when the batch ran.
        for (const w of VIEWPORTS) {
          expect(measure(el, w), `at ${w}px`).toEqual(BASELINE.screens[file].measurements[String(w)]);
        }
      } finally { await unmount(); }
    });
  }

  it('no screen is wider than the narrowest rule in form-layout.ts — adopting one would WIDEN them', async () => {
    const { FORM_MEASURE } = await import('../layout/form-layout');
    const ruleWidth = Number(/max-w-\[(\d+)px\]/.exec(FORM_MEASURE)![1]);
    for (const file of FUNNEL) {
      expect(EXPECTED_CAP[file],
        `${file} is ${EXPECTED_CAP[file]}px; FORM_MEASURE is ${ruleWidth}px — applying it is a regression, not a fix`)
        .toBeLessThan(ruleWidth);
    }
  });

  it('leaves every in-scope file byte-identical to the measured revision', () => {
    for (const file of FUNNEL) {
      expect(sha(readSrc(file)), `${file} changed — batch I is a measurement, not an edit`)
        .toBe(BASELINE.sourceDigests[file]);
    }
  });

  it('keeps the decorative halo out of the layout, so it cannot widen the page', async () => {
    for (const file of FUNNEL) {
      const el = await openers[file]();
      try {
        const halo = Array.from(el.querySelectorAll('[aria-hidden="true"]'))
          .filter((n) => /max-width/.test(n.getAttribute('style') ?? ''));
        expect(halo.length, `${file}: expected the gold halo`).toBeGreaterThan(0);
        for (const h of halo) {
          const cls = h.getAttribute('class') ?? '';
          expect(cls, `${file}: the halo must not participate in layout`).toContain('absolute');
          expect(cls).toContain('pointer-events-none');
        }
        // …and the ground it sits on clips it.
        expect(el.firstElementChild!.getAttribute('class')).toContain('overflow-hidden');
      } finally { await unmount(); }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2 — the phone is untouched
   ═══════════════════════════════════════════════════════════════════════════ */

describe('the sub-640px rendering of each screen is unchanged', () => {
  for (const file of FUNNEL) {
    it(`${file} renders identically at ${MOBILE_VIEWPORTS.join('/')}px`, async () => {
      const el = await openers[file]();
      try {
        for (const w of MOBILE_VIEWPORTS) {
          expect(sha(renderedAt(el, w).join('\n')), `${file} at ${w}px`)
            .toBe(BASELINE.screens[file].renderingHash[String(w)]);
        }
        expect(mobileLayer(el)).toEqual(BASELINE.screens[file].mobileLayer);
      } finally { await unmount(); }
    });
  }

  it('adds no responsive token anywhere in the funnel — there is no desktop layer to diverge', async () => {
    for (const file of FUNNEL) {
      const el = await openers[file]();
      try {
        expect(allTokens(el)).toEqual(BASELINE.screens[file].allTokens);
      } finally { await unmount(); }
    }
  });

  it('gains no lg:-gated token, so 1024px and up render exactly as 768px does', async () => {
    for (const file of FUNNEL) {
      const el = await openers[file]();
      try {
        const gated = allTokens(el).filter((t) => ['lg', 'xl', '2xl'].includes(breakpointOf(t) ?? ''));
        expect(gated, `${file} grew a large-breakpoint token`).toEqual([]);
        expect(sha(renderedAt(el, 768).join('\n'))).toBe(sha(renderedAt(el, 1440).join('\n')));
      } finally { await unmount(); }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3 — touch targets
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * THE-190: no 44px floor is asserted here. The founder has checked the phone
 * and it is fine, and a floor invented in a test would fail honest controls
 * that were already shipped and already work. The only claim is directional —
 * nothing got SMALLER — which is the claim this batch can actually support.
 */
describe('no touch target got smaller', () => {
  for (const file of FUNNEL) {
    it(`${file} keeps every control at least the size it already had`, async () => {
      const el = await openers[file]();
      try {
        const now = touchTargets(el);
        const before = BASELINE.screens[file].touchTargets;
        for (const [key, was] of Object.entries(before)) {
          const is = now[key];
          expect(is, `control "${key}" disappeared from ${file}`).toBeDefined();
          if (was.heightPx !== null) {
            expect(is.heightPx, `control "${key}" in ${file} lost its declared height`).not.toBeNull();
            expect(is.heightPx!, `control "${key}" in ${file} shrank`).toBeGreaterThanOrEqual(was.heightPx);
          }
          expect(is.sizeTokens, `control "${key}" in ${file} changed its size tokens`).toEqual(was.sizeTokens);
        }
        expect(Object.keys(now).length, `${file} gained or lost controls`).toBe(Object.keys(before).length);
      } finally { await unmount(); }
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   4 — 🔴 CONSENT. PR 343: this is the only place real consent is captured.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('the terms copy still renders beside the submit control on every AuthPage path', () => {
  it('puts the terms sentence and both canonical links in the same column as the submit button', async () => {
    const el = await openers['AuthPage.tsx']();
    try {
      const submit = Array.from(el.querySelectorAll('button'))
        .find((b) => b.textContent?.trim() === 'Create account');
      expect(submit, 'the submit control').toBeDefined();

      const terms = Array.from(el.querySelectorAll('p'))
        .find((p) => /By continuing you accept the/.test(p.textContent ?? ''));
      expect(terms, 'the consent sentence').toBeDefined();

      // Named by their visible link text, not by URL or class.
      const linkText = Array.from(terms!.querySelectorAll('a')).map((a) => a.textContent?.trim());
      expect(linkText).toEqual(['Terms of Service', 'Privacy Policy']);

      // Both links are real, open documents, and are the canonical ones.
      const { TERMS_URL, PRIVACY_URL } = await import('../../lib/legal-links');
      const hrefs = Array.from(terms!.querySelectorAll('a')).map((a) => a.getAttribute('href'));
      expect(hrefs).toEqual([TERMS_URL, PRIVACY_URL]);

      // "Beside the control" — same content column, and not reflowed away from
      // it into some other region of the page.
      const column = contentColumn(el);
      expect(column.contains(submit!), 'submit left the content column').toBe(true);
      expect(column.contains(terms!), 'the consent copy left the content column').toBe(true);

      // Nothing hides it: no responsive token on the copy or its ancestors up
      // to the column can make it disappear at any width.
      for (let n: Element | null = terms!; n && n !== column; n = n.parentElement) {
        const tokens = (n.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
        expect(tokens.filter((t) => /(^|:)hidden$/.test(t)), 'the consent copy can be hidden').toEqual([]);
      }
    } finally { await unmount(); }
  });

  it('still writes termsAccepted on all four of its paths', () => {
    const src = readSrc('AuthPage.tsx');
    expect((src.match(/termsAccepted:\s*true/g) ?? []).length,
      'PR 343 established four consent write paths — Google sign-up, Google existing, email existing, email new')
      .toBe(4);
  });

  it('captures consent on the same screen as the submit — no separate modal', () => {
    const src = readSrc('AuthPage.tsx');
    // The paraphrasing modal PR 343 removed must not have come back.
    expect(/showTermsModal|TermsModal/.test(src), 'a terms modal reappeared').toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   5 — 🔴 THE ONLY THREAD BACK for a church that abandons at payment (PR 343)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('signupInProgress is still written where PR 343 left it', () => {
  it('is written by ChurchOnboarding before checkout is attempted', () => {
    const src = readSrc('ChurchOnboarding.tsx');
    const write = src.indexOf('signupInProgress: true');
    expect(write, 'signupInProgress: true is gone').toBeGreaterThan(-1);

    // It must still precede the checkout call — written BEFORE the Stripe tab
    // opens is exactly what makes an abandoned signup recoverable.
    const checkout = src.indexOf('SIGNUP_CHECKOUT_ENDPOINT', write);
    expect(checkout, 'checkout is no longer reached after the marker is written').toBeGreaterThan(write);
  });

  it('still carries the plan, the billing period and the ministry name alongside it', () => {
    const src = readSrc('ChurchOnboarding.tsx');
    const block = src.slice(src.indexOf('signupInProgress: true'));
    for (const field of ['signupPlan', 'signupBilling', 'signupMinistryName']) {
      expect(block.slice(0, 800)).toContain(field);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   6 — 🔴 THE-85: pre-auth is light-mode only, BY DECISION
   ═══════════════════════════════════════════════════════════════════════════ */

describe('no pre-auth screen gained a dark treatment', () => {
  for (const file of FUNNEL) {
    it(`${file} carries no dark: variant in source or in the rendered tree`, async () => {
      expect(readSrc(file).includes('dark:'), `${file} gained a dark variant`).toBe(false);
      const el = await openers[file]();
      try {
        expect(allTokens(el).filter((t) => t.startsWith('dark:'))).toEqual([]);
      } finally { await unmount(); }
    });
  }

  it('leaves PREAUTH_PATHS exactly as THE-85 set it', async () => {
    const { PREAUTH_PATHS } = await import('../../lib/preauth-theme');
    expect([...PREAUTH_PATHS]).toEqual(['/auth', '/onboarding', '/church-onboarding']);
  });

  it('never writes the stored preference from a funnel screen — a member signing out of dark stays dark on sign-in', () => {
    for (const file of FUNNEL) {
      const src = readSrc(file);
      expect(/harvest-theme/.test(src), `${file} touches the stored theme preference`).toBe(false);
      expect(/setAttribute\(\s*['"]data-theme/.test(src), `${file} forces a theme itself`).toBe(false);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   7 — 🔴 the billing lane: an annual church must get the annual product
   ═══════════════════════════════════════════════════════════════════════════ */

describe('the billing period still reaches checkout unchanged', () => {
  it('resolves ?billing=yearly through the validating reader', async () => {
    const { resolveSignupBillingPeriod, readSignupBillingPeriod } = await import('../../utils/signup-checkout');
    // The app's own two words — a church paying annually must reach the
    // annual product, not be quietly restarted on monthly.
    expect(resolveSignupBillingPeriod('?billing=yearly')).toBe('yearly');
    expect(resolveSignupBillingPeriod('?billing=monthly')).toBe('monthly');
    // Untrusted input fails CLOSED rather than travelling onward to a lookup
    // the catalogue has no fallback for.
    expect(readSignupBillingPeriod('annual')).toBe('monthly');
    expect(readSignupBillingPeriod('quarterly')).toBe('monthly');
    expect(readSignupBillingPeriod(undefined)).toBe('monthly');
  });

  it('still carries the period across the auth redirect that drops the query (THE-135)', async () => {
    const { resolveSignupBillingPeriod, SIGNUP_BILLING_STORAGE_KEY } = await import('../../utils/signup-checkout');
    sessionStorage.setItem(SIGNUP_BILLING_STORAGE_KEY, 'yearly');
    try {
      // No query left after the redirect — the stored lane is what survives.
      expect(resolveSignupBillingPeriod('')).toBe('yearly');
      // …and a URL that carries `billing` at all still wins over it.
      expect(resolveSignupBillingPeriod('?billing=monthly')).toBe('monthly');
    } finally { sessionStorage.removeItem(SIGNUP_BILLING_STORAGE_KEY); }
  });

  it('is read by ChurchOnboarding from the URL, not re-derived', () => {
    const src = readSrc('ChurchOnboarding.tsx');
    expect(src).toContain('resolveSignupBillingPeriod');
    expect(src).toContain('SIGNUP_CHECKOUT_ENDPOINT');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   8 — 🔴 Turnstile: single-use tokens, remounted by key (PR 308)
   ═══════════════════════════════════════════════════════════════════════════ */

describe("Turnstile's mount is unchanged", () => {
  const src = () => readSrc('AuthPage.tsx');

  it('still mounts once, keyed, so a fresh solve can be forced', () => {
    const s = src();
    expect((s.match(/<Turnstile\b/g) ?? []).length, 'exactly one mount site').toBe(1);
    const mountBlock = s.slice(s.indexOf('<Turnstile'), s.indexOf('<Turnstile') + 400);
    expect(mountBlock, 'the key remount PR 308 added is gone').toContain('key={turnstileKey}');
    expect(mountBlock).toContain('onSuccess');
    expect(mountBlock).toContain('onExpire');
  });

  it('keeps every path that bumps the key, so a spent token is never reused', () => {
    // PR 308's error path, plus the sign-in/sign-up switch.
    expect((src().match(/setTurnstileKey\(\(k\)\s*=>\s*k\s*\+\s*1\)/g) ?? []).length).toBe(3);
  });

  it('leaves submit gated on a solved token', () => {
    expect(src()).toContain('disabled={loading || !turnstileToken}');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   9 — nothing was added to form-layout.ts
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Deliberately NOT a digest. Three batches edited this module today and batch H
 * is still open; pinning its bytes here would collide with them for no gain.
 * The claim that matters is narrower and conflict-free: the funnel does not
 * consume the module, so this batch cannot have grown it.
 */
describe('nothing was added to form-layout.ts', () => {
  it('is not imported by any funnel screen', () => {
    for (const file of FUNNEL) {
      expect(/form-layout/.test(readSrc(file)), `${file} started importing the layout rules`).toBe(false);
    }
  });

  it('exports no funnel-specific rule — no measure was invented for these screens', () => {
    const src = readFileSync(path.join(SRC, 'layout/form-layout.ts'), 'utf8');
    const exported = [...src.matchAll(/^export (?:const|type) (\w+)/gm)].map((m) => m[1]);
    const funnelish = exported.filter((n) => /AUTH|SIGNUP|ONBOARD|FUNNEL|PREAUTH|STEPPER|CARD/i.test(n));
    expect(funnelish, 'a rule was added for the pre-auth funnel').toEqual([]);
  });

  it('still exposes the rules the other batches rely on, none of them narrow enough for a 452px column', () => {
    const src = readFileSync(path.join(SRC, 'layout/form-layout.ts'), 'utf8');
    const exported = [...src.matchAll(/^export (?:const|type) (\w+)/gm)].map((m) => m[1]);
    for (const name of ['FORM_CONTAINER', 'FORM_MEASURE', 'FIELD_WIDTH', 'ACTION_BUTTON', 'CONTROL_DENSITY']) {
      expect(exported, `${name} disappeared`).toContain(name);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   10 — this suite is hermetic: no git at assertion time
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `actions/checkout` fetches ONE commit, so any older SHA is unresolvable on the
 * runner: "fatal: invalid object name". Two suites failed CI that way today
 * while passing locally. The pre-PR side is a recorded fixture; this keeps it so.
 */
describe('this suite is hermetic — it reads no git history at run time', () => {
  const SELF = readFileSync(__filename, 'utf8');

  it('shells out from the recorder alone', () => {
    const shelling = SELF.split('\n')
      .map((l, i) => ({ l, n: i + 1 }))
      .filter(({ l }) => /execSync\(/.test(l) && !/^\s*(\/\/|\*)/.test(l));
    expect(shelling.length, 'a second execSync appeared — CI clones shallow, so it will fail there').toBe(1);
    expect(shelling[0].l).toContain('git show');
  });

  it('reaches the git-dependent helper only under UPDATE_LAYOUT_BASELINE', () => {
    const calls = [...SELF.matchAll(/atPrePr\(/g)].length;
    const recording = SELF.slice(SELF.indexOf('if (RECORDING) {'), SELF.indexOf('BASELINE = JSON.parse'));
    const inRecording = [...recording.matchAll(/atPrePr\(/g)].length;
    expect(calls, 'atPrePr should be exercised by the recorder').toBeGreaterThan(0);
    expect(calls - inRecording, 'atPrePr is called outside the recording block').toBe(0);
  });

  it('fails loudly if the fixture is missing rather than silently passing', () => {
    expect(existsSync(FIXTURE), 'the baseline fixture is missing').toBe(true);
    expect(BASELINE.recordedFrom).toBe(PRE_PR_REVISION);
    expect(Object.keys(BASELINE.screens).sort()).toEqual([...FUNNEL].sort());
  });
});
