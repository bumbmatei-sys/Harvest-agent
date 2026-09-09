import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import fs from 'node:fs';
import path from 'node:path';

/**
 * THE-250 — the "SMS (Twilio)" Settings row, the last SMS label in the app.
 *
 * ─── What was left ───────────────────────────────────────────────────────────
 *
 * THE-245 hid every SMS surface behind `SMS_FEATURE_ENABLED` and reported two it
 * could not reach, because the files belonged to tickets in flight. This one was
 * `components/AdminSettings.tsx`: the sidebar row survived with its plan gate
 * only, so a paid tenant opened "Connected Services → SMS (Twilio)" and got an
 * EMPTY PANEL — `SmsSection` already rendered `null`. A Connected Service that
 * connects nothing, on the screen whose entire job is to say what is connected.
 *
 * ⚠️ THE ROW WAS NEVER A LEAK, and this file does not claim it was. No credential
 * could be entered (the form was not mounted, so it made no `/api/sms/config`
 * request), and the route refuses with 503 regardless. It was a false claim, and
 * this site has been corrected for those six times.
 *
 * ─── The idiom, and why this one and not another ─────────────────────────────
 *
 * MASTER SWITCH FIRST, plan clause untouched behind it:
 *
 *     hidden: !SMS_FEATURE_ENABLED || (!platformOverride && !currentFeatures?.smsAutomation)
 *
 * That is the shape AdminDashboard's nav entry already uses for this same
 * feature ("Master switch first, exactly as the Affiliate entry below does it")
 * and the shape the AI Assistant row two entries down uses for its own switch
 * (`hidden: !AI_TELEGRAM_ASSISTANT_ENABLED`). It ignores `platformOverride` for
 * the reason that row does: an override is a PLAN override, and no tier — super
 * admin included — can use a feature the server answers 503 to.
 *
 * 🔴 THE PLAN CLAUSE IS UNCHANGED, and that is the hide-not-delete guarantee.
 * `smsAutomation` keeps its `PLAN_FEATURES` values, so flipping the switch
 * restores the IDENTICAL entitlement rather than an approximation of it — which
 * is what the second describe below renders, rather than reasoning about.
 *
 * ⚠️ Assertions are on RENDERED OUTPUT, read off the accordion's real rows and
 * region headings, never off the `sections` array — a row filtered out of the
 * constant but still drawn by some other path would pass a constants test.
 */

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

import type { TenantPlan } from '../../types/tenant.types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.resolve(__dirname, '../../..');
const readSrc = (rel: string) => fs.readFileSync(path.join(ROOT, 'src', rel), 'utf8');

const PRICED: TenantPlan[] = ['plus', 'pro', 'max'];
/** ⚠️ THE LABEL LOST ITS VENDOR — THE-314. It read "SMS (Twilio)" when a church
 *  connected its own Twilio account and the parenthetical told it whose
 *  credentials the panel wanted. Harvest now RESELLS on one account, so there
 *  is no vendor for a church to have heard of. */
const SMS_ROW = 'SMS';

/** The tiers that own `smsAutomation` after THE-314 made SMS Ministry-only.
 *  Individual and Small Team both lost it. */
const SMS_TIERS: TenantPlan[] = ['max'];
const NON_SMS_TIERS: TenantPlan[] = ['free', 'plus', 'pro'];

/**
 * Load AdminSettings with `SMS_FEATURE_ENABLED` forced to `enabled`.
 *
 * The `doMock` + `resetModules` + dynamic-import shape is the one
 * `affiliate-flag-minor-surfaces.test.tsx` established for asking the same
 * question under both settings of one boolean. It is what lets "the row is
 * gone" and "the row is back" be the SAME assertion in this file rather than
 * two files that could drift apart.
 */
async function loadSettings(enabled: boolean) {
  vi.resetModules();
  vi.doMock('../../lib/sms-feature', () => ({
    SMS_FEATURE_ENABLED: enabled,
    SMS_HIDDEN_MESSAGE: 'SMS is temporarily unavailable.',
  }));
  return (await import('../AdminSettings')).default;
}

let container: HTMLDivElement;
let root: Root | null = null;

async function mount(plan: TenantPlan, enabled: boolean): Promise<HTMLElement> {
  const AdminSettings = await loadSettings(enabled);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <AdminSettings
        onBack={() => {}}
        currentPlan={plan}
        tenantId="tenant-1"
        email="admin@church.org"
        isPlanOwner
        onCustomizeNav={() => {}}
        onOpenDonations={() => {}}
      />,
    );
  });
  await act(async () => { await Promise.resolve(); });
  return container;
}

/** The accordion's rows, in document order, by the label a visitor reads. */
function rows(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('[data-settings-row]')).map(
    (row) => (row.querySelector('button > span:nth-child(2)')?.textContent || '').trim(),
  );
}

/** The region headings the accordion actually drew, in order. */
function regions(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('[data-settings-region]'))
    .map((r) => r.getAttribute('data-settings-region') || '')
    .filter((label) => label !== 'ungrouped');
}

beforeEach(() => {
  scope.platformOverride = false;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container.remove();
  vi.doUnmock('../../lib/sms-feature');
});

/* ── 1 ─────────────────────────────────────────────────────────────────────
   🔴 The row does not render while the switch is off.                        */
describe('1 — the SMS settings row does not render while the switch is off', () => {
  for (const plan of PRICED) {
    it(`${plan}: no "SMS" row, and no Twilio label anywhere on the screen`, async () => {
      const host = await mount(plan, false);
      expect(rows(host), `${plan} still lists the SMS row`).not.toContain(SMS_ROW);
      // Read as a visitor reads it, in case the label is ever reworded: no
      // mention of Twilio survives on the screen at all.
      expect(host.textContent || '', `${plan} still names Twilio`).not.toMatch(/twilio/i);
    });
  }

  it('🔴 a platform override does NOT bring it back — the switch is absolute', async () => {
    // The plan clause honours `platformOverride`; the master switch in front of
    // it does not, exactly as AI_TELEGRAM_ASSISTANT_ENABLED does not. A super
    // admin cannot use a feature the server answers 503 to either, so showing
    // them the row would be the same empty panel with a better excuse.
    scope.platformOverride = true;
    const host = await mount('max', false);
    expect(rows(host)).not.toContain(SMS_ROW);
    expect(host.textContent || '').not.toMatch(/twilio/i);
  });

  it('free is unmoved — it never had the row, and still does not', async () => {
    const host = await mount('free', false);
    expect(rows(host)).not.toContain(SMS_ROW);
  });
});

/* ── 2 ─────────────────────────────────────────────────────────────────────
   🔴 THE HIDE-NOT-DELETE GUARANTEE. One value, and the row is back.          */
describe('2 — flipping the switch on restores it, on the tier that owns it', () => {
  // ⚠️ THE-245 RESTORED IT TO ALL THREE PRICED TIERS. THE-314 narrowed the plan
  // clause behind the switch, so the row now returns on Ministry alone — the
  // two halves are independent and both are asserted, which is the point of
  // mounting under both settings of the boolean rather than trusting either.
  for (const plan of SMS_TIERS) {
    it(`${plan}: the row returns, in its own place, with its panel`, async () => {
      const host = await mount(plan, true);
      expect(rows(host), `${plan} did not get the SMS row back`).toContain(SMS_ROW);
    });
  }

  for (const plan of NON_SMS_TIERS) {
    it(`🔴 ${plan}: the row stays away even with the switch ON — the plan gate holds`, async () => {
      const host = await mount(plan, true);
      expect(rows(host), `${plan} got a row for a capability it does not own`).not.toContain(SMS_ROW);
    });
  }

  it('🔴 returns under "Connected Services", not appended somewhere new', async () => {
    const host = await mount('max', true);
    const order = rows(host);
    // Position is the claim: THE-183's regions ARE the array order, so a row
    // that came back in the wrong place would silently re-file itself into a
    // different region even though its `group` never changed.
    expect(order.indexOf(SMS_ROW)).toBeGreaterThan(order.indexOf('Giving Statements'));
    expect(order.indexOf(SMS_ROW)).toBeLessThan(order.indexOf('Integrations'));
    expect(regions(host)).toContain('Connected Services');
  });

  it('🔴 comes back on exactly the tiers that own `smsAutomation`', async () => {
    // Derived from the matrix rather than restated, so the row and the cell
    // cannot drift: THE-314 moved the cell and this assertion followed it
    // without being edited.
    const { getPlanFeatures } = await import('../../utils/plan-features');
    for (const plan of ['free', ...PRICED] as TenantPlan[]) {
      const host = await mount(plan, true);
      const owns = !!getPlanFeatures(plan)?.smsAutomation;
      expect(rows(host).includes(SMS_ROW), `${plan}: row vs smsAutomation disagree`).toBe(owns);
      act(() => { root?.unmount(); });
      root = null;
      container.innerHTML = '';
    }
  });

  it('and the row behind it opens onto real content, not an empty panel', async () => {
    const host = await mount('max', true);
    const header = Array.from(host.querySelectorAll('button')).find(
      (b) => (b.textContent || '').trim().startsWith(SMS_ROW),
    );
    expect(header, 'the restored row has no accordion header').toBeTruthy();
    await act(async () => { header!.click(); });
    /**
     * 🔴 THIS SUITE'S CLAIM IS "THE ROW DOES NOT OPEN ONTO NOTHING", and that
     * is exactly what is still asserted — only the content changed.
     *
     * ⚠️ THE-314 replaced a credential form with the number purchase panel, so
     * "buy a number" was the proof then. THE-327 moved that whole lifecycle
     * into the SMS section, because a church had to buy its number three
     * levels deep in Settings and then go somewhere else to send. What is here
     * now is the signpost that says so — one sentence and a link — which is
     * still real content and is still not an empty panel. The purchase
     * controls are asserted where they now live, in THE-327's own suite.
     */
    const text = host.textContent || '';
    expect(text, 'the restored row is empty — the defect THE-250 exists for')
      .toMatch(/managed in the SMS section/i);
    expect(host.querySelector('a[href="/admin/sms"]'), 'the signpost points nowhere').toBeTruthy();
    expect(text, 'the panel names a vendor a church never sees').not.toMatch(/twilio/i);
  });
});

/* ── 3 ─────────────────────────────────────────────────────────────────────
   STOP 5 — the hide breaks neither the ordering nor THE-183's grouping.      */
describe('3 — hiding the row breaks no ordering and orphans no heading', () => {
  it('every other row keeps its place, in the same order', async () => {
    const off = rows(await mount('max', false));
    act(() => { root?.unmount(); }); root = null; container.innerHTML = '';
    const on = rows(await mount('max', true));
    // The ONLY difference between the two renders is the SMS row itself.
    expect(on.filter((r) => r !== SMS_ROW)).toEqual(off);
    expect(on).toContain(SMS_ROW);
  });

  it('🔴 "Connected Services" survives — the heading is not orphaned', async () => {
    // SettingsAccordion draws a heading above the first VISIBLE row carrying
    // the label, so a region is at risk only when ALL its rows go. Connected
    // Services holds SMS, AI Assistant (hidden by its own flag) and
    // Integrations — Integrations keeps the region alive on the priced tiers.
    const host = await mount('max', false);
    expect(regions(host)).toContain('Connected Services');
    expect(rows(host)).toContain('Integrations');
  });

  it('the region order is identical with the switch off and on', async () => {
    const off = regions(await mount('max', false));
    act(() => { root?.unmount(); }); root = null; container.innerHTML = '';
    const on = regions(await mount('max', true));
    expect(off).toEqual(on);
  });
});

/* ── 4 ─────────────────────────────────────────────────────────────────────
   🔴 One switch, no data touched, no flag value or price changed.            */
describe('4 — one switch, and nothing else moved', () => {
  it('🔴 the row reads the ONE switch — no second flag was invented', async () => {
    const src = readSrc('components/AdminSettings.tsx');
    expect(src).toMatch(
      /hidden:\s*!SMS_FEATURE_ENABLED\s*\|\|\s*\(!platformOverride && !currentFeatures\?\.smsAutomation\)/,
    );
    expect(src).toContain("import { SMS_FEATURE_ENABLED } from '../lib/sms-feature'");
    // The one name, and no sibling with a similar one.
    const smsFlags = [...src.matchAll(/\b[A-Z][A-Z0-9_]*SMS[A-Z0-9_]*\b|\bSMS_[A-Z0-9_]+\b/g)]
      .map((m) => m[0]);
    expect([...new Set(smsFlags)]).toEqual(['SMS_FEATURE_ENABLED']);
  });

  it('🔴 the switch itself is FALSE again, and still the only declaration', async () => {
    // ⚠️ THE-314 FLIPPED IT ON, THE-335 FLIPPED IT BACK OFF. The "only
    // declaration" half is what this assertion has always really been for and it
    // is unchanged by either: one boolean, one place.
    //
    // 🔴 READ OFF THE SOURCE, NOT OFF THE MOCK. This file mocks the module ON so
    // the settings row can be measured, so the literal in the file is the only
    // honest place to ask what the switch actually says.
    const src = readSrc('lib/sms-feature.ts');
    expect(src).toMatch(/^export const SMS_FEATURE_ENABLED = false;$/m);
    expect(src.match(/SMS_FEATURE_ENABLED\s*=/g)).toHaveLength(1);
  });

  it('🔴 the plan matrix is Ministry-only — smsAutomation and textToGive together', async () => {
    // ⚠️ REVERSED. THE-245 pinned these true on all three priced tiers, because
    // the gate sat IN FRONT of the matrix and never edited it. THE-314 edited
    // the matrix itself: Harvest resells and pays for every segment, so the cell
    // decides who may spend Harvest's money and the founder's call is Ministry.
    // The two cells move together — Text-to-Give is inbound SMS end to end.
    const { getPlanFeatures } = await import('../../utils/plan-features');
    expect(PRICED.map((p) => !!getPlanFeatures(p)?.smsAutomation)).toEqual([false, false, true]);
    expect(getPlanFeatures('free')?.smsAutomation).toBeFalsy();
    expect(PRICED.map((p) => !!getPlanFeatures(p)?.textToGive)).toEqual([false, false, true]);
    expect(getPlanFeatures('free')?.textToGive).toBeFalsy();
  });

  it('🔴 no price changed', async () => {
    const { PLAN_PRICING } = await import('../../utils/plan-features');
    expect(PLAN_PRICING.plus.monthly).toBe(20);
    expect(PLAN_PRICING.pro.monthly).toBe(40);
    expect(PLAN_PRICING.max.monthly).toBe(80);
  });

  it('🔴 this ticket deletes no data and touches no rules or functions', async () => {
    // The row is a label. It reads no collection and writes none, and nothing
    // in this change goes near the two paths that deploy to production.
    const src = readSrc('components/AdminSettings.tsx');
    expect(src).not.toMatch(/smsLogs|smsBroadcasts|deleteDoc|deleteField/);
  });
});
