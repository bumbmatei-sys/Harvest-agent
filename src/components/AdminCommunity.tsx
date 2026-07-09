"use client";
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Hash, MessageSquare, Plus, Send, Users, X, Search, ChevronRight, Megaphone, Paperclip, UserPlus
} from 'lucide-react';
import {
  collection, query, where, orderBy, onSnapshot, addDoc, updateDoc, doc, getDoc,
  serverTimestamp, getDocs, limit, Timestamp, arrayUnion, arrayRemove,
  type QueryDocumentSnapshot
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { getTenantId, getTenantIdFromHost, isPlatformContext, PLATFORM_TENANT_ID } from '../utils/tenant-scope';
import { isSuperAdminEmail } from '../utils/super-admins';
import { notifyError } from '../utils/notify';
import { sortByTime } from '../utils/query-helpers';
import { useAdminHeader } from './AdminScreenHeader';

/**
 * Fetch documents in a flat collection scoped by a `tenantId` field, using only
 * single-field equality (no composite index). For the platform tenant viewed by
 * a super admin, also pull in legacy records whose `tenantId` is null and merge
 * them (deduped) — this is why Harvest-tenant data appears empty otherwise.
 */
async function dualTenantDocs(
  collName: string,
  tenantId: string,
  includeNull: boolean,
  max: number,
): Promise<QueryDocumentSnapshot[]> {
  const primary = await getDocs(query(collection(db, collName), where('tenantId', '==', tenantId), limit(max)));
  if (!includeNull) return primary.docs;
  const legacy = await getDocs(query(collection(db, collName), where('tenantId', '==', null), limit(max)));
  const seen = new Set(primary.docs.map(d => d.id));
  return [...primary.docs, ...legacy.docs.filter(d => !seen.has(d.id))];
}

/**
 * Load `users` docs for an admin scope. For the platform super admin (includeNull),
 * members created BEFORE the tenant existed may carry a null OR a *missing*
 * tenantId — which an equality query can't union (Firestore can't match a missing
 * field) — so fetch and keep the platform-owned rows (tenantId == tenant / null /
 * '' / missing). A super admin may read the whole `users` collection. Regular
 * tenant admins keep the cheap, precise equality query.
 */
async function loadScopedUserDocs(
  tenantId: string,
  includeNull: boolean,
  max: number,
): Promise<QueryDocumentSnapshot[]> {
  if (!includeNull) {
    return (await getDocs(query(collection(db, 'users'), where('tenantId', '==', tenantId), limit(max)))).docs;
  }
  const snap = await getDocs(query(collection(db, 'users'), limit(max)));
  return snap.docs.filter(d => {
    const t = (d.data() as { tenantId?: string | null }).tenantId;
    return t == null || t === '' || t === tenantId;
  });
}

/** Avatar initials from a display name: first letter of first + last word. */
function initialsFromName(name?: string): string {
  if (!name || !name.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase() || '?';
}

// Session cache of sender photo URLs, keyed by uid (fetched once per uid).
const senderPhotoCache = new Map<string, string | null>();

// NOTE: the old null→tenantId self-stamp "migration" is gone: firestore.rules
// now locks users.tenantId against self-edits (server-authority), so the write
// can never succeed. Legacy null-tenantId users keep working via the dual-query
// (includeNull) paths below; a real backfill belongs server-side.

/**
 * Message avatar — shows the sender's Firestore photoURL as a circular image, or
 * gold initials when there is no photo. The sender doc is fetched once per uid
 * and cached for the session.
 */
const MessageAvatar: React.FC<{ senderId: string; senderName: string; bg?: string }> = ({ senderId, senderName, bg = 'var(--brand-color, #B8962E)' }) => {
  const [photoURL, setPhotoURL] = useState<string | null>(() => senderPhotoCache.get(senderId) ?? null);

  useEffect(() => {
    if (senderPhotoCache.has(senderId)) { setPhotoURL(senderPhotoCache.get(senderId) ?? null); return; }
    let cancelled = false;
    getDoc(doc(db, 'users', senderId))
      .then(snap => {
        const url = (snap.exists() ? (snap.data().photoURL as string | undefined) : undefined) || null;
        senderPhotoCache.set(senderId, url);
        if (!cancelled) setPhotoURL(url);
      })
      .catch(() => { senderPhotoCache.set(senderId, null); });
    return () => { cancelled = true; };
  }, [senderId]);

  if (photoURL) {
    return <img src={photoURL} alt={senderName} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />;
  }
  return (
    <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: bg }}>
      {initialsFromName(senderName)}
    </div>
  );
};

interface MessageAttachment {
  type: 'doc' | 'contact' | 'campaign' | 'form';
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
  lastMessage?: string;
  lastMessageAt?: Timestamp | null;
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
type AttachTab = 'docs' | 'contacts' | 'campaigns' | 'forms';

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

// Group consecutive messages from the same sender (within 3 minutes) so the
// avatar + name header renders only on the first message of each run. Generic
// over both channel and DM message shapes (senderRole is optional for DMs).
interface GroupableMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderRole?: string;
  createdAt: Timestamp | null;
}

function groupMessages<T extends GroupableMessage>(msgs: T[]) {
  const groups: { sender: string; senderName: string; senderRole: string; messages: T[] }[] = [];
  for (const msg of msgs) {
    const last = groups[groups.length - 1];
    const lastMsg = last?.messages[last.messages.length - 1];
    const isSameSender = last?.sender === msg.senderId;
    const isWithin3min = last && msg.createdAt && lastMsg?.createdAt
      ? Math.abs(
          ((msg.createdAt as any)?.toDate?.()?.getTime?.() ?? 0) -
          ((lastMsg.createdAt as any)?.toDate?.()?.getTime?.() ?? 0)
        ) < 3 * 60 * 1000
      : false;
    if (isSameSender && isWithin3min) {
      last.messages.push(msg);
    } else {
      groups.push({ sender: msg.senderId, senderName: msg.senderName, senderRole: msg.senderRole || '', messages: [msg] });
    }
  }
  return groups;
}

// Admin (gold) / User (grey) role badge shown next to channel message senders.
const RoleBadge: React.FC<{ role?: string }> = ({ role }) => {
  const isAdmin = role === 'admin' || role === 'church_admin' || role === 'super_admin';
  return (
    <span
      className="text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none"
      style={isAdmin ? { backgroundColor: 'color-mix(in srgb, var(--brand-color, #B8962E) 12%, white)', color: 'var(--brand-color, #B8962E)' } : { backgroundColor: '#F3EEE7', color: '#8B7355' }}
    >
      {isAdmin ? 'Admin' : 'User'}
    </span>
  );
};

// ─── Attachment Card ─────────────────────────────────────────────────────────

const AttachmentCard: React.FC<{ attachment: MessageAttachment; onOpen?: () => void }> = ({ attachment, onOpen }) => {
  const icon = attachment.type === 'doc' ? '📄' : attachment.type === 'contact' ? '👤' : attachment.type === 'form' ? '📝' : '🎯';
  const label = attachment.type === 'doc' ? 'Open Doc' : attachment.type === 'contact' ? 'View Contact' : attachment.type === 'form' ? 'Open Form' : 'View Campaign';
  return (
    <div className="mt-1.5 bg-white border border-[#E8E2D9] rounded-2xl overflow-hidden shadow-sm" style={{ maxWidth: 224 }}>
      <div className="flex items-start gap-2 p-3 pb-2">
        <span className="text-lg leading-none flex-shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-earth truncate leading-tight">{attachment.title}</p>
          <p className="text-[10px] text-[color:var(--text-faint)] truncate mt-0.5">{attachment.subtitle}</p>
        </div>
      </div>
      <div className="px-3 pb-3">
        <div className="h-px bg-[#E8E2D9] mb-2" />
        <button
          onClick={onOpen}
          disabled={!onOpen}
          className="w-full text-[11px] font-bold py-1.5 rounded-lg text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
        >
          {label}
        </button>
      </div>
    </div>
  );
};

// ─── Attach Picker ───────────────────────────────────────────────────────────

const AttachPicker: React.FC<{
  tenantId: string;
  includeNull: boolean;
  selected: MessageAttachment[];
  onToggle: (a: MessageAttachment) => void;
  onClose: () => void;
}> = ({ tenantId, includeNull, selected, onToggle, onClose }) => {
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
    // Query by equality only so no composite index is required. For the platform
    // tenant under a super admin, legacy null-tenant records are merged in too.
    console.log('[AttachPicker] currentTenantId:', tenantId, 'includeNull:', includeNull, 'tab:', tab);
    const run = async () => {
      try {
        if (tab === 'docs') {
          const [docsDocs, foldersDocs] = await Promise.all([
            dualTenantDocs('docs', tenantId, includeNull, 50),
            dualTenantDocs('docFolders', tenantId, includeNull, 100),
          ]);
          if (cancelled) return;
          const folderNames = new Map<string, string>();
          foldersDocs.forEach(f => folderNames.set(f.id, (f.data().name as string) || 'Folder'));
          const rows = docsDocs.map(d => {
            const data = d.data();
            const folder = data.folderId ? folderNames.get(data.folderId) : null;
            const updated = (data.updatedAt as Timestamp | undefined)?.toDate?.();
            const subtitle = folder || (updated ? updated.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Doc');
            return { type: 'doc' as const, id: d.id, title: (data.title as string) || 'Untitled', subtitle, _sort: (data.updatedAt as Timestamp | undefined)?.toMillis?.() || 0 };
          });
          rows.sort((a, b) => b._sort - a._sort);
          setItems(rows.map(({ _sort, ...r }) => r));
        } else if (tab === 'contacts') {
          const contactDocs = await dualTenantDocs('contacts', tenantId, includeNull, 100);
          if (cancelled) return;
          const typeLabel: Record<string, string> = { donor: 'Donor', member: 'Member', both: 'Donor & Member' };
          setItems(contactDocs.map(d => {
            const data = d.data();
            const name = `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'Unknown';
            const badge = typeLabel[data.type as string] || 'Contact';
            const subtitle = data.email ? `${badge} · ${data.email}` : badge;
            return { type: 'contact' as const, id: d.id, title: name, subtitle };
          }));
        } else if (tab === 'campaigns') {
          const campaignDocs = await dualTenantDocs('campaigns', tenantId, includeNull, 50);
          if (cancelled) return;
          setItems(campaignDocs.map(d => {
            const data = d.data();
            const raised = (data.raised as number) || 0;
            const goal = (data.goal as number) || 0;
            const status = data.isActive ? 'Active' : 'Inactive';
            const money = goal > 0
              ? `$${raised.toLocaleString()} of $${goal.toLocaleString()}`
              : `$${raised.toLocaleString()} raised`;
            return { type: 'campaign' as const, id: d.id, title: (data.title as string) || 'Campaign', subtitle: `${money} · ${status}` };
          }));
        } else {
          // Forms live in the tenant SUBCOLLECTION (tenants/{tenantId}/forms), not a
          // flat tenantId-scoped collection — so dualTenantDocs does not apply here.
          // Only list forms that are publicly openable (active !== false).
          const snap = await getDocs(query(collection(db, 'tenants', tenantId, 'forms'), orderBy('createdAt', 'desc'), limit(50)));
          if (cancelled) return;
          setItems(snap.docs
            .filter(d => d.data().active !== false)
            .map(d => {
              const data = d.data();
              const count = (data.submissionCount as number) || 0;
              return { type: 'form' as const, id: d.id, title: (data.title as string) || 'Untitled Form', subtitle: `${count} ${count === 1 ? 'submission' : 'submissions'}` };
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
  }, [tab, tenantId, includeNull]);

  const emptyLabel = tab === 'docs' ? 'No docs yet' : tab === 'contacts' ? 'No contacts yet' : tab === 'forms' ? 'No active forms yet' : 'No campaigns yet';

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
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200 flex-shrink-0">
          <h3 className="font-display font-bold text-earth text-sm">Attach Record</h3>
          <button onClick={onClose}><X size={18} className="text-[color:var(--text-faint)]" /></button>
        </div>
        <div className="flex gap-1 bg-stone-100 rounded-xl p-1 mx-4 mt-3 mb-2 flex-shrink-0">
          {([['docs', 'Notes & Docs'], ['contacts', 'Contacts'], ['campaigns', 'Fundraising'], ['forms', 'Forms']] as [AttachTab, string][]).map(([id, lbl]) => (
            <button
              key={id}
              onClick={() => { setTab(id as AttachTab); setSearch(''); }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${tab === id ? 'bg-white shadow-sm text-earth' : 'text-warm-brown'}`}
            >
              {lbl}
            </button>
          ))}
        </div>
        <div className="relative mx-4 mb-2 flex-shrink-0">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-faint)]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-stone-200 rounded-xl focus:outline-none focus:border-gold"
          />
        </div>
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #d4a017)', borderTopColor: 'transparent' }} />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center py-10 text-sm text-[color:var(--text-faint)]">{search ? 'Nothing found' : emptyLabel}</p>
          ) : filtered.map(item => {
            const sel = isSelected(item.id);
            const icon = item.type === 'doc' ? '📄' : item.type === 'contact' ? '👤' : item.type === 'form' ? '📝' : '🎯';
            return (
              <button
                key={item.id}
                onClick={() => onToggle(item)}
                className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors ${sel ? 'bg-amber-50' : 'hover:bg-stone-100'}`}
              >
                <span className="text-xl flex-shrink-0">{icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-earth truncate">{item.title}</p>
                  <p className="text-xs text-[color:var(--text-faint)] truncate">{item.subtitle}</p>
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
          <div className="p-4 border-t border-stone-200 flex-shrink-0">
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
  includeNull: boolean;
  channelId: string;
  onClose: () => void;
}> = ({ tenantId, includeNull, channelId, onClose }) => {
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

  // Tenant users (equality-only query — no composite index needed). For the
  // platform tenant under a super admin, also include legacy null-tenant users.
  useEffect(() => {
    let cancelled = false;
    console.log('[ChannelMembersSheet] currentTenantId:', tenantId, 'includeNull:', includeNull);
    loadScopedUserDocs(tenantId, includeNull, 200)
      .then(docs => {
        if (cancelled) return;
        setUsers(docs.map(d => ({ id: d.id, ...d.data() }) as AdminUser));
        setLoading(false);
      })
      .catch(e => { if (!cancelled) { setLoading(false); notifyError('Failed to load users', e); } });
    return () => { cancelled = true; };
  }, [tenantId, includeNull]);

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
      <div className="relative w-full bg-white rounded-t-3xl max-h-[75vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8E2D9] flex-shrink-0">
          <h3 className="font-display font-bold text-earth text-sm">Channel Members</h3>
          <button onClick={onClose}><X size={18} className="text-[color:var(--text-faint)]" /></button>
        </div>

        {/* Current members */}
        <div className="px-5 pt-3 pb-1 flex-shrink-0">
          <p className="text-[11px] font-semibold text-gold uppercase tracking-[0.14em] mb-2">Members · {members.length}</p>
        </div>
        <div className="overflow-y-auto flex-shrink-0" style={{ maxHeight: '28vh' }}>
          {memberUsers.length === 0 ? (
            <p className="text-center py-4 text-sm text-[color:var(--text-faint)]">No members yet</p>
          ) : memberUsers.map(u => (
            <div key={u.id} className="flex items-center gap-3 px-5 py-2.5">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}>
                {u.displayName?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-earth truncate">{u.displayName || 'Unknown'}</p>
                <p className="text-xs text-[color:var(--text-faint)] truncate">{u.email}</p>
              </div>
              <RoleBadge role={u.role} />
              <button onClick={() => removeMember(u.id)} className="p-1.5 rounded-lg hover:bg-red-50">
                <X size={15} className="text-red-400" />
              </button>
            </div>
          ))}
        </div>

        {/* Add members */}
        <div className="px-4 pt-3 pb-2 border-t border-[#E8E2D9] flex-shrink-0">
          <p className="text-xs font-bold text-[color:var(--text-faint)] uppercase tracking-wider mb-2 px-1">Add Members</p>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-faint)]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or email..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-stone-200 rounded-xl focus:outline-none focus:border-gold"
            />
          </div>
        </div>
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #d4a017)', borderTopColor: 'transparent' }} />
            </div>
          ) : addable.length === 0 ? (
            <p className="text-center py-8 text-sm text-[color:var(--text-faint)]">{search ? 'No users found' : 'No users found in this tenant'}</p>
          ) : addable.map(u => (
            <button key={u.id} onClick={() => addMember(u.id)} className="w-full flex items-center gap-3 px-5 py-2.5 text-left hover:bg-stone-100">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 bg-gray-400">
                {u.displayName?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-earth truncate">{u.displayName || 'Unknown'}</p>
                <p className="text-xs text-[color:var(--text-faint)] truncate">{u.email}</p>
              </div>
              <UserPlus size={16} style={{ color: 'var(--brand-color, #B8962E)' }} className="flex-shrink-0" />
            </button>
          ))}
        </div>
        <div className="p-4 border-t border-[#E8E2D9] flex-shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Channel Thread ──────────────────────────────────────────────────────────

const ChannelThread: React.FC<{
  channel: Channel;
  tenantId: string;
  includeNull: boolean;
  currentUser: { uid: string; name: string };
  onOpenAttachment?: (type: MessageAttachment['type'], id: string) => void;
}> = ({ channel, tenantId, includeNull, currentUser, onOpenAttachment }) => {
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Single-field filter only (channelId); sort client-side to avoid a composite index.
    const q = query(
      collection(db, 'tenants', tenantId, 'channelMessages'),
      where('channelId', '==', channel.id),
      limit(300)
    );
    const unsub = onSnapshot(q, (snap) => {
      setMessages(sortByTime(snap.docs.map(d => ({ id: d.id, ...d.data() }) as ChannelMessage), 'createdAt', 'asc'));
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
      const content = text.trim();
      await addDoc(collection(db, 'tenants', tenantId, 'channelMessages'), payload);
      await updateDoc(doc(db, 'tenants', tenantId, 'channels', channel.id), {
        lastMessage: content || (attachments.length > 0 ? `📎 ${attachments[0].title}` : ''),
        lastMessageAt: serverTimestamp(),
      }).catch(() => {});
      setText('');
      setAttachments([]);
    } catch (e) { notifyError('Failed to send message', e); }
    finally { setSending(false); }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-12 text-[color:var(--text-faint)]">
            <Megaphone size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No messages yet. Be the first to post.</p>
          </div>
        )}
        {groupMessages(messages).map(group => (
          <div key={group.messages[0].id} className="flex gap-3">
            <MessageAvatar senderId={group.sender} senderName={group.senderName} />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-sm font-semibold text-earth">{group.senderName}</span>
                <RoleBadge role={group.senderRole} />
                <span className="text-[10px] text-[color:var(--text-faint)]">{fmtTime(group.messages[0].createdAt)}</span>
              </div>
              <div className="space-y-1">
                {group.messages.map(m => (
                  <div key={m.id} className="group flex items-end gap-2">
                    <div className="max-w-[78%]">
                      {m.content && (
                        <p className="bg-white border border-[#E8E2D9] rounded-2xl rounded-tl-sm px-3 py-2 text-sm text-[color:var(--text-body)] shadow-sm break-words">
                          {m.content}
                        </p>
                      )}
                      {m.attachments?.map((a, i) => (
                        <AttachmentCard
                          key={i}
                          attachment={a}
                          onOpen={
                            a.type === 'form'
                              ? () => window.open(`https://${tenantId}.theharvest.app/form/${a.id}`, '_blank', 'noopener')
                              : (onOpenAttachment ? () => onOpenAttachment(a.type, a.id) : undefined)
                          }
                        />
                      ))}
                    </div>
                    <span className="text-[10px] text-[color:var(--text-faint)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mb-1">{fmtTime(m.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Always embedded in the admin dashboard, so the fixed bottom nav's
          safe-area padding + the content wrapper's bottom inset already clear
          the home indicator; an extra safe-area inset here would double-stack. */}
      <div className="bg-white border-t border-[#E8E2D9] flex-shrink-0 px-4 pt-3" style={{ paddingBottom: '8px' }}>
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {attachments.map((a, i) => (
              <div key={i} className="flex items-center gap-1.5 bg-[color-mix(in_srgb,var(--brand-color)_12%,white)] border border-[color-mix(in_srgb,var(--brand-color)_30%,white)] rounded-lg px-2.5 py-1 text-xs font-medium text-gold">
                <span className="text-sm">{a.type === 'doc' ? '📄' : a.type === 'contact' ? '👤' : a.type === 'form' ? '📝' : '🎯'}</span>
                <span className="max-w-[90px] truncate">{a.title}</span>
                <button onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}>
                  <X size={11} className="text-[color-mix(in_srgb,var(--brand-color)_60%,transparent)]" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 items-center bg-[#F7F6F3] rounded-2xl px-3 py-2.5 border border-[#E8E2D9] focus-within:border-[color-mix(in_srgb,var(--brand-color)_40%,transparent)] transition-colors">
          <button
            onClick={() => setShowPicker(true)}
            className="flex-shrink-0 p-1 rounded-lg hover:bg-[#E8E2D9] transition-colors"
          >
            <Paperclip size={16} className="text-[color:var(--text-faint)]" />
          </button>
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
            placeholder={`Post to #${channel.name}`}
            className="flex-1 bg-transparent outline-none text-sm text-earth placeholder-gray-400"
          />
          <button
            onClick={send}
            disabled={(!text.trim() && attachments.length === 0) || sending}
            className="w-9 h-9 rounded-xl flex items-center justify-center disabled:opacity-30 transition-opacity"
            style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}
          >
            <Send size={15} color="white" />
          </button>
        </div>
      </div>

      {showPicker && (
        <AttachPicker
          tenantId={tenantId}
          includeNull={includeNull}
          selected={attachments}
          onToggle={toggleAttachment}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
};

// ─── DM Thread ────────────────────────────────────────────────────────────────

const DmThread: React.FC<{
  dm: DirectMessage;
  tenantId: string;
  includeNull: boolean;
  currentUser: { uid: string; name: string };
  otherName: string;
  onOpenAttachment?: (type: MessageAttachment['type'], id: string) => void;
}> = ({ dm, tenantId, includeNull, currentUser, otherName, onOpenAttachment }) => {
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Single-field filter only (dmId); sort client-side to avoid a composite index.
    const q = query(
      collection(db, 'tenants', tenantId, 'dmMessages'),
      where('dmId', '==', dm.id),
      limit(300)
    );
    const unsub = onSnapshot(q, (snap) => {
      setMessages(sortByTime(snap.docs.map(d => ({ id: d.id, ...d.data() }) as DmMessage), 'createdAt', 'asc'));
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
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-12 text-[color:var(--text-faint)]">
            <MessageSquare size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">Start the conversation</p>
          </div>
        )}
        {groupMessages(messages).map(group => {
          const isMe = group.sender === currentUser.uid;
          return (
            <div key={group.messages[0].id} className="space-y-1">
              {group.messages.map((m, mi) => {
                const isFirst = mi === 0;
                if (isMe) {
                  return (
                    <div key={m.id} className="flex justify-end">
                      <div className="flex flex-col items-end max-w-[78%]">
                        {m.content && (
                          <div className="bg-gold text-white rounded-2xl rounded-br-sm px-3.5 py-2.5 text-sm break-words">{m.content}</div>
                        )}
                        {m.attachments?.map((a, i) => (
                          <AttachmentCard
                            key={i}
                            attachment={a}
                            onOpen={
                              a.type === 'form'
                                ? () => window.open(`https://${tenantId}.theharvest.app/form/${a.id}`, '_blank', 'noopener')
                                : (onOpenAttachment ? () => onOpenAttachment(a.type, a.id) : undefined)
                            }
                          />
                        ))}
                        <span className="text-[10px] text-[color:var(--text-faint)] mt-0.5 text-right">{fmtTime(m.createdAt)}</span>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={m.id} className="flex gap-2.5 items-end">
                    {isFirst
                      ? <MessageAvatar senderId={group.sender} senderName={group.senderName} bg="#8B7355" />
                      : <div className="w-8 flex-shrink-0" />}
                    <div className="flex flex-col items-start max-w-[78%]">
                      {isFirst && <span className="text-[10px] font-semibold text-[color:var(--text-faint)] mb-0.5 ml-1">{group.senderName}</span>}
                      {m.content && (
                        <div className="bg-[#F0EDE8] text-[color:var(--text-body)] rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-sm break-words">{m.content}</div>
                      )}
                      {m.attachments?.map((a, i) => (
                        <AttachmentCard
                          key={i}
                          attachment={a}
                          onOpen={
                            a.type === 'form'
                              ? () => window.open(`https://${tenantId}.theharvest.app/form/${a.id}`, '_blank', 'noopener')
                              : (onOpenAttachment ? () => onOpenAttachment(a.type, a.id) : undefined)
                          }
                        />
                      ))}
                      <span className="text-[10px] text-[color:var(--text-faint)] mt-0.5">{fmtTime(m.createdAt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Always embedded in the admin dashboard, so the fixed bottom nav's
          safe-area padding + the content wrapper's bottom inset already clear
          the home indicator; an extra safe-area inset here would double-stack. */}
      <div className="bg-white border-t border-[#E8E2D9] flex-shrink-0 px-4 pt-3" style={{ paddingBottom: '8px' }}>
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {attachments.map((a, i) => (
              <div key={i} className="flex items-center gap-1.5 bg-[color-mix(in_srgb,var(--brand-color)_12%,white)] border border-[color-mix(in_srgb,var(--brand-color)_30%,white)] rounded-lg px-2.5 py-1 text-xs font-medium text-gold">
                <span className="text-sm">{a.type === 'doc' ? '📄' : a.type === 'contact' ? '👤' : a.type === 'form' ? '📝' : '🎯'}</span>
                <span className="max-w-[90px] truncate">{a.title}</span>
                <button onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}>
                  <X size={11} className="text-[color-mix(in_srgb,var(--brand-color)_60%,transparent)]" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 items-center bg-[#F7F6F3] rounded-2xl px-3 py-2.5 border border-[#E8E2D9] focus-within:border-[color-mix(in_srgb,var(--brand-color)_40%,transparent)] transition-colors">
          <button
            onClick={() => setShowPicker(true)}
            className="flex-shrink-0 p-1 rounded-lg hover:bg-[#E8E2D9] transition-colors"
          >
            <Paperclip size={16} className="text-[color:var(--text-faint)]" />
          </button>
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
            placeholder="Type a message..."
            className="flex-1 bg-transparent outline-none text-sm text-earth placeholder-gray-400"
          />
          <button
            onClick={send}
            disabled={(!text.trim() && attachments.length === 0) || sending}
            className="w-9 h-9 rounded-xl flex items-center justify-center disabled:opacity-30 transition-opacity"
            style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}
          >
            <Send size={15} color="white" />
          </button>
        </div>
      </div>

      {showPicker && (
        <AttachPicker
          tenantId={tenantId}
          includeNull={includeNull}
          selected={attachments}
          onToggle={toggleAttachment}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
};

// ─── Main AdminCommunity ─────────────────────────────────────────────────────

interface AdminCommunityProps {
  /** Navigate to an attached record (doc / contact / campaign) from a message card. */
  onOpenAttachment?: (type: MessageAttachment['type'], id: string) => void;
}

const AdminCommunity: React.FC<AdminCommunityProps> = ({ onOpenAttachment }) => {
  const { setHeaderOverride } = useAdminHeader();
  const [tab, setTab] = useState<MainTab>('channels');
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<{ uid: string; name: string } | null>(null);

  // Channels
  const [channels, setChannels] = useState<Channel[]>([]);
  const [openChannel, setOpenChannel] = useState<Channel | null>(null);
  const [showChannelMembers, setShowChannelMembers] = useState(false);
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelDesc, setNewChannelDesc] = useState('');
  const [savingChannel, setSavingChannel] = useState(false);
  const [channelPool, setChannelPool] = useState<AdminUser[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [channelMemberSearch, setChannelMemberSearch] = useState('');

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

  // Platform tenant ('harvest') viewed by a super admin also surfaces legacy
  // records whose `tenantId` is null (the root cause of empty Harvest results).
  // This only applies in platform context: a tenant subdomain's tenantId is
  // never PLATFORM_TENANT_ID, so null-tenant docs never leak into a subdomain.
  const includeNullTenant = isSuperAdminEmail(auth.currentUser?.email) && tenantId === PLATFORM_TENANT_ID;

  // Drive the shared screen header. When a thread is open the header shows the
  // channel/DM name + a members button, and back closes the thread (so there is
  // exactly one header and one back arrow). Otherwise the dashboard's default
  // "Community Chat" header is used.
  useEffect(() => {
    if (openChannel) {
      setHeaderOverride({
        title: openChannel.name,
        titleIcon: <Hash size={18} style={{ color: 'var(--brand-color, #d4a017)' }} className="flex-shrink-0" />,
        onBack: () => { setShowChannelMembers(false); setOpenChannel(null); },
        action: (
          <button
            onClick={() => setShowChannelMembers(true)}
            className="p-1.5 rounded-lg hover:bg-stone-100"
            aria-label="Channel members"
          >
            <Users size={22} style={{ color: 'var(--brand-color, #B8962E)' }} />
          </button>
        ),
      });
    } else if (openAdminDm || openMemberDm) {
      const dm = (openAdminDm || openMemberDm)!;
      const otherId = dm.participants.find(p => p !== currentUser?.uid) || '';
      const name = dm.participantNames?.[otherId] || otherId.slice(0, 8);
      setHeaderOverride({
        title: name,
        onBack: () => { setOpenAdminDm(null); setOpenMemberDm(null); },
      });
    } else {
      setHeaderOverride(null);
    }
    return () => setHeaderOverride(null);
  }, [openChannel, openAdminDm, openMemberDm, currentUser, setHeaderOverride]);

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
      // (or null, which shows the not-an-admin message below). The platform
      // fallback is gated by platform context so it never fires on a tenant
      // subdomain (where getTenantId/host already yields the correct tenant).
      const resolved = tid || (isPlatformContext() ? PLATFORM_TENANT_ID : null);
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

  // Load all DMs. array-contains only (no orderBy) so no composite index is
  // required; sort newest-first on the client.
  useEffect(() => {
    if (!tenantId || !currentUser) return;
    // Single-field filter only (participants); sort client-side by lastMessageAt.
    const q = query(
      collection(db, 'tenants', tenantId, 'directMessages'),
      where('participants', 'array-contains', currentUser.uid),
      limit(100)
    );
    return onSnapshot(q, snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }) as DirectMessage);
      all.sort((a, b) => (b.lastMessageAt?.toMillis() || 0) - (a.lastMessageAt?.toMillis() || 0));
      setAdminDms(all.filter(dm =>
        dm.participants.every(p => dm.participantRoles?.[p] === 'admin')
      ));
      setMemberDms(all.filter(dm =>
        dm.participants.some(p => dm.participantRoles?.[p] !== 'admin')
      ));
    }, e => notifyError('Failed to load conversations', e));
  }, [tenantId, currentUser]);

  // Load admins list. Query by tenantId only (single-field, no composite index
  // needed) and filter role on the client so the picker never silently fails.
  const loadAdmins = useCallback(async () => {
    if (!tenantId) return;
    try {
      console.log('[AdminCommunity] loadAdmins currentTenantId:', tenantId, 'includeNull:', includeNullTenant);
      const docs = await loadScopedUserDocs(tenantId, includeNullTenant, 200);
      const adminRoles = ['admin', 'church_admin', 'super_admin'];
      setAdmins(docs
        .map(d => ({ id: d.id, ...d.data() }) as AdminUser)
        .filter(a => adminRoles.includes(a.role) && a.id !== currentUser?.uid)
      );
    } catch (e) { notifyError('Failed to load admins', e); }
  }, [tenantId, currentUser, includeNullTenant]);

  // Load members list (role === 'user').
  const loadMembers = useCallback(async () => {
    if (!tenantId) return;
    try {
      console.log('[AdminCommunity] loadMembers currentTenantId:', tenantId, 'includeNull:', includeNullTenant);
      const docs = await loadScopedUserDocs(tenantId, includeNullTenant, 200);
      setMembers(docs
        .map(d => ({ id: d.id, ...d.data() }) as AdminUser)
        .filter(m => m.role === 'user')
      );
    } catch (e) { notifyError('Failed to load members', e); }
  }, [tenantId, includeNullTenant]);

  // Pool of tenant users for the create-channel member selector.
  const loadChannelPool = useCallback(async () => {
    if (!tenantId) return;
    try {
      console.log('[AdminCommunity] loadChannelPool currentTenantId:', tenantId, 'includeNull:', includeNullTenant);
      const snap = { docs: await loadScopedUserDocs(tenantId, includeNullTenant, 200) };
      setChannelPool(snap.docs.map(d => ({ id: d.id, ...d.data() }) as AdminUser));
    } catch (e) { notifyError('Failed to load users', e); }
  }, [tenantId, includeNullTenant]);

  // uid → channel names the user belongs to (for membership badges).
  const userChannels = useMemo(() => {
    const map = new Map<string, string[]>();
    channels.forEach(ch => (ch.members || []).forEach(uid => {
      const arr = map.get(uid) || [];
      arr.push(ch.name);
      map.set(uid, arr);
    }));
    return map;
  }, [channels]);

  const membershipBadge = (uid: string) => {
    const chans = userChannels.get(uid);
    if (chans && chans.length > 0) {
      return <p className="text-[10px] truncate" style={{ color: 'var(--brand-color, #B8962E)' }}>In: {chans.map(c => `#${c}`).join(', ')}</p>;
    }
    return <p className="text-[10px] text-[color:var(--text-faint)] italic">Not in any channel</p>;
  };

  const openNewChannel = () => {
    setSelectedMembers([]);
    setChannelMemberSearch('');
    setShowNewChannel(true);
    loadChannelPool();
  };

  const createChannel = async () => {
    if (!newChannelName.trim() || !tenantId || !currentUser) return;
    setSavingChannel(true);
    try {
      const members = Array.from(new Set([currentUser.uid, ...selectedMembers]));
      await addDoc(collection(db, 'tenants', tenantId, 'channels'), {
        name: newChannelName.trim(),
        description: newChannelDesc.trim(),
        members,
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid,
        type: 'announcement',
      });
      setShowNewChannel(false);
      setNewChannelName('');
      setNewChannelDesc('');
      setSelectedMembers([]);
      setChannelMemberSearch('');
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
      return <div className="text-center py-16 text-[color:var(--text-faint)]">Select a tenant to manage community chat.</div>;
    }
    return <div className="text-center py-16 text-[color:var(--text-faint)]">Community chat is only available for tenant admins.</div>;
  }

  // A channel or DM is open. On desktop this fills the right pane of the
  // two-pane layout below; on mobile it takes over full-width (the shared
  // AdminScreenHeader override supplies the back button + Members action).
  const anyThreadOpen = !!(openChannel || openAdminDm || openMemberDm);
  const openDm = openAdminDm || openMemberDm;

  const filteredMembers = members.filter(m =>
    !memberSearch ||
    m.displayName?.toLowerCase().includes(memberSearch.toLowerCase()) ||
    m.email?.toLowerCase().includes(memberSearch.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto lg:h-[calc(100dvh-140px)]">
      <div className="lg:flex lg:gap-5 lg:h-full">

      {/* ── Left rail: tabs + conversation list ── */}
      <div className={`${anyThreadOpen ? 'hidden lg:flex' : 'flex'} flex-col lg:w-[340px] lg:shrink-0 lg:min-h-0 lg:bg-white lg:rounded-brand-lg lg:border lg:border-stone-200 lg:shadow-[var(--ds-sh-sm)] lg:overflow-hidden`}>
      {/* Tabs */}
      <div className="flex gap-1 bg-stone-100 rounded-xl p-1 mb-5 lg:m-4 lg:mb-3">
        {([['channels', 'Channels'], ['admin-dms', 'Admin DMs'], ['member-dms', 'Member DMs']] as [MainTab, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors ${tab === id ? 'bg-white shadow-sm text-earth' : 'text-warm-brown'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:px-4 lg:pb-4">

      {/* ── CHANNELS TAB ── */}
      {tab === 'channels' && (
        <div>
          <div className="flex justify-between items-center mb-3">
            <p className="text-[11px] font-semibold text-gold uppercase tracking-[0.14em]">Announcement Channels</p>
            <button
              onClick={openNewChannel}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white"
              style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
            >
              <Plus size={13} /> New Channel
            </button>
          </div>
          {channels.length === 0 ? (
            <div className="text-center py-12 text-[color:var(--text-faint)]">
              <Hash size={32} className="mx-auto mb-2 opacity-30" />
              <p className="font-medium text-sm">No channels yet</p>
              <p className="text-xs mt-1">Create your first announcement channel</p>
            </div>
          ) : (
            <div className="space-y-2">
              {channels.map(ch => {
                const active = openChannel?.id === ch.id;
                return (
                <button
                  key={ch.id}
                  onClick={() => setOpenChannel(ch)}
                  className={`w-full rounded-2xl lg:rounded-brand px-4 py-3 border flex items-center gap-3 transition-all text-left ${active ? 'bg-[color-mix(in_srgb,var(--brand-color)_9%,white)] border-[color-mix(in_srgb,var(--brand-color)_45%,transparent)]' : 'bg-white border-[#E8E2D9] hover:border-[color-mix(in_srgb,var(--brand-color)_40%,transparent)] hover:shadow-sm'}`}
                >
                  <div className="relative flex-shrink-0">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--brand-color, #B8962E)1A' }}>
                      <Hash size={18} style={{ color: 'var(--brand-color, #B8962E)' }} />
                    </div>
                    {((ch as any).unreadCount || 0) > 0 && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-gold" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-bold truncate ${active ? 'text-gold' : 'text-earth'}`}>#{ch.name}</p>
                    {ch.description && <p className="text-xs text-[color:var(--text-faint)] truncate">{ch.description}</p>}
                    <p className="text-[10px] text-[color:var(--text-faint)] mt-0.5">
                      {(ch.members?.length || 0)} {(ch.members?.length || 0) === 1 ? 'member' : 'members'}{ch.lastMessageAt ? ` · ${fmtTime(ch.lastMessageAt)}` : ''}
                    </p>
                  </div>
                  <ChevronRight size={16} className={`flex-shrink-0 ${active ? 'text-gold' : 'text-stone-300'}`} />
                </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── ADMIN DMs TAB ── */}
      {tab === 'admin-dms' && (
        <div>
          <div className="flex justify-between items-center mb-3">
            <p className="text-[11px] font-semibold text-gold uppercase tracking-[0.14em]">Admin Conversations</p>
            <button
              onClick={() => { loadAdmins(); setShowAdminPicker(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white"
              style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
            >
              <Plus size={13} /> New DM
            </button>
          </div>
          {adminDms.length === 0 ? (
            <div className="text-center py-12 text-[color:var(--text-faint)]">
              <Users size={32} className="mx-auto mb-2 opacity-30" />
              <p className="font-medium text-sm">No admin conversations yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {adminDms.map(dm => (
                <button
                  key={dm.id}
                  onClick={() => setOpenAdminDm(dm)}
                  className="w-full bg-white rounded-2xl px-4 py-3.5 border border-[#E8E2D9] flex items-center gap-3 hover:border-[color-mix(in_srgb,var(--brand-color)_40%,transparent)] hover:shadow-sm transition-all text-left"
                >
                  <div className="w-11 h-11 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold text-white"
                    style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}>
                    {getOtherName(dm).charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-earth truncate">{getOtherName(dm)}</p>
                    {dm.lastMessage && <p className="text-xs text-[color:var(--text-faint)] truncate">{dm.lastMessage}</p>}
                  </div>
                  {dm.lastMessageAt && <span className="text-[10px] text-[color:var(--text-faint)] flex-shrink-0">{fmtTime(dm.lastMessageAt)}</span>}
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
            <p className="text-[11px] font-semibold text-gold uppercase tracking-[0.14em]">Member Conversations</p>
            <button
              onClick={() => { loadMembers(); setShowMemberPicker(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white"
              style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
            >
              <Plus size={13} /> New DM
            </button>
          </div>
          {memberDms.length === 0 ? (
            <div className="text-center py-12 text-[color:var(--text-faint)]">
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
                  className="w-full bg-white rounded-2xl px-4 py-3.5 border border-[#E8E2D9] flex items-center gap-3 hover:border-[color-mix(in_srgb,var(--brand-color)_40%,transparent)] hover:shadow-sm transition-all text-left"
                >
                  <div className="w-11 h-11 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold text-white bg-blue-500">
                    {getOtherName(dm).charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-earth truncate">{getOtherName(dm)}</p>
                    {dm.lastMessage && <p className="text-xs text-[color:var(--text-faint)] truncate">{dm.lastMessage}</p>}
                  </div>
                  {dm.lastMessageAt && <span className="text-[10px] text-[color:var(--text-faint)] flex-shrink-0">{fmtTime(dm.lastMessageAt)}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      </div>{/* /list scroll */}
      </div>{/* /left rail */}

      {/* ── Right pane: active channel / DM thread (persistent on desktop, full-width takeover on mobile) ── */}
      <div className={`${anyThreadOpen ? 'flex' : 'hidden lg:flex'} flex-1 min-w-0 flex-col min-h-[calc(100dvh-200px)] lg:min-h-0 lg:bg-white lg:rounded-brand-lg lg:border lg:border-stone-200 lg:shadow-[var(--ds-sh-sm)] lg:overflow-hidden`}>
        {openChannel && currentUser ? (
          <>
            {/* Channel header — desktop only; on mobile the shell header override supplies back + Members */}
            <div className="hidden lg:flex items-center justify-between px-5 py-4 border-b border-stone-200 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-8 h-8 rounded-brand bg-[color-mix(in_srgb,var(--brand-color)_12%,white)] flex items-center justify-center shrink-0"><Hash size={16} className="text-gold" /></span>
                <div className="min-w-0">
                  <p className="font-display text-base font-semibold text-earth truncate">{openChannel.name}</p>
                  <p className="text-xs text-[color:var(--text-faint)]">{(openChannel.members?.length || 0).toLocaleString()} {(openChannel.members?.length || 0) === 1 ? 'member' : 'members'}</p>
                </div>
              </div>
              <button onClick={() => setShowChannelMembers(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-brand border border-stone-200 text-xs font-semibold text-earth hover:bg-stone-100 transition-colors">
                <Users size={14} /> Members
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <ChannelThread channel={openChannel} tenantId={tenantId} includeNull={includeNullTenant} currentUser={currentUser} onOpenAttachment={onOpenAttachment} />
            </div>
            {showChannelMembers && (
              <ChannelMembersSheet tenantId={tenantId} includeNull={includeNullTenant} channelId={openChannel.id} onClose={() => setShowChannelMembers(false)} />
            )}
          </>
        ) : openDm && currentUser ? (
          <>
            <div className="hidden lg:flex items-center gap-2.5 px-5 py-4 border-b border-stone-200 shrink-0">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}>{getOtherName(openDm).charAt(0).toUpperCase()}</div>
              <p className="font-display text-base font-semibold text-earth truncate">{getOtherName(openDm)}</p>
            </div>
            <div className="flex-1 min-h-0">
              <DmThread dm={openDm} tenantId={tenantId} includeNull={includeNullTenant} currentUser={currentUser} otherName={getOtherName(openDm)} onOpenAttachment={onOpenAttachment} />
            </div>
          </>
        ) : (
          <div className="hidden lg:flex flex-1 flex-col items-center justify-center text-center px-6">
            <span className="w-14 h-14 rounded-brand-lg bg-[color-mix(in_srgb,var(--brand-color)_10%,white)] flex items-center justify-center mb-4"><MessageSquare size={26} className="text-gold" /></span>
            <p className="font-display text-lg text-earth">Select a conversation</p>
            <p className="text-sm text-warm-brown mt-1">Pick a channel or DM from the list to start messaging.</p>
          </div>
        )}
      </div>

      </div>{/* /two-pane */}

      {/* New Channel Modal */}
      {showNewChannel && (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-3xl w-full max-w-md">
            <div className="p-5 border-b border-[#E8E2D9] flex items-center justify-between">
              <h3 className="font-display font-bold text-earth">New Channel</h3>
              <button onClick={() => setShowNewChannel(false)}><X size={18} className="text-[color:var(--text-faint)]" /></button>
            </div>
            <div className="p-5 space-y-4 max-h-[55vh] overflow-y-auto">
              <div>
                <label className="text-xs font-semibold text-warm-brown mb-1 block">Channel Name *</label>
                <input
                  value={newChannelName}
                  onChange={e => setNewChannelName(e.target.value)}
                  className="w-full rounded-xl border border-[#E8E2D9] px-3 py-2.5 text-sm focus:border-gold focus:outline-none"
                  placeholder="e.g. announcements"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-warm-brown mb-1 block">Description</label>
                <input
                  value={newChannelDesc}
                  onChange={e => setNewChannelDesc(e.target.value)}
                  className="w-full rounded-xl border border-[#E8E2D9] px-3 py-2.5 text-sm focus:border-gold focus:outline-none"
                  placeholder="What is this channel about?"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-warm-brown mb-1 block">
                  Members {selectedMembers.length > 0 && <span className="text-[color:var(--text-faint)] font-normal">· {selectedMembers.length} selected</span>}
                </label>
                <p className="text-[11px] text-[color:var(--text-faint)] mb-2">You are added automatically as the channel creator.</p>
                <div className="relative mb-2">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-faint)]" />
                  <input
                    value={channelMemberSearch}
                    onChange={e => setChannelMemberSearch(e.target.value)}
                    placeholder="Search users by name or email..."
                    className="w-full pl-8 pr-3 py-2 text-sm rounded-xl border border-[#E8E2D9] focus:border-gold focus:outline-none"
                  />
                </div>
                <div className="max-h-44 overflow-y-auto border border-[#E8E2D9] rounded-xl divide-y divide-[#E8E2D9]">
                  {(() => {
                    const pool = channelPool
                      .filter(u => u.id !== currentUser?.uid)
                      .filter(u => !channelMemberSearch ||
                        u.displayName?.toLowerCase().includes(channelMemberSearch.toLowerCase()) ||
                        u.email?.toLowerCase().includes(channelMemberSearch.toLowerCase()));
                    if (pool.length === 0) {
                      return <p className="text-center py-6 text-xs text-[color:var(--text-faint)]">No users found in this tenant</p>;
                    }
                    return pool.map(u => {
                      const checked = selectedMembers.includes(u.id);
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => setSelectedMembers(prev => checked ? prev.filter(id => id !== u.id) : [...prev, u.id])}
                          className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-stone-100"
                        >
                          <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                            style={{ backgroundColor: checked ? 'var(--brand-color, #B8962E)' : '#A89A87' }}>
                            {u.displayName?.charAt(0)?.toUpperCase() || '?'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-earth truncate">{u.displayName || 'Unknown'}</p>
                            <p className="text-xs text-[color:var(--text-faint)] truncate">{u.email}</p>
                            {membershipBadge(u.id)}
                          </div>
                          <div className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 ${checked ? 'border-transparent' : 'border-[#E8E2D9]'}`}
                            style={checked ? { backgroundColor: 'var(--brand-color, #B8962E)' } : undefined}>
                            {checked && (
                              <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            )}
                          </div>
                        </button>
                      );
                    });
                  })()}
                </div>
              </div>
            </div>
            <div className="p-5 border-t border-[#E8E2D9] flex gap-3">
              <button onClick={() => setShowNewChannel(false)} className="flex-1 py-2.5 rounded-xl border border-[#E8E2D9] text-sm font-semibold text-warm-brown">Cancel</button>
              <button onClick={createChannel} disabled={savingChannel || !newChannelName.trim()}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}>
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
            <div className="p-5 border-b border-stone-200 flex items-center justify-between flex-shrink-0">
              <h3 className="font-display font-bold text-earth">Start Admin DM</h3>
              <button onClick={() => setShowAdminPicker(false)}><X size={18} className="text-[color:var(--text-faint)]" /></button>
            </div>
            <div className="overflow-y-auto flex-1">
              {admins.length === 0 ? (
                <div className="text-center py-8 text-[color:var(--text-faint)] text-sm">No users found in this tenant</div>
              ) : (
                admins.map(a => (
                  <button
                    key={a.id}
                    onClick={() => startAdminDm(a)}
                    className="w-full flex items-center gap-3 px-5 py-3 hover:bg-stone-100 text-left"
                  >
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                      style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>
                      {a.displayName?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-earth truncate">{a.displayName}</p>
                      <p className="text-xs text-[color:var(--text-faint)] truncate">{a.email}</p>
                      {membershipBadge(a.id)}
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
            <div className="p-5 border-b border-stone-200 flex-shrink-0">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display font-bold text-earth">Message a Member</h3>
                <button onClick={() => setShowMemberPicker(false)}><X size={18} className="text-[color:var(--text-faint)]" /></button>
              </div>
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-faint)]" />
                <input
                  value={memberSearch}
                  onChange={e => setMemberSearch(e.target.value)}
                  placeholder="Search by name or email..."
                  className="w-full pl-9 pr-3 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:border-gold"
                />
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              {filteredMembers.length === 0 ? (
                <div className="text-center py-8 text-[color:var(--text-faint)] text-sm">No users found in this tenant</div>
              ) : (
                filteredMembers.map(m => (
                  <button
                    key={m.id}
                    onClick={() => startMemberDm(m)}
                    className="w-full flex items-center gap-3 px-5 py-3 hover:bg-stone-100 text-left"
                  >
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0 bg-blue-500">
                      {m.displayName?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-earth truncate">{m.displayName}</p>
                      <p className="text-xs text-[color:var(--text-faint)] truncate">{m.email}</p>
                      {membershipBadge(m.id)}
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
