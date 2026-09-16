"use client";
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Search, Edit2, Trash2, Users, Mail, Phone,
  MessageSquare, DollarSign, PhoneCall, Calendar, Clock, ChevronRight, MapPin,
  List, LayoutGrid, Heart, Award, AlertTriangle, Send, Upload, ChevronDown,
  MoreHorizontal
} from 'lucide-react';
import {
  collection, addDoc, deleteDoc, setDoc,
  doc, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { toSafeDate, type DateLike } from '../utils/format-date';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { sortByTime, sortByString } from '../utils/query-helpers';
import { notifyError } from '../utils/notify';
import { authFetch } from '../utils/auth-fetch';
import AdminRoles, { Permission } from './AdminRoles';
import { FORM_CONTAINER, FORM_MEASURE, FIELD_WIDTH, CONTROL_DENSITY } from './layout/form-layout';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { useAdminHeader, HeaderActionButton } from './AdminScreenHeader';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../store/useAppStore';
import {
  useContactsWithUsers, useContactActivities, resolvePipelineStage, useCRMCounts,
  CRM_FETCH_LIMIT,
  type Contact, type ContactActivity, type PipelineStage,
} from '../hooks/queries/useCRMQueries';
import { ANALYTICS_EVENTS } from '../lib/analytics/events';
import { trackProductEvent } from '../lib/analytics/client';
import { PLATFORM_TENANT_ID } from '../utils/tenant-scope';
import { useTenant } from '@/contexts/TenantContext';
import { getEffectiveFeatures, toTenantPlan } from '../utils/plan-features';
import { getIntegrationProvider, isProviderAvailable } from './settings/integration-providers';
import { GMAIL_FEATURE_ENABLED } from '../lib/gmail-feature';
import { GIVING_PROVIDER_NAMES_OR, readGivingLinks } from './donations/giving-providers';
import { GivingDocsLink } from './admin/GivingDocsLink';
import { formatCents } from '../lib/donation-history';
import { dollarsToCents } from '../lib/donation-amount';
import {
  resolveContactLimit, countContactAccounts, isAtContactLimit, contactLimitMessage,
} from '../utils/contact-capacity';
import {
  readCsvTable, mapRows, planImport, chunkForBatches, importSummary, countSkips,
  normalizeEmailKey, columnLabel, hasRequiredMapping,
  IMPORT_FIELDS, IMPORT_FIELD_LABELS, REQUIRED_IMPORT_FIELD,
  type CsvTable, type ColumnMapping, type ImportField, type ImportOutcome,
} from '../utils/csv-import';

const TYPE_LABELS: Record<Contact['type'], string> = {
  donor: 'Donor',
  member: 'Member',
  both: 'Donor & Member',
};

/**
 * The contact `type` union, as VALUES, derived from the label map above.
 *
 * Derived rather than written out again: `TYPE_LABELS` is a
 * `Record<Contact['type'], string>`, so TypeScript forces it to hold every
 * member of the union and nothing else. A second hand-written list here could
 * fall behind the union silently, and the importer would then quietly refuse a
 * type the CRM understands — or, worse, accept one it does not. The union
 * itself is untouched: it is used well beyond this file.
 */
const CONTACT_TYPE_VALUES = Object.keys(TYPE_LABELS) as Contact['type'][];

/**
 * Warm brand tag styles used on the list/detail badges (gold / sky / field-green).
 *
 * THE-136 — every branch is spelled with tokens, because a badge is a SEMANTIC
 * value and the value decides the colour. `member` was always correct; the other
 * two mixed a themeable colour toward a literal `white`, which is a well-formed
 * expression whose result is pinned light in both themes. The surface stayed
 * light while the ink on it inverted, so `both` shipped as #EAF0E2 on #E8EDE3 —
 * 1.02:1, a white pill with invisible text, live on /admin/crm.
 *
 * PR 322 added the UNKNOWN fallback below and computed contrast for it, but the
 * fallback is the branch a real contact almost never takes. Checking it while
 * leaving `donor` and `both` unresolved is why a 1.02:1 pill passed a test.
 *
 * `--surface-gold` is the palette's own token for a gold tint pill; it tracks
 * the contrast-corrected accent on dark and the fixed wheat tint on light, and
 * `--ink-wheat-800` is the gold ink THE-61 added precisely to clear AA on it.
 */
const TYPE_COLORS: Record<Contact['type'], string> = {
  donor: 'bg-surface-gold text-wheat-800',
  member: 'bg-sky-100 text-sky-700',
  both: 'bg-field-100 text-field-700',
};

/**
 * THE-150 — the Type pill for a row whose `type` we cannot read.
 *
 * Both maps above are `Record<Contact['type'], …>`, which is a claim about the
 * TypeScript type, not about the documents. Every row in this list is cast
 * straight off Firestore (`{ id, ...d.data() } as Contact` in useCRMQueries), so
 * a document with no `type` field, or one carrying a value from outside the
 * union, indexes both maps to `undefined` — no class and no text, i.e. the blank
 * grey pill. A bare map lookup on unvalidated data is the bug; the two readers
 * below are the only way the pill is allowed to be rendered.
 *
 * The label is deliberately NOT 'Member'. `emptyContact` below defaults a NEW
 * contact to member, but that is a choice made about a record being created —
 * saying "Member" about a row whose type we could not read would assert
 * something nobody recorded, and it is exactly the kind of unearned claim the
 * derived pipeline stage exists to avoid. "Unspecified" says only what is true:
 * this row does not carry a type we recognise.
 *
 * The fill is `--surface-chip` (the token that exists for opaque pill fills) and
 * `--text-muted`, so it is themed in both light and dark rather than a literal.
 */
const UNKNOWN_TYPE_LABEL = 'Unspecified';
const UNKNOWN_TYPE_COLOR = 'bg-surface-chip text-muted';

/**
 * THE-136 — the gold pills on the contact detail panel ("… total given", the
 * last-gift badge, the activity count).
 *
 * Spelled once rather than three times, for the same reason the badge is a map:
 * the bug this PR fixes is a colour repeated per call site, so a repeated call
 * site is where it comes back. All three sat on the same `color-mix(…, white)`
 * fill the donor badge did and carried `text-gold` on it — 2.39:1 in BOTH
 * themes, and a white pill on the dark card. They are on /admin/crm, the screen
 * the regression was reported against, one row below the badge.
 *
 * Same token pair as TYPE_COLORS.donor above, so the panel reads as one thing.
 */
const GIVING_PILL = 'bg-surface-gold text-wheat-800 text-xs font-semibold px-3 py-1.5 rounded-full';
/** The failed-read variant. red-600 on red-50 is 4.41:1, below AA in light. */
const GIVING_PILL_ERROR = 'bg-red-50 text-red-700 text-xs font-semibold px-3 py-1.5 rounded-full';

/** Total lookups — `t` is typed as a bare string because the value arrives from
 *  a document, not from the union, however it is annotated at the call site. */
const typeLabel = (t: string | undefined | null): string =>
  TYPE_LABELS[t as Contact['type']] ?? UNKNOWN_TYPE_LABEL;
const typeColor = (t: string | undefined | null): string =>
  TYPE_COLORS[t as Contact['type']] ?? UNKNOWN_TYPE_COLOR;

const ACTIVITY_ICONS: Record<ContactActivity['type'], React.ReactNode> = {
  note: <MessageSquare size={13} />,
  donation: <DollarSign size={13} />,
  email: <Mail size={13} />,
  call: <PhoneCall size={13} />,
  meeting: <Calendar size={13} />,
};

/**
 * THE-369 - what ONE timeline row is CALLED, so a confirmation can name it.
 *
 * A Record over the `type` union rather than a default, and that is the point:
 * the union is CLOSED, so a sixth activity type is a COMPILE ERROR here rather
 * than a dialog that asks "Delete this activity?" about something the copy was
 * never written for. `ACTIVITY_ICONS` above is exhaustive for the same reason.
 */
const ACTIVITY_NOUNS: Record<ContactActivity['type'], string> = {
  note: 'note',
  donation: 'gift',
  email: 'email',
  call: 'call',
  meeting: 'meeting',
};

const emptyContact = {
  firstName: '', lastName: '', email: '', phone: '', type: 'member' as Contact['type'],
  notes: '', tags: [] as string[], totalDonated: 0,
  address: { street: '', city: '', state: '', zip: '', country: '' },
};

// Pipeline stage presentation: ordered left→right on the kanban board. The stage
// itself is DERIVED from `totalDonated` (resolvePipelineStage) — this array only
// carries the label and colours for it. Nothing here is selectable.
const STAGES: { id: PipelineStage; label: string; color: string; bg: string }[] = [
  { id: 'member',   label: 'Member',   color: 'var(--text-muted)', bg: '#F3EEE7' },
  { id: 'giving',   label: 'Giving',   color: '#B8962E', bg: '#FBF3E4' },
  { id: 'champion', label: 'Champion', color: '#10B981', bg: '#ECFDF5' },
];

/** Presentation for a contact's derived stage. Never falls through to STAGES[0]
 *  by accident: resolvePipelineStage only ever returns an id present above. */
const stageOf = (c: Pick<Contact, 'totalDonated'>) =>
  STAGES.find(s => s.id === resolvePipelineStage(c.totalDonated)) || STAGES[0];

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

// Robust to EVERY date shape the CRM data actually contains — a Firestore
// Timestamp, an ISO string (donation webhook, #119), a JS Date, epoch millis, or
// null. Assuming `.toDate()` here is what threw "e.toDate is not a function" and
// white-screened the whole CRM; toSafeDate normalizes all of them and never throws.
const fmtDate = (ts: DateLike) => {
  const d = toSafeDate(ts);
  if (!d) return '';
  const diff = Date.now() - d.getTime();
  if (diff < 86400000) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

/**
 * THE-149 — WHETHER someone has given, and WHEN, are two different questions.
 *
 * The card used to answer both from `lastDonationAt`, so a contact with a real
 * `totalDonated` but no date on the row was told "No donations yet" beside
 * "$100 total given". Two fields describing one fact, and the badge read the
 * one that is only ever about timing.
 *
 * WHETHER is derived, from the same single source the pipeline stage uses:
 * `resolvePipelineStage` returns 'member' exactly when no usable total is
 * recorded. Going through it rather than comparing `totalDonated > 0` inline
 * means the badge and the stage cannot drift apart, and nothing here writes a
 * second copy of a fact `totalDonated` already holds.
 *
 * WHEN stays `lastDonationAt`, which is the only thing it is good for — and it
 * is allowed to be missing. `fmtDate` returns '' for a date it cannot read, so
 * `date === ''` means "they have given, we do not know when", which the two
 * surfaces below say out loud instead of denying the gift.
 */
const lastGift = (c: Pick<Contact, 'totalDonated' | 'lastDonationAt'>) => {
  const given = resolvePipelineStage(c.totalDonated) !== 'member';
  return { given, date: given ? fmtDate(c.lastDonationAt) : '' };
};

/** The detail card's giving badge. Never contradicts the total beside it. */
const lastGiftBadge = (c: Pick<Contact, 'totalDonated' | 'lastDonationAt'>): string => {
  const { given, date } = lastGift(c);
  if (!given) return 'No donations yet';
  return date ? `Last gift ${date}` : 'Last gift date not recorded';
};

/** The list's LAST GIFT cell. Built from the same `lastGift`, so the em dash
 *  appears in the list exactly when the card says "No donations yet" — the two
 *  surfaces agree by construction rather than by both being edited together. */
const lastGiftCell = (c: Pick<Contact, 'totalDonated' | 'lastDonationAt'>): string => {
  const { given, date } = lastGift(c);
  if (!given) return '—';
  return date || 'Not recorded';
};

type ViewMode = 'list' | 'detail' | 'form';

interface KanbanBoardProps {
  contacts: Contact[];
  stages: typeof STAGES;
  onOpenContact: (c: Contact) => void;
}

// Horizontal pipeline board: one column per stage, contacts sorted into the
// column their giving puts them in. There is deliberately no stage mover — the
// column is a fact about `totalDonated`, so a control that "moved" a contact
// between columns could only either lie or silently do nothing.
const KanbanBoard: React.FC<KanbanBoardProps> = ({ contacts, stages, onOpenContact }) => {
  return (
    <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4">
      {stages.map(stage => {
        const stageContacts = contacts.filter(c => resolvePipelineStage(c.totalDonated) === stage.id);
        return (
          <div key={stage.id} className="flex-shrink-0 w-[220px]">
            {/* Column header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: stage.color }} />
                <span className="text-xs font-bold text-body">{stage.label}</span>
              </div>
              <span className="text-[10px] font-semibold text-faint bg-surface-sunken px-1.5 py-0.5 rounded-full">
                {stageContacts.length}
              </span>
            </div>

            {/* Cards */}
            <div className="space-y-2">
              {stageContacts.map(c => (
                <div
                  key={c.id}
                  onClick={() => onOpenContact(c)}
                  className="bg-surface-raised rounded-xl border border-line-hairline p-3 cursor-pointer hover:shadow-xs hover:border-[color-mix(in_srgb,var(--brand-color)_40%,transparent)] transition-all"
                >
                  {/* Avatar + name */}
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                      style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}
                    >
                      {(c.firstName?.[0] || c.lastName?.[0] || '?').toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-strong truncate">
                        {[c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unnamed'}
                      </p>
                      <p className="text-[10px] text-faint truncate">{c.email}</p>
                    </div>
                  </div>

                  {/* Type badge */}
                  <div className="flex items-center justify-between">
                    <span
                      data-testid="crm-type-badge"
                      className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${typeColor(c.type)}`}
                    >
                      {typeLabel(c.type)}
                    </span>
                    {c.totalDonated > 0 && (
                      <span className="text-[9px] font-bold text-gold">
                        {fmt(c.totalDonated)}
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {stageContacts.length === 0 && (
                <div className="rounded-xl border-2 border-dashed border-line-hairline p-4 text-center">
                  <p className="text-[10px] text-faint">No contacts</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

interface AdminCRMProps {
  currentUserRole?: string;
  currentUserPermissions?: Permission | null;
  /** Deep-link: open this contact's detail on mount (e.g. from a chat attachment). */
  initialContactId?: string;
  /** Called once the deep-linked contact has been opened, to clear the URL param. */
  onItemConsumed?: () => void;
}

const AdminCRM: React.FC<AdminCRMProps> = ({ currentUserRole, currentUserPermissions, initialContactId, onItemConsumed }) => {
  const { setHeaderAction, setHeaderOverride } = useAdminHeader();
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  // House tenant-resolution pattern (AdminCheckin, AdminQR, AdminForms,
  // AdminEvents, AdminSms, AdminGivingStatements, AdminFundraising, AdminDocs).
  // Fall back to the platform tenant for a super admin if the store value is
  // briefly null. On a tenant subdomain currentTenantId is set and takes
  // precedence. Reading `isSuperAdmin` is load-bearing: without it a null
  // tenantId was ambiguous between a super admin on the apex (for whom the
  // unscoped read is right) and a tenant admin whose tenant never resolved (for
  // whom it is a guaranteed permission-denied), and the hooks could not tell
  // them apart. See fetchContactRows in useCRMQueries.
  const { currentTenantId, isAuthReady, isSuperAdmin } = useAppStore();
  const tenantId = currentTenantId || (isSuperAdmin ? PLATFORM_TENANT_ID : null);

  // React Query for contacts list.
  //
  // `contactsFailed` is load-bearing for the same reason `activitiesFailed` is
  // below: `data = []` on its own turns a REJECTED read into "this church has no
  // contacts", which is exactly how the timeline bug hid for weeks (#236).
  const {
    data: contacts = [],
    isLoading: loading,
    isError: contactsFailed,
    error: contactsError,
    refetch: refetchContacts,
  } = useContactsWithUsers(tenantId, isAuthReady);

  // True collection sizes, counted server-side without loading the documents.
  //
  // This is what stops the list lying about its own length. `contacts` above
  // stops at CRM_FETCH_LIMIT per collection, so its `.length` reports the
  // ceiling as the total once a church outgrows it — the silent truncation this
  // screen shipped with. The aggregate below is the real number, and costs ~1
  // read per 1,000 documents rather than one per document.
  //
  // Deliberately NOT destructured with an error flag: a failed count must not
  // take the list down with it. The list is still worth showing; it just loses
  // the coverage line, which renders only when `counts` arrived.
  const { data: counts } = useCRMCounts(tenantId, isAuthReady);

  // maxContacts — a SOFT cap, CLIENT-SIDE ONLY. See src/utils/contact-capacity.ts
  // for the counting rule (accounts only; donors visible and free; super admins
  // excluded; owner and admins counted) and for where a real server-side gate
  // would live.
  //
  // Soft means: member SELF-SIGNUP is never blocked — a visitor cannot upgrade a
  // plan and must never be turned away — and no existing contact is deleted,
  // hidden or made uneditable. The only thing this gates is the admin-initiated
  // manual add, which is the one creation path an admin controls. (There is no
  // CSV importer anywhere in the app; every CSV path is an export.)
  //
  // No new query: `counts.memberAccounts` is #279's existing server-side
  // aggregate, so the cap adds zero reads and cannot miss an index.
  const { tenantPlan, planFeatures, branding } = useTenant();
  const maxContacts = resolveContactLimit(tenantPlan);

  /**
   * 🔴 WHETHER THIS TENANT CAN HAVE A DONOR AT ALL — THE-213.
   *
   * `fundraising: false` means the tenant has NO DONATE PAGE (the member Give
   * tab is gone, /campaign/[id] refuses, and /api/stripe/donate 403s), so no
   * gift can ever arrive and no donor record can ever be created. Every
   * giving-shaped thing on this screen is therefore not "empty" on such a
   * tenant, it is STRUCTURALLY IMPOSSIBLE: a Donors count that can only read 0,
   * a Total Given that can only read $0, a pipeline whose every contact is
   * pinned in the first column forever, a Last Gift column of em dashes.
   *
   * THE-205 fixed the pricing CARD's label (`crmLabel`); the screen itself was
   * never touched. This is the screen.
   *
   * ⚠️ HIDES PRESENTATION ONLY — never a query, a write, a document or a rule.
   * `totalDonated` and `lastDonationAt` are still read, still merged and still
   * saved exactly as before, and `resolvePipelineStage` still derives a stage
   * for every contact; a tenant that upgrades gets all of it back on screen
   * with its history intact. Nothing here touches the contact write path, the
   * CSV import, or the 500-row ceiling handling.
   *
   * ⚠️ THE `Type` COLUMN AND ITS Donor / Donor & Member PILLS STAY, on every
   * tier. They report what a document actually SAYS — a value an admin chose in
   * the form or an importer mapped from a spreadsheet column — not a claim the
   * plan makes, and this list is the MERGED contact/member view: hiding the
   * column that identifies which side of that merge a row came from would break
   * the shape PR 338's importer and the merge logic both depend on. Hiding it
   * would also make a `donor` row carried over from a downgrade unreadable,
   * which is deleting data with CSS. See the PR body for the full item-by-item
   * list.
   *
   * Effective features (the context value is already add-on-layered), falling
   * back to the same 'plus' coercion `resolveContactLimit` applies one line
   * above when the plan has not resolved — one unknown-plan rule for the whole
   * screen rather than two that can disagree.
   */
  const crmFeatures = planFeatures ?? getEffectiveFeatures(toTenantPlan(tenantPlan), null);
  const showGiving = crmFeatures.fundraising;

  /**
   * 🔴 THE-249 — does this church publish payment links Harvest is not in?
   *
   * `config.givingLinks` off the tenant document, which `TenantContext` has
   * already loaded and every admin screen shares. NO NEW QUERY, and no new
   * failure mode: `readGivingLinks` is the same validator the member Give page
   * reads through (`MainApp`), so a stale or malformed entry stops counting
   * here exactly when it stops rendering there.
   *
   * ⚠️ WHY THIS IS A CONDITION AND NOT A CONSTANT. A church with no links has
   * no gap — every gift it can receive is a Stripe gift, and the CRM is
   * complete. Telling it otherwise on every CRM load is the banner nobody
   * reads, which is how the churches that DO have the gap learn to skip it.
   * Before `branding` resolves the note is absent rather than guessed at; it
   * appears with the rest of the tenant's configuration.
   */
  const hasManualGivingLinks = useMemo(() => readGivingLinks(branding).length > 0, [branding]);

  /**
   * 🔴 CAN THIS TENANT REACH GMAIL FROM SETTINGS AT ALL — THE-225, and the
   * dead-end guard THE-193 exists to keep closed.
   *
   * THE-193's defect was a "Connect your email" button on this screen routing
   * to a Settings page with no Integrations section on it: the workflow simply
   * ended. THE-225 hides the Gmail card from the free tier, which would re-open
   * that exact hole — free has `crm: true`, so free renders this screen, and
   * the button would point at a section free no longer has.
   *
   * So it asks the SAME predicate the Settings gate asks, from the same module,
   * rather than a second rule that can disagree: if `isProviderAvailable` says
   * no, this screen offers no email affordance at all — not the send button,
   * not the connect prompt, and not the `/api/composio/gmail/status` request
   * that decides between them. Nothing points anywhere hidden.
   *
   * ⚠️ PRESENTATION ONLY, like `showGiving` above. No contact, activity or
   * previously-connected mailbox is touched; a tenant that upgrades gets the
   * button back with everything intact.
   */
  const canConnectGmail =
    // 🔴 THE-339 — the master switch FIRST, ahead of the plan question, in the
    // shape the newsletter rows use in `IntegrationsSection`: while Gmail is
    // hidden NOBODY reaches an email affordance from a contact, on any tier.
    // The predicate below is untouched, so flipping GMAIL_FEATURE_ENABLED
    // restores the THE-193 / THE-225 behaviour exactly as it was rather than a
    // re-derived version of it.
    GMAIL_FEATURE_ENABLED &&
    isProviderAvailable(
      getIntegrationProvider('gmail'),
      crmFeatures,
      tenantPlan,
    );
  // The platform-wide super-admin view counts EVERY church's users (the reads are
  // unscoped there), so a tenant plan cap is meaningless against it — gating on
  // that number would lock the platform CRM at 150. On a tenant subdomain a super
  // admin IS gated by the tenant's plan, which is the `platformWide: false` path.
  //
  // A missing `counts` means the aggregate is still loading or FAILED. Do not
  // block on it: unlike the plan (which fails closed to 'plus'), an unknown count
  // is not evidence of being over the cap, and a failed count must not take the
  // add button down with it — the same rule that keeps the list rendering when
  // the coverage line cannot.
  const contactCapApplies = !!counts && !counts.platformWide;
  const accountsUsed = counts ? countContactAccounts(counts.memberAccounts, contacts) : 0;
  const atContactLimit = contactCapApplies && isAtContactLimit(accountsUsed, maxContacts);
  const contactLimitNotice = contactLimitMessage(maxContacts);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | Contact['type']>('all');
  const [view, setView] = useState<ViewMode>('list');
  const [selected, setSelected] = useState<Contact | null>(null);
  const [form, setForm] = useState(emptyContact);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  /** THE-362 - a delete now spans two writes, so the control says so. */
  const [deleting, setDeleting] = useState(false);
  const [showAddActivity, setShowAddActivity] = useState(false);
  const [actForm, setActForm] = useState({ type: 'note' as ContactActivity['type'], description: '', amount: '' });
  const [savingAct, setSavingAct] = useState(false);
  /**
   * THE-350 — what keeps a failed gift from vanishing.
   *
   * 🔴 THE SAME CONTRACT `emailError` KEEPS BELOW, for the same reason. A gift
   * whose invoice write fails must surface VISIBLY: the dialog stays open, the
   * typed amount and description are still in their fields, and NOTHING is
   * written — no timeline entry, no `totalDonated` bump. An admin who was shown
   * a closed dialog would believe a gift was recorded that the ledger never
   * accepted, which is precisely the defect this ticket exists to close, one
   * layer up.
   */
  const [activityError, setActivityError] = useState<string | null>(null);
  /**
   * THE-369 - the timeline row a delete is about, held as the ROW and not an id.
   *
   * 🔴 THE CONFIRMATION HAS TO NAME THE AMOUNT before a receipt is destroyed,
   * and the figure lives on the row itself - `invoiceAmountCents`, THE-350's
   * display mirror in CENTS. Holding only an id would mean asking for the figure
   * again from a screen that CANNOT READ `invoices` at all, and a confirmation
   * that cannot state what it is about is the silent destruction this guards.
   */
  const [deleteActivity, setDeleteActivity] = useState<ContactActivity | null>(null);
  const [deletingActivity, setDeletingActivity] = useState(false);
  /**
   * 🔴 THE SILENT-FAILURE RULE, AND #506 FIXED EXACTLY THIS BUG ONE LAYER UP.
   *
   * A refused contact delete used to close its dialog and walk back to the list
   * as if it had worked - the screen performed the whole gesture of having
   * deleted somebody while the row sat there untouched. Here a failed delete
   * leaves the dialog OPEN on the row it failed on with the reason inside it,
   * and the row is still on the timeline underneath, because the row really is
   * still there. Nothing is removed optimistically, so there is no state in
   * which the screen is ahead of the database.
   */
  const [activityDeleteError, setActivityDeleteError] = useState<string | null>(null);
  // Email compose. `gmailConnected` is tri-state: null while the status is still
  // unknown, so the UI renders neither a send button nor a "connect" prompt off
  // an unanswered question. `emailError` is what keeps a failed send from
  // looking like a success — see sendEmail below.
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [emailForm, setEmailForm] = useState({ subject: '', body: '' });
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  // Sub-view entitlements. Contacts = manageCRM, Analytics = analytics, Roles =
  // manageAdmins (full access / super admin see all three). The CRM drawer entry
  // shows when the admin has ANY of these, so default to one they can actually view.
  const canViewContacts = currentUserRole === 'super_admin' || !!currentUserPermissions?.fullAccess || !!currentUserPermissions?.manageCRM;
  const canManageRoles = currentUserRole === 'super_admin' || !!currentUserPermissions?.fullAccess || !!currentUserPermissions?.manageAdmins;
  const [crmSubView, setCrmSubView] = useState<'contacts' | 'roles'>(
    canViewContacts ? 'contacts' : canManageRoles ? 'roles' : 'contacts'
  );
  const [listMode, setListMode] = useState<'list' | 'kanban'>('list');

  // ── THE-74 — CSV import ────────────────────────────────────────────────────
  //
  // Upload → map columns → preview → import. The parsing, mapping, dedupe and
  // batching all live in src/utils/csv-import.ts (pure, unit-tested); what is
  // here is the screen and the write.
  //
  // ⚠️ THE FILE IS NEVER UPLOADED ANYWHERE. It is read with `File.text()` and
  // parsed in this tab. A member list is personal data — names, emails, phone
  // numbers — and this way it never leaves the device; only the contact
  // documents cross the wire, on the same authenticated client write path the
  // manual add already uses. See the csv-import module header.
  const [showImport, setShowImport] = useState(false);
  const [importFileName, setImportFileName] = useState('');
  const [importTable, setImportTable] = useState<CsvTable | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  // '' is NOT "member". It is "the admin has not said yet", and the import
  // button stays disabled until they do — see the type decision below.
  const [importType, setImportType] = useState<Contact['type'] | ''>('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ ok: boolean; text: string } | null>(null);

  /**
   * Every email already in this CRM, normalised — the de-duplication index.
   *
   * Built from `contacts`, which is the MERGED list, so it covers both real
   * `contacts` rows and people who exist only as a `users` account. Importing
   * someone who already has an app account would otherwise create a second row
   * for them, which is the dual-id shape `mergeContactsWithUsers` exists to
   * prevent.
   *
   * 🔴 NO NEW QUERY. Deduplicating server-side would mean an `in` query over
   * emails (batched at 30 a time, hundreds of round trips) or a composite
   * (tenantId + email) index. The `contacts` rule gates reads on
   * `isTenantAdmin(resource.data.tenantId)` and a missing composite index fails
   * a query SILENTLY — a dedupe that quietly returns nothing would double a
   * church's list on the second import, which is precisely the failure being
   * defended against. The already-loaded list costs nothing and cannot fail.
   *
   * ⚠️ Bounded by CRM_FETCH_LIMIT, like everything else on this screen. When
   * the list is truncated the index is a prefix, and the import panel says so
   * rather than implying a completeness it does not have.
   */
  const existingEmailKeys = useMemo(
    () => new Set(contacts.map(c => normalizeEmailKey(c.email)).filter(Boolean)),
    [contacts],
  );

  /**
   * What WOULD be written, recomputed as the admin maps columns.
   *
   * Null until the two things the import cannot be honest without are settled:
   * a First name column (the manual add's own required field) and an explicit
   * type. That is what keeps the preview from ever rendering a row carrying an
   * assumption.
   */
  const importPlan = useMemo(() => {
    if (!importTable || !importType || !hasRequiredMapping(mapping)) return null;
    return planImport(
      mapRows(importTable, mapping, importType, CONTACT_TYPE_VALUES),
      existingEmailKeys,
    );
  }, [importTable, importType, mapping, existingEmailKeys]);

  /** Reset to a clean sheet — used on open and on close. */
  const resetImport = (): void => {
    setImportFileName(''); setImportTable(null); setImportError(null);
    setMapping({}); setImportType(''); setImportResult(null);
  };

  // Gated exactly like `openNewContact`. Import is an admin-initiated creation
  // path, which is the one category contact-capacity.ts gates — see the cap
  // decision on `runImport`.
  const openImport = (): void => {
    if (atContactLimit) return;
    resetImport();
    setShowImport(true);
  };

  const closeImport = (): void => { setShowImport(false); resetImport(); };

  /**
   * Read the chosen file and turn it into a table. Nothing is written here.
   *
   * An unreadable file is reported the same way a rejected one is: the panel
   * stays on the upload step with a message, never advancing to a mapping
   * screen built on nothing.
   */
  const onImportFile = async (file: File | null | undefined): Promise<void> => {
    setImportResult(null);
    setMapping({});
    setImportType('');
    setImportTable(null);
    setImportError(null);
    if (!file) return;
    setImportFileName(file.name);
    let text: string;
    try {
      text = await file.text();
    } catch {
      setImportError('That file could not be read. Try exporting it again.');
      return;
    }
    const result = readCsvTable(text);
    if (!result.ok) { setImportError(result.error); return; }
    setImportTable(result.table);
  };

  /**
   * Write the planned rows.
   *
   * ── THE CAP ────────────────────────────────────────────────────────────────
   * 🔴 AT THE CAP THE FILE IS REFUSED, WHOLE. Not trimmed to fit.
   *
   * The alternative — import up to the cap and report the rest — reads as the
   * considerate option and is actually a false statement. `maxContacts` counts
   * ACCOUNTS: `useCRMCounts.memberAccounts` is an aggregate over `users`, and
   * `countContactAccounts` subtracts only super admins from it. An imported
   * contact is a `contacts` document with no account attached, exactly like a
   * donor who gave through the public donate page — so importing 400 people
   * changes `accountsUsed` by zero. "127 of your 400 were imported, you have
   * reached your limit" would name a limit nothing consumed.
   *
   * So there is no headroom arithmetic here and none is possible: the cap is a
   * boolean about accounts, and the honest use of it is the one the manual add
   * already makes. Import is admin-initiated creation — the single category
   * contact-capacity.ts says is gated — so it is closed when the manual add is
   * closed and open when it is open. Nothing in contact-capacity.ts changed;
   * two other cards depend on its behaviour.
   *
   * The wording is `contactLimitMessage`, which owns it, shown ONCE in the
   * existing notice rather than as a running meter.
   *
   * ── PARTIAL FAILURE ────────────────────────────────────────────────────────
   * A Firestore batch is ATOMIC. So on a failure the rows that reached
   * Firestore are exactly the rows in the batches that already committed — the
   * failing batch wrote nothing and the batches after it were never attempted.
   * That is what makes the report exact rather than a guess, and it is why the
   * loop stops at the first failure instead of pressing on: the likely causes
   * (permission denied, quota, the connection) fail every subsequent batch too,
   * and continuing would only scatter the gap.
   */
  const runImport = async (): Promise<void> => {
    if (!importTable || !importType || !importPlan) return;
    // Last line of defence, mirroring `handleSave`: the panel can be open with
    // a count that has since gone stale.
    if (atContactLimit) {
      notifyError(contactLimitNotice, 'Contact limit reached');
      // THE-360 - a refusal, not a render: this line is only reached because an
      // action was blocked by the cap. See PLAN_LIMIT_KINDS in events.ts.
      trackProductEvent(ANALYTICS_EVENTS.PLAN_LIMIT_REACHED, { limitKind: 'contacts' });
      return;
    }
    setImporting(true);
    setImportResult(null);

    const { toWrite, skipped } = importPlan;
    const chunks = chunkForBatches(toWrite);

    let imported = 0;
    let lastWrittenLine: number | null = null;
    let failure: ImportOutcome['failure'] = null;

    for (const group of chunks) {
      try {
        const batch = writeBatch(db);
        for (const row of group) {
          // 🔴 `doc(collection(...))` with no id mints a new auto-id ref — the
          // batch equivalent of the manual add's `addDoc`, so an import can
          // never overwrite an existing contact by colliding on an id.
          batch.set(doc(collection(db, 'contacts')), {
            firstName: row.firstName, lastName: row.lastName,
            email: row.email, phone: row.phone,
            // 🔴 ALWAYS PRESENT. Either the file said it or the admin chose it
            // — `mapRows` has no third branch. An unset `type` renders a blank
            // badge (THE-150) and upsertContact's update branch never repairs
            // one, so a row must not reach Firestore without it.
            type: row.type,
            notes: row.notes, tags: [], totalDonated: 0,
            address: row.address,
            // 🔴 The manual add's own resolution (see handleSave). Concrete,
            // never null: `getTenantScope()` returns null for a super admin and
            // null means ALL TENANTS on a read — it is simply wrong on a write.
            tenantId: tenantId || PLATFORM_TENANT_ID,
            lastDonationAt: null, memberSince: null,
            createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid || '',
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
        imported += group.length;
        lastWrittenLine = group[group.length - 1].line;
      } catch (e) {
        failure = {
          notWritten: toWrite.length - imported,
          lastWrittenLine,
          firstUnwrittenLine: group[0].line,
          message: (e as Error)?.message || 'the import could not be completed',
        };
        break;
      }
    }

    setImportResult(importSummary({
      imported,
      duplicates: countSkips(skipped, 'duplicate-in-crm'),
      repeatedInFile: countSkips(skipped, 'duplicate-in-file'),
      noName: countSkips(skipped, 'no-name'),
      failure,
    }));

    // Refresh whatever DID land, on the failure path too — the list must show
    // the rows that wrote rather than leaving the admin to guess.
    await queryClient.invalidateQueries({ queryKey: ['contacts', tenantId] });
    await queryClient.invalidateQueries({ queryKey: ['crmCounts', tenantId] });
    setImporting(false);
  };

  // Drive the shared header: in detail/form sub-views the back chevron steps
  // back within CRM; on the list view it shows the "Add Contact" action.
  useEffect(() => {
    if (view === 'form') {
      setHeaderOverride({
        title: isEditing ? 'Edit Contact' : 'Add Contact',
        onBack: () => setView(isEditing ? 'detail' : 'list'),
      });
    } else if (view === 'detail' && selected) {
      setHeaderOverride({
        title: `${selected.firstName} ${selected.lastName}`.trim() || 'Contact',
        onBack: () => { setSelected(null); setView('list'); },
      });
    } else {
      setHeaderOverride(null);
    }
    return () => setHeaderOverride(null);
  }, [view, selected, isEditing, setHeaderOverride]);

  // Don't open the form at all at the cap: filling it in and failing on save is
  // the shape this gate exists to avoid. Editing an existing contact — including
  // the upsert that gives a `users`-only member their first `contacts` doc — is
  // untouched, because neither adds an account.
  const openNewContact = (): void => {
    if (atContactLimit) return;
    setIsEditing(false); setForm(emptyContact); setView('form');
  };

  // Publish the "Add Contact" action into the shared header — but only on the
  // Contacts sub-view (the Roles sub-view renders AdminRoles, which manages its
  // own header action). Re-asserts when the sub-view changes back.
  useEffect(() => {
    // Only the Contacts sub-view owns the shared header action. Roles renders
    // AdminRoles, which publishes its own action ("Add Admin"), so do NOT clear
    // the slot here on that sub-view or we'd clobber theirs.
    if (crmSubView !== 'contacts') return;
    setHeaderAction(
      <HeaderActionButton
        label="Add Contact"
        onClick={openNewContact}
        disabled={atContactLimit}
        title={atContactLimit ? contactLimitNotice : undefined}
      />
    );
    return () => setHeaderAction(null);
    // atContactLimit/contactLimitNotice are deps: the header action is a rendered
    // node handed to a context, so it does not re-render itself when the account
    // count changes — the effect has to re-publish it.
  }, [setHeaderAction, crmSubView, atContactLimit, contactLimitNotice]); // eslint-disable-line react-hooks/exhaustive-deps

  // Contact timeline (server-side read — see useContactActivities).
  //
  // `activitiesFailed` is load-bearing: this used to destructure `data = []`
  // and nothing else, so a REJECTED read rendered byte-for-byte identically to
  // "no activities" and hid the bug for weeks. Every branch below that shows a
  // count or an empty state must check it first.
  const {
    data: activities = [],
    isLoading: activitiesLoading,
    isError: activitiesFailed,
    error: activitiesError,
    refetch: refetchActivities,
  } = useContactActivities(tenantId, selected?.id);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const scroller = el.closest('[class*="overflow-y-auto"], [class*="overflow-auto"]') as HTMLElement | null;
    if (scroller) scroller.scrollTo({ top: 0, left: 0 });
  }, [view, crmSubView, selected?.id]);

  // Reset scroll position to top whenever the user navigates between CRM views
  // (list → detail → form, Contacts ↔ Analytics, or selecting a new contact).
  // The scroll container lives in the parent FocusScreen wrapper, so we walk up
  // the DOM from the view's root element to find the nearest overflow-y-auto
  // ancestor and reset it. This is the systematic scroll-reset pattern.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const scroller = el.closest('[class*="overflow-y-auto"], [class*="overflow-auto"]') as HTMLElement | null;
    if (scroller) scroller.scrollTo({ top: 0, left: 0 });
  }, [view, crmSubView, selected?.id]);

  const filtered = contacts.filter(c => {
    const matchType = filter === 'all' || c.type === filter || (filter !== 'both' && c.type === 'both');
    const fullName = `${c.firstName} ${c.lastName}`.toLowerCase();
    const matchSearch = !search ||
      fullName.includes(search.toLowerCase()) ||
      (c.email || '').toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  });

  const openCreate = () => { setIsEditing(false); setForm(emptyContact); setView('form'); };

  const openEdit = (c: Contact) => {
    setIsEditing(true);
    setForm({
      firstName: c.firstName || '', lastName: c.lastName || '', email: c.email || '',
      phone: c.phone || '', type: c.type,
      notes: c.notes || '', tags: c.tags || [],
      totalDonated: c.totalDonated || 0,
      address: { ...{ street: '', city: '', state: '', zip: '', country: '' }, ...c.address },
    });
    setSelected(c);
    setView('form');
  };

  const openDetail = (c: Contact) => { setSelected(c); setView('detail'); };

  // Deep-link: open a specific contact when navigated to /admin/crm/:id
  // (e.g. tapping "View Contact" on a chat attachment card).
  useEffect(() => {
    if (!initialContactId) return;
    const c = contacts.find(x => x.id === initialContactId);
    if (c) { setSelected(c); setView('detail'); onItemConsumed?.(); }
  }, [initialContactId, contacts]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!form.firstName.trim()) return;
    // The cap's last line of defence. `openNewContact` already refuses to open
    // the form, but the form can also be reached with a stale count, so a NEW
    // contact is re-checked at save. Edits are never blocked: `isEditing` covers
    // both a real contact and the upsert that materialises a member's first
    // `contacts` doc, and neither creates an account.
    if (!isEditing && atContactLimit) {
      notifyError(contactLimitNotice, 'Contact limit reached');
      // THE-360 - a refusal, not a render: this line is only reached because an
      // action was blocked by the cap. See PLAN_LIMIT_KINDS in events.ts.
      trackProductEvent(ANALYTICS_EVENTS.PLAN_LIMIT_REACHED, { limitKind: 'contacts' });
      return;
    }
    setSaving(true);
    try {
      const data = {
        firstName: form.firstName.trim(), lastName: form.lastName.trim(),
        email: form.email.trim(), phone: form.phone.trim(), type: form.type,
        // No `stage` in the payload: the pipeline stage is derived from
        // totalDonated on read, so writing one would be a second copy of the
        // same fact — free to drift, and the reason this was manual before.
        notes: form.notes.trim(), tags: form.tags, totalDonated: form.totalDonated,
        address: form.address, updatedAt: serverTimestamp(),
      };
      if (isEditing && selected) {
        // Upsert (not updateDoc): a member surfaced from the `users` collection
        // has no `contacts` doc yet, so editing it should CREATE the contact.
        await setDoc(doc(db, 'contacts', selected.id), {
          ...data,
          tenantId: selected.tenantId || tenantId || PLATFORM_TENANT_ID,
        }, { merge: true });
        setSelected({ ...selected, ...data, updatedAt: null });
      } else {
        await addDoc(collection(db, 'contacts'), {
          ...data, tenantId: tenantId || PLATFORM_TENANT_ID,
          lastDonationAt: null, memberSince: null,
          createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid || '',
        });
      }
      await queryClient.invalidateQueries({ queryKey: ['contacts', tenantId] });
      setView(isEditing ? 'detail' : 'list');
    } catch (e) { notifyError('Failed to save contact', e); }
    finally { setSaving(false); }
  };

  /**
   * THE-362 — WHY A DELETE CAN DO NOTHING, AND WHAT IT NOW SAYS INSTEAD.
   *
   * The founder, twice over: "If I delete a user in CRM, it doesn't disappear
   * from the table." and "I created a user, I gave him admin. I entered from
   * that admin account and tried to delete my own account basically and nothing
   * happened."
   *
   * ONE ROOT CAUSE, TWO REFUSALS. This list is a MERGE of `contacts` and
   * `users` (see `useContactsWithUsers`), and `confirmDelete` sent every row to
   * a delete aimed at `contacts/<row.id>` regardless of which collection the
   * row came from.
   * For an app member with no contact record that id is a `users` id, so the
   * write named a document that has never existed: the `users` doc is untouched,
   * the refetch returns the row, and the table is unchanged. An admin's own row
   * is one of those rows, which is why deleting themselves also did nothing.
   *
   * IT IS NOT A REFRESH BUG. `confirmDelete` already invalidated
   * `['contacts', tenantId]`, which react-query matches by PREFIX, so
   * `['contacts', tenantId, 'with-users']` refetches — and refetching is
   * precisely what puts the row back. Invalidating harder would change nothing.
   *
   * AND IT IS NOT A PERMISSION BUG EITHER. `manageCRM` already gates this
   * screen, and a contact the church really does own deletes and disappears
   * today. What was missing is that the CRM cannot remove an APP ACCOUNT, and
   * never could — so the honest answer is to say so rather than to issue a
   * write that cannot land.
   */
  const myUid = auth.currentUser?.uid || null;
  const myEmail = (auth.currentUser?.email || '').trim().toLowerCase();

  /**
   * Is this row the signed-in admin themselves?
   *
   * Identity is the ACCOUNT, not the row id: an admin who also has a contact
   * record surfaces under the CONTACTS id (that is `mergeContactsWithUsers`'s
   * whole point), so an id comparison alone would miss exactly the admin most
   * likely to try this. The three tests below are the same `userId`-then-email
   * link rule the merge itself uses.
   */
  const isSelf = (c: Contact): boolean =>
    (!!myUid && c.id === myUid) ||
    (!!myUid && !!c.userId && c.userId === myUid) ||
    (!!myEmail && !!c.account && (c.account.email || '').trim().toLowerCase() === myEmail);

  /**
   * The row this delete is about.
   *
   * `selected` FIRST, and the list only as a fallback. The delete is reached
   * from the contact card, so `selected` is the row the admin is looking at,
   * and it is present even on the render before the merged list resolves -
   * resolving only through `contacts` would leave a window in which no target
   * is found, every refusal below evaluates to `null`, and a self-delete would
   * go through. FAILING CLOSED covers the rest: an id that matches neither is
   * refused rather than deleted, because a destructive write against a row this
   * screen cannot identify is not one it should be issuing.
   */
  const deleteTarget = deleteId
    ? (selected?.id === deleteId ? selected : contacts.find(c => c.id === deleteId) ?? null)
    : null;

  /**
   * The reason this delete cannot go ahead, or `null` when it can.
   *
   * ORDER MATTERS. Self comes first: an admin's own row is almost always an
   * account-backed one too, and "you cannot remove your own account" is the
   * thing they need to be told — the lockout is the serious half.
   */
  const deleteRefusal: { readonly title: string; readonly body: string } | null =
    !deleteId ? null
    : !deleteTarget ? {
        title: 'This person could not be identified',
        body:
          'The contact list has not finished loading, so there is no way to tell whose '
          + 'record this is. Close this, wait for the list, and try again.',
      }
    : isSelf(deleteTarget) ? {
        title: 'You cannot remove your own account',
        body:
          'Removing yourself would lock you out of this church, and you may be the only '
          + 'admin left in it. Another admin can change your role on the Roles tab.',
      }
    : deleteTarget.accountOnly ? {
        title: `${[deleteTarget.firstName, deleteTarget.lastName].filter(Boolean).join(' ') || 'This person'} has an app account`,
        body:
          'They signed up in the app, so there is no CRM record here to delete \u2014 this row '
          + 'IS their account. Deleting an account erases a person\u2019s profile and their '
          + 'content across the whole app, and only they can do that, from Personal '
          + 'Information in their own profile. Their giving is never erased either way: a '
          + 'receipt stays on your books with the name replaced.',
      }
    : null;

  /**
   * The tenant a contact belongs to, for a write that must name one.
   *
   * The ROW's own `tenantId` first: the merged list can hold a platform-wide
   * row for a super admin, and deleting its activity under the screen's tenant
   * would name the wrong church and delete nothing. Falls back to the screen's
   * scope, then to the platform tenant, exactly as every other write here does.
   */
  const selectedTenantScope = (target: Contact | null, screenTenant: string | null | undefined) =>
    target?.tenantId || screenTenant || PLATFORM_TENANT_ID;

  const confirmDelete = async () => {
    if (!deleteId) return;
    // THE GUARD IS HERE, not only in the dialog. A refusal that lived only in
    // the markup would be one re-render away from being bypassed, and this
    // function is the only thing that reaches Firestore.
    if (deleteRefusal) return;
    setDeleting(true);
    try {
      /**
       * THE-362 - THE ACTIVITIES FIRST, THE CONTACT LAST, AND THE ORDER IS THE
       * WHOLE SAFETY ARGUMENT.
       *
       * `contactActivities` is a TOP-LEVEL collection keyed by a `contactId`
       * field, not a subcollection, so Firestore deletes none of it with the
       * parent: every row used to be left behind pointing at a document that no
       * longer exists, and a donation row carries an `invoiceId`, so that is a
       * dangling reference next to the money.
       *
       * It cannot be swept from here - a client cannot LIST that collection at
       * all (rules are not filters; see the route's own note) - so this calls
       * the Admin-SDK route, which gates on `manageCRM` itself and deletes in
       * batched pages.
       *
       * 🔴 IF THIS THROWS, THE CONTACT IS STILL HERE. That is deliberate: a
       * failure leaves a contact with fewer timeline rows, which this screen
       * already renders correctly and which pressing Delete again finishes.
       * Deleting the contact first would manufacture the orphan on every
       * failure instead.
       */
      const scope = selectedTenantScope(deleteTarget, tenantId);
      const res = await authFetch(
        `/api/crm/contact-activities?contactId=${encodeURIComponent(deleteId)}`
        + `&tenantId=${encodeURIComponent(scope)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `Could not remove this contact's activity (${res.status})`);
      }

      await deleteDoc(doc(db, 'contacts', deleteId));
      await queryClient.invalidateQueries({ queryKey: ['contacts', tenantId] });
      // INSIDE THE `try`, AND THAT IS THE SILENT-FAILURE RULE. Both of these
      // used to run after the `catch`, so a REFUSED delete closed the dialog and
      // walked back to the list exactly as a successful one did — the screen
      // performed the whole gesture of having deleted somebody while the row sat
      // there untouched. The `notifyError` alert said otherwise, but the screen
      // said it had worked, and the screen is what a reader believes. A failure
      // now leaves the dialog open on the row it failed on, so the admin can
      // read the alert, see which person it was about, and try again or cancel.
      setDeleteId(null);
      if (view === 'detail') setView('list');
    } catch (e) { notifyError('Failed to delete contact', e); }
    finally { setDeleting(false); }
  };

  /**
   * The delete dialog, defined ONCE and rendered on both sub-views.
   *
   * ONE DEFINITION, for the same reason `subTabBar` below is one: the two
   * copies of this dialog were byte-identical, and a guard that was added to
   * only one of them would refuse on the contact card and not in the list.
   * Asserting that two copies currently agree proves nothing about the next
   * edit; there being one is true by construction.
   */
  const deleteDialog = deleteId && (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-surface-raised rounded-3xl p-6 w-full max-w-sm">
        {deleteRefusal ? (
          <>
            {/* THE SILENT-FAILURE RULE, on the `alert` primitive — the one
                this repo installs for a refusal. `role="alert"` comes with it,
                so a screen reader is told too, and the only control left is the
                one that closes it: there is no button here that would issue a
                write that cannot land. */}
            <Alert variant="destructive" data-crm-delete-refused>
              <AlertTitle>{deleteRefusal.title}</AlertTitle>
              <AlertDescription>{deleteRefusal.body}</AlertDescription>
            </Alert>
            <button
              onClick={() => setDeleteId(null)}
              className="mt-5 w-full min-h-[44px] py-2.5 rounded-xl border border-line-hairline text-sm font-semibold text-muted"
            >
              Close
            </button>
          </>
        ) : (
          <div>
            <p className="font-bold text-strong mb-2 font-display text-center">Delete contact?</p>
            {/*
              THE-362 - WHAT IT REMOVES, AND WHAT IT DOES NOT.
              "This cannot be undone" was the whole warning, and it left a church
              to guess how far the deletion reaches. Two things are worth saying
              and both are established elsewhere in this PR: the timeline goes
              WITH the contact now (it used to be left behind pointing at a
              document that no longer existed), and this is NOT account erasure -
              it removes the church's own record of a person, never their app
              account, which only they can delete from their own profile. The
              money is named too, because a treasurer reading "cannot be undone"
              beside a donor's name deserves to know the receipt survives.
            */}
            <p className="text-sm text-muted mb-2">
              This removes {deleteTarget ? 'their' : 'the'} contact record and its whole activity
              timeline, and cannot be undone.
            </p>
            <p className="text-sm text-muted mb-5">
              Their giving stays on your books: a receipt is never deleted, so your accounting
              totals and giving statements do not change. If they have an app account, this does
              not remove it &mdash; only they can do that, from their own profile.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteId(null)}
                disabled={deleting}
                className="flex-1 min-h-[44px] py-2.5 rounded-xl border border-line-hairline text-sm font-semibold text-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                data-testid="crm-confirm-delete"
                className="flex-1 min-h-[44px] py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold disabled:opacity-50"
              >
                {deleting ? 'Deleting\u2026' : 'Delete'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // There is deliberately no stage-change handler here. The pipeline stage is a
  // function of `totalDonated`, so the only way to move a contact between stages
  // is to record giving — which the donation webhook and addActivity below
  // already do. Re-adding a mutator would reintroduce the stored copy.

  /**
   * THE-350 — 🔴 A MANUAL DONATION NOW WRITES AN INVOICE, NOT JUST A CRM NOTE.
   *
   * The founder: "If I add a donation from a user in CRM it updates the CRM but
   * not the dashboard." It updated the CRM because that is all this function
   * ever wrote. `tenants/{t}/invoices` is THE money ledger — the Overview tab
   * sums it, `AdminAccounting` reads it, giving statements aggregate it and
   * `/api/donation-history` is how a MEMBER sees their own giving — and until
   * this ticket its only writer was the Stripe donation webhook.
   *
   * ─── 🔴 THE LEDGER WRITE HAPPENS FIRST, AND IT DECIDES ──────────────────────
   *
   * `recordManualDonation` runs behind `/api/donations/manual` BEFORE anything
   * here writes. If it refuses, this function writes NOTHING at all: no
   * timeline entry, no `totalDonated` bump, no `lastDonationAt`. The alternative
   * ordering — CRM first, ledger second — is the bug wearing a different shape:
   * the church would see a gift on the contact and never on the dashboard, which
   * is the exact complaint.
   *
   * ⚠️ IT IS A ROUTE AND NOT A CLIENT WRITE because `firestore.rules` gates the
   * invoices collection on `manageAccounting`, and the admin recording a gift
   * holds `manageCRM`. See the route's own header: firestore.rules is untouched
   * by this ticket.
   *
   * ─── 🔴 ONE GIFT, ONE MONEY RECORD — THE ACTIVITY LINKS, IT DOES NOT COPY ──
   *
   * The invoice IS the record of the money. The timeline entry REFERENCES it by
   * `invoiceId` and carries `amount: null`, so nothing that ever sums
   * `contactActivities.amount` — the field the webhook writes in DOLLARS — can
   * pick the same gift up a second time. A gift counted twice is worse than a
   * gift counted once in the wrong place.
   *
   * ⚠️ `invoiceAmountCents` IS A DISPLAY MIRROR AND SAYS SO IN ITS NAME. The CRM
   * cannot read `invoices` (admin-read-only, and gated on a permission this
   * screen's admin need not hold), so the timeline needs the figure locally to
   * render the row. It is in CENTS under a name no money reader in this
   * repository touches, it is keyed to `invoiceId`, and it is rendered through
   * `formatCents` — the one helper that turns cents into dollars.
   *
   * ⚠️ `totalDonated` IS UNCHANGED AND STILL BUMPED, in DOLLARS. It is the
   * contact's own running total — the same field the webhook increments for a
   * Stripe gift, and what `resolvePipelineStage` reads — not a second copy of
   * the ledger. Leaving it alone would have regressed the half of the founder's
   * sentence that already worked.
   */
  const addActivity = async () => {
    if (!actForm.description.trim() || !selected) return;
    setSavingAct(true);
    setActivityError(null);
    try {
      const contactTenantId = selected.tenantId || tenantId || PLATFORM_TENANT_ID;
      const isDonation = actForm.type === 'donation' && !!actForm.amount;

      // ── 1. The ledger. Nothing below runs unless this lands. ──────────────
      let invoiceId: string | null = null;
      let invoiceAmountCents: number | null = null;
      let donationDollars = 0;
      if (isDonation) {
        // 🔴 The ONE conversion from dollars to cents, and it refuses rather
        // than coercing — a blank, a letter, a zero or a negative never reaches
        // the ledger as $0.00.
        const amountCents = dollarsToCents(actForm.amount);
        if (amountCents === null) {
          // `finally` below clears `savingAct`; the dialog stays open with the
          // typed value in it, exactly as a rejected ledger write leaves it.
          setActivityError('Enter an amount greater than zero.');
          return;
        }
        const res = await authFetch('/api/donations/manual', {
          method: 'POST',
          body: JSON.stringify({
            tenantId: contactTenantId,
            amountCents,
            // 🔴 THE IDENTITY KEY. The route normalises it (trim + lowercase,
            // `normalizeEmail`) exactly as `/api/donation-history` normalises
            // the member's own verified token before matching. A contact with
            // no email still records — and the dialog says, above this button,
            // that its giver will never see the gift.
            email: selected.email || '',
            description: actForm.description.trim(),
            source: 'crm_manual',
            recipientName: `${selected.firstName || ''} ${selected.lastName || ''}`.trim(),
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.invoiceId) {
          // Throwing keeps every failure on one path — the catch below leaves
          // the dialog open with the typed value still in it.
          throw new Error(data?.error || `The gift could not be recorded (${res.status}).`);
        }
        invoiceId = data.invoiceId as string;
        invoiceAmountCents = amountCents;
        donationDollars = amountCents / 100;
        // 🔴 THE-360 - HERE, and not at the end of this function. The gift IS
        // the ledger write: the two writes below (the timeline entry and the
        // contact's running total) are the CRM catching up with money that has
        // already landed, and one of them failing does not un-record the gift.
        // Counting at the end would under-count exactly the sessions where
        // something went wrong, which is when the number matters most.
        //
        // Fire-and-forget, and NO AMOUNT - see `GIFT_RECORDED` in events.ts.
        trackProductEvent(ANALYTICS_EVENTS.GIFT_RECORDED);
      }

      // ── 2. The CRM timeline entry, which now points at the ledger. ────────
      await addDoc(collection(db, 'contactActivities'), {
        // Store the contact's own concrete tenantId (never null) so the doc is
        // readable under the top-level contactActivities rule, which gates the
        // read on isTenantAdmin(resource.data.tenantId). A null/mismatched
        // tenantId is why an added activity wrote but never showed in the
        // timeline. Mirrors the donation branch below and the contact writes.
        contactId: selected.id, tenantId: contactTenantId, type: actForm.type,
        description: actForm.description.trim(),
        // 🔴 ALWAYS NULL FOR A GIFT RECORDED HERE. The money lives on the
        // invoice; see this function's header.
        amount: null,
        invoiceId,
        invoiceAmountCents,
        createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid || '',
      });

      // ── 3. The contact's own running total, in DOLLARS, as before. ────────
      if (isDonation) {
        const newTotal = (selected.totalDonated || 0) + donationDollars;
        await setDoc(doc(db, 'contacts', selected.id), {
          firstName: selected.firstName ?? '', lastName: selected.lastName ?? '',
          email: selected.email ?? '', phone: selected.phone ?? '', type: selected.type ?? 'member',
          tenantId: contactTenantId,
          totalDonated: newTotal, lastDonationAt: serverTimestamp(),
        }, { merge: true });
        setSelected({ ...selected, totalDonated: newTotal });
        await queryClient.invalidateQueries({ queryKey: ['contacts', tenantId] });
      }
      await queryClient.invalidateQueries({ queryKey: ['contactActivities', tenantId, selected.id] });
      setShowAddActivity(false);
      setActForm({ type: 'note', description: '', amount: '' });
    } catch (e) {
      // 🔴 VISIBLE, AND THE INPUT IS KEPT. `notifyError` alone dismissed itself
      // and left an admin with a closed dialog and no gift; the banner in the
      // dialog stays until they act on it. `notifyError` is still called so the
      // failure reaches the console/toast path every other write here uses.
      const message = (e as Error)?.message || 'The gift could not be recorded.';
      console.error('Failed to add activity:', e);
      setActivityError(message);
      notifyError('Failed to add activity', e);
    }
    finally { setSavingAct(false); }
  };

  /**
   * THE-369 - 🔴 ONE ACTIVITY OFF THE TIMELINE, AND THE GIFT BEHIND IT.
   *
   * THE FOUNDER: "make sure that if i delete the activity, it is deleted from
   * the dashboard analytics donation as well."
   *
   * ─── 🔴 THE DASHBOARD READS INVOICES, SO THE INVOICE IS WHAT GOES ──────────
   *
   * `addActivity` above is the mirror of this function and says why: the invoice
   * IS the record of the money and the timeline row REFERENCES it, carrying
   * `amount: null` so nothing sums the gift twice. Which means a delete that
   * removed only the row would take the gift off ONE screen and leave it in the
   * dashboard figure, in accounting, in the member's own giving history and on
   * their giving statement - while the church watched the row vanish and
   * reasonably concluded the money had moved with it. Every one of the three
   * reasons to delete a gift (wrong contact, wrong amount, never happened) is
   * wrong in that state.
   *
   * ⚠️ IT IS A ROUTE AND NOT A CLIENT WRITE for THE-350's reason exactly:
   * `firestore.rules` gates `invoices` on `manageAccounting` and this screen's
   * admin holds `manageCRM`. firestore.rules is untouched by this ticket.
   *
   * ─── 🔴 THE ROUTE DECIDES, NOT THIS FUNCTION ───────────────────────────────
   *
   * Which invoices may be reached is the SERVER's judgement - it is the only
   * side that can read the receipt and see its `source`. An event ticket and a
   * processed gift both come back as a REFUSAL with copy already written, and
   * this function renders it rather than second-guessing it. A client that
   * decided would be a second copy of the rule, one release away from
   * disagreeing with the one that enforces it.
   *
   * ─── 🔴 `totalDonated` IS DECREMENTED HERE, AND HERE IS THE ONLY SAFE PLACE ─
   *
   * It is a CLIENT-MAINTAINED running total: `addActivity` bumps it with a
   * read-modify-write of a value this component already holds, and THE-359
   * deliberately did NOT touch it from a server route because a server write
   * would race that one. So the decrement is the same read-modify-write in the
   * same component - symmetric with the bump, and racing nothing. Leaving it
   * would overstate this person's giving permanently and, because
   * `resolvePipelineStage` is a function of it, park them in a pipeline stage
   * their giving no longer supports.
   *
   * ⚠️ `lastDonationAt` IS DELIBERATELY NOT REWOUND. It means "when did they
   * last give", and answering it after a deletion needs the whole timeline
   * rather than the one row in hand. A stale "last gift" date is a display fact;
   * a guessed one would be a new false one.
   */
  // Is the *calling admin's own* Gmail connected? The route keys on the uid in
  // the token, so this answers for this admin only — a colleague's connection
  // never unlocks the button here. Asked once per mount; a network failure
  // leaves it `false`, which shows the connect prompt rather than a send button
  // that would error.
  useEffect(() => {
    let cancelled = false;
    if (!isAuthReady) return;
    // THE-225 — not asked at all on a tier that cannot reach the Gmail card.
    // The answer could only choose between two controls this screen will not
    // render, and a hidden control that still opens its request is the shape
    // THE-193 and THE-213 were both written against.
    if (!canConnectGmail) return;
    (async () => {
      try {
        const res = await authFetch('/api/composio/gmail/status');
        const data = res.ok ? await res.json() : null;
        if (!cancelled) setGmailConnected(!!data?.connected);
      } catch {
        if (!cancelled) setGmailConnected(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthReady, canConnectGmail]);

  const openCompose = () => {
    setEmailForm({ subject: '', body: '' });
    setEmailError(null);
    setShowCompose(true);
  };

  /**
   * Send, then log. Both happen server-side in one request so the timeline
   * entry cannot exist for an email that never went out.
   *
   * On failure the modal STAYS OPEN with the composed text intact and the real
   * error shown. Closing the modal — or clearing the fields — on a failed send
   * is the exact bug that has bitten four times here: an admin believes they
   * replied to a member when nothing was delivered.
   */
  const sendEmail = async () => {
    if (!selected || !emailForm.subject.trim() || !emailForm.body.trim()) return;
    setSendingEmail(true);
    setEmailError(null);
    try {
      const res = await authFetch('/api/crm/send-email', {
        method: 'POST',
        body: JSON.stringify({
          contactId: selected.id,
          subject: emailForm.subject.trim(),
          body: emailForm.body.trim(),
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.sent) {
        if (data?.code === 'not_connected') setGmailConnected(false);
        // Throwing here (rather than returning) keeps every failure on one path.
        throw new Error(data?.error || `The email could not be sent (${res.status}).`);
      }

      // Sent. The activity was written server-side unless `logged` says
      // otherwise — surface that instead of pretending the timeline is complete.
      await queryClient.invalidateQueries({ queryKey: ['contactActivities', tenantId, selected.id] });
      setShowCompose(false);
      setEmailForm({ subject: '', body: '' });
      if (data.logged === false && data.warning) notifyError('Email sent', new Error(data.warning));
    } catch (e) {
      const message = (e as Error)?.message || 'The email could not be sent.';
      console.error('Failed to send email:', e);
      setEmailError(message);
    } finally {
      setSendingEmail(false);
    }
  };

  /**
   * THE-369 - does this row have a MONEY RECORD behind it?
   *
   * `invoiceId` is the whole test, and it is the same one the route applies. A
   * gift recorded through Add Activity -> Donation carries it (THE-350) and so
   * does an event ticket an admin confirmed (THE-359). ⚠️ A STRIPE GIFT DOES
   * NOT: `lib/donation-webhook.ts` writes its CRM row with an `amount` in
   * DOLLARS and no `invoiceId` at all, so a processed gift's row is a plain
   * timeline entry here and its receipt is never in reach of this screen.
   */
  const deleteActivityInvoiceId =
    typeof deleteActivity?.invoiceId === 'string' && deleteActivity.invoiceId.length > 0
      ? deleteActivity.invoiceId
      : null;

  /**
   * The gift's figure, in CENTS, or null.
   *
   * 🔴 RENDERED THROUGH `formatCents` AND NOWHERE ELSE - the one helper that
   * turns cents into dollars. Reading cents with the dollar formatter is exactly
   * `AdminAccounting`'s `$10,550,000` bug, and doing it in a sentence that asks
   * a church to approve destroying a receipt would be that bug with a button
   * under it.
   */
  const deleteActivityCents =
    typeof deleteActivity?.invoiceAmountCents === 'number'
      ? deleteActivity.invoiceAmountCents
      : null;

  /** The row is a gift AND this screen can state what it is worth. */
  const deleteActivityIsGift = !!deleteActivityInvoiceId && deleteActivityCents !== null;

  /**
   * The reason this delete cannot be offered, or `null` when it can.
   *
   * 🔴 ONE CASE, AND IT IS THE ONE TEST 5d IS ABOUT: a row that points at a
   * receipt whose figure this screen cannot read. The confirmation MUST name the
   * amount before a financial record is destroyed, so a dialog that cannot name
   * it must not carry a Delete button at all - the alternative is a church
   * approving the removal of a receipt for an amount nobody showed them.
   *
   * ⚠️ THE ROUTE'S OWN REFUSALS ARE NOT HERE. An event ticket and a processed
   * gift are refused SERVER-SIDE, where the receipt can actually be read, and
   * arrive as an error this dialog renders. Restating them here would be a
   * second copy of a rule that is enforced somewhere else.
   */
  const activityDeleteRefusal: { readonly title: string; readonly body: string } | null =
    !deleteActivity ? null
    : deleteActivityInvoiceId && deleteActivityCents === null ? {
        title: 'This gift\u2019s amount could not be read',
        body:
          'This row points at a receipt on your books, but its amount is not available on '
          + 'this screen \u2014 so there is no way to tell you what deleting it would take out '
          + 'of your accounting. Nothing has been deleted. Reload the timeline and try again.',
      }
    : null;

  const confirmDeleteActivity = async () => {
    if (!deleteActivity || !selected) return;
    // THE GUARD IS HERE, not only in the dialog - the same rule THE-362's
    // `confirmDelete` states. A refusal that lived in the markup alone would be
    // one re-render away from being bypassed, and this is the only thing here
    // that reaches the route.
    if (activityDeleteRefusal) return;
    setDeletingActivity(true);
    setActivityDeleteError(null);
    try {
      const scope = selectedTenantScope(selected, tenantId);
      const res = await authFetch(
        `/api/crm/contact-activities/${encodeURIComponent(deleteActivity.id)}`
        + `?tenantId=${encodeURIComponent(scope)}`,
        { method: 'DELETE' },
      );
      const body = (await res.json().catch(() => null)) as
        { error?: string; invoiceRemoved?: boolean; amountCents?: number | null } | null;
      if (!res.ok) {
        throw new Error(body?.error || `This activity could not be removed (${res.status}).`);
      }

      /**
       * 🔴 ONLY WHEN THE LEDGER REALLY LOST IT. `invoiceRemoved` comes from the
       * transaction that did the deleting, and `amountCents` is the INVOICE's
       * own figure rather than the row's display mirror - so the total is
       * reduced by what the books actually lost. A row with no receipt behind it
       * (a note, or a donation whose invoice was already gone) moves nothing.
       *
       * Floored at zero: a contact whose total was bumped by some other writer's
       * arithmetic must not be driven negative by a correct subtraction here.
       */
      if (body?.invoiceRemoved && typeof body.amountCents === 'number') {
        const newTotal = Math.max(0, (selected.totalDonated || 0) - body.amountCents / 100);
        /**
         * 🔴 ITS OWN try, AND THE MESSAGE IS DIFFERENT, BECAUSE THE CLAIM IS.
         *
         * By this line the route has returned 200: the row and its receipt are
         * ALREADY GONE, atomically. If this running total then fails to write,
         * "this activity could not be removed" is a FALSE STATEMENT on screen —
         * and it is the dangerous direction of false, because a church that
         * believes the delete failed will press Delete again and be told the
         * activity cannot be found.
         *
         * So the two failures are reported as the two different things they are.
         * What is left wrong here is one contact's running total, which is a
         * derived display figure rather than the money: the ledger, the dashboard
         * and the books are all already correct.
         */
        try {
          await setDoc(doc(db, 'contacts', selected.id), {
            firstName: selected.firstName ?? '', lastName: selected.lastName ?? '',
            email: selected.email ?? '', phone: selected.phone ?? '', type: selected.type ?? 'member',
            tenantId: selected.tenantId || tenantId || PLATFORM_TENANT_ID,
            totalDonated: newTotal,
          }, { merge: true });
          setSelected({ ...selected, totalDonated: newTotal });
          await queryClient.invalidateQueries({ queryKey: ['contacts', tenantId] });
        } catch (e) {
          console.error('Failed to correct totalDonated after an activity delete:', e);
          notifyError('The gift was deleted, but this person\u2019s total was not updated', e);
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['contactActivities', tenantId, selected.id] });
      // INSIDE THE `try`, AND THAT IS THE SILENT-FAILURE RULE - #506's bug, one
      // layer up, was this line sitting after the `catch`.
      setDeleteActivity(null);
    } catch (e) {
      const message = (e as Error)?.message || 'This activity could not be removed.';
      console.error('Failed to delete activity:', e);
      setActivityDeleteError(message);
      notifyError('Failed to delete activity', e);
    }
    finally { setDeletingActivity(false); }
  };

  /**
   * ⚠️ THE-369's DELETE LIVES BELOW `sendEmail` AND NOT BESIDE `addActivity`,
   * WHICH IS ITS MIRROR, AND THE REASON IS A GUARD RATHER THAN TASTE.
   *
   * THE-350 asserts the CRM's ledger-first ordering and its kept-input failure
   * path by SLICING this file from `const addActivity = async` to
   * `const sendEmail = async` and reading the last `catch` in the slice. A
   * second async function placed inside that span moves what that guard reads
   * onto code it was never written about - measured, not guessed: it went red
   * on the first arrangement of this ticket, reporting `addActivity` as having
   * lost its error banner when `addActivity` had not changed by one byte.
   *
   * 🔴 SO THIS TICKET MOVED ITS OWN CODE RATHER THAN RELAXING THAT GUARD. The
   * slice still contains exactly the function it names.
   */
  // Pill segmented control for the Contacts / Roles sub-views. Each pill is
  // shown only to admins entitled to that sub-view (Roles lives here rather
  // than as its own top-level tab).
  //
  // THE-277 — Analytics was a third pill here. It is now the `signups` screen,
  // its own nav entry, because it counts MEMBERS (people with accounts) where
  // this screen counts CONTACTS (people the church is working). The `analytics`
  // permission that gated the pill now gates that nav entry in AdminDashboard.
  //
  // 🔴 THE-338 — `min-h-11 min-w-11 sm:min-h-0 sm:min-w-0` on each pill, and
  // BOTH axes are load-bearing. `px-4 py-1.5 text-xs` renders these at about
  // 28px tall, under the 44px phone floor, and THE-308 found a tab that
  // cleared the floor on height while measuring 35.6px WIDE — so height alone
  // is not the check. Released from `sm:` up under Rule 4, which fixes
  // controls at 38px above the phone band so a segmented control does not
  // sprawl on desktop.
  //
  // ⚠️ The founder's report — "in CRM if I press on roles the button switch
  // appears very small" — was NOT this. It was AdminRoles.tsx injecting an
  // unscoped `* { margin: 0; padding: 0 }` that zeroed this control's padding
  // from a sibling subtree; see the note on that file's <style> block. This
  // floor is the second thing found while measuring the first.
  const subTabBar = (
    <div className="flex gap-1 bg-surface-sunken rounded-xl p-1 mb-5 w-fit">
      {canViewContacts && (
        <button
          onClick={() => setCrmSubView('contacts')}
          className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 ${
            crmSubView === 'contacts' ? 'bg-surface-raised shadow-xs text-strong' : 'text-faint'
          }`}
        >
          Contacts
        </button>
      )}
      {canManageRoles && (
        <button
          onClick={() => { setCrmSubView('roles'); setView('list'); setSelected(null); }}
          className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 ${
            crmSubView === 'roles' ? 'bg-surface-raised shadow-xs text-strong' : 'text-faint'
          }`}
        >
          Roles
        </button>
      )}
    </div>
  );

  if (crmSubView === 'roles') {
    return (
      <div ref={scrollRef} className={`w-full ${FORM_CONTAINER}`}>
        {subTabBar}
        {canManageRoles && currentUserRole ? (
          <AdminRoles
            currentUserRole={currentUserRole}
            currentUserPermissions={currentUserPermissions}
            mode="roles"
          />
        ) : (
          <div className="text-center py-16 text-faint">
            <p className="text-sm">You don&apos;t have access to manage roles.</p>
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div ref={scrollRef} className={`w-full ${FORM_CONTAINER}`}>
        {subTabBar}
        <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #B8962E)', borderTopColor: 'transparent' }} /></div>
      </div>
    );
  }

  // A failed contacts read is NOT an empty CRM. Distinct copy, distinct colour,
  // and a retry — never the "add your first contact" empty state, which would
  // invite an admin to re-enter people who are already there but unreadable.
  if (contactsFailed) {
    return (
      <div ref={scrollRef} className={`w-full ${FORM_CONTAINER}`}>
        {subTabBar}
        <div className="bg-red-50 rounded-2xl border border-red-200 shadow-xs p-8 text-center text-red-700">
          <AlertTriangle size={28} className="mx-auto mb-2 opacity-60" />
          <p className="text-sm font-display font-semibold">Couldn&apos;t load contacts</p>
          <p className="text-xs mt-1 text-red-600">
            {(contactsError as Error | null)?.message || 'The contact list could not be read.'}
          </p>
          <button
            onClick={() => refetchContacts()}
            className="mt-3 px-3 py-1.5 rounded-xl text-xs font-semibold border border-red-300 text-red-700 hover:bg-red-100"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (view === 'form') {
    return (
      <div ref={scrollRef} className={`w-full ${FORM_MEASURE}`}>
        {subTabBar}
        <div className="bg-surface-raised rounded-2xl border border-line-hairline shadow-xs p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-muted mb-1 block">First Name *</label>
              <input value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })}
                className="w-full rounded-xl border border-line-hairline px-3 py-2.5 text-sm focus:border-gold focus:outline-hidden" placeholder="First name" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted mb-1 block">Last Name</label>
              <input value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })}
                className="w-full rounded-xl border border-line-hairline px-3 py-2.5 text-sm focus:border-gold focus:outline-hidden" placeholder="Last name" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted mb-1 block">Type</label>
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as Contact['type'] })}
              className="w-full rounded-xl border border-line-hairline px-3 py-2.5 text-sm focus:border-gold focus:outline-hidden bg-surface-raised">
              <option value="member">Member</option>
              <option value="donor">Donor</option>
              <option value="both">Donor & Member</option>
            </select>
          </div>
          {/* Pipeline Stage is not an editable field. It is derived from giving,
              so the form shows where this contact currently sits and why, rather
              than a row of chips that would write a stage nothing reads. Absent
              on a tenant with no donate page: its own explanation ("Set
              automatically from total given ($0)") describes a mechanism that
              tier has no way to feed. */}
          {showGiving && (
          <div>
            <label className="text-xs font-semibold text-muted mb-2 block">Pipeline Stage</label>
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="px-3 py-1.5 rounded-full text-xs font-bold"
                style={{ backgroundColor: stageOf(form).bg, color: stageOf(form).color }}
              >
                {stageOf(form).label}
              </span>
              <span className="text-xs text-faint">
                Set automatically from total given ({fmt(form.totalDonated || 0)}).
              </span>
            </div>
          </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-muted mb-1 block">Email</label>
              <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                className="w-full rounded-xl border border-line-hairline px-3 py-2.5 text-sm focus:border-gold focus:outline-hidden" placeholder="email@example.com" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted mb-1 block">Phone</label>
              <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                className="w-full rounded-xl border border-line-hairline px-3 py-2.5 text-sm focus:border-gold focus:outline-hidden" placeholder="+1 555 000 0000" />
            </div>
          </div>
          <p className="text-xs font-bold text-faint uppercase tracking-wider mt-2 mb-3">Address</p>
          <div>
            <label className="text-xs font-semibold text-muted mb-1 block">Street Address</label>
            <input value={form.address.street || ''} onChange={e => setForm({ ...form, address: { ...form.address, street: e.target.value } })}
              className="w-full rounded-xl border border-line-hairline px-3 py-2.5 text-sm focus:border-gold focus:outline-hidden" placeholder="123 Main St" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted mb-1 block">City</label>
              <input value={form.address.city || ''} onChange={e => setForm({ ...form, address: { ...form.address, city: e.target.value } })}
                className="w-full rounded-xl border border-line-hairline px-3 py-2.5 text-sm focus:border-gold focus:outline-hidden" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted mb-1 block">State</label>
              <input value={form.address.state || ''} onChange={e => setForm({ ...form, address: { ...form.address, state: e.target.value } })}
                className="w-full rounded-xl border border-line-hairline px-3 py-2.5 text-sm focus:border-gold focus:outline-hidden" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted mb-1 block">ZIP</label>
              <input value={form.address.zip || ''} onChange={e => setForm({ ...form, address: { ...form.address, zip: e.target.value } })}
                className="w-full rounded-xl border border-line-hairline px-3 py-2.5 text-sm focus:border-gold focus:outline-hidden" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted mb-1 block">Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
              rows={3} className="w-full rounded-xl border border-line-hairline px-3 py-2.5 text-sm focus:border-gold focus:outline-hidden resize-none"
              placeholder="Any notes about this contact..." />
          </div>
          <div className="space-y-2 pt-2">
            <button onClick={() => setView(isEditing ? 'detail' : 'list')} className="w-full py-3 rounded-xl border border-line-hairline text-sm font-semibold text-muted">Cancel</button>
            <button onClick={handleSave} disabled={saving || !form.firstName.trim()}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}>
              {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Add Contact'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'detail' && selected) {
    return (
      <div ref={scrollRef} className={`w-full ${FORM_MEASURE}`}>
        {subTabBar}

        {/* Hero */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-black text-white flex-shrink-0 overflow-hidden"
              style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}>
              {selected.photoURL ? (
                <img src={selected.photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                selected.firstName?.charAt(0)?.toUpperCase() || '?'
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-2xl font-black text-strong leading-tight truncate">{selected.firstName} {selected.lastName}</h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span data-testid="crm-type-badge" className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${typeColor(selected.type)}`}>
                  {typeLabel(selected.type)}
                </span>
                {selected.memberSince && <span className="text-xs text-faint">· Member since {fmtDate(selected.memberSince)}</span>}
              </div>
              {/* Derived stage — a badge, not a selector, and absent entirely
                  on a tenant with no donate page, where it can only ever read
                  'Member'. Same call as the list's Stage column. */}
              {showGiving && (
                <div className="flex gap-1.5 flex-wrap mt-2">
                  <span
                    className="px-2.5 py-1 rounded-full text-[10px] font-bold"
                    style={{ backgroundColor: stageOf(selected).color, color: '#fff' }}
                  >
                    {stageOf(selected).label}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {/* Never gated by maxContacts. Editing an existing person — including
                the upsert that gives a `users`-only member their first `contacts`
                doc — adds no account, and an over-cap tenant must stay fully
                manageable rather than frozen. */}
            <button data-testid="crm-edit-contact" onClick={() => openEdit(selected)} className="p-2 rounded-xl border border-line-hairline hover:bg-surface-sunken">
              <Edit2 size={14} className="text-muted" />
            </button>
            <button data-testid="crm-delete-contact" onClick={() => setDeleteId(selected.id)} className="p-2 rounded-xl border border-line-hairline hover:bg-red-50">
              <Trash2 size={14} className="text-red-400" />
            </button>
          </div>
        </div>

        {/* Stats strip. The two GIVING_PILLs are the card's copy of the list's
            Given and Last Gift columns and go with them — "$0 total given"
            beside "No donations yet" is a statement about a church that has
            raised nothing, not about one whose plan has no donate page. The
            activity count is NOT giving-shaped (notes, calls, meetings and
            emails all land there) and stays on every tier. */}
        <div className="flex gap-2 flex-wrap mb-5">
          {showGiving && (
            <>
              <span className={GIVING_PILL}>{fmt(selected.totalDonated || 0)} total given</span>
              <span data-testid="crm-last-gift" className={GIVING_PILL}>
                {lastGiftBadge(selected)}
              </span>
            </>
          )}
          {/* Never render "0 activities" off a failed read — that is the lie the
              silent `= []` default used to tell. */}
          {activitiesFailed ? (
            <span className={GIVING_PILL_ERROR}>Activity count unavailable</span>
          ) : (
            <span className={GIVING_PILL}>
              {activitiesLoading ? 'Loading activities…' : `${activities.length} ${activities.length === 1 ? 'activity' : 'activities'}`}
            </span>
          )}
        </div>

        {/* Contact info card */}
        <div className="bg-surface-raised rounded-2xl border border-line-hairline shadow-xs p-4 mb-4">
          <div className="grid grid-cols-2 gap-3">
            {selected.email && (
              <div className="flex items-center gap-2">
                <Mail size={14} className="text-faint flex-shrink-0" />
                <span className="text-sm text-body truncate">{selected.email}</span>
              </div>
            )}
            {selected.phone && (
              <div className="flex items-center gap-2">
                <Phone size={14} className="text-faint flex-shrink-0" />
                <span className="text-sm text-body truncate">{selected.phone}</span>
              </div>
            )}
            {selected.address?.street && (
              <div className="flex items-center gap-2">
                <MapPin size={14} className="text-faint flex-shrink-0" />
                <span className="text-sm text-body truncate">{selected.address.street}</span>
              </div>
            )}
            {selected.address?.city && (
              <div className="flex items-center gap-2">
                <MapPin size={14} className="text-faint flex-shrink-0" />
                <span className="text-sm text-body truncate">
                  {[selected.address.city, selected.address.state].filter(Boolean).join(', ')}
                </span>
              </div>
            )}
          </div>
          {selected.tags && selected.tags.length > 0 && (
            <div className="mt-3 pt-3 border-t border-line-hairline flex flex-wrap gap-1.5">
              {selected.tags.map(tag => (
                <span key={tag} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-surface-sunken text-muted">{tag}</span>
              ))}
            </div>
          )}
          <div className="border-t border-line-hairline pt-3 mt-3">
            <label className="text-xs font-bold text-faint uppercase tracking-wider mb-1 block">Admin Notes</label>
            <textarea
              defaultValue={selected.notes || ''}
              onBlur={async (e) => {
                const val = e.target.value.trim();
                if (val !== (selected.notes || '')) {
                  try {
                    await setDoc(doc(db, 'contacts', selected.id), {
                      firstName: selected.firstName ?? '', lastName: selected.lastName ?? '',
                      email: selected.email ?? '', phone: selected.phone ?? '', type: selected.type ?? 'member',
                      tenantId: selected.tenantId || tenantId || PLATFORM_TENANT_ID,
                      notes: val,
                    }, { merge: true });
                    setSelected({ ...selected, notes: val });
                  } catch (err) { console.error('Failed to save notes:', err); }
                }
              }}
              rows={3}
              className="border-0 focus:outline-hidden text-sm text-body resize-none w-full bg-transparent leading-relaxed"
              placeholder="Add notes about this contact..."
            />
          </div>
        </div>

        {/* Activity Timeline */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-faint uppercase tracking-wider">Activity Timeline</h3>
          <div className="flex items-center gap-2">
            {/* Email action. Three distinct states, and never a button that is
                known to fail: no address on the contact → nothing at all;
                Gmail not connected → a link to Settings; connected → send.
                While `gmailConnected` is still null neither is rendered.
                A FOURTH state above all of them (THE-225): a tier that cannot
                reach the Gmail card in Settings is offered neither control, so
                the link to Settings can never point at a section that is not
                there. See `canConnectGmail`. */}
            {canConnectGmail && selected.email && gmailConnected === true && (
              <button
                onClick={openCompose}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-line-hairline text-muted hover:bg-surface-sunken"
              >
                <Send size={12} /> Email
              </button>
            )}
            {canConnectGmail && selected.email && gmailConnected === false && (
              <button
                onClick={() => navigate('/admin/settings')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-line-hairline text-faint hover:bg-surface-sunken"
              >
                <Send size={12} /> Connect your email
              </button>
            )}
            <button
              onClick={() => setShowAddActivity(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white"
              style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}
            >
              <Plus size={12} /> Add Activity
            </button>
          </div>
        </div>

        {activitiesFailed ? (
          // A failed load is NOT an empty timeline. Distinct copy, distinct
          // colour, and a retry — never the "add the first one" nudge, which
          // would invite an admin to duplicate activities they cannot see.
          <div className="bg-red-50 rounded-2xl border border-red-200 shadow-xs p-8 text-center text-red-700">
            <AlertTriangle size={28} className="mx-auto mb-2 opacity-60" />
            <p className="text-sm font-display font-semibold">Couldn&apos;t load activities</p>
            <p className="text-xs mt-1 text-red-600">
              {(activitiesError as Error | null)?.message || 'The timeline could not be read.'}
            </p>
            <button
              onClick={() => refetchActivities()}
              className="mt-3 px-3 py-1.5 rounded-xl text-xs font-semibold border border-red-300 text-red-700 hover:bg-red-100"
            >
              Try again
            </button>
          </div>
        ) : activitiesLoading ? (
          <div className="bg-surface-raised rounded-2xl border border-line-hairline shadow-xs p-8 flex justify-center">
            <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #B8962E)', borderTopColor: 'transparent' }} />
          </div>
        ) : activities.length === 0 ? (
          <div className="bg-surface-raised rounded-2xl border border-line-hairline shadow-xs p-8 text-center text-faint">
            <Clock size={28} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm font-display">No activities recorded yet — add the first one</p>
          </div>
        ) : (
          <div className="relative pl-6 ml-1 border-l-2 border-line-hairline space-y-5">
            {activities.map(act => (
              <div key={act.id} className="relative">
                <div className="absolute -left-[25px] top-1 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center"
                  style={{ backgroundColor: act.type === 'donation' ? 'var(--brand-color, #B8962E)' : 'var(--surface-chip)' }}>
                  <span className="text-white flex items-center justify-center" style={{ fontSize: 8 }}>
                    {ACTIVITY_ICONS[act.type]}
                  </span>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-bold text-muted capitalize">{act.type}</span>
                    {/*
                      🔴 THE-350 · TWO SHAPES, TWO UNITS, ONE FORMATTER EACH.

                      `amount` is DOLLARS and belongs to every activity written
                      before this ticket and to every Stripe gift the webhook
                      logs — those rows are untouched and still read `fmt`.
                      `invoiceAmountCents` is CENTS and belongs to a gift
                      recorded here, whose money record is the invoice this row
                      points at; it goes through `formatCents`, the one helper
                      that turns cents into dollars, because reading cents with
                      the dollar formatter is exactly the `$10,550,000` bug.
                    */}
                    {act.amount ? (
                      <span className="text-xs font-bold" style={{ color: 'var(--brand-color, #B8962E)' }}>{fmt(act.amount)}</span>
                    ) : typeof act.invoiceAmountCents === 'number' ? (
                      <span className="text-xs font-bold" style={{ color: 'var(--brand-color, #B8962E)' }}>{formatCents(act.invoiceAmountCents)}</span>
                    ) : null}
                    <span className="text-[10px] text-faint ml-auto">{fmtDate(act.createdAt)}</span>
                    {/*
                      🔴 THE-369 · THE ROW ACTION, ON THE INSTALLED PRIMITIVE.

                      A church could not remove a single activity: a note typed
                      on the wrong contact, a call logged twice, a meeting that
                      did not happen were all permanent. This is the way in.

                      ⚠️ A MENU RATHER THAN A BARE BIN ICON. A destructive
                      control sitting open on every row of a timeline is one
                      mis-tap from a deleted gift, and `dropdown-menu` is what
                      this repo installs for a row action - the same ⋯ trigger,
                      the same `min-h-11`/`sm:min-h-0` pair and the same
                      `z-[110]` as `AdminDocs`, whose note on that z-index
                      applies here unchanged.

                      ⚠️ `Button`'s INTRINSIC SIZES ARE 24/28/32/36px AND EVERY
                      ONE IS BELOW BOTH FLOORS (#500), which is why the trigger
                      carries its own: 44px below `sm`, released above it and
                      replaced by `CONTROL_DENSITY.control`, Rule 4's 38px,
                      IMPORTED rather than respelled.
                    */}
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label={`Options for this ${ACTIVITY_NOUNS[act.type]}`}
                        data-activity-menu={act.id}
                        className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg transition-colors hover:bg-surface-sunken sm:min-h-0 sm:min-w-0 sm:px-1.5 ${CONTROL_DENSITY.control}`}
                      >
                        <MoreHorizontal size={16} className="text-muted" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="z-[110] w-48">
                        <DropdownMenuItem
                          data-activity-delete={act.id}
                          className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0"
                          onClick={() => { setActivityDeleteError(null); setDeleteActivity(act); }}
                        >
                          <Trash2 size={15} /> Delete {ACTIVITY_NOUNS[act.type]}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <p className="text-sm text-body">{act.description}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* The "Onboarding Responses" section was removed. Onboarding writes the
            standard questions as TOP-LEVEL user fields (displayName, country,
            city, phone, acceptedJesus) and only writes `onboardingAnswers` when
            a tenant has CUSTOM questions — deliberately, so the map isn't
            polluted with blanks. For every tenant without custom questions the
            field is absent, so this was a guaranteed empty box. The data still
            ships in the users CSV (AdminRoles). Nothing lost. */}

        {/*
          🔴 THE-369 · THE CONFIRMATION, AND FOR A GIFT IT NAMES THE MONEY.

          `z-[220]` sits ABOVE THE-362's contact-delete dialog at `z-[210]` and
          above Add Activity at `z-[200]`, so this is never drawn under a layer
          it was opened from.

          ⚠️ "This cannot be undone" IS NOT ENOUGH, and #506 established that on
          the contact dialog one layer up: a treasurer reading it beside a
          donor's name is entitled to know how far the deletion reaches. For a
          gift it reaches FIVE places at once - the dashboard figure, the books,
          the member's own giving history, their giving statement and the
          receipt numbering - and the copy below names every one of them and the
          AMOUNT, because the church cannot see the receipt from here.

          🔴 THE DELETE BUTTON DOES NOT EXIST WHEN THE AMOUNT CANNOT BE STATED.
          That is `activityDeleteRefusal`, on the `alert` primitive this repo
          installs for a refusal, and it is the structural half of "no receipt is
          ever deleted silently": not a warning that could be ignored, a screen
          with nothing on it that writes.
        */}
        {deleteActivity && (
          <div className="fixed inset-0 z-[220] flex items-end sm:items-center justify-center bg-black/50 p-4">
            <div className="bg-surface-raised rounded-3xl p-6 w-full max-w-md">
              {activityDeleteRefusal ? (
                <>
                  <Alert variant="destructive" data-activity-delete-refused>
                    <AlertTitle>{activityDeleteRefusal.title}</AlertTitle>
                    <AlertDescription>{activityDeleteRefusal.body}</AlertDescription>
                  </Alert>
                  <button
                    onClick={() => { setDeleteActivity(null); setActivityDeleteError(null); }}
                    className={`mt-5 w-full min-h-11 rounded-xl border border-line-hairline text-sm font-semibold text-muted sm:min-h-0 ${CONTROL_DENSITY.control}`}
                  >
                    Close
                  </button>
                </>
              ) : (
                <div>
                  <p className="font-bold text-strong mb-2 font-display text-center">
                    {deleteActivityIsGift
                      ? `Delete this ${formatCents(deleteActivityCents as number)} gift?`
                      : `Delete this ${ACTIVITY_NOUNS[deleteActivity.type]}?`}
                  </p>

                  {deleteActivityIsGift ? (
                    <div data-activity-delete-money>
                      {/*
                        🔴 THE FOUNDER'S DECISION, SPELLED OUT BEFORE IT HAPPENS:
                        "make sure that if i delete the activity, it is deleted
                        from the dashboard analytics donation as well." The
                        dashboard reads INVOICES, so this deletes the receipt -
                        and a church that is not told that would watch the row
                        vanish and assume the figure moved on its own.
                      */}
                      <p className="text-sm text-muted mb-2">
                        This removes the receipt for {formatCents(deleteActivityCents as number)}{' '}
                        from your books, not only this row on the timeline.
                      </p>
                      <p className="text-sm text-muted mb-2">
                        Your dashboard giving figure and your accounting totals both fall by{' '}
                        {formatCents(deleteActivityCents as number)}, the gift leaves this
                        person&rsquo;s own giving history, and a giving statement generated from now
                        on will no longer include it. Its receipt number is not reused, so your
                        receipts will have a gap where this one was.
                      </p>
                      <p className="text-sm text-muted mb-5">
                        This cannot be undone. If the amount was wrong, delete this and record the
                        gift again with the right one.
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted mb-5" data-activity-delete-plain>
                      This removes it from {selected ? 'their' : 'the'} timeline and cannot be
                      undone. It carries no money, so your accounting totals and giving statements
                      do not change.
                    </p>
                  )}

                  {/*
                    🔴 VISIBLE, AND THE ROW IS STILL THERE. #506's bug was a
                    dialog that closed and returned to the list on failure as if
                    it had succeeded. This banner stays until the admin acts on
                    it, the dialog stays open on the row it failed on, and the
                    timeline behind it still holds that row - because nothing was
                    removed optimistically. The route's own refusals (an event
                    ticket, a processed gift) arrive here too, already worded.
                  */}
                  {activityDeleteError && (
                    <Alert variant="destructive" className="mb-4" data-activity-delete-error>
                      <AlertTitle>This activity was not deleted</AlertTitle>
                      <AlertDescription>{activityDeleteError}</AlertDescription>
                    </Alert>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={() => { setDeleteActivity(null); setActivityDeleteError(null); }}
                      disabled={deletingActivity}
                      className={`flex-1 min-h-11 rounded-xl border border-line-hairline text-sm font-semibold text-muted disabled:opacity-50 sm:min-h-0 ${CONTROL_DENSITY.control}`}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={confirmDeleteActivity}
                      disabled={deletingActivity}
                      data-testid="crm-confirm-delete-activity"
                      className={`flex-1 min-h-11 rounded-xl bg-red-500 text-white text-sm font-semibold disabled:opacity-50 sm:min-h-0 ${CONTROL_DENSITY.control}`}
                    >
                      {deletingActivity ? 'Deleting\u2026' : 'Delete'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {showAddActivity && (
          <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/50 p-4">
            <div className="bg-surface-raised rounded-3xl w-full max-w-md">
              <div className="p-5 border-b border-line-hairline"><h3 className="font-bold text-strong font-display">Add Activity</h3></div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-muted mb-2 block">Type</label>
                  {/* 🔴 THE ONE GIVING ELEMENT ON THIS SCREEN THAT WRITES.
                      Choosing `donation` here does not merely label an entry:
                      `addActivity` adds the amount to the contact's
                      `totalDonated` and stamps `lastDonationAt`, which promotes
                      them up the pipeline and into the Donors count. On a
                      tenant with no donate page that is an admin manufacturing
                      a donor the plan says cannot exist — a "Donors: 1" the
                      church could never have earned. The chip is withheld, so
                      the type cannot be selected; `actForm.type` starts at
                      'note' and nothing else sets it.

                      EXISTING donation activities still render in the timeline
                      below, amount and all. This gates the surface that creates
                      one, never the history — a tenant that upgrades finds
                      every gift it ever recorded still there. */}
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {((showGiving
                      ? ['note', 'donation', 'email', 'call', 'meeting']
                      : ['note', 'email', 'call', 'meeting']) as ContactActivity['type'][]).map(t => (
                      <button
                        key={t}
                        onClick={() => setActForm({ ...actForm, type: t })}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize whitespace-nowrap transition-colors ${actForm.type === t ? 'text-white' : 'bg-surface-sunken text-muted'}`}
                        style={actForm.type === t ? { backgroundColor: 'var(--brand-color, #B8962E)' } : undefined}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                {actForm.type === 'donation' && (
                  <div>
                    <label className="text-xs font-semibold text-muted mb-1 block">Amount ($)</label>
                    <input type="number" min={0} value={actForm.amount} onChange={e => setActForm({ ...actForm, amount: e.target.value })}
                      className="w-full rounded-xl border border-line-hairline px-3 py-2.5 text-sm focus:border-gold focus:outline-hidden" placeholder="0.00" />
                    {/*
                      🔴 THE-350 · WHAT A GIFT RECORDED HERE NOW REACHES, said
                      once and said truly. This used to write a timeline entry
                      and nothing else; it now writes the same donation receipt
                      the Stripe webhook writes, which is why every one of these
                      surfaces starts working without a line of new reading.
                    */}
                    <p className="text-[11px] text-muted leading-relaxed mt-2" data-testid="manual-donation-reach">
                      Recording this adds a donation receipt to your books, so the gift counts on your
                      dashboard, in accounting, and on this year&apos;s giving statement.
                    </p>
                    {/*
                      🔴 THE CONSEQUENCE OF NO EMAIL, ON SCREEN, BEFORE THE SAVE.

                      `recipientEmail` is the identity key: `/api/donation-history`
                      matches a member's own receipts by NORMALISED email and
                      refuses an empty caller outright, and the giving-statement
                      generator skips a receipt with no email. So a gift recorded
                      for a contact with no address is real money the church
                      received that its giver can never see.

                      ⚠️ THE GIFT IS STILL RECORDED, deliberately. Refusing would
                      lose the church's own record of a cash gift from someone
                      who has no email — it belongs on the dashboard and in the
                      books whether or not anyone can be shown a receipt. What is
                      not acceptable is recording it silently, which is the quiet
                      lie this ticket exists to remove. So it is named here, in
                      the dialog, where the decision is still reversible: adding
                      an email to the contact first is one screen away.
                    */}
                    {!(selected?.email || '').trim() && (
                      <div
                        className="flex gap-2 rounded-xl border border-line-hairline bg-surface-tint p-3 mt-2"
                        data-testid="manual-donation-no-email"
                      >
                        <AlertTriangle size={14} className="text-gold shrink-0 mt-0.5" aria-hidden="true" />
                        <p className="text-[11px] text-body leading-relaxed">
                          <b className="text-strong">This contact has no email address.</b> The gift will still
                          count on your dashboard, in accounting and on your giving statements &mdash; but{' '}
                          {selected?.firstName || 'this person'} will never see it in their own donation history,
                          and no receipt can reach them. Add an email to the contact first if they should.
                        </p>
                      </div>
                    )}
                    {/* 🔴 THE-368 — RECORDING A GIFT, and this is the one
                        surface in the app that gets that page. The entry
                        HAPPENS here: this is the amount field, and pressing
                        save writes the donation receipt. The page is "the exact
                        steps, and the email-match caveat" — which is precisely
                        the pair of things the two notes above state in short,
                        so an admin who wants the long form has somewhere to go
                        without either note growing.

                        ⚠️ INSIDE THE `donation` BRANCH, so it is drawn only
                        when the type chosen is a gift. On a note, a call or a
                        meeting there is no gift being recorded and the link
                        would be an answer to a question nobody asked. */}
                    <GivingDocsLink page="recordingAGift" className="mt-2" />
                  </div>
                )}
                {/*
                  🔴 THE-350 · A FAILED WRITE SURFACES, AND THE INPUT IS KEPT.
                  `role="alert"` so it is announced rather than merely drawn; the
                  dialog stays open and the typed amount and description are
                  still in their fields above.
                */}
                {activityError && (
                  <div
                    role="alert"
                    className="flex gap-2 rounded-xl border border-danger bg-danger-tint p-3"
                    data-testid="manual-donation-error"
                  >
                    <AlertTriangle size={14} className="text-danger shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <p className="text-xs font-semibold text-danger-strong">Not recorded</p>
                      <p className="text-xs text-danger-strong mt-0.5">{activityError}</p>
                      <p className="text-[11px] text-danger mt-1">
                        Nothing was saved &mdash; what you typed has been kept, so you can try again.
                      </p>
                    </div>
                  </div>
                )}
                <div>
                  <label className="text-xs font-semibold text-muted mb-1 block">Description *</label>
                  <div className="bg-surface-tint rounded-xl p-3">
                    <textarea value={actForm.description} onChange={e => setActForm({ ...actForm, description: e.target.value })}
                      rows={3} className="border-0 focus:outline-hidden text-sm text-body resize-none w-full bg-transparent"
                      placeholder="What happened?" />
                  </div>
                </div>
              </div>
              <div className="p-5 border-t border-line-hairline space-y-2">
                <button onClick={() => { setShowAddActivity(false); setActivityError(null); }} className="w-full py-2.5 rounded-xl border border-line-hairline text-sm font-semibold text-muted">Cancel</button>
                <button onClick={addActivity} disabled={savingAct || !actForm.description.trim()}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}>
                  {savingAct ? 'Saving...' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        )}

        {showCompose && (
          <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/50 p-4">
            <div className="bg-surface-raised rounded-3xl w-full max-w-md">
              <div className="p-5 border-b border-line-hairline"><h3 className="font-bold text-strong font-display">Send Email</h3></div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-muted mb-1 block">To</label>
                  {/* Read-only on purpose. The server resolves the recipient
                      from the contact document and ignores any address in the
                      request, so an editable field here would be a lie. */}
                  <div className="bg-surface-tint rounded-xl px-3 py-2.5 text-sm text-body truncate">
                    {selected.email}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted mb-1 block">Subject *</label>
                  <input
                    value={emailForm.subject}
                    onChange={e => setEmailForm({ ...emailForm, subject: e.target.value })}
                    className="w-full rounded-xl border border-line-hairline px-3 py-2.5 text-sm focus:border-gold focus:outline-hidden"
                    placeholder="Subject line"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted mb-1 block">Message *</label>
                  <div className="bg-surface-tint rounded-xl p-3">
                    <textarea
                      value={emailForm.body}
                      onChange={e => setEmailForm({ ...emailForm, body: e.target.value })}
                      rows={6}
                      className="border-0 focus:outline-hidden text-sm text-body resize-none w-full bg-transparent"
                      placeholder="Write your message..."
                    />
                  </div>
                </div>
                {/* A failed send is loud, and the text above is still there. */}
                {emailError && (
                  <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3">
                    <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-red-700">Not sent</p>
                      <p className="text-xs text-red-600 mt-0.5">{emailError}</p>
                      <p className="text-[11px] text-red-500 mt-1">Your message has been kept — you can try again.</p>
                    </div>
                  </div>
                )}
                <p className="text-[11px] text-faint">
                  Sends from your connected Gmail account and is added to this contact&apos;s timeline.
                </p>
              </div>
              <div className="p-5 border-t border-line-hairline space-y-2">
                <button onClick={() => setShowCompose(false)} disabled={sendingEmail}
                  className="w-full py-2.5 rounded-xl border border-line-hairline text-sm font-semibold text-muted disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={sendEmail} disabled={sendingEmail || !emailForm.subject.trim() || !emailForm.body.trim()}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: 'var(--brand-color, #B8962E)' }}>
                  {sendingEmail ? 'Sending...' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        )}

        {deleteDialog}
      </div>
    );
  }

  const totalGiven = contacts.reduce((s, c) => s + (c.totalDonated || 0), 0);
  const memberCount = contacts.filter(c => c.type === 'member' || c.type === 'both').length;
  const donorCount = contacts.filter(c => c.type === 'donor' || c.type === 'both').length;
  // Counts contacts who have actually given $10,000+, not contacts an admin once
  // tagged as champions. This stat was the clearest symptom of the stored stage:
  // it reported button presses as a giving metric.
  const championCount = contacts.filter(c => resolvePipelineStage(c.totalDonated) === 'champion').length;

  // How much of the church the list is actually showing.
  //
  // The old failure was silence: past the limit people simply were not there,
  // with nothing on screen to say so, so a truncated list and a complete one
  // rendered identically. Everything below exists to make those two states
  // distinguishable — and to say it with the REAL total, not the ceiling.
  //
  // Note the two counts are reported separately and never summed. The list is a
  // merge: someone with both a `contacts` row and a `users` row is one row here,
  // so `contactRecords + memberAccounts` would overcount every member who has
  // both. Each figure is exact about its own collection; the head-count that is
  // exact is `contacts.length`, and only while nothing is truncated.
  const listIsPartial = !!counts && (counts.contactsTruncated || counts.usersTruncated);
  const nf = (n: number) => n.toLocaleString();

  // Three of these four tiles are giving figures — Donors counts the `donor` /
  // `both` types a gift creates, Total Given sums `totalDonated`, and Champions
  // is `resolvePipelineStage` reporting who has crossed the $10,000 mark. On a
  // tenant with no donate page all three are pinned at zero forever, so they
  // are dropped rather than shown empty: a row of zeroes reads as a church that
  // has raised nothing, which is a different and much worse statement than a
  // church whose plan does not do fundraising. Members is the tier's actual
  // roster and stays.
  const stats: { label: string; value: React.ReactNode; icon: React.ReactNode }[] = [
    { label: 'Members', value: memberCount, icon: <Users size={15} /> },
    ...(showGiving
      ? [
          { label: 'Donors', value: donorCount, icon: <Heart size={15} /> },
          { label: 'Total Given', value: fmt(totalGiven), icon: <DollarSign size={15} /> },
          { label: 'Champions', value: championCount, icon: <Award size={15} /> },
        ]
      : []),
  ];

  return (
    <div ref={scrollRef} className={`w-full ${FORM_CONTAINER}`}>
      {subTabBar}

      {/* Stat cards. Rule 4 (form-layout.ts) owns the desktop gaps: `gap-4` is a
          rem gap, so it renders 16px on a tablet and 14.5px on a monitor — the
          same split the container measures were moved off. The column count is
          untouched. */}
      {/* Column count follows the tile count rather than being fixed at four,
          so a tier without the giving tiles gets one full-width card instead of
          one card and three empty grid cells. Both class strings are written
          out whole — Tailwind scans source text, so an interpolated
          `lg:grid-cols-${n}` would never be generated. */}
      <div className={`grid ${stats.length > 1 ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1'} gap-4 mb-6 ${CONTROL_DENSITY.rowGap} ${CONTROL_DENSITY.columnGap}`}>
        {stats.map(s => (
          <div key={s.label} className="bg-surface-raised rounded-brand-lg border border-line shadow-[var(--ds-sh-sm)] p-5">
            <div className="flex items-start justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">{s.label}</p>
              <span className="text-faint">{s.icon}</span>
            </div>
            <p className="font-display text-[2rem] font-light text-strong mt-2 leading-none">{s.value}</p>
          </div>
        ))}
      </div>

      {/*
        🔴 THE-249 — why a member who HAS given can read $0 here.

        Every giving figure on this screen is a function of
        `contacts.totalDonated`, and exactly two things write it: the Stripe
        donation webhook, and this screen's own Add Activity → Donation. A gift
        sent through one of a church's own payment links (see `GIVING_PROVIDERS`)
        reaches neither, so the giver sits at $0 given, no last gift and the
        Member stage — indistinguishable from someone who has never given, and
        the reading a church reaches on its own is that the CRM is broken.

        ⚠️ SECTION-LEVEL AND CONDITIONAL, not per contact and not a constant.
        Per-contact would repeat the same sentence on every contact opened, and
        the fact is not about any one of them — it is about what the totals
        above are made of, which is why it sits under the tiles that show them.
        Conditional on the church actually publishing links (see
        `hasManualGivingLinks`) so the churches with no gap never see it.

        The remedy is named, not gestured at: Add Activity → Donation on the
        contact is a real control on this screen, gated on the same
        `showGiving`, so there is no tier that reads this and cannot act on it.
      */}
      {/*
        🔴 THE-338 — COLLAPSED, NOT SHORTENED, AND NOT DELETED.

        The founder's note was "make that disclaimer in CRM collapsible": six
        lines on a phone, above the contact list, on every visit. The fix is
        the fold, and it is deliberately ONLY the fold — every word THE-249
        wrote is still here, byte for byte, and simply moved inside the panel.
        Shortening it would be editing a true and load-bearing explanation to
        buy vertical space, which is the one thing the note did not ask for.

        WHAT STAYS VISIBLE WHEN IT IS SHUT is THE-249's own opening sentence,
        unchanged. An admin who never opens the fold has still read the fact
        that changes how they read the totals above; what the fold hides is
        the WHY and the remedy, which is the half you only need once. Same
        shape, and the same reasoning, as the disclosure AdminDonations
        already ships — this reuses that pattern rather than inventing a
        second one.

        ⚠️ Still gated on `hasManualGivingLinks`, and that gate is the answer
        to "should a church with no payment links see this at all": it never
        has and still does not. The fold is for the churches that DO publish
        links, who are the only ones this sentence is true of.
      */}
      {showGiving && hasManualGivingLinks && (
        <Collapsible
          data-testid="crm-manual-giving"
          className="mb-6 rounded-brand-lg border border-line bg-surface-sunken"
        >
          <CollapsibleTrigger
            data-testid="crm-manual-giving-toggle"
            className={`group flex w-full items-start gap-2.5 px-4 py-3 text-left text-[13px] text-body min-h-11 sm:min-h-0 ${CONTROL_DENSITY.control}`}
          >
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-gold" aria-hidden="true" />
            <span className="font-semibold flex-1">
              Gifts sent through your own payment links are not counted here.
            </span>
            <ChevronDown
              size={16}
              className="mt-0.5 shrink-0 text-faint transition-transform group-data-[panel-open]:rotate-180"
              aria-hidden="true"
            />
          </CollapsibleTrigger>
          {/* `keepMounted` so the full explanation is in the DOM whether or not
              the fold is open — THE-249's text must remain findable and
              readable to assistive tech, not conjured on expand. */}
          <CollapsibleContent keepMounted data-testid="crm-manual-giving-panel">
            <div className="px-4 pb-3 pl-[42px] text-[13px] text-body">
              Harvest never sees a {GIVING_PROVIDER_NAMES_OR} gift, so the member who sent
              one stays at $0 total given, with no last gift and the Member stage. To record it,
              open their contact, press Add Activity, choose Donation and enter the amount.
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Coverage line — how much of the church this list is showing.
          Renders only once the server-side counts arrive; a failed count costs
          the line, never the list. When the list is short of the true totals
          this is a warning, not a footnote: it names the real numbers AND warns
          that search, the type filter and the stat cards above all see only the
          loaded rows. A search that quietly covers half the church looks
          authoritative, which is worse than a list that admits it is short. */}
      {counts && (
        <div
          data-testid="crm-coverage"
          className={`mb-6 flex items-start gap-2.5 rounded-brand-lg border px-4 py-3 text-[13px] ${
            listIsPartial
              ? 'border-amber-300 bg-amber-50 text-amber-900'
              : 'border-line bg-surface-sunken text-faint'
          }`}
        >
          {listIsPartial && <AlertTriangle size={15} className="mt-0.5 shrink-0" />}
          <div>
            {listIsPartial ? (
              <>
                <span className="font-semibold">
                  Showing {nf(contacts.length)} {contacts.length === 1 ? 'person' : 'people'} — this list is incomplete.
                </span>{' '}
                {counts.platformWide
                  ? `Across all churches there are ${nf(counts.contactRecords)} contact records and ${nf(counts.memberAccounts)} member accounts.`
                  : `This church has ${nf(counts.contactRecords)} contact records and ${nf(counts.memberAccounts)} member accounts.`}{' '}
                The CRM loads at most {nf(CRM_FETCH_LIMIT)} of each, so search, the
                type filter and the totals above cover only the rows loaded here.
              </>
            ) : counts.platformWide ? (
              <>
                Showing {nf(contacts.length)} platform {contacts.length === 1 ? 'person' : 'people'}.
                Across all churches: {nf(counts.contactRecords)} contact records and{' '}
                {nf(counts.memberAccounts)} member accounts.
              </>
            ) : (
              <>
                Showing all {nf(contacts.length)} {contacts.length === 1 ? 'person' : 'people'} —{' '}
                {nf(counts.contactRecords)} contact records and {nf(counts.memberAccounts)} member
                accounts, merged (anyone with both counts once).
              </>
            )}
          </div>
        </div>
      )}

      {/* maxContacts — said clearly, ONCE. Not a running "142 of 150" meter on
          every open: this appears only at the cap, where it is news the admin has
          to act on. It states what does not count (donors), because seeing more
          people listed than the plan allows otherwise reads as a bug, and it
          promises nothing that isn't built — no price, no add-on. Everyone
          already in the list keeps their place and stays editable. */}
      {atContactLimit && (
        <div
          data-testid="crm-contact-limit"
          className="mb-6 flex items-start gap-2.5 rounded-brand-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900"
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">
              {nf(accountsUsed)} member {accountsUsed === 1 ? 'account' : 'accounts'} in
              use — you&apos;ve reached your plan&apos;s limit.
            </span>{' '}
            {contactLimitNotice} Adding contacts by hand is paused until then —
            everyone already here stays, and people can still create their own
            accounts.
          </div>
        </div>
      )}

      {/* Search + filters + view toggle + add */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        {/* Rule 2 (form-layout.ts): a name or an email is a `long` value, so the
            field stops at 440px instead of absorbing every pixel the toolbar has
            spare. `flex-1` still governs below `sm:`, where the phone wants it
            full width. Rule 4 gives it the same 38px box every other desktop
            control has; `sm:py-0` is part of that token, so the padding that
            sets today's height is zeroed with it rather than left to fight. */}
        <div className={`relative flex-1 min-w-[220px] ${FIELD_WIDTH.long}`}>
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className={`w-full bg-surface-raised pl-11 pr-4 py-3 text-sm border border-line rounded-brand-lg text-strong placeholder:text-faint focus:outline-hidden focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_35%,transparent)] focus:border-transparent ${CONTROL_DENSITY.control}`} />
        </div>
        {/* Type filter segmented. The Donors segment is a filter for a record
            this tenant cannot produce, so it goes with the tiles — leaving All
            and Members, which on such a tenant genuinely differ (All includes
            rows whose `type` is unset or unrecognised). The `filter` state is
            unaffected: it starts at 'all' and 'donor' is only ever set by the
            button that is no longer rendered. */}
        <div className="flex gap-0.5 bg-surface-sunken rounded-lg p-1 shrink-0">
          {(([['all', 'All'], ['member', 'Members'], ...(showGiving ? [['donor', 'Donors']] : [])]) as ['all' | Contact['type'], string][]).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setFilter(val)}
              className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${filter === val ? 'bg-surface-raised shadow-xs text-strong' : 'text-faint'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {/* List / Pipeline view toggle. The pipeline's three columns ARE the
            giving ladder — `resolvePipelineStage` reads `totalDonated` and
            nothing else — so on a tenant with no donate page the board is one
            column holding every contact and two that can never fill. The toggle
            goes and the list stands alone; `KanbanBoard`, `STAGES` and
            `resolvePipelineStage` are untouched and the board returns whole on
            an upgrade. `listMode` starts at 'list' and is only moved by the
            button below. */}
        {showGiving && (
        <div className="flex gap-0.5 bg-surface-sunken rounded-lg p-1 shrink-0">
          <button onClick={() => setListMode('list')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${listMode === 'list' ? 'bg-surface-raised shadow-xs text-strong' : 'text-faint'}`}>
            <List size={13} /> List
          </button>
          <button onClick={() => setListMode('kanban')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${listMode === 'kanban' ? 'bg-surface-raised shadow-xs text-strong' : 'text-faint'}`}>
            <LayoutGrid size={13} /> Pipeline
          </button>
        </div>
        )}
        {/* THE-74 — import a member list. Sits beside the manual add because it
            is the same act at a different scale, and carries the SAME cap gate:
            disabled at the limit, with `contactLimitMessage` on hover. Secondary
            styling (a bordered button, not the brand fill) so the primary action
            on this toolbar stays singular. */}
        <button
          data-testid="crm-import-contacts"
          onClick={openImport}
          disabled={atContactLimit}
          title={atContactLimit ? contactLimitNotice : undefined}
          className={`shrink-0 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-brand border border-line bg-surface-raised text-[13px] font-semibold text-muted transition-colors hover:bg-surface-sunken disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface-raised ${CONTROL_DENSITY.action}`}
        >
          <Upload size={16} /> Import CSV
        </button>
        {/* At the cap this is disabled and says why on hover — the same shape the
            Roles screen uses for maxAdmins. It is never hidden: an admin who
            cannot find the button learns nothing, and the disabled state plus the
            notice above is how they find out they need a bigger plan. */}
        <button
          data-testid="crm-add-contact"
          onClick={openNewContact}
          disabled={atContactLimit}
          title={atContactLimit ? contactLimitNotice : undefined}
          className={`shrink-0 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-brand text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:opacity-40 ${CONTROL_DENSITY.action}`}
          style={{ backgroundColor: 'var(--brand-color, #C9963A)' }}
        >
          <Plus size={16} /> Add contact
        </button>
      </div>

      {listMode === 'kanban' && showGiving ? (
        <KanbanBoard
          contacts={filtered}
          stages={STAGES}
          onOpenContact={openDetail}
        />
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-faint">
          <Users size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium font-display">{search || filter !== 'all' ? 'No contacts match' : 'No contacts yet'}</p>
          {!search && filter === 'all' && (
            <p className="text-sm mt-1">
              {showGiving ? 'Add your first donor or member' : 'Add your first member'}
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Mobile contact list — mockup card list: each row is an avatar disc +
              name/email, then a right column with the type badge (member→sky,
              donor→gold, both→field via TYPE_COLORS), the pipeline stage dot +
              label, and total given in field-green. Same `filtered` data and the
              same openDetail handler as the desktop table below. */}
          <div className="lg:hidden bg-surface-raised rounded-brand-xl border border-line shadow-[var(--ds-sh-sm)] overflow-hidden">
            {filtered.map((c, i) => {
              const stage = stageOf(c);
              return (
                <button
                  key={c.id}
                  onClick={() => openDetail(c)}
                  className={`w-full flex items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-wheat-50 ${i ? 'border-t border-line' : ''}`}
                >
                  <span className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 overflow-hidden" style={{ backgroundColor: 'var(--brand-color, #C9963A)' }}>
                    {c.photoURL ? (
                      <img src={c.photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      c.firstName?.charAt(0)?.toUpperCase() || '?'
                    )}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-strong truncate">{c.firstName} {c.lastName}</span>
                    {c.email && <span className="block text-xs text-faint truncate">{c.email}</span>}
                  </span>
                  {/* The Type badge stays on every tier — see `showGiving`.
                      The stage and the total beside it are the giving figures
                      the desktop table drops in its Stage / Given / Last Gift
                      columns; the phone shows the same three facts stacked, so
                      it drops the same three. */}
                  <span className="flex flex-col items-end gap-1 shrink-0">
                    <span data-testid="crm-type-badge" className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${typeColor(c.type)}`}>{typeLabel(c.type)}</span>
                    {showGiving && (
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-muted">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stage.color }} />
                        {stage.label}
                      </span>
                    )}
                    {showGiving && c.totalDonated > 0 && <span className="text-[11px] font-semibold text-field-700">{fmt(c.totalDonated)}</span>}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Desktop table — existing approved layout, unchanged (now lg-only). */}
          <div className="hidden lg:block bg-surface-raised rounded-brand-lg border border-line shadow-[var(--ds-sh-sm)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[720px]">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Contact</th>
                  <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Type</th>
                  {/* Stage / Given / Last Gift are the three giving columns. On
                      a tenant with no donate page Stage is 'Member' on every
                      row by construction, Given is an em dash on every row and
                      Last Gift likewise — three columns of the same non-answer,
                      taking half the table's width. Dropped together; Contact
                      and Type carry the whole list on such a tier and the
                      table's `min-w-[720px]` still holds them comfortably. */}
                  {showGiving && (
                    <>
                      <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Stage</th>
                      <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em] text-right">Given</th>
                      <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em] text-right">Last Gift</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map(c => {
                  const stage = stageOf(c);
                  return (
                    <tr key={c.id} onClick={() => openDetail(c)} className="hover:bg-[color-mix(in_srgb,var(--surface-sunken)_60%,transparent)] transition-colors cursor-pointer">
                      <td className="px-6 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 overflow-hidden" style={{ backgroundColor: 'var(--brand-color, #C9963A)' }}>
                            {c.photoURL ? (
                              <img src={c.photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                              c.firstName?.charAt(0)?.toUpperCase() || '?'
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-strong truncate">{c.firstName} {c.lastName}</p>
                            {c.email && <p className="text-xs text-faint truncate">{c.email}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-3.5">
                        <span data-testid="crm-type-badge" className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${typeColor(c.type)}`}>{typeLabel(c.type)}</span>
                      </td>
                      {showGiving && (
                        <>
                          <td className="px-6 py-3.5">
                            <span className="inline-flex items-center gap-1.5 text-sm text-muted">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: stage.color }} />
                              {stage.label}
                            </span>
                          </td>
                          <td className="px-6 py-3.5 text-right">
                            <span className={`text-sm font-semibold ${c.totalDonated > 0 ? 'text-strong' : 'text-faint'}`}>{c.totalDonated > 0 ? fmt(c.totalDonated) : '—'}</span>
                          </td>
                          <td className="px-6 py-3.5 text-right">
                            <span data-testid="crm-last-gift-cell" className="text-sm text-faint">{lastGiftCell(c)}</span>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}

      {/* ── THE-74 — the import panel ──────────────────────────────────────────
          Upload → map → preview → import, in that order and on one surface, so
          the admin can still see the file they chose while they check the rows
          it produced.

          Every colour here is either a surface/text token or one of the two
          class sets this screen already uses for an error and a warning — no
          literal, no new colour, so the dark-mode sweep landing in this file
          catches them with everything else. */}
      {showImport && (
        <div
          data-testid="crm-import-modal"
          className="fixed inset-0 z-[210] flex items-end sm:items-center justify-center bg-black/50 p-4"
        >
          <div className="bg-surface-raised rounded-3xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="p-5 border-b border-line-hairline">
              <h3 className="font-bold text-strong font-display">Import contacts from a spreadsheet</h3>
              {/* Said up front, because it is the question a church asks about
                  its member list before it asks anything else. */}
              <p className="text-[11px] text-faint mt-1">
                Your file is read here in your browser and is never uploaded. Only the
                contacts themselves are saved.
              </p>
            </div>

            <div className="p-5 space-y-5 overflow-y-auto">
              {/* ── 1. the file ─────────────────────────────────────────────── */}
              <div>
                <label className="text-xs font-semibold text-muted mb-1 block">CSV file</label>
                <input
                  data-testid="crm-import-file"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={e => { void onImportFile(e.target.files?.[0]); }}
                  className="w-full rounded-xl border border-line-hairline px-3 py-2.5 text-sm text-body file:mr-3 file:rounded-lg file:border-0 file:bg-surface-sunken file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-muted"
                />
                {importFileName && (
                  <p className="text-[11px] text-faint mt-1">{importFileName}</p>
                )}
              </div>

              {/* A file that cannot become contacts says which mistake it is —
                  empty and header-only are different problems. */}
              {importError && (
                <div
                  data-testid="crm-import-error"
                  className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3"
                >
                  <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-red-700">Nothing to import</p>
                    <p className="text-xs text-red-600 mt-0.5">{importError}</p>
                  </div>
                </div>
              )}

              {importTable && (
                <>
                  {/* ── 2. the mapping ──────────────────────────────────────────
                      🔴 THE USER MAPS. Nothing is guessed from a heading name.
                      Churches export as `First Name`, `Given Name`, `Primary
                      Email`, `Email Address`, `Home Phone` — or with no headings
                      worth the name at all. A guess that is right most of the
                      time silently files the tenth church's phone numbers into
                      its notes field. */}
                  <div>
                    <p className="text-xs font-bold text-faint uppercase tracking-wider mb-1">
                      Match your columns
                    </p>
                    <p className="text-[11px] text-faint mb-3">
                      Pick which column in your file holds each field. Anything left as
                      “Not imported” is ignored. First name is required.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {IMPORT_FIELDS.map((field: ImportField) => (
                        <div key={field}>
                          <label className="text-[11px] font-semibold text-muted mb-1 block">
                            {IMPORT_FIELD_LABELS[field]}
                            {field === REQUIRED_IMPORT_FIELD && ' *'}
                          </label>
                          <select
                            data-testid={`crm-import-map-${field}`}
                            value={mapping[field] ?? ''}
                            onChange={e => setMapping(prev => {
                              const next: ColumnMapping = { ...prev };
                              if (e.target.value === '') delete next[field];
                              else next[field] = Number(e.target.value);
                              return next;
                            })}
                            className="w-full rounded-xl border border-line-hairline px-3 py-2 text-xs bg-surface-raised text-body focus:border-gold focus:outline-hidden"
                          >
                            <option value="">Not imported</option>
                            {importTable.headers.map((h, i) => (
                              <option key={`${field}-${i}`} value={i}>{columnLabel(h, i)}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ── 3. the type ─────────────────────────────────────────────
                      🔴 NO PRE-SELECTION. An unset `type` renders a blank badge
                      (THE-150), so every imported row must carry one — but the
                      importer must not INVENT it either. The manual form defaults
                      a new contact to Member, which is fair about a record being
                      typed in by hand; applied to a file, it would label a whole
                      congregation as members on the church's behalf. So the
                      import button stays disabled until this is answered. */}
                  <div>
                    <label className="text-xs font-semibold text-muted mb-1 block">
                      Type for these contacts *
                    </label>
                    <select
                      data-testid="crm-import-type-default"
                      value={importType}
                      onChange={e => setImportType(e.target.value as Contact['type'] | '')}
                      className="w-full rounded-xl border border-line-hairline px-3 py-2.5 text-sm bg-surface-raised text-body focus:border-gold focus:outline-hidden"
                    >
                      <option value="">Choose a type…</option>
                      {CONTACT_TYPE_VALUES.map(t => (
                        <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                      ))}
                    </select>
                    <p className="text-[11px] text-faint mt-1">
                      {typeof mapping.type === 'number'
                        ? 'Used for any row whose Type column is empty or holds something else. Rows that name a type keep theirs.'
                        : 'Applied to every row. Map a Type column above if your file already says.'}
                    </p>
                  </div>

                  {/* ── 4. the preview ──────────────────────────────────────────
                      Nothing is written before this is on screen. It shows the
                      values AS MAPPED — including the type each row will carry
                      and where that type came from — so an admin who lined a
                      column up wrongly sees it here rather than in their CRM. */}
                  {importPlan ? (
                    <div>
                      <p className="text-xs font-bold text-faint uppercase tracking-wider mb-2">
                        Preview
                      </p>
                      <div className="rounded-xl border border-line overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[560px]">
                          <thead>
                            <tr className="border-b border-line">
                              {['Line', 'Name', 'Email', 'Phone', 'Type'].map(h => (
                                <th key={h} className="px-3 py-2 text-[11px] font-semibold text-muted uppercase tracking-wider">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line">
                            {importPlan.toWrite.slice(0, 5).map(row => (
                              <tr key={row.line} data-testid="crm-import-preview-row">
                                <td className="px-3 py-2 text-[11px] text-faint">{row.line}</td>
                                <td className="px-3 py-2 text-xs text-strong">
                                  {[row.firstName, row.lastName].filter(Boolean).join(' ')}
                                </td>
                                <td className="px-3 py-2 text-xs text-body">{row.email || '—'}</td>
                                <td className="px-3 py-2 text-xs text-body">{row.phone || '—'}</td>
                                <td className="px-3 py-2">
                                  <span className="text-xs font-semibold text-strong">
                                    {typeLabel(row.type)}
                                  </span>
                                  <span data-testid="crm-import-type-source" className="block text-[11px] text-faint">
                                    {row.typeSource === 'file' ? 'from your file' : 'your choice'}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p data-testid="crm-import-counts" className="text-[11px] text-faint mt-2">
                        {importPlan.toWrite.length.toLocaleString()} to import
                        {importPlan.toWrite.length > 5 && ` (showing the first 5)`}
                        {countSkips(importPlan.skipped, 'duplicate-in-crm') > 0 &&
                          ` · ${countSkips(importPlan.skipped, 'duplicate-in-crm').toLocaleString()} already in your CRM, matched by email`}
                        {countSkips(importPlan.skipped, 'duplicate-in-file') > 0 &&
                          ` · ${countSkips(importPlan.skipped, 'duplicate-in-file').toLocaleString()} listed more than once in your file`}
                        {countSkips(importPlan.skipped, 'no-name') > 0 &&
                          ` · ${countSkips(importPlan.skipped, 'no-name').toLocaleString()} with no first name`}
                      </p>

                      {/* The rows a second upload WOULD double. Said before the
                          import, not discovered after it. */}
                      {importPlan.unmatchable.length > 0 && (
                        <p data-testid="crm-import-unmatchable" className="text-[11px] text-amber-900 mt-2">
                          {importPlan.unmatchable.length.toLocaleString()} of these have no email
                          address. They will be imported, but they cannot be matched against your
                          CRM — uploading this file again would add them a second time.
                        </p>
                      )}

                      {/* The dedupe index is the loaded list, and the loaded list
                          has a ceiling. Where that ceiling bites, say so. */}
                      {listIsPartial && (
                        <p data-testid="crm-import-truncation" className="text-[11px] text-amber-900 mt-2">
                          This CRM holds more people than it can load at once, so the
                          duplicate check covers only the {nf(contacts.length)} loaded here.
                          Someone beyond that may be imported again.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-[11px] text-faint">
                      Choose a First name column and a type to see what will be imported.
                    </p>
                  )}
                </>
              )}

              {/* ── 5. what actually happened ───────────────────────────────────
                  Never silence. Shaped after the SMS broadcast's partial-send
                  report (THE-29) — a count of what worked, then a clause for
                  every way it fell short. */}
              {importResult && (
                <div
                  data-testid="crm-import-result"
                  className={`flex gap-2 rounded-xl border p-3 ${
                    importResult.ok
                      ? 'border-line bg-surface-sunken'
                      : 'border-amber-300 bg-amber-50'
                  }`}
                >
                  {!importResult.ok && <AlertTriangle size={14} className="text-amber-900 flex-shrink-0 mt-0.5" />}
                  <p className={`text-xs ${importResult.ok ? 'text-body' : 'text-amber-900'}`}>
                    {importResult.text}
                  </p>
                </div>
              )}
            </div>

            <div className="p-5 border-t border-line-hairline flex flex-col sm:flex-row gap-2">
              <button
                onClick={closeImport}
                disabled={importing}
                className="flex-1 py-2.5 rounded-xl border border-line-hairline text-sm font-semibold text-muted disabled:opacity-50"
              >
                {importResult ? 'Done' : 'Cancel'}
              </button>
              <button
                data-testid="crm-import-run"
                onClick={runImport}
                disabled={importing || !importPlan || importPlan.toWrite.length === 0}
                className="flex-1 py-2.5 rounded-xl bg-gold text-white text-sm font-semibold disabled:opacity-50"
              >
                {importing
                  ? 'Importing…'
                  : importPlan
                    ? `Import ${importPlan.toWrite.length.toLocaleString()} ${importPlan.toWrite.length === 1 ? 'contact' : 'contacts'}`
                    : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteDialog}
    </div>
  );
};

export default AdminCRM;
