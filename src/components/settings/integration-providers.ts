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
 * THE-225 adds the second half of the same idea. Gmail reached the FREE tier
 * through `crm: true` — free has the CRM, deliberately — so a feature-cell gate
 * alone could not withhold it, and the only cell that would have is the roster
 * free exists to provide. A provider now also declares whether connecting it
 * hands the tenant a live outbound SEND (`outboundSend`), and a send is refused
 * to a tier that is not sold. Free is refused the mailbox, not the CRM. No plan
 * flag moved for either half.
 *
 * `platformOverride` is deliberately NOT folded in here. It is a viewer-context
 * concern (a super admin on the platform domain sees everything), not a
 * property of the provider, and every call site keeps the existing
 * `platformOverride || …` / `!platformOverride && !…` shape so the override
 * stays visible where the gating is read.
 */
import { isUnpricedTier, type PlanFeatures } from '../../utils/plan-features';

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
  /**
   * THE-225 — does connecting this provider hand the tenant a LIVE OUTBOUND
   * SEND, dispatched from Harvest through the tenant's own third-party account?
   *
   * 🔴 THIS IS THE SECOND HALF OF THE GATE, AND IT IS NOT A PLAN FLAG. It exists
   * because free reaches Gmail through `crm: true` — deliberately true, because
   * the whole of the free tier is one discipleship course and a roster of who
   * enrolled — so the feature cell above cannot be what withholds it, and
   * flipping `crm` would take the roster away with the mailbox. Free is
   * therefore refused the SEND, not the CRM.
   *
   * The tier test is `isUnpricedTier`: a tier this build knows and that has no
   * price. That is the same reasoning the plan matrix already writes down on
   * free's `smsAutomation: false` and `textToGive: false` — "leaving them true
   * would put a working send surface on a tier that pays nothing and holds no
   * card" — applied to the one send surface that reached free anyway through a
   * cell it shares with the paid tiers. It is derived from `PLAN_PRICING`, not
   * a list of tier names, so a second tier that stops being sold lands here on
   * its own; and an UNRECOGNISED plan is a legacy record, not free, so it keeps
   * whatever it has today.
   *
   * Instagram and Mailchimp carry it too, honestly rather than decoratively:
   * Mailchimp sends campaigns and Instagram is read for them. Both already sit
   * behind `newsletterAutomation`, which free does not hold, so declaring it
   * moves nothing on any tier — it just means the next provider added has to
   * answer the question rather than inherit an answer.
   */
  outboundSend: boolean;
}

export const INTEGRATION_PROVIDERS: readonly IntegrationProvider[] = [
  { id: 'instagram', label: 'Instagram', concern: 'newsletter', feature: 'newsletterAutomation', outboundSend: true },
  { id: 'mailchimp', label: 'Mailchimp', concern: 'newsletter', feature: 'newsletterAutomation', outboundSend: true },
  // Gmail is a CRM capability: it is how "Email" on a CRM contact sends. It has
  // never been a newsletter feature, and `newsletterAutomation` never gated the
  // routes behind it.
  { id: 'gmail', label: 'Gmail', concern: 'crm', feature: 'crm', outboundSend: true },
];

export function getIntegrationProvider(id: IntegrationProviderId): IntegrationProvider {
  const provider = INTEGRATION_PROVIDERS.find(p => p.id === id);
  if (!provider) throw new Error(`Unknown integration provider: ${id}`);
  return provider;
}

/**
 * Does this tenant's plan entitle it to one provider? Plan only — the caller
 * applies `platformOverride`.
 *
 * Two questions, both of them about the TIER: the feature cell the provider
 * serves, and — for a provider that sends — whether the tier is one that is
 * sold. `plan` is REQUIRED rather than optional on purpose: an optional
 * argument is a gate a call site can forget, which is the exact shape THE-213
 * found on four surfaces.
 */
export function isProviderAvailable(
  provider: IntegrationProvider,
  features: PlanFeatures | null | undefined,
  plan: string | null | undefined,
): boolean {
  if (!features?.[provider.feature]) return false;
  // See `outboundSend` above. An unpriced tier is refused the send; every other
  // tier — including one this build does not recognise — is unaffected.
  if (provider.outboundSend && isUnpricedTier(plan)) return false;
  return true;
}

/** The providers a tenant's plan entitles it to, in card order. */
export function availableIntegrationProviders(
  features: PlanFeatures | null | undefined,
  plan: string | null | undefined,
): IntegrationProvider[] {
  return INTEGRATION_PROVIDERS.filter(p => isProviderAvailable(p, features, plan));
}

/**
 * Is the Integrations section worth showing at all? True when ANY provider
 * inside it is available — derived by walking `INTEGRATION_PROVIDERS`, never by
 * naming flags, so the next provider added is picked up here for free.
 */
export function hasAnyIntegrationProvider(
  features: PlanFeatures | null | undefined,
  plan: string | null | undefined,
): boolean {
  return INTEGRATION_PROVIDERS.some(p => isProviderAvailable(p, features, plan));
}
