"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';

interface NavbarProps {
    isHome?: boolean;
    onNavigate?: (page: string) => void;
}

const Navbar: React.FC<NavbarProps> = ({ isHome = true, onNavigate }) => {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSection = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    setMobileMenuOpen(false);

    if (!isHome && onNavigate) {
        // If not on home, we can't scroll to sections.
        // Option: Navigate home first.
        onNavigate('landing');
        // Note: Scrolling immediately after state change might need a timeout in the parent or effect, 
        // but for simplicity we just go home.
        return;
    }

    const element = document.getElementById(id);
    if (element) {
      const headerOffset = 80;
      const elementPosition = element.getBoundingClientRect().top;
      let offsetPosition = elementPosition + window.pageYOffset - headerOffset;

      if (id === 'partner') {
        // Scroll lower into the section to ensure the previous yellow section is hidden 
        // and the relevant text is visible.
        // We add back the headerOffset to align top of section with top of viewport, 
        // then add 20% of viewport height to scroll further down.
        offsetPosition += headerOffset + (window.innerHeight * 0.2);
      }
  
      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth"
      });
    }
  };

  const handleLogoClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setMobileMenuOpen(false);
    if (!isHome && onNavigate) {
        onNavigate('landing');
    } else {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    }
  };

  const handleMobileLinkClick = (e: React.MouseEvent, page: string) => {
      e.preventDefault();
      setMobileMenuOpen(false);
      if (onNavigate) {
          onNavigate(page);
      }
  };

  const toggleMobileMenu = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  // Determine background class based on state
  // If menu is open, force dark background
  const bgClass = mobileMenuOpen 
    ? 'bg-background-dark border-b border-white/10 py-3'
    : (isHome 
        ? (scrolled ? 'bg-background-dark/95 backdrop-blur-md border-b border-white/10 py-3' : 'bg-transparent py-5')
        : 'bg-background-dark border-b border-white/10 py-3');

  return (
    <header 
      className={`fixed top-0 left-0 w-full z-50 transition-all duration-300 ${bgClass}`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          <a href="#" onClick={handleLogoClick} className="flex items-center gap-2 group cursor-pointer">
            <Image 
              src="https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png" 
              alt="Harvest Logo" 
              width={32}
              height={32}
              priority
              className="h-8 w-auto group-hover:scale-110 transition-transform duration-300" 
            />
            <span className="text-white text-xl font-bold tracking-tight">Harvest</span>
          </a>
          
          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-8">
            <a 
              className="text-white hover:text-white text-sm font-medium transition-colors cursor-pointer" 
              href="#challenge"
              onClick={(e) => scrollToSection(e, 'challenge')}
            >
              The Challenge
            </a>
            <a 
              className="text-white hover:text-white text-sm font-medium transition-colors cursor-pointer" 
              href="#core"
              onClick={(e) => scrollToSection(e, 'core')}
            >
              Features
            </a>
            <a 
              className="text-white hover:text-white text-sm font-medium transition-colors cursor-pointer" 
              href="#roadmap"
              onClick={(e) => scrollToSection(e, 'roadmap')}
            >
              Roadmap
            </a>
            <a 
              className="text-white hover:text-white text-sm font-medium transition-colors cursor-pointer" 
              href="#vision"
              onClick={(e) => scrollToSection(e, 'vision')}
            >
              The Vision
            </a>
            <a 
              className="bg-primary text-white px-6 py-2.5 rounded-full text-sm font-bold hover:bg-[#d4a017] transition-all duration-100 transform hover:scale-105 shadow-[0_0_15px_rgba(184,134,11,0.3)] ml-2"
              href="#partner"
              onClick={(e) => scrollToSection(e, 'partner')}
            >
              Donate
            </a>
          </nav>

          {/* Mobile Menu Button */}
          <button 
            className="md:hidden text-white p-2 -mr-2 focus:outline-none"
            onClick={toggleMobileMenu}
            aria-label="Toggle menu"
          >
            <span className="material-symbols-outlined text-3xl">
              {mobileMenuOpen ? 'close' : 'menu'}
            </span>
          </button>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="md:hidden absolute top-full left-0 w-full bg-background-dark border-t border-white/10 shadow-2xl h-[calc(100vh-60px)] overflow-y-auto">
          <nav className="flex flex-col items-center pt-8 pb-12 space-y-8 px-6">
            <a 
              className="text-xl font-medium text-gray-200 hover:text-white transition-colors" 
              href="#challenge"
              onClick={(e) => scrollToSection(e, 'challenge')}
            >
              The Challenge
            </a>
            <a 
              className="text-xl font-medium text-gray-200 hover:text-white transition-colors" 
              href="#core"
              onClick={(e) => scrollToSection(e, 'core')}
            >
              Features
            </a>
            <a 
              className="text-xl font-medium text-gray-200 hover:text-white transition-colors" 
              href="#roadmap"
              onClick={(e) => scrollToSection(e, 'roadmap')}
            >
              Roadmap
            </a>
            <a 
              className="text-xl font-medium text-gray-200 hover:text-white transition-colors" 
              href="#vision"
              onClick={(e) => scrollToSection(e, 'vision')}
            >
              The Vision
            </a>
            
            {/* Added Mobile Links */}
            <a 
              className="text-xl font-medium text-gray-200 hover:text-white transition-colors" 
              href="#"
              onClick={(e) => handleMobileLinkClick(e, 'contact-support')}
            >
              Contact Us
            </a>

            {/* Mobile Only Link */}
            <a 
              className="text-xl font-medium text-gray-200 hover:text-white transition-colors" 
              href="#"
              onClick={(e) => handleMobileLinkClick(e, 'faq')}
            >
              FAQ
            </a>
            <a 
              className="text-xl font-bold text-primary hover:text-[#d4a017] transition-colors"
              href="#partner"
              onClick={(e) => scrollToSection(e, 'partner')}
            >
              Partner with Us
            </a>
          </nav>
        </div>
      )}
    </header>
  );
};

export default Navbar;