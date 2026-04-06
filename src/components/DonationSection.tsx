"use client";
import React, { useState } from 'react';

const DonationSection: React.FC = () => {
 const [amount, setAmount] = useState<number | string>(50);
 const [frequency, setFrequency] = useState<'once' | 'monthly'>('monthly');
 const [paymentMethod, setPaymentMethod] = useState<'card' | 'apple' | 'google'>('apple');
 const [showThankYou, setShowThankYou] = useState(false);

 const handleAmountChange = (val: number | string) => {
 setAmount(val);
 };

 const handleDonate = () => {
 setShowThankYou(true);
 setTimeout(() => {
 setShowThankYou(false);
 }, 4000);
 };

 return (
 <section id="partner" className="bg-[#0b1121] py-24 sm:py-32 relative overflow-hidden">
 {/* Background glow */}
 <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-primary/5 rounded-full blur-[120px] pointer-events-none -translate-y-1/2 translate-x-1/2"></div>
 <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-blue-900/10 rounded-full blur-[100px] pointer-events-none translate-y-1/2 -translate-x-1/2"></div>
 
 {/* Thank You Popup */}
 {showThankYou && (
 <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm animate-fade-in">
 <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl text-center transform scale-100 animate-bounce-small relative overflow-hidden">
 <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-primary to-yellow-300"></div>
 <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
 <span className="material-symbols-outlined text-green-600 text-3xl">volunteer_activism</span>
 </div>
 <h3 className="text-2xl font-black text-background-dark mb-3">Thank You!</h3>
 <p className="text-gray-600 mb-6">
 Your generosity is helping equip the global church. Thank you for sowing into the harvest!
 </p>
 <button 
 onClick={() => setShowThankYou(false)}
 className="w-full py-3 bg-primary text-white font-bold rounded-xl shadow-lg shadow-primary/20 hover:bg-yellow-600 transition-colors"
 >
 Close
 </button>
 </div>
 </div>
 )}

 <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
 <div className="flex flex-col lg:flex-row gap-16 lg:gap-24 items-start">
 
 {/* Left Content */}
 <div className="flex-1 space-y-8 pt-4">
 <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs font-bold tracking-wider text-primary uppercase backdrop-blur-sm">
 <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
 Partner With Us
 </div>
 
 <div className="space-y-6">
 <h2 className="text-4xl sm:text-5xl lg:text-7xl font-black text-white leading-[1.05] tracking-tight">
 Sow into the <br/>
 <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-yellow-300">Harvest.</span>
 </h2>
 <p className="text-xl sm:text-2xl text-gray-300 font-medium leading-relaxed max-w-xl">
 The Gospel is free, and we believe this discipleship journey should be too.
 </p>
 </div>

 <div className="space-y-6 text-gray-400 leading-relaxed text-lg border-l-2 border-primary/20 pl-6">
 <p>
 We have made a firm commitment: no new believer should ever have to pay to learn about Jesus. The entire platform is completely free for the user. We want there to be zero barriers between a soul and their Savior.
 </p>
 <p>
 However, building high-level technology, training advanced AI, and maintaining global servers requires significant resources.
 </p>
 <p className="text-gray-200 font-semibold">
 When you give, you aren&apos;t just paying for software. You are sponsoring the discipleship of a new believer. You are ensuring that when a hand goes up for Jesus, a digital safety net is there to catch them.
 </p>
 <p className="italic text-primary/80">
 Help us keep this tool free for the billion-soul harvest.
 </p>
 </div>
 </div>

 {/* Right Content - Donation Card */}
 <div id="donate-form" className="w-full lg:w-[500px] shrink-0 lg:mt-16">
 <div className="bg-[#151f32] rounded-[2rem] p-6 sm:p-10 border border-white/5 shadow-2xl relative overflow-hidden group">
 
 {/* Tab Switcher */}
 <div className="grid grid-cols-2 bg-[#0b1121] rounded-2xl p-1.5 mb-8 border border-white/5">
 <button 
 onClick={() => setFrequency('once')}
 className={`py-3 rounded-xl text-sm font-bold transition-all duration-100 ${frequency === 'once' ? 'bg-[#1e293b] text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
 >
 One-Time
 </button>
 <button 
 onClick={() => setFrequency('monthly')}
 className={`py-3 rounded-xl text-sm font-bold transition-all duration-100 flex items-center justify-center gap-2 ${frequency === 'monthly' ? 'bg-[#1e293b] text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
 >
 Monthly
 <span className="material-symbols-outlined text-primary text-base leading-none" style={{ fontVariationSettings: "'FILL' 1" }}>favorite</span>
 </button>
 </div>

 {/* Amount Selection */}
 <div className="mb-8">
 <label className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-4 block ml-1">Select Amount</label>
 <div className="grid grid-cols-3 gap-4 mb-4">
 {[25, 50, 100].map((val) => (
 <button
 key={val}
 onClick={() => handleAmountChange(val)}
 className={`py-4 rounded-2xl text-xl font-bold border transition-all duration-100 ${amount === val ? 'bg-primary border-primary text-[#0b1121] shadow-lg shadow-primary/20 scale-[1.02]' : 'bg-[#0b1121] border-transparent text-white hover:bg-[#1e293b] hover:border-white/10'}`}
 >
 ${val}
 </button>
 ))}
 </div>
 
 <div className="relative">
 <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold">$</span>
 <input
 type="number"
 placeholder="Custom Amount"
 value={typeof amount === 'string' || ![25, 50, 100].includes(amount as number) ? amount : ''}
 onChange={(e) => handleAmountChange(e.target.value)}
 className="w-full py-4 pl-8 pr-4 rounded-2xl text-sm font-bold border bg-[#0b1121] border-transparent text-white placeholder-gray-500 focus:outline-none focus:bg-[#1e293b] focus:border-primary/50 transition-all duration-100"
 />
 </div>
 </div>

 {/* Payment Method */}
 <div className="mb-8">
 <label className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-4 block ml-1">Payment Method</label>
 <div className="space-y-3">
 
 <div className="grid grid-cols-2 gap-3">
 {/* Apple Pay */}
 <div 
 onClick={() => setPaymentMethod('apple')}
 className={`flex items-center justify-center gap-2 bg-[#0b1121] border p-4 rounded-2xl cursor-pointer transition-all ${paymentMethod === 'apple' ? 'border-white text-white opacity-100' : 'border-transparent text-white opacity-60 hover:opacity-100 hover:bg-[#1e293b]'}`}
 >
 <span className="material-symbols-outlined">account_balance_wallet</span>
 <span className="font-bold text-sm">Apple Pay</span>
 </div>

 {/* Google Pay */}
 <div 
 onClick={() => setPaymentMethod('google')}
 className={`flex items-center justify-center gap-2 bg-[#0b1121] border p-4 rounded-2xl cursor-pointer transition-all ${paymentMethod === 'google' ? 'border-white text-white opacity-100' : 'border-transparent text-white opacity-60 hover:opacity-100 hover:bg-[#1e293b]'}`}
 >
 <span className="material-symbols-outlined">payments</span>
 <span className="font-bold text-sm">Google Pay</span>
 </div>
 </div>

 {/* Credit Card Option */}
 <div 
 onClick={() => setPaymentMethod('card')}
 className={`bg-[#0b1121] border p-4 rounded-2xl cursor-pointer transition-all duration-100 relative overflow-hidden ${paymentMethod === 'card' ? 'border-primary/50 shadow-inner' : 'border-transparent hover:bg-[#1e293b] opacity-70 hover:opacity-100'}`}
 >
 {paymentMethod === 'card' && <div className="absolute inset-0 bg-primary/5"></div>}
 <div className="flex items-center justify-between relative z-10">
 <div className="flex items-center gap-4">
 <span className="material-symbols-outlined text-white">credit_card</span>
 <span className="text-white font-bold text-sm">Credit Card</span>
 </div>
 <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${paymentMethod === 'card' ? 'border-primary' : 'border-gray-600'}`}>
 {paymentMethod === 'card' && <div className="w-2.5 h-2.5 rounded-full bg-primary"></div>}
 </div>
 </div>
 
 {/* Card Details Inputs */}
 {paymentMethod === 'card' && (
 <div className="mt-4 pt-4 border-t border-white/5 space-y-4 animate-fade-in">
 <div className="space-y-2">
 <input 
 type="text" 
 placeholder="Card Number" 
 className="w-full bg-[#151f32] border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-primary/50"
 />
 </div>
 <div className="grid grid-cols-2 gap-4">
 <input 
 type="text" 
 placeholder="MM/YY" 
 className="w-full bg-[#151f32] border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-primary/50"
 />
 <input 
 type="text" 
 placeholder="CVC" 
 className="w-full bg-[#151f32] border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-primary/50"
 />
 </div>
 </div>
 )}
 </div>

 </div>
 </div>

 {/* Submit Button */}
 <button 
 onClick={handleDonate}
 className="w-full bg-primary hover:bg-[#d4a017] text-[#0b1121] py-5 rounded-2xl font-black text-xl shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3 group"
 >
 Donate {amount ? `$${amount}` : ''}
 <span className="material-symbols-outlined group-hover:translate-x-1 transition-transform">arrow_forward</span>
 </button>

 <div className="mt-6 text-center flex items-center justify-center gap-2 text-gray-500 text-xs font-medium">
 <span className="material-symbols-outlined text-sm">lock</span>
 Secure SSL Encrypted Payment
 </div>

 </div>
 </div>
 </div>
 
 {/* Bottom Stats */}
 <div className="mt-20 lg:mt-32 pt-10 border-t border-white/5 grid grid-cols-2 md:grid-cols-4 gap-y-12 gap-x-8">
 <div>
 <div className="text-4xl font-black text-white mb-2">$0</div>
 <div className="text-gray-500 text-sm font-medium uppercase tracking-wide">Cost to New Believers</div>
 </div>
 <div>
 <div className="text-4xl font-black text-white mb-2">100%</div>
 <div className="text-gray-500 text-sm font-medium uppercase tracking-wide">Donor Funded</div>
 </div>
 <div>
 <div className="text-4xl font-black text-white mb-2">501(c)(3)</div>
 <div className="text-gray-500 text-sm font-medium uppercase tracking-wide">Tax Deductible</div>
 </div>
 <div>
 <div className="text-4xl font-black text-white mb-2">Global</div>
 <div className="text-gray-500 text-sm font-medium uppercase tracking-wide">Kingdom Impact</div>
 </div>
 </div>

 </div>
 </section>
 );
};

export default DonationSection;