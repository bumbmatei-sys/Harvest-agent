import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { stripComments } from './__fixtures__/the-346-strip-comments';
import { rulesDigestFailure } from './__fixtures__/firestore-rules-pin';
import { ownershipFailure } from './__fixtures__/ownership-register';

/**
 * THE-355 · 🔴 THE WORDS, THE GATES AND THE FILES THIS TICKET MAY NOT TOUCH.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 EVERY CONTENT GREP HERE RUNS OVER PARSER-STRIPPED SOURCE.
 *
 * #496's parser-driven stripper, IMPORTED rather than copied. The inherited
 * hand-rolled one ATE 154 LINES of a file — 85 of them code — and damaged 89
 * files in `src`, because a hand-written scanner cannot read JSX: it treats the
 * apostrophe in "the founder's screenshot" as a string delimiter and
 * desynchronises. A context-free lexer is not enough either — it reads the `//`
 * in `https://{tenantId}.theharvest.app/event/{id}`, written as JSX TEXT in
 * `AdminEvents`, as a line comment. The ranges come off a REAL PARSE.
 *
 * A prose-bearing repository like this one CANNOT be grepped raw: this very
 * file talks about "payment received" in order to forbid it.
 *
 * 🔴 AND NOTHING IS PINNED TO A LINE NUMBER. Every surface is found by pattern,
 * and a pattern that finds nothing THROWS rather than measuring a default.
 *
 * 🔴 #496 FOUND TWO OF ITS OWN GUARDS SELF-MATCHING, so every needle whose
 * subject this file must also name is ASSEMBLED FROM FRAGMENTS.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel: string) => stripComments(read(rel));
const sha = (rel: string) => createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');

/** Every file THE-355 adds, carrying user-facing behaviour. */
const OWNED = [
  'src/app/api/event-payment/public-claim/route.ts',
] as const;

const TOUCHED = [
  ...OWNED,
  'src/lib/event-payment-claims.ts',
  'src/components/PublicEventRegistration.tsx',
  'src/app/event/[eventId]/page.tsx',
  'src/app/api/event-registration/submit/route.ts',
  'src/components/AdminEvents.tsx',
] as const;

/** This ticket's own suites, discovered rather than listed by hand. */
const SUITES = (() => {
  const dirs = [
    'src/__tests__',
    'src/components/__tests__',
    'src/app/api/event-payment/__tests__',
  ];
  return dirs.flatMap((d) =>
    readdirSync(path.join(ROOT, d))
      .filter((f) => f.startsWith('THE-355.'))
      .map((f) => `${d}/${f}`));
})();

const PAGE = 'src/components/PublicEventRegistration.tsx';

/* ═══ 11 · no text implies Harvest verified a payment ════════════════════ */

describe('11 · no text on the public page implies Harvest verified anything', () => {
  it('🔴 every string this ticket added to the copy module is clean', async () => {
    const mod = await import('@/lib/event-payment-claims');
    const { claimsVerification } = mod;

    const checked: string[] = [];
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value === 'string') {
        // ⚠️ The forbidden list ITSELF is a string array in this module and is
        // skipped by name — a list of banned phrases necessarily contains them.
        if (name === 'FORBIDDEN_CLAIM_PHRASES') continue;
        checked.push(name);
        const bad = claimsVerification(value);
        expect(bad, `${name} claims "${bad}" — Harvest verified nothing`).toBeNull();
      }
    }
    // 🔴 THIS TICKET'S OWN ADDITIONS ARE IN THE SWEPT SET, by name. Without this
    // the sweep would still pass if every new constant were somehow skipped.
    for (const added of [
      'PUBLIC_PAY_TITLE', 'PUBLIC_NO_LINKS_TITLE', 'PUBLIC_CLAIM_HELP',
      'PUBLIC_CLAIMED_TITLE', 'REGISTERED_STAT_LABEL',
    ]) {
      expect(checked, `${added} was not swept`).toContain(added);
    }
  });

  it('🔴 every string this ticket’s BUILDERS produce is clean, at real arguments', async () => {
    const {
      claimsVerification, publicPayBody, publicNoLinksBody, publicClaimedBody,
      registrationStatusLabel, REGISTRATION_STATUS_LABEL,
    } = await import('@/lib/event-payment-claims');

    const produced = [
      publicPayBody('Kingdom Living', 5000, 'HV-VSFK4W'),
      publicNoLinksBody('Kingdom Living', 5000, 'HV-VSFK4W'),
      publicClaimedBody('Kingdom Living', 'HV-VSFK4W'),
      ...Object.values(REGISTRATION_STATUS_LABEL),
      registrationStatusLabel('confirmed'),
    ];
    expect(produced.length, 'the builder sweep is vacuous').toBeGreaterThan(5);
    for (const s of produced) {
      expect(s.length, 'a builder produced an empty string').toBeGreaterThan(0);
      expect(claimsVerification(s), `"${s.slice(0, 60)}…" over-claims`).toBeNull();
    }
    // The checker really does reject what it is looking for.
    expect(claimsVerification('We verified your payment')).toBe('verified');
  });

  it('🔴 the forbidden phrases appear in the public page ONLY inside the dormant rail branch', async () => {
    /**
     * ─── THE ONE PLACE "Payment received" IS TRUE, AND IT IS NOT REACHABLE ───
     *
     * THE-351 established the positional claim: the Stripe-return branch may
     * carry those words because, there, a rail really did take the money and
     * really did tell Harvest so. THE-355 keeps the claim and adds the gate
     * that makes the branch unreachable — see the component, and test 3 in
     * `THE-355.public-registration.test.tsx`, which RENDERS the page at
     * `?registration=success` and finds none of them.
     *
     * 🔴 THIS IS THE SOURCE HALF: nothing this ticket added put a forbidden
     * phrase anywhere else in the file.
     */
    const stripped = code(PAGE);
    const railBranch = stripped.indexOf("if (postPayment === 'success')");
    const railBranchEnd = stripped.indexOf("if (postPayment === 'cancel')");
    expect(railBranch, 'the Stripe-return branch could not be found').toBeGreaterThan(-1);
    expect(railBranchEnd).toBeGreaterThan(railBranch);

    const outside = stripped.slice(0, railBranch) + stripped.slice(railBranchEnd);
    const { FORBIDDEN_CLAIM_PHRASES } = await import('@/lib/event-payment-claims');
    for (const phrase of FORBIDDEN_CLAIM_PHRASES) {
      expect(outside.toLowerCase(), `the public page says "${phrase}" outside the rail branch`)
        .not.toContain(phrase);
    }
    // THE-351's own marker is still on this page, and so are this ticket's.
    expect(outside, 'THE-351’s payment note is no longer on this page')
      .toContain('data-public-payment-note');
    for (const marker of ['data-public-pay-options', 'data-public-claim', 'data-public-no-links']) {
      expect(outside, `${marker} is missing — the surface moved`).toContain(marker);
    }
  });

  it('🔴 the dormant rail branch is GATED on the same constant that gates Checkout', async () => {
    /**
     * 🔴 THE STRUCTURAL HALF OF TEST 3. `?registration=success` is a URL ANY
     * VISITOR CAN TYPE; ungated, it rendered a payment confirmation to somebody
     * who had paid nobody. The effect that reads the param now returns early
     * unless `PAID_EVENTS_ENABLED`, which is the SAME constant
     * `manualConfirmationMode()` is built from and therefore the same one that
     * decides whether anyone is ever SENT to Checkout. They cannot drift.
     */
    const stripped = code(PAGE);
    const effect = stripped.slice(
      stripped.indexOf("const [postPayment, setPostPayment]"),
      stripped.indexOf('const dismissPostPayment'),
    );
    expect(effect.length, 'the postPayment effect could not be found — the surface moved')
      .toBeGreaterThan(50);
    expect(effect, '🔴 the rail-return branch is reachable from a query string')
      .toMatch(/if\s*\(!PAID_EVENTS_ENABLED\)\s*return;/);
    // And the gate is read from the module rather than redeclared here.
    expect(stripped).toMatch(/import\s*\{[^}]*PAID_EVENTS_ENABLED[^}]*\}\s*from\s*'\.\.\/lib\/paid-events-feature'/);

    const { PAID_EVENTS_ENABLED, manualConfirmationMode } = await import('@/lib/paid-events-feature');
    expect(PAID_EVENTS_ENABLED, 'the rail is live — this ticket’s premise has changed').toBe(false);
    expect(manualConfirmationMode()).toBe(true);
  });

  it('🔴 the submit button’s copy is DERIVED from the gate, not described from memory', () => {
    const stripped = code(PAGE);
    const btn = stripped.slice(stripped.indexOf('data-public-submit'));
    expect(btn.length, 'the submit button could not be found').toBeGreaterThan(100);
    const label = btn.slice(0, 600);
    // The promise is made ONLY under the condition that makes it true.
    expect(label, 'the button promises a redirect without asking whether one happens')
      .toMatch(/manualConfirmationMode\(\)/);
    expect(label).toContain('Continue to payment');
    expect(label).toContain('Register');
  });
});

/* ═══ 6 · the security shape of the public claim ═════════════════════════ */

describe('6 · the public claim cannot land on another person’s registration', () => {
  it('🔴 the route reads NO registrationId from the body — there is no id to mismatch', () => {
    const src = code('src/app/api/event-payment/public-claim/route.ts');
    // Assembled from fragments: this file must name the field it forbids.
    const ID_READ = new RegExp(['body\\.', 'registration', 'Id'].join(''));
    expect(ID_READ.test('const x = body.' + 'registrationId'), 'the needle matches nothing').toBe(true);
    expect(src, '🔴 the public claim route reads a client-supplied registration id')
      .not.toMatch(ID_READ);
  });

  it('🔴 the document is FOUND BY THE TOKEN, and the read asks for two', () => {
    const src = code('src/app/api/event-payment/public-claim/route.ts');
    expect(src, 'the lookup is no longer by token').toMatch(
      /\.where\(\s*PUBLIC_CLAIM_TOKEN_FIELD\s*,\s*'=='\s*,\s*token\s*\)/,
    );
    /**
     * ⚠️ `limit(2)`, NOT `limit(1)` — THE-324's reading. Two documents sharing a
     * token would mean the generator had collided (at 256 bits it has not) or
     * that one had been written by hand; answering with an arbitrary one would
     * let a token address a row it was not minted for.
     */
    expect(src, 'limit(1) cannot tell a collision from a match').toMatch(/\.limit\(2\)/);
    expect(src, 'an ambiguous token is resolved rather than refused')
      .toMatch(/docs\.length\s*!==\s*1/);
  });

  it('🔴 the route writes NO money state on ANY branch', () => {
    const src = code('src/app/api/event-payment/public-claim/route.ts');
    /**
     * 🔴 STRUCTURAL, NOT A POLICY. A bearer token cannot mark a ticket paid
     * because there is no line in the handler that marks anything paid.
     * `paymentStateOf` keys `confirmed` on the INVOICE ID, which only the
     * confirm route can write and only through THE-350's writer.
     */
    for (const field of ['paymentInvoiceId', 'paymentStatus', 'paymentConfirmedAt', 'amount:']) {
      const assignment = new RegExp(`${field.replace(':', '')}\\s*:`);
      const writes = src.slice(src.indexOf('.update('), src.indexOf('.update(') + 400);
      expect(writes, `the public claim route writes ${field}`).not.toMatch(assignment);
    }
  });

  it('🔴 the token is 256 bits, and the REFERENCE is not accepted as one', async () => {
    const {
      PUBLIC_CLAIM_TOKEN_RE, PUBLIC_CLAIM_TOKEN_BYTES, isPublicClaimToken,
      buildPaymentReference,
    } = await import('@/lib/event-payment-claims');

    expect(PUBLIC_CLAIM_TOKEN_BYTES, 'the token dropped below 256 bits').toBe(32);
    // 32 bytes base64url is 43 characters.
    expect(PUBLIC_CLAIM_TOKEN_RE.source).toContain('43');
    expect(isPublicClaimToken('aZ1_bY2-cX3dW4eV5fU6gT7hS8iR9jQ0kP1lO2mN3oM')).toBe(true);

    /**
     * 🔴 THE REFERENCE IS PUBLISHED BY THE FEATURE ITSELF — written into a
     * payment note, on Venmo, whose transaction feed is PUBLIC BY DEFAULT — and
     * at 31⁶ it is ~29.7 bits. Either fact alone disqualifies it as a
     * credential; together they are STOP condition 3.
     */
    const ref = buildPaymentReference([1, 2, 3, 4, 5, 6]);
    expect(isPublicClaimToken(ref), '🔴 the reference code is accepted as a claim credential')
      .toBe(false);
    for (const junk of ['', 'short', 'x'.repeat(44), 'x'.repeat(42), 'has spaces in it here now ok!!!!!!!!!!!!!!!!']) {
      expect(isPublicClaimToken(junk), `"${junk.slice(0, 12)}" was accepted as a token`).toBe(false);
    }
  });

  it('🔴 the token is minted only for a seat that OWES money, and is not read back out', () => {
    const submit = code('src/app/api/event-registration/submit/route.ts');
    // It lives inside the `owesManualPayment` ternary and nowhere else.
    const branch = submit.slice(
      submit.indexOf('const paymentFields = owesManualPayment'),
      submit.indexOf('if (requiresPayment)'),
    );
    expect(branch.length, 'the paymentFields branch could not be found').toBeGreaterThan(50);
    expect(branch, 'the claim token is not minted with the seat that owes money')
      .toMatch(/paymentClaimToken:\s*randomBytes\(PUBLIC_CLAIM_TOKEN_BYTES\)/);
    expect(submit.match(/paymentClaimToken/g)?.length, 'the token is spelled more than the mint and the return')
      .toBeLessThanOrEqual(3);

    // 🔴 NO OTHER SURFACE HANDS IT BACK. `my-registrations` is the member app's
    // read of the same documents and must not start carrying a credential.
    for (const rel of [
      'src/app/api/my-registrations/route.ts',
      'src/app/api/event-payment/inbox/route.ts',
      'src/app/api/event-payment/confirm/route.ts',
      'src/app/api/event-payment/public-claim/route.ts',
    ]) {
      expect(code(rel), `${rel} returns the claim token`).not.toMatch(/paymentClaimToken\s*:/);
    }
  });

  it('🔴 the page holds the token in state — never in the URL and never in storage', () => {
    const page = code(PAGE);
    const STORAGE = new RegExp(['local' + 'Storage', 'session' + 'Storage', 'document\\.' + 'cookie'].join('|'));
    expect(STORAGE.test('window.local' + 'Storage.setItem()'), 'the needle matches nothing').toBe(true);
    expect(page, '🔴 the claim token could outlive the tab that minted it').not.toMatch(STORAGE);
    // And nothing pushes it into the address bar.
    const claimFn = page.slice(page.indexOf('const pressClaim'), page.indexOf('const startLabel'));
    expect(claimFn.length, 'pressClaim could not be found').toBeGreaterThan(100);
    expect(claimFn, 'the claim token is written into the URL').not.toMatch(/pushState|replaceState|location\.href\s*=/);
  });
});

/* ═══ 18 · primitives, tap targets, colour and emoji ═════════════════════ */

describe('18 · primitives, colour and emoji', () => {
  it('🔴 the payment links are `item` rows and the notices are `alert`s', () => {
    const page = code(PAGE);
    expect(page, 'the payment-link list is not built from `item`')
      .toMatch(/import\s*\{[^}]*\bItem\b[^}]*\}\s*from\s*'\.\/ui\/item'/);
    expect(page, 'the notices are not built from `alert`')
      .toMatch(/import\s*\{[^}]*\bAlert\b[^}]*\}\s*from\s*'\.\/ui\/alert'/);
    expect(page, 'the rule above the block is hand-rolled rather than `separator`')
      .toMatch(/from\s*'\.\/ui\/separator'/);
    // Used, not merely imported.
    for (const tag of ['<Item', '<Alert', '<Separator']) {
      expect(page, `${tag} is imported but never rendered`).toContain(tag);
    }
  });

  it('🔴 43 primitives are on disk and `accordion` is the absent one', () => {
    // Enumerated rather than assumed: the ticket's own list has been wrong.
    const files = readdirSync(path.join(ROOT, 'src/components/ui'))
      .filter((f) => f.endsWith('.tsx'));
    expect(files.length, `the primitive population moved: ${files.length}`).toBe(43);
    expect(files, 'accordion appeared — the ticket’s premise changed').not.toContain('accordion.tsx');
    for (const named of ['button.tsx', 'alert.tsx', 'badge.tsx', 'item.tsx', 'empty.tsx', 'card.tsx', 'separator.tsx']) {
      expect(files, `${named} is gone`).toContain(named);
    }
  });

  it('🔴 every control this ticket adds spends a shared height token, minting none', () => {
    const page = code(PAGE);
    for (const marker of ['data-public-claim', 'data-public-pay-link']) {
      /**
       * ⚠️ THE ATTRIBUTE BOUNDARY IS LOAD-BEARING. `data-public-claim` is a
       * PREFIX of `data-public-claim-done` and `data-public-claim-help`, and a
       * bare `indexOf` lands on whichever comes first in the file — which is
       * the claimed-state panel, a div with no height token on it at all. The
       * first draft of this guard did exactly that and reported the button as
       * missing its tap floor while the button was fine.
       */
      const found = new RegExp(`${marker}(?![-\\w])`).exec(page);
      expect(found, `${marker} could not be found`).not.toBeNull();
      const cls = page.slice(found!.index, found!.index + 500);
      expect(cls, `${marker} does not carry the 44px floor`).toMatch(/min-h-11/);
      expect(cls, `${marker} mints its own above-sm height instead of spending the token`)
        .toMatch(/CONTROL_DENSITY\.action/);
      // 🔴 NO RAW PIXEL HEIGHT of this ticket's own.
      expect(cls, `${marker} mints a raw pixel height`).not.toMatch(/\bh-\[\d+px\]/);
    }
  });

  it('🔴 no colour literal and no emoji in any shipped file this ticket writes', () => {
    for (const rel of [...TOUCHED]) {
      const src = code(rel);
      // 🔴 ONE PALETTE FAMILY (#482). A raw Tailwind scale or a hex literal
      // introduced by this ticket would mint a second.
      const added = rel === 'src/components/AdminEvents.tsx' || rel === 'src/app/event/[eventId]/page.tsx'
        ? '' // pre-existing literals in these two are THE-346's to pin, not this ticket's
        : src;
      expect(added, `${rel} mints a hex colour`).not.toMatch(/#[0-9a-fA-F]{6}\b/);
      expect(added, `${rel} spells a forbidden raw Tailwind scale`).not.toMatch(/divide-stone-\d/);
    }
  });

  it('🔴 no emoji in any SHIPPED file (the suites’ own prose is not shipped)', () => {
    // Assembled so the sweep does not match its own message.
    const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    expect(EMOJI.test(String.fromCodePoint(0x1F534)), 'the needle matches nothing').toBe(true);
    for (const rel of OWNED) {
      expect(code(rel), `${rel} ships an emoji`).not.toMatch(EMOJI);
    }
    // The page's own JSX text, likewise — comments are already stripped.
    const page = code(PAGE);
    for (const m of page.matchAll(/>([^<>{}]{4,})</g)) {
      expect(m[1], `the public page renders an emoji: ${m[1].slice(0, 40)}`).not.toMatch(EMOJI);
    }
  });
});

/* ═══ 19 · the house rules for this ticket's own tests ═══════════════════ */

describe('19 · no line numbers, no fixture near today, no branch-diff guard', () => {
  it('🔴 this ticket has suites in all three homes — the sweeps below are not vacuous', () => {
    expect(SUITES.length, 'no THE-355 suite was discovered').toBeGreaterThan(4);
    for (const dir of ['src/__tests__/', 'src/components/__tests__/', 'src/app/api/event-payment/__tests__/']) {
      expect(SUITES.some((s) => s.startsWith(dir)), `no THE-355 suite in ${dir}`).toBe(true);
    }
  });

  it('🔴 no test in this ticket pins a LINE NUMBER', () => {
    /**
     * THE-331 pinned `AdminCommunity.tsx:491`; a deletion shifted it to `:311`,
     * so the suite would have MEASURED WHATEVER LANDED THERE instead of failing.
     * Every line number in this ticket's own brief WILL move.
     */
    for (const rel of SUITES) {
      expect(stripComments(read(rel)), `${rel} pins a line number`).not.toMatch(/\.tsx?:\d+/);
    }
  });

  it('🔴 no fixture is near today', () => {
    const now = Date.now();
    const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
    let dates = 0;
    for (const rel of SUITES) {
      const stripped = stripComments(read(rel));
      for (const iso of stripped.match(/'\d{4}-\d{2}-\d{2}T[\d:.]+Z'/g) ?? []) {
        dates += 1;
        const t = new Date(iso.slice(1, -1)).getTime();
        expect(Math.abs(t - now), `${rel} carries a fixture within 90 days of today: ${iso}`)
          .toBeGreaterThan(NINETY_DAYS);
      }
      // Any `Date.UTC` fixture is built from parts and must also be far out.
      for (const m of stripped.matchAll(/Date\.UTC\((\d{4})/g)) {
        dates += 1;
        expect(Number(m[1]), `${rel} builds a fixture in ${m[1]}`)
          .toBeGreaterThan(new Date().getUTCFullYear() + 1);
      }
    }
    expect(dates, 'the fixture-date sweep found no dates — it is vacuous').toBeGreaterThan(3);
  });

  it('🔴 no branch-diff guard — nothing here shells out to git', () => {
    /**
     * 🔴 THE NEEDLE IS ASSEMBLED FROM FRAGMENTS. This sweep runs over ITS OWN
     * FILE, so a regex literal spelling the banned calls would make the guard
     * fail on the assertion that forbids them — #496's own self-matching
     * finding, from the other side. #454: a depth-1 clone has no base revision,
     * so a guard that reads one fails for reasons that are not about the code.
     */
    const GIT_CALLS = new RegExp([
      `exec${'Sync'}`,
      `spawn${'Sync'}`,
      `child_${'process'}`,
      `\\bgit (diff|show|rev-${'parse'}|merge-base)\\b`,
    ].join('|'));
    expect(GIT_CALLS.test(`const x = exec${'Sync'}('gi${'t'} di${'ff'}')`)).toBe(true);
    expect(GIT_CALLS.test('readFileSync(path.join(ROOT, rel))')).toBe(false);
    for (const rel of SUITES) {
      expect(stripComments(read(rel)), `${rel} shells out to git`).not.toMatch(GIT_CALLS);
    }
  });

  it('🔴 every file this ticket greps still PARSES after stripping', async () => {
    // #496's own independent check: a stripper that swallowed code would make
    // every guard above read something that is not the code. A line-shape
    // heuristic cannot make this check; parsing the RESULT is the real question.
    const ts = (await import('typescript')).default;
    for (const rel of TOUCHED) {
      const stripped = code(rel);
      const sf = ts.createSourceFile('probe.tsx', stripped, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const errs = (sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics ?? [];
      expect(errs.length, `stripping ${rel} produced ${errs.length} syntax errors`).toBe(0);
      expect(stripped.length, `stripping ${rel} ate the file`)
        .toBeGreaterThan(read(rel).length * 0.2);
    }
  });
});

/* ═══ 20 · the files this ticket may not touch ═══════════════════════════ */

describe('20 · firestore.rules, the indexes, functions/ and layout.tsx are byte-identical', () => {
  it('🔴 all four are untouched', () => {
    /**
     * 🔴 STOP CONDITION 2, ANSWERED STRUCTURALLY. `firestore.rules` AUTO-DEPLOYS
     * on merge with NO EMULATOR TESTS — THE-313's one-line change turned 46
     * files red. This ticket needed no rule change: the public claim is the
     * Admin SDK inside a route, exactly as THE-351's authenticated one is, so
     * the registration UPDATE rule requiring `manageEvents` is untouched and
     * nothing is loosened on a document carrying a money amount.
     *
     * 🔴 AND NO COMPOSITE INDEX. One equality `where` with no `orderBy` is a
     * single-field index Firestore maintains automatically.
     * `firestore.indexes.json` is NOT deployed by `deploy-rules.yml`, so an
     * index added there would be INERT while the query threw
     * `failed-precondition` in production.
     */
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production with no emulator tests')
      .toBeNull();
    expect(sha('firestore.indexes.json')).toBe('8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0');
    expect(sha('src/app/layout.tsx')).toBe('b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f');

    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        if (e.name === 'node_modules' || e.name === 'lib' || e.name === '.git') return [];
        const p = path.join(dir, e.name);
        return e.isDirectory() ? walk(p) : [p];
      });
    const fn = walk(path.join(ROOT, 'functions')).sort();
    const digest = createHash('sha256');
    for (const f of fn) {
      digest.update(path.relative(ROOT, f)).update(readFileSync(f));
      expect(statSync(f).size).toBeGreaterThanOrEqual(0);
    }
    expect(digest.digest('hex')).toBe('4016dc6b342dcbbf44b94994d35d01781c015035205616d4798c142199a1b5bf');
  });

  it('🔴 and THE-355 records NO firestore.rules digest of its own', () => {
    /**
     * #464's rule: the digest of `firestore.rules` is written in EXACTLY ONE
     * place. THE-333 and THE-341 each spelled a copy and both turned THE-325
     * red. This ticket asks through the shared register like every other pinner.
     */
    const record = JSON.parse(read('src/__tests__/__fixtures__/ownership/THE-355.json')) as {
      entries: { file: string }[];
    };
    expect(record.entries.some((e) => e.file.includes('firestore.rules')),
      'THE-355 recorded a firestore.rules digest — #464 forbids it and it needed none')
      .toBe(false);
  });

  it('🔴 every file this ticket touches is at a digest some ticket recorded', () => {
    for (const rel of TOUCHED) {
      const failure = ownershipFailure(rel);
      if (failure !== null) {
        expect(failure, `${rel} is at an unrecorded digest`).toBeNull();
      }
    }
  });

  it('🔴 no new npm dependency, component or token', () => {
    // THE-274 pins the lockfile to an EXACT length with no append path.
    const pkg = JSON.parse(read('package.json'));
    const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
    for (const rel of [...OWNED, PAGE, 'src/app/event/[eventId]/page.tsx']) {
      for (const m of code(rel).matchAll(/from\s+['"]([^'".][^'"]*)['"]/g)) {
        const spec = m[1];
        if (spec.startsWith('@/') || spec.startsWith('.')) continue;
        const pkgName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        if (pkgName.startsWith('node:')) continue;
        expect(names, `${rel} imports ${pkgName}, which is not a dependency`).toContain(pkgName);
      }
    }
    // No primitive was installed: the population is pinned above at 43.
    expect(readdirSync(path.join(ROOT, 'src/components/ui')).filter((f) => f.endsWith('.tsx')).length)
      .toBe(43);
  });

  it('🔴 every shipped file this ticket writes is LF, never CRLF', () => {
    for (const rel of [...TOUCHED, ...SUITES]) {
      expect(read(rel).includes('\r\n'), `${rel} carries CRLF line endings`).toBe(false);
    }
  });
});

/* ═══ 15 · the public registration URL shape is unchanged ════════════════ */

describe('15 · the public registration URL shape is unchanged', () => {
  it('🔴 the route segment and the subdomain shape both still stand', () => {
    // It is PUBLIC and may be printed on something.
    const pageFile = 'src/app/event/[eventId]/page.tsx';
    expect(statSync(path.join(ROOT, pageFile)).isFile(), 'the public event route moved').toBe(true);
    const admin = code('src/components/AdminEvents.tsx');
    const shape = ['https://${', 'tenantId', '}.theharvest.app/event/${'].join('');
    expect(admin, '🔴 the public event URL shape moved').toContain(shape);
  });

  it('🔴 the page still reads the event by its path id and gates draft/cancelled', () => {
    const src = code('src/app/event/[eventId]/page.tsx');
    expect(src).toMatch(/collection\('events'\)\.doc\(eventId\)/);
    expect(src, 'a draft or cancelled event became publicly visible')
      .toMatch(/status === 'draft' \|\| .*status === 'cancelled'/);
    // And discount codes are still withheld from the client.
    expect(src, 'the discount codes leaked to the client').not.toMatch(/discountCodes:\s*data\.discountCodes/);
  });
});
