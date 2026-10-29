import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), select: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), collection: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => ({ get: () => 'tenant.theharvest.app' }) }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not found'); } }));
vi.mock('@/lib/server-tenant', () => ({ getTenantFromHost: async () => ({ id: 't1', name: 'Ministry', config: {} }) }));
vi.mock('@/components/PublicEventRegistration', () => ({ default: () => null }));
vi.mock('@/components/PublicRouteAnalytics', () => ({ default: () => null }));
vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: mocks.collection } }));
import PublicEventPage from '../page';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue({ docs: [] });
  const ref: any = { doc: () => ref, collection: mocks.collection, where: () => ref, get: mocks.get,
    select: (...fields: string[]) => { mocks.select(...fields); return ref; },
    orderBy: (...fields: string[]) => { mocks.orderBy(...fields); return ref; },
    limit: (value: number) => { mocks.limit(value); return ref; } };
  mocks.collection.mockReturnValue(ref);
});
const page = () => PublicEventPage({ params: Promise.resolve({ eventId: 'e1' }) });
const event = (ticketTypes: object[]) => ({ exists: true, id: 'e1', data: () => ({ status: 'published', ticketTypes }) });

describe('r9.9 public capacity read', () => {
  it('skips registrations entirely when every ticket is uncapped', async () => {
    mocks.get.mockResolvedValueOnce(event([{ id: 'free', capacity: null }, { id: 'other' }]));
    const tree = await page();
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.collection).not.toHaveBeenCalledWith('registrations');
    expect(tree.props.children[1].props.event.spotsLeftByTicket).toBeNull();
  });
  it('projects only capacity fields, bounds the read and counts confirmed party quantities', async () => {
    mocks.get.mockResolvedValueOnce(event([{ id: 'adult', capacity: 10 }])).mockResolvedValueOnce({ docs: [
      { data: () => ({ status: 'confirmed', ticketTypeId: 'adult', quantity: 3 }) },
      { data: () => ({ status: 'confirmed', ticketTypeId: 'adult' }) },
      { data: () => ({ status: 'waitlisted', ticketTypeId: 'adult', quantity: 9 }) },
    ] });
    const tree = await page();
    expect(mocks.select).toHaveBeenCalledWith('status', 'ticketTypeId', 'quantity');
    expect(mocks.limit).toHaveBeenCalledWith(5001);
    expect(mocks.orderBy).toHaveBeenCalledWith('__name__');
    expect(tree.props.children[1].props.event.spotsLeftByTicket).toEqual({ adult: 6 });
    expect(JSON.stringify(tree.props.children[1].props)).not.toContain('email');
  });
  it('fails visibly instead of presenting a truncated capacity count', async () => {
    mocks.get.mockResolvedValueOnce(event([{ id: 'adult', capacity: 10000 }]))
      .mockResolvedValueOnce({ docs: Array.from({ length: 5001 }, () => ({ data: () => ({ status: 'confirmed', ticketTypeId: 'adult' }) })) });
    await expect(page()).rejects.toThrow('capacity read exceeds');
  });
});
