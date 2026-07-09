"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { ArrowLeft, Eye, Users, HeartHandshake } from 'lucide-react';
import { db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { SUPER_ADMIN_EMAIL } from '../utils/tenant-scope';

interface AboutUsModalProps {
 isOpen: boolean;
 onClose: () => void;
 onOpenPartner?: () => void;
}

const AboutUsModal: React.FC<AboutUsModalProps> = ({ isOpen, onClose, onOpenPartner }) => {
 const [mateiPic, setMateiPic] = useState<string | null>(null);

 useEffect(() => {
 if (isOpen) {
 const fetchMateiPic = async () => {
 try {
 const q = query(collection(db, 'users'), where('email', '==', SUPER_ADMIN_EMAIL));
 const querySnapshot = await getDocs(q);
 if (!querySnapshot.empty) {
 const userData = querySnapshot.docs[0].data();
 if (userData.photoURL) {
 setMateiPic(userData.photoURL);
 }
 }
 } catch (error) {
 handleFirestoreError(error, OperationType.GET, `users`);
 }
 };
 fetchMateiPic();
 }
 }, [isOpen]);

 if (!isOpen) return null;

 return (
 <div className="fixed inset-0 z-50 flex flex-col bg-cream animate-in slide-in-from-bottom-full duration-300 overflow-hidden">
 {/* Header */}
 <div className="flex items-center px-4 py-4 bg-white border-b border-stone-200 sticky top-0 z-10">
 <button onClick={onClose} className="p-2 -ml-2 text-warm-brown ">
 <ArrowLeft size={24} />
 </button>
 <h2 className="text-lg font-bold text-earth flex-1 text-center pr-8 font-display">About Us</h2>
 </div>

 <div className="flex-1 overflow-y-auto p-4 space-y-8 pb-12">
 {/* The Vision */}
 <div>
 <div className="flex items-center gap-3 mb-4">
 <div className="w-10 h-10 rounded-full bg-[color-mix(in_srgb,var(--brand-color)_12%,white)] flex items-center justify-center">
 <Eye size={20} className="text-gold" />
 </div>
 <h3 className="text-xl font-bold text-earth font-display">The Vision</h3>
 </div>
 
 <div className="bg-white rounded-3xl p-6 shadow-sm border border-stone-200 ">
 <h4 className="text-lg font-bold text-earth mb-4 font-display">
 The Digital Foundation for the Great Commission
 </h4>
 
 <div className="space-y-4 text-sm text-warm-brown leading-relaxed">
 <p>
 Every week, hundreds of thousands of people across the globe raise their hands to accept Jesus as their Savior. This unprecedented momentum is a glorious sign of our times. However, our hearts are focused on a vital question: <strong className="text-earth ">&quot;What is the retention percentage?&quot;</strong>
 </p>
 <p>
 How many of these precious souls remain in Christ? How many grow to full maturity and go on to fulfill the Great Commandment?
 </p>
 <p>
 We believe that effective discipling is the fastest way to multiply the Church. To sustain this move of God, we must steward the soul as passionately as we seek it. The Harvest App was born from a burden to close the &quot;back door&quot; of the church and provide a digital bridge from the moment of conversion to a lifetime of community.
 </p>
 
 <div className="pl-4 border-l-4 border-[color-mix(in_srgb,var(--brand-color)_20%,white)] italic text-[color:var(--text-body)] mt-6">
 Our mission is to provide the infrastructure for a Billion Soul Harvest and beyond. We are building a journey that takes the believer from a child in Christ to a mature disciple, ready to serve and lead. Through structured curriculum, theologically sound AI guidance, and direct connection to local church bodies, we are ensuring that no one has to walk their new life alone.
 </div>
 </div>
 </div>
 </div>

 {/* About Us */}
 <div>
 <div className="flex items-center gap-3 mb-4">
 <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center">
 <Users size={20} className="text-blue-600 " />
 </div>
 <h3 className="text-xl font-bold text-earth font-display">About Us</h3>
 </div>
 
 <div className="bg-white rounded-3xl p-6 shadow-sm border border-stone-200 ">
 <p className="text-sm text-warm-brown leading-relaxed mb-6">
 The team behind Harvest is a collection of passionate believers, creators, and engineers dedicated to bridging the gap between technology and faith.
 </p>
 
 <div className="bg-cream rounded-2xl p-4 flex items-center gap-4">
 <div className="w-14 h-14 rounded-full overflow-hidden bg-stone-200 flex-shrink-0 relative">
 {mateiPic ? (
 <Image src={mateiPic} alt="Matei Bumb" fill className="object-cover" sizes="56px" />
 ) : (
 <div className="w-full h-full flex items-center justify-center text-[color:var(--text-faint)] font-bold text-xl">
 MB
 </div>
 )}
 </div>
 <div>
 <h5 className="font-bold text-earth ">Matei Bumb</h5>
 <p className="text-[10px] font-bold text-gold tracking-wider uppercase mt-0.5">President of Harvest</p>
 </div>
 </div>
 </div>
 </div>

 {/* Partner with Us */}
 <div className="bg-[#1e2330] rounded-3xl p-6 text-center shadow-sm">
 <h3 className="text-xl font-bold text-white mb-3 font-display">Partner with Us</h3>
 <p className="text-sm text-stone-300 mb-6 leading-relaxed">
 Join our mission to keep spiritual growth tools accessible to everyone, everywhere. Your partnership makes this possible.
 </p>
 <button 
 onClick={onOpenPartner}
 className="w-full bg-gold hover:bg-[color-mix(in_srgb,var(--brand-color)_85%,black)] text-white font-bold py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors"
 >
 <HeartHandshake size={20} />
 Partner Today
 </button>
 </div>
 </div>
 </div>
 );
};

export default AboutUsModal;
