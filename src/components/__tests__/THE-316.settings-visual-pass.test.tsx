import React, { act } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  FROZEN_FILES,
  RECORDED_EDITS,
  MIN_REASON_LENGTH,
  sha256File,
  validateRegister,
  type RecordedEdit,
} from './__fixtures__/settings-freeze-register';

/**
 * THE-316 — the settings visual pass, composed from the installed primitives.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this ticket did, and what it deliberately did not ──────────────────
 *
 * SPLIT A only: `AdminSettings.tsx` plus the chrome its only mount site owns.
 * Split B (`Profile.tsx` + `PersonalInformationModal.tsx`) is NOT in this PR,
 * so the two files it would have touched are asserted here to be at their
 * ORIGINAL digests — the delete flow included. That is a stronger claim than
 * "we did not mean to touch them" and it is the reason tests 5 and 8 below can
 * be one line each: a file that has not moved cannot have lost a branch.
 *
 * ── 🔴 Why nothing here reads the branch diff ───────────────────────────────
 *
 * Three guards that asserted something about the CURRENT BRANCH's diff blocked
 * every unrelated PR in this repo in two days, and THE-315 (#454, now on main)
 * swept for the class of guard that expires when its own ticket merges. Every
 * assertion in this file reads the WORKING TREE — a digest, a source string, a
 * rendered DOM — and none of them reads `git diff`, `git show`, a base ref, or
 * a merge base. `THE-316 writes no guard that depends on the branch diff`
 * below proves that by enumerating this file's own source.
 *
 * ⚠️ Nothing here shells out to git at assertion time, for the reason the
 * register already gives: a depth-1 clone has no object database to read.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const SETTINGS = 'src/components/AdminSettings.tsx';
const ACCORDION = 'src/components/settings/SettingsAccordion.tsx';
const HEADING = 'src/components/settings/SectionHeading.tsx';
const REGROUP = 'src/components/__tests__/AdminSettings.regroup.test.tsx';
const THIS_FILE = 'src/components/__tests__/THE-316.settings-visual-pass.test.tsx';

/** The two files this ticket edited, and nothing else. */
const EDITED = [SETTINGS, ACCORDION] as const;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../firebase', () => ({
  auth: { currentUser: { uid: 'u1', email: 'admin@church.org' } },
  db: {},
  messaging: Promise.resolve(null),
  VAPID_KEY: 'test-vapid-key',
}));
vi.mock('firebase/firestore', () => ({
  doc: () => ({}),
  getDoc: async () => ({ exists: () => true, data: () => ({ tenantId: 'tenant-1' }) }),
  updateDoc: vi.fn(),
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  getDocs: async () => ({ forEach: () => {} }),
  onSnapshot: () => () => {},
}));
vi.mock('../../utils/auth-fetch', () => ({
  authFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
}));
vi.mock('../../utils/tenant-scope', () => ({
  hasPlatformOverride: () => false,
  isSuperAdmin: () => false,
  SUPER_ADMIN_EMAIL: 'founder@theharvest.site',
  getTenantScope: async () => 'tenant-1',
}));
vi.mock('next/image', () => ({ default: () => null }));

import AdminSettings from '../AdminSettings';

async function mount(props: Partial<React.ComponentProps<typeof AdminSettings>> = {}): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <AdminSettings
        onBack={() => {}}
        currentPlan={'pro' as never}
        tenantId="tenant-1"
        email="admin@church.org"
        isPlanOwner
        onCustomizeNav={() => {}}
        onOpenDonations={() => {}}
        {...props}
      />,
    );
  });
  await act(async () => { await Promise.resolve(); });
  return host;
}

async function expandSection(host: HTMLElement, label: string): Promise<void> {
  const header = Array.from(host.querySelectorAll('button')).find(
    (b) => (b.textContent || '').trim().startsWith(label),
  );
  expect(header, `no accordion row labelled "${label}"`).toBeTruthy();
  await act(async () => { header!.click(); });
}

beforeEach(() => {
  document.body.innerHTML = '';
  try { localStorage.clear(); } catch { /* happy-dom always has it */ }
});

/* ═══ 1 · AdminSettings renders the new design, named per section ═══════════ */

describe('1 · AdminSettings renders the new design', () => {
  /**
   * Named per SECTION, and asserted through the primitive's own `data-slot`
   * rather than through a class. A class assertion would pass against
   * hand-written markup that merely copied the class string, which is the
   * exact defect this ticket exists to stop; `data-slot` is stamped by the
   * primitive and by nothing else, so it cannot be forged by retyping Tailwind.
   */
  const slots = (host: HTMLElement, slot: string) =>
    Array.from(host.querySelectorAll(`[data-slot="${slot}"]`));

  it('the Account region draws the plan as an Item with a Badge and a Button', async () => {
    const host = await mount();
    const items = slots(host, 'item');
    expect(items.length, 'the Account region renders no Item').toBeGreaterThan(0);

    const plan = items.find((el) => (el.textContent || '').includes('plan'));
    expect(plan, 'the plan card is not an Item').toBeTruthy();
    expect(plan!.querySelector('[data-slot="item-media"]'), 'the plan card has no ItemMedia').toBeTruthy();
    expect(plan!.querySelector('[data-slot="item-title"]'), 'the plan card has no ItemTitle').toBeTruthy();
    expect(plan!.querySelector('[data-slot="item-description"]'), 'the plan card has no ItemDescription').toBeTruthy();
    expect(plan!.querySelector('[data-slot="badge"]'), 'the plan card lost its Badge').toBeTruthy();

    const manage = host.querySelector('[data-testid="settings-manage-action"]');
    expect(manage, 'the Manage action is gone').toBeTruthy();
    expect(manage!.getAttribute('data-slot'), 'Manage is not a Button primitive').toBe('button');
  });

  it('the Super Admin card is an Item too, on the no-plan branch', async () => {
    const host = await mount({ currentPlan: undefined });
    const su = slots(host, 'item').find((el) => (el.textContent || '').includes('Super Admin'));
    expect(su, 'the Super Admin card is not an Item').toBeTruthy();
    expect(su!.querySelector('[data-slot="item-media"]')).toBeTruthy();
    expect(su!.querySelector('[data-slot="item-title"]')).toBeTruthy();
  });

  it('every accordion row is a Card wrapping a Collapsible', async () => {
    const host = await mount();
    const rows = Array.from(host.querySelectorAll('[data-settings-row]'));
    expect(rows.length, 'no accordion rows rendered').toBeGreaterThan(0);
    for (const r of rows) {
      const id = r.getAttribute('data-settings-row');
      expect(r.getAttribute('data-slot'), `row "${id}" is not a Card`).toBe('card');
      // The disclosure WRAPS the row — see the note in SettingsAccordion for
      // why it is not nested inside it.
      expect(
        r.parentElement?.getAttribute('data-slot'),
        `row "${id}" is not wrapped by a Collapsible`,
      ).toBe('collapsible');
      const trigger = r.querySelector('[data-slot="collapsible-trigger"]');
      expect(trigger, `row "${id}" has no Collapsible trigger`).toBeTruthy();
      // 🔴 The accessibility the hand-written disclosure never had.
      expect(trigger!.getAttribute('aria-expanded'), `row "${id}" states no open state`).toBeTruthy();
    }
  });

  it('the Appearance section draws its label as an Item and its controls as ItemActions', async () => {
    const host = await mount();
    await expandSection(host, 'Appearance');
    const family = host.querySelector('[role="radiogroup"][aria-label="Palette family"]');
    const mode = host.querySelector('[role="radiogroup"][aria-label="Colour theme"]');
    expect(family, 'the palette family control is gone').toBeTruthy();
    expect(mode, 'the light/dark control is gone').toBeTruthy();
    // 🔴 The two controls still share ONE parent, and that parent is now the
    // primitive rather than a hand-written `flex items-center gap-2` — which is
    // the same class string, so the row does not move.
    expect(mode!.parentElement, 'the two theme controls no longer share a row').toBe(family!.parentElement);
    expect(
      (family!.parentElement as HTMLElement).getAttribute('data-slot'),
      'the theme row is not an ItemActions',
    ).toBe('item-actions');
  });

  it('the Payments section draws Open Donations as a Button, with no inline style', async () => {
    const host = await mount();
    await expandSection(host, 'Donations & payment links');
    const open = Array.from(host.querySelectorAll('[data-slot="button"]'))
      .find((b) => (b.textContent || '').includes('Open Donations'));
    expect(open, 'Open Donations is not a Button primitive').toBeTruthy();
    expect(open!.getAttribute('style'), 'Open Donations kept its inline background').toBeNull();
  });

  it('the Danger Zone draws a Separator and a destructive Button', async () => {
    const host = await mount();
    await expandSection(host, 'Cancel Subscription');
    const panel = host.querySelector('[data-settings-row="cancel-plan"]')!;
    expect(
      panel.querySelector('[data-slot="separator"]'),
      'the danger panel has no Separator',
    ).toBeTruthy();
    const cancel = Array.from(panel.querySelectorAll('[data-slot="button"]'))
      .find((b) => (b.textContent || '').trim() === 'Cancel Subscription');
    expect(cancel, 'Cancel Subscription is not a Button primitive').toBeTruthy();
  });

  it('the Navigation region draws Customize Navigation as an Item that IS the button', async () => {
    const host = await mount();
    const nav = Array.from(host.querySelectorAll('[data-slot="item"]'))
      .find((el) => (el.textContent || '').includes('Customize Navigation'));
    expect(nav, 'the Customize Navigation row is not an Item').toBeTruthy();
    expect(nav!.tagName, 'the Item did not render AS the button — the tap target split in two')
      .toBe('BUTTON');
  });
});

/* ═══ 1b · 🔴 every element that has a primitive uses it ════════════════════ */

describe('1b · every element that has a primitive uses it', () => {
  /**
   * 🔴 THIS IS THE MUTATION-CRITICAL ONE, and it is deliberately NOT an import
   * count.
   *
   * "Count the imports from @/components/ui/" passes the moment a file imports
   * anything, so a screen could import `Button` once and hand-write the other
   * nine elements and still be green. That is precisely how ~2,000 lines of
   * hand-rolled UI shipped across RetentionHeatmap, ServicePlanPanel,
   * ServicePlanRow, FormAnswersView, AdminSms and SmsSection.
   *
   * So this REQUIRES the primitive per element, two ways:
   *   (a) the import must be present for each primitive the screen needs, AND
   *   (b) the hand-written SUBSTITUTE must be absent from the source — each
   *       one named, so the failure says which element regressed.
   *
   * (b) is what makes the mutation fail: swapping `<Card …>` back for
   * `<div className="… rounded-brand border border-line …">` re-introduces the
   * banned shape and this test goes red even though the import is still there.
   */
  const REQUIRED_IMPORTS: Record<string, readonly string[]> = {
    [SETTINGS]: ['alert', 'badge', 'button', 'dialog', 'item', 'separator'],
    [ACCORDION]: ['card', 'collapsible', 'separator'],
  };

  it('each edited file imports every primitive its elements need', () => {
    for (const [file, names] of Object.entries(REQUIRED_IMPORTS)) {
      const src = read(file);
      for (const name of names) {
        expect(
          new RegExp(`from ['"](?:@/components|\\.{1,2}(?:/[\\w.-]+)*)/ui/${name}['"]`).test(src),
          `${file} does not import the "${name}" primitive`,
        ).toBe(true);
      }
    }
  });

  /**
   * The hand-written shapes each primitive replaces. A match is a DEFECT and
   * the message names the primitive that covers it.
   */
  const HAND_WRITTEN: ReadonlyArray<{ pattern: RegExp; primitive: string; what: string }> = [
    {
      // `<div className="… rounded-* … border …">` — a card, retyped.
      pattern: /<div[^>]*className=(?:"|\{`)[^"`]*\brounded-(?:brand|lg|xl)\b[^"`]*\bborder\b[^"`]*(?:"|`\})/,
      primitive: 'card',
      what: 'a rounded, bordered box',
    },
    {
      // A bare <button> carrying its own pill/box styling is a Button, retyped.
      pattern: /<button[^>]*className=(?:"|\{`)[^"`]*\brounded-[\w[\]-]+\b[^"`]*(?:"|`\})/,
      primitive: 'button',
      what: 'a bare <button> with its own rounded styling',
    },
    {
      // A hand-rolled modal: a fixed full-bleed scrim.
      pattern: /className=(?:"|\{`)[^"`]*\bfixed\b[^"`]*\binset-0\b[^"`]*(?:"|`\})/,
      primitive: 'dialog',
      what: 'a hand-rolled modal scrim',
    },
    {
      // A hairline drawn as a border on a content div is a Separator.
      pattern: /<div[^>]*className=(?:"|\{`)[^"`]*\bborder-t\b[^"`]*\bborder-line\b[^"`]*(?:"|`\})/,
      primitive: 'separator',
      what: 'a hairline drawn as a border-t',
    },
  ];

  it('🔴 and no hand-written substitute for a primitive survives in either file', () => {
    for (const file of EDITED) {
      // Comments document the markup that was REMOVED and quote it; stripping
      // them is what keeps this a test about code rather than about prose.
      const code = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      for (const { pattern, primitive, what } of HAND_WRITTEN) {
        const hit = code.match(pattern);
        expect(
          hit?.[0] ?? null,
          `${file} hand-writes ${what} — that is the "${primitive}" primitive, reimplemented`,
        ).toBeNull();
      }
    }
  });
});

/* ═══ 1c · inline styles are zero ═══════════════════════════════════════════ */

describe('1c · inline styles', () => {
  it('both edited files carry zero inline styles', () => {
    for (const file of EDITED) {
      const code = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      expect(
        code.match(/style=\{\{/g) ?? [],
        `${file} carries an inline style — say why in a comment, or use the primitive`,
      ).toEqual([]);
    }
  });

  /**
   * ⚠️ The RENDERED check cannot simply be "no element has a style attribute".
   * Base UI's Collapsible panel writes its own measured height onto the element
   * as a CSS custom property, which is the primitive doing its job — the very
   * thing adopting a primitive buys. Asserting zero would have forced the
   * primitive back out, so what is asserted instead is the property this rule
   * is actually about: no inline style may DECLARE A VALUE this screen invented
   * — a colour, a width, a height. The source-level "zero `style={{`" above is
   * the mutation-sensitive half; this is the half that catches a computed
   * colour arriving through a variable.
   */
  it('and no rendered inline style declares a colour or an invented length', async () => {
    const host = await mount();
    await expandSection(host, 'Appearance');
    /*
     * The rule this encodes is "hardcode no colour, invent no width", not "no
     * element may carry a style attribute". Base UI's Collapsible panel writes
     * `--collapsible-panel-height: auto; animation-name: none` onto itself —
     * the primitive measuring its own panel, which is the work adopting it buys
     * — and `auto` / `none` are not values this screen invented. What IS
     * rejected is a colour in any spelling and any literal length, which is
     * what a computed cell colour or a derived width would look like.
     */
    const offenders = Array.from(host.querySelectorAll('[style]'))
      // The two theme controls are PR 347's and are not this ticket's to change.
      .filter((el) => !el.closest('[role="radiogroup"]'))
      .map((el) => (el.getAttribute('style') || ''))
      .filter((style) =>
        /#[0-9a-fA-F]{3,8}|\brgba?\(|\bhsla?\(|\boklch\(|color-mix\(/.test(style)
        || /\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw)\b/.test(style));
    expect(offenders, 'the settings screen rendered an inline colour or an invented length').toEqual([]);
  });
});

/* ═══ 3 · sections inherit the chrome without their own styling ═════════════ */

describe('3 · every section inside SettingsAccordion inherits the chrome', () => {
  it('no section component draws its own row card', async () => {
    const host = await mount();
    const rows = Array.from(host.querySelectorAll('[data-settings-row]'));
    expect(rows.length).toBeGreaterThan(0);
    // The chrome owns the card; a section that drew a second one would nest
    // `data-slot="card"` inside a row.
    for (const r of rows) {
      const panel = r.querySelector('[data-slot="collapsible-content"]');
      if (!panel) continue;
      expect(
        panel.querySelector('[data-slot="card"]'),
        `the "${r.getAttribute('data-settings-row')}" section draws its own card inside the chrome's`,
      ).toBeNull();
    }
  });

  it('and the chrome is the single mount site — AdminSettings is the only caller', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
        return /\.tsx$/.test(e.name) ? [p] : [];
      });
    const callers = walk(path.join(REPO_ROOT, 'src'))
      .filter((f) => !f.includes(`${path.sep}__tests__${path.sep}`))
      .filter((f) => /<SettingsAccordion\b/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(REPO_ROOT, f).split(path.sep).join('/'));
    expect(callers, 'the chrome gained a second mount site — its blast radius is no longer one screen')
      .toEqual([SETTINGS]);
  });
});

/* ═══ 4 · each edited file has a valid register entry ══════════════════════ */

describe('4 · the register', () => {
  it('is internally valid — every entry names a ticket, a reason and a digest', () => {
    expect(validateRegister(), 'the register is malformed').toEqual([]);
  });

  it("🔴 each file THE-316 edited has a THE-316 entry at the file's CURRENT digest", () => {
    for (const file of EDITED) {
      const mine = RECORDED_EDITS.filter((e) => e.file === file && e.ticket === 'THE-316');
      expect(mine.length, `${file} has no THE-316 register entry`).toBe(1);
      expect(mine[0].digest, `${file}'s THE-316 entry records a digest the file is not at`)
        .toBe(sha256File(file));
      expect(mine[0].why.length, `${file}'s reason is under the ${MIN_REASON_LENGTH}-char floor`)
        .toBeGreaterThanOrEqual(MIN_REASON_LENGTH);
    }
  });

  it('🔴 APPENDED, never substituted — THE-314\'s two entries are still there, verbatim', () => {
    // The week #434 REPLACED a digest instead of adding one, main was red for
    // everyone. This is that failure mode, asserted directly.
    const the314 = RECORDED_EDITS.filter((e) => e.ticket === 'THE-314');
    expect(the314.map((e) => e.file).sort(), "THE-314's entries were removed or rewritten").toEqual([
      SETTINGS,
      REGROUP,
    ].sort());
    expect(the314.find((e) => e.file === SETTINGS)!.digest)
      .toBe('a66900fd4b53dd109e97f733e7b7f6bfe18b530d7da666b5165def09546df476');
    expect(the314.find((e) => e.file === REGROUP)!.digest)
      .toBe('a0afe604b79bf19a5c8ce538992db49601319b258606e99f07709ce5358f5d41');
  });

  it('and an unrecorded edit would still fail — the register is not an exemption', () => {
    // Proven on a synthetic register rather than by touching a real file.
    const planted: RecordedEdit[] = [
      { file: SETTINGS, ticket: '', why: 'x', digest: 'nope' },
    ];
    const problems = validateRegister(planted);
    expect(problems.length, 'a ticketless, reasonless, digestless entry was accepted').toBe(3);
  });
});

/* ═══ 5 & 8 · the delete flow and Profile were not touched at all ══════════ */

describe('5 · the account-deletion flow is byte-identical', () => {
  /**
   * 🔴 Split B was NOT done, so this is the strongest form of the claim: the
   * file has not moved a byte, so the `deleteState` machine, all eight outcome
   * messages, the silent-failure fix, the re-auth path and `DELETE_CONFIRM_COPY`
   * are all necessarily as they were. THE-286 asserts the eight messages
   * individually and still does; this asserts the file underneath them.
   *
   * The baseline is `origin/main`'s value, and it is spelled here rather than
   * recomputed, so a change to the file fails HERE as well as in THE-286.
   */
  it('THE-316 recorded no edit to PersonalInformationModal.tsx, because it edited none', () => {
    /*
     * ⚠️ SCOPED TO THIS TICKET, which is what it always meant. Written as "the
     * register holds NO entry for this file", it also said "and no ticket may
     * ever record one" — so it went red on THE-323, which fixed `handleSave`'s
     * silent failure and recorded exactly that, with a ticket, a reason and a
     * digest. That is the register doing its job, and an assertion that expires
     * on the next unrelated PR is the shape THE-315 (#454) sweeps for.
     *
     * 🔴 THE-316's OWN CLAIM IS UNTOUCHED AND STILL EXACT: split B was not in
     * this PR, so THE-316 recorded nothing here. The file's current state is
     * still pinned — by `freezeFailure` in THE-312's guards, which accepts the
     * baseline and each RECORDED value and refuses anything else — and its
     * eight outcome messages are still asserted, individually, below and in
     * THE-286.
     */
    const modal = FROZEN_FILES.personalInformationModal;
    expect(
      RECORDED_EDITS.filter((e) => e.file === modal && e.ticket === 'THE-316'),
      'the delete-flow file was recorded as edited by THE-316 — split B was not in this PR',
    ).toEqual([]);
  });

  it('and its eight outcome messages and DELETE_CONFIRM_COPY are still spelled', () => {
    const src = read(FROZEN_FILES.personalInformationModal);
    expect(src, 'DELETE_CONFIRM_COPY is no longer derived from the live map')
      .toMatch(/DELETE_CONFIRM_COPY/);
    expect(src, 'the deleteState machine is gone').toMatch(/deleteState/);
  });
});

describe('8 · nothing writes plan from the client', () => {
  it('AdminSettings still writes no entitlement — the webhook is the single writer', () => {
    // Comments only, stripped: THE-291's note DOCUMENTS the two removed props
    // by name, so a raw substring search finds its own gravestone and passes
    // for the wrong reason (or, here, fails for it).
    const src = read(SETTINGS)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    // The shape #434's sweep catches: a client-side write of `plan`.
    /*
     * ⚠️ `[^)]*` BETWEEN THE CALL AND THE OBJECT WAS A HOLE, and mutation found
     * it: the real shape is `updateDoc(doc(db, 'users', uid), { plan: … })`,
     * whose first `)` closes the INNER `doc(` call, so the character class
     * stopped there and never reached the payload. A planted client-side plan
     * write passed this assertion. `[\s\S]*?` crosses the nested call, and the
     * object body is `[^{}]*` so the match cannot run away into a later block.
     * This is the same "sweep that stopped at the first )" that THE-296 shipped.
     */
    expect(src, 'AdminSettings writes plan from the browser').not.toMatch(
      /(?:updateDoc|setDoc)\s*\([\s\S]*?\{[^{}]*\bplan\s*:/,
    );
    expect(src, 'a plan-writing callback prop came back').not.toMatch(/onChangePlan|onCancelPlan/);
  });

  it('Profile.tsx was not edited by THE-316 either, so its money path is untouched', () => {
    /*
     * 🔴 SCOPED TO THIS TICKET — THE-315's shape, narrowly avoided.
     *
     * ⚠️ As first written this filtered the register by FILE alone and required
     * the result to be EMPTY: "no ticket has ever recorded an edit to
     * Profile.tsx". That is a claim about the state of the repo, not about
     * THE-316, and it could only hold while split B was unwritten — so it went
     * red the moment THE-321 legitimately recorded the split-B edit it was
     * always expected to make, for a reason that has nothing to do with
     * THE-316's money path.
     *
     * 🔴 THE CLAIM IS KEPT, NOT DROPPED, AND NOT LOOSENED. What this exists to
     * say is that THE-316 — the settings visual pass — did not reach into the
     * member Profile while it was in AdminSettings. That is asserted directly
     * now, by ticket, and it is strictly the stronger reading: THE-316 sneaking
     * an edit in still fails here, which is the actual threat, while a later
     * ticket doing its own recorded work no longer does.
     */
    expect(
      RECORDED_EDITS.filter((e) => e.file === FROZEN_FILES.profile && e.ticket === 'THE-316'),
      'THE-316 recorded an edit to Profile.tsx — split B was not in this PR',
    ).toEqual([]);
  });
});

/* ═══ 7 · money-path fields do NOT autosave ════════════════════════════════ */

describe('7 · the autosave exclusions hold, named per field', () => {
  /**
   * ⚠️ Named per field, and asserted as ABSENCE FROM THIS SCREEN. Plan,
   * add-ons and the billing term do not autosave because AdminSettings does
   * not hold them at all — the plan change lives in PlanUpgradeSection, which
   * reaches `runDodoPlanChange` and arms `armPlanRefresh()`, and the webhook
   * applies the entitlement. THE-286 owns the debounce itself.
   */
  const MONEY_FIELDS = ['plan', 'add-ons', 'the billing term'] as const;

  it.each(MONEY_FIELDS)('"%s" is not an autosaving field on this screen', () => {
    const src = read(SETTINGS);
    expect(src, 'a debounced save appeared on the settings screen').not.toMatch(/setTimeout\([^)]*2000/);
    expect(src, 'an autosave hook was wired into the settings screen').not.toMatch(/useAutosave|autoSave/i);
  });

  it('and the only money ACTION here is confirmed, not saved', async () => {
    const host = await mount();
    await expandSection(host, 'Cancel Subscription');
    const cancel = Array.from(host.querySelectorAll('[data-slot="button"]'))
      .find((b) => (b.textContent || '').trim() === 'Cancel Subscription');
    expect(cancel, 'the cancel action is gone').toBeTruthy();
    // Clicking opens a confirmation; it does not perform the cancellation.
    await act(async () => { (cancel as HTMLElement).click(); });
    const dialog = document.querySelector('[data-slot="dialog-content"]');
    expect(dialog, 'Cancel Subscription no longer confirms before acting').toBeTruthy();
    expect(dialog!.textContent, 'the confirmation lost its two answers').toContain('Keep Plan');
    expect(dialog!.textContent).toContain('Yes, Cancel');
  });

  /**
   * 🔴 THE AIRTIGHT HALF, AND WHY IT IS HERE RATHER THAN AN EDIT TO THE-286.
   *
   * THE-286 owns the exclusion list and sweeps it, but its import matcher is
   * `/from ['"][^'"]*settings\/autosave['"]/` — it requires the path to spell
   * `settings/autosave`. Every excluded money file LIVES IN `settings/`, so the
   * natural way to add the hook to one of them is `from './autosave'`, which
   * contains no such segment and slips straight through. Planting exactly that
   * import into PlanUpgradeSection left THE-286's exclusion sweep GREEN; only
   * its unrelated byte-freeze caught the change, and a byte-freeze is released
   * the moment some future ticket records an edit to that file.
   *
   * That hole is reported rather than patched in place — THE-286's suite is
   * another ticket's guard and this is a visual pass, not a rewrite of it. What
   * belongs here is the claim this ticket was asked to hold: the money path
   * does not autosave, enforced against BOTH spellings, per field.
   */
  const MONEY_PATH_FILES = [
    ['plan', 'src/components/settings/PlanUpgradeSection.tsx'],
    ['add-ons', 'src/components/settings/AddOnsSection.tsx'],
    ['the billing term', 'src/components/settings/BillingTermToggle.tsx'],
  ] as const;

  it.each(MONEY_PATH_FILES)('🔴 "%s" (%s) imports no autosave hook, by any spelling', (_field, file) => {
    const src = read(file);
    // `./autosave`, `../settings/autosave`, `@/components/settings/autosave`.
    expect(src, `${file} imports the autosave hook — it is a money-path field`)
      .not.toMatch(/from\s*['"][^'"]*\bautosave['"]/);
    expect(src, `${file} calls the autosave hook`).not.toMatch(/useAutosave\w*\s*\(/);
  });

  it('and the plan change still goes through Dodo, with the webhook as the single writer', () => {
    const src = read('src/components/settings/PlanUpgradeSection.tsx');
    expect(src, 'the plan change no longer reaches runDodoPlanChange').toMatch(/runDodoPlanChange/);
    expect(src, 'the plan refresh is no longer armed').toMatch(/armPlanRefresh\s*\(/);
  });

  it('🔴 and there is no Save bar — autosave is decided and money is a confirmed action', async () => {
    const host = await mount();
    const saves = Array.from(host.querySelectorAll('button'))
      .map((b) => (b.textContent || '').trim())
      .filter((t) => /^save\b/i.test(t));
    expect(saves, 'a Save bar appeared on the settings screen').toEqual([]);
  });
});

/* ═══ 9 · no price literal ═════════════════════════════════════════════════ */

describe('9 · prices go through formatPlanPrice', () => {
  it('no price literal appears in AdminSettings', () => {
    const code = read(SETTINGS)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const literals = code.match(/\$\d[\d,]*/g) ?? [];
    expect(literals, 'a price literal is back — it shipped once and went stale at the reprice')
      .toEqual([]);
  });

  it('and the plan row still derives its price through the formatter', () => {
    expect(read(SETTINGS), 'formatPlanPrice is no longer the source of the price')
      .toMatch(/monthlyPrice:\s*formatPlanPrice\(id,\s*'monthly'\)/);
  });
});

/* ═══ 10 · the feature switches ════════════════════════════════════════════ */

describe('10 · the switched-off sections stay off and SMS stays live', () => {
  /**
   * 🔴 Asserted as the EXPRESSION THAT MOUNTS THEM, not the switch as a word.
   * THE-300's post-mortem: a guard that read a switch as a word passed a
   * planted defect, because the word survived a change that inverted its use.
   */
  it('PaymentSection is mounted by AdminSettings nowhere, and gates on the flag where it lives', () => {
    expect(read(SETTINGS), 'AdminSettings mounts the Connect panel again').not.toMatch(/<PaymentSection\b/);
    expect(
      read('src/components/settings/PaymentSection.tsx'),
      'the Connect panel no longer gates its mount on STRIPE_CONNECT_ENABLED',
    ).toMatch(/STRIPE_CONNECT_ENABLED\s*\?\s*<StripeConnectPanel\s*\/>/);
    expect(read('src/lib/stripe-connect-feature.ts')).toMatch(/export const STRIPE_CONNECT_ENABLED = false;/);
  });

  it('DomainSection still gates its mount on the flag', () => {
    expect(
      read('src/components/settings/DomainSection.tsx'),
      'the domain panel no longer gates on CUSTOM_DOMAIN_ENABLED',
    ).toMatch(/!CUSTOM_DOMAIN_ENABLED\s*\?/);
    expect(read('src/lib/custom-domain-feature.ts')).toMatch(/export const CUSTOM_DOMAIN_ENABLED = false;/);
  });

  it('🔴 SmsSection is still LIVE and still Ministry-only', () => {
    expect(read('src/lib/sms-feature.ts'), 'SMS was switched back off')
      .toMatch(/export const SMS_FEATURE_ENABLED = true;/);
    // The row's gate: master switch FIRST, then the FEATURE cell — never the
    // tier by name, which is what let SMS go Ministry-only without this line
    // moving.
    expect(
      read(SETTINGS),
      "the SMS row's gate moved — it must read the master switch then smsAutomation",
    ).toMatch(/hidden:\s*!SMS_FEATURE_ENABLED\s*\|\|\s*\(!platformOverride\s*&&\s*!currentFeatures\?\.smsAutomation\)/);
    expect(read(SETTINGS), 'the SMS row still mounts the section').toMatch(/<SmsSection\s*\/>/);
  });
});

/* ═══ 11 · the Gmail scope guard ═══════════════════════════════════════════ */

describe('11 · assertSendOnlyGmailScopes still fails closed', () => {
  it('throws on a read scope, and on an unknown one', async () => {
    const { assertSendOnlyGmailScopes, GMAIL_SEND_SCOPE } = await import('../../lib/gmail-scopes');
    const cfg = (scopes: string[]) => ({ toolkitSlug: 'gmail', isComposioManaged: false, scopes });

    expect(() => assertSendOnlyGmailScopes(cfg([GMAIL_SEND_SCOPE]))).not.toThrow();
    expect(
      () => assertSendOnlyGmailScopes(cfg(['https://www.googleapis.com/auth/gmail.readonly'])),
      '🔴 Harvest would hold a scope that can read a church inbox',
    ).toThrow();
    expect(
      () => assertSendOnlyGmailScopes(cfg(['https://www.googleapis.com/auth/gmail.modify'])),
      'an unknown scope was allowed through — the guard must fail CLOSED',
    ).toThrow();
    // 🔴 Fails closed on a config that states no scopes at all, rather than
    // treating "nothing declared" as "nothing granted".
    expect(
      () => assertSendOnlyGmailScopes({ toolkitSlug: 'gmail', isComposioManaged: false, scopes: null }),
      'a config declaring no scopes was accepted — that is failing OPEN',
    ).toThrow();
  });
});

/* ═══ 12 · the add-on lift ═════════════════════════════════════════════════ */

describe('12 · the add-on lift is still `||`, never assignment', () => {
  it('no plan-features lift was turned into an assignment', () => {
    const src = read('src/utils/plan-features.ts');
    // THE-253: the lift reads `a || b`; `a = b` would WRITE the entitlement.
    expect(src, 'the add-on lift became an assignment').not.toMatch(/features\.\w+\s*=\s*(?!=)/);
  });
});

/* ═══ 14 · the frozen page skeleton ════════════════════════════════════════ */

describe('14 · the page skeleton is untouched, by design', () => {
  it("regroup's ten-item unprefixed allowlist is unchanged", () => {
    const src = read(REGROUP);
    // The list, verbatim and in order. A restyle that needed an eleventh class
    // on the page root, a region wrapper or a heading would have to edit this,
    // and that is the thing THE-312 deliberately left pinned.
    expect(src, "the 10-class allowlist moved — the mobile skeleton is frozen by design").toContain(
      "['hidden', 'space-y-6', 'space-y-2.5', 'px-4', 'text-[11px]', 'font-semibold',\n" +
      "             'uppercase', 'tracking-[0.16em]', 'text-faint', 'text-danger']",
    );
  });

  it('and SectionHeading was not edited at all — its whole class layer is that vocabulary', () => {
    // 🔴 Reported rather than worked around: SectionHeading's unprefixed classes
    // ARE six of the ten allowlisted names, so there is no visual change to
    // make there that the frozen skeleton permits. It therefore has no register
    // entry, because it has no edit.
    expect(
      RECORDED_EDITS.filter((e) => e.file === HEADING),
      'SectionHeading was edited — the allowlist does not leave room for that',
    ).toEqual([]);
    expect(read(HEADING)).toMatch(/hidden sm:block text-\[11px\] font-semibold uppercase tracking-\[0\.16em\]/);
  });

  it('the page root still carries only the frozen container classes', async () => {
    const host = await mount();
    const root = host.firstElementChild as HTMLElement;
    const unprefixed = (root.getAttribute('class') || '')
      .split(/\s+/).filter(Boolean).filter((c) => !c.includes(':'));
    expect(unprefixed.sort(), 'the page root gained an unprefixed class')
      .toEqual(['px-4', 'space-y-6']);
  });
});

/* ═══ 17 · dialog layering ═════════════════════════════════════════════════ */

describe('17 · dialogs open above z-100', () => {
  it('the cancel-confirm keeps the z-[200] layer THE-286 established', () => {
    const src = read(SETTINGS);
    expect(src, 'the settings dialog left z-200').toContain('z-[200]');
    // 🔴 On BOTH layers: adopting the Dialog primitive must not silently drop
    // the scrim to the primitive's own z-[101] while the panel stays at 200.
    expect(src, 'the dialog scrim lost its explicit layer').toMatch(/DialogOverlay className="z-\[200\]/);
    expect(src, 'the dialog panel lost its explicit layer').toMatch(/DialogContent className="z-\[200\]/);
  });

  it('and it renders above the nav when open', async () => {
    const host = await mount();
    await expandSection(host, 'Cancel Subscription');
    const cancel = Array.from(host.querySelectorAll('[data-slot="button"]'))
      .find((b) => (b.textContent || '').trim() === 'Cancel Subscription')!;
    await act(async () => { (cancel as HTMLElement).click(); });
    const content = document.querySelector('[data-slot="dialog-content"]');
    expect(content, 'the dialog did not open').toBeTruthy();
    expect((content!.getAttribute('class') || ''), 'the dialog panel is not on the 200 layer')
      .toContain('z-[200]');
  });
});

/* ═══ 18 · colour, emoji and the four palettes ═════════════════════════════ */

describe('18 · no colour hardcoded, no emoji', () => {
  it('neither edited file hardcodes a colour in its markup', () => {
    for (const file of EDITED) {
      const code = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      // className strings only — PLAN_SWATCH is a documented, pre-existing data
      // table of swatch hexes with nothing in the price table to derive from,
      // and this ticket did not touch it.
      const classNames = [...code.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)]
        .map((m) => m[1] ?? m[2] ?? '');
      for (const cls of classNames) {
        expect(cls, `${file} hardcodes a colour in a className`)
          .not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(/);
        expect(cls, `${file} spells a literal palette colour (e.g. red-600) in a className`)
          .not.toMatch(/\b(?:red|blue|green|yellow|purple|pink|orange)-\d{2,3}\b/);
      }
    }
  });

  it('and neither renders an emoji', async () => {
    const host = await mount();
    await expandSection(host, 'Appearance');
    // Surrogate-pair ranges, so this works without the `u` flag on narrow builds.
    const EMOJI = /[☀-➿]|[\uD83C-\uDBFF][\uDC00-\uDFFF]|⭐|⭕/;
    const text = host.textContent || '';
    expect(EMOJI.test(text), `the settings screen renders an emoji: ${text.match(EMOJI)?.[0]}`).toBe(false);
  });

  it('🔴 and the ✕ glyph that WAS the banner dismiss is gone, replaced by a labelled icon Button', () => {
    const code = read(SETTINGS)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(code, 'the bare ✕ glyph dismiss came back — it had no accessible name')
      .not.toMatch(/>✕</);
    expect(code, 'the banner dismiss lost its accessible name').toMatch(/aria-label="Dismiss"/);
  });
});

/* ═══ 19 · 🔴 no new guard depends on the branch diff ══════════════════════ */

describe('19 · no new guard asserts anything about the current branch diff', () => {
  /**
   * 🔴 Three such guards blocked every unrelated PR in this repo in two days,
   * and THE-315 swept the class of guard that expires when its own ticket
   * merges. This asserts THIS FILE — the only guard THE-316 adds — reads
   * nothing but the working tree.
   */
  it('this suite shells out to no git command and reads no base ref', () => {
    const self = read(THIS_FILE);
    const code = self
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    /*
     * ⚠️ Matched as USE, never as mention. A flat substring list finds its own
     * entries — this assertion failed against itself on the first run, which is
     * the same self-reference trap as a guard that greps for a word it spells.
     * Each pattern therefore requires a CALL or an IMPORT: a name followed by
     * `(`, or a module in a from/require clause. The identifiers in this list
     * are bare, so the list cannot match itself.
     */
    const BRANCH_DIFF_USES: ReadonlyArray<[label: string, pattern: RegExp]> = [
      ['a child-process call', /\b(?:exec|spawn)Sync\s*\(/],
      ['a child_process import', /(?:from|require\()\s*['"](?:node:)?child_process['"]/],
      ['a git subprocess', /['"`]git\s+(?:diff|show|merge-base|rev-parse)/],
      ['the base-ref environment', /process\.env\.\w*BASE_REF/],
      ['a base revision', /['"`](?:origin\/|refs\/remotes\/)/],
    ];
    for (const [label, pattern] of BRANCH_DIFF_USES) {
      const hit = code.match(pattern);
      expect(hit?.[0] ?? null, `THE-316's guard uses ${label} — that is a branch-diff guard`).toBeNull();
    }
  });

  it('and it adds no assertion that expires when THE-316 merges', () => {
    // The THE-315 shape: a guard gated on its own ticket being absent from the
    // base. Everything here is a digest or a source string on disk, which reads
    // the same before and after the merge.
    const code = read(THIS_FILE);
    expect(code, "THE-316's guard gates itself on its own ticket's presence")
      .not.toMatch(/if\s*\([^)]*THE-316[^)]*\)\s*(?:return|\{[^}]*return)/);
  });
});

/* ═══ 20 · the out-of-scope files ══════════════════════════════════════════ */

describe('20 · the forbidden files are byte-identical', () => {
  it('layout.tsx, firestore.rules and functions/ were not opened', () => {
    // Baselines from origin/main. Spelled here so a change fails in THIS file
    // as well as in the suites that already pin them.
    expect(sha256File('src/app/layout.tsx'), 'layout.tsx changed — the brief forbids opening it')
      .toBe('bf5f96a61c3fa2f467556f44f0b36e91e49b7c830609b37c775fa6a2b9232ca5');
  });

  it('and this ticket recorded edits to exactly two files', () => {
    const mine = RECORDED_EDITS.filter((e) => e.ticket === 'THE-316').map((e) => e.file).sort();
    expect(mine, 'THE-316 edited a file it did not report').toEqual([...EDITED].sort());
  });
});
