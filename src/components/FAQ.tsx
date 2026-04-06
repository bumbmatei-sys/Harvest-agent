"use client";
import React, { useState } from 'react';

interface FAQProps {
 onBack: () => void;
}

const FAQ: React.FC<FAQProps> = ({ onBack }) => {
 const [openIndex, setOpenIndex] = useState<number | null>(null);

 const toggle = (index: number) => {
 setOpenIndex(openIndex === index ? null : index);
 };

 const faqs = [
 {
 question: "What is the primary goal of the Harvest App?",
 answer: "The Harvest App is designed to bridge the gap between a person’s initial decision for Christ and their journey toward spiritual maturity. Our goal is to provide every new believer with a digital foundation that leads them into a healthy local church community and a deep, personal relationship with the Holy Spirit."
 },
 {
 question: "Is the app really free?",
 answer: "Yes. We believe that discipleship resources should be accessible to everyone, everywhere, regardless of their financial situation. The core curriculum, Harvest AI, and the Church Map are 100% free for the user. This is made possible by the generosity of partners who believe in the Billion Soul Harvest."
 },
 {
 question: "How does Harvest AI work?",
 answer: "Harvest AI is a specialized companion designed to answer the questions of \"baby Christians\" in a safe, biblically sound environment. Unlike generic AI tools, Harvest AI is locally trained using healthy, trusted theological resources. We have carefully curated the data it learns from to ensure it provides life-giving, orthodox answers. Its primary function is to point users back to the Word of God, the Holy Spirit, and the local church."
 },
 {
 question: "Is my data safe with the AI?",
 answer: "Absolutely. We prioritize your privacy. Your interactions with Harvest AI are used solely to help you grow and to improve the accuracy of the theological guidance provided. We never sell your data to third parties."
 },
 {
 question: "How does the Discipleship Curriculum work?",
 answer: (
 <div>
 <p className="mb-4">The curriculum is divided into four levels:</p>
 <ul className="list-disc pl-5 space-y-2 mb-4 bg-gray-50 p-4 rounded-xl border border-gray-100">
 <li><strong className="text-gray-900">Level 1:</strong> The Foundations (New Life in Christ)</li>
 <li><strong className="text-gray-900">Level 2:</strong> Walking in the Spirit</li>
 <li><strong className="text-gray-900">Level 3:</strong> Character & The Word</li>
 <li><strong className="text-gray-900">Level 4:</strong> Commissioned to Serve</li>
 </ul>
 <p>As you progress through videos and infographics, you unlock new modules and deeper content.</p>
 </div>
 )
 },
 {
 question: "I lead a church or ministry. How can we be visible on the Map?",
 answer: "We welcome biblically-based churches and ministries (such as partners of CfaN, Mattheus Ministry, and others) to join our global network. You can enroll through our Church Partner Portal. Once verified, your location will be visible to new converts in your immediate area, helping them find their spiritual family."
 },
 {
 question: "Can I use the app if I am already a mature Christian?",
 answer: "While the app is optimized for new converts, the resources, Bible integration, and prayer lines are valuable for any believer looking to strengthen their foundation or help others grow."
 }
 ];

 return (
 <div className="min-h-screen bg-background-light pt-32 pb-16">
 <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
 <button 
 onClick={onBack}
 className="flex items-center gap-2 text-gray-600 hover:text-primary transition-colors mb-8 font-medium"
 >
 <span className="material-symbols-outlined">arrow_back</span>
 Back to Home
 </button>

 <h1 className="text-4xl font-black text-background-dark mb-10">Frequently Asked Questions</h1>
 
 <div className="space-y-4">
 {faqs.map((faq, index) => (
 <div key={index} className="border border-gray-200 rounded-2xl bg-white overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-300">
 <button 
 className="w-full px-6 py-5 text-left flex justify-between items-center bg-white focus:outline-none hover:bg-gray-50 transition-colors"
 onClick={() => toggle(index)}
 >
 <span className="font-bold text-lg text-gray-900 pr-8 leading-snug">{faq.question}</span>
 <span className={`material-symbols-outlined text-gray-400 shrink-0 transition-transform duration-300 ${openIndex === index ? 'rotate-180 text-primary' : ''}`}>expand_more</span>
 </button>
 <div 
 className={`transition-all duration-300 ease-in-out overflow-hidden ${openIndex === index ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0'}`}
 >
 <div className="px-6 pb-6 text-gray-600 leading-relaxed border-t border-gray-100 pt-4">
 {faq.answer}
 </div>
 </div>
 </div>
 ))}
 </div>
 </div>
 </div>
 );
};

export default FAQ;