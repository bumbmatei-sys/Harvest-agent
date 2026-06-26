"use client";
import React, { useEffect } from 'react';
import { ArrowLeft, Plus, Mail, Clock, CheckCircle, Users } from 'lucide-react';
import { useAdminHeader, HeaderActionButton } from './AdminScreenHeader';

interface NewsletterCampaignsProps {
  tenantId: string;
  onBack: () => void;
  onCreateNew: () => void;
}

const NewsletterCampaigns: React.FC<NewsletterCampaignsProps> = ({ tenantId, onBack, onCreateNew }) => {
  const { setHeaderAction } = useAdminHeader();

  useEffect(() => {
    setHeaderAction(<HeaderActionButton label="New Newsletter" onClick={onCreateNew} />);
    return () => setHeaderAction(null);
  }, [setHeaderAction]);

  // Placeholder — no campaigns yet
  const campaigns: { id: string; subject: string; status: string; sentAt: string; openRate: number }[] = [];

  return (
    <div className="space-y-6">
      {campaigns.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-[#fefce8] flex items-center justify-center mb-4">
            <Mail size={28} style={{ color: 'var(--brand-color, #d4a017)' }} />
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-2">No newsletters yet</h3>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
            Create and send newsletters to keep your community engaged. Connect Instagram to auto-generate content from your posts.
          </p>
          <button
            onClick={onCreateNew}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#d4a017] text-white rounded-xl text-sm font-semibold hover:bg-[#b8941a] transition-colors"
          >
            <Plus size={16} />
            Create Your First Newsletter
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map((campaign) => (
            <div key={campaign.id} className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                campaign.status === 'sent' ? 'bg-green-50' :
                campaign.status === 'scheduled' ? 'bg-blue-50' : 'bg-gray-50'
              }`}>
                <Mail size={20} className={
                  campaign.status === 'sent' ? 'text-green-600' :
                  campaign.status === 'scheduled' ? 'text-blue-600' : 'text-gray-400'
                } />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">{campaign.subject || 'Untitled'}</p>
                <div className="flex items-center gap-3 mt-1">
                  {statusBadge(campaign.status)}
                  <span className="text-xs text-gray-400">
                    {campaign.status === 'sent' ? formatDate(campaign.sentAt) : formatDate(campaign.generatedAt)}
                  </span>
                  {campaign.postsUsed != null && campaign.postsUsed > 0 && (
                    <span className="flex items-center gap-1 text-xs text-gray-400">
                      <Users size={12} /> {campaign.postsUsed} posts
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default NewsletterCampaigns;
