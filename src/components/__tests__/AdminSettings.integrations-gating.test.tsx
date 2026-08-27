import React, { act } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * THE-193 — Gmail is unreachable on Individual, so CRM email is a dead end.
 *
 * The founder, on a live Individual (`plus`) tenant: open the CRM, pick a
 * contact, press "Connect your email". It routes to Settings. There is no
 * Integrations section there. The workflow ends.
 *
 * The cause was one flag standing in for three providers. The Integrations
 * accordion row was hidden on `!newsletterAutomation`, but the section holds
 * Instagram and Mailchimp (newsletter) AND Gmail — whose own description reads
 * "Email a CRM contact from your own Gmail account". `plus` is
 * `newsletterAutomation: false` and `crm: true`, so a tier that HAS the CRM
 * could not reach the connection its CRM asks for. PR 333 made it visible by
 * giving `plus` the CRM; the gate had been wrong all along.
 *
 * The fix gates each provider on the feature it serves and DERIVES the
 * section's visibility from the providers it holds, so the next provider added
 * needs no gate logic edited. No plan flag changed — `newsletterAutomation` is
 * still false on `plus`, and test 3 pins that.
 *
 * Targets are named by their label — the accordion row label, the provider
 * card's heading, the CRM button's text — never by a value pattern, so a
 * restyle that keeps the row passes and a removal that keeps the styling fails.
 *
 * Nothing here shells out to git: `actions/checkout` runs at `fetch-depth: 1`,
 * so the runner holds one commit and any `git show`/`git diff` assertion is a
 * local-only pass. Everything below reads the working tree.
 */

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');
const SETTINGS_SRC = path.join(SRC, 'components/AdminSettings.tsx');
const INTEGRATIONS_SRC = path.join(SRC, 'components/settings/IntegrationsSection.tsx');
const CRM_SRC = path.join(SRC, 'components/AdminCRM.tsx');
const read = (p: string) => readFileSync(p, 'utf8');

const scope = vi.hoisted(() => ({ platformOverride: false }));

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
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  getDocs: async () => ({ forEach: () => {} }),
  onSnapshot: () => () => {},
}));
vi.mock('../../utils/auth-fetch', () => ({
  authFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
}));
vi.mock('../../utils/tenant-scope', () => ({
  hasPlatformOverride: () => scope.platformOverride,
  isSuperAdmin: () => false,
  SUPER_ADMIN_EMAIL: 'founder@theharvest.site',
  getTenantScope: async () => 'tenant-1',
}));
vi.mock('next/image', () => ({ default: () => null }));

/**
 * A synthetic tier that owns NONE of the section's providers — test 6. It is
 * built by turning off exactly the features the providers declare, so it stays
 * correct when a provider is added, and it is a plan the app does not ship
 * rather than an edit to one it does: no shipped flag value is touched.
 */
const NO_PROVIDER_PLAN = 'no-provider-tier';
/**
 * The provider list, reached WITHOUT importing integration-providers from
 * inside this factory. THE-225 gave that module a runtime import of
 * `isUnpricedTier` from plan-features — a plain one-way dependency in the app,
 * but importing it from within plan-features' own mock factory would re-enter
 * the module being mocked and deadlock the run. The list is still DERIVED (the
 * file-level import below fills this holder), so a provider added tomorrow is
 * still stripped here with nothing to remember; it is just read at call time
 * rather than at factory time.
 */
const providers = vi.hoisted(() => ({ list: [] as { feature: string }[] }));
vi.mock('../../utils/plan-features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/plan-features')>();
  return {
    ...actual,
    getPlanFeatures: (plan: string) => {
      const base = actual.getPlanFeatures((plan === NO_PROVIDER_PLAN ? 'plus' : plan) as never);
      if (plan !== NO_PROVIDER_PLAN) return base;
      const stripped = { ...base } as Record<string, unknown>;
      for (const provider of providers.list) stripped[provider.feature] = false;
      return stripped;
    },
  };
});

import AdminSettings from '../AdminSettings';
import type { PlanFeatures } from '../../utils/plan-features';
import { getPlanFeatures, PLAN_DISPLAY_NAMES } from '../../utils/plan-features';
import {
  INTEGRATION_PROVIDERS,
  hasAnyIntegrationProvider,
  isProviderAvailable,
  getIntegrationProvider,
} from '../settings/integration-providers';
import type { TenantPlan } from '../../types/tenant.types';

// Fills the holder the plan-features mock reads — see the note on `providers`.
providers.list = INTEGRATION_PROVIDERS as unknown as { feature: string }[];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── rendering ───────────────────────────────────────────────────────────────

async function mount(plan: string): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <AdminSettings
        onBack={() => {}}
        currentPlan={plan as TenantPlan}
        onChangePlan={() => {}}
        onCancelPlan={() => {}}
        tenantId="tenant-1"
        email="admin@church.org"
        isPlanOwner
        onCustomizeNav={() => {}}
        onOpenDonations={() => {}}
      />,
    );
  });
  await act(async () => { await Promise.resolve(); });
  return host;
}

/** The accordion row with this visible label, or null. Rows are found by their
 *  label text, never by a class or an id attribute. */
function rowHeader(host: HTMLElement, label: string): HTMLButtonElement | null {
  return (Array.from(host.querySelectorAll('button')).find(
    (b) => (b.textContent || '').trim().startsWith(label),
  ) as HTMLButtonElement | undefined) ?? null;
}

/** Open a row by label. Accordion content is only in the DOM while expanded. */
async function expandSection(host: HTMLElement, label: string): Promise<void> {
  const header = rowHeader(host, label);
  expect(header, `no accordion row labelled "${label}"`).toBeTruthy();
  await act(async () => { header!.click(); });
}

/** Is a provider's card on screen? Found by the card's own heading text. */
function hasProviderCard(host: HTMLElement, label: string): boolean {
  return Array.from(host.querySelectorAll('p')).some(
    (p) => (p.textContent || '').trim() === label,
  );
}

/** Every provider card visible in the open Integrations section, in order. */
function visibleProviderCards(host: HTMLElement): string[] {
  return INTEGRATION_PROVIDERS.filter(p => hasProviderCard(host, p.label)).map(p => p.label);
}

/** Open Integrations on `plan` and report which provider cards are rendered. */
async function providersOn(plan: string): Promise<string[]> {
  const host = await mount(plan);
  await expandSection(host, 'Integrations');
  return visibleProviderCards(host);
}

const ALL_PLANS: TenantPlan[] = ['plus', 'pro', 'max'];
const INDIVIDUAL: TenantPlan = 'plus';
const SMALL_TEAM: TenantPlan = 'pro';

beforeEach(() => {
  scope.platformOverride = false;
  document.body.innerHTML = '';
});

describe('THE-193 — Integrations gating', () => {
  // 1 ── 🔴 the regression the founder hit
  it('an Individual tenant sees the Integrations section', async () => {
    // Named by tier label, so the test says what a human would say.
    expect(PLAN_DISPLAY_NAMES[INDIVIDUAL]).toBe('Individual');
    const host = await mount(INDIVIDUAL);
    expect(rowHeader(host, 'Integrations'), 'Individual has no Integrations row in Settings').toBeTruthy();
  });

  // 2
  it('an Individual tenant sees the Gmail provider', async () => {
    expect(await providersOn(INDIVIDUAL)).toContain('Gmail');
  });

  // 3 ── 🔴 the flags did not change
  it('an Individual tenant does not see Instagram or Mailchimp', async () => {
    const shown = await providersOn(INDIVIDUAL);
    expect(shown, 'Individual was given a newsletter provider').not.toContain('Instagram');
    expect(shown, 'Individual was given a newsletter provider').not.toContain('Mailchimp');

    // The gate moved; the entitlement did not. Individual still has no
    // newsletter and still has the CRM.
    const features = getPlanFeatures(INDIVIDUAL);
    expect(features.newsletterAutomation, 'Individual was given the newsletter').toBe(false);
    expect(features.crm, 'Individual lost the CRM').toBe(true);
  });

  // 4
  it('a Small Team tenant sees all three', async () => {
    expect(PLAN_DISPLAY_NAMES[SMALL_TEAM]).toBe('Small Team');
    expect(await providersOn(SMALL_TEAM)).toEqual(INTEGRATION_PROVIDERS.map(p => p.label));
  });

  // 5
  it('a super admin still sees everything through platformOverride', async () => {
    scope.platformOverride = true;
    // On the tier that owns the fewest providers, and on one that owns none.
    for (const plan of [INDIVIDUAL, NO_PROVIDER_PLAN]) {
      document.body.innerHTML = '';
      const host = await mount(plan);
      expect(rowHeader(host, 'Integrations'), `platformOverride lost the section on ${plan}`).toBeTruthy();
      await expandSection(host, 'Integrations');
      expect(visibleProviderCards(host), `platformOverride lost a provider on ${plan}`)
        .toEqual(INTEGRATION_PROVIDERS.map(p => p.label));
    }

    // And the override is applied at every gate, in the shape it always had.
    const settings = read(SETTINGS_SRC);
    const gate = settings.match(/id: 'integrations',[\s\S]*?hidden: ([^\n]*)/)![1];
    expect(gate, 'the Integrations row no longer honours platformOverride').toContain('!platformOverride &&');
    expect(read(INTEGRATIONS_SRC), 'a provider card no longer honours platformOverride')
      .toMatch(/isPlatformOverride \|\|/);
  });

  // 6
  it('the section is hidden when no provider inside it is available', async () => {
    const stripped = getPlanFeatures(NO_PROVIDER_PLAN as TenantPlan);
    for (const provider of INTEGRATION_PROVIDERS) {
      expect(stripped[provider.feature], `${provider.label} is still entitled on the stripped tier`).toBe(false);
    }
    expect(hasAnyIntegrationProvider(stripped, NO_PROVIDER_PLAN)).toBe(false);

    const host = await mount(NO_PROVIDER_PLAN);
    expect(rowHeader(host, 'Integrations'), 'the section is shown with nothing inside it').toBeNull();
  });

  // 7
  it('section visibility is derived from the providers, not a hardcoded flag list', () => {
    // (a) What the section's gate reads is exactly the set of features the
    //     providers declare — recorded, not asserted by name.
    const readKeys = new Set<string>();
    // Answers false for everything, so every provider is consulted rather than
    // the walk short-circuiting on the first hit.
    const probe = new Proxy({} as PlanFeatures, {
      get(_t, key: string) { readKeys.add(key); return false; },
    });
    expect(hasAnyIntegrationProvider(probe, INDIVIDUAL)).toBe(false);
    expect([...readKeys].sort()).toEqual([...new Set(INTEGRATION_PROVIDERS.map(p => p.feature))].sort());

    // (b) Adding a provider changes the answer with no gate edited. A tenant
    //     entitled to nothing the shipped providers use still sees the section
    //     once a provider it DOES own joins the list.
    const nothing = Object.fromEntries(
      INTEGRATION_PROVIDERS.map(p => [p.feature, false]),
    ) as unknown as PlanFeatures;
    expect(hasAnyIntegrationProvider(nothing, INDIVIDUAL)).toBe(false);
    const withNewProvider = { ...nothing, blog: true } as PlanFeatures;
    expect(hasAnyIntegrationProvider(withNewProvider, INDIVIDUAL), 'a flag no provider uses turned the section on').toBe(false);

    // (c) The gate names no plan feature of its own — it delegates to the
    //     derivation. A restored `!currentFeatures?.newsletterAutomation`
    //     fails here as well as at test 1.
    const gate = read(SETTINGS_SRC).match(/id: 'integrations',[\s\S]*?hidden: ([^\n]*)/)![1];
    for (const key of Object.keys(getPlanFeatures(INDIVIDUAL))) {
      expect(gate, `the section gate hardcodes the ${key} flag`).not.toContain(key);
    }
    expect(gate).toContain('hasAnyIntegrationProvider(');
  });

  // 8 ── 🔴 the end-to-end guard, and the thing the founder actually hit
  it("the CRM's Connect your email button leads somewhere reachable on every tier that has CRM", async () => {
    const crm = read(CRM_SRC);

    // The button exists, is offered when Gmail is not connected, and routes to
    // Settings. Named by its label.
    const promptAt = crm.indexOf('gmailConnected === false');
    expect(promptAt, 'the CRM no longer branches on an unconnected Gmail').toBeGreaterThan(-1);
    const button = crm.slice(promptAt, crm.indexOf('</button>', promptAt));
    expect(button, 'the CRM no longer offers a "Connect your email" button').toContain('Connect your email');
    const destination = button.match(/navigate\('([^']+)'\)/);
    expect(destination, 'the button no longer navigates anywhere').not.toBeNull();
    expect(destination![1]).toBe('/admin/settings');

    // …and Settings is where the Gmail connection lives, on every tier whose
    // plan includes the CRM. That is the whole round trip.
    const gmail = getIntegrationProvider('gmail');
    for (const plan of ALL_PLANS) {
      const features = getPlanFeatures(plan);
      if (!features.crm) continue;
      expect(isProviderAvailable(gmail, features, plan), `${PLAN_DISPLAY_NAMES[plan]} has the CRM but not Gmail`).toBe(true);
      expect(hasAnyIntegrationProvider(features, plan), `${PLAN_DISPLAY_NAMES[plan]} has the CRM but no Integrations section`).toBe(true);

      document.body.innerHTML = '';
      const host = await mount(plan);
      expect(rowHeader(host, 'Integrations'), `${PLAN_DISPLAY_NAMES[plan]} lands on a Settings page with no Integrations`).toBeTruthy();
      await expandSection(host, 'Integrations');
      expect(hasProviderCard(host, 'Gmail'), `${PLAN_DISPLAY_NAMES[plan]} cannot reach Gmail from Settings`).toBe(true);
    }
  });

  // 9
  it('Gmail remains per-admin with no primary concept', async () => {
    const integrations = read(INTEGRATIONS_SRC);
    // The two providers that DO have a tenant-wide primary still have one.
    expect(integrations).toContain('primaryInstagramAdmin');
    expect(integrations).toContain('primaryMailchimpAdmin');
    // Gmail has none, anywhere in the app.
    expect(integrations, 'Gmail grew a primary').not.toMatch(/primaryGmail/i);

    // And the rendered Gmail card offers no "Make Primary" affordance, on the
    // tier that sees all three (so the control exists on screen for the others).
    const host = await mount(SMALL_TEAM);
    await expandSection(host, 'Integrations');
    const gmailCard = Array.from(host.querySelectorAll('div')).find((d) =>
      Array.from(d.querySelectorAll('p')).some(p => (p.textContent || '').trim() === 'Gmail') &&
      (d.textContent || '').includes('Send-only access'),
    );
    expect(gmailCard, 'no Gmail card on a tier that has every provider').toBeTruthy();
    expect(gmailCard!.textContent, 'the Gmail card offers a Primary affordance').not.toContain('Make Primary');
    expect(gmailCard!.textContent, 'the Gmail card claims a Primary status').not.toContain('Primary');
  });

  // 10
  it('no OAuth route or send-email path changed', () => {
    // (a) Every provider endpoint the section owns is still called from it.
    const integrations = read(INTEGRATIONS_SRC);
    for (const provider of ['instagram', 'mailchimp', 'gmail']) {
      for (const verb of ['status', 'connect', 'disconnect']) {
        expect(integrations, `/api/composio/${provider}/${verb} is no longer called`)
          .toContain(`/api/composio/${provider}/${verb}`);
      }
    }
    expect(integrations, 'the Gmail sending-address route is no longer called')
      .toContain('/api/composio/gmail/address');

    // (b) The routes themselves gate on no plan feature — the fix is a gate
    //     fix on the client, and there was never a server-side plan check to
    //     match. If one is ever added, this fails and the client gate becomes
    //     cosmetic.
    const ROUTES = [
      'app/api/composio/gmail/connect/route.ts',
      'app/api/composio/gmail/callback/route.ts',
      'app/api/composio/gmail/status/route.ts',
      'app/api/composio/gmail/disconnect/route.ts',
      'app/api/composio/gmail/address/route.ts',
      'app/api/crm/send-email/route.ts',
    ];
    for (const rel of ROUTES) {
      const src = read(path.join(SRC, rel));
      expect(src, `${rel} now imports plan features`).not.toMatch(/plan-features/);
      for (const call of ['getPlanFeatures', 'getEffectiveFeatures', 'hasFeature', 'FEATURE_MAP']) {
        expect(src, `${rel} now gates on ${call}`).not.toContain(call);
      }
    }

    // (c) The CRM prompt is still driven by the send-email route's own code.
    expect(read(path.join(SRC, 'app/api/crm/send-email/route.ts'))).toContain('not_connected');
    expect(read(CRM_SRC), "the CRM no longer reacts to the route's not_connected code")
      .toContain("data?.code === 'not_connected'");
  });

  // 11
  it('the accordion grouping and Danger Zone separation are unchanged', () => {
    const src = read(SETTINGS_SRC);
    const ids = Array.from(src.matchAll(/^\s+id: '([\w-]+)',$/gm)).map((m) => m[1]);
    expect(ids, 'a row was added, removed or reordered').toEqual([
      'appearance', 'payments', 'onboarding', 'giving-statements',
      'sms', 'ai-assistant', 'integrations', 'cancel-plan',
    ]);

    const groups = Array.from(src.matchAll(/^\s+group: '([^']+)',$/gm)).map((m) => m[1]);
    expect(groups, 'a region label changed').toEqual([
      'Appearance', 'Payments', 'Church Setup', 'Church Setup', 'Connected Services',
      'Connected Services', 'Connected Services', 'Danger Zone',
    ]);
    // Integrations is still the last Connected Services row, and Cancel is
    // still alone in its own region.
    expect(groups.filter(g => g === 'Danger Zone')).toHaveLength(1);
    expect(ids[groups.indexOf('Danger Zone')]).toBe('cancel-plan');

    // The THE-183 comment explaining why Cancel stays where it is survives.
    expect(src, 'the Danger Zone rationale was deleted')
      .toContain('is that Cancel is SEPARATED, explicitly "not merely last"');
  });
});
