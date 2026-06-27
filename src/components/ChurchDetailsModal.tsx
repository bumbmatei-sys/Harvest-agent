import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { X, MapPin, User, Clock, Mail, Phone, Globe, Facebook, Instagram, Navigation, Copy, CheckCircle2, Trash2, Megaphone, Info } from 'lucide-react';
import { doc, getDoc, collection, query, orderBy, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { getPlaceholderImage } from '@/utils/placeholder';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';

interface ChurchDetailsModalProps {
 isOpen: boolean;
 onClose: () => void;
 churchId: string | null;
 isHomeChurch?: boolean;
 onRemoveHomeChurch?: () => void;
 fullPage?: boolean;
}

interface ChurchData {
  id: string;
  name: string;
  street?: string;
  number?: string;
  city: string;
  country: string;
  pastorName: string;
  contactEmail?: string;
  contactPhone?: string;
  website?: string;
  facebook?: string;
  instagram?: string;
  imageUrl?: string;
  services?: { day: string; time: string; name: string }[];
  lat: number;
  lng: number;
}

interface Announcement {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

const ChurchDetailsModal: React.FC<ChurchDetailsModalProps> = ({ 
 isOpen, 
 onClose, 
 churchId,
 isHomeChurch = false,
 onRemoveHomeChurch,
 fullPage = false
}) => {
 const [church, setChurch] = useState<ChurchData | null>(null);
 const [loading, setLoading] = useState(true);
 const [copiedEmail, setCopiedEmail] = useState(false);
 const [copiedPhone, setCopiedPhone] = useState(false);
 const [activeTab, setActiveTab] = useState<'announcements' | 'info'>('announcements');
 const [announcements, setAnnouncements] = useState<Announcement[]>([]);
 const [loadingAnnouncements, setLoadingAnnouncements] = useState(false);

 useEffect(() => {
 const fetchChurch = async () => {
 if (!churchId || !isOpen) return;
 
 setLoading(true);
 setChurch(null);
 setAnnouncements([]);
 try {
 const docRef = doc(db, 'churches', churchId);
 const docSnap = await getDoc(docRef);
 
 if (docSnap.exists()) {
 setChurch({ id: docSnap.id, ...docSnap.data() } as ChurchData);
 } else {
 console.error("No such church!");
 }
 } catch (error) {
 handleFirestoreError(error, OperationType.GET, `churches/${churchId}`);
 } finally {
 setLoading(false);
 }
 };

 fetchChurch();
 }, [churchId, isOpen]);

 // Fetch announcements when church changes
 useEffect(() => {
 if (!churchId || !isOpen) return;
 let cancelled = false;
 setLoadingAnnouncements(true);
 try {
   const announcementsRef = collection(db, 'churches', churchId, 'announcements');
   const q = query(announcementsRef, orderBy('createdAt', 'desc'));
   getDocs(q).then((snap) => {
     if (cancelled) return;
     const data: Announcement[] = snap.docs.map(d => {
       const raw = d.data();
       // Handle both Firestore Timestamp and ISO string
       let createdAtStr = '';
       if (raw.createdAt?.toDate) {
         createdAtStr = raw.createdAt.toDate().toISOString();
       } else if (typeof raw.createdAt === 'string') {
         createdAtStr = raw.createdAt;
       }
       return {
         id: d.id,
         title: raw.title || '',
         content: raw.content || '',
         createdAt: createdAtStr,
       };
     });
     setAnnouncements(data);
     setLoadingAnnouncements(false);
   }).catch((err) => {
     if (cancelled) return;
     console.error('Failed to load announcements:', err);
     setLoadingAnnouncements(false);
   });
 } catch {
   if (!cancelled) setLoadingAnnouncements(false);
 }
 return () => { cancelled = true; };
 }, [churchId, isOpen]);

 if (!isOpen) return null;

 const handleCopy = (text: string, type: 'email' | 'phone') => {
 navigator.clipboard.writeText(text);
 if (type === 'email') {
 setCopiedEmail(true);
 setTimeout(() => setCopiedEmail(false), 2000);
 } else {
 setCopiedPhone(true);
 setTimeout(() => setCopiedPhone(false), 2000);
 }
 };

 const openDirections = () => {
 if (church) {
 const url = `https://www.google.com/maps/dir/?api=1&destination=${church.lat},${church.lng}`;
 window.open(url, '_blank');
 }
 };

 const formatServices = (services: any[]) => {
 if (!services || services.length === 0) return <span className="text-gray-500">No schedule available</span>;
 
 return (
 <div className="flex flex-col gap-3 mt-1">
 {services.map((service, idx) => (
 <div key={idx} className="flex flex-col">
 <span className="font-bold text-gray-900 ">
 {service.name || `${service.day} Service`}
 </span>
 <span className="text-sm font-medium text-gray-600 ">
 {service.day}s at {service.time}
 </span>
 </div>
 ))}
 </div>
 );
 };

 return (
 <div className={`fixed inset-0 z-[9999] ${fullPage ? 'bg-[#f8f9fa] ' : 'flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm transition-opacity'}`}>
 <div 
 className={fullPage ? 'w-full h-full overflow-y-auto flex flex-col relative animate-fade-in' : 'bg-[#f8f9fa] w-full sm:w-[500px] h-[90vh] sm:h-auto sm:max-h-[90vh] rounded-t-3xl sm:rounded-3xl overflow-y-auto flex flex-col relative animate-slide-up sm:animate-fade-in'}
 >
 {/* Close Button */}
 <button 
 onClick={onClose}
 className="absolute top-4 right-4 z-50 w-10 h-10 bg-black/20 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-black/40 transition-colors"
 >
 <X size={20} />
 </button>

 {loading ? (
 <div className="flex-1 flex items-center justify-center min-h-[400px]">
 <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
 </div>
 ) : church ? (
 <div className="flex flex-col pb-8">
 {/* Header Image & Title */}
 <div className="relative h-72 w-full">
 <Image 
 src={church.imageUrl || getPlaceholderImage(church.id, 800, 600)} 
 alt={church.name}
 fill
 sizes="100vw"
 className="object-cover"
 referrerPolicy="no-referrer"
 />
 <div className="absolute inset-0 bg-gradient-to-t from-[#111827] via-[#111827]/60 to-transparent" />
 
 <div className="absolute bottom-12 left-0 w-full p-6 text-white">
 <h2 className="text-5xl font-bold mb-2 italic">{church.name}</h2>
 <div className="flex items-center gap-2 text-sm text-gray-200">
 <MapPin size={16} />
 <span>
 {church.street} {church.number && church.number !== '' ? church.number : ''}
 {church.street ? ', ' : ''}
 {church.city}
 </span>
 </div>
 </div>
 </div>

 <div className="px-4 -mt-8 relative z-10 space-y-4">
   {/* Tab Buttons */}
   <div className="flex gap-2 bg-white rounded-2xl p-1.5 shadow-sm border border-gray-100">
     <button
       onClick={() => setActiveTab('announcements')}
       className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-colors ${
         activeTab === 'announcements'
           ? 'bg-[#1e3a8a] text-white shadow-sm'
           : 'text-gray-500 hover:text-gray-700'
       }`}
     >
       <Megaphone size={16} />
       Announcements
     </button>
     <button
       onClick={() => setActiveTab('info')}
       className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-colors ${
         activeTab === 'info'
           ? 'bg-[#1e3a8a] text-white shadow-sm'
           : 'text-gray-500 hover:text-gray-700'
       }`}
     >
       <Info size={16} />
       Church Info
     </button>
   </div>

   {activeTab === 'announcements' ? (
     /* Announcements Tab */
     <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
       <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4">Announcements</h3>
       {loadingAnnouncements ? (
         <div className="flex justify-center py-8">
           <div className="w-6 h-6 border-4 border-[color-mix(in_srgb,var(--brand-color)_30%,transparent)] border-t-gold rounded-full animate-spin"></div>
         </div>
       ) : announcements.length === 0 ? (
         <div className="text-center py-8">
           <Megaphone size={32} className="mx-auto mb-3 text-gray-300" />
           <p className="text-sm text-gray-500">No announcements yet</p>
         </div>
       ) : (
         <div className="space-y-4">
           {announcements.map((a) => (
             <div key={a.id} className="border-b border-gray-100 last:border-0 pb-4 last:pb-0">
               <h4 className="font-bold text-gray-900 text-base">{a.title}</h4>
               <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{a.content}</p>
               {a.createdAt && (
                 <p className="text-xs text-gray-400 mt-2">
                   {new Date(a.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                 </p>
               )}
             </div>
           ))}
         </div>
       )}
     </div>
   ) : (
     /* Church Info Tab — existing content */
     <>
       {/* Service Details Card */}
       <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 ">
         <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-6">Service Details</h3>
                
         <div className="space-y-6">
           <div className="flex items-center gap-4">
             <div className="w-12 h-12 rounded-full bg-[#f3f4f6] flex items-center justify-center flex-shrink-0 text-[#1e293b] ">
               <User size={24} />
             </div>
             <div>
               <p className="text-sm text-gray-600 ">Lead Pastor:</p>
               <p className="font-bold text-lg text-gray-900 ">{church.pastorName || 'Not specified'}</p>
             </div>
           </div>

           <div className="flex items-start gap-4">
             <div className="w-12 h-12 rounded-full bg-[#f3f4f6] flex items-center justify-center flex-shrink-0 text-[#1e293b] ">
               <Clock size={24} />
             </div>
             <div className="flex-1">
               <p className="text-sm text-gray-600 mb-1">Service Schedule:</p>
               <div className="text-base text-gray-900 ">{formatServices(church.services || [])}</div>
             </div>
           </div>
         </div>
       </div>

       {/* Connect Card */}
       <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 ">
         <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-6">Connect</h3>
                
         <div className="space-y-4">
           {church.contactEmail && (
             <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
               <div className="flex items-center gap-4 overflow-hidden">
                 <Mail size={24} className="text-gray-400 flex-shrink-0" />
                 <span className="text-base text-gray-800 truncate">{church.contactEmail}</span>
               </div>
               <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                 <button 
                   onClick={() => handleCopy(church.contactEmail!, 'email')}
                   className="w-10 h-10 rounded-xl bg-[#f3f4f6] flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors"
                 >
                   {copiedEmail ? <CheckCircle2 size={18} className="text-green-500" /> : <Copy size={18} />}
                 </button>
               </div>
             </div>
           )}

           {church.contactPhone && (
             <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
               <div className="flex items-center gap-4 overflow-hidden">
                 <Phone size={24} className="text-gray-400 flex-shrink-0" />
                 <span className="text-base text-gray-800 truncate">{church.contactPhone}</span>
               </div>
               <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                 <button 
                   onClick={() => handleCopy(church.contactPhone!, 'phone')}
                   className="w-10 h-10 rounded-xl bg-[#f3f4f6] flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors"
                 >
                   {copiedPhone ? <CheckCircle2 size={18} className="text-green-500" /> : <Copy size={18} />}
                 </button>
               </div>
             </div>
           )}
         </div>
       </div>

       {/* Action Buttons Card */}
       <div className="bg-white rounded-3xl p-4 shadow-sm border border-gray-100 flex items-center justify-between">
         <div className="flex items-center gap-4">
           {church.facebook && (
             <a 
               href={church.facebook}
               target="_blank"
               rel="noopener noreferrer"
               className="w-12 h-12 rounded-full bg-[#1877F2] flex items-center justify-center text-white hover:opacity-90 transition-opacity shadow-md shadow-[#1877F2]/30"
             >
               <Facebook size={24} />
             </a>
           )}
           {church.instagram && (
             <a 
               href={`https://instagram.com/${church.instagram.replace('@', '')}`}
               target="_blank"
               rel="noopener noreferrer"
               className="w-12 h-12 rounded-full bg-gradient-to-tr from-[#f09433] via-[#dc2743] to-[#bc1888] flex items-center justify-center text-white hover:opacity-90 transition-opacity shadow-md shadow-[#dc2743]/30"
             >
               <Instagram size={24} />
             </a>
           )}
           {church.website && (
             <a 
               href={church.website}
               target="_blank"
               rel="noopener noreferrer"
               className="w-12 h-12 rounded-full bg-[#f1f5f9] flex items-center justify-center text-[#0f172a] hover:bg-gray-200 transition-colors"
             >
               <Globe size={24} />
             </a>
           )}
         </div>

         <button 
           onClick={openDirections}
           className="px-6 h-12 rounded-full bg-[#1e3a8a] flex items-center justify-center text-white font-bold hover:bg-[#172554] transition-colors shadow-sm"
           title="Directions"
         >
           Directions
         </button>
       </div>
     </>
   )}

   {isHomeChurch && onRemoveHomeChurch && (
     <div className="flex justify-center mt-8 mb-6">
       <button 
         onClick={() => {
           onRemoveHomeChurch();
           onClose();
         }}
         className="flex items-center gap-2 text-[#9f1239] hover:text-[#e11d48] font-medium transition-colors"
       >
         Remove Church <Trash2 size={18} />
       </button>
     </div>
   )}
 </div>
 </div>
 ) : (
 <div className="flex-1 flex items-center justify-center min-h-[400px]">
 <p className="text-gray-500">Church not found.</p>
 </div>
 )}
 </div>
 </div>
 );
};

export default ChurchDetailsModal;
