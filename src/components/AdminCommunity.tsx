"use client";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Hash, MessageSquare, Plus, Send, Users, X, Search, ArrowLeft, ChevronRight, Megaphone
} from 'lucide-react';
import {
  collection, query, where, orderBy, onSnapshot, addDoc, updateDoc, doc,
  serverTimestamp, getDocs, limit, Timestamp
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { getTenantScope } from '../utils/tenant-scope';
import { isSuperAdminEmail } from '../utils/super-admins';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { notifyError } from '../utils/notify';

interface Channel {
  id: string;
  name: string;
  description: string;
  createdAt: Timestamp | null;
  createdBy: string;
  type: 'announcement';
}

interface ChannelMessage {
  id: string;
  channelId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  content: string;
  createdAt: Timestamp | null;
  edited: boolean;
}

interface DirectMessage {
  id: string;
  participants: string[];
  participantRoles: Record<string, string>;
  lastMessage: string;
  lastMessageAt: Timestamp | null;
  initiatedBy: string;
  participantNames?: Record<string, string>;
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

interface AdminUser {
  id: string;
  displayName: string;
  email: string;
  role: string;
}

type MainTab = 'channels' | 'admin-dms' | 'member-dms';

const fmtTime = (ts: Timestamp | null) => {
  if (!ts) return '';
  const d = ts.toDate();
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// ─── Channel Thread ────────────────────────────────────────────────

const ChannelThread: React.FC<{
  channel: Channel;
  tenantId: string;
  currentUser: { uid: string; name: string };
  onBack: () => void;
}> = ({ channel, tenantId, currentUser, onBack }) => {
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'tenants', tenantId, 'channelMessages'),
      where('channelId', '==', channel.id),
      orderBy('createdAt', 'asc'),
      limit(200)
    );
    const unsub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() }) as ChannelMessage));
    });
    return unsub;
  }, [channel.id, tenantId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await addDoc(collection(db, 'tenants', tenantId, 'channelMessages'), {
        channelId: channel.id,
        senderId: currentUser.uid,
        senderName: currentUser.name,
        senderRole: 'admin',
        content: text.trim(),
        createdAt: serverTimestamp(),
        edited: false,
      });
      setText('');
    } catch (e) { notifyError('Failed to send message', e); }
    finally { setSending(false); }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-white">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100">
          <ArrowLeft size={18} className="text-gray-600" />
        </button>
        <Hash size={18} style={{ color: 'var(--brand-color, #d4a017)' }} />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-900 text-sm truncate">{channel.name}</p>
          {channel.description && <p className="text-xs text-gray-400 truncate">{channel.description}</p>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <Megaphone size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No messages yet. Be the first to post.</p>
          </div>
        )}
        {messages.map(m => (
          <div key={m.id} className="flex gap-3">
            <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
              style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>
              {m.senderName.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-baseline gap-2 mb-0.5">
                <span className="text-sm font-semibold text-gray-900">{m.senderName}</span>
                <span className="text-[10px] text-gray-400">{fmtTime(m.createdAt)}</span>
              </div>
              <p className="text-sm text-gray-700 bg-white px-3 py-2 rounded-2xl rounded-tl-sm border border-gray-100 shadow-sm max-w-xs lg:max-w-md">
                {m.content}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="p-4 bg-white border-t border-gray-100">
        <div className="flex gap-2 items-center bg-gray-50 rounded-2xl px-3 py-2 border border-gray-200">
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
            placeholder={`Post to #${channel.name}`}
            className="flex-1 bg-transparent outline-none text-sm text-gray-900 placeholder-gray-400"
          />
          <button
            onClick={send}
            disabled={!text.trim() || sending}
            className="w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-40 transition-opacity"
            style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
          >
            <Send size={14} className="text-white" />
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── DM Thread ─────────────────────────────────────────────────────

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
    const unsub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() }) as DmMessage));
    });
    return unsub;
  }, [dm.id, tenantId]);

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
    } catch (e) { notifyError('Failed to send message', e); }
    finally { setSending(false); }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-white">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100">
          <ArrowLeft size={18} className="text-gray-600" />
        </button>
        <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
          style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>
          {otherName.charAt(0).toUpperCase()}
        </div>
        <p className="font-bold text-gray-900 text-sm">{otherName}</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <MessageSquare size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">Start the conversation</p>
          </div>
        )}
        {messages.map(m => {
          const isMine = m.senderId === currentUser.uid;
          return (
            <div key={m.id} className={`flex gap-3 ${isMine ? 'flex-row-reverse' : ''}`}>
              <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
                style={{ backgroundColor: isMine ? 'var(--brand-color, #d4a017)' : '#6b7280' }}>
                {m.senderName.charAt(0).toUpperCase()}
              </div>
              <div className={`max-w-xs lg:max-w-md ${isMine ? 'items-end' : 'items-start'} flex flex-col`}>
                <div className={`flex items-baseline gap-2 mb-0.5 ${isMine ? 'flex-row-reverse' : ''}`}>
                  <span className="text-xs text-gray-400">{fmtTime(m.createdAt)}</span>
                </div>
                <p className={`text-sm px-3 py-2 rounded-2xl ${isMine ? 'rounded-tr-sm text-white' : 'rounded-tl-sm text-gray-700 bg-white border border-gray-100 shadow-sm'}`}
                  style={isMine ? { backgroundColor: 'var(--brand-color, #d4a017)' } : undefined}>
                  {m.content}
                </p>
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
            style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
          >
            <Send size={14} className="text-white" />
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Main AdminCommunity ───────────────────────────────────────────

const AdminCommunity: React.FC = () => {
  const [tab, setTab] = useState<MainTab>('channels');
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<{ uid: string; name: string } | null>(null);

  // Channels
  const [channels, setChannels] = useState<Channel[]>([]);
  const [openChannel, setOpenChannel] = useState<Channel | null>(null);
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelDesc, setNewChannelDesc] = useState('');
  const [savingChannel, setSavingChannel] = useState(false);

  // Admin DMs
  const [adminDms, setAdminDms] = useState<DirectMessage[]>([]);
  const [openAdminDm, setOpenAdminDm] = useState<DirectMessage | null>(null);
  const [showAdminPicker, setShowAdminPicker] = useState(false);
  const [admins, setAdmins] = useState<AdminUser[]>([]);

  // Member DMs
  const [memberDms, setMemberDms] = useState<DirectMessage[]>([]);
  const [openMemberDm, setOpenMemberDm] = useState<DirectMessage | null>(null);
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [members, setMembers] = useState<AdminUser[]>([]);
  const [memberSearch, setMemberSearch] = useState('');

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTenantScope().then(async (tid) => {
      setTenantId(tid);
      if (auth.currentUser) {
        const { getDoc } = await import('firebase/firestore');
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        const name = userDoc.exists() ? (userDoc.data().displayName || auth.currentUser.displayName || 'Admin') : (auth.currentUser.displayName || 'Admin');
        setCurrentUser({ uid: auth.currentUser.uid, name });
      }
      setLoading(false);
    });
  }, []);

  // Load channels
  useEffect(() => {
    if (!tenantId) return;
    const q = query(
      collection(db, 'tenants', tenantId, 'channels'),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
    return onSnapshot(q, snap => {
      setChannels(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Channel));
    });
  }, [tenantId]);

  // Load all DMs
  useEffect(() => {
    if (!tenantId || !currentUser) return;
    const q = query(
      collection(db, 'tenants', tenantId, 'directMessages'),
      where('participants', 'array-contains', currentUser.uid),
      orderBy('lastMessageAt', 'desc'),
      limit(100)
    );
    return onSnapshot(q, snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }) as DirectMessage);
      setAdminDms(all.filter(dm =>
        dm.participants.every(p => dm.participantRoles?.[p] === 'admin')
      ));
      setMemberDms(all.filter(dm =>
        dm.participants.some(p => dm.participantRoles?.[p] !== 'admin')
      ));
    });
  }, [tenantId, currentUser]);

  // Load admins list
  const loadAdmins = useCallback(async () => {
    if (!tenantId) return;
    try {
      const q = query(
        collection(db, 'users'),
        where('tenantId', '==', tenantId),
        where('role', 'in', ['admin', 'church_admin']),
        limit(50)
      );
      const snap = await getDocs(q);
      setAdmins(snap.docs
        .map(d => ({ id: d.id, ...d.data() }) as AdminUser)
        .filter(a => a.id !== currentUser?.uid)
      );
    } catch (e) { console.error(e); }
  }, [tenantId, currentUser]);

  // Load members list
  const loadMembers = useCallback(async () => {
    if (!tenantId) return;
    try {
      const q = query(
        collection(db, 'users'),
        where('tenantId', '==', tenantId),
        where('role', '==', 'user'),
        limit(100)
      );
      const snap = await getDocs(q);
      setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() }) as AdminUser));
    } catch (e) { console.error(e); }
  }, [tenantId]);

  const createChannel = async () => {
    if (!newChannelName.trim() || !tenantId || !currentUser) return;
    setSavingChannel(true);
    try {
      await addDoc(collection(db, 'tenants', tenantId, 'channels'), {
        name: newChannelName.trim(),
        description: newChannelDesc.trim(),
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid,
        type: 'announcement',
      });
      setShowNewChannel(false);
      setNewChannelName('');
      setNewChannelDesc('');
    } catch (e) { notifyError('Failed to create channel', e); }
    finally { setSavingChannel(false); }
  };

  const startAdminDm = async (admin: AdminUser) => {
    if (!tenantId || !currentUser) return;
    // Check if DM already exists
    const existing = adminDms.find(dm =>
      dm.participants.includes(admin.id) && dm.participants.includes(currentUser.uid)
    );
    if (existing) { setOpenAdminDm(existing); setShowAdminPicker(false); return; }
    try {
      const ref = await addDoc(collection(db, 'tenants', tenantId, 'directMessages'), {
        participants: [currentUser.uid, admin.id],
        participantRoles: { [currentUser.uid]: 'admin', [admin.id]: 'admin' },
        participantNames: { [currentUser.uid]: currentUser.name, [admin.id]: admin.displayName },
        createdAt: serverTimestamp(),
        lastMessage: '',
        lastMessageAt: serverTimestamp(),
        initiatedBy: currentUser.uid,
      });
      setOpenAdminDm({ id: ref.id, participants: [currentUser.uid, admin.id], participantRoles: { [currentUser.uid]: 'admin', [admin.id]: 'admin' }, lastMessage: '', lastMessageAt: null, initiatedBy: currentUser.uid, participantNames: { [currentUser.uid]: currentUser.name, [admin.id]: admin.displayName } });
      setShowAdminPicker(false);
    } catch (e) { notifyError('Failed to start conversation', e); }
  };

  const startMemberDm = async (member: AdminUser) => {
    if (!tenantId || !currentUser) return;
    const existing = memberDms.find(dm =>
      dm.participants.includes(member.id) && dm.participants.includes(currentUser.uid)
    );
    if (existing) { setOpenMemberDm(existing); setShowMemberPicker(false); return; }
    try {
      const ref = await addDoc(collection(db, 'tenants', tenantId, 'directMessages'), {
        participants: [currentUser.uid, member.id],
        participantRoles: { [currentUser.uid]: 'admin', [member.id]: 'user' },
        participantNames: { [currentUser.uid]: currentUser.name, [member.id]: member.displayName },
        createdAt: serverTimestamp(),
        lastMessage: '',
        lastMessageAt: serverTimestamp(),
        initiatedBy: currentUser.uid,
      });
      setOpenMemberDm({ id: ref.id, participants: [currentUser.uid, member.id], participantRoles: { [currentUser.uid]: 'admin', [member.id]: 'user' }, lastMessage: '', lastMessageAt: null, initiatedBy: currentUser.uid, participantNames: { [currentUser.uid]: currentUser.name, [member.id]: member.displayName } });
      setShowMemberPicker(false);
    } catch (e) { notifyError('Failed to start conversation', e); }
  };

  const getOtherName = (dm: DirectMessage): string => {
    if (!currentUser) return 'Unknown';
    const otherId = dm.participants.find(p => p !== currentUser.uid) || '';
    return (dm as any).participantNames?.[otherId] || otherId.slice(0, 8);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #d4a017)', borderTopColor: 'transparent' }} /></div>;
  }

  if (!tenantId) {
    // Super admin with no tenant gets a message about creating a tenant first
    if (isSuperAdminEmail(auth.currentUser?.email)) {
      return <div className="text-center py-16 text-gray-400">Select a tenant to manage community chat.</div>;
    }
    return <div className="text-center py-16 text-gray-400">Community chat is only available for tenant admins.</div>;
  }

  // ── Thread views ──
  if (openChannel && currentUser) {
    return (
      <div className="h-full flex flex-col" style={{ minHeight: 'calc(100vh - 200px)' }}>
        <ChannelThread channel={openChannel} tenantId={tenantId} currentUser={currentUser} onBack={() => setOpenChannel(null)} />
      </div>
    );
  }
  if (openAdminDm && currentUser) {
    return (
      <div className="h-full flex flex-col" style={{ minHeight: 'calc(100vh - 200px)' }}>
        <DmThread dm={openAdminDm} tenantId={tenantId} currentUser={currentUser} otherName={getOtherName(openAdminDm)} onBack={() => setOpenAdminDm(null)} />
      </div>
    );
  }
  if (openMemberDm && currentUser) {
    return (
      <div className="h-full flex flex-col" style={{ minHeight: 'calc(100vh - 200px)' }}>
        <DmThread dm={openMemberDm} tenantId={tenantId} currentUser={currentUser} otherName={getOtherName(openMemberDm)} onBack={() => setOpenMemberDm(null)} />
      </div>
    );
  }

  const filteredMembers = members.filter(m =>
    !memberSearch ||
    m.displayName?.toLowerCase().includes(memberSearch.toLowerCase()) ||
    m.email?.toLowerCase().includes(memberSearch.toLowerCase())
  );

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2 mb-5">
        <MessageSquare size={22} style={{ color: 'var(--brand-color, #d4a017)' }} />
        <h2 className="text-xl font-bold text-gray-900">Community Chat</h2>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-5">
        {([['channels', 'Channels'], ['admin-dms', 'Admin DMs'], ['member-dms', 'Member DMs']] as [MainTab, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors ${tab === id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── CHANNELS TAB ── */}
      {tab === 'channels' && (
        <div>
          <div className="flex justify-between items-center mb-3">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Announcement Channels</p>
            <button
              onClick={() => setShowNewChannel(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white"
              style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
            >
              <Plus size={13} /> New Channel
            </button>
          </div>
          {channels.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Hash size={32} className="mx-auto mb-2 opacity-30" />
              <p className="font-medium text-sm">No channels yet</p>
              <p className="text-xs mt-1">Create your first announcement channel</p>
            </div>
          ) : (
            <div className="space-y-2">
              {channels.map(ch => (
                <button
                  key={ch.id}
                  onClick={() => setOpenChannel(ch)}
                  className="w-full bg-white rounded-2xl px-4 py-3 border border-gray-100 shadow-sm flex items-center gap-3 hover:border-[#d4a017]/30 transition-all text-left"
                >
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--brand-color, #d4a017)10' }}>
                    <Hash size={18} style={{ color: 'var(--brand-color, #d4a017)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">#{ch.name}</p>
                    {ch.description && <p className="text-xs text-gray-400 truncate">{ch.description}</p>}
                  </div>
                  <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ADMIN DMs TAB ── */}
      {tab === 'admin-dms' && (
        <div>
          <div className="flex justify-between items-center mb-3">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Admin Conversations</p>
            <button
              onClick={() => { loadAdmins(); setShowAdminPicker(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white"
              style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
            >
              <Plus size={13} /> New DM
            </button>
          </div>
          {adminDms.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Users size={32} className="mx-auto mb-2 opacity-30" />
              <p className="font-medium text-sm">No admin conversations yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {adminDms.map(dm => (
                <button
                  key={dm.id}
                  onClick={() => setOpenAdminDm(dm)}
                  className="w-full bg-white rounded-2xl px-4 py-3 border border-gray-100 shadow-sm flex items-center gap-3 hover:border-[#d4a017]/30 transition-all text-left"
                >
                  <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold text-white"
                    style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>
                    {getOtherName(dm).charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">{getOtherName(dm)}</p>
                    {dm.lastMessage && <p className="text-xs text-gray-400 truncate">{dm.lastMessage}</p>}
                  </div>
                  {dm.lastMessageAt && <span className="text-[10px] text-gray-400 flex-shrink-0">{fmtTime(dm.lastMessageAt)}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── MEMBER DMs TAB ── */}
      {tab === 'member-dms' && (
        <div>
          <div className="flex justify-between items-center mb-3">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Member Conversations</p>
            <button
              onClick={() => { loadMembers(); setShowMemberPicker(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white"
              style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
            >
              <Plus size={13} /> New DM
            </button>
          </div>
          {memberDms.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <MessageSquare size={32} className="mx-auto mb-2 opacity-30" />
              <p className="font-medium text-sm">No member conversations yet</p>
              <p className="text-xs mt-1">Start a private conversation with a member</p>
            </div>
          ) : (
            <div className="space-y-2">
              {memberDms.map(dm => (
                <button
                  key={dm.id}
                  onClick={() => setOpenMemberDm(dm)}
                  className="w-full bg-white rounded-2xl px-4 py-3 border border-gray-100 shadow-sm flex items-center gap-3 hover:border-[#d4a017]/30 transition-all text-left"
                >
                  <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold text-white bg-blue-500">
                    {getOtherName(dm).charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">{getOtherName(dm)}</p>
                    {dm.lastMessage && <p className="text-xs text-gray-400 truncate">{dm.lastMessage}</p>}
                  </div>
                  {dm.lastMessageAt && <span className="text-[10px] text-gray-400 flex-shrink-0">{fmtTime(dm.lastMessageAt)}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* New Channel Modal */}
      {showNewChannel && (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-900">New Channel</h3>
              <button onClick={() => setShowNewChannel(false)}><X size={18} className="text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1 block">Channel Name *</label>
                <input
                  value={newChannelName}
                  onChange={e => setNewChannelName(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]"
                  placeholder="e.g. announcements"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1 block">Description</label>
                <input
                  value={newChannelDesc}
                  onChange={e => setNewChannelDesc(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017]"
                  placeholder="What is this channel about?"
                />
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 flex gap-3">
              <button onClick={() => setShowNewChannel(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600">Cancel</button>
              <button onClick={createChannel} disabled={savingChannel || !newChannelName.trim()}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>
                {savingChannel ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Picker Modal */}
      {showAdminPicker && (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[70vh] flex flex-col">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <h3 className="font-bold text-gray-900">Start Admin DM</h3>
              <button onClick={() => setShowAdminPicker(false)}><X size={18} className="text-gray-400" /></button>
            </div>
            <div className="overflow-y-auto flex-1">
              {admins.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">No other admins found</div>
              ) : (
                admins.map(a => (
                  <button
                    key={a.id}
                    onClick={() => startAdminDm(a)}
                    className="w-full flex items-center gap-3 px-5 py-3 hover:bg-gray-50 text-left"
                  >
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                      style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>
                      {a.displayName?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{a.displayName}</p>
                      <p className="text-xs text-gray-400">{a.email}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Member Picker Modal */}
      {showMemberPicker && (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[70vh] flex flex-col">
            <div className="p-5 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-900">Message a Member</h3>
                <button onClick={() => setShowMemberPicker(false)}><X size={18} className="text-gray-400" /></button>
              </div>
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={memberSearch}
                  onChange={e => setMemberSearch(e.target.value)}
                  placeholder="Search by name or email..."
                  className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-[#d4a017]"
                />
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              {filteredMembers.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">No members found</div>
              ) : (
                filteredMembers.map(m => (
                  <button
                    key={m.id}
                    onClick={() => startMemberDm(m)}
                    className="w-full flex items-center gap-3 px-5 py-3 hover:bg-gray-50 text-left"
                  >
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0 bg-blue-500">
                      {m.displayName?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{m.displayName}</p>
                      <p className="text-xs text-gray-400">{m.email}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminCommunity;
