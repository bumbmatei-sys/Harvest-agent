"use client";
import React from 'react';
import { ArrowLeft, Plus, Mail, Clock, CheckCircle, Users } from 'lucide-react';

interface NewsletterCampaignsProps {
  tenantId: string;
  onBack: () => void;
  onCreateNew: () => void;
}

const NewsletterCampaigns: React.FC<NewsletterCampaignsProps> = ({ tenantId, onBack, onCreateNew }) => {
  // Placeholder — no campaigns yet
  const campaigns: { id: string; subject: string; status: string; sentAt: string; openRate: number }[] = [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ArrowLeft size={20} />
          <span className="text-sm font-medium">Back</span>
        </button>
        <h2 className="text-2xl font-bold text-gray-900">Newsletters</h2>
        <button
          onClick={onCreateNew}
          className="ml-auto flex items-center gap-2 px-5 py-2 bg-[#d4a017] text-white rounded-xl text-sm font-semibold hover:bg-[#b8941a] transition-colors"
        >
          <Plus size={16} />
          New Newsletter
        </button>
      </div>

      {campaigns.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-[#fefce8] flex items-center justify-center mb-4">
            <Mail size={28} style={{ color: 'var(--brand-color, #d4a017)' }} />
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-2">No newsletters yet</h3>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
            Create and send newsletters to keep your community engaged. Schedule campaigns, track open rates, and grow your audience.
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
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <Mail size={20} className="text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">{campaign.subject}</p>
                <div className="flex items-center gap-3 mt-1">
                  {campaign.status === 'sent' ? (
                    <span className="flex items-center gap-1 text-xs text-green-600">
                      <CheckCircle size={12} /> Sent
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-yellow-600">
                      <Clock size={12} /> Draft
                    </span>
                  )}
                  <span className="text-xs text-gray-400">{campaign.sentAt}</span>
                  <span className="flex items-center gap-1 text-xs text-gray-500">
                    <Users size={12} /> {campaign.openRate}% opened
                  </span>
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
