"use client";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Hash, MessageSquare, Plus, Send, Users, X, Search, ArrowLeft, ChevronRight, Megaphone, Paperclip, UserPlus
} from 'lucide-react';
import {
  collection, query, where, orderBy, onSnapshot, addDoc, updateDoc, doc,
  serverTimestamp, getDocs, limit, Timestamp, arrayUnion, arrayRemove
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { getTenantId, getTenantIdFromHost, PLATFORM_TENANT_ID } from '../utils/tenant-scope';
import { isSuperAdminEmail } from '../utils/super-admins';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { notifyError } from '../utils/notify';

interface MessageAttachment {
  type: 'doc' | 'contact' | 'campaign';
  id: string;
  title: string;
  subtitle: string;
}

interface Channel {
  id: string;
  name: string;
  description: string;
  createdAt: Timestamp | null;
  createdBy: string;
  type: 'announcement';
  members?: string[];
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
  attachments?: MessageAttachment[];
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
  attachments?: MessageAttachment[];
}

interface AdminUser {
  id: string;
  displayName: string;
  email: string;
  role: string;
}

type MainTab = 'channels' | 'admin-dms' | 'member-dms';
type AttachTab = 'docs' | 'contacts' | 'campaigns';

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

// ─── Attachment Card ─────────────────────────────────────────────────────────

const AttachmentCard: React.FC<{ attachment: MessageAttachment }> = ({ attachment }) => {
  const icon = attachment.type === 'doc' ? '📄' : attachment.type === 'contact' ? '👤' : '🎯';
  const label = attachment.type === 'doc' ? 'Open Doc' : attachment.type === 'contact' ? 'View Contact' : 'View Campaign';
  return (
    <div className="mt-1.5 bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm" style={{ maxWidth: 224 }}>
      <div className="flex items-start gap-2 p-3 pb-2">
        <span className="text-lg leading-none flex-shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-900 truncate leading-tight">{attachment.title}</p>
          <p className="text-[10px] text-gray-400 truncate mt-0.5">{attachment.subtitle}</p>
        </div>
      </div>
      <div className="px-3 pb-3">
        <div className="h-px bg-gray-100 mb-2" />
        <button className="w-full text-[11px] font-bold py-1.5 rounded-lg text-white" style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>
          {label}
        </button>
      </div>
    </div>
  );
};

// ─── Attach Picker ───────────────────────────────────────────────────────────

const AttachPicker: React.FC<{
  tenantId: string;
  selected: MessageAttachment[];
  onToggle: (a: MessageAttachment) => void;
  onClose: () => void;
}> = ({ tenantId, selected, onToggle, onClose }) => {
  const [tab, setTab] = useState<AttachTab>('docs');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<MessageAttachment[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    setItems([]);
    let cancelled = false;
    // Records live in flat collections scoped by a `tenantId` field (matching
    // AdminDocs / AdminCRM / AdminFundraising) — NOT tenant subcollections.
    // Query by equality only so no composite index is required.
    const run = async () => {
      try {
        if (tab === 'docs') {
          const [docsSnap, foldersSnap] = await Promise.all([
            getDocs(query(collection(db, 'docs'), where('tenantId', '==', tenantId), limit(50))),
            getDocs(query(collection(db, 'docFolders'), where('tenantId', '==', tenantId), limit(100))),
          ]);
          if (cancelled) return;
          const folderNames = new Map<string, string>();
          foldersSnap.docs.forEach(f => folderNames.set(f.id, (f.data().name as string) || 'Folder'));
          const rows = docsSnap.docs.map(d => {
            const data = d.data();
            const folder = data.folderId ? folderNames.get(data.folderId) : null;
            const updated = (data.updatedAt as Timestamp | undefined)?.toDate?.();
            const subtitle = folder || (updated ? updated.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Doc');
            return { type: 'doc' as const, id: d.id, title: (data.title as string) || 'Untitled', subtitle, _sort: (data.updatedAt as Timestamp | undefined)?.toMillis?.() || 0 };
          });
          rows.sort((a, b) => b._sort - a._sort);
          setItems(rows.map(({ _sort, ...r }) => r));
        } else if (tab === 'contacts') {
          const snap = await getDocs(query(collection(db, 'contacts'), where('tenantId', '==', tenantId), limit(100)));
          if (cancelled) return;
          const typeLabel: Record<string, string> = { donor: 'Donor', member: 'Member', both: 'Donor & Member' };
          setItems(snap.docs.map(d => {
            const data = d.data();
            const name = `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'Unknown';
            const badge = typeLabel[data.type as string] || 'Contact';
            const subtitle = data.email ? `${badge} · ${data.email}` : badge;
            return { type: 'contact' as const, id: d.id, title: name, subtitle };
          }));
        } else {
          const snap = await getDocs(query(collection(db, 'campaigns'), where('tenantId', '==', tenantId), limit(50)));
          if (cancelled) return;
          setItems(snap.docs.map(d => {
            const data = d.data();
            const raised = (data.raised as number) || 0;
            const goal = (data.goal as number) || 0;
            const status = data.isActive ? 'Active' : 'Inactive';
            const money = goal > 0
              ? `$${raised.toLocaleString()} of $${goal.toLocaleString()}`
              : `$${raised.toLocaleString()} raised`;
            return { type: 'campaign' as const, id: d.id, title: (data.title as string) || 'Campaign', subtitle: `${money} · ${status}` };
          }));
        }
      } catch (e) {
        if (!cancelled) {
          setItems([]);
          notifyError('Failed to load records', e);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [tab, tenantId]);

  const emptyLabel = tab === 'docs' ? 'No docs yet' : tab === 'contacts' ? 'No contacts yet' : 'No campaigns yet';

  const filtered = search
    ? items.filter(i =>
        i.title.toLowerCase().includes(search.toLowerCase()) ||
        i.subtitle.toLowerCase().includes(search.toLowerCase())
      )
    : items;

  const isSelected = (id: string) => selected.some(s => s.id === id);

  return (
    <div className="fixed inset-0 z-[300] flex items-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full bg-white rounded-t-2xl max-h-[70vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="font-bold text-gray-900 text-sm">Attach Record</h3>
          <button onClick={onClose}><X size={18} className="text-gray-400" /></button>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mx-4 mt-3 mb-2 flex-shrink-0">
          {([['docs', 'Notes & Docs'], ['contacts', 'Contacts'], ['campaigns', 'Fundraising']] as [AttachTab, string][]).map(([id, lbl]) => (
            <button
              key={id}
              onClick={() => { setTab(id as AttachTab); setSearch(''); }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${tab === id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
            >
              {lbl}
            </button>
          ))}
        </div>
        <div className="relative mx-4 mb-2 flex-shrink-0">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-[#d4a017]"
          />
        </div>
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #d4a017)', borderTopColor: 'transparent' }} />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center py-10 text-sm text-gray-400">{search ? 'Nothing found' : emptyLabel}</p>
          ) : filtered.map(item => {
            const sel = isSelected(item.id);
            const icon = item.type === 'doc' ? '📄' : item.type === 'contact' ? '👤' : '🎯';
            return (
              <button
                key={item.id}
                onClick={() => onToggle(item)}
                className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors ${sel ? 'bg-amber-50' : 'hover:bg-gray-50'}`}
              >
                <span className="text-xl flex-shrink-0">{icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{item.title}</p>
                  <p className="text-xs text-gray-400 truncate">{item.subtitle}</p>
                </div>
                {sel && (
                  <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                )}
              </button>
            );
          })}
        </div>
        {selected.length > 0 && (
          <div className="p-4 border-t border-gray-100 flex-shrink-0">
            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white"
              style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
            >
              Done · {selected.length} attached
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Channel Members Sheet ────────────────────────────────────────────────────

const ChannelMembersSheet: React.FC<{
  tenantId: string;
  channelId: string;
  onClose: () => void;
}> = ({ tenantId, channelId, onClose }) => {
  const [members, setMembers] = useState<string[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Live members from the channel doc.
  useEffect(() => {
    return onSnapshot(doc(db, 'tenants', tenantId, 'channels', channelId), snap => {
      setMembers((snap.data()?.members as string[]) || []);
    }, e => notifyError('Failed to load channel members', e));
  }, [tenantId, channelId]);

  // Tenant users (equality-only query — no composite index needed).
  useEffect(() => {
    let cancelled = false;
    getDocs(query(collection(db, 'users'), where('tenantId', '==', tenantId), limit(200)))
      .then(snap => {
        if (cancelled) return;
        setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() }) as AdminUser));
        setLoading(false);
      })
      .catch(e => { if (!cancelled) { setLoading(false); notifyError('Failed to load users', e); } });
    return () => { cancelled = true; };
  }, [tenantId]);

  const channelRef = doc(db, 'tenants', tenantId, 'channels', channelId);
  const addMember = async (uid: string) => {
    try { await updateDoc(channelRef, { members: arrayUnion(uid) }); }
    catch (e) { notifyError('Failed to add member', e); }
  };
  const removeMember = async (uid: string) => {
    try { await updateDoc(channelRef, { members: arrayRemove(uid) }); }
    catch (e) { notifyError('Failed to remove member', e); }
  };

  const userMap = new Map(users.map(u => [u.id, u]));
  const memberUsers = members.map(id => userMap.get(id)).filter(Boolean) as AdminUser[];
  const addable = users
    .filter(u => !members.includes(u.id))
    .filter(u => !search ||
      u.displayName?.toLowerCase().includes(search.toLowerCase()) ||
      u.email?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="fixed inset-0 z-[300] flex items-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full bg-white rounded-t-2xl max-h-[75vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="font-bold text-gray-900 text-sm">Channel Members</h3>
          <button onClick={onClose}><X size={18} className="text-gray-400" /></button>
        </div>

        {/* Current members */}
        <div className="px-5 pt-3 pb-1 flex-shrink-0">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Members · {members.length}</p>
        </div>
        <div className="overflow-y-auto flex-shrink-0" style={{ maxHeight: '28vh' }}>
          {memberUsers.length === 0 ? (
            <p className="text-center py-4 text-sm text-gray-400">No members yet</p>
          ) : memberUsers.map(u => (
            <div key={u.id} className="flex items-center gap-3 px-5 py-2.5">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>
                {u.displayName?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{u.displayName || 'Unknown'}</p>
                <p className="text-xs text-gray-400 truncate">{u.email}</p>
              </div>
              <button onClick={() => removeMember(u.id)} className="p-1.5 rounded-lg hover:bg-red-50">
                <X size={15} className="text-red-400" />
              </button>
            </div>
          ))}
        </div>

        {/* Add members */}
        <div className="px-4 pt-3 pb-2 border-t border-gray-100 flex-shrink-0">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 px-1">Add Members</p>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or email..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-[#d4a017]"
            />
          </div>
        </div>
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #d4a017)', borderTopColor: 'transparent' }} />
            </div>
          ) : addable.length === 0 ? (
            <p className="text-center py-8 text-sm text-gray-400">{search ? 'No users found' : 'No users found in this tenant'}</p>
          ) : addable.map(u => (
            <button key={u.id} onClick={() => addMember(u.id)} className="w-full flex items-center gap-3 px-5 py-2.5 text-left hover:bg-gray-50">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0 bg-gray-400">
                {u.displayName?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{u.displayName || 'Unknown'}</p>
                <p className="text-xs text-gray-400 truncate">{u.email}</p>
              </div>
              <UserPlus size={16} style={{ color: 'var(--brand-color, #d4a017)' }} className="flex-shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── Channel Thread ──────────────────────────────────────────────────────────

const ChannelThread: React.FC<{
  channel: Channel;
  tenantId: string;
  currentUser: { uid: string; name: string };
  onBack: () => void;
}> = ({ channel, tenantId, currentUser, onBack }) => {
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
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

  const toggleAttachment = (a: MessageAttachment) => {
    setAttachments(prev => {
      const idx = prev.findIndex(p => p.id === a.id);
      return idx >= 0 ? prev.filter((_, i) => i !== idx) : [...prev, a];
    });
  };

  const send = async () => {
    if ((!text.trim() && attachments.length === 0) || sending) return;
    setSending(true);
    try {
      const payload: Record<string, unknown> = {
        channelId: channel.id,
        senderId: currentUser.uid,
        senderName: currentUser.name,
        senderRole: 'admin',
        content: text.trim(),
        createdAt: serverTimestamp(),
        edited: false,
      };
      if (attachments.length > 0) payload.attachments = attachments;
      await addDoc(collection(db, 'tenants', tenantId, 'channelMessages'), payload);
      setText('');
      setAttachments([]);
    } catch (e) { notifyError('Failed to send message', e); }
    finally { setSending(false); }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-white flex-shrink-0">
        <button onClick={onBack} className="p-1 -ml-1 flex-shrink-0" aria-label="Back">
          <ArrowLeft size={22} style={{ color: '#B8962E' }} />
        </button>
        <Hash size={18} style={{ color: 'var(--brand-color, #d4a017)' }} className="flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-900 text-sm truncate">{channel.name}</p>
          {channel.description && <p className="text-xs text-gray-400 truncate">{channel.description}</p>}
        </div>
        <button
          onClick={() => setShowMembers(true)}
          className="p-1.5 rounded-lg hover:bg-gray-100 flex-shrink-0"
          aria-label="Channel members"
        >
          <Users size={20} style={{ color: '#B8962E' }} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-4 space-y-3">
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
              {m.content && (
                <p className="text-sm text-gray-700 bg-white px-3 py-2 rounded-2xl rounded-tl-sm border border-gray-100 shadow-sm max-w-xs lg:max-w-md">
                  {m.content}
                </p>
              )}
              {m.attachments?.map((a, i) => <AttachmentCard key={i} attachment={a} />)}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="bg-white border-t border-gray-100 flex-shrink-0 px-4 pt-3" style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }}>
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {attachments.map((a, i) => (
              <div key={i} className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1">
                <span className="text-sm">{a.type === 'doc' ? '📄' : a.type === 'contact' ? '👤' : '🎯'}</span>
                <span className="text-xs font-medium text-gray-700 max-w-[90px] truncate">{a.title}</span>
                <button onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}>
                  <X size={11} className="text-gray-400" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 items-center bg-gray-50 rounded-2xl px-3 py-2 border border-gray-200">
          <button
            onClick={() => setShowPicker(true)}
            className="flex-shrink-0 p-1 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <Paperclip size={16} className="text-gray-500" />
          </button>
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
            placeholder={`Post to #${channel.name}`}
            className="flex-1 bg-transparent outline-none text-sm text-gray-900 placeholder-gray-400"
          />
          <button
            onClick={send}
            disabled={(!text.trim() && attachments.length === 0) || sending}
            className="w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-40 transition-opacity"
            style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
          >
            <Send size={14} className="text-white" />
          </button>
        </div>
      </div>

      {showPicker && (
        <AttachPicker
          tenantId={tenantId}
          selected={attachments}
          onToggle={toggleAttachment}
          onClose={() => setShowPicker(false)}
        />
      )}
      {showMembers && (
        <ChannelMembersSheet
          tenantId={tenantId}
          channelId={channel.id}
          onClose={() => setShowMembers(false)}
        />
      )}
    </div>
  );
};

// ─── DM Thread ────────────────────────────────────────────────────────────────

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
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [showPicker, setShowPicker] = useState(false);
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

  const toggleAttachment = (a: MessageAttachment) => {
    setAttachments(prev => {
      const idx = prev.findIndex(p => p.id === a.id);
      return idx >= 0 ? prev.filter((_, i) => i !== idx) : [...prev, a];
    });
  };

  const send = async () => {
    if ((!text.trim() && attachments.length === 0) || sending) return;
    setSending(true);
    try {
      const content = text.trim();
      const payload: Record<string, unknown> = {
        dmId: dm.id,
        senderId: currentUser.uid,
        senderName: currentUser.name,
        content,
        createdAt: serverTimestamp(),
        read: false,
      };
      if (attachments.length > 0) payload.attachments = attachments;
      await addDoc(collection(db, 'tenants', tenantId, 'dmMessages'), payload);
      await updateDoc(doc(db, 'tenants', tenantId, 'directMessages', dm.id), {
        lastMessage: content || (attachments.length > 0 ? `📎 ${attachments[0].title}` : ''),
        lastMessageAt: serverTimestamp(),
      });
      setText('');
      setAttachments([]);
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
                {m.content && (
                  <p className={`text-sm px-3 py-2 rounded-2xl ${isMine ? 'rounded-tr-sm text-white' : 'rounded-tl-sm text-gray-700 bg-white border border-gray-100 shadow-sm'}`}
                    style={isMine ? { backgroundColor: 'var(--brand-color, #d4a017)' } : undefined}>
                    {m.content}
                  </p>
                )}
                {m.attachments?.map((a, i) => <AttachmentCard key={i} attachment={a} />)}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="p-4 bg-white border-t border-gray-100">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {attachments.map((a, i) => (
              <div key={i} className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1">
                <span className="text-sm">{a.type === 'doc' ? '📄' : a.type === 'contact' ? '👤' : '🎯'}</span>
                <span className="text-xs font-medium text-gray-700 max-w-[90px] truncate">{a.title}</span>
                <button onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}>
                  <X size={11} className="text-gray-400" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 items-center bg-gray-50 rounded-2xl px-3 py-2 border border-gray-200">
          <button
            onClick={() => setShowPicker(true)}
            className="flex-shrink-0 p-1 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <Paperclip size={16} className="text-gray-500" />
          </button>
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
            placeholder="Type a message..."
            className="flex-1 bg-transparent outline-none text-sm text-gray-900 placeholder-gray-400"
          />
          <button
            onClick={send}
            disabled={(!text.trim() && attachments.length === 0) || sending}
            className="w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-40 transition-opacity"
            style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
          >
            <Send size={14} className="text-white" />
          </button>
        </div>
      </div>

      {showPicker && (
        <AttachPicker
          tenantId={tenantId}
          selected={attachments}
          onToggle={toggleAttachment}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
};

// ─── Main AdminCommunity ─────────────────────────────────────────────────────

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
    const user = auth.currentUser;

    const loadCurrentUser = async () => {
      if (!user) return;
      const { getDoc } = await import('firebase/firestore');
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const name = userDoc.exists()
        ? (userDoc.data().displayName || user.displayName || 'Admin')
        : (user.displayName || 'Admin');
      setCurrentUser({ uid: user.uid, name });
    };

    // Resolve THIS admin's own tenant and render chat directly — no picker.
    // Subdomain is authoritative; otherwise fall back to their user doc.
    // tenantId stays null only for a super admin (whose user doc has no
    // tenant), which is the single case that shows the tenant picker below.
    const hostTenant = getTenantIdFromHost();
    if (hostTenant) {
      setTenantId(hostTenant);
      loadCurrentUser().finally(() => setLoading(false));
      return;
    }

    getTenantId().then(async (tid) => {
      // On the root platform domain a super admin has no subdomain and a null
      // tenant on their user doc — land them directly in the platform's own
      // community chat instead of a picker. Regular admins keep their tenant
      // (or null, which shows the not-an-admin message below).
      const resolved = tid || (isSuperAdminEmail(user?.email) ? PLATFORM_TENANT_ID : null);
      setTenantId(resolved);
      await loadCurrentUser();
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

  // Load admins list. Query by tenantId only (single-field, no composite index
  // needed) and filter role on the client so the picker never silently fails.
  const loadAdmins = useCallback(async () => {
    if (!tenantId) return;
    try {
      const snap = await getDocs(query(
        collection(db, 'users'),
        where('tenantId', '==', tenantId),
        limit(200)
      ));
      const adminRoles = ['admin', 'church_admin', 'super_admin'];
      setAdmins(snap.docs
        .map(d => ({ id: d.id, ...d.data() }) as AdminUser)
        .filter(a => adminRoles.includes(a.role) && a.id !== currentUser?.uid)
      );
    } catch (e) { notifyError('Failed to load admins', e); }
  }, [tenantId, currentUser]);

  // Load members list (role === 'user').
  const loadMembers = useCallback(async () => {
    if (!tenantId) return;
    try {
      const snap = await getDocs(query(
        collection(db, 'users'),
        where('tenantId', '==', tenantId),
        limit(200)
      ));
      setMembers(snap.docs
        .map(d => ({ id: d.id, ...d.data() }) as AdminUser)
        .filter(m => m.role === 'user')
      );
    } catch (e) { notifyError('Failed to load members', e); }
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
        members: [currentUser.uid],
      });
      setShowNewChannel(false);
      setNewChannelName('');
      setNewChannelDesc('');
    } catch (e) { notifyError('Failed to create channel', e); }
    finally { setSavingChannel(false); }
  };

  const startAdminDm = async (admin: AdminUser) => {
    if (!tenantId || !currentUser) return;
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
                <div className="text-center py-8 text-gray-400 text-sm">No users found in this tenant</div>
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
                <div className="text-center py-8 text-gray-400 text-sm">No users found in this tenant</div>
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
