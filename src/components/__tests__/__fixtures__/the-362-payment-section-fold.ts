import { createHash } from 'node:crypto';

/**
 * THE-362 - PaymentSection's heading, FOLDED OUT rather than re-recorded.
 *
 * ---- What moved, and why it had to ----------------------------------------
 *
 * THE FOUNDER: "Hide everything that talks about stripe. In donations,
 * everywhere." THE-350 rewrote the SENTENCE this panel shows while Connect is
 * off - `STRIPE_CONNECT_HIDDEN_MESSAGE`, which names no processor - and left
 * the processor's NAME standing as the `<h3>` directly above it. So the one
 * screen that ticket was about still said it, in larger type than the sentence
 * that was rewritten for them. It now reads "Card giving".
 *
 * ---- Why a FOLD and not a re-record ---------------------------------------
 *
 * THE BASELINE IS SHARED BY EIGHT SUITES. `__fixtures__/the-286-untouched.json`
 * records this file's digest "at PR time from origin/main", and THE-286,
 * THE-296, THE-300, THE-312, THE-316, THE-322, THE-325, THE-339 and THE-347 all
 * read from it. Substituting the value there would bless the change in every
 * one of them at once, in a single edit nobody reviews twice - and THE-355 put
 * the objection best, on `AdminMinistry.desktop-layout`: "Re-recording is the
 * weaker one: it would bless every other byte that moved in the same breath,
 * which is the one thing this guard exists to catch."
 *
 * So the baseline is UNTOUCHED and the edit is REVERSED before each comparison.
 * Every claim those suites make survives intact - "a switched-off section is
 * not convertible", "this slice converts ONE section", "the ten sections this
 * slice did not touch are byte-identical" - and anything else that moves in
 * PaymentSection still goes red tomorrow.
 *
 * ---- What the fold covers, exactly -----------------------------------------
 *
 * TWO REGIONS, and `foldIsExact` below proves each applies exactly once:
 *
 *   1. the comment recording the change, added above the heading;
 *   2. the heading's own text, and nothing else on the line.
 *
 * `StripeConnectPanel` - its four status branches, both fetches and all three
 * handlers - is BYTE-FOR-BYTE untouched, is still not mounted while
 * `STRIPE_CONNECT_ENABLED` is false, and still comes back whole if the switch
 * is ever turned on, exactly as THE-256 requires. No primitive was composed in,
 * no control was added, no route and no gate moved.
 */
export const THE_362_PAYMENT_SECTION_EDITS: ReadonlyArray<readonly [after: string, before: string]> = [
  ["        {/* THE-362 \u2014 the heading, not just the message. THE-350 rewrote the\n            sentence below this line and left the processor's NAME standing over\n            it, so the founder (\"Hide everything that talks about stripe. In\n            donations, everywhere.\") was still reading it on the one screen that\n            ticket was about. The testid is unchanged: it names the STATE, which\n            is still \"Connect is hidden\", and nothing renders it to a church. */}\n",
   ""],
  [">Card giving</h3>",
   ">Stripe Connect</h3>"],
];

/** `PaymentSection.tsx` as THE-362 found it. */
export const unfoldTHE362Payment = (src: string): string =>
  THE_362_PAYMENT_SECTION_EDITS.reduce((acc, [after, before]) => acc.replace(after, before), src);

/** The digest a byte-identity guard should compare, with the fold reversed. */
export const foldedPaymentSectionDigest = (src: string): string =>
  createHash('sha256').update(unfoldTHE362Payment(src)).digest('hex');

/**
 * Everything wrong with the fold, one string per problem. Empty means each
 * region is in the file exactly once and the reversal is complete.
 *
 * A REGION THAT MATCHES NOTHING would make the fold a no-op; one that matched
 * TWICE would silently swallow a second change elsewhere in the file. Both are
 * how an escape hatch stops being small.
 */
export function foldIsExact(src: string): string[] {
  const problems: string[] = [];
  for (const [after] of THE_362_PAYMENT_SECTION_EDITS) {
    const n = src.split(after).length - 1;
    if (n !== 1) problems.push(`a folded region appears ${n} times, not once: ${after.slice(0, 60)}`);
  }
  const unfolded = unfoldTHE362Payment(src);
  if (unfolded.includes('THE-362')) problems.push("the fold left THE-362's own marker behind");
  if (!unfolded.includes('>Stripe Connect</h3>')) problems.push('the heading was not restored');
  if (unfolded.length >= src.length) problems.push('the fold did not shorten the file - it is not a fold');
  return problems;
}
