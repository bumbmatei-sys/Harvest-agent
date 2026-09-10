import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * THE-351 · 🔴 THE RENDERED SURFACES — the disclaimer, the provider picker, the
 * member's ticket, the tenant inbox, the door flag and the CSV.
 *
 * Every assertion here reads the DOM the REAL components produce, so none of
 * them can be satisfied by a word in a comment. THE-345's harness is reused
 * wholesale for `AdminEvents` — same mocks, same idioms — because a second
 * harness for one screen is a second thing to keep true.
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
async function createForm(): Promise<HTMLElement> {
  const c = await screen();
  await click(buttonContaining(c, 'Create event'));
  return c;
}
async function detail(): Promise<HTMLElement> {
  const c = await screen();
  const rows = Array.from(c.querySelectorAll('div'))
    .filter((d) => /Autumn Retreat/.test(d.textContent ?? ''));
  await click(rows[rows.length - 1] as HTMLElement);
  await settle();
  return c;
}

beforeEach(() => {
  stored.length = 0;
  branding.current = { churchName: 'Grace Chapel', givingLinks: GIVING_LINKS };
});

/* ═══ 1 / 3 · the creation form ═══════════════════════════════════════════ */

describe('1+3 · the event form: disclaimer, provider picker, ticket price', () => {
  it('🔴 renders the disclaimer, unsoftened, above the picker', async () => {
    const c = await createForm();
    const alert = c.querySelector('[data-manual-payment-disclaimer]');
    expect(alert, 'the creation disclaimer is not on the form').not.toBeNull();
    const text = alert!.textContent ?? '';
    expect(text).toContain(COPY.CREATION_DISCLAIMER_TITLE);
    expect(text).toContain(COPY.CREATION_DISCLAIMER_BODY);
    // 🔴 It is an ALERT, so a screen reader is told rather than only an eye.
    expect(alert!.getAttribute('role') ?? alert!.querySelector('[role]')?.getAttribute('role'))
      .toBe('alert');
  });

  it('🔴 offers exactly the church’s own links as checkboxes, in table order', async () => {
    const c = await createForm();
    const picker = c.querySelector('[data-event-provider-picker]');
    expect(picker, 'the provider picker is missing').not.toBeNull();
    const offered = Array.from(picker!.querySelectorAll('[data-provider-option]'))
      .map((el) => el.getAttribute('data-provider-option'));
    // The church publishes PayPal, Zelle and Revolut; the picker offers exactly
    // those, in the PROVIDER TABLE's order — never the stored object's.
    expect(offered).toEqual(['paypal', 'zelle', 'revolut']);
    // And a provider the church does NOT publish is not offered.
    expect(offered).not.toContain('wise');
    // Every option is a real checkbox with a ≥44px hit area below `sm`.
    for (const opt of picker!.querySelectorAll('[data-provider-option]')) {
      expect(opt.className, 'a provider row is under the 44px tap floor')
        .toMatch(/min-h-11/);
    }
  });

  it('🔴 writes the ticked ids onto the event, and only known ones', async () => {
    const c = await createForm();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    const fill = (el: HTMLInputElement, v: string) => {
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    fill(c.querySelector('input') as HTMLInputElement, 'Autumn Retreat');
    await settle();

    // `Checkbox` is base-ui's, which renders a `role="checkbox"` button.
    const paypalBox = c.querySelector('[data-provider-option="paypal"] [data-slot="checkbox"]');
    expect(paypalBox, 'the PayPal option has no checkbox').not.toBeNull();
    await click(paypalBox as HTMLElement);
    await settle();

    await click(buttonContaining(c, 'Create Event'));
    await settle();

    const created = stored.find((s) => 'paymentProviders' in s);
    expect(created, 'no event was written').toBeTruthy();
    expect(created!.paymentProviders).toEqual(['paypal']);
  });

  it('2 · a church with NO links sees the refusal and NO price field', async () => {
    branding.current = { churchName: 'Grace Chapel' };
    const c = await createForm();
    const gate = c.querySelector('[data-paid-events-gate="no-links"]');
    expect(gate, 'a church with no links is not told why it cannot price').not.toBeNull();
    expect(gate!.textContent).toContain(COPY.NO_LINKS_TITLE);
    expect(c.querySelector('[data-manual-payment-disclaimer]'),
      'the disclaimer renders over a church that cannot price anything').toBeNull();
    expect(c.querySelector('[data-event-provider-picker]')).toBeNull();
  });

  it('🔴 the ticket-type price input IS available when links exist', async () => {
    const c = await createForm();
    const toggle = Array.from(c.querySelectorAll('button'))
      .find((b) => /Enable Registrations/.test(b.parentElement?.textContent ?? ''));
    if (toggle) await click(toggle);
    await click(buttonContaining(c, 'Add Ticket Type'));
    const ph = Array.from(c.querySelectorAll('input')).map((i) => i.getAttribute('placeholder'));
    expect(ph.some((p) => p && /^Price \(\$\)/.test(p)),
      'a church still cannot price a ticket it will collect itself').toBe(true);
    // Capacity is untouched and still spans the row beside it.
    expect(ph.some((p) => p && /^Capacity \(blank/.test(p))).toBe(true);
  });
});

/* ═══ 14 / 14b · the attendee list and the door ═══════════════════════════ */

describe('14 · check-in never blocks on payment, and the volunteer sees the flag', () => {
  it('🔴 EVERY confirmed registration has a Check In control, paid or not', async () => {
    const c = await detail();
    expect(c.querySelectorAll('[data-door-payment]').length,
      'the attendee rows did not render').toBeGreaterThan(0);

    for (const name of ['Free Attendee', 'Unpaid Attendee', 'Claimed Attendee', 'Confirmed Attendee']) {
      const row = attendeeRow(c, name);
      const checkIn = Array.from(row.querySelectorAll('button'))
        .find((b) => /Check In/.test(b.textContent ?? ''));
      expect(checkIn,
        `🔴 ${name} CANNOT BE CHECKED IN — a paying guest is turned away at the door`)
        .toBeTruthy();
      expect((checkIn as HTMLButtonElement).disabled,
        `🔴 ${name}'s Check In is DISABLED — the founder's decision was to let them in`)
        .toBe(false);
    }
  });

  it('🔴 14b · the flag is on the unpaid and claimed rows, and NOT on the free one', async () => {
    const c = await detail();
    const flagFor = (name: string) => attendeeRow(c, name).querySelector('[data-door-payment]');
    expect(flagFor('Unpaid Attendee')!.getAttribute('data-door-payment')).toBe('unconfirmed');
    expect(flagFor('Claimed Attendee')!.getAttribute('data-door-payment')).toBe('unconfirmed');
    expect(flagFor('Confirmed Attendee')!.getAttribute('data-door-payment')).toBe('confirmed');
    // 🔴 A FREE REGISTRATION SEES NONE OF THIS. A church running a free
    // conference must not have payment vocabulary appear on its door list.
    expect(flagFor('Free Attendee'), 'a FREE registration was flagged as unpaid').toBeNull();

    // The wording the volunteer reads.
    const flag = flagFor('Unpaid Attendee')!;
    expect(flag.textContent).toBe(COPY.DOOR_UNCONFIRMED_BADGE);
    expect(flag.getAttribute('title')).toBe(COPY.DOOR_UNCONFIRMED_HELP);
  });

  it('🔴 a CLAIM does not become a confirmation on the door list', async () => {
    const c = await detail();
    const row = attendeeRow(c, 'Claimed Attendee');
    // The member pressed "I've paid". That is still `unconfirmed` here — the
    // whole premise: a member's word is not the church's.
    expect(row.querySelector('[data-door-payment]')!.getAttribute('data-door-payment'))
      .toBe('unconfirmed');
  });
});

/* ═══ 15 · the CSV ════════════════════════════════════════════════════════ */

describe('15 · the CSV Amount column, driven through the REAL export', () => {
  it('🔴 a figure only for a confirmed row; a word for everything else', async () => {
    const captured: string[] = [];
    const RealBlob = globalThis.Blob;
    class CapturingBlob extends RealBlob {
      constructor(parts: BlobPart[], options?: BlobPropertyBag) {
        captured.push(parts.map(String).join(''));
        super(parts, options);
      }
    }
    (globalThis as { Blob: typeof Blob }).Blob = CapturingBlob as unknown as typeof Blob;
    const createURL = URL.createObjectURL;
    const revokeURL = URL.revokeObjectURL;
    URL.createObjectURL = () => 'blob:stub';
    URL.revokeObjectURL = () => {};
    try {
      const c = await detail();
      await click(buttonContaining(c, 'Export CSV'));
      await settle();

      const csv = captured[captured.length - 1];
      const row = (name: string) => csv.split('\n').find((l) => l.includes(name))!;

      const { NOT_CONFIRMED_LABEL } = await import('../../lib/paid-events-feature');
      // A genuinely free registration: `$0` is a fact the platform can vouch for.
      expect(row('Free Attendee')).toContain('"$0"');
      // 🔴 UNPAID and CLAIMED both export the WORD. "I've paid" is the member's
      // word, and this is the sheet a treasurer reconciles against a bank line.
      expect(row('Unpaid Attendee')).toContain(`"${NOT_CONFIRMED_LABEL}"`);
      expect(row('Claimed Attendee'), '🔴 a CLAIM exported as money')
        .toContain(`"${NOT_CONFIRMED_LABEL}"`);
      // CONFIRMED exports the figure, from CENTS.
      expect(row('Confirmed Attendee')).toContain('"$50.00"');
      expect(row('Confirmed Attendee'), 'cents were exported as dollars')
        .not.toContain('"$5000"');
    } finally {
      (globalThis as { Blob: typeof Blob }).Blob = RealBlob;
      URL.createObjectURL = createURL;
      URL.revokeObjectURL = revokeURL;
    }
  });
});
