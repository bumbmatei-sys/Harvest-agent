"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, CalendarCheck, MapPin, Clock, Globe, Ticket, QrCode, X } from 'lucide-react';
import { collection, query, getDocs, orderBy, limit } from 'firebase/firestore';
import QRCode from 'qrcode';
import { db, auth } from '../firebase';
import { getTenantScope } from '../utils/tenant-scope';
import { authFetch } from '../utils/auth-fetch';
import { useShareBaseUrl } from '../utils/share-url';
import ShareButton from './ShareButton';
import { useTenantOptional } from '../contexts/TenantContext';
import { CONTROL_DENSITY } from './layout/form-layout';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { claimPaymentSent } from './inbox/payment-claims-client';
import {
  MEMBER_CLAIMED_BADGE, MEMBER_CLAIMED_TITLE, MEMBER_CLAIM_BUTTON, MEMBER_CLAIM_FAILED,
  MEMBER_CLAIM_HELP, MEMBER_CONFIRMED_BADGE, MEMBER_UNPAID_BADGE,
  memberClaimedBody, memberConfirmedBody, memberUnpaidBody,
  type PaymentState,
} from '../lib/event-payment-claims';

const BRAND = 'var(--brand-color, #B8962E)';

/** A ticket the current user holds, as returned by /api/my-registrations. */
interface ApiTicket {
  id: string;
  eventId: string | null;
  ticketCode: string | null;
  status: string;               // 'confirmed' | 'waitlisted'
  ticketTypeName: string | null;
  waitlisted: boolean;
  amount: number;
  /** THE-351 — derived server-side; see `/api/my-registrations`. */
  payment?: PaymentState;
  paymentReference?: string | null;
  paymentConfirmedAt?: string | null;
  payOptions?: { id: string; label: string; url: string | null; handle: string | null; email: string | null }[];
  event: {
    title: string;
    startMillis: number | null;
    location: string | null;
    isOnline: boolean;
    status: string | null;
  } | null;
}

/** A row in the upcoming-events list — a tenant event, optionally ticketed. */
interface EventRow {
  id: string;
  title: string;
  startMillis: number | null;
  location: string | null;
  isOnline: boolean;
  registrationEnabled: boolean;
  ticket: ApiTicket | null;
}

const fmtDate = (ms: number | null) => {
  if (ms == null) return 'Date TBA';
  return new Date(ms).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
};
const fmtTime = (ms: number | null) => {
  if (ms == null) return null;
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

const statusLabel = (t: ApiTicket): { text: string; cls: string } =>
  t.status === 'waitlisted' || t.waitlisted
    ? { text: 'Waitlisted', cls: 'bg-wheat-100 text-wheat-700' }
    : { text: 'Confirmed', cls: 'bg-field-100 text-field-700' };

interface UserEventsProps {
  onBack: () => void;
}

const UserEvents: React.FC<UserEventsProps> = ({ onBack }) => {
  const [rows, setRows] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ticketView, setTicketView] = useState<EventRow | null>(null);
  const shareBase = useShareBaseUrl();
  /**
   * THE-351 — the church's name, for the payment copy. Every sentence a member
   * reads about money names the CHURCH as the party that decides, so the name
   * has to be a real one; `branding.churchName` is what `TenantContext` has
   * already loaded, and the fallback is a neutral noun rather than "Harvest",
   * which would be the one word that must never appear in that position.
   */
  // The OPTIONAL hook — see the note in AdminEvents: `useTenant` throws outside
  // a provider, and this screen is mounted bare by existing suites.
  const churchName =
    (useTenantOptional()?.branding as { churchName?: string } | undefined)?.churchName
    || 'the church';
  /** Bumped after a successful "I've paid" so the ticket re-reads its state. */
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!auth.currentUser) { setLoading(false); return; }
    let cancelled = false;

    (async () => {
      try {
        const tid = await getTenantScope();
        if (cancelled) return;
        if (!tid) { setLoading(false); return; }

        // Two independent reads: ALL upcoming tenant events (public, client read)
        // and MY tickets (authed API route, userId + email fallback). Merge below.
        const [eventsSnap, ticketsResp] = await Promise.all([
          getDocs(query(
            collection(db, 'tenants', tid, 'events'),
            orderBy('startDate', 'desc'),
            limit(100),
          )),
          authFetch(`/api/my-registrations?tenantId=${encodeURIComponent(tid)}`).catch(() => null),
        ]);
        if (cancelled) return;

        let tickets: ApiTicket[] = [];
        if (ticketsResp && ticketsResp.ok) {
          const data = await ticketsResp.json().catch(() => ({}));
          tickets = Array.isArray(data.tickets) ? data.tickets : [];
        }
        const ticketByEvent = new Map<string, ApiTicket>();
        for (const t of tickets) {
          if (!t.eventId) continue;
          // Prefer a confirmed ticket over a waitlisted one for the same event.
          const existing = ticketByEvent.get(t.eventId);
          if (!existing || (existing.status === 'waitlisted' && t.status === 'confirmed')) {
            ticketByEvent.set(t.eventId, t);
          }
        }

        // Start of today — an event happening later today still counts as upcoming.
        const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
        const todayMs = startOfToday.getTime();

        const byId = new Map<string, EventRow>();
        eventsSnap.docs.forEach((d) => {
          const e = d.data() as any;
          if (e.status !== 'published') return; // hide drafts / cancelled / completed
          const start = e.startDate;
          const startMillis = start && typeof start.toMillis === 'function' ? start.toMillis() : null;
          byId.set(d.id, {
            id: d.id,
            title: e.title || 'Event',
            startMillis,
            location: e.location || null,
            isOnline: !!e.isOnline,
            registrationEnabled: !!e.registrationEnabled,
            ticket: ticketByEvent.get(d.id) || null,
          });
        });

        // Fold in any ticketed event NOT already listed (e.g. an unpublished event
        // the user still holds a real ticket to), using the API's joined event info
        // so their QR is never unreachable.
        ticketByEvent.forEach((t, eventId) => {
          if (byId.has(eventId)) return;
          byId.set(eventId, {
            id: eventId,
            title: t.event?.title || 'Event',
            startMillis: t.event?.startMillis ?? null,
            location: t.event?.location || null,
            isOnline: !!t.event?.isOnline,
            registrationEnabled: false,
            ticket: t,
          });
        });

        // Upcoming only (undated events are kept), soonest first; ticketed events
        // float to the top so the door-ready ones are easy to find.
        const list = Array.from(byId.values())
          .filter((r) => r.startMillis == null || r.startMillis >= todayMs)
          .sort((a, b) => {
            if (!!b.ticket !== !!a.ticket) return a.ticket ? -1 : 1;
            return (a.startMillis ?? Number.MAX_SAFE_INTEGER) - (b.startMillis ?? Number.MAX_SAFE_INTEGER);
          });

        setRows(list);
      } catch (e) {
        console.error('My Events load failed:', e);
        if (!cancelled) setError('Could not load your events. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // `reloadKey` bumps after a successful "I've paid" so the ticket re-reads
    // its state from the server rather than being patched locally — the state is
    // derived server-side by `paymentStateOf`, and a local guess is a second
    // opinion about what "paid" means.
  }, [reloadKey]);

  return (
    <div className="flex flex-col min-h-full h-full bg-surface overflow-y-auto">
      <div className="sticky top-0 z-10 bg-surface-raised border-b border-line">
        <div className="flex items-center gap-3 px-4 py-4 lg:max-w-[760px] lg:mx-auto">
          <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-surface-sunken">
            <ArrowLeft size={18} className="text-muted" />
          </button>
          <h2 className="font-display text-lg font-normal tracking-[-0.01em] text-strong">My Events</h2>
        </div>
      </div>

      <div className="flex-1 p-4 lg:max-w-[760px] lg:mx-auto lg:w-full">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: BRAND, borderTopColor: 'transparent' }} />
          </div>
        ) : error ? (
          <div className="text-center py-16 text-faint">
            <CalendarCheck size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">{error}</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-faint">
            <CalendarCheck size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">No upcoming events</p>
            <p className="text-sm mt-1">Events you can join will show up here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => {
              const ticketed = !!r.ticket;
              const time = fmtTime(r.startMillis);
              return (
                <div
                  key={r.id}
                  className={`rounded-2xl p-4 shadow-xs transition-colors ${
                    ticketed
                      ? 'bg-surface-raised ring-2'
                      : 'bg-surface-raised border border-line'
                  }`}
                  style={ticketed ? ({ '--tw-ring-color': BRAND } as React.CSSProperties) : undefined}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-bold text-strong text-sm">{r.title}</h3>
                      {ticketed && (
                        <span className={`inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusLabel(r.ticket!).cls}`}>
                          {statusLabel(r.ticket!).text}
                        </span>
                      )}
                    </div>
                    {ticketed && (
                      <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full"
                        style={{ backgroundColor: 'color-mix(in srgb, var(--brand-color, #B8962E) 14%, transparent)', color: BRAND }}>
                        <Ticket size={11} /> Your ticket
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5 mt-3">
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <Clock size={12} style={{ color: BRAND }} />
                      {fmtDate(r.startMillis)}{time ? ` · ${time}` : ''}
                    </div>
                    {r.isOnline ? (
                      <div className="flex items-center gap-2 text-xs text-muted">
                        <Globe size={12} style={{ color: BRAND }} /> Online event
                      </div>
                    ) : r.location ? (
                      <div className="flex items-center gap-2 text-xs text-muted">
                        <MapPin size={12} style={{ color: BRAND }} /> {r.location}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    {ticketed ? (
                      <button
                        onClick={() => setTicketView(r)}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-white text-sm font-semibold"
                        style={{ backgroundColor: BRAND }}
                      >
                        <QrCode size={15} /> View ticket
                      </button>
                    ) : r.registrationEnabled ? (
                      <button
                        onClick={() => { window.location.href = `/event/${r.id}`; }}
                        className="flex-1 py-2.5 rounded-xl text-sm font-semibold border"
                        style={{ borderColor: BRAND, color: BRAND }}
                      >
                        Register
                      </button>
                    ) : null}
                    <ShareButton
                      url={shareBase ? `${shareBase}/event/${r.id}` : ''}
                      title={r.title}
                      className="!py-2.5 ml-auto"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {ticketView && ticketView.ticket && (
        <TicketModal
          row={ticketView}
          onClose={() => setTicketView(null)}
          churchName={churchName}
          onChanged={() => { setTicketView(null); setReloadKey(k => k + 1); }}
        />
      )}
    </div>
  );
};

/** Full-screen ticket view: the QR (from the SAME ticketCode the email encodes)
 *  plus the code text, ticket type and status — scannable at the door offline. */
/**
 * 🔴 THE-351 — WHAT THE MEMBER SEES, AND WHAT PRESSING THE BUTTON DOES.
 *
 * THE FOUNDER: "Don't let Harvest imply it verified anything."
 *
 * Three states and every one of them names the CHURCH as the party that
 * decides. Every string comes from `event-payment-claims.ts`, which THE-351's
 * suite sweeps against `FORBIDDEN_CLAIM_PHRASES`, so no wording here can drift
 * into claiming Harvest checked something.
 *
 * ⚠️ THE HELP TEXT SITS BESIDE THE BUTTON, NOT BEHIND A TOOLTIP. A member who
 * believes "I've paid" has settled the matter will arrive at the door believing
 * they are paid; `tooltip` was rejected for exactly that, and a phone has no
 * hover to reveal it with anyway.
 *
 * 🔴 A FAILED PRESS SAYS SO AND CHANGES NOTHING. `claimPaymentSent` throws on a
 * rejection rather than resolving quietly, and this renders the failure in
 * place — THE-321's `saveState` shape, THE-342's rule.
 *
 * `alert` for the panel — the primitive is installed, and this is a standing
 * notice about the state of a record rather than a card of content. `badge` was
 * used for the one-word state and rejected for the body (two sentences of
 * instruction is not a label); `dialog` was rejected because this is already
 * inside one.
 */
const TicketPaymentPanel: React.FC<{
  ticket: ApiTicket;
  churchName: string;
  onChanged: () => void;
}> = ({ ticket, churchName, onChanged }) => {
  const [state, setState] = useState<'idle' | 'saving' | 'failed'>('idle');
  const payment = ticket.payment ?? 'free';
  const reference = ticket.paymentReference || '';

  if (payment === 'free') return null;

  if (payment === 'confirmed') {
    return (
      <div className="mt-5 text-left" data-ticket-payment="confirmed">
        <Alert>
          <AlertTitle>{MEMBER_CONFIRMED_BADGE}</AlertTitle>
          <AlertDescription>
            {memberConfirmedBody(churchName, ticket.paymentConfirmedAt || '')}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const press = async () => {
    setState('saving');
    try {
      // The provider is not asked for here: the member has just been shown the
      // church's tiles and may have used any of them, and a wrong answer on a
      // required field is worse for the admin than an honest blank. The inbox
      // row says "did not say which app they used" when it is null.
      await claimPaymentSent(await getTenantScope() || '', ticket.id, null);
      setState('idle');
      onChanged();
    } catch {
      setState('failed');
    }
  };

  if (payment === 'claimed') {
    return (
      <div className="mt-5 text-left" data-ticket-payment="claimed">
        <Alert>
          <AlertTitle>{MEMBER_CLAIMED_TITLE}</AlertTitle>
          <AlertDescription>{memberClaimedBody(churchName, reference)}</AlertDescription>
        </Alert>
        <p className="mt-2 text-[11px] font-semibold text-muted">{MEMBER_CLAIMED_BADGE}</p>
      </div>
    );
  }

  return (
    <div className="mt-5 text-left" data-ticket-payment="unpaid">
      <Alert>
        <AlertTitle>{MEMBER_UNPAID_BADGE}</AlertTitle>
        <AlertDescription>
          {memberUnpaidBody(churchName, ticket.amount, reference)}
        </AlertDescription>
      </Alert>

      {(ticket.payOptions || []).length > 0 && (
        <div className="mt-3 space-y-1.5" data-ticket-pay-options>
          {(ticket.payOptions || []).map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-2 min-h-11 sm:min-h-0">
              <span className="text-sm font-medium text-body">{o.label}</span>
              {o.url ? (
                <a
                  href={o.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-semibold underline text-body"
                >
                  Open
                </a>
              ) : (
                <span className="text-xs text-muted truncate">{o.handle || o.email}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        data-ticket-claim
        onClick={() => void press()}
        disabled={state === 'saving'}
        /* `bg-gold` is `var(--brand-color)` — the token this file's own
           `BRAND` constant spells by hand. Used here so THE-351 introduces no
           colour literal, on any surface. */
        className={`mt-3 w-full min-h-11 rounded-xl text-sm font-semibold text-white bg-gold disabled:opacity-50 ${CONTROL_DENSITY.action}`}
      >
        {state === 'saving' ? 'Sending…' : MEMBER_CLAIM_BUTTON}
      </button>
      <p className="mt-1.5 text-[11px] text-muted" data-ticket-claim-help>{MEMBER_CLAIM_HELP}</p>
      {state === 'failed' && (
        <p className="mt-1.5 text-[11px] font-semibold text-destructive" data-ticket-claim-failed>
          {MEMBER_CLAIM_FAILED}
        </p>
      )}
    </div>
  );
};

/** Full-screen ticket view: the QR (from the SAME ticketCode the email encodes)
 *  plus the code text, ticket type and status — scannable at the door offline. */
const TicketModal: React.FC<{
  row: EventRow;
  onClose: () => void;
  churchName: string;
  onChanged: () => void;
}> = ({ row, onClose, churchName, onChanged }) => {
  const t = row.ticket!;
  const [qr, setQr] = useState<string>('');
  const [qrError, setQrError] = useState(false);

  const generate = useCallback(async () => {
    if (!t.ticketCode) { setQrError(true); return; }
    try {
      const url = await QRCode.toDataURL(t.ticketCode, { width: 512, margin: 1 });
      setQr(url);
    } catch {
      setQrError(true);
    }
  }, [t.ticketCode]);

  useEffect(() => { generate(); }, [generate]);

  const status = statusLabel(t);

  return (
    <div className="fixed inset-0 z-[400] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-surface-raised rounded-3xl w-full max-w-sm overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h3 className="font-display text-base font-bold text-strong truncate pr-2">{row.title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-sunken shrink-0">
            <X size={18} className="text-muted" />
          </button>
        </div>

        <div className="p-6 text-center">
          <span className={`inline-block mb-4 text-[11px] font-semibold px-2.5 py-1 rounded-full ${status.cls}`}>
            {status.text}
          </span>

          {t.ticketCode ? (
            <>
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qr} alt="Ticket QR code" className="w-60 h-60 max-w-full mx-auto rounded-xl" />
              ) : qrError ? (
                <div className="w-60 h-60 mx-auto rounded-xl bg-surface-sunken flex items-center justify-center text-sm text-faint">
                  Couldn&apos;t render the QR — use the code below.
                </div>
              ) : (
                <div className="w-60 h-60 mx-auto rounded-xl bg-surface-sunken flex items-center justify-center">
                  <div className="w-7 h-7 border-4 border-t-transparent rounded-full animate-spin"
                    style={{ borderColor: BRAND, borderTopColor: 'transparent' }} />
                </div>
              )}
              <p className="text-xs text-faint mt-4">Ticket code</p>
              <p className="text-2xl font-mono font-bold tracking-widest text-strong">{t.ticketCode}</p>
            </>
          ) : (
            <div className="py-8 text-sm text-muted">
              {t.status === 'waitlisted'
                ? "You're on the waitlist — a ticket code will be issued if a spot opens up."
                : 'No ticket code is available for this registration yet.'}
            </div>
          )}

          {t.ticketTypeName && (
            <p className="text-sm text-muted mt-3">{t.ticketTypeName}</p>
          )}
          <p className="text-xs text-faint mt-4">Present this at the door — no email needed.</p>

          <TicketPaymentPanel ticket={t} churchName={churchName} onChanged={onChanged} />
        </div>
      </div>
    </div>
  );
};

export default UserEvents;

/**
 * 🔴 A TEST SEAM, AND IT IS NAMED AS ONE.
 *
 * `TicketPaymentPanel` is an implementation detail of the ticket modal and must
 * not become a component other screens reach for — so it is exported under a
 * dunder name rather than as part of this module's surface. THE-351's suite
 * drives it directly because its four states (free / unpaid / claimed /
 * confirmed) are the whole of the member-facing half of this ticket, and
 * reaching them through the list, the modal and a mocked `/api/my-registrations`
 * would be three fixtures deep before the first assertion — which is how a
 * guard ends up testing the harness.
 */
export const __TicketPaymentPanel = TicketPaymentPanel;
