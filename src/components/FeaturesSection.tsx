"use client";
import React from 'react';
import Image from 'next/image';

interface FeaturesSectionProps {
  onNavigate?: (page: string) => void;
}

const FeaturesSection: React.FC<FeaturesSectionProps> = ({ onNavigate }) => {
  return (
    <section id="core" className="bg-white pt-10 pb-24 sm:pt-16 sm:pb-32 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-20 md:mb-28">
          <span className="text-primary font-bold tracking-wider uppercase text-sm mb-3 block">The Solution</span>
          <h2 className="text-4xl sm:text-5xl font-black text-background-dark mb-6 tracking-tight">
            Built for Spiritual Maturity
          </h2>
          <p className="text-xl text-gray-600 font-medium leading-relaxed">
            A comprehensive ecosystem designed to guide new believers from their first decision to becoming active, grounded members of the Body of Christ.
          </p>
        </div>

        <div className="space-y-32">
          {/* Feature 1: Curriculum */}
          <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-20">
             
             {/* Mobile Header (Visible only on mobile) */}
             <div className="w-full lg:hidden flex flex-col items-center text-center mb-6 order-1">
                  <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-4 transform -rotate-3">
                     <span className="material-symbols-outlined text-primary text-4xl">school</span>
                  </div>
                  <h2 className="text-3xl font-black text-background-dark tracking-tight">The Discipleship Curriculum</h2>
             </div>

             {/* Text Content */}
             <div className="lg:w-1/2 order-3 lg:order-1">
                {/* Desktop Header (Hidden on mobile) */}
                <div className="hidden lg:flex items-center gap-3 mb-6">
                  <div className="p-3 bg-primary/10 rounded-xl">
                     <span className="material-symbols-outlined text-primary text-2xl">school</span>
                  </div>
                  <h2 className="text-3xl sm:text-4xl font-black text-background-dark tracking-tight">The Discipleship Curriculum</h2>
                </div>

                <p className="text-lg text-gray-600 mb-8 leading-relaxed">
                  Immersive, multi-level learning tailored to your pace. Dive into high-quality video series, listen to audio guides on your commute, and visualize complex theological concepts with beautiful infographics.
                </p>
                <ul className="space-y-6">
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center shrink-0 mt-1">
                      <span className="material-symbols-outlined text-blue-600">play_circle</span>
                    </div>
                    <div>
                      <h4 className="font-bold text-background-dark text-lg">Video Lessons</h4>
                      <p className="text-gray-500">Cinema-quality teaching from respected theologians.</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center shrink-0 mt-1">
                      <span className="material-symbols-outlined text-blue-600">headphones</span>
                    </div>
                    <div>
                      <h4 className="font-bold text-background-dark text-lg">Audio Guides</h4>
                      <p className="text-gray-500">Devotionals and lessons optimized for listening on the go.</p>
                    </div>
                  </li>
                </ul>
                <div className="mt-10">
                  <button 
                    onClick={() => onNavigate && onNavigate('auth')}
                    className="text-blue-600 font-bold flex items-center gap-2 hover:gap-3 transition-all group"
                  >
                    Explore Curriculum <span className="material-symbols-outlined group-hover:translate-x-1 transition-transform">arrow_forward</span>
                  </button>
                </div>
             </div>
             
             {/* Image Content */}
             <div className="lg:w-1/2 w-full order-2 lg:order-2">
                {/* Abstract Video Player UI */}
                <div 
                  onClick={() => onNavigate && onNavigate('auth')}
                  className="bg-gray-100 rounded-2xl shadow-2xl border border-gray-200 overflow-hidden relative aspect-video group cursor-pointer transform transition-transform hover:scale-[1.02] duration-500"
                >
                   {/* Browser Chrome */}
                   <div className="h-8 bg-gray-100 border-b border-gray-200 flex items-center gap-2 px-4">
                      <div className="w-3 h-3 rounded-full bg-red-400"></div>
                      <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                      <div className="w-3 h-3 rounded-full bg-green-400"></div>
                   </div>
                   
                   <div className="absolute inset-0 top-8 bg-gray-800 flex items-center justify-center">
                      <div className="absolute inset-0 opacity-40 bg-[url('https://images.unsplash.com/photo-1504052434569-70ad5836ab65?q=80&w=2070&auto=format&fit=crop')] bg-cover bg-center"></div>
                      <div className="w-20 h-20 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center group-hover:scale-110 transition-transform shadow-2xl border border-white/30 z-10">
                         <span className="material-symbols-outlined text-white text-5xl ml-1">play_arrow</span>
                      </div>
                   </div>
                   
                   {/* Fake Player UI */}
                   <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/90 via-black/50 to-transparent pt-12">
                      <h3 className="text-white font-bold text-lg mb-2">What is Eternal Life?</h3>
                      <div className="flex items-center gap-4 text-xs font-medium text-white/80 mb-3">
                         <span>Foundations of Faith</span>
                         <div className="h-1 w-1 rounded-full bg-white/50"></div>
                         <span>Theology 101</span>
                      </div>
                      <div className="h-1.5 bg-white/20 rounded-full mb-3 overflow-hidden cursor-pointer">
                         <div className="h-full w-1/3 bg-blue-500 relative">
                            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md transform scale-0 group-hover:scale-100 transition-transform"></div>
                         </div>
                      </div>
                      <div className="flex justify-between text-white/70 text-[10px] font-mono">
                         <span>12:45 / 35:00</span>
                      </div>
                   </div>
                </div>
                <div className="mt-6 space-y-3">
                   <div className="h-3 w-3/4 bg-gray-100 rounded-full"></div>
                   <div className="h-3 w-1/2 bg-gray-100 rounded-full"></div>
                </div>
             </div>
          </div>

          {/* Feature 2: AI (Reversed) */}
          <div className="flex flex-col lg:flex-row-reverse items-center gap-12 lg:gap-20">
             
             {/* Mobile Header (Visible only on mobile) */}
             <div className="w-full lg:hidden flex flex-col items-center text-center mb-6 order-1">
                <div className="mb-4">
                   <span className="material-symbols-outlined text-[#D4AF37] text-6xl animate-pulse">auto_awesome</span>
                </div>
                <h2 className="text-3xl font-black text-background-dark tracking-tight">Harvest AI</h2>
             </div>

             {/* Text Content */}
             <div className="lg:w-1/2 order-3 lg:order-1">
                {/* Desktop Header (Hidden on mobile) */}
                <div className="hidden lg:block">
                    <div className="flex items-center gap-3 mb-6">
                       <span className="material-symbols-outlined text-[#D4AF37] text-4xl animate-pulse">auto_awesome</span>
                    </div>
                    <h2 className="text-3xl sm:text-4xl font-black text-background-dark mb-6 tracking-tight">Harvest AI</h2>
                </div>

                <p className="text-lg text-gray-600 mb-8 leading-relaxed">
                  Theologically sound guidance at your fingertips. An intelligent companion trained to always bring you back to the Holy Spirit and help you find community. It will not replace the Body of Christ and the Holy Spirit.
                </p>
                
                <div className="space-y-4 mb-8">
                   <div className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-[#D4AF37] shrink-0">check_circle</span>
                      <span className="text-gray-700 font-medium">Answers rooted in biblical truth</span>
                   </div>
                   <div className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-[#D4AF37] shrink-0">check_circle</span>
                      <span className="text-gray-700 font-medium">Points to the Holy Spirit</span>
                   </div>
                   <div className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-[#D4AF37] shrink-0">check_circle</span>
                      <span className="text-gray-700 font-medium">Bridges the gap to human connection</span>
                   </div>
                </div>

                <button 
                  onClick={() => onNavigate && onNavigate('auth')}
                  className="bg-[#D4AF37] hover:bg-[#b8952b] text-white px-8 py-4 rounded-full font-bold flex items-center gap-3 shadow-lg shadow-[#D4AF37]/20 transition-all hover:-translate-y-0.5"
                >
                  <span className="material-symbols-outlined">chat</span>
                  Try Harvest AI
                </button>
             </div>
             
             {/* Image Content */}
             <div className="lg:w-1/2 w-full flex justify-center order-2 lg:order-2">
                {/* Chat Interface Mockup */}
                <div className="bg-white rounded-3xl w-full max-w-md border border-gray-100 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.1)] overflow-hidden">
                   {/* Header */}
                   <div className="bg-gray-50/80 backdrop-blur border-b border-gray-100 p-4 flex items-center justify-between sticky top-0 z-10">
                      <div className="flex items-center gap-3">
                         <div className="relative">
                            <div className="w-10 h-10 bg-[#D4AF37] rounded-full flex items-center justify-center text-white shadow-sm">
                               <span className="material-symbols-outlined">smart_toy</span>
                            </div>
                            <div className="absolute bottom-0 right-0 w-3 h-3 bg-[#D4AF37] border-2 border-white rounded-full"></div>
                         </div>
                         <div>
                            <div className="font-bold text-sm text-gray-900">Harvest AI</div>
                            <div className="text-[10px] text-[#D4AF37] font-bold uppercase tracking-wider flex items-center gap-1">
                               Online
                            </div>
                         </div>
                      </div>
                      <span className="material-symbols-outlined text-gray-400">more_horiz</span>
                   </div>
                   
                   {/* Messages */}
                   <div className="p-6 space-y-6 bg-white min-h-[300px]">
                      
                      {/* User Message */}
                      <div className="flex justify-end">
                         <div className="bg-[#D4AF37] text-white rounded-2xl rounded-tr-sm py-3 px-5 text-sm shadow-md max-w-[85%] leading-relaxed">
                            How do I explain the concept of grace to a friend who feels unworthy?
                         </div>
                      </div>
                      
                      {/* AI Message */}
                      <div className="flex justify-start items-end gap-2">
                         <div className="w-8 h-8 bg-[#D4AF37]/10 rounded-full flex items-center justify-center shrink-0 mb-1">
                            <span className="material-symbols-outlined text-[#D4AF37] text-xs">smart_toy</span>
                         </div>
                         <div className="bg-gray-100 text-gray-800 rounded-2xl rounded-tl-sm py-4 px-5 text-sm shadow-sm max-w-[90%] leading-relaxed border border-gray-200/50">
                            <p className="mb-3"><span className="font-bold">That&apos;s a beautiful opportunity.</span> Scripture tells us in <span className="font-bold">Ephesians 2:8-9</span> that grace is a gift, not something we earn.</p>
                            <p>Try sharing the parable of the Prodigal Son. It illustrates that the Father&apos;s love is waiting, regardless of our past.</p>
                         </div>
                      </div>
                      
                      {/* Typing Indicator */}
                      <div className="flex gap-1 pl-12">
                         <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce"></div>
                         <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce delay-100"></div>
                         <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce delay-200"></div>
                      </div>
                   </div>
                </div>
             </div>
          </div>

          {/* Feature 3: Map (Center Focus) */}
          <div className="text-center">
             <div className="max-w-3xl mx-auto mb-16">
                <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-6 transform rotate-3">
                   <span className="material-symbols-outlined text-primary text-4xl">map</span>
                </div>
                <h2 className="text-3xl sm:text-5xl font-black text-background-dark mb-6 tracking-tight">Find Your Spiritual Family</h2>
                <p className="text-lg text-gray-600 leading-relaxed">
                   Discipleship happens in community. Locate healthy local churches, small groups, and ministries near you to transition from digital learning to physical connection.
                </p>
             </div>
             
             {/* Map Mockup */}
             <div className="max-w-5xl mx-auto bg-gray-100 rounded-[2.5rem] overflow-hidden shadow-2xl border border-gray-200 relative h-[500px] w-full group isolate">
                
                {/* Grid Background representing map */}
                <div className="absolute inset-0 bg-[#e5e7eb]"></div>
                <div className="absolute inset-0 opacity-30" 
                    style={{backgroundImage: 'linear-gradient(#fff 2px, transparent 2px), linear-gradient(90deg, #fff 2px, transparent 2px)', backgroundSize: '40px 40px'}}>
                </div>
                
                {/* Abstract Roads */}
                <svg className="absolute inset-0 w-full h-full opacity-60 pointer-events-none" style={{stroke: 'white', fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round'}}>
                   <path d="M0,400 C150,400 200,300 300,300 C400,300 500,450 700,450 C900,450 1000,350 1200,350" strokeWidth="25"/>
                   <path d="M200,0 C200,100 300,200 300,300 C300,400 450,500 450,600" strokeWidth="20"/>
                   <path d="M800,0 C800,150 700,200 700,450 C700,550 600,600 600,700" strokeWidth="18"/>
                   <path d="M50,100 L300,200 L900,150 L1200,250" strokeWidth="12" className="opacity-70"/>
                </svg>

                {/* Search Bar */}
                <div className="absolute top-8 left-1/2 -translate-x-1/2 w-[90%] max-w-lg bg-white/95 backdrop-blur rounded-full shadow-[0_10px_30px_-5px_rgba(0,0,0,0.1)] py-3 px-6 flex items-center gap-4 z-20 border border-white/50 transform transition-all hover:scale-105 hover:shadow-xl">
                   <span className="material-symbols-outlined text-gray-400">search</span>
                   <span className="text-gray-500 text-sm font-medium flex-1 text-left border-none bg-transparent outline-none">Search by city or zip code...</span>
                   <button className="bg-blue-600 text-white px-5 py-2 rounded-full text-xs font-bold tracking-wide shadow-lg shadow-blue-600/20">Search</button>
                </div>

                {/* Pins */}
                {/* Pin 1: Blue - Church */}
                <div className="absolute top-[40%] left-[30%] z-10 hover:z-50 transition-all duration-300">
                   <div className="relative group/pin cursor-pointer">
                      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-8 h-2 bg-black/20 blur-sm rounded-full group-hover/pin:scale-75 transition-transform duration-300"></div>
                      <span className="material-symbols-outlined text-blue-600 text-6xl drop-shadow-lg transform group-hover/pin:-translate-y-4 transition-transform duration-300 ease-out">location_on</span>
                      
                      {/* Tooltip */}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover/pin:opacity-100 transform translate-y-2 group-hover/pin:translate-y-0 transition-all duration-300">
                          <div className="bg-white rounded-xl shadow-xl p-3 w-48 border border-gray-100 text-left">
                              <div className="h-24 bg-gray-100 rounded-lg mb-2 overflow-hidden relative">
                                  <Image src="https://images.unsplash.com/photo-1438232992991-995b7058bbb3?q=80&w=2073&auto=format&fit=crop" alt="Church" fill sizes="192px" className="object-cover" />
                              </div>
                              <div className="font-bold text-gray-900 text-sm">Grace Community</div>
                              <div className="text-xs text-gray-500">1.2 miles away • Service 9AM</div>
                          </div>
                          {/* Triangle */}
                          <div className="w-3 h-3 bg-white transform rotate-45 mx-auto -mt-1.5 shadow-sm border-r border-b border-gray-100"></div>
                      </div>
                   </div>
                </div>
                
                {/* Pin 2: Orange - Small Group */}
                <div className="absolute bottom-[25%] right-[35%] z-10 hover:z-50 transition-all duration-300">
                   <div className="relative group/pin cursor-pointer">
                      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-8 h-2 bg-black/20 blur-sm rounded-full group-hover/pin:scale-75 transition-transform duration-300"></div>
                      <span className="material-symbols-outlined text-orange-500 text-6xl drop-shadow-lg transform group-hover/pin:-translate-y-4 transition-transform duration-300 ease-out">location_on</span>
                      
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-white px-4 py-2 rounded-lg shadow-xl text-xs font-bold whitespace-nowrap opacity-0 group-hover/pin:opacity-100 transform translate-y-2 group-hover/pin:translate-y-0 transition-all duration-300 text-gray-800">
                          Downtown Life Group
                          <div className="absolute bottom-[-4px] left-1/2 -translate-x-1/2 w-2 h-2 bg-white rotate-45"></div>
                      </div>
                   </div>
                </div>

                {/* Pin 3: Green - Event */}
                 <div className="absolute top-[55%] right-[25%] z-10 hover:z-50 transition-all duration-300">
                   <div className="relative group/pin cursor-pointer">
                      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-8 h-2 bg-black/20 blur-sm rounded-full group-hover/pin:scale-75 transition-transform duration-300"></div>
                      <span className="material-symbols-outlined text-green-500 text-6xl drop-shadow-lg transform group-hover/pin:-translate-y-4 transition-transform duration-300 ease-out">location_on</span>
                       
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-white px-4 py-2 rounded-lg shadow-xl text-xs font-bold whitespace-nowrap opacity-0 group-hover/pin:opacity-100 transform translate-y-2 group-hover/pin:translate-y-0 transition-all duration-300 text-gray-800">
                          Worship Night
                          <div className="absolute bottom-[-4px] left-1/2 -translate-x-1/2 w-2 h-2 bg-white rotate-45"></div>
                      </div>
                   </div>
                </div>

                {/* Bottom Legend */}
                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur px-6 py-3 rounded-full flex gap-6 text-xs font-bold text-gray-600 shadow-lg border border-white/50">
                   <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-blue-600 shadow-sm"></div>Churches</div>
                   <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-orange-500 shadow-sm"></div>Small Groups</div>
                   <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-sm"></div>Events</div>
                </div>

             </div>
          </div>
        
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;