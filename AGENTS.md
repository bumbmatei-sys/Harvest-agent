# Harvest Agent — Project Context

## What This Is
Harvest (theharvest.app) is a **multi-tenant ministry SaaS** platform. A tenant signs up, gets a subdomain (e.g. `gracechurch.theharvest.app`), and runs its community from an admin dashboard. Members reach the same tenant through a mobile-first web app. Most tenants are churches; not all of them are, and user-facing copy says **"Ministries"**, never "churches".

## The Silent-Failure Rule
Read this before writing anything.

> **A default value that hides an error is a bug.** `= []`, `?? 0`,
> `catch { console.error }`, a status enum whose failure case renders blank — each
> converts a loud failure into a quiet lie. Sentry cannot help here: it reports when
> code *breaks*, not when code runs perfectly and does the wrong thing. Every serious
> bug in this codebase has lived in that second category — a rejected Firestore query
> rendering as "No activities" (#236), lost editor saves (#233, #234), members silently
> dropped from a merge (#239), and a plan advertising 100% donation retention while
> a fee was actually deducted (THE-51).

When a read can fail, make the failure visible: surface an error state, keep the
distinction between "empty" and "could not load", and let the write throw rather than
resolve into a default nobody will question.

**Corollary — `firestore.rules` are not filters.** For a `list`, Firestore must prove
from the **query constraints alone** that every result is readable. It does not evaluate
the rule per document and drop the ones that fail. A rule referencing `resource.data`
therefore rejects the *entire query* when the query does not constrain that field. This
caused #236 and #239. If a list needs a rule that reads document data, the query must
carry the matching `where` — or the read belongs server-side.

## How to read this file
This file is not a specification and it cannot be trusted as one. Every previous
version of it went stale in the same way: it restated a number that a test already
owned, the number moved, and the file kept saying the old one. So the contract here is:

- **If a guard would catch the change, the guard is the truth.** This file names the
  guard and stops. It does not repeat the figure. When the two disagree the test wins,
  and the correct fix is to edit this file, never the test.
- **If nothing executable holds it, it belongs here**, because otherwise it is held
  nowhere.
- **Prefer "why" over "what".** `plan-features.ts`'s fail-closed fallbacks stay a
  correct explanation long after the numbers move; the numbers do not.

Anything you read here that the repo contradicts is a bug in this file. Correct it in
the same PR that found it.

## The money model
The single thing agents get wrong most often. Read the whole section before touching
anything with a dollar sign in it.

**Harvest does not process card payments.** Three declared values say so, each with its
own docblock arguing why it is a separate proposition:

- `STRIPE_CONNECT_ENABLED` (`src/lib/stripe-connect-feature.ts`) — false. There is no
  in-app card giving.
- `STRIPE_PLATFORM_ACCOUNT_OPERATIONAL` (`src/lib/billing-processor.ts`) — false. The
  Stripe platform account was closed by Stripe as `rejected.fraud` and appeals have gone
  unanswered. Any path that still points at it is pointing at a dead account.
- `PAID_EVENTS_ENABLED` (`src/lib/paid-events-feature.ts`) — false. Harvest charging for
  a ticket is a separate proposition from a ministry being paid for one, and only the
  second is live (`MANUAL_EVENT_PAYMENTS_ENABLED`, true).

**Dodo Payments is the only live rail, and only for Harvest's own subscriptions**
(`DODO_BILLING_ENABLED` in `src/utils/plan-features.ts`, true). Signup goes through Dodo
Checkout and the Dodo webhook's `subscription.active` handler is what creates a tenant.
Do not roll that switch back believing the Stripe path still works; the docblock on it
spells out why that is no longer the same claim it was when it was written.

**A ministry collects its own giving through its own payment links** — PayPal, Revolut,
Wise, Venmo, Cash App, Zelle. Harvest takes 0% because Harvest never holds the money.
Links live on the world-readable `tenants/{id}.config.givingLinks` (so the emails on them
are public), and every URL is re-validated on read against a per-provider host allow-list
in `src/components/donations/giving-providers.ts`.

**Nothing counts until somebody records it.** A gift sitting in a ministry's PayPal that
nobody entered does not exist to Harvest. Every figure on every giving surface is a sum
of records a human made.

**Harvest verifies nothing.** The tenant confirms; Harvest records what the tenant says
it confirmed. No copy may say "verified", "payment received", or imply Harvest confirmed
anything. `THE-355.confirmed-wording.test.tsx` polices the wording.

### The invariants, each broken at least once
- **`invoices.amount` is in CENTS.** `AdminAccounting` once rendered `$10,550,000` for
  `$105,500`; three dashboard charts once showed a $50 gift as $5,000. Cents become
  dollars through `formatCents` and nowhere else — `src/lib/donation-history.ts` for the
  member-facing surfaces, and a second one in `src/lib/event-payment-claims.ts` for the
  event surface. **The unit belongs in the field name**: `goalDollars`, `raisedDollars`,
  `givingSeriesCents`. `THE-362.money-units.test.tsx` sweeps for the violation.
- **The invoice is the money record.** The CRM activity that accompanies a gift points at
  it by `invoiceId` and carries `amount: null`, so nothing can sum the gift twice.
  Summing `contactActivities` will not give you a giving total, and a sweep asserts that
  no surface tries.
- **A gift reaches a member by normalised email.** `normalizeEmail`
  (`src/lib/donation-history.ts`) trims and lowercases, and the identity match normalises
  *both* sides — that is what makes "member A cannot see member B's receipts" hold
  regardless of the casing either was recorded in. Note the divergence: the giving-
  statement generator (`src/app/api/giving-statements/generate/route.ts`) groups donors on
  `.toLowerCase()` alone, with no trim. If you touch that grouping, route it through the
  shared helper rather than adding a third spelling.
- **A gift against a contact with no email counts in the books but can never reach a
  giving statement.** The generator skips a donor with an empty `recipientEmail` outright.
  That is deliberate — there is nobody to send it to — but it means the books and the
  statements can legitimately disagree, and a surface that presents them as the same
  number is lying.
- **Check-in never blocks on payment**, and Harvest makes no promise about what happens at
  a tenant's actual door, because Harvest does not know their policy.
- **Paid events run on trust, in this order:** register unpaid, pay the ministry using a
  reference code, tell Harvest "I've paid", the ministry confirms from its own account.
  The QR and ticket code are withheld on a paid ticket until that confirmation lands. A
  free ticket shows its QR immediately.

## Plans, add-ons and prices
Source of truth: `src/utils/plan-features.ts` — `PLAN_FEATURES` for the matrix,
`PLAN_PRICING` for the nine prices, `TERM_MONTHS` for the term arithmetic. **This file
deliberately restates none of those numbers.** The previous version of this section
carried a full price-and-caps table; every cell in it was wrong by the time anyone read
it again.

What you cannot read off the table, and therefore needs saying:

- **There are four tiers: `free`, `plus`, `pro`, `max`** (displayed Forever Free,
  Individual, Small Team, Ministry). `free` is **absent from `PLAN_PRICING` by design** —
  it is not a `$0` row, it has no price and no billing term, and `planPriceUsd('free', …)`
  is a compile error. Narrow with `isPricedPlan` first.
- **Free is capped, not unlimited, and it is capped at the same contact figure as the
  cheapest paid tier.** That is intentional as of THE-370: Individual is now bought for
  capability, not capacity. Free is for one evangelist doing personal discipleship — one
  admin, one adopted course, no feed, no giving page, and zero campuses ("a free tenant is
  one evangelist, not a multi-campus ministry").
- **Campuses are unlimited on every paid tier** and zero on free. The cap sentinel is
  `UNLIMITED_CAP = -1`, and it is a *number*, so any new consumer comparing with `>=` or
  `<` must learn the sentinel or it will report a church as at its limit forever.
- **A campus is a sub-entity of a tenant, never a tenant of its own.** The cap that counts
  them is `maxChurches`. A multi-campus ministry is one tenant, one subdomain, one
  subscription — do not model a second campus by provisioning a second tenant.
- **There are exactly three add-ons**: AI Assistant, Admin Seats, Unlimited Contacts
  (`TenantAddons` in `src/types/tenant.types.ts`). `contactPacks` and `campuses` were
  retired in THE-370 and their Dodo products detached from all nine plan products, so
  neither is purchasable. A stale `campuses: 2` may still sit in a live document;
  `readTenantAddons` reads only the fields it names, so a retired key grants nothing.
- **Add-on prices are not in this repo and must not be copied into it.** Prices are
  settled in Dodo and quoted by the marketing site; this repo maps add-on IDs to meanings
  (`src/lib/dodo/catalogue.ts`) and carries no figure. A stale $200 add-on price outlived
  its product here once already.
- **Dodo add-ons are `client.addons`, not `client.products`**, and they exist in two sets
  with different IDs — monthly and annual. `addonIdFor(meaning, period)` performs the
  mapping; a quarterly subscription carries the monthly add-on IDs.
- **`unlimitedContacts` is a separate boolean and stays one.** It is not folded into
  `maxContacts`, so `maxContacts` is always a real, finite, honest number and the
  unlimited fact travels beside it.
- **The nine prices are contract-pinned across both repos.** The marketing site carries
  its own copy and a module-scope contract there compares the whole table against what
  this file publishes — the site's **build throws at prerender** if they disagree. A price
  change must land in both repos together.
- **`maxContacts` is enforced in two places with two different strengths.** New member
  signup is a hard server-side gate at custom-claim issuance (`src/lib/member-capacity.ts`,
  `POST /api/auth/set-claims`): a new applicant over the cap gets 403 `member_cap_reached`
  and no `tenantId` claim is minted. A capacity check that itself fails answers 503
  `capacity_check_unavailable` — fail-closed, claims withheld, and the copy does not claim
  the ministry is full. Existing members always sign in; nothing is ever removed or
  demoted. The admin's manual contact add is a **client-side gate only**
  (`src/utils/contact-capacity.ts`), shares no code with the signup gate, and only
  `AdminCRM.tsx` may import it.
- **Minimum-plan labels on upgrade screens are derived** from the matrix
  (`getFeatureMinPlan` / `FEATURE_MIN_PLAN`). Never put a literal plan name in a gate
  message.
- **The webhook is the single writer of `plan`** (swept by THE-259 and pinned in several
  suites). No client-side write to that field, ever.

## Hidden features — do NOT describe these as available
Each is a master switch, each is a single declared value, each hides every user-facing
surface while leaving the backend intact so it can be restored by flipping one boolean.
`THE-335.hidden-features.test.ts` asserts they are false and that nothing behind them was
deleted.

| Switch | File |
|--------|------|
| `SMS_FEATURE_ENABLED` | `src/lib/sms-feature.ts` |
| `NEWSLETTER_FEATURE_ENABLED` | `src/lib/newsletter-feature.ts` |
| `QUICKBOOKS_FEATURE_ENABLED` | `src/lib/quickbooks-feature.ts` |
| `GMAIL_FEATURE_ENABLED` | `src/lib/gmail-feature.ts` |
| `CUSTOM_DOMAIN_ENABLED` | `src/lib/custom-domain-feature.ts` |
| `STRIPE_CONNECT_ENABLED` | `src/lib/stripe-connect-feature.ts` |
| `PAID_EVENTS_ENABLED` | `src/lib/paid-events-feature.ts` |
| `AFFILIATE_PROGRAM_ENABLED` | `src/utils/plan-features.ts` |

So: **SMS automation and text-to-give, the newsletter and automated newsletter, custom
domains, the Gmail connection, QuickBooks, in-app card giving, paid-event charging and
the affiliate programme are all unavailable today.** A plan cell may still read `true` for
one of them — the plan matrix says what a tier *entitles*, the switch says what the
deployment *serves*, and the switch wins. Do not read a `true` cell as a shipped feature.

Two more that are easy to get wrong:

- **No custom domain has ever provisioned.** The Vercel subscription was never bought, so
  the path has never run end to end against a live plan.
- **`aiChat` is `false` on every tier including Ministry.** Ask Harvest is an add-on, not
  a plan inclusion. `getEffectiveFeatures` turns it on only when the tenant holds the
  add-on.

The hidden routes answer **503**, not 404: the route exists and is coming back, which is
what a provider retry and an admin's stale tab should both be told.

## The guard culture
This repo defends itself with executable guards, not conventions. That is the single most
important thing to understand before writing a test here.

**Guards in this series have passed a planted defect, repeatedly, and every one of them
was caught by MUTATION — none by reading.** Write the guard, then break the thing it
guards and watch it go red. If it does not, it is not a guard.

The failure shapes, each of them real:

- A guard passed with **its own gate deleted**, because the assertion's *message* contained
  the string it was grepping for.
- A guard **compared a file to itself**.
- A guard was satisfied by an **import line** that happened to carry the word.
- A guard read a **docblock 700 lines away** that quoted the rule while explaining it.
- Two were vacuous because an **empty `slice`** made them trivially true.
- One hardcoded **element order**, so moving a button changed nothing and 27 assertions
  kept passing.
- One used **`pointerEvents: none`** in a copied occlusion probe, so `elementFromPoint`
  skipped it and the check was *structurally unable to fail*.
- A hand-rolled **comment stripper ate 154 lines** of a file, 85 of them code, because a
  JSX-comment regex anchored on `interface X {`. It damaged 89 files.
- A sweep on the marketing site read a **test file as source text** and failed a build on a
  price written inside a comment that was explaining that test.

Hence the two rules that follow from them:

1. **Every content grep runs over parser-stripped source**, using the shared stripper at
   `src/__tests__/__fixtures__/the-346-strip-comments.ts` — **imported, never copied**. It
   uses TypeScript's real parser (`ts.createSourceFile`), not a lexer and not a regex,
   because only a parser knows it is standing in JSX. A hand-rolled scanner desynchronises
   on an apostrophe in JSX text; `ts.createScanner` eats the `//` in a URL written as JSX
   text. Both failures are silent.
2. **Assemble any self-matching needle from fragments.** A guard that greps for a literal
   the guard itself spells will find itself.

And the structural rules:

- **No guard may assert anything about the current branch's diff** in the non-empty
  direction ("the diff contains X", "more than zero files changed"). Such an assertion is
  true on its own branch and false for every branch after it merges, so it blocks
  unrelated PRs. The *empty* direction ("this file is not in the diff") is a freeze and
  gets more true on merge — that one is fine. `THE-315.branch-diff-guards.test.ts` is the
  repo-wide detector; read its docblock before writing any sweep.
- **Nothing shells out to git at assertion time** where it can be avoided. CI checks out
  `refs/pull/N/merge`, so `origin/main` may not exist, and a depth-1 clone has no base
  revision at all. Walk the working tree instead.
- **A sweep over tracked files only will miss a file you have not `git add`ed yet.**
  THE-347's CI went red for exactly that. Track every new file before the final run.
- **No fixture may be pinned near today's date.**
- **`vi.useFakeTimers({ toFake: ['Date'] })` — `toFake` is load-bearing.** A plain
  `useFakeTimers()` also fakes `setTimeout`, which mount helpers await: 28 of 47 tests
  timed out and one run went from 4s to 141s.
- **`happy-dom` has no layout engine.** Anything that measures needs the
  `// @vitest-environment node` pragma and `src/test/support/browser-measure.ts`; a DOM
  environment breaks the CDP attach.
- **Suppress transitions before measuring.** `transition-all` animates width and height —
  the exact numbers a probe reads. A measured `min-h-[44px]` came back as 7.7469px, and a
  menu row as 41.79998779296875px, which is 44 x 0.95 caught mid-animation.
- **The ownership register is per ticket.** Add
  `src/__tests__/__fixtures__/ownership/THE-nnn.json` — your ticket, nobody else's — with a
  digest, a ticket and a reason for each entry. Never edit another ticket's file and never
  replace a digest that is already there. Four PRs once conflicted in sequence on one
  shared map, which is why this is a directory.
- **Digest pins: append with ticket and reason, never substitute.** `main` went red for
  everyone once because a PR replaced one instead of adding to it.

## Standing constraints
- **`firestore.rules` auto-deploys to production on merge.**
  `.github/workflows/deploy-rules.yml` fires on any push to `main` touching
  `firestore.rules`, `storage.rules` or `firebase.json`. **CI runs no emulator rules
  tests** — `npm test` only covers `src/**`. Run `npm run test:rules` yourself for any
  rules change, because nothing else will. THE-313's one-line change turned 46 files red.
  Never change this file without reporting the exact rule you changed.
- **`firestore.indexes.json` does NOT deploy.** That workflow runs
  `firebase deploy --only firestore:rules,storage`. Every composite index in the project
  was created by hand in the console. **A new composite index committed to this file is
  inert, and the query that needs it throws `failed-precondition` in production.**
- **`functions/` does NOT deploy on merge.** It needs a separate
  `firebase deploy --only functions` from Cloud Shell, and its own
  `npm install && npm run build` inside `functions/` first. Merging a Cloud Function change
  and assuming it shipped is a standing trap.
- **No new dependency.** The lockfile is pinned to an exact byte size with no append
  point; `@tanstack/react-virtual` had to be backed out over this. If you genuinely need a
  package, stop and report before adding it.
- **`src/app/layout.tsx` is pinned by a large number of suites and only a few of them have
  an append path.** Treat it as frozen.
- **`sendTenantSms` (`src/lib/sms-send.ts`) is the only SMS interface** and
  `src/lib/transactional-email.ts` is the only email funnel. THE-340 found eleven inlined
  Resend sends, none of them behind a function. Do not add a twelfth.
- **Four host resolvers must stay in sync**, all deriving from
  `src/utils/non-tenant-subdomains.ts`: `getTenantIdFromHost()` (`tenant-scope.ts`),
  `resolveTenantIdFromHostname()` (`TenantContext.tsx`), `getTenantFromHost()`
  (`server-tenant.ts`) and AuthPage's derivation. A disagreement between them is the bug
  class behind #181 and #185. Never hardcode a subdomain string.
- **Super admin `tenantId` is `null`.** Any tenant-scoped write must resolve a real
  `tenantId` first or it writes to `tenants/null/...`.
- **No unordered `limit(N)`.** Firestore has no default order, so an unordered limit
  returns arbitrary rows. #405 found 41 files doing it.
- **A figure ships only if its read is exact or provably complete.** Where a list is
  capped, the screen says so. `THE-342.read-honesty-guards.test.ts` owns this.
- **No emoji in rendered code**, and none in this file. The repo's prose comments do use
  emoji as section markers and that is accepted; what the guards forbid is an emoji
  reaching a component's *code* or a user's screen.
- **LF, never CRLF.** `.gitattributes` forces `eol=lf` in the working tree on every
  platform because dozens of suites pin file contents by `sha256`. A CRLF checkout breaks
  them all at once and presents, misleadingly, as "the shadcn primitives have all drifted".
  If a digest fails, fix the line endings — never re-record the hash.
- **Windows has bitten this repo repeatedly.** `path.relative` returns backslashes there
  and caused roughly 67 false failures. Normalise separators in anything that builds a
  path for comparison, and do not assume a symlink survives a Windows checkout — git
  materialises one as a plain text file unless `core.symlinks` is on.

## Tech Stack
- **Framework**: Next.js 14 (App Router) + React 18 + TypeScript
- **Styling**: Tailwind CSS + Framer Motion (motion)
- **Backend**: Firebase (Firestore, Auth, Storage)
- **Subscription billing**: Dodo Payments (merchant of record). Stripe is present in the
  tree but its platform account is closed — see the money model above.
- **Email**: Resend, through `src/lib/transactional-email.ts`
- **AI**: Xiaomi MiMo (`MIMO_MODEL`, `src/lib/ai-config.ts`) for RAG chat; Gemini for
  embeddings and video. `src/lib/ai-config.ts` is the single place a model swap happens.
  `MIMO_BASE_URL` is per-region and must include `/v1` (the code appends
  `/chat/completions`); a key only authenticates against its own region's base URL.
  **Standing launch blocker:** the key in use is a Token Plan subscription key, and the
  Token Plan terms forbid using one as an application backend. A pay-as-you-go key is
  required before launch. Nothing in the tree enforces this, which is why it is here.
- **Maps**: Leaflet + Google Places Autocomplete
- **Rich Text**: TipTap
- **Hosting**: Vercel (app) + Firebase (Firestore/Auth)
- **Testing**: Vitest + Testing Library, `happy-dom` by default, `node` for measurement
- **Monitoring**: Sentry (client, server, edge; source maps uploaded then deleted)

## Traps
Each of these has already cost real time. None are obvious from the code.

- **`typescript: { ignoreBuildErrors: true }`** in `next.config.mjs` — a green Vercel
  build proves *nothing* about types. Run `npm run typecheck` yourself and diff against a
  baseline measured on the same checkout.
- **`skipWaiting: false`** (next-pwa) — a new service worker waits for every tab on the
  origin to close before activating. Deliberate: it protects mid-form state during a
  deploy. The side effect is that a merged, correctly deployed fix keeps looking broken to
  anyone with a stale tab open. Verify in a fresh private window before re-debugging.
- **`buildExcludes: [/\.map$/]` in the next-pwa block is load-bearing.** It keeps the
  source maps out of the precache manifest — both so PWA users do not download the app's
  source on install, and because Sentry runs with `deleteSourcemapsAfterUpload: true`. The
  maps are gone by the time the app is served, so a precache entry pointing at one would
  404 and the service worker would never activate. Do not "tidy" this line.
- **Missing Firestore indexes fail silently** in the sense that matters: the query
  rejects, and a `catch`-to-default renders it as an empty list. House convention is
  therefore **single-field `where` + client-side sort/filter**. See the indexes note under
  standing constraints before you reach for a composite.
- **Vercel's serverless request body cap is 4.5MB**, enforced as a 413 before the handler
  runs — which is why PDF/image upload goes presign then PUT straight to R2
  (`/api/storage/presign`) instead of through an API route.
- **Never authorize Composio — or any integration — on a Stripe account.** It makes the
  account platform-controlled and permanently unable to host a Connect integration. This
  has already killed two accounts (THE-16).
- **`src/app/api/stripe/update-prices/route.ts` hardcodes product IDs from an abandoned
  account.** Treat that route as dead.

## Key Files & Structure

```
src/
├── app/
│   ├── [[...slug]]/page.tsx  # Optional catch-all: serves the SPA shell for EVERY
│   │                         #   non-API path so React Router deep links survive
│   │                         #   a hard refresh
│   ├── layout.tsx            # Root layout — pinned, treat as frozen
│   └── api/
│       ├── dodo/             # Subscription checkout, webhook, provisioning
│       ├── stripe/           # Legacy; platform account closed
│       ├── auth/set-claims   # Custom claims + the member capacity gate
│       ├── giving-statements/
│       ├── event-registration/, event-payment/
│       ├── crm/
│       └── storage/presign   # R2 presigned PUT
├── components/
│   ├── MainApp.tsx           # Member app shell
│   ├── AdminDashboard.tsx    # Admin panel
│   ├── AdminCRM.tsx          # Contacts, activities, manual gifts
│   ├── AdminDonations.tsx    # The ministry's own payment links
│   ├── AdminAccounting.tsx   # Cents. Always cents.
│   ├── donations/            # giving-providers.ts host allow-list lives here
│   └── ui/                   # shadcn primitives, digest-pinned
├── contexts/TenantContext.tsx
├── types/tenant.types.ts     # TenantPlan, TenantAddons, TenantConfig, Tenant
├── utils/plan-features.ts    # The plan matrix, pricing, add-on layering
├── lib/
│   ├── donation-history.ts   # normalizeEmail + formatCents
│   ├── billing-processor.ts  # Which rail a tenant is on
│   ├── dodo/                 # Catalogue, webhook dispatch, provisioning
│   ├── member-capacity.ts    # The server-side signup gate
│   └── *-feature.ts          # The master switches
├── test/support/             # browser-measure.ts and friends
└── __tests__/__fixtures__/   # the-346-strip-comments.ts, ownership/, digests
```

## Design System — Harvest Brand & Design System v1.0
Tokens live in `src/app/globals.css` (`:root`) and `tailwind.config.ts`.

- **Type**: Fraunces (serif) for display/headings — `font-display`; hero/editorial at 300,
  section/card titles at 600-700. Inter for all UI/body — `font-sans`.
- **Grounds**: page = cream `#FAF8F5` (`--ds-page-bg`); cards/sidebar/top-bar = white.
- **Action gold**: Wheat Gold via **`--brand-color`** (tenant-overridable — every gold
  accent uses this var, never a hard hex).
- **Text (warm neutrals)**: heading earth, body `--text-body`, secondary warm brown,
  faint/eyebrow `--text-faint`.
- **One palette family.** `divide-stone-*` and every raw Tailwind colour scale are
  forbidden; use the tokens.
- **Contrast is measured, not assumed.** `theming-neutral-palette.test.ts` resolves every
  value through postcss and computes every ratio; `THE-338.palette-measured.test.ts` runs
  the real compiled stylesheet in a real page and reads the values back off
  `getComputedStyle`. **Do not "fix" a low ratio you find by eye.** Several are
  deliberate and pinned as deliberate — the chart accents and the progress track are
  low-contrast on purpose, and the single worst *text* pair is accepted. The often-quoted
  5.66 figure is one gold button pair, not a repo-wide floor.
- **Touch targets**: at least 44px below `sm`; above `sm` a separate rule fixes controls
  at 38px. `min-h-11` is not inert — it is doing work. `Button`'s intrinsic sizes all sit
  below both floors, so a bare `<Button>` does not meet the floor by itself.
- **Terminology**: "Ministries", not "churches", in user-facing copy.
- 43 shadcn primitives are installed under `src/components/ui/`, digest-pinned.
  **`accordion` and `rating` are both absent** — check before importing, and grep both the
  `@/` and the relative `./ui/` spellings when you are looking for a primitive's usage.

## Firebase
- Project ID: `harvest-agent-233a1`
- **No service account key file needed.** Run admin scripts from Firebase Cloud Shell,
  which supplies Application Default Credentials; every script in `scripts/` falls back to
  `applicationDefault()`. Keep any key outside the repo.
- **Super admin is not an env var.** It is two frozen literals in
  `src/utils/super-admins.ts` plus a `superAdmin` custom claim minted by email in
  `src/lib/set-custom-claims.ts`. The same list is mirrored — deliberately, since these are
  separate packages that cannot import from `src/` — in `firestore.rules`' `isSuperAdmin()`
  and in `functions/src/index.ts`. Change one, change all four. (`.env.example` still lists
  `NEXT_PUBLIC_SUPER_ADMIN_EMAIL`; it is dead and ignored.)

## Workflow
Ticket, prompt, agent, PR, CI, merge. **Verified plus green equals done.**

- CI (`.github/workflows/test.yml`, job **Test & Lint**) runs on `pull_request` only, with
  `fetch-depth: 0` because several suites diff against the revision their branch came from.
  There is no `push` trigger, so **`main` is unprotected and a commit pushed straight to it
  gets no CI at all**.
- A `pull_request` run tests `refs/pull/N/merge`, which is the tree the merge produces
  *only while `main` has not moved*. If a PR has sat while others landed, update the branch
  or re-run before merging rather than trusting the older green check.
- When polling CI, read `completed_at` on the **job**. A run summary can serve a frozen
  snapshot long after the job actually finished.
- Always set git author before committing:
  `git config user.email "bumbmatei@gmail.com" && git config user.name "Matei"`. The
  default `root@vps` breaks Vercel deployments.

## Related Repos
Only the first of these is checked out here, so everything said about the others is a
claim this repository cannot verify. Treat it as a starting point and confirm in the repo
itself.

- `Harvest-agent` — the app (this repo).
- `harvest-presentation-site` — the marketing site at `theharvest.site`. **Vite + React**
  with `vite-react-ssg` (statically prerendered), plus a markdown blog under `/blog`. Not
  Next.js — do not assume App Router conventions there. It carries its own copy of the nine
  prices and a module-scope contract that throws at prerender if they disagree with
  `PLAN_PRICING` here, which is why a price change has to land in both repos together. It
  is reported to have CI now (a `Test & Build` workflow); older prompts in this project say
  it has none, and those are stale. Its `main` is reported to be unprotected.
- `harvest-docs` — a separate repository. The customer docs are served from
  `docs.theharvest.site`, which `src/components/admin/GivingDocsLink.tsx` links into; this
  repo does not record which repository publishes them, so check before assuming it is the
  marketing site.
- `Harvest-Site---STABLE` — stable backup. **Never modify.**
