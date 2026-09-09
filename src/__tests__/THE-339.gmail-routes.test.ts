import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { GMAIL_FEATURE_ENABLED, GMAIL_HIDDEN_MESSAGE } from '../lib/gmail-feature';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-339 — the Gmail routes, with the switch at its REAL value
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * 🔴 NOTHING IS MOCKED ABOUT THE SWITCH HERE. The behavioural suites that own
 * each route (`connect-route`, `address-route`, `send-email-route`) mock
 * `GMAIL_FEATURE_ENABLED` to `true`, deliberately, so the behaviour that must
 * come back when Gmail returns stays fully asserted. This file is the other
 * half: the routes as they actually answer on disk today.
 *
 * ⚠️ "A hidden button over a live route is not a hidden feature." The button on
 * a CRM contact is gone, and that is worth nothing on its own — anyone holding a
 * session cookie can still POST. So the refusal is asserted at the ROUTE, and it
 * is asserted to happen BEFORE authentication: `requireAdmin` is a mock that
 * THROWS if it is ever reached, so a route that authenticated first would fail
 * here rather than pass quietly.
 *
 * ─── What stays reachable, and why it is not an oversight ────────────────────
 *
 * `status` and `disconnect` are NOT gated, and this file asserts that in the
 * same breath. A tenant that connected Gmail before the switch went off still
 * holds a live OAuth grant on its own Google account; 503-ing the revoke path
 * would leave that grant in place with no way to see or withdraw it from inside
 * Harvest, which is strictly worse than a visible connection — more so for a
 * grant made through an app Google has not verified (THE-194). Neither route can
 * create a grant or send a message.
 */

const mockRequireAdmin = vi.fn(() => {
  throw new Error('requireAdmin was reached — the switch did not refuse first');
});
const explode = (name: string) => vi.fn(() => { throw new Error(`${name} was reached while Gmail is hidden`); });

vi.mock('@/lib/api-auth', () => ({ requireAdmin: mockRequireAdmin }));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: explode('adminDb.collection'),
    runTransaction: explode('adminDb.runTransaction'),
  },
}));
vi.mock('@/lib/composio-client', () => ({
  getAuthConfig: explode('getAuthConfig'),
  initiateConnection: explode('initiateConnection'),
  createSignedState: explode('createSignedState'),
  deleteConnection: explode('deleteConnection'),
  getConnectionStatus: explode('getConnectionStatus'),
  verifySignedState: explode('verifySignedState'),
  executeComposioAction: explode('executeComposioAction'),
}));
vi.mock('@/lib/money-path-sentry', () => ({ captureHandledError: vi.fn() }));

/**
 * The four gated handlers, each named by the surface it serves so a failure
 * reads as "the CRM send is reachable" rather than as a path.
 *
 * ⚠️ DISCOVERED BY IMPORT, never by line number. THE-331 pinned
 * `AdminCommunity.tsx:491`; a deletion shifted it to `:311` and the suite would
 * have measured whatever landed there.
 */
const GATED = [
  {
    surface: 'the Gmail connect route — where an OAuth grant would be started',
    load: () => import('../app/api/composio/gmail/connect/route').then((m) => m.POST),
    url: 'https://example.com/api/composio/gmail/connect',
    method: 'POST' as const,
  },
  {
    surface: 'the Gmail OAuth callback — where a grant would be completed',
    load: () => import('../app/api/composio/gmail/callback/route').then((m) => m.GET),
    url: 'https://example.com/api/composio/gmail/callback?state=anything',
    method: 'GET' as const,
  },
  {
    surface: 'the Gmail sending-address route',
    load: () => import('../app/api/composio/gmail/address/route').then((m) => m.POST),
    url: 'https://example.com/api/composio/gmail/address',
    method: 'POST' as const,
  },
  {
    surface: '/api/crm/send-email — THE SEND ITSELF',
    load: () => import('../app/api/crm/send-email/route').then((m) => m.POST),
    url: 'https://example.com/api/crm/send-email',
    method: 'POST' as const,
  },
];

const req = (url: string, method: 'GET' | 'POST') =>
  new NextRequest(url, {
    method,
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify({ subject: 's', body: 'b', contactId: 'c' }) } : {}),
  });

beforeEach(() => { vi.clearAllMocks(); });

describe('every Gmail surface is hidden — the gated routes', () => {
  it('🔴 the switch this file is about is genuinely off', () => {
    // Guards the three cases below from passing for the wrong reason: if the
    // flag were true they would all be asserting against a route that ran.
    expect(GMAIL_FEATURE_ENABLED, 'these cases describe the hidden state').toBe(false);
  });

  it.each(GATED)('$surface refuses with 503', async ({ load, url, method }) => {
    const handler = await load();
    const res = await handler(req(url, method));
    expect(res.status, 'the route answered something other than 503').toBe(503);
    const body = await res.json();
    // 🔴 A FAILURE, NOT NOTHING. The Silent-Failure Rule: a 200 with an empty
    // payload, or a redirect that looks like success, would convert a loud
    // refusal into a quiet lie. It says the feature is temporarily away — 503
    // rather than 404, because the route EXISTS and is coming back.
    expect(body.error, 'the refusal carries no message').toBe(GMAIL_HIDDEN_MESSAGE);
    expect(GMAIL_HIDDEN_MESSAGE.length, 'the message says nothing').toBeGreaterThan(10);
  });

  it.each(GATED)('$surface refuses BEFORE it authenticates or reads anything', async ({ load, url, method }) => {
    const handler = await load();
    await handler(req(url, method));
    // The mocks above throw on contact. A route that authenticated, opened a
    // Firestore read, or reached Composio before consulting the switch would
    // surface that here as a thrown error rather than a 503.
    expect(mockRequireAdmin, 'the route authenticated before refusing').not.toHaveBeenCalled();
  });

  it('🔴 /api/crm/send-email is not reachable with the flag off — named on its own', async () => {
    // Stated as its own case because it is the one the brief singles out: the
    // Email button on a CRM contact is gone, and hiding a button while leaving
    // its route live is not hiding a feature. This is the route, not the button.
    const { POST } = await import('../app/api/crm/send-email/route');
    const res = await POST(req('https://example.com/api/crm/send-email', 'POST'));
    expect(res.status, '/api/crm/send-email is still reachable').toBe(503);
    expect(mockRequireAdmin, 'the send route authenticated before refusing').not.toHaveBeenCalled();
  });
});

describe('🔴 status and disconnect stay reachable, so a live grant is revocable', () => {
  /**
   * Asserted as BEHAVIOUR rather than as an absence. A test that only checked
   * "these two files do not contain the flag" would pass if the routes were
   * deleted, and deleting them is exactly the failure this ticket forbids.
   *
   * The route is reached with an unauthenticated mock that throws, so what is
   * proven is that the handler gets as far as authentication — i.e. no master
   * switch stands in front of it — rather than that it succeeds.
   */
  const REVOCATION = [
    { surface: 'the Gmail status route — how the UI learns a grant is still live',
      load: () => import('../app/api/composio/gmail/status/route').then((m) => m.GET),
      url: 'https://example.com/api/composio/gmail/status', method: 'GET' as const },
    { surface: 'the Gmail disconnect route — the only way left to revoke',
      load: () => import('../app/api/composio/gmail/disconnect/route').then((m) => m.POST),
      url: 'https://example.com/api/composio/gmail/disconnect', method: 'POST' as const },
  ];

  it.each(REVOCATION)('$surface reaches authentication rather than a switch', async ({ load, url, method }) => {
    const handler = await load();
    await handler(req(url, method)).catch(() => undefined);
    expect(mockRequireAdmin, 'a master switch was put in front of the revoke path')
      .toHaveBeenCalled();
  });
});
