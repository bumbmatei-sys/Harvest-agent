"use client";
import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';

interface PrivacyTermsModalProps {
 isOpen: boolean;
 onClose: () => void;
}

const PrivacyTermsModal: React.FC<PrivacyTermsModalProps> = ({ isOpen, onClose }) => {
 const [activeTab, setActiveTab] = useState<'privacy' | 'terms'>('privacy');

 if (!isOpen) return null;

 return (
 <div className="fixed inset-0 z-50 flex flex-col bg-[#f8f9fa] animate-in slide-in-from-bottom-full duration-300 overflow-hidden">
 {/* Header */}
 <div className="flex items-center px-4 py-4 bg-white border-b border-gray-100 sticky top-0 z-10">
 <button onClick={onClose} className="p-2 -ml-2 text-gray-600 ">
 <ArrowLeft size={24} />
 </button>
 <h2 className="text-lg font-bold text-gray-900 flex-1 text-center pr-8 font-display">Privacy & Terms</h2>
 </div>

 <div className="flex-1 overflow-y-auto p-4 pb-12">
 {/* Tabs */}
 <div className="flex bg-white rounded-2xl p-1 mb-6 shadow-sm border border-gray-100 ">
 <button
 onClick={() => setActiveTab('privacy')}
 className={`flex-1 py-3 text-sm font-bold rounded-xl transition-colors ${
 activeTab === 'privacy'
 ? 'bg-[color-mix(in_srgb,var(--brand-color)_12%,white)] text-gold'
 : 'text-gray-500 hover:text-gray-700 :text-gray-300'
 }`}
 >
 Privacy Policy
 </button>
 <button
 onClick={() => setActiveTab('terms')}
 className={`flex-1 py-3 text-sm font-bold rounded-xl transition-colors ${
 activeTab === 'terms'
 ? 'bg-[color-mix(in_srgb,var(--brand-color)_12%,white)] text-gold'
 : 'text-gray-500 hover:text-gray-700 :text-gray-300'
 }`}
 >
 Terms of Use
 </button>
 </div>

 {/* Content */}
 <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 ">
 {activeTab === 'privacy' ? (
 <div className="space-y-6 text-sm text-gray-600 leading-relaxed animate-in fade-in duration-300">
 <div>
 <h3 className="text-xl font-bold text-gray-900 mb-1">Privacy Policy</h3>
 <p className="text-xs text-gray-500 ">Last Updated: December 2025</p>
 </div>

 <div>
 <h4 className="text-base font-bold text-gray-900 mb-2">Our Commitment to Your Journey</h4>
 <p>
 Harvest App is committed to protecting the privacy and spiritual journey of every user. This policy outlines how we collect, use, and safeguard your information as you grow in Christ.
 </p>
 </div>

 <div>
 <h4 className="text-base font-bold text-gray-900 mb-2">Information We Collect</h4>
 <ul className="space-y-3 list-disc pl-4 marker:text-gray-300 :text-gray-600">
 <li>
 <strong className="text-gray-900 ">Account Information:</strong> Name, email address, and basic profile details provided during registration.
 </li>
 <li>
 <strong className="text-gray-900 ">Spiritual Progress:</strong> Data regarding your progress in all courses to help you pick up where you left off.
 </li>
 <li>
 <strong className="text-gray-900 ">Location Data:</strong> With your permission, we use your GPS location solely to display the closest registered churches and communities on our map.
 </li>
 <li>
 <strong className="text-gray-900 ">AI Interactions:</strong> Conversations with the Harvest AI are processed to provide theological guidance. These interactions are stored to improve the AI&apos;s accuracy and are never sold to third parties.
 </li>
 </ul>
 </div>

 <div>
 <h4 className="text-base font-bold text-gray-900 mb-2">How We Use Your Information</h4>
 <ul className="space-y-3 list-disc pl-4 marker:text-gray-300 :text-gray-600">
 <li>To facilitate your spiritual growth through personalized course tracking.</li>
 <li>To connect you with local partner ministries (such as CfaN or other registered churches).</li>
 <li>To improve the theological safety and helpfulness of our Shepherd AI.</li>
 </ul>
 </div>

 <div>
 <h4 className="text-base font-bold text-gray-900 mb-2">Data Sharing and Disclosure</h4>
 <p>
 We do not sell your personal data. We only share information with partner churches or ministries when you explicitly request to be connected to a local community or prayer line.
 </p>
 </div>

 <div>
 <h4 className="text-base font-bold text-gray-900 mb-2">Security</h4>
 <p>
 We implement industry-standard security measures to protect your data from unauthorized access, ensuring that your path to maturity remains a safe and private experience.
 </p>
 </div>
 </div>
 ) : (
 <div className="space-y-6 text-sm text-gray-600 leading-relaxed animate-in fade-in duration-300">
 <div>
 <h3 className="text-xl font-bold text-gray-900 mb-1">Terms of Use</h3>
 <p className="text-xs text-gray-500 ">Last Updated: December 2025</p>
 </div>

 <div>
 <h4 className="text-base font-bold text-gray-900 mb-2">1. Acceptance of Terms</h4>
 <p>
 By accessing and using the Harvest App, you agree to abide by these terms. This platform is designed for spiritual growth and community building in accordance with Biblical principles.
 </p>
 </div>

 <div>
 <h4 className="text-base font-bold text-gray-900 mb-2">2. Use License</h4>
 <p>
 Harvest App grants you a personal, non-exclusive license to use the discipleship curriculum, AI tools, and community maps for your personal spiritual development. You may not reproduce, sell, or exploit any portion of the curriculum for commercial purposes.
 </p>
 </div>

 <div>
 <h4 className="text-base font-bold text-gray-900 mb-2">3. The Harvest AI Disclaimer</h4>
 <p>
 The Harvest AI is a supplemental tool designed to provide theological guidance and answer questions regarding the Christian faith. It is not a replacement for the Holy Spirit, pastoral counsel, or personal prayer. While we strive for theological accuracy, users are encouraged to test all guidance against the Holy Scriptures.
 </p>
 </div>

 <div>
 <h4 className="text-base font-bold text-gray-900 mb-2">4. Community Conduct</h4>
 <p>
 Users are expected to interact with the prayer lines and community features with Christ-like love, respect, and integrity. Any use of the platform to spread hate speech, misinformation, or harassment will result in immediate account termination.
 </p>
 </div>

 <div>
 <h4 className="text-base font-bold text-gray-900 mb-2">5. Church Map & Third-Party Ministries</h4>
 <p>
 The Harvest App provides a map of local churches as a service to help you find community. While we vet our partners, Harvest App is not responsible for the specific practices or doctrines of individual local congregations.
 </p>
 </div>

 <div>
 <h4 className="text-base font-bold text-gray-900 mb-2">6. Free Access & Partnership</h4>
 <p>
 The core discipleship tools of the Harvest App are provided free of charge to the user. This is made possible through the generosity of our partners. Users may choose to donate to support the ongoing development and global reach of the platform, but such contributions are voluntary.
 </p>
 </div>

 <div>
 <h4 className="text-base font-bold text-gray-900 mb-2">7. Limitation of Liability</h4>
 <p>
 Harvest App provides these tools &quot;as is.&quot; We are not liable for any interruptions in service or for the accuracy of user-generated content within the community sections of the app.
 </p>
 </div>
 </div>
 )}
 </div>
 </div>
 </div>
 );
};

export default PrivacyTermsModal;