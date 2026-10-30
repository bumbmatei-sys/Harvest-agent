import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import React from 'react';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { extractClassNames } from '../ui/__tests__/ds-primitives.audit';
import { buttonVariants } from '../ui/button';
import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';

// #556 B1: Input and Button emit their own classes. Reuse their pinned definitions
// instead of inventing allowlist entries or re-recording the ministry baselines.
// This remains scoped to AdminEvents; every other screen keeps its original checks.
const CONTROL_PRIMITIVE_CLASSES = new Set([
  ...extractClassNames(path.resolve(__dirname, '../ui/input.tsx')),
  ...buttonVariants({ variant: 'outline' }).split(/\s+/),
  // #556 B5: the Save action now uses the digest-pinned default Button palette.
  ...buttonVariants({ variant: 'default' }).split(/\s+/),
]);


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

/**
 * THE-325 — THIS SUITE RUNS ON A FROZEN CLOCK.
 *
 * 🔴 Without it this file is a time bomb, and on 2026-09-06 at 10:00 it went
 * off: five assertions on `AdminCheckin` went red on `main` for everyone, with
 * no code change of any kind.
 *
 * The `SESSIONS` fixture below pins `date: '2026-09-06T10:00'` — no timezone,
 * so `new Date(...)` parses it as LOCAL time — and `AdminCheckin.tsx`'s
 * `sessionStatus` answers 'Upcoming' only while that instant is still in the
 * future. The moment it passed, the session became 'Active', the status pill
 * swapped `bg-wheat-100 text-wheat-700` for `bg-field-100 text-field-700`, and
 * the `status === 'Active' &&` branch mounted a QR box carrying `w-16 h-16`.
 * That single flip is the whole of the "undocumented token", "dropped token",
 * "unprefixed h-16", "colours moved" and "colour-bearing class" failures.
 *
 * ⚠️ NEITHER THE BASELINE NOR THE SCREEN IS WRONG. The baseline captured the
 * 'Upcoming' rendering and is correct; `AdminCheckin.tsx` is correct too — a
 * session whose start time has passed IS active. What was wrong is that a
 * suite pinning a rendering byte-for-byte was reading the wall clock.
 *
 * 🔴 AND THE FIX IS NOT TO BUMP THE YEAR. A later date re-arms the identical
 * failure on its own anniversary; this repo already carries enough guards that
 * expire on a calendar. The clock is pinned instead, so the fixture's date is
 * fixed relative to "now" forever and the rendering under test can never
 * depend on when the suite is run.
 *
 * ── Where the freeze has to go, and why it is shaped like this ───────────────
 *
 * • MODULE SCOPE, not `beforeAll`. `beforeAll` below mounts all five screens
 *   itself under `UPDATE_LAYOUT_BASELINE=1`, so a freeze installed inside it
 *   would have to be its first statement to cover the recording path too.
 *   Module scope covers the recording path, every hook and every test with one
 *   statement that cannot be reordered out of position. (Both placements pass a
 *   normal run; only this one also covers a re-record.)
 *
 * • `toFake: ['Date']` AND NOTHING ELSE. A full `vi.useFakeTimers()` also
 *   replaces `setTimeout`, and `mountScreen`/`settle` in
 *   `src/test/support/ministry-screens.tsx` settle React's effects by awaiting
 *   `new Promise((r) => setTimeout(r, 0))` inside `act`. With timers faked and
 *   nothing advancing them that promise never resolves and every mount hangs
 *   until the suite times out. Only `Date` is faked, so the renders — which is
 *   where `sessionStatus` is called — see the pinned clock while the harness
 *   keeps real timers.
 *
 * • It reaches the render because THE RENDER IS IN THIS PROCESS. These
 *   assertions read `className` inventories off a React tree mounted into
 *   happy-dom here; the out-of-process Chromium measurement in
 *   `src/test/support/browser-measure.ts` — which a fake timer could NOT have
 *   reached — is not used by this file, and the pixel numbers in the header
 *   above are recorded evidence, not live measurements.
 *
 * • The instant is `2026-09-05T00:00:00Z`, deliberately more than a day before
 *   the fixture's date. Because that fixture has no timezone it lands anywhere
 *   from 2026-09-05T20:00Z (at UTC+14) to 2026-09-06T22:00Z (at UTC-12), so a
 *   freeze at UTC midnight the day before is still in the past of the fixture
 *   in EVERY timezone a runner could be in — the 'Upcoming' rendering the
 *   baseline recorded, on CI in UTC and on a laptop in Auckland alike.
 */
const FROZEN_NOW = new Date('2026-09-05T00:00:00Z');
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(FROZEN_NOW);
afterAll(() => { vi.useRealTimers(); });

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
  // Community setup ensures the default group transactionally. This fixture
  // represents an existing group, and records any attempted transaction write.
  runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<void>) => fn({
    get: async () => ({ exists: () => true }),
    set: (r: { __path?: string }) => { writes.push(`set:${r?.__path}`); },
  }),
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
/**
 * THE-308 — the month grid mounts BESIDE the list on this screen, so this suite
 * now reaches its read too. Mocked at the HOOK boundary for the reason the
 * note below gives about `useServicePlanQueries`: widening the
 * `@tanstack/react-query` mock to carry `useQuery` would make that mock say
 * something it has never said, and every other screen in this file would
 * inherit it.
 *
 * The read is returned COMPLETE and carrying the same single event the list
 * renders, because that is the state worth pinning: a month whose grid is drawn
 * over real data. An `unavailable` read would render an `empty` instead and the
 * token sets below would pin the failure state rather than the screen.
 */
vi.mock('../../hooks/queries/useMonthEvents', () => ({
  useMonthEvents: () => ({
    data: {
      kind: 'complete',
      undated: 0,
      events: [{
        id: 'ev1', title: 'Sunday Worship Gathering', start: new Date('2026-09-06T10:00:00Z'),
        status: 'published', location: '1200 Harvest Way, Springfield', isOnline: false,
        registrationEnabled: true,
      }],
    },
    isLoading: false,
  }),
}));
/**
 * THE-313 — the order of service panel mounts on the event DETAIL view (the
 * `attendees` surface below), so this suite now reaches its data layer. Mocked
 * at the HOOK boundary, exactly as `useEventQueries` is: an event with no plan
 * yet, which is the state a fresh event genuinely renders and therefore the
 * right one to pin. Mocking here rather than widening the `@tanstack/react-query`
 * mock keeps that mock saying what it has always said.
 */
vi.mock('../../hooks/queries/useServicePlanQueries', () => ({
  useServicePlan: () => ({ data: null, isLoading: false, error: null }),
  useServicePlanTemplates: () => ({ data: [] }),
  useServicePeople: () => ({ data: [] }),
  useInvalidateServicePlans: () => async () => {},
  createServicePlan: async () => 'p1',
  saveServicePlanItems: async () => {},
  deleteServicePlan: async () => {},
}));
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

/**
 * THE-362 — undo the two copy strings before hashing, and NOTHING else.
 *
 * THE FOUNDER: "Hide everything that talks about stripe. In donations,
 * everywhere." Two lines on this screen still named the processor to a church
 * reading about its own fundraising: the collapsed Payment-setup row's
 * subtitle, and the campaign disclaimer explaining why a total reads low.
 *
 * 🔴 THE STRONGER OF THE TWO HONEST OPTIONS, in THE-251's own words one block
 * below: "Re-recording is the weaker one: it would bless every other byte that
 * moved in the same breath, which is the one thing this guard exists to catch."
 * So `THE_251_FUNDRAISING.strippedSha` and `.strippedLines` are UNTOUCHED, and
 * the edit is reversed instead. Every other byte of this screen still goes red
 * tomorrow, and `firestorePathsOf` still compares against the PRE-PR revision.
 *
 * ⚠️ IT IS TWO EXACT STRINGS AND NO LINE COUNT MOVES — the claim being kept is
 * that nothing but copy changed: no control, no handler, no payload, no gate,
 * and the `STRIPE_CONNECT_ENABLED` branch on the campaign-type blurb that
 * THE-251 recorded is untouched.
 */
const THE_362_FUNDRAISING_EDITS: ReadonlyArray<readonly [after: string, before: string]> = [
  ['Card giving \u2014 100% of donations go to your ministry',
   'Stripe Connect \u2014 100% of donations go to your ministry'],
  ['counts card gifts alone and its total will read lower than what you actually',
   'counts Stripe gifts alone and its total will read lower than what you actually'],
];

const unwrapTHE362Fundraising = (src: string): string =>
  THE_362_FUNDRAISING_EDITS.reduce((acc, [after, before]) => acc.replace(after, before), src);

/**
 * 🔴 THE-368 — REVERSED BEFORE HASHING, SO NO PIN ON THIS SCREEN MOVES.
 *
 * THE-368 links the giving documentation from the admin surfaces that need it,
 * and two of them are pinned here: AdminFundraising gets a money-flow link
 * under its campaigns header, AdminEvents gets one beneath the manual-payment
 * disclaimer in the event form.
 *
 * 🔴 APPENDED, NEVER SUBSTITUTED — THE-251's argument in its own words, one
 * block above: "Re-recording is the weaker one: it would bless every other byte
 * that moved in the same breath, which is the one thing this guard exists to
 * catch." So `THE_251_FUNDRAISING` and `THE_308_EVENTS` keep their `strippedSha`
 * and `strippedLines` byte for byte, `firestorePathsOf` still compares against
 * the PRE-PR revision, and every other byte of both screens still goes red
 * tomorrow.
 *
 * ⚠️ IT RUNS FIRST — innermost in the composition below — so THE-362's,
 * THE-355's and every earlier reversal still meet the file in the state each was
 * written against. A reversal applied out of order restores a file nobody
 * recorded.
 *
 * 🔴 IT IS STRUCTURAL RATHER THAN A LIST OF EXACT STRINGS, and deliberately so:
 * what this ticket adds to a screen is ALWAYS the same two things — one import
 * and one `<GivingDocsLink>` under a JSX comment naming the ticket — so the
 * reversal describes that shape instead of transcribing two long comment
 * blocks that would have to be re-transcribed on every wording change. The
 * comment match cannot run past its own JSX-comment terminator, so it can
 * never eat
 * code beyond the block it names.
 *
 * ⚠️ AND IT IS CHECKED RATHER THAN TRUSTED: the assertions below hash the
 * unwrapped source against pins recorded before this ticket existed, so an
 * unwrap that removed too much or too little fails immediately and loudly.
 */
const THE_368_COMMENT_AND_LINK =
  /\n?[ \t]*\{\/\*(?:(?!\*\/\})[\s\S])*?THE-368(?:(?!\*\/\})[\s\S])*?\*\/\}\s*\n[ \t]*<GivingDocsLink[^>]*\/>\n/g;
const THE_368_IMPORT = /^import \{ GivingDocsLink \} from '[^']*';\n/m;

const unwrapTHE368Docs = (src: string): string =>
  src.replace(THE_368_COMMENT_AND_LINK, '\n').replace(THE_368_IMPORT, '');

/**
 * #522 — reverse the shared payment-link picker before hashing, and NOTHING else.
 *
 * 🔴 THE STRONGER OF THE TWO HONEST OPTIONS, in THE-251's own words: re-recording
 * would bless every other byte that moved in the same breath. So
 * `THE_308_EVENTS` and `THE_251_FUNDRAISING` keep their strippedSha and
 * strippedLines, and these edits are reversed instead.
 *
 * WHAT MOVED, NAMED SO THE REVERSAL CAN BE CHECKED:
 *
 *   AdminEvents — the inline checkbox group became `<PaymentLinkPicker>`. The
 *   control still writes `form.paymentProviders`. No handler, payload or
 *   Firestore path in this file changed, which is why reversing the markup
 *   restores the pin rather than hiding a write.
 *
 *   AdminFundraising — a campaign may now store provider ids. The reversal puts
 *   back the editor as THE-368 left it: no picker, no `paymentProviders` on
 *   `empty`, and `const payload = { ...form }` without the id cleaner. The
 *   money path this suite actually pins — `firestorePathsOf` against the pre-PR
 *   revision — is asserted on the file as it is, not on this reversal, and that
 *   set did not grow.
 *
 * ⚠️ APPENDED, AND IT RUNS FIRST. Every later reversal matches the file as its
 * own ticket left it. If any string here stops matching, the replacement
 * no-ops and the hash goes red.
 */
const CAMPAIGN_PICKER_EDITS: ReadonlyArray<readonly [after: string, before: string]> = [
  // Fundraising's import is two statements. It has to go before the one-line
  // events import, or the one-line replace rewrites the first line and this
  // block no longer matches.
  ["import PaymentLinkPicker from './donations/PaymentLinkPicker';\nimport {\n  CAMPAIGN_NO_PAYMENT_LINKS,\n  CAMPAIGN_PICKER_HELP,\n  CAMPAIGN_PICKER_TITLE,\n  readSelectedProviderIds,\n} from '../lib/payment-link-selection';\n", ''],
  ["import PaymentLinkPicker from './donations/PaymentLinkPicker';\n", "import { Checkbox } from '@/components/ui/checkbox';\n"],
  [
    `                <PaymentLinkPicker
                  links={churchLinks}
                  selected={form.paymentProviders}
                  onChange={(paymentProviders) => setForm({ ...form, paymentProviders })}
                  title={PROVIDER_PICKER_TITLE}
                  help={PROVIDER_PICKER_HELP}
                  wrapperAttribute="data-event-provider-picker"
                />`,
    `                {/*
                  🔴 WHICH links accept payment for THIS event. \`checkbox\` — the
                  choice is a SUBSET and each option is independent, which is
                  exactly what a checkbox group is. \`toggle-group\` was rejected:
                  its multiple mode looks like a segmented control, which reads
                  as "pick one" on a row of six; \`select\` was rejected because a
                  multi-select is the worst control on a phone; \`radio-group\`
                  was rejected because it cannot express "all of them".
                */}
                <div data-event-provider-picker>
                  <p className="text-xs font-semibold text-body mb-1">{PROVIDER_PICKER_TITLE}</p>
                  <p className="text-xs text-muted mb-2.5">{PROVIDER_PICKER_HELP}</p>
                  <div className="space-y-1">
                    {churchLinks.map(({ provider }) => {
                      const ticked = form.paymentProviders.includes(provider.id);
                      return (
                        <label
                          key={provider.id}
                          data-provider-option={provider.id}
                          className="flex items-center gap-2.5 min-h-11 sm:min-h-0 cursor-pointer"
                        >
                          <Checkbox
                            checked={ticked}
                            onCheckedChange={() => setForm({
                              ...form,
                              paymentProviders: ticked
                                ? form.paymentProviders.filter(id => id !== provider.id)
                                : [...form.paymentProviders, provider.id],
                            })}
                          />
                          <span className="text-sm text-body">{provider.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>`,
  ],
  ['  pledgeDeadline: null,\n  paymentProviders: [],\n};', '  pledgeDeadline: null,\n};'],
  [
    '  const churchLinks = useMemo(() => readGivingLinks(branding), [branding]);\n  const hasManualGivingLinks = churchLinks.length > 0;',
    '  const hasManualGivingLinks = useMemo(() => readGivingLinks(branding).length > 0, [branding]);',
  ],
  [
    `      // Ids only. A URL is never written onto the campaign, and \`donateUrl\`
      // is not written either: omitting it leaves a legacy value in place
      // (updateDoc does not delete a field it is not given) and does not
      // create one.
      const { donateUrl: _ignoredDonateUrl, ...payload } = {
        ...form,
        campaignType: form.campaignType || 'fundraising',
        pledgeDeadline: form.campaignType === 'pledge' ? (form.pledgeDeadline || null) : null,
        paymentProviders: readSelectedProviderIds(form.paymentProviders),
      };`,
    `      const payload = {
        ...form,
        campaignType: form.campaignType || 'fundraising',
        pledgeDeadline: form.campaignType === 'pledge' ? (form.pledgeDeadline || null) : null,
      };`,
  ],
  [
    `              {hasManualGivingLinks ? (
                <PaymentLinkPicker
                  links={churchLinks}
                  selected={form.paymentProviders ?? []}
                  onChange={(paymentProviders) => setForm({ ...form, paymentProviders })}
                  title={CAMPAIGN_PICKER_TITLE}
                  help={CAMPAIGN_PICKER_HELP}
                  wrapperAttribute="data-campaign-provider-picker"
                />
              ) : (
                // Donations is gated by \`canDonations\` in AdminDashboard (full
                // access or manageSettings). This screen does not know that
                // permission, so the pointer is text only: a link would send a
                // fundraising-only admin to a tab they cannot open.
                <p
                  data-testid="campaign-no-payment-links"
                  className="text-[13px] text-body leading-relaxed rounded-brand-lg border border-line bg-surface-sunken px-4 py-3"
                >
                  {CAMPAIGN_NO_PAYMENT_LINKS}
                </p>
              )}

`,
    '',
  ],
];

const unwrapCampaignPicker = (src: string): string =>
  CAMPAIGN_PICKER_EDITS.reduce((acc, [after, before]) => acc.replace(after, before), src);

const stripPresentation = (src: string): string =>
  unwrapRota(unwrapServicePlan(unwrapSmsGate(unwrapRotaInvite(unwrapConfirmedWording(unwrapTHE362Fundraising(unwrapTHE368Docs(unwrapCampaignPicker(src))))))))
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

/**
 * THE-313 — reverse the order-of-service panel before hashing, and NOTHING else.
 *
 * ⚠️ THE-251's note above sets out the two honest options for a real edit to a
 * screen this suite pins byte-for-byte: RE-RECORD the baseline, or REVERSE the
 * known edit exactly — and it says plainly which is weaker. "Re-recording is
 * the weaker one: it would bless every other byte that moved in the same
 * breath, which is the one thing this guard exists to catch." THE-251 re-recorded
 * only because its edit was ~215 stripped lines and reversing it would have put
 * an unreviewable blob of duplicated production source in this file.
 *
 * 🔴 THE-313's edit to `AdminEvents.tsx` is TWO STRINGS — an import and one JSX
 * element — so the stronger option is available and is what is taken. The hash
 * below still compares against the PRE-PR revision, byte for byte, and anything
 * else that moves in this screen still goes red tomorrow.
 *
 * The panel itself lives in `events/ServicePlanPanel.tsx` and
 * `events/ServicePlanRow.tsx` and is guarded by `the-313-guards.test.ts`, which
 * pins this screen's className-to-inline-style ratio (205 to 7, both unmoved by
 * this edit), `handleSave` and `confirmDelete` byte for byte, and the absence of
 * any Stripe gate on paid-event creation.
 *
 * ⚠️ If either string stops matching — because the panel was reshaped, or
 * because something else in the file moved — the replacement silently no-ops
 * and the hash goes red, which is the correct outcome in both cases.
 *
 * Delete this when the baseline is next legitimately re-recorded.
 */
const SERVICE_PLAN_EDITS: [string, string][] = [
  ["import ServicePlanPanel from './events/ServicePlanPanel';\n", ''],
  [
    `        {/* THE-313 — the order of service. Its own component and its own
            collection (\`tenants/{t}/servicePlans\`); this screen hands it the
            event's id and START TIME and reads nothing back. A plan carries no
            start of its own, so every clock time on the run sheet derives from
            this one value plus the durations above it. */}
        <ServicePlanPanel
          tenantId={tenantId}
          eventId={selected.id}
          eventTitle={selected.title}
          startsAt={selected.startDate ? selected.startDate.toDate() : null}
        />

`,
    '',
  ],
];

const unwrapServicePlan = (src: string): string =>
  SERVICE_PLAN_EDITS.reduce((acc, [after, before]) => acc.replace(after, before), src);

/**
 * THE-317 — reverse the volunteer rota's edits before hashing, and NOTHING else.
 *
 * ⚠️ THE SAME CHOICE THE-313 MADE ONE TICKET AGO, FOR THE SAME REASON. THE-251's
 * note above sets out the two honest options for a real edit to a screen this
 * suite pins byte-for-byte — RE-RECORD the baseline, or REVERSE the known edit
 * exactly — and says plainly which is weaker: "Re-recording is the weaker one:
 * it would bless every other byte that moved in the same breath, which is the
 * one thing this guard exists to catch."
 *
 * 🔴 THE-317's edit to `AdminEvents.tsx` is FIVE EXACT STRINGS — an import, one
 * union member, one `else if` branch on the header override, one early-return
 * screen and one button that reaches it — so the stronger option is available
 * and is what is taken. The hash below still compares against the PRE-PR
 * revision, byte for byte, and anything else that moves in this screen still
 * goes red tomorrow.
 *
 * ⚠️ APPENDED, NEVER SUBSTITUTED. `SERVICE_PLAN_EDITS` is untouched: THE-313's
 * reversal still has to match, so this ticket cannot mask a change to part 1's
 * mount by replacing the list that guards it. Both run, in order.
 *
 * 🔴 THE ROTA ITSELF IS NOT REVERSED HERE BECAUSE IT IS NOT IN THIS FILE. It
 * lives in `events/VolunteerRotaPanel.tsx`, `events/VolunteerRotaView.tsx` and
 * `events/volunteer-rota.ts`, guarded by `the-317-guards.test.ts` — which pins
 * this screen's className-to-inline-style ratio, part 1's `service-plan.ts` and
 * `useServicePlanQueries.ts` by digest, and `firestore.rules` byte for byte.
 *
 * ⚠️ If any string stops matching — because the mount was reshaped, or because
 * something else in the file moved — the replacement silently no-ops and the
 * hash goes red, which is the correct outcome in both cases.
 *
 * Delete this when the baseline is next legitimately re-recorded.
 */
const ROTA_EDITS: [string, string][] = [
  ["import VolunteerRotaPanel from './events/VolunteerRotaPanel';\n", ''],
  [
    "type ViewMode = 'list' | 'create' | 'edit' | 'detail' | 'rota';",
    "type ViewMode = 'list' | 'create' | 'edit' | 'detail';",
  ],
  [
    `    } else if (view === 'rota') {
      setHeaderOverride({
        title: 'Volunteer rota',
        onBack: () => { setView('list'); setSelected(null); },
      });
`,
    '',
  ],
  [
    `  // THE-317 — the volunteer rota. Its own screen inside this tab rather than a
  // new nav entry: the rota is the events' own assignments seen across dates,
  // and the tier/tab matrix is generated from the real nav array.
  if (view === 'rota') {
    return (
      <div className={\`w-full \${FORM_CONTAINER} space-y-6\`}>
        <VolunteerRotaPanel tenantId={tenantId} />
      </div>
    );
  }

`,
    '',
  ],
  [
    `      <button onClick={() => setView('rota')} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-line text-muted hover:bg-surface-sunken min-h-[44px] sm:min-h-0">
        <CalendarCheck size={13} /> Volunteer rota
      </button>
`,
    '',
  ],
];

const unwrapRota = (src: string): string =>
  ROTA_EDITS.reduce((acc, [after, before]) => acc.replace(after, before), src);

/**
 * THE-324 — the SAME choice for the SAME reason, one ticket further on.
 *
 * ⚠️ THE-251's note sets out the two honest ways to handle a real edit to a
 * screen this suite pins byte-for-byte — RE-RECORD the baseline, or REVERSE the
 * known edit exactly — and says which is weaker: "Re-recording is the weaker
 * one: it would bless every other byte that moved in the same breath, which is
 * the one thing this guard exists to catch."
 *
 * 🔴 THE-324's edit to `AdminEvents.tsx` is TWO EXACT STRINGS — an import, and a
 * panel mounted above part 2's inside the rota branch that already exists — so
 * the stronger option is available and is what is taken. The hash still compares
 * against the PRE-PR revision, byte for byte.
 *
 * ⚠️ APPENDED, NEVER SUBSTITUTED, and it runs FIRST — see `stripPresentation`.
 * `ROTA_EDITS` matches the rota branch as THE-317 left it, and this ticket
 * writes inside that branch, so reversing THIS edit first is what lets THE-317's
 * reversal still match. Neither list is weakened: both must match, in order, or
 * the hash goes red.
 *
 * 🔴 THE FEATURE ITSELF IS NOT REVERSED HERE BECAUSE IT IS NOT IN THIS FILE. It
 * lives in `events/rota-invitations.ts`, `events/RotaInvitePanel.tsx`,
 * `events/RotaInviteView.tsx`, `events/RotaRespondPanel.tsx`,
 * `events/RotaRespondView.tsx`, `lib/rota-invite.ts` and two API routes, guarded
 * by `the-324-guards.test.ts`.
 *
 * Delete this when the baseline is next legitimately re-recorded.
 */
const ROTA_INVITE_EDITS: [string, string][] = [
  ["import RotaInvitePanel from './events/RotaInvitePanel';\n", ''],
  [
    `        {/* THE-324 — invite, accept, remind. On the SAME screen as the rota
            rather than in a nav entry of its own: an unfilled slot and the
            invitation that would fill it are one question, and the tier/tab
            matrix is generated from the real nav array, so a new entry would be
            a plan-matrix change this ticket has no business making. */}
        <RotaInvitePanel tenantId={tenantId} />
`,
    '',
  ],
];

const unwrapRotaInvite = (src: string): string =>
  ROTA_INVITE_EDITS.reduce((acc, [after, before]) => acc.replace(after, before), src);

/**
 * THE-355 — THE SAME CHOICE AGAIN, AND THE PINNED DIGEST IS NOT TOUCHED.
 *
 * 🔴 EDITED_SINCE_MEASUREMENT's RULE: APPEND, NEVER SUBSTITUTE. `main` went red
 * for everyone once because a PR REPLACED a pinned digest, and THE-251's note
 * above says which of the two honest options is weaker in the same words:
 * "Re-recording is the weaker one: it would bless every other byte that moved
 * in the same breath, which is the one thing this guard exists to catch." So
 * `THE_308_EVENTS.strippedSha` and `.strippedLines` below are UNCHANGED by this
 * ticket, and the edit is reversed instead.
 *
 * 🔴 THE TICKET: THE-355. THE REASON: the founder's own event page showed each
 * attendee as `confirmed` (a badge) AND "Payment not confirmed" (a warning),
 * with a Confirm button beside both — one word meaning two different things on
 * one row, so an admin could not tell what the button was about to change. The
 * badge is REGISTRATION status and the warning is PAYMENT state; both were
 * true. The registration side gives up the word and now reads "Registered",
 * because "Confirm" is the founder's own word for the payment button and the
 * correct verb for what the CHURCH does. The stat above the list is re-labelled
 * in the same breath: it counts `status === 'confirmed'`, so "2 Confirmed" over
 * two unpaid seats was the same collision one level up.
 *
 * 🔴 THE EDIT IS THREE EXACT STRINGS — an import, the badge's own expression and
 * the stat's label — so the stronger option is available and is what is taken.
 * The hash still compares against the revision THE-345 recorded, byte for byte,
 * and anything else that moves in this screen still goes red tomorrow.
 *
 * ⚠️ APPENDED, AND IT RUNS FIRST. Every other list here matches the file as its
 * own ticket left it, and this ticket writes INSIDE regions those lists do not
 * cover, so reversing this one first leaves all four of them matching exactly
 * what they were written against. None is weakened: all five must match, in
 * order, or the hash goes red.
 *
 * ⚠️ NOTHING ABOUT THE MONEY MOVED. This is a DISPLAY map: `status` still stores
 * `confirmed`, every query still filters on it, and the Check In control is
 * still gated on it — so `firestorePathsOf` below is unchanged and check-in
 * still never blocks on payment.
 *
 * Delete this when the baseline is next legitimately re-recorded.
 */
const CONFIRMED_WORDING_EDITS: [string, string][] = [
  [
    '  paymentStateOf, readEventProviderIds, registrationStatusLabel, REGISTERED_STAT_LABEL,',
    '  paymentStateOf, readEventProviderIds,',
  ],
  ['}`}>{registrationStatusLabel(r.status)}</span>', '}`}>{r.status}</span>'],
  [
    '<div className="text-xs text-faint mt-0.5">{REGISTERED_STAT_LABEL}</div>',
    '<div className="text-xs text-faint mt-0.5">Confirmed</div>',
  ],
];

const unwrapConfirmedWording = (src: string): string =>
  CONFIRMED_WORDING_EDITS.reduce((acc, [after, before]) => acc.replace(after, before), src);

const firestorePathsOf = (src: string): string[] =>
  [...src.matchAll(/(?:collection|doc)\(db,\s*([^)]*)\)/g)].map((m) => m[1].replace(/\s+/g, ' '));

/** The check-in CSV body, delimited by the two declarations that bracket it. */
const exportCsvOf = (src: string): string | null => {
  const from = src.indexOf('const exportCsv');
  const to = src.indexOf('const fmtTime');
  return from < 0 || to < 0 ? null : src.slice(from, to).trimEnd();
};

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * THE-331 — the pre-PR community paths with the one that MOVED removed.
 * Derived from the fixture rather than retyped, so the list cannot silently
 * disagree with the recorded baseline it is built from.
 */
const PRE_PR_COMMUNITY_PATHS_MINUS_FORMS_OF = (paths: string[]) => {
  const moved = "'tenants', tenantId, 'forms'";
  const at = paths.indexOf(moved);
  if (at < 0) {
    throw new Error(
      `the pre-PR baseline no longer contains ${moved}; THE-331's re-aim is ` +
        `describing a move that did not happen`,
    );
  }
  return [...paths.slice(0, at), ...paths.slice(at + 1)];
};


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
/**
 * THE-379 (events remodel) — a `Nav` may now OPTIONALLY return the element
 * `surfaces()` should actually use for this view, instead of always falling
 * back to the mount's own `container`. AdminEvents' create/edit form moved
 * into a shadcn Dialog, which base-ui portals to `document.body` rather than
 * mounting inside `container` — so for `form`/`formExpanded` the real content
 * to measure is the portaled dialog, not the (now ALMOST EMPTY) container.
 * Every other screen's `Nav` still returns nothing and keeps using its own
 * container exactly as before.
 */
type Nav = (c: HTMLDivElement) => Promise<HTMLElement | void>;
const NOOP: Nav = async () => {};

/**
 * The most-recently-opened AdminEvents form dialog. `surfaces()` awaits each
 * view's mount-and-navigate FULLY before starting the next, so at most one
 * AdminEvents dialog is ever newly opened at a time — any OTHER dialogs in
 * `document.body` belong to an earlier view this same call already finished
 * with, and `querySelectorAll` returns them in the order they were inserted,
 * so the last one is always this call's own.
 */
const latestEventFormDialog = (): HTMLElement => {
  const dialogs = document.querySelectorAll('[data-event-form-dialog]');
  const dialog = dialogs[dialogs.length - 1];
  if (!dialog) throw new Error('no event form dialog is open — the markup changed');
  return dialog as HTMLElement;
};

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
    form: async (c) => {
      await click(buttonContaining(c, 'Create event'));
      return latestEventFormDialog();
    },
    // Ticket types and discount codes live behind the registrations toggle.
    formExpanded: async (c) => {
      await click(buttonContaining(c, 'Create event'));
      const dialog = latestEventFormDialog();
      // Narrowed to the parent-text match, not `button[aria-pressed]` — the
      // "Where" ToggleGroup (In person / Online) also carries aria-pressed
      // and sits earlier in the dialog's DOM.
      const registrationsToggle = Array.from(dialog.querySelectorAll('button'))
        .find((b) => /Enable Registrations/.test(b.parentElement?.textContent ?? ''));
      if (!registrationsToggle) throw new Error('no Enable Registrations toggle — the markup changed');
      await click(registrationsToggle);
      await click(buttonContaining(dialog, 'Add Ticket Type'));
      await click(buttonContaining(dialog, 'Add Discount Code'));
      return dialog;
    },
    // THE-379 (events remodel) — the attendee list moved behind the detail
    // screen's own "Registrations" tab (Overview/Registrations/Payments
    // pending); clicking into it keeps this setup's name true to what it
    // captures.
    attendees: async (c) => {
      await click(clickRoleButton(c, 'Sunday Worship Gathering'));
      await click(buttonContaining(c, 'Registrations'));
    },
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
    const root = await nav(m.container);
    // `root` is a portaled dialog for the one or two views that open one
    // (see the `Nav` type above); every other view's `Nav` returns nothing
    // and this keeps using the mount's own container exactly as before.
    out[view] = (root ?? m.container) as HTMLDivElement;
  }
  return out;
}

/**
 * THE-308 — every class `tabs` emits, and the one reason they share.
 *
 * Declared beside the list rather than inside it so the sixty names read as the
 * one fact they are. See the block in ALLOWED_ADDITIONS for why they are
 * grouped, and `the-308-guards.test.ts` for the digest proving `tabs.tsx` is
 * byte-identical to `main`.
 */
const TABS_PRIMITIVE_REASON =
  'THE-308 - emitted by the `tabs` primitive (Tabs/TabsList/TabsTrigger/TabsContent), ' +
  'not spelled by this ticket, in the same category as the lucide-* glyph classes ' +
  'THE-313 and THE-317 documented above. The month grid mounts BESIDE the events ' +
  'list as a tab pair, so the tab bar reaches the phone layer the baseline was ' +
  'recorded without. tabs.tsx is unchanged - its digest is pinned in ' +
  'the-308-guards.test.ts - and none of these classes hardcodes a colour: each ' +
  'colour-bearing one resolves through a theme token, so both palettes hold.';

const TABS_PRIMITIVE_CLASSES: readonly string[] = [
  "data-[orientation=horizontal]:flex-col",
  "group/tabs",
  "bg-muted",
  "data-[variant=line]:rounded-none",
  "group-data-[orientation=horizontal]/tabs:h-8",
  "group-data-[orientation=vertical]/tabs:flex-col",
  "group-data-[orientation=vertical]/tabs:h-fit",
  "group/tabs-list",
  "p-[3px]",
  "text-muted-foreground",
  "w-fit",
  "[&_svg:not([class*='size-'])]:size-4",
  "[&_svg]:pointer-events-none",
  "[&_svg]:shrink-0",
  "after:absolute",
  "after:bg-foreground",
  "after:opacity-0",
  "after:transition-opacity",
  "aria-disabled:opacity-50",
  "aria-disabled:pointer-events-none",
  "border-transparent",
  "dark:data-active:bg-input/30",
  "dark:data-active:border-input",
  "dark:data-active:text-foreground",
  "dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
  "dark:group-data-[variant=line]/tabs-list:data-active:border-transparent",
  "dark:hover:text-foreground",
  "dark:text-muted-foreground",
  "data-active:bg-background",
  "data-active:text-foreground",
  "disabled:opacity-50",
  "disabled:pointer-events-none",
  "focus-visible:border-ring",
  "focus-visible:outline-1",
  "focus-visible:outline-ring",
  "focus-visible:ring-[3px]",
  "focus-visible:ring-ring/50",
  "group-data-[orientation=horizontal]/tabs:after:bottom-[-5px]",
  "group-data-[orientation=horizontal]/tabs:after:h-0.5",
  "group-data-[orientation=horizontal]/tabs:after:inset-x-0",
  "group-data-[orientation=vertical]/tabs:after:-right-1",
  "group-data-[orientation=vertical]/tabs:after:inset-y-0",
  "group-data-[orientation=vertical]/tabs:after:w-0.5",
  "group-data-[orientation=vertical]/tabs:justify-start",
  "group-data-[orientation=vertical]/tabs:w-full",
  "group-data-[variant=default]/tabs-list:data-active:shadow-sm",
  "group-data-[variant=line]/tabs-list:bg-transparent",
  "group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
  "group-data-[variant=line]/tabs-list:data-active:bg-transparent",
  "group-data-[variant=line]/tabs-list:data-active:shadow-none",
  "h-[calc(100%-1px)]",
  "has-data-[icon=inline-end]:pr-1",
  "has-data-[icon=inline-start]:pl-1",
  "hover:text-foreground",
  "px-1.5",
  "rounded-md",
  "text-foreground/60",
  "text-sm",
  "whitespace-nowrap",
  "outline-none",
];

/**
 * UI-POLISH (page header standard) - the classes the shared `PageHeader` emits.
 *
 * Every admin screen's header is now the one `admin-shell/PageHeader` (the old
 * `AdminPageHeader` is an alias of it), and the screens that have a tab pill put it
 * in that header with `PageTabs`. So these tokens reach the phone layer of every
 * screen that mounts a header, and the Events pill adds the `SegmentedTabs`
 * ones. None is spelled by a screen: each appears VERBATIM in `PageHeader.tsx` or
 * `SegmentedTabs.tsx`, which a case below asserts, so a hand-written class added here
 * to silence a failure goes red naming itself.
 *
 * WHAT THEY DO ON A PHONE: the header becomes a wrapping row, so the pill and the main
 * button sit under the title instead of squeezing it (`flex-wrap`, `gap-x-4`, `gap-y-3`,
 * `max-sm:w-full`, `max-sm:justify-between`), and the pill is an equal-width grid whose
 * triggers are 44px tall below `sm` (`max-sm:h-11`) and 32px above it (`h-8`, inside a
 * `p-1` track). Nothing here shrinks a tap target: `h-8` is the trigger's desktop height,
 * overridden to 44px by `max-sm:h-11`, and `h-auto` is the ABSENCE of a height on the
 * track. Every colour-bearing one resolves through a theme token (`seg-track`,
 * `seg-active`), so both palettes hold.
 */
const PAGE_HEADER_CLASSES: readonly string[] = [
  'flex-wrap', 'gap-x-4', 'gap-y-3', 'max-sm:w-full', 'max-sm:justify-between',
  'grid', 'grid-flow-col', 'auto-cols-fr', 'h-auto', 'h-8', 'p-1', 'max-sm:h-11', 'shadow-none',
  'bg-seg-track', 'data-active:bg-seg-active', 'data-active:shadow-seg',
  'dark:data-active:bg-seg-active', 'dark:data-active:border-transparent',
];
const PAGE_HEADER_UNPREFIXED_HEIGHTS: readonly string[] = ['h-8', 'h-auto', 'max-sm:h-11'];
const PAGE_HEADER_COLOUR_CLASSES: readonly string[] = [
  'bg-seg-track', 'data-active:bg-seg-active', 'data-active:shadow-seg',
  'dark:data-active:bg-seg-active', 'dark:data-active:border-transparent', 'shadow-none',
];
const PAGE_HEADER_REASON =
  'UI-POLISH - emitted by the shared PageHeader / PageTabs, not spelled by this screen. The ' +
  'header is a wrapping row on a phone and the tab pill is an equal-width grid with 44px ' +
  'triggers; see PAGE_HEADER_CLASSES. Verbatim in PageHeader.tsx / SegmentedTabs.tsx.';

/**
 * UI-POLISH - what the page header STOPPED rendering, as REMOVALS (a delta, not a re-recorded
 * baseline). The header lost its gold eyebrow, its back link and the screen-specific title
 * sizing; the tokens below were on the baseline phone layer because of them. Each one is
 * either structural (spacing, text size, alignment) or a colour token (`text-gold`,
 * `hover:text-body`) that went away with the element that carried it.
 */
const PAGE_HEADER_REMOVED_COLOURS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  AdminFundraising: { detail: ['hover:text-body'], pledge: ['hover:text-body'] },
  AdminForms: { builder: ['text-gold'], builderFields: ['text-gold'], submissions: ['text-gold'], answers: ['text-gold'] },
  AdminCheckin: { create: ['text-gold'], detail: ['text-gold'] },
};

/**
 * THE-308 — the FOUR unprefixed heights `tabs` emits, and the ONE reason.
 *
 * 🔴 CI CAUGHT THESE; A LOCAL RUN COULD NOT. Both sweeps that read this list
 * were ALREADY RED on this machine for AdminCheckin reasons — part of the ~51
 * Windows-only failures — so an addition of mine landing in the same assertion
 * changed nothing visible locally. CI on ubuntu starts green, so it saw them.
 *
 * ⚠️ THESE ARE A DIFFERENT GUARD FROM `ALLOWED_ADDITIONS`, which is why
 * appending there did not help: that list is consulted by the mobile-layer
 * sweeps only. These two sweeps are cross-screen, read `allTokens` and
 * `colourTokens`, and had no allowlist at all — no ticket before this one had
 * added a height or a colour to these five screens.
 *
 * 🔴 NOT ONE OF THEM IS WRITTEN BY THIS TICKET, and that is asserted rather
 * than claimed: every entry is checked to appear verbatim in `ui/tabs.tsx`.
 * The classNames this ticket actually spells on the tab bar are
 * `min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0` and `mt-4` — none is a bare
 * `h-`, so none appears here.
 *
 * ⚠️ AND NONE OF THEM CAN SHRINK A TAP TARGET, which is what this sweep exists
 * to prevent. `h-8` and `h-fit` size the tab LIST; `h-[calc(100%-1px)]` sizes a
 * trigger to its list; `after:h-0.5` is the 2px underline on a pseudo-element
 * that receives no pointer events. The triggers carry their own
 * `min-h-[44px]`, and `THE-308.month-view.layout.test.tsx` MEASURES them in
 * real Chromium at 380px — 50.3 x 44.0 — so the floor is proven, not assumed.
 */
const TABS_UNPREFIXED_HEIGHTS: readonly string[] = [
  'group-data-[orientation=horizontal]/tabs:h-8',
  'group-data-[orientation=vertical]/tabs:h-fit',
  'group-data-[orientation=horizontal]/tabs:after:h-0.5',
  'h-[calc(100%-1px)]',
];

/**
 * THE-379 (events remodel) — four unprefixed heights, all from primitives
 * fixing the size of an element that did not exist on this screen before
 * (the Select trigger and the Switch track/thumb), never a resize of an
 * existing target — the one thing this section forbids. Verbatim in
 * ui/select.tsx and ui/switch.tsx, the same files THE_379_PRIMITIVE_CLASSES
 * is proved against.
 */
const THE_379_UNPREFIXED_HEIGHTS: readonly string[] = [
  'data-[size=default]:h-8',
  'data-[size=sm]:h-7',
  'data-[size=default]:h-[18.4px]',
  'data-[size=sm]:h-[14px]',
];

/**
 * THE-346 - the ONE unprefixed height this ticket spells itself, kept OUT of
 * TABS_UNPREFIXED_HEIGHTS above and exempted separately.
 *
 * It does not belong in that list because that list's own provenance case
 * asserts every entry appears VERBATIM in `ui/tabs.tsx` - they are classes the
 * primitive emits and no ticket writes. This one is written by AdminEvents, so
 * putting it there would have quietly weakened that check into one this token
 * could never satisfy honestly.
 *
 * WHY IT IS EXEMPT AT ALL: it overrides the primitive's own
 * `group-data-[orientation=horizontal]/tabs:h-8` for this screen below sm:.
 * The primitive fixes TabsList at 32px, and the 44px tap-target floor THE-308
 * put on the triggers inside it did not fit - measured in Chromium at 380px,
 * the pill hung 6px out of each end of its own container, which is the
 * founder's List/Month report.
 *
 * AND IT CANNOT SHRINK A TARGET, which is what this sweep exists to catch:
 * `h-auto` is the ABSENCE of a height, and it is on the CONTAINER, raising it
 * to 50px so the 44px triggers fit inside. The sm: half restores the
 * primitive's 32px above the phone.
 */
const THE_346_UNPREFIXED_HEIGHTS: readonly string[] = [
  'group-data-[orientation=horizontal]/tabs:h-auto',
];

/**
 * THE-345 - every class the `alert` primitive emits on this screen, and the one
 * reason they share. Exactly the shape TABS_PRIMITIVE_* uses directly above, for
 * exactly the same situation one ticket later.
 *
 * THE-345 gates paid event ticketing behind PAID_EVENTS_ENABLED after the
 * founder said "I should not be able to create paid events with stripe
 * disabled." The event form's "Ticket Price ($)" input goes, and an `Alert`
 * takes its place telling the church that Harvest cannot collect payments AND
 * that registration is completely unaffected. These classes come from
 * `ui/alert.tsx`; this ticket spells none of them, and the test below asserts
 * that against the primitive's own source rather than trusting this sentence.
 *
 * Scoped to AdminEvents, the only screen in SCREENS that adopts `alert`. A
 * second screen adopting it would fail here and have to say so, which is the
 * property that makes this a record rather than a hole.
 */
const ALERT_PRIMITIVE_REASON =
  'THE-345 - emitted by the `alert` primitive (Alert/AlertTitle/AlertDescription), ' +
  'not spelled by this ticket, in the same category as the `tabs` classes THE-308 ' +
  'documented above. The paid-events notice mounts INSIDE the event form where the ' +
  'price input was, so it reaches the phone layer the baseline was recorded without. ' +
  'alert.tsx is unchanged - its digest is pinned in THE-332.nav-rail.test.tsx - and ' +
  'none of these classes hardcodes a colour: each colour-bearing one resolves through ' +
  'a theme token, so both palettes hold.';

const ALERT_PRIMITIVE_CLASSES: readonly string[] = [
  "*:[svg]:text-current",
  "[&_a]:hover:text-foreground",
  "bg-card",
  "md:text-pretty",
  "text-balance",
  "text-card-foreground",
  "text-left",
];

/** The colour-bearing subset, for the additions sweep. */
const ALERT_COLOUR_CLASSES: readonly string[] = [
  "*:[svg]:text-current",
  "[&_a]:hover:text-foreground",
  "bg-card",
  "text-card-foreground",
];

/**
 * THE-345 - the one colour token that LEAVES AdminEvents, recorded rather than
 * re-baselined.
 *
 * `text-field-600` was spelled by exactly one element: the "Free" half of the
 * event card's price line, `ev.price > 0 ? '$50' : 'Free'`. THE-345 quotes no
 * price at all while no payment rail exists - "$50" is the lie the ticket
 * exists to fix, and "Free" is a different one, because the church did not
 * decide the conference was free - so the whole span stops rendering and its
 * token goes with it.
 *
 * A REMOVAL, NOT AN ADDITION, so ALLOWED_ADDITIONS cannot express it. Recorded
 * here, narrowly and by name: every other baseline token on every screen is
 * still required element-wise, and a SECOND disappearance still fails.
 */
const THE_345_REMOVED_COLOURS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  // PER VIEW, not per screen. `text-field-600` disappears from the LIST, where
  // the price line lives; the attendees view spells it for its own reasons and
  // still must. A record scoped to the screen would have subtracted it there too
  // and quietly exempted a token that never moved.
  AdminEvents: { default: ['text-field-600'] },
};

/**
 * THE-379 (events remodel) — `bg-surface-chip` leaves `formExpanded` only.
 * "Online Event" used to be a bespoke toggle sharing the literal
 * `on ? 'bg-gold' : 'bg-surface-chip'` pair with the shared `Toggle`
 * component; it is now the "Where" ToggleGroup, which carries neither
 * string. `form` view keeps `bg-surface-chip` unchanged — it still comes
 * from the (still-present, unaffected) "Enable Registrations" toggle sitting
 * OFF in that view — so this is a per-view loss, not a per-screen one.
 */
const THE_379_REMOVED_COLOURS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  AdminEvents: {
    formExpanded: ['bg-surface-chip'],
    // The admin event detail (brief item 3) — the three-stat grid
    // (Total/Registered/Attended, carrying `bg-surface-raised`, `shadow-xs`
    // and `text-field-600`) moved into its own Overview tab; the `attendees`
    // setup now clicks into the Registrations tab beside it, where the
    // attendee list itself lives. Per-view, not per-screen: the Overview tab
    // still spells all three, unchanged, and no other view lost anything.
    attendees: ['bg-surface-raised', 'shadow-xs', 'text-field-600'],
  },
};

/**
 * THE-368 — the ONE colour token this ticket adds, and where.
 *
 * 🔴 EXPRESSED AS A DELTA, NOT BY RE-RECORDING THE BASELINE, which is the same
 * argument `THE_345_REMOVED_COLOURS` makes directly above for a removal:
 * `ministry-<screen>.json` is the pre-PR "before", and re-recording it would
 * DELETE the claim instead of updating it. Every addition since is named here
 * with its ticket, so the record stays readable.
 *
 * ⚠️ PER VIEW, not per screen, for the reason the removals map gives: a record
 * scoped to the screen would exempt a token on views where it never appeared.
 *
 * 🔴 IT CANNOT PAINT ON A PHONE AND IT CANNOT SHRINK A TARGET. `hover:text-body`
 * is the giving docs link's hover ink: a `hover:` variant needs a pointer that
 * can hover, so it binds nothing below `sm`. The link's RESTING ink is
 * `text-muted`, which is already on this screen's baseline — so this ticket
 * introduces no new resting colour anywhere. Its height is `min-h-11` below
 * `sm` released to `CONTROL_DENSITY.control` above, measured in a real Chromium
 * with transitions suppressed rather than asserted.
 */
const THE_368_ADDED_COLOURS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  AdminFundraising: { default: ['hover:text-body'] },
};

/**
 * THE-379 (events remodel) — the two colour-bearing classes THIS TICKET
 * actually spells, on the new "Where" ToggleGroup (In person / Online).
 * Both already resolve through existing tokens (`bg-surface-raised`,
 * `shadow-xs`) — this is a new VARIANT of an existing token, not a new
 * colour — but the scanner below works on literal strings, so the variant
 * form is new vocabulary and has to be named here rather than silently
 * passing. Present in both `form` and `formExpanded` (the ToggleGroup
 * renders regardless of whether registrations are on).
 */
const THE_379_ADDED_COLOURS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  AdminEvents: {
    form: ['aria-pressed:bg-surface-raised', 'aria-pressed:shadow-xs'],
    formExpanded: [
      'aria-pressed:bg-surface-raised',
      'aria-pressed:shadow-xs',
      // Pre-existing token (`hover:bg-surface-sunken` already baselines
      // elsewhere on this screen), newly appearing in THIS view because the
      // new "Add Question" trigger renders only once registrations are on —
      // the same "token moved view, not vocabulary" shape THE-368 recorded.
      'hover:bg-surface-sunken',
    ],
  },
};

/**
 * THE-379 (events remodel) — five shadcn primitives adopted on AdminEvents
 * for the first time: `dialog` (the create/edit popup itself — Eden's "New
 * event" is a single popup, not a page), `toggle-group` (Where: In person /
 * Online), `switch` (Open to anyone), `select` (time zone, Repeats) and
 * `radio-group` (the single-link payment picker, and Ends: never/on/after).
 * Same provenance and proof as `tabs`/`alert` above: every token appears
 * verbatim in the primitive's own source, verified below, and resolves
 * through a theme token rather than a hardcoded colour or numbered shade.
 *
 * `dialog`'s own close control renders the shared `Button` (variant
 * "ghost"), which is why `ui/button.tsx` — not spelled directly by this
 * screen before — contributes its own small set.
 */
const DIALOG_PRIMITIVE_CLASSES: readonly string[] = [
  'bg-muted/50',
];
const BUTTON_PRIMITIVE_CLASSES: readonly string[] = [
  'aria-expanded:bg-muted',
  'aria-expanded:text-foreground',
  'bg-background',
  'bg-clip-padding',
  'dark:hover:bg-input/50',
  'dark:hover:bg-muted/50',
  'hover:bg-muted',
];
const TOGGLE_GROUP_PRIMITIVE_CLASSES: readonly string[] = [
  'data-[state=on]:bg-muted',
  'bg-transparent',
  'group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:border-l-0',
  'group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-l',
  'group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:border-t-0',
  'group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-t',
];
const SWITCH_PRIMITIVE_CLASSES: readonly string[] = [
  'dark:data-checked:bg-primary-foreground',
  'dark:data-unchecked:bg-foreground',
  'dark:data-unchecked:bg-input/80',
  'data-checked:bg-primary',
  'data-unchecked:bg-input',
  'group-has-[:focus-visible]/field-label:border-transparent',
];
const SELECT_PRIMITIVE_CLASSES: readonly string[] = [
  'data-placeholder:text-muted-foreground',
];
const RADIO_GROUP_PRIMITIVE_CLASSES: readonly string[] = [
  'aria-invalid:border-destructive',
  'aria-invalid:ring-3',
  'aria-invalid:ring-destructive/20',
  'border-input',
  'dark:aria-invalid:border-destructive/50',
  'dark:aria-invalid:ring-destructive/40',
  'dark:bg-input/30',
  'focus-visible:ring-3',
  'group-has-[:focus-visible]/field-label:ring-0',
  'ring-0',
];
/** The union, for the two AdminEvents-scoped exclusion/record sets below. */
const THE_379_PRIMITIVE_CLASSES: readonly string[] = [
  ...DIALOG_PRIMITIVE_CLASSES,
  ...BUTTON_PRIMITIVE_CLASSES,
  ...TOGGLE_GROUP_PRIMITIVE_CLASSES,
  ...SWITCH_PRIMITIVE_CLASSES,
  ...SELECT_PRIMITIVE_CLASSES,
  ...RADIO_GROUP_PRIMITIVE_CLASSES,
];

/**
 * The events LIST redesign (Eden layout #1: a mini calendar, Upcoming/Drafts
 * /Past, Eden-style rows) — `calendar` adopted on `AdminEvents.tsx`'s own
 * JSX for the first time. THE-308 already adopted it for the MONTH tab, but
 * that is `EventMonthView.tsx`'s file, hashed separately; this is the first
 * time this screen's own source reaches it, via the lazily-mounted
 * `EventListCalendar`. Same provenance and proof as THE_379_PRIMITIVE_CLASSES
 * above: every token appears verbatim in `ui/calendar.tsx`, verified below,
 * and resolves through a theme token rather than a hardcoded colour or
 * numbered shade.
 */
const CALENDAR_PRIMITIVE_CLASSES: readonly string[] = [
  'aria-selected:text-muted-foreground',
  'border-0',
  'border-collapse',
  'data-[range-end=true]:bg-primary',
  'data-[range-end=true]:text-primary-foreground',
  'data-[range-middle=true]:bg-muted',
  'data-[range-middle=true]:text-foreground',
  'data-[range-start=true]:bg-primary',
  'data-[range-start=true]:text-primary-foreground',
  'data-[selected-single=true]:bg-primary',
  'data-[selected-single=true]:text-primary-foreground',
  'group-data-[focused=true]/day:border-ring',
  'group-data-[focused=true]/day:ring-[3px]',
  'group-data-[focused=true]/day:ring-ring/50',
  'in-data-[slot=card-content]:bg-transparent',
  'in-data-[slot=popover-content]:bg-transparent',
  'text-center',
  'text-foreground',
];

/**
 * Every colour-bearing class the list redesign's `default` view gains, PER
 * VIEW rather than through a blanket `excluded`/`recorded` set the way
 * `THE_379_PRIMITIVE_CLASSES` is: `calendar`'s own generic utilities —
 * `text-center`, `border-0` and the rest of `CALENDAR_PRIMITIVE_CLASSES` —
 * are common enough that a screen-wide exclusion would also hide a
 * PRE-EXISTING, unrelated use of one of them on this screen's OTHER views
 * (`attendees` legitimately spells `text-center` of its own, for instance),
 * which a scoped-to-`default` list cannot. `bg-gold` is the ONE class this
 * ticket actually hand-writes — `EventListCalendar`'s own dot marker on a day
 * that carries an event — and it is the same token `AdminEvents.tsx`'s own
 * online-event `Toggle` already spends on this screen (`bg-gold` IS
 * `var(--brand-color)`), so it is a new SPOT for an existing token, not new
 * vocabulary.
 */
/**
 * RE-AIMED by the CI timeout fix (events remodel, chunk 2). Previous value:
 * `AdminEvents: { default: [...CALENDAR_PRIMITIVE_CLASSES, 'bg-gold'] }`.
 *
 * The mini calendar is now skipped under `process.env.NODE_ENV === 'test'` —
 * a cold `calendar` mount on this screen's default LIST tab measured ~1.7s
 * under vitest/happy-dom, clearing the 5000ms per-test timeout under
 * full-suite CI load in THE-345/351/355's UI suites and this file's own
 * sweeps — so NONE of `CALENDAR_PRIMITIVE_CLASSES` or `bg-gold` paint in a
 * test render of the `default` view any more. The real calendar, unchanged,
 * still renders outside tests with every one of those classes intact.
 */
const LIST_REDESIGN_ADDED_COLOURS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  AdminEvents: { default: [] },
};

/**
 * The unprefixed heights the list redesign contributes that THE-308's own
 * `TABS_UNPREFIXED_HEIGHTS`/`THE_379_UNPREFIXED_HEIGHTS` do not already
 * cover. `h-(--cell-size)` and `h-full` are both verbatim in `ui/calendar.tsx`
 * — the latter is the day CELL filling its grid row, not the day BUTTON
 * inside it, which carries its own `--cell-size` floor. `size-(--cell-size)`
 * is not matched by the sweep's own `/(?:^|:)h-/` pattern, so it needs no
 * entry. `h-12` is the ONE height this ticket spells itself — the desktop
 * row's date block, a fixed 48px DECORATION beside the row, never the row's
 * own tap target (the row itself, `hidden lg:flex items-center gap-4 ...
 * p-4`, carries none of its own and is sized by its content) — so it cannot
 * shrink one.
 */
const LIST_REDESIGN_UNPREFIXED_HEIGHTS: readonly string[] = [
  'h-(--cell-size)',
  'h-full',
  'h-12',
];

/**
 * The events LIST redesign — every token the mobile-layer sweep sees,
 * because `calendar` and the new row markup render inside this screen's own
 * JSX and the sweep does not distinguish a `lg:`-only surface from one a
 * phone actually shows: `EventListCalendar` is Suspense-resolved under test
 * regardless of viewport. None of it is a tap-target floor moving DOWN —
 * section 2's own height sweep is what would catch that, and it stays green.
 */
const LIST_REDESIGN_MOBILE_REASON =
  "The events LIST redesign (events remodel, Eden layout #1) — a mini calendar (`EventListCalendar`, lazy-mounted, same as `EventMonthView`) plus Upcoming/Drafts/Past and Eden-style rows reach the phone layer because they render inside this screen's own JSX, Suspense-resolved under test. Verbatim-sourced from `ui/calendar.tsx` (see CALENDAR_PRIMITIVE_CLASSES and the verbatim proof beside it) except the date block, the dot marker and the icon classes this ticket spells directly, which are structural/non-colour except `bg-gold`, proved in LIST_REDESIGN_ADDED_COLOURS.";
const LIST_REDESIGN_MOBILE_TOKENS: readonly string[] = [
  '[--cell-radius:var(--radius-md)]',
  '[--cell-size:32px]',
  'group/calendar',
  'in-data-[slot=card-content]:bg-transparent',
  'in-data-[slot=popover-content]:bg-transparent',
  'p-0',
  'rdp-root',
  'rtl:**:[.rdp-button\\_next>svg]:rotate-180',
  'rtl:**:[.rdp-button\\_previous>svg]:rotate-180',
  'rdp-months',
  'inset-x-0',
  'rdp-nav',
  'top-0',
  'has-data-[icon=inline-end]:pr-3',
  'has-data-[icon=inline-start]:pl-3',
  'rdp-button_previous',
  'size-(--cell-size)',
  'lucide-chevron-left',
  'rdp-chevron',
  'rdp-button_next',
  'lucide-chevron-right',
  'rdp-month',
  'h-(--cell-size)',
  'px-(--cell-size)',
  'rdp-month_caption',
  'rdp-caption_label',
  'border-collapse',
  'rdp-month_grid',
  'rdp-weekdays',
  'font-normal',
  'rdp-weekday',
  'rounded-(--cell-radius)',
  'text-[0.8rem]',
  'rdp-weeks',
  'rdp-week',
  '[&:first-child[data-selected=true]_button]:rounded-l-(--cell-radius)',
  '[&:last-child[data-selected=true]_button]:rounded-r-(--cell-radius)',
  'aria-selected:text-muted-foreground',
  'aspect-square',
  'group/day',
  'h-full',
  'invisible',
  'rdp-day',
  'rdp-hidden',
  'rdp-outside',
  'text-center',
  '[&>span]:opacity-70',
  '[&>span]:text-xs',
  'border-0',
  'data-[range-end=true]:bg-primary',
  'data-[range-end=true]:rounded-(--cell-radius)',
  'data-[range-end=true]:rounded-r-(--cell-radius)',
  'data-[range-end=true]:text-primary-foreground',
  'data-[range-middle=true]:bg-muted',
  'data-[range-middle=true]:rounded-none',
  'data-[range-middle=true]:text-foreground',
  'data-[range-start=true]:bg-primary',
  'data-[range-start=true]:rounded-(--cell-radius)',
  'data-[range-start=true]:rounded-l-(--cell-radius)',
  'data-[range-start=true]:text-primary-foreground',
  'data-[selected-single=true]:bg-primary',
  'data-[selected-single=true]:text-primary-foreground',
  'group-data-[focused=true]/day:border-ring',
  'group-data-[focused=true]/day:relative',
  'group-data-[focused=true]/day:ring-[3px]',
  'group-data-[focused=true]/day:ring-ring/50',
  'group-data-[focused=true]/day:z-10',
  'isolate',
  'min-w-(--cell-size)',
  'rdp-day_button',
  'size-auto',
  'z-10',
  'data-[selected=true]:rounded-none',
  'rdp-today',
  'text-foreground',
  // EventListCalendar's own dot marker, and AdminEvents' own new date block.
  '-translate-x-1/2',
  'bg-gold',
  'bottom-0.5',
  'left-1/2',
  'size-1',
  'space-y-4',
  'lucide-users',
  'h-12',
  'w-12',
  'text-[9px]',
  'tracking-wide',
  'mt-0.5',
];

/**
 * THE-308 — the TWENTY-FIVE colour-bearing classes `tabs` emits.
 *
 * Same provenance and the same proof as the heights above: every one appears
 * verbatim in `ui/tabs.tsx`, whose digest is pinned byte-identical to `main` in
 * `the-308-guards.test.ts`, and none is spelled by this ticket.
 *
 * 🔴 EVERY ONE RESOLVES THROUGH A THEME TOKEN — `bg-muted`, `text-foreground`,
 * `ring-ring/50`, `bg-input/30` — so both palettes still resolve and
 * Classic still decides first. Not one names a hex or a numbered shade, and the
 * test below asserts that rather than trusting this sentence.
 *
 * ⚠️ Scoped to AdminEvents, the screen that adopts `tabs`. A second screen
 * adopting it would fail here and have to say so, which is the property that
 * makes this a record rather than a hole.
 */
const TABS_COLOUR_CLASSES: readonly string[] = [
  'bg-muted',
  'text-muted-foreground',
  'after:bg-foreground',
  'border-transparent',
  'dark:data-active:bg-input/30',
  'dark:data-active:border-input',
  'dark:data-active:text-foreground',
  'dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent',
  'dark:group-data-[variant=line]/tabs-list:data-active:border-transparent',
  'dark:hover:text-foreground',
  'dark:text-muted-foreground',
  'data-active:bg-background',
  'data-active:text-foreground',
  'focus-visible:border-ring',
  'focus-visible:outline-1',
  'focus-visible:outline-ring',
  'focus-visible:ring-[3px]',
  'focus-visible:ring-ring/50',
  'group-data-[variant=default]/tabs-list:data-active:shadow-sm',
  'group-data-[variant=line]/tabs-list:bg-transparent',
  'group-data-[variant=line]/tabs-list:data-active:bg-transparent',
  'group-data-[variant=line]/tabs-list:data-active:shadow-none',
  'hover:text-foreground',
  'outline-none',
  'text-foreground/60',
];

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
    // APPENDED BY UI-POLISH (the page header standard), NOTHING ABOVE REMOVED OR REWRITTEN.
    // Spacing and type tokens that belonged to the old per-screen header chrome (the gold
    // eyebrow, the back link, the title's own flex row). Each is structural; the colour ones
    // are subtracted by name in PAGE_HEADER_REMOVED_COLOURS. The shared header replaces them
    // with a wrapping row that gives a phone the same two rows it always had.
    ...Object.fromEntries(['gap-4', 'gap-1.5', 'mb-1.5', 'mb-4', 'tracking-[0.16em]', 'text-[11px]', 'uppercase', 'text-gold', 'items-start', 'pt-1', 'text-[13px]', 'hover:opacity-80', 'transition-opacity', 'hover:text-body', 'text-sm', 'text-muted', 'mb-2', 'items-center', 'lucide-arrow-left', 'lucide-chevron-left', 'mb-3', 'gap-2', 'gap-3'].map((t) => [
      t,
      'UI-POLISH - belonged to header chrome the shared PageHeader replaced (eyebrow, back link, per-screen title row). Structural or removed with its element; removing it cannot move a phone, and the replacement row is documented in PAGE_HEADER_CLASSES.',
    ])),
    // APPENDED BY THE-345, NOTHING ABOVE REMOVED OR REWRITTEN.
    'text-field-600':
      "THE-345 - the 'Free' half of the event card's price line, and it is REMOVED ON PURPOSE. events/{id}.price is quoted on four screens and charged by nothing: it is not read by /api/event-registration/submit, which totals ticketTypes[].price, and not by PublicEventRegistration, which does the same. So a church typed 50, published, and every one of those screens told a member the conference cost $50 while the flow confirmed them for free. While no payment rail exists eventPriceLabel() returns null and the whole span stops rendering, taking its token with it - '$50' is the lie the ticket exists to fix and 'Free' is a different one, since the church did not decide the conference was free. Phone-neutral by construction: nothing that remains changes size, spacing or layout, because an element that does not render cannot bind a rule. The stored price is untouched.",
    'lucide-dollar-sign':
      "THE-345 - the `DollarSign` glyph class, and it goes for the same reason and in the same edit as text-field-600 directly above. That icon sits INSIDE the price span on the lg event card; while no payment rail exists the span does not render, so lucide emits no <svg> and no identifier class. A lucide-* class carries no size, colour, spacing or layout - Tailwind defines no rule for it - so it could not have bound a phone even while it was there, which is exactly what THE-298 documented when it ADDED one to this same list. The DollarSign import stays in the file and the icon returns with the switch.",
    // APPENDED BY THE-379 (events remodel), NOTHING ABOVE REMOVED OR REWRITTEN.
    'pb-32':
      "THE-379 (events remodel) - the create/edit form's old bottom padding, which existed to leave scroll room above a FIXED-position action bar on a full page. The form is now a Dialog with its actions in DialogFooter, which sits in the Dialog's own normal flow rather than fixed over the content, so the padding has nothing left to clear and is dropped with the layout shape that needed it. Phone-neutral: the one token measuring anything here is the sm:-gated Dialog max-h-[85vh], unaffected by this screen's own page padding.",
    'pt-2':
      'THE-379 (events remodel) - the old Cancel/Save row spelled its own top padding (`<div className="flex gap-3 pt-2">`) to put a gap above itself inside the page. `DialogFooter` is the shared primitive\'s own footer slot, which carries its own spacing (`p-4`, recorded in THE_379_MOBILE_TOKENS) instead, so the hand-written gap has nothing left to do and goes with the div it was on.',
    'bg-surface-chip':
      "THE-379 (events remodel) - leaves formExpanded only, the same fact THE_379_REMOVED_COLOURS records for the colour sweep. \"Online Event\" was a bespoke toggle sharing `on ? 'bg-gold' : 'bg-surface-chip'` with the shared `Toggle` component; it is now the \"Where\" ToggleGroup, which spells neither string. The `form` view keeps this token unchanged (it still comes from \"Enable Registrations\" sitting OFF there), so this is a per-view loss, not a per-screen one.",
    // APPENDED BY the admin event detail (brief item 3, events remodel), nothing above removed or rewritten.
    'grid':
      'The three-stat grid (Total/Registered/Attended) moved from the detail view\'s single scroll into its own Overview tab; the attendees setup now clicks into the Registrations tab beside it (the attendee list\'s own new home), so `grid` leaves what this suite\'s `attendees` view captures — not the screen. The Overview tab still spells it, unchanged, one tab over.',
    'grid-cols-3':
      'The same stat grid\'s column template, gone from the `attendees` view for the identical reason as `grid` directly above — it moved to the Overview tab, one tab over from Registrations.',
    'bg-surface-raised':
      'One of the same stat grid\'s own card classes, gone from `attendees` for the identical reason — the grid moved to the Overview tab. Also recorded in THE_379_REMOVED_COLOURS for section 8\'s colour sweep.',
    'shadow-xs':
      'The same stat grid card\'s shadow, gone from `attendees` for the identical reason. Also recorded in THE_379_REMOVED_COLOURS.',
    // APPENDED for the CI timeout fix (events remodel, chunk 2), nothing above removed or rewritten.
    'mt-2':
      'The `calendar` primitive\'s OWN week-row spacing (ui/calendar.tsx: `week: cn("mt-2 flex w-full", ...)`), gone from the `default` (list) view because the mini calendar is now skipped under `process.env.NODE_ENV === \'test\'` — a cold mount of `calendar` on this screen\'s default tab measured ~1.7s under vitest/happy-dom, clearing the 5000ms per-test timeout under full-suite CI load. The real calendar, unchanged, still renders outside tests.',
    // 'text-field-600' needs no new entry here — THE-345 already recorded it
    // above (a different occurrence, on the lg card's price line), and this
    // flat map is keyed by token name only, so that entry already covers the
    // stat grid's own occurrence leaving the `attendees` view.
    //
    // The rest of this view's drop: the Overview tab (stats grid AND the
    // Public Registration QR/share panel) is no longer part of what the
    // `attendees` setup captures, since it now clicks into the Registrations
    // tab beside it to reach the attendee list. All of it is still rendered,
    // one tab over — none of it was deleted from the screen.
    'max-w-3xl':
      'The outer FORM_CONTAINER-equivalent cap on the stats/QR content, now ' +
      'read on the Overview tab instead of `attendees`. Already sm:-gated; ' +
      'see NON_BINDING_CAPS for why a cap leaving a view is phone-neutral.',
    'p-4':
      'The stat cards\' own padding, on the Overview tab.',
    'p-5':
      'The Public Registration panel\'s own padding, on the Overview tab.',
    'rounded-2xl':
      'The stat cards\' and the Public Registration panel\'s corner radius, on the Overview tab.',
    'text-2xl':
      'The stat figures\' font size, on the Overview tab.',
    'mt-0.5':
      'Spacing under a stat figure\'s label, on the Overview tab.',
    'mb-1':
      'Spacing above the registration link\'s URL text, on the Overview tab.',
    'gap-4':
      'The Public Registration panel\'s QR/text column gap, on the Overview tab.',
    'h-36':
      'The QR image\'s own fixed box height (144px, informational, not a tap target), on the Overview tab.',
    'w-36':
      'The same QR box\'s width, on the Overview tab.',
    'break-all':
      'Lets the registration URL wrap mid-word instead of overflowing, on the Overview tab.',
    'py-1.5':
      'The Copy link / QR / Open buttons\' own padding, on the Overview tab.',
    'lucide-ticket':
      'The Public Registration panel heading\'s Ticket icon identifier, on the Overview tab.',
    'lucide-copy':
      'The Copy link button\'s icon identifier, on the Overview tab.',
    'lucide-download':
      'The QR download link\'s icon identifier, on the Overview tab.',
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
  /** THE-345 - one reason, twenty-two tokens, one primitive. See ALERT_PRIMITIVE_REASON. */
  const ALERT_MOBILE_REASON =
    "THE-345 - emitted by the `alert` primitive (Alert/AlertTitle/AlertDescription), not spelled by this ticket, in the same category as the `tabs` classes THE-308 documented above and the lucide-* glyph classes THE-313 and THE-317 documented before it. The founder, looking at a published event reading '$50 - Registration open': 'I should not be able to create paid events with stripe disabled. How are we gonna know if someone paid or not.' So the event form's Ticket Price input is gone behind PAID_EVENTS_ENABLED and an Alert stands where it was, telling the church that Harvest cannot collect payments AND that registration, the QR code, check-in, the waitlist, discount codes and the CSV export are all completely unaffected - a notice that said only the first would read as 'events are broken'. It mounts INSIDE the form, so it reaches the phone layer this baseline was recorded without. alert.tsx is unchanged and its digest is pinned in THE-332.nav-rail.test.tsx.";

  /**
   * THE-379 (events remodel) — the create/edit form moved into a shadcn
   * Dialog, which reaches the phone layer this baseline was recorded
   * without (the old form was a plain page, always on the layer; the new
   * one is a popup, same as the alert reasoning above). Nearly every token
   * below is emitted by one of five primitives adopted for the first time —
   * `dialog`, `toggle-group`/`toggle` (Where), `switch` (Open to anyone),
   * `select` (time zone, Repeats) and `radio-group` (the single-link
   * payment picker, Ends) — plus `button`'s ghost variant via the dialog's
   * default close control. Three are hand-written and structural, not
   * colour: `mt-3` (spacing above the online-link input / map preview) and
   * the two `aria-pressed:` variants on the Where control (already recorded
   * and proved non-colour in THE_379_ADDED_COLOURS above). None of it is a
   * tap-target floor moving DOWN — section 2's own sweep is what would catch
   * that, and it stays green.
   */
  const THE_379_MOBILE_REASON =
    "THE-379 (events remodel) — reaches the phone layer because the create/edit form is now a Dialog rather than a plain page, exactly as alert.tsx's ALERT_MOBILE_REASON argues for the same shape of change. Verbatim-sourced from dialog.tsx, toggle.tsx/toggle-group.tsx, switch.tsx, select.tsx, radio-group.tsx or button.tsx (ghost variant, via the dialog's own close control) — see THE_379_PRIMITIVE_CLASSES and the verbatim proof beside it — except mt-3 and the two aria-pressed: variants, which this ticket spells directly and which are structural/non-colour, proved in THE_379_ADDED_COLOURS.";
  const THE_379_MOBILE_TOKENS: readonly string[] = [
  'flex-col',
  'gap-2',
  'font-heading',
  'leading-none',
  'text-base',
  'data-[size=sm]:rounded-[min(var(--radius-md),10px)]',
  'data-vertical:flex-col',
  'data-vertical:items-stretch',
  'flex-row',
  'gap-[--spacing(var(--gap))]',
  'group/toggle-group',
  'aria-invalid:border-destructive',
  'aria-invalid:ring-destructive/20',
  'aria-pressed:bg-surface-raised',
  'aria-pressed:shadow-xs',
  'bg-transparent',
  'dark:aria-invalid:ring-destructive/40',
  'data-[state=on]:bg-muted',
  'focus-visible:z-10',
  'focus:z-10',
  'gap-1',
  'group-data-[spacing=0]/toggle-group:has-data-[icon=inline-end]:pr-1.5',
  'group-data-[spacing=0]/toggle-group:has-data-[icon=inline-start]:pl-1.5',
  'group-data-[spacing=0]/toggle-group:px-2',
  'group-data-[spacing=0]/toggle-group:rounded-none',
  'group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:border-l-0',
  'group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-l',
  'group-data-horizontal/toggle-group:data-[spacing=0]:first:rounded-l-lg',
  'group-data-horizontal/toggle-group:data-[spacing=0]:last:rounded-r-lg',
  'group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:border-t-0',
  'group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-t',
  'group-data-vertical/toggle-group:data-[spacing=0]:first:rounded-t-lg',
  'group-data-vertical/toggle-group:data-[spacing=0]:last:rounded-b-lg',
  'group/toggle',
  'has-data-[icon=inline-end]:pr-2',
  'has-data-[icon=inline-start]:pl-2',
  'hover:bg-muted',
  'min-w-8',
  'py-1.5',
  'transition-all',
  'mt-3',
  '*:data-[slot=select-value]:flex',
  '*:data-[slot=select-value]:gap-1.5',
  '*:data-[slot=select-value]:items-center',
  '*:data-[slot=select-value]:line-clamp-1',
  'aria-invalid:ring-3',
  'border-input',
  'dark:aria-invalid:border-destructive/50',
  'dark:bg-input/30',
  'dark:hover:bg-input/50',
  'data-[size=default]:h-8',
  'data-[size=sm]:h-7',
  'data-placeholder:text-muted-foreground',
  'disabled:cursor-not-allowed',
  'focus-visible:ring-3',
  'gap-1.5',
  'pl-2.5',
  'pr-2',
  'select-none',
  'lucide',
  'lucide-chevron-down',
  'pointer-events-none',
  'size-4',
  'after:-inset-x-3',
  'after:-inset-y-2',
  'dark:data-unchecked:bg-input/80',
  'data-[size=default]:h-[18.4px]',
  'data-[size=default]:w-[32px]',
  'data-[size=sm]:h-[14px]',
  'data-[size=sm]:w-[24px]',
  'data-checked:bg-primary',
  'data-disabled:cursor-not-allowed',
  'data-disabled:opacity-50',
  'data-unchecked:bg-input',
  'group-has-[:focus-visible]/field-label:border-transparent',
  'group-has-[:focus-visible]/field-label:ring-0',
  'group/switch',
  'peer',
  'bg-background',
  'dark:data-checked:bg-primary-foreground',
  'dark:data-unchecked:bg-foreground',
  'group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)]',
  'group-data-[size=default]/switch:data-unchecked:translate-x-0',
  'group-data-[size=default]/switch:size-4',
  'group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)]',
  'group-data-[size=sm]/switch:data-unchecked:translate-x-0',
  'group-data-[size=sm]/switch:size-3',
  'ring-0',
  '-mb-4',
  'bg-muted/50',
  'flex-col-reverse',
  'p-4',
  'rounded-b-xl',
  'absolute',
  'active:not-aria-[haspopup]:scale-[.98]',
  'aria-expanded:bg-muted',
  'aria-expanded:text-foreground',
  'bg-clip-padding',
  'dark:hover:bg-muted/50',
  'group/button',
  'in-data-[slot=button-group]:rounded-lg',
  'right-2',
  'rounded-[min(var(--radius-md),12px)]',
  'size-7',
  'text-[12.5px]',
  'top-2',
  'lucide-x',
  'sr-only',
  // formExpanded-only additions: the registration-questions "Add Question"
  // trigger reuses this screen's existing hover token in a view that never
  // rendered it before (see THE_379_ADDED_COLOURS for the identical
  // colour-sweep record of the same fact).
  'hover:bg-surface-sunken',
  ];

  const ALLOWED_ADDITIONS: Record<string, string> = {
    ...Object.fromEntries(THE_379_MOBILE_TOKENS.map((t) => [t, THE_379_MOBILE_REASON])),
    ...Object.fromEntries(LIST_REDESIGN_MOBILE_TOKENS.map((t) => [t, LIST_REDESIGN_MOBILE_REASON])),
    // THE-555 upgrades lucide-react: numeric icon aliases now also emit their canonical class.
    'lucide-link-2': 'THE-555: canonical identifier emitted alongside lucide-link2 after the approved lucide version upgrade; this identifier defines no CSS rule.',
    'lucide-trash-2': 'THE-555: canonical identifier emitted alongside lucide-trash2 after the approved lucide version upgrade; this identifier defines no CSS rule.',

    /* ─── THE-368 — the giving documentation link, APPENDED to the list below ──
       Two entries, both from ONE element: the money-flow link this ticket puts
       under the campaigns header. Added here rather than by re-recording
       ministry-AdminFundraising.json, so the baseline still describes the
       rendering it was measured against and every addition since is named with
       its ticket — appending is what keeps the record readable, and
       substituting a baseline is what turned main red last week. */
    'lucide-book-open':
      'THE-368 — the link\'s icon identifier, the same BookOpen the account ' +
      'menu\'s Documentation row carries. lucide names every icon in its own ' +
      'class; Tailwind defines no rule for it, so it sets NOTHING on a phone. ' +
      'It is an identifier reaching the layer, not a style.',
    'hover:text-body':
      'THE-368 — the link\'s hover ink, and it cannot bind on a phone at all: ' +
      'a hover: variant needs a pointer that can hover, so this changes nothing ' +
      'about the sub-640px rendering the layer describes. It is listed because ' +
      'the sweep reads every token on the layer rather than guessing which ones ' +
      'can paint, which is the right way round. The link\'s RESTING ink is ' +
      'text-muted, already on this screen\'s baseline. ' +
      'The tap target it sits on is RAISED, never shrunk: min-h-11 below sm:, ' +
      'released by sm:min-h-0 to CONTROL_DENSITY.control\'s 38px above — ' +
      'measured in a real Chromium with transitions suppressed in ' +
      'THE-368.giving-docs-link.layout.test.tsx, never asserted.',

    'lucide-chart-column':
      "THE-298 — the answers button's icon identifier. lucide names every icon " +
      'in its own class; Tailwind defines no rule for it, so it sets nothing on ' +
      'a phone. The button itself reuses the action row\'s existing class string ' +
      'verbatim, so no utility token was added with it.',

    /* ─── THE-304 — the option editor, APPENDED to the list above ─────────────
       The five entries below are the builder's option editor becoming a list of
       per-option rows instead of one `<textarea>` of newline-joined text. Two of
       them DO move a phone, deliberately and upward; three are structural. They
       are added here rather than by re-recording ministry-AdminForms.json, so the
       baseline still describes the pre-THE-298 rendering and every addition since
       is named in this list with its ticket — appending is what keeps the record
       readable, and substituting a baseline is what turned main red last week. */
    'min-h-[44px]':
      'THE-304 — the phone tap-target floor on the option editor\'s own controls ' +
      '(the option text input and the Add option button). This one DOES bind below ' +
      'sm: and that is its entire purpose — it RAISES a target, and no assertion in ' +
      'this file forbids that: section 2 forbids a target getting SMALLER. It is ' +
      'paired with sm:min-h-0 so Rule 4\'s deliberate 38px control height still ' +
      'decides above sm:, and it is spelled on these controls rather than on a ' +
      'shared primitive, exactly as THE-298 did with AdminSecondaryButton.',
    'min-w-[44px]':
      'THE-304 — the same floor on the other axis, for the three icon-only controls ' +
      'of an option row (move up, move down, remove). An icon button is the one ' +
      'shape where height alone does not make a 44px target. Paired with ' +
      'sm:min-w-0 for the same reason as min-h-[44px] above, and raising a target, ' +
      'never shrinking one.',
    'basis-full':
      'THE-304 — structural, and the 380px answer. An option row is a text input ' +
      'plus three icon controls, which at 380px either squeezes the input to ' +
      'nothing or pushes the card past the viewport. basis-full on the input makes ' +
      'it take the whole first line of a flex-wrap row so the icons wrap beneath ' +
      'it; sm:basis-auto releases it to one line again. Flex basis carries no ' +
      'colour, height or spacing.',
    'justify-center':
      'THE-304 — structural. Centres the lucide glyph inside the 44px box that ' +
      'min-w-[44px]/min-h-[44px] give the three icon controls, which without it ' +
      'sits at the left of a box wider than itself. Alignment only; no size.',
    'space-y-1.5':
      'THE-304 — structural. The 6px vertical rhythm BETWEEN option rows, which ' +
      'did not exist before because the options were one textarea and had no rows. ' +
      'space-y-1.5 is a spacing token this file already carries on the phone layer ' +
      '(the preview\'s radio/checkbox stack spells it), so it is not a new length ' +
      'either — and Rule 4 owns sm:-gated gaps, which this is not.',

    /* ── THE-313 — the order of service panel, on the event DETAIL view ──────
     *
     * ⚠️ This ticket is NOT a presentation PR, unlike the Batch F work this
     * file was written for. It adds a SURFACE to `AdminEvents/attendees`: an
     * order of service attached to the event, in its own component
     * (`events/ServicePlanPanel.tsx` and `events/ServicePlanRow.tsx`). The
     * seven tokens below are what that surface puts on the phone layer in its
     * EMPTY state — the state a fresh event renders and the one this suite
     * mounts. Every one is structural or a tap-target floor; not one carries
     * colour, and section 8's exact colour pin is UNCHANGED and still passes,
     * which is the assertion that would have caught a palette decision.
     */
    'pb-[120px]':
      'THE-313 — the bottom-nav clearance, spelled explicitly because the ADMIN ' +
      'shell\'s safe-area padding class COMPILES TO NOTHING (#437 fixed that for ' +
      'the member shell only) and its nav is `fixed bottom-0` at z-[100]. 120px ' +
      'is the same ' +
      'number AdminForms.tsx already uses for the same nav, and it is VERTICAL ' +
      'PADDING rather than a width — form-layout.ts owns widths and control ' +
      'density and has nothing to say about it. It ADDS space below the last ' +
      'item; it cannot shrink a tap target, which is what section 2 forbids.',
    'inline-flex':
      'THE-313 — structural. Lays the panel\'s text buttons (Start, Add item, ' +
      'Copy run sheet, Share) as a row of icon-plus-label so the lucide glyph ' +
      'sits on the text baseline. Display only; no colour, size or spacing.',
    'rounded-lg':
      'THE-313 — structural. The 8px corner on the panel\'s own controls, one ' +
      'step tighter than the rounded-xl this screen already spells on its cards ' +
      'so a control reads as nested inside one. A radius carries no colour and ' +
      'no size.',
    'space-y-3':
      'THE-313 — structural. The vertical rhythm between the panel\'s blocks ' +
      '(name, item list, actions). An unprefixed spacing token this screen ' +
      'already carries on the phone layer elsewhere; Rule 4 owns sm:-gated gaps, ' +
      'which this is not.',
    'disabled:opacity-40':
      'THE-313 — structural, and a STATE rather than a colour: opacity is not a ' +
      'palette token and resolves identically in all four. It marks the Start / ' +
      'Save / Remove buttons while a write is in flight. `isColourToken` agrees ' +
      'it carries no colour, which is why section 8 stays green.',
    'lucide-list-ordered':
      'THE-313 — a lucide GLYPH CLASS, emitted by the icon component rather than ' +
      'spelled by this ticket. `ListOrdered` heads the panel. This screen already ' +
      'carries a dozen lucide-* classes on its phone layer for the same reason.',
    'lucide-plus':
      'THE-313 — the same, for the `Plus` icon on the Start and Add item ' +
      'buttons. `AdminEvents` already renders `Plus` elsewhere; this is the same ' +
      'glyph reaching a surface the baseline was recorded without.',

    /* ── THE-345 — the paid-events notice, on the event FORM view ──
     *
     * APPENDED, NOT SUBSTITUTED, which is this list's own stated rule and the
     * one #434 broke when it made main red for everyone. Every token below comes
     * from ONE primitive and shares ONE reason, so the reason is declared once
     * and referenced, exactly as TABS_PRIMITIVE_REASON is above.
     *
     * The soundness of that claim is asserted, not asserted-in-prose: section
     * "every recorded alert class is verbatim in ui/alert.tsx" reads the
     * primitive's own source, so a hand-written class smuggled onto this list to
     * silence a failure goes red naming itself.
     */
    "*:[svg:not([class*='size-'])]:size-4":
      ALERT_MOBILE_REASON,
    '*:[svg]:row-span-2':
      ALERT_MOBILE_REASON,
    '*:[svg]:text-current':
      ALERT_MOBILE_REASON,
    '*:[svg]:translate-y-0.5':
      ALERT_MOBILE_REASON,
    'bg-card':
      ALERT_MOBILE_REASON,
    'gap-0.5':
      ALERT_MOBILE_REASON,
    'group/alert':
      ALERT_MOBILE_REASON,
    'has-[>svg]:gap-x-2':
      ALERT_MOBILE_REASON,
    'has-[>svg]:grid-cols-[auto_1fr]':
      ALERT_MOBILE_REASON,
    'has-data-[slot=alert-action]:pr-18':
      ALERT_MOBILE_REASON,
    'has-data-[slot=alert-action]:relative':
      ALERT_MOBILE_REASON,
    'px-2.5':
      ALERT_MOBILE_REASON,
    'relative':
      ALERT_MOBILE_REASON,
    'text-card-foreground':
      ALERT_MOBILE_REASON,
    'text-left':
      ALERT_MOBILE_REASON,
    '[&_a]:hover:text-foreground':
      ALERT_MOBILE_REASON,
    '[&_a]:underline':
      ALERT_MOBILE_REASON,
    '[&_a]:underline-offset-3':
      ALERT_MOBILE_REASON,
    'font-medium':
      ALERT_MOBILE_REASON,
    'group-has-[>svg]/alert:col-start-2':
      ALERT_MOBILE_REASON,
    '[&_p:not(:last-child)]:mb-4':
      ALERT_MOBILE_REASON,
    'text-balance':
      ALERT_MOBILE_REASON,

    /* ── THE-317 — the volunteer rota's entry point, on the event LIST view ──
     *
     * ⚠️ APPENDED, NOT SUBSTITUTED, which is this list's own stated rule and the
     * one #434 broke when it made main red for everyone. Two tokens, both on one
     * control: the button that opens the rota screen from the events list. The
     * rota SCREEN itself puts nothing on this layer, because `surfaces()` never
     * renders it — it is reached by `setView('rota')` and is measured instead in
     * `THE-317.volunteer-rota.layout.test.tsx`, in real Chromium, at five widths.
     *
     * 🔴 Its 44px floor is `min-h-[44px]` / `sm:min-h-0`, which THE-304 already
     * documents above, verbatim and for the identical reason — a token this list
     * already carries is not a new one, and re-documenting it would be a second
     * entry for one fact. */
    'py-2':
      'THE-317 — structural. The vertical padding on the "Volunteer rota" button ' +
      'in the events list header. An unprefixed spacing token this screen already ' +
      'spells on the phone layer elsewhere (the attendee search input carries it), ' +
      'so it is not a new length; it reaches the LIST view here, which the ' +
      'baseline was recorded without. Padding carries no colour. The button pairs ' +
      'it with min-h-[44px], so the tap target is the floor and not the padding.',
    'lucide-calendar-check':
      'THE-317 — a lucide GLYPH CLASS, emitted by the icon component rather than ' +
      'spelled by this ticket. `CalendarCheck` heads the rota button, and it is ' +
      'ALREADY IMPORTED by this screen (it renders on an event card) — so this is ' +
      'the same glyph reaching a surface the baseline was recorded without, which ' +
      'is exactly what THE-313 documented for lucide-plus one entry above.',

    /* ── THE-308 — the month grid's tab pair, on the event LIST view ─────────
     *
     * ⚠️ APPENDED, NOT SUBSTITUTED — this list's own stated rule, and the one
     * #434 broke when it made main red for everyone. The baseline below is
     * untouched; every entry here is additive.
     *
     * 🔴 SIXTY OF THESE ARE NOT SPELLED BY THIS TICKET. They are the class set
     * `tabs` EMITS — `Tabs`, `TabsList`, `TabsTrigger` and `TabsContent` in
     * `src/components/ui/tabs.tsx`, whose digest is pinned byte-identical in
     * `the-308-guards.test.ts` and unchanged by this PR. That is precisely the
     * category THE-313 and THE-317 already documented for `lucide-*`: a class
     * emitted by a component rather than written by the ticket that mounts it.
     *
     * ⚠️ THE DIFFERENCE FROM A GLYPH CLASS IS THE COUNT, NOT THE KIND. A lucide
     * icon emits one; a primitive with four parts, two orientations and two
     * variants emits sixty. Enumerating them one by one with sixty near-identical
     * sentences would bury this list rather than document it, so they share ONE
     * reason and are listed by name — which keeps the property that matters: the
     * keys are EXACT, so a SIXTY-FIRST token still fails here, and any token
     * `tabs` stops emitting has to come out.
     *
     * 🔴 None of them carries a hardcoded colour. Every colour-bearing entry in
     * the set resolves through a theme token (`bg-muted`, `text-foreground`,
     * `after:bg-foreground`, `ring-ring/50`), which is why the four palettes
     * still resolve and why the colour sweep passes unchanged.
     */
    'mt-4':
      'THE-308 — structural, and the only token of this group the ticket itself ' +
      'spells. The gap between the tab bar and the panel below it, on both ' +
      'TabsContent. An unprefixed spacing token this screen already carries on its ' +
      'phone layer elsewhere, so it is not a new length; it reaches the LIST view ' +
      'here, which the baseline was recorded without. Margin carries no colour, and ' +
      'no tap target is sized by it.',
    ...Object.fromEntries(TABS_PRIMITIVE_CLASSES.map((t) => [t, TABS_PRIMITIVE_REASON])),
    ...Object.fromEntries(PAGE_HEADER_CLASSES.map((t) => [t, PAGE_HEADER_REASON])),

    /* --- THE-346 - four tokens, APPENDED to everything above -----------------
       Every entry above stays exactly as its ticket wrote it. These three
       screens are the ones this ticket touches, and each token here RAISES or
       is structural: nothing below shrinks a target, which is what section 2
       actually forbids. */
    'min-h-11':
      'THE-346 - the phone tap-target floor on the Events List/Month triggers, ' +
      'and the same 44px THE-304 spells as min-h-[44px] above, off the spacing ' +
      'scale instead of as an arbitrary value. It REPLACES min-h-[44px] on those ' +
      'two triggers rather than adding to them, so the measured height is ' +
      'unchanged at 44px; it binds below sm: on purpose and is paired with ' +
      'sm:min-h-0 so Rule 4 still decides above it.',
    'min-w-11':
      'THE-346 - the same 44px on the other axis of the same two triggers, ' +
      'replacing min-w-[44px]. Height alone does not make a target when the ' +
      'content is two short words, which is the finding THE-308 recorded when ' +
      'one of these tabs measured 35.6px wide.',
    'group-data-[orientation=horizontal]/tabs:h-auto':
      'THE-346 - the ONE token of this group the ticket spells itself, and the ' +
      'fix for the founder\'s List/Month report. The tabs primitive fixes ' +
      'TabsList at h-8 (32px) through the identically-shaped variant already ' +
      'allowed above; the 44px triggers inside it therefore hung 6px out of each end of ' +
      'the bottom of their own container, measured at 380px. This releases the ' +
      'LIST below sm: so it wraps whatever the triggers need (50px), and the ' +
      'sm: half restores the primitive\'s 32px above it. It RAISES a container ' +
      'to fit a target rather than sizing a target, and h-auto can shrink ' +
      'nothing - it is the absence of a height.',
    '-mx-4':
      'THE-346 - the chat composer\'s width, and it CANCELS a padding rather ' +
      'than adding a length. AdminDashboard wraps the whole community screen in ' +
      'p-4 pb-0 lg:p-0 for the conversation rail\'s sake, and ChannelThread and ' +
      'DmThread then add px-4 of their own around the composer, so the composer ' +
      'pill spanned 316px of 380 - 32px of gutter each side, against a message ' +
      'list whose box-less bubbles read as edge-to-edge. This undoes exactly the ' +
      'shell\'s 16px for the THREAD PANE only (lg:mx-0 above), leaving the one ' +
      '16px inset the bubbles already sit on. It fills the parent\'s padding ' +
      'box and never leaves its border box, so the shell\'s overflow-hidden has ' +
      'nothing to clip, and it sizes no tap target.',
    'w-20':
      'Eden shell pass — both Events List/Month triggers share one width so they ' +
      'measure equal at every viewport, including 380px where content width made ' +
      'Month 18px wider than List. 5rem is 80px at the phone root, above the 44px ' +
      'floor, and it sizes the control rather than shrinking it.',
    'flex-none':
      'Eden shell pass — the tabs primitive sets flex-1 on a trigger. flex-none ' +
      'lets the shared w-20 win, so the two words stay the same width. It does ' +
      'not set a height and cannot pull a target under 44px.',

    /* ── The admin event detail (brief item 3, events remodel) — the
     * header's date/time line and action row, on `AdminEvents/attendees`.
     * Every token below is structural, a spacing value already on this
     * screen's phone layer elsewhere, or a lucide glyph class; not one
     * carries colour or shrinks a tap target. */
    'gap-x-3':
      'The header\'s date/time line lays its Clock icon beside its text and ' +
      'wraps onto a second item (location) with the SAME horizontal gap the ' +
      'row\'s vertical counterpart (gap-y-1, below) already pairs with ' +
      'elsewhere on this screen. Spacing only; no colour or size.',
    'gap-y-1':
      'The same line\'s row gap when it wraps to two lines on a narrow phone. ' +
      'An unprefixed spacing token this file already carries on other flex-wrap ' +
      'rows; Rule 4 owns sm:-gated gaps, which this is not.',
    'mt-1.5':
      'Structural — the 6px gap between the title/status row and the date/time ' +
      'line beneath it. An unprefixed spacing value, not a size or a colour.',
    'mt-2':
      'Structural — the gap between the detail header and the Overview/' +
      'Registrations/Payments pending Tabs beneath it.',
    'flex-shrink-0':
      'The header\'s action buttons (Share link, Edit, Cancel event, Delete) ' +
      'must not compress when the title beside them truncates instead. A flex ' +
      'behaviour flag; it carries no colour and does not touch a tap target\'s ' +
      'own size.',
    'lucide-clock':
      'The date/time line\'s Clock icon identifier. lucide names every icon in ' +
      'its own class; Tailwind defines no rule for it, so it sets nothing on a ' +
      'phone. This screen already renders Clock elsewhere (the list rows\' own ' +
      'time range).',
    'lucide-map-pin':
      'The same line\'s MapPin icon identifier, for an in-person event\'s ' +
      'location. This screen already renders MapPin on its list rows; this is ' +
      'the same glyph reaching the detail header.',
    'lucide-ban':
      'The Cancel-event button\'s icon identifier (Ban). A new glyph this ' +
      'screen did not carry before, but an IDENTIFIER CLASS, not a style: ' +
      'Tailwind defines no rule for `lucide-ban` and it sets nothing on a ' +
      'phone, the same reasoning every other lucide-* entry on this list rests on.',
  };

  const toTokens = (layer: string[]) =>
    [...new Set(layer.flatMap((l) => (l.split('\t')[2] ?? '').split(' ').filter(Boolean)))];

  for (const name of SCREENS) {
    it(`puts no undocumented token on the ${name} mobile layer`, async () => {
      for (const [view, c] of Object.entries(await surfaces(name))) {
        const before = new Set(toTokens(BASELINE[name]![view].mobileLayer));
        const added = toTokens(mobileLayer(c)).filter((t) => !before.has(t));
        expect(added.filter((t) => !(t in ALLOWED_ADDITIONS) && !(name === 'AdminEvents' && CONTROL_PRIMITIVE_CLASSES.has(t))),
          `${name}/${view} gained a token that reaches a phone`).toEqual([]);
      }
    });
  }

  for (const name of SCREENS) {
    it(`takes nothing off the ${name} mobile layer that could have bound below 640px`, async () => {
      for (const [view, c] of Object.entries(await surfaces(name))) {
        const now = new Set(toTokens(mobileLayer(c)));
        for (const t of toTokens(BASELINE[name]![view].mobileLayer).filter((t) => !now.has(t))) {
          expect(t in ALLOWED_REMOVALS || (name === 'AdminEvents' && view === 'form' && t === 'text-white'),
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
    // 🔴 THE-308 — the ONLY exemption is `tabs`' own four, on the ONE screen
    // that adopts it, recorded and provenance-checked above. Every other
    // screen, and every other token, is asserted exactly as before: a FIFTH
    // unprefixed height from `tabs`, or ANY from anywhere else, still fails.
    const recorded = new Set([...TABS_UNPREFIXED_HEIGHTS, ...THE_346_UNPREFIXED_HEIGHTS, ...PAGE_HEADER_UNPREFIXED_HEIGHTS, ...THE_379_UNPREFIXED_HEIGHTS, ...LIST_REDESIGN_UNPREFIXED_HEIGHTS]);
    for (const name of SCREENS) {
      for (const [view, c] of Object.entries(await surfaces(name))) {
        const base = new Set(BASELINE[name]![view].mobileLayer.flatMap((l) => l.split('\t')[2]?.split(' ') ?? []));
        for (const t of allTokens(c).filter((t) => /(?:^|:)h-/.test(t) && !isResponsive(t))) {
          if (name === 'AdminEvents' && (recorded.has(t) || CONTROL_PRIMITIVE_CLASSES.has(t))) continue;
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
      // Eden shell pass — desktop-only geometry on the Events List/Month bar.
      // Each is sm:-gated, so the phone floor stays the primitive padding plus
      // min-h-11. None of these is a form-layout measure.
      'sm:h-8', 'sm:p-1', 'sm:px-3', 'sm:gap-0.5', 'sm:w-fit',
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

  /**
   * 🔴 THE-331 — AdminCommunity HAS legitimately moved, and this is the record.
   *
   * Recorded in the shape THE-251 established for AdminFundraising and THE-308
   * kept for AdminEvents: the pin is KEPT and RE-AIMED, never loosened and
   * never deleted. Previous pin, kept here so nothing is lost:
   *
   *     strippedSha:   3d54f2eb01122a18900f911b2077f84ff9b69df10278988470018724c1bbf61c
   *     strippedLines: 1529     (the pre-PR revision, 974ae1d)
   *
   * ⚠️ WHAT MOVED, WHOLE — 1529 → 1341 stripped lines, and every one of the
   * 188 is a DELETION or a call-site swap. Nothing was added to this screen:
   *
   *   1. `AttachPicker` is GONE, 182 lines of it. It was a hand-rolled `sheet`
   *      (`fixed inset-0 z-[300] flex items-end`, no `sm:` override — the
   *      founder's bug), a hand-rolled tab strip, a hand-rolled search input, a
   *      hand-spun border-spinner with a hardcoded #d4a017, a hand-rolled empty
   *      state, and four EMOJI standing in for icons.
   *   2. Both composer sites now render `<AttachMenu />` in place of a
   *      paperclip `<button>` plus a `{showPicker && …}` block; the two
   *      `showPicker` useStates go with them.
   *   3. The three remaining emoji — in `AttachmentCard` and the two
   *      attachment chips — become a shared `AttachTypeIcon`.
   *
   * 🔴 NOTHING THE MESSAGING DEPENDS ON MOVED, asserted rather than claimed.
   * `firestorePathsOf` below is RE-AIMED for exactly one removal and no
   * addition: `'tenants', tenantId, 'forms'` left this file when the attach
   * loaders moved to `src/lib/attach-records.ts`, which is the whole point of
   * extracting them — two screens attach records and were about to duplicate
   * the four collection spellings. Every other path is byte-identical and in
   * the same order, and all four community collections are still asserted
   * present by `COLLECTIONS` below, unchanged.
   *
   * ⚠️ The six live Firestore listeners, the channel and DM queries, the send
   * path and the attachment schema are untouched. The known unrelated Firestore
   * 400 on the `orderBy('createdAt','desc')` channels Listen stream is NOT this
   * ticket's and was not investigated here.
   *
   * Update `THE_331_COMMUNITY` only for a deliberate, reviewed change to
   * AdminCommunity, and say which ticket in the same breath.
   */
  /**
   * RE-AIMED BY THE-346 - 1341 -> 1367 STRIPPED LINES, AND ALL 26 ARE PROSE.
   * The previous pin, kept so nothing is lost:
   *
   *     strippedSha:   830df7a4fc28c8d4e468270e7dae171ecb2e8691e76e842d4a6cfa61a88bbe0c
   *     strippedLines: 1341     (THE-331, the attach surface)
   *
   * WHAT THE-346 CHANGED IN THIS FILE: ONE className token, `-mx-4 lg:mx-0` on
   * the thread pane, and a `{/* ... *\/}` note explaining it. The founder:
   * *"the input text field is not wide enough to the whole width of the
   * screen."* Measured at 380px, the composer's pill spanned 316px of 380
   * because TWO paddings stack - AdminDashboard's `p-4` around the whole screen
   * and the thread's own `px-4` around the composer.
   *
   * SO WHY DID THE COUNT GO UP WHEN ONLY A CLASS CHANGED? `stripPresentation`
   * strips `//` comments and blank lines; it does NOT strip the `{/* ... *\/}`
   * JSX comment blocks this repo writes its reasons in - the same answer
   * THE-326 and THE-345 record for AdminEvents below. The whole of the +26 is
   * that note, and it is long because the padding it cancels is NOT IN THIS
   * FILE and a reader has to be told where it is.
   *
   * WHAT THIS SECTION IS FOR IS UNTOUCHED. No read, no write, no handler and no
   * import moved: `firestorePathsOf` above is unchanged and still passes
   * unedited, the six live listeners and the send path are byte-identical, and
   * the shell's own `p-4` was DELIBERATELY NOT removed - the conversation rail
   * carries no horizontal padding of its own below `lg`, so dropping it would
   * have pushed every channel row against the screen edge.
   */
  const THE_331_COMMUNITY = {
    strippedSha: '3ea9a952c2c7645c1e0e1de628f57159367ec12ece1b9a42bdb4bcac236f21a0',
    strippedLines: 1367,
    /**
     * The pre-PR list minus the one path that moved to attach-records.ts.
     * ⚠️ A FUNCTION, not a value: `PRE_PR` is loaded in `beforeAll`, so a
     * const evaluated at collection time would read `undefined`.
     */
    firestorePaths: () =>
      PRE_PR_COMMUNITY_PATHS_MINUS_FORMS_OF(PRE_PR.AdminCommunity.firestorePaths),
  };

  it('reads and writes the same four collections, spelled the same way', () => {
    const after = read('AdminCommunity.tsx');
    // Community step 1 ensures the default group and loads the group roster.
    const expected = THE_331_COMMUNITY.firestorePaths();
    const channelList = expected.indexOf("'tenants', tenantId, 'channels'");
    expected.splice(channelList, 0, "'tenants', tenantId, 'channels', 'all-members'");
    // PR 554 extracts both user collection reads into loadScopedUserDocs.
    // Remove exactly those two paths; every other path must retain its order.
    expect(expected.filter(p => p === "'users'")).toHaveLength(2);
    for (let i = 0; i < 2; i += 1) expected.splice(expected.indexOf("'users'"), 1);
    expect(firestorePathsOf(stripComments(after))).toEqual(expected);
    const loader = stripComments(readFileSync(path.join(REPO, 'src/components/community/loadScopedUserDocs.ts'), 'utf8'));
    expect(firestorePathsOf(loader)).toEqual(["'users'"]);
    expect(loader).toContain("where('tenantId', '==', value), orderBy(documentId()), limit(max)");
    for (const c of COLLECTIONS) expect(after.includes(c), `${c} disappeared`).toBe(true);
  });

  it('🔴 the only path that left did so by moving, not by disappearing', () => {
    // A read that vanished from the tree entirely would be a behaviour change
    // wearing an extraction's clothes. It is asserted to exist in its new home.
    const moved = "'tenants', tenantId, 'forms'";
    expect(PRE_PR.AdminCommunity.firestorePaths).toContain(moved);
    expect(firestorePathsOf(read('AdminCommunity.tsx'))).not.toContain(moved);
    const lib = readFileSync(path.join(REPO, 'src/lib/attach-records.ts'), 'utf8');
    expect(
      firestorePathsOf(lib),
      'the forms read must still exist, in the module it moved to',
    ).toContain(moved);
  });

  it('pins AdminCommunity outside presentation after community step 1', () => {
    const now = stripPresentation(read('AdminCommunity.tsx'));
    // Community step 1 changes group creation and exposes onboarding answers.
    // PR 554 bounds the group picker and uses the shared sender-name fallback.
    expect([
      [1285, '260913648f9e957b8bec6fbce8f9ade5e41bb6119907a0f005fef7d374c329ec'],
      [1280, '76881812af03d7c3baaf7e5b212de85809436fdba90246e8a70431507a710c8a'],
      // THE-555 merge retains PR 554's extracted, tenant-scoped user picker.
      [1259, 'ef2d02cbd289c2dee02399a92acdcd3125c1d26f91c30bfb5db92807731582aa'],
      // PR 554 final review adopts shadcn for the member and onboarding actions.
      [1260, 'f5dad168ccab0e90c653baa24cab8f420774a7e1be14a14ebf16ac4e04fc5837'],
    ], DIFF_HINT('AdminCommunity')).toContainEqual([now.split('\n').length, sha(now)]);
  });

  it('writes nothing on render when the default group already exists', async () => {
    await screen('AdminCommunity');
    expect(writes).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Money.
// ─────────────────────────────────────────────────────────────────────────────
describe('no ticket price, donation amount, fee or checkout call changed', () => {
  /**
   * 🔴 THE-308 — AdminEvents HAS legitimately moved, and this is the record.
   *
   * Recorded in the shape THE-251 established for AdminFundraising and THE-254
   * kept: the pin is KEPT and RE-AIMED, never loosened and never deleted.
   *
   * ⚠️ WHAT MOVED, WHOLE — 867 → 919 stripped lines, and none of it is a
   * behaviour change to an existing path:
   *
   *   1. two imports — `tabs` and `useMonthEvents` — plus a LAZY one for
   *      `EventMonthView`, whose header says why: a static import would put
   *      react-day-picker in the chunk this screen loads for its LIST
   *   2. two lines of state — `listTab` (defaulting to `'list'`) and the
   *      `useMonthEvents` read
   *   3. the list body wrapped in `<Tabs>` with a `TabsList` of two triggers,
   *      the month grid in one `TabsContent`, and the EXISTING list — unchanged
   *      and un-reindented — in the other
   *
   * The month grid is its own component, so its markup is not in this count:
   * the same property that held THE-313's ServicePlanPanel edit to two lines.
   *
   * 🔴 NOTHING THE MONEY DEPENDS ON MOVED, asserted rather than claimed, twice:
   *
   *   • `firestorePaths` below — NEW in this ticket, pinned against the PRE-PR
   *     revision, which is the assertion THE-251 names as the one that actually
   *     protects the money. The month view is READ-ONLY: it adds no client
   *     write, and it reads a path this screen already read.
   *   • `handleSave` and `confirmDelete` are pinned BY REGION DIGEST in
   *     `the-308-guards.test.ts`, at the same literals THE-313 recorded — a
   *     stronger statement than a whole-file hash can make about a file that
   *     legitimately changed.
   *
   * Update `THE_308_EVENTS` only for a deliberate, reviewed change to
   * AdminEvents, and say which ticket in the same breath.
   */
  /**
   * 🔴 RE-AIMED AGAIN BY THE-326 — 919 → 935 STRIPPED LINES, AND WHAT MOVED IS
   * NAMED. Previous pin, kept here so nothing is lost:
   *
   *     strippedSha:   4d0fdf8224232f191ad29049306d567bf0e2292e0478f3838142a1486cc80d6f
   *     strippedLines: 919      (THE-308, the month view)
   *
   * ⚠️ THIS TICKET REMOVES BEHAVIOUR FROM THIS SCREEN AND ADDS NONE. It deletes
   * the `ServicePlanPanel` mount, the whole `'rota'` view (both panels), the
   * "Volunteer rota" button, the `'rota'` arm of the header-override effect, the
   * three imports, and `'rota'` from `ViewMode`. Service planning is its own
   * section now — `AdminServices.tsx` — which is the entire ticket.
   *
   * 🔴 SO WHY DID THE COUNT GO UP? `stripPresentation` strips `//` comments and
   * blank lines; it does NOT strip the `{/* … *\/}` JSX comment blocks this repo
   * writes its reasons in. THE-326 leaves one such note where the run sheet used
   * to mount, so a reader of the event detail screen is told where it went
   * instead of finding a silent gap. That note is longer than the six lines of
   * JSX it replaces, and the whole of the +16 is prose.
   *
   * ⚠️ The two helpers this hash runs through first — `unwrapServicePlan` and
   * `unwrapRota` — were written to undo THE-313's and THE-317's edits before
   * hashing. They now match nothing, BECAUSE THE CODE THEY UNWRAPPED IS GONE
   * FOR REAL. They are deliberately left in place: they are the record of what
   * those tickets added, and a future revert would need them again.
   *
   * ✅ NOTHING ABOUT THE MONEY MOVED, and the two assertions that actually say
   * so are untouched and still pass: `firestorePathsOf` below is unchanged
   * (this ticket adds no read and no write), and `handleSave`/`confirmDelete`
   * stay pinned BY REGION DIGEST in `the-308-guards.test.ts` at the literals
   * THE-313 recorded — a stronger statement about a file that legitimately
   * changed than any whole-file hash can make.
   */
  /**
   * RE-AIMED AGAIN BY THE-345 - 935 -> 1004 STRIPPED LINES, AND WHAT MOVED IS
   * NAMED. Previous pins, kept here so nothing is lost:
   *
   *     strippedSha:   4d0fdf8224232f191ad29049306d567bf0e2292e0478f3838142a1486cc80d6f
   *     strippedLines: 919      (THE-308, the month view)
   *     strippedSha:   78b5eee8c919f1ae379ab35a8a6443af169cae028420f5a0511cffec699e1f6d
   *     strippedLines: 935      (THE-326, service planning split out)
   *
   * WHY RE-RECORDED RATHER THAN REVERSED. THE-251's note above sets out the two
   * honest options and says which is weaker; THE-313, THE-317 and THE-324 each
   * took the stronger one because their edits were two to five exact strings.
   * THE-345's is not: it gates BOTH price inputs, replaces one of them with an
   * Alert, gates three price QUOTES and the CSV Amount cell, and changes the
   * price expression inside `handleSave`. Reversing that by exact string would
   * put a large blob of duplicated production source in this file - unreviewable
   * and red on the next comment rewording - which THE-251 names as a worse guard
   * than none.
   *
   * WHY THE COUNT WENT UP BY 69 WHEN THE TICKET REMOVES TWO INPUTS.
   * `stripPresentation` strips `//` comments and blank lines; it does NOT strip
   * the `{/* ... *\/}` JSX comment blocks this repo writes its reasons in, and
   * this ticket leaves one at every gate so a reader of the event editor is told
   * why the price field is absent instead of finding a silent gap. 46 of the
   * stripped lines are that prose. The rest is the ternaries and the Alert.
   *
   * WHAT THIS SECTION IS ACTUALLY FOR - "no ticket price, donation amount, fee
   * or checkout call changed" - IS EXACTLY WHAT THIS TICKET CHANGES, at the
   * founder's instruction: "I should not be able to create paid events with
   * stripe disabled. How are we gonna know if someone paid or not." So the
   * re-record is the ticket, not collateral. The three assertions that carry the
   * claim underneath it are untouched and still pass unedited:
   *
   *   - `firestorePathsOf` below is unchanged - this ticket adds no read and no
   *     write, and the money is written by the server either way.
   *   - `handleSave` and `confirmDelete` stay pinned BY REGION DIGEST in
   *     `the-308-guards.test.ts` and `the-313-guards.test.ts`. `confirmDelete`
   *     is BYTE-IDENTICAL; `handleSave` moved by one expression and both suites
   *     record the new value as an APPENDED accepted set, so the exact shape of
   *     the change is reviewable rather than blessed wholesale.
   *   - the event editor's money field is still asserted by label directly
   *     below, inverted to the claim that is now true and requiring the notice
   *     that replaced it.
   *
   * Update `THE_308_EVENTS` only for a deliberate, reviewed change to
   * AdminEvents, and say which ticket in the same breath.
   */
  const THE_308_EVENTS = {
  /**
   * RE-AIMED AGAIN BY THE-346 - 1004 -> 1044 STRIPPED LINES, AND ALL 40 ARE
   * PROSE. Previous pins, kept so nothing is lost:
   *
   *     strippedSha:   8fd9437c2ea58d7c3ea45ade0f238ea5605803c0fd0eb3243c60cdd751fea42d
   *     strippedLines: 1004     (THE-345, paid events gated)
   *
   * WHAT THE-346 CHANGED IN THIS FILE: THREE className strings on the
   * List/Month tab bar, and a `{/* ... *\/}` note explaining them. The founder:
   * *"look at how the buttons for list and month look like. It needs to be
   * fixed."* Measured in Chromium at 380px, `TabsList` was 32px tall and its
   * triggers 44px, so the active pill hung 6px out of each end of the box
   * it lived in. The list is released to `h-auto` below sm: so it wraps the
   * triggers, and the primitive's 32px is restored above.
   *
   * WHY THE COUNT WENT UP WHEN ONLY THREE CLASSES CHANGED - the same answer
   * THE-326 and THE-345 give above: `stripPresentation` does not strip JSX
   * comment blocks. The note is long because the reading that had to be ruled
   * out - PR 482's injected global reset zeroing a sibling's padding - is the
   * one a later reader would reach for first, and ruling it out is part of the
   * finding.
   *
   * WHAT THIS SECTION IS ACTUALLY FOR - "no ticket price, donation amount, fee
   * or checkout call changed" - IS UNTOUCHED BY THIS TICKET, which is the
   * difference from THE-345's re-record above. THE-346 changes nothing but tab
   * geometry: `firestorePathsOf` below is unchanged, no read or write moved,
   * and THE-345's price gating and THE-308's lazy month-view mount are
   * byte-identical.
   */
  /**
   * RE-AIMED AGAIN BY THE-351 - 1044 -> 1262 STRIPPED LINES. Previous pins,
   * kept so nothing is lost:
   *
   *     strippedSha:   8fd9437c2ea58d7c3ea45ade0f238ea5605803c0fd0eb3243c60cdd751fea42d
   *     strippedLines: 1004     (THE-345, paid events gated)
   *     strippedSha:   56a8bd901375d088e0b6ec8a1865e09dbbac12ce4d1dd9deae06839d1b8988ee
   *     strippedLines: 1044     (THE-346, the List/Month tab bar)
   *
   * WHAT THE-351 CHANGED IN THIS FILE, and this is the case THE-345's own note
   * above describes: "WHAT THIS SECTION IS ACTUALLY FOR - no ticket price,
   * donation amount, fee or checkout call changed - IS EXACTLY WHAT THIS TICKET
   * CHANGES, at the founder's instruction." It is true again here, for the
   * opposite instruction. The founder now wants paid events BACK, on terms
   * Harvest can be honest about: "Don't let Harvest imply it verified anything.
   * The church confirms; Harvest records what the church says."
   *
   * So the re-record is the ticket, not collateral. What moved:
   *
   *   - a DISCLAIMER above the pricing block, before the price input, so an
   *     admin cannot type a number without having read that Harvest cannot check
   *     anything and that THEY will confirm each payment by hand;
   *   - a per-event PROVIDER PICKER over the church's own giving links;
   *   - the TICKET-TYPE price input and its clamp move from `PAID_EVENTS_ENABLED`
   *     to `ticketPricingAvailable()`. The EVENT-LEVEL price input is UNTOUCHED
   *     and still absent, because THE-345's finding about it holds in either
   *     mode: it is charged by nothing;
   *   - a payment flag beside each attendee and a Confirm control on rows that
   *     owe money.
   *
   * THE THREE ASSERTIONS THAT CARRY THE CLAIM UNDERNEATH IT STILL PASS:
   *
   *   - `firestorePathsOf` below is UNCHANGED - the Confirm control calls an API
   *     route through the shared client module, so this screen still reads and
   *     writes exactly what it always did, and the money is written server-side
   *     by THE-350's writer.
   *   - `handleSave` and `confirmDelete` stay pinned BY REGION DIGEST in
   *     `the-308-guards.test.ts` and `the-313-guards.test.ts`. `confirmDelete`
   *     is BYTE-IDENTICAL; `handleSave` gained exactly one field - the provider
   *     ids, which are not money - and both suites record the new value as an
   *     APPENDED accepted set, so the exact shape of the change is reviewable
   *     rather than blessed wholesale.
   *   - the event editor's money field is still asserted by label directly
   *     below, and THE-345's claim about it is UNINVERTED: the event-level price
   *     field is still absent and the notice that replaced it is still required.
   *
   * Update `THE_308_EVENTS` only for a deliberate, reviewed change to
   * AdminEvents, and say which ticket in the same breath.
   */
    // UI polish, 23 Oct (THE-377) - RE-RECORDED, previous values kept here:
    //   strippedSha:   69aed7ec56c33aa685543a7428a7a1c648afa8b48bc86e80a24b57a9fa326fbe
    //   strippedLines: 1262
    // What moved is the header: the eyebrow is gone, the title is "Events" with the count as its
    // subtitle, and the List/Month pill moved from a bare TabsList into the shared header's PageTabs
    // beside "Create event". The count FELL because THE-346's 36-line JSX note, about the old TabsList's
    // height, went with the TabsList it described. No read, write, price, fee or checkout call moved.
    //
    // RE-RECORDED AGAIN BY THE-379 (events remodel, 28 Oct). Previous value kept here:
    //   strippedSha:   aa175dd534ed5778426623cc47573a10707563eb5a411afe46c8e39f4d779493
    //   strippedLines: 1231
    // WHAT MOVED: the create/edit form became a shadcn Dialog (Eden's "New event" is a single
    // popup, not a page); Where became a ToggleGroup with a keyless OpenStreetMap preview;
    // Repeats/Ends, a time zone Select and an Open-to-anyone Switch were added after the date
    // fields; the payment-link picker became a single-select RadioGroup (Matei: "make the admin
    // create form pick ONE link"); a Registration Questions builder (short/long/choice, required,
    // reorder, max 10) was added beside Discount Codes; the list gained an Upcoming/Drafts/Past
    // filter and an Eden "Plan your first event" Empty state. THE_379_PRIMITIVE_CLASSES,
    // THE_379_ADDED_COLOURS, THE_379_REMOVED_COLOURS, THE_379_MOBILE_TOKENS and
    // THE_379_UNPREFIXED_HEIGHTS above are the full accounting of what that touches on the
    // colour and mobile-layer sweeps. `firestorePathsOf` below is unchanged — every new field
    // (recurrence, timeZone, registrationQuestions, openToAnyone) is written onto the SAME
    // `tenants/{id}/events/{id}` document this screen always wrote, and no price, fee or
    // checkout call moved.
    //
    // RE-RECORDED AGAIN by a colour-literal fix (28 Oct). Previous value kept here:
    //   strippedSha:   24d8de7c56a2d6410cfb69be55006fbd4aafa5c172f28cc1599168f65778582f
    // WHAT MOVED: the Registration Questions builder's "Add" button, added by THE-379,
    // spelled its own `style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}` instead
    // of the `bg-gold` class (which already resolves to `var(--brand-color)`) every other
    // button on this screen uses. Swapped to `bg-gold`; no className count or line moved,
    // and no price, fee or checkout call moved.
    //
    // RE-RECORDED AGAIN by the events LIST redesign (Eden layout #1, 28 Oct).
    // Previous value kept here:
    //   strippedSha:   355bde1e6dd10a404a8c8f5537f60b9366d62cffb0b46dc2b60c5698ed48e125
    //   strippedLines: 1526
    // WHAT MOVED: the list view gained a left-panel mini calendar
    // (`EventListCalendar`, lazy-mounted the same way `EventMonthView` is)
    // marking days that carry an event and filtering the list to a clicked
    // day; the Upcoming/Drafts/Past filter moved into a vertical nav beside
    // it (plain buttons, not `tabs` — see the comment on that markup for why);
    // "Upcoming"/"Drafts"/"Past" (or the selected day) now reads beside a
    // second "New event" button, Eden's own list-header line; each event row
    // became Eden's layout — a date block, the weekday/time range, where,
    // capacity (never a live registration count: no Firestore path moved,
    // see firestorePathsOf below) and a recurring event's own next runs
    // (`expandRuns`, the same pure function the create form and the submit
    // route use) — read left to right instead of a card's stacked blocks.
    // Phone keeps the existing card, with the same new time-range/capacity/
    // runs lines added. CALENDAR_PRIMITIVE_CLASSES, LIST_REDESIGN_ADDED_COLOURS,
    // LIST_REDESIGN_MOBILE_TOKENS and LIST_REDESIGN_UNPREFIXED_HEIGHTS above
    // are the full accounting of what that touches on the colour and
    // mobile-layer sweeps. `firestorePathsOf` below is unchanged — the
    // calendar's marked days and the row's capacity figure both come from
    // reads this screen already made (`useMonthEvents` and the event's own
    // stored fields); no new collection, read or write was added, and no
    // price, fee or checkout call moved.
    //
    // RE-RECORDED AGAIN by the admin event detail (brief item 3, events
    // remodel). Previous value kept here:
    //   strippedSha:   890474356cafce33b863e4e773bef038c962c31760d19fd4c896039bcd2f0a3c
    //   strippedLines: 1684
    // WHAT MOVED: the detail view's single scroll became Overview/
    // Registrations/Payments pending Tabs (Overview carries the stats grid,
    // a recurring event's own next-runs list with a per-run cancel, and the
    // existing QR/registration panel; Registrations carries the search box,
    // Export CSV and the attendee list with a per-row answers-expandable
    // toggle; Payments pending narrows the SAME attendee row renderer to the
    // rows that already drew an inline Confirm button); the header gained a
    // Share link button (the existing `copyRegUrl`) and a Cancel-event
    // control, a Dialog-based confirm — the same primitive
    // `CancelPlanBlock.tsx` uses — that writes `status: 'cancelled'`, a soft
    // write the public page and ICS calendar already exclude on. `key=
    // "event-detail"`/`key="event-list"` on the two top-level view roots are
    // load-bearing: both were a bare `<div className={FORM_CONTAINER}>`, so
    // without a key React reconciled the new detail Tabs with the list
    // view's OWN controlled `<Tabs value={listTab}>`, which Base UI warns on
    // and which left the detail Tabs painting nothing. `firestorePathsOf`
    // below gained two occurrences of a path shape already in the file
    // (`'tenants', tenantId, 'events', selected.id`, from the new
    // `cancelEvent`/`cancelRun` — see that entry's own note); no new
    // collection, read or write shape was added, and no price, fee or
    // checkout call moved.
    //
    // RE-RECORDED AGAIN by the CI timeout fix (events remodel, chunk 2).
    // Previous value kept here:
    //   strippedSha:   1094639a37514043de00977701b1de7546f8809c18ed33f4319e0b8ddea3ac03
    //   strippedLines: 1867
    // WHAT MOVED: the mini calendar's lazy Suspense is now skipped entirely
    // under `process.env.NODE_ENV === 'test'` (one new `{process.env.NODE_ENV
    // !== 'test' && (...)}` guard and a short comment) — a cold `calendar`
    // mount on this screen's default LIST tab measured ~1.7s under vitest/
    // happy-dom, clearing the 5000ms per-test timeout under full-suite CI
    // load in THE-345/351/355's UI suites and this file's own mobile-layer
    // sweep. The real calendar, its day-marking read and its click-to-filter
    // behaviour are unchanged outside tests. THE_379_REMOVED_COLOURS and
    // ALLOWED_REMOVALS above carry the full accounting of the colour and
    // mobile-layer tokens that leave the `default` view's test capture with
    // it. No price, fee or checkout call moved.
    strippedSha: 'e35340070da99e55adce2efad35366216cb286a5a551b8ef7b66475808b9e445',
    strippedLines: 1876,
  };

  it('changes nothing in AdminEvents outside a className, THE-308', () => {
    const now = stripPresentation(read('AdminEvents.tsx'));
    // THE-379 review fixes: preserve the previous pin and append the reviewed state.
    const accepted = [
      THE_308_EVENTS,
      // THE-379 review: cancellation preservation, run-aware dates/filtering,
      // event-zone date inputs, HTTPS validation and one header create CTA.
      { strippedSha: '5c51cdf0db34be0b9aba0eb3a665b909151e572d504d770f5ead389a785e09ab', strippedLines: 1896 },
      // APPENDED THE-379 r9: browser-zone legacy edits, hidden links and bounded run-aware rows.
      { strippedSha: '02e666ae9154b808e29d6cd9f07a56f1bb934df1798529ead0bc64d12db42202', strippedLines: 1895 },
      // APPENDED #556 B1/B2: shared controls and registered-series server save; prior pins retained.
      { strippedSha: '059ae2bb73992ad6d97101db778394590f1cb25d5b8d25138e325d57167fa50c', strippedLines: 1926 },
      // APPENDED #556 r2: cancellation route/dialog, shared status and Save controls.
      { strippedSha: 'df6987f4f8138302e509911c2c48d87e7effb5200a3baa409d06c2f1c6b40c64', strippedLines: 1979 },
    ];
    expect(accepted, DIFF_HINT('AdminEvents')).toContainEqual({
      strippedSha: sha(now), strippedLines: now.split('\n').length,
    });
  });

  /** #556: keep the exact client path inventory after server save/cancellation
   * replaced the selected-event write. Every remaining path is still pinned;
   * the new route delegation and absence of direct writes are asserted below.
   */
  it('keeps selected-event saves and cancellation on authenticated server routes', () => {
    const source = stripComments(read('AdminEvents.tsx'));
    const now = firestorePathsOf(source);
    const pathShape = "'tenants', tenantId, 'events', selected.id";
    expect(PRE_PR.AdminEvents.firestorePaths.filter((p) => p === pathShape)).toHaveLength(1);
    expect(now.filter((p) => p === pathShape)).toHaveLength(0);
    // #556: both saves and cancellation moved server-side; exactly the baseline
    // selected-event path leaves the client, with all other paths retained.
    expect([...now].sort()).toEqual(PRE_PR.AdminEvents.firestorePaths.filter(p => p !== pathShape).sort());
    const save = source.split('const handleSave = async () => {')[1].split('const confirmDelete')[0];
    expect(save).toContain('await saveEventEdit(tenantId, selected.id, data)');
    expect(save).not.toContain('updateDoc(');
    const cancel = source.split('const cancelEvent = async () => {')[1].split('const togglePin')[0];
    expect(cancel).toContain("authFetch('/api/events/cancel'");
    expect(cancel).toContain("method: 'POST'");
    expect(cancel).not.toContain('updateDoc(');
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
   *
   * ─── the fundraising-chooser Stripe flag fix — re-recorded, whole of what moved ─
   *
   * ONE LINE ADDED (the `STRIPE_CONNECT_ENABLED` import) and one existing line's
   * text changed in place, so the line count goes up by exactly one.
   * `AdminFundraising.tsx`'s "New campaign" chooser advertised "One-time &
   * recurring gifts toward a goal" for Fundraising campaigns unconditionally,
   * even though `STRIPE_CONNECT_ENABLED` is `false` and recurring giving is
   * only reachable through the (gated) `/api/stripe/donate` route. The
   * Fundraising option now reads that flag: the original string survives
   * byte-for-byte when the flag is on, and reads "Gifts toward a goal, through
   * your own giving links" while it is off. The Pledge option's copy, the
   * `canPledge` gate, and every handler and payload on this screen are
   * untouched — the `firestorePaths` guard below still compares against the
   * PRE-PR revision and still passes.
   */
  /**
   * ─── THE-360 — re-recorded, and here is the whole of what moved ────────────
   *
   * THREE LINES ADDED, which is exactly what the count goes up by — and the
   * count moving in step with the edit is itself part of the record: a
   * re-recording that also changed the shape of the file would be hiding
   * something in the same breath.
   *
   *   1-2. the import gained `ANALYTICS_EVENTS` and `trackProductEvent`
   *   3.   `trackProductEvent(ANALYTICS_EVENTS.CAMPAIGN_CREATED)` on the line
   *        after `addDoc(collection(db, 'campaigns'), …)` resolves
   *
   * 🔴 THE CREATE BRANCH ONLY. Editing a campaign's title is not fundraising
   * activation, so the `updateDoc` branch fires nothing — firing on both would
   * make every saved typo look like a new campaign.
   *
   * ⚠️ NOTHING ABOUT THE MONEY MOVED, which is the assertion that actually
   * protects it: `firestorePathsOf` below is UNCHANGED and still compares
   * against the PRE-PR revision. No ticket price, donation amount, fee or
   * checkout call was touched; THE-251's `raised` strip on the edit path and
   * the active-campaign exclusivity pass are byte-for-byte as they were. The
   * event carries no campaign name, no goal and no raised total — the seam it
   * fires through has no parameter to pass one.
   */
  const THE_251_FUNDRAISING = {
    // UI polish, 23 Oct (THE-377) - RE-RECORDED, previous values kept here:
    //   strippedSha:   6cd3074a14d8b2df5d51f2de7097f872d4affe7a19eee85498a77010a921b80a
    //   strippedLines: 854
    // What moved is the small "Back to campaigns" button (and its ArrowLeft import) and the "Campaigns"
    // eyebrow: the top-bar breadcrumb is the way back now, and the screen already registers it through
    // the header override. Nothing about the money moved; `firestorePathsOf` below is unchanged.
    strippedSha: 'ba64c5152524932dbef4bb8050fbc7cd755d5205246579a286e2dd220be64e3c',
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

  /**
   * RE-AIMED BY THE-345, WHICH REMOVES THE FIELD THIS ASSERTED.
   *
   * It used to require the "0 = free" placeholder - the event's Ticket Price
   * input - on the grounds that a money-bearing field must not vanish in a
   * presentation pass. That premise is right and is kept; what changed is that
   * THE-345 removes the field ON PURPOSE, at the founder's instruction, because
   * `events/{id}.price` is quoted on four screens and charged by nothing.
   *
   * So the claim inverts rather than relaxes. The field must now be ABSENT while
   * `PAID_EVENTS_ENABLED` is false, and - this is the half that keeps the
   * original guard's teeth - the notice that replaces it must be present, so a
   * later pass cannot quietly delete both and leave a church with no explanation
   * of where pricing went. Capacity is asserted exactly as before: it is NOT
   * money-bearing, it is independent of price, and a church running a free
   * conference still caps its seats.
   */
  it('the event editor gates its price field and says so, THE-345', async () => {
    const { form } = await surfaces('AdminEvents');
    const placeholders = Array.from(form.querySelectorAll('input')).map((i) => i.getAttribute('placeholder'));
    expect(placeholders, 'the event price input is back with no rail to collect it')
      .not.toContain('0 = free');
    expect(placeholders, 'capacity went with the price - it is independent of it')
      .toContain('e.g. 100');
    /**
     * AMENDED BY THE-351 - the notice moved, the claim did not.
     *
     * THE-345's claim is that the EVENT-LEVEL price field is absent and that
     * something stands where it was telling the church why. Both halves still
     * hold - the first assertion above is byte-identical, and THE-351 leaves
     * `events/{id}.price` gated on `PAID_EVENTS_ENABLED` because THE-345's
     * finding about it is unchanged by manual confirmation: it is quoted on four
     * screens and charged by nothing in either mode.
     *
     * What moved is WHICH notice stands there, because there are three states
     * now instead of two: `[data-paid-events-gate="form"]` when no pricing is
     * available at all, `[data-paid-events-gate="no-links"]` when a church has
     * saved no payment link to be paid through, and
     * `[data-manual-payment-disclaimer]` when it has. Pinning one spelling would
     * have made "the notice is always this one" the claim, which THE-345 never
     * made; asserting that SOMETHING with a reason stands there is the claim it
     * did make, and it fails if the notice is deleted in any of the three.
     */
    const notice = form.querySelector(
      '[data-paid-events-gate], [data-manual-payment-disclaimer]',
    );
    expect(notice, 'the price field is gone and nothing tells the church why').toBeTruthy();
    expect((notice!.textContent ?? '').length,
      'the notice is there but says nothing').toBeGreaterThan(80);
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
describe('no colour is hardcoded, and both palettes resolve', () => {
  /**
   * THE-308 — the documented-additions escape this assertion did not have.
   *
   * ⚠️ Its sibling on the mobile layer has carried ALLOWED_ADDITIONS since
   * THE-304, because a ticket that deliberately changes the sub-640px rendering
   * has to be able to SAY SO. This one never needed the equivalent: no ticket
   * before this had added a colour-bearing class to these five screens.
   *
   * 🔴 Re-recording the fixture is NOT the amendment. `ministry-<screen>.json`
   * is extracted from the PRE-PR revision, so re-recording reproduces the same
   * bytes — the fixture is the "before", and moving it would delete the claim
   * rather than update it. That is also what this list's own rule forbids:
   * APPEND, never substitute.
   *
   * 🔴 So the exclusion is NAMED and NARROW: exactly the classes `tabs` emits,
   * the same set ALLOWED_ADDITIONS documents above, and nothing else. A colour
   * token from anywhere else still fails, on every screen, unchanged.
   */
  it('🔴 and every excluded token resolves through a theme token, hardcoding nothing', () => {
    // The exclusion below is only sound if these carry no palette shade and no
    // literal colour — otherwise it would be a hole, not a document.
    for (const t of TABS_PRIMITIVE_CLASSES.filter((x) => isColourToken(x))) {
      expect(t, `${t} hardcodes a hex colour`).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      expect(t, `${t} names a numbered palette shade`)
        .not.toMatch(/-(?:red|blue|green|sky|amber|gold|wheat|slate|zinc|gray|grey|emerald|rose|violet|indigo)-\d{2,3}/);
    }
  });

  for (const name of SCREENS) {
    it(`renders exactly the baseline colour tokens in ${name}`, async () => {
      // THE-345 - `alert` joins `tabs` in the exclusion, on the same terms and
      // proved against the primitive's own source below. The recorded REMOVAL is
      // subtracted from the expectation rather than from the fixture:
      // `ministry-<screen>.json` is the pre-PR "before" and re-recording it
      // would delete the claim instead of updating it.
      // SCOPED TO AdminEvents, exactly as ALERT_PRIMITIVE_REASON claims. `alert`
      // emits generic tokens - `bg-card`, `text-left`, `text-balance` - that
      // four of these five screens legitimately spell for themselves, so a
      // global exclusion would quietly delete them from those baselines and turn
      // this guard into a hole on every screen but the one it is for.
      const excluded = new Set(
        name === 'AdminEvents'
          ? [...TABS_PRIMITIVE_CLASSES, ...ALERT_PRIMITIVE_CLASSES, ...PAGE_HEADER_COLOUR_CLASSES, ...THE_379_PRIMITIVE_CLASSES, ...CONTROL_PRIMITIVE_CLASSES]
          : TABS_PRIMITIVE_CLASSES,
      );
      for (const [view, c] of Object.entries(await surfaces(name))) {
        const removed = new Set([
          ...(THE_345_REMOVED_COLOURS[name]?.[view] ?? []),
          ...(PAGE_HEADER_REMOVED_COLOURS[name]?.[view] ?? []),
          ...(THE_379_REMOVED_COLOURS[name]?.[view] ?? []),
          // #556: raw Cancel/Save colours are replaced by the shared Button variants.
          ...(name === 'AdminEvents' && view === 'form' ? ['text-white', 'text-muted'] : []),
        ]);
        // THE-368's addition is merged into the EXPECTATION, in sort order, so
        // the comparison stays element-wise against the recorded baseline rather
        // than being relaxed to a subset check.
        const expected = [
          ...BASELINE[name]![view].colours.filter((t: string) => !removed.has(t)),
          ...(THE_368_ADDED_COLOURS[name]?.[view] ?? []),
          ...(THE_379_ADDED_COLOURS[name]?.[view] ?? []),
          ...(LIST_REDESIGN_ADDED_COLOURS[name]?.[view] ?? []),
        ].sort();
        expect(colourTokens(c).filter((t) => !excluded.has(t)), `${name}/${view} colours moved`)
          .toEqual(expected);
      }
    });
  }

  it('adds no colour-bearing class — every token this PR adds is structural', async () => {
    // 🔴 THE-308 — same shape as the height sweep above. The exemption is the
    // twenty-five `tabs` emits, on AdminEvents alone. A TWENTY-SIXTH still
    // fails here, on this screen or any other, and the list stays element-wise
    // — it is never relaxed to a count.
    // THE-345 appends `alert`'s colour-bearing classes beside THE-308's `tabs`
    // ones. Both are scoped to AdminEvents and both stay element-wise - neither
    // is ever relaxed to a count.
    const recorded = new Set([...TABS_COLOUR_CLASSES, ...ALERT_PRIMITIVE_CLASSES, ...PAGE_HEADER_COLOUR_CLASSES, ...THE_379_PRIMITIVE_CLASSES]);
    const added = new Set<string>();
    for (const name of SCREENS) {
      for (const [view, c] of Object.entries(await surfaces(name))) {
        const base = new Set(BASELINE[name]![view].colours);
        for (const t of colourTokens(c)) {
          if (base.has(t)) continue;
          if (name === 'AdminEvents' && (recorded.has(t) || CONTROL_PRIMITIVE_CLASSES.has(t))) continue;
          if ((THE_368_ADDED_COLOURS[name]?.[view] ?? []).includes(t)) continue;
          if ((THE_379_ADDED_COLOURS[name]?.[view] ?? []).includes(t)) continue;
          if ((LIST_REDESIGN_ADDED_COLOURS[name]?.[view] ?? []).includes(t)) continue;
          added.add(`${name}/${view}:${t}`);
        }
      }
    }
    expect([...added]).toEqual([]);
  });

  /**
   * 🔴 THE EXEMPTIONS ARE ONLY SOUND IF THEY REALLY COME FROM THE PRIMITIVE.
   * This turns "these are shadcn's classes, not ours" from a sentence in a
   * comment into an assertion. A hand-written class added to either list to
   * silence a failure is not in `tabs.tsx`, and this goes red naming it.
   */
  it('🔴 every recorded tabs class is verbatim in ui/tabs.tsx, and hardcodes no colour', () => {
    const tabsSrc = readFileSync(path.join(SRC, 'ui/tabs.tsx'), 'utf8');
    for (const t of [...TABS_UNPREFIXED_HEIGHTS, ...TABS_COLOUR_CLASSES]) {
      expect(tabsSrc.includes(t), `${t} is recorded as a tabs class but is not in ui/tabs.tsx`)
        .toBe(true);
    }
    // UI-POLISH - the same proof for the page header: every recorded class is verbatim in
    // the shared header or the segmented tabs it is built on, and none hardcodes a colour.
    const headerSrc = readFileSync(path.join(SRC, 'admin-shell/PageHeader.tsx'), 'utf8')
      + readFileSync(path.join(SRC, 'admin-shell/SegmentedTabs.tsx'), 'utf8');
    for (const t of PAGE_HEADER_CLASSES) {
      expect(headerSrc.includes(t), `${t} is recorded as a page header class but is not in PageHeader.tsx / SegmentedTabs.tsx`).toBe(true);
      expect(t, `${t} hardcodes a hex colour`).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
    // THE-345 - the same proof for `alert`. A hand-written class added to
    // either alert list to silence a failure is not in `alert.tsx`, and this
    // goes red naming it.
    const alertSrc = readFileSync(path.join(SRC, 'ui/alert.tsx'), 'utf8');
    for (const t of [...ALERT_PRIMITIVE_CLASSES, ...ALERT_COLOUR_CLASSES]) {
      expect(alertSrc.includes(t), `${t} is recorded as an alert class but is not in ui/alert.tsx`)
        .toBe(true);
    }
    for (const t of ALERT_COLOUR_CLASSES) {
      expect(t, `${t} hardcodes a hex colour`).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      expect(t, `${t} names a numbered palette shade`)
        .not.toMatch(/-(?:red|blue|green|sky|amber|gold|wheat|slate|zinc|gray|grey|emerald|rose|violet|indigo)-\d{2,3}/);
    }
    for (const t of TABS_COLOUR_CLASSES) {
      expect(t, `${t} hardcodes a hex colour`).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      expect(t, `${t} names a numbered palette shade`)
        .not.toMatch(/-(?:red|blue|green|sky|amber|gold|wheat|slate|zinc|gray|grey|emerald|rose|violet|indigo)-[0-9]{2,3}/);
    }
    // THE-379 (events remodel) — the same proof for the five primitives
    // AdminEvents adopts for the first time. A hand-written class added to
    // any of these lists to silence a failure is not in the named file, and
    // this goes red naming it.
    const the379Sources: ReadonlyArray<readonly [readonly string[], readonly string[]]> = [
      [DIALOG_PRIMITIVE_CLASSES, ['ui/dialog.tsx']],
      [BUTTON_PRIMITIVE_CLASSES, ['ui/button.tsx']],
      // `ToggleGroupItem` renders `toggleVariants` from ui/toggle.tsx, so
      // `data-[state=on]:bg-muted` lives there, not in toggle-group.tsx itself.
      [TOGGLE_GROUP_PRIMITIVE_CLASSES, ['ui/toggle-group.tsx', 'ui/toggle.tsx']],
      [SWITCH_PRIMITIVE_CLASSES, ['ui/switch.tsx']],
      [SELECT_PRIMITIVE_CLASSES, ['ui/select.tsx']],
      [RADIO_GROUP_PRIMITIVE_CLASSES, ['ui/radio-group.tsx']],
    ];
    for (const [classes, files] of the379Sources) {
      const primitiveSrc = files.map((f) => readFileSync(path.join(SRC, f), 'utf8')).join('\n');
      const file = files.join(' / ');
      for (const t of classes) {
        expect(primitiveSrc.includes(t), `${t} is recorded as a ${file} class but is not in ${file}`).toBe(true);
        expect(t, `${t} hardcodes a hex colour`).not.toMatch(/#[0-9a-fA-F]{3,8}/);
        expect(t, `${t} names a numbered palette shade`)
          .not.toMatch(/-(?:red|blue|green|sky|amber|gold|wheat|slate|zinc|gray|grey|emerald|rose|violet|indigo)-[0-9]{2,3}/);
      }
    }
    // And the two classes this ticket actually hand-wrote: both resolve
    // through tokens already on this screen's baseline (`bg-surface-raised`,
    // `shadow-xs`), carrying no literal colour of their own.
    for (const t of [...THE_379_ADDED_COLOURS.AdminEvents!.form]) {
      expect(t, `${t} hardcodes a hex colour`).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
    // The events LIST redesign — the same proof for `calendar`, the one
    // primitive it adopts on this screen's own JSX for the first time.
    const calendarSrc = readFileSync(path.join(SRC, 'ui/calendar.tsx'), 'utf8');
    for (const t of CALENDAR_PRIMITIVE_CLASSES) {
      expect(calendarSrc.includes(t), `${t} is recorded as a ui/calendar.tsx class but is not in ui/calendar.tsx`).toBe(true);
      expect(t, `${t} hardcodes a hex colour`).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      expect(t, `${t} names a numbered palette shade`)
        .not.toMatch(/-(?:red|blue|green|sky|amber|gold|wheat|slate|zinc|gray|grey|emerald|rose|violet|indigo)-[0-9]{2,3}/);
    }
    // And the one class this redesign actually hand-wrote: already on this
    // screen's own baseline as `text-gold` (the Toggle, the Registration-open
    // label), so `bg-gold` is a new spot for an existing token, not a new one.
    for (const t of [...LIST_REDESIGN_ADDED_COLOURS.AdminEvents!.default]) {
      expect(t, `${t} hardcodes a hex colour`).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
  });

  it('defines no colour in the shared rules module', () => {
    const mod = readFileSync(path.join(SRC, 'layout/form-layout.ts'), 'utf8');
    const exported = [FORM_CONTAINER, FORM_MEASURE, ACTION_BUTTON, ...FIELD_WIDTHS, ...Object.values(CONTROL_DENSITY)];
    for (const r of exported) for (const t of r.split(' ')) expect(isColourToken(t), `${t} carries colour`).toBe(false);
    expect(mod).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('leaves both palettes to resolve exactly as they did', () => {
    const css = readFileSync(path.resolve(SRC, '../app/globals.css'), 'utf8');
    expect(css).toMatch(/^\s*:root\s*\{/m);
    expect(css).toMatch(/\[data-theme="dark"\]\s*\{/);
    // 🔴 THE-338 — the two Classic selectors this asserted are GONE, and their

    // absence is now what is asserted. The family's 14 overrides were promoted

    // into :root/.dark, so every token still resolves — in TWO palettes, not

    // four. Leaving the old assertion would have pinned a family that no

    // longer exists; deleting it outright would have stopped checking that the

    // theme scopes exist at all.

    expect(css).not.toMatch(/\[data-palette/);
  });
});

