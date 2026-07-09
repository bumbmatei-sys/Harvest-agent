"use client";
import React, { useState, useEffect } from 'react';
import { Plus, Mail, Users, Loader2, AlertCircle } from 'lucide-react';
import { authFetch } from '../utils/auth-fetch';
import { AdminPageHeader, AdminPrimaryButton, AdminBadge, statusTone } from './admin/AdminUI';

interface NewsletterCampaignsProps {
  tenantId: string;
  onBack: () => void;
  onCreateNew: () => void;
}

interface LocalNewsletter {
  id: string;
  newsletterId: string;
  subject: string;
  status: string;
  send_time: string | null;
  created_at: string | null;
  open_rate: number | null;
  click_rate: number | null;
  posts_used: number;
  is_local: boolean;
}

interface MailchimpCampaign {
  id: string;
  subject: string;
  status: string;
  send_time: string | null;
  open_rate: number | null;
  click_rate: number | null;
  emails_sent: number;
  list_name: string;
  created_at: string | null;
}

function statusBadge(status: string) {
  return <AdminBadge tone={statusTone(status)}>{status || 'draft'}</AdminBadge>;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '—';
  }
}

const NewsletterCampaigns: React.FC<NewsletterCampaignsProps> = ({ tenantId, onCreateNew }) => {
  const [localNewsletters, setLocalNewsletters] = useState<LocalNewsletter[]>([]);
  const [mailchimpCampaigns, setMailchimpCampaigns] = useState<MailchimpCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const resp = await authFetch('/api/newsletter/campaigns');
        if (!resp.ok) throw new Error('Failed to load campaigns');
        const data = await resp.json();
        setLocalNewsletters(data.localNewsletters || []);
        setMailchimpCampaigns(data.campaigns || []);
      } catch (e: any) {
        setError(e.message || 'Failed to load newsletters');
      }
      setLoading(false);
    };
    load();
  }, [tenantId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-gold" />
      </div>
    );
  }

  if (error) {
    // The campaigns feed (Mailchimp / admin SDK) can be unavailable without
    // blocking the page — keep the header + New newsletter action, and surface
    // the issue as a soft, non-blocking notice rather than a full-page failure.
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <AdminPageHeader
          eyebrow="Newsletters"
          title="Keep your community engaged"
          action={<AdminPrimaryButton onClick={onCreateNew} icon={<Plus size={16} />}>New newsletter</AdminPrimaryButton>}
        />
        <div className="bg-[color-mix(in_srgb,var(--brand-color)_7%,white)] border border-[color-mix(in_srgb,var(--brand-color)_22%,transparent)] rounded-brand-lg p-5 flex items-start gap-3">
          <AlertCircle size={18} className="text-gold shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-earth">Couldn&apos;t load your campaign history right now</p>
            <p className="text-xs text-warm-brown mt-0.5">Your newsletters are safe — the campaign feed just isn&apos;t reachable at the moment. You can still create and send a newsletter.</p>
          </div>
        </div>
      </div>
    );
  }

  const hasAny = localNewsletters.length > 0 || mailchimpCampaigns.length > 0;

  if (!hasAny) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <AdminPageHeader
          eyebrow="Newsletters"
          title="Keep your community engaged"
          action={<AdminPrimaryButton onClick={onCreateNew} icon={<Plus size={16} />}>New newsletter</AdminPrimaryButton>}
        />
        <div className="bg-white rounded-brand-lg border border-stone-200 shadow-[var(--ds-sh-sm)] p-12 text-center">
          <div className="w-16 h-16 mx-auto rounded-brand-lg bg-[color-mix(in_srgb,var(--brand-color)_10%,transparent)] flex items-center justify-center mb-4">
            <Mail size={28} className="text-gold" />
          </div>
          <h3 className="font-display text-lg font-semibold text-earth mb-2">No newsletters yet</h3>
          <p className="text-sm text-warm-brown mb-6 max-w-md mx-auto">
            Create and send newsletters to keep your community engaged.
          </p>
          <AdminPrimaryButton onClick={onCreateNew} icon={<Plus size={16} />}>Create your first newsletter</AdminPrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6" style={{ paddingBottom: 120 }}>
      <AdminPageHeader
        eyebrow="Newsletters"
        title="Keep your community engaged"
        action={<AdminPrimaryButton onClick={onCreateNew} icon={<Plus size={16} />}>New newsletter</AdminPrimaryButton>}
      />
      {localNewsletters.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold text-gold uppercase tracking-[0.14em] mb-3">Drafts &amp; Sends</h3>
          <div className="space-y-3">
            {localNewsletters.map((nl) => (
              <div key={nl.newsletterId} className="bg-white rounded-brand-lg border border-stone-200 shadow-[var(--ds-sh-sm)] p-5 flex items-center gap-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  nl.status === 'sent' ? 'bg-green-50' :
                  nl.status === 'scheduled' ? 'bg-blue-50' : 'bg-stone-100'
                }`}>
                  <Mail size={18} className={
                    nl.status === 'sent' ? 'text-green-600' :
                    nl.status === 'scheduled' ? 'text-blue-600' : 'text-[color:var(--text-faint)]'
                  } />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-earth truncate">{nl.subject || 'Untitled'}</p>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {statusBadge(nl.status)}
                    <span className="text-xs text-[color:var(--text-faint)]">
                      {nl.status === 'sent' ? formatDate(nl.send_time) : formatDate(nl.created_at)}
                    </span>
                    {nl.posts_used > 0 && (
                      <span className="flex items-center gap-1 text-xs text-[color:var(--text-faint)]">
                        <Users size={12} /> {nl.posts_used} posts
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {mailchimpCampaigns.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold text-gold uppercase tracking-[0.14em] mb-3">Mailchimp Campaigns</h3>
          <div className="space-y-3">
            {mailchimpCampaigns.map((c) => (
              <div key={c.id} className="bg-white rounded-brand-lg border border-stone-200 shadow-[var(--ds-sh-sm)] p-5 flex items-center gap-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  c.status === 'sent' ? 'bg-green-50' : 'bg-stone-100'
                }`}>
                  <Mail size={18} className={c.status === 'sent' ? 'text-green-600' : 'text-[color:var(--text-faint)]'} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-earth truncate">{c.subject}</p>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {statusBadge(c.status)}
                    <span className="text-xs text-[color:var(--text-faint)]">{formatDate(c.send_time || c.created_at)}</span>
                    {c.open_rate != null && (
                      <span className="text-xs text-[color:var(--text-faint)]">{Math.round(c.open_rate * 100)}% opens</span>
                    )}
                    {c.emails_sent > 0 && (
                      <span className="flex items-center gap-1 text-xs text-[color:var(--text-faint)]">
                        <Users size={12} /> {c.emails_sent}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default NewsletterCampaigns;
