"use client";
import React, { useState, useEffect } from 'react';
import { ArrowLeft, CalendarCheck, MapPin, Clock, Globe, Ticket } from 'lucide-react';
import {
  collection, query, where, orderBy, onSnapshot, limit, Timestamp
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { getTenantScope } from '../utils/tenant-scope';

interface Registration {
  id: string;
  eventId: string;
  name: string;
  email: string;
  ticketCode: string;
  status: 'confirmed' | 'cancelled' | 'attended';
  amount: number;
  registeredAt: Timestamp | null;
  eventTitle?: string;
  eventDate?: Timestamp | null;
  eventLocation?: string;
  eventIsOnline?: boolean;
}

const fmtDate = (ts: Timestamp | null) => {
  if (!ts) return '—';
  return ts.toDate().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};

const STATUS_COLORS: Record<Registration['status'], string> = {
  confirmed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
  attended: 'bg-blue-100 text-blue-700',
};

interface UserEventsProps {
  onBack: () => void;
}

const UserEvents: React.FC<UserEventsProps> = ({ onBack }) => {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth.currentUser) { setLoading(false); return; }
    let cancelled = false;
    let unsub: (() => void) | null = null;
    getTenantScope().then(tid => {
      if (cancelled) return;
      setTenantId(tid);
      if (!tid) { setLoading(false); return; }
      const q = query(
        collection(db, 'tenants', tid, 'registrations'),
        where('userId', '==', auth.currentUser!.uid),
        orderBy('registeredAt', 'desc'),
        limit(100)
      );
      unsub = onSnapshot(q, async snap => {
        const regs = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Registration);
        // Enrich with event data
        if (regs.length > 0 && tid) {
          const { getDocs, doc: firestoreDoc, getDoc } = await import('firebase/firestore');
          const enriched = await Promise.all(
            regs.map(async r => {
              try {
                const evDoc = await getDoc(firestoreDoc(db, 'tenants', tid, 'events', r.eventId));
                if (evDoc.exists()) {
                  const ev = evDoc.data();
                  return {
                    ...r,
                    eventTitle: ev.title,
                    eventDate: ev.startDate,
                    eventLocation: ev.location,
                    eventIsOnline: ev.isOnline,
                  };
                }
              } catch {}
              return r;
            })
          );
          if (!cancelled) setRegistrations(enriched);
        } else {
          if (!cancelled) setRegistrations(regs);
        }
        if (!cancelled) setLoading(false);
      });
    });
    return () => { cancelled = true; unsub?.(); };
  }, []);

  return (
    <div className="flex flex-col min-h-full bg-[#F7F6F3]">
      <div className="flex items-center gap-3 px-4 py-4 bg-white border-b border-gray-100">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100">
          <ArrowLeft size={18} className="text-gray-600" />
        </button>
        <h2 className="text-lg font-bold text-gray-900">My Events</h2>
      </div>

      <div className="flex-1 p-4">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: 'var(--brand-color, #B8962E)', borderTopColor: 'transparent' }} />
          </div>
        ) : registrations.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <CalendarCheck size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">No event registrations yet</p>
            <p className="text-sm mt-1">Events you register for will appear here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {registrations.map(r => (
              <div key={r.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h3 className="font-bold text-gray-900 text-sm">{r.eventTitle || 'Event'}</h3>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status]}`}>
                      {r.status}
                    </span>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-xs text-gray-400">Ticket</div>
                    <div className="text-sm font-bold font-mono text-gray-700">{r.ticketCode}</div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {r.eventDate && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Clock size={12} style={{ color: 'var(--brand-color, #B8962E)' }} />
                      {fmtDate(r.eventDate)}
                    </div>
                  )}
                  {r.eventIsOnline ? (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Globe size={12} style={{ color: 'var(--brand-color, #B8962E)' }} />
                      Online Event
                    </div>
                  ) : r.eventLocation ? (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <MapPin size={12} style={{ color: 'var(--brand-color, #B8962E)' }} />
                      {r.eventLocation}
                    </div>
                  ) : null}
                  {r.amount > 0 && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Ticket size={12} style={{ color: 'var(--brand-color, #B8962E)' }} />
                      ${r.amount} ticket
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default UserEvents;
