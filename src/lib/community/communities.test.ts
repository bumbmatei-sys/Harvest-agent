import { describe, expect, it } from 'vitest';
import {
  communityIdFor, defaultCommunityRecord, DEFAULT_COMMUNITY_ID, formatCommunityPrice, isCommunityId,
  newCommunityDraft, readCommunityEdit, readCommunityRecord,
} from './communities';
import { defaultCommunitySettings } from './settings';

const edit = (over: Record<string, unknown> = {}) => ({ ...newCommunityDraft('Youth Group'), ...over });

describe('community records', () => {
  it('accepts a valid free and a valid paid community', () => {
    expect(readCommunityEdit(edit()).pricing).toEqual({ type: 'free' });
    const paid = readCommunityEdit(edit({ pricing: { type: 'paid', amountCents: 1500, currency: 'usd', interval: 'month' } }));
    expect(paid.pricing).toEqual({ type: 'paid', amountCents: 1500, currency: 'usd', interval: 'month' });
    expect(formatCommunityPrice(paid.pricing)).toBe('$15.00 / month');
    expect(formatCommunityPrice({ type: 'paid', amountCents: 4900, currency: 'eur', interval: 'once' })).toBe('€49.00');
  });

  it('refuses a blank name, a price under 1.00, an unknown currency and a non-HTTPS icon', () => {
    expect(() => readCommunityEdit(edit({ name: '   ' }))).toThrow('Give the community a name.');
    expect(() => readCommunityEdit(edit({ pricing: { type: 'paid', amountCents: 99, currency: 'usd', interval: 'month' } }))).toThrow('at least 1.00');
    expect(() => readCommunityEdit(edit({ pricing: { type: 'paid', amountCents: 500, currency: 'btc', interval: 'month' } }))).toThrow('supported currency');
    expect(() => readCommunityEdit(edit({ iconUrl: 'http://x.test/a.png' }))).toThrow('HTTPS icon');
    expect(() => readCommunityEdit(edit({ visibility: 'secret' }))).toThrow('Invalid community.');
    expect(() => readCommunityEdit(edit({ name: 'x'.repeat(81) }))).toThrow('Invalid community.');
  });

  it('never reads a stored record as the default, and needs a known status', () => {
    expect(() => readCommunityRecord(DEFAULT_COMMUNITY_ID, { ...edit(), status: 'draft' })).toThrow();
    expect(() => readCommunityRecord('youth', { ...edit(), status: 'live' })).toThrow();
    expect(readCommunityRecord('youth', { ...edit(), status: 'draft' })).toMatchObject({ id: 'youth', isDefault: false, status: 'draft' });
  });

  it('draws the default community from the existing setup', () => {
    const settings = { ...defaultCommunitySettings(), isPublic: true, shortDescription: 'Hi', logoUrl: 'https://cdn.test/l.png' };
    expect(defaultCommunityRecord(' Grace ', settings)).toMatchObject({
      id: DEFAULT_COMMUNITY_ID, name: 'Grace', tagline: 'Hi', iconUrl: 'https://cdn.test/l.png', visibility: 'public', status: 'published', isDefault: true,
    });
  });

  it('makes a unique, URL-safe id that can never be the default', () => {
    expect(communityIdFor('Youth Group!', new Set())).toBe('youth-group');
    expect(communityIdFor('Youth Group', new Set(['youth-group']))).toBe('youth-group-2');
    expect(communityIdFor('Default', new Set())).toBe('default-community');
    expect(communityIdFor('Școala de Duminică', new Set())).toBe('scoala-de-duminica');
    expect(communityIdFor('!!!', new Set())).toBe('community');
    expect(isCommunityId(communityIdFor('A'.repeat(200), new Set()))).toBe(true);
  });
});
