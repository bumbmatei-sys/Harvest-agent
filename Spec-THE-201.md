# Spec: THE-201 — the hard, server-side member-signup cap

Ticket: THE-201 | Author: Planner | Date: 2026-08-22
Base: `origin/main` @ `99b30cd` ("Add the Forever Free tier to the plan matrix (THE-200)")
Programme: Forever Free, PR 2 of 5 (`company/forever-free/FOREVER-FREE-handoff.md` §8)

---

## CHALLENGES

Four findings from reading the code. None of them says a design decision is *wrong in
direction*; three say a decision as written is **incomplete in a way that would ship a
silent failure**, and one names a cost the decision set does not currently price. The
Coder must implement the resolutions given here, not the bare decision text.

### C1 — D2 as written would be swallowed. The gate CANNOT live inside `setCustomClaims`.

`setCustomClaims()` (`src/lib/set-custom-claims.ts:13`) wraps its whole body in
`try { … } catch (error) { console.error(…) }` (lines 80–82) and returns `void`. It also
returns *silently* when the user doc is missing (lines 17–20). Anything thrown inside it
disappears; the caller at `src/app/api/auth/set-claims/route.ts:30` `await`s it and then
unconditionally returns `{ success: true, forceRefresh: true }` (line 32).

If the cap check were added inside `setCustomClaims`, a refusal would be caught by that
`catch`, logged to a server console nobody reads, and the route would answer **200
success** to a person who was actually refused — the exact shape AGENTS.md's
Silent-Failure Rule forbids ("code runs perfectly and does the wrong thing").

**Resolution — implement this, not the literal D2:** the decision *point* is
`POST /api/auth/set-claims`, and the check runs **in the route handler, before
`setCustomClaims(uid)` is called**. `setCustomClaims` is not modified at all. The route
short-circuits with a 403 and never reaches line 30. This preserves D2's substance —
`setCustomClaims` remains the only issuer of `claims.tenantId`, and withholding the call
withholds the claim — while keeping the refusal loud.

### C2 — the refused person's `users` doc permanently consumes a slot. (D2 + D8 interact.)

D8 forbids deleting the refused applicant's `users` doc. D5 counts `users` docs by
`tenantId`. Therefore **a refused applicant is counted by the next applicant's count
query.** A tenant at 500/500 that receives three refusals reads as 503, and those three
ghosts never leave. The cap ratchets *tighter* over time, and a church that later buys
Contacts +500 gets 497 usable slots, not 500.

This is not hypothetical: `firestore.rules:144` lets any authenticated user create their
own `users/{uid}` doc, and `AuthPage` writes it (line 397 / line 280) *before* the
set-claims hop, so the doc is already on disk when the refusal is decided.

**Resolution:** it is bounded, and it is not closed in this PR.
- Bounded, because the ghost is keyed by uid: a refused person retrying with the same
  email reuses the same Firebase Auth uid and the same `users/{uid}` doc. Retries do not
  multiply ghosts — one refused human is at most one ghost.
- Bounded further by D9's pre-flight, which is what a real person actually hits. The
  set-claims refusal is only reached by someone who bypassed the pre-flight (a stale tab,
  a direct API call, a hostile client).
- The refusal path MUST stamp `capRefusedAt` (ISO string) and `capRefusedTenantId` on the
  applicant's `users` doc via the Admin SDK, so the ghosts are *identifiable* for the
  follow-up sweep. Writing a field is not removing anyone and does not violate D8.
- Filtering ghosts out of the count is **deliberately not attempted here**: it needs
  `where('tenantId','==',t).where('capRefusedAt','==',null)`, a two-field query, which
  needs a composite index in `firestore.indexes.json` and fails *silently* if forgotten
  (AGENTS.md, Traps). Over-counting by a handful in the *conservative* direction is the
  safer error.

Carried to **RESIDUAL EXPOSURE** as a follow-up card.

### C3 — D5/D7 do not say what happens when the count itself fails. Both defaults are bugs.

`adminDb…count().get()` can reject (quota, transient Firestore error, missing ADC). D5
and D7 specify the happy path only. Both obvious defaults are Silent-Failure Rule
violations:
- `catch { return allow }` — the cap silently stops existing; free is unbounded again and
  nothing tells anyone.
- `catch { return refuse }` — a real new believer is told the ministry is full when it is
  not, over an infrastructure blip.

**Resolution:** the count failure is a **third outcome**, not folded into either. The
route answers **503** with `code: 'capacity_check_unavailable'` and copy that says
"we couldn't finish setting up your account, try again in a minute" — it does NOT say the
ministry is full. Claims are NOT minted. `captureHandledError(error, { step:
'member-cap-count' })` fires. No `catch`-to-boolean anywhere in the helper.

### C4 — D6 says read `plan`/`addons` off `tenants/{tenantId}`. Verify the field exists; fail closed *loudly*, not to `'plus'`.

`toTenantPlan()` (`src/utils/plan-features.ts:952`) fails closed to `'plus'` for an
unknown/absent plan. On the *display* surfaces that shipped it, that is right. Here it is
load-bearing in a new way: after THE-200 a **free** tenant's cap is 500
(`plan-features.ts:202`) while `'plus'` is 150 (`plan-features.ts:273`). A free tenant
whose `plan` field failed to read would be gated at 150 — refusing 350 people who are
entitled to sign up.

**Resolution:** keep `toTenantPlan()` as the coercion (do not fork it), but the route must
distinguish *"the tenant doc says `plan: 'free'`"* from *"the tenant doc did not load"*.
A `tenants/{tenantId}` doc that does not exist, or a read that throws, is the **C3 503
path**, not a `'plus'` fallback. A doc that exists with an absent/garbage `plan` value
does go through `toTenantPlan()` → `'plus'`, and that is intentional and tested.

---

## Goal

A tenant that is at or over its member cap stops accepting **new member signups**,
enforced on the server, at the one hop every new account already makes. Existing members
are untouched: they sign in, keep everything, and are never removed, disabled or demoted.
A church that upgrades a tier or buys the Contacts +500 / Unlimited Contacts add-on has
the gate lift immediately, with no backfill and no migration.

Founder, verbatim (`FOREVER-FREE-handoff.md:82-84`):

> *"After that no user can sign up anymore but the ones that are signed up already don't
> leave. If, for example, I buy the cheapest plan, I will still have 500 inside the 150
> cap but no other user can sign up after unless I upgrade the plan or buy add-ons."*

The rule is **universal across all tiers**, not free-specific.

## Non-goals

- **No contact cap.** Nothing about `contacts` documents changes. Donor records stay free,
  uncounted and fully visible (see WHAT IS COUNTED).
- **No enforcement of any other cap.** `maxAdmins`, `maxCourses`, `maxChurches` are
  untouched.
- **No `firestore.rules` change.** Not one line. See FILES DELIBERATELY NOT TOUCHED.
- **No removal, disabling, demotion or deletion of any account, ever** (D8).
- **No new admin UI.** No "you are at capacity" banner in AdminCRM, no upsell screen. That
  is THE-202/THE-203 territory.
- **No maintained counter and no backfill script** (D5).
- **No change to the sign-in path.** Only signup is gated.
- **No pricing/marketing copy.** THE-204.

---

## 1. WHAT IS COUNTED — members, not contacts

**The thing counted is a `users` document whose `tenantId` equals the tenant.** That is a
Firebase Auth account scoped to a ministry — a person who signed up to be discipled.

**`contacts` documents are NOT counted.** A `contacts` row is a standalone donor record,
created by the Stripe donation webhook (`src/app/api/stripe/webhook/route.ts`) for anyone
who gives through the public donate page without ever making an account. Those rows are
what giving statements and year-end tax receipts are built from. The module header of
`src/utils/contact-capacity.ts:9-22` already states this line and the reasoning behind it:

> *"🔴 WHAT IT COUNTS: ACCOUNT-HOLDERS ONLY. … Counting them would sell a church capacity
> its own donors consume without asking; HIDING them past the cap would withhold records a
> treasurer legally needs in January."*

So a tenant with 149 accounts and 5,000 donor-only contact rows is at **149**, comfortably
under Individual's 150, and can accept one more member.

**The governing number is still `maxContacts`.** That is not a contradiction. `maxContacts`
is the field the plan matrix already prices (`plan-features.ts:202 / :273 / :320 / :366`),
the field the add-ons already raise (`CONTACTS_PER_PACK`, `plan-features.ts:824`), and the
field `contact-capacity.ts` already documents as counting account-holders. Introducing a
parallel `maxMembers` cell would create a second copy of one fact — the duplicated-fact
shape behind the retention bug (THE-51) and the four-copy over-sell. One number, one name.

Naming, for the whole PR: **member** = `users` doc scoped to the tenant. **contact** =
`contacts` doc. The user-facing copy says neither word (see §5).

### The arithmetic, and the off-by-one (D4)

By the time `POST /api/auth/set-claims` runs, the applicant's own `users` doc **already
exists**. `AuthPage` writes it at line 397 (email/password) or line 280 (Google) and only
then calls the route (line 417 / line 301). So a raw count includes the applicant.

```
total       = count(users where tenantId == t)      // includes the applicant
othersCount = total - 1                             // ONLY when the applicant's own
                                                    // users doc carries tenantId == t
refuse      ⟺  othersCount >= cap
```

Worked, for a `pro` tenant (cap 500, `plan-features.ts:320`):

| applicant | total | othersCount | `othersCount >= 500` | outcome |
|---|---|---|---|---|
| the 500th member | 500 | 499 | false | **allowed** — claim minted |
| the 501st member | 501 | 500 | true  | **refused** — claim withheld |

The `- 1` is conditional. If the applicant's own doc has `tenantId` null/absent (super
admin, main-site account) the check does not run at all (D7), so there is no subtraction to
get wrong. If a super admin calls the route for another uid (`route.ts:26` permits this),
"self" is the **target** uid, not the caller.

`>=`, not `>`: at exactly the cap there is no slot left. Same convention as
`isAtContactLimit` (`contact-capacity.ts:245`).

---

## 2. Where the gate lives, and why it is real

### The enforcement point

`POST /api/auth/set-claims` — `src/app/api/auth/set-claims/route.ts`, checked in the route
handler **before** line 30's `await setCustomClaims(uid)` (see **C1**).

### Why withholding the claim is a genuine server-side gate

- `setCustomClaims` (`src/lib/set-custom-claims.ts:13`) is the **only** issuer of
  `claims.tenantId` in the codebase (lines 36–38, minted at line 73). It runs server-side
  with the Admin SDK. A client cannot mint a custom claim.
- `firestore.rules` gates tenant content on that claim. No claim ⇒ no tenant content.
- Therefore refusing to call it is enforcement, not decoration.

### Why the `users` doc itself cannot be made server-only in this PR

`firestore.rules:144`:

```
allow create: if isAuthenticated() && request.auth.uid == userId &&
  (!request.resource.data.keys().hasAny(['role']) ||
   request.resource.data.role == 'user');
```

Any authenticated user may create their own `users/{uid}` doc. Closing that is the correct
long-term fix and is **forbidden here**: `.github/workflows/deploy-rules.yml` auto-deploys
`firestore.rules` to production on any merge to `main`, CI runs no emulator rules tests,
and the 363 tests in `tests/rules/` only run when a human runs `npm run test:rules`
(AGENTS.md, Traps). A rules change does not belong in the same PR as a signup-path change.
The residual — a ghost `users` doc with no claims — is named in **RESIDUAL EXPOSURE**.

### "Is this person already a member?" — from the Auth record (D3)

Answered from `adminAuth.getUser(uid)` → `customClaims.tenantId`, **not** from the `users`
doc. The `users` doc is client-writable (rules:144); the custom claim is not. An existing
member already holds `claims.tenantId === t`, so:

> **If `existingClaims.tenantId === tenantId`, the cap check is skipped entirely. No count
> query runs. The member always signs in.**

This is what makes "a tenant with 500 members that moves to Individual keeps all 500" true
at runtime, and it is why an over-cap tenant costs zero extra reads on ordinary sign-ins.

Only a uid with no existing `tenantId` claim for that tenant is a NEW member and subject to
the gate. (A uid holding `claims.tenantId === 'other-church'` whose `users` doc now says
`tenantId === t` is a NEW member of `t` and IS gated — correct, that is a person joining a
second ministry.)

### The pre-flight is UX, not enforcement (D9)

`POST /api/tenants/member-capacity` exists so a real human never ends up with a half-created
account (a Firebase Auth user and a `users` doc, but no claim and no access). It is called
from `AuthPage` before `createUserWithEmailAndPassword` and before `signInWithPopup`, on the
**signup path only**.

> **Say it in the code comment, verbatim in spirit: the pre-flight is a UX affordance. The
> set-claims check is the enforcement. A client that skips the pre-flight is still refused.**

---

## 3. Files to create and modify

### CREATE

**`src/lib/member-capacity.ts`** — the whole decision, as pure-ish server helpers. One
module so both routes ask the same question the same way, and so a test can drive it
directly. Exports in §4.

**`src/utils/member-cap-copy.ts`** — the refusal copy, and nothing else. Separate from
`member-capacity.ts` because the copy is asserted by a test that must not drag the Admin
SDK into scope, and because `AuthPage` (client) renders strings that the routes (server)
also return. Exports in §4, copy verbatim in §5.

**`src/app/api/tenants/member-capacity/route.ts`** — the pre-flight (D9). `POST`. Contract
in §6.

**Tests (new):**
- `src/lib/__tests__/member-capacity.test.ts`
- `src/app/api/auth/set-claims/__tests__/member-cap.test.ts`
- `src/app/api/tenants/member-capacity/__tests__/route.test.ts`
- `src/utils/__tests__/member-cap-copy.test.ts`
- `src/components/__tests__/AuthPage.signup-capped.test.tsx`

### MODIFY

**`src/app/api/auth/set-claims/route.ts`** — after `verifyIdToken` (line 22) and the
self/super-admin check (line 26), and **before** `setCustomClaims(uid)` (line 30), call the
capacity decision. On `refused`, return 403 and do not call line 30. On `unavailable`,
return 503 and do not call line 30. On `allowed` / `skipped`, the existing line 30 runs
unchanged. The existing `catch` (lines 33–40) and its `captureHandledError(error, { step:
'auth-set-claims' })` stay as they are. Update the JSDoc block (lines 6–13) to document the
new statuses.

**`src/components/AuthPage.tsx`** —
- `handleEmailAuth` (line 325), signup branch only (`else` of the `isLogin` check at line
  352): after the Turnstile pre-flight (lines 334–350) and after the password checks, and
  **before** `createUserWithEmailAndPassword` (line 393), call the member-capacity
  pre-flight. On refusal, `setError(<copy>)`, `setLoading(false)`, `return` — no Firebase
  account is created.
- `handleGoogleSignIn` (line 246): the same pre-flight before `signInWithPopup` (line 254),
  **gated on the signup mode** — when `isLogin` is true this button is "Continue with
  Google" (line 613) and must not be gated. Pass the current `isLogin` through.
- Handle the set-claims 403 as a real outcome: the calls at line 417 and line 301 currently
  ignore the response entirely (`await fetch(...)`, then `catch { console.error }` at 424 /
  309). A 403 must now clear `success` and set the refusal copy. **This is the
  Silent-Failure Rule applied to an existing hole** — today a failing set-claims already
  leaves the user signed in with no claims and the screen still says "Account created
  successfully!" (line 411).
- No new import of `contact-capacity` — the new modules are separate (see §8).

**`src/utils/contact-capacity.ts`** — rewrite the "🔴 HOW IT BEHAVES: SOFT. IT NEVER BLOCKS
SIGNUP." section (lines 32–50) and the "Where real enforcement would belong" paragraph
(lines 63–72). Details in §8. No behavioural change to any exported function in this file.

**`src/components/__tests__/AuthPage.signup-not-capped.test.tsx`** → **renamed** to
`AuthPage.signup-capped.test.tsx`, assertions **replaced** (not deleted). Details in §8.

---

## 4. Exact function signatures

### `src/lib/member-capacity.ts`

```ts
import type { TenantAddons, TenantPlan } from '@/types/tenant.types';

/** Why the gate did or did not fire. Every branch is named; there is no boolean. */
export type MemberCapOutcome =
  | { status: 'allowed';     cap: number; othersCount: number }
  | { status: 'refused';     cap: number; othersCount: number }
  /** No cap applies: unlimited add-on, UNLIMITED_CAP sentinel, no tenant (D7),
   *  or the applicant already holds this tenant's claim (D3). */
  | { status: 'skipped';     reason: MemberCapSkipReason }
  /** C3: the count or the tenant read failed. NOT an allow, NOT a refusal. */
  | { status: 'unavailable'; reason: string };

export type MemberCapSkipReason =
  | 'no-tenant'            // D7 — tenantId null/absent on the applicant's users doc
  | 'existing-member'      // D3 — adminAuth claim already carries this tenantId
  | 'unlimited-addon'      // D6 — effective.unlimitedContacts === true
  | 'unlimited-sentinel';  // D6 — effective.maxContacts === UNLIMITED_CAP (-1)

/**
 * The tenant's effective member allowance.
 *
 * Reads `plan` and `addons` off `tenants/{tenantId}` with the Admin SDK and runs them
 * through `toTenantPlan()` / `readTenantAddons()` into `getEffectiveFeatures()`
 * (plan-features.ts:927) — NOT `getPlanFeatures`, or a church holding Contacts +500 stays
 * blocked (D6).
 *
 * THROWS when the tenant doc is missing or the read fails (C4). Callers map that to
 * `unavailable`, never to a default cap.
 */
export async function readTenantMemberAllowance(tenantId: string): Promise<{
  plan: TenantPlan;
  addons: TenantAddons;
  maxContacts: number;
  unlimitedContacts: boolean;
}>;

/**
 * How many OTHER members this tenant has — the applicant excluded (D4).
 *
 * `tenantId` must be a concrete non-empty string. Passing '' / null / undefined THROWS
 * rather than querying: `getTenantScope()` returns null for a super admin and null means
 * ALL TENANTS on a read (AGENTS.md), so an unscoped count would count the whole platform.
 *
 * Single-field `where` → automatic index, no composite, nothing in firestore.indexes.json.
 * `excludeSelf` is true only when the applicant's own users doc carries this tenantId.
 */
export async function countOtherMembers(
  tenantId: string,
  excludeSelf: boolean,
): Promise<number>;

/** Pure. `>=`, not `>`. Mirrors isAtContactLimit (contact-capacity.ts:245). */
export function isOverMemberCap(othersCount: number, cap: number): boolean;

/**
 * The whole decision for ONE applicant, as taken at set-claims time.
 *
 * `existingClaimTenantId` comes from adminAuth.getUser(uid).customClaims?.tenantId (D3).
 * `applicantTenantId` comes from the applicant's OWN users doc (D7) — never from request
 * body, never from the Host header.
 *
 * Never throws for a capacity reason: a failure is returned as `unavailable` (C3) after
 * captureHandledError, so the caller answers 503 rather than guessing.
 */
export async function decideMemberCapacity(args: {
  uid: string;
  applicantTenantId: string | null | undefined;
  existingClaimTenantId: string | null | undefined;
}): Promise<MemberCapOutcome>;

/**
 * The pre-flight question, asked before any account exists: "can this tenant accept a new
 * member?" No uid, so no self to exclude — `excludeSelf: false`.
 */
export async function canTenantAcceptNewMember(
  tenantId: string,
): Promise<MemberCapOutcome>;

/**
 * C2 — mark a refused applicant's users doc so the ghost is identifiable for the
 * follow-up sweep. Writes `capRefusedAt` (ISO) and `capRefusedTenantId`. Best-effort:
 * a failure here is captured and swallowed, because it must never turn a clean 403 into a
 * 500. It deletes nothing, disables nothing and touches no other document (D8).
 */
export async function stampRefusal(uid: string, tenantId: string): Promise<void>;
```

### `src/utils/member-cap-copy.ts`

```ts
/** The one exported string builder for the refusal a person actually reads. */
export function memberCapRefusalMessage(ministryName?: string | null): string;

/** Shown when the capacity check itself could not run (C3). Names no cap. */
export const MEMBER_CAP_UNAVAILABLE_MESSAGE: string;

/** Stable machine codes returned alongside the copy. */
export const MEMBER_CAP_REFUSED_CODE = 'member_cap_reached';
export const MEMBER_CAP_UNAVAILABLE_CODE = 'capacity_check_unavailable';
```

---

## 5. The refusal copy (D10)

Who reads this: a new believer someone just led to Christ, standing next to the person who
invited them, on a phone. Not an admin. Not a buyer. They cannot see the plan, cannot
upgrade it, and did nothing wrong.

Constraints honoured: no error code, no mention of plans, upgrades, billing, limits,
capacity, or Harvest support. Names the **ministry**. Points at **whoever invited them**.
Says it is not their fault. Says the same email will work once room is made.

**`memberCapRefusalMessage(ministryName)` — with a ministry name:**

> **{ministryName} can't add new accounts right now.**
> Nothing went wrong on your end, and you didn't do anything incorrectly. Please let the
> person who invited you know — they can make room for you. When they do, come back and
> sign up with this same email address and it will work.

**`memberCapRefusalMessage(null | '' | undefined)` — fallback when the tenant name is not
loaded:**

> **This ministry can't add new accounts right now.**
> Nothing went wrong on your end, and you didn't do anything incorrectly. Please let the
> person who invited you know — they can make room for you. When they do, come back and
> sign up with this same email address and it will work.

The only difference between the two is the first noun phrase; the body is one shared
constant so the two can never drift.

**`MEMBER_CAP_UNAVAILABLE_MESSAGE` (C3):**

> **We couldn't finish setting up your account.** This is on our side, not yours. Please
> try again in a minute — your email address is still available.

Both live in `src/utils/member-cap-copy.ts` and nowhere else. The routes return the string
in the response body; `AuthPage` renders whatever the server sent (falling back to the same
module's builder if the body is unreadable), so there is exactly one wording.

The ministry name at the server comes from `tenants/{tenantId}` (the tenant doc the route
already read for `plan`/`addons` — no extra read). At the client it is `tenantName` from
`useTenant()` (`AuthPage.tsx:195`).

---

## 6. HTTP contracts

### `POST /api/auth/set-claims` (modified)

Request body unchanged: `{ uid: string }`. `Authorization: Bearer <idToken>` unchanged.

| Case | Status | Body | What AuthPage does |
|---|---|---|---|
| No/!Bearer header (unchanged, line 17) | 401 | `{ error: 'Unauthorized' }` | unchanged |
| uid mismatch, not super admin (unchanged, line 26) | 403 | `{ error: 'Forbidden' }` | unchanged |
| Allowed, or skipped (D3/D6/D7) | 200 | `{ success: true, forceRefresh: true }` | unchanged — force-refreshes the token |
| **Refused at cap** | **403** | `{ error: <memberCapRefusalMessage(name)>, code: 'member_cap_reached' }` | clears `success`, sets `error` to `body.error`, stays on the signup screen |
| **Capacity check unavailable** (C3) | **503** | `{ error: MEMBER_CAP_UNAVAILABLE_MESSAGE, code: 'capacity_check_unavailable' }` | clears `success`, sets `error` to `body.error` |
| Anything else throws (unchanged, line 39) | 500 | `{ error: 'Failed to set claims' }` | generic error copy |

403 rather than 402/409: the request is well-formed and authenticated, and the server is
refusing to act on it. 402 would be a payment claim made to a person who is not the buyer.
The two 403s are distinguished by `code`, which is why `code` is mandatory on the new one.

The refusal body carries **no counts and no cap number**. A new believer has no use for
"500 of 500", and it would leak a tenant's size to any unauthenticated prober through the
pre-flight's identical copy.

### `POST /api/tenants/member-capacity` (new)

```
POST /api/tenants/member-capacity
Content-Type: application/json
{ "tenantId": "gracechurch" }
```

**Unauthenticated by necessity** — it is asked before any account exists, exactly like
`/api/auth/verify-turnstile` (`src/app/api/auth/verify-turnstile/route.ts:8-13`). It
therefore cannot use `requireAuth`.

**Rate limit:** it is under `/api/tenants/`, so `middleware.ts:10` gives it the `api`
category, 60/min per IP (`rate-limit.ts:29`). That is the right bucket and the reason for
the path. Putting it under `/api/auth/` would put it in the `auth` bucket
(`middleware.ts:7`, 5/min, `rate-limit.ts:36`) — a bucket a single signup already spends
twice (verify-turnstile, set-claims), so a church behind one NAT would start 429ing its own
members. ⚠️ Note the standing finding: rate limiting is inactive on preview deploys because
`UPSTASH_REDIS_REST_URL` is production-only (`middleware.ts:20-22`).

`export const dynamic = 'force-dynamic';` — matches every other Admin-SDK route.

| Case | Status | Body |
|---|---|---|
| Tenant can accept a member (`allowed` / any `skipped`) | 200 | `{ canAccept: true }` |
| Tenant is at or over the cap | 200 | `{ canAccept: false, message: <memberCapRefusalMessage(name)>, code: 'member_cap_reached' }` |
| Body missing/not an object/`tenantId` not a non-empty string | 400 | `{ error: 'tenantId required' }` |
| Tenant doc missing, or capacity check failed (C3/C4) | 503 | `{ canAccept: false, message: MEMBER_CAP_UNAVAILABLE_MESSAGE, code: 'capacity_check_unavailable' }` |

**200 for the refusal, not 403.** This route answers a *question*; it refuses nothing. A
403 here would be indistinguishable from an auth failure to the client and would tempt a
`catch`-to-default. The answer is in the body and the client must read it.

Response carries `canAccept`, `message`, `code` — **never** a count, a cap, a plan name or
a tenant name field. `message` already contains the ministry name where one exists.

**What AuthPage does with it:**

| Pre-flight result | AuthPage behaviour (signup path only) |
|---|---|
| `200 { canAccept: true }` | proceed to `createUserWithEmailAndPassword` (393) / `signInWithPopup` (254) |
| `200 { canAccept: false, message }` | `setError(message)`, `setLoading(false)`, `return`. **No Firebase account is created, no `users` doc is written.** |
| `503 { message }` | `setError(message)`, `setLoading(false)`, `return`. Does not attempt signup — proceeding would produce exactly the half-account the pre-flight exists to prevent. |
| `400`, network error, unparseable body | `setError(MEMBER_CAP_UNAVAILABLE_MESSAGE)`, `setLoading(false)`, `return`. 🔴 **Does NOT fall through to signup.** A `catch { /* proceed */ }` here is the Silent-Failure Rule violation this spec is most likely to be implemented with; the set-claims gate would then refuse the person *after* creating their account, which is the outcome D9 exists to avoid. |
| Sign-in path (`isLogin === true`) | pre-flight is **not called at all** |

Rendering: both messages go through the existing `error` state and the existing red banner
at `AuthPage.tsx:548-566`. No new component. `emailInUse` stays false, so no "Sign in
instead" CTA appears (they have no account to sign into).

---

## 7. The read-cost tradeoff (D5)

**Chosen: a count aggregation per signup. Rejected: a maintained counter on the tenant doc.**

The query:

```ts
adminDb.collection('users').where('tenantId', '==', tenantId).count().get()
```

**Why it is cheap enough.**
- Firestore bills a count aggregation at **1 document read per 1,000 index entries
  scanned**, rounded up. A 2,000-member Ministry tenant costs 2 reads. A 500-member free
  tenant costs 1.
- It runs **once per signup**, not once per request — and, because of D3, **not at all**
  for an existing member signing in. An over-cap tenant's daily sign-in traffic costs
  nothing new. The marginal cost is bounded by new-account volume, which is exactly the
  thing the cap bounds.
- The pre-flight adds one more such aggregation per signup attempt. Two aggregations per
  new member is the whole cost.
- It is a **single-field `where`** → automatic index. Nothing is added to
  `firestore.indexes.json`, and there is no composite index to forget. This matters more
  than the money: a missing composite index rejects the query, and a rejected query behind
  a `catch`-to-default renders as a wrong answer, silently (AGENTS.md, Traps; bugs #236 and
  #239).
- Precedent in this codebase: `src/app/api/courses/adopt/route.ts:118` already gates the
  `maxCourses` cap with exactly this pattern —
  `adminDb.collection('courses').where('tenantId','==',tenantId).count().get()`.

**Why a maintained counter was rejected.**
- **It would drift, silently.** At least three paths remove or detach members:
  `src/app/api/account/delete/route.ts` (line 162 reads the doc, line 248
  `adminAuth.deleteUser`), and `src/app/api/tenants/delete/route.ts` — both its
  detach-members path (lines 200–231, which paginates `users.where('tenantId','==',t)` and
  nulls the field) and its hard-delete path (lines 335–341). Every one of those would have
  to decrement a counter, and any future path that forgets makes the counter drift **high**
  — which locks a church out of members it is entitled to, with no error anywhere. That is
  precisely the bug class the Silent-Failure Rule names.
- **It needs a backfill over live production tenants** before it can be trusted, and a
  backfill run against real data is a separate, higher-risk change that cannot be verified
  on a preview deploy (no `FIREBASE_SERVICE_ACCOUNT` there).
- **It creates a second copy of one fact.** The count already exists, derivable, in the
  `users` collection. `contact-capacity.ts:24-29` records this exact reasoning for the CRM
  count: *"two counts of one fact is the duplicated-fact shape behind the retention bug,
  the four-copy over-sell and the stale price table."*

The honest summary to carry in the PR description: **we chose the answer that can be wrong
loudly over the answer that can be wrong quietly, and it costs 1–2 document reads per
signup.**

---

## 8. The contradictory statements of intent, and what happens to them

Two places in the repo currently assert the **opposite** policy. THE-201 deliberately
reverses it. Both must be rewritten in this PR so the codebase does not carry two
contradictory statements of intent — and both must record **why** the reversal happened,
because the old reasoning is good reasoning that simply lost to a new constraint.

**The reason, to be written into both:** the old rule was designed for a product where
every tenant paid. A Forever Free tier makes an unbounded member count an existential cost
problem — free tenants pay nothing and would otherwise grow without limit — so the cap must
bind on signup or free is unbounded (`FOREVER-FREE-handoff.md:93-96`). The old rule's real
concern (a visitor refused with an error they cannot act on) is answered by the copy in §5,
which names the ministry and the inviter instead of a plan.

### `src/utils/contact-capacity.ts` — module header

- Replace the section headed **"🔴 HOW IT BEHAVES: SOFT. IT NEVER BLOCKS SIGNUP."**
  (lines 32–50), including the table row *"a member signs up | ALWAYS works. Nothing is
  blocked."* and the sentence *"Nothing in this module is reachable from the signup path,
  and it must stay that way."*
- New text must state: member signup **is** gated, server-side, by
  `src/lib/member-capacity.ts` at `POST /api/auth/set-claims` (THE-201); this module remains
  the **client-side CRM** cap over the same `maxContacts` number and still gates only the
  admin's manual add; the two read the same allowance through `getEffectiveFeatures`; and
  the reversal's reason (above).
- Replace the **"Where real enforcement would belong"** paragraph (lines 63–72). Its
  prediction was accurate — *"the one server hop every new account makes is POST
  /api/auth/set-claims"* — but its conclusion (*"it must not refuse the account"*) is now
  false. Rewrite it to point at the module that does it.
- Keep the **"⚠️ BLOCKS NEW MANUAL ADDS ONLY … Nothing in this module deletes, hides,
  disables or demotes anyone"** paragraph (lines 74–77) as-is. It is still true and is now
  also the member rule (D8).
- **No exported function in this file changes.** No behavioural edit.

### `src/components/__tests__/AuthPage.signup-not-capped.test.tsx`

**Renamed** to `src/components/__tests__/AuthPage.signup-capped.test.tsx`, with its
assertions **replaced**, not deleted. Its scaffolding (the `vi.hoisted` doubles at lines
33–46, the Turnstile stub at 72–77, `typeInto`/`byPlaceholder` at 93–102, the `over-cap-church`
tenant fixture) is good and should be reused.

What must change:

| Current | Line | Becomes |
|---|---|---|
| Header comment "REP-6 — `maxContacts` IS A SOFT CAP. SIGNUP IS NEVER BLOCKED" | 7–30 | The new rule, plus a note that THE-201 reversed REP-6 and why |
| `it('can still create an account — signup is never blocked')` | 125 | `it('is refused before any account is created')` — pre-flight returns `canAccept:false`; assert `createUser` **not** called and `setDoc` **not** called |
| `expect(text).not.toMatch(/contact limit\|member limit\|upgrade your plan\|at capacity\|is full\|too many/i)` | 159 | Keep this assertion — **inverted in purpose, identical in text**. The new copy still must not contain any of those phrases (D10). Move it into the refusal test. |
| `it('only the admin CRM imports contact-capacity')` + ALLOWED set | 187–195 | **Keep unchanged.** Still true — the signup path imports `member-capacity` / `member-cap-copy`, not `contact-capacity`. This is the reason for two modules. |
| `it('the signup screen names no contact cap at all')` — `expect(src).not.toMatch(/contact-capacity\|maxContacts\|ContactLimit\|memberAccounts\|useCRMCounts/)` | 202–205 | **Keep the regex exactly as-is.** AuthPage must still not reference any of those five symbols; it references `/api/tenants/member-capacity` and `member-cap-copy` instead. |
| `it('nothing that creates a `users` doc consults a cap first')` — asserts AuthPage and set-claims/route.ts match none of `/maxContacts\|ContactLimit\|contact-capacity/` | 207–215 | **Invert.** Assert that `app/api/auth/set-claims/route.ts` DOES reference the member-capacity decision, and that neither file references `contact-capacity` |

A test that pins an absence is only as good as the reason for the absence; when the reason
reverses, the test is rewritten with the new reason written above it. Deleting it would
leave the reversal unrecorded.

---

## 9. Data model

No collection is created. No document shape changes, except one field pair written **only**
on the refusal path (C2), on the refused applicant's own document:

`users/{uid}` — add, on refusal only:
- `capRefusedAt: string` — ISO 8601, when the tenant claim was withheld
- `capRefusedTenantId: string` — the tenant that was full

Nothing reads these fields in this PR. They exist so the follow-up sweep can find the
ghosts, and so an admin debugging "why can't Sarah get in" has a fact instead of a guess.
Neither is used in a query (no index needed).

`tenants/{tenantId}` is **read only** — `plan` and `addons`. The Dodo/Stripe webhook remains
the single writer of both (`FOREVER-FREE-handoff.md:223`).

---

## 10. Security implications

- **Does this touch tenant-scoped data?** YES — it counts `users` by `tenantId` and reads
  `tenants/{tenantId}`. Both server-side, Admin SDK.
- **Where does `tenantId` come from?** From the **applicant's own `users` doc**, read
  server-side by uid. Never from the request body, never from the `Host` header, never from
  a client claim. The pre-flight route does accept a client-supplied `tenantId`, and that is
  acceptable *only* because it is a read-only yes/no about a public fact (whether a
  subdomain is accepting signups) and grants nothing — but it must be validated as a
  non-empty string and must never be used for a write.
- **Does it need a `firestore.rules` change?** NO. Explicitly, deliberately, no. The
  `users/{uid}` create rule at line 144 stays as it is; see RESIDUAL EXPOSURE.
- **Is a new endpoint public?** YES — `/api/tenants/member-capacity` is unauthenticated by
  necessity. Rate-limit category **`api`** (60/min/IP), applied automatically by
  `middleware.ts:10`. No route-level `checkRateLimit` call is needed or wanted; middleware
  is where this repo does it.
- **Information disclosure:** the pre-flight tells an anonymous caller whether a given
  subdomain is at capacity. That is a boolean about a public signup form — the same fact
  they would learn by trying to sign up. It must not leak the count, the cap, the plan or
  the add-on set, which is why the response body carries none of them.
- **Cross-tenant:** the count query is scoped by a single concrete `tenantId` and a missing
  one throws (D7). Tenant B's members can never enter tenant A's number. A super admin
  (`tenantId` null) is skipped entirely rather than counted against anything.
- **Denial of service against a ministry:** an attacker could create accounts to fill a
  church's cap. That risk exists today unbounded; this PR bounds it at the cap and leaves
  the Turnstile bot gate (`AuthPage.tsx:334-350`) as the defence, unchanged.

---

## 11. Acceptance criteria

Each is independently verifiable by someone who did not write this spec, and each names the
file that proves it.

1. **A new member is refused at the cap.** A tenant on `plus` (cap 150) with 150 existing
   members: `POST /api/auth/set-claims` for a 151st uid returns **403** with
   `code: 'member_cap_reached'`, and `setCustomClaims` is **never called**.
   → `src/app/api/auth/set-claims/__tests__/member-cap.test.ts`

2. **An existing member still signs in on an over-cap tenant.** A tenant on `plus` with 500
   members (moved down from free): a uid whose `adminAuth.getUser()` already returns
   `customClaims.tenantId === t` gets **200**, `setCustomClaims` **is** called, and **no
   count query runs at all** (assert the `count()` double was not invoked).
   → `src/app/api/auth/set-claims/__tests__/member-cap.test.ts`

3. **The 500th is allowed and the 501st is refused.** On a `pro` tenant (cap 500,
   `plan-features.ts:320`): with `total = 500` (`othersCount = 499`) → allowed, 200; with
   `total = 501` (`othersCount = 500`) → refused, 403. Both cases in one test so the
   off-by-one cannot be fixed in one direction only.
   → `src/lib/__tests__/member-capacity.test.ts` + `…/set-claims/__tests__/member-cap.test.ts`

4. **The Contacts +500 add-on lifts the gate.** A `plus` tenant (base 150) with
   `addons: { contactPacks: 1 }` and 150 existing members: allowed. With `contactPacks: 1`
   and 650 members: refused. Proves the gate reads `getEffectiveFeatures`
   (`plan-features.ts:927`) and not `getPlanFeatures`.
   → `src/lib/__tests__/member-capacity.test.ts`

5. **Unlimited Contacts lifts the gate entirely.** `addons: { unlimitedContacts: true }` on
   a `plus` tenant with 10,000 members: `status: 'skipped'`, reason `'unlimited-addon'`, and
   **the count query is never issued** — the boolean is checked before any numeric
   comparison (D6). The `UNLIMITED_CAP` (-1) sentinel (`plan-features.ts:821`) is likewise
   treated as no cap.
   → `src/lib/__tests__/member-capacity.test.ts`

6. **A tier upgrade lifts the gate.** Same tenant id, same member count (500): with
   `plan: 'plus'` → refused; with `plan: 'pro'` → allowed. No migration, no backfill, no
   cached value between the two.
   → `src/lib/__tests__/member-capacity.test.ts`

7. **The count query carries a concrete tenant id.** The Firestore double records its
   `where()` arguments; assert `['tenantId', '==', 'gracechurch']` with a non-empty string
   value. Additionally: `countOtherMembers('', …)`, `(null as any, …)` and
   `(undefined as any, …)` each **throw** and issue **no query** — a count with a null
   tenant would count the entire platform.
   → `src/lib/__tests__/member-capacity.test.ts`

8. **A super admin is unaffected.** An applicant whose `users` doc has `tenantId: null`
   (super admin, or a main-site `theharvest.app` account): `status: 'skipped'`, reason
   `'no-tenant'`, no count query, `setCustomClaims` called, **200**.
   → `src/lib/__tests__/member-capacity.test.ts` + `…/set-claims/__tests__/member-cap.test.ts`

9. **The refusal copy is readable and names the inviter and the ministry.** Assert the
   string returned by `memberCapRefusalMessage('Grace Church')`:
   contains `Grace Church`; matches `/invited you/i`; matches `/same email/i`; and matches
   **none** of `/plan|upgrade|billing|subscription|tier|support|limit|cap|quota|error|contact
   us|Harvest/i`. Assert the no-name fallback contains `This ministry` and is otherwise
   character-identical to the named variant after the first sentence.
   → `src/utils/__tests__/member-cap-copy.test.ts`

10. **No member is ever removed, disabled or deleted on the refusal path.** The Admin SDK
    doubles record every call. On a refusal, assert **zero** calls to `adminAuth.deleteUser`,
    `adminAuth.updateUser` (i.e. no `disabled: true`), `adminAuth.setCustomUserClaims`,
    `removeTenantClaims`, and **zero** `.delete()` on any `users` doc. Assert the only write
    is the `capRefusedAt` / `capRefusedTenantId` stamp on the applicant's own doc, and that
    no other document path is written.
    → `src/app/api/auth/set-claims/__tests__/member-cap.test.ts`

11. **The pre-flight prevents the half-account.** With the pre-flight answering
    `{ canAccept: false }`, clicking "Create account" on `AuthPage` calls **neither**
    `createUserWithEmailAndPassword` **nor** `setDoc`, and the refusal copy is rendered in
    the error banner.
    → `src/components/__tests__/AuthPage.signup-capped.test.tsx`

12. **The pre-flight never fires on sign-in.** In `isLogin` mode, submitting the form and
    clicking "Continue with Google" issue **no** request to `/api/tenants/member-capacity`.
    → `src/components/__tests__/AuthPage.signup-capped.test.tsx`

13. **A failed capacity check is loud, and is neither an allow nor a refusal (C3).** With
    the count rejecting: `decideMemberCapacity` returns `status: 'unavailable'`, the route
    returns **503** with `code: 'capacity_check_unavailable'`, `setCustomClaims` is **not**
    called, `captureHandledError` **is** called, and the body copy contains none of
    `/full|capacity|limit|invited/i`. Same for a missing `tenants/{id}` doc (C4) — assert it
    does **not** silently become a `'plus'` 150 cap.
    → `src/lib/__tests__/member-capacity.test.ts` + `…/set-claims/__tests__/member-cap.test.ts`

14. **A pre-flight failure does not fall through to signup.** With the pre-flight fetch
    rejecting (network error) and with it returning 503, `AuthPage` renders the unavailable
    copy and calls **neither** `createUserWithEmailAndPassword` **nor** `setDoc`.
    → `src/components/__tests__/AuthPage.signup-capped.test.tsx`

15. **The pre-flight route validates and scopes.** `{}`, `{ tenantId: '' }`,
    `{ tenantId: 123 }` and a non-JSON body each return **400** and issue no query;
    a valid body issues exactly one single-field `where('tenantId','==',<the id>)`.
    → `src/app/api/tenants/member-capacity/__tests__/route.test.ts`

16. **The two statements of intent agree.** The old absence-pinning test file no longer
    exists under its old name; `contact-capacity.ts` no longer contains the string
    `IT NEVER BLOCKS SIGNUP`; and `AuthPage.tsx` still matches none of
    `/contact-capacity|maxContacts|ContactLimit|memberAccounts|useCRMCounts/`.
    → `src/components/__tests__/AuthPage.signup-capped.test.tsx`

---

## 12. Test plan & verification

- **Unit/route:** the five files above, vitest, colocated in `__tests__`. Follow the
  existing house style for Admin-SDK doubles — `src/app/api/courses/__tests__/adopt-route.test.ts`
  is the closest model (it mocks `@/lib/firebase-admin` with a `collection()` factory and
  hoisted count values, and it tests the same `count().get()` cap shape). For the claims
  side, `src/lib/__tests__/set-custom-claims.test.ts` shows the `adminAuth` double.
- **Component:** reuse the scaffolding in the renamed AuthPage test (`vi.hoisted` doubles,
  Turnstile stub, `happyDOM.setURL`). `fetch` must be stubbed per-call now — the current
  blanket `vi.stubGlobal('fetch', … ok:true …)` at lines 109–111 would answer the
  member-capacity pre-flight `{ success: true }`, which has no `canAccept` field; the stub
  must route by URL.
- **Types:** `typescript: { ignoreBuildErrors: true }` in `next.config.mjs` means a green
  Vercel build proves nothing. Run `tsc --noEmit` on this checkout **before** any change,
  save the count, and compare after. Per THE-48 the baseline is not reproducible between
  environments — measure it here, not from another session's number.
- **Rules:** no rules change, so `npm run test:rules` is not required. Do not run a rules
  deploy.
- 🔴 **Preview deploys cannot QA this.** `FIREBASE_SERVICE_ACCOUNT` is production-only, so
  every Admin-SDK path in this PR — the count, the tenant read, the claim minting — is
  non-functional on a preview URL. A preview will show the signup form and the pre-flight
  will fail; per §6 that renders the *unavailable* copy and blocks signup, which on a
  preview is **expected and not a bug**. Do not "fix" it by falling through to signup.
  End-to-end verification of the refusal is possible only against production or against a
  local run with real credentials. Say this in the PR description; an agent that reports
  "verified on the preview URL" has verified nothing.
- **Rate limiting is also inactive on previews** (`UPSTASH_REDIS_REST_URL` is
  production-only, `middleware.ts:20-22`), so the pre-flight's 60/min ceiling is untested
  there too.
- **Confirm green on CI, not locally** (`FOREVER-FREE-handoff.md:224`).

---

## 13. RESIDUAL EXPOSURE — what this PR does NOT close

Write these up as follow-up cards. They are known, deliberate and bounded.

**R1 — the ghost `users` doc (the main one).**
`firestore.rules:144` lets any authenticated user create their own `users/{uid}` document.
A refused applicant therefore ends up with: a Firebase Auth account, a `users/{uid}` doc
carrying `tenantId`, and **no tenant custom claim**. They can read their own doc
(rules:139-140) and nothing else of the tenant's. The tenant's admins see them in the CRM
member list (rules:142 lets a tenant admin read by `resource.data.tenantId`).

Closing it means making `users/{uid}` creation server-only and routing signup through a new
server route — a `firestore.rules` change, which auto-deploys to production on merge with no
CI rules test, plus a rewrite of both signup paths in `AuthPage`. That does not belong in the
same PR as the gate. **Follow-up card: "Make `users/{uid}` creation server-only (closes the
THE-201 ghost doc)."**

**R2 — ghost docs consume capacity (C2).**
Because R1's ghosts carry `tenantId`, they are counted by the D5 count query and a church
never gets those slots back. Bounded to one ghost per refused human (uid-keyed, retries do
not multiply) and rare (the pre-flight is what a real person hits). `capRefusedAt` /
`capRefusedTenantId` are written precisely so the sweep can find them. **Follow-up card:
"Sweep cap-refused ghost `users` docs and reconcile member counts."** R1 makes R2
disappear; the sweep is only needed for ghosts created before R1 lands.

**R3 — no admin-side visibility.**
Nothing tells a church admin that their ministry is turning people away. No banner, no
email, no dashboard count. An evangelist could invite ten people and never learn why none
of them arrived. This is genuinely bad and is genuinely out of scope: the admin surface is
THE-202/THE-203. **Follow-up card: "Tell the admin when their ministry is refusing
signups."** Flag it to the PM — it may deserve to ship *with* the gate rather than after it.

**R4 — no invite-aware exception.**
There is no notion of "this person was specifically invited, let them in over the cap." The
gate is purely numeric.

**R5 — a race at exactly the cap.**
Two simultaneous signups can both read `othersCount = cap - 1` and both be admitted, leaving
the tenant one over. Firestore aggregations are not transactional against concurrent writes.
Accepted: the overshoot is at most the concurrency of the moment, it errs toward *admitting*
a real person rather than refusing one, and the next signup is refused correctly. A
transaction would need a maintained counter, which §7 rejects for stronger reasons.

**R6 — the gate is not applied to any other account-creation path.**
`AuthPage` is the only member self-signup surface today, and `POST /api/auth/set-claims` is
the only claim issuer, so the enforcement point is complete for the paths that exist. Any
future path that creates a member — an admin "invite member" flow, a bulk importer — must
call `decideMemberCapacity` too. There is no structural test that would catch a new one.

---

## 14. FILES DELIBERATELY NOT TOUCHED

- **`firestore.rules`** — auto-deploys to production on merge (`.github/workflows/deploy-rules.yml`),
  CI runs no emulator rules tests. The `users/{userId}` create rule at line 144 stays exactly
  as it is. See R1.
- **`storage.rules`**, **`firebase.json`** — same auto-deploy workflow.
- **`functions/`** — does not deploy on merge; a change there would look shipped and would
  not be.
- **`firestore.indexes.json`** — the count is a single-field `where`, which uses the
  automatic index. Nothing to add. If a reviewer sees a change here, the query grew a second
  `where` and the PR is wrong.
- **`src/lib/set-custom-claims.ts`** — not modified. Its swallowing `catch` (lines 80–82) is
  why the gate lives in the route instead (C1). Fixing that `catch` is a real and separate
  piece of work; doing it inside this PR would change the behaviour of every existing caller
  (the Dodo webhook, `finish-setup`, `migrate-claims`) at the same time as adding a signup
  gate.
- **`src/utils/plan-features.ts`** — read only. `getEffectiveFeatures`, `readTenantAddons`,
  `toTenantPlan`, `CONTACTS_PER_PACK` and `UNLIMITED_CAP` are consumed as they are; no cell
  in `PLAN_FEATURES` moves. THE-200 set the `free` row and it is correct.
- **`src/utils/contact-capacity.ts` — exported functions.** Only the module header prose
  changes (§8). `resolveContactLimit` (:126), `hasUnlimitedContacts` (:140),
  `isAtContactLimit` (:245) and `contactLimitMessage` (:270) keep their current behaviour and
  their current callers.
- **`src/components/AdminCRM.tsx`** — the client-side contact cap is untouched. It remains
  the only importer of `contact-capacity`, which is what keeps that module's structural test
  meaningful.
- **`src/app/api/account/delete/route.ts`**, **`src/app/api/tenants/delete/route.ts`** — read
  during planning only, to establish that a maintained counter would have three decrement
  sites (§7). No change.
- **`src/lib/rate-limit.ts`**, **`src/middleware.ts`** — the new route's rate limit comes for
  free from the existing `/api/` pattern (`middleware.ts:10`). No new category, no new
  pattern.
- **The sign-in path** in `AuthPage` (the `isLogin` branch at line 352, and Google
  "Continue with Google" at line 613) — never gated.

---

## 15. Rollback

The gate is stateless and reads only. To disable it in production:

1. Revert the PR. There is no data migration to undo and no counter to reconcile — the only
   thing written is `capRefusedAt` / `capRefusedTenantId` on refused applicants' own docs,
   which nothing reads and which are harmless if left.
2. No claim was removed from anyone, so no one loses access on revert. Refused applicants
   who then retry get their claim minted by the unmodified route on their next sign-in
   attempt (their `users` doc still says `tenantId`, and `setCustomClaims` reads it at
   `set-custom-claims.ts:24`) — the ghosts heal themselves.
3. If a faster kill than a revert is needed, the smallest safe change is to make
   `decideMemberCapacity` return `{ status: 'skipped', reason: 'no-tenant' }` unconditionally
   at its first line and ship that. 🔴 Do **not** kill it by wrapping the call site in a
   `try/catch` that proceeds — that reintroduces the silent-allow this spec spent §C3
   avoiding, and it would also swallow real errors.
