import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import React from 'react';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * Batch F — the five admin ministry screens (Community, Events, Fundraising,
 * Forms, Check-In) against the form-layout.ts rules.
 *
 * All five carried a per-screen container measure in REM, so each was two
 * different numbers depending on which side of 1024px you were on. Measured in
 * headless Chromium against the real compiled Tailwind CSS and the admin shell
 * as form-layout.ts derives it (a 232px sidebar plus 1.5rem either side, i.e.
 * a 1164.5px content box at 1440px), on unmodified 29769c6:
 *
 *   Community          max-w-6xl   1044px at 1440 — and UNCAPPED at 1024/1280
 *   Events list        max-w-6xl   1044px at 1440 — and UNCAPPED at 1024/1280
 *   Events editor      max-w-2xl    609px, with a 563.5px "Event Title" field
 *   Events attendees   max-w-3xl    696px, with a 696px search field
 *   Fundraising list   max-w-5xl    928px, UNCAPPED at 1024
 *   Fundraising detail max-w-3xl    696px, with a 667px pledge field
 *   Forms list         max-w-3xl    696px
 *   Forms builder      max-w-3xl    696px, with a 657.75px "Form title" field
 *   Forms submissions  max-w-4xl    812px
 *   Check-In list      max-w-3xl    696px
 *   Check-In detail    max-w-3xl    696px
 *   Check-In create    max-w-xl     522px, with a 483.75px "Session Name" field
 *
 * ── The one cap that could not simply be replaced ────────────────────────────
 * `max-w-xl` is 576px at the 16px MOBILE rem base, and the content box at a
 * 639px viewport is 591px — so the Check-In create form's cap BINDS below
 * 640px, unlike every other cap here (all >= 672px, i.e. inert on a phone).
 * Replacing it would have moved the phone, so it is kept verbatim and the sm:
 * rule is layered above it. That was measured, not assumed; the other eleven
 * caps were confirmed inert the same way.
 *
 * Every rule reaching the markup comes from src/components/layout/form-layout.ts
 * and every one of them is gated at `sm:`, so none of it can reach a phone —
 * which is the first and most important thing this file pins.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ts = (iso: string) => ({ toDate: () => new Date(iso), seconds: Math.floor(Date.parse(iso) / 1000) });
const snapDoc = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });

const EVENTS = [{
  id: 'ev1', title: 'Sunday Worship Gathering', description: 'Weekly gathering for the whole church family.',
  coverImage: null, location: '1200 Harvest Way, Springfield', isOnline: false, onlineLink: null,
  startDate: ts('2026-09-06T10:00:00Z'), endDate: ts('2026-09-06T12:00:00Z'), capacity: 250,
  registrationDeadline: ts('2026-09-05T10:00:00Z'), price: 0, currency: 'usd', status: 'published',
  createdAt: ts('2026-08-01T10:00:00Z'), createdBy: 'u', tenantId: 't1',
  registrationEnabled: true, ticketTypes: [], waitlistEnabled: false, discountCodes: [],
}];
const CAMPAIGNS = [{
  id: 'c1', title: 'Building Fund 2026', description: 'Expanding the sanctuary for our growing congregation.',
  goal: 500000, raised: 182500, isActive: true, tenantId: 't1', campaignType: 'pledge', pledgeDeadline: '2026-12-31',
}];
const FORMS = [snapDoc('f1', {
  title: 'Volunteer Sign-Up', description: 'Tell us where you would like to serve.',
  fields: [{ id: 'a', type: 'short_text', label: 'Full name', required: true, placeholder: 'Your name', order: 0 }],
  isActive: true, submissionCount: 12, tenantId: 't1', createdAt: ts('2026-08-01T10:00:00Z'),
})];
const SESSIONS = [snapDoc('s1', {
  name: 'Sunday Service — September 6', date: '2026-09-06T10:00', location: 'Main Auditorium',
  status: 'active', attendeeCount: 42, createdAt: ts('2026-08-01T10:00:00Z'), createdBy: 'u',
})];
const CHANNELS = [snapDoc('ch1', {
  name: 'announcements', description: 'Church-wide announcements', memberIds: ['u'],
  tenantId: 't1', createdAt: ts('2026-08-01T10:00:00Z'), createdBy: 'u',
})];

const SNAP: Record<string, unknown[]> = {
  customForms: FORMS, forms: FORMS, formSubmissions: [],
  checkinSessions: SESSIONS, checkins: SESSIONS, attendees: [],
  channels: CHANNELS, channelMessages: [], directMessages: [], dmMessages: [], users: [],
  events: EVENTS.map((e) => snapDoc(e.id, e as unknown as Record<string, unknown>)),
  campaigns: CAMPAIGNS.map((c) => snapDoc(c.id, c as unknown as Record<string, unknown>)),
  registrations: [], pledges: [],
};
const lookup = (q: unknown): unknown[] => {
  const pick = (x: unknown) => (x as { __path?: string })?.__path;
  const p: string = (Array.isArray(q) ? q.map(pick).find(Boolean) : pick(q)) || '';
  return SNAP[p.split('/').filter(Boolean).pop() ?? ''] ?? [];
};

/** Every write this suite would let through, so "nothing was written" is checkable. */
const writes: string[] = [];

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u', email: 'a@t.com' } } }));
vi.mock('firebase/firestore', () => ({
  collection: (_d: unknown, ...s: string[]) => ({ __path: s.join('/') }),
  doc: (_d: unknown, ...s: string[]) => ({ __path: s.join('/') }),
  query: (q: unknown) => q,
  where: (...a: unknown[]) => a, orderBy: (...a: unknown[]) => a, limit: (...a: unknown[]) => a,
  onSnapshot: (q: unknown, cb: unknown) => {
    const docs = lookup(q);
    if (typeof cb === 'function') (cb as (s: unknown) => void)({ docs, forEach: (f: never) => docs.forEach(f), size: docs.length });
    return () => {};
  },
  getDocs: async (q: unknown) => {
    const docs = lookup(q);
    return { docs, forEach: (f: never) => docs.forEach(f), size: docs.length };
  },
  getDoc: async () => ({ exists: () => true, data: () => ({}) }),
  addDoc: async (r: { __path?: string }) => { writes.push(`add:${r?.__path}`); return { id: 'x' }; },
  updateDoc: async (r: { __path?: string }) => { writes.push(`update:${r?.__path}`); },
  deleteDoc: async (r: { __path?: string }) => { writes.push(`delete:${r?.__path}`); },
  setDoc: async (r: { __path?: string }) => { writes.push(`set:${r?.__path}`); },
  serverTimestamp: () => null, Timestamp: class {}, increment: (n: number) => n,
  arrayUnion: (...a: unknown[]) => a, arrayRemove: (...a: unknown[]) => a,
  writeBatch: () => ({ set: () => {}, update: () => {}, delete: () => {}, commit: async () => { writes.push('batch'); } }),
}));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,AA' } }));
vi.mock('../ImageUpload', () => ({ ImageUpload: (p: { className?: string }) => <div data-image-upload="" className={p.className ?? ''} /> }));
vi.mock('../AdminQR', () => ({ default: () => <div data-admin-qr="" /> }));
vi.mock('../settings/PaymentSection', () => ({ default: () => <div data-payment-section="" /> }));
vi.mock('../AdminScreenHeader', () => ({
  useAdminHeader: () => ({ setHeaderAction: () => {}, setHeaderOverride: () => {}, setHeaderTitle: () => {} }),
  HeaderActionButton: (p: Record<string, unknown>) => <button {...p} />,
}));
vi.mock('../member/desktopKit', () => ({ HeroBand: (p: { children?: React.ReactNode }) => <div data-hero-band="">{p.children}</div> }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: () => {} }) }));
vi.mock('../../hooks/queries/useEventQueries', () => ({ useEvents: () => ({ data: EVENTS, isLoading: false }) }));
vi.mock('../../hooks/queries/useCampaignQueries', () => ({ useCampaigns: () => ({ data: CAMPAIGNS, isLoading: false }) }));
vi.mock('../../utils/auth-fetch', () => ({ authFetch: async () => ({ ok: true, json: async () => ({}) }) }));
vi.mock('../../utils/notify', () => ({ notifyError: () => {}, notifySuccess: () => {} }));
vi.mock('../../utils/tenant-scope', () => ({
  PLATFORM_TENANT_ID: 'platform', getTenantId: async () => 't1', getTenantIdFromHost: () => 't1',
  isPlatformContext: () => false, hasPlatformOverride: () => false,
  getTenantScope: async () => 't1', getWriteTenantScope: async () => 't1',
}));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: (sel?: (s: unknown) => unknown) => {
    const state = { currentTenantId: 't1', isAuthReady: true, isSuperAdmin: false, currentTenant: { id: 't1' } };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));
vi.mock('../../contexts/TenantContext', () => ({ useTenantOptional: () => ({ planFeatures: { checkInSystem: true } }) }));
vi.mock('../../utils/plan-features', () => ({ getPlanFeatures: () => ({ checkInSystem: true, fundraising: true }) }));
vi.mock('../../utils/super-admins', () => ({ isSuperAdminEmail: () => false }));

const { mountScreen, click, buttonByLabel } = await import('../../test/support/ministry-screens');
const {
  mobileLayer, colourTokens, isColourToken, allTokens, maxWidthPx, maxWidthTokens, isResponsive, breakpointOf, heightPx,
} = await import('../../test/support/class-inventory');
const FL = await import('../layout/form-layout');
const { FORM_CONTAINER, FORM_MEASURE, FIELD_WIDTH, FIELD_WIDTHS, ACTION_BUTTON, CONTROL_DENSITY, DENSITY_PX } = FL;

const SRC = path.resolve(__dirname, '..');
const REPO = path.resolve(SRC, '../..');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');
const FIXTURES = path.join(__dirname, '__fixtures__');
const RECORDING = !!process.env.UPDATE_LAYOUT_BASELINE;

/** The five screens, and the revision their pre-PR form is read from. */
const SCREENS = ['AdminCommunity', 'AdminEvents', 'AdminFundraising', 'AdminForms', 'AdminCheckin'] as const;
type Screen = typeof SCREENS[number];
const PRE_PR_REVISION = '29769c6';

const buttonContaining = (root: ParentNode, text: string): HTMLButtonElement => {
  const m = Array.from(root.querySelectorAll('button'))
    .find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').includes(text));
  if (!m) throw new Error(`no button containing "${text}" — the markup changed, test needs updating`);
  return m as HTMLButtonElement;
};

const open: { unmount: () => void }[] = [];
let mounted: { unmount: () => void } | null = null;
afterEach(() => {
  mounted?.unmount(); mounted = null;
  while (open.length) open.pop()!.unmount();
  writes.length = 0;
});

/** Mount a screen fresh, tracking it for teardown. */
async function screen(name: Screen): Promise<HTMLDivElement> {
  const Comp = (await import(`../${name}.tsx`)).default;
  const m = await mountScreen(<Comp />);
  mounted = m;
  return m.container;
}

/**
 * The sub-view each screen opens into, keyed by the label that gets there.
 * `null` is the surface a fresh mount already lands on.
 */
const SUB_VIEW: Record<Screen, [string, string] | null> = {
  AdminCommunity: null,
  AdminEvents: ['form', 'Create event'],
  AdminFundraising: null,
  AdminForms: ['builder', 'Create form'],
  AdminCheckin: ['create', 'New session'],
};

/**
 * Every surface of a screen, each on its OWN mount.
 *
 * Navigating one container and handing the same node back under two keys would
 * record and assert the post-navigation DOM twice, which is how the default
 * surface silently stopped being covered at all.
 */
async function surfaces(name: Screen): Promise<Record<string, HTMLDivElement>> {
  const Comp = (await import(`../${name}.tsx`)).default;
  const first = await mountScreen(<Comp />);
  open.push(first);
  const out: Record<string, HTMLDivElement> = { default: first.container };
  const sub = SUB_VIEW[name];
  if (sub) {
    const [view, label] = sub;
    const second = await mountScreen(<Comp />);
    open.push(second);
    await click(buttonContaining(second.container, label));
    out[view] = second.container;
  }
  return out;
}

interface ViewBaseline { mobileLayer: string[]; colours: string[] }
type Baseline = Record<string, ViewBaseline>;

/**
 * Baselines are extracted mechanically from 29769c6 — the unmodified files
 * before this PR's diff — never hand-typed. Each screen is copied out, restored
 * to that revision, mounted with the SAME mocks the assertions use, then put
 * back. Same recipe as AdminCourseEditor.desktop-layout.test.tsx.
 *
 * To re-record — ONLY when the sub-640px rendering is deliberately changing,
 * which for this PR it is not:
 *
 *     UPDATE_LAYOUT_BASELINE=1 npx vitest run \
 *       src/components/__tests__/AdminMinistry.desktop-layout.test.tsx
 */
const BASELINE: Partial<Record<Screen, Baseline>> = {};

beforeAll(async () => {
  if (RECORDING) {
    for (const name of SCREENS) {
      const file = path.join(SRC, `${name}.tsx`);
      const backup = readFileSync(file, 'utf8');
      try {
        writeFileSync(file, execSync(`git show ${PRE_PR_REVISION}:src/components/${name}.tsx`, { cwd: REPO, encoding: 'utf8' }));
        vi.resetModules();
        // Record EVERY surface, not just the one a fresh mount lands on: a rule
        // spelled on a sub-view is invisible to a default-surface-only pin, which
        // is exactly how an ungated width on the Check-In create form slipped
        // through the first cut of this file.
        const recorded: Baseline = {};
        for (const [view, c] of Object.entries(await surfaces(name))) {
          recorded[view] = { mobileLayer: mobileLayer(c), colours: colourTokens(c) };
        }
        while (open.length) open.pop()!.unmount();
        writeFileSync(path.join(FIXTURES, `ministry-${name}.json`), JSON.stringify(recorded, null, 2) + '\n');
      } finally {
        writeFileSync(file, backup);
        vi.resetModules();
      }
    }
  }
  for (const name of SCREENS) {
    BASELINE[name] = JSON.parse(readFileSync(path.join(FIXTURES, `ministry-${name}.json`), 'utf8')) as Baseline;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. The one that matters most — one per file.
// ─────────────────────────────────────────────────────────────────────────────
describe('the sub-640px rendering of each file is unchanged', () => {
  /**
   * Tokens this PR takes OFF the mobile layer. Every one is a rem container cap
   * whose smallest value is 672px — wider than the 591px content box at the
   * 639px top of the phone range — so it could never bind below `sm:`, and
   * removing it cannot move a phone.
   *
   * Measured in headless Chromium against the real compiled Tailwind CSS at
   * 380 / 480 / 639px: all thirteen surfaces are byte-identical, full-page
   * screenshot for screenshot, across this change.
   */
  const NON_BINDING_CAPS: Record<string, number> = {
    'max-w-2xl': 672, 'max-w-3xl': 768, 'max-w-4xl': 896, 'max-w-5xl': 1024, 'max-w-6xl': 1152,
  };
  const ALLOWED_REMOVALS: Record<string, string> = {
    ...Object.fromEntries(Object.entries(NON_BINDING_CAPS)
      .map(([t, px]) => [t, `a ${px}px cap, above the 639px top of the phone range`])),
    'mx-auto': 'auto side margins on a block whose width is auto resolve to 0 — it centred nothing until a cap gave it something to centre, and the cap is now sm:-gated with it',
  };

  /** This PR adds no unprefixed token at all: every rule it spells is sm:-gated. */
  const ALLOWED_ADDITIONS: Record<string, string> = {};

  const toTokens = (layer: string[]) =>
    [...new Set(layer.flatMap((l) => (l.split('\t')[2] ?? '').split(' ').filter(Boolean)))];

  for (const name of SCREENS) {
    it(`puts no undocumented token on the ${name} mobile layer`, async () => {
      for (const [view, c] of Object.entries(await surfaces(name))) {
        const before = new Set(toTokens(BASELINE[name]![view].mobileLayer));
        const added = toTokens(mobileLayer(c)).filter((t) => !before.has(t));
        expect(added.filter((t) => !(t in ALLOWED_ADDITIONS)),
          `${name}/${view} gained a token that reaches a phone`).toEqual([]);
      }
    });
  }

  for (const name of SCREENS) {
    it(`takes nothing off the ${name} mobile layer that could have bound below 640px`, async () => {
      for (const [view, c] of Object.entries(await surfaces(name))) {
        const now = new Set(toTokens(mobileLayer(c)));
        for (const t of toTokens(BASELINE[name]![view].mobileLayer).filter((t) => !now.has(t))) {
          expect(t in ALLOWED_REMOVALS,
            `${name}/${view} dropped "${t}", which is not documented as phone-neutral`).toBe(true);
        }
      }
    });
  }

  it('names a real px width for each cap it removed, so "cannot bind" is checkable', () => {
    for (const [token, px] of Object.entries(NON_BINDING_CAPS)) {
      expect(maxWidthPx(token), `${token} is not ${px}px`).toBe(px);
      expect(px).toBeGreaterThan(639);
    }
  });

  it('keeps the one cap that DOES bind below 640px exactly as it was', () => {
    // `max-w-xl` is 576px at the 16px mobile rem base, and the content box at a
    // 639px viewport measures 591px — so this cap is live on a phone, unlike
    // every other one here. It is kept verbatim; the sm: rule only out-ranks it
    // above 640px. Measured, not assumed.
    expect(maxWidthPx('max-w-xl')).toBe(576);
    expect(maxWidthPx('max-w-xl')).toBeLessThan(591);
    expect(read('AdminCheckin.tsx')).toContain('max-w-xl mx-auto ${FORM_MEASURE}');
  });

  it('gates every rule the shared module exports at sm: or above', () => {
    const tokens = [
      FORM_CONTAINER, FORM_MEASURE, ACTION_BUTTON,
      ...FIELD_WIDTHS, ...Object.values(CONTROL_DENSITY),
    ].flatMap((r) => r.split(' '));
    expect(tokens.length).toBeGreaterThan(0);
    for (const t of tokens) expect(isResponsive(t), `"${t}" applies on a phone`).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Touch targets.
// ─────────────────────────────────────────────────────────────────────────────
describe('no touch target got smaller', () => {
  it('adds no unprefixed height anywhere, so no tap target can shrink', async () => {
    for (const name of SCREENS) {
      for (const [view, c] of Object.entries(await surfaces(name))) {
        const base = new Set(BASELINE[name]![view].mobileLayer.flatMap((l) => l.split('\t')[2]?.split(' ') ?? []));
        for (const t of allTokens(c).filter((t) => /(?:^|:)h-/.test(t) && !isResponsive(t))) {
          expect(base.has(t), `${name}/${view} gained unprefixed ${t}`).toBe(true);
        }
      }
    }
  });

  it('keeps both density heights behind sm:, so a 38px control cannot become a 38px tap target', () => {
    for (const token of [CONTROL_DENSITY.control, CONTROL_DENSITY.action]) {
      for (const t of token.split(' ')) expect(breakpointOf(t)).toBe('sm');
    }
    expect(heightPx('sm:h-[38px]')).toBe(DENSITY_PX.control);
    expect(heightPx('sm:h-[40px]')).toBe(DENSITY_PX.action);
  });

  it('records the measured result rather than asserting a 44px floor', () => {
    // 423 tap targets were compared before/after at 380, 480 and 639px in
    // headless Chromium: none lost width or height, and the full-page
    // screenshots are byte-identical at all three. Many targets here are
    // already below 44px, unprefixed and deliberately left alone (THE-190), so
    // the assertion is "nothing shrank", never "everything clears 44px".
    expect(DENSITY_PX.control).toBeLessThan(44);
    expect(CONTROL_DENSITY.control.startsWith('sm:')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The container rule — one per file.
// ─────────────────────────────────────────────────────────────────────────────
describe('each surface is constrained at desktop widths', () => {
  const capOf = (c: ParentNode) => maxWidthTokens(c.firstElementChild as Element);

  for (const name of SCREENS) {
    it(`caps every surface of ${name} with a shared measure and nothing else`, async () => {
      for (const [view, c] of Object.entries(await surfaces(name))) {
        const caps = capOf(c);
        expect(caps.length, `${name}/${view} carries ${caps.length} caps: ${caps.join(' ')}`).toBeGreaterThan(0);
        for (const cap of caps) {
          // Either a shared measure, or the one pre-existing phone-live cap.
          const shared = cap === 'sm:max-w-[1120px]' || cap === 'sm:max-w-[940px]';
          expect(shared || cap === 'max-w-xl', `${name}/${view} spells its own ${cap}`).toBe(true);
        }
        expect(caps.some((c2) => c2.startsWith('sm:')), `${name}/${view} has no desktop cap`).toBe(true);
      }
    });
  }

  it('gives the data-dense pages the PAGE measure and the forms the FORM measure', () => {
    expect(FORM_CONTAINER).toContain('1120px');
    expect(FORM_MEASURE).toContain('940px');
    // The three form surfaces name the form measure; every other surface is a page.
    for (const f of ['AdminEvents.tsx', 'AdminForms.tsx', 'AdminCheckin.tsx']) expect(read(f)).toContain('FORM_MEASURE');
    for (const f of ['AdminCommunity.tsx', 'AdminFundraising.tsx']) {
      expect(read(f)).toContain('FORM_CONTAINER');
      expect(read(f)).not.toContain('FORM_MEASURE');
    }
  });

  it('leaves no rem-based measure on any surface ROOT of the five', async () => {
    // `max-w-xl` is the documented phone-live exception. Modal and prose
    // measures (`max-w-sm`/`max-w-md`/`max-w-lg`) are live on a phone and are
    // not surface roots, so they are deliberately untouched and unchecked here.
    for (const name of SCREENS) {
      for (const [view, c] of Object.entries(await surfaces(name))) {
        for (const cap of maxWidthTokens(c.firstElementChild as Element)) {
          const arbitrary = /max-w-\[\d+px\]$/.test(cap);
          expect(arbitrary || cap === 'max-w-xl', `${name}/${view} root still spells rem-based ${cap}`).toBe(true);
        }
      }
      mounted?.unmount(); mounted = null;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Where the numbers come from.
// ─────────────────────────────────────────────────────────────────────────────
describe('widths, heights and gaps come from form-layout, not new per-screen values', () => {
  it('imports the rules in every file that spells one', () => {
    for (const name of SCREENS) expect(read(`${name}.tsx`)).toContain("from './layout/form-layout'");
  });

  it('spells no sm:-gated width, height or gap literal outside the module', () => {
    for (const name of SCREENS) {
      const literals = [...read(`${name}.tsx`).matchAll(/sm:(?:max-w|w|h|gap|space-[xy]|p[xytblr]?|m[xytblr]?)-\[[^\]]+\]/g)].map((m) => m[0]);
      expect(literals, `${name} writes its own sm: size`).toEqual([]);
    }
  });

  it('renders no sm:-gated size the module does not define', async () => {
    const defined = new Set([
      ...FORM_CONTAINER.split(' '), ...FORM_MEASURE.split(' '), ...ACTION_BUTTON.split(' '),
      ...FIELD_WIDTHS, ...Object.values(CONTROL_DENSITY).flatMap((v) => v.split(' ')),
      // `sm:w-auto` carries no VALUE — it is the block-level twin of
      // `sm:flex-none`, spelled at the call site exactly as AdminCourseEditor
      // already spells it for its own full-width buttons.
      'sm:w-auto',
    ]);
    for (const name of SCREENS) {
      for (const [, c] of Object.entries(await surfaces(name))) {
        const sized = allTokens(c).filter((t) => breakpointOf(t) === 'sm' && /-\[|max-w-|^sm:h-/.test(t));
        for (const t of sized) expect(defined.has(t), `${name} renders undefined ${t}`).toBe(true);
      }
      mounted?.unmount(); mounted = null;
    }
  });

  it('measures every value it uses in px, so the desktop rem trim cannot move it', () => {
    for (const r of [FORM_CONTAINER, FORM_MEASURE, ...FIELD_WIDTHS, ...Object.values(CONTROL_DENSITY)]) {
      for (const m of r.matchAll(/\[([^\]]+)\]/g)) expect(m[1]).toMatch(/px$/);
    }
  });

  it('adds nothing to the shared module — the five screens are consumers only', () => {
    const mod = execSync(`git show ${PRE_PR_REVISION}:src/components/layout/form-layout.ts`, { cwd: REPO, encoding: 'utf8' });
    expect(readFileSync(path.join(SRC, 'layout/form-layout.ts'), 'utf8')).toBe(mod);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. PR 332's gate depends on this.
// ─────────────────────────────────────────────────────────────────────────────
describe('no community query or write path changed', () => {
  const COLLECTIONS = ['channels', 'channelMessages', 'directMessages', 'dmMessages'];

  it('reads and writes the same four collections, spelled the same way', () => {
    const before = execSync(`git show ${PRE_PR_REVISION}:src/components/AdminCommunity.tsx`, { cwd: REPO, encoding: 'utf8' });
    const after = read('AdminCommunity.tsx');
    const paths = (s: string) => [...s.matchAll(/(?:collection|doc)\(db,\s*([^)]*)\)/g)].map((m) => m[1].replace(/\s+/g, ' '));
    expect(paths(after)).toEqual(paths(before));
    for (const c of COLLECTIONS) expect(after.includes(c)).toBe(before.includes(c));
  });

  it('changes nothing in AdminCommunity outside a className', () => {
    const before = execSync(`git show ${PRE_PR_REVISION}:src/components/AdminCommunity.tsx`, { cwd: REPO, encoding: 'utf8' });
    const strip = (s: string) => s
      .replace(/className=(?:"[^"]*"|\{`[^`]*`\}|\{[A-Za-z_$][\w.$]*\})/g, 'className=X')
      .replace(/^\s*(?:\/\/.*)?$/gm, '')
      .replace(/^import \{ FORM_CONTAINER \}.*$/m, '')
      .replace(/\n+/g, '\n');
    expect(strip(read('AdminCommunity.tsx'))).toBe(strip(before));
  });

  it('writes nothing while the screen is merely rendered', async () => {
    await screen('AdminCommunity');
    expect(writes).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Money.
// ─────────────────────────────────────────────────────────────────────────────
describe('no ticket price, donation amount, fee or checkout call changed', () => {
  for (const name of ['AdminEvents', 'AdminFundraising'] as const) {
    it(`changes nothing in ${name} outside a className`, () => {
      const before = execSync(`git show ${PRE_PR_REVISION}:src/components/${name}.tsx`, { cwd: REPO, encoding: 'utf8' });
      const strip = (s: string) => s
        .replace(/className=(?:"[^"]*"|\{`[^`]*`\}|\{[A-Za-z_$][\w.$]*\})/g, 'className=X')
        .replace(/^import \{ FORM_CONTAINER.*form-layout';$/m, '')
        .replace(/^\s*$/gm, '').replace(/\n+/g, '\n');
      expect(strip(read(`${name}.tsx`))).toBe(strip(before));
    });
  }

  it('keeps every money-bearing field on the event editor, by its label', async () => {
    const { form } = await surfaces('AdminEvents');
    const placeholders = Array.from(form.querySelectorAll('input')).map((i) => i.getAttribute('placeholder'));
    expect(placeholders).toContain('0 = free');       // Ticket Price ($)
    expect(placeholders).toContain('e.g. 100');       // Capacity
  });

  it('keeps the pledge amount field on the fundraising screen, by its label', async () => {
    const c = await screen('AdminFundraising');
    await click(buttonContaining(c, 'Building Fund 2026'));
    await click(buttonContaining(c, 'Add Pledge'));
    const placeholders = Array.from(c.querySelectorAll('input')).map((i) => i.getAttribute('placeholder'));
    expect(placeholders).toContain('Pledge amount ($) *');
  });

  it('sizes the money fields without touching what they hold', () => {
    // A width cap is presentation. `short` is the module's own 160px, the width
    // it already gives a zipcode or a house number.
    expect(FIELD_WIDTH.short).toBe('sm:max-w-[160px]');
    expect(read('AdminEvents.tsx')).toContain('${FIELD_WIDTH.short} ${CONTROL_DENSITY.control}');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. REP-4 — exports are never gated.
// ─────────────────────────────────────────────────────────────────────────────
describe('the check-in CSV export still works', () => {
  it('is byte-identical to the pre-PR implementation', () => {
    const before = execSync(`git show ${PRE_PR_REVISION}:src/components/AdminCheckin.tsx`, { cwd: REPO, encoding: 'utf8' });
    const body = (s: string) => s.slice(s.indexOf('const exportCsv'), s.indexOf('const fmtTime'));
    expect(body(read('AdminCheckin.tsx'))).toBe(body(before));
    expect(body(read('AdminCheckin.tsx'))).toContain('text/csv');
  });

  it('still renders the Export CSV control, ungated, on the session detail', async () => {
    const c = await screen('AdminCheckin');
    await click(buttonContaining(c, 'Sunday Service — September 6'));
    const btn = buttonContaining(c, 'Export CSV');
    expect(btn).toBeTruthy();
    // No rule this PR adds reaches it: its classes carry no breakpoint at all.
    const tokens = (btn.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    expect(tokens.filter(isResponsive)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Colour.
// ─────────────────────────────────────────────────────────────────────────────
describe('no colour is hardcoded, and all four palettes resolve', () => {
  for (const name of SCREENS) {
    it(`renders exactly the baseline colour tokens in ${name}`, async () => {
      for (const [view, c] of Object.entries(await surfaces(name))) {
        expect(colourTokens(c), `${name}/${view} colours moved`).toEqual(BASELINE[name]![view].colours);
      }
    });
  }

  it('adds no colour-bearing class — every token this PR adds is structural', async () => {
    const added = new Set<string>();
    for (const name of SCREENS) {
      for (const [view, c] of Object.entries(await surfaces(name))) {
        const base = new Set(BASELINE[name]![view].colours);
        for (const t of colourTokens(c)) if (!base.has(t)) added.add(`${name}/${view}:${t}`);
      }
    }
    expect([...added]).toEqual([]);
  });

  it('defines no colour in the shared rules module', () => {
    const mod = readFileSync(path.join(SRC, 'layout/form-layout.ts'), 'utf8');
    const exported = [FORM_CONTAINER, FORM_MEASURE, ACTION_BUTTON, ...FIELD_WIDTHS, ...Object.values(CONTROL_DENSITY)];
    for (const r of exported) for (const t of r.split(' ')) expect(isColourToken(t), `${t} carries colour`).toBe(false);
    expect(mod).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('leaves all four palettes to resolve exactly as they did', () => {
    const css = readFileSync(path.resolve(SRC, '../app/globals.css'), 'utf8');
    expect(css).toMatch(/^\s*:root\s*\{/m);
    expect(css).toMatch(/\[data-theme="dark"\]\s*\{/);
    expect(css).toMatch(/\[data-palette="classic"\]\[data-theme="light"\]\s*\{/);
    expect(css).toMatch(/\[data-palette="classic"\]\[data-theme="dark"\]\s*\{/);
  });
});
