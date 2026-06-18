"use client";
import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Plus,
  Mail,
  Loader2,
  AlertCircle,
  Send,
  Calendar,
  Clock,
  Eye,
  MousePointerClick,
  X,
  FileText,
} from 'lucide-react';
import { authFetch } from '../utils/auth-fetch';

interface Campaign {
  id: string;
  subject: string;
  status: string;
  send_time: string | null;
  open_rate: number | null;
  click_rate: number | null;
  emails_sent?: number;
  list_name?: string;
  created_at?: string;
  newsletterId?: string;
  mailchimpCampaignId?: string;
  posts_used?: number;
  is_local?: boolean;
}

interface NewsletterCampaignsProps {
  tenantId: string;
  onBack: () => void;
  onCreateNew: () => void;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Draft' },
  sent: { bg: 'bg-green-50', text: 'text-green-700', label: 'Sent' },
  scheduled: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Scheduled' },
  sending: { bg: 'bg-yellow-50', text: 'text-yellow-700', label: 'Sending' },
  save: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Saved' },
};

const NewsletterCampaigns: React.FC<NewsletterCampaignsProps> = ({
  tenantId,
  onBack,
  onCreateNew,
}) => {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(
    null
  );

  useEffect(() => {
    fetchCampaigns();
  }, []);

  const fetchCampaigns = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await authFetch('/api/newsletter/campaigns');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch campaigns');
      }

      // Merge Mailchimp campaigns with local newsletters
      const mailchimpCampaigns: Campaign[] = (data.campaigns || []).map(
        (c: any) => ({
          ...c,
          is_local: false,
        })
      );

      const localCampaigns: Campaign[] = (data.localNewsletters || []).map(
        (c: any) => ({
          ...c,
          is_local: true,
        })
      );

      // Merge: prefer Mailchimp data when we have a matching ID
      // Deduplicate: skip local newsletters whose mailchimpCampaignId matches a Mailchimp campaign
      const mailchimpIds = new Set(mailchimpCampaigns.map((c) => c.id));
      const merged = [
        ...mailchimpCampaigns,
        ...localCampaigns.filter(
          (lc) => !mailchimpIds.has(lc.id) && !(lc.mailchimpCampaignId && mailchimpIds.has(lc.mailchimpCampaignId))
        ),
      ];

      // Sort by date (most recent first)
      merged.sort((a, b) => {
        const dateA = a.send_time || a.created_at || '';
        const dateB = b.send_time || b.created_at || '';
        return dateB.localeCompare(dateA);
      });

      setCampaigns(merged);
    } catch (err: any) {
      setError(err.message || 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const formatRate = (rate: number | null) => {
    if (rate === null || rate === undefined) return '—';
    return `${(rate * 100).toFixed(1)}%`;
  };

  const getStatusStyle = (status: string) => {
    return STATUS_STYLES[status] || STATUS_STYLES.draft;
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="border-b border-gray-100 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="flex items-center gap-2 text-gray-500 hover:text-[#0b1121] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm font-medium">Back</span>
            </button>
            <div className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-[#C9963A]" />
              <h1 className="text-lg font-semibold text-[#0b1121]">
                Newsletters
              </h1>
            </div>
          </div>
          <button
            onClick={onCreateNew}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#C9963A] text-white rounded-lg text-sm font-medium hover:bg-[#b8862f] transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Create New Newsletter
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Error */}
        {error && (
          <div className="mb-6 flex items-start gap-3 rounded-lg bg-red-50 border border-red-200 p-4">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-red-700">{error}</p>
            </div>
            <button
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center py-16">
            <Loader2 className="w-8 h-8 text-[#C9963A] animate-spin mx-auto mb-4" />
            <p className="text-gray-500 text-sm">Loading campaigns...</p>
          </div>
        )}

        {/* Empty State */}
        {!loading && campaigns.length === 0 && (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-6">
              <FileText className="w-8 h-8 text-gray-400" />
            </div>
            <h2 className="text-xl font-bold text-[#0b1121] mb-2">
              No campaigns yet
            </h2>
            <p className="text-gray-500 mb-6 max-w-sm mx-auto">
              Create your first newsletter from your Instagram posts and send it
              to your audience.
            </p>
            <button
              onClick={onCreateNew}
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#C9963A] text-white rounded-lg font-medium hover:bg-[#b8862f] transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Create Your First Newsletter
            </button>
          </div>
        )}

        {/* Campaign Grid */}
        {!loading && campaigns.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {campaigns.map((campaign) => {
              const statusStyle = getStatusStyle(campaign.status);
              return (
                <button
                  key={campaign.id + (campaign.newsletterId || '')}
                  onClick={() => setSelectedCampaign(campaign)}
                  className="text-left p-5 border border-gray-200 rounded-xl hover:border-[#C9963A]/30 hover:shadow-md transition-all group"
                >
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="text-sm font-semibold text-[#0b1121] line-clamp-2 group-hover:text-[#C9963A] transition-colors">
                      {campaign.subject}
                    </h3>
                    <span
                      className={`ml-2 flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}
                    >
                      {statusStyle.label}
                    </span>
                  </div>

                  <div className="space-y-2 text-xs text-gray-500">
                    {campaign.send_time && (
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{formatDate(campaign.send_time)}</span>
                      </div>
                    )}

                    {campaign.emails_sent ? (
                      <div className="flex items-center gap-1.5">
                        <Send className="w-3.5 h-3.5" />
                        <span>
                          {campaign.emails_sent.toLocaleString()} emails sent
                        </span>
                      </div>
                    ) : null}

                    {(campaign.open_rate !== null ||
                      campaign.click_rate !== null) && (
                      <div className="flex items-center gap-4 pt-2 border-t border-gray-100">
                        {campaign.open_rate !== null && (
                          <div className="flex items-center gap-1">
                            <Eye className="w-3.5 h-3.5 text-green-500" />
                            <span className="font-medium text-[#0b1121]">
                              {formatRate(campaign.open_rate)}
                            </span>
                          </div>
                        )}
                        {campaign.click_rate !== null && (
                          <div className="flex items-center gap-1">
                            <MousePointerClick className="w-3.5 h-3.5 text-blue-500" />
                            <span className="font-medium text-[#0b1121]">
                              {formatRate(campaign.click_rate)}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Campaign Detail Modal */}
      {selectedCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#0b1121]">
                Campaign Details
              </h2>
              <button
                onClick={() => setSelectedCampaign(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Subject
                </label>
                <p className="mt-1 text-[#0b1121] font-medium">
                  {selectedCampaign.subject}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Status
                  </label>
                  <div className="mt-1">
                    {(() => {
                      const s = getStatusStyle(selectedCampaign.status);
                      return (
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}
                        >
                          {s.label}
                        </span>
                      );
                    })()}
                  </div>
                </div>

                {selectedCampaign.send_time && (
                  <div>
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                      Sent
                    </label>
                    <p className="mt-1 text-sm text-[#0b1121]">
                      {formatDate(selectedCampaign.send_time)}
                    </p>
                  </div>
                )}
              </div>

              {selectedCampaign.emails_sent ? (
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Emails Sent
                  </label>
                  <p className="mt-1 text-sm text-[#0b1121]">
                    {selectedCampaign.emails_sent.toLocaleString()}
                  </p>
                </div>
              ) : null}

              {selectedCampaign.list_name && (
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Audience
                  </label>
                  <p className="mt-1 text-sm text-[#0b1121]">
                    {selectedCampaign.list_name}
                  </p>
                </div>
              )}

              {(selectedCampaign.open_rate !== null ||
                selectedCampaign.click_rate !== null) && (
                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-100">
                  {selectedCampaign.open_rate !== null && (
                    <div className="text-center p-3 bg-green-50 rounded-lg">
                      <Eye className="w-5 h-5 text-green-500 mx-auto mb-1" />
                      <p className="text-lg font-bold text-[#0b1121]">
                        {formatRate(selectedCampaign.open_rate)}
                      </p>
                      <p className="text-xs text-gray-500">Open Rate</p>
                    </div>
                  )}
                  {selectedCampaign.click_rate !== null && (
                    <div className="text-center p-3 bg-blue-50 rounded-lg">
                      <MousePointerClick className="w-5 h-5 text-blue-500 mx-auto mb-1" />
                      <p className="text-lg font-bold text-[#0b1121]">
                        {formatRate(selectedCampaign.click_rate)}
                      </p>
                      <p className="text-xs text-gray-500">Click Rate</p>
                    </div>
                  )}
                </div>
              )}

              {selectedCampaign.posts_used && (
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Posts Used
                  </label>
                  <p className="mt-1 text-sm text-[#0b1121]">
                    {selectedCampaign.posts_used} Instagram posts
                  </p>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 bg-white border-t border-gray-100 px-6 py-4">
              <button
                onClick={() => setSelectedCampaign(null)}
                className="w-full px-4 py-2 bg-gray-100 text-[#0b1121] rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NewsletterCampaigns;
