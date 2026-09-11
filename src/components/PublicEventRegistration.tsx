"use client";
import React, { useState, useEffect } from 'react';
import { CheckCircle2, Calendar, MapPin, Globe, Plus, X } from 'lucide-react';
import type { User } from 'firebase/auth';
import { auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { authFetch } from '../utils/auth-fetch';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions } from './ui/item';
import { Separator } from './ui/separator';
import { CONTROL_DENSITY } from './layout/form-layout';
import { PAID_EVENTS_ENABLED, manualConfirmationMode } from '../lib/paid-events-feature';
import {
  MEMBER_CLAIM_BUTTON,
  MEMBER_CLAIM_FAILED,
  PUBLIC_CLAIMED_TITLE,
  PUBLIC_CLAIM_HELP,
  PUBLIC_NO_LINKS_TITLE,
  PUBLIC_PAY_TITLE,
  publicClaimedBody,
  publicNoLinksBody,
  publicPayBody,
} from '../lib/event-payment-claims';

/** One of the church's own payment links, resolved server-side by the page. */
export interface PublicPayOption {
  id: string;
  label: string;
  url: string | null;
  handle: string | null;
  email: string | null;
}

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
  /**
   * THE-355 — the church's own payment links for THIS event, already
   * intersected against what the church currently publishes. Resolved on the
   * server (see `app/event/[eventId]/page.tsx`) so this page needs no second
   * round trip, no loading state and no failure mode to render them.
   */
  payOptions?: PublicPayOption[];
}

const fmtCents = (cents: number) => (cents > 0 ? `$${(cents / 100).toFixed(2)}` : 'Free');

// Module-scope so its identity is stable across renders (a render-time nested
// component would remount the whole subtree on every keystroke → focus loss).
const Shell: React.FC<{ logo: string | null; tenantName: string; primaryColor: string; children: React.ReactNode }> = ({ logo, tenantName, primaryColor, children }) => (
  <div className="min-h-screen bg-surface py-10 px-4">
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
  tenantId, tenantName, logo, primaryColor, event, payOptions = [],
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
  const [done, setDone] = useState<{
    ticketCode: string;
    waitlisted: boolean;
    /** THE-351 — null unless this seat owes money the church collects itself. */
    paymentReference: string | null;
    amountCents: number;
    /**
     * THE-355 — 🔴 THE 256-BIT TOKEN THAT LETS THIS REGISTRANT CLAIM.
     *
     * ⚠️ HELD IN COMPONENT STATE AND NOWHERE ELSE. Not `localStorage`, not the
     * URL, not a cookie: it authorises a write against a document carrying a
     * money amount, and its whole security argument is that the only party
     * holding it is the person who just pressed Register in this tab. A URL
     * lands in browser history, a referer header and a shared screenshot; a
     * storage key outlives the tab and the person. This dies with the tab,
     * which is exactly the lifetime of the screen that uses it.
     */
    claimToken: string | null;
  } | null>(null);

  /**
   * THE-355 — the public claim's own `saveState`, THE-321's shape.
   *
   * 🔴 A FAILED CLAIM MUST SURFACE VISIBLY AND MUST NOT LOSE THE REGISTRATION.
   * `done` is never cleared by this machine, so a rejected press leaves the
   * ticket code, the reference and the links exactly where they were and adds a
   * failure beside the button. THE-342's rule: a default that hides an error is
   * a bug, and a silent failure here would be a person who believes the church
   * has been told when it has not.
   */
  const [claimState, setClaimState] = useState<'idle' | 'saving' | 'claimed' | 'failed'>('idle');

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

  /**
   * When Stripe Checkout redirects back to /event/{id}?registration=success|cancel,
   * show the matching state. The QR ticket for a paid registration arrives by
   * email once the webhook confirms the payment.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * THE-355 — 🔴 DORMANT, AND THE GATE IS WHAT MAKES IT DORMANT.
   *
   * ⚠️ THE STATE STAYS; THE READ THAT SETS IT IS GATED. Asked to report whether
   * this should go or stay dormant: IT STAYS, GATED, and the reason is that
   * neither of the other two answers is honest.
   *
   *   · DELETING IT would be this ticket vandalising a dormant rail on its way
   *     past. `PAID_EVENTS_ENABLED` is a real switch with a real day to be
   *     flipped, `paid-events-feature.ts` is written around flipping it, and
   *     the branch below is the correct screen for the world where a rail took
   *     the money and a webhook said so. Deleting it means whoever flips the
   *     flag ships a checkout that returns to a registration form.
   *   · LEAVING IT UNGATED is what shipped, and it is the defect: the strings
   *     are reachable from a URL ANY VISITOR CAN TYPE. `?registration=success`
   *     on a live event rendered "Payment received — you're registered!" to
   *     somebody who had paid nobody. 🔴 THAT IS A LIE ABOUT MONEY, and it does
   *     not need a Stripe session to tell it — only a query string.
   *
   * 🔴 SO THE BRANCH IS MADE STRUCTURALLY UNREACHABLE RATHER THAN MERELY
   * UNUSED. `PAID_EVENTS_ENABLED` is a module constant and it is `false`, so
   * `setPostPayment` is never called, `postPayment` is never anything but
   * `null`, and no string inside either branch can render for any input. The
   * day the flag goes true, the rail that makes those sentences TRUE is the
   * same thing that makes them reachable again — one switch, both halves.
   *
   * ⚠️ AND IT IS THE SAME GATE THE SUBMIT ROUTE USES. `requiresPayment` there is
   * `amount > 0 && !waitlisted && !manualConfirmationMode()`, and
   * `manualConfirmationMode()` is `!PAID_EVENTS_ENABLED && …`. So the condition
   * that decides whether anyone is ever SENT to Checkout and the condition that
   * decides whether the RETURN screen exists are the same proposition, spelled
   * from the one constant. They cannot drift into disagreeing.
   */
  const [postPayment, setPostPayment] = useState<'success' | 'cancel' | null>(null);
  useEffect(() => {
    if (!PAID_EVENTS_ENABLED) return;
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

  const inputCls = 'w-full px-4 py-2.5 border border-line rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:border-transparent';
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
      setDone({
        ticketCode: data.ticketCode,
        waitlisted: !!data.waitlisted,
        paymentReference: typeof data.paymentReference === 'string' ? data.paymentReference : null,
        amountCents: typeof data.amount === 'number' ? data.amount : 0,
        claimToken: typeof data.paymentClaimToken === 'string' ? data.paymentClaimToken : null,
      });
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * THE-355 — 🔴 THE PUBLIC REGISTRANT PRESSES "I'VE PAID".
   *
   * ⚠️ IT SENDS THE TOKEN AND NO REGISTRATION ID, because the route takes none:
   * the token SELECTS the row it was minted for, so there is no pair to
   * mismatch and no way to address somebody else's seat. See the route.
   *
   * ⚠️ THE PROVIDER IS NOT ASKED FOR, the same reading `UserEvents` records:
   * the registrant has just been shown every tile the church accepts and may
   * have used any of them, and a wrong answer on a required field is worse for
   * the admin than an honest blank. The inbox row says "did not say which app
   * they used" when it is null.
   */
  const pressClaim = async () => {
    if (!done?.claimToken) return;
    setClaimState('saving');
    try {
      const resp = await fetch('/api/event-payment/public-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, token: done.claimToken, provider: null }),
      });
      if (!resp.ok) throw new Error('claim failed');
      setClaimState('claimed');
    } catch {
      // 🔴 VISIBLE, AND THE REGISTRATION IS UNTOUCHED. `done` is not cleared, so
      // the ticket code, the reference and the links all stay on screen.
      setClaimState('failed');
    }
  };

  const startLabel = fmtDateTime(event.startDate);

  const EventHeader = (
    <div className="bg-surface-raised rounded-[14px] shadow-xs border border-line overflow-hidden mb-4">
      {event.coverImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={event.coverImage} alt={event.title} className="w-full h-44 object-cover" />
      )}
      <div className="p-6">
        <h1 className="font-display text-2xl font-light tracking-[-0.02em] text-strong mb-2">{event.title}</h1>
        <div className="space-y-1.5 mb-3">
          {startLabel && (
            <p className="flex items-center gap-2 text-sm text-body"><Calendar size={15} style={{ color: primaryColor }} /> {startLabel}</p>
          )}
          {event.isOnline ? (
            <p className="flex items-center gap-2 text-sm text-body"><Globe size={15} style={{ color: primaryColor }} /> Online event</p>
          ) : event.location ? (
            <p className="flex items-center gap-2 text-sm text-body"><MapPin size={15} style={{ color: primaryColor }} /> {event.location}</p>
          ) : null}
        </div>
        {event.description && <p className="text-sm text-muted whitespace-pre-line">{event.description}</p>}
      </div>
    </div>
  );

  // ── Returned from Stripe Checkout (paid ticket) ──
  if (postPayment === 'success') {
    return (
      <Shell logo={logo} tenantName={tenantName} primaryColor={primaryColor}>
        {EventHeader}
        <div className="bg-surface-raised rounded-[14px] shadow-xs border border-line p-8 text-center">
          <CheckCircle2 size={48} className="mx-auto mb-4" style={{ color: primaryColor }} />
          <h2 className="font-display text-xl font-bold text-strong mb-1">Payment received — you&apos;re registered!</h2>
          <p className="text-sm text-muted mb-2">Thanks for registering for {event.title}.</p>
          <p className="text-sm text-faint">Your ticket and QR code are on their way to your email.</p>
        </div>
      </Shell>
    );
  }
  if (postPayment === 'cancel') {
    return (
      <Shell logo={logo} tenantName={tenantName} primaryColor={primaryColor}>
        {EventHeader}
        <div className="bg-surface-raised rounded-[14px] shadow-xs border border-line p-8 text-center">
          <h2 className="font-display text-xl font-bold text-strong mb-1">Registration not completed</h2>
          <p className="text-sm text-muted mb-5">Your payment was cancelled, so you haven&apos;t been charged and no ticket was issued.</p>
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
        <div className="bg-surface-raised rounded-[14px] shadow-xs border border-line p-8 text-center">
          <CheckCircle2 size={48} className="mx-auto mb-4" style={{ color: primaryColor }} />
          <h2 className="font-display text-xl font-bold text-strong mb-1">
            {done.waitlisted ? "You're on the waitlist!" : "You're registered!"}
          </h2>
          <p className="text-sm text-muted mb-4">
            {done.waitlisted
              ? "We'll contact you if a spot opens up."
              : 'Show this code at the door:'}
          </p>
          {!done.waitlisted && (
            <div className="text-3xl font-mono font-bold tracking-widest text-strong my-4">{done.ticketCode}</div>
          )}
          <p className="text-sm text-faint">A confirmation has been sent to {email}.</p>
          {/*
            🔴 THE-351's PAYMENT INSTRUCTION, AND THE-355's LINKS, CLAIM CONTROL
            AND NO-LINKS STATE — ON THE ONE SCREEN A LOGGED-OUT REGISTRANT IS
            GUARANTEED TO SEE.

            THE FOUNDER CHOSE REVOLUT AND WAS NEVER SHOWN IT. THE-351 rendered
            the reference and the disclaimer here and nothing else: `givingLinks`
            reached the LOGGED-IN member app through `/api/my-registrations` and
            reached this page not at all. So the church picked a provider and the
            member was never shown it — the one screen that needed the link was
            the one screen without it.

            🔴 THE PRIMITIVES, AND THE ONES REJECTED.

            `alert` for every standing notice (the instruction, the no-links
            state, the claimed state): it carries `role="alert"`, so what a paid
            registrant must not miss reaches a screen reader and not only an eye,
            and it paints from `bg-card`/`text-card-foreground`, which resolve on
            `:root` in `globals.css` — so this mints no colour of its own and
            both palettes answer for it.

            ⚠️ THE-351 REJECTED `alert` HERE ON A PREMISE THAT WAS WRONG. Its
            note reads: "this shell is the public event page and carries none of
            the admin app's primitives". The shadcn token layer is declared on
            bare `:root` — `--card`, `--foreground`, `--border` and the rest —
            not inside an admin scope, so every primitive resolves on this page
            exactly as it does on an admin one. The copy was set in the page's
            own type for a reason that does not hold, and the accessible role was
            the cost.

            `item` for each payment link: a row with a label, a means of reaching
            it and one action is what `item` IS, and `ItemActions` keeps the tap
            target out of the text flow.

            `separator` for the rule above the block — it replaces a hand-rolled
            `border-t`.

            🔴 REJECTED, EACH FOR A REASON:
            · `button` for "I've paid" — its `default` size is `h-8` (32px) and
              its largest, `lg`, is `h-9` (36px). Both are UNDER the 44px tap
              floor below `sm`, so spending it would mean overriding the one
              thing it was chosen for. The same finding THE-351 recorded for the
              inbox's own Confirm. A plain button wearing `min-h-11` and
              `CONTROL_DENSITY.action` mints no height of its own.
            · `card` — this is a notice inside a panel that is already a card,
              not a second container.
            · `badge` — the instruction is three sentences; a badge is a label.
            · `empty` — it announces an absent COLLECTION. A church that has
              published no payment link is a capability withheld over a
              registration that completely succeeded, not an empty list.
            · `dialog` — nothing here is a decision that must interrupt, and the
              registrant has already finished the only flow on this page.
            · `sonner` — a toast leaves the screen; a payment instruction the
              registrant must act on later must not.
            · `tooltip` — a phone has no hover, and a member who believes "I've
              paid" settles the matter will arrive at the door believing they are
              paid. The help text sits beside the button, never behind a reveal.
          */}
          {done.paymentReference && !done.waitlisted && (
            <div className="mt-5 text-left" data-public-payment-note>
              <Separator className="mb-5" />

              {payOptions.length > 0 ? (
                <>
                  <Alert>
                    <AlertTitle>{PUBLIC_PAY_TITLE}</AlertTitle>
                    <AlertDescription>
                      {publicPayBody(tenantName, done.amountCents, done.paymentReference)}
                    </AlertDescription>
                  </Alert>

                  {/*
                    🔴 THE CHURCH'S OWN LINKS. A row with no valid URL renders as a
                    handle or an email rather than a dead link — the Zelle case,
                    which has no per-church URL at all and is reached by email
                    alone. `readGivingLinks` re-derived every one of these on
                    this request, so a stored URL that no longer passes the
                    allow-list has already stopped being a link.
                  */}
                  <div className="mt-3 space-y-1.5" data-public-pay-options>
                    {payOptions.map((o) => (
                      <Item key={o.id} variant="outline" data-public-pay-option={o.id}>
                        <ItemContent>
                          <ItemTitle>{o.label}</ItemTitle>
                          {!o.url && (o.handle || o.email) && (
                            <ItemDescription>{o.handle || o.email}</ItemDescription>
                          )}
                        </ItemContent>
                        {o.url && (
                          <ItemActions>
                            <a
                              href={o.url}
                              target="_blank"
                              rel="noreferrer"
                              data-public-pay-link
                              className={`inline-flex items-center justify-center min-h-11 px-4 rounded-xl text-sm font-semibold underline text-body ${CONTROL_DENSITY.action}`}
                            >
                              Open
                            </a>
                          </ItemActions>
                        )}
                      </Item>
                    ))}
                  </div>

                  {/*
                    🔴 THE CONTROL THE INBOX WAS WAITING FOR. Without it no claim was
                    ever created, so the church's inbox was empty — correctly,
                    about a thing that never happened.
                  */}
                  {claimState === 'claimed' ? (
                    <div className="mt-4" data-public-claim-done>
                      <Alert>
                        <AlertTitle>{PUBLIC_CLAIMED_TITLE}</AlertTitle>
                        <AlertDescription>
                          {publicClaimedBody(tenantName, done.paymentReference)}
                        </AlertDescription>
                      </Alert>
                    </div>
                  ) : done.claimToken ? (
                    <div className="mt-4">
                      <button
                        type="button"
                        data-public-claim
                        onClick={() => void pressClaim()}
                        disabled={claimState === 'saving'}
                        className={`w-full min-h-11 rounded-xl text-sm font-semibold text-white disabled:opacity-50 ${CONTROL_DENSITY.action}`}
                        style={{ backgroundColor: primaryColor }}
                      >
                        {claimState === 'saving' ? 'Sending…' : MEMBER_CLAIM_BUTTON}
                      </button>
                      <p className="mt-1.5 text-[11px] text-muted" data-public-claim-help>
                        {PUBLIC_CLAIM_HELP}
                      </p>
                      {claimState === 'failed' && (
                        <p
                          className="mt-1.5 text-[11px] font-semibold text-destructive"
                          data-public-claim-failed
                        >
                          {MEMBER_CLAIM_FAILED}
                        </p>
                      )}
                    </div>
                  ) : null}
                </>
              ) : (
                /*
                  🔴 STOP CONDITION 6 — PRICED, WITH NO LINK PUBLISHED. An event with
                  a price and no way to pay is the original defect in a different
                  costume, so this says the true thing rather than leaving a gap:
                  the place is booked, the church has published nowhere to send
                  money, ask them and quote the reference, and the door is not in
                  question either way. No claim control is offered, because there
                  is nothing here they could have paid.
                */
                <Alert data-public-no-links>
                  <AlertTitle>{PUBLIC_NO_LINKS_TITLE}</AlertTitle>
                  <AlertDescription>
                    {publicNoLinksBody(tenantName, done.amountCents, done.paymentReference)}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </div>
      </Shell>
    );
  }

  // ── Event already taken place ──
  if (event.status === 'completed') {
    return (
      <Shell logo={logo} tenantName={tenantName} primaryColor={primaryColor}>
        {EventHeader}
        <div className="bg-surface-raised rounded-[14px] shadow-xs border border-line p-8 text-center">
          <p className="text-body">This event has already taken place.</p>
        </div>
      </Shell>
    );
  }

  // ── Registration not available online ──
  if (!event.registrationEnabled) {
    return (
      <Shell logo={logo} tenantName={tenantName} primaryColor={primaryColor}>
        {EventHeader}
        <div className="bg-surface-raised rounded-[14px] shadow-xs border border-line p-8 text-center">
          <p className="text-body">Registration is not available online. Contact {tenantName} to sign up.</p>
        </div>
      </Shell>
    );
  }

  // ── Registration form ──
  return (
    <Shell logo={logo} tenantName={tenantName} primaryColor={primaryColor}>
      {EventHeader}
      <div className="bg-surface-raised rounded-[14px] shadow-xs border border-line p-6" style={{ paddingBottom: 24 }}>
        {/* Ticket type selector */}
        {ticketTypes.length > 0 && (
          <div className="mb-5">
            <label className="block text-sm font-semibold text-strong mb-2">Select a ticket</label>
            <div className="space-y-2">
              {ticketTypes.map((t) => {
                const active = t.id === selectedTicketId;
                return (
                  <button
                    key={t.id}
                    onClick={() => selectTicket(t.id)}
                    className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${active ? 'border-transparent ring-2' : 'border-line hover:border-line-strong'}`}
                    style={active ? ({ '--tw-ring-color': primaryColor } as React.CSSProperties) : undefined}
                  >
                    <div className={`w-4 h-4 rounded-full border-2 shrink-0 ${active ? '' : 'border-line-strong'}`} style={active ? { borderColor: primaryColor, backgroundColor: primaryColor } : undefined} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-strong">{t.name}</p>
                      {t.description && <p className="text-xs text-faint">{t.description}</p>}
                      {t.capacity != null && <p className="text-[11px] text-wheat-600 mt-0.5">Limited spots</p>}
                    </div>
                    <span className="text-sm font-bold text-strong shrink-0">{fmtCents(t.price)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Signed-in hint — the ticket links to this account's "My Events". */}
        {authUser && (
          <div className="mb-4 flex items-center gap-2 text-xs text-muted bg-surface-sunken rounded-xl px-3 py-2">
            <CheckCircle2 size={14} style={{ color: primaryColor }} />
            <span>Registering as <span className="font-semibold text-strong">{authUser.email}</span> — your ticket will appear in My Events.</span>
          </div>
        )}

        {/* Attendee info */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-strong mb-1.5">First Name<span className="text-red-500 ml-0.5">*</span></label>
              <input className={inputCls} style={ring} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-strong mb-1.5">Last Name<span className="text-red-500 ml-0.5">*</span></label>
              <input className={inputCls} style={ring} value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-strong mb-1.5">Email<span className="text-red-500 ml-0.5">*</span></label>
            <input type="email" className={inputCls} style={ring} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-strong mb-1.5">Phone <span className="text-faint font-normal">(optional)</span></label>
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
              <p className="text-sm font-semibold text-strong">Additional Attendees</p>
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
          <label className="block text-sm font-medium text-strong mb-1.5">Discount code <span className="text-faint font-normal">(optional)</span></label>
          <div className="flex items-center gap-2">
            <input className={inputCls} style={ring} value={discountInput}
              onChange={(e) => { setDiscountInput(e.target.value.toUpperCase()); setDiscountResult(null); setDiscountError(null); }}
              placeholder="Enter code" />
            <button onClick={applyDiscount} disabled={applyingDiscount || !discountInput.trim() || !selectedTicket}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold border border-line text-strong hover:bg-surface-sunken disabled:opacity-50 shrink-0">
              {applyingDiscount ? '…' : 'Apply'}
            </button>
          </div>
          {discountResult && <p className="text-xs text-field-600 mt-1.5 font-medium">✓ Discount applied — {fmtCents(discountResult.discountAmount)} off</p>}
          {discountError && <p className="text-xs text-red-600 mt-1.5">{discountError}</p>}
        </div>
        )}

        {/* Order summary */}
        {selectedTicket && (
          <div className="mt-5 bg-surface-sunken rounded-xl p-4 text-sm">
            <div className="flex justify-between text-body">
              <span>{selectedTicket.name}{quantity > 1 ? ` × ${quantity}` : ''}</span>
              <span>{fmtCents(gross)}</span>
            </div>
            {quantity > 1 && (
              <p className="text-[11px] text-faint mt-0.5">{quantity} tickets ({fmtCents(selectedTicket.price)} each)</p>
            )}
            {discountAmount > 0 && (
              <div className="flex justify-between text-field-600 mt-1"><span>Discount</span><span>-{fmtCents(discountAmount)}</span></div>
            )}
            <div className="flex justify-between font-bold text-strong mt-2 pt-2 border-t border-line"><span>Total</span><span>{fmtCents(total)}</span></div>
          </div>
        )}

        {error && <p className="text-sm text-red-600 mt-4">{error}</p>}

        {/*
          🔴 THE-355 — THE BUTTON THAT LIED, AND WHAT IT SAYS NOW.

          THE FOUNDER: "i pressed on pay but it did not brought me to the
          payment page but to the payment confirmation directly."

          It did exactly what the code says it does. Under manual confirmation
          the submit route never enters the payment branch — `requiresPayment`
          is `amount > 0 && !waitlisted && !manualConfirmationMode()` and
          `manualConfirmationMode()` is true — so no Checkout session is created,
          no `url` comes back, and the redirect the button PROMISED cannot
          happen. "Continue to payment" and "Redirecting to payment…" were both
          claims about a processor that no longer exists.

          🔴 SO THE COPY IS DERIVED FROM THE SAME CONSTANT THAT DECIDES THE
          BEHAVIOUR, rather than describing it from memory.
          `manualConfirmationMode()` is what makes the redirect not happen, so it
          is what chooses the words — the two cannot drift apart, and the day a
          rail exists the promise comes back with the thing it promises.

          ⚠️ IT STILL NAMES THE PRICE. The registrant is about to owe money and
          must see how much before they commit; what is removed is the claim
          about WHERE THEY ARE ABOUT TO BE SENT, which was the false half.
        */}
        <button onClick={submit} disabled={submitting} data-public-submit
          className="mt-6 w-full py-3 rounded-xl text-white font-semibold disabled:opacity-50"
          style={{ backgroundColor: primaryColor }}>
          {submitting
            ? (total > 0 && !manualConfirmationMode() ? 'Redirecting to payment…' : 'Registering…')
            : (total > 0
              ? (manualConfirmationMode()
                ? `Register · ${fmtCents(total)}`
                : `Continue to payment · ${fmtCents(total)}`)
              : 'Register')}
        </button>
      </div>
    </Shell>
  );
};

export default PublicEventRegistration;
