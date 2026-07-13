"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { collection, query, where, onSnapshot, deleteDoc, doc, getDoc, updateDoc, arrayUnion, arrayRemove, limit } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Calendar as CalendarIcon, MoreVertical, ThumbsUp, Check } from 'lucide-react';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope } from '../utils/tenant-scope';
import { sortByTime } from '../utils/query-helpers';



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

// Single source of truth for the permission model lives in AnalyticsAndRoles.
// Imported for local use and re-exported so existing importers keep working.
import type { Permission } from './AnalyticsAndRoles';
export type { Permission };

interface CommunityPost {
 id: string;
 type: 'post' | 'poll' | 'event';
 authorId: string;
 authorName: string;
 authorPhoto?: string;
 createdAt: string;
 content: string;
 imageUrl?: string;
 imageUrls?: string[];
 likes: string[];
 pollOptions?: PollOption[];
 eventDetails?: EventDetails;
 isPinned?: boolean;
  targetCountry?: string;
  targetCity?: string;
}

interface AdminPostsProps {
  userRole?: string;
  userPermissions?: Permission | null;
}

/**
 * Admin Posts screen — a read/moderation list for the community feed.
 *
 * Post CREATION lives in the unified feed composer (NewsTab.tsx), which is
 * admin-gated and carries every feature (text + images + embeds + poll + pin).
 * This screen intentionally has no composer; it surfaces the full post list
 * (up to 100) for moderation: pin/unpin, delete, and event attendee CSV export.
 */
const AdminPosts: React.FC<AdminPostsProps> = ({ userRole, userPermissions }) => {
 const [posts, setPosts] = useState<CommunityPost[]>([]);
 const [loading, setLoading] = useState(true);
 const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
 const [errorMessage, setErrorMessage] = useState<string | null>(null);



 useEffect(() => {
 let unsubscribe: (() => void) | null = null;
 (async () => {
   const tenantId = await getTenantScope();
   // Single-field filter only (tenantId); sort client-side to avoid a composite index.
   const q = tenantId
     ? query(collection(db, 'community_posts'), where('tenantId', '==', tenantId), limit(100))
     : query(collection(db, 'community_posts'), limit(100));
   unsubscribe = onSnapshot(q, (snapshot) => {
     const postsData = sortByTime(snapshot.docs.map(doc => ({
       id: doc.id,
       ...doc.data()
     })) as CommunityPost[], 'createdAt', 'desc');

     const sortedPosts = [...postsData].sort((a, b) => {
       if (a.isPinned && !b.isPinned) return -1;
       if (!a.isPinned && b.isPinned) return 1;
       return 0;
     });

     setPosts(sortedPosts);
     setLoading(false);
   }, (error) => {
     console.error('Failed to load posts:', error);
     setLoading(false);
   });
 })();

 return () => { if (unsubscribe) unsubscribe(); };
 }, []);

 // Resolve a post's renderable image (prefer the newer imageUrls array).
 const postImage = (post: CommunityPost) =>
   (post.imageUrls && post.imageUrls[0]) || post.imageUrl || '';

 const downloadCSV = (post: CommunityPost) => {
 if (!post.eventDetails || !post.eventDetails.attendeeDetails) {
 setErrorMessage('No attendee details available to download.');
 setTimeout(() => setErrorMessage(null), 3000);
 return;
 }

 const headers = ['Name', 'Email', 'UID'];
 const rows = post.eventDetails.attendeeDetails.map(a => [
 `"${a.name.replace(/"/g, '""')}"`,
 `"${a.email.replace(/"/g, '""')}"`,
 `"${a.uid}"`
 ]);

 const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
 const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
 const url = URL.createObjectURL(blob);
 const link = document.createElement('a');
 link.setAttribute('href', url);
 link.setAttribute('download', `${post.eventDetails.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_attendees.csv`);
 link.style.visibility = 'hidden';
 document.body.appendChild(link);
 link.click();
 document.body.removeChild(link);
 };

 const handleDelete = async (postId: string) => {
 try {
   const tenantId = await getTenantScope();
   if (tenantId) {
     const docSnap = await getDoc(doc(db, 'community_posts', postId));
     if (docSnap.exists() && docSnap.data().tenantId && docSnap.data().tenantId !== tenantId) {
       console.error('Tenant mismatch — cannot modify another tenant\'s document');
       return;
     }
   }
   await deleteDoc(doc(db, 'community_posts', postId));
 setDeleteConfirmId(null);
 } catch (error) {
 try { handleFirestoreError(error, OperationType.DELETE, `community_posts`); } catch (e) { console.error(e); }
 }
 };

 const handleLike = async (postId: string, likes: string[]) => {
  const user = auth.currentUser;
  if (!user) {
    setErrorMessage('Please sign in to like posts');
    setTimeout(() => setErrorMessage(null), 3000);
    return;
  }

  const tenantId = await getTenantScope();
  if (tenantId) {
    const docSnap = await getDoc(doc(db, 'community_posts', postId));
    if (docSnap.exists() && docSnap.data().tenantId && docSnap.data().tenantId !== tenantId) {
      console.error('Tenant mismatch — cannot modify another tenant\'s document');
      return;
    }
  }

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

  const tenantId = await getTenantScope();
  if (tenantId) {
    const docSnap = await getDoc(doc(db, 'community_posts', postId));
    if (docSnap.exists() && docSnap.data().tenantId && docSnap.data().tenantId !== tenantId) {
      console.error('Tenant mismatch — cannot modify another tenant\'s document');
      return;
    }
  }

  const updatedOptions = currentOptions.map(opt => {
 if (opt.id === optionId) {
 return { ...opt, votes: [...opt.votes, user.uid] };
 }
 return opt;
 });

 await updateDoc(doc(db, 'community_posts', postId), {
 pollOptions: updatedOptions
 });
 };

 const handleAttend = async (postId: string, attendees: string[]) => {
  const user = auth.currentUser;
  if (!user) {
    setErrorMessage('Please sign in to attend');
    setTimeout(() => setErrorMessage(null), 3000);
    return;
  }

  const tenantId = await getTenantScope();
  if (tenantId) {
    const docSnap = await getDoc(doc(db, 'community_posts', postId));
    if (docSnap.exists() && docSnap.data().tenantId && docSnap.data().tenantId !== tenantId) {
      console.error('Tenant mismatch — cannot modify another tenant\'s document');
      return;
    }
  }

  const postRef = doc(db, 'community_posts', postId);
 if (attendees.includes(user.uid)) {
 await updateDoc(postRef, {
 'eventDetails.attendees': arrayRemove(user.uid)
 });
 } else {
 await updateDoc(postRef, {
 'eventDetails.attendees': arrayUnion(user.uid)
 });
 }
 };

 const handlePin = async (postId: string, currentPinnedStatus: boolean | undefined) => {
  try {
    const tenantId = await getTenantScope();
    if (tenantId) {
      const docSnap = await getDoc(doc(db, 'community_posts', postId));
      if (docSnap.exists() && docSnap.data().tenantId && docSnap.data().tenantId !== tenantId) {
        console.error('Tenant mismatch — cannot modify another tenant\'s document');
        return;
      }
    }
    const postRef = doc(db, 'community_posts', postId);
 await updateDoc(postRef, {
 isPinned: !currentPinnedStatus
 });
 } catch (error) {
 try { handleFirestoreError(error, OperationType.UPDATE, `community_posts`); } catch (e) { console.error(e); }
 setErrorMessage('Failed to pin post');
 setTimeout(() => setErrorMessage(null), 3000);
 }
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

 return (
 <div className="max-w-2xl mx-auto space-y-6">
 {errorMessage && (
 <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-medium border border-red-100">
 {errorMessage}
 </div>
 )}

 {/* Feed — read/moderation list. New posts are created from the feed composer (NewsTab). */}
 <div className="space-y-4">
 {loading ? (
 <div className="flex justify-center py-8">
 <div className="w-8 h-8 border-4 border-gold border-t-transparent rounded-full animate-spin"></div>
 </div>
 ) : posts.length === 0 ? (
 <div className="text-center py-8 text-warm-brown font-display">No posts yet.</div>
 ) : (
 posts.map(post => (
 <div key={post.id} className="bg-white rounded-2xl shadow-sm border border-stone-200 p-4">
 <div className="flex justify-between items-start mb-3">
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-full bg-stone-200 overflow-hidden flex items-center justify-center font-bold text-warm-brown relative">
 {post.authorPhoto ? (
 <Image src={post.authorPhoto} alt={post.authorName} fill sizes="40px" className="object-cover" referrerPolicy="no-referrer" />
 ) : (
 post.authorName.charAt(0)
 )}
 </div>
 <div>
 <div className="flex items-center gap-2">
 <h4 className="font-bold text-earth text-sm">{post.authorName}</h4>
 {post.isPinned && (
 <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-gold bg-[color-mix(in_srgb,var(--brand-color)_15%,white)] px-2 py-0.5 rounded-full">
 Pinned
                        </span>
                      )}

 </div>
 <p className="text-xs text-warm-brown">{formatDate(post.createdAt)}</p>
 </div>
 </div>
 <div className="relative group">
 <button className="p-1 text-[color:var(--text-faint)] hover:text-warm-brown :text-stone-300 rounded-full hover:bg-stone-100 :bg-gray-800">
 <MoreVertical size={16} />
 </button>
 <div className="absolute right-0 mt-1 w-32 bg-white rounded-lg shadow-lg border border-stone-200 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
 <button
 onClick={() => handlePin(post.id, post.isPinned)}
 className="w-full text-left px-4 py-2 text-sm text-[color:var(--text-body)] hover:bg-stone-100 :bg-gray-800 rounded-t-lg"
 >
 {post.isPinned ? 'Unpin Post' : 'Pin Post'}
 </button>
 <button
 onClick={() => setDeleteConfirmId(post.id)}
 className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 :bg-red-900/20 rounded-b-lg"
 >
 Delete
 </button>
 </div>
 </div>
 </div>

 <p className="text-[color:var(--text-body)] text-sm whitespace-pre-wrap mb-3">
 {post.content}
 </p>

 {postImage(post) && (
 <div className="rounded-xl overflow-hidden mb-3 max-h-80 bg-stone-100 relative min-h-[200px]">
 <Image src={postImage(post)} alt="Post attachment" fill sizes="100vw" className="object-cover" referrerPolicy="no-referrer" />
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
 ? 'border-gold bg-[color-mix(in_srgb,var(--brand-color)_8%,white)] '
 : 'border-stone-200 bg-stone-100 hover:border-gold'
 }`}
 >
 {hasVoted && (
 <div
 className="absolute left-0 top-0 bottom-0 bg-[color-mix(in_srgb,var(--brand-color)_15%,white)] transition-all duration-500"
 style={{ width: `${percentage}%` }}
 />
 )}
 <div className="relative z-10 flex justify-between w-full text-sm font-medium text-[color:var(--text-body)] ">
 <span className="flex items-center gap-2">
 {option.text}
 {userVotedThis && <Check size={14} className="text-gold" />}
 </span>
 {hasVoted && <span className="text-warm-brown">{percentage}%</span>}
 </div>
 </button>
 );
 })}
 <div className="text-right text-xs text-warm-brown">
 {post.pollOptions.reduce((acc, o) => acc + o.votes.length, 0)} votes total
 </div>
 </div>
 )}

 {post.type === 'event' && post.eventDetails && (
 <div className="bg-stone-100 rounded-xl p-4 mb-3 border border-stone-200 flex flex-col items-center text-center">
 <div className="bg-white border border-stone-200 rounded-lg p-2 mb-3 min-w-[80px]">
 <div className="text-red-500 text-xs font-bold uppercase">{new Date(post.eventDetails.date).toLocaleString('default', { month: 'short' })}</div>
 <div className="text-xl font-bold text-earth ">{new Date(post.eventDetails.date).getDate()}</div>
 </div>
 <h4 className="font-bold text-earth text-lg mb-2">{post.eventDetails.title}</h4>
 <div className="flex flex-col gap-1 text-sm text-warm-brown mb-4">
 <div className="flex items-center justify-center gap-1.5">
 <CalendarIcon size={14} />
 <span>{post.eventDetails.time}</span>
 </div>
 <div className="flex items-center justify-center gap-1.5">
 <span className="w-3.5 h-3.5 rounded-full border border-current flex items-center justify-center text-[8px]">📍</span>
 <span>{post.eventDetails.location}</span>
 </div>
 </div>
 <div className="flex items-center gap-2 mb-4 text-xs text-warm-brown">
 <span>{post.eventDetails.attendees.length} Participating</span>
 {post.eventDetails.attendeeDetails && post.eventDetails.attendeeDetails.length > 0 && (
 <button
 onClick={() => downloadCSV(post)}
 className="ml-2 text-gold hover:underline font-medium"
 >
 Download CSV
 </button>
 )}
 </div>
 {auth.currentUser && (
 <button
 onClick={() => handleAttend(post.id, post.eventDetails!.attendees)}
 className={`px-6 py-2 font-medium rounded-lg text-sm flex items-center gap-1.5 transition-colors ${
 post.eventDetails.attendees.includes(auth.currentUser.uid)
 ? 'bg-green-100 text-green-700 '
 : 'bg-gold text-white hover:bg-[color-mix(in_srgb,var(--brand-color)_85%,black)]'
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

 <div className="flex items-center gap-4 pt-3 border-t border-stone-200 text-warm-brown">
 <button
 onClick={() => handleLike(post.id, post.likes)}
 className={`flex items-center gap-1.5 text-sm transition-colors ${
 auth.currentUser && post.likes.includes(auth.currentUser.uid)
 ? 'text-gold'
 : 'hover:text-gold'
 }`}
 >
 <ThumbsUp size={16} className={auth.currentUser && post.likes.includes(auth.currentUser.uid) ? 'fill-current' : ''} />
 <span>{post.likes.length} Likes</span>
 </button>
 </div>
 </div>
 ))
 )}
 </div>
 {/* Delete Confirmation Modal */}
 {deleteConfirmId && (
 <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
 <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 border border-stone-200 ">
 <h3 className="text-xl font-bold text-earth mb-2 font-display">Delete Post</h3>
 <p className="text-warm-brown mb-6">
 Are you sure you want to delete this post? This action cannot be undone.
 </p>
 <div className="flex justify-end gap-3">
 <button
 onClick={() => setDeleteConfirmId(null)}
 className="px-4 py-2 text-warm-brown hover:bg-stone-100 :bg-gray-800 rounded-xl font-medium transition-colors"
 >
 Cancel
 </button>
 <button
 onClick={() => handleDelete(deleteConfirmId)}
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

export default AdminPosts;
