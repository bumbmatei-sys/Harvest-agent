"use client";
import React from 'react';

interface PrivacyPolicyProps {
 onBack: () => void;
}

const PrivacyPolicy: React.FC<PrivacyPolicyProps> = ({ onBack }) => {
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

 <h1 className="text-4xl font-black text-background-dark mb-8">Privacy Policy</h1>
 
 <div className="prose prose-lg text-gray-600">
 <p className="mb-6 font-bold">Last Updated: December 2025</p>
 
 <h3 className="text-xl font-bold text-gray-900 mb-4">Our Commitment to Your Journey</h3>
 <p className="mb-6">
 Harvest App is committed to protecting the privacy and spiritual journey of every user. This policy outlines how we collect, use, and safeguard your information as you grow in Christ.
 </p>

 <h3 className="text-xl font-bold text-gray-900 mb-4">Information We Collect</h3>
 <ul className="list-disc pl-5 mb-6 space-y-2">
 <li><strong>Account Information:</strong> Name, email address, and basic profile details provided during registration.</li>
 <li><strong>Spiritual Progress:</strong> Data regarding your progress in all courses to help you pick up where you left off.</li>
 <li><strong>Location Data:</strong> With your permission, we use your GPS location solely to display the closest registered churches and communities on our map.</li>
 <li><strong>AI Interactions:</strong> Conversations with the Harvest AI are processed to provide theological guidance. These interactions are stored to improve the AI&apos;s accuracy and are never sold to third parties.</li>
 </ul>

 <h3 className="text-xl font-bold text-gray-900 mb-4">How We Use Your Information</h3>
 <ul className="list-disc pl-5 mb-6 space-y-2">
 <li>To facilitate your spiritual growth through personalized course tracking.</li>
 <li>To connect you with local partner ministries (such as CfaN or other registered churches).</li>
 <li>To improve the theological safety and helpfulness of our Shepherd AI.</li>
 </ul>

 <h3 className="text-xl font-bold text-gray-900 mb-4">Data Sharing and Disclosure</h3>
 <p className="mb-6">
 We do not sell your personal data. We only share information with partner churches or ministries when you explicitly request to be connected to a local community or prayer line.
 </p>

 <h3 className="text-xl font-bold text-gray-900 mb-4">Security</h3>
 <p>
 We implement industry-standard security measures to protect your data from unauthorized access, ensuring that your path to maturity remains a safe and private experience.
 </p>
 </div>
 </div>
 </div>
 );
};

export default PrivacyPolicy;