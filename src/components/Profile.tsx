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
  Receipt,
  Download
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from '@/components/ui/empty';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import ThemeToggle from './ThemeToggle';
import PaletteFamilyToggle from './PaletteFamilyToggle';
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
import InstallAppModal from './install/InstallAppModal';
import { isNativeShell } from '../lib/pwa-install';
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
  /**
   * Jump to the member app's Give page — absent when there is none to jump to.
   *
   * 🔴 OPTIONAL SINCE THE-246, and the absence is the gate. `fundraising` says
   * the church MAY take gifts; it does not say it CAN, and a church with no
   * connected Stripe account and no payment links has a Give page that is
   * hidden entirely. "Give again →" pointing at it would be a button that
   * visibly does nothing — the THE-193 dead end. So the two CTAs below render
   * only when a caller hands over a real destination.
   *
   * ⚠️ The admin area's "My Profile" overlay still always passes one: there it
   * leaves the admin for the member app rather than opening the Give page, so
   * it is not the same jump and cannot be the same dead end.
   */
  onGoToPartner?: () => void;
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
 const [isInstallAppOpen, setIsInstallAppOpen] = useState(false);
 /**
  * THE-255. Inside the Capacitor shell there is nothing to install — its
  * WebView loads this very origin (`server.url`), so the same code runs and
  * would otherwise offer to install the app to someone already holding it.
  * Resolved once, at mount: it cannot change for the life of the document.
  */
 const [inNativeShell] = useState(() => isNativeShell());
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
 {/* THE-321 — the navy ground is `bg-surface-night`, the mapped utility for
     the token this was already spelling inline by hand. Same value, one fewer
     inline style. The three declarations that REMAIN on this hero are a radial
     gradient, a grain image and two washes over them; none has a Tailwind
     utility to reach for, and each is justified where it sits. */}
 <div className="relative overflow-hidden rounded-[24px] px-5 pt-8 pb-6 text-center bg-surface-night">
 {/* navy→gold radial wash */}
 <span aria-hidden className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(120% 130% at 85% 10%, color-mix(in srgb, var(--brand-color) 30%, transparent), transparent 55%)' }} />
 {/* film grain */}
 <span aria-hidden className="absolute inset-0 pointer-events-none mix-blend-overlay" style={{ backgroundImage: 'var(--grain-url)', opacity: 0.06 }} />

 <div className="relative z-10">
 {/* THE-321 — the same `avatar` as the desktop rail, at the hero's size. The
     hairline ring stays an inline style: it is a plain white at 16% over a
     NAVY WASH, not over a themed surface, and that is what reads as a lit edge
     on the gradient in every palette — there is no token for it to reach for.
     Hardcoding it is what "hardcode no colour" exists to prevent, so it is
     called out here rather than passed off; theming-member-app.test.ts pins
     this file's colour literals WHOLE, so this one is recorded there and every
     other colour on the page stays on a token. */}
 <label htmlFor="profile-pic-upload" className="cursor-pointer inline-block">
 <Avatar
 className="w-[76px] h-[76px] mx-auto mb-3 rounded-full bg-surface-gold"
 style={{ border: '2px solid rgba(255,255,255,0.16)' }}
 >
 <AvatarImage src={profilePic || undefined} alt={userName} className="object-cover" />
 <AvatarFallback className="font-display text-3xl font-light text-wheat-800 bg-surface-gold">{(userName || 'U').charAt(0).toUpperCase()}</AvatarFallback>
 </Avatar>
 </label>
 <h2 className="font-display font-light text-[22px] tracking-[-0.01em] text-white">{userName}</h2>
 {/* Same `badge` as the rail. Its ground stays an inline style for the reason
     the avatar's ring does — it is a wash over the navy hero, not over a
     themed surface — and its ink is the `--wheat-glow` token, not a literal. */}
 <Badge
 className="inline-flex items-center gap-1.5 mt-2.5 h-auto px-3 py-1 rounded-full text-[10.5px] font-bold tracking-wider"
 style={{ background: 'rgba(212,165,74,0.18)', color: 'var(--wheat-glow)' }}
 >
 <BadgeCheck size={12} /> Member since 2026
 </Badge>
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
 {/* THE-321 — the identity rail is `card` + `avatar` + `badge`.
 
     The photo disc was `w-24 h-24 rounded-full overflow-hidden flex items-center
     justify-center` with a conditional `<img>` and an initial fallback beside
     it — `Avatar` / `AvatarImage` / `AvatarFallback` written out longhand, and
     missing what the primitive does on top: AvatarImage swaps to the fallback
     when the image FAILS to load, where the hand-rolled version showed a broken
     image because `profilePic` being a non-empty string was its only test.

     "Member since 2026" was an `inline-flex … rounded-full` pill at the same
     11px, bold — `Badge`, retyped. It keeps `--surface-gold` and
     `text-wheat-800`, which are brand tokens rather than literals, so the chip
     still reads as the app's own and still follows all four palettes.

     ⚠️ "Change photo" STAYS A `<label htmlFor>`, and that is a considered
     rejection of `Button`: this control's entire job is to forward a click to
     the hidden `#profile-pic-upload` input, which a `<label>` does natively and
     a button can only imitate with a ref and a synthetic `.click()`. Rendering
     Button as a label (`render={<label/>}`) would give a non-interactive element
     the focus ring and active-translate of a button while the REAL focus stop
     stays the file input — worse for a keyboard than what is here. */}
 <Card className="bg-surface-raised rounded-3xl border border-line ring-0 py-6 gap-0 px-6 text-center lg:sticky lg:top-4">
 <label htmlFor="profile-pic-upload" className="cursor-pointer group block">
 <Avatar className="w-24 h-24 rounded-full mx-auto mb-3 bg-surface-gold">
 <AvatarImage src={profilePic || undefined} alt={userName} className="object-cover" />
 <AvatarFallback className="text-3xl font-light font-display text-wheat-800 bg-surface-gold">{(userName || 'U').charAt(0).toUpperCase()}</AvatarFallback>
 </Avatar>
 <span className="text-[12px] font-semibold text-gold group-hover:underline">Change photo</span>
 </label>
 <h2 className="text-xl font-light text-strong font-display mt-3 tracking-[-0.01em]">{userName}</h2>
 <Badge className="inline-flex items-center gap-1.5 mt-2 h-auto px-3 py-1 rounded-full text-[11px] font-bold text-wheat-800 bg-surface-gold mx-auto">
 <BadgeCheck size={13} /> Member since 2026
 </Badge>
 </Card>
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
 <Card className="bg-surface-raised rounded-3xl shadow-xs border border-line ring-0 py-0 gap-0 overflow-hidden transition-colors duration-300">
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
 <Separator className="bg-surface-sunken mx-4 w-auto" />
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
 <Separator className="bg-surface-sunken mx-4 w-auto" />
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
 <Separator className="bg-surface-sunken mx-4 w-auto" />
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
 <Separator className="bg-surface-sunken mx-4 w-auto" />
 <SettingItem
 icon={<CalendarCheck size={16} className="text-field-600" />}
 iconBg="bg-field-100"
 label="My Events"
 onClick={() => setShowMyEvents(true)}
 />
 {/* Saved — bookmarked articles, lessons, posts and verses (private to the user). */}
 <Separator className="bg-surface-sunken mx-4 w-auto" />
 <SettingItem
 icon={<Bookmark size={16} className="text-field-600" />}
 iconBg="bg-field-100"
 label="Saved"
 onClick={() => setShowSaved(true)}
 />
 {/* Install app — THE-255. Opens the SAME screen the onboarding install step
     shows (one source: `install/InstallInstructions` over `INSTALL_STEPS`), so
     a member who skipped it during signup can still find it, and the steps can
     never drift apart from the ones onboarding gave them.

     🔴 Hidden entirely inside the Capacitor shell. `server.url` points at this
     origin, so the shell runs this exact code on an ordinary HTTPS origin —
     without this guard the app would offer to install itself to someone who is
     already using the installed app, which reads as a bug. The modal handles
     the remaining states (already installed, a real install prompt, and the
     iOS / Android / desktop instruction sets). */}
 {!inNativeShell && (
 <>
 <Separator className="bg-surface-sunken mx-4 w-auto" />
 <SettingItem
 icon={<Download size={16} className="text-field-600" />}
 iconBg="bg-field-100"
 label="Install app"
 onClick={() => setIsInstallAppOpen(true)}
 />
 </>
 )}
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
 <Separator className="bg-surface-sunken mx-4 w-auto" />
 <div className="flex items-center gap-2 px-4 py-3">
 <PaletteFamilyToggle />
 <ThemeToggle variant="row" />
 </div>
 </Card>
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
 <Card className="bg-surface-raised rounded-3xl shadow-xs border border-line ring-0 py-4 gap-0 overflow-hidden">
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
 {/* THE-321 — both answers are `Button`. "Cancel" was `bg-red-600 text-white`,
     a literal red that paints identically in all four palettes; it is now the
     `destructive` variant on the `--destructive` token. Both keep their exact
     labels, their exact handlers and the disabled state that stops a
     double-submit while the cancellation is in flight. */}
 <div className="flex gap-2">
 <Button
 variant="outline"
 onClick={() => setShowCancelConfirm(false)}
 className="flex-1 h-auto min-h-[44px] sm:min-h-0 sm:h-[40px] py-2 bg-surface-raised text-body rounded-xl font-medium text-sm border-line"
 >
 Keep
 </Button>
 <Button
 variant="destructive"
 onClick={handleCancelPartnership}
 disabled={isCancelingPartnership}
 className="flex-1 h-auto min-h-[44px] sm:min-h-0 sm:h-[40px] py-2 rounded-xl font-bold text-sm"
 >
 {isCancelingPartnership ? 'Canceling...' : 'Cancel'}
 </Button>
 </div>
 </div>
 ) : (
 <Button
 variant="destructive"
 onClick={() => setShowCancelConfirm(true)}
 className="w-full h-auto min-h-[44px] sm:min-h-0 sm:h-[40px] flex items-center justify-between p-3 rounded-xl mt-1 text-sm font-bold"
 >
 <span>Cancel Partnership</span>
 <X size={16} />
 </Button>
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
 {onGoToPartner && (
 <Button
 variant="link"
 onClick={onGoToPartner}
 className="h-auto min-h-[44px] sm:min-h-0 sm:h-auto p-0 text-sm font-bold text-gold no-underline hover:no-underline"
 >
 Give again →
 </Button>
 )}
 </div>
 </div>
 ) : (
 /* THE-321 — "you have nothing here yet, and here is what to do about it" is
    exactly what `empty` states, so the hand-written `text-center py-2` block
    is now the primitive. EmptyDescription carries the sentence, EmptyContent
    the one CTA. `EmptyMedia` is deliberately NOT used: the two other
    partnership states open with a HeartHandshake disc, and an icon here would
    make the empty state the visually loudest of the three — it is the
    quietest. The CTA keeps its exact label and its exact handler, and stays
    gated on `onGoToPartner` for THE-246's reason (see the prop's own note):
    with no Give page to jump to there is no button at all, not a dead one. */
 <Empty className="py-2 gap-0">
 <EmptyHeader className="p-0 gap-0">
 <EmptyDescription className="text-sm text-muted">You don&apos;t have an active partnership</EmptyDescription>
 </EmptyHeader>
 {onGoToPartner && (
 <EmptyContent className="mt-2">
 <Button
 variant="link"
 onClick={onGoToPartner}
 className="h-auto min-h-[44px] sm:min-h-0 sm:h-auto p-0 text-sm font-bold text-gold no-underline hover:no-underline"
 >
 Partner with Us →
 </Button>
 </EmptyContent>
 )}
 </Empty>
 )}
 </Card>
 {/* Donation History — the member's own receipts + giving totals, private to
     them. Placed under Partnership (per the founder), reusing SettingItem/card
     styling. Always shown; the view renders an empty state for non-donors. */}
 <Card className="bg-surface-raised rounded-3xl shadow-xs border border-line ring-0 py-0 gap-0 overflow-hidden mt-3">
 <SettingItem
 icon={<Receipt size={16} className="text-wheat-600" />}
 iconBg="bg-wheat-100"
 label="Donation History"
 onClick={() => setShowDonationHistory(true)}
 />
 </Card>
 </div>
 )}

 {/* Support & Info */}
 <div>
 <h4 className="text-[10px] font-bold text-faint tracking-wider uppercase mb-3 ml-2">Support & Info</h4>
 <Card className="bg-surface-raised rounded-3xl shadow-xs border border-line ring-0 py-0 gap-0 overflow-hidden transition-colors duration-300">
 <SettingItem 
 icon={<HelpCircle size={16} className="text-wheat-600" />} 
 iconBg="bg-wheat-100" 
 label="Contact Us"
 onClick={() => setIsContactOpen(true)}
 />
 <Separator className="bg-surface-sunken mx-4 w-auto" />
 <SettingItem
 icon={<FileQuestion size={16} className="text-field-600" />}
 iconBg="bg-field-100" 
 label="FAQ" 
 onClick={() => setIsFAQOpen(true)}
 />
 <Separator className="bg-surface-sunken mx-4 w-auto" />
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
 </Card>
 </div>

 {/* Log Out Button */}
 {/* THE-321 — `Button`, destructive variant. It was `bg-red-50 hover:bg-red-100
     text-red-500`: three literal reds that do not move with the palette, on the
     one control on this page that ends the session. The variant puts all three
     on `--destructive` and brings the focus ring with it — the old button had
     none at all. Same handler, same label, same icon. */}
 <Button
 variant="destructive"
 onClick={handleLogout}
 className="w-full h-auto min-h-[44px] font-bold py-3.5 px-4 rounded-2xl gap-2 mt-4 text-sm"
 >
 <LogOut size={18} />
 Log Out
 </Button>

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
 <InstallAppModal
 isOpen={isInstallAppOpen}
 onClose={() => setIsInstallAppOpen(false)}
 />
 <ChurchDetailsModal
 isOpen={isChurchDetailsOpen}
 onClose={() => setIsChurchDetailsOpen(false)}
 churchId={homeChurchId}
 isHomeChurch={true}
 onRemoveHomeChurch={handleRemoveHomeChurch}
 fullPage={true}
 />

 {/* THE-321 — the No Home Church modal is `dialog`.

     It was a hand-rolled `fixed inset-0 bg-black/50 z-50` scrim wrapping a
     panel: the primitive written longhand and missing everything it carries —
     no focus trap, no restore-focus on close, no Escape handler, no
     `aria-modal`, no labelled title, and nothing stopping a screen reader
     walking straight into the page behind it. Its heading and its paragraph
     were a bare `<h3>` and `<p>`, so the dialog had no accessible NAME at all;
     they are DialogTitle and DialogDescription now, which is what gives it one.

     🔴 IT ALSO RISES ABOVE z-100. The old scrim was `z-50` — UNDER the member
     shell's own layers — and the primitive's `z-[101]` scrim / `z-[102]` panel
     is PR 437's floor, so this dialog now opens above everything it must.

     Both answers keep their exact labels and their exact handlers; "Add Church"
     still closes the dialog before navigating, in that order. */}
 <Dialog open={isNoHomeChurchModalOpen} onOpenChange={setIsNoHomeChurchModalOpen}>
 <DialogContent className="bg-surface-raised rounded-2xl w-full max-w-sm p-6 text-center gap-0">
 <DialogHeader className="items-center gap-0">
 <div className="w-16 h-16 bg-surface-sunken rounded-full flex items-center justify-center mx-auto mb-4">
 <Church size={32} className="text-faint" />
 </div>
 <DialogTitle className="text-xl font-bold text-strong mb-2 font-display">No Home Church</DialogTitle>
 <DialogDescription className="text-muted mb-6 text-sm">
 You have no churches selected. Add a church to stay connected with your local community.
 </DialogDescription>
 </DialogHeader>
 <DialogFooter className="flex flex-col gap-3 sm:flex-col">
 <Button
 onClick={() => {
 setIsNoHomeChurchModalOpen(false);
 onGoToMap();
 }}
 className="w-full h-auto min-h-[44px] py-3 bg-gold text-white font-bold rounded-xl hover:bg-[color-mix(in_srgb,var(--brand-color)_85%,black)] transition-colors"
 >
 Add Church
 </Button>
 <DialogClose
 render={
 <Button
 variant="secondary"
 className="w-full h-auto min-h-[44px] py-3 bg-surface-sunken text-body font-bold rounded-xl hover:bg-surface-chip transition-colors"
 >
 Cancel
 </Button>
 }
 />
 </DialogFooter>
 </DialogContent>
 </Dialog>

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

/**
 * THE-321 — one settings row, composed rather than retyped.
 *
 * 🔴 `Item` IS THIS ROW. The hand-written version was `w-full flex items-center
 * justify-between` wrapping an icon disc, a label and a chevron — which is
 * `Item` + `ItemMedia` + `ItemContent`/`ItemTitle` + `ItemActions` written out
 * longhand, minus the `role="list"`/`listitem` semantics and the focus ring the
 * primitive carries. `render={<button …/>}` keeps the row a real BUTTON, which
 * is what `Profile.composition`'s row-order assertion selects on and what makes
 * the whole row (not just its label) the tap target.
 *
 * The numeric badge is `Badge`, not a hand-rolled pill: the old
 * `min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white` re-spelled
 * the primitive AND hardcoded a literal red. `variant="destructive"` puts it on
 * the `--destructive` token every other alarm state on this screen already uses,
 * so it follows all four palettes instead of painting one colour in each.
 *
 * ⚠️ THE 44px FLOOR IS ON THE ROW, and it is `min-h-[44px] sm:min-h-0`, not a
 * height: a row whose label wraps must be allowed to grow past 44px, and a
 * fixed height would clip it. Above `sm` the row hands back to its own content
 * height — Rule 4's 38/40px band governs CONTROLS, and a settings row is not a
 * control, so nothing here raises `DESKTOP_CONTROL_MAX_PX`.
 *
 * 🔴 AN EXPLICIT 44px, NOT THE SCALE CLASS `min-h-11` — measured, not
 * stylistic. `min-h-11` compiles to `calc(var(--spacing) * 11)`, which resolved
 * to 7.63px on these controls in Chromium: a class whose NAME claims 44px and
 * whose computed height is a sixth of it, with no error and no warning. That is
 * the silent-token failure ds-primitives.test.tsx exists for. RichTextToolbar
 * records the same trap — "4.125px under the touch minimum its name claims" —
 * and reaches for the same explicit spelling, which is this repo's idiom for
 * the floor; THE-304 and AdminMinistry spell it the same way. No width is
 * invented here: 44px is the floor the ticket sets.
 */
const SettingItem = ({ icon, iconBg, label, onClick, badge }: { icon: React.ReactNode, iconBg: string, label: string, onClick?: () => void, badge?: number }) => (
 <Item
   render={<button type="button" onClick={onClick} />}
   className="w-full min-h-[44px] sm:min-h-0 rounded-none border-transparent p-3.5 gap-3 hover:bg-surface-sunken transition-colors"
 >
 <ItemMedia className={`w-7 h-7 rounded-full ${iconBg}`}>
 {icon}
 </ItemMedia>
 <ItemContent className="flex-1 text-left">
 <ItemTitle className="text-[13px] font-medium text-body">{label}</ItemTitle>
 </ItemContent>
 <ItemActions className="gap-2">
 {badge !== undefined && badge > 0 && (
 <Badge variant="destructive" className="min-w-[18px] h-[18px] px-1 text-[10px] font-bold">
 {badge > 99 ? '99+' : badge}
 </Badge>
 )}
 <ChevronRight size={16} className="text-faint" />
 </ItemActions>
 </Item>
);

/**
 * THE-321 — the Push Notifications row: `Item` for the row, `Switch` for the
 * control.
 *
 * 🔴 THE HAND-ROLLED SWITCH WAS THIS FILE'S LAST INLINE STYLE, and both of its
 * inline styles were defects rather than decoration. The track painted
 * `var(--brand-color, …)` with a LITERAL HEX FALLBACK, which is one colour
 * for all four palettes the moment the variable is missing — and the thumb
 * moved by `transform: translateX(21px)`, a magic offset derived from nothing
 * and silently wrong the instant the track's width changed. `Switch` carries
 * both on tokens: `data-checked:bg-primary` follows the palette, and the thumb
 * travels `calc(100%-2px)` off its own measured width. This component now holds
 * ZERO inline styles.
 *
 * ⚠️ `role="switch"` and `aria-label` SURVIVE, because Base UI's Switch.Root
 * renders a real `<button role="switch">` and forwards `aria-label` — which is
 * exactly what `Profile.composition`'s row-order assertion selects on
 * (`button,[role="switch"]`) and reads for its name. Swapping the hand-rolled
 * button for the primitive is invisible to that guard, and deliberately so.
 *
 * ⚠️ THE 44px TAP FLOOR IS THE SWITCH'S, NOT THE ROW'S. The row is not tappable
 * here — only the control is — so a `min-h-[44px]` on the row would be a lie about
 * where a tap lands. `Switch` already extends its own hit area with an
 * `after:` pseudo-element (`after:-inset-x-3 after:-inset-y-2`); below `sm`
 * that is widened to clear 44px in both axes and handed back above it, so the
 * PAINTED pill keeps the primitive's own dimensions at every width and only the
 * INVISIBLE target grows. Measured, not assumed — see THE-321's tap-target
 * suite, which reads the pseudo-element's box out of Chromium.
 */
const ToggleSettingItem = ({ icon, iconBg, label, sublabel, checked, onChange }: { icon: React.ReactNode, iconBg: string, label: string, sublabel?: string, checked: boolean, onChange: () => void }) => (
 <Item className="w-full rounded-none border-transparent p-3.5 gap-3">
 <ItemMedia className={`w-7 h-7 rounded-full shrink-0 ${iconBg}`}>
 {icon}
 </ItemMedia>
 <ItemContent className="min-w-0 flex-1">
 <ItemTitle className="block text-[13px] font-medium text-body">{label}</ItemTitle>
 {sublabel && (
 <span className="block text-[11px] text-faint truncate">{sublabel}</span>
 )}
 </ItemContent>
 <ItemActions>
 <Switch
 aria-label={label}
 checked={checked}
 onCheckedChange={onChange}
 className="after:-inset-x-3 after:-inset-y-[13px] sm:after:-inset-y-2"
 />
 </ItemActions>
 </Item>
);

export default Profile;
