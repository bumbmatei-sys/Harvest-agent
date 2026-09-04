import React from 'react';
import IntegrationsSection from '../../settings/IntegrationsSection';

/**
 * THE-296 — `IntegrationsSection` measured AS ITSELF.
 *
 * `platformOverride` is the section's own "show every provider" path (it exists
 * for platform super admins), so the first render already draws the Instagram,
 * Mailchimp and Gmail cards with their real Connect buttons and the real Gmail
 * sending-address field. No markup is reconstructed here: what the layout suite
 * measures is the shipped component's own output.
 */
const IntegrationsPanelFixture: React.FC = () => (
  <IntegrationsSection platformOverride currentPlan={undefined} />
);

export default IntegrationsPanelFixture;
