import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import postcss from 'postcss';

import GivingShareSheet from '../donations/GivingShareSheet';
import { ProviderMark } from '../donations/GivingLinks';
import {
  GIVING_PROVIDERS,
  validateGivingUrl,
  type GivingProvider,
} from '../donations/giving-providers';
import {
  HARVEST_APEX,
  GIVING_SHARE_STRIPE_SOON,
  buildGivingPageUrl,
  buildGivingSharePayload,
  givingShareUrls,
} from '../donations/giving-share';
import { buildUtilityCss } from '../../test/support/tailwind-build';

/**
 * THE-281 — the share button on the Donations screen.
 *
 * ⚠️ NOTHING HERE SHELLS OUT TO `git show`. The byte-identity guards in section
 * 9 pin DIGESTS computed from the working tree, not diffs against a revision:
 * a suite that runs `git show` needs history the CI checkout may not have, and
 * `MemberScreens.desktop-layout` already carries the one such precondition this
 * repo tolerates. A hash answers the same question with no git at all.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REPO = process.cwd();
const SRC = path.join(REPO, 'src');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

/**
 * A file's CODE, with comments removed.
 *
 * ⚠️ Every "this file must not mention X" assertion below runs against this and
 * not against `read`. The docblocks in this feature explain at length what they
 * deliberately do NOT do — `giving-share.ts` names `STRIPE_CONNECT_ENABLED` to
 * say it does not read it, and `GivingLinks.tsx` names `simple-icons` to say
 * the repo has no such dependency. Grepping the raw text would make writing
 * down the reason the thing that fails the test, which is exactly backwards:
 * the prose is the most valuable part of both files.
 */
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');

const TENANT = 'grace';

/** A church with every shape the table can produce, including Zelle's no-URL row. */
const CONFIG = {
  givingLinks: {
    paypal: { url: 'https://paypal.me/gracechapel', handle: 'gracechapel' },
    cashapp: { url: 'https://cash.app/$gracechapel', handle: '$gracechapel' },
    zelle: { handle: 'Grace Chapel', email: 'giving@gracechapel.org' },
    wise: { url: 'https://wise.com/pay/business/gracechapel', handle: '@gracechapel' },
  },
};

let container: HTMLDivElement;
let root: Root;
const mountSheet = async (props?: Partial<React.ComponentProps<typeof GivingShareSheet>>) => {
  await act(async () => {
    root.render(
      <GivingShareSheet tenantId={TENANT} config={CONFIG} churchName="Grace Chapel" {...props} />,
    );
  });
  await act(async () => { await Promise.resolve(); });
};
const qa = (sel: string) => Array.from(container.querySelectorAll(sel));
const q = (sel: string) => container.querySelector(sel);

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

// ═════════════════════════════════════════════════════════════════════════════
// 1 · the button is on the surface
// ═════════════════════════════════════════════════════════════════════════════
describe('1 — the share button appears on the donations surface', () => {
  it('AdminDonations mounts the share sheet, on the card whose links it shares', () => {
    const src = read('components/AdminDonations.tsx');
    expect(src, 'AdminDonations does not import the share sheet')
      .toMatch(/import GivingShareSheet from '\.\/donations\/GivingShareSheet'/);
    expect(src, 'AdminDonations does not render it').toMatch(/<GivingShareSheet\b/);
  });

  it('🔴 it shares what is SAVED, never the unsaved draft', () => {
    const src = read('components/AdminDonations.tsx');
    // The prop must be fed from the saved record. A `draft` here would share a
    // half-finished paste with a congregation.
    expect(src).toMatch(/config=\{\{\s*givingLinks:\s*savedLinks\s*\}\}/);
    expect(src, 'the share sheet was handed the live draft').not.toMatch(/config=\{\{\s*givingLinks:\s*draft/);
    /* And `savedLinks` only ever advances from a VALIDATED record — never from
       the raw draft, and never before the write resolves. Both call sites feed
       it `buildGivingLinkRecord(...)`, which is the same re-validation the
       write and the member Give page both go through. */
    const assignments = Array.from(src.matchAll(/setSavedLinks\(([^;]*?)\);/g)).map((m) => m[1].trim());
    expect(assignments.length, 'savedLinks is never set').toBeGreaterThanOrEqual(2);
    for (const a of assignments) {
      expect(a, `savedLinks was assigned "${a}", which is not a validated record`)
        .toMatch(/^buildGivingLinkRecord\(/);
    }
    // The save path sets it AFTER awaiting updateDoc, not before.
    const save = src.slice(src.indexOf('const handleSave'));
    expect(save.indexOf('await updateDoc'), 'the save handler lost its write').toBeGreaterThan(-1);
    expect(save.indexOf('setSavedLinks'), 'savedLinks is set before the write resolves')
      .toBeGreaterThan(save.indexOf('await updateDoc'));
  });

  it('renders a labelled button that opens a dialog', async () => {
    await mountSheet();
    const btn = q('[data-testid="giving-share-button"]') as HTMLButtonElement;
    expect(btn, 'no share button rendered').toBeTruthy();
    expect(btn.textContent).toContain('Share giving page');
    expect(q('[data-testid="giving-share-sheet"]'), 'the sheet is open before a press').toBeNull();

    await act(async () => { btn.click(); });
    const sheet = q('[data-testid="giving-share-sheet"]')!;
    expect(sheet, 'pressing the button opened nothing').toBeTruthy();
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(sheet.getAttribute('aria-label')).toBeTruthy();
  });

  it('disables itself rather than sharing a URL it could not build', async () => {
    await mountSheet({ tenantId: null });
    expect((q('[data-testid="giving-share-button"]') as HTMLButtonElement).disabled).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 · 🔴 THE SECURITY PROPERTY
// ═════════════════════════════════════════════════════════════════════════════
describe('2 — 🔴 sharing emits only allow-listed URLs', () => {
  /** Every provider host, for the "is this URL one of ours" question. */
  const providerFor = (url: string): GivingProvider | undefined =>
    GIVING_PROVIDERS.find((p) => validateGivingUrl(url, p).ok);

  const isHarvestGivingPage = (url: string) => {
    const u = new URL(url);
    return u.protocol === 'https:'
      && !u.username && !u.password && !u.port
      && u.hostname.toLowerCase().endsWith(`.${HARVEST_APEX}`);
  };

  it('every URL in a payload is either the giving page or passes its provider allow-list', () => {
    const urls = givingShareUrls(buildGivingSharePayload(TENANT, CONFIG, 'Grace Chapel'));
    expect(urls.length, 'the payload emitted no URLs at all — the check is vacuous')
      .toBeGreaterThan(1);
    for (const url of urls) {
      const ok = isHarvestGivingPage(url) || providerFor(url) !== undefined;
      expect(ok, `${url} passed neither the giving-page shape nor any provider allow-list`).toBe(true);
    }
  });

  it('🔴 an off-allow-list URL in the stored config is DROPPED, not shared', () => {
    const hostile = {
      givingLinks: {
        // Every shape `validateGivingUrl` exists to refuse.
        paypal: { url: 'https://pаypal.me/grace' },            // Cyrillic а
        cashapp: { url: 'https://cash.app.givenow.example/x' }, // suffix, not host
        venmo: { url: 'https://venmo.com@collect.example/' },   // credentials
        zelle: { url: 'http://zellepay.com/' },                 // not https
        revolut: { url: 'javascript:alert(1)' },                // scheme
        wise: { url: 'https://givenow.example/wise.com' },      // host is elsewhere
      },
    };
    const payload = buildGivingSharePayload(TENANT, hostile, 'Grace Chapel');
    const urls = givingShareUrls(payload);
    // The giving page survives; not one hostile URL does.
    expect(urls).toEqual([`https://${TENANT}.${HARVEST_APEX}/?giving=1`]);
    for (const bad of ['pаypal', 'givenow.example', 'collect.example', 'javascript:', 'http://']) {
      expect(payload.text, `${bad} reached the share text`).not.toContain(bad);
    }
  });

  it('🔴 a hostile tenant id cannot move the giving page off theharvest.app', () => {
    for (const bad of [
      'evil.example/x', 'grace.evil.example', 'grace@evil.example', 'grace:8080',
      '../grace', 'grace/', '', '   ', 'grace.', 'gr ace',
    ]) {
      expect(buildGivingPageUrl(bad), `${JSON.stringify(bad)} produced a URL`).toBeNull();
    }
    // And the one that should work, does — so the check above is not vacuous.
    expect(buildGivingPageUrl('grace')).toBe(`https://grace.${HARVEST_APEX}/?giving=1`);
  });

  it('🔴 there is no seam that takes a pre-built link — the raw config is the only way in', () => {
    const src = read('components/donations/giving-share.ts');
    // The payload builder must call the validator itself.
    expect(src).toMatch(/readGivingLinks\(config\)/);
    // And the component must not build a URL of its own.
    const sheet = code('components/donations/GivingShareSheet.tsx');
    expect(sheet, 'the sheet string-builds a URL instead of rendering a validated one')
      .not.toMatch(/https?:\/\//);
  });

  it('the rendered sheet exposes no anchor to an unvalidated host', async () => {
    await mountSheet();
    await act(async () => { (q('[data-testid="giving-share-button"]') as HTMLButtonElement).click(); });
    for (const a of qa('a[href]')) {
      const href = a.getAttribute('href')!;
      expect(isHarvestGivingPage(href) || providerFor(href) !== undefined,
        `the sheet rendered an anchor to ${href}`).toBe(true);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 · 🔴 no-regression on THE-256
// ═════════════════════════════════════════════════════════════════════════════
describe('3 — 🔴 Stripe Connect appears as static "soon" copy, not a live control', () => {
  it('the switch itself is untouched and still off', () => {
    const src = readFileSync(path.join(SRC, 'lib/stripe-connect-feature.ts'), 'utf8');
    expect(src).toMatch(/export const STRIPE_CONNECT_ENABLED = false;/);
    expect(createHash('sha256').update(src).digest('hex'),
      '🔴 stripe-connect-feature.ts was modified — THE-256 says do not touch it')
      .toBe('ae4767b86754d414d6d8a052756c15b27c5cdee9fec33dc77dbc9ec1acb11d67');
  });

  it('the share surface names Stripe as a sentence, with no control', async () => {
    await mountSheet();
    await act(async () => { (q('[data-testid="giving-share-button"]') as HTMLButtonElement).click(); });
    const line = q('[data-testid="giving-share-stripe-soon"]')!;
    expect(line, 'the share sheet says nothing about Stripe').toBeTruthy();
    expect(line.textContent).toBe(GIVING_SHARE_STRIPE_SOON);
    expect(line.textContent!.toLowerCase()).toContain('coming soon');

    // 🔴 It is a <p>, and it contains nothing pressable or navigable.
    expect(line.tagName).toBe('P');
    expect(line.querySelector('button, a, input, select, [role="button"], [onclick]'),
      'the Stripe line carries a control').toBeNull();
  });

  it('🔴 the module holding that copy does not read the Connect flag at all', () => {
    // ⚠️ An IMPORT, not a mention: both files discuss THE-256 in prose, which is
    // the point — the docblock is where the reason lives. What must not exist is
    // a binding, because a binding is what a flag flip would turn into a branch.
    const IMPORTS_FLAG = /^\s*import[^;]*stripe-connect-feature|require\(['"][^'"]*stripe-connect-feature/m;
    const src = code('components/donations/giving-share.ts');
    expect(src, 'the share module imports the Connect switch — a flip would make this a live control')
      .not.toMatch(IMPORTS_FLAG);
    expect(src, 'the share module reads the Connect flag').not.toMatch(/\bSTRIPE_CONNECT_ENABLED\b/);
    const sheet = code('components/donations/GivingShareSheet.tsx');
    expect(sheet).not.toMatch(IMPORTS_FLAG);
    expect(sheet).not.toMatch(/\bSTRIPE_CONNECT_ENABLED\b/);
    // The prose, on the other hand, must still explain why.
    expect(read('components/donations/giving-share.ts'), 'the THE-256 rationale was deleted')
      .toMatch(/STATIC COPY, NOT A CONTROL/);
  });

  it('no Connect UI was restored anywhere', () => {
    for (const f of ['components/donations/GivingShareSheet.tsx', 'components/donations/giving-share.ts']) {
      const src = code(f);
      expect(src, `${f} spells a Connect action`)
        .not.toMatch(/Connect Stripe|\/api\/stripe\/connect|accounts\.create|StripeConnectPanel/);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 · no-regression — the marks stay monograms
// ═════════════════════════════════════════════════════════════════════════════
describe('4 — ProviderMark still renders monograms, not logos', () => {
  it('every provider draws one letter from the table, and no artwork', async () => {
    for (const provider of GIVING_PROVIDERS) {
      await act(async () => { root.render(<ProviderMark provider={provider} />); });
      const span = container.firstElementChild!;
      expect(span.tagName, `${provider.id} stopped being a text tile`).toBe('SPAN');
      expect(span.textContent, `${provider.id} does not draw its monogram`).toBe(provider.monogram);
      expect(span.textContent!.length, `${provider.id}'s monogram is not one letter`).toBe(1);
      // 🔴 No artwork of any kind, in any form.
      expect(span.querySelector('img, svg, picture, use, image'),
        `${provider.id} rendered artwork — that is someone else's trademark`).toBeNull();
      expect(span.getAttribute('style') ?? '', `${provider.id} carries a background image`)
        .not.toMatch(/background-image|url\(/);
      // The mark is decorative; the name beside it carries the accessible name.
      expect(span.getAttribute('aria-hidden'), `${provider.id}'s mark is not aria-hidden`).toBe('true');
    }
  });

  it('🔴 the source imports no brand-mark asset and the docblock still says why', () => {
    expect(read('components/donations/GivingLinks.tsx'), 'the monogram rationale was deleted')
      .toMatch(/trademark with no licence/);
    const src = code('components/donations/GivingLinks.tsx');
    expect(src, 'a logo asset was imported')
      .not.toMatch(/from '[^']*\.(?:svg|png|webp|jpe?g)'|simple-icons|react-icons/);
    // `tint`/`ink` are DATA — they must keep coming off the provider row.
    expect(src).toMatch(/backgroundColor: provider\.tint/);
    expect(src).toMatch(/color: provider\.ink/);
  });

  it('the share sheet reuses ProviderMark rather than drawing its own tile', async () => {
    const sheet = code('components/donations/GivingShareSheet.tsx');
    expect(sheet).toMatch(/import \{ ProviderMark \} from '\.\/GivingLinks'/);
    expect(sheet, 'the sheet added artwork').not.toMatch(/<img(?![^>]*alt="QR)/);

    await mountSheet();
    await act(async () => { (q('[data-testid="giving-share-button"]') as HTMLButtonElement).click(); });
    const rows = qa('[data-provider]');
    expect(rows.length, 'the sheet listed no payment links').toBeGreaterThan(0);
    for (const row of rows) {
      const mark = row.querySelector('[aria-hidden="true"]')!;
      expect(mark.querySelector('img, svg'), 'a mark in the share sheet carries artwork').toBeNull();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5 · 🔴 the allow-list is pinned
// ═════════════════════════════════════════════════════════════════════════════
describe('5 — giving-providers.ts hosts is unchanged', () => {
  /**
   * 🔴 THE ALLOW-LIST, WRITTEN OUT. A deny-list cannot answer "is this really
   * PayPal", so this table is the security boundary — and this pin is what
   * makes widening it a deliberate act with a test change attached.
   */
  const HOSTS: Record<string, readonly string[]> = {
    paypal: ['paypal.me', 'paypal.com'],
    cashapp: ['cash.app'],
    venmo: ['venmo.com'],
    zelle: ['zellepay.com', 'zellepay.org'],
    revolut: ['revolut.me'],
    wise: ['wise.com'],
  };

  it('every provider carries exactly the hosts it shipped with', () => {
    expect(GIVING_PROVIDERS.map((p) => p.id)).toEqual(Object.keys(HOSTS));
    for (const p of GIVING_PROVIDERS) {
      expect(Array.from(p.hosts), `${p.id}'s allow-list changed`).toEqual(HOSTS[p.id]);
    }
  });

  it('🔴 the whole module is byte-identical — this ticket does not touch it', () => {
    const sha = createHash('sha256')
      .update(readFileSync(path.join(SRC, 'components/donations/giving-providers.ts')))
      .digest('hex');
    expect(sha, '🔴 giving-providers.ts was modified — the allow-list is not this ticket\'s to change')
      .toBe('b1657211cde4a4114b7653a2d67fa38b48f97bf8e298cd20293590344e31e9e7');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6, 7, 8 · layout, touch targets, colour
// ═════════════════════════════════════════════════════════════════════════════
describe('6/7/8 — the share surface at every width, in every palette', () => {
  const VIEWPORTS = [380, 768, 1024, 1280, 1440];
  let emitted: { cls: string; minWidth: number; decls: Record<string, string> }[] = [];

  beforeAll(async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const r = createRoot(host);
    await act(async () => {
      r.render(<GivingShareSheet tenantId={TENANT} config={CONFIG} churchName="Grace Chapel" />);
    });
    // Open it, and open the QR panel too, so every class the surface can render
    // is in the compile set rather than only the closed state's.
    await act(async () => { (host.querySelector('[data-testid="giving-share-button"]') as HTMLButtonElement).click(); });
    await act(async () => { (host.querySelector('[data-testid="giving-share-qr-toggle"]') as HTMLButtonElement).click(); });
    const raw = Array.from(host.querySelectorAll('*'))
      .map((el) => el.getAttribute('class') || '').join(' ');
    await act(async () => { r.unmount(); });
    host.remove();

    const out = await buildUtilityCss(raw);
    const unescape = (sel: string) => sel.replace(/^\./, '').replace(/\\/g, '');
    const collect = (node: postcss.Rule, minWidth: number) => {
      const decls: Record<string, string> = {};
      node.walkDecls((d) => { decls[d.prop] = d.value.trim(); });
      emitted.push({ cls: unescape(node.selector), minWidth, decls });
    };
    postcss.parse(out).each((node) => {
      if (node.type === 'rule') collect(node as postcss.Rule, 0);
      if (node.type === 'atrule' && (node as postcss.AtRule).name === 'media') {
        const m = (node as postcss.AtRule).params.match(/min-width:\s*([\d.]+)px/);
        if (!m) return;
        (node as postcss.AtRule).walkRules((rr) => collect(rr, Number(m[1])));
      }
    });
    expect(emitted.length, 'Tailwind produced no rules for the share surface').toBeGreaterThan(0);
  }, 180_000);

  const effective = (classes: string[], viewport: number) => {
    const wanted = new Set(classes);
    const out: Record<string, string> = {};
    for (const r of emitted) if (wanted.has(r.cls) && r.minWidth <= viewport) Object.assign(out, r.decls);
    return out;
  };
  const px = (v?: string) => {
    if (!v) return null;
    const rem = v.match(/^(-?[\d.]+)rem$/); if (rem) return Number(rem[1]) * 16;
    const p = v.match(/^(-?[\d.]+)px$/); return p ? Number(p[1]) : null;
  };
  const classesOf = (el: Element) => (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);

  const openSheet = async () => {
    await mountSheet();
    await act(async () => { (q('[data-testid="giving-share-button"]') as HTMLButtonElement).click(); });
    await act(async () => { (q('[data-testid="giving-share-qr-toggle"]') as HTMLButtonElement).click(); });
  };

  // ── 6 ──────────────────────────────────────────────────────────────────────
  it('🔴 6 — the share surface clears the bottom nav at 380px', async () => {
    await openSheet();
    const sheet = q('[data-testid="giving-share-sheet"]')!;
    const scrim = q('[data-testid="giving-share-scrim"]')!;

    // The nav's own layer, read from the file rather than assumed.
    const nav = read('components/AdminDashboard.tsx');
    const navZ = Number(nav.match(/fixed lg:relative[^"]*?z-\[(\d+)\]/)?.[1]
      ?? nav.match(/z-\[(\d+)\][^"]*?shadow-\[0_-4px_20px/)?.[1]);
    expect(navZ, 'could not read the bottom nav z-index').toBe(100);

    const layerOf = (el: Element) =>
      Number((el.getAttribute('class') || '').match(/z-\[(\d+)\]/)?.[1] ?? NaN);
    expect(layerOf(scrim), 'the scrim renders behind the bottom nav').toBeGreaterThan(navZ);
    expect(layerOf(sheet), '🔴 the sheet renders BEHIND the bottom nav at 380px').toBeGreaterThan(navZ);
    expect(layerOf(sheet)).toBeGreaterThan(layerOf(scrim));

    // It also has to stay on screen and carry the home-indicator inset.
    const cls = classesOf(sheet);
    expect(cls, 'the sheet does not carry the safe-area inset the nav sits in').toContain('pb-safe');
    const d = effective(cls, 380);
    const maxH = d['max-height'];
    expect(maxH, 'the sheet declares no maximum height — it can grow past the top').toBeTruthy();
    expect(maxH).toMatch(/vh/);
    expect(Number(maxH.match(/([\d.]+)vh/)![1])).toBeLessThanOrEqual(90);
    // At 380 it is a bottom sheet: full-bleed, anchored to the bottom.
    expect(d.position).toBe('fixed');
    expect(px(d.bottom)).toBe(0);
  });

  // ── 7 ──────────────────────────────────────────────────────────────────────
  it.each(VIEWPORTS)('🔴 7 — every control is ≥44px at %ipx', async (vp) => {
    await openSheet();
    const controls = [
      q('[data-testid="giving-share-button"]')!,
      ...qa('[data-testid="giving-share-sheet"] button'),
    ];
    expect(controls.length, 'no controls were found — the check is vacuous').toBeGreaterThanOrEqual(5);
    for (const c of controls) {
      const d = effective(classesOf(c), vp);
      const minH = px(d['min-height']);
      const minW = px(d['min-width']);
      const label = (c.getAttribute('data-testid') || c.getAttribute('aria-label') || c.textContent || '?').trim();
      expect(minH, `"${label}" declares no min-height at ${vp}px`).not.toBeNull();
      expect(minH, `"${label}" is ${minH}px tall at ${vp}px`).toBeGreaterThanOrEqual(44);
      expect(minW, `"${label}" declares no min-width at ${vp}px`).not.toBeNull();
      expect(minW, `"${label}" is ${minW}px wide at ${vp}px`).toBeGreaterThanOrEqual(44);
    }
  });

  it('7b — the surface invents no width of its own', () => {
    const src = read('components/donations/GivingShareSheet.tsx');
    // A `w-[min(30rem,…)]` cap on the tablet-and-up panel is the ONE width, and
    // it is a maximum expressed against the viewport, not an invented measure.
    const widths = Array.from(src.matchAll(/(?<![a-z-])w-\[[^\]]+\]/g)).map((m) => m[0]);
    expect(widths, 'the sheet invented a width').toEqual(['w-[min(30rem,calc(100vw-2rem))]']);
    expect(src, 'the sheet spends a named Tailwind measure').not.toMatch(/\bmax-w-(?:xs|sm|md|lg|xl|\dxl)\b/);
  });

  // ── 8 ──────────────────────────────────────────────────────────────────────
  describe('8 — no colour is hardcoded and all four palettes resolve', () => {
    const NEW_FILES = [
      'components/donations/GivingShareSheet.tsx',
      'components/donations/giving-share.ts',
    ];
    /** `var(--token, #fallback)` is not a hardcoded colour: the token still wins. */
    const literals = (src: string) =>
      (src.replace(/var\(\s*--[a-z0-9-]+\s*,\s*#[0-9A-Fa-f]{3,8}\s*\)/gi, 'var(--x)')
        .match(/#[0-9A-Fa-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g) ?? []).sort();

    it.each(NEW_FILES)('%s spells no raw colour', (f) => {
      expect(literals(read(f))).toEqual([]);
    });

    it('AdminDonations added none either', () => {
      expect(literals(read('components/AdminDonations.tsx'))).toEqual([]);
    });

    let vars: Record<string, Record<string, string>>;
    let DEFAULT_FAMILY: string;
    beforeAll(async () => {
      DEFAULT_FAMILY = (await import('../../lib/theme')).DEFAULT_PALETTE_FAMILY;
      const css = readFileSync(path.join(REPO, 'src/app/globals.css'), 'utf8');
      const grab = (test: (sel: string) => boolean) => {
        const out: Record<string, string> = {};
        postcss.parse(css).walkRules((r) => {
          if (!test(r.selector)) return;
          r.walkDecls((d) => { if (d.prop.startsWith('--')) out[d.prop] = d.value.trim(); });
        });
        return out;
      };
      const harvestLight = grab((s) => s === ':root');
      const harvestDark = grab((s) => /(^|,)\s*\.dark\b|\[data-theme="dark"\]/.test(s) && !/data-palette/.test(s));
      const classicLight = grab((s) => /\[data-palette="classic"\]\[data-theme="light"\]/.test(s));
      const classicDark = grab((s) => /\[data-palette="classic"\](\.dark|\[data-theme="dark"\])/.test(s));
      vars = {
        // Classic first — it is DEFAULT_PALETTE_FAMILY, so it is what a church sees.
        'classic light': { ...harvestLight, ...classicLight },
        'classic dark': { ...harvestLight, ...harvestDark, ...classicDark },
        'harvest light': harvestLight,
        'harvest dark': { ...harvestLight, ...harvestDark },
      };
    });

    it('Classic is the default, and is the first palette checked', () => {
      expect(DEFAULT_FAMILY).toBe('classic');
      expect(Object.keys(vars)[0]).toBe('classic light');
    });

    it('every token the share surface names resolves in all four palettes', async () => {
      await openSheet();
      const named = new Set<string>();
      for (const el of [container, ...qa('*')]) {
        for (const m of (el.getAttribute?.('style') ?? '').matchAll(/var\((--[a-z0-9-]+)/g)) named.add(m[1]);
        for (const m of (el.getAttribute?.('class') ?? '').matchAll(/var\((--[a-z0-9-]+)/g)) named.add(m[1]);
      }
      // Plus the semantic classes the surface spends, resolved through globals.css.
      for (const t of ['--surface', '--surface-raised', '--surface-sunken', '--text-strong',
        '--text-muted', '--text-faint', '--border-default', '--border-strong', '--scrim-night']) named.add(t);

      expect(named.size, 'nothing was found to check — the scan is broken').toBeGreaterThanOrEqual(5);
      expect(named.has('--scrim-night'), 'the scrim is not a token').toBe(true);
      for (const [palette, table] of Object.entries(vars)) {
        for (const token of named) {
          if (token === '--brand-color') continue;
          expect(table[token], `${token} has no value in ${palette}`).toBeDefined();
        }
      }
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9 · 🔴 the two trees this ticket must not reach
// ═════════════════════════════════════════════════════════════════════════════
describe('9 — firestore.rules and functions/ byte-identical', () => {
  const digestOf = (abs: string) => createHash('sha256').update(readFileSync(abs)).digest('hex');

  it('🔴 firestore.rules is untouched', () => {
    expect(digestOf(path.join(REPO, 'firestore.rules')),
      '🔴 firestore.rules was modified — THE-281 must not reach it')
      .toBe('a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499');
  });

  it('🔴 functions/ is untouched, file for file', () => {
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const e of readdirSync(dir).sort()) {
        if (e === 'node_modules' || e === '.git') continue;
        const abs = path.join(dir, e);
        out.push(...(statSync(abs).isDirectory() ? walk(abs) : [abs]));
      }
      return out;
    };
    const files = walk(path.join(REPO, 'functions'));
    expect(files.length, 'functions/ is empty — the check is vacuous').toBeGreaterThan(0);
    const tree = createHash('sha256');
    for (const f of files) {
      tree.update(`${path.relative(REPO, f).split(path.sep).join('/')}\n`);
      tree.update(digestOf(f));
      tree.update('\n');
    }
    expect(tree.digest('hex'), '🔴 functions/ was modified — THE-281 must not reach it')
      .toBe('a51178b1e6b62a17f7e12a8b097e0b6792625cd1b17ff22cf7e05f5b87644a16');
  });
});
