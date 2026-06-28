"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, ArrowRight, X, Plus, Calendar, Save, Send, Trash2 } from 'lucide-react';
import { collection, addDoc, updateDoc, doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { ImageUpload } from './ImageUpload';
import RichTextEditor from './RichTextEditor';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope, getWriteTenantScope } from '../utils/tenant-scope';

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

const AdminBlogPostEditor: React.FC<AdminBlogPostEditorProps> = ({ post, onClose, categories }) => {
  const [step, setStep] = useState<'write' | 'publish'>('write');
  const [title, setTitle] = useState(post?.title || '');
  const [category, setCategory] = useState(post?.category || '');
  const [newCategory, setNewCategory] = useState('');
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [featuredImage, setFeaturedImage] = useState(post?.featuredImage || '');
  const [content, setContent] = useState(post?.content || '');
  const [tags, setTags] = useState<string[]>(post?.tags || []);
  const [newTag, setNewTag] = useState('');
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

  const handleNext = () => {
    if (!title.trim()) {
      setError('Please add a title before continuing');
      return;
    }
    const strippedContent = content.replace(/<[^>]*>/g, '').trim();
    if (!strippedContent) {
      setError('Please write some content before continuing');
      return;
    }
    setError('');
    setStep('publish');
  };

  const handleSave = async (status: 'published' | 'draft' | 'scheduled') => {
    const missing: string[] = [];
    if (!title.trim()) missing.push('Title');
    if (!category) missing.push('Category');
    const strippedContent = content.replace(/<[^>]*>/g, '').trim();
    if (!strippedContent) missing.push('Content');
    if (status === 'scheduled' && !scheduledDate) missing.push('Scheduled date');
    if (status === 'scheduled' && scheduledDate && new Date(scheduledDate) <= new Date()) missing.push('Scheduled date must be in the future');
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
        status,
        content,
        featuredImage: featuredImage.trim() || null,
        tags,
        authorId: auth.currentUser?.uid,
        updatedAt: new Date().toISOString(),
        ...(status === 'scheduled' ? { publishedAt: new Date(scheduledDate).toISOString() } : {}),
        ...(status === 'published' && !post?.publishedAt ? { publishedAt: new Date().toISOString() } : {})
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

  // ─── Step 1: Write ─────────────────────────────────────────────
  if (step === 'write') {
    return (
      <div className="fixed inset-0 z-[200] flex flex-col bg-white">
        {/* Header */}
        <div className="px-4 py-3 flex items-center justify-between z-10">
          <button
            onClick={onClose}
            className="p-2 -ml-2 text-gray-400 hover:text-gray-700 transition-colors rounded-full hover:bg-gray-100"
          >
            <ArrowLeft size={20} />
          </button>
          <button
            onClick={handleNext}
            className="flex items-center gap-1.5 px-4 py-2 bg-gold text-white rounded-lg text-sm font-medium hover:bg-[#b8860b] transition-colors shadow-sm"
          >
            <span>Next</span>
            <ArrowRight size={16} />
          </button>
        </div>

        {/* Writing area */}
        <div className="flex-1 overflow-y-auto px-4 pb-20">
          <div className="max-w-3xl mx-auto">
            {error && (
              <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm mb-4">
                {error}
              </div>
            )}

            {/* Title — plain, note-taking style */}
            <input
              type="text"
              value={title}
              onChange={(e) => { setTitle(e.target.value); setError(''); }}
              placeholder="Untitled"
              className="w-full text-3xl sm:text-4xl font-bold text-gray-900 placeholder-gray-300 border-none outline-none bg-transparent py-4 leading-tight"
              autoFocus
            />

            {/* Divider */}
            <div className="h-px bg-gray-100 mb-4" />

            {/* Content editor — no toolbar, use "/" for commands */}
            <RichTextEditor
              content={content}
              onChange={(c) => { setContent(c); setError(''); }}
              minHeight="50vh"
              placeholder="Start writing... Type '/' for formatting options"
            />
          </div>
        </div>

        {/* Hint bar — above admin nav bar */}
        <div className="fixed bottom-0 left-0 right-0 bg-gray-50 border-t border-gray-100 px-4 pt-2.5 pb-20 text-center z-20">
          <span className="text-xs text-gray-400">
            Type <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-gray-500 font-mono">/</kbd> for formatting commands
          </span>
        </div>
      </div>
    );
  }

  // ─── Step 2: Publish ───────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-[#f8f9fa]">
      {/* Header */}
      <div className="bg-white px-4 py-3 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setStep('write')}
            className="p-2 -ml-2 text-gray-500 hover:text-gray-900 transition-colors rounded-full hover:bg-gray-100"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-lg font-bold text-gray-900">
            Publish
          </h1>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4" style={{ paddingBottom: 'max(11rem, calc(7rem + env(safe-area-inset-bottom)))' }}>
        <div className="max-w-2xl mx-auto space-y-5">
          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm">
              {error}
            </div>
          )}

          {/* Preview card */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Preview</p>
            <h3 className="text-lg font-bold text-gray-900 mb-1">{title || 'Untitled'}</h3>
            <p className="text-sm text-gray-500 line-clamp-2">
              {content.replace(/<[^>]*>/g, '').slice(0, 150) || 'No content'}
            </p>
          </div>

          {/* Category */}
          <div className="bg-white p-4 rounded-xl border border-gray-200 space-y-2">
            <label className="block text-sm font-medium text-gray-700">Category</label>
            {!isAddingCategory ? (
              <div className="flex gap-2">
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:ring-2 focus:ring-gold focus:border-transparent outline-none text-sm"
                >
                  <option value="" disabled>Select a category</option>
                  {availableCategories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                {category && (
                  <button
                    onClick={() => { setAvailableCategories(availableCategories.filter(c => c !== category)); setCategory(''); }}
                    className="px-2.5 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
                    title="Delete selected category"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
                <button
                  onClick={() => setIsAddingCategory(true)}
                  className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-1.5 text-sm"
                >
                  <Plus size={16} />
                  <span className="hidden sm:inline">New</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="Category name"
                  className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:ring-2 focus:ring-gold focus:border-transparent outline-none text-sm"
                  autoFocus
                />
                <button
                  onClick={handleAddCategory}
                  disabled={!newCategory.trim()}
                  className="px-3 py-2 bg-gold text-white rounded-lg hover:bg-[#b8860b] transition-colors disabled:opacity-50 text-sm font-medium"
                >
                  Add
                </button>
                <button
                  onClick={() => { setIsAddingCategory(false); setNewCategory(''); }}
                  className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
            )}
          </div>

          {/* Featured Image */}
          <div className="bg-white p-4 rounded-xl border border-gray-200 space-y-2">
            <label className="block text-sm font-medium text-gray-700">Featured Image</label>
            <ImageUpload value={featuredImage} onChange={setFeaturedImage} placeholder="Upload or paste image URL" />
          </div>

          {/* Tags */}
          <div className="bg-white p-4 rounded-xl border border-gray-200 space-y-2">
            <label className="block text-sm font-medium text-gray-700">Tags</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {tags.map(tag => (
                <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-100 text-gray-700 rounded-full text-xs">
                  {tag}
                  <button onClick={() => removeTag(tag)} className="hover:text-red-500 transition-colors">
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <input
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={handleAddTag}
              placeholder="Type a tag and press Enter"
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:ring-2 focus:ring-gold focus:border-transparent outline-none text-sm"
            />
          </div>

          {/* Schedule */}
          <div className="bg-white p-4 rounded-xl border border-gray-200 space-y-2">
            <label className="block text-sm font-medium text-gray-700">Schedule</label>
            <input
              type="datetime-local"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:ring-2 focus:ring-gold focus:border-transparent outline-none text-sm"
            />
          </div>
        </div>
      </div>

      {/* Bottom action bar — fixed above admin nav bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 w-full z-20 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] px-3 pt-3 pb-20">
        <div className="max-w-2xl mx-auto flex flex-col sm:flex-row gap-2">
          <button
            onClick={() => handleSave('draft')}
            disabled={isSaving}
            className="flex-1 py-2.5 px-3 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <Save size={16} />
            <span>Save Draft</span>
          </button>

          {scheduledDate ? (
            <button
              onClick={() => handleSave('scheduled')}
              disabled={isSaving}
              className="flex-1 py-2.5 px-3 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-200 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Calendar size={16} />
              <span>Schedule</span>
            </button>
          ) : null}

          <button
            onClick={() => handleSave('published')}
            disabled={isSaving}
            className="flex-[1.5] py-2.5 px-3 bg-gold text-white rounded-lg text-sm font-medium hover:bg-[#b8860b] transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 shadow-sm"
          >
            <Send size={16} />
            <span>Publish Now</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminBlogPostEditor;
