"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { ArrowLeft, Eye, Users, HeartHandshake } from 'lucide-react';
import { auth, db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

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
          const q = query(collection(db, 'users'), where('email', '==', 'bumbmatei@gmail.com'));
          const querySnapshot = await getDocs(q);
          if (!querySnapshot.empty) {
            const userData = querySnapshot.docs[0].data();
            if (userData.photoURL) {
              setMateiPic(userData.photoURL);
            }
          }
        } catch (error) {
          console.error("Error fetching Matei's profile picture:", error);
        }
      };
      fetchMateiPic();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#f8f9fa] dark:bg-[#1a1d27] animate-in slide-in-from-bottom-full duration-300 overflow-hidden">
      {/* Header */}
      <div className="flex items-center px-4 py-4 bg-white dark:bg-[#1a1d27] border-b border-gray-100 dark:border-gray-800 sticky top-0 z-10">
        <button onClick={onClose} className="p-2 -ml-2 text-gray-600 dark:text-gray-300">
          <ArrowLeft size={24} />
        </button>
        <h2 className="text-lg font-bold text-gray-900 dark:text-white flex-1 text-center pr-8">About Us</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-8 pb-12">
        {/* The Vision */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-[#fdf8e7] dark:bg-yellow-900/30 flex items-center justify-center">
              <Eye size={20} className="text-[#d4a017]" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white">The Vision</h3>
          </div>
          
          <div className="bg-white dark:bg-[#252a36] rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-gray-800">
            <h4 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              The Digital Foundation for the Great Commission
            </h4>
            
            <div className="space-y-4 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              <p>
                Every week, hundreds of thousands of people across the globe raise their hands to accept Jesus as their Savior. This unprecedented momentum is a glorious sign of our times. However, our hearts are focused on a vital question: <strong className="text-gray-900 dark:text-white">&quot;What is the retention percentage?&quot;</strong>
              </p>
              <p>
                How many of these precious souls remain in Christ? How many grow to full maturity and go on to fulfill the Great Commandment?
              </p>
              <p>
                We believe that effective discipling is the fastest way to multiply the Church. To sustain this move of God, we must steward the soul as passionately as we seek it. The Harvest App was born from a burden to close the &quot;back door&quot; of the church and provide a digital bridge from the moment of conversion to a lifetime of community.
              </p>
              
              <div className="pl-4 border-l-4 border-[#fdf8e7] dark:border-[#d4a017]/30 italic text-gray-700 dark:text-gray-400 mt-6">
                Our mission is to provide the infrastructure for a Billion Soul Harvest and beyond. We are building a journey that takes the believer from a child in Christ to a mature disciple, ready to serve and lead. Through structured curriculum, theologically sound AI guidance, and direct connection to local church bodies, we are ensuring that no one has to walk their new life alone.
              </div>
            </div>
          </div>
        </div>

        {/* About Us */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
              <Users size={20} className="text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white">About Us</h3>
          </div>
          
          <div className="bg-white dark:bg-[#252a36] rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-gray-800">
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed mb-6">
              The team behind Harvest is a collection of passionate believers, creators, and engineers dedicated to bridging the gap between technology and faith.
            </p>
            
            <div className="bg-[#f8f9fa] dark:bg-[#1a1d27] rounded-2xl p-4 flex items-center gap-4">
              <div className="w-14 h-14 rounded-full overflow-hidden bg-gray-200 flex-shrink-0 relative">
                {mateiPic ? (
                  <Image src={mateiPic} alt="Matei Bumb" fill className="object-cover" sizes="56px" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400 font-bold text-xl">
                    MB
                  </div>
                )}
              </div>
              <div>
                <h5 className="font-bold text-gray-900 dark:text-white">Matei Bumb</h5>
                <p className="text-[10px] font-bold text-[#d4a017] tracking-wider uppercase mt-0.5">President of Harvest</p>
              </div>
            </div>
          </div>
        </div>

        {/* Partner with Us */}
        <div className="bg-[#1e2330] rounded-3xl p-6 text-center shadow-sm">
          <h3 className="text-xl font-bold text-white mb-3">Partner with Us</h3>
          <p className="text-sm text-gray-300 mb-6 leading-relaxed">
            Join our mission to keep spiritual growth tools accessible to everyone, everywhere. Your partnership makes this possible.
          </p>
          <button 
            onClick={onOpenPartner}
            className="w-full bg-[#d4a017] hover:bg-[#b8860b] text-white font-bold py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors"
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
