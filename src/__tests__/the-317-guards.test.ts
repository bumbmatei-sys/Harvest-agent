/**
 * THE-317 — the volunteer rota's boundaries.
 *
 * What this ticket must NOT have done, asserted by reading the source and the
 * repository rather than by trusting a description. The behaviour lives in
 * `src/components/events/__tests__/THE-317.volunteer-rota.test.tsx`; this file
 * is the fence around it.
 *
 * ⚠️ NOTHING IN THIS FILE ASKS WHAT THE CURRENT BRANCH CHANGED. There is no
 * no shelling out of any kind, and no git subcommand named even inside a failure
 * message — the sweep in section 16 is deliberately conservative and cannot tell
 * a mention from a call, so this file contains neither.
 * Three guards in two days blocked every unrelated PR in this repo by asserting
 * their own branch's diff in the non-empty direction — they are true only while
 * their ticket is unmerged, so the NEXT PR goes red for a reason that has
 * nothing to do with it. Section 16 asserts that absence directly, and
 * `THE-315.branch-diff-guards.test.ts` sweeps every suite in `src` for the
 * pattern besides.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Source with block and line comments stripped — the code, not the prose. */
const codeOf = (rel: string): string =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** The four files this ticket adds. */
const ADDED = [
  'src/components/events/volunteer-rota.ts',
  'src/components/events/VolunteerRotaView.tsx',
  'src/components/events/VolunteerRotaPanel.tsx',
  'src/hooks/queries/useVolunteerRotaQueries.ts',
] as const;

/** The one screen it edits. */
const EDITED = 'src/components/AdminEvents.tsx';

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });

const rel = (abs: string) => path.relative(REPO_ROOT, abs).split(path.sep).join('/');

/* ═══ 8 · 🔴 NOTHING IS SENT — NO EMAIL, NO SMS, NO NOTIFICATION ═══════════ */

describe('nothing is sent — no email, no SMS, no notification', () => {
  /**
   * 🔴 PART 3'S JOB, NOT THIS ONE'S. THE-314 shipped SMS and reported a send
   * interface for part 3 — invite, accept, remind — to call. This ticket
   * assigns people to items and writes a document. It does not tell anybody.
   *
   * ⚠️ The sweep is over MODULE SPECIFIERS AND CALL SITES, not over prose: a
   * comment that says "no SMS is sent" must not fail a guard whose point is
   * that no SMS is sent. So `codeOf` strips the comments first.
   */
  const SEND_MODULES = [
    '@/lib/sms-send', 'lib/sms-send', '@/lib/twilio', 'lib/twilio', 'nodemailer',
    'resend', '@sendgrid/mail', 'postmark', 'firebase/messaging', 'web-push',
  ];

  it.each(ADDED)('%s imports no send transport', (file) => {
    const code = codeOf(file);
    for (const mod of SEND_MODULES) {
      expect(code, `${file} imports ${mod}`).not.toMatch(
        new RegExp(`from ['"][^'"]*${mod.replace(/[/@.]/g, '\\$&')}['"]`),
      );
    }
  });

  it.each(ADDED)('%s calls nothing that sends', (file) => {
    const code = codeOf(file);
    const SENDS: [RegExp, string][] = [
      [/\bsendSms\b|\bsendSMS\b|\bsendMessage\b/, 'an SMS send'],
      [/\bsendEmail\b|\bsendMail\b|\bsendTemplate\b/, 'an email send'],
      [/\bnew Notification\b|\bshowNotification\b|\brequestPermission\b/, 'a browser notification'],
      [/\bnavigator\.share\b/, 'a share sheet'],
      [/\bfetch\s*\(|\baxios\b|\bXMLHttpRequest\b/, 'a network call'],
      [/\/api\/(?:sms|email|notify|broadcast)/, 'a send endpoint'],
    ];
    for (const [re, what] of SENDS) {
      expect(re.test(code), `${file} performs ${what}`).toBe(false);
    }
  });

  it('and the four new files import ONLY modules that already existed, from a closed list', () => {
    // 🔴 A WHITELIST, NOT A DENYLIST, and that is the stronger shape: a send
    // transport nobody thought to forbid still fails here, because it is simply
    // not on the list. THE-313's guard is the same assertion for part 1.
    //
    // ⚠️ `../../utils/notify` IS on it, deliberately. It raises a TOAST to the
    // admin who is standing at the screen when a write fails — a message to the
    // person doing the assigning, not to the person assigned. It performs no
    // network call at all, which the assertion below re-checks at its source.
    const allowed = [
      'react', 'lucide-react', 'firebase/firestore', '@tanstack/react-query',
      '../../utils/notify', '../layout/form-layout', './ServicePlanRow',
      './service-plan', './volunteer-rota', './VolunteerRotaView',
      '../../hooks/queries/useEventQueries', '../../hooks/queries/useVolunteerRotaQueries',
      './useServicePlanQueries', '../../components/events/service-plan',
      '@/components/ui/avatar', '@/components/ui/badge', '@/components/ui/button',
      '@/components/ui/card', '@/components/ui/empty', '@/components/ui/item',
      '@/components/ui/select', '@/components/ui/skeleton', '@/components/ui/table',
      '@/components/ui/tabs',
    ];
    for (const file of ADDED) {
      for (const spec of [...codeOf(file).matchAll(/from ['"]([^'"]+)['"]/g)].map((m) => m[1])) {
        expect(allowed, `${file} imports ${spec}, which is not on this ticket's list`).toContain(spec);
      }
    }
  });

  it('the only side effect of an assignment is a Firestore write and a cache invalidation', () => {
    const panel = codeOf('src/components/events/VolunteerRotaPanel.tsx');
    expect(panel).toContain('saveServicePlanItems');
    expect(panel).toContain('invalidateQueries');
    // `notifyError` is a TOAST on a failed write — a message to the admin who
    // is standing there, not a message to the volunteer. It sends nothing.
    expect(codeOf('src/utils/notify.ts')).not.toMatch(/fetch\s*\(|sendSms|sendEmail/);
  });
});

/* ═══ 9 · No Firestore orderBy where the timestamp field holds mixed types ═ */

describe('no Firestore orderBy is used where the timestamp field holds mixed types', () => {
  it('this feature adds NO orderBy at all', () => {
    // 🔴 The strongest form of the claim: not "no orderBy on a bad field" but
    // "no orderBy". Ordering is `rotaServices()`'s, in memory, which is the
    // pattern `query-helpers.ts` exists to make normal — and it is also what
    // keeps every query to ONE where() on ONE field, so no composite index is
    // required. `firestore.indexes.json` does not deploy, so one would be inert
    // and the query would throw `failed-precondition` in production.
    for (const file of ADDED) {
      expect(codeOf(file), `${file} uses orderBy`).not.toMatch(/\borderBy\s*\(/);
    }
  });

  it('and it never reads either collection whose timestamp field is mixed', () => {
    // `contactActivities.createdAt` and `invoices.issuedAt` each hold BOTH ISO
    // strings and Timestamps, and Firestore orders across types by TYPE FIRST —
    // so `orderBy('createdAt')` returns every string row before any Timestamp
    // row. Stable, and not chronological.
    for (const file of ADDED) {
      expect(codeOf(file), `${file} reads contactActivities`).not.toMatch(/contactActivities/);
      expect(codeOf(file), `${file} reads invoices`).not.toMatch(/'invoices'|"invoices"/);
    }
  });

  it('the ONE inherited orderBy is on events.startDate, which has a single writer and one type', () => {
    const events = codeOf('src/hooks/queries/useEventQueries.ts');
    expect(events).toContain("orderBy('startDate', 'desc')");
    // The writer: AdminEvents builds `startDate` from a Date, which the SDK
    // stores as a Timestamp. Nothing writes an ISO string to it.
    const writer = codeOf('src/components/AdminEvents.tsx');
    expect(writer, 'an ISO string reaches startDate').not.toMatch(/startDate:\s*[^,\n]*toISOString/);
    expect(writer, 'a raw string reaches startDate').not.toMatch(/startDate:\s*`/);
  });

  it('🔴 and EVENTS_READ_LIMIT agrees with the limit that read actually takes', () => {
    // The completeness proof depends on this number: a read returning exactly
    // the limit MIGHT be truncated, one returning fewer certainly is not. If
    // someone lowered `useEvents`' limit and this constant stayed, the rota
    // would call a truncated read complete and ship a wrong list of names.
    const declared = codeOf('src/hooks/queries/useVolunteerRotaQueries.ts')
      .match(/EVENTS_READ_LIMIT\s*=\s*(\d+)/);
    expect(declared, 'EVENTS_READ_LIMIT is not declared as a literal').toBeTruthy();
    const useEvents = codeOf('src/hooks/queries/useEventQueries.ts');
    const block = useEvents.slice(useEvents.indexOf('export const useEvents'));
    expect(block).toContain(`limit(${declared![1]})`);
  });
});

/* ═══ 10 · Only ONE timestamp representation is written ════════════════════ */

describe('only one timestamp representation is written', () => {
  it.each(ADDED)('%s never writes an ISO string, an epoch or a stringified date', (file) => {
    const code = codeOf(file);
    // ⚠️ The rota does compute with dates — it must, a rota is about time — so
    // this is not "no date arithmetic". It is that none of it reaches a
    // DOCUMENT. `getTime()` appears below only in sorts, comparisons and React
    // keys, never inside an object handed to a write.
    for (const bad of [/toISOString\s*\(/, /Date\.now\s*\(/, /new Date\(\)\.toString\s*\(/]) {
      expect(bad.test(code), `${file} produces a second timestamp representation`).toBe(false);
    }
  });

  it('this feature writes NO timestamp of its own — part 1\'s serverTimestamp() is the only one', () => {
    // 🔴 The rota's single write is `saveServicePlanItems`, which is part 1's.
    // Its `stamped()` sets `updatedAt: serverTimestamp()` and nothing here adds
    // a field of its own, so there is no second writer to disagree with it.
    for (const file of ADDED) {
      expect(codeOf(file), `${file} calls serverTimestamp directly`)
        .not.toMatch(/\bserverTimestamp\s*\(/);
      expect(codeOf(file), `${file} writes a timestamp field`)
        .not.toMatch(/\b(?:createdAt|updatedAt|assignedAt|servedAt)\s*:/);
    }
    expect(codeOf('src/hooks/queries/useServicePlanQueries.ts')).toContain('updatedAt: serverTimestamp()');
  });

  it('and no addDoc, setDoc, deleteDoc or updateDoc is spelled by this feature at all', () => {
    for (const file of ADDED) {
      for (const write of ['addDoc', 'setDoc', 'deleteDoc', 'updateDoc', 'writeBatch', 'runTransaction']) {
        expect(codeOf(file), `${file} writes with ${write}`).not.toMatch(new RegExp(`\\b${write}\\s*\\(`));
      }
    }
  });
});

/* ═══ 11 · #449's item shape and persisted data are UNCHANGED — pinned ═════ */

describe("#449's item shape and persisted data are unchanged", () => {
  /**
   * 🔴 A DIGEST OF PART 1'S TWO SOURCE FILES, AS OF f2837ca (#449) — WHICH IS
   * ALSO `origin/main` WHEN THIS BRANCH WAS CUT.
   *
   * ⚠️ Recorded as a LITERAL rather than read back from the same file, which
   * would compare a file against itself and pass whatever had happened to it.
   * If a later ticket legitimately changes part 1's shape, this value is
   * re-recorded THERE, in that ticket's own review — which is the point: a
   * migration on a shipped feature is its own decision, and this guard's job is
   * to make it one rather than letting it ride along inside a rota PR.
   */
  const PART_ONE = {
    'src/components/events/service-plan.ts':
      '7fa6435c635c8e374ab829659a944861c1daf7921b6c4cdf84e54c6333c2408d',
    'src/hooks/queries/useServicePlanQueries.ts':
      '37f36970629a5a7fb06e89abfcab907dcd7d7cf976adcd5fb399650b5f677b37',
  } as const;

  it.each(Object.entries(PART_ONE))('%s is byte-identical', (file, digest) => {
    expect(sha256(read(file)),
      `${file} moved since f2837ca (#449) — compare it against that commit to see what`).toBe(digest);
  });

  it('the item shape still has exactly the seven fields a rota keys on', () => {
    // A second, READABLE assertion beside the digest: a hash says "something
    // moved" and this says WHAT the rota depends on. Both are wanted — the
    // digest catches a change the list would not name, and the list explains a
    // digest failure without needing a diff to hand.
    const shape = codeOf('src/components/events/service-plan.ts');
    const iface = shape.slice(shape.indexOf('export interface ServicePlanItem'));
    const body = iface.slice(0, iface.indexOf('}'));
    expect([...body.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]).sort())
      .toEqual(['id', 'minutes', 'note', 'order', 'personId', 'personName', 'title']);
  });

  it('the rota adds NO field to a persisted item — it replaces two, by name', () => {
    const rota = codeOf('src/components/events/volunteer-rota.ts');
    const fn = rota.slice(rota.indexOf('export function assignPerson'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toContain('personId: person?.id ?? null');
    // ⚠️ Spread-then-override, so an item this feature never saw keeps every
    // field it arrived with — including one a LATER part 1 ticket might add.
    expect(fn).toContain('{ ...item,');
  });

  it('and part 1\'s own write is what reaches Firestore, unwrapped', () => {
    const panel = codeOf('src/components/events/VolunteerRotaPanel.tsx');
    expect(panel).toMatch(/saveServicePlanItems\(\s*tenantId,\s*planId,\s*plan\.name,\s*assignPerson\(/);
  });
});

/* ═══ 12 · No member is listed alongside a location ════════════════════════ */

describe('no member is listed alongside a location', () => {
  /**
   * 🔴 A PROPERTY OF THE TYPE, NOT A HABIT OF THE RENDERER.
   *
   * THE-283 made "never a person plus a place" a property of the dashboard's
   * types, and this ticket follows it: `RotaEvent` carries an id, a title and a
   * date, and no place field exists for anything to render. A rule a renderer
   * has to remember is one careless JSX expression from being broken; a field
   * that does not exist cannot be rendered by anybody.
   *
   * ⚠️ A rota names PEOPLE by necessity — that is the feature. What it must not
   * become is a directory, and the place is the line between the two.
   */
  const PLACE_FIELDS = ['location', 'isOnline', 'onlineLink', 'city', 'country', 'address', 'postcode', 'venue'];

  it.each(ADDED)('%s mentions no place field at all', (file) => {
    const code = codeOf(file);
    for (const field of PLACE_FIELDS) {
      expect(code, `${file} mentions ${field}`).not.toMatch(new RegExp(`\\b${field}\\b`, 'i'));
    }
  });

  it('the narrowing from Event to RotaEvent names its fields rather than spreading', () => {
    const rota = codeOf('src/components/events/volunteer-rota.ts');
    const fn = rota.slice(rota.indexOf('export const rotaEvent'));
    // From the RETURNED object literal, not from the parameter list: the
    // parameter names `event`, which is not a field of RotaEvent.
    const body = fn.slice(fn.indexOf('): RotaEvent => ({'), fn.indexOf('});'));
    // 🔴 No spread. A spread would carry `location` through the moment somebody
    // handed this a whole `Event`, silently, and the guard above would still
    // pass because the word would never appear in this file.
    expect(body, 'rotaEvent spreads the event').not.toContain('...');
    expect([...body.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort())
      .toEqual(['id', 'startsAt', 'title']);
  });

  it('and RotaEvent / RotaService declare no place field', () => {
    const rota = codeOf('src/components/events/volunteer-rota.ts');
    for (const name of ['RotaEvent', 'RotaService']) {
      const iface = rota.slice(rota.indexOf(`export interface ${name}`));
      const body = iface.slice(0, iface.indexOf('\n}'));
      const fields = [...body.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]);
      for (const field of PLACE_FIELDS) {
        expect(fields, `${name} carries ${field}`).not.toContain(field);
      }
    }
  });
});

/* ═══ 15 · No emoji, no hardcoded colour, no new token ═════════════════════ */

describe('no emoji is rendered and no colour is hardcoded', () => {
  it.each(ADDED)('%s contains no hex or rgb/hsl/oklch literal', (file) => {
    const code = codeOf(file);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/\b(?:rgba?|hsla?|oklch|oklab)\s*\(/);
  });

  it.each(ADDED)('%s renders no emoji', (file) => {
    // ⚠️ The CODE is scanned, not the file: these headers carry 🔴 and ⚠️ like
    // every other guard in this repo, and a comment is not a user-visible
    // surface. `·` and `—` are punctuation this codebase already uses in prose.
    const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;
    const found = codeOf(file).match(EMOJI);
    expect(found, `${file} renders ${found?.[0]}`).toBeNull();
  });

  it.each(ADDED)('%s defines no design token and reads no raw custom property', (file) => {
    expect(codeOf(file), `${file} defines a CSS custom property`).not.toMatch(/--[a-z][\w-]*\s*:/);
    expect(codeOf(file), `${file} reads a raw custom property`).not.toMatch(/var\(--/);
  });

  it('Classic is still the default palette family', async () => {
    const { DEFAULT_PALETTE_FAMILY } = await import('@/lib/theme');
    expect(DEFAULT_PALETTE_FAMILY).toBe('classic');
  });

  it('no width is invented — the container is form-layout.ts\'s', () => {
    // 🔴 The two widths this view DOES spell are a control's own minimum
    // (`w-[168px]` / `w-[184px]` on a select trigger) and the scroller's
    // `min-w-[420px]`, which is what MAKES the overflow rather than capping the
    // page. Neither is a page or form measure — those are Rule 1's, and the
    // screen that mounts the rota spends FORM_CONTAINER, unchanged.
    const view = codeOf('src/components/events/VolunteerRotaView.tsx');
    expect(view, 'the view invents a page measure').not.toMatch(/max-w-\[\d{4}px\]/);
    expect(view).toContain('CONTROL_DENSITY.control');
    expect(codeOf(EDITED)).toContain('FORM_CONTAINER');
  });
});

describe('no new token, component or dependency was added', () => {
  it('package.json is unchanged by this ticket', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    // ⚠️ PREMISE DRIFT, RECORDED: `date-fns` IS already a dependency of this
    // repo and is deliberately NOT on this list. The rota still does not use it
    // — `startOfWeek`/`addDays` are eight lines built from getFullYear/Month/
    // Date so they are DST-safe, and adopting a second date idiom for the second
    // date-shaped screen is how a codebase ends up with two. The assertion
    // records what is true rather than what was assumed.
    for (const name of ['dayjs', 'luxon', 'moment', 'rrule', 'react-big-calendar', 'uuid']) {
      expect(pkg.dependencies, `${name} was added`).not.toHaveProperty(name);
      expect(pkg.devDependencies, `${name} was added`).not.toHaveProperty(name);
    }
    // 🔴 And no Playwright. `browser-measure.ts` speaks CDP over the Chromium
    // already in CI, which is the whole reason it exists.
    expect(pkg.devDependencies).not.toHaveProperty('@playwright/test');
    expect(pkg.devDependencies).not.toHaveProperty('playwright');
    // And the rota reaches for none of it, date-fns included.
    for (const file of ADDED) {
      expect(codeOf(file), `${file} imports a date library`).not.toMatch(/from ['"]date-fns/);
    }
  });

  it('no primitive was added to src/components/ui, and none was edited', () => {
    // 🔴 The digests are `ds-primitives.test.tsx`'s to police; this asserts only
    // that the SET did not move — a rota that needed a new primitive would have
    // been a stop condition, and one that quietly edited an existing one would
    // change a digest that suite already pins.
    const digests = JSON.parse(
      read('src/components/ui/__tests__/__fixtures__/primitive-digests.json'),
    ) as Record<string, unknown>;
    const onDisk = readdirSync(path.join(REPO_ROOT, 'src/components/ui'))
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => `src/components/ui/${f}`)
      .sort();
    expect(onDisk).toEqual(Object.keys(digests).sort());
    for (const file of onDisk) {
      expect(sha256(read(file)), `${file} was edited`).toBe(digests[file]);
    }
  });

  it('every primitive the rota adopts is RECORDED in a closed adopter list', () => {
    // 🔴 APPENDED with ticket and reason, never substituted. `table` goes to
    // THE-272's list; `empty` and `item` to THE-274's RECORDED_ADOPTERS;
    // `skeleton` to THE-266's RECORDED_UI_ADOPTERS.
    //
    // ⚠️ THE-266's alias-only regex — which reported zero adopters for three of
    // its four components — was found INDEPENDENTLY by THE-316 (#457) and fixed
    // there first, with the same matcher and the same "record, do not exempt"
    // resolution this ticket had reached. THE-317 keeps that fix and its six
    // uncovered entries whole, and adds one: the rota's own `skeleton`.
    expect(read('src/__tests__/the-272-shadcn-batch-b.test.ts')).toContain('THE_317_TABLE_ADOPTERS');
    expect(read('src/__tests__/the-274-shadcn-batches-cde.test.ts')).toContain("ticket: 'THE-317'");
    const batchA = read('src/__tests__/the-266-shadcn-batch-a.test.ts');
    expect(batchA).toContain('RECORDED_UI_ADOPTERS');
    expect(batchA, 'the rota is not recorded as a skeleton adopter')
      .toContain("'src/components/events/VolunteerRotaView.tsx'");
    // 🔴 And the entries THE-316 uncovered are still there — a resolution that
    // dropped one would break its guard silently.
    for (const inherited of [
      'src/components/AdminAccounting.tsx', 'src/components/AdminDonations.tsx',
      'src/components/settings/SettingsAccordion.tsx', 'src/components/AdminDashboardHome.tsx',
      'src/components/dashboard/KpiCard.tsx', 'src/components/dashboard/WidgetFrame.tsx',
      'src/components/docs/DocsBreadcrumb.tsx',
    ]) {
      expect(batchA, `${inherited} was dropped from THE-266's adopter map`).toContain(inherited);
    }
  });
});

/* ═══ 16 · 🔴 NO GUARD IN THIS PR ASSERTS ANYTHING ABOUT THE BRANCH DIFF ═══ */

describe('no guard in this PR asserts anything about the current branch\'s diff', () => {
  /**
   * 🔴 THREE SUCH GUARDS BLOCKED EVERY UNRELATED PR IN THIS REPO IN TWO DAYS.
   *
   * All three shared one shape: an assertion about the current branch's diff in
   * the NON-EMPTY direction — "this suite is in the diff", "a course file was
   * changed". Each is TRUE on its own branch and FALSE for every branch after
   * it merges, so it passes in its own PR and nobody notices until the next
   * unrelated one goes red.
   *
   * ⚠️ AND THE TEMPTING FIX IS THE VACUOUS ONE. `THE-312.settings-freeze-
   * registers.test.tsx` records it around line 461: copying the neighbouring
   * escape hatch — "if this file is not in the diff, skip" — makes
   * `if (not in diff) return; expect(in diff)` vacuous BY CONSTRUCTION. A guard
   * that cannot fail is worse than the failure it replaces, because it looks
   * green while what it polices rots. The fixed shape is
   * `git cat-file -e <baseRef>:<path>`, which asks the BASE REF a question that
   * is independent of what the branch changed.
   *
   * 🔴 THIS TICKET NEEDS NEITHER, BECAUSE IT SWEEPS NOTHING. Every guard here
   * is a digest, a source read or a repository walk — all of them true on any
   * branch, before and after this merges. So the strongest thing to assert is
   * the plain absence, and that is what this does.
   */
  const SELF = 'src/__tests__/the-317-guards.test.ts';
  const OWN_TESTS = [
    SELF,
    'src/components/events/__tests__/THE-317.volunteer-rota.test.tsx',
    'src/components/__tests__/THE-317.volunteer-rota.layout.test.tsx',
  ];

  /**
   * ⚠️ THE NEEDLES ARE ASSEMBLED FROM FRAGMENTS, AND THAT IS NOT CLEVERNESS.
   *
   * This file is one of the files it checks, so a needle spelled as a literal
   * would be found in the check itself and the guard would fail on its own
   * source — which is the shape that makes people delete a guard rather than
   * fix it. Joining two halves at runtime keeps the literal off the page while
   * the string searched for is exactly the real one.
   *
   * 🔴 The join is asserted before it is trusted, so a typo cannot turn this
   * into a search for a string nothing could ever contain.
   */
  const needle = (a: string, b: string) => a + b;
  const SHELL_CALLS = [
    needle('execFile', 'Sync'), needle('exec', 'Sync'),
    needle('spawn', 'Sync'), needle('child_', 'process'),
  ];
  const GIT_SUBCOMMANDS = [
    needle('git ', 'diff'), needle('diff --', 'name-only'), needle('git ', 'show'),
    needle('rev-', 'parse'), needle('cat-', 'file'), needle('ls-', 'files'),
    needle('merge-', 'base'),
  ];

  it('🔴 the needles are proved against a file that DOES shell out to git', () => {
    // ⚠️ A POSITIVE CONTROL RATHER THAN AN ECHO OF THE LITERALS. Spelling the
    // needles out in a `toEqual` here would put them back in this file — the
    // very thing the fragments avoid — and would prove only that two halves
    // concatenate, which is not in doubt. What IS in doubt is whether the search
    // finds a real shell-out, so it is pointed at one: THE-315's suite calls git
    // deliberately, and every needle below must be found in it or the sweep that
    // follows could be green because it is looking for nothing.
    const shellsOut = codeOf('src/__tests__/THE-315.branch-diff-guards.test.ts');
    expect(SHELL_CALLS.filter((n) => shellsOut.includes(n)).length,
      'the shell-call needles find nothing in a file that shells out').toBeGreaterThanOrEqual(2);
    expect(GIT_SUBCOMMANDS.filter((n) => shellsOut.includes(n)).length,
      'the git needles find nothing in a file that calls git').toBeGreaterThanOrEqual(2);
    // And a NEGATIVE control, so the needles are not matching everything: a
    // module with no history in it trips none of them.
    const noHistory = codeOf('src/components/events/volunteer-rota.ts');
    expect([...SHELL_CALLS, ...GIT_SUBCOMMANDS].filter((n) => noHistory.includes(n))).toEqual([]);
  });

  it.each(OWN_TESTS)('%s shells out to nothing at all', (file) => {
    const code = codeOf(file);
    for (const call of SHELL_CALLS) {
      expect(code.includes(call), `${file} spells ${call}`).toBe(false);
    }
  });

  it.each(OWN_TESTS)('%s names no git subcommand', (file) => {
    const code = codeOf(file);
    for (const sub of GIT_SUBCOMMANDS) {
      expect(code.includes(sub), `${file} asks git for "${sub}"`).toBe(false);
    }
  });

  it('and THE-315\'s repo-wide sweep is present to catch a fourth occurrence', () => {
    // ⚠️ This ticket does not re-implement that sweep. #454 landed it over every
    // suite in `src`, so a branch-diff assertion added anywhere — including by
    // this PR — is caught there. Asserting its presence is how this file avoids
    // being a second, drifting copy of it.
    const sweep = read('src/__tests__/THE-315.branch-diff-guards.test.ts');
    expect(sweep).toContain('every branch-diff assertion is retired, base-ref-gated, or justified');
  });

  it('the guards here are true on any branch — they read files, not history', () => {
    const code = codeOf(SELF);
    // Every assertion's input is one of these three, all branch-independent.
    expect(code).toMatch(/readFileSync/);
    expect(code).toMatch(/sha256\(read\(/);
    expect(code, 'a guard here depends on process state').not.toMatch(/process\.env\.(?!TZ)/);
  });
});

/* ═══ 17 · firestore.rules and functions/ are byte-identical ═══════════════ */

describe('firestore.rules and functions/ are untouched', () => {
  /**
   * 🔴 `firestore.rules` AUTO-DEPLOYS TO PRODUCTION ON MERGE and CI runs no
   * emulator tests, so a rule written here reaches every church the moment this
   * lands with nothing having exercised it. This ticket does not touch it.
   */
  const RULES_SHA = 'a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499';

  it('firestore.rules is byte-identical', () => {
    expect(sha256(read('firestore.rules'))).toBe(RULES_SHA);
  });

  it('🔴 and the rule this feature NEEDS is pinned here, unwritten, for part 3 to deploy', () => {
    /**
     * ⚠️ IT IS THE SAME RULE #449 ALREADY REPORTED, UNCHANGED — this ticket
     * needs nothing added to it, which is worth saying rather than assuming.
     * The rota's read is an unfiltered LIST of the same collection
     * (`where('isTemplate','==',false)`) and neither half reads
     * `resource.data`, so a list is accepted as written; the write is part 1's
     * own `saveServicePlanItems` under `manageEvents`, which the admin doing
     * the rota already holds.
     *
     * It goes INSIDE `match /tenants/{tenantId}`, beside the existing `events`
     * block:
     *
     *     match /servicePlans/{planId} {
     *       allow read:  if belongsToTenant(tenantId);
     *       allow write: if hasPermission('manageEvents', tenantId);
     *     }
     *
     * 🔴 UNTIL IT DEPLOYS, EVERY READ IS `permission-denied` — and the rota
     * SAYS SO rather than rendering an empty week grid. That is section 4 of
     * the behaviour suite.
     */
    const rules = read('firestore.rules');
    expect(rules, 'the rule was written after all').not.toContain('servicePlans');
    // The two helpers it names must still exist, or the rule as reported is
    // wrong the day somebody pastes it in.
    expect(rules).toContain('function belongsToTenant(');
    expect(rules).toContain('function hasPermission(');
    // And the `events` block it sits beside is still there to sit beside.
    expect(rules).toMatch(/match \/events\/\{[\w]+\}/);
    // 🔴 No recursive match, which is why plans are ONE collection per tenant
    // and not a subcollection: a collection-group read here is DENIED outright.
    expect(rules, 'a recursive match appeared').not.toMatch(/\{path=\*\*\}/);
  });

  it('functions/ is byte-identical, file for file', () => {
    // ⚠️ Enumerated by walking the directory rather than by asking git what
    // changed — see section 16. A file ADDED to functions/ changes this digest
    // just as a file edited does, which a per-file list would not catch.
    const dir = path.join(REPO_ROOT, 'functions');
    const files: string[] = [];
    const walkAll = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name === 'lib') continue;
          walkAll(p);
        } else if (statSync(p).isFile()) files.push(p);
      }
    };
    walkAll(dir);
    const digest = sha256(
      files.sort().map((f) => `${rel(f)} ${sha256(readFileSync(f, 'utf8'))}`).join('\n'),
    );
    expect(files.length, 'functions/ lost or gained a file').toBe(5);
    expect(digest, 'run `git status functions/` to see what moved')
      .toBe('ec5906416bd88b42c7e19e317722db6508831414874a3a1bda6606f78983e3d7');
  });
});

/* ═══ The read cost, asserted rather than described ════════════════════════ */

describe('a rota spanning several weeks costs three reads, and does not grow with the horizon', () => {
  it('the plan read is ONE query: one where, one limit, no orderBy', () => {
    const queries = codeOf('src/hooks/queries/useVolunteerRotaQueries.ts');
    expect((queries.match(/getDocs\s*\(/g) ?? []).length,
      'the rota makes more than one read of its own').toBe(1);
    expect(queries).toContain("where('isTemplate', '==', false)");
    expect(queries).toContain('limit(ROTA_PLAN_LIMIT + 1)');
    expect(queries).not.toMatch(/\borderBy\s*\(/);
  });

  it('🔴 and it does NOT read one plan per event — that shape grows with the horizon', () => {
    const panel = codeOf('src/components/events/VolunteerRotaPanel.tsx');
    expect(panel, 'the panel calls part 1\'s per-event plan read')
      .not.toMatch(/\buseServicePlan\s*\(/);
    // Three hooks, and only three: events, plans, people.
    expect((panel.match(/\buse(?:Events|RotaPlans|ServicePeople)\s*\(/g) ?? []).sort())
      .toEqual(['useEvents(', 'useRotaPlans(', 'useServicePeople(']);
  });

  it('no collection-group read anywhere in the feature — the rules deny them outright', () => {
    for (const file of ADDED) {
      expect(codeOf(file), `${file} uses a collection-group read`)
        .not.toMatch(/collectionGroup\s*\(/);
      expect(codeOf(file), `${file} counts a subcollection per parent`)
        .not.toMatch(/getCountFromServer\s*\(/);
    }
  });

  it('and the people come from `users`, through part 1\'s own hook', () => {
    const queries = codeOf('src/hooks/queries/useVolunteerRotaQueries.ts');
    expect(queries).toContain('useServicePeople');
    // 🔴 Re-exported, not re-implemented: a rota that resolved names from
    // `contacts` while part 1 stored `users/{uid}` would show the wrong name for
    // anybody `mergeContactsWithUsers` folded — THE-299's ambiguity.
    expect(queries, 'the rota queries users itself').not.toMatch(/collection\(db,\s*'users'\)/);
    expect(codeOf('src/hooks/queries/useServicePlanQueries.ts')).toContain("collection(db, 'users')");
  });

  it('the whole feature is mounted by exactly the files that should mount it', () => {
    const mounts = walk(path.join(REPO_ROOT, 'src')).filter((f) => {
      if (f.includes(`${path.sep}__tests__${path.sep}`)) return false;
      if (rel(f).startsWith('src/components/events/VolunteerRota')) return false;
      return /VolunteerRota/.test(readFileSync(f, 'utf8'));
    });
    expect(mounts.map(rel)).toEqual([EDITED]);
  });
});
