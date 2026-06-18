"use client";
import React, { useState } from 'react';
import { ArrowLeft, Send, Eye, Save } from 'lucide-react';

interface NewsletterEditorProps {
  tenantId: string;
  tenantName: string;
  onBack: () => void;
}

const NewsletterEditor: React.FC<NewsletterEditorProps> = ({ tenantId, tenantName, onBack }) => {
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);

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
        <h2 className="text-2xl font-bold text-gray-900">New Newsletter</h2>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setPreviewMode(!previewMode)}
            className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <Eye size={16} />
            {previewMode ? 'Edit' : 'Preview'}
          </button>
          <button
            disabled={!subject.trim() || sending}
            className="flex items-center gap-2 px-5 py-2 bg-[#d4a017] text-white rounded-xl text-sm font-semibold hover:bg-[#b8941a] transition-colors disabled:opacity-50"
          >
            <Save size={16} />
            Save Draft
          </button>
          <button
            disabled={!subject.trim() || !content.trim() || sending}
            className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            <Send size={16} />
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>

      {/* Subject */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <label className="block text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Subject Line</label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Enter your newsletter subject..."
          className="w-full px-4 py-3 border border-gray-200 rounded-xl text-lg focus:outline-none focus:ring-2 focus:ring-[#d4a017] focus:border-transparent"
        />
      </div>

      {/* Content */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <label className="block text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Content</label>
        {previewMode ? (
          <div
            className="prose max-w-none min-h-[400px] p-4 border border-gray-100 rounded-xl"
            dangerouslySetInnerHTML={{ __html: content || '<p class="text-gray-400">Nothing to preview yet.</p>' }}
          />
        ) : (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write your newsletter content here... (HTML supported)"
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-mono min-h-[400px] focus:outline-none focus:ring-2 focus:ring-[#d4a017] focus:border-transparent resize-y"
          />
        )}
      </div>

      <p className="text-xs text-gray-400 text-center">
        Sending to all subscribed members of {tenantName}
      </p>
    </div>
  );
};

export default NewsletterEditor;
