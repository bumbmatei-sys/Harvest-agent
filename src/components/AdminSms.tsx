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
import { FIELD_WIDTH, ACTION_BUTTON, CONTROL_DENSITY } from './layout/form-layout';
import { SMS_FEATURE_ENABLED } from '../lib/sms-feature';
// ── The installed primitives this screen composes from ──────────────────────
//
// 🔴 `ui/card` IS ADOPTED ONLY WHERE THE CORNER SURVIVES THE MERGE, and the
// two places it is not are named on the shells themselves. `ui/card` hard-codes
// `rounded-xl`, and `cn()` is `twMerge`: a `rounded-2xl` passed after it WINS
// outright (both are Tailwind scale steps, so twMerge drops the loser), while a
// `rounded-brand-lg`/`-xl` does NOT — twMerge does not know those keys, keeps
// BOTH classes, and the corner is then decided by stylesheet order rather than
// by this file. Measured: `twMerge('rounded-xl','rounded-2xl')` → `rounded-2xl`;
// `twMerge('rounded-xl','rounded-brand-lg')` → both survive.
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
/**
 * 🔴 THE-327 — THE NUMBER LIFECYCLE, MOUNTED HERE. It used to live in
 * Settings → Connected Services → SMS, three levels deep behind an accordion,
 * so a church that wanted to text had to buy its number on one screen and send
 * from another. It is the SAME component, imported rather than copied: a
 * second copy of a screen that spends money is how the two drift.
 */
import { SmsNumberPanel, hasUsableNumber, type NumberRecord } from './settings/SmsSection';
import { ANALYTICS_EVENTS } from '../lib/analytics/events';
import { trackProductEvent } from '../lib/analytics/client';

/**
 * The gold the brand token resolves to, and NOTHING ELSE.
 *
 * ⚠️ This used to be `var(--brand-color, #B8962E)` spelled into ten inline
 * `style` objects. The literal was not a safety net but a defect: it paints the
 * SAME hex in all four palettes whenever the token is briefly undefined, which
 * is the one moment a palette-aware surface must not fall back to Classic. The
 * screen now spells `bg-gold`/`text-gold`, the utilities that already resolve
 * `--brand-color`, so there is no second source for the brand colour here.
 */

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
// The unit is SEGMENTS, and the copy says so explicitly. The provider bills per
// segment and a body over 160 characters is more than one, so an admin reading
// "2,000" must not walk away believing it means 2,000 messages of any length.
//
// THE METER MUST MATCH WHO IS ACTUALLY CAPPED. ⚠️ SINCE THE-314 THAT IS
// EVERYONE WHO CAN SEND. Harvest resells on one vendor account and pays for
// every segment, so every tenant reports `source: 'platform'` and
// `metered: true`, and the meter below is the one an admin sees.
//
// The volume-only card that follows is now UNREACHABLE and kept for the months
// recorded before the swap — see the note on it.
// ─────────────────────────────────────────────────────────────────────────────
interface SmsUsage {
  metered: boolean;
  /** Which account this tenant's sends go out on. Always 'platform' since
   * THE-314 — Harvest owns every number; null = no number yet, nothing to
   * show. 'byo' is retained only so historical data keeps reading. */
  source?: 'platform' | 'byo' | null;
  smsSegmentsUsed?: number;
  smsSegmentsCap?: number;
  month?: string;
}

/** 🔴 THE-327 — why Broadcasts and Automated are not available yet. Stated as
 * a fact about the ministry's setup, not as an error: nothing has gone wrong,
 * the number simply has not been bought. */
export const NO_NUMBER_YET =
  'Broadcasts and automated messages need a number of your own. Buy one below and they turn on here — there is nowhere else to go.';

export function segmentUnitNote(cap: number): string {
  return `${cap.toLocaleString('en-US')} SMS segments per month — a message over 160 characters counts as more than one.`;
}

/** ⚠️ HISTORICAL ONLY, since THE-314. This described bring-your-own: a church
 * on its own Twilio credentials, billed by Twilio directly and subject to no
 * Harvest allotment. That arrangement no longer exists — Harvest resells and
 * pays for every segment — so the wording no longer claims Twilio bills anyone.
 * Saying otherwise on a billing surface would be a false claim, which is the
 * one thing this note has always existed to avoid. */
export const LEGACY_BYO_BILLING_NOTE =
  "These messages were sent before Harvest provided numbers, on an account of your own, so no Harvest plan allotment applied to them. A message over 160 characters counts as more than one segment.";

/** Volume-only card for the months recorded under bring-your-own: what was
 * sent, no cap, no upgrade CTA, and why.
 *
 * 🔴 NOTHING RENDERS THIS TODAY — `getSmsCredentialSource` never returns 'byo'
 * any more. It is kept rather than deleted so a tenant whose usage documents
 * still carry `smsSegmentsByo` reads correctly if that data is ever surfaced
 * here again. */
const ByoSmsVolume: React.FC<{ usage: SmsUsage }> = ({ usage }) => {
  const used = usage.smsSegmentsUsed ?? 0;
  return (
    /* ⚠️ `ui/card` REJECTED ON THIS SHELL — the one primitive that covers a card,
       and it cannot cover this one. It hard-codes `rounded-xl` (12px) and this
       shell is `rounded-brand-lg` (16px); twMerge does not know the `brand-*`
       keys, so it keeps BOTH and the corner is settled by stylesheet order.
       Composing here would ship two competing radii to move nothing. */
    <div className="bg-surface-raised rounded-brand-lg border border-line shadow-[var(--ds-sh-sm)] p-4 mb-4">
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-gold">Before Harvest numbers</span>
        <span className="text-xs font-bold text-strong">
          {used.toLocaleString('en-US')} segment{used === 1 ? '' : 's'} this month
        </span>
      </div>
      <p className="text-[11px] text-faint">{LEGACY_BYO_BILLING_NOTE}</p>
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
    /* ⚠️ `ui/card` REJECTED ON THIS SHELL, for the reason given on ByoSmsVolume:
       `rounded-brand-lg` (16px) and the primitive's own `rounded-xl` (12px) both
       survive twMerge, so the composed card would carry two corners. */
    <div className="bg-surface-raised rounded-brand-lg border border-line shadow-[var(--ds-sh-sm)] p-4 mb-4">
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-gold">Plan usage</span>
        <span className={`text-xs font-bold ${over ? 'text-red-600' : 'text-strong'}`}>
          {used.toLocaleString('en-US')} / {cap.toLocaleString('en-US')} segments
        </span>
      </div>
      {/* `ui/progress` — the installed bar, driven by the SAME `pct`. The track
          keeps its 1.5 (6px) height and sunken ground, and the fill keeps the
          three states, through the primitive's own data-slots rather than a
          hand-rolled track and an inline width. */}
      <Progress
        aria-hidden
        data-usage-bar
        value={pct}
        className={`block [&_[data-slot=progress-track]]:h-1.5 [&_[data-slot=progress-track]]:bg-surface-sunken [&_[data-slot=progress-indicator]]:rounded-full ${
          /* ⚠️ WRITTEN OUT IN FULL, never interpolated into the variant. Tailwind
             scans this file as TEXT: a class assembled at runtime is a class it
             never emits, and the fill would silently have no colour at all. */
          over ? '[&_[data-slot=progress-indicator]]:bg-red-600'
            : warn ? '[&_[data-slot=progress-indicator]]:bg-amber-600'
              : '[&_[data-slot=progress-indicator]]:bg-gold'
        }`}
      />
      {/* SEGMENTS, not messages — stated wherever the number is shown. */}
      <p className="text-[11px] text-faint mt-1.5">
        {segmentUnitNote(cap)}
      </p>
      {warn && (
        <p className="text-[11px] font-semibold mt-1.5 text-amber-700">
          {pct}% used — nearing your monthly SMS limit.
        </p>
      )}
      {over && (
        <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11.5px] font-semibold text-red-600 flex items-start gap-1.5">
            <AlertTriangle size={13} className="shrink-0 mt-px" />
            <span>Monthly SMS limit reached — sending is paused until the 1st.</span>
          </p>
          {/* ⚠️ `rounded-[12px]`, NOT `rounded-brand`. Measured against the
              compiled stylesheet: the utilities are emitted alphabetically, so
              `.rounded-lg` (the primitive's own, 4698) lands AFTER
              `.rounded-brand` (4548) at equal specificity and WINS. twMerge
              cannot drop `rounded-lg` for a key it does not know, so a Button
              given `rounded-brand` silently renders 8px. `rounded-[12px]` is
              `borderRadius.brand`'s own literal, and twMerge DOES drop
              `rounded-lg` for it — so the corner stays exactly 12px. */}
          <Button
            onClick={onUpgrade}
            className={`shrink-0 h-11 border-0 px-3.5 py-1.5 rounded-[12px] bg-gold text-white text-xs font-semibold hover:bg-gold ${CONTROL_DENSITY.action}`}
          >
            Upgrade plan
          </Button>
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
  /**
   * 🔴 THE-327 — SETUP IS A STATE, NOT A THIRD TAB YOU HAVE TO FIND.
   *
   * A church with NO number cannot broadcast at all: there is no from-number,
   * so the composer below is a form that can only fail. Making setup a third
   * tab would leave that church looking at an inert broadcast form and hunting
   * for the tab that unblocks it — the same "go to another place for one job"
   * the founder objected to, moved one screen closer.
   *
   * So: while there is no number the screen IS the setup panel — `view` below
   * collapses to 'number' and the sending tabs are DISABLED, with
   * `NO_NUMBER_YET` saying why. They are disabled rather than removed on
   * purpose: a church that cannot broadcast yet still needs to see that
   * broadcasting is what this screen is for, and a strip that appeared only
   * later would leave a static render with no controls at all for THE-320's
   * Chromium ladder to measure.
   *
   * The THIRD tab — Number — is what keeps the lifecycle reachable after the
   * purchase. It does not stop there: status, the identity check and release
   * all have to stay one click away, and burying them again is the defect.
   */
  const [tab, setTab] = useState<'broadcast' | 'automated' | 'number'>('broadcast');
  const [numberState, setNumberState] = useState<{ loaded: boolean; number: NumberRecord | null }>(
    { loaded: false, number: null },
  );
  // Identity, not a fresh object per render: the panel takes this as a prop and
  // lists it in a `useCallback` dependency, so a new function each render would
  // re-run its effect forever.
  const onNumberState = React.useCallback(
    (s: { loaded: boolean; number: NumberRecord | null }) => setNumberState(s),
    [],
  );
  /** 🔴 The SAME predicate the panel normalises with — imported, not restated.
   * A released number is not a number, and a screen that disagreed with the
   * panel about that would offer a Send button for a number given up. */
  const hasNumber = hasUsableNumber(numberState.number);
  /**
   * 🔴 THE GATE IS READ HERE, NOT INFERRED FROM THE PANEL'S MOUNT.
   *
   * The panel is only mounted on the number view, so a screen that waited for
   * the panel to report before deciding which view to show could never leave
   * the number view — and, more quietly, would render NOTHING measurable on a
   * server render, where no effect runs at all. THE-320's Chromium ladder
   * measures this screen's composer, its native `<select>` and its send action
   * from a static render, so the settled default has to be the composer.
   *
   * ⚠️ ONE READ EACH, NOT TWO OWNERS. This is the gate's initial answer; every
   * answer AFTER it arrives through the panel's `onState`, so a purchase or a
   * release updates the gate immediately without this screen polling. Both
   * sides normalise through `hasUsableNumber`, so they cannot disagree.
   */
  useEffect(() => {
    let cancelled = false;
    authFetch('/api/sms/numbers')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setNumberState({ loaded: true, number: (d?.number ?? null) as NumberRecord | null }); })
      .catch(() => { if (!cancelled) setNumberState({ loaded: true, number: null }); });
    return () => { cancelled = true; };
  }, []);

  /** Setup takes over only once the gate has ANSWERED and the answer is "no
   * number". Before that the screen is what it has always been, so a static
   * render and the first paint both show the composer rather than a flash of
   * setup that a church with a number never needed to see. */
  const view = numberState.loaded && !hasNumber ? 'number' : tab;

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

  // 🔴 Every tenant that can send is metered since THE-314, so this wall is now
  // reachable by all of them. A tenant with no number at all reports
  // metered:false and simply has nothing to send with.
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
  // meter is incremented by the provider's own segment count after each send. Shown
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
      // THE-360 - the send RAN and ran out of segments part-way through. That
      // is a church hitting a wall mid-action, which is the moment; the
      // disabled button on a later visit is the consequence, not the event.
      // `d.skipped` is rendered to the admin and goes no further - how many
      // recipients a church has is a fact about that church's roster.
      if (d.capReached) trackProductEvent(ANALYTICS_EVENTS.PLAN_LIMIT_REACHED, { limitKind: 'sms' });
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
    /* The 120px bottom clearance is now a class, not an inline style — the same
       120px, moved out of a `style` object.
       🔴 IT IS STATED HERE RATHER THAN INHERITED. The admin shell's bottom nav is
       `fixed bottom-0` at `z-[100]`, and the clearance class that shell reaches
       for compiles to nothing in this app; the member shell was fixed and the
       admin shell was not. So this screen carries its own clearance and does not
       depend on the shell's.
       ⚠️ Two things are deliberately NOT spelled in this comment: the shell's
       inert class name, which THE-295's sweep enumerates every mention of, and a
       PR number, because the colour-literal guard in
       admin-data-screens.desktop-layout.test.tsx reads `#` followed by hex
       digits as a raw colour and a PR number is not a colour. */
    <div className="max-w-2xl mx-auto pb-[120px]">
      {/* `ui/tabs` — the switcher is a real tablist with roving focus and
          `aria-selected`, which two plain buttons never were. The pill shell,
          its 1px inset and the 4/1.5 trigger padding are unchanged; the
          primitive's own `h-[calc(100%-1px)] flex-1 text-sm rounded-md px-1.5`
          are each dropped by twMerge for the value already here. */}
      {/* 🔴 THE-327 — THREE TABS, AND THE SWITCHER IS ALWAYS DRAWN.
          `Number` joins Broadcasts and Automated so the whole of SMS is on one
          screen, spelled identically to the two triggers that were already
          here. What the no-number state changes is not whether the switcher
          exists but where it can GO: sending is DISABLED rather than hidden,
          because a church that cannot broadcast yet still needs to see that
          broadcasting is what this screen is for. Hiding the triggers would
          also make the setup state unmeasurable — server rendering runs no
          effect, so `hasNumber` is false there and a conditional strip would
          leave this screen with no controls at all for THE-320's Chromium
          ladder to read. */}
      <Tabs value={view} onValueChange={(v) => setTab(v as 'broadcast' | 'automated' | 'number')} className="w-fit mx-auto mb-6 gap-0">
        <TabsList className="flex gap-1 bg-surface-sunken rounded-xl p-1 h-auto w-fit">
          <TabsTrigger disabled={!hasNumber} value="broadcast" className="h-auto flex-none border-0 px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors min-h-[44px] sm:min-h-0 text-faint data-active:bg-surface-raised data-active:shadow-xs data-active:text-strong disabled:opacity-50">Broadcasts</TabsTrigger>
          <TabsTrigger disabled={!hasNumber} value="automated" className="h-auto flex-none border-0 px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors min-h-[44px] sm:min-h-0 text-faint data-active:bg-surface-raised data-active:shadow-xs data-active:text-strong disabled:opacity-50">Automated</TabsTrigger>
          <TabsTrigger value="number" className="h-auto flex-none border-0 px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors min-h-[44px] sm:min-h-0 text-faint data-active:bg-surface-raised data-active:shadow-xs data-active:text-strong">Number</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Said once, where the disabled triggers are, rather than left for an
          admin to infer from a control that does not respond. */}
      {numberState.loaded && !hasNumber && (
        <Alert className="p-3 gap-0 rounded-xl text-sm mb-4 bg-surface-sunken border border-line">
          <AlertDescription className="text-[11.5px] text-muted">{NO_NUMBER_YET}</AlertDescription>
        </Alert>
      )}

      {usage?.metered
        ? <SmsUsageMeter usage={usage} onUpgrade={() => navigate('/admin/upgrade')} />
        : usage?.source === 'byo' && <ByoSmsVolume usage={usage} />}

      {/* 🔴 THE-327 — the number view. Also the whole screen while there is no
          number: `view` collapses to 'number' until one exists, so a church
          that cannot send is shown how to start rather than a composer that
          can only fail. `embedded` suppresses the panel's own 120px clearance,
          because this page root already carries `pb-[120px]` above. */}
      {view === 'number' ? (
        <SmsNumberPanel embedded onState={onNumberState} />
      ) : view === 'broadcast' ? (
        <>
          {/* ⚠️ `ui/card` REJECTED — `rounded-brand-lg` again. Measured against the
              compiled stylesheet: `.rounded-xl` is emitted AFTER `.rounded-brand-lg`
              at equal specificity, so a composed Card would not merely carry two
              corners, it would render the primitive's 12px and DROP this shell's
              16px. That is a measured change this ticket may not make. */}
          <div className="bg-surface-raised rounded-brand-lg border border-line shadow-[var(--ds-sh-sm)] p-5 space-y-3">
            <div>
              <Label htmlFor="sms-recipients" className="block leading-5 text-sm font-medium text-body mb-1.5">Recipients</Label>
              {/* ⚠️ `ui/select` REJECTED, and this is the one control where the
                  rejection is not about a corner. Two independent reasons:
                    · it is not a `<select>`. base-ui renders a button + popup
                      listbox, and the width guard in
                      admin-data-screens.desktop-layout.test.tsx finds this field
                      by `label → parent → input,select,textarea` to assert its
                      FIELD_WIDTH.medium cap. A listbox button is none of those,
                      so composing here would blind an existing measured guard.
                    · it pins its own height at `data-[size=default]:h-8` — an
                      attribute selector that outranks Rule 4 exactly as THE-317
                      measured, and 32px is under the 44px touch floor.
                  The native control keeps both properties for free. */}
              <select id="sms-recipients" value={group} onChange={e => setGroup(e.target.value as Group)} className={`w-full px-4 py-2.5 border border-line rounded-xl text-sm bg-surface-raised focus:outline-hidden focus:border-gold min-h-[44px] sm:min-h-0 ${FIELD_WIDTH.medium}`}>
                <option value="all_members">All Members</option>
                <option value="all_donors">All Donors</option>
                <option value="tag">Custom Tag</option>
              </select>
            </div>
            {group === 'tag' && (
              <Input value={tag} onChange={e => setTag(e.target.value)} placeholder="Tag name" className={`h-auto w-full px-4 py-2.5 border-line rounded-xl text-sm bg-transparent focus-visible:ring-0 focus-visible:border-gold min-h-[44px] sm:min-h-0 ${FIELD_WIDTH.medium}`} />
            )}
            <p className="text-xs text-muted">Will send to <strong>{recipientCount ?? '…'}</strong> contact(s) with a phone number.</p>
            {/* The US-only limit is stated up front, not discovered from a
                skipped-recipient count after the fact. */}
            <p className="text-[11px] text-faint">SMS is currently available for US numbers only — contacts with a non-US number are skipped and reported.</p>
            <div>
              <Textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Your message…" rows={4} className="field-sizing-fixed min-h-0 w-full px-4 py-2.5 border-line rounded-xl text-sm bg-transparent focus-visible:ring-0 focus-visible:border-gold" />
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
            {/* `rounded-[12px]` rather than `rounded-brand`, for the reason set
                out on the upgrade Button above. */}
            <Button onClick={send} disabled={sending || capReached} className={`h-11 w-full sm:w-auto border-0 flex items-center justify-center gap-2 py-2.5 px-2.5 rounded-[12px] bg-gold hover:bg-gold text-white text-sm font-semibold disabled:opacity-50 min-h-[44px] sm:min-h-0 ${ACTION_BUTTON} ${CONTROL_DENSITY.action}`}>
              {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {capReached ? 'Monthly SMS limit reached' : 'Send now'}
            </Button>
            {/* `ui/alert` — the send outcome is a status message, and it now says
                so to a screen reader (`role="alert"`) instead of being a bare
                div. Both tones keep the exact tokens they had. */}
            {sendMsg && (
              <Alert className={`p-3 rounded-xl text-sm ${sendMsg.ok ? 'bg-field-100 text-field-700' : 'bg-wheat-50 text-wheat-700'}`}>
                <AlertDescription className="text-inherit">{sendMsg.text}</AlertDescription>
              </Alert>
            )}
          </div>

          <AdminSectionLabel className="mt-8 mb-3 block">Sent History</AdminSectionLabel>
          {history.length === 0 ? (
            /* `ui/empty` — the installed empty state. The primitive's own
               `gap-4 p-6 rounded-xl border-dashed flex-1` are each dropped for
               the values already here, so the glyph, its 36px size, the 30%
               opacity and the 10-unit vertical rhythm are unchanged. */
            <Empty className="flex-none gap-0 rounded-none border-none p-0 py-10 text-center text-faint">
              <EmptyHeader className="gap-0">
                <EmptyMedia className="bg-transparent size-auto mb-2 opacity-30 [&_svg]:size-9">
                  <MessageSquare size={36} />
                </EmptyMedia>
                <EmptyTitle className="text-sm font-normal text-faint">No broadcasts yet</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              {/* Mobile history — mockup list card: gold SMS disc, message + meta
                  sub, status pill. Same `history` data, fmtDate, statusTone/AdminBadge
                  as the desktop list below — no wiring changed. */}
              {/* ⚠️ `ui/card` REJECTED on this shell — `rounded-brand-xl` is 24px
                  and the primitive's `rounded-xl` is emitted after it, so a
                  composed Card would render 12px and lose the 24px corner
                  outright. The ROWS inside are `ui/item`, which is the primitive
                  a row of things actually maps to. */}
              <div className="lg:hidden bg-surface-raised rounded-brand-xl border border-line shadow-[var(--ds-sh-sm)] overflow-hidden">
                {history.map((b, i) => (
                  <Item
                    key={b.id}
                    className={`flex-nowrap items-start gap-3 rounded-none border-0 px-3.5 py-3 ${i ? 'border-t border-line' : ''}`}
                  >
                    <ItemMedia
                      variant="icon"
                      className="w-[38px] h-[38px] rounded-[10px] bg-[var(--surface-gold)] text-gold shrink-0 group-has-data-[slot=item-description]/item:translate-y-0 [&_svg]:size-4"
                    >
                      <MessageSquare size={16} />
                    </ItemMedia>
                    <ItemContent className="flex-1 min-w-0 gap-0">
                      <ItemTitle className="w-auto line-clamp-2 block text-[13.5px] font-semibold text-strong leading-snug">{b.message}</ItemTitle>
                      <ItemDescription className="line-clamp-none text-[11.5px] text-faint mt-1 leading-normal">
                        {fmtDate(b.createdAt)} · {b.recipientCount} recipients
                        {b.status === 'sent' && ` · ${b.delivered || 0} delivered, ${b.failed || 0} failed`}
                        {b.status === 'scheduled' && ` · for ${fmtDate(b.scheduledAt || undefined)}`}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions className="gap-0">
                      <AdminBadge tone={statusTone(b.status)} className="shrink-0">{b.status}</AdminBadge>
                    </ItemActions>
                  </Item>
                ))}
              </div>

              {/* Desktop history — existing approved layout, unchanged (now lg-only). */}
            {/* ⚠️ `ui/card` REJECTED here too — `rounded-brand-lg`, same measured
                reason. The rows are `ui/item`. */}
            <div className="hidden lg:block bg-surface-raised rounded-brand-lg border border-line shadow-[var(--ds-sh-sm)] divide-y divide-line">
              {history.map(b => (
                <Item key={b.id} className="flex-col items-stretch gap-0 rounded-none border-0 px-5 py-4">
                  <div className="flex items-center justify-between gap-2">
                    <ItemTitle className="w-auto line-clamp-none block text-sm font-normal text-strong leading-5 flex-1">{b.message}</ItemTitle>
                    <ItemActions className="gap-0">
                      <AdminBadge tone={statusTone(b.status)}>{b.status}</AdminBadge>
                    </ItemActions>
                  </div>
                  <ItemDescription className="line-clamp-none text-xs text-faint mt-1.5 leading-normal">
                    {fmtDate(b.createdAt)} · {b.recipientCount} recipients
                    {b.status === 'sent' && ` · ${b.delivered || 0} delivered, ${b.failed || 0} failed`}
                    {b.status === 'scheduled' && ` · for ${fmtDate(b.scheduledAt || undefined)}`}
                  </ItemDescription>
                </Item>
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
              /* ✅ `ui/card` IS ADOPTED HERE. This shell is `rounded-2xl`, which
                 twMerge DOES resolve against the primitive's `rounded-xl` —
                 measured: `twMerge('rounded-xl','rounded-2xl')` → `rounded-2xl`.
                 One corner reaches the DOM, and it is this shell's own. */
              <Card key={t.key} size="sm" className="gap-0 py-0 overflow-visible ring-0 bg-surface-raised rounded-2xl border border-line p-4 text-body">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-body">{t.label}</span>
                  {/* ⚠️ `ui/switch` REJECTED, and the reason is reachability, not
                      taste. Its Thumb carries a HARD-CODED className inside
                      `ui/switch.tsx` — `group-data-[size=default]/switch:size-4`
                      and `translate-x-[calc(100%-2px)]` — that no caller prop can
                      reach. The Root's track can be pinned back to this 40×24
                      from outside; the 20px thumb at its 2px inset cannot. So
                      composing would move the thumb to 16px, and this ticket may
                      not move a measured value. Editing the shared primitive to
                      suit one screen is not this ticket's to do either.
                      ✅ The 44px touch floor below `sm` IS applied, on the label
                      that is the actual tappable target. */}
                  <label className="relative inline-flex items-center cursor-pointer min-h-[44px] sm:min-h-0">
                    <input type="checkbox" className="sr-only peer" checked={!!tpl.enabled} onChange={e => setTpl(t.key, { enabled: e.target.checked })} />
                    <div className="w-10 h-6 bg-surface-chip peer-checked:bg-gold rounded-full peer transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-surface-raised after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4" />
                  </label>
                </div>
                <Textarea
                  value={tpl.text}
                  onChange={e => setTpl(t.key, { text: e.target.value })}
                  placeholder={t.placeholder}
                  rows={2}
                  className="field-sizing-fixed min-h-0 w-full px-3 py-2 border-line rounded-lg text-sm bg-transparent focus-visible:ring-0 focus-visible:border-gold"
                />
              </Card>
            );
          })}
          {/* `rounded-xl` here, not `rounded-brand` — this button already spelled
              `rounded-xl`, which twMerge resolves cleanly against the
              primitive's `rounded-lg`, so no override literal is needed. */}
          <Button onClick={saveTemplates} disabled={savingTpl} className={`h-11 border-0 flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gold hover:bg-gold text-white text-sm font-semibold disabled:opacity-50 ${CONTROL_DENSITY.action}`}>
            <Save size={15} /> {savingTpl ? 'Saving…' : 'Save Templates'}
          </Button>
          {tplSaved && <span className="text-sm text-field-600 font-medium ml-2">✓ Saved</span>}

          {/* ── Text-to-Give ── */}
          {/* ✅ `ui/card` ADOPTED — `rounded-2xl` again, so the corner resolves. */}
          <Card size="sm" className="gap-0 py-0 overflow-visible ring-0 bg-surface-raised rounded-2xl border border-line p-4 mt-6 text-body">
            <div className="flex items-center justify-between mb-1">
              <span className="font-display text-sm font-bold text-body flex items-center gap-1.5"><Gift size={15} className="text-gold" /> Text-to-Give</span>
              {/* `ui/switch` rejected for the reason given on the trigger rows. */}
              <label className="relative inline-flex items-center cursor-pointer min-h-[44px] sm:min-h-0">
                <input type="checkbox" className="sr-only peer" checked={t2g.enabled} onChange={e => setT2g({ ...t2g, enabled: e.target.checked })} />
                <div className="w-10 h-6 bg-surface-chip peer-checked:bg-gold rounded-full peer transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-surface-raised after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4" />
              </label>
            </div>
            <p className="text-xs text-faint mb-3">People text a keyword to your ministry&apos;s number and instantly receive a link to your giving page.</p>

            {t2g.enabled && (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="sms-t2g-keyword" className="block leading-4 text-xs font-semibold text-body mb-1">Keyword</Label>
                  <Input id="sms-t2g-keyword" value={t2g.keyword} onChange={e => setT2g({ ...t2g, keyword: e.target.value.toUpperCase() })}
                    placeholder="GIVE" className={`h-auto w-full px-3 py-2 border-line rounded-xl text-sm font-mono bg-transparent focus-visible:ring-0 focus-visible:border-gold min-h-[44px] sm:min-h-0 ${FIELD_WIDTH.short}`} />
                  <p className="text-[11px] text-faint mt-1">People text this word to receive a giving link.</p>
                </div>
                <div>
                  <Label htmlFor="sms-t2g-reply" className="block leading-4 text-xs font-semibold text-body mb-1">Reply Message</Label>
                  <Textarea id="sms-t2g-reply" value={t2g.responseTemplate} onChange={e => setT2g({ ...t2g, responseTemplate: e.target.value })}
                    rows={2} placeholder="Thank you! Give here: {link}"
                    className="field-sizing-fixed min-h-0 w-full px-3 py-2 border-line rounded-xl text-sm bg-transparent focus-visible:ring-0 focus-visible:border-gold resize-none" />
                  <p className="text-[11px] text-faint mt-1"><code className="bg-surface-sunken px-1 rounded">{'{link}'}</code> will be replaced with your giving page URL.</p>
                  <p className="text-[11px] text-faint mt-1">Preview link: <span className="font-mono">https://{tenantId || 'your-ministry'}.theharvest.app/?giving=1</span></p>
                </div>
                {/* `ui/alert` — a standing note about the number's wiring. It is
                    informational, so it keeps its sunken ground and its tokens;
                    the primitive supplies the `role="alert"` semantics and the
                    title/description slots the bare div never had. */}
                <Alert className="bg-surface-sunken border border-line rounded-xl p-3 gap-0">
                  {/* 🔴 There is nothing for an admin to configure any more.
                      Harvest holds the vendor account and points every number
                      it buys at this endpoint centrally, so a church that once
                      had to paste a webhook URL into a Twilio console now has
                      no console and no step to miss. */}
                  <AlertDescription className="text-[11px] text-muted">Your number is already connected — incoming texts reach Harvest automatically, with nothing for you to set up.</AlertDescription>
                </Alert>
                <div className="flex items-center gap-3">
                  <Button onClick={saveT2g} disabled={savingT2g} className={`h-11 border-0 flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gold hover:bg-gold text-white text-sm font-semibold disabled:opacity-50 ${CONTROL_DENSITY.action}`}>
                    <Save size={15} /> {savingT2g ? 'Saving…' : 'Save Text-to-Give'}
                  </Button>
                  {t2gSaved && <span className="text-sm text-field-600 font-medium">✓ Saved</span>}
                </div>
              </div>
            )}
            {!t2g.enabled && (
              <Button variant="outline" onClick={saveT2g} disabled={savingT2g} className={`h-11 flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border border-line bg-transparent hover:bg-transparent text-muted hover:text-muted disabled:opacity-50 ${CONTROL_DENSITY.action}`}>
                <Save size={14} /> {savingT2g ? 'Saving…' : 'Save'}
              </Button>
            )}
          </Card>
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
