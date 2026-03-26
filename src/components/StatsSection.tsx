"use client";
import React from 'react';

const StatsSection: React.FC = () => {
  return (
    <section id="challenge" className="bg-background-light pt-24 pb-10 sm:pt-32 sm:pb-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center mb-16 lg:mb-20">
          <span className="text-primary font-bold tracking-wider uppercase text-sm mb-3 block">The Challenge</span>
          <h2 className="text-4xl sm:text-5xl font-bold text-background-dark mb-6 tracking-tight">The Harvest is Plentiful, but...</h2>
          <div className="text-xl text-gray-600 leading-relaxed space-y-4">
            <p>
              Every single week, hundreds of thousands of people across the world accept Jesus as their Savior. The Kingdom is expanding at an unprecedented rate, and it is a glorious sight.
            </p>
            <p>
              But with this amazing growth comes a vital question: "What is the retention percentage?"
            </p>
            <p>
              How many of these precious souls remain in Christ? How many grow to maturity to fulfill the Great Commandment?
            </p>
            <p>
              We believe that <strong className="text-gray-900">effective discipling is the fastest way to multiply the Church.</strong> To sustain this revival, we must steward the soul as passionately as we seek it. The Harvest App was created to bridge the gap between the altar call and a lifetime of walking with Jesus.
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-8 lg:gap-12">
          {/* Stat Card 1 */}
          <div className="bg-background-alt p-8 rounded-2xl border border-gray-200 shadow-sm hover:shadow-lg transition-all duration-100 hover:-translate-y-1">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 bg-primary/10 rounded-lg text-primary flex items-center justify-center">
                <span className="material-symbols-outlined">trending_down</span>
              </div>
              <span className="text-secondary font-bold text-xs uppercase tracking-widest">Retention Rate</span>
            </div>
            <p className="text-6xl font-black text-background-dark mb-3 tracking-tighter">6-15%</p>
            <p className="text-gray-600 text-sm leading-relaxed">Average retention of new believers that remain in church after receiving Jesus.</p>
          </div>

          {/* Stat Card 2 */}
          <div className="bg-background-alt p-8 rounded-2xl border border-gray-200 shadow-sm hover:shadow-lg transition-all duration-100 hover:-translate-y-1">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 bg-primary/10 rounded-lg text-primary flex items-center justify-center">
                <span className="material-symbols-outlined">public</span>
              </div>
              <span className="text-secondary font-bold text-xs uppercase tracking-widest">New Believers</span>
            </div>
            <p className="text-6xl font-black text-background-dark mb-3 tracking-tighter">1B+</p>
            <p className="text-gray-600 text-sm leading-relaxed">Projected souls to be saved in the coming decade needing guidance.</p>
          </div>

          {/* Stat Card 3 */}
          <div className="bg-background-alt p-8 rounded-2xl border border-gray-200 shadow-sm hover:shadow-lg transition-all duration-100 hover:-translate-y-1">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 bg-primary/10 rounded-lg text-primary flex items-center justify-center">
                <span className="material-symbols-outlined">language</span>
              </div>
              <span className="text-secondary font-bold text-xs uppercase tracking-widest">Global Reach</span>
            </div>
            <p className="text-6xl font-black text-background-dark mb-3 tracking-tighter">190</p>
            <p className="text-gray-600 text-sm leading-relaxed">Countries requiring localized, accessible discipleship tools.</p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default StatsSection;