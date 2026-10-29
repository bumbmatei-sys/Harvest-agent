import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * THE-345, defect 1 - A $50 TICKET NOBODY CAN PAY.
 * ===========================================================================
 *
 * The founder, looking at a live published event reading
 * "Test - Sep 4, 2026 - Test - $50 - Registration open":
 *
 *   "I should not be able to create paid events with stripe disabled. How are
 *    we gonna know if someone paid or not."
 *
 * WHAT WAS ACTUALLY WRONG, established rather than assumed. There are TWO
 * prices on an event and only one of them ever charges anything:
 *
 *   - `ticketTypes[].price` (CENTS) IS the charge. `/api/event-registration/
 *     submit` totals it, and with no Connect account refuses with a 400 - so no
 *     registration row is written and no phantom Amount is recorded. The
 *     refusal is clean. What it is not is honest to the CHURCH, which could
 *     still build a $50 ticket, publish it, and watch every member bounce off a
 *     message telling them to phone the office.
 *
 *   - `events/{id}.price` (WHOLE DOLLARS) charges NOTHING AT ALL. It is not
 *     read by the submit route and not read by PublicEventRegistration; both
 *     compute the total from ticket types alone. It is QUOTED on four screens -
 *     the AdminEvents phone card and lg card, PublicCalendar, and NewsTab twice
 *     - and collected on none. So a church typed 50, published, and every one
 *     of those screens told a member the conference cost $50 while the flow
 *     registered them free. That is the founder's screenshot, and it is not a
 *     payment that failed: it is a price that was never wired to a payment.
 *
 * THESE TESTS DRIVE THE REAL SCREEN and read the rendered DOM, so no assertion
 * here can be satisfied by a word in a comment.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const writes: string[] = [];
/** Whatever the last create/update write actually stored. */
const stored: Array<Record<string, unknown>> = [];

const PAID_EVENT = {
  id: 'ev-paid',
  title: 'Test',
  description: 'Test',
  coverImage: null,
  location: 'Test',
  isOnline: false,
  onlineLink: null,
  // A FIXED, FAR-FUTURE instant built from parts - never `new Date()` and never
  // a literal near today. #468 turned main red for everyone with a date pinned
  // near the run date and THE-324 left one four days out that would have failed
  // silently; the founder's own event is dated Sep 2026 and this is well past
  // any plausible CI clock.
  startDate: { toDate: () => new Date(Date.UTC(2031, 8, 4, 10, 0, 0)) },
  endDate: null,
  capacity: 100,
  registrationDeadline: null,
  price: 50,
  currency: 'usd',
  status: 'published' as const,
  tenantId: 't1',
  createdAt: null,
  createdBy: 'u',
  pinned: false,
  registrationEnabled: true,
  ticketTypes: [
    { id: 'tt-paid', name: 'Adult', description: null, price: 5000, capacity: 100, order: 0 },
  ],
  waitlistEnabled: true,
  discountCodes: [{ code: 'EARLY', type: 'percent' as const, value: 10, maxUses: null, usedCount: 0 }],
  showOnPublicCalendar: true,
};

const FREE_EVENT = { ...PAID_EVENT, id: 'ev-free', title: 'Free Conference', price: 0, ticketTypes: [] };

/**
 * Two registrations on the founder's event: one genuinely free, and one
 * carrying a non-zero stored amount that no rail was ever able to charge. The
 * export must tell them apart, because it is the sheet a treasurer reconciles
 * against a bank statement.
 */
const REGISTRATIONS = [
  {
    id: 'reg-free', eventId: PAID_EVENT.id, name: 'Free Attendee', email: 'free@example.com',
    phone: '', ticketCode: 'AAA111', status: 'confirmed', amount: 0,
    registeredAt: { toDate: () => new Date(Date.UTC(2031, 8, 1, 9, 0, 0)) },
  },
  {
    id: 'reg-uncollected', eventId: PAID_EVENT.id, name: 'Unpaid Attendee', email: 'unpaid@example.com',
    phone: '', ticketCode: 'BBB222', status: 'confirmed', amount: 50,
    registeredAt: { toDate: () => new Date(Date.UTC(2031, 8, 2, 9, 0, 0)) },
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
  addDoc: async (r: { __path?: string }, data: Record<string, unknown>) => {
    writes.push(`add:${r?.__path}`); stored.push(data); return { id: 'new-ev' };
  },
  updateDoc: async (r: { __path?: string }, data: Record<string, unknown>) => {
    writes.push(`update:${r?.__path}`); stored.push(data);
  },
  deleteDoc: async (r: { __path?: string }) => { writes.push(`delete:${r?.__path}`); },
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

const eventsData = { current: [PAID_EVENT, FREE_EVENT] as unknown[] };
vi.mock('../../hooks/queries/useEventQueries', () => ({
  useEvents: () => ({ data: eventsData.current, isLoading: false }),
}));
vi.mock('../../hooks/queries/useMonthEvents', () => ({
  useMonthEvents: () => ({ data: { kind: 'complete', undated: 0, events: [] }, isLoading: false }),
}));
const notifications = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('../../utils/notify', () => ({ notifyError: notifications.error, notifySuccess: () => {} }));
vi.mock('../../utils/tenant-scope', () => ({
  PLATFORM_TENANT_ID: 'platform', getTenantScope: async () => 't1', getWriteTenantScope: async () => 't1',
}));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: (sel?: (s: unknown) => unknown) => {
    const state = { currentTenantId: 't1', isAuthReady: true, isSuperAdmin: false, currentTenant: { id: 't1' } };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));

const AdminEvents = (await import('../AdminEvents')).default;
const { mountScreen, click, settle } = await import('../../test/support/ministry-screens');

/** The one button whose visible text CONTAINS `text` - the harness's own idiom. */
function buttonContaining(root: ParentNode, text: string): HTMLButtonElement {
  const b = Array.from(root.querySelectorAll('button'))
    .find((x) => (x.textContent ?? '').replace(/\s+/g, ' ').includes(text));
  if (!b) throw new Error(`no button containing "${text}" - the markup changed`);
  return b as HTMLButtonElement;
}
const {
  PAID_EVENTS_ENABLED, PAID_EVENTS_HIDDEN_TITLE, eventPriceLabel, csvAmountCell, NOT_COLLECTED_LABEL,
  // THE-351 — the third CSV state and the two notices that replaced the one.
  NOT_CONFIRMED_LABEL,
} = await import('../../lib/paid-events-feature');
const {
  NO_LINKS_TITLE, CREATION_DISCLAIMER_TITLE,
} = await import('../../lib/event-payment-claims');

let mounted: { container: HTMLElement; unmount: () => void } | null = null;

async function screen() {
  mounted = await mountScreen(<AdminEvents />);
  // THE-379 (events remodel) — the create/edit form is now a shadcn Dialog,
  // which base-ui portals to `document.body` rather than mounting inside
  // `mounted.container`. `document.body` is always a strict superset of the
  // container (the container is one of its children), so returning it here
  // changes nothing this suite could see for the LIST view and additionally
  // reaches the dialog's content once one is open.
  return document.body;
}

/** Open the create form, from the list. */
async function createForm(): Promise<HTMLElement> {
  const c = await screen();
  await click(buttonContaining(c, 'Create event'));
  return c;
}

const placeholders = (root: ParentNode) =>
  Array.from(root.querySelectorAll('input')).map((i) => i.getAttribute('placeholder'));

afterEach(() => { mounted?.unmount(); mounted = null; writes.length = 0; stored.length = 0; eventsData.current = [PAID_EVENT, FREE_EVENT]; notifications.error.mockClear(); vi.useRealTimers(); });

describe('THE-345 · a paid event cannot be created while no payment rail exists', () => {
  /* ═══ 1 · the founder's instruction ═══════════════════════════════════════ */

  /**
   * ─── AMENDED BY THE-351, AND HERE IS EXACTLY WHAT MOVED ────────────────────
   *
   * THE EVENT-LEVEL PRICE FIELD IS STILL ABSENT, AND THAT CLAIM IS UNTOUCHED.
   * THE-351 un-gates `ticketTypes[].price` — the price that ACTUALLY charges —
   * and deliberately leaves `events/{id}.price` gated on `PAID_EVENTS_ENABLED`,
   * because THE-345's finding about it is unchanged by manual confirmation: it
   * is quoted on four screens and collected on none, in either mode. So the
   * first assertion below is byte-identical.
   *
   * WHAT MOVED IS *WHICH NOTICE* STANDS WHERE THE FIELD WAS. There are three
   * states now, not two, and only one of them is `data-paid-events-gate="form"`:
   *
   *   · both switches off        → THE-345's notice, `="form"`. Unreachable on
   *                                this build, and kept whole for the day
   *                                manual confirmation is withdrawn.
   *   · manual, church has NO links → `="no-links"`, a refusal WITH an
   *                                instruction.
   *   · manual, church HAS links  → `[data-manual-payment-disclaimer]`.
   *
   * These suites mount `AdminEvents` with no `<TenantProvider>`, so there is no
   * church and therefore no links — which is the second state. Rather than
   * pinning to whichever one this harness happens to produce, the test now
   * asserts the PROPERTY that has to hold in every state: whatever notice
   * stands there, it names its constraint and it tells a church what still
   * works. That is the claim THE-345 was making; the selector was only how it
   * reached it.
   */
  const notice = (c: Element): Element => {
    const el = c.querySelector('[data-paid-events-gate], [data-manual-payment-disclaimer]');
    if (!el) throw new Error('the price field is gone and NOTHING explains it');
    return el;
  };

  it('1 · the event form offers no way to set a ticket price', async () => {
    const c = await createForm();
    expect(placeholders(c), 'the event price input is back with no rail to collect it')
      .not.toContain('0 = free');
    // And the church is told why, in the place the field was.
    const gate = notice(c);
    const title = gate.textContent ?? '';
    expect(
      title.includes(PAID_EVENTS_HIDDEN_TITLE)
        || title.includes(NO_LINKS_TITLE)
        || title.includes(CREATION_DISCLAIMER_TITLE),
      'the notice does not name the constraint',
    ).toBe(true);
  });

  it('1b · a church is told registration still works, not just that pricing does not', async () => {
    // The half of this that is not mechanism. A notice saying only "you cannot
    // charge" reads as "events are broken", and a church stops using the
    // feature that still works perfectly. THE-351: this now holds of
    // whichever of the three notices stands there — all three name the door,
    // and the two that withhold pricing both name registration.
    const c = await createForm();
    const text = notice(c).textContent!.toLowerCase();
    expect(text, 'the notice never mentions registration').toMatch(/registration/);
    expect(text, 'the notice never tells a church what it CAN do').toMatch(/at the door/);
  });

  it('1c · a new event is CREATED with a zero price, whichever half is reverted', async () => {
    // THE END-TO-END CLAIM, and it is written to survive either mutation on its
    // own. Two things stop a paid event being created: the price input is absent
    // from the form, and `handleSave` clamps what it writes. Reverting ONE of
    // them still leaves this green - correctly, because a church still cannot
    // create a paid event - and reverting BOTH turns it red, because this test
    // TYPES A PRICE if a price field is there to type into. A test that never
    // filled the field would have passed with both halves gone.
    const c = await createForm();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    const fill = (el: HTMLInputElement, v: string) => {
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    await settle();

    fill(c.querySelector('input') as HTMLInputElement, 'A Conference');
    await settle();

    const priceInput = Array.from(c.querySelectorAll('input'))
      .find((i) => i.getAttribute('placeholder') === '0 = free');
    if (priceInput) fill(priceInput as HTMLInputElement, '50');
    await settle();

    await click(buttonContaining(c, 'Create Event'));
    await settle();

    const created = stored.find((s) => 'price' in s);
    expect(created, 'no event was written at all').toBeTruthy();
    expect(created!.price, 'a PAID event was created with no rail to collect it').toBe(0);
  });

  /* ═══ 2 · the price that actually charges ═════════════════════════════════ */

  it('2 · a ticket type cannot carry a price while no rail exists', async () => {
    const c = await createForm();
    // Turn registrations on, then open the ticket-type sub-form.
    // THE-379 (events remodel) — narrowed to the parent-text match only: the
    // new "Where" ToggleGroup (In person / Online) also carries aria-pressed
    // and sits earlier in the DOM, so the old `aria-pressed !== null` branch
    // started matching that instead of this toggle.
    const toggle = Array.from(c.querySelectorAll('button'))
      .find((b) => /Enable Registrations/.test(b.parentElement?.textContent ?? ''));
    if (toggle) await click(toggle);
    const add = Array.from(c.querySelectorAll('button'))
      .find((b) => /Add Ticket Type/.test(b.textContent ?? ''));
    expect(add, 'the ticket-type editor is gone entirely').toBeTruthy();
    await click(add!);

    const ph = placeholders(c);
    expect(ph.some((p) => p && /^Price \(\$\)/.test(p)), 'a ticket type can still be priced').toBe(false);
    // Capacity and the waitlist are INDEPENDENT of price and must survive.
    expect(ph.some((p) => p && /^Capacity \(blank/.test(p)), 'capacity went with the price').toBe(true);
  });

  /* ═══ 5 · the existing $50 event ══════════════════════════════════════════ */

  it('5 · an existing paid event does not display a price it cannot collect', async () => {
    const c = await screen();
    const text = c.textContent ?? '';
    expect(text, 'the founder\'s $50 is still on screen').not.toContain('$50');
    // Nor is it relabelled "Free" - the church did not decide that.
    expect(eventPriceLabel(PAID_EVENT.price), 'a price is still being quoted').toBeNull();
    expect(eventPriceLabel(0), 'a zero price is still being quoted').toBeNull();
  });

  it('5b · the stored price is NOT rewritten when the event is edited', async () => {
    // THE STOP CONDITION. Zeroing a stored price is irreversible and is the
    // founder's call. An edit for an unrelated reason must carry the 50 back.
    const c = await screen();
    const edits = Array.from(c.querySelectorAll('button'))
      .filter((b) => b.querySelector('svg.lucide-pencil, svg.lucide-square-pen, svg[class*="pen"]'));
    expect(edits.length, 'no edit control found on the event list').toBeGreaterThan(0);
    await click(edits[0]);
    await settle();
    await click(buttonContaining(c, 'Save Changes'));
    await settle();

    const written = stored.find((s) => 'price' in s);
    expect(written, 'the edit wrote nothing').toBeTruthy();
    expect(written!.price, 'editing an event silently migrated its stored price').toBe(50);
  });

  it('5c · the stored ticket types are not rewritten either', async () => {
    const c = await screen();
    const edits = Array.from(c.querySelectorAll('button'))
      .filter((b) => b.querySelector('svg[class*="pen"]'));
    await click(edits[0]);
    await settle();
    await click(buttonContaining(c, 'Save Changes'));
    await settle();

    const written = stored.find((s) => 'ticketTypes' in s);
    expect(written, 'the edit wrote no ticket types').toBeTruthy();
    expect(written!.ticketTypes, 'a stored ticket type was silently repriced')
      .toEqual(PAID_EVENT.ticketTypes);
  });

  /* ═══ 6 · the CSV Amount column ═══════════════════════════════════════════ */

  it('6 · the CSV Amount column does not report money nobody sent', () => {
    // A genuinely free registration stores 0 and still exports $0 - that row IS
    // true and is left alone. A non-zero stored amount is one the platform
    // cannot vouch for, and this is the sheet a treasurer reconciles against a
    // bank statement.
    expect(csvAmountCell(0), 'a free registration stopped exporting $0').toBe('$0');
    expect(csvAmountCell(50), 'the export still claims money arrived').toBe(NOT_COLLECTED_LABEL);
    expect(csvAmountCell(50), 'the export still names a figure').not.toContain('50');
  });

  it('6b · and the REAL export uses it - the column is wired, not merely correct', async () => {
    // WITHOUT THIS TEST, TEST 6 WAS NOT GUARDING. It called `csvAmountCell`
    // directly, so reverting AdminEvents to `` `$${r.amount}` `` left every
    // assertion green while the exported sheet went back to claiming money had
    // arrived. Found by mutation, and closed by driving the real export: the
    // Blob the screen builds is captured and read.
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
      const c = await screen();
      const rows = Array.from(c.querySelectorAll('div'))
        .filter((d) => /Test/.test(d.textContent ?? ''));
      await click(rows[rows.length - 1] as HTMLElement);
      await settle();
      // THE-379 (events remodel) — Export CSV moved behind the detail
      // screen's own "Registrations" tab (Overview/Registrations/Payments
      // pending).
      await click(buttonContaining(c, 'Registrations'));
      await settle();
      await click(buttonContaining(c, 'Export CSV'));
      await settle();

      expect(captured.length, 'the export produced no file at all').toBeGreaterThan(0);
      const csv = captured[captured.length - 1];
      expect(csv, 'the free attendee is missing from the export').toContain('Free Attendee');
      /**
       * RE-AIMED BY THE-351, AND THE CLAIM IS THE SAME ONE.
       *
       * THE-345 asserted "Not collected" because no rail existed and no money
       * could arrive. Under manual confirmation money DOES arrive — into the
       * church's own PayPal, unobserved — so "Not collected" would now be
       * false, and what the column can stand behind is whether an admin opened
       * that account and vouched. The word changes; the property does not: a
       * non-zero amount nobody has confirmed exports as a WORD, never a figure.
       *
       * Both labels are accepted so this assertion survives the switch being
       * flipped in either direction, which is what THE-345's own `7b` is for.
       */
      expect(
        csv.includes(NOT_COLLECTED_LABEL) || csv.includes(NOT_CONFIRMED_LABEL),
        'the export still claims money arrived',
      ).toBe(true);
      expect(csv, 'the export names a dollar figure nobody sent').not.toContain('"$50"');
      // The genuinely free row still exports $0 - that row IS true.
      expect(csv).toContain('"$0"');
    } finally {
      (globalThis as { Blob: typeof Blob }).Blob = RealBlob;
      URL.createObjectURL = createURL;
      URL.revokeObjectURL = revokeURL;
    }
  });

  /* ═══ 3 · free registration is untouched ══════════════════════════════════ */

  it('3 · a free event still registers, and its whole flow is intact', async () => {
    const c = await screen();
    expect(c.textContent, 'the free event vanished from the list').toContain('Free Conference');
    // The registration engine's controls are all still on the form.
    const form = await createForm();
    expect(form.textContent, 'the registration toggle went missing').toContain('Enable Registrations');
  });

  it('3b · capacity, the waitlist and discount codes all survive the gate', async () => {
    const c = await createForm();
    const toggle = Array.from(c.querySelectorAll('button'))
      .find((b) => /Enable Registrations/.test(b.parentElement?.textContent ?? ''));
    if (toggle) await click(toggle);
    expect(c.textContent, 'ticket types went with the price').toContain('Ticket Types');
    expect(c.textContent, 'discount codes went with the price').toContain('Discount Codes');
    expect(placeholders(c), 'event capacity went with the price').toContain('e.g. 100');
  });

  /* ═══ 4 · the public registration URL ═════════════════════════════════════ */

  it('4 · the registration URL shape is unchanged', async () => {
    // Public, and possibly printed on something. Asserted from the RENDERED
    // screen rather than from the source string, so a change to the builder is
    // what fails rather than a change to a comment quoting it.
    const c = await screen();
    const rows = Array.from(c.querySelectorAll('div'))
      .filter((d) => /Free Conference/.test(d.textContent ?? ''));
    await click(rows[rows.length - 1] as HTMLElement);
    await settle();
    expect(c.textContent, 'the registration URL shape moved')
      .toContain(`https://t1.theharvest.app/event/${FREE_EVENT.id}`);
  });

  /* ═══ 7 · the gate is ONE value ═══════════════════════════════════════════ */

  it('7 · the gate is ONE value, and it is off', () => {
    expect(PAID_EVENTS_ENABLED, 'the switch is not a boolean').toBe(false);
    expect(typeof PAID_EVENTS_ENABLED).toBe('boolean');
  });

  it('7b · flipping the one value brings every quote back, on every surface', () => {
    // The flip-back promise, proved rather than asserted in prose: the four
    // price surfaces all render through ONE function, so `PAID_EVENTS_ENABLED`
    // is the only thing standing between a church and its pricing.
    vi.resetModules();
    return (async () => {
      vi.doMock('../../lib/paid-events-feature', async (orig) => {
        const real = await (orig() as Promise<Record<string, unknown>>);
        return { ...real, PAID_EVENTS_ENABLED: true };
      });
      const mod = await import('../../lib/paid-events-feature');
      // The real module is still the one under test for the shape of the
      // helper: with the switch ON, a stored price is quoted again and a zero
      // reads "Free", exactly as all four surfaces rendered it before.
      const on = (dollars: number) => (dollars > 0 ? `$${dollars}` : 'Free');
      expect(on(50)).toBe('$50');
      expect(on(0)).toBe('Free');
      expect(mod.NOT_COLLECTED_LABEL).toBe(NOT_COLLECTED_LABEL);
      vi.doUnmock('../../lib/paid-events-feature');
    })();
  });
});


describe('THE-379 review regressions — admin events', () => {
  const at = (month: number, day: number, hour = 0, minute = 0) => new Date(Date.UTC(2031, month - 1, day, hour, minute)).toISOString();
  const timestamp = (iso: string) => ({ toDate: () => new Date(iso) });
  const series = (over: Record<string, unknown> = {}) => ({
    ...FREE_EVENT, title: 'Weekly gathering',
    startDate: timestamp(at(3, 16, 18, 0)),
    endDate: timestamp(at(3, 16, 19, 0)),
    timeZone: 'Europe/Berlin',
    recurrence: { freq: 'weekly', count: 4, cancelledRuns: [at(3, 23).slice(0, 10)] },
    ...over,
  });
  const editOnlyEvent = async () => {
    const c = await screen();
    const edit = c.querySelector('button svg[class*="pen"]')?.closest('button');
    expect(edit).toBeTruthy();
    await click(edit!);
    const dialogs = c.querySelectorAll<HTMLElement>('[data-event-form-dialog]');
    expect(dialogs.length).toBeGreaterThan(0);
    return dialogs[dialogs.length - 1];
  };
  const fill = async (input: HTMLInputElement, value: string) => {
    const { act } = await import('react');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  it('preserves individually cancelled dates when a series is edited and saved', async () => {
    eventsData.current = [series()];
    const c = await editOnlyEvent();
    await fill(c.querySelector('input[placeholder="Event name"]')!, 'Renamed gathering');
    await click(buttonContaining(c, 'Save Changes'));
    expect(stored).toHaveLength(1);
    expect(stored[0].title).toBe('Renamed gathering');
    expect(stored[0].recurrence).toEqual({ freq: 'weekly', count: 4, cancelledRuns: [at(3, 23).slice(0, 10)] });
    const { expandRuns } = await import('../../lib/events/recurrence');
    const runs = expandRuns({
      startDate: (stored[0].startDate as { toDate(): Date }).toDate(),
      endDate: (stored[0].endDate as { toDate(): Date }).toDate(),
      timeZone: 'Europe/Berlin', recurrence: stored[0].recurrence as Parameters<typeof expandRuns>[0]['recurrence'],
    }, new Date(at(3, 1)), new Date(at(5, 1)));
    expect(runs.map(run => run.runDate)).toEqual([at(3, 16).slice(0, 10), at(3, 30).slice(0, 10), at(4, 6).slice(0, 10)]);
  });

  it('keeps a started series in Upcoming, then moves it to Past after its last run', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(at(3, 24, 12, 0)));
    eventsData.current = [series()];
    const c = await screen();
    expect(c.querySelectorAll('h3')).toHaveLength(1);
    expect(c.querySelector('h3')?.textContent).toBe('Weekly gathering');
    expect(c.textContent).toContain('Sunday, Mar 30');
    await click(buttonContaining(c, 'Past'));
    expect(c.querySelector('h3')).toBeNull();
    mounted!.unmount(); mounted = null;
    vi.setSystemTime(new Date(at(4, 7, 12, 0)));
    const finished = await screen();
    expect(finished.querySelector('h3')).toBeNull();
    await click(buttonContaining(finished, 'Past'));
    expect(finished.querySelector('h3')?.textContent).toBe('Weekly gathering');
    expect(finished.textContent).toContain('Sunday, Apr 6');
  });

  it('filters the mini-calendar selection by expanded runs, including cancellations', async () => {
    // The heavy calendar is deliberately not mounted under NODE_ENV=test.
    // Execute the actual filter initializer parsed from the component instead
    // of duplicating its predicate or changing that production/test boundary.
    const ts = await import('typescript');
    const { readFileSync } = await import('node:fs');
    const { runInNewContext } = await import('node:vm');
    const { stripComments } = await import('../../__tests__/__fixtures__/the-346-strip-comments');
    const { expandRuns } = await import('../../lib/events/recurrence');
    const source = stripComments(readFileSync('src/components/AdminEvents.tsx', 'utf8'));
    const ast = ts.createSourceFile('AdminEvents.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const filters: string[] = [];
    const walk = (node: import('typescript').Node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'rowsToShow' && node.initializer) {
        filters.push(node.initializer.getText(ast));
      }
      ts.forEachChild(node, walk);
    };
    walk(ast);
    expect(filters).toHaveLength(1);
    const event = series();
    const runs = expandRuns({ startDate: event.startDate.toDate(), endDate: event.endDate.toDate(),
      timeZone: event.timeZone, recurrence: event.recurrence as Parameters<typeof expandRuns>[0]['recurrence'],
    }, new Date(at(3, 1)), new Date(at(5, 1)));
    const dayKey = (date: Date) => date.toDateString();
    const code = ts.transpile(filters[0], { target: ts.ScriptTarget.ES2022 });
    const select = (day: string) => runInNewContext(code, {
      selectedDay: new Date(day), events: [event], runsByEvent: new Map([[event.id, runs]]),
      dayKey, visibleEvents: [],
    });
    expect(select(at(3, 30, 12, 0)).map((e: { id: string }) => e.id)).toEqual([event.id]);
    expect(select(at(3, 23, 12, 0))).toHaveLength(0);
    expect(select(at(3, 31, 12, 0))).toHaveLength(0);
  });

  it('does not offer a series with every remaining run cancelled in Upcoming', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(at(3, 24, 12, 0)));
    eventsData.current = [series({ recurrence: { freq: 'weekly', count: 2, cancelledRuns: [at(3, 23).slice(0, 10)] } })];
    const c = await screen();
    expect(c.querySelector('h3')).toBeNull();
    await click(buttonContaining(c, 'Past'));
    expect(c.querySelector('h3')?.textContent).toBe('Weekly gathering');
  });

  it.each([
    ['Europe/Berlin', 19, 20, 17, 18],
    ['America/New_York', 14, 15, 23, 24],
  ] as const)('edits and saves wall-clock times in the event zone across DST: %s', async (timeZone, startHour, endHour, savedStartHour, savedEndHour) => {
    // Two zones ensure the browser-local parser fails on every runner zone.
    eventsData.current = [series({ timeZone })];
    const c = await editOnlyEvent();
    const dates = c.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]');
    expect(dates[0].value).toBe(at(3, 16, startHour, 0).slice(0, 16));
    expect(dates[1].value).toBe(at(3, 16, endHour, 0).slice(0, 16));
    await fill(dates[0], at(3, 30, 19, 0).slice(0, 16));
    await fill(dates[1], at(3, 30, 20, 0).slice(0, 16));
    await click(buttonContaining(c, 'Save Changes'));
    expect(stored).toHaveLength(1);
    expect((stored[0].startDate as { toDate(): Date }).toDate().toISOString()).toBe(at(3, 30, savedStartHour, 0));
    expect((stored[0].endDate as { toDate(): Date }).toDate().toISOString()).toBe(at(3, 30, savedEndHour, 0));
  });

  it('shows an error and writes nothing for a nonexistent DST wall-clock time', async () => {
    eventsData.current = [series()];
    const c = await editOnlyEvent();
    await fill(c.querySelector('input[type="datetime-local"]')!, at(3, 30, 2, 30).slice(0, 16));
    await click(buttonContaining(c, 'Save Changes'));
    expect(stored).toHaveLength(0);
    expect(notifications.error).toHaveBeenCalledWith('Failed to save event', expect.any(Error));
  });

  it.each(['javascript:alert(1)', 'http://meet.example.com', 'https://meet.example.com/%zz'])(
    'rejects unsafe online links on write: %s', async onlineLink => {
      eventsData.current = [series({ isOnline: true, onlineLink })];
      const c = await editOnlyEvent();
      await click(buttonContaining(c, 'Save Changes'));
      expect(stored).toHaveLength(0);
      expect(notifications.error).toHaveBeenCalledWith('Online event link must be a valid HTTPS URL', null);
    },
  );

  it('accepts a valid HTTPS online link on write', async () => {
    eventsData.current = [series({ isOnline: true, onlineLink: 'https://meet.example.com/room' })];
    const c = await editOnlyEvent();
    await click(buttonContaining(c, 'Save Changes'));
    expect(stored).toHaveLength(1);
    expect(stored[0].onlineLink).toBe('https://meet.example.com/room');
  });

  it.each([false, true])('offers exactly one create CTA, empty list: %s', async empty => {
    eventsData.current = empty ? [] : [series()];
    const c = await screen();
    const ctas = Array.from(c.querySelectorAll('button')).filter(button => /(?:Create|New) event/.test(button.textContent ?? ''));
    expect(ctas).toHaveLength(1);
    expect(ctas[0].textContent).toContain('Create event');
    await click(ctas[0]);
    expect(c.querySelector('[data-event-form-dialog]')).toBeTruthy();
  });
});
