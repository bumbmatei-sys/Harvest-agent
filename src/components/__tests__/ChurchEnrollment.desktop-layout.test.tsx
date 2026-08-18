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
 * Three rules fix it, and they live in ONE place — src/components/layout/
 * form-layout.ts. Every rule there is gated at `sm:` and above, so none of them
 * can reach a phone. That is the constraint the first test in this file exists
 * to enforce, and it is the most important test here: the founder's report was
 * "for mobile, the app is fine", so a diff that moves the sub-640px rendering
 * has failed no matter how good the desktop looks.
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
  mobileLayer, fontSizeTokens, fontSizePx, colourTokens, allTokens,
  maxWidthPx, maxWidthTokens, isResponsive, breakpointOf,
  REM_PX_MOBILE, REM_PX_DESKTOP,
} = await import('../../test/support/class-inventory');
const {
  mountForm, fieldBoxByLabel, fieldByLabel, fieldLabels, submitButton, normalise,
} = await import('../../test/support/church-form');
const { FORM_CONTAINER, FIELD_WIDTH, FIELD_WIDTHS, ACTION_BUTTON } =
  await import('../layout/form-layout');

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
    const rules = [FORM_CONTAINER, ACTION_BUTTON, ...FIELD_WIDTHS];
    const ungated = rules.flatMap((r) => r.split(/\s+/).filter(Boolean)).filter((t) => !isResponsive(t));
    expect(ungated, 'these tokens would apply at every width, mobile included').toEqual([]);
  });

  it('gates every rule at sm: — the first breakpoint above the phone range', () => {
    const rules = [FORM_CONTAINER, ACTION_BUTTON, ...FIELD_WIDTHS];
    const gates = new Set(rules.flatMap((r) => r.split(/\s+/).filter(Boolean)).map(breakpointOf));
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

  it('caps it at a desktop measure, not at an accident of the viewport', async () => {
    const { card } = await addChurchCard();
    const px = maxWidthTokens(card).map(maxWidthPx).find((v): v is number => v !== null);
    expect(px).toBeDefined();
    // Below the 1164.5px the admin shell leaves at 1440px, so the cap actually
    // engages at the width the defect was reported at; above the 1024px
    // breakpoint, so it never engages before the sidebar layout does.
    expect(px!).toBeGreaterThan(1024);
    expect(px!).toBeLessThan(1164.5);
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

  it('reaches exactly the two files of this one form — no other screen was touched', () => {
    // The point of this PR is that one form can be judged before the rules
    // reach forty screens. A third importer means that stopped being true.
    const importers = execSync(
      "grep -rl \"from '.*form-layout'\" src --include=*.tsx --include=*.ts || true",
      { encoding: 'utf8' },
    ).split('\n').filter(Boolean).filter((f) => !f.includes('__tests__')).sort();
    expect(importers).toEqual([
      'src/components/AdminChurches.tsx',
      'src/components/ChurchEnrollment.tsx',
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
      [FORM_CONTAINER, ACTION_BUTTON, ...FIELD_WIDTHS].join(' ');
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

  it('introduces no font size anywhere in the shared rules module', () => {
    const rules = [FORM_CONTAINER, ACTION_BUTTON, ...FIELD_WIDTHS].join(' ').split(/\s+/);
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
    const rules = [FORM_CONTAINER, ACTION_BUTTON, ...FIELD_WIDTHS].join(' ').split(/\s+/);
    const sized = rules.filter((t) => fontSizePx(t, REM_PX_DESKTOP) !== null);
    expect(sized).toEqual([]);
  });
});
