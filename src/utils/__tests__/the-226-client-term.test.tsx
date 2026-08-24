import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-226, the client half — the toggle's state must never reach the wire.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ─── What was measured, before anything was changed ──────────────────────────
 *
 * The real `AdminUpgradePage` was driven through the real `runDodoPlanChange`
 * with `authFetch` captured. Clicking "Upgrade to Small Team" posted:
 *
 *   toggle on Yearly     → {"tenantId":"final-test","plan":"pro","billing":"yearly"}
 *   toggle on Quarterly  → {"tenantId":"final-test","plan":"pro","billing":"quarterly"}
 *   toggle untouched     → {"tenantId":"final-test","plan":"pro","billing":"monthly"}
 *
 * The tenant was on MONTHLY throughout — live Dodo subscription
 * `sub_0Nm71Tmd5dD90j2XipJD5`, product `pdt_0NlJZKKU2AQSSH7E4ziKA`
 * (Individual/monthly), cadence `Month`×1. So the first two posted a term the
 * church was not on, and `/api/dodo/change-plan` refused them under THE-88 —
 * correctly, on the information it was given.
 *
 * 🔴 THE TOGGLE IS A PRICE VIEWER. `BillingTermToggle`'s only job is to decide
 * which column of `PLAN_PRICING` the cards render. It says nothing about what
 * anyone is billed, and a church comparing Small Team's yearly price before
 * pressing Upgrade has not asked to change term.
 *
 * These tests pin the fix at the layer that made the claim, and they are written
 * so that reinstating the old behaviour fails them by NAME rather than by a
 * value pattern.
 */

vi.hoisted(() => {
  process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
  process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_' + Buffer.from('t').toString('base64');
  process.env.DODO_PAYMENTS_ENVIRONMENT = 'live_mode';
});

const TENANT = 'final-test';

/**
 * Every request the client makes, in order. `TERM_ON_SERVER` is what the new
 * GET reports — the term the tenant is actually billed on.
 */
const { calls, state } = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; method: string; body: any }>,
  state: { termOnServer: 'monthly' as string, termOk: true },
}));

vi.mock('../auth-fetch', () => ({
  authFetch: async (url: string, init?: any) => {
    const method = init?.method || 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body) : undefined });

    if (url === '/api/billing/invoices') {
      return { ok: true, json: async () => ({ processor: 'dodo' }) } as any;
    }
    if (url.startsWith('/api/dodo/change-plan?')) {
      return state.termOk
        ? { ok: true, json: async () => ({ plan: 'plus', billing: state.termOnServer }) } as any
        : { ok: false, json: async () => ({ error: 'Your last payment did not go through.' }) } as any;
    }
    if (url === '/api/dodo/change-plan' && method === 'POST') {
      const body = JSON.parse(init.body);
      // The REAL guard, restated: the route refuses a term it is not already on.
      if (body.billing !== state.termOnServer) {
        return {
          ok: false,
          json: async () => ({
            error: 'Switching billing terms is not available yet. Please contact support.',
            requested: body.billing,
            current: state.termOnServer,
          }),
        } as any;
      }
      return body.confirm
        ? { ok: true, json: async () => ({ ok: true, message: 'Your plan change is confirmed.' }) } as any
        : {
            ok: true,
            json: async () => ({
              preview: { amountDueNow: 2000, creditMovement: 0, currency: 'USD', addOnsRemoved: [] },
            }),
          } as any;
    }
    return { ok: false, json: async () => ({ error: 'unexpected call' }) } as any;
  },
}));

vi.mock('../../components/settings/useTenantId', () => ({ getTenantId: async () => TENANT }));

import { runDodoPlanChange } from '../plan-change';
import AdminUpgradePage from '../../components/AdminUpgradePage';

/** The body of the plan-change POST that carried the preview. */
const previewPost = () =>
  calls.find((c) => c.url === '/api/dodo/change-plan' && c.method === 'POST' && !c.body?.confirm);
const confirmPost = () =>
  calls.find((c) => c.url === '/api/dodo/change-plan' && c.method === 'POST' && c.body?.confirm);

beforeEach(() => {
  calls.length = 0;
  state.termOnServer = 'monthly';
  state.termOk = true;
  vi.stubGlobal('confirm', () => true);
  vi.stubGlobal('alert', () => {});
});

// ── Test 5 ───────────────────────────────────────────────────────────────────

describe('the client sends the term the tenant is on, never the toggle’s state', () => {
  /**
   * The regression, driven through the REAL page: browse another term's prices,
   * then change plan. Before the fix each of these posted the browsed term.
   */
  for (const browsed of ['yearly', 'quarterly'] as const) {
    it(`posts the tenant’s monthly term while the page is browsing ${browsed} prices`, async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      await act(async () => {
        root.render(<AdminUpgradePage currentPlan="plus" tenantId={TENANT} onBack={() => {}} />);
      });

      // The owner flips the toggle to compare Small Team's price.
      const segment = [...host.querySelectorAll('[data-testid="billing-term-segment"]')]
        .find((b) => b.getAttribute('data-term') === browsed) as HTMLButtonElement;
      await act(async () => { segment.click(); });

      // …and presses Upgrade. They never asked to change term.
      const upgrade = [...host.querySelectorAll('button')]
        .find((b) => /Upgrade to Small Team/i.test(b.textContent || '')) as HTMLButtonElement;
      await act(async () => { upgrade.click(); });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

      // 🔴 THE ASSERTION: the term the tenant is BILLED on, not the one on screen.
      expect(previewPost()?.body).toEqual({ tenantId: TENANT, plan: 'pro', billing: 'monthly' });
      expect(previewPost()?.body.billing).not.toBe(browsed);

      // And it got all the way through, which is the founder's report.
      expect(confirmPost()?.body).toMatchObject({ billing: 'monthly', confirm: true });
    });
  }

  it('reads the term from the server even when a caller still passes the toggle', async () => {
    // `PlanUpgradeSection` is frozen under THE-225 and still passes `billing`.
    // That argument must be inert: the wire carries the server's answer.
    state.termOnServer = 'quarterly';
    const result = await runDodoPlanChange({
      tenantId: TENANT, plan: 'pro', billing: 'yearly',
    });
    expect(result.ok).toBe(true);
    expect(previewPost()?.body.billing).toBe('quarterly');
    expect(confirmPost()?.body.billing).toBe('quarterly');
  });

  it('asks the server BEFORE it posts, and asks the change-plan route itself', async () => {
    // The same route, so the same resolver — the identity the fix depends on.
    await runDodoPlanChange({ tenantId: TENANT, plan: 'pro' });
    const termRead = calls.findIndex((c) => c.url.startsWith('/api/dodo/change-plan?'));
    const preview = calls.findIndex((c) => c.url === '/api/dodo/change-plan' && c.method === 'POST');
    expect(termRead).toBeGreaterThanOrEqual(0);
    expect(termRead).toBeLessThan(preview);
    expect(calls[termRead].method).toBe('GET');
  });

  it('quotes the preview and the confirm from ONE body, so the amount describes the call', async () => {
    state.termOnServer = 'yearly';
    await runDodoPlanChange({ tenantId: TENANT, plan: 'pro' });
    expect(confirmPost()?.body).toEqual({ ...previewPost()?.body, confirm: true });
  });

  it('refuses rather than guessing when the term cannot be read', async () => {
    // 🔴 NEVER A DEFAULT. `'monthly'` as a fallback is the exact value that made
    // this bug look like a term switch, and a wrong term here would be a request
    // to move a paying church onto a different Dodo product.
    state.termOk = false;
    const result = await runDodoPlanChange({ tenantId: TENANT, plan: 'pro' });
    expect(result.ok).toBe(false);
    // The server's own sentence, passed through rather than replaced.
    expect(result.message).toContain('did not go through');
    expect(previewPost()).toBeUndefined();
  });
});
