"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, Send, Eye, Save, Wand2, Mail, Loader2, Check, AlertCircle, Clock, ChevronDown } from 'lucide-react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import UnderlineExtension from '@tiptap/extension-underline';
import LinkExtension from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import { authFetch } from '../utils/auth-fetch';

interface NewsletterEditorProps {
  tenantId: string;
  tenantName: string;
  onBack: () => void;
  onNavigateToSettings?: () => void;
  canAutoGenerate?: boolean;
}

const EditorToolbar: React.FC<{ editor: ReturnType<typeof useEditor> }> = ({ editor }) => {
  if (!editor) return null;
  const btn = (active: boolean, onClick: () => void, label: string) => (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
        active ? 'bg-[color-mix(in_srgb,var(--brand-color)_10%,transparent)] text-gold' : 'text-gray-500 hover:bg-gray-100'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-0.5 px-4 py-2 border-b border-gray-100 bg-gray-50/60 flex-wrap">
      {btn(editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), 'B')}
      {btn(editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), 'I')}
      {btn(editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run(), 'U')}
      <div className="w-px h-5 bg-gray-200 mx-1" />
      {btn(editor.isActive('heading', { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run(), 'H1')}
      {btn(editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), 'H2')}
      {btn(editor.isActive('heading', { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), 'H3')}
      <div className="w-px h-5 bg-gray-200 mx-1" />
      {btn(editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), '• List')}
      {btn(editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), '1. List')}
      {btn(editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run(), 'Quote')}
    </div>
  );
};

const NewsletterEditor: React.FC<NewsletterEditorProps> = ({
  tenantId,
  tenantName,
  onBack,
  onNavigateToSettings,
  canAutoGenerate = false,
}) => {
  const [subject, setSubject] = useState('');
  const [newsletterId, setNewsletterId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mailchimpConnected, setMailchimpConnected] = useState(false);
  const [loadingConnections, setLoadingConnections] = useState(true);

  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      UnderlineExtension,
      LinkExtension.configure({ openOnClick: false }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder: 'Write your newsletter content here...' }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[400px] px-5 py-4 text-gray-800',
      },
    },
  });

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const resp = await authFetch(`/api/composio/mailchimp/status?tenantId=${tenantId}`);
        if (resp.ok) {
          const data = await resp.json();
          setMailchimpConnected(data.status === 'connected');
        }
      } catch (e) {
        console.error('Failed to check Mailchimp connection:', e);
      }
      setLoadingConnections(false);
    };
    checkConnection();
  }, [tenantId]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setSuccess(null);
    try {
      const resp = await authFetch('/api/newsletter/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, startDate, endDate }),
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error((errData as any).error || 'Failed to generate newsletter');
      }
      const data = await resp.json();
      setSubject(data.subject || '');
      if (data.bodyHtml) {
        editor?.commands.setContent(data.bodyHtml);
      }
      setNewsletterId(data.newsletterId);
      setSuccess(`Newsletter generated from ${data.postsUsed} Instagram posts`);
    } catch (e: any) {
      setError(e.message || 'Failed to generate newsletter');
    }
    setGenerating(false);
  };

  const doSave = useCallback(async (): Promise<string | null> => {
    if (!editor) return null;
    const bodyHtml = editor.getHTML();
    const bodyJson = editor.getJSON();
    let id = newsletterId;
    if (!id) {
      id = 'manual-' + Date.now();
      setNewsletterId(id);
    }
    const resp = await authFetch('/api/newsletter/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newsletterId: id, subject, bodyHtml, bodyJson, action: 'save_draft' }),
    });
    if (!resp.ok) throw new Error('Failed to save draft');
    return id;
  }, [editor, newsletterId, subject]);

  const handleSaveDraft = async () => {
    setSaving(true);
    setError(null);
    try {
      await doSave();
      setSuccess('Draft saved');
    } catch (e: any) {
      setError(e.message || 'Failed to save draft');
    }
    setSaving(false);
  };

  const handleSend = async (scheduledDate?: string) => {
    setSending(true);
    setError(null);
    setSuccess(null);
    try {
      const id = await doSave();
      if (!id) throw new Error('Failed to save before sending');
      const resp = await authFetch('/api/newsletter/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newsletterId: id,
          ...(scheduledDate ? { schedule: scheduledDate } : {}),
        }),
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error((errData as any).error || 'Failed to send newsletter');
      }
      setSuccess(scheduledDate ? 'Newsletter scheduled!' : 'Newsletter sent successfully!');
      if (!scheduledDate) setTimeout(() => onBack(), 2000);
    } catch (e: any) {
      setError(e.message || 'Failed to send newsletter');
    }
    setSending(false);
  };

  const hasContent = subject.trim() && editor && editor.getText().trim().length > 0;

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-32">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-gold hover:opacity-70 transition-opacity cursor-pointer">
            <ChevronLeft size={24} />
          </button>
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              {newsletterId ? 'Edit Newsletter' : 'New Newsletter'}
            </h2>
            <p className="text-xs text-gray-500">
              {canAutoGenerate ? 'AI-generated from Instagram · sent via Mailchimp' : 'Write manually · sent via Mailchimp'}
            </p>
          </div>
        </div>
        {newsletterId && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowPreview(!showPreview)}
              className={`flex items-center gap-1.5 px-3 py-2 border rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                showPreview ? 'border-gold text-gold bg-[color-mix(in_srgb,var(--brand-color)_5%,transparent)]' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Eye size={15} />
              Preview
            </button>
            <button
              onClick={handleSaveDraft}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <Save size={15} />
              {saving ? 'Saving...' : 'Save Draft'}
            </button>
            <button
              onClick={() => handleSend()}
              disabled={!hasContent || sending || !mailchimpConnected}
              className="flex items-center gap-1.5 px-4 py-2 bg-gold text-white rounded-xl text-sm font-semibold hover:bg-[color-mix(in_srgb,var(--brand-color)_85%,black)] transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Send size={15} />
              {sending ? 'Sending...' : 'Send to All Partners'}
            </button>
          </div>
        )}
      </div>

      {/* Mailchimp warning */}
      {!loadingConnections && !mailchimpConnected && (
        <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-100 rounded-xl">
          <Mail size={18} className="text-amber-500 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-amber-700 font-medium">Mailchimp not connected</p>
            <p className="text-xs text-amber-600">You can write and save drafts, but won’t be able to send until Mailchimp is connected.</p>
          </div>
          {onNavigateToSettings && (
            <button onClick={onNavigateToSettings} className="text-xs text-amber-700 underline cursor-pointer">
              Go to Settings
            </button>
          )}
        </div>
      )}

      {/* Alerts */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-100 rounded-xl">
          <AlertCircle size={16} className="text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700 flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 cursor-pointer text-lg leading-none">×</button>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-100 rounded-xl">
          <Check size={16} className="text-green-500 flex-shrink-0" />
          <p className="text-sm text-green-700 flex-1">{success}</p>
          <button onClick={() => setSuccess(null)} className="text-green-400 hover:text-green-600 cursor-pointer text-lg leading-none">×</button>
        </div>
      )}

      {/* Landing: pick auto-generate or manual */}
      {!newsletterId && (
        <div className="space-y-4">
          {canAutoGenerate && (
            <div className="bg-white border border-gray-100 rounded-2xl p-6">
              <div className="flex items-start gap-4 mb-5">
                <div className="w-12 h-12 rounded-2xl bg-[color-mix(in_srgb,var(--brand-color)_10%,transparent)] flex items-center justify-center flex-shrink-0">
                  <Wand2 size={22} className="text-gold" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Generate from Instagram</h3>
                  <p className="text-sm text-gray-500 mt-0.5">AI analyzes your Instagram posts and writes an engaging newsletter automatically.</p>
                </div>
              </div>
              <div className="flex items-center gap-3 mb-5">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">From</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_30%,transparent)] focus:border-gold"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">To</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    max={new Date().toISOString().split('T')[0]}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_30%,transparent)] focus:border-gold"
                  />
                </div>
              </div>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-gold text-white rounded-xl text-sm font-bold hover:bg-[color-mix(in_srgb,var(--brand-color)_85%,black)] transition-all disabled:opacity-50 cursor-pointer"
              >
                {generating ? (
                  <><Loader2 size={18} className="animate-spin" /> Generating newsletter...</>
                ) : (
                  <><Wand2 size={18} /> Generate Newsletter</>
                )}
              </button>
            </div>
          )}

          <div className="bg-white border border-gray-100 rounded-2xl p-6">
            <div className="flex items-start gap-4 mb-5">
              <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center flex-shrink-0">
                <Mail size={22} className="text-gray-500" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">Write Manually</h3>
                <p className="text-sm text-gray-500 mt-0.5">Compose your newsletter from scratch using the rich-text editor.</p>
              </div>
            </div>
            <button
              onClick={() => {
                setNewsletterId('manual-' + Date.now());
                setSubject('');
                editor?.commands.clearContent();
              }}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
            >
              Start Writing
            </button>
          </div>
        </div>
      )}

      {/* Editor + Preview */}
      {newsletterId && (
        <div className={`grid gap-6 ${showPreview ? 'lg:grid-cols-[55%_45%]' : 'grid-cols-1'}`}>
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

            {/* TipTap editor */}
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-50">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Newsletter Content</span>
                {canAutoGenerate && (
                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gold hover:bg-[color-mix(in_srgb,var(--brand-color)_5%,transparent)] border border-[color-mix(in_srgb,var(--brand-color)_20%,transparent)] rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Wand2 size={12} />
                    {generating ? 'Generating...' : 'Regenerate'}
                  </button>
                )}
              </div>
              <EditorToolbar editor={editor} />
              <EditorContent editor={editor} />
            </div>

            {/* Schedule */}
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
                    className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_30%,transparent)] focus:border-gold"
                  />
                  <button
                    onClick={() => handleSend(scheduleDate)}
                    disabled={!scheduleDate || sending || !hasContent}
                    className="flex items-center gap-2 px-5 py-2.5 bg-gray-800 text-white rounded-xl text-sm font-semibold hover:bg-gray-900 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <Clock size={15} />
                    Schedule
                  </button>
                </div>
              )}
            </div>

            <p className="text-xs text-gray-400 text-center py-2">
              Sending to all partners of {tenantName} via Mailchimp
            </p>
          </div>

          {/* Preview */}
          {showPreview && (
            <div className="lg:sticky lg:top-6">
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-50 flex items-center gap-2">
                  <Eye size={14} className="text-gray-400" />
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Email Preview</span>
                </div>
                <div className="p-6 max-h-[600px] overflow-y-auto">
                  <div className="text-center mb-6 pb-4 border-b border-gray-100">
                    <div className="text-base font-bold text-gray-900 mb-1">{subject || 'Newsletter Subject'}</div>
                    <div className="text-xs text-gray-400">From {tenantName}</div>
                  </div>
                  <div
                    className="prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: editor?.getHTML() || '<p class="text-gray-400">Content will appear here...</p>' }}
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
