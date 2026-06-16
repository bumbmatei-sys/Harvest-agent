"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc, arrayUnion, arrayRemove, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Calendar as CalendarIcon, ThumbsUp, Check, ArrowLeft } from 'lucide-react';
import { getTenantScope } from '../utils/tenant-scope';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';

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

interface AllNewsProps {
 onBack: () => void;
}

const AllNews: React.FC<AllNewsProps> = ({ onBack }) => {
 const [allPosts, setAllPosts] = useState<CommunityPost[]>([]);
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
 let unsubscribe: (() => void) | null = null;
  (async () => {
    const tenantId = await getTenantScope();
    const q = tenantId
      ? query(collection(db, 'community_posts'), where('tenantId', '==', tenantId), orderBy('createdAt', 'desc'))
      : query(collection(db, 'community_posts'), orderBy('createdAt', 'desc'));

    unsubscribe = onSnapshot(q, (snapshot) => {
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
  })();

  return () => { if (unsubscribe) unsubscribe(); };
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
      const tenantIdLike = await getTenantScope();
      if (tenantIdLike) {
        const docSnapLike = await getDoc(postRef);
        if (docSnapLike.exists() && docSnapLike.data().tenantId && docSnapLike.data().tenantId !== tenantIdLike) {
          console.error('Tenant mismatch');
          return;
        }
      }
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
      handleFirestoreError(error, OperationType.UPDATE, `community_posts/${postId}`);
    }
 };

 const handleVote = async (postId: string, optionId: string, currentOptions: PollOption[]) => {
 const user = auth.currentUser;
 if (!user) {
 setErrorMessage('Please sign in to vote');
 setTimeout(() => setErrorMessage(null), 3000);
 return;
 }

 const hasVoted = currentOptions.some(o => o.votes.includes(user.uid));
 if (hasVoted) return;

 const updatedOptions = currentOptions.map(opt => {
 if (opt.id === optionId) {
 return { ...opt, votes: [...opt.votes, user.uid] };
 }
 return opt;
 });

 try {
   const postRefVote = doc(db, 'community_posts', postId);
   const tenantIdVote = await getTenantScope();
   if (tenantIdVote) {
     const docSnapVote = await getDoc(postRefVote);
     if (docSnapVote.exists() && docSnapVote.data().tenantId && docSnapVote.data().tenantId !== tenantIdVote) {
       console.error('Tenant mismatch');
       return;
     }
   }
   await updateDoc(postRefVote, {
     pollOptions: updatedOptions
   });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `community_posts/${postId}`);
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
 const tenantIdAttend = await getTenantScope();
 if (tenantIdAttend) {
   const docSnapAttend = await getDoc(postRef);
   if (docSnapAttend.exists() && docSnapAttend.data().tenantId && docSnapAttend.data().tenantId !== tenantIdAttend) {
     console.error('Tenant mismatch');
     return;
   }
 }
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
      handleFirestoreError(error, OperationType.UPDATE, `community_posts/${postId}`);
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
 const tenantIdSubmit = await getTenantScope();
 if (tenantIdSubmit) {
   const docSnapSubmit = await getDoc(postRef);
   if (docSnapSubmit.exists() && docSnapSubmit.data().tenantId && docSnapSubmit.data().tenantId !== tenantIdSubmit) {
     console.error('Tenant mismatch');
     return;
   }
 }
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
 hour: 'numeric',
 minute: '2-digit',
 hour12: true
 }).format(date);
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
  });

 return (
 <div className="flex flex-col h-screen bg-[#f8f9fa] ">
 <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-gray-100 px-4 py-3 flex items-center gap-3 lg:max-w-5xl lg:mx-auto w-full">
 <button 
 onClick={onBack}
 className="p-2 -ml-2 text-gray-600 hover:bg-gray-100 :bg-gray-800 rounded-full transition-colors"
 >
 <ArrowLeft size={20} />
 </button>
 <span className="font-medium text-gray-900 truncate">News & Updates</span>
 </div>

 <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-24 lg:max-w-5xl lg:mx-auto w-full">
 {errorMessage && (
 <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-medium border border-red-100 mb-4">
 {errorMessage}
 </div>
 )}
 {loading ? (
 <div className="flex justify-center py-8">
 <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#d4a017]"></div>
 </div>
 ) : posts.length === 0 ? (
 <div className="text-center py-12 text-gray-500">No news yet.</div>
 ) : (
 posts.map((post, index) => (
 <div key={post.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 ">
 <div className="flex items-center gap-3 mb-3">
 <div className="w-10 h-10 rounded-full bg-[#1a1d27] text-white flex items-center justify-center font-bold overflow-hidden relative">
 {post.authorPhoto ? (
 <Image src={post.authorPhoto} alt={post.authorName} fill sizes="40px" className="object-cover" referrerPolicy="no-referrer" />
 ) : (
 post.authorName.charAt(0)
 )}
 </div>
 <div>
 <div className="flex items-center gap-2">
 <div className="font-bold text-gray-900 text-sm">{post.authorName}</div>
 {post.isPinned && (
 <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#d4a017] bg-[#fcefc7] px-2 py-0.5 rounded-full">
 Pinned
 </span>
 )}
 </div>
 <div className="text-xs text-gray-500">{formatDate(post.createdAt)}</div>
 </div>
 </div>

 <div className="text-gray-800 text-sm whitespace-pre-wrap mb-3">
 {post.content}
 </div>

 {post.imageUrl && (
 <div className="mb-3 rounded-xl overflow-hidden bg-gray-100 relative min-h-[200px]">
 <Image src={post.imageUrl} alt="Post attachment" fill sizes="(max-width: 768px) 100vw, 800px" priority={index < 2} className="object-cover" referrerPolicy="no-referrer" />
 </div>
 )}

 {post.type === 'poll' && post.pollOptions && (
 <div className="space-y-2 mb-3">
 {post.pollOptions.map(option => {
 const totalVotes = post.pollOptions!.reduce((sum, opt) => sum + opt.votes.length, 0);
 const percentage = totalVotes > 0 ? Math.round((option.votes.length / totalVotes) * 100) : 0;
 const hasVoted = auth.currentUser && post.pollOptions!.some(o => o.votes.includes(auth.currentUser!.uid));
 const isMyVote = auth.currentUser && option.votes.includes(auth.currentUser.uid);

 return (
 <button
 key={option.id}
 onClick={() => handleVote(post.id, option.id, post.pollOptions!)}
 disabled={!!hasVoted}
 className={`w-full relative overflow-hidden rounded-xl border p-3 text-left transition-all ${
 isMyVote 
 ? 'border-[#d4a017] bg-[#fcefc7] ' 
 : 'border-gray-200 hover:border-[#d4a017] :border-[#d4a017]'
 }`}
 >
 {hasVoted && (
 <div 
 className="absolute left-0 top-0 bottom-0 bg-[#fcefc7] transition-all duration-500"
 style={{ width: `${percentage}%` }}
 />
 )}
 <div className="relative flex justify-between items-center z-10">
 <span className={`text-sm font-medium ${isMyVote ? 'text-[#d4a017] ' : 'text-gray-700 '}`}>
 {option.text}
 </span>
 {hasVoted && (
 <span className="text-xs font-bold text-gray-500 ">
 {percentage}%
 </span>
 )}
 </div>
 </button>
 );
 })}
 <div className="text-xs text-gray-500 text-right mt-1">
 {post.pollOptions.reduce((sum, opt) => sum + opt.votes.length, 0)} votes
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
 <span className="font-medium">{post.likes.length}</span>
 </button>
 </div>
 </div>
 ))
 )}
 </div>

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

export default AllNews;
