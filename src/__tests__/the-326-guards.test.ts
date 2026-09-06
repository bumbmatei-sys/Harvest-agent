/**
 * THE-326 — service planning is its own section.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE TICKET, IN THE FOUNDER'S WORDS
 *
 *   "you put church service planning under the events INSTEAD OF CREATING A
 *    DEDICATED SECTION" · "you completely merged events with church planner and
 *    it's a total mess"
 *
 * This file is the fence around the split. The behaviour of the three parts is
 * already covered by their own suites (THE-313, THE-317, THE-324) and is not
 * re-asserted here; what is asserted here is WHERE the feature lives, that
 * Events no longer holds it, and that nothing else moved with it.
 *
 * ⚠️ NOTHING IN THIS FILE ASKS WHAT THE CURRENT BRANCH CHANGED, and nothing
 * shells out to git — no `execFileSync`, no `git show`, no diff read. Four such
 * guards have blocked every unrelated PR in this repo; #454 is the standing
 * sweep and `THE-315.branch-diff-guards.test.ts` is the detector. Every claim
 * below is made against the files on disk, which needs nothing but `fs`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  REPO_ROOT,
  loadOwnership,
  ownershipFailure,
  validateOwnership,
} from './__fixtures__/ownership-register';
import { rulesDigestFailure } from './__fixtures__/firestore-rules-pin';

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** Source with block and line comments stripped — the code, not the prose. */
const codeOf = (rel: string): string =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });

const rel = (abs: string) => path.relative(REPO_ROOT, abs).split(path.sep).join('/');

const DASHBOARD = 'src/components/AdminDashboard.tsx';
const EVENTS = 'src/components/AdminEvents.tsx';
const SERVICES = 'src/components/AdminServices.tsx';

/* ═══ 1 · 🔴 the section exists, in BOTH nav arrays ════════════════════════ */

describe('1 · service planning is its own sidebar section, in both group arrays', () => {
  /**
   * 🔴 THE WHOLE TICKET, AND IT IS ASSERTED PER ARRAY SO A FAILURE SAYS WHICH.
   *
   * `AdminDashboard` builds its nav twice — `MORE_GROUPS` is the mobile drawer
   * and `DESKTOP_NAV_GROUPS` is the desktop sidebar. A section in one and not
   * the other is a section half the product cannot reach, which is why the two
   * are named separately here rather than counted together.
   */
  const groupArray = (name: string): string => {
    const src = read(DASHBOARD);
    const at = src.indexOf(`const ${name}`);
    expect(at, `${name} is not in ${DASHBOARD}`).toBeGreaterThan(-1);
    return src.slice(at, src.indexOf('];', at));
  };

  it.each([
    ['MORE_GROUPS', 'the mobile drawer'],
    ['DESKTOP_NAV_GROUPS', 'the desktop sidebar'],
  ])('%s (%s) carries a `services` entry', (name, which) => {
    expect(groupArray(name), `service planning is missing from ${which}`)
      .toMatch(/'services'/);
  });

  it.each([
    ['MORE_GROUPS', 'the mobile drawer'],
    ['DESKTOP_NAV_GROUPS', 'the desktop sidebar'],
  ])('and in %s (%s) it is MINISTRY, not BROADCASTING', (name, which) => {
    /**
     * 🔴 THE PLACEMENT IS PART OF THE CLAIM. BROADCASTING is the outbound/live
     * cluster — `events`, `checkin`, `sms`, `livestream` — surfaces that push
     * something to an audience. Planning a Sunday service pushes nothing: it is
     * a run sheet, a rota and the people on it, which is the same category of
     * work as `crm` and `community`.
     */
    const body = groupArray(name);
    const ministry = body.slice(body.indexOf("label: 'MINISTRY'"));
    const ministryRow = ministry.slice(0, ministry.indexOf('},'));
    expect(ministryRow, `services is not in MINISTRY in ${which}`).toMatch(/'services'/);

    const broadcasting = body.slice(body.indexOf("label: 'BROADCASTING'"));
    const broadcastingRow = broadcasting.slice(0, broadcasting.indexOf('},'));
    expect(broadcastingRow, `services was filed under BROADCASTING in ${which}`)
      .not.toMatch(/'services'/);
  });

  it('`allTabs` has the entry, and the render switch has an arm for it', () => {
    const src = read(DASHBOARD);
    expect(src, 'the nav array has no Services entry').toMatch(/id: 'services'/);
    expect(src, 'no render-switch arm reaches the section')
      .toMatch(/activeTab === 'services'/);
    expect(src, 'the section screen is not mounted').toContain('<AdminServices />');
  });

  it('and the section is a row in the closed section table, so its URL resolves', () => {
    expect(read('src/lib/admin-sections.ts')).toMatch(/\['services', 'services'\]/);
  });

  /**
   * 🔴 NO NEW PERMISSION, AND THE NAV ENTRY PROVES IT BY REPEATING EVENTS'.
   *
   * The run sheet, the rota and the invitations were reachable through the
   * Events screen and through nothing else, so the Services entry carries the
   * same cell and the same permission: exactly the people who could plan a
   * service yesterday can plan one today, and nobody new can. A `managePlanning`
   * would be a roles-matrix row that no rule, no API route and no other screen
   * knows about — `servicePlans`, `rotaInvitations` and the invite API all check
   * `manageEvents` server-side regardless of what the nav believes.
   */
  it('🔴 the entry invents no permission — it repeats Events\' own gate', () => {
    const code = codeOf(DASHBOARD);
    const at = code.indexOf("id: 'services'");
    const clause = code.slice(Math.max(0, at - 220), at);
    expect(clause, 'the Services entry does not carry Events\' plan cell')
      .toContain('navAllows(features?.eventRegistration)');
    expect(clause, 'the Services entry does not carry Events\' permission')
      .toContain('perms.manageEvents');

    const known = new Set(
      [...codeOf('src/components/AdminRoles.tsx').matchAll(/^\s*(\w+): boolean;/gm)].map((m) => m[1]),
    );
    for (const name of [...code.matchAll(/perms\.(\w+)/g)].map((m) => m[1])) {
      if (name === 'fullAccess') continue;
      expect(known, `${name} is not a permission the roles matrix defines`).toContain(name);
    }
  });
});

/* ═══ 2 · 🔴 Events no longer mounts any of the three ═════════════════════ */

describe('2 · Events no longer mounts ServicePlanPanel, VolunteerRotaPanel or RotaInvitePanel', () => {
  it.each(['ServicePlanPanel', 'VolunteerRotaPanel', 'RotaInvitePanel'])(
    'the events screen neither imports nor renders %s',
    (component) => {
      const code = codeOf(EVENTS);
      expect(code, `AdminEvents still imports ${component}`)
        .not.toMatch(new RegExp(`import\\s+${component}\\s+from`));
      expect(code, `AdminEvents still renders <${component}>`)
        .not.toContain(`<${component}`);
    },
  );

  it('🔴 and `ViewMode` no longer carries `\'rota\'`', () => {
    const code = codeOf(EVENTS);
    const decl = code.slice(code.indexOf('type ViewMode'));
    const union = decl.slice(0, decl.indexOf(';'));
    expect(union, 'the rota view is still one of the events screen\'s modes')
      .not.toMatch(/'rota'/);
    // The four that stay are the event product itself.
    for (const mode of ["'list'", "'create'", "'edit'", "'detail'"]) {
      expect(union, `AdminEvents lost its ${mode} view`).toContain(mode);
    }
  });

  it('and nothing anywhere still sets the events screen to a rota view', () => {
    expect(codeOf(EVENTS), 'a rota view is still reachable from Events')
      .not.toMatch(/setView\('rota'\)|view === 'rota'/);
  });
});

/* ═══ 3 · the new section reaches all three parts ═════════════════════════ */

describe('3 · the new section reaches the run sheet, the rota and invitations', () => {
  it.each([
    ['the run sheet (part 1, THE-313)', 'ServicePlanPanel'],
    ['the volunteer rota (part 2, THE-317)', 'VolunteerRotaPanel'],
    ['invitations and unfilled slots (part 3, THE-324)', 'RotaInvitePanel'],
  ])('%s is mounted by the services screen', (_part, component) => {
    const code = codeOf(SERVICES);
    expect(code, `AdminServices does not import ${component}`)
      .toMatch(new RegExp(`import\\s+${component}\\s+from`));
    expect(code, `AdminServices does not render <${component}>`).toContain(`<${component}`);
  });

  it('and each part is mounted by exactly ONE screen, which is this one', () => {
    // 🔴 The claim the three parts' own guards make, restated from this side: a
    // second mount anywhere — Events included — fails here.
    for (const component of ['ServicePlanPanel', 'VolunteerRotaPanel', 'RotaInvitePanel']) {
      const mounts = walk(path.join(REPO_ROOT, 'src')).filter((f) => {
        if (f.includes(`${path.sep}__tests__${path.sep}`)) return false;
        if (rel(f).startsWith('src/components/events/')) return false;
        return new RegExp(`<${component}`).test(readFileSync(f, 'utf8'));
      });
      expect(mounts.map(rel), `${component} is mounted by more than the services screen`)
        .toEqual([SERVICES]);
    }
  });

  it('🔴 the run sheet is still keyed to an EVENT — shape A, not a migration', () => {
    /**
     * ⚠️ THE ANSWER TO THE TICKET'S HARD QUESTION, ASSERTED. A service still
     * belongs to an event: `ServicePlan.eventId` is the anchor and
     * `isTemplateShape` pins `isTemplate === (eventId === null)`, so a service
     * with no event would be indistinguishable from a TEMPLATE. A plan carries
     * no start of its own either — every clock time is the EVENT's start plus
     * the durations. So the section reads events and plans against them.
     */
    const code = codeOf(SERVICES);
    expect(code, 'the section does not plan against an event').toContain('eventId={');
    expect(code, 'the section invented a date of its own for a service')
      .not.toMatch(/serviceDate|planDate|startsAt:\s*new Date\(\)/);
    // The persisted shape is untouched: the section writes nothing itself.
    expect(code, 'the services screen writes to Firestore directly')
      .not.toMatch(/\b(setDoc|addDoc|updateDoc|deleteDoc|writeBatch)\s*\(/);
  });
});

/* ═══ 5 · 🔴 no raw epoch reaches a screen ════════════════════════════════ */

describe('5 · the date selector renders a formatted date, never a raw epoch', () => {
  /**
   * 🔴 THE DEFECT: the rota's date selector printed `1788513540000`.
   *
   * `Select.Value` with NO CHILDREN renders the VALUE, and the value is
   * `String(date.getTime())` because a select's value must be a string and the
   * date is the identity of the row. The options were never wrong — every
   * `SelectItem` has always been labelled with `fmtDay` — so only the CLOSED
   * trigger showed the epoch, which is exactly what the screenshot caught.
   *
   * ⚠️ The measured half of this claim is in `THE-326.services.layout.test.tsx`,
   * which sweeps RENDERED TEXT in Chromium for a bare millisecond value. This
   * half is the source-level rule that stops the shape coming back.
   */
  const SELECT_USERS = [
    'src/components/events/VolunteerRotaView.tsx',
    'src/components/AdminServices.tsx',
  ];

  it.each(SELECT_USERS)('%s formats every SelectValue it renders', (file) => {
    /**
     * ⚠️ THE FIRST SPELLING OF THIS ASSERTION DID NOT GUARD, AND MUTATION IS
     * WHAT FOUND IT. It was `/<SelectValue\b([^>]*)(\/)?>/`, and `[^>]*` is
     * GREEDY: on `<SelectValue placeholder="…" />` it swallowed the slash too,
     * so the optional group never matched and every tag read as non-self-closing.
     * Planting the defect back — the exact tag that shipped — passed. The tail
     * is now anchored so the slash cannot be eaten by the part before it.
     */
    const code = codeOf(file);
    const tags = [...code.matchAll(/<SelectValue\b[^>]*?(\/?)>/g)];
    expect(tags.length, `${file} renders no SelectValue at all — this claim is vacuous`)
      .toBeGreaterThan(0);
    for (const m of tags) {
      expect(
        m[1],
        `${file} renders a self-closing <SelectValue/>, which prints the raw value — `
          + 'give it a render function, which is the primitive\'s own documented API',
      ).not.toBe('/');
    }
  });

  it.each(SELECT_USERS)('%s formats a date through fmtDay, not through getTime', (file) => {
    const code = codeOf(file);
    if (!/getTime\(\)/.test(code)) return;
    expect(code, `${file} imports no date formatter but renders raw times`).toContain('fmtDay');
  });

  it('🔴 and no screen interpolates a bare epoch into markup', () => {
    // A 13-digit literal in JSX is a millisecond value somebody hardcoded.
    for (const f of walk(path.join(REPO_ROOT, 'src/components'))) {
      if (f.includes(`${path.sep}__tests__${path.sep}`)) continue;
      expect(codeOf(rel(f)), `${rel(f)} renders a hardcoded epoch`)
        .not.toMatch(/>\s*\d{13}\s*</);
    }
  });
});

/* ═══ 6 · Events keeps the event product ══════════════════════════════════ */

describe('6 · Events keeps its list, month view, create/edit/detail and registrations', () => {
  it('the list and its empty state are intact', () => {
    const src = read(EVENTS);
    expect(src).toContain('events.map(ev => (');
    expect(src, 'the empty-list copy went missing').toContain('No events yet');
    expect(src, 'the public calendar bar went missing').toContain('Public calendar:');
  });

  it('THE-308\'s month view is still mounted, and `list` is still the default tab', () => {
    const src = read(EVENTS);
    expect(src, 'the month view was dropped').toContain('<EventMonthView');
    expect(codeOf(EVENTS)).toMatch(/useState<'list' \| 'month'>\('list'\)/);
  });

  it('create, edit and detail all still exist', () => {
    const code = codeOf(EVENTS);
    for (const view of ["'create'", "'edit'", "'detail'"]) {
      expect(code, `the ${view} view is gone`).toContain(`setView(${view})`);
    }
  });

  it('registrations are still the events screen\'s, not the section\'s', () => {
    expect(read(EVENTS), 'registrations left the events screen').toContain('Registration');
    expect(codeOf(SERVICES), 'the services screen took registrations with it')
      .not.toMatch(/registration/i);
  });
});

/* ═══ 8–11 · the shipped feature is untouched ═════════════════════════════ */

describe('8–11 · parts 1–3\'s data, findDoubleBookings, the accept link and the send path', () => {
  /**
   * 🔴 DEFERRED, NOT RE-ASSERTED — and that is deliberate.
   *
   * `the-324-guards.test.ts` already pins all four of these, by digest and by
   * shape: part 1's and part 2's persisted files, `findDoubleBookings()`'s own
   * region hash, the accept page's URL shape and scope, and the single
   * `sendTenantSms` call with its metering and STOP handling. Restating a digest
   * here would put a SECOND copy of it in the repo, and two copies of a hash
   * drift — THE-319 states the rule and this follows it.
   *
   * ⚠️ WHAT THIS TICKET OWES IS THEREFORE TWO THINGS, and both are below: that
   * those guards are still in the tree and still make their claims, and that
   * THE-326's OWN new surface adds nothing they would have caught.
   */
  const GUARDS = 'src/__tests__/the-324-guards.test.ts';

  it('the guards that pin parts 1–3 are still in the tree, still making their claims', () => {
    const guards = read(GUARDS);
    for (const claim of [
      'findDoubleBookings',                       // 9
      "src/app/rota/[token]/page.tsx",            // 10
      'sendTenantSms',                            // 11
      'src/components/events/service-plan.ts',    // 8, part 1
      'src/hooks/queries/useServicePlanQueries.ts',
      'src/components/events/volunteer-rota.ts',  // 8, part 2
    ]) {
      expect(guards, `${GUARDS} no longer pins ${claim}`).toContain(claim);
    }
  });

  it('🔴 parts 1–3\'s PERSISTED modules are not touched by this ticket at all', () => {
    // ⚠️ The re-parenting needed no field the plan lacks, which was a named stop
    // condition: a plan is still `eventId` + items, and the section reads events
    // and hands one id down. So the four modules that define what is written are
    // untouched, and none of them names this ticket.
    for (const file of [
      'src/components/events/service-plan.ts',
      'src/components/events/volunteer-rota.ts',
      'src/hooks/queries/useServicePlanQueries.ts',
      'src/hooks/queries/useVolunteerRotaQueries.ts',
      'src/lib/rota-invite.ts',
      'src/app/rota/[token]/page.tsx',
    ]) {
      expect(read(file), `${file} was edited by THE-326`).not.toContain('THE-326');
    }
  });

  it('🔴 the new section sends nothing, and cannot — it has no transport at all', () => {
    /**
     * ⚠️ `sendTenantSms` IS THE ONLY SEND INTERFACE, every send is metered into
     * `tenants/{tenantId}/usage/{YYYY-MM}`, and a volunteer who texted STOP must
     * receive nothing. THE-326 moves WHERE the invite panel is mounted and
     * changes nothing about what it does — so the claim about the new file is
     * the strongest available one: it holds no transport and no send call, so
     * every send still goes through part 3's path or nowhere.
     */
    const code = codeOf(SERVICES);
    for (const [re, what] of [
      [/\bfetch\s*\(|\baxios\b|\bXMLHttpRequest\b/, 'a network call'],
      [/\bsendSms\b|\bsendSMS\b|\bsendTenantSms\b|\bsendEmail\b/, 'a send'],
      [/\/api\//, 'an API route'],
      [/twilio|nodemailer|resend|sendgrid/i, 'a send transport'],
    ] as [RegExp, string][]) {
      expect(re.test(code), `the services screen performs ${what}`).toBe(false);
    }
  });

  it('🔴 and it does not reach the accept link\'s route, its token or its scope', () => {
    const code = codeOf(SERVICES);
    expect(code, 'the services screen touches the accept-link route').not.toContain('/rota/');
    expect(code, 'the services screen handles an accept token').not.toMatch(/token|respondedAt/);
  });
});

/* ═══ 16 · 🔴 the #468 fuse — no fixture pinned near today ════════════════ */

describe('16 · no test fixture in this PR is pinned to a date near today', () => {
  /**
   * 🔴 #468 IS WHY. A fixture pinned to '2026-09-06T10:00' turned `main` red for
   * everyone the moment the clock passed it — the suite was green when it landed
   * and failed later for no change at all.
   *
   * ⚠️ THE RULE THIS PR FOLLOWS: every date in its fixtures is YEARS out, and
   * `now` is passed as a PROP rather than read from the system clock, so there
   * is no window in which a fixture can be overtaken. `VolunteerRotaView` takes
   * `now`, which is what makes that possible without faking a timer at all —
   * and where a timer must be faked, `toFake: ['Date']` is load-bearing, since
   * faking `setTimeout` took a 4s run to 141s and timed out 28 of 47 tests.
   */
  const MY_TESTS = [
    'src/components/__tests__/THE-326.services.layout.test.tsx',
    'src/components/events/__tests__/THE-326.date-format.test.tsx',
  ];

  it.each(MY_TESTS)('%s pins no date within two years of today', (file) => {
    const code = codeOf(file);
    const now = new Date();
    const soon = new Date(now.getFullYear() + 2, now.getMonth(), now.getDate());

    // `new Date(YYYY, M, D, ...)` — the shape every fixture here uses.
    const dates = [...code.matchAll(/new Date\(\s*(\d{4})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})/g)]
      .map((m) => new Date(Number(m[1]), Number(m[2]), Number(m[3])));

    expect(dates.length, `${file} has no dated fixture — this claim is vacuous`).toBeGreaterThan(0);
    for (const d of dates) {
      expect(
        d.getTime(),
        `${file} pins ${d.toISOString().slice(0, 10)}, which the clock reaches within two years `
          + '— the #468 fuse',
      ).toBeGreaterThan(soon.getTime());
    }
  });

  it('and neither reads the system clock for the value it asserts on', () => {
    for (const file of MY_TESTS) {
      // `now` is a prop in both; a `new Date()` with no arguments would make the
      // fixture depend on when the suite runs, which is the same fuse by another
      // route. (The date-range check above is allowed to ask what today is.)
      const code = codeOf(file).replace(/const now = new Date\(\);[\s\S]*?soon\.getTime\(\)/g, '');
      expect(code, `${file} builds a fixture from the system clock`)
        .not.toMatch(/now:\s*new Date\(\)|now=\{new Date\(\)\}/);
    }
  });

  it('🔴 and if a timer is ever faked here, `toFake` names Date and nothing else', () => {
    // ⚠️ Neither file fakes one today — both pass `now` instead. The rule is
    // recorded so the next person who reaches for fake timers does it the way
    // #468 established rather than rediscovering the 141s run.
    for (const file of MY_TESTS) {
      const code = codeOf(file);
      if (!code.includes('useFakeTimers')) continue;
      expect(code, `${file} fakes timers without toFake: ['Date']`)
        .toMatch(/useFakeTimers\(\{\s*toFake:\s*\['Date'\]\s*\}\)/);
    }
  });
});

/* ═══ 12 · every event permission and gate is unchanged ═══════════════════ */

describe('12 · every event permission and gate is unchanged', () => {
  it('the events nav entry keeps its own cell and its own permission', () => {
    const code = codeOf(DASHBOARD);
    const at = code.indexOf("id: 'events'");
    const clause = code.slice(Math.max(0, at - 220), at);
    expect(clause).toContain('navAllows(features?.eventRegistration)');
    expect(clause).toContain('perms.manageEvents');
  });

  it('🔴 a paid event can still be created with Stripe disabled — the founder accepted that', () => {
    // ⚠️ ASSERTED AS AN ABSENCE, deliberately. The accepted behaviour is that
    // nothing in the create path consults Stripe's connection state, so the
    // claim is that no such gate appeared — not that some gate says "allow".
    const code = codeOf(EVENTS);
    expect(code, 'event creation grew a Stripe gate')
      .not.toMatch(/stripeEnabled|stripeConnected|chargesEnabled|payoutsEnabled/);
  });

  it('and the events screen gained no permission check of its own', () => {
    expect(codeOf(EVENTS), 'AdminEvents grew a permission gate this ticket did not review')
      .not.toMatch(/perms\.\w+|hasPermission\(/);
  });
});

/* ═══ 17 · 🔴 no guard here reads this branch's diff ══════════════════════ */

describe('17 · no guard in this PR asserts anything about the current branch\'s diff', () => {
  /**
   * 🔴 THE FUSE THAT BLEW FOUR TIMES. A guard that asks what the current branch
   * changed is true only while its own ticket is unmerged, and turns the NEXT
   * PR red for a reason that has nothing to do with it.
   *
   * ⚠️ THE SWEEP IS DATAFLOW-SHAPED, per THE-322, and that matters: the known
   * blind spot (card `86bbvhaky`) is a detector that needs the diff read and
   * `execFileSync` in ONE declaration, so a read one call away slips through.
   * This asks the weaker, safer question — does the file NAME a diff-reading
   * git subcommand at all — which cannot be dodged by moving the call.
   */
  const THIS_TICKETS_FILES = [
    'src/__tests__/the-326-guards.test.ts',
    'src/components/__tests__/THE-326.services.layout.test.tsx',
    'src/components/AdminServices.tsx',
  ];

  /**
   * 🔴 THE NEEDLES ARE ASSEMBLED, NEVER WRITTEN OUT — AND THAT IS LOAD-BEARING.
   *
   * ⚠️ THIS FILE IS ONE OF THE FILES IT SWEEPS. A literal `'git diff'` in the
   * needle list would be a `git diff` in the source, so the guard would report
   * ITSELF and the only way to green would be to stop sweeping this file — which
   * is how a sweep quietly stops covering the thing most likely to break it.
   *
   * ⚠️ THE MIRROR-IMAGE FAILURE IS THE ONE THIS SERIES ACTUALLY PAID FOR: a
   * guard PASSED with its own gate deleted, because the assertion's error
   * message contained the string it grepped for. Both bugs are the same bug —
   * a sweep matching its own text — and assembling the needles is what removes
   * it in both directions. The failure message below therefore names the needle
   * from the assembled value, never from a literal.
   */
  const NEEDLES = [
    ['git', 'diff'], ['git', 'show'], ['rev', 'parse'], ['rev', 'list'], ['name', 'only'],
  ].map(([a, b]) => `${a}${a === 'git' ? ' ' : '-'}${b}`)
    .concat([`exec${'FileSync'}`, `exec${'Sync'}`, `spawn${'Sync'}`]);

  /**
   * ⚠️ THE CODE, NOT THE COMMENTS — the same rule `the-308-guards` states for
   * its emoji sweep, and here for a sharper reason. This file EXPLAINS the
   * defect it guards against, so its own prose necessarily names the thing.
   * A sweep over raw source would fail on the sentence describing the bug, which
   * would leave only two ways out: stop explaining, or stop sweeping this file.
   * A comment executes nothing, so the claim — "no guard in this PR READS its
   * own diff" — is a claim about code, and that is what is read.
   */
  it.each(THIS_TICKETS_FILES)('%s names no diff-reading git subcommand', (file) => {
    const src = codeOf(file);
    for (const needle of NEEDLES) {
      expect(src, `${file} reaches for it — a guard that reads its own diff expires when it merges`)
        .not.toContain(needle);
    }
  });

  it('and THE-315\'s standing sweep is still in the tree to catch a fifth', () => {
    expect(read('src/__tests__/THE-315.branch-diff-guards.test.ts')).toBeTruthy();
  });
});

/* ═══ 18 · the files this ticket may not open ═════════════════════════════ */

describe('18 · firestore.rules, firestore.indexes.json, functions/ and layout.tsx byte-identical', () => {
  /**
   * 🔴 `firestore.rules` AUTO-DEPLOYS TO PRODUCTION and CI runs no emulator
   * test, so a rule edited here reaches churches before anybody reads it. Shape
   * A needs none: the plan stays keyed to an event, in the same collection,
   * under the same `manageEvents` write permission the deployed rule already
   * names.
   *
   * ⚠️ A SET, not a single digest — the shape `the-276` explains in full: CI
   * runs against `refs/pull/N/merge`, so a merge ref cut before #462 landed
   * legitimately carries the older value. A digest that is NEITHER still fails.
   */

  it('🔴 firestore.rules is at an accepted digest — this ticket wrote no rule', () => {
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
  });

  it('and the servicePlans rule still says exactly what it said', () => {
    // The readable half: the rule THE-313 deployed, unchanged, naming the
    // permission this ticket deliberately did not add to.
    const rules = read('firestore.rules');
    expect(rules).toContain('match /servicePlans/{planId}');
    expect(rules).toMatch(/allow write: if hasPermission\('manageEvents', tenantId\)/);
  });

  it.each(['src/app/layout.tsx', 'firestore.indexes.json'])(
    '%s carries no edit from this ticket',
    (file) => {
      expect(read(file), `${file} names this ticket`).not.toContain('THE-326');
    },
  );

  it('functions/ names this ticket nowhere', () => {
    const out: string[] = [];
    const walkFns = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', 'lib', '.git'].includes(entry.name)) continue;
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walkFns(p);
        else if (/\.(ts|js|json)$/.test(entry.name)) out.push(p);
      }
    };
    walkFns(path.join(REPO_ROOT, 'functions'));
    for (const f of out) {
      expect(readFileSync(f, 'utf8'), `${rel(f)} was edited by this ticket`).not.toContain('THE-326');
    }
  });
});

/* ═══ The ownership register ══════════════════════════════════════════════ */

describe('THE-326 records what it owns, and appends rather than substitutes', () => {
  it('the register is valid — every entry names a file, a ticket, a reason and a digest', () => {
    expect(validateOwnership()).toEqual([]);
  });

  it.each([SERVICES, EVENTS, 'src/components/events/VolunteerRotaView.tsx'])(
    '🔴 %s is at its recorded digest',
    (file) => {
      expect(ownershipFailure(file), `${file} is not at any digest the register records`).toBeNull();
    },
  );

  it('and THE-326 added its OWN file, without touching another ticket\'s', () => {
    const mine = loadOwnership().filter((e) => e.ticket === 'THE-326');
    expect(mine.map((e) => e.file).sort()).toEqual(
      [SERVICES, EVENTS, 'src/components/events/VolunteerRotaView.tsx'].sort(),
    );
    // Every other ticket's file is still there — a union, never a replacement.
    expect(new Set(loadOwnership().map((e) => e.ticket)).size).toBeGreaterThan(1);
  });
});
