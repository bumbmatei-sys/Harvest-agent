import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { X, MapPin, User, Clock, Mail, Phone, Globe, Facebook, Instagram, Navigation, Copy, CheckCircle2, Trash2 } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
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

 useEffect(() => {
 const fetchChurch = async () => {
 if (!churchId || !isOpen) return;
 
 setLoading(true);
 setChurch(null);
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
 if (!services || services.length === 0) return <span className="text-warm-brown">No schedule available</span>;
 
 return (
 <div className="flex flex-col gap-3 mt-1">
 {services.map((service, idx) => (
 <div key={idx} className="flex flex-col">
 <span className="font-bold text-earth ">
 {service.name || `${service.day} Service`}
 </span>
 <span className="text-sm font-medium text-warm-brown ">
 {service.day}s at {service.time}
 </span>
 </div>
 ))}
 </div>
 );
 };

 return (
 <div className={`fixed inset-0 z-[9999] ${fullPage ? 'bg-cream ' : 'flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm transition-opacity'}`}>
 <div 
 className={fullPage ? 'w-full h-full overflow-y-auto flex flex-col relative animate-fade-in' : 'bg-cream w-full sm:w-[500px] h-[90vh] sm:h-auto sm:max-h-[90vh] rounded-t-3xl sm:rounded-3xl overflow-y-auto flex flex-col relative animate-slide-up sm:animate-fade-in'}
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
 <div className="absolute inset-0 bg-gradient-to-t from-[#2D2519] via-[#2D2519]/60 to-transparent" />
 
 <div className="absolute bottom-12 left-0 w-full p-6 text-white">
 <h2 className="text-5xl font-bold mb-2 italic font-display">{church.name}</h2>
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
       {/* Service Details Card */}
       <div className="bg-white rounded-3xl p-6 shadow-sm border border-stone-200 ">
         <h3 className="text-sm font-bold text-earth uppercase tracking-wider mb-6">Service Details</h3>
                
         <div className="space-y-6">
           <div className="flex items-center gap-4">
             <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center flex-shrink-0 text-[#1e293b] ">
               <User size={24} />
             </div>
             <div>
               <p className="text-sm text-warm-brown ">Lead Pastor:</p>
               <p className="font-bold text-lg text-earth ">{church.pastorName || 'Not specified'}</p>
             </div>
           </div>

           <div className="flex items-start gap-4">
             <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center flex-shrink-0 text-[#1e293b] ">
               <Clock size={24} />
             </div>
             <div className="flex-1">
               <p className="text-sm text-warm-brown mb-1">Service Schedule:</p>
               <div className="text-base text-earth ">{formatServices(church.services || [])}</div>
             </div>
           </div>
         </div>
       </div>

       {/* Connect Card */}
       <div className="bg-white rounded-3xl p-6 shadow-sm border border-stone-200 ">
         <h3 className="text-sm font-bold text-earth uppercase tracking-wider mb-6">Connect</h3>
                
         <div className="space-y-4">
           {church.contactEmail && (
             <div className="flex items-center justify-between py-3 border-b border-stone-200 last:border-0">
               <div className="flex items-center gap-4 overflow-hidden">
                 <Mail size={24} className="text-[color:var(--text-faint)] flex-shrink-0" />
                 <span className="text-base text-[color:var(--text-body)] truncate">{church.contactEmail}</span>
               </div>
               <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                 <button 
                   onClick={() => handleCopy(church.contactEmail!, 'email')}
                   className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center text-warm-brown hover:bg-stone-200 transition-colors"
                 >
                   {copiedEmail ? <CheckCircle2 size={18} className="text-green-500" /> : <Copy size={18} />}
                 </button>
               </div>
             </div>
           )}

           {church.contactPhone && (
             <div className="flex items-center justify-between py-3 border-b border-stone-200 last:border-0">
               <div className="flex items-center gap-4 overflow-hidden">
                 <Phone size={24} className="text-[color:var(--text-faint)] flex-shrink-0" />
                 <span className="text-base text-[color:var(--text-body)] truncate">{church.contactPhone}</span>
               </div>
               <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                 <button 
                   onClick={() => handleCopy(church.contactPhone!, 'phone')}
                   className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center text-warm-brown hover:bg-stone-200 transition-colors"
                 >
                   {copiedPhone ? <CheckCircle2 size={18} className="text-green-500" /> : <Copy size={18} />}
                 </button>
               </div>
             </div>
           )}
         </div>
       </div>

       {/* Action Buttons Card */}
       <div className="bg-white rounded-3xl p-4 shadow-sm border border-stone-200 flex items-center justify-between">
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
               className="w-12 h-12 rounded-full bg-[#f1f5f9] flex items-center justify-center text-[#0f172a] hover:bg-stone-200 transition-colors"
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
 <p className="text-warm-brown">Church not found.</p>
 </div>
 )}
 </div>
 </div>
 );
};

export default ChurchDetailsModal;
