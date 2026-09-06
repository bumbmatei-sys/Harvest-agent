import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
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
const stripPresentation = (src: string): string =>
  unwrapRota(unwrapServicePlan(unwrapSmsGate(unwrapRotaInvite(src))))
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
  'colour-bearing one resolves through a theme token, so all four palettes hold.';

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
 * THE-308 — the TWENTY-FIVE colour-bearing classes `tabs` emits.
 *
 * Same provenance and the same proof as the heights above: every one appears
 * verbatim in `ui/tabs.tsx`, whose digest is pinned byte-identical to `main` in
 * `the-308-guards.test.ts`, and none is spelled by this ticket.
 *
 * 🔴 EVERY ONE RESOLVES THROUGH A THEME TOKEN — `bg-muted`, `text-foreground`,
 * `ring-ring/50`, `bg-input/30` — so all four palettes still resolve and
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
    // 🔴 THE-308 — the ONLY exemption is `tabs`' own four, on the ONE screen
    // that adopts it, recorded and provenance-checked above. Every other
    // screen, and every other token, is asserted exactly as before: a FIFTH
    // unprefixed height from `tabs`, or ANY from anywhere else, still fails.
    const recorded = new Set(TABS_UNPREFIXED_HEIGHTS);
    for (const name of SCREENS) {
      for (const [view, c] of Object.entries(await surfaces(name))) {
        const base = new Set(BASELINE[name]![view].mobileLayer.flatMap((l) => l.split('\t')[2]?.split(' ') ?? []));
        for (const t of allTokens(c).filter((t) => /(?:^|:)h-/.test(t) && !isResponsive(t))) {
          if (name === 'AdminEvents' && recorded.has(t)) continue;
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
  const THE_308_EVENTS = {
    strippedSha: '78b5eee8c919f1ae379ab35a8a6443af169cae028420f5a0511cffec699e1f6d',
    strippedLines: 935,
  };

  it('changes nothing in AdminEvents outside a className, THE-308', () => {
    const now = stripPresentation(read('AdminEvents.tsx'));
    expect(now.split('\n').length, DIFF_HINT('AdminEvents')).toBe(THE_308_EVENTS.strippedLines);
    expect(sha(now), DIFF_HINT('AdminEvents')).toBe(THE_308_EVENTS.strippedSha);
  });

  it('🔴 adds no Firestore WRITE to AdminEvents — the month view only reads', () => {
    // Pinned against the PRE-PR revision. The month grid reads
    // `tenants/{id}/events`, a path this screen ALREADY reads for the list, so
    // the set is unchanged — and a new collection, or a write, would appear
    // here. THE-251 names this as the guard that protects the money;
    // AdminEvents had none until this ticket.
    expect(firestorePathsOf(read('AdminEvents.tsx'))).toEqual(PRE_PR.AdminEvents.firestorePaths);
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
      const excluded = new Set(TABS_PRIMITIVE_CLASSES);
      for (const [view, c] of Object.entries(await surfaces(name))) {
        expect(colourTokens(c).filter((t) => !excluded.has(t)), `${name}/${view} colours moved`)
          .toEqual(BASELINE[name]![view].colours);
      }
    });
  }

  it('adds no colour-bearing class — every token this PR adds is structural', async () => {
    // 🔴 THE-308 — same shape as the height sweep above. The exemption is the
    // twenty-five `tabs` emits, on AdminEvents alone. A TWENTY-SIXTH still
    // fails here, on this screen or any other, and the list stays element-wise
    // — it is never relaxed to a count.
    const recorded = new Set(TABS_COLOUR_CLASSES);
    const added = new Set<string>();
    for (const name of SCREENS) {
      for (const [view, c] of Object.entries(await surfaces(name))) {
        const base = new Set(BASELINE[name]![view].colours);
        for (const t of colourTokens(c)) {
          if (base.has(t)) continue;
          if (name === 'AdminEvents' && recorded.has(t)) continue;
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
    for (const t of TABS_COLOUR_CLASSES) {
      expect(t, `${t} hardcodes a hex colour`).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      expect(t, `${t} names a numbered palette shade`)
        .not.toMatch(/-(?:red|blue|green|sky|amber|gold|wheat|slate|zinc|gray|grey|emerald|rose|violet|indigo)-[0-9]{2,3}/);
    }
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

