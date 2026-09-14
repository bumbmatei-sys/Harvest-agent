import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

/**
 * THE-351 · 🔴 THE MEMBER'S TICKET AND THE TENANT INBOX, RENDERED.
 *
 * Tests 4, 5, 6 (presence), 10 (through the UI), 14g and 19 — read off the DOM
 * the real components produce.
 *
 * ⚠️ EVERY FIXTURE INSTANT IS FAR-FUTURE AND BUILT FROM PARTS. #468 turned
 * `main` red with a date pinned near the run date.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AT = (d: number) => new Date(Date.UTC(2031, 8, d, 10, 0, 0)).toISOString();

const claimCalls: Array<{ tenantId: string; registrationId: string; provider: string | null }> = [];
const claimBehaviour = { current: 'ok' as 'ok' | 'throw' };

vi.mock('../inbox/payment-claims-client', () => ({
  claimPaymentSent: async (tenantId: string, registrationId: string, provider: string | null) => {
    claimCalls.push({ tenantId, registrationId, provider });
    if (claimBehaviour.current === 'throw') throw new Error('That could not be sent.');
  },
  fetchPaymentInbox: async () => ({ items: [], count: 0, exact: true }),
  confirmPaymentClaim: async () => ({ alreadyConfirmed: false, visibleToMember: true }),
  invalidatePaymentInbox: () => {},
}));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u', email: 'dana@example.com' } } }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}), query: (q: unknown) => q, getDocs: async () => ({ docs: [] }),
  orderBy: () => ({}), limit: () => ({}),
}));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,AA' } }));
vi.mock('../../utils/tenant-scope', () => ({ getTenantScope: async () => 't1' }));
vi.mock('../../utils/share-url', () => ({ useShareBaseUrl: () => 'https://t1.theharvest.app' }));
vi.mock('../ShareButton', () => ({ default: () => <span /> }));
vi.mock('../../contexts/TenantContext', () => ({
  useTenantOptional: () => ({ branding: { churchName: 'Grace Chapel' } }),
}));
vi.mock('../../utils/auth-fetch', () => ({ authFetch: async () => ({ ok: true, json: async () => ({ tickets: [] }) }) }));

const COPY = await import('../../lib/event-payment-claims');
const { TenantInbox } = await import('../inbox/TenantInbox');
const UserEventsMod = await import('../UserEvents');

let container: HTMLDivElement;
let root: Root;

const mount = async (node: React.ReactNode) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(node as React.ReactElement); });
  // ⚠️ A MACROTASK, NOT JUST MICROTASKS. `TenantInbox` defers its first read by
  // one `setTimeout(0)` so the badge never competes with the entitlement
  // lookups the nav depends on (THE-139); a microtask-only flush would leave
  // the badge unrendered and every count assertion vacuous.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return container;
};

const click = async (el: Element | null) => {
  if (!el) throw new Error('nothing to click — the markup changed');
  await act(async () => { (el as HTMLElement).click(); });
  await act(async () => { await Promise.resolve(); });
};

beforeEach(() => { claimCalls.length = 0; claimBehaviour.current = 'ok'; });
afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  container?.remove();
});

/* ═══ The member's ticket ════════════════════════════════════════════════ */

/**
 * `TicketPaymentPanel` is not exported — it is an implementation detail of the
 * ticket modal — so it is reached the way a member reaches it: by rendering the
 * modal. The module's default export is the screen; the modal is what the
 * screen opens, so the panel is driven through a minimal harness that renders
 * the same element the screen does.
 */
const Panel = (UserEventsMod as unknown as {
  __TicketPaymentPanel: React.FC<Record<string, unknown>>;
}).__TicketPaymentPanel;

describe('4+5 · the member’s ticket', () => {
  it('🔴 an UNPAID ticket names the amount, the reference and the church', async () => {
    expect(Panel, 'the ticket payment panel is not exported for test').toBeTruthy();
    const c = await mount(
      <Panel
        ticket={{
          id: 'reg1', payment: 'unpaid', amount: 5000, paymentReference: 'HV-4KTM9P',
          payOptions: [{ id: 'paypal', label: 'PayPal', url: 'https://paypal.me/grace', handle: null, email: null }],
        }}
        tenantName="Grace Chapel"
        onChanged={() => {}}
      />,
    );
    const panel = c.querySelector('[data-ticket-payment="unpaid"]');
    expect(panel, 'an unpaid ticket says nothing about payment').not.toBeNull();
    const text = panel!.textContent ?? '';
    expect(text).toContain('$50.00');
    expect(text, '🔴 THE REFERENCE IS MISSING — the church cannot match the payment')
      .toContain('HV-4KTM9P');
    expect(text).toContain('Grace Chapel');
    // 🔴 And it says Harvest does not handle or see the money.
    expect(text).toMatch(/Harvest does not handle this money and cannot see it/);
    expect(COPY.claimsVerification(text)).toBeNull();

    // The church's link is offered, as a real anchor to the validated URL.
    const link = c.querySelector('[data-ticket-pay-options] a') as HTMLAnchorElement;
    expect(link.href).toBe('https://paypal.me/grace');
  });

  it('🔴 "I’ve paid" says, BESIDE the button, that it confirms nothing', async () => {
    const c = await mount(
      <Panel
        ticket={{ id: 'reg1', payment: 'unpaid', amount: 5000, paymentReference: 'HV-4KTM9P', payOptions: [] }}
        tenantName="Grace Chapel"
        onChanged={() => {}}
      />,
    );
    const button = c.querySelector('[data-ticket-claim]')!;
    expect(button.textContent).toBe(COPY.MEMBER_CLAIM_BUTTON);
    expect(button.textContent).toBe("I've paid");

    const help = c.querySelector('[data-ticket-claim-help]')!;
    // THE-359 rewrote this sentence and gave it the TENANT's name. What it must
    // still carry is the premise: the press does not confirm anything.
    expect(help.textContent).toBe(COPY.memberClaimHelp('Grace Chapel'));
    // 🔴 THE PREMISE, IN THE MEMBER'S OWN VIEW.
    expect(help.textContent).toMatch(/does not confirm payment/i);
    expect(help.textContent).toContain('Grace Chapel');
    expect(help.textContent, 'THE-359 removed the debt line').not.toMatch(/what you owe/i);
    // 🔴 NOT BEHIND A HOVER. A phone has no hover, and a member who thinks the
    // press settled it arrives at the door believing they are paid.
    expect(help.getAttribute('title')).toBeNull();
    expect((help as HTMLElement).hidden).toBe(false);

    // The tap target clears 44px below `sm`.
    expect(button.className).toMatch(/min-h-11/);
  });

  it('🔴 pressing it calls the claim route and NOTHING marks the ticket paid', async () => {
    let changed = 0;
    const c = await mount(
      <Panel
        ticket={{ id: 'reg1', payment: 'unpaid', amount: 5000, paymentReference: 'HV-4KTM9P', payOptions: [] }}
        tenantName="Grace Chapel"
        onChanged={() => { changed += 1; }}
      />,
    );
    await click(c.querySelector('[data-ticket-claim]'));
    expect(claimCalls).toEqual([{ tenantId: 't1', registrationId: 'reg1', provider: null }]);
    expect(changed, 'the ticket did not re-read its state from the server').toBe(1);
  });

  it('🔴 19 · a FAILED press says so and changes nothing', async () => {
    claimBehaviour.current = 'throw';
    const c = await mount(
      <Panel
        ticket={{ id: 'reg1', payment: 'unpaid', amount: 5000, paymentReference: 'HV-4KTM9P', payOptions: [] }}
        tenantName="Grace Chapel"
        onChanged={() => { throw new Error('a failed press reported success'); }}
      />,
    );
    await click(c.querySelector('[data-ticket-claim]'));
    const failed = c.querySelector('[data-ticket-claim-failed]');
    expect(failed, 'the failure was swallowed').not.toBeNull();
    expect(failed!.textContent).toBe(COPY.memberClaimFailed('Grace Chapel'));
    expect(failed!.textContent).toMatch(/Grace Chapel has not been told/);
    // Still unpaid, and the button is still there to try again.
    expect(c.querySelector('[data-ticket-payment="unpaid"]')).not.toBeNull();
  });

  it('a CLAIMED ticket names the TENANT that was asked — THE-359', async () => {
    const c = await mount(
      <Panel
        ticket={{ id: 'reg1', payment: 'claimed', amount: 5000, paymentReference: 'HV-4KTM9P', payOptions: [] }}
        tenantName="Grace Chapel"
        onChanged={() => {}}
      />,
    );
    const text = c.querySelector('[data-ticket-payment="claimed"]')!.textContent ?? '';
    expect(text).toContain(COPY.memberClaimedTitle('Grace Chapel'));
    expect(text).toContain('Waiting for Grace Chapel to check');
    expect(text).toContain('Waiting on Grace Chapel');
    /**
     * 🔴 THE-359 INVERTED THE TWO ASSERTIONS THAT USED TO LIVE HERE. This test
     * demanded "Harvest has not checked anything and cannot" and "you will not
     * be turned away at the door" — both sentences THE FOUNDER asked to be
     * deleted: "also remove 'Harvest has not checked anything and cannot. Until
     * someone there marks it paid, your ticket still reads unpaid — bring it
     * anyway, you will not be turned away at the door.'" Harvest has no way to
     * know what any tenant does at its own door. They are now REFUSED here.
     */
    expect(text, 'the deleted Harvest-has-not-checked line came back')
      .not.toMatch(/Harvest has not checked/i);
    expect(text, '🔴 the door guarantee came back on the member ticket')
      .not.toMatch(/turned away/i);
    expect(COPY.claimsVerification(text)).toBeNull();
    // 🔴 No "I've paid" button — pressing again would tell them nothing new.
    expect(c.querySelector('[data-ticket-claim]')).toBeNull();
  });

  it('a CONFIRMED ticket credits the TENANT BY NAME, never Harvest — THE-359', async () => {
    const c = await mount(
      <Panel
        ticket={{ id: 'reg1', payment: 'confirmed', amount: 5000, paymentReference: 'HV-4KTM9P', paymentConfirmedAt: AT(5), payOptions: [] }}
        tenantName="Grace Chapel"
        onChanged={() => {}}
      />,
    );
    const text = c.querySelector('[data-ticket-payment="confirmed"]')!.textContent ?? '';
    // 🔴 BOTH HALVES name the tenant — the heading was 'Marked paid by the
    // church' until THE-359. THE FOUNDER: "after a ticket is confirmed, do not
    // say the church but the name of the tenant."
    expect(text).toContain('Marked paid by Grace Chapel');
    expect(text).toContain('Grace Chapel marked this ticket paid');
    expect(text, 'the confirmed ticket still says "the church"').not.toMatch(/the church/i);
    expect(text).toMatch(/Harvest recorded their word for it/);
    expect(COPY.claimsVerification(text)).toBeNull();
  });

  it('🔴 a FREE ticket renders none of this at all', async () => {
    const c = await mount(
      <Panel ticket={{ id: 'reg1', payment: 'free', amount: 0, payOptions: [] }} tenantName="Grace Chapel" onChanged={() => {}} />,
    );
    expect(c.querySelector('[data-ticket-payment]'),
      'a free registration grew payment vocabulary').toBeNull();
  });
});

/* ═══ The tenant inbox ═══════════════════════════════════════════════════ */

const ROW = {
  kind: 'event_payment_claim' as const,
  id: 'reg1', memberName: 'Dana Okafor', memberEmail: 'dana@example.com',
  eventTitle: 'Autumn Retreat', amountCents: 5000, reference: 'HV-4KTM9P',
  providerId: 'revolut' as const, providerLabel: 'Revolut', claimedAt: AT(5),
};

describe('14g+10+19 · the tenant inbox', () => {
  it('🔴 the row carries name, amount, reference, provider and when', async () => {
    const c = await mount(
      <TenantInbox tenantId="t1" load={async () => ({ items: [ROW], count: 1, exact: true })} />,
    );
    await click(c.querySelector('[data-tenant-inbox-trigger]'));

    const row = document.querySelector('[data-tenant-inbox-row]');
    expect(row, 'the inbox rendered no rows').not.toBeNull();
    expect(row!.querySelector('[data-inbox-row-name]')!.textContent).toBe('Dana Okafor');
    const summary = row!.querySelector('[data-inbox-row-summary]')!.textContent ?? '';
    for (const needed of ['$50.00', 'HV-4KTM9P', 'Revolut']) {
      expect(summary, `the row drops ${needed} — the admin cannot match a bank line`)
        .toContain(needed);
    }
    // A DATE, not "2 hours ago" — the admin is comparing against a bank line.
    expect(summary).toMatch(/Sep 5/);
    expect(row!.textContent).toContain('Autumn Retreat');
    // And nothing on the row claims Harvest checked anything.
    expect(COPY.claimsVerification(row!.textContent ?? '')).toBeNull();
  });

  it('🔴 the badge shows an EXACT count, and says so when it cannot', async () => {
    const c = await mount(
      <TenantInbox tenantId="t1" load={async () => ({ items: [ROW], count: 7, exact: true })} />,
    );
    expect(c.querySelector('[data-tenant-inbox-badge]')!.textContent).toBe('7');
    await act(async () => { root.unmount(); });

    container.remove();
    const c2 = await mount(
      <TenantInbox tenantId="t1" load={async () => ({ items: [ROW], count: 200, exact: false })} />,
    );
    // 🔴 NEVER A BARE NUMBER OVER A TRUNCATED READ.
    expect(c2.querySelector('[data-tenant-inbox-badge]')!.textContent).toBe('200+');
  });

  it('🔴 an EMPTY inbox and a FAILED read are different screens', async () => {
    const c = await mount(
      <TenantInbox tenantId="t1" load={async () => ({ items: [], count: 0, exact: true })} />,
    );
    await click(c.querySelector('[data-tenant-inbox-trigger]'));
    expect(document.querySelector('[data-tenant-inbox-empty]')).not.toBeNull();
    expect(document.querySelector('[data-tenant-inbox-failed]')).toBeNull();
    // No badge at all when there is nothing to confirm.
    expect(c.querySelector('[data-tenant-inbox-badge]')).toBeNull();
    await act(async () => { root.unmount(); });
    container.remove();

    const c2 = await mount(
      <TenantInbox tenantId="t1" load={async () => { throw new Error('read failed'); }} />,
    );
    await click(c2.querySelector('[data-tenant-inbox-trigger]'));
    // 🔴 A FAILED READ IS NOT AN EMPTY INBOX. Painting "Nothing to confirm" over
    // a church with people waiting is the Silent-Failure Rule exactly.
    expect(document.querySelector('[data-tenant-inbox-failed]'),
      'a failed read rendered as an empty inbox').not.toBeNull();
    expect(document.querySelector('[data-tenant-inbox-empty]')).toBeNull();
  });

  it('🔴 the sheet says the church has checked nothing, before the button', async () => {
    const c = await mount(
      <TenantInbox tenantId="t1" load={async () => ({ items: [ROW], count: 1, exact: true })} />,
    );
    await click(c.querySelector('[data-tenant-inbox-trigger]'));
    const sheet = document.body.textContent ?? '';
    expect(sheet).toContain(COPY.INBOX_INTRO);
    expect(sheet).toMatch(/Harvest has not checked any of it/);
    expect(COPY.claimsVerification(sheet)).toBeNull();
  });

  it('🔴 10 · a second tap is told it was recorded ONCE, not twice', async () => {
    /**
     * 🔴 IDEMPOTENCE IS THE ROUTE'S PROPERTY and is proved there, against the
     * real transaction. What the UI owes is that a second tap does not READ as
     * a second success: an admin who saw "Recorded" twice would go looking for
     * two gifts in their books.
     *
     * The list deliberately keeps returning the row, so the button is still
     * there to press again — the state a slow connection or a double-submit
     * actually produces.
     */
    const calls: string[] = [];
    let already = false;
    const c = await mount(
      <TenantInbox
        tenantId="t1"
        load={async () => ({ items: [ROW], count: 1, exact: true })}
        confirm={async (_t, id) => {
          calls.push(id);
          const out = { alreadyConfirmed: already };
          already = true;
          return out;
        }}
      />,
    );
    await click(c.querySelector('[data-tenant-inbox-trigger]'));

    await click(document.querySelector('[data-inbox-confirm]'));
    expect(document.querySelector('[data-inbox-row-done]')!.textContent).toBe(COPY.CONFIRM_SUCCESS);

    await click(document.querySelector('[data-inbox-confirm]'));
    expect(calls, 'the second tap did not reach the route').toEqual(['reg1', 'reg1']);
    // 🔴 AND IT SAYS "ONCE, NOT TWICE" rather than reporting a second gift.
    expect(document.querySelector('[data-inbox-row-done]')!.textContent).toBe(COPY.CONFIRM_ALREADY);
    expect(COPY.CONFIRM_ALREADY).toMatch(/recorded once, not twice/i);
    expect(document.querySelector('[data-inbox-row-failed]'),
      'an already-confirmed row was reported as a failure').toBeNull();
  });

  it('🔴 19 · a failed confirmation stays on the row and does NOT mark it paid', async () => {
    const c = await mount(
      <TenantInbox
        tenantId="t1"
        load={async () => ({ items: [ROW], count: 1, exact: true })}
        confirm={async () => { throw new Error(COPY.CONFIRM_FAILED); }}
      />,
    );
    await click(c.querySelector('[data-tenant-inbox-trigger]'));
    await click(document.querySelector('[data-inbox-confirm]'));

    const failed = document.querySelector('[data-inbox-row-failed]');
    expect(failed, 'the failure was swallowed').not.toBeNull();
    expect(failed!.textContent).toBe(COPY.CONFIRM_FAILED);
    expect(failed!.textContent).toMatch(/still unpaid/i);
    // 🔴 THE ROW STAYS. The person is still waiting to be confirmed.
    expect(document.querySelector('[data-tenant-inbox-row]'),
      'a failed confirmation removed the person from the inbox').not.toBeNull();
    expect(document.querySelector('[data-inbox-row-done]')).toBeNull();
  });

  it('the Confirm button and the trigger both clear 44px below sm', async () => {
    const c = await mount(
      <TenantInbox tenantId="t1" load={async () => ({ items: [ROW], count: 1, exact: true })} />,
    );
    expect(c.querySelector('[data-tenant-inbox-trigger]')!.className).toMatch(/min-h-11/);
    await click(c.querySelector('[data-tenant-inbox-trigger]'));
    expect(document.querySelector('[data-inbox-confirm]')!.className).toMatch(/min-h-11/);
    expect(document.querySelector('[data-tenant-inbox-row]')!.className).toMatch(/min-h-11/);
  });
});
