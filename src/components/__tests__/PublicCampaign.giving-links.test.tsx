import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PublicCampaign from '../PublicCampaign';
import {
  readGivingLinks,
  GIVING_PROVIDERS,
  type PublishedGivingLink,
} from '../donations/giving-providers';

/**
 * THE-251 — a campaign shows the church's own payment links, drawn by the Give
 * page's own component and validated by the Give page's own validator.
 *
 * ⚠️ ASSERTED AGAINST RENDERED OUTPUT, not against the provider table. A test
 * that reads GIVING_PROVIDERS and checks GIVING_PROVIDERS passes on a page that
 * renders nothing at all, which is exactly the regression worth catching.
 *
 * Every link below is built by running a realistic `config.givingLinks` document
 * through the REAL `readGivingLinks` — the same call the page makes — so the
 * fixture cannot be more permissive than production.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CAMPAIGN = {
  id: 'camp1',
  title: 'Roof Fund',
  description: 'Help us fix the roof',
  coverImage: null,
  goal: 50_000,
  raised: 18_000,
  endDate: null,
};

/** A church that publishes three of the four providers. */
const BRANDING = {
  givingLinks: {
    paypal: { url: 'https://paypal.me/gracechapel', handle: 'gracechapel' },
    cashapp: { url: 'https://cash.app/$gracechapel', handle: '$gracechapel' },
    // No per-church page exists for Zelle — reached by email alone.
    zelle: { email: 'giving@gracechapel.example', handle: 'Grace Chapel' },
  },
};

let container: HTMLDivElement;
let root: Root;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

async function mount(links: readonly PublishedGivingLink[]) {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <PublicCampaign
        tenantId="t1"
        tenantName="Grace Chapel"
        logo={null}
        primaryColor="#B8962E"
        campaign={CAMPAIGN}
        links={links}
      />,
    );
  });
  await flush();
}

/** The giving-links section, or null when the page drew none. */
const givingBlock = () => container.querySelector('[data-testid="giving-links"]');

/** Every provider row actually rendered, in DOM order. */
const renderedProviders = () =>
  [...container.querySelectorAll('[data-provider]')].map((el) => el.getAttribute('data-provider'));

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
});

describe('a campaign shows the tenant’s payment links', () => {
  it('renders a row for every provider the church publishes', async () => {
    await mount(readGivingLinks(BRANDING));
    expect(givingBlock()).not.toBeNull();
    expect(renderedProviders()).toEqual(['paypal', 'cashapp', 'zelle']);
  });

  it('shows each provider’s name and the church’s handle', async () => {
    await mount(readGivingLinks(BRANDING));
    const text = givingBlock()!.textContent || '';
    expect(text).toContain('PayPal');
    expect(text).toContain('gracechapel');
    expect(text).toContain('Cash App');
    expect(text).toContain('$gracechapel');
    expect(text).toContain('Zelle');
    expect(text).toContain('giving@gracechapel.example');
  });

  it('makes a provider with a URL an anchor that opens it', async () => {
    await mount(readGivingLinks(BRANDING));
    const paypal = container.querySelector('[data-provider="paypal"]') as HTMLAnchorElement;
    expect(paypal.tagName).toBe('A');
    expect(paypal.getAttribute('href')).toBe('https://paypal.me/gracechapel');
    expect(paypal.getAttribute('rel')).toContain('noopener');
    expect(paypal.getAttribute('rel')).toContain('noreferrer');
  });

  it('renders a provider with no URL as a card, never a dead anchor', async () => {
    await mount(readGivingLinks(BRANDING));
    const zelle = container.querySelector('[data-provider="zelle"]')!;
    // Zelle has no per-church page. A row that looks tappable and does nothing
    // is the dead end this deliberately avoids.
    expect(zelle.tagName).not.toBe('A');
    expect(zelle.querySelector('a')).toBeNull();
  });

  it('still renders the Stripe donate form beside them', async () => {
    await mount(readGivingLinks(BRANDING));
    // The links ADD to the page; they never replace what was already there.
    expect(container.textContent).toContain('Select an amount');
    expect(container.textContent).toContain('Secure payment powered by Stripe.');
  });
});

describe('the links use the same component and provider table as the Give page', () => {
  it('renders through GivingLinks, identified by its own test id', async () => {
    await mount(readGivingLinks(BRANDING));
    // 🔴 `data-testid="giving-links"` is defined in GivingLinks.tsx and nowhere
    // else. Its presence is proof the shared component drew this, not a second
    // renderer written for the campaign page.
    expect(givingBlock()).not.toBeNull();
  });

  it('carries the shared component’s own member-facing warning verbatim', async () => {
    await mount(readGivingLinks(BRANDING));
    // The sentence lives in GivingLinks. A second renderer would have to have
    // copied it, and a copy is exactly what drifts.
    expect(givingBlock()!.textContent).toContain(
      'These go straight to your ministry through their own account.',
    );
    expect(givingBlock()!.textContent).toContain('will not appear in your donation history');
  });

  it('orders rows by the provider table, not by the document’s key order', async () => {
    // Keys deliberately reversed relative to GIVING_PROVIDERS.
    const scrambled = {
      givingLinks: {
        zelle: { email: 'giving@gracechapel.example' },
        venmo: { url: 'https://venmo.com/u/gracechapel' },
        cashapp: { url: 'https://cash.app/$gracechapel' },
        paypal: { url: 'https://paypal.me/gracechapel' },
      },
    };
    await mount(readGivingLinks(scrambled));
    expect(renderedProviders()).toEqual(GIVING_PROVIDERS.map((p) => p.id));
  });

  it('draws a fifth provider with no change to this page', async () => {
    // The table IS the extension point: everything rendered derives from it, so
    // the count on screen tracks the table rather than a hand-written list.
    const all = {
      givingLinks: Object.fromEntries(
        GIVING_PROVIDERS.map((p) => [p.id, { handle: `grace-${p.id}` }]),
      ),
    };
    await mount(readGivingLinks(all));
    expect(renderedProviders()).toHaveLength(GIVING_PROVIDERS.length);
  });
});

describe('a campaign with no Stripe and no links shows no giving block', () => {
  it('draws nothing at all when the church publishes no links', async () => {
    await mount(readGivingLinks({}));
    // 🔴 No heading, no rule, no empty container — the block is absent, not
    // present-and-empty. This is the Give page's fourth state.
    expect(givingBlock()).toBeNull();
    expect(container.textContent).not.toContain('Other ways to give');
  });

  it('draws nothing when the links field is missing entirely', async () => {
    await mount(readGivingLinks({ givingLinks: undefined }));
    expect(givingBlock()).toBeNull();
  });

  it('draws nothing when every stored link fails validation', async () => {
    // Each entry is individually rejected: wrong host, wrong scheme, and a
    // credential-bearing look-alike. Nothing survives, so nothing renders.
    const junk = {
      givingLinks: {
        paypal: { url: 'https://paypal.me.givenow.example/grace' },
        cashapp: { url: 'javascript:alert(1)' },
        venmo: { url: 'https://venmo.com@collect.example/' },
      },
    };
    await mount(readGivingLinks(junk));
    expect(givingBlock()).toBeNull();
  });

  it('omits a provider whose only field is an invalid URL, keeping the valid ones', async () => {
    const mixed = {
      givingLinks: {
        paypal: { url: 'https://paypal.me/gracechapel' },
        cashapp: { url: 'http://cash.app/$grace' },
      },
    };
    await mount(readGivingLinks(mixed));
    expect(renderedProviders()).toEqual(['paypal']);
  });
});

describe('a pasted URL is still validated', () => {
  /** Every href the page actually rendered. */
  const hrefs = () =>
    [...container.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') || '');

  it('never renders a javascript: href', async () => {
    await mount(readGivingLinks({ givingLinks: { paypal: { url: 'javascript:alert(1)', handle: 'grace' } } }));
    // The row still renders — it has a handle — but as a card, with no href.
    expect(renderedProviders()).toEqual(['paypal']);
    expect(hrefs().some((h) => h.startsWith('javascript:'))).toBe(false);
  });

  it('never renders a data: href', async () => {
    await mount(readGivingLinks({
      givingLinks: { cashapp: { url: 'data:text/html,<script>alert(1)</script>', handle: '$grace' } },
    }));
    expect(hrefs().some((h) => h.startsWith('data:'))).toBe(false);
  });

  it('never renders a plain http: href', async () => {
    await mount(readGivingLinks({ givingLinks: { venmo: { url: 'http://venmo.com/u/grace', handle: '@grace' } } }));
    expect(hrefs().some((h) => h.startsWith('http:'))).toBe(false);
  });

  it('never renders a look-alike host', async () => {
    await mount(readGivingLinks({
      givingLinks: { paypal: { url: 'https://paypal.me.givenow.example/grace', handle: 'grace' } },
    }));
    expect(hrefs().some((h) => h.includes('givenow.example'))).toBe(false);
  });

  it('every href it does render sits on its own provider’s allow-listed host', async () => {
    await mount(readGivingLinks({
      givingLinks: {
        paypal: { url: 'https://paypal.me/gracechapel' },
        cashapp: { url: 'https://cash.app/$gracechapel' },
        venmo: { url: 'https://venmo.com/u/gracechapel' },
      },
    }));
    for (const el of container.querySelectorAll('a[data-provider]')) {
      const id = el.getAttribute('data-provider')!;
      const provider = GIVING_PROVIDERS.find((p) => p.id === id)!;
      const host = new URL(el.getAttribute('href')!).hostname;
      expect(provider.hosts.some((h) => host === h || host.endsWith(`.${h}`))).toBe(true);
    }
  });
});

describe('no colour is hardcoded and all four palettes resolve', () => {
  /**
   * The four palettes are {Harvest, Classic} × {light, dark}, selected by
   * `data-palette` / `data-theme` on <html>. A component resolves in all four
   * exactly when every colour it draws is a TOKEN rather than a literal, so
   * that is what this asserts — on the rendered markup, not on the source.
   */
  const PROVIDER_LITERALS = new Set(
    GIVING_PROVIDERS.flatMap((p) => [p.tint.toLowerCase(), p.ink.toLowerCase()]),
  );

  it('spends theme tokens for every colour in the giving block', async () => {
    await mount(readGivingLinks(BRANDING));
    const block = givingBlock()!;
    const literals = [...block.querySelectorAll('*')]
      .map((el) => (el.getAttribute('style') || '').toLowerCase())
      .flatMap((style) => [...style.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/g)].map((m) => m[0]));

    // 🔴 The ONLY literals permitted are the provider table's own tint/ink,
    // which identify a third party and are documented as data rather than
    // palette. Anything else is a colour that cannot follow the theme.
    const unexpected = literals.filter((c) => !PROVIDER_LITERALS.has(c));
    expect(unexpected).toEqual([]);
  });

  it('uses named surface and text tokens for the row chrome', async () => {
    await mount(readGivingLinks(BRANDING));
    const row = container.querySelector('[data-provider="paypal"]')!;
    const cls = row.className;
    expect(cls).toContain('border-line');
    expect(cls).toContain('bg-surface-raised');
    // No literal colour in the class layer either.
    expect(cls).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('keeps every provider mark legible by carrying its own ground', async () => {
    await mount(readGivingLinks(BRANDING));
    for (const provider of GIVING_PROVIDERS) {
      const row = container.querySelector(`[data-provider="${provider.id}"]`);
      if (!row) continue;
      const mark = row.querySelector('span[aria-hidden="true"]') as HTMLElement;
      // The tile paints both fill and ink, so it does not change with the
      // theme at all — the same in all four palettes by construction.
      expect(mark.getAttribute('style')).toContain(provider.tint);
      expect(mark.getAttribute('style')).toContain(provider.ink);
    }
  });
});
