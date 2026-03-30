"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { collection, query, where, onSnapshot, doc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { FileText, Calendar, Tag, Bookmark } from 'lucide-react';

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

interface SavedContentTabProps {
  onOpenArticle: (post: BlogPost) => void;
}

const SavedContentTab: React.FC<SavedContentTabProps> = ({ onOpenArticle }) => {
  const [bookmarkedPostIds, setBookmarkedPostIds] = useState<string[]>([]);
  const [savedPosts, setSavedPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [activeFilter, setActiveFilter] = useState('All');
  const filters = ['All', 'Articles', 'Videos', 'Scriptures'];

  useEffect(() => {
    if (auth.currentUser) {
      const userRef = doc(db, 'users', auth.currentUser.uid);
      const unsubscribeUser = onSnapshot(userRef, (doc) => {
        if (doc.exists()) {
          const userData = doc.data();
          setBookmarkedPostIds(userData.bookmarks || []);
        } else {
          setLoading(false);
        }
      });
      return () => unsubscribeUser();
    } else {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (bookmarkedPostIds.length === 0) {
      setSavedPosts([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'blog_posts'),
      where('status', '==', 'published')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedPosts = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as BlogPost[];
      
      const filteredPosts = fetchedPosts.filter(post => bookmarkedPostIds.includes(post.id));
      
      filteredPosts.sort((a, b) => {
        const dateA = a.publishedAt || a.createdAt;
        const dateB = b.publishedAt || b.createdAt;
        return new Date(dateB).getTime() - new Date(dateA).getTime();
      });
      
      setSavedPosts(filteredPosts);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [bookmarkedPostIds]);

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
      <div className="flex flex-col items-center justify-center h-64 text-gray-500 dark:text-gray-400">
        <div className="w-8 h-8 border-4 border-[#d4a017] border-t-transparent rounded-full animate-spin mb-4"></div>
        <p>Loading saved content...</p>
      </div>
    );
  }

  if (!auth.currentUser) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-500 dark:text-gray-400 px-4 text-center">
        <Bookmark size={48} className="text-gray-300 dark:text-gray-600 mb-4" />
        <p className="text-lg font-medium text-gray-900 dark:text-white mb-2">Sign in to save content</p>
        <p className="text-sm">You need to be signed in to view your saved articles.</p>
      </div>
    );
  }

  if (savedPosts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-500 dark:text-gray-400 px-4 text-center">
        <Bookmark size={48} className="text-gray-300 dark:text-gray-600 mb-4" />
        <p className="text-lg font-medium text-gray-900 dark:text-white mb-2">No saved content yet</p>
        <p className="text-sm">Articles you bookmark will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      {/* Filter */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-2 hide-scrollbar">
        {filters.map(filter => (
          <button
            key={filter}
            onClick={() => setActiveFilter(filter)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              activeFilter === filter
                ? 'bg-[#d4a017] text-white'
                : 'bg-white dark:bg-[#252a36] text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700'
            }`}
          >
            {filter}
          </button>
        ))}
      </div>

      {(activeFilter === 'All' || activeFilter === 'Articles') && (
        <div className="flex flex-col gap-3">
          {savedPosts.map(post => (
          <article 
            key={post.id} 
            onClick={() => onOpenArticle(post)}
            className="bg-white dark:bg-[#252a36] rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 overflow-hidden flex flex-row items-center gap-3 p-2.5 sm:p-3 transition-transform hover:scale-[1.02] duration-300 cursor-pointer"
          >
            {post.featuredImage ? (
              <div className="w-16 h-16 sm:w-20 sm:h-20 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800 relative">
                <Image 
                  src={post.featuredImage} 
                  alt={post.title} 
                  fill
                  sizes="80px"
                  className="object-cover"
                  referrerPolicy="no-referrer"
                />
              </div>
            ) : (
              <div className="w-16 h-16 sm:w-20 sm:h-20 flex-shrink-0 bg-gray-100 dark:bg-gray-800 flex items-center justify-center rounded-lg">
                <FileText size={20} className="text-gray-300 dark:text-gray-600" />
              </div>
            )}
            
            <div className="flex flex-col flex-1 min-w-0 py-1">
              <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white mb-1.5 line-clamp-2 leading-tight">
                {post.title}
              </h3>
              
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-gray-500 dark:text-gray-400 mb-2">
                <span className="px-2 py-0.5 bg-gray-100 dark:bg-[#1a1d27] text-gray-600 dark:text-gray-300 font-medium rounded uppercase tracking-wider">
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
                    <span key={tag} className="flex items-center gap-1 text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-[#1a1d27] px-1.5 py-0.5 rounded">
                      <Tag size={10} />
                      {tag}
                    </span>
                  ))}
                  {post.tags.length > 3 && (
                    <span className="text-[10px] sm:text-xs text-gray-400">+{post.tags.length - 3}</span>
                  )}
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
      )}

      {(activeFilter === 'Videos' || activeFilter === 'Scriptures') && (
        <div className="flex flex-col items-center justify-center h-64 text-gray-400 dark:text-gray-500">
          <p>{activeFilter} content coming soon.</p>
        </div>
      )}
    </div>
  );
};

export default SavedContentTab;