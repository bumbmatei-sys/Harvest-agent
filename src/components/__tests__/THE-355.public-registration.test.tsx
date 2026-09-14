import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * THE-355 · 🔴 THE PUBLIC EVENT PAGE: THE LINKS, THE CLAIM, AND THE BUTTON
 * THAT LIED.
 *
 * THE FOUNDER, ON `kingdom-living.theharvest.app`, HAVING CREATED A $50 ADULT
 * TICKET AND CHOSEN REVOLUT: "i pressed on pay but it did not brought me to the
 * payment page but to the payment confirmation directly. there is no confirm
 * button in inbox, only in event page."
 *
 * Tests 1, 2, 3, 10, 12, 13, 14 and 15.
 *
 * 🔴 THESE DRIVE THE REAL SCREEN AND READ THE RENDERED DOM. Nothing here can be
 * satisfied by a word in a comment, and nothing is found by line number: every
 * surface is located by `data-` attribute or by rendered text.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The submit route's answer, swapped per test. */
const server = {
  submit: {} as Record<string, unknown>,
  submitOk: true,
  claimOk: true,
  calls: [] as { url: string; body: Record<string, unknown> }[],
};

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: null } }));
vi.mock('firebase/auth', () => ({
  // No signed-in user, ever: this suite is about the LOGGED-OUT registrant.
  onAuthStateChanged: (_a: unknown, cb: (u: null) => void) => { cb(null); return () => {}; },
}));
vi.mock('../../utils/auth-fetch', () => ({ authFetch: vi.fn() }));

const { mountScreen, settle, click } = await import('../../test/support/ministry-screens');
const PublicEventRegistration = (await import('../PublicEventRegistration')).default;
const {
  MEMBER_CLAIM_BUTTON, PUBLIC_PAY_TITLE,
  publicClaimHelp, publicClaimedTitle, publicNoLinksTitle,
  publicPayBody, publicNoLinksBody, publicClaimedBody,
  FORBIDDEN_CLAIM_PHRASES, claimsVerification,
} = await import('@/lib/event-payment-claims');

/**
 * A FIXED, FAR-FUTURE instant built from parts — never `new Date()` and never a
 * literal near today. #468 turned main red for everyone with a date pinned near
 * the run date; the founder's own event is dated 2026 and this is well past any
 * plausible CI clock.
 */
const START = new Date(Date.UTC(2031, 8, 4, 10, 0, 0)).toISOString();

const PAID_EVENT = {
  id: 'ev-paid',
  title: 'Crusade Bangladesh',
  description: 'A crusade.',
  coverImage: null,
  location: 'Dhaka',
  isOnline: false,
  startDate: START,
  endDate: null,
  price: 0,
  currency: 'usd',
  status: 'published',
  registrationEnabled: true,
  ticketTypes: [{ id: 'tt-adult', name: 'Adult', price: 5000, capacity: null, order: 0 }],
  waitlistEnabled: false,
  hasDiscounts: false,
};

const FREE_EVENT = {
  ...PAID_EVENT,
  id: 'ev-free',
  title: 'Free Conference',
  ticketTypes: [{ id: 'tt-free', name: 'General', price: 0, capacity: null, order: 0 }],
};

/** The founder's own choice. */
const REVOLUT = [{
  id: 'revolut', label: 'Revolut', url: 'https://revolut.me/kingdomliving', handle: null, email: null,
}];

const REFERENCE = 'HV-VSFK4W';
const TOKEN = 'aZ1_bY2-cX3dW4eV5fU6gT7hS8iR9jQ0kP1lO2mN3oM';

beforeEach(() => {
  server.submitOk = true;
  server.claimOk = true;
  server.calls = [];
  server.submit = {
    success: true, ticketCode: 'QWE456', waitlisted: false,
    paymentReference: REFERENCE, amount: 5000, paymentClaimToken: TOKEN,
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    server.calls.push({ url: String(url), body });
    if (String(url).includes('public-claim')) {
      return { ok: server.claimOk, json: async () => (server.claimOk ? { ok: true } : { error: 'no' }) };
    }
    return { ok: server.submitOk, json: async () => server.submit };
  }));
  // A clean URL: nothing in this suite arrives with a ?registration= param
  // unless the test puts one there.
  window.history.replaceState(null, '', '/event/ev-paid');
});

let mounted: { container: HTMLElement; unmount: () => void } | null = null;
/** Unmount and clear. A function rather than an inline pair so repeated use in
 *  one test does not narrow `mounted` to `never` after the first reset. */
const unmountCurrent = () => { mounted?.unmount(); mounted = null; };
afterEach(() => { unmountCurrent(); vi.unstubAllGlobals(); });

const mount = async (props: Record<string, unknown> = {}) => {
  mounted = await mountScreen(
    <PublicEventRegistration
      tenantId="kingdom-living"
      tenantName="Kingdom Living"
      logo={null}
      primaryColor="#B8962E"
      event={PAID_EVENT}
      payOptions={REVOLUT}
      {...(props as { event?: unknown })}
    />,
  );
  return mounted.container;
};

/** Fill the form and press the submit button — the founder's own path. */
const registerAndSubmit = async (root: HTMLElement) => {
  const inputs = Array.from(root.querySelectorAll('input'));
  const set = (el: HTMLInputElement, v: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  await (await import('react-dom/test-utils'), Promise.resolve());
  const { act } = await import('react');
  await act(async () => {
    set(inputs[0] as HTMLInputElement, 'Matei');
    set(inputs[1] as HTMLInputElement, 'B');
    set(inputs[2] as HTMLInputElement, 'matei@example.com');
  });
  await click(root.querySelector('[data-public-submit]') as HTMLElement);
  await settle();
  return root;
};

const text = (root: ParentNode) => (root.textContent ?? '').replace(/\s+/g, ' ');

/* ═══ 2 · the button does NOT promise a redirect that cannot happen ═══════ */

describe('2 · the button does not promise a redirect that cannot happen', () => {
  it('🔴 a $50 ticket’s button does not say "Continue to payment"', async () => {
    const root = await mount();
    // 🔴 THE SUBMIT BUTTON BY ITS OWN MARKER, never by position and never by
    // price — the ticket-type selector also renders "$50.00", and a test that
    // matched on the price would have measured the wrong control.
    const el = root.querySelector('[data-public-submit]');
    expect(el, 'the submit button could not be found — the surface moved').toBeTruthy();
    const submit = el!.textContent || '';
    /**
     * 🔴 UNDER MANUAL CONFIRMATION NOBODY IS SENT ANYWHERE. `requiresPayment` in
     * the submit route is `amount > 0 && !waitlisted && !manualConfirmationMode()`
     * and `manualConfirmationMode()` is true, so no Checkout session is created
     * and no `url` comes back. "Continue to payment" was a claim about a
     * processor that no longer exists.
     */
    expect(submit.toLowerCase(), 'the button still promises a payment page')
      .not.toContain('continue to payment');
    expect(submit).toContain('Register');
    expect(submit).toContain('$50.00');
  });

  it('🔴 and while submitting it does not say "Redirecting to payment…"', async () => {
    const root = await mount();
    // Hold the submit open so the in-flight label is the one on screen.
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    vi.stubGlobal('fetch', vi.fn(async () => {
      await held;
      return { ok: true, json: async () => server.submit };
    }));
    await registerAndSubmit(root);
    const inflight = Array.from(root.querySelectorAll('button'))
      .map((b) => b.textContent || '').join(' ');
    expect(inflight.toLowerCase(), 'the page still says it is redirecting to a payment page')
      .not.toContain('redirecting to payment');
    release();
    await settle();
  });

  it('🔴 a FREE ticket’s button is untouched — "Register", no price, no payment word', async () => {
    const root = await mount({ event: FREE_EVENT });
    const submit = (root.querySelector('[data-public-submit]')!.textContent || '').trim();
    expect(submit, 'the free event’s Register button changed').toBe('Register');
  });
});

/* ═══ 3 · "Payment received" can never render ═════════════════════════════ */

describe('3 · "Payment received" can never render', () => {
  it('🔴 ?registration=success renders the FORM, not a payment confirmation', async () => {
    /**
     * 🔴 THE URL IS THE ATTACK, AND IT NEEDS NO STRIPE SESSION. Anyone could
     * type `?registration=success` onto a live event page and be told
     * "Payment received — you're registered!" having paid nobody. That is a lie
     * about money told by a query string.
     *
     * `PAID_EVENTS_ENABLED` is false, so the effect that reads the param returns
     * before setting anything and the branch is structurally unreachable.
     */
    window.history.replaceState(null, '', '/event/ev-paid?registration=success');
    const root = await mount();
    const body = text(root).toLowerCase();
    for (const phrase of FORBIDDEN_CLAIM_PHRASES) {
      expect(body, `the public page renders "${phrase}"`).not.toContain(phrase);
    }
    // And what it renders instead is the real registration form.
    expect(root.querySelectorAll('input').length, 'the registration form is gone')
      .toBeGreaterThan(2);
  });

  it('🔴 ?registration=cancel does not render a cancelled-payment screen either', async () => {
    window.history.replaceState(null, '', '/event/ev-paid?registration=cancel');
    const root = await mount();
    expect(text(root).toLowerCase(), 'a payment-cancelled screen rendered for a payment nobody started')
      .not.toContain('your payment was cancelled');
    expect(root.querySelectorAll('input').length).toBeGreaterThan(2);
  });

  it('🔴 the gate is the SAME constant that stops anyone reaching Checkout', async () => {
    // ⚠️ Not a restatement: if these two ever diverge, one of them is wrong and
    // the page either promises a rail nobody reaches or hides a screen a real
    // payer needs. Both are read from the module, not copied.
    const { PAID_EVENTS_ENABLED, manualConfirmationMode } =
      await import('@/lib/paid-events-feature');
    expect(PAID_EVENTS_ENABLED, 'the rail is live — this suite’s premise has changed').toBe(false);
    expect(manualConfirmationMode()).toBe(true);
  });
});

/* ═══ 1 · the public page SHOWS the church's chosen payment link(s) ═══════ */

describe('1 · the public page shows the church’s chosen payment link(s)', () => {
  it('🔴 after registering, the founder’s Revolut link is ON THE PAGE', async () => {
    const root = await mount();
    await registerAndSubmit(root);

    const options = root.querySelector('[data-public-pay-options]');
    expect(options, '🔴 the church’s payment links are still not rendered').toBeTruthy();

    const link = root.querySelector('[data-public-pay-link]') as HTMLAnchorElement | null;
    expect(link, 'the Revolut link has no anchor').toBeTruthy();
    expect(link!.getAttribute('href'), 'the link does not point at the church’s Revolut')
      .toBe('https://revolut.me/kingdomliving');
    expect(text(options!), 'the provider is not named').toContain('Revolut');
    // A public link opens away from this page and must not leak the referrer
    // chain of a page that just held a claim token.
    expect(link!.getAttribute('rel')).toContain('noreferrer');
  });

  it('🔴 the instruction names the CHURCH, the amount and the reference', async () => {
    const root = await mount();
    await registerAndSubmit(root);
    const note = root.querySelector('[data-public-payment-note]')!;
    expect(text(note)).toContain(PUBLIC_PAY_TITLE);
    expect(text(note)).toContain(publicPayBody('Kingdom Living', 5000, REFERENCE));
    expect(text(note), 'the reference is missing from the one screen that must carry it')
      .toContain(REFERENCE);
  });

  it('🔴 a link with no URL renders its handle, not a dead anchor', async () => {
    const root = await mount({
      payOptions: [{ id: 'zelle', label: 'Zelle', url: null, handle: null, email: 'give@kl.example' }],
    } as never);
    await registerAndSubmit(root);
    const options = root.querySelector('[data-public-pay-options]')!;
    expect(text(options)).toContain('give@kl.example');
    expect(options.querySelector('[data-public-pay-link]'), 'a link with no URL rendered an anchor')
      .toBeNull();
  });
});

/* ═══ 4 · a PUBLIC registrant can claim they paid ════════════════════════ */

describe('4 · a public registrant can claim they paid', () => {
  it('🔴 the claim button is on the public page — this is why the inbox was empty', async () => {
    const root = await mount();
    await registerAndSubmit(root);
    const btn = root.querySelector('[data-public-claim]') as HTMLButtonElement | null;
    expect(btn, '🔴 a public registrant still has no way to say they paid').toBeTruthy();
    expect((btn!.textContent || '').trim()).toBe(MEMBER_CLAIM_BUTTON);
  });

  it('🔴 pressing it calls the PUBLIC route with the token and NO registration id', async () => {
    const root = await mount();
    await registerAndSubmit(root);
    await click(root.querySelector('[data-public-claim]') as HTMLElement);

    const call = server.calls.find((c) => c.url.includes('public-claim'));
    expect(call, 'the claim never reached the server').toBeTruthy();
    expect(call!.body.token, 'the claim carries no token').toBe(TOKEN);
    expect(call!.body.tenantId).toBe('kingdom-living');
    // 🔴 There is nothing here that could name somebody else's seat.
    expect(call!.body, 'the client sends a registration id the route must not honour')
      .not.toHaveProperty('registrationId');
  });

  it('🔴 the help text says the press settles nothing — beside the button, not in a tooltip', async () => {
    const root = await mount();
    await registerAndSubmit(root);
    const help = root.querySelector('[data-public-claim-help]');
    expect(help, 'the warning is gone').toBeTruthy();
    expect(text(help!)).toBe(publicClaimHelp('Kingdom Living'));
    // THE-359 — what it must still carry, and what it must no longer carry.
    expect(text(help!)).toMatch(/does not confirm payment/i);
    expect(text(help!)).toContain('Kingdom Living');
    expect(text(help!), 'the logged-out registrant lost the pointer to their record')
      .toContain('Keep the email with your ticket code');
    expect(text(help!), 'THE-359 removed the debt line').not.toMatch(/what you owe/i);
    // A phone has no hover. It must be rendered text, not a title attribute.
    const btn = root.querySelector('[data-public-claim]')!;
    expect(btn.getAttribute('title'), 'the warning moved behind a hover').toBeNull();
  });

  it('🔴 after a successful press it names the TENANT that was asked — not that anything is paid', async () => {
    const root = await mount();
    await registerAndSubmit(root);
    await click(root.querySelector('[data-public-claim]') as HTMLElement);

    const done = root.querySelector('[data-public-claim-done]');
    expect(done, 'the press left no visible outcome').toBeTruthy();
    expect(text(done!)).toContain(publicClaimedTitle('Kingdom Living'));
    expect(text(done!)).toContain('Kingdom Living has been asked to look');
    expect(text(done!)).toContain(publicClaimedBody('Kingdom Living', REFERENCE));
    expect(text(done!), 'the claimed state still says "the church"').not.toMatch(/the church/i);
    expect(claimsVerification(text(done!)), 'the confirmation claims Harvest checked something')
      .toBeNull();
    expect(root.querySelector('[data-public-claim]'), 'the button is still pressable after a claim')
      .toBeNull();
  });

  it('🔴 a FAILED claim surfaces visibly and does NOT lose the registration', async () => {
    server.claimOk = false;
    const root = await mount();
    await registerAndSubmit(root);
    await click(root.querySelector('[data-public-claim]') as HTMLElement);

    expect(root.querySelector('[data-public-claim-failed]'), 'a failed claim said nothing').toBeTruthy();
    // 🔴 THE-321's saveState rule: the record the person came for is still there.
    expect(text(root), 'the ticket code was lost with the failure').toContain('QWE456');
    expect(text(root)).toContain(REFERENCE);
    expect(root.querySelector('[data-public-pay-options]'), 'the links vanished on failure').toBeTruthy();
    expect(root.querySelector('[data-public-claim]'), 'the registrant cannot retry').toBeTruthy();
  });

  it('🔴 the token is never written to the URL or to storage', async () => {
    const root = await mount();
    await registerAndSubmit(root);
    /**
     * 🔴 IT AUTHORISES A WRITE AGAINST A DOCUMENT CARRYING A MONEY AMOUNT. A URL
     * lands in history, a referer header and a shared screenshot; a storage key
     * outlives the tab and the person. It lives in component state, whose
     * lifetime is exactly the screen that uses it.
     */
    expect(window.location.href, 'the claim token is in the URL').not.toContain(TOKEN);
    expect(JSON.stringify(window.localStorage), 'the claim token is in localStorage')
      .not.toContain(TOKEN);
    expect(JSON.stringify(window.sessionStorage), 'the claim token is in sessionStorage')
      .not.toContain(TOKEN);
    expect(root.innerHTML, 'the claim token is rendered into the DOM').not.toContain(TOKEN);
  });
});

/* ═══ 13 · a paid event with NO configured link tells the member something true ═ */

describe('13 · a paid event with no configured link', () => {
  it('🔴 says the church has published no way to pay, and offers no claim', async () => {
    const root = await mount({ payOptions: [] } as never);
    await registerAndSubmit(root);

    const note = root.querySelector('[data-public-payment-note]')!;
    const noLinks = root.querySelector('[data-public-no-links]');
    expect(noLinks, 'a priced event with no link renders an empty space — the original bug').toBeTruthy();
    // THE-359 — the heading names the TENANT: 'Ask the church how to pay' was
    // a constant until this ticket.
    expect(text(noLinks!)).toContain(publicNoLinksTitle('Kingdom Living'));
    expect(text(noLinks!)).toContain('Ask Kingdom Living how to pay');
    expect(text(noLinks!)).toContain(publicNoLinksBody('Kingdom Living', 5000, REFERENCE));

    // 🔴 IT IS TRUE, AND IT IS NOT A FAILURE. The place IS booked.
    expect(text(note)).toContain('Your place is booked');
    expect(text(note)).toContain(REFERENCE);
    // 🔴 THE-359 INVERTED THIS. It demanded the door guarantee on "the state
    // that most needs it"; the founder deleted the guarantee outright, because
    // Harvest cannot know what any tenant does at its own door.
    expect(text(note), '🔴 the door guarantee came back on the no-links state')
      .not.toMatch(/turned away/i);
    // Nothing to have paid, so nothing to claim.
    expect(root.querySelector('[data-public-claim]'), 'a claim was offered with nowhere to pay').toBeNull();
    expect(claimsVerification(text(note))).toBeNull();
  });
});

/* ═══ 12 · THE-359 — the door guarantee is GONE from the public page ═════ */

/**
 * 🔴 THIS BLOCK IS THE EXACT INVERSE OF THE ONE IT REPLACES, and the inversion
 * is the ticket. THE-355 asserted "the founder's door decision fell off the
 * public page" if the promise was missing. THE FOUNDER, THE-359: "'Bring this
 * ticket either way — you will not be turned away at the door.' this should be
 * deleted. there is no way for us to know what each church is doing. or
 * ministry."
 *
 * ⚠️ THE BEHAVIOUR DID NOT CHANGE — check-in still never blocks on payment, and
 * `THE-351.manual-payment.guards.test.ts` §14 still proves it against the real
 * `AdminEvents` source. What went is the PROMISE, which was never Harvest's to
 * make on a tenant's behalf.
 */
describe('12 · the door guarantee is gone from the public page', () => {
  it('🔴 a paid confirmation promises nothing about the door', async () => {
    const root = await mount();
    await registerAndSubmit(root);
    const all = text(root).toLowerCase();
    expect(all, '🔴 the door guarantee came back on the public confirmation')
      .not.toContain('turned away');
    expect(all, 'a softened door claim was substituted for the deleted one')
      .not.toMatch(/at the door[^.]*\b(let in|admitted|welcome)\b/);
  });

  it('🔴 and it stays gone once a claim has been made', async () => {
    const root = await mount();
    await registerAndSubmit(root);
    await click(root.querySelector('[data-public-claim]') as HTMLElement);
    const all = text(root).toLowerCase();
    expect(all).not.toContain('turned away');
    expect(all, 'the deleted Harvest-has-not-checked line came back')
      .not.toContain('harvest has not checked');
  });
});

/* ═══ 14 · free registration is entirely unaffected ══════════════════════ */

describe('14 · free registration is entirely unaffected', () => {
  it('🔴 a free registration shows NO payment note, NO links and NO claim', async () => {
    server.submit = {
      success: true, ticketCode: 'FRE111', waitlisted: false,
      paymentReference: null, amount: 0, paymentClaimToken: null,
    };
    const root = await mount({ event: FREE_EVENT } as never);
    await registerAndSubmit(root);

    expect(text(root), 'the free registration lost its ticket code').toContain('FRE111');
    expect(root.querySelector('[data-public-payment-note]'),
      '🔴 a church running a free conference was shown payment machinery').toBeNull();
    expect(root.querySelector('[data-public-pay-options]')).toBeNull();
    expect(root.querySelector('[data-public-claim]')).toBeNull();
    expect(root.querySelector('[data-public-no-links]')).toBeNull();
  });

  it('🔴 a WAITLISTED seat shows no payment machinery either', async () => {
    server.submit = {
      success: true, ticketCode: 'WAI222', waitlisted: true,
      paymentReference: REFERENCE, amount: 5000, paymentClaimToken: TOKEN,
    };
    const root = await mount();
    await registerAndSubmit(root);
    expect(text(root)).toContain('waitlist');
    expect(root.querySelector('[data-public-payment-note]'),
      'a waitlisted seat was asked to pay for a place it does not hold').toBeNull();
    expect(root.querySelector('[data-public-claim]')).toBeNull();
  });
});

/* ═══ 11 · no text implies Harvest verified a payment ════════════════════ */

describe('11 · nothing on the rendered page implies Harvest verified anything', () => {
  it('🔴 every state of the paid flow is swept — rendered text, not source', async () => {
    const seen: string[] = [];
    const grab = (root: HTMLElement, label: string) => { seen.push(label); return text(root); };

    const a = await mount();
    expect(claimsVerification(grab(a, 'form'))).toBeNull();
    await registerAndSubmit(a);
    expect(claimsVerification(grab(a, 'registered')), 'the confirmation over-claims').toBeNull();
    await click(a.querySelector('[data-public-claim]') as HTMLElement);
    expect(claimsVerification(grab(a, 'claimed')), 'the claimed state over-claims').toBeNull();
    unmountCurrent();

    server.claimOk = false;
    const b = await mount();
    await registerAndSubmit(b);
    await click(b.querySelector('[data-public-claim]') as HTMLElement);
    expect(claimsVerification(grab(b, 'claim failed'))).toBeNull();
    unmountCurrent();

    const c = await mount({ payOptions: [] } as never);
    await registerAndSubmit(c);
    expect(claimsVerification(grab(c, 'no links'))).toBeNull();

    // 🔴 THE SWEEP IS NOT VACUOUS: it really did visit five distinct states, and
    // the checker really does reject the phrase it is looking for.
    expect(seen).toEqual(['form', 'registered', 'claimed', 'claim failed', 'no links']);
    expect(claimsVerification('Payment received, thanks!'), 'the checker catches nothing')
      .toBe('payment received');
  });
});
