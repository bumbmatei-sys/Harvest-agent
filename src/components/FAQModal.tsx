"use client";
import React, { useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { MEMBER_FAQS } from '../lib/member-faqs';

interface FAQModalProps {
 isOpen: boolean;
 onClose: () => void;
}

const FAQItem: React.FC<{
 question: string;
 answer: readonly string[];
 isOpen: boolean;
 onToggle: () => void;
}> = ({
 question,
 answer,
 isOpen,
 onToggle
}) => {
 return (
 <div className="bg-surface-raised rounded-2xl shadow-sm border border-line overflow-hidden mb-4 transition-all duration-300">
 <button
 onClick={onToggle}
 className="w-full flex items-center justify-between p-5 text-left hover:bg-surface-sunken transition-colors"
 >
 <h4 className="text-sm font-bold text-strong pr-4">{question}</h4>
 {isOpen ? (
 <ChevronUp size={20} className="text-gold flex-shrink-0" />
 ) : (
 <ChevronDown size={20} className="text-gold flex-shrink-0" />
 )}
 </button>

 {isOpen && (
 <div className="px-5 pb-5 text-sm text-muted leading-relaxed animate-in slide-in-from-top-2 duration-200">
 {answer.map((paragraph, i) => (
 <p key={i} className={i < answer.length - 1 ? 'mb-3' : undefined}>{paragraph}</p>
 ))}
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

 // Content lives in src/lib/member-faqs.ts — see the header there before
 // editing an answer. Every entry is verifiable against named source files,
 // and nothing about price, plans or billing belongs in it.
 const faqs = MEMBER_FAQS;

 return (
 <div className="fixed inset-0 z-50 flex flex-col bg-surface animate-in slide-in-from-bottom-full duration-300 overflow-hidden">
 {/* Header */}
 <div className="flex items-center px-4 py-4 bg-surface-raised border-b border-line sticky top-0 z-10">
 <button onClick={onClose} className="p-2 -ml-2 text-muted ">
 <ArrowLeft size={24} />
 </button>
 <h2 className="text-lg font-bold text-strong flex-1 text-center pr-8 font-display">FAQ</h2>
 </div>

 <div className="flex-1 overflow-y-auto p-4 pb-12">
 <div className="text-center mb-8 mt-4">
 <h2 className="text-2xl font-bold text-strong mb-2 font-display">Frequently Asked Questions</h2>
 <p className="text-muted text-sm">Using your ministry&apos;s workspace on Harvest.</p>
 </div>

 <div className="space-y-4">
 {faqs.map((faq, index) => (
 <FAQItem
 key={faq.question}
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
