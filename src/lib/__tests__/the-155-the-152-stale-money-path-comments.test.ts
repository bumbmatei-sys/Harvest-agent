import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * THE-155 + THE-152 — two docblocks that described code that no longer exists.
 *
 * ─── Why a stale comment on this particular code is a defect ─────────────────
 *
 * THE-230 shipped the same failure one step later: the account-deletion panel
 * told members their registrations, check-ins, prayer requests and posts stayed
 * in the church's records. All four are deleted. The copy had been true when it
 * was written and the behaviour changed underneath it — and the comment above
 * that copy argued, in good faith, for the claim that had become false.
 *
 * These two are that failure one step EARLIER: comments that were true when
 * written, now false, sitting next to money-path code. Nobody was misled only
 * because nobody had read them.
 *
 *   THE-155 — `src/lib/stripe-connect.ts` said in two places that paid event
 *     tickets are DESTINATION charges. THE-154 converted them to direct
 *     charges; they were the LAST destination charge in the codebase. The
 *     charge topology is precisely what made the platform account's closure
 *     survivable — Standard accounts + direct charges + a 0% fee meant no
 *     church's money was ever frozen — so a docblock still teaching
 *     "destination charges" is an invitation to reintroduce exactly what
 *     THE-154 removed.
 *
 *   THE-152 — `src/app/api/stripe/connect/route.ts` said AFFILIATE PAYOUT
 *     accounts "are deliberately NOT changed", while that same file writes
 *     `affiliateStripeAccountId` / `affiliateConnectStatus` in BOTH of its
 *     branches. What is actually true is narrower and is now what it says.
 *
 * ─── The scope claim is a test, not a promise ────────────────────────────────
 *
 * Section 5 is the one that matters most. Both files' COMMENT-STRIPPED source
 * is pinned to the digest it had before this ticket, so "prose only" is
 * checkable: not a statement, condition or field moved in either file. If a
 * later change to these files is real code, section 5 fails and says so.
 *
 * ⚠️ NO `git show` ANYWHERE, the rule `posthog-untouched.test.ts` already sets.
 * The "before" digests are recorded literals, so this suite works identically
 * on a shallow CI clone, a local checkout and a rebased branch.
 */

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const rawDigest = (rel: string) => sha(readFileSync(path.join(ROOT, rel)));

const LIB = 'src/lib/stripe-connect.ts';
const ROUTE = 'src/app/api/stripe/connect/route.ts';
const SUBMIT = 'src/app/api/event-registration/submit/route.ts';

/**
 * The same stripper `the-256-stripe-connect-hidden.test.ts` uses. The `[^:]`
 * guard keeps `https://` out of the line-comment rule.
 */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * Executable source: comments gone, blank lines gone, trailing space gone. This
 * is what section 5 hashes — a digest that a comment edit CANNOT move, so the
 * only thing that can break it is real code.
 */
const executable = (src: string) =>
  stripComments(src)
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l !== '')
    .join('\n');

/** Prose as a reader meets it: comment markers and wrapping collapsed away. */
const prose = (src: string): string => {
  const blocks: string[] = src.match(/\/\*[\s\S]*?\*\//g) ?? [];
  const lines: string[] = src.match(/^[ \t]*\/\/.*$/gm) ?? [];
  return [...blocks, ...lines]
    .join('\n')
    .replace(/^[ \t]*(\/\*+|\*+\/|\*|\/\/)[ \t]?/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/* ═════════════════════════════════════════════════════════════════════════
   1 — THE-155: the false claim is gone.
   ═════════════════════════════════════════════════════════════════════════ */
describe('1 — stripe-connect.ts does not claim event tickets are destination charges', () => {
  const text = prose(read(LIB));

  it('neither of the two exact phrasings survives', () => {
    // Verbatim, as they stood before this ticket.
    expect(text, 'the module docblock still says tickets are destination charges')
      .not.toMatch(/paid event tickets are still\s+destination charges/i);
    expect(text, 'the fee-map docblock still says tickets are destination charges')
      .not.toMatch(/event tickets, which are destination charges/i);
  });

  it('and no re-worded present-tense claim replaces them', () => {
    // Catches a paraphrase as well as the original: "tickets ... are ...
    // destination charges" inside a single sentence.
    expect(text, 'a present-tense destination-charge claim about tickets remains')
      .not.toMatch(/tickets[^.]{0,80}\bare\b[^.]{0,40}destination charges/i);
    expect(text, 'the fee map is described as applying to a destination charge')
      .not.toMatch(/(?:applied|applies) to[^.]{0,80}destination charge/i);
  });

  it('every surviving mention of a destination charge is history or a warning', () => {
    // The words may appear — THE-154 is worth naming — but never as a claim
    // about what the code does now.
    const mentions = text.match(/.{0,90}destination charge.{0,40}/gi) || [];
    expect(mentions.length, 'expected the ticket history to still be explained')
      .toBeGreaterThan(0);
    for (const m of mentions) {
      expect(m, `reads as a live claim, not history: "${m.trim()}"`)
        .toMatch(/\b(?:no|not|never|was|were|until|last|replaces?d?|no longer|THE-154)\b/i);
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   2 — THE-155: what it says instead.
   ═════════════════════════════════════════════════════════════════════════ */
describe('2 — stripe-connect.ts describes both money paths as direct charges', () => {
  const src = read(LIB);
  const blocks = src.match(/\/\*\*[\s\S]*?\*\//g) || [];

  it('has exactly the two docblocks this ticket corrected', () => {
    expect(blocks).toHaveLength(2);
  });

  it.each([
    ['the module docblock', 0],
    ['the PLATFORM_FEE_MAP docblock', 1],
  ])('%s names both paths and calls both DIRECT', (_label, i) => {
    const text = prose(blocks[i]);
    expect(text, 'donations are not named').toMatch(/donations/i);
    expect(text, 'paid event tickets are not named').toMatch(/(?:paid )?event tickets/i);
    expect(text, 'the charge type is not stated as direct').toMatch(/direct charges/i);
    expect(text, 'still calls a ticket a destination charge')
      .not.toMatch(/tickets[^.]{0,80}\bare\b[^.]{0,40}destination charges/i);
  });

  it('credits the ticket that made it true, so the next reader can check', () => {
    // THE-154 is the change; without the reference this docblock is just an
    // assertion, which is how it went stale the first time.
    expect(prose(src)).toMatch(/THE-154/);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   3 — THE-152: the affiliate comment against what the route actually writes.
   ═════════════════════════════════════════════════════════════════════════ */
describe('3 — the connect route\'s affiliate comment matches what the route writes', () => {
  const src = read(ROUTE);
  const code = executable(src);
  const text = prose(src);

  it('the route writes the affiliate fields in BOTH branches — the fact at issue', () => {
    // The existing-account branch and the new-account branch. This is what made
    // "affiliate accounts are not changed" false.
    const writes = code.match(/affiliateStripeAccountId:/g) || [];
    expect(writes, 'expected an affiliate mirror in each branch').toHaveLength(2);
    expect(code, 'the status field is written too').toMatch(/affiliateConnectStatus/);
  });

  it('the blanket claim is gone', () => {
    expect(text, 'still says affiliate accounts are not changed')
      .not.toMatch(/affiliate payout accounts are deliberately not changed/i);
    expect(text, 'still makes some form of the "not changed" claim')
      .not.toMatch(/affiliate[^.]{0,60}\bnot changed\b/i);
  });

  it('it now says the route DOES write them', () => {
    expect(text, 'the comment does not admit the route writes the affiliate fields')
      .toMatch(/this route does write the connecting user's affiliate fields/i);
  });

  it('and scopes the Express exemption to the standalone payout-only account', () => {
    // `/api/affiliate/onboard` is not uniformly Express: its TENANT branch
    // creates a 'standard' account (THE-147) because that one IS the donations
    // account. Only the tenant-less branch stays Express.
    expect(text, 'the exemption is not scoped to the standalone account')
      .toMatch(/standalone[^.]{0,60}payout-only[^.]{0,80}express/i);
    expect(text, "does not flag /api/affiliate/onboard's own standard branch")
      .toMatch(/tenant[- ]less/i);
    expect(text).toMatch(/THE-147/);
  });

  it('the narrow guarantee it makes is the one `mirrorSafe` actually enforces', () => {
    // The guard blocks the mirror only when ALL THREE hold: the user already
    // has an affiliate account, it is a DIFFERENT one, and it is 'active'.
    // Anything else — no account, the same account, a non-active one — IS
    // repointed, and the comment now says exactly that.
    expect(code, 'the guard is not the three-condition shape the comment describes')
      .toMatch(
        /const mirrorSafe[\s\S]{0,240}?affiliateStripeAccountId[\s\S]{0,120}?!==\s*accountId[\s\S]{0,160}?affiliateConnectStatus\s*===\s*'active'/,
      );
    expect(text, 'the comment does not name the guard').toMatch(/mirrorSafe/);
    expect(text, 'the comment does not say the protection is a DIFFERENT active account')
      .toMatch(/different affiliate account that is already `?active`?/i);
    expect(text, 'the comment does not say a non-active account IS repointed')
      .toMatch(/not active is\s+repointed|is\s+repointed/i);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   4 — no-regression: the fee this ticket must not have touched.
   ═════════════════════════════════════════════════════════════════════════ */
describe('4 — PLATFORM_FEE_MAP is still zero on every tier', () => {
  it('every tier is 0 at runtime', async () => {
    const { PLATFORM_FEE_MAP } = await import('../stripe-connect');
    expect(PLATFORM_FEE_MAP).toEqual({ plus: 0, pro: 0, max: 0 });
    for (const [plan, fee] of Object.entries(PLATFORM_FEE_MAP)) {
      expect(fee, `${plan} takes a cut`).toBe(0);
    }
  });

  it('and 0 in the source, so no build step can be blamed', () => {
    const decl = executable(read(LIB)).match(
      /export const PLATFORM_FEE_MAP[\s\S]*?\};/,
    );
    expect(decl, 'PLATFORM_FEE_MAP declaration not found').not.toBeNull();
    expect(decl![0].replace(/\s+/g, ' ')).toBe(
      'export const PLATFORM_FEE_MAP: Record<string, number> = { plus: 0, pro: 0, max: 0, };',
    );
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   5 — 🔴 THE SCOPE PROOF. Comments only, and here is the evidence.
   ═════════════════════════════════════════════════════════════════════════ */
describe('5 — no executable line changed in either file', () => {
  /**
   * The comment-stripped, blank-line-stripped digest of each file as it stood
   * at `origin/main` (994279b) BEFORE this ticket, recorded here as a literal.
   *
   * ⚠️ These are not the raw file digests — `posthog-untouched.test.ts` and
   * `AdminDonations.section.test.tsx` hold those, and THE-155/THE-152
   * deliberately regenerated them because the prose DID change. These two are
   * the stronger claim underneath: with the prose removed, nothing moved.
   *
   * 🔴 IF ONE OF THESE FAILS, someone changed CODE in a money-path file. That
   * may well be correct — but it is not this ticket, and the digest should be
   * regenerated only by the change that legitimately edits the code, with the
   * reason recorded, exactly as the raw pins are:
   *
   *   node -e "const s=require('fs').readFileSync('<path>','utf8');\
   *   const c=s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/.*\$/gm,'\$1');\
   *   console.log(require('crypto').createHash('sha256').update(c.split('\n')\
   *   .map(l=>l.trimEnd()).filter(l=>l!=='').join('\n')).digest('hex'))"
   */
  const EXECUTABLE_BEFORE: ReadonlyArray<readonly [string, string]> = [
    [LIB, 'cc951f35669c09daefd246b767ca66027e4f82d0c11a859af4add738fe524cf4'],
    [ROUTE, '6dce0cdbfa47630c76e41fb60f0ee0524e7a3bab0dbd3e20e384f146eeae2778'],
  ];

  it.each(EXECUTABLE_BEFORE)(
    '%s — comment-stripped source is byte-identical to before the ticket',
    (rel, before) => {
      expect(sha(executable(read(rel))), `executable source of ${rel} changed`)
        .toBe(before);
    },
  );

  it('the files really did change, so section 5 is not passing vacuously', () => {
    // If the prose had NOT changed, every assertion above would still pass and
    // prove nothing. The raw digests must therefore differ from the pre-ticket
    // ones — the same values the three pin files just regenerated.
    const RAW_BEFORE: Readonly<Record<string, string>> = {
      [LIB]: '30d79c970bc3af7027dc9f8b2ee602d07fba718a7f35292315ba7b59720b01c5',
      [ROUTE]: 'aad13355254fffa791ad049d45685d7b10ed0d114db0197b70d24d0acbaf1380',
    };
    for (const [rel, before] of Object.entries(RAW_BEFORE)) {
      expect(rawDigest(rel), `${rel} was not edited at all`).not.toBe(before);
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   6 — no-regression: the premise THE-155 rests on. Pins THE-154.
   ═════════════════════════════════════════════════════════════════════════ */
describe('6 — event tickets are still direct charges', () => {
  const code = executable(read(SUBMIT));

  it('the checkout session is created AS the connected account', () => {
    expect(code, 'the Stripe-Account request option is gone')
      .toMatch(/const directCharge = \{ stripeAccount: connectAccountId \};/);
    expect(code, 'the session is no longer created on the connected account')
      .toMatch(/stripe\.checkout\.sessions\.create\([\s\S]*?\}, directCharge\);/);
  });

  it('and there is no transfer_data anywhere in the executable source', () => {
    // The words survive in that file's comments and in this suite — which is
    // why this assertion runs on comment-stripped code, not raw text.
    expect(code, 'a transfer_data sweep is back: tickets are a destination charge again')
      .not.toMatch(/transfer_data/);
    expect(code, 'a transfer destination is back on the ticket path')
      .not.toMatch(/destination:/);
  });

  it('the platform fee on that charge still comes from PLATFORM_FEE_MAP', () => {
    expect(code).toMatch(/application_fee_amount: applicationFeeAmount,/);
    expect(read(SUBMIT)).toMatch(/PLATFORM_FEE_MAP/);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   7 — no-regression: the two things a prose ticket must never reach.
   ═════════════════════════════════════════════════════════════════════════ */
describe('7 — firestore.rules and functions/ are byte-identical', () => {
  /**
   * `firestore.rules` auto-deploys to production on merge and the Cloud
   * Functions deploy with it. A comment ticket has no business near either, so
   * they are pinned raw. Same digests `posthog-untouched.test.ts` carries.
   */
  const PINNED: ReadonlyArray<readonly [string, string]> = [
    // ⚠️ REGENERATED ONCE, by THE-313 (#462), which added the `servicePlans` rule
    // inside `match /tenants/{tenantId}` beside `events`: `allow read: if
    // belongsToTenant(tenantId)` and `allow write: if hasPermission('manageEvents',
    // tenantId)`. Purely additive — no existing rule's text moved and it names no new
    // helper, so every other claim this pin carries is unchanged.
    // Was: a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499
    ['firestore.rules', '4973c3c94c5a3be8d478f4373326b23fbd9de447d3ac6a5b8173f723dfd62075'],
    ['functions/.gcloudignore', '9c20b803e45cd91612bcc0113d5e925422cd5c90686feaa4487e0349ae0951b2'],
    ['functions/package-lock.json', 'bbe18ca8fb92c17d72a991069017be73116d885643dcf681599a958aa3e31681'],
    ['functions/package.json', '33846d2de1bef5e32ab53a5fb37373aa725aab06a6dd12d2e81a1c69ac6034eb'],
    ['functions/src/index.ts', '39ccade96ac3d4dd5a13047e9bc42b54ef5ac59ae72f932af042fc814bf23e0b'],
    ['functions/tsconfig.json', 'a707d5b587803ee0e9224d5943136bbb5be281f3522ce6640def17315a423a25'],
  ];

  it.each(PINNED)('%s is untouched', (rel, expected) => {
    expect(rawDigest(rel), `${rel} changed`).toBe(expected);
  });
});
