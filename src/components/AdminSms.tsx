"use client";
import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, limit, Timestamp } from 'firebase/firestore';
import { Send, MessageSquare, Loader2, Save, Gift } from 'lucide-react';
import { db } from '../firebase';
import { useAppStore } from '../store/useAppStore';
import { PLATFORM_TENANT_ID } from '../utils/tenant-scope';
import { authFetch } from '../utils/auth-fetch';
import { AdminSectionLabel, AdminBadge, statusTone } from './admin/AdminUI';

const GOLD = 'var(--brand-color, #B8962E)';

type Group = 'all_members' | 'all_donors' | 'tag';

interface Broadcast {
  id: string;
  message: string;
  recipientGroup: string;
  recipientCount: number;
  delivered?: number;
  failed?: number;
  status: string;
  scheduledAt?: string | null;
  createdAt?: string;
}

interface TriggerDef { key: string; label: string; placeholder: string }

const TRIGGERS: TriggerDef[] = [
  { key: 'event_registration', label: 'Event registration confirmed', placeholder: "Hi {name}, you're registered for {event}! See you {date}." },
  { key: 'checkin_thankyou', label: 'Check-in thank-you', placeholder: 'Thanks for joining us today, {name}! God bless you.' },
  { key: 'donation_thankyou', label: 'Donation thank-you', placeholder: 'Thank you for your gift of ${amount}, {name}. It makes a difference.' },
  { key: 'campaign_goal', label: 'Campaign goal reached', placeholder: 'We did it! {campaign} reached its goal. Thank you, {name}!' },
  { key: 'new_prayer', label: 'New prayer request (to admin)', placeholder: 'New prayer request from {name}: {prayer}' },
];

const AdminSms: React.FC = () => {
  // Fall back to the platform tenant for a super admin if the store value is
  // briefly null so the history loader and send guard resolve. On a tenant
  // subdomain currentTenantId is set and takes precedence.
  const { currentTenantId, isAuthReady, isSuperAdmin } = useAppStore();
  const tenantId = currentTenantId || (isSuperAdmin ? PLATFORM_TENANT_ID : null);
  const [tab, setTab] = useState<'broadcast' | 'automated'>('broadcast');

  // Broadcast
  const [group, setGroup] = useState<Group>('all_members');
  const [tag, setTag] = useState('');
  const [message, setMessage] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [history, setHistory] = useState<Broadcast[]>([]);

  // Automated templates
  const [templates, setTemplates] = useState<Record<string, { enabled: boolean; text: string }>>({});
  const [savingTpl, setSavingTpl] = useState(false);
  const [tplSaved, setTplSaved] = useState(false);

  // Text-to-Give
  const [t2g, setT2g] = useState<{ keyword: string; responseTemplate: string; enabled: boolean }>({ keyword: '', responseTemplate: '', enabled: false });
  const [savingT2g, setSavingT2g] = useState(false);
  const [t2gSaved, setT2gSaved] = useState(false);

  useEffect(() => {
    authFetch('/api/sms/config').then(r => r.json()).then(d => {
      setTemplates(d.templates || {});
      if (d.text2give) setT2g({ keyword: d.text2give.keyword || '', responseTemplate: d.text2give.responseTemplate || '', enabled: !!d.text2give.enabled });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isAuthReady || !tenantId) return;
    const q = query(collection(db, 'tenants', tenantId, 'smsBroadcasts'), orderBy('createdAt', 'desc'), limit(100));
    const unsub = onSnapshot(q, snap => setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Broadcast)), () => {});
    return () => unsub();
  }, [tenantId, isAuthReady]);

  // Preview recipient count when group/tag changes
  useEffect(() => {
    let cancelled = false;
    authFetch('/api/sms/broadcast', { method: 'POST', body: JSON.stringify({ recipientGroup: group, tag, previewOnly: true }) })
      .then(r => r.json())
      .then(d => { if (!cancelled) setRecipientCount(typeof d.recipientCount === 'number' ? d.recipientCount : null); })
      .catch(() => { if (!cancelled) setRecipientCount(null); });
    return () => { cancelled = true; };
  }, [group, tag]);

  const segments = Math.ceil(message.length / 160) || 1;

  const send = async () => {
    if (!message.trim()) { setSendMsg({ ok: false, text: 'Message is required.' }); return; }
    if (!tenantId) { setSendMsg({ ok: false, text: 'Could not determine your workspace. Please refresh and try again.' }); return; }
    setSending(true);
    setSendMsg(null);
    try {
      const resp = await authFetch('/api/sms/broadcast', {
        method: 'POST',
        body: JSON.stringify({ recipientGroup: group, tag, message, ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}) }),
      });
      const d = await resp.json();
      if (!resp.ok) { setSendMsg({ ok: false, text: d.error || 'Failed to send.' }); return; }
      if (d.scheduled) setSendMsg({ ok: true, text: `Scheduled for ${d.recipientCount} recipient(s).` });
      else setSendMsg({ ok: d.failed === 0, text: `Sent ${d.delivered} • ${d.failed} failed.` });
      setMessage(''); setScheduledAt('');
    } catch (e: any) {
      setSendMsg({ ok: false, text: e?.message || 'Failed to send.' });
    } finally {
      setSending(false);
    }
  };

  const saveTemplates = async () => {
    setSavingTpl(true);
    setTplSaved(false);
    try {
      await authFetch('/api/sms/config', { method: 'POST', body: JSON.stringify({ templates }) });
      setTplSaved(true);
      setTimeout(() => setTplSaved(false), 2500);
    } finally {
      setSavingTpl(false);
    }
  };

  const setTpl = (key: string, patch: Partial<{ enabled: boolean; text: string }>) =>
    setTemplates(t => ({ ...t, [key]: { enabled: false, text: '', ...t[key], ...patch } }));

  const saveT2g = async () => {
    setSavingT2g(true);
    setT2gSaved(false);
    try {
      await authFetch('/api/sms/config', { method: 'POST', body: JSON.stringify({ text2give: t2g }) });
      setT2gSaved(true);
      setTimeout(() => setT2gSaved(false), 2500);
    } finally {
      setSavingT2g(false);
    }
  };

  const fmtDate = (s?: string) => s ? new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

  return (
    <div className="max-w-2xl mx-auto" style={{ paddingBottom: 120 }}>
      <div className="flex gap-1 bg-stone-100 rounded-xl p-1 mb-6 w-fit mx-auto">
        <button onClick={() => setTab('broadcast')} className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${tab === 'broadcast' ? 'bg-white shadow-sm text-earth' : 'text-[color:var(--text-faint)]'}`}>Broadcasts</button>
        <button onClick={() => setTab('automated')} className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${tab === 'automated' ? 'bg-white shadow-sm text-earth' : 'text-[color:var(--text-faint)]'}`}>Automated</button>
      </div>

      {tab === 'broadcast' ? (
        <>
          <div className="bg-white rounded-brand-lg border border-stone-200 shadow-[var(--ds-sh-sm)] p-5 space-y-3">
            <div>
              <label className="block text-sm font-medium text-[color:var(--text-body)] mb-1.5">Recipients</label>
              <select value={group} onChange={e => setGroup(e.target.value as Group)} className="w-full px-4 py-2.5 border border-stone-200 rounded-xl text-sm bg-white focus:outline-none focus:border-gold">
                <option value="all_members">All Members</option>
                <option value="all_donors">All Donors</option>
                <option value="tag">Custom Tag</option>
              </select>
            </div>
            {group === 'tag' && (
              <input value={tag} onChange={e => setTag(e.target.value)} placeholder="Tag name" className="w-full px-4 py-2.5 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-gold" />
            )}
            <p className="text-xs text-warm-brown">Will send to <strong>{recipientCount ?? '…'}</strong> contact(s) with a phone number.</p>
            <div>
              <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Your message…" rows={4} className="w-full px-4 py-2.5 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-gold" />
              <div className="flex justify-between text-xs text-[color:var(--text-faint)] mt-1">
                <span>{message.length} chars</span>
                <span>{segments} SMS segment{segments > 1 ? 's' : ''}</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-[color:var(--text-body)] mb-1.5">Schedule <span className="text-[color:var(--text-faint)] font-normal">(optional)</span></label>
              <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} className="w-full px-4 py-2.5 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-gold" />
            </div>
            <button onClick={send} disabled={sending} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-brand text-white text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: GOLD }}>
              {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {scheduledAt ? 'Schedule' : 'Send now'}
            </button>
            {sendMsg && <div className={`p-3 rounded-xl text-sm ${sendMsg.ok ? 'bg-field-100 text-field-700' : 'bg-wheat-50 text-wheat-700'}`}>{sendMsg.text}</div>}
          </div>

          <AdminSectionLabel className="mt-8 mb-3 block">Sent History</AdminSectionLabel>
          {history.length === 0 ? (
            <div className="text-center py-10 text-[color:var(--text-faint)]"><MessageSquare size={36} className="mx-auto mb-2 opacity-30" /><p className="text-sm">No broadcasts yet</p></div>
          ) : (
            <>
              {/* Mobile history — mockup list card: gold SMS disc, message + meta
                  sub, status pill. Same `history` data, fmtDate, statusTone/AdminBadge
                  as the desktop list below — no wiring changed. */}
              <div className="lg:hidden bg-white rounded-brand-xl border border-stone-200 shadow-[var(--ds-sh-sm)] overflow-hidden">
                {history.map((b, i) => (
                  <div key={b.id} className={`flex items-start gap-3 px-3.5 py-3 ${i ? 'border-t border-stone-200' : ''}`}>
                    <div className="w-[38px] h-[38px] rounded-[10px] bg-[var(--surface-gold)] text-gold flex items-center justify-center shrink-0">
                      <MessageSquare size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-semibold text-earth leading-snug line-clamp-2">{b.message}</div>
                      <div className="text-[11.5px] text-[color:var(--text-faint)] mt-1">
                        {fmtDate(b.createdAt)} · {b.recipientCount} recipients
                        {b.status === 'sent' && ` · ${b.delivered || 0} delivered, ${b.failed || 0} failed`}
                        {b.status === 'scheduled' && ` · for ${fmtDate(b.scheduledAt || undefined)}`}
                      </div>
                    </div>
                    <AdminBadge tone={statusTone(b.status)} className="shrink-0">{b.status}</AdminBadge>
                  </div>
                ))}
              </div>

              {/* Desktop history — existing approved layout, unchanged (now lg-only). */}
            <div className="hidden lg:block bg-white rounded-brand-lg border border-stone-200 shadow-[var(--ds-sh-sm)] divide-y divide-stone-200">
              {history.map(b => (
                <div key={b.id} className="px-5 py-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-earth flex-1">{b.message}</span>
                    <AdminBadge tone={statusTone(b.status)}>{b.status}</AdminBadge>
                  </div>
                  <div className="text-xs text-[color:var(--text-faint)] mt-1.5">
                    {fmtDate(b.createdAt)} · {b.recipientCount} recipients
                    {b.status === 'sent' && ` · ${b.delivered || 0} delivered, ${b.failed || 0} failed`}
                    {b.status === 'scheduled' && ` · for ${fmtDate(b.scheduledAt || undefined)}`}
                  </div>
                </div>
              ))}
            </div>
            </>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-warm-brown">Toggle automated SMS and edit each message. Use placeholders like <code className="bg-stone-100 px-1 rounded">{'{name}'}</code>.</p>
          {TRIGGERS.map(t => {
            const tpl = templates[t.key] || { enabled: false, text: '' };
            return (
              <div key={t.key} className="bg-white rounded-2xl border border-stone-200 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-[color:var(--text-body)]">{t.label}</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={!!tpl.enabled} onChange={e => setTpl(t.key, { enabled: e.target.checked })} />
                    <div className="w-10 h-6 bg-stone-200 peer-checked:bg-gold rounded-full peer transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4" />
                  </label>
                </div>
                <textarea
                  value={tpl.text}
                  onChange={e => setTpl(t.key, { text: e.target.value })}
                  placeholder={t.placeholder}
                  rows={2}
                  className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-gold"
                />
              </div>
            );
          })}
          <button onClick={saveTemplates} disabled={savingTpl} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: GOLD }}>
            <Save size={15} /> {savingTpl ? 'Saving…' : 'Save Templates'}
          </button>
          {tplSaved && <span className="text-sm text-field-600 font-medium ml-2">✓ Saved</span>}

          {/* ── Text-to-Give ── */}
          <div className="bg-white rounded-2xl border border-stone-200 p-4 mt-6">
            <div className="flex items-center justify-between mb-1">
              <span className="font-display text-sm font-bold text-[color:var(--text-body)] flex items-center gap-1.5"><Gift size={15} style={{ color: GOLD }} /> Text-to-Give</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={t2g.enabled} onChange={e => setT2g({ ...t2g, enabled: e.target.checked })} />
                <div className="w-10 h-6 bg-stone-200 peer-checked:bg-gold rounded-full peer transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4" />
              </label>
            </div>
            <p className="text-xs text-[color:var(--text-faint)] mb-3">People text a keyword to your Twilio number and instantly receive a link to your giving page.</p>

            {t2g.enabled && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-[color:var(--text-body)] mb-1">Keyword</label>
                  <input value={t2g.keyword} onChange={e => setT2g({ ...t2g, keyword: e.target.value.toUpperCase() })}
                    placeholder="GIVE" className="w-full px-3 py-2 border border-stone-200 rounded-xl text-sm font-mono focus:outline-none focus:border-gold" />
                  <p className="text-[11px] text-[color:var(--text-faint)] mt-1">People text this word to receive a giving link.</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[color:var(--text-body)] mb-1">Reply Message</label>
                  <textarea value={t2g.responseTemplate} onChange={e => setT2g({ ...t2g, responseTemplate: e.target.value })}
                    rows={2} placeholder="Thank you! Give here: {link}"
                    className="w-full px-3 py-2 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-gold resize-none" />
                  <p className="text-[11px] text-[color:var(--text-faint)] mt-1"><code className="bg-stone-100 px-1 rounded">{'{link}'}</code> will be replaced with your giving page URL.</p>
                  <p className="text-[11px] text-[color:var(--text-faint)] mt-1">Preview link: <span className="font-mono">https://{tenantId || 'your-ministry'}.theharvest.app/?giving=1</span></p>
                </div>
                <div className="bg-stone-100 border border-stone-200 rounded-xl p-3">
                  <p className="text-[11px] text-warm-brown mb-1">Add this URL to your Twilio phone number as the inbound SMS webhook:</p>
                  <p className="text-xs font-mono text-[color:var(--text-body)] break-all">https://theharvest.app/api/sms/incoming</p>
                  <p className="text-[11px] text-[color:var(--text-faint)] mt-1">(Method: HTTP POST)</p>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={saveT2g} disabled={savingT2g} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: GOLD }}>
                    <Save size={15} /> {savingT2g ? 'Saving…' : 'Save Text-to-Give'}
                  </button>
                  {t2gSaved && <span className="text-sm text-field-600 font-medium">✓ Saved</span>}
                </div>
              </div>
            )}
            {!t2g.enabled && (
              <button onClick={saveT2g} disabled={savingT2g} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border border-stone-200 text-warm-brown disabled:opacity-50">
                <Save size={14} /> {savingT2g ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminSms;
