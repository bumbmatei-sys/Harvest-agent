# Harvest Agent — Project Context

## What This Is
Harvest (theharvest.app) is a **multi-tenant ministry SaaS** platform. Churches/ministries sign up, get a subdomain (e.g. `gracechurch.theharvest.app`), and manage their community through an admin dashboard. End users access church content through a mobile-first web app.

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

## Traps
Each of these has already cost real time. None are obvious from the code.

- **`firestore.rules` auto-deploys to production on merge.** `.github/workflows/deploy-rules.yml`
  fires on any push to `main` touching `firestore.rules`, `storage.rules` or
  `firebase.json`. CI runs **no** emulator rules tests — `npm test` only covers `src/**`.
  There are **306 rules tests** in `tests/rules/`; run `npm run test:rules` yourself for
  any rules change, because nothing else will.
- **`functions/` does NOT deploy on merge.** It needs a separate
  `firebase deploy --only functions` from Cloud Shell, and its own
  `npm install && npm run build` inside `functions/` first. Merging a Cloud Function
  change and assuming it shipped is a standing trap.
- **`typescript: { ignoreBuildErrors: true }`** in `next.config.mjs` — a green Vercel
  build proves *nothing* about types. Run `tsc --noEmit` yourself and diff against a
  stashed baseline. Per THE-48 the baseline is not currently reproducible between
  environments, so always measure it on the same checkout you are comparing against
  rather than trusting a number from another session.
- **`skipWaiting: false`** (next-pwa) — a new service worker waits for every tab on the
  origin to close before activating. Deliberate: it protects mid-form state during a
  deploy. The side effect is that a merged, correctly deployed fix keeps looking broken
  to anyone with a stale tab open. Verify in a fresh private window before re-debugging.
- **`buildExcludes: [/\.map$/]` in the next-pwa block is load-bearing.** It keeps ~150
  source maps out of the precache manifest — both so PWA users don't download the app's
  entire source on install, and because Sentry is configured with
  `deleteSourcemapsAfterUpload: true`. The maps are gone by the time the app is served,
  so a precache entry pointing at one would 404 and the service worker would never
  activate. Do not "tidy" this line.
- **Missing Firestore indexes fail silently** in the sense that matters: the query
  rejects, and a `catch`-to-default renders it as an empty list. House convention is
  therefore **single-field `where` + client-side sort/filter** (see `AdminBlog`,
  `PrayerWall`, `AdminCommunity`, …). Any new `collectionGroup` or multi-field `where`
  needs its entry in `firestore.indexes.json` **in the same PR**.
- **Stripe amounts are CENTS; `totalDonated` is DOLLARS.** Both appear in the same
  webhook block (`src/app/api/stripe/webhook/route.ts`) — a renewal writes
  `amount: 5000` and increments `totalDonated` by `50`. This has already shipped as a
  100× error. Check the unit at every boundary.
- **Vercel's serverless request body cap is 4.5MB**, enforced as a 413 before the
  handler runs — which is why PDF/image upload goes presign → PUT straight to R2
  (`/api/storage/presign`) instead of through an API route.
- **Never authorize Composio — or any integration — on a Stripe account.** It makes the
  account platform-controlled and permanently unable to host a Connect integration. This
  has already killed two accounts (THE-16). Composio is fine for Gmail, Instagram and
  Mailchimp; it must never touch Stripe.
- **Four host resolvers must stay in sync**, all deriving from
  `src/utils/non-tenant-subdomains.ts`: `getTenantIdFromHost()` (`tenant-scope.ts`),
  `resolveTenantIdFromHostname()` (`TenantContext.tsx`), `getTenantFromHost()`
  (`server-tenant.ts`) and AuthPage's derivation. A disagreement between them is the bug
  class behind #181 and #185. Never hardcode a subdomain string.
- **Super admin `tenantId` is `null`.** Any tenant-scoped write must resolve a real
  `tenantId` first (see `api/rag/extract/route.ts`, which falls back to the platform
  tenant) or it writes to `tenants/null/...`.

## Tech Stack
- **Framework**: Next.js 14 (App Router) + React 18 + TypeScript
- **Styling**: Tailwind CSS 3 + Framer Motion (motion)
- **Backend**: Firebase (Firestore, Auth, Storage)
- **Payments**: Stripe (subscriptions + Stripe Connect for revenue sharing)
- **Email**: Resend
- **AI**: Xiaomi MiMo (mimo-v2.5) for RAG chat, kept Gemini for embeddings
- **Maps**: Leaflet + Google Places Autocomplete
- **Rich Text**: TipTap editor
- **Hosting**: Vercel (app) + Firebase (Firestore/Auth)

## Key Files & Structure

```
src/
├── app/
│   ├── [[...slug]]/page.tsx  # Entry point → loads App.tsx (optional catch-all:
│   │                         #   serves the SPA shell for EVERY non-API path so
│   │                         #   React Router deep links survive a hard refresh)
│   ├── layout.tsx            # Root layout
│   └── api/
│       ├── ai-assistant/route.ts    # AI Assistant (Telegram bot)
│       ├── gemini/route.ts          # RAG chat endpoint (MiMo)
│       ├── stripe/                  # All Stripe endpoints
│       │   ├── checkout/route.ts    # Subscription checkout
│       │   ├── connect/route.ts     # Stripe Connect onboarding
│       │   ├── webhook/route.ts     # Stripe webhooks
│       │   ├── portal/route.ts      # Customer portal
│       │   ├── donate/route.ts      # Donations
│       │   └── ...
│       ├── auth/                    # Custom claims management
│       ├── send-email/route.ts      # Email sending
│       └── enterprise-lead/route.ts # Enterprise contact form
├── components/
│   ├── MainApp.tsx           # Main user-facing app shell (tabs: Home, Bible, Chat, Map, Profile)
│   ├── AdminDashboard.tsx    # Admin panel
│   ├── AdminBlog.tsx         # Blog management
│   ├── AdminCourses.tsx      # Course management
│   ├── AdminChurches.tsx     # Church management (Ministry)
│   ├── AdminSettings.tsx     # Tenant settings
│   ├── AdminTenants.tsx      # Super admin tenant management
│   ├── AIChat.tsx            # AI chat interface
│   ├── AuthPage.tsx          # Login/signup
│   ├── Profile.tsx           # User profile
│   ├── BlogTab.tsx           # User blog view
│   ├── ChurchMap.tsx         # Church map
│   ├── EnterpriseContactModal.tsx
│   ├── Onboarding.tsx        # Tenant onboarding flow
│   └── course/               # Course components
├── contexts/
│   └── TenantContext.tsx     # Tenant context provider
├── types/
│   ├── tenant.types.ts       # TenantPlan, TenantConfig, Tenant
│   └── course.types.ts       # Course types
├── utils/
│   ├── plan-features.ts      # Plan feature flags
│   ├── tenant.utils.ts       # Tenant helpers
│   ├── sanitize.ts           # XSS sanitization
│   └── email.ts              # Email templates
├── lib/
│   ├── firebase-admin.ts     # Server-side Firebase
│   └── api-auth.ts           # API authentication helpers
└── firebase.ts               # Client-side Firebase config
```

## Pricing Tiers (TenantPlan)
Source of truth: `src/utils/plan-features.ts` (`PLAN_PRICING` + the `PLAN_FEATURES` matrix).
This table is a summary — when they disagree, the code is right and this file is stale.

| Plan | Display Name | Price   | Fee | Contacts | Admins | Courses | Campuses | Blog | AI  | Custom Domain | Event Reg | CRM | Notes | Check-In | Livestream | Sermon Notes | Accounting | Community Groups |
|------|-------------|---------|-----|----------|--------|---------|----------|------|-----|---------------|-----------|-----|-------|----------|------------|--------------|------------|------------------|
| plus | Individual  | $49/mo  | 0%  | 150      | 2      | 2       | 1        | ✅   | ❌  | ❌            | ❌        | ❌  | ❌    | ❌       | ❌         | ❌           | ❌         | ❌               |
| pro  | Small Team  | $99/mo  | 0%  | 500      | 5      | 5       | 1        | ✅   | ✅  | ❌            | ❌        | ✅  | ✅    | ✅       | ✅         | ✅           | ❌         | ❌               |
| max  | Ministry    | $199/mo | 0%  | 2,000    | 15     | 15      | 1        | ✅   | ✅  | ✅            | ✅        | ✅  | ✅    | ✅       | ✅         | ✅           | ✅         | ✅               |

Annual billing is monthly × 10 (pay ten months, get twelve): $490 / $990 / $1,990.

**There are three tiers.** A fourth, `ultra` (displayed as "Ministry", $299), was
deleted and folded into `max` — which inherited both its display name and its
Church Directory, Accounting Tools and included AI Assistant. `max` did **not**
inherit ultra's unlimited campuses/courses/admins: every cap is finite now, and
extra capacity is sold as add-ons instead.

`maxContacts` is **published but NOT enforced** — no contact cap exists anywhere
in the app. It lives in `PLAN_FEATURES` (not `PLAN_LIMITS`, which holds metered
token/segment flows) because it is a static entity count like `maxCourses` /
`maxAdmins` / `maxChurches`. Enforcement will mirror `maxCourses`: client-side,
blocking new creation only, with tenants already over the limit keeping what they
have.

Five features — **Check-In, Livestream, Sermon Notes, Notes/Docs and CRM** — moved
down from the top tier to **Small Team (pro)**. The move is visibility only: no
Firestore rule, API route, query or cap keys off those cells (CRM's `contacts` /
`contactActivities` rules scope on the `manageCRM` permission, not on plan).

The "AI Assistant" column was removed: the Telegram add-on is retired (#214, THE-13).
`AI_TELEGRAM_ASSISTANT_ENABLED = false` hides every customer-facing surface; the
backend routes, Stripe wiring and the `aiAssistant` plan flag are left intact so the
feature can be restored by flipping that one boolean.

Ministry (max) is the top tier and carries everything: CRM, Tax Receipts, Community
Groups, Custom Forms, Check-In, Livestream, Pledge Campaigns, Custom Domain, and —
folded in from the deleted `ultra` tier — Accounting Tools and the global Church
Directory. CRM, Check-In and Livestream are **not** exclusive to it: Small Team (pro)
has them too. What Ministry adds over Small Team is Custom Domain, Custom Branding,
Event Registration, Tax Receipts, Giving Statements, Custom Forms, Automated
Blog/Newsletter, Pledge Campaigns, Community Groups, Accounting Tools and Church
Directory.

**SMS is not sold by plan.** `smsAutomation` and `textToGive` are `true` on all three
tiers; whether a tenant can actually send is decided by whether they have connected
their **own Twilio** credentials. Harvest offers no platform SMS, so every tier's
`smsSegmentsPerMonth` in `planLimits.ts` is `null` (unmetered). The previous
250/500/2,000 budgets metered tiers whose `smsAutomation` flag was `false` — a budget
for a feature those tiers could not reach.

Custom domains are entitled on Ministry (max) only, enforced server-side in
`src/app/api/domains/provision/route.ts` (403 for a plan without `customDomain`,
super admins bypass) — not in the UI alone. Note the marketing site does not yet
advertise custom domains: provisioning has not been proven end to end against a live
Vercel plan, so the code ships ahead of the public promise.

Minimum-plan labels on upgrade screens are **derived** from this matrix
(`getFeatureMinPlan` / `FEATURE_MIN_PLAN` in `plan-features.ts`), not hand-written.
Flipping a cell in `PLAN_FEATURES` moves the upgrade copy with it — never put a
literal plan name in a gate message.

Map note: All plans show their own church location(s) on the map. The global multi-church discovery directory (browsing all tenants' churches) is Ministry (max) only (`churchDirectory` feature flag).

## Revenue Sharing (Stripe Connect)
The platform application fee is taken on money flowing through a tenant's connected
account — donations AND paid event tickets. `PLATFORM_FEE_MAP`
(`src/lib/stripe-connect.ts`) is the rate actually charged.

| Plan | Platform fee |
|------|--------------|
| Individual (plus) | **0%** |
| Small Team (pro)  | **0%** |
| Ministry (max)    | **0%** |

**Donations are free on every tier.** The plans sell features and capacity, not a
share of giving. A destination charge with `application_fee_amount: 0` sends the
whole gift to the connected account.

`PLAN_FEATURES.*.donationRetention` and `PLAN_DONATION_RETENTION` are **deleted**.
They were a hand-maintained complement of the fee (`100 - fee * 100`), which is the
duplication that let the app advertise "keeps 100%" while charging 2.5% (THE-51). At
a flat 0% the retention number is a constant 100 that carries no information, so the
mirror is gone rather than re-pinned. `PLATFORM_FEE_MAP` is the only place a rate is
written down; customer-facing surfaces render the **fee** ("Donation fee — 0%"), not
what's left over. `platform-fee-map.test.ts` and `donate-platform-fee.test.ts` pin
both the map and the real `application_fee` Stripe receives, so a rate cannot creep
back while the UI still promises 0%.

## Design System — Harvest Brand & Design System v1.0
Tokens live in `src/app/globals.css` (`:root`) and `tailwind.config.ts`.
- **Type**: Fraunces (serif) for display/headings — `font-display`; hero/editorial at **300 (light)**, section/card titles at 600–700. Inter for all UI/body — `font-sans`.
- **Grounds**: page = **cream `#FAF8F5`** (desktop `--ds-page-bg`); cards/sidebar/top-bar = **white**.
- **Action gold**: Wheat Gold 500 `#C9963A` via **`--brand-color`** (tenant-overridable — every gold accent uses this var, never a hard hex). Reference scale = `wheat-{50..700}`.
- **Text (warm neutrals)**: heading = earth `#2D2519` (`text-earth`), body `--text-body` `#4A4038`, secondary = warm brown `#8B7355` (`text-warm-brown`), faint/eyebrow `--text-faint` `#A89A87`.
- **Borders/elevation**: stone `#E8E2D9` (`border-stone-200`, `--ds-border`); warm-tinted shadows `--ds-sh-{sm,md,lg}`.
- **Palette also available**: `navy-{500..950}` (dark surfaces), `sky-*`, `field-*` (green), `stone-{100..300}`. Radii `rounded-brand{,-lg,-xl}` (12/16/24).
- **Desktop shell** (`MainApp.tsx`): grouped sidebar (FEED/COMMUNITY/SUPPORT US) with taupe eyebrow labels + gold-tint active pill; "Harvest." wordmark carries the gold period (platform only — white-label tenants show their own name).
- **Terminology**: "Ministries" NOT "churches" in user-facing copy
- **"AI Assistant"** (admin-only Telegram bot) is **retired** (#214, THE-13) — hidden
  everywhere by `AI_TELEGRAM_ASSISTANT_ENABLED = false`, dormant code intact. Not to be
  confused with the RAG **AI Chat** / **AI Knowledge Base**, which are live on pro+.
- Plus/Pro plans have **NO custom branding**

## Firebase Project
- Project ID: `harvest-agent-233a1`
- **No service account key file needed.** Run admin scripts from Firebase Cloud Shell,
  which supplies Application Default Credentials; every script in `scripts/` falls back
  to `applicationDefault()`. Pass `GOOGLE_APPLICATION_CREDENTIALS` only if running
  somewhere without ADC, and keep the key outside the repo.
- **Super admin** is no longer an env var (removed in #240). It is two frozen literals
  in `src/utils/super-admins.ts` plus a `superAdmin` custom claim minted by email in
  `src/lib/set-custom-claims.ts`. The same list is mirrored — deliberately, since they
  are separate packages that cannot import from `src/` — in `firestore.rules`'
  `isSuperAdmin()` and in `functions/src/index.ts`. Change one, change all four.
  (`.env.example` still lists `NEXT_PUBLIC_SUPER_ADMIN_EMAIL`; it is dead and ignored.)

## Stripe (test mode)
- The original test account is abandoned (THE-16) and a fresh one is being created, so
  no account / product / webhook IDs are recorded here on purpose — the old ones are
  dead and an agent trusting them will chase ghosts. Read the current values from the
  Vercel env vars, which are the only live source.
- Stripe is **not live** and there are no paying customers yet.
- Note `src/app/api/stripe/update-prices/route.ts` still hardcodes product IDs from the
  abandoned account; treat that route as stale until the new account exists.

## AI / RAG Chat
- Model: Xiaomi MiMo `mimo-v2.5` via Token Plan API — see `src/lib/ai-config.ts`, the
  single place a model swap happens.
- Base URL is per-region and configurable via `MIMO_BASE_URL` (must include `/v1`; the
  code appends `/chat/completions`). Unset defaults to `token-plan-cn.xiaomimimo.com`.
  A Token Plan key only authenticates against its own region's base URL.
- Key prefix today is `tp-` (a Token Plan subscription key). **Blocker before launch
  (T4):** the Token Plan ToS forbids using it as an app backend — a pay-as-you-go `sk-`
  key is required.
- Gemini kept for embeddings only (`gemini-embedding-001`).

## Deployment
- **App**: Vercel at `harvest-agent.vercel.app`
- **Presentation site**: Vercel at `harvest-site.vercel.app`
- **Domain**: theharvest.app (Namecheap, A→76.76.21.21, CNAME→vercel-dns.com)
- **Git author**: `bumbmatei@gmail.com` / `Matei`

## Important Rules
1. **NEVER modify Harvest-Site---STABLE** — it's the stable backup
2. Always set git config before committing: `git config --global user.email "bumbmatei@gmail.com" && git config --global user.name "Matei"`
3. `git config` defaults to root@vps which breaks Vercel deployments
4. **Churches as sub-entities**, not separate tenants
5. Always verify which branch/version is deployed before editing
6. Run bug analysis after feature implementation (3+ files changed)

## Related Repos
- `Harvest-agent` — main app (this repo)
- `harvest-presentation-site` — marketing/landing page. **Vite + React** with
  `vite-react-ssg` (statically prerendered), plus a markdown blog under `/blog`.
  Not plain HTML, and not Next.js — do not assume App Router conventions there.
- `Harvest-Site---STABLE` — stable backup (DO NOT MODIFY)

## Current Status (as of last commits)
- **No paying customers yet. Stripe is not live.** Nothing in production is taking real
  money, which is why fee/retention correctness is cheap to fix now and expensive later.
- Plans: Individual ($49), Small Team ($99), Ministry ($199) — three tiers, 0% fee
- No enterprise plan — Ministry (max) is the top tier
- **1894 tests + 1 todo / 124 files** passing (`npm test`), plus **363 Firestore rules tests**
  under `tests/rules/` that run separately (`npm run test:rules`, needs the emulator)
- AI Assistant (Telegram bot) **retired** (#214) — dormant code intact
- Newsletter live · Community Groups live on **Ministry (max)**
- CRM, Notes, Check-In, Livestream and Sermon Notes live on **Small Team (pro)** and
  above; Tax Receipts and Accounting Tools on **Ministry (max)**. Upgrade-screen
  labels are derived from the matrix — the old hand-written maps oversold the top tier
- Community Groups is gated **client-side only** — no Firestore-rules or server check
  keys off the `communityGroups` flag (rules scope channels/DMs by roster, not by plan)
- CRM outbound email sends through **Composio Gmail** (`GMAIL_SEND_EMAIL`), per-admin
  connected account, with an explicit `from_email` so send-only grants work
- **Sentry** live (client, server, edge; source maps uploaded and then deleted)
- **Vercel Analytics** on both repos
- **R2 direct upload** via presigned PUT for images and RAG documents
- Per-tenant **RAG token caps** (`src/lib/planLimits.ts`), surfaced in-app before the
  wall is hit. SMS segment caps are `null` on every tier — SMS is BYO-Twilio, so there
  is no Harvest allotment to meter; the reserve/settle machinery stays live and tested
  for the day a cap returns
- Zustand + TanStack Query in place
- React Router migrated (served through the `[[...slug]]` catch-all)
- Composite index refactor done
