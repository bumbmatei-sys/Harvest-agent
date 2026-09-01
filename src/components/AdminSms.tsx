"use client";
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, orderBy, onSnapshot, limit, Timestamp } from 'firebase/firestore';
import { Send, MessageSquare, Loader2, Save, Gift, AlertTriangle } from 'lucide-react';
import { db } from '../firebase';
import { useAppStore } from '../store/useAppStore';
import { PLATFORM_TENANT_ID } from '../utils/tenant-scope';
import { authFetch } from '../utils/auth-fetch';
import { AdminSectionLabel, AdminBadge, statusTone } from './admin/AdminUI';
// Rules 2 and 3 (form-layout.ts). Rule 1 is deliberately NOT applied here — see
// the note on the page root below.
import { FIELD_WIDTH, ACTION_BUTTON } from './layout/form-layout';
import { SMS_FEATURE_ENABLED } from '../lib/sms-feature';

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

/**
 * Automated SMS triggers offered to tenants.
 *
 * ONLY list a trigger here once something actually calls
 * `sendAutomatedSms(tenantId, '<key>', …)` server-side. A trigger in this list
 * with no caller is a toggle the admin can switch on that silently never fires.
 * Every key below is wired:
 *   • event_registration  → api/event-registration/submit
 *   • checkin_thankyou    → api/checkin/submit
 *   • pledge_confirmation → api/pledge/submit
 *
 * Three triggers were REMOVED from this list because they cannot work as-is.
 * Do not re-add them without building the missing piece first (saved templates
 * in Firestore are left untouched, so a re-added trigger keeps its text):
 *   • donation_thankyou — api/stripe/donate collects no phone number at all,
 *     so there is nothing to text. Needs phone collection on the donation form
 *     (a product change, not a wiring fix).
 *   • new_prayer — there is no prayer-requests API route (only cleanup/);
 *     prayer requests are written client-side straight to Firestore, so an
 *     admin notification needs a Cloud Function in the separate functions/
 *     deploy.
 *   • campaign_goal — the hook point exists (incrementCampaignRaised in the
 *     Stripe webhook) but firing needs goal-threshold + "did we just cross it"
 *     logic, otherwise it would text on every single gift.
 */
export const TRIGGERS: TriggerDef[] = [
  { key: 'event_registration', label: 'Event registration confirmed', placeholder: "Hi {name}, you're registered for {event}! See you {date}." },
  { key: 'checkin_thankyou', label: 'Check-in thank-you', placeholder: 'Thanks for joining us today, {name}! God bless you.' },
  { key: 'pledge_confirmation', label: 'Pledge confirmation', placeholder: 'Thanks {name}, your pledge of ${amount} has been recorded by {tenantName}.' },
];

// ─────────────────────────────────────────────────────────────────────────────
// SMS USAGE INDICATOR — surfaces the plan cap BEFORE an admin hits the wall:
// segments used this month vs cap, an 80% warning, and a hard block with an
// upgrade CTA at 100%. Reads /api/sms-usage (server-side, Admin SDK — the usage
// subcollection is default-deny to clients). Renders nothing for a super admin
// or an unmetered tier, so no empty card shows. Mirrors the RAG usage meter.
//
// The unit is SEGMENTS, and the copy says so explicitly. Twilio bills per
// segment and a body over 160 characters is more than one, so an admin reading
// "4,000" must not walk away believing it means 4,000 messages of any length.
//
// THE METER MUST MATCH WHO IS ACTUALLY CAPPED. The allotment applies only to
// sends on Harvest's own Twilio account (`source: 'platform'`, `metered: true`).
// A church sending on its OWN credentials is billed by Twilio directly and is
// subject to no limit, so it gets the volume card below instead — its own count
// and no number that looks like a ceiling. Showing a "1,234 / 4,000" bar to a
// tenant nothing would ever stop is exactly the advertised-vs-delivered gap
// THE-20 closed.
// ─────────────────────────────────────────────────────────────────────────────
interface SmsUsage {
  metered: boolean;
  /** Which Twilio account this tenant's sends go out on. 'byo' = their own
   * credentials (no cap applies); null = none configured, nothing to show. */
  source?: 'platform' | 'byo' | null;
  smsSegmentsUsed?: number;
  smsSegmentsCap?: number;
  month?: string;
}

export function segmentUnitNote(cap: number): string {
  return `${cap.toLocaleString('en-US')} SMS segments per month — a message over 160 characters counts as more than one.`;
}

/** The one place the BYO billing reality is stated, so the wording can't drift
 * between the usage card and the Twilio settings screen. */
export const BYO_BILLING_NOTE =
  "These messages go out on your own Twilio account, so Twilio bills you directly and your Harvest plan's monthly SMS allotment doesn't apply. A message over 160 characters counts as more than one segment.";

/** Volume-only card for a tenant on their own Twilio credentials: what they
 * sent, no cap, no upgrade CTA, and why. */
const ByoSmsVolume: React.FC<{ usage: SmsUsage }> = ({ usage }) => {
  const used = usage.smsSegmentsUsed ?? 0;
  return (
    <div className="bg-surface-raised rounded-brand-lg border border-line shadow-[var(--ds-sh-sm)] p-4 mb-4">
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: GOLD }}>Your Twilio account</span>
        <span className="text-xs font-bold text-strong">
          {used.toLocaleString('en-US')} segment{used === 1 ? '' : 's'} this month
        </span>
      </div>
      <p className="text-[11px] text-faint">{BYO_BILLING_NOTE}</p>
    </div>
  );
};

const SmsUsageMeter: React.FC<{ usage: SmsUsage; onUpgrade: () => void }> = ({ usage, onUpgrade }) => {
  const used = usage.smsSegmentsUsed ?? 0;
  const cap = usage.smsSegmentsCap ?? 0;
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const over = cap > 0 && used >= cap;
  const warn = pct >= 80 && !over;

  return (
    <div className="bg-surface-raised rounded-brand-lg border border-line shadow-[var(--ds-sh-sm)] p-4 mb-4">
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: GOLD }}>Plan usage</span>
        <span className={`text-xs font-bold ${over ? 'text-red-600' : 'text-strong'}`}>
          {used.toLocaleString('en-US')} / {cap.toLocaleString('en-US')} segments
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-sunken overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: over ? '#DC2626' : warn ? '#E67E22' : GOLD }}
        />
      </div>
      {/* SEGMENTS, not messages — stated wherever the number is shown. */}
      <p className="text-[11px] text-faint mt-1.5">
        {segmentUnitNote(cap)}
      </p>
      {warn && (
        <p className="text-[11px] font-semibold mt-1.5" style={{ color: '#B9770E' }}>
          {pct}% used — nearing your monthly SMS limit.
        </p>
      )}
      {over && (
        <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11.5px] font-semibold text-red-600 flex items-start gap-1.5">
            <AlertTriangle size={13} className="shrink-0 mt-px" />
            <span>Monthly SMS limit reached — sending is paused until the 1st.</span>
          </p>
          <button
            onClick={onUpgrade}
            className="shrink-0 px-3.5 py-1.5 rounded-brand text-white text-xs font-semibold"
            style={{ backgroundColor: GOLD }}
          >
            Upgrade plan
          </button>
        </div>
      )}
    </div>
  );
};

const AdminSmsScreen: React.FC = () => {
  const navigate = useNavigate();
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

  // SMS segment usage. Re-read after every send so the meter reflects what the
  // broadcast just consumed (a broadcast can move it a long way in one action).
  const [usage, setUsage] = useState<SmsUsage | null>(null);
  const [usageRefresh, setUsageRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    authFetch('/api/sms-usage')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) setUsage(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [usageRefresh]);

  // Only a metered (platform-account) tenant can hit a wall. A BYO tenant
  // reports metered:false, so the send button is never disabled for them —
  // there is no allotment of Harvest's for them to exhaust.
  const capReached =
    !!usage?.metered && (usage.smsSegmentsUsed ?? 0) >= (usage.smsSegmentsCap ?? Infinity);

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

  // Compose-box ESTIMATE only — it is never what the counter is billed by. The
  // meter is incremented by Twilio's own `num_segments` after each send. Shown
  // per recipient, because a broadcast costs this many segments times the
  // recipient count. Any emoji or non-Latin character forces UCS-2 encoding,
  // which fits 70 characters per segment instead of 160.
  const isUcs2 = /[^\u0000-\u007F]/.test(message);
  const perSegment = isUcs2 ? 70 : 160;
  const segments = Math.ceil(message.length / perSegment) || 1;

  const send = async () => {
    if (!message.trim()) { setSendMsg({ ok: false, text: 'Message is required.' }); return; }
    if (!tenantId) { setSendMsg({ ok: false, text: 'Could not determine your workspace. Please refresh and try again.' }); return; }
    setSending(true);
    setSendMsg(null);
    try {
      // Send-now only. Scheduling was removed: the API wrote a `scheduled`
      // broadcast doc and reported success, but nothing has ever processed that
      // collection (no cron, no worker) — the message was never sent. The route
      // now rejects `scheduledAt` outright so the UI and the API agree.
      const resp = await authFetch('/api/sms/broadcast', {
        method: 'POST',
        body: JSON.stringify({ recipientGroup: group, tag, message }),
      });
      const d = await resp.json();
      if (!resp.ok) { setSendMsg({ ok: false, text: d.error || 'Failed to send.' }); return; }

      // Report exactly what happened, including the two partial outcomes: a
      // broadcast that ran out of segments part-way through, and recipients
      // skipped because their number is not a US number. Neither is silent.
      const parts = [`Sent ${d.delivered}`];
      if (d.failed) parts.push(`${d.failed} failed`);
      if (d.skippedNonUs) parts.push(`${d.skippedNonUs} skipped (non-US number)`);
      if (d.capReached) parts.push(`${d.skipped} not sent — monthly SMS limit reached`);
      setSendMsg({
        ok: !d.failed && !d.capReached && !d.skippedNonUs,
        text: parts.join(' • ') + '.',
      });
      if (!d.capReached) setMessage('');
    } catch (e: any) {
      setSendMsg({ ok: false, text: e?.message || 'Failed to send.' });
    } finally {
      setSending(false);
      setUsageRefresh(n => n + 1);
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

  // Defaults live in their own object so they are spread rather than written as
  // literal keys before `...t[key]`, which TS flags as overwritten (TS2783).
  // Precedence is unchanged: defaults, then stored template, then the patch.
  const TPL_DEFAULTS = { enabled: false, text: '' };
  const setTpl = (key: string, patch: Partial<{ enabled: boolean; text: string }>) =>
    setTemplates(t => ({ ...t, [key]: { ...TPL_DEFAULTS, ...t[key], ...patch } }));

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

  // Rule 1 is NOT applied to this container, deliberately. Measured in
  // Chromium against the compiled CSS and the real admin shell, this screen
  // already renders 609px wide at 1024px and above — well inside
  // FORM_MEASURE's 940px form measure — so adopting FORM_MEASURE would
  // WIDEN it by 331px, which is the opposite of what this programme is for.
  // The one real defect in `max-w-2xl` is that 42rem is 672px below 1024px
  // and 609px above it (globals.css trims the rem base for desktop
  // density), so the cap silently loses 63px crossing that breakpoint.
  // Fixing that needs a measure form-layout.ts does not have, and minting a
  // third one is a change to the shared module — reported instead.
  return (
    <div className="max-w-2xl mx-auto" style={{ paddingBottom: 120 }}>
      <div className="flex gap-1 bg-surface-sunken rounded-xl p-1 mb-6 w-fit mx-auto">
        <button onClick={() => setTab('broadcast')} className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${tab === 'broadcast' ? 'bg-surface-raised shadow-xs text-strong' : 'text-faint'}`}>Broadcasts</button>
        <button onClick={() => setTab('automated')} className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${tab === 'automated' ? 'bg-surface-raised shadow-xs text-strong' : 'text-faint'}`}>Automated</button>
      </div>

      {usage?.metered
        ? <SmsUsageMeter usage={usage} onUpgrade={() => navigate('/admin/upgrade')} />
        : usage?.source === 'byo' && <ByoSmsVolume usage={usage} />}

      {tab === 'broadcast' ? (
        <>
          <div className="bg-surface-raised rounded-brand-lg border border-line shadow-[var(--ds-sh-sm)] p-5 space-y-3">
            <div>
              <label className="block text-sm font-medium text-body mb-1.5">Recipients</label>
              <select value={group} onChange={e => setGroup(e.target.value as Group)} className={`w-full px-4 py-2.5 border border-line rounded-xl text-sm bg-surface-raised focus:outline-hidden focus:border-gold ${FIELD_WIDTH.medium}`}>
                <option value="all_members">All Members</option>
                <option value="all_donors">All Donors</option>
                <option value="tag">Custom Tag</option>
              </select>
            </div>
            {group === 'tag' && (
              <input value={tag} onChange={e => setTag(e.target.value)} placeholder="Tag name" className={`w-full px-4 py-2.5 border border-line rounded-xl text-sm focus:outline-hidden focus:border-gold ${FIELD_WIDTH.medium}`} />
            )}
            <p className="text-xs text-muted">Will send to <strong>{recipientCount ?? '…'}</strong> contact(s) with a phone number.</p>
            {/* The US-only limit is stated up front, not discovered from a
                skipped-recipient count after the fact. */}
            <p className="text-[11px] text-faint">SMS is currently available for US numbers only — contacts with a non-US number are skipped and reported.</p>
            <div>
              <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Your message…" rows={4} className="w-full px-4 py-2.5 border border-line rounded-xl text-sm focus:outline-hidden focus:border-gold" />
              <div className="flex justify-between text-xs text-faint mt-1">
                <span>{message.length} chars</span>
                <span>
                  ~{segments} segment{segments > 1 ? 's' : ''} per recipient
                  {recipientCount ? ` · ~${segments * recipientCount} total` : ''}
                </span>
              </div>
            </div>
            {/* No schedule picker — see the comment in `send()`. Scheduled
                broadcasts were never delivered, so only immediate send is offered. */}
            {/* Hard block at 100%: the button is disabled here AND the server
                refuses the request (403 from the broadcast route), so this is a
                courtesy, not the enforcement. The upgrade CTA lives in the
                usage meter above. */}
            <button onClick={send} disabled={sending || capReached} className={`w-full sm:w-auto flex items-center justify-center gap-2 py-2.5 rounded-brand text-white text-sm font-semibold disabled:opacity-50 ${ACTION_BUTTON}`} style={{ backgroundColor: GOLD }}>
              {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {capReached ? 'Monthly SMS limit reached' : 'Send now'}
            </button>
            {sendMsg && <div className={`p-3 rounded-xl text-sm ${sendMsg.ok ? 'bg-field-100 text-field-700' : 'bg-wheat-50 text-wheat-700'}`}>{sendMsg.text}</div>}
          </div>

          <AdminSectionLabel className="mt-8 mb-3 block">Sent History</AdminSectionLabel>
          {history.length === 0 ? (
            <div className="text-center py-10 text-faint"><MessageSquare size={36} className="mx-auto mb-2 opacity-30" /><p className="text-sm">No broadcasts yet</p></div>
          ) : (
            <>
              {/* Mobile history — mockup list card: gold SMS disc, message + meta
                  sub, status pill. Same `history` data, fmtDate, statusTone/AdminBadge
                  as the desktop list below — no wiring changed. */}
              <div className="lg:hidden bg-surface-raised rounded-brand-xl border border-line shadow-[var(--ds-sh-sm)] overflow-hidden">
                {history.map((b, i) => (
                  <div key={b.id} className={`flex items-start gap-3 px-3.5 py-3 ${i ? 'border-t border-line' : ''}`}>
                    <div className="w-[38px] h-[38px] rounded-[10px] bg-[var(--surface-gold)] text-gold flex items-center justify-center shrink-0">
                      <MessageSquare size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-semibold text-strong leading-snug line-clamp-2">{b.message}</div>
                      <div className="text-[11.5px] text-faint mt-1">
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
            <div className="hidden lg:block bg-surface-raised rounded-brand-lg border border-line shadow-[var(--ds-sh-sm)] divide-y divide-stone-200">
              {history.map(b => (
                <div key={b.id} className="px-5 py-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-strong flex-1">{b.message}</span>
                    <AdminBadge tone={statusTone(b.status)}>{b.status}</AdminBadge>
                  </div>
                  <div className="text-xs text-faint mt-1.5">
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
          <p className="text-sm text-muted">Toggle automated SMS and edit each message. Use placeholders like <code className="bg-surface-sunken px-1 rounded">{'{name}'}</code>.</p>
          {TRIGGERS.map(t => {
            const tpl = templates[t.key] || { enabled: false, text: '' };
            return (
              <div key={t.key} className="bg-surface-raised rounded-2xl border border-line p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-body">{t.label}</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={!!tpl.enabled} onChange={e => setTpl(t.key, { enabled: e.target.checked })} />
                    <div className="w-10 h-6 bg-surface-chip peer-checked:bg-gold rounded-full peer transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-surface-raised after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4" />
                  </label>
                </div>
                <textarea
                  value={tpl.text}
                  onChange={e => setTpl(t.key, { text: e.target.value })}
                  placeholder={t.placeholder}
                  rows={2}
                  className="w-full px-3 py-2 border border-line rounded-lg text-sm focus:outline-hidden focus:border-gold"
                />
              </div>
            );
          })}
          <button onClick={saveTemplates} disabled={savingTpl} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: GOLD }}>
            <Save size={15} /> {savingTpl ? 'Saving…' : 'Save Templates'}
          </button>
          {tplSaved && <span className="text-sm text-field-600 font-medium ml-2">✓ Saved</span>}

          {/* ── Text-to-Give ── */}
          <div className="bg-surface-raised rounded-2xl border border-line p-4 mt-6">
            <div className="flex items-center justify-between mb-1">
              <span className="font-display text-sm font-bold text-body flex items-center gap-1.5"><Gift size={15} style={{ color: GOLD }} /> Text-to-Give</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={t2g.enabled} onChange={e => setT2g({ ...t2g, enabled: e.target.checked })} />
                <div className="w-10 h-6 bg-surface-chip peer-checked:bg-gold rounded-full peer transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-surface-raised after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4" />
              </label>
            </div>
            <p className="text-xs text-faint mb-3">People text a keyword to your Twilio number and instantly receive a link to your giving page.</p>

            {t2g.enabled && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-body mb-1">Keyword</label>
                  <input value={t2g.keyword} onChange={e => setT2g({ ...t2g, keyword: e.target.value.toUpperCase() })}
                    placeholder="GIVE" className={`w-full px-3 py-2 border border-line rounded-xl text-sm font-mono focus:outline-hidden focus:border-gold ${FIELD_WIDTH.short}`} />
                  <p className="text-[11px] text-faint mt-1">People text this word to receive a giving link.</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-body mb-1">Reply Message</label>
                  <textarea value={t2g.responseTemplate} onChange={e => setT2g({ ...t2g, responseTemplate: e.target.value })}
                    rows={2} placeholder="Thank you! Give here: {link}"
                    className="w-full px-3 py-2 border border-line rounded-xl text-sm focus:outline-hidden focus:border-gold resize-none" />
                  <p className="text-[11px] text-faint mt-1"><code className="bg-surface-sunken px-1 rounded">{'{link}'}</code> will be replaced with your giving page URL.</p>
                  <p className="text-[11px] text-faint mt-1">Preview link: <span className="font-mono">https://{tenantId || 'your-ministry'}.theharvest.app/?giving=1</span></p>
                </div>
                <div className="bg-surface-sunken border border-line rounded-xl p-3">
                  <p className="text-[11px] text-muted mb-1">Add this URL to your Twilio phone number as the inbound SMS webhook:</p>
                  <p className="text-xs font-mono text-body break-all">https://theharvest.app/api/sms/incoming</p>
                  <p className="text-[11px] text-faint mt-1">(Method: HTTP POST)</p>
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
              <button onClick={saveT2g} disabled={savingT2g} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border border-line text-muted disabled:opacity-50">
                <Save size={14} /> {savingT2g ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * THE-245 — the whole SMS admin screen, behind the master switch.
 *
 * 🔴 THIS COMPONENT IS WHERE TEXT-TO-GIVE LIVES, so hiding it hides a GIVING
 * capability as well as a messaging one. That is unavoidable rather than
 * incidental: Text-to-Give is inbound SMS end to end — the keyword arrives on
 * the public `/api/sms/incoming` webhook and the reply goes back out through
 * `sendSms` — so there is no state in which SMS is hidden and Text-to-Give
 * still works.
 *
 * A wrapper, not an early `return null`, so the screen's many hooks are never
 * conditionally called: while SMS is hidden nothing mounts, so no
 * `/api/sms/config`, `/api/sms-usage` or `smsBroadcasts` read is ever issued.
 * `AdminDashboard` already refuses to route here, so this is the second layer —
 * it also covers any future caller that mounts the screen directly.
 *
 * Nothing below is deleted. Flip SMS_FEATURE_ENABLED and the broadcast
 * composer, the automation templates and the Text-to-Give card all return
 * exactly as they were, reading the same saved configuration and the same
 * `smsBroadcasts` history.
 */
const AdminSms: React.FC = () => (SMS_FEATURE_ENABLED ? <AdminSmsScreen /> : null);

export default AdminSms;
