/**
 * The tenant's TIER.
 *
 * 🔴 `free` IS NOT A PRICED TIER, and the type system says so rather than
 * leaving it to a comment. `PricedPlan` below is the subset that has a row in
 * `PLAN_PRICING`, a Dodo product and a billing term; `TenantPlan` is every tier
 * that exists. A `Record<TenantPlan, …>` therefore demands a `free` cell and a
 * `Record<PricedPlan, …>` refuses one — which is exactly the distinction each
 * of those maps needs, and the reason `planPriceUsd('free', …)` is a compile
 * error instead of an `undefined` that renders as `$NaN/mo`.
 *
 * Free is FIRST in `PLAN_ORDER` (plan-features.ts) because that array is
 * cheapest → most expensive and `FEATURE_MIN_PLAN` walks it to name the
 * cheapest tier carrying a feature.
 */
export type TenantPlan = 'free' | 'plus' | 'pro' | 'max';

/**
 * Every tier a church can BUY — `TenantPlan` minus the free one.
 *
 * ⚠️ Written as an `Exclude` rather than a second literal union on purpose: a
 * new tier added to `TenantPlan` lands here automatically, and the only way to
 * make a tier unpriced is to exclude it here deliberately. A hand-maintained
 * copy of the list is how `FEATURE_MIN_PLAN`'s two predecessor maps drifted
 * (see the note on `getFeatureMinPlan`).
 *
 * Anything keyed on money keys on THIS: `PLAN_PRICING`, the Dodo catalogue,
 * `PLATFORM_FEE_MAP`, `PLAN_LIMITS`. Anything keyed on presentation or
 * entitlement keys on `TenantPlan`.
 */
export type PricedPlan = Exclude<TenantPlan, 'free'>;

/**
 * The tenant's LIFECYCLE state — where it sits with billing.
 *
 * ⚠️ Distinct from `TenantPlan`, which is the TIER. The app reads tier
 * entitlement from `plan` (getPlanFeatures / getPlanLimits / usePlanGate) and
 * lifecycle entitlement from this field, through the one predicate in
 * `src/lib/tenant-lifecycle.ts`. Neither is a second answer to the other's
 * question, and nothing else should become a third.
 *
 * The last three were already being WRITTEN and were missing from this union:
 * the Stripe webhook has always set 'past_due' and 'suspended' on a failed
 * payment and 'cancelled' on `customer.subscription.deleted`. Listing them makes
 * the type describe the documents that exist rather than a subset of them.
 *
 * 🔴 'archived' is the new one, and the only one that gates anything: the
 * terminal state a Dodo subscription's `cancelled`/`expired` lands a tenant in.
 * Archived is NOT deleted and NOT disabled — login, admin read and every export
 * keep working; giving, publishing and sending stop.
 */
export type TenantStatus =
  | 'active'
  | 'suspended'
  | 'pending'
  | 'past_due'
  | 'cancelled'
  | 'archived';

/**
 * The add-ons a tenant OWNS, in meanings rather than in Dodo ids (REP-5a).
 *
 * 🔴 NO `adn_` ID EVER APPEARS HERE. `tenants/{id}` is world-readable, and a
 * client that knows a Dodo add-on id breaks the moment that add-on is recreated
 * — the id changes, the meaning does not. The id → meaning map lives once,
 * server-side, in `src/lib/dodo/catalogue.ts`, and the webhook writes only what
 * came out of it.
 *
 * ─── Why this is on the public tenant doc and not tenant_private ─────────────
 *
 * `plan` is already here, and an add-on quantity is the same KIND of fact: it is
 * capacity, which every cap check needs synchronously to render a screen. That
 * is different from `dodoOnHoldAt`, which is billing TROUBLE and stayed private.
 * Putting capacity behind a server fetch would make every cap check async, and
 * an async default is a silent claim — the shape behind THE-64 and THE-139.
 * Nothing here is a secret: the church knows what it bought.
 *
 * ─── The field names are counts, and say so ──────────────────────────────────
 *
 * `adminSeats` and `aiAssistant` are COUNTS. `unlimitedContacts` is a plain
 * boolean and stays one — see `getEffectiveFeatures` for why no number can carry
 * "unlimited" through Firestore safely.
 *
 * 🔴 TWO FIELDS WERE DELETED HERE — THE-370, and deleted rather than left
 * dormant. `contactPacks` (blocks of `CONTACTS_PER_PACK`) and `campuses` (the
 * then-only path past `maxChurches: 1`) named add-ons the founder retired: every
 * paid tier is uncapped on campuses now, and the contact caps were raised
 * instead of sold in blocks. Both products are detached from all nine plan
 * products in Dodo and neither is purchasable.
 *
 * ⚠️ A STALE `campuses: 2` OR `contactPacks: 3` MAY STILL SIT IN A DOCUMENT, and
 * that is safe by construction: `readTenantAddons` reads the fields it names off
 * an untrusted value and never enumerates the document's own keys, so a retired
 * key is not read, cannot throw, and grants nothing. A tenant carrying one
 * resolves exactly as if it did not. No migration was written — see the PR.
 */
export interface TenantAddons {
  /** Extra AI assistants bought, on top of whatever the tier includes. */
  aiAssistant: number;
  /** Extra admin seats bought, on top of the tier's `maxAdmins`. */
  adminSeats: number;
  /** True when the Unlimited Contacts add-on is held. */
  unlimitedContacts: boolean;
}

export interface TenantConfig {
  logo?: string;        // URL to logo image
  /**
   * Square variant of the logo, preferred for the PWA manifest and
   * "Add to Home Screen" slots where a rectangular wordmark crops badly.
   * Read by app/layout.tsx and app/manifest.webmanifest/route.ts, both of
   * which fall back to `logo`.
   */
  squareIcon?: string;
  /**
   * Legacy display name. Current tenants carry the name on the Tenant doc
   * itself (`Tenant.name`); this is the older location and survives only as
   * AdminDashboard's second fallback. Prefer `Tenant.name`.
   */
  name?: string;
  primaryColor?: string; // hex color, e.g. "#D4AF37"
  description?: string;
  customDomain?: string; // e.g. "yourchurch.com" (Ministry / max only)
  customDomainVerified?: boolean; // true once Vercel verifies the custom domain
  customDomainStatus?: 'pending' | 'verified' | 'failed'; // Vercel provisioning status
  backgroundImage?: string; // URL to custom background image for auth page
  onboardingQuestions?: {
    id: string;
    label: string;
    type: 'text' | 'select' | 'radio' | 'textarea';
    options?: string[];
    required: boolean;
    order: number;
  }[];
  /**
   * THE-246 — the church's own payment links. Which providers those are is
   * `GIVING_PROVIDERS`' business, not this type's: THE-254 added Revolut and
   * Wise without touching the shape stored here.
   *
   * Lives on `config` for the same reason `onboardingQuestions` does: it is a
   * tenant SETTING edited by the Settings/Branding write path, and
   * `firestore.rules` already governs `config` as one field on this doc
   * (`manageSettings` or `manageBranding`, super admin unrestricted). No rule
   * changed to add it.
   *
   * 🔴 PUBLIC BY CONSTRUCTION. `tenants/{id}` is `allow read: if true`, which
   * is what lets a signed-out visitor resolve a subdomain. So the URLs, handles
   * and EMAILS here are world-readable the moment they are saved — the admin
   * copy says so before a church types one. Nothing secret may join them.
   *
   * ⚠️ Never rendered straight from this field. `readGivingLinks`
   * (components/donations/giving-providers.ts) re-validates every value on READ
   * and drops what no longer passes, so a document older than the rule that
   * now governs it cannot put an unchecked `href` in front of a member.
   */
  givingLinks?: import('../components/donations/giving-providers').GivingLinkRecord;
}

/**
 * The world-readable tenants/{id} doc (`allow read: if true` — pre-auth
 * subdomain resolution needs name/subdomain/branding before sign-in).
 *
 * The admin roster (adminEmails) and the Stripe identifiers
 * (stripeCustomerId / stripeSubscriptionId / stripePriceId /
 * stripeConnectAccountId) deliberately do NOT exist on this type: they live on
 * the server-only tenant_private/{id} doc (src/lib/tenant-private.ts), which
 * no client can read. Re-adding one of those fields here is how the roster
 * leak happens again — don't.
 */
export interface Tenant {
  id: string;           // Firestore doc ID
  name: string;         // Church/ministry name
  subdomain: string;    // e.g. "gracechurch" → gracechurch.theharvest.app
  plan: TenantPlan;
  status: TenantStatus;
  config: TenantConfig;
  /**
   * The plan owner (buyer) uid. Set by the Stripe webhook at tenant creation
   * (ownerId = paying user's uid) and immutable — the correct gate for owner-only
   * surfaces like Billing & Payments. (A uid, not PII — stays public.)
   */
  ownerId?: string;
  /**
   * Gates the one-time first-run "Finish setup" screen. The Stripe webhook
   * creates new tenants with `setupCompleted: false`; the first-run flow flips it
   * to `true` once the admin claims a subdomain and configures branding. Legacy
   * tenants created before build-on-payment have no field (treated as done).
   */
  setupCompleted?: boolean;
  createdAt: string;     // ISO date string
  updatedAt: string;     // ISO date string
  /**
   * What the tenant owns beyond its tier (REP-5a). Written by the Dodo webhook
   * — `subscription.plan_changed` and, defensively, `subscription.active` — and
   * by nothing else.
   *
   * OPTIONAL because every tenant created before REP-5a has no field. Read it
   * through `readTenantAddons` (src/utils/plan-features.ts), which resolves an
   * absent or malformed value to "owns nothing" rather than throwing: a missing
   * field means the tenant predates add-ons, which is exactly no add-ons.
   */
  addons?: TenantAddons;
  // Add-on subscription IDs
  addOnAiAssistant?: string; // Stripe subscription ID for AI Assistant add-on
  // Stripe Connect status (the account ID itself is on tenant_private)
  stripeConnectStatus?: 'pending' | 'active' | 'restricted';
}
