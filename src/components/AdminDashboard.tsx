"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { LayoutDashboard, Church, FileText, BrainCircuit, Inbox, GraduationCap, ChevronLeft, ChevronRight, ChevronDown, Building2, Settings, MoreHorizontal, Mail, Heart, Users, MessageSquare, Receipt, CalendarCheck, ClipboardList, ListChecks, QrCode, Radio, ExternalLink, Link2, Palette, Bell, X, Library, HandCoins, UserPlus } from 'lucide-react';
import AdminBlog from './AdminBlog';
import PlatformInbox from './PlatformInbox';
import AdminChurches from './AdminChurches';
import AdminCourses from './AdminCourses';
import AdminRAG from './AdminRAG';
import AdminTenants from './AdminTenants';
import AdminLibraryCourses from './AdminLibraryCourses';
import AdminSettings from './AdminSettings';
import AdminUpgradePage from './AdminUpgradePage';
import AdminBranding from './AdminBranding';
import AdminDashboardHome from './AdminDashboardHome';
import AffiliateSection from './AffiliateSection';
import NewsletterEditor from './NewsletterEditor';
import NewsletterCampaigns from './NewsletterCampaigns';
import CanvasList from './CanvasList';
import CanvasEditor from './CanvasEditor';
import { Permission, normalizePermissions } from './AdminRoles';
import AdminNavCustomizer from './AdminNavCustomizer';
import FocusScreen from './FocusScreen';
import AdminFundraising from './AdminFundraising';
import AdminDonations from './AdminDonations';
import AdminCRM from './AdminCRM';
import AdminSignups from './AdminSignups';
import AdminDocs from './AdminDocs';
import AdminCommunity from './AdminCommunity';
import AdminAccounting from './AdminAccounting';
import AdminForms from './AdminForms';
import AdminCheckin from './AdminCheckin';
import AdminLivestream from './AdminLivestream';
import AdminSms from './AdminSms';
import AdminEvents from './AdminEvents';
import AdminServices from './AdminServices';
import PlanUpgradeScreen from './PlanUpgradeScreen';
import Profile from './Profile';
import MyAccountMenu, { type BillingAccess } from './MyAccountMenu';
import BillingAndPayments from './BillingAndPayments';
import GraceWindowBanner from './GraceWindowBanner';
import { AdminScreenHeader, AdminHeaderContext, AdminHeaderOverride } from './AdminScreenHeader';
import { getEffectiveFeatures, hasBrandingAccess, AFFILIATE_PROGRAM_ENABLED, FREE_PLAN } from '../utils/plan-features';
import { SMS_FEATURE_ENABLED } from '../lib/sms-feature';
import { db, auth } from '../firebase';
import { checkRosterAdminStatus } from '../utils/tenant.utils';
import { readCachedRosterAnswer } from '../utils/roster-cache';
import { signOut } from 'firebase/auth';
import { collection, query, where, onSnapshot, limit } from 'firebase/firestore';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { isSuperAdmin as checkIsSuperAdmin, hasPlatformOverride, getTenantScope, PLATFORM_TENANT_ID } from '../utils/tenant-scope';
import { useAppStore } from '../store/useAppStore';
import { useCurrentUser } from '../hooks/queries/useUserQueries';
import { useTenant as useTenantDoc } from '../hooks/queries/useTenantQueries';
import { useTenant } from '../contexts/TenantContext';
import { visibleNavGroups } from './layout/nav-groups';
import { SLUG_TO_TAB, TAB_TO_SLUG } from '../lib/admin-sections';

const DEFAULT_LOGO = 'https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png';

// URL slug ↔ internal tab id. Most ids map 1:1; only `ai` differs, so the URL
// reads nicely (/admin/ai-knowledge).
//
// THE-227 — the two maps are no longer written here as a pair of literals that
// had to be kept mirror images by hand. Both are derived from the one table in
// `lib/admin-sections.ts`, which is also what tells PostHog that `crm` and
// `accounting` are feature names rather than document ids. Same behaviour, one
// source: a section renamed there cannot leave half of this mapping stale.

// More-drawer groupings (Vercel-style). The section a tab appears in is keyed by
// its tab id; order matters. Groups with no permitted tabs are omitted entirely.
const MORE_GROUPS: { label: string; ids: string[] }[] = [
  { label: 'CONTENT', ids: ['blog', 'courses', 'newsletter', 'ai', 'docs'] },
  // Ministry: the "who" + giving. CRM leads the group AND is surfaced on the
  // Dashboard home (Members card / "View Members") — both are valid entry points.
  // Admin Roles lives inside the CRM screen as an internal tab, not as its own
  // drawer entry. Signups (THE-277) does NOT: it counts members where CRM counts
  // contacts, so it is its own entry, placed next to CRM because that is where a
  // reader looking for "who joined" will look for it.
  // Statements now live as a sub-tab inside Accounting (not a standalone entry).
  // 🔴 THE-326 — `services` IS MINISTRY, NOT BROADCASTING, and that is the
  // whole placement decision. BROADCASTING is the outbound/live cluster:
  // `events`, `checkin`, `sms`, `livestream` — surfaces that push something to
  // an audience. Planning a Sunday service pushes nothing: it is a run sheet,
  // a rota and the volunteers on it, which is the same category of work as
  // `crm` (who is here) and `community` (what they belong to). It sits after
  // `community` — closing the people-and-gatherings half of the group, before
  // the giving half — because the rota is a question about PEOPLE and the
  // reader looking for it is looking where the people are.
  { label: 'MINISTRY', ids: ['crm', 'signups', 'churches', 'community', 'services', 'fundraising', 'donations', 'forms', 'accounting'] },
  // Broadcasting: outbound / live engagement channels.
  // QR Codes now live as a sub-tab inside Check-In (not a standalone entry).
  { label: 'BROADCASTING', ids: ['events', 'checkin', 'sms', 'livestream'] },
  // Platform: super-admin-only surfaces (Tenants + the platform Inbox).
  { label: 'PLATFORM', ids: ['tenants', 'inbox'] },
  { label: 'MORE', ids: ['affiliate', 'branding'] },
];
const GROUPED_MORE_IDS = new Set(MORE_GROUPS.flatMap((g) => g.ids));

// Desktop sidebar groups (branded — matches the admin mockup). Dashboard sits
// above the groups; Settings sits below them. Any id the admin isn't permitted
// for is dropped, and a group with no permitted tabs is omitted entirely.
const DESKTOP_NAV_GROUPS: { label: string; ids: string[] }[] = [
  { label: 'CONTENT', ids: ['blog', 'courses', 'newsletter', 'ai', 'docs'] },
  // 🔴 THE-326 — `services` in MINISTRY here too, in the SAME position. The two
  // arrays are the mobile drawer and the desktop sidebar; a section in one and
  // not the other is a section half the product cannot reach.
  { label: 'MINISTRY', ids: ['crm', 'signups', 'churches', 'community', 'services', 'fundraising', 'donations', 'forms', 'accounting'] },
  { label: 'BROADCASTING', ids: ['events', 'checkin', 'sms', 'livestream'] },
  { label: 'GROW', ids: ['affiliate', 'branding', 'tenants', 'inbox'] },
];

// How long the nav will wait on the admin-roster lookup before giving up and
// building itself from role/permission access alone. Only a user whose access
// actually depends on the roster ever waits at all (see `rosterMatters`), and
// the lookup normally answers in well under a second — this ceiling exists so a
// hung request degrades to a reduced nav instead of a permanent skeleton.
const ROSTER_LOOKUP_TIMEOUT_MS = 6000;

interface AdminDashboardProps {
  onNavigate: (page: string) => void;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onNavigate }) => {
  const { tenantPlan, currentTenantId, isAuthReady } = useAppStore();
  const navigate = useNavigate();
  const { section, itemId } = useParams();
  const activeTab = section ? (SLUG_TO_TAB[section] || section) : 'dashboard';

  // Tenant and user data from React Query
  const tenantId = currentTenantId;
  // `isLoading` matters to the Billing gate below: until the tenant doc is read
  // we do not know `ownerId`, so "you are not the owner" is not yet a fact.
  const { data: tenantData, isLoading: tenantDocLoading } = useTenantDoc(tenantId);
  const tenantName = tenantData?.name ?? tenantData?.config?.name ?? 'Ministry';
  // Mirror MainApp: white-label tenants show their own logo; the platform /
  // super-admin view keeps the default Harvest mark.
  const { branding, isLoading: tenantLoading, tenantPlan: ctxTenantPlan, tenantAddons } = useTenant();
  const isWhiteLabel = !!tenantId && tenantId !== PLATFORM_TENANT_ID;
  const displayLogo = isWhiteLabel && branding?.logo ? branding.logo : DEFAULT_LOGO;
  const { data: userData, isLoading: userLoading } = useCurrentUser(auth.currentUser?.uid);

  const userRole = userData?.role ?? 'user';
  // Normalise on read so legacy docs keep working (seeFormsInbox → manageForms,
  // missing new flags default to false). This is what the drawer gates read.
  const userPermissions: Permission | null = userData?.permissions ? normalizePermissions(userData.permissions) : null;

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  // Desktop sidebar: collapsed (hidden) group sections, keyed by group label.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = useCallback((label: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  }, []);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingChurchesCount, setPendingChurchesCount] = useState(0);
  const [showMoreSheet, setShowMoreSheet] = useState(false);
  // My Account menu → My Profile / Billing & Payments overlays.
  const [showProfile, setShowProfile] = useState(false);
  const [showBilling, setShowBilling] = useState(false);
  const [canvasId, setCanvasId] = useState<string | null>(null);
  const [canvasName, setCanvasName] = useState<string>('');
  const [newsletterView, setNewsletterView] = useState<'list' | 'editor'>('list');
  // Nav customizer state
  const [showNavCustomizer, setShowNavCustomizer] = useState(false);
  // Ordered IDs for the bottom bar; null means use default (first 4 from allTabs)
  const [customPrimaryIds, setCustomPrimaryIds] = useState<string[] | null>(null);
  // Independent ordered IDs for the More drawer; null means default (allTabs order)
  const [customMoreIds, setCustomMoreIds] = useState<string[] | null>(null);
  // Primary action published by the active screen into the shared header.
  const [headerAction, setHeaderAction] = useState<React.ReactNode>(null);
  // Full header override published by a sub-view (e.g. an open chat thread).
  const [headerOverride, setHeaderOverride] = useState<AdminHeaderOverride | null>(null);
  // When a sub-view wants a fullscreen writing surface (Notes editor) it hides
  // the mobile app header entirely. Desktop chrome is left untouched.
  const [headerHidden, setHeaderHidden] = useState(false);
  const headerApi = React.useMemo(() => ({ setHeaderAction, setHeaderOverride, setHeaderHidden }), []);

  // Restore saved nav configuration from user data
  const navInitialized = useRef(false);
  useEffect(() => {
    if (!navInitialized.current && userData) {
      navInitialized.current = true;
      if (userData.adminNavConfig?.primaryTabIds?.length) {
        setCustomPrimaryIds(userData.adminNavConfig.primaryTabIds);
      }
      if (userData.adminNavConfig?.moreTabIds?.length) {
        setCustomMoreIds(userData.adminNavConfig.moreTabIds);
      }
    }
  }, [userData]);

  /** Navigate to a tab by internal id (resets transient sub-views). */
  const go = useCallback((id: string) => {
    setShowMoreSheet(false);
    setNewsletterView('list');
    navigate(id === 'dashboard' ? '/admin' : `/admin/${TAB_TO_SLUG[id] || id}`);
  }, [navigate]);

  /** Back arrow: go where the user came from, or fall back to the dashboard. */
  const smartBack = useCallback(() => {
    const idx = (typeof window !== 'undefined' && (window.history.state as any)?.idx) || 0;
    if (idx > 0) navigate(-1);
    else navigate('/admin', { replace: true });
  }, [navigate]);

  /** Clear the :itemId deep-link param once a screen has consumed it. */
  const clearItemId = useCallback(() => {
    navigate(`/admin/${TAB_TO_SLUG[activeTab] || activeTab}`, { replace: true });
  }, [navigate, activeTab]);

  /** Sign out; the App router redirects to /auth on the auth-state change. */
  const handleLogout = useCallback(async () => {
    try { await signOut(auth); } catch (e) { console.error('Error signing out:', e); }
  }, []);

  /** Open the member app at "/" and STAY there. Sets a one-shot intent flag that
   *  App.tsx reads so the admin → /admin auto-redirect won't bounce us back. */
  const handleViewApp = useCallback(() => {
    try { sessionStorage.setItem('intentionalUserView', 'true'); } catch {}
    setShowMoreSheet(false);
    onNavigate('home');
  }, [onNavigate]);


  useEffect(() => {
    let unsub1: (() => void) | null = null;
    let unsub2: (() => void) | null = null;
    let cancelled = false;

    const loadCounts = async () => {
    const tenantId = await getTenantScope();
    if (cancelled) return;
    // Inbox is platform-only now: only the super admin on the apex domain has a
    // Platform Inbox. Count pending platform_inbox reports for its badge; for
    // tenant admins there is no inbox, so the count stays 0 (and we don't
    // subscribe — reading platform_inbox is super-admin-only).
    if (hasPlatformOverride()) {
      const q = query(collection(db, 'platform_inbox'), where('status', '==', 'pending'), limit(300));
      unsub1 = onSnapshot(q, (snapshot) => {
        setUnreadCount(snapshot.size);
      }, (error) => {
        try { handleFirestoreError(error, OperationType.GET, `platform_inbox`); } catch (e) { console.error(e); }
      });
    } else {
      setUnreadCount(0);
    }

    const qChurches = query(collection(db, 'churches'), where('status', '==', 'pending'), limit(300));
    unsub2 = onSnapshot(qChurches, (snapshot) => {
      const docs = tenantId ? snapshot.docs.filter(d => d.data().tenantId === tenantId) : snapshot.docs;
      setPendingChurchesCount(docs.length);
    }, (error) => {
      try { handleFirestoreError(error, OperationType.GET, `churches`); } catch (e) { console.error(e); }
    });
    };

    loadCounts();

    return () => {
      cancelled = true;
      if (unsub1) unsub1();
      if (unsub2) unsub2();
    };
  }, []);

  const isSuperAdmin = userRole === 'super_admin' || checkIsSuperAdmin();
  // Feature unlock only happens in the platform context (apex domain). On a
  // tenant subdomain a super admin keeps full *access* (isSuperAdmin) but their
  // *features* are gated by the tenant's plan — so platformOverride is false.
  const platformOverride = hasPlatformOverride();
  // The church owner (tenant creator) is the user listed in the tenant's
  // admin roster. Build-on-payment gives that owner role 'admin' (so claims
  // grant admin), while the legacy label was 'church_admin' — treat both as
  // the full-access tenant owner so the creator truly owns their dashboard.
  //
  // The roster moved off the public tenant doc to the server-only tenant_private
  // doc, so membership is resolved via the API. It is deliberately THREE-state:
  // 'unknown' (not asked / in flight) is NOT the same as 'not-admin'. A default
  // of plain `false` is what broke THE-64 — it reads as a settled "no", so the
  // nav was built without the roster's grant and the redirect at the bottom of
  // this file bounced a roster-only admin back to /admin. 'unknown' is folded
  // into `isLoading` below instead, but only for the users it can affect.
  //
  // A settled answer is also remembered for the session (../utils/roster-cache),
  // so the FIRST render after a remount already has it and neither flashes the
  // skeleton nor spends a request re-asking. That is what makes THE-139 survivable:
  // the shell is remounted often, and an entitlement question that is re-asked on
  // every remount is a question that will eventually be rate limited.
  type RosterState = 'unknown' | 'admin' | 'not-admin';
  const [rosterState, setRosterState] = useState<RosterState>(
    () => (tenantId && readCachedRosterAnswer(tenantId)) || 'unknown',
  );
  // Which (tenant, user) pair the current answer belongs to. A resolved answer
  // is only invalidated by a genuinely *different* tenant/user — never by a
  // momentarily falsy one, which is the ordinary shape of a navigation blip.
  const rosterKeyRef = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    // No tenant or no signed-in user: there is nothing to ask about. Return
    // WITHOUT touching rosterState — resetting here is THE-64's second defect,
    // where a transient falsy tenantId revoked an already-good answer and
    // collapsed the nav ("disappears for a while, then reappears").
    const uid = auth.currentUser?.uid;
    if (!tenantId || !uid) return;
    const rosterKey = `${tenantId}|${uid}`;
    if (rosterKeyRef.current !== rosterKey) {
      // Genuinely a different tenant or a different user — the previous answer
      // is about somebody else, so go back to 'unknown' and re-ask.
      rosterKeyRef.current = rosterKey;
      setRosterState('unknown');
    }
    // Already answered for this tenant and this user earlier in the session:
    // reuse it and ask nobody. The cache is keyed by BOTH, so this can never
    // serve another tenant's or another sign-in's answer (see roster-cache).
    const remembered = readCachedRosterAnswer(tenantId);
    if (remembered) {
      setRosterState(remembered);
      return;
    }
    // Bound the wait. checkRosterAdminStatus resolves on any HTTP/parse error,
    // but a hung request would otherwise leave rosterState at 'unknown' forever
    // and strand a roster-dependent admin on the loading skeleton.
    const timer = setTimeout(() => {
      if (cancelled) return;
      console.warn(`[admin-nav] roster lookup for tenant "${tenantId}" timed out after ${ROSTER_LOOKUP_TIMEOUT_MS}ms (its own retries never settled) — building the nav from role/permission access only. Tabs granted ONLY by the roster will be missing until this view is reloaded; server-side access is unchanged.`);
      setRosterState('not-admin');
    }, ROSTER_LOOKUP_TIMEOUT_MS);
    checkRosterAdminStatus(tenantId).then((status) => {
      if (cancelled) return;
      clearTimeout(timer);
      if (status === 'error') {
        // Fail closed, but never silently: THE-64 was invisible partly because
        // a failed/undecided roster lookup produced no console or Sentry signal.
        //
        // By the time 'error' arrives the lookup has already retried a
        // retryable failure (429/5xx/network) to exhaustion — see
        // checkRosterAdminStatus. So this is no longer "one request did not
        // land", which is what THE-139 degraded on; it is the roster genuinely
        // being unreachable, and a reduced nav is the honest thing to render.
        console.warn(`[admin-nav] roster lookup for tenant "${tenantId}" failed after retrying — building the nav from role/permission access only. Tabs granted ONLY by the roster will be missing until this view is reloaded; server-side access is unchanged.`);
      }
      setRosterState(status === 'admin' ? 'admin' : 'not-admin');
    });
    return () => { cancelled = true; clearTimeout(timer); };
  }, [tenantId, isAuthReady]);
  const isTenantOwnerEmail = rosterState === 'admin';
  const isChurchAdmin = userRole === 'church_admin' || isTenantOwnerEmail;
  const perms = userPermissions ?? {} as Permission;
  // The store `tenantPlan` is synced from the context plan by an effect in App.tsx,
  // so it can lag the authoritative context value by a render on first mount. Fall
  // back to the context plan so `features`/`isTenantAdmin` are correct on the first
  // render once the plan is known, rather than waiting on that lagging sync.
  const resolvedPlan = tenantPlan ?? ctxTenantPlan ?? null;
  // 🔴 `getEffectiveFeatures`, NEVER `getPlanFeatures` (THE-253). Every gate
  // below asks what THIS CHURCH holds, not what its tier publishes. The AI
  // Knowledge Base screen gates on `aiKnowledge`, which the AI Assistant add-on
  // now lifts — read through the bare matrix it would refuse exactly the
  // churches that paid, which is the defect THE-253 exists to fix. The capacity
  // cells (contacts, admins, campuses) only ever read HIGHER through here, so
  // no gate can tighten as a result.
  const features = resolvedPlan ? getEffectiveFeatures(resolvedPlan, tenantAddons) : null;
  const isTenantAdmin = !!resolvedPlan;
  const hasFullAccess = isSuperAdmin || isChurchAdmin || perms.fullAccess;

  // ── The plan gate, in ONE place (THE-216) ────────────────────────────────
  //
  // Every plan-gated surface below asks the same question — "does this tenant's
  // tier carry this cell?" — and every one of them used to spell it out inline
  // as `platformOverride || !isTenantAdmin || (features && features.X)`.
  //
  // 🔴 `!isTenantAdmin` WAS A BLANKET BYPASS AND IS GONE. `isTenantAdmin` is
  // `!!resolvedPlan` — it does not mean "is an admin of a tenant", it means "a
  // plan resolved". So the old middle term read: THE PLAN FAILED TO RESOLVE,
  // THEREFORE UNLOCK EVERYTHING. That is a gate that opens on its own failure.
  // A white-label tenant whose `tenants/{id}` doc carries no `plan` field, or
  // whose read errored (TenantContext's catch still clears `isLoading`), landed
  // here with `features === null` and was handed every paid screen — Newsletter,
  // AI Knowledge, Notes, Community, Forms, Accounting, Events, Livestream — in
  // full working order, on a tier that bought none of them.
  //
  // What the term was FOR is the platform itself: the apex domain and the
  // platform tenant have no tenant plan to gate on, so "no plan resolved" was
  // being used as a proxy for "we are not a tenant". That proxy is what fails
  // open. `planUnlocked` states the real condition directly instead:
  //
  //   platformOverride — the super admin in the platform context. Deliberate,
  //                      unchanged, and per tenant-scope.ts's own contract the
  //                      ONLY condition under which plan gating is bypassed.
  //                      (On a tenant subdomain it is false BY DESIGN: a super
  //                      admin keeps full access but is gated by that tenant's
  //                      plan — so this narrowing costs a super admin nothing.)
  //   !isWhiteLabel    — no tenant in scope, or the platform tenant itself.
  //                      The same predicate `isPlanReady` below already uses to
  //                      decide who has a plan worth waiting for, so the two can
  //                      no longer disagree about what "is a tenant" means.
  //
  // Everything else falls through to the cell, and a null `features` now fails
  // CLOSED — an unresolved plan shows PlanUpgradeScreen, which is the honest
  // answer to "we do not know what you bought".
  //
  // ⚠️ ALMOST NEVER A NAV GATE. Which tabs exist is decided by PERMISSIONS;
  // THE-202 deliberately moved the plan clause out of the nav array so a tier
  // that lacks a feature sees the tab and reaches PlanUpgradeScreen instead of
  // the tab being absent. Thirteen of the fourteen calls below therefore decide
  // which SCREEN a tab mounts, and nothing else.
  //
  // `canBranding` is the ONE exception and predates THE-202: it feeds both the
  // nav entry and the render guard, so an unentitled tier has no Branding tab AND
  // direct navigation to /admin/branding redirects away. Left as it was — THE-202
  // listed branding among the tabs that already had a render-time gate, and
  // moving it into the visible-but-walled pattern is a product decision, not this
  // ticket's. It is asserted both ways in AdminDashboard.plan-entitlement.
  //
  // Nothing here touches a PERMISSION term. A limited admin's `manageSettings`
  // and friends are orthogonal to which plan the tenant bought (THE-193), and the
  // permission-multiplicity pin in admin-data-screens still passes unedited.
  //
  // ⚠️ That pin scrapes this file for `perms` + `.` + a name and compares the
  // result WITH MULTIPLICITY, comments included — so writing one in prose here
  // adds a phantom term and fails it. Name permissions in comments without the
  // accessor, as the line above does.
  const planUnlocked = platformOverride || !isWhiteLabel;
  /**
   * Does the tenant's plan carry this cell?
   *
   * Takes the CELL, already read off `features`, rather than a key — the four
   * non-boolean gates (`maxCourses !== 0`, `accountingTools || givingStatements`,
   * `hasBrandingAccess(features)`) are expressions, not lookups, and a key-based
   * helper would have forced them back into open-coded gates beside this one.
   *
   * `=== true` rather than a truthiness test, deliberately: `features && …`
   * yields `null` while the plan is unresolved, and a gate that cannot tell
   * `null` from `false` is the same "unknown reads as yes" defect one level down.
   */
  const planAllows = (cell: boolean | null | undefined): boolean => planUnlocked || cell === true;
  /**
   * Does this tenant's NAV show the tab this cell gates? (THE-220)
   *
   * 🔴 TWO LAYERS, TWO QUESTIONS, ONE CELL. `planAllows` above answers "may this
   * tenant USE the feature" and decides which SCREEN a tab mounts — the real one
   * or PlanUpgradeScreen. This answers "may this tenant SEE the tab", and decides
   * whether the entry exists in the nav at all. They read the SAME cell, so the
   * two layers cannot disagree about which feature a tab is; they differ by
   * exactly one term, and that term is the free tier.
   *
   * ⚠️ THIS IS NOT THE CLAUSE THE-202 REMOVED, and restoring that one verbatim
   * would have been the wrong fix. THE-202 (49b2a0c) deleted
   * `platformOverride || !isTenantAdmin || (features && features.X)` from every
   * nav entry to build the free tier's "see every feature" mode, which applied
   * that mode to EVERY tier — so an Individual tenant showed all sixteen tabs,
   * nine of which it cannot use. Putting the old clause back would have hidden
   * those tabs from free as well, which is the half THE-202 got right.
   *
   * So the clause is the old one PLUS the free tier:
   *
   *   free                     → every tab, each walled by PlanUpgradeScreen.
   *   plus / pro / max         → the tabs their own cells carry.
   *   platform / no tenant     → everything (`planUnlocked`, via planAllows).
   *
   * ⚠️ A PLAN CLAUSE, NEVER A PERMISSION ONE. Each entry below is
   * `navAllows(cell) && (<the permission clause it already had>)`, both of which
   * must hold: the tenant bought the feature AND this admin's role grants it. The
   * permission terms are byte-identical to what THE-202 left, and
   * `admin-data-screens.desktop-layout` pins them with multiplicity.
   */
  const navAllows = (cell: boolean | null | undefined): boolean =>
    resolvedPlan === FREE_PLAN || planAllows(cell);
  // Plan readiness. A white-label tenant's plan is loaded async from the tenant
  // doc (TenantContext); until it resolves we must NOT build the plan-gated
  // screens. Fold plan-readiness into `isLoading` so the dashboard shows its
  // loading skeleton until the plan is known, then builds from the real plan.
  // `tenantLoading` is false once the tenant doc has been read — even when it
  // yields no plan — and platform/apex contexts have no tenant plan to wait on, so
  // this never hangs into an infinite skeleton.
  //
  // ⚠️ THIS IS NO LONGER THE ONLY THING STANDING BETWEEN AN UNRESOLVED PLAN AND A
  // PAID SCREEN, and it never should have been. Its original note said the
  // `!isTenantAdmin` fallback "treats an unknown plan as platform, which would
  // flash paid tabs before the plan confirms them" — i.e. this gate existed to
  // cover for a fail-OPEN gate downstream, and covered only the window it could
  // see (a plan still loading), not the states it could not (a tenant doc with no
  // `plan` field, or a read that errored). `planAllows` above now fails closed on
  // all of them, so this is back to being what its name says: a loading gate.
  // Note the shared `platformOverride || !isWhiteLabel` head — deliberately the
  // same predicate, so "who has a plan to wait for" and "who has a plan to gate
  // on" cannot drift apart.
  const isPlanReady = planUnlocked || !tenantLoading;
  // Roster readiness — scoped to the users the answer can actually change.
  //
  // The roster feeds exactly one thing: isChurchAdmin → hasFullAccess. It can
  // only ever GRANT. So a user who already has full access without it — a super
  // admin, the church_admin role, or an explicit fullAccess permission — has an
  // identical nav whichever way the roster answers, and must NOT be made to wait
  // on a fetch they do not need. `rosterMatters` is false for them and the gate
  // is a no-op; only a user whose entitlement genuinely hangs on the roster
  // (role 'admin', partial permissions, or none) sees the skeleton.
  //
  // It also cannot hang: with no tenant or no signed-in user nothing is ever
  // asked, so `rosterMatters` is false rather than waiting on an answer that
  // will never come; and when it is true the effect above always settles
  // rosterState — on success, on error, or on the timeout.
  const hasRosterIndependentAccess = isSuperAdmin || userRole === 'church_admin' || !!perms.fullAccess;
  const rosterMatters = !hasRosterIndependentAccess && !!tenantId && !!auth.currentUser;
  const isRosterReady = !rosterMatters || rosterState !== 'unknown';
  const isLoading = !isAuthReady || userLoading || !isPlanReady || !isRosterReady;

  // ── Owner identity, split into two deliberately different flags (THE-83) ──
  //
  // These used to be one `isOwner` reading `ownerId` alone, which disagreed with
  // the server: `requireOwner` (src/lib/api-auth.ts) admits THREE identities —
  // the buyer by `ownerId`, an owner-by-roster from `tenant_private.adminEmails`,
  // and the super admin. So a roster admin was authorised for every /api/billing/*
  // route and could not see the menu item that reaches them. That is the third
  // instance of one bug (THE-64, PR #295): an entitlement that does not live on
  // the user document. Any check reading only `ownerId` silently refuses it.
  const currentUid = auth.currentUser?.uid;

  // (1) Owner by `ownerId` — the buyer uid the Stripe webhook writes at tenant
  // creation. Kept NARROW on purpose; see `billingAccess` below for why the two
  // flags did not merge.
  const isPlanOwner = !!currentUid && !!tenantData?.ownerId && currentUid === tenantData.ownerId;

  // (2) May this admin reach Billing & Payments? Mirrors `requireOwner`'s three
  // identities, and is THREE-state because one of them is an async answer: the
  // roster is server-only (`tenant_private` is `allow read, write: if false`),
  // so it comes from GET /api/tenants/roster-status via `rosterState` above.
  //
  // 🔴 Never default the roster arm to `false`. THE-64 was caused by exactly
  // that substitution — an async lookup whose in-flight value was indis-
  // tinguishable from a settled "no", so the UI rendered a denial on data it
  // did not have. Corollary 5: an async default is a silent claim. Consumers
  // must render the 'unknown' window, not collapse it into 'no'.
  //
  // Note this window is WIDER than `rosterMatters` above, and deliberately so:
  // that flag scopes who waits on the loading *skeleton*, and a full-access
  // admin's nav is identical whichever way the roster answers. Their Billing
  // row is not. Rather than put them back on a global skeleton for a fetch
  // their nav does not need, the Billing surface owns its own unknown window.
  const ownerIdSettled = !tenantDocLoading;
  // With no tenant or no signed-in user the roster effect never asks, so its
  // 'unknown' will never resolve — for them that is a settled "no", not a wait.
  const rosterCanAnswer = !!tenantId && !!currentUid;
  const billingAccess: BillingAccess =
    (isSuperAdmin && !!tenantId) || isPlanOwner || rosterState === 'admin'
      ? 'yes'
      : !ownerIdSettled || (rosterState === 'unknown' && rosterCanAnswer)
        ? 'unknown'
        : 'no';

  // Branding tab/page entitlement — keyed off the branding-family feature flags
  // (matches the old Settings branding gate). Used both in allTabs and the render
  // guard so direct navigation to /admin/branding is gated like every other tab.
  // The OR chain lives in hasBrandingAccess (plan-features) so the per-tier
  // visibility is asserted in one place; it dropped the retired customBackground
  // flag without changing which tiers see the tab.
  const canBranding = !!(planAllows(features && hasBrandingAccess(features)) && (hasFullAccess || perms.manageBranding));

  // Settings tab entitlement — a manageSettings admin (or full access / super
  // admin) can reach the integrations/config screen. Branding lives in its own
  // tab (canBranding), so a branding-only admin reaches Branding, not Settings.
  const canSettings = hasFullAccess || !!perms.manageSettings;

  /**
   * Donations tab entitlement — Stripe Connect and the church's own payment
   * links (THE-246). Like `canBranding` above, this feeds BOTH the nav entry
   * and the render guard, and it is the SECOND of the two entries in this file
   * to do so. Two reasons, and neither is a preference:
   *
   * 🔴 THE PLAN HALF USES `planAllows`, NOT `navAllows`. `navAllows` shows a
   * gated tab to free behind PlanUpgradeScreen, which is right for a feature
   * free could buy and browse. It is wrong for this one: free carries
   * `fundraising: false` and has NO DONATE PAGE BY DECISION (THE-202/THE-213),
   * so the screen behind the wall would be a Connect button asking a church for
   * its bank details to receive money that cannot arrive — the exact surface
   * THE-225 removed from Settings after the founder reported it three times.
   * Reads the FEATURE, so a future tier sold without giving needs no edit here.
   *
   * 🔴 THE PERMISSION HALF IS `manageSettings`, WHICH IS WHAT THE WRITE NEEDS.
   * The links live on `tenants/{id}.config`, and firestore.rules lets a
   * non-super-admin update that document only with manageBranding or
   * manageSettings. Gating this screen on the fundraising permission instead
   * would hand its editor to admins whose save can only ever be denied — a
   * form that cannot succeed is worse than a tab that is not there. Branding
   * admins reach Branding; Stripe Connect stays reachable from Fundraising for
   * the fundraising role, unchanged.
   */
  const canDonations = !!(planAllows(features?.fundraising) && canSettings);

  // My Account menu props (top-right avatar) — assembled after the entitlement
  // flags above so the menu can gate Settings the same way the drawer/sidebar do.
  const accountMenuProps = {
    photoURL: userData?.photoURL ?? null,
    displayName: userData?.displayName ?? null,
    email: userData?.email ?? auth.currentUser?.email ?? null,
    billingAccess,
    onOpenProfile: () => setShowProfile(true),
    // Settings item shows only when entitled (canSettings) — undefined hides the
    // row, matching the More-drawer / desktop-sidebar Settings gate.
    onOpenSettings: canSettings ? () => go('settings') : undefined,
    // Billing item opens only on a settled 'yes' (MyAccountMenu guards too, and
    // renders the 'unknown' window as a busy row that has nothing to open).
    onOpenBilling: billingAccess === 'yes' ? () => setShowBilling(true) : undefined,
    // Member-app shortcut (same one-shot-intent action the More drawer used). The
    // menu row is mobile-only; desktop keeps its "Open member app" top-bar pill.
    onGoToUserApp: handleViewApp,
    onLogout: handleLogout,
  };

  // The inbox is platform-only now (Contact / Feature / Bug reports go to the
  // platform owner). It shows ONLY for a super admin in the platform context
  // (apex domain, no tenant subdomain). Tenant admins — and super admins
  // browsing a tenant subdomain — get no inbox tab at all.
  const showInbox = platformOverride;

  // All available tabs (permission-filtered)
  const allTabs = [
    // Dashboard is always visible — placeholder/welcome screen (analytics moved to CRM)
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    (hasFullAccess || perms.modifyChurches) && { id: 'churches', label: isTenantAdmin && features && features.maxChurches === 1 ? 'Church' : 'Church List', icon: Church },
    // Courses — the cell is `maxCourses !== 0`, matching the render switch below.
    // ⚠️ NOT `blog`, which is what THE-202 removed from this entry: the nav read
    // `features.blog` while the screen read `maxCourses`, so the two layers were
    // already gating Courses on different features. Restoring the removed clause
    // verbatim would have restored that disagreement too. Every tier's
    // `maxCourses` is non-zero, so no tier's Courses tab moves.
    navAllows(features && features.maxCourses !== 0) &&
      (hasFullAccess || perms.createCourses) && { id: 'courses', label: 'Courses', icon: GraduationCap },
    navAllows(features?.blog) &&
      (hasFullAccess || perms.writeArticles) && { id: 'blog', label: 'Blog', icon: FileText },
    navAllows(features?.aiKnowledge) &&
      (hasFullAccess || perms.uploadRag) && { id: 'ai', label: 'AI Knowledge', icon: BrainCircuit },
    // Newsletter tab — Small Team and above; free sees it walled.
    navAllows(features?.newsletterAutomation) &&
      (hasFullAccess || perms.manageNewsletter) &&
      { id: 'newsletter', label: 'Newsletter', icon: Mail },
    // Fundraising campaigns
    navAllows(features?.fundraising) &&
      (hasFullAccess || perms.manageFundraising) &&
      { id: 'fundraising', label: 'Fundraising', icon: Heart },
    // Donations — Stripe Connect + the church's own payment links (THE-246).
    // Sits directly after Fundraising in the MINISTRY group: this is what a
    // campaign spends. Gated by `canDonations` above, which is the one
    // expression the render switch below also asks — see its note for why this
    // entry does not take the visible-but-walled treatment.
    canDonations && { id: 'donations', label: 'Donations', icon: HandCoins },
    // Event registration (Pretix)
    navAllows(features?.eventRegistration) &&
      (hasFullAccess || perms.manageEvents) &&
      { id: 'events', label: 'Events', icon: CalendarCheck },
    // 🔴 THE-326 — Service planning, on the SAME gate as Events and deliberately
    // so. The run sheet, the rota and the invitations were reachable through the
    // Events screen and through nothing else, so repeating its cell and its
    // permission means exactly the people who could plan a service yesterday can
    // plan one today, and nobody new can. ⚠️ NO NEW PERMISSION: `servicePlans`,
    // `rotaInvitations` and the invite API all check `manageEvents` server-side,
    // and a `managePlanning` here would be a roles-matrix row that no rule
    // enforces.
    navAllows(features?.eventRegistration) &&
      (hasFullAccess || perms.manageEvents) &&
      { id: 'services', label: 'Services', icon: ListChecks },
    // Docs (TipTap)
    navAllows(features?.docs) &&
      (hasFullAccess || perms.manageDocs) &&
      { id: 'docs', label: 'Notes', icon: FileText },
    // CRM (Contacts · Roles sub-tabs). Shown to anyone who can use EITHER
    // sub-tab: manageCRM (Contacts) or manageAdmins (Roles), since the Roles
    // screen only lives inside the CRM page.
    //
    // ⚠️ THE `analytics` PERMISSION USED TO BE A THIRD TERM HERE and is
    // deliberately gone. It was here for the Analytics sub-tab, which THE-277
    // moved out to `signups` below. Leaving it would hand an analytics-only
    // admin a CRM page with no sub-tab they may open — the dead-end this clause
    // exists to avoid. (Spelled in prose rather than in code: the permission
    // census in admin-data-screens.desktop-layout counts every permission term
    // in this file WITH MULTIPLICITY and reads comments too, so writing one in
    // a comment would register as a second real gate.)
    navAllows(features?.crm) &&
      (hasFullAccess || perms.manageCRM || perms.manageAdmins) &&
      { id: 'crm', label: 'CRM', icon: Users },
    // Signups (THE-277) — members who created an account: city search, the
    // 1/3/7/30-day windows, and the two CSV exports. Previously the CRM
    // screen's Analytics sub-tab.
    //
    // 🔴 THE ENTITLEMENT IS CARRIED OVER, NOT INVENTED. Both halves are the
    // same pair that gated the sub-tab: `features.crm` on the plan side —
    // there is NO `analytics` cell in the plan matrix and adding one would be a
    // flag nothing else reads (see the note in utils/plan-features.ts, which
    // says "free gets analytics" is expressed by `crm: true` and nothing else)
    // — and the `analytics` permission on the admin side, which is where
    // `AdminCRM.canViewAnalytics` used to ask it.
    navAllows(features?.crm) &&
      (hasFullAccess || perms.analytics) &&
      { id: 'signups', label: 'Signups', icon: UserPlus },
    // Accounting (Crater) — Statements is now a sub-tab inside this screen, so the
    // entry is shown when EITHER the accounting or giving-statements feature is on,
    // and the admin holds either permission.
    navAllows(features && (features.accountingTools || features.givingStatements)) &&
      (hasFullAccess || perms.manageAccounting || perms.manageGivingStatements) &&
      { id: 'accounting', label: 'Accounting', icon: Receipt },
    // Custom Forms → CRM pipeline
    navAllows(features?.customForms) &&
      (hasFullAccess || perms.manageForms) &&
      { id: 'forms', label: 'Forms', icon: ClipboardList },
    // Check-In System (QR attendance) — the QR Code generator is a sub-tab inside
    // this screen.
    //
    // 🔴 DELIBERATELY THE ONE GATED TAB WITH NO PLAN CLAUSE, and THE-220 kept it
    // that way after checking. `checkInSystem` gates only HALF this tab: QR Codes
    // is on every tier on purpose (THE-213), and the check-in half self-gates
    // inside AdminCheckin and again server-side. So the plan clause that would
    // read naturally here — `navAllows(features?.checkInSystem)` — would hide the
    // tab from free and Individual and take QR Codes away from two tiers that
    // genuinely have it, to hide a sub-tab those tiers already cannot open. The
    // render switch below carries no plan clause for the same reason, so the two
    // layers agree; `AdminDashboard.tier-tab-matrix` records this as the one
    // named exception to "visible in the nav implies the feature is on".
    (hasFullAccess || perms.manageCheckin || perms.manageQR) &&
      { id: 'checkin', label: 'Check-In', icon: QrCode },
    // Livestream (YouTube + live giving)
    navAllows(features?.livestream) &&
      (hasFullAccess || perms.manageLivestream) &&
      { id: 'livestream', label: 'Livestream', icon: Radio },
    // SMS Automation (Twilio)
    // Master switch first, exactly as the Affiliate entry below does it: while
    // SMS is hidden NOBODY gets the entry, super admin included. The plan and
    // permission clauses behind it are left untouched, so flipping
    // SMS_FEATURE_ENABLED restores the identical entitlement. The 'sms' id
    // stays listed in MORE_GROUPS / DESKTOP_NAV_GROUPS above — those groups are
    // filtered against this array, so an absent tab drops out of its group on
    // its own and the grouping survives for the flip back. The literal is also
    // what `admin-sections.ts` and its drift test read, so it must stay written
    // here whether or not it renders.
    SMS_FEATURE_ENABLED &&
      navAllows(features?.smsAutomation) &&
      (hasFullAccess || perms.manageSms) &&
      { id: 'sms', label: 'SMS', icon: MessageSquare },
    // Community (Rocket.Chat)
    navAllows(features?.communityGroups) &&
      (hasFullAccess || perms.manageCommunity) &&
      { id: 'community', label: 'Community', icon: MessageSquare },
    // Platform course library — super admin authors the shared catalogue that
    // every tenant can adopt. Same super-admin-only gate as Tenants below.
    isSuperAdmin && { id: 'library', label: 'Library', icon: Library },
    isSuperAdmin && { id: 'tenants', label: 'Tenants', icon: Building2 },
    // Admin Roles is no longer a standalone tab — it lives inside the CRM page
    // (Contacts · Analytics · Roles), so it's intentionally absent here.
    // Affiliate — standalone section (near the bottom, above Settings).
    // Master switch first: while the programme is hidden NOBODY gets the entry,
    // super admin included. The permission gate behind it is left untouched so
    // flipping AFFILIATE_PROGRAM_ENABLED restores the exact same entitlement.
    // The 'affiliate' id stays listed in MORE_GROUPS / DESKTOP_NAV_GROUPS above:
    // those groups are filtered against this array, so an absent tab drops out
    // of its group on its own — and the grouping survives for the flip back.
    AFFILIATE_PROGRAM_ENABLED &&
      (isSuperAdmin || hasFullAccess || perms.manageAffiliate) && { id: 'affiliate', label: 'Affiliate', icon: Link2 },
    // Branding — standalone appearance tab (logo, color, background, domain)
    canBranding && { id: 'branding', label: 'Branding', icon: Palette },
  ].filter(Boolean) as { id: string; label: string; icon: any }[];

  // Mobile: 4 tabs in the bottom bar. If the admin has saved a custom order,
  // use it (filtered to still-permitted tabs). Otherwise default to first 4.
  // The More drawer keeps its OWN independent saved order (customMoreIds).
  // Annotated rather than inferred: `drawerTabs` is read inside the closure on
  // the customMoreIds path below, where TypeScript cannot resolve a type it is
  // still inferring from later assignments.
  let primaryTabs: typeof allTabs;
  let drawerTabs: typeof allTabs; // reorderable drawer tabs (excludes the fixed Inbox/Settings)
  if (customPrimaryIds && customPrimaryIds.length > 0) {
    const orderedBar = customPrimaryIds
      .map((id) => allTabs.find((t) => t.id === id))
      .filter(Boolean)
      .slice(0, 4) as typeof allTabs;
    const barSet = new Set(orderedBar.map((t) => t.id));
    primaryTabs = orderedBar;
    drawerTabs = allTabs.filter((t) => !barSet.has(t.id));
  } else {
    primaryTabs = allTabs.slice(0, 4);
    drawerTabs = allTabs.slice(4);
  }

  // Apply the saved More-drawer order on top of the permitted drawer tabs.
  if (customMoreIds && customMoreIds.length > 0) {
    const drawerSet = new Set(drawerTabs.map((t) => t.id));
    const ordered = customMoreIds
      .filter((id) => drawerSet.has(id))
      .map((id) => drawerTabs.find((t) => t.id === id)!)
      .filter(Boolean);
    const orderedSet = new Set(ordered.map((t) => t.id));
    // Append any newly-permitted tabs not yet in the saved order.
    drawerTabs = [...ordered, ...drawerTabs.filter((t) => !orderedSet.has(t.id))];
  }

  const moreTabs = [
    ...drawerTabs,
    ...(showInbox ? [{ id: 'inbox', label: 'Platform Inbox', icon: Inbox }] : []),
    ...(canSettings ? [{ id: 'settings', label: 'Settings', icon: Settings }] : []),
  ];

  // Desktop grouped sidebar: look up permitted tabs by id (incl. inbox/settings,
  // which live outside allTabs) so DESKTOP_NAV_GROUPS can render branded sections.
  const desktopNavById = new Map<string, { id: string; label: string; icon: any }>();
  [
    ...allTabs,
    ...(showInbox ? [{ id: 'inbox', label: 'Inbox', icon: Inbox }] : []),
    ...(canSettings ? [{ id: 'settings', label: 'Settings', icon: Settings }] : []),
  ].forEach((t) => desktopNavById.set(t.id, t));

  // THE-225 — the emptiness rule, now read from layout/nav-groups.ts instead of
  // restated inline. The behaviour is unchanged (this sidebar has omitted empty
  // groups since it was built); what changes is that the MEMBER sidebar in
  // MainApp, which did NOT have the rule and drew a "SUPPORT US" heading over
  // nothing for a free member, now shares this one implementation rather than
  // growing a second copy of it.
  const desktopSidebarGroups = visibleNavGroups(
    DESKTOP_NAV_GROUPS.map((group) => ({
      label: group.label,
      items: group.ids
        .map((id) => desktopNavById.get(id))
        .filter(Boolean) as { id: string; label: string; icon: any }[],
    })),
  );

  // If the active tab is not in the allowed tabs, switch to the first allowed tab
  const allTabIds = allTabs.map(t => t.id).join(',');
  useEffect(() => {
    // 'branding' is intentionally NOT hard-coded here — it is only "known" when it
    // is present in allTabs (i.e. the user is entitled), so unauthorized direct
    // navigation to /admin/branding redirects away. 'upgrade' is universally reachable.
    // 'inbox' is only a known/reachable tab in the platform context (super admin
    // on apex). For tenant admins, direct navigation to /admin/inbox redirects
    // away just like any other unentitled tab.
    const known = new Set([...allTabs.map(t => t.id), ...(showInbox ? ['inbox'] : []), ...(canSettings ? ['settings'] : []), 'canvas', 'upgrade']);
    if (!isLoading && allTabs.length > 0 && !known.has(activeTab)) {
      go(allTabs[0].id);
    }
  }, [isLoading, allTabIds, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Header title for the active screen (Dashboard, CRM, Community Chat, …).
  const TITLE_OVERRIDES: Record<string, string> = {
    dashboard: 'Dashboard',
    community: 'Community Chat',
    ai: 'AI Knowledge',
    inbox: 'Platform Inbox',
    settings: 'Settings',
    upgrade: 'Plan & Billing',
    branding: 'Branding',
    donations: 'Donations',
    canvas: canvasName || 'Canvas',
  };
  const headerTitle = TITLE_OVERRIDES[activeTab]
    || allTabs.find(t => t.id === activeTab)?.label
    || 'Dashboard';

  /** A single full-width row in the grouped More drawer. */
  const renderMoreRow = (tab: { id: string; label: string; icon: any }) => {
    const Icon = tab.icon;
    const isActive = activeTab === tab.id;
    return (
      <button
        key={tab.id}
        onClick={() => go(tab.id)}
        className="w-full flex items-center gap-3 px-[15px] py-3 transition-colors text-left hover:bg-surface-sunken active:bg-surface-sunken"
        style={{ backgroundColor: isActive ? 'color-mix(in srgb, var(--brand-color, #C9963A) 10%, transparent)' : undefined }}
      >
        <span className="w-[30px] h-[30px] shrink-0 rounded-lg bg-surface-sunken flex items-center justify-center">
          <Icon size={16} className="text-gold" />
        </span>
        <span
          className="text-sm font-medium flex-1 text-strong"
          style={isActive ? { color: 'var(--brand-color, #C9963A)' } : undefined}
        >
          {tab.label}
        </span>
        {tab.id === 'inbox' && unreadCount > 0 && (
          <span className="text-xs font-bold text-white bg-red-500 rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
        <ChevronRight size={16} className="text-faint shrink-0" />
      </button>
    );
  };

  /** A single branded desktop sidebar row (used for Dashboard, each group item,
   *  and Settings). Active = gold-tint pill + gold icon/label; inactive = warm. */
  const renderDesktopTab = (tab: { id: string; label: string; icon: any }) => {
    const Icon = tab.icon;
    const isActive = activeTab === tab.id;
    const showDot =
      (tab.id === 'churches' && pendingChurchesCount > 0) ||
      (tab.id === 'inbox' && unreadCount > 0);
    return (
      <button
        key={tab.id}
        onClick={() => go(tab.id)}
        className={`flex items-center rounded-xl transition-all relative shrink-0 ${
          isSidebarCollapsed
            ? 'lg:w-11 lg:h-11 lg:p-0 lg:justify-center'
            : 'lg:justify-start lg:gap-3 lg:w-full lg:h-11 lg:px-3'
        } ${
          isActive
            // The active pill is an accent TINT, so it has to composite over
            // whatever surface is under it. Mixing over hardcoded `white` (as
            // this did) pins it to a near-white #F6EEDF in every theme: on a
            // dark sidebar that is a glaring bright block at 14.5:1 against
            // its own background, and the gold label on it falls to 2.30:1.
            // Same bug, same fix as the twelve member screens in #340, and as
            // the More-drawer row above already does — `white` -> `transparent`.
            // Light is unchanged BY CONSTRUCTION: the sidebar is
            // --surface-raised (#FFFFFF) in light in both families, so mixing
            // over transparent composites onto the very white this hardcoded.
            //
            // The dark tint is stepped down to 12% because the label sits ON
            // it: at 16% the pill lifts far enough off the ground that gold
            // reaches only 4.48:1 on Classic's neutral grey, just under AA.
            // 12% clears it in both families (5.15:1 Harvest, 4.78:1 Classic)
            // and still reads clearly as a selected state. Mode-dependent
            // accent opacity is the same call globals.css already makes for
            // --ring-gold (35% -> 48%) and --border-gold (40% -> 52%).
            //
            // The label/icon below paint in --ink-on-accent-tint: the raw
            // accent in light (unchanged), the chip-corrected accent in dark,
            // so a dark white-label accent stays readable on the tint it sits
            // on. Harvest gold resolves to itself in both.
            ? 'lg:bg-[color-mix(in_srgb,var(--brand-color)_16%,transparent)] dark:lg:bg-[color-mix(in_srgb,var(--brand-color)_12%,transparent)]'
            : 'text-muted hover:text-strong lg:hover:bg-surface-sunken'
        }`}
        style={isActive ? { color: 'var(--ink-on-accent-tint, var(--brand-color, #C9963A))' } : undefined}
        title={isSidebarCollapsed ? tab.label : undefined}
      >
        <Icon
          size={20}
          strokeWidth={isActive ? 2.4 : 2}
          className="shrink-0"
          style={isActive ? { color: 'var(--ink-on-accent-tint, var(--brand-color, #C9963A))' } : undefined}
        />
        {!isSidebarCollapsed && <span className="text-[13px] font-medium truncate">{tab.label}</span>}
        {showDot && (
          <span className={`absolute bg-red-500 rounded-full border-2 border-white ${isSidebarCollapsed ? 'top-1 right-1' : 'top-1/2 -translate-y-1/2 right-3'} w-2.5 h-2.5`}></span>
        )}
      </button>
    );
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-screen bg-surface"><div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #C9963A)', borderTopColor: 'transparent' }}></div></div>;
  }

  return (
    <AdminHeaderContext.Provider value={headerApi}>
    <div className="flex flex-col lg:flex-row h-[100dvh] bg-surface lg:bg-surface font-sans overflow-hidden transition-colors duration-300">

      {/* Side/Bottom Navigation */}
      <div className={`bg-surface-raised border-t lg:border-t-0 lg:border-r border-line lg:border-line flex justify-center lg:justify-start py-2 lg:py-6 px-2 lg:px-4 pb-safe lg:pb-0 fixed lg:relative bottom-0 lg:bottom-auto w-full ${isSidebarCollapsed ? 'lg:w-[88px]' : 'lg:w-64'} lg:h-screen z-[100] shadow-[0_-4px_20px_rgba(0,0,0,0.05)] lg:shadow-[2px_0_10px_rgba(0,0,0,0.02)] transition-all duration-300`}>
        <div className={`flex lg:flex-col justify-around lg:justify-start items-center lg:items-stretch w-full lg:max-w-none lg:gap-2 ${isSidebarCollapsed ? 'lg:items-center' : ''}`}>
          {/* Desktop Logo — the member-app entry point on desktop (the More-drawer
              "Go to User App" row is mobile-only). Routes through handleViewApp so
              the one-shot intent flag keeps us on "/" instead of bouncing to /admin. */}
          <button
            onClick={() => go('dashboard')}
            className={`hidden lg:flex items-center mb-6 shrink-0 text-left hover:opacity-80 transition-opacity ${isSidebarCollapsed ? 'justify-center px-0 w-full' : 'gap-2.5 px-4'}`}
          >
            <img
              src={displayLogo}
              alt={isWhiteLabel ? tenantName : 'Harvest'}
              className="w-9 h-9 object-contain shrink-0"
            />
            {!isSidebarCollapsed && (
              <span className="font-display text-[19px] font-semibold tracking-[-0.01em] text-strong truncate">
                {isWhiteLabel ? tenantName : 'Harvest'}
                {/* Signature gold period belongs to the Harvest lockup only. */}
                {!isWhiteLabel && <span style={{ color: 'var(--brand-color, #C9963A)' }}>.</span>}
              </span>
            )}
          </button>

          {/* Mobile: primary tabs + More button */}
          <div className="flex lg:hidden justify-around items-center w-full">
            {primaryTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => go(tab.id)}
                  className={`flex flex-col items-center justify-center gap-1 w-16 h-12 rounded-xl transition-all relative ${
                    isActive ? '' : 'text-faint'
                  }`}
                  style={isActive ? { color: 'var(--brand-color, #C9963A)' } : undefined}
                >
                  <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                  <span className="text-[10px] font-medium">{tab.label}</span>
                  {tab.id === 'churches' && pendingChurchesCount > 0 && (
                    <span className="absolute top-1 right-2 bg-red-500 rounded-full border-2 border-white w-3 h-3"></span>
                  )}
                </button>
              );
            })}
            <button
              onClick={() => setShowMoreSheet(!showMoreSheet)}
              className={`flex flex-col items-center justify-center gap-1 w-16 h-12 rounded-xl transition-all ${
                showMoreSheet ? '' : 'text-faint'
              }`}
              style={showMoreSheet ? { color: 'var(--brand-color, #C9963A)' } : undefined}
            >
              <MoreHorizontal size={22} strokeWidth={2} />
              <span className="text-[10px] font-medium">More</span>
            </button>
          </div>

          {/* Desktop: grouped, branded sidebar (Dashboard · CONTENT / MINISTRY /
              BROADCASTING / GROW · Settings). Scrolls internally; the logo above
              and Collapse below stay pinned. Empty groups are omitted. */}
          <div className="hidden lg:flex lg:flex-col lg:items-stretch lg:gap-0.5 lg:w-full lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            {desktopNavById.has('dashboard') && renderDesktopTab(desktopNavById.get('dashboard')!)}

            {desktopSidebarGroups.map(({ label, items }) => {
              const collapsed = collapsedGroups.has(label);
              return (
                <div key={label} data-nav-group={label} className="lg:mt-4">
                  {isSidebarCollapsed ? (
                    <div className="mx-2 mb-1 border-t border-line" />
                  ) : (
                    <button
                      onClick={() => toggleGroup(label)}
                      className="w-full flex items-center justify-between px-3 mb-1 hover:opacity-80 transition-opacity"
                    >
                      <span className="text-[10px] font-bold tracking-[0.14em] text-faint uppercase">{label}</span>
                      <ChevronDown size={13} className={`text-faint transition-transform ${collapsed ? '' : 'rotate-180'}`} />
                    </button>
                  )}
                  {!collapsed && <div className="flex flex-col gap-0.5">{items.map(renderDesktopTab)}</div>}
                </div>
              );
            })}

            {desktopNavById.has('settings') && (
              <div className="lg:mt-4">{renderDesktopTab(desktopNavById.get('settings')!)}</div>
            )}
          </div>

          {/* Collapse Button (Bottom) */}
          <div className="hidden lg:flex items-end pb-1 pt-3 mt-auto border-t border-line shrink-0">
            <button
               onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
               className={`flex items-center gap-3 w-full h-11 rounded-xl transition-all px-3 shrink-0 text-muted hover:text-strong hover:bg-surface-sunken ${isSidebarCollapsed ? 'justify-center' : 'justify-start'}`}
               title={isSidebarCollapsed ? "Expand" : "Collapse"}
            >
               {isSidebarCollapsed ? <ChevronRight size={20} strokeWidth={2} /> : <ChevronLeft size={20} strokeWidth={2} />}
               {!isSidebarCollapsed && <span className="text-[13px] font-medium">Collapse</span>}
            </button>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex-1 flex flex-col h-[100dvh] relative bg-surface lg:bg-surface overflow-hidden min-w-0">
        {/* Desktop branded top bar — Open member app · centered page title ·
            search / notifications / account. Matches the admin mockup. */}
        <div className="hidden lg:flex bg-surface-raised border-b border-line h-14 items-center px-6 xl:px-8 z-10 w-full shrink-0">
          {/* Left: back (when a sub-view overrides the header, e.g. an open chat
              thread) — otherwise the "Open member app" shortcut. */}
          {headerOverride?.onBack ? (
            <button
              onClick={headerOverride.onBack}
              className="flex items-center gap-1.5 text-[13px] font-semibold text-strong hover:opacity-70 transition-opacity shrink-0"
              aria-label="Back"
            >
              <ChevronLeft size={20} strokeWidth={2.5} className="text-gold" />
              Back
            </button>
          ) : (
            <button
              onClick={handleViewApp}
              className="flex items-center gap-2 rounded-full border border-line bg-surface-raised pl-1.5 pr-3 py-1.5 text-[13px] font-semibold text-strong hover:bg-surface-sunken transition-colors shrink-0"
            >
              {/* Same white -> transparent fix as the sidebar pill: this chip
                  sits on --surface-raised (the button's own fill), so light is
                  unchanged and dark stops rendering a bright block. No text
                  sits on it — it holds the logo image — so it keeps its 14%. */}
              <span className="w-6 h-6 rounded-md bg-[color-mix(in_srgb,var(--brand-color)_14%,transparent)] flex items-center justify-center shrink-0">
                <img src={displayLogo} alt="" className="w-4 h-4 object-contain" />
              </span>
              Open member app
              <ExternalLink size={13} className="text-muted" />
            </button>
          )}

          {/* Center: active screen title */}
          <h1 className="flex-1 text-center font-display text-xl font-normal tracking-[-0.01em] text-strong truncate px-4">
            {headerOverride?.title ?? headerTitle}
          </h1>

          {/* Right: screen action · search · notifications · account */}
          <div className="flex items-center gap-1 shrink-0">
            {(headerOverride ? headerOverride.action : headerAction) && (
              <div className="mr-1 flex items-center">{headerOverride ? headerOverride.action : headerAction}</div>
            )}
            {showInbox && (
              <button
                onClick={() => go('inbox')}
                className="w-9 h-9 rounded-full flex items-center justify-center text-muted hover:text-strong hover:bg-surface-sunken transition-colors relative"
                style={activeTab === 'inbox' ? { color: 'var(--brand-color, #C9963A)' } : undefined}
                title="Platform Inbox"
                aria-label="Platform Inbox"
              >
                <Bell size={18} />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border border-white" />
                )}
              </button>
            )}
            {/* My Account menu (desktop) — avatar → Profile / Billing / Log out */}
            <div className="pl-1"><MyAccountMenu {...accountMenuProps} /></div>
          </div>
        </div>

        {/* Mobile screen header — back + title + screen action + account. On
            desktop the branded top bar above carries title/action/back, so this
            is hidden (lg:hidden) to avoid a duplicate header. A fullscreen
            sub-view (Notes editor) can hide it entirely via setHeaderHidden. */}
        <div className={headerHidden ? 'hidden' : 'lg:hidden'}>
          <AdminScreenHeader
            title={headerOverride?.title ?? headerTitle}
            titleIcon={headerOverride?.titleIcon}
            onBack={headerOverride ? headerOverride.onBack : (activeTab === 'dashboard' ? undefined : smartBack)}
            action={headerOverride ? headerOverride.action : headerAction}
            rightAccessory={<MyAccountMenu {...accountMenuProps} />}
          />
        </div>

        {/* Main Content Area */}
        <div className={`flex-1 ${activeTab === 'community' ? 'overflow-hidden lg:overflow-y-auto pb-[65px] lg:pb-8' : 'overflow-y-auto pb-24 lg:pb-8'} p-0 lg:p-6 ${showMoreSheet ? 'overflow-hidden' : ''}`}>
          {/* Billing grace window. Mounted in the SHELL rather than on one tab so a
              failed renewal is visible from whichever screen the admin happens to
              open — the point of the banner is that nobody currently finds out at
              all, and a warning that only lives on the Billing tab is a warning for
              people who already went looking. Renders nothing unless this tenant is
              inside the window; see GraceWindowBanner. */}
          <div className="px-4 lg:px-0">
            <GraceWindowBanner tenantId={tenantId ?? null} />
          </div>
          {activeTab === 'dashboard' ? (
            <div className="p-4 lg:p-0">
              <AdminDashboardHome
                tenantId={tenantId ?? null}
                tenantName={isWhiteLabel ? tenantName : 'Harvest'}
                isSuperAdmin={isSuperAdmin}
                unreadCount={unreadCount}
                onNavigate={go}
              />
            </div>
          ) : activeTab === 'blog' ? (
            planAllows(features?.blog)
              ? <div className="p-4 lg:p-0"><AdminBlog /></div>
              : <PlanUpgradeScreen featureName="Blog" featureKey="blog" onBack={() => go('dashboard')} onUpgrade={() => go('upgrade')} />
          ) : activeTab === 'inbox' ? (
            <div className="p-4 lg:p-0"><PlatformInbox /></div>
          ) : activeTab === 'churches' ? (
            <div className="p-4 lg:p-0"><AdminChurches /></div>
          ) : activeTab === 'courses' ? (
            planAllows(features && features.maxCourses !== 0)
              ? <div className="p-4 lg:p-0"><AdminCourses /></div>
              : <PlanUpgradeScreen featureName="Courses" featureKey="maxCourses" onBack={() => go('dashboard')} onUpgrade={() => go('upgrade')} />
          ) : activeTab === 'ai' ? (
            planAllows(features?.aiKnowledge)
              ? <div className="p-4 lg:p-0"><AdminRAG /></div>
              : <PlanUpgradeScreen featureName="AI Knowledge" featureKey="aiKnowledge" onBack={() => go('dashboard')} onUpgrade={() => go('upgrade')} />
          ) : activeTab === 'newsletter' ? (
            planAllows(features?.newsletterAutomation)
              ? <div className="p-4 lg:p-0">
                  {newsletterView === 'editor' ? (
                    <NewsletterEditor
                      tenantId={tenantId || PLATFORM_TENANT_ID}
                      tenantName={tenantName}
                      onBack={() => setNewsletterView('list')}
                      canAutoGenerate={platformOverride || !!(features?.automatedNewsletter)}
                    />
                  ) : (
                    <NewsletterCampaigns
                      tenantId={tenantId || PLATFORM_TENANT_ID}
                      onBack={() => go('dashboard')}
                      onCreateNew={() => setNewsletterView('editor')}
                    />
                  )}
                </div>
              : <PlanUpgradeScreen featureName="Newsletter" featureKey="newsletterAutomation" onBack={() => go('dashboard')} onUpgrade={() => go('upgrade')} />
          ) : activeTab === 'canvas' ? (
            !canvasId ? (
              <div className="p-4 lg:p-0">
                <CanvasList
                  onOpenCanvas={(id, name) => { setCanvasId(id); setCanvasName(name); }}
                />
              </div>
            ) : null
          ) : activeTab === 'fundraising' ? (
            planAllows(features?.fundraising)
              ? <div className="p-4 lg:p-0"><AdminFundraising initialCampaignId={itemId} onItemConsumed={clearItemId} /></div>
              : <PlanUpgradeScreen featureName="Fundraising" featureKey="fundraising" onBack={() => go('dashboard')} onUpgrade={() => go('upgrade')} />
          ) : activeTab === 'donations' ? (
            canDonations
              ? <div className="p-4 lg:p-0"><AdminDonations /></div>
              : <PlanUpgradeScreen featureName="Donations" featureKey="fundraising" onBack={() => go('dashboard')} onUpgrade={() => go('upgrade')} />
          ) : activeTab === 'docs' ? (
            planAllows(features?.docs)
              ? <div className="p-4 lg:p-0"><AdminDocs initialDocId={itemId} onItemConsumed={clearItemId} /></div>
              : <PlanUpgradeScreen featureName="Notes" featureKey="docs" onBack={() => go('dashboard')} onUpgrade={() => go('upgrade')} />
          ) : activeTab === 'events' ? (
            planAllows(features?.eventRegistration)
              ? <div className="p-4 lg:p-0"><AdminEvents /></div>
              : <PlanUpgradeScreen featureName="Events" featureKey="event_registration" onBack={() => go('dashboard')} onUpgrade={() => go('upgrade')} />
          ) : activeTab === 'services' ? (
            planAllows(features?.eventRegistration)
              ? <div className="p-4 lg:p-0"><AdminServices /></div>
              : <PlanUpgradeScreen featureName="Services" featureKey="event_registration" onBack={() => go('dashboard')} onUpgrade={() => go('upgrade')} />
          ) : activeTab === 'crm' ? (
            planAllows(features?.crm)
              ? <div className="p-4 lg:p-0"><AdminCRM currentUserRole={isSuperAdmin ? 'super_admin' : userRole} currentUserPermissions={isChurchAdmin ? { fullAccess: true } as any : userPermissions} initialContactId={itemId} onItemConsumed={clearItemId} /></div>
              : <PlanUpgradeScreen featureName="CRM" featureKey="crm" onBack={() => go('dashboard')} onUpgrade={() => go('upgrade')} />
          ) : activeTab === 'signups' ? (
            planAllows(features?.crm)
              ? <div className="p-4 lg:p-0"><AdminSignups /></div>
              : <PlanUpgradeScreen featureName="Signups" featureKey="crm" onBack={() => go('dashboard')} onUpgrade={() => go('upgrade')} />
          ) : activeTab === 'accounting' ? (
            planAllows(features && (features.accountingTools || features.givingStatements))
              ? <div className="p-4 lg:p-0"><AdminAccounting canManageAccounting={hasFullAccess || !!perms.manageAccounting} canManageStatements={hasFullAccess || !!perms.manageGivingStatements} /></div>
              : <PlanUpgradeScreen featureName="Accounting" featureKey="accounting" onBack={() => go('dashboard')} onUpgrade={() => go('upgrade')} />
          ) : activeTab === 'forms' ? (
            planAllows(features?.customForms)
              ? <div className="p-4 lg:p-0"><AdminForms /></div>
              : <PlanUpgradeScreen featureName="Forms" featureKey="customForms" onBack={() => go('dashboard')} onUpgrade={() => go('upgrade')} />
          ) : activeTab === 'checkin' ? (
            // QR is available on all plans; AdminCheckin renders only the QR sub-tab
            // when the tenant lacks checkInSystem, so it's always safe to mount here.
            <div className="p-4 lg:p-0"><AdminCheckin canCheckin={hasFullAccess || !!perms.manageCheckin} canQR={hasFullAccess || !!perms.manageQR} /></div>
          ) : activeTab === 'livestream' ? (
            planAllows(features?.livestream)
              ? <div className="p-4 lg:p-0"><AdminLivestream /></div>
              : <PlanUpgradeScreen featureName="Livestream" featureKey="livestream" onBack={() => go('dashboard')} onUpgrade={() => go('upgrade')} />
          ) : activeTab === 'sms' ? (
            // With SMS hidden the nav entry is gone, so this branch only catches
            // a typed or bookmarked /admin/sms — and it must not render AdminSms
            // (broadcast composer, automation templates, Text-to-Give setup).
            //
            // 🔴 NOT PlanUpgradeScreen. That screen sells the tier that includes
            // the feature, which would advertise SMS on the very screen meant to
            // hide it — and the tiers that own `smsAutomation` cannot use it
            // either right now. Same "Page not found." treatment as the hidden
            // affiliate section below. Flip SMS_FEATURE_ENABLED to bring the
            // section, and its plan gate, back exactly as they were.
            !SMS_FEATURE_ENABLED
              ? <div className="flex flex-col items-center justify-center h-full text-faint">
                  <p className="text-lg font-medium">Page not found.</p>
                </div>
              : planAllows(features?.smsAutomation)
                ? <div className="p-4 lg:p-0"><AdminSms /></div>
                : <PlanUpgradeScreen featureName="SMS" featureKey="smsAutomation" onBack={() => go('dashboard')} onUpgrade={() => go('upgrade')} />
          ) : activeTab === 'community' ? (
            planAllows(features?.communityGroups)
              ? <div className="p-4 pb-0 lg:p-0 h-full"><AdminCommunity onOpenAttachment={(type, id) => {
                  if (type === 'doc') navigate(`/admin/docs/${id}`);
                  else if (type === 'contact') navigate(`/admin/crm/${id}`);
                  else if (type === 'campaign') navigate(`/admin/fundraising/${id}`);
                }} /></div>
              : <PlanUpgradeScreen featureName="Community Groups" featureKey="community_chat" onBack={() => go('dashboard')} onUpgrade={() => go('upgrade')} />
          ) : activeTab === 'library' ? (
            <div className="p-4 lg:p-0"><AdminLibraryCourses /></div>
          ) : activeTab === 'tenants' ? (
            <div className="p-4 lg:p-0"><AdminTenants /></div>
          ) : activeTab === 'affiliate' ? (
            // With the programme hidden the nav entry is gone, so this branch
            // only catches a typed or bookmarked /admin/affiliate — it must not
            // render the dashboard (referral link, earnings, payout setup).
            // Flip AFFILIATE_PROGRAM_ENABLED to bring the section back.
            AFFILIATE_PROGRAM_ENABLED
              ? <div className="p-4 lg:p-0"><AffiliateSection /></div>
              : <div className="flex flex-col items-center justify-center h-full text-faint">
                  <p className="text-lg font-medium">Page not found.</p>
                </div>
          ) : activeTab === 'branding' ? (
            canBranding
              ? <div className="p-4 lg:p-0"><AdminBranding currentFeatures={features} onBack={() => go('dashboard')} onUpgrade={() => go('upgrade')} /></div>
              : <PlanUpgradeScreen featureName="Branding" featureKey="customBranding" onBack={() => go('dashboard')} onUpgrade={() => go('upgrade')} />
          ) : activeTab === 'upgrade' ? (
            <div className="p-4 lg:p-0">
              <AdminUpgradePage
                currentPlan={tenantPlan ?? undefined}
                tenantId={tenantId ?? undefined}
                email={auth.currentUser?.email ?? undefined}
                onBack={() => go('dashboard')}
              />
            </div>
          ) : activeTab === 'settings' ? (
            <AdminSettings
              onBack={() => go('dashboard')}
              currentPlan={tenantPlan ?? undefined}
              tenantId={tenantId ?? undefined}
              email={auth.currentUser?.email ?? undefined}
              isPlanOwner={isPlanOwner}
              onCustomizeNav={() => setShowNavCustomizer(true)}
              /* THE-246 — the Payments row is now a pointer at the Donations
                 section. Required rather than optional, so the link and the
                 screen it opens cannot get out of step: `go('donations')`
                 always renders the Donations branch of the switch below. */
              onOpenDonations={() => go('donations')}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-faint">
              <p className="text-lg font-medium">{allTabs.find(t => t.id === activeTab)?.label || 'Inbox'} coming soon.</p>
            </div>
          )}
        </div>

        {/* More Sheet (mobile only) */}
        {showMoreSheet && (
          <>
            <div
              className="fixed inset-0 z-[101] lg:hidden"
              style={{ backgroundColor: 'rgba(15,13,11,0.42)' }}
              onClick={() => setShowMoreSheet(false)}
            />
            <div
              className="fixed bottom-0 left-0 right-0 bg-surface rounded-t-[22px] z-[102] lg:hidden shadow-[0_-12px_44px_rgba(0,0,0,0.28)] max-h-[84vh] flex flex-col"
              style={{ animation: 'slideUp 0.25s ease-out' }}
            >
              <div className="w-9 h-1 bg-line-strong rounded-full mx-auto mt-3 mb-1 shrink-0" />
              <div className="flex items-center justify-between px-[18px] pt-1.5 pb-3 shrink-0">
                <h3 className="font-display font-light text-[22px] leading-none tracking-[-0.02em] text-strong">More</h3>
              </div>
              <div className="overflow-y-auto px-[18px] pb-6">

                {/* Grouped, Vercel-style list. Groups with no permitted tabs are omitted. */}
                {MORE_GROUPS.map((group) => {
                  const groupTabs = group.ids
                    .map((id) => moreTabs.find((t) => t.id === id))
                    .filter(Boolean) as { id: string; label: string; icon: any }[];
                  if (groupTabs.length === 0) return null;
                  return (
                    <div key={group.label} className="mb-4">
                      <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted px-1 pb-1.5">
                        {group.label}
                      </p>
                      <div className="bg-surface-raised rounded-brand-xl border border-line overflow-hidden divide-y divide-stone-200">
                        {groupTabs.map(renderMoreRow)}
                      </div>
                    </div>
                  );
                })}

                {/* Safety catch-all: any permitted drawer tab not assigned to a group
                    above (e.g. a tab a user dragged out of the bottom bar) — never
                    leave one unreachable. Empty in normal use, so it renders nothing. */}
                {(() => {
                  const leftover = moreTabs.filter(
                    (t) => t.id !== 'settings' && !GROUPED_MORE_IDS.has(t.id),
                  );
                  if (leftover.length === 0) return null;
                  return (
                    <div className="mb-4">
                      <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted px-1 pb-1.5">
                        OTHER
                      </p>
                      <div className="bg-surface-raised rounded-brand-xl border border-line overflow-hidden divide-y divide-stone-200">
                        {leftover.map(renderMoreRow)}
                      </div>
                    </div>
                  );
                })()}

                {/* The drawer's bottom action stack is gone — it's nav tabs only now.
                    Upgrade Plan was dropped (plan changes go through Billing → the
                    Stripe portal); Settings, Go to User App and Log Out moved to the
                    top-right profile menu (MyAccountMenu) to de-duplicate entry points. */}
              </div>
            </div>
            <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
          </>
        )}

        {/* Nav customizer full-screen modal */}
        {showNavCustomizer && (
          <AdminNavCustomizer
            allTabs={allTabs}
            currentPrimaryIds={customPrimaryIds ?? primaryTabs.map((t) => t.id)}
            currentDrawerIds={drawerTabs.map((t) => t.id)}
            onSave={(primaryIds, drawerIds) => {
              setCustomPrimaryIds(primaryIds);
              setCustomMoreIds(drawerIds);
              setShowNavCustomizer(false);
            }}
            onCancel={() => setShowNavCustomizer(false)}
          />
        )}
      </div>

      {/* Canvas focus mode — covers the entire viewport over the nav & header */}
      {activeTab === 'canvas' && canvasId && (
        <FocusScreen
          onBack={() => { setCanvasId(null); setCanvasName(''); }}
        >
          <CanvasEditor
            canvasId={canvasId}
            canvasName={canvasName}
            onBack={() => { setCanvasId(null); setCanvasName(''); }}
          />
        </FocusScreen>
      )}

      {/* My Profile — the user-app Profile screen shown as an admin overlay so the
          admin never navigates away. A slim top bar provides the close affordance;
          Profile's own sub-modals (fixed inset-0) cover it while open. */}
      {showProfile && (
        <div className="fixed inset-0 z-[200] bg-surface flex flex-col">
          <div className="flex items-center gap-1 h-12 px-3 bg-surface-raised border-b border-line shrink-0">
            <button
              onClick={() => setShowProfile(false)}
              aria-label="Close profile"
              className="p-1.5 -ml-1 text-strong hover:text-strong transition-colors"
            >
              <X size={22} />
            </button>
            <span className="text-sm font-bold text-strong">My Profile</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            <Profile
              onNavigate={(page) => { setShowProfile(false); if (page !== 'admin') onNavigate(page); }}
              onGoToPartner={() => { setShowProfile(false); onNavigate('home'); }}
              onGoToMap={() => { setShowProfile(false); onNavigate('home'); }}
            />
          </div>
        </div>
      )}

      {/* Billing & Payments — owner-only overlay. 'yes' only: an unresolved
          roster must not open it either. The /api/billing/* routes enforce the
          same three-identity owner gate server-side (requireOwner). */}
      {showBilling && billingAccess === 'yes' && (
        <div className="fixed inset-0 z-[200] bg-surface flex flex-col">
          <div className="flex items-center gap-1 h-12 px-3 bg-surface-raised border-b border-line shrink-0">
            <button
              onClick={() => setShowBilling(false)}
              aria-label="Close billing"
              className="p-1.5 -ml-1 text-strong hover:text-strong transition-colors"
            >
              <X size={22} />
            </button>
            <span className="text-sm font-bold text-strong">Billing &amp; Payments</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4 lg:p-6">
            <BillingAndPayments
              currentPlan={tenantPlan ?? undefined}
              tenantId={tenantId ?? undefined}
              email={auth.currentUser?.email ?? undefined}
              tenantName={tenantName}
            />
          </div>
        </div>
      )}
    </div>
    </AdminHeaderContext.Provider>
  );
};

export default AdminDashboard;
