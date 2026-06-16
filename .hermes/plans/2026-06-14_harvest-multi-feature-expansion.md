# Harvest Platform — Multi-Feature Expansion Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Remove donate section from presentation site, personalize welcome pages per tenant, implement Stripe Connect for church revenue sharing, add cancel partnership globally, allow Ultra/Enterprise custom backgrounds and branding colors, configurable onboarding questions per plan, and Enterprise per-church billing ($15/church/mo).

**Architecture:** Tenant-scoped Firestore docs drive branding, onboarding config, and Stripe Connect. Stripe Connect (Express) handles revenue splits. Enterprise uses Stripe metered/quantity subscriptions for per-church billing.

**Tech Stack:** Next.js, Firebase/Firestore, Stripe Connect, Stripe Checkout/Webhooks

---

## Task 1: Remove Donate Section from Presentation Site

**Objective:** Remove the "Partner With Us / Donate" section and all donate nav links from the presentation website.

**Files:**
- Modify: `/tmp/harvest-site/index.html`

**Steps:**

1. Remove the donate CSS (lines ~304-350): `.donate-inner`, `.donate-card`, `.donate-tabs`, `.donate-amounts`, `.donate-submit`, etc.
2. Remove the nav "Donate" link (line ~413-414 and ~433)
3. Remove the entire `<section class="section section-dark" id="partner">` block (lines ~721-780+)
4. Remove any JS functions related to donate tabs/amounts

**Verification:** Open the site locally and confirm no donate section appears, nav has no Donate link, and page scrolls smoothly past where it was.

---

## Task 2: Personalize "Welcome to [Church Name]" on Subdomains/Custom Domains

**Objective:** When a user accesses a subdomain (e.g., `nations.theharvest.app`) or custom domain, the AuthPage shows "Welcome to [Church Name]" instead of "Welcome to Harvest". The logo and background image come from tenant config.

**Files:**
- Modify: `/tmp/Harvest-agent/src/components/AuthPage.tsx`
- Modify: `/tmp/Harvest-agent/src/contexts/TenantContext.tsx` (already loads branding)

**Steps:**

1. In `AuthPage.tsx`, read tenant branding from TenantContext (name, logo, config)
2. Replace the hardcoded "Welcome to" / "Harvest" with:
   - If tenant exists: "Welcome to" + `tenantName` (from TenantContext)
   - If no tenant (global): "Welcome to Harvest" (current behavior)
3. Replace the hardcoded logo URL with tenant's logo if available, fallback to Harvest logo
4. Replace the hardcoded wheat field background with tenant's `config.backgroundImage` if set (Ultra/Enterprise), fallback to current wheat field
5. Pass tenant context into AuthPage via props or context (AuthPage currently doesn't consume TenantContext — add it)

**Key code in AuthPage.tsx (line 211-216):**
```tsx
<h2 className="text-2xl font-medium text-white/80">
  {isChurchSignup ? 'Set up your' : 'Welcome to'}
</h2>
<h1 className="text-4xl font-black text-white mt-1">
  {isChurchSignup ? 'Ministry' : 'Harvest'}
</h1>
```
Change to:
```tsx
<h2 className="text-2xl font-medium text-white/80">
  {isChurchSignup ? 'Set up your' : 'Welcome to'}
</h2>
<h1 className="text-4xl font-black text-white mt-1">
  {isChurchSignup ? 'Ministry' : (tenantName || 'Harvest')}
</h1>
```

**Verification:** Visit a tenant subdomain — should show "Welcome to [Church Name]". Visit `theharvest.app` — should show "Welcome to Harvest".

---

## Task 3: Custom Branding Color on Welcome Page Buttons

**Objective:** The auth buttons (Google, Email) on the welcome/auth page use the tenant's `primaryColor` from branding config instead of the default style.

**Files:**
- Modify: `/tmp/Harvest-agent/src/components/AuthPage.tsx`

**Steps:**

1. Read `branding.primaryColor` from TenantContext
2. Apply it to the CTA buttons' hover states, borders, and accent elements
3. Default to current styling when no custom color is set

**Verification:** Set a custom color in admin branding → visit subdomain → buttons should use that color.

---

## Task 4: Ultra/Enterprise Custom Background Image

**Objective:** Ultra and Enterprise plans can set a custom background image for the welcome/auth page (default: wheat field). Plus/Pro cannot.

**Files:**
- Modify: `/tmp/Harvest-agent/src/types/tenant.types.ts` — add `backgroundImage?: string` to `TenantConfig`
- Modify: `/tmp/Harvest-agent/src/components/AuthPage.tsx` — use `config.backgroundImage` if set
- Modify: `/tmp/Harvest-agent/src/components/AdminSettings.tsx` — add background image upload for Ultra/Enterprise
- Modify: `/tmp/Harvest-agent/src/utils/plan-features.ts` — add `customBackground: boolean` (true for ultra/enterprise)

**Steps:**

1. Add `backgroundImage?: string` to `TenantConfig` interface
2. Add `customBackground: boolean` to `PlanFeatures` (false for plus/pro, true for ultra/enterprise)
3. In AuthPage, render `config.backgroundImage` as the bg image if present, else wheat field
4. In AdminSettings, add a "Background Image" section under branding (Ultra/Enterprise only) with ImageUpload component
5. Save the URL to tenant config in Firestore

**Verification:** Ultra admin sets background image → visit subdomain → see custom background. Plus admin → no background option visible.

---

## Task 5: Add Stripe Connect to Tenant Config (Admin Settings)

**Objective:** Church admins can connect their own Stripe account from Admin Settings. This enables revenue sharing where donations go directly to the church's Stripe account, minus Harvest's platform fee.

**Files:**
- Create: `/tmp/Harvest-agent/src/app/api/stripe/connect/route.ts` — creates Stripe Connect account link
- Create: `/tmp/Harvest-agent/src/app/api/stripe/connect/callback/route.ts` — handles OAuth callback
- Modify: `/tmp/Harvest-agent/src/components/AdminSettings.tsx` — add "Connect Stripe" section
- Modify: `/tmp/Harvest-agent/src/types/tenant.types.ts` — add `stripeConnectAccountId?: string` to Tenant

**Steps:**

1. Add `stripeConnectAccountId?: string` and `stripeConnectStatus?: 'pending' | 'active' | 'restricted'` to Tenant type
2. Create `/api/stripe/connect` route:
   - POST: Creates a Stripe Connect Express account link for the tenant
   - Returns the onboarding URL
3. Create `/api/stripe/connect/callback` route:
   - Handles the redirect back from Stripe Connect onboarding
   - Saves `stripeConnectAccountId` and status to tenant doc
4. In AdminSettings, add a "Payment Settings" section:
   - If not connected: "Connect Stripe Account" button → calls `/api/stripe/connect` → redirects to Stripe
   - If connected: Show status (Active/Pending/Restricted) + "Manage Stripe" button
   - Only visible to Plus/Pro/Ultra/Enterprise (all plans)

**Verification:** Admin clicks "Connect Stripe" → redirected to Stripe Connect onboarding → returns to app → status shows "Active".

---

## Task 6: Revenue Split — Plus 80/20, Pro 90/10

**Objective:** When a user donates through "Partner with Us" to a church, the revenue is split: Plus keeps 20% for Harvest (80% to church), Pro keeps 10% (90% to church), Ultra/Enterprise keeps 0% (100% to church).

**Files:**
- Modify: `/tmp/Harvest-agent/src/components/PartnerWithUsTab.tsx` — make functional with real Stripe payments
- Create: `/tmp/Harvest-agent/src/app/api/stripe/donate/route.ts` — creates payment with transfer to connected account
- Modify: `/tmp/Harvest-agent/src/utils/plan-features.ts` — add `platformFeePercent: number` (20, 10, 0, 0)

**Steps:**

1. Add `platformFeePercent` to PlanFeatures: plus=20, pro=10, ultra=0, enterprise=0
2. Create `/api/stripe/donate` route:
   - Accepts: amount, tenantId, donationType (one-time/recurring)
   - Looks up tenant's `stripeConnectAccountId`
   - Creates a Stripe Checkout session with `payment_intent_data.transfer_data`:
     - `destination`: church's connected account ID
     - `amount`: full amount
     - `application_fee_amount`: platform fee percentage
   - For recurring: use `subscription_data.transfer_data`
3. Update PartnerWithUsTab to:
   - Show church name at top
   - Wire "Donate" button to call `/api/stripe/donate` and redirect to Stripe Checkout
   - Remove hardcoded payment method buttons (Apple Pay, Google Pay, Card) — Stripe Checkout handles this
4. If tenant has no Stripe Connect account, show "This ministry hasn't set up payments yet" message

**Verification:** Set up Stripe Connect on test church → donate $100 as Plus plan → church gets $80, Harvest gets $20.

---

## Task 7: Cancel Partnership (Global — All Users)

**Objective:** Every user globally can cancel their recurring partnership/donation from their Profile page.

**Files:**
- Modify: `/tmp/Harvest-agent/src/components/Profile.tsx` — add "Cancel Partnership" option
- Create: `/tmp/Harvest-agent/src/app/api/stripe/cancel-partnership/route.ts` — cancels Stripe subscription
- Modify: `/tmp/Harvest-agent/src/components/PersonalInformationModal.tsx` — already has "Cancel Partnership" text (line 538), wire it up

**Steps:**

1. Create `/api/stripe/cancel-partnership` route:
   - Accepts: userId or tenantId
   - Looks up user's active Stripe subscription (stored in user doc as `stripeSubscriptionId` or similar)
   - Cancels it via Stripe API
2. In Profile, add a "Manage Partnership" section:
   - If user has active recurring donation: show amount, frequency, "Cancel Partnership" button
   - If no active donation: show "You don't have an active partnership"
3. Wire the existing "Cancel Partnership" text in PersonalInformationModal (line 538) to actually call the cancel API

**Verification:** User with recurring donation → Profile → Cancel Partnership → subscription cancelled in Stripe.

---

## Task 8: Configurable Onboarding Questions (Per Plan, Admin Settings)

**Objective:** Each plan's admin can choose what questions to ask in the onboarding form for new users. Answers are downloadable as a spreadsheet.

**Files:**
- Modify: `/tmp/Harvest-agent/src/types/tenant.types.ts` — add `onboardingQuestions` to TenantConfig
- Modify: `/tmp/Harvest-agent/src/components/Onboarding.tsx` — read custom questions from tenant config
- Modify: `/tmp/Harvest-agent/src/components/AdminSettings.tsx` — add onboarding questions editor
- Modify: `/tmp/Harvest-agent/src/components/AnalyticsAndRoles.tsx` — add "Download Onboarding Data" button (already has CSV export)

**Steps:**

1. Add to TenantConfig:
   ```ts
   onboardingQuestions?: {
     id: string;
     label: string;
     type: 'text' | 'select' | 'radio' | 'textarea';
     options?: string[]; // for select/radio
     required: boolean;
     order: number;
   }[];
   ```
2. In AdminSettings, add "Onboarding Questions" section:
   - List existing questions with drag-to-reorder
   - "Add Question" button → form with label, type, options, required toggle
   - "Remove" button per question
   - Save to tenant config in Firestore
   - Default questions: Name, Country, City, Phone, "Have you accepted Jesus?"
3. In Onboarding.tsx:
   - After loading, fetch tenant's `onboardingQuestions` from config
   - Render each question dynamically based on type
   - Save answers to user doc under `onboardingAnswers: { [questionId]: answer }`
4. In AnalyticsAndRoles, add "Download Onboarding Data" button:
   - Fetches all users for tenant
   - Exerts standard fields + all custom onboarding answers as columns
   - Downloads as CSV

**Verification:** Admin adds custom question → new user sees it during onboarding → answer saved → admin downloads spreadsheet with that column.

---

## Task 9: Enterprise Per-Church Billing ($15/church/mo)

**Objective:** Enterprise plan charges $15/month per additional church. When admin adds a new church, they see the cost notice and the Stripe subscription is auto-updated.

**Files:**
- Modify: `/tmp/Harvest-agent/src/components/AdminChurches.tsx` — show cost notice when adding church
- Create: `/tmp/Harvest-agent/src/app/api/stripe/update-quantity/route.ts` — updates Stripe subscription quantity
- Modify: `/tmp/Harvest-agent/src/utils/plan-features.ts` — add `perChurchCost: number` for enterprise (1500 cents)
- Modify: `/tmp/Harvest-agent/src/app/api/stripe/webhook/route.ts` — handle subscription quantity changes

**Steps:**

1. Add `perChurchCost` to PlanFeatures: enterprise=1500 (cents), others=0
2. Create `/api/stripe/update-quantity` route:
   - Accepts: tenantId, action ('add' | 'remove')
   - Gets tenant's current church count from Firestore
   - Updates Stripe subscription item quantity to match church count
3. In AdminChurches, when adding a new church:
   - If tenant plan is enterprise: show "This will add $15/mo to your bill. Your new total: $X/mo for Y churches."
   - After church is saved, call `/api/stripe/update-quantity` to sync Stripe
   - On delete: also update quantity
4. In webhook handler, handle `customer.subscription.updated` for quantity changes

**Verification:** Enterprise admin adds 3rd church → sees "$45/mo for 3 churches" → Stripe subscription shows quantity 3.

---

## Task 10: Deploy & Verify All Changes

**Objective:** Commit, push, deploy all changes. Verify all features work end-to-end.

**Steps:**
1. `cd /tmp/Harvest-agent && git add -A && git commit -m "feat: multi-feature expansion" && git push`
2. `cd /tmp/harvest-site && git add -A && git commit -m "remove: donate section" && git push`
3. Deploy both to Vercel
4. Verify:
   - Presentation site has no donate section
   - Subdomain shows "Welcome to [Church Name]"
   - Custom background works for Ultra
   - Stripe Connect flow works
   - Revenue split works
   - Cancel partnership works
   - Onboarding questions are configurable
   - Enterprise church billing updates Stripe

---

## Risks & Tradeoffs

1. **Stripe Connect complexity** — Express accounts are the simplest but require the church to complete Stripe onboarding. Consider onboarding UX carefully.
2. **Revenue split on test mode** — Stripe Connect test mode is limited. May need to test with real accounts later.
3. **Onboarding question migration** — Existing users won't have custom question answers. The spreadsheet export should handle missing values gracefully.
4. **Enterprise church billing** — Using subscription quantity updates. If church is deleted mid-cycle, proration needs handling.
5. **Background image storage** — Using Firebase Storage or existing image upload. Need to ensure CORS and CDN delivery.
