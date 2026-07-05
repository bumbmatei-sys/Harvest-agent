"use client";
import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Send, MessageSquare, Hash, Megaphone, Paperclip, X, Search, PenSquare } from 'lucide-react';
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, doc,
  serverTimestamp, limit, orderBy, getDocs, Timestamp
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { getTenantScope, isPlatformContext, PLATFORM_TENANT_ID } from '../utils/tenant-scope';
import { isSuperAdminEmail } from '../utils/super-admins';
import { sortByTime } from '../utils/query-helpers';

interface MessageAttachment {
  type: 'doc' | 'contact' | 'campaign' | 'form';
  id: string;
  title: string;
  subtitle: string;
}

interface AdminContact {
  id: string;
  displayName: string;
  photoURL?: string;
  role: string;
}

const ADMIN_ROLES = ['admin', 'church_admin', 'super_admin'];

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
  attachments?: MessageAttachment[];
}

interface Channel {
  id: string;
  name: string;
  description: string;
  members?: string[];
  lastMessage?: string;
  lastMessageAt?: Timestamp | null;
}

interface ChannelMessage {
  id: string;
  channelId: string;
  senderId?: string;
  senderName: string;
  senderRole?: string;
  content: string;
  createdAt: Timestamp | null;
  attachments?: MessageAttachment[];
}

// Admin (gold) / User (grey) role badge for channel messages.
const RoleBadge: React.FC<{ role?: string }> = ({ role }) => {
  const isAdmin = role === 'admin' || role === 'church_admin' || role === 'super_admin';
  return (
    <span
      className="text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none"
      style={isAdmin ? { backgroundColor: '#FBF3E4', color: '#B8962E' } : { backgroundColor: '#f3f4f6', color: '#6b7280' }}
    >
      {isAdmin ? 'Admin' : 'User'}
    </span>
  );
};

const fmtTime = (ts: Timestamp | null) => {
  if (!ts) return '';
  const d = ts.toDate();
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// Group consecutive messages from the same sender (within 3 minutes) so the
// avatar + name header renders only on the first message of each run. Generic
// over both channel and DM message shapes (senderRole / senderId optional).
interface GroupableMessage {
  id: string;
  senderId?: string;
  senderName: string;
  senderRole?: string;
  createdAt: Timestamp | null;
}

function groupMessages<T extends GroupableMessage>(msgs: T[]) {
  const groups: { sender: string; senderName: string; senderRole: string; messages: T[] }[] = [];
  for (const msg of msgs) {
    const last = groups[groups.length - 1];
    const lastMsg = last?.messages[last.messages.length - 1];
    const isSameSender = last?.sender === (msg.senderId || '');
    const isWithin3min = last && msg.createdAt && lastMsg?.createdAt
      ? Math.abs(
          ((msg.createdAt as any)?.toDate?.()?.getTime?.() ?? 0) -
          ((lastMsg.createdAt as any)?.toDate?.()?.getTime?.() ?? 0)
        ) < 3 * 60 * 1000
      : false;
    if (isSameSender && isWithin3min) {
      last.messages.push(msg);
    } else {
      groups.push({ sender: msg.senderId || '', senderName: msg.senderName, senderRole: msg.senderRole || '', messages: [msg] });
    }
  }
  return groups;
}

// ─── Attachment Card (view-only for users) ───────────────────────────────────

const AttachmentCard: React.FC<{ attachment: MessageAttachment; tenantId?: string }> = ({ attachment, tenantId }) => {
  const icon = attachment.type === 'doc' ? '📄' : attachment.type === 'contact' ? '👤' : attachment.type === 'form' ? '📝' : '🎯';
  const label = attachment.type === 'doc' ? 'Note / Doc' : attachment.type === 'contact' ? 'Contact' : attachment.type === 'form' ? 'Form' : 'Campaign';
  // Forms link to the public, no-auth form page on the tenant subdomain.
  const formUrl = attachment.type === 'form' && tenantId
    ? `https://${tenantId}.theharvest.app/form/${attachment.id}`
    : null;
  return (
    <div className="mt-1.5 bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm" style={{ maxWidth: 210 }}>
      <div className={`flex items-start gap-2 p-3 ${formUrl ? 'pb-2' : ''}`}>
        <span className="text-lg leading-none flex-shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-0.5">{label}</p>
          <p className="text-xs font-semibold text-gray-900 truncate leading-tight">{attachment.title}</p>
          <p className="text-[10px] text-gray-400 truncate mt-0.5">{attachment.subtitle}</p>
        </div>
      </div>
      {formUrl && (
        <div className="px-3 pb-3">
          <a
            href={formUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full text-center text-[11px] font-bold py-1.5 rounded-lg text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}
          >
            Open Form
          </a>
        </div>
      )}
    </div>
  );
};

// ─── Form Picker (forms-only; for attaching a form in a DM) ───────────────────

const FormPicker: React.FC<{
  tenantId: string;
  selected: MessageAttachment[];
  onToggle: (a: MessageAttachment) => void;
  onClose: () => void;
}> = ({ tenantId, selected, onToggle, onClose }) => {
  const [items, setItems] = useState<MessageAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    let cancelled = false;
    (async () => {
      try {
        // Forms live in the tenant subcollection; only publicly-openable (active) forms.
        const snap = await getDocs(query(collection(db, 'tenants', tenantId, 'forms'), orderBy('createdAt', 'desc'), limit(50)));
        if (cancelled) return;
        setItems(snap.docs
          .filter(d => d.data().active !== false)
          .map(d => {
            const data = d.data();
            const count = (data.submissionCount as number) || 0;
            return { type: 'form' as const, id: d.id, title: (data.title as string) || 'Untitled Form', subtitle: `${count} ${count === 1 ? 'submission' : 'submissions'}` };
          }));
      } catch { if (!cancelled) setItems([]); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  const filtered = search
    ? items.filter(i => i.title.toLowerCase().includes(search.toLowerCase()))
    : items;
  const isSelected = (id: string) => selected.some(s => s.id === id);

  return (
    <div className="fixed inset-0 z-[300] flex items-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full bg-white rounded-t-2xl max-h-[70vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="font-bold text-gray-900 text-sm">Attach a Form</h3>
          <button onClick={onClose}><X size={18} className="text-gray-400" /></button>
        </div>
        <div className="relative mx-4 mt-3 mb-2 flex-shrink-0">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search forms..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-gold"
          />
        </div>
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #B8962E)', borderTopColor: 'transparent' }} />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center py-10 text-sm text-gray-400">{search ? 'Nothing found' : 'No active forms yet'}</p>
          ) : filtered.map(item => {
            const sel = isSelected(item.id);
            return (
              <button
                key={item.id}
                onClick={() => onToggle(item)}
                className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors ${sel ? 'bg-amber-50' : 'hover:bg-gray-50'}`}
              >
                <span className="text-xl flex-shrink-0">📝</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{item.title}</p>
                  <p className="text-xs text-gray-400 truncate">{item.subtitle}</p>
                </div>
                {sel && (
                  <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}>
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
              style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}
            >
              Done · {selected.length} attached
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const DmThread: React.FC<{
  dm: DirectMessage;
  tenantId: string;
  currentUser: { uid: string; name: string };
  otherName: string;
  onBack: () => void;
  embedded?: boolean;
}> = ({ dm, tenantId, currentUser, otherName, onBack, embedded = false }) => {
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const toggleAttachment = (a: MessageAttachment) => {
    setAttachments(prev => {
      const idx = prev.findIndex(p => p.id === a.id);
      return idx >= 0 ? prev.filter((_, i) => i !== idx) : [...prev, a];
    });
  };

  useEffect(() => {
    // Single-field filter only (dmId); sort client-side to avoid a composite index.
    const q = query(
      collection(db, 'tenants', tenantId, 'dmMessages'),
      where('dmId', '==', dm.id),
      limit(300)
    );
    return onSnapshot(q, snap => {
      setMessages(sortByTime(snap.docs.map(d => ({ id: d.id, ...d.data() }) as DmMessage), 'createdAt', 'asc'));
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
    } catch (e) { console.error(e); }
    finally { setSending(false); }
  };

  return (
    <div className="flex flex-col h-full bg-[#F7F6F3]">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#EDEBE8] bg-white">
        <button onClick={onBack} className="p-1 -ml-1">
          <ArrowLeft size={22} style={{ color: 'var(--brand-color, #B8962E)' }} />
        </button>
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
          style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}>
          {otherName.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-900 text-sm">{otherName}</p>
          <p className="text-[10px] text-gray-400">Direct Message</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <MessageSquare size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No messages yet</p>
          </div>
        )}
        {groupMessages(messages).map(group => {
          const isMine = group.sender === currentUser.uid;
          return (
            <div key={group.messages[0].id} className="space-y-1">
              {group.messages.map((m, mi) => {
                const isFirst = mi === 0;
                if (isMine) {
                  return (
                    <div key={m.id} className="flex justify-end">
                      <div className="flex flex-col items-end max-w-[78%]">
                        {m.content && (
                          <div className="bg-gold text-white rounded-2xl rounded-br-sm px-3.5 py-2.5 text-sm break-words">{m.content}</div>
                        )}
                        {m.attachments?.map((a, i) => <AttachmentCard key={i} attachment={a} tenantId={tenantId} />)}
                        <span className="text-[10px] text-[color-mix(in_srgb,var(--brand-color)_60%,transparent)] text-right mt-0.5">{fmtTime(m.createdAt)}</span>
                      </div>
                    </div>
                  );
                }
                const senderRole = dm.participantRoles?.[m.senderId || ''];
                const isAdminSender = ADMIN_ROLES.includes(senderRole);
                return (
                  <div key={m.id} className="flex gap-2.5 items-end">
                    {isFirst ? (
                      <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
                        style={{ backgroundColor: isAdminSender ? 'var(--brand-color, #B8962E)' : '#9ca3af' }}>
                        {(group.senderName || 'A').charAt(0).toUpperCase()}
                      </div>
                    ) : (
                      <div className="w-8 flex-shrink-0" />
                    )}
                    <div className="flex flex-col items-start max-w-[78%]">
                      {isFirst && <span className="text-[10px] font-semibold text-gray-400 mb-0.5 ml-1">{group.senderName}</span>}
                      {m.content && (
                        <div className="bg-[#F0EDE8] text-gray-800 rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-sm break-words">{m.content}</div>
                      )}
                      {m.attachments?.map((a, i) => <AttachmentCard key={i} attachment={a} tenantId={tenantId} />)}
                      <span className="text-[10px] text-gray-400 mt-0.5">{fmtTime(m.createdAt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* When embedded in the app, the bottom nav's safe-area padding and the
          content wrapper's bottom padding already clear the home indicator, so
          the composer only needs a small pad — adding the safe-area inset again
          here double-stacks and leaves a dead gap. Standalone still needs it. */}
      <div className="bg-white border-t border-[#EDEBE8] flex-shrink-0 px-4 pt-3" style={{ paddingBottom: embedded ? '8px' : 'calc(env(safe-area-inset-bottom) + 8px)' }}>
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {attachments.map((a, i) => (
              <div key={i} className="flex items-center gap-1.5 bg-[#FBF3E4] border border-[#F0D9A0] rounded-lg px-2.5 py-1 text-xs font-medium text-gold">
                <span className="text-sm">📝</span>
                <span className="max-w-[90px] truncate">{a.title}</span>
                <button onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}>
                  <X size={11} className="text-[color-mix(in_srgb,var(--brand-color)_60%,transparent)]" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 items-center bg-[#F7F6F3] rounded-2xl px-3 py-2.5 border border-[#EDEBE8] focus-within:border-[color-mix(in_srgb,var(--brand-color)_40%,transparent)] transition-colors">
          <button
            onClick={() => setShowPicker(true)}
            className="flex-shrink-0 p-1 rounded-lg hover:bg-[#EDEBE8] transition-colors"
            aria-label="Attach a form"
          >
            <Paperclip size={16} className="text-gray-400" />
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
            className="w-9 h-9 rounded-xl flex items-center justify-center disabled:opacity-30 transition-opacity"
            style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}
          >
            <Send size={15} className="text-white" />
          </button>
        </div>
      </div>

      {showPicker && (
        <FormPicker
          tenantId={tenantId}
          selected={attachments}
          onToggle={toggleAttachment}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
};

// ─── Read-only Channel View (members can read, not post) ──────────────────────

const ChannelView: React.FC<{
  channel: Channel;
  tenantId: string;
  currentUser: { uid: string; name: string };
  onBack: () => void;
  embedded?: boolean;
}> = ({ channel, tenantId, currentUser, onBack, embedded = false }) => {
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Single-field filter only (channelId); sort client-side to avoid a composite index.
    const q = query(
      collection(db, 'tenants', tenantId, 'channelMessages'),
      where('channelId', '==', channel.id),
      limit(300)
    );
    return onSnapshot(q, snap => {
      setMessages(sortByTime(snap.docs.map(d => ({ id: d.id, ...d.data() }) as ChannelMessage), 'createdAt', 'asc'));
    }, () => {});
  }, [channel.id, tenantId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const content = text.trim();
      await addDoc(collection(db, 'tenants', tenantId, 'channelMessages'), {
        channelId: channel.id,
        senderId: currentUser.uid,
        senderName: currentUser.name,
        senderRole: 'user',
        content,
        createdAt: serverTimestamp(),
        edited: false,
      });
      await updateDoc(doc(db, 'tenants', tenantId, 'channels', channel.id), {
        lastMessage: content,
        lastMessageAt: serverTimestamp(),
      }).catch(() => {});
      setText('');
    } catch (e) { console.error(e); }
    finally { setSending(false); }
  };

  return (
    <div className="flex flex-col h-full bg-[#F7F6F3]">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#EDEBE8] bg-white flex-shrink-0">
        <button onClick={onBack} className="p-1 -ml-1 flex-shrink-0" aria-label="Back">
          <ArrowLeft size={22} style={{ color: 'var(--brand-color, #B8962E)' }} />
        </button>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: 'var(--brand-color, #B8962E)1A' }}>
          <Hash size={16} style={{ color: 'var(--brand-color, #B8962E)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-900 text-sm truncate">#{channel.name}</p>
          {channel.description && <p className="text-xs text-gray-400 truncate">{channel.description}</p>}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <Megaphone size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No messages yet</p>
          </div>
        )}
        {groupMessages(messages).map(group => {
          const isAdmin = group.senderRole === 'admin' || group.senderRole === 'church_admin' || group.senderRole === 'super_admin';
          return (
            <div key={group.messages[0].id} className="flex gap-3">
              <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
                style={{ backgroundColor: isAdmin ? 'var(--brand-color, #B8962E)' : '#6b7280' }}>
                {(group.senderName || 'A').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-sm font-semibold text-gray-900">{group.senderName || 'Member'}</span>
                  <RoleBadge role={group.senderRole} />
                  <span className="text-[10px] text-gray-400">{fmtTime(group.messages[0].createdAt)}</span>
                </div>
                <div className="space-y-1">
                  {group.messages.map(m => (
                    <div key={m.id} className="group flex items-end gap-2">
                      <div className="max-w-[78%]">
                        {m.content && (
                          <p className="bg-white border border-[#EDEBE8] rounded-2xl rounded-tl-sm px-3 py-2 text-sm text-gray-800 shadow-sm break-words">
                            {m.content}
                          </p>
                        )}
                        {m.attachments?.map((a, i) => <AttachmentCard key={i} attachment={a} tenantId={tenantId} />)}
                      </div>
                      <span className="text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mb-1">{fmtTime(m.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* When embedded in the app, the bottom nav's safe-area padding and the
          content wrapper's bottom padding already clear the home indicator, so
          the composer only needs a small pad — adding the safe-area inset again
          here double-stacks and leaves a dead gap. Standalone still needs it. */}
      <div className="bg-white border-t border-[#EDEBE8] flex-shrink-0 px-4 pt-3" style={{ paddingBottom: embedded ? '8px' : 'calc(env(safe-area-inset-bottom) + 8px)' }}>
        <div className="flex gap-2 items-center bg-[#F7F6F3] rounded-2xl px-3 py-2.5 border border-[#EDEBE8] focus-within:border-[color-mix(in_srgb,var(--brand-color)_40%,transparent)] transition-colors">
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
            placeholder={`Message #${channel.name}`}
            className="flex-1 bg-transparent outline-none text-sm text-gray-900 placeholder-gray-400"
          />
          <button
            onClick={send}
            disabled={!text.trim() || sending}
            className="w-9 h-9 rounded-xl flex items-center justify-center disabled:opacity-30 transition-opacity"
            style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}
          >
            <Send size={15} className="text-white" />
          </button>
        </div>
      </div>
    </div>
  );
};

interface UserMessagesProps {
  onBack: () => void;
  /** When true, the component is shown inside a top tab (no list-level back button). */
  embedded?: boolean;
}

const UserMessages: React.FC<UserMessagesProps> = ({ onBack, embedded = false }) => {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<{ uid: string; name: string } | null>(null);
  const [dms, setDms] = useState<DirectMessage[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDm, setOpenDm] = useState<DirectMessage | null>(null);
  const [openChannel, setOpenChannel] = useState<Channel | null>(null);
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [admins, setAdmins] = useState<AdminContact[]>([]);
  const [adminsLoading, setAdminsLoading] = useState(false);
  const [adminSearch, setAdminSearch] = useState('');
  const [creating, setCreating] = useState<string | null>(null);
  // Only admins / super admins can list the tenant's users (Firestore rules), so the
  // "New Message" admin picker is only shown to them — a regular member would just
  // hit a permission-denied list query and an empty picker.
  const [canStartDm, setCanStartDm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getTenantScope().then(async tid => {
      if (cancelled) return;
      // tid is the subdomain tenant when on one (authoritative). The platform
      // fallback applies ONLY in platform context (apex domain, super admin) so we
      // never leak the platform tenant's DMs into a tenant subdomain view.
      const resolved = tid || (isPlatformContext() ? PLATFORM_TENANT_ID : null);
      setTenantId(resolved);
      if (!auth.currentUser) { setLoading(false); return; }
      const { getDoc } = await import('firebase/firestore');
      const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
      const name = userDoc.exists()
        ? (userDoc.data().displayName || auth.currentUser.displayName || 'You')
        : (auth.currentUser.displayName || 'You');
      const role = userDoc.exists() ? (userDoc.data().role || 'user') : 'user';
      if (cancelled) return;
      setCurrentUser({ uid: auth.currentUser.uid, name });
      setCanStartDm(isSuperAdminEmail(auth.currentUser.email) || ADMIN_ROLES.includes(role));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!tenantId || !currentUser) return;
    // array-contains only (no orderBy) so no composite index is required.
    const q = query(
      collection(db, 'tenants', tenantId, 'directMessages'),
      where('participants', 'array-contains', currentUser.uid),
      limit(50)
    );
    return onSnapshot(q, snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }) as DirectMessage);
      rows.sort((a, b) => (b.lastMessageAt?.toMillis() || 0) - (a.lastMessageAt?.toMillis() || 0));
      setDms(rows);
    }, () => {});
  }, [tenantId, currentUser]);

  // Channels the user is a member of (array-contains needs no composite index).
  useEffect(() => {
    if (!tenantId || !currentUser) return;
    const q = query(
      collection(db, 'tenants', tenantId, 'channels'),
      where('members', 'array-contains', currentUser.uid),
      limit(50)
    );
    return onSnapshot(q, snap => {
      setChannels(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Channel));
    }, () => {});
  }, [tenantId, currentUser]);

  const getOtherName = (dm: DirectMessage): string => {
    if (!currentUser) return 'Admin';
    const otherId = dm.participants.find(p => p !== currentUser.uid) || '';
    return (dm as any).participantNames?.[otherId] || 'Admin';
  };

  // Load the tenant's admins for the "New Message" picker. Single-field equality
  // query (no composite index); roles filtered client-side. For the platform tenant
  // under a super admin, legacy null-tenant admin docs are merged in too.
  // (Firestore rules only permit super admins / tenant admins to list users, so for
  // a regular member this resolves to an empty list — handled gracefully in the UI.)
  const loadAdmins = async () => {
    if (!tenantId || !currentUser) return;
    setAdminsLoading(true);
    try {
      // Only applies in platform context: a subdomain's tenantId is never
      // PLATFORM_TENANT_ID, so legacy null-tenant users are merged in for the
      // platform tenant only — never into a tenant subdomain's user list.
      const includeNull = isSuperAdminEmail(auth.currentUser?.email) && tenantId === PLATFORM_TENANT_ID;
      const snaps = await Promise.all([
        getDocs(query(collection(db, 'users'), where('tenantId', '==', tenantId), limit(200))),
        ...(includeNull ? [getDocs(query(collection(db, 'users'), where('tenantId', '==', null), limit(200)))] : []),
      ]);
      const seen = new Set<string>();
      const rows: AdminContact[] = [];
      snaps.forEach(snap => snap.docs.forEach(d => {
        if (seen.has(d.id) || d.id === currentUser.uid) return;
        const data = d.data();
        if (!ADMIN_ROLES.includes(data.role)) return;
        seen.add(d.id);
        rows.push({ id: d.id, displayName: data.displayName || data.email || 'Admin', photoURL: data.photoURL, role: data.role });
      }));
      rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
      setAdmins(rows);
    } catch {
      setAdmins([]);
    } finally {
      setAdminsLoading(false);
    }
  };

  const openNewMessage = () => {
    setAdminSearch('');
    setShowNewMessage(true);
    loadAdmins();
  };

  // Create (or reopen) a DM with the chosen admin, then jump into the thread.
  const startDm = async (admin: AdminContact) => {
    if (!tenantId || !currentUser || creating) return;
    const existing = dms.find(dm => dm.participants.includes(admin.id) && dm.participants.includes(currentUser.uid));
    if (existing) { setOpenDm(existing); setShowNewMessage(false); return; }
    setCreating(admin.id);
    try {
      const participantNames = { [currentUser.uid]: currentUser.name, [admin.id]: admin.displayName };
      const participantRoles = { [currentUser.uid]: 'user', [admin.id]: 'admin' };
      const ref = await addDoc(collection(db, 'tenants', tenantId, 'directMessages'), {
        participants: [currentUser.uid, admin.id],
        participantRoles,
        participantNames,
        createdAt: serverTimestamp(),
        lastMessage: '',
        lastMessageAt: serverTimestamp(),
        initiatedBy: currentUser.uid,
      });
      setShowNewMessage(false);
      setOpenDm({
        id: ref.id,
        participants: [currentUser.uid, admin.id],
        participantRoles,
        participantNames,
        lastMessage: '',
        lastMessageAt: null,
        initiatedBy: currentUser.uid,
      });
    } catch (e) {
      console.error(e);
    } finally {
      setCreating(null);
    }
  };

  const filteredAdmins = adminSearch
    ? admins.filter(a => a.displayName.toLowerCase().includes(adminSearch.toLowerCase()))
    : admins;

  if (loading) {
    return (
      <div className="flex flex-col min-h-full bg-[#F7F6F3]">
        <div className="flex items-center gap-3 px-4 py-4 bg-white border-b border-[#EDEBE8]">
          {!embedded && (
            <button onClick={onBack} className="p-1 -ml-1" aria-label="Back">
              <ArrowLeft size={22} style={{ color: 'var(--brand-color, #B8962E)' }} />
            </button>
          )}
          <h2 className="text-lg font-black text-gray-900">Messages</h2>
        </div>
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: 'var(--brand-color, #B8962E)', borderTopColor: 'transparent' }} />
        </div>
      </div>
    );
  }

  if (openChannel && tenantId && currentUser) {
    return (
      <div className="flex flex-col h-full">
        <ChannelView channel={openChannel} tenantId={tenantId} currentUser={currentUser} onBack={() => setOpenChannel(null)} embedded={embedded} />
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
          embedded={embedded}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full bg-[#F7F6F3]">
      <div className="flex items-center gap-3 px-4 py-4 bg-white border-b border-[#EDEBE8]">
        {!embedded && (
          <button onClick={onBack} className="p-1 -ml-1" aria-label="Back">
            <ArrowLeft size={22} style={{ color: 'var(--brand-color, #B8962E)' }} />
          </button>
        )}
        <h2 className="text-lg font-black text-gray-900">Messages</h2>
        {canStartDm && (
          <button
            onClick={openNewMessage}
            className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-white"
            style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}
          >
            <PenSquare size={15} /> New Message
          </button>
        )}
      </div>

      <div className="flex-1 p-4">
        {dms.length === 0 && channels.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <MessageSquare size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">No messages yet</p>
            <p className="text-sm mt-1">
              {canStartDm
                ? <>Tap <span className="font-semibold text-gray-500">New Message</span> to start a conversation.</>
                : 'Your admin will reach out here.'}
            </p>
          </div>
        ) : (
          <>
            {channels.length > 0 && (
              <div className="mb-5">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Channels</p>
                <div className="space-y-2">
                  {channels.map(ch => (
                    <button
                      key={ch.id}
                      onClick={() => setOpenChannel(ch)}
                      className="w-full bg-white rounded-2xl border border-[#EDEBE8] px-4 py-3.5 flex items-center gap-3 hover:border-[color-mix(in_srgb,var(--brand-color)_40%,transparent)] hover:shadow-sm transition-all text-left"
                    >
                      <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center"
                        style={{ backgroundColor: 'var(--brand-color, #B8962E)1A' }}>
                        <Hash size={18} style={{ color: 'var(--brand-color, #B8962E)' }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-900 truncate">#{ch.name}</p>
                        <p className="text-xs text-gray-400 truncate">{ch.lastMessage || ch.description || 'No messages yet'}</p>
                      </div>
                      {ch.lastMessageAt && <span className="text-[10px] text-gray-400 flex-shrink-0">{fmtTime(ch.lastMessageAt)}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {dms.length > 0 && (
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Direct Messages</p>
            )}
            <div className="space-y-2">
            {dms.map(dm => (
              <button
                key={dm.id}
                onClick={() => setOpenDm(dm)}
                className="w-full bg-white rounded-2xl border border-[#EDEBE8] px-4 py-3.5 flex items-center gap-3 hover:border-[color-mix(in_srgb,var(--brand-color)_40%,transparent)] hover:shadow-sm transition-all text-left"
              >
                <div className="w-11 h-11 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold text-white"
                  style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}>
                  {getOtherName(dm).charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">{getOtherName(dm)}</p>
                  {dm.lastMessage && <p className="text-xs text-gray-400 truncate">{dm.lastMessage}</p>}
                </div>
                {dm.lastMessageAt && <span className="text-[10px] text-gray-400 flex-shrink-0">{fmtTime(dm.lastMessageAt)}</span>}
              </button>
            ))}
            </div>
          </>
        )}
      </div>

      {showNewMessage && (
        <div className="fixed inset-0 z-[300] flex items-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowNewMessage(false)} />
          <div className="relative w-full bg-white rounded-t-2xl max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
              <h3 className="font-bold text-gray-900 text-sm">New Message</h3>
              <button onClick={() => setShowNewMessage(false)}><X size={18} className="text-gray-400" /></button>
            </div>
            <div className="relative mx-4 mt-3 mb-2 flex-shrink-0">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={adminSearch}
                onChange={e => setAdminSearch(e.target.value)}
                placeholder="Search admins..."
                className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-gold"
              />
            </div>
            <div className="overflow-y-auto flex-1">
              {adminsLoading ? (
                <div className="flex items-center justify-center py-10">
                  <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #B8962E)', borderTopColor: 'transparent' }} />
                </div>
              ) : filteredAdmins.length === 0 ? (
                <p className="text-center py-10 text-sm text-gray-400 px-6">{adminSearch ? 'Nothing found' : 'No admins available to message yet.'}</p>
              ) : filteredAdmins.map(a => (
                <button
                  key={a.id}
                  onClick={() => startDm(a)}
                  disabled={!!creating}
                  className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  {a.photoURL ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.photoURL} alt={a.displayName} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: '#B8962E' }}>
                      {a.displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{a.displayName}</p>
                    <p className="text-xs text-gray-400 truncate">{a.role === 'super_admin' ? 'Super Admin' : a.role === 'church_admin' ? 'Church Admin' : 'Admin'}</p>
                  </div>
                  {creating === a.id && (
                    <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin flex-shrink-0" style={{ borderColor: '#B8962E', borderTopColor: 'transparent' }} />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserMessages;
