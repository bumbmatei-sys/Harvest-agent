"use client";
import React, { useState, useEffect } from 'react';
import { ArrowLeft, Plus, Mail, Clock, CheckCircle, Users, Loader2, Calendar } from 'lucide-react';

interface Campaign {
  id: string;
  subject: string;
  status: 'draft' | 'sent' | 'scheduled';
  generatedAt: string;
  sentAt?: string;
  postsUsed?: number;
}

interface NewsletterCampaignsProps {
  tenantId: string;
  onBack: () => void;
  onCreateNew: () => void;
}

const NewsletterCampaigns: React.FC<NewsletterCampaignsProps> = ({ tenantId, onBack, onCreateNew }) => {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) { setLoading(false); return; }
    let cancelled = false;
    const fetchCampaigns = async () => {
      try {
        const { collection, query, orderBy, limit, getDocs } = await import('firebase/firestore');
        const { db } = await import('../firebase');
        const q = query(
          collection(db, 'tenants', tenantId, 'newsletters'),
          orderBy('generatedAt', 'desc'),
          limit(50)
        );
        const snap = await getDocs(q);
        if (!cancelled) {
          const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Campaign));
          setCampaigns(docs);
        }
      } catch (e) {
        console.error('Failed to load newsletters:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchCampaigns();
    return () => { cancelled = true; };
  }, [tenantId]);

  const formatDate = (iso?: string) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const statusBadge = (status: Campaign['status']) => {
    switch (status) {
      case 'sent':
        return <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle size={12} /> Sent</span>;
      case 'scheduled':
        return <span className="flex items-center gap-1 text-xs text-blue-600"><Calendar size={12} /> Scheduled</span>;
      default:
        return <span className="flex items-center gap-1 text-xs text-gray-500"><Clock size={12} /> Draft</span>;
    }
  };

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

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="animate-spin text-[#d4a017]" />
        </div>
      ) : campaigns.length === 0 ? (
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
