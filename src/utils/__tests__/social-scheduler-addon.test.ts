import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// addons.ts imports the Dodo catalogue, which throws unless these three exist.
// The values only satisfy that import. They are not credentials.
vi.hoisted(() => {
  process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
  process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_dGVzdHNlY3JldA==';
  process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';
});

import { sameTenantAddons } from '../../lib/dodo/addons';
import {
  NO_ADDONS,
  PLAN_ORDER,
  getEffectiveFeatures,
  getPlanFeatures,
  readTenantAddons,
} from '../plan-features';

const src = (rel: string) => readFileSync(path.join(__dirname, rel), 'utf8');

describe('social scheduler add-on', () => {
  // Matei approved 2026-10-21: "Include the scheduler in the Ministry plan".
  it('is a plan cell on Ministry and false on every other tier', () => {
    for (const plan of PLAN_ORDER) {
      expect(getPlanFeatures(plan).socialScheduler, plan).toBe(plan === 'max');
    }
  });

  it('lifts with || and never by assignment', () => {
    const features = src('../plan-features.ts');
    expect(features).toMatch(
      /socialScheduler:\s*base\.socialScheduler\s*\|\|\s*owned\.socialScheduler\s*>\s*0/,
    );
    expect(features).not.toMatch(/socialScheduler:\s*owned\.socialScheduler\s*>\s*0/);
  });

  it('a positive count turns the cell on and a junk count does not', () => {
    for (const plan of PLAN_ORDER) {
      expect(getEffectiveFeatures(plan, NO_ADDONS).socialScheduler, plan).toBe(plan === 'max');
      expect(
        getEffectiveFeatures(plan, { ...NO_ADDONS, socialScheduler: 1 }).socialScheduler,
        plan,
      ).toBe(true);
    }
    expect(readTenantAddons({ socialScheduler: -3 }).socialScheduler).toBe(0);
    expect(readTenantAddons({ socialScheduler: 'yes' }).socialScheduler).toBe(0);
    expect(getEffectiveFeatures('pro', readTenantAddons({ socialScheduler: 0.4 })).socialScheduler).toBe(false);
  });

  it('the other add-ons do not turn it on', () => {
    const owned = { ...NO_ADDONS, aiAssistant: 3, adminSeats: 8, unlimitedContacts: true };
    for (const plan of PLAN_ORDER) {
      expect(getEffectiveFeatures(plan, owned).socialScheduler, plan).toBe(plan === 'max');
    }
  });

  it('owning it does not move the chat or a cap', () => {
    for (const plan of PLAN_ORDER) {
      const base = getPlanFeatures(plan);
      const effective = getEffectiveFeatures(plan, { ...NO_ADDONS, socialScheduler: 2 });
      expect(effective.aiChat).toBe(base.aiChat);
      expect(effective.aiKnowledge).toBe(base.aiKnowledge);
      expect(effective.maxAdmins).toBe(base.maxAdmins);
      expect(effective.socialScheduler).toBe(true);
    }
  });

  it('a redelivery can tell two counts apart', () => {
    const none = NO_ADDONS;
    const held = { ...NO_ADDONS, socialScheduler: 1 };
    expect(sameTenantAddons(none, held)).toBe(false);
    expect(sameTenantAddons(held, { ...held })).toBe(true);
  });

  it('is not a catalogue meaning, a checkout row, or a price', () => {
    expect(src('../../lib/dodo/catalogue.ts')).not.toContain('socialScheduler');
    expect(src('../addon-change.ts')).not.toContain('socialScheduler');
    expect(src('../../app/api/dodo/addons/route.ts')).not.toContain('socialScheduler');
    expect(src('../plan-features.ts')).not.toMatch(/PLAN_PRICING[\s\S]{0,200}socialScheduler/);
  });
});
