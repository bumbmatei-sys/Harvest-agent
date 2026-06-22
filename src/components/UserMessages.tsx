"use client";
import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Send, MessageSquare } from 'lucide-react';
import {
  collection, query, where, orderBy, onSnapshot, addDoc, updateDoc, doc,
  serverTimestamp, limit, Timestamp
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { getTenantScope } from '../utils/tenant-scope';

interface DirectMessage {
  id: string;
  participants: string[];
  participantRoles: Record<string, string>;
  participantNames?: Record<string, string>;
  lastMessage: string;
  lastMessageAt: Timestamp | null;
  initiatedBy: string;
}

interface DmMessage {
  id: string;
  dmId: string;
  senderId: string;
  senderName: string;
  content: string;
  createdAt: Timestamp | null;
  read: boolean;
}

const fmtTime = (ts: Timestamp | null) => {
  if (!ts) return '';
  const d = ts.toDate();
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const DmThread: React.FC<{
  dm: DirectMessage;
  tenantId: string;
  currentUser: { uid: string; name: string };
  otherName: string;
  onBack: () => void;
}> = ({ dm, tenantId, currentUser, otherName, onBack }) => {
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'tenants', tenantId, 'dmMessages'),
      where('dmId', '==', dm.id),
      orderBy('createdAt', 'asc'),
      limit(200)
    );
    return onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() }) as DmMessage));
      // Mark unread as read
      snap.docs.forEach(d => {
        const data = d.data();
        if (!data.read && data.senderId !== currentUser.uid) {
          updateDoc(doc(db, 'tenants', tenantId, 'dmMessages', d.id), { read: true }).catch(() => {});
        }
      });
    });
  }, [dm.id, tenantId, currentUser.uid]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const content = text.trim();
      await addDoc(collection(db, 'tenants', tenantId, 'dmMessages'), {
        dmId: dm.id,
        senderId: currentUser.uid,
        senderName: currentUser.name,
        content,
        createdAt: serverTimestamp(),
        read: false,
      });
      await updateDoc(doc(db, 'tenants', tenantId, 'directMessages', dm.id), {
        lastMessage: content,
        lastMessageAt: serverTimestamp(),
      });
      setText('');
    } catch (e) { console.error(e); }
    finally { setSending(false); }
  };

  return (
    <div className="flex flex-col h-full bg-[#F7F6F3]">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-white">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100">
          <ArrowLeft size={18} className="text-gray-600" />
        </button>
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
          style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}>
          {otherName.charAt(0).toUpperCase()}
        </div>
        <p className="font-bold text-gray-900 text-sm">{otherName}</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <MessageSquare size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No messages yet</p>
          </div>
        )}
        {messages.map(m => {
          const isMine = m.senderId === currentUser.uid;
          return (
            <div key={m.id} className={`flex gap-3 ${isMine ? 'flex-row-reverse' : ''}`}>
              <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
                style={{ backgroundColor: isMine ? 'var(--brand-color, #B8962E)' : '#6b7280' }}>
                {m.senderName.charAt(0).toUpperCase()}
              </div>
              <div className={`max-w-[72%] ${isMine ? 'items-end' : 'items-start'} flex flex-col`}>
                <p className={`text-sm px-3 py-2 rounded-2xl ${isMine ? 'rounded-tr-sm text-white' : 'rounded-tl-sm text-gray-700 bg-white border border-gray-100 shadow-sm'}`}
                  style={isMine ? { backgroundColor: 'var(--brand-color, #B8962E)' } : undefined}>
                  {m.content}
                </p>
                <span className="text-[10px] text-gray-400 mt-0.5">{fmtTime(m.createdAt)}</span>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="p-4 bg-white border-t border-gray-100">
        <div className="flex gap-2 items-center bg-gray-50 rounded-2xl px-3 py-2 border border-gray-200">
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
            placeholder="Type a message..."
            className="flex-1 bg-transparent outline-none text-sm text-gray-900 placeholder-gray-400"
          />
          <button
            onClick={send}
            disabled={!text.trim() || sending}
            className="w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-40 transition-opacity"
            style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}
          >
            <Send size={14} className="text-white" />
          </button>
        </div>
      </div>
    </div>
  );
};

interface UserMessagesProps {
  onBack: () => void;
}

const UserMessages: React.FC<UserMessagesProps> = ({ onBack }) => {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<{ uid: string; name: string } | null>(null);
  const [dms, setDms] = useState<DirectMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDm, setOpenDm] = useState<DirectMessage | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTenantScope().then(async tid => {
      if (cancelled) return;
      setTenantId(tid);
      if (!auth.currentUser) { setLoading(false); return; }
      const { getDoc } = await import('firebase/firestore');
      const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
      const name = userDoc.exists()
        ? (userDoc.data().displayName || auth.currentUser.displayName || 'You')
        : (auth.currentUser.displayName || 'You');
      if (cancelled) return;
      setCurrentUser({ uid: auth.currentUser.uid, name });
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!tenantId || !currentUser) return;
    const q = query(
      collection(db, 'tenants', tenantId, 'directMessages'),
      where('participants', 'array-contains', currentUser.uid),
      orderBy('lastMessageAt', 'desc'),
      limit(50)
    );
    return onSnapshot(q, snap => {
      setDms(snap.docs.map(d => ({ id: d.id, ...d.data() }) as DirectMessage));
    });
  }, [tenantId, currentUser]);

  const getOtherName = (dm: DirectMessage): string => {
    if (!currentUser) return 'Admin';
    const otherId = dm.participants.find(p => p !== currentUser.uid) || '';
    return (dm as any).participantNames?.[otherId] || 'Admin';
  };

  const getUnreadCount = (dm: DirectMessage): number => 0; // simplified

  if (loading) {
    return (
      <div className="flex flex-col min-h-full bg-[#F7F6F3]">
        <div className="flex items-center gap-3 px-4 py-4 bg-white border-b border-gray-100">
          <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100">
            <ArrowLeft size={18} className="text-gray-600" />
          </button>
          <h2 className="text-lg font-bold text-gray-900">Messages</h2>
        </div>
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: 'var(--brand-color, #B8962E)', borderTopColor: 'transparent' }} />
        </div>
      </div>
    );
  }

  if (openDm && tenantId && currentUser) {
    return (
      <div className="flex flex-col h-full">
        <DmThread
          dm={openDm}
          tenantId={tenantId}
          currentUser={currentUser}
          otherName={getOtherName(openDm)}
          onBack={() => setOpenDm(null)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full bg-[#F7F6F3]">
      <div className="flex items-center gap-3 px-4 py-4 bg-white border-b border-gray-100">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100">
          <ArrowLeft size={18} className="text-gray-600" />
        </button>
        <h2 className="text-lg font-bold text-gray-900">Messages</h2>
      </div>

      <div className="flex-1 p-4">
        {dms.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <MessageSquare size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">No messages yet</p>
            <p className="text-sm mt-1">Messages from your church admins will appear here</p>
          </div>
        ) : (
          <div className="space-y-2">
            {dms.map(dm => (
              <button
                key={dm.id}
                onClick={() => setOpenDm(dm)}
                className="w-full bg-white rounded-2xl px-4 py-3 border border-gray-100 shadow-sm flex items-center gap-3 hover:border-[#B8962E]/30 transition-all text-left"
              >
                <div className="w-11 h-11 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold text-white"
                  style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}>
                  {getOtherName(dm).charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm">{getOtherName(dm)}</p>
                  {dm.lastMessage && <p className="text-xs text-gray-400 truncate">{dm.lastMessage}</p>}
                </div>
                {dm.lastMessageAt && <span className="text-[10px] text-gray-400 flex-shrink-0">{fmtTime(dm.lastMessageAt)}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default UserMessages;
