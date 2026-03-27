"use client";
import React from 'react';

interface CTASectionProps {
  onNavigate?: (page: string) => void;
}

const CTASection: React.FC<CTASectionProps> = ({ onNavigate }) => {
  return (
    <section id="vision" className="bg-gold-gradient py-24 sm:py-32 relative overflow-hidden">
      {/* Texture overlay */}
      <div className="absolute inset-0 mix-blend-overlay opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
      
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
        <span className="text-background-dark/60 font-bold tracking-wider uppercase text-sm mb-3 block">The Vision</span>
        <h2 className="text-3xl md:text-5xl font-black text-background-dark mb-8 leading-tight">
          Ready for the Billion Soul Harvest
        </h2>
        <p className="text-xl md:text-2xl font-medium text-background-dark/80 mb-12 max-w-2xl mx-auto">
          We believe a one-billion soul harvest is coming. For that harvest to last, churches all over the world need to be more than prepared to &quot;vacuum&quot; the millions of converts and bring them to maturity.
          <br/><br/>
          We are building the infrastructure to turn moments of decision into lifetimes of devotion.
        </p>
        <button 
          onClick={() => onNavigate && onNavigate('auth')}
          className="bg-background-dark text-white text-lg font-bold py-5 px-10 rounded-full shadow-2xl hover:scale-105 hover:shadow-3xl transition-all duration-100 flex items-center gap-3 mx-auto group"
        >
          <span>Start Your Journey</span>
          <span className="material-symbols-outlined group-hover:translate-x-1 transition-transform">arrow_forward</span>
        </button>
      </div>
    </section>
  );
};

export default CTASection;