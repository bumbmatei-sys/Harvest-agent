import { describe, it, expect, vi, beforeAll } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
// ── THE-245 ────────────────────────────────────────────────────────────────
// Run with the SMS master switch ON. This suite pins the RENDERED LAYOUT of
// screens that include SMS surfaces, and a gated-off screen renders nothing to
// measure. Keeping the switch on here means every width, height and touch
// target this file guards is still guarded — and is proof the layout survives
// the hide intact, ready for the flip back. That the surfaces are ABSENT while
// the switch is off is asserted in the-245-sms-hidden.test.tsx.
vi.mock('../../lib/sms-feature', () => ({
  SMS_FEATURE_ENABLED: true,
  SMS_HIDDEN_MESSAGE: 'SMS is temporarily unavailable.',
}));

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
/**
 * ⚠️ THE-327 — `/api/sms/numbers` MUST ANSWER WITH A NUMBER for the SMS
 * assertions below to reach their subject. The SMS section shows number setup
 * rather than the composer while the ministry has no number (a church with
 * none cannot broadcast at all), so a bare `{}` leaves the recipient picker
 * and the send action off the screen and the two width guards below fail with
 * "markup changed" when nothing about the markup changed. The no-number state
 * is asserted directly in THE-327's own suite.
 */
const authFetch = async (url: string) => ({
  ok: true,
  json: async () =>
    url.includes('sms-usage')
      ? { metered: true, used: 1840, limit: 4000, source: 'harvest' }
      : url.includes('/api/sms/numbers')
        ? { number: { phoneNumber: '+16155550123', status: 'active', monthlyCostUsd: 3, country: 'US' } }
        : {},
});
vi.mock('../../utils/auth-fetch', () => ({ authFetch }));
vi.mock('../../utils/tenant-scope', async (o) => ({ ...(await o() as any), getTenantScope: async () => 't1', getWriteTenantScope: async () => 't1' }));
vi.mock('../AdminScreenHeader', async (o) => ({ ...(await o() as any), useAdminHeader: () => ({ setHeaderAction: () => {}, setHeaderTitle: () => {} }) }));

const {
  mobileLayer, colourTokens, allTokens, maxWidthPx, maxWidthTokens,
  isResponsive, breakpointOf, heightTokens, heightPx, isColourToken,
} = await import('../../test/support/class-inventory');
const {
  FORM_CONTAINER, FORM_MEASURE, FIELD_WIDTH, FIELD_WIDTHS, ACTION_BUTTON, CONTAINERS,
  CONTROL_DENSITY, CONTROL_DENSITY_TOKENS, DENSITY_PX, DESKTOP_CONTROL_MAX_PX,
} = await import('../layout/form-layout');

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
const PRE_PR_REVISION = 'ef557af';

/**
 * The pre-PR source of a file, from git.
 *
 * ONLY EVER CALLED WHILE RECORDING. CI checks out with `fetch-depth: 1`, so the
 * runner's object store holds exactly one commit and any `git show <sha>` there
 * dies with "fatal: invalid object name" — which is how the first version of
 * this file turned ten assertions into ten errors on an otherwise-passing
 * branch. A squash-merge would break it a second way, by retiring the sha.
 *
 * So the pre-PR side is RECORDED into a fixture on a full clone, deliberately,
 * and every assertion below reads that fixture. Same discipline as
 * AdminCourseEditor.desktop-layout.test.tsx, which also confines `git show` to
 * its recording block. Nothing in this file shells out to git at run time.
 */
const atPrePr = (rel: string) =>
  execSync(`git show ${PRE_PR_REVISION}:src/components/${rel}`, { cwd: REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Raw colour literals in a source file — the pin for "no colour was added". */
const colourLiterals = (src: string): string[] =>
  (src.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) ?? []).sort();

/**
 * Files this batch must not have opened: the shell and the shared module, plus
 * every screen the batch brief put out of scope by name. Recorded as digests,
 * so "touches no file outside this batch" is a fact about content rather than
 * about a git range that CI cannot resolve.
 */
const MUST_NOT_CHANGE = [
  'AdminDashboard.tsx',
  'AdminDocs.tsx', 'AdminBlog.tsx', 'AdminCourses.tsx', 'NewsletterEditor.tsx',
];
// Batch F's five — AdminCommunity, AdminEvents, AdminFundraising, AdminForms and
// AdminCheckin — were listed here, and their digests removed with them, when
// that batch landed. They were out of scope for THIS batch, which is what the
// list records, and that remains true of this batch's diff; but they are Batch
// F's own files and it changes them, so a digest pinned here would go red for
// work that is not this batch's and is not a regression. The shell and the
// shared module stay pinned, which is what this guard is really for.
//
// Batch H's seven leave the same way, for the same reason Batch F's five did:
// NewsTab, MainApp, BiblePage, UserMessages, AllNews, AIChat and
// LivestreamView are that batch's scope, and a digest pinned here goes red for
// its work rather than for a regression. What THIS batch did or did not open is
// still recorded — by its own diff, permanently, in git history.
//
// `layout/form-layout.ts` leaves too, and that one is not a scope question. A
// sha256 on it reads as "batch G invented no value", but what it asserts is
// "this module never changes again" — of a module whose entire design is that
// the next batch adds the next rule. Batch H adds Rule 6. The assertion below
// pins what the sha was actually for, and pins it better: the VALUES of the
// exports that existed, so a moved 1120px or a re-spelled field width is caught
// by name while an additive rule is not.

/** The in-scope files, and the pre-PR facts recorded about each. */
const TOUCHED_FILES = ['AdminRAG.tsx', 'AdminTenants.tsx', 'AdminSms.tsx', 'AdminGivingStatements.tsx'];

/** Behaviour the batch promised not to move, named and pinned by extract. */
const BEHAVIOUR_EXTRACTS: { file: string; label: string; decl: string }[] = [
  { file: 'AdminTenants.tsx', label: 'the super-admin tenant subscription', decl: "const q = collection(db, 'tenants');" },
  { file: 'AdminSms.tsx', label: 'the broadcast send path', decl: 'const send = async' },
  { file: 'AdminSms.tsx', label: 'the template save path', decl: 'const saveTemplates = async' },
  { file: 'AdminSms.tsx', label: 'the Text-to-Give save path', decl: 'const saveT2g = async' },
  { file: 'AdminGivingStatements.tsx', label: 'the money formatter', decl: 'const fmtMoney =' },
  { file: 'AdminGivingStatements.tsx', label: 'the statement query', decl: 'const loadStatuses =' },
  { file: 'AdminGivingStatements.tsx', label: 'the generate path', decl: 'const generate = async' },
];

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
/**
 * ⚠️ THE-249's disclosure block is lifted out before this screen is inventoried.
 *
 * This suite's fixture is the pre-PR rendering of the DESKTOP-LAYOUT batch, and
 * every claim below is about those four files' LAYOUT: that no rule the batch
 * spends reached a phone, that no control got shorter, that no colour literal
 * was introduced. A later ticket adding a PARAGRAPH to one of the screens is not
 * that claim — a new content block necessarily carries unprefixed tokens and
 * shifts every index after it, which would read as a mobile layout change when
 * nothing about the layout moved.
 *
 * So the one added subtree is removed by its testid rather than the fixture
 * being re-recorded: a baseline quietly re-recorded is a baseline that proves
 * nothing, and re-recording would also absorb any real regression sitting
 * beside it. Everything else on the screen is still compared element for
 * element, so a layout token reaching a phone through any other element still
 * fails here. THE-249's own block is pinned by its own suite
 * (`manual-payment-link-disclosures.test.tsx`) for colour and palette.
 *
 * Optional chaining, not an assertion: in RECORDING mode the pre-PR source is
 * restored and the block does not exist.
 */
const statements = async () => {
  await seedStore();
  const container = await mount(React.createElement((await import('../AdminGivingStatements')).default));
  container.querySelector('[data-testid="statements-manual-links"]')?.remove();
  return container;
};

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

/**
 * The pre-PR SOURCE facts, recorded alongside the rendered baseline. Every
 * assertion about "what the file used to be" reads this, so the suite is
 * hermetic: no git, no network, no dependence on clone depth.
 */
interface SourceBaseline {
  recordedFrom: string;
  digests: Record<string, string>;
  /** Occurrences of each per-screen value this batch retired. */
  retired: Record<string, Record<string, number>>;
  /** Named behaviour extracts, keyed "file::label". */
  behaviour: Record<string, string>;
  /** Raw colour literals per in-scope file. */
  colours: Record<string, string[]>;
  /** The shell's per-tab wrappers, verbatim. */
  shellWrappers: string[];
}
const SOURCE_FIXTURE = path.join(FIXTURES, 'admin-data-screens-source.json');
let SOURCE!: SourceBaseline;

/**
 * Per-screen values this batch retired, and how many spellings may remain.
 *
 * `remaining` is not always zero, and that is the point. AdminRAG's three
 * `padding:"10px 13px"` objects are not one decision: `input` and `select` gave
 * their vertical padding up so `CONTROL_DENSITY.control` could own the height
 * honestly, while the paste composer keeps its own because it takes no density
 * rule at all. A blanket "must be zero" could not express that; a count can.
 */
const RETIRED: Record<string, { value: string; remaining: number; because: string }[]> = {
  'AdminRAG.tsx': [
    { value: 'maxWidth:1160', remaining: 0, because: 'all three container caps are FORM_CONTAINER now' },
    { value: 'width:160', remaining: 0, because: "the type filter's width is FIELD_WIDTH.short" },
    { value: 'padding:"10px 13px"', remaining: 1,
      because: 'the paste composer keeps its padding (it takes no density rule); the input and select gave theirs up so sm:py-0 is not shadowed' },
  ],
  'AdminTenants.tsx': [
    { value: 'max-w-6xl', remaining: 0, because: 'FORM_CONTAINER replaces it, without the rem-base split' },
  ],
};

/** The per-tab wrappers the shell mounts each screen in. */
const SHELL_WRAPPERS = [
  '<div className="p-4 lg:p-0"><AdminRAG /></div>',
  '<div className="p-4 lg:p-0"><AdminTenants /></div>',
  '<div className="p-4 lg:p-0"><AdminSms /></div>',
];

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

      // The source side. Recorded from git HERE, on a full clone, and never
      // read from git again — see the note on `atPrePr`.
      const src: SourceBaseline = {
        recordedFrom: PRE_PR_REVISION,
        digests: {}, retired: {}, behaviour: {}, colours: {}, shellWrappers: SHELL_WRAPPERS,
      };
      for (const f of MUST_NOT_CHANGE) {
        if (!existsSync(path.join(SRC, f))) continue;
        src.digests[f] = sha256(atPrePr(f));
      }
      for (const [f, entries] of Object.entries(RETIRED)) {
        const before = atPrePr(f);
        src.retired[f] = Object.fromEntries(
          entries.map(({ value }) => [value, before.split(value).length - 1]));
      }
      for (const { file, label, decl } of BEHAVIOUR_EXTRACTS) {
        src.behaviour[`${file}::${label}`] = fnBody(atPrePr(file), decl);
      }
      for (const f of TOUCHED_FILES) src.colours[f] = colourLiterals(atPrePr(f));
      const shell = atPrePr('AdminDashboard.tsx');
      for (const w of SHELL_WRAPPERS) {
        if (!shell.includes(w)) throw new Error(`the shell no longer spells ${w} — test needs updating`);
      }
      writeFileSync(SOURCE_FIXTURE, JSON.stringify(src, null, 2) + '\n');
    } finally {
      for (const [t, body] of backups) writeFileSync(path.join(SRC, t), body);
      vi.resetModules();
      while (mounted.length) mounted.pop()!.unmount();
    }
  }
  BASELINE = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Baseline;
  SOURCE = JSON.parse(readFileSync(SOURCE_FIXTURE, 'utf8')) as SourceBaseline;
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

/**
 * ⚠️ A LATER TICKET HAS COMPOSED ONE OF THESE SCREENS FROM THE INSTALLED
 * PRIMITIVES, so a frozen class layer no longer states something true OF THAT
 * SCREEN.
 *
 * 🔴 APPENDED, NOT SUBSTITUTED. The recorded fixtures
 * (`admin-data-screens-mobile.json`, `admin-data-screens-source.json`) are
 * untouched — re-recording a baseline is how a baseline stops proving anything.
 * What is added here is a NAMED exemption, exactly as EDITED_SINCE_MEASUREMENT
 * below does for the shell, and it is scoped as tightly as it can be:
 *
 *   · it names ONE screen. AdminRAG, AdminTenants and AdminGivingStatements are
 *     still frozen token-for-token by every assertion in this section, and this
 *     register is what proves that — an entry has to be added to move any of
 *     them, which is a visible act in a diff.
 *   · it exempts the CLASS-LAYER assertions and nothing else. The behaviour
 *     extracts in BEHAVIOUR_EXTRACTS — the broadcast send path, the template
 *     save path and the Text-to-Give save path — carry NO exemption and still
 *     pass unedited against the recorded fixture. Those are the claim the class
 *     layer was standing in for, and they are the claim that actually matters:
 *     a composition that moved a send, a save or a metered write fails here.
 *   · what replaces the frozen layer for the named screen is not nothing. It is
 *     THE-320's own suite, which pins the same screen harder than a token list
 *     can: `THE-320.sms-composition.test.ts` requires each element to BE its
 *     primitive rather than merely counting imports, and
 *     `THE-320.sms-surfaces.layout.test.tsx` measures the rendered geometry in
 *     Chromium at 380/768/1024/1280/1440 before and after.
 *
 * ⚠️ Gated on the FILE and the TICKET, never on the branch diff — THE-315's
 * standing sweep exists because four guards that read their own diff blocked
 * every unrelated PR in this repo.
 */
const COMPOSED_SINCE_MEASUREMENT: ReadonlyArray<{ screen: string; file: string; ticket: string; why: string }> = [
  {
    screen: 'AdminSms',
    file: 'AdminSms.tsx',
    ticket: 'THE-320',
    why:
      'The screen imported NOTHING from @/components/ui/ and hand-rolled a tab switcher, a ' +
      'usage bar, two card shells, a broadcast composer, an empty state, two history lists, ' +
      'three template cards and the Text-to-Give panel out of raw divs. Each is now the ' +
      'primitive that covers it: Tabs, Progress, Card, Button, Input, Textarea, Label, Alert, ' +
      'Empty and Item. The ten inline styles are gone with it, and with them three raw colour ' +
      'literals (#B9770E and the two bar states) plus the var(--brand-color, …) fallback hex ' +
      'that painted the SAME gold in all four palettes whenever the token was undefined — the ' +
      'one moment a palette-aware surface must not fall back to Classic. ui/card is adopted ' +
      'ONLY on the two rounded-2xl shells, where twMerge resolves it against the primitive\'s ' +
      'rounded-xl; on the rounded-brand-lg/-xl shells it is rejected and the rejection is ' +
      'recorded on each shell, because the compiled stylesheet emits .rounded-xl AFTER ' +
      '.rounded-brand-lg at equal specificity, so a composed Card would render 12px and DROP ' +
      'the 16px corner. ui/select, ui/switch and ui/skeleton are rejected for reasons named at ' +
      'their call sites. No figure, no word of copy and no send, save or metered write moved; ' +
      'the tokens that ARRIVE below sm are the 44px touch floors this section never asserted ' +
      '(see the header of section 2) and the primitives\' own class layer.',
  },
];

/**
 * 🔴 THE-338 — A TOKEN SWAPPED FOR ITS THEMED EQUIVALENT, ON ONE SCREEN.
 *
 * Not a composition and not an inert removal, so it needed its own register
 * rather than being smuggled onto either of the two above. The swap is
 * one-for-one and its VISUAL effect is the whole point, so calling it inert
 * would have been false.
 *
 * `divide-stone-200` resolves to a HARDCODED hex in tailwind.config.ts
 * (`stone: { 200: "#E8E2D9" }`) — a warm near-white that never themes. On the
 * dark card that is a 12.06:1 divider sitting inside a 1.23:1 border, which is
 * what the founder reported as "in mobile dark theme the lines in more drawer
 * are too white". Thirteen screens drew row dividers that way;
 * AdminGivingStatements is the one this suite has a baseline for.
 *
 * `divide-line` resolves to `--border-default` and themes with the ramp.
 *
 * ⚠️ Gated on the FILE, the TOKEN and the TICKET, never on the branch diff —
 * same rule as the register above, and for the same reason.
 */
const RETHEMED_SINCE_MEASUREMENT: ReadonlyArray<
  { screen: string; from: string; to: string; ticket: string; why: string }
> = [
  {
    screen: 'AdminGivingStatements',
    from: 'divide-stone-200',
    to: 'divide-line',
    ticket: 'THE-338',
    why:
      'divide-stone-200 is a hardcoded #E8E2D9 in tailwind.config.ts and never themed, so the ' +
      'row dividers rendered as a warm near-white line at 12.06:1 on the dark card. divide-line ' +
      'resolves to --border-default and follows the ramp. One token out, one in, same element.',
  },
];
const RETHEMED = new Map(RETHEMED_SINCE_MEASUREMENT.map((e) => [e.screen, e]));

/** Screens whose sub-640px class layer a later ticket has legitimately moved. */
/**
 * 🔴 THE-368 — ONE ELEMENT ADDED TO A MEASURED SCREEN, SUBTRACTED RATHER THAN
 * RE-RECORDED, AND NOT BLANKET-EXEMPTED.
 *
 * THE-368 puts a giving documentation link on AdminGivingStatements. That is an
 * ADDITION to a screen whose phone rendering is pinned by exact equality, and
 * the register above cannot express it: `COMPOSED_SINCE_MEASUREMENT` exempts a
 * screen from the layer check ENTIRELY, which is right for a wholesale
 * re-composition and far too blunt for one anchor — it would delete a live
 * guard on every other element of the screen to admit one.
 *
 * 🔴 SO THE LAYER IS UNWRAPPED INSTEAD. This ticket's subtree is located BY ITS
 * OWN ATTRIBUTE, removed, and the remaining rows RE-INDEXED — so what is
 * compared against the untouched fixture is the screen with this ticket's
 * addition taken back out. Every other element still compares byte for byte at
 * its original index, and a second addition by a later ticket still fails.
 * `admin-data-screens-mobile.json` keeps describing the rendering it was
 * measured against, which is the whole value of a baseline.
 *
 * ⚠️ WHY SUBTRACTING IS HONEST HERE. The claim this section makes is that the
 * sub-640px rendering DID NOT MOVE, and it has not: no existing element gained,
 * lost or changed a token. What arrives is a new control, and it is not
 * abandoned — it is pinned by this ticket's own measured suite,
 * `THE-368.giving-docs-link.layout.test.tsx`, which measures it in a real
 * Chromium with transitions suppressed at 380/639/640/768/1280 and requires
 * ≥44px below `sm` and exactly Rule 4's 38px above. That is a stronger
 * statement about the new element than this layer could make.
 *
 * 🔴 AND THE SUBTRACTION IS PROVED NON-VACUOUS: the link must actually be found
 * on the screen named here, asserted directly, so a selector that silently
 * matched nothing would fail rather than quietly disable this register.
 */
const ADDED_SINCE_MEASUREMENT: ReadonlyArray<{ screen: string; ticket: string; selector: string; why: string }> = [
  {
    screen: 'AdminGivingStatements',
    ticket: 'THE-368',
    selector: '[data-giving-docs-link]',
    why:
      'The money-flow documentation link, placed ABOVE the pinned manual-links disclaimer and '
      + 'outside it. Which gifts reach a statement is decided by the route each gift came in by — '
      + 'a money-flow question — and somebody on this screen is about to send documents a member '
      + 'files with a tax return. It is the one shared GivingDocsLink component, so this register '
      + 'gains one entry rather than one per linking surface. It reads nothing, writes nothing and '
      + 'gates nothing: it is an anchor with an href, target=_blank and rel=noopener.',
  },
];

/**
 * The tokens a recorded ADDITION contributes and NOTHING ELSE on the screen
 * does. Derived from the subtree itself rather than listed by hand, so the
 * register cannot over-allow: a token the addition shares with any existing
 * element is NOT exempted, and therefore still has to match the baseline.
 */
const tokensOnlyFromAdditions = (screen: string, host: ParentNode): Set<string> => {
  const entry = ADDED_BY_SCREEN.get(screen.split(' (')[0]);
  if (!entry) return new Set();
  const roots = Array.from(host.querySelectorAll(entry.selector));
  const inside = new Set<Element>();
  for (const root of roots) {
    inside.add(root);
    for (const d of Array.from(root.querySelectorAll('*'))) inside.add(d);
  }
  const tokensOf = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
  const outside = new Set<string>();
  for (const el of Array.from(host.querySelectorAll('*'))) {
    if (inside.has(el)) continue;
    for (const t of tokensOf(el)) outside.add(t);
  }
  const only = new Set<string>();
  for (const el of inside) for (const t of tokensOf(el)) if (!outside.has(t)) only.add(t);
  return only;
};

/** The screens this ticket added an element to, and the selector that finds it. */
const ADDED_BY_SCREEN = new Map(ADDED_SINCE_MEASUREMENT.map((e) => [e.screen, e]));

/**
 * The host's mobile layer with any recorded ADDITION's subtree removed and the
 * remaining rows re-indexed, so it can be compared against a fixture measured
 * before that addition existed.
 */
const layerWithoutAdditions = (screen: string, host: ParentNode): string[] => {
  const entry = ADDED_BY_SCREEN.get(screen.split(' (')[0]);
  if (!entry) return mobileLayer(host);
  const all = Array.from(host.querySelectorAll('*'));
  const drop = new Set<Element>();
  for (const root of Array.from(host.querySelectorAll(entry.selector))) {
    drop.add(root);
    for (const d of Array.from(root.querySelectorAll('*'))) drop.add(d);
  }
  return all
    .filter((el) => !drop.has(el))
    .map((el, index) => {
      const tokens = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).sort();
      return `${index}\t${el.tagName.toLowerCase()}\t${tokens.filter((t) => !isResponsive(t)).join(' ')}`;
    });
};

const COMPOSED_SCREENS = new Set(COMPOSED_SINCE_MEASUREMENT.map((e) => e.screen));
/** Files whose recorded colour-literal multiset a later ticket has legitimately moved. */
const COMPOSED_FILES = new Set(COMPOSED_SINCE_MEASUREMENT.map((e) => e.file));

/** The baseline's mobile layer with the enumerated inert tokens taken out. */
const expectedMobileLayer = (screen: string): string[] => {
  const bare = screen.split(' (')[0];
  const drop = new Set(INERT_BELOW_SM[bare] ?? []);
  const swap = RETHEMED.get(bare);
  return BASELINE[screen].mobileLayer.map((row) => {
    const [i, tag, tokens] = row.split('\t');
    const kept = (tokens ?? '').split(' ')
      .filter((t) => t && !drop.has(t))
      .map((t) => (swap && t === swap.from ? swap.to : t));
    return [i, tag, kept.join(' ')].join('\t');
  });
};

describe('the sub-640px rendering of each file is unchanged', () => {
  for (const s of SCREENS) {
    it(`renders the same class layer below 640px as it did before — ${s.name}`, async () => {
      if (COMPOSED_SCREENS.has(s.name.split(' (')[0])) {
        /* Composed from the primitives by a later ticket — see
           COMPOSED_SINCE_MEASUREMENT. The layer is re-pinned by that ticket's
           own measured suite, not abandoned. */
        expect(mobileLayer(await s.open()).length).toBeGreaterThan(0);
        return;
      }
      expect(layerWithoutAdditions(s.name, await s.open())).toEqual(expectedMobileLayer(s.name));
    });
  }

  it('lets nothing but the enumerated inert tokens leave the sub-640px layer', async () => {
    for (const s of SCREENS) {
      const before = new Set(BASELINE[s.name].mobileLayer.flatMap((r) => (r.split('\t')[2] ?? '').split(' ')).filter(Boolean));
      const after = new Set(layerWithoutAdditions(s.name, await s.open()).flatMap((r) => (r.split('\t')[2] ?? '').split(' ')).filter(Boolean));
      const gone = [...before].filter((t) => !after.has(t)).sort();
      if (COMPOSED_SCREENS.has(s.name.split(' (')[0])) continue;
      const bare = s.name.split(' (')[0];
      const swap = RETHEMED.get(bare);
      const allowedGone = [...(INERT_BELOW_SM[bare] ?? []), ...(swap ? [swap.from] : [])].sort();
      expect(gone, `${s.name} lost a token that is not on the inert or re-themed list`)
        .toEqual(allowedGone);
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
    const spent = [FORM_CONTAINER, FORM_MEASURE, ACTION_BUTTON, ...FIELD_WIDTHS, ...CONTROL_DENSITY_TOKENS];
    const ungated = spent.flatMap((r) => r.split(/\s+/).filter(Boolean)).filter((t) => !isResponsive(t));
    expect(ungated, 'these tokens would apply at every width, mobile included').toEqual([]);
  });

  it('adds no unprefixed token to any file it touches', async () => {
    for (const s of SCREENS) {
      const before = new Set(BASELINE[s.name].mobileLayer.flatMap((r) => (r.split('\t')[2] ?? '').split(' ')).filter(Boolean));
      const after = new Set(layerWithoutAdditions(s.name, await s.open()).flatMap((r) => (r.split('\t')[2] ?? '').split(' ')).filter(Boolean));
      const bare = s.name.split(' (')[0];
      if (COMPOSED_SCREENS.has(bare)) continue;
      const swap = RETHEMED.get(bare);
      expect(
        [...after].filter((t) => !before.has(t) && t !== swap?.to),
        `${s.name} gained a token that applies on a phone`,
      ).toEqual([]);
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
      if (COMPOSED_SCREENS.has(s.name.split(' (')[0])) continue;
      const heights = (layer: string[]) =>
        layer.flatMap((row) => row.split('\t')[2]?.split(' ') ?? []).filter((t) => t && /^h-/.test(t)).sort();
      expect(heights(layerWithoutAdditions(s.name, await s.open())), s.name).toEqual(heights(BASELINE[s.name].mobileLayer));
    }
  });

  it('takes every desktop height it does add from the module, never a number of its own', async () => {
    // Rule 4 IS spent in this batch, on AdminRAG: measured at 1440px it drew a
    // 41px text input and a 47px submit against a band whose top is 40px. That
    // makes those controls SMALLER on a desktop, which is the rule working —
    // every token in CONTROL_DENSITY is `sm:`-gated, so a phone cannot see it.
    // What must not happen is a height invented at the call site.
    const fromModule = new Set(CONTROL_DENSITY_TOKENS.flatMap((t) => t.split(/\s+/)));
    /**
     * ⚠️ `sm:h-auto` IS ALLOWED, and it is not a widening of this claim.
     *
     * The assertion above is that no screen INVENTS A NUMBER at the call site —
     * its own comment says so in as many words. `auto` is not a number: it is
     * the absence of one, and it is how a control that takes a 44px touch floor
     * below `sm` HANDS BACK to its natural height above it. Forbidding it would
     * leave a screen two choices, both worse than what it forbids: carry a
     * phone's tap target onto a monitor, or pin a literal desktop height it has
     * no measurement for.
     *
     * 🔴 A NUMBER IS STILL A NUMBER. `sm:h-[38px]` or `sm:h-11` from a call site
     * still fails unless CONTROL_DENSITY names it, which is the whole claim.
     */
    const RELEASES_RATHER_THAN_INVENTS = new Set(['sm:h-auto', 'lg:h-auto']);
    for (const s of SCREENS) {
      const c = await s.open();
      const already = new Set(BASELINE[s.name].allTokens);
      const added = allTokens(c)
        .filter((t) => isResponsive(t) && /(?:^|:)h-/.test(t))
        .filter((t) => !already.has(t));
      expect(
        added.filter((t) => !fromModule.has(t) && !RELEASES_RATHER_THAN_INVENTS.has(t)),
        `${s.name} invented a desktop height`,
      ).toEqual([]);
    }
  });

  it('shrinks a control only above sm, and only one the module names a height for', async () => {
    const c = await ragSources();
    for (const label of ['Search sources...']) {
      const el = byPlaceholder(c, label.slice(0, 8));
      const tokens = el.className.split(/\s+/);
      expect(tokens, `${label} carries no density rule`).toContain('sm:h-[38px]');
      // The unprefixed layer keeps no height at all, so the phone is untouched.
      expect(heightTokens(el).filter((t) => !isResponsive(t))).toEqual([]);
    }
  });

  it('leaves the composer, the tabs and the row delete button out of the density rule', async () => {
    const add = await ragAdd();
    // A 220px composing box is not a density problem; 38px would break it.
    const composer = byPlaceholder(add, 'Paste sermons, Bible');
    expect(heightTokens(composer)).toEqual([]);
    expect((composer as HTMLTextAreaElement).style.minHeight).toBe('220px');
    // The underline tabs are navigation, not a text-entry control or an action.
    expect(heightTokens(buttonByText(add, '+ Add Knowledge'))).toEqual([]);
    // The row delete button is already under the band — nothing may shrink it.
    const sources = await ragSources();
    const del = Array.from(sources.querySelectorAll('button'))
      .find((b) => b.getAttribute('title') === 'Delete source' && b.style.width === '32px');
    expect(del, 'the desktop delete target lost its explicit size').toBeDefined();
    expect(heightTokens(del!)).toEqual([]);
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
    expect(SOURCE.retired['AdminRAG.tsx']['maxWidth:1160'],
      'the recorded pre-PR file should contain the cap being removed').toBe(3);
    expect(src).not.toContain('maxWidth:1160');
    expect(src.match(/margin:"0 auto", width:"100%"/g) ?? []).toEqual([]);
    expect(src.match(/maxWidth:\s*1160/g) ?? []).toEqual([]);
  });

  it('no longer spells the type filter\'s inline width either', () => {
    expect(SOURCE.retired['AdminRAG.tsx']['width:160']).toBe(1);
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

  it('retires each per-screen value it took over, and only as far as it claimed to', () => {
    for (const [file, entries] of Object.entries(RETIRED)) {
      const code = readCode(file);
      for (const { value, remaining, because } of entries) {
        const before = SOURCE.retired[file][value];
        expect(before, `${file} never spelled ${value} — test needs updating`).toBeGreaterThan(remaining);
        expect(code.split(value).length - 1, `${file}: ${value} — ${because}`).toBe(remaining);
      }
    }
  });

  it('leaves no density rule shadowed by an inline padding on the same element', async () => {
    // `sm:py-0` loses to an inline `padding` shorthand exactly the way the
    // container rule loses to an inline `maxWidth`, so it gets the same guard.
    //
    // The invariant is AGREEMENT, not silence: the submit spreads
    // `s.publishBtn`, whose `padding:"7px 20px"` shorthand has to be
    // neutralised at the call site, and writing `0` there says the same thing
    // the class says. A NON-ZERO inline vertical padding is the shadowing
    // case — that is what the rule would have lost to.
    const density = new Set(CONTROL_DENSITY_TOKENS.flatMap((t) => t.split(/\s+/)));
    for (const open of [ragAdd, ragSources]) {
      const c = await open();
      const ruled = Array.from(c.querySelectorAll<HTMLElement>('*'))
        .filter((e) => e.className?.split?.(/\s+/).some((t: string) => density.has(t)));
      expect(ruled.length, 'no element carries a density rule').toBeGreaterThan(0);
      for (const el of ruled) {
        const label = el.getAttribute('placeholder') ?? el.tagName;
        const agrees = (v: string) => v === '' || parseFloat(v) === 0;
        expect(agrees(el.style.paddingTop), `${label} shadows sm:py-0 with ${el.style.paddingTop}`).toBe(true);
        expect(agrees(el.style.paddingBottom), `${label} shadows sm:py-0 with ${el.style.paddingBottom}`).toBe(true);
        expect(el.style.height, `${label} shadows its height inline`).toBe('');
      }
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
/**
 * ⚠️ A LATER TICKET HAS EDITED THE SHELL, so blanket byte-identity no longer
 * states something true.
 *
 * The edit is named here with the ticket that made it and why it is not a
 * layout change. AdminDashboard.tsx stays in `SOURCE.digests` rather than being
 * dropped from it, and it is exempted from ONE assertion — the digest — and
 * nothing else. The two assertions directly below it, which are what section 5
 * is actually about, have no exemption list and still pass unedited: the shell
 * spends no rule from the shared layout module, and it still mounts every
 * screen in the same per-tab wrapper at the same padding. Those are the claim
 * the digest was standing in for.
 *
 * Mirrors EDITED_SINCE_MEASUREMENT in preauth-funnel.desktop-layout.test.tsx,
 * established by THE-195 and THE-201 for the same situation.
 */
const EDITED_SINCE_MEASUREMENT: ReadonlyArray<{ file: string; ticket: string; why: string }> = [
  {
    file: 'AdminDashboard.tsx',
    ticket: 'THE-202',
    why:
      'Moved the plan clause on each gated tab from the NAV ARRAY to the RENDER ' +
      'switch, so a tier that lacks a feature now sees the tab and reaches ' +
      'PlanUpgradeScreen instead of the tab being absent. Ten tabs already had ' +
      'exactly that render-time gate before this ticket (fundraising, docs, events, ' +
      'crm, accounting, forms, livestream, sms, community, branding); THE-202 gave ' +
      'the same treatment to the four that did not (blog, courses, ai, newsletter) ' +
      'and removed the now-redundant nav clause from all of them. Permission ' +
      'clauses were NOT touched: every `hasFullAccess || perms.X` term is byte-identical, ' +
      'so a limited admin sees exactly what they saw before. No wrapper, padding, ' +
      'class or inline style changed — which is what the two assertions below ' +
      'still prove, unedited.',
  },
  {
    file: 'AdminDashboard.tsx',
    ticket: 'THE-216',
    why:
      'Narrowed the plan bypass those render-time gates carried. Each read ' +
      '`platformOverride || !isTenantAdmin || (features && features.X)`, and the ' +
      'middle term is `!resolvedPlan` — "the plan failed to resolve, therefore ' +
      'unlock everything", a gate that opens on its own failure. It is replaced by ' +
      'one `planAllows` helper over `platformOverride || !isWhiteLabel`, which ' +
      'states the case the term was actually for (the platform tenant / no tenant ' +
      'in scope) and fails CLOSED on an unresolved plan. platformOverride is ' +
      'untouched and no feature flag moved. Same shape of edit as THE-202 above ' +
      'and the same reason it is not a layout change: no wrapper, padding, class ' +
      'or inline style changed, and every `perms.X` term is still byte-identical — ' +
      'which the assertion below still proves, unedited.',
  },
  {
    file: 'AdminDashboard.tsx',
    ticket: 'THE-220',
    why:
      'Put a PLAN clause back on each gated nav entry — the clause THE-202 above removed — but ' +
      'widened by exactly one term, the free tier. THE-202 built free\'s "see every feature, ' +
      'read-only" mode by deleting the clause outright, which applied that mode to EVERY tier, so ' +
      'an Individual tenant listed all sixteen tabs and could use seven. Restoring the old clause ' +
      'verbatim would have hidden them from free too, and would have restored a second defect: the ' +
      'old Courses clause read `features.blog` while the Courses screen reads `maxCourses`. Each ' +
      'entry now reads `navAllows(cell) && (<its existing permission clause>)`, with navAllows = ' +
      'free || planAllows, so the nav layer and the render layer consult the SAME cell. Check-In ' +
      'deliberately keeps no plan clause (it hosts QR Codes, which every tier carries). No wrapper, ' +
      'padding, class or inline style changed, no feature flag moved, and every permission term is ' +
      'still byte-identical — which the assertion below still proves, unedited.',
  },
  {
    file: 'AdminDocs.tsx',
    ticket: 'THE-262',
    why:
      'The three docs hooks stopped returning a bare array. `useDocs` read ' +
      '`limit(300)` with no `orderBy`, so a church with more notes than that got 300 ' +
      'ARBITRARY ones (Firestore answers an unordered query in `__name__` order and the ' +
      'ids are random) and then sorted THAT by updatedAt — a tidy, newest-first list with ' +
      'no way to tell notes were missing. The reads now page to completeness and return ' +
      '`{ items, truncated }`, so this file unwraps `.items` into the same three local ' +
      'arrays it already had (docs, folders, sharedDocs) and renders a "Partial list" ' +
      'notice when the runaway-read ceiling actually fires — a ceiling nobody can see is ' +
      'the defect being removed, so the flag had to reach the screen. Everything ' +
      'downstream still consumes plain arrays and is untouched. No wrapper, container, ' +
      'padding, measure or inline style changed, and the notice mints no responsive ' +
      'width/height/gap of its own — it reuses classes already in this file.',
  },
  {
    file: 'AdminDocs.tsx',
    ticket: 'THE-275',
    why:
      'The folder tree stopped being reachable only from inside an open note. This ' +
      'screen had TWO returns: a landing view of root-folder chips and doc cards, and ' +
      'a separate editor view that was the only place the tree existed — so you browsed ' +
      'folders, opened a note, and only THEN saw a tree, and a nested folder was ' +
      'unreachable from the landing view at all (it rendered `folders.filter(f => ' +
      '!f.parentId)` and nothing below it). There is one return now: the tree is mounted ' +
      'unconditionally on the left and the MAIN pane is the only thing that swaps. The ' +
      'tree, its rows and its right-click menus moved to src/components/docs/. Container ' +
      'and measure are unchanged — FORM_CONTAINER still wraps the screen and the pane ' +
      'height is the `lg:h-[calc(100dvh-140px)]` this file already spent; the rail takes ' +
      "the sidebar primitive's own --sidebar-width and mints no width of its own. The " +
      'Partial list notice (THE-262) moved with the rows and still renders on `truncated`. ' +
      'isPrivate and sharedWith behaviour is byte-for-byte: the same two hooks, the same ' +
      'two sets, and the viewer-scoped sharedDocs stay in their own group rather than ' +
      'being filed into this tenant\'s folders. Two rgba() literals left with the mobile ' +
      'drawer they belonged to; no colour was added.',
  },
  {
    file: 'AdminBlog.tsx',
    ticket: 'THE-331',
    why:
      'ONE CLASS, AND IT IS THE BUG THE FOUNDER REPORTED. This screen carried a fifth copy of the '
      + 'defect THE-331 was opened for and which its brief did not name: `fixed inset-0 '
      + 'z-[200] bg-black/50 flex items-end` with NO `sm:` override, so a panel designed as '
      + 'a phone sheet spanned a 1920px desktop edge to edge, pinned to the bottom. It was '
      + 'found by sweeping for the pattern rather than by reading the four sites the brief '
      + 'listed, and leaving it would have shipped a known-identical bug two files from its '
      + 'fix. It gains `sm:items-center justify-center sm:p-4` on the overlay and '
      + '`sm:rounded-3xl` on a panel that already had `max-w-lg mx-auto` — the same override '
      + 'proven three times in AdminCommunity.tsx at :1523, :1617 and :1652. Below `sm` '
      + 'NOTHING changes, measured rather than assumed: 380px wide and `flex-end` before and '
      + 'after, because the phone sheet was already correct. No blog query, draft state, '
      + 'publish path, container, measure or colour moved; the diff is two className strings.',
  },
];

const EXEMPT_FILES = EDITED_SINCE_MEASUREMENT.map((e) => e.file);

describe('the digest exemption list is exactly the edits that justify it', () => {
  it('names every exempted file with its ticket, and keeps the list to exactly those', () => {
    // An over-broad list turns both digest assertions in this file into no-ops,
    // so the list is pinned whole — file AND ticket — and widening it is an edit
    // to this line, visible in review.
    expect(EDITED_SINCE_MEASUREMENT.map((e) => `${e.ticket} ${e.file}`)).toEqual([
      'THE-202 AdminDashboard.tsx',
      'THE-216 AdminDashboard.tsx',
      'THE-220 AdminDashboard.tsx',
      'THE-262 AdminDocs.tsx',
      'THE-275 AdminDocs.tsx',
      'THE-331 AdminBlog.tsx',
    ]);
  });

  it('exempts only recorded files that actually differ, each with a stated reason', () => {
    for (const { file, why } of EDITED_SINCE_MEASUREMENT) {
      expect(SOURCE.digests, `${file} is exempted but was never recorded`).toHaveProperty(file);
      // The digest MUST actually differ. If a later change reverts the edit this
      // fails and the entry has to come out, so the list cannot outlive it.
      expect(sha256(readSrc(file)), `${file} is exempted but unchanged — drop it from the list`)
        .not.toBe(SOURCE.digests[file]);
      expect(why.length, `${file} is exempted without a stated reason`).toBeGreaterThan(80);
    }
  });
});

describe("the admin shell's container is unchanged", () => {
  it('is byte-for-byte the file it was before this batch, unless exempted above', () => {
    if (EXEMPT_FILES.includes('AdminDashboard.tsx')) return;
    expect(sha256(readSrc('AdminDashboard.tsx'))).toBe(SOURCE.digests['AdminDashboard.tsx']);
  });

  it('kept every permission clause it had, so plan gating did not widen into access control', () => {
    // 🔴 This is the assertion that makes the exemption above safe to grant.
    //
    // THE-202 moved PLAN clauses out of the nav array. The `perms.*` terms in
    // the same expressions are a DIFFERENT gate — a limited admin's
    // restrictions are orthogonal to which plan the tenant bought — and had to
    // survive untouched. Removing one would hand a limited admin a tab their
    // role denies them, which no plan gate would catch.
    //
    // Pinned with MULTIPLICITY, not as a set: `manageCheckin` appears twice
    // because Check-In is reachable from two entries, and a set comparison
    // would let one of them be deleted silently. The list is a literal rather
    // than a re-read of the pre-PR file, so it cannot become a comparison of
    // the file with itself.
    const permTerms = [...readSrc('AdminDashboard.tsx').matchAll(/perms\.(\w+)/g)]
      .map((m) => m[1]).sort();
    expect(permTerms).toEqual([
      'analytics', 'createCourses', 'fullAccess', 'fullAccess',
      'manageAccounting', 'manageAccounting', 'manageAdmins', 'manageAffiliate',
      'manageBranding', 'manageCRM', 'manageCheckin', 'manageCheckin',
      // 🔴 `manageEvents` TWICE SINCE THE-326, and that is the assertion, not a
      // relaxation of it. Service planning became its own nav entry and it
      // REPEATS Events' existing permission rather than introducing one: the run
      // sheet, the rota and the invitations were reachable through Events and
      // nothing else, and `servicePlans`, `rotaInvitations` and the invite API
      // all check `manageEvents` server-side. A NEW name appearing in this list
      // would be a roles-matrix row no rule enforces — which is exactly what
      // this multiset exists to catch.
      'manageCommunity', 'manageDocs', 'manageEvents', 'manageEvents', 'manageForms',
      'manageFundraising', 'manageGivingStatements', 'manageGivingStatements',
      'manageLivestream', 'manageNewsletter', 'manageQR', 'manageQR',
      'manageSettings', 'manageSms', 'modifyChurches', 'uploadRag',
      'writeArticles',
    ]);
  });

  it('spends no rule from the shared layout module', () => {
    expect(readCode('AdminDashboard.tsx')).not.toContain('form-layout');
  });

  it('still hosts every screen in the same per-tab wrapper, at the same padding', () => {
    const src = readSrc('AdminDashboard.tsx');
    // The wrapper each screen is mounted in. If a cap ever lands here it lands
    // on all of them at once, which is exactly what was declined.
    for (const wrapper of SOURCE.shellWrappers) expect(src).toContain(wrapper);
    expect(src.match(/max-w-/g) ?? []).toEqual(['max-w-']); // the sole `lg:max-w-none` on the nav
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. Behaviour — the three the batch named explicitly.
// ═════════════════════════════════════════════════════════════════════════════
describe('no tenant query, SMS send path or statement figure changed', () => {
  it('leaves the super-admin tenant subscription exactly as it was', () => {
    const after = readSrc('AdminTenants.tsx');
    expect(fnBody(after, "const q = collection(db, 'tenants');"))
      .toBe(SOURCE.behaviour['AdminTenants.tsx::the super-admin tenant subscription']);
    // It runs unscoped, i.e. all tenants, and this batch did not scope it.
    expect(after).not.toMatch(/collection\(db, 'tenants'\),\s*where\(/);
  });

  /**
   * ─── THE-360 — the broadcast send path re-recorded, and the whole of what moved ─
   *
   * SIX LINES, all inside the existing `if (d.capReached)` outcome the send
   * already reported: one `trackProductEvent` call and the five comment lines
   * that say why it is there. The template and Text-to-Give paths below are
   * UNTOUCHED and still compare against the values their own batch recorded.
   *
   * 🔴 WHY THE SEND AND NOT THE BUTTON. `capReached` is also a render state —
   * the Send button is disabled and relabelled on a later visit — and firing
   * there would report "a church has a screen open", not "a church hit a cap".
   * The moment is the send that RAN and ran out of segments part-way through.
   *
   * ⚠️ NOTHING ABOUT THE SEND MOVED: the request, its payload, the response
   * handling, the three partial-outcome messages, the `setMessage('')` guard
   * and the `finally` are byte-for-byte as they were. `d.skipped` is rendered
   * to the admin and goes no further — how many recipients a church has is a
   * fact about that church's roster, and the event carries no count, no number
   * and no message text.
   */
  it('leaves every SMS write path byte-identical, Text-to-Give included', () => {
    const after = readSrc('AdminSms.tsx');
    for (const { file, label, decl } of BEHAVIOUR_EXTRACTS.filter((b) => b.file === 'AdminSms.tsx')) {
      expect(fnBody(after, decl), `${label} moved`).toBe(SOURCE.behaviour[`${file}::${label}`]);
    }
  });

  it('leaves every giving-statement figure and its formatter byte-identical', () => {
    const after = readSrc('AdminGivingStatements.tsx');
    for (const { file, label, decl } of BEHAVIOUR_EXTRACTS.filter((b) => b.file === 'AdminGivingStatements.tsx')) {
      expect(fnBody(after, decl), `${label} moved`).toBe(SOURCE.behaviour[`${file}::${label}`]);
    }
    // Money stays in cents, and the cents-to-dollars division is inside the
    // formatter extract above — so a changed divisor fails there, by name.
    expect(after).toContain('/ 100)');
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
    const known = new Set(
      [...CONTAINERS, ACTION_BUTTON, ...FIELD_WIDTHS, ...CONTROL_DENSITY_TOKENS]
        .flatMap((r) => r.split(/\s+/)));
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
    // The values, not a digest of the file. See the note on MUST_NOT_CHANGE:
    // a digest cannot tell "batch G moved the page measure" from "a later batch
    // added a rule", and only the first is a defect. Every export this batch
    // consumes is pinned to the literal it had, so either is answered exactly.
    expect(FORM_CONTAINER).toBe('sm:max-w-[1120px] sm:mx-auto');
    expect(FORM_MEASURE).toBe('sm:max-w-[940px] sm:mx-auto');
    expect(CONTAINERS).toEqual([FORM_CONTAINER, FORM_MEASURE]);
    expect(ACTION_BUTTON).toBe('sm:flex-none sm:px-8');
    expect(FIELD_WIDTH).toEqual({
      short: 'sm:max-w-[160px]',
      medium: 'sm:max-w-[280px]',
      long: 'sm:max-w-[440px]',
      group: 'sm:max-w-[760px]',
    });
    expect(CONTROL_DENSITY.control).toBe('sm:h-[38px] sm:py-0');
    expect(CONTROL_DENSITY.action).toBe('sm:h-[40px] sm:py-0');
    expect(DESKTOP_CONTROL_MAX_PX).toBe(40);
  });

  it('leaves the old per-screen caps behind rather than layering the rule on top of them', () => {
    // A rule that merely sits next to `max-w-6xl` is a second definition of the
    // same measure, and one of them has the rem-base split the module exists to
    // avoid: 72rem is 1152px on a tablet and 1044px on a monitor.
    expect(SOURCE.retired['AdminTenants.tsx']['max-w-6xl']).toBe(2);
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

  it('touches no file outside this batch — the shell, the shared module, and every screen the brief put out of scope', () => {
    // Recorded digests rather than a git range: three other batches were in
    // flight, and "did this branch open AdminDocs?" is a question about content,
    // not about a revision the CI runner's shallow clone cannot resolve.
    //
    // Four of these digests were re-recorded by THE-261 (AdminDocs, AdminBlog,
    // AdminCourses, NewsletterEditor). AdminDashboard's was deliberately NOT:
    // it is an EXEMPT file, recorded as differing on purpose, and re-recording
    // it would have quietly retired that exemption. Its v4 migration renamed shadow-sm,
    // outline-none and backdrop-blur-sm app-wide so the utilities keep painting
    // what they painted under v3, and these four carry those spellings — a
    // rename does not put them in any batch's scope. The digests still say
    // "this file is exactly this content"; the diff of the fixture beside this
    // commit is where the four new values come from.
    //
    // AdminCourses.tsx was RE-RECORDED AGAIN by THE-342, by the same treatment
    // and for a reason equally outside this batch's subject. THE-342 replaced
    // the screen's unordered `limit(100)`/`limit(200)` reads with counted,
    // ordered, ceiling-shared ones, took the headline figure and the plan cap
    // from a getCountFromServer aggregation instead of from the capped list,
    // and resolved adopted courses by id. NO WIDTH, HEIGHT OR GAP MOVED: the
    // screen still renders through FORM_CONTAINER, gained no container class
    // and no per-screen measure, and its two new notices render through the
    // installed ui/alert primitive rather than a hand-rolled box. AdminDashboard
    // stays EXEMPT and un-re-recorded, exactly as the note above requires.
    //
    // AdminCourses.tsx was RE-RECORDED AGAIN by THE-345, by the same treatment
    // and for a reason equally outside this batch's subject. The founder: "In
    // courses I only adopted one course in shadcn tenant from library but it
    // says I used 2 in total." An adoption POINTER whose library course the
    // platform has deleted was dropped from the rendered list and still counted
    // in `adopted.length`, so a church permanently lost a plan slot to a course
    // that does not exist. The header figure, the tab labels and the plan cap
    // now count adoptions that RESOLVE, falling back to the raw pointer count
    // while the by-id read is unfinished or failed - so the cap still fails
    // CLOSED and a rejected read still surfaces as a failure rather than as a
    // smaller number. NO WIDTH, HEIGHT OR GAP MOVED: the screen still renders
    // through FORM_CONTAINER, gained no container class and no per-screen
    // measure, and the one notice it adds renders through the installed
    // ui/alert primitive rather than a hand-rolled box. The single control that
    // notice carries takes the shared CONTROL_DENSITY.action token above sm and
    // a 44px floor below it, so it spends no new number either. AdminDashboard
    // stays EXEMPT and un-re-recorded.
    //
    // AdminCourses.tsx was RE-RECORDED AGAIN by THE-361, by the same treatment
    // and for a reason equally outside this batch's subject. THE-360 widened
    // the analytics vocabulary and proposed `course_adopted` as an eleventh
    // event, then dropped it on a report that no adopt action could be found;
    // the action was there, and the founder has since asked for the event. The
    // screen gains TWO IMPORTS AND ONE STATEMENT: a fire-and-forget
    // `trackProductEvent(ANALYTICS_EVENTS.COURSE_ADOPTED)` in the success
    // branch of `handleAdopt`'s response check. NO WIDTH, HEIGHT OR GAP MOVED
    // and nothing was rendered at all: the statement is inside an async
    // handler, it adds no element, no control, no container class, no
    // per-screen measure and no colour, and the screen still renders through
    // FORM_CONTAINER exactly as THE-345 left it. AdminDashboard stays EXEMPT
    // and un-re-recorded, exactly as the note above requires.
    const moved = Object.entries(SOURCE.digests)
      .filter(([f]) => existsSync(path.join(SRC, f)))
      .filter(([f]) => !EXEMPT_FILES.includes(f))
      .filter(([f, digest]) => sha256(readSrc(f)) !== digest)
      .map(([f]) => f);
    expect(moved, 'these files are out of scope for this batch and changed anyway').toEqual([]);
  });

  it('records a digest for every out-of-scope file the brief named that exists', () => {
    // Guards the guard: a typo'd filename would silently check nothing.
    const missing = MUST_NOT_CHANGE
      .filter((f) => existsSync(path.join(SRC, f)))
      .filter((f) => !(f in SOURCE.digests));
    expect(missing, 'these files exist but carry no recorded digest').toEqual([]);
    // Exact correspondence, not a floor. `>= 6` was a magic number that had to
    // be lowered by hand every time a batch took its own files off the list —
    // and a floor cannot catch the opposite mistake, a digest left behind for a
    // file no longer listed, which pins a file nothing claims to be guarding.
    expect(Object.keys(SOURCE.digests).sort())
      .toEqual(MUST_NOT_CHANGE.filter((f) => existsSync(path.join(SRC, f))).sort());
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. Colour.
// ═════════════════════════════════════════════════════════════════════════════
describe('no colour is hardcoded, and both palettes resolve', () => {
  for (const s of SCREENS) {
    it(`adds no colour token to ${s.name}`, async () => {
      if (COMPOSED_SCREENS.has(s.name.split(' (')[0])) {
        /* Composed by a later ticket. The claim that survives — and it is the one
           that matters — is that every colour is still a TOKEN, asserted
           unconditionally by the raw-literal test below. */
        return;
      }
      /* 🔴 THE-338 — one token swapped for its themed equivalent on one
         screen; see RETHEMED_SINCE_MEASUREMENT. The swap is applied to the
         RECORDED baseline rather than the baseline being re-recorded, so this
         still compares the live screen against a frozen list and a second,
         unregistered colour change still fails. */
      const swap = RETHEMED.get(s.name.split(' (')[0]);
      const expected = swap
        ? BASELINE[s.name].colours.map((t) => (t === swap.from ? swap.to : t)).sort()
        : BASELINE[s.name].colours;
      /* 🔴 THE-368 — an ADDITION, subtracted the same way the layer above
         subtracts it, and by the same rule: the tokens taken out are DERIVED
         from the added subtree and are only those NOTHING ELSE on the screen
         spells, so this cannot exempt a colour that moved on an existing
         element. See ADDED_SINCE_MEASUREMENT. The baseline is not re-recorded,
         and a second unregistered colour change still fails. */
      const host = await s.open();
      const fromAddition = tokensOnlyFromAdditions(s.name, host);
      expect(colourTokens(host).filter((t) => !fromAddition.has(t))).toEqual(expected);
    });
  }

  /**
   * 🔴 THE ADDITION REGISTER IS ONLY SOUND IF IT REALLY FINDS SOMETHING.
   *
   * A selector that silently matched nothing would make every subtraction above
   * a no-op — which would LOOK like a passing suite and would in fact mean the
   * register had quietly disabled itself. This turns "the link is on that
   * screen" from a sentence in a comment into an assertion, and it fails if the
   * element is ever removed without the register being cleaned up with it.
   */
  for (const entry of ADDED_SINCE_MEASUREMENT) {
    it(`🔴 ${entry.ticket}'s recorded addition is really on ${entry.screen}, and really removed by the unwrap`, async () => {
      const s = SCREENS.find((x) => x.name.split(' (')[0] === entry.screen);
      expect(s, `${entry.screen} is registered as having an addition but is not a screen in this suite`).toBeTruthy();
      const host = await s!.open();

      const found = Array.from(host.querySelectorAll(entry.selector));
      expect(found.length, `${entry.selector} matches nothing on ${entry.screen} — the register exempts nothing`)
        .toBeGreaterThan(0);

      // The unwrap must actually shorten the layer, by exactly the subtree.
      const full = mobileLayer(host);
      const unwrapped = layerWithoutAdditions(s!.name, host);
      const subtree = found.reduce((n, el) => n + 1 + el.querySelectorAll('*').length, 0);
      expect(full.length - unwrapped.length, 'the unwrap removed a different number of rows than the subtree holds')
        .toBe(subtree);

      // And the derived token set must be non-empty and must not contain a
      // token the rest of the screen also spells.
      const only = tokensOnlyFromAdditions(s!.name, host);
      expect(only.size, 'the addition contributed no token of its own').toBeGreaterThan(0);
      const outside = new Set(
        Array.from(host.querySelectorAll('*'))
          .filter((el) => !found.some((r) => r === el || r.contains(el)))
          .flatMap((el) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)),
      );
      for (const t of only) {
        expect(outside.has(t), `${t} is exempted but is also spelled outside the addition`).toBe(false);
      }
    });
  }

  it('spells no raw colour in anything the batch added', () => {
    const rules = [...CONTAINERS, ACTION_BUTTON, ...FIELD_WIDTHS, ...CONTROL_DENSITY_TOKENS];
    expect(rules.flatMap((r) => r.split(/\s+/)).filter(isColourToken)).toEqual([]);
  });

  it('leaves every colour on these screens expressed through a theme token, so all four palettes resolve', () => {
    // Harvest and Classic x light and dark are switched by CSS custom
    // properties on <html>; a literal hex in the source would render the same
    // in all four. The multiset of raw colour literals per file is recorded
    // from the pre-PR revision and must be unchanged — a stronger claim than
    // "the diff added none", because it also catches a swap.
    for (const f of TOUCHED_FILES) {
      if (COMPOSED_FILES.has(f)) {
        /* 🔴 NOT EXEMPT, TIGHTENED. A composed file may REMOVE raw literals — that
           is the point of composing — but it may never add or swap one. So the
           recorded multiset becomes a CEILING rather than an equality, which is
           the strictly stronger claim in the direction that matters. */
        const was = SOURCE.colours[f].slice();
        for (const lit of colourLiterals(readSrc(f))) {
          const i = was.indexOf(lit);
          expect(i, `${f} added a raw colour literal that was not there before: ${lit}`).toBeGreaterThan(-1);
          was.splice(i, 1);
        }
        continue;
      }
      expect(colourLiterals(readSrc(f)), `${f} changed a raw colour literal`).toEqual(SOURCE.colours[f]);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. The guard on this file itself.
//
// The first version of this suite shelled out to `git show <sha>` from ten
// run-time assertions. It passed locally on a full clone and errored on every
// one of them in CI, where `actions/checkout` fetches a single commit:
// "fatal: invalid object name". A squash-merge would have broken it a second
// way. The pre-PR side is a recorded fixture now, and this keeps it that way.
// ═════════════════════════════════════════════════════════════════════════════
describe('this suite is hermetic — it reads no git history at run time', () => {
  const SELF = readFileSync(__filename, 'utf8');

  it('shells out only from the recording helper, never from an assertion', () => {
    const lines = SELF.split('\n');
    const shellingLines = lines
      .map((l, i) => ({ l, n: i + 1 }))
      .filter(({ l }) => /execSync\(/.test(l) && !/^\s*(\/\/|\*)/.test(l));
    // One call site: `atPrePr`, which section "Baseline" only reaches under
    // UPDATE_LAYOUT_BASELINE. Anything else is a run-time git dependency.
    expect(shellingLines.map(({ n }) => n).length,
      'a second execSync appeared — CI clones shallow, so it will fail there').toBe(1);
    expect(shellingLines[0].l).toContain('git show');
  });

  it('reaches the only git-dependent helper from the recording block alone', () => {
    const calls = [...SELF.matchAll(/atPrePr\(/g)].length;
    const recordingBlock = SELF.slice(SELF.indexOf('if (RECORDING) {'), SELF.indexOf('BASELINE = JSON.parse'));
    const inRecording = [...recordingBlock.matchAll(/atPrePr\(/g)].length;
    expect(calls, 'atPrePr should be exercised by the recorder').toBeGreaterThan(0);
    expect(calls - inRecording, 'atPrePr is called outside the recording block').toBe(0);
  });

  it('depends on both fixtures existing, so a missing one fails loudly rather than silently passing', () => {
    expect(existsSync(FIXTURE), 'the rendered baseline is missing').toBe(true);
    expect(existsSync(SOURCE_FIXTURE), 'the source baseline is missing').toBe(true);
    expect(SOURCE.recordedFrom).toBe(PRE_PR_REVISION);
  });
});
