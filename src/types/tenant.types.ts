export type TenantPlan = 'plus' | 'pro' | 'ultra' | 'enterprise';
export type TenantStatus = 'active' | 'suspended' | 'pending';

export interface TenantConfig {
  logo?: string;        // URL to logo image
  primaryColor?: string; // hex color, e.g. "#D4AF37"
  description?: string;
  customDomain?: string; // e.g. "yourchurch.com" (Ultra/Enterprise only)
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
