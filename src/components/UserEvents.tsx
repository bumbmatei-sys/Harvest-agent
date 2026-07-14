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
  }, []);

  return (
    <div className="flex flex-col min-h-full h-full bg-cream overflow-y-auto">
      <div className="sticky top-0 z-10 bg-white border-b border-stone-200">
        <div className="flex items-center gap-3 px-4 py-4 lg:max-w-[760px] lg:mx-auto">
          <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-stone-100">
            <ArrowLeft size={18} className="text-warm-brown" />
          </button>
          <h2 className="font-display text-lg font-normal tracking-[-0.01em] text-earth">My Events</h2>
        </div>
      </div>

      <div className="flex-1 p-4 lg:max-w-[760px] lg:mx-auto lg:w-full">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: BRAND, borderTopColor: 'transparent' }} />
          </div>
        ) : error ? (
          <div className="text-center py-16 text-[color:var(--text-faint)]">
            <CalendarCheck size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">{error}</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-[color:var(--text-faint)]">
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
                  className={`rounded-2xl p-4 shadow-sm transition-colors ${
                    ticketed
                      ? 'bg-white ring-2'
                      : 'bg-white border border-stone-200'
                  }`}
                  style={ticketed ? ({ '--tw-ring-color': BRAND } as React.CSSProperties) : undefined}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-bold text-earth text-sm">{r.title}</h3>
                      {ticketed && (
                        <span className={`inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusLabel(r.ticket!).cls}`}>
                          {statusLabel(r.ticket!).text}
                        </span>
                      )}
                    </div>
                    {ticketed && (
                      <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full"
                        style={{ backgroundColor: 'color-mix(in srgb, var(--brand-color, #B8962E) 14%, white)', color: BRAND }}>
                        <Ticket size={11} /> Your ticket
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5 mt-3">
                    <div className="flex items-center gap-2 text-xs text-warm-brown">
                      <Clock size={12} style={{ color: BRAND }} />
                      {fmtDate(r.startMillis)}{time ? ` · ${time}` : ''}
                    </div>
                    {r.isOnline ? (
                      <div className="flex items-center gap-2 text-xs text-warm-brown">
                        <Globe size={12} style={{ color: BRAND }} /> Online event
                      </div>
                    ) : r.location ? (
                      <div className="flex items-center gap-2 text-xs text-warm-brown">
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
        <TicketModal row={ticketView} onClose={() => setTicketView(null)} />
      )}
    </div>
  );
};

/** Full-screen ticket view: the QR (from the SAME ticketCode the email encodes)
 *  plus the code text, ticket type and status — scannable at the door offline. */
const TicketModal: React.FC<{ row: EventRow; onClose: () => void }> = ({ row, onClose }) => {
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
        className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200">
          <h3 className="font-display text-base font-bold text-earth truncate pr-2">{row.title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-stone-100 shrink-0">
            <X size={18} className="text-warm-brown" />
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
                <div className="w-60 h-60 mx-auto rounded-xl bg-stone-100 flex items-center justify-center text-sm text-[color:var(--text-faint)]">
                  Couldn&apos;t render the QR — use the code below.
                </div>
              ) : (
                <div className="w-60 h-60 mx-auto rounded-xl bg-stone-100 flex items-center justify-center">
                  <div className="w-7 h-7 border-4 border-t-transparent rounded-full animate-spin"
                    style={{ borderColor: BRAND, borderTopColor: 'transparent' }} />
                </div>
              )}
              <p className="text-xs text-[color:var(--text-faint)] mt-4">Ticket code</p>
              <p className="text-2xl font-mono font-bold tracking-widest text-earth">{t.ticketCode}</p>
            </>
          ) : (
            <div className="py-8 text-sm text-warm-brown">
              {t.status === 'waitlisted'
                ? "You're on the waitlist — a ticket code will be issued if a spot opens up."
                : 'No ticket code is available for this registration yet.'}
            </div>
          )}

          {t.ticketTypeName && (
            <p className="text-sm text-warm-brown mt-3">{t.ticketTypeName}</p>
          )}
          <p className="text-xs text-[color:var(--text-faint)] mt-4">Present this at the door — no email needed.</p>
        </div>
      </div>
    </div>
  );
};

export default UserEvents;
