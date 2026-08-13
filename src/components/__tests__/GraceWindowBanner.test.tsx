import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'fs';
import { join } from 'path';
import GraceWindowBanner from '../GraceWindowBanner';

/**
 * THE-125 — the banner that tells a church its payment failed.
 *
 * The grace deadline lives on the server-only `tenant_private` doc, so the only
 * way a client learns it is `/api/tenants/grace-status`. These tests drive the
 * component off that route's real response shape.
 *
 * ⚠️ What the banner must NOT do is as pinned as what it must: no payment
 * surface of its own, and nothing rendered at all for a church that is paying
 * fine or whose window has already closed.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mockAuthFetch } = vi.hoisted(() => ({ mockAuthFetch: vi.fn() }));
vi.mock('../../utils/auth-fetch', () => ({ authFetch: mockAuthFetch }));

const DAY_MS = 24 * 60 * 60 * 1000;

/** A `/api/tenants/grace-status` response, as the route would build it. */
function graceStatus(body: Record<string, unknown>) {
  return { ok: true, json: async () => body };
}

let container: HTMLDivElement;
let root: Root;
let mounted = false;

const flush = async () => {
  await act(async () => {
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
};

async function mount(tenantId: string | null) {
  await act(async () => {
    root = createRoot(container);
    root.render(<GraceWindowBanner tenantId={tenantId} />);
  });
  mounted = true;
  await flush();
}

const text = () => container.textContent ?? '';

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  mockAuthFetch.mockResolvedValue(graceStatus({ state: 'none' }));
});

afterEach(async () => {
  if (mounted) { mounted = false; await act(async () => { root.unmount(); }); }
  container.remove();
});

describe('GraceWindowBanner', () => {
  it('renders nothing for a church that was never on hold', async () => {
    await mount('grace');
    expect(mockAuthFetch).toHaveBeenCalled();
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing once the window has already closed', async () => {
    // `expired` tenants are converged to archived and every surface already
    // refuses them with its own messaging. A countdown reading "0 days" over a
    // workspace that has already stopped is worse than silence.
    mockAuthFetch.mockResolvedValue(graceStatus({ state: 'expired' }));
    await mount('grace');
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when the lookup fails', async () => {
    // Nothing safe can be assumed from silence, and inventing a billing warning
    // for a church that is paying fine is its own kind of harm.
    mockAuthFetch.mockRejectedValue(new Error('offline'));
    await mount('grace');
    expect(container.innerHTML).toBe('');
  });

  it('names the billing problem plainly and says how long is left', async () => {
    // ⚠️ ADMIN COPY, NOT DONOR COPY. GIVING_UNAVAILABLE_MESSAGE on the donate
    // route says nothing about billing because a donor is not owed a church's
    // subscription status. The reader here is one of a handful of people who can
    // actually act, and vagueness costs them the three weeks.
    const endsAt = new Date(Date.now() + 12 * DAY_MS).toISOString();
    mockAuthFetch.mockResolvedValue(
      graceStatus({ state: 'in-grace', graceEndsAt: endsAt, daysRemaining: 12 }),
    );

    await mount('grace');

    expect(text()).toMatch(/payment didn.t go through/i);
    expect(text()).toMatch(/in 12 days/i);
    // The reassurance that matters: exports are structurally never gated.
    expect(text()).toMatch(/records and exports are never affected/i);
  });

  it('sends the admin to the existing Manage-subscription portal, not a payment form', async () => {
    // 🔴 Dodo has already charged or attempted to charge, and its own dunning
    // email links to the same customer portal. The banner may point at that
    // portal; it may not collect a card or open a second charge route.
    mockAuthFetch.mockResolvedValue(
      graceStatus({ state: 'in-grace', graceEndsAt: new Date(Date.now() + DAY_MS).toISOString(), daysRemaining: 1 }),
    );

    await mount('grace');

    const buttons = [...container.querySelectorAll('button')].map((b) => b.textContent ?? '');
    expect(buttons.some((b) => /manage subscription/i.test(b))).toBe(true);

    // No card entry, no amount, no "pay now" of any kind in the rendered banner.
    expect(container.querySelectorAll('input, form')).toHaveLength(0);
    const rendered = text().toLowerCase();
    for (const forbidden of ['card number', 'pay now', 'enter payment', '$']) {
      expect(rendered, forbidden).not.toContain(forbidden);
    }

    const source = readFileSync(join(process.cwd(), 'src/components/GraceWindowBanner.tsx'), 'utf8');
    expect(source).toContain("'/api/stripe/portal'");
    for (const forbidden of ['/api/stripe/checkout', '/api/dodo/', 'CardElement', 'PaymentElement']) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it('says "tomorrow" rather than "in 1 days" on the last day', async () => {
    mockAuthFetch.mockResolvedValue(
      graceStatus({ state: 'in-grace', graceEndsAt: new Date(Date.now() + DAY_MS).toISOString(), daysRemaining: 1 }),
    );
    await mount('grace');
    expect(text()).toMatch(/stops tomorrow/i);
  });

  it('asks nothing at all without a tenant', async () => {
    await mount(null);
    expect(mockAuthFetch).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe('');
  });

  it('is mounted in the admin shell, not on a single tab', () => {
    // The point of the banner is that nobody currently finds out at all. One
    // that only rendered on the Billing tab would be a warning for people who
    // had already gone looking.
    const shell = readFileSync(join(process.cwd(), 'src/components/AdminDashboard.tsx'), 'utf8');
    expect(shell).toContain("import GraceWindowBanner from './GraceWindowBanner'");
    expect(shell).toContain('<GraceWindowBanner tenantId={tenantId ?? null} />');
  });
});
