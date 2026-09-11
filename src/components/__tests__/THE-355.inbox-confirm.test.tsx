import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

/**
 * THE-355 · 🔴 TEST 7 — CONFIRM APPEARS IN THE INBOX, NOT ONLY ON THE EVENT PAGE.
 *
 * THE FOUNDER: "there is no confirm button in inbox, only in event page."
 *
 * 🔴 THE INBOX'S CONFIRM BUTTON WAS NEVER MISSING. THE-351 built it and it
 * renders on every row. What was missing is ROWS: no public registrant could
 * claim, so no claim was ever created, so the queue was empty and the inbox
 * correctly painted "Nothing to confirm" — about a thing that had never
 * happened. The founder read an empty state as an absent control, and both
 * readings pointed at the same defect one layer down.
 *
 * ⚠️ SO THIS SUITE ASSERTS BOTH HALVES, and the second is the one that matters:
 *   · the control is on the row (a no-regression on THE-351), AND
 *   · an EMPTY inbox is a different screen from a POPULATED one, so a guard
 *     that rendered an empty inbox and looked for a button would have reported
 *     the founder's own bug as "Confirm is missing" and sent someone to rebuild
 *     a button that was already there.
 */

const confirmCalls: Array<{ tenantId: string; registrationId: string }> = [];
const confirmBehaviour = { current: 'ok' as 'ok' | 'already' | 'throw' };

vi.mock('../inbox/payment-claims-client', () => ({
  claimPaymentSent: async () => {},
  fetchPaymentInbox: async () => ({ items: [], count: 0, exact: true }),
  confirmPaymentClaim: async (tenantId: string, registrationId: string) => {
    confirmCalls.push({ tenantId, registrationId });
    // 🔴 THROWN WITH NO MESSAGE, which is the case the component's own fallback
    // is for: the route answered a failure it could not describe. A thrown
    // Error carrying text would have tested the text rather than the fallback.
    if (confirmBehaviour.current === 'throw') throw new Error('');
    return { alreadyConfirmed: confirmBehaviour.current === 'already', visibleToMember: true };
  },
  invalidatePaymentInbox: () => {},
}));

const COPY = await import('../../lib/event-payment-claims');
const { TenantInbox } = await import('../inbox/TenantInbox');

/** A far-future instant built from parts — never `new Date()`, never near today. */
const CLAIMED_AT = new Date(Date.UTC(2031, 8, 5, 10, 0, 0)).toISOString();

const ROW = {
  kind: 'event_payment_claim' as const,
  id: 'reg-public', memberName: 'Matei B', memberEmail: 'matei@example.com',
  eventTitle: 'Crusade Bangladesh', amountCents: 5000, reference: 'HV-VSFK4W',
  providerId: 'revolut' as const, providerLabel: 'Revolut', claimedAt: CLAIMED_AT,
};

let container: HTMLDivElement;
let root: Root;

const mount = async (node: React.ReactNode) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(node as React.ReactElement); });
  // ⚠️ A MACROTASK. `TenantInbox` defers its first read by one `setTimeout(0)`
  // (THE-139), so a microtask-only flush leaves every assertion vacuous.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return container;
};

const click = async (el: Element | null) => {
  if (!el) throw new Error('nothing to click — the markup changed');
  await act(async () => { (el as HTMLElement).click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

const flat = (el: ParentNode | Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

/**
 * Open the sheet by its OWN marker, never by position.
 *
 * ⚠️ AND THE SHEET RENDERS IN A PORTAL, so everything inside it is queried off
 * `document` rather than off the mount container. A container-scoped query
 * finds nothing and every assertion below it would have been vacuous.
 */
const openSheet = async (c: HTMLElement) => {
  const trigger = c.querySelector('[data-tenant-inbox-trigger]');
  expect(trigger, 'the inbox trigger could not be found — the surface moved').toBeTruthy();
  await click(trigger);
  return document;
};

beforeEach(() => { confirmCalls.length = 0; confirmBehaviour.current = 'ok'; });
afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  container?.remove();
});

/* ═══ 7 · Confirm appears in the INBOX ════════════════════════════════════ */

describe('7 · Confirm appears in the inbox, not only on the event page', () => {
  it('🔴 a populated inbox renders a Confirm control on the row', async () => {
    const c = await mount(
      <TenantInbox tenantId="t1" load={async () => ({ items: [ROW], count: 1, exact: true })} />,
    );
    const d = await openSheet(c);

    const btn = d.querySelector('[data-inbox-confirm]');
    expect(btn, '🔴 the inbox row has no Confirm control').toBeTruthy();
    expect(flat(btn!)).toBe(COPY.CONFIRM_BUTTON);
    // And the row carries what an admin needs to find the money first.
    const row = d.querySelector('[data-tenant-inbox-row]')!;
    expect(flat(row), 'the row does not name who claimed').toContain('Matei B');
    expect(flat(row), 'the row does not carry the reference the admin matches on')
      .toContain('HV-VSFK4W');
  });

  it('🔴 pressing it reaches the SAME route the event page presses', async () => {
    const c = await mount(
      <TenantInbox tenantId="t1" load={async () => ({ items: [ROW], count: 1, exact: true })} />,
    );
    const d = await openSheet(c);
    await click(d.querySelector('[data-inbox-confirm]'));
    /**
     * 🔴 TWO SURFACES CONFIRM AND THERE MUST BE ONE CALL. The inbox is where an
     * admin is PROMPTED; the attendee list is where they are already standing.
     * A second `fetch` written inline in either is how the two drift into
     * disagreeing about what a confirmation is.
     */
    expect(confirmCalls, 'the inbox’s Confirm did not reach the shared client')
      .toEqual([{ tenantId: 't1', registrationId: 'reg-public' }]);
  });

  it('🔴 an EMPTY inbox is a different screen — and it is what the founder saw', async () => {
    const c = await mount(
      <TenantInbox tenantId="t1" load={async () => ({ items: [], count: 0, exact: true })} />,
    );
    const d = await openSheet(c);
    expect(flat(d.body), 'the empty inbox no longer says so').toContain(COPY.INBOX_EMPTY_TITLE);
    /**
     * 🔴 THIS IS THE ASSERTION THAT KEEPS TEST 7 HONEST. With no rows there is
     * no Confirm, correctly — so a guard that rendered an empty inbox and looked
     * for a button would fail for a reason that has nothing to do with the
     * control existing. "Nothing to confirm" over two unpaid registrations was
     * an empty QUEUE, not a missing BUTTON, and the fix is upstream on the
     * public page.
     */
    expect(d.querySelector('[data-inbox-confirm]'), 'an empty inbox rendered a Confirm control')
      .toBeNull();
  });

  it('🔴 a second tap is told it was recorded ONCE, not twice', async () => {
    confirmBehaviour.current = 'already';
    const c = await mount(
      <TenantInbox tenantId="t1" load={async () => ({ items: [ROW], count: 1, exact: true })} />,
    );
    const d = await openSheet(c);
    await click(d.querySelector('[data-inbox-confirm]'));
    // The admin needs to know the money was recorded once — not that their tap
    // failed, which is what an error would have said.
    expect(flat(d.body), 'a repeat press was reported as a failure').toContain(COPY.CONFIRM_ALREADY);
  });

  it('🔴 a FAILED confirmation stays on the row and does NOT mark it paid', async () => {
    confirmBehaviour.current = 'throw';
    const c = await mount(
      <TenantInbox tenantId="t1" load={async () => ({ items: [ROW], count: 1, exact: true })} />,
    );
    const d = await openSheet(c);
    await click(d.querySelector('[data-inbox-confirm]'));
    // THE-321's saveState shape: a state beside the row, never a toast, and the
    // row does not move.
    expect(flat(d.body), 'a failed confirmation said nothing').toContain(COPY.CONFIRM_FAILED);
    expect(d.querySelector('[data-tenant-inbox-row]'), 'the row vanished on failure').toBeTruthy();
    expect(flat(d.body)).toContain('Matei B');
  });
});
