"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { collection, query, where, orderBy, onSnapshot, addDoc, deleteDoc, doc, getDoc, updateDoc, arrayUnion, arrayRemove, limit } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { ImageUpload } from './ImageUpload';
import { MessageSquare, BarChart2, Calendar as CalendarIcon, Image as ImageIcon, Send, MoreVertical, ThumbsUp, Check, X } from 'lucide-react';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope } from '../utils/tenant-scope';
import { sendPushNotification } from '../utils/send-notification';



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

export interface Permission {
  analytics: boolean;
  analyticsLocations: string[];
  writeArticles: boolean;
  createPosts: boolean;
  postRegions: string[];
  uploadRag: boolean;
  modifyChurches: boolean;
  seeFormsInbox: boolean;
  createCourses: boolean;
  manageAdmins: boolean;
  fullAccess: boolean;
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
  targetCountry?: string;
  targetCity?: string;
}

interface AdminPostsProps {
  userRole?: string;
  userPermissions?: Permission | null;
}

const AdminPosts: React.FC<AdminPostsProps> = ({ userRole, userPermissions }) => {
 const [posts, setPosts] = useState<CommunityPost[]>([]);
 const [loading, setLoading] = useState(true);
 const [activeTab, setActiveTab] = useState<'post' | 'poll' | 'event'>('post');
 
 // Composer state
 const [content, setContent] = useState('');
 const [imageUrl, setImageUrl] = useState('');
 const [pollOptions, setPollOptions] = useState([{ id: '1', text: '' }, { id: '2', text: '' }]);
 const [eventTitle, setEventTitle] = useState('');
 const [eventDate, setEventDate] = useState('');
 const [eventTime, setEventTime] = useState('');
 const [eventLocation, setEventLocation] = useState('');

 const [isSubmitting, setIsSubmitting] = useState(false);
 const [editingPostId, setEditingPostId] = useState<string | null>(null);
 const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
 const [errorMessage, setErrorMessage] = useState<string | null>(null);



 useEffect(() => {
 let unsubscribe: (() => void) | null = null;
 (async () => {
   const tenantId = await getTenantScope();
   const q = tenantId
     ? query(collection(db, 'community_posts'), where('tenantId', '==', tenantId), orderBy('createdAt', 'desc'), limit(50))
     : query(collection(db, 'community_posts'), orderBy('createdAt', 'desc'), limit(50));
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

     setPosts(sortedPosts);
     setLoading(false);
   });
 })();

 return () => { if (unsubscribe) unsubscribe(); };
 }, []);

 const transformImageUrl = (url: string) => {
 if (!url) return url;
 if (url.includes('github.com') && (url.includes('/blob/') || url.includes('/raw/'))) {
 return url.replace('github.com', 'raw.githubusercontent.com')
 .replace('/blob/', '/')
 .replace('/raw/', '/');
 }
 return url;
 };

 const handlePost = async () => {
 if (!content.trim() && activeTab !== 'event') return;
 if (activeTab === 'event' && (!eventTitle.trim() || !eventDate || !eventTime || !eventLocation)) return;
 if (activeTab === 'poll' && pollOptions.filter(o => o.text.trim()).length < 2) return;

 setIsSubmitting(true);
 try {
 const user = auth.currentUser;
 if (!user) throw new Error('Not authenticated');

 const postData: any = {
 type: activeTab,
 authorId: user.uid,
 authorName: user.displayName || 'Admin',
 authorPhoto: user.photoURL || '',
 createdAt: new Date().toISOString(),
 content: content.trim(),
        likes: [],
      };

 if (imageUrl.trim()) {
 postData.imageUrl = transformImageUrl(imageUrl.trim());
 }

 if (activeTab === 'poll') {
 postData.pollOptions = pollOptions
 .filter(o => o.text.trim())
 .map(o => ({ id: o.id, text: o.text.trim(), votes: [] }));
 }

 if (activeTab === 'event') {
 postData.eventDetails = {
 title: eventTitle.trim(),
 date: eventDate,
 time: eventTime,
 location: eventLocation.trim(),
 attendees: []
 };
 }

 const tenantId = await getTenantScope();
 if (editingPostId) {
   if (tenantId) {
     const docSnap = await getDoc(doc(db, 'community_posts', editingPostId));
     if (docSnap.exists() && docSnap.data().tenantId && docSnap.data().tenantId !== tenantId) {
       console.error('Tenant mismatch — cannot modify another tenant\'s document');
       return;
     }
   }
   await updateDoc(doc(db, 'community_posts', editingPostId), postData);
   setEditingPostId(null);
 } else {
   await addDoc(collection(db, 'community_posts'), {
     ...postData,
     tenantId: tenantId || null,
   });
   // Fire-and-forget push notification
   const preview = content.trim().slice(0, 100);
   sendPushNotification('New Community Post', preview);
 }
 
 // Reset form
 setContent('');
 setImageUrl('');
 setPollOptions([{ id: '1', text: '' }, { id: '2', text: '' }]);
 setEventTitle('');
 setEventDate('');
 setEventTime('');
 setEventLocation('');
    } catch (error) {
 try { handleFirestoreError(error, OperationType.WRITE, `community_posts`); } catch (e) { console.error(e); }
 setErrorMessage('Failed to create post');
 setTimeout(() => setErrorMessage(null), 3000);
 } finally {
 setIsSubmitting(false);
 }
 };

 const handleEdit = (post: CommunityPost) => {
 setActiveTab(post.type);
 setContent(post.content);
 setImageUrl(post.imageUrl || '');
 if (post.type === 'poll' && post.pollOptions) {
 setPollOptions(post.pollOptions);
 } else {
 setPollOptions([{ id: '1', text: '' }, { id: '2', text: '' }]);
 }
 if (post.type === 'event' && post.eventDetails) {
 setEventTitle(post.eventDetails.title);
 setEventDate(post.eventDetails.date);
 setEventTime(post.eventDetails.time);
 setEventLocation(post.eventDetails.location);
    } else {
      setEventTitle('');
      setEventDate('');
      setEventTime('');
      setEventLocation('');
    }
    setEditingPostId(post.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

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
 {/* Composer */}
 {errorMessage && (
 <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-medium border border-red-100">
 {errorMessage}
 </div>
 )}
 <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
 <div className="flex items-center gap-6 border-b border-gray-100 pb-3 mb-4">
 <button 
 onClick={() => setActiveTab('post')}
 className={`flex items-center gap-2 text-sm font-medium transition-colors ${activeTab === 'post' ? 'text-[#d4a017] border-b-2 border-[#d4a017] pb-3 -mb-[13px]' : 'text-gray-500 hover:text-gray-700 :text-gray-200'}`}
 >
 <MessageSquare size={16} />
 Post
 </button>
 <button 
 onClick={() => setActiveTab('poll')}
 className={`flex items-center gap-2 text-sm font-medium transition-colors ${activeTab === 'poll' ? 'text-[#d4a017] border-b-2 border-[#d4a017] pb-3 -mb-[13px]' : 'text-gray-500 hover:text-gray-700 :text-gray-200'}`}
 >
 <BarChart2 size={16} />
 Poll
 </button>
 <button 
 onClick={() => setActiveTab('event')}
 className={`flex items-center gap-2 text-sm font-medium transition-colors ${activeTab === 'event' ? 'text-[#d4a017] border-b-2 border-[#d4a017] pb-3 -mb-[13px]' : 'text-gray-500 hover:text-gray-700 :text-gray-200'}`}
 >
 <CalendarIcon size={16} />
 Event
 </button>
 </div>

 <div className="space-y-3">
 <textarea
 value={content}
 onChange={(e) => setContent(e.target.value)}
 placeholder={activeTab === 'poll' ? "Ask a question..." : activeTab === 'event' ? "Event description..." : "Share an update with the community..."}
 className="w-full bg-transparent border-none focus:ring-0 resize-none text-gray-900 placeholder-gray-400 text-sm min-h-[60px] p-0"
 />

 {activeTab === 'poll' && (
 <div className="space-y-2">
 {pollOptions.map((option, index) => (
 <div key={option.id} className="flex items-center gap-2">
 <input
 type="text"
 value={option.text}
 onChange={(e) => {
 const newOptions = [...pollOptions];
 newOptions[index].text = e.target.value;
 setPollOptions(newOptions);
 }}
 placeholder={`Option ${index + 1}`}
 className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:ring-1 focus:ring-[#d4a017] outline-none"
 />
 {pollOptions.length > 2 && (
 <button 
 onClick={() => setPollOptions(pollOptions.filter(o => o.id !== option.id))}
 className="p-2 text-gray-400 hover:text-red-500"
 >
 <X size={16} />
 </button>
 )}
 </div>
 ))}
 {pollOptions.length < 5 && (
 <button 
 onClick={() => setPollOptions([...pollOptions, { id: Date.now().toString(), text: '' }])}
 className="text-sm text-[#d4a017] font-medium hover:underline"
 >
 + Add option
 </button>
 )}
 </div>
 )}

 {activeTab === 'event' && (
 <div className="space-y-3 bg-gray-50 p-3 rounded-xl border border-gray-100 ">
 <input
 type="text"
 value={eventTitle}
 onChange={(e) => setEventTitle(e.target.value)}
 placeholder="Event Title"
 className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:ring-1 focus:ring-[#d4a017] outline-none"
 />
 <div className="flex gap-2">
 <input
 type="date"
 value={eventDate}
 onChange={(e) => setEventDate(e.target.value)}
 className="flex-1 h-[38px] px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:ring-1 focus:ring-[#d4a017] outline-none"
 />
 <input
 type="time"
 value={eventTime}
 onChange={(e) => setEventTime(e.target.value)}
 className="flex-1 h-[38px] px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:ring-1 focus:ring-[#d4a017] outline-none"
 />
 </div>
 <input
 type="text"
 value={eventLocation}
 onChange={(e) => setEventLocation(e.target.value)}
 placeholder="Location"
 className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:ring-1 focus:ring-[#d4a017] outline-none"
 />
 </div>
 )}

 {(activeTab === 'post' || activeTab === 'event') && (
 <div className="flex flex-col gap-2">
 <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
 <ImageIcon size={18} className="text-gray-400" />
 Attached Image
 </label>
 <ImageUpload value={imageUrl} onChange={setImageUrl} placeholder="Upload or paste image URL here (optional)" />
 </div>
 )}



        <div className="flex justify-end pt-2 border-t border-gray-100 gap-2">
 {editingPostId && (
 <button
 onClick={() => {
 setEditingPostId(null);
 setContent('');
 setImageUrl('');
 setPollOptions([{ id: '1', text: '' }, { id: '2', text: '' }]);
 setEventTitle('');
 setEventDate('');
 setEventTime('');
 setEventLocation('');

}}
                className="px-4 py-2 text-gray-500 hover:bg-gray-100 :bg-gray-800 rounded-lg font-medium text-sm transition-colors"
 >
 Cancel
 </button>
 )}
 <button
 onClick={handlePost}
 disabled={isSubmitting || (!content.trim() && activeTab !== 'event')}
 className="flex items-center gap-2 px-6 py-2 bg-[#e6b325] text-white rounded-lg font-medium text-sm hover:bg-[#d4a017] transition-colors disabled:opacity-50"
 >
 <Send size={16} />
 {editingPostId ? 'Update' : 'Post'}
 </button>
 </div>
 </div>
 </div>

 {/* Feed */}
 <div className="space-y-4">
 {loading ? (
 <div className="flex justify-center py-8">
 <div className="w-8 h-8 border-4 border-[#d4a017] border-t-transparent rounded-full animate-spin"></div>
 </div>
 ) : posts.length === 0 ? (
 <div className="text-center py-8 text-gray-500">No posts yet.</div>
 ) : (
 posts.map(post => (
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
 <div className="relative group">
 <button className="p-1 text-gray-400 hover:text-gray-600 :text-gray-300 rounded-full hover:bg-gray-100 :bg-gray-800">
 <MoreVertical size={16} />
 </button>
 <div className="absolute right-0 mt-1 w-32 bg-white rounded-lg shadow-lg border border-gray-100 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
 <button 
 onClick={() => handlePin(post.id, post.isPinned)}
 className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 :bg-gray-800 rounded-t-lg"
 >
 {post.isPinned ? 'Unpin Post' : 'Pin Post'}
 </button>
 <button 
 onClick={() => handleEdit(post)}
 className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 :bg-gray-800"
 >
 Edit
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

 <p className="text-gray-800 text-sm whitespace-pre-wrap mb-3">
 {post.content}
 </p>

 {post.imageUrl && (
 <div className="rounded-xl overflow-hidden mb-3 max-h-80 bg-gray-100 relative min-h-[200px]">
 <Image src={post.imageUrl} alt="Post attachment" fill sizes="100vw" className="object-cover" referrerPolicy="no-referrer" />
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
 {post.eventDetails.attendeeDetails && post.eventDetails.attendeeDetails.length > 0 && (
 <button 
 onClick={() => downloadCSV(post)} 
 className="ml-2 text-[#d4a017] hover:underline font-medium"
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

 <div className="flex items-center gap-4 pt-3 border-t border-gray-100 text-gray-500">
 <button 
 onClick={() => handleLike(post.id, post.likes)}
 className={`flex items-center gap-1.5 text-sm transition-colors ${
 auth.currentUser && post.likes.includes(auth.currentUser.uid)
 ? 'text-[#d4a017]'
 : 'hover:text-[#d4a017]'
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
 <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 border border-gray-100 ">
 <h3 className="text-xl font-bold text-gray-900 mb-2">Delete Post</h3>
 <p className="text-gray-500 mb-6">
 Are you sure you want to delete this post? This action cannot be undone.
 </p>
 <div className="flex justify-end gap-3">
 <button
 onClick={() => setDeleteConfirmId(null)}
 className="px-4 py-2 text-gray-600 hover:bg-gray-100 :bg-gray-800 rounded-xl font-medium transition-colors"
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
