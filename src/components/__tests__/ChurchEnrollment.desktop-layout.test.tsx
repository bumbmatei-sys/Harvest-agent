import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * Desktop layout rules for the Add Church form — container, field widths, button.
 *
 * The app was responsive to 1024px and then stretched with no maximum. Measured
 * in headless Chromium against the real compiled Tailwind CSS and the real admin
 * shell, a 1824px-wide window rendered the Google Maps field at 1517.5px, the
 * "Church Name" field at 747.88px for a value needing about 300, the zipcode at
 * 491.34px, and the submit button at 1517.5px.
 *
 * Three rules fixed that, and a fourth — desktop control density — fixes the
 * half they could not: they made the form narrower without making it smaller.
 * On the same measurement, at 1440px, every input rendered 45.5px tall where
 * 36-40px is normal desktop density, the submit button 53px, and the whole form
 * 1671.75px long.
 *
 * All four live in ONE place — src/components/layout/form-layout.ts. Every rule
 * there is gated at `sm:` and above, so none of them can reach a phone. That is
 * the constraint the first test in this file exists to enforce, and it is the
 * most important test here: the founder's report was "for mobile, the app is
 * fine", so a diff that moves the sub-640px rendering has failed no matter how
 * good the desktop looks. Rule 4 is the one most able to break it — a height
 * that escapes its `sm:` gate is a touch target shrinking to 38px on a phone,
 * which is why "mobile touch targets" is the second test here and not a
 * footnote.
 *
 * Field lookups go through the visible LABEL, never a `name` attribute and never
 * a class pattern — a test that found the zipcode by matching `max-w-[160px]`
 * would pass no matter which field it landed on.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fx = vi.hoisted(() => ({
  adds: [] as Array<{ path: string; data: any }>,
  /** The Maps widget's real callback, captured so the autofill can be exercised. */
  onPlaceSelected: null as null | ((place: any) => void),
}));

vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => 'tenant-1',
  getWriteTenantScope: async () => 'tenant-1',
  PLATFORM_TENANT_ID: 'harvest',
}));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u', email: 'a@t.com' } } }));
vi.mock('firebase/firestore', () => ({
  collection: (_d: unknown, ...s: string[]) => ({ __path: s.join('/') }),
  doc: (_d: unknown, ...s: string[]) => ({ __path: s.join('/') }),
  query: (...a: any[]) => a,
  where: (...a: any[]) => a,
  orderBy: (...a: any[]) => a,
  limit: (...a: any[]) => a,
  addDoc: async (col: any, data: any) => { fx.adds.push({ path: col?.__path, data }); return { id: 'new-church' }; },
  updateDoc: async () => {},
  deleteDoc: async () => {},
  getDoc: async () => ({ exists: () => true, data: () => ({ tenantId: 'tenant-1' }) }),
  onSnapshot: (_q: unknown, cb: any) => { cb({ forEach: () => {} }); return () => {}; },
}));
vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'GET', WRITE: 'WRITE', UPDATE: 'UPDATE', DELETE: 'DELETE' },
  handleFirestoreError: () => {},
}));
vi.mock('../../utils/auth-fetch', () => ({ authFetch: async () => ({ ok: true, json: async () => ({}) }) }));
vi.mock('../../utils/send-notification', () => ({ sendPushNotification: async () => {} }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ tenantId: 'tenant-1', tenantPlan: 'plus' }) }));

// The real widget needs a Google Maps key and a live script tag. It spreads any
// prop it does not consume onto its <input>, so `className` is what the form
// gives it — which is what these tests measure. `onPlaceSelected` is captured
// rather than dropped so the autofill can be driven directly.
vi.mock('react-google-autocomplete', () => ({
  default: (props: any) => {
    fx.onPlaceSelected = props.onPlaceSelected;
    return <input data-maps-autocomplete="" className={props.className} placeholder={props.placeholder} />;
  },
}));
vi.mock('../ImageUpload', () => ({
  ImageUpload: (props: any) => <div data-image-upload="" className={`w-full space-y-3 ${props.className ?? ''}`} />,
}));

const ChurchEnrollment = (await import('../ChurchEnrollment')).default;
const AdminChurches = (await import('../AdminChurches')).default;
const {
  mobileLayer, fontSizeTokens, fontSizePx, isFontSizeToken, colourTokens, allTokens,
  maxWidthPx, maxWidthTokens, isResponsive, breakpointOf,
  arbitraryPx, heightPx, heightTokens,
  REM_PX_MOBILE, REM_PX_DESKTOP,
} = await import('../../test/support/class-inventory');
const {
  mountForm, fieldBoxByLabel, fieldByLabel, fieldLabels, submitButton, normalise,
} = await import('../../test/support/church-form');
const {
  FORM_CONTAINER, FORM_MEASURE, CONTAINERS, FIELD_WIDTH, FIELD_WIDTHS, ACTION_BUTTON,
  CONTROL_DENSITY, CONTROL_DENSITY_TOKENS, DENSITY_PX, DESKTOP_CONTROL_MAX_PX,
} = await import('../layout/form-layout');

/** Every rule in the module, as one list — what the `sm:` gate is checked over. */
const ALL_RULES = [...CONTAINERS, ACTION_BUTTON, ...FIELD_WIDTHS, ...CONTROL_DENSITY_TOKENS];

const SRC = path.resolve(__dirname, '..');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

/**
 * Baselines extracted mechanically by the code below, run against unmodified
 * HEAD (752ff16) — never hand-typed.
 *
 * The generator lives in THIS file, sharing the mocks the assertions use,
 * because the alternative does not survive contact: a standalone generator
 * with its own ImageUpload mock produced a fixture that differed from the
 * rendering by exactly one class, and the "mobile is unchanged" test read that
 * as a mobile regression. One set of mocks, one source of truth.
 *
 * To re-record — ONLY when the sub-640px rendering is deliberately changing,
 * which for this PR it is not:
 *
 *     git stash push -- src/components/AdminChurches.tsx src/components/ChurchEnrollment.tsx
 *     UPDATE_LAYOUT_BASELINE=1 npx vitest run src/components/__tests__/ChurchEnrollment.desktop-layout.test.tsx
 *     git stash pop
 */
const FIXTURES = path.join(__dirname, '__fixtures__');
const RECORDING = !!process.env.UPDATE_LAYOUT_BASELINE;

interface FormBaseline { mobileLayer: string[]; labels: string[]; fontSizes: string[]; colours: string[] }
interface CardBaseline { mobileLayer: string[]; cardClass: string }

const readFixture = <T,>(name: string): T =>
  JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8')) as T;

/**
 * Rendered control heights and gaps in px, measured in headless Chromium
 * against the real compiled Tailwind CSS and the real admin shell on
 * unmodified HEAD (0accd19), keyed by the visible label.
 *
 * happy-dom does no layout, so a height cannot be measured here — but it does
 * not have to be. What a phone renders is decided by the class tokens that
 * reach it, and those ARE readable here: a control keeps the box it was
 * measured with unless a height token escapes its `sm:` gate and lands on it.
 * The fixture supplies the measured box; the tests supply the escape check.
 */
interface ControlBaseline {
  formHeight: number; labelGap: number; fieldGap: number; sectionGap: number;
  submit: number; controls: Record<string, number>;
}
const CONTROL_BASELINE = readFixture<Record<'380' | '1440', ControlBaseline>>(
  'church-form-control-heights.json',
);
const MOBILE_BASE = CONTROL_BASELINE['380'];
const DESKTOP_BASE = CONTROL_BASELINE['1440'];

/** The WCAG / platform floor for a touch target. */
const TOUCH_TARGET_MIN_PX = 44;

const tokensOf = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
/** True when an element carries every token of a rule, exactly as the rule spells it. */
const carries = (el: Element, rule: string) =>
  rule.split(/\s+/).every((t) => tokensOf(el).includes(t));

let BASELINE!: FormBaseline;
let CARD_BASELINE!: CardBaseline;

beforeAll(async () => {
  if (RECORDING) {
    const c = await form();
    writeFileSync(path.join(FIXTURES, 'church-form-mobile.json'), JSON.stringify({
      mobileLayer: mobileLayer(c), labels: fieldLabels(c),
      fontSizes: fontSizeTokens(c), colours: colourTokens(c),
    } satisfies FormBaseline, null, 2) + '\n');
    mounted!.unmount();
    mounted = null;

    const { container, card } = await addChurchCard();
    writeFileSync(path.join(FIXTURES, 'admin-churches-card-mobile.json'), JSON.stringify({
      mobileLayer: mobileLayer(container), cardClass: card.getAttribute('class') ?? '',
    } satisfies CardBaseline, null, 2) + '\n');
    mounted!.unmount();
    mounted = null;
  }
  BASELINE = readFixture<FormBaseline>('church-form-mobile.json');
  CARD_BASELINE = readFixture<CardBaseline>('admin-churches-card-mobile.json');
});

/** Every field that carries a width rule, by label. The services row is separate. */
const FIELDS = [
  'Search Church with Google Maps API', 'Church Name', 'Denomination', 'Church Image',
  'Street', 'Number', 'City', 'State/Province', 'Zipcode', 'Country',
  'Latitude', 'Longitude', 'Full Name', 'Email Address', 'Phone Number',
  'Website', 'Facebook', 'Instagram',
];

let mounted: { container: HTMLDivElement; unmount: () => void } | null = null;

async function form() {
  mounted = await mountForm(<ChurchEnrollment onBack={() => {}} />);
  return mounted.container;
}

/** Mount AdminChurches and open the Add Church card — where the container rule lands. */
async function addChurchCard() {
  mounted = await mountForm(<AdminChurches />);
  const add = Array.from(mounted.container.querySelectorAll('button')).find((b) =>
    normalise(b.textContent ?? '').toLowerCase().includes('add church'),
  );
  if (!add) throw new Error('no "Add church" button — AdminChurches markup changed, test needs updating');
  await act(async () => { add.dispatchEvent(new Event('click', { bubbles: true })); await Promise.resolve(); });
  const card = mounted.container.firstElementChild as HTMLElement;
  if (!card?.textContent?.includes('Add Church')) throw new Error('Add Church card did not open');
  return { container: mounted.container, card };
}

beforeEach(() => { fx.adds = []; fx.onPlaceSelected = null; });
afterEach(() => { mounted?.unmount(); mounted = null; });

// ─────────────────────────────────────────────────────────────────────────────
// 1. The one that matters most.
// ─────────────────────────────────────────────────────────────────────────────
describe('the sub-640px rendering of the Church form is unchanged', () => {
  it('renders the same class layer below 640px as it did before the rules existed', async () => {
    // Only tokens with no breakpoint in their variant chain can apply on a
    // phone. Compared element by element in document order, so a moved or
    // re-wrapped node fails too — not just a changed class.
    expect(mobileLayer(await form())).toEqual(BASELINE.mobileLayer);
  });

  it('renders the same class layer below 640px for the card that hosts the form', async () => {
    const { container } = await addChurchCard();
    expect(mobileLayer(container)).toEqual(CARD_BASELINE.mobileLayer);
  });

  it('defines no rule that can reach a phone — every token in the shared module is breakpoint-gated', () => {
    const ungated = ALL_RULES.flatMap((r) => r.split(/\s+/).filter(Boolean)).filter((t) => !isResponsive(t));
    expect(ungated, 'these tokens would apply at every width, mobile included').toEqual([]);
  });

  it('gates every rule at sm: — the first breakpoint above the phone range', () => {
    const gates = new Set(ALL_RULES.flatMap((r) => r.split(/\s+/).filter(Boolean)).map(breakpointOf));
    expect([...gates]).toEqual(['sm']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Rule 1 — the container.
// ─────────────────────────────────────────────────────────────────────────────
describe('the form content is constrained at desktop widths', () => {
  it('caps and centres the Add Church card', async () => {
    const { card } = await addChurchCard();
    const caps = maxWidthTokens(card);
    expect(caps, 'the card that hosts the form carries no maximum width').not.toEqual([]);
    expect(card.className).toContain('sm:mx-auto');
  });

  it('caps it at the measure of the FORM, not at the room the shell happens to leave', async () => {
    const { card } = await addChurchCard();
    const px = maxWidthTokens(card).map(maxWidthPx).find((v): v is number => v !== null);
    expect(px).toBeDefined();
    // The card takes the FORM measure, not the page one. Both live in the
    // module: the page measure sizes a data-dense screen against the room the
    // admin shell leaves (the course builder's curriculum tab, THE-179), and
    // this one sizes a form against the content going into it. A form on the
    // page measure is the defect below.
    expect(card.className).toContain(FORM_MEASURE.split(' ')[0]);
    expect(px).toBe(maxWidthPx(FORM_MEASURE.split(' ')[0]));
    // This bound was ">1024 and <1164.5" — the admin shell's content box at
    // 1440px, minus nothing. That sizes the room, not the content, and measured
    // in Chromium it left 93.6px of dead space to the right of the busiest row.
    //
    // The measure of the form is the widest row it can draw: two `long` fields
    // side by side, plus the column gap between them, plus the card's own 1px
    // border and `p-4` either side. The column gap and the padding are rem, so
    // they are wider at the 16px base than at the 14.5px desktop one, and the
    // wider of the two decides.
    const columnGap = 1.5 * REM_PX_MOBILE;          // `gap-6`
    const cardChrome = 2 * (1 * REM_PX_MOBILE) + 2; // `p-4` either side + 1px border either side
    const twoLongFields = 2 * maxWidthPx(FIELD_WIDTH.long)! + columnGap + cardChrome;
    expect(px!).toBeGreaterThanOrEqual(twoLongFields);
    // ...and no wider than that, give or take a rounding to a whole ten. A cap
    // materially above the content it holds is the dead space coming back.
    expect(px!).toBeLessThan(twoLongFields + 10);
    // Still below the 1164.5px the shell leaves at 1440px, so it engages at the
    // width the defect was reported at.
    expect(px!).toBeLessThan(1164.5);
  });

  it('keeps the two measures distinct — a form measure that equals the page one is not one', () => {
    const page = maxWidthPx(FORM_CONTAINER.split(' ')[0])!;
    const measure = maxWidthPx(FORM_MEASURE.split(' ')[0])!;
    expect(measure).toBeLessThan(page);
    // The page measure is the shell's business and is asserted by THE-179's own
    // tests; pinned here only so that narrowing a form cannot be done by
    // quietly moving the page instead.
    expect(page).toBeGreaterThan(1024);
    expect(page).toBeLessThan(1164.5);
  });

  it('leaves the cap inert below sm — the card is unconstrained on a phone', async () => {
    const { card } = await addChurchCard();
    expect(maxWidthTokens(card).filter((t) => !isResponsive(t))).toEqual([]);
    // And the class the card carried before the rule is still all it carries at base.
    const base = (card.getAttribute('class') ?? '').split(/\s+/).filter((t) => t && !isResponsive(t));
    expect(base.sort()).toEqual(CARD_BASELINE.cardClass.split(/\s+/).filter(Boolean).sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Rule 3 — the button.
// ─────────────────────────────────────────────────────────────────────────────
describe('the submit button is full width on mobile and content width from sm up', () => {
  it('stays a stretched flex child below sm', async () => {
    const btn = submitButton(await form());
    const base = (btn.getAttribute('class') ?? '').split(/\s+/).filter((t) => t && !isResponsive(t));
    // `flex-1` in the `flex-col` wrapper is what makes it full width on a phone.
    expect(base).toContain('flex-1');
    expect(base.filter((t) => /^(?:max-)?w-/.test(t)), 'a base width rule would change the phone').toEqual([]);
  });

  it('sizes to its label from sm up', async () => {
    const btn = submitButton(await form());
    const tokens = (btn.getAttribute('class') ?? '').split(/\s+/);
    expect(tokens, 'without flex-none the button keeps filling the row').toContain('sm:flex-none');
  });

  it('gains the horizontal padding a content-width button needs', async () => {
    const btn = submitButton(await form());
    const tokens = (btn.getAttribute('class') ?? '').split(/\s+/);
    // The button carries only `py-4` — full width never needed side padding.
    expect(tokens.some((t) => /^sm:px-/.test(t)), 'a content-width button with no side padding hugs its text').toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Rule 4 — desktop control density.
// ─────────────────────────────────────────────────────────────────────────────

/** Every control the density rule is responsible for, found without a class pattern. */
const controlsOf = (root: ParentNode) =>
  Array.from(root.querySelectorAll('form input:not([type="file"]), form select, form textarea'));

describe('a desktop control is no taller than the chosen maximum', () => {
  it('sizes every control and every action to a height inside the desktop band', () => {
    // Asked of `control` and `action` BY NAME rather than of whatever heights
    // happen to be in the module: a rule that quietly stops setting a height is
    // the whole defect coming back, and a check that only ranged over the
    // heights it found would report nothing at all.
    for (const name of ['control', 'action'] as const) {
      const px = CONTROL_DENSITY[name].split(/\s+/)
        .map((t) => heightPx(t, REM_PX_DESKTOP)).find((v): v is number => v !== null);
      expect(px, `${name} sets no height — nothing caps how tall it renders`).toBeDefined();
      expect(px!, `${name} is above the desktop density band`).toBeLessThanOrEqual(DESKTOP_CONTROL_MAX_PX);
      expect(px!, `${name} is not a real height`).toBeGreaterThan(0);
    }
  });

  it('measures every one of them in px, so the desktop rem trim cannot move them', () => {
    // globals.css runs a 14.5px root above 1024px. A rem height would be one
    // number on a tablet and 9.4% less on a monitor, which is not a cap.
    for (const token of CONTROL_DENSITY_TOKENS.flatMap((r) => r.split(/\s+/))) {
      expect(token, `${token} carries a rem value`).not.toMatch(/-\[[\d.]+rem\]$/);
    }
    expect(heightPx(CONTROL_DENSITY.control, REM_PX_MOBILE))
      .toBe(heightPx(CONTROL_DENSITY.control, REM_PX_DESKTOP));
  });

  it('puts that height on every control the form draws, not on a chosen few', async () => {
    const c = await form();
    const bare = controlsOf(c).filter((el) => !carries(el, CONTROL_DENSITY.control));
    expect(bare.map((el) => el.getAttribute('placeholder') ?? el.tagName), 'these controls keep the old height').toEqual([]);
    expect(controlsOf(c).length, 'the form lost its controls').toBeGreaterThan(15);
  });

  it('puts the action height on the submit button', async () => {
    expect(carries(submitButton(await form()), CONTROL_DENSITY.action)).toBe(true);
  });

  it('agrees with the px it documents — the tokens and the numbers are one rule', () => {
    for (const [name, rule] of Object.entries(CONTROL_DENSITY)) {
      const px = rule.split(/\s+/).map((t) => arbitraryPx(t, REM_PX_DESKTOP)).find((v) => v !== null);
      expect(px, `${name} carries no absolute length`).toBe(DENSITY_PX[name as keyof typeof DENSITY_PX]);
    }
  });
});

describe('mobile touch targets are at least 44px', () => {
  /**
   * What a control would actually render at 380px: an unprefixed height token
   * wins, because it reaches the phone; otherwise the control keeps the box it
   * was measured with. Dropping the `sm:` from the height rule is exactly the
   * first case, and it lands here as 38px.
   *
   * Deleting the mobile padding instead is test 1's catch, not this one's —
   * `mobileLayer` pins every unprefixed token on every element.
   */
  const mobileHeight = (el: Element, measured: number) => {
    const escaped = heightTokens(el)
      .filter((t) => !isResponsive(t))
      .map((t) => heightPx(t, REM_PX_MOBILE))
      .find((v): v is number => v !== null);
    return escaped ?? measured;
  };

  const measuredMobile = async () => {
    const c = await form();
    const out = new Map<string, number>();
    for (const label of Array.from(c.querySelectorAll('label'))) {
      const control = label.parentElement?.querySelector('input:not([type="file"]), select, textarea');
      const text = normalise(label.textContent ?? '');
      const base = MOBILE_BASE.controls[text];
      if (control && base !== undefined) out.set(text, mobileHeight(control, base));
    }
    out.set('__submit__', mobileHeight(submitButton(c), MOBILE_BASE.submit));
    return out;
  };

  it('keeps every field the form asks a phone to tap at 44px or more', async () => {
    const heights = await measuredMobile();
    // The Weekly Services row is a pre-existing exception and not this rule's
    // to fix: `px-3 py-2` renders 42px, and its day picker 39px, on unmodified
    // HEAD. Naming them from the MEASURED baseline rather than a hand-written
    // list means the exception cannot quietly grow to cover a new regression.
    const alreadyBelow = new Set(
      Object.entries(MOBILE_BASE.controls)
        .filter(([, h]) => h < TOUCH_TARGET_MIN_PX)
        .map(([label]) => label),
    );
    const below = [...heights].filter(([label, h]) => h < TOUCH_TARGET_MIN_PX && !alreadyBelow.has(label));
    expect(below, 'these are new sub-44px touch targets on a phone').toEqual([]);
  });

  it('shrinks no control on a phone, not even one already under 44px', async () => {
    const heights = await measuredMobile();
    const shrunk = [...heights].filter(([label, h]) => {
      const base = label === '__submit__' ? MOBILE_BASE.submit : MOBILE_BASE.controls[label];
      return h < base;
    });
    expect(shrunk, 'the density rule reached the phone').toEqual([]);
  });

  it('keeps the submit button a 56px target on a phone', async () => {
    const heights = await measuredMobile();
    expect(heights.get('__submit__')).toBe(MOBILE_BASE.submit);
    expect(heights.get('__submit__')!).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
  });
});

describe('every new token is gated at sm: or above', () => {
  it('gates every token of the density rule, read off the token strings themselves', () => {
    const tokens = CONTROL_DENSITY_TOKENS.flatMap((r) => r.split(/\s+/).filter(Boolean));
    expect(tokens.length, 'the density rule defines no tokens').toBeGreaterThan(0);
    expect(tokens.filter((t) => !isResponsive(t)), 'these reach a phone').toEqual([]);
    expect([...new Set(tokens.map(breakpointOf))]).toEqual(['sm']);
  });

  it('gates each token individually — a rule is only as gated as its loosest token', () => {
    // `sm:h-[38px] py-0` would pass a check that only looked at the first token.
    for (const [name, rule] of Object.entries(CONTROL_DENSITY)) {
      for (const token of rule.split(/\s+/)) {
        expect(breakpointOf(token), `${name} carries an ungated token: ${token}`).toBe('sm');
      }
    }
  });
});

describe('the vertical rhythm tokens come from form-layout, not per-screen values', () => {
  /** The token families this rule owns: height, vertical padding, and the gaps. */
  const RHYTHM = /^(?:h-|py-|mb-|space-y-|gap-y-)/;
  const rhythmTokensIn = (root: ParentNode) => {
    const owned = new Set(CONTROL_DENSITY_TOKENS.flatMap((r) => r.split(/\s+/)));
    return [...new Set(allTokens(root).filter((t) => isResponsive(t) && RHYTHM.test(t.replace(/^sm:/, ''))))]
      .filter((t) => !owned.has(t));
  };

  it('renders no sm:-gated rhythm value the shared module does not define', async () => {
    expect(rhythmTokensIn(await form()), 'a rhythm value defined per screen rebuilds the problem').toEqual([]);
  });

  it('renders none on the card that hosts the form either', async () => {
    const { container } = await addChurchCard();
    expect(rhythmTokensIn(container)).toEqual([]);
  });

  it('writes none of them inline in either consumer', () => {
    for (const file of ['AdminChurches.tsx', 'ChurchEnrollment.tsx']) {
      expect(read(file).match(/sm:h-\[|sm:py-|sm:mb-\[|sm:space-y-\[|sm:gap-y-\[/g), file).toBeNull();
    }
  });

  it('puts the rhythm on the elements that lay the form out', async () => {
    const c = await form();
    const formEl = c.querySelector('form')!;
    expect(carries(formEl, CONTROL_DENSITY.sectionGap), 'the form spaces its sections per-screen').toBe(true);
    const sections = Array.from(formEl.children).filter((el) => el.querySelector('h3'));
    expect(sections.length).toBeGreaterThan(3);
    for (const section of sections) {
      expect(carries(section, CONTROL_DENSITY.fieldGap), 'a section spaces its fields per-screen').toBe(true);
    }
    const grids = Array.from(formEl.querySelectorAll('[class*="grid-cols-"]'));
    expect(grids.length).toBeGreaterThan(3);
    for (const grid of grids) {
      expect(carries(grid, CONTROL_DENSITY.rowGap), 'a field grid spaces its rows per-screen').toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. What the rule actually buys: a shorter form.
// ─────────────────────────────────────────────────────────────────────────────

/** How many columns a grid divides itself into at desktop. */
const gridCols = (el: Element) => {
  const t = tokensOf(el).find((x) => isResponsive(x) && /grid-cols-\d+$/.test(x));
  return t ? parseInt(t.slice(t.lastIndexOf('-') + 1), 10) : 1;
};
const isGrid = (el: Element) => tokensOf(el).some((t) => /(?:^|:)grid-cols-\d+$/.test(t));
const colSpan = (el: Element) => {
  const t = tokensOf(el).find((x) => /(?:^|:)col-span-\d+$/.test(x));
  return t ? parseInt(t.slice(t.lastIndexOf('-') + 1), 10) : 1;
};

/** The cells of a grid, packed into the rows they actually land on. */
const packRows = (grid: Element): Element[][] => {
  const cols = gridCols(grid);
  const rows: Element[][] = [];
  let row: Element[] = [];
  let used = 0;
  for (const cell of Array.from(grid.children)) {
    const span = Math.min(colSpan(cell), cols);
    if (used + span > cols) { rows.push(row); row = []; used = 0; }
    row.push(cell);
    used += span;
  }
  if (row.length) rows.push(row);
  return rows;
};

/**
 * The desktop height this rule takes OUT of the form, in px, split by lever.
 *
 * Walked over the real rendered markup: form -> section -> block -> row, with a
 * grid's cells packed into rows the way the browser packs them. A row gives
 * back what its TALLEST cell gives back, which is why shrinking a control that
 * shares a row with a taller one is worth nothing — and why counting controls
 * instead of rows would overstate this by a factor of about two.
 *
 * Against the same form measured in Chromium at 1440px, this comes to 223.75px:
 * 1671.75px -> 1448px. It is a model, and it is pinned to that measurement.
 */
const heightSavedAtDesktop = (container: HTMLElement) => {
  const acc = { controls: 0, labels: 0, gaps: 0 };
  const formEl = container.querySelector('form')!;

  const baseline = new Map<Element, number>();
  for (const label of Array.from(formEl.querySelectorAll('label'))) {
    const control = label.parentElement?.querySelector('input:not([type="file"]), select, textarea');
    const h = DESKTOP_BASE.controls[normalise(label.textContent ?? '')];
    if (control && h !== undefined) baseline.set(control, h);
  }
  baseline.set(submitButton(formEl), DESKTOP_BASE.submit);

  const now = (c: Element) =>
    carries(c, CONTROL_DENSITY.control) ? DENSITY_PX.control
      : carries(c, CONTROL_DENSITY.action) ? DENSITY_PX.action
        : baseline.get(c)!;

  const controlsIn = (cells: Element[]) =>
    cells.flatMap((el) => [...Array.from(el.querySelectorAll('*')), el]).filter((el) => baseline.has(el));

  const rowSaving = (cells: Element[]) => {
    const cs = controlsIn(cells);
    if (cs.length) acc.controls += Math.max(...cs.map((c) => baseline.get(c)!)) - Math.max(...cs.map(now));
    const labels = cells.flatMap((c) => Array.from(c.querySelectorAll('label')));
    if (labels.some((l) => carries(l, CONTROL_DENSITY.labelGap))) {
      acc.labels += DESKTOP_BASE.labelGap - DENSITY_PX.labelGap;
    }
  };

  const gapSaving = (el: Element, rule: string, before: number, after: number, n: number) => {
    if (n > 0 && carries(el, rule)) acc.gaps += n * (before - after);
  };

  const sections = Array.from(formEl.children);
  gapSaving(formEl, CONTROL_DENSITY.sectionGap, DESKTOP_BASE.sectionGap, DENSITY_PX.sectionGap, sections.length - 1);
  for (const section of sections) {
    const blocks = Array.from(section.children);
    gapSaving(section, CONTROL_DENSITY.fieldGap, DESKTOP_BASE.fieldGap, DENSITY_PX.fieldGap, blocks.length - 1);
    for (const block of blocks) {
      if (isGrid(block)) {
        const rows = packRows(block);
        gapSaving(block, CONTROL_DENSITY.rowGap, DESKTOP_BASE.fieldGap, DENSITY_PX.rowGap, rows.length - 1);
        for (const row of rows) rowSaving(row);
      } else {
        rowSaving([block]);
      }
    }
  }
  return { ...acc, total: acc.controls + acc.labels + acc.gaps };
};

describe('the total rendered form height at 1440px is measurably shorter than before', () => {
  it('takes 223.75px out of a 1671.75px form — 1448px, a 13.4% cut', async () => {
    const saved = heightSavedAtDesktop(await form());
    expect(saved.total).toBeCloseTo(223.75, 2);
    expect(DESKTOP_BASE.formHeight - saved.total).toBeCloseTo(1448, 2);
  });

  it('gets it from BOTH levers — smaller controls AND tighter gaps', async () => {
    const saved = heightSavedAtDesktop(await form());
    // The warning this test exists for: shrinking controls without tightening
    // the gaps leaves the form the same length with smaller parts in it. The
    // gaps are the LARGER half here — 121.75px against 88.25px — so a diff that
    // keeps the heights and drops the rhythm gives back barely a third of this.
    expect(saved.controls, 'no height came out of the controls').toBeGreaterThan(80);
    expect(saved.gaps, 'the gaps were left as they were').toBeGreaterThan(100);
    expect(saved.gaps).toBeGreaterThan(saved.controls);
  });

  it('shortens the form without shortening the label — that is the type scale', async () => {
    const saved = heightSavedAtDesktop(await form());
    // The label margin is rhythm and moves; the label SIZE is 769 one-off
    // values and a separate step. 13.75px of 223.75px comes from the margin.
    expect(saved.labels).toBeGreaterThan(0);
    expect(saved.labels).toBeLessThan(saved.total * 0.1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 & 5. Rule 2 — field widths.
// ─────────────────────────────────────────────────────────────────────────────
describe('a short field is narrower than a long field', () => {
  it('gives Zipcode less room than Street', async () => {
    const c = await form();
    const zip = maxWidthPx(maxWidthTokens(fieldBoxByLabel(c, 'Zipcode'))[0] ?? '');
    const street = maxWidthPx(maxWidthTokens(fieldBoxByLabel(c, 'Street'))[0] ?? '');
    expect(zip, 'Zipcode carries no width rule').not.toBeNull();
    expect(street, 'Street carries no width rule').not.toBeNull();
    expect(zip!).toBeLessThan(street!);
  });

  it('gives Number less room than Email Address', async () => {
    const c = await form();
    const num = maxWidthPx(maxWidthTokens(fieldBoxByLabel(c, 'Number'))[0] ?? '');
    const email = maxWidthPx(maxWidthTokens(fieldBoxByLabel(c, 'Email Address'))[0] ?? '');
    expect(num!).toBeLessThan(email!);
  });

  it('gives every field a width rule, so none of them falls back to the parent', async () => {
    const c = await form();
    const missing = FIELDS.filter((label) => maxWidthTokens(fieldBoxByLabel(c, label)).length === 0);
    expect(missing).toEqual([]);
  });
});

describe('the number of distinct field widths is small and enumerable', () => {
  it('draws every field width from the shared set', async () => {
    const c = await form();
    const used = new Set(FIELDS.flatMap((label) => maxWidthTokens(fieldBoxByLabel(c, label))));
    const stray = [...used].filter((t) => !(FIELD_WIDTHS as readonly string[]).includes(t));
    expect(stray, 'a width defined outside the shared set rebuilds the problem in a new syntax').toEqual([]);
  });

  it('uses a handful of widths, not one per field', async () => {
    const c = await form();
    const used = new Set(FIELDS.flatMap((label) => maxWidthTokens(fieldBoxByLabel(c, label))));
    expect(used.size).toBeLessThanOrEqual(4);
    expect(used.size).toBeGreaterThan(1);
    // 18 fields, at most 4 widths — the point of the rule.
    expect(FIELDS.length).toBeGreaterThan(used.size * 4);
  });

  it('enumerates the set in one place, with each width distinct', () => {
    expect(FIELD_WIDTHS.length).toBeLessThanOrEqual(4);
    const px = FIELD_WIDTHS.map(maxWidthPx);
    expect(px.every((v) => v !== null)).toBe(true);
    expect(new Set(px).size).toBe(px.length);
  });

  it('caps the repeating services row as a whole, leaving its own fractions intact', async () => {
    const c = await form();
    const row = fieldByLabel(c, 'Day').closest('.md\\:flex-row') as HTMLElement | null;
    expect(row, 'the service row markup changed, test needs updating').not.toBeNull();
    expect(maxWidthTokens(row!)).toEqual([FIELD_WIDTH.group]);
    // The fractions that split the row are untouched — that is what keeps
    // "Add another service" and the remove button behaving as they do now.
    expect(row!.className).toContain('md:flex-row');
    expect(fieldByLabel(c, 'Day').parentElement!.className).toContain('md:w-1/4');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. One shared place, with callers.
// ─────────────────────────────────────────────────────────────────────────────
describe('the layout rules live in one shared place and have a caller', () => {
  it('exports all three rules from src/components/layout/form-layout.ts', () => {
    expect(typeof FORM_CONTAINER).toBe('string');
    expect(typeof FORM_MEASURE).toBe('string');
    expect(typeof ACTION_BUTTON).toBe('string');
    expect(Object.keys(FIELD_WIDTH).length).toBeGreaterThan(0);
  });

  it('is imported by the screen it was written for', () => {
    expect(read('AdminChurches.tsx')).toContain("from './layout/form-layout'");
    expect(read('ChurchEnrollment.tsx')).toContain("from './layout/form-layout'");
  });

  it('defines no width outside that module — every rule reaches the markup through it', () => {
    // `sm:`-gated widths are this PR's rules by construction. One appearing
    // inline in a consumer would mean a second, competing definition.
    for (const file of ['AdminChurches.tsx', 'ChurchEnrollment.tsx']) {
      expect(read(file).match(/sm:max-w-|sm:mx-auto|sm:flex-none/g), file).toBeNull();
    }
  });

  it('reaches only the screens that deliberately opted in — not forty screens by accident', () => {
    // The point of this PR was that one form could be judged before the rules
    // reached forty screens. THE-179 (AdminCourseEditor.desktop-layout.test.tsx)
    // and THE-181 batch 2 (PersonalInformationModal, EnterpriseContactModal) are
    // the deliberate, explicitly-instructed adopters that followed — reusing
    // these exact rules instead of inventing a second set of desktop widths. An
    // importer NOT in this list is what would mean the rules leaked in by
    // accident rather than by a scoped decision each time.
    //
    // THE-181 adds the CRM's two files as the third and fourth adopters, again
    // by explicit instruction, and again reusing the rules rather than minting
    // widths: between them they retired THREE rem container measures
    // (max-w-2xl / -3xl / -6xl, each a different number either side of the
    // 1024px rem trim). AnalyticsAndRoles.tsx is listed separately from
    // AdminCRM.tsx because it renders two of the three tabs itself.
    // AdminCRM.desktop-layout.test.tsx holds the same list, so this gate keeps
    // failing loudly for adopter five.
    //
    // THE-183 (AdminSettings.regroup.test.tsx) is that adopter, on the same
    // terms: admin Settings took FORM_MEASURE, ACTION_BUTTON and CONTROL_DENSITY
    // as they stand, and retired a fourth rem measure (another max-w-2xl, 609px
    // on a monitor). It takes no FIELD_WIDTH, because it renders no input of its
    // own — every field on that screen lives inside a settings section
    // component, and those were out of scope.
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
    // THE-190 batch H is the first adopter from the MEMBER app rather than the
    // admin one. Five member screens take a rule: NewsTab takes Rule 1a's page
    // measure, and AllNews, BiblePage, AIChat and UserMessages take Rule 6, the
    // reading measure that batch adds. Between them they retired three more rem
    // measures — `lg:max-w-2xl` (609px) and `lg:max-w-3xl` (696px), plus an
    // inline `maxWidth: "48rem"` COPY of the latter that no class could have
    // overridden. MainApp.tsx (the shell) and LivestreamView.tsx were in that
    // batch's scope and deliberately take nothing — see
    // MemberScreens.desktop-layout.test.tsx for why each.
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
      'src/components/AdminSettings.tsx',
      'src/components/AdminSms.tsx',
      'src/components/AdminTenants.tsx',
      'src/components/AllNews.tsx',
      'src/components/AnalyticsAndRoles.tsx',
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
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7 & 8. Behaviour must not move.
// ─────────────────────────────────────────────────────────────────────────────
describe('no field was added, removed, reordered or renamed', () => {
  it('renders the same labels, in the same order', async () => {
    expect(fieldLabels(await form())).toEqual(BASELINE.labels);
  });
});

describe('the submit path and the Maps autofill are untouched', () => {
  it('still writes the church the submit handler always wrote', async () => {
    const c = await form();
    const set = (el: HTMLInputElement, v: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    // Real lat/lng keep handleSubmit off the Nominatim geocoding fallback.
    await act(async () => { set(fieldByLabel(c, 'Church Name') as HTMLInputElement, 'Grace Chapel'); });
    await act(async () => { set(fieldByLabel(c, 'Latitude') as HTMLInputElement, '45.75'); });
    await act(async () => { set(fieldByLabel(c, 'Longitude') as HTMLInputElement, '21.22'); });
    await act(async () => {
      c.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const write = fx.adds.find((a) => a.path === 'churches');
    expect(write, 'the submit path no longer writes').toBeDefined();
    expect(write!.data.name).toBe('Grace Chapel');
    expect(write!.data.lat).toBe(45.75);
    expect(write!.data.tenantId).toBe('tenant-1');
  });

  it('still auto-fills every address field from a selected place', async () => {
    const c = await form();
    expect(fx.onPlaceSelected, 'the Maps widget lost its callback').toBeTypeOf('function');
    await act(async () => {
      fx.onPlaceSelected!({
        name: 'Grace Community Church',
        website: 'https://grace.example',
        formatted_phone_number: '+1 555 0100',
        geometry: { location: { lat: () => 45.75, lng: () => 21.22 } },
        address_components: [
          { types: ['street_number'], long_name: '42' },
          { types: ['route'], long_name: 'Elm Street' },
          { types: ['locality'], long_name: 'Springfield' },
          { types: ['administrative_area_level_1'], long_name: 'Illinois' },
          { types: ['country'], long_name: 'United States' },
          { types: ['postal_code'], long_name: '62704' },
        ],
      });
      await Promise.resolve();
    });
    const value = (label: string) => (fieldByLabel(c, label) as HTMLInputElement).value;
    expect(value('Church Name')).toBe('Grace Community Church');
    expect(value('Number')).toBe('42');
    expect(value('Street')).toBe('Elm Street');
    expect(value('City')).toBe('Springfield');
    expect(value('State/Province')).toBe('Illinois');
    expect(value('Country')).toBe('United States');
    expect(value('Zipcode')).toBe('62704');
    expect(value('Website')).toBe('https://grace.example');
    expect(value('Phone Number')).toBe('+1 555 0100');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9 & 10. Colour and type are somebody else's PR.
// ─────────────────────────────────────────────────────────────────────────────
describe('no colour is hardcoded, and all four palettes resolve', () => {
  it('adds no colour to the form — the rendered colour tokens are the baseline set', async () => {
    expect(colourTokens(await form())).toEqual(BASELINE.colours);
  });

  it('defines no colour in the shared rules module', () => {
    const src = read('layout/form-layout.ts');
    const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/\b(?:rgba?|hsla?|oklch|color-mix)\(/);
    const probe = document.createElement('div');
    probe.appendChild(document.createElement('span')).className =
      [...CONTAINERS, ACTION_BUTTON, ...FIELD_WIDTHS].join(' ');
    expect(colourTokens(probe)).toEqual([]);
  });

  it('leaves all four palettes to resolve exactly as they did', () => {
    // Harvest and Classic, each in light and dark. Nothing above adds, removes
    // or re-hues a colour token, so all four render the form as before — this
    // pins that the four scopes are the four, so "all four" stays a real count.
    const css = readFileSync(path.resolve(SRC, '../app/globals.css'), 'utf8');
    expect(css).toMatch(/^\s*:root\s*\{/m);
    expect(css).toMatch(/\[data-theme="dark"\]\s*\{/);
    expect(css).toMatch(/\[data-palette="classic"\]\[data-theme="light"\]\s*\{/);
    expect(css).toMatch(/\[data-palette="classic"\]\[data-theme="dark"\]\s*\{/);
  });
});

describe('no font size changed', () => {
  it('renders the same font-size tokens as the baseline', async () => {
    expect(fontSizeTokens(await form())).toEqual(BASELINE.fontSizes);
  });

  it('renders the same font size on each ELEMENT, not merely the same set of them', async () => {
    // The set alone does not catch a swap. `text-xs` is already in it — the
    // services row labels carry it — so moving a field's label from `text-sm`
    // to `text-xs` leaves the set byte-identical while shrinking that label to
    // 10.875px, under the 11px floor. Compared element by element, in document
    // order, against the same recorded baseline.
    const perElement = (rows: string[]) =>
      rows.map((row) => {
        const [index, tag, tokens] = row.split('\t');
        return `${index}\t${tag}\t${(tokens ?? '').split(' ').filter(isFontSizeToken).join(' ')}`;
      });
    expect(perElement(mobileLayer(await form()))).toEqual(perElement(BASELINE.mobileLayer));
  });

  it('introduces no font size anywhere in the shared rules module', () => {
    const rules = [...CONTAINERS, ACTION_BUTTON, ...FIELD_WIDTHS].join(' ').split(/\s+/);
    expect(rules.filter((t) => /(?:^|:)text-|font-size/.test(t))).toEqual([]);
  });

  it('makes nothing smaller than it already was, at either rem base', async () => {
    // Resolved at BOTH bases, because globals.css runs a 16px root below
    // 1024px and a 14.5px root above it.
    //
    // The floor is the baseline's own smallest, not a flat 11px: the service
    // row's `text-xs` labels already compute to 10.875px at desktop density,
    // which predates this PR. The type scale (769 one-off sizes) is explicitly
    // a separate, later step, so that is REPORTED here and left alone — this
    // test's job is that the rules did not make it, or anything else, smaller.
    const sizes = (tokens: string[], rem: number) =>
      tokens.map((t) => fontSizePx(t, rem)).filter((v): v is number => v !== null);
    for (const rem of [REM_PX_MOBILE, REM_PX_DESKTOP]) {
      const now = sizes(fontSizeTokens(await form()), rem);
      const before = sizes(BASELINE.fontSizes, rem);
      expect(Math.min(...now)).toBe(Math.min(...before));
    }
  });

  it('adds no font size below 11px — the rules module carries no size at all', () => {
    const rules = [...CONTAINERS, ACTION_BUTTON, ...FIELD_WIDTHS].join(' ').split(/\s+/);
    const sized = rules.filter((t) => fontSizePx(t, REM_PX_DESKTOP) !== null);
    expect(sized).toEqual([]);
  });
});
