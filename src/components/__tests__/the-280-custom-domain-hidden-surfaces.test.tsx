import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * THE-280 — the custom-domain panel is hidden, and the SUBDOMAIN is not.
 *
 * ─── The distinction this file exists to hold ────────────────────────────────
 *
 * Custom domains have never been tested — the Vercel subscription that would
 * activate them was never bought — so the panel now shows one sentence instead
 * of a field that writes a domain no Vercel project serves. The tenant's
 * SUBDOMAIN is a different mechanism and a live one: every church on the
 * platform is served on `<tenant>.theharvest.app`, that address is in the same
 * card as the hidden panel, and it keeps working.
 *
 * That is what makes hiding custom domains survivable rather than a church
 * losing its address, so both halves are asserted here, against RENDERED OUTPUT
 * rather than against source strings.
 *
 * ⚠️ NO `git show`. Digests are literals, so this works on a shallow clone.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');
const digest = (rel: string) =>
  createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');

const HIDDEN_MESSAGE = 'Custom domains are temporarily unavailable.';

/* ── The backend surface DomainSection reaches for, and nothing more ───────── */

const { reads, requests, tenantConfig } = vi.hoisted(() => ({
  reads: { current: [] as string[] },
  requests: { current: [] as string[] },
  tenantConfig: { current: {} as Record<string, unknown> },
}));

vi.mock('../../firebase', () => ({
  auth: { currentUser: { uid: 'u1', email: 'pastor@grace.org' } },
  db: {},
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  getDoc: async (ref: { __path: string }) => {
    // 🔴 EVERY READ IS RECORDED. Which documents open is the whole claim of
    // section 2: while the switch is off the tenant document — the only place a
    // stored `config.customDomain` lives — must never be opened.
    reads.current.push(ref.__path);
    return {
      exists: () => true,
      data: () => (ref.__path.startsWith('users')
        ? { tenantId: 'grace' }
        : { config: tenantConfig.current }),
    };
  },
  updateDoc: async () => { throw new Error('updateDoc was reached'); },
  setDoc: async () => { throw new Error('setDoc was reached'); },
  deleteDoc: async () => { throw new Error('deleteDoc was reached'); },
}));
vi.mock('../../utils/auth-fetch', () => ({
  authFetch: async (url: string) => {
    requests.current.push(url);
    return new Response(JSON.stringify({ status: 'pending', verification: [] }));
  },
}));

/* ── Mounting ─────────────────────────────────────────────────────────────── */

let container: HTMLDivElement;
let root: Root | null = null;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

/**
 * Mount the REAL `DomainSection` with the master switch forced either way.
 *
 * `vi.doMock` + `vi.resetModules` rather than a file-level `vi.mock`, because
 * this suite has to render BOTH states — the whole claim is that one value is
 * all that separates them.
 */
async function mountPanel(
  enabled: boolean,
  { hasCustomDomain = true, config = {} as Record<string, unknown> } = {},
) {
  reads.current = [];
  requests.current = [];
  tenantConfig.current = config;
  vi.resetModules();
  vi.doMock('../../lib/custom-domain-feature', () => ({
    CUSTOM_DOMAIN_ENABLED: enabled,
    CUSTOM_DOMAIN_HIDDEN_MESSAGE: HIDDEN_MESSAGE,
  }));
  const { default: DomainSection } = await import('../settings/DomainSection');
  await act(async () => {
    root = createRoot(container);
    root.render(<DomainSection hasCustomDomain={hasCustomDomain} onUpgrade={() => {}} />);
  });
  await flush();
  return container;
}

/**
 * Type into a controlled React input.
 *
 * ⚠️ ASSIGNING `.value` IS NOT ENOUGH. React tracks the previous value on the
 * node and skips the change event when its own tracker still agrees, so a plain
 * assignment leaves state empty and the click below then takes the EMPTY-domain
 * branch — which is how this test first passed vacuously.
 */
const type = async (field: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const hiddenBlock = () => container.querySelector('[data-testid="custom-domain-hidden"]');
const buttons = () => Array.from(container.querySelectorAll('button'));
const labelled = (text: RegExp) => buttons().find((b) => text.test(b.textContent || '')) ?? null;
const classesOf = (el: Element) => (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
const textOf = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim();

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  // jsdom defines no `alert`, and `handleSave` reaches for it on failure. Left
  // as a spy rather than a throw so a test that trips the failure path fails on
  // its own assertion instead of on an unhandled rejection.
  vi.stubGlobal('alert', vi.fn());
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  container.remove();
  vi.unstubAllGlobals();
  vi.doUnmock('../../lib/custom-domain-feature');
  vi.resetModules();
});

/* ═════════════════════════════════════════════════════════════════════════
   1 — DomainSection shows the unavailable message off, and its panel on.
   ═════════════════════════════════════════════════════════════════════════ */
describe('1 — DomainSection shows the unavailable message when the switch is off', () => {
  it('OFF — shows the message, and no domain control at all', async () => {
    await mountPanel(false);
    expect(hiddenBlock(), 'the hidden state did not render').not.toBeNull();
    expect(container.textContent).toContain(HIDDEN_MESSAGE);
    // 🔴 Nothing to press and nothing to type. The defect this ticket exists to
    // remove is a field that writes a domain no Vercel project serves.
    expect(buttons(), 'a control survived the gate').toEqual([]);
    expect(container.querySelectorAll('input:not([disabled])').length,
      'an editable field survived the gate').toBe(0);
    expect(container.textContent, 'the panel still invites the church to connect a domain')
      .not.toMatch(/Save Domain|Check Status|DNS Configuration|Upgrade to Unlock/);
  });

  it('OFF — says nothing about why, and points nowhere', async () => {
    // The card keeps its own heading, so the church still knows WHICH part is
    // unavailable — and below it, the message and nothing else. No explanation
    // of the unbought subscription, and no "coming soon" (that is the site's
    // job, and saying it here would be a second, unversioned claim).
    await mountPanel(false);
    const block = hiddenBlock()!;
    expect(block.querySelector('label')!.textContent).toBe('Custom domain');
    expect(block.querySelector('p')!.textContent).toBe(HIDDEN_MESSAGE);
    expect(textOf(block)).toBe(`Custom domain${HIDDEN_MESSAGE}`);
    expect(textOf(block)).not.toMatch(/vercel|subscription|untested|coming soon|DNS|CNAME|upgrade/i);
  });

  it('🔴 OFF — the message shows on EVERY plan, entitled or not', async () => {
    // Both shipped branches offered a custom domain: one collected it, the other
    // advertised it as the reason to upgrade. Neither may stand while the
    // feature cannot work, so the switch is read BEFORE the plan and an
    // unentitled church is not sold the upgrade either.
    for (const hasCustomDomain of [true, false]) {
      await mountPanel(false, { hasCustomDomain });
      expect(hiddenBlock(), `the hidden state did not render for hasCustomDomain=${hasCustomDomain}`)
        .not.toBeNull();
      expect(container.textContent).toContain(HIDDEN_MESSAGE);
      expect(container.textContent, 'an unentitled church is still sold the upgrade')
        .not.toMatch(/Upgrade to Unlock/);
      await act(async () => { root?.unmount(); root = null; });
    }
  });

  it('ON — the entitled branch comes back whole', async () => {
    await mountPanel(true, { hasCustomDomain: true });
    expect(hiddenBlock(), 'the hidden state rendered with the switch on').toBeNull();
    expect(labelled(/Save Domain/), 'Save Domain did not come back').not.toBeNull();
    expect(labelled(/Check Status/), 'Check Status did not come back').not.toBeNull();
    expect(container.textContent).toContain('DNS Configuration');
    expect(container.querySelector('input[placeholder="e.g. app.church.org"]'),
      'the domain field did not come back').not.toBeNull();
  });

  it('ON — the unentitled branch comes back whole too', async () => {
    await mountPanel(true, { hasCustomDomain: false });
    expect(hiddenBlock()).toBeNull();
    expect(labelled(/Upgrade to Unlock/), 'the upgrade prompt did not come back').not.toBeNull();
    expect(container.textContent).toMatch(/Custom domains are available on the/);
  });

  it('ON — Save Domain still posts to the provisioning route', async () => {
    await mountPanel(true, { hasCustomDomain: true });
    const field = container.querySelector('input[placeholder="e.g. app.church.org"]') as HTMLInputElement;
    await type(field, 'give.gracechapel.org');
    expect(field.value, 'the domain never reached React state').toBe('give.gracechapel.org');
    await act(async () => { labelled(/Save Domain/)!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
    // 🔴 It goes to the route, and the route's answer is what settles the state —
    // no Firestore fallback fires, which is why the armed writes above stay
    // unreached.
    expect(requests.current, 'the provisioning endpoint changed').toEqual(['/api/domains/provision']);
  });

  it('🔴 a church that ALREADY set a domain keeps it — it is hidden, not forgotten', async () => {
    // Nothing about the stored domain changes: the same tenant document that
    // said `gracechapel.org` before the switch says it after, and the panel
    // paints it again the moment the switch flips back. The hide is a gate in
    // front of that read, not a correction to it.
    const config = { customDomain: 'gracechapel.org', customDomainStatus: 'verified' };
    await mountPanel(false, { config });
    expect(container.textContent).toContain(HIDDEN_MESSAGE);
    expect(container.textContent, 'the hidden panel painted the stored domain')
      .not.toContain('gracechapel.org');
    await act(async () => { root?.unmount(); root = null; });

    await mountPanel(true, { config });
    const field = container.querySelector('input[placeholder="e.g. app.church.org"]') as HTMLInputElement;
    expect(field.value, 'the stored domain did not come back').toBe('gracechapel.org');
    expect(container.textContent).toContain('Verified');
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   2 — 🔴 no stored customDomain value is read or written.
   ═════════════════════════════════════════════════════════════════════════ */
describe('2 — no stored customDomain value is read or written while off', () => {
  it('🔴 OFF — the tenant document is never opened', async () => {
    // The tenant document is the ONLY place `config.customDomain` lives on the
    // client. The panel that reads it is not MOUNTED while the switch is off, so
    // its effect never runs. A gate written as an early return inside one
    // component would have conditionally called its hooks and still fired
    // this read.
    await mountPanel(false, { config: { customDomain: 'gracechapel.org' } });
    expect(reads.current, 'the hidden panel opened the tenant document')
      .toEqual(['users/u1']);
    expect(reads.current.some((p) => p.startsWith('tenants/'))).toBe(false);
  });

  it('OFF — and it issues no request to the provisioning route', async () => {
    await mountPanel(false, { config: { customDomain: 'gracechapel.org' } });
    expect(requests.current, 'the hidden panel called an endpoint').toEqual([]);
  });

  it('🔴 OFF — nothing is written: no updateDoc, setDoc or deleteDoc can fire', async () => {
    // Armed by construction — all three throw in this suite's firestore mock —
    // so a hidden panel that wrote anything would fail here rather than
    // silently clearing a church's domain. Stated as its own claim because
    // "hidden, not deleted" is the promise a church is owed.
    await mountPanel(false, { config: { customDomain: 'gracechapel.org' } });
    expect(container.textContent).toContain(HIDDEN_MESSAGE);
    // No control exists to trigger one, which is the structural half.
    expect(container.querySelectorAll('button, input:not([disabled])').length).toBe(0);
  });

  it('ON — the tenant document IS opened, so the test above is not vacuous', async () => {
    await mountPanel(true, { config: { customDomain: 'gracechapel.org' } });
    expect(reads.current).toEqual(['users/u1', 'tenants/grace']);
  });

  it('🔴 the users document is read exactly once either way — the subdomain needs it', async () => {
    // The split moved which function holds each read, never how many there are.
    // The parent reads the users document for the subdomain; the panel reads the
    // tenant document for the stored domain.
    await mountPanel(false);
    expect(reads.current.filter((p) => p.startsWith('users/'))).toEqual(['users/u1']);
    await act(async () => { root?.unmount(); root = null; });
    await mountPanel(true);
    expect(reads.current.filter((p) => p.startsWith('users/'))).toEqual(['users/u1']);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   3 — 🔴 the SUBDOMAIN half still renders, off and on.
   ═════════════════════════════════════════════════════════════════════════ */
describe('3 — the subdomain is untouched and still shown', () => {
  it.each([false, true])('the tenant address renders with the switch %s', async (enabled) => {
    // Every church on the platform is served here. If hiding custom domains had
    // reached this, the whole platform would have gone dark.
    await mountPanel(enabled);
    expect(container.textContent, 'the tenant address stopped rendering')
      .toContain('grace.theharvest.app');
    expect(container.textContent).toContain('Web Address');
    expect(container.textContent).toContain('Subdomain');
    const field = container.querySelector('input[disabled]') as HTMLInputElement;
    expect(field, 'the subdomain field is gone').not.toBeNull();
    expect(field.value).toBe('grace');
    expect(container.textContent).toContain('To change your subdomain, please contact support.');
  });

  it('🔴 the subdomain field stays READ-ONLY off — the gate loosened nothing', async () => {
    await mountPanel(false);
    expect((container.querySelector('input') as HTMLInputElement).disabled).toBe(true);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   4 — 🔴 onboarding, and which component actually asks.
   ═════════════════════════════════════════════════════════════════════════ */
describe('4 — no onboarding flow asks for a custom domain', () => {
  /**
   * 🔴 REPORTED DRIFT, PINNED HERE RATHER THAN ONLY IN THE PULL REQUEST.
   *
   * The ticket names `components/ChurchOnboarding.tsx` as a surface to hide —
   * "512 lines · `domain` ×23, `provision` ×8 — 🔴 onboarding asks for it" — and
   * asks which of it and `components/Onboarding.tsx` asks for a domain and why
   * the other does not. THE PREMISE IS WRONG IN BOTH HALVES:
   *
   *   · ChurchOnboarding asks for a SUBDOMAIN, never a custom domain. Every one
   *     of its `domain` matches is `subdomain` / `isSubdomainAvailable` /
   *     `signupSubdomain`, it contains the string `customDomain` zero times, and
   *     all eight `provision` matches are TENANT provisioning
   *     (`/api/tenants/provision-free`, `provisionFreeTenant`) — not
   *     `/api/domains/provision`. Its own docblock says so in as many words:
   *     "Subdomain, domain, logo, colour and description are claimed in the
   *     first-run 'Finish setup' screen after payment."
   *   · Onboarding.tsx has zero `domain` matches because it is not church signup
   *     at all — it is the MEMBER onboarding (name, phone, country, notification
   *     permission, PWA install). It never had a domain question to lose.
   *
   * So neither named component asks. The component that does is a THIRD one the
   * ticket does not mention: `FirstRunSetup.tsx`, the post-payment "Finish
   * setting up your ministry" screen, which mounts the shared `DomainSection`
   * for a tenant whose plan carries `customDomain`. Gating the section gates
   * that screen too, which is why neither onboarding file is edited.
   */

  it('🔴 ChurchOnboarding contains no custom-domain reference at all — before or after', () => {
    const src = read('components/ChurchOnboarding.tsx');
    expect(src, 'ChurchOnboarding names a custom domain').not.toContain('customDomain');
    expect(src, 'ChurchOnboarding calls the domain provisioning route')
      .not.toMatch(/api\/domains\/provision/);
    expect(src, 'ChurchOnboarding grew a gate for a question it never asked')
      .not.toMatch(/CUSTOM_DOMAIN_ENABLED|custom-domain-feature/);
    // What it DOES ask for, still: a subdomain.
    expect(src).toContain('isSubdomainAvailable');
    expect(src).toContain('.theharvest.app is available');
    // And its docblock is the primary source for the correction above.
    expect(src).toContain(
      'Subdomain, domain, logo, colour and description are claimed in the');
  });

  it('🔴 and all eight of its `provision` matches are TENANT provisioning', () => {
    const src = read('components/ChurchOnboarding.tsx');
    expect(src).toContain('/api/tenants/provision-free');
    expect(src).toMatch(/provisionFreeTenant/);
    // The count the ticket quoted, and what it is actually counting.
    expect((src.match(/provision/gi) ?? []).length).toBe(8);
    expect((src.match(/customDomain/g) ?? []).length).toBe(0);
  });

  it('Onboarding.tsx is the MEMBER flow, which is why it has no domain question', () => {
    const src = read('components/Onboarding.tsx');
    expect((src.match(/domain/gi) ?? []).length).toBe(0);
    // What it is instead: the member's own details, and the install step.
    expect(src).toContain('INSTALL_STEPS');
    expect(src).toContain('CountrySelect');
    expect(src).toMatch(/notification|messaging/i);
  });

  it('🔴 FirstRunSetup is the screen that asks, and it needs no gate of its own', () => {
    // One switch, read in one place. A screen-level copy is how "one gate"
    // becomes two that can disagree — the rule THE-256 set for the two screens
    // that mount PaymentSection.
    const src = read('components/FirstRunSetup.tsx');
    expect(src).toMatch(/<DomainSection\b/);
    expect(src, 'FirstRunSetup grew its own custom-domain gate')
      .not.toMatch(/CUSTOM_DOMAIN_ENABLED|custom-domain-feature/);
  });

  it('🔴 exactly two screens mount DomainSection, and neither grew a gate', () => {
    const mounts = ['AdminBranding', 'FirstRunSetup', 'AdminSettings', 'ChurchOnboarding',
      'Onboarding', 'AdminTenants', 'MainApp', 'Profile']
      .filter((f) => { try { return /<DomainSection\b/.test(read(`components/${f}.tsx`)); } catch { return false; } });
    expect(mounts.sort()).toEqual(['AdminBranding', 'FirstRunSetup']);
    for (const f of mounts) {
      expect(read(`components/${f}.tsx`), `${f} grew its own custom-domain gate`)
        .not.toMatch(/CUSTOM_DOMAIN_ENABLED|custom-domain-feature/);
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   5 — 🔴 onboarding is still completable and no funnel marker moved.
   ═════════════════════════════════════════════════════════════════════════ */
describe('5 — onboarding is still completable and no funnel marker moved', () => {
  /**
   * 🔴 THE TICKET'S STOP CONDITION 3, and it is satisfied by construction: NO
   * ONBOARDING STEP WAS REMOVED, because no onboarding step asked for a custom
   * domain (section 4). The three components that make up signup are
   * byte-for-byte unchanged, and so is every funnel marker.
   *
   * ⚠️ AND `FirstRunSetup` COULD NEVER HAVE BLOCKED ON A DOMAIN ANYWAY: its
   * `canFinish` reads the SUBDOMAIN only, so "Finish & enter app" is enabled or
   * not for reasons that have nothing to do with the panel below it. Asserted
   * below rather than asserted about, because it is the reason a church can
   * still get into its app.
   */
  it('🔴 all three signup components are byte-for-byte unchanged', () => {
    expect(digest('src/components/ChurchOnboarding.tsx'))
      .toBe('39a73c9c55bf71cd217b502da7721f1feeccf5f69b55b4694663ec0d65eb9d17');
    expect(digest('src/components/Onboarding.tsx'))
      .toBe('e0d3d0a6d10e0254bb9be0dc7df8cc2d81e1a65c7f65069e900f79142952f057');
    expect(digest('src/components/FirstRunSetup.tsx'))
      .toBe('684e614319ac4ccf0e94b68ee9ead3438f0096ab8164cdcef437e9f2208de0cb');
  });

  it('🔴 no funnel marker moved — App.tsx and post-auth-route are unchanged', () => {
    expect(digest('src/App.tsx'))
      .toBe('28e683200a1ce0b03de50dbd3df3f5c857883cf0cbb03cef10e390bea77e2a12');
    expect(digest('src/utils/post-auth-route.ts'))
      .toBe('9571ded38eeb30eb428345abcaceff0512f8028404354fcf4da18f8adaf21718');
  });

  it('and the markers themselves are still where the funnel expects them', () => {
    // Not vacuous: naming each one so a failure reads as "the funnel moved"
    // rather than "a digest changed".
    const app = read('App.tsx');
    expect(app).toContain("const FUNNEL_PATHS = ['/auth', '/onboarding', '/church-onboarding']");
    expect(app).toContain('resolvePostAuthFunnelRoute');
    const church = read('components/ChurchOnboarding.tsx');
    expect(church).toContain('signupInProgress: true');
    expect(church).toContain('signupSubdomain: subdomain');
    // 🔴 THE-73's rule, still holding: this screen records no termsAccepted.
    expect(church).not.toMatch(/termsAccepted:\s*true/);
  });

  it('🔴 FirstRunSetup can still be finished — its gate reads the subdomain only', () => {
    const src = read('components/FirstRunSetup.tsx');
    expect(src).toContain(
      "const canFinish = subdomain.length >= 3 && (subdomain === tenantId || status === 'available');");
    expect(src).toContain('/api/tenants/finish-setup');
    expect(src).toContain('Finish &amp; enter app');
    // The finish path never reads a custom domain, so a hidden panel cannot
    // block it.
    const finish = src.slice(src.indexOf('const handleFinish'), src.indexOf('const subBorder'));
    expect(finish).not.toMatch(/customDomain|domains\/provision/);
  });

  it('the paid-arrival hold is untouched', () => {
    // `setupCompleted: false` is what routes a paid arrival to FirstRunSetup.
    // Hiding a panel inside that screen must not change who reaches it.
    expect(read('App.tsx')).toContain('setupCompleted');
    expect(read('components/FirstRunSetup.tsx')).toContain('onFinished');
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   6 — no colour is hardcoded in the hidden state.
   ═════════════════════════════════════════════════════════════════════════ */
describe('6 — the hidden state paints only through semantic tokens', () => {
  it('carries no inline style and no colour literal', async () => {
    await mountPanel(false);
    const block = hiddenBlock()!;
    for (const el of [block, ...Array.from(block.querySelectorAll('*'))]) {
      expect(el.getAttribute('style'), 'the hidden state carries an inline style').toBeNull();
      for (const cls of classesOf(el)) {
        expect(cls, `${cls} looks like a literal colour`)
          .not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|oklch\(/);
      }
    }
  });

  it('spends only tokens this file already used — it invents no vocabulary', async () => {
    // 🔴 Every token below is one the four palettes each redefine, so the
    // message reads correctly in all of them — Classic included, which is the
    // default since #409. Nothing new is named here: `border-line`,
    // `text-strong` and `text-muted` were already in this file before the gate.
    await mountPanel(false);
    const block = hiddenBlock()!;
    const used = new Set([block, ...Array.from(block.querySelectorAll('*'))]
      .flatMap((el) => classesOf(el)));
    for (const token of ['border-line', 'text-strong', 'text-muted']) {
      expect(used.has(token), `the hidden state stopped using ${token}`).toBe(true);
    }
    const pristine = read('components/settings/DomainSection.tsx');
    for (const token of used) {
      expect(pristine, `${token} is a token this ticket invented`).toContain(token);
    }
  });

  it('and the switch module carries no colour at all', () => {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const code = strip(read('lib/custom-domain-feature.ts'));
    expect(code, 'the switch hardcodes a hex colour').not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code, 'the switch hardcodes a colour function').not.toMatch(/\b(?:rgba?|hsla?|oklch)\(/);
  });

  it('no opacity modifier reached a variable-backed token', async () => {
    // `bg-surface-raised/50` silently produces nothing — the rule
    // theming-stage2.test.ts pins on this exact file. Re-checked on the classes
    // the NEW state actually renders.
    await mountPanel(false);
    const block = hiddenBlock()!;
    for (const cls of [block, ...Array.from(block.querySelectorAll('*'))].flatMap(classesOf)) {
      expect(cls, `${cls} takes an opacity modifier on a variable-backed token`)
        .not.toMatch(/^(bg-surface[a-z-]*|border-line[a-z-]*|text-(strong|muted|faint))\/\d/);
    }
  });
});
