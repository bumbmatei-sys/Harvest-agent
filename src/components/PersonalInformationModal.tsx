"use client";
import React, { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { X, Edit2, ChevronRight, ArrowLeft } from 'lucide-react';
import { auth, db } from '../firebase';
import { updateProfile, updatePassword, deleteUser, EmailAuthProvider, reauthenticateWithCredential, sendPasswordResetEmail } from 'firebase/auth';
import { doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import CountrySelect from './CountrySelect';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { authFetch } from '../utils/auth-fetch';

interface PersonalInformationModalProps {
 isOpen: boolean;
 onClose: () => void;
}

type PasswordFlowState = 'idle' | 'current' | 'new' | 'forgot';

const PersonalInformationModal: React.FC<PersonalInformationModalProps> = ({ isOpen, onClose }) => {
 const [name, setName] = useState(auth.currentUser?.displayName || '');
 const [email, setEmail] = useState(auth.currentUser?.email || '');
 const [country, setCountry] = useState('');
 const [city, setCity] = useState('');
 const [phone, setPhone] = useState('');
  const [acceptedJesus, setAcceptedJesus] = useState('');
 const [profilePic, setProfilePic] = useState<string | null>(auth.currentUser?.photoURL || null);
 const [isSaving, setIsSaving] = useState(false);
 
 // Password Flow State
 const [passwordFlowState, setPasswordFlowState] = useState<PasswordFlowState>('idle');
 const [currentPassword, setCurrentPassword] = useState('');
 const [newPassword, setNewPassword] = useState('');
 const [confirmNewPassword, setConfirmNewPassword] = useState('');
 const [passwordMessage, setPasswordMessage] = useState('');
 const [isPasswordLoading, setIsPasswordLoading] = useState(false);
 const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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

 const handleSave = async () => {
 if (!auth.currentUser) return;
 setIsSaving(true);
 try {
 await updateProfile(auth.currentUser, {
 displayName: name
 });
 
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
 return;
 }

 onClose();
 } catch (error) {
 console.error('Error updating profile:', error);
 // We use a custom modal or just console error since alert is blocked in iframe
 console.error('Failed to update profile.');
 } finally {
 setIsSaving(false);
 }
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
 const userRef = doc(db, 'users', auth.currentUser!.uid);
 await updateDoc(userRef, { photoURL: base64String });
 try {
 await updateProfile(auth.currentUser!, { photoURL: base64String });
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

 const handleDeleteAccount = async () => {
 try {
 if (auth.currentUser) {
 const uid = auth.currentUser.uid;
 try {
 await deleteDoc(doc(db, 'users', uid));
 } catch (err) {
 handleFirestoreError(err, OperationType.DELETE, `users/${uid}`);
 }
 await deleteUser(auth.currentUser);
 // App will redirect to login automatically via onAuthStateChanged
 }
 } catch (error: any) {
 console.error('Error deleting account:', error);
 if (error.code === 'auth/requires-recent-login') {
 console.error('Please log out and log back in to delete your account.');
 }
 }
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
 <button onClick={() => resetPasswordFlow()} className="mr-2 text-gray-500">
 <ArrowLeft size={20} />
 </button>
 <h3 className="text-lg font-bold text-gray-900">Verify Password</h3>
 </div>
 <p className="text-sm text-gray-600 mb-4">Please enter your current password to continue.</p>
 <input
 type="password"
 placeholder="Current Password"
 value={currentPassword}
 onChange={(e) => setCurrentPassword(e.target.value)}
 className="w-full bg-[#f8f9fa] rounded-xl px-4 py-3 text-gray-900 font-medium focus:outline-none focus:ring-2 focus:ring-[#d4a017]/20 mb-4"
 />
 {passwordMessage && (
 <p className="text-sm mb-4 text-red-600">{passwordMessage}</p>
 )}
 <div className="flex flex-col gap-3">
 <button 
 onClick={handleVerifyCurrentPassword}
 disabled={isPasswordLoading || !currentPassword}
 className="w-full py-3 rounded-xl font-bold text-white bg-[#d4a017] disabled:opacity-50"
 >
 {isPasswordLoading ? 'Verifying...' : 'Confirm'}
 </button>
 <button 
 onClick={() => {
 setPasswordFlowState('forgot');
 setPasswordMessage('');
 }}
 className="text-sm text-[#d4a017] font-medium mt-2"
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
 <button onClick={() => setPasswordFlowState('current')} className="mr-2 text-gray-500">
 <ArrowLeft size={20} />
 </button>
 <h3 className="text-lg font-bold text-gray-900">New Password</h3>
 </div>
 <input
 type="password"
 placeholder="New Password"
 value={newPassword}
 onChange={(e) => setNewPassword(e.target.value)}
 className="w-full bg-[#f8f9fa] rounded-xl px-4 py-3 text-gray-900 font-medium focus:outline-none focus:ring-2 focus:ring-[#d4a017]/20 mb-3"
 />
 <input
 type="password"
 placeholder="Confirm New Password"
 value={confirmNewPassword}
 onChange={(e) => setConfirmNewPassword(e.target.value)}
 className="w-full bg-[#f8f9fa] rounded-xl px-4 py-3 text-gray-900 font-medium focus:outline-none focus:ring-2 focus:ring-[#d4a017]/20 mb-4"
 />
 {passwordMessage && (
 <p className={`text-sm mb-4 ${passwordMessage.includes('success') ? 'text-green-600' : 'text-red-600'}`}>
 {passwordMessage}
 </p>
 )}
 <button 
 onClick={handleUpdatePassword}
 disabled={isPasswordLoading || !newPassword || !confirmNewPassword}
 className="w-full py-3 rounded-xl font-bold text-white bg-[#d4a017] disabled:opacity-50"
 >
 {isPasswordLoading ? 'Updating...' : 'Update Password'}
 </button>
 </>
 );
 case 'forgot':
 return (
 <>
 <div className="flex items-center mb-4">
 <button onClick={() => setPasswordFlowState('current')} className="mr-2 text-gray-500">
 <ArrowLeft size={20} />
 </button>
 <h3 className="text-lg font-bold text-gray-900">Reset Password</h3>
 </div>
 <p className="text-sm text-gray-600 mb-4">We will send a password reset link to your email address.</p>
 <input
 type="email"
 value={email}
 readOnly
 className="w-full bg-gray-100 rounded-xl px-4 py-3 text-gray-500 font-medium mb-4 cursor-not-allowed"
 />
 {passwordMessage && (
 <p className={`text-sm mb-4 ${passwordMessage.includes('sent') ? 'text-green-600' : 'text-red-600'}`}>
 {passwordMessage}
 </p>
 )}
 <button 
 onClick={handleForgotPassword}
 disabled={isPasswordLoading}
 className="w-full py-3 rounded-xl font-bold text-white bg-[#d4a017] disabled:opacity-50"
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
 <div className="fixed inset-0 z-50 flex flex-col bg-[#f8f9fa] animate-in slide-in-from-bottom-full duration-300">
 {/* Header */}
 <div className="flex items-center justify-between px-4 py-4 bg-[#f8f9fa]">
 <button onClick={onClose} className="p-2 -ml-2 text-gray-600">
 <X size={24} />
 </button>
 <h2 className="text-lg font-bold text-gray-900">Profile</h2>
 <button 
 onClick={handleSave} 
 disabled={isSaving}
 className="text-[#d4a017] font-bold text-sm px-2"
 >
 {isSaving ? 'Saving...' : 'Save'}
 </button>
 </div>

 <div className="flex-1 overflow-y-auto p-4">
 {/* Profile Photo */}
 <div className="flex flex-col items-center mt-2 mb-8">
 <div className="relative">
 <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-white shadow-sm bg-gray-200 relative">
 {profilePic ? (
 <Image src={profilePic} alt="Profile" fill sizes="128px" className="object-cover" />
 ) : (
 <div className="w-full h-full flex items-center justify-center text-gray-400 text-4xl font-bold">
 {name.charAt(0) || 'U'}
 </div>
 )}
 </div>
 <button 
 onClick={handlePhotoClick}
 className="absolute bottom-0 right-0 w-10 h-10 bg-[#d4a017] rounded-full flex items-center justify-center text-white border-4 border-[#f8f9fa] shadow-sm"
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
 <button onClick={handlePhotoClick} className="mt-3 text-sm font-medium text-gray-500">
 Change Photo
 </button>
 </div>

 {/* Form Card */}
 <div className="bg-white rounded-3xl p-2 shadow-sm border border-gray-100">
 {/* Full Name */}
 <div className="p-4 pb-2">
 <label className="text-[10px] font-bold text-gray-400 tracking-wider uppercase mb-2 block">
 Full Name
 </label>
 <input
 type="text"
 value={name}
 onChange={(e) => setName(e.target.value)}
 className="w-full bg-[#f8f9fa] rounded-2xl px-4 py-4 text-gray-900 font-bold focus:outline-none focus:ring-2 focus:ring-[#d4a017]/20"
 />
 </div>

 {/* Country */}
 <div className="p-4 pb-2 relative z-50">
 <label className="text-[10px] font-bold text-gray-400 tracking-wider uppercase mb-2 block">
 Country
 </label>
 <CountrySelect
 value={country}
 onChange={setCountry}
 className="w-full"
 buttonClassName="!bg-[#f8f9fa] !border-transparent !text-gray-900 !font-bold focus-within:!ring-2 focus-within:!ring-[#d4a017]/20 !py-4 !rounded-2xl"
 />
 </div>

 {/* City */}
 <div className="p-4 pb-2 relative z-40">
 <label className="text-[10px] font-bold text-gray-400 tracking-wider uppercase mb-2 block">
 City
 </label>
 <input
 type="text"
 value={city}
 onChange={(e) => setCity(e.target.value)}
 className="w-full bg-[#f8f9fa] rounded-2xl px-4 py-4 text-gray-900 font-bold focus:outline-none focus:ring-2 focus:ring-[#d4a017]/20"
 />
 </div>

 {/* Phone */}
 <div className="p-4 pb-2 relative z-30">
 <label className="text-[10px] font-bold text-gray-400 tracking-wider uppercase mb-2 block">
 Phone Number
 </label>
 <input
 type="tel"
 value={phone}
 onChange={(e) => setPhone(e.target.value)}
 className="w-full bg-[#f8f9fa] rounded-2xl px-4 py-4 text-gray-900 font-bold focus:outline-none focus:ring-2 focus:ring-[#d4a017]/20"
 />
 </div>

 
        <div className="p-4 pt-2 relative z-30">
          <label className="text-[10px] font-bold text-gray-400 tracking-wider uppercase mb-2 block">
            Have you accepted Jesus?
          </label>
          <div className="flex gap-4">
            <label className="flex-1 cursor-pointer">
              <input
                type="radio"
                name="acceptedJesusModal"
                value="yes"
                checked={acceptedJesus === 'yes'}
                onChange={(e) => setAcceptedJesus(e.target.value)}
                className="peer sr-only"
                required
              />
              <div className="w-full bg-[#f8f9fa] rounded-2xl px-4 py-4 text-center text-gray-900 font-bold peer-checked:bg-[#d4a017]/10 peer-checked:text-[#d4a017] peer-checked:ring-2 peer-checked:ring-[#d4a017]/30 transition-all">
                Yes
              </div>
            </label>
            <label className="flex-1 cursor-pointer">
              <input
                type="radio"
                name="acceptedJesusModal"
                value="no"
                checked={acceptedJesus === 'no'}
                onChange={(e) => setAcceptedJesus(e.target.value)}
                className="peer sr-only"
                required
              />
              <div className="w-full bg-[#f8f9fa] rounded-2xl px-4 py-4 text-center text-gray-900 font-bold peer-checked:bg-gray-200 peer-checked:ring-2 peer-checked:ring-gray-300 transition-all">
                No
              </div>
            </label>
          </div>
        </div>

        {/* Email (Read Only) */}
 <div className="p-4 pt-2">
 <label className="text-[10px] font-bold text-gray-400 tracking-wider uppercase mb-2 block">
 Email Address
 </label>
 <input
 type="email"
 value={email}
 readOnly
 className="w-full bg-gray-50 rounded-2xl px-4 py-4 text-gray-500 font-medium focus:outline-none cursor-not-allowed"
 />
 </div>

 {/* Actions */}
 <div className="px-2 pb-2 space-y-2">
 {isEmailAuth && (
 <button 
 onClick={() => setPasswordFlowState('current')}
 className="w-full flex items-center justify-between p-4 bg-[#f8f9fa] rounded-2xl hover:bg-gray-100 transition-colors"
 >
 <span className="text-sm font-bold text-gray-900">Change Password</span>
 <ChevronRight size={18} className="text-gray-400" />
 </button>
 )}

 <button
   onClick={() => setShowCancelPartnershipConfirm(true)}
   className="w-full flex items-center justify-between p-4 bg-[#f8f9fa] rounded-2xl hover:bg-gray-100 transition-colors"
 >
   <span className="text-sm font-bold text-gray-900">Cancel Partnership</span>
   <ChevronRight size={18} className="text-gray-400" />
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
         className="flex-1 py-2 bg-white text-gray-700 rounded-xl font-medium border border-gray-200"
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

 {showDeleteConfirm ? (
 <div className="w-full p-4 bg-red-50 rounded-2xl mt-4 flex flex-col gap-3">
 <span className="text-sm font-bold text-red-600 text-center">Are you sure? This cannot be undone.</span>
 <div className="flex gap-2">
 <button 
 onClick={() => setShowDeleteConfirm(false)}
 className="flex-1 py-2 bg-white text-gray-700 rounded-xl font-medium border border-gray-200"
 >
 Cancel
 </button>
 <button 
 onClick={handleDeleteAccount}
 className="flex-1 py-2 bg-red-600 text-white rounded-xl font-bold"
 >
 Delete
 </button>
 </div>
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

 {/* Change Password Modal */}
 {passwordFlowState !== 'idle' && (
 <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
 <div className="bg-white rounded-3xl p-6 w-full max-w-sm relative">
 <button 
 onClick={resetPasswordFlow} 
 className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
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