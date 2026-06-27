"use client";
import React, { useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';

interface FAQModalProps {
 isOpen: boolean;
 onClose: () => void;
}

const FAQItem: React.FC<{ 
 question: string; 
 answer: React.ReactNode; 
 isOpen: boolean; 
 onToggle: () => void; 
}> = ({ 
 question, 
 answer, 
 isOpen, 
 onToggle 
}) => {
 return (
 <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-4 transition-all duration-300">
 <button 
 onClick={onToggle}
 className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-50 :bg-gray-800/50 transition-colors"
 >
 <h4 className="text-sm font-bold text-gray-900 pr-4">{question}</h4>
 {isOpen ? (
 <ChevronUp size={20} className="text-gold flex-shrink-0" />
 ) : (
 <ChevronDown size={20} className="text-gold flex-shrink-0" />
 )}
 </button>
 
 {isOpen && (
 <div className="px-5 pb-5 text-sm text-gray-600 leading-relaxed animate-in slide-in-from-top-2 duration-200">
 {answer}
 </div>
 )}
 </div>
 );
};

const FAQModal: React.FC<FAQModalProps> = ({ isOpen, onClose }) => {
 const [openIndex, setOpenIndex] = useState<number | null>(null);

 if (!isOpen) return null;

 const toggleItem = (index: number) => {
 if (openIndex === index) {
 setOpenIndex(null);
 } else {
 setOpenIndex(index);
 }
 };

 const faqs = [
 {
 question: "What is the primary goal of the Harvest App?",
 answer: "The Harvest App is designed to bridge the gap between a person's initial decision for Christ and their journey toward spiritual maturity. Our goal is to provide every new believer with a digital foundation that leads them into a healthy local church community and a deep, personal relationship with the Holy Spirit."
 },
 {
 question: "Is the app really free?",
 answer: "Yes. We believe that discipleship resources should be accessible to everyone, everywhere, regardless of their financial situation. The core curriculum, Harvest AI, and the Church Map are 100% free for the user. This is made possible by the generosity of partners who believe in the Billion Soul Harvest."
 },
 {
 question: "How does Harvest AI work?",
 answer: (
 <>
 Harvest AI is a specialized companion designed to answer the questions of &quot;baby Christians&quot; in a safe, biblically sound environment. Unlike generic AI tools, <strong className="text-gray-900 ">Harvest AI is locally trained using healthy, trusted theological resources.</strong> We have carefully curated the data it learns from to ensure it provides life-giving, orthodox answers. Its primary function is to point users back to the Word of God, the Holy Spirit, and the local church.
 </>
 )
 },
 {
 question: "Is my data safe with the AI?",
 answer: "Absolutely. We prioritize your privacy. Your interactions with Harvest AI are used solely to help you grow and to improve the accuracy of the theological guidance provided. We never sell your data to third parties."
 },
 {
 question: "How does the Discipleship Curriculum work?",
 answer: (
 <>
 <p className="mb-3">The curriculum is divided into four levels:</p>
 <ul className="space-y-2 mb-3 pl-2">
 <li><strong className="text-gray-900 ">Level 1:</strong> The Foundations (New Life in Christ)</li>
 <li><strong className="text-gray-900 ">Level 2:</strong> Walking in the Spirit</li>
 <li><strong className="text-gray-900 ">Level 3:</strong> Character & The Word</li>
 <li><strong className="text-gray-900 ">Level 4:</strong> Commissioned to Serve</li>
 </ul>
 <p>As you progress through videos and infographics, you unlock new modules and deeper content.</p>
 </>
 )
 },
 {
 question: "I lead a church or ministry. How can we be visible on the Map?",
 answer: (
 <>
 We welcome biblically-based churches and ministries to join our global network. You can enroll through our <strong className="text-gray-900 ">Church Partner Portal</strong>. Once verified, your location will be visible to new converts in your immediate area, helping them find their spiritual family.
 </>
 )
 },
 {
 question: "Can I use the app if I am already a mature Christian?",
 answer: "While the app is optimized for new converts, the resources, Bible integration, and prayer lines are valuable for any believer looking to strengthen their foundation or help others grow."
 }
 ];

 return (
 <div className="fixed inset-0 z-50 flex flex-col bg-[#f8f9fa] animate-in slide-in-from-bottom-full duration-300 overflow-hidden">
 {/* Header */}
 <div className="flex items-center px-4 py-4 bg-white border-b border-gray-100 sticky top-0 z-10">
 <button onClick={onClose} className="p-2 -ml-2 text-gray-600 ">
 <ArrowLeft size={24} />
 </button>
 <h2 className="text-lg font-bold text-gray-900 flex-1 text-center pr-8">FAQ</h2>
 </div>

 <div className="flex-1 overflow-y-auto p-4 pb-12">
 <div className="text-center mb-8 mt-4">
 <h2 className="text-2xl font-bold text-[#1a202c] mb-2">Frequently Asked Questions</h2>
 <p className="text-gray-500 text-sm">Everything you need to know about the Harvest App.</p>
 </div>

 <div className="space-y-4">
 {faqs.map((faq, index) => (
 <FAQItem
 key={index}
 question={faq.question}
 answer={faq.answer}
 isOpen={openIndex === index}
 onToggle={() => toggleItem(index)}
 />
 ))}
 </div>
 </div>
 </div>
 );
};

export default FAQModal;