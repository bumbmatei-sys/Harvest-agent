import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { PREAUTH_PATHS } from '../../preauth-theme';

/**
 * THE-36 — the files this PR must not have touched, pinned byte for byte.
 *
 * ⚠️ These are HASH PINS, not a diff. `actions/checkout` gives CI a clone whose
 * depth this suite must not depend on, so there is no `git show <rev>:<file>`
 * anywhere here — the expected bytes are the digests below, recorded when this
 * PR was written, and the check works identically on a shallow clone, a local
 * checkout and a rebased branch.
 *
 * ─── If one of these fails on a LATER PR ─────────────────────────────────────
 *
 * It has done its job: something in this list changed, and this list is
 * `firestore.rules` (which auto-deploys to production on merge), the Cloud
 * Functions, every money route, the theme runtime, and the root layout. Those
 * are not files anyone should change by accident.
 *
 * The fix is not to delete the pin. Regenerate the one line for the file you
 * meant to change, in the same PR that changes it, and say in the description
 * why. That is one sentence of review for a deploy that reaches production
 * without a human in the loop.
 *
 *   node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('<path>')).digest('hex'))"
 */

const ROOT = path.resolve(__dirname, '../../../..');

const digest = (relativePath: string): string =>
  createHash('sha256').update(readFileSync(path.join(ROOT, relativePath))).digest('hex');

const LAYOUT = 'src/app/layout.tsx';

/**
 * 🔴 The root layout, whole. 302 lines carrying the pre-paint theme script, the
 * tenant brand-colour injection and the `<html>` stamping — four PRs went into
 * getting the ordering right. PostHog initialises from `AnalyticsBridge`,
 * mounted inside `App.tsx`'s BrowserRouter, precisely so this file did not have
 * to move.
 */
const LAYOUT_SHA = '953b2963652207ac00572d082bb035eaa63161db7f0c049fe1bbc0b311fe6e4e';

/**
 * The pre-paint script on its own, extracted the same way `preauth-light.test.ts`
 * extracts it. Pinned separately from the file so a failure says WHICH half
 * moved: the script itself, or something else in the layout.
 */
const PREPAINT_SCRIPT_SHA = '55d266720cc3309499cbf5a869c912318fdae9ccfebea58efe4c5c1244615d88';

function prePaintScript(): string {
  const layout = readFileSync(path.join(ROOT, LAYOUT), 'utf8');
  const match = layout.match(/__html: `(\(function\(\)\{try\{[\s\S]*?)`,/);
  if (!match) throw new Error('pre-paint theme script not found in layout.tsx');
  return match[1];
}

/**
 * Everything else this PR was forbidden to touch, path by path so a failure
 * names the file rather than the group.
 */
const PINNED: ReadonlyArray<readonly [string, string]> = [
  ['src/lib/preauth-theme.ts', '1940796f21a9c5219ba6d35d15958eafb34aaada0e3a2670f5d858f65e840ad0'],
  ['src/lib/theme-runtime.ts', 'f180368654a2be1d1213feb393a76f8c5b3f2b4c8a677cc957e7229a5fec5991'],
  ['src/lib/theme.ts', 'a6a27940dd1f47d089af6b8018e86927a77e749fde16527c6bc2c2fb49d2446d'],
  ['src/components/layout/form-layout.ts', 'aa62c7e8c339b35222d9b305be5acf9c6e4c52543174030d8977457fa961ed48'],
  ['firestore.rules', 'a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499'],
  ['storage.rules', 'a9b065824c9754007d920926d36081a286190e69c0ce3042242b2eb6da321414'],
  ['firebase.json', 'd87b1c34f95a561f17a3f7b53bf958af404e0beec28b9b4c1f9b9cf19887265c'],
  ['functions/.gcloudignore', '9c20b803e45cd91612bcc0113d5e925422cd5c90686feaa4487e0349ae0951b2'],
  ['functions/package-lock.json', 'bbe18ca8fb92c17d72a991069017be73116d885643dcf681599a958aa3e31681'],
  ['functions/package.json', '33846d2de1bef5e32ab53a5fb37373aa725aab06a6dd12d2e81a1c69ac6034eb'],
  ['functions/src/index.ts', '39ccade96ac3d4dd5a13047e9bc42b54ef5ac59ae72f932af042fc814bf23e0b'],
  ['functions/tsconfig.json', 'a707d5b587803ee0e9224d5943136bbb5be281f3522ce6640def17315a423a25'],
  ['src/app/api/stripe/add-church-billing/route.ts', '4827c8a6ff99863546065ab2b6abd2308d2d44ee1e1ff6ac407cef02dea8c115'],
  ['src/app/api/stripe/cancel-addon/route.ts', '0136081290e5b0b8b87d9959b67b3483d5cd79e8698f2edb59d4c5285baa9c1e'],
  ['src/app/api/stripe/cancel-partnership/route.ts', 'cd8bdbe7b0ae839a81f76955cc1df285fa6b0e1eb326b3804fa16ff161426829'],
  ['src/app/api/stripe/checkout/route.ts', '6186fe2f126dc1d38582c0c675d7ee13cc6c2359e2912025a113046c2c561dc9'],
  ['src/app/api/stripe/connect/callback/route.ts', '52f43a788bb1a5cd60a8ea71d5d97a82fd7347cf4725a61bc11b3e94d53aabc8'],
  ['src/app/api/stripe/connect/login-link/route.ts', '560d9643926e72e66fc9300fccb0ba42bc827b8ead3211c090f662a7cb70e83e'],
  ['src/app/api/stripe/connect/route.ts', 'c3f2e3f1d0780515ded1a81a143b4279ced52533c676b997996a8254049a6a03'],
  ['src/app/api/stripe/connect/webhook/route.ts', 'febfc599c9ffedb31843bc7cb00e58ae50fb2db09998dfd455ad6b2d37054b1e'],
  // ─── THE-202 REGENERATED THIS ONE, deliberately and with reason ───────────
  //
  // 🔴 The free tier has no donate page, and this is where that becomes true.
  //
  // `free.fundraising` is false in the feature matrix and THE-202 hides the
  // Give tab in MainApp, but a hidden tab is not a gate: this route is
  // deliberately reachable without auth so an anonymous donor can give, so
  // anyone holding the URL could POST to it. The route now reads the tenant's
  // plan features and answers 403 BEFORE any Stripe object is created and
  // before the fee arithmetic runs, so a free tenant can never open a Checkout
  // Session.
  //
  // The refusal reuses GIVING_UNAVAILABLE_MESSAGE verbatim rather than naming
  // the tier: the reader is a donor, and a church's subscription plan is not
  // theirs to be told. That is the same reasoning the lifecycle refusal above
  // it already applies.
  //
  // No fee, split, currency, Connect account or webhook path was touched — the
  // added block returns or falls through, and donate-platform-fee.test.ts
  // still passes unedited, which is what proves the money arithmetic did not
  // move. The refusal itself is asserted in
  // src/app/api/stripe/__tests__/donate-free-tier-refused.test.ts.
  ['src/app/api/stripe/donate/route.ts', '8620ef3d28d12e2f6fec3c8f87fd7c778c26d38480720c98ac04eedd459900c2'],
  ['src/app/api/stripe/portal/route.ts', 'cbe0b50f7f96845444e6995ae94d61a17354309b4e2c4f56109b9ec703bd237f'],
  ['src/app/api/stripe/remove-church-billing/route.ts', '496d8343c2ae764ccddf1c7d23d710562709add397c8d5cbf6809e6d724bd7d3'],
  ['src/app/api/stripe/standalone-checkout/route.ts', 'bcd83e66f2b346718b7cf1289881a136f0027c8270f863cb2f59324a4c63cccc'],
  ['src/app/api/stripe/update-prices/route.ts', '3ffba67bb4b5943061c46d6bb76020d1d4069599a1e0b248d9b45e3b17d7b12c'],
  ['src/app/api/stripe/update-quantity/route.ts', '308d308cc1becc1b13cabf6c58772e9141e8e6fb84b34b49862408ba740ba927'],
  ['src/app/api/stripe/webhook/route.ts', '60ceb8fbacbcbbd0118e6239bc0a98640117ed88b72cf0b3797e9e8799fdda3b'],
  // ⚠️ REGENERATED BY THE-199, deliberately and one line each, per the note at
  // the top of this file. The checkout route's `readPeriod` validated against
  // the string literals 'monthly' and 'yearly' and so refused every quarterly
  // signup with a 400; it now reads `BILLING_TERMS`. The add-on route answered
  // with the tenant's PLAN term where the client reads the ADD-ON's own cycle,
  // which cost a quarterly church the price on every add-on card; it now
  // reconciles through `addonPeriodFor`. Nothing else in this list moved —
  // `change-plan` below is untouched and already validated correctly.
  //
  // ─── THE-200 REGENERATED SIX OF THESE, deliberately and with reason ────────
  //
  // Widening `TenantPlan` with a `free` member that has NO price and NO Dodo
  // product made the compiler demand a decision at every money boundary. Each
  // of the six now types on `PricedPlan` (= TenantPlan minus 'free') so that
  // "a free tenant reached a checkout" is a COMPILE error rather than a runtime
  // `undefined` product id. No behaviour changed for any paying church; the
  // narrowing is what proves it cannot.
  //
  //   provider.ts / dodo-provider.ts  — a subscription's plan, a checkout's
  //     plan, and the product→plan reverse lookup can never be 'free'.
  //   catalogue.ts                    — DodoCatalogue is keyed on PricedPlan,
  //     so free has no product row and cannot be given one by accident.
  //   billing-context.ts              — the live-subscription context resolves
  //     FROM a Dodo product id, so it is structurally never free.
  //   checkout/route.ts, change-plan/route.ts — 🔴 THE REAL ONE. Both validate
  //     an UNTRUSTED body's `plan` against a list. That list was `PLAN_ORDER`,
  //     which now contains 'free' — so a POST of `{ plan: 'free' }` would have
  //     passed validation and reached `requireProductId('free', …)`. They now
  //     validate against `PRICED_PLAN_ORDER` and answer 400, which is asserted
  //     in dodo-checkout-quarterly-term.test.ts.
  ['src/app/api/dodo/addons/route.ts', '0a7f2bcae18c89f25f4eefa8fc6ccd263a0e45d46ad968ca934465d9ab659322'],
  ['src/app/api/dodo/change-plan/route.ts', 'ce58d2d14de760b95608ba65797198b934b07423a1ac9437b5ff24a6e4c448f3'],
  ['src/app/api/dodo/checkout/route.ts', '0e992294895880a5148b61f864869326fd6092c31fe8169cb878a8eee4a08776'],
  ['src/app/api/dodo/webhook/route.ts', '0a30ca691739b717a65aa9dfe0f4c168ad2ec6ae12510b1a574847fd8ede9270'],
  ['src/lib/donation-webhook.ts', 'f835ce195029a246a06d00e4202f8149c54b3a37b4ad9e425a7c1081a317aeed'],
  ['src/lib/donation-receipt.ts', 'a7d4872a73e7eb3518d47c264373428d1663afd43032506e5402123cdab1723a'],
  ['src/lib/donation-history.ts', '47e4c9edfe038efd2497df976254868faef08f8a6c208b4885203908ffda19db'],
  ['src/lib/billing.ts', '2944a9d99f68daab65299c10d4d0c54dcb7fb920469c3e602e9ec592c7845802'],
  ['src/lib/billing-processor.ts', '7a60765318e0f0152fb20d490641e585ddf79d638b87d08bae75e32f2958dc87'],
  ['src/lib/affiliate-payout.ts', '27897499fb3e768027c25b015ee6d30dd5ba4bf0763cd40776e4885c36657407'],
  ['src/lib/affiliate-commission-window.ts', 'eda8be967c8e5f15ce8f146e798190cfacdb5c54a238e31176b0517c0d496505'],
  ['src/lib/money-path-sentry.ts', '2469f323c39050c240570937e52d22bda75d6efdfcaf78152fa5768a95edcbc2'],
  ['src/lib/stripe-connect.ts', '30d79c970bc3af7027dc9f8b2ee602d07fba718a7f35292315ba7b59720b01c5'],
  ['src/lib/event-registration-webhook.ts', 'bfc03590515a98f72ef87571c6e11146f78270b170bc04eb22d2fd3b2966d184'],
  ['src/lib/dodo/addon-purchase.ts', '8a71a8bdcf4640c4296a70197f079356545652e9b651e9672c3246bba022b488'],
  ['src/lib/dodo/addons.ts', '46b254f7dc59b9a3fbe5056f6600741c355e52ab43e19b8bd63716c52e584557'],
  ['src/lib/dodo/billing-context.ts', '0b6305b0e1db2eefb126ed6663d2ca808e2e2a1951b36b971339a8e186bb4e61'],
  ['src/lib/dodo/catalogue.ts', '63819b7313479a5b351f56e10c6f43752453ac40cd743fdca2389ab6e5b193d7'],
  ['src/lib/dodo/config.ts', '1ecb3d021960e7b4c09f0a1d15324e74978cda97799830709ae6f6f3cfdfb26a'],
  ['src/lib/dodo/dodo-provider.ts', '2b3e0b168d87b8b88c231fe49a450bc9416561f1a32a7668bd207bd7861d125d'],
  ['src/lib/dodo/events.ts', '0b94d1275c6120a0ccb5c4dfeb3f5c68545e6ecbccf7c276ad87910985034ea9'],
  ['src/lib/dodo/lifecycle.ts', 'cbb85d69d7fccf88f6cf41598f64e5a24e4d4f723c5eab46071fdea9c8aaf1c2'],
  ['src/lib/dodo/plan-change.ts', '7f583417d59d476ddc41c6530acbfe3cd9dcaaf9e8d15279842b9d3db984ce9f'],
  ['src/lib/dodo/provider.ts', '81a795086eee9b9c0d9599bf1cbdf65ceb6820dcd3453629bad5c2838d187bb9'],
  ['src/lib/dodo/provisioning.ts', '31c5f1929fa17bcd8fa841910647f241cb2d29f64af6296c0567366b5c503ab4'],
  ['src/lib/dodo/renewal.ts', 'fe7fb940ac15edfafd53bca346526e3a43266ad57c29a791a049ef8c512fc6a9'],
  ['src/lib/dodo/subscription-convergence.ts', 'b047d54e588b939ffe5f35e138cf02771033fffb2644a202726098061c3376b4'],
  ['src/lib/dodo/webhook-dispatch.ts', '6d5d6e18824efa41eb2b00273c60d8a4724eb15a9f9559fe83913950e07d0e5e'],
  ['src/lib/dodo/webhook-verify.ts', '4cd5a7aca61e3c3c7ffecbebe9d6f589a96bea49da031c1f73019a2f1488838b'],
];

describe('8 — the pre-paint theme script and layout.tsx are unchanged', () => {
  it('the pre-paint theme script and layout.tsx are unchanged', () => {
    expect(digest(LAYOUT), 'src/app/layout.tsx changed — PostHog must not be initialised from the root layout').toBe(LAYOUT_SHA);
  });

  it('the pre-paint script itself is byte-for-byte identical', () => {
    const actual = createHash('sha256').update(prePaintScript()).digest('hex');
    expect(actual, 'the pre-paint theme script changed').toBe(PREPAINT_SCRIPT_SHA);
  });

  it('nothing analytics-shaped was added to the layout', () => {
    const layout = readFileSync(path.join(ROOT, LAYOUT), 'utf8');
    expect(layout).not.toMatch(/posthog/i);
    expect(layout).not.toMatch(/AnalyticsBridge/);
  });

  it('PREAUTH_PATHS is unchanged, and is imported rather than restated', () => {
    // The bridge gates on this list. A copy of it would be a second source of
    // truth for "which screens are pre-auth", which is the drift THE-85 closed.
    expect([...PREAUTH_PATHS]).toEqual(['/auth', '/onboarding', '/church-onboarding']);

    const bridge = readFileSync(path.join(ROOT, 'src/components/AnalyticsBridge.tsx'), 'utf8');
    expect(bridge).toMatch(/from '\.\.\/lib\/preauth-theme'/);
    expect(bridge).not.toMatch(/'\/church-onboarding'/);
  });
});

describe('10 — no money path, rule or function changed', () => {
  it.each(PINNED)('%s is unchanged', (relativePath, expected) => {
    expect(digest(relativePath), `${relativePath} changed`).toBe(expected);
  });

  it('the pinned set actually covers the rules, the functions and the money routes', () => {
    const paths = PINNED.map(([p]) => p);
    // A pin list that quietly lost its entries would pass every assertion above.
    expect(paths).toContain('firestore.rules');
    expect(paths).toContain('storage.rules');
    expect(paths).toContain('firebase.json');
    expect(paths).toContain('functions/src/index.ts');
    expect(paths).toContain('src/app/api/stripe/webhook/route.ts');
    expect(paths).toContain('src/app/api/dodo/webhook/route.ts');
    expect(paths).toContain('src/lib/donation-webhook.ts');
    expect(paths.filter((p) => p.startsWith('src/app/api/stripe/')).length).toBeGreaterThanOrEqual(10);
  });

  it('the theme runtime and form-layout are unchanged too', () => {
    const paths = PINNED.map(([p]) => p);
    expect(paths).toContain('src/lib/theme-runtime.ts');
    expect(paths).toContain('src/lib/theme.ts');
    expect(paths).toContain('src/lib/preauth-theme.ts');
    expect(paths).toContain('src/components/layout/form-layout.ts');
  });

  it('analytics reaches none of them', () => {
    for (const [relativePath] of PINNED) {
      if (!relativePath.endsWith('.ts') && !relativePath.endsWith('.tsx')) continue;
      const source = readFileSync(path.join(ROOT, relativePath), 'utf8');
      expect(source, `${relativePath} references PostHog`).not.toMatch(/posthog/i);
    }
  });
});
