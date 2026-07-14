"use client";
import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, FileText, Sparkles, X, ChevronDown } from 'lucide-react';
import { collection, onSnapshot, query, where, deleteDoc, doc, getDoc, limit } from 'firebase/firestore';
import { db, auth } from '../firebase';
import AdminBlogPostEditor from './AdminBlogPostEditor';
import { AdminPageHeader, AdminPrimaryButton, AdminSearchBar, AdminCard, AdminBadge, statusTone } from './admin/AdminUI';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope, hasPlatformOverride } from '../utils/tenant-scope';
import { sortByTime } from '../utils/query-helpers';
import { useAppStore } from '../store/useAppStore';
import { getPlanFeatures } from '../utils/plan-features';
import { authFetch } from '../utils/auth-fetch';
import { notifyError } from '../utils/notify';

const GOLD = 'var(--brand-color, #B8962E)';



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
 const { tenantPlan } = useAppStore();
 // Platform-context super admins (apex) get this feature; on a tenant subdomain
 // it's gated by the tenant's plan, even for a super admin.
 const canAutomate = hasPlatformOverride() ||
   (tenantPlan ? getPlanFeatures(tenantPlan).automatedBlog : false);
 const [showAutomation, setShowAutomation] = useState(false);
 // Detected once — the IANA zone the hour picker's options are labeled in.
 const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
 const [automation, setAutomation] = useState<{
   enabled: boolean;
   frequency: string;
   dayOfWeek: number;
   hour: number;
   timezone: string;
   topicHint: string;
   lastGeneratedAt: string | null;
   nextScheduledAt: string | null;
   totalGenerated: number;
 }>({
   enabled: false, frequency: 'weekly', dayOfWeek: 1,
   hour: 8, timezone: detectedTimezone, topicHint: '', lastGeneratedAt: null,
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

// status badge colors come from AdminUI's statusTone

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

 // New Post / Automate render in the in-content page header below (per the mockup).

 const handleSaveAutomation = async () => {
   setSavingAutomation(true);
   try {
     const resp = await authFetch('/api/blog/automate', {
       method: 'POST',
       body: JSON.stringify({
         enabled: automation.enabled,
         frequency: automation.frequency,
         dayOfWeek: automation.dayOfWeek,
         hour: automation.hour,
         timezone: automation.timezone,
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

 if (isEditorOpen) {
 return <AdminBlogPostEditor post={editingPost} onClose={() => setIsEditorOpen(false)} categories={categories} />;
 }

 return (
 <div className="w-full max-w-6xl mx-auto space-y-6">
 {errorMessage && (
 <div className="bg-red-50 text-red-600 p-3 rounded-brand text-sm font-medium border border-red-100">
 {errorMessage}
 </div>
 )}

 <AdminPageHeader
 eyebrow="Content"
 title={`${posts.length} post${posts.length === 1 ? '' : 's'}`}
 action={
 <div className="flex items-center gap-2.5">
 {canAutomate && (
 <button
 onClick={() => setShowAutomation(true)}
 className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-brand border border-stone-200 bg-white text-[13px] font-semibold text-earth hover:bg-stone-100 transition-colors"
 >
 <Sparkles size={15} className="text-gold" /> Automate
 </button>
 )}
 <AdminPrimaryButton onClick={handleNewPost} icon={<Plus size={16} />}>New post</AdminPrimaryButton>
 </div>
 }
 />

 <div className="flex flex-col sm:flex-row gap-3">
 <AdminSearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search posts…" className="flex-1" />
 <div className="relative sm:w-56 shrink-0">
 <select
 value={selectedCategory}
 onChange={(e) => setSelectedCategory(e.target.value)}
 className="w-full pl-4 pr-10 py-3 bg-white border border-stone-200 rounded-brand-lg text-sm text-earth appearance-none outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_35%,transparent)] focus:border-transparent transition-all"
 >
 {filterCategories.map(category => (
 <option key={category} value={category}>{category === 'All' ? 'All categories' : category}</option>
 ))}
 </select>
 <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--text-faint)] pointer-events-none" />
 </div>
 </div>

 <AdminCard>
 <div className="overflow-x-auto">
 <table className="w-full text-left border-collapse">
 <thead>
 <tr className="border-b border-stone-200">
 <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Title</th>
 <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Category</th>
 <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Status</th>
 <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Date</th>
 <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em] text-right">Actions</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-stone-200">
 {loading ? (
 <tr>
 <td colSpan={5} className="px-6 py-10 text-center text-warm-brown">
 <div className="flex items-center justify-center gap-2">
 <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin"></div>
 <span>Loading posts…</span>
 </div>
 </td>
 </tr>
 ) : filteredPosts.length === 0 ? (
 <tr>
 <td colSpan={5} className="px-6 py-14 text-center">
 <div className="flex flex-col items-center justify-center gap-1.5">
 <FileText size={30} className="text-stone-300 mb-1" />
 <p className="text-base text-earth font-display">No posts found</p>
 <p className="text-sm text-warm-brown">Get started by creating a new blog post.</p>
 </div>
 </td>
 </tr>
 ) : (
 filteredPosts.map((post) => (
 <tr key={post.id} className="hover:bg-stone-100/60 transition-colors group">
 <td className="px-6 py-3.5">
 <div className="flex items-center gap-2">
 <span className="text-sm font-semibold text-earth line-clamp-1">{post.title}</span>
 {post.isAiGenerated && <AdminBadge tone="gold">AI</AdminBadge>}
 </div>
 </td>
 <td className="px-6 py-3.5"><span className="text-sm text-warm-brown">{post.category}</span></td>
 <td className="px-6 py-3.5"><AdminBadge tone={statusTone(post.status)}>{post.status}</AdminBadge></td>
 <td className="px-6 py-3.5"><span className="text-sm text-warm-brown whitespace-nowrap">{formatDate(post.createdAt)}</span></td>
 <td className="px-6 py-3.5 text-right">
 <div className="flex items-center justify-end gap-1">
 <button onClick={() => handleEditPost(post)} className="p-2 rounded-brand text-[color:var(--text-faint)] hover:text-gold hover:bg-stone-100 transition-colors" title="Edit"><Edit2 size={16} /></button>
 <button onClick={() => setDeleteConfirmId(post.id)} className="p-2 rounded-brand text-[color:var(--text-faint)] hover:text-[#C4553B] hover:bg-[#F7E7E2] transition-colors" title="Delete"><Trash2 size={16} /></button>
 </div>
 </td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>
 </AdminCard>

 {/* Delete Confirmation Modal */}
 {deleteConfirmId && (
 <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
 <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 border border-stone-200 ">
 <h3 className="text-xl font-bold text-earth mb-2 font-display">Delete Post</h3>
 <p className="text-warm-brown mb-6">
 Are you sure you want to delete this blog post? This action cannot be undone.
 </p>
 <div className="flex justify-end gap-3">
 <button
 onClick={() => setDeleteConfirmId(null)}
 className="px-4 py-2 text-warm-brown hover:bg-stone-100 :bg-gray-800 rounded-xl font-medium transition-colors"
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
 <h3 className="font-black text-earth font-display">Automated Blog</h3>
 <p className="text-xs text-[color:var(--text-faint)] mt-0.5">
 AI generates SEO articles from your Knowledge Base
 </p>
 </div>
 <button onClick={() => setShowAutomation(false)}>
 <X size={20} className="text-[color:var(--text-faint)]" />
 </button>
 </div>

 {/* Enable toggle */}
 <div className="flex items-center justify-between py-3 border-b border-stone-200">
 <div>
 <p className="text-sm font-semibold text-[color:var(--text-body)]">Auto-publish articles</p>
 <p className="text-xs text-[color:var(--text-faint)]">Posts directly to your blog</p>
 </div>
 <button
 onClick={() => setAutomation(a => ({ ...a, enabled: !a.enabled }))}
 className={`w-12 h-6 rounded-full transition-colors relative ${automation.enabled ? 'bg-gold' : 'bg-stone-200'}`}
 >
 <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${automation.enabled ? 'left-7' : 'left-1'}`} />
 </button>
 </div>

 {/* Frequency */}
 <div>
 <label className="text-xs font-bold text-[color:var(--text-faint)] uppercase tracking-wider mb-2 block">
 Frequency
 </label>
 <div className="grid grid-cols-2 gap-2">
 {(['daily', 'weekly', 'biweekly', 'monthly'] as const).map(f => (
 <button key={f}
 onClick={() => setAutomation(a => ({ ...a, frequency: f }))}
 className={`py-2.5 rounded-xl text-sm font-semibold capitalize border transition-colors ${
 automation.frequency === f
 ? 'text-white border-transparent'
 : 'text-warm-brown border-stone-200 bg-white'
 }`}
 style={automation.frequency === f ? { backgroundColor: GOLD } : {}}
 >
 {f === 'biweekly' ? 'Every 2 weeks' : f.charAt(0).toUpperCase() + f.slice(1)}
 </button>
 ))}
 </div>
 </div>

 {/* Day of week (shown for weekly/biweekly) */}
 {(automation.frequency === 'weekly' || automation.frequency === 'biweekly') && (
 <div>
 <label className="text-xs font-bold text-[color:var(--text-faint)] uppercase tracking-wider mb-2 block">
 Day to post
 </label>
 <div className="flex gap-1.5 flex-wrap">
 {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day, i) => (
 <button key={day}
 onClick={() => setAutomation(a => ({ ...a, dayOfWeek: i }))}
 className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
 automation.dayOfWeek === i
 ? 'text-white border-transparent'
 : 'text-warm-brown border-stone-200'
 }`}
 style={automation.dayOfWeek === i ? { backgroundColor: GOLD } : {}}
 >
 {day}
 </button>
 ))}
 </div>
 </div>
 )}

 {/* Hour to post */}
 <div>
 <label className="text-xs font-bold text-[color:var(--text-faint)] uppercase tracking-wider mb-2 block">
 Time to post <span className="font-normal normal-case text-[color:var(--text-faint)]">— times shown for {automation.timezone} (your detected timezone)</span>
 </label>
 <div className="relative">
 <select
 value={automation.hour}
 onChange={e => setAutomation(a => ({ ...a, hour: Number(e.target.value) }))}
 className="w-full pl-4 pr-10 py-2.5 bg-white border border-stone-200 rounded-xl text-sm text-earth appearance-none outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_35%,transparent)] focus:border-transparent transition-all"
 >
 {Array.from({ length: 24 }, (_, h) => (
 <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
 ))}
 </select>
 <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--text-faint)] pointer-events-none" />
 </div>
 <p className="text-xs text-[color:var(--text-faint)] mt-1">
 Choose the hour in your timezone ({automation.timezone}). Posts generate around this time when the daily job runs — not to the exact minute.
 </p>
 </div>

 {/* Topic hint */}
 <div>
 <label className="text-xs font-bold text-[color:var(--text-faint)] uppercase tracking-wider mb-2 block">
 Topic focus <span className="font-normal normal-case">(optional)</span>
 </label>
 <input
 value={automation.topicHint}
 onChange={e => setAutomation(a => ({ ...a, topicHint: e.target.value }))}
 placeholder="e.g. discipleship, faith, church growth"
 className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gold"
 />
 <p className="text-xs text-[color:var(--text-faint)] mt-1">
 Guides the AI when choosing what to write about from your Knowledge Base.
 </p>
 </div>

 {/* Stats (if any posts generated) */}
 {automation.totalGenerated > 0 && (
 <div className="bg-[color-mix(in_srgb,var(--brand-color)_12%,white)] rounded-xl px-4 py-3 flex items-center justify-between">
 <span className="text-sm font-semibold text-gold">
 {automation.totalGenerated} article{automation.totalGenerated !== 1 ? 's' : ''} generated
 </span>
 {automation.nextScheduledAt && !isNaN(new Date(automation.nextScheduledAt as any).getTime()) && (
 <span className="text-xs text-warm-brown">
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
 className="flex-1 py-3 rounded-xl text-sm font-semibold border border-stone-200 text-[color:var(--text-body)] disabled:opacity-50"
 >
 {generatingNow ? 'Generating…' : '⚡ Generate Now'}
 </button>
 <button
 onClick={handleSaveAutomation}
 disabled={savingAutomation}
 className="flex-1 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50"
 style={{ backgroundColor: GOLD }}
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
