"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, arrayUnion, arrayRemove, limit, where, getDoc, addDoc, deleteDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Calendar as CalendarIcon, ThumbsUp, Check, ChevronRight, FileText, Tag, Calendar, MessageSquare, Send, Trash2, MapPin, Globe } from 'lucide-react';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope } from '../utils/tenant-scope';
import CampaignWidget from './CampaignWidget';
import { sortByTime } from '../utils/query-helpers';

interface Comment {
  id: string;
  authorId: string;
  authorName: string;
  authorPhoto?: string;
  content: string;
  createdAt: string;
}

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

interface AdminEvent {
  id: string;
  title: string;
  description: string;
  coverImage: string | null;
  location: string;
  isOnline: boolean;
  onlineLink: string | null;
  startDate: Timestamp | null;
  endDate: Timestamp | null;
  price: number;
  currency: string;
  status: string;
  pinned?: boolean;
}

interface NewsTabProps {
  onOpenAllNews: () => void;
  onOpenArticle: (post: BlogPost) => void;
}

const NewsTab: React.FC<NewsTabProps> = ({ onOpenAllNews, onOpenArticle }) => {
  const [allPosts, setAllPosts] = useState<CommunityPost[]>([]);
  const [articles, setArticles] = useState<BlogPost[]>([]);
  const [adminEvents, setAdminEvents] = useState<AdminEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [userLocation, setUserLocation] = useState<{country?: string, city?: string} | null>(null);

  // Event attendance modal state (legacy community post events)
  const [attendingPostId, setAttendingPostId] = useState<string | null>(null);
  const [attendeeName, setAttendeeName] = useState('');
  const [attendeeEmail, setAttendeeEmail] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // AdminEvents registration modal
  const [registeringEvent, setRegisteringEvent] = useState<AdminEvent | null>(null);
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regLoading, setRegLoading] = useState(false);

  // Comments state
  const [commentsOpen, setCommentsOpen] = useState<Record<string, boolean>>({});
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const [postComments, setPostComments] = useState<Record<string, Comment[]>>({});


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

  // Subscribe to comments for open posts
  useEffect(() => {
    const unsubs: (() => void)[] = [];
    Object.entries(commentsOpen).forEach(([postId, isOpen]) => {
      if (!isOpen) return;
      const q = query(collection(db, 'community_posts', postId, 'comments'), orderBy('createdAt', 'asc'));
      const unsub = onSnapshot(q, (snap) => {
        setPostComments(prev => ({
          ...prev,
          [postId]: snap.docs.map(d => ({ id: d.id, ...d.data() } as Comment))
        }));
      }, (error) => {
        console.error('Failed to subscribe to comments:', error);
      });
      unsubs.push(unsub);
    });
    return () => { unsubs.forEach(u => u()); };
  }, [commentsOpen]);

  useEffect(() => {
    let cancelled = false;
    let unsubCommunity: (() => void) | null = null;
    let unsubArticles: (() => void) | null = null;
    let unsubEvents: (() => void) | null = null;
    (async () => {
      const tenantId = await getTenantScope();
      if (cancelled) return;

      // Fetch all posts to ensure pinned posts are included, then slice
      // Single-field filter only (tenantId); sort client-side to avoid a composite index.
      const communityQ = tenantId
        ? query(collection(db, 'community_posts'), where('tenantId', '==', tenantId), limit(50))
        : query(collection(db, 'community_posts'), limit(50));

      unsubCommunity = onSnapshot(communityQ, (snapshot) => {
        const postsData = sortByTime(snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as CommunityPost[], 'createdAt', 'desc');

        const sortedPosts = [...postsData].sort((a, b) => {
          if (a.isPinned && !b.isPinned) return -1;
          if (!a.isPinned && b.isPinned) return 1;
          return 0;
        });

        setAllPosts(sortedPosts);
        setLoading(false);
      }, (error) => {
        console.error('Failed to load community posts:', error);
        setLoading(false);
      });

      // Fetch articles
      // Single-field filter only (status); tenant filter + sort applied client-side.
      const articlesQ = tenantId
        ? query(collection(db, 'blog_posts'), where('tenantId', '==', tenantId), limit(50))
        : query(collection(db, 'blog_posts'), where('status', '==', 'published'), limit(50));

      unsubArticles = onSnapshot(articlesQ, (snapshot) => {
        let articlesData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as BlogPost[];
        articlesData = articlesData.filter(a => (a as any).status === 'published');
        setArticles(sortByTime(articlesData, 'publishedAt', 'desc').slice(0, 5));
      }, (error) => {
        console.error('Failed to load articles:', error);
      });

      // Fetch published events from AdminEvents system (tenant-scoped only)
      if (tenantId) {
        // Single-field filter only (status); sort client-side to avoid a composite index.
        const eventsQ = query(
          collection(db, 'tenants', tenantId, 'events'),
          where('status', '==', 'published'),
          limit(30)
        );
        unsubEvents = onSnapshot(eventsQ, (snap) => {
          const evs = sortByTime(snap.docs.map(d => ({ id: d.id, ...d.data() })) as AdminEvent[], 'startDate', 'asc');
          // Sort: pinned first, then by startDate (already startDate-ordered above)
          const sorted = [...evs].sort((a, b) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            return 0;
          });
          setAdminEvents(sorted);
        }, (err) => {
          console.error('Failed to load events:', err);
        });
      }
    })();

    return () => {
      cancelled = true;
      if (unsubCommunity) unsubCommunity();
      if (unsubArticles) unsubArticles();
      if (unsubEvents) unsubEvents();
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
      const userDetail = attendeeDetails?.find((d: any) => d.uid === user.uid);
      
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

  const handleComment = async (postId: string) => {
    const text = (commentInputs[postId] || '').trim();
    if (!text || text.length > 280) return;
    const user = auth.currentUser;
    if (!user) {
      setErrorMessage('Please sign in to comment');
      setTimeout(() => setErrorMessage(null), 3000);
      return;
    }
    try {
      const tenantId = await getTenantScope();
      await addDoc(collection(db, 'community_posts', postId, 'comments'), {
        authorId: user.uid,
        authorName: user.displayName || 'Member',
        authorPhoto: user.photoURL || '',
        content: text,
        createdAt: new Date().toISOString(),
        tenantId: tenantId || null,
      });
      setCommentInputs(prev => ({ ...prev, [postId]: '' }));
    } catch (error) {
      try { handleFirestoreError(error, OperationType.WRITE, 'comments'); } catch (e) { console.error(e); }
    }
  };

  const handleDeleteComment = async (postId: string, commentId: string) => {
    try {
      await deleteDoc(doc(db, 'community_posts', postId, 'comments', commentId));
    } catch (error) {
      try { handleFirestoreError(error, OperationType.DELETE, 'comments'); } catch (e) { console.error(e); }
    }
  };

  const toggleComments = (postId: string) => {
    setCommentsOpen(prev => ({ ...prev, [postId]: !prev[postId] }));
  };

  const fmtEventDate = (ts: Timestamp | null) => {
    if (!ts) return '';
    return ts.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const handleRegister = async () => {
    if (!registeringEvent || !regName.trim() || !regEmail.trim()) return;
    setRegLoading(true);
    try {
      const tenantId = await getTenantScope();
      if (!tenantId) return;
      const ticketCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      await addDoc(collection(db, 'tenants', tenantId, 'registrations'), {
        eventId: registeringEvent.id,
        userId: auth.currentUser?.uid || null,
        name: regName.trim(),
        email: regEmail.trim(),
        phone: null,
        ticketCode,
        status: 'confirmed',
        amount: registeringEvent.price || 0,
        registeredAt: serverTimestamp(),
      });
      setRegisteringEvent(null);
      setRegName('');
      setRegEmail('');
      setErrorMessage('Registration confirmed! Ticket code: ' + ticketCode);
      setTimeout(() => setErrorMessage(null), 5000);
    } catch (e) {
      console.error(e);
      setErrorMessage('Registration failed. Please try again.');
      setTimeout(() => setErrorMessage(null), 3000);
    } finally {
      setRegLoading(false);
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
        <div className="w-8 h-8 border-4 border-gold border-t-transparent rounded-full animate-spin"></div>
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

      {/* Fundraising campaign widget — pinned at the top, disappears when no campaign is active */}
      <CampaignWidget />

      {/* Pinned events from AdminEvents system */}
      {adminEvents.filter(e => e.pinned).map(event => (
        <div key={event.id} className="bg-white rounded-2xl shadow-sm border border-[color-mix(in_srgb,var(--brand-color)_30%,transparent)] overflow-hidden">
          {event.coverImage && (
            <div className="relative h-36 bg-gray-100">
              <Image src={event.coverImage} alt={event.title} fill sizes="(max-width:768px) 100vw, 800px" className="object-cover" referrerPolicy="no-referrer" />
            </div>
          )}
          <div className="p-4">
            <span className="inline-flex items-center text-[10px] font-bold text-gold bg-[#fcefc7] px-2 py-0.5 rounded-full mb-2">Pinned Event</span>
            <h3 className="font-bold text-gray-900 text-base mb-1">{event.title}</h3>
            {event.description ? <p className="text-sm text-gray-500 line-clamp-2 mb-3">{event.description}</p> : null}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mb-3">
              {event.startDate && <span className="flex items-center gap-1"><CalendarIcon size={12} />{fmtEventDate(event.startDate)}</span>}
              {event.isOnline
                ? <span className="flex items-center gap-1"><Globe size={12} />Online</span>
                : event.location && <span className="flex items-center gap-1"><MapPin size={12} />{event.location}</span>}
              <span className="font-medium">{event.price > 0 ? `$${event.price}` : 'Free'}</span>
            </div>
            <button
              onClick={() => setRegisteringEvent(event)}
              className="w-full py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--brand-color, #e6b325)' }}
            >
              Register
            </button>
          </div>
        </div>
      ))}

      <div className="flex items-center justify-between px-1 mb-2">
        <h2 className="text-xl font-bold text-gray-900 ">News & Updates</h2>
        {posts.length >= 3 && (
          <button 
            onClick={onOpenAllNews}
            className="flex items-center gap-1 text-sm font-medium text-gold hover:text-[#e6b325] transition-colors"
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
                      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-gold bg-[#fcefc7] px-2 py-0.5 rounded-full">
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
                          ? 'border-gold bg-[#fcefc7]/50 ' 
                          : 'border-gray-200 bg-gray-50 hover:border-gold'
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
                          {userVotedThis && <Check size={14} className="text-gold" />}
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
                        : 'bg-[#e6b325] text-white hover:bg-gold'
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
                    ? 'text-gold'
                    : 'text-gray-500 hover:text-gold'
                }`}
              >
                <ThumbsUp size={16} className={auth.currentUser && post.likes.includes(auth.currentUser.uid) ? 'fill-current' : ''} />
                <span>{post.likes.length} Likes</span>
              </button>
              <button
                onClick={() => toggleComments(post.id)}
                className={`flex items-center gap-1.5 text-xs transition-colors ${
                  commentsOpen[post.id] ? 'text-gold' : 'text-gray-500 hover:text-gold'
                }`}
              >
                <MessageSquare size={16} />
                <span>{postComments[post.id]?.length ?? 0} Comments</span>
              </button>
            </div>

            {/* Comments Section */}
            {commentsOpen[post.id] && (
              <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
                {postComments[post.id]?.map(comment => (
                  <div key={comment.id} className="flex items-start gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-gray-200 overflow-hidden flex items-center justify-center text-xs font-bold text-gray-600 flex-shrink-0 relative">
                      {comment.authorPhoto ? (
                        <Image src={comment.authorPhoto} alt={comment.authorName} fill sizes="28px" className="object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        comment.authorName.charAt(0)
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-900">{comment.authorName}</span>
                        <span className="text-[10px] text-gray-400">
                          {new Date(comment.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                        {auth.currentUser && comment.authorId === auth.currentUser.uid && (
                          <button
                            onClick={() => handleDeleteComment(post.id, comment.id)}
                            className="ml-auto text-gray-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-gray-700 whitespace-pre-wrap">{comment.content}</p>
                    </div>
                  </div>
                ))}
                {postComments[post.id]?.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-1">No comments yet</p>
                )}
                {auth.currentUser && (
                  <div className="flex items-center gap-2 pt-2">
                    <div className="w-7 h-7 rounded-full bg-gray-200 overflow-hidden flex items-center justify-center text-xs font-bold text-gray-600 flex-shrink-0 relative">
                      {auth.currentUser.photoURL ? (
                        <Image src={auth.currentUser.photoURL} alt="You" fill sizes="28px" className="object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        (auth.currentUser.displayName || 'Y').charAt(0)
                      )}
                    </div>
                    <input
                      type="text"
                      value={commentInputs[post.id] || ''}
                      onChange={(e) => setCommentInputs(prev => ({ ...prev, [post.id]: e.target.value.slice(0, 280) }))}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleComment(post.id); } }}
                      placeholder="Write a comment..."
                      maxLength={280}
                      className="flex-1 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-full text-xs text-gray-900 focus:ring-1 focus:ring-gold outline-none"
                    />
                    <button
                      onClick={() => handleComment(post.id)}
                      disabled={!(commentInputs[post.id] || '').trim()}
                      className="p-1.5 text-gold hover:text-[#e6b325] disabled:opacity-30 transition-colors"
                    >
                      <Send size={16} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))
      )}

      {/* Upcoming Events (non-pinned) */}
      {adminEvents.filter(e => !e.pinned).length > 0 && (
        <div className="mt-4">
          <h2 className="text-xl font-bold text-gray-900 px-1 mb-3">Upcoming Events</h2>
          <div className="space-y-3">
            {adminEvents.filter(e => !e.pinned).map(event => (
              <div key={event.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                {event.coverImage && (
                  <div className="relative h-32 bg-gray-100">
                    <Image src={event.coverImage} alt={event.title} fill sizes="(max-width:768px) 100vw, 800px" className="object-cover" referrerPolicy="no-referrer" />
                  </div>
                )}
                <div className="p-4">
                  <h3 className="font-bold text-gray-900 text-base mb-1">{event.title}</h3>
                  {event.description ? <p className="text-sm text-gray-500 line-clamp-2 mb-3">{event.description}</p> : null}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mb-3">
                    {event.startDate && <span className="flex items-center gap-1"><CalendarIcon size={12} />{fmtEventDate(event.startDate)}</span>}
                    {event.isOnline
                      ? <span className="flex items-center gap-1"><Globe size={12} />Online</span>
                      : event.location && <span className="flex items-center gap-1"><MapPin size={12} />{event.location}</span>}
                    <span className="font-medium">{event.price > 0 ? `$${event.price}` : 'Free'}</span>
                  </div>
                  <button
                    onClick={() => setRegisteringEvent(event)}
                    className="w-full py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
                    style={{ backgroundColor: 'var(--brand-color, #e6b325)' }}
                  >
                    Register
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
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

      {/* AdminEvents Registration Modal */}
      {registeringEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-xl font-bold text-gray-900 mb-1">Register for Event</h3>
            <p className="text-sm text-gray-500 mb-4">{registeringEvent.title}</p>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  type="text"
                  value={regName}
                  onChange={e => setRegName(e.target.value)}
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:ring-2 focus:ring-gold outline-none"
                  placeholder="Your full name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                <input
                  type="email"
                  value={regEmail}
                  onChange={e => setRegEmail(e.target.value)}
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:ring-2 focus:ring-gold outline-none"
                  placeholder="your@email.com"
                />
              </div>
              {registeringEvent.price > 0 && (
                <p className="text-sm text-gray-500 bg-gray-50 rounded-xl p-3">
                  Ticket price: <strong>${registeringEvent.price}</strong> — payment will be collected at the event.
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setRegisteringEvent(null); setRegName(''); setRegEmail(''); }}
                className="flex-1 px-4 py-2 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRegister}
                disabled={regLoading || !regName.trim() || !regEmail.trim()}
                className="flex-1 px-4 py-2 text-white rounded-xl font-medium transition-colors disabled:opacity-50"
                style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
              >
                {regLoading ? 'Registering…' : 'Confirm'}
              </button>
            </div>
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
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:ring-2 focus:ring-gold outline-none"
                  placeholder="John Doe"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                <input
                  type="email"
                  value={attendeeEmail}
                  onChange={(e) => setAttendeeEmail(e.target.value)}
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:ring-2 focus:ring-gold outline-none"
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
                className="flex-1 px-4 py-2 bg-gold text-white rounded-xl font-medium hover:bg-[#e6b325] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
