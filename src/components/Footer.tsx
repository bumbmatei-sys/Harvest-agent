"use client";
import React from 'react';
import Image from 'next/image';

interface FooterProps {
  onNavigate: (page: string) => void;
}

const Footer: React.FC<FooterProps> = ({ onNavigate }) => {
  const handlePartnerClick = (e: React.MouseEvent) => {
    e.preventDefault();
    // Use the onNavigate 'landing' first to ensure we are on the main page, then scroll
    onNavigate('landing');
    setTimeout(() => {
        const element = document.getElementById('partner');
        if (element) {
          const headerOffset = 80;
          const elementPosition = element.getBoundingClientRect().top;
          const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
      
          window.scrollTo({
            top: offsetPosition,
            behavior: "smooth"
          });
        }
    }, 100);
  };

  const handleLinkClick = (e: React.MouseEvent, page: string) => {
      e.preventDefault();
      onNavigate(page);
  };

  return (
    <footer className="bg-[#001833] border-t border-white/5 pt-20 pb-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row justify-between items-start gap-12 mb-16">
          
          <div className="max-w-md">
            <div className="flex items-center gap-2 mb-6">
              <Image 
                src="https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png" 
                alt="Harvest Logo" 
                width={32}
                height={32}
                priority
                className="h-8 w-auto" 
              />
              <span className="text-white text-xl font-bold tracking-tight">Harvest</span>
            </div>
            <p className="text-gray-400 text-sm leading-relaxed">
              Providing the digital foundation for the global harvest. We don&apos;t just count decisions; we build disciples.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-2 gap-x-16 gap-y-4">
            <a href="#partner" onClick={handlePartnerClick} className="text-gray-300 hover:text-primary text-sm font-medium transition-colors">Partner with Us</a>
            <a href="#" onClick={(e) => handleLinkClick(e, 'privacy-policy')} className="text-gray-300 hover:text-primary text-sm font-medium transition-colors">Privacy Policy</a>
            <a href="#" onClick={(e) => handleLinkClick(e, 'contact-support')} className="text-gray-300 hover:text-primary text-sm font-medium transition-colors">Contact Us</a>
            <a href="#" onClick={(e) => handleLinkClick(e, 'faq')} className="text-gray-300 hover:text-primary text-sm font-medium transition-colors">FAQ</a>
            <a href="#" onClick={(e) => handleLinkClick(e, 'terms-of-use')} className="text-gray-300 hover:text-primary text-sm font-medium transition-colors">Terms of Use</a>
          </div>

        </div>

        <div className="border-t border-white/5 pt-8 flex flex-col md:flex-row justify-between items-center gap-6">
          <p className="text-gray-600 text-sm">© 2025 Harvest App. All Rights Reserved.</p>
          <div className="flex gap-6">
            <a href="#" className="text-gray-500 hover:text-white transition-colors">
              <span className="material-symbols-outlined text-xl">mail</span>
            </a>
            <a href="#" className="text-gray-500 hover:text-white transition-colors">
              <span className="material-symbols-outlined text-xl">rss_feed</span>
            </a>
            <a href="#" className="text-gray-500 hover:text-white transition-colors">
              <span className="material-symbols-outlined text-xl">share</span>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;