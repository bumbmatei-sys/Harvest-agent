import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

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

/** The sentence that opens each screen's statement of the fact. */
const LEAD: Record<Screen, string> = {
  'AdminDonations (before a link is pasted)':
    'Harvest does not process these gifts.',
  'AdminGivingStatements (before a statement is sent)':
    'These statements cover Stripe gifts only.',
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

  it('all four name the same four providers', () => {
    for (const screen of SCREENS) {
      const copy = DISCLOSURES[screen];
      for (const provider of ['PayPal', 'Cash App', 'Venmo', 'Zelle']) {
        expect(copy, `${screen} names ${provider}`).toContain(provider);
      }
    }
  });

  it('all four say the gift does not reach Harvest', () => {
    // The shared premise. Every remedy below only makes sense because of it.
    const claims = [/Harvest (never sees|does not process)/, /not (on them|counted here)|do not update/];
    for (const screen of SCREENS) {
      const copy = DISCLOSURES[screen];
      expect(claims.some((c) => c.test(copy)), `${screen} states the gap`).toBe(true);
    }
  });

  it('none of the four claims a manual entry reaches a giving statement', () => {
    // 🔴 THE CONTRADICTION THAT WOULD MATTER MOST. Statements are built from
    // Stripe invoices alone; a screen implying otherwise would put a church's
    // signature on an overstated tax document.
    for (const screen of SCREENS) {
      const copy = DISCLOSURES[screen];
      expect(copy, screen).not.toMatch(/will appear on (a |your )?giving statement/i);
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
    // Two of them state the statement caveat inline; the CRM's is stated on the
    // Donations screen it links from. What none may do is claim the opposite,
    // which the previous test pins for all four.
    expect(DISCLOSURES['AdminDonations (before a link is pasted)'])
      .toMatch(/does not put the gift on a giving statement/);
    expect(DISCLOSURES['AdminFundraising (where the goal is set)'])
      .toMatch(/will not appear on a giving statement/);
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
    expect(donations).toMatch(/that adds to their total given/);
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
