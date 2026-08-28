import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminFundraising from '../AdminFundraising';
import { GIVING_PROVIDERS, GIVING_PROVIDER_NAMES_OR } from '../donations/giving-providers';

/**
 * THE-251 — the campaign editor names the gap, and the campaign itself carries
 * the control that closes it.
 *
 * 🔴 THE POINT OF THE WHOLE TICKET is that the disclosure has a REMEDY. THE-249
 * established that naming a gap with no way to act on it is worse than silence,
 * so these tests hold the two together: the sentence must be on the editor, the
 * control must be on the campaign, and the control must ADD rather than SET.
 *
 * Asserted against rendered output — the sentence a church reads and the request
 * the button actually sends — never against a constant.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { authFetch, notifyError, invalidateQueries, campaignsResult, tenant, appStore, updateDoc } =
  vi.hoisted(() => ({
    authFetch: vi.fn(async (_url: string, _opts?: RequestInit) =>
      ({ ok: true, json: async () => ({ success: true, raised: 1250 }) })),
    notifyError: vi.fn(),
    invalidateQueries: vi.fn(async () => {}),
    campaignsResult: { current: { data: [] as unknown[], isLoading: false } },
    tenant: { current: { branding: {} as unknown } },
    appStore: {
      current: {
        currentTenantId: 't1' as string | null,
        isAuthReady: true,
        isSuperAdmin: false,
        tenantPlan: 'plus' as string | null,
      },
    },
    updateDoc: vi.fn(async (_ref: unknown, _data?: Record<string, unknown>) => {}),
  }));

vi.mock('../../utils/auth-fetch', () => ({ authFetch }));
vi.mock('../../utils/notify', () => ({ notifyError }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => tenant.current }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }));
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => appStore.current }));
vi.mock('../AdminScreenHeader', () => ({
  useAdminHeader: () => ({ setHeaderAction: () => {}, setHeaderOverride: () => {} }),
  HeaderActionButton: () => null,
}));
vi.mock('../settings/PaymentSection', () => ({ default: () => null }));
vi.mock('../ImageUpload', () => ({ ImageUpload: () => null }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  addDoc: vi.fn(async () => ({ id: 'c9' })),
  updateDoc,
  deleteDoc: vi.fn(async () => {}),
  doc: (_db: unknown, _c: string, id: string) => ({ id }),
  serverTimestamp: () => 'SERVER_TS',
  query: () => ({}),
  where: () => ({}),
  onSnapshot: (_q: unknown, _next: unknown, err: () => void) => { err?.(); return () => {}; },
  limit: () => ({}),
  Timestamp: { fromDate: (d: Date) => d },
}));
vi.mock('../../hooks/queries/useCampaignQueries', () => ({
  useCampaigns: () => campaignsResult.current,
}));

const CAMPAIGN = {
  id: 'camp1',
  title: 'Roof Fund',
  description: 'Help us fix the roof',
  coverImage: '',
  goal: 50_000,
  raised: 1000,
  endDate: '',
  isActive: true,
  campaignType: 'fundraising' as const,
  pledgeDeadline: null,
  tenantId: 't1',
};

/** A church that publishes payment links Harvest is not in. */
const WITH_LINKS = {
  givingLinks: {
    paypal: { url: 'https://paypal.me/gracechapel', handle: 'gracechapel' },
    zelle: { email: 'giving@gracechapel.example' },
  },
};

let container: HTMLDivElement;
let root: Root;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

async function mount(opts: { branding?: unknown; plan?: string | null } = {}) {
  tenant.current = { branding: 'branding' in opts ? opts.branding : WITH_LINKS };
  appStore.current = {
    currentTenantId: 't1',
    isAuthReady: true,
    isSuperAdmin: false,
    tenantPlan: 'plan' in opts ? (opts.plan ?? null) : 'plus',
  };
  campaignsResult.current = { data: [CAMPAIGN], isLoading: false };
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminFundraising />);
  });
  await flush();
}

/** Click the element, inside act. */
async function click(el: Element | null) {
  expect(el).not.toBeNull();
  await act(async () => {
    (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}

/** Type into a controlled input the way React reads it. */
async function type(el: Element | null, value: string) {
  expect(el).not.toBeNull();
  const input = el as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
    'value',
  )!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
}

const byTestId = (id: string) => container.querySelector(`[data-testid="${id}"]`);

/** The JSON body of the Nth authFetch call. */
const sentBody = (call = 0): Record<string, unknown> => {
  const opts = authFetch.mock.calls[call]?.[1];
  return JSON.parse(String((opts as RequestInit).body));
};

/**
 * Open the campaign editor on the existing campaign, from the list.
 *
 * The list draws each campaign more than once (a mobile card and a desktop
 * row), so this takes the FIRST edit control — every one of them calls the same
 * `openEdit(c)` with the same campaign.
 */
async function openEditor() {
  const edit = [...container.querySelectorAll('button')].find((b) => b.querySelector('svg.lucide-pen'));
  await click(edit!);
}

/** Open the campaign's detail view by its title. */
async function openDetail() {
  const title = [...container.querySelectorAll('h3, h4, p, span, div')]
    .find((el) => el.textContent?.trim() === 'Roof Fund' && el.children.length === 0);
  await click(title!.closest('[class*="cursor-pointer"]') || title!);
}

beforeEach(() => {
  vi.clearAllMocks();
  authFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, raised: 1250 }) } as never);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
});

describe('the campaign editor states that link gifts do not update the raised amount', () => {
  it('shows the disclosure beside the goal', async () => {
    await mount();
    await click([...container.querySelectorAll('button')].find((b) => /new campaign/i.test(b.textContent || ''))!);
    const note = byTestId('campaign-manual-giving');
    expect(note).not.toBeNull();
    const text = note!.textContent || '';
    expect(text).toContain('Gifts sent through your own payment links do not update the amount raised.');
    expect(text).toContain(`Harvest never sees a ${GIVING_PROVIDER_NAMES_OR} gift`);
  });

  it('names the control that fixes it, not just the problem', async () => {
    await mount();
    await click([...container.querySelectorAll('button')].find((b) => /new campaign/i.test(b.textContent || ''))!);
    // 🔴 THE-249's rule: a disclosure with no remedy is the trap. The sentence
    // must name a control that exists on this screen.
    expect(byTestId('campaign-manual-giving')!.textContent).toContain('Record an offline gift');
  });

  it('says the adjustment reaches no giving statement', async () => {
    await mount();
    await click([...container.querySelectorAll('button')].find((b) => /new campaign/i.test(b.textContent || ''))!);
    expect(byTestId('campaign-manual-giving')!.textContent).toContain('will not appear on a giving statement');
  });

  it('is withheld from a church that publishes no links', async () => {
    // Same reasoning as AdminCRM's copy: a church with no links has no link
    // gap, and a banner shown to everyone is the banner nobody reads.
    await mount({ branding: {} });
    await click([...container.querySelectorAll('button')].find((b) => /new campaign/i.test(b.textContent || ''))!);
    expect(byTestId('campaign-manual-giving')).toBeNull();
  });

  it('sits on the editor that has a Goal input and no Raised input', async () => {
    await mount();
    await click([...container.querySelectorAll('button')].find((b) => /new campaign/i.test(b.textContent || ''))!);
    const labels = [...container.querySelectorAll('label')].map((l) => l.textContent?.trim());
    expect(labels).toContain('Goal ($)');
    // 🔴 There is deliberately no Raised field: `raised` is incremented per
    // Stripe payment, so a field that SET it would double-count.
    expect(labels.some((l) => /^raised/i.test(l || ''))).toBe(false);
  });
});

describe('an admin can add an offline gift to a campaign’s raised amount', () => {
  it('offers the control on the campaign', async () => {
    await mount();
    await openDetail();
    expect(byTestId('campaign-record-offline-gift')).not.toBeNull();
  });

  it('posts the gift to the adjustment route', async () => {
    await mount();
    await openDetail();
    await click(byTestId('campaign-record-offline-gift'));
    await type(container.querySelector('#offline-gift-amount'), '250');
    await type(container.querySelector('#offline-gift-provider'), 'cashapp');
    await type(container.querySelector('#offline-gift-note'), 'Sunday envelope');
    await click([...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Record gift')!);

    expect(authFetch).toHaveBeenCalledWith('/api/campaigns/adjust-raised', expect.objectContaining({ method: 'POST' }));
    const body = sentBody();
    expect(body).toMatchObject({
      campaignId: 'camp1',
      tenantId: 't1',
      amountDollars: 250,
      provider: 'cashapp',
      note: 'Sunday envelope',
    });
  });

  it('sends the gift amount, never a new total', async () => {
    await mount();
    await openDetail();
    await click(byTestId('campaign-record-offline-gift'));
    await type(container.querySelector('#offline-gift-amount'), '250');
    await click([...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Record gift')!);
    const body = sentBody();
    // 🔴 The campaign already shows $1,000 raised. A control that SET the total
    // would send 250 as the answer; this sends 250 as the GIFT, and the server
    // increments. The distinction is the whole double-count guard.
    expect(body.amountDollars).toBe(250);
    expect(body).not.toHaveProperty('raised');
    expect(body).not.toHaveProperty('total');
  });

  it('tells the admin at the point of entry that the amount is added', async () => {
    await mount();
    await openDetail();
    await click(byTestId('campaign-record-offline-gift'));
    const form = byTestId('campaign-adjust-form')!;
    expect(form.textContent).toContain('adds to');
    expect(form.textContent).toContain('not the new total');
    expect(form.textContent).toContain('enter a negative amount');
  });

  it('offers every provider from the shared table, and no hand-written list', async () => {
    await mount();
    await openDetail();
    await click(byTestId('campaign-record-offline-gift'));
    const options = [...container.querySelectorAll('#offline-gift-provider option')]
      .map((o) => o.getAttribute('value'))
      .filter((v) => v);
    expect(options).toEqual(GIVING_PROVIDERS.map((p) => p.id));
  });

  it('refuses to post an empty or zero amount', async () => {
    await mount();
    await openDetail();
    await click(byTestId('campaign-record-offline-gift'));
    await click([...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Record gift')!);
    expect(authFetch).not.toHaveBeenCalled();
    expect(byTestId('campaign-adjust-error')).not.toBeNull();

    await type(container.querySelector('#offline-gift-amount'), '0');
    await click([...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Record gift')!);
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('posts a negative amount, because that is how a mistake is corrected', async () => {
    await mount();
    await openDetail();
    await click(byTestId('campaign-record-offline-gift'));
    await type(container.querySelector('#offline-gift-amount'), '-450');
    await click([...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Record gift')!);
    const body = sentBody();
    expect(body.amountDollars).toBe(-450);
  });

  it('shows the server’s refusal rather than claiming success', async () => {
    authFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'That would take this campaign below $0.' }),
    } as never);
    await mount();
    await openDetail();
    await click(byTestId('campaign-record-offline-gift'));
    await type(container.querySelector('#offline-gift-amount'), '-9999');
    await click([...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Record gift')!);
    expect(byTestId('campaign-adjust-error')!.textContent).toContain('below $0');
    // The form stays open, holding what was typed, so the correction is editable.
    expect(byTestId('campaign-adjust-form')).not.toBeNull();
  });

  it('shows the new total the server actually applied', async () => {
    await mount();
    await openDetail();
    await click(byTestId('campaign-record-offline-gift'));
    await type(container.querySelector('#offline-gift-amount'), '250');
    await click([...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Record gift')!);
    // The server is the authority — it applied the increment and the zero floor.
    expect(container.textContent).toContain('$1,250');
  });

  it('records the trail, and says so before the admin commits', async () => {
    await mount();
    await openDetail();
    await click(byTestId('campaign-record-offline-gift'));
    const form = byTestId('campaign-adjust-form')!;
    expect(form.textContent).toContain('Recorded with your name and the date');
    expect(form.textContent).toContain('does not create a receipt');
  });
});

describe('the campaign editor never writes the raised total', () => {
  it('omits `raised` from the update payload when a campaign is saved', async () => {
    await mount();
    // Open the editor on the existing campaign, change nothing but the title.
    // Opened from the campaign LIST, which is where the editor modal lives —
    // the detail view returns early, before that modal is rendered.
    await openEditor();
    await click([...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save changes')!);

    expect(updateDoc).toHaveBeenCalled();
    const payload = updateDoc.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    // 🔴 `openEdit` loads the whole campaign into form state. Spreading it back
    // wrote a SNAPSHOT of `raised` taken when the modal opened, silently undoing
    // any Stripe gift — or any manual adjustment — that landed while it was
    // open. The editor owns every other field and not this one.
    expect(payload).not.toHaveProperty('raised');
    expect(payload).toHaveProperty('goal');
    expect(payload).toHaveProperty('title');
  });
});

describe('a free tenant reaches none of this', () => {
  it('shows no fundraising screen at all', async () => {
    await mount({ plan: 'free' });
    // `free.fundraising` is false — there is no donate page, so there is no
    // campaign total to disclose about and no offline gift to record.
    expect(byTestId('campaign-record-offline-gift')).toBeNull();
    expect(byTestId('campaign-manual-giving')).toBeNull();
    expect(authFetch).not.toHaveBeenCalledWith('/api/campaigns/adjust-raised', expect.anything());
  });
});
