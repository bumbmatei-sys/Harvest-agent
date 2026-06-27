"use client";
import React, { useState, useEffect } from 'react';
import { Plus, Search, Edit2, Trash2, MoreVertical, Filter, FileText, Sparkles, X } from 'lucide-react';
import { collection, onSnapshot, query, where, deleteDoc, doc, getDoc, limit } from 'firebase/firestore';
import { db, auth } from '../firebase';
import AdminBlogPostEditor from './AdminBlogPostEditor';
import { useAdminHeader, HeaderActionButton } from './AdminScreenHeader';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope } from '../utils/tenant-scope';
import { sortByTime } from '../utils/query-helpers';
import { useAppStore } from '../store/useAppStore';
import { getPlanFeatures } from '../utils/plan-features';
import { authFetch } from '../utils/auth-fetch';
import { notifyError } from '../utils/notify';

const GOLD = '#B8962E';



interface BlogPost {
 id: string;
 title: string;
 category: string;
 status: 'published' | 'draft' | 'scheduled';
 createdAt: string;
 updatedAt: string;
 authorId: string;
 content: string;
 featuredImage?: string;
 tags?: string[];
 publishedAt?: string;
 isAiGenerated?: boolean;
}

const AdminBlog: React.FC = () => {
 const [posts, setPosts] = useState<BlogPost[]>([]);
 const [loading, setLoading] = useState(true);
 const [selectedCategory, setSelectedCategory] = useState<string>('All');
 const [searchQuery, setSearchQuery] = useState('');
 
 const [isEditorOpen, setIsEditorOpen] = useState(false);
 const [editingPost, setEditingPost] = useState<BlogPost | null>(null);
 const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
 const [errorMessage, setErrorMessage] = useState<string | null>(null);

 // ── Automated SEO blog ──
 const { tenantPlan, isSuperAdmin } = useAppStore();
 const canAutomate = isSuperAdmin ||
   (tenantPlan ? getPlanFeatures(tenantPlan).automatedBlog : false);
 const [showAutomation, setShowAutomation] = useState(false);
 const [automation, setAutomation] = useState<{
   enabled: boolean;
   frequency: string;
   dayOfWeek: number;
   hour: number;
   topicHint: string;
   lastGeneratedAt: string | null;
   nextScheduledAt: string | null;
   totalGenerated: number;
 }>({
   enabled: false, frequency: 'weekly', dayOfWeek: 1,
   hour: 8, topicHint: '', lastGeneratedAt: null,
   nextScheduledAt: null, totalGenerated: 0,
 });
 const [savingAutomation, setSavingAutomation] = useState(false);
 const [generatingNow, setGeneratingNow] = useState(false);

 useEffect(() => {
  let unsubscribe: (() => void) | null = null;
  let cancelled = false;
  (async () => {
    const tenantId = await getTenantScope();
    if (cancelled) return;
    // Single-field filter only (tenantId); sort client-side to avoid a composite index.
    const q = tenantId
      ? query(collection(db, 'blog_posts'), where('tenantId', '==', tenantId), limit(100))
      : query(collection(db, 'blog_posts'), limit(100));
    unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedPosts = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as BlogPost[];
      setPosts(sortByTime(fetchedPosts, 'createdAt', 'desc'));
      setLoading(false);
    }, (error) => {
      try { handleFirestoreError(error, OperationType.GET, `blog_posts`); } catch (e) { console.error(e); }
      setLoading(false);
    });
  })();
  return () => { cancelled = true; if (unsubscribe) unsubscribe(); };
 }, []);

 // Load automation settings (only for plans that support it).
 useEffect(() => {
   if (!canAutomate) return;
   let cancelled = false;
   (async () => {
     try {
       const resp = await authFetch('/api/blog/automate');
       if (resp.ok && !cancelled) {
         const data = await resp.json();
         setAutomation(a => ({ ...a, ...data }));
       }
     } catch {}
   })();
   return () => { cancelled = true; };
 }, [canAutomate]);

 const categories = Array.from(new Set(posts.map(post => post.category)));
 const filterCategories = ['All', ...categories];

 const filteredPosts = posts.filter(post => {
 const matchesCategory = selectedCategory === 'All' || post.category === selectedCategory;
 const matchesSearch = post.title.toLowerCase().includes(searchQuery.toLowerCase());
 return matchesCategory && matchesSearch;
 });

 const getStatusColor = (status: string) => {
 switch (status) {
 case 'published': return 'bg-green-100 text-green-800 ';
 case 'draft': return 'bg-gray-100 text-gray-800 ';
 case 'scheduled': return 'bg-blue-100 text-blue-800 ';
 default: return 'bg-gray-100 text-gray-800 ';
 }
 };

 const formatDate = (dateString: string) => {
 try {
 const date = new Date(dateString);
 return new Intl.DateTimeFormat('en-US', {
 year: 'numeric',
 month: 'short',
 day: 'numeric'
 }).format(date);
 } catch (e) {
 return dateString;
 }
 };

 const handleNewPost = () => {
 setEditingPost(null);
 setIsEditorOpen(true);
 };

 const { setHeaderAction } = useAdminHeader();
 useEffect(() => {
   setHeaderAction(
     <div className="flex items-center gap-2">
       {canAutomate && (
         <button
           onClick={() => setShowAutomation(true)}
           className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50"
         >
           <Sparkles size={14} style={{ color: GOLD }} /> Automate
         </button>
       )}
       <HeaderActionButton label="New Post" onClick={() => handleNewPost()} />
     </div>
   );
   return () => setHeaderAction(null);
 }, [setHeaderAction, canAutomate]);

 const handleSaveAutomation = async () => {
   setSavingAutomation(true);
   try {
     const resp = await authFetch('/api/blog/automate', {
       method: 'POST',
       body: JSON.stringify({
         enabled: automation.enabled,
         frequency: automation.frequency,
         dayOfWeek: automation.dayOfWeek,
         hour: 8, // default to 8 AM UTC
         topicHint: automation.topicHint,
       }),
     });
     if (!resp.ok) throw new Error('Failed to save');
     setShowAutomation(false);
   } catch (e) {
     notifyError('Failed to save automation settings', e);
   } finally {
     setSavingAutomation(false);
   }
 };

 const handleGenerateNow = async () => {
   setGeneratingNow(true);
   try {
     const resp = await authFetch('/api/blog/generate', {
       method: 'POST',
       body: JSON.stringify({ topicHint: automation.topicHint }),
     });
     const data = await resp.json();
     if (!resp.ok) throw new Error(data.error || 'Failed to generate');
     // The existing onSnapshot listener will pick up the new post automatically.
     setShowAutomation(false);
   } catch (e) {
     notifyError('Failed to generate article', e);
   } finally {
     setGeneratingNow(false);
   }
 };

 const handleEditPost = (post: BlogPost) => {
 setEditingPost(post);
 setIsEditorOpen(true);
 };

 const handleDeletePost = async (id: string) => {
 try {
   const tenantId = await getTenantScope();
   if (tenantId) {
     const docSnap = await getDoc(doc(db, 'blog_posts', id));
     if (docSnap.exists() && docSnap.data().tenantId && docSnap.data().tenantId !== tenantId) {
       console.error('Tenant mismatch — cannot modify another tenant\'s document');
       return;
     }
   }
   await deleteDoc(doc(db, 'blog_posts', id));
 setDeleteConfirmId(null);
 } catch (error) {
 try { handleFirestoreError(error, OperationType.DELETE, `blog_posts/${id}`); } catch (e) { console.error(e); }
 setErrorMessage("Failed to delete post. Please try again.");
 setTimeout(() => setErrorMessage(null), 3000);
 }
 };

 return (
 <div className="space-y-6 lg:max-w-5xl lg:mx-auto w-full">
 {errorMessage && (
 <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-medium border border-red-100">
 {errorMessage}
 </div>
 )}
 {isEditorOpen && (
 <AdminBlogPostEditor 
 post={editingPost} 
 onClose={() => setIsEditorOpen(false)} 
 categories={categories}
 />
 )}

 <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
 {/* Filters Bar */}
 <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row gap-4">
 <div className="relative flex-1">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
 <input 
 type="text" 
 placeholder="Search posts..." 
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#d4a017] focus:border-transparent outline-none text-gray-900 transition-all"
 />
 </div>
 <div className="relative min-w-[160px]">
 <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
 <select 
 value={selectedCategory}
 onChange={(e) => setSelectedCategory(e.target.value)}
 className="w-full pl-10 pr-8 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#d4a017] focus:border-transparent outline-none text-gray-900 appearance-none transition-all"
 >
 {filterCategories.map(category => (
 <option key={category} value={category}>{category}</option>
 ))}
 </select>
 </div>
 </div>

 {/* Table */}
 <div className="overflow-x-auto">
 <table className="w-full text-left border-collapse">
 <thead>
 <tr className="bg-gray-50/50 border-b border-gray-100 ">
 <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Title</th>
 <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Category</th>
 <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
 <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
 <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">Actions</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-gray-100 ">
 {loading ? (
 <tr>
 <td colSpan={5} className="px-6 py-8 text-center text-gray-500 ">
 <div className="flex items-center justify-center gap-2">
 <div className="w-4 h-4 border-2 border-[#d4a017] border-t-transparent rounded-full animate-spin"></div>
 <span>Loading posts...</span>
 </div>
 </td>
 </tr>
 ) : filteredPosts.length === 0 ? (
 <tr>
 <td colSpan={5} className="px-6 py-12 text-center text-gray-500 ">
 <div className="flex flex-col items-center justify-center gap-2">
 <FileText size={32} className="text-gray-300 mb-2" />
 <p className="text-base font-medium text-gray-900 ">No posts found</p>
 <p className="text-sm">Get started by creating a new blog post.</p>
 </div>
 </td>
 </tr>
 ) : (
 filteredPosts.map((post) => (
 <tr key={post.id} className="hover:bg-gray-50 :bg-[#1a1d27] transition-colors group">
 <td className="px-6 py-4">
 <div className="flex items-center gap-2">
 <p className="text-sm font-medium text-gray-900 line-clamp-1">{post.title}</p>
 {post.isAiGenerated && (
 <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
 style={{ backgroundColor: '#FBF3E4', color: '#B8962E' }}>
 AI
 </span>
 )}
 </div>
 </td>
 <td className="px-6 py-4">
 <span className="text-sm text-gray-600 ">{post.category}</span>
 </td>
 <td className="px-6 py-4">
 <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium capitalize ${getStatusColor(post.status)}`}>
 {post.status}
 </span>
 </td>
 <td className="px-6 py-4">
 <span className="text-sm text-gray-500 whitespace-nowrap">
 {formatDate(post.createdAt)}
 </span>
 </td>
 <td className="px-6 py-4 text-right">
 <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
 <button 
 onClick={() => handleEditPost(post)}
 className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 :bg-blue-900/30 rounded-lg transition-colors"
 >
 <Edit2 size={16} />
 </button>
 <button 
 onClick={() => setDeleteConfirmId(post.id)}
 className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 :bg-red-900/30 rounded-lg transition-colors"
 >
 <Trash2 size={16} />
 </button>
 </div>
 </td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>
 </div>

 {/* Delete Confirmation Modal */}
 {deleteConfirmId && (
 <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
 <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 border border-gray-100 ">
 <h3 className="text-xl font-bold text-gray-900 mb-2">Delete Post</h3>
 <p className="text-gray-500 mb-6">
 Are you sure you want to delete this blog post? This action cannot be undone.
 </p>
 <div className="flex justify-end gap-3">
 <button
 onClick={() => setDeleteConfirmId(null)}
 className="px-4 py-2 text-gray-600 hover:bg-gray-100 :bg-gray-800 rounded-xl font-medium transition-colors"
 >
 Cancel
 </button>
 <button
 onClick={() => handleDeletePost(deleteConfirmId)}
 className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-medium transition-colors"
 >
 Delete
 </button>
 </div>
 </div>
 </div>
 )}

 {/* Automated Blog Settings */}
 {showAutomation && (
 <div className="fixed inset-0 z-[200] bg-black/50 flex items-end">
 <div className="bg-white rounded-t-3xl w-full max-w-lg mx-auto p-6 space-y-5"
 style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom))' }}>

 {/* Header */}
 <div className="flex items-center justify-between">
 <div>
 <h3 className="font-black text-gray-900">Automated Blog</h3>
 <p className="text-xs text-gray-400 mt-0.5">
 AI generates SEO articles from your Knowledge Base
 </p>
 </div>
 <button onClick={() => setShowAutomation(false)}>
 <X size={20} className="text-gray-400" />
 </button>
 </div>

 {/* Enable toggle */}
 <div className="flex items-center justify-between py-3 border-b border-gray-100">
 <div>
 <p className="text-sm font-semibold text-gray-800">Auto-publish articles</p>
 <p className="text-xs text-gray-400">Posts directly to your blog</p>
 </div>
 <button
 onClick={() => setAutomation(a => ({ ...a, enabled: !a.enabled }))}
 className={`w-12 h-6 rounded-full transition-colors relative ${automation.enabled ? 'bg-[#B8962E]' : 'bg-gray-200'}`}
 >
 <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${automation.enabled ? 'left-7' : 'left-1'}`} />
 </button>
 </div>

 {/* Frequency */}
 <div>
 <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">
 Frequency
 </label>
 <div className="grid grid-cols-2 gap-2">
 {(['daily', 'weekly', 'biweekly', 'monthly'] as const).map(f => (
 <button key={f}
 onClick={() => setAutomation(a => ({ ...a, frequency: f }))}
 className={`py-2.5 rounded-xl text-sm font-semibold capitalize border transition-colors ${
 automation.frequency === f
 ? 'text-white border-transparent'
 : 'text-gray-600 border-gray-200 bg-white'
 }`}
 style={automation.frequency === f ? { backgroundColor: '#B8962E' } : {}}
 >
 {f === 'biweekly' ? 'Every 2 weeks' : f.charAt(0).toUpperCase() + f.slice(1)}
 </button>
 ))}
 </div>
 </div>

 {/* Day of week (shown for weekly/biweekly) */}
 {(automation.frequency === 'weekly' || automation.frequency === 'biweekly') && (
 <div>
 <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">
 Day to post
 </label>
 <div className="flex gap-1.5 flex-wrap">
 {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day, i) => (
 <button key={day}
 onClick={() => setAutomation(a => ({ ...a, dayOfWeek: i }))}
 className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
 automation.dayOfWeek === i
 ? 'text-white border-transparent'
 : 'text-gray-600 border-gray-200'
 }`}
 style={automation.dayOfWeek === i ? { backgroundColor: '#B8962E' } : {}}
 >
 {day}
 </button>
 ))}
 </div>
 </div>
 )}

 {/* Topic hint */}
 <div>
 <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">
 Topic focus <span className="font-normal normal-case">(optional)</span>
 </label>
 <input
 value={automation.topicHint}
 onChange={e => setAutomation(a => ({ ...a, topicHint: e.target.value }))}
 placeholder="e.g. discipleship, faith, church growth"
 className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#B8962E]"
 />
 <p className="text-xs text-gray-400 mt-1">
 Guides the AI when choosing what to write about from your Knowledge Base.
 </p>
 </div>

 {/* Stats (if any posts generated) */}
 {automation.totalGenerated > 0 && (
 <div className="bg-[#FBF3E4] rounded-xl px-4 py-3 flex items-center justify-between">
 <span className="text-sm font-semibold text-[#B8962E]">
 {automation.totalGenerated} article{automation.totalGenerated !== 1 ? 's' : ''} generated
 </span>
 {automation.nextScheduledAt && !isNaN(new Date(automation.nextScheduledAt as any).getTime()) && (
 <span className="text-xs text-gray-500">
 Next: {new Date(automation.nextScheduledAt as any).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
 </span>
 )}
 </div>
 )}

 {/* Actions */}
 <div className="flex gap-3 pt-1">
 <button
 onClick={handleGenerateNow}
 disabled={generatingNow}
 className="flex-1 py-3 rounded-xl text-sm font-semibold border border-gray-200 text-gray-700 disabled:opacity-50"
 >
 {generatingNow ? 'Generating…' : '⚡ Generate Now'}
 </button>
 <button
 onClick={handleSaveAutomation}
 disabled={savingAutomation}
 className="flex-1 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50"
 style={{ backgroundColor: '#B8962E' }}
 >
 {savingAutomation ? 'Saving…' : 'Save Settings'}
 </button>
 </div>

 </div>
 </div>
 )}
 </div>
 );
};

export default AdminBlog;
