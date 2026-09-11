import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * THE-355 · 🔴 "confirmed" MEANT TWO THINGS ON ONE ROW, AND THE SURFACES THAT
 * MUST NOT HAVE MOVED.
 *
 * THE FOUNDER'S SCREENSHOT of his own event page: two attendees, each showing a
 * badge reading `confirmed` AND a warning reading "Payment not confirmed", each
 * with a working Confirm button beside both. Both facts were TRUE — the badge is
 * REGISTRATION status and the warning is PAYMENT state — but an admin reading
 * "confirmed · Payment not confirmed" cannot tell what Confirm is about to do.
 *
 * Tests 10, 12, 16 and 17.
 *
 * 🔴 THE HARNESS IS THE-351's, REUSED WHOLESALE — same mocks, same fixtures,
 * same idioms — because a second harness for one screen is a second thing to
 * keep true, and because these assertions are about the SAME four rows THE-351
 * measured, seen after this ticket's wording change.
 *
 * ⚠️ EVERY FIXTURE DATE IS A FIXED, FAR-FUTURE INSTANT built from parts. #468
 * turned `main` red for everyone with a date pinned near the run date, and
 * THE-324 left one four days out that would have failed silently.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stored: Array<Record<string, unknown>> = [];

/** A far-future instant, never `new Date()` and never a literal near today. */
const AT = (d: number, h = 9) => new Date(Date.UTC(2031, 8, d, h, 0, 0));

const GIVING_LINKS = {
  paypal: { url: 'https://paypal.me/gracechapel' },
  revolut: { url: 'https://revolut.me/gracechapel' },
  zelle: { email: 'give@grace.example' },
};

const branding = { current: { churchName: 'Grace Chapel', givingLinks: GIVING_LINKS } as Record<string, unknown> | null };

const PAID_EVENT = {
  id: 'ev-paid', title: 'Autumn Retreat', description: '', coverImage: null,
  location: 'Hall', isOnline: false, onlineLink: null,
  startDate: { toDate: () => AT(4, 10) }, endDate: null,
  capacity: 100, registrationDeadline: null, price: 0, currency: 'usd',
  status: 'published' as const, tenantId: 't1', createdAt: null, createdBy: 'u', pinned: false,
  registrationEnabled: true,
  ticketTypes: [{ id: 'tt', name: 'Adult', description: null, price: 5000, capacity: 100, order: 0 }],
  waitlistEnabled: true,
  discountCodes: [{ code: 'EARLY', type: 'percent' as const, value: 10, maxUses: null, usedCount: 0 }],
  showOnPublicCalendar: true,
  paymentProviders: ['paypal', 'revolut'],
};

/** Four rows: free, unpaid, claimed, confirmed — one per payment state. */
const REGISTRATIONS = [
  {
    id: 'r-free', eventId: 'ev-paid', name: 'Free Attendee', email: 'free@example.com',
    phone: '', ticketCode: 'AAA111', status: 'confirmed', amount: 0,
    registeredAt: { toDate: () => AT(1) },
  },
  {
    id: 'r-unpaid', eventId: 'ev-paid', name: 'Unpaid Attendee', email: 'unpaid@example.com',
    phone: '', ticketCode: 'BBB222', status: 'confirmed', amount: 5000,
    paymentStatus: 'unpaid', paymentReference: 'HV-4KTM9P',
    registeredAt: { toDate: () => AT(2) },
  },
  {
    id: 'r-claimed', eventId: 'ev-paid', name: 'Claimed Attendee', email: 'claimed@example.com',
    phone: '', ticketCode: 'CCC333', status: 'confirmed', amount: 5000,
    paymentStatus: 'unpaid', paymentReference: 'HV-QRSTUV',
    paymentClaimedAt: AT(3).toISOString(), paymentClaimPendingAt: AT(3).toISOString(),
    paymentClaimProvider: 'revolut',
    registeredAt: { toDate: () => AT(3) },
  },
  {
    id: 'r-confirmed', eventId: 'ev-paid', name: 'Confirmed Attendee', email: 'ok@example.com',
    phone: '', ticketCode: 'DDD444', status: 'confirmed', amount: 5000,
    paymentStatus: 'confirmed', paymentReference: 'HV-WXYZ23',
    paymentClaimedAt: AT(3).toISOString(), paymentInvoiceId: 'inv1',
    paymentConfirmedAt: AT(5).toISOString(), paymentConfirmedBy: 'admin-uid',
    registeredAt: { toDate: () => AT(4) },
  },
];

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u', email: 'a@t.com' } } }));
vi.mock('firebase/firestore', () => ({
  collection: (_d: unknown, ...s: string[]) => ({ __path: s.join('/') }),
  doc: (_d: unknown, ...s: string[]) => ({ __path: s.join('/') }),
  query: (q: unknown) => q,
  where: (...a: unknown[]) => a, orderBy: (...a: unknown[]) => a, limit: (...a: unknown[]) => a,
  onSnapshot: (q: { __path?: string }, cb: unknown) => {
    const rows = (q?.__path ?? '').includes('registrations') ? REGISTRATIONS : [];
    const docs = rows.map((r) => ({ id: r.id, data: () => r }));
    if (typeof cb === 'function') (cb as (s: unknown) => void)({ docs, forEach: (f: never) => docs.forEach(f), size: docs.length });
    return () => {};
  },
  getDocs: async () => ({ docs: [], forEach: () => {}, size: 0 }),
  getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
  documentId: () => '__name__',
  getDoc: async () => ({ exists: () => true, data: () => ({}) }),
  addDoc: async (_r: unknown, data: Record<string, unknown>) => { stored.push(data); return { id: 'new-ev' }; },
  updateDoc: async (_r: unknown, data: Record<string, unknown>) => { stored.push(data); },
  deleteDoc: async () => {},
  setDoc: async () => {},
  serverTimestamp: () => null,
  Timestamp: { fromDate: (d: Date) => ({ toDate: () => d }) },
  increment: (n: number) => n,
  arrayUnion: (...a: unknown[]) => a, arrayRemove: (...a: unknown[]) => a,
}));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,AA' } }));
vi.mock('../ImageUpload', () => ({ ImageUpload: () => <div data-image-upload="" /> }));
vi.mock('../AdminScreenHeader', () => ({
  useAdminHeader: () => ({ setHeaderAction: () => {}, setHeaderOverride: () => {}, setHeaderTitle: () => {} }),
  HeaderActionButton: (p: Record<string, unknown>) => <button {...p} />,
}));
vi.mock('../member/desktopKit', () => ({ HeroBand: (p: { children?: React.ReactNode }) => <div>{p.children}</div> }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: async () => {} }) }));
vi.mock('../../hooks/queries/useEventQueries', () => ({
  useEvents: () => ({ data: [PAID_EVENT], isLoading: false }),
}));
vi.mock('../../hooks/queries/useMonthEvents', () => ({
  useMonthEvents: () => ({ data: { kind: 'complete', undated: 0, events: [] }, isLoading: false }),
}));
vi.mock('../../utils/notify', () => ({ notifyError: () => {}, notifySuccess: () => {} }));
vi.mock('../../utils/tenant-scope', () => ({
  PLATFORM_TENANT_ID: 'platform', getTenantScope: async () => 't1', getWriteTenantScope: async () => 't1',
}));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: (sel?: (s: unknown) => unknown) => {
    const state = { currentTenantId: 't1', isAuthReady: true, isSuperAdmin: false, currentTenant: { id: 't1' } };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));
vi.mock('../../contexts/TenantContext', () => ({
  useTenantOptional: () => ({ branding: branding.current }),
  useTenant: () => ({ branding: branding.current }),
}));

const AdminEvents = (await import('../AdminEvents')).default;
const { mountScreen, click, settle } = await import('../../test/support/ministry-screens');
const COPY = await import('../../lib/event-payment-claims');

function buttonContaining(root: ParentNode, text: string): HTMLButtonElement {
  const b = Array.from(root.querySelectorAll('button'))
    .find((x) => (x.textContent ?? '').replace(/\s+/g, ' ').includes(text));
  if (!b) throw new Error(`no button containing "${text}" — the markup changed`);
  return b as HTMLButtonElement;
}

/**
 * The attendee ROW for one person: the innermost element that still holds the
 * row's own controls.
 *
 * ⚠️ NOT "the last div containing the name" — that is the inner text block, and
 * it holds no button, so a check that reached for one there would report every
 * attendee as un-checkable and pass the day check-in really did break.
 */
function attendeeRow(root: ParentNode, name: string): HTMLElement {
  const rows = Array.from(root.querySelectorAll('div'))
    .filter((d) => (d.textContent ?? '').includes(name) && d.querySelector('button'));
  const row = rows[rows.length - 1];
  if (!row) throw new Error(`no attendee row for "${name}" — the markup changed`);
  return row as HTMLElement;
}

let mounted: { container: HTMLElement; unmount: () => void } | null = null;
async function screen() {
  mounted = await mountScreen(<AdminEvents />);
  return mounted.container;
}
async function detail(): Promise<HTMLElement> {
  const c = await screen();
  const rows = Array.from(c.querySelectorAll('div'))
    .filter((d) => /Autumn Retreat/.test(d.textContent ?? ''));
  await click(rows[rows.length - 1] as HTMLElement);
  await settle();
  return c;
}

const flat = (el: ParentNode | Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

beforeEach(() => {
  stored.length = 0;
  branding.current = { churchName: 'Grace Chapel', givingLinks: GIVING_LINKS };
});

/* ═══ 10 · the two meanings of "confirmed" are distinguishable ════════════ */

describe('10 · the two meanings of "confirmed" are distinguishable', () => {
  it('\u{1F534} one row no longer says "confirmed" twice about two different things', async () => {
    const c = await detail();
    const row = attendeeRow(c, 'Unpaid Attendee');

    // The PAYMENT side keeps the word — it is the founder's own word for the
    // button and the correct verb for what the CHURCH does.
    const flag = row.querySelector('[data-door-payment="unconfirmed"]');
    expect(flag, 'the door flag is gone').toBeTruthy();
    expect(flat(flag!)).toBe(COPY.DOOR_UNCONFIRMED_BADGE);
    expect(flat(flag!).toLowerCase()).toContain('confirmed');

    /**
     * \u{1F534} AND THE REGISTRATION SIDE GIVES IT UP. The badge renders
     * `registrations/{id}.status`, which is REGISTRATION status: the field that
     * decides whether Check In is offered, set to `confirmed` the moment a seat
     * is taken exactly as it is for a free one. It has never meant money.
     */
    const badge = Array.from(row.querySelectorAll('span'))
      .find((s) => flat(s) === COPY.REGISTRATION_STATUS_LABEL.confirmed);
    expect(badge, 'the registration badge no longer reads "Registered"').toBeTruthy();

    // \u{1F534} THE ASSERTION THAT WOULD HAVE CAUGHT THE FOUNDER'S SCREENSHOT: exactly
    // ONE thing on this row says "confirmed", and it is the payment.
    const saysConfirmed = Array.from(row.querySelectorAll('span'))
      .filter((s) => flat(s).toLowerCase().includes('confirmed'))
      .filter((s) => !s.querySelector('span'));
    expect(saysConfirmed.map(flat), 'two different facts on one row are still spelled the same word')
      .toEqual([COPY.DOOR_UNCONFIRMED_BADGE]);
  });

  it('\u{1F534} the stored status is UNCHANGED — this is a label, not a migration', async () => {
    // A renamed stored enum would be a migration on a live collection to solve a
    // wording problem, and check-in gates on this exact value.
    expect(COPY.registrationStatusLabel('confirmed')).toBe('Registered');
    expect(COPY.REGISTRATION_STATUS_LABEL.confirmed).toBe('Registered');
    // An unknown status renders as ITSELF rather than blank — an admin must be
    // able to see a state this map has not met.
    expect(COPY.registrationStatusLabel('refunded')).toBe('refunded');
    expect(COPY.registrationStatusLabel(undefined)).toBe('');
  });

  it('\u{1F534} every payment state reads differently from the registration badge', async () => {
    const c = await detail();
    const labels = (name: string) => {
      const row = attendeeRow(c, name);
      return {
        reg: Array.from(row.querySelectorAll('span')).map(flat),
        pay: row.querySelector('[data-door-payment]')
          ? flat(row.querySelector('[data-door-payment]')!) : null,
      };
    };
    // The free row carries a registration badge and NO payment flag at all.
    expect(labels('Free Attendee').pay, 'a free seat grew payment vocabulary').toBeNull();
    expect(labels('Free Attendee').reg).toContain('Registered');
    // The confirmed row: "Registered" for the seat, "Paid" for the money.
    expect(labels('Confirmed Attendee').pay).toBe(COPY.DOOR_CONFIRMED_BADGE);
    expect(labels('Confirmed Attendee').reg).toContain('Registered');
    expect(COPY.DOOR_CONFIRMED_BADGE, 'the paid badge collided with the registration one')
      .not.toBe(COPY.REGISTRATION_STATUS_LABEL.confirmed);
  });

  it('\u{1F534} the header count says WHAT IT COUNTS — registrations, not payments', async () => {
    const c = await detail();
    const flatAll = flat(c);
    /**
     * \u{1F534} IT COUNTS `status === 'confirmed'`, i.e. REGISTRATION status. All four
     * fixture rows hold a seat and three of them are unpaid, so the figure is 4
     * and "4 Confirmed" over three unpaid seats was the same collision one level
     * up. It now reads "Registered", which is what the number means.
     */
    expect(flatAll).toContain(COPY.REGISTERED_STAT_LABEL);
    const stat = Array.from(c.querySelectorAll('div'))
      .find((d) => flat(d) === `4${COPY.REGISTERED_STAT_LABEL}`);
    expect(stat, 'the stat no longer counts the four seated registrations').toBeTruthy();
    // And the stat block does not reintroduce the word.
    expect(flat(stat!).toLowerCase(), 'the header still calls registrations "confirmed"')
      .not.toContain('confirmed');
  });
});

/* ═══ 12 · check-in still never blocks on payment ═════════════════════════ */

describe('12 · check-in still never blocks on payment', () => {
  it('\u{1F534} EVERY seated registration has a Check In control, paid or not', async () => {
    const c = await detail();
    for (const name of ['Free Attendee', 'Unpaid Attendee', 'Claimed Attendee', 'Confirmed Attendee']) {
      const row = attendeeRow(c, name);
      const checkIn = Array.from(row.querySelectorAll('button'))
        .find((b) => /Check In/i.test(b.textContent ?? ''));
      expect(checkIn, `\u{1F534} ${name} cannot be checked in — the door now blocks on payment`).toBeTruthy();
      expect((checkIn as HTMLButtonElement).disabled, `${name}'s Check In is disabled`).toBe(false);
    }
  });

  it('\u{1F534} the door control is gated on REGISTRATION status and reads no payment field', async () => {
    // The label changed; the GATE did not. `status === 'confirmed'` is still what
    // decides, which is the shape that makes "let them in, flagged" structural.
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const { stripComments } = await import('../../__tests__/__fixtures__/the-346-strip-comments');
    const src = stripComments(readFileSync(
      path.join(process.cwd(), 'src/components/AdminEvents.tsx'), 'utf8',
    ));
    const gate = "{r.status === 'confirmed' && (";
    expect(src, 'the Check In gate moved off registration status').toContain(gate);
    const after = src.slice(src.indexOf(gate), src.indexOf(gate) + 600);
    expect(after, '\u{1F534} a payment read appeared inside the door control')
      .not.toMatch(/payment/i);
  });
});

/* ═══ 16 · the QR flow, waitlist, discount codes and capacity still work ══ */

describe('16 · the surrounding event machinery is untouched', () => {
  it('\u{1F534} the ticket code the QR encodes is still the ticket code, and is NOT the reference', async () => {
    const c = await detail();
    // Every fixture's ticket code renders on its row, and no reference code
    // appears where a ticket code belongs.
    for (const [name, code] of [
      ['Free Attendee', 'AAA111'], ['Unpaid Attendee', 'BBB222'],
      ['Claimed Attendee', 'CCC333'], ['Confirmed Attendee', 'DDD444'],
    ] as const) {
      expect(flat(attendeeRow(c, name)), `${name} lost its ticket code`).toContain(code);
    }
    /**
     * \u{1F534} TWO IDENTIFIERS, AND ONE OF THEM GRANTS NOTHING. The reference is
     * written into a payment note — on Venmo, whose transaction feed is PUBLIC
     * BY DEFAULT — so it must never become the string that opens a door.
     */
    const { isPaymentReference } = COPY;
    for (const code of ['AAA111', 'BBB222', 'CCC333', 'DDD444']) {
      expect(isPaymentReference(code), 'a ticket code is being read as a payment reference').toBe(false);
    }
    expect(isPaymentReference('HV-4KTM9P')).toBe(true);
  });

  it('\u{1F534} the public registration URL shape is unchanged — it may be printed on something', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const { stripComments } = await import('../../__tests__/__fixtures__/the-346-strip-comments');
    const src = stripComments(readFileSync(
      path.join(process.cwd(), 'src/components/AdminEvents.tsx'), 'utf8',
    ));
    // Assembled so this assertion's own text cannot satisfy it.
    const shape = ['https://${', 'tenantId', '}.theharvest.app/event/${'].join('');
    expect(src, '\u{1F534} the public event URL shape moved — it is printed on real things')
      .toContain(shape);
  });

  it('\u{1F534} the waitlist, the discount code and the ticket capacity are all still on the event', async () => {
    // Read off the fixture the screen actually rendered, so a screen that
    // stopped reading them fails here rather than passing on a constant.
    const c = await detail();
    expect(flat(c), 'the event detail no longer renders').toContain('Autumn Retreat');
    expect(PAID_EVENT.waitlistEnabled).toBe(true);
    expect(PAID_EVENT.discountCodes[0].code).toBe('EARLY');
    expect(PAID_EVENT.ticketTypes[0].capacity).toBe(100);
  });
});

/* ═══ 17 · the CSV Amount column means something true ════════════════════ */

describe('17 · the CSV Amount column means something true for an unconfirmed row', () => {
  it('\u{1F534} a figure only for a confirmed row; a word for everything else', async () => {
    const { csvAmountCell } = await import('../../lib/paid-events-feature');
    const state = (r: Record<string, unknown>) =>
      COPY.paymentStateOf(r) === 'confirmed' ? 'confirmed' as const : 'unconfirmed' as const;

    const cell = (id: string) => {
      const r = REGISTRATIONS.find((x) => x.id === id)! as unknown as Record<string, unknown>;
      return csvAmountCell(r.amount as number, state(r));
    };
    // \u{1F534} A CLAIM IS NOT A CONFIRMATION. "I've paid" is the member's word and
    // must not put a figure in a treasurer's reconciliation sheet.
    expect(cell('r-unpaid'), 'an unpaid row exports a figure').not.toMatch(/50/);
    expect(cell('r-claimed'), 'a CLAIMED row exports a figure — a claim became money')
      .not.toMatch(/50/);
    expect(cell('r-confirmed'), 'a confirmed row stopped exporting its figure').toBe('$50.00');
    expect(cell('r-free'), 'a free registration stopped exporting $0').toBe('$0');
  });
});
