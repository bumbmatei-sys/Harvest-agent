/**
 * THE-193 — which plan feature guards which integration row.
 *
 * The Integrations section holds one card per third-party provider, and the
 * providers do NOT all serve the same product concern. Instagram and Mailchimp
 * exist to build and send newsletters; Gmail exists so an admin can email a CRM
 * contact from their own account (`/api/crm/send-email`). Gating the whole
 * section on `newsletterAutomation` therefore hid Gmail from Individual — a
 * tier that HAS the CRM (`crm: true`) and whose CRM renders a "Connect your
 * email" button pointing straight at this screen. The button routed to a
 * Settings page with no Integrations section on it, and the workflow ended.
 *
 * So each provider declares the feature cell it actually serves, and the
 * section's visibility is DERIVED from that list rather than restated as a
 * hardcoded set of flags. Adding a provider here is the only edit a new
 * integration needs: the section starts showing for the tiers that own it,
 * with no gate logic to remember to update.
 *
 * `platformOverride` is deliberately NOT folded in here. It is a viewer-context
 * concern (a super admin on the platform domain sees everything), not a
 * property of the provider, and every call site keeps the existing
 * `platformOverride || …` / `!platformOverride && !…` shape so the override
 * stays visible where the gating is read.
 */
import type { PlanFeatures } from '../../utils/plan-features';

/** The `PlanFeatures` cells that are plain on/off entitlements — the only ones
 *  a provider can be gated on. Keeps a numeric cell (`maxCourses`) out. */
export type BooleanFeatureKey = {
  [K in keyof PlanFeatures]: PlanFeatures[K] extends boolean ? K : never;
}[keyof PlanFeatures];

export type IntegrationProviderId = 'instagram' | 'mailchimp' | 'gmail';

export interface IntegrationProvider {
  id: IntegrationProviderId;
  /** The card's visible heading, so callers can name a row by its label. */
  label: string;
  /** The product concern the provider serves, in one word, for the copy. */
  concern: 'newsletter' | 'crm';
  /** The plan feature that actually entitles a tenant to this provider. */
  feature: BooleanFeatureKey;
}

export const INTEGRATION_PROVIDERS: readonly IntegrationProvider[] = [
  { id: 'instagram', label: 'Instagram', concern: 'newsletter', feature: 'newsletterAutomation' },
  { id: 'mailchimp', label: 'Mailchimp', concern: 'newsletter', feature: 'newsletterAutomation' },
  // Gmail is a CRM capability: it is how "Email" on a CRM contact sends. It has
  // never been a newsletter feature, and `newsletterAutomation` never gated the
  // routes behind it.
  { id: 'gmail', label: 'Gmail', concern: 'crm', feature: 'crm' },
];

export function getIntegrationProvider(id: IntegrationProviderId): IntegrationProvider {
  const provider = INTEGRATION_PROVIDERS.find(p => p.id === id);
  if (!provider) throw new Error(`Unknown integration provider: ${id}`);
  return provider;
}

/** Does this tenant's plan entitle it to one provider? Plan only — the caller
 *  applies `platformOverride`. */
export function isProviderAvailable(
  provider: IntegrationProvider,
  features: PlanFeatures | null | undefined,
): boolean {
  return !!features?.[provider.feature];
}

/** The providers a tenant's plan entitles it to, in card order. */
export function availableIntegrationProviders(
  features: PlanFeatures | null | undefined,
): IntegrationProvider[] {
  return INTEGRATION_PROVIDERS.filter(p => isProviderAvailable(p, features));
}

/**
 * Is the Integrations section worth showing at all? True when ANY provider
 * inside it is available — derived by walking `INTEGRATION_PROVIDERS`, never by
 * naming flags, so the next provider added is picked up here for free.
 */
export function hasAnyIntegrationProvider(
  features: PlanFeatures | null | undefined,
): boolean {
  return INTEGRATION_PROVIDERS.some(p => isProviderAvailable(p, features));
}
