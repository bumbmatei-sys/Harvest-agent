"use client";
import React from 'react';

interface TermsOfUseProps {
 onBack: () => void;
}

const TermsOfUse: React.FC<TermsOfUseProps> = ({ onBack }) => {
 return (
 <div className="min-h-screen bg-white pt-32 pb-16">
 <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
 <button 
 onClick={onBack}
 className="flex items-center gap-2 text-gray-600 hover:text-primary transition-colors mb-8 font-medium"
 >
 <span className="material-symbols-outlined">arrow_back</span>
 Back to Home
 </button>

 <h1 className="text-4xl font-black text-background-dark mb-8">Terms of Use</h1>
 
 <div className="prose prose-lg text-gray-600">
 <p className="mb-6 font-bold">Last Updated: December 2025</p>
 
 <h3 className="text-xl font-bold text-gray-900 mb-4">1. Acceptance of Terms</h3>
 <p className="mb-6">
 By accessing and using the Harvest App, you agree to abide by these terms. This platform is designed for spiritual growth and community building in accordance with Biblical principles.
 </p>

 <h3 className="text-xl font-bold text-gray-900 mb-4">2. Use License</h3>
 <p className="mb-6">
 Harvest App grants you a personal, non-exclusive license to use the discipleship curriculum, AI tools, and community maps for your personal spiritual development. You may not reproduce, sell, or exploit any portion of the curriculum for commercial purposes.
 </p>

 <h3 className="text-xl font-bold text-gray-900 mb-4">3. The Harvest AI Disclaimer</h3>
 <p className="mb-6">
 The Harvest AI is a supplemental tool designed to provide theological guidance and answer questions regarding the Christian faith. It is not a replacement for the Holy Spirit, pastoral counsel, or personal prayer. While we strive for theological accuracy, users are encouraged to test all guidance against the Holy Scriptures.
 </p>

 <h3 className="text-xl font-bold text-gray-900 mb-4">4. Community Conduct</h3>
 <p className="mb-6">
 Users are expected to interact with the prayer lines and community features with Christ-like love, respect, and integrity. Any use of the platform to spread hate speech, misinformation, or harassment will result in immediate account termination.
 </p>

 <h3 className="text-xl font-bold text-gray-900 mb-4">5. Church Map & Third-Party Ministries</h3>
 <p className="mb-6">
 The Harvest App provides a map of local churches as a service to help you find community. While we vet our partners, Harvest App is not responsible for the specific practices or doctrines of individual local congregations.
 </p>

 <h3 className="text-xl font-bold text-gray-900 mb-4">6. Free Access & Partnership</h3>
 <p className="mb-6">
 The core discipleship tools of the Harvest App are provided free of charge to the user. This is made possible through the generosity of our partners. Users may choose to donate to support the ongoing development and global reach of the platform, but such contributions are voluntary.
 </p>
 
 <h3 className="text-xl font-bold text-gray-900 mb-4">7. Limitation of Liability</h3>
 <p>
 Harvest App provides these tools &quot;as is.&quot; We are not liable for any interruptions in service or for the accuracy of user-generated content within the community sections of the app.
 </p>
 </div>
 </div>
 </div>
 );
};

export default TermsOfUse;