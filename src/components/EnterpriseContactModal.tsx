"use client";
import React, { useState } from 'react';
import { X, Building2, Send, CheckCircle } from 'lucide-react';
import { auth } from '../firebase';

interface EnterpriseContactModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const EnterpriseContactModal: React.FC<EnterpriseContactModalProps> = ({ isOpen, onClose }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState(auth.currentUser?.email || '');
  const [churchName, setChurchName] = useState('');
  const [churchCount, setChurchCount] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') handleClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !churchName.trim()) return;

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/enterprise-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          churchName: churchName.trim(),
          churchCount: churchCount ? parseInt(churchCount, 10) : null,
          message: message.trim(),
          userId: auth.currentUser?.uid || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to submit');
      }
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setName('');
    setEmail(auth.currentUser?.email || '');
    setChurchName('');
    setChurchCount('');
    setMessage('');
    setSuccess(false);
    setError('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={handleClose} onKeyDown={handleKeyDown}>
      <div className="bg-[#f8f9fa] w-full sm:w-[500px] max-h-[90vh] rounded-t-3xl sm:rounded-3xl overflow-y-auto flex flex-col relative animate-slide-up sm:animate-fade-in" onClick={(e) => e.stopPropagation()}>
        {/* Close */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 z-50 w-10 h-10 bg-black/20 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-black/40 transition-colors"
        >
          <X size={20} />
        </button>

        {/* Header */}
        <div className="bg-[#0b1121] pt-12 pb-8 px-6">
          <div className="w-14 h-14 bg-[#d4a017]/20 rounded-2xl flex items-center justify-center mb-4">
            <Building2 size={28} className="text-[#d4a017]" />
          </div>
          <h2 className="text-2xl font-bold text-white">Organization Plan</h2>
          <p className="text-gray-400 text-sm mt-1">Unlimited churches & AI assistants, custom pricing, dedicated support</p>
        </div>

        <div className="px-6 py-6">
          {success ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle size={32} className="text-green-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">{"We'll be in touch!"}</h3>
              <p className="text-gray-500 text-sm mb-6">
                Our team will review your request and reach out within 24 hours to discuss your Organization plan.
              </p>
              <button
                onClick={handleClose}
                className="w-full py-3 bg-[#d4a017] text-white font-bold rounded-xl hover:bg-[#b58812] transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Your Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Pastor John"
                  maxLength={100}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-[#d4a017] text-gray-900"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Email *</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="john@church.org"
                  maxLength={200}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-[#d4a017] text-gray-900"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Church / Organization Name *</label>
                <input
                  type="text"
                  value={churchName}
                  onChange={(e) => setChurchName(e.target.value)}
                  required
                  placeholder="Grace Community Church"
                  maxLength={200}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-[#d4a017] text-gray-900"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Number of Churches</label>
                <input
                  type="number"
                  value={churchCount}
                  onChange={(e) => setChurchCount(e.target.value)}
                  min="1"
                  max="10000"
                  placeholder="e.g. 5"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-[#d4a017] text-gray-900"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Message</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  placeholder="Tell us about your needs..."
                  maxLength={2000}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-[#d4a017] text-gray-900 resize-none"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 rounded-xl p-3">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || !name.trim() || !email.trim() || !churchName.trim()}
                className="w-full flex items-center justify-center gap-2 py-3 bg-[#0b1121] text-white font-bold rounded-xl hover:bg-[#1a2744] transition-colors disabled:opacity-50"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <Send size={16} />
                    Request Organization Plan
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default EnterpriseContactModal;
