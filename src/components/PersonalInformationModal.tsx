"use client";
import React, { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { X, Edit2, ChevronRight, ArrowLeft } from 'lucide-react';
import { auth, db } from '../firebase';
import { updateProfile, updatePassword, signOut, EmailAuthProvider, reauthenticateWithCredential, sendPasswordResetEmail } from 'firebase/auth';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import CountrySelect from './CountrySelect';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { authFetch } from '../utils/auth-fetch';
import { FIELD_WIDTH, CONTROL_DENSITY } from './layout/form-layout';
import { DELETE_CONFIRM_COPY, UNREACHABLE_NOTE } from '../lib/member-erasure-copy';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface PersonalInformationModalProps {
 isOpen: boolean;
 onClose: () => void;
}

type PasswordFlowState = 'idle' | 'current' | 'new' | 'forgot';

/**
 * Where the Delete Account flow is. Every non-'idle' state renders a message —
 * that is the whole point of the type existing: the flow used to have no state
 * at all, so a failure had nowhere to be shown and went to the console.
 *
 *  'deleting' — in flight, buttons disabled
 *  'reauth'   — Firebase wants a recent sign-in; asking for the password here
 *  'error'    — it failed, and the member is told why
 *  'done'     — it worked; confirmed before the sign-out redirect lands
 */
type DeleteFlowState = 'idle' | 'deleting' | 'reauth' | 'error' | 'done';

/**
 * Where the Save-my-details flow is.
 *
 * 🔴 THIS IS THE SAME DEFECT THE DELETE FLOW WAS FIXED FOR, on the button
 * beside it. `handleSave` had one boolean — `isSaving` — and no way to say
 * "it failed". Both of its failure branches ended in `console.error` (the
 * outer one) or a bare `return` after `handleFirestoreError` (the inner,
 * Firestore one), so a member edited their name, city, phone or country,
 * tapped Save, the write was refused, and the screen did not move: the modal
 * stayed open with the typed values still in it and nothing said why. That
 * reads as "still editing", which is indistinguishable from "saved and the
 * modal is slow" and from "nothing happened". `AGENTS.md:6` names the class:
 * a default that hides an error converts a loud failure into a quiet lie.
 *
 *  'saving' — in flight, both Save buttons disabled
 *  'error'  — it failed, the edit is STILL IN THE FORM, and the member is told
 *  'idle'   — resting, or saved (the modal closes on success)
 */
type SaveFlowState = 'idle' | 'saving' | 'error';

const PersonalInformationModal: React.FC<PersonalInformationModalProps> = ({ isOpen, onClose }) => {
 const [name, setName] = useState(auth.currentUser?.displayName || '');
 const [email, setEmail] = useState(auth.currentUser?.email || '');
 const [country, setCountry] = useState('');
 const [city, setCity] = useState('');
 const [phone, setPhone] = useState('');
  const [acceptedJesus, setAcceptedJesus] = useState('');
 const [profilePic, setProfilePic] = useState<string | null>(auth.currentUser?.photoURL || null);
 // Save outcome. Every branch of handleSave lands on one of these; 'error'
 // renders `saveMessage` and KEEPS THE TYPED VALUES, so a failed save never
 // discards the edit it failed to write.
 const [saveState, setSaveState] = useState<SaveFlowState>('idle');
 const [saveMessage, setSaveMessage] = useState('');
 const isSaving = saveState === 'saving';
 
 // Password Flow State
 const [passwordFlowState, setPasswordFlowState] = useState<PasswordFlowState>('idle');
 const [currentPassword, setCurrentPassword] = useState('');
 const [newPassword, setNewPassword] = useState('');
 const [confirmNewPassword, setConfirmNewPassword] = useState('');
 const [passwordMessage, setPasswordMessage] = useState('');
 const [isPasswordLoading, setIsPasswordLoading] = useState(false);
 const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

 // Delete Account outcome. Every branch of handleDeleteAccount lands on one of
 // these and renders `deleteMessage`; 'idle' is the only state that shows none.
 const [deleteState, setDeleteState] = useState<DeleteFlowState>('idle');
 const [deleteMessage, setDeleteMessage] = useState('');
 const [deletePassword, setDeletePassword] = useState('');

 // Download-my-data outcome (THE-188). Same three-state shape as the delete
 // flow above and for the same reason: a right that fails silently is not a
 // right. 'working' disables the button, 'error' renders why.
 const [exportState, setExportState] = useState<'idle' | 'working' | 'error'>('idle');
 const [exportMessage, setExportMessage] = useState('');

 // Cancel Partnership state
 const [hasActivePartnership, setHasActivePartnership] = useState(false);
 const [showCancelPartnershipConfirm, setShowCancelPartnershipConfirm] = useState(false);
 const [isCancelingPartnership, setIsCancelingPartnership] = useState(false);
 const [cancelPartnershipMsg, setCancelPartnershipMsg] = useState('');
 
 const fileInputRef = useRef<HTMLInputElement>(null);

 // Check if user signed in with email/password
 const isEmailAuth = auth.currentUser?.providerData.some(
 (provider) => provider.providerId === 'password'
 );

 useEffect(() => {
 if (isOpen) {
 setName(auth.currentUser?.displayName || '');
 setEmail(auth.currentUser?.email || '');
 resetPasswordFlow();
 fetchUserData();
 }
 }, [isOpen]);

 const fetchUserData = async () => {
   if (auth.currentUser) {
     try {
       const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
       if (userDoc.exists()) {
         const data = userDoc.data();
         if (data.displayName) setName(data.displayName);
         if (data.country) setCountry(data.country);
         if (data.city) setCity(data.city);
         if (data.phone) setPhone(data.phone);
         if (data.acceptedJesus !== undefined) setAcceptedJesus(data.acceptedJesus ? 'yes' : 'no');
         if (data.photoURL) setProfilePic(data.photoURL);
         setHasActivePartnership(!!data.donationSubscriptionId);
       }
     } catch (error) {
       handleFirestoreError(error, OperationType.GET, `users/${auth.currentUser.uid}`);
     }
   }
 };

 const handleCancelPartnership = async () => {
   if (!auth.currentUser) return;
   setIsCancelingPartnership(true);
   setCancelPartnershipMsg('');
   try {
     const res = await authFetch('/api/stripe/cancel-partnership', {
       method: 'POST',
       body: JSON.stringify({ userId: auth.currentUser.uid }),
     });
     const data = await res.json();
     if (res.ok) {
       setHasActivePartnership(false);
       setShowCancelPartnershipConfirm(false);
       setCancelPartnershipMsg('Partnership canceled successfully.');
     } else {
       setCancelPartnershipMsg(data.error || 'Failed to cancel partnership.');
     }
   } catch {
     setCancelPartnershipMsg('Something went wrong. Please try again.');
   } finally {
     setIsCancelingPartnership(false);
   }
 };

 const resetPasswordFlow = () => {
 setPasswordFlowState('idle');
 setCurrentPassword('');
 setNewPassword('');
 setConfirmNewPassword('');
 setPasswordMessage('');
 setIsPasswordLoading(false);
 };

 if (!isOpen) return null;

 /**
  * Save the member's details, and SAY WHAT HAPPENED.
  *
  * 🔴 THIS USED TO BE THE SILENT FAILURE, and it was the same one the delete
  * flow below was fixed for — on the button immediately beside it. There were
  * two failure branches and neither reached the screen:
  *
  *   · the Firestore write — `handleFirestoreError(...)` then a bare `return`.
  *     `handleFirestoreError` logs and does not throw, so the handler simply
  *     stopped: no close, no message, no change of any kind.
  *   · everything else — `catch { console.error('Error updating profile:');
  *     console.error('Failed to update profile.'); }`, with the second line
  *     commented "we use a custom modal or just console error since alert is
  *     blocked in iframe". There was no custom modal. There was only console.
  *
  * Both now land in `saveState: 'error'` and render `saveMessage`, exactly as
  * every branch of `handleDeleteAccount` lands on a rendered `deleteMessage`.
  *
  * 🔴 THE EDIT IS NEVER DISCARDED. `name`, `country`, `city`, `phone` and
  * `acceptedJesus` are left exactly as typed and the modal stays open, so the
  * member can retry without re-entering anything. Closing on failure, or
  * clearing the form, would lose work the app failed to write.
  *
  * ⚠️ THE TWO WRITES ARE SEPARATED because they fail for different reasons and
  * only one of them is the profile document. `updateProfile` writes the Auth
  * display name; `updateDoc` writes the user document. If the Auth write fails
  * the document write is not attempted — reporting "saved" for half of it is
  * the failure mode the delete route's own docblock exists to prevent.
  *
  * ⚠️ `country` is written THROUGH, untouched, and is not defaulted. This file
  * is one of the two writers of that field and PR 429's invariant —
  * `withCountry + countryUnrecorded === total` — depends on there being no
  * third state: no `''` substituted for a missing value, no `'Unknown'`, no
  * sentinel. An unset country stays the empty string the state already holds
  * and is counted as unrecorded, which is what the invariant reads.
  */
 const handleSave = async () => {
 if (!auth.currentUser) {
 setSaveState('error');
 setSaveMessage('You are not signed in. Sign in again and retry.');
 return;
 }

 setSaveState('saving');
 setSaveMessage('');

 try {
 await updateProfile(auth.currentUser, {
 displayName: name
 });
 } catch (error) {
 console.error('Error updating profile:', error);
 setSaveState('error');
 setSaveMessage('Your name could not be saved to your sign-in. Nothing was changed — please try again.');
 return;
 }

 const userRef = doc(db, 'users', auth.currentUser.uid);
 try {
 await updateDoc(userRef, {
 displayName: name,
 country,
        city,
        phone,
        acceptedJesus: acceptedJesus === 'yes'
      });
 } catch (err) {
 handleFirestoreError(err, OperationType.UPDATE, `users/${auth.currentUser.uid}`);
 setSaveState('error');
 setSaveMessage('Your details could not be saved. Your changes are still here — check your connection and try again.');
 return;
 }

 setSaveState('idle');
 onClose();
 };

 const handlePhotoClick = () => {
 fileInputRef.current?.click();
 };

 const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
 const file = e.target.files?.[0];
 if (file && auth.currentUser) {
 const reader = new FileReader();
 reader.onloadend = async () => {
 // Create an image element to resize the image
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
 
 // Compress to JPEG with 0.7 quality
 const base64String = canvas.toDataURL('image/jpeg', 0.7);
 
 setProfilePic(base64String);
 try {
 const uid = auth.currentUser?.uid;
 if (!uid) return;
 const userRef = doc(db, 'users', uid);
 await updateDoc(userRef, { photoURL: base64String });
 try {
 if (auth.currentUser) {
 await updateProfile(auth.currentUser, { photoURL: base64String });
 }
 } catch (e) {
 console.warn("Could not update auth profile photoURL, but saved to Firestore", e);
 }
 } catch (error) {
 handleFirestoreError(error, OperationType.UPDATE, `users/${auth.currentUser?.uid}`);
 }
 };
 img.src = reader.result as string;
 };
 reader.readAsDataURL(file);
 }
 };

 /**
  * Delete the account, and SAY WHAT HAPPENED.
  *
  * 🔴 This used to be the silent failure. Firebase rejects `deleteUser` with
  * 'auth/requires-recent-login' on any session older than roughly five
  * minutes; the old code caught that and wrote two `console.error` lines. The
  * member tapped Delete and the screen did not move — no message, no spinner,
  * no error. They could not tell whether the account was deleted, whether it
  * failed, or whether the tap had registered at all. On a destructive,
  * irreversible action that is the worst place in the app to be silent, so
  * every outcome below ends in something rendered.
  *
  * The stale-session case is now re-authenticated IN PLACE rather than being
  * turned into "sign out and sign back in": a password-account holder is asked
  * for their password right here, in the confirm panel, using the same
  * `reauthenticateWithCredential` call the change-password flow already makes.
  * Federated accounts (Google) cannot do that without a sign-in popup, which
  * would be a new flow rather than a fix — they get the explicit instruction
  * instead.
  *
  * ⚠️ BOTH DELETIONS NOW HAPPEN ON THE SERVER, IN ORDER — see
  * src/app/api/account/delete/route.ts. They used to happen here, and the
  * first one never worked: firestore.rules gives `match /users/{userId}`
  * `allow delete: if isSuperAdmin()`, so a member's own `deleteDoc` was denied
  * every time, `handleFirestoreError` logged it without throwing, and
  * `deleteUser` then succeeded — DESTROYING THE SIGN-IN AND LEAVING THE
  * PROFILE BEHIND, unreachable by anyone but a super admin. The Admin SDK
  * bypasses rules, so the route can delete the document, verify it is gone,
  * and only then delete the Auth user; a failure at either step comes back as
  * a non-2xx naming the step, and is rendered below. There is no longer any
  * path through this handler that removes one half and reports success.
  */
/**
  * THE-188 — DOWNLOAD EVERYTHING THIS APP HOLDS ABOUT ME.
  *
  * 🔴 THE HALF THAT WAS MISSING. Deletion shipped first and shipped alone: a
  * member could erase themselves across 25 collections and had no way to take a
  * copy first. This is the GDPR Art. 15/20 counterpart, and it sits in this
  * panel deliberately — beside the delete button, because that is where a member
  * is standing when it matters most.
  *
  * The file is built and named HERE rather than served as an attachment: the
  * response is an authenticated `authFetch` with a bearer token, so it cannot be
  * a plain link the browser navigates to.
  *
  * ⚠️ A PARTIAL EXPORT COMES BACK NON-2XX AND STILL CARRIES ITS ROWS. The route
  * refuses to dress a half-read file as a whole one, so a `status: 'partial'`
  * body is downloaded AND the failure is rendered — losing twenty-four sections
  * because one failed would serve nobody.
  */
 const handleExportData = async () => {
 if (!auth.currentUser) {
 setExportState('error');
 setExportMessage('You are not signed in. Sign in again and retry.');
 return;
 }

 setExportState('working');
 setExportMessage('');

 const uid = auth.currentUser.uid;

 let res: Response;
 let data: { format?: string; status?: string; error?: string; code?: string };
 try {
 // Same reason as the delete flow: the route wants an `auth_time` inside
 // five minutes and the cached ID token can be an hour old.
 await auth.currentUser.getIdToken(true);
 res = await authFetch('/api/account/export', {
 method: 'POST',
 body: JSON.stringify({ userId: uid }),
 });
 data = await res.json().catch(() => ({}));
 } catch (error: unknown) {
 console.error('Error exporting data:', error);
 setExportState('error');
 setExportMessage('Could not reach the server. Check your connection and try again.');
 return;
 }

 if (data?.format === 'harvest.member-export') {
 const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
 const url = URL.createObjectURL(blob);
 const link = document.createElement('a');
 link.href = url;
 link.download = `harvest-my-data-${new Date().toISOString().slice(0, 10)}.json`;
 link.click();
 URL.revokeObjectURL(url);
 }

 if (res.ok) {
 setExportState('idle');
 setExportMessage('Your data has been downloaded.');
 return;
 }

 if (data?.code === 'auth/requires-recent-login') {
 setExportState('error');
 setExportMessage(
 'For your security, this needs a recent sign-in. Sign out, sign back in, and download within a few minutes.',
 );
 return;
 }

 setExportState('error');
 setExportMessage(
 data?.status === 'partial'
 ? 'Part of your data could not be read, so the file you just downloaded is incomplete — it names what is missing. Please try again.'
 : data?.error || 'Your data could not be exported. Please try again.',
 );
 };

  const handleDeleteAccount = async () => {
 if (!auth.currentUser) {
 setDeleteState('error');
 setDeleteMessage('You are not signed in. Sign in again and retry.');
 return;
 }

 setDeleteState('deleting');
 setDeleteMessage('');

 const uid = auth.currentUser.uid;

 let res: Response;
 let data: {
 error?: string;
 code?: string;
 step?: string;
 documentDeleted?: boolean;
 authDeleted?: boolean;
 };
 try {
 // Force a token refresh first. The route requires a RECENT sign-in
 // (`auth_time` within five minutes), and the cached ID token can be up to
 // an hour old — so after `reauthenticateWithCredential` the retry would
 // otherwise present the same stale `auth_time` and be rejected again,
 // looping the member through the password panel forever.
 await auth.currentUser.getIdToken(true);
 res = await authFetch('/api/account/delete', {
 method: 'POST',
 body: JSON.stringify({ userId: uid }),
 });
 data = await res.json().catch(() => ({}));
 } catch (error: unknown) {
 console.error('Error deleting account:', error);
 setDeleteState('error');
 setDeleteMessage('Could not reach the server. Check your connection and try again.');
 return;
 }

 if (res.ok) {
 // Confirm BEFORE the sign-out lands: the sign-out redirect follows from
 // onAuthStateChanged upstream, so this success panel is what the member
 // sees the action end in rather than being dropped on the login screen
 // with no idea whether it worked. The server has already deleted the Auth
 // user, so the local session is signed out here rather than by Firebase.
 setDeleteState('done');
 setDeleteMessage('Your account and sign-in have been deleted. Signing you out now.');
 signOut(auth).catch((err) => console.error('Error signing out after delete:', err));
 return;
 }

 if (data.code === 'auth/requires-recent-login') {
 if (isEmailAuth) {
 setDeleteState('reauth');
 setDeleteMessage('For your security, confirm your password to finish deleting your account.');
 } else {
 setDeleteState('error');
 setDeleteMessage(
 'For your security, this needs a recent sign-in. Sign out, sign back in, and delete your account within a few minutes.',
 );
 }
 return;
 }

 // Every remaining outcome is a real failure and says which half it stopped
 // at. `step: 'auth'` is the only one where anything was removed, and it must
 // never read as success — the member still has a working sign-in.
 setDeleteState('error');
 setDeleteMessage(
 data.error ||
 'Your account could not be deleted. Please try again, or contact your ministry admin if this keeps happening.',
 );
 };

 /** Re-authenticate with the password typed into the confirm panel, then retry. */
 const handleReauthAndDelete = async () => {
 if (!auth.currentUser?.email) return;
 if (!deletePassword) {
 setDeleteMessage('Enter your password to continue.');
 return;
 }

 setDeleteState('deleting');
 try {
 const credential = EmailAuthProvider.credential(auth.currentUser.email, deletePassword);
 await reauthenticateWithCredential(auth.currentUser, credential);
 } catch (error: unknown) {
 console.error('Error re-authenticating before delete:', error);
 setDeleteState('reauth');
 setDeleteMessage('Incorrect password. Try again.');
 return;
 }

 setDeletePassword('');
 await handleDeleteAccount();
 };

 /** Put the delete panel back to its resting state — used by Cancel and by close. */
 const resetDeleteFlow = () => {
 setShowDeleteConfirm(false);
 setDeleteState('idle');
 setDeleteMessage('');
 setDeletePassword('');
 };

 const handleVerifyCurrentPassword = async () => {
 if (!currentPassword || !auth.currentUser?.email) return;
 setIsPasswordLoading(true);
 setPasswordMessage('');
 try {
 const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPassword);
 await reauthenticateWithCredential(auth.currentUser, credential);
 setPasswordFlowState('new');
 } catch (error: any) {
 console.error('Error verifying password:', error);
 setPasswordMessage('Incorrect current password.');
 } finally {
 setIsPasswordLoading(false);
 }
 };

 const handleUpdatePassword = async () => {
 if (!newPassword || !confirmNewPassword) {
 setPasswordMessage('Please fill in all fields.');
 return;
 }
 if (newPassword !== confirmNewPassword) {
 setPasswordMessage('New passwords do not match.');
 return;
 }
 if (newPassword.length < 6) {
 setPasswordMessage('Password must be at least 6 characters.');
 return;
 }

 setIsPasswordLoading(true);
 setPasswordMessage('');
 try {
 if (auth.currentUser) {
 await updatePassword(auth.currentUser, newPassword);
 setPasswordMessage('Password updated successfully!');
 setTimeout(() => {
 resetPasswordFlow();
 }, 2000);
 }
 } catch (error: any) {
 console.error('Error updating password:', error);
 setPasswordMessage(error.message || 'Failed to update password.');
 } finally {
 setIsPasswordLoading(false);
 }
 };

 const handleForgotPassword = async () => {
 if (!email) {
 setPasswordMessage('No email associated with this account.');
 return;
 }
 setIsPasswordLoading(true);
 setPasswordMessage('');
 try {
 await sendPasswordResetEmail(auth, email);
 setPasswordMessage('Password reset email sent! Check your inbox.');
 } catch (error: any) {
 console.error('Error sending reset email:', error);
 setPasswordMessage(error.message || 'Failed to send reset email.');
 } finally {
 setIsPasswordLoading(false);
 }
 };

 const renderPasswordModalContent = () => {
 switch (passwordFlowState) {
 case 'current':
 return (
 <>
 <div className="flex items-center mb-4">
 <button onClick={() => resetPasswordFlow()} className="mr-2 text-muted">
 <ArrowLeft size={20} />
 </button>
 <h3 className="text-lg font-bold text-strong font-display">Verify Password</h3>
 </div>
 <p className="text-sm text-muted mb-4">Please enter your current password to continue.</p>
 <input
 type="password"
 placeholder="Current Password"
 value={currentPassword}
 onChange={(e) => setCurrentPassword(e.target.value)}
 className="w-full bg-surface-sunken rounded-xl px-4 py-3 text-strong font-medium focus:outline-hidden focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_20%,transparent)] mb-4"
 />
 {passwordMessage && (
 <p className="text-sm mb-4 text-red-600">{passwordMessage}</p>
 )}
 <div className="flex flex-col gap-3">
 <button 
 onClick={handleVerifyCurrentPassword}
 disabled={isPasswordLoading || !currentPassword}
 className="w-full py-3 rounded-xl font-bold text-white bg-gold disabled:opacity-50"
 >
 {isPasswordLoading ? 'Verifying...' : 'Confirm'}
 </button>
 <button 
 onClick={() => {
 setPasswordFlowState('forgot');
 setPasswordMessage('');
 }}
 className="text-sm text-gold font-medium mt-2"
 >
 Forgot Password?
 </button>
 </div>
 </>
 );
 case 'new':
 return (
 <>
 <div className="flex items-center mb-4">
 <button onClick={() => setPasswordFlowState('current')} className="mr-2 text-muted">
 <ArrowLeft size={20} />
 </button>
 <h3 className="text-lg font-bold text-strong font-display">New Password</h3>
 </div>
 <input
 type="password"
 placeholder="New Password"
 value={newPassword}
 onChange={(e) => setNewPassword(e.target.value)}
 className="w-full bg-surface-sunken rounded-xl px-4 py-3 text-strong font-medium focus:outline-hidden focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_20%,transparent)] mb-3"
 />
 <input
 type="password"
 placeholder="Confirm New Password"
 value={confirmNewPassword}
 onChange={(e) => setConfirmNewPassword(e.target.value)}
 className="w-full bg-surface-sunken rounded-xl px-4 py-3 text-strong font-medium focus:outline-hidden focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_20%,transparent)] mb-4"
 />
 {passwordMessage && (
 <p className={`text-sm mb-4 ${passwordMessage.includes('success') ? 'text-green-600' : 'text-red-600'}`}>
 {passwordMessage}
 </p>
 )}
 <button 
 onClick={handleUpdatePassword}
 disabled={isPasswordLoading || !newPassword || !confirmNewPassword}
 className="w-full py-3 rounded-xl font-bold text-white bg-gold disabled:opacity-50"
 >
 {isPasswordLoading ? 'Updating...' : 'Update Password'}
 </button>
 </>
 );
 case 'forgot':
 return (
 <>
 <div className="flex items-center mb-4">
 <button onClick={() => setPasswordFlowState('current')} className="mr-2 text-muted">
 <ArrowLeft size={20} />
 </button>
 <h3 className="text-lg font-bold text-strong font-display">Reset Password</h3>
 </div>
 <p className="text-sm text-muted mb-4">We will send a password reset link to your email address.</p>
 <input
 type="email"
 value={email}
 readOnly
 className="w-full bg-surface-sunken rounded-xl px-4 py-3 text-muted font-medium mb-4 cursor-not-allowed"
 />
 {passwordMessage && (
 <p className={`text-sm mb-4 ${passwordMessage.includes('sent') ? 'text-green-600' : 'text-red-600'}`}>
 {passwordMessage}
 </p>
 )}
 <button 
 onClick={handleForgotPassword}
 disabled={isPasswordLoading}
 className="w-full py-3 rounded-xl font-bold text-white bg-gold disabled:opacity-50"
 >
 {isPasswordLoading ? 'Sending...' : 'Send Reset Link'}
 </button>
 </>
 );
 default:
 return null;
 }
 };

 return (
 <div className="fixed inset-0 z-50 flex flex-col bg-surface animate-in slide-in-from-bottom-full duration-300">
 {/* Header — mobile */}
 <div className="flex items-center justify-between px-4 py-4 bg-surface lg:hidden">
 <button onClick={onClose} className="p-2 -ml-2 text-muted">
 <X size={24} />
 </button>
 <h2 className="text-lg font-bold text-strong font-display">Profile</h2>
 <button
 onClick={handleSave}
 disabled={isSaving}
 className="text-gold font-bold text-sm px-2"
 >
 {isSaving ? 'Saving...' : 'Save'}
 </button>
 </div>
 {/* Header — desktop page (Edit profile + Cancel / Save changes) */}
 <div className="hidden lg:flex items-center justify-between px-8 pt-6 pb-4 max-w-5xl mx-auto w-full">
 <div>
 <h2 className="text-2xl font-bold text-strong font-display">Edit profile</h2>
 <p className="text-sm text-muted mt-0.5">Update your details</p>
 </div>
 <div className="flex items-center gap-3">
 <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-body border border-line hover:bg-surface-sunken transition-colors">Cancel</button>
 <button onClick={handleSave} disabled={isSaving} className="px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: 'var(--brand-color, #C9963A)' }}>{isSaving ? 'Saving…' : 'Save changes'}</button>
 </div>
 </div>

 <div className="flex-1 overflow-y-auto p-4 lg:px-8 lg:pb-10">
 <div className="lg:max-w-5xl lg:mx-auto lg:grid lg:grid-cols-[300px_1fr] lg:gap-6 lg:items-start">
 {/* Profile Photo — left-column card on desktop */}
 <div className="flex flex-col items-center mt-2 mb-8 lg:mt-0 lg:mb-0 lg:bg-surface-raised lg:border lg:border-line lg:rounded-3xl lg:p-6 lg:sticky lg:top-4">
 <div className="relative">
 <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-surface-raised shadow-xs bg-surface-chip relative">
 {profilePic ? (
 <Image src={profilePic} alt="Profile" fill sizes="128px" className="object-cover" />
 ) : (
 <div className="w-full h-full flex items-center justify-center text-faint text-4xl font-bold">
 {name.charAt(0) || 'U'}
 </div>
 )}
 </div>
 <button 
 onClick={handlePhotoClick}
 className="absolute bottom-0 right-0 w-10 h-10 bg-gold rounded-full flex items-center justify-center text-white border-4 border-surface-raised shadow-xs"
 >
 <Edit2 size={16} fill="currentColor" />
 </button>
 <input 
 type="file" 
 ref={fileInputRef} 
 className="hidden" 
 accept="image/*"
 onChange={handleFileChange}
 />
 </div>
 <button onClick={handlePhotoClick} className="mt-3 text-sm font-medium text-muted">
 Change Photo
 </button>
 </div>

 {/* Form Card */}
 <div className="bg-surface-raised rounded-3xl p-2 shadow-xs border border-line">
 {/*
   🔴 THE SAVE FAILURE, RENDERED. This is the half `handleSave` was missing:
   the state machine above has nowhere to be seen without it, and a state
   nobody renders is the console.error it replaced.

   `alert` is the primitive for exactly this — a banner reporting an outcome —
   and it is load-bearing rather than cosmetic: role="alert" is what carries a
   refused write to a screen reader, which is the reader who has the least
   chance of noticing that a modal simply did not close. It sits at the TOP OF
   THE FORM the member just edited and above the first field, so the message
   and the values it failed to write are on screen together.

   ⚠️ It is not a tap target and carries no height of its own, so it takes no
   44px floor. It does not lift the two Save buttons either — the mobile one
   measures 20px today and is one of four controls on this screen recorded as
   under the floor in THE-323.personal-information-measure. Lifting them is a
   class change BELOW sm, which is the sub-640px layer this ticket has just
   built the append path for, and it belongs to the pass that composes this
   file rather than to the fix that makes its failures visible.
 */}
 {saveState === 'error' && (
 <Alert
 variant="destructive"
 aria-live="assertive"
 data-save-error
 className="mx-2 mt-2"
 >
 <AlertTitle>Your changes were not saved</AlertTitle>
 <AlertDescription>{saveMessage}</AlertDescription>
 </Alert>
 )}
 {/* Full Name */}
 <div className={`p-4 pb-2 ${FIELD_WIDTH.long}`}>
 <label className="text-[10px] font-bold text-faint tracking-wider uppercase mb-2 block">
 Full Name
 </label>
 <input
 type="text"
 value={name}
 onChange={(e) => setName(e.target.value)}
 className={`w-full bg-surface-sunken rounded-2xl px-4 py-4 text-strong font-bold focus:outline-hidden focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_20%,transparent)] ${CONTROL_DENSITY.control}`}
 />
 </div>

 {/* Country */}
 <div className={`p-4 pb-2 relative z-50 ${FIELD_WIDTH.medium}`}>
 <label className="text-[10px] font-bold text-faint tracking-wider uppercase mb-2 block">
 Country
 </label>
 <CountrySelect
 value={country}
 onChange={setCountry}
 className="w-full"
 buttonClassName="!bg-surface-sunken !border-transparent !text-strong !font-bold focus-within:!ring-2 focus-within:!ring-[color-mix(in_srgb,var(--brand-color)_20%,transparent)] !py-4 !rounded-2xl"
 />
 </div>

 {/* City */}
 <div className={`p-4 pb-2 relative z-40 ${FIELD_WIDTH.medium}`}>
 <label className="text-[10px] font-bold text-faint tracking-wider uppercase mb-2 block">
 City
 </label>
 <input
 type="text"
 value={city}
 onChange={(e) => setCity(e.target.value)}
 className={`w-full bg-surface-sunken rounded-2xl px-4 py-4 text-strong font-bold focus:outline-hidden focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_20%,transparent)] ${CONTROL_DENSITY.control}`}
 />
 </div>

 {/* Phone */}
 <div className={`p-4 pb-2 relative z-30 ${FIELD_WIDTH.medium}`}>
 <label className="text-[10px] font-bold text-faint tracking-wider uppercase mb-2 block">
 Phone Number
 </label>
 <input
 type="tel"
 value={phone}
 onChange={(e) => setPhone(e.target.value)}
 className={`w-full bg-surface-sunken rounded-2xl px-4 py-4 text-strong font-bold focus:outline-hidden focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_20%,transparent)] ${CONTROL_DENSITY.control}`}
 />
 </div>

 
        <div className="p-4 pt-2 relative z-30">
          <label className="text-[10px] font-bold text-faint tracking-wider uppercase mb-2 block">
            Have you accepted Jesus?
          </label>
          {/* Not a field — two adjacent buttons. flex-1 stays for the mobile
              full-width split; from sm: up they shrink to their own content
              and sit together rather than each stretching to half the row. */}
          <div className="flex gap-4">
            <label className="flex-1 sm:flex-none cursor-pointer">
              <input
                type="radio"
                name="acceptedJesusModal"
                value="yes"
                checked={acceptedJesus === 'yes'}
                onChange={(e) => setAcceptedJesus(e.target.value)}
                className="peer sr-only"
                required
              />
              <div className="w-full sm:w-auto bg-surface-sunken rounded-2xl px-4 py-4 text-center text-strong font-bold peer-checked:bg-[color-mix(in_srgb,var(--brand-color)_10%,transparent)] peer-checked:text-gold peer-checked:ring-2 peer-checked:ring-[color-mix(in_srgb,var(--brand-color)_30%,transparent)] transition-all">
                Yes
              </div>
            </label>
            <label className="flex-1 sm:flex-none cursor-pointer">
              <input
                type="radio"
                name="acceptedJesusModal"
                value="no"
                checked={acceptedJesus === 'no'}
                onChange={(e) => setAcceptedJesus(e.target.value)}
                className="peer sr-only"
                required
              />
              <div className="w-full sm:w-auto bg-surface-sunken rounded-2xl px-4 py-4 text-center text-strong font-bold peer-checked:bg-surface-chip peer-checked:ring-2 peer-checked:ring-line-strong transition-all">
                No
              </div>
            </label>
          </div>
        </div>

        {/* Email (Read Only) */}
 <div className={`p-4 pt-2 ${FIELD_WIDTH.long}`}>
 <label className="text-[10px] font-bold text-faint tracking-wider uppercase mb-2 block">
 Email Address
 </label>
 <input
 type="email"
 value={email}
 readOnly
 className={`w-full bg-surface-sunken rounded-2xl px-4 py-4 text-muted font-medium focus:outline-hidden cursor-not-allowed ${CONTROL_DENSITY.control}`}
 />
 </div>

 {/* Actions — capped so Change Password / Cancel Partnership / Delete
     Account read as rows, not a bar spanning the whole card at desktop. */}
 <div className={`px-2 pb-2 space-y-2 ${FIELD_WIDTH.long}`}>
 {isEmailAuth && (
 <button 
 onClick={() => setPasswordFlowState('current')}
 className="w-full flex items-center justify-between p-4 bg-surface rounded-2xl hover:bg-surface-sunken transition-colors"
 >
 <span className="text-sm font-bold text-strong">Change Password</span>
 <ChevronRight size={18} className="text-faint" />
 </button>
 )}

 <button
   onClick={() => setShowCancelPartnershipConfirm(true)}
   className="w-full flex items-center justify-between p-4 bg-surface rounded-2xl hover:bg-surface-sunken transition-colors"
 >
   <span className="text-sm font-bold text-strong">Cancel Partnership</span>
   <ChevronRight size={18} className="text-faint" />
 </button>

 {showCancelPartnershipConfirm && (
   <div className="w-full p-4 bg-red-50 rounded-2xl flex flex-col gap-3">
     <span className="text-sm font-bold text-red-600 text-center">
       Cancel your recurring donation? It will end at the close of the current billing period.
     </span>
     {cancelPartnershipMsg && (
       <p className={`text-xs text-center ${cancelPartnershipMsg.includes('success') ? 'text-green-600' : 'text-red-600'}`}>
         {cancelPartnershipMsg}
       </p>
     )}
     <div className="flex gap-2">
       <button
         onClick={() => setShowCancelPartnershipConfirm(false)}
         className="flex-1 py-2 bg-surface-raised text-body rounded-xl font-medium border border-line"
       >
         Keep
       </button>
       <button
         onClick={handleCancelPartnership}
         disabled={isCancelingPartnership}
         className="flex-1 py-2 bg-red-600 text-white rounded-xl font-bold disabled:opacity-50"
       >
         {isCancelingPartnership ? 'Canceling...' : 'Confirm Cancel'}
       </button>
     </div>
   </div>
 )}

 {cancelPartnershipMsg && !showCancelPartnershipConfirm && (
   <p className="text-xs text-center text-green-600 -mt-1">{cancelPartnershipMsg}</p>
 )}

 {/* 🔴 THE-188 — the export sits BESIDE the delete, not somewhere else in
     Settings. A member who has decided to leave is exactly the person who
     needs their giving history first, and deletion shipped without it. Never
     gated: no plan check, and an archived church's members download the same
     file a paying church's do. */}
 <button
   onClick={handleExportData}
   disabled={exportState === 'working'}
   className="w-full flex items-center justify-between p-4 bg-surface rounded-2xl hover:bg-surface-sunken transition-colors disabled:opacity-50"
 >
   <span className="text-sm font-bold text-strong">
     {exportState === 'working' ? 'Preparing your download…' : 'Download My Data'}
   </span>
   <ChevronRight size={18} className="text-faint" />
 </button>

 {exportMessage && (
   <p
     role={exportState === 'error' ? 'alert' : 'status'}
     className={`text-xs text-center ${exportState === 'error' ? 'text-red-600' : 'text-green-600'}`}
   >
     {exportMessage}
   </p>
 )}

 {showDeleteConfirm ? (
 <div className="w-full p-4 bg-red-50 rounded-2xl mt-4 flex flex-col gap-3">
 {deleteState === 'done' ? (
 // Success is confirmed, not assumed. The sign-out redirect follows
 // from onAuthStateChanged upstream; this is what the member sees the
 // action end in.
 <p role="status" className="text-sm font-bold text-green-700 text-center">
 {deleteMessage}
 </p>
 ) : (
 <>
 <span className="text-sm font-bold text-red-600 text-center">Are you sure? This cannot be undone.</span>

 {/* 🔴 THE-230 — DERIVED, NOT WRITTEN HERE. Every word below comes from
     DELETE_CONFIRM_COPY, which is `deriveErasureCopy(MEMBER_DATA_MAP)` pinned
     in-process by test. Nothing in this block may be hand-edited: change the
     erasure and the copy follows it. See src/lib/member-erasure-copy.ts.

     ⚠️ THE COMMENT THAT USED TO SIT HERE WAS PART OF THE DEFECT, so it went
     with the sentence it defended rather than surviving it. It argued the copy
     must not promise erasure "because the route removes users/{uid} and the
     Auth account, and nothing else" — true when it was written, false since
     PR 354 made the route run eraseMemberData across the whole map. The
     sentence it justified told members that giving history, event
     registrations, check-ins, prayer requests and community posts "stay in
     their records"; four of those five are deleted. It promised RETENTION for
     data that is DESTROYED, at an irreversible tap, which is the direction of
     that lie that cannot be taken back: a member who wanted their posts to
     remain for the church, and accepted deletion on that basis, lost them. */}
 <div className="text-xs text-body flex flex-col gap-3 text-left">
 {DELETE_CONFIRM_COPY.groups.map((group) => (
 <div key={group.disposition} className="flex flex-col gap-1">
 <span className="text-xs font-bold text-strong">{group.heading}</span>
 <span>{group.blurb}</span>
 <ul className="list-disc ps-4 flex flex-col gap-0.5">
 {group.items.map((item) => (
 <li key={item}>{item}</li>
 ))}
 </ul>
 </div>
 ))}
 {DELETE_CONFIRM_COPY.unreachable.length > 0 && (
 <span>
 {UNREACHABLE_NOTE}{' '}
 {DELETE_CONFIRM_COPY.unreachable.join('; ')}.
 </span>
 )}
 </div>

 {/* The failure the member could not see before. `role="alert"` so it
     is announced, not just drawn. */}
 {deleteMessage && (
 <p
 role="alert"
 className={`text-xs text-center ${deleteState === 'reauth' ? 'text-body' : 'text-red-600'}`}
 >
 {deleteMessage}
 </p>
 )}

 {deleteState === 'reauth' && (
 <input
 type="password"
 aria-label="Password"
 placeholder="Password"
 value={deletePassword}
 onChange={(e) => setDeletePassword(e.target.value)}
 className="w-full px-4 py-2 bg-surface-raised border border-line rounded-xl text-sm text-body"
 />
 )}

 <div className="flex gap-2">
 <button
 onClick={resetDeleteFlow}
 disabled={deleteState === 'deleting'}
 className="flex-1 py-2 bg-surface-raised text-body rounded-xl font-medium border border-line disabled:opacity-50"
 >
 Cancel
 </button>
 <button
 onClick={deleteState === 'reauth' ? handleReauthAndDelete : handleDeleteAccount}
 disabled={deleteState === 'deleting'}
 className="flex-1 py-2 bg-red-600 text-white rounded-xl font-bold disabled:opacity-50"
 >
 {deleteState === 'deleting'
 ? 'Deleting…'
 : deleteState === 'reauth'
 ? 'Confirm & Delete'
 : deleteState === 'error'
 ? 'Try Again'
 : 'Delete'}
 </button>
 </div>
 </>
 )}
 </div>
 ) : (
 <button 
 onClick={() => setShowDeleteConfirm(true)}
 className="w-full flex items-center justify-center p-4 bg-red-50 rounded-2xl hover:bg-red-100 transition-colors mt-4"
 >
 <span className="text-sm font-bold text-red-600">Delete Account</span>
 </button>
 )}
 </div>
 </div>
 </div>
 </div>

 {/* Change Password Modal */}
 {passwordFlowState !== 'idle' && (
 <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
 <div className="bg-surface-raised rounded-3xl p-6 w-full max-w-sm relative">
 <button 
 onClick={resetPasswordFlow} 
 className="absolute top-4 right-4 text-faint hover:text-muted"
 >
 <X size={20} />
 </button>
 {renderPasswordModalContent()}
 </div>
 </div>
 )}
 </div>
 );
};

export default PersonalInformationModal;