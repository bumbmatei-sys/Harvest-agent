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
  Bookmark
} from 'lucide-react';
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
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { SUPER_ADMIN_EMAIL, isSuperAdmin as checkIsSuperAdmin, getTenantScope } from '../utils/tenant-scope';
import { isSuperAdminEmail } from '../utils/super-admins';
import { getPlanFeatures } from '../utils/plan-features';
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
  const [showMyEvents, setShowMyEvents] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
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
 <div className="flex flex-col min-h-full bg-cream lg:bg-transparent transition-colors duration-300">
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
 <span className="font-display text-3xl font-light" style={{ color: 'var(--wheat-700)' }}>{(userName || 'U').charAt(0).toUpperCase()}</span>
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

 {/* Content Section — centered desktop column at the brand's wide container
     (1280px) so it fills wide monitors instead of floating narrow. */}
 <div className="px-4 mt-6 relative z-10 space-y-6 lg:mt-0 lg:px-8 lg:pt-6 lg:max-w-[1280px] lg:mx-auto lg:grid lg:grid-cols-[320px_1fr] lg:gap-8 lg:items-start lg:space-y-0">
 {/* Desktop profile card — left column */}
 <div className="hidden lg:block">
 <div className="bg-white rounded-3xl border p-6 text-center lg:sticky lg:top-4" style={{ borderColor: 'var(--ds-border)' }}>
 <label htmlFor="profile-pic-upload" className="cursor-pointer group block">
 <div className="w-24 h-24 rounded-full mx-auto mb-3 overflow-hidden flex items-center justify-center" style={{ background: 'var(--surface-gold)' }}>
 {profilePic ? (
 <img src={profilePic} alt={userName} className="w-full h-full object-cover" />
 ) : (
 <span className="text-3xl font-light font-display" style={{ color: 'var(--wheat-700)' }}>{(userName || 'U').charAt(0).toUpperCase()}</span>
 )}
 </div>
 <span className="text-[12px] font-semibold group-hover:underline" style={{ color: 'var(--brand-color, #C9963A)' }}>Change photo</span>
 </label>
 <h2 className="text-xl font-light text-earth font-display mt-3 tracking-[-0.01em]">{userName}</h2>
 <div className="inline-flex items-center gap-1.5 mt-2 px-3 py-1 rounded-full text-[11px] font-bold" style={{ background: 'var(--surface-gold)', color: 'var(--wheat-700)' }}>
 <BadgeCheck size={13} /> Member since 2026
 </div>
 </div>
 </div>

 {/* Settings — right column */}
 <div className="space-y-6">

 {/* Account Settings */}
 <div>
 <h4 className="text-[10px] font-bold text-[color:var(--text-faint)] tracking-wider uppercase mb-3 ml-2">Account Settings</h4>
 <div className="bg-white rounded-3xl shadow-sm border border-stone-200 overflow-hidden transition-colors duration-300">
 {isAdmin && (
 <>
 <SettingItem 
 icon={<ShieldCheck size={16} className="text-red-500" />} 
 iconBg="bg-red-50" 
 label="Admin Dashboard" 
 onClick={() => onNavigate('admin')}
 />
 <div className="h-px bg-stone-100 mx-4"></div>
 </>
 )}
 <SettingItem 
 icon={<User size={16} className="text-sky-600" />} 
 iconBg="bg-sky-100" 
 label="Personal Information" 
 onClick={() => setIsPersonalInfoOpen(true)}
 />
 {hasChurches && (
 <>
 <div className="h-px bg-stone-100 mx-4"></div>
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
 <div className="h-px bg-stone-100 mx-4"></div>
 <SettingItem
 icon={<HeartHandshake size={16} className="text-wheat-600" />}
 iconBg="bg-wheat-100"
 label="Partner with Us"
 onClick={onGoToPartner}
 />
 <div className="h-px bg-stone-100 mx-4"></div>
 <ToggleSettingItem
 icon={<Bell size={16} className="text-sky-600" />}
 iconBg="bg-sky-100"
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
 {tenantPlan && (
 <>
 <div className="h-px bg-stone-100 mx-4"></div>
 <SettingItem
 icon={<CalendarCheck size={16} className="text-wheat-600" />}
 iconBg="bg-wheat-100"
 label="My Events"
 onClick={() => setShowMyEvents(true)}
 />
 </>
 )}
 {/* Saved — bookmarked articles, lessons, posts and verses (private to the user). */}
 <div className="h-px bg-stone-100 mx-4"></div>
 <SettingItem
 icon={<Bookmark size={16} className="text-wheat-600" />}
 iconBg="bg-wheat-100"
 label="Saved"
 onClick={() => setShowSaved(true)}
 />
 </div>
 </div>

 {/* Partnership */}
 <div>
 <h4 className="text-[10px] font-bold text-[color:var(--text-faint)] tracking-wider uppercase mb-3 ml-2">Partnership</h4>
 <div className="bg-white rounded-3xl shadow-sm border border-stone-200 overflow-hidden p-4">
 {donationSubscriptionId ? (
 <div>
 <div className="flex items-center gap-3 mb-3">
 <div className="w-7 h-7 rounded-full flex items-center justify-center bg-wheat-100">
 <HeartHandshake size={16} className="text-wheat-600" />
 </div>
 <div>
 <p className="text-sm font-bold text-earth">
 {/* donationAmount is stored in DOLLARS (BUG 2) — display it directly. */}
 ${donationAmount ? donationAmount.toFixed(0) : '—'} / month
 </p>
 {donationChurchName && (
 <p className="text-xs text-warm-brown">{donationChurchName}</p>
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
 className="flex-1 py-2 bg-white text-[color:var(--text-body)] rounded-xl font-medium text-sm border border-stone-200"
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
 <p className="text-sm font-bold text-earth">Donor</p>
 {/* totalDonated is stored in DOLLARS (BUG 2) — display it directly. */}
 <p className="text-xs text-warm-brown">${totalDonated.toFixed(0)} given</p>
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
 <p className="text-sm text-warm-brown">You don&apos;t have an active partnership</p>
 <button
 onClick={onGoToPartner}
 className="mt-2 text-sm font-bold text-gold"
 >
 Partner with Us →
 </button>
 </div>
 )}
 </div>
 </div>

 {/* Support & Info */}
 <div>
 <h4 className="text-[10px] font-bold text-[color:var(--text-faint)] tracking-wider uppercase mb-3 ml-2">Support & Info</h4>
 <div className="bg-white rounded-3xl shadow-sm border border-stone-200 overflow-hidden transition-colors duration-300">
 <SettingItem 
 icon={<HelpCircle size={16} className="text-wheat-600" />} 
 iconBg="bg-wheat-100" 
 label="Contact Us"
 onClick={() => setIsContactOpen(true)}
 />
 <div className="h-px bg-stone-100 mx-4"></div>
 <SettingItem
 icon={<FileQuestion size={16} className="text-field-600" />}
 iconBg="bg-field-100" 
 label="FAQ" 
 onClick={() => setIsFAQOpen(true)}
 />
 <div className="h-px bg-stone-100 mx-4"></div>
 <SettingItem 
 icon={<ShieldCheck size={16} className="text-sky-600" />} 
 iconBg="bg-sky-100" 
 label="Privacy & Terms" 
 onClick={() => setIsPrivacyTermsOpen(true)}
 />
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

 <PersonalInformationModal
 isOpen={isPersonalInfoOpen}
 onClose={() => setIsPersonalInfoOpen(false)}
 />
 <ContactModal
 isOpen={isContactOpen}
 onClose={() => setIsContactOpen(false)}
 />
 <PrivacyTermsModal
 isOpen={isPrivacyTermsOpen}
 onClose={() => setIsPrivacyTermsOpen(false)}
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
 <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-xl animate-fadeUp">
 <div className="p-6 text-center">
 <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-4">
 <Church size={32} className="text-[color:var(--text-faint)]" />
 </div>
 <h3 className="text-xl font-bold text-earth mb-2 font-display">No Home Church</h3>
 <p className="text-warm-brown mb-6 text-sm">
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
 className="w-full py-3 bg-stone-100 text-[color:var(--text-body)] font-bold rounded-xl hover:bg-stone-200 transition-colors"
 >
 Cancel
 </button>
 </div>
 </div>
 </div>
 </div>
 )}

 {showMyEvents && (
 <div className="fixed inset-0 z-[300] bg-[#F7F6F3]">
 <UserEvents onBack={() => setShowMyEvents(false)} />
 </div>
 )}

 {showSaved && (
 <div className="fixed inset-0 z-[300] bg-[#F7F6F3]">
 <SavedItems
 onBack={() => setShowSaved(false)}
 onOpenBlog={(id) => { setShowSaved(false); onOpenSavedBlog?.(id); }}
 onOpenLesson={(courseId, lessonId) => { setShowSaved(false); onOpenSavedLesson?.(courseId, lessonId); }}
 onOpenPost={(id) => { setShowSaved(false); onOpenSavedPost?.(id); }}
 />
 </div>
 )}
 </div>
 );
};

const SettingItem = ({ icon, iconBg, label, onClick, badge }: { icon: React.ReactNode, iconBg: string, label: string, onClick?: () => void, badge?: number }) => (
 <button onClick={onClick} className="w-full flex items-center justify-between p-3.5 hover:bg-stone-100 transition-colors">
 <div className="flex items-center gap-3">
 <div className={`w-7 h-7 rounded-full flex items-center justify-center ${iconBg}`}>
 {icon}
 </div>
 <span className="text-[13px] font-medium text-[color:var(--text-body)]">{label}</span>
 </div>
 <div className="flex items-center gap-2">
 {badge !== undefined && badge > 0 && (
 <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
 {badge > 99 ? '99+' : badge}
 </span>
 )}
 <ChevronRight size={16} className="text-[color:var(--text-faint)]" />
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
 <span className="block text-[13px] font-medium text-[color:var(--text-body)]">{label}</span>
 {sublabel && (
 <span className="block text-[11px] text-[color:var(--text-faint)] truncate">{sublabel}</span>
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
 style={{ background: checked ? 'var(--brand-color, #C9963A)' : '#D6CCBE' }}
 >
 <span
 className="inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform"
 style={{ transform: checked ? 'translateX(21px)' : 'translateX(2px)' }}
 />
 </button>
 </div>
);

export default Profile;
