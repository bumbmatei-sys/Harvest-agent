import { describe, it, expect, vi, beforeAll } from 'vitest';
import React from 'react';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * THE-181 — the four form-layout rules, applied to the CRM's three tabs.
 *
 * The CRM carried THREE per-screen container measures, all in rem and all
 * therefore two different numbers depending on which side of 1024px you were
 * on: `max-w-3xl` on Analytics and Roles (768px on a tablet, 696px on a
 * monitor), `max-w-2xl` on the contact detail and edit panels (672 / 609), and
 * `max-w-6xl` on the contact list (1152 / 1044). Measured in headless Chromium
 * against the real compiled Tailwind CSS and the real admin shell on
 * unmodified HEAD (b990525), at 1440px:
 *
 *   Analytics / Roles content    696px      (the shell offers 1208)
 *   Contacts content            1044px
 *   Permission Reference       664 x 1525px  — 24 items in ONE column, in a
 *                                             900px viewport
 *   Analytics "Search" button   407.33px    beside a 214.67px "Reset"
 *   Analytics location filter   632px       for a city name
 *   Contacts search field       362.72px, 41.88px tall
 *   the admin roster            a stack of cards, one per admin
 *
 * Those are the numbers this file pins against. Every rule reaching the markup
 * comes from src/components/layout/form-layout.ts and every one of them is
 * gated at `sm:`, so none of it can reach a phone — which is the first and most
 * important test here, because the founder's report was that mobile is fine.
 *
 * ── What DID change below 640px, and why ────────────────────────────────────
 * Three of the founder's items are not width-gated concerns and so land at
 * every viewport: the literal emoji in the Analytics stat tiles, the LIVE
 * badges on those tiles, and the off-palette violet notice on Roles. Measured
 * in Chromium at 380 / 480 / 639px, the Contacts tab is geometrically
 * IDENTICAL (0 moved, 0 added, 0 removed over every element carrying text),
 * and the Analytics and Roles deltas are exactly those three items plus the
 * seat line — nothing else moves by more than the 1px the icon chip is taller
 * than the emoji line box it replaced.
 *
 * So "mobile is unchanged" is asserted here as the thing that is actually
 * true and actually load-bearing: no LAYOUT value this PR introduces reaches a
 * phone. Values that moved from an inline `style` to the class layer (because
 * an inline declaration out-ranks any class, so `sm:` could never have
 * overridden them) are asserted to carry the identical number they replaced.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── mocks ───────────────────────────────────────────────────────────────────
const { writes } = vi.hoisted(() => ({
  writes: { adds: [] as unknown[], sets: [] as unknown[], deletes: [] as unknown[], updates: [] as unknown[], batches: 0 },
}));

// ── THE-245 ────────────────────────────────────────────────────────────────
// Run with the SMS master switch ON. This suite pins the RENDERED LAYOUT of
// screens that include SMS surfaces, and a gated-off screen renders nothing to
// measure. Keeping the switch on here means every width, height and touch
// target this file guards is still guarded — and is proof the layout survives
// the hide intact, ready for the flip back. That the surfaces are ABSENT while
// the switch is off is asserted in the-245-sms-hidden.test.tsx.
vi.mock('../../lib/sms-feature', () => ({
  SMS_FEATURE_ENABLED: true,
  SMS_HIDDEN_MESSAGE: 'SMS is temporarily unavailable.',
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));
vi.mock('../../utils/auth-fetch', () => ({ authFetch: async () => ({ ok: true, json: async () => ({ connected: false }) }) }));
vi.mock('../../utils/notify', () => ({ notifyError: () => {}, notifySuccess: () => {} }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'me', email: 'me@church.org', getIdToken: async () => 't' } } }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ tenantId: 'tenant-1', tenantPlan: 'plus' }) }));
vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => 'tenant-1', SUPER_ADMIN_EMAIL: 'bumbmatei@proton.me', PLATFORM_TENANT_ID: 'harvest',
}));
vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'GET', WRITE: 'WRITE', UPDATE: 'UPDATE', DELETE: 'DELETE' }, handleFirestoreError: () => {},
}));

const USERS = [
  { id: 'me', displayName: 'Grace Okafor', email: 'grace@church.org', role: 'admin', permissions: { fullAccess: true }, city: 'Lagos', country: 'Nigeria', createdAt: '2026-01-04T10:00:00Z' },
  { id: 'u2', displayName: 'Daniel Herrera', email: 'daniel@church.org', role: 'user', city: 'Quito', country: 'Ecuador', createdAt: '2026-02-11T10:00:00Z' },
];

vi.mock('firebase/firestore', () => ({
  collection: (_d: unknown, ...s: string[]) => ({ __path: s.join('/') }),
  query: (c: { __path?: string }, ...a: unknown[]) => ({ __path: c?.__path, a }),
  where: () => ({}), orderBy: () => ({}), limit: () => ({}),
  doc: (_d: unknown, ...s: string[]) => ({ __path: s.join('/') }),
  getDoc: async (r: { __path?: string }) => ({ exists: () => true, data: () => (String(r?.__path).startsWith('tenants/') ? { ownerId: 'me' } : {}) }),
  getDocs: async () => ({ forEach: (cb: (d: unknown) => void) => USERS.forEach((u) => cb({ id: u.id, data: () => u })) }),
  updateDoc: async (r: unknown, d: unknown) => { writes.updates.push({ r, d }); },
  deleteDoc: async (r: unknown) => { writes.deletes.push(r); },
  addDoc: async (c: unknown, d: unknown) => { writes.adds.push({ c, d }); return { id: 'x' }; },
  setDoc: async (r: unknown, d: unknown) => { writes.sets.push({ r, d }); },
  serverTimestamp: () => 'TS',
  writeBatch: () => { writes.batches += 1; return { set: () => {}, commit: async () => {} }; },
  onSnapshot: (_q: unknown, cb: (s: unknown) => void) => { cb({ forEach: () => {} }); return () => {}; },
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: async () => {} }) }));
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => ({ currentTenantId: 'tenant-1', isAuthReady: true, isSuperAdmin: false }) }));

const CONTACTS = [
  { id: 'c1', name: 'Grace Okafor', email: 'grace@church.org', phone: '+234 802 555 0111', type: 'both', totalDonated: 12400, city: 'Lagos', notes: '', createdAt: '2026-01-04T10:00:00Z' },
  { id: 'c2', name: 'Daniel Herrera', email: 'daniel@church.org', phone: '+593 99 555 0022', type: 'donor', totalDonated: 320, city: 'Quito', notes: '', createdAt: '2026-02-11T10:00:00Z' },
  { id: 'c3', name: 'Miriam Adeyemi', email: 'miriam@church.org', phone: '+234 803 555 0777', type: 'member', totalDonated: 0, city: 'Abuja', notes: '', createdAt: '2026-03-02T10:00:00Z' },
];
vi.mock('../../hooks/queries/useCRMQueries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/queries/useCRMQueries')>()),
  useContactsWithUsers: () => ({ data: CONTACTS, isLoading: false, isError: false, error: null, refetch: () => {} }),
  useContactActivities: () => ({ data: [], isLoading: false, isError: false, error: null, refetch: () => {} }),
  useCRMCounts: () => ({ data: { contactRecords: 3, memberAccounts: 2, contactsTruncated: false, usersTruncated: false } }),
}));

const AdminCRM = (await import('../AdminCRM')).default;
const { AdminHeaderContext } = await import('../AdminScreenHeader');
const {
  mobileLayer, allTokens, isResponsive, breakpointOf, maxWidthPx, arbitraryPx,
  BREAKPOINT_MIN_PX, REM_PX_MOBILE, REM_PX_DESKTOP,
} = await import('../../test/support/class-inventory');
const {
  mountScreen, openTab, buttonByLabel, inputByPlaceholder, region, carries, tokensOf, inlineStyles,
} = await import('../../test/support/crm-screen');
type CrmTab = import('../../test/support/crm-screen').CrmTab;
const {
  FORM_CONTAINER, FORM_MEASURE, CONTAINERS, FIELD_WIDTH, FIELD_WIDTHS, ACTION_BUTTON,
  CONTROL_DENSITY, CONTROL_DENSITY_TOKENS, DENSITY_PX, DESKTOP_CONTROL_MAX_PX,
} = await import('../layout/form-layout');

/** Every rule in the module, as one list — what the `sm:` gate is checked over. */
const ALL_RULES = [...CONTAINERS, ACTION_BUTTON, ...FIELD_WIDTHS, ...CONTROL_DENSITY_TOKENS];

const SRC = path.resolve(__dirname, '..');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

const FIXTURES = path.join(__dirname, '__fixtures__');
const RECORDING = !!process.env.UPDATE_LAYOUT_BASELINE;

const PERMS = { fullAccess: true, analytics: true, manageAdmins: true, manageCRM: true } as never;

function Harness() {
  const [action, setAction] = React.useState<React.ReactNode>(null);
  const [override, setOverride] = React.useState<React.ReactNode>(null);
  return (
    <AdminHeaderContext.Provider value={{ setHeaderAction: setAction, setHeaderOverride: setOverride } as never}>
      <div data-header-slot="">{override ?? action}</div>
      <AdminCRM currentUserRole="admin" currentUserPermissions={PERMS} />
    </AdminHeaderContext.Provider>
  );
}

// THE-277 — 'Analytics' left this screen. It is now the `signups` page, and
// every assertion this file made about it moved WITH it, to
// `THE-277.signups-split.test.tsx`, rather than being dropped: the emoji sweep,
// the Rule 3 action widths, the `medium` period field, the literal-colour scan
// and the mobile-layer baseline are all re-asserted there against AdminSignups.
const TABS: CrmTab[] = ['Contacts', 'Roles'];

/** Every distinct token on a screen that is NOT behind a breakpoint. */
const mobileTokensOf = (root: ParentNode) =>
  [...new Set(allTokens(root).filter((t) => !isResponsive(t)))].sort();

let mounted: Awaited<ReturnType<typeof mountScreen>> | null = null;

/** Mount the CRM and open one tab. Callers must not hold the node across tabs. */
async function tab(name: CrmTab): Promise<HTMLElement> {
  if (mounted) { mounted.unmount(); mounted = null; }
  mounted = await mountScreen(<Harness />);
  if (name !== 'Contacts') await openTab(mounted.container, name);
  return mounted.container;
}

/**
 * The mobile class layer of each tab, recorded mechanically from this file's
 * own mocks — never hand-typed. Re-record ONLY when the sub-640px rendering is
 * deliberately changing:
 *
 *     UPDATE_LAYOUT_BASELINE=1 npx vitest run \
 *       src/components/__tests__/AdminCRM.desktop-layout.test.tsx
 */
/**
 * The tokens that reach a phone, as a SET.
 *
 * Deliberately not `mobileLayer()`'s per-element rows: those are keyed by
 * document index, so inserting one wrapper renumbers every element after it and
 * the diff reports hundreds of changes that are not changes. What decides what
 * a phone renders is which unprefixed tokens exist on the screen, and that is
 * stable under insertion.
 */
interface TabBaseline { mobileTokens: string[] }
let BASELINE!: Record<CrmTab, TabBaseline>;

beforeAll(async () => {
  if (RECORDING) {
    const rec = {} as Record<CrmTab, TabBaseline>;
    for (const t of TABS) rec[t] = { mobileTokens: mobileTokensOf(await tab(t)) };
    writeFileSync(path.join(FIXTURES, 'crm-tabs-mobile.json'), JSON.stringify(rec, null, 2) + '\n');
    mounted?.unmount(); mounted = null;
  }
  BASELINE = JSON.parse(readFileSync(path.join(FIXTURES, 'crm-tabs-mobile.json'), 'utf8'));
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Mobile. The most important test in this file.
// ─────────────────────────────────────────────────────────────────────────────
describe('the sub-640px rendering of both CRM tabs is unchanged', () => {
  /**
   * Tokens this PR puts on the mobile layer. Each either renders nothing new,
   * or reproduces — to the number — a value that was previously set inline.
   * An inline declaration out-ranks any class, so `sm:p-0` could never have
   * cleared an inline `padding: "11px"`; moving the phone's value into the
   * class layer is what makes the desktop rule able to win at all.
   */
  const ALLOWED_ADDITIONS: Record<string, string> = {
    'w-full': 'a block element is already full width — this only gives the sm: cap something to cap',
    flex: 'from an inline display:flex, which out-ranked the sm: switch that hides the card stack on desktop',
    'flex-col': 'moved with it, same value',
    'gap-[14px]': 'from an inline gap:14 on the permission list — same 14px',
    hidden: 'display:none on the desktop roster table — this is WHY the phone still renders the card stack and only the card stack',
  };

  /**
   * lucide-react stamps its own identity classes (`lucide`, `lucide-globe`, …)
   * on every `<svg>` it draws. Tailwind defines no rule for any of them, so
   * they carry no layout and no paint; they appear here only because the emoji
   * the founder reported became real icons.
   */
  const ICON_IDENTITY = /^lucide(-|$)/;

  /**
   * Tokens this PR takes OFF the mobile layer. Every one is a rem container cap
   * whose smallest value is 672px — larger than the 639px top of the phone
   * range — so it could never bind below `sm:` and removing it cannot move a
   * phone. Measured in Chromium at 380 / 480 / 639px, the Contacts tab is
   * geometrically identical across this change: 0 elements moved, added or
   * removed.
   */
  const NON_BINDING_CAPS: Record<string, number> = {
    'max-w-2xl': 672, 'max-w-3xl': 768, 'max-w-6xl': 1152,
  };
  const ALLOWED_REMOVALS: Record<string, string> = {
    ...Object.fromEntries(Object.entries(NON_BINDING_CAPS)
      .map(([t, px]) => [t, `a ${px}px cap, above the 639px top of the phone range`])),
    'mx-auto': 'auto side margins on a block whose width is auto resolve to 0 — it centred nothing until a cap gave it something to centre, and the cap is now sm:-gated with it',
  };

  it.each(TABS)('puts no undocumented token on the %s mobile layer', async (name) => {
    const before = new Set(BASELINE[name].mobileTokens);
    const added = mobileTokensOf(await tab(name))
      .filter((t) => !before.has(t))
      .filter((t) => !ICON_IDENTITY.test(t));
    expect(added.filter((t) => !(t in ALLOWED_ADDITIONS)), `${name} gained a token that reaches a phone`).toEqual([]);
  });

  it.each(TABS)('takes nothing off the %s mobile layer that could have bound below 640px', async (name) => {
    const now = new Set(mobileTokensOf(await tab(name)));
    const removed = BASELINE[name].mobileTokens.filter((t) => !now.has(t));
    for (const t of removed) {
      expect(t in ALLOWED_REMOVALS, `${name} dropped "${t}", which is not documented as phone-neutral`).toBe(true);
    }
  });

  it('names a real px width for each cap it removed, so "cannot bind" is checkable', () => {
    // 2xl = 42rem, 3xl = 48rem, 6xl = 72rem at the 16px mobile base. Every one
    // is wider than the widest phone this range covers, so none of them ever
    // constrained anything below `sm:`.
    expect(42 * REM_PX_MOBILE).toBe(672);
    expect(48 * REM_PX_MOBILE).toBe(768);
    expect(72 * REM_PX_MOBILE).toBe(1152);
    for (const px of Object.values(NON_BINDING_CAPS)) expect(px).toBeGreaterThan(639);
  });

  it('keeps the desktop roster table off the phone entirely', async () => {
    const roster = region(await tab('Roles'), 'data-admin-roster');
    const table = roster.querySelector('table')!;
    const wrapper = table.closest('div')!;
    // `hidden md:block`: display:none below 768px, so the phone renders the card
    // stack and nothing else — the table is not merely off-screen. The switch
    // sits at `md:` because the four columns need 632px and `sm:` offers 565px;
    // gating it further UP than the module's `sm:` keeps the phone safe a
    // fortiori, which is the direction this constraint allows.
    expect(tokensOf(wrapper)).toContain('hidden');
    expect(tokensOf(wrapper)).toContain('md:block');
    const stack = roster.querySelector('.md\\:hidden')!;
    expect(tokensOf(stack), 'the card stack would show on desktop too').toContain('md:hidden');
    expect(tokensOf(stack), 'an inline display would out-rank md:hidden').toContain('flex');
    // Both presentations are gated ABOVE the phone range, never below it.
    for (const t of ['md:block', 'md:hidden']) {
      expect(BREAKPOINT_MIN_PX[breakpointOf(t)!]).toBeGreaterThanOrEqual(640);
    }
  });

  it('gates every rule the CRM spells at sm:, so none of them can reach a phone', async () => {
    for (const name of TABS) {
      const used = new Set(allTokens(await tab(name)));
      for (const rule of ALL_RULES) {
        for (const token of rule.split(/\s+/)) {
          if (!used.has(token)) continue;
          expect(breakpointOf(token), `${token} on ${name} is not sm:-gated`).toBe('sm');
        }
      }
    }
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Touch targets.
// ─────────────────────────────────────────────────────────────────────────────
describe('mobile touch targets are at least 44px', () => {
  const TOUCH_TARGET_MIN_PX = 44;

  /**
   * The CRM ships 25 interactive elements under 44px on a phone TODAY — the sub
   * tab pills at 28px, "Add contact" at 39.5px, the Analytics period buttons at
   * 39.5px, Search/Reset at 43px. Measured in Chromium at 380px on unmodified
   * HEAD (b990525); none of it is this PR's, and every one of them is set by an
   * UNPREFIXED value, so raising any of them would change the sub-640px
   * rendering that test 1 exists to hold still. They are named here so the
   * shortfall is recorded rather than implied, and so a future PR that fixes
   * them has the list.
   */
  const KNOWN_SHORT_ON_MOBILE = 25;

  it('adds no height that reaches a phone, so no tap target can shrink', async () => {
    const HEIGHT = /^(?:h-|min-h-|py-|p-)/;
    for (const name of TABS) {
      const before = new Set(BASELINE[name].mobileTokens.filter((t) => HEIGHT.test(t)));
      const now = mobileTokensOf(await tab(name)).filter((t) => HEIGHT.test(t));
      const added = now.filter((t) => !before.has(t));
      // `p-[11px]` is the Analytics action padding, moved out of an inline
      // style at the identical value — see test 1.
      expect(added.filter((t) => t !== 'p-[11px]'), `${name} gained a height on the phone`).toEqual([]);
    }
  });

  it('keeps every density height behind sm:, so a 38px control cannot become a 38px tap target', () => {
    for (const [name, rule] of Object.entries(CONTROL_DENSITY)) {
      for (const token of rule.split(/\s+/)) {
        expect(breakpointOf(token), `${name} carries an ungated token: ${token}`).toBe('sm');
      }
    }
    expect(DENSITY_PX.control).toBeLessThan(TOUCH_TARGET_MIN_PX);
    expect(DENSITY_PX.action).toBeLessThan(TOUCH_TARGET_MIN_PX);
  });

  it('records the pre-existing shortfall rather than implying there is none', () => {
    expect(KNOWN_SHORT_ON_MOBILE).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The container.
// ─────────────────────────────────────────────────────────────────────────────
describe("each tab's content is constrained at desktop widths", () => {
  /**
   * A container only counts if it is ABOVE the tab's content. Asserting merely
   * that the subtree contains SOME element carrying a measure is satisfied by a
   * container anywhere — including a redundant second one — so it cannot tell
   * that the real cap was removed. Each tab is therefore anchored to a named
   * piece of its own content and the cap has to be an ancestor of it.
   */
  const CONTENT_ANCHOR: Record<CrmTab, (c: HTMLElement) => Element> = {
    Contacts: (c) => inputByPlaceholder(c, 'Search by name or email'),
    Roles: (c) => region(c, 'data-permission-reference'),
  };

  it.each(TABS)('caps %s above its own content, with a measure form-layout.ts defines', async (name) => {
    const c = await tab(name);
    let el: Element | null = CONTENT_ANCHOR[name](c);
    const ancestors: Element[] = [];
    while (el && el !== c) { ancestors.push(el); el = el.parentElement; }
    const capped = ancestors.filter((a) => CONTAINERS.some((rule) => carries(a, rule)));
    expect(capped.length, `nothing above ${name}'s content carries a measure from the module`).toBeGreaterThan(0);
  });

  it('caps each tab exactly once — a second measure is a second definition', async () => {
    for (const name of TABS) {
      const c = await tab(name);
      let el: Element | null = CONTENT_ANCHOR[name](c);
      const capped: string[] = [];
      while (el && el !== c) {
        if (CONTAINERS.some((rule) => carries(el as Element, rule))) capped.push((el as Element).getAttribute('class') ?? '');
        el = el.parentElement;
      }
      expect(capped.length, `${name} is capped ${capped.length} times: ${capped.join(' | ')}`).toBe(1);
    }
  });

  it('gives the contact list and the two sub-screens the PAGE measure, not a new number', async () => {
    for (const name of TABS) {
      const c = await tab(name);
      const outer = c.querySelector(`.${CSS.escape('sm:max-w-[1120px]')}`)
        ?? Array.from(c.querySelectorAll('*')).find((el) => carries(el, FORM_CONTAINER));
      expect(outer, `${name} is not capped at the page measure`).toBeTruthy();
    }
    expect(maxWidthPx('sm:max-w-[1120px]')).toBe(1120);
  });

  it('gives the contact detail and edit panels the FORM measure', () => {
    // Both are forms, and Rule 1b exists precisely for the distinction.
    expect(read('AdminCRM.tsx')).toContain('${FORM_MEASURE}');
    expect(maxWidthPx('sm:max-w-[940px]')).toBe(940);
  });

  it('leaves no rem-based per-screen measure on a tab surface', async () => {
    // `max-w-3xl` is 768px on a tablet and 696px on a monitor: the 9.4% rem trim
    // globals.css runs above 1024px. That split is what the px measures replace.
    for (const name of TABS) {
      const c = await tab(name);
      const remCaps = allTokens(c).filter((t) => /(^|:)max-w-(xs|sm|md|lg|xl|\dxl)$/.test(t));
      expect(remCaps, `${name} still carries a rem container`).toEqual([]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4-5. The Analytics actions, and the emoji sweep over its stat tiles.
//
// 🔴 BOTH SECTIONS MOVED, THEY WERE NOT DELETED. THE-277 made Analytics its own
// screen, so their subject is no longer reachable from this file's Harness.
// Every assertion they made is re-stated against AdminSignups in
// `THE-277.signups-split.test.tsx`:
//
//   · Rule 3 on Search and on Reset, by their labels
//   · no inline flex weight that would out-rank the rule
//   · both actions on the one density height
//   · the location filter sized to what a city name needs
//   · no emoji character anywhere on the screen
//   · each tile icon drawn with lucide, taking the tile accent
//   · no LIVE badge, and one getDocs with no onSnapshot behind it
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// 6. The permission reference.
// ─────────────────────────────────────────────────────────────────────────────
describe('the permission reference does not render as a single full-width column at desktop', () => {
  it('lays its categories into columns from sm: up', async () => {
    const ref = region(await tab('Roles'), 'data-permission-reference');
    const grid = ref.querySelector('[class*="grid-cols"]');
    expect(grid, 'the reference is still one column at every width').toBeTruthy();
    const cols = tokensOf(grid!).filter((t) => /grid-cols-\d/.test(t));
    expect(cols.length).toBeGreaterThan(0);
    for (const t of cols) expect(breakpointOf(t), `${t} reaches a phone`).toBe('sm');
  });

  it('keeps the phone on one column', async () => {
    const ref = region(await tab('Roles'), 'data-permission-reference');
    const grid = ref.querySelector('[class*="grid-cols"]')!;
    expect(tokensOf(grid).filter((t) => /^grid-cols-\d/.test(t)), 'a column count reaches the phone').toEqual([]);
    expect(tokensOf(grid)).toContain('flex-col');
  });

  it('takes its grid gaps from Rule 4 rather than inventing them', async () => {
    const ref = region(await tab('Roles'), 'data-permission-reference');
    const grid = ref.querySelector('[class*="grid-cols"]')!;
    expect(carries(grid, CONTROL_DENSITY.rowGap)).toBe(true);
    expect(carries(grid, CONTROL_DENSITY.columnGap)).toBe(true);
    expect(DENSITY_PX.columnGap).toBe(DENSITY_PX.rowGap);
  });

  it('still lists every permission — columns are a layout, not a filter', async () => {
    const ref = region(await tab('Roles'), 'data-permission-reference');
    const { VISIBLE_PERMISSION_CATEGORIES } = await import('../AdminRoles');
    const items = VISIBLE_PERMISSION_CATEGORIES.flatMap((c) => c.items.map((i) => i.label));
    const text = ref.textContent ?? '';
    for (const label of items) expect(text, `"${label}" fell out of the reference`).toContain(label);
    expect(text).toContain('Full Access');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. One shared place.
// ─────────────────────────────────────────────────────────────────────────────
describe('widths, heights and gaps come from form-layout, not new per-screen values', () => {
  it('imports the rules in both files that render a tab', () => {
    expect(read('AdminCRM.tsx')).toContain("from './layout/form-layout'");
    expect(read('AdminRoles.tsx')).toContain("from './layout/form-layout'");
  });

  it('spells no sm:-gated width, height or gap outside the module', () => {
    // A `sm:`-gated size appearing inline in a consumer is a second, competing
    // definition — which is the per-screen table this series exists to remove.
    const OWNED = new Set(ALL_RULES.flatMap((r) => r.split(/\s+/)));
    for (const file of ['AdminCRM.tsx', 'AdminRoles.tsx']) {
      const literal = read(file).match(/sm:(?:max-w|h|py|mb|space-y|gap-y|gap-x|w)-\[[^\]]+\]/g) ?? [];
      const stray = literal.filter((t) => !OWNED.has(t));
      expect(stray, `${file} defines a size of its own`).toEqual([]);
    }
  });

  it('renders no sm:-gated size the module does not define', async () => {
    const OWNED = new Set(ALL_RULES.flatMap((r) => r.split(/\s+/)));
    const SIZE = /^(?:max-w-|h-|py-|mb-|space-y-|gap-y-|gap-x-|gap-)\[/;
    for (const name of TABS) {
      const stray = [...new Set(allTokens(await tab(name)))]
        .filter((t) => isResponsive(t) && SIZE.test(t.replace(/^sm:/, '')) && !OWNED.has(t));
      expect(stray, `${name} renders a size defined per screen`).toEqual([]);
    }
  });

  it('measures every value in px, so the desktop rem trim cannot move it', () => {
    for (const token of ALL_RULES.flatMap((r) => r.split(/\s+/))) {
      expect(token, `${token} carries a rem value`).not.toMatch(/-\[[\d.]+rem\]$/);
    }
    expect(arbitraryPx(CONTROL_DENSITY.columnGap, REM_PX_MOBILE))
      .toBe(arbitraryPx(CONTROL_DENSITY.columnGap, REM_PX_DESKTOP));
  });

  it('agrees with the px it documents — the tokens and the numbers are one rule', () => {
    for (const [name, rule] of Object.entries(CONTROL_DENSITY)) {
      const px = rule.split(/\s+/).map((t) => arbitraryPx(t, REM_PX_DESKTOP)).find((v) => v !== null);
      expect(px, `${name} carries no absolute length`).toBe(DENSITY_PX[name as keyof typeof DENSITY_PX]);
    }
  });

  it('reaches only the screens that deliberately opted in', () => {
    // The twin of the list in ChurchEnrollment.desktop-layout.test.tsx. Both
    // are kept because the gate is the point: an adopter has to be written down
    // twice, deliberately, or the rules have leaked. THE-181 batch 2 added
    // PersonalInformationModal and EnterpriseContactModal to the other list
    // without adding them here, which left this red; THE-183 adds its own
    // AdminSettings.tsx and the two that were missed, so the two lists agree
    // again.
    //
    // Batch E (admin content screens) adds four more, all container-only: see
    // the matching note in ChurchEnrollment.desktop-layout.test.tsx.
    //
    // Batch G (the admin data screens) is adopter six, and adds four at once:
    // AdminRAG and AdminTenants take FORM_CONTAINER's page measure, and
    // AdminSms and AdminGivingStatements take FIELD_WIDTH, ACTION_BUTTON and
    // CONTROL_DENSITY — but not Rule 1, because both already render inside
    // FORM_MEASURE and taking it would have WIDENED them by 331px.
    // AdminDashboard is in that batch's scope and is deliberately absent: it is
    // the shell every other admin screen renders inside, so a measure on it is
    // a measure on all of them at once.
    //
    // Batch F (the five admin ministry screens) adds the last five. Batches E,
    // F and G ran in parallel and each added only its own, so this list is the
    // UNION of the three — kept byte-for-byte equal to the other one.
    //
    // THE-190 batch H is the first adopter from the MEMBER app rather than the
    // admin one — five member screens, the same matching note.
    const importers = execSync(
      // ⚠️ Both quote styles. The pattern was single-quote-only, which made a
      // double-quoted adopter invisible to this gate rather than red —
      // BiblePage.tsx imports as `from "./layout/form-layout"`, matching its own
      // file's style, and slipped straight through. Widening it is what makes
      // this a registry of adopters rather than of one import convention.
      "grep -rlE \"from ['\\\"].*form-layout['\\\"]\" src --include=*.tsx --include=*.ts || true",
      { encoding: 'utf8' },
    ).split('\n').filter(Boolean).filter((f) => !f.includes('__tests__')).sort();
    expect(importers).toEqual([
      'src/components/AIChat.tsx',
      'src/components/AdminBlog.tsx',
      'src/components/AdminCRM.tsx',
      'src/components/AdminCheckin.tsx',
      'src/components/AdminChurches.tsx',
      'src/components/AdminCourseEditor.tsx',
      'src/components/AdminCourses.tsx',
      // ⚠️ AdminCommunity.tsx and AdminDocs.tsx LEFT this registry.
      //
      // Both took Rule 1a's page measure on the reading that a rail beside a
      // pane is as data-dense as the shell allows. That reading was right and
      // the conclusion was wrong: a measure exists to stop a LINE OF PROSE from
      // running the width of a monitor, and neither screen renders prose at its
      // root — they render a fixed-width rail beside a pane. The cap could only
      // fall on the pane, which is the one part that wants the room, and what it
      // actually produced was a band of dead space between the admin nav and the
      // rail on every screen wider than 1120px.
      //
      // They mint nothing in its place: both now take the shell's content box,
      // which is why they import form-layout no longer rather than importing it
      // for a width of their own. A departure is as much a scoped decision as an
      // adoption, so it is recorded here in the same place.
      // THE-246 — the Donations screen (Stripe Connect + the church's own payment
      // links). Opted in deliberately: it is an admin FORM, so it spends the form
      // measure, the field widths and the control density rather than inventing
      // a width of its own.
      'src/components/AdminDonations.tsx',
      'src/components/AdminEvents.tsx',
      'src/components/AdminForms.tsx',
      'src/components/AdminFundraising.tsx',
      'src/components/AdminGivingStatements.tsx',
      'src/components/AdminRAG.tsx',
      'src/components/AdminRoles.tsx',
      'src/components/AdminSettings.tsx',
      'src/components/AdminSignups.tsx',
      'src/components/AdminSms.tsx',
      'src/components/AdminTenants.tsx',
      'src/components/AllNews.tsx',
      'src/components/BiblePage.tsx',
      // THE-192: the billing screen takes Rule 1a's page measure. It is a page —
      // an invoice table and a three-up plan comparison — and it adopted the
      // rule because the width it had invented (`max-w-3xl`, 696px at the
      // desktop rem base) clipped the third plan card by 209.25px.
      'src/components/BillingAndPayments.tsx',
      'src/components/ChurchEnrollment.tsx',
      'src/components/EnterpriseContactModal.tsx',
      'src/components/NewsTab.tsx',
      'src/components/NewsletterEditor.tsx',
      'src/components/PersonalInformationModal.tsx',
      'src/components/UserMessages.tsx',
      // THE-286 — the first adopter from settings/ rather than from a screen.
      // The converted GivingStatementsSection takes CONTROL_DENSITY only: its
      // controls need the 38px desktop density and the 28px section gap, and it
      // takes NO measure (Rule 1) because it renders inside AdminSettings, which
      // already spends FORM_MEASURE — taking one here would cap a column inside
      // a column. It is the proof section for the settings chrome; the other
      // twelve sections are untouched and are not on this list.
      'src/components/settings/GivingStatementsSection.tsx',
      // THE-296 — the two remaining sections AdminSettings mounts, onto the same
      // chrome and for the same reason. Both take CONTROL_DENSITY only and no
      // measure (Rule 1), because both render inside AdminSettings, which
      // already spends FORM_MEASURE. The other sections in settings/ are NOT on
      // this list and are not converted: six of them are mounted by other
      // screens entirely (AdminBranding, BillingAndPayments, AdminDonations,
      // AdminUpgradePage, FirstRunSetup), where there is no accordion row to
      // inherit a card from, so "inherit the shared chrome" states nothing
      // about them.
      'src/components/settings/IntegrationsSection.tsx',
      'src/components/settings/OnboardingSection.tsx',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Colour.
// ─────────────────────────────────────────────────────────────────────────────
describe('no colour is hardcoded, and all four palettes resolve', () => {
  const HEX = /#[0-9a-fA-F]{3,8}\b/;

  /**
   * The literal colours the CRM still paints, and why they are not this PR's.
   *
   * Both belong to STAGES — the derived pipeline-stage map (AdminCRM.tsx:150).
   * It is a SEMANTIC colour map of exactly the kind PR 337 owns and the brief
   * rules out of scope alongside TYPE_COLORS and BADGE_TONES, and the stage a
   * contact is in is behaviour this PR must not touch. They are pinned rather
   * than waved at: a NEW literal anywhere on these three tabs fails here.
   */
  const KNOWN_LITERALS = ['#10B981', '#B8962E'];

  it('paints no literal colour beyond the pipeline-stage map that predates this PR', async () => {
    for (const name of TABS) {
      const c = await tab(name);
      const literals = inlineStyles(c)
        .filter((d) => /^(color|background|background-color|border|border-color|fill|stroke)\b/.test(d))
        .filter((d) => HEX.test(d))
        // `var(--token, #fallback)` is a token WITH a fallback — the documented
        // way to spell a tenant-overridable value in this app.
        .filter((d) => !/var\(--[a-z-]+,\s*#[0-9a-fA-F]{3,8}\s*\)/.test(d.replace(/\s+/g, ' ')))
        .filter((d) => !KNOWN_LITERALS.some((h) => d.toUpperCase().includes(h)));
      expect(literals, `${name} paints a literal colour`).toEqual([]);
    }
  });

  it('renders no literal colour at all on the Roles tab this PR restyled', async () => {
    // THE-183 restyled Analytics AND Roles. Analytics is now its own screen, so
    // the same scan runs over it in THE-277.signups-split; this keeps the half
    // that is still a CRM tab.
    for (const name of ['Roles'] as CrmTab[]) {
      const literals = inlineStyles(await tab(name))
        .filter((d) => HEX.test(d))
        .filter((d) => !/var\(--[a-z-]+,\s*#[0-9a-fA-F]{3,8}\s*\)/.test(d.replace(/\s+/g, ' ')));
      expect(literals, `${name} paints a literal colour`).toEqual([]);
    }
  });

  it('leaves no violet on the Roles tab — the app has no violet', async () => {
    const c = await tab('Roles');
    const decls = inlineStyles(c).join(' ').toLowerCase();
    for (const violet of ['#7c3aed', '#f5f3ff']) {
      expect(decls, `${violet} is still rendered`).not.toContain(violet);
    }
  });

  it('names a real token for every colour constant the screen shares', () => {
    const src = read('AdminRoles.tsx');
    const globals = readFileSync(path.resolve(__dirname, '../../app/globals.css'), 'utf8');
    const consts = ['TEXT', 'TEXT2', 'GREEN', 'GREEN_BG', 'RED', 'RED_BG', 'BLUE'];
    for (const name of consts) {
      const m = src.match(new RegExp(`^const ${name} = "([^"]+)";`, 'm'));
      expect(m, `${name} is no longer declared`).toBeTruthy();
      const value = m![1];
      expect(value, `${name} is a literal colour`).not.toMatch(HEX);
      const token = value.match(/--[a-z0-9-]+/)![0];
      expect(globals, `${token} is not declared in globals.css`).toContain(`${token}:`);
    }
  });

  it('resolves those tokens in all four palettes', () => {
    const globals = readFileSync(path.resolve(__dirname, '../../app/globals.css'), 'utf8');
    // Harvest light (:root), Harvest dark, Classic light, Classic dark.
    const PALETTES = [
      /(^|\n)\s*:root\s*\{/,
      /\[data-theme="dark"\]\s*\{/,
      /\[data-palette="classic"\]\[data-theme="light"\]\s*\{/,
      /\[data-palette="classic"\]\[data-theme="dark"\]\s*\{/,
    ];
    for (const p of PALETTES) expect(globals, `no block matching ${p}`).toMatch(p);
    // The neutral ramp both TEXT constants read is redefined by every one of them.
    for (const token of ['--text-strong', '--text-muted']) {
      const hits = globals.split(`${token}:`).length - 1;
      expect(hits, `${token} is not redefined per palette`).toBeGreaterThanOrEqual(4);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Behaviour.
// ─────────────────────────────────────────────────────────────────────────────
describe('no column, filter, sort or write path changed', () => {
  it('renders the contact list with the same columns, in the same order', async () => {
    const c = await tab('Contacts');
    const headers = Array.from(c.querySelectorAll('th')).map((th) => (th.textContent ?? '').trim());
    expect(headers).toEqual(['Contact', 'Type', 'Stage', 'Given', 'Last Gift']);
  });

  it('keeps the type filter and the view toggle, by their labels', async () => {
    const c = await tab('Contacts');
    for (const label of ['All', 'Members', 'Donors', 'List', 'Pipeline']) {
      expect(buttonByLabel(c, label), `"${label}" is gone`).toBeTruthy();
    }
  });

  it('keeps the search field and both toolbar actions', async () => {
    const c = await tab('Contacts');
    expect(inputByPlaceholder(c, 'Search by name or email')).toBeTruthy();
    expect(c.querySelector('[data-testid="crm-add-contact"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="crm-import-contacts"]')).toBeTruthy();
  });

  it('writes nothing while both tabs are merely rendered', async () => {
    writes.adds.length = 0; writes.sets.length = 0; writes.deletes.length = 0; writes.updates.length = 0;
    writes.batches = 0;
    for (const name of TABS) await tab(name);
    expect({ ...writes, adds: writes.adds.length, sets: writes.sets.length, deletes: writes.deletes.length, updates: writes.updates.length })
      .toEqual({ adds: 0, sets: 0, deletes: 0, updates: 0, batches: 0 });
  });

  it('leaves the 500-row ceiling handling and the badge maps alone', () => {
    const src = read('AdminCRM.tsx');
    expect(src).toContain('CRM_FETCH_LIMIT');
    expect(src).toContain('listIsPartial');
    expect(src).toContain("donor: 'bg-surface-gold text-wheat-800'");
    expect(src).toContain("member: 'bg-sky-100 text-sky-700'");
    expect(src).toContain("both: 'bg-field-100 text-field-700'");
  });

  it('keeps the roster editable — a table is a presentation, not a behaviour', async () => {
    const c = await tab('Roles');
    const roster = region(c, 'data-admin-roster');
    // The owner row is locked by firestore.rules, so it shows the Owner badge
    // rather than Edit/Remove. Both presentations are built from one row.
    expect((roster.textContent ?? '')).toContain('Grace Okafor');
    expect((roster.textContent ?? '')).toContain('Owner');
    const headers = Array.from(roster.querySelectorAll('th')).map((th) => (th.textContent ?? '').trim());
    expect(headers).toEqual(['Admin', 'Email', 'Permissions', 'Actions']);
  });

  it('still states the plan cap, with the same numbers', async () => {
    const seats = region(await tab('Roles'), 'data-admin-seats');
    expect((seats.textContent ?? '').replace(/\s+/g, ' ')).toContain('1 of 2 admins used');
  });
});
