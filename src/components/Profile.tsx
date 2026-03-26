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
  Moon
} from 'lucide-react';
import { auth, db } from '../firebase';
import { signOut, updateProfile } from 'firebase/auth';
import { doc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import PersonalInformationModal from './PersonalInformationModal';
import AboutUsModal from './AboutUsModal';
import ContactModal from './ContactModal';
import PrivacyTermsModal from './PrivacyTermsModal';
import FAQModal from './FAQModal';

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
  const [homeChurchId, setHomeChurchId] = useState<string | null>(null);

  useEffect(() => {
    const savedHomeChurch = localStorage.getItem('homeChurchId');
    if (savedHomeChurch) {
      setHomeChurchId(savedHomeChurch);
    }
  }, []);

  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.classList.contains('dark');
    }
    return false;
  });
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
              if (data.role === 'admin' || data.email === 'bumbmatei@gmail.com') {
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

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

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
        const img = new Image();
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
            console.error("Error saving photo:", error);
          }
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="flex flex-col min-h-full bg-[#f8f9fa] dark:bg-[#1a1d27] transition-colors duration-300">
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
            <h2 className="text-3xl font-serif font-bold text-white mb-2">{userName}</h2>
            <div className="bg-white/10 backdrop-blur-md px-4 py-1.5 rounded-full flex items-center gap-2 text-white text-[10px] font-bold tracking-wider border border-white/10">
              <BadgeCheck size={14} className="text-[#e6b325]" />
              MEMBER SINCE 2026
            </div>
          </div>
        </div>
      </div>

      {/* Content Section */}
      <div className="px-4 -mt-12 relative z-10 space-y-6">
        
        {/* Ready to grow card */}
        <div className="bg-white dark:bg-[#252a36] rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-gray-800 text-center transition-colors duration-300">
          <h3 className="text-lg font-serif font-bold text-[#1a202c] dark:text-white mb-2">Ready to grow?</h3>
          <p className="text-gray-500 dark:text-gray-400 text-xs mb-6">
            You haven't started any courses yet. Begin your journey today.
          </p>
          <button 
            onClick={onGoToCourses}
            className="w-full bg-[#d4a017] hover:bg-[#b8860b] text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors text-sm"
          >
            <GraduationCap size={18} />
            Start Learning
          </button>
        </div>

        {/* Account Settings */}
        <div>
          <h4 className="text-[10px] font-bold text-gray-400 tracking-wider uppercase mb-3 ml-2">Account Settings</h4>
          <div className="bg-white dark:bg-[#252a36] rounded-3xl shadow-sm border border-gray-100 dark:border-gray-800 overflow-hidden transition-colors duration-300">
            {isAdmin && (
              <>
                <SettingItem 
                  icon={<ShieldCheck size={16} className="text-red-500" />} 
                  iconBg="bg-red-50 dark:bg-red-900/30" 
                  label="Admin Dashboard" 
                  onClick={() => onNavigate('admin')}
                />
                <div className="h-px bg-gray-50 dark:bg-gray-800 mx-4"></div>
              </>
            )}
            <SettingItem 
              icon={<User size={16} className="text-blue-500" />} 
              iconBg="bg-blue-50 dark:bg-blue-900/30" 
              label="Personal Information" 
              onClick={() => setIsPersonalInfoOpen(true)}
            />
            <div className="h-px bg-gray-50 dark:bg-gray-800 mx-4"></div>
            <SettingItem 
              icon={<Church size={16} className="text-green-500" />} 
              iconBg="bg-green-50 dark:bg-green-900/30" 
              label={homeChurchId ? "My Church" : "My Home Church"} 
              onClick={() => {
                if (homeChurchId) {
                  alert("My Church feature is currently unavailable.");
                } else {
                  alert("You haven't selected a Home Church yet. Go to the Map to select one.");
                }
              }}
            />
            <div className="h-px bg-gray-50 dark:bg-gray-800 mx-4"></div>
            <SettingItem 
              icon={<HeartHandshake size={16} className="text-yellow-500" />} 
              iconBg="bg-yellow-50 dark:bg-yellow-900/30" 
              label="Partner with Us" 
              onClick={onGoToPartner}
            />
            <div className="h-px bg-gray-50 dark:bg-gray-800 mx-4"></div>
            <SettingToggle icon={<Bell size={16} className="text-purple-500" />} iconBg="bg-purple-50 dark:bg-purple-900/30" label="Notifications" defaultChecked={true} />
            <div className="h-px bg-gray-50 dark:bg-gray-800 mx-4"></div>
            <SettingToggle 
              icon={isDarkMode ? <Moon size={16} className="text-gray-300" /> : <Sun size={16} className="text-gray-500" />} 
              iconBg="bg-gray-100 dark:bg-gray-700" 
              label="Dark Mode" 
              defaultChecked={isDarkMode} 
              onChange={setIsDarkMode}
            />
          </div>
        </div>

        {/* Support & Info */}
        <div>
          <h4 className="text-[10px] font-bold text-gray-400 tracking-wider uppercase mb-3 ml-2">Support & Info</h4>
          <div className="bg-white dark:bg-[#252a36] rounded-3xl shadow-sm border border-gray-100 dark:border-gray-800 overflow-hidden transition-colors duration-300">
            <SettingItem 
              icon={<HelpCircle size={16} className="text-yellow-500" />} 
              iconBg="bg-yellow-50 dark:bg-yellow-900/30" 
              label="Contact Us" 
              onClick={() => setIsContactOpen(true)}
            />
            <div className="h-px bg-gray-50 dark:bg-gray-800 mx-4"></div>
            <SettingItem 
              icon={<Info size={16} className="text-blue-500" />} 
              iconBg="bg-blue-50 dark:bg-blue-900/30" 
              label="About Us" 
              onClick={() => setIsAboutUsOpen(true)}
            />
            <div className="h-px bg-gray-50 dark:bg-gray-800 mx-4"></div>
            <SettingItem 
              icon={<FileQuestion size={16} className="text-green-500" />} 
              iconBg="bg-green-50 dark:bg-green-900/30" 
              label="FAQ" 
              onClick={() => setIsFAQOpen(true)}
            />
            <div className="h-px bg-gray-50 dark:bg-gray-800 mx-4"></div>
            <SettingItem 
              icon={<ShieldCheck size={16} className="text-teal-500" />} 
              iconBg="bg-teal-50 dark:bg-teal-900/30" 
              label="Privacy & Terms" 
              onClick={() => setIsPrivacyTermsOpen(true)}
            />
          </div>
        </div>

        {/* Log Out Button */}
        <button 
          onClick={handleLogout}
          className="w-full bg-red-50 dark:bg-[#2a1f24] hover:bg-red-100 dark:hover:bg-[#3a252a] text-red-500 font-bold py-3.5 px-4 rounded-2xl flex items-center justify-center gap-2 transition-colors mt-4 text-sm"
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
    </div>
  );
};

const SettingItem = ({ icon, iconBg, label, onClick }: { icon: React.ReactNode, iconBg: string, label: string, onClick?: () => void }) => (
  <button onClick={onClick} className="w-full flex items-center justify-between p-3.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
    <div className="flex items-center gap-3">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center ${iconBg}`}>
        {icon}
      </div>
      <span className="text-[13px] font-medium text-gray-700 dark:text-gray-200">{label}</span>
    </div>
    <ChevronRight size={16} className="text-gray-400 dark:text-gray-500" />
  </button>
);

const SettingToggle = ({ icon, iconBg, label, defaultChecked, onChange }: { icon: React.ReactNode, iconBg: string, label: string, defaultChecked: boolean, onChange?: (checked: boolean) => void }) => {
  const [checked, setChecked] = React.useState(defaultChecked);
  
  const handleToggle = () => {
    const newChecked = !checked;
    setChecked(newChecked);
    if (onChange) {
      onChange(newChecked);
    }
  };

  return (
    <div className="w-full flex items-center justify-between p-3.5">
      <div className="flex items-center gap-3">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center ${iconBg}`}>
          {icon}
        </div>
        <span className="text-[13px] font-medium text-gray-700 dark:text-gray-200">{label}</span>
      </div>
      <button 
        onClick={handleToggle}
        className={`w-10 h-6 rounded-full transition-colors relative ${checked ? 'bg-[#d4a017]' : 'bg-gray-200 dark:bg-gray-700'}`}
      >
        <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform ${checked ? 'translate-x-5' : 'translate-x-1'}`} />
      </button>
    </div>
  );
};

export default Profile;