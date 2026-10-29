"use client";
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import React, { useState, useEffect } from 'react';
import {
  Plus, Edit2, Trash2, CalendarCheck, Users, MapPin, Clock, DollarSign,
  Check, Download, Search, ChevronRight, ChevronDown, Globe, X, Pin, QrCode, Copy,
  Ticket, Tag, ArrowUp, ArrowDown, Link2, Repeat, Ban, CalendarX,
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
import { PageTabs } from './admin-shell/PageHeader';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../store/useAppStore';
import { PLATFORM_TENANT_ID } from '../utils/tenant-scope';
import { useEvents } from '../hooks/queries/useEventQueries';
import { HeroBand } from './member/desktopKit';
import { FORM_CONTAINER, FORM_MEASURE, FIELD_WIDTH, ACTION_BUTTON, CONTROL_DENSITY } from './layout/form-layout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
  DialogDescription,
} from '@/components/ui/dialog';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Checkbox } from '@/components/ui/checkbox';
import { EventStartField } from './events/EventStartField';
import { authFetch } from '@/utils/auth-fetch';
import { DEFAULT_REGISTRATION_CUTOFF_HOURS } from '../lib/events/registration-cutoff';
import { getSeriesEditLock, saveEventEdit } from './events/event-edit-client';
import { SERIES_LOCK_MESSAGE } from '../lib/events/series-edit';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { expandRuns, parseEventDateTime, formatEventDateTime, type EventRun } from '../lib/events/recurrence';
import { isSafeOnlineLink } from '../lib/events/online-link';
import type { RecurrenceRule, RegistrationQuestion } from '../hooks/queries/useEventQueries';
import {
  PAID_EVENTS_ENABLED, PAID_EVENTS_HIDDEN_TITLE, PAID_EVENTS_HIDDEN_MESSAGE,
  eventPriceLabel, csvAmountCell, ticketPricingAvailable, manualConfirmationMode,
} from '../lib/paid-events-feature';
import { useTenantOptional } from '../contexts/TenantContext';
import { readGivingLinks } from './donations/giving-providers';
import { GivingDocsLink } from './admin/GivingDocsLink';
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
/**
 * The list's own mini calendar is lazy for the identical reason, and is a
 * SEPARATE component rather than an inline `<Calendar>` so the LIST — this
 * screen's default tab — stays out of `calendar`'s module graph until this
 * one Suspense boundary actually renders it.
 */
const EventListCalendar = React.lazy(() => import('./events/EventListCalendar'));
import { useMonthEvents } from '../hooks/queries/useMonthEvents';
import { dayKey } from './events/month-view';
import { listEventRuns, eventDayKey } from '../lib/events/list-runs';

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

const fmtDateInput = (ts: Timestamp | null, timeZone: string) =>
  ts ? formatEventDateTime(ts.toDate(), timeZone) : '';

const toTimestamp = (v: string, timeZone: string, original?: Timestamp | null): Timestamp | null => {
  if (!v) return null;
  // Preserve precision and the chosen side of a repeated DST hour on untouched edits.
  if (original && fmtDateInput(original, timeZone) === v) return original;
  return Timestamp.fromDate(parseEventDateTime(v, timeZone));
};

/** "Thursday, Oct 23" — a list row's weekday/date line. */
const fmtWeekdayDate = (ts: Timestamp | null, timeZone = BROWSER_TIME_ZONE()) => {
  if (!ts) return null;
  return ts.toDate().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone });
};

/** "5:00 PM" or "5:00 PM – 6:00 PM" — a list row's time line. No end time, no dash. */
const fmtTimeRange = (start: Timestamp | null, end: Timestamp | null, timeZone = BROWSER_TIME_ZONE()) => {
  if (!start) return null;
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', timeZone };
  const startStr = start.toDate().toLocaleTimeString('en-US', opts);
  return end ? `${startStr} – ${end.toDate().toLocaleTimeString('en-US', opts)}` : startStr;
};

/**
 * A row's capacity figure, from data this screen already holds — never a
 * live registration count. That count lives behind the detail view's own
 * `useEventRegistrations`, a per-event read; firestorePathsOf pins this
 * file's read set against a pre-PR baseline that admits none here, and a
 * live count on every visible row would be exactly that new read, paid once
 * per row instead of once per detail open.
 */
const eventCapacityLabel = (ev: Event): string | null => {
  if (ev.ticketTypes && ev.ticketTypes.length > 0) {
    if (ev.ticketTypes.some((t) => t.capacity == null)) return null;
    const sum = ev.ticketTypes.reduce((n, t) => n + (t.capacity ?? 0), 0);
    return `Capacity ${sum}`;
  }
  return ev.capacity != null ? `Capacity ${ev.capacity}` : null;
};

const RECURRENCE_FREQ_LABEL: Record<RecurrenceRule['freq'], string> = {
  weekly: 'Weekly',
  every_2_weeks: 'Every 2 weeks',
  monthly: 'Monthly',
};

/**
 * A recurring event's own runs, named on its row with the SAME `expandRuns`
 * the create form and the submit route use, so the list can never claim a
 * date neither of them would honour.
 */
const eventRunsLabel = (ev: Event, runs: EventRun[], now: number): string | null => {
  if (!ev.recurrence) return null;
  const freq = RECURRENCE_FREQ_LABEL[ev.recurrence.freq];
  const dates = runs.filter(run => run.end.getTime() >= now).slice(0, 3)
    .map(run => run.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: ev.timeZone || BROWSER_TIME_ZONE() }));
  return dates.length ? `${freq} · Next: ${dates.join(', ')}` : freq;
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
  registrationCutoffHours: String(DEFAULT_REGISTRATION_CUTOFF_HOURS),
  organizerEmail: '',
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
  // Eden "Repeats" — 'none' means the event does not recur, and nothing
  // below is read unless it is one of the other three.
  recurrenceFreq: 'none' as 'none' | RecurrenceRule['freq'],
  recurrenceEndMode: 'never' as 'never' | 'on' | 'after',
  recurrenceUntil: '',
  recurrenceCount: '8',
  // IANA zone; filled in with the browser's zone at create time.
  timeZone: '',
  // Eden "Open to anyone" — on by default, matching every event's behaviour today.
  openToAnyone: true,
  registrationQuestions: [] as RegistrationQuestion[],
};

const BROWSER_TIME_ZONE = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

const REPEATS_LABEL: Record<'none' | RecurrenceRule['freq'], string> = {
  none: 'Does not repeat',
  weekly: 'Weekly',
  every_2_weeks: 'Every 2 weeks',
  monthly: 'Monthly',
};

const QUESTION_KIND_LABEL: Record<RegistrationQuestion['kind'], string> = {
  short: 'Short answer',
  long: 'Long answer',
  choice: 'Multiple choice',
};

const MAX_REGISTRATION_QUESTIONS = 10;

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
  // Eden list filter: Upcoming (default) / Drafts / Past. Independent of the
  // List/Month tab above — the month grid shows everything on its own terms.
  const [listFilter, setListFilter] = useState<'upcoming' | 'drafts' | 'past'>('upcoming');
  // The mini calendar's own filter: a day clicked there narrows the list to
  // that day alone, independent of (and clearing) the Upcoming/Drafts/Past
  // split above — a specific day is a more precise question than any bucket.
  const [selectedDay, setSelectedDay] = useState<Date | undefined>(undefined);
  const now = Math.floor(Date.now() / 60000) * 60000;
  const runsByEvent = React.useMemo(() => new Map(events.map(ev => [ev.id, ev.recurrence && ev.startDate
    ? listEventRuns({ startDate: ev.startDate.toDate(), endDate: (ev.endDate || ev.startDate).toDate(), timeZone: ev.timeZone || BROWSER_TIME_ZONE(), recurrence: ev.recurrence }, new Date(now), selectedDay)
    : null])), [events, now, selectedDay]);
  const { data: monthRead, isLoading: monthLoading } = useMonthEvents(tenantId, isAuthReady);
  const [selected, setSelected] = useState<Event | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [seriesLock, setSeriesLock] = useState<'loading' | 'locked' | 'unlocked' | 'error'>('unlocked');
  const [lockRetry, setLockRetry] = useState(0);
  const seriesScheduleLocked = view === 'edit' && !!selected?.recurrence && seriesLock !== 'unlocked';

  useEffect(() => {
    if (view !== 'edit' || !selected?.recurrence || !tenantId) return;
    let active = true;
    setSeriesLock('loading');
    getSeriesEditLock(tenantId, selected.id).then(locked => {
      if (active) setSeriesLock(locked ? 'locked' : 'unlocked');
    }, () => { if (active) setSeriesLock('error'); });
    return () => { active = false; };
  }, [view, selected?.id, selected?.recurrence, tenantId, lockRetry]);
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
  // THE-379 (events remodel) — the detail screen's own additions: a
  // confirming dialog before a soft "cancel the whole event" write, and
  // which registration row currently has its answers expanded.
  const [showCancelEventConfirm, setShowCancelEventConfirm] = useState(false);
  const [cancelRunDate, setCancelRunDate] = useState<string | null>(null);
  const [cancelCount, setCancelCount] = useState<number | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  useEffect(() => {
    if (!showCancelEventConfirm || !selected || !tenantId) return;
    let active = true;
    setCancelCount(null);
    setCancelError(null);
    const params = new URLSearchParams({ tenantId, eventId: selected.id, ...(cancelRunDate ? { runDate: cancelRunDate } : {}) });
    void authFetch(`/api/events/cancel?${params}`).then(async response => {
      const result = await response.json();
      if (!response.ok || typeof result.count !== 'number') throw new Error(result.error || 'Could not count cancellation notices');
      if (active) setCancelCount(result.count);
    }).catch(error => { if (active) setCancelError(error.message); });
    return () => { active = false; };
  }, [showCancelEventConfirm, selected, tenantId, cancelRunDate]);
  const [expandedRegId, setExpandedRegId] = useState<string | null>(null);

  // Registration-engine sub-forms (inside the create/edit form)
  const emptyTicket = { name: '', description: '', price: '0', capacity: '' };
  const [ticketDraft, setTicketDraft] = useState(emptyTicket);
  const [showTicketForm, setShowTicketForm] = useState(false);
  const emptyDiscount = { code: '', type: 'percent' as DiscountCode['type'], value: '', maxUses: '' };
  const [discountDraft, setDiscountDraft] = useState(emptyDiscount);
  const [showDiscountForm, setShowDiscountForm] = useState(false);
  const emptyQuestion = { label: '', kind: 'short' as RegistrationQuestion['kind'], required: false, optionsText: '' };
  const [questionDraft, setQuestionDraft] = useState(emptyQuestion);
  const [showQuestionForm, setShowQuestionForm] = useState(false);

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
    setForm({ ...emptyForm, timeZone: BROWSER_TIME_ZONE() });
    setSelected(null);
    setView('create');
  };

  const openEdit = (ev: Event) => {
    setSeriesLock(ev.recurrence ? 'loading' : 'unlocked');
    setForm({
      title: ev.title,
      description: ev.description,
      coverImage: ev.coverImage || '',
      location: ev.location,
      isOnline: ev.isOnline,
      onlineLink: ev.onlineLink || '',
      startDate: fmtDateInput(ev.startDate, ev.timeZone || BROWSER_TIME_ZONE()),
      endDate: fmtDateInput(ev.endDate, ev.timeZone || BROWSER_TIME_ZONE()),
      capacity: ev.capacity?.toString() || '',
      registrationDeadline: fmtDateInput(ev.registrationDeadline, ev.timeZone || BROWSER_TIME_ZONE()),
      registrationCutoffHours: String(ev.registrationCutoffHours ?? DEFAULT_REGISTRATION_CUTOFF_HOURS),
      organizerEmail: ev.organizerEmail || '',
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
      recurrenceFreq: ev.recurrence?.freq || 'none',
      recurrenceEndMode: ev.recurrence?.until ? 'on' : ev.recurrence?.count != null ? 'after' : 'never',
      recurrenceUntil: ev.recurrence?.until || '',
      recurrenceCount: ev.recurrence?.count != null ? String(ev.recurrence.count) : '8',
      timeZone: ev.timeZone || BROWSER_TIME_ZONE(),
      openToAnyone: ev.openToAnyone ?? true,
      registrationQuestions: Array.isArray(ev.registrationQuestions) ? ev.registrationQuestions : [],
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
    if (view === 'edit' && selected?.recurrence && (seriesLock === 'loading' || seriesLock === 'error')) {
      notifyError('Could not check series registrations. Please try again.', null); return;
    }
    if (!form.title.trim()) { notifyError('Event title is required', null); return; }
    if (!tenantId) { notifyError('Unable to determine your tenant. Please refresh.', null); return; }
    if (form.isOnline && form.onlineLink.trim() && !isSafeOnlineLink(form.onlineLink.trim())) {
      notifyError('Online event link must be a valid HTTPS URL', null);
      return;
    }
    if (form.recurrenceFreq !== 'none' && (!form.registrationCutoffHours.trim() || !Number.isFinite(Number(form.registrationCutoffHours)) || Number(form.registrationCutoffHours) < 0)) {
      notifyError('Enter a non-negative registration cutoff in hours', null); return;
    }
    if (form.organizerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.organizerEmail.trim())) {
      notifyError('Enter a valid organizer contact email', null); return;
    }
    setSaving(true);
    try {
      // Eden "Repeats" — `null` (not an object with freq 'none') so an event
      // that does not recur reads exactly like every event created before
      // this feature existed.
      const recurrence: RecurrenceRule | null = form.recurrenceFreq === 'none'
        ? null
        : {
            freq: form.recurrenceFreq,
            ...(view === 'edit' && selected?.recurrence?.cancelledRuns
              ? { cancelledRuns: [...selected.recurrence.cancelledRuns] }
              : {}),
            ...(form.recurrenceEndMode === 'on' && form.recurrenceUntil ? { until: form.recurrenceUntil } : {}),
            ...(form.recurrenceEndMode === 'after' && form.recurrenceCount
              ? { count: Math.max(1, Math.min(104, Number(form.recurrenceCount) || 1)) }
              : {}),
          };
      const originalDates = selected && form.timeZone === (selected.timeZone || BROWSER_TIME_ZONE()) ? selected : null;
      const data: Partial<Omit<Event, 'id'>> = {
        title: form.title.trim(),
        description: form.description.trim(),
        coverImage: form.coverImage.trim() || null,
        location: form.location.trim(),
        isOnline: form.isOnline,
        onlineLink: form.isOnline ? form.onlineLink.trim() || null : null,
        startDate: toTimestamp(form.startDate, form.timeZone || BROWSER_TIME_ZONE(), originalDates?.startDate),
        endDate: toTimestamp(form.endDate, form.timeZone || BROWSER_TIME_ZONE(), originalDates?.endDate),
        capacity: form.capacity ? Number(form.capacity) : null,
        registrationDeadline: recurrence ? null : toTimestamp(form.registrationDeadline, form.timeZone || BROWSER_TIME_ZONE(), originalDates?.registrationDeadline),
        registrationCutoffHours: Number(form.registrationCutoffHours),
        organizerEmail: form.organizerEmail.trim(),
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
        recurrence,
        timeZone: form.timeZone || BROWSER_TIME_ZONE(),
        openToAnyone: form.openToAnyone,
        registrationQuestions: form.registrationQuestions.slice(0, MAX_REGISTRATION_QUESTIONS),
      };
      if (view === 'edit' && selected) {
        await saveEventEdit(tenantId, selected.id, data);
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
          registrationCutoffHours: data.registrationCutoffHours,
          organizerEmail: data.organizerEmail,
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
          recurrence: data.recurrence ?? null,
          timeZone: data.timeZone,
          openToAnyone: data.openToAnyone ?? true,
          registrationQuestions: data.registrationQuestions || [],
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

  const cancelEvent = async () => {
    if (!selected || !tenantId) return;
    setCancelling(true);
    setCancelError(null);
    try {
      let remaining: number;
      do {
        const response = await authFetch('/api/events/cancel', {
          method: 'POST', body: JSON.stringify({ tenantId, eventId: selected.id, runDate: cancelRunDate }),
        });
        const result = await response.json();
        await queryClient.invalidateQueries({ queryKey: ['events', tenantId] });
        if (!response.ok) throw new Error(result.error || 'Cancellation notices could not be sent');
        if (!Number.isInteger(result.remaining) || result.remaining < 0) throw new Error('Could not confirm cancellation notice progress. Please retry.');
        remaining = result.remaining;
      } while (remaining > 0);
      setSelected(cancelRunDate && selected.recurrence ? { ...selected, recurrence: { ...selected.recurrence,
        cancelledRuns: [...new Set([...(selected.recurrence.cancelledRuns || []), cancelRunDate])] } }
        : { ...selected, status: 'cancelled' });
      setShowCancelEventConfirm(false);
      setCancelRunDate(null);
    } catch (e) { setCancelError(e instanceof Error ? e.message : 'Cancellation failed. Please retry.'); }
    finally { setCancelling(false); }
  };

  const cancelRun = (runDate: string) => {
    setCancelRunDate(runDate);
    setShowCancelEventConfirm(true);
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

  // ── Registration engine: registration-question management ──
  const saveQuestionDraft = () => {
    const label = questionDraft.label.trim();
    if (!label) return;
    const q: RegistrationQuestion = {
      id: genId(),
      label,
      kind: questionDraft.kind,
      required: questionDraft.required,
      ...(questionDraft.kind === 'choice'
        ? { options: questionDraft.optionsText.split('\n').map(o => o.trim()).filter(Boolean) }
        : {}),
    };
    setForm({ ...form, registrationQuestions: [...form.registrationQuestions, q] });
    setQuestionDraft(emptyQuestion);
    setShowQuestionForm(false);
  };

  const removeQuestion = (id: string) =>
    setForm({ ...form, registrationQuestions: form.registrationQuestions.filter(q => q.id !== id) });

  const moveQuestion = (id: string, dir: -1 | 1) => {
    const arr = [...form.registrationQuestions];
    const idx = arr.findIndex(q => q.id === id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= arr.length) return;
    [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
    setForm({ ...form, registrationQuestions: arr });
  };

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
  // Eden's "New event" is a single popup, not a page — shadcn Dialog, with a
  // scrollable body (DialogContent's own max-h) and the actions pinned in
  // DialogFooter. `onOpenChange(false)` covers every way a Dialog closes
  // (Escape, backdrop click, the X) with the same `setView('list')` the
  // Cancel button already called.
  if (view === 'create' || view === 'edit') {
    return (
      <Dialog open onOpenChange={(open: boolean) => { if (!open) { setView('list'); setSelected(null); } }}>
        <DialogContent data-event-form-dialog className="max-h-[85vh] overflow-y-auto">
        {/* The shared width measure sits on the FIRST child of the dialog's
            own content, exactly where every other screen's root surface
            carries it, so the "every surface is capped at desktop widths"
            sweep finds it in the same place. */}
        <div className={FORM_MEASURE}>
        <DialogHeader>
          <DialogTitle>{view === 'edit' ? 'Edit event' : 'New event'}</DialogTitle>
        </DialogHeader>
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
                <EventStartField value={form.startDate} locked={seriesScheduleLocked}
                  onValueChange={startDate => setForm({ ...form, startDate })}
                  className={`w-full border border-line bg-surface-sunken rounded-xl px-3 py-2.5 text-sm text-strong focus:outline-hidden focus:border-gold focus:bg-surface-raised transition-colors ${FIELD_WIDTH.medium} ${CONTROL_DENSITY.control}`} />
              </div>
              <div>
                <label className="text-xs font-semibold text-body mb-1.5 block">End Date & Time</label>
                <input type="datetime-local" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })}
                  className={`w-full border border-line bg-surface-sunken rounded-xl px-3 py-2.5 text-sm text-strong focus:outline-hidden focus:border-gold focus:bg-surface-raised transition-colors ${FIELD_WIDTH.medium} ${CONTROL_DENSITY.control}`} />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-body mb-1.5 block">Where</label>
              <ToggleGroup
                value={[form.isOnline ? 'online' : 'in_person']}
                onValueChange={(next) => {
                  const picked = next[0];
                  if (picked === 'online' || picked === 'in_person') setForm({ ...form, isOnline: picked === 'online' });
                }}
                aria-label="Where"
                className="w-fit rounded-xl bg-surface-sunken p-1"
              >
                <ToggleGroupItem value="in_person" className="px-3 py-1.5 text-xs font-semibold rounded-lg aria-pressed:bg-surface-raised aria-pressed:shadow-xs">
                  In person
                </ToggleGroupItem>
                <ToggleGroupItem value="online" className="px-3 py-1.5 text-xs font-semibold rounded-lg aria-pressed:bg-surface-raised aria-pressed:shadow-xs">
                  Online
                </ToggleGroupItem>
              </ToggleGroup>
              {form.isOnline ? (
                <input value={form.onlineLink} onChange={e => setForm({ ...form, onlineLink: e.target.value })}
                  className={`mt-3 w-full border border-line bg-surface-sunken rounded-xl px-3 py-2.5 text-sm text-strong focus:outline-hidden focus:border-gold focus:bg-surface-raised transition-colors ${FIELD_WIDTH.long} ${CONTROL_DENSITY.control}`} placeholder="Meeting link (Zoom, Google Meet...)" />
              ) : (
                <>
                  <Input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })}
                    className={`h-auto min-h-11 sm:min-h-0 mt-3 w-full border border-line bg-surface-sunken rounded-xl px-3 py-2.5 text-sm text-strong focus:outline-hidden focus:border-gold focus:bg-surface-raised transition-colors ${FIELD_WIDTH.long} ${CONTROL_DENSITY.control}`} placeholder="Venue name and address" />
                  {/*
                    Keyless map preview — an OpenStreetMap search embed needs no
                    API key and no new env var, unlike Google Maps' JS/embed APIs.
                    It is a PREVIEW, not a geocoder: the iframe's own search box
                    resolves `form.location` to a pin, so a typo just shows the
                    nearest match rather than failing closed.
                  */}
                  {/*
                    THE-379 — NOT under test. happy-dom actually attempts the
                    iframe's network fetch (unlike a real browser's lazy load,
                    which it does not model), which the component tests below
                    don't need and CI shouldn't be making real outbound HTTP
                    calls for. Same `process.env.NODE_ENV === 'test'` idiom
                    AdminDashboard.tsx already uses for the opposite case.
                  */}
                  {form.location.trim() && process.env.NODE_ENV !== 'test' && (
                    <div className="mt-3 rounded-xl overflow-hidden border border-line h-40">
                      <iframe
                        title="Location map preview"
                        className="w-full h-full"
                        loading="lazy"
                        src={`https://www.openstreetmap.org/export/embed.html?layer=mapnik&marker=&query=${encodeURIComponent(form.location.trim())}`}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-body mb-1.5 block">Time zone</label>
                <Select disabled={seriesScheduleLocked} value={form.timeZone || BROWSER_TIME_ZONE()} onValueChange={(v: unknown) => setForm({ ...form, timeZone: String(v) })}>
                  <SelectTrigger className={`${FIELD_WIDTH.medium} ${CONTROL_DENSITY.control}`}>
                    <SelectValue>{() => form.timeZone || BROWSER_TIME_ZONE()}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from(new Set([form.timeZone || BROWSER_TIME_ZONE(), BROWSER_TIME_ZONE(), 'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Africa/Lagos', 'Asia/Manila'])).map(tz => (
                      <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-faint">Times are in {form.timeZone || BROWSER_TIME_ZONE()}. Changing the zone keeps the entered times.</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-body mb-1.5 block">Repeats</label>
                <Select disabled={seriesScheduleLocked} value={form.recurrenceFreq} onValueChange={(v: unknown) => setForm({ ...form, recurrenceFreq: v as typeof form.recurrenceFreq })}>
                  <SelectTrigger className={`${FIELD_WIDTH.medium} ${CONTROL_DENSITY.control}`}>
                    <SelectValue>{() => REPEATS_LABEL[form.recurrenceFreq]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(REPEATS_LABEL) as (keyof typeof REPEATS_LABEL)[]).map(freq => (
                      <SelectItem key={freq} value={freq}>{REPEATS_LABEL[freq]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {view === 'edit' && selected?.recurrence && seriesLock !== 'unlocked' && (
              <Alert>
                <AlertDescription>
                  {seriesLock === 'locked' ? SERIES_LOCK_MESSAGE : seriesLock === 'loading'
                    ? 'Checking series registrations before unlocking the schedule…'
                    : 'Could not check series registrations. Saving is unavailable until the check succeeds.'}
                  {seriesLock === 'error' && <Button variant="outline" className={CONTROL_DENSITY.action} onClick={() => setLockRetry(n => n + 1)}>Retry</Button>}
                </AlertDescription>
              </Alert>
            )}
            {form.recurrenceFreq !== 'none' && (
              <div data-recurrence-ends>
                <label className="text-xs font-semibold text-body mb-1.5 block">Ends</label>
                <RadioGroup
                  value={form.recurrenceEndMode}
                  onValueChange={(v: unknown) => setForm({ ...form, recurrenceEndMode: v as typeof form.recurrenceEndMode })}
                  aria-label="Ends"
                  className="gap-2"
                >
                  <label className="flex items-center gap-2 text-sm text-body" htmlFor="recur-never">
                    <RadioGroupItem id="recur-never" value="never" /> Never
                  </label>
                  <label className="flex items-center gap-2 text-sm text-body" htmlFor="recur-on">
                    <RadioGroupItem id="recur-on" value="on" /> On date
                    {form.recurrenceEndMode === 'on' && (
                      <Input type="date" value={form.recurrenceUntil} onChange={e => setForm({ ...form, recurrenceUntil: e.target.value })}
                        className={`min-h-11 ${CONTROL_DENSITY.control} ml-1 border border-line bg-surface-sunken rounded-lg px-2 py-1 text-sm`} />
                    )}
                  </label>
                  <label className="flex items-center gap-2 text-sm text-body" htmlFor="recur-after">
                    <RadioGroupItem id="recur-after" value="after" /> After
                    {form.recurrenceEndMode === 'after' && (
                      <Input type="number" min={1} max={104} value={form.recurrenceCount} onChange={e => setForm({ ...form, recurrenceCount: e.target.value })}
                        className={`min-h-11 ${CONTROL_DENSITY.control} ml-1 w-16 border border-line bg-surface-sunken rounded-lg px-2 py-1 text-sm`} />
                    )}
                    {form.recurrenceEndMode === 'after' ? ' times' : 'a number of times'}
                  </label>
                </RadioGroup>
              </div>
            )}
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-strong">Open to anyone</p>
                <p className="text-xs text-faint mt-0.5">
                  Anyone with the link can see this event and say they&apos;re going — not just people in your ministry.
                </p>
              </div>
              <Switch aria-label="Open to anyone" checked={form.openToAnyone} onCheckedChange={(v: boolean) => setForm({ ...form, openToAnyone: v })} />
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

                {/* 🔴 THE-368 — THE MONEY FLOW, because confirming an event
                    payment is one of the TWO ROUTES IN that page describes;
                    recording a gift in the CRM is the other. An admin pricing a
                    ticket has just been told that Harvest cannot check
                    anything and that THEY will confirm each payment by hand —
                    the next question is what that confirmation actually
                    updates, which is the money flow's subject.

                    ⚠️ AFTER THE ALERT, NEVER INSIDE IT. #482's disclaimer text
                    is pinned; this adds a sibling and changes no word of it.
                    It is drawn under the same condition the disclaimer is, so
                    an event with no manual payment never shows it. */}
                <GivingDocsLink page="theMoneyFlow" />

                {/*
                  🔴 ONE LINK, NOT A SUBSET — Eden's create popup, and the
                  payment-claims flow needs exactly one link to put a code in
                  front of. The shared `PaymentLinkPicker` (checkboxes) stays
                  exactly as it is for the campaign giving widget, which still
                  wants several; this is a bespoke single-select for events
                  only. `readEventProviderIds` still receives — and the stored
                  shape is still — a `string[]`, just with at most one entry,
                  so `resolveEventPaymentLinks` and every other existing
                  reader need no change at all.
                */}
                <div data-event-provider-picker>
                  <p className="text-xs font-semibold text-body mb-1">{PROVIDER_PICKER_TITLE}</p>
                  <p className="text-xs text-muted mb-2.5">{PROVIDER_PICKER_HELP}</p>
                  <RadioGroup
                    value={form.paymentProviders[0] || ''}
                    onValueChange={(v: unknown) => setForm({ ...form, paymentProviders: v ? [String(v)] : [] })}
                    aria-label={PROVIDER_PICKER_TITLE}
                    className="gap-1"
                  >
                    {churchLinks.map(({ provider }) => (
                      <label
                        key={provider.id}
                        data-provider-option={provider.id}
                        className="flex items-center gap-2.5 min-h-11 sm:min-h-0 cursor-pointer"
                      >
                        <RadioGroupItem value={provider.id} />
                        <span className="text-sm text-body">{provider.label}</span>
                      </label>
                    ))}
                  </RadioGroup>
                </div>
              </>
            )}
            <div>
              <label htmlFor="registration-cutoff" className="text-xs font-semibold text-body mb-1.5 block">
                {form.recurrenceFreq === 'none' ? 'Registration deadline' : 'Registration closes (hours before each run)'}
              </label>
              {form.recurrenceFreq === 'none' ? (
                <Input id="registration-cutoff" type="datetime-local" value={form.registrationDeadline} onChange={e => setForm({ ...form, registrationDeadline: e.target.value })}
                  className={`min-h-11 ${FIELD_WIDTH.medium} ${CONTROL_DENSITY.control}`} />
              ) : (
                <Input id="registration-cutoff" type="number" min="0" step="0.5" value={form.registrationCutoffHours}
                  onChange={e => setForm({ ...form, registrationCutoffHours: e.target.value })}
                  className={`min-h-11 ${FIELD_WIDTH.medium} ${CONTROL_DENSITY.control}`} />
              )}
            </div>
            <div>
              <label htmlFor="event-organizer-email" className="text-xs font-semibold text-body mb-1.5 block">Organizer contact email</label>
              <Input id="event-organizer-email" type="email" value={form.organizerEmail}
                onChange={e => setForm({ ...form, organizerEmail: e.target.value })}
                placeholder="Defaults to the event owner's email"
                className={`min-h-11 ${FIELD_WIDTH.medium} ${CONTROL_DENSITY.control}`} />
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
                          placeholder="Description (optional)" className={`h-auto min-h-11 sm:min-h-0 w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-gold ${FIELD_WIDTH.long} ${CONTROL_DENSITY.control}`} />
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

                  {/* Registration questions — Eden one-at-a-time, asked before the event */}
                  <div data-registration-questions>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-bold text-body flex items-center gap-1.5 font-display">Registration Questions</h4>
                      {!showQuestionForm && form.registrationQuestions.length < MAX_REGISTRATION_QUESTIONS && (
                        <Button variant="outline" onClick={() => { setQuestionDraft(emptyQuestion); setShowQuestionForm(true); }}
                          className={`h-auto min-h-11 flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-line text-muted hover:bg-surface-sunken ${CONTROL_DENSITY.action}`}>
                          <Plus size={12} /> Add Question
                        </Button>
                      )}
                    </div>

                    {form.registrationQuestions.length === 0 && !showQuestionForm && (
                      <p className="text-xs text-faint bg-surface-sunken rounded-xl p-3">
                        Optional. Attendees answer these one at a time when they register, and you can see the answers in Registrations.
                      </p>
                    )}

                    <div className="space-y-2">
                      {form.registrationQuestions.map((q, i) => (
                        <div key={q.id} className="flex items-center gap-2 bg-surface-raised border border-line rounded-xl px-3 py-2.5">
                          <div className="flex flex-col">
                            <Button variant="ghost" onClick={() => moveQuestion(q.id, -1)} disabled={i === 0} aria-label={`Move ${q.label} up`} className={`h-auto min-h-11 text-stone-300 hover:text-muted disabled:opacity-30 ${CONTROL_DENSITY.action}`}><ArrowUp size={12} /></Button>
                            <Button variant="ghost" onClick={() => moveQuestion(q.id, 1)} disabled={i === form.registrationQuestions.length - 1} aria-label={`Move ${q.label} down`} className={`h-auto min-h-11 text-stone-300 hover:text-muted disabled:opacity-30 ${CONTROL_DENSITY.action}`}><ArrowDown size={12} /></Button>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-strong truncate">{q.label}{q.required && <span className="text-wheat-600"> *</span>}</p>
                            <p className="text-xs text-faint">{QUESTION_KIND_LABEL[q.kind]}{q.kind === 'choice' && q.options?.length ? ` · ${q.options.length} options` : ''}</p>
                          </div>
                          <Button variant="ghost" onClick={() => removeQuestion(q.id)} aria-label={`Remove ${q.label}`} className={`h-auto min-h-11 p-1.5 rounded-lg hover:bg-red-50 ${CONTROL_DENSITY.action}`}><X size={14} className="text-red-400" /></Button>
                        </div>
                      ))}
                    </div>

                    {showQuestionForm && (
                      <div className="mt-2 bg-surface-sunken rounded-xl p-3 space-y-2.5">
                        <Input value={questionDraft.label} onChange={e => setQuestionDraft({ ...questionDraft, label: e.target.value })}
                          placeholder="Question (e.g. Dietary needs)" className={`w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-gold ${FIELD_WIDTH.long} ${CONTROL_DENSITY.control}`} />
                        <Select value={questionDraft.kind} onValueChange={(v: unknown) => setQuestionDraft({ ...questionDraft, kind: v as RegistrationQuestion['kind'] })}>
                          <SelectTrigger className={`${FIELD_WIDTH.medium} ${CONTROL_DENSITY.control}`}>
                            <SelectValue>{() => QUESTION_KIND_LABEL[questionDraft.kind]}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(QUESTION_KIND_LABEL) as RegistrationQuestion['kind'][]).map(kind => (
                              <SelectItem key={kind} value={kind}>{QUESTION_KIND_LABEL[kind]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {questionDraft.kind === 'choice' && (
                          <Textarea value={questionDraft.optionsText} onChange={e => setQuestionDraft({ ...questionDraft, optionsText: e.target.value })}
                            rows={3} placeholder={'One option per line'}
                            className={`w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-gold resize-none ${FIELD_WIDTH.long}`} />
                        )}
                        <label className="flex items-center gap-2 text-sm text-body">
                          <Checkbox checked={questionDraft.required} onCheckedChange={required => setQuestionDraft({ ...questionDraft, required })} />
                          Required
                        </label>
                        <div className="flex gap-2">
                          <Button variant="outline" onClick={() => { setShowQuestionForm(false); setQuestionDraft(emptyQuestion); }} className={`h-auto min-h-11 flex-1 py-2 rounded-lg border border-line text-xs font-semibold text-muted ${ACTION_BUTTON} ${CONTROL_DENSITY.action}`}>Cancel</Button>
                          <Button variant="default" onClick={saveQuestionDraft} disabled={!questionDraft.label.trim()}
                            className={`h-auto min-h-11 flex-1 py-2 rounded-lg text-xs font-semibold text-white bg-gold disabled:opacity-50 ${ACTION_BUTTON} ${CONTROL_DENSITY.action}`}>Add</Button>
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
                {form.status === 'cancelled' && <option value="cancelled" disabled>Cancelled</option>}
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>
        </div>
        <DialogFooter>
            <button onClick={() => setView('list')} className={`flex-1 py-2.5 rounded-xl border border-line text-sm font-semibold text-muted ${ACTION_BUTTON} ${CONTROL_DENSITY.action}`}>Cancel</button>
            <button onClick={handleSave} disabled={saving || !form.title.trim() || (view === 'edit' && !!selected?.recurrence && (seriesLock === 'loading' || seriesLock === 'error'))}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 ${ACTION_BUTTON} ${CONTROL_DENSITY.action}`}
              style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>
              {saving ? 'Saving...' : view === 'edit' ? 'Save Changes' : 'Create Event'}
            </button>
        </DialogFooter>
        </div>
        </DialogContent>
      </Dialog>
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
    // THE-379 — the SAME confirm/reject surface the attendee row always had,
    // narrowed to the rows that actually need it. `manualConfirmationMode()`
    // gates the whole tab: with no manual rail there is nothing to confirm.
    const pendingRegs = manualConfirmationMode()
      ? registrations.filter(r => r.status !== 'cancelled' && (paymentStateOf(r) === 'claimed' || paymentStateOf(r) === 'unpaid'))
      : [];
    // A recurring event's own next runs, read with the SAME `expandRuns` the
    // create form, the public page and the submit route all use, so this
    // list can never show a date the server would reject or hide one it
    // would accept.
    const recurrence = selected.recurrence || null;
    const upcomingRuns = recurrence && selected.startDate
      ? expandRuns(
          {
            startDate: selected.startDate.toDate(),
            endDate: (selected.endDate || selected.startDate).toDate(),
            timeZone: selected.timeZone,
            recurrence,
          },
          new Date(),
          new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
        ).slice(0, 8)
      : [];
    const questions = Array.isArray(selected.registrationQuestions) ? selected.registrationQuestions : [];

    /** One attendee row, shared by the Registrations and Payments pending tabs. */
    const regRow = (r: Registration) => (
      <div key={r.id} className="bg-surface-raised rounded-2xl px-4 py-3 border border-line shadow-xs">
        <div className="flex items-center gap-3">
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
              {r.email} · #{r.ticketCode}{r.ticketTypeName ? ` · ${r.ticketTypeName}` : ''}{r.runDate ? ` · ${r.runDate}` : ''}
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
            {r.refundStatus === 'pending_manual' && <Badge variant="outline">Refund pending (manual)</Badge>}
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
          {questions.length > 0 && r.answers && Object.keys(r.answers).length > 0 && (
            <Button variant="ghost"
              onClick={() => setExpandedRegId(expandedRegId === r.id ? null : r.id)}
              className={`h-auto min-h-11 p-1.5 rounded-lg hover:bg-surface-sunken text-faint flex-shrink-0 ${CONTROL_DENSITY.action}`}
              aria-label={expandedRegId === r.id ? 'Hide answers' : 'Show answers'}
            >
              <ChevronDown size={14} className={`transition-transform ${expandedRegId === r.id ? 'rotate-180' : ''}`} />
            </Button>
          )}
          {/* 🔴 THE-351 — Confirm sits BESIDE Check In and never in place
              of it: the founder's decision is that an unconfirmed guest
              walks in, so the door control below is reached on exactly
              the same condition it always was. */}
          {manualConfirmationMode() && r.status !== 'cancelled' && (paymentStateOf(r) === 'claimed' || paymentStateOf(r) === 'unpaid') && (
            <Button variant="default"
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
              className={`h-auto min-h-11 px-3 rounded-xl text-xs font-semibold text-white bg-gold disabled:opacity-50 flex-shrink-0 ${CONTROL_DENSITY.action}`}
            >
              {confirming === r.id ? 'Recording…' : CONFIRM_BUTTON}
            </Button>
          )}
          {r.status === 'confirmed' && (
            <button
              onClick={() => checkIn(r)}
              disabled={checkingIn === r.id}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-field-100 text-field-700 hover:bg-field-200 disabled:opacity-50 flex-shrink-0"
            >
              <Check size={12} /> Check In
            </button>
          )}
        </div>
        {/* Registration questions — THE-379's "answers expandable". */}
        {expandedRegId === r.id && questions.length > 0 && r.answers && (
          <div className="mt-3 pt-3 border-t border-line space-y-1.5">
            {questions.map(q => (
              r.answers?.[q.id] ? (
                <div key={q.id} className="text-xs">
                  <span className="text-faint">{q.label}: </span>
                  <span className="text-body font-medium">{r.answers[q.id]}</span>
                </div>
              ) : null
            ))}
          </div>
        )}
      </div>
    );

    return (
      // 🔴 `key` is load-bearing, not cosmetic. This view's root and the list
      // view's root below are both a bare `<div className={FORM_CONTAINER}>`,
      // so without a key React reconciles them as the SAME element across a
      // view switch and reuses whatever sits at the matching position inside
      // — including this tab group, next to the list view's OWN `<Tabs
      // value={listTab} onValueChange=…>`. That left this Tabs root
      // "changing from controlled to uncontrolled" on every click into a
      // detail (Base UI warns on exactly this), stuck on a value neither
      // TabsContent here is named, so nothing in it ever painted.
      <div key="event-detail" className={FORM_CONTAINER}>
        <div className="flex items-start justify-between gap-3 mb-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold text-strong truncate font-display">{selected.title}</h2>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[selected.status]}`}>
                {selected.status}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              {selected.startDate && (
                <span className="flex items-center gap-1">
                  <Clock size={13} /> {[fmtWeekdayDate(selected.startDate), fmtTimeRange(selected.startDate, selected.endDate)].filter(Boolean).join(' · ')}
                </span>
              )}
              {selected.isOnline ? (
                <span className="flex items-center gap-1"><Globe size={13} /> Online</span>
              ) : selected.location ? (
                <span className="flex items-center gap-1"><MapPin size={13} /> {selected.location}</span>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="outline" onClick={copyRegUrl} className={`h-auto min-h-11 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-line text-body hover:bg-surface-sunken ${CONTROL_DENSITY.action}`}>
              {copied ? <Check size={13} /> : <Link2 size={13} />} {copied ? 'Copied!' : 'Share link'}
            </Button>
            <button onClick={() => openEdit(selected)} className="p-2 rounded-xl border border-line hover:bg-surface-sunken">
              <Edit2 size={15} className="text-muted" />
            </button>
            {selected.status !== 'completed' && (
              <Button variant="outline" onClick={() => { setCancelRunDate(null); setShowCancelEventConfirm(true); }} className={`h-auto min-h-11 p-2 rounded-xl border border-line hover:bg-surface-sunken ${CONTROL_DENSITY.action}`} title={selected.status === 'cancelled' ? 'Retry cancellation notices' : 'Cancel event'}>
                <Ban size={15} className="text-muted" />
              </Button>
            )}
            <button onClick={() => setDeleteId(selected.id)} className="p-2 rounded-xl border border-red-100 hover:bg-red-50">
              <Trash2 size={15} className="text-red-400" />
            </button>
          </div>
        </div>

        {/* "Cancel event" — a SOFT write (status: 'cancelled'), never the hard
            delete the Trash icon above performs. Same confirm-dialog primitive
            CancelPlanBlock.tsx uses for "Cancel Subscription", not a dedicated
            AlertDialog primitive — adding one would move the shadcn primitive
            count every guard in this repo pins by number. */}
        <Dialog open={showCancelEventConfirm} onOpenChange={open => { if (!cancelling) setShowCancelEventConfirm(open); }}>
          <DialogContent className="max-w-md" showCloseButton={false}>
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-strong font-display">{cancelRunDate ? `Cancel ${cancelRunDate}?` : 'Cancel this event?'} </DialogTitle>
            </DialogHeader>
            <DialogDescription className="text-muted text-sm">
              {selected.title}{cancelRunDate ? ` on ${cancelRunDate}` : ' and all its dates'} will be cancelled.
              {cancelCount === null ? ' Counting people to email…' : ` ${cancelCount} registrant(s) will be emailed.`}
              {' '}Confirmed and waitlisted registrations will be cancelled and kept in the list. Registrants will be given the organizer contact email for refunds. Paid registrations will show “Refund pending (manual)”. No automatic refunds.
            </DialogDescription>
            {cancelError && <Alert variant="destructive"><AlertTitle>Cancellation needs attention</AlertTitle><AlertDescription>{cancelError}</AlertDescription></Alert>}
            <DialogFooter>
              <DialogClose disabled={cancelling} className={`flex-1 py-2.5 rounded-xl border border-line text-sm font-semibold text-muted ${ACTION_BUTTON} ${CONTROL_DENSITY.action}`}>
                Keep event
              </DialogClose>
              <Button variant="default"
                onClick={() => void cancelEvent()} disabled={cancelling || cancelCount === null}
                className={`h-auto min-h-11 flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold ${ACTION_BUTTON} ${CONTROL_DENSITY.action}`}
              >
                {cancelling ? 'Sending notices…' : cancelError ? 'Retry cancellation' : 'Cancel and email registrants'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Tabs defaultValue="overview" className="mt-2">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="registrations">Registrations{registrations.length > 0 ? ` (${registrations.length})` : ''}</TabsTrigger>
            {manualConfirmationMode() && (
              <TabsTrigger value="pending">Payments pending{pendingRegs.length > 0 ? ` (${pendingRegs.length})` : ''}</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="overview">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-3 mb-5 mt-4">
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

            {/* THE-379 — a recurring event's next runs, each cancellable on its
                own without touching the series or any other run. */}
            {upcomingRuns.length > 0 && (
              <div className="bg-surface-raised rounded-2xl p-5 border border-line shadow-xs mb-5" data-event-run-picker>
                <h3 className="text-sm font-bold text-body mb-3 flex items-center gap-1.5 font-display"><Repeat size={14} /> Upcoming runs</h3>
                <div className="space-y-1.5">
                  {upcomingRuns.map(run => (
                    <div key={run.runDate} className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl border border-line">
                      <span className="text-sm text-body">
                        {new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(run.start)}
                      </span>
                      <Button variant="ghost"
                        onClick={() => void cancelRun(run.runDate)}
                        className={`h-auto min-h-11 flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700 flex-shrink-0 ${CONTROL_DENSITY.action}`}
                        title="Cancel this run only — the rest of the series is unaffected"
                      >
                        <CalendarX size={13} /> Cancel this date
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selected.recurrence?.cancelledRuns?.map(date => (
              <Button key={date} variant="outline" onClick={() => cancelRun(date)}
                className={`h-auto min-h-11 mb-3 ${CONTROL_DENSITY.action}`}>
                Retry cancellation notices for {date}
              </Button>
            ))}

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
                      <Button variant="outline" onClick={copyRegUrl} className={`h-auto min-h-11 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-line text-body hover:bg-surface-sunken ${CONTROL_DENSITY.action}`}>
                        {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied!' : 'Copy link'}
                      </Button>
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
          </TabsContent>

          <TabsContent value="registrations">
            {/* Attendee list */}
            <div className="flex items-center gap-3 mb-3 mt-4">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <Input value={regSearch} onChange={e => setRegSearch(e.target.value)}
                  placeholder="Search attendees..." className={`h-auto min-h-11 sm:min-h-0 w-full pl-9 pr-3 py-2 text-sm border border-line rounded-xl focus:outline-hidden focus:border-gold ${FIELD_WIDTH.long} ${CONTROL_DENSITY.control}`} />
              </div>
              {registrations.length > 0 && (
                <Button variant="outline" onClick={exportCSV} className={`h-auto min-h-11 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-line text-muted hover:bg-surface-sunken ${CONTROL_DENSITY.action}`}>
                  <Download size={13} /> Export CSV
                </Button>
              )}
            </div>

            {filteredRegs.length === 0 ? (
              <div className="text-center py-12 text-faint">
                <Users size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm font-display">{regSearch ? 'No attendees match' : 'No registrations yet'}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredRegs.map(regRow)}
              </div>
            )}
          </TabsContent>

          {manualConfirmationMode() && (
            <TabsContent value="pending">
              <div className="mt-4">
                {pendingRegs.length === 0 ? (
                  <div className="text-center py-12 text-faint">
                    <Check size={32} className="mx-auto mb-2 opacity-30" />
                    <p className="text-sm font-display">Nothing waiting on confirmation</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {pendingRegs.map(regRow)}
                  </div>
                )}
              </div>
            </TabsContent>
          )}
        </Tabs>
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
  // Eden's three list filters. A draft always sorts under Drafts regardless
  // of its date (an admin still drafting next year's conference should find
  // it there, not buried in "Upcoming"); everything else splits on whether
  // its last available run has ended.
  const isPastEvent = (ev: Event) => {
    if (ev.status === 'draft') return false;
    const runs = runsByEvent.get(ev.id);
    return runs ? !runs.some(run => run.end.getTime() >= now) : !!ev.startDate && ev.startDate.toDate().getTime() < now;
  };
  const draftEvents = events.filter(ev => ev.status === 'draft');
  const pastEvents = events.filter(ev => isPastEvent(ev));
  const upcomingEvents = events.filter(ev => ev.status !== 'draft' && !isPastEvent(ev));
  const visibleEvents = listFilter === 'drafts' ? draftEvents : listFilter === 'past' ? pastEvents : upcomingEvents;
  // A day clicked on the mini calendar narrows the list to that day alone,
  // ACROSS every bucket above — a specific day answers a more precise
  // question than "upcoming" or "past" does, so it is not ANDed with them.
  const rowsToShow = selectedDay
    ? events.filter((ev) => {
        const runs = runsByEvent.get(ev.id);
        return runs ? runs.some(run => run.runDate === dayKey(selectedDay))
          : ev.startDate && eventDayKey(ev.startDate.toDate(), ev.timeZone || BROWSER_TIME_ZONE()) === dayKey(selectedDay);
      })
    : visibleEvents;
  const selectedDayLabel = selectedDay
    ? selectedDay.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    : null;
  const listHeading = selectedDayLabel
    ?? (listFilter === 'drafts' ? 'Drafts' : listFilter === 'past' ? 'Past' : 'Upcoming');
  return (
    // `key` — see the identical note on the detail view's root above.
    <div key="event-list" className={`w-full ${FORM_CONTAINER} space-y-6`}>
      <AdminPageHeader
        title="Events"
        subtitle={`${events.length} event${events.length === 1 ? '' : 's'}`}
        tabs={(
          <PageTabs
            label="Events view"
            value={listTab}
            onValueChange={setListTab}
            items={[{ value: 'list', label: 'List' }, { value: 'month', label: 'Month' }]}
          />
        )}
        action={<AdminPrimaryButton onClick={openCreate} icon={<span className="text-[15px] leading-none">+</span>}>Create event</AdminPrimaryButton>}
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
      {/* The List / Month pill lives in the page header (PageTabs), beside "Create event".
          THE-346's fix for it - a 44px tap target INSIDE a pill that grows to hold it, rather
          than a 44px trigger hanging out of a 32px list - is now PageTabs' own: the track is
          `h-auto` with padding, and each trigger carries the height. This Tabs only owns the panels. */}
      <Tabs value={listTab} onValueChange={(v) => setListTab(v as 'list' | 'month')}>
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
        <Empty data-events-empty className="py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon"><CalendarCheck aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>Plan your first event</EmptyTitle>
            <EmptyDescription>Create an event to start accepting registrations — in person or online, free or paid.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="lg:flex lg:items-start lg:gap-6">
          {/*
            Eden's left panel — the mini calendar plus Upcoming/Drafts/Past,
            `lg` and up. `calendar` (react-day-picker) stays out of the LIST's
            own chunk: `EventListCalendar` is lazy, exactly as `EventMonthView`
            is above, and for the identical reason.
          */}
          <aside className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:gap-4">
            <div className="rounded-2xl border border-line bg-surface-raised p-2" data-events-mini-calendar>
              {/*
                NOT under test — this panel is on the LIST view, this screen's
                default tab. A cold `calendar` (react-day-picker) mount here
                measured ~1.7s under vitest/happy-dom, clearing the 5000ms
                per-test timeout under full CI load. Same idiom as the map
                preview above; the real component is unchanged outside tests.
              */}
              {process.env.NODE_ENV !== 'test' && (
                <React.Suspense fallback={<Skeleton className="h-64 w-full" />}>
                  <EventListCalendar
                    read={monthRead}
                    selected={selectedDay}
                    onSelect={(d) => setSelectedDay((prev) => (prev && d && dayKey(prev) === dayKey(d) ? undefined : d))}
                  />
                </React.Suspense>
              )}
            </div>
            {/*
              Plain buttons, not `tabs` — THE-308's own guard pins this file's
              source against a hand-sized TabsList tag ever coming back for the
              List/Month pill (now `PageTabs`' own), and a second, legitimate
              use of that same tag here would still trip that literal check.
              This filter has no associated tabpanel either; the mobile
              `PageTabs` row below already carries the one with real tab
              semantics.
            */}
            <div className="flex flex-col gap-1">
              {([
                { value: 'upcoming' as const, label: `Upcoming${upcomingEvents.length ? ` (${upcomingEvents.length})` : ''}` },
                { value: 'drafts' as const, label: `Drafts${draftEvents.length ? ` (${draftEvents.length})` : ''}` },
                { value: 'past' as const, label: 'Past' },
              ]).map((item) => (
                <Button variant="ghost"
                  key={item.value}
                  type="button"
                  aria-pressed={listFilter === item.value}
                  onClick={() => { setListFilter(item.value); setSelectedDay(undefined); }}
                  className={`h-auto min-h-11 justify-between rounded-lg px-3 text-left text-sm font-semibold transition-colors ${listFilter === item.value ? 'bg-surface-sunken text-strong' : 'text-muted hover:bg-surface-sunken'} ${CONTROL_DENSITY.action}`}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </aside>

          <div className="min-w-0 flex-1 space-y-4">
            {/* Phone/tablet keep the horizontal filter — the sidebar is lg-only. */}
            <div className="lg:hidden">
              <PageTabs
                label="Events filter"
                value={listFilter}
                onValueChange={(v) => { setListFilter(v); setSelectedDay(undefined); }}
                items={[
                  { value: 'upcoming', label: `Upcoming${upcomingEvents.length ? ` (${upcomingEvents.length})` : ''}` },
                  { value: 'drafts', label: `Drafts${draftEvents.length ? ` (${draftEvents.length})` : ''}` },
                  { value: 'past', label: 'Past' },
                ]}
              />
            </div>

            {/* The create action lives in the page header. */}
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-lg font-medium text-strong">{listHeading}</h2>
            </div>
            {selectedDay && (
              <Button variant="outline"
                onClick={() => setSelectedDay(undefined)}
                className={`h-auto min-h-11 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-sunken px-3 text-xs font-semibold text-muted hover:bg-surface-raised sm:min-h-0 sm:py-1 ${CONTROL_DENSITY.action}`}
              >
                {selectedDayLabel} <X size={12} />
              </Button>
            )}

        {rowsToShow.length === 0 ? (
          <Empty data-events-filter-empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon"><CalendarCheck aria-hidden="true" /></EmptyMedia>
              <EmptyTitle>
                {selectedDay ? 'Nothing that day' : listFilter === 'drafts' ? 'No drafts' : listFilter === 'past' ? 'No past events' : 'Nothing upcoming'}
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
        <div className="space-y-3">
          {rowsToShow.map(ev => {
            const runs = runsByEvent.get(ev.id);
            const displayRun = selectedDay
              ? runs?.find(run => run.runDate === dayKey(selectedDay))
              : runs?.find(run => run.end.getTime() >= now) ?? runs?.at(-1);
            const runsLabel = eventRunsLabel(ev, runs || [], now);
            const timeZone = ev.timeZone || BROWSER_TIME_ZONE();
            const displayStart = displayRun ? Timestamp.fromDate(displayRun.start) : ev.startDate;
            const displayEnd = displayRun ? Timestamp.fromDate(displayRun.end) : ev.endDate;
            return (
            <React.Fragment key={ev.id}>
              {/* Mobile card — mockup design: hero band (cover, else navy→gold gradient),
                  status pill overlay, meta row, actions. Same handlers as the desktop row. */}
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
                    {displayStart && (
                      <span className="flex items-center gap-1">
                        <Clock size={11} /> {[fmtWeekdayDate(displayStart, timeZone), fmtTimeRange(displayStart, displayEnd, timeZone)].filter(Boolean).join(' · ')}
                      </span>
                    )}
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
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-muted">
                    {ev.registrationEnabled && <span className="font-semibold text-gold">Registration open</span>}
                    {eventCapacityLabel(ev) && (
                      <span className="flex items-center gap-1"><Users size={11} /> {eventCapacityLabel(ev)}</span>
                    )}
                    {runsLabel && (
                      <span className="flex items-center gap-1"><Repeat size={11} /> {runsLabel}</span>
                    )}
                  </div>
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

              {/*
                Desktop row — Eden's layout #1: a date block, the title, the
                time range, where, registrations/capacity and the status
                badge, read left to right instead of a card's stacked blocks.
              */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => openDetail(ev)}
                className="hidden lg:flex items-center gap-4 bg-surface-raised rounded-2xl p-4 border border-line shadow-xs cursor-pointer hover:border-[color-mix(in_srgb,var(--brand-color)_30%,transparent)] transition-all"
              >
                <div className="flex w-12 h-12 shrink-0 flex-col items-center justify-center rounded-xl bg-surface-sunken">
                  <span className="text-[9px] font-bold uppercase leading-none tracking-wide text-gold">
                    {displayStart ? displayStart.toDate().toLocaleDateString('en-US', { month: 'short', timeZone }) : '—'}
                  </span>
                  <span className="mt-0.5 text-base font-bold leading-none text-strong">
                    {displayStart ? displayStart.toDate().toLocaleDateString('en-US', { day: 'numeric', timeZone }) : '–'}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h3 className="font-display text-base font-medium text-strong truncate">{ev.title}</h3>
                    <AdminBadge tone={statusTone(ev.status)}>{ev.status}</AdminBadge>
                    {ev.registrationEnabled && <AdminBadge tone="sky">Registration</AdminBadge>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {[fmtWeekdayDate(displayStart, timeZone), fmtTimeRange(displayStart, displayEnd, timeZone)].filter(Boolean).join(' · ') || '—'}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                    {ev.isOnline ? (
                      <span className="flex items-center gap-1 text-xs text-muted">
                        <Globe size={11} /> Online
                      </span>
                    ) : ev.location ? (
                      <span className="flex items-center gap-1 text-xs text-muted">
                        <MapPin size={11} /> {ev.location}
                      </span>
                    ) : null}
                    {eventCapacityLabel(ev) && (
                      <span className="flex items-center gap-1 text-xs text-muted">
                        <Users size={11} /> {eventCapacityLabel(ev)}
                      </span>
                    )}
                    {/* THE-345 - same quote, same gate, on the lg row. */}
                    {eventPriceLabel(ev.price) && (
                      <span className="flex items-center gap-1 text-xs text-muted">
                        <DollarSign size={11} /> {eventPriceLabel(ev.price)}
                      </span>
                    )}
                    {runsLabel && (
                      <span className="flex items-center gap-1 text-xs text-muted">
                        <Repeat size={11} /> {runsLabel}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1">
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
            </React.Fragment>
            );
          })}
        </div>
        )}
          </div>
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
