import { describe, it, expect } from 'vitest';
import { getPlanFeatures, getPlanDisplayName, hasFeature } from '../plan-features';

describe('getPlanFeatures', () => {
  it('returns correct features for plus plan', () => {
    const f = getPlanFeatures('plus');
    expect(f.blog).toBe(true);
    expect(f.aiChat).toBe(false);
    expect(f.maxChurches).toBe(1);
    expect(f.maxCourses).toBe(5);
    expect(f.maxAdmins).toBe(2);
    expect(f.customDomain).toBe(false);
    expect(f.aiAssistant).toBe(false);
  });

  it('returns correct features for pro plan', () => {
    const f = getPlanFeatures('pro');
    expect(f.aiChat).toBe(true);
    expect(f.maxCourses).toBe(-1);
    expect(f.maxAdmins).toBe(5);
    expect(f.customDomain).toBe(false);
  });

  it('returns correct features for ultra plan', () => {
    const f = getPlanFeatures('ultra');
    expect(f.aiAssistant).toBe(true);
    expect(f.customDomain).toBe(true);
    expect(f.maxAdmins).toBe(-1);
  });

  it('returns correct features for enterprise plan', () => {
    const f = getPlanFeatures('enterprise');
    expect(f.map).toBe(true);
    expect(f.maxChurches).toBe(-1);
  });

  it('defaults to plus for unknown plan', () => {
    const f = getPlanFeatures('nonexistent' as any);
    expect(f).toEqual(getPlanFeatures('plus'));
  });
});

describe('getPlanDisplayName', () => {
  it('returns correct display names', () => {
    expect(getPlanDisplayName('plus')).toBe('Individual');
    expect(getPlanDisplayName('pro')).toBe('Community');
    expect(getPlanDisplayName('max')).toBe('Church');
    expect(getPlanDisplayName('ultra')).toBe('Ministry');
    expect(getPlanDisplayName('enterprise')).toBe('Enterprise');
  });

  it('defaults to Individual for unknown plan', () => {
    expect(getPlanDisplayName('bad' as any)).toBe('Individual');
  });
});

describe('hasFeature', () => {
  it('returns true for enabled boolean features', () => {
    expect(hasFeature('pro', 'aiChat')).toBe(true);
    expect(hasFeature('plus', 'blog')).toBe(true);
  });

  it('returns false for disabled boolean features', () => {
    expect(hasFeature('plus', 'aiChat')).toBe(false);
    expect(hasFeature('plus', 'aiAssistant')).toBe(false);
  });

  it('returns true for non-zero numeric features', () => {
    expect(hasFeature('plus', 'maxChurches')).toBe(true);
    expect(hasFeature('plus', 'maxCourses')).toBe(true);
  });

  it('map (own location) is available on all plans', () => {
    expect(hasFeature('plus', 'map')).toBe(true);
    expect(hasFeature('pro', 'map')).toBe(true);
    expect(hasFeature('max', 'map')).toBe(true);
    expect(hasFeature('ultra', 'map')).toBe(true);
    expect(hasFeature('enterprise', 'map')).toBe(true);
  });

  it('churchDirectory (global discovery) is enterprise-only', () => {
    expect(hasFeature('plus', 'churchDirectory')).toBe(false);
    expect(hasFeature('pro', 'churchDirectory')).toBe(false);
    expect(hasFeature('max', 'churchDirectory')).toBe(false);
    expect(hasFeature('ultra', 'churchDirectory')).toBe(false);
    expect(hasFeature('enterprise', 'churchDirectory')).toBe(true);
  });
});
