"use client";
import React, { useState, useEffect } from 'react';
import { Plus, Search, Edit2, Trash2, MoreVertical, Filter, FileText } from 'lucide-react';
import { collection, onSnapshot, query, where, orderBy, deleteDoc, doc, limit } from 'firebase/firestore';
import { db, auth } from '../firebase';
import AdminBlogPostEditor from './AdminBlogPostEditor';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope } from '../utils/tenant-scope';



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

 useEffect(() => {
 let unsubscribe: (() => void) | null = null;
 (async () => {
   const tenantId = await getTenantScope();
   const q = tenantId
     ? query(collection(db, 'blog_posts'), where('tenantId', '==', tenantId), orderBy('createdAt', 'desc'), limit(50))
     : query(collection(db, 'blog_posts'), orderBy('createdAt', 'desc'), limit(50));
   unsubscribe = onSnapshot(q, (snapshot) => {
     const fetchedPosts = snapshot.docs.map(doc => ({
       id: doc.id,
       ...doc.data()
     })) as BlogPost[];
     setPosts(fetchedPosts);
     setLoading(false);
   }, (error) => {
     try { handleFirestoreError(error, OperationType.GET, `blog_posts`); } catch (e) { console.error(e); }
     setLoading(false);
   });
 })();
 return () => { if (unsubscribe) unsubscribe(); };
 }, []);

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

 const handleEditPost = (post: BlogPost) => {
 setEditingPost(post);
 setIsEditorOpen(true);
 };

 const handleDeletePost = async (id: string) => {
 try {
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
 <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
 <div>
 <h2 className="text-2xl font-bold text-gray-900 mb-1">Blog Posts</h2>
 <p className="text-sm text-gray-500 ">Manage your blog content and publications.</p>
 </div>
 <button 
 onClick={handleNewPost}
 className="bg-[#d4a017] hover:bg-[#b8860b] text-white px-4 py-2.5 rounded-xl font-medium flex items-center gap-2 transition-colors shadow-sm w-full sm:w-auto justify-center"
 >
 <Plus size={18} />
 <span>New Post</span>
 </button>
 </div>

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
 <p className="text-sm font-medium text-gray-900 line-clamp-1">{post.title}</p>
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
 </div>
 );
};

export default AdminBlog;
