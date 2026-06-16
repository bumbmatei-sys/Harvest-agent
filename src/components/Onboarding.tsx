"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { auth, db } from '../firebase';
import { doc, updateDoc, getDoc, setDoc } from 'firebase/firestore';
import CountrySelect from './CountrySelect';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope } from '../utils/tenant-scope';


interface OnboardingQuestion {
  id: string;
  label: string;
  type: 'text' | 'select' | 'radio' | 'textarea';
  options?: string[];
  required: boolean;
  order: number;
}

interface OnboardingProps {
 onComplete: () => void;
}

const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
 const [name, setName] = useState('');
 const [country, setCountry] = useState('');
 const [city, setCity] = useState('');
 const [phone, setPhone] = useState('');
  const [acceptedJesus, setAcceptedJesus] = useState('');
 const [loading, setLoading] = useState(false);
 const [gpsLoading, setGpsLoading] = useState(false);
 const [error, setError] = useState('');
 const [customQuestions, setCustomQuestions] = useState<OnboardingQuestion[]>([]);
 const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});

 useEffect(() => {
 // Pre-fill name if available from Google
 if (auth.currentUser?.displayName) {
 setName(auth.currentUser.displayName);
 }

 // Load custom onboarding questions from tenant config
 const loadCustomQuestions = async () => {
   try {
     const tenantId = await getTenantScope();
     if (tenantId) {
       const tenantDoc = await getDoc(doc(db, 'tenants', tenantId));
       if (tenantDoc.exists()) {
         const config = tenantDoc.data().config || {};
         if (config.onboardingQuestions && Array.isArray(config.onboardingQuestions)) {
           const questions = config.onboardingQuestions
             .filter((q: any) => q && q.id && q.label)
             .sort((a: any, b: any) => (a.order || 0) - (b.order || 0)) as OnboardingQuestion[];
           setCustomQuestions(questions);
           const initialAnswers: Record<string, string> = {};
           questions.forEach((q: OnboardingQuestion) => { initialAnswers[q.id] = ''; });
           setCustomAnswers(initialAnswers);
         }
       }
     }
   } catch (err) {
     console.error('Failed to load custom onboarding questions:', err);
   }
 };
 loadCustomQuestions();

 // Auto-attempt to get location
 if (navigator.geolocation) {
 setGpsLoading(true);
 navigator.geolocation.getCurrentPosition(
 async (position) => {
 try {
 const { latitude, longitude } = position.coords;
 const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
 const data = await response.json();
 
 if (data && data.address) {
 const foundCountry = data.address.country || '';
 const foundCity = data.address.city || data.address.town || data.address.village || data.address.county || '';
 
 if (foundCountry) setCountry(foundCountry);
 if (foundCity) setCity(foundCity);
 }
 } catch (err) {
 console.error("Error fetching location data:", err);
 } finally {
 setGpsLoading(false);
 }
 },
 (err) => {
 console.error("Geolocation error:", err);
 setGpsLoading(false);
 }
 );
 }
 }, []);

 const handleUseGPS = () => {
 if (!navigator.geolocation) {
 setError('Geolocation is not supported by your browser.');
 return;
 }

 setGpsLoading(true);
 setError('');

 navigator.geolocation.getCurrentPosition(
 async (position) => {
 try {
 const { latitude, longitude } = position.coords;
 const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
 const data = await response.json();
 
 if (data && data.address) {
 const foundCountry = data.address.country || '';
 const foundCity = data.address.city || data.address.town || data.address.village || data.address.county || '';
 
 if (foundCountry) setCountry(foundCountry);
 if (foundCity) setCity(foundCity);
 }
 } catch (err) {
 console.error("Error fetching location data:", err);
 setError('Failed to get location details from GPS.');
 } finally {
 setGpsLoading(false);
 }
 },
 (err) => {
 console.error("Geolocation error:", err);
 setError('Failed to get your location. Please ensure location permissions are granted.');
 setGpsLoading(false);
 }
 );
 };

 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();

 // Only validate default fields that are actually present in the questions list
 const hasDefault = (id: string) => customQuestions.some(q => q.id === id);
 if (hasDefault('default_name') && !name) { setError('Please fill in all fields.'); return; }
 if (hasDefault('default_country') && !country) { setError('Please fill in all fields.'); return; }
 if (hasDefault('default_city') && !city) { setError('Please fill in all fields.'); return; }
 if (hasDefault('default_phone') && !phone) { setError('Please fill in all fields.'); return; }
 if (hasDefault('default_accepted_jesus') && !acceptedJesus) { setError('Please fill in all fields.'); return; }

 // Check required custom questions
 for (const q of customQuestions) {
   if (q.required && !customAnswers[q.id]?.trim()) {
     setError(`Please fill in: ${q.label}`);
     return;
   }
 }

 try {
 setLoading(true);
 setError('');
 
 const user = auth.currentUser;
 if (!user) throw new Error('No user logged in');

 const userRef = doc(db, 'users', user.uid);
 const updateData: Record<string, any> = {
   displayName: name,
   country,
   city,
   phone,
   acceptedJesus: acceptedJesus === 'yes',
   onboardingCompleted: true,
 };

 // Save custom question answers if any exist
 if (customQuestions.length > 0 && Object.keys(customAnswers).some(k => customAnswers[k]?.trim())) {
   updateData.onboardingAnswers = customAnswers;
 }

 try {
 await setDoc(userRef, updateData, { merge: true });
 } catch (err) {
 try { handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`); } catch (e) { console.error(e); }
 return;
 }

 sessionStorage.setItem('pwa_prompt_ready', 'true');
window.dispatchEvent(new Event('onboardingComplete'));
onComplete();
 } catch (err: any) {
 console.error(err);
 setError(err.message || 'Failed to save information.');
 } finally {
 setLoading(false);
 }
 };

 const renderCustomQuestion = (question: OnboardingQuestion) => {
   const value = customAnswers[question.id] || '';

   switch (question.type) {
     case 'text':
       return (
         <input
           type="text"
           required={question.required}
           value={value}
           onChange={(e) => setCustomAnswers(prev => ({ ...prev, [question.id]: e.target.value }))}
           className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
           placeholder={question.label}
         />
       );
     case 'textarea':
       return (
         <textarea
           required={question.required}
           value={value}
           onChange={(e) => setCustomAnswers(prev => ({ ...prev, [question.id]: e.target.value }))}
           className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all resize-none"
           placeholder={question.label}
           rows={3}
         />
       );
     case 'select':
       return (
         <select
           required={question.required}
           value={value}
           onChange={(e) => setCustomAnswers(prev => ({ ...prev, [question.id]: e.target.value }))}
           className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all appearance-none"
         >
           <option value="" className="bg-gray-800">Select an option...</option>
           {(question.options || []).map((opt) => (
             <option key={opt} value={opt} className="bg-gray-800">{opt}</option>
           ))}
         </select>
       );
     case 'radio':
       return (
         <div className="flex gap-4 flex-wrap">
           {(question.options || []).map((opt) => (
             <label key={opt} className="flex-1 cursor-pointer min-w-[100px]">
               <input
                 type="radio"
                 name={`custom_${question.id}`}
                 value={opt}
                 checked={value === opt}
                 onChange={(e) => setCustomAnswers(prev => ({ ...prev, [question.id]: e.target.value }))}
                 className="peer sr-only"
                 required={question.required}
               />
               <div className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-center text-white peer-checked:bg-primary/20 peer-checked:border-primary peer-checked:text-primary transition-all font-semibold text-sm">
                 {opt}
               </div>
             </label>
           ))}
         </div>
       );
     default:
       return null;
   }
 };

 return (
 <div className="min-h-screen flex items-center justify-center bg-background-dark px-4 py-12 relative overflow-hidden">
 {/* Background Image & Overlay */}
 <div className="absolute inset-0 z-0">
 <Image 
 src="https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/No_people_just_2k_202512231746.jpeg" 
 alt="Harvest Background" 
 fill
 sizes="100vw"
 priority
 className="object-cover"
 />
 <div className="absolute inset-0 bg-gradient-to-b from-background-dark/80 via-background-dark/60 to-background-dark/95 mix-blend-multiply"></div>
 <div className="absolute inset-0 bg-black/40"></div>
 </div>

 <div className="max-w-md w-full bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl shadow-2xl overflow-hidden z-10 relative">
 <div className="p-8 sm:p-12">
 <div className="text-center mb-8">
 <h1 className="text-3xl font-black text-white mb-2">Let&apos;s get started!</h1>
 <p className="text-gray-300 text-sm mb-4">
 We need a little more info so you can get personalized announcements and posts based on your city.
 </p>
 <button
 type="button"
 onClick={handleUseGPS}
 disabled={gpsLoading}
 className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white text-sm font-medium py-2 px-4 rounded-full transition-colors disabled:opacity-50"
 >
 <span className="material-symbols-outlined text-sm">my_location</span>
 {gpsLoading ? 'Locating...' : 'Use my current location'}
 </button>
 </div>

 {error && (
 <div className="mb-6 p-4 bg-red-500/20 border-l-4 border-red-500 text-red-100 text-sm rounded backdrop-blur-sm">
 {error}
 </div>
 )}

 <form onSubmit={handleSubmit} className="space-y-5">

 {/* Default onboarding questions — rendered by known IDs */}
 {customQuestions.some(q => q.id === 'default_name') && (
   <div>
     <label className="block text-sm font-bold text-gray-200 mb-1">Full Name</label>
     <input type="text" required value={name} onChange={(e) => setName(e.target.value)}
       className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
       placeholder="John Doe" />
   </div>
 )}

 {customQuestions.some(q => q.id === 'default_country') && (
   <div className="relative z-50">
     <label className="block text-sm font-bold text-gray-200 mb-1">Country</label>
     <CountrySelect value={country} onChange={setCountry} className="w-full"
       buttonClassName="!bg-white/5 !border-white/20 !text-white focus:!ring-2 focus:!ring-primary focus:!border-primary !py-3 !rounded-xl" />
   </div>
 )}

 {customQuestions.some(q => q.id === 'default_city') && (
   <div className="relative z-40">
     <label className="block text-sm font-bold text-gray-200 mb-1">City</label>
     <input type="text" required value={city} onChange={(e) => setCity(e.target.value)}
       className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
       placeholder="e.g. London" />
   </div>
 )}

 {customQuestions.some(q => q.id === 'default_phone') && (
   <div className="relative z-30">
     <label className="block text-sm font-bold text-gray-200 mb-1">Phone Number</label>
     <input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)}
       className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
       placeholder="e.g. +1 234 567 8900" />
   </div>
 )}

 {customQuestions.some(q => q.id === 'default_accepted_jesus') && (
   <div className="relative z-30 mt-4">
     <label className="block text-sm font-bold text-gray-200 mb-2">Have you accepted Jesus?</label>
     <div className="flex gap-4">
       <label className="flex-1 cursor-pointer">
         <input type="radio" name="acceptedJesus" value="yes" checked={acceptedJesus === 'yes'} onChange={(e) => setAcceptedJesus(e.target.value)} className="peer sr-only" required />
         <div className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-center text-white peer-checked:bg-primary/20 peer-checked:border-primary peer-checked:text-primary transition-all font-semibold">Yes</div>
       </label>
       <label className="flex-1 cursor-pointer">
         <input type="radio" name="acceptedJesus" value="no" checked={acceptedJesus === 'no'} onChange={(e) => setAcceptedJesus(e.target.value)} className="peer sr-only" required />
         <div className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-center text-white peer-checked:bg-white/20 peer-checked:border-white/50 transition-all font-semibold">No</div>
       </label>
     </div>
   </div>
 )}

 {/* Custom Onboarding Questions (non-default) */}
 {customQuestions.filter(q => !q.id.startsWith('default_')).map((question) => (
   <div key={question.id} className="relative z-20">
     <label className="block text-sm font-bold text-gray-200 mb-1">
       {question.label}
       {question.required && <span className="text-red-400 ml-1">*</span>}
     </label>
     {renderCustomQuestion(question)}
   </div>
 ))}

 {/* Fallback: if no questions configured at all, show hardcoded defaults */}
 {customQuestions.length === 0 && (
   <>
     <div>
       <label className="block text-sm font-bold text-gray-200 mb-1">Full Name</label>
       <input type="text" required value={name} onChange={(e) => setName(e.target.value)}
         className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
         placeholder="John Doe" />
     </div>
     <div className="relative z-50">
       <label className="block text-sm font-bold text-gray-200 mb-1">Country</label>
       <CountrySelect value={country} onChange={setCountry} className="w-full"
         buttonClassName="!bg-white/5 !border-white/20 !text-white focus:!ring-2 focus:!ring-primary focus:!border-primary !py-3 !rounded-xl" />
     </div>
     <div className="relative z-40">
       <label className="block text-sm font-bold text-gray-200 mb-1">City</label>
       <input type="text" required value={city} onChange={(e) => setCity(e.target.value)}
         className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
         placeholder="e.g. London" />
     </div>
     <div className="relative z-30">
       <label className="block text-sm font-bold text-gray-200 mb-1">Phone Number</label>
       <input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)}
         className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
         placeholder="e.g. +1 234 567 8900" />
     </div>
     <div className="relative z-30 mt-4">
       <label className="block text-sm font-bold text-gray-200 mb-2">Have you accepted Jesus?</label>
       <div className="flex gap-4">
         <label className="flex-1 cursor-pointer">
           <input type="radio" name="acceptedJesus" value="yes" checked={acceptedJesus === 'yes'} onChange={(e) => setAcceptedJesus(e.target.value)} className="peer sr-only" required />
           <div className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-center text-white peer-checked:bg-primary/20 peer-checked:border-primary peer-checked:text-primary transition-all font-semibold">Yes</div>
         </label>
         <label className="flex-1 cursor-pointer">
           <input type="radio" name="acceptedJesus" value="no" checked={acceptedJesus === 'no'} onChange={(e) => setAcceptedJesus(e.target.value)} className="peer sr-only" required />
           <div className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-center text-white peer-checked:bg-white/20 peer-checked:border-white/50 transition-all font-semibold">No</div>
         </label>
       </div>
     </div>
   </>
 )}

 <button
 type="submit"
 disabled={loading}
 className="w-full bg-primary text-white font-bold py-3 px-4 rounded-xl hover:bg-yellow-600 transition-all duration-100 shadow-lg shadow-primary/30 disabled:opacity-50 mt-4"
 >
 {loading ? 'Saving...' : 'Continue'}
 </button>
 </form>
 </div>
 </div>
 </div>
 );
};

export default Onboarding;
