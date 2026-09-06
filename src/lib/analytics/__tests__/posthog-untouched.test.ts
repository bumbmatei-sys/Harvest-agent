import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { PREAUTH_PATHS } from '../../preauth-theme';
import { acceptedRulesDigests } from '../../../__tests__/__fixtures__/firestore-rules-pin';

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
 *
 * ─── THE-265 REGENERATED THIS ONE, deliberately and with reason ────────────
 *
 * 🔴 ONE EXPRESSION, plus the comment that documents it. The pre-paint script's
 * family ternary changed from
 *
 *     e.setAttribute('data-palette',f==='classic'?'classic':'harvest')
 *   to
 *     e.setAttribute('data-palette',f==='harvest'?'harvest':'classic')
 *
 * i.e. a MISSING or garbage stored family now resolves to Classic instead of
 * Harvest. That is the whole of THE-265 in this file. The ternary is still a
 * ternary, still reads the same key, still runs in the same slot, and a stored
 * value on either side is still returned as itself — nobody who has chosen a
 * family loses their choice.
 *
 * The THE-85 pre-auth branch changed in exactly one value alongside it: the
 * family it FORCES, 'harvest' -> 'classic', so the sign-in screen renders what
 * a brand-new visitor gets once they are inside rather than the family the app
 * no longer opens in. It still forces (a stored 'harvest' is ignored there),
 * and it still forces `light` — THE-85's mode rule is untouched, and the
 * `classList.remove('dark')` beside it is byte-identical.
 *
 * ⚠️ VERIFIED, not assumed: THE-85's stated reason for pinning the funnel to
 * Harvest was that only Harvest light had ever been checked. Every text token
 * AuthPage paints now clears AA under Classic light, three of four better than
 * Harvest, and the ground it paints on (`--cream`) is not one of the 14 tokens
 * Classic overrides — so the flip changed the ink, not the paper. Asserted in
 * `preauth-light.test.ts` against the real cascaded Classic-light scope.
 *
 * ⚠️ NOTHING ELSE IN THE LAYOUT MOVED. The
 * tenant brand-colour <style> is byte-identical: it already injected BOTH
 * families' `--brand-color-on-dark` / `--brand-color-on-tint` derivations,
 * each scoped to its own `[data-palette]` selector, so making Classic the
 * default needed no change to it — the cascade picks the Classic rule the
 * moment the script stamps the attribute. `PREAUTH_PATHS` is still
 * interpolated rather than duplicated. No analytics, no import, no ordering.
 *
 * The pre-paint script's own digest below moved for the same one reason, which
 * is the check that says the change was in the script and not elsewhere.
 */
const LAYOUT_SHA = 'bf5f96a61c3fa2f467556f44f0b36e91e49b7c830609b37c775fa6a2b9232ca5';

/**
 * The pre-paint script on its own, extracted the same way `preauth-light.test.ts`
 * extracts it. Pinned separately from the file so a failure says WHICH half
 * moved: the script itself, or something else in the layout.
 *
 * ─── THE-265 REGENERATED THIS ONE, deliberately and with reason ────────────
 * Two values in the script, both the same constant for different reasons: the
 * family ternary's default arm (what a MISSING preference means) and the
 * pre-auth branch's forced family (what the funnel renders regardless of
 * preference). See LAYOUT_SHA above for the before/after. This digest moving
 * while the surrounding layout digest moves too is the expected pairing; this
 * one moving ALONE would be impossible, and the layout one moving alone would
 * mean something outside the script changed.
 */
const PREPAINT_SCRIPT_SHA = 'fa77263023f750462f3fd1b31e28ca8ca342eee3482889de23903ce72052e65d';

function prePaintScript(): string {
  const layout = readFileSync(path.join(ROOT, LAYOUT), 'utf8');
  const match = layout.match(/__html: `(\(function\(\)\{try\{[\s\S]*?)`,/);
  if (!match) throw new Error('pre-paint theme script not found in layout.tsx');
  return match[1];
}

/**
 * Everything else this PR was forbidden to touch, path by path so a failure
 * names the file rather than the group.
 *
 * ⚠️ EACH ROW MAY CARRY MORE THAN ONE ACCEPTED DIGEST, since THE-302. CI runs
 * against `refs/pull/N/merge`, so a file another ticket legitimately changed
 * holds a different value there than it did when this list was written — and a
 * single pin would fail for the one reason it is not meant to detect. The claim
 * is "THIS PR did not touch these", not "these never change".
 *
 * 🔴 A LATER VALUE IS APPENDED TO ITS ROW, NEVER SUBSTITUTED FOR THE OLD ONE. A
 * digest that is on no row still fails, which is the entire threat. `main` was
 * red for everyone last week because #434 substituted instead of appending.
 */
const PINNED: ReadonlyArray<readonly [string, ...string[]]> = [
  ['src/lib/preauth-theme.ts', '1940796f21a9c5219ba6d35d15958eafb34aaada0e3a2670f5d858f65e840ad0'],
  // ─── THE-265 REGENERATED THESE TWO, deliberately and with reason ─────────
  //
  // 🔴 THE DEFAULT PALETTE FAMILY MOVED FROM HARVEST TO CLASSIC. Nothing was
  // deleted to do it: both families' blocks in globals.css are byte-identical
  // (pinned in `the-265-classic-default.test.ts`), `PaletteFamilyToggle` still
  // offers both, and a user with a stored family — either one — still gets it.
  // Only what a MISSING value means changed.
  //
  //   theme.ts          gained `DEFAULT_PALETTE_FAMILY = 'classic'`, the single
  //                     bundled home for that value. No existing export moved:
  //                     both storage keys, `PaletteFamily`, `PALETTE_FAMILIES`,
  //                     `isPaletteFamily`, all four surface constants, and
  //                     every contrast function are byte-identical. In
  //                     particular `deriveOnDarkAccent` and `deriveOnTintAccent`
  //                     are untouched — they already took the ground as an
  //                     argument and already handled both families.
  //
  //   theme-runtime.ts  `readStoredFamily`'s two fall-throughs now return that
  //                     constant instead of spelling `'harvest'`. `applyTheme`
  //                     is byte-identical. The pre-auth force in
  //                     `applyThemeForLocation` now passes the same constant
  //                     rather than `'harvest'`, so the funnel renders what a
  //                     new visitor gets once inside — 🔴 still a FORCE (a
  //                     stored 'harvest' is ignored there), and THE-85's mode
  //                     rule, always light, is untouched. Written as the
  //                     constant and not as `'classic'` so the funnel cannot
  //                     drift from the default the next time it moves.
  //
  // ⚠️ NEITHER FILE GAINED A WRITE. The "reads a preference, never writes one"
  // property both THE-85 and this pin exist to protect is asserted directly in
  // `the-265-classic-default.test.ts` — including the specific new way this
  // ticket could have broken it, which is persisting the resolved default and
  // thereby converting every existing user into someone who has *chosen*
  // Classic, past the reach of the one-value revert.
  ['src/lib/theme-runtime.ts', '499d75f3ee336303d247c02a38c7bcc2338206609066da420842795745d9dee3'],
  ['src/lib/theme.ts', '97d2f057fa04f85f33a1faa0dc196324d51770c6032ca9b4d21e467dfd70d8de'],
  ['src/components/layout/form-layout.ts', 'aa62c7e8c339b35222d9b305be5acf9c6e4c52543174030d8977457fa961ed48'],
  /**
   * 🔴 THE-325 · THE ROW STAYS, its accepted VALUES come from the shared
   * register. `firestore.rules` auto-deploys to production and CI runs no
   * emulator test, so this suite still asserts the file on disk is at a digest
   * some ticket recorded — and 'the pinned set covers the rules' below still
   * finds it here. What moved is only WHERE the accepted list is written, so a
   * legitimate rules change is one new per-ticket record rather than 50 edits.
   */
  ['firestore.rules', ...acceptedRulesDigests().map(([digest]) => digest)],
  ['storage.rules', 'a9b065824c9754007d920926d36081a286190e69c0ce3042242b2eb6da321414'],
  ['firebase.json', 'd87b1c34f95a561f17a3f7b53bf958af404e0beec28b9b4c1f9b9cf19887265c'],
  ['functions/.gcloudignore', '9c20b803e45cd91612bcc0113d5e925422cd5c90686feaa4487e0349ae0951b2'],
  ['functions/package-lock.json', 'bbe18ca8fb92c17d72a991069017be73116d885643dcf681599a958aa3e31681'],
  ['functions/package.json', '33846d2de1bef5e32ab53a5fb37373aa725aab06a6dd12d2e81a1c69ac6034eb'],
  ['functions/src/index.ts', '39ccade96ac3d4dd5a13047e9bc42b54ef5ac59ae72f932af042fc814bf23e0b'],
  ['functions/tsconfig.json', 'a707d5b587803ee0e9224d5943136bbb5be281f3522ce6640def17315a423a25'],
  ['src/app/api/stripe/add-church-billing/route.ts', '4827c8a6ff99863546065ab2b6abd2308d2d44ee1e1ff6ac407cef02dea8c115'],
  // `src/app/api/stripe/cancel-addon/route.ts` was DELETED (THE-253). It
  // cancelled the Telegram assistant's Stripe add-on subscription and its only
  // caller was AiAssistantSection, which is gone — leaving an unreachable
  // authenticated route that mutates Stripe. Cancelling any subscription still
  // live there is a processor action, as it is for the two Dodo products.
  ['src/app/api/stripe/cancel-partnership/route.ts', 'cd8bdbe7b0ae839a81f76955cc1df285fa6b0e1eb326b3804fa16ff161426829'],
  // ─── THE-212 REGENERATED THIS ONE, deliberately and with reason ───────────
  //
  // 🔴 ONE ADDED REFUSAL. The existing-tenant plan-change branch now answers
  // 409 when the tenant is on a tier this build knows and that has no price —
  // Forever Free — and it answers BEFORE `getValidCustomerId`.
  //
  // That ordering is the point. `getValidCustomerId` CREATES a Stripe customer
  // and PERSISTS `stripeCustomerId` on the tenant before the checkout session
  // is built, so a free tenant pressing Upgrade left a permanent Stripe
  // identifier on a church that has never paid Stripe — and the moment that
  // church bought through Dodo it carried identifiers from both processors,
  // which `resolveBillingOwnership` reads as `reason: 'conflict'`: its plan
  // changes and add-ons frozen, by one press of a button.
  //
  // ⚠️ A TIGHTENING, NOT A RELAXATION. `blocksStripeAction` still lets
  // `reason: 'none'` through, unchanged, and `/api/dodo/checkout`'s tenantId
  // guard is untouched. What changed is that the one case that depended on
  // `none` — "a free tenant subscribing for the FIRST time through
  // /api/stripe/checkout" — now has the route THE-203 built for it, and is
  // sent there. `isUnpricedTier`, not `!isPricedPlan`: a RETIRED tier name is
  // also absent from `PLAN_PRICING`, and a legacy tenant on one has a
  // subscription nobody can name and keeps its current path.
  //
  // ⚠️ Conditional on DODO_BILLING_ENABLED, so switching Dodo off restores the
  // Stripe path rather than leaving a tier that can be sold nowhere.
  //
  // No price, no fee, no line item, no metadata, no trial and no signup branch
  // moved. `billing-processor-routing.test.ts` and `checkout/__tests__` pass
  // unedited; the refusal itself is asserted in
  // `src/app/api/dodo/__tests__/the-212-free-tenant-upgrade.test.ts`.
  // ─── REPINNED FOR THE-253 — the Telegram assistant is deleted ─────────────
  //
  // These three carried the retired Telegram assistant's purchase and
  // provisioning wiring, and it is now gone rather than flagged off. What
  // changed in each, and nothing else did:
  //
  //   checkout/route.ts   the `addOn === 'ai-assistant'` branch (a $200/mo
  //                       Stripe subscription on the buyer's own customer) and
  //                       its two imports. The plan path is untouched.
  //   webhook/route.ts    grant/revokePlanIncludedAssistant, the
  //                       `standalone_ai_assistant` provisioning branch, the
  //                       `addOn === 'ai-assistant'` checkout arm, both
  //                       cancellation branches, and the ultra access-code
  //                       write. 🔴 THE TWO EARLY BREAKS STAY: a subscription
  //                       still live in Stripe must not drive a tenant's plan.
  //   billing.ts          AI_ASSISTANT_MONTHLY / AI_ASSISTANT_SETUP, the two
  //                       retired Stripe price ids. PLAN_PRICES is untouched.
  //
  // 🔴 NO PLAN PRICE, PRODUCT ID, PRORATION MODE OR `plan` WRITE MOVED, and the
  // webhook is still the single writer of the plan and the add-on set.
  // firestore.rules and functions/ are NOT in this diff — their hashes above
  // are unchanged, which is the check that says so.
  ['src/app/api/stripe/checkout/route.ts', '03ab52a15f4afd906411109404a58242c203691ad2254a9120dfd72387771723'],
  // ─── THE-256 REGENERATED THESE THREE, deliberately and with reason ───────
  //
  // 🔴 ONE ADDED REFUSAL EACH, and nothing else. Stripe closed the platform
  // account `acct_1U4MOhFzBnH2P7JZ` as `rejected.fraud` on 2026-08-27 (appeal
  // pending, 2-10 days). No church is connected and no money is exposed — what
  // was lost is access. But `/api/stripe/connect` called `accounts.create()`
  // against that dead account with NO GATE AT ALL, so an admin pressing Connect
  // Stripe got a raw Stripe API error, days before the app is shown to 8,000
  // evangelists.
  //
  // Each route now answers 503 with `STRIPE_CONNECT_HIDDEN_MESSAGE` while
  // `STRIPE_CONNECT_ENABLED` is false — the same one-value idiom `lib/
  // sms-feature.ts` already established (THE-245), in its own importless module
  // for the same reason.
  //
  // ⚠️ A GATE IN FRONT, NOT A REMOVAL, and the ordering is what makes that
  // checkable: every added block is the FIRST statement in its handler, ahead of
  // `requireAuth` / `requireOwner` and ahead of Firestore, so it reads and
  // writes nothing — `stripeConnectStatus`, `stripeConnectAccountId` and the
  // affiliate mirror are all untouched, and a connected church comes back whole.
  // Below it not one line moved: the Standard-account creation, the
  // existing-account branch, the affiliate mirror, THE-148's two gone-account
  // signals, the Standard/Express dispatch and all four redirect branches are
  // byte-identical, and every suite that pins them passes with only a
  // `STRIPE_CONNECT_ENABLED: true` mock added — which is what proves the gate is
  // additive. The refusals themselves are asserted in
  // `src/lib/__tests__/the-256-stripe-connect-hidden.test.ts`.
  ['src/app/api/stripe/connect/callback/route.ts', '09268d95196960479fd56a0c49e432b92bbc207db959edd06898bdca28e258dc'],
  ['src/app/api/stripe/connect/login-link/route.ts', '01705197e9828011eb135bbc71e831265005dc039e493b00dd1257d1c259bd36'],
  // ─── THE-155/THE-152 REGENERATED THIS ONE, deliberately and with reason ──
  //
  // 🔴 COMMENTS ONLY — and that claim is itself a test. THE-152 rewrote the
  // affiliate note near the Standard-account creation, which said affiliate
  // payout accounts "are deliberately NOT changed" while this same file writes
  // `affiliateStripeAccountId` / `affiliateConnectStatus` in both branches. Not
  // one statement, condition or field moved: the gate, the Standard creation,
  // the existing-account branch, `mirrorSafe` and both account links are
  // untouched. Pinned as a comment-stripped digest by
  // `src/lib/__tests__/the-155-the-152-stale-money-path-comments.test.ts`,
  // which is what makes "prose only" checkable rather than asserted.
  ['src/app/api/stripe/connect/route.ts', '2c3cb84321cead669bc582e9d8c5cda90cbc5ab675d2d9eab4d1cd52d365b5e3'],
  // 🔴 NOT REGENERATED, AND THAT IS THE POINT. THE-256 deliberately does not
  // gate the Connect webhook: it confirms donations and paid event tickets, so
  // it must stay live for anything already in flight, and it is harmless idle.
  // This unchanged digest is the proof.
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
  //
  // ─── AND THE-256 REGENERATED IT AGAIN, for the reason given on the three
  //     Connect routes above ────────────────────────────────────────────────
  //
  // A donation is a Connect DIRECT charge on the church's own connected account,
  // so it cannot happen while Connect is hidden. One added refusal, FIRST in the
  // handler — ahead of `verifyAuth`, the tenant read, the lifecycle gate, the
  // free-tier gate above and both checkout branches, because this route is
  // deliberately unauthenticated and one-time and monthly both pass through it.
  //
  // ⚠️ AGAIN NO FEE, SPLIT, CURRENCY, CONNECT ACCOUNT OR WEBHOOK PATH MOVED:
  // donate-platform-fee.test.ts, donate-direct-charge.test.ts,
  // donate-free-tier-refused.test.ts and stripe-config-split.test.ts all pass
  // with nothing added but a `STRIPE_CONNECT_ENABLED: true` mock.
  //
  // 🔴 AND IT BREAKS NO PATH THAT IS NOT STRIPE. The route's only callers are
  // CampaignWidget, PublicCampaign and PartnerWithUsTab, all opening a Stripe
  // Checkout Session. The churches' own PayPal / Venmo / Cash App / Zelle / Wise
  // / Revolut links never reach it — Harvest is not in that flow at all — and
  // `/api/event-registration/submit` does not call it either: free, waitlisted
  // and $0 tickets bypass Stripe entirely (`requiresPayment = amount > 0 &&
  // !waitlisted`) and a paid one already fails on its own `connectAccountId`
  // check. Neither file is touched by THE-256.
  ['src/app/api/stripe/donate/route.ts', '04c78731552a29297e41495af61e5202eae7461d954806a3792c0e763ccd26b9'],
  ['src/app/api/stripe/portal/route.ts', 'cbe0b50f7f96845444e6995ae94d61a17354309b4e2c4f56109b9ec703bd237f'],
  ['src/app/api/stripe/remove-church-billing/route.ts', '496d8343c2ae764ccddf1c7d23d710562709add397c8d5cbf6809e6d724bd7d3'],
  // `src/app/api/stripe/standalone-checkout/route.ts` was DELETED (THE-253).
  // It existed solely to sell the Telegram assistant to marketing-site
  // visitors and had been answering 410 behind a false flag since THE-224.
  // A hash cannot pin a file that is gone; its absence is asserted in
  // the-224-ai-assistant-no-seat.test.ts instead.
  ['src/app/api/stripe/update-prices/route.ts', '3ffba67bb4b5943061c46d6bb76020d1d4069599a1e0b248d9b45e3b17d7b12c'],
  ['src/app/api/stripe/update-quantity/route.ts', '308d308cc1becc1b13cabf6c58772e9141e8e6fb84b34b49862408ba740ba927'],
  // ─── THE-219 REGENERATED THIS ONE, deliberately and with reason ───────────
  //
  // 🔴 A VALUE-IDENTICAL SUBSTITUTION, AND THE REASON THE GUARD NEEDED IT.
  //
  // The only edit is `role: 'admin'` → `role: PROVISIONED_TENANT_OWNER_ROLE`,
  // plus the import that names it. The constant IS `'admin'` (src/lib/roles.ts),
  // so the bytes written to Firestore are unchanged and no role gained, lost or
  // altered a permission.
  //
  // THE-219 was reported as a free tenant seeing a collapsed admin nav, and the
  // suspicion was that free provisioning had invented a role value the readers
  // did not recognise. It had not — all three provisioning paths already wrote
  // the same value. The fix was elsewhere (the apex landing, in App.tsx). What
  // remained was that the agreement was a COINCIDENCE of three string literals
  // in three files, with nothing holding it. This is what holds it: the writers
  // now import the value instead of spelling it, so a fourth path has nothing
  // else to write, and `roles/provisioning-roles.test.ts` fails if one tries.
  //
  // ⚠️ A guard that covered only the free path would re-create the bug for the
  // next paid path, which is why this money-path file is in scope at all. No
  // price, fee, plan write, subscription branch or webhook path moved — `plan`
  // still has exactly one writer, and the money-path suites pass unedited.
  ['src/app/api/stripe/webhook/route.ts', '0c4c00421a949c27249c4baf655b1637064beea423a7a250c75cb38f09c16ec5'],
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
  // 🔴 REPINNED FOR THE-226, AND WHAT DID NOT MOVE.
  //
  // The plan-change route gained a GET that REPORTS the term a tenant is billed
  // on, and the existing term-switch refusal gained a `console.warn` plus two
  // machine-readable fields (`requested`, `current`) beside its unchanged
  // sentence. That is the whole diff.
  //
  // ⚠️ THE POST IS OTHERWISE UNTOUCHED. The THE-88 term guard still refuses a
  // cross-term request — `the-226-plan-change-term.test.ts` proves it for both
  // terms a monthly tenant could ask for, and proves Dodo is not called — and
  // the ownership, failed-renewal, trial, same-plan and add-on carry-over guards
  // are byte-identical. No price, no product id, no proration mode and no
  // `plan` write changed; the webhook is still the single writer.
  //
  // The new GET charges nothing and writes nothing. It runs `requireOwner` and
  // then the same `resolveDodoSubscriptionContext` the POST runs, so it is
  // behind every guard the POST is behind and can only ever answer with a pair
  // the POST would itself have resolved.
  ['src/app/api/dodo/change-plan/route.ts', '5ec0e4ce1bd22586e148d78dfb87f690ff6000f4519d81c0c3db48c224d6e298'],
  ['src/app/api/dodo/checkout/route.ts', '0e992294895880a5148b61f864869326fd6092c31fe8169cb878a8eee4a08776'],
  // THE-302 appended: a failed idempotency reservation is answered 5xx so Dodo
  // redelivers, instead of being reported as an already-handled duplicate.
  [
    'src/app/api/dodo/webhook/route.ts',
    '0a30ca691739b717a65aa9dfe0f4c168ad2ec6ae12510b1a574847fd8ede9270',
    '3159d251fa9dfa7070a768ecaa3ad1b6f00f03b9b1eeb6f0b46f46d0319be596',
  ],
  ['src/lib/donation-webhook.ts', 'f835ce195029a246a06d00e4202f8149c54b3a37b4ad9e425a7c1081a317aeed'],
  ['src/lib/donation-receipt.ts', 'a7d4872a73e7eb3518d47c264373428d1663afd43032506e5402123cdab1723a'],
  ['src/lib/donation-history.ts', '47e4c9edfe038efd2497df976254868faef08f8a6c208b4885203908ffda19db'],
  ['src/lib/billing.ts', '44b06fd8dcefbc543726bc1067247df53ebef236cd8ad39c5e1a3c4f9335433c'],
  ['src/lib/billing-processor.ts', '7a60765318e0f0152fb20d490641e585ddf79d638b87d08bae75e32f2958dc87'],
  ['src/lib/affiliate-payout.ts', '27897499fb3e768027c25b015ee6d30dd5ba4bf0763cd40776e4885c36657407'],
  ['src/lib/affiliate-commission-window.ts', '368474f47c541b94cbc51a663c1b0c76bfd50d46d00df03c8001c6eddd6b427c'],
  ['src/lib/money-path-sentry.ts', '2469f323c39050c240570937e52d22bda75d6efdfcaf78152fa5768a95edcbc2'],
  // ─── THE-155 REGENERATED THIS ONE, deliberately and with reason ──────────
  //
  // 🔴 COMMENTS ONLY. Two docblocks still taught that paid event tickets are
  // DESTINATION charges. THE-154 made them direct charges — they were the last
  // destination charge in the codebase — so the prose was describing a topology
  // that no longer exists, next to the fee map. `PLATFORM_FEE_MAP` is
  // byte-identical and still 0 on plus/pro/max; the comment-stripped source is
  // byte-identical too, pinned by
  // `src/lib/__tests__/the-155-the-152-stale-money-path-comments.test.ts`.
  ['src/lib/stripe-connect.ts', 'ca494d925deb1e6dde5a740cbef0c1d24fc48e8e8655222b53ba4cda19b4d6e1'],
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
  // ─── THE-203 REGENERATED THIS ONE, deliberately and with reason ───────────
  //
  // Two changes, both structural, neither touching what an existing paid signup
  // does:
  //
  //  1. `subscription.active` now tries `handleFirstSubscriptionAttach` FIRST
  //     and returns early on a match. A free tenant buying its first
  //     subscription carries `firstSubscription: 'true'` metadata, which
  //     `readSignupMetadata` reads as `not-a-signup` — so without this the
  //     church would be charged by Dodo and never leave the free tier. The two
  //     markers are mutually exclusive by construction (`newTenant` vs
  //     `firstSubscription`, and a payload carrying both is refused), so an
  //     ordinary paid signup takes exactly the path it took before: the new
  //     call answers `not-a-first-subscription` without reading a document.
  //
  //  2. `generateUniqueSubdomain` MOVED to `@/lib/tenant-subdomain` and is
  //     re-exported from here unchanged. Naming a tenant has nothing to do with
  //     a processor, and free tenants are named without one — the import fence
  //     in `dodo-billing-flag.test.ts` refuses any non-Dodo file that reaches
  //     into `lib/dodo/`, and it was RIGHT to refuse `lib/free-provisioning.ts`
  //     rather than be widened for it. Moved, not copied, so there is still one
  //     implementation on this path; the Stripe webhook keeps its own private
  //     copy exactly as before.
  //
  // No provisioning write, no batch, no idempotency guard and no add-on
  // handling changed. `dodo-provisioning*.test.ts` passes unedited.
  // ─── THE-219 REGENERATED THIS ONE, deliberately and with reason ───────────
  //
  // 🔴 A VALUE-IDENTICAL SUBSTITUTION, AND THE REASON THE GUARD NEEDED IT.
  //
  // The only edit is `role: 'admin'` → `role: PROVISIONED_TENANT_OWNER_ROLE`,
  // plus the import that names it. The constant IS `'admin'` (src/lib/roles.ts),
  // so the bytes written to Firestore are unchanged and no role gained, lost or
  // altered a permission.
  //
  // THE-219 was reported as a free tenant seeing a collapsed admin nav, and the
  // suspicion was that free provisioning had invented a role value the readers
  // did not recognise. It had not — all three provisioning paths already wrote
  // the same value. The fix was elsewhere (the apex landing, in App.tsx). What
  // remained was that the agreement was a COINCIDENCE of three string literals
  // in three files, with nothing holding it. This is what holds it: the writers
  // now import the value instead of spelling it, so a fourth path has nothing
  // else to write, and `roles/provisioning-roles.test.ts` fails if one tries.
  //
  // ⚠️ A guard that covered only the free path would re-create the bug for the
  // next paid path, which is why this money-path file is in scope at all. No
  // price, fee, plan write, subscription branch or webhook path moved — `plan`
  // still has exactly one writer, and the money-path suites pass unedited.
  ['src/lib/dodo/provisioning.ts', '348c6ffafc5d9c79fb0b7e03060e89f902dbc8af5b87936e4534d8a6b520eec5'],
  ['src/lib/dodo/renewal.ts', 'fe7fb940ac15edfafd53bca346526e3a43266ad57c29a791a049ef8c512fc6a9'],
  ['src/lib/dodo/subscription-convergence.ts', 'b047d54e588b939ffe5f35e138cf02771033fffb2644a202726098061c3376b4'],
  // THE-302 appended: the `unreserved` outcome and a bounded store timeout.
  [
    'src/lib/dodo/webhook-dispatch.ts',
    '6d5d6e18824efa41eb2b00273c60d8a4724eb15a9f9559fe83913950e07d0e5e',
    'a54e6e033ba8c9aae59189b8e1ae85ef0cf80c8602caf3ffda4fb028928dafab',
  ],
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
  it.each(PINNED)('%s is unchanged', (relativePath, ...accepted) => {
    const actual = digest(relativePath);
    expect(
      accepted.includes(actual),
      `${relativePath} is at ${actual}, which is none of: ${accepted.join(', ')}`,
    ).toBe(true);
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
