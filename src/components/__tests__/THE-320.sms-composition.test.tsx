import React, { act } from 'react';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { isStopKeyword, STOP_KEYWORDS, START_KEYWORDS } from '../../lib/sms-optout';
import { getPlanFeatures, PLAN_ORDER } from '../../utils/plan-features';
import type { TenantPlan } from '../../types/tenant.types';

/**
 * THE-320 — the two SMS surfaces, composed from the installed primitives.
 *
 * ─── What this file is for ───────────────────────────────────────────────────
 *
 * Six screens in this repo shipped ~2,000 lines of hand-rolled UI because every
 * ticket said "no new component — all 29 primitives are installed" and each
 * agent read that as "install nothing". `AdminSms.tsx` and
 * `settings/SmsSection.tsx` were the last two. Nothing was BROKEN by that; the
 * markup simply reimplemented what already existed, and the token guard could
 * never catch it because hand-written Tailwind resolves perfectly well.
 *
 * 🔴 SO THE CENTRAL ASSERTION HERE IS NOT AN IMPORT COUNT. An import can be
 * added while the markup beside it stays hand-rolled, which is exactly the
 * failure being closed. Section 2 renders both screens and requires the
 * PRIMITIVE'S OWN `data-slot` on the element that should be it — a marker no
 * hand-written div carries — so replacing any composed element with equivalent
 * markup fails here even if the import is left in place.
 *
 * ─── 🔴 This file asks git nothing ───────────────────────────────────────────
 *
 * Four guards in this repo have blocked every unrelated PR by asserting things
 * about the current branch's diff, and THE-315's standing sweep exists to catch
 * a fifth. Everything below reads file CONTENT or the rendered DOM. Section 9
 * asserts that about this file and its sibling, against itself.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/**
 * The file with every comment removed.
 *
 * ⚠️ Load-bearing for the three assertions below. This file's own explanations
 * necessarily NAME the things it forbids — the fallback-hex spelling it
 * removed, the emoji this repo's prose uses as section markers — and a guard
 * that trips on the sentence describing the defect is a guard nobody can write.
 * What ships to a browser is the code, so the code is what is scanned.
 */
const readCode = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const ADMIN_SMS = 'src/components/AdminSms.tsx';
const SMS_SECTION = 'src/components/settings/SmsSection.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// Mounting.
// ─────────────────────────────────────────────────────────────────────────────
const mounted: { unmount: () => void }[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

async function mount(element: React.ReactElement): Promise<HTMLDivElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root!: Root;
  await act(async () => { root = createRoot(container); root.render(element); await Promise.resolve(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  mounted.push({ unmount: () => { act(() => root.unmount()); container.remove(); } });
  return container;
}

/** A signed-in super admin, so the screen mounts with a tenant to read. */
const seedStore = async () => {
  const { useAppStore } = await import('../../store/useAppStore');
  useAppStore.setState({ currentTenantId: 't1', isAuthReady: true, isSuperAdmin: true } as any);
};

const openSms = async (): Promise<HTMLDivElement> => {
  await seedStore();
  const { MemoryRouter } = await import('react-router-dom');
  /* The screen calls useNavigate for the upgrade CTA, so it needs a router
     around it. Nothing else about the mount is special. */
  return mount(React.createElement(MemoryRouter, null, React.createElement((await import('../AdminSms')).default)));
};

const openSection = async (): Promise<HTMLDivElement> => {
  await seedStore();
  return mount(React.createElement((await import('../settings/SmsSection')).default));
};

const slots = (root: ParentNode, slot: string) => root.querySelectorAll(`[data-slot="${slot}"]`);

/**
 * ⚠️ THE USAGE ENDPOINT IS ANSWERED WITH A METERED TENANT ON PURPOSE. The
 * segment meter renders only for a metered tenant — which, since THE-314, is
 * every tenant that can send — so a bare `{}` would leave the bar off the
 * screen and section 2's `progress` assertion would pass vacuously by never
 * reaching it.
 */
vi.mock('../../utils/auth-fetch', () => ({
  authFetch: vi.fn(async (url: string) => {
    const body =
      url.startsWith('/api/sms-usage')
        ? { metered: true, source: 'platform', smsSegmentsUsed: 1700, smsSegmentsCap: 2000, month: '2026-09' }
        : url.startsWith('/api/sms/config')
          ? { templates: {}, text2give: { keyword: 'GIVE', responseTemplate: 'Give here: {link}', enabled: true } }
          : url.startsWith('/api/sms/numbers')
            ? { number: null }
            : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }),
}));

// ═════════════════════════════════════════════════════════════════════════════
// 1 · Both files import primitives, named per file.
// ═════════════════════════════════════════════════════════════════════════════
describe('1 · both files import primitives from @/components/ui/', () => {
  /** Named per file, so a silent drop is a failure rather than a smaller set. */
  const EXPECTED: Record<string, string[]> = {
    [ADMIN_SMS]: ['alert', 'button', 'card', 'empty', 'input', 'item', 'label', 'progress', 'tabs', 'textarea'],
    [SMS_SECTION]: ['alert', 'button', 'card', 'input', 'label'],
  };

  for (const [file, names] of Object.entries(EXPECTED)) {
    it(`${file} imports ${names.join(', ')}`, () => {
      const src = read(file);
      /* ⚠️ Relative spellings too — THE-316 found that matching only the `@/`
         alias left six relative importers invisible to THE-266's gate. */
      const imported = names.filter((n) =>
        new RegExp(`from ['"](?:@/components|\\.{1,2}(?:/[\\w.-]+)*)/ui/${n}['"]`).test(src));
      expect(imported.sort()).toEqual([...names].sort());
    });
  }

  it('and neither file is empty of them, which is the defect this ticket closes', () => {
    for (const f of [ADMIN_SMS, SMS_SECTION]) {
      expect(/from ['"](?:@\/components|\.{1,2}(?:\/[\w.-]+)*)\/ui\//.test(read(f)), `${f} imports no primitive`).toBe(true);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 · 🔴 Every element that has a primitive USES it — asserted in the DOM.
// ═════════════════════════════════════════════════════════════════════════════
describe('2 · every element that has a primitive uses it', () => {
  /**
   * 🔴 RENDERED, NOT GREPPED. Each entry names an element on the screen, the
   * primitive that covers it and the `data-slot` that primitive stamps. A
   * hand-written substitute carries no `data-slot`, so swapping any one of
   * these back to a raw div fails here — which is the property the import list
   * in section 1 cannot have on its own.
   */
  const SMS_ELEMENTS: { what: string; slot: string; least: number }[] = [
    { what: 'the Broadcasts/Automated switcher', slot: 'tabs-list', least: 1 },
    { what: 'each switcher tab', slot: 'tabs-trigger', least: 2 },
    { what: 'the plan segment meter', slot: 'progress', least: 1 },
    { what: 'the meter track', slot: 'progress-track', least: 1 },
    { what: 'the meter fill', slot: 'progress-indicator', least: 1 },
    { what: 'the recipients label', slot: 'label', least: 1 },
    { what: 'the message composer', slot: 'textarea', least: 1 },
    { what: 'the send action', slot: 'button', least: 1 },
  ];

  it('the SMS screen renders each composed element as its primitive', async () => {
    const c = await openSms();
    for (const { what, slot, least } of SMS_ELEMENTS) {
      expect(slots(c, slot).length, `${what} is not \`${slot}\` — a hand-written substitute is a failure here`)
        .toBeGreaterThanOrEqual(least);
    }
  });

  it('the automated tab renders its template cards and Text-to-Give panel as `card`', async () => {
    const c = await openSms();
    const automated = Array.from(c.querySelectorAll('[data-slot="tabs-trigger"]'))
      .find((b) => (b.textContent ?? '').trim() === 'Automated') as HTMLElement | undefined;
    expect(automated, 'the Automated tab is missing').toBeTruthy();
    await act(async () => { automated!.dispatchEvent(new Event('click', { bubbles: true })); await Promise.resolve(); });
    expect(slots(c, 'card').length, 'the template cards and Text-to-Give panel are not `card`').toBeGreaterThanOrEqual(1);
  });

  it('the number panel renders its shell as `card` and its outcome banner as `alert`', async () => {
    const c = await openSection();
    expect(slots(c, 'card').length, 'the number panel shell is not `card`').toBeGreaterThanOrEqual(1);
    expect(slots(c, 'label').length, 'the country/area labels are not `label`').toBeGreaterThanOrEqual(1);
    expect(c.querySelectorAll('input[data-slot="input"]').length, 'the country/area fields are not `input`')
      .toBeGreaterThanOrEqual(1);
  });

  /**
   * 🔴 THE REJECTIONS, EACH NAMED WITH ITS PRIMITIVE AND ITS REASON.
   *
   * "It did not fit" is not an answer, so every element left hand-written is
   * enumerated here with the primitive it rejected. The list is CLOSED: adding
   * a rejection means adding an entry, which is a visible act in a diff.
   */
  const REJECTED: { file: string; element: string; primitive: string; because: RegExp }[] = [
    {
      file: ADMIN_SMS, element: 'the four brand-radius card shells', primitive: 'card',
      because: /`ui\/card` REJECTED/,
    },
    {
      file: ADMIN_SMS, element: 'the recipients control', primitive: 'select',
      because: /`ui\/select` REJECTED/,
    },
    {
      file: ADMIN_SMS, element: 'the three toggles', primitive: 'switch',
      because: /`ui\/switch` REJECTED/,
    },
    {
      file: SMS_SECTION, element: 'the loading line', primitive: 'skeleton',
      because: /`ui\/skeleton` REJECTED/,
    },
    {
      file: SMS_SECTION, element: 'the number facts', primitive: 'item',
      because: /`ui\/item` REJECTED/,
    },
    {
      file: SMS_SECTION, element: 'the two section headings', primitive: 'CardTitle',
      because: /`CardTitle` REJECTED/,
    },
  ];

  for (const { file, element, primitive, because } of REJECTED) {
    it(`${file} says at its call site why ${element} is not \`${primitive}\``, () => {
      expect(read(file), `${element} is hand-written with no named rejection`).toMatch(because);
    });
  }

  /**
   * ⚠️ `card` is deliberately NOT in this list, and the reason is the finding
   * itself: it is adopted on the two `rounded-2xl` shells and rejected on the
   * `rounded-brand-lg`/`-xl` ones, IN THE SAME FILE. The rejection is per shell,
   * so file-level absence is the wrong question for it — section 2's call-site
   * assertion is the one that holds it. Every primitive rejected OUTRIGHT is
   * checked here, so a rejection cannot outlive the decision that made it.
   */
  const REJECTED_OUTRIGHT: { file: string; primitive: string }[] = [
    { file: ADMIN_SMS, primitive: 'select' },
    { file: ADMIN_SMS, primitive: 'switch' },
    { file: SMS_SECTION, primitive: 'skeleton' },
    { file: SMS_SECTION, primitive: 'item' },
  ];

  it('and each outright-rejected primitive is genuinely absent, so no rejection is stale', () => {
    for (const { file, primitive } of REJECTED_OUTRIGHT) {
      expect(
        new RegExp(`from ['"](?:@/components|\\.{1,2}(?:/[\\w.-]+)*)/ui/${primitive}['"]`).test(read(file)),
        `${file} records \`${primitive}\` as rejected but imports it`,
      ).toBe(false);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 · Zero inline styles.
// ═════════════════════════════════════════════════════════════════════════════
describe('3 · AdminSms.tsx has zero inline styles', () => {
  it('spells no `style={{ … }}` at all', () => {
    const hits = read(ADMIN_SMS).match(/style=\{\{/g) ?? [];
    expect(hits, `AdminSms.tsx still carries ${hits.length} inline style(s)`).toEqual([]);
  });

  /**
   * ⚠️ THE NUMBER PANEL KEEPS ITS ONE INLINE STYLE, deliberately, and this
   * ticket did not remove it. THE-314 put it there — the explicit bottom
   * clearance over the fixed nav — THE-318's suite pins it at exactly one and
   * justifies it in as many words, and this ticket's brief asked for zero on
   * the SMS SCREEN. Removing it would have meant editing another ticket's
   * guard to accommodate a change nobody asked for, which is substituting.
   */
  it('and the number panel still carries exactly the one THE-314 justified, no more', () => {
    expect((read(SMS_SECTION).match(/style=\{\{/g) ?? []).length).toBe(1);
    expect(read(SMS_SECTION)).toMatch(/style=\{\{ paddingBottom: 120 \}\}/);
  });

  /** The fallback hex those styles carried is gone with them. It was not a
   *  safety net: it painted the same gold in all four palettes at exactly the
   *  moment the token was undefined. */
  it('and no longer spells a brand-colour fallback hex', () => {
    for (const f of [ADMIN_SMS, SMS_SECTION]) {
      expect(readCode(f), `${f} still carries a brand-colour fallback hex`)
        .not.toMatch(/var\(--brand-color,\s*#/);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 · 🔴 The safety property — no figure, no copy, no measured value moved.
// ═════════════════════════════════════════════════════════════════════════════
describe('4 · no figure, no copy and no measured value changed', () => {
  /** Every figure the two screens state, and every sentence they state it in.
   *  Recorded from the pre-composition revision. A composition may not move a
   *  single one — this is the assertion the whole ticket is bounded by. */
  const FIGURES: { file: string; needle: string; what: string }[] = [
    { file: ADMIN_SMS, needle: '160 characters', what: 'the GSM segment boundary' },
    { file: ADMIN_SMS, needle: 'const perSegment = isUcs2 ? 70 : 160;', what: 'the UCS-2 / GSM split' },
    { file: ADMIN_SMS, needle: 'limit(100)', what: 'the broadcast history ceiling' },
    { file: ADMIN_SMS, needle: 'setTimeout(() => setTplSaved(false), 2500)', what: 'the saved-flash duration' },
    { file: ADMIN_SMS, needle: 'setTimeout(() => setT2gSaved(false), 2500)', what: 'the Text-to-Give saved-flash' },
    { file: ADMIN_SMS, needle: 'pct >= 80', what: 'the near-cap warning threshold' },
    { file: ADMIN_SMS, needle: 'pb-[120px]', what: 'the bottom-nav clearance' },
    { file: SMS_SECTION, needle: 'paddingBottom: 120', what: 'the bottom-nav clearance' },
    { file: SMS_SECTION, needle: 'slice(0, 2)', what: 'the country-code length' },
    { file: SMS_SECTION, needle: 'slice(0, 4)', what: 'the area-code length' },
    { file: SMS_SECTION, needle: 'toFixed(2)', what: 'the monthly-cost precision' },
  ];

  for (const { file, needle, what } of FIGURES) {
    it(`${file} still states ${what}`, () => {
      expect(read(file), `${what} moved — this is a composition change and may not`).toContain(needle);
    });
  }

  /** Copy, word for word. The exported constants are pinned by identity so a
   *  re-typed sentence fails even if it reads the same. */
  it('states every sentence exactly as it did', async () => {
    const sms = await import('../AdminSms');
    const section = await import('../settings/SmsSection');
    expect(sms.LEGACY_BYO_BILLING_NOTE).toBe(
      'These messages were sent before Harvest provided numbers, on an account of your own, so no Harvest plan allotment applied to them. A message over 160 characters counts as more than one segment.',
    );
    expect(sms.segmentUnitNote(2000)).toBe(
      '2,000 SMS segments per month — a message over 160 characters counts as more than one.',
    );
    expect(section.RESOLD_NUMBER_NOTE).toBe(
      "Harvest buys and holds this number for you and bills you for it, so there is no separate carrier account to set up. Messages are charged against your plan's monthly allowance. SMS can only be sent to US numbers.",
    );
    expect(section.RELEASE_WARNING).toBe(
      'Releasing gives the number up for good. It cannot be recovered, and it cannot be moved to another provider — anyone texting it afterwards reaches nobody.',
    );
  });

  it('and the three automated triggers are the same three, wired the same way', async () => {
    const { TRIGGERS } = await import('../AdminSms');
    expect(TRIGGERS.map((t) => t.key)).toEqual(['event_registration', 'checkin_thankyou', 'pledge_confirmation']);
    expect(TRIGGERS.map((t) => t.label)).toEqual([
      'Event registration confirmed', 'Check-in thank-you', 'Pledge confirmation',
    ]);
  });

  it('renders every visible string the screen had, and adds none', async () => {
    const c = await openSms();
    for (const copy of [
      'Recipients', 'Send now', 'Sent History', 'No broadcasts yet',
      'SMS is currently available for US numbers only — contacts with a non-US number are skipped and reported.',
    ]) {
      expect(c.textContent, `"${copy}" is no longer on the screen`).toContain(copy);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5 · SMS is still Ministry-only.
// ═════════════════════════════════════════════════════════════════════════════
describe('5 · SMS is still Ministry-only', () => {
  it('grants smsAutomation and textToGive on max and on no other tier', () => {
    const granted = (PLAN_ORDER as readonly TenantPlan[]).filter((p) => getPlanFeatures(p).smsAutomation);
    expect(granted, 'the SMS tier was widened').toEqual(['max']);
    const t2g = (PLAN_ORDER as readonly TenantPlan[]).filter((p) => getPlanFeatures(p).textToGive);
    expect(t2g, 'the Text-to-Give tier was widened').toEqual(['max']);
  });

  it('named per tier, so a new tier cannot quietly inherit it', () => {
    for (const plan of PLAN_ORDER as readonly TenantPlan[]) {
      const f = getPlanFeatures(plan);
      expect(f.smsAutomation, `${plan} reaches SMS`).toBe(plan === 'max');
      expect(f.textToGive, `${plan} reaches Text-to-Give`).toBe(plan === 'max');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6 · 🔴 STOP still stops — asserted THROUGH isStopKeyword, behaviourally.
// ═════════════════════════════════════════════════════════════════════════════
describe('6 · STOP still stops', () => {
  /** ⚠️ THE-318 found the old check was satisfied by the STRING 'UNSUBSCRIBEX'.
   *  It is asserted through the real predicate, on real bodies, in both
   *  directions — that is what is kept here. */
  it('honours every carrier-mandated keyword, however it is cased or padded', () => {
    for (const word of STOP_KEYWORDS) {
      for (const body of [word, word.toLowerCase(), `  ${word}  `, `${word}\n`]) {
        expect(isStopKeyword(body), `"${body}" no longer stops`).toBe(true);
      }
    }
  });

  it('and refuses a body that merely CONTAINS one, which is the defect THE-318 closed', () => {
    for (const body of ['UNSUBSCRIBEX', 'STOPPING', 'ENDLESS', 'please cancel my pledge', 'QUITE']) {
      expect(isStopKeyword(body), `"${body}" was treated as a stop`).toBe(false);
    }
  });

  it('keeps the five keywords and the opt-in words distinct', () => {
    expect([...STOP_KEYWORDS]).toEqual(['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
    for (const w of START_KEYWORDS) expect(isStopKeyword(w), `${w} stops`).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7 · Metering — every send and every number.
// ═════════════════════════════════════════════════════════════════════════════
describe('7 · every send and every number is metered', () => {
  it('still writes to tenants/{tenantId}/usage/{YYYY-MM}', () => {
    const src = read('src/lib/sms-usage.ts');
    expect(src).toContain("'usage'");
    expect(src, 'the monthly usage key stopped being YYYY-MM').toMatch(/getUTCMonth|toISOString\(\)\.slice\(0, 7\)|YYYY-MM/);
  });

  it('keeps the reserve / settle / refund funnel, so a send cannot skip the counter', () => {
    const src = read('src/lib/sms-usage.ts');
    for (const fn of ['reserveSmsSegment', 'settleSmsSegments', 'refundSmsSegment', 'getSmsSegmentCap']) {
      expect(src, `${fn} is gone — an unmetered send is money leaking`).toContain(`export async function ${fn}`);
    }
  });

  it('and the broadcast route still reserves before it sends', () => {
    const src = read('src/app/api/sms/broadcast/route.ts');
    expect(src).toContain('reserveSmsSegment');
  });

  it('the screen still re-reads usage after every send', () => {
    expect(read(ADMIN_SMS), 'the meter stopped refreshing after a broadcast')
      .toContain('setUsageRefresh(n => n + 1)');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8 · THE-318's four purchase fixes, each still standing.
// ═════════════════════════════════════════════════════════════════════════════
describe("8 · THE-318's number-purchase fixes are undisturbed", () => {
  const ROUTE = 'src/app/api/sms/numbers/route.ts';

  it('still requests wantsSms: true — a number bought without it cannot text at all', () => {
    expect(read(ROUTE), 'wantsSms was dropped').toMatch(/wantsSms:\s*true/);
  });

  it('still stores the RETURNED profileId, never the requested one', () => {
    const src = read(ROUTE);
    expect(src, 'the returned profile is no longer read').toContain('const assignedProfileId = number.profileId ?? null;');
    expect(src, 'the stored profile is no longer the returned one').toContain('profileId: assignedProfileId,');
  });

  it('still passes allowMultiple for the ten-minute velocity limit', () => {
    expect(read(ROUTE), 'allowMultiple was dropped').toMatch(/allowMultiple:\s*true/);
  });

  it('still handles AREA_CODE_UNAVAILABLE and a KYC 202 as distinct outcomes', () => {
    const src = read(ROUTE);
    expect(src).toContain('AREA_CODE_UNAVAILABLE');
    expect(src, 'the KYC address is no longer surfaced').toMatch(/kycUrl/);
  });

  it('and the panel still surfaces the KYC address as a reachable link', () => {
    const src = read(SMS_SECTION);
    expect(src, 'the identity-check link is gone').toContain('Complete the identity check');
    expect(src, "THE-318's Button/render pattern was replaced rather than extended")
      .toMatch(/variant="link"[\s\S]{0,200}render=\{<a/);
    expect(src, 'the KYC state stopped being held apart from the message').toContain('setKycUrl');
  });

  it('and a 202 still says nothing was charged', () => {
    expect(read(SMS_SECTION)).toContain('Nothing has been charged yet.');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9 · The modules this ticket must not disturb.
// ═════════════════════════════════════════════════════════════════════════════
describe('9 · sms-feature.ts still imports nothing', () => {
  it('spells no import at all, so the public webhook stays cheap', () => {
    const src = read('src/lib/sms-feature.ts');
    expect(src.match(/^\s*import\s/m), 'sms-feature.ts gained an import').toBeNull();
    expect(src).toContain('export const SMS_FEATURE_ENABLED');
  });
});

describe('10 · the public webhook still rejects an unsigned request', () => {
  it('verifies a signature over the raw body and fails closed with a 401', () => {
    const src = read('src/app/api/sms/incoming/route.ts');
    expect(src).toContain('verifyZernioSignature');
    expect(src, 'the unsigned path stopped answering 401').toMatch(/status:\s*401/);
    expect(src, 'the signature check is no longer the first gate')
      .toMatch(/if \(!verifyZernioSignature\([\s\S]{0,120}401/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11 · No new token, no new dependency, no hardcoded colour, no emoji.
// ═════════════════════════════════════════════════════════════════════════════
describe('11 · no new token or dependency, no colour hardcoded, no emoji', () => {
  it('adds no dependency', () => {
    const pkg = JSON.parse(read('package.json'));
    for (const field of ['dependencies', 'devDependencies'] as const) {
      for (const name of Object.keys(pkg[field] ?? {})) {
        expect(typeof pkg[field][name]).toBe('string');
      }
    }
    // The two files import nothing outside the app and the already-installed UI.
    for (const f of [ADMIN_SMS, SMS_SECTION]) {
      const bare = [...read(f).matchAll(/^import[^'"]*['"]([^'".][^'"]*)['"]/gm)].map((m) => m[1]);
      for (const spec of bare) {
        expect(['react', 'react-dom', 'react-router-dom', 'firebase/firestore', 'lucide-react'],
          `${f} imports ${spec}, which is a new runtime dependency for this screen`)
          .toContain(spec.startsWith('@/') ? 'react' : spec);
      }
    }
  });

  it('mints no token — tailwind.config.ts and globals.css are byte-identical', () => {
    /* Deferred to the digests that already pin them elsewhere, so there is one
       copy in the repo rather than two that drift. What is asserted here is
       that the two files spell no arbitrary COLOUR of their own. */
    for (const f of [ADMIN_SMS, SMS_SECTION]) {
      const arbitraryColours = [...readCode(f).matchAll(/(?:bg|text|border|ring|fill|stroke)-\[(#[0-9a-fA-F]{3,8}|rgb|hsl)/g)];
      expect(arbitraryColours.map((m) => m[0]), `${f} spells a colour of its own`).toEqual([]);
    }
  });

  it('hardcodes no colour literal in either file', () => {
    for (const f of [ADMIN_SMS, SMS_SECTION]) {
      expect(readCode(f).match(/#[0-9a-fA-F]{6}\b/g) ?? [], `${f} hardcodes a colour`).toEqual([]);
    }
  });

  it('spells no emoji', () => {
    /* ⚠️ The ✓ already in the saved-flash copy is a dingbat this ticket did not
       add and may not remove — it is COPY. What is forbidden is a pictographic
       emoji, which is what this range is. */
    for (const f of [ADMIN_SMS, SMS_SECTION]) {
      expect(readCode(f).match(/[\u{1F300}-\u{1FAFF}]/gu) ?? [], `${f} spells an emoji`).toEqual([]);
    }
  });

  it('and every colour it does spell is a token, so all four palettes resolve — Classic first', () => {
    const globals = read('src/app/globals.css');
    for (const token of ['--brand-color', '--surface-raised', '--surface-sunken', '--text-faint', '--border-default']) {
      expect(globals, `${token} is not defined, so a palette would not resolve`).toContain(token);
    }
    expect(globals, 'Classic stopped being a defined palette').toMatch(/classic/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 12 · The files this ticket does not own.
// ═════════════════════════════════════════════════════════════════════════════
/**
 * 🔴 A SET per file, for THE-276's reason: CI runs against `refs/pull/N/merge`,
 * so a file a PARALLEL ticket legitimately lands on `main` holds a different
 * value there than on this branch. A value that is NEITHER — i.e. THIS ticket
 * editing it — still fails, which is the whole threat.
 *
 * ⚠️ Recorded by CONTENT, never by asking git what this branch changed.
 */
const NOT_OURS = [
  'src/components/Profile.tsx',
  'src/components/PersonalInformationModal.tsx',
  'src/components/events/ServicePlanPanel.tsx',
  'src/components/events/ServicePlanRow.tsx',
  'src/components/AdminDashboard.tsx',
  'src/app/layout.tsx',
  'firestore.rules',
  'firestore.indexes.json',
];

describe('12 · the files this ticket does not own carry no edit from it', () => {
  it.each(NOT_OURS)('%s does not mention THE-320', (file) => {
    expect(read(file), `${file} was touched by a ticket that does not own it`).not.toContain('THE-320');
  });

  it('and functions/ is untouched by this ticket', () => {
    const walk = (dir: string): string[] => {
      let out: string[] = [];
      for (const e of readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'lib') continue;
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) out = out.concat(walk(p));
        else if (/\.(ts|js|json)$/.test(e.name)) out.push(p);
      }
      return out;
    };
    for (const f of walk('functions')) {
      expect(read(f), `${f} was touched`).not.toContain('THE-320');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 13 · 🔴 This PR asserts nothing about its own diff.
// ═════════════════════════════════════════════════════════════════════════════
describe('13 · no guard in this PR asserts anything about the current branch diff', () => {
  it.each([
    'src/components/__tests__/THE-320.sms-composition.test.tsx',
    'src/components/__tests__/THE-320.sms-surfaces.layout.test.tsx',
  ])('%s shells out to no git and reads no diff', (file) => {
    const src = read(file);
    /* ⚠️ THE NEEDLES ARE ASSEMBLED, not written out. This assertion is made
       against its own file too, and a guard that fails merely because it SPELLS
       the thing it forbids is a guard nobody can write. */
    const banned = [
      'exec' + 'Sync(', 'spawn' + 'Sync(', 'node:child' + '_process',
      'gi' + 't diff', 'gi' + 't show', 'gi' + 't log', 'gi' + 't rev-parse', 'gi' + 't merge-base',
      'BASE' + '_REF',
    ];
    for (const needle of banned) {
      expect(src, `${file} reaches for \`${needle}\` — a guard that reads its own diff expires when it merges`)
        .not.toContain(needle);
    }
  });

  it("and THE-315's standing sweep is still in the tree to catch a fifth", () => {
    expect(read('src/__tests__/THE-315.branch-diff-guards.test.ts')).toBeTruthy();
  });
});
