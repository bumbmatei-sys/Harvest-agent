"use client";
import React, { useEffect, useRef } from 'react';
import Image from 'next/image';

interface HeroProps {
  onNavigate?: (page: string) => void;
}

const Hero: React.FC<HeroProps> = ({ onNavigate }) => {
  const imageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScroll = () => {
      if (imageRef.current) {
        // Continuous rotation based on scroll position
        // 0.4 coefficient means 1 full rotation (360deg) every ~900px of scroll
        const rotation = window.scrollY * 0.4;
        
        // Direct application without transition for immediate response
        imageRef.current.style.transform = `rotateY(${rotation}deg)`;
      }
    };

    // Initialize on mount
    handleScroll();

    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const scrollToPartner = (e: React.MouseEvent) => {
    e.preventDefault();
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
  };

  return (
    <section className="relative min-h-screen flex flex-col items-center justify-end pt-32 pb-16 overflow-hidden bg-background-dark">
      {/* Background Image & Overlay */}
      <div className="absolute inset-0 z-0">
        <Image 
          src="https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/No_people_just_2k_202512231746.jpeg" 
          alt="Harvest Background" 
          fill
          sizes="100vw"
          priority
          className="object-cover"
        />
        {/* Dark gradient overlay to ensure text readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-background-dark/80 via-background-dark/60 to-background-dark/95 mix-blend-multiply"></div>
        <div className="absolute inset-0 bg-black/40"></div>
      </div>

      {/* Background Ambience - kept subtle */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vw] h-[80vw] bg-primary/10 blur-[150px] rounded-full pointer-events-none mix-blend-overlay z-0"></div>
      
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 flex flex-col items-center text-center pb-16">
        <div className="flex flex-col gap-6 items-center animate-fade-in-up">
          
          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl lg:text-7xl font-black text-white leading-[1.05] tracking-tight max-w-4xl drop-shadow-2xl">
            From Conversion to <span className="text-primary text-shadow-sm">Maturity</span>
          </h1>
          
          {/* Subtext */}
          <p className="text-lg sm:text-xl text-gray-100 leading-relaxed max-w-2xl drop-shadow-lg font-medium">
            Providing the digital foundation for the global harvest. The bridge between the altar call and spiritual maturity.
          </p>
          
          {/* CTA Buttons */}
          <div className="flex flex-col gap-4 pt-6 items-center w-full">
            <button 
              onClick={() => onNavigate && onNavigate('auth')}
              className="flex items-center justify-center gap-3 bg-primary hover:bg-yellow-600 text-white h-14 px-10 rounded-full font-bold text-lg transition-all shadow-[0_0_20px_rgba(184,134,11,0.3)] hover:scale-105 hover:shadow-[0_0_30px_rgba(184,134,11,0.5)] transform duration-100 w-full sm:w-auto"
            >
              <span>Start Growing Today</span>
              <span className="material-symbols-outlined">arrow_forward</span>
            </button>
            
            <button 
              onClick={scrollToPartner}
              className="flex items-center justify-center gap-3 bg-transparent border-2 border-white text-white h-14 px-10 rounded-full font-bold text-lg transition-all hover:bg-primary hover:border-primary hover:scale-105 hover:shadow-[0_0_30px_rgba(184,134,11,0.5)] transform duration-100 w-full sm:w-auto"
            >
              <span>Partner with Us</span>
            </button>
          </div>
        </div>
      </div>

      {/* New Image with Scroll Rotation Effect */}
      <div className="relative flex justify-center w-full z-20 mt-10 pb-12 [perspective:1000px]">
        <div 
          ref={imageRef} 
          className="w-[240px] sm:w-[280px] h-auto drop-shadow-2xl will-change-transform"
          style={{ transformStyle: 'preserve-3d' }}
        >
          <Image 
            src="https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png"
            alt="Harvest Spic Logo"
            width={280}
            height={280}
            className="w-full h-auto"
          />
        </div>
      </div>
    </section>
  );
};

export default Hero;