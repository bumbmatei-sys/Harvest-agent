import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminCRM from '../AdminCRM';

/**
 * "Email this contact" in the CRM.
 *
 * The behaviour under test is the failure shape, not the happy path. A pastor
 * believing they replied to a member when nothing was delivered is the worst
 * outcome this feature has, and it is the same silent-failure class that has
 * already shipped four times in this codebase (THE-33, THE-37, THE-44, THE-46).
 * So: a failed send keeps the modal open, keeps the composed text, and says so;
 * and an admin with no connected account is never shown a send button at all.
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
const notifyError = vi.hoisted(() => vi.fn());
const invalidateQueries = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../../utils/auth-fetch', () => ({ authFetch }));
vi.mock('../../utils/notify', () => ({ notifyError }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  addDoc: vi.fn(async () => ({ id: 'a1' })),
  deleteDoc: vi.fn(async () => {}),
  setDoc: vi.fn(async () => {}),
  doc: () => ({}),
  serverTimestamp: () => 'SERVER_TS',
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: () => ({ currentTenantId: 't1', isAuthReady: true }),
}));
vi.mock('../AdminScreenHeader', () => ({
  useAdminHeader: () => ({ setHeaderAction: () => {}, setHeaderOverride: () => {} }),
  HeaderActionButton: () => null,
}));
vi.mock('../AnalyticsAndRoles', () => ({ default: () => null }));
// Spread the real module so the pure helpers it exports (resolvePipelineStage,
// which every stage badge in AdminCRM calls) stay REAL — only the two data hooks
// are stubbed. A hand-written object here would silently drop new exports.
vi.mock('../../hooks/queries/useCRMQueries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/queries/useCRMQueries')>()),
  useContactsWithUsers: () => ({ data: [CONTACT], isLoading: false }),
  useContactActivities: () => ({
    data: [], isLoading: false, isError: false, error: null, refetch: () => {},
  }),
  // Undefined data = counts not in yet, so the coverage line does not render and
  // these email assertions see the same DOM they always did. Stubbed rather than
  // left real because the real hook calls useQuery, which this file's
  // react-query mock does not provide.
  useCRMCounts: () => ({ data: undefined }),
}));

let container: HTMLDivElement;
let root: Root;
let mounted = false;

const flush = async () => {
  await act(async () => {
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
};

/** Answer the component's Gmail status probe. */
function gmailStatus(connected: boolean) {
  authFetch.mockImplementation(async (url: string) => {
    if (url.includes('/api/composio/gmail/status')) {
      return { ok: true, json: async () => ({ connected }) };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

/**
 * Mount straight into the contact detail view via the deep-link prop the CRM
 * already supports — the email controls live there, and driving the list-row
 * click adds nothing this file is testing.
 */
async function mountCRM() {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <AdminCRM
        currentUserRole="admin"
        currentUserPermissions={{ fullAccess: true } as never}
        initialContactId={CONTACT.id}
      />
    );
  });
  mounted = true;
  await flush();
}

const buttonByText = (text: string) =>
  [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === text);

async function openCompose() {
  await act(async () => { buttonByText('Email')!.click(); });
  await flush();
}

/** Type into a field the way a user does — React's tracked value setter. */
async function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  await act(async () => { el.dispatchEvent(new Event('input', { bubbles: true })); });
}

const subjectInput = () => container.querySelector('input[placeholder="Subject line"]') as HTMLInputElement;
const bodyInput = () => container.querySelector('textarea[placeholder="Write your message..."]') as HTMLTextAreaElement;

async function compose(subject: string, body: string) {
  await typeInto(subjectInput(), subject);
  await typeInto(bodyInput(), body);
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  if (mounted) { mounted = false; await act(async () => { root.unmount(); }); }
  container.remove();
});

describe('AdminCRM — email a contact', () => {
  it('shows a send button once the admin has connected Gmail', async () => {
    gmailStatus(true);
    await mountCRM();

    expect(buttonByText('Email')).toBeTruthy();
    expect(buttonByText('Connect your email')).toBeFalsy();
  });

  // ── Not connected → prompt, never a button that errors ────────────────────
  it('shows a "Connect your email" link, not a send button, when not connected', async () => {
    gmailStatus(false);
    await mountCRM();

    expect(buttonByText('Email')).toBeFalsy();
    const prompt = buttonByText('Connect your email');
    expect(prompt).toBeTruthy();

    await act(async () => { prompt!.click(); });
    expect(navigate).toHaveBeenCalledWith('/admin/settings');
    // The prompt navigates. It never attempts a send.
    expect(authFetch.mock.calls.some(([u]) => u.includes('/api/crm/send-email'))).toBe(false);
  });

  it('offers neither control while the connection status is still unknown', async () => {
    // A pending probe must not render a button whose behaviour is not yet known.
    authFetch.mockImplementation(() => new Promise(() => {}));
    await mountCRM();

    expect(buttonByText('Email')).toBeFalsy();
    expect(buttonByText('Connect your email')).toBeFalsy();
  });

  // ── Send succeeds ─────────────────────────────────────────────────────────
  it('closes the modal and refreshes the timeline on a successful send', async () => {
    gmailStatus(true);
    await mountCRM();
    await openCompose();
    await compose('Welcome', 'Glad to see you Sunday.');

    authFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/crm/send-email')) {
        return { ok: true, json: async () => ({ sent: true, logged: true }) };
      }
      return { ok: true, json: async () => ({ connected: true }) };
    });

    await act(async () => { buttonByText('Send')!.click(); });
    await flush();

    const sendCall = authFetch.mock.calls.find(([u]) => u.includes('/api/crm/send-email'));
    expect(sendCall).toBeTruthy();
    expect(JSON.parse(sendCall![1].body)).toEqual({
      contactId: 'contact-1', subject: 'Welcome', body: 'Glad to see you Sunday.',
    });
    // Timeline refetched so the logged activity appears.
    expect(invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['contactActivities', 't1', 'contact-1'] }),
    );
    expect(subjectInput()).toBeFalsy(); // modal closed
  });

  // ── Send fails → visible error, composed text preserved ───────────────────
  it('keeps the modal, the text, and shows the real error when the send fails', async () => {
    gmailStatus(true);
    await mountCRM();
    await openCompose();
    await compose('Following up', 'Thinking of you this week.');

    authFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/crm/send-email')) {
        return {
          ok: false,
          status: 502,
          json: async () => ({ error: 'The email could not be sent. Nothing was delivered — your message has been kept.' }),
        };
      }
      return { ok: true, json: async () => ({ connected: true }) };
    });

    await act(async () => { buttonByText('Send')!.click(); });
    await flush();

    // Still open, still filled in — nothing the admin wrote was lost.
    expect(subjectInput()).toBeTruthy();
    expect(subjectInput().value).toBe('Following up');
    expect(bodyInput().value).toBe('Thinking of you this week.');

    // And it says so, in the server's own words.
    expect(container.textContent).toContain('Not sent');
    expect(container.textContent).toContain('Nothing was delivered');
    // Nothing was optimistically added to the timeline.
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it('surfaces a network failure the same way, without losing the draft', async () => {
    gmailStatus(true);
    await mountCRM();
    await openCompose();
    await compose('Subject', 'Body text');

    authFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/crm/send-email')) throw new Error('Failed to fetch');
      return { ok: true, json: async () => ({ connected: true }) };
    });

    await act(async () => { buttonByText('Send')!.click(); });
    await flush();

    expect(container.textContent).toContain('Not sent');
    expect(bodyInput().value).toBe('Body text');
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it('falls back to the connect prompt when the server reports not_connected', async () => {
    gmailStatus(true);
    await mountCRM();
    await openCompose();
    await compose('Subject', 'Body text');

    authFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/crm/send-email')) {
        return {
          ok: false, status: 409,
          json: async () => ({ error: 'Connect your Gmail account in Settings before sending.', code: 'not_connected' }),
        };
      }
      return { ok: true, json: async () => ({ connected: true }) };
    });

    await act(async () => { buttonByText('Send')!.click(); });
    await flush();

    expect(container.textContent).toContain('Not sent');
    expect(bodyInput().value).toBe('Body text');

    // The stale "connected" state is corrected, so closing the modal leaves the
    // admin looking at the connect prompt rather than a button that will fail.
    await act(async () => { buttonByText('Cancel')!.click(); });
    await flush();
    expect(buttonByText('Connect your email')).toBeTruthy();
    expect(buttonByText('Email')).toBeFalsy();
  });

  it('tells the admin when the email was sent but could not be logged', async () => {
    gmailStatus(true);
    await mountCRM();
    await openCompose();
    await compose('Subject', 'Body text');

    authFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/crm/send-email')) {
        return {
          ok: true,
          json: async () => ({ sent: true, logged: false, warning: 'The email was sent, but it could not be added to the timeline.' }),
        };
      }
      return { ok: true, json: async () => ({ connected: true }) };
    });

    await act(async () => { buttonByText('Send')!.click(); });
    await flush();

    // Sent, so the modal closes and the draft is cleared — but the admin is told
    // the timeline is incomplete rather than left to assume it is not.
    expect(subjectInput()).toBeFalsy();
    expect(notifyError).toHaveBeenCalledWith('Email sent', expect.any(Error));
  });

  it('will not send an empty subject or body', async () => {
    gmailStatus(true);
    await mountCRM();
    await openCompose();

    expect((buttonByText('Send') as HTMLButtonElement).disabled).toBe(true);
    await compose('Only a subject', '');
    expect((buttonByText('Send') as HTMLButtonElement).disabled).toBe(true);
  });
});
