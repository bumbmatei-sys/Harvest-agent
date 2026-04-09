"use client";
import React, { useState, useEffect } from 'react';
import { 
 GraduationCap, 
 User, 
 Church, 
 HeartHandshake, 
 Bell, 
 Sun, 
 HelpCircle, 
 Info, 
 FileQuestion, 
 ShieldCheck, 
 LogOut, 
 ChevronRight,
 BadgeCheck,
 Moon,
 Play
} from 'lucide-react';
import Image from 'next/image';
import { auth, db } from '../firebase';
import { signOut, updateProfile } from 'firebase/auth';
import { doc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import PersonalInformationModal from './PersonalInformationModal';
import AboutUsModal from './AboutUsModal';
import ContactModal from './ContactModal';
import PrivacyTermsModal from './PrivacyTermsModal';
import FAQModal from './FAQModal';
import ChurchDetailsModal from './ChurchDetailsModal';

enum OperationType {
 CREATE = 'create',
 UPDATE = 'update',
 DELETE = 'delete',
 LIST = 'list',
 GET = 'get',
 WRITE = 'write',
}

interface FirestoreErrorInfo {
 error: string;
 operationType: OperationType;
 path: string | null;
 authInfo: {
 userId: string | undefined;
 email: string | null | undefined;
 emailVerified: boolean | undefined;
 isAnonymous: boolean | undefined;
 tenantId: string | null | undefined;
 providerInfo: {
 providerId: string;
 displayName: string | null;
 email: string | null;
 photoUrl: string | null;
 }[];
 }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
 const errInfo: FirestoreErrorInfo = {
 error: error instanceof Error ? error.message : String(error),
 authInfo: {
 userId: auth.currentUser?.uid,
 email: auth.currentUser?.email,
 emailVerified: auth.currentUser?.emailVerified,
 isAnonymous: auth.currentUser?.isAnonymous,
 tenantId: auth.currentUser?.tenantId,
 providerInfo: auth.currentUser?.providerData.map(provider => ({
 providerId: provider.providerId,
 displayName: provider.displayName,
 email: provider.email,
 photoUrl: provider.photoURL
 })) || []
 },
 operationType,
 path
 }
 console.error('Firestore Error: ', JSON.stringify(errInfo));
 throw new Error(JSON.stringify(errInfo));
}

interface ProfileProps {
 onNavigate: (page: string) => void;
 onGoToCourses: () => void;
 onGoToPartner: () => void;
}

const Profile: React.FC<ProfileProps> = ({ onNavigate, onGoToCourses, onGoToPartner }) => {
 const [isPersonalInfoOpen, setIsPersonalInfoOpen] = useState(false);
 const [isAboutUsOpen, setIsAboutUsOpen] = useState(false);
 const [isContactOpen, setIsContactOpen] = useState(false);
 const [isPrivacyTermsOpen, setIsPrivacyTermsOpen] = useState(false);
 const [isFAQOpen, setIsFAQOpen] = useState(false);
 const [isChurchDetailsOpen, setIsChurchDetailsOpen] = useState(false);
 const [homeChurchId, setHomeChurchId] = useState<string | null>(null);

 useEffect(() => {
 const savedHomeChurch = localStorage.getItem('homeChurchId');
 if (savedHomeChurch) {
 setHomeChurchId(savedHomeChurch);
 }
 }, []);

 const handleRemoveHomeChurch = () => {
 setHomeChurchId(null);
 localStorage.removeItem('homeChurchId');
 };

 const [hasMounted, setHasMounted] = useState(false);
 useEffect(() => {
 setHasMounted(true);
 }, []);

 const [profilePic, setProfilePic] = useState<string | null>(auth.currentUser?.photoURL || null);
 const [userName, setUserName] = useState<string>('Loading...');
 const [isAdmin, setIsAdmin] = useState(false);

 useEffect(() => {
 let unsubscribe: () => void;

 const fetchUserData = async () => {
 if (auth.currentUser) {
 try {
 const userRef = doc(db, 'users', auth.currentUser.uid);
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
 if (data.role === 'admin' || data.role === 'super_admin' || data.email === 'bumbmatei@gmail.com') {
 setIsAdmin(true);
 }
 } else {
 setUserName(auth.currentUser?.displayName || 'User');
 }
 }, (error) => {
 handleFirestoreError(error, OperationType.GET, `users/${auth.currentUser?.uid}`);
 setUserName(auth.currentUser?.displayName || 'User');
 });
 } catch (error) {
 handleFirestoreError(error, OperationType.GET, `users/${auth.currentUser.uid}`);
 setUserName(auth.currentUser.displayName || 'User');
 }
 }
 };
 fetchUserData();

 return () => {
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

 const handleLogout = async () => {
 try {
 await signOut(auth);
 // App.tsx will handle the redirect to landing page via onAuthStateChanged
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
 const userRef = doc(db, 'users', auth.currentUser!.uid);
 await updateDoc(userRef, { photoURL: base64String });
 await updateProfile(auth.currentUser!, { photoURL: base64String });
 } catch (error) {
 handleFirestoreError(error, OperationType.UPDATE, `users/${auth.currentUser?.uid}`);
 }
 };
 img.src = reader.result as string;
 };
 reader.readAsDataURL(file);
 }
 };

 return (
 <div className="flex flex-col min-h-full bg-[#f8f9fa] transition-colors duration-300">
 {/* Top Background Section */}
 <div className="pt-12 pb-24 px-4 rounded-b-[40px] relative overflow-hidden bg-gray-800">
 {/* Background Image & Overlay */}
 {profilePic ? (
 <div 
 className="absolute inset-0 bg-cover bg-center"
 style={{ backgroundImage: `url(${profilePic})` }}
 />
 ) : (
 <div className="absolute inset-0 bg-gradient-to-b from-[#cbd5e1] to-[#475569]" />
 )}
 {/* Dark Overlay for text readability */}
 <div className="absolute inset-0 bg-black/50" />

 {/* Hidden File Input */}
 <input 
 type="file" 
 id="profile-pic-upload" 
 className="hidden" 
 accept="image/*"
 onChange={handleFileChange}
 />

 {/* Content */}
 <div className="relative z-10 flex flex-col min-h-[220px] justify-between">
 <div className="flex justify-center mb-6">
 <label htmlFor="profile-pic-upload" className="cursor-pointer bg-white/20 hover:bg-white/30 transition-colors backdrop-blur-md px-4 py-1.5 rounded-full text-white text-[10px] font-bold tracking-wider border border-white/10">
 MY PROFILE
 </label>
 </div>

 {/* Profile Info */}
 <div className="flex flex-col items-center mt-auto mb-4">
 <h2 className="text-3xl font-bold text-white mb-2">{userName}</h2>
 <div className="bg-white/10 backdrop-blur-md px-4 py-1.5 rounded-full flex items-center gap-2 text-white text-[10px] font-bold tracking-wider border border-white/10">
 <BadgeCheck size={14} className="text-[#e6b325]" />
 MEMBER SINCE 2026
 </div>
 </div>
 </div>
 </div>

 {/* Content Section */}
 <div className="px-4 -mt-12 relative z-10 space-y-6">
 
 {/* Account Settings */}
 <div>
 <h4 className="text-[10px] font-bold text-gray-400 tracking-wider uppercase mb-3 ml-2">Account Settings</h4>
 <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden transition-colors duration-300">
 {isAdmin && (
 <>
 <SettingItem 
 icon={<ShieldCheck size={16} className="text-red-500" />} 
 iconBg="bg-red-50" 
 label="Admin Dashboard" 
 onClick={() => onNavigate('admin')}
 />
 <div className="h-px bg-gray-50 mx-4"></div>
 </>
 )}
 <SettingItem 
 icon={<User size={16} className="text-blue-500" />} 
 iconBg="bg-blue-50" 
 label="Personal Information" 
 onClick={() => setIsPersonalInfoOpen(true)}
 />
 <div className="h-px bg-gray-50 mx-4"></div>
 <SettingItem 
 icon={<Church size={16} className="text-green-500" />} 
 iconBg="bg-green-50" 
 label={homeChurchId ? "My Church" : "My Home Church"} 
 onClick={() => {
 if (homeChurchId) {
 setIsChurchDetailsOpen(true);
 } else {
 alert("You haven't selected a Home Church yet. Go to the Map to select one.");
 }
 }}
 />
 <div className="h-px bg-gray-50 mx-4"></div>
 <SettingItem 
 icon={<HeartHandshake size={16} className="text-yellow-500" />} 
 iconBg="bg-yellow-50" 
 label="Partner with Us" 
 onClick={onGoToPartner}
 />
 </div>
 </div>

 {/* Support & Info */}
 <div>
 <h4 className="text-[10px] font-bold text-gray-400 tracking-wider uppercase mb-3 ml-2">Support & Info</h4>
 <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden transition-colors duration-300">
 <SettingItem 
 icon={<HelpCircle size={16} className="text-yellow-500" />} 
 iconBg="bg-yellow-50" 
 label="Contact Us" 
 onClick={() => setIsContactOpen(true)}
 />
 <div className="h-px bg-gray-50 mx-4"></div>
 <SettingItem 
 icon={<Info size={16} className="text-blue-500" />} 
 iconBg="bg-blue-50" 
 label="About Us" 
 onClick={() => setIsAboutUsOpen(true)}
 />
 <div className="h-px bg-gray-50 mx-4"></div>
 <SettingItem 
 icon={<FileQuestion size={16} className="text-green-500" />} 
 iconBg="bg-green-50" 
 label="FAQ" 
 onClick={() => setIsFAQOpen(true)}
 />
 <div className="h-px bg-gray-50 mx-4"></div>
 <SettingItem 
 icon={<ShieldCheck size={16} className="text-teal-500" />} 
 iconBg="bg-teal-50" 
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

 <PersonalInformationModal 
 isOpen={isPersonalInfoOpen} 
 onClose={() => setIsPersonalInfoOpen(false)} 
 />
 <AboutUsModal
 isOpen={isAboutUsOpen}
 onClose={() => setIsAboutUsOpen(false)}
 onOpenPartner={onGoToPartner}
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
 </div>
 );
};

const SettingItem = ({ icon, iconBg, label, onClick }: { icon: React.ReactNode, iconBg: string, label: string, onClick?: () => void }) => (
 <button onClick={onClick} className="w-full flex items-center justify-between p-3.5 hover:bg-gray-50 transition-colors">
 <div className="flex items-center gap-3">
 <div className={`w-7 h-7 rounded-full flex items-center justify-center ${iconBg}`}>
 {icon}
 </div>
 <span className="text-[13px] font-medium text-gray-700">{label}</span>
 </div>
 <ChevronRight size={16} className="text-gray-400" />
 </button>
);

export default Profile;