import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { AUTOSAVE_EXCLUDED, AUTOSAVE_ERROR_TOAST_ID, useAutosaveField } from '../settings/autosave';
import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';

/**
 * ⚠️ The failure toast is asserted by RUNNING the hook (test 4), so `sonner` is
 * doubled. Hoisted, and file-scoped: nothing else in this suite touches it.
 */
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
/**
 * ⚠️ IMPORTED FROM #434'S OWN SUITE, DELIBERATELY, and it is a test module —
 * so its describes execute here too and this file's test count includes them.
 * That is accepted: the alternative is a SECOND copy of the detector, and a
 * second copy with a slightly narrower regex is exactly how the violation #434
 * removed survived two sweeps. One detector, one place to widen it.
 */
import { planWritesIn } from '../../__tests__/the-291-client-plan-write.test';
import {
  PLAN_PRICING, PLAN_ORDER, NO_ADDONS,
  getPlanFeatures, getEffectiveFeatures,
} from '../../utils/plan-features';
import { CONTROL_DENSITY, DENSITY_PX, DESKTOP_CONTROL_MAX_PX } from '../layout/form-layout';
import UNTOUCHED from './__fixtures__/the-286-untouched.json';
import { foldedPaymentSectionDigest } from './__fixtures__/the-362-payment-section-fold';
import { freezeFailure } from './__fixtures__/settings-freeze-register';
import { rulesDigestFailure } from '../../__tests__/__fixtures__/firestore-rules-pin';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-300 — the BILLING mount site, onto THE-286's chrome
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ─── 🔴 WHERE THE BILLING SURFACE ACTUALLY IS ───────────────────────────────
 *
 * The brief names four components and asks for "the billing mount site". Read
 * against the tree, three things about that premise need correcting, and each
 * one changes what this slice is:
 *
 *   1. 🔴 THE MOUNT SITE IS `BillingAndPayments.tsx`, not `AdminSettings`. The
 *      brief is right that AdminSettings imports the accordion and five other
 *      sections directly and none of the billing ones — the billing surface is
 *      the owner-only Billing & Payments page, opened from the My Account menu
 *      and mounted by `AdminDashboard` inside a `flex-1 overflow-y-auto` panel.
 *      It exists and it is distinct, so STOP condition 2 does not fire and
 *      #436's "the next slices fall out along mount sites" holds.
 *
 *   2. ⚠️ IT RENDERS TWO OF THE FOUR NAMED COMPONENTS, not four.
 *
 *          PlanUpgradeSection   mounted by BillingAndPayments        ✔ in scope
 *          AddOnsSection        mounted by BillingAndPayments        ✔ in scope
 *          BillingTermToggle    inside PlanUpgradeSection, and
 *                               AdminUpgradePage                     ✔ in scope
 *          PaymentSection       AdminDonations, AdminFundraising      ✘ NOT HERE
 *
 *      🔴 `PaymentSection` IS NOT ON THIS SURFACE. It is the donation PAYOUT
 *      panel and it mounts on two other screens — a fact `the-256`'s suite
 *      already pins ("exactly two screens mount PaymentSection", neither of
 *      them this one). It is still asserted below, because "still switched
 *      off" is a no-regression this slice owes whether or not it is in scope;
 *      it is simply not a thing this slice could convert.
 *
 *   3. ⚠️ THE ADMIN BOTTOM NAV DOES NOT HIDE ON SCROLL. The brief says it does.
 *      `MainApp` (the MEMBER shell) carries `max-lg:translate-y-full` behind
 *      `isNavVisible`; `AdminDashboard`'s nav carries no translate at all — it
 *      is `fixed bottom-0 … z-[100]` and stays put. So "both nav states" for
 *      THIS shell is the two FORMS the nav takes (a bottom bar below `lg`, a
 *      sidebar from `lg`), which is how the layout suite measures it.
 *
 * ─── 🔴 WHAT "ON THE SHARED CHROME" MEANS ON A SURFACE WITH NO ACCORDION ────
 *
 * THE-286's rule is "stop drawing your own card inside a container that already
 * draws one", and #436 already recorded why it does not transfer verbatim here:
 * there is no accordion row on this page, so a section's own card may be the
 * only card it has. That does NOT make the rule empty — it makes the invariant
 * the one THE-286 was really claiming:
 *
 *   🔴 A SECTION DRAWS AT MOST ONE PANEL CARD, AND NEVER A SECOND INSIDE ONE
 *      THE MOUNT SITE ALREADY DRAWS.
 *
 * `PlanUpgradeSection` takes its card from the page and draws none.
 * `AddOnsSection` draws its own and the page wraps it in nothing — deliberately,
 * because it returns `null` on a Stripe tenant and again when the environment
 * can sell no add-ons, so a card owned by the parent would render EMPTY on
 * exactly the tenants with nothing to buy. Visibility and chrome have to be
 * owned by the same component. Neither surface has two cards; test 2 checks
 * both halves.
 *
 * ─── 🔴 THE ONE FILE THIS SLICE COULD NOT CONVERT, AND WHY ──────────────────
 *
 * `PlanUpgradeSection` is left BYTE-IDENTICAL, and that is a reported outcome
 * rather than an oversight. Its sub-640px class layer is pinned byte-for-byte
 * from the card track onward by `PlanUpgradeSection.marketing-card.test.tsx`,
 * against a baseline recorded from `origin/main`. Adding an unprefixed class to
 * anything inside that track — which is what a 44px touch floor on the plan
 * button is — fails that pin, and the only way past it is to RE-RECORD the
 * baseline. That fixture's own comment says re-recording "would fold the toggle
 * into the baseline and quietly make that delta zero": regenerating it
 * SUBSTITUTES the recorded value and destroys what the guard measures, which is
 * STOP condition 6 exactly. So it is reported, not weakened.
 *
 * ⚠️ THE-190 points the same way from the other side: it forbids a blanket 44px
 * floor precisely because 423 sub-44px targets are already shipped and
 * deliberately left alone, and that same suite pins this button's box as
 * `py-2.5 w-full text-sm` with no height token. THE-298's precedent — lift the
 * control you own, REPORT the ones you do not — is what this slice follows: the
 * add-on steppers (~26px) and buy buttons (~32px) and the term segments are
 * lifted; the plan button (~40px) is named here and left.
 *
 *   🔴 OPEN, FOR ITS OWN TICKET: the plan card's Upgrade/Downgrade button is a
 *      ~40px target that charges a card, and PlanUpgradeSection also spells
 *      numbered palette classes. Both need the marketing-card baseline
 *      re-recorded deliberately, which is a ticket, not a side effect.
 *
 * ─── Where the geometry lives ────────────────────────────────────────────────
 *
 * Tests 10, 11 and 12 are NOT here. happy-dom has no layout engine, so they are
 * measured over CDP in real Chromium by `THE-300.billing-surface.layout.test.tsx`.
 */

const ROOT = path.resolve(__dirname, '../../..');
const readSrc = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

/**
 * Source with every comment removed — block, line and JSX.
 *
 * ⚠️ Load-bearing, and both THE-286 and THE-296 learned it the same way: these
 * files DISCUSS what they no longer do. A raw grep fails on the documentation
 * and passes on the defect. Every content sweep below goes through this.
 *
 * 🔴 THE-352 — the three-regex version this replaced was destructive: an
 * opening brace followed by a JSDoc anchors its JSX-comment pattern, which then
 * runs to the first `*\/` that happens to be followed by `}`, deleting every
 * line between. Measured at a 154-line span, 85 lines of it code, on `IntegrationsSection.tsx`. The
 * parser-driven module takes its comment ranges off TypeScript's own parse.
 */
const code = (rel: string): string => stripComments(readSrc(rel));

/** The mount site. */
const BILLING = 'src/components/BillingAndPayments.tsx';
/** The sections it renders, and the toggle one of them owns. */
const PLAN = 'src/components/settings/PlanUpgradeSection.tsx';
const ADDONS = 'src/components/settings/AddOnsSection.tsx';
const TERM = 'src/components/settings/BillingTermToggle.tsx';
/** What this slice actually edited — the scope every "touched" sweep uses. */
const CONVERTED = [ADDONS, TERM] as const;
/** Every section the billing surface renders, converted or not. */
const BILLING_SECTIONS = [PLAN, ADDONS, TERM] as const;

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 — each converted section renders through the shared chrome
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('1 · each converted section renders through the shared chrome without its own styling', () => {
  it.each(CONVERTED)('%s spells no field chrome of its own', (rel) => {
    // The three spellings the unconverted sections repeated by hand — the same
    // list THE-296 used, so "converted" means the same thing on both surfaces.
    for (const spelling of [/focus:ring-gold/, /focus:ring-2\s+focus:ring-gold/, /px-4\s+py-2\.5\s+border/]) {
      expect(code(rel), `${rel} re-spells its own input chrome`).not.toMatch(spelling);
    }
  });

  it('AddOnsSection takes the shared touch floor rather than minting one', () => {
    /**
     * 🔴 SCOPED TO THE FILE THAT NEEDED LIFTING, and the scope is a measured
     * result. `AddOnsSection`'s controls really were under the floor — the
     * steppers ~26px, the buy and commit buttons ~32px — so they take
     * `ICON_BUTTON` and `ACTION_HEIGHT`, imported rather than re-spelled.
     *
     * ⚠️ `BillingTermToggle` is NOT asserted here, and a draft of this ticket
     * wrongly included it. Its segments sit in a `grid-cols-3` track whose
     * default `align-items: stretch` already sizes all three to the tallest:
     * measured at 380px they are 44.75px with an explicit floor and 44.75px
     * without one. A floor there is a class that changes no pixel, so asserting
     * its presence would pin decoration. The segments' real height is measured
     * in the layout suite instead, which is where a property that depends on
     * layout belongs.
     */
    const body = code(ADDONS);
    expect(body, 'AddOnsSection spells no touch floor at all').toMatch(/ACTION_HEIGHT|ICON_BUTTON/);
    expect(readSrc(ADDONS), 'the touch floor was re-derived instead of imported')
      .toMatch(/import\s*\{[^}]*ICON_BUTTON[^}]*\}\s*from\s*['"]\.\/OnboardingSection['"]/);
  });

  it.each(CONVERTED)('%s does not rely on pb-safe, which compiles to nothing', (rel) => {
    expect(code(rel), `${rel} depends on a class this repo does not define`).not.toContain('pb-safe');
  });

  /** ⚠️ THE-312 gave this pin an APPEND PATH — see settings-freeze-register.ts. */
  it('the chrome the billing surface inherits from is itself untouched', () => {
    for (const [rel, digest] of Object.entries(UNTOUCHED.chrome)) {
      expect(freezeFailure(rel, digest), `${rel} changed — this slice reuses the chrome`).toBeNull();
    }
  });

  it('🔴 and the mount site APPLIES the shared nav clearance to its root', () => {
    /**
     * 🔴 THIS ASSERTION REPLACED ONE THAT DID NOT GUARD.
     *
     * The first version asked whether the file CONTAINED the word
     * `NAV_CLEARANCE`. Deleting it from the root element left the `import`
     * line behind, the word was still there, and the guard passed on a page
     * with no clearance at all — the same shape of hole #436 shipped when it
     * checked the Stripe switch as a word rather than as the thing that chooses.
     *
     * So this reads the ROOT ELEMENT and asserts the constant is interpolated
     * INTO it. An unused import now fails.
     */
    const body = code(BILLING);
    const m = /<div className=\{`([^`]*space-y-6[^`]*)`\}>/.exec(body);
    expect(m, "the billing page's root container changed shape").toBeTruthy();
    const rootClass = m![1];
    expect(rootClass, 'the billing page root does not carry the nav clearance')
      .toContain('${NAV_CLEARANCE}');
    expect(rootClass, 'the billing page root lost the page measure').toContain('${FORM_CONTAINER}');

    // 🔴 IMPORTED, not re-spelled. A literal copy of the calc here would be a
    // second definition of the one number THE-286 published.
    expect(readSrc(BILLING), 'the clearance was re-derived instead of imported')
      .toMatch(/import\s*\{[^}]*NAV_CLEARANCE[^}]*\}\s*from\s*['"]\.\/settings\/GivingStatementsSection['"]/);
    expect(body, 'the billing page spells the clearance calc by hand').not.toMatch(/pb-\[calc\(/);
    expect(body, 'the billing page relies on pb-safe, which compiles to nothing').not.toContain('pb-safe');
  });

  it('🔴 …and that assertion is not vacuous — it fails on an unused import', () => {
    // ⚠️ Proven against the exact mutation that defeated the first version:
    // the import stays, the root loses the interpolation.
    const withClearance = '<div className={`${FORM_CONTAINER} space-y-6 ${NAV_CLEARANCE}`}>';
    const without = '<div className={`${FORM_CONTAINER} space-y-6`}>';
    const rootOf = (src: string) => /<div className=\{`([^`]*space-y-6[^`]*)`\}>/.exec(src)?.[1] ?? '';
    expect(rootOf(withClearance)).toContain('${NAV_CLEARANCE}');
    expect(rootOf(without), 'the matcher passes a root with no clearance')
      .not.toContain('${NAV_CLEARANCE}');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2 — 🔴 the claim this slice makes true
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('2 · every section the BILLING surface renders is on the shared chrome', () => {
  /**
   * 🔴 THE CLAIM IS ABOUT A SECTION'S ROOT ELEMENT, NOT ABOUT ANY CARD IT DRAWS.
   *
   * ⚠️ Two ways to get this wrong, and this slice hit both:
   *
   *   · `bg-surface-raised\s+rounded-\w+\s+border` — the adjacency shape
   *     THE-296 used — does NOT see the real card, which is
   *     `bg-surface-raised rounded-2xl p-5 border border-line`: a padding
   *     utility sits between the radius and the border. As a negative guard it
   *     would pass a section that drew exactly the card being forbidden.
   *
   *   · Matching ANY element in the file is too broad in the other direction.
   *     `PlanUpgradeSection` draws three PLAN CARDS, which are content — the
   *     thing the section exists to render — and a sweep over every className
   *     calls that a chrome duplicate. It is not one.
   *
   * So this reads the ROOT element of the component's own `return (` — the
   * element the mount site wraps — and asks whether THAT is a panel card.
   */
  const rootClassOf = (rel: string): string => {
    const body = code(rel);
    // The component's own top-level return: at zero indent inside the function,
    // i.e. exactly two spaces. Nested returns are indented further.
    const at = body.lastIndexOf('\n  return (');
    expect(at, `${rel} has no top-level return to read a root element from`).toBeGreaterThan(-1);
    const m = /<div className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(body.slice(at));
    expect(m, `${rel}'s root element carries no className to read`).toBeTruthy();
    return (m![1] ?? m![2]);
  };

  const isPanelCard = (cls: string): boolean =>
    /\bbg-surface-raised\b/.test(cls)
    && /\brounded-(?:2xl|xl|brand(?:-xl)?)\b/.test(cls)
    && /\bborder\b/.test(cls);

  it('🔴 the mount site is BillingAndPayments, and it renders exactly these sections', () => {
    const body = code(BILLING);
    expect(body, 'PlanUpgradeSection left the billing page').toMatch(/<PlanUpgradeSection\b/);
    expect(body, 'AddOnsSection left the billing page').toMatch(/<AddOnsSection\b/);
    // 🔴 PaymentSection is NOT on this surface and must not arrive on it: it is
    // the donation payout panel, mounted by AdminDonations and AdminFundraising.
    expect(body, 'PaymentSection was mounted onto the billing surface').not.toMatch(/<PaymentSection\b/);
    // The term toggle reaches this surface THROUGH the plan section, not directly.
    expect(code(PLAN), 'the term toggle left the plan section').toMatch(/<BillingTermToggle\b/);
  });

  it('🔴 no section draws a second panel card inside one the mount site already draws', () => {
    // PlanUpgradeSection is wrapped in a card by the page, so it must draw none.
    expect(code(BILLING), 'the page stopped wrapping the plan section in its card')
      .toMatch(/<div className="[^"]*bg-surface-raised[^"]*">\s*<PlanUpgradeSection/);
    expect(isPanelCard(rootClassOf(PLAN)),
      'the plan section draws a card inside the one the page draws').toBe(false);
  });

  it('🔴 …and AddOnsSection owns its card because it owns its own absence', () => {
    // The inverse half, and the reason the accordion rule does not transfer:
    // this section returns null twice, so a card drawn by the parent would be an
    // empty card on exactly the tenants with nothing to buy.
    const body = code(ADDONS);
    expect(isPanelCard(rootClassOf(ADDONS)), 'AddOnsSection stopped drawing its own card').toBe(true);
    expect(body, 'AddOnsSection no longer returns null for a Stripe tenant')
      .toMatch(/processor\s*!==\s*'dodo'[^\n]*return null/);
    expect(body, 'AddOnsSection no longer returns null on an empty catalogue')
      .toMatch(/catalogue\.length === 0\)\s*return null/);
    // And the page must NOT have wrapped it in one meanwhile — that is the
    // double card this invariant exists to forbid.
    expect(code(BILLING), 'the page wrapped AddOnsSection in a card it already draws')
      .not.toMatch(/<div className="[^"]*bg-surface-raised[^"]*">\s*<AddOnsSection/);
  });

  it('🔴 no section on this surface carries the clearance itself — the mount site does', () => {
    // A section carrying it mid-page opens a 120px hole above Payment History
    // instead of clearing the nav at the end of the page.
    for (const rel of BILLING_SECTIONS) {
      expect(code(rel), `${rel} carries the nav clearance mid-page`).not.toContain('NAV_CLEARANCE');
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3 — 🔴 NO MONEY FIELD AUTOSAVES
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('3 · no money field autosaves', () => {
  /** field name → the file that owns it, and the reason text that must name it. */
  const MONEY: ReadonlyArray<readonly [name: string, file: string, needle: RegExp]> = [
    ['plan', PLAN, /plan choice/i],
    ['add-ons', ADDONS, /add-on/i],
    ['billing term', TERM, /term toggle/i],
  ];

  it.each(MONEY)('the %s field is excluded by name, with a reason', (_name, file, needle) => {
    const entries = AUTOSAVE_EXCLUDED.filter((e) => e.file === file);
    expect(entries.length, `${file} is not on the autosave exclusion list`).toBeGreaterThan(0);
    expect(entries.some((e) => needle.test(e.field)), `${file} is listed but not for this field`).toBe(true);
    for (const e of entries) expect(e.why.length, `${file} is listed without a reason`).toBeGreaterThan(60);
  });

  it.each(MONEY)('…and the %s file imports no autosave at all', (_name, file) => {
    // 🔴 A SOURCE SWEEP, not a spot check: this fails whether or not anybody
    // remembers to update the list above.
    const src = readSrc(file);
    expect(src, `${file} imports the autosave hook`).not.toMatch(/from ['"][^'"]*settings\/autosave['"]/);
    expect(src, `${file} calls useAutosaveField`).not.toContain('useAutosaveField');
  });

  it('🔴 the mount site does not autosave on their behalf either', () => {
    // The gap the per-file sweep alone would leave: a parent that wired an
    // autosave around a child excluded by name.
    expect(readSrc(BILLING), 'the billing page imports the autosave hook')
      .not.toMatch(/from ['"][^'"]*settings\/autosave['"]/);
    expect(readSrc(BILLING), 'the billing page calls useAutosaveField').not.toContain('useAutosaveField');
  });

  it('🔴 and the exclusion list still extends THE-286 rather than replacing it', () => {
    // Every file THE-286 and THE-296 put on the list is still on it. This slice
    // ADDS the reasons for its own surface; it removes nothing.
    for (const file of [
      PLAN, ADDONS, TERM,
      'src/components/settings/PaymentSection.tsx',
      'src/components/settings/DomainSection.tsx',
      'src/components/settings/SmsSection.tsx',
      'src/components/settings/IntegrationsSection.tsx',
      'src/components/AdminSettings.tsx',
      'src/components/PersonalInformationModal.tsx',
    ]) {
      expect(AUTOSAVE_EXCLUDED.some((e) => e.file === file), `${file} fell off the exclusion list`).toBe(true);
    }
  });

  it('🔴 no Save bar came back in place of the confirmed action', () => {
    for (const rel of [...BILLING_SECTIONS, BILLING]) {
      expect(code(rel), `${rel} grew a save bar`).not.toMatch(/sticky\s+bottom-0|fixed\s+bottom-0/);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4 — 🔴 a failed save is VISIBLE — no-regression on THE-286
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('4 · a failed save surfaces visibly and does not silently discard the edit', () => {
  const AUTOSAVE = 'src/components/settings/autosave.ts';

  beforeEach(() => { toast.success.mockClear(); toast.error.mockClear(); });
  afterEach(() => { vi.useRealTimers(); });

  it('🔴 the hook still holds an error state, so a fading toast is not the only record', () => {
    const body = code(AUTOSAVE);
    expect(body, 'the durable error state left the hook').toMatch(/setStatus\('error'\)/);
    expect(body, 'the failure no longer raises a toast').toMatch(/toast\.error\(/);
    expect(body, 'the failure toast lost its fixed id').toContain('AUTOSAVE_ERROR_TOAST_ID');
    // 🔴 The copy makes the promise the behaviour keeps.
    expect(body, 'the failure copy stopped promising the edit survives').toMatch(/still here/i);
  });

  it('🔴 RUN, not read: a save that fails AS THE PANEL CLOSES still says so', async () => {
    /**
     * 🔴 THIS TEST REPLACED A GUARD THAT DID NOT GUARD, and the replacement is
     * the whole reason mutation testing is in the brief.
     *
     * The first version of this read the source: it found the `mounted.current`
     * check in the catch arm and asserted the `toast.error` came AFTER it. A
     * planted defect that moved the toast INSIDE the guard —
     *
     *     if (mounted.current) { setStatus('error');
     *       toast.error(…); }
     *
     * — left the ordering exactly as it was and sailed straight through. That is
     * the silent failed save this mechanism exists to prevent, passing the test
     * written to catch it.
     *
     * So it is behavioural now. The scenario is the real one: a field with a
     * queued write, unmounted before the debounce fires. The unmount effect sets
     * `mounted` false and THEN flushes, so a save that rejects afterwards is
     * running with `mounted === false` — exactly the state the defect hides in.
     * The Toaster lives in the root layout and outlives the panel, so the toast
     * must still fire.
     */
    const save = vi.fn().mockRejectedValue(new Error('offline'));

    const Field: React.FC = () => {
      const field = useAutosaveField<string>(save, 'the EIN', { debounceMs: 10_000 });
      React.useEffect(() => { field.prime('before'); }, []);
      return <button onClick={() => field.onChange('after')}>edit</button>;
    };

    const host = document.createElement('div');
    document.body.appendChild(host);
    let root!: Root;
    await act(async () => { root = createRoot(host); root.render(<Field />); });

    // Queue a write that the long debounce will NOT have fired yet.
    await act(async () => {
      host.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(save, 'the debounce fired early — this no longer tests the unmount path')
      .not.toHaveBeenCalled();

    // Close the panel. The unmount flush issues the write with mounted === false.
    await act(async () => { root.unmount(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    host.remove();

    expect(save, 'the queued edit was dropped on unmount — a silent discard')
      .toHaveBeenCalledWith('after');
    expect(toast.error, '🔴 the save failed after unmount and NOTHING was said')
      .toHaveBeenCalledTimes(1);
    const [message, opts] = toast.error.mock.calls[0] as [string, { id: string }];
    expect(opts.id, 'the failure toast lost its fixed id').toBe(AUTOSAVE_ERROR_TOAST_ID);
    expect(message, 'the failure stopped promising the edit survives').toMatch(/still here/i);
    expect(toast.success, 'a failure was reported as a success').not.toHaveBeenCalled();
  });

  it('🔴 the hook still cannot revert the value — the deliberate shape', () => {
    // It does not own the field's state, which is what makes "your change is
    // still here" true rather than a promise the code cannot keep.
    const body = code(AUTOSAVE);
    expect(body, 'the hook grew a way to put the old value back')
      .not.toMatch(/setValue\(|revert\(|restorePrevious/);
  });

  it('🔴 no-regression on THE-286: a failure is never an alert() again', () => {
    // A blocking browser alert is dismissed and then leaves NOTHING — the
    // silent discard the whole mechanism exists to prevent.
    for (const rel of [AUTOSAVE, BILLING, ADDONS, TERM,
                       'src/components/settings/GivingStatementsSection.tsx',
                       'src/components/settings/OnboardingSection.tsx']) {
      expect(code(rel), `${rel} reports a failure through alert() again`).not.toMatch(/\balert\(/);
    }
  });

  it('🔴 REPORTED: two unconverted sections still report through alert()', () => {
    /**
     * ⚠️ THIS IS A FINDING, PINNED — not an exemption written to make a sweep
     * pass. `PlanUpgradeSection` reports a failed plan change with a blocking
     * `alert()`, in five places. That is the exact class of bug THE-286's
     * mechanism was extracted to remove (OnboardingSection had one, and #430
     * replaced it), and it is on the highest-value action on this surface.
     *
     * It is not fixed here for the reason recorded at the head of this file:
     * the file is frozen by a byte-for-byte sub-640px pin whose only escape is
     * re-recording the baseline. Pinning the COUNT means the number cannot grow
     * quietly, and the day someone converts this file the pin fails and has to
     * be removed deliberately.
     *
     * 🔴 It is NOT a silent discard today — each `alert()` carries the server's
     * own message and the plan change is a request that either happened or did
     * not, so nothing typed is lost. It is the wrong surface for the news, not
     * the absence of it.
     */
    for (const [rel, count] of [
      [PLAN, 10],
      // ⚠️ IntegrationsSection too. THE-296 converted its CHROME and its
      // colours; it never claimed to have removed these, and its entry in
      // THE-286's exemption list says so ("NO autosave was added"). Recorded
      // here so the next slice does not discover it the way this one did.
      ['src/components/settings/IntegrationsSection.tsx', 9],
    ] as ReadonlyArray<readonly [string, number]>) {
      expect([...code(rel).matchAll(/\balert\(/g)].length,
        `${rel} grew another blocking alert`).toBe(count);
      // And every one of them says something — an empty alert would be the
      // dismissable nothing this test exists to rule out.
      expect(code(rel), `${rel} left an alert() with no message`).not.toMatch(/\balert\(\s*\)/);
    }
  });

  it('🔴 …and the billing surface reports ITS failures on screen, not only to the console', () => {
    // Every money action on this surface has a rendered failure path. A
    // console.error alone is the silent discard with extra steps.
    expect(code(ADDONS), 'the add-on failure line left the section').toMatch(/current\.message/);
    expect(code(ADDONS), 'the add-on failure lost its retry').toMatch(/Try again/);
    expect(code(BILLING), 'the billing page stopped rendering its load error').toMatch(/\{error &&/);
    expect(code(BILLING), 'the statement failure stopped being rendered').toMatch(/\{genError &&/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5 — 🔴 NOTHING WRITES plan FROM THE CLIENT — no-regression on #434
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('5 · nothing writes plan from the client', () => {
  /**
   * 🔴 THE DETECTOR IS IMPORTED, NOT RE-DERIVED. #434 widened THE-259's sweep
   * after a real violation sat in the gap between two detectors with
   * complementary blind spots — a missing `{ plan }` shorthand and a missing
   * `await import('firebase/firestore')`. Re-writing a narrower one here would
   * re-open exactly that gap, so this uses `planWritesIn` itself.
   */
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(entry)) out.push(path.relative(ROOT, full));
    }
    return out;
  };

  it('🔴 no file on the billing surface writes plan through the client SDK', () => {
    const offenders = [BILLING, ...BILLING_SECTIONS]
      .map((file) => ({ file, offences: planWritesIn(readSrc(file)) }))
      .filter((r) => r.offences.length > 0);
    expect(offenders, 'the webhook is the single writer of plan').toEqual([]);
  });

  it('🔴 …and nowhere else under src/ does either — the sweep is repo-wide', () => {
    const files = walk(path.join(ROOT, 'src'))
      .filter((f) => !f.includes('__tests__') && !f.includes('/test/'));
    const offenders = files
      .map((file) => ({ file, offences: planWritesIn(readSrc(file)) }))
      .filter((r) => r.offences.length > 0);
    expect(offenders).toEqual([]);
  });

  it('🔴 the sweep is not vacuous — it catches a planted write of each spelling', () => {
    // ⚠️ #436 shipped two guards that passed a planted defect. This proves the
    // imported detector still sees all three spellings AND both import styles,
    // so "no offenders" above means something.
    const planted = [
      `import { updateDoc, doc } from 'firebase/firestore';\nawait updateDoc(doc(db,'t',id), { plan: 'pro' });`,
      `import { updateDoc, doc } from 'firebase/firestore';\nawait updateDoc(doc(db,'t',id), { plan });`,
      `const { updateDoc, doc } = await import('firebase/firestore');\nawait updateDoc(ref, { plan });`,
      `import { setDoc } from 'firebase/firestore';\nawait setDoc(ref, { tier: 1, plan: next }, { merge: true });`,
    ];
    for (const src of planted) {
      expect(planWritesIn(src), `the sweep missed:\n${src}`).not.toEqual([]);
    }
    // And it does not fire on the ask-and-re-read path that is CORRECT.
    expect(planWritesIn(`await runDodoPlanChange({ plan: 'pro' }); armPlanRefresh();`)).toEqual([]);
  });

  it('🔴 the plan change still ASKS the server and arms the refresh window', () => {
    const plan = readSrc(PLAN);
    expect(plan, 'the plan change no longer runs through runDodoPlanChange').toContain('runDodoPlanChange');
    expect(plan, 'the THE-217 refresh window is no longer armed').toContain('armPlanRefresh()');
    expect(plan, 'the plan section writes Firestore directly').not.toMatch(/\bupdateDoc\s*\(/);
    expect(plan, 'the plan section writes Firestore directly').not.toMatch(/\bsetDoc\s*\(/);
    // 🔴 And a plan change never became a field change.
    expect(plan, 'a plan change became an onChange').not.toMatch(/onChange=\{[^}]*runDodoPlanChange/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6 — prices go through formatPlanPrice
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('6 · no price literal appears; prices go through formatPlanPrice', () => {
  it('the plan card still renders through formatPlanPrice', () => {
    // ⚠️ The bug shipped once already: monthlyPrice/yearlyPrice literals
    // rendered while formatPlanPrice sat imported and unused two lines away.
    expect(readSrc(PLAN), 'the plan card stopped using formatPlanPrice')
      .toContain('formatPlanPrice(planId, billingPeriod)');
  });

  it('🔴 no file on the billing surface spells a money literal', () => {
    const offenders: string[] = [];
    for (const rel of [BILLING, ...BILLING_SECTIONS]) {
      for (const m of code(rel).matchAll(/\$\d[\d,]*(?:\.\d+)?/g)) offenders.push(`${rel}: ${m[0]}`);
    }
    expect(offenders, 'a price literal is back on the billing surface').toEqual([]);
  });

  it('…and neither does any other section in settings/', () => {
    const dir = path.join(ROOT, 'src/components/settings');
    const offenders: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (!/\.tsx?$/.test(entry)) continue;
      for (const m of code(`src/components/settings/${entry}`).matchAll(/\$\d[\d,]*(?:\.\d+)?/g)) {
        offenders.push(`${entry}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('🔴 the add-on prices are formatted, never composed here', () => {
    const body = code(ADDONS);
    expect(body, 'the add-on price stopped going through its formatter').toContain('formatAddonPrice');
    // The cross-repo price contract throws at module scope during prerender if a
    // second definition of a price appears, so this must stay a read.
    expect(body, 'the add-on section composes a currency string by hand')
      .not.toMatch(/['"`]\s*\$\s*['"`]\s*\+|toFixed\(2\)/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7 — 🔴 the entitlement lift is still `||` — no-regression on THE-253
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('7 · the add-on entitlement lift is still `||`, never assignment', () => {
  const FEATURES = 'src/utils/plan-features.ts';

  it('🔴 aiChat is lifted by disjunction against the owned count', () => {
    expect(code(FEATURES), 'the aiChat lift changed shape')
      .toMatch(/aiChat:\s*base\.aiChat\s*\|\|\s*owned\.aiAssistant\s*>\s*0/);
    expect(code(FEATURES), 'the aiKnowledge lift changed shape')
      .toMatch(/aiKnowledge:\s*base\.aiKnowledge\s*\|\|\s*owned\.aiAssistant\s*>\s*0/);
  });

  it('🔴 …and it is never an ASSIGNMENT — the base can only be raised', () => {
    const body = code(FEATURES);
    // An assignment (`aiChat: owned.aiAssistant > 0`) would REVOKE the
    // capability from a tier that has it in the base matrix.
    expect(body, 'aiChat is assigned from the add-on rather than lifted by it')
      .not.toMatch(/aiChat:\s*owned\.aiAssistant\s*>\s*0/);
    expect(body, 'aiChat is assigned from the add-on rather than lifted by it')
      .not.toMatch(/aiChat:\s*!!\s*owned\./);
  });

  it('🔴 RUN, not read: the lift really behaves as a lift in every direction', () => {
    /**
     * ⚠️ A SOURCE MATCH ALONE IS NOT ENOUGH — it would pass a defect that moved
     * the lift somewhere else, and #436 shipped two guards that a planted defect
     * walked straight through. `getEffectiveFeatures` is where the lift lives
     * (`getPlanFeatures` is the BASE matrix and takes no add-ons at all), so
     * this runs the real one.
     */
    const held = { ...NO_ADDONS, aiAssistant: 1 };

    for (const tier of PLAN_ORDER) {
      const base = getPlanFeatures(tier);
      const none = getEffectiveFeatures(tier, NO_ADDONS);
      const lifted = getEffectiveFeatures(tier, held);

      // 🔴 Holding the add-on ALWAYS grants it, on every tier.
      expect(lifted.aiChat, `${tier} did not gain aiChat from the add-on`).toBe(true);
      expect(lifted.aiKnowledge, `${tier} did not gain aiKnowledge from the add-on`).toBe(true);
      // 🔴 And NOT holding it never takes away what the base tier already had —
      // which is exactly what turning the `||` into an assignment would do.
      expect(none.aiChat, `${tier} lost its base aiChat when no add-on was held`).toBe(base.aiChat);
      expect(none.aiKnowledge, `${tier} lost its base aiKnowledge`).toBe(base.aiKnowledge);
    }

    // 🔴 The lift is not vacuous: there is at least one tier WITHOUT the
    // capability in its base, so "the add-on grants it" is a real claim.
    expect(PLAN_ORDER.filter((t) => !getPlanFeatures(t).aiChat).length,
      'every tier already has aiChat — the lift proves nothing').toBeGreaterThan(0);
  });

  it('🔴 …and WHY the source assertion is the load-bearing one here', () => {
    /**
     * ⚠️ A FINDING, AND IT CHANGES WHICH GUARD PROTECTS THIS.
     *
     * NO TIER IN THE BASE MATRIX HAS `aiChat` TODAY — all four are `false`. So
     * `base.aiChat || owned.aiAssistant > 0` and a bare assignment
     * `owned.aiAssistant > 0` return THE SAME VALUE for every tier and every
     * add-on set that currently exists. The behavioural test above CANNOT tell
     * them apart, and a mutation to assignment would walk straight through it.
     *
     * 🔴 That is precisely the trap #436 fell into twice — a guard that reads
     * like it protects something while the defect it names sails past. So it is
     * stated rather than papered over: what protects the `||` TODAY is the
     * SOURCE assertion in this block, not the behavioural one, and the reason
     * the `||` must survive anyway is that the day a tier ships with `aiChat` in
     * its base, an assignment silently REVOKES it from every tenant on that tier
     * who has not bought the add-on.
     *
     * This test pins the premise. When a tier does gain `aiChat` innately, it
     * fails, and the behavioural guard above becomes the real one — at which
     * point this block should be deleted, not updated.
     */
    const innate = PLAN_ORDER.filter((t) => getPlanFeatures(t).aiChat);
    expect(innate,
      'a tier now has aiChat in its base — the behavioural guard above is now '
      + 'load-bearing, and this premise block should be deleted').toEqual([]);

    // The source assertion therefore has to be exact. Proven not-vacuous by
    // running the matcher against the mutation it exists to catch.
    const LIFT = /aiChat:\s*base\.aiChat\s*\|\|\s*owned\.aiAssistant\s*>\s*0/;
    expect(LIFT.test('aiChat: base.aiChat || owned.aiAssistant > 0'), 'the matcher misses the real lift').toBe(true);
    expect(LIFT.test('aiChat: owned.aiAssistant > 0'), 'the matcher passes a bare assignment').toBe(false);
    expect(LIFT.test('aiChat: !!owned.aiAssistant'), 'the matcher passes a coerced assignment').toBe(false);
    expect(LIFT.test('aiChat: base.aiChat && owned.aiAssistant > 0'), 'the matcher passes a conjunction').toBe(false);
  });

  it('🔴 the add-on section reaches the server and does not grant locally', () => {
    const body = code(ADDONS);
    expect(body, 'the add-on purchase no longer goes through runDodoAddonChange')
      .toContain('runDodoAddonChange');
    expect(body, 'the add-on section writes Firestore directly').not.toMatch(/\b(?:updateDoc|setDoc)\s*\(/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8 — 🔴 the three switched-off sections are still off
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('8 · PaymentSection still renders unavailable; DomainSection is still hidden; SmsSection is still off', () => {
  it('🔴 the Stripe Connect UI is NOT restored (THE-256)', () => {
    const src = readSrc('src/components/settings/PaymentSection.tsx');
    expect(src, 'PaymentSection no longer reads the master switch').toContain('STRIPE_CONNECT_ENABLED');
    expect(src, 'the unavailable state left PaymentSection').toContain('STRIPE_CONNECT_HIDDEN_MESSAGE');
    expect(src, 'the unavailable branch lost its handle').toContain('data-testid="stripe-connect-hidden"');
    // 🔴 THE SWITCH MUST BE WHAT CHOOSES, not merely be mentioned. #436 shipped a
    // Connect check that read the switch as a WORD and passed a planted defect
    // that restored the UI while leaving the import in place. Asserted as the
    // ternary, exactly as #436's fix did.
    expect(src, 'the Connect UI is no longer gated on the master switch')
      .toMatch(/STRIPE_CONNECT_ENABLED\s*\?\s*<StripeConnectPanel\s*\/>\s*:/);
    // ⚠️ The platform account is closed as rejected.fraud.
    expect(readSrc('src/lib/stripe-connect-feature.ts')).toMatch(/STRIPE_CONNECT_ENABLED\s*=\s*false/);
  });

  it('🔴 the custom-domain panel is NOT un-hidden (#428)', () => {
    const src = readSrc('src/components/settings/DomainSection.tsx');
    expect(src, 'DomainSection no longer reads the master switch').toContain('CUSTOM_DOMAIN_ENABLED');
    expect(src, 'the hidden branch lost its handle').toContain('data-testid="custom-domain-hidden"');
    expect(src, 'the panel is no longer gated on the master switch').toMatch(/!CUSTOM_DOMAIN_ENABLED\s*\?/);
    expect(readSrc('src/lib/custom-domain-feature.ts')).toMatch(/CUSTOM_DOMAIN_ENABLED\s*=\s*false/);
  });

  it('🔴 SMS is OFF again (THE-335), and still behind the one switch', () => {
    // ⚠️ THIS ASSERTION WAS REVERSED, NOT LOOSENED. THE-300 pinned SMS as OFF
    // because it was one of three switched-off sections it must not convert.
    // THE-314 flipped the switch and rewrote the panel from a Twilio credential
    // form into the number purchase panel. What THE-300 actually cares about is
    // unchanged and still asserted: the section reads the ONE master switch and
    // renders through it, so the flip stays a single value.
    const src = readSrc('src/components/settings/SmsSection.tsx');
    expect(src, 'SmsSection no longer reads the master switch').toContain('SMS_FEATURE_ENABLED');
    expect(src, 'SmsSection stopped rendering through the switch')
      // ⚠️ THE-327 — the component behind the switch is now the settings
      // SIGNPOST: the number lifecycle moved into the SMS section, and
      // `SmsNumberPanel` is mounted there. What this guard is actually
      // about — that the section renders through the ONE master switch and
      // renders `null` when it is off — is unchanged and still asserted.
      .toMatch(/SMS_FEATURE_ENABLED\s*\?\s*<SmsSettingsPointer\s*\/>\s*:\s*null/);
    // 🔵 FALSE AGAIN AT THE-335. THE-300's claim is unaffected by either flip
    // and is what the two assertions above measure: the section reads the ONE
    // master switch and renders through it. Only the switch's VALUE moves.
    expect(readSrc('src/lib/sms-feature.ts')).toMatch(/SMS_FEATURE_ENABLED\s*=\s*false/);
    // 🔴 And the OTHER two switches this file guards are still off, which is the
    // half that had nothing to do with SMS and must not have moved with it.
    expect(readSrc('src/lib/stripe-connect-feature.ts')).toMatch(/STRIPE_CONNECT_ENABLED\s*=\s*false/);
    expect(readSrc('src/lib/custom-domain-feature.ts')).toMatch(/CUSTOM_DOMAIN_ENABLED\s*=\s*false/);
  });

  it('🔴 the two STILL-OFF sections are byte-identical — this slice converted none of them', () => {
    // ⚠️ SmsSection LEFT THIS LIST — THE-314 rewrote it, deliberately and for a
    // reason recorded in that ticket. The list is narrowed rather than repinned:
    // the claim "a switched-off section is not convertible" is still exactly
    // true of the two sections that are still switched off, and quietly
    // re-recording SmsSection's digest would have substituted the value this
    // guard measures instead of removing a file that no longer qualifies.
    for (const file of ['src/components/settings/PaymentSection.tsx',
                        'src/components/settings/DomainSection.tsx']) {
      // THE-362 folds ONE heading out of PaymentSection before hashing - see
      // `__fixtures__/the-362-payment-section-fold.ts` for why the SHARED
      // baseline is left untouched rather than re-recorded across eight suites.
      const now = file.endsWith('PaymentSection.tsx')
        ? foldedPaymentSectionDigest(readFileSync(path.join(ROOT, file), 'utf8'))
        : sha256(readFileSync(path.join(ROOT, file)));
      expect(now, `${file} changed — a switched-off section is not convertible`)
        .toBe(UNTOUCHED.otherSettingsSections[file as keyof typeof UNTOUCHED.otherSettingsSections]);
    }
  });

  it('🔴 …and the billing surface did not mount any of them', () => {
    const body = code(BILLING);
    for (const tag of ['PaymentSection', 'DomainSection', 'SmsSection']) {
      expect(body, `${tag} was mounted onto the billing surface`).not.toMatch(new RegExp(`<${tag}\\b`));
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 9 — 🔴 no plan cap changed
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('9 · no plan cap changed', () => {
  it('the nine plan prices are exactly what they were', () => {
    // ⚠️ Client-side plan caps are the SETTLED POSITION — course-adoption.ts:36
    // records it and THE-207/THE-55 closed as won't-fix. Nothing here reopens it.
    expect(PLAN_PRICING).toEqual({
      plus: { monthly: 20, quarterly: 54, yearly: 190 },
      pro: { monthly: 40, quarterly: 108, yearly: 380 },
      // ⚠️ THE-343 repriced Ministry ($80→$60, with the quarter and year
      // following at the same 10% / >20% discounts). `plus` and `pro` are
      // enumerated so a reprice that overreached its brief still fails here.
      max: { monthly: 60, quarterly: 162, yearly: 564 },
    });
  });

  it('🔴 every numeric cap on every tier is unchanged', () => {
    // Pinned as a LITERAL rather than re-derived from the module: a baseline a
    // guard computes for itself at assertion time cannot fail — it only
    // describes whatever it was handed. Recorded from origin/main at 77da58d.
    //
    // 🔴 RE-TRANSCRIBED AT THE-370, which is a deliberate CAP CHANGE and the
    // only thing that has moved these numbers: `maxContacts` 150 → 500,
    // 500 → 2,000 and 2,000 → 4,000, and `maxChurches` 1 → -1 (UNLIMITED_CAP)
    // on the three paid tiers, with the campus add-on retired. `maxAdmins` did
    // NOT move, and free's row is byte-identical — which is what this guard
    // still protects for THE-300's own subject, the billing surface.
    const caps = (PLAN_ORDER as readonly string[]).map((tier) => {
      const f = getPlanFeatures(tier as never);
      return `${tier}|${f.maxAdmins}|${f.maxChurches}|${f.maxContacts}`;
    });
    expect(caps, 'a plan cap moved — THE-207/THE-55 closed as won\'t-fix').toEqual([
      'free|1|0|500',
      'plus|2|-1|500',
      'pro|5|-1|2000',
      'max|15|-1|4000',
    ]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 13 — the structure AdminSettings.regroup pins still holds
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("13 · AdminSettings.regroup.test.tsx's structural assertions still hold", () => {
  it('🔴 this slice did not touch AdminSettings or its suite', () => {
    // ⚠️ #434 had to delete two no-op stubs in that suite when it removed two
    // required props. This slice removes no prop and adds none, so BOTH the
    // component and its suite are byte-identical — the strongest available form
    // of "its structural assertions still hold", and it needs no re-run here.
    //
    // 🔴 Pinned against LITERALS recorded from origin/main at 77da58d, not
    // against each other: a digest compared to itself asserts nothing.
    //
    // ⚠️ THE-312 gave BOTH pins an APPEND PATH. The literals below are still the
    // baselines recorded from origin/main at 77da58d and are not replaced; a
    // later ticket appends its own digest with its ticket and reason.
    //
    // 🔴 The SECOND pin is why this mattered most: pinning the suite's own bytes
    // with "this slice must not weaken it" meant tests could not even be ADDED
    // to it. They can now — the addition is recorded rather than forbidden — and
    // the thing the pin actually protects (regroup's 10-class allowlist and its
    // structural assertions) is asserted by content in THE-312's suite.
    expect(
      freezeFailure(
        'src/components/AdminSettings.tsx',
        'fa75caa9825fd36b1d12ae3472405e005469abe282bd2e26b1177ae6bd7885d9',
      ),
      'AdminSettings changed — re-read what #434 did before touching its suite',
    ).toBeNull();
    expect(
      freezeFailure(
        'src/components/__tests__/AdminSettings.regroup.test.tsx',
        '21c298f212d32cb93f66d41fb5a5d3804712c2a571c5ad482acd11b2edda9784',
      ),
      'AdminSettings.regroup.test.tsx changed — this slice must not weaken it',
    ).toBeNull();
    // AdminSettings still imports the accordion and none of the billing sections.
    const src = readSrc('src/components/AdminSettings.tsx');
    expect(src, 'AdminSettings stopped mounting the accordion').toContain('SettingsAccordion');
    for (const tag of ['PlanUpgradeSection', 'AddOnsSection', 'PaymentSection']) {
      expect(src, `AdminSettings started mounting ${tag}`).not.toMatch(new RegExp(`<${tag}\\b`));
    }
    // And the SMS row stays hidden with its switch (THE-250).
    expect(src, 'the SMS row stopped following its switch').toMatch(/hidden:\s*!SMS_FEATURE_ENABLED/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 14 — colour, emoji, palettes
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('14 · no colour hardcoded, no emoji; both palettes resolve — Classic first', () => {
  /**
   * ⚠️ SCOPED TO WHAT THIS SLICE TOUCHED, exactly as THE-286 scoped its own.
   * `PlanUpgradeSection` and the mount site's status pills carry numbered
   * palette classes that predate this ticket; converting them means re-recording
   * the marketing-card baseline, which is reported at the head of this file and
   * is its own ticket. A blanket sweep here would either fail on shipped code or
   * have to be weakened to pass — neither is a guard.
   */
  const TOUCHED = [...CONVERTED, BILLING] as const;

  it.each(CONVERTED)('%s hardcodes no colour', (rel) => {
    expect(code(rel), `${rel} hardcodes a colour`)
      .not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d|hsla?\(\s*\d/);
    expect(code(rel), `${rel} spells a numbered palette class`)
      .not.toMatch(/\b(?:text|bg|border|hover:bg|hover:text|divide)-(?:red|green|blue|yellow|amber|emerald|slate|gray|grey|zinc|stone|orange|purple)-\d{2,3}\b/);
  });

  it.each(TOUCHED)('%s uses no emoji as UI', (rel) => {
    const EMOJI = /[\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F000}-\u{1FAFF}]/u;
    const found = code(rel).match(EMOJI);
    expect(found, `${rel} renders ${found?.[0]} as UI`).toBeNull();
  });

  it('🔴 the sweep is not vacuous — the classes it rules out are spellable', () => {
    // ⚠️ #436 shipped guards that passed a planted defect. This proves the
    // matcher fires on exactly what was removed from these two files.
    const NUMBERED = /\b(?:text|bg|border)-(?:red|green|amber|stone)-\d{2,3}\b/;
    for (const planted of ['text-green-600', 'bg-green-50', 'border-amber-100', 'text-amber-700']) {
      expect(NUMBERED.test(planted), `the matcher does not see ${planted}`).toBe(true);
    }
    expect(NUMBERED.test('text-gold'), 'the matcher fires on a token').toBe(false);
    expect(NUMBERED.test('bg-surface-chip'), 'the matcher fires on a token').toBe(false);
  });

  it('every colour these files DO spell is a token both palettes define — Classic first', () => {
    const globals = readSrc('src/app/globals.css');
    // Classic is the default since #409, so it is the one asserted first.
    for (const p of ['classic', 'harvest', 'light', 'dark']) {
      expect(globals.toLowerCase(), `the ${p} palette is gone`).toContain(p);
    }
    // The tokens this slice's files newly name. Every one already exists —
    // this slice defines none.
    for (const token of ['--surface-chip', '--c-danger-tint', '--ink-danger-strong', '--brand-color']) {
      expect(globals, `${token} is not defined — this slice must not define it`).toContain(token);
    }
  });

  it('🔴 this slice minted no new component and no new token', () => {
    // STOP condition 7. The touch floor and the clearance are IMPORTED from the
    // sections that already publish them; nothing new was added to form-layout.
    expect(readSrc(ADDONS), 'AddOnsSection re-spelled the touch floor')
      .toMatch(/import\s*\{[^}]*ACTION_HEIGHT[^}]*\}\s*from\s*['"]\.\/OnboardingSection['"]/);
    expect(code('src/components/layout/form-layout.ts'), 'a token was added to form-layout')
      .not.toMatch(/TOUCH_FLOOR|NAV_CLEARANCE|ADDON_/);
    // The density module is byte-identical: no rule was added, removed or moved.
    expect(Object.keys(CONTROL_DENSITY).sort()).toEqual(
      ['action', 'columnGap', 'control', 'fieldGap', 'labelGap', 'rowGap', 'sectionGap'],
    );
    // 🔴 Rule 4's 38px is DELIBERATELY under the touch floor and stays that way.
    expect(DENSITY_PX.control, "Rule 4's control height moved").toBe(38);
    expect(DENSITY_PX.control, 'the desktop control was pushed to the touch floor').toBeLessThan(44);
    expect(DESKTOP_CONTROL_MAX_PX, 'the desktop density cap was raised').toBe(40);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 15 — the blast radius
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('15 · layout.tsx, firestore.rules and functions/ are byte-identical', () => {
  /**
   * 🔴 THE-325 · the accepted SET moved to `__fixtures__/ownership/`, the
   * ASSERTION stayed here. This suite still says what it always said: the
   * `firestore.rules` on disk is at a digest some ticket recorded, and so
   * THIS ticket did not touch a file that auto-deploys to production with no
   * emulator test in CI. Only the list of accepted values is now shared, so
   * a legitimate rules change is one new record rather than 53 edits.
   */
  it('firestore.rules is untouched', () => {
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
  });

  it.each(Object.entries(UNTOUCHED.rulesAndFunctions))('%s is untouched', (rel, digest) => {
    expect(sha256(readFileSync(path.join(ROOT, rel))), `${rel} changed — it is out of bounds for this slice`)
      .toBe(digest);
  });

  it('🔴 src/app/layout.tsx was not opened', () => {
    // Pinned from origin/main at 77da58d, where this branch started. A literal,
    // not a value re-derived at assertion time.
    expect(sha256(readFileSync(path.join(ROOT, 'src/app/layout.tsx'))))
      .toBe('b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f');
  });

  it('the ten settings sections this slice did NOT touch are byte-identical', () => {
    const edited = new Set<string>(CONVERTED);
    // OnboardingSection and IntegrationsSection were edited by THE-296, which is
    // already recorded in that ticket's own exemption list.
    edited.add('src/components/settings/OnboardingSection.tsx');
    edited.add('src/components/settings/IntegrationsSection.tsx');
    // SmsSection was rewritten by THE-314 — the Twilio credential form became
    // the number purchase panel — and is recorded in that ticket's entry on
    // THE-286's exemption list, which is where a settings-section rewrite is
    // registered.
    edited.add('src/components/settings/SmsSection.tsx');
    // BrandingSection's live colour picker was corrected by THE-111 — it wrote
    // `--brand-color` alone, leaving the two DERIVED accent properties at the
    // value the server computed from the previous hex — and is recorded in that
    // ticket's entry on THE-286's exemption list, which is where a
    // settings-section edit is registered.
    edited.add('src/components/settings/BrandingSection.tsx');
    for (const [rel, digest] of Object.entries(UNTOUCHED.otherSettingsSections)) {
      if (edited.has(rel)) continue;
      // THE-362 folds ONE heading out of PaymentSection before hashing - see
      // `__fixtures__/the-362-payment-section-fold.ts`.
      const now = rel.endsWith('PaymentSection.tsx')
        ? foldedPaymentSectionDigest(readFileSync(path.join(ROOT, rel), 'utf8'))
        : sha256(readFileSync(path.join(ROOT, rel)));
      expect(now, `${rel} changed`).toBe(digest);
    }
  });

  it('🔴 PlanUpgradeSection in particular is byte-identical — reported, not converted', () => {
    // See the head of this file: its sub-640px layer is pinned byte-for-byte from
    // the card track onward, and the only way to lift its 40px plan button is to
    // RE-RECORD that baseline, which substitutes the value the guard measures.
    expect(sha256(readFileSync(path.join(ROOT, PLAN))), 'PlanUpgradeSection changed')
      .toBe(UNTOUCHED.otherSettingsSections[PLAN as keyof typeof UNTOUCHED.otherSettingsSections]);
  });
});
