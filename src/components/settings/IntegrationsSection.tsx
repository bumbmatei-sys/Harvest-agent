"use client";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Instagram, Mail, Star, Send } from 'lucide-react';
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

  // Gmail is strictly per-admin — there is no "Primary" concept. Two admins in
  // one church each connect their own account and neither can send as the other,
  // so promoting one to tenant-wide would be exactly the wrong affordance.
  const [gmailStatus, setGmailStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [gmailLoading, setGmailLoading] = useState(false);
  // The address Gmail will send from. Declared by the admin rather than read
  // from the account — Harvest holds no scope that can read a Google profile.
  const [gmailSender, setGmailSender] = useState<string | null>(null);
  const [gmailSenderDraft, setGmailSenderDraft] = useState('');
  const [editingGmailSender, setEditingGmailSender] = useState(false);
  const [gmailSenderError, setGmailSenderError] = useState<string | null>(null);

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
      const [igResp, mcResp, gmResp] = await Promise.all([
        authFetch('/api/composio/instagram/status'),
        authFetch('/api/composio/mailchimp/status'),
        authFetch('/api/composio/gmail/status'),
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

      if (gmResp.ok) {
        const gmData = await gmResp.json();
        if (gmData.connected) setGmailStatus('connected');
        setGmailSender(gmData.senderEmail || null);
      }

      // Prefill the sending address with the Harvest login so confirming it is
      // one click. It is only a prefill: an admin who authorises a different
      // Google account must be able to say so, which is the whole point of
      // asking rather than assuming.
      try {
        const { auth } = await import('../../firebase');
        if (auth.currentUser?.email) setGmailSenderDraft(auth.currentUser.email);
      } catch { /* prefill is a convenience, not a requirement */ }
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

  const handleGmailConnect = async () => {
    const tid = await getTenantId();
    if (!tid) return;
    const senderEmail = gmailSenderDraft.trim();
    if (!senderEmail) {
      setGmailSenderError('Enter the Gmail address you want to send from.');
      return;
    }
    setGmailSenderError(null);
    setGmailLoading(true);
    try {
      const resp = await authFetch('/api/composio/gmail/connect', {
        method: 'POST',
        body: JSON.stringify({ tenantId: tid, senderEmail }),
      });
      const data = await resp.json();
      if (data.redirectUrl) {
        setGmailStatus('connecting');
        window.open(data.redirectUrl, '_blank');
        const pollInterval = setInterval(async () => {
          try {
            const statusResp = await authFetch('/api/composio/gmail/status');
            const statusData = await statusResp.json();
            if (statusData.connected) {
              setGmailStatus('connected');
              setGmailSender(statusData.senderEmail || null);
              clearInterval(pollInterval);
            }
          } catch { /* keep polling */ }
        }, 3000);
        const pollTimeout = setTimeout(() => clearInterval(pollInterval), 120000);
        pollingRef.current.intervals.push(pollInterval);
        pollingRef.current.timeouts.push(pollTimeout);
      } else {
        alert(data.error || 'Failed to initiate Gmail connection');
      }
    } catch (e) {
      console.error('Gmail connect error:', e);
      alert('Failed to connect Gmail. Please try again.');
    } finally {
      setGmailLoading(false);
    }
  };

  const handleGmailSenderSave = async () => {
    const senderEmail = gmailSenderDraft.trim();
    setGmailSenderError(null);
    try {
      const resp = await authFetch('/api/composio/gmail/address', {
        method: 'POST',
        body: JSON.stringify({ senderEmail }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data?.senderEmail) {
        setGmailSenderError(data?.error || 'Could not save that address.');
        return;
      }
      setGmailSender(data.senderEmail);
      setEditingGmailSender(false);
    } catch (e) {
      console.error('Gmail sending-address update error:', e);
      setGmailSenderError('Could not save that address.');
    }
  };

  const handleGmailDisconnect = async () => {
    setGmailLoading(true);
    try {
      await authFetch('/api/composio/gmail/disconnect', { method: 'POST' });
      setGmailStatus('disconnected');
      // Disconnect clears the stored address server-side; drop it here too so
      // the card cannot keep naming an account that is no longer linked.
      setGmailSender(null);
      setEditingGmailSender(false);
    } catch (e) {
      console.error('Gmail disconnect error:', e);
      alert('Failed to disconnect Gmail.');
    } finally {
      setGmailLoading(false);
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
      <p className="text-sm text-body">
        Connect your social media and email marketing platforms to automate newsletter distribution.
      </p>

      {/* Instagram Card */}
      <div className="bg-surface-tint rounded-xl p-4">
        <div className="flex items-center gap-4">
          <Instagram size={20} className="text-faint" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-strong">Instagram</p>
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
              <p className="text-xs text-muted">Auto-generate newsletters from your Instagram posts</p>
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
      <div className="bg-surface-tint rounded-xl p-4">
        <div className="flex items-center gap-4">
          <Mail size={20} className="text-faint" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-strong">Mailchimp</p>
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
              <p className="text-xs text-muted">Sync subscribers and send campaigns via Mailchimp</p>
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

      {/* Gmail Card */}
      <div className="bg-surface-tint rounded-xl p-4">
        <div className="flex items-center gap-4">
          <Send size={20} className="text-faint" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-strong">Gmail</p>
            {gmailStatus === 'connected' ? (
              <p className="text-xs text-green-600">
                {gmailSender
                  ? `Connected — sending as ${gmailSender}`
                  : 'Connected — confirm your sending address below before emailing'}
              </p>
            ) : gmailStatus === 'connecting' ? (
              <p className="text-xs text-yellow-600">Waiting for authorization...</p>
            ) : (
              <p className="text-xs text-muted">Email a CRM contact from your own Gmail account</p>
            )}
            {/* Say plainly what is being granted. Harvest asks for send-only
                access and cannot open, search or read the mailbox — the connect
                route refuses to start OAuth on any wider scope. */}
            <p className="text-[11px] text-faint mt-0.5">
              Send-only access. Harvest can never read your inbox.
            </p>

            {/* The sending address. Asked for rather than detected: Harvest holds
                no scope that can read which Google account was authorised, so an
                admin with two accounts is the one who has to say. */}
            {gmailStatus === 'connected' && !editingGmailSender ? (
              <button
                type="button"
                onClick={() => { setGmailSenderDraft(gmailSender || gmailSenderDraft); setEditingGmailSender(true); }}
                className="text-[11px] text-gold underline mt-1"
              >
                {gmailSender ? 'Change sending address' : 'Set sending address'}
              </button>
            ) : (
              <div className="mt-2">
                <label htmlFor="gmail-sender" className="block text-[11px] text-muted mb-1">
                  Send from this Gmail address
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="gmail-sender"
                    type="email"
                    value={gmailSenderDraft}
                    onChange={(e) => setGmailSenderDraft(e.target.value)}
                    placeholder="you@yourchurch.org"
                    className="flex-1 min-w-0 px-2 py-1 border border-line rounded-lg text-xs"
                  />
                  {gmailStatus === 'connected' && (
                    <>
                      <button type="button" onClick={handleGmailSenderSave}
                        className="px-3 py-1 bg-gold text-white rounded-lg text-xs font-medium">
                        Save
                      </button>
                      <button type="button" onClick={() => { setEditingGmailSender(false); setGmailSenderError(null); }}
                        className="px-3 py-1 border border-line text-body rounded-lg text-xs">
                        Cancel
                      </button>
                    </>
                  )}
                </div>
                {gmailSenderError && (
                  <p className="text-[11px] text-red-600 mt-1">{gmailSenderError}</p>
                )}
                {gmailStatus !== 'connected' && (
                  <p className="text-[11px] text-faint mt-1">
                    Must be the account you authorise. You can change it later.
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {gmailStatus === 'connected' ? (
              <button onClick={handleGmailDisconnect} disabled={gmailLoading}
                className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors disabled:opacity-50">
                {gmailLoading ? 'Disconnecting...' : 'Disconnect'}
              </button>
            ) : (
              <button onClick={handleGmailConnect} disabled={gmailLoading || gmailStatus === 'connecting'}
                className="px-4 py-2 bg-gold text-white rounded-lg text-sm font-medium hover:bg-gold transition-colors disabled:opacity-50">
                {gmailLoading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Connecting...
                  </span>
                ) : gmailStatus === 'connecting' ? 'Waiting...' : 'Connect'}
              </button>
            )}
          </div>
        </div>
      </div>

      <p className="text-xs text-faint">
        Powered by Composio — secure OAuth connections. Your credentials are never stored on our servers.
      </p>
    </div>
  );
};

export default IntegrationsSection;
