import { describe, expect, it } from 'vitest';
import { SETTINGS_NAV, settingsSectionFromLocation } from '../settings-nav';

describe('settings popup nav', () => {
  it('lists Campus, never Church, in this order', () => {
    expect(SETTINGS_NAV.map((item) => item.label)).toEqual([
      'Profile',
      'Campus & branding',
      'Plan & billing',
      'Campus setup',
      'Danger zone',
    ]);
    expect(SETTINGS_NAV.map((item) => item.label).join(' ')).not.toMatch(/church/i);
  });

  it('opens Plan & billing from a Stripe or Dodo return', () => {
    expect(settingsSectionFromLocation('?stripe=success', '')).toBe('billing');
    expect(settingsSectionFromLocation('?stripe=cancel', '')).toBe('billing');
    expect(settingsSectionFromLocation('?addon=ai-assistant', '')).toBe('billing');
    expect(settingsSectionFromLocation('?section=plan', '')).toBe('billing');
  });

  it('opens the named section from ?section= or a hash', () => {
    expect(settingsSectionFromLocation('?section=campus', '')).toBe('campus');
    expect(settingsSectionFromLocation('?section=branding', '')).toBe('campus');
    expect(settingsSectionFromLocation('', '#setup')).toBe('setup');
    expect(settingsSectionFromLocation('?section=danger', '#profile')).toBe('danger');
    expect(settingsSectionFromLocation('', '')).toBe('profile');
  });
});
