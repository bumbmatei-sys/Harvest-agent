import React, { act } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';

import { GMAIL_FEATURE_ENABLED, GMAIL_PAUSED_NOTICE } from '../../lib/gmail-feature';
import { ACTION_HEIGHT } from '../settings/IntegrationsSection';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-339 — the RENDERED Gmail surfaces, with the switch at its real value
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The route half lives in `THE-339.gmail-routes.test.ts`. This is the screen:
 * what an admin sees where the Gmail card used to be, and — the case the brief
 * singles out — what happens to a tenant whose Gmail is STILL CONNECTED when the
 * switch goes off.
 *
 * 🔴 THE ALREADY-CONNECTED TENANT IS THE REASON THIS FILE EXISTS. Hiding the
 * card outright would leave a live OAuth grant on the church's own Google
 * account with nothing in Harvest that can see or withdraw it. "A connection
 * nobody can see or revoke is worse than a visible one" — and worse again for a
 * grant made through an app Google has not verified (THE-194). So the section
 * still asks the status route, still says the connection is live, and still
 * offers Disconnect; what it no longer offers is Connect, a sending address, or
 * any way to send.
 *
 * ⚠️ `happy-dom` HAS NO LAYOUT ENGINE, so nothing here is a measurement and
 * nothing here pretends to be. The touch floor is asserted as the CONTRACT the
 * control carries — `ACTION_HEIGHT`, imported from the section rather than
 * re-spelled — and that constant's real box is measured at five widths by
 * THE-296's browser suite. Re-measuring it here would be a second, weaker copy.
 */

const gmailConnected = vi.hoisted(() => ({ value: false }));

vi.mock('../../firebase', () => ({
  auth: { currentUser: { uid: 'u1', email: 'admin@church.org' } },
  db: {},
  messaging: Promise.resolve(null),
  VAPID_KEY: 'test-vapid-key',
}));
vi.mock('firebase/firestore', () => ({
  doc: () => ({}),
  getDoc: async () => ({ exists: () => true, data: () => ({ tenantId: 'tenant-1' }) }),
  updateDoc: vi.fn(),
}));

/**
 * The status route answers honestly, and every OTHER endpoint throws. A section
 * that still called connect, address or send while Gmail is hidden fails here
 * rather than passing because the call went unnoticed.
 */
const calls = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock('../../utils/auth-fetch', () => ({
  authFetch: vi.fn(async (url: string) => {
    calls.list.push(url);
    if (url.endsWith('/api/composio/gmail/status')) {
      return { ok: true, json: async () => ({ connected: gmailConnected.value, senderEmail: 'admin@church.org' }) };
    }
    if (url.endsWith('/api/composio/gmail/disconnect')) {
      return { ok: true, json: async () => ({ disconnected: true }) };
    }
    return { ok: true, json: async () => ({}) };
  }),
}));
vi.mock('../../utils/tenant-scope', () => ({
  hasPlatformOverride: () => false,
  isSuperAdmin: () => false,
  SUPER_ADMIN_EMAIL: 'founder@theharvest.site',
  getTenantScope: async () => 'tenant-1',
}));

const IntegrationsSection = (await import('../settings/IntegrationsSection')).default;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A paid tier, so the PLAN entitles this tenant to Gmail and only the switch
 *  is doing the hiding. Reading the section on a tier that never had it would
 *  prove nothing. */
const PAID = 'pro';

async function mount(): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    createRoot(host).render(<IntegrationsSection currentPlan={PAID as never} platformOverride={false} />);
  });
  return host;
}

const buttonNamed = (host: HTMLElement, label: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === label);

beforeEach(() => {
  document.body.innerHTML = '';
  calls.list.length = 0;
  gmailConnected.value = false;
  vi.clearAllMocks();
});

describe('the Integrations section while Gmail is hidden', () => {
  it('🔴 the switch is off — every case below describes that state', () => {
    expect(GMAIL_FEATURE_ENABLED).toBe(false);
  });

  it('offers no Connect control and no sending-address field', async () => {
    const host = await mount();
    expect(buttonNamed(host, 'Connect'), 'a Gmail Connect button is still on screen').toBeUndefined();
    expect(host.querySelector('#gmail-sender'), 'the Gmail sending-address field is still on screen').toBeNull();
    expect(host.textContent, 'the send-only promise is still being made for a hidden feature')
      .not.toContain('Send-only access');
    expect(host.textContent, 'the section still invites an admin to connect Gmail')
      .not.toContain('Email a CRM contact from your own Gmail account');
  });

  it('🔴 says what happened rather than rendering an empty region', async () => {
    // The Silent-Failure Rule applied to a screen: a heading over nothing is
    // the visual form of a default that hides the reason.
    const host = await mount();
    expect(host.textContent, 'the section explains nothing').toContain(GMAIL_PAUSED_NOTICE);
    const notice = host.querySelector('[data-gmail-paused]');
    expect(notice, 'the paused state is not composed from the alert primitive').toBeTruthy();
    // role="alert" comes from the primitive and is what carries this to a
    // screen reader rather than only to an eye.
    expect(notice!.getAttribute('role'), 'the notice does not announce itself').toBe('alert');
  });

  it('never calls connect, address or send while it is hidden', async () => {
    await mount();
    for (const forbidden of ['/connect', '/address', '/api/crm/send-email']) {
      expect(calls.list.filter((u) => u.includes(forbidden)),
        `the section called ${forbidden} while Gmail is hidden`).toEqual([]);
    }
  });
});

describe('🔴 an already-connected tenant keeps a visible, revocable connection', () => {
  it('is told the connection is still live', async () => {
    gmailConnected.value = true;
    const host = await mount();
    expect(calls.list.some((u) => u.endsWith('/api/composio/gmail/status')),
      'the section stopped asking whether a grant is still live').toBe(true);
    expect(host.textContent, 'a connected admin is not told their account is still connected')
      .toContain('still connected');
  });

  it('can revoke it, and the control clears the touch floor', async () => {
    gmailConnected.value = true;
    const host = await mount();
    const disconnect = buttonNamed(host, 'Disconnect');
    expect(disconnect, 'a connected admin has no way to revoke the grant').toBeTruthy();

    // The contract, imported rather than re-spelled — see the header.
    expect(ACTION_HEIGHT, 'the shared action height stopped setting a 44px floor').toContain('min-h-[44px]');
    expect(disconnect!.className, 'the only revoke control does not carry the touch floor')
      .toContain('min-h-[44px]');

    await act(async () => { disconnect!.click(); });
    expect(calls.list.some((u) => u.endsWith('/api/composio/gmail/disconnect')),
      'pressing Disconnect did not reach the revoke route').toBe(true);
  });

  it('is offered NO way to send, connect or change its address even while connected', async () => {
    gmailConnected.value = true;
    const host = await mount();
    expect(buttonNamed(host, 'Connect'), 'a connected admin is offered Connect').toBeUndefined();
    expect(host.querySelector('#gmail-sender'), 'a connected admin is offered a sending address').toBeNull();
    expect(buttonNamed(host, 'Change sending address'), 'a connected admin can still change the sender')
      .toBeUndefined();
  });
});
