import { describe, expect, it } from 'vitest';
import { readGivingLinks } from '@/components/donations/giving-providers';
import {
  readEventProviderIds,
  resolveEventPaymentLinks,
} from '@/lib/event-payment-claims';
import {
  readSelectedProviderIds,
  resolveCampaignGiving,
  resolveSelectedPaymentLinks,
} from '@/lib/payment-link-selection';

/**
 * The campaign selection is the event selection: ids only, table order,
 * empty means every link the ministry currently publishes, and a stale id
 * falls back to those links rather than to nowhere.
 */
const PUBLISHED = readGivingLinks({
  givingLinks: {
    wise: { url: 'https://wise.com/pay/business/testchurch', handle: 'testchurch' },
    paypal: { url: 'https://paypal.me/testchurch', handle: 'testchurch' },
    revolut: { url: 'https://revolut.me/testchurch', handle: 'testchurch' },
    zelle: { email: 'test@example.test', handle: 'testchurch' },
  },
});

const ids = (links: readonly { provider: { id: string } }[]) => links.map((l) => l.provider.id);

describe('readSelectedProviderIds', () => {
  it('drops unknown ids, dedupes, and returns table order', () => {
    expect(readSelectedProviderIds(['wise', 'paypal', 'bitcoin', 'paypal', 42, null]))
      .toEqual(['paypal', 'wise']);
  });

  it('treats a missing or non-array value as nothing chosen', () => {
    expect(readSelectedProviderIds(undefined)).toEqual([]);
    expect(readSelectedProviderIds('revolut')).toEqual([]);
    expect(readSelectedProviderIds({ revolut: true })).toEqual([]);
  });
});

describe('resolveSelectedPaymentLinks', () => {
  it('returns every published link when nothing is chosen', () => {
    expect(ids(resolveSelectedPaymentLinks(PUBLISHED, undefined))).toEqual(ids(PUBLISHED));
    expect(ids(resolveSelectedPaymentLinks(PUBLISHED, []))).toEqual(ids(PUBLISHED));
  });

  it('narrows to the chosen ids, in table order', () => {
    expect(ids(resolveSelectedPaymentLinks(PUBLISHED, ['wise', 'paypal']))).toEqual(['paypal', 'wise']);
  });

  it('falls back to every link when the selection matches nothing', () => {
    expect(ids(resolveSelectedPaymentLinks(PUBLISHED, ['cashapp']))).toEqual(ids(PUBLISHED));
  });
});

describe('resolveCampaignGiving', () => {
  it('none chosen means every link and no direct target', () => {
    const giving = resolveCampaignGiving(PUBLISHED, []);
    expect(ids(giving.links)).toEqual(ids(PUBLISHED));
    expect(giving.direct).toBeNull();
    expect(giving.narrowed).toBe(false);
  });

  it('one chosen link with a URL is the direct target', () => {
    const giving = resolveCampaignGiving(PUBLISHED, ['revolut']);
    expect(ids(giving.links)).toEqual(['revolut']);
    expect(giving.narrowed).toBe(true);
    expect(giving.direct?.provider.id).toBe('revolut');
    expect(giving.direct?.url).toBe('https://revolut.me/testchurch');
  });

  it('one chosen link with no URL is shown and not opened', () => {
    const giving = resolveCampaignGiving(PUBLISHED, ['zelle']);
    expect(ids(giving.links)).toEqual(['zelle']);
    expect(giving.links[0].url).toBeNull();
    expect(giving.direct).toBeNull();
    expect(giving.narrowed).toBe(true);
  });

  it('several chosen links narrow the list and do not pick one', () => {
    const giving = resolveCampaignGiving(PUBLISHED, ['zelle', 'revolut']);
    expect(ids(giving.links)).toEqual(['zelle', 'revolut']);
    expect(giving.direct).toBeNull();
    expect(giving.narrowed).toBe(true);
  });

  it('a stale id falls back to every link and is not a direct target', () => {
    const giving = resolveCampaignGiving(PUBLISHED, ['cashapp']);
    expect(ids(giving.links)).toEqual(ids(PUBLISHED));
    expect(giving.direct).toBeNull();
    expect(giving.narrowed).toBe(false);
  });

  it('drops unknown ids before deciding', () => {
    const giving = resolveCampaignGiving(PUBLISHED, ['revolut', 'bitcoin']);
    expect(giving.direct?.provider.id).toBe('revolut');
    expect(giving.narrowed).toBe(true);
  });
});

describe('the event helpers keep the same rules', () => {
  const samples: unknown[] = [undefined, [], ['revolut'], ['wise', 'paypal'], ['cashapp'], ['paypal', 'bitcoin', 42, null]];

  it('readEventProviderIds matches readSelectedProviderIds', () => {
    for (const raw of samples) {
      expect(readEventProviderIds(raw)).toEqual(readSelectedProviderIds(raw));
    }
  });

  it('empty means all, a real id narrows, and a stale id falls back', () => {
    expect(ids(resolveEventPaymentLinks(PUBLISHED, undefined))).toEqual(ids(PUBLISHED));
    expect(ids(resolveEventPaymentLinks(PUBLISHED, []))).toEqual(ids(PUBLISHED));
    expect(ids(resolveEventPaymentLinks(PUBLISHED, ['revolut']))).toEqual(['revolut']);
    expect(ids(resolveEventPaymentLinks(PUBLISHED, ['cashapp']))).toEqual(ids(PUBLISHED));
    for (const raw of samples) {
      expect(ids(resolveEventPaymentLinks(PUBLISHED, raw)))
        .toEqual(ids(resolveSelectedPaymentLinks(PUBLISHED, raw)));
    }
  });
});
