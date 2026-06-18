"use client";
import React, { useState } from 'react';
import {
  ArrowLeft,
  Mail,
  Send,
  Save,
  Edit3,
  Eye,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Sparkles,
} from 'lucide-react';
import { authFetch } from '../utils/auth-fetch';
import DOMPurify from 'dompurify';

interface Newsletter {
  newsletterId: string;
  subject: string;
  htmlContent: string;
  plainText: string;
  postsUsed: number;
}

interface NewsletterEditorProps {
  tenantId: string;
  tenantName: string;
  onBack: () => void;
}

const NewsletterEditor: React.FC<NewsletterEditorProps> = ({
  tenantId,
  tenantName,
  onBack,
}) => {
  const [generating, setGenerating] = useState(false);
  const [newsletter, setNewsletter] = useState<Newsletter | null>(null);
  const [subject, setSubject] = useState('');
  const [htmlContent, setHtmlContent] = useState('');
  const [plainText, setPlainText] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handleGenerate = async () => {
    if (newsletter && !window.confirm('You have unsaved edits. Regenerate and discard changes?')) {
      return;
    }
    setGenerating(true);
    setError(null);
    setSuccess(null);
    setNewsletter(null);
    setSent(false);

    try {
      const response = await authFetch('/api/newsletter/generate', {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate newsletter');
      }

      setNewsletter(data);
      setSubject(data.subject);
      setHtmlContent(data.htmlContent);
      setPlainText(data.plainText);
    } catch (err: any) {
      setError(err.message || 'Failed to generate newsletter');
    } finally {
      setGenerating(false);
    }
  };

  const handleSend = async () => {
    if (!newsletter) return;
    setSending(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await authFetch('/api/newsletter/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newsletterId: newsletter.newsletterId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send newsletter');
      }

      setSuccess(data.message || 'Newsletter sent successfully!');
      setSent(true);
    } catch (err: any) {
      setError(err.message || 'Failed to send newsletter');
    } finally {
      setSending(false);
    }
  };

  const handleSchedule = async () => {
    if (!newsletter || !scheduleDate) return;
    setScheduling(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await authFetch('/api/newsletter/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newsletterId: newsletter.newsletterId,
          schedule: new Date(scheduleDate).toISOString(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to schedule newsletter');
      }

      setSuccess(data.message || 'Newsletter scheduled!');
      setShowSchedule(false);
    } catch (err: any) {
      setError(err.message || 'Failed to schedule newsletter');
    } finally {
      setScheduling(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="border-b border-gray-100 px-6 py-4">
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
              Newsletter Editor
            </h1>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Error/Success Messages */}
        {error && (
          <div className="mb-6 flex items-start gap-3 rounded-lg bg-red-50 border border-red-200 p-4">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-red-700">{error}</p>
              <button
                onClick={() => setError(null)}
                className="mt-1 text-xs text-red-500 hover:text-red-700 underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {success && (
          <div className="mb-6 flex items-start gap-3 rounded-lg bg-green-50 border border-green-200 p-4">
            <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-green-700">{success}</p>
              <button
                onClick={() => setSuccess(null)}
                className="mt-1 text-xs text-green-500 hover:text-green-700 underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Generate Section */}
        {!newsletter && !generating && (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-full bg-[#C9963A]/10 flex items-center justify-center mx-auto mb-6">
              <Sparkles className="w-8 h-8 text-[#C9963A]" />
            </div>
            <h2 className="text-2xl font-bold text-[#0b1121] mb-2">
              Generate Newsletter
            </h2>
            <p className="text-gray-500 mb-8 max-w-md mx-auto">
              Automatically create an engaging newsletter from your Instagram
              posts from the past 30 days using AI.
            </p>
            <button
              onClick={handleGenerate}
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#C9963A] text-white rounded-lg font-medium hover:bg-[#b8862f] transition-colors shadow-sm"
            >
              <Sparkles className="w-4 h-4" />
              Generate Newsletter from Instagram
            </button>
          </div>
        )}

        {/* Loading State */}
        {generating && (
          <div className="text-center py-16">
            <Loader2 className="w-10 h-10 text-[#C9963A] animate-spin mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-[#0b1121] mb-2">
              Generating your newsletter...
            </h3>
            <p className="text-gray-500 text-sm">
              Fetching Instagram posts and creating content with AI. This may
              take a moment.
            </p>
          </div>
        )}

        {/* Newsletter Preview/Edit */}
        {newsletter && (
          <div className="space-y-6">
            {/* Subject Line */}
            <div>
              <label className="block text-sm font-medium text-[#0b1121] mb-2">
                Subject Line
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-lg text-[#0b1121] focus:outline-none focus:ring-2 focus:ring-[#C9963A]/30 focus:border-[#C9963A] transition-colors"
                placeholder="Newsletter subject..."
              />
            </div>

            {/* Posts Used Info */}
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded-full">
                📸 {newsletter.postsUsed} posts used
              </span>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setIsEditing(!isEditing)}
                className="inline-flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-[#0b1121] hover:bg-gray-50 transition-colors"
              >
                {isEditing ? (
                  <>
                    <Eye className="w-4 h-4" />
                    Preview
                  </>
                ) : (
                  <>
                    <Edit3 className="w-4 h-4" />
                    Edit HTML
                  </>
                )}
              </button>

              <button
                onClick={handleSend}
                disabled={sending || sent}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#C9963A] text-white rounded-lg text-sm font-medium hover:bg-[#b8862f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                {sent ? 'Sent ✓' : 'Send Now'}
              </button>

              <button
                onClick={() => setShowSchedule(!showSchedule)}
                className="inline-flex items-center gap-2 px-4 py-2 border border-[#C9963A] text-[#C9963A] rounded-lg text-sm font-medium hover:bg-[#C9963A]/5 transition-colors"
              >
                <Calendar className="w-4 h-4" />
                Schedule
              </button>

              <button
                onClick={handleGenerate}
                disabled={generating || sent}
                className="inline-flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" />
                Regenerate
              </button>
            </div>

            {/* Schedule Panel */}
            {showSchedule && (
              <div className="flex items-end gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-[#0b1121] mb-1">
                    Schedule Date & Time
                  </label>
                  <input
                    type="datetime-local"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9963A]/30 focus:border-[#C9963A]"
                  />
                </div>
                <button
                  onClick={handleSchedule}
                  disabled={scheduling || !scheduleDate}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#C9963A] text-white rounded-lg text-sm font-medium hover:bg-[#b8862f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {scheduling ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Calendar className="w-4 h-4" />
                  )}
                  Schedule Send
                </button>
              </div>
            )}

            {/* Content Area */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {isEditing ? 'HTML Editor' : 'Preview'}
                </span>
              </div>

              {isEditing ? (
                <textarea
                  value={htmlContent}
                  onChange={(e) => setHtmlContent(e.target.value)}
                  className="w-full min-h-[500px] px-4 py-4 text-sm font-mono text-[#0b1121] focus:outline-none resize-y"
                  placeholder="Newsletter HTML content..."
                />
              ) : (
                <div
                  className="p-6 min-h-[400px]"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(htmlContent) }}
                />
              )}
            </div>

            {/* Plain Text Preview */}
            {plainText && (
              <details className="border border-gray-200 rounded-lg overflow-hidden">
                <summary className="bg-gray-50 px-4 py-2 cursor-pointer text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Plain Text Version
                </summary>
                <pre className="p-4 text-sm text-gray-700 whitespace-pre-wrap font-sans">
                  {plainText}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default NewsletterEditor;
