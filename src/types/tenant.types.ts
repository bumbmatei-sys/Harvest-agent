export type TenantPlan = 'plus' | 'pro' | 'max';
export type TenantStatus = 'active' | 'suspended' | 'pending';

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
  // Add-on subscription IDs
  addOnAiAssistant?: string; // Stripe subscription ID for AI Assistant add-on
  // Stripe Connect status (the account ID itself is on tenant_private)
  stripeConnectStatus?: 'pending' | 'active' | 'restricted';
}
