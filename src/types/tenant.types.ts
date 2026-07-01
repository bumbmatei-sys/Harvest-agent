export type TenantPlan = 'plus' | 'pro' | 'max' | 'ultra';
export type TenantStatus = 'active' | 'suspended' | 'pending';

export interface TenantConfig {
  logo?: string;        // URL to logo image
  primaryColor?: string; // hex color, e.g. "#D4AF37"
  description?: string;
  customDomain?: string; // e.g. "yourchurch.com" (Ultra only)
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

export interface Tenant {
  id: string;           // Firestore doc ID
  name: string;         // Church/ministry name
  subdomain: string;    // e.g. "gracechurch" → gracechurch.theharvest.app
  plan: TenantPlan;
  status: TenantStatus;
  config: TenantConfig;
  adminEmails: string[]; // emails of church admins for this tenant
  /**
   * The plan owner (buyer) uid. Set by the Stripe webhook at tenant creation
   * (ownerId = paying user's uid) and immutable — the correct gate for owner-only
   * surfaces like Billing & Payments.
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
  // Stripe billing fields
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  // Add-on subscription IDs
  addOnAiAssistant?: string; // Stripe subscription ID for AI Assistant add-on
  // Stripe Connect fields
  stripeConnectAccountId?: string;
  stripeConnectStatus?: 'pending' | 'active' | 'restricted';
}
