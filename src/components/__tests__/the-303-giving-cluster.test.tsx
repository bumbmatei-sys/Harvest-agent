import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

import {
  GIVING_PROVIDERS,
  readGivingLinks,
  type PublishedGivingLink,
} from '../donations/giving-providers';
import {
  GIVING_PATH,
  HARVEST_APEX,
  buildGivingPageUrl,
  buildGivingSharePayload,
  givingShareUrls,
} from '../donations/giving-share';
import PublicGiving from '../PublicGiving';
import PublicPledge from '../PublicPledge';
import PublicCampaign from '../PublicCampaign';
import GivingLinks, { ProviderMark } from '../donations/GivingLinks';
import { STRIPE_CONNECT_ENABLED } from '../../lib/stripe-connect-feature';
import { rulesDigestFailure } from '../../__tests__/__fixtures__/firestore-rules-pin';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-303 — THE GIVING CLUSTER. Six bugs the founder hit on a live paid tenant.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 *   1. the shared giving page landed on the sign-in screen
 *   2. the pledge page never showed the church's payment links
 *   3. the member donate surface "did not appear" after a link was added
 *   4. with Stripe off, both public pages must show the links and nothing else
 *   5. the Donations explainer is too long
 *   6. a cash gift recorded in the CRM reads $0 in Accounting
 *
 * ⚠️ TWO OF THE SIX WERE NOT WHERE THE TICKET EXPECTED, and the assertions
 * below say where they actually were. Bug 3's gate was ALREADY correct
 * (THE-246 derives `hasStripeGiving || links.length > 0`), and bug 2's
 * `/campaign/[campaignId]` had already carried links since THE-251 — what it
 * had not done was stop drawing a Stripe form that cannot complete. The tests
 * are written against what the code does, and the no-regression ones stand so
 * the parts that were already right cannot quietly stop being right.
 */

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
/** Source with comments stripped — a claim in prose is not a claim in code. */
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/[^\n]*$/gm, ' ');

/** A church on the founder's shape: Wise and Revolut, complete. */
const FOUNDER_CONFIG = {
  givingLinks: {
    wise: { url: 'https://wise.com/pay/business/gracechapel', handle: '@gracechapel', email: 'giving@grace.org' },
    revolut: { url: 'https://revolut.me/gracechapel', handle: '@gracechapel', email: 'giving@grace.org' },
  },
};
const FOUNDER_LINKS: readonly PublishedGivingLink[] = readGivingLinks(FOUNDER_CONFIG);

let container: HTMLDivElement;
let root: Root | null = null;

const mount = async (el: React.ReactElement) => {
  await act(async () => { root = createRoot(container); root.render(el); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return container;
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  container.remove();
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 — 🔴 the shared giving URL resolves without authentication
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('1 · the shared giving URL resolves without authentication', () => {
  it('🔴 does NOT point at the SPA root, which is what bounced a visitor to auth', () => {
    const url = new URL(buildGivingPageUrl('grace')!);
    // The bug, stated as the thing that must never come back: the app root
    // carrying a query parameter. `/` is served by `app/[[...slug]]/page.tsx`,
    // which loads App.tsx, which has no session for a stranger.
    expect(url.pathname, 'the giving link is the SPA root again').not.toBe('/');
    expect(url.search, 'the giving link went back to a query parameter on the SPA').toBe('');
    expect(url.pathname).toBe(GIVING_PATH);
  });

  it('🔴 its path is a REAL Next route file, not the SPA catch-all', () => {
    // ⚠️ THE ASSERTION THAT ACTUALLY CATCHES THE REGRESSION. A URL string can
    // be changed to anything; what makes it public is that `src/app` carries a
    // page for it. `/?giving=1` had no page of its own — it fell through to the
    // optional catch-all — so this is exactly the check that was missing.
    const segments = GIVING_PATH.replace(/^\//, '').split('/');
    const file = path.join('src/app', ...segments, 'page.tsx');
    expect(
      () => read(file),
      `${GIVING_PATH} has no page of its own in src/app — it falls through to the SPA shell`,
    ).not.toThrow();
  });

  it('🔴 that route requires no session: no client Firebase, no auth, no fetch', () => {
    const src = code('src/app/giving/page.tsx');
    // Reads through the ADMIN SDK, server-side, exactly as every other public
    // route does. The Admin SDK bypasses firestore.rules, so the page needs no
    // signed-in user and no rule of its own.
    expect(src, 'the giving route does not resolve the tenant server-side')
      .toMatch(/getTenantFromHost/);
    for (const forbidden of [
      /from '@\/firebase'/, /from '\.\.\/\.\.\/firebase'/, // the CLIENT sdk
      /getAuth\(/, /currentUser/, /authFetch/, /api-auth/, /requireAuth/,
      /useAuth|useAppStore/,
    ]) {
      expect(src, `the public giving route reaches for ${forbidden} — that is an auth wall`)
        .not.toMatch(forbidden);
    }
  });

  it('🔴 and it actually renders the church’s links with nobody signed in', async () => {
    // The whole point, executed rather than reasoned about: the route module's
    // own default export, with no user, no session and no client SDK — only a
    // Host header and the Admin SDK.
    vi.resetModules();
    vi.doMock('next/headers', () => ({
      headers: async () => new Map([['host', 'grace.theharvest.app']]),
    }));
    vi.doMock('@/lib/firebase-admin', () => ({
      adminDb: {
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: true,
              id: 'grace',
              data: () => ({ name: 'Grace Chapel', config: FOUNDER_CONFIG }),
            }),
          }),
        }),
      },
    }));
    vi.doMock('@/components/PublicRouteAnalytics', () => ({ default: () => null }));

    const Page = (await import('../../app/giving/page')).default;
    const html = renderToStaticMarkup(await Page());

    expect(html, 'the public giving page rendered no links at all').toContain('Wise');
    expect(html).toContain('https://wise.com/pay/business/gracechapel');
    expect(html).toContain('Revolut');
    expect(html).toContain('Grace Chapel');
    // No sign-in anywhere on it.
    expect(html.toLowerCase()).not.toMatch(/sign in|log in|create an account/);
    vi.doUnmock('next/headers');
    vi.doUnmock('@/lib/firebase-admin');
    vi.doUnmock('@/components/PublicRouteAnalytics');
    vi.resetModules();
  });

  it('every producer of the giving link spells the ONE path, and none inlines the old one', () => {
    // Three surfaces used to inline `/?giving=1` separately — the share payload,
    // the printed QR and the Text-to-Give reply. Fixing one and leaving the
    // others is precisely how a church ends up with a working link and a dead
    // flyer.
    for (const file of [
      'src/components/AdminQR.tsx',
      'src/app/api/sms/incoming/route.ts',
      'src/components/donations/giving-share.ts',
    ]) {
      expect(code(file), `${file} still inlines the auth-walled giving link`)
        .not.toMatch(/\/\?giving=1/);
      expect(code(file), `${file} does not spell GIVING_PATH`).toMatch(/GIVING_PATH/);
    }
  });

  it('⚠️ the in-app `?giving=1` deep link is untouched — a signed-in member still lands on Give', () => {
    // Removing it would have broken the member app's own jump to the Give tab.
    // The fix moved where a link meant for OUTSIDE the app points; it deleted
    // nothing that works inside it.
    expect(code('src/components/MainApp.tsx')).toMatch(/giving/);
    expect(read('src/components/MainApp.tsx')).toMatch(/giving=1|'giving'/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2 — the URL's security properties, unchanged
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('2 · the URL is still https, a single-label subdomain of theharvest.app, no credentials, no port', () => {
  it('🔴 refuses every hostile tenant id it refused before', () => {
    for (const bad of [
      'evil.example/x', 'grace.evil.example', 'grace@evil.example', 'grace:8080',
      '../grace', 'grace/', '', '   ', 'grace.', 'gr ace', 'GRACE!',
      'http://grace', '//evil.example',
    ]) {
      expect(buildGivingPageUrl(bad), `${JSON.stringify(bad)} produced a URL`).toBeNull();
    }
  });

  it('and the shape it DOES emit satisfies all five rules', () => {
    const u = new URL(buildGivingPageUrl('grace')!);
    expect(u.protocol).toBe('https:');
    expect(u.username).toBe('');
    expect(u.password).toBe('');
    expect(u.port).toBe('');
    expect(u.hostname.endsWith(`.${HARVEST_APEX}`)).toBe(true);
    // A SINGLE label in front of the apex — no dots smuggled through.
    expect(u.hostname.split('.')).toHaveLength(HARVEST_APEX.split('.').length + 1);
  });

  it('🔴 the validator was not loosened to make a public route possible', () => {
    // STOP condition 4. Only the PATH moved; every rule is still asked of the
    // parsed URL rather than assumed from the template.
    const src = code('src/components/donations/giving-share.ts');
    for (const rule of [
      /parsed\.protocol !== 'https:'/,
      /parsed\.username \|\| parsed\.password/,
      /parsed\.port/,
      /host\.endsWith\(`\.\$\{HARVEST_APEX\}`\)/,
      /host\.split\('\.'\)\.length !== HARVEST_APEX\.split\('\.'\)\.length \+ 1/,
    ]) {
      expect(src, `giving-share.ts lost the rule ${rule}`).toMatch(rule);
    }
    expect(src, 'the DNS label regex was widened').toMatch(
      /\^\[a-z0-9\]\(\[a-z0-9-\]\{0,61\}\[a-z0-9\]\)\?\$/,
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3 — a campaign page shows the tenant's payment links
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('3 · a campaign page shows the tenant’s payment links', () => {
  const CAMPAIGN = { id: 'c1', title: 'Building Fund', description: '', goal: 1000, raised: 100, pledgeDeadline: null };

  it('🔴 the PLEDGE page draws them — it is the surface that had none', async () => {
    await mount(
      <PublicPledge
        tenantId="grace" tenantName="Grace Chapel" logo={null} primaryColor="#B8962E"
        campaign={CAMPAIGN} links={FOUNDER_LINKS}
      />,
    );
    const block = container.querySelector('[data-testid="giving-links"]');
    expect(block, 'the pledge page still shows no way to actually send the money').not.toBeNull();
    expect(block!.textContent).toContain('Wise');
    expect(block!.textContent).toContain('Revolut');
    const wise = container.querySelector('[data-provider="wise"]') as HTMLAnchorElement;
    expect(wise.tagName).toBe('A');
    expect(wise.getAttribute('href')).toBe('https://wise.com/pay/business/gracechapel');
  });

  it('draws nothing at all when the church publishes none — no empty block', async () => {
    await mount(
      <PublicPledge
        tenantId="grace" tenantName="Grace Chapel" logo={null} primaryColor="#B8962E"
        campaign={CAMPAIGN} links={[]}
      />,
    );
    expect(container.querySelector('[data-testid="giving-links"]')).toBeNull();
    expect(container.textContent).not.toContain('Ways to give');
  });

  it('the pledge ROUTE resolves them through readGivingLinks, at the boundary', () => {
    // Validation happens once, server-side, exactly where the campaign route
    // does it. A renderer that re-derived links would be a second chance to
    // skip the allow-list.
    expect(code('src/app/pledge/[campaignId]/page.tsx')).toMatch(/readGivingLinks\(branding\)/);
    expect(code('src/components/PublicPledge.tsx'), 'the renderer re-derives links')
      .not.toMatch(/readGivingLinks\s*\(/);
    expect(code('src/components/PublicPledge.tsx')).toMatch(/PublishedGivingLink/);
  });

  it('both public campaign surfaces render through the ONE shared component', () => {
    for (const file of ['src/components/PublicPledge.tsx', 'src/components/PublicCampaign.tsx', 'src/components/PublicGiving.tsx']) {
      expect(code(file), `${file} does not render through GivingLinks`).toMatch(/<GivingLinks/);
    }
  });

  it('🔴 no new surface carries a provider list of its own', () => {
    for (const file of [
      'src/components/PublicPledge.tsx',
      'src/components/PublicGiving.tsx',
      'src/app/pledge/[campaignId]/page.tsx',
      'src/app/giving/page.tsx',
    ]) {
      for (const p of GIVING_PROVIDERS) {
        expect(code(file), `${file} names "${p.id}" itself instead of reading the table`)
          .not.toMatch(new RegExp(`['"\`]${p.id}['"\`]`));
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4 — the member-app donate surface, with manual links and no Stripe
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('4 · the member-app donate surface appears with manual links and no Stripe', () => {
  it('🔴 the gate is links-OR-Stripe, not Stripe alone — THE-246, and it still holds', () => {
    // ⚠️ THE TICKET'S PREMISE WAS THAT THIS CHECKED STRIPE AND NOTHING ELSE.
    // It does not, and has not since THE-246. Pinned here so the drift is
    // recorded and so the correct derivation cannot quietly regress into the
    // Stripe-only one the founder described.
    const src = code('src/components/MainApp.tsx');
    expect(src).toMatch(/const givingLinks = useMemo\(\(\) => readGivingLinks\(branding\), \[branding\]\)/);
    expect(src, 'the member Give gate stopped counting the church’s own links')
      .toMatch(/hasStripeGiving \|\| givingLinks\.length > 0/);
    expect(src).toMatch(/hasGivingRails/);
  });

  it('the Give tab renders links with no form when there is no Stripe', async () => {
    // PartnerWithUsTab is what MainApp mounts; `showDonationForm={false}` is the
    // state every tenant is in while Connect is off.
    vi.resetModules();
    vi.doMock('@/contexts/TenantContext', () => ({
      useTenant: () => ({ tenantId: 'grace', tenantName: 'Grace Chapel' }),
    }));
    const PartnerWithUsTab = (await import('../PartnerWithUsTab')).default;
    await mount(<PartnerWithUsTab showDonationForm={false} links={FOUNDER_LINKS} />);
    expect(container.querySelector('[data-testid="giving-links"]'), 'the links vanished').not.toBeNull();
    expect(container.textContent).toContain('Wise');
    expect(container.textContent).toContain('Ways to give');
    // And no "other", because there is nothing else on the page to be other than.
    expect(container.textContent).not.toContain('Other ways to give');
    vi.doUnmock('@/contexts/TenantContext');
    vi.resetModules();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5 — 🔴 with Stripe off, neither page shows a Stripe control or an apology
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('5 · with Stripe off, neither page shows a Stripe control or an apology', () => {
  const CAMPAIGN = { id: 'c1', title: 'Building Fund', description: '', coverImage: null, goal: 1000, raised: 100, endDate: null };

  /** Anything that would take, promise or explain a card payment. */
  const APOLOGIES = [
    /card payments? (are )?unavailable/i,
    /temporarily unavailable/i,
    /coming soon/i,
    /not accepting card/i,
    /stripe is not connected/i,
  ];

  it('🔴 the public CAMPAIGN page draws no amount picker, no Donate button, no Stripe line', async () => {
    await mount(
      <PublicCampaign
        tenantId="grace" tenantName="Grace Chapel" logo={null} primaryColor="#B8962E"
        campaign={CAMPAIGN} links={FOUNDER_LINKS} showDonationForm={false}
      />,
    );
    expect(container.textContent, 'the amount picker survived').not.toContain('Select an amount');
    expect(container.textContent, 'the Stripe assurance survived')
      .not.toContain('Secure payment powered by Stripe');
    const donate = Array.from(container.querySelectorAll('button'))
      .find((b) => /^Donate/.test((b.textContent || '').trim()));
    expect(donate, 'a Donate button that posts to a 503 survived').toBeUndefined();
    // ⚠️ AND NO APOLOGY IN ITS PLACE. The founder asked for the links, not for
    // an explanation of a payment method this church does not offer.
    for (const a of APOLOGIES) {
      expect(container.textContent, `the page apologises: ${a}`).not.toMatch(a);
    }
    // What IS there: the church's own accounts, named as THE way to give.
    expect(container.querySelector('[data-testid="giving-links"]')).not.toBeNull();
    expect(container.textContent).toContain('Ways to give');
  });

  it('the same page keeps the form when a church really can take a card', async () => {
    // The gate draws LESS, never differently — so the ON state is asserted too
    // and the OFF state above cannot pass by the component being broken.
    await mount(
      <PublicCampaign
        tenantId="grace" tenantName="Grace Chapel" logo={null} primaryColor="#B8962E"
        campaign={CAMPAIGN} links={FOUNDER_LINKS} showDonationForm
      />,
    );
    expect(container.textContent).toContain('Select an amount');
    expect(container.textContent).toContain('Other ways to give');
  });

  it('🔴 the route derives it from the master switch AND the tenant’s own status', () => {
    const src = code('src/app/campaign/[campaignId]/page.tsx');
    expect(src).toMatch(/STRIPE_CONNECT_ENABLED/);
    expect(src, "'pending' or 'restricted' would draw a form that fails after a card is typed in")
      .toMatch(/stripeConnectStatus === 'active'/);
    // Today that resolves to false for every tenant, which is the whole of bug 4.
    expect(STRIPE_CONNECT_ENABLED, 'Connect came back on — re-read this suite').toBe(false);
  });

  it('🔴 the master switch itself is untouched, and no Connect UI came back', () => {
    // STOP condition 6, and the ticket's standing instruction.
    // ⚠️ THE DIGEST IS THE ONE `AdminDonations.section.test.tsx` ALREADY PINS,
    // copied rather than recorded here — the same cross-check the rules digests
    // below rely on.
    expect(sha(read('src/lib/stripe-connect-feature.ts')), 'stripe-connect-feature.ts changed')
      .toBe('ae4767b86754d414d6d8a052756c15b27c5cdee9fec33dc77dbc9ec1acb11d67');
    expect(read('src/lib/stripe-connect-feature.ts'))
      .toMatch(/export const STRIPE_CONNECT_ENABLED = false;/);
    for (const file of ['src/components/PublicGiving.tsx', 'src/components/PublicPledge.tsx']) {
      expect(code(file), `${file} grew a Stripe control`).not.toMatch(/stripe/i);
    }
  });

  it('the PUBLIC GIVING page has no Stripe control and no apology either', async () => {
    await mount(<PublicGiving tenantName="Grace Chapel" logo={null} links={FOUNDER_LINKS} />);
    expect(container.textContent).not.toMatch(/stripe/i);
    for (const a of APOLOGIES) {
      expect(container.textContent, `the giving page apologises: ${a}`).not.toMatch(a);
    }
    expect(container.querySelector('[data-testid="giving-links"]')).not.toBeNull();
  });

  it('and it says plainly when a church has published nothing — not a blank card', async () => {
    await mount(<PublicGiving tenantName="Grace Chapel" logo={null} links={[]} />);
    expect(container.querySelector('[data-testid="giving-none"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="giving-links"]')).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 10 — 🔴 every emitted URL passed the allow-list
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('10 · every emitted URL passed the allow-list', () => {
  /** The provider whose allow-list a URL satisfies, or undefined. */
  const providerFor = (url: string) => {
    let host: string;
    try { host = new URL(url).hostname.toLowerCase().replace(/\.+$/, ''); } catch { return undefined; }
    return GIVING_PROVIDERS.find((p) => p.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
  };
  const isGivingPage = (url: string) => {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port
      && u.hostname.toLowerCase().endsWith(`.${HARVEST_APEX}`);
  };

  it('🔴 every href on every surface this ticket touches is allow-listed', async () => {
    const surfaces: React.ReactElement[] = [
      <PublicGiving key="g" tenantName="Grace" logo={null} links={FOUNDER_LINKS} />,
      <PublicPledge key="p" tenantId="grace" tenantName="Grace" logo={null} primaryColor="#B8962E"
        campaign={{ id: 'c', title: 'T', description: '', goal: 0, raised: 0, pledgeDeadline: null }}
        links={FOUNDER_LINKS} />,
      <PublicCampaign key="c" tenantId="grace" tenantName="Grace" logo={null} primaryColor="#B8962E"
        campaign={{ id: 'c', title: 'T', description: '', coverImage: null, goal: 0, raised: 0, endDate: null }}
        links={FOUNDER_LINKS} showDonationForm={false} />,
    ];
    let checked = 0;
    for (const el of surfaces) {
      const html = renderToStaticMarkup(el);
      for (const m of html.matchAll(/href="(https?:[^"]+)"/g)) {
        checked += 1;
        expect(providerFor(m[1]), `${m[1]} is on no provider's allow-list`).toBeDefined();
      }
    }
    expect(checked, 'no URL was emitted at all — the check is vacuous').toBeGreaterThan(0);
  });

  it('🔴 a hostile stored link is DROPPED by the read, on the new surfaces too', () => {
    const hostile = {
      givingLinks: {
        paypal: { url: 'https://pаypal.me/grace' },             // Cyrillic а
        cashapp: { url: 'https://cash.app.givenow.example/x' },  // suffix, not host
        venmo: { url: 'https://venmo.com@collect.example/' },    // credentials
        zelle: { url: 'http://zellepay.com/' },                  // not https
        revolut: { url: 'javascript:alert(1)' },                 // scheme
        wise: { url: 'https://givenow.example/wise.com' },       // host is elsewhere
      },
    };
    const links = readGivingLinks(hostile);
    for (const link of links) expect(link.url, `${link.provider.label} kept a hostile URL`).toBeNull();
    const html = renderToStaticMarkup(
      <PublicGiving tenantName="Grace" logo={null} links={links} />,
    );
    for (const bad of ['pаypal', 'givenow.example', 'collect.example', 'javascript:', 'http://zellepay']) {
      expect(html, `${bad} reached the public giving page`).not.toContain(bad);
    }
  });

  it('the share payload still emits only the giving page and allow-listed links', () => {
    const urls = givingShareUrls(buildGivingSharePayload('grace', FOUNDER_CONFIG, 'Grace Chapel'));
    expect(urls.length).toBeGreaterThan(1);
    for (const url of urls) {
      expect(isGivingPage(url) || providerFor(url) !== undefined, `${url} passed nothing`).toBe(true);
    }
  });

  it('🔴 the allow-list itself is byte-identical', () => {
    // Non-negotiable: `hosts` is an ALLOW-list and this ticket does not touch it.
    expect(sha(read('src/components/donations/giving-providers.ts')))
      .toBe('b1657211cde4a4114b7653a2d67fa38b48f97bf8e298cd20293590344e31e9e7');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 11 — ProviderMark still renders monograms, not logos
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('11 · ProviderMark still renders monograms, not logos', () => {
  it('🔴 draws one letter from the table, in the app’s own type', async () => {
    const wise = GIVING_PROVIDERS.find((p) => p.id === 'wise')!;
    await mount(<ProviderMark provider={wise} />);
    const mark = container.firstElementChild!;
    expect(mark.tagName).toBe('SPAN');
    expect(mark.textContent).toBe(wise.monogram);
    expect(mark.textContent!.trim()).toHaveLength(1);
  });

  it('🔴 ships no third-party artwork — no img, no svg, no background image', () => {
    const src = read('src/components/donations/GivingLinks.tsx');
    expect(src, 'GivingLinks grew an <img>').not.toMatch(/<img/i);
    expect(src, 'GivingLinks grew inline artwork').not.toMatch(/<svg|<path|backgroundImage|url\(/i);
    // And nothing on the provider table became an asset reference.
    for (const p of GIVING_PROVIDERS) {
      for (const value of [p.monogram]) {
        expect(value, `${p.label}'s mark is not a single letter`).toHaveLength(1);
      }
    }
  });

  it('🔴 the mark stays aria-hidden — the accessible name is the label beside it', async () => {
    await mount(<GivingLinks links={FOUNDER_LINKS} />);
    for (const row of container.querySelectorAll('[data-provider]')) {
      const mark = row.querySelector('span[aria-hidden="true"]');
      expect(mark, 'a provider mark lost aria-hidden').not.toBeNull();
    }
    expect(container.textContent).toContain('Wise');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 12 — no colour hardcoded, no emoji; both palettes resolve
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('12 · no colour hardcoded, no emoji; both palettes resolve', () => {
  /** Everything this ticket wrote. `tint`/`ink` live in the table, not here. */
  const ADDED = [
    'src/components/PublicGiving.tsx',
    'src/app/giving/page.tsx',
  ];

  it('🔴 the files this ticket ADDED hardcode no colour and carry no inline style', () => {
    for (const file of ADDED) {
      const src = read(file);
      expect(src, `${file} hardcodes a colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d|hsla?\(\s*\d/);
      expect(src, `${file} carries an inline style`).not.toMatch(/style=\{\{/);
    }
  });

  it('the blocks it added to existing screens hardcode no colour either', () => {
    const between = (file: string, from: string, to: string) => {
      const src = read(file);
      const a = src.indexOf(from);
      expect(a, `${from} not found in ${file}`).toBeGreaterThan(-1);
      const b = src.indexOf(to, a);
      expect(b, `${to} not found after it in ${file}`).toBeGreaterThan(-1);
      return src.slice(a, b);
    };
    const blocks = {
      'Donations — the fold': between(
        'src/components/AdminDonations.tsx',
        '<Collapsible>', '</CollapsibleTrigger>'),
      'Accounting — the cash note': between(
        'src/components/AdminAccounting.tsx',
        'data-testid="accounting-cash-note-toggle"', '</CollapsibleContent>'),
    };
    for (const [label, block] of Object.entries(blocks)) {
      expect(block, `${label} hardcodes a colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d|hsla?\(\s*\d/);
      expect(block, `${label} carries an inline style`).not.toMatch(/style=\{\{/);
    }
  });

  it('🔴 no emoji anywhere in what this ticket writes', () => {
    // Comments carry the repo's 🔴/⚠️/✅ convention; RENDERED copy must not.
    const RENDERED_EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    for (const file of [...ADDED, 'src/components/AdminDonations.tsx', 'src/components/AdminAccounting.tsx']) {
      const stripped = code(file)
        // JSX text and string literals only — the comment convention is already gone.
        .replace(/\s+/g, ' ');
      expect(stripped, `${file} renders an emoji`).not.toMatch(RENDERED_EMOJI);
    }
  });

  it('every token the new blocks spell is defined for both palettes', () => {
    const css = read('src/app/globals.css');
    const varsIn = (match: (sel: string) => boolean) => {
      const out: Record<string, string> = {};
      postcss.parse(css).walkRules((rule) => {
        if (!match(rule.selector)) return;
        rule.walkDecls((d) => { if (d.prop.startsWith('--')) out[d.prop] = d.value.trim(); });
      });
      return out;
    };
    const rootVars = varsIn((s) => s.trim() === ':root');
    const darkVars = varsIn((s) => /\[data-theme="dark"\]/.test(s) && !/data-palette/.test(s));
    const palettes: Record<string, Record<string, string>> = {
      // Classic is the default since #409, so it is named first here.
      light: { ...rootVars },
      dark: { ...rootVars, ...darkVars },
    };
    const resolve = (vars: Record<string, string>, token: string): string | null => {
      let value: string | undefined = vars[token];
      for (let hops = 0; hops < 8 && value; hops++) {
        const ref: RegExpMatchArray | null = value.match(/^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/);
        if (!ref) return value;
        value = vars[ref[1]];
      }
      return value ?? null;
    };
    expect(Object.keys(palettes)).toHaveLength(2);
    const TOKENS = [
      '--surface-raised', '--surface-sunken', '--surface-tint', '--border-default',
      '--text-body', '--text-strong', '--text-muted', '--text-faint',
    ];
    for (const [name, vars] of Object.entries(palettes)) {
      for (const token of TOKENS) {
        const resolved = resolve(vars, token);
        expect(resolved, `${token} unset for ${name}`).toBeTruthy();
        expect(resolved, `${token} is not a colour for ${name}`).toMatch(/^(#|rgb|hsl|color-mix|var)/);
      }
    }
    expect(resolve(palettes.dark, '--surface-raised'))
      .not.toBe(resolve(palettes.light, '--surface-raised'));
  });

  it('invents no width — the measures come from form-layout', () => {
    expect(read('src/components/PublicGiving.tsx'), 'the giving page invented a width')
      .not.toMatch(/max-w-\[|w-\[\d/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 14 — firestore.rules and functions/ byte-identical
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('14 · firestore.rules and functions/ are byte-identical', () => {
  /**
   * 🔴 STOP CONDITION 2. `firestore.rules` auto-deploys to production on any
   * push to main that touches it, and CI runs no emulator tests — so a rules
   * change made by accident ships unreviewed. This ticket needed none: every
   * public route reads through the ADMIN SDK, which bypasses rules entirely.
   *
   * ⚠️ The two digests below are LITERALS ALREADY CARRIED BY TWO OTHER SUITES
   * (`AdminDonations.section.test.tsx` and `posthog-admin-sections.test.ts`),
   * copied rather than recorded here — which is what makes them a real
   * cross-check rather than a self-fulfilling one. No `git show` at assertion
   * time; CI's clone depth is not this suite's business.
   */
  it('🔴 firestore.rules is unchanged', () => {
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
  });

  it('🔴 functions/src/index.ts is unchanged', () => {
    expect(sha(read('functions/src/index.ts')))
      .toBe('39ccade96ac3d4dd5a13047e9bc42b54ef5ac59ae72f932af042fc814bf23e0b');
  });

  it('and nothing else under functions/src moved either', () => {
    // A whole-tree digest, so a change to a sibling module cannot hide behind
    // an unchanged index.
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir).sort()) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else files.push(full);
      }
    };
    walk(path.join(ROOT, 'functions/src'));
    const tree = files.map((f) => `${path.relative(ROOT, f)}:${sha(readFileSync(f))}`).join('\n');
    expect(sha(tree)).toBe('95490fe52cc2caa158d978ab48fe8ac94cf3986a19e22bcf4b21c099edb834aa');
  });
});
