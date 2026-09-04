import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import React from 'react';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * Batch F — the five admin ministry screens (Community, Events, Fundraising,
 * Forms, Check-In) against the form-layout.ts rules.
 *
 * All five carried a per-screen container measure in REM, so each was two
 * different numbers depending on which side of 1024px you were on. Measured in
 * headless Chromium against the real compiled Tailwind CSS and the admin shell
 * as form-layout.ts derives it (a 232px sidebar plus 1.5rem either side, i.e.
 * a 1164.5px content box at 1440px), on unmodified 29769c6:
 *
 *   Community          max-w-6xl   1044px at 1440 — and UNCAPPED at 1024/1280
 *   Events list        max-w-6xl   1044px at 1440 — and UNCAPPED at 1024/1280
 *   Events editor      max-w-2xl    609px, with a 563.5px "Event Title" field
 *   Events attendees   max-w-3xl    696px, with a 696px search field
 *   Fundraising list   max-w-5xl    928px, UNCAPPED at 1024
 *   Fundraising detail max-w-3xl    696px, with a 667px pledge field
 *   Forms list         max-w-3xl    696px
 *   Forms builder      max-w-3xl    696px, with a 657.75px "Form title" field
 *   Forms submissions  max-w-4xl    812px
 *   Check-In list      max-w-3xl    696px
 *   Check-In detail    max-w-3xl    696px
 *   Check-In create    max-w-xl     522px, with a 483.75px "Session Name" field
 *
 * ── The one cap that could not simply be replaced ────────────────────────────
 * `max-w-xl` is 576px at the 16px MOBILE rem base, and the content box at a
 * 639px viewport is 591px — so the Check-In create form's cap BINDS below
 * 640px, unlike every other cap here (all >= 672px, i.e. inert on a phone).
 * Replacing it would have moved the phone, so it is kept verbatim and the sm:
 * rule is layered above it. That was measured, not assumed; the other eleven
 * caps were confirmed inert the same way.
 *
 * Every rule reaching the markup comes from src/components/layout/form-layout.ts
 * and every one of them is gated at `sm:`, so none of it can reach a phone —
 * which is the first and most important thing this file pins.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ts = (iso: string) => ({ toDate: () => new Date(iso), seconds: Math.floor(Date.parse(iso) / 1000) });
const snapDoc = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });

const EVENTS = [{
  id: 'ev1', title: 'Sunday Worship Gathering', description: 'Weekly gathering for the whole church family.',
  coverImage: null, location: '1200 Harvest Way, Springfield', isOnline: false, onlineLink: null,
  startDate: ts('2026-09-06T10:00:00Z'), endDate: ts('2026-09-06T12:00:00Z'), capacity: 250,
  registrationDeadline: ts('2026-09-05T10:00:00Z'), price: 0, currency: 'usd', status: 'published',
  createdAt: ts('2026-08-01T10:00:00Z'), createdBy: 'u', tenantId: 't1',
  registrationEnabled: true, ticketTypes: [], waitlistEnabled: false, discountCodes: [],
}];
const CAMPAIGNS = [{
  id: 'c1', title: 'Building Fund 2026', description: 'Expanding the sanctuary for our growing congregation.',
  goal: 500000, raised: 182500, isActive: true, tenantId: 't1', campaignType: 'pledge', pledgeDeadline: '2026-12-31',
}];
const FORMS = [snapDoc('f1', {
  title: 'Volunteer Sign-Up', description: 'Tell us where you would like to serve.',
  fields: [{ id: 'a', type: 'short_text', label: 'Full name', required: true, placeholder: 'Your name', order: 0 }],
  isActive: true, submissionCount: 12, tenantId: 't1', createdAt: ts('2026-08-01T10:00:00Z'),
})];
const SESSIONS = [snapDoc('s1', {
  name: 'Sunday Service — September 6', date: '2026-09-06T10:00', location: 'Main Auditorium',
  status: 'active', attendeeCount: 42, createdAt: ts('2026-08-01T10:00:00Z'), createdBy: 'u',
})];
const CHANNELS = [snapDoc('ch1', {
  name: 'announcements', description: 'Church-wide announcements', memberIds: ['u'],
  tenantId: 't1', createdAt: ts('2026-08-01T10:00:00Z'), createdBy: 'u',
})];

const SNAP: Record<string, unknown[]> = {
  customForms: FORMS, forms: FORMS, formSubmissions: [],
  checkinSessions: SESSIONS, checkins: SESSIONS, attendees: [],
  channels: CHANNELS, channelMessages: [], directMessages: [], dmMessages: [], users: [],
  events: EVENTS.map((e) => snapDoc(e.id, e as unknown as Record<string, unknown>)),
  campaigns: CAMPAIGNS.map((c) => snapDoc(c.id, c as unknown as Record<string, unknown>)),
  registrations: [], pledges: [],
};
const lookup = (q: unknown): unknown[] => {
  const pick = (x: unknown) => (x as { __path?: string })?.__path;
  const p: string = (Array.isArray(q) ? q.map(pick).find(Boolean) : pick(q)) || '';
  return SNAP[p.split('/').filter(Boolean).pop() ?? ''] ?? [];
};

/** Every write this suite would let through, so "nothing was written" is checkable. */
const writes: string[] = [];

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

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u', email: 'a@t.com' } } }));
vi.mock('firebase/firestore', () => ({
  collection: (_d: unknown, ...s: string[]) => ({ __path: s.join('/') }),
  doc: (_d: unknown, ...s: string[]) => ({ __path: s.join('/') }),
  query: (q: unknown) => q,
  where: (...a: unknown[]) => a, orderBy: (...a: unknown[]) => a, limit: (...a: unknown[]) => a,
  onSnapshot: (q: unknown, cb: unknown) => {
    const docs = lookup(q);
    if (typeof cb === 'function') (cb as (s: unknown) => void)({ docs, forEach: (f: never) => docs.forEach(f), size: docs.length });
    return () => {};
  },
  getDocs: async (q: unknown) => {
    const docs = lookup(q);
    return { docs, forEach: (f: never) => docs.forEach(f), size: docs.length };
  },
  // THE-298 — AdminForms' submissions read pages to completeness by
  // `documentId()` after taking an exact `getCountFromServer` count, instead of
  // the `orderBy('submittedAt') + limit(1000)` it had. This module factory
  // replaces firebase/firestore WHOLE, so the three names that read adds have to
  // exist here or the screen dies on an undefined import rather than rendering.
  // They answer from the same `SNAP` table as `getDocs`, so every surface this
  // file pins renders exactly the data it did before.
  getCountFromServer: async (q: unknown) => ({ data: () => ({ count: lookup(q).length }) }),
  documentId: () => '__name__',
  startAfter: (...a: unknown[]) => a,
  getDoc: async () => ({ exists: () => true, data: () => ({}) }),
  addDoc: async (r: { __path?: string }) => { writes.push(`add:${r?.__path}`); return { id: 'x' }; },
  updateDoc: async (r: { __path?: string }) => { writes.push(`update:${r?.__path}`); },
  deleteDoc: async (r: { __path?: string }) => { writes.push(`delete:${r?.__path}`); },
  setDoc: async (r: { __path?: string }) => { writes.push(`set:${r?.__path}`); },
  serverTimestamp: () => null, Timestamp: class {}, increment: (n: number) => n,
  arrayUnion: (...a: unknown[]) => a, arrayRemove: (...a: unknown[]) => a,
  writeBatch: () => ({ set: () => {}, update: () => {}, delete: () => {}, commit: async () => { writes.push('batch'); } }),
}));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,AA' } }));
vi.mock('../ImageUpload', () => ({ ImageUpload: (p: { className?: string }) => <div data-image-upload="" className={p.className ?? ''} /> }));
vi.mock('../AdminQR', () => ({ default: () => <div data-admin-qr="" /> }));
vi.mock('../settings/PaymentSection', () => ({ default: () => <div data-payment-section="" /> }));
vi.mock('../AdminScreenHeader', () => ({
  useAdminHeader: () => ({ setHeaderAction: () => {}, setHeaderOverride: () => {}, setHeaderTitle: () => {} }),
  HeaderActionButton: (p: Record<string, unknown>) => <button {...p} />,
}));
vi.mock('../member/desktopKit', () => ({ HeroBand: (p: { children?: React.ReactNode }) => <div data-hero-band="">{p.children}</div> }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: () => {} }) }));
vi.mock('../../hooks/queries/useEventQueries', () => ({ useEvents: () => ({ data: EVENTS, isLoading: false }) }));
vi.mock('../../hooks/queries/useCampaignQueries', () => ({ useCampaigns: () => ({ data: CAMPAIGNS, isLoading: false }) }));
vi.mock('../../utils/auth-fetch', () => ({ authFetch: async () => ({ ok: true, json: async () => ({}) }) }));
vi.mock('../../utils/notify', () => ({ notifyError: () => {}, notifySuccess: () => {} }));
vi.mock('../../utils/tenant-scope', () => ({
  PLATFORM_TENANT_ID: 'platform', getTenantId: async () => 't1', getTenantIdFromHost: () => 't1',
  isPlatformContext: () => false, hasPlatformOverride: () => false,
  getTenantScope: async () => 't1', getWriteTenantScope: async () => 't1',
}));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: (sel?: (s: unknown) => unknown) => {
    const state = { currentTenantId: 't1', isAuthReady: true, isSuperAdmin: false, currentTenant: { id: 't1' } };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));
// THE-251 — AdminFundraising now reads `branding` to decide whether to show the
// manual-payment-links note, so this mock has to answer `useTenant` too. Empty
// branding is the honest default here: these five screens are pinned for LAYOUT,
// and a church with no links renders the same markup it always did.
vi.mock('../../contexts/TenantContext', () => ({
  useTenantOptional: () => ({ planFeatures: { checkInSystem: true } }),
  useTenant: () => ({ branding: {} }),
}));
vi.mock('../../utils/plan-features', () => ({ getPlanFeatures: () => ({ checkInSystem: true, fundraising: true }) }));
vi.mock('../../utils/super-admins', () => ({ isSuperAdminEmail: () => false }));

const { mountScreen, click, buttonByLabel } = await import('../../test/support/ministry-screens');
const {
  mobileLayer, colourTokens, isColourToken, allTokens, maxWidthPx, maxWidthTokens, isResponsive, breakpointOf, heightPx,
} = await import('../../test/support/class-inventory');
const FL = await import('../layout/form-layout');
const { FORM_CONTAINER, FORM_MEASURE, FIELD_WIDTH, FIELD_WIDTHS, ACTION_BUTTON, CONTROL_DENSITY, DENSITY_PX } = FL;

const SRC = path.resolve(__dirname, '..');
const REPO = path.resolve(SRC, '../..');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');
const FIXTURES = path.join(__dirname, '__fixtures__');
const RECORDING = !!process.env.UPDATE_LAYOUT_BASELINE;

/** The five screens, and the revision their pre-PR form is read from. */
const SCREENS = ['AdminCommunity', 'AdminEvents', 'AdminFundraising', 'AdminForms', 'AdminCheckin'] as const;
type Screen = typeof SCREENS[number];
const PRE_PR_REVISION = '974ae1d';

/**
 * The pre-PR shape of each screen, as a FIXTURE rather than a `git show` at
 * assertion time.
 *
 * The first cut of this file shelled out to `git show <rev>:<path>` inside the
 * assertions. That passes locally and can never pass on CI: `actions/checkout`
 * clones shallow, so the merge-base commit is not in the runner's object
 * database and every one of those tests died on `fatal: invalid object name`.
 * A test that needs history it cannot be given is not a test.
 *
 * So the git call happens once, under UPDATE_LAYOUT_BASELINE=1, on a machine
 * that has the history — and what lands in the repo is the extracted evidence:
 *
 *   • `strippedSha` / `strippedLines` — the source with every className
 *     replaced and comments dropped. A hash rather than the text itself
 *     because the five files strip to 3,928 lines, which would swamp review;
 *     `strippedLines` is carried alongside so a failure can at least say
 *     whether the file grew or shrank.
 *   • `firestorePaths` — every collection()/doc() path, verbatim. Small, and
 *     the thing PR 332's member gate actually depends on, so it is stored as
 *     readable text and diffed as text.
 *   • `exportCsv` — the check-in CSV body, verbatim. Small, and REP-4 says it
 *     must never be gated, so a failure here should show the real diff.
 */
interface PrePr {
  strippedSha: string;
  strippedLines: number;
  firestorePaths: string[];
  exportCsv: string | null;
}

/**
 * Presentation stripped out: className attributes in all three spellings, this
 * PR's import line, and comment-only and blank lines. What survives is the
 * behaviour — every query, write, handler and value.
 */
const stripPresentation = (src: string): string => unwrapSmsGate(src)
  .replace(/className=(?:"[^"]*"|\{`[^`]*`\}|\{[A-Za-z_$][\w.$]*\})/g, 'className=X')
  // An import of a LAYOUT module is presentation, not behaviour — the same
  // reasoning that already exempted form-layout, widened to the directory. A
  // screen that stops inventing a number and starts spending a shared one has
  // changed only how it renders, which is exactly what this hash is meant to
  // let through. THE-275 moved the full-height screens' `calc(100dvh - 140px)`
  // (a guess, ~37px too big) into layout/shell-height.ts, where it is derived
  // from the shell's own classes and checked against them.
  .replace(/^import \{[^}]*\} from '\.\/layout\/[\w-]+';$/gm, '')
  .replace(/^\s*(?:\/\/.*)?$\n?/gm, '');

/**
 * THE-245 — undo the SMS master-switch gate before hashing, and NOTHING else.
 *
 * AdminFundraising's "Send Reminder" POSTs to /api/sms/broadcast, so THE-245
 * hid it with the rest of SMS. That is a real edit to a file this suite pins
 * byte-for-byte, and the two honest ways to handle it are to re-record the
 * baseline or to reverse the known edit exactly. Re-recording is the weaker one:
 * it would bless every other byte that moved in the same breath, which is the
 * one thing this guard exists to catch.
 *
 * So the gate is reversed HERE, by exact string, and the hash is still taken
 * against the pre-PR revision. If any of these strings stops matching — because
 * the gate was reshaped, or because something else in the file moved — the
 * replacement silently no-ops and the hash goes red, which is the correct
 * outcome in both cases. What this guard actually protects (ticket prices,
 * donation amounts, fees, checkout calls) is untouched by the gate and stays
 * fully pinned.
 *
 * Delete this function when the SMS switch is flipped back on and the gate comes
 * out of AdminFundraising.
 */
const SMS_GATE_EDITS: [string, string][] = [
  ["import { SMS_FEATURE_ENABLED } from '../lib/sms-feature';\n", ''],
  [
    `              {/* THE-245 — "Send Reminder" POSTs to /api/sms/broadcast, so it is an
                  SMS surface living outside AdminSms and it goes with the rest.
                  The route refuses with 503 while the switch is off, so leaving
                  the button would offer a church an action that can only fail.
                  Everything else on a pledge campaign — the pledge list, Add
                  Pledge, Copy Pledge Link — is untouched. */}
              {SMS_FEATURE_ENABLED && (
                <button onClick={() => setReminderConfirm(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-line text-muted hover:bg-surface-sunken">
                  <Send size={13} /> Send Reminder
                </button>
              )}`,
    `              <button onClick={() => setReminderConfirm(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-line text-muted hover:bg-surface-sunken">
                <Send size={13} /> Send Reminder
              </button>`,
  ],
  ['{SMS_FEATURE_ENABLED && reminderConfirm && (', '{reminderConfirm && ('],
];

const unwrapSmsGate = (src: string): string =>
  SMS_GATE_EDITS.reduce((acc, [after, before]) => acc.replace(after, before), src);

const firestorePathsOf = (src: string): string[] =>
  [...src.matchAll(/(?:collection|doc)\(db,\s*([^)]*)\)/g)].map((m) => m[1].replace(/\s+/g, ' '));

/** The check-in CSV body, delimited by the two declarations that bracket it. */
const exportCsvOf = (src: string): string | null => {
  const from = src.indexOf('const exportCsv');
  const to = src.indexOf('const fmtTime');
  return from < 0 || to < 0 ? null : src.slice(from, to).trimEnd();
};

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const prePrOf = (src: string): PrePr => {
  const stripped = stripPresentation(src);
  return {
    strippedSha: sha(stripped),
    strippedLines: stripped.split('\n').length,
    firestorePaths: firestorePathsOf(src),
    exportCsv: exportCsvOf(src),
  };
};

/** How to see the actual diff when one of the hashes below goes red. */
const DIFF_HINT = (name: string) =>
  `run \`git diff ${PRE_PR_REVISION} -- src/components/${name}.tsx\` to see what moved`;

let PRE_PR!: Record<Screen, PrePr>;

const buttonContaining = (root: ParentNode, text: string): HTMLButtonElement => {
  const m = Array.from(root.querySelectorAll('button'))
    .find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').includes(text));
  if (!m) throw new Error(`no button containing "${text}" — the markup changed, test needs updating`);
  return m as HTMLButtonElement;
};

const open: { unmount: () => void }[] = [];
let mounted: { unmount: () => void } | null = null;
afterEach(() => {
  mounted?.unmount(); mounted = null;
  while (open.length) open.pop()!.unmount();
  writes.length = 0;
});

/** Mount a screen fresh, tracking it for teardown. */
async function screen(name: Screen): Promise<HTMLDivElement> {
  const Comp = (await import(`../${name}.tsx`)).default;
  const m = await mountScreen(<Comp />);
  mounted = m;
  return m.container;
}

/**
 * Every surface of every screen this PR's rules reach, each as a navigation
 * from a fresh mount.
 *
 * Covering only the surface a mount lands on is what let an ungated width on
 * the Check-In create form, and an unprefixed height on the Forms field editor,
 * both pass a full green run. A rule is only pinned on markup that renders, so
 * a sub-form that opens behind a toggle has to be opened.
 */
type Nav = (c: HTMLDivElement) => Promise<void>;
const NOOP: Nav = async () => {};

const clickRoleButton = (c: ParentNode, text: string) => {
  const el = Array.from(c.querySelectorAll('[role="button"]'))
    .find((d) => (d.textContent ?? '').includes(text));
  if (!el) throw new Error(`no card containing "${text}" — the markup changed`);
  return el as HTMLElement;
};

const SURFACES: Record<Screen, Record<string, Nav>> = {
  AdminCommunity: { default: NOOP },
  AdminEvents: {
    default: NOOP,
    form: async (c) => { await click(buttonContaining(c, 'Create event')); },
    // Ticket types and discount codes live behind the registrations toggle.
    formExpanded: async (c) => {
      await click(buttonContaining(c, 'Create event'));
      await click(c.querySelectorAll('button[aria-pressed]')[0] as HTMLElement);
      await click(buttonContaining(c, 'Add Ticket Type'));
      await click(buttonContaining(c, 'Add Discount Code'));
    },
    attendees: async (c) => { await click(clickRoleButton(c, 'Sunday Worship Gathering')); },
  },
  AdminFundraising: {
    default: NOOP,
    detail: async (c) => { await click(buttonContaining(c, 'Building Fund 2026')); },
    pledge: async (c) => {
      await click(buttonContaining(c, 'Building Fund 2026'));
      await click(buttonContaining(c, 'Add Pledge'));
    },
  },
  AdminForms: {
    default: NOOP,
    builder: async (c) => { await click(buttonContaining(c, 'Create form')); },
    // A new form starts with no fields, so the field EDITOR — three of the
    // controls this PR sizes — renders only once one is added.
    builderFields: async (c) => {
      await click(buttonContaining(c, 'Create form'));
      await click(buttonContaining(c, 'Short Text'));
      await click(buttonContaining(c, 'Dropdown'));
    },
    submissions: async (c) => { await click(buttonContaining(c, 'Volunteer Sign-Up')); },
  },
  AdminCheckin: {
    default: NOOP,
    create: async (c) => { await click(buttonContaining(c, 'New session')); },
    detail: async (c) => { await click(buttonContaining(c, 'Sunday Service — September 6')); },
  },
};

/** Every surface of a screen, each on its OWN mount. */
async function surfaces(name: Screen): Promise<Record<string, HTMLDivElement>> {
  const Comp = (await import(`../${name}.tsx`)).default;
  const out: Record<string, HTMLDivElement> = {};
  for (const [view, nav] of Object.entries(SURFACES[name])) {
    const m = await mountScreen(<Comp />);
    open.push(m);
    await nav(m.container);
    out[view] = m.container;
  }
  return out;
}

interface ViewBaseline { mobileLayer: string[]; colours: string[] }
type Baseline = Record<string, ViewBaseline>;

/**
 * Baselines are extracted mechanically from 29769c6 — the unmodified files
 * before this PR's diff — never hand-typed. Each screen is copied out, restored
 * to that revision, mounted with the SAME mocks the assertions use, then put
 * back. Same recipe as AdminCourseEditor.desktop-layout.test.tsx.
 *
 * To re-record — ONLY when the sub-640px rendering is deliberately changing,
 * which for this PR it is not:
 *
 *     UPDATE_LAYOUT_BASELINE=1 npx vitest run \
 *       src/components/__tests__/AdminMinistry.desktop-layout.test.tsx
 */
const BASELINE: Partial<Record<Screen, Baseline>> = {};

beforeAll(async () => {
  if (RECORDING) {
    for (const name of SCREENS) {
      const file = path.join(SRC, `${name}.tsx`);
      const backup = readFileSync(file, 'utf8');
      try {
        writeFileSync(file, execSync(`git show ${PRE_PR_REVISION}:src/components/${name}.tsx`, { cwd: REPO, encoding: 'utf8' }));
        vi.resetModules();
        // Record EVERY surface, not just the one a fresh mount lands on: a rule
        // spelled on a sub-view is invisible to a default-surface-only pin, which
        // is exactly how an ungated width on the Check-In create form slipped
        // through the first cut of this file.
        const recorded: Baseline = {};
        for (const [view, c] of Object.entries(await surfaces(name))) {
          recorded[view] = { mobileLayer: mobileLayer(c), colours: colourTokens(c) };
        }
        while (open.length) open.pop()!.unmount();
        writeFileSync(path.join(FIXTURES, `ministry-${name}.json`), JSON.stringify(recorded, null, 2) + '\n');
      } finally {
        writeFileSync(file, backup);
        vi.resetModules();
      }
    }
  }
  if (RECORDING) {
    const pre = {} as Record<Screen, PrePr>;
    for (const name of SCREENS) {
      pre[name] = prePrOf(execSync(`git show ${PRE_PR_REVISION}:src/components/${name}.tsx`, { cwd: REPO, encoding: 'utf8' }));
    }
    writeFileSync(path.join(FIXTURES, 'ministry-pre-pr.json'), JSON.stringify(pre, null, 2) + '\n');
  }
  for (const name of SCREENS) {
    BASELINE[name] = JSON.parse(readFileSync(path.join(FIXTURES, `ministry-${name}.json`), 'utf8')) as Baseline;
  }
  PRE_PR = JSON.parse(readFileSync(path.join(FIXTURES, 'ministry-pre-pr.json'), 'utf8')) as Record<Screen, PrePr>;
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. The one that matters most — one per file.
// ─────────────────────────────────────────────────────────────────────────────
describe('the sub-640px rendering of each file is unchanged', () => {
  /**
   * Tokens this PR takes OFF the mobile layer. Every one is a rem container cap
   * whose smallest value is 672px — wider than the 591px content box at the
   * 639px top of the phone range — so it could never bind below `sm:`, and
   * removing it cannot move a phone.
   *
   * Measured in headless Chromium against the real compiled Tailwind CSS at
   * 380 / 480 / 639px: all thirteen surfaces are byte-identical, full-page
   * screenshot for screenshot, across this change.
   */
  const NON_BINDING_CAPS: Record<string, number> = {
    'max-w-2xl': 672, 'max-w-3xl': 768, 'max-w-4xl': 896, 'max-w-5xl': 1024, 'max-w-6xl': 1152,
  };
  const ALLOWED_REMOVALS: Record<string, string> = {
    ...Object.fromEntries(Object.entries(NON_BINDING_CAPS)
      .map(([t, px]) => [t, `a ${px}px cap, above the 639px top of the phone range`])),
    'mx-auto': 'auto side margins on a block whose width is auto resolve to 0 — it centred nothing until a cap gave it something to centre, and the cap is now sm:-gated with it',
  };

  /**
   * This PR adds no unprefixed token at all: every rule it spells is sm:-gated.
   *
   * ⚠️ AMENDED BY THE-298, and RECORDED here rather than re-recorded.
   *
   * The founder's answers button ("see straight from that form all answers")
   * goes on the form card in both its mobile and desktop forms, and it reuses
   * the EXACT class string of the sibling buttons already in each action row —
   * so the only token either surface gains is the lucide icon's own name.
   *
   * 🔴 That token carries no size, no colour, no spacing and no layout: lucide
   * emits `class="lucide lucide-<icon>"` on its `<svg>` as an identifier, and
   * `lucide` itself was already on this layer. Tailwind defines no rule for it,
   * so it cannot move a phone, which is what this assertion is protecting.
   * `ministry-AdminForms.json` is NOT regenerated — the baseline still describes
   * the pre-PR rendering and the one addition is named here instead.
   *
   * The list is still CLOSED: a second addition, or any token that is a real
   * utility, still fails.
   */
  const ALLOWED_ADDITIONS: Record<string, string> = {
    'lucide-chart-column':
      "THE-298 — the answers button's icon identifier. lucide names every icon " +
      'in its own class; Tailwind defines no rule for it, so it sets nothing on ' +
      'a phone. The button itself reuses the action row\'s existing class string ' +
      'verbatim, so no utility token was added with it.',
  };

  const toTokens = (layer: string[]) =>
    [...new Set(layer.flatMap((l) => (l.split('\t')[2] ?? '').split(' ').filter(Boolean)))];

  for (const name of SCREENS) {
    it(`puts no undocumented token on the ${name} mobile layer`, async () => {
      for (const [view, c] of Object.entries(await surfaces(name))) {
        const before = new Set(toTokens(BASELINE[name]![view].mobileLayer));
        const added = toTokens(mobileLayer(c)).filter((t) => !before.has(t));
        expect(added.filter((t) => !(t in ALLOWED_ADDITIONS)),
          `${name}/${view} gained a token that reaches a phone`).toEqual([]);
      }
    });
  }

  for (const name of SCREENS) {
    it(`takes nothing off the ${name} mobile layer that could have bound below 640px`, async () => {
      for (const [view, c] of Object.entries(await surfaces(name))) {
        const now = new Set(toTokens(mobileLayer(c)));
        for (const t of toTokens(BASELINE[name]![view].mobileLayer).filter((t) => !now.has(t))) {
          expect(t in ALLOWED_REMOVALS,
            `${name}/${view} dropped "${t}", which is not documented as phone-neutral`).toBe(true);
        }
      }
    });
  }

  it('names a real px width for each cap it removed, so "cannot bind" is checkable', () => {
    for (const [token, px] of Object.entries(NON_BINDING_CAPS)) {
      expect(maxWidthPx(token), `${token} is not ${px}px`).toBe(px);
      expect(px).toBeGreaterThan(639);
    }
  });

  it('keeps the one cap that DOES bind below 640px exactly as it was', () => {
    // `max-w-xl` is 576px at the 16px mobile rem base, and the content box at a
    // 639px viewport measures 591px — so this cap is live on a phone, unlike
    // every other one here. It is kept verbatim; the sm: rule only out-ranks it
    // above 640px. Measured, not assumed.
    expect(maxWidthPx('max-w-xl')).toBe(576);
    expect(maxWidthPx('max-w-xl')).toBeLessThan(591);
    expect(read('AdminCheckin.tsx')).toContain('max-w-xl mx-auto ${FORM_MEASURE}');
  });

  it('gates every rule the shared module exports at sm: or above', () => {
    const tokens = [
      FORM_CONTAINER, FORM_MEASURE, ACTION_BUTTON,
      ...FIELD_WIDTHS, ...Object.values(CONTROL_DENSITY),
    ].flatMap((r) => r.split(' '));
    expect(tokens.length).toBeGreaterThan(0);
    for (const t of tokens) expect(isResponsive(t), `"${t}" applies on a phone`).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Touch targets.
// ─────────────────────────────────────────────────────────────────────────────
describe('no touch target got smaller', () => {
  it('adds no unprefixed height anywhere, so no tap target can shrink', async () => {
    for (const name of SCREENS) {
      for (const [view, c] of Object.entries(await surfaces(name))) {
        const base = new Set(BASELINE[name]![view].mobileLayer.flatMap((l) => l.split('\t')[2]?.split(' ') ?? []));
        for (const t of allTokens(c).filter((t) => /(?:^|:)h-/.test(t) && !isResponsive(t))) {
          expect(base.has(t), `${name}/${view} gained unprefixed ${t}`).toBe(true);
        }
      }
    }
  });

  it('keeps both density heights behind sm:, so a 38px control cannot become a 38px tap target', () => {
    for (const token of [CONTROL_DENSITY.control, CONTROL_DENSITY.action]) {
      for (const t of token.split(' ')) expect(breakpointOf(t)).toBe('sm');
    }
    expect(heightPx('sm:h-[38px]')).toBe(DENSITY_PX.control);
    expect(heightPx('sm:h-[40px]')).toBe(DENSITY_PX.action);
  });

  it('records the measured result rather than asserting a 44px floor', () => {
    // 423 tap targets were compared before/after at 380, 480 and 639px in
    // headless Chromium: none lost width or height, and the full-page
    // screenshots are byte-identical at all three. Many targets here are
    // already below 44px, unprefixed and deliberately left alone (THE-190), so
    // the assertion is "nothing shrank", never "everything clears 44px".
    expect(DENSITY_PX.control).toBeLessThan(44);
    expect(CONTROL_DENSITY.control.startsWith('sm:')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The container rule — one per file.
// ─────────────────────────────────────────────────────────────────────────────
/**
 * The one surface in this batch that deliberately carries NO measure.
 *
 * AdminCommunity is a fixed 340px rail beside a message pane. A measure exists
 * to stop a LINE OF PROSE from running the width of a monitor, and this screen
 * renders none at its root — so the 1120px cap could only ever fall on the
 * pane, which is the one part that wants the room, and what it produced was a
 * band of dead space between the admin nav and the conversation list on every
 * screen wider than 1120px. It takes the shell's content box instead.
 *
 * Named here rather than dropped from SCREENS, so the other ten assertions this
 * file makes about it stay live, and so "uncapped" is a claim this file states
 * out loud rather than a gap in a loop.
 */
const UNCAPPED: ReadonlyArray<Screen> = ['AdminCommunity'];

describe('each surface is constrained at desktop widths', () => {
  const capOf = (c: ParentNode) => maxWidthTokens(c.firstElementChild as Element);

  for (const name of SCREENS.filter((n) => !UNCAPPED.includes(n))) {
    it(`caps every surface of ${name} with a shared measure and nothing else`, async () => {
      for (const [view, c] of Object.entries(await surfaces(name))) {
        const caps = capOf(c);
        expect(caps.length, `${name}/${view} carries ${caps.length} caps: ${caps.join(' ')}`).toBeGreaterThan(0);
        for (const cap of caps) {
          // Either a shared measure, or the one pre-existing phone-live cap.
          const shared = cap === 'sm:max-w-[1120px]' || cap === 'sm:max-w-[940px]';
          expect(shared || cap === 'max-w-xl', `${name}/${view} spells its own ${cap}`).toBe(true);
        }
        expect(caps.some((c2) => c2.startsWith('sm:')), `${name}/${view} has no desktop cap`).toBe(true);
      }
    });
  }

  for (const name of UNCAPPED) {
    it(`leaves every surface of ${name} uncapped, and mints nothing in place of the measure`, async () => {
      // The exemption is asserted, not assumed: an uncapped screen must carry
      // NO max-width at all, so "we removed the measure" cannot quietly become
      // "we replaced it with one of our own".
      for (const [view, c] of Object.entries(await surfaces(name))) {
        expect(capOf(c), `${name}/${view} put a cap back on an uncapped surface`).toEqual([]);
      }
    });
  }

  it('gives the data-dense pages the PAGE measure and the forms the FORM measure', () => {
    expect(FORM_CONTAINER).toContain('1120px');
    expect(FORM_MEASURE).toContain('940px');
    // The three form surfaces name the form measure; every other surface is a page.
    for (const f of ['AdminEvents.tsx', 'AdminForms.tsx', 'AdminCheckin.tsx']) expect(read(f)).toContain('FORM_MEASURE');
    for (const f of ['AdminFundraising.tsx']) {
      expect(read(f)).toContain('FORM_CONTAINER');
      expect(read(f)).not.toContain('FORM_MEASURE');
    }
    // AdminCommunity took the page measure and gave it back — see UNCAPPED
    // above. It must spend neither, or it has quietly re-adopted one.
    for (const f of ['AdminCommunity.tsx']) {
      const code = read(f).replace(/^\s*\/\/.*$/gm, '');
      expect(code).not.toContain('FORM_CONTAINER');
      expect(code).not.toContain('FORM_MEASURE');
    }
  });

  it('leaves no rem-based measure on any surface ROOT of the five', async () => {
    // `max-w-xl` is the documented phone-live exception. Modal and prose
    // measures (`max-w-sm`/`max-w-md`/`max-w-lg`) are live on a phone and are
    // not surface roots, so they are deliberately untouched and unchecked here.
    for (const name of SCREENS) {
      for (const [view, c] of Object.entries(await surfaces(name))) {
        for (const cap of maxWidthTokens(c.firstElementChild as Element)) {
          const arbitrary = /max-w-\[\d+px\]$/.test(cap);
          expect(arbitrary || cap === 'max-w-xl', `${name}/${view} root still spells rem-based ${cap}`).toBe(true);
        }
      }
      mounted?.unmount(); mounted = null;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Where the numbers come from.
// ─────────────────────────────────────────────────────────────────────────────
describe('widths, heights and gaps come from form-layout, not new per-screen values', () => {
  it('imports the rules in every file that spells one, and only those', () => {
    for (const name of SCREENS.filter((n) => !UNCAPPED.includes(n))) {
      expect(read(`${name}.tsx`)).toContain("from './layout/form-layout'");
    }
    // The converse for the uncapped screen: it spends no rule, so it must not
    // carry the import either — an unused import here is how a measure creeps
    // back one line at a time.
    for (const name of UNCAPPED) {
      expect(read(`${name}.tsx`), `${name} imports rules it no longer spends`)
        .not.toContain("from './layout/form-layout'");
    }
  });

  it('spells no sm:-gated width, height or gap literal outside the module', () => {
    for (const name of SCREENS) {
      const literals = [...read(`${name}.tsx`).matchAll(/sm:(?:max-w|w|h|gap|space-[xy]|p[xytblr]?|m[xytblr]?)-\[[^\]]+\]/g)].map((m) => m[0]);
      expect(literals, `${name} writes its own sm: size`).toEqual([]);
    }
  });

  it('renders no sm:-gated size the module does not define', async () => {
    const defined = new Set([
      ...FORM_CONTAINER.split(' '), ...FORM_MEASURE.split(' '), ...ACTION_BUTTON.split(' '),
      ...FIELD_WIDTHS, ...Object.values(CONTROL_DENSITY).flatMap((v) => v.split(' ')),
      // `sm:w-auto` carries no VALUE — it is the block-level twin of
      // `sm:flex-none`, spelled at the call site exactly as AdminCourseEditor
      // already spells it for its own full-width buttons.
      'sm:w-auto',
    ]);
    // Only tokens this PR ADDED are in scope: the screens carry pre-existing
    // responsive tokens (a `sm:grid-cols-[auto_1fr]` template on the attendees
    // roster, for one) that are not sizes and are not this PR's to justify.
    for (const name of SCREENS) {
      for (const [view, c] of Object.entries(await surfaces(name))) {
        const before = new Set(BASELINE[name]![view].mobileLayer.flatMap((l) => l.split('\t')[2]?.split(' ') ?? []));
        const added = allTokens(c).filter((t) => !before.has(t) && breakpointOf(t) === 'sm');
        const sized = added.filter((t) => /^sm:(?:max-w|w|h|gap|space-[xy]|p[xytblr]?|m[xytblr]?)-/.test(t));
        for (const t of sized) expect(defined.has(t), `${name}/${view} renders undefined ${t}`).toBe(true);
      }
    }
  });

  it('measures every value it uses in px, so the desktop rem trim cannot move it', () => {
    for (const r of [FORM_CONTAINER, FORM_MEASURE, ...FIELD_WIDTHS, ...Object.values(CONTROL_DENSITY)]) {
      for (const m of r.matchAll(/\[([^\]]+)\]/g)) expect(m[1]).toMatch(/px$/);
    }
  });

  it('adds nothing to the shared module — the five screens are consumers only', () => {
    // Pinned by VALUE, not by the file's bytes. A byte-for-byte check would go
    // red the moment a parallel batch legitimately ADDS an export, which is not
    // this PR's business; changing a value one of these screens renders IS.
    expect(FORM_CONTAINER).toBe('sm:max-w-[1120px] sm:mx-auto');
    expect(FORM_MEASURE).toBe('sm:max-w-[940px] sm:mx-auto');
    expect(ACTION_BUTTON).toBe('sm:flex-none sm:px-8');
    expect(FIELD_WIDTH.short).toBe('sm:max-w-[160px]');
    expect(FIELD_WIDTH.medium).toBe('sm:max-w-[280px]');
    expect(FIELD_WIDTH.long).toBe('sm:max-w-[440px]');
    expect(FIELD_WIDTH.group).toBe('sm:max-w-[760px]');
    expect(CONTROL_DENSITY.control).toBe('sm:h-[38px] sm:py-0');
    expect(CONTROL_DENSITY.action).toBe('sm:h-[40px] sm:py-0');
    expect(DENSITY_PX.control).toBe(38);
    expect(DENSITY_PX.action).toBe(40);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. PR 332's gate depends on this.
// ─────────────────────────────────────────────────────────────────────────────
describe('no community query or write path changed', () => {
  const COLLECTIONS = ['channels', 'channelMessages', 'directMessages', 'dmMessages'];

  it('reads and writes the same four collections, spelled the same way', () => {
    const after = read('AdminCommunity.tsx');
    expect(firestorePathsOf(after)).toEqual(PRE_PR.AdminCommunity.firestorePaths);
    for (const c of COLLECTIONS) expect(after.includes(c), `${c} disappeared`).toBe(true);
  });

  it('changes nothing in AdminCommunity outside a className', () => {
    const now = stripPresentation(read('AdminCommunity.tsx'));
    expect(now.split('\n').length, DIFF_HINT('AdminCommunity')).toBe(PRE_PR.AdminCommunity.strippedLines);
    expect(sha(now), DIFF_HINT('AdminCommunity')).toBe(PRE_PR.AdminCommunity.strippedSha);
  });

  it('writes nothing while the screen is merely rendered', async () => {
    await screen('AdminCommunity');
    expect(writes).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Money.
// ─────────────────────────────────────────────────────────────────────────────
describe('no ticket price, donation amount, fee or checkout call changed', () => {
  it('changes nothing in AdminEvents outside a className', () => {
    const now = stripPresentation(read('AdminEvents.tsx'));
    expect(now.split('\n').length, DIFF_HINT('AdminEvents')).toBe(PRE_PR.AdminEvents.strippedLines);
    expect(sha(now), DIFF_HINT('AdminEvents')).toBe(PRE_PR.AdminEvents.strippedSha);
  });

  /**
   * 🔴 THE-251 — AdminFundraising HAS legitimately moved, and this is the record.
   *
   * This guard was written for a PRESENTATION-ONLY PR (Batch F): strip the
   * classNames, hash what is left, and any behaviour change on these five
   * screens goes red. THE-245 hit it with a three-string edit and reversed that
   * edit exactly rather than re-recording, on the reasoning that re-recording
   * "would bless every other byte that moved in the same breath".
   *
   * THE-251 is not a three-string edit and not a presentation PR. It adds, to
   * this screen and deliberately: a disclosure beside the goal, a "Record an
   * offline gift" control, its handler, and the removal of `raised` from the
   * editor's update payload. That is ~215 stripped lines. Reversing it by exact
   * string would put a 215-line blob of duplicated production source in this
   * file, unreviewable and red on the next comment rewording — a worse guard
   * than none.
   *
   * Re-recording `ministry-pre-pr.json` cannot help either: it is recorded from
   * `git show 974ae1d`, so it would reproduce the same pre-PR hash.
   *
   * So the pin is KEPT and RE-AIMED, and nothing about it is loosened:
   *
   *   • the money-bearing guard below — `firestorePaths` — still compares
   *     against the PRE-PR revision, byte for byte. THE-251 adds no client
   *     write at all: the adjustment goes through /api/campaigns/adjust-raised
   *     under the Admin SDK, so all nine paths are unchanged. That is the
   *     assertion that actually protects the money, and it is untouched.
   *   • the whole-file hash still runs, now against THE-251's own shape, so an
   *     ACCIDENTAL edit to this screen still goes red tomorrow.
   *   • the other four screens are untouched and still pinned to 974ae1d.
   *
   * Update `THE_251_FUNDRAISING` only for a deliberate, reviewed change to
   * AdminFundraising, and say which ticket in the same breath.
   *
   * ─── THE-254 — re-recorded, and here is the whole of what moved ────────────
   *
   * TWO LINES, both in place, and the line count below did not change — which
   * is itself part of the record: a re-recording that also changed the shape of
   * the file would be hiding something in the same breath.
   *
   *   1. the import gained `GIVING_PROVIDER_NAMES_OR`
   *   2. the campaign disclosure's "Harvest never sees a PayPal, Cash App,
   *      Venmo or Zelle gift" became "…a {GIVING_PROVIDER_NAMES_OR} gift"
   *
   * The provider names on this screen were one of five hand-written copies of
   * the provider table; adding Revolut and Wise would have left this sentence
   * promising a narrower product than the one shipping. Nothing else on the
   * screen was touched: no control, no handler, no payload, no gate. The
   * `firestorePaths` guard below still compares against the PRE-PR revision and
   * still passes, which is the assertion that actually protects the money.
   */
  const THE_251_FUNDRAISING = {
    strippedSha: '3fa68aac24d3431d4eb826d4adbcbf8e39ae31967c8dce92a330e780cf92786d',
    strippedLines: 850,
  };

  it('changes nothing in AdminFundraising outside a className, THE-251 and THE-254', () => {
    const now = stripPresentation(read('AdminFundraising.tsx'));
    expect(now.split('\n').length, DIFF_HINT('AdminFundraising')).toBe(THE_251_FUNDRAISING.strippedLines);
    expect(sha(now), DIFF_HINT('AdminFundraising')).toBe(THE_251_FUNDRAISING.strippedSha);
  });

  it('adds no Firestore path to AdminFundraising — the adjustment is not a client write', () => {
    // 🔴 Still compared against the PRE-PR revision. A manual adjustment writes
    // `campaigns/{id}.raised` and an `adjustments` row, and BOTH happen on the
    // server through the Admin SDK — `campaigns/{id}/adjustments` has no rule of
    // its own and firestore.rules is not this ticket's to touch. If either ever
    // became a client write, it would appear here.
    expect(firestorePathsOf(read('AdminFundraising.tsx'))).toEqual(PRE_PR.AdminFundraising.firestorePaths);
  });

  it('keeps every money-bearing field on the event editor, by its label', async () => {
    const { form } = await surfaces('AdminEvents');
    const placeholders = Array.from(form.querySelectorAll('input')).map((i) => i.getAttribute('placeholder'));
    expect(placeholders).toContain('0 = free');       // Ticket Price ($)
    expect(placeholders).toContain('e.g. 100');       // Capacity
  });

  it('keeps the pledge amount field on the fundraising screen, by its label', async () => {
    const c = await screen('AdminFundraising');
    await click(buttonContaining(c, 'Building Fund 2026'));
    await click(buttonContaining(c, 'Add Pledge'));
    const placeholders = Array.from(c.querySelectorAll('input')).map((i) => i.getAttribute('placeholder'));
    expect(placeholders).toContain('Pledge amount ($) *');
  });

  it('sizes the money fields without touching what they hold', () => {
    // A width cap is presentation. `short` is the module's own 160px, the width
    // it already gives a zipcode or a house number.
    expect(FIELD_WIDTH.short).toBe('sm:max-w-[160px]');
    expect(read('AdminEvents.tsx')).toContain('${FIELD_WIDTH.short} ${CONTROL_DENSITY.control}');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. REP-4 — exports are never gated.
// ─────────────────────────────────────────────────────────────────────────────
describe('the check-in CSV export still works', () => {
  it('is byte-identical to the pre-PR implementation', () => {
    const now = exportCsvOf(read('AdminCheckin.tsx'));
    expect(now).toBe(PRE_PR.AdminCheckin.exportCsv);
    expect(now).toContain('text/csv');
    expect(now).toContain('URL.createObjectURL');
  });

  it('still renders the Export CSV control, ungated, on the session detail', async () => {
    const c = await screen('AdminCheckin');
    await click(buttonContaining(c, 'Sunday Service — September 6'));
    const btn = buttonContaining(c, 'Export CSV');
    expect(btn).toBeTruthy();
    // No rule this PR adds reaches it: its classes carry no breakpoint at all.
    const tokens = (btn.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    expect(tokens.filter(isResponsive)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Colour.
// ─────────────────────────────────────────────────────────────────────────────
describe('no colour is hardcoded, and all four palettes resolve', () => {
  for (const name of SCREENS) {
    it(`renders exactly the baseline colour tokens in ${name}`, async () => {
      for (const [view, c] of Object.entries(await surfaces(name))) {
        expect(colourTokens(c), `${name}/${view} colours moved`).toEqual(BASELINE[name]![view].colours);
      }
    });
  }

  it('adds no colour-bearing class — every token this PR adds is structural', async () => {
    const added = new Set<string>();
    for (const name of SCREENS) {
      for (const [view, c] of Object.entries(await surfaces(name))) {
        const base = new Set(BASELINE[name]![view].colours);
        for (const t of colourTokens(c)) if (!base.has(t)) added.add(`${name}/${view}:${t}`);
      }
    }
    expect([...added]).toEqual([]);
  });

  it('defines no colour in the shared rules module', () => {
    const mod = readFileSync(path.join(SRC, 'layout/form-layout.ts'), 'utf8');
    const exported = [FORM_CONTAINER, FORM_MEASURE, ACTION_BUTTON, ...FIELD_WIDTHS, ...Object.values(CONTROL_DENSITY)];
    for (const r of exported) for (const t of r.split(' ')) expect(isColourToken(t), `${t} carries colour`).toBe(false);
    expect(mod).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('leaves all four palettes to resolve exactly as they did', () => {
    const css = readFileSync(path.resolve(SRC, '../app/globals.css'), 'utf8');
    expect(css).toMatch(/^\s*:root\s*\{/m);
    expect(css).toMatch(/\[data-theme="dark"\]\s*\{/);
    expect(css).toMatch(/\[data-palette="classic"\]\[data-theme="light"\]\s*\{/);
    expect(css).toMatch(/\[data-palette="classic"\]\[data-theme="dark"\]\s*\{/);
  });
});
