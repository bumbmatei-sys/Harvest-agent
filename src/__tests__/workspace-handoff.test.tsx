import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'fs';
import path from 'path';
import WorkspaceHandoff from '../components/WorkspaceHandoff';
import OnboardingGate from '../components/OnboardingGate';
import { PREAUTH_PATHS } from '../lib/preauth-theme';
import { THEME_STORAGE_KEY } from '../lib/theme';
import { getTenantIdFromHost } from '../utils/tenant-scope';

/**
 * THE-86 part 1 — the screen between paying and the new workspace.
 *
 * A church pays on `theharvest.app`; their workspace lives on
 * `<tenant>.theharvest.app`. Firebase Auth persistence is origin-scoped, so the
 * subdomain genuinely cannot see the apex session — that cause is real, is NOT
 * fixed here, and must not be "fixed" by widening storage or cookie scope on an
 * origin that also serves the admin app. What this screen adds is the
 * explanation, and the guard that stops us handing a paying customer a
 * subdomain that does not resolve yet.
 *
 * The numbered tests below map 1:1 to the acceptance list on the ticket.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC = path.join(process.cwd(), 'src');
const HANDOFF_SRC = readFileSync(path.join(SRC, 'components/WorkspaceHandoff.tsx'), 'utf8');

/** Mirrors the constant in the component — the poll cadence the guard uses. */
const POLL_INTERVAL_MS = 2000;
/** Mirrors the component: ~2.5x the measured 70s production provisioning gap. */
const STALLED_AFTER_MS = 180000;

const getDoc = vi.hoisted(() => vi.fn());
const getIdToken = vi.hoisted(() => vi.fn(async () => 'token'));
const checkRosterAdmin = vi.hoisted(() => vi.fn(async () => false));
/** Live onSnapshot callbacks, keyed by the document path they were opened on. */
const listeners = vi.hoisted(() => new Map<string, (snap: unknown) => void>());
/** The onAuthStateChanged callback OnboardingGate registered. */
const authCallbacks = vi.hoisted(() => [] as Array<(user: unknown) => void>);

vi.mock('../firebase', () => ({ db: {}, auth: { currentUser: null } }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  getDoc,
  onSnapshot: (ref: { path: string }, next: (snap: unknown) => void) => {
    listeners.set(ref.path, next);
    return () => { listeners.delete(ref.path); };
  },
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, cb: (user: unknown) => void) => {
    authCallbacks.push(cb);
    return () => { /* noop */ };
  },
  getIdToken,
}));

vi.mock('../utils/tenant.utils', () => ({ checkRosterAdmin }));

// ⚠️ `../utils/tenant-scope` and `../utils/super-admins` are deliberately NOT
// mocked. The same-origin branch is decided by the real `getTenantIdFromHost()`,
// so these tests move the actual host and let the real resolver run — mocking it
// and then asserting on its own output would prove nothing about the branch.
/** Point the document at a real host and let the shared resolver read it. */
const setHost = (url: string) => {
  (window as unknown as { happyDOM: { setURL: (u: string) => void } }).happyDOM.setURL(url);
};

// Stands in for the real first-run screen so the test can fire the exact
// callback that used to hard-redirect to the subdomain.
vi.mock('../components/FirstRunSetup', () => ({
  default: ({ onFinished }: { onFinished: (id: string) => void }) => (
    <button onClick={() => onFinished('gracechurch')}>finish setup</button>
  ),
}));

let container: HTMLDivElement;
let root: Root | null = null;

const flush = async () => {
  await act(async () => {
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
};

/** A tenant document that exists — i.e. the subdomain will resolve. */
const provisioned = (name = 'Grace Community Church') => ({
  exists: () => true,
  data: () => ({ name }),
});
/** Provisioning has not landed yet — the webhook is still working. */
const notProvisioned = () => ({ exists: () => false });

const render = (ui: React.ReactElement) => {
  act(() => {
    root = createRoot(container);
    root.render(ui);
  });
};

const text = () => container.textContent || '';
/** Everything on the screen a user could actually click. */
const actionables = () => Array.from(container.querySelectorAll('a, button'));
/** The single "take me there" action, if the guard has released it. */
const continueLink = () =>
  Array.from(container.querySelectorAll('a')).find((a) =>
    (a.getAttribute('href') || '').startsWith('https://gracechurch.theharvest.app'),
  ) || null;

beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
  authCallbacks.length = 0;
  localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-theme');
  // Default every test to the apex, where the resolver returns null and the
  // destination is therefore a different origin — the primary path.
  setHost('https://theharvest.app/');
  getDoc.mockResolvedValue(provisioned());
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container.remove();
  vi.useRealTimers();
});

/* ── 1 ─────────────────────────────────────────────────────────────────────── */

describe('1 — it states the payment succeeded, and names the ministry', () => {
  it('says the payment went through', async () => {
    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await flush();

    // 🔴 The sentence the customer is actually looking for. Someone who has just
    // been charged and is then shown a login prompt is asking "did my payment go
    // through" — this screen answers it in words, not by implication.
    expect(text()).toContain('Your payment went through.');
  });

  it('names the ministry, read from the tenant document that was created', async () => {
    getDoc.mockResolvedValue(provisioned('Grace Community Church'));
    render(<WorkspaceHandoff tenantId="gracechurch" fallbackMinistryName="ignored fallback" />);
    await flush();

    // Sourced from the real tenant doc, not from the local signup marker — that
    // is what makes it evidence the right thing was created.
    expect(text()).toContain('Grace Community Church');
    expect(text()).not.toContain('ignored fallback');
  });

  it('still confirms the payment while the workspace is not ready yet', async () => {
    getDoc.mockResolvedValue(notProvisioned());
    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await flush();

    // The charge succeeded whether or not provisioning has finished, so the
    // reassurance must NOT be gated on readiness — only the action is.
    expect(text()).toContain('Your payment went through.');
  });
});

/* ── 2 ─────────────────────────────────────────────────────────────────────── */

describe('2 — it names the destination and explains the second sign-in', () => {
  it('shows the address the workspace lives at', async () => {
    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await flush();
    expect(text()).toContain('gracechurch.theharvest.app');
  });

  it('says the second sign-in is expected, not a failure', async () => {
    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await flush();

    const copy = text();
    expect(copy).toContain('sign in once more');
    expect(copy).toContain('expected');
    // The reason must be the address, not something having gone wrong.
    expect(copy).toContain('own web address');
    expect(copy).toContain('nothing was lost');
  });
});

/* ── 3 — the 70-second guard ───────────────────────────────────────────────── */

describe('3 — while provisioning is incomplete it does not send the user onward', () => {
  it('renders no link to the subdomain while the tenant does not exist', async () => {
    getDoc.mockResolvedValue(notProvisioned());
    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await flush();

    // 🔴 THE GUARD. Tenant creation is asynchronous (the payment webhook does
    // it; measured ~70s on the first production signup). Offering the
    // destination before it resolves would send a church that has just paid to
    // "Organization Not Found" — worse than making them wait with an
    // explanation.
    expect(continueLink(), 'the subdomain was offered before it resolves').toBeNull();
    // And no other escape hatch to the subdomain either.
    expect(
      actionables().some((el) => (el.getAttribute('href') || '').includes('theharvest.app')),
    ).toBe(false);
  });

  it('says what it is doing instead of just spinning', async () => {
    getDoc.mockResolvedValue(notProvisioned());
    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await flush();

    expect(text()).toContain('Preparing your workspace');
    expect(text()).toContain('as soon as it');
  });

  it('keeps waiting through a transient read failure rather than declaring it broken', async () => {
    vi.useFakeTimers();
    getDoc.mockRejectedValueOnce(new Error('network'));
    getDoc.mockResolvedValue(notProvisioned());

    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2); });

    // A failed read is not evidence a paid account is missing.
    expect(continueLink()).toBeNull();
    expect(text()).toContain('Preparing your workspace');
  });

  it('offers support — and never a payment — once provisioning is genuinely stuck', async () => {
    vi.useFakeTimers();
    getDoc.mockResolvedValue(notProvisioned());

    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(STALLED_AFTER_MS + POLL_INTERVAL_MS); });

    expect(text()).toContain('taking longer than usual');
    expect(text()).toContain('nothing to pay again');
    const contact = Array.from(container.querySelectorAll('a')).find((a) =>
      a.getAttribute('href') === 'https://theharvest.site/contact',
    );
    expect(contact, 'a stuck signup was left with no way to reach a human').toBeTruthy();
    // Still never the broken destination.
    expect(continueLink()).toBeNull();
  });
});

/* ── 4 ─────────────────────────────────────────────────────────────────────── */

describe('4 — once provisioning completes, the action becomes available', () => {
  it('offers the destination when the tenant document exists', async () => {
    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await flush();

    const link = continueLink();
    expect(link, 'the workspace resolved but no action was offered').toBeTruthy();
    expect(link!.getAttribute('href')).toBe('https://gracechurch.theharvest.app/admin');
  });

  it('releases the guard when provisioning lands mid-wait', async () => {
    vi.useFakeTimers();
    getDoc.mockResolvedValueOnce(notProvisioned());
    getDoc.mockResolvedValue(provisioned());

    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // Held while the webhook is still working…
    expect(continueLink(), 'the guard never held').toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); });

    // …released the moment the workspace actually exists.
    expect(continueLink(), 'the guard never released').toBeTruthy();
  });

  it('offers exactly one action — not a choice of them', async () => {
    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await flush();
    expect(actionables()).toHaveLength(1);
  });
});

/* ── 5 ─────────────────────────────────────────────────────────────────────── */

describe('5 — no path on this screen can initiate a second payment', () => {
  /**
   * ⚠️ Everyone who reaches this screen has ALREADY been charged. A "try
   * payment again" affordance here is a double charge, and a church that is
   * charged twice on signup is exactly the chargeback this work exists to
   * prevent. Asserted as an ABSENCE, in every state the screen can be in.
   */
  const PAY_ACTION = /pay now|pay again|try again|retry payment|complete your payment|checkout|billing|card details|subscribe/i;

  it('the ready state exposes only the workspace link', async () => {
    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await flush();

    for (const el of actionables()) {
      expect(el.textContent || '', 'a payment action appeared post-charge').not.toMatch(PAY_ACTION);
      expect(el.getAttribute('href')).toBe('https://gracechurch.theharvest.app/admin');
    }
  });

  it('the waiting state exposes no action at all', async () => {
    getDoc.mockResolvedValue(notProvisioned());
    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await flush();
    expect(actionables()).toHaveLength(0);
  });

  it('the stuck state offers support only — never a payment', async () => {
    vi.useFakeTimers();
    getDoc.mockResolvedValue(notProvisioned());

    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(STALLED_AFTER_MS + POLL_INTERVAL_MS); });

    const els = actionables();
    expect(els).toHaveLength(1);
    expect(els[0].getAttribute('href')).toBe('https://theharvest.site/contact');
    expect(els[0].textContent || '').not.toMatch(PAY_ACTION);
  });

  it('the component cannot reach a checkout endpoint at all', () => {
    // Structural, not cosmetic: with no import of the signup-checkout module and
    // no processor route in the file, no future edit can wire a charge in here
    // without this failing first.
    expect(HANDOFF_SRC).not.toContain('signup-checkout');
    expect(HANDOFF_SRC).not.toContain('SIGNUP_CHECKOUT_ENDPOINT');
    expect(HANDOFF_SRC).not.toMatch(/\/api\/(dodo|stripe)\/[a-z-]*checkout/);
  });
});

/* ── 6 ─────────────────────────────────────────────────────────────────────── */

describe('6 — it renders in light mode (#297)', () => {
  it('forces light even when the stored preference is dark', async () => {
    // The state THE-85 reported: a dark-mode preference leaking onto a screen a
    // prospective customer sees before they have a working account.
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    document.documentElement.classList.add('dark');
    document.documentElement.setAttribute('data-theme', 'dark');

    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await flush();

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('declares itself rather than relying on a route (no PREAUTH_PATHS entry added)', () => {
    // 🔴 The decision #297 asked for. This screen was NOT given a route: it
    // renders at "/" like every other screen this gate owns, and is only
    // identifiable after an async Firestore read, so the URL cannot classify it
    // — exactly the case preauth-theme.ts documents as belonging to
    // `useForcedLightTheme` instead of PREAUTH_PATHS. If it ever gains a path,
    // this assertion is the reminder that the path list must gain it too.
    expect(PREAUTH_PATHS).toEqual(['/auth', '/onboarding', '/church-onboarding']);
    expect(HANDOFF_SRC).toContain('useForcedLightTheme(true)');
  });

  it('restores the stored preference when it unmounts', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await flush();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    act(() => { root?.unmount(); root = null; });

    // The force changes what is rendered, never what is remembered.
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});

/* ── 7 ─────────────────────────────────────────────────────────────────────── */

describe('7 — no plan, price or trial length that was not read from real data', () => {
  /**
   * ⚠️ The trial is 14 days in Dodo and 7 in the app's copy. That mismatch is
   * part 4's job; restating either number here would make this a THIRD place to
   * be wrong about it — on the one screen where the customer is actively
   * thinking about what they were just charged.
   */
  it('names no trial, price or renewal date', async () => {
    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await flush();

    const copy = text();
    expect(copy).not.toMatch(/trial/i);
    expect(copy).not.toMatch(/\d+[\s-]?days?\b/i);
    expect(copy).not.toMatch(/[$€£]\s?\d/);
    expect(copy).not.toMatch(/per (month|year)|monthly|yearly|annually|\/mo\b/i);
    expect(copy).not.toMatch(/renew|next payment|billed/i);
  });

  it('names no plan tier', async () => {
    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await flush();

    // 'Individual' and 'Small Team' are the PLAN_DISPLAY_NAMES that are not also
    // ordinary words. ('Ministry' is, so it is checked structurally below.)
    expect(text()).not.toMatch(/Individual|Small Team/);
  });

  it('cannot read a plan, price or trial constant at all', () => {
    // Structural guard behind the copy assertions: no import of the plan matrix
    // or the billing catalogue means no tier name, price or trial length can
    // reach this screen even if the copy is rewritten later.
    expect(HANDOFF_SRC).not.toContain('plan-features');
    expect(HANDOFF_SRC).not.toContain('PLAN_DISPLAY_NAMES');
    expect(HANDOFF_SRC).not.toContain('catalogue');
    expect(HANDOFF_SRC).not.toMatch(/\btrialDays\b/);
  });
});

/* ── 8 ─────────────────────────────────────────────────────────────────────── */

describe('8 — on the origin the workspace already lives on, it does not claim a second sign-in', () => {
  /**
   * This state is reachable, and both halves of it are already in the tree.
   *
   * `App.tsx`'s auth callback (lines 266–299) hard-redirects apex → subdomain
   * once the user doc has `onboardingCompleted: true` — which the payment
   * webhook sets when it provisions (`provisioning.ts` also writes
   * `role: 'admin'`, so the `hasAdminRole` half of that condition is satisfied
   * too). A reload at "/" after provisioning but before first-run setup is done
   * therefore lands the owner on `<generated>.theharvest.app`, and the gate
   * renders first-run setup THERE. Keeping the generated subdomain is a valid
   * finish (`FirstRunSetup.tsx:66` short-circuits the availability check when
   * `subdomain === tenantId`; line 80 lets that satisfy `canFinish`), so
   * `onFinished` hands back the id the user is already hosted on.
   *
   * The host below is moved for real and read by the real resolver — nothing
   * about `getTenantIdFromHost` is mocked, or this would be circular.
   */
  const onTheWorkspaceOrigin = () => setHost('https://gracechurch.theharvest.app/');

  it('the resolver really sees the moved host — otherwise the rest of this group proves nothing', () => {
    onTheWorkspaceOrigin();
    expect(getTenantIdFromHost()).toBe('gracechurch');
  });

  it('does not claim sign-ins fail to carry when the destination is the current origin', async () => {
    onTheWorkspaceOrigin();
    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await flush();

    // 🔴 They signed in on THIS origin to get here. Saying otherwise is a false
    // statement about their account at the moment they are thinking about a
    // charge — the exact failure this screen exists to prevent.
    const copy = text();
    expect(copy).not.toContain('sign in once more');
    expect(copy).not.toContain("sign-ins don't carry across addresses");
    expect(copy).not.toContain('sign-ins don’t carry across addresses');
    expect(copy).toContain('already signed in at this address');
  });

  it('offers an in-origin route to the admin app, not a cross-origin link to itself', async () => {
    onTheWorkspaceOrigin();
    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await flush();

    const els = actionables();
    expect(els).toHaveLength(1);
    const href = els[0].getAttribute('href') || '';
    // Named by destination, not by position: an in-origin path, not an absolute
    // URL that happens to point back at the host we are already on.
    expect(href).toBe('/admin');
    expect(href).not.toContain('theharvest.app');
    expect(href).not.toMatch(/^https?:|^\/\//);
  });

  it('still confirms the payment and names the workspace on the same origin', async () => {
    onTheWorkspaceOrigin();
    getDoc.mockResolvedValue(provisioned('Grace Community Church'));
    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await flush();

    // These are true on both paths and are the point of the screen.
    const copy = text();
    expect(copy).toContain('Your payment went through.');
    expect(copy).toContain('Grace Community Church');
    expect(copy).toContain('gracechurch.theharvest.app');
  });

  it('still withholds the action until the tenant document exists', async () => {
    onTheWorkspaceOrigin();
    getDoc.mockResolvedValue(notProvisioned());
    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await flush();

    // The readiness guard is not a cross-origin concern — it applies here too.
    expect(actionables()).toHaveLength(0);
    expect(text()).toContain('Preparing your workspace');
  });

  it('exposes no payment action on the same-origin path either', async () => {
    onTheWorkspaceOrigin();
    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await flush();

    // ⚠️ Absolute in both branches: everyone here has already been charged.
    for (const el of actionables()) {
      expect(el.textContent || '').not.toMatch(
        /pay now|pay again|try again|retry payment|complete your payment|checkout|billing|card details|subscribe/i,
      );
      expect(el.getAttribute('href')).toBe('/admin');
    }
  });

  it('a DIFFERENT tenant on this host is still cross-origin', async () => {
    // Guards against the comparison being written as "am I on any subdomain"
    // rather than "am I on THIS workspace's subdomain".
    setHost('https://someotherchurch.theharvest.app/');
    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await flush();

    expect(text()).toContain('sign in once more');
    expect(continueLink()?.getAttribute('href')).toBe('https://gracechurch.theharvest.app/admin');
  });
});

/* ── 9 — the stuck-state support link is a real, monitored destination (THE-158) ── */

describe('9 — the stuck-state support link is a real, monitored destination (THE-158)', () => {
  const CONTACT_URL = 'https://theharvest.site/contact';

  const renderStuck = async () => {
    vi.useFakeTimers();
    getDoc.mockResolvedValue(notProvisioned());
    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(STALLED_AFTER_MS + POLL_INTERVAL_MS); });
  };

  const contactLink = () =>
    Array.from(container.querySelectorAll('a')).find((a) => a.getAttribute('href') === CONTACT_URL) || null;

  it('the handoff offers a contact route that exists', async () => {
    await renderStuck();
    expect(contactLink(), 'the stuck branch offered no reachable contact route').toBeTruthy();
  });

  it('no mailto to an unmonitored address is rendered anywhere on the screen', async () => {
    await renderStuck();
    const mailtos = Array.from(container.querySelectorAll('a')).filter((a) =>
      (a.getAttribute('href') || '').startsWith('mailto:'),
    );
    expect(mailtos, 'a mailto: link to an address nobody reads was rendered').toEqual([]);
    // Structural: the invented address cannot come back even if the copy is
    // rewritten later.
    expect(HANDOFF_SRC).not.toContain('mailto:');
    expect(HANDOFF_SRC).not.toContain('support@theharvest.app');
  });

  it('the contact link points at the public marketing contact page, not an in-app route', async () => {
    await renderStuck();
    const link = contactLink();
    // Absolute, on the marketing origin — never a same-origin in-app path,
    // which would require the church to already be signed in on an app origin
    // it may be unable to reach at this exact moment.
    expect(link?.getAttribute('href')).toBe(CONTACT_URL);
    expect(link?.getAttribute('href')).toMatch(/^https:\/\/theharvest\.site\//);
  });

  it('the link opens in a new tab and does not navigate away from the funnel', async () => {
    await renderStuck();
    const link = contactLink();
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('the cross-origin and same-origin copy from PR 327 is unchanged', async () => {
    // Cross-origin: apex → subdomain (the default host set in beforeEach).
    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await flush();
    const crossOriginCopy = text();
    expect(crossOriginCopy).toContain('sign in once more');
    expect(crossOriginCopy).toContain('expected');
    expect(crossOriginCopy).toContain('own web address');
    expect(crossOriginCopy).toContain('nothing was lost');

    // Tear down and re-render on the workspace's own origin.
    act(() => { root?.unmount(); });
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    setHost('https://gracechurch.theharvest.app/');

    render(<WorkspaceHandoff tenantId="gracechurch" />);
    await flush();
    expect(text()).toContain('already signed in at this address');
  });

  it('no colour is hardcoded', () => {
    // Structural, on the source: isolate the JSX block for the contact link
    // (from its opening tag to "Contact support") and require every
    // colour-bearing property in it to be a CSS custom property reference —
    // its fallback may be a literal, that is how var() works, but the value
    // actually used must come from a token, never a bare hex/rgb doing the
    // work on its own. This screen is light-mode-only by decision (THE-85)
    // and must stay themeable through tokens.
    const start = HANDOFF_SRC.indexOf('href={CONTACT_URL}');
    expect(start, 'the contact link markup was not found').toBeGreaterThan(-1);
    const end = HANDOFF_SRC.indexOf('Contact support', start);
    const block = HANDOFF_SRC.slice(start, end);

    // Values may themselves contain commas (e.g. color-mix(in srgb, ...)), so
    // check whole lines rather than splitting on ",": each line naming a
    // colour-bearing property must be themed either inline (`var(--...)`) or
    // via one of the module-level token constants declared at the top of the
    // file — BRAND and SUCCESS are themselves `var(--brand-color, ...)` /
    // `var(--brand-success, ...)`.
    const colourLines = block.split('\n').filter((line) => /\b(color|border|background)\s*:/.test(line));
    expect(colourLines.length).toBeGreaterThan(0);
    for (const line of colourLines) {
      expect(line).toMatch(/var\(--|\bBRAND\b|\bSUCCESS\b/);
    }
  });
});

/* ── the wiring: the gate hands off instead of redirecting ─────────────────── */

describe('OnboardingGate hands off through the screen, not a bare redirect', () => {
  const gateSrc = readFileSync(path.join(SRC, 'components/OnboardingGate.tsx'), 'utf8');

  it('no longer teleports the payer to the subdomain from onFinished', () => {
    expect(gateSrc).not.toMatch(/window\.location\.href\s*=\s*`https:\/\/\$\{finalTenantId\}/);
    expect(gateSrc).toContain('WorkspaceHandoff');
  });

  /**
   * 🔴 The subtle one. Finishing first-run RENAMES the tenant: the old tenant
   * doc is deleted and the user doc is re-pointed at the new id. Both of the
   * gate's onSnapshot listeners fire on that, and both resolve to
   * `status: 'ready'` — which would replace the handoff screen with the app a
   * beat after it appeared, dumping the payer back on the origin they were
   * being sent away from. The handoff is therefore checked ahead of `status`.
   */
  it('the handoff survives the listeners firing after the rename', async () => {
    render(<OnboardingGate><div>THE APP</div></OnboardingGate>);

    // Sign in, resolve a brand-new tenant that is still in first-run.
    await act(async () => { authCallbacks[0]?.({ uid: 'u1', email: 'pastor@grace.org' }); });
    await act(async () => {
      listeners.get('users/u1')?.({
        exists: () => true,
        data: () => ({ tenantId: 'grace-a1b2', role: 'admin', signupInProgress: false, signupMinistryName: 'Grace Community Church' }),
      });
    });
    await act(async () => {
      listeners.get('tenants/grace-a1b2')?.({ exists: () => true, data: () => ({ setupCompleted: false }) });
    });

    const finish = Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === 'finish setup');
    expect(finish, 'first-run setup never rendered').toBeTruthy();

    await act(async () => { finish!.click(); });
    await flush();
    expect(text()).toContain('Your payment went through.');

    // Now the rename lands: the OLD tenant doc is gone, and the user doc points
    // at the new id whose tenant is setupCompleted. Both used to mean 'ready'.
    await act(async () => {
      listeners.get('tenants/grace-a1b2')?.({ exists: () => false, data: () => null });
    });
    await act(async () => {
      listeners.get('users/u1')?.({
        exists: () => true,
        data: () => ({ tenantId: 'gracechurch', role: 'admin', signupInProgress: false }),
      });
    });
    await act(async () => {
      listeners.get('tenants/gracechurch')?.({ exists: () => true, data: () => ({ setupCompleted: true }) });
    });
    await flush();

    expect(text(), 'the handoff was replaced by the app on the wrong origin').toContain('Your payment went through.');
    expect(text()).not.toContain('THE APP');
  });
});
