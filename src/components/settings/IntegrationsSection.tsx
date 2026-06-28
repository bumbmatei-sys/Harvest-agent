"use client";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Instagram, Mail, Star } from 'lucide-react';
import { authFetch } from '../../utils/auth-fetch';

const IntegrationsSection: React.FC = () => {
  const [instagramStatus, setInstagramStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [instagramAccount, setInstagramAccount] = useState<string | null>(null);
  const [isPrimaryInstagram, setIsPrimaryInstagram] = useState(false);
  const [instagramLoading, setInstagramLoading] = useState(false);

  const [mailchimpStatus, setMailchimpStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [mailchimpAccount, setMailchimpAccount] = useState<string | null>(null);
  const [isPrimaryMailchimp, setIsPrimaryMailchimp] = useState(false);
  const [mailchimpLoading, setMailchimpLoading] = useState(false);

  const [loaded, setLoaded] = useState(false);
  const pollingRef = useRef<{ intervals: NodeJS.Timeout[]; timeouts: NodeJS.Timeout[] }>({ intervals: [], timeouts: [] });

  useEffect(() => {
    return () => {
      pollingRef.current.intervals.forEach(id => clearInterval(id));
      pollingRef.current.timeouts.forEach(id => clearTimeout(id));
    };
  }, []);

  const getTenantId = useCallback(async (): Promise<string | null> => {
    const { auth, db } = await import('../../firebase');
    const { doc, getDoc } = await import('firebase/firestore');
    if (auth.currentUser) {
      const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
      if (userDoc.exists()) return userDoc.data().tenantId || null;
    }
    return null;
  }, []);

  const loadIntegrations = useCallback(async () => {
    if (loaded) return;
    try {
      const [igResp, mcResp] = await Promise.all([
        authFetch('/api/composio/instagram/status'),
        authFetch('/api/composio/mailchimp/status'),
      ]);

      if (igResp.ok) {
        const igData = await igResp.json();
        if (igData.connected) {
          setInstagramStatus('connected');
          setInstagramAccount(igData.username || null);
        }
        setIsPrimaryInstagram(igData.isPrimary || false);
      }

      if (mcResp.ok) {
        const mcData = await mcResp.json();
        if (mcData.connected) {
          setMailchimpStatus('connected');
          setMailchimpAccount(mcData.email || null);
        }
        setIsPrimaryMailchimp(mcData.isPrimary || false);
      }
    } catch (e) {
      console.error('Failed to load integrations:', e);
    }
    setLoaded(true);
  }, [loaded]);

  useEffect(() => { loadIntegrations(); }, [loadIntegrations]);

  const handleMakePrimaryInstagram = async () => {
    try {
      const { auth } = await import('../../firebase');
      const { db } = await import('../../firebase');
      const { doc, updateDoc } = await import('firebase/firestore');
      const tid = await getTenantId();
      if (!tid || !auth.currentUser) return;
      await updateDoc(doc(db, 'tenants', tid), { primaryInstagramAdmin: auth.currentUser.uid });
      setIsPrimaryInstagram(true);
    } catch (e) {
      console.error('Failed to set primary Instagram admin:', e);
    }
  };

  const handleMakePrimaryMailchimp = async () => {
    try {
      const { auth } = await import('../../firebase');
      const { db } = await import('../../firebase');
      const { doc, updateDoc } = await import('firebase/firestore');
      const tid = await getTenantId();
      if (!tid || !auth.currentUser) return;
      await updateDoc(doc(db, 'tenants', tid), { primaryMailchimpAdmin: auth.currentUser.uid });
      setIsPrimaryMailchimp(true);
    } catch (e) {
      console.error('Failed to set primary Mailchimp admin:', e);
    }
  };

  const handleInstagramConnect = async () => {
    const tid = await getTenantId();
    if (!tid) return;
    setInstagramLoading(true);
    try {
      const resp = await authFetch('/api/composio/instagram/connect', {
        method: 'POST',
        body: JSON.stringify({ tenantId: tid }),
      });
      const data = await resp.json();
      if (data.redirectUrl) {
        setInstagramStatus('connecting');
        window.open(data.redirectUrl, '_blank');
        const pollInterval = setInterval(async () => {
          try {
            const statusResp = await authFetch('/api/composio/instagram/status');
            const statusData = await statusResp.json();
            if (statusData.connected) {
              setInstagramStatus('connected');
              setInstagramAccount(statusData.username || null);
              setIsPrimaryInstagram(statusData.isPrimary || false);
              clearInterval(pollInterval);
            }
          } catch { /* keep polling */ }
        }, 3000);
        const pollTimeout = setTimeout(() => clearInterval(pollInterval), 120000);
        pollingRef.current.intervals.push(pollInterval);
        pollingRef.current.timeouts.push(pollTimeout);
      } else {
        alert(data.error || 'Failed to initiate Instagram connection');
      }
    } catch (e) {
      console.error('Instagram connect error:', e);
      alert('Failed to connect Instagram. Please try again.');
    } finally {
      setInstagramLoading(false);
    }
  };

  const handleMailchimpConnect = async () => {
    const tid = await getTenantId();
    if (!tid) return;
    setMailchimpLoading(true);
    try {
      const resp = await authFetch('/api/composio/mailchimp/connect', {
        method: 'POST',
        body: JSON.stringify({ tenantId: tid }),
      });
      const data = await resp.json();
      if (data.redirectUrl) {
        setMailchimpStatus('connecting');
        window.open(data.redirectUrl, '_blank');
        const pollInterval = setInterval(async () => {
          try {
            const statusResp = await authFetch('/api/composio/mailchimp/status');
            const statusData = await statusResp.json();
            if (statusData.connected) {
              setMailchimpStatus('connected');
              setMailchimpAccount(statusData.email || null);
              setIsPrimaryMailchimp(statusData.isPrimary || false);
              clearInterval(pollInterval);
            }
          } catch { /* keep polling */ }
        }, 3000);
        const pollTimeout = setTimeout(() => clearInterval(pollInterval), 120000);
        pollingRef.current.intervals.push(pollInterval);
        pollingRef.current.timeouts.push(pollTimeout);
      } else {
        alert(data.error || 'Failed to initiate Mailchimp connection');
      }
    } catch (e) {
      console.error('Mailchimp connect error:', e);
      alert('Failed to connect Mailchimp. Please try again.');
    } finally {
      setMailchimpLoading(false);
    }
  };

  const handleInstagramDisconnect = async () => {
    setInstagramLoading(true);
    try {
      await authFetch('/api/composio/instagram/disconnect', { method: 'POST' });
      setInstagramStatus('disconnected');
      setInstagramAccount(null);
      setIsPrimaryInstagram(false);
    } catch (e) {
      console.error('Instagram disconnect error:', e);
      alert('Failed to disconnect Instagram.');
    } finally {
      setInstagramLoading(false);
    }
  };

  const handleMailchimpDisconnect = async () => {
    setMailchimpLoading(true);
    try {
      await authFetch('/api/composio/mailchimp/disconnect', { method: 'POST' });
      setMailchimpStatus('disconnected');
      setMailchimpAccount(null);
      setIsPrimaryMailchimp(false);
    } catch (e) {
      console.error('Mailchimp disconnect error:', e);
      alert('Failed to disconnect Mailchimp.');
    } finally {
      setMailchimpLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Connect your social media and email marketing platforms to automate newsletter distribution.
      </p>

      {/* Instagram Card */}
      <div className="bg-gray-50 rounded-xl p-4">
        <div className="flex items-center gap-4">
          <Instagram size={20} className="text-gray-400" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-gray-900">Instagram</p>
              {instagramStatus === 'connected' && isPrimaryInstagram && (
                <span className="flex items-center gap-1 text-xs text-gold font-medium">
                  <Star size={11} fill="currentColor" /> Primary
                </span>
              )}
            </div>
            {instagramStatus === 'connected' ? (
              <p className="text-xs text-green-600">Connected{instagramAccount ? ` — @${instagramAccount}` : ''}</p>
            ) : instagramStatus === 'connecting' ? (
              <p className="text-xs text-yellow-600">Waiting for authorization...</p>
            ) : (
              <p className="text-xs text-gray-500">Auto-generate newsletters from your Instagram posts</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {instagramStatus === 'connected' && !isPrimaryInstagram && (
              <button
                onClick={handleMakePrimaryInstagram}
                className="px-4 py-2 border border-gold text-gold rounded-lg text-sm font-medium hover:bg-yellow-50 transition-colors"
              >
                Make Primary
              </button>
            )}
            {instagramStatus === 'connected' ? (
              <button onClick={handleInstagramDisconnect} disabled={instagramLoading}
                className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors disabled:opacity-50">
                {instagramLoading ? 'Disconnecting...' : 'Disconnect'}
              </button>
            ) : (
              <button onClick={handleInstagramConnect} disabled={instagramLoading || instagramStatus === 'connecting'}
                className="px-4 py-2 bg-gold text-white rounded-lg text-sm font-medium hover:bg-gold transition-colors disabled:opacity-50">
                {instagramLoading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Connecting...
                  </span>
                ) : instagramStatus === 'connecting' ? 'Waiting...' : 'Connect'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Mailchimp Card */}
      <div className="bg-gray-50 rounded-xl p-4">
        <div className="flex items-center gap-4">
          <Mail size={20} className="text-gray-400" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-gray-900">Mailchimp</p>
              {mailchimpStatus === 'connected' && isPrimaryMailchimp && (
                <span className="flex items-center gap-1 text-xs text-gold font-medium">
                  <Star size={11} fill="currentColor" /> Primary
                </span>
              )}
            </div>
            {mailchimpStatus === 'connected' ? (
              <p className="text-xs text-green-600">Connected{mailchimpAccount ? ` — ${mailchimpAccount}` : ''}</p>
            ) : mailchimpStatus === 'connecting' ? (
              <p className="text-xs text-yellow-600">Waiting for authorization...</p>
            ) : (
              <p className="text-xs text-gray-500">Sync subscribers and send campaigns via Mailchimp</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {mailchimpStatus === 'connected' && !isPrimaryMailchimp && (
              <button
                onClick={handleMakePrimaryMailchimp}
                className="px-4 py-2 border border-gold text-gold rounded-lg text-sm font-medium hover:bg-yellow-50 transition-colors"
              >
                Make Primary
              </button>
            )}
            {mailchimpStatus === 'connected' ? (
              <button onClick={handleMailchimpDisconnect} disabled={mailchimpLoading}
                className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors disabled:opacity-50">
                {mailchimpLoading ? 'Disconnecting...' : 'Disconnect'}
              </button>
            ) : (
              <button onClick={handleMailchimpConnect} disabled={mailchimpLoading || mailchimpStatus === 'connecting'}
                className="px-4 py-2 bg-gold text-white rounded-lg text-sm font-medium hover:bg-gold transition-colors disabled:opacity-50">
                {mailchimpLoading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Connecting...
                  </span>
                ) : mailchimpStatus === 'connecting' ? 'Waiting...' : 'Connect'}
              </button>
            )}
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-400">
        Powered by Composio — secure OAuth connections. Your credentials are never stored on our servers.
      </p>
    </div>
  );
};

export default IntegrationsSection;
