"use client";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Instagram, Mail, Plug } from 'lucide-react';
import { authFetch } from '../../utils/auth-fetch';

interface IntegrationsSectionProps {}

const IntegrationsSection: React.FC<IntegrationsSectionProps> = () => {
  const [instagramStatus, setInstagramStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [instagramAccount, setInstagramAccount] = useState<string | null>(null);
  const [instagramLoading, setInstagramLoading] = useState(false);
  const [mailchimpStatus, setMailchimpStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [mailchimpAccount, setMailchimpAccount] = useState<string | null>(null);
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
      const tid = await getTenantId();
      if (!tid) return;
      const { doc, getDoc } = await import('firebase/firestore');
      const { db } = await import('../../firebase');

      const igDoc = await getDoc(doc(db, 'tenants', tid, 'integrations', 'instagram'));
      if (igDoc.exists()) {
        const igData = igDoc.data();
        if (igData.status === 'connected' || igData.status === 'active') {
          setInstagramStatus('connected');
          setInstagramAccount(igData.username || null);
        }
      }

      const mcDoc = await getDoc(doc(db, 'tenants', tid, 'integrations', 'mailchimp'));
      if (mcDoc.exists()) {
        const mcData = mcDoc.data();
        if (mcData.status === 'connected' || mcData.status === 'active') {
          setMailchimpStatus('connected');
          setMailchimpAccount(mcData.email || null);
        }
      }
    } catch (e) {
      console.error('Failed to load integrations:', e);
    }
    setLoaded(true);
  }, [loaded]);

  useEffect(() => { loadIntegrations(); }, [loadIntegrations]);

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
            const statusResp = await authFetch(`/api/composio/instagram/status?tenantId=${tid}`);
            const statusData = await statusResp.json();
            if (statusData.connected) {
              setInstagramStatus('connected');
              setInstagramAccount(statusData.username || null);
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
            const statusResp = await authFetch(`/api/composio/mailchimp/status?tenantId=${tid}`);
            const statusData = await statusResp.json();
            if (statusData.connected) {
              setMailchimpStatus('connected');
              setMailchimpAccount(statusData.email || null);
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
    const tid = await getTenantId();
    if (!tid) return;
    setInstagramLoading(true);
    try {
      await authFetch('/api/composio/instagram/disconnect', {
        method: 'POST',
        body: JSON.stringify({ tenantId: tid }),
      });
      setInstagramStatus('disconnected');
      setInstagramAccount(null);
    } catch (e) {
      console.error('Instagram disconnect error:', e);
      alert('Failed to disconnect Instagram.');
    } finally {
      setInstagramLoading(false);
    }
  };

  const handleMailchimpDisconnect = async () => {
    const tid = await getTenantId();
    if (!tid) return;
    setMailchimpLoading(true);
    try {
      await authFetch('/api/composio/mailchimp/disconnect', {
        method: 'POST',
        body: JSON.stringify({ tenantId: tid }),
      });
      setMailchimpStatus('disconnected');
      setMailchimpAccount(null);
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
        Connect your social media and email marketing platforms to automate newsletter distribution and social posting.
      </p>

      {/* Instagram Card */}
      <div className="bg-gray-50 rounded-xl p-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <Instagram size={24} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900">Instagram</p>
            {instagramStatus === 'connected' ? (
              <p className="text-xs text-green-600">Connected{instagramAccount ? ` — @${instagramAccount}` : ''}</p>
            ) : instagramStatus === 'connecting' ? (
              <p className="text-xs text-yellow-600">Waiting for authorization...</p>
            ) : (
              <p className="text-xs text-gray-500">Auto-publish posts and stories from your newsletter</p>
            )}
          </div>
          {instagramStatus === 'connected' ? (
            <button onClick={handleInstagramDisconnect} disabled={instagramLoading}
              className="px-4 py-2 border border-red-200 text-red-600 rounded-xl text-xs font-semibold hover:bg-red-50 transition-colors disabled:opacity-50">
              {instagramLoading ? 'Disconnecting...' : 'Disconnect'}
            </button>
          ) : (
            <button onClick={handleInstagramConnect} disabled={instagramLoading || instagramStatus === 'connecting'}
              className="px-4 py-2 bg-[#d4a017] text-white rounded-xl text-xs font-semibold hover:bg-[#b8941a] transition-colors disabled:opacity-50">
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

      {/* Mailchimp Card */}
      <div className="bg-gray-50 rounded-xl p-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-yellow-50 flex items-center justify-center">
            <Mail size={24} className="text-yellow-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900">Mailchimp</p>
            {mailchimpStatus === 'connected' ? (
              <p className="text-xs text-green-600">Connected{mailchimpAccount ? ` — ${mailchimpAccount}` : ''}</p>
            ) : mailchimpStatus === 'connecting' ? (
              <p className="text-xs text-yellow-600">Waiting for authorization...</p>
            ) : (
              <p className="text-xs text-gray-500">Sync subscribers and send campaigns via Mailchimp</p>
            )}
          </div>
          {mailchimpStatus === 'connected' ? (
            <button onClick={handleMailchimpDisconnect} disabled={mailchimpLoading}
              className="px-4 py-2 border border-red-200 text-red-600 rounded-xl text-xs font-semibold hover:bg-red-50 transition-colors disabled:opacity-50">
              {mailchimpLoading ? 'Disconnecting...' : 'Disconnect'}
            </button>
          ) : (
            <button onClick={handleMailchimpConnect} disabled={mailchimpLoading || mailchimpStatus === 'connecting'}
              className="px-4 py-2 bg-[#d4a017] text-white rounded-xl text-xs font-semibold hover:bg-[#b8941a] transition-colors disabled:opacity-50">
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

      <p className="text-xs text-gray-400">
        Powered by Composio — secure OAuth connections. Your credentials are never stored on our servers.
      </p>
    </div>
  );
};

export default IntegrationsSection;
