import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getPlanFeatures, PLAN_ORDER } from '../utils/plan-features';
import {
  NEWSLETTER_FEATURE_ENABLED,
  LEGACY_MAILCHIMP_NEWSLETTER_ENABLED,
  LEGACY_MAILCHIMP_SEND_RETIRED_MESSAGE,
} from '../lib/newsletter-feature';
import { INTEGRATION_PROVIDERS } from '../components/settings/integration-providers';

/**
 * The newsletter is on; the Mailchimp sender it replaced is not. Turning the
 * first on must not bring the second back, and the plan catalogue must say what
 * the matrix says.
 */

const { requireAdmin, executeComposioAction, collection } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  executeComposioAction: vi.fn(),
  collection: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({ requireAdmin }));
vi.mock('@/lib/composio-client', () => ({ executeComposioAction }));
vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection } }));
vi.mock('@/lib/money-path-sentry', () => ({ captureHandledError: vi.fn() }));

const send = await import('../app/api/newsletter/send/route');
const plans = await import('../app/api/plans/route');

beforeEach(() => vi.clearAllMocks());

describe('the two switches', () => {
  it('the newsletter is on and the legacy Mailchimp path is off', () => {
    expect(NEWSLETTER_FEATURE_ENABLED).toBe(true);
    expect(LEGACY_MAILCHIMP_NEWSLETTER_ENABLED).toBe(false);
  });
});

describe('POST /api/newsletter/send — the retired Mailchimp sender', () => {
  const post = (body: unknown) =>
    new NextRequest('https://theharvest.app/api/newsletter/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it.each([
    ['a send', { newsletterId: 'n1' }],
    ['a scheduled send', { newsletterId: 'n1', schedule: '2999-01-01T00:00:00Z' }],
    ['a draft save', { newsletterId: 'n1', action: 'save_draft', subject: 's', bodyHtml: '<p>x</p>' }],
  ])('refuses %s with 503 before it authenticates, reads, or sends anything', async (_label, body) => {
    requireAdmin.mockResolvedValue({ tenantId: 'grace', uid: 'u', isSuperAdmin: false });
    const res = await send.POST(post(body));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: LEGACY_MAILCHIMP_SEND_RETIRED_MESSAGE });
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(collection).not.toHaveBeenCalled();
    expect(executeComposioAction).not.toHaveBeenCalled();
  });
});

describe('Settings → Integrations providers', () => {
  it('Instagram and Mailchimp are the newsletter-concern rows the legacy switch hides, and Gmail is not one', () => {
    const newsletterRows = INTEGRATION_PROVIDERS.filter((p) => p.concern === 'newsletter').map((p) => p.id);
    expect(newsletterRows.sort()).toEqual(['instagram', 'mailchimp']);
    expect(INTEGRATION_PROVIDERS.find((p) => p.id === 'gmail')?.concern).toBe('crm');
  });
});

describe('GET /api/plans — the newsletter row', () => {
  it('publishes newsletterAutomation on every tier, equal to the matrix', async () => {
    const body = await (await plans.GET()).json();
    expect(body.plans.map((p: { id: string }) => p.id)).toEqual([...PLAN_ORDER]);
    for (const plan of body.plans) {
      expect(Object.keys(plan.features), `${plan.id} dropped newsletterAutomation`)
        .toContain('newsletterAutomation');
      expect(plan.features.newsletterAutomation, `${plan.id} disagrees with the matrix`)
        .toBe(getPlanFeatures(plan.id).newsletterAutomation);
    }
  });

  it('says Ministry includes it, and Forever Free and Church do not', async () => {
    const body = await (await plans.GET()).json();
    const byId = Object.fromEntries(
      body.plans.map((p: { id: string; features: { newsletterAutomation: boolean } }) => [p.id, p.features.newsletterAutomation]),
    );
    expect(byId).toEqual({ free: false, church: false, ministry: true });
  });
});
