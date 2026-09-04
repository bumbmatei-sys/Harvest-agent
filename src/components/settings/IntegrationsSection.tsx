"use client";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CheckCircle2, Instagram, Loader2, Mail, Star, Send } from 'lucide-react';
import { authFetch } from '../../utils/auth-fetch';
import { TenantPlan } from '../../types/tenant.types';
import { getPlanFeatures } from '../../utils/plan-features';
import { hasPlatformOverride } from '../../utils/tenant-scope';
import { CONTROL_DENSITY } from '../layout/form-layout';
import { NAV_CLEARANCE } from './GivingStatementsSection';
import {
  INTEGRATION_PROVIDERS,
  IntegrationProviderId,
  getIntegrationProvider,
  isProviderAvailable,
} from './integration-providers';

/**
 * THE-296 — the touch floor below `sm`, Rule 4's density band above it.
 *
 * Identical to `GivingStatementsSection`'s and `OnboardingSection`'s, and for
 * the identical reason: 44px is a THUMB's floor and `DENSITY_PX.control` is 38
 * on purpose, capped by `DESKTOP_CONTROL_MAX_PX`. `min-h-` rather than `h-` so
 * the floor cannot lose a specificity race with a primitive's own height.
 *
 * 🔴 This card row had `px-4 py-2` buttons — 36px, under the floor on every
 * phone, on the controls that start and END an OAuth grant.
 */
export const ACTION_HEIGHT = `min-h-[44px] sm:min-h-[40px] ${CONTROL_DENSITY.action}`;
export const CONTROL_HEIGHT = `min-h-[44px] sm:min-h-[38px] ${CONTROL_DENSITY.control}`;

interface IntegrationsSectionProps {
  /** The tenant's tier. Each provider card is gated on the feature it serves —
   *  Gmail on `crm`, Instagram and Mailchimp on `newsletterAutomation` — so a
   *  tenant is never offered a connection its plan cannot use, AND (THE-225) on
   *  whether the tier is one that is sold at all, for the providers that hand
   *  over a live outbound send. Absent means no entitlement is known, and only a
   *  platform super admin sees the cards. */
  currentPlan?: TenantPlan;
  /** Platform-context super admin: sees every provider regardless of plan.
   *  Defaults to the real check so the component is safe to render bare. */
  platformOverride?: boolean;
}

const IntegrationsSection: React.FC<IntegrationsSectionProps> = ({ currentPlan, platformOverride }) => {
  const features = currentPlan ? getPlanFeatures(currentPlan) : null;
  const isPlatformOverride = platformOverride ?? hasPlatformOverride();
  /** One gate, applied per provider, keeping the `platformOverride || …` shape
   *  at every card. */
  const showProvider = (id: IntegrationProviderId): boolean =>
    isPlatformOverride || isProviderAvailable(getIntegrationProvider(id), features, currentPlan);
  const showInstagram = showProvider('instagram');
  const showMailchimp = showProvider('mailchimp');
  const showGmail = showProvider('gmail');
  const visibleProviders = INTEGRATION_PROVIDERS.filter(p => showProvider(p.id));

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
      // Only ask about providers this tenant can actually see. The routes are
      // untouched; a hidden card simply has nothing to report.
      const [igResp, mcResp, gmResp] = await Promise.all([
        showInstagram ? authFetch('/api/composio/instagram/status') : null,
        showMailchimp ? authFetch('/api/composio/mailchimp/status') : null,
        showGmail ? authFetch('/api/composio/gmail/status') : null,
      ]);

      if (igResp?.ok) {
        const igData = await igResp.json();
        if (igData.connected) {
          setInstagramStatus('connected');
          setInstagramAccount(igData.username || null);
        }
        setIsPrimaryInstagram(igData.isPrimary || false);
      }

      if (mcResp?.ok) {
        const mcData = await mcResp.json();
        if (mcData.connected) {
          setMailchimpStatus('connected');
          setMailchimpAccount(mcData.email || null);
        }
        setIsPrimaryMailchimp(mcData.isPrimary || false);
      }

      if (gmResp?.ok) {
        const gmData = await gmResp.json();
        if (gmData.connected) setGmailStatus('connected');
        setGmailSender(gmData.senderEmail || null);
      }

      // Prefill the sending address with the Harvest login so confirming it is
      // one click. It is only a prefill: an admin who authorises a different
      // Google account must be able to say so, which is the whole point of
      // asking rather than assuming.
      if (showGmail) {
        try {
          const { auth } = await import('../../firebase');
          if (auth.currentUser?.email) setGmailSenderDraft(auth.currentUser.email);
        } catch { /* prefill is a convenience, not a requirement */ }
      }
    } catch (e) {
      console.error('Failed to load integrations:', e);
    }
    setLoaded(true);
  }, [loaded, showInstagram, showMailchimp, showGmail]);

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
    <div className={`space-y-4 ${NAV_CLEARANCE}`}>
      {/* The intro describes the cards that are actually on screen. Derived
          from the visible providers' own concern, so a tenant with only the
          CRM provider is not told about newsletter distribution. */}
      <p className="text-sm text-body">
        {visibleProviders.some(p => p.concern === 'newsletter')
          ? 'Connect your social media and email marketing platforms to automate newsletter distribution.'
          : 'Connect your own Gmail account so you can email a CRM contact from Harvest.'}
      </p>

      {/* Instagram Card */}
      {showInstagram && (
      <div className="bg-surface-tint rounded-brand p-4">
        <div className="flex flex-wrap sm:flex-nowrap items-start gap-3 sm:gap-4">
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
              <p className="text-xs text-body flex items-center gap-1"><CheckCircle2 size={12} aria-hidden="true" className="shrink-0 text-gold" />Connected{instagramAccount ? ` — @${instagramAccount}` : ''}</p>
            ) : instagramStatus === 'connecting' ? (
              <p className="text-xs text-muted flex items-center gap-1"><Loader2 size={12} aria-hidden="true" className="shrink-0 animate-spin" />Waiting for authorization...</p>
            ) : (
              <p className="text-xs text-muted">Auto-generate newsletters from your Instagram posts</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            {instagramStatus === 'connected' && !isPrimaryInstagram && (
              <button
                onClick={handleMakePrimaryInstagram}
                className={`px-4 border border-gold text-gold rounded-brand text-sm font-medium hover:bg-surface-chip transition-colors ${ACTION_HEIGHT}`}
              >
                Make Primary
              </button>
            )}
            {instagramStatus === 'connected' ? (
              <button onClick={handleInstagramDisconnect} disabled={instagramLoading}
                className={`px-4 border border-danger text-danger-strong rounded-brand text-sm font-medium hover:bg-danger-tint transition-colors disabled:opacity-50 ${ACTION_HEIGHT}`}>
                {instagramLoading ? 'Disconnecting...' : 'Disconnect'}
              </button>
            ) : (
              <button onClick={handleInstagramConnect} disabled={instagramLoading || instagramStatus === 'connecting'}
                className={`px-4 bg-gold text-white rounded-brand text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 ${ACTION_HEIGHT}`}>
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
      )}

      {/* Mailchimp Card */}
      {showMailchimp && (
      <div className="bg-surface-tint rounded-brand p-4">
        <div className="flex flex-wrap sm:flex-nowrap items-start gap-3 sm:gap-4">
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
              <p className="text-xs text-body flex items-center gap-1"><CheckCircle2 size={12} aria-hidden="true" className="shrink-0 text-gold" />Connected{mailchimpAccount ? ` — ${mailchimpAccount}` : ''}</p>
            ) : mailchimpStatus === 'connecting' ? (
              <p className="text-xs text-muted flex items-center gap-1"><Loader2 size={12} aria-hidden="true" className="shrink-0 animate-spin" />Waiting for authorization...</p>
            ) : (
              <p className="text-xs text-muted">Sync subscribers and send campaigns via Mailchimp</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            {mailchimpStatus === 'connected' && !isPrimaryMailchimp && (
              <button
                onClick={handleMakePrimaryMailchimp}
                className={`px-4 border border-gold text-gold rounded-brand text-sm font-medium hover:bg-surface-chip transition-colors ${ACTION_HEIGHT}`}
              >
                Make Primary
              </button>
            )}
            {mailchimpStatus === 'connected' ? (
              <button onClick={handleMailchimpDisconnect} disabled={mailchimpLoading}
                className={`px-4 border border-danger text-danger-strong rounded-brand text-sm font-medium hover:bg-danger-tint transition-colors disabled:opacity-50 ${ACTION_HEIGHT}`}>
                {mailchimpLoading ? 'Disconnecting...' : 'Disconnect'}
              </button>
            ) : (
              <button onClick={handleMailchimpConnect} disabled={mailchimpLoading || mailchimpStatus === 'connecting'}
                className={`px-4 bg-gold text-white rounded-brand text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 ${ACTION_HEIGHT}`}>
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
      )}

      {/* Gmail Card */}
      {showGmail && (
      <div className="bg-surface-tint rounded-brand p-4">
        <div className="flex flex-wrap sm:flex-nowrap items-start gap-3 sm:gap-4">
          <Send size={20} className="text-faint" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-strong">Gmail</p>
            {gmailStatus === 'connected' ? (
              <p className="text-xs text-body flex items-center gap-1">
                <CheckCircle2 size={12} aria-hidden="true" className="shrink-0 text-gold" />{gmailSender
                  ? `Connected — sending as ${gmailSender}`
                  : 'Connected — confirm your sending address below before emailing'}
              </p>
            ) : gmailStatus === 'connecting' ? (
              <p className="text-xs text-muted flex items-center gap-1"><Loader2 size={12} aria-hidden="true" className="shrink-0 animate-spin" />Waiting for authorization...</p>
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
                className={`text-[11px] text-gold underline mt-1 inline-flex items-center ${ACTION_HEIGHT}`}
              >
                {gmailSender ? 'Change sending address' : 'Set sending address'}
              </button>
            ) : (
              <div className="mt-2">
                <label htmlFor="gmail-sender" className="block text-[11px] text-muted mb-1">
                  Send from this Gmail address
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id="gmail-sender"
                    type="email"
                    value={gmailSenderDraft}
                    onChange={(e) => setGmailSenderDraft(e.target.value)}
                    placeholder="you@yourchurch.org"
                    className={`flex-1 min-w-0 px-2 border border-line rounded-brand text-xs ${CONTROL_HEIGHT}`}
                  />
                  {gmailStatus === 'connected' && (
                    <>
                      <button type="button" onClick={handleGmailSenderSave}
                        className={`px-3 bg-gold text-white rounded-brand text-xs font-medium ${ACTION_HEIGHT}`}>
                        Save
                      </button>
                      <button type="button" onClick={() => { setEditingGmailSender(false); setGmailSenderError(null); }}
                        className={`px-3 border border-line text-body rounded-brand text-xs ${ACTION_HEIGHT}`}>
                        Cancel
                      </button>
                    </>
                  )}
                </div>
                {gmailSenderError && (
                  <p role="alert" className="text-[11px] text-danger-strong mt-1">{gmailSenderError}</p>
                )}
                {gmailStatus !== 'connected' && (
                  <p className="text-[11px] text-faint mt-1">
                    Must be the account you authorise. You can change it later.
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            {gmailStatus === 'connected' ? (
              <button onClick={handleGmailDisconnect} disabled={gmailLoading}
                className={`px-4 border border-danger text-danger-strong rounded-brand text-sm font-medium hover:bg-danger-tint transition-colors disabled:opacity-50 ${ACTION_HEIGHT}`}>
                {gmailLoading ? 'Disconnecting...' : 'Disconnect'}
              </button>
            ) : (
              <button onClick={handleGmailConnect} disabled={gmailLoading || gmailStatus === 'connecting'}
                className={`px-4 bg-gold text-white rounded-brand text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 ${ACTION_HEIGHT}`}>
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
      )}

      <p className="text-xs text-faint">
        Powered by Composio — secure OAuth connections. Your credentials are never stored on our servers.
      </p>
    </div>
  );
};

export default IntegrationsSection;
