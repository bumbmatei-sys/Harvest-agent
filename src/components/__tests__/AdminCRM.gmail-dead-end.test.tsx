import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminCRM from '../AdminCRM';

/**
 * THE-225 — the dead-end guard, rendered.
 *
 * THE-193's defect: the CRM's "Connect your email" button routed to Settings,
 * Settings had no Integrations section on that tier, and the workflow simply
 * ended. THE-225 hides the Gmail card from FREE — a tier that HAS the CRM
 * (`crm: true`, deliberately) and therefore renders this exact screen — so
 * leaving the button behind would re-open that hole with a different tier's
 * name on it. The founder's instruction was explicit: fix both or neither.
 *
 * So on a tier that cannot reach the Gmail card, this screen offers NO email
 * affordance at all — not the send button, not the connect prompt, and not the
 * `/api/composio/gmail/status` request that chooses between them. A hidden
 * control that still opens its request is the THE-213 shape, and it is asserted
 * here as the ABSENCE of the call, not just of a node.
 *
 * ⚠️ The overshoot is the risk: three tiers pay for CRM email. The priced-tier
 * block below carries the same weight as the free one.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONTACT = vi.hoisted(() => ({
  id: 'contact-1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  phone: '',
  type: 'member' as const,
  notes: '',
  tags: [] as string[],
  totalDonated: 0,
  lastDonationAt: null,
  memberSince: null,
  createdAt: null,
  createdBy: 'u1',
  updatedAt: null,
  tenantId: 't1',
}));

const navigate = vi.hoisted(() => vi.fn());
const authFetch = vi.hoisted(() => vi.fn());
const invalidateQueries = vi.hoisted(() => vi.fn(async () => {}));
/** The tenant's tier, driven per test — the whole subject of this file. */
const tenant = vi.hoisted(() => ({ plan: 'free' as string | undefined }));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../../utils/auth-fetch', () => ({ authFetch }));
vi.mock('../../utils/notify', () => ({ notifyError: vi.fn() }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('@/contexts/TenantContext', () => ({
  // `planFeatures` left undefined so AdminCRM derives from the plan the way it
  // does for a tenant whose context has not layered add-ons yet.
  useTenant: () => ({ tenantPlan: tenant.plan }),
}));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  addDoc: vi.fn(async () => ({ id: 'a1' })),
  deleteDoc: vi.fn(async () => {}),
  setDoc: vi.fn(async () => {}),
  doc: () => ({}),
  serverTimestamp: () => 'SERVER_TS',
  writeBatch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn(async () => {}) })),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: () => ({ currentTenantId: 't1', isAuthReady: true }),
}));
vi.mock('../AdminScreenHeader', () => ({
  useAdminHeader: () => ({ setHeaderAction: () => {}, setHeaderOverride: () => {} }),
  HeaderActionButton: () => null,
}));
vi.mock('../AdminRoles', () => ({ default: () => null }));
vi.mock('../../hooks/queries/useCRMQueries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/queries/useCRMQueries')>()),
  useContactsWithUsers: () => ({ data: [CONTACT], isLoading: false }),
  useContactActivities: () => ({
    data: [], isLoading: false, isError: false, error: null, refetch: () => {},
  }),
  useCRMCounts: () => ({ data: undefined }),
}));

/* 🔴 THE-339 — `GMAIL_FEATURE_ENABLED` is false on disk, and the switch sits
   AHEAD of every other gate by design, so without this mock the Gmail surface
   this file exists to measure would simply be absent and the assertions below
   would be about nothing.

   ⚠️ MOCKED RATHER THAN THE ASSERTIONS LOWERED, exactly as THE-335's newsletter
   switch is mocked where a suite has to keep measuring a hidden composition.
   The behaviour here is what must come back UNCHANGED when Gmail returns with an
   inbox, so it stays fully asserted; that the surface is GONE while the switch
   is off is asserted in `THE-339.gmail-hidden.test.ts`. */
vi.mock('../../lib/gmail-feature', () => ({
  GMAIL_FEATURE_ENABLED: true,
  GMAIL_HIDDEN_MESSAGE: 'Gmail sending is temporarily unavailable.',
  GMAIL_PAUSED_NOTICE:
    'Email sending from your own Gmail account is paused until the Harvest scheduler ships with an inbox.',
}));


let container: HTMLDivElement;
let root: Root;
let mounted = false;

const flush = async () => {
  await act(async () => {
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
};

/** Answer the component's Gmail status probe, if it ever asks. */
function gmailStatus(connected: boolean) {
  authFetch.mockImplementation(async (url: string) => {
    if (url.includes('/api/composio/gmail/status')) {
      return { ok: true, json: async () => ({ connected }) };
    }
    return { ok: true, json: async () => ({}) };
  });
}

async function mountCRM(plan: string | undefined, opts: { connected?: boolean } = {}) {
  tenant.plan = plan;
  gmailStatus(opts.connected ?? true);
  await act(async () => {
    root = createRoot(container);
    root.render(
      <AdminCRM
        currentUserRole="admin"
        currentUserPermissions={{ fullAccess: true } as never}
        initialContactId={CONTACT.id}
      />,
    );
  });
  mounted = true;
  await flush();
}

const buttonByText = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

/** Did anything ask whether this admin's Gmail is connected? */
const askedGmailStatus = () =>
  authFetch.mock.calls.some((call: unknown[]) => String(call[0]).includes('/api/composio/gmail/status'));

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  if (mounted) { mounted = false; await act(async () => { root.unmount(); }); }
  container.remove();
});

describe('a free tenant\'s CRM offers no email control', () => {
  it('🔴 shows neither "Connect your email" nor "Email", on a contact that has an address', async () => {
    await mountCRM('free', { connected: false });

    // The contact is on screen — the assertions below are about the controls,
    // not about an empty render.
    expect(container.textContent).toContain('ada@example.com');
    expect(buttonByText('Connect your email'), 'free was offered a link to a section it does not have').toBeFalsy();
    expect(buttonByText('Email'), 'free was offered a send button for a mailbox it cannot connect').toBeFalsy();
  });

  it('🔴 never even asks whether Gmail is connected', async () => {
    // The sharper form: a hidden control that still opens its request is the
    // defect THE-213 was written against.
    await mountCRM('free', { connected: false });

    expect(askedGmailStatus(), 'free probed /api/composio/gmail/status for a control it cannot render').toBe(false);
  });

  it('offers nothing even if a downgraded tenant still holds a live connection', async () => {
    // A tenant that paid, connected Gmail and then fell back to free. The
    // status probe is not made, so `gmailConnected` never becomes true and no
    // send button appears — the tier decides, not the leftover connection.
    await mountCRM('free', { connected: true });

    expect(buttonByText('Email')).toBeFalsy();
    expect(buttonByText('Connect your email')).toBeFalsy();
  });

  it('keeps the rest of the contact record intact', async () => {
    // Presentation only. The contact, its notes field and Add Activity are all
    // still there — this hides an integration, not a screen.
    await mountCRM('free', { connected: false });

    expect(container.textContent).toContain('Ada');
    expect(buttonByText('Add Activity'), 'the free CRM lost its activity control').toBeTruthy();
  });
});

describe('the three priced tiers keep CRM email', () => {
  for (const plan of ['plus', 'pro', 'max'] as const) {
    it(`${plan} still shows the send button when Gmail is connected`, async () => {
      await mountCRM(plan, { connected: true });

      expect(askedGmailStatus(), `${plan} stopped checking its Gmail connection`).toBe(true);
      expect(buttonByText('Email'), `${plan} lost its CRM send button`).toBeTruthy();
    });

    it(`${plan} still shows "Connect your email", pointing at a section it has`, async () => {
      await mountCRM(plan, { connected: false });

      const prompt = buttonByText('Connect your email');
      expect(prompt, `${plan} lost its connect prompt`).toBeTruthy();
      await act(async () => { prompt!.click(); });
      expect(navigate).toHaveBeenCalledWith('/admin/settings');
    });
  }

  it('an unresolved plan is not treated as free', async () => {
    // `tenantPlan` is undefined until the tenant document resolves. AdminCRM
    // coerces that to 'plus' for every other question on this screen
    // (`resolveContactLimit`, `crmFeatures`), and this gate rides the same
    // coercion rather than adding a second unknown-plan rule that can disagree.
    await mountCRM(undefined, { connected: true });

    expect(buttonByText('Email'), 'a loading plan lost the send button').toBeTruthy();
  });
});
