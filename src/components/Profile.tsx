"use client";
import React, { useState, useEffect } from 'react';
import {
  User,
  Church,
  HeartHandshake,
  Bell,
  Sun,
  HelpCircle,
  FileQuestion,
  ShieldCheck,
  LogOut,
  ChevronRight,
  BadgeCheck,
  Moon,
  Play,
  X,
  CalendarCheck,
  Bookmark,
  Receipt
} from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import PaletteFamilyToggle from './PaletteFamilyToggle';
import Image from 'next/image';
import { auth, db, messaging, VAPID_KEY } from '../firebase';
import { signOut, updateProfile } from 'firebase/auth';
import { doc, onSnapshot, updateDoc, collection, query, where, getDocs, arrayUnion } from 'firebase/firestore';
import { getToken } from 'firebase/messaging';
import PersonalInformationModal from './PersonalInformationModal';
import { authFetch } from '../utils/auth-fetch';
import ContactModal from './ContactModal';
import PrivacyTermsModal from './PrivacyTermsModal';
import FAQModal from './FAQModal';
import ChurchDetailsModal from './ChurchDetailsModal';
import UserEvents from './UserEvents';
import SavedItems from './SavedItems';
import DonationHistory from './DonationHistory';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { SUPER_ADMIN_EMAIL, isSuperAdmin as checkIsSuperAdmin, getTenantScope } from '../utils/tenant-scope';
import { isSuperAdminEmail } from '../utils/super-admins';
import { getEffectiveFeatures, toTenantPlan } from '../utils/plan-features';
import { useTenantOptional } from '../contexts/TenantContext';
import { useAppStore } from '../store/useAppStore';


interface ProfileProps {
  onNavigate: (page: string) => void;
  onGoToPartner: () => void;
  onGoToMap: () => void;
  /** Open a saved blog article by id (from the "Saved" section). */
  onOpenSavedBlog?: (postId: string) => void;
  /** Open a saved course lesson by courseId + lessonId. */
  onOpenSavedLesson?: (courseId: string, lessonId: string) => void;
  /** Open the feed for a saved post. */
  onOpenSavedPost?: (postId: string) => void;
}

const Profile: React.FC<ProfileProps> = ({ onNavigate, onGoToPartner, onGoToMap, onOpenSavedBlog, onOpenSavedLesson, onOpenSavedPost }) => {
  const { tenantPlan } = useAppStore();
  const tenantCtx = useTenantOptional();
  /**
   * 🔴 GIVING IS A PLAN CAPABILITY — THE-213.
   *
   * `fundraising: false` means the tenant has no donate page at all, so a
   * Partnership card is a claim about money this church cannot take: "Donor",
   * a lifetime given figure, "Give again →", "Partner with Us →" and a
   * Donation History that can only ever be empty. The member app already drops
   * the Give tab on that cell (MainApp `topTabs`); this section is what THE-205
   * left behind, and it is reachable from both Profile call sites — the member
   * app AND the admin area's "My Profile" overlay — which is why the gate lives
   * here rather than at either caller.
   *
   * EFFECTIVE features, not `getPlanFeatures`: a gate answers what this TENANT
   * holds, not what the tier publishes. The context value is already
   * add-on-layered; the fallback covers a Profile mounted outside a
   * TenantProvider and coerces an unresolved plan to 'plus' exactly as every
   * other unresolved-plan reader does, so a paying member's card never blinks
   * off while the tenant document is in flight.
   *
   * ⚠️ HIDES THE SURFACE, NOT THE RECORD. `donationSubscriptionId`,
   * `donationAmount` and `totalDonated` are still read off the user document
   * below and are never written, cleared or cancelled by this gate — a member
   * whose church upgrades gets the card back with their partnership and their
   * whole giving history intact.
   */
  const planFeatures = tenantCtx?.planFeatures ?? getEffectiveFeatures(toTenantPlan(tenantPlan), null);
  const hasGiving = planFeatures.fundraising;
  const [showMyEvents, setShowMyEvents] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [showDonationHistory, setShowDonationHistory] = useState(false);
 const [isPersonalInfoOpen, setIsPersonalInfoOpen] = useState(false);
 const [isContactOpen, setIsContactOpen] = useState(false);
 const [isPrivacyTermsOpen, setIsPrivacyTermsOpen] = useState(false);
 const [isFAQOpen, setIsFAQOpen] = useState(false);
 const [isChurchDetailsOpen, setIsChurchDetailsOpen] = useState(false);
 const [isNoHomeChurchModalOpen, setIsNoHomeChurchModalOpen] = useState(false);
 const [homeChurchId, setHomeChurchId] = useState<string | null>(null);
 const [hasChurches, setHasChurches] = useState(false);

 // Partnership state
 const [donationAmount, setDonationAmount] = useState<number | null>(null);
 const [donationChurchName, setDonationChurchName] = useState<string | null>(null);
 const [donationSubscriptionId, setDonationSubscriptionId] = useState<string | null>(null);
 // Lifetime giving stamped on the user doc by the donation webhook — reflects
 // one-time gifts too (donationSubscriptionId only covers recurring partnerships).
 const [totalDonated, setTotalDonated] = useState<number>(0);
 const [isCancelingPartnership, setIsCancelingPartnership] = useState(false);
 const [showCancelConfirm, setShowCancelConfirm] = useState(false);

 useEffect(() => {
 const savedHomeChurch = localStorage.getItem('homeChurchId');
 if (savedHomeChurch) {
   setHomeChurchId(savedHomeChurch);
 }
 }, []);

 // Hide "My Home Church" entirely when the tenant has no churches configured.
 useEffect(() => {
 const fetchChurchCount = async () => {
 try {
 const tenantId = await getTenantScope();
 // Single-field filter only (status); tenant scoping applied client-side.
 const q = query(collection(db, 'churches'), where('status', '==', 'active'));
 const querySnapshot = await getDocs(q);
 let count = 0;
 querySnapshot.forEach((docSnap) => {
 const data = docSnap.data();
 if (tenantId && data.tenantId !== tenantId) return;
 count += 1;
 });
 setHasChurches(count > 0);
 } catch (error) {
 try { handleFirestoreError(error, OperationType.GET, `churches`); } catch (e) { console.error(e); }
 }
 };
 fetchChurchCount();
 }, []);

 const handleRemoveHomeChurch = () => {
   setHomeChurchId(null);
   localStorage.removeItem('homeChurchId');
 };

 const handleCancelPartnership = async () => {
   if (!auth.currentUser) return;
   setIsCancelingPartnership(true);
   try {
     const res = await authFetch('/api/stripe/cancel-partnership', {
       method: 'POST',
       body: JSON.stringify({ userId: auth.currentUser.uid }),
     });
     const data = await res.json();
     if (res.ok) {
       setDonationSubscriptionId(null);
       setDonationAmount(null);
       setDonationChurchName(null);
       setShowCancelConfirm(false);
     } else {
       console.error('Cancel partnership error:', data.error);
     }
   } catch (err) {
     console.error('Cancel partnership error:', err);
   } finally {
     setIsCancelingPartnership(false);
   }
 };

 const [hasMounted, setHasMounted] = useState(false);
 useEffect(() => {
 setHasMounted(true);
 }, []);

 const [profilePic, setProfilePic] = useState<string | null>(auth.currentUser?.photoURL || null);
 const [userName, setUserName] = useState<string>('Loading...');
 const [isAdmin, setIsAdmin] = useState(false);
 // Missing field on existing user docs == enabled (back-compat default).
 const [notificationsEnabled, setNotificationsEnabled] = useState(true);
 const [notificationsPermissionDenied, setNotificationsPermissionDenied] = useState(false);

 useEffect(() => {
 let unsubscribe: (() => void) | null = null;
 let cancelled = false;

 const fetchUserData = async () => {
 if (auth.currentUser) {
 try {
 const userRef = doc(db, 'users', auth.currentUser.uid);
 if (cancelled) return;
 unsubscribe = onSnapshot(userRef, (userDoc) => {
 if (userDoc.exists()) {
   const data = userDoc.data();
   if (data.displayName) {
     setUserName(data.displayName);
   } else {
     setUserName(auth.currentUser?.displayName || 'User');
   }
   if (data.photoURL) {
     setProfilePic(data.photoURL);
   }
   if (data.role === 'admin' || data.role === 'church_admin' || data.role === 'super_admin' || isSuperAdminEmail(data.email)) {
     setIsAdmin(true);
   }
   // Partnership data
   setDonationAmount(data.donationAmount || null);
   setDonationChurchName(data.donationChurchName || null);
   setDonationSubscriptionId(data.donationSubscriptionId || null);
   setTotalDonated(Number(data.totalDonated) || 0);
   setNotificationsEnabled(data.notificationsEnabled !== false);
 } else {
 setUserName(auth.currentUser?.displayName || 'User');
 }
 }, (error) => {
 try { handleFirestoreError(error, OperationType.GET, `users/${auth.currentUser?.uid}`); } catch (e) { console.error(e); }
 setUserName(auth.currentUser?.displayName || 'User');
 });
 } catch (error) {
 try { handleFirestoreError(error, OperationType.GET, `users/${auth.currentUser?.uid}`); } catch (e) { console.error(e); }
 setUserName(auth.currentUser?.displayName || 'User');
 }
 }
 };
 fetchUserData();

 return () => {
   cancelled = true;
   if (unsubscribe) {
     unsubscribe();
   }
 };
 }, []);

 useEffect(() => {
 const savedPic = localStorage.getItem('profilePic');
 if (savedPic && !auth.currentUser?.photoURL) {
 setProfilePic(savedPic);
 }
 }, []);

 useEffect(() => {
 if (typeof Notification !== 'undefined') {
 setNotificationsPermissionDenied(Notification.permission === 'denied');
 }
 }, []);

 const handleToggleNotifications = async () => {
 if (!auth.currentUser) return;
 const uid = auth.currentUser.uid;
 const next = !notificationsEnabled;
 setNotificationsEnabled(next);
 try {
 await updateDoc(doc(db, 'users', uid), { notificationsEnabled: next });
 } catch (error) {
 setNotificationsEnabled(!next);
 try { handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`); } catch (e) { console.error(e); }
 return;
 }

 if (!next || typeof Notification === 'undefined') return;

 // Turning on: the pref alone doesn't grant OS permission or register a
 // device token, so mirror onboarding's opt-in flow to make it actually work.
 try {
 let permission = Notification.permission;
 if (permission === 'default') {
 permission = await Notification.requestPermission();
 }
 setNotificationsPermissionDenied(permission === 'denied');
 if (permission === 'granted') {
 const msg = await messaging;
 if (msg) {
 const token = await getToken(msg, { vapidKey: VAPID_KEY });
 if (token) {
 await updateDoc(doc(db, 'users', uid), { fcmTokens: arrayUnion(token) });
 }
 }
 }
 } catch (e) {
 console.error('Failed to (re-)register notification token:', e);
 }
 };

 const handleLogout = async () => {
 try {
 await signOut(auth);
 } catch (error) {
 console.error('Error signing out:', error);
 }
 };

 const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
 const file = e.target.files?.[0];
 if (file && auth.currentUser) {
 const reader = new FileReader();
 reader.onloadend = async () => {
 const img = new window.Image();
 img.onload = async () => {
 const canvas = document.createElement('canvas');
 const MAX_WIDTH = 400;
 const MAX_HEIGHT = 400;
 let width = img.width;
 let height = img.height;

 if (width > height) {
 if (width > MAX_WIDTH) {
 height *= MAX_WIDTH / width;
 width = MAX_WIDTH;
 }
 } else {
 if (height > MAX_HEIGHT) {
 width *= MAX_HEIGHT / height;
 height = MAX_HEIGHT;
 }
 }

 canvas.width = width;
 canvas.height = height;
 const ctx = canvas.getContext('2d');
 ctx?.drawImage(img, 0, 0, width, height);
 
 const base64String = canvas.toDataURL('image/jpeg', 0.7);
 
 setProfilePic(base64String);
 localStorage.setItem('profilePic', base64String);
 
 try {
 const uid = auth.currentUser?.uid;
 if (!uid) return;
 const userRef = doc(db, 'users', uid);
 await updateDoc(userRef, { photoURL: base64String });
 if (auth.currentUser) {
 await updateProfile(auth.currentUser, { photoURL: base64String });
 }
 } catch (error) {
 try { handleFirestoreError(error, OperationType.UPDATE, `users/${auth.currentUser?.uid}`); } catch (e) { console.error(e); }
 }
 };
 img.src = reader.result as string;
 };
 reader.readAsDataURL(file);
 }
 };

 return (
 <div className="flex flex-col min-h-full bg-surface lg:bg-transparent transition-colors duration-300">
 {/* Branded navy header card — Harvest Member App design: navy→gold wash + film
     grain, gold avatar disc (photo or initial), Fraunces name, member-since chip.
     Mobile only; desktop uses the white profile card in the grid below. */}
 <div className="lg:hidden px-4 pt-4">
 {/* Hidden File Input */}
 <input
 type="file"
 id="profile-pic-upload"
 className="hidden"
 accept="image/*"
 onChange={handleFileChange}
 />
 <div className="relative overflow-hidden rounded-[24px] px-5 pt-8 pb-6 text-center" style={{ background: 'var(--surface-night)' }}>
 {/* navy→gold radial wash */}
 <span aria-hidden className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(120% 130% at 85% 10%, color-mix(in srgb, var(--brand-color) 30%, transparent), transparent 55%)' }} />
 {/* film grain */}
 <span aria-hidden className="absolute inset-0 pointer-events-none mix-blend-overlay" style={{ backgroundImage: 'var(--grain-url)', opacity: 0.06 }} />

 <div className="relative z-10">
 <label htmlFor="profile-pic-upload" className="cursor-pointer inline-block">
 <div className="w-[76px] h-[76px] mx-auto mb-3 rounded-full overflow-hidden flex items-center justify-center" style={{ background: 'var(--surface-gold)', border: '2px solid rgba(255,255,255,0.16)' }}>
 {profilePic ? (
 <img src={profilePic} alt={userName} className="w-full h-full object-cover" />
 ) : (
 <span className="font-display text-3xl font-light text-wheat-800">{(userName || 'U').charAt(0).toUpperCase()}</span>
 )}
 </div>
 </label>
 <h2 className="font-display font-light text-[22px] tracking-[-0.01em] text-white">{userName}</h2>
 <div className="inline-flex items-center gap-1.5 mt-2.5 px-3 py-1 rounded-full text-[10.5px] font-bold tracking-wider" style={{ background: 'rgba(212,165,74,0.18)', color: 'var(--wheat-glow)' }}>
 <BadgeCheck size={12} /> Member since 2026
 </div>
 </div>
 </div>
 </div>

 {/* Content Section — the page's composition, desktop only (`lg:` and up);
     every class here is breakpoint-prefixed so the sub-640px rendering is
     byte-for-byte what it was.

     `lg:w-full` is load-bearing, not decoration. This div is a flex item of
     the `flex flex-col` root above, and `lg:mx-auto` sets auto margins on the
     *cross* axis — which suppresses the flex item's default `stretch`. Without
     an explicit width the item therefore sized to max-content (643px measured
     at 1440px), so `lg:max-w-[1280px]` never bound and the whole page rendered
     as a narrow island floating in the middle of a 1216px area, with the
     settings column squeezed to 236px. `lg:w-full` gives it a definite cross
     size, so max-w caps it and mx-auto centres what is left.

     `minmax(0,1fr)` rather than `1fr`: a bare `1fr` track has an automatic
     minimum, so a long unbreakable string in a settings row could push the
     column past the container instead of wrapping inside it.

     The identity rail is 260px rather than the previous 320px. The card holds
     an 87px avatar, a name and a chip — 260px carries all three — and every
     pixel of rail width is a pixel of blank column underneath it, because the
     rail's content is short and the settings list is not.

     A shared page container (max-width, gutters) is being built in parallel and
     is expected to replace the `lg:w-full lg:max-w-[…] lg:mx-auto lg:px-8` part
     of this line later; the grid itself is Profile's own composition and stays. */}
 <div className="px-4 mt-6 relative z-10 space-y-6 lg:mt-0 lg:px-8 lg:pt-6 lg:w-full lg:max-w-[1280px] lg:mx-auto lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-8 lg:items-start lg:space-y-0">
 {/* Desktop profile card — left column */}
 <div className="hidden lg:block">
 <div className="bg-surface-raised rounded-3xl border border-line p-6 text-center lg:sticky lg:top-4">
 <label htmlFor="profile-pic-upload" className="cursor-pointer group block">
 <div className="w-24 h-24 rounded-full mx-auto mb-3 overflow-hidden flex items-center justify-center" style={{ background: 'var(--surface-gold)' }}>
 {profilePic ? (
 <img src={profilePic} alt={userName} className="w-full h-full object-cover" />
 ) : (
 <span className="text-3xl font-light font-display text-wheat-800">{(userName || 'U').charAt(0).toUpperCase()}</span>
 )}
 </div>
 <span className="text-[12px] font-semibold group-hover:underline" style={{ color: 'var(--brand-color, #C9963A)' }}>Change photo</span>
 </label>
 <h2 className="text-xl font-light text-strong font-display mt-3 tracking-[-0.01em]">{userName}</h2>
 <div className="inline-flex items-center gap-1.5 mt-2 px-3 py-1 rounded-full text-[11px] font-bold text-wheat-800" style={{ background: 'var(--surface-gold)' }}>
 <BadgeCheck size={13} /> Member since 2026
 </div>
 </div>
 </div>

 {/* Settings — right column.

     From `xl` (1280px) up this column splits into two, because at that width a
     single settings column is both too wide to read as a list (its rows reach
     ~800px) and too tall to sit beside a 234px identity card without leaving a
     dead rail below it. Splitting fixes both at once: the rows come back to a
     list measure, and the page gets short enough that the rail no longer has
     several hundred pixels of nothing under it.

     The split is done by grouping, not by auto-placement. Handing four blocks
     to a two-column grid would put Partnership in row 1 beside Account
     Settings and then start Support & Info in row 2 under Account Settings,
     tying every block's top to the tallest block in its row. Two explicit
     groups let each column stack at its own rhythm. Document order is
     untouched — reading left column then right column is still Account
     Settings → Partnership → Support & Info → Log Out.

     Below `xl` the two wrappers are inert: the outer `space-y-6` puts 24px
     between the groups and each inner `space-y-6` puts 24px between its own
     children, which is exactly the 24px-between-every-block the flat list
     produced. */}
 <div className="space-y-6 xl:space-y-0 xl:grid xl:grid-cols-2 xl:gap-6 xl:items-start">

 <div className="space-y-6">

 {/* Account Settings */}
 <div>
 <h4 className="text-[10px] font-bold text-faint tracking-wider uppercase mb-3 ml-2">Account Settings</h4>
 <div className="bg-surface-raised rounded-3xl shadow-sm border border-line overflow-hidden transition-colors duration-300">
 {isAdmin && (
 <>
 {/* Gold, not red. Red is reserved for destructive actions (Log Out, Cancel
     Partnership) — a red disc on a plain navigation row reads as "this
     deletes something". Gold is the brand's action colour and carries the
     authority this row actually has. */}
 <SettingItem
 icon={<ShieldCheck size={16} className="text-wheat-600" />}
 iconBg="bg-wheat-100"
 label="Admin Dashboard"
 onClick={() => onNavigate('admin')}
 />
 <div className="h-px bg-surface-sunken mx-4"></div>
 </>
 )}
 <SettingItem
 icon={<User size={16} className="text-wheat-600" />}
 iconBg="bg-wheat-100"
 label="Personal Information"
 onClick={() => setIsPersonalInfoOpen(true)}
 />
 {hasChurches && (
 <>
 <div className="h-px bg-surface-sunken mx-4"></div>
 <SettingItem
 icon={<Church size={16} className="text-field-600" />}
 iconBg="bg-field-100"
 label="My Home Church"
 onClick={() => {
 if (homeChurchId) {
 setIsChurchDetailsOpen(true);
 } else {
 setIsNoHomeChurchModalOpen(true);
 }
 }}
 />
 </>
 )}
 {/* "Partner with Us" removed here — the Partnership card below is the single
     home for giving (Give again / Partner CTA + Donation History). */}
 <div className="h-px bg-surface-sunken mx-4"></div>
 <ToggleSettingItem
 icon={<Bell size={16} className="text-field-600" />}
 iconBg="bg-field-100"
 label="Push Notifications"
 sublabel={notificationsEnabled && notificationsPermissionDenied ? 'Blocked in device settings' : undefined}
 checked={notificationsEnabled}
 onChange={handleToggleNotifications}
 />
 {/* Messages now lives in the top tab bar (News | Blog | Courses | Messages | Partner) */}
 {/* My Events row — shown to everyone with a resolved tenant/plan context.
     Admins/owners register for and hold their own event tickets too, so they
     need this just like members do. UserEvents queries /api/my-registrations by
     the current user's own uid/email, so an admin only ever sees their own
     tickets — no admin-specific logic and no cross-user leakage. */}
 {/* Always shown — UserEvents scopes to the current user's own registrations
     and handles a missing tenant gracefully (empty state). */}
 <div className="h-px bg-surface-sunken mx-4"></div>
 <SettingItem
 icon={<CalendarCheck size={16} className="text-field-600" />}
 iconBg="bg-field-100"
 label="My Events"
 onClick={() => setShowMyEvents(true)}
 />
 {/* Saved — bookmarked articles, lessons, posts and verses (private to the user). */}
 <div className="h-px bg-surface-sunken mx-4"></div>
 <SettingItem
 icon={<Bookmark size={16} className="text-field-600" />}
 iconBg="bg-field-100"
 label="Saved"
 onClick={() => setShowSaved(true)}
 />
 {/* Appearance — the member-facing half of the theme control. Harvest is
     mobile-first and this Profile list is the mobile settings surface, so
     the toggle has to be reachable here and not only in admin settings
     (which most members never see).

     Two independent controls: palette family (Harvest/Classic) on the LEFT,
     mode (light/dark/system) on the RIGHT, one row — the founder's explicit
     call, checked on a phone: "the switch for themes should not be under but
     next to it." That includes mobile; this row is a deliberate exception to
     the rule that mobile stays byte-identical elsewhere on this page. The
     icon + "Appearance" label from the single-control version stays dropped —
     both pill groups are self-labelling, so nothing is lost by not captioning
     the row itself. Order here (family, then mode) matches the visual order
     left-to-right, so DOM/tab order and reading order agree — not reversed
     with CSS, which would desync focus order from what is on screen.

     Full labels do not fit beside each other at a 380px viewport: measured in
     Chromium, mode (Light/Dark/System) plus family (Harvest/Classic) need
     ~380px of button content alone (161px family + 8px gap + 211px mode) —
     more than the ~314px available inside this card's own px-4 gutters at
     380px, even before either control's own padding. Text is never shrunk
     below the 11px floor to close that gap; instead both controls hide their
     label text below `sm` (640px) and fall back to icon + `aria-label`
     (ThemeToggle.tsx / PaletteFamilyToggle.tsx), which fits at 380px with
     ~150px to spare (194px natural width in a 346px-wide card).

     Labels return from `sm` up — but NOT unconditionally: they hide again
     from `xl` (1280px) up, which is not symmetry for its own sake. `settings`
     (below) splits into a two-column grid exactly AT `xl`, and that split
     makes this card's column narrower than the single, unsplit column it was
     just below that breakpoint — width does not grow monotonically with the
     viewport here. A real Chromium measurement of the full nested grid
     (container → rail + settings → this column → this card → this row) found
     a genuine 41px overflow at exactly 1280px width with labels shown — one
     of the most common laptop viewport widths there is. The 1280–1360px
     range stays icon-only rather than chase that band with a one-off
     breakpoint: `xl` is already a real Tailwind step, and the interval is
     narrow enough (this column widens fast past it) that a bespoke pixel
     value would buy back very little for a magic number future code would
     have no way to rediscover the reason for. Verified clean (no overflow)
     at every 50–170px step from 375px to 1920px with this rule: labels
     shown 640–1279px (this page's single-column phase, ~605–989px
     available) and hidden again everywhere from 1280px up, even past where
     the column widens back out. See ThemeToggle.tsx / PaletteFamilyToggle.tsx
     for the breakpoints. */}
 <div className="h-px bg-surface-sunken mx-4"></div>
 <div className="flex items-center gap-2 px-4 py-3">
 <PaletteFamilyToggle />
 <ThemeToggle variant="row" />
 </div>
 </div>
 </div>

 </div>

 {/* Second settings group — Partnership, Support & Info and Log Out. Sits
     beside Account Settings from `xl` up and directly under it below that.

     🔴 On a tenant without `fundraising` the Partnership block is absent and
     this group is Support & Info + Log Out. That leaves NO GAP: the group is a
     `space-y-6` stack, which spaces the children it actually has, and the two
     survivors are self-contained cards with their own headings — nothing here
     reserved a slot for Partnership or measured against it. Below `xl` the
     column simply gets shorter; from `xl` up the two groups are independent
     stacks (see the note above the grid), so the left column keeps its own
     rhythm rather than being tied to this one's height. */}
 <div className="space-y-6">

 {/* Partnership — see `hasGiving` at the top of this component. */}
 {hasGiving && (
 <div>
 <h4 className="text-[10px] font-bold text-faint tracking-wider uppercase mb-3 ml-2">Partnership</h4>
 <div className="bg-surface-raised rounded-3xl shadow-sm border border-line overflow-hidden p-4">
 {donationSubscriptionId ? (
 <div>
 <div className="flex items-center gap-3 mb-3">
 <div className="w-7 h-7 rounded-full flex items-center justify-center bg-wheat-100">
 <HeartHandshake size={16} className="text-wheat-600" />
 </div>
 <div>
 <p className="text-sm font-bold text-strong">
 {/* donationAmount is stored in DOLLARS (BUG 2) — display it directly. */}
 ${donationAmount ? donationAmount.toFixed(0) : '—'} / month
 </p>
 {donationChurchName && (
 <p className="text-xs text-muted">{donationChurchName}</p>
 )}
 </div>
 </div>
 {showCancelConfirm ? (
 <div className="bg-red-50 rounded-xl p-3 mt-2">
 <p className="text-xs text-red-600 font-medium text-center mb-3">
 Are you sure? Your recurring donation will be canceled at the end of the current period.
 </p>
 <div className="flex gap-2">
 <button
 onClick={() => setShowCancelConfirm(false)}
 className="flex-1 py-2 bg-surface-raised text-body rounded-xl font-medium text-sm border border-line"
 >
 Keep
 </button>
 <button
 onClick={handleCancelPartnership}
 disabled={isCancelingPartnership}
 className="flex-1 py-2 bg-red-600 text-white rounded-xl font-bold text-sm disabled:opacity-50"
 >
 {isCancelingPartnership ? 'Canceling...' : 'Cancel'}
 </button>
 </div>
 </div>
 ) : (
 <button
 onClick={() => setShowCancelConfirm(true)}
 className="w-full flex items-center justify-between p-3 bg-red-50 rounded-xl hover:bg-red-100 transition-colors mt-1"
 >
 <span className="text-sm font-bold text-red-600">Cancel Partnership</span>
 <X size={16} className="text-red-400" />
 </button>
 )}
 </div>
 ) : totalDonated > 0 ? (
 <div>
 <div className="flex items-center gap-3">
 <div className="w-7 h-7 rounded-full flex items-center justify-center bg-wheat-100">
 <HeartHandshake size={16} className="text-wheat-600" />
 </div>
 <div className="flex-1">
 <p className="text-sm font-bold text-strong">Donor</p>
 {/* totalDonated is stored in DOLLARS (BUG 2) — display it directly. */}
 <p className="text-xs text-muted">${totalDonated.toFixed(0)} given</p>
 </div>
 <button
 onClick={onGoToPartner}
 className="text-sm font-bold text-gold"
 >
 Give again →
 </button>
 </div>
 </div>
 ) : (
 <div className="text-center py-2">
 <p className="text-sm text-muted">You don&apos;t have an active partnership</p>
 <button
 onClick={onGoToPartner}
 className="mt-2 text-sm font-bold text-gold"
 >
 Partner with Us →
 </button>
 </div>
 )}
 </div>
 {/* Donation History — the member's own receipts + giving totals, private to
     them. Placed under Partnership (per the founder), reusing SettingItem/card
     styling. Always shown; the view renders an empty state for non-donors. */}
 <div className="bg-surface-raised rounded-3xl shadow-sm border border-line overflow-hidden mt-3">
 <SettingItem
 icon={<Receipt size={16} className="text-wheat-600" />}
 iconBg="bg-wheat-100"
 label="Donation History"
 onClick={() => setShowDonationHistory(true)}
 />
 </div>
 </div>
 )}

 {/* Support & Info */}
 <div>
 <h4 className="text-[10px] font-bold text-faint tracking-wider uppercase mb-3 ml-2">Support & Info</h4>
 <div className="bg-surface-raised rounded-3xl shadow-sm border border-line overflow-hidden transition-colors duration-300">
 <SettingItem 
 icon={<HelpCircle size={16} className="text-wheat-600" />} 
 iconBg="bg-wheat-100" 
 label="Contact Us"
 onClick={() => setIsContactOpen(true)}
 />
 <div className="h-px bg-surface-sunken mx-4"></div>
 <SettingItem
 icon={<FileQuestion size={16} className="text-field-600" />}
 iconBg="bg-field-100" 
 label="FAQ" 
 onClick={() => setIsFAQOpen(true)}
 />
 <div className="h-px bg-surface-sunken mx-4"></div>
 <SettingItem
 icon={<ShieldCheck size={16} className="text-wheat-600" />}
 iconBg="bg-wheat-100"
 label="Privacy & Terms"
 onClick={() => setIsPrivacyTermsOpen(true)}
 />
 {/* THE-225 — the Roadmap row is GONE. It was admin-only, it opened a public
     Trello board in a new tab, and it was the only row on this screen that
     left the product for a surface nobody maintains as documentation. Removed
     here and from the marketing site's top nav in the same change, so there is
     no Roadmap link left in either repo.

     The group survives it: Support & Info still holds Contact Us, FAQ and
     Privacy & Terms on every tier and for every member, so nothing here
     orphans a heading — which is the defect the member SIDEBAR had, and a
     different surface from this one. `isAdmin` is still read by the Admin
     Dashboard entry above and by PrivacyTermsModal below. */}
 </div>
 </div>

 {/* Log Out Button */}
 <button 
 onClick={handleLogout}
 className="w-full bg-red-50 hover:bg-red-100 text-red-500 font-bold py-3.5 px-4 rounded-2xl flex items-center justify-center gap-2 transition-colors mt-4 text-sm"
 >
 <LogOut size={18} />
 Log Out
 </button>

 </div>
 </div>
 </div>

 <PersonalInformationModal
 isOpen={isPersonalInfoOpen}
 onClose={() => setIsPersonalInfoOpen(false)}
 />
 <ContactModal
 isOpen={isContactOpen}
 onClose={() => setIsContactOpen(false)}
 />
 {/* Same `isAdmin` that gates the Admin Dashboard entry above — passed down so
     the Refund & Cancellation link reuses that one condition instead of a
     second admin check. Privacy and Terms are not gated by it. */}
 <PrivacyTermsModal
 isOpen={isPrivacyTermsOpen}
 onClose={() => setIsPrivacyTermsOpen(false)}
 isAdmin={isAdmin}
 />
 <FAQModal
 isOpen={isFAQOpen}
 onClose={() => setIsFAQOpen(false)}
 />
 <ChurchDetailsModal
 isOpen={isChurchDetailsOpen}
 onClose={() => setIsChurchDetailsOpen(false)}
 churchId={homeChurchId}
 isHomeChurch={true}
 onRemoveHomeChurch={handleRemoveHomeChurch}
 fullPage={true}
 />

 {isNoHomeChurchModalOpen && (
 <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
 <div className="bg-surface-raised rounded-2xl w-full max-w-sm overflow-hidden shadow-xl animate-fadeUp">
 <div className="p-6 text-center">
 <div className="w-16 h-16 bg-surface-sunken rounded-full flex items-center justify-center mx-auto mb-4">
 <Church size={32} className="text-faint" />
 </div>
 <h3 className="text-xl font-bold text-strong mb-2 font-display">No Home Church</h3>
 <p className="text-muted mb-6 text-sm">
 You have no churches selected. Add a church to stay connected with your local community.
 </p>
 <div className="flex flex-col gap-3">
 <button
 onClick={() => {
 setIsNoHomeChurchModalOpen(false);
 onGoToMap();
 }}
 className="w-full py-3 bg-gold text-white font-bold rounded-xl hover:bg-[color-mix(in_srgb,var(--brand-color)_85%,black)] transition-colors"
 >
 Add Church
 </button>
 <button
 onClick={() => setIsNoHomeChurchModalOpen(false)}
 className="w-full py-3 bg-surface-sunken text-body font-bold rounded-xl hover:bg-surface-chip transition-colors"
 >
 Cancel
 </button>
 </div>
 </div>
 </div>
 </div>
 )}

 {showMyEvents && (
 <div className="fixed inset-0 z-[300] bg-surface-tint">
 <UserEvents onBack={() => setShowMyEvents(false)} />
 </div>
 )}

 {showSaved && (
 <div className="fixed inset-0 z-[300] bg-surface-tint">
 <SavedItems
 onBack={() => setShowSaved(false)}
 onOpenBlog={(id) => { setShowSaved(false); onOpenSavedBlog?.(id); }}
 onOpenLesson={(courseId, lessonId) => { setShowSaved(false); onOpenSavedLesson?.(courseId, lessonId); }}
 onOpenPost={(id) => { setShowSaved(false); onOpenSavedPost?.(id); }}
 />
 </div>
 )}

 {/* `hasGiving &&` is not redundant with the state. The only setter lives
     inside the Partnership block above, so on a tier without `fundraising`
     this can never open — but the ROUTE is gated as well as the entry point,
     for the reason MainApp writes on its Messages tab: an entry point alone
     only hides a screen, and DonationHistory opens its own receipt queries the
     moment it mounts. */}
 {showDonationHistory && hasGiving && (
 <div className="fixed inset-0 z-[300] bg-surface-tint">
 <DonationHistory onBack={() => setShowDonationHistory(false)} />
 </div>
 )}
 </div>
 );
};

const SettingItem = ({ icon, iconBg, label, onClick, badge }: { icon: React.ReactNode, iconBg: string, label: string, onClick?: () => void, badge?: number }) => (
 <button onClick={onClick} className="w-full flex items-center justify-between p-3.5 hover:bg-surface-sunken transition-colors">
 <div className="flex items-center gap-3">
 <div className={`w-7 h-7 rounded-full flex items-center justify-center ${iconBg}`}>
 {icon}
 </div>
 <span className="text-[13px] font-medium text-body">{label}</span>
 </div>
 <div className="flex items-center gap-2">
 {badge !== undefined && badge > 0 && (
 <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
 {badge > 99 ? '99+' : badge}
 </span>
 )}
 <ChevronRight size={16} className="text-faint" />
 </div>
 </button>
);

const ToggleSettingItem = ({ icon, iconBg, label, sublabel, checked, onChange }: { icon: React.ReactNode, iconBg: string, label: string, sublabel?: string, checked: boolean, onChange: () => void }) => (
 <div className="w-full flex items-center justify-between p-3.5">
 <div className="flex items-center gap-3 min-w-0">
 <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${iconBg}`}>
 {icon}
 </div>
 <div className="min-w-0">
 <span className="block text-[13px] font-medium text-body">{label}</span>
 {sublabel && (
 <span className="block text-[11px] text-faint truncate">{sublabel}</span>
 )}
 </div>
 </div>
 <button
 type="button"
 role="switch"
 aria-checked={checked}
 aria-label={label}
 onClick={onChange}
 className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors"
 style={{ background: checked ? 'var(--brand-color, #C9963A)' : 'var(--border-strong)' }}
 >
 <span
 className="inline-block h-5 w-5 transform rounded-full bg-surface-raised shadow transition-transform"
 style={{ transform: checked ? 'translateX(21px)' : 'translateX(2px)' }}
 />
 </button>
 </div>
);

export default Profile;
