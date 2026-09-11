import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';

/**
 * THE-353 — the Stripe platform account is closed, and the fix must be
 * findable in the CODE, not only asserted about in prose.
 *
 * ─── What this file is FOR ────────────────────────────────────────────────
 *
 * `billing-processor.test.ts` and `billing-processor-routing.test.ts` already
 * prove the BEHAVIOUR: a Stripe-owned tenant is blocked, the message names the
 * closed account, `none`/`conflict`/the field-wins rule/the
 * `stripeConnectAccountId` exclusion are all untouched. This file exists for a
 * narrower, easily-missed failure mode: a comment that CLAIMS the fix is wired
 * up while the code beside it does something else — the exact shape that cost
 * CARTO a ticket, and the shape THE-344/THE-352 spent whole files guarding
 * against elsewhere in this repo. Every assertion below reads
 * `STRIPE_PLATFORM_ACCOUNT_OPERATIONAL` OFF THE PARSED, COMMENT-STRIPPED CODE
 * of the function it claims to gate — not off a docblock, and not off this
 * file's own memory of what it wrote.
 *
 * `stripComments` is the shared, parser-driven stripper THE-346/THE-352
 * fixed and now import rather than copy (a hand-rolled regex version ate 151
 * live lines of a real file at CI). Importing it here rather than re-deriving
 * a stripper is that same fix, followed.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const codeOf = (rel: string): string => stripComments(read(rel));

const BILLING_PROCESSOR = 'src/lib/billing-processor.ts';
const PLAN_FEATURES = 'src/utils/plan-features.ts';
const PORTAL_ROUTE = 'src/app/api/stripe/portal/route.ts';

/** Slice a named top-level function's body out of comment-stripped source. */
function functionBody(code: string, signature: string, file: string): string {
  const start = code.indexOf(signature);
  expect(start, `${signature} is no longer declared in ${file}`).toBeGreaterThan(-1);
  const end = code.indexOf('\n}', start);
  expect(end, `${signature}'s closing brace could not be found in ${file}`).toBeGreaterThan(start);
  return code.slice(start, end);
}

describe('0 · the stripper is sound before anything is asserted with it', () => {
  it('strips a comment and keeps the code around it', () => {
    const sample = ["const a = 1; // trailing", '/* block */', 'const b = 2;'].join('\n');
    const stripped = stripComments(sample);
    expect(stripped).not.toContain('trailing');
    expect(stripped).not.toContain('block');
    expect(stripped).toContain('const a = 1;');
    expect(stripped).toContain('const b = 2;');
  });
});

describe('1 · blocksStripeAction actually checks the account flag, not just its comment', () => {
  it('the CODE of blocksStripeAction references STRIPE_PLATFORM_ACCOUNT_OPERATIONAL', () => {
    const body = functionBody(
      codeOf(BILLING_PROCESSOR),
      'export function blocksStripeAction',
      BILLING_PROCESSOR,
    );
    expect(body).toContain('STRIPE_PLATFORM_ACCOUNT_OPERATIONAL');
    expect(body).toContain("ownership.processor === 'stripe'");
  });
});

describe('2 · the refusal names the closed account, in code, distinctly from every other reason', () => {
  it('the CODE of billingActionUnavailable has a branch keyed on processor === "stripe"', () => {
    const code = codeOf(BILLING_PROCESSOR);
    const start = code.indexOf('export function billingActionUnavailable');
    expect(start, `billingActionUnavailable is no longer declared in ${BILLING_PROCESSOR}`).toBeGreaterThan(-1);
    const nextFn = code.indexOf('\nfunction capitalize', start);
    expect(nextFn, 'could not bound billingActionUnavailable\'s body').toBeGreaterThan(start);
    const body = code.slice(start, nextFn);

    expect(body).toContain("ownership.processor === 'stripe'");
    expect(body).toMatch(/not currently active/);
    // Distinct from the pre-existing 'dodo' and 'no active subscription'
    // branches — a Stripe-owned tenant with a real subscription id must not
    // be told it has none.
    expect(body).toMatch(/not available yet for organizations billed through Dodo/);
    expect(body).toMatch(/No active subscription was found/);
  });
});

describe('3 · the portal refuses BEFORE calling the Stripe SDK, in code, not only in prose', () => {
  it('STRIPE_PLATFORM_ACCOUNT_OPERATIONAL is checked, and checked before the real API call', () => {
    const code = codeOf(PORTAL_ROUTE);
    // The NEGATED usage, not a bare mention — the import line at the top of
    // this file also contains the plain name, which sits before every line of
    // the handler by construction and would make this assertion vacuous.
    const guardIdx = code.indexOf('!STRIPE_PLATFORM_ACCOUNT_OPERATIONAL');
    const callIdx = code.indexOf('stripe.billingPortal.sessions.create');

    expect(guardIdx, `${PORTAL_ROUTE} never checks the account flag (only imports it)`).toBeGreaterThan(-1);
    expect(callIdx, `${PORTAL_ROUTE} no longer calls the Stripe SDK at all`).toBeGreaterThan(-1);
    // A guard written AFTER the call it is meant to prevent guards nothing.
    expect(guardIdx, 'the account-flag check runs after the Stripe call it should prevent')
      .toBeLessThan(callIdx);
  });

  it('the Dodo branch is untouched — this route still must never refuse a Dodo-owned tenant', () => {
    const code = codeOf(PORTAL_ROUTE);
    expect(code).toContain("processor === 'dodo'");
    expect(code).toContain('dodoBillingProvider.createCustomerPortal');
  });
});

describe('4 · plan-features.ts no longer promises a working Stripe fallback', () => {
  it('the DODO_BILLING_ENABLED rollback comment is corrected, not merely reworded', () => {
    const src = read(PLAN_FEATURES);
    // The corrective claim is present…
    expect(src).toMatch(/no longer means ["']works["']/i);
    expect(src).toContain('STRIPE_PLATFORM_ACCOUNT_OPERATIONAL');
    // …and the OLD unqualified safety claim — "return to Stripe" as proof the
    // rollback reaches a working processor — no longer appears verbatim.
    // Assembled at run time so this assertion cannot be satisfied by a future
    // edit that merely quotes the retired phrase (this file's own corrective
    // prose legitimately reuses "no other edit" in a different sentence, so
    // that alone is not the needle).
    const oldClaim = ['return to Stripe', 'with no other edit'].join(' ');
    expect(src).not.toContain(oldClaim);
  });
});
