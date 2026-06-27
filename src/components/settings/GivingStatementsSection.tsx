"use client";
import React, { useState, useEffect } from 'react';

const DEFAULT_FOOTER = 'No goods or services were provided in exchange for these contributions.';

export const GivingStatementsSection: React.FC = () => {
  const [ein, setEin] = useState('');
  const [address, setAddress] = useState('');
  const [footer, setFooter] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    if (loaded) return;
    try {
      const { auth, db } = await import('../../firebase');
      const { doc, getDoc } = await import('firebase/firestore');
      if (auth.currentUser) {
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (userDoc.exists()) {
          const tenantId = userDoc.data().tenantId;
          if (tenantId) {
            const tenantDoc = await getDoc(doc(db, 'tenants', tenantId));
            if (tenantDoc.exists()) {
              const gs = tenantDoc.data().config?.givingStatements || {};
              if (gs.ein) setEin(gs.ein);
              if (gs.address) setAddress(gs.address);
              setFooter(gs.footer || DEFAULT_FOOTER);
            } else {
              setFooter(DEFAULT_FOOTER);
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to load giving statement settings:', e);
    }
    setLoaded(true);
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const { auth, db } = await import('../../firebase');
      const { doc, getDoc, updateDoc } = await import('firebase/firestore');
      if (auth.currentUser) {
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (userDoc.exists()) {
          const tenantId = userDoc.data().tenantId;
          if (tenantId) {
            await updateDoc(doc(db, 'tenants', tenantId), {
              'config.givingStatements': {
                ein: ein.trim() || null,
                address: address.trim() || null,
                footer: footer.trim() || DEFAULT_FOOTER,
              },
              updatedAt: new Date().toISOString(),
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
          }
        }
      }
    } catch (e) {
      console.error('Failed to save giving statement settings:', e);
      alert('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6" style={{ paddingBottom: 120 }}>
      <p className="text-gray-600">
        These details appear on the annual giving statements (tax receipts) you send to donors.
      </p>

      <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Ministry EIN (Tax ID)</label>
          <input
            type="text"
            value={ein}
            onChange={(e) => setEin(e.target.value)}
            placeholder="e.g. 12-3456789"
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gold focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Ministry Address</label>
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="123 Faith St&#10;City, State ZIP"
            rows={3}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gold focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Statement Footer Note</label>
          <textarea
            value={footer}
            onChange={(e) => setFooter(e.target.value)}
            rows={2}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gold focus:border-transparent"
          />
          <p className="text-xs text-gray-400 mt-1">Required IRS disclosure text. A sensible default is provided.</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 bg-gold text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        {saved && <span className="text-sm text-green-600 font-medium">✓ Saved</span>}
      </div>
    </div>
  );
};

export default GivingStatementsSection;
