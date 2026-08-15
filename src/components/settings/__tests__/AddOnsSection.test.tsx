import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getEffectiveFeatures } from '../../../utils/plan-features';
import type { TenantAddons } from '../../../types/tenant.types';
import tailwind from '../../../../tailwind.config';

/**
 * REP-5d — the add-ons surface as cards, with the real charge on the button.
 *
 * The five presentation changes are pinned as COPY (a price that carries its
 * period, an owned badge that is not the stepper, the resulting contact total)
 * and the sixth — the inline preview — is pinned as BEHAVIOUR, because every way
 * it can go wrong is a way a church is shown a money figure that is not the one
 * it will be charged:
 *
 *   • a preview per keypress (THE-139's 429, on a stepper),
 *   • an amount that belongs to a quantity nobody is looking at any more,
 *   • the sticker price standing in for a preview that failed.
 *
 * 🔴 EVERY TARGET IS FOUND BY LABEL — the add-on's own name, an aria-label, the
 * text of a button. Nothing in here locates an element by matching a number,
 * which is how a test ends up asserting confidently about the wrong card.
 *
 * The tenant context is stubbed rather than driven through Firestore; what it
 * hands over is the shape `TenantProvider` really builds, and the contact totals
 * are computed with the REAL `getEffectiveFeatures` at assertion time so a tier
 * allowance cannot drift out from under a literal.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mockAuthFetch } = vi.hoisted(() => ({ mockAuthFetch: vi.fn() }));
vi.mock('../../../utils/auth-fetch', () => ({
  authFetch: (...args: unknown[]) => mockAuthFetch(...args),
}));

const { tenantValue } = vi.hoisted(() => ({ tenantValue: { current: null as any } }));
vi.mock('../../../contexts/TenantContext', () => ({
  useTenantOptional: () => tenantValue.current,
}));

import AddOnsSection from '../AddOnsSection';

const TENANT = 'grace-chapel';

/** The five meanings as `tenants/{id}.addons` carries them. */
function owns(overrides: Partial<TenantAddons> = {}): TenantAddons {
  return {
    aiAssistant: 0,
    adminSeats: 0,
    contactPacks: 0,
    unlimitedContacts: false,
    campuses: 0,
    ...overrides,
  };
}

/**
 * The catalogue as `/api/dodo/addons` returns it: named and priced by Dodo, and
 * NOT including Campus — the live gap, which is what the disabled card is for.
 */
const OFFERED = [
  { addon: 'aiAssistant', name: 'AI Assistant', priceMinorUnits: 22800, currency: 'USD' },
  { addon: 'adminSeat', name: 'Admin Seat', priceMinorUnits: 12000, currency: 'USD' },
  { addon: 'contactPack', name: 'Contacts +500', priceMinorUnits: 24000, currency: 'USD' },
  { addon: 'unlimitedContacts', name: 'Unlimited Contacts', priceMinorUnits: 70800, currency: 'USD' },
];

const reply = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
});

/** What a POST to the route answers. Swapped per test. */
let onPost: (body: any) => Promise<any>;
/** What the catalogue GET answers. Swapped per test. */
let catalogueBody: unknown;
/** Every url authFetch was handed, in order. */
let calls: string[];

let container: HTMLDivElement;
let root: Root;

async function mount() {
  await act(async () => {
    root = createRoot(container);
    root.render(<AddOnsSection tenantId={TENANT} processor="dodo" />);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function click(el: Element) {
  await act(async () => {
    (el as HTMLButtonElement).click();
  });
}

/** The card for an add-on, found by the name printed on it. */
function cardFor(label: string): HTMLLIElement {
  const card = Array.from(container.querySelectorAll('li')).find(
    (li) => (li.querySelector('p')?.textContent || '').trim() === label,
  );
  if (!card) throw new Error(`No card titled "${label}"`);
  return card as HTMLLIElement;
}

function hasCard(label: string): boolean {
  return Array.from(container.querySelectorAll('li')).some(
    (li) => (li.querySelector('p')?.textContent || '').trim() === label,
  );
}

const plus = (label: string) => cardFor(label).querySelector(`[aria-label="Add one ${label}"]`)!;
const minus = (label: string) => cardFor(label).querySelector(`[aria-label="Remove one ${label}"]`)!;

/** What the stepper is SET TO: the value between its two labelled buttons. */
function stepperValue(label: string): string {
  return (plus(label).previousElementSibling?.textContent || '').trim();
}

/** The commit button — the one that is neither a stepper nor the retry link. */
function commitButton(label: string): HTMLButtonElement | undefined {
  return Array.from(cardFor(label).querySelectorAll('button')).find(
    (b) => !b.getAttribute('aria-label') && (b.textContent || '').trim() !== 'Try again',
  );
}

const commitCopy = (label: string) => (commitButton(label)?.textContent || '').trim();

// ── Source scans, for the properties that are ABSENCES ───────────────────────

const COMPONENT = resolve(__dirname, '../AddOnsSection.tsx');
/** Comments stripped: stating a rule is what a docblock is for. */
const source = () =>
  readFileSync(COMPONENT, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

/** globals.css's dark block, brace-matched so nothing after it is counted. */
function darkThemeBlock(): string {
  const css = readFileSync(resolve(__dirname, '../../../app/globals.css'), 'utf8');
  const open = css.indexOf('{', css.indexOf('[data-theme="dark"]'));
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}' && (depth -= 1) === 0) return css.slice(open, i);
  }
  throw new Error('globals.css: the dark block is not closed');
}

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  catalogueBody = { billing: 'yearly', plan: 'max', addons: OFFERED };
  onPost = async () => reply({ preview: { amountDueNow: 9412, creditMovement: 0, currency: 'USD' } });
  tenantValue.current = {
    tenantAddons: owns(),
    planFeatures: getEffectiveFeatures('max', owns()),
    refreshTenantAddons: vi.fn(),
  };
  mockAuthFetch.mockImplementation(async (url: string, options?: RequestInit) => {
    calls.push(url);
    if (options?.method !== 'POST') return reply(catalogueBody);
    return onPost(JSON.parse(String(options.body)));
  });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ── 1 ────────────────────────────────────────────────────────────────────────

describe('every price shows its billing period', () => {
  it('states the period beside every figure on an annual subscription', async () => {
    await mount();
    // Nothing is pending, so every $ on screen is a recurring price — and a
    // recurring price without its period is the leak this pins shut.
    const quoted = (container.textContent || '').match(/\$[\d,]+(?:\.\d{2})?(?:\/(?:year|month))?/g);
    expect(quoted, 'no price rendered at all').not.toBeNull();
    for (const money of quoted || []) {
      expect(money, `"${money}" is quoted with no period`).toMatch(/\/(?:year|month)$/);
    }
    expect(cardFor('AI Assistant').textContent).toContain('$228/year');
    // Never the transaction-shaped form beside an add-on.
    expect(container.textContent).not.toContain('$228.00');
  });

  it('states the MONTHLY period for a monthly church, from the same data', async () => {
    // 🔴 The period is the tenant's own, resolved server-side and returned by
    // the catalogue read — not a constant this component picked.
    catalogueBody = {
      billing: 'monthly',
      plan: 'max',
      addons: [{ addon: 'aiAssistant', name: 'AI Assistant', priceMinorUnits: 1900, currency: 'USD' }],
    };
    await mount();
    expect(cardFor('AI Assistant').textContent).toContain('$19/month');
    expect(container.textContent).not.toContain('/year');
  });

  it('says "each" only where a quantity is being counted', async () => {
    await mount();
    expect(cardFor('Admin Seat').textContent).toContain('$120/year each');
    // Holding Unlimited Contacts at all is the whole fact; there is no "each".
    expect(cardFor('Unlimited Contacts').textContent).not.toContain('each');
  });
});

// ── 2 ────────────────────────────────────────────────────────────────────────

describe('no price literal appears in the component', () => {
  it('writes no money figure, and no period word, of its own', async () => {
    const code = source();
    // 🔴 The guarantee the docblock has always claimed, kept as this file grew a
    // period, a preview and a button that quotes both.
    expect(code, 'a money figure is written here').not.toMatch(/\$\s*\d/);
    expect(code, 'a billing period is written here').not.toMatch(/['"`][^'"`]*\/(?:year|month)/);
    expect(code, 'a period is chosen here rather than read').not.toMatch(/\b(?:monthly|yearly)\b/);
  });

  it('formats through the shared helpers and performs no arithmetic on a price', async () => {
    const code = source();
    expect(code).toContain('formatAddonPrice');
    expect(code).toContain('formatAddonAmount');
    expect(code).toContain('priceMinorUnits');
    expect(code).not.toMatch(/priceMinorUnits\s*[*+\-/]/);
    expect(code).not.toMatch(/amountDueNow\s*[*+\-/]/);
  });
});

// ── 3 ────────────────────────────────────────────────────────────────────────

describe('owned quantity renders separately from the pending change', () => {
  it('keeps the badge on what they hold while the stepper moves', async () => {
    tenantValue.current.tenantAddons = owns({ adminSeats: 2 });
    await mount();

    expect(cardFor('Admin Seat').textContent).toContain('2 owned');
    expect(stepperValue('Admin Seat')).toBe('2');

    await click(plus('Admin Seat'));
    await click(plus('Admin Seat'));

    // One number said both things before REP-5d. Now the badge is what the
    // church holds and the stepper is what it is changing to.
    expect(stepperValue('Admin Seat')).toBe('4');
    expect(cardFor('Admin Seat').textContent).toContain('2 owned');
    expect(cardFor('Admin Seat').textContent).not.toContain('4 owned');
  });

  it('shows no owned badge for something they do not hold', async () => {
    await mount();
    expect(cardFor('Admin Seat').textContent).not.toContain('owned');
  });
});

// ── 4 ────────────────────────────────────────────────────────────────────────

describe('the contacts card shows the resulting total', () => {
  it('states what the packs add up to, from getEffectiveFeatures', async () => {
    const held = owns({ contactPacks: 1 });
    tenantValue.current.tenantAddons = held;
    tenantValue.current.planFeatures = getEffectiveFeatures('max', held);
    await mount();

    // 🔴 Asserted against the REAL layering function, never a literal: a church
    // checks its contact list against this number.
    const total = getEffectiveFeatures('max', held).maxContacts.toLocaleString();
    expect(cardFor('Contacts +500').textContent).toContain(`1 owned · ${total} total`);
  });

  it('does not quote a finite total to a church that holds Unlimited Contacts', async () => {
    const held = owns({ contactPacks: 1, unlimitedContacts: true });
    tenantValue.current.tenantAddons = held;
    tenantValue.current.planFeatures = getEffectiveFeatures('max', held);
    await mount();

    expect(cardFor('Contacts +500').textContent).toContain('1 owned · unlimited total');
  });

  it('leaves the count alone on the add-ons that are not capacity', async () => {
    tenantValue.current.tenantAddons = owns({ adminSeats: 3 });
    await mount();
    expect(cardFor('Admin Seat').textContent).toContain('3 owned');
    expect(cardFor('Admin Seat').textContent).not.toContain('total');
  });
});

// ── 5 ────────────────────────────────────────────────────────────────────────

describe('the button states the amount it will charge', () => {
  it('quotes the prorated amount due now and the price it then recurs at', async () => {
    await mount();
    await click(plus('AI Assistant'));
    await advance(500);

    expect(commitCopy('AI Assistant')).toBe('Add 1 — $94.12 today, then $228/year');
    expect(commitButton('AI Assistant')!.disabled).toBe(false);
  });

  it('says so plainly when the proration comes to nothing today', async () => {
    onPost = async () => reply({ preview: { amountDueNow: 0, creditMovement: 4200, currency: 'USD' } });
    await mount();
    await click(plus('AI Assistant'));
    await advance(500);

    expect(commitCopy('AI Assistant')).toBe('Add 1 — no charge today, then $228/year');
  });

  it('names a removal as a removal, and quotes no ongoing price for it', async () => {
    tenantValue.current.tenantAddons = owns({ adminSeats: 2 });
    onPost = async () => reply({ preview: { amountDueNow: 0, creditMovement: 6000, currency: 'USD' } });
    await mount();
    await click(minus('Admin Seat'));
    await advance(500);

    // "then $120/year" on a removal would name a price they are about to stop
    // paying.
    expect(commitCopy('Admin Seat')).toBe('Remove 1 — no charge today');
  });

  it('offers nothing at all while the stepper still says what they hold', async () => {
    tenantValue.current.tenantAddons = owns({ adminSeats: 2 });
    await mount();
    expect(commitButton('Admin Seat')).toBeUndefined();

    await click(plus('Admin Seat'));
    await click(minus('Admin Seat'));
    expect(commitButton('Admin Seat')).toBeUndefined();
  });
});

// ── 6 ────────────────────────────────────────────────────────────────────────

describe('a preview is requested when the quantity changes', () => {
  it('asks the route for the amount, and asks it to charge nothing', async () => {
    const bodies: any[] = [];
    onPost = async (body) => {
      bodies.push(body);
      return reply({ preview: { amountDueNow: 9412, creditMovement: 0, currency: 'USD' } });
    };
    await mount();
    await click(plus('AI Assistant'));
    await advance(500);

    expect(bodies).toHaveLength(1);
    expect(bodies[0].addons).toEqual([{ addon: 'aiAssistant', quantity: 1 }]);
    // 🔴 Without `confirm`, so nothing is billed by looking at a price.
    expect(bodies[0].confirm).toBeUndefined();
  });

  it('asks again when the quantity moves again', async () => {
    const quantities: number[] = [];
    onPost = async (body) => {
      quantities.push(body.addons[0].quantity);
      return reply({ preview: { amountDueNow: 9412, creditMovement: 0, currency: 'USD' } });
    };
    await mount();
    await click(plus('AI Assistant'));
    await advance(500);
    await click(plus('AI Assistant'));
    await advance(500);

    expect(quantities).toEqual([1, 2]);
  });
});

// ── 7 ────────────────────────────────────────────────────────────────────────

describe('rapid quantity changes do not fire a preview per press', () => {
  it('previews once for a burst of presses, at the quantity it settled on', async () => {
    // 🔴 THE-139's 429, on a stepper. The `api` limiter is 60 requests per
    // minute per IP, and the surface that spends it strips the admin nav for
    // everyone on that address.
    const quantities: number[] = [];
    onPost = async (body) => {
      quantities.push(body.addons[0].quantity);
      return reply({ preview: { amountDueNow: 9412, creditMovement: 0, currency: 'USD' } });
    };
    await mount();

    for (let press = 0; press < 8; press += 1) {
      await click(plus('AI Assistant'));
      await advance(40);
    }
    expect(quantities, 'a Dodo preview fired mid-burst').toEqual([]);

    await advance(500);
    expect(quantities).toEqual([8]);
  });

  it('offers no amount at all until the burst has settled', async () => {
    await mount();
    await click(plus('AI Assistant'));
    await advance(40);
    await click(plus('AI Assistant'));

    expect(commitCopy('AI Assistant')).toBe('Add 2 — working out the cost…');
    expect(commitButton('AI Assistant')!.disabled).toBe(true);
  });
});

// ── 8 ────────────────────────────────────────────────────────────────────────

describe('a preview that arrives after another change is not offered', () => {
  it('never puts an overtaken amount on the button', async () => {
    const settle: Record<number, (value: any) => void> = {};
    onPost = (body) =>
      new Promise((res) => {
        settle[body.addons[0].quantity] = res;
      });

    await mount();
    await click(plus('AI Assistant'));   // → 1
    await advance(500);                  // preview for 1 is in flight
    await click(plus('AI Assistant'));   // → 2, before it answered

    // The amount for 1 is no longer the amount for what is on screen.
    expect(commitCopy('AI Assistant')).toBe('Add 2 — working out the cost…');

    await act(async () => {
      settle[1](reply({ preview: { amountDueNow: 9412, creditMovement: 0, currency: 'USD' } }));
    });

    // 🔴 The straggler lands and changes nothing: the button still offers no
    // figure, because no figure has been computed for a quantity of 2.
    expect(commitCopy('AI Assistant')).toBe('Add 2 — working out the cost…');
    expect(commitCopy('AI Assistant')).not.toContain('$94.12');
    expect(commitButton('AI Assistant')!.disabled).toBe(true);

    // And when the right one answers, it is offered.
    await advance(500);
    await act(async () => {
      settle[2](reply({ preview: { amountDueNow: 18824, creditMovement: 0, currency: 'USD' } }));
    });
    expect(commitCopy('AI Assistant')).toBe('Add 2 — $188.24 today, then $228/year');
  });

  it('drops the amount the instant the quantity moves off it', async () => {
    await mount();
    await click(plus('AI Assistant'));
    await advance(500);
    expect(commitCopy('AI Assistant')).toContain('$94.12');

    await click(plus('AI Assistant'));
    // Before the debounce has even elapsed, let alone a reply.
    expect(commitCopy('AI Assistant')).toBe('Add 2 — working out the cost…');
  });
});

// ── 9 ────────────────────────────────────────────────────────────────────────

describe('a failed preview never falls back to the sticker price', () => {
  it('says the amount could not be worked out, and offers no figure', async () => {
    onPost = async () => reply({ error: 'We could not describe those add-ons just now, so nothing was changed. Please try again in a few minutes.' }, false, 503);
    await mount();
    await click(plus('AI Assistant'));
    await advance(500);

    const button = commitButton('AI Assistant')!;
    expect(button.textContent).toBe('Add 1 — cost unavailable');
    // 🔴 The whole point: no money figure of any kind reaches the button. The
    // recurring price is not what this change costs today.
    expect(button.textContent).not.toContain('$');
    expect(button.disabled).toBe(true);
    expect(cardFor('AI Assistant').textContent).toContain('so nothing was changed');
  });

  it('offers no figure when the route answers with no amount in it', async () => {
    // A 200 with nothing readable in it is not "no charge".
    onPost = async () => reply({ preview: { currency: 'USD' } });
    await mount();
    await click(plus('AI Assistant'));
    await advance(500);

    const button = commitButton('AI Assistant')!;
    expect(button.textContent).toBe('Add 1 — cost unavailable');
    expect(button.disabled).toBe(true);
    expect(cardFor('AI Assistant').textContent).toContain('could not work out what this change costs');
  });

  it('asks again on Try again, and offers the amount once it has one', async () => {
    onPost = async () => reply({ error: 'nope' }, false, 503);
    await mount();
    await click(plus('AI Assistant'));
    await advance(500);

    onPost = async () => reply({ preview: { amountDueNow: 9412, creditMovement: 0, currency: 'USD' } });
    const retry = Array.from(cardFor('AI Assistant').querySelectorAll('button')).find(
      (b) => (b.textContent || '').trim() === 'Try again',
    )!;
    await click(retry);

    expect(commitCopy('AI Assistant')).toBe('Add 1 — $94.12 today, then $228/year');
  });
});

// ── 10 ───────────────────────────────────────────────────────────────────────

describe('unlimited contacts renders one button and no stepper', () => {
  it('offers one full-width purchase at the price, with no counter', async () => {
    await mount();
    const card = cardFor('Unlimited Contacts');
    const buttons = Array.from(card.querySelectorAll('button'));

    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe('Add for $708/year');
    expect(card.querySelector('[aria-label="Add one Unlimited Contacts"]')).toBeNull();
    expect(card.querySelector('[aria-label="Remove one Unlimited Contacts"]')).toBeNull();
  });

  it('offers one removal, and no counter, once it is held', async () => {
    tenantValue.current.tenantAddons = owns({ unlimitedContacts: true });
    await mount();
    const card = cardFor('Unlimited Contacts');
    const buttons = Array.from(card.querySelectorAll('button'));

    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe('Remove');
    expect(card.textContent).toContain('Active');
  });
});

// ── 11 ───────────────────────────────────────────────────────────────────────

describe('an add-on missing from the offerable set renders disabled, by data not by name', () => {
  it('shows what the server did not offer, disabled and uncontrollable', async () => {
    await mount();
    const card = cardFor('Campus');

    expect(card.textContent).toContain('Not available yet');
    expect(card.querySelectorAll('button')).toHaveLength(0);
  });

  it('disables whichever add-on is absent — the rule is the set, not the word', async () => {
    // 🔴 The same catalogue with Campus present and Admin Seat missing must
    // disable Admin Seat and offer Campus. A component that knew the word
    // "Campus" would get this backwards, and would still be disabling Campus
    // the day its two live ids are filled in.
    catalogueBody = {
      billing: 'yearly',
      plan: 'max',
      addons: [
        ...OFFERED.filter((offer) => offer.addon !== 'adminSeat'),
        { addon: 'campus', name: 'Additional Campus', priceMinorUnits: 18000, currency: 'USD' },
      ],
    };
    await mount();

    expect(cardFor('Additional Campus').textContent).toContain('$180/year');
    expect(cardFor('Additional Campus').querySelector('[aria-label="Add one Additional Campus"]')).not.toBeNull();
    expect(cardFor('Admin Seat').textContent).toContain('Not available yet');
    expect(cardFor('Admin Seat').querySelectorAll('button')).toHaveLength(0);
    expect(hasCard('Campus')).toBe(false);
  });

  it('renders no disabled cards at all when the catalogue could not be read', async () => {
    // An outage is not a product statement. Five "Not available yet" cards
    // would tell a church nothing is for sale when the truth is we could not
    // ask.
    mockAuthFetch.mockImplementation(async (url: string) => {
      calls.push(url);
      return reply({ error: 'We could not load the available add-ons just now.' }, false, 503);
    });
    await mount();

    expect(container.textContent).toContain('could not load the available add-ons');
    expect(container.textContent).not.toContain('Not available yet');
    expect(container.querySelectorAll('li')).toHaveLength(0);
  });
});

// ── 12 ───────────────────────────────────────────────────────────────────────

describe('a trial refusal shows the copy the route returned', () => {
  const TRIAL_COPY =
    'Your free trial is still running. Adding or removing an add-on now would end the trial early and charge you for your whole plan today, not just the add-on — so add-on changes are disabled until the trial ends. You can make this change on March 4, 2026.';

  it('surfaces the refusal verbatim and offers no amount', async () => {
    onPost = async () =>
      reply({ error: TRIAL_COPY, code: 'addon-change-unavailable-during-trial' }, false, 409);
    await mount();
    await click(plus('Admin Seat'));
    await advance(500);

    // 🔴 The route's own words. The refusal names the day they can come back;
    // nothing here restates, shortens or improves it.
    expect(cardFor('Admin Seat').textContent).toContain(TRIAL_COPY);
    expect(commitButton('Admin Seat')!.textContent).toBe('Add 1 — cost unavailable');
    expect(commitButton('Admin Seat')!.disabled).toBe(true);
  });

  it('refuses a removal during the trial in the same words', async () => {
    tenantValue.current.tenantAddons = owns({ adminSeats: 2 });
    onPost = async () =>
      reply({ error: TRIAL_COPY, code: 'addon-change-unavailable-during-trial' }, false, 409);
    await mount();
    await click(minus('Admin Seat'));
    await advance(500);

    expect(cardFor('Admin Seat').textContent).toContain(TRIAL_COPY);
    expect(commitButton('Admin Seat')!.textContent).toBe('Remove 1 — cost unavailable');
  });
});

// ── 13 ───────────────────────────────────────────────────────────────────────

describe('the owned set comes from the tenant document, not a second fetch', () => {
  it('reads what they hold off the context, and asks nothing for it', async () => {
    tenantValue.current.tenantAddons = owns({ adminSeats: 4, contactPacks: 2 });
    tenantValue.current.planFeatures = getEffectiveFeatures('max', owns({ adminSeats: 4, contactPacks: 2 }));
    await mount();

    expect(cardFor('Admin Seat').textContent).toContain('4 owned');
    // 🔴 One call, and it is the catalogue. A second read of the add-on set
    // could disagree with the caps every other screen renders from.
    expect(calls).toEqual([`/api/dodo/addons?tenantId=${TENANT}`]);
  });

  it('names no other endpoint, and no other source for what is held', async () => {
    const code = source();
    expect(code).toContain('tenant?.tenantAddons');
    expect(code).toContain('fetchOfferableAddons');
    // The only endpoint reached from here is the add-ons route, through the
    // shared helpers — there is no fetch of a tenant document in this file.
    expect(code).not.toMatch(/fetch\(|getDoc|collection\(/);
    expect(code).toContain('refreshTenantAddons');
  });
});

// ── 14 ───────────────────────────────────────────────────────────────────────

describe('no colour is hardcoded', () => {
  it('spells every colour as a theme token', async () => {
    const code = source();
    // 🔴 THE-136 has desktop dark mode broken on inputs and list items, and a
    // card full of controls is both. A literal here is a card that is only
    // right in one theme.
    expect(code, 'a hex colour is written here').not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code, 'a colour function is written here').not.toMatch(/\b(?:rgba?|hsla?)\(/);
    expect(code, 'an arbitrary colour value is written here').not.toMatch(
      /(?:bg|text|border|fill|stroke|ring|shadow|from|to|via)-\[(?:#|rgb|hsl|color)/,
    );
    expect(code, 'a colour is applied inline, outside the theme').not.toMatch(
      /style=\{\{[^}]*(?:color|background)/i,
    );
  });

  it('uses the surface, line and ink tokens the rest of the file already uses', async () => {
    const code = source();
    for (const token of ['bg-surface-tint', 'border-line', 'text-strong', 'text-muted', 'text-gold']) {
      expect(code, `${token} is not used`).toContain(token);
    }
  });

  it('renders the cards on the tokened surface, not a literal one', async () => {
    await mount();
    const card = cardFor('Admin Seat');
    expect(card.className).toContain('bg-surface-tint');
    expect(card.className).toContain('border-line');
    expect(card.getAttribute('style')).toBeNull();
  });

  it('every colour it spells has a value in the dark theme', () => {
    /**
     * 🔴 THE DARK-MODE CHECK, as a property rather than a look.
     *
     * THE-136 is desktop dark mode broken on inputs and list items, and a card
     * of controls is both — so "it looked fine" is not the standard. What
     * actually breaks a surface in dark is spelling a colour that the dark block
     * never overrides: the class resolves, the page renders, and one theme is
     * quietly wrong. Every colour class in this file is resolved through the
     * REAL Tailwind config to the custom properties behind it, and each of those
     * is required to appear in globals.css's dark block.
     */
    const palette = (tailwind as any).theme.extend.colors;
    const inks = (tailwind as any).theme.extend.textColor;

    const lookup = (bag: any, path: string[]): string | undefined => {
      let node = bag;
      for (const key of path) {
        if (!node || typeof node !== 'object') return undefined;
        node = node[key];
      }
      if (node && typeof node === 'object') node = node.DEFAULT;
      return typeof node === 'string' ? node : undefined;
    };

    /** The custom properties one class resolves to, or null if it is not a colour. */
    const propertiesFor = (cls: string): string[] | null => {
      const parsed = /^(bg|text|border)-(.+)$/.exec(cls);
      if (!parsed) return null;
      const path = parsed[2].split('-');
      const value =
        parsed[1] === 'text' ? lookup(inks, path) ?? lookup(palette, path) : lookup(palette, path);
      return value ? value.match(/--[\w-]+/g) : null;
    };

    const spelled = (source().match(/(?:hover:|focus:|active:|disabled:)?(?:bg|text|border)-[a-z0-9-]+/g) || [])
      .map((cls) => cls.replace(/^[a-z]+:/, ''));
    const properties = new Set(spelled.flatMap((cls) => propertiesFor(cls) || []));

    // 🔒 --brand-color is the ONE property globals.css deliberately does not
    // override in dark: the accent is tenant-injected and the neutral ramp
    // stays fixed in both themes. Named here rather than silently skipped.
    properties.delete('--brand-color');

    // A scan that matched nothing would pass this test while proving nothing.
    expect(properties.size).toBeGreaterThan(5);

    const dark = darkThemeBlock();
    for (const property of properties) {
      expect(dark, `${property} has no dark value`).toContain(`${property}:`);
    }
  });
});
