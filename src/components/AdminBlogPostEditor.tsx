"use client";
import React, { useState, useEffect } from 'react';
import { ArrowLeft, X, Plus, Trash2 } from 'lucide-react';
import { collection, addDoc, updateDoc, doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { ImageUpload } from './ImageUpload';
import RichTextEditor from './RichTextEditor';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope, getWriteTenantScope } from '../utils/tenant-scope';
import { AdminPrimaryButton, AdminSecondaryButton, AdminCard, AdminSectionLabel } from './admin/AdminUI';

interface BlogPost {
  id?: string;
  title: string;
  category: string;
  status: 'published' | 'draft' | 'scheduled';
  createdAt?: string;
  updatedAt?: string;
  authorId?: string;
  content: string;
  featuredImage?: string;
  tags?: string[];
  publishedAt?: string;
}

interface AdminBlogPostEditorProps {
  post?: BlogPost | null;
  onClose: () => void;
  categories: string[];
}

const fieldLabel = 'block text-xs font-semibold text-[color:var(--text-body)] mb-1.5';
const fieldInput = 'w-full px-3 py-2.5 bg-white border border-stone-200 rounded-brand text-sm text-earth outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_35%,transparent)] focus:border-transparent transition-all';

const AdminBlogPostEditor: React.FC<AdminBlogPostEditorProps> = ({ post, onClose, categories }) => {
  const [title, setTitle] = useState(post?.title || '');
  const [category, setCategory] = useState(post?.category || '');
  const [newCategory, setNewCategory] = useState('');
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [featuredImage, setFeaturedImage] = useState(post?.featuredImage || '');
  const [content, setContent] = useState(post?.content || '');
  const [tags, setTags] = useState<string[]>(post?.tags || []);
  const [newTag, setNewTag] = useState('');
  const [status, setStatus] = useState<'published' | 'draft' | 'scheduled'>(post?.status || 'draft');
  const [scheduledDate, setScheduledDate] = useState(post?.publishedAt ? new Date(post.publishedAt).toISOString().slice(0, 16) : '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [availableCategories, setAvailableCategories] = useState<string[]>(categories);

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
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  const handleSave = async (saveStatus: 'published' | 'draft' | 'scheduled') => {
    const missing: string[] = [];
    if (!title.trim()) missing.push('Title');
    if (!category) missing.push('Category');
    const strippedContent = content.replace(/<[^>]*>/g, '').trim();
    if (!strippedContent) missing.push('Content');
    if (saveStatus === 'scheduled' && !scheduledDate) missing.push('Scheduled date');
    if (saveStatus === 'scheduled' && scheduledDate && new Date(scheduledDate) <= new Date()) missing.push('Scheduled date must be in the future');
    if (missing.length > 0) {
      setError(`Missing required fields: ${missing.join(', ')}`);
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      const postData = {
        title: title.trim(),
        category,
        status: saveStatus,
        content,
        featuredImage: featuredImage.trim() || null,
        tags,
        authorId: auth.currentUser?.uid,
        updatedAt: new Date().toISOString(),
        ...(saveStatus === 'scheduled' ? { publishedAt: new Date(scheduledDate).toISOString() } : {}),
        ...(saveStatus === 'published' && !post?.publishedAt ? { publishedAt: new Date().toISOString() } : {})
      };

      const tenantId = await getTenantScope();
      if (post?.id) {
        if (tenantId) {
          const docSnap = await getDoc(doc(db, 'blog_posts', post.id));
          if (docSnap.exists() && docSnap.data().tenantId && docSnap.data().tenantId !== tenantId) {
            setError('Permission denied: cannot modify another ministry\'s post.');
            return;
          }
        }
        await updateDoc(doc(db, 'blog_posts', post.id), postData);
      } else {
        await addDoc(collection(db, 'blog_posts'), {
          ...postData,
          createdAt: new Date().toISOString(),
          // Platform-aware: a super admin on the apex persists the platform
          // tenant instead of null so the post is never orphaned. (The edit
          // branch above keeps getTenantScope() for its ownership check.)
          tenantId: await getWriteTenantScope(),
        });
      }
      onClose();
    } catch (err: any) {
      try { handleFirestoreError(err, OperationType.WRITE, 'blog_posts'); } catch (e) { console.error(e); }
      setError(err.message || 'Failed to save post');
    } finally {
      setIsSaving(false);
    }
  };

  // Single-page, in-shell editor: title + TipTap content (left) · post settings
  // and featured image (right). "Publish" honours the selected status (schedules
  // only when Status is explicitly "Scheduled"); "Save draft" always stores a draft.
  const handlePublish = () => handleSave(status === 'scheduled' ? 'scheduled' : 'published');

  return (
    <div className="w-full max-w-6xl mx-auto pb-10">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <button onClick={onClose} className="flex items-center gap-1.5 text-[13px] font-semibold text-gold hover:opacity-80 transition-opacity">
          <ArrowLeft size={16} /> Blog
        </button>
        <div className="flex items-center gap-2.5">
          <AdminSecondaryButton onClick={() => handleSave('draft')} disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save draft'}
          </AdminSecondaryButton>
          <AdminPrimaryButton onClick={handlePublish} disabled={isSaving}>Publish</AdminPrimaryButton>
        </div>
      </div>

      {error && <div className="bg-red-50 text-red-600 p-3 rounded-brand text-sm mb-4 border border-red-100">{error}</div>}

      <div className="lg:grid lg:grid-cols-[1fr_340px] lg:gap-6 space-y-6 lg:space-y-0 items-start">
        {/* Main: title + content */}
        <AdminCard>
          <input
            type="text"
            value={title}
            onChange={(e) => { setTitle(e.target.value); setError(''); }}
            placeholder="Post title"
            className="w-full px-6 pt-6 pb-5 font-display text-[1.9rem] font-normal text-earth placeholder:text-stone-300 border-none outline-none bg-transparent leading-tight"
            autoFocus
          />
          <div className="border-t border-stone-200 px-6 py-5">
            <RichTextEditor
              content={content}
              onChange={(c) => { setContent(c); setError(''); }}
              minHeight="46vh"
              placeholder="Write your article… Type '/' for formatting options"
            />
          </div>
        </AdminCard>

        {/* Rail: settings + featured image */}
        <div className="space-y-6">
          <AdminCard className="p-5 space-y-4">
            <AdminSectionLabel>Post settings</AdminSectionLabel>

            <div>
              <label className={fieldLabel}>Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as any)} className={`${fieldInput} appearance-none`}>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="scheduled">Scheduled</option>
              </select>
            </div>

            <div>
              <label className={fieldLabel}>Category</label>
              {!isAddingCategory ? (
                <div className="flex gap-2">
                  <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${fieldInput} flex-1 appearance-none`}>
                    <option value="" disabled>Select a category</option>
                    {availableCategories.map(cat => (<option key={cat} value={cat}>{cat}</option>))}
                  </select>
                  {category && (
                    <button
                      onClick={() => { setAvailableCategories(availableCategories.filter(c => c !== category)); setCategory(''); }}
                      className="px-2.5 rounded-brand text-[#C4553B] hover:bg-[#F7E7E2] transition-colors"
                      title="Remove selected category"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => setIsAddingCategory(true)}
                    className="px-2.5 rounded-brand text-warm-brown hover:bg-stone-100 transition-colors"
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
                  <button onClick={() => { setIsAddingCategory(false); setNewCategory(''); }} className="p-2 rounded-brand text-warm-brown hover:bg-stone-100 transition-colors"><X size={16} /></button>
                </div>
              )}
            </div>

            <div>
              <label className={fieldLabel}>Tags</label>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {tags.map(tag => (
                    <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 bg-stone-100 text-[color:var(--text-body)] rounded-full text-xs">
                      {tag}
                      <button onClick={() => removeTag(tag)} className="hover:text-[#C4553B] transition-colors"><X size={12} /></button>
                    </span>
                  ))}
                </div>
              )}
              <input type="text" value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={handleAddTag} placeholder="Type a tag, press Enter" className={fieldInput} />
            </div>

            <div>
              <label className={fieldLabel}>Schedule <span className="font-normal text-[color:var(--text-faint)] normal-case">(optional)</span></label>
              <input type="datetime-local" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className={fieldInput} />
            </div>
          </AdminCard>

          <AdminCard className="p-5 space-y-3">
            <AdminSectionLabel>Featured image</AdminSectionLabel>
            <ImageUpload value={featuredImage} onChange={setFeaturedImage} placeholder="Upload or paste URL" />
          </AdminCard>
        </div>
      </div>
    </div>
  );
};

export default AdminBlogPostEditor;
