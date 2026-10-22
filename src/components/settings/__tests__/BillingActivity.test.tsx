import React, { act } from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const authFetchMock = vi.hoisted(() => vi.fn());

vi.mock('../../../utils/auth-fetch', () => ({ authFetch: authFetchMock }));
vi.mock('../AddOnsSection', () => ({
  default: ({ processor }: { processor?: string | null }) => <div data-stub="addons" data-processor={String(processor)} />,
}));
vi.mock('../PlanUpgradeSection', () => ({ default: () => <div data-stub="plans" /> }));

import PlanBillingSection from '../PlanBillingSection';
import BillingActivity from '../BillingActivity';

const INVOICES = {
  subscription: { status: 'active', currentPeriodEnd: 1_900_000_000, nextAmount: 4900, currency: 'usd', cancelAtPeriodEnd: false },
  invoices: [
    { id: 'in_1', date: 1_800_000_000, amount: 4900, currency: 'usd', status: 'paid', invoicePdf: 'https://pay.example/in_1.pdf', hostedUrl: null },
    { id: 'in_2', date: 1_790_000_000, amount: 4900, currency: 'usd', status: 'open', invoicePdf: null, hostedUrl: null },
  ],
  processor: 'dodo',
};

const respond = (body: unknown, ok = true) => ({ ok, json: async () => body, blob: async () => new Blob(['pdf']) });

async function mountActivity() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<BillingActivity tenantId="t1" />); });
  await act(async () => { await Promise.resolve(); });
  return host;
}

beforeEach(() => {
  document.body.innerHTML = '';
  authFetchMock.mockReset();
});

describe('BillingActivity (invoice history and billing summary in the Plan & billing pane)', () => {
  it('lists the invoices with a PDF link where there is one', async () => {
    authFetchMock.mockResolvedValue(respond(INVOICES));
    const host = await mountActivity();
    expect(authFetchMock).toHaveBeenCalledWith('/api/billing/invoices');
    const rows = host.querySelectorAll('[data-testid="billing-history"] tbody tr');
    expect(rows).toHaveLength(2);
    const link = rows[0].querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://pay.example/in_1.pdf');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toContain('noopener');
    expect(rows[1].querySelector('a')).toBeNull();
    expect(host.textContent).toContain('$49.00');
    expect(host.querySelector('[data-testid="billing-next-date"]')?.textContent).toMatch(/Next billing/);
  });

  it('hands the processor to the add-ons section', async () => {
    authFetchMock.mockResolvedValue(respond(INVOICES));
    const host = await mountActivity();
    expect(host.querySelector('[data-stub="addons"]')?.getAttribute('data-processor')).toBe('dodo');
  });

  it('says where the history is when the processor holds it, and disables the PDF', async () => {
    authFetchMock.mockResolvedValue(respond({ ...INVOICES, invoices: [], historySource: 'portal' }));
    const host = await mountActivity();
    expect(host.querySelector('[data-testid="billing-history"]')?.textContent).toMatch(/payment processor/);
    expect(host.textContent).not.toMatch(/No payments yet/);
    const button = host.querySelector<HTMLButtonElement>('[data-testid="billing-statement"] button');
    expect(button?.disabled).toBe(true);
  });

  it('says "No payments yet" only when the list really is empty', async () => {
    authFetchMock.mockResolvedValue(respond({ ...INVOICES, invoices: [] }));
    const host = await mountActivity();
    expect(host.querySelector('[data-testid="billing-history"]')?.textContent).toMatch(/No payments yet/);
  });

  it('shows a load failure instead of an empty history', async () => {
    authFetchMock.mockResolvedValue(respond({ error: 'nope' }, false));
    const host = await mountActivity();
    expect(host.textContent).toContain('nope');
    expect(host.textContent, 'a failed read was drawn as an empty history').not.toMatch(/No payments yet/);
    expect(host.querySelector('[data-testid="billing-statement"]')).toBeNull();
  });

  it('generates the billing-summary PDF through the statement route', async () => {
    authFetchMock.mockImplementation(async (url: string) =>
      (url === '/api/billing/statement' ? respond({}) : respond(INVOICES)));
    const created = vi.fn(() => 'blob:x');
    const revoked = vi.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = created;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revoked;
    const host = await mountActivity();
    const button = host.querySelector<HTMLButtonElement>('[data-testid="billing-statement"] button')!;
    expect(button.disabled).toBe(false);
    await act(async () => { button.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(authFetchMock).toHaveBeenCalledWith('/api/billing/statement', { method: 'POST', body: '{}' });
    expect(created).toHaveBeenCalled();
    expect(revoked).toHaveBeenCalled();
  });

  it('shows the statement failure', async () => {
    authFetchMock.mockImplementation(async (url: string) =>
      (url === '/api/billing/statement' ? respond({ error: 'No payments to summarise' }, false) : respond(INVOICES)));
    const host = await mountActivity();
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="billing-statement"] button')!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toContain('No payments to summarise');
  });
});

describe('PlanBillingSection mounts BillingActivity for the owner of a subscription only', () => {
  async function mountSection(props: React.ComponentProps<typeof PlanBillingSection>) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(<PlanBillingSection {...props} />); });
    await act(async () => { await Promise.resolve(); });
    return host;
  }

  it('shows history and statement to the owner on a paid plan', async () => {
    authFetchMock.mockResolvedValue(respond(INVOICES));
    const host = await mountSection({ currentPlan: 'pro' as never, tenantId: 't1', canUpgrade: true });
    expect(host.querySelector('[data-testid="billing-history"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="billing-statement"]')).toBeTruthy();
  });

  it('never asks the owner-only billing routes for a non-owner', async () => {
    const host = await mountSection({ currentPlan: 'pro' as never, tenantId: 't1', canUpgrade: false });
    expect(host.querySelector('[data-testid="billing-history"]'), 'a non-owner was shown payment history').toBeNull();
    expect(authFetchMock).not.toHaveBeenCalled();
  });

  it('shows nothing to fetch on a plan with no subscription', async () => {
    const host = await mountSection({ currentPlan: 'free' as never, tenantId: 't1', canUpgrade: true });
    expect(host.querySelector('[data-testid="billing-history"]')).toBeNull();
    expect(authFetchMock).not.toHaveBeenCalled();
  });
});
