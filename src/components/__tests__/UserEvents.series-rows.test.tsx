import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

/**
 * #556 review r12 — the member's Upcoming list for recurring series.
 * A series is listed once per run the member holds a ticket for (never also as
 * a bare series row), a series without tickets is listed at its next run
 * rather than its past first run, and a cancelled run's ticket leaves Upcoming
 * instead of lingering as "Date TBA". Fixture instants are far-future.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.UTC(2031, 8, 10, 12);
const FIRST_RUN = Date.UTC(2031, 7, 4, 18); // a past first run, Monday 2031-08-04
const tickets = { current: [] as Array<Record<string, unknown>> };
const events = { current: [] as Array<{ id: string; data: Record<string, unknown> }> };
const millis = (ms: number) => ({ toMillis: () => ms });

vi.mock('../inbox/payment-claims-client', () => ({ claimPaymentSent: async () => {} }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u', email: 'dana@example.com' } } }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}), query: (q: unknown) => q, orderBy: () => ({}), limit: () => ({}),
  getDocs: async () => ({ docs: events.current.map((e) => ({ id: e.id, data: () => e.data })) }),
}));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,AA' } }));
vi.mock('../../utils/tenant-scope', () => ({ getTenantScope: async () => 't1' }));
vi.mock('../../utils/share-url', () => ({ useShareBaseUrl: () => 'https://t1.theharvest.app' }));
vi.mock('../ShareButton', () => ({ default: () => <span /> }));
vi.mock('../../contexts/TenantContext', () => ({ useTenantOptional: () => ({ branding: { churchName: 'Grace' } }) }));
vi.mock('../../utils/auth-fetch', () => ({
  authFetch: async () => ({ ok: true, json: async () => ({ tickets: tickets.current }) }),
}));
const UserEvents = (await import('../UserEvents')).default;

let container: HTMLDivElement;
let root: Root;
afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  container?.remove();
  vi.useRealTimers();
});

const series = { id: 's1', data: {
  title: 'Weekly gathering', status: 'published', registrationEnabled: true,
  startDate: millis(FIRST_RUN), endDate: millis(FIRST_RUN + 3600000), timeZone: 'UTC', recurrence: { freq: 'weekly' },
} };
const runTicket = (runDate: string, startMillis: number, status = 'published') => ({
  id: `reg-${runDate}`, eventId: 's1', runDate, ticketCode: `T-${runDate}`, status: 'confirmed', waitlisted: false,
  amount: 0, payment: 'free', payOptions: [],
  event: { title: 'Weekly gathering', startMillis, endMillis: startMillis + 3600000, isOnline: false, status },
});

async function mount() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<UserEvents onBack={() => {}} />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
/** Rendered list rows for the series, by their title text. */
const seriesRows = () => [...container.querySelectorAll('*')]
  .filter((el) => el.children.length === 0 && el.textContent === 'Weekly gathering');

describe('member Upcoming list for a recurring series', () => {
  it('lists a ticketed series once per held run, with no duplicate bare series row', async () => {
    // First run still ahead, ticket for the run after it: the bare series row
    // used to sit beside the ticketed one.
    const upcomingFirst = Date.UTC(2031, 8, 15, 18);
    events.current = [{ ...series, data: { ...series.data, startDate: millis(upcomingFirst), endDate: millis(upcomingFirst + 3600000) } }];
    tickets.current = [runTicket('2031-09-22', Date.UTC(2031, 8, 22, 18))];
    await mount();
    expect(seriesRows()).toHaveLength(1);
    expect(container.textContent).toContain('View ticket');
  });

  it('lists an unticketed series at its next run, not its past first run', async () => {
    events.current = [series];
    tickets.current = [];
    await mount();
    expect(seriesRows()).toHaveLength(1);
    expect(container.textContent).toMatch(/Sep(tember)? 15/);
    expect(container.textContent).not.toMatch(/Aug(ust)? 4/);
  });

  it('drops a cancelled run ticket from Upcoming instead of showing it undated', async () => {
    events.current = [];
    tickets.current = [runTicket('2031-09-15', Date.UTC(2031, 8, 15, 18), 'cancelled')];
    await mount();
    expect(seriesRows()).toHaveLength(0);
    expect(container.textContent).not.toContain('Date TBA');
  });
});
