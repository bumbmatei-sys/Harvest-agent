import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import postcss from 'postcss';

import GivingLinks from '../donations/GivingLinks';
import { readGivingLinks } from '../donations/giving-providers';
import { buildUtilityCss } from '../../test/support/tailwind-build';

/**
 * THE-256 — the Stripe Connect panel is hidden, and the church's own payment
 * links are not.
 *
 * ─── The distinction this file exists to hold ────────────────────────────────
 *
 * Stripe closed the platform account as `rejected.fraud` on 2026-08-27, so the
 * Connect panel now shows one sentence instead of a button that returns a raw
 * Stripe API error. The manual payment links — PayPal, Cash App, Venmo, Zelle,
 * Wise, Revolut — are a SEPARATE, LIVE surface that never touches Stripe:
 * Harvest is not in that flow, takes no fee and posts to no endpoint. They sit
 * one card below the hidden panel on the same screen, and they keep working.
 *
 * That is what makes hiding Stripe survivable rather than a church losing its
 * only way of being paid, so both halves are asserted here, against RENDERED
 * OUTPUT rather than against source strings.
 *
 * ⚠️ NO `git show`. Digests are literals, so this works on a shallow clone.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');
const GLOBALS = path.join(SRC, 'app/globals.css');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');
const digest = (rel: string) =>
  createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');

const HIDDEN_MESSAGE = 'Temporarily unavailable';

/* ── The backend surface PaymentSection reaches for, and nothing more ─────── */

const { tenantStatus, requests } = vi.hoisted(() => ({
  tenantStatus: { current: null as string | null },
  requests: { current: [] as string[] },
}));

vi.mock('../../firebase', () => ({
  auth: { currentUser: { uid: 'u1', email: 'pastor@grace.org' } },
  db: {},
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  getDoc: async (ref: { __path: string }) => ({
    exists: () => true,
    data: () => (ref.__path.startsWith('users')
      ? { tenantId: 'grace' }
      : { stripeConnectStatus: tenantStatus.current }),
  }),
}));
vi.mock('../../utils/auth-fetch', () => ({
  authFetch: async (url: string) => {
    requests.current.push(url);
    return new Response(JSON.stringify({ url: 'https://connect.stripe.test/onboard' }));
  },
}));
vi.mock('../settings/useTenantId', () => ({ getTenantId: async () => 'grace' }));

/* ── Mounting ─────────────────────────────────────────────────────────────── */

let container: HTMLDivElement;
let root: Root | null = null;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

/**
 * Mount the REAL `PaymentSection` with the master switch forced either way.
 *
 * `vi.doMock` + `vi.resetModules` rather than a file-level `vi.mock`, because
 * this suite has to render BOTH states — the whole claim is that one value is
 * all that separates them.
 */
async function mountPanel(enabled: boolean, status: string | null = null) {
  tenantStatus.current = status;
  requests.current = [];
  vi.resetModules();
  vi.doMock('../../lib/stripe-connect-feature', () => ({
    STRIPE_CONNECT_ENABLED: enabled,
    STRIPE_CONNECT_HIDDEN_MESSAGE: HIDDEN_MESSAGE,
  }));
  const { default: PaymentSection } = await import('../settings/PaymentSection');
  await act(async () => {
    root = createRoot(container);
    root.render(<PaymentSection />);
  });
  await flush();
  return container;
}

async function mountLinks(element: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(element);
  });
  await flush();
  return container;
}

const hiddenBlock = () => container.querySelector('[data-testid="stripe-connect-hidden"]');
const buttons = () => Array.from(container.querySelectorAll('button'));
const labelled = (text: RegExp) => buttons().find((b) => text.test(b.textContent || '')) ?? null;
const classesOf = (el: Element) => (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  container.remove();
  vi.doUnmock('../../lib/stripe-connect-feature');
  vi.resetModules();
});

/* ═════════════════════════════════════════════════════════════════════════
   1 — PaymentSection shows the unavailable message off, and its Connect UI on.
   ═════════════════════════════════════════════════════════════════════════ */
describe('1 — PaymentSection shows the unavailable message off, and its Connect UI on', () => {
  it('OFF — shows the message, and no Connect or Manage control at all', async () => {
    await mountPanel(false);
    expect(hiddenBlock(), 'the hidden state did not render').not.toBeNull();
    expect(container.textContent).toContain(HIDDEN_MESSAGE);
    // 🔴 Nothing to press. The defect this ticket exists to remove is a button
    // that reaches a closed platform account and returns a raw Stripe error.
    expect(buttons(), 'a control survived the gate').toEqual([]);
    expect(container.textContent, 'the panel still invites the church to connect')
      .not.toMatch(/Connect Stripe Account|Manage Stripe Dashboard|Complete Onboarding|Update Stripe Account/);
  });

  it('🔴 OFF — issues no request and reads no tenant document', async () => {
    // The wrapper is why: `StripeConnectPanel` is not MOUNTED while the switch
    // is off, so its `useEffect` never runs. A gate written as an early return
    // inside the panel would have conditionally called its hooks and still
    // fired the read.
    await mountPanel(false, 'active');
    expect(requests.current, 'the hidden panel called an endpoint').toEqual([]);
    expect(container.textContent, 'the hidden panel painted a Connect status').not.toMatch(/Active|Pending|Restricted/);
  });

  it('OFF — says nothing about why, and points nowhere', async () => {
    // The founder's wording, verbatim and alone: no explanation, no apology,
    // and deliberately no pointer to the manual links, which are already one
    // card below this on the Donations screen.
    await mountPanel(false);
    const block = hiddenBlock()!;
    // The card keeps its own heading, so the church still knows WHICH panel is
    // unavailable — and below it, the message and nothing else.
    // 🔴 THE-362 CHANGED THIS ONE WORD, and the property is unchanged: the
    // card still carries its OWN heading, so a church still knows WHICH thing
    // is unavailable. What it no longer does is name the processor — the
    // founder ("Hide everything that talks about stripe. In donations,
    // everywhere.") was reading it here, above the very sentence THE-350
    // rewrote for them.
    expect(block.querySelector('h3')!.textContent).toBe('Card giving');
    expect(block.querySelector('p')!.textContent).toBe(HIDDEN_MESSAGE);
    const text = (block.textContent || '').replace(/\s+/g, ' ').trim();
    expect(text).toBe(`Stripe Connect${HIDDEN_MESSAGE}`);
    expect(text).not.toMatch(/PayPal|Venmo|Cash App|Zelle|Wise|Revolut|fraud|appeal|Stripe closed/i);
  });

  it('ON — the not-connected branch offers Connect, and it opens /api/stripe/connect', async () => {
    await mountPanel(true, null);
    expect(hiddenBlock(), 'the hidden state rendered with the switch on').toBeNull();
    const connect = labelled(/Connect Stripe Account/);
    expect(connect, 'the Connect button did not come back').not.toBeNull();
    await act(async () => { connect!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
    expect(requests.current, 'the Connect onboarding endpoint changed').toEqual(['/api/stripe/connect']);
  });

  it.each([
    ['active', /Manage Stripe Dashboard/, '/api/stripe/connect/login-link'],
    ['pending', /Complete Onboarding/, '/api/stripe/connect'],
    ['restricted', /Update Stripe Account/, '/api/stripe/connect'],
  ])('ON — the %s branch comes back whole', async (status, label, endpoint) => {
    // 🔴 All four branches return, not a rebuilt approximation of them. There
    // is still exactly ONE answer to "are we connected" — a second one is the
    // bug THE-225 fixed once already.
    await mountPanel(true, status);
    const button = labelled(label);
    expect(button, `the ${status} control did not come back`).not.toBeNull();
    await act(async () => { button!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
    expect(requests.current[0], `the ${status} branch changed endpoint`).toBe(endpoint);
  });

  it('🔴 a church that is ALREADY connected keeps its status — it is hidden, not forgotten', async () => {
    // Nothing about the stored connection changes: the same tenant document
    // that said `active` before the switch says `active` after it, and the
    // panel paints it again the moment the switch flips back. The hide is a
    // gate in front of that read, not a correction to it.
    await mountPanel(false, 'active');
    expect(container.textContent).toContain(HIDDEN_MESSAGE);
    await act(async () => { root?.unmount(); root = null; });
    await mountPanel(true, 'active');
    expect(container.textContent).toContain('Active');
    expect(container.textContent).toContain('Your Stripe account is connected and ready to accept payments.');
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   2 — the manual payment links still render and still open.
   ═════════════════════════════════════════════════════════════════════════ */
describe('2 — the manual payment links still render and still open', () => {
  /** A church publishing three providers, through the REAL validator. */
  const BRANDING = {
    givingLinks: {
      paypal: { url: 'https://paypal.me/gracechapel', handle: 'gracechapel' },
      cashapp: { url: 'https://cash.app/$gracechapel', handle: '$gracechapel' },
      zelle: { email: 'giving@gracechapel.example', handle: 'Grace Chapel' },
    },
  };

  it('GivingLinks and the provider table are byte-for-byte unchanged', () => {
    // `hosts` is an ALLOW-list and this is how churches take money right now.
    expect(digest('src/components/donations/GivingLinks.tsx'))
      .toBe('88ed68e5c4b3f93204708d3c8eb81d88b3c586f78de32ae2e9dd3f980418a883');
    expect(digest('src/components/donations/giving-providers.ts'))
      .toBe('b1657211cde4a4114b7653a2d67fa38b48f97bf8e298cd20293590344e31e9e7');
  });

  it('🔴 renders a row per published provider, with the switch at its shipped value', async () => {
    // The real `lib/stripe-connect-feature` — no mock anywhere in this test.
    // This is what a church actually sees today, with Stripe hidden.
    await mountLinks(<GivingLinks links={readGivingLinks(BRANDING)} heading="Other ways to give" />);
    expect(container.querySelector('[data-testid="giving-links"]'), 'the links block did not render')
      .not.toBeNull();
    expect([...container.querySelectorAll('[data-provider]')].map((el) => el.getAttribute('data-provider')))
      .toEqual(['paypal', 'cashapp', 'zelle']);
  });

  it('🔴 and every one of them still OPENS — a real, navigable destination', async () => {
    await mountLinks(<GivingLinks links={readGivingLinks(BRANDING)} heading="Other ways to give" />);
    const anchors = Array.from(container.querySelectorAll('a[href]'));
    // ⚠️ TWO ANCHORS FOR THREE PROVIDERS, and that is the shipped design, not a
    // regression: Zelle has no per-church page, so it renders as a CARD showing
    // the church's email rather than a row that looks tappable and does
    // nothing. `PublicCampaign.giving-links.test.tsx` owns that rule; it is
    // restated here only so the count below reads as deliberate.
    expect(anchors.map((a) => a.getAttribute('href')), 'a link stopped opening').toEqual([
      'https://paypal.me/gracechapel',
      'https://cash.app/$gracechapel',
    ]);
    for (const a of anchors) {
      const href = a.getAttribute('href')!;
      expect(href, `${href} is not a usable destination`).toMatch(/^https:\/\//);
      expect(href, 'a link points at a Harvest endpoint').not.toMatch(/\/api\//);
    }
    const zelle = container.querySelector('[data-provider="zelle"]')!;
    expect(zelle.querySelector('a'), 'Zelle grew a dead anchor').toBeNull();
    expect(zelle.textContent, 'the church’s Zelle address is no longer shown')
      .toContain('giving@gracechapel.example');
  });

  it('the links never touch Stripe, which is why hiding Stripe cannot reach them', () => {
    const links = read('components/donations/GivingLinks.tsx');
    const providers = read('components/donations/giving-providers.ts');
    for (const [name, src] of [['GivingLinks', links], ['giving-providers', providers]] as const) {
      expect(src, `${name} reads the Stripe Connect switch`)
        .not.toMatch(/STRIPE_CONNECT_ENABLED|stripe-connect-feature/);
      expect(src, `${name} calls a Stripe endpoint`).not.toMatch(/api\/stripe/);
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   3 — every mount point of the panel, and only those.
   ═════════════════════════════════════════════════════════════════════════ */
describe('3 — the panel is gated once, and that covers every screen that mounts it', () => {
  it('🔴 exactly two screens mount PaymentSection', () => {
    // ⚠️ THE FILE COMMENT IN AdminDonations CLAIMS THREE — "THE SAME COMPONENT
    // SETTINGS AND FUNDRAISING MOUNT" — and that is stale. THE-246 turned the
    // Settings Payments row into a POINTER at Donations and removed the mount,
    // so Settings has not held this panel since. Two mounts, not three.
    const mounts = ['AdminDonations', 'AdminFundraising', 'AdminSettings', 'AdminCRM',
      'AdminGivingStatements', 'AdminAccounting', 'MainApp', 'Profile']
      .filter((f) => { try { return /<PaymentSection\b/.test(read(`components/${f}.tsx`)); } catch { return false; } });
    expect(mounts.sort()).toEqual(['AdminDonations', 'AdminFundraising']);
  });

  it('and Settings mounts it nowhere, so its Payments row is not a second copy', () => {
    const settings = read('components/AdminSettings.tsx');
    expect(settings, 'AdminSettings imports the Connect panel again').not.toMatch(/^import PaymentSection/m);
    expect(settings, 'AdminSettings mounts a second copy of the Connect panel').not.toMatch(/<PaymentSection\b/);
    // The row still leads somewhere: the manual links live on that screen too.
    expect(settings, 'the Payments row no longer opens Donations').toMatch(/onClick=\{onOpenDonations\}/);
  });

  it('AdminDonations grew no gate of its own', () => {
    // One switch, read in one place. A screen-level copy is how "one gate"
    // becomes two that can disagree.
    expect(read('components/AdminDonations.tsx'), 'AdminDonations grew its own Stripe Connect gate')
      .not.toMatch(/STRIPE_CONNECT_ENABLED|stripe-connect-feature/);
  });

  /**
   * ⚠️ AdminFundraising is the ONE deliberate exception, and it is narrow.
   *
   * The "New campaign" chooser's Fundraising option promised "One-time &
   * recurring gifts toward a goal" unconditionally, even with the switch off —
   * recurring giving only exists through `/api/stripe/donate`, which THIS
   * switch gates. That is a false claim, not a payment gate this screen was
   * missing: PaymentSection remains the only thing that decides whether the
   * Connect panel itself renders. So the flag is read here for exactly one
   * ternary, in copy, and nothing else — not a second "connected / pending /
   * restricted / not connected" branch, not an early return, not a call to any
   * gated route. `STRIPE_CONNECT_HIDDEN_MESSAGE` is not imported: that message
   * belongs to PaymentSection alone.
   */
  it('AdminFundraising reads the switch exactly once, for the chooser copy, and nothing else', () => {
    const fundraising = read('components/AdminFundraising.tsx');
    // The import line and its one use in the chooser's ternary — nowhere else.
    const uses = [...fundraising.matchAll(/STRIPE_CONNECT_ENABLED/g)];
    expect(uses.length, 'AdminFundraising reads STRIPE_CONNECT_ENABLED more than once').toBe(2);
    expect(fundraising, 'AdminFundraising imports the hidden-message constant too — that belongs to PaymentSection alone')
      .not.toMatch(/STRIPE_CONNECT_HIDDEN_MESSAGE/);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   4 — no colour is hardcoded and both palettes resolve.
   ═════════════════════════════════════════════════════════════════════════ */
describe('4 — no colour is hardcoded and both palettes resolve', () => {
  it('the hidden state paints only through semantic tokens', async () => {
    await mountPanel(false);
    const block = hiddenBlock()!;
    for (const el of [block, ...Array.from(block.querySelectorAll('*'))]) {
      expect(el.getAttribute('style'), 'the hidden state carries an inline style').toBeNull();
      for (const cls of classesOf(el)) {
        expect(cls, `${cls} looks like a literal colour`)
          .not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|oklch\(/);
      }
    }
    // The four it actually spends, named — each one a token every palette
    // redefines, so the message reads correctly in all four.
    const all = new Set([block, ...Array.from(block.querySelectorAll('*'))]
      .flatMap((el) => classesOf(el)));
    for (const token of ['bg-surface-raised', 'border-line-subtle', 'text-muted', 'text-body']) {
      expect(all.has(token), `the hidden state stopped using ${token}`).toBe(true);
    }
  });

  it('and the file this ticket edits carries no colour literal at all', () => {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const rel of ['components/settings/PaymentSection.tsx', 'lib/stripe-connect-feature.ts']) {
      const code = strip(read(rel));
      expect(code, `${rel} hardcodes a hex colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(code, `${rel} hardcodes a colour function`).not.toMatch(/\b(?:rgba?|hsla?|oklch)\(/);
    }
  });

  it('the tokens it spends resolve in both modes', () => {
    const css = readFileSync(GLOBALS, 'utf8');
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
    // The CSS variables behind bg-surface-raised, border-line-subtle,
    // text-muted and text-body (tailwind.config.ts).
    for (const [name, vars] of Object.entries(palettes)) {
      expect(Object.keys(vars).length, `${name} defines no variables`).toBeGreaterThan(0);
      for (const token of ['--surface-raised', '--border-subtle', '--text-muted', '--text-body']) {
        const resolved = resolve(vars, token);
        expect(resolved, `${token} unset for ${name}`).toBeTruthy();
        expect(resolved, `${token} does not resolve to a colour for ${name}`).toMatch(/^(#|rgb|hsl|color-mix)/);
      }
    }
    // The families must actually differ, or "four palettes" is one palette
    // wearing four names.
    expect(resolve(palettes.dark, '--surface-raised'))
      .not.toBe(resolve(palettes.light, '--surface-raised'));
    expect(resolve(palettes.light, '--text-muted'))
      .not.toBe(resolve(palettes.dark, '--text-muted'));
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   5 — it invents no width, fits every measured viewport, and shrinks nothing.
   ═════════════════════════════════════════════════════════════════════════ */
describe('5 — it invents no width and shrinks no touch target', () => {
  type Emitted = { cls: string; minWidth: number; decls: Record<string, string> };
  const emitted: Emitted[] = [];

  beforeAll(async () => {
    // Compile the real Tailwind config against every class BOTH states render.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const collectClasses = async (enabled: boolean, status: string | null) => {
      tenantStatus.current = status;
      vi.resetModules();
      vi.doMock('../../lib/stripe-connect-feature', () => ({
        STRIPE_CONNECT_ENABLED: enabled,
        STRIPE_CONNECT_HIDDEN_MESSAGE: HIDDEN_MESSAGE,
      }));
      const { default: PaymentSection } = await import('../settings/PaymentSection');
      let r: Root;
      await act(async () => { r = createRoot(host); r.render(<PaymentSection />); });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      const raw = Array.from(host.querySelectorAll('*'))
        .map((el) => el.getAttribute('class') || '').join(' ');
      await act(async () => { r!.unmount(); });
      vi.doUnmock('../../lib/stripe-connect-feature');
      return raw;
    };
    const raw = [
      await collectClasses(false, null),
      await collectClasses(true, null),
      await collectClasses(true, 'active'),
      await collectClasses(true, 'pending'),
      await collectClasses(true, 'restricted'),
    ].join(' ');
    host.remove();
    vi.resetModules();

    // v4 emits the same utilities wrapped in `@layer utilities` and with theme
    // values referenced rather than inlined; buildUtilityCss undoes exactly
    // those two representational changes, so the walker below is unchanged.
    const out = { css: await buildUtilityCss(raw) };

    const unescape = (sel: string) => sel.replace(/^\./, '').replace(/\\/g, '');
    const collect = (node: postcss.Rule, minWidth: number) => {
      const decls: Record<string, string> = {};
      node.walkDecls((d) => { decls[d.prop] = d.value.trim(); });
      emitted.push({ cls: unescape(node.selector), minWidth, decls });
    };
    postcss.parse(out.css).each((node) => {
      if (node.type === 'rule') collect(node, 0);
      if (node.type === 'atrule' && node.name === 'media') {
        const m = node.params.match(/min-width:\s*([\d.]+)px/);
        if (!m) return;
        node.walkRules((r) => collect(r, Number(m[1])));
      }
    });
    expect(emitted.length, 'Tailwind produced no rules for the panel').toBeGreaterThan(0);
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

  /**
   * ⚠️ WIDTH IS NOT MONOTONIC IN VIEWPORT in this app — the admin shell TAKES
   * 275.5px away when it becomes desktop at 1024px — so the panel is checked at
   * every measured width rather than only the widest.
   */
  const VIEWPORTS = [380, 768, 1024, 1280, 1440];

  it('declares no width of its own — it takes its measure from the screen that mounts it', () => {
    // `form-layout.ts` owns every width in this app, and the two screens that
    // mount this panel already apply its measure (AdminDonations spends
    // FORM_MEASURE). A width declared HERE would be a second, competing answer,
    // which is exactly what that module exists to prevent — so this ticket adds
    // none, and this file has never carried one.
    const src = read('components/settings/PaymentSection.tsx');
    expect(Array.from(src.matchAll(/(?:max-)?w-\[[^\]]+\]/g)).map((m) => m[0]),
      'PaymentSection invented a width').toEqual([]);
    expect(src, 'PaymentSection invented a named measure').not.toMatch(/\bmax-w-(?:xs|sm|md|lg|xl|\dxl)\b/);
  });

  it.each(VIEWPORTS)('the hidden state fits a %ipx viewport with room to spare', async (vp) => {
    await mountPanel(false);
    const card = hiddenBlock()!.firstElementChild!;
    const d = effective(classesOf(card), vp);
    // No cap declared — the card is fluid inside its parent's measure.
    expect(px(d['max-width']), `the hidden card declares a maximum width at ${vp}px`).toBeNull();
    expect(px(d.width), `the hidden card declares a fixed width at ${vp}px`).toBeNull();
    // What it DOES spend horizontally is its own padding, and that has to leave
    // the message somewhere to sit at the narrowest viewport measured.
    const pad = (px(d['padding-left']) ?? 0) + (px(d['padding-right']) ?? 0);
    expect(pad, `the hidden card spends ${pad}px of padding at ${vp}px`).toBeLessThan(vp / 2);
  });

  it('🔴 shrinks no touch target — the hidden state has none, and the four branches are untouched', async () => {
    // Nothing is made smaller to fit the message: while the switch is off the
    // panel renders no control at all, and while it is on every control is the
    // one that shipped, class string for class string.
    await mountPanel(false);
    expect(container.querySelectorAll('button, a[href], input, select, textarea').length,
      'the hidden state rendered an interactive control').toBe(0);

    const src = read('components/settings/PaymentSection.tsx');
    const SHIPPED_CONTROLS = [
      // active → Manage Stripe Dashboard
      'inline-flex items-center gap-2 px-5 py-2.5 bg-earth text-cream rounded-xl text-sm font-semibold hover:bg-warm-dark dark:bg-cream dark:text-earth dark:hover:bg-stone-200 transition-colors disabled:opacity-50',
      // pending → Complete Onboarding, and restricted → Update Stripe Account
      'px-5 py-2.5 bg-purple-600 text-white rounded-xl text-sm font-semibold hover:bg-purple-700 transition-colors disabled:opacity-50',
      // not connected → Connect Stripe Account
      'flex items-center gap-2 px-5 py-2.5 bg-purple-600 text-white rounded-xl text-sm font-semibold hover:bg-purple-700 transition-colors disabled:opacity-50',
    ];
    for (const cls of SHIPPED_CONTROLS) {
      expect(src, 'a Connect control changed size').toContain(cls);
    }
    // The `pending` and `restricted` buttons share one class string, so three
    // literals cover four controls — and the count says so, rather than a
    // reader having to trust it.
    expect((src.match(/px-5 py-2\.5/g) ?? []).length, 'a Connect control was added or removed').toBe(4);
  });

  it.each(VIEWPORTS)('every Connect control still paints its shipped height at %ipx', async (vp) => {
    // The ON direction, measured rather than read: each control's painted box
    // is its padding plus the taller of its text line box and its icon.
    for (const status of [null, 'active', 'pending', 'restricted']) {
      await mountPanel(true, status);
      for (const b of buttons()) {
        const d = effective(classesOf(b), vp);
        const pad = (px(d['padding-top']) ?? 0) + (px(d['padding-bottom']) ?? 0);
        const line = px(d['line-height']) ?? 0;
        const icon = Math.max(0, ...Array.from(b.querySelectorAll('svg'))
          .map((s) => Number(s.getAttribute('height') || 0)));
        const height = pad + Math.max(line, icon);
        // 40px is the top of this app's desktop density band
        // (DESKTOP_CONTROL_MAX_PX in form-layout.ts). Every Connect control
        // paints exactly the box it shipped with: 20px of padding around a
        // 20px line or a 16px icon.
        expect(height, `a ${status ?? 'not-connected'} control paints ${height}px at ${vp}px`).toBe(40);
      }
      await act(async () => { root?.unmount(); root = null; });
    }
  });
});
