import { describe, it, expect, vi, beforeAll } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * Desktop layout rules for batch G — the admin DATA screens: the AI Knowledge
 * base, the super-admin tenant list, the SMS surface and giving statements.
 * The admin shell (AdminDashboard.tsx) is in the same batch and is deliberately
 * NOT changed; the reason, and the test that keeps it that way, are section 5.
 *
 * This file mirrors AdminCourseEditor.desktop-layout.test.tsx: the rules come
 * from the same form-layout.ts module, they arrive as `className`, and the
 * sub-640px rendering is pinned against a baseline extracted mechanically from
 * the pre-PR revision rather than hand-typed.
 *
 * AdminRAG is the hard case and section 4 is the guard for it. That file draws
 * its whole desktop layer through 88 inline `style={{}}` objects, and an inline
 * style beats every class in the cascade — so a container rule layered on top
 * of `maxWidth:1160` would render nothing at all. Every width the rules now own
 * was REMOVED from its style object; section 4 checks that it stayed removed.
 *
 * Controls are found by their visible label — a placeholder or a button's text
 * — never by a class pattern, so a test cannot pass by matching the very class
 * the rule adds.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mkDocs = (rows: any[]) => rows.map((r) => ({ id: r.id, data: () => r }));

/** Long enough to exercise a measure — a real church name, not a placeholder. */
const TENANTS = [
  { id: 't1', name: 'Grace Community Church of the Northern Valley', subdomain: 'gracecommunitynorthern', plan: 'max', status: 'active', config: { customDomain: 'gracecommunitynorthernvalley.org' } },
  { id: 't2', name: 'Riverside Chapel', subdomain: 'riverside', plan: 'pro', status: 'suspended', config: {} },
];
const RAG_SOURCES = [
  { id: 'r1', title: 'Romans Commentary — Chapters 1 through 8', type: 'text', chunks: 214, status: 'processed', addedAt: { toDate: () => new Date('2026-03-04') } },
  { id: 'r2', title: 'Sunday Sermon Archive 2025.pdf', type: 'pdf', chunks: 1128, status: 'processing', addedAt: { toDate: () => new Date('2026-02-19') } },
];
const STATEMENTS = [
  { id: 's1', donorName: 'Jonathan Whitfield-Barrington', donorEmail: 'jonathan@example.org', year: 2025, totalAmount: 1250000, status: 'sent', generatedAt: '2026-01-15T00:00:00Z', pdfPath: 'x.pdf' },
];

const fb = { db: {}, auth: { currentUser: { uid: 'u', email: 'a@t.com', getIdToken: async () => 't' } }, app: {}, messaging: Promise.resolve(null) };
vi.mock('../../firebase', () => fb);
vi.mock('firebase/firestore', () => ({
  collection: (_d: unknown, ...s: string[]) => ({ __path: s.join('/') }),
  doc: (_d: unknown, ...s: string[]) => ({ __path: s.join('/') }),
  query: (c: any) => c, where: (...a: any[]) => a, orderBy: (...a: any[]) => a, limit: (...a: any[]) => a,
  addDoc: async () => ({ id: 'x' }), updateDoc: async () => {}, deleteDoc: async () => {}, setDoc: async () => {},
  serverTimestamp: () => ({}), getDoc: async () => ({ exists: () => true, data: () => ({}) }),
  getDocs: async (q: any) => {
    const docs = String(q?.__path ?? '').includes('givingStatements') ? mkDocs(STATEMENTS) : [];
    return { docs, forEach: (f: any) => docs.forEach(f), empty: !docs.length, size: docs.length };
  },
  onSnapshot: (q: any, cb: any) => {
    const p = String(q?.__path ?? '');
    const rows = p === 'tenants' ? TENANTS : p.includes('rag') || p.includes('sources') ? RAG_SOURCES : [];
    const docs = mkDocs(rows);
    cb({ docs, forEach: (f: any) => docs.forEach(f), empty: !docs.length, size: docs.length });
    return () => {};
  },
  Timestamp: { now: () => ({ toDate: () => new Date(0) }) },
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));
const authFetch = async (url: string) => ({
  ok: true,
  json: async () => (url.includes('sms-usage') ? { metered: true, used: 1840, limit: 4000, source: 'harvest' } : {}),
});
vi.mock('../../utils/auth-fetch', () => ({ authFetch }));
vi.mock('../../utils/tenant-scope', async (o) => ({ ...(await o() as any), getTenantScope: async () => 't1', getWriteTenantScope: async () => 't1' }));
vi.mock('../AdminScreenHeader', async (o) => ({ ...(await o() as any), useAdminHeader: () => ({ setHeaderAction: () => {}, setHeaderTitle: () => {} }) }));

const {
  mobileLayer, colourTokens, allTokens, maxWidthPx, maxWidthTokens,
  isResponsive, breakpointOf, heightTokens, heightPx, isColourToken,
} = await import('../../test/support/class-inventory');
const { FORM_CONTAINER, FORM_MEASURE, FIELD_WIDTH, FIELD_WIDTHS, ACTION_BUTTON, CONTAINERS } =
  await import('../layout/form-layout');

const REPO = path.resolve(__dirname, '../../..');
const SRC = path.resolve(__dirname, '..');
const readSrc = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

/**
 * The same file with its comments stripped. Every removal in this batch is
 * documented by a comment that names the value it removed, so a plain
 * `not.toContain` on the raw source would be defeated by its own explanation.
 */
const readCode = (rel: string) => stripComments(readSrc(rel));
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

/**
 * The revision this batch started from — `git log -1` on origin/main at the
 * time, and the "before" side of every measurement in the PR description.
 */
const PRE_PR_REVISION = '29769c6';
const atPrePr = (rel: string) =>
  execSync(`git show ${PRE_PR_REVISION}:src/components/${rel}`, { cwd: REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

// ─────────────────────────────────────────────────────────────────────────────
// Mounting.
// ─────────────────────────────────────────────────────────────────────────────
interface Mounted { container: HTMLDivElement; unmount: () => void }
const mounted: Mounted[] = [];

/** A signed-in super-admin, on the registry the component will import. */
const seedStore = async () => {
  const { useAppStore } = await import('../../store/useAppStore');
  useAppStore.setState({ currentTenantId: 't1', isAuthReady: true, isSuperAdmin: true } as any);
};

async function mount(element: React.ReactElement): Promise<HTMLDivElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root!: Root;
  await act(async () => { root = createRoot(container); root.render(element); await Promise.resolve(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  mounted.push({ container, unmount: () => { act(() => root.unmount()); container.remove(); } });
  return container;
}

const clickByText = async (root: ParentNode, text: string) => {
  const b = Array.from(root.querySelectorAll('button')).find((x) => (x.textContent ?? '').trim().startsWith(text));
  if (!b) throw new Error(`no button "${text}" — markup changed, test needs updating`);
  await act(async () => { b.dispatchEvent(new Event('click', { bubbles: true })); await Promise.resolve(); });
};

const byPlaceholder = (root: ParentNode, prefix: string): HTMLElement => {
  const el = Array.from(root.querySelectorAll('input,textarea,select')).find((i) =>
    (i.getAttribute('placeholder') ?? '').startsWith(prefix));
  if (!el) throw new Error(`no control with placeholder "${prefix}…" — markup changed, test needs updating`);
  return el as HTMLElement;
};

/** The control a <label> names — labels here are siblings, not `for`-linked. */
const byLabel = (root: ParentNode, label: string): HTMLElement => {
  const lab = Array.from(root.querySelectorAll('label')).find((l) => (l.textContent ?? '').trim() === label);
  if (!lab) throw new Error(`no label "${label}" — markup changed, test needs updating`);
  const field = lab.parentElement!.querySelector('input,select,textarea');
  if (!field) throw new Error(`label "${label}" names no control`);
  return field as HTMLElement;
};

const buttonByText = (root: ParentNode, text: string): HTMLButtonElement => {
  const b = Array.from(root.querySelectorAll('button')).find((x) => (x.textContent ?? '').trim().startsWith(text));
  if (!b) throw new Error(`no button "${text}" — markup changed, test needs updating`);
  return b as HTMLButtonElement;
};

/**
 * One top-level `const fn = …` declaration, from its name to the `};` that
 * closes it — a real boundary, so the comparison cannot run off the end of the
 * function into lines this batch legitimately changed.
 */
const fnBody = (src: string, decl: string): string => {
  const start = src.indexOf(decl);
  if (start < 0) throw new Error(`no declaration "${decl}"`);
  const end = src.indexOf('\n  };', start);
  return src.slice(start, end < 0 ? src.indexOf('\n\n', start) : end);
};

/** The widest max-width an element carries, in px. */
const capPx = (el: Element): number | null =>
  maxWidthTokens(el).map(maxWidthPx).find((v): v is number => v !== null) ?? null;

/** The nearest ancestor (or self) carrying a max-width cap. */
const cappedAncestor = (el: Element | null): Element | null => {
  for (let n = el; n; n = n.parentElement) if (capPx(n) !== null) return n;
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Screens under test.
// ─────────────────────────────────────────────────────────────────────────────
const ragAdd = async () => { await seedStore(); return mount(React.createElement((await import('../AdminRAG')).default)); };
const ragSources = async () => { const c = await ragAdd(); await clickByText(c, 'Sources'); return c; };
const tenants = async () => { await seedStore(); return mount(React.createElement((await import('../AdminTenants')).default)); };
const sms = async () => { await seedStore(); return mount(React.createElement((await import('../AdminSms')).default)); };
const statements = async () => { await seedStore(); return mount(React.createElement((await import('../AdminGivingStatements')).default)); };

import React from 'react';

const SCREENS: { name: string; file: string; open: () => Promise<HTMLDivElement> }[] = [
  { name: 'AdminRAG (Add Knowledge)', file: 'AdminRAG.tsx', open: ragAdd },
  { name: 'AdminRAG (Sources)', file: 'AdminRAG.tsx', open: ragSources },
  { name: 'AdminTenants', file: 'AdminTenants.tsx', open: tenants },
  { name: 'AdminSms', file: 'AdminSms.tsx', open: sms },
  { name: 'AdminGivingStatements', file: 'AdminGivingStatements.tsx', open: statements },
];

// ─────────────────────────────────────────────────────────────────────────────
// Baseline, extracted from PRE_PR_REVISION — never hand-typed.
//
// To re-record — ONLY when the sub-640px rendering is deliberately changing,
// which for this batch it is not:
//
//     UPDATE_LAYOUT_BASELINE=1 npx vitest run \
//       src/components/__tests__/admin-data-screens.desktop-layout.test.tsx
// ─────────────────────────────────────────────────────────────────────────────
const FIXTURES = path.join(__dirname, '__fixtures__');
const FIXTURE = path.join(FIXTURES, 'admin-data-screens-mobile.json');
const RECORDING = !!process.env.UPDATE_LAYOUT_BASELINE;

interface Baseline { [screen: string]: { mobileLayer: string[]; colours: string[]; allTokens: string[] } }
let BASELINE!: Baseline;

beforeAll(async () => {
  if (RECORDING) {
    const targets = ['AdminRAG.tsx', 'AdminTenants.tsx', 'AdminSms.tsx', 'AdminGivingStatements.tsx'];
    const backups = new Map(targets.map((t) => [t, readSrc(t)]));
    const out: Baseline = {};
    try {
      for (const t of targets) writeFileSync(path.join(SRC, t), atPrePr(t));
      vi.resetModules();
      for (const s of SCREENS) {
        const c = await s.open();
        out[s.name] = { mobileLayer: mobileLayer(c), colours: colourTokens(c), allTokens: allTokens(c) };
      }
      writeFileSync(FIXTURE, JSON.stringify(out, null, 2) + '\n');
    } finally {
      for (const [t, body] of backups) writeFileSync(path.join(SRC, t), body);
      vi.resetModules();
      while (mounted.length) mounted.pop()!.unmount();
    }
  }
  BASELINE = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Baseline;
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. The one that matters most — one assertion per file.
// ═════════════════════════════════════════════════════════════════════════════
/**
 * ONE token pair leaves the sub-640px class layer in this batch, and it is
 * enumerated here rather than absorbed by re-recording the fixture — a baseline
 * quietly re-recorded is a baseline that proves nothing.
 *
 * AdminTenants' page root carried `max-w-6xl mx-auto`. Both are provably inert
 * below 640px: `max-w-6xl` is 72rem, i.e. 1152px at the mobile rem base, and
 * the widest content box a 639px viewport can offer is 607px; `mx-auto` sets
 * auto side margins on a block that is already `w-full`, which computes to
 * zero. They were removed rather than left under the new rule because 72rem
 * ALSO has the rem-base split form-layout.ts exists to avoid (1152px on a
 * tablet, 1044px on a monitor), so leaving it is leaving a second, competing
 * definition of the same measure.
 *
 * Verified as rendering, not only as reasoning: screenshotted in headless
 * Chromium against the compiled stylesheet inside the real admin shell, the
 * page is byte-identical before and after at 380px, 480px and 639px — the
 * sha256 of each pair matches. The hashes are in the PR description.
 */
const INERT_BELOW_SM: Record<string, string[]> = {
  AdminTenants: ['max-w-6xl', 'mx-auto'],
};

/** The baseline's mobile layer with the enumerated inert tokens taken out. */
const expectedMobileLayer = (screen: string): string[] => {
  const drop = new Set(INERT_BELOW_SM[screen.split(' (')[0]] ?? []);
  return BASELINE[screen].mobileLayer.map((row) => {
    const [i, tag, tokens] = row.split('\t');
    return [i, tag, (tokens ?? '').split(' ').filter((t) => t && !drop.has(t)).join(' ')].join('\t');
  });
};

describe('the sub-640px rendering of each file is unchanged', () => {
  for (const s of SCREENS) {
    it(`renders the same class layer below 640px as it did before — ${s.name}`, async () => {
      expect(mobileLayer(await s.open())).toEqual(expectedMobileLayer(s.name));
    });
  }

  it('lets nothing but the enumerated inert tokens leave the sub-640px layer', async () => {
    for (const s of SCREENS) {
      const before = new Set(BASELINE[s.name].mobileLayer.flatMap((r) => (r.split('\t')[2] ?? '').split(' ')).filter(Boolean));
      const after = new Set(mobileLayer(await s.open()).flatMap((r) => (r.split('\t')[2] ?? '').split(' ')).filter(Boolean));
      const gone = [...before].filter((t) => !after.has(t)).sort();
      expect(gone, `${s.name} lost a token that is not on the inert list`)
        .toEqual((INERT_BELOW_SM[s.name.split(' (')[0]] ?? []).slice().sort());
    }
  });

  it('names why each of those tokens could not have rendered on a phone', () => {
    // `max-w-6xl` is 72rem. At the mobile rem base that is 1152px, and no
    // sub-640px viewport can offer a content box that wide, so the cap never
    // bound. `mx-auto` needs slack to centre into; the element is `w-full`.
    expect(maxWidthPx('max-w-6xl')).toBe(1152);
    expect(maxWidthPx('max-w-6xl')!).toBeGreaterThan(640);
  });

  it('gates every rule this batch spends at sm: or above — nothing can reach a phone', async () => {
    const spent = [FORM_CONTAINER, FORM_MEASURE, ACTION_BUTTON, ...FIELD_WIDTHS];
    const ungated = spent.flatMap((r) => r.split(/\s+/).filter(Boolean)).filter((t) => !isResponsive(t));
    expect(ungated, 'these tokens would apply at every width, mobile included').toEqual([]);
  });

  it('adds no unprefixed token to any file it touches', async () => {
    for (const s of SCREENS) {
      const before = new Set(BASELINE[s.name].mobileLayer.flatMap((r) => (r.split('\t')[2] ?? '').split(' ')).filter(Boolean));
      const after = new Set(mobileLayer(await s.open()).flatMap((r) => (r.split('\t')[2] ?? '').split(' ')).filter(Boolean));
      expect([...after].filter((t) => !before.has(t)), `${s.name} gained a token that applies on a phone`).toEqual([]);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Touch targets.
//
// No 44px floor is asserted: many targets here are already below it, unprefixed
// and deliberately left alone (THE-190). The only claim is that nothing got
// SMALLER — which, because every token this batch adds is `sm:`-gated, is
// checked two ways: no height token below `sm` moved, and no `sm:` height token
// was introduced that is shorter than what the same control already renders.
// ═════════════════════════════════════════════════════════════════════════════
describe('no touch target got smaller', () => {
  it('leaves every height that applies below 640px exactly as it was', async () => {
    for (const s of SCREENS) {
      const heights = (layer: string[]) =>
        layer.flatMap((row) => row.split('\t')[2]?.split(' ') ?? []).filter((t) => t && /^h-/.test(t)).sort();
      expect(heights(mobileLayer(await s.open())), s.name).toEqual(heights(BASELINE[s.name].mobileLayer));
    }
  });

  it('introduces no desktop height token at all — this batch spends no density rule', async () => {
    for (const s of SCREENS) {
      const c = await s.open();
      const added = allTokens(c).filter((t) => isResponsive(t) && /(?:^|:)h-/.test(t));
      const already = new Set(BASELINE[s.name].allTokens);
      expect(added.filter((t) => !already.has(t)), `${s.name} gained a desktop height`).toEqual([]);
    }
  });

  it('keeps the AI Knowledge delete button at the size it already had', async () => {
    const c = await ragSources();
    const del = Array.from(c.querySelectorAll('button')).filter((b) => b.getAttribute('title') === 'Delete source');
    expect(del.length, 'no delete control found — markup changed').toBeGreaterThan(0);
    // The desktop one is inline-sized; the rules never touched it.
    const desktop = del.find((b) => b.style.width === '32px');
    expect(desktop, 'the desktop delete target lost its explicit size').toBeDefined();
    expect(desktop!.style.height).toBe('32px');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Rule 1 / Rule 2 — each surface is constrained at desktop widths.
//    One assertion per file, naming the surface, never a value pattern.
// ═════════════════════════════════════════════════════════════════════════════
describe('each surface is constrained at desktop widths', () => {
  it('AI Knowledge takes the PAGE measure — it is a sources table and a two-column add grid, not a form', async () => {
    const c = await ragAdd();
    const capped = Array.from(c.querySelectorAll('div')).filter((d) => capPx(d) !== null);
    expect(capped.length, 'nothing in AI Knowledge carries a maximum width').toBeGreaterThan(0);
    for (const el of capped) {
      expect(capPx(el)).toBe(maxWidthPx(FORM_CONTAINER.split(/\s+/)[0]));
      expect(el.className).toContain('sm:mx-auto');
    }
  });

  it('the tenant list takes the PAGE measure — it lists every tenant on the platform', async () => {
    const c = await tenants();
    const root = c.firstElementChild!;
    expect(capPx(root), 'the tenant list root carries no maximum width').toBe(
      maxWidthPx(FORM_CONTAINER.split(/\s+/)[0]),
    );
    expect(root.className).toContain('sm:mx-auto');
  });

  it("the tenant card can shrink to its track, so a long church name truncates instead of overflowing", async () => {
    const c = await tenants();
    const name = Array.from(c.querySelectorAll('h3')).find((h) =>
      (h.textContent ?? '').startsWith('Grace Community Church'));
    expect(name, 'no tenant name rendered — markup changed').toBeDefined();
    const card = name!.closest('.rounded-2xl')!;
    const tokens = card.className.split(/\s+/);
    // Gated, so the phone keeps the overflow it has today (reported, not fixed).
    expect(tokens).toContain('sm:min-w-0');
    expect(tokens.filter((t) => !isResponsive(t) && /min-w-/.test(t))).toEqual([]);
  });

  it('the SMS broadcast composer caps its recipient picker and its tag, not its message', async () => {
    const c = await sms();
    expect(capPx(byLabel(c, 'Recipients'))).toBe(maxWidthPx(FIELD_WIDTH.medium));
    // A message body is the one control on this screen that wants the column.
    expect(capPx(byPlaceholder(c, 'Your message'))).toBeNull();
  });

  it('the SMS send action is full width on a phone and content width from sm up', async () => {
    const c = await sms();
    const tokens = buttonByText(c, 'Send now').className.split(/\s+/);
    expect(tokens.filter((t) => !isResponsive(t))).toContain('w-full');
    expect(tokens).toContain('sm:w-auto');
    for (const t of ACTION_BUTTON.split(/\s+/)) expect(tokens).toContain(t);
  });

  it('giving statements caps the tax year to a code width and the donor email to a long one', async () => {
    const c = await statements();
    expect(capPx(byLabel(c, 'Tax Year'))).toBe(maxWidthPx(FIELD_WIDTH.short));
    const single = Array.from(c.querySelectorAll('input[type=checkbox]'))[0] as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')!.set!.call(single, true);
      single.dispatchEvent(new Event('click', { bubbles: true }));
      single.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(capPx(byPlaceholder(c, 'donor@'))).toBe(maxWidthPx(FIELD_WIDTH.long));
  });

  it('the giving-statements generate action is full width on a phone and content width from sm up', async () => {
    const c = await statements();
    const tokens = buttonByText(c, 'Generate & Send').className.split(/\s+/);
    expect(tokens.filter((t) => !isResponsive(t))).toContain('w-full');
    expect(tokens).toContain('sm:w-auto');
  });

  it('caps the AI Knowledge search and its type filter as fields, not as the column', async () => {
    const c = await ragSources();
    const search = byPlaceholder(c, 'Search sources');
    const wrapper = cappedAncestor(search);
    expect(wrapper, 'the search field sits under no width rule').not.toBeNull();
    expect(capPx(wrapper!)).toBe(maxWidthPx(FIELD_WIDTH.long));
    const filter = Array.from(c.querySelectorAll('select')).find((s) =>
      Array.from(s.options).some((o) => o.textContent === 'All types'));
    expect(filter, 'no type filter — markup changed').toBeDefined();
    expect(capPx(filter!)).toBe(maxWidthPx(FIELD_WIDTH.short));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. THE AdminRAG GUARD — conflicting inline widths are removed, not overridden.
//
// This is the whole reason AdminRAG is the hard file. An inline `style` wins
// every cascade fight, so a container rule sitting next to `maxWidth:1160`
// would be dead markup that reads as a converted screen. Both halves are
// checked: the inline widths are gone from the source, and no element that
// carries one of the rules also carries an inline width or margin that would
// shadow it.
// ═════════════════════════════════════════════════════════════════════════════
describe('conflicting inline widths are removed, not overridden', () => {
  it('no longer spells the 1160px cap, or the centring that came with it, anywhere in AdminRAG', () => {
    const src = readCode('AdminRAG.tsx');
    expect(atPrePr('AdminRAG.tsx'), 'the pre-PR file should contain the cap being removed').toContain('maxWidth:1160');
    expect(src).not.toContain('maxWidth:1160');
    expect(src.match(/margin:"0 auto", width:"100%"/g) ?? []).toEqual([]);
    expect(src.match(/maxWidth:\s*1160/g) ?? []).toEqual([]);
  });

  it('no longer spells the type filter\'s inline width either', () => {
    expect(atPrePr('AdminRAG.tsx')).toContain('width:160');
    expect(readCode('AdminRAG.tsx')).not.toContain('width:160');
  });

  it('leaves no element carrying a container rule AND an inline width that would shadow it', async () => {
    for (const open of [ragAdd, ragSources]) {
      const c = await open();
      const ruled = Array.from(c.querySelectorAll<HTMLElement>('*')).filter((e) =>
        CONTAINERS.some((r) => r.split(/\s+/).every((t) => e.className?.split?.(/\s+/).includes(t))));
      expect(ruled.length, 'no element carries the container rule').toBeGreaterThan(0);
      for (const el of ruled) {
        expect(el.style.maxWidth, `${el.tagName} shadows the cap inline`).toBe('');
        expect(el.style.margin, `${el.tagName} shadows the centring inline`).toBe('');
      }
    }
  });

  it('leaves no field-width rule shadowed by an inline width on the same element', async () => {
    for (const open of [ragAdd, ragSources]) {
      const c = await open();
      const ruled = Array.from(c.querySelectorAll<HTMLElement>('*')).filter((e) =>
        FIELD_WIDTHS.some((w) => e.className?.split?.(/\s+/).includes(w)));
      expect(ruled.length).toBeGreaterThan(0);
      for (const el of ruled) expect(el.style.maxWidth, `${el.tagName} shadows its field width`).toBe('');
    }
  });

  it('keeps the inline widths that are NOT a layout rule — the modal, the blurb, the cell clamp', () => {
    // maxWidth:400 (delete modal), 560 (header blurb) and 110 (error cell) are
    // content clamps this batch has no business touching. They must survive, or
    // the removal above was a sweep rather than a decision.
    const src = readCode('AdminRAG.tsx');
    for (const kept of ['maxWidth:400', 'maxWidth:560', 'maxWidth:110']) expect(src).toContain(kept);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. THE ADMIN SHELL — reported and stopped, not changed.
//
// AdminDashboard.tsx is in this batch's scope and renders every other admin
// screen inside itself, including the six already converted. It carries no
// screen of its own: `AdminDashboardHome` is a separate file. So there was
// nothing in it to constrain that was not also a resize of every other screen,
// and the batch's own instruction for that case is to report and stop.
// ═════════════════════════════════════════════════════════════════════════════
describe("the admin shell's container is unchanged", () => {
  it('is byte-for-byte the file it was before this batch', () => {
    expect(readSrc('AdminDashboard.tsx')).toBe(atPrePr('AdminDashboard.tsx'));
  });

  it('spends no rule from the shared layout module', () => {
    expect(readCode('AdminDashboard.tsx')).not.toContain('form-layout');
  });

  it('still hosts every screen in the same per-tab wrapper, at the same padding', () => {
    const src = readSrc('AdminDashboard.tsx');
    // The wrapper each screen is mounted in. If a cap ever lands here it lands
    // on all of them at once, which is exactly what was declined.
    expect(src).toContain('<div className="p-4 lg:p-0"><AdminRAG /></div>');
    expect(src).toContain('<div className="p-4 lg:p-0"><AdminTenants /></div>');
    expect(src).toContain('<div className="p-4 lg:p-0"><AdminSms /></div>');
    expect(src.match(/max-w-/g) ?? []).toEqual(['max-w-']); // the sole `lg:max-w-none` on the nav
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. Behaviour — the three the batch named explicitly.
// ═════════════════════════════════════════════════════════════════════════════
describe('no tenant query, SMS send path or statement figure changed', () => {
  it('leaves the super-admin tenant subscription exactly as it was', () => {
    const before = atPrePr('AdminTenants.tsx');
    const after = readSrc('AdminTenants.tsx');
    const listener = /const q = collection\(db, 'tenants'\);[\s\S]*?return \(\) => unsubscribe\(\);/;
    expect(before.match(listener), 'the tenant listener moved — test needs updating').not.toBeNull();
    expect(after.match(listener)![0]).toBe(before.match(listener)![0]);
    // It runs unscoped, i.e. all tenants, and this batch did not scope it.
    expect(after).not.toMatch(/collection\(db, 'tenants'\),\s*where\(/);
  });

  it('leaves every SMS write path byte-identical, Text-to-Give included', () => {
    const before = atPrePr('AdminSms.tsx');
    const after = readSrc('AdminSms.tsx');
    for (const fn of ['const send = async', 'const saveTemplates = async', 'const saveT2g = async']) {
      expect(before.includes(fn), `${fn} moved — test needs updating`).toBe(true);
      expect(fnBody(after, fn)).toBe(fnBody(before, fn));
    }
  });

  it('leaves every giving-statement figure and its formatter byte-identical', () => {
    const before = atPrePr('AdminGivingStatements.tsx');
    const after = readSrc('AdminGivingStatements.tsx');
    for (const fn of ['const fmtMoney =', 'const loadStatuses =', 'const generate = async']) {
      expect(before.includes(fn), `${fn} moved — test needs updating`).toBe(true);
      expect(fnBody(after, fn)).toBe(fnBody(before, fn));
    }
    // Money stays in cents and is divided in exactly one place.
    expect((after.match(/\/ 100\)/g) ?? []).length).toBe((before.match(/\/ 100\)/g) ?? []).length);
  });

  it('changes no field, option or handler on any screen — only class attributes moved', async () => {
    for (const s of SCREENS) {
      const c = await s.open();
      const shape = (root: ParentNode) =>
        Array.from(root.querySelectorAll('input,select,textarea,button,option')).map((e) =>
          [e.tagName, e.getAttribute('placeholder') ?? '', e.getAttribute('value') ?? '', (e.textContent ?? '').trim()].join('|'));
      expect(shape(c).length, `${s.name} rendered no controls`).toBeGreaterThan(0);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. Provenance — every width, height and gap this batch spends is the module's.
// ═════════════════════════════════════════════════════════════════════════════
describe('widths, heights and gaps come from form-layout, not new per-screen values', () => {
  const TOUCHED = ['AdminRAG.tsx', 'AdminTenants.tsx', 'AdminSms.tsx', 'AdminGivingStatements.tsx'];

  it('introduces no arbitrary width, height or gap token that the module does not export', async () => {
    const known = new Set([...CONTAINERS, ACTION_BUTTON, ...FIELD_WIDTHS].flatMap((r) => r.split(/\s+/)));
    for (const s of SCREENS) {
      const c = await s.open();
      const already = new Set(BASELINE[s.name].allTokens);
      const minted = allTokens(c)
        .filter((t) => isResponsive(t))
        .filter((t) => /(?:^|:)(?:max-)?[wh]-\[|(?:^|:)gap-|(?:^|:)space-[xy]-\[/.test(t))
        .filter((t) => !known.has(t) && !already.has(t));
      expect(minted, `${s.name} minted a width/height/gap of its own`).toEqual([]);
    }
  });

  it('adds nothing to the shared module — no export moved and no value was invented in it', () => {
    const modulePath = path.join(SRC, 'layout/form-layout.ts');
    const before = execSync(`git show ${PRE_PR_REVISION}:src/components/layout/form-layout.ts`, { cwd: REPO, encoding: 'utf8' });
    expect(readFileSync(modulePath, 'utf8')).toBe(before);
  });

  it('leaves the old per-screen caps behind rather than layering the rule on top of them', () => {
    // A rule that merely sits next to `max-w-6xl` is a second definition of the
    // same measure, and one of them has the rem-base split the module exists to
    // avoid: 72rem is 1152px on a tablet and 1044px on a monitor.
    expect(atPrePr('AdminTenants.tsx')).toContain('max-w-6xl');
    expect(readCode('AdminTenants.tsx')).not.toContain('max-w-6xl');
  });

  it('keeps the two screens that were already narrower than the form measure at their own measure', () => {
    // AdminSms and AdminGivingStatements render 609px at 1024px and above,
    // inside FORM_MEASURE's 940px. Adopting it would WIDEN them by 331px, so
    // Rule 1 is deliberately not spent here and the reason is in the source.
    for (const f of ['AdminSms.tsx', 'AdminGivingStatements.tsx']) {
      const src = readSrc(f);
      expect(src, `${f} lost its container note`).toMatch(/Rule 1 is NOT applied to this container/);
      expect(src).toContain('max-w-2xl mx-auto');
      expect(src).not.toContain(FORM_MEASURE);
    }
  });

  it('touches no file outside this batch', () => {
    const changed = execSync(`git diff --name-only ${PRE_PR_REVISION} -- src functions firestore.rules`, {
      cwd: REPO, encoding: 'utf8',
    }).split('\n').filter(Boolean);
    const allowed = new Set([
      ...TOUCHED.map((f) => `src/components/${f}`),
      'src/components/__tests__/admin-data-screens.desktop-layout.test.tsx',
      'src/components/__tests__/__fixtures__/admin-data-screens-mobile.json',
      // Two existing tests pin the roster of files that import the shared
      // module, deliberately, so an adopter has to be written down twice. Batch
      // G is adopter six and adds four names to each. NOTE FOR THE MERGE: three
      // other batches are running in parallel and each will add ITS screens to
      // these same two lists, so this is a guaranteed textual conflict — take
      // the union of the names, keep them sorted, and both lists stay equal.
      'src/components/__tests__/ChurchEnrollment.desktop-layout.test.tsx',
      'src/components/__tests__/AdminCRM.desktop-layout.test.tsx',
    ]);
    expect(changed.filter((f) => !allowed.has(f))).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. Colour.
// ═════════════════════════════════════════════════════════════════════════════
describe('no colour is hardcoded, and all four palettes resolve', () => {
  for (const s of SCREENS) {
    it(`adds no colour token to ${s.name}`, async () => {
      expect(colourTokens(await s.open())).toEqual(BASELINE[s.name].colours);
    });
  }

  it('spells no raw colour in anything the batch added', () => {
    const rules = [...CONTAINERS, ACTION_BUTTON, ...FIELD_WIDTHS];
    expect(rules.flatMap((r) => r.split(/\s+/)).filter(isColourToken)).toEqual([]);
  });

  it('leaves every colour on these screens expressed through a theme token, so all four palettes resolve', () => {
    // Harvest and Classic x light and dark are switched by CSS custom
    // properties on <html>; a literal hex in the diff would render the same in
    // all four. There is none — the class layer is unchanged (above) and the
    // source gained no colour of its own.
    for (const f of ['AdminRAG.tsx', 'AdminTenants.tsx', 'AdminSms.tsx', 'AdminGivingStatements.tsx']) {
      const addedLines = execSync(`git diff -U0 ${PRE_PR_REVISION} -- src/components/${f}`, { cwd: REPO, encoding: 'utf8' })
        .split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
      const colours = addedLines.join('\n').match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) ?? [];
      expect(colours, `${f} introduced a raw colour`).toEqual([]);
    }
  });
});
