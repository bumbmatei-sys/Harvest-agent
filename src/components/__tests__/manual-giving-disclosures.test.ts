import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  GIVING_PROVIDERS,
  GIVING_PROVIDER_NAMES,
  GIVING_PROVIDER_NAMES_OR,
} from '../donations/giving-providers';

/**
 * THE-251 — 🔴 THE FOUR DISCLOSURES MUST AGREE WITH ONE ANOTHER.
 *
 * A church now meets the same fact — Harvest does not see a gift sent through
 * its own PayPal / Cash App / Venmo / Zelle link — in four places:
 *
 *   1. AdminDonations          before it pastes a link          (THE-249)
 *   2. AdminGivingStatements   before it sends a tax document   (THE-249)
 *   3. AdminCRM                under the giving totals          (THE-249)
 *   4. AdminFundraising        where the campaign goal is set   (THE-251, new)
 *
 * Four separately-worded statements of one fact is how a product starts
 * contradicting itself: one screen says a manual entry reaches a statement,
 * another says it does not, and the church cannot tell which to believe about
 * its own money. So this file extracts the REAL COPY from all four and asserts
 * the claims they share, rather than trusting four authors to have agreed.
 *
 * ─── 🔴 THE-254 — THE PROVIDER NAMES ARE NO LONGER FOUR COPIES ───────────────
 *
 * All four screens (and the pointer on AdminSettings, which this ticket found
 * naming them too) used to TYPE the provider list out. That held exactly as
 * long as the table did not change: the moment Revolut and Wise were added,
 * five sentences would have gone on promising a narrower product than the one
 * shipping, and a church reading "PayPal, Cash App, Venmo or Zelle" on the
 * statements screen would conclude its Revolut gifts ARE covered. They are not.
 *
 * So the names now interpolate from `GIVING_PROVIDERS`. `proseOf` resolves that
 * interpolation below, which is what lets every assertion here keep reading the
 * sentence a person actually sees — and `no screen types the provider list out
 * by hand` keeps it that way for the seventh provider.
 *
 * ⚠️ READ FROM SOURCE, DELIBERATELY, and this is the one place in this ticket
 * that does. The property under test is a relationship BETWEEN four screens,
 * not the behaviour of any one of them — mounting all four to compare their
 * paragraphs would test four render paths to assert a fact about none of them.
 * Each disclosure's own presence on its own screen IS asserted against rendered
 * output: the campaign one in AdminFundraising.raised-adjustment.test.tsx, and
 * the other three in the THE-249 suites that ship with them.
 */

const SRC = path.resolve(__dirname, '..');

/** JSX source → the prose a person actually reads. */
function proseOf(file: string): string {
  const raw = readFileSync(path.join(SRC, file), 'utf8');
  return raw
    // Block comments carry the REASONING, and they quote the copy — leaving
    // them in would let every assertion below pass on a comment alone.
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    // 🔴 Resolve the one source into the words it renders as. Done BEFORE the
    // tag strip, and only for the two exported constants, so what the rest of
    // this file measures is the sentence the church reads — not an identifier.
    .replace(/\{GIVING_PROVIDER_NAMES_OR\}/g, GIVING_PROVIDER_NAMES_OR)
    .replace(/\{GIVING_PROVIDER_NAMES\}/g, GIVING_PROVIDER_NAMES)
    // Whole-line `//` comments only: a trailing-comment strip would also eat
    // the `https://…` inside the provider examples.
    .replace(/^[ \t]*\/\/[^\n]*$/gm, ' ')
    .replace(/<[^>]*>/g, ' ')       // tags
    .replace(/\{'\s*'\}/g, ' ')     // JSX space literals
    .replace(/&apos;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

const DISCLOSURES = {
  'AdminDonations (before a link is pasted)': proseOf('AdminDonations.tsx'),
  'AdminGivingStatements (before a statement is sent)': proseOf('AdminGivingStatements.tsx'),
  'AdminCRM (under the giving totals)': proseOf('AdminCRM.tsx'),
  'AdminFundraising (where the goal is set)': proseOf('AdminFundraising.tsx'),
} as const;

type Screen = keyof typeof DISCLOSURES;
const SCREENS = Object.keys(DISCLOSURES) as Screen[];

/**
 * Every file whose RENDERED copy names the providers.
 *
 * ⚠️ FIVE, NOT FOUR. THE-249 and THE-251 documented four disclosures; the
 * pointer on AdminSettings ("adding your own … links, now live together in
 * Donations") names them too and was missed by that count. It is not a
 * disclosure — it makes no claim about what Harvest sees — but it is a place
 * the list can go stale, so it is held to the same one source.
 */
const NAMING_FILES = [
  'AdminDonations.tsx',
  'AdminGivingStatements.tsx',
  'AdminCRM.tsx',
  'AdminFundraising.tsx',
  'AdminSettings.tsx',
] as const;

/** The sentence that opens each screen's statement of the fact. */
const LEAD: Record<Screen, string> = {
  'AdminDonations (before a link is pasted)':
    'Harvest does not process these gifts.',
  'AdminGivingStatements (before a statement is sent)':
    // AMENDED BY THE-362 - see manual-payment-link-disclosures for the reason.
    'These statements cover every gift with a receipt.',
  'AdminCRM (under the giving totals)':
    'Gifts sent through your own payment links are not counted here.',
  'AdminFundraising (where the goal is set)':
    'Gifts sent through your own payment links do not update the amount raised.',
};

describe('the four disclosures agree with one another', () => {
  it('all four exist, each on its own screen', () => {
    for (const screen of SCREENS) {
      expect(DISCLOSURES[screen], screen).toContain(LEAD[screen]);
    }
  });

  it('🔴 all four name EVERY provider in the table, wherever they name any', () => {
    // Ranged over the table, never over a written-out list: a suite that named
    // four would pass while the product shipped six, which is the same failure
    // as the copy itself drifting.
    expect(GIVING_PROVIDERS.length, 'the table shrank — check this is deliberate').toBe(6);
    for (const screen of SCREENS) {
      const copy = DISCLOSURES[screen];
      for (const provider of GIVING_PROVIDERS) {
        expect(copy, `${screen} does not name ${provider.label}`).toContain(provider.label);
      }
    }
  });

  it('🔴 no screen types the provider list out by hand — there is one source', () => {
    // The drift guard. Naming the providers in prose is now a reference to
    // `GIVING_PROVIDERS`, so the seventh row updates every sentence at once.
    // Anything that spells the list out is a copy that will go stale, and this
    // fails on the commit that writes it rather than on the ticket after.
    const HAND_WRITTEN = /PayPal[,/ ]+\s*Cash App/i;
    for (const file of [...NAMING_FILES]) {
      const raw = readFileSync(path.join(SRC, file), 'utf8')
        // Comments may still recount the history; only rendered copy is pinned.
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^[ \t]*\/\/[^\n]*$/gm, ' ');
      expect(raw, `${file} writes the provider list out instead of reading the table`)
        .not.toMatch(HAND_WRITTEN);
      expect(raw, `${file} names providers without using the shared source`)
        .toMatch(/GIVING_PROVIDER_NAMES(_OR)?/);
    }
  });

  it('all four say the gift does not reach Harvest', () => {
    // The shared premise. Every remedy below only makes sense because of it.
    //
    // AMENDED BY THE-362. The premise is unchanged - Harvest still never sees a
    // payment-link gift - but one screen now states it as a CONDITION rather
    // than an absolute, because THE-350 made recording one write a receipt:
    // statements carry it "only once somebody records it". The old shape
    // ("not on them", full stop) would now be a false claim, so the branch is
    // added rather than the assertion loosened.
    const claims = [
      /Harvest (never sees|does not process)/,
      /not (on them|counted here)|do not update/,
      /only once somebody records it/,
    ];
    for (const screen of SCREENS) {
      const copy = DISCLOSURES[screen];
      expect(claims.some((c) => c.test(copy)), `${screen} states the gap`).toBe(true);
    }
  });

  it('none of the four claims a manual entry reaches a giving statement UNCONDITIONALLY', () => {
    /**
     * 🔴 AMENDED BY THE-362, AND THE AMENDMENT IS THE POINT OF THE TICKET.
     *
     * This guard was written on the premise that "statements are built from
     * Stripe invoices alone", so any screen saying a manual entry reaches one
     * would be overstating a tax document. THE-350 made that premise FALSE:
     * `recordManualDonation` writes the same `donation_receipt` invoice the
     * webhook writes, and `/api/giving-statements/generate` aggregates it -
     * PROVEN end to end by running both against one store in
     * `THE-362.manual-gift-reaches-the-books`.
     *
     * So the guard was defending the false claim. What it must still forbid is
     * the OVERSTATEMENT, and that is narrower than it was: no screen may
     * promise a statement for a gift that has not been recorded, or for one
     * recorded against a contact with no email address - the generator does
     * `if (!donorEmail) continue`, so such a gift is on the books and on no
     * statement. The unconditional promise is what would put a church's
     * signature on a document it cannot stand behind.
     */
    for (const screen of SCREENS) {
      const copy = DISCLOSURES[screen];
      // An UNCONDITIONAL promise: "will appear on a giving statement" with no
      // "once you record it" in front of it.
      expect(copy, `${screen} promises a statement unconditionally`)
        .not.toMatch(/(?<!not )will appear on (a |your )?giving statement/i);
      // And any screen that DOES mention reaching a statement must also carry
      // the condition, so the promise cannot be read as automatic.
      if (/reaches? a statement|on a giving statement/i.test(copy)) {
        expect(copy, `${screen} promises a statement without naming the condition`)
          .toMatch(/records? it|recorded|email address/i);
      }
      expect(copy, screen).not.toMatch(/added to (a |your )?giving statement/i);
    }
  });

  it('the three that offer a remedy say it does not create a statement entry', () => {
    // AdminDonations and AdminCRM point at Add Activity → Donation;
    // AdminFundraising points at Record an offline gift. All three must carry
    // the same caveat, or a church learns the opposite fact on two screens.
    const withRemedy: Screen[] = [
      'AdminDonations (before a link is pasted)',
      'AdminCRM (under the giving totals)',
      'AdminFundraising (where the goal is set)',
    ];
    for (const screen of withRemedy) {
      const copy = DISCLOSURES[screen];
      expect(copy, `${screen} names a remedy`).toMatch(/Add Activity|Record an offline gift/);
    }
    /**
     * 🔴 AMENDED BY THE-350, AND THE TWO REMEDIES NOW DIFFER — deliberately,
     * because what they DO differs.
     *
     * `AdminDonations` and `AdminCRM` point at Add Activity → Donation, which
     * now writes the same `donation_receipt` invoice the Stripe webhook writes,
     * so that gift DOES reach the year-end statement and the Donations copy
     * says so. `AdminFundraising` points at Record an offline gift, which
     * credits a campaign's `raised` total and writes NO invoice — so its caveat
     * is unchanged and still asserted, byte for byte.
     *
     * ⚠️ THAT IS NOT THE CONTRADICTION THIS SUITE GUARDS AGAINST. The rule is
     * that no screen may claim something the code does not do; two screens
     * describing two different remedies accurately is the suite working. What
     * would be a contradiction — a screen promising a statement entry its
     * remedy cannot produce — is pinned for all four by the test above and by
     * the invoice-writer assertion below.
     */
    expect(DISCLOSURES['AdminDonations (before a link is pasted)'],
      'the Donations remedy no longer says the gift reaches the books')
      .toMatch(/writes a donation receipt/);
    expect(DISCLOSURES['AdminDonations (before a link is pasted)'],
      'the Donations remedy still carries the retired Stripe-only caveat')
      .not.toMatch(/does not put the gift on a giving statement/);
    // 🔴 And that promise is backed by the code that keeps it.
    const repoFile = (rel: string) => readFileSync(path.resolve(SRC, '..', '..', rel), 'utf8');
    expect(repoFile('src/lib/manual-donation.ts'),
      'the Donations copy promises a receipt no writer produces')
      .toMatch(/type: 'donation_receipt',/);
    expect(repoFile('src/components/AdminCRM.tsx'),
      'Add Activity no longer records the gift in the ledger')
      .toMatch(/authFetch\('\/api\/donations\/manual'/);

    // ⚠️ The campaign caveat is UNCHANGED, because Record an offline gift still
    // writes no invoice — it credits `raised` and nothing else.
    expect(DISCLOSURES['AdminFundraising (where the goal is set)'])
      .toMatch(/will not appear on a giving statement/);
    expect(readFileSync(path.join(SRC, 'AdminFundraising.tsx'), 'utf8'),
      'the offline-gift path started writing an invoice — its caveat is now false')
      .not.toMatch(/donation_receipt/);
  });

  it('the campaign disclosure is about the raised total, not the CRM total', () => {
    // Each screen states the consequence THAT screen owns. The campaign one
    // must not repeat the CRM's "total given" claim, or the church reads the
    // same sentence four times and stops reading any of them.
    const campaign = DISCLOSURES['AdminFundraising (where the goal is set)'];
    expect(campaign).toContain('the amount raised');
    expect(campaign).not.toContain('$0 total given');
  });

  it('the CRM disclosure is about the contact total, not the campaign total', () => {
    const crm = DISCLOSURES['AdminCRM (under the giving totals)'];
    expect(crm).toContain('$0 total given');
    expect(crm).not.toContain('the amount raised');
  });

  it('every remedy named is an ADD, never a SET', () => {
    // 🔴 The design invariant the whole ticket rests on. `totalDonated` and
    // `raised` are both incremented by their Stripe writers, so a remedy
    // described as setting a total would be a double-count in prose.
    const crm = DISCLOSURES['AdminCRM (under the giving totals)'];
    const donations = DISCLOSURES['AdminDonations (before a link is pasted)'];
    const campaign = DISCLOSURES['AdminFundraising (where the goal is set)'];
    // ⚠️ THE-350 — still an ADD, and now it says what else the add produces.
    expect(donations).toMatch(/adds to their total given, dates the gift, and writes a donation receipt/);
    expect(crm).toMatch(/enter the amount/);
    expect(campaign).toMatch(/That\s+adds to the total/);
    for (const copy of [crm, donations, campaign]) {
      expect(copy).not.toMatch(/set the (new )?total|replace the total|overwrite/i);
    }
  });

  it('reads as one voice: second person, about the church’s own accounts', () => {
    for (const screen of SCREENS) {
      const copy = DISCLOSURES[screen];
      expect(copy, `${screen} addresses the church directly`).toMatch(/your own payment links|your members|your own PayPal|your CRM/);
    }
  });
});
