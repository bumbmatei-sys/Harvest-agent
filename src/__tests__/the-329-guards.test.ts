/**
 * THE-329 — a service is its own thing, and no longer needs an event.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE TICKET, IN THE FOUNDER'S WORDS
 *
 *   "If I have no event created, I cannot create any service, which is stupid.
 *    I need to be able to create services from the service tab. Right now, the
 *    only service that I can schedule is the event that I created in the event
 *    tab, which is another feature."
 *
 * The BEHAVIOUR of the change is asserted by
 * `src/components/events/__tests__/THE-329.standalone-service.test.tsx`, and the
 * MEASUREMENTS by `src/components/__tests__/THE-329.services.layout.test.tsx`.
 * This file is the fence: what did not move, what may never move, and the rules
 * about reads and colour and dates that a new surface has to keep.
 *
 * ⚠️ NOTHING IN THIS FILE ASKS WHAT THE CURRENT BRANCH CHANGED, and nothing
 * shells out. There is no child-process import, no version-control invocation
 * and no diff read anywhere in this ticket's tests. Four such guards have
 * blocked every unrelated PR in this repo; #454 is the standing sweep and
 * `THE-315.branch-diff-guards.test.ts` is the detector. Every claim below is
 * made against the files on disk, which needs nothing but `fs`.
 *
 * 🔴 SECTION 19 ASSERTS THAT ABOUT THIS FILE TOO, AND ITS NEEDLES ARE ASSEMBLED
 * FROM FRAGMENTS AT RUN TIME RATHER THAN WRITTEN AS LITERALS. That is not
 * cleverness, it is the fix for a failure this repo has already had: a guard
 * passed with its own gate DELETED because the assertion's own message contained
 * the string it grepped for. A guard that would fail on itself if it were
 * spelled plainly is a guard that cannot be trusted about anything else.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

import { REPO_ROOT, loadOwnership, ownershipFailure } from './__fixtures__/ownership-register';
import { rulesDigestFailure } from './__fixtures__/firestore-rules-pin';

const sha256 = (t: string | Buffer): string => createHash('sha256').update(t).digest('hex');
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

/** The one production file this ticket ADDS. The list is the claim. */
const ADDED = ['src/components/events/ServiceCreateForm.tsx'] as const;

/** The production files it EDITS. */
const EDITED = [
  'src/components/AdminServices.tsx',
  'src/components/events/ServicePlanPanel.tsx',
  'src/components/events/service-plan.ts',
  'src/components/events/volunteer-rota.ts',
  'src/components/events/VolunteerRotaPanel.tsx',
  'src/components/events/VolunteerRotaView.tsx',
  'src/components/events/RotaInvitePanel.tsx',
  'src/components/events/rota-invitations.ts',
  'src/hooks/queries/useServicePlanQueries.ts',
  'src/app/api/rota/invitations/route.ts',
] as const;

const SERVICES = 'src/components/AdminServices.tsx';
const FORM = 'src/components/events/ServiceCreateForm.tsx';
const SHAPE = 'src/components/events/service-plan.ts';
const QUERIES = 'src/hooks/queries/useServicePlanQueries.ts';
const ROTA = 'src/components/events/volunteer-rota.ts';

/* ═══ 8 · 🔴 findDoubleBookings() IS BYTE-IDENTICAL ═══════════════════════ */

describe('8 · findDoubleBookings() is byte-identical', () => {
  /**
   * 🔴 THE SAME REGION AND THE SAME DIGEST `the-324-guards.test.ts` PINS, and
   * that repetition is deliberate rather than an oversight: this ticket EDITS
   * `service-plan.ts`, which is the file that function lives in, so the claim
   * "I did not touch it" has to be made HERE, in the PR that touched the file
   * around it. The value is the literal #458 recorded and #460 re-read.
   */
  const body = (): string => {
    const src = read(SHAPE);
    const from = src.indexOf('export function findDoubleBookings');
    expect(from, 'findDoubleBookings is GONE from service-plan.ts').toBeGreaterThan(-1);
    const to = src.indexOf('\n}\n', from) + 3;
    return src.slice(from, to);
  };

  it('🔴 the function body has not moved by one byte', () => {
    expect(sha256(body()), 'findDoubleBookings changed — part 2 calls it and part 1 owns it')
      .toBe('32a88406a033ce6604e3ac3a2eb1056e936ed6509c8a7d7d2ddecd887cce3372');
  });

  it('and it is still the ONE overlap rule — nothing here re-derives another', () => {
    for (const file of [...ADDED, SERVICES]) {
      expect(codeOf(file), `${file} re-derives an overlap rule`)
        .not.toMatch(/\bfindDoubleBookings\b|\bDoubleBooking\b/);
    }
    expect(codeOf(ROTA), 'part 2 stopped delegating the overlap rule')
      .toContain('findDoubleBookings(scheduled)');
  });

  it('🔴 and the item shape STILL has exactly the seven fields a rota keys on', () => {
    // A readable claim beside the digest: the plan gained a field, the ITEM did
    // not, and the rota keys on `(planId, itemId)` over these seven.
    const iface = codeOf(SHAPE).slice(codeOf(SHAPE).indexOf('export interface ServicePlanItem'));
    const fields = iface.slice(0, iface.indexOf('}'));
    expect([...fields.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]).sort())
      .toEqual(['id', 'minutes', 'note', 'order', 'personId', 'personName', 'title']);
  });
});

/* ═══ 9 · 🔴 A FAILED READ IS A FAILURE, NEVER "nothing scheduled" ════════ */

describe('9 · a failed read shows a failure, never "nothing scheduled"', () => {
  /**
   * 🔴 THE SILENT-FAILURE RULE: "A default value that hides an error is a bug…
   * each converts a loud failure into a quiet lie." `Form submissions 0` shipped
   * because a figure was defaulted rather than refused.
   *
   * ⚠️ THE MUTATION: delete the `readFailed` branch, or move it BELOW the
   * emptiness branch, and this section fails — because the failure state would
   * then be unreachable behind the "no services yet" copy.
   */
  it('🔴 the screen renders a distinct FAILURE state, not the empty state', () => {
    const code = codeOf(SERVICES);
    expect(code, 'the screen never asks whether a read failed').toMatch(/\bisError\b/);
    // ⚠️ WORD-BOUNDED, not `toContain`. A bare substring check passes when the
    // attribute is RENAMED — `data-services-failedX` contains
    // `data-services-failed` — which mutation testing caught this guard doing.
    expect(code, 'there is no failure state to render').toMatch(/data-services-failed(?![\w-])/);
    expect(code, 'there is no empty state to distinguish it from').toMatch(/data-services-empty(?![\w-])/);
  });

  it('🔴 and the failure is branched BEFORE emptiness, so it cannot be hidden by it', () => {
    const code = codeOf(SERVICES);
    const failed = code.search(/data-services-failed(?![\w-])/);
    const empty = code.search(/data-services-empty(?![\w-])/);
    expect(failed, 'the failure state is missing').toBeGreaterThan(-1);
    expect(empty, 'the empty state is missing').toBeGreaterThan(-1);
    expect(failed, 'the empty state is rendered before the failure state, so a failure reads as "nothing scheduled"')
      .toBeLessThan(empty);
  });

  it('the failure copy does not claim anything about the diary', () => {
    const src = read(SERVICES);
    const from = src.search(/data-services-failed(?![\w-])/);
    expect(from, 'there is no failure state at all').toBeGreaterThan(-1);
    const block = src.slice(from, src.indexOf('</Empty>', from));
    expect(block, 'the failure state says nothing about what went wrong')
      .toMatch(/could not be (read|loaded)/i);
    expect(block, 'the failure state calls a failed read an empty diary')
      .not.toMatch(/nothing scheduled|no services yet/i);
  });

  it('🔴 and no read in this feature is swallowed into a default', () => {
    // A `catch` that returns a value would turn a rejection into an answer.
    for (const file of [QUERIES, 'src/hooks/queries/useVolunteerRotaQueries.ts']) {
      expect(codeOf(file), `${file} swallows a rejected read into an empty list`)
        .not.toMatch(/catch[\s\S]{0,60}return\s*(\[\]|\{\s*\}|null)/);
    }
  });
});

/* ═══ 10 · 🔴 NO UNORDERED limit(N); THE SOONEST ARE NOT TRUNCATED AWAY ═══ */

describe('10 · no unordered limit(N), and the soonest services are not truncated away', () => {
  /**
   * 🔴 THE-324's TRAP, ANSWERED BY NOT ADDING A QUERY AT ALL.
   *
   * #405 found 41 files taking an unordered `limit(N)` and calling the arbitrary
   * rows it returns "the recent ones", and a DESC-ordered truncation drops the
   * SOONEST rows — which is what THE-324 hit and had to ask the forward question
   * to avoid.
   *
   * This ticket adds NO Firestore query. The standalone services come from
   * `useRotaPlans`, which reads `limit(ROTA_PLAN_LIMIT + 1)` and reports
   * `truncated` — so the read is either PROVABLY COMPLETE (fewer rows came back
   * than the ceiling, and the in-memory sort is therefore exact and drops
   * nothing) or it is DECLARED INCOMPLETE on the screen. Neither branch presents
   * an arbitrary subset as the church's diary.
   */
  it('🔴 the ticket adds no Firestore query — the services list makes no read of its own', () => {
    for (const file of [...ADDED, SERVICES]) {
      const code = codeOf(file);
      for (const call of ['getDocs', 'getDoc', 'onSnapshot', 'collectionGroup', 'getCountFromServer']) {
        expect(code, `${file} makes a Firestore read of its own`).not.toMatch(new RegExp(`\\b${call}\\s*\\(`));
      }
      expect(code, `${file} builds a query`).not.toMatch(/\blimit\s*\(|\borderBy\s*\(|\bwhere\s*\(/);
    }
  });

  it('🔴 and the standalone list comes from the rota\'s +1 read, whose completeness is provable', () => {
    const rotaQueries = codeOf('src/hooks/queries/useVolunteerRotaQueries.ts');
    expect(rotaQueries, 'the rota read stopped over-fetching by one, so truncation is unknowable')
      .toContain('limit(ROTA_PLAN_LIMIT + 1)');
    expect(rotaQueries, 'the rota read stopped reporting truncation').toContain('truncated');
    expect(codeOf(SERVICES), 'the services screen does not consume the rota read')
      .toMatch(/\buseRotaPlans\s*\(/);
  });

  it('🔴 a list that cannot be proved complete SAYS SO rather than looking like the whole diary', () => {
    const code = codeOf(SERVICES);
    expect(code, 'the screen ignores the truncation flag').toMatch(/truncated/);
    expect(code, 'there is nothing rendered when the list is truncated')
      .toMatch(/data-services-truncated(?![\w-])/);
    const src = read(SERVICES);
    const from = src.search(/data-services-truncated(?![\w-])/);
    expect(from, 'there is no truncation notice at all').toBeGreaterThan(-1);
    expect(src.slice(from, from + 400), 'the truncation notice does not say the list is partial')
      .toMatch(/not all of them|more services than one read returns/i);
  });

  it('and the query module still filters on ONE field with no server-side sort', () => {
    // 🔴 A composite index would be INERT: `firestore.indexes.json` does not
    // deploy (`deploy-rules.yml` runs `firestore:rules,storage` only), so the
    // query that needed one would throw `failed-precondition` in production.
    const code = codeOf(QUERIES);
    expect(code, 'the plan query module now orders on the server').not.toMatch(/\borderBy\b/);
    for (const call of [...code.matchAll(/query\(([\s\S]*?)\n\s*\);/g)].map((m) => m[1])) {
      expect((call.match(/where\(/g) || []).length,
        'a query combines two where clauses — that is a composite index').toBeLessThanOrEqual(1);
    }
  });
});

/* ═══ 12 · EVENTS KEEPS EVERYTHING IT HAS ════════════════════════════════ */

describe('12 · Events keeps its list, month view, create/edit/detail and registrations', () => {
  /**
   * 🔴 THE EVENT PRODUCT IS UNTOUCHED. This ticket DEMOTES the event as a
   * service's anchor; it removes nothing from the section that runs events.
   */
  const EVENTS = 'src/components/AdminEvents.tsx';

  it('🔴 AdminEvents.tsx is byte-identical — this ticket does not touch it', () => {
    expect(ownershipFailure(EVENTS),
      'AdminEvents.tsx moved; the public event product is not this ticket\'s to change').toBeNull();
  });

  it('and every surface it owns is still named in it', () => {
    const code = read(EVENTS);
    for (const [claim, what] of [
      ['EventMonthView', 'the month view'],
      ['startDate', 'the event start'],
      ['registration', 'registrations'],
      ['ticketTypes', 'ticketing'],
    ] as const) {
      expect(code, `AdminEvents no longer mentions ${what}`).toContain(claim);
    }
  });

  it('the month view and its own layout suite are still in the tree', () => {
    for (const file of [
      'src/components/events/EventMonthView.tsx',
      'src/components/__tests__/THE-308.month-view.layout.test.tsx',
    ]) {
      expect(existsSync(path.join(REPO_ROOT, file)), `${file} is gone`).toBe(true);
    }
    // 🔴 THE-308's 44px day-cell claim is still made, by name, in its own suite —
    // this ticket touches neither the grid nor its `--cell-size` declaration.
    expect(read('src/components/__tests__/THE-308.month-view.layout.test.tsx'),
      'THE-308 stopped asserting the day-cell floor').toMatch(/44/);
    expect(codeOf('src/components/events/EventMonthView.tsx'), 'the month grid stopped sizing its cells')
      .toMatch(/--cell-size/);
  });
});

/* ═══ 14 · 🔴 NOTHING SENDS OUTSIDE sendTenantSms ════════════════════════ */

describe('14 · nothing sends outside sendTenantSms; every send is metered; STOP still stops', () => {
  /**
   * 🔴 THE MUTATION: send after STOP — remove the opt-out check from
   * `sms-optout.ts`'s caller, or let `sendSms` reach the provider when the meter
   * refuses — and this section fails on the assertions that name both.
   */
  it('🔴 this ticket\'s new and edited screens hold no transport at all', () => {
    for (const file of [...ADDED, SERVICES, 'src/components/events/ServicePlanPanel.tsx']) {
      const code = codeOf(file);
      expect(code, `${file} makes a network call`).not.toMatch(/\bfetch\s*\(|\baxios\b|\bXMLHttpRequest\b/);
      expect(code, `${file} sends`).not.toMatch(/\bsendSms\b|\bsendSMS\b|\bsendTenantSms\b|\bsendEmail\b/);
      expect(code, `${file} reaches an API route`).not.toMatch(/\/api\//);
    }
  });

  it('🔴 `sendTenantSms` is still the only send interface, and the meter still BLOCKS', () => {
    const lib = codeOf('src/lib/rota-invite.ts');
    expect(lib, 'the invite library stopped going through sendTenantSms').toContain('sendTenantSms');
    expect(lib, 'the invite library reaches a provider directly, around the meter')
      .not.toMatch(/twilio|messagebird|vonage|nexmo/i);

    const send = codeOf('src/lib/sms-send.ts');
    // 🔴 The reservation is in the SAME transaction as the read — a meter that
    // reserved afterwards would let two concurrent sends both pass the cap.
    expect(send, 'the meter stopped reserving').toMatch(/reserveSmsSegment/);
    // 🔴 AND IT BLOCKS: the provider is never called once the cap is reached.
    expect(send, 'the cap stopped blocking the provider').toMatch(/sms_cap_reached/);
  });

  /**
   * 🔴 THE SECOND VERSION OF THIS ASSERTION. The first read
   * `expect(sendPath).toMatch(/optedOut|OptOut|optOut|sms-optout/)` and PASSED
   * with the STOP gate deleted, because `sms-send.ts` also spells
   * `result.optedOut` (the PROVIDER reporting an opt-out, after a send) and
   * `recordOptOut` (writing one down). Neither is the gate. Mutation testing is
   * what found it: the check could be removed and the guard stayed green.
   *
   * The claim is about the GATE: `isOptedOut` is imported from `sms-optout.ts`,
   * it is AWAITED in a branch that returns without sending, and it happens
   * BEFORE anything is reserved or dispatched.
   */
  it('🔴 and a volunteer who texted STOP still receives nothing', () => {
    expect(existsSync(path.join(REPO_ROOT, 'src/lib/sms-optout.ts')), 'sms-optout.ts is gone').toBe(true);
    const send = codeOf('src/lib/sms-send.ts');

    expect(send, 'the send path no longer imports the opt-out check')
      .toMatch(/import\s*\{[^}]*\bisOptedOut\b[^}]*\}\s*from\s*['"]\.\/sms-optout['"]/);
    // 🔴 AWAITED AND BRANCHED ON — an import that is never called sends anyway.
    expect(send, 'the opt-out check is imported but never gates a send')
      .toMatch(/if\s*\(\s*await\s+isOptedOut\s*\([^)]*\)\s*\)\s*\{/);
    expect(send, 'the opt-out branch no longer refuses').toContain("code: 'recipient_opted_out'");

    // 🔴 AND IT IS FIRST. A STOP check after the reservation would charge the
    // church a segment for a message it must not send.
    const gate = send.indexOf('await isOptedOut');
    // ⚠️ The CALL, not the import line — `indexOf('reserveSmsSegment')` finds the
    // import at the top of the file and would make this comparison meaningless.
    const reserve = send.search(/\bawait\s+reserveSmsSegment\s*\(/);
    expect(gate, 'the opt-out gate is gone').toBeGreaterThan(-1);
    expect(reserve, 'the meter is never called').toBeGreaterThan(-1);
    expect(gate, 'STOP is checked after the meter reserves — a blocked send would still be billed')
      .toBeLessThan(reserve);

    // And this ticket did not touch the opt-out module itself.
    expect(read('src/lib/sms-optout.ts'), 'sms-optout.ts was edited by THE-329')
      .not.toContain('THE-329');
  });

  it('and the invite route sends only through the library, not around it', () => {
    const route = codeOf('src/app/api/rota/invitations/route.ts');
    // ⚠️ The route does not send: it hands targets to `src/lib/rota-invite.ts`,
    // which is the one file allowed near a transport. THE-329 adds a service
    // KIND to what the route reads and no send path of any sort.
    expect(route, 'the invite route reaches a provider directly')
      .not.toMatch(/twilio|messagebird|vonage|nexmo/i);
    expect(route, 'the invite route opened a second send path')
      .not.toMatch(/\bsendSms\s*\(|\bsendEmail\s*\(/);
  });
});

/* ═══ 15 · 🔴 EVERY ELEMENT THAT HAS A PRIMITIVE USES IT ═════════════════ */

describe('15 · every element that has a primitive uses it; inline styles stay at zero', () => {
  /**
   * 🔴 A new form that hand-rolled a bordered box, a label and a submit would be
   * a DEFECT, not a style choice. The rejections are recorded in the file's own
   * header AND in THE-274's adopter list, per element.
   */
  it('🔴 the create form composes the installed primitives', () => {
    const code = read(FORM);
    for (const primitive of ['card', 'field', 'input', 'select', 'button']) {
      expect(code, `the create form does not use ${primitive}`)
        .toContain(`@/components/ui/${primitive}`);
    }
  });

  it('🔴 and it hand-rolls none of what those primitives provide', () => {
    const code = codeOf(FORM);
    // A bare `<input>`/`<button>`/`<label>` is the substitution this guards
    // against — the primitives are `Input`, `Button`, `FieldLabel`.
    for (const tag of ['input', 'button', 'label', 'select', 'textarea']) {
      expect(code, `the create form hand-rolls a <${tag}>`)
        .not.toMatch(new RegExp(`<${tag}[\\s/>]`));
    }
  });

  it('🔴 it reaches for no primitive this repo does not have', () => {
    // `accordion` is NOT installed — verified: no `accordion.tsx` exists.
    expect(existsSync(path.join(REPO_ROOT, 'src/components/ui/accordion.tsx')),
      'accordion.tsx now exists — this ticket installed a component').toBe(false);
    for (const file of [...ADDED, SERVICES]) {
      expect(codeOf(file), `${file} imports a component that is not installed`)
        .not.toMatch(/@\/components\/ui\/accordion/);
    }
  });

  it('🔴 inline styles stay at ZERO across everything this ticket adds or edits', () => {
    for (const file of [...ADDED, ...EDITED]) {
      expect(codeOf(file), `${file} spells an inline style`).not.toMatch(/\bstyle=\{/);
    }
  });

  it('and it invents no width of its own — `form-layout.ts` owns them', () => {
    const code = read(FORM);
    expect(code, 'the create form does not use the shared layout module')
      .toContain("from '../layout/form-layout'");
    expect(codeOf(FORM), 'the create form invents a max-width')
      .not.toMatch(/max-w-\[\d/);
  });

  it('no new token, component or dependency was added', () => {
    const ui = readdirSync(path.join(REPO_ROOT, 'src/components/ui'))
      .filter((f) => f.endsWith('.tsx')).sort();
    // 43 primitives is what THE-274 recorded and every ticket since has kept.
    expect(ui.length, 'a ui primitive was added or removed').toBe(43);
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies), 'a dependency was added')
      .not.toContain('react-datepicker');
  });
});

/* ═══ 17 · 🔴 NO COLOUR, NO EMOJI, FOUR PALETTES ═════════════════════════ */

describe('17 · no colour hardcoded, no emoji; all four palettes resolve', () => {
  const HEX = /#[0-9a-fA-F]{3,8}\b/;
  const FUNC = /\b(rgb|rgba|hsl|hsla|oklch|lab|lch)\s*\(/;
  /* eslint-disable-next-line no-misleading-character-class */
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

  it.each(ADDED)('%s contains no hex or rgb/hsl/oklch literal', (file) => {
    const code = codeOf(file);
    expect(code, `${file} hardcodes a colour`).not.toMatch(HEX);
    expect(code, `${file} hardcodes a colour function`).not.toMatch(FUNC);
  });

  it.each(ADDED)('%s renders no emoji', (file) => {
    // ⚠️ The CODE, not the prose — this repo's docblocks use 🔴 and ⚠️ by
    // convention and a sweep of the raw file would fire on every one of them.
    expect(codeOf(file), `${file} renders an emoji`).not.toMatch(EMOJI);
  });

  it('🔴 both palettes still resolve, and there is no family axis left', () => {
    // 🔴 THE-338 — "FOUR PALETTES" WAS TWO FAMILIES × LIGHT/DARK. The family
    // axis is gone: the second family's 14 overrides were promoted into
    // :root/.dark and both its selectors deleted, so the product is one
    // family × two themes. What this test protects — that a screen is not
    // left unpainted because a block was dropped for one theme — is unchanged
    // and is now asserted on the two blocks that remain.
    const theme = read('src/lib/theme.ts');
    expect(theme, 'the family list is back').not.toContain('PALETTE_FAMILIES');
    expect(theme, 'the family default is back').not.toContain('DEFAULT_PALETTE_FAMILY');
    const css = read('src/app/globals.css');
    expect(css, 'the light palette is gone').toMatch(/^\s*:root\s*\{/m);
    expect(css, 'the dark palette is gone').toContain('[data-theme="dark"]');
    expect(css, 'a palette family selector is back').not.toContain('data-palette');
    expect(css, 'the Harvest brand palette is gone').toContain('Harvest brand palette');
    // The form paints with `card`, `input` and `border` — semantic tokens every
    // palette redefines. It names no palette and no colour of its own.
    expect(codeOf(FORM), 'the create form names a palette').not.toMatch(/harvest|classic/i);
  });
});

/* ═══ 18 · 🔴 NO FIXTURE IS PINNED NEAR TODAY ════════════════════════════ */

describe('18 · no test fixture is pinned to a date near today, and windows derive from NOW', () => {
  /**
   * 🔴 #468: a fixture pinned to `'2026-09-06T10:00'` turned `main` red for
   * everyone the moment the clock passed it.
   *
   * ⚠️ THE MUTATION: pin a fixture to today — add an ISO literal within a year
   * of the runner's clock to either of this ticket's suites — and this fails.
   */
  const MINE = [
    'src/components/events/__tests__/THE-329.standalone-service.test.tsx',
    'src/components/__tests__/THE-329.services.layout.test.tsx',
  ] as const;

  it('🔴 every dated fixture in this ticket is years from any plausible clock', () => {
    const thisYear = new Date().getFullYear();
    for (const file of MINE) {
      // ⚠️ THE CODE, NOT THE PROSE. These files QUOTE #468's fatal literal
      // ('2026-09-06T10:00') in a docblock so a reader knows what the fuse was,
      // and a sweep of the raw file would fire on the warning rather than on a
      // fixture. Comments are stripped first.
      const src = codeOf(file);
      // Every `new Date(YYYY, …)` and every bare ISO date literal.
      const years = [
        ...[...src.matchAll(/new Date\(\s*(\d{4})\s*,/g)].map((m) => Number(m[1])),
        ...[...src.matchAll(/['"](\d{4})-\d{2}-\d{2}/g)].map((m) => Number(m[1])),
      ];
      expect(years.length, `${file} has no dated fixture to check`).toBeGreaterThan(0);
      for (const year of years) {
        expect(year, `${file} pins a fixture to ${year}, which a runner's clock will reach`)
          .toBeGreaterThan(thisYear + 3);
      }
    }
  });

  it('🔴 and a window boundary is derived from the frozen NOW, never from an ISO literal', () => {
    // ⚠️ An ISO literal WITHOUT an offset is parsed in the RUNNER'S timezone, so
    // a boundary written as one encodes the runner. Both suites construct their
    // instants from NUMBERS.
    for (const file of MINE) {
      const src = codeOf(file);
      expect(src, `${file} declares no frozen NOW`).toMatch(/const NOW = new Date\(\s*\d{4}\s*,/);
      expect(src, `${file} builds a date from an ISO literal with no offset`)
        .not.toMatch(/new Date\(\s*['"]\d{4}-\d{2}-\d{2}T[\d:]+['"]\s*\)/);
    }
  });

  it('🔴 and where a timer is faked, `toFake` is spelled — it is load-bearing', () => {
    // Faking `setTimeout` timed 28 of 47 tests out and took a run from 4s to
    // 141s. A bare `useFakeTimers()` in this feature is a performance defect.
    for (const file of MINE) {
      const src = codeOf(file);
      for (const call of src.match(/useFakeTimers\([^)]*\)/g) ?? []) {
        expect(call, `${file} fakes every timer, not just Date`).toContain("toFake: ['Date']");
      }
    }
  });
});

/* ═══ 19 · 🔴 NO GUARD HERE ASKS WHAT THE BRANCH CHANGED ═════════════════ */

describe('19 · no guard in this PR asserts anything about the current branch\'s diff', () => {
  /**
   * 🔴 #454 IS A STANDING SWEEP, and its known blind spot (card `86bbvhaky`) is
   * that its detector needs the diff read and the process spawn in ONE
   * declaration — a read one call away slips through. So this is asserted the
   * DATAFLOW way THE-322 established: NO child-process facility is imported or
   * named at all, anywhere in this ticket's test files, which cannot be evaded
   * by putting the two halves in different statements.
   */
  const MINE = [
    'src/__tests__/the-329-guards.test.ts',
    'src/components/events/__tests__/THE-329.standalone-service.test.tsx',
    'src/components/__tests__/THE-329.services.layout.test.tsx',
  ] as const;

  /**
   * 🔴 THE NEEDLES ARE ASSEMBLED, NEVER WRITTEN. See this file's header: a guard
   * whose own source contains the string it forbids passes trivially — and one
   * in this repo passed with its GATE DELETED for exactly that reason. Joining
   * two fragments at run time means this file does not contain any of them, so
   * the assertions below are about the files they name and nothing else.
   */
  const needle = (...parts: readonly string[]): string => parts.join('');

  const CHILD_PROCESS = [
    needle('exec', 'FileSync'),
    needle('exec', 'Sync'),
    needle('spawn', 'Sync'),
    needle('spawn', '('),
    needle('child', '_process'),
    needle('node:child', '_process'),
  ];

  const BRANCH_QUESTIONS = [
    needle('git ', 'show'),
    needle('git ', 'diff'),
    needle('merge', '-base'),
    needle('rev', '-parse'),
    needle('HEAD', '~'),
    needle('origin', '/main'),
    needle('diff', '--name-only'),
  ];

  it('🔴 none of this ticket\'s tests can reach a child process at all', () => {
    // ⚠️ THE DATAFLOW FORM, per THE-322: it is not "the diff read and the
    // spawn in one declaration" that is banned, it is the FACILITY. A file that
    // cannot start a process cannot ask what the branch changed however its
    // statements are arranged, so the #454 blind spot (card `86bbvhaky`) has
    // nothing to slip through here.
    for (const file of MINE) {
      const src = read(file);
      for (const forbidden of CHILD_PROCESS) {
        expect(src, `${file} can shell out — ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('🔴 and none of them names a version-control query of any kind', () => {
    for (const file of MINE) {
      const src = read(file);
      for (const forbidden of BRANCH_QUESTIONS) {
        expect(src, `${file} asks what the branch changed — ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('🔴 and the needles above are not present in THIS file either — the gate is real', () => {
    // The self-check the deleted-gate failure would have caught. If a later
    // edit spells one of these plainly, this fails HERE rather than letting the
    // two assertions above go quietly green on a file that contains them.
    const self = read('src/__tests__/the-329-guards.test.ts');
    for (const forbidden of [...CHILD_PROCESS, ...BRANCH_QUESTIONS]) {
      expect(self, `this guard file contains ${forbidden}, so its own sweep is vacuous`)
        .not.toContain(forbidden);
    }
  });

  it('and the sweep and its detector are both still in the tree', () => {
    expect(existsSync(path.join(REPO_ROOT, 'src/__tests__/THE-315.branch-diff-guards.test.ts')),
      'the branch-diff detector is gone').toBe(true);
  });
});

/* ═══ 20 · 🔴 THE FILES THIS TICKET MAY NOT TOUCH ═══════════════════════ */

describe('20 · firestore.rules, indexes, functions/, sms-optout.ts and layout.tsx are byte-identical', () => {
  /**
   * 🔴 `firestore.rules` AUTO-DEPLOYS TO PRODUCTION ON MERGE and CI runs no
   * emulator tests. #471 gave the file ONE accepted-digest set so a rule change
   * is one edit — and THIS TICKET NEEDS NONE, which is a finding rather than a
   * hope: the new `startAt` lives in the SAME `servicePlans` collection, the
   * deployed rule reads no `resource.data`, and this ticket adds no query shape
   * for a rule to newly permit.
   */
  it('🔴 firestore.rules is at a digest a ticket recorded, and this ticket recorded none', () => {
    expect(rulesDigestFailure(),
      'firestore.rules moved — it auto-deploys to production with no emulator tests').toBeNull();
    // And no ticket file THIS ticket added claims it.
    const mine = JSON.parse(read('src/__tests__/__fixtures__/ownership/THE-329.json')) as
      { entries: { file: string }[] };
    expect(mine.entries.map((e) => e.file), 'THE-329 recorded a firestore.rules digest — it needs no rule change')
      .not.toContain('firestore.rules');
  });

  it('🔴 the deployed servicePlans rule is exactly the one THE-313 reported, unamended', () => {
    const rules = read('firestore.rules');
    const from = rules.indexOf('match /servicePlans/{planId}');
    expect(from, 'the servicePlans rule is gone from firestore.rules').toBeGreaterThan(-1);
    // ⚠️ From the OPENING brace of the block, not from the match path — the
    // path itself contains `{planId}` and a naive scan closes on it.
    const body = rules.slice(from, rules.indexOf('\n    }', from) + 6);
    expect(body, 'the read half changed').toContain('allow read:  if belongsToTenant(tenantId)');
    // 🔴 `manageEvents`, NOT a new permission. A `manageServices` claim would add
    // a row to the roles matrix that no rule, no API route and no other screen
    // knows about — and every one of them would still check `manageEvents`.
    expect(body, 'the write permission changed').toContain("hasPermission('manageEvents', tenantId)");
    expect(rules, 'a manageServices permission was invented').not.toContain('manageServices');
    expect(rules, 'a managePlanning permission was invented').not.toContain('managePlanning');
  });

  it('🔴 firestore.indexes.json is byte-identical — an index there would be INERT', () => {
    // `deploy-rules.yml` runs `firestore:rules,storage` only, so an index added
    // here never deploys and the query that needed it throws in production.
    // 🔴 NOT a digest compared against itself — #454's "a guard comparing a file
    // to itself" is one of the nine that passed a planted defect. The claim is
    // about the CONTENT: no index mentions this ticket's collection, and the
    // file has no entry for `startAt` to sort on.
    const raw = read('firestore.indexes.json');
    expect(raw, 'an index was added for the new field').not.toContain('startAt');
    const indexes = JSON.parse(raw) as { indexes: unknown[] };
    expect(JSON.stringify(indexes), 'an index was added for servicePlans')
      .not.toContain('servicePlans');
  });

  it('🔴 functions/, sms-optout.ts and layout.tsx name this ticket nowhere', () => {
    const files: string[] = [
      ...(existsSync(path.join(REPO_ROOT, 'functions'))
        ? walk(path.join(REPO_ROOT, 'functions')).map(rel)
        : []),
      'src/lib/sms-optout.ts',
      'src/app/layout.tsx',
    ];
    for (const file of files) {
      if (!existsSync(path.join(REPO_ROOT, file))) continue;
      if (statSync(path.join(REPO_ROOT, file)).isDirectory()) continue;
      expect(read(file), `${file} was edited by THE-329`).not.toContain('THE-329');
    }
  });

  it('the accept page and the invite library are untouched by this ticket', () => {
    for (const file of ['src/app/rota/[token]/page.tsx', 'src/lib/rota-invite.ts']) {
      expect(read(file), `${file} was edited by THE-329`).not.toContain('THE-329');
    }
  });
});

/* ═══ 21 · THE RECORD ════════════════════════════════════════════════════ */

describe('21 · this ticket records what it owns, and appends rather than substitutes', () => {
  it('🔴 every file it edits that the register tracks is at a digest it recorded', () => {
    // ⚠️ ONLY the files the register actually tracks. It is not a list of every
    // source file — `service-plan.ts` and the two rota modules are pinned by
    // `the-317-guards.test.ts` and `the-324-guards.test.ts` instead, which the
    // next assertion checks. Calling `ownershipFailure` on an untracked file
    // would fail on "nothing is checking it", which is a true statement about
    // the register and a false one about the file.
    const tracked = new Set(loadOwnership().map((e) => e.file));
    const checked = EDITED.filter((f) => tracked.has(f));
    expect(checked.length, 'the register tracks none of the files this ticket edits')
      .toBeGreaterThan(0);
    for (const file of checked) {
      expect(ownershipFailure(file), `${file} moved without being recorded`).toBeNull();
    }
  });

  it('🔴 and the three the PART pins own are at a digest those guards accept', () => {
    // `service-plan.ts`, `volunteer-rota.ts` and `useServicePlanQueries.ts` are
    // pinned as accepted-digest SETS in part 1's and part 2's own guard files.
    // A digest neither records fails there; this asserts the record was made.
    const pins = read('src/__tests__/the-317-guards.test.ts')
      + read('src/__tests__/the-324-guards.test.ts');
    for (const file of [SHAPE, ROTA, QUERIES]) {
      const actual = sha256(read(file));
      expect(pins, `${file} is at ${actual}, which part 1's and part 2's guards record for no ticket`)
        .toContain(actual);
    }
  });

  it('🔴 and the new file is recorded too, so a later ticket fails in ITS OWN PR', () => {
    const mine = JSON.parse(read('src/__tests__/__fixtures__/ownership/THE-329.json')) as
      { ticket: string; entries: { file: string; digest: string; why: string }[] };
    expect(mine.ticket).toBe('THE-329');
    for (const entry of mine.entries) {
      expect(entry.digest, `${entry.file} is recorded without a digest`).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.why.length, `${entry.file} is recorded without a stated reason`).toBeGreaterThan(120);
      expect(sha256(read(entry.file)), `${entry.file}'s recorded digest is stale`).toBe(entry.digest);
    }
  });

  it('🔴 AdminDashboard.tsx is NOT touched — no nav array changed', () => {
    // The Services section already exists and already carries the right gate, so
    // this ticket has no reason to edit a digest-pinned file that #469 and #470
    // both just edited.
    expect(ownershipFailure('src/components/AdminDashboard.tsx'),
      'AdminDashboard.tsx moved — use EDITED_SINCE_MEASUREMENT and APPEND, never substitute').toBeNull();
    expect(read('src/components/AdminDashboard.tsx'), 'AdminDashboard.tsx was edited by THE-329')
      .not.toContain('THE-329');
  });

  it('the ticket edits no OTHER ticket\'s ownership file', () => {
    const dir = path.join(REPO_ROOT, 'src/__tests__/__fixtures__/ownership');
    for (const name of readdirSync(dir)) {
      if (name === 'THE-329.json') continue;
      const doc = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as { ticket: string };
      expect(doc.ticket, `${name} was rewritten to claim another ticket`)
        .toBe(name.replace(/\.json$/, ''));
    }
  });

  it('and the new file is mounted by exactly one screen — the Services section', () => {
    const mounts = walk(path.join(REPO_ROOT, 'src')).filter((f) => {
      if (f.includes(`${path.sep}__tests__${path.sep}`)) return false;
      if (rel(f) === FORM) return false;
      return /<ServiceCreateForm/.test(readFileSync(f, 'utf8'));
    });
    expect(mounts.map(rel), 'the create form is mounted somewhere other than the Services section')
      .toEqual([SERVICES]);
  });
});
