import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

import { rulesDigestFailure } from './__fixtures__/firestore-rules-pin';

/**
 * THE-345 - the static guards.
 * ===========================================================================
 *
 * TWO DEFECTS, ONE PR:
 *
 *   1. A church could create a PAID event with no payment rail in existence.
 *      `events/{id}.price` was quoted on four screens and charged by nothing;
 *      `ticketTypes[].price` was the real charge and dead-ended in a 400.
 *   2. An adoption POINTER whose library course the platform had deleted was
 *      dropped from the rendered list and still counted in `adopted.length`, so
 *      a church permanently lost a plan slot to a course that does not exist.
 *
 * The BEHAVIOUR of both fixes is asserted where behaviour belongs - by driving
 * the real components in `THE-345.paid-events.test.tsx` and
 * `THE-345.course-count.test.tsx`, and by measuring the surfaces they add in
 * real Chromium in `THE-345.gate-surfaces.layout.test.tsx`. THIS file asserts
 * only what those cannot: that nothing was deleted to hide the feature, that
 * the files this ticket must not touch are untouched, and the house rules.
 */

const sha256 = (t: string | Buffer): string => createHash('sha256').update(t).digest('hex');
const REPO = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(REPO, rel), 'utf8');

/* ═══════════════════════════════════════════════════════════════════════════
   0 · THE COMMENT STRIPPER, AND THE PROOF THAT IT DOES NOT EAT THE FILE
   ═══════════════════════════════════════════════════════════════════════════

   Card `86bbxkawp`: the inherited `code()` stripper in THE-286's and THE-296's
   suites EATS ~150 LINES of a file. A stripper that swallows source turns every
   `not.toContain` assertion built on it into a guard that passes because the
   code it was looking for is gone, not because the defect is.

   So this one is a STATE MACHINE rather than a pair of regexes - it knows it is
   inside a string, a template literal or a regex and does not strip there - and
   section 0 PROVES it on the two files this ticket edits before any other
   assertion is allowed to rely on it. Both files are heavily commented and both
   spell `price` and `adopted` constantly in prose, which is exactly the shape
   that has beaten thirteen guards in this series.
   ═══════════════════════════════════════════════════════════════════════════ */

function stripComments(src: string): string {
  let out = '';
  let i = 0;
  type Mode = 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl';
  let mode: Mode = 'code';
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && n === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && n === '*') { mode = 'block'; i += 2; continue; }
      if (c === "'") { mode = 'sq'; out += c; i++; continue; }
      if (c === '"') { mode = 'dq'; out += c; i++; continue; }
      if (c === '`') { mode = 'tpl'; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out += c; }
      i++; continue;
    }
    if (mode === 'block') {
      if (c === '*' && n === '/') { mode = 'code'; i += 2; continue; }
      // Newlines are KEPT so line numbers and line counts survive stripping.
      if (c === '\n') out += c;
      i++; continue;
    }
    // Inside a string or template: copy verbatim, honouring escapes.
    if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
    if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) {
      mode = 'code';
    }
    out += c; i++;
  }
  return out;
}

/** Source with comments stripped - the code, never the prose. */
const codeOf = (rel: string): string => stripComments(read(rel));

const EVENTS = 'src/components/AdminEvents.tsx';
const COURSES = 'src/components/AdminCourses.tsx';
const FEATURE = 'src/lib/paid-events-feature.ts';

describe('0 · the stripper does not eat the files these guards read', () => {
  it.each([EVENTS, COURSES, FEATURE])('%s keeps its code after stripping', (rel) => {
    const raw = read(rel);
    const code = stripComments(raw);
    // Line COUNT is preserved exactly - block comments keep their newlines - so
    // a stripper that ate a region would show up as a shortfall here.
    expect(code.split('\n').length, `${rel}: the stripper changed the line count`)
      .toBe(raw.split('\n').length);
  });

  it('it removes prose and keeps code on a case built for the trap', () => {
    const sample = [
      '/** PAID_EVENTS_ENABLED is documented here in a docblock. */',
      "const a = 'PAID_EVENTS_ENABLED in a string';",
      '// PAID_EVENTS_ENABLED in a line comment',
      'const real = PAID_EVENTS_ENABLED;',
      'const url = "https://example.com/not-a-comment";',
    ].join('\n');
    const out = stripComments(sample);
    expect(out, 'the docblock survived').not.toContain('documented here');
    expect(out, 'the line comment survived').not.toContain('in a line comment');
    expect(out, 'a string literal was eaten').toContain("'PAID_EVENTS_ENABLED in a string'");
    expect(out, 'the real reference was eaten').toContain('const real = PAID_EVENTS_ENABLED;');
    expect(out, 'a URL was mistaken for a comment').toContain('https://example.com/not-a-comment');
  });

  it('and the two screens really are full of the words these guards grep for', () => {
    // The premise behind section 0. If these files did NOT discuss `price` and
    // `adopted` in prose, stripping would be a formality and this section would
    // be theatre.
    for (const [rel, word] of [[EVENTS, 'price'], [COURSES, 'adopted']] as const) {
      const raw = read(rel);
      const code = stripComments(raw);
      const inProse = (raw.match(new RegExp(word, 'gi')) ?? []).length
        - (code.match(new RegExp(word, 'gi')) ?? []).length;
      expect(inProse, `${rel} does not discuss "${word}" in prose - re-check this premise`)
        .toBeGreaterThan(10);
    }
  });
});

/* ═══ 7 · the gate is ONE value and NOTHING was deleted ════════════════════ */

describe('7 · the gate is one value, and nothing was deleted to hide the feature', () => {
  it('the switch is a single exported boolean, and the module imports nothing', () => {
    const code = codeOf(FEATURE);
    expect(code).toMatch(/export const PAID_EVENTS_ENABLED = (?:true|false);/);
    // Same idiom and same reason as sms-feature.ts and stripe-connect-feature.ts:
    // this flag is read from four client components, so the module must stay
    // free in the bundle.
    expect(code, 'the feature module started importing something').not.toMatch(/^\s*import\s/m);
  });

  it('it is its OWN proposition - it does not reach for the Stripe Connect flag', () => {
    // Two propositions, two lines. Coupling them would mean paid ticketing could
    // only ever come back through the rail that failed (`rejected.fraud`), never
    // through the replacement being sought.
    for (const rel of [FEATURE, EVENTS]) {
      expect(codeOf(rel), `${rel} couples paid events to Stripe Connect`)
        .not.toMatch(/STRIPE_CONNECT_ENABLED/);
    }
  });

  it('every surface the switch reaches spells the SAME gate, and there is no second one', () => {
    const SURFACES = [
      EVENTS,
      'src/components/PublicCalendar.tsx',
      'src/components/NewsTab.tsx',
    ];
    for (const rel of SURFACES) {
      expect(codeOf(rel), `${rel} does not import the gate`)
        .toMatch(/from '\.\.\/lib\/paid-events-feature'/);
    }
    // No screen invents a second flag of its own.
    for (const rel of SURFACES) {
      expect(codeOf(rel), `${rel} spells a second paid-events flag`)
        .not.toMatch(/const\s+PAID_EVENTS_ENABLED/);
    }
  });

  it('NO SURFACE RENDERS A RAW PRICE TERNARY - every quote goes through the one helper', () => {
    // THIS IS THE GUARD THAT ACTUALLY BINDS, and it was added because mutation
    // proved the import check above does NOT. Unwiring `eventPriceLabel` from
    // PublicCalendar - putting the raw `ev.price > 0 ? '$' + ev.price : 'Free'`
    // back and quoting an uncollectable $50 to the public again - left the
    // import line in place and every other assertion green.
    //
    // The defect this ticket fixes IS four independent ternaries over one stored
    // number, so "there is exactly one of them and it is in the feature module"
    // is the property worth asserting, not "the module is imported".
    // THE NEEDLE IS EXACT, and both narrowings were forced by real matches
    // rather than guessed:
    //   - `price > 0 ?` alone also matches the legitimate CLASSNAME ternary on
    //     the event card (`ev.price > 0 ? 'font-semibold text-muted' : ...`),
    //     which chooses a font weight, not a quote.
    //   - `> 0 ? '$'` alone also matches `fmtCents`, the pre-existing CENTS
    //     formatter for TICKET TYPES, which this ticket keeps (deleting it would
    //     break the flip-back promise) and gates at its call site instead.
    // So the needle is the EVENT price being rendered as money, which is the
    // exact expression that told a member a conference cost $50.
    const TERNARY = /(?:ev|event)\.price\s*>\s*0\s*\?\s*[`'"]\$/;
    for (const rel of [EVENTS, 'src/components/PublicCalendar.tsx', 'src/components/NewsTab.tsx']) {
      // Comment-stripped: both screens discuss the old ternary in prose, and a
      // guard that read the explanation instead of the code is how thirteen
      // guards in this series passed a planted defect.
      expect(codeOf(rel), `${rel} renders a price ternary of its own instead of calling the helper`)
        .not.toMatch(TERNARY);
      // And it really does call the helper - an absence alone would also be
      // satisfied by a screen that stopped showing a price by deleting it.
      expect(codeOf(rel), `${rel} does not call eventPriceLabel`)
        .toMatch(/eventPriceLabel\(/);
    }
    // The one place an event price is turned into money.
    expect(codeOf(FEATURE), 'the helper stopped deciding anything')
      .toMatch(/dollars\s*>\s*0\s*\?\s*[`'"]\$/);
  });

  it('and the ticket-type price is gated at its call site rather than deleted', () => {
    // `fmtCents` is the pre-existing CENTS formatter and it stays - deleting it
    // would break the promise that flipping one value brings everything back.
    // What must be true is that every place it QUOTES a stored ticket price is
    // behind the gate.
    //
    // ── AMENDED BY THE-351: THE GATE IS NAMED, NOT ASSUMED TO BE ONE VALUE ───
    //
    // THE-351 un-gates the TICKET-TYPE price on manual terms - a church may
    // charge for a ticket it collects itself, through its own PayPal, and
    // confirms each payment by hand - so this quote now sits behind
    // `canPriceTickets`, which is `ticketPricingAvailable() && the church has a
    // payment link`. The CLAIM IS UNCHANGED and is still the one that matters:
    // a stored ticket price may never be quoted with NO gate in front of it,
    // which is what would tell a member a conference costs $50 on a deployment
    // that can take no money for it. What is no longer assumed is that the gate
    // can only ever be spelled one way.
    //
    // THE EVENT-LEVEL price is a separate assertion, directly above, and is
    // UNAMENDED: it is still gated on `PAID_EVENTS_ENABLED` alone and
    // `eventPriceLabel` still returns null, because THE-345's finding about it
    // holds in either mode - it is charged by nothing.
    const GATES = ['PAID_EVENTS_ENABLED', 'canPriceTickets'];
    const code = codeOf(EVENTS);
    for (const m of code.matchAll(/fmtCents\(t\.price\)/g)) {
      const before = code.slice(Math.max(0, m.index! - 120), m.index!);
      expect(GATES.some((g) => before.includes(g)),
        `a stored ticket price is quoted with no gate in front of it: ...${before.slice(-80)}`)
        .toBe(true);
    }
    expect([...code.matchAll(/fmtCents\(t\.price\)/g)].length,
      'the ticket-type price line vanished entirely').toBeGreaterThan(0);
  });

  it('NOTHING WAS DELETED - every gated surface is still in the tree, by name', () => {
    // The flip-back promise, enumerated. `sms-feature.ts` makes it explicitly:
    // "set it true and every surface comes back exactly as it was".
    const events = codeOf(EVENTS);
    for (const [needle, what] of [
      ['Ticket Price ($)', 'the event price input'],
      ['form.price', 'the event price form field'],
      ['ticketDraft.price', 'the ticket-type price draft'],
      ['fmtCents', 'the cents formatter'],
      ['DollarSign', 'the price icon'],
      ['price:', 'the stored price key'],
    ] as const) {
      expect(events, `${what} was DELETED rather than gated`).toContain(needle);
    }
    // The four files the gate reaches, plus the module itself, all exist.
    for (const rel of [FEATURE, EVENTS, 'src/components/PublicCalendar.tsx', 'src/components/NewsTab.tsx']) {
      expect(existsSync(path.join(REPO, rel)), `${rel} is gone`).toBe(true);
    }
  });

  it('the price is gated in BOTH write paths, not merely hidden in the UI', () => {
    // A hidden input is not a gate: the form state still holds whatever was
    // seeded. Both writes consult the switch.
    const code = codeOf(EVENTS);
    const save = code.slice(code.indexOf('const handleSave'), code.indexOf('const confirmDelete'));
    expect(save, 'the event create/update write does not consult the gate')
      .toContain('PAID_EVENTS_ENABLED');
    // ── AMENDED BY THE-351, and the claim is unchanged ──────────────────────
    //
    // The ticket-type WRITE still consults a gate rather than trusting the UI to
    // have hidden the input - a hidden input is not a gate, because the form
    // state still holds whatever was seeded. What the gate IS has moved:
    // `ticketPricingAvailable()` is `PAID_EVENTS_ENABLED || MANUAL_EVENT_
    // PAYMENTS_ENABLED`, so with both off it clamps to 0 exactly as THE-345
    // wrote it, and with manual confirmation on a church may write the price it
    // will collect itself. The EVENT write above is unamended and still consults
    // `PAID_EVENTS_ENABLED` alone.
    const ticket = code.slice(code.indexOf('const saveTicketDraft'), code.indexOf('const removeTicket'));
    expect(ticket, 'the ticket-type write does not consult the gate')
      .toContain('ticketPricingAvailable()');
    // And the clamp is still a clamp: the un-gated arm builds a NEW object at 0,
    // so nothing stored is rewritten by the branch either way.
    expect(ticket, 'the ticket-type write stopped clamping')
      .toMatch(/ticketPricingAvailable\(\)\s*\?[\s\S]{0,120}?:\s*0,/);
  });
});

/* ═══ 8 · THE-308's month view is not regressed ════════════════════════════ */

describe("8 · THE-308's month view is untouched", () => {
  it('neither month-view file changed, so its measured 44px floor still stands', () => {
    // The day-cell measurement itself lives in THE-308's own Chromium suite and
    // runs unedited; what this ticket owes it is that the files it measures did
    // not move. A digest says that in a way no re-measurement can.
    const MONTH_VIEW: Record<string, string> = {
      'src/components/events/EventMonthView.tsx':
        '2dee2d960e56dd9a4f1afe51c4b321666632981d68c258a8688fae974c3a7961',
      'src/components/events/month-view.ts':
        '2933854ade2aa6695bd1996f2e9a5a425655f6be5a1b0e66d2a0aa4b12796d76',
    };
    for (const [rel, digest] of Object.entries(MONTH_VIEW)) {
      expect(sha256(read(rel)), `${rel} moved - THE-308's measured month grid is at risk`).toBe(digest);
    }
  });

  it('and the events screen still mounts it lazily, so it stays out of the list chunk', () => {
    expect(codeOf(EVENTS)).toContain("React.lazy(() => import('./events/EventMonthView'))");
  });
});

/* ═══ 15 · adoptedCourses is still server-only ════════════════════════════ */

describe('15 · adoptedCourses is still server-only', () => {
  it('the rule is still `allow write: if false`', () => {
    // Read from the rules file itself, in the adoptedCourses block, so a rule
    // loosened anywhere else cannot satisfy this and a comment cannot either.
    const rules = read('firestore.rules');
    const from = rules.indexOf('match /adoptedCourses/');
    expect(from, 'the adoptedCourses rule is gone').toBeGreaterThan(-1);
    const block = rules.slice(from, rules.indexOf('}', rules.indexOf('allow write', from)));
    expect(block, 'adoptedCourses became client-writable').toMatch(/allow write:\s*if false/);
  });

  it('and the screen still mutates adoptions only through the route', () => {
    const code = codeOf(COURSES);
    expect(code, 'the courses screen writes adoptions directly')
      .not.toMatch(/(?:setDoc|addDoc|updateDoc|deleteDoc)\([^)]*adoptedCourses/);
    expect(code).toContain("'/api/courses/adopt'");
  });

  it('the ghost is cleared through that SAME route - this ticket adds none', () => {
    const code = codeOf(COURSES);
    // One route path in the whole screen, and the ghost's remove control calls
    // the un-adopt handler that already used it.
    const routes = [...code.matchAll(/authFetch\('([^']+)'/g)].map((m) => m[1]);
    expect([...new Set(routes)], 'a new route appeared on this screen').toEqual(['/api/courses/adopt']);
    expect(code).toContain('handleUnadopt(id)');
  });
});

/* ═══ 22 · the files this ticket may not touch ════════════════════════════ */

describe('22 · firestore.rules, the indexes, functions/ and layout.tsx are untouched', () => {
  it('firestore.rules is at a digest some ticket recorded', () => {
    // THROUGH THE SHARED REGISTER, never as a literal here. THE-333 and THE-341
    // each spelled the digest in their own suite and each turned THE-325 red;
    // THE-342 recorded that plainly and routed through `rulesDigestFailure()`
    // instead. This suite does the same, and its addition to the pinner
    // population is recorded in THE-322's own count.
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded - it AUTO-DEPLOYS to production').toBeNull();
  });

  it('firestore.indexes.json and layout.tsx are byte-identical', () => {
    const UNTOUCHED: Record<string, string> = {
      'firestore.indexes.json': '8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0',
      'src/app/layout.tsx': 'b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f',
    };
    for (const [rel, digest] of Object.entries(UNTOUCHED)) {
      expect(sha256(read(rel)), `${rel} is not this ticket's to change`).toBe(digest);
    }
  });

  it('functions/ is byte-identical, every file of it', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        if (e.name === 'node_modules' || e.name === 'lib') return [];
        const p = path.join(dir, e.name);
        return e.isDirectory() ? walk(p) : [p];
      });
    const root = path.join(REPO, 'functions');
    const files = existsSync(root) ? walk(root).sort() : [];
    const digest = sha256(files.map((f) => `${path.relative(REPO, f)}:${sha256(readFileSync(f))}`).join('\n'));
    expect(digest, 'something under functions/ moved').toBe('1a3a1c7f27699263bcdf5bd0320c7cb0803a6f76644952f631000bc9bedef2d7');
  });

  it('and the registration submit route - the money path - is byte-identical', () => {
    // THE-256 records why this ticket deliberately does NOT gate it:
    // `requiresPayment = amount > 0 && !waitlisted` already bypasses payment for
    // free, waitlisted and $0-discounted registrations, and a paid ticket
    // already fails cleanly on the existing `connectAccountId` check. A gate
    // here would be a second refusal for the same state.
    /**
     * ── AMENDED BY THE-351, AND THE RE-RECORD IS THE TICKET ──────────────────
     *
     * THE-345 pinned this route because it deliberately did NOT touch it: with
     * no rail, `requiresPayment` already failed cleanly on the missing Connect
     * account and a second refusal would have been redundant.
     *
     * THE-351 changes exactly that decision, on the founder's instruction —
     * "registered immediately, marked UNPAID". Under manual confirmation the
     * clean refusal is the wrong answer: a church CAN be paid now, through its
     * own PayPal, so the route must not send the member to a closed rail at all.
     * `requiresPayment` gains `&& !manualConfirmationMode()` and the seat is
     * written confirmed-and-unpaid with a reference code.
     *
     * WHAT THIS ASSERTION IS ACTUALLY FOR IS UNCHANGED and is asserted in the
     * three suites that own it: THE-154's direct charge, the platform fee, the
     * Checkout metadata, the pending-registration rollback and the CRM write are
     * byte-identical, and `submit-route`, `submit-direct-charge` and
     * `stripe-config-split` now pin `manualConfirmationMode()` OFF so the rail
     * path keeps proving it is whole for the day it returns.
     */
    expect(sha256(read('src/app/api/event-registration/submit/route.ts')))
      .toBe('f203f58f402ec89f14415c9ae64134bd44286b8c4fcb0e8fa12fb70cfd7739a2');
    expect(sha256(read('src/app/api/event-registration/apply-discount/route.ts')))
      .toBe('47622ed746e6e3a652cd7ffab4bd5f434ff4f52fea94a14c5d3eb588ff3924e0');
  });

  it('and so is the by-id read this ticket reasons about but does not change', () => {
    // THE-342's `readDocsByIds` is what makes the ghost fix safe: it THROWS on a
    // rejected chunk rather than resolving into a short list, so a failed read
    // can never look like a deleted course. THE-345 depends on that contract and
    // must not have quietly altered it.
    expect(sha256(read('src/utils/bounded-list-read.ts'))).toBe('0ead07c82bb5494cb35fd5a3a2eb53de87ecbb648f26310e49059db4f87b6186');
    expect(sha256(read('src/utils/course-adoption.ts'))).toBe('fe8ab791e8f244dddcfd5aea35be04670ea4c816b03efe488e414cc102d210ce');
  });
});

/* ═══ 16-18 · the house rules ══════════════════════════════════════════════ */

const TOUCHED = [
  FEATURE, EVENTS, COURSES,
  'src/components/PublicCalendar.tsx',
  'src/components/NewsTab.tsx',
];

describe('16 · every element that has a primitive uses it', () => {
  it('both notices are the `alert` primitive, not a hand-rolled div', () => {
    for (const rel of [EVENTS, COURSES]) {
      const code = codeOf(rel);
      // Either spelling - AdminEvents uses the `@/` alias and AdminCourses the
      // relative path, both of which resolve to the one installed primitive.
      expect(code, `${rel} does not import ui/alert`)
        .toMatch(/from ['"](?:@\/components|\.{1,2}(?:\/[\w.-]+)*)\/ui\/alert['"]/);
    }
    // And they are USED, not merely imported - the trap an import-line guard
    // falls into. Each marker attribute sits on an <Alert>, so a hand-rolled div
    // wearing the same attribute fails.
    expect(codeOf(EVENTS)).toMatch(/<Alert data-paid-events-gate="form">/);
    expect(codeOf(COURSES)).toMatch(/<Alert data-courses-dangling-adoptions=/);
  });

  it('neither notice hand-rolls a box around itself', () => {
    for (const [rel, marker] of [[EVENTS, 'data-paid-events-gate'], [COURSES, 'data-courses-dangling-adoptions']] as const) {
      const code = codeOf(rel);
      const i = code.indexOf(marker);
      expect(i, `${marker} is gone`).toBeGreaterThan(-1);
      // The 240 characters before the marker must not contain a styled div - a
      // card drawn around a card is the defect this rule exists for.
      const before = code.slice(Math.max(0, i - 240), i);
      expect(before, `${rel} wraps its Alert in a hand-rolled box`)
        .not.toMatch(/<div className=\{?["`][^"`]*(?:border|rounded|shadow|bg-surface)/);
    }
  });

  it('no primitive file was edited', () => {
    // 43 primitives on disk, enumerated from the directory rather than from a
    // list that could drift. `accordion` is the only one absent.
    const dir = path.join(REPO, 'src/components/ui');
    const primitives = readdirSync(dir).filter((f) => f.endsWith('.tsx')).sort();
    expect(primitives.length, 'the primitive count moved').toBe(43);
    expect(primitives, 'accordion appeared').not.toContain('accordion.tsx');
    expect(primitives, 'alert went missing').toContain('alert.tsx');
    // Their digests are pinned by THE-332 and ds-primitives; this ticket only
    // asserts the population, so a primitive ADDED here would be caught.
  });
});

describe('17 · control heights', () => {
  it('the one control this ticket adds carries the 44px floor AND releases it above sm', () => {
    // Measured for real in THE-345.gate-surfaces.layout.test.tsx; this is the
    // source-side half, so a class removed without re-measuring still fails.
    const code = codeOf(COURSES);
    expect(code, 'the remove control lost its 44px floor').toContain('min-h-11 sm:min-h-0');
    expect(code, 'the remove control does not release to Rule 4 above sm')
      .toContain('${CONTROL_DENSITY.action}');
  });

  it('this ticket mints no height of its own', () => {
    // A CLOSED RECORD PER FILE rather than "none", because three of these files
    // already carried raw pixel heights before THE-345 and a blanket ban would
    // fail on somebody else's work while proving nothing about this ticket's.
    // The lists below are what each file spells TODAY, so a height this ticket -
    // or any later one - adds appears here and fails, which is the property that
    // matters. No branch diff is consulted to establish it.
    const RECORDED_PIXEL_HEIGHTS: Record<string, readonly string[]> = {
      [FEATURE]: [],
      // AMENDED BY THE-346: ['44','44'] -> [], AND THE FILE SPENDS LESS, NOT
      // MORE. THE-308's two `min-h-[44px]` tab triggers were the entry here;
      // THE-346 respells that same 44px as `min-h-11` off the spacing scale
      // while fixing the List/Month control, so the file now mints NO raw pixel
      // height at all. The measured target is unchanged at 44px - this is the
      // arbitrary value going away, not the floor.
      [EVENTS]: [],
      // Pre-existing: the three 52px course/library thumbnail boxes.
      [COURSES]: ['52', '52', '52'],
      'src/components/PublicCalendar.tsx': [],
      // Pre-existing: the feed's 150px embed frame and three 18px reaction rows.
      'src/components/NewsTab.tsx': ['150', '18', '18', '18'],
    };
    for (const rel of TOUCHED) {
      const found = [...codeOf(rel).matchAll(/(?:min-)?h-\[(\d+)px\]/g)].map((m) => m[1]);
      expect(found, `${rel} mints a raw pixel height`).toEqual(RECORDED_PIXEL_HEIGHTS[rel]);
    }
  });
});

describe('18 · no hardcoded colour, no emoji, no raw Tailwind scale', () => {
  it('this ticket adds no emoji to any file it touches', () => {
    const EMOJI = /\p{Extended_Pictographic}/gu;
    for (const rel of [FEATURE, 'src/components/__tests__/THE-345.paid-events.test.tsx',
      'src/components/__tests__/THE-345.course-count.test.tsx',
      'src/components/__tests__/THE-345.gate-surfaces.layout.test.tsx',
      'src/__tests__/THE-345.paid-events-and-count-guards.test.ts']) {
      // RAW source, not stripped: the rule covers prose too, and a stripped
      // sweep would exempt exactly the comments where emoji actually appear.
      expect(read(rel).match(EMOJI) ?? [], `${rel} carries an emoji`).toEqual([]);
    }
  });

  it('the wording this ticket ships carries no emoji either', async () => {
    const m = await import('../lib/paid-events-feature');
    const EMOJI = /\p{Extended_Pictographic}/gu;
    for (const s of [m.PAID_EVENTS_HIDDEN_TITLE, m.PAID_EVENTS_HIDDEN_MESSAGE, m.NOT_COLLECTED_LABEL]) {
      expect(s.match(EMOJI) ?? []).toEqual([]);
    }
  });

  it('it hardcodes no colour and names no numbered palette shade', () => {
    // The classes this ticket ADDS, isolated: every className string in the two
    // notices. `divide-stone-*` and every raw scale are forbidden (#482).
    const SCALE = /\b(?:bg|text|border|ring|divide|from|to|via|fill|stroke|outline|shadow|accent|caret|decoration|placeholder)-(?:red|blue|green|sky|amber|gold|wheat|stone|slate|zinc|neutral|gray|grey|emerald|rose|violet|indigo|orange|yellow|lime|teal|cyan|purple|fuchsia|pink)-\d{2,3}\b/;
    const NEW_CLASSES = [
      'rounded-brand border border-line px-3 text-xs font-semibold text-strong hover:bg-surface-sunken disabled:opacity-50 min-h-11 sm:min-h-0',
      'mt-2 flex flex-wrap gap-2',
    ];
    for (const cls of NEW_CLASSES) {
      expect(cls, 'a hex colour is hardcoded').not.toMatch(/#[0-9a-fA-F]{3,8}/);
      expect(cls, 'a raw Tailwind scale is spelled').not.toMatch(SCALE);
    }
    // And the strings really are the ones on the screen.
    for (const cls of NEW_CLASSES) {
      expect(codeOf(COURSES), `the screen no longer spells "${cls}"`).toContain(cls);
    }
  });

  it('the feature module ships no colour at all - it is a switch, not a style', () => {
    expect(codeOf(FEATURE)).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(codeOf(FEATURE)).not.toMatch(/className/);
  });
});

/* ═══ 19-21 · the guards on the guards ════════════════════════════════════ */

const OWN_SUITES = [
  'src/__tests__/THE-345.paid-events-and-count-guards.test.ts',
  'src/components/__tests__/THE-345.paid-events.test.tsx',
  'src/components/__tests__/THE-345.course-count.test.tsx',
  'src/components/__tests__/THE-345.gate-surfaces.layout.test.tsx',
];

describe('19 · no test in this PR pins a line number', () => {
  it('no suite reads a source file by line index', () => {
    // THE-331 pinned `AdminCommunity.tsx:491`; a deletion shifted it to `:311`,
    // so the suite would have MEASURED WHATEVER LANDED THERE instead of failing.
    // Every line number in this ticket's description will move.
    for (const rel of OWN_SUITES) {
      const code = stripComments(read(rel));
      expect(code, `${rel} splits a source file into lines and indexes it`)
        .not.toMatch(/split\(['"`]\\n['"`]\)\s*\[\s*\d+\s*\]/);
      expect(code, `${rel} names a file:line pair`).not.toMatch(/\.tsx?:\d+/);
    }
  });
});

describe('20 · no fixture in this PR is pinned to a date near today', () => {
  it('no suite spells a calendar date literal', () => {
    // THE NEEDLE IS BUILT, NOT SPELLED. On its first run a guard of this shape
    // FAILED ON ITSELF, because the assertion contained the very literal it was
    // grepping for. #468's fixture turned main red for everyone and THE-324 left
    // one four days out that would have failed SILENTLY.
    const YEAR = ['20', '\\d\\d'].join('');
    const DATE_LITERAL = new RegExp(`\\b${YEAR}-\\d\\d-\\d\\d`);
    for (const rel of OWN_SUITES) {
      expect(stripComments(read(rel)).match(DATE_LITERAL) ?? [],
        `${rel} pins a calendar date`).toEqual([]);
    }
  });

  it('and every fixture instant it does build is far past any CI clock', () => {
    // The one date fixture in this PR is `Date.UTC(2031, 8, 4, ...)` - built
    // from parts, and years beyond any plausible run date, so "near today"
    // cannot become true by the calendar moving.
    for (const rel of OWN_SUITES) {
      const years = [...stripComments(read(rel)).matchAll(/Date\.UTC\(\s*(\d{4})/g)].map((m) => Number(m[1]));
      for (const y of years) {
        expect(y, `${rel} builds an instant in ${y}, which a CI clock could reach`)
          .toBeGreaterThanOrEqual(2030);
      }
    }
  });

  it('and no suite reads the wall clock to decide what to assert', () => {
    const NOW = ['new', ' ', 'Date()'].join('');
    const TODAY = ['Date', '.', 'now()'].join('');
    for (const rel of OWN_SUITES) {
      const code = stripComments(read(rel));
      expect(code.includes(NOW), `${rel} constructs a date from the wall clock`).toBe(false);
      expect(code.includes(TODAY), `${rel} reads the wall clock`).toBe(false);
    }
  });
});

describe('21 · no guard in this PR asserts anything about the current branch diff', () => {
  it('no suite shells out to git or re-derives its own baseline', () => {
    // #454 is a standing sweep. Four guards that read their own diff once
    // blocked every unrelated PR in this repo.
    const FORBIDDEN = [
      ['git', ' ', 'diff'], ['git', ' ', 'show'], ['rev', '-', 'parse'],
      ['exec', '', 'Sync'], ['merge', '-', 'base'], ['spawn', '', 'Sync'],
    ];
    for (const rel of OWN_SUITES) {
      const code = stripComments(read(rel));
      for (const parts of FORBIDDEN) {
        const needle = parts.join('');
        expect(code.includes(needle), `${rel} reaches for "${needle}"`).toBe(false);
      }
    }
  });

  it('and every digest it pins is a LITERAL, not a value it recomputes', () => {
    // A guard that recomputes its own baseline cannot fail - it would simply
    // describe whatever it was handed. That is the "compared a file to itself"
    // defect THE-345 found and fixed in the-308-guards.test.ts.
    const self = stripComments(read(OWN_SUITES[0]));
    expect(self, 'a digest is compared against another read of the same file')
      .not.toMatch(/\.toBe\(\s*sha256\(/);
  });
});

/* ═══ the two files whose statSize proves they exist ══════════════════════ */

describe('this PR adds no dependency and no new primitive', () => {
  it('package.json and the lockfile are byte-identical', () => {
    // THE-274 pins the lockfile to an EXACT LENGTH with no append point.
    expect(sha256(read('package.json'))).toBe('1b2c57071a210a6b07302d2ba6bd90686bf0be05c2fe12e0fb3b197b8ac97da2');
    expect(statSync(path.join(REPO, 'package-lock.json')).size).toBe(590202);
  });
});
