"use client";
import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, limit, Timestamp } from 'firebase/firestore';
import { Send, MessageSquare, Loader2, Save } from 'lucide-react';
import { db } from '../firebase';
import { useAppStore } from '../store/useAppStore';
import { authFetch } from '../utils/auth-fetch';

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
  const { currentTenantId: tenantId, isAuthReady } = useAppStore();
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

  useEffect(() => {
    authFetch('/api/sms/config').then(r => r.json()).then(d => setTemplates(d.templates || {})).catch(() => {});
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

  const fmtDate = (s?: string) => s ? new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

  return (
    <div className="max-w-2xl mx-auto" style={{ paddingBottom: 120 }}>
      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab('broadcast')} className={`px-4 py-2 rounded-xl text-sm font-semibold ${tab === 'broadcast' ? 'text-white' : 'text-gray-600 bg-gray-100'}`} style={tab === 'broadcast' ? { backgroundColor: GOLD } : undefined}>Broadcasts</button>
        <button onClick={() => setTab('automated')} className={`px-4 py-2 rounded-xl text-sm font-semibold ${tab === 'automated' ? 'text-white' : 'text-gray-600 bg-gray-100'}`} style={tab === 'automated' ? { backgroundColor: GOLD } : undefined}>Automated</button>
      </div>

      {tab === 'broadcast' ? (
        <>
          <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Recipients</label>
              <select value={group} onChange={e => setGroup(e.target.value as Group)} className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:border-gold">
                <option value="all_members">All Members</option>
                <option value="all_donors">All Donors</option>
                <option value="tag">Custom Tag</option>
              </select>
            </div>
            {group === 'tag' && (
              <input value={tag} onChange={e => setTag(e.target.value)} placeholder="Tag name" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gold" />
            )}
            <p className="text-xs text-gray-500">Will send to <strong>{recipientCount ?? '…'}</strong> contact(s) with a phone number.</p>
            <div>
              <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Your message…" rows={4} className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gold" />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>{message.length} chars</span>
                <span>{segments} SMS segment{segments > 1 ? 's' : ''}</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Schedule <span className="text-gray-400 font-normal">(optional)</span></label>
              <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gold" />
            </div>
            <button onClick={send} disabled={sending} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: GOLD }}>
              {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {scheduledAt ? 'Schedule' : 'Send Now'}
            </button>
            {sendMsg && <div className={`p-3 rounded-xl text-sm ${sendMsg.ok ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>{sendMsg.text}</div>}
          </div>

          <h3 className="text-sm font-bold text-gray-700 mt-6 mb-3">Sent History</h3>
          {history.length === 0 ? (
            <div className="text-center py-10 text-gray-400"><MessageSquare size={36} className="mx-auto mb-2 opacity-30" /><p className="text-sm">No broadcasts yet</p></div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50">
              {history.map(b => (
                <div key={b.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-gray-900 truncate flex-1">{b.message}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${b.status === 'sent' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>{b.status}</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    {fmtDate(b.createdAt)} · {b.recipientCount} recipients
                    {b.status === 'sent' && ` · ${b.delivered || 0} delivered, ${b.failed || 0} failed`}
                    {b.status === 'scheduled' && ` · for ${fmtDate(b.scheduledAt || undefined)}`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">Toggle automated SMS and edit each message. Use placeholders like <code className="bg-gray-100 px-1 rounded">{'{name}'}</code>.</p>
          {TRIGGERS.map(t => {
            const tpl = templates[t.key] || { enabled: false, text: '' };
            return (
              <div key={t.key} className="bg-white rounded-2xl border border-gray-100 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-gray-800">{t.label}</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={!!tpl.enabled} onChange={e => setTpl(t.key, { enabled: e.target.checked })} />
                    <div className="w-10 h-6 bg-gray-200 peer-checked:bg-gold rounded-full peer transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4" />
                  </label>
                </div>
                <textarea
                  value={tpl.text}
                  onChange={e => setTpl(t.key, { text: e.target.value })}
                  placeholder={t.placeholder}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gold"
                />
              </div>
            );
          })}
          <button onClick={saveTemplates} disabled={savingTpl} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: GOLD }}>
            <Save size={15} /> {savingTpl ? 'Saving…' : 'Save Templates'}
          </button>
          {tplSaved && <span className="text-sm text-green-600 font-medium ml-2">✓ Saved</span>}
        </div>
      )}
    </div>
  );
};

export default AdminSms;
