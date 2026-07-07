"use client";
import React, { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

interface PublicCheckinProps {
  tenantId: string;
  tenantName: string;
  logo: string | null;
  primaryColor: string;
  sessionId: string;
  sessionName: string;
  closed: boolean;
}

const PublicCheckin: React.FC<PublicCheckinProps> = ({
  tenantId, tenantName, logo, primaryColor, sessionId, sessionName, closed,
}) => {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputCls = 'w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent';
  const ring = { '--tw-ring-color': primaryColor } as React.CSSProperties;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim()) { setError('Please enter your first name.'); return; }
    setError(null);
    setSubmitting(true);
    try {
      const resp = await fetch('/api/checkin/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, sessionId, firstName, lastName, email }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Check-in failed');
      }
      setDone(true);
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="min-h-screen bg-[#F7F6F3] flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt={tenantName} className="h-12 mx-auto mb-2 object-contain" />
          ) : (
            <div className="font-display text-lg font-extrabold" style={{ color: primaryColor }}>{tenantName}</div>
          )}
        </div>
        {children}
      </div>
    </div>
  );

  if (closed) {
    return <Shell><div className="bg-white rounded-[14px] shadow-sm border border-gray-100 p-8 text-center"><p className="text-gray-600">This check-in session is closed.</p></div></Shell>;
  }

  if (done) {
    return (
      <Shell>
        <div className="bg-white rounded-[14px] shadow-sm border border-gray-100 p-8 text-center">
          <CheckCircle2 size={48} className="mx-auto mb-4" style={{ color: primaryColor }} />
          <h1 className="font-display text-xl font-bold text-gray-900 mb-1">You&apos;re checked in!</h1>
          <p className="text-gray-500 text-sm">Welcome, {firstName}. 🙌</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <form onSubmit={handleSubmit} className="bg-white rounded-[14px] shadow-sm border border-gray-100 p-6" style={{ paddingBottom: 120 }}>
        <h1 className="font-display text-xl font-bold text-gray-900 mb-1">Check In</h1>
        <p className="text-sm text-gray-500 mb-5">{sessionName}</p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">First Name<span className="text-red-500 ml-0.5">*</span></label>
            <input className={inputCls} style={ring} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Last Name</label>
            <input className={inputCls} style={ring} value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Email <span className="text-gray-400 font-normal">(optional)</span></label>
            <input type="email" className={inputCls} style={ring} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        {error && <p className="text-sm text-red-600 mt-4">{error}</p>}
        <button type="submit" disabled={submitting} className="mt-6 w-full py-3 rounded-xl text-white font-semibold disabled:opacity-50" style={{ backgroundColor: primaryColor }}>
          {submitting ? 'Checking in…' : 'Check In'}
        </button>
      </form>
    </Shell>
  );
};

export default PublicCheckin;
