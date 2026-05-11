"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { ArrowLeft, Upload, X, Plus, Calendar, Save, Send, Trash2 } from 'lucide-react';
import { collection, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { ImageUpload } from './ImageUpload';
import RichTextEditor from './RichTextEditor';


enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo?: any[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
      isAnonymous: auth?.currentUser?.isAnonymous,
      tenantId: auth?.currentUser?.tenantId,
      providerInfo: auth?.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

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

 const transformImageUrl = (url: string) => {
 if (!url) return url;
 // Transform GitHub blob/raw URLs to raw URLs
 if (url.includes('github.com') && (url.includes('/blob/') || url.includes('/raw/'))) {
 return url.replace('github.com', 'raw.githubusercontent.com')
 .replace('/blob/', '/')
 .replace('/raw/', '/');
 }
 return url;
 };

 const handleSave = async (status: 'published' | 'draft' | 'scheduled') => {
 if (!title.trim()) {
 setError('Title is required');
 return;
 }
 if (!category) {
 setError('Category is required');
 return;
 }
 
 if (!content.trim() || content === '<p></p>') {
 setError('Content is required');
 return;
 }
 if (status === 'scheduled' && !scheduledDate) {
 setError('Scheduled date is required for scheduled posts');
 return;
 }

 setIsSaving(true);
 setError('');

 try {
 const postData = {
 title: title.trim(),
 category,
 status,
 content: content,
 featuredImage: featuredImage.trim() || null,
 tags,
 authorId: auth.currentUser?.uid,
 updatedAt: new Date().toISOString(),
 ...(status === 'scheduled' ? { publishedAt: new Date(scheduledDate).toISOString() } : {}),
 ...(status === 'published' && !post?.publishedAt ? { publishedAt: new Date().toISOString() } : {})
 };

 if (post?.id) {
 await updateDoc(doc(db, 'blog_posts', post.id), postData);
 } else {
 await addDoc(collection(db, 'blog_posts'), {
 ...postData,
 createdAt: new Date().toISOString(),
 });
 }
 onClose();
 } catch (err: any) {
 handleFirestoreError(err, OperationType.WRITE, `blog_posts`);
 setError(err.message || 'Failed to save post');
 } finally {
 setIsSaving(false);
 }
 };

 return (
 <div className="fixed inset-0 z-50 flex flex-col bg-[#f8f9fa] ">
 {/* Header */}
 <div className="bg-white px-4 py-3 flex items-center justify-between shadow-sm z-10">
 <div className="flex items-center gap-3">
 <button 
 onClick={onClose}
 className="p-2 -ml-2 text-gray-500 hover:text-gray-900 :text-white transition-colors rounded-full hover:bg-gray-100 :bg-gray-800"
 >
 <ArrowLeft size={20} />
 </button>
 <h1 className="text-lg font-bold text-gray-900 ">
 {post ? 'Edit Post' : 'New Post'}
 </h1>
 </div>
 </div>

 {/* Main Content */}
 <div className="flex-1 overflow-y-auto p-4">
 <div className="max-w-3xl mx-auto space-y-4">
 {error && (
 <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm">
 {error}
 </div>
 )}

 {/* Title */}
 <div>
 <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
 <input 
 type="text" 
 value={title}
 onChange={(e) => setTitle(e.target.value)}
 placeholder="Enter post title"
 className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-gray-900 focus:ring-2 focus:ring-[#d4a017] focus:border-transparent outline-none transition-all text-base font-medium"
 />
 </div>

 {/* Category */}
 <div className="bg-white p-3 rounded-lg border border-gray-200 space-y-2">
 <label className="block text-sm font-medium text-gray-700 ">Category</label>
 
 {!isAddingCategory ? (
 <div className="flex gap-2">
 <select 
 value={category}
 onChange={(e) => setCategory(e.target.value)}
 className="flex-1 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:ring-2 focus:ring-[#d4a017] focus:border-transparent outline-none transition-all text-sm"
 >
 <option value="" disabled>Select a category</option>
 {availableCategories.map(cat => (
 <option key={cat} value={cat}>{cat}</option>
 ))}
 </select>
 {category && (
 <button 
 onClick={() => {
 setAvailableCategories(availableCategories.filter(c => c !== category));
 setCategory('');
 }}
 className="px-2.5 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 :bg-red-900/50 transition-colors flex items-center justify-center"
 title="Delete selected category"
 >
 <Trash2 size={16} />
 </button>
 )}
 <button 
 onClick={() => setIsAddingCategory(true)}
 className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 :bg-gray-700 transition-colors flex items-center gap-1.5 text-sm"
 >
 <Plus size={16} />
 <span className="hidden sm:inline">New</span>
 </button>
 </div>
 ) : (
 <div className="flex items-center gap-1.5 w-full">
 <input 
 type="text" 
 value={newCategory}
 onChange={(e) => setNewCategory(e.target.value)}
 placeholder="Category name"
 className="flex-1 min-w-0 w-full px-2 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:ring-2 focus:ring-[#d4a017] focus:border-transparent outline-none transition-all text-sm"
 autoFocus
 />
 <button 
 onClick={handleAddCategory}
 disabled={!newCategory.trim()}
 className="flex-shrink-0 px-2.5 py-1.5 bg-[#d4a017] text-white rounded-lg hover:bg-[#b8860b] transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
 >
 Add
 </button>
 <button 
 onClick={() => { setIsAddingCategory(false); setNewCategory(''); }}
 className="flex-shrink-0 p-1.5 text-gray-500 hover:text-gray-700 :text-gray-200 rounded-lg hover:bg-gray-100 :bg-gray-800 transition-colors"
 >
 <X size={16} />
 </button>
 </div>
 )}
 </div>

 {/* Featured Image */}
 <div className="bg-white p-3 rounded-lg border border-gray-200 space-y-2">
 <label className="block text-sm font-medium text-gray-700 ">Featured Image</label>
 <ImageUpload value={featuredImage} onChange={setFeaturedImage} placeholder="Upload or paste image URL" />
 </div>

 {/* Tags */}
 <div className="bg-white p-3 rounded-lg border border-gray-200 space-y-2">
 <label className="block text-sm font-medium text-gray-700 ">Tags</label>
 <div className="flex flex-wrap gap-1.5 mb-2">
 {tags.map(tag => (
 <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-gray-100 text-gray-700 rounded-full text-xs">
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
 className="w-full px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:ring-2 focus:ring-[#d4a017] focus:border-transparent outline-none transition-all text-sm"
 />
 </div>

 {/* Content */}
 <div className="space-y-1">
 <label className="block text-sm font-medium text-gray-700 mb-2">Content</label>
 <RichTextEditor content={content} onChange={setContent} />
 </div>
 </div>
 </div>

 {/* Bottom Action Bar */}
 <div className="bg-white border-t border-gray-100 p-3 pb-safe w-full z-20 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
 <div className="max-w-3xl mx-auto flex flex-col sm:flex-row gap-2">
 <button 
 onClick={() => handleSave('draft')}
 disabled={isSaving}
 className="flex-1 py-2 px-3 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 :bg-gray-700 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
 >
 <Save size={16} />
 <span>Save Draft</span>
 </button>
 
 <div className="flex-1 flex gap-2">
 <div className="relative flex-1">
 <input 
 type="datetime-local" 
 value={scheduledDate}
 onChange={(e) => setScheduledDate(e.target.value)}
 className="w-full h-full absolute inset-0 opacity-0 cursor-pointer"
 />
 <button 
 onClick={() => {
 if (scheduledDate) handleSave('scheduled');
 }}
 disabled={isSaving}
 className={`w-full py-2 px-3 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 ${
 scheduledDate 
 ? 'bg-blue-100 text-blue-700 hover:bg-blue-200 :bg-blue-900/50' 
 : 'bg-gray-100 text-gray-700 hover:bg-gray-200 :bg-gray-700'
 }`}
 >
 <Calendar size={16} />
 <span className="truncate">{scheduledDate ? new Date(scheduledDate).toLocaleString() : 'Schedule'}</span>
 </button>
 </div>
 
 <button 
 onClick={() => handleSave('published')}
 disabled={isSaving}
 className="flex-[1.5] py-2 px-3 bg-[#d4a017] text-white rounded-lg text-sm font-medium hover:bg-[#b8860b] transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 shadow-sm"
 >
 <Send size={16} />
 <span>Publish Now</span>
 </button>
 </div>
 </div>
 </div>
 </div>
 );
};

export default AdminBlogPostEditor;
