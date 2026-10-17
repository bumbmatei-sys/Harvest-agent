"use client";
import React, { useState, useEffect } from 'react';
import { ArrowLeft, X, Plus, Trash2 } from 'lucide-react';
import { ImageUpload } from './ImageUpload';
import RichTextEditor from './RichTextEditor';
import { getWriteTenantScope } from '../utils/tenant-scope';
import { AdminPrimaryButton, AdminSecondaryButton, AdminCard, AdminSectionLabel } from './admin/AdminUI';
import { useTenantCapability } from '../hooks/useTenantCapability';
import { ARCHIVED_ACTION_MESSAGE } from '../lib/tenant-lifecycle';
import type { FirestoreDate } from '../utils/firestore-date';
import { authFetch } from '../utils/auth-fetch';
import { publishedAtMillis, utcIsoToWallClock, isValidTimeZone } from '../lib/blog/visibility';
import { BlogScheduleFields, schedulePreviewSentence, type BlogEditorIntent } from './blog/BlogScheduleFields';

interface BlogPost {
  id?: string;
  title: string;
  category: string;
  status: 'published' | 'draft' | 'scheduled';
  // THE-347 - the same widening AdminBlog and BlogTab needed. This editor is
  // handed a post OBJECT straight out of AdminBlog's list, so whatever shape the
  // document holds arrives here unchanged.
  createdAt?: FirestoreDate;
  updatedAt?: FirestoreDate;
  authorId?: string;
  content: string;
  featuredImage?: string;
  tags?: string[];
  publishedAt?: FirestoreDate;
  scheduleTimeZone?: string | null;
}

function initialWallClock(value: FirestoreDate | undefined, timeZone: string): string {
  const ms = publishedAtMillis(value);
  if (ms == null || !isValidTimeZone(timeZone)) return '';
  return utcIsoToWallClock(new Date(ms).toISOString(), timeZone);
}

interface AdminBlogPostEditorProps {
  post?: BlogPost | null;
  onClose: () => void;
  categories: string[];
}

const fieldLabel = 'block text-xs font-semibold text-body mb-1.5';
const fieldInput = 'w-full px-3 py-2.5 bg-surface-raised border border-line rounded-brand text-sm text-strong outline-hidden focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_35%,transparent)] focus:border-transparent transition-all';

const AdminBlogPostEditor: React.FC<AdminBlogPostEditorProps> = ({ post, onClose, categories }) => {
  const [title, setTitle] = useState(post?.title || '');
  const [category, setCategory] = useState(post?.category || '');
  const [newCategory, setNewCategory] = useState('');
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [featuredImage, setFeaturedImage] = useState(post?.featuredImage || '');
  const [content, setContent] = useState(post?.content || '');
  const [tags, setTags] = useState<string[]>(post?.tags || []);
  const [newTag, setNewTag] = useState('');
  const [status, setStatus] = useState<BlogEditorIntent>(post?.status || 'draft');
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const timeZone = post?.scheduleTimeZone && isValidTimeZone(post.scheduleTimeZone) ? post.scheduleTimeZone : browserZone;
  // Wall-clock in the church or browser zone. The service stores the UTC instant.
  const [scheduledDate, setScheduledDate] = useState(() => initialWallClock(post?.publishedAt, timeZone));
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const clearPreview = () => {
    setPendingPreview(null);
    setPendingToken(null);
  };
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [availableCategories, setAvailableCategories] = useState<string[]>(categories);
  const canPublish = useTenantCapability('publishing');
  const storedLive = post?.status === 'published' || post?.status === 'scheduled';
  const takingDown = storedLive && status === 'draft';

  useEffect(() => {
    if (categories.length > 0 && !category) {
      setCategory(categories[0]);
    }
  }, [categories, category]);

  const handleAddCategory = () => {
    if (newCategory.trim() && !availableCategories.includes(newCategory.trim())) {
      setAvailableCategories([...availableCategories, newCategory.trim()]);
      setCategory(newCategory.trim());
      setNewCategory('');
      setIsAddingCategory(false);
    }
  };

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && newTag.trim() && !tags.includes(newTag.trim())) {
      e.preventDefault();
      setTags([...tags, newTag.trim()]);
      setNewTag('');
      clearPreview();
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
    clearPreview();
  };

  const payload = () => ({
    tenantId: undefined as string | undefined,
    postId: post?.id ?? null,
    title,
    category,
    content,
    featuredImage: featuredImage.trim() || null,
    tags,
    wallClock: scheduledDate,
    timeZone,
  });

  const callService = async (action: string, mode?: 'preview' | 'confirm', confirmToken?: string | null) => {
    const tenantId = await getWriteTenantScope();
    if (!tenantId) {
      setError('A ministry is required before this post can be saved.');
      return null;
    }
    const response = await authFetch('/api/blog/actions', {
      method: 'POST',
      body: JSON.stringify({
        ...payload(),
        tenantId,
        action,
        mode,
        ...(confirmToken ? { confirmToken } : {}),
      }),
    });
    const data = await response.json();
    if (!response.ok || data.ok === false) {
      setError(typeof data.message === 'string' ? data.message : 'Failed to save post');
      return null;
    }
    return data;
  };

  const handleSave = async (saveStatus: 'published' | 'draft' | 'scheduled', mode: 'preview' | 'confirm') => {
    const demote = takingDown && saveStatus === 'draft';
    if (!demote && saveStatus !== 'draft' && !canPublish) {
      setError(ARCHIVED_ACTION_MESSAGE);
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      const action = demote ? 'unschedule' : saveStatus === 'draft' ? 'createDraft' : saveStatus === 'scheduled' ? 'schedule' : 'publishNow';
      const needsConfirm = action !== 'createDraft';
      const data = await callService(
        action,
        needsConfirm ? mode : undefined,
        needsConfirm && mode === 'confirm' ? pendingToken : undefined,
      );
      if (!data) return;
      if (needsConfirm && mode === 'preview') {
        if (typeof data.confirmToken !== 'string' || data.confirmToken === '') {
          setError('The preview did not return a confirmation.');
          return;
        }
        setPendingToken(data.confirmToken);
        setPendingPreview(schedulePreviewSentence(data.preview));
        return;
      }
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save post');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePublish = () => {
    const next = takingDown ? 'draft' : status === 'scheduled' ? 'scheduled' : 'published';
    void handleSave(next, pendingPreview ? 'confirm' : 'preview');
  };

  return (
    <div className="w-full max-w-6xl mx-auto pb-10">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <button onClick={onClose} className="flex items-center gap-1.5 text-[13px] font-semibold text-gold hover:opacity-80 transition-opacity">
          <ArrowLeft size={16} /> Blog
        </button>
        <div className="flex items-center gap-2.5">
          <AdminSecondaryButton
            onClick={() => {
              if (takingDown) {
                void handleSave('draft', pendingPreview ? 'confirm' : 'preview');
                return;
              }
              clearPreview();
              void handleSave('draft', 'preview');
            }}
            disabled={isSaving}
          >
            {isSaving ? 'Saving…' : 'Save draft'}
          </AdminSecondaryButton>
          <AdminPrimaryButton
            onClick={handlePublish}
            disabled={isSaving || (!takingDown && (!canPublish || status === 'draft'))}
            title={canPublish || takingDown ? undefined : ARCHIVED_ACTION_MESSAGE}
          >
            {pendingPreview ? 'Confirm' : takingDown ? 'Save as draft' : status === 'scheduled' ? 'Schedule' : 'Publish now'}
          </AdminPrimaryButton>
        </div>
      </div>

      {error && <div className="bg-red-50 text-red-600 p-3 rounded-brand text-sm mb-4 border border-red-100">{error}</div>}

      <div className="lg:grid lg:grid-cols-[1fr_340px] lg:gap-6 space-y-6 lg:space-y-0 items-start">
        {/* Main: title + content */}
        <AdminCard>
          <input
            type="text"
            value={title}
            onChange={(e) => { setTitle(e.target.value); setError(''); clearPreview(); }}
            placeholder="Post title"
            className="w-full px-6 pt-6 pb-5 font-display text-[1.9rem] font-normal text-strong placeholder:text-stone-300 border-none outline-hidden bg-transparent leading-tight"
            autoFocus
          />
          <div className="border-t border-line px-6 py-5">
            <RichTextEditor
              content={content}
              onChange={(c) => { setContent(c); setError(''); clearPreview(); }}
              minHeight="46vh"
              placeholder="Write your article… Type '/' for formatting options"
            />
          </div>
        </AdminCard>

        {/* Rail: settings + featured image */}
        <div className="space-y-6">
          <AdminCard className="p-5 space-y-4">
            <AdminSectionLabel>Post settings</AdminSectionLabel>

            <BlogScheduleFields
              intent={status}
              onIntent={(next) => { setStatus(next); clearPreview(); }}
              wallClock={scheduledDate}
              onWallClock={(value) => { setScheduledDate(value); clearPreview(); }}
              timeZone={timeZone}
              preview={pendingPreview}
              fieldLabel={fieldLabel}
              fieldInput={fieldInput}
            />

            <div>
              <label className={fieldLabel}>Category</label>
              {!isAddingCategory ? (
                <div className="flex gap-2">
                  <select value={category} onChange={(e) => { setCategory(e.target.value); clearPreview(); }} className={`${fieldInput} flex-1 appearance-none`}>
                    <option value="" disabled>Select a category</option>
                    {availableCategories.map(cat => (<option key={cat} value={cat}>{cat}</option>))}
                  </select>
                  {category && (
                    <button
                      onClick={() => { setAvailableCategories(availableCategories.filter(c => c !== category)); setCategory(''); clearPreview(); }}
                      className="px-2.5 rounded-brand text-danger hover:bg-danger-tint transition-colors"
                      title="Remove selected category"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => setIsAddingCategory(true)}
                    className="px-2.5 rounded-brand text-muted hover:bg-surface-sunken transition-colors"
                    title="New category"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    placeholder="Category name"
                    className={`${fieldInput} flex-1`}
                    autoFocus
                  />
                  <button onClick={handleAddCategory} disabled={!newCategory.trim()} className="px-3 py-2 rounded-brand text-white text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: 'var(--brand-color, #C9963A)' }}>Add</button>
                  <button onClick={() => { setIsAddingCategory(false); setNewCategory(''); }} className="p-2 rounded-brand text-muted hover:bg-surface-sunken transition-colors"><X size={16} /></button>
                </div>
              )}
            </div>

            <div>
              <label className={fieldLabel}>Tags</label>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {tags.map(tag => (
                    <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 bg-surface-sunken text-body rounded-full text-xs">
                      {tag}
                      <button onClick={() => removeTag(tag)} className="hover:text-danger transition-colors"><X size={12} /></button>
                    </span>
                  ))}
                </div>
              )}
              <input type="text" value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={handleAddTag} placeholder="Type a tag, press Enter" className={fieldInput} />
            </div>

          </AdminCard>

          <AdminCard className="p-5 space-y-3">
            <AdminSectionLabel>Featured image</AdminSectionLabel>
            <ImageUpload value={featuredImage} onChange={(value) => { setFeaturedImage(value); clearPreview(); }} placeholder="Upload or paste URL" />
          </AdminCard>
        </div>
      </div>
    </div>
  );
};

export default AdminBlogPostEditor;
