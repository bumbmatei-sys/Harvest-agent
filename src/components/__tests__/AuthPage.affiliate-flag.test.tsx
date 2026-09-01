import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * AFFILIATE_PROGRAM_ENABLED — the affiliate copy on the auth screen.
 *
 * affiliate.theharvest.app's sign-up screen is where the programme is actually
 * SOLD: "Affiliate program", "Welcome to Harvest affiliate", "Earn recurring
 * commission for every ministry you refer to Harvest". That is a public promise
 * of 30% of subscription revenue for 12 months, made while the payout rail is
 * mid-migration to Dodo — it is the single most important thing this PR takes
 * down. Hidden, the host renders the ordinary Harvest auth copy.
 *
 * What the flag must NOT move: `isAffiliateHost` itself. The effect below it
 * uses the raw host check to stop a stray `?signup=church` flipping the
 * affiliate origin into the church flow, and that guard has to hold in both
 * directions — the last test pins it.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../firebase', () => ({ auth: { currentUser: null }, db: {} }));
vi.mock('firebase/auth', () => ({
  signInWithPopup: vi.fn(),
  GoogleAuthProvider: class {},
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: () => ({}), setDoc: vi.fn(), getDoc: vi.fn(), updateDoc: vi.fn(),
}));
vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'get', WRITE: 'write' },
  handleFirestoreError: () => {},
}));
vi.mock('../../contexts/TenantContext', () => ({
  useTenant: () => ({ branding: {}, tenantId: null, tenantName: null, tenantPlan: null }),
}));
vi.mock('@marsidev/react-turnstile', () => ({ Turnstile: () => null }));
vi.mock('../AuthShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const AFFILIATE_HOST = 'https://affiliate.theharvest.app/auth';
const APEX_HOST = 'https://theharvest.app/auth';

let container: HTMLDivElement;
let root: Root | null = null;

function setURL(url: string) {
  (window as unknown as { happyDOM: { setURL: (u: string) => void } }).happyDOM.setURL(url);
}

/** Mount AuthPage with AFFILIATE_PROGRAM_ENABLED forced to `enabled`. */
async function mount(enabled: boolean) {
  vi.resetModules();
  vi.doMock('../../utils/plan-features', async () => {
    const actual = await vi.importActual<typeof import('../../utils/plan-features')>(
      '../../utils/plan-features'
    );
    return { ...actual, AFFILIATE_PROGRAM_ENABLED: enabled };
  });
  const AuthPage = (await import('../AuthPage')).default;
  await act(async () => {
    root = createRoot(container);
    root.render(<AuthPage onNavigate={() => {}} />);
  });
  await act(async () => { await Promise.resolve(); });
}

const text = () => container.textContent ?? '';

beforeEach(() => {
  sessionStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container.remove();
  vi.doUnmock('../../utils/plan-features');
});

describe('AFFILIATE_PROGRAM_ENABLED === false — the auth screen sells nothing', () => {
  it('the affiliate host shows no commission or affiliate-programme copy', async () => {
    setURL(AFFILIATE_HOST);
    await mount(false);

    expect(text()).not.toMatch(/affiliate/i);
    expect(text()).not.toMatch(/commission/i);
    expect(text()).not.toMatch(/refer/i);
  });

  it('the affiliate host falls back to the ordinary Harvest copy — the screen still works', async () => {
    setURL(AFFILIATE_HOST);
    await mount(false);

    // The generic sign-in branch, i.e. exactly what the apex host renders.
    expect(text()).toMatch(/Sign in to Harvest/i);
  });
});

describe('AFFILIATE_PROGRAM_ENABLED === true — the affiliate copy comes back', () => {
  it('the affiliate host defaults to the sign-up view with the programme pitch', async () => {
    setURL(AFFILIATE_HOST);
    await mount(true);

    expect(text()).toMatch(/Affiliate program/i);
    expect(text()).toMatch(/Welcome to Harvest affiliate/i);
    expect(text()).toMatch(/Earn recurring commission/i);
  });

  it('leaves the apex host untouched in both directions', async () => {
    setURL(APEX_HOST);
    await mount(true);
    expect(text()).not.toMatch(/Earn recurring commission/i);

    act(() => { root?.unmount(); root = null; });
    await mount(false);
    expect(text()).not.toMatch(/Earn recurring commission/i);
  });
});

describe('the host guard behind the flag is not gated on it', () => {
  it('?signup=church on the affiliate host never flips the church flow on, flag off', async () => {
    setURL(`${AFFILIATE_HOST}?signup=church`);
    await mount(false);

    // The church branch's copy — it must not appear on the affiliate origin.
    expect(text()).not.toMatch(/Start your ministry/i);
  });

  it('…and not with the flag on either', async () => {
    setURL(`${AFFILIATE_HOST}?signup=church`);
    await mount(true);

    expect(text()).not.toMatch(/Start your ministry/i);
    expect(text()).toMatch(/Welcome to Harvest affiliate/i);
  });
});
