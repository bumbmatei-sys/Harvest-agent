"use client";
import React, { useState, useEffect } from 'react';
import {
  Plus, Edit2, Trash2, CalendarCheck, Users, MapPin, Clock, DollarSign,
  Check, Download, Search, ChevronRight, Globe, X, Pin, QrCode, Copy,
  Ticket, Tag, ArrowUp, ArrowDown, Link2,
} from 'lucide-react';
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, limit, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import QRCode from 'qrcode';
import { db, auth } from '../firebase';
import { ImageUpload } from './ImageUpload';
import { sortByTime } from '../utils/query-helpers';
import { notifyError } from '../utils/notify';
import { useAdminHeader } from './AdminScreenHeader';
import { AdminPageHeader, AdminPrimaryButton, AdminBadge, statusTone } from './admin/AdminUI';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../store/useAppStore';
import { PLATFORM_TENANT_ID } from '../utils/tenant-scope';
import { useEvents } from '../hooks/queries/useEventQueries';
import { HeroBand } from './member/desktopKit';
import { FORM_CONTAINER, FORM_MEASURE, FIELD_WIDTH, ACTION_BUTTON, CONTROL_DENSITY } from './layout/form-layout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  PAID_EVENTS_ENABLED, PAID_EVENTS_HIDDEN_TITLE, PAID_EVENTS_HIDDEN_MESSAGE,
  eventPriceLabel, csvAmountCell, ticketPricingAvailable, manualConfirmationMode,
} from '../lib/paid-events-feature';
import { useTenantOptional } from '../contexts/TenantContext';
import { readGivingLinks } from './donations/giving-providers';
import { Checkbox } from '@/components/ui/checkbox';
import {
  CREATION_DISCLAIMER_BODY, CREATION_DISCLAIMER_TITLE,
  DOOR_CONFIRMED_BADGE, DOOR_UNCONFIRMED_BADGE, DOOR_UNCONFIRMED_HELP,
  NO_LINKS_BODY, NO_LINKS_TITLE,
  PROVIDER_PICKER_HELP, PROVIDER_PICKER_TITLE,
  CONFIRM_ALREADY, CONFIRM_BUTTON, CONFIRM_BUTTON_HELP, CONFIRM_FAILED, CONFIRM_SUCCESS,
  paymentStateOf, readEventProviderIds, registrationStatusLabel, REGISTERED_STAT_LABEL,
} from '../lib/event-payment-claims';
import { confirmPaymentClaim } from './inbox/payment-claims-client';
/**
 * THE-308 — the month grid is LAZY, and that is not an optimisation detail.
 *
 * `EventMonthView` imports `calendar`, which IS react-day-picker. A static
 * import would pull that package into the chunk this screen loads for its LIST
 * — the default tab, and the one a church opens every time — to render a grid
 * behind a tab it has not clicked. THE-274 installed react-day-picker with the
 * explicit note that "a file no route reaches is in no chunk", and a static
 * import here is what would end that.
 *
 * ⚠️ It is also measurable in the suite: mounting this screen with the calendar
 * in its module graph made `AdminMinistry.desktop-layout` fail on screens this
 * ticket does not touch, under full-suite load and not in isolation.
 */
const EventMonthView = React.lazy(() => import('./events/EventMonthView'));
import { useMonthEvents } from '../hooks/queries/useMonthEvents';

import type { Event, Registration, TicketType, DiscountCode } from '../hooks/queries/useEventQueries';

/**
 * 🔴 THE-326 — NO `'rota'`. Service planning is its own section now
 * (`AdminServices`), and this union is what the ticket's second test reads: a
 * `'rota'` back in here is a service-planning screen back inside Events.
 * Events is the list, the month view, create/edit/detail and registrations —
 * the public-facing event product, and nothing else.
 */
type ViewMode = 'list' | 'create' | 'edit' | 'detail';

/** Client-side id generator (uuid is not a dependency). */
const genId = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

/** Format a cents price for display ("Free" / "$12.00"). */
const fmtCents = (cents: number) => (cents > 0 ? `$${(cents / 100).toFixed(2)}` : 'Free');

/** Small pill toggle matching the existing online-event toggle style. */
const Toggle: React.FC<{ on: boolean; onClick: () => void }> = ({ on, onClick }) => (
  <button onClick={onClick} className="transition-colors shrink-0" aria-pressed={on}>
    <div className={`w-10 h-5 rounded-full transition-colors flex items-center px-0.5 ${on ? 'bg-gold' : 'bg-surface-chip'}`}>
      <div className={`w-4 h-4 rounded-full bg-surface-raised shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
    </div>
  </button>
);

/** Format a discount code's value for display. */
const fmtDiscount = (d: DiscountCode) => (d.type === 'percent' ? `${d.value}% off` : `${fmtCents(d.value)} off`);

const STATUS_COLORS: Record<Event['status'], string> = {
  draft: 'bg-surface-sunken text-muted',
  published: 'bg-field-100 text-field-700',
  // THE-136 — red-600 on red-100 is 3.95:1, below AA. red-700 is what every
  // other red badge in the app already uses on this fill.
  cancelled: 'bg-red-100 text-red-700',
  completed: 'bg-sky-100 text-sky-700',
};

const fmtDate = (ts: Timestamp | null) => {
  if (!ts) return '—';
  return ts.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const fmtDateInput = (ts: Timestamp | null) => {
  if (!ts) return '';
  const d = ts.toDate();
  return d.toISOString().slice(0, 16);
};

const toTimestamp = (v: string): Timestamp | null => {
  if (!v) return null;
  return Timestamp.fromDate(new Date(v));
};

const emptyForm = {
  title: '',
  description: '',
  coverImage: '',
  location: '',
  isOnline: false,
  onlineLink: '',
  startDate: '',
  endDate: '',
  capacity: '',
  registrationDeadline: '',
  price: '0',
  currency: 'usd',
  status: 'draft' as Event['status'],
  // Registration engine
  registrationEnabled: false,
  ticketTypes: [] as TicketType[],
  waitlistEnabled: false,
  discountCodes: [] as DiscountCode[],
  showOnPublicCalendar: true,
  /**
   * THE-351 — WHICH of the church's own links accept payment for THIS event.
   *
   * THE FOUNDER: "maybe just PayPal or just revolut or just whatever or all of
   * them." Empty means every link the church publishes; see
   * `resolveEventPaymentLinks`, which intersects this against what the church
   * currently publishes on every read so a deleted link cannot leave a member
   * staring at a dead tile.
   */
  paymentProviders: [] as string[],
};

const AdminEvents: React.FC = () => {
  const { setHeaderOverride } = useAdminHeader();
  const queryClient = useQueryClient();
  // Resolve the tenant from the store, falling back to the platform tenant for a
  // super admin if the store value is briefly null (e.g. on a refresh before the
  // App store effect has resolved). This keeps every create/write below from
  // dying on a transient null. On a tenant subdomain currentTenantId is set and
  // takes precedence.
  const { currentTenantId, isAuthReady, isSuperAdmin } = useAppStore();
  const tenantId = currentTenantId || (isSuperAdmin ? PLATFORM_TENANT_ID : null);

  const { data: events = [], isLoading: loading } = useEvents(tenantId, isAuthReady);

  /**
   * 🔴 THE-351 — the church's OWN payment links, off the tenant document
   * `TenantContext` has already loaded. NO NEW QUERY and no new failure mode:
   * `readGivingLinks` is the same validator the member Give page reads through,
   * so a link that stops passing the phishing allow-list stops being offered
   * here at exactly the moment it stops rendering there. AdminCRM reads it the
   * same way for the same reason (THE-249).
   */
  // ⚠️ THE *OPTIONAL* HOOK, AND THAT IS NOT DEFENSIVENESS. `useTenant` THROWS
  // outside a `<TenantProvider>`, and this screen is mounted bare by a dozen
  // existing suites (THE-308, THE-345, THE-346, the tier/tab matrices) that
  // have no reason to know about a tenant document. A screen that cannot be
  // rendered without a provider is a screen every one of those suites has to
  // be rewritten for — and a `useTenant` here would have turned this ticket's
  // no-regression half red for a reason that has nothing to do with money.
  // Outside a provider there is no church, so there are no links, so pricing is
  // simply unavailable — which is the correct answer, not a fallback.
  const tenantCtx = useTenantOptional();
  const branding = tenantCtx?.branding;
  const churchLinks = React.useMemo(() => readGivingLinks(branding), [branding]);
  const canPriceTickets = ticketPricingAvailable() && (PAID_EVENTS_ENABLED || churchLinks.length > 0);

  const [view, setView] = useState<ViewMode>('list');
  // THE-308 — which tab the list screen is showing. `list` is the default.
  const [listTab, setListTab] = useState<'list' | 'month'>('list');
  const { data: monthRead, isLoading: monthLoading } = useMonthEvents(tenantId, isAuthReady);
  const [selected, setSelected] = useState<Event | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Detail view state
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [regSearch, setRegSearch] = useState('');
  const [checkingIn, setCheckingIn] = useState<string | null>(null);
  /**
   * 🔴 THE-351 — confirming from the ATTENDEE LIST, and why this surface exists
   * as well as the inbox.
   *
   * ⚠️ A MEMBER WHO REGISTERED LOGGED-OUT CAN NEVER PRESS "I'VE PAID". That
   * route requires a verified identity, because a button anyone could press for
   * anyone else's ticket is a button that fills a church's inbox with
   * strangers. So a logged-out registrant never raises an inbox row, and
   * without this control their payment could never be confirmed at all — a hole
   * the inbox alone cannot close.
   *
   * 🔴 IT IS THE SAME BUTTON, NOT A SECOND ONE. `confirmPaymentClaim` is the one
   * client call, reaching the one idempotent route, which calls THE-350's one
   * writer. The inbox is where an admin is PROMPTED; this is where they are
   * already standing. Two doors, one act.
   *
   * THE-321's `saveState` shape: a failure is a STATE beside the row, not a
   * toast that scrolls away, and the row does not move.
   */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [confirmNote, setConfirmNote] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);

  // Registration-engine sub-forms (inside the create/edit form)
  const emptyTicket = { name: '', description: '', price: '0', capacity: '' };
  const [ticketDraft, setTicketDraft] = useState(emptyTicket);
  const [showTicketForm, setShowTicketForm] = useState(false);
  const emptyDiscount = { code: '', type: 'percent' as DiscountCode['type'], value: '', maxUses: '' };
  const [discountDraft, setDiscountDraft] = useState(emptyDiscount);
  const [showDiscountForm, setShowDiscountForm] = useState(false);

  const registrationUrl = (eventId: string) => `https://${tenantId}.theharvest.app/event/${eventId}`;

  // Drive the shared header. In a sub-view (create/edit/detail) the back chevron
  // returns to the event list; on the list it shows the "Create Event" action.
  useEffect(() => {
    if (view === 'create' || view === 'edit') {
      setHeaderOverride({
        title: view === 'edit' ? 'Edit Event' : 'Create Event',
        onBack: () => { setView('list'); setSelected(null); },
      });
    } else if (view === 'detail' && selected) {
      setHeaderOverride({
        title: selected.title || 'Event',
        onBack: () => { setView('list'); setSelected(null); },
      });
    } else {
      setHeaderOverride(null);
    }
    return () => setHeaderOverride(null);
  }, [view, selected, setHeaderOverride]);

  // "Create event" renders in the in-content page header (per the mockup).

  // Load registrations when viewing event detail
  useEffect(() => {
    if (view !== 'detail' || !selected || !tenantId) return;
    // Single-field filter only (eventId); sort client-side to avoid a composite index.
    const q = query(
      collection(db, 'tenants', tenantId, 'registrations'),
      where('eventId', '==', selected.id),
      limit(500)
    );
    const unsub = onSnapshot(q, snap => {
      setRegistrations(sortByTime(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Registration), 'registeredAt', 'desc'));
    });
    return unsub;
  }, [view, selected, tenantId]);

  // Generate the registration QR code when viewing a registration-enabled event.
  useEffect(() => {
    if (view === 'detail' && selected && selected.registrationEnabled && tenantId) {
      QRCode.toDataURL(registrationUrl(selected.id), { width: 320, margin: 1 })
        .then(setQrDataUrl).catch(() => setQrDataUrl(''));
    } else {
      setQrDataUrl('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selected, tenantId]);

  const openCreate = () => {
    setForm(emptyForm);
    setSelected(null);
    setView('create');
  };

  const openEdit = (ev: Event) => {
    setForm({
      title: ev.title,
      description: ev.description,
      coverImage: ev.coverImage || '',
      location: ev.location,
      isOnline: ev.isOnline,
      onlineLink: ev.onlineLink || '',
      startDate: fmtDateInput(ev.startDate),
      endDate: fmtDateInput(ev.endDate),
      capacity: ev.capacity?.toString() || '',
      registrationDeadline: fmtDateInput(ev.registrationDeadline),
      price: ev.price.toString(),
      currency: ev.currency,
      status: ev.status,
      registrationEnabled: ev.registrationEnabled ?? false,
      ticketTypes: Array.isArray(ev.ticketTypes) ? ev.ticketTypes : [],
      waitlistEnabled: ev.waitlistEnabled ?? false,
      discountCodes: Array.isArray(ev.discountCodes) ? ev.discountCodes : [],
      showOnPublicCalendar: ev.showOnPublicCalendar ?? true,
      // THE-351 — cleaned through the provider table, so a stored id this build
      // no longer defines simply drops rather than rendering an empty tile.
      paymentProviders: readEventProviderIds((ev as { paymentProviders?: unknown }).paymentProviders),
    });
    setShowTicketForm(false);
    setShowDiscountForm(false);
    setSelected(ev);
    setView('edit');
  };

  const openDetail = (ev: Event) => {
    setSelected(ev);
    setRegSearch('');
    setView('detail');
  };

  const handleSave = async () => {
    if (!form.title.trim()) { notifyError('Event title is required', null); return; }
    if (!tenantId) { notifyError('Unable to determine your tenant. Please refresh.', null); return; }
    setSaving(true);
    try {
      const data: Partial<Omit<Event, 'id'>> = {
        title: form.title.trim(),
        description: form.description.trim(),
        coverImage: form.coverImage.trim() || null,
        location: form.location.trim(),
        isOnline: form.isOnline,
        onlineLink: form.onlineLink.trim() || null,
        startDate: toTimestamp(form.startDate),
        endDate: toTimestamp(form.endDate),
        capacity: form.capacity ? Number(form.capacity) : null,
        registrationDeadline: toTimestamp(form.registrationDeadline),
        // THE-345 - the write gate, and it is deliberately NOT `price: 0`.
        //
        // While no payment rail exists the price input is absent, so a CREATE
        // can only ever carry the `emptyForm` zero and this clamp merely says so
        // out loud. An EDIT is the case that matters: the founder's tenant holds
        // a published event storing 50, `openEdit` seeds `form.price` from it,
        // and writing a 0 here would SILENTLY MIGRATE that document the next
        // time an admin changed its title. Re-writing the price it read keeps
        // the stored figure exactly where it is; zeroing stored prices is
        // irreversible and is the founder's call, not this write's.
        price: PAID_EVENTS_ENABLED
          ? (Number(form.price) || 0)
          : (view === 'edit' && selected ? selected.price : 0),
        currency: form.currency,
        status: form.status,
        registrationEnabled: form.registrationEnabled,
        ticketTypes: form.ticketTypes,
        waitlistEnabled: form.waitlistEnabled,
        discountCodes: form.discountCodes,
        showOnPublicCalendar: form.showOnPublicCalendar,
        // THE-351 — ids only. The links themselves stay on the tenant document,
        // so a church that corrects its PayPal URL corrects it for every event
        // at once and nothing here holds a stale copy of a money link.
        paymentProviders: readEventProviderIds(form.paymentProviders),
      };
      if (view === 'edit' && selected) {
        await updateDoc(doc(db, 'tenants', tenantId, 'events', selected.id), {
          ...data,
          updatedAt: serverTimestamp(),
        });
        setSelected({ ...selected, ...data } as Event);
        await queryClient.invalidateQueries({ queryKey: ['events', tenantId] });
        setView('detail');
      } else {
        const ref = await addDoc(collection(db, 'tenants', tenantId, 'events'), {
          ...data,
          tenantId,
          createdAt: serverTimestamp(),
          createdBy: auth.currentUser?.uid || '',
        });
        const newEvent: Event = {
          id: ref.id,
          title: data.title || '',
          description: data.description || '',
          coverImage: data.coverImage ?? null,
          location: data.location || '',
          isOnline: data.isOnline || false,
          onlineLink: data.onlineLink ?? null,
          startDate: data.startDate ?? null,
          endDate: data.endDate ?? null,
          capacity: data.capacity ?? null,
          registrationDeadline: data.registrationDeadline ?? null,
          price: data.price || 0,
          currency: data.currency || 'usd',
          status: data.status || 'draft',
          tenantId,
          createdAt: null,
          createdBy: auth.currentUser?.uid || '',
          pinned: false,
          registrationEnabled: data.registrationEnabled || false,
          ticketTypes: data.ticketTypes || [],
          waitlistEnabled: data.waitlistEnabled || false,
          discountCodes: data.discountCodes || [],
          showOnPublicCalendar: data.showOnPublicCalendar ?? true,
        };
        await queryClient.invalidateQueries({ queryKey: ['events', tenantId] });
        setSelected(newEvent);
        setView('detail');
      }
    } catch (e) { notifyError('Failed to save event', e); }
    finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    if (!deleteId || !tenantId) return;
    try {
      await deleteDoc(doc(db, 'tenants', tenantId, 'events', deleteId));
      await queryClient.invalidateQueries({ queryKey: ['events', tenantId] });
    } catch (e) { notifyError('Failed to delete event', e); }
    setDeleteId(null);
    if (view === 'detail') setView('list');
  };

  const togglePin = async (ev: Event) => {
    if (!tenantId) return;
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'events', ev.id), { pinned: !ev.pinned });
      await queryClient.invalidateQueries({ queryKey: ['events', tenantId] });
    } catch (e) { notifyError('Failed to update event', e); }
  };

  /**
   * 🔴 RECORD THAT THE CHURCH FOUND THE PAYMENT. Never writes an invoice itself
   * and never writes a payment field itself — the route does both, in a
   * transaction, so two taps produce one invoice.
   */
  const confirmPayment = async (reg: Registration) => {
    if (!tenantId) return;
    setConfirming(reg.id);
    setConfirmNote(null);
    try {
      const out = await confirmPaymentClaim(tenantId, reg.id);
      setConfirmNote({
        id: reg.id,
        ok: true,
        text: out.alreadyConfirmed ? CONFIRM_ALREADY : CONFIRM_SUCCESS,
      });
      // ⚠️ NO LOCAL PATCH AND NO REFETCH IS NEEDED. `registrations` is an
      // `onSnapshot` listener on this same subcollection, so the row re-renders
      // from the document the route just wrote. Patching it here would be a
      // second opinion about what "paid" means, held for however long the
      // listener took to disagree.
    } catch (e) {
      // 🔴 NOTHING WAS RECORDED AND THE TICKET IS STILL UNPAID. Said where the
      // admin is looking, with the row still in front of them.
      setConfirmNote({
        id: reg.id,
        ok: false,
        text: e instanceof Error && e.message ? e.message : CONFIRM_FAILED,
      });
    } finally {
      setConfirming(null);
    }
  };

  const checkIn = async (reg: Registration) => {
    if (!tenantId) return;
    setCheckingIn(reg.id);
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'registrations', reg.id), { status: 'attended' });
    } catch (e) { notifyError('Failed to check in attendee', e); }
    finally { setCheckingIn(null); }
  };

  // ── Registration engine: ticket type management (within the form) ──
  const saveTicketDraft = () => {
    if (!ticketDraft.name.trim()) return;
    const t: TicketType = {
      id: genId(),
      name: ticketDraft.name.trim(),
      // Use null, never undefined — the Firestore client SDK rejects undefined
      // field values (including nested inside the ticketTypes array).
      description: ticketDraft.description.trim() || null,
      // THE-345 - a ticket type BEING CREATED here carries no price while no
      // rail exists. This is a new object every time, so clamping it rewrites
      // nothing: ticket types already stored arrive through `openEdit` in
      // `form.ticketTypes` and are passed to `handleSave` untouched.
      //
      // `capacity` is deliberately NOT clamped. Capacity and the waitlist are
      // independent of price - a capped FREE ticket type still fills up and
      // still waitlists - and that is the half of this panel a church running a
      // free conference actually needs.
      // THE-351 - `ticketPricingAvailable()` rather than the rail flag. A price
      // is real under MANUAL confirmation too: it is what the member is asked
      // to send to the church's own PayPal, what the inbox row shows, and what
      // THE-350's writer turns into an invoice once an admin vouches for it.
      // The clamp stays for the both-off case, where THE-345's reasoning is
      // unchanged and a new ticket type is built at 0.
      price: ticketPricingAvailable()
        ? Math.max(0, Math.round((Number(ticketDraft.price) || 0) * 100))
        : 0,
      capacity: ticketDraft.capacity ? Number(ticketDraft.capacity) : null,
      order: form.ticketTypes.length,
    };
    setForm({ ...form, ticketTypes: [...form.ticketTypes, t] });
    setTicketDraft(emptyTicket);
    setShowTicketForm(false);
  };

  const removeTicket = (id: string) =>
    setForm({ ...form, ticketTypes: form.ticketTypes.filter(t => t.id !== id).map((t, i) => ({ ...t, order: i })) });

  const moveTicket = (id: string, dir: -1 | 1) => {
    const arr = [...form.ticketTypes];
    const idx = arr.findIndex(t => t.id === id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= arr.length) return;
    [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
    setForm({ ...form, ticketTypes: arr.map((t, i) => ({ ...t, order: i })) });
  };

  // ── Registration engine: discount code management ──
  const saveDiscountDraft = () => {
    const code = discountDraft.code.trim().toUpperCase();
    if (!code) return;
    if (form.discountCodes.some(d => d.code === code)) { notifyError('A discount code with that name already exists', null); return; }
    const isPercent = discountDraft.type === 'percent';
    const raw = Number(discountDraft.value) || 0;
    const value = isPercent ? Math.min(100, Math.max(0, Math.round(raw))) : Math.max(0, Math.round(raw * 100));
    const d: DiscountCode = {
      code,
      type: discountDraft.type,
      value,
      maxUses: discountDraft.maxUses ? Number(discountDraft.maxUses) : null,
      usedCount: 0,
    };
    setForm({ ...form, discountCodes: [...form.discountCodes, d] });
    setDiscountDraft(emptyDiscount);
    setShowDiscountForm(false);
  };

  const removeDiscount = (code: string) =>
    setForm({ ...form, discountCodes: form.discountCodes.filter(d => d.code !== code) });

  const copyRegUrl = async () => {
    if (!selected) return;
    try { await navigator.clipboard.writeText(registrationUrl(selected.id)); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };

  const exportCSV = () => {
    if (!selected) return;
    const rows = [
      ['Name', 'Email', 'Phone', 'Ticket Code', 'Status', 'Amount', 'Registered At'],
      ...registrations.map(r => [
        r.name, r.email, r.phone || '', r.ticketCode, r.status,
        // THE-345 - the Amount column may not report money nobody sent. A row
        // storing 0 exports `$0` in every configuration because nobody was
        // charged and that is true; a non-zero amount is only vouchable while a
        // rail exists. This is the sheet a treasurer reconciles against a bank
        // statement, so a figure it cannot stand behind is worse than a word.
        // THE-351 — the column means something true again, ROW BY ROW. A
        // confirmed row exports the figure (an admin found it in their own
        // account and there is an invoice behind it); anything else exports
        // "Not confirmed". 🔴 A CLAIM IS NOT A CONFIRMATION: "I've paid" is the
        // member's word, and this is the sheet a treasurer reconciles against a
        // bank statement.
        manualConfirmationMode()
          ? csvAmountCell(r.amount, paymentStateOf(r) === 'confirmed' ? 'confirmed' : 'unconfirmed')
          : csvAmountCell(r.amount),
        r.registeredAt ? r.registeredAt.toDate().toLocaleDateString() : ''
      ])
    ];
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selected.title.replace(/\s+/g, '_')}_attendees.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #d4a017)', borderTopColor: 'transparent' }} /></div>;
  }

  // ── Form View ──
  if (view === 'create' || view === 'edit') {
    return (
      <div className={`${FORM_MEASURE} pb-32`}>
        <div className="bg-surface-raised rounded-2xl border border-line shadow-xs p-6 space-y-5">
          <div className="grid grid-cols-1 gap-5">
            <div>
              <label className="text-xs font-semibold text-body mb-1.5 block">Event Title *</label>
              <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                className={`w-full border border-line bg-surface-sunken rounded-xl px-3 py-2.5 text-sm text-strong focus:outline-hidden focus:border-gold focus:bg-surface-raised transition-colors ${FIELD_WIDTH.long} ${CONTROL_DENSITY.control}`} placeholder="Event name" />
            </div>
            <div>
              <label className="text-xs font-semibold text-body mb-1.5 block">Description</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                rows={3} className={`w-full border border-line bg-surface-sunken rounded-xl px-3 py-2.5 text-sm text-strong focus:outline-hidden focus:border-gold focus:bg-surface-raised transition-colors resize-none ${FIELD_WIDTH.long}`}
                placeholder="What is this event about?" />
            </div>
            <div>
              <label className="text-xs font-semibold text-body mb-1.5 block">Cover Image</label>
              <ImageUpload value={form.coverImage || ''} onChange={url => setForm({ ...form, coverImage: url })} label="Add cover image" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-body mb-1.5 block">Start Date & Time *</label>
                <input type="datetime-local" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })}
                  className={`w-full border border-line bg-surface-sunken rounded-xl px-3 py-2.5 text-sm text-strong focus:outline-hidden focus:border-gold focus:bg-surface-raised transition-colors ${FIELD_WIDTH.medium} ${CONTROL_DENSITY.control}`} />
              </div>
              <div>
                <label className="text-xs font-semibold text-body mb-1.5 block">End Date & Time</label>
                <input type="datetime-local" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })}
                  className={`w-full border border-line bg-surface-sunken rounded-xl px-3 py-2.5 text-sm text-strong focus:outline-hidden focus:border-gold focus:bg-surface-raised transition-colors ${FIELD_WIDTH.medium} ${CONTROL_DENSITY.control}`} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs font-semibold text-body">Online Event</label>
                <button onClick={() => setForm({ ...form, isOnline: !form.isOnline })} className="transition-colors">
                  <div className={`w-10 h-5 rounded-full transition-colors flex items-center px-0.5 ${form.isOnline ? 'bg-gold' : 'bg-surface-chip'}`}>
                    <div className={`w-4 h-4 rounded-full bg-surface-raised shadow transition-transform ${form.isOnline ? 'translate-x-5' : ''}`} />
                  </div>
                </button>
              </div>
              {form.isOnline ? (
                <input value={form.onlineLink} onChange={e => setForm({ ...form, onlineLink: e.target.value })}
                  className={`w-full border border-line bg-surface-sunken rounded-xl px-3 py-2.5 text-sm text-strong focus:outline-hidden focus:border-gold focus:bg-surface-raised transition-colors ${FIELD_WIDTH.long} ${CONTROL_DENSITY.control}`} placeholder="Meeting link (Zoom, Google Meet...)" />
              ) : (
                <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })}
                  className={`w-full border border-line bg-surface-sunken rounded-xl px-3 py-2.5 text-sm text-strong focus:outline-hidden focus:border-gold focus:bg-surface-raised transition-colors ${FIELD_WIDTH.long} ${CONTROL_DENSITY.control}`} placeholder="Event location / address" />
              )}
            </div>
            {/*
              THE-345 - the price field is ABSENT while no payment rail exists,
              not disabled-and-warning. A church that types 50 into a field that
              warns still expects money to arrive; the warning just moves the
              same lie one click further on. Capacity spans the row on its own
              rather than sitting beside a gap, because capacity has nothing to
              do with price and a church running a free conference still caps it.
            */}
            <div className={PAID_EVENTS_ENABLED ? 'grid grid-cols-2 gap-4' : ''}>
              <div>
                <label className="text-xs font-semibold text-body mb-1.5 block">Capacity (blank = unlimited)</label>
                <input type="number" min={0} value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })}
                  className={`w-full border border-line bg-surface-sunken rounded-xl px-3 py-2.5 text-sm text-strong focus:outline-hidden focus:border-gold focus:bg-surface-raised transition-colors ${FIELD_WIDTH.short} ${CONTROL_DENSITY.control}`} placeholder="e.g. 100" />
              </div>
              {PAID_EVENTS_ENABLED && (
                <div>
                  <label className="text-xs font-semibold text-body mb-1.5 block">Ticket Price ($)</label>
                  <input type="number" min={0} value={form.price} onChange={e => setForm({ ...form, price: e.target.value })}
                    className={`w-full border border-line bg-surface-sunken rounded-xl px-3 py-2.5 text-sm text-strong focus:outline-hidden focus:border-gold focus:bg-surface-raised transition-colors ${FIELD_WIDTH.short} ${CONTROL_DENSITY.control}`} placeholder="0 = free" />
                </div>
              )}
            </div>

            {/*
              What a church sees INSTEAD, and it has to say two things at once:
              that money cannot be collected, and that registration is completely
              unaffected. `alert` - the primitive is installed, so a hand-rolled
              div would be a defect. The DEFAULT variant, not `destructive`:
              nothing has failed and nothing the church did is wrong, so the red
              treatment THE-342 reserves for a read that broke would overstate
              this and train an admin to ignore it. `empty` was rejected outright
              - this is a capability that is temporarily gone, not an empty
              collection - and `badge` was rejected because the wording is two
              sentences of instruction and a badge is a label.
            */}
            {/*
              🔴 THE-351 — THREE STATES NOW, AND THE MIDDLE ONE IS THE COMMON ONE.

              · No pricing at all (both switches off) — THE-345's notice,
                unchanged and still reached the day manual confirmation is
                withdrawn.
              · Manual confirmation, but the church has NO payment links — a
                refusal WITH an instruction. Pricing a ticket with nowhere for
                the money to go produces a member staring at a price and no way
                to pay, so the input is ABSENT (THE-345's reasoning, verbatim)
                and the copy names the screen that fixes it.
              · Manual confirmation with links — 🔴 THE DISCLAIMER, and it is NOT
                A FOOTNOTE. It sits ABOVE the pricing block, before the price
                input, so an admin cannot type a number without having read that
                Harvest cannot check anything, that THEY will confirm each
                payment by hand, and that an unconfirmed member is still let in
                at the door.

              `alert` for all three — the primitive is installed, and a
              hand-rolled div would be the defect THE-345 names. The DEFAULT
              variant, not `destructive`: nothing has failed and nothing the
              church did is wrong. `empty` was rejected (a capability, not an
              empty collection); `badge` was rejected (two sentences of
              instruction is not a label); `tooltip` was rejected outright — a
              disclaimer behind a hover is a disclaimer nobody on a phone reads.
            */}
            {!ticketPricingAvailable() && (
              <Alert data-paid-events-gate="form">
                <AlertTitle>{PAID_EVENTS_HIDDEN_TITLE}</AlertTitle>
                <AlertDescription>{PAID_EVENTS_HIDDEN_MESSAGE}</AlertDescription>
              </Alert>
            )}
            {manualConfirmationMode() && churchLinks.length === 0 && (
              <Alert data-paid-events-gate="no-links">
                <AlertTitle>{NO_LINKS_TITLE}</AlertTitle>
                <AlertDescription>{NO_LINKS_BODY}</AlertDescription>
              </Alert>
            )}
            {manualConfirmationMode() && churchLinks.length > 0 && (
              <>
                <Alert data-manual-payment-disclaimer>
                  <AlertTitle>{CREATION_DISCLAIMER_TITLE}</AlertTitle>
                  <AlertDescription>{CREATION_DISCLAIMER_BODY}</AlertDescription>
                </Alert>

                {/*
                  🔴 WHICH links accept payment for THIS event. `checkbox` — the
                  choice is a SUBSET and each option is independent, which is
                  exactly what a checkbox group is. `toggle-group` was rejected:
                  its multiple mode looks like a segmented control, which reads
                  as "pick one" on a row of six; `select` was rejected because a
                  multi-select is the worst control on a phone; `radio-group`
                  was rejected because it cannot express "all of them".
                */}
                <div data-event-provider-picker>
                  <p className="text-xs font-semibold text-body mb-1">{PROVIDER_PICKER_TITLE}</p>
                  <p className="text-xs text-muted mb-2.5">{PROVIDER_PICKER_HELP}</p>
                  <div className="space-y-1">
                    {churchLinks.map(({ provider }) => {
                      const ticked = form.paymentProviders.includes(provider.id);
                      return (
                        <label
                          key={provider.id}
                          data-provider-option={provider.id}
                          className="flex items-center gap-2.5 min-h-11 sm:min-h-0 cursor-pointer"
                        >
                          <Checkbox
                            checked={ticked}
                            onCheckedChange={() => setForm({
                              ...form,
                              paymentProviders: ticked
                                ? form.paymentProviders.filter(id => id !== provider.id)
                                : [...form.paymentProviders, provider.id],
                            })}
                          />
                          <span className="text-sm text-body">{provider.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
            <div>
              <label className="text-xs font-semibold text-body mb-1.5 block">Registration Deadline</label>
              <input type="datetime-local" value={form.registrationDeadline} onChange={e => setForm({ ...form, registrationDeadline: e.target.value })}
                className={`w-full border border-line bg-surface-sunken rounded-xl px-3 py-2.5 text-sm text-strong focus:outline-hidden focus:border-gold focus:bg-surface-raised transition-colors ${FIELD_WIDTH.medium} ${CONTROL_DENSITY.control}`} />
            </div>

            {/* ── Registration engine ── */}
            <div className="border-t border-line pt-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-strong">Enable Registrations</p>
                  <p className="text-xs text-faint mt-0.5">
                    When enabled, attendees can sign up for this event via a public registration page with QR code access.
                  </p>
                </div>
                <Toggle on={form.registrationEnabled} onClick={() => setForm({ ...form, registrationEnabled: !form.registrationEnabled })} />
              </div>

              {form.registrationEnabled && (
                <div className="mt-5 space-y-5">
                  {/* Ticket Types */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-bold text-body flex items-center gap-1.5 font-display"><Ticket size={13} /> Ticket Types</h4>
                      {!showTicketForm && (
                        <button onClick={() => { setTicketDraft(emptyTicket); setShowTicketForm(true); }}
                          className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted hover:bg-surface-sunken">
                          <Plus size={12} /> Add Ticket Type
                        </button>
                      )}
                    </div>

                    {form.ticketTypes.length === 0 && !showTicketForm && (
                      <p className="text-xs text-faint bg-surface-sunken rounded-xl p-3">
                        Add at least one ticket type. Attendees will choose one when registering.
                      </p>
                    )}

                    <div className="space-y-2">
                      {form.ticketTypes.map((t, i) => (
                        <div key={t.id} className="flex items-center gap-2 bg-surface-raised border border-line rounded-xl px-3 py-2.5">
                          <div className="flex flex-col">
                            <button onClick={() => moveTicket(t.id, -1)} disabled={i === 0} className="text-stone-300 hover:text-muted disabled:opacity-30"><ArrowUp size={12} /></button>
                            <button onClick={() => moveTicket(t.id, 1)} disabled={i === form.ticketTypes.length - 1} className="text-stone-300 hover:text-muted disabled:opacity-30"><ArrowDown size={12} /></button>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-strong truncate">{t.name}</p>
                            {/*
                              THE-345 - a STORED ticket type keeps its price on
                              the document and loses it from this line, because
                              this line is a quote. `fmtCents` is untouched and
                              comes straight back with the switch.
                            */}
                            <p className="text-xs text-faint">
                              {canPriceTickets ? `${fmtCents(t.price)} · ` : ''}
                              {t.capacity == null ? 'Unlimited' : `${t.capacity} cap`}
                              {t.description ? ` · ${t.description}` : ''}
                            </p>
                          </div>
                          <button onClick={() => removeTicket(t.id)} className="p-1.5 rounded-lg hover:bg-red-50"><X size={14} className="text-red-400" /></button>
                        </div>
                      ))}
                    </div>

                    {showTicketForm && (
                      <div className="mt-2 bg-surface-sunken rounded-xl p-3 space-y-2.5">
                        <input value={ticketDraft.name} onChange={e => setTicketDraft({ ...ticketDraft, name: e.target.value })}
                          placeholder="Name (e.g. Adult)" className={`w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-gold ${FIELD_WIDTH.medium} ${CONTROL_DENSITY.control}`} />
                        <input value={ticketDraft.description} onChange={e => setTicketDraft({ ...ticketDraft, description: e.target.value })}
                          placeholder="Description (optional)" className={`w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-gold ${FIELD_WIDTH.long} ${CONTROL_DENSITY.control}`} />
                        {/*
                          THE-345 - same gate, same reason as the event price
                          above: a ticket type is where the price that ACTUALLY
                          charges lives (`ticketTypes[].price`, in cents, is what
                          /api/event-registration/submit totals), so leaving it
                          editable would let a church build a $50 ticket and
                          watch every member bounce off a 400 telling them to
                          phone the church. Capacity stays, unconditionally, and
                          spans the row alone while the price is gone - a capped
                          FREE ticket type still fills and still waitlists.
                        */}
                        <div className={canPriceTickets ? "grid grid-cols-2 gap-2" : ""}>
                          {canPriceTickets && (
                            <input type="number" min={0} step="0.01" value={ticketDraft.price} onChange={e => setTicketDraft({ ...ticketDraft, price: e.target.value })}
                              placeholder="Price ($) — 0 = Free" className={`w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-gold ${FIELD_WIDTH.short} ${CONTROL_DENSITY.control}`} />
                          )}
                          <input type="number" min={0} value={ticketDraft.capacity} onChange={e => setTicketDraft({ ...ticketDraft, capacity: e.target.value })}
                            placeholder="Capacity (blank = ∞)" className={`w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-gold ${FIELD_WIDTH.short} ${CONTROL_DENSITY.control}`} />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => { setShowTicketForm(false); setTicketDraft(emptyTicket); }} className={`flex-1 py-2 rounded-lg border border-line text-xs font-semibold text-muted ${ACTION_BUTTON} ${CONTROL_DENSITY.action}`}>Cancel</button>
                          <button onClick={saveTicketDraft} disabled={!ticketDraft.name.trim()}
                            className={`flex-1 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50 ${ACTION_BUTTON} ${CONTROL_DENSITY.action}`} style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>Add</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Waitlist — only when at least one ticket type is capped */}
                  {form.ticketTypes.some(t => t.capacity != null) && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-body">Enable waitlist when capacity is full</span>
                      <Toggle on={form.waitlistEnabled} onClick={() => setForm({ ...form, waitlistEnabled: !form.waitlistEnabled })} />
                    </div>
                  )}

                  {/* Discount Codes */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-bold text-body flex items-center gap-1.5 font-display"><Tag size={13} /> Discount Codes</h4>
                      {!showDiscountForm && (
                        <button onClick={() => { setDiscountDraft(emptyDiscount); setShowDiscountForm(true); }}
                          className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted hover:bg-surface-sunken">
                          <Plus size={12} /> Add Discount Code
                        </button>
                      )}
                    </div>

                    <div className="space-y-2">
                      {form.discountCodes.map(d => (
                        <div key={d.code} className="flex items-center gap-2 bg-surface-raised border border-line rounded-xl px-3 py-2.5">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${d.type === 'percent' ? 'bg-field-100 text-field-700' : 'bg-sky-100 text-sky-700'}`}>{d.type === 'percent' ? '%' : '$'}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-strong truncate font-mono">{d.code}</p>
                            <p className="text-xs text-faint">{fmtDiscount(d)} · {d.usedCount}{d.maxUses == null ? '' : `/${d.maxUses}`} used</p>
                          </div>
                          <button onClick={() => removeDiscount(d.code)} className="p-1.5 rounded-lg hover:bg-red-50"><X size={14} className="text-red-400" /></button>
                        </div>
                      ))}
                    </div>

                    {showDiscountForm && (
                      <div className="mt-2 bg-surface-sunken rounded-xl p-3 space-y-2.5">
                        <input value={discountDraft.code} onChange={e => setDiscountDraft({ ...discountDraft, code: e.target.value.toUpperCase() })}
                          placeholder="CODE (e.g. SCHOLAR50)" className={`w-full border border-line rounded-lg px-3 py-2 text-sm font-mono focus:outline-hidden focus:border-gold ${FIELD_WIDTH.medium} ${CONTROL_DENSITY.control}`} />
                        <div className="flex gap-3">
                          <label className="flex items-center gap-1.5 text-sm text-body">
                            <input type="radio" name="discountType" checked={discountDraft.type === 'percent'} onChange={() => setDiscountDraft({ ...discountDraft, type: 'percent' })} /> Percent off
                          </label>
                          <label className="flex items-center gap-1.5 text-sm text-body">
                            <input type="radio" name="discountType" checked={discountDraft.type === 'fixed'} onChange={() => setDiscountDraft({ ...discountDraft, type: 'fixed' })} /> Fixed ($) off
                          </label>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input type="number" min={0} step={discountDraft.type === 'percent' ? '1' : '0.01'} value={discountDraft.value} onChange={e => setDiscountDraft({ ...discountDraft, value: e.target.value })}
                            placeholder={discountDraft.type === 'percent' ? 'Percent (0–100)' : 'Amount ($)'} className={`w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-gold ${FIELD_WIDTH.short} ${CONTROL_DENSITY.control}`} />
                          <input type="number" min={0} value={discountDraft.maxUses} onChange={e => setDiscountDraft({ ...discountDraft, maxUses: e.target.value })}
                            placeholder="Max uses (blank = ∞)" className={`w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-gold ${FIELD_WIDTH.short} ${CONTROL_DENSITY.control}`} />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => { setShowDiscountForm(false); setDiscountDraft(emptyDiscount); }} className={`flex-1 py-2 rounded-lg border border-line text-xs font-semibold text-muted ${ACTION_BUTTON} ${CONTROL_DENSITY.action}`}>Cancel</button>
                          <button onClick={saveDiscountDraft} disabled={!discountDraft.code.trim()}
                            className={`flex-1 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50 ${ACTION_BUTTON} ${CONTROL_DENSITY.action}`} style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>Add</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Public calendar */}
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-body">Show on public calendar</span>
                      <Toggle on={form.showOnPublicCalendar} onClick={() => setForm({ ...form, showOnPublicCalendar: !form.showOnPublicCalendar })} />
                    </div>
                    <p className="text-xs text-faint mt-1">Your public calendar is at {tenantId || 'your-ministry'}.theharvest.app/calendar</p>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="text-xs font-semibold text-body mb-1.5 block">Status</label>
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as Event['status'] })}
                className={`w-full border border-line bg-surface-sunken rounded-xl px-3 py-2.5 text-sm text-strong focus:outline-hidden focus:border-gold focus:bg-surface-raised transition-colors ${FIELD_WIDTH.medium} ${CONTROL_DENSITY.control}`}>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="cancelled">Cancelled</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setView('list')} className={`flex-1 py-2.5 rounded-xl border border-line text-sm font-semibold text-muted ${ACTION_BUTTON} ${CONTROL_DENSITY.action}`}>Cancel</button>
            <button onClick={handleSave} disabled={saving || !form.title.trim()}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 ${ACTION_BUTTON} ${CONTROL_DENSITY.action}`}
              style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>
              {saving ? 'Saving...' : view === 'edit' ? 'Save Changes' : 'Create Event'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Detail View ──
  if (view === 'detail' && selected) {
    const attended = registrations.filter(r => r.status === 'attended').length;
    const confirmed = registrations.filter(r => r.status === 'confirmed').length;
    const waitlistedCount = registrations.filter(r => r.waitlisted).length;
    const ticketTypes = Array.isArray(selected.ticketTypes) ? selected.ticketTypes : [];
    const filteredRegs = registrations.filter(r =>
      !regSearch ||
      r.name.toLowerCase().includes(regSearch.toLowerCase()) ||
      r.email.toLowerCase().includes(regSearch.toLowerCase()) ||
      r.ticketCode.toLowerCase().includes(regSearch.toLowerCase())
    );
    return (
      <div className={FORM_CONTAINER}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-xl font-bold text-strong truncate font-display">{selected.title}</h2>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[selected.status]}`}>
              {selected.status}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => openEdit(selected)} className="p-2 rounded-xl border border-line hover:bg-surface-sunken">
              <Edit2 size={15} className="text-muted" />
            </button>
            <button onClick={() => setDeleteId(selected.id)} className="p-2 rounded-xl border border-red-100 hover:bg-red-50">
              <Trash2 size={15} className="text-red-400" />
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-surface-raised rounded-2xl p-4 border border-line text-center shadow-xs">
            <div className="text-2xl font-bold text-strong">{registrations.length}</div>
            <div className="text-xs text-faint mt-0.5">Total</div>
          </div>
          <div className="bg-surface-raised rounded-2xl p-4 border border-line text-center shadow-xs">
            <div className="text-2xl font-bold text-field-600">{confirmed}</div>
            <div className="text-xs text-faint mt-0.5">{REGISTERED_STAT_LABEL}</div>
          </div>
          <div className="bg-surface-raised rounded-2xl p-4 border border-line text-center shadow-xs">
            <div className="text-2xl font-bold" style={{ color: 'var(--brand-color, #d4a017)' }}>{attended}</div>
            <div className="text-xs text-faint mt-0.5">Attended</div>
          </div>
        </div>

        {/* 🔴 THE-326 — THE RUN SHEET IS NOT MOUNTED HERE ANY MORE.
            It was `ServicePlanPanel`, two clicks deep behind an event, which is
            the defect this ticket fixes: planning a Sunday service is a weekly
            rhythm with a rota and volunteers hanging off it, not a panel on an
            event's detail page. It lives in the Service planning section
            (`AdminServices`), which reads the same `servicePlans` documents
            against the same `eventId` — the data did not move, only the door.
            ⚠️ The plan is still keyed to THIS event; see `AdminServices`'s
            header for why that is a contract and not a convenience. */}

        {/* Registration panel — only for registration-enabled events */}
        {selected.registrationEnabled && (
          <div className="bg-surface-raised rounded-2xl p-5 border border-line shadow-xs mb-5">
            <h3 className="text-sm font-bold text-body mb-3 flex items-center gap-1.5 font-display"><Ticket size={14} /> Public Registration</h3>
            <div className="grid sm:grid-cols-[auto_1fr] gap-4 items-start">
              <div className="text-center">
                {qrDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qrDataUrl} alt="Registration QR code" className="w-36 h-36 mx-auto" />
                ) : (
                  <div className="w-36 h-36 mx-auto flex items-center justify-center text-stone-300 border border-dashed border-line rounded-xl"><QrCode size={40} /></div>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-muted mb-1">Registration link</p>
                <p className="text-xs text-muted break-all mb-2">{registrationUrl(selected.id)}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={copyRegUrl} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-line text-body hover:bg-surface-sunken">
                    {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied!' : 'Copy link'}
                  </button>
                  {qrDataUrl && (
                    <a href={qrDataUrl} download={`${selected.title.replace(/[^a-z0-9]/gi, '_')}_qr.png`}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-line text-body hover:bg-surface-sunken">
                      <Download size={13} /> QR
                    </a>
                  )}
                  <a href={registrationUrl(selected.id)} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-line text-body hover:bg-surface-sunken">
                    <Link2 size={13} /> Open
                  </a>
                </div>

                {/* Ticket type breakdown */}
                {ticketTypes.length > 0 && (
                  <div className="mt-4 space-y-1.5">
                    {ticketTypes.map(t => {
                      const count = registrations.filter(r => r.ticketTypeId === t.id && !r.waitlisted).length;
                      return (
                        <div key={t.id} className="flex items-center justify-between text-xs">
                          <span className="text-body font-medium truncate">{t.name}</span>
                          <span className="text-faint">{count} registered{t.capacity == null ? '' : ` / ${t.capacity} capacity`}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {selected.waitlistEnabled && (
                  <p className="text-xs text-wheat-600 mt-3 font-medium">{waitlistedCount} on waitlist</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Attendee list */}
        <div className="flex items-center gap-3 mb-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input value={regSearch} onChange={e => setRegSearch(e.target.value)}
              placeholder="Search attendees..." className={`w-full pl-9 pr-3 py-2 text-sm border border-line rounded-xl focus:outline-hidden focus:border-gold ${FIELD_WIDTH.long} ${CONTROL_DENSITY.control}`} />
          </div>
          {registrations.length > 0 && (
            <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-line text-muted hover:bg-surface-sunken">
              <Download size={13} /> Export CSV
            </button>
          )}
        </div>

        {filteredRegs.length === 0 ? (
          <div className="text-center py-12 text-faint">
            <Users size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm font-display">{regSearch ? 'No attendees match' : 'No registrations yet'}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredRegs.map(r => (
              <div key={r.id} className="bg-surface-raised rounded-2xl px-4 py-3 border border-line shadow-xs flex items-center gap-3">
                <div className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
                  style={{ backgroundColor: r.status === 'attended' ? '#6E8E52' : 'var(--brand-color, #d4a017)' }}>
                  {r.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-strong truncate">{r.name}</p>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      r.status === 'attended' ? 'bg-field-100 text-field-700' :
                      r.status === 'confirmed' ? 'bg-sky-100 text-sky-700' :
                      r.status === 'waitlisted' ? 'bg-wheat-100 text-wheat-700' : 'bg-red-100 text-red-600'
                    }`}>{registrationStatusLabel(r.status)}</span>
                  </div>
                  <p className="text-xs text-faint">
                    {r.email} · #{r.ticketCode}{r.ticketTypeName ? ` · ${r.ticketTypeName}` : ''}
                  </p>
                  {/*
                    🔴 THE-351 — WHAT THE VOLUNTEER ON THE DOOR SEES, AND IT
                    CHANGES NOTHING ABOUT WHETHER THE PERSON COMES IN.

                    ✅ THE FOUNDER'S DECISION: LET THEM IN, FLAGGED. The Check In
                    control below is gated on `r.status === 'confirmed'` —
                    REGISTRATION status, which has never meant money — and this
                    flag is rendered BESIDE it, never in place of it. Somebody
                    who paid on Friday and was not confirmed until Sunday walks
                    in. Turning a paying guest away because an admin had not
                    tapped a button is the worst outcome this ticket could
                    produce, and the shape of this JSX is what makes it
                    impossible: there is no branch here that reaches `checkIn`.

                    ⚠️ THE WORDING IS SHORT AND NEUTRAL ON PURPOSE. It names the
                    RECORD's state ("Payment not confirmed"), never the person's
                    ("hasn't paid"), so it is enough for the volunteer to act on
                    and not enough to embarrass the guest if they read it over a
                    shoulder. The instruction — "Let them in" — is in the title
                    attribute, where the volunteer looks and the queue does not.
                  */}
                  {(() => {
                    const pay = paymentStateOf(r);
                    if (pay === 'free') return null;
                    return pay === 'confirmed' ? (
                      <span data-door-payment="confirmed" className="text-[10px] font-semibold text-field-700">
                        {DOOR_CONFIRMED_BADGE}
                      </span>
                    ) : (
                      <span
                        data-door-payment="unconfirmed"
                        title={DOOR_UNCONFIRMED_HELP}
                        className="text-[10px] font-semibold text-wheat-700"
                      >
                        {DOOR_UNCONFIRMED_BADGE}
                      </span>
                    );
                  })()}
                  {confirmNote && confirmNote.id === r.id && (
                    <span
                      data-confirm-note={confirmNote.ok ? 'ok' : 'failed'}
                      className={`block text-[10px] font-semibold ${confirmNote.ok ? 'text-muted' : 'text-destructive'}`}
                    >
                      {confirmNote.text}
                    </span>
                  )}
                </div>
                {/* 🔴 THE-351 — Confirm sits BESIDE Check In and never in place
                    of it: the founder's decision is that an unconfirmed guest
                    walks in, so the door control below is reached on exactly
                    the same condition it always was. */}
                {manualConfirmationMode() && (paymentStateOf(r) === 'claimed' || paymentStateOf(r) === 'unpaid') && (
                  <button
                    onClick={() => void confirmPayment(r)}
                    disabled={confirming === r.id}
                    data-row-confirm-payment
                    title={CONFIRM_BUTTON_HELP}
                    // 🔴 `bg-gold` IS `var(--brand-color)` (tailwind.config.ts:
                    // "Tenant-overridable action gold"), so this mints no colour
                    // literal at all — unlike the five pre-existing
                    // `var(--brand-color, #d4a017)` fallbacks in this file,
                    // which THE-346's registry pins by value and which a sixth
                    // would have added to.
                    className={`min-h-11 px-3 rounded-xl text-xs font-semibold text-white bg-gold disabled:opacity-50 ${CONTROL_DENSITY.action}`}
                  >
                    {confirming === r.id ? 'Recording…' : CONFIRM_BUTTON}
                  </button>
                )}
                {r.status === 'confirmed' && (
                  <button
                    onClick={() => checkIn(r)}
                    disabled={checkingIn === r.id}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-field-100 text-field-700 hover:bg-field-200 disabled:opacity-50"
                  >
                    <Check size={12} /> Check In
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // THE-317 — the volunteer rota. Its own screen inside this tab rather than a
  // new nav entry: the rota is the events' own assignments seen across dates,
  // and the tier/tab matrix is generated from the real nav array.
  // ── List View ──
  const calendarUrl = `https://${tenantId}.theharvest.app/calendar`;
  const copyCalendarUrl = async () => {
    try { await navigator.clipboard.writeText(calendarUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };
  return (
    <div className={`w-full ${FORM_CONTAINER} space-y-6`}>
      <AdminPageHeader
        eyebrow="Broadcasting"
        title={`${events.length} event${events.length === 1 ? '' : 's'}`}
        action={<AdminPrimaryButton onClick={() => { setSelected(null); setForm(emptyForm); setView('create'); }} icon={<span className="text-[15px] leading-none">+</span>}>Create event</AdminPrimaryButton>}
      />
      {events.length > 0 && tenantId && (
        <div className="flex items-center gap-2 bg-surface-sunken border border-line rounded-brand-lg px-3 py-2.5 text-xs">
          <span className="text-faint shrink-0">Public calendar:</span>
          <span className="text-muted truncate flex-1 min-w-0">{calendarUrl}</span>
          <button onClick={copyCalendarUrl} className="flex items-center gap-1 px-2 py-1 rounded-lg border border-line text-muted hover:bg-surface-raised shrink-0">
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
          </button>
          <a href={calendarUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 px-2 py-1 rounded-lg border border-line text-muted hover:bg-surface-raised shrink-0">
            <Link2 size={12} /> Open
          </a>
        </div>
      )}
      {/*
        THE-308 — the month grid sits BESIDE the list, not over it.

        🔴 The list is the better answer to "what is next": it is ordered, it is
        dense, and it reads top-down on a phone. A grid answers a different
        question — "what does September look like" — and replacing one with the
        other would trade a good answer to the common question for a good answer
        to the rarer one. So both, and the list stays the default tab.

        ⚠️ The two tabs also read DIFFERENTLY on purpose, and that is not an
        oversight: the list takes `useEvents` (ordered, capped at 100) because
        the top of an order is what it shows, and the grid takes a count-gated
        COMPLETE read because a month must contain everything in it or say that
        it does not. See `events/month-view.ts`.
      */}
      {/*
         THE-346 · THE HEIGHT IS ON THE WRONG ELEMENT, AND IT IS THIS FILE'S
        BUG — NOT THE PRIMITIVE'S, AND NOT PR 482's LEAK.

        The founder: *"look at how the buttons for list and month look like. It
        needs to be fixed."* Measured in Chromium at 380px, before:

            TabsList    32.00px tall   (y 0.0 → 32.0)
            TabsTrigger 44.00px tall   (y -6 → 38 relative to a list at 0 → 32)

        The PILL IS TALLER THAN THE BOX IT LIVES IN and hangs 6px out of each end of the
        bottom of it. That is the "misaligned, floating inside an oversized
        container" the founder is describing, seen from the other side: the
        container is not oversized, the pill has outgrown it.

        Both numbers are correct in isolation and that is the whole trap.
        `ui/tabs.tsx` fixes the LIST at `h-8` (32px) through
        `group-data-[orientation=horizontal]/tabs:h-8`, which is the right
        desktop density and is shared by every other Tabs in the app. THE-308
        then put a 44px tap-target floor on the TRIGGERS here, which is required
        below `sm` and is correct. Nobody raised the list to hold them.

         PR 482's CLASS OF FAULT WAS RULED OUT BEFORE THIS WAS WRITTEN, not
        assumed away. `AdminRoles.tsx` injecting an unscoped `* { margin:0 }`
        zeroed a SIBLING's padding, so the same shape was looked for here: the
        compiled stylesheet carries exactly one non-utility `min-height` rule
        (`::-webkit-date-and-time-value`), and the 32/44 split reproduces with
        these two triggers and NOTHING ELSE on the page. It is local styling.

         `min-h-[44px]` IS NOT INERT and was not the culprit either — it
        measures a true 44px. It is spelled `min-h-11` now only because that is
        the same 44px off the spacing scale rather than an arbitrary value.

         SO THE LIST IS RELEASED BELOW `sm`, NOT GIVEN A NUMBER. `h-auto` lets
        it wrap whatever the triggers need — 44px of tap target plus the list's
        own `p-[3px]`, so 50px — which stays correct if that floor ever moves.
        Hard-coding `h-[50px]` would be the same mistake one breakpoint along.
        The `sm:` half restores the primitive's own 32px from `sm` up, where
        Rule 4 owns density and a 44px target is not required.

         THE VARIANT IS SPELLED OUT IN FULL on both halves on purpose. Plain
        `h-auto` LOSES: `group-data-[orientation=horizontal]/tabs:h-8` compiles
        to `.group[data-orientation=horizontal] .h-8`, two selectors of
        specificity against one, so the base wins whatever `cn()` does. Matching
        the variant is what lets tailwind-merge see the same key and replace it.

        After, at 380px: list 50.0px, both triggers 44.0px, top-aligned at 3.0
        and bottom at 47.0 — inside the box, on both axes.
      */}
      <Tabs value={listTab} onValueChange={(v) => setListTab(v as 'list' | 'month')}>
        <TabsList className="group-data-[orientation=horizontal]/tabs:h-auto sm:group-data-[orientation=horizontal]/tabs:h-8">
          <TabsTrigger value="list" className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0">List</TabsTrigger>
          <TabsTrigger value="month" className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0">Month</TabsTrigger>
        </TabsList>
        <TabsContent value="month" className="mt-4">
          <React.Suspense fallback={null}>
          <EventMonthView
            read={monthRead}
            loading={monthLoading}
            onOpenEvent={(id) => {
              const ev = events.find(e => e.id === id);
              if (ev) openDetail(ev);
            }}
          />
          </React.Suspense>
        </TabsContent>
        <TabsContent value="list" className="mt-4 space-y-6">
      {events.length === 0 ? (
        <div className="text-center py-16 text-faint">
          <CalendarCheck size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium font-display">No events yet</p>
          <p className="text-sm mt-1">Create your first event to start accepting registrations</p>
        </div>
      ) : (
        <div className="space-y-3">
          {events.map(ev => (
            <React.Fragment key={ev.id}>
              {/* Mobile card — mockup design: hero band (cover, else navy→gold gradient),
                  status pill overlay, meta row, actions. Same handlers as the desktop card. */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => openDetail(ev)}
                className="lg:hidden bg-surface-raised rounded-brand-xl border border-line shadow-[var(--ds-sh-sm)] overflow-hidden cursor-pointer"
              >
                <div className="relative h-20">
                  {ev.coverImage ? (
                    <img src={ev.coverImage} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <HeroBand radius="0" className="!absolute inset-0" />
                  )}
                  <span
                    className="absolute top-2.5 left-2.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                    style={{
                      background: ev.status === 'published' ? 'var(--surface-gold)' : 'var(--surface-sunken)',
                      color: ev.status === 'published' ? 'var(--wheat-700)' : 'var(--text-muted)',
                    }}
                  >
                    {ev.status}
                  </span>
                </div>
                <div className="p-3.5">
                  <div className="font-display text-[15px] font-medium text-strong leading-snug">{ev.title}</div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs text-muted">
                    {ev.startDate && <span className="flex items-center gap-1"><Clock size={11} /> {fmtDate(ev.startDate)}</span>}
                    {ev.isOnline ? (
                      <span className="flex items-center gap-1"><Globe size={11} /> Online</span>
                    ) : ev.location ? (
                      <span className="flex items-center gap-1"><MapPin size={11} /> {ev.location}</span>
                    ) : null}
                    {/*
                      THE-345 - the founder's screenshot, and the exact pixel he
                      photographed. `eventPriceLabel` returns null while no rail
                      exists and this span does not render at all: "$50" is the
                      lie being fixed, and "Free" would be a different one, since
                      the church did not decide the conference was free.
                    */}
                    {eventPriceLabel(ev.price) && (
                      <span className={ev.price > 0 ? 'font-semibold text-muted' : 'font-semibold text-field-600'}>{eventPriceLabel(ev.price)}</span>
                    )}
                  </div>
                  {ev.registrationEnabled && <div className="text-xs font-semibold text-gold mt-2">Registration open</div>}
                  <div className="flex items-center gap-1 mt-3 pt-2.5 border-t border-line">
                    <button onClick={e => { e.stopPropagation(); togglePin(ev); }} className="p-1.5 rounded-lg hover:bg-wheat-50 transition-colors" title={ev.pinned ? 'Unpin from feed' : 'Pin to feed'}>
                      <Pin size={13} className={ev.pinned ? 'text-wheat-500 fill-wheat-500' : 'text-faint'} />
                    </button>
                    <button onClick={e => { e.stopPropagation(); openEdit(ev); }} className="p-1.5 rounded-lg hover:bg-surface-sunken transition-colors">
                      <Edit2 size={13} className="text-faint" />
                    </button>
                    <button onClick={e => { e.stopPropagation(); setDeleteId(ev.id); }} className="p-1.5 rounded-lg hover:bg-red-50 transition-colors ml-auto">
                      <Trash2 size={13} className="text-red-400" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Desktop card — existing approved layout, unchanged (now lg-only). */}
              <div
                className="hidden lg:block bg-surface-raised rounded-2xl p-4 border border-line shadow-xs cursor-pointer hover:border-[color-mix(in_srgb,var(--brand-color)_30%,transparent)] transition-all"
                onClick={() => openDetail(ev)}
            >
              {ev.coverImage && (
                <div className="w-full h-32 rounded-xl overflow-hidden mb-3">
                  <img src={ev.coverImage} alt={ev.title} className="w-full h-full object-cover" />
                </div>
              )}
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-display text-lg font-medium text-strong truncate">{ev.title}</h3>
                    <AdminBadge tone={statusTone(ev.status)}>{ev.status}</AdminBadge>
                    {ev.registrationEnabled && <AdminBadge tone="sky">Registration</AdminBadge>}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
                    {ev.startDate && (
                      <span className="flex items-center gap-1 text-xs text-muted">
                        <Clock size={11} /> {fmtDate(ev.startDate)}
                      </span>
                    )}
                    {ev.isOnline ? (
                      <span className="flex items-center gap-1 text-xs text-muted">
                        <Globe size={11} /> Online
                      </span>
                    ) : ev.location ? (
                      <span className="flex items-center gap-1 text-xs text-muted">
                        <MapPin size={11} /> {ev.location}
                      </span>
                    ) : null}
                    {/* THE-345 - same quote, same gate, on the lg card. */}
                    {eventPriceLabel(ev.price) && (
                      <span className="flex items-center gap-1 text-xs text-muted">
                        <DollarSign size={11} /> {eventPriceLabel(ev.price)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={e => { e.stopPropagation(); togglePin(ev); }}
                    className="p-2 rounded-xl hover:bg-wheat-50 transition-colors"
                    title={ev.pinned ? 'Unpin from feed' : 'Pin to feed'}
                  >
                    <Pin size={14} className={ev.pinned ? 'text-wheat-500 fill-wheat-500' : 'text-faint'} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); openEdit(ev); }}
                    className="p-2 rounded-xl hover:bg-surface-sunken transition-colors">
                    <Edit2 size={14} className="text-faint" />
                  </button>
                  <button onClick={e => { e.stopPropagation(); setDeleteId(ev.id); }}
                    className="p-2 rounded-xl hover:bg-red-50 transition-colors">
                    <Trash2 size={14} className="text-red-400" />
                  </button>
                </div>
              </div>
            </div>
            </React.Fragment>
          ))}
        </div>
      )}
        </TabsContent>
      </Tabs>

      {deleteId && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-surface-raised rounded-2xl p-6 w-full max-w-sm text-center">
            <p className="font-bold text-strong mb-2 font-display">Delete this event?</p>
            <p className="text-sm text-muted mb-5">Registrations will not be deleted automatically.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteId(null)} className="flex-1 py-2.5 rounded-xl border border-line text-sm font-semibold text-muted">Cancel</button>
              <button onClick={confirmDelete} className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminEvents;
