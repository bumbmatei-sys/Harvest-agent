"use client";
import React, { useState, useEffect } from 'react';
import { CheckCircle2, Calendar, MapPin, Globe, Plus, X } from 'lucide-react';
import type { User } from 'firebase/auth';
import { auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { authFetch } from '../utils/auth-fetch';

interface TicketType {
  id: string;
  name: string;
  description?: string;
  price: number;          // cents
  capacity: number | null;
  order: number;
}

interface PublicEventRegistrationProps {
  tenantId: string;
  tenantName: string;
  logo: string | null;
  primaryColor: string;
  event: any; // serialized event document
}

const fmtCents = (cents: number) => (cents > 0 ? `$${(cents / 100).toFixed(2)}` : 'Free');

// Module-scope so its identity is stable across renders (a render-time nested
// component would remount the whole subtree on every keystroke → focus loss).
const Shell: React.FC<{ logo: string | null; tenantName: string; primaryColor: string; children: React.ReactNode }> = ({ logo, tenantName, primaryColor, children }) => (
  <div className="min-h-screen bg-[#F7F6F3] py-10 px-4">
    <div className="max-w-xl mx-auto">
      <div className="text-center mb-6">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt={tenantName} className="h-12 mx-auto mb-2 object-contain" />
        ) : (
          <div className="font-display text-lg font-extrabold" style={{ color: primaryColor }}>{tenantName}</div>
        )}
      </div>
      {children}
    </div>
  </div>
);

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

const PublicEventRegistration: React.FC<PublicEventRegistrationProps> = ({
  tenantId, tenantName, logo, primaryColor, event,
}) => {
  const ticketTypes: TicketType[] = Array.isArray(event.ticketTypes)
    ? [...event.ticketTypes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : [];

  const [selectedTicketId, setSelectedTicketId] = useState(ticketTypes[0]?.id || '');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [additional, setAdditional] = useState<{ name: string; email: string }[]>([]);
  const [showAdditional, setShowAdditional] = useState(false);

  const [discountInput, setDiscountInput] = useState('');
  const [discountResult, setDiscountResult] = useState<{ discountAmount: number } | null>(null);
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [applyingDiscount, setApplyingDiscount] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ ticketCode: string; waitlisted: boolean } | null>(null);

  // This same public page also renders inside the logged-in app. When an app
  // user is signed in we (a) pre-fill their name/email from the account and
  // (b) send their Firebase ID token on submit so the server can stamp the
  // registration with their verified uid — linking the ticket to "My Events".
  // Logged-out visitors see the untouched manual form and are NEVER forced to
  // sign in; the public registration flow is unchanged for them.
  const [authUser, setAuthUser] = useState<User | null>(null);
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthUser(u);
      if (u) {
        // Pre-fill, but never clobber anything the visitor already typed.
        setEmail((prev) => prev || (u.email || ''));
        const displayName = (u.displayName || '').trim();
        if (displayName) {
          const [first, ...rest] = displayName.split(/\s+/);
          setFirstName((prev) => prev || first || '');
          setLastName((prev) => prev || rest.join(' ') || '');
        }
      }
    });
    return () => unsub();
  }, []);

  // When Stripe Checkout redirects back to /event/{id}?registration=success|cancel,
  // show the matching state. The QR ticket for a paid registration arrives by
  // email once the webhook confirms the payment.
  const [postPayment, setPostPayment] = useState<'success' | 'cancel' | null>(null);
  useEffect(() => {
    const reg = new URLSearchParams(window.location.search).get('registration');
    if (reg === 'success' || reg === 'cancel') setPostPayment(reg);
  }, []);

  // Return to a clean form after an abandoned/cancelled paid checkout, stripping
  // the ?registration=cancel param so a refresh doesn't re-show the cancel state.
  const dismissPostPayment = () => {
    setPostPayment(null);
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  };

  const selectedTicket = ticketTypes.find((t) => t.id === selectedTicketId) || null;
  const discountAmount = discountResult?.discountAmount || 0;
  // Headcount = the primary registrant + every named additional attendee. Each
  // attendee takes a seat and is charged for a ticket (BUG 5) — the total is
  // price × headcount − discount, NOT a single ticket price. This mirrors the
  // server's quantity math in /api/event-registration/submit exactly.
  const attendeeCount = additional.filter((a) => a.name.trim()).length;
  const quantity = 1 + attendeeCount;
  const gross = selectedTicket ? selectedTicket.price * quantity : 0;
  const total = Math.max(0, gross - discountAmount);

  const inputCls = 'w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent';
  const ring = { '--tw-ring-color': primaryColor } as React.CSSProperties;

  const selectTicket = (id: string) => {
    setSelectedTicketId(id);
    // Discount amount depends on the ticket price — re-validate on change.
    setDiscountResult(null);
    setDiscountError(null);
  };

  const addAttendee = () => {
    if (additional.length >= 9) return;
    setAdditional((a) => [...a, { name: '', email: '' }]);
  };
  const updateAttendee = (i: number, patch: Partial<{ name: string; email: string }>) =>
    setAdditional((a) => a.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const removeAttendee = (i: number) => setAdditional((a) => a.filter((_, idx) => idx !== i));

  const applyDiscount = async () => {
    if (!discountInput.trim() || !selectedTicket) return;
    setApplyingDiscount(true);
    setDiscountError(null);
    try {
      const resp = await fetch('/api/event-registration/apply-discount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, eventId: event.id, discountCode: discountInput.trim(), ticketTypeId: selectedTicket.id }),
      });
      const data = await resp.json().catch(() => ({}));
      if (data.valid) {
        setDiscountResult({ discountAmount: data.discountAmount || 0 });
      } else {
        setDiscountResult(null);
        setDiscountError(data.error || 'Invalid discount code');
      }
    } catch {
      setDiscountError('Could not validate code. Please try again.');
    } finally {
      setApplyingDiscount(false);
    }
  };

  const submit = async () => {
    if (!selectedTicket) { setError('Please choose a ticket type.'); return; }
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      setError('Please fill in your first name, last name and email.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        tenantId,
        eventId: event.id,
        ticketTypeId: selectedTicket.id,
        firstName,
        lastName,
        email,
        phone: phone || undefined,
        additionalAttendees: additional.filter((a) => a.name.trim()).map((a) => ({ name: a.name.trim(), email: a.email.trim() || undefined })),
        discountCode: discountResult ? discountInput.trim() : undefined,
      };
      // Signed-in → authFetch attaches the ID token so the server links the reg
      // to the verified uid. Signed-out → plain fetch, no token, userId stays null.
      const resp = authUser && auth.currentUser
        ? await authFetch('/api/event-registration/submit', {
            method: 'POST',
            body: JSON.stringify(payload),
          })
        : await fetch('/api/event-registration/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Registration failed');
      // Paid ticket → the server created a Stripe Checkout session. Redirect there;
      // the registration is confirmed by the webhook only after payment succeeds.
      if (data.url) {
        window.location.href = data.url;
        return; // keep the button disabled through the redirect
      }
      // Free (or waitlisted) ticket → confirmed immediately, show the ticket code.
      setDone({ ticketCode: data.ticketCode, waitlisted: !!data.waitlisted });
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const startLabel = fmtDateTime(event.startDate);

  const EventHeader = (
    <div className="bg-white rounded-[14px] shadow-sm border border-gray-100 overflow-hidden mb-4">
      {event.coverImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={event.coverImage} alt={event.title} className="w-full h-44 object-cover" />
      )}
      <div className="p-6">
        <h1 className="font-display text-2xl font-bold text-gray-900 mb-2">{event.title}</h1>
        <div className="space-y-1.5 mb-3">
          {startLabel && (
            <p className="flex items-center gap-2 text-sm text-gray-600"><Calendar size={15} style={{ color: primaryColor }} /> {startLabel}</p>
          )}
          {event.isOnline ? (
            <p className="flex items-center gap-2 text-sm text-gray-600"><Globe size={15} style={{ color: primaryColor }} /> Online event</p>
          ) : event.location ? (
            <p className="flex items-center gap-2 text-sm text-gray-600"><MapPin size={15} style={{ color: primaryColor }} /> {event.location}</p>
          ) : null}
        </div>
        {event.description && <p className="text-sm text-gray-500 whitespace-pre-line">{event.description}</p>}
      </div>
    </div>
  );

  // ── Returned from Stripe Checkout (paid ticket) ──
  if (postPayment === 'success') {
    return (
      <Shell logo={logo} tenantName={tenantName} primaryColor={primaryColor}>
        {EventHeader}
        <div className="bg-white rounded-[14px] shadow-sm border border-gray-100 p-8 text-center">
          <CheckCircle2 size={48} className="mx-auto mb-4" style={{ color: primaryColor }} />
          <h2 className="font-display text-xl font-bold text-gray-900 mb-1">Payment received — you&apos;re registered!</h2>
          <p className="text-sm text-gray-500 mb-2">Thanks for registering for {event.title}.</p>
          <p className="text-sm text-gray-400">Your ticket and QR code are on their way to your email.</p>
        </div>
      </Shell>
    );
  }
  if (postPayment === 'cancel') {
    return (
      <Shell logo={logo} tenantName={tenantName} primaryColor={primaryColor}>
        {EventHeader}
        <div className="bg-white rounded-[14px] shadow-sm border border-gray-100 p-8 text-center">
          <h2 className="font-display text-xl font-bold text-gray-900 mb-1">Registration not completed</h2>
          <p className="text-sm text-gray-500 mb-5">Your payment was cancelled, so you haven&apos;t been charged and no ticket was issued.</p>
          <button onClick={dismissPostPayment}
            className="px-5 py-2.5 rounded-xl text-white font-semibold"
            style={{ backgroundColor: primaryColor }}>
            Try again
          </button>
        </div>
      </Shell>
    );
  }

  // ── Success ──
  if (done) {
    return (
      <Shell logo={logo} tenantName={tenantName} primaryColor={primaryColor}>
        {EventHeader}
        <div className="bg-white rounded-[14px] shadow-sm border border-gray-100 p-8 text-center">
          <CheckCircle2 size={48} className="mx-auto mb-4" style={{ color: primaryColor }} />
          <h2 className="font-display text-xl font-bold text-gray-900 mb-1">
            {done.waitlisted ? "You're on the waitlist!" : "You're registered!"}
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            {done.waitlisted
              ? "We'll contact you if a spot opens up."
              : 'Show this code at the door:'}
          </p>
          {!done.waitlisted && (
            <div className="text-3xl font-mono font-bold tracking-widest text-gray-900 my-4">{done.ticketCode}</div>
          )}
          <p className="text-sm text-gray-400">A confirmation has been sent to {email}.</p>
        </div>
      </Shell>
    );
  }

  // ── Event already taken place ──
  if (event.status === 'completed') {
    return (
      <Shell logo={logo} tenantName={tenantName} primaryColor={primaryColor}>
        {EventHeader}
        <div className="bg-white rounded-[14px] shadow-sm border border-gray-100 p-8 text-center">
          <p className="text-gray-600">This event has already taken place.</p>
        </div>
      </Shell>
    );
  }

  // ── Registration not available online ──
  if (!event.registrationEnabled) {
    return (
      <Shell logo={logo} tenantName={tenantName} primaryColor={primaryColor}>
        {EventHeader}
        <div className="bg-white rounded-[14px] shadow-sm border border-gray-100 p-8 text-center">
          <p className="text-gray-600">Registration is not available online. Contact {tenantName} to sign up.</p>
        </div>
      </Shell>
    );
  }

  // ── Registration form ──
  return (
    <Shell logo={logo} tenantName={tenantName} primaryColor={primaryColor}>
      {EventHeader}
      <div className="bg-white rounded-[14px] shadow-sm border border-gray-100 p-6" style={{ paddingBottom: 24 }}>
        {/* Ticket type selector */}
        {ticketTypes.length > 0 && (
          <div className="mb-5">
            <label className="block text-sm font-semibold text-gray-800 mb-2">Select a ticket</label>
            <div className="space-y-2">
              {ticketTypes.map((t) => {
                const active = t.id === selectedTicketId;
                return (
                  <button
                    key={t.id}
                    onClick={() => selectTicket(t.id)}
                    className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${active ? 'border-transparent ring-2' : 'border-gray-200 hover:border-gray-300'}`}
                    style={active ? ({ '--tw-ring-color': primaryColor } as React.CSSProperties) : undefined}
                  >
                    <div className={`w-4 h-4 rounded-full border-2 shrink-0 ${active ? '' : 'border-gray-300'}`} style={active ? { borderColor: primaryColor, backgroundColor: primaryColor } : undefined} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{t.name}</p>
                      {t.description && <p className="text-xs text-gray-400">{t.description}</p>}
                      {t.capacity != null && <p className="text-[11px] text-amber-600 mt-0.5">Limited spots</p>}
                    </div>
                    <span className="text-sm font-bold text-gray-900 shrink-0">{fmtCents(t.price)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Signed-in hint — the ticket links to this account's "My Events". */}
        {authUser && (
          <div className="mb-4 flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2">
            <CheckCircle2 size={14} style={{ color: primaryColor }} />
            <span>Registering as <span className="font-semibold text-gray-700">{authUser.email}</span> — your ticket will appear in My Events.</span>
          </div>
        )}

        {/* Attendee info */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">First Name<span className="text-red-500 ml-0.5">*</span></label>
              <input className={inputCls} style={ring} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Last Name<span className="text-red-500 ml-0.5">*</span></label>
              <input className={inputCls} style={ring} value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Email<span className="text-red-500 ml-0.5">*</span></label>
            <input type="email" className={inputCls} style={ring} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone <span className="text-gray-400 font-normal">(optional)</span></label>
            <input type="tel" className={inputCls} style={ring} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>

        {/* Additional attendees */}
        <div className="mt-4">
          {!showAdditional ? (
            <button onClick={() => { setShowAdditional(true); if (additional.length === 0) addAttendee(); }}
              className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: primaryColor }}>
              <Plus size={15} /> Add Another Person
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-gray-800">Additional Attendees</p>
              {additional.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className={inputCls} style={ring} placeholder="Name" value={a.name} onChange={(e) => updateAttendee(i, { name: e.target.value })} />
                  <input className={inputCls} style={ring} placeholder="Email (optional)" value={a.email} onChange={(e) => updateAttendee(i, { email: e.target.value })} />
                  <button onClick={() => removeAttendee(i)} className="p-2 rounded-lg hover:bg-red-50 shrink-0"><X size={15} className="text-red-400" /></button>
                </div>
              ))}
              <button onClick={addAttendee} disabled={additional.length >= 9}
                className="flex items-center gap-1.5 text-sm font-semibold disabled:opacity-40" style={{ color: primaryColor }}>
                <Plus size={15} /> Add Another Person
              </button>
            </div>
          )}
        </div>

        {/* Discount code */}
        {event.hasDiscounts && (
        <div className="mt-5">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Discount code <span className="text-gray-400 font-normal">(optional)</span></label>
          <div className="flex items-center gap-2">
            <input className={inputCls} style={ring} value={discountInput}
              onChange={(e) => { setDiscountInput(e.target.value.toUpperCase()); setDiscountResult(null); setDiscountError(null); }}
              placeholder="Enter code" />
            <button onClick={applyDiscount} disabled={applyingDiscount || !discountInput.trim() || !selectedTicket}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50 shrink-0">
              {applyingDiscount ? '…' : 'Apply'}
            </button>
          </div>
          {discountResult && <p className="text-xs text-green-600 mt-1.5 font-medium">✓ Discount applied — {fmtCents(discountResult.discountAmount)} off</p>}
          {discountError && <p className="text-xs text-red-600 mt-1.5">{discountError}</p>}
        </div>
        )}

        {/* Order summary */}
        {selectedTicket && (
          <div className="mt-5 bg-gray-50 rounded-xl p-4 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>{selectedTicket.name}{quantity > 1 ? ` × ${quantity}` : ''}</span>
              <span>{fmtCents(gross)}</span>
            </div>
            {quantity > 1 && (
              <p className="text-[11px] text-gray-400 mt-0.5">{quantity} tickets ({fmtCents(selectedTicket.price)} each)</p>
            )}
            {discountAmount > 0 && (
              <div className="flex justify-between text-green-600 mt-1"><span>Discount</span><span>-{fmtCents(discountAmount)}</span></div>
            )}
            <div className="flex justify-between font-bold text-gray-900 mt-2 pt-2 border-t border-gray-200"><span>Total</span><span>{fmtCents(total)}</span></div>
          </div>
        )}

        {error && <p className="text-sm text-red-600 mt-4">{error}</p>}

        <button onClick={submit} disabled={submitting}
          className="mt-6 w-full py-3 rounded-xl text-white font-semibold disabled:opacity-50"
          style={{ backgroundColor: primaryColor }}>
          {submitting
            ? (total > 0 ? 'Redirecting to payment…' : 'Registering…')
            : (total > 0 ? `Continue to payment · ${fmtCents(total)}` : 'Register')}
        </button>
      </div>
    </Shell>
  );
};

export default PublicEventRegistration;
