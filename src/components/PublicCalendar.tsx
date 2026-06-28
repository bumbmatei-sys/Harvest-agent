"use client";
import React from 'react';
import { Calendar, MapPin, Globe, CalendarOff, CalendarPlus, ArrowRight } from 'lucide-react';

interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  location: string | null;
  isOnline: boolean;
  startDate: string | null;
  endDate: string | null;
  coverImage: string | null;
  price: number;
  registrationEnabled: boolean;
  status: string;
}

interface PublicCalendarProps {
  tenantId: string;
  tenantName: string;
  logo: string | null;
  primaryColor: string;
  events: CalendarEvent[];
}

const fmtDateTime = (iso: string | null) => {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return null;
  }
};

const PublicCalendar: React.FC<PublicCalendarProps> = ({ tenantId, tenantName, logo, primaryColor, events }) => {
  const eventUrl = (id: string) => `https://${tenantId}.theharvest.app/event/${id}`;

  return (
    <div className="min-h-screen bg-[#F7F6F3] py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-6">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt={tenantName} className="h-12 mx-auto mb-2 object-contain" />
          ) : (
            <div className="text-lg font-extrabold" style={{ color: primaryColor }}>{tenantName}</div>
          )}
        </div>

        <div className="flex items-center justify-between mb-5">
          <h1 className="text-2xl font-bold text-gray-900">{tenantName} Events</h1>
          <a href="/calendar/ical" target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 shrink-0">
            <CalendarPlus size={14} /> Subscribe
          </a>
        </div>

        {events.length === 0 ? (
          <div className="bg-white rounded-[14px] shadow-sm border border-gray-100 p-12 text-center">
            <CalendarOff size={40} className="mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500 font-medium">No upcoming events.</p>
            <p className="text-sm text-gray-400 mt-1">Check back soon.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {events.map((ev) => {
              const when = fmtDateTime(ev.startDate);
              return (
                <div key={ev.id} className="bg-white rounded-[14px] shadow-sm border border-gray-100 overflow-hidden">
                  {ev.coverImage && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={ev.coverImage} alt={ev.title} className="w-full h-40 object-cover" />
                  )}
                  <div className="p-5">
                    <h2 className="text-lg font-bold text-gray-900 mb-1.5">{ev.title}</h2>
                    <div className="space-y-1 mb-2">
                      {when && (
                        <p className="flex items-center gap-2 text-sm text-gray-600"><Calendar size={14} style={{ color: primaryColor }} /> {when}</p>
                      )}
                      {ev.isOnline ? (
                        <p className="flex items-center gap-2 text-sm text-gray-600"><Globe size={14} style={{ color: primaryColor }} /> Online</p>
                      ) : ev.location ? (
                        <p className="flex items-center gap-2 text-sm text-gray-600"><MapPin size={14} style={{ color: primaryColor }} /> {ev.location}</p>
                      ) : null}
                    </div>
                    {ev.description && <p className="text-sm text-gray-500 line-clamp-2 mb-3">{ev.description}</p>}
                    <div className="flex items-center justify-between gap-3">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${ev.price > 0 ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-700'}`}>
                        {ev.price > 0 ? `$${ev.price}` : 'Free'}
                      </span>
                      <a href={eventUrl(ev.id)}
                        className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold ${ev.registrationEnabled ? 'text-white' : 'border border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                        style={ev.registrationEnabled ? { backgroundColor: primaryColor } : undefined}>
                        {ev.registrationEnabled ? 'Register' : 'View Details'} <ArrowRight size={14} />
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default PublicCalendar;
