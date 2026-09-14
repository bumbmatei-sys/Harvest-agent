import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

/**
 * THE-359 · 🔴 NO QR CODE UNTIL THE TENANT HAS CONFIRMED THE PAYMENT — RENDERED.
 *
 * THE FOUNDER: "the user should not have the qr code unless his payment has
 * been confirmed."
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY THE WHOLE SCREEN, AND NOT THE MODAL THROUGH A SEAM
 *
 * `TicketModal` is not exported, and this suite does not add a seam for it. The
 * gate is one boolean read off the ticket the LIST hands the modal, so a test
 * that constructs the modal's props itself would be asserting its own fixture:
 * the interesting question is whether the state that reaches the modal from
 * `/api/my-registrations` is the one the gate reads. So every case below mounts
 * the real `UserEvents`, lets it merge a mocked API ticket, clicks "View
 * ticket" the way a member does, and reads the modal out of the live DOM.
 *
 * #475 shipped 70 tests over a menu that never opened. If the modal ever stops
 * opening, `ticket()` throws at the first case rather than every assertion
 * passing vacuously over an empty document.
 *
 * ⚠️ NO LAYOUT CLAIM IS MADE HERE. happy-dom has no layout engine. The 44px
 * question is asked in `THE-359.partnership-button.layout.test.tsx`, in real
 * Chromium.
 *
 * ⚠️ EVERY FIXTURE INSTANT IS FAR-FUTURE AND BUILT FROM PARTS. #468 turned
 * `main` red for everyone with a date pinned near the run date.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AT = (d: number) => new Date(Date.UTC(2031, 8, d, 10, 0, 0)).toISOString();
/** Far-future, so an "upcoming events" filter keeps the row on any CI clock. */
const START_MS = Date.UTC(2031, 8, 20, 18, 0, 0);

/** What `useTenantOptional` answers. Swapped per case to drive the fallback. */
const branding = { current: { churchName: 'Kingdom Living' } as { churchName?: string } | undefined };
/** What `/api/my-registrations` answers. */
const tickets = { current: [] as Array<Record<string, unknown>> };

vi.mock('../inbox/payment-claims-client', () => ({
  claimPaymentSent: async () => {},
  fetchPaymentInbox: async () => ({ items: [], count: 0, exact: true }),
  confirmPaymentClaim: async () => ({ alreadyConfirmed: false, visibleToMember: true }),
  invalidatePaymentInbox: () => {},
}));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u', email: 'dana@example.com' } } }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}), query: (q: unknown) => q, getDocs: async () => ({ docs: [] }),
  orderBy: () => ({}), limit: () => ({}),
}));
/**
 * 🔴 THE QR GENERATOR IS REAL ENOUGH TO BE OBSERVED. It records every call, so
 * "no QR is rendered" can be told apart from "a QR was generated and then
 * hidden by a class" — the second would still put the ticket code on a canvas
 * the member could screenshot, and is not what the founder asked for.
 */
const qrCalls: string[] = [];
vi.mock('qrcode', () => ({
  default: {
    toDataURL: async (text: string) => { qrCalls.push(text); return 'data:image/png;base64,AA'; },
  },
}));
vi.mock('../../utils/tenant-scope', () => ({ getTenantScope: async () => 't1' }));
vi.mock('../../utils/share-url', () => ({ useShareBaseUrl: () => 'https://t1.theharvest.app' }));
vi.mock('../ShareButton', () => ({ default: () => <span /> }));
vi.mock('../../contexts/TenantContext', () => ({
  useTenantOptional: () => (branding.current ? { branding: branding.current } : undefined),
}));
vi.mock('../../utils/auth-fetch', () => ({
  authFetch: async () => ({ ok: true, json: async () => ({ tickets: tickets.current }) }),
}));

const COPY = await import('../../lib/event-payment-claims');
const UserEvents = (await import('../UserEvents')).default;

let container: HTMLDivElement;
let root: Root;

const TICKET_CODE = 'HVX-7Q2M4T';
const REFERENCE = 'HV-263J8N';

/** One ticket as `/api/my-registrations` returns it, with the payment state varied. */
const ticketFor = (payment: string, over: Record<string, unknown> = {}) => ({
  id: 'reg1',
  eventId: 'e1',
  ticketCode: TICKET_CODE,
  status: 'confirmed',
  ticketTypeName: 'Adult',
  waitlisted: false,
  amount: payment === 'free' ? 0 : 5000,
  payment,
  paymentReference: payment === 'free' ? null : REFERENCE,
  paymentConfirmedAt: payment === 'confirmed' ? AT(13) : null,
  payOptions: [],
  event: { title: 'Crusade Bangladesh', startMillis: START_MS, location: 'Dhaka', isOnline: false, status: 'published' },
  ...over,
});

/** Mount the screen, open the one ticket, and hand back the modal's element. */
async function openTicket(payment: string, over: Record<string, unknown> = {}): Promise<HTMLElement> {
  tickets.current = [ticketFor(payment, over)];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<UserEvents onBack={() => {}} />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  const view = [...container.querySelectorAll('button')]
    .find((b) => b.textContent?.includes('View ticket'));
  if (!view) {
    throw new Error('the "View ticket" control did not render — the ticket never reached the list');
  }
  await act(async () => { view.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  const modal = container.querySelector('.fixed.inset-0') as HTMLElement | null;
  if (!modal) throw new Error('the ticket modal did not open — every assertion below would be vacuous');
  return modal;
}

const qrImage = (m: HTMLElement) => m.querySelector('img[alt="Ticket QR code"]');
const text = (m: HTMLElement) => m.textContent ?? '';

beforeEach(() => {
  qrCalls.length = 0;
  branding.current = { churchName: 'Kingdom Living' };
});
afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  container?.remove();
});

/* ═══ 4 · a PAID, UNCONFIRMED ticket shows NO QR ══════════════════════════ */

describe('4 · a PAID ticket nobody has confirmed shows no QR code', () => {
  for (const payment of ['unpaid', 'claimed'] as const) {
    it(`🔴 ${payment}: no QR image, and none was ever generated`, async () => {
      const m = await openTicket(payment);
      expect(qrImage(m), `🔴 a ${payment} ticket rendered its QR code`).toBeNull();
      // Not merely hidden: the encoder was never asked for one.
      expect(qrCalls, `🔴 a QR was generated for a ${payment} ticket`).toEqual([]);
      expect(m.querySelector('[data-ticket-qr="withheld"]'),
        'the withheld state did not render at all').not.toBeNull();
      expect(m.querySelector('[data-ticket-qr="shown"]')).toBeNull();
    });

    it(`🔴 ${payment}: the ticket CODE is withheld with it`, async () => {
      const m = await openTicket(payment);
      /**
       * 🔴 THE CODE IS THE QR'S PAYLOAD. `QRCode.toDataURL(t.ticketCode)` — so
       * printing it beside a withheld QR is the same token in text, and anyone
       * could turn it back into a scannable one. What the member keeps for
       * reconciliation is the PAYMENT REFERENCE, asserted present below.
       */
      expect(text(m), '🔴 the ticket code is still on screen with the QR withheld')
        .not.toContain(TICKET_CODE);
      expect(text(m), 'the payment reference went with it — nothing left to reconcile by')
        .toContain(REFERENCE);
    });

    it(`🔴 ${payment}: nothing tells them to present anything at the door`, async () => {
      const m = await openTicket(payment);
      expect(text(m), 'a member with no QR is told to present one')
        .not.toMatch(/present this at the door/i);
      expect(text(m), '🔴 the deleted door guarantee came back').not.toMatch(/turned away/i);
    });
  }
});

/* ═══ 5 · a PAID, CONFIRMED ticket shows its QR ═══════════════════════════ */

describe('5 · a PAID ticket the tenant has confirmed shows its QR code', () => {
  it('🔴 the QR renders, from the ticket code, and the code is printed with it', async () => {
    const m = await openTicket('confirmed');
    expect(qrImage(m), '🔴 a CONFIRMED ticket lost its QR — the gate is stuck shut').not.toBeNull();
    expect(qrCalls, 'the QR was not generated from the ticket code').toEqual([TICKET_CODE]);
    expect(text(m)).toContain(TICKET_CODE);
    expect(m.querySelector('[data-ticket-qr="shown"]')).not.toBeNull();
    expect(m.querySelector('[data-ticket-qr="withheld"]')).toBeNull();
  });
});

/* ═══ 6 · a FREE ticket is untouched ══════════════════════════════════════ */

describe('6 · a FREE ticket always shows its QR code', () => {
  /**
   * 🔴 THE REGRESSION THIS TICKET IS MOST LIKELY TO SHIP. The gate is the
   * absence of a CONFIRMATION, not the presence of a price, and a free seat has
   * no payment to confirm. Both spellings are exercised: `payment: 'free'` as
   * `/api/my-registrations` derives it, and a ticket carrying NO `payment`
   * field at all — every row issued before THE-351 existed.
   */
  it('🔴 payment: "free" — the QR renders exactly as it always has', async () => {
    const m = await openTicket('free');
    expect(qrImage(m), '🔴 A FREE TICKET LOST ITS QR CODE').not.toBeNull();
    expect(qrCalls).toEqual([TICKET_CODE]);
    expect(text(m)).toContain(TICKET_CODE);
    expect(text(m)).toMatch(/present this at the door/i);
    // And no payment vocabulary appeared on it.
    expect(m.querySelector('[data-ticket-payment]'),
      'a free registration grew payment vocabulary').toBeNull();
    expect(m.querySelector('[data-ticket-qr="withheld"]')).toBeNull();
  });

  it('🔴 a ticket with NO payment field at all keeps its QR', async () => {
    const m = await openTicket('free', { payment: undefined, amount: 0 });
    expect(qrImage(m), '🔴 a pre-THE-351 ticket lost its QR').not.toBeNull();
    expect(qrCalls).toEqual([TICKET_CODE]);
  });
});

/* ═══ 7 · what a member sees instead ══════════════════════════════════════ */

describe('7 · a member with no QR still sees that their place is held', () => {
  it('🔴 the named wording is on screen, and it does not read as a failure', async () => {
    const m = await openTicket('claimed');
    const withheld = m.querySelector('[data-ticket-qr="withheld"]')!;
    expect(withheld.textContent).toContain(COPY.TICKET_QR_WAITING_TITLE);
    expect(withheld.textContent).toContain('Your place is held');
    expect(withheld.textContent).toContain(COPY.ticketQrWaitingBody('Kingdom Living'));
    expect(withheld.textContent).toContain('Your registration is complete');
    // 🔴 THE ABSENCE OF A QR MUST NOT READ AS "YOUR REGISTRATION FAILED".
    for (const scare of [/failed/i, /error/i, /not registered/i, /cancell?ed/i, /problem/i]) {
      expect(withheld.textContent, `the waiting panel reads as a failure: ${scare}`)
        .not.toMatch(scare);
    }
    // It says WHO has to act, and it is not Harvest.
    expect(withheld.textContent).toContain('Kingdom Living');
    expect(COPY.claimsVerification(withheld.textContent ?? '')).toBeNull();
  });

  it('🔴 it is rendered text, not a hover — a phone has no hover', async () => {
    const m = await openTicket('unpaid');
    const withheld = m.querySelector('[data-ticket-qr="withheld"]') as HTMLElement;
    expect(withheld.getAttribute('title'), 'the explanation moved behind a hover').toBeNull();
    expect(withheld.hidden).toBe(false);
  });
});

/* ═══ 9 · the confirmed-ticket copy names the tenant ══════════════════════ */

describe('9 · the confirmed ticket names the TENANT, in both the heading and the body', () => {
  it('🔴 "Marked paid by Kingdom Living", and Kingdom Living marked it', async () => {
    const m = await openTicket('confirmed');
    const panel = m.querySelector('[data-ticket-payment="confirmed"]')!;
    const t = panel.textContent ?? '';
    // The heading was the constant 'Marked paid by the church' until THE-359.
    expect(t, 'the confirmed HEADING does not name the tenant')
      .toContain('Marked paid by Kingdom Living');
    // And the body was '{church} marked this ticket paid on …'.
    expect(t, 'the confirmed BODY does not name the tenant')
      .toContain('Kingdom Living marked this ticket paid');
    expect(t, '🔴 the confirmed ticket still says "the church"').not.toMatch(/the church/i);
    expect(COPY.claimsVerification(t)).toBeNull();
  });

  it('🔴 and every other member-facing state names it too', async () => {
    for (const [payment, expected] of [
      ['unpaid', 'Pay Kingdom Living'],
      ['claimed', 'Waiting for Kingdom Living to check'],
    ] as const) {
      const m = await openTicket(payment);
      expect(m.textContent, `${payment} does not name the tenant`).toContain(expected);
      expect(m.textContent, `${payment} still says "the church"`).not.toMatch(/the church/i);
      await act(async () => { root.unmount(); });
      container.remove();
    }
  });
});

/* ═══ 10 · a missing tenant name renders no blank ═════════════════════════ */

describe('10 · a missing tenant name does not render a blank sentence', () => {
  /**
   * 🔴 `tenants/{t}.name` IS RAW FIRESTORE AND CAN BE ABSENT, and this screen
   * reads `branding.churchName`, which a tenant that never completed branding
   * simply does not have. Before THE-359 the local fallback was the literal
   * 'the church', which is the noun the founder asked to remove; the danger in
   * removing it was leaving a sentence that reads "  has been asked to look".
   *
   * ⚠️ ALL FOUR ABSENCES ARE EXERCISED — no provider at all, no branding, an
   * undefined name and a whitespace-only one. A fallback that covered three of
   * them would ship the fourth.
   */
  const ABSENT: ReadonlyArray<[string, { churchName?: string } | undefined]> = [
    ['no TenantProvider at all', undefined],
    ['branding with no name', {}],
    ['an explicitly undefined name', { churchName: undefined }],
    ['a whitespace-only name', { churchName: '   ' }],
  ];

  for (const [what, value] of ABSENT) {
    it(`🔴 ${what} — the named fallback stands in, and no double space appears`, async () => {
      branding.current = value;
      const m = await openTicket('claimed');
      const t = text(m);
      expect(t, 'the fallback is not the one this ticket named')
        .toContain(COPY.TENANT_NAME_FALLBACK);
      expect(t).toContain('Waiting for the event organizer to check');
      expect(t, '🔴 the removed noun came back as the fallback').not.toMatch(/the church/i);
      expect(t, 'the fallback is Harvest, which is the one word it must never be')
        .not.toMatch(/Harvest has been asked|Waiting for Harvest|by Harvest/);
      // 🔴 THE BLANK THIS EXISTS TO PREVENT.
      expect(t, 'a sentence rendered with a hole where the name should be')
        .not.toMatch(/ {2,}/);
      expect(t).not.toMatch(/\bfor\s+has been asked/);
      await act(async () => { root.unmount(); });
      container.remove();
    });
  }

  it('🔴 the resolver itself, at every absent spelling', () => {
    for (const absent of [null, undefined, '', '   ', '\t\n']) {
      expect(COPY.tenantLabel(absent as string | null | undefined),
        `tenantLabel(${JSON.stringify(absent)}) did not fall back`)
        .toBe(COPY.TENANT_NAME_FALLBACK);
    }
    // A real name is passed through untouched, and is not "the church".
    expect(COPY.tenantLabel('Kingdom Living')).toBe('Kingdom Living');
    expect(COPY.TENANT_NAME_FALLBACK, 'the fallback names a church').not.toMatch(/church/i);
    expect(COPY.TENANT_NAME_FALLBACK, 'the fallback names Harvest').not.toMatch(/harvest/i);
  });
});
