# Phase A Audit — Harvest Phase 2

Produced from static code analysis on branch `claude/harvest-phase-2-plan-rwxtl7`.
No live site access; pricing-table section is code-only and flags items that need manual verification against the live page.

---

## 1. Onboarding Screen-by-Screen

### 1a. User Onboarding — `src/components/Onboarding.tsx`

Single-screen form shown to a member after they sign up to an existing tenant's app.

**What it renders (default, no custom questions configured)**

| # | Field | Type | Required | Notes |
|---|-------|------|----------|-------|
| — | "Use my current location" button | GPS trigger | — | Fires on mount automatically; also button at top |
| 1 | Full Name | text | yes | Pre-filled from Google Auth `displayName` |
| 2 | Country | CountrySelect dropdown | yes | Auto-filled by GPS via Nominatim reverse-geocode |
| 3 | City | text | yes | Auto-filled by GPS |
| 4 | Phone Number | tel | yes | |
| 5 | Have you accepted Jesus? | Yes / No radio | yes | Default label; overridable via custom question config |

**GPS behaviour**
- On mount it silently requests `navigator.geolocation` and calls Nominatim.
- Errors are swallowed (logged to console only, no UI feedback unless user presses the button again).

**Custom questions mode**

If `tenants/{tenantId}/config.onboardingQuestions` is a non-empty array, the hardcoded defaults are replaced by that array. Question IDs starting with `default_` are mapped to the same name/country/city/phone/acceptedJesus bindings. Custom IDs render generically with types: `text`, `textarea`, `select`, `radio`.

**On submit**

Writes to `users/{uid}`:
```
displayName, country, city, phone, acceptedJesus (bool),
onboardingCompleted: true, onboardingAnswers (if any custom answers)
```
Uses `updateDoc` (not `setDoc`), so the user doc must already exist.

**Bug / gap** — No validation that `customQuestions` length > 0 before the fallback renders. If the tenant config fetch fails silently (network or Firestore error), the hardcoded defaults render without the church's custom branding — users see the Harvest defaults regardless of tenant configuration.

---

### 1b. Church Onboarding — `src/components/ChurchOnboarding.tsx`

Multi-step flow shown when a new org admin registers their ministry.

**Plan-dependent step count**

| Plans | Steps | Sequence |
|-------|-------|----------|
| Plus, Pro | 2 | Ministry Info → Done |
| Max, Ultra, Enterprise | 3 | Ministry Info → Branding → Done |

The check for showing the Branding step is:
```typescript
const hasBranding = selectedPlan === 'max' || selectedPlan === 'ultra' || selectedPlan === 'enterprise';
```
The inline comment says "Ultra/Enterprise only" — this is stale; Max also gets the Branding step.

---

**Step 0 — Ministry Info**

| Field | Required | Notes |
|-------|----------|-------|
| Ministry Name | yes (≥2 chars) | Drives auto-generated subdomain |
| Subdomain | yes (≥3 chars) | Auto-generated from name, validated real-time via `isSubdomainAvailable()`, 500ms debounce. Green/red inline status. Suffix `.theharvest.app` shown. |
| Custom Domain | optional | Only rendered for Max/Ultra/Enterprise. No DNS validation here. |
| Description | optional | Textarea |

"Continue" is disabled until `subdomainStatus === 'available'`.

---

**Step 1 — Branding (Max/Ultra/Enterprise only)**

| Field | Notes |
|-------|-------|
| Ministry Logo | `ImageUpload` component, stored as URL string |
| Brand Color | Native `<input type="color">`, defaults to `#D4AF37` |

"Launch Ministry" triggers `handleFinish()`.

---

**`handleFinish()` side effects (called from Branding step "Launch Ministry" button)**

1. `createTenant({name, subdomain, plan, adminEmails, config})` — writes `tenants/{subdomain}`
2. `updateDoc(users/{uid}, {tenantId, role:'church_admin', plan, onboardingCompleted:true})`
3. POST `/api/auth/set-claims` to write custom Firebase claims
4. `user.getIdToken(true)` — force-refresh JWT
5. Fire-and-forget `sendEmail(welcomeEmail(...))` to admin email
6. `setStep(hasBranding ? 2 : 1)` — advance to Done

---

**Step 2 (or Step 1 for Plus/Pro) — Done**

Shows success with `{subdomain}.theharvest.app` (and custom domain if entered).

- If `signupPlan` prop was passed: shows **"Continue to Payment"** button → POST `/api/stripe/checkout` with `{plan, billing:'monthly', tenantId, tenantName, email}`.
- If no `signupPlan`: shows **"Go to Admin Dashboard"** → calls `onComplete()`.

---

**CRITICAL BUG — Plus/Pro tenant never created**

`handleFinish()` is only wired to the Branding step button. For Plus/Pro (`hasBranding = false`), the Branding step never appears, so `handleFinish()` is never called.

Consequence:
- `createdTenantId` is `null` when the Done screen renders.
- If `signupPlan` is set (paid plan), "Continue to Payment" immediately errors: *"Could not find your tenant. Please try again."*
- If no `signupPlan`, "Go to Admin Dashboard" calls `onComplete()` but no tenant document was created — admin sees a broken dashboard with no tenantId claims.

Fix required: call `handleFinish()` from within `handleNext()` when `!hasBranding && step === 0` (i.e. moving from Ministry Info directly to Done).

---

## 2. Pricing Table — Code vs. Live Site

**Source:** `src/utils/plan-features.ts`

Note: The live site at theharvest.site was not directly accessed. Items marked **[VERIFY]** need manual comparison against the live pricing page.

### Display names

`plan-features.ts` uses these canonical display names:
```
plus → 'Individual'
pro  → 'Community'
max  → 'Church'
ultra → 'Ministry'
enterprise → 'Enterprise'
```

`ChurchOnboarding.tsx` has its own local `PLAN_NAMES`:
```
plus → 'Plus', pro → 'Pro', max → 'Max', ultra → 'Ultra', enterprise → 'Enterprise'
```
These two name sets are out of sync. The plan badge shown during onboarding ("Plus Plan", "Pro Plan") doesn't match the canonical display names shown everywhere else ("Individual", "Community").

### Feature matrix (from code)

| Feature | Individual (plus) | Community (pro) | Church (max) | Ministry (ultra) | Enterprise |
|---------|:-:|:-:|:-:|:-:|:-:|
| Blog | ✓ | ✓ | ✓ | ✓ | ✓ |
| AI Chat | ✗ | ✓ | ✓ | ✓ | ✓ |
| AI Knowledge Base | ✗ | ✓ | ✓ | ✓ | ✓ |
| Church Map | ✗ | ✗ | ✗ | ✗ | ✓ |
| Locations (churches) | 1 | 1 | 1 | 1 | unlimited |
| Courses | 5 | unlimited | unlimited | unlimited | unlimited |
| Admin seats | 2 | 5 | unlimited | unlimited | unlimited |
| Custom Domain | ✗ | ✗ | ✓ | ✓ | ✓ |
| Custom Auth Background | ✗ | ✗ | ✓ | ✓ | ✓ |
| Newsletter Automation | ✗ | **✓** | ✓ | ✓ | ✓ |
| SMS Automation | ✗ | ✗ | ✓ | ✓ | ✓ |
| AI Assistant (included) | ✗ | ✗ | ✗ | ✓ | ✓ |

### Confirmed mismatch

**Newsletter Automation on Pro (Community)**: `pro.newsletterAutomation = true` in code. The task description confirms this is wrong relative to the live pricing page — newsletter automation was likely not supposed to be included in Pro. **Verify what the live page says and adjust the code accordingly.**

### Items to verify against the live page

1. **Newsletter Automation on Pro** — confirmed mismatch, direction unknown. Does live page show it as included or excluded?
2. **Locations (churches)**: Code says max=1 for all plans except Enterprise. Does the live page claim multi-location support on any plan below Enterprise?
3. **Courses limit**: Does the live page specify the 5-course limit on Individual, or just say "limited"?
4. **Admin seats**: Does the live page show 2 admins for Individual, 5 for Community?
5. **Church Map**: Only Enterprise in code. Does the live page imply it's in any lower tier?
6. **AI Chat vs AI Knowledge Base**: Code treats them as separate features. Does the live page bundle them together or split them?
7. **Plan display names**: Does the live page say "Individual / Community / Church / Ministry" or "Plus / Pro / Max / Ultra"?

---

## 3. Affiliate Pipeline — End-to-End Trace

### 3a. Full pipeline

```
1. Affiliate generates link:   https://theharvest.app/?ref={affiliateUid}

2. Visitor lands on site:
   ReferralTracker.tsx mounts (client component)
   → reads ?ref= from URL
   → stores { id: affiliateUid, ts: Date.now() } in localStorage['affiliateReferrerId']
   → strips ?ref= from URL via history.replaceState()
   → 30-day expiry checked on every subsequent mount

3. Visitor signs up and creates their ministry:
   ChurchOnboarding.tsx Step 0 → Step 1/2 → handleFinish() → createTenant()

4. Done screen: "Continue to Payment"
   → POST /api/stripe/checkout { plan, billing, tenantId, tenantName, email }
   → Stripe session created with subscription_data.metadata = { tenantId, plan, billing }
   → Stripe returns session.url → redirect

5. Stripe Checkout payment completed:
   → Stripe sends checkout.session.completed webhook
   → /api/stripe/webhook retrieves subscription metadata
   → looks for meta.referrerId
   → creates affiliate_commissions doc
   → if referrer has active Connect: stripe.transfers.create() → status='paid'
   → else: status='pending'
   → increments referrer's affiliateEarnings, affiliateReferralCount, affiliatePendingPayouts

6. Recurring billing (monthly):
   → invoice.payment_succeeded webhook fires
   → billing_reason != 'subscription_create' check skips first invoice
   → reads referrerId from subscription.metadata
   → 10% commission on invoice.amount_paid
   → same transfer logic

7. Pending retries:
   → POST /api/affiliate/retry-transfers (Vercel Cron, hourly)
   → finds affiliate_commissions where status='pending' AND createdAt < 5 min ago
   → processes up to 50 per run
   → stripe.transfers.create() → status='paid'

8. Transfer fails:
   → transfer.failed webhook fires
   → updates commission to status='failed'
   → decrements affiliatePendingPayouts (NOT affiliateEarnings)
```

---

### 3b. Silent failure points

**[CRITICAL] Gap between steps 3 and 4 — referrerId never passed to checkout**

`ChurchOnboarding.tsx` builds the checkout body at line 429–433:
```typescript
body: JSON.stringify({
  plan: selectedPlan,
  billing: 'monthly',
  tenantId: createdTenantId,
  tenantName: subdomain,
  email: user.email || undefined,
  // ← referrerId is NOT here
})
```

`localStorage['affiliateReferrerId']` is never read inside `ChurchOnboarding.tsx`. The `referrerId` field accepted by `/api/stripe/checkout` is never populated from the onboarding path. This means **no referral commission will ever fire for new ministry sign-ups** regardless of what's in localStorage.

Fix: read `localStorage.getItem('affiliateReferrerId')` in `ChurchOnboarding.tsx` before the checkout call, parse the stored JSON, validate the 30-day expiry, and include `referrerId` in the checkout payload. Also clear it from localStorage after the redirect to avoid re-using it.

---

**[HIGH] Self-referral check reads non-existent fields**

In `stripe/webhook/route.ts` at the `checkout.session.completed` handler:
```typescript
const tenantOwner = tenantDoc.data()?.ownerId || tenantDoc.data()?.createdBy;
if (referrerId === tenantOwner) { // blocks self-referral }
```

`createTenant()` in `tenant.utils.ts` does NOT write `ownerId` or `createdBy` to the tenant document. Both fields are always `undefined`, so `tenantOwner` is always `undefined`. The self-referral check therefore **always evaluates to false** and never blocks anything.

Fix: add `createdBy: uid` (or `ownerId: uid`) to the `tenantData` object in `createTenant()`, then populate it from the user's UID in `ChurchOnboarding.tsx` — though this requires client-side access to `uid` at tenant creation time, which is already available via `auth.currentUser.uid`.

---

**[HIGH] retry-transfers doesn't check for zero-amount commissions**

`retry-transfers/route.ts` calls `stripe.transfers.create({ amount: data.commission, ... })` without guarding against `commission === 0`. Stripe rejects zero-amount transfers with an error. The error is caught in the `catch` block, the commission remains `pending`, and the same commission will be retried every hour indefinitely (until manually cleared).

Triggers when: a customer uses a 100%-off coupon at checkout, making `session.amount_total === 0`, so `commissionAmount = Math.round(0 * 0.10) = 0`.

Fix: add `if (data.commission <= 0) { skipped++; continue; }` before the transfer attempt.

---

**[MEDIUM] affiliateEarnings not reverted on transfer.failed**

In the `transfer.failed` webhook handler:
```typescript
await users.doc(referrerId).update({
  affiliatePendingPayouts: FieldValue.increment(-commissionAmount),
  // affiliateEarnings is NOT decremented
})
```

When a Stripe transfer fails after being recorded as "paid", `affiliateEarnings` keeps the inflated value while `affiliatePendingPayouts` is decremented. The affiliate's dashboard shows earnings they will never receive.

Fix: also decrement `affiliateEarnings` in the `transfer.failed` handler.

---

**[MEDIUM] Recurring commissions break on plan upgrades via Stripe Customer Portal**

When a customer upgrades their plan through the Stripe Customer Portal, Stripe creates a new subscription. The new subscription has no `referrerId` in its metadata (only the original checkout session wrote that). Recurring commission tracking silently stops for all portal-driven upgrades.

No fix is straightforward here without a custom portal flow. At minimum, document this limitation.

---

**[LOW] retry-transfers processes at most 50 commissions per hourly run**

With `.limit(50)` and an hourly cron, the maximum throughput is 50 commissions/hour × 24 = 1,200/day. For current scale this is fine, but the `total` field in the response shows only the batch size (≤50), not the real total pending. Monitoring tooling could misread it.

---

**[LOW] localStorage may be unavailable**

`ReferralTracker.tsx` wraps everything in a `try/catch` for environments where `localStorage` is blocked (Safari ITP in private mode, some browser extensions). Failure is completely silent — no fallback (e.g. sessionStorage or cookie). This is a minor conversion loss that can't be fully fixed on the client.

---

## 4. Instagram / Mailchimp Integration Data Model

### 4a. Current Firestore path and schemas

All integration state lives under a subcollection on the tenant document:
```
tenants/{tenantId}/integrations/{provider}
  where provider = 'instagram' | 'mailchimp'
```

**Instagram document** (`tenants/{tenantId}/integrations/instagram`):
```typescript
{
  connectedAccountId: string,   // Composio connected account ID
  username: string,              // Instagram @handle (fetched via INSTAGRAM_GET_USER_INFO)
  userId: string,                // Instagram user ID
  status: 'pending' | 'active' | 'failed',
  connectedAt: string,           // ISO — written on successful callback
  connectedBy: string,           // Firebase UID of admin who connected it
  initiatedAt: string,           // ISO — written on connect request
  initiatedBy: string,           // Firebase UID of admin who initiated
}
```

**Mailchimp document** (`tenants/{tenantId}/integrations/mailchimp`):
```typescript
{
  connectedAccountId: string,
  email: string,                 // Mailchimp account email (MAILCHIMP_GET_ACCOUNT_INFO)
  audiences: Array<{
    id: string,
    name: string,
    memberCount: number,
  }>,
  selectedAudienceId: string | null,  // Set later via admin UI
  status: 'pending' | 'active' | 'failed',
  connectedAt: string,
  connectedBy: string,
  initiatedAt: string,
  initiatedBy: string,
}
```

Both documents use `.set({ ... }, { merge: true })` on callback, so re-connecting appends/overwrites rather than replacing — historical `initiatedAt`/`initiatedBy` fields survive a reconnect (not useful but harmless).

### 4b. One connection per provider per tenant — current limitation

The schema is a **single document per provider per tenant**. The `connectedBy` / `initiatedBy` fields track who performed the OAuth, but the design supports only one active Instagram account and one active Mailchimp account per ministry at a time.

If a second admin tries to connect when `status === 'active'`, the connect endpoint returns HTTP 409 `"Instagram is already connected. Disconnect first."` — there is no path to associate a second admin's personal Instagram to the same tenant.

### 4c. What "per-admin connections" would require

For Phase 2, if the goal is to let each admin connect their own personal Instagram (e.g. for personal newsletter sending or per-admin publishing), the data model needs to change. Three options:

**Option A — Separate document per admin (simplest migration)**
```
tenants/{tenantId}/integrations/instagram_{uid}
```
Allows multiple concurrent connections, each admin owns theirs. Disconnect targets only their document. No schema change to existing documents — just a naming convention change. Downside: querying "all active connections for this tenant" requires listing the subcollection.

**Option B — Accounts array within the single document**
```
tenants/{tenantId}/integrations/instagram
{
  accounts: [
    { uid, connectedAccountId, username, userId, status, connectedAt }
  ]
}
```
Convenient for reading all accounts in one fetch. Downside: array updates in Firestore require reading the full array first; concurrent writes from two admins would race.

**Option C — Subcollection per provider (most scalable)**
```
tenants/{tenantId}/integrations/instagram/accounts/{uid}
```
Each admin's account is its own document; easy to query by uid; concurrent safe. Adds one extra collection nesting level.

**Recommendation**: Option A or C. Option A is the smallest diff to the existing connect/callback/disconnect routes. Option C is cleaner long-term.

### 4d. Firestore security rules gap

The `tenants/{tenantId}/integrations` subcollection has **no explicit Firestore security rules**. Looking at `firestore.rules`:

```
match /tenants/{tenantId} {
  allow read: if true;         // entire tenant doc is public
  match /settings/{settingId} { ... }  // explicit rule
  match /members/{memberId} { ... }    // explicit rule
  // ← no rule for integrations subcollection
}
```

In Firestore rules v2, unmatched paths default to DENY. Because all API routes use the Admin SDK (which bypasses rules), server-side operations work fine. **However, any client-side direct read of `tenants/{id}/integrations/{provider}` will be denied by default** — even for tenant admins.

`IntegrationsSection.tsx` reads integration status directly from Firestore on the client side. This means one of two things:
- It silently fails to load integration status for all users (status shows as "not connected" even when connected) — **likely happening right now**
- OR it routes through the `/api/composio/instagram/status` API endpoint instead of a direct Firestore read (not confirmed without reading IntegrationsSection.tsx in full)

**Action required regardless**: add explicit rules for the integrations subcollection, e.g.:
```
match /tenants/{tenantId}/integrations/{provider} {
  allow read: if isTenantAdmin(tenantId);
  allow write: if false; // server-only via admin SDK
}
```

### 4e. Sensitive data currently stored in integrations documents

The `connectedAccountId` is a Composio internal ID used to execute API actions on behalf of the connected account. If the Firestore rules were accidentally changed to allow public reads of the integrations subcollection, this ID would be exposed — an attacker could potentially call Composio actions using it (posting to Instagram, sending Mailchimp campaigns).

The current default-DENY for the subcollection is therefore incidentally protective. Explicit rules should be added that make this intentional.
