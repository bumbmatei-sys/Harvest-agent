"use client";
import React from 'react';
import { EmailWorkspace } from './email/EmailWorkspace';

interface NewsletterCampaignsProps {
  tenantId: string;
  onBack: () => void;
  onCreateNew: () => void;
}

/**
 * The newsletter tab's screen. It used to list Mailchimp campaigns; it now
 * mounts the Plunk-backed email workspace (overview, broadcasts, subscribers,
 * settings). The dashboard still imports this name, so its tab wiring, plan
 * gate and hidden-feature switch are untouched. `onBack` and `onCreateNew` are
 * kept so that call site is byte-identical; the workspace navigates itself.
 */
const NewsletterCampaigns: React.FC<NewsletterCampaignsProps> = ({ tenantId }) => (
  <EmailWorkspace tenantId={tenantId} />
);

export default NewsletterCampaigns;
