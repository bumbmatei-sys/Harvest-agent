"use client";
import React, { useState } from 'react';
import { HeartHandshake, Heart, CreditCard, Lock, ShieldCheck } from 'lucide-react';

type DonationType = 'one-time' | 'monthly';
type PaymentMethod = 'card' | 'apple-pay' | 'google-pay';

const PartnerWithUsTab: React.FC = () => {
 const [donationType, setDonationType] = useState<DonationType>('one-time');
 const [amount, setAmount] = useState<string>('50');
 const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('apple-pay');

 const presetAmounts = ['10', '25', '50', '100'];

 return (
 <div className="flex-1 px-4 pb-32 max-w-md mx-auto w-full">
 {/* Top Icon & Text */}
 <div className="flex flex-col items-center text-center mb-8 mt-4">
 <div className="w-16 h-16 bg-[#fdf8ed] rounded-full flex items-center justify-center mb-4">
 <HeartHandshake size={32} className="text-[#d4a017]" />
 </div>
 <h2 className="text-2xl font-bold text-[#0b1121] mb-3">Partner with Us</h2>
 <p className="text-[#64748b] text-sm leading-relaxed">
 Your partnership keeps this platform free for the new believer and scalable for the nations.
 </p>
 </div>

 {/* One-Time / Monthly Toggle */}
 <div className="bg-white rounded-xl p-1 flex mb-8 shadow-sm border border-gray-100 ">
 <button
 onClick={() => setDonationType('one-time')}
 className={`flex-1 py-3 rounded-lg text-sm font-bold transition-colors ${
 donationType === 'one-time'
 ? 'bg-[#d4a017] text-white'
 : 'text-[#64748b] hover:bg-gray-50 :bg-gray-800'
 }`}
 >
 One-Time
 </button>
 <button
 onClick={() => setDonationType('monthly')}
 className={`flex-1 py-3 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2 ${
 donationType === 'monthly'
 ? 'bg-[#d4a017] text-white'
 : 'text-[#64748b] hover:bg-gray-50 :bg-gray-800'
 }`}
 >
 Monthly <Heart size={14} className={donationType === 'monthly' ? 'fill-white' : 'fill-[#64748b] '} />
 </button>
 </div>

 {/* Select Amount */}
 <div className="mb-8">
 <h3 className="text-[11px] font-bold text-[#94a3b8] tracking-wider uppercase mb-3">
 Select Amount
 </h3>
 <div className="grid grid-cols-4 gap-3 mb-4">
 {presetAmounts.map((preset) => (
 <button
 key={preset}
 onClick={() => setAmount(preset)}
 className={`py-3 rounded-xl text-sm font-bold transition-colors border ${
 amount === preset
 ? 'bg-[#fdf8ed] border-[#d4a017] text-[#d4a017]'
 : 'bg-white border-transparent text-[#0b1121] shadow-sm'
 }`}
 >
 ${preset}
 </button>
 ))}
 </div>
 <div className="bg-white rounded-xl p-4 flex items-center shadow-sm border border-gray-100 ">
 <span className="text-[#94a3b8] font-bold mr-2">$</span>
 <input
 type="number"
 value={amount}
 onChange={(e) => setAmount(e.target.value)}
 className="bg-transparent font-bold text-[#0b1121] w-full focus:outline-none text-lg"
 placeholder="Other Amount"
 />
 </div>
 </div>

 {/* Payment Method */}
 <div className="mb-8">
 <h3 className="text-[11px] font-bold text-[#94a3b8] tracking-wider uppercase mb-3">
 Payment Method
 </h3>
 <div className="space-y-3">
 <button
 onClick={() => setPaymentMethod('apple-pay')}
 className={`w-full flex items-center justify-between p-4 rounded-xl border transition-colors ${
 paymentMethod === 'apple-pay'
 ? 'bg-[#fdf8ed] border-[#d4a017]'
 : 'bg-white border-transparent shadow-sm'
 }`}
 >
 <div className="flex items-center gap-3">
 <div className="w-10 h-6 bg-black rounded flex items-center justify-center">
 <span className="text-white font-bold text-[10px]">Pay</span>
 </div>
 <span className="font-bold text-[#0b1121] text-sm">Apple Pay</span>
 </div>
 <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
 paymentMethod === 'apple-pay' ? 'border-[#d4a017]' : 'border-gray-300 '
 }`}>
 {paymentMethod === 'apple-pay' && <div className="w-2.5 h-2.5 bg-[#d4a017] rounded-full" />}
 </div>
 </button>

 <button
 onClick={() => setPaymentMethod('google-pay')}
 className={`w-full flex items-center justify-between p-4 rounded-xl border transition-colors ${
 paymentMethod === 'google-pay'
 ? 'bg-[#fdf8ed] border-[#d4a017]'
 : 'bg-white border-transparent shadow-sm'
 }`}
 >
 <div className="flex items-center gap-3">
 <div className="w-10 h-6 bg-white border border-gray-200 rounded flex items-center justify-center">
 <span className="text-gray-800 font-bold text-[10px]">G Pay</span>
 </div>
 <span className="font-bold text-[#0b1121] text-sm">Google Pay</span>
 </div>
 <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
 paymentMethod === 'google-pay' ? 'border-[#d4a017]' : 'border-gray-300 '
 }`}>
 {paymentMethod === 'google-pay' && <div className="w-2.5 h-2.5 bg-[#d4a017] rounded-full" />}
 </div>
 </button>

 <button
 onClick={() => setPaymentMethod('card')}
 className={`w-full flex items-center justify-between p-4 rounded-xl border transition-colors ${
 paymentMethod === 'card'
 ? 'bg-[#fdf8ed] border-[#d4a017]'
 : 'bg-white border-transparent shadow-sm'
 }`}
 >
 <div className="flex items-center gap-3">
 <div className="w-10 h-6 bg-gray-100 rounded flex items-center justify-center">
 <CreditCard size={16} className="text-gray-600 " />
 </div>
 <span className="font-bold text-[#0b1121] text-sm">Credit / Debit Card</span>
 </div>
 <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
 paymentMethod === 'card' ? 'border-[#d4a017]' : 'border-gray-300 '
 }`}>
 {paymentMethod === 'card' && <div className="w-2.5 h-2.5 bg-[#d4a017] rounded-full" />}
 </div>
 </button>
 </div>
 </div>

 {/* Security Info */}
 <div className="flex items-center justify-center gap-2 text-[#94a3b8] mb-8">
 <Lock size={14} />
 <span className="text-xs font-medium">Secure, encrypted payment</span>
 <ShieldCheck size={14} className="ml-2" />
 </div>

 {/* Action Button */}
 <button className="w-full bg-[#d4a017] hover:bg-[#b88a14] text-white font-bold py-4 rounded-xl shadow-lg shadow-[#d4a017]/20 transition-all flex items-center justify-center gap-2">
 <Heart size={18} className="fill-white" />
 Donate ${amount || '0'} {donationType === 'monthly' ? 'Monthly' : ''}
 </button>
 </div>
 );
};

export default PartnerWithUsTab;