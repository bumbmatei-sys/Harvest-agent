'use client';

import { useEffect, useState } from 'react';
import {
  addDoc, collection, doc, getDoc, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where,
} from 'firebase/firestore';
import { auth, db } from '@/firebase';
import { authFetch } from '@/utils/auth-fetch';
import { COMMUNITY_CONSENT_VERSION } from '@/lib/community-membership';
import { readCommunityRecord, type CommunityRecord } from './communities';

/**
 * The member side of a community other than a ministry's default one (#576).
 * Every read here is one the #571 rules allow: the record when it is published
 * (public) or the reader is a member, and posts and chat only for members.
 */

export type Load<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

export const communityRef = (tenantId: string, communityId: string) => doc(db, 'tenants', tenantId, 'communities', communityId);

/** The community record, or null when it does not exist or this reader may not see it. */
export function useCommunityRecord(tenantId: string, communityId: string): Load<CommunityRecord | null> {
  const [state, setState] = useState<Load<CommunityRecord | null>>({ status: 'loading' });
  useEffect(() => {
    setState({ status: 'loading' });
    return onSnapshot(communityRef(tenantId, communityId), snapshot => {
      if (!snapshot.exists()) { setState({ status: 'ready', data: null }); return; }
      try { setState({ status: 'ready', data: readCommunityRecord(communityId, snapshot.data()) }); }
      catch { setState({ status: 'error', message: 'This community could not be read.' }); }
    }, () => setState({ status: 'ready', data: null }));
  }, [tenantId, communityId]);
  return state;
}

/** Whether the signed-in user is an active member. */
export function useIsMember(tenantId: string, communityId: string, uid: string | undefined): Load<boolean> {
  const [state, setState] = useState<Load<boolean>>({ status: 'loading' });
  useEffect(() => {
    if (!uid) { setState({ status: 'ready', data: false }); return; }
    setState({ status: 'loading' });
    return onSnapshot(doc(communityRef(tenantId, communityId), 'members', uid),
      snapshot => setState({ status: 'ready', data: snapshot.exists() && snapshot.data().status === 'active' }),
      () => setState({ status: 'error', message: 'Could not check your membership.' }));
  }, [tenantId, communityId, uid]);
  return state;
}

export async function changeMembership(tenantId: string, communityId: string, joining: boolean) {
  const response = await authFetch(`/api/communities/${communityId}/membership`, {
    method: joining ? 'POST' : 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(joining ? { tenantId, consent: true, acceptedConsentVersion: COMMUNITY_CONSENT_VERSION } : { tenantId }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Could not update your membership. Please try again.');
}

/** The byline the rules accept: the profile name, else the account name, else "Member". */
export async function memberByline(): Promise<{ name: string; photo: string }> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to post.');
  const profile = await getDoc(doc(db, 'users', user.uid));
  const data = profile.exists() ? profile.data() : {};
  const name = typeof data.displayName === 'string' && data.displayName ? data.displayName : (user.displayName || 'Member');
  return { name, photo: typeof data.photoURL === 'string' ? data.photoURL : '' };
}

export type SpacePost = { id: string; authorId: string; authorName: string; authorPhoto: string; content: string; createdAt: Date | null };

const toDate = (value: unknown) => value && typeof (value as { toDate?: () => Date }).toDate === 'function' ? (value as { toDate: () => Date }).toDate() : null;

/** The newest 50 posts, newest first: an ordered, bounded read. */
export function usePosts(tenantId: string, communityId: string): Load<SpacePost[]> {
  const [state, setState] = useState<Load<SpacePost[]>>({ status: 'loading' });
  useEffect(() => {
    setState({ status: 'loading' });
    const q = query(collection(communityRef(tenantId, communityId), 'posts'), orderBy('createdAt', 'desc'), limit(50));
    return onSnapshot(q, snapshot => setState({ status: 'ready', data: snapshot.docs.map(d => {
      const data = d.data();
      return { id: d.id, authorId: String(data.authorId ?? ''), authorName: String(data.authorName ?? 'Member'), authorPhoto: String(data.authorPhoto ?? ''), content: String(data.content ?? ''), createdAt: toDate(data.createdAt) };
    }) }), () => setState({ status: 'error', message: 'Could not load posts. Please try again.' }));
  }, [tenantId, communityId]);
  return state;
}

export async function createPost(tenantId: string, communityId: string, content: string) {
  const text = content.trim();
  if (!text) throw new Error('Write something first.');
  if (text.length > 500) throw new Error('Posts can be up to 500 characters.');
  const byline = await memberByline();
  await addDoc(collection(communityRef(tenantId, communityId), 'posts'), {
    authorId: auth.currentUser!.uid, authorName: byline.name, authorPhoto: byline.photo,
    content: text, type: 'post', tenantId, communityId, createdAt: serverTimestamp(),
  });
}

export type SpaceChannel = { id: string; name: string; lastMessage: string };

export function useChannels(tenantId: string, communityId: string): Load<SpaceChannel[]> {
  const [state, setState] = useState<Load<SpaceChannel[]>>({ status: 'loading' });
  useEffect(() => {
    setState({ status: 'loading' });
    // Only channels everyone is in: the rules refuse a list that could include a private one.
    const q = query(collection(communityRef(tenantId, communityId), 'channels'), where('audience', '==', 'all'));
    return onSnapshot(q, snapshot => setState({ status: 'ready', data: snapshot.docs
      .map(d => ({ id: d.id, name: String(d.data().name ?? 'Chat'), lastMessage: String(d.data().lastMessage ?? '') }))
      .sort((a, b) => a.id === 'general' ? -1 : b.id === 'general' ? 1 : a.name.localeCompare(b.name)) }),
    () => setState({ status: 'error', message: 'Could not load chats. Please try again.' }));
  }, [tenantId, communityId]);
  return state;
}

export type SpaceMessage = { id: string; senderId: string; senderName: string; content: string; createdAt: Date | null };

/** The latest 300 messages of a channel, oldest first (single-field filter, sorted here). */
export function useMessages(tenantId: string, communityId: string, channelId: string | null): Load<SpaceMessage[]> {
  const [state, setState] = useState<Load<SpaceMessage[]>>({ status: 'loading' });
  useEffect(() => {
    if (!channelId) { setState({ status: 'ready', data: [] }); return; }
    setState({ status: 'loading' });
    const q = query(collection(communityRef(tenantId, communityId), 'channelMessages'), where('channelId', '==', channelId), limit(300));
    return onSnapshot(q, snapshot => {
      const data = snapshot.docs.map(d => ({ id: d.id, senderId: String(d.data().senderId ?? ''), senderName: String(d.data().senderName ?? 'Member'), content: String(d.data().content ?? ''), createdAt: toDate(d.data().createdAt) }));
      data.sort((a, b) => (a.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER));
      setState({ status: 'ready', data });
    }, () => setState({ status: 'error', message: 'Could not load messages. Please try again.' }));
  }, [tenantId, communityId, channelId]);
  return state;
}

export async function sendMessage(tenantId: string, communityId: string, channelId: string, content: string) {
  const text = content.trim();
  if (!text) return;
  const byline = await memberByline();
  await addDoc(collection(communityRef(tenantId, communityId), 'channelMessages'), {
    channelId, senderId: auth.currentUser!.uid, senderName: byline.name, senderRole: 'user',
    content: text, createdAt: serverTimestamp(), edited: false,
  });
  // The preview is best effort: the message itself is what matters.
  await updateDoc(doc(communityRef(tenantId, communityId), 'channels', channelId), { lastMessage: text.slice(0, 140), lastMessageAt: serverTimestamp() }).catch(() => {});
}
