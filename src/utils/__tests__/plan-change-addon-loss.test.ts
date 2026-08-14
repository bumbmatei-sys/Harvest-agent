import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * THE-132, the client half: the loss is READ BEFORE THE CONFIRM.
 *
 * The route names the add-ons a plan change would remove; this is the half that
 * puts them in front of the person clicking. A church discovering on its next
 * invoice that something it paid for is gone is the same failure as an unseen
 * proration — the reason the whole flow is two-phase.
 */

vi.mock('@/utils/auth-fetch', () => ({ authFetch: (...args: any[]) => mockAuthFetch(...args) }));

const { mockAuthFetch } = vi.hoisted(() => ({ mockAuthFetch: vi.fn() }));

import { runDodoPlanChange } from '@/utils/plan-change';

const ADD_ON_LOST = 'Unlimited Contacts - Monthly';
const ADD_ON_ALSO_LOST = 'Contacts +500 - Monthly';
const ADD_ON_KEPT = 'AI Assistant - Monthly';

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as unknown as Response;
}

/** The preview the route returns, then the confirm's acknowledgement. */
function stubExchange(preview: Record<string, unknown>) {
  mockAuthFetch
    .mockResolvedValueOnce(jsonResponse({ preview }))
    .mockResolvedValueOnce(jsonResponse({ ok: true, message: 'Your plan change is confirmed.' }));
}

// happy-dom ships no `window.confirm`, so it is installed rather than spied on.
const confirmSpy = vi.fn<(message?: string) => boolean>(() => true);
const originalConfirm = window.confirm;

beforeEach(() => {
  vi.clearAllMocks();
  confirmSpy.mockReturnValue(true);
  window.confirm = confirmSpy;
});

afterEach(() => {
  window.confirm = originalConfirm;
});

const args = { tenantId: 'grace-chapel', plan: 'plus', billing: 'monthly' as const };

describe('the confirm dialog names the add-ons the change would remove', () => {
  it('states every loss before the church can accept', async () => {
    stubExchange({
      amountDueNow: 0,
      creditMovement: 1500,
      currency: 'USD',
      addOnsCarried: [{ name: ADD_ON_KEPT, quantity: 1 }],
      addOnsRemoved: [
        { name: ADD_ON_ALSO_LOST, quantity: 1 },
        { name: ADD_ON_LOST, quantity: 1 },
      ],
    });

    const result = await runDodoPlanChange(args);

    expect(result.ok).toBe(true);
    const shown = String(confirmSpy.mock.calls[0][0]);
    expect(shown).toContain(ADD_ON_LOST);
    expect(shown).toContain(ADD_ON_ALSO_LOST);
    // The money line is still there — the loss is added to it, not instead of it.
    expect(shown).toContain('credit');
  });

  it('says nothing about add-ons when the change removes none', async () => {
    stubExchange({
      amountDueNow: 2500,
      creditMovement: 0,
      currency: 'USD',
      addOnsCarried: [{ name: ADD_ON_KEPT, quantity: 1 }],
      addOnsRemoved: [],
    });

    await runDodoPlanChange(args);

    const shown = String(confirmSpy.mock.calls[0][0]);
    expect(shown).not.toContain('removed');
    // An add-on that SURVIVES is not a loss and is not announced as one.
    expect(shown).not.toContain(ADD_ON_KEPT);
  });

  it('does not confirm the change when the church declines the loss', async () => {
    confirmSpy.mockReturnValue(false);
    stubExchange({
      amountDueNow: 0,
      creditMovement: 1500,
      currency: 'USD',
      addOnsCarried: [],
      addOnsRemoved: [{ name: ADD_ON_LOST, quantity: 1 }],
    });

    const result = await runDodoPlanChange(args);

    expect(result.ok).toBe(false);
    // Only the preview was ever sent: declining charges nothing and removes
    // nothing.
    expect(mockAuthFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockAuthFetch.mock.calls[0][1].body).confirm).toBeUndefined();
  });
});
