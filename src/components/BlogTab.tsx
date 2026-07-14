"use client";
import React, { useState, useEffect, useMemo } from 'react';
import { sanitizeHtml } from '../utils/sanitize';
import Image from 'next/image';
import { collection, query, where, onSnapshot, doc, updateDoc, arrayUnion, arrayRemove, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { FileText, Calendar, Tag, ArrowLeft, Search } from 'lucide-react';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope } from '../utils/tenant-scope';
import { usePublicShareUrl } from '../utils/share-url';
import ShareButton from './ShareButton';
import SaveButton from './SaveButton';

/** Plain-text snippet from a post's HTML content, for the Saved list. */
const toSnippet = (html: string, len = 140): string => {
  const text = (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > len ? `${text.slice(0, len)}…` : text;
};



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

interface BlogTabProps {
 onOpenArticle?: (post: BlogPost) => void;
 initialPost?: BlogPost;
 onBack?: () => void;
 isFullScreen?: boolean;
}

const BlogTab: React.FC<BlogTabProps> = ({ onOpenArticle, initialPost, onBack, isFullScreen }) => {
 const [posts, setPosts] = useState<BlogPost[]>([]);
 const [loading, setLoading] = useState(true);
 const [selectedCategory, setSelectedCategory] = useState<string>('All');
 const [searchQuery, setSearchQuery] = useState('');
 const [errorMessage, setErrorMessage] = useState<string | null>(null);

 const [selectedPost, setSelectedPost] = useState<BlogPost | null>(initialPost || null);
 const shareUrl = usePublicShareUrl(selectedPost ? `/blog/${selectedPost.id}` : null);

 useEffect(() => {
  let unsubscribe: (() => void) | null = null;
  let cancelled = false;
  (async () => {
    // Only fetch published posts
    const tenantId = await getTenantScope();
    if (cancelled) return;
    // Single-field filter only (status); tenant filter applied client-side.
    const q = tenantId
      ? query(collection(db, 'blog_posts'), where('tenantId', '==', tenantId))
      : query(collection(db, 'blog_posts'), where('status', '==', 'published'));

    unsubscribe = onSnapshot(q, (snapshot) => {
  let fetchedPosts = snapshot.docs.map(doc => ({
  id: doc.id,
  ...doc.data()
  })) as BlogPost[];
  fetchedPosts = fetchedPosts.filter(p => (p as any).status === 'published');
 
  // Filter out scheduled posts that haven't reached their publish date yet
  const now = new Date().toISOString();
  const visiblePosts = fetchedPosts.filter(post => 
  !post.publishedAt || post.publishedAt <= now
  );
 
  // Sort by publishedAt (descending), fallback to createdAt
  visiblePosts.sort((a, b) => {
  const dateA = a.publishedAt || a.createdAt;
  const dateB = b.publishedAt || b.createdAt;
  return new Date(dateB).getTime() - new Date(dateA).getTime();
  });
 
  setPosts(visiblePosts);
  setLoading(false);
  }, (error) => {
  try { handleFirestoreError(error, OperationType.GET, `blog_posts`); } catch (e) { console.error(e); }
  setLoading(false);
    });
  })();

  return () => { cancelled = true; if (unsubscribe) unsubscribe(); };
 }, []);

 const categories = ['All', ...Array.from(new Set(posts.map(post => post.category)))];

 const filteredPosts = useMemo(() => posts.filter(post => {
 const matchesCategory = selectedCategory === 'All' || post.category === selectedCategory;
 if (!matchesCategory) return false;
 
 if (!searchQuery.trim()) return true;
 
 const queryStr = searchQuery.toLowerCase();
 const matchesTitle = post.title.toLowerCase().includes(queryStr);
 const matchesContent = post.content.toLowerCase().includes(queryStr);
 const matchesTags = post.tags?.some(tag => tag.toLowerCase().includes(queryStr)) || false;
 const matchesCategoryName = post.category.toLowerCase().includes(queryStr);
 
 return matchesTitle || matchesContent || matchesTags || matchesCategoryName;
 }), [posts, selectedCategory, searchQuery]);

 const formatDate = (dateString?: string) => {
 if (!dateString) return '';
 try {
 const date = new Date(dateString);
 return new Intl.DateTimeFormat('en-US', {
 year: 'numeric',
 month: 'long',
 day: 'numeric'
 }).format(date);
 } catch (e) {
 return dateString;
 }
 };

 if (loading) {
 return (
 <div className="flex flex-col items-center justify-center h-64 text-warm-brown ">
 <div className="w-8 h-8 border-4 border-gold border-t-transparent rounded-full animate-spin mb-4"></div>
 <p>Loading articles...</p>
 </div>
 );
 }

 if (posts.length === 0) {
 return (
 <div className="flex flex-col items-center justify-center h-64 text-warm-brown px-4 text-center">
 <FileText size={48} className="text-stone-300 mb-4" />
 <p className="text-lg font-medium text-earth mb-2 font-display">No articles yet</p>
 <p className="text-sm">Check back later for new content.</p>
 </div>
 );
 }

 if (selectedPost) {
 return (
 <div className="bg-white min-h-full">
 {errorMessage && (
 <div className="bg-red-50 text-red-600 p-3 text-sm font-medium border-b border-red-100">
 {errorMessage}
 </div>
 )}
 <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-stone-200 px-4 py-3 flex items-center justify-between">
 <div className="flex items-center">
 <button 
 onClick={() => {
 if (isFullScreen && onBack) {
 onBack();
 } else {
 setSelectedPost(null);
 }
 }}
 className="p-2 -ml-2 mr-2 text-warm-brown hover:text-earth :text-white transition-colors rounded-full hover:bg-stone-100 :bg-gray-800"
 >
 <ArrowLeft size={20} />
 </button>
 <span className="font-medium text-earth truncate">Back to Blog</span>
 </div>
 <div className="flex items-center gap-2">
 <SaveButton
 entry={{
 type: 'blog',
 id: selectedPost.id,
 title: selectedPost.title,
 snippet: toSnippet(selectedPost.content),
 }}
 />
 <ShareButton url={shareUrl} title={selectedPost.title} />
 </div>
 </div>
 
 <article className="pb-24">
 {selectedPost.featuredImage && (
 <div className="w-full h-48 sm:h-64 md:h-80 overflow-hidden relative">
 <Image 
 src={selectedPost.featuredImage} 
 alt={selectedPost.title} 
 fill
 sizes="(max-width: 768px) 100vw, 800px"
 priority
 className="object-cover"
 referrerPolicy="no-referrer"
 />
 </div>
 )}
 
 <div className="max-w-3xl mx-auto px-4 py-6">
 <div className="flex items-center gap-2 mb-4">
 <span className="px-2 py-0.5 bg-stone-100 text-[color:var(--text-body)] text-xs font-medium rounded uppercase tracking-wider">
 {selectedPost.category}
 </span>
 <div className="flex items-center text-warm-brown text-xs gap-1">
 <Calendar size={12} />
 <span>{formatDate(selectedPost.publishedAt || selectedPost.createdAt)}</span>
 </div>
 </div>
 
 <h1 className="text-[26px] sm:text-3xl font-light tracking-[-0.02em] text-earth mb-6 leading-tight font-display">
 {selectedPost.title}
 </h1>
 
 <div 
 className="prose prose-base max-w-none mb-8"
 style={{ wordBreak: 'normal', overflowWrap: 'break-word', whiteSpace: 'normal' }}
 dangerouslySetInnerHTML={{ __html: sanitizeHtml(selectedPost.content) }}
 />
 
 {selectedPost.tags && selectedPost.tags.length > 0 && (
 <div className="pt-6 border-t border-stone-200 ">
 <h3 className="text-xs font-medium text-earth mb-3 uppercase tracking-wider">Tags</h3>
 <div className="flex flex-wrap gap-1.5">
 {selectedPost.tags.map(tag => (
 <span key={tag} className="flex items-center gap-1 text-xs text-warm-brown bg-stone-100 px-2 py-1 rounded border border-stone-200 ">
 <Tag size={12} />
 {tag}
 </span>
 ))}
 </div>
 </div>
 )}

 {/* Continue Learning */}
 {posts.filter(p => p.category === selectedPost.category && p.id !== selectedPost.id).slice(0, 2).length > 0 && (
 <div className="mt-12 pt-8 border-t border-stone-200 ">
 <h3 className="text-lg font-light tracking-[-0.01em] text-earth mb-4 font-display">Continue Learning</h3>
 <div className="space-y-4">
 {posts.filter(p => p.category === selectedPost.category && p.id !== selectedPost.id).slice(0, 2).map(relatedPost => (
 <div 
 key={relatedPost.id}
 onClick={() => {
 if (isFullScreen && onOpenArticle) {
 onOpenArticle(relatedPost);
 } else {
 setSelectedPost(relatedPost);
 }
 window.scrollTo(0, 0);
 }}
 className="flex gap-3 bg-white rounded-xl p-3 shadow-sm border border-stone-200 cursor-pointer hover:border-gold transition-colors"
 >
 {relatedPost.featuredImage && (
 <div className="w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden bg-stone-100 relative">
 <Image 
 src={relatedPost.featuredImage} 
 alt={relatedPost.title} 
 fill
 sizes="80px"
 className="object-cover"
 referrerPolicy="no-referrer"
 />
 </div>
 )}
 <div className="flex-1 min-w-0 flex flex-col justify-center">
 <h4 className="font-bold text-earth text-sm line-clamp-2 mb-1">{relatedPost.title}</h4>
 <div className="flex items-center gap-2 text-xs text-warm-brown">
 <span className="uppercase tracking-wider font-medium text-gold">{relatedPost.category}</span>
 <span>•</span>
 <span>{formatDate(relatedPost.publishedAt || relatedPost.createdAt)}</span>
 </div>
 </div>
 </div>
 ))}
 </div>
 </div>
 )}
 </div>
 </article>
 </div>
 );
 }

 return (
 <div className="space-y-6 pb-8 lg:max-w-5xl lg:mx-auto w-full">
 {errorMessage && (
 <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-medium border border-red-100 mx-1">
 {errorMessage}
 </div>
 )}
 {/* Search Bar — desktop (lg:) grows to the Harvest Member App scale. */}
 <div className="relative">
 <div className="absolute inset-y-0 left-0 pl-3 lg:pl-4 flex items-center pointer-events-none">
 <Search size={16} className="text-[color:var(--text-faint)]" />
 </div>
 <input
 type="text"
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 placeholder="Search articles by title, content, or tags..."
 className="w-full pl-9 lg:pl-11 pr-3 py-1.5 lg:py-2.5 bg-white border border-stone-200 rounded-lg lg:rounded-xl text-sm text-earth focus:ring-2 focus:ring-gold focus:border-transparent outline-none transition-all"
 />
 </div>

 {/* Categories */}
 {categories.length > 1 && (
 <div className="flex overflow-x-auto lg:flex-wrap gap-1.5 lg:gap-2 pb-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
 {categories.map(category => (
 <button
 key={category}
 onClick={() => setSelectedCategory(category)}
 className={`px-3 py-1 lg:px-[15px] lg:py-[7px] rounded-full text-xs lg:text-[12.5px] font-medium lg:font-semibold whitespace-nowrap transition-colors ${
 selectedCategory === category
 ? 'bg-gold text-white'
 : 'bg-white text-warm-brown lg:text-[color:var(--text-body)] border border-stone-200 lg:border-stone-300 hover:border-gold :border-gold'
 }`}
 >
 {category}
 </button>
 ))}
 </div>
 )}

 {/* Blog Posts List */}
 <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4">
 {filteredPosts.map((post, index) => (
 <article 
 key={post.id} 
 onClick={() => {
 if (onOpenArticle) {
 onOpenArticle(post);
 } else {
 setSelectedPost(post);
 }
 }}
 className="bg-white rounded-xl shadow-sm border border-stone-200 overflow-hidden flex flex-row items-center gap-3 p-2.5 sm:p-3 transition-transform hover:scale-[1.02] duration-300 cursor-pointer"
 >
 {post.featuredImage ? (
 <div className="w-16 h-16 sm:w-20 sm:h-20 flex-shrink-0 overflow-hidden rounded-lg bg-stone-100 relative">
 <Image 
 src={post.featuredImage} 
 alt={post.title} 
 fill
 sizes="80px"
 priority={index < 4}
 className="object-cover"
 referrerPolicy="no-referrer"
 />
 </div>
 ) : (
 <div className="w-16 h-16 sm:w-20 sm:h-20 flex-shrink-0 bg-stone-100 flex items-center justify-center rounded-lg">
 <FileText size={20} className="text-stone-300 " />
 </div>
 )}
 
 <div className="flex flex-col flex-1 min-w-0 py-1">
 <h3 className="text-base sm:text-lg font-bold text-earth mb-1.5 line-clamp-2 leading-tight">
 {post.title}
 </h3>
 
 <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-warm-brown mb-2">
 <span className="px-2 py-0.5 bg-stone-100 text-warm-brown font-medium rounded uppercase tracking-wider">
 {post.category}
 </span>
 <div className="flex items-center gap-1">
 <Calendar size={12} />
 <span>{formatDate(post.publishedAt || post.createdAt)}</span>
 </div>
 </div>
 
 {post.tags && post.tags.length > 0 && (
 <div className="flex flex-wrap gap-1.5 mt-auto">
 {post.tags.slice(0, 3).map(tag => (
 <span key={tag} className="flex items-center gap-1 text-[10px] sm:text-xs text-warm-brown bg-stone-100 px-1.5 py-0.5 rounded">
 <Tag size={10} />
 {tag}
 </span>
 ))}
 {post.tags.length > 3 && (
 <span className="text-[10px] sm:text-xs text-[color:var(--text-faint)]">+{post.tags.length - 3}</span>
 )}
 </div>
 )}
 </div>
 </article>
 ))}
 </div>
 </div>
 );
};

export default BlogTab;
