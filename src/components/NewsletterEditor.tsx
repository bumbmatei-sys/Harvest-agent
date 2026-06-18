"use client";
import React, { useState, useEffect } from 'react';
import { ArrowLeft, Send, Eye, Save, Wand2, Instagram, Mail, Loader2, Check, AlertCircle, ChevronDown, Clock } from 'lucide-react';
import { sanitizeHtml } from '../utils/sanitize';
import { authFetch } from '../utils/auth-fetch';

interface NewsletterEditorProps {
  tenantId: string;
  tenantName: string;
  onBack: () => void;
}

interface Newsletter {
  newsletterId: string;
  subject: string;
  htmlContent: string;
  plainText: string;
  postsUsed: number;
}

const NewsletterEditor: React.FC<NewsletterEditorProps> = ({ tenantId, tenantName, onBack }) => {
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [plainText, setPlainText] = useState('');
  const [newsletterId, setNewsletterId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [instagramConnected, setInstagramConnected] = useState(false);
  const [mailchimpConnected, setMailchimpConnected] = useState(false);
  const [loadingConnections, setLoadingConnections] = useState(true);

  // Check connections on mount
  useEffect(() => {
    const checkConnections = async () => {
      try {
        const [igResp, mcResp] = await Promise.all([
          authFetch(`/api/composio/instagram/status?tenantId=${tenantId}`),
          authFetch(`/api/composio/mailchimp/status?tenantId=${tenantId}`),
        ]);
        if (igResp.ok) {
          const igData = await igResp.json();
          setInstagramConnected(igData.status === 'connected');
        }
        if (mcResp.ok) {
          const mcData = await mcResp.json();
          setMailchimpConnected(mcData.status === 'connected');
        }
      } catch (e) {
        console.error('Failed to check connections:', e);
      }
      setLoadingConnections(false);
    };
    checkConnections();
  }, [tenantId]);

  // Generate newsletter from Instagram
  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setSuccess(null);
    try {
      const resp = await authFetch('/api/newsletter/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to generate newsletter');
      }
      const data: Newsletter = await resp.json();
      setSubject(data.subject || '');
      setContent(data.htmlContent || '');
      setPlainText(data.plainText || '');
      setNewsletterId(data.newsletterId);
      setSuccess(`Newsletter generated from ${data.postsUsed} Instagram posts`);
    } catch (e: any) {
      setError(e.message || 'Failed to generate newsletter');
    }
    setGenerating(false);
  };

  // Save draft
  const handleSaveDraft = async () => {
    setSaving(true);
    setError(null);
    try {
      const resp = await authFetch('/api/newsletter/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newsletterId, subject, htmlContent: content, plainText, action: 'save_draft' }),
      });
      if (!resp.ok) throw new Error('Failed to save draft');
      setSuccess('Draft saved');
    } catch (e: any) {
      setError(e.message || 'Failed to save draft');
    }
    setSaving(false);
  };

  // Send newsletter
  const handleSend = async (scheduledDate?: string) => {
    if (!newsletterId) {
      setError('Please generate or save a newsletter first');
      return;
    }
    setSending(true);
    setError(null);
    setSuccess(null);
    try {
      const resp = await authFetch('/api/newsletter/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newsletterId,
          ...(scheduledDate ? { schedule: scheduledDate } : {}),
        }),
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to send newsletter');
      }
      setSuccess(scheduledDate ? 'Newsletter scheduled!' : 'Newsletter sent successfully!');
      if (!scheduledDate) {
        setTimeout(() => onBack(), 2000);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to send newsletter');
    }
    setSending(false);
  };

  const hasContent = subject.trim() && content.trim();

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-gray-500 hover:text-gray-700 transition-colors cursor-pointer"
          >
            <ArrowLeft size={20} />
            <span className="text-sm font-medium">Back</span>
          </button>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">New Newsletter</h2>
            <p className="text-sm text-gray-500 mt-0.5">Generate from Instagram and send via Mailchimp</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPreview(!showPreview)}
            className={`flex items-center gap-2 px-4 py-2 border rounded-xl text-sm font-medium transition-colors cursor-pointer ${
              showPreview ? 'border-[#C9963A] text-[#C9963A] bg-[#C9963A]/5' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Eye size={16} />
            {showPreview ? 'Hide Preview' : 'Preview'}
          </button>
          <button
            onClick={handleSaveDraft}
            disabled={!hasContent || saving}
            className="flex items-center gap-2 px-4 py-2 bg-[#C9963A] text-white rounded-xl text-sm font-semibold hover:bg-[#b8941a] transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Save size={16} />
            {saving ? 'Saving...' : 'Save Draft'}
          </button>
          <button
            onClick={() => handleSend()}
            disabled={!hasContent || sending || !mailchimpConnected}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Send size={16} />
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>

      {/* Connection badges */}
      <div className="flex items-center gap-3 flex-wrap">
        {loadingConnections ? (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-lg">
            <Loader2 size={14} className="animate-spin text-gray-400" />
            <span className="text-xs text-gray-500">Checking connections...</span>
          </div>
        ) : (
          <>
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium ${
              instagramConnected ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
            }`}>
              <Instagram size={14} />
              {instagramConnected ? 'Instagram Connected' : 'Instagram Not Connected'}
              {instagramConnected && <Check size={12} />}
            </div>
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium ${
              mailchimpConnected ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
            }`}>
              <Mail size={14} />
              {mailchimpConnected ? 'Mailchimp Connected' : 'Mailchimp Not Connected'}
              {mailchimpConnected && <Check size={12} />}
            </div>
            {(!instagramConnected || !mailchimpConnected) && (
              <a href="#" onClick={(e) => { e.preventDefault(); /* Navigate to settings integrations */ }} className="text-xs text-[#C9963A] hover:underline">
                Connect in Settings →
              </a>
            )}
          </>
        )}
      </div>

      {/* Error/Success messages */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-100 rounded-xl">
          <AlertCircle size={18} className="text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600 cursor-pointer">✕</button>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-100 rounded-xl">
          <Check size={18} className="text-green-500 flex-shrink-0" />
          <p className="text-sm text-green-700">{success}</p>
          <button onClick={() => setSuccess(null)} className="ml-auto text-green-400 hover:text-green-600 cursor-pointer">✕</button>
        </div>
      )}

      {/* Generate button */}
      {!newsletterId && (
        <div className="bg-gradient-to-br from-[#C9963A]/5 to-[#C9963A]/10 border border-[#C9963A]/20 rounded-2xl p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-[#C9963A]/10 rounded-2xl flex items-center justify-center">
            <Wand2 size={28} className="text-[#C9963A]" />
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-2">Generate Newsletter from Instagram</h3>
          <p className="text-sm text-gray-600 mb-6 max-w-md mx-auto">
            AI will analyze your last 30 days of Instagram posts and create an engaging newsletter for your community.
          </p>
          <button
            onClick={handleGenerate}
            disabled={generating || !instagramConnected}
            className="inline-flex items-center gap-2 px-8 py-3 bg-[#C9963A] text-white rounded-xl text-sm font-bold hover:bg-[#b8941a] transition-all disabled:opacity-50 cursor-pointer shadow-lg shadow-[#C9963A]/20"
          >
            {generating ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Wand2 size={18} />
                Generate Newsletter
              </>
            )}
          </button>
          {!instagramConnected && (
            <p className="text-xs text-amber-600 mt-3">Connect your Instagram account in Settings first.</p>
          )}
        </div>
      )}

      {/* Editor + Preview */}
      {newsletterId && (
        <div className={`grid gap-6 ${showPreview ? 'lg:grid-cols-[55%_45%]' : 'grid-cols-1'}`}>
          {/* Editor column */}
          <div className="space-y-4">
            {/* Subject */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Subject Line</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Enter your newsletter subject..."
                className="w-full text-lg font-semibold text-gray-900 placeholder-gray-300 border-0 focus:outline-none focus:ring-0 bg-transparent"
              />
              <div className="text-xs text-gray-400 text-right mt-1">{subject.length}/150</div>
            </div>

            {/* Content editor */}
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-50">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Newsletter Content</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowPreview(!showPreview)}
                    className="lg:hidden flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg transition-colors cursor-pointer"
                  >
                    <Eye size={12} />
                    Preview
                  </button>
                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#C9963A] hover:bg-[#C9963A]/5 border border-[#C9963A]/20 rounded-lg transition-colors cursor-pointer"
                  >
                    <Wand2 size={12} />
                    Regenerate
                  </button>
                </div>
              </div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Newsletter content will appear here after generation..."
                className="w-full px-5 py-4 text-sm text-gray-800 leading-relaxed min-h-[400px] focus:outline-none resize-y font-mono"
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
              />
            </div>

            {/* Schedule section */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <button
                onClick={() => setShowSchedule(!showSchedule)}
                className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors cursor-pointer"
              >
                <Clock size={16} />
                Schedule for later
                <ChevronDown size={14} className={`transition-transform ${showSchedule ? 'rotate-180' : ''}`} />
              </button>
              {showSchedule && (
                <div className="mt-4 flex items-center gap-3">
                  <input
                    type="datetime-local"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                    className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#C9963A] focus:border-transparent"
                  />
                  <button
                    onClick={() => handleSend(scheduleDate)}
                    disabled={!scheduleDate || sending}
                    className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <Clock size={16} />
                    Schedule
                  </button>
                </div>
              )}
            </div>

            {/* Footer info */}
            <p className="text-xs text-gray-400 text-center py-2">
              Sending to all subscribers of {tenantName} via Mailchimp
            </p>
          </div>

          {/* Preview column */}
          {showPreview && (
            <div className="lg:sticky lg:top-6 space-y-4">
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-50 flex items-center gap-2">
                  <Eye size={14} className="text-gray-400" />
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Email Preview</span>
                </div>
                <div className="p-6 max-h-[600px] overflow-y-auto">
                  {/* Email header */}
                  <div className="text-center mb-6 pb-4 border-b border-gray-100">
                    <div className="text-lg font-bold text-gray-900 mb-1">{subject || 'Newsletter Subject'}</div>
                    <div className="text-xs text-gray-400">From {tenantName}</div>
                  </div>
                  {/* Email content */}
                  <div
                    className="prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(content || '<p style="color:#999;">Newsletter content will appear here...</p>') }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NewsletterEditor;
