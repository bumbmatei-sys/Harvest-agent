"use client";
import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Send, MessageSquare, Hash, Megaphone, X, Search, PenSquare } from 'lucide-react';
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, doc,
  serverTimestamp, limit, orderBy, getDocs, Timestamp
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { getTenantScope, isPlatformContext, PLATFORM_TENANT_ID } from '../utils/tenant-scope';
import { isSuperAdminEmail } from '../utils/super-admins';
import { sortByTime } from '../utils/query-helpers';
import { getOrCreateDm } from '../lib/dm';
import { READING_MEASURE } from './layout/form-layout';
import { AttachMenu, AttachTypeIcon } from './attach/AttachMenu';
import type { AttachRecord } from '../lib/attach-records';

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

/**
 * THE-348 · The composer is PINNED TO THE VIEWPORT inside a conversation.
 *
 * The founder: *"in a chat I can scroll up and down and the input bar moved as
 * well. In a chat hide the bottom menu and put the input text field fixed at
 * the bottom."* — with three screenshots: the composer half-cut by the bottom
 * nav, then sitting above it after a scroll, moving as he scrolled.
 *
 * 🔴 THE FLEX COLUMN WAS ALREADY CORRECT AND WAS NOT ENOUGH. The thread is
 * `flex flex-col h-full` with a `flex-1 min-h-0 overflow-y-auto` list above a
 * `flex-shrink-0` composer, which pins the composer to the bottom of its own
 * box. The box is what moves: the member shell is `h-screen`, and on a phone
 * `100vh` is the LAYOUT viewport — it does not shrink for the browser's own
 * chrome — so the bottom of that column sits below the visible area and
 * scrolling the page walks it into and out of view. That is the founder's
 * three screenshots exactly, and no amount of flex inside the column reaches
 * it.
 *
 * `position: fixed` is measured against the viewport rather than against that
 * column, so the composer stops travelling.
 *
 * ⚠️ BELOW `lg` ONLY, and that is #475's lesson rather than caution. Above
 * `lg` the thread is the right-hand column beside a 360px conversation rail;
 * an `inset-x-0` composer there would slam across the whole screen — the exact
 * defect #475 fixed on this file's sheets. From `lg` up the composer stays in
 * flow, where the flex column already holds it.
 *
 * 🔴 `z-10`, AND THE NUMBER WAS MEASURED RATHER THAN CHOSEN. The first version
 * said `z-[101]`, reasoning that a fixed composer must clear the bottom nav's
 * `z-[100]`. It does not need to: inside a conversation the nav is HIDDEN, so
 * there is nothing at 100 left to clear — and 101 put the composer ABOVE THE
 * ATTACH MENU. `ui/dropdown-menu.tsx` hardcodes the menu's POSITIONER as
 * `isolate z-50`, and `isolation: isolate` opens a stacking context, so the
 * `z-[110]` on the popup inside it is painted at 50 (THE-337 recorded exactly
 * this and could not fix it — that file is byte-frozen by nine tickets'
 * digests). A hit test over the open menu's whole box found 22 of 121 sampled
 * pixels covered by the composer: the menu opens upward from the paperclip and
 * its bottom edge lands inside the composer's band. `z-10` is above the
 * message list, which is all this element actually has to out-stack, and below
 * the menu it must never cover.
 */
const FIXED_COMPOSER = 'max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-10';

/**
 * The band the fixed composer covers, reserved on the scroller above it.
 *
 * 🔴 A `fixed` element is out of flow, so the list no longer stops short of it
 * on its own — left alone, the newest message renders UNDER the composer.
 *
 * ⚠️ THE NUMBER IS MEASURED, NOT CHOSEN. `THE-348.member-composer.layout.
 * test.tsx` reads the composer's real height and the last bubble's real bottom
 * out of Chromium at all five widths and asserts they do not overlap, so this
 * constant is checked against the thing it is reserving for rather than being
 * a figure someone liked. A composer that grows — an attachment chip row
 * appears above the pill — is measured in that state too.
 *
 * ⚠️ IT CARRIES THE SAFE-AREA INSET. #437 put the home-indicator band on the
 * bottom nav; inside a conversation the nav is HIDDEN, so the composer is the
 * bottom-most chrome and nothing else is reserving it.
 */
const COMPOSER_BAND = 'max-lg:pb-[calc(72px+env(safe-area-inset-bottom))]';

/** The composer's own padding: #437's inset below `lg`, the flat 8px above. */
const COMPOSER_PAD = 'max-lg:pb-[calc(8px+env(safe-area-inset-bottom))] lg:pb-2';

/**
 * 🔴 44px BELOW `sm`, RELEASED ABOVE IT — the send button measured 36 × 36.
 *
 * `w-9 h-9` is 36px on both axes, which is under the 44px floor every tappable
 * target carries below `sm`. It was measured at 36 × 36 at 380px in Chromium,
 * beside an attach trigger that already clears 44 through `AttachMenu`'s own
 * `min-h-11 sm:min-h-0` — so the two controls in one pill disagreed.
 *
 * ⚠️ RELEASED FROM `sm` UP rather than flattened to 44 everywhere: Rule 4 fixes
 * desktop control density deliberately and a test asserts it is under 44, so an
 * unprefixed `min-h-11` would fight it at every desktop width. This is the same
 * pair `AttachMenu` uses, applied to the one control that was missing it.
 */
const SEND_TAP_TARGET = 'min-h-11 min-w-11 sm:min-h-0 sm:min-w-0';

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
      style={isAdmin ? { backgroundColor: 'color-mix(in srgb, var(--brand-color, #B8962E) 12%, transparent)', color: 'var(--brand-color, #B8962E)' } : { backgroundColor: 'var(--surface-sunken)', color: 'var(--text-muted)' }}
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
  const label = attachment.type === 'doc' ? 'Note / Doc' : attachment.type === 'contact' ? 'Contact' : attachment.type === 'form' ? 'Form' : 'Campaign';
  // Forms link to the public, no-auth form page on the tenant subdomain.
  const formUrl = attachment.type === 'form' && tenantId
    ? `https://${tenantId}.theharvest.app/form/${attachment.id}`
    : null;
  return (
    <div className="mt-1.5 bg-surface-raised border border-line rounded-xl overflow-hidden shadow-xs" style={{ maxWidth: 210 }}>
      <div className={`flex items-start gap-2 p-3 ${formUrl ? 'pb-2' : ''}`}>
        <span className="leading-none flex-shrink-0 text-faint">
          <AttachTypeIcon type={attachment.type} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-faint mb-0.5">{label}</p>
          <p className="text-xs font-semibold text-strong truncate leading-tight">{attachment.title}</p>
          <p className="text-[10px] text-faint truncate mt-0.5">{attachment.subtitle}</p>
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

/**
 * THE-348 · The forms-only "Attach a Form" sheet that stood here is GONE.
 *
 * The founder: *"as an admin if I press on paperclip it appears attach a form,
 * not all that is in community and the same style that we applied."*
 *
 * It was a hand-rolled bottom sheet — its own search input, its own spinner,
 * its own empty state, an emoji standing in for an icon — and it offered ONE
 * of the four record types. `attach/AttachMenu` is the surface AdminCommunity
 * already uses for exactly this: four category submenus, recents behind each,
 * then Browse… into a cascader that deep-searches all four at once. Importing
 * it is what stops the two composers drifting apart, which is the whole reason
 * THE-331 lifted the loaders into `lib/attach-records.ts`.
 *
 * ⚠️ The OTHER sheet of this shape in this file — the "New Message" admin
 * picker behind `PenSquare` — is NOT this and is untouched. It picks a PERSON
 * to open a thread with, not a record to attach, so it has no menu to become.
 * #475's `items-end sm:items-center` stays on it.
 */

const DmThread: React.FC<{
  dm: DirectMessage;
  tenantId: string;
  currentUser: { uid: string; name: string };
  otherName: string;
  onBack: () => void;
  /**
   * 🔴 THE CURRENT USER'S ROLE, HANDED DOWN — never re-derived here.
   *
   * The founder: *"The user, non admin should not have the paperclip."*
   *
   * ⚠️ THIS FILE ALREADY DERIVED `isAdmin` TWICE AND NEITHER ONE IS THIS
   * QUESTION. `RoleBadge` computes one from the role of the MESSAGE'S SENDER,
   * to colour a badge; the DM thread computes `isAdminSender` from
   * `dm.participantRoles[...]`, to colour an avatar. Both are about whoever
   * WROTE a message. Whether the person AT THE KEYBOARD may attach is a third
   * question, and it is answered once — in `UserMessages`, off the `users` doc
   * it already reads — and passed down. A third local derivation is exactly
   * how the first two came to disagree about what `isAdmin` means.
   */
  isAdmin: boolean;
  /** Whether attachable records include the legacy null-tenant set. */
  includeNull: boolean;
}> = ({ dm, tenantId, currentUser, otherName, onBack, isAdmin, includeNull }) => {
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 🔴 The WHOLE record, never a bare id: ids are not unique across the four
  // collections, so the category has to ride with the selection. This is the
  // shape `AttachMenu` hands its caller and the shape AdminCommunity stores.
  const toggleAttachment = (a: AttachRecord) => {
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
        // ⚠️ No emoji. The preview is read on the conversation list as plain
        // text, and a 📎 is a font-dependent colour glyph a screen reader
        // announces as "paperclip" before the title it decorates.
        lastMessage: content || (attachments.length > 0 ? attachments[0].title : ''),
        lastMessageAt: serverTimestamp(),
      });
      setText('');
      setAttachments([]);
    } catch (e) { console.error(e); }
    finally { setSending(false); }
  };

  return (
    <div className="flex flex-col h-full bg-surface-tint">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-line-hairline bg-surface-raised">
        <button onClick={onBack} className="p-1 -ml-1">
          <ArrowLeft size={22} style={{ color: 'var(--brand-color, #B8962E)' }} />
        </button>
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
          style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}>
          {otherName.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-strong text-sm">{otherName}</p>
          <p className="text-[10px] text-faint">Direct Message</p>
        </div>
      </div>

      {/* min-h-0 lets this flex child shrink below its content height so it
          scrolls internally; without it the list grows and pushes the composer
          down instead of the composer staying pinned above the bottom nav. */}
      {/* Rule 6 (form-layout.ts). This thread had NO desktop maximum: it filled
          whatever the conversation list left over, so a bubble ran 619.67px of
          prose at 1440px and 994.08px at 1920px, and the composer 732.88px and
          1212.88px. The reading measure caps it at 680px like the other three
          member reading surfaces. `lg:`-gated, so the mobile full-screen thread
          is untouched. */}
      <div data-thread-scroller className={`flex-1 min-h-0 overflow-y-auto p-4 space-y-3 lg:w-full ${COMPOSER_BAND} ${READING_MEASURE}`}>
        {messages.length === 0 && (
          <div className="text-center py-12 text-faint">
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
                      <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold ${isAdminSender ? 'text-white' : 'text-muted bg-surface-chip'}`}
                        style={isAdminSender ? { backgroundColor: 'var(--brand-color, #B8962E)' } : undefined}>
                        {(group.senderName || 'A').charAt(0).toUpperCase()}
                      </div>
                    ) : (
                      <div className="w-8 flex-shrink-0" />
                    )}
                    <div className="flex flex-col items-start max-w-[78%]">
                      {isFirst && <span className="text-[10px] font-semibold text-faint mb-0.5 ml-1">{group.senderName}</span>}
                      {m.content && (
                        <div className="bg-surface-sunken text-body rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-sm break-words">{m.content}</div>
                      )}
                      {m.attachments?.map((a, i) => <AttachmentCard key={i} attachment={a} tenantId={tenantId} />)}
                      <span className="text-[10px] text-faint mt-0.5">{fmtTime(m.createdAt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* THE-348 — pinned to the viewport below `lg`, in flow above it. The
          `embedded` distinction this bar used to make about the safe area is
          gone with the reason for it: it deferred the home-indicator inset to
          the bottom nav, and inside a conversation the nav is now HIDDEN, so
          the composer is the bottom-most chrome and reserves the inset itself.
          Above `lg` there is no bottom nav to defer to in the first place. */}
      <div data-composer className={`bg-surface-raised border-t border-line-hairline flex-shrink-0 px-4 pt-3 ${FIXED_COMPOSER} ${COMPOSER_PAD}`}>
        {attachments.length > 0 && (
          <div className={`flex flex-wrap gap-2 mb-2 lg:w-full ${READING_MEASURE}`}>
            {attachments.map((a, i) => (
              <div key={i} className="flex items-center gap-1.5 bg-[color-mix(in_srgb,var(--brand-color)_12%,transparent)] border border-[color-mix(in_srgb,var(--brand-color)_30%,transparent)] rounded-lg px-2.5 py-1 text-xs font-medium text-gold">
                <AttachTypeIcon type={a.type} />
                <span className="max-w-[90px] truncate">{a.title}</span>
                <button onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}>
                  <X size={11} className="text-[color-mix(in_srgb,var(--brand-color)_60%,transparent)]" />
                </button>
              </div>
            ))}
          </div>
        )}
        {/* Rule 6 — the composer tracks the thread. The measure goes on the
            pill and not on the bar around it, so the bar's top border and
            surface stay full-bleed exactly as they are today. */}
        <div className={`flex gap-2 items-center bg-surface-tint rounded-2xl px-3 py-2.5 border border-line-hairline focus-within:border-[color-mix(in_srgb,var(--brand-color)_40%,transparent)] transition-colors lg:w-full ${READING_MEASURE}`}>
          {/* 🔴 A MEMBER GETS NO PAPERCLIP AT ALL — not a disabled one. The
              founder asked for it to be absent, and a control that is present
              but refuses is the THE-193 dead end in miniature.

              ⚠️ THIS IS A CLIENT GATE AND IT IS NOT A PERMISSION. `firestore.
              rules` puts NO field allowlist on `dmMessages` create, so the
              rules permit a member to write an `attachments` array by any
              route that is not this button. That is reported in THE-348's
              suite as the fact it is, rather than papered over here — see
              `THE-348.member-composer.rules.test.ts`. */}
          {isAdmin && (
            <AttachMenu
              tenantId={tenantId}
              includeNull={includeNull}
              onAttach={toggleAttachment}
            />
          )}
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
            placeholder="Type a message..."
            className="flex-1 bg-transparent outline-hidden text-sm text-strong placeholder-[color:var(--text-faint)]"
          />
          <button
            onClick={send}
            disabled={(!text.trim() && attachments.length === 0) || sending}
            className={`w-9 h-9 rounded-xl flex items-center justify-center disabled:opacity-30 transition-opacity ${SEND_TAP_TARGET}`}
            style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}
            aria-label="Send message"
          >
            <Send size={15} className="text-white" />
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Read-only Channel View (members can read, not post) ──────────────────────

const ChannelView: React.FC<{
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
    <div className="flex flex-col h-full bg-surface-tint">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-line-hairline bg-surface-raised flex-shrink-0">
        <button onClick={onBack} className="p-1 -ml-1 flex-shrink-0" aria-label="Back">
          <ArrowLeft size={22} style={{ color: 'var(--brand-color, #B8962E)' }} />
        </button>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: 'color-mix(in srgb, var(--brand-color, #B8962E) 12%, transparent)' }}>
          <Hash size={16} style={{ color: 'var(--brand-color, #B8962E)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-strong text-sm truncate">#{channel.name}</p>
          {channel.description && <p className="text-xs text-faint truncate">{channel.description}</p>}
        </div>
      </div>

      {/* Rule 6 — a channel is the same reading surface as a DM, so it takes
          the same measure. Was unbounded here too. */}
      <div data-thread-scroller className={`flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-4 space-y-3 lg:w-full ${COMPOSER_BAND} ${READING_MEASURE}`}>
        {messages.length === 0 && (
          <div className="text-center py-12 text-faint">
            <Megaphone size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No messages yet</p>
          </div>
        )}
        {groupMessages(messages).map(group => {
          const isAdmin = group.senderRole === 'admin' || group.senderRole === 'church_admin' || group.senderRole === 'super_admin';
          return (
            <div key={group.messages[0].id} className="flex gap-3">
              <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold ${isAdmin ? 'text-white' : 'text-muted bg-surface-chip'}`}
                style={isAdmin ? { backgroundColor: 'var(--brand-color, #B8962E)' } : undefined}>
                {(group.senderName || 'A').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-sm font-semibold text-strong">{group.senderName || 'Member'}</span>
                  <RoleBadge role={group.senderRole} />
                  <span className="text-[10px] text-faint">{fmtTime(group.messages[0].createdAt)}</span>
                </div>
                <div className="space-y-1">
                  {group.messages.map(m => (
                    <div key={m.id} className="group flex items-end gap-2">
                      <div className="max-w-[78%]">
                        {m.content && (
                          <p className="bg-surface-raised border border-line-hairline rounded-2xl rounded-tl-sm px-3 py-2 text-sm text-body shadow-xs break-words">
                            {m.content}
                          </p>
                        )}
                        {m.attachments?.map((a, i) => <AttachmentCard key={i} attachment={a} tenantId={tenantId} />)}
                      </div>
                      <span className="text-[10px] text-faint opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mb-1">{fmtTime(m.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* THE-348 — a channel is the same conversation as a DM, so its composer
          is pinned the same way and by the same two constants. See DmThread. */}
      <div data-composer className={`bg-surface-raised border-t border-line-hairline flex-shrink-0 px-4 pt-3 ${FIXED_COMPOSER} ${COMPOSER_PAD}`}>
        {/* Rule 6 — same as the DM composer: the pill, not the bar. */}
        <div className={`flex gap-2 items-center bg-surface-tint rounded-2xl px-3 py-2.5 border border-line-hairline focus-within:border-[color-mix(in_srgb,var(--brand-color)_40%,transparent)] transition-colors lg:w-full ${READING_MEASURE}`}>
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
            placeholder={`Message #${channel.name}`}
            className="flex-1 bg-transparent outline-hidden text-sm text-strong placeholder-[color:var(--text-faint)]"
          />
          <button
            onClick={send}
            disabled={!text.trim() || sending}
            className={`w-9 h-9 rounded-xl flex items-center justify-center disabled:opacity-30 transition-opacity ${SEND_TAP_TARGET}`}
            style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}
            aria-label="Send message"
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
  /**
   * THE-348 · Raised whenever a conversation opens, lowered on EVERY exit.
   *
   * The founder: *"In a chat hide the bottom menu."* The bottom nav is the
   * SHELL's, not this screen's, so this screen cannot hide it — it can only
   * say whether it is inside a conversation, and let the shell decide.
   *
   * 🔴 THE LOWERING IS THE DANGEROUS HALF, and it is why this is an effect
   * with a cleanup rather than a call at each exit site. #490's lesson,
   * written on `AdminDashboard`'s nav wrapper: *"A nav that stays hidden after
   * you leave the note is a trap with no way out."* There are four ways out of
   * a thread here — the back arrow, picking another conversation, the plan
   * gate swapping this screen out, and the member leaving the tab entirely —
   * and only the first two are events this file could hook. The effect's
   * cleanup covers all four, including unmount, because React runs it whether
   * the exit was a click or a route change.
   */
  onConversationOpenChange?: (open: boolean) => void;
}

const UserMessages: React.FC<UserMessagesProps> = ({ onBack, embedded = false, onConversationOpenChange }) => {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<{ uid: string; name: string } | null>(null);
  const [dms, setDms] = useState<DirectMessage[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDm, setOpenDm] = useState<DirectMessage | null>(null);
  const [openChannel, setOpenChannel] = useState<Channel | null>(null);
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [listCollapsed, setListCollapsed] = useState(false); // desktop conversation-list collapse
  const [admins, setAdmins] = useState<AdminContact[]>([]);
  const [adminsLoading, setAdminsLoading] = useState(false);
  const [adminSearch, setAdminSearch] = useState('');
  const [creating, setCreating] = useState<string | null>(null);
  // Only admins / super admins can list the tenant's users (Firestore rules), so the
  // "New Message" admin picker is only shown to them — a regular member would just
  // hit a permission-denied list query and an empty picker.
  const [canStartDm, setCanStartDm] = useState(false);
  /**
   * 🔴 THE ONE ANSWER TO "MAY THE PERSON AT THE KEYBOARD ATTACH", derived here
   * because this is the only place in the file that reads the CURRENT user's
   * `users` doc. `RoleBadge` and the DM thread's `isAdminSender` both compute
   * something called `isAdmin`/`isAdmin…` from a MESSAGE SENDER's role; neither
   * is this question and neither is in scope at the composer. It is passed
   * down rather than re-derived a third time.
   *
   * ⚠️ `ADMIN_ROLES` IS THE SINGLE SOURCE, not a re-spelled disjunction. The
   * constant already existed and was already read at both the admin-picker
   * filter and the DM avatar; `canStartDm` below reads it too. Writing
   * `role === 'admin' || role === 'church_admin' || role === 'super_admin'` a
   * fourth time is how the two existing copies came to be two copies.
   */
  const [isAdmin, setIsAdmin] = useState(false);

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
      const admin = isSuperAdminEmail(auth.currentUser.email) || ADMIN_ROLES.includes(role);
      setCanStartDm(admin);
      setIsAdmin(admin);
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

  /**
   * 🔴 THE CLEANUP IS THE POINT — see `onConversationOpenChange`'s doc comment.
   * It runs on every dependency change AND on unmount, so the nav comes back on
   * the back arrow, on switching conversations, on the tab changing under this
   * screen and on the screen being replaced entirely. A `false` sent at each
   * exit SITE would have covered the first two and missed the last two.
   */
  useEffect(() => {
    onConversationOpenChange?.(!!(openDm || openChannel));
    return () => onConversationOpenChange?.(false);
  }, [openDm, openChannel, onConversationOpenChange]);

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
  // Only applies in platform context: a subdomain's tenantId is never
  // PLATFORM_TENANT_ID. Lifted out of `loadAdmins` because the composer's
  // attach menu asks the same question, and two copies would be two answers.
  const includeNullTenant = isSuperAdminEmail(auth.currentUser?.email) && tenantId === PLATFORM_TENANT_ID;

  const loadAdmins = async () => {
    if (!tenantId || !currentUser) return;
    setAdminsLoading(true);
    try {
      // Only applies in platform context: a subdomain's tenantId is never
      // PLATFORM_TENANT_ID, so legacy null-tenant users are merged in for the
      // platform tenant only — never into a tenant subdomain's user list.
      const snaps = await Promise.all([
        getDocs(query(collection(db, 'users'), where('tenantId', '==', tenantId), limit(200))),
        ...(includeNullTenant ? [getDocs(query(collection(db, 'users'), where('tenantId', '==', null), limit(200)))] : []),
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
  // The already-loaded `dms` list is checked first (fast path, no round trip);
  // getOrCreateDm does the same existence check server-side for the create case.
  const startDm = async (admin: AdminContact) => {
    if (!tenantId || !currentUser || creating) return;
    const existing = dms.find(dm => dm.participants.includes(admin.id) && dm.participants.includes(currentUser.uid));
    if (existing) { setOpenDm(existing); setShowNewMessage(false); return; }
    setCreating(admin.id);
    try {
      const participantNames = { [currentUser.uid]: currentUser.name, [admin.id]: admin.displayName };
      const participantRoles = { [currentUser.uid]: 'user', [admin.id]: 'admin' };
      const dmId = await getOrCreateDm(
        tenantId,
        { uid: currentUser.uid, name: currentUser.name, role: 'user' },
        { uid: admin.id, name: admin.displayName, role: 'admin' }
      );
      setShowNewMessage(false);
      setOpenDm({
        id: dmId,
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
      <div className="flex flex-col min-h-full bg-surface-tint">
        <div className="flex items-center gap-3 px-4 py-4 bg-surface-raised border-b border-line-hairline">
          {!embedded && (
            <button onClick={onBack} className="p-1 -ml-1" aria-label="Back">
              <ArrowLeft size={22} style={{ color: 'var(--brand-color, #B8962E)' }} />
            </button>
          )}
          <h2 className="text-lg font-black text-strong font-display">Messages</h2>
        </div>
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: 'var(--brand-color, #B8962E)', borderTopColor: 'transparent' }} />
        </div>
      </div>
    );
  }

  // The open channel/DM thread (or null). On mobile this replaces the list
  // full-screen; on desktop it sits in the right column beside the list.
  const selectedThread = openChannel && tenantId && currentUser ? (
    <ChannelView channel={openChannel} tenantId={tenantId} currentUser={currentUser} onBack={() => setOpenChannel(null)} />
  ) : openDm && tenantId && currentUser ? (
    <DmThread dm={openDm} tenantId={tenantId} currentUser={currentUser} otherName={getOtherName(openDm)} onBack={() => setOpenDm(null)} isAdmin={isAdmin} includeNull={includeNullTenant} />
  ) : null;
  const hasOpen = !!selectedThread;

  return (
    <div className="flex flex-col lg:flex-row h-full bg-surface-tint">
      {/* LEFT: conversation list — the whole view on mobile (hidden while a thread
          is open); a 360px rail on desktop that can be collapsed (like the Bible
          book nav and Ask Harvest history rail). */}
      <div className={`${hasOpen ? 'hidden lg:flex' : 'flex'} ${listCollapsed ? 'lg:hidden' : ''} flex-col min-h-full lg:min-h-0 lg:h-full lg:w-[360px] lg:flex-shrink-0 lg:border-r lg:border-line-hairline`}>
      {/* Desktop-only list header + collapse toggle (always shown on lg, even when
          the member can't start DMs). */}
      <div className="hidden lg:flex items-center justify-between px-4 pt-3.5 pb-1 lg:flex-shrink-0">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-faint">Conversations</span>
        <button onClick={() => setListCollapsed(true)} title="Collapse" className="w-8 h-8 rounded-lg flex items-center justify-center text-faint hover:bg-surface-sunken">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        </button>
      </div>
      <div className="flex items-center gap-3 px-4 py-4 bg-surface-raised border-b border-line-hairline lg:hidden">
        {!embedded && (
          <button onClick={onBack} className="p-1 -ml-1" aria-label="Back">
            <ArrowLeft size={22} style={{ color: 'var(--brand-color, #B8962E)' }} />
          </button>
        )}
        <h2 className="text-lg font-black text-strong font-display">Messages</h2>
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

      {/* Desktop-only New Message (the mobile header above is hidden on lg). */}
      {canStartDm && (
        <div className="hidden lg:flex px-3 pt-3 pb-1 lg:flex-shrink-0">
          <button onClick={openNewMessage} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-white" style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}>
            <PenSquare size={15} /> New Message
          </button>
        </div>
      )}

      <div className="flex-1 p-4 lg:overflow-y-auto lg:min-h-0">
        {dms.length === 0 && channels.length === 0 ? (
          <div className="text-center py-16 text-faint">
            <MessageSquare size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">No messages yet</p>
            <p className="text-sm mt-1">
              {canStartDm
                ? <>Tap <span className="font-semibold text-muted">New Message</span> to start a conversation.</>
                : 'Your admin will reach out here.'}
            </p>
          </div>
        ) : (
          <>
            {channels.length > 0 && (
              <div className="mb-5">
                <p className="text-xs font-bold text-faint uppercase tracking-wider mb-2">Channels</p>
                <div className="space-y-2">
                  {channels.map(ch => (
                    <button
                      key={ch.id}
                      onClick={() => setOpenChannel(ch)}
                      className="w-full bg-surface-raised rounded-2xl border border-line-hairline px-4 py-3.5 flex items-center gap-3 hover:border-[color-mix(in_srgb,var(--brand-color)_40%,transparent)] hover:shadow-xs transition-all text-left"
                    >
                      <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center lg:bg-[color-mix(in_srgb,var(--brand-color)_12%,transparent)]">
                        <Hash size={18} style={{ color: 'var(--brand-color, #B8962E)' }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-strong truncate">#{ch.name}</p>
                        <p className="text-xs text-faint truncate">{ch.lastMessage || ch.description || 'No messages yet'}</p>
                      </div>
                      {ch.lastMessageAt && <span className="text-[10px] text-faint flex-shrink-0">{fmtTime(ch.lastMessageAt)}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {dms.length > 0 && (
              <p className="text-xs font-bold text-faint uppercase tracking-wider mb-2">Direct Messages</p>
            )}
            <div className="space-y-2">
            {dms.map(dm => (
              <button
                key={dm.id}
                onClick={() => setOpenDm(dm)}
                className="w-full bg-surface-raised rounded-2xl border border-line-hairline px-4 py-3.5 flex items-center gap-3 hover:border-[color-mix(in_srgb,var(--brand-color)_40%,transparent)] hover:shadow-xs transition-all text-left"
              >
                <div className="w-11 h-11 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold text-white"
                  style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}>
                  {getOtherName(dm).charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-strong truncate">{getOtherName(dm)}</p>
                  {dm.lastMessage && <p className="text-xs text-faint truncate">{dm.lastMessage}</p>}
                </div>
                {dm.lastMessageAt && <span className="text-[10px] text-faint flex-shrink-0">{fmtTime(dm.lastMessageAt)}</span>}
              </button>
            ))}
            </div>
          </>
        )}
      </div>
      </div>{/* /left rail */}

      {/* RIGHT: the open thread, or a desktop-only "select a conversation" state. */}
      <div className={`${hasOpen ? 'flex' : 'hidden lg:flex'} relative flex-col h-full lg:flex-1 min-w-0`}>
        {/* Desktop-only handle to re-open the collapsed conversation list. */}
        {listCollapsed && (
          <button onClick={() => setListCollapsed(false)} title="Show conversations" className="hidden lg:flex absolute left-0 top-1/2 -translate-y-1/2 z-20 w-6 h-16 items-center justify-center rounded-r-lg bg-surface-raised border border-l-0 border-line-hairline text-muted hover:bg-surface-sunken">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        )}
        {selectedThread || (
          <div className="hidden lg:flex flex-1 items-center justify-center text-faint">
            <div className="text-center px-6">
              <MessageSquare size={40} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium">Select a conversation</p>
              <p className="text-sm mt-1">Choose a channel or message from the list.</p>
            </div>
          </div>
        )}
      </div>

      {showNewMessage && (
        <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center sm:p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowNewMessage(false)} />
          <div className="relative w-full sm:max-w-lg bg-surface-raised rounded-t-2xl sm:rounded-2xl max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-line flex-shrink-0">
              <h3 className="font-bold text-strong text-sm font-display">New Message</h3>
              <button onClick={() => setShowNewMessage(false)}><X size={18} className="text-faint" /></button>
            </div>
            <div className="relative mx-4 mt-3 mb-2 flex-shrink-0">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input
                value={adminSearch}
                onChange={e => setAdminSearch(e.target.value)}
                placeholder="Search admins..."
                className="w-full pl-8 pr-3 py-2 text-sm border border-line rounded-xl focus:outline-hidden focus:border-gold"
              />
            </div>
            <div className="overflow-y-auto flex-1">
              {adminsLoading ? (
                <div className="flex items-center justify-center py-10">
                  <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #B8962E)', borderTopColor: 'transparent' }} />
                </div>
              ) : filteredAdmins.length === 0 ? (
                <p className="text-center py-10 text-sm text-faint px-6">{adminSearch ? 'Nothing found' : 'No admins available to message yet.'}</p>
              ) : filteredAdmins.map(a => (
                <button
                  key={a.id}
                  onClick={() => startDm(a)}
                  disabled={!!creating}
                  className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-surface-sunken disabled:opacity-50 transition-colors"
                >
                  {a.photoURL ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.photoURL} alt={a.displayName} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}>
                      {a.displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-strong truncate">{a.displayName}</p>
                    <p className="text-xs text-faint truncate">{a.role === 'super_admin' ? 'Super Admin' : a.role === 'church_admin' ? 'Church Admin' : 'Admin'}</p>
                  </div>
                  {creating === a.id && (
                    <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin flex-shrink-0" style={{ borderColor: 'var(--brand-color, #B8962E)', borderTopColor: 'transparent' }} />
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
