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
import { NEWSLETTER_FEATURE_ENABLED } from '../../lib/newsletter-feature';
import { GMAIL_FEATURE_ENABLED, GMAIL_PAUSED_NOTICE } from '../../lib/gmail-feature';
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
  it('an Individual tenant sees the Gmail provider exactly while the switch allows it', async () => {
    // 🔴 THE-339 — DERIVED, not restated. THE-193's claim was that Individual —
    // a tier that HAS the CRM — reaches Gmail from Settings, and that claim is
    // unchanged behind the switch: the plan gate below still says yes. What
    // changed is that a master switch now sits ahead of it, so the CARD is
    // absent while Gmail is hidden and returns in the same motion that flips
    // the flag. Asserting the flag's own value here would make this a copy of
    // test 1 in THE-339's suite; asserting the RELATIONSHIP is what this file
    // is for, and it fails in either direction.
    const shown = await providersOn(INDIVIDUAL);
    if (GMAIL_FEATURE_ENABLED) expect(shown, 'Individual lost Gmail').toContain('Gmail');
    else expect(shown, 'Gmail is hidden but its card is still on screen').not.toContain('Gmail');

    // The ENTITLEMENT is untouched by the switch, which is what makes the flip
    // back a restoration rather than a re-derivation.
    const features = getPlanFeatures(INDIVIDUAL);
    expect(features.crm, 'Individual lost the CRM').toBe(true);
    expect(isProviderAvailable(getIntegrationProvider('gmail'), features, INDIVIDUAL),
      'the Gmail plan gate moved rather than the switch doing the hiding').toBe(true);
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

/** 🔴 THE-335 — the providers a tier may see, once the master switches have had
 *  their say. `NEWSLETTER_FEATURE_ENABLED` hides every `concern: 'newsletter'`
 *  provider from EVERY tier and from the platform override too, in the shape the
 *  SMS nav entry uses: the switch is ahead of the plan gate, so Instagram and
 *  Mailchimp are absent for everyone while the newsletter is a coming-soon
 *  entry.
 *
 *  🔴 THE-339 — AND GMAIL IS NOW HIDDEN TOO, ON ITS OWN SWITCH. The sentence
 *  that stood here said Gmail was unaffected because "it is the transport a rota
 *  invitation goes out on — the founder's stated replacement for SMS". THE-340
 *  moved rota invitations onto Resend, from a Harvest-controlled sender, so that
 *  reason no longer holds and is corrected rather than left to mislead: a
 *  volunteer's serving invitation does not depend on any church's Gmail.
 *
 *  Derived from the flags rather than hardcoded, so each provider returns to the
 *  expected set in the same motion that turns its feature back on — and so this
 *  list cannot silently agree with a component that hides the wrong one. */
const EXPECTED_PROVIDERS = INTEGRATION_PROVIDERS
  .filter((p) => NEWSLETTER_FEATURE_ENABLED || p.concern !== 'newsletter')
  .filter((p) => GMAIL_FEATURE_ENABLED || p.id !== 'gmail')
  .map((p) => p.label);

  // 4
  it('a Small Team tenant sees every provider a switch has not withheld', async () => {
    expect(PLAN_DISPLAY_NAMES[SMALL_TEAM]).toBe('Small Team');
    expect(await providersOn(SMALL_TEAM)).toEqual(EXPECTED_PROVIDERS);
    // 🔴 THE ENTITLEMENT IS UNTOUCHED behind the switch: Small Team still owns
    // `newsletterAutomation`, so flipping the flag restores both providers here
    // rather than an approximation of them.
    expect(getPlanFeatures(SMALL_TEAM).newsletterAutomation).toBe(true);
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
      // 🔴 THE-335 — the override reaches every provider a PLAN gate would have
      // withheld, and none that a MASTER SWITCH withholds. That asymmetry is the
      // point of both mechanisms: an override is a plan override, and a hidden
      // feature is hidden from the super admin too.
      expect(visibleProviderCards(host), `platformOverride lost a provider on ${plan}`)
        .toEqual(EXPECTED_PROVIDERS);
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

    // 🔴 THE-339 — THE DEAD END IS CLOSED FROM THE OTHER SIDE WHILE GMAIL IS
    // HIDDEN, and that has to be asserted rather than assumed. THE-193's hole
    // was a button pointing at a section that was not there. With the switch off
    // the button is not rendered at all, so there is no journey to strand — and
    // the source-level half above still proves the button and its destination
    // survive intact for the flip back.
    const crmGate = crm.slice(Math.max(0, crm.indexOf('const canConnectGmail')), crm.indexOf('const canConnectGmail') + 700);
    expect(crmGate, 'the CRM email affordance stopped reading the Gmail switch')
      .toContain('GMAIL_FEATURE_ENABLED &&');

    // …and Settings is where the Gmail connection lives, on every tier whose
    // plan includes the CRM. That is the whole round trip, and the PLAN half of
    // it is untouched by the switch: every CRM tier is still entitled to Gmail,
    // which is what makes the flip back a restoration.
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
      if (GMAIL_FEATURE_ENABLED) {
        expect(hasProviderCard(host, 'Gmail'), `${PLAN_DISPLAY_NAMES[plan]} cannot reach Gmail from Settings`).toBe(true);
      } else {
        expect(hasProviderCard(host, 'Gmail'), `${PLAN_DISPLAY_NAMES[plan]} still has a Gmail card while Gmail is hidden`).toBe(false);
        // 🔴 …and the section is not a heading over nothing. It says what
        // happened, which is the difference between hiding a feature and
        // silently dropping one.
        expect(host.textContent, `${PLAN_DISPLAY_NAMES[plan]} is shown an Integrations section that explains nothing`)
          .toContain(GMAIL_PAUSED_NOTICE);
      }
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
    //
    // 🔴 THE-339 — the SOURCE half above is the durable claim and is asserted
    // unconditionally: `primaryGmail` appears nowhere whether or not the card is
    // on screen. The RENDERED half can only be measured when there is a card to
    // measure, so while the switch is off it is replaced by the stronger
    // statement that there is no Gmail card at all — which is checked here
    // rather than skipped, so this case can never pass by finding nothing.
    const host = await mount(SMALL_TEAM);
    await expandSection(host, 'Integrations');
    const gmailCard = Array.from(host.querySelectorAll('div')).find((d) =>
      Array.from(d.querySelectorAll('p')).some(p => (p.textContent || '').trim() === 'Gmail') &&
      (d.textContent || '').includes('Send-only access'),
    );
    if (!GMAIL_FEATURE_ENABLED) {
      expect(gmailCard, 'a Gmail card is on screen while Gmail is hidden').toBeUndefined();
      expect(host.textContent, 'the send-only promise is still being made for a hidden feature')
        .not.toContain('Send-only access');
      return;
    }
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
    // ⚠️ 'ai-assistant' WAS BETWEEN 'sms' AND 'integrations'. That row rendered
    // AiAssistantSection behind AI_TELEGRAM_ASSISTANT_ENABLED, and both went
    // with the Telegram assistant in THE-253. The ORDER of everything else is
    // unchanged, which is what this guard is for: a removal must not be cover
    // for a reorder.
    expect(ids, 'a row was added, removed or reordered').toEqual([
      'appearance', 'payments', 'onboarding', 'giving-statements',
      'sms', 'integrations', 'cancel-plan',
    ]);

    const groups = Array.from(src.matchAll(/^\s+group: '([^']+)',$/gm)).map((m) => m[1]);
    // Connected Services is TWO rows now, not three — the AI Assistant row
    // went with the Telegram assistant (THE-253). No region label changed and
    // none was emptied: SMS and Integrations still carry it.
    expect(groups, 'a region label changed').toEqual([
      'Appearance', 'Payments', 'Church Setup', 'Church Setup',
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
