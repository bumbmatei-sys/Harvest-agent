"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, arrayUnion, arrayRemove, limit, where, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Calendar as CalendarIcon, ThumbsUp, Check, ChevronRight, FileText, Tag, Calendar } from 'lucide-react';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope } from '../utils/tenant-scope';



interface PollOption {
 id: string;
 text: string;
 votes: string[];
}

interface EventDetails {
 title: string;
 date: string;
 time: string;
 location: string;
 attendees: string[];
 attendeeDetails?: { uid: string; name: string; email: string }[];
}

interface CommunityPost {
 id: string;
 type: 'post' | 'poll' | 'event';
 authorId: string;
 authorName: string;
 authorPhoto?: string;
 createdAt: string;
 content: string;
 imageUrl?: string;
 likes: string[];
 pollOptions?: PollOption[];
 eventDetails?: EventDetails;
 isPinned?: boolean;
  targetRegions?: string[];
  targetCountry?: string;
  targetCity?: string;
}

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

interface NewsTabProps {
 onOpenAllNews: () => void;
 onOpenArticle: (post: BlogPost) => void;
}

const NewsTab: React.FC<NewsTabProps> = ({ onOpenAllNews, onOpenArticle }) => {
 const [allPosts, setAllPosts] = useState<CommunityPost[]>([]);
 const [articles, setArticles] = useState<BlogPost[]>([]);
 const [loading, setLoading] = useState(true);
  const [userLocation, setUserLocation] = useState<{country?: string, city?: string} | null>(null);
 
 // Event attendance modal state
 const [attendingPostId, setAttendingPostId] = useState<string | null>(null);
 const [attendeeName, setAttendeeName] = useState('');
 const [attendeeEmail, setAttendeeEmail] = useState('');
 const [errorMessage, setErrorMessage] = useState<string | null>(null);

 
  useEffect(() => {
    const fetchUserLocation = async () => {
      if (auth.currentUser) {
        try {
          const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
          if (userDoc.exists()) {
            const data = userDoc.data();
            setUserLocation({ country: data.country, city: data.city });
          }
        } catch (error) {
          console.error('Failed to fetch user location', error);
        }
      }
    };
    fetchUserLocation();
  }, []);

  useEffect(() => {
 let unsubCommunity: (() => void) | null = null;
 let unsubArticles: (() => void) | null = null;
 (async () => {
   const tenantId = await getTenantScope();

   // Fetch all posts to ensure pinned posts are included, then slice
   const communityQ = tenantId
     ? query(collection(db, 'community_posts'), where('tenantId', '==', tenantId), orderBy('createdAt', 'desc'), limit(50))
     : query(collection(db, 'community_posts'), orderBy('createdAt', 'desc'), limit(50));

   unsubCommunity = onSnapshot(communityQ, (snapshot) => {
     const postsData = snapshot.docs.map(doc => ({
       id: doc.id,
       ...doc.data()
     })) as CommunityPost[];

     const sortedPosts = [...postsData].sort((a, b) => {
       if (a.isPinned && !b.isPinned) return -1;
       if (!a.isPinned && b.isPinned) return 1;
       return 0;
     });

     setAllPosts(sortedPosts);
     setLoading(false);
   });

   const articlesQ = tenantId
     ? query(
         collection(db, 'blog_posts'),
         where('tenantId', '==', tenantId),
         where('status', '==', 'published'),
         limit(50)
       )
     : query(
         collection(db, 'blog_posts'),
         where('status', '==', 'published'),
         limit(50)
       );

   unsubArticles = onSnapshot(articlesQ, (snapshot) => {
     const fetchedPosts = snapshot.docs.map(doc => ({
       id: doc.id,
       ...doc.data()
     })) as BlogPost[];

     const now = new Date().toISOString();
     const visiblePosts = fetchedPosts.filter(post =>
       !post.publishedAt || post.publishedAt <= now
     );

     visiblePosts.sort((a, b) => {
       const dateA = a.publishedAt || a.createdAt;
       const dateB = b.publishedAt || b.createdAt;
       return new Date(dateB).getTime() - new Date(dateA).getTime();
     });

     setArticles(visiblePosts.slice(0, 3));
   });
 })();

 return () => {
   if (unsubCommunity) unsubCommunity();
   if (unsubArticles) unsubArticles();
 };
 }, []);

 const handleLike = async (postId: string, likes: string[]) => {
 const user = auth.currentUser;
 if (!user) {
 setErrorMessage('Please sign in to like posts');
 setTimeout(() => setErrorMessage(null), 3000);
 return;
 }

 try {
      const postRef = doc(db, 'community_posts', postId);
      if (likes.includes(user.uid)) {
        await updateDoc(postRef, {
          likes: arrayRemove(user.uid)
        });
      } else {
        await updateDoc(postRef, {
          likes: arrayUnion(user.uid)
        });
      }
    } catch (error) {
      try { handleFirestoreError(error, OperationType.UPDATE, `community_posts/${postId}`); } catch (e) { console.error(e); }
    }
 };

 const handleVote = async (postId: string, optionId: string, currentOptions: PollOption[]) => {
 const user = auth.currentUser;
 if (!user) {
 setErrorMessage('Please sign in to vote');
 setTimeout(() => setErrorMessage(null), 3000);
 return;
 }

 // Check if user already voted
 const hasVoted = currentOptions.some(o => o.votes.includes(user.uid));
 if (hasVoted) return; // Already voted

 const updatedOptions = currentOptions.map(opt => {
 if (opt.id === optionId) {
 return { ...opt, votes: [...opt.votes, user.uid] };
 }
 return opt;
 });

 try {
      await updateDoc(doc(db, 'community_posts', postId), {
        pollOptions: updatedOptions
      });
    } catch (error) {
      try { handleFirestoreError(error, OperationType.UPDATE, `community_posts/${postId}`); } catch (e) { console.error(e); }
    }
 };

 const handleAttend = async (postId: string, attendees: string[], attendeeDetails?: any[]) => {
 const user = auth.currentUser;
 if (!user) {
 setErrorMessage('Please sign in to attend');
 setTimeout(() => setErrorMessage(null), 3000);
 return;
 }

 const postRef = doc(db, 'community_posts', postId);
 if (attendees.includes(user.uid)) {
 // Un-attend
 const userDetail = attendeeDetails?.find(d => d.uid === user.uid);
 
 const updates: any = {
 'eventDetails.attendees': arrayRemove(user.uid)
 };
 
 if (userDetail) {
 updates['eventDetails.attendeeDetails'] = arrayRemove(userDetail);
 }
 
 try {
      await updateDoc(postRef, updates);
    } catch (error) {
      try { handleFirestoreError(error, OperationType.UPDATE, `community_posts/${postId}`); } catch (e) { console.error(e); }
    }
 } else {
 setAttendingPostId(postId);
 }
 };

 const submitAttend = async () => {
 if (!attendingPostId || !attendeeName.trim() || !attendeeEmail.trim()) return;
 const user = auth.currentUser;
 if (!user) return;

 const postRef = doc(db, 'community_posts', attendingPostId);
 await updateDoc(postRef, {
 'eventDetails.attendees': arrayUnion(user.uid),
 'eventDetails.attendeeDetails': arrayUnion({
 uid: user.uid,
 name: attendeeName.trim(),
 email: attendeeEmail.trim()
 })
 });
 
 setAttendingPostId(null);
 setAttendeeName('');
 setAttendeeEmail('');
 };

 const formatDate = (dateString: string) => {
 const date = new Date(dateString);
 return new Intl.DateTimeFormat('en-US', {
 month: 'short',
 day: 'numeric',
 year: 'numeric',
 hour: 'numeric',
 minute: '2-digit',
 hour12: true
 }).format(date);
 };

 const formatArticleDate = (dateString?: string) => {
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

 
  const posts = allPosts.filter(post => {
    // Legacy support
    if (post.targetRegions && post.targetRegions.length > 0 && !post.targetRegions.includes('Global')) {
      if (!userLocation) return false;
      return post.targetRegions.includes(userLocation.country || '') || post.targetRegions.includes(userLocation.city || '');
    }

    // New format
    if (!post.targetCountry || post.targetCountry === 'Global') return true;
    if (!userLocation) return false;
    
    if (post.targetCountry !== userLocation.country) return false;
    if (post.targetCity && post.targetCity !== userLocation.city) return false;
    
    return true;
  }).slice(0, 3);

  if (loading) {
 return (
 <div className="flex justify-center py-12">
 <div className="w-8 h-8 border-4 border-[#d4a017] border-t-transparent rounded-full animate-spin"></div>
 </div>
 );
 }

 return (
 <div className="space-y-4 pb-8 lg:max-w-5xl lg:mx-auto w-full">
 {errorMessage && (
 <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-medium border border-red-100 mx-1">
 {errorMessage}
 </div>
 )}
 <div className="flex items-center justify-between px-1 mb-2">
 <h2 className="text-xl font-bold text-gray-900 ">News & Updates</h2>
 {posts.length >= 3 && (
 <button 
 onClick={onOpenAllNews}
 className="flex items-center gap-1 text-sm font-medium text-[#d4a017] hover:text-[#e6b325] transition-colors"
 >
 See more <ChevronRight size={16} />
 </button>
 )}
 </div>

 {posts.length === 0 ? (
 <div className="text-center py-12 text-gray-500">No news yet.</div>
 ) : (
 posts.map((post, index) => (
 <div key={post.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
 <div className="flex justify-between items-start mb-3">
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-full bg-gray-200 overflow-hidden flex items-center justify-center font-bold text-gray-600 relative">
 {post.authorPhoto ? (
 <Image src={post.authorPhoto} alt={post.authorName} fill sizes="40px" className="object-cover" referrerPolicy="no-referrer" />
 ) : (
 post.authorName.charAt(0)
 )}
 </div>
 <div>
 <div className="flex items-center gap-2">
 <h4 className="font-bold text-gray-900 text-sm">{post.authorName}</h4>
 {post.isPinned && (
 <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#d4a017] bg-[#fcefc7] px-2 py-0.5 rounded-full">
 Pinned
 </span>
 )}
 </div>
 <p className="text-xs text-gray-500">{formatDate(post.createdAt)}</p>
 </div>
 </div>
 </div>

 <p className="text-gray-800 text-sm whitespace-pre-wrap mb-3">
 {post.content}
 </p>

 {post.imageUrl && (
 <div className="rounded-xl overflow-hidden mb-3 max-h-80 bg-gray-100 relative min-h-[200px]">
 <Image src={post.imageUrl} alt="Post attachment" fill sizes="(max-width: 768px) 100vw, 800px" priority={index < 2} className="object-cover" referrerPolicy="no-referrer" />
 </div>
 )}

 {post.type === 'poll' && post.pollOptions && (
 <div className="space-y-2 mb-3">
 {post.pollOptions.map(option => {
 const totalVotes = post.pollOptions!.reduce((acc, o) => acc + o.votes.length, 0);
 const percentage = totalVotes === 0 ? 0 : Math.round((option.votes.length / totalVotes) * 100);
 const hasVoted = auth.currentUser ? post.pollOptions!.some(o => o.votes.includes(auth.currentUser!.uid)) : false;
 const userVotedThis = auth.currentUser ? option.votes.includes(auth.currentUser.uid) : false;

 return (
 <button 
 key={option.id} 
 onClick={() => !hasVoted && handleVote(post.id, option.id, post.pollOptions!)}
 disabled={hasVoted}
 className={`relative w-full h-10 border rounded-lg overflow-hidden flex items-center px-3 transition-colors ${
 userVotedThis 
 ? 'border-[#d4a017] bg-[#fcefc7]/50 ' 
 : 'border-gray-200 bg-gray-50 hover:border-[#d4a017]'
 }`}
 >
 {hasVoted && (
 <div 
 className="absolute left-0 top-0 bottom-0 bg-[#fcefc7] transition-all duration-500"
 style={{ width: `${percentage}%` }}
 />
 )}
 <div className="relative z-10 flex justify-between w-full text-sm font-medium text-gray-800 ">
 <span className="flex items-center gap-2">
 {option.text}
 {userVotedThis && <Check size={14} className="text-[#d4a017]" />}
 </span>
 {hasVoted && <span className="text-gray-500">{percentage}%</span>}
 </div>
 </button>
 );
 })}
 <div className="text-right text-xs text-gray-500">
 {post.pollOptions.reduce((acc, o) => acc + o.votes.length, 0)} votes total
 </div>
 </div>
 )}

 {post.type === 'event' && post.eventDetails && (
 <div className="bg-gray-50 rounded-xl p-4 mb-3 border border-gray-100 flex flex-col items-center text-center">
 <div className="bg-white border border-gray-200 rounded-lg p-2 mb-3 min-w-[80px]">
 <div className="text-red-500 text-xs font-bold uppercase">{new Date(post.eventDetails.date).toLocaleString('default', { month: 'short' })}</div>
 <div className="text-xl font-bold text-gray-900 ">{new Date(post.eventDetails.date).getDate()}</div>
 </div>
 <h4 className="font-bold text-gray-900 text-lg mb-2">{post.eventDetails.title}</h4>
 <div className="flex flex-col gap-1 text-sm text-gray-500 mb-4">
 <div className="flex items-center justify-center gap-1.5">
 <CalendarIcon size={14} />
 <span>{post.eventDetails.time}</span>
 </div>
 <div className="flex items-center justify-center gap-1.5">
 <span className="w-3.5 h-3.5 rounded-full border border-current flex items-center justify-center text-[8px]">📍</span>
 <span>{post.eventDetails.location}</span>
 </div>
 </div>
 <div className="flex items-center gap-2 mb-4 text-xs text-gray-500">
 <span>{post.eventDetails.attendees.length} Participating</span>
 </div>
 {auth.currentUser && (
 <button 
 onClick={() => handleAttend(post.id, post.eventDetails!.attendees, post.eventDetails!.attendeeDetails)}
 className={`px-6 py-2 font-medium rounded-lg text-sm flex items-center gap-1.5 transition-colors ${
 post.eventDetails.attendees.includes(auth.currentUser.uid)
 ? 'bg-green-100 text-green-700 '
 : 'bg-[#e6b325] text-white hover:bg-[#d4a017]'
 }`}
 >
 {post.eventDetails.attendees.includes(auth.currentUser.uid) ? (
 <>Going <Check size={14} /></>
 ) : (
 'Attend Event'
 )}
 </button>
 )}
 </div>
 )}

 <div className="flex items-center gap-4 pt-3 border-t border-gray-100 ">
 <button 
 onClick={() => handleLike(post.id, post.likes)}
 className={`flex items-center gap-1.5 text-xs transition-colors ${
 auth.currentUser && post.likes.includes(auth.currentUser.uid)
 ? 'text-[#d4a017]'
 : 'text-gray-500 hover:text-[#d4a017]'
 }`}
 >
 <ThumbsUp size={16} className={auth.currentUser && post.likes.includes(auth.currentUser.uid) ? 'fill-current' : ''} />
 <span>{post.likes.length} Likes</span>
 </button>
 </div>
 </div>
 ))
 )}

 {/* Latest Articles Section */}
 {articles.length > 0 && (
 <div className="mt-8">
 <div className="flex items-center justify-between px-1 mb-4">
 <h2 className="text-xl font-bold text-gray-900 ">Latest Articles</h2>
 </div>
 <div className="flex flex-col gap-3">
 {articles.map((post, index) => (
 <article 
 key={post.id} 
 onClick={() => onOpenArticle(post)}
 className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-row items-center gap-3 p-2.5 sm:p-3 transition-transform hover:scale-[1.02] duration-300 cursor-pointer"
 >
 {post.featuredImage ? (
 <div className="w-16 h-16 sm:w-20 sm:h-20 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100 relative">
 <Image 
 src={post.featuredImage} 
 alt={post.title} 
 fill
 sizes="80px"
 priority={index < 3}
 className="object-cover"
 referrerPolicy="no-referrer"
 />
 </div>
 ) : (
 <div className="w-16 h-16 sm:w-20 sm:h-20 flex-shrink-0 bg-gray-100 flex items-center justify-center rounded-lg">
 <FileText size={20} className="text-gray-300 " />
 </div>
 )}
 
 <div className="flex flex-col flex-1 min-w-0 py-1">
 <h3 className="text-base sm:text-lg font-bold text-gray-900 mb-1.5 line-clamp-2 leading-tight">
 {post.title}
 </h3>
 
 <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-gray-500 mb-2">
 <span className="px-2 py-0.5 bg-gray-100 text-gray-600 font-medium rounded uppercase tracking-wider">
 {post.category}
 </span>
 <div className="flex items-center gap-1">
 <Calendar size={12} />
 <span>{formatArticleDate(post.publishedAt || post.createdAt)}</span>
 </div>
 </div>
 
 {post.tags && post.tags.length > 0 && (
 <div className="flex flex-wrap gap-1.5 mt-auto">
 {post.tags.slice(0, 3).map(tag => (
 <span key={tag} className="flex items-center gap-1 text-[10px] sm:text-xs text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded">
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
 </div>
 )}

 {/* Event Attendance Modal */}
 {attendingPostId && (
 <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
 <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
 <h3 className="text-xl font-bold text-gray-900 mb-4">Join Event</h3>
 <p className="text-sm text-gray-500 mb-4">
 Please provide your details to receive more information about this event.
 </p>
 
 <div className="space-y-4 mb-6">
 <div>
 <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
 <input
 type="text"
 value={attendeeName}
 onChange={(e) => setAttendeeName(e.target.value)}
 className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:ring-2 focus:ring-[#d4a017] outline-none"
 placeholder="John Doe"
 />
 </div>
 <div>
 <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
 <input
 type="email"
 value={attendeeEmail}
 onChange={(e) => setAttendeeEmail(e.target.value)}
 className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:ring-2 focus:ring-[#d4a017] outline-none"
 placeholder="john@example.com"
 />
 </div>
 </div>
 
 <div className="flex gap-3">
 <button
 onClick={() => {
 setAttendingPostId(null);
 setAttendeeName('');
 setAttendeeEmail('');
 }}
 className="flex-1 px-4 py-2 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 :bg-gray-800 transition-colors"
 >
 Cancel
 </button>
 <button
 onClick={submitAttend}
 disabled={!attendeeName.trim() || !attendeeEmail.trim()}
 className="flex-1 px-4 py-2 bg-[#d4a017] text-white rounded-xl font-medium hover:bg-[#e6b325] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
 >
 Confirm
 </button>
 </div>
 </div>
 </div>
 )}
 </div>
 );
};

export default NewsTab;