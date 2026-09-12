import React, { act } from 'react';
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import MyAccountMenu from '../MyAccountMenu';
import { DESKTOP_GROUP_LABELS, DESKTOP_GROUP_SECTIONS } from '../layout/nav-rail-groups';
import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';
import { rulesDigestFailure } from '../../__tests__/__fixtures__/firestore-rules-pin';
import { ownershipFailure } from '../../__tests__/__fixtures__/ownership-register';

/**
 * THE-358 — the admin app links the documentation.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS TICKET IS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Harvest's documentation is live at docs.theharvest.site and NOTHING in either
 * product linked to it. The founder asked for it "above or under billing" in
 * the app; it went UNDER, and the reason is recorded on the row itself.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 WHERE THE PROFILE MENU ACTUALLY LIVES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `src/components/MyAccountMenu.tsx`, not `AdminDashboard.tsx`. The dashboard
 * MOUNTS it twice — once on the nav rail (`variant="rail"`) and once in the
 * mobile screen header — but every row is this file's. Asserting against the
 * component directly is what lets the row ORDER be read off rendered markup
 * rather than inferred, and order is the whole of the founder's instruction.
 *
 * ⚠️ NOTHING HERE IS PINNED TO A LINE NUMBER. THE-331's own first draft named
 * `AdminCommunity.tsx:491`; a deletion shifted that surface to `:311` and the
 * suite would have measured whatever landed there. Rows are found by ROLE and
 * addressed by their visible label.
 *
 * 🔴 THE HEIGHTS ARE NOT ASSERTED HERE. `happy-dom` has no layout engine —
 * `getBoundingClientRect()` answers zero on every element — so the 44px/38px
 * floors are measured in real Chromium in
 * `THE-358.account-menu.layout.test.tsx`. A source-only height guard would pass
 * on a broken menu.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel: string) => stripComments(read(rel));
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

const MENU = 'src/components/MyAccountMenu.tsx';
const DOCS_URL = 'https://docs.theharvest.site';

/** The source files this ticket edits, and the suites it adds. */
const EDITED_SOURCE = [MENU] as const;
const ADDED_SUITES = [
  'src/components/__tests__/THE-358.account-menu.test.tsx',
  'src/components/__tests__/THE-358.account-menu.layout.test.tsx',
] as const;

/** The menu, opened, with every row an owner-admin can see. */
function openMenu(props: Partial<React.ComponentProps<typeof MyAccountMenu>> = {}): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(
      <MyAccountMenu
        billingAccess="yes"
        onOpenProfile={() => {}}
        onOpenSettings={() => {}}
        onOpenBilling={() => {}}
        onGoToUserApp={() => {}}
        onLogout={() => {}}
        {...props}
      />,
    );
  });
  const trigger = container.querySelector('button[aria-label="My account"]') as HTMLButtonElement;
  expect(trigger, 'the account menu has no trigger').not.toBeNull();
  act(() => { trigger.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  return container;
}

/** Every row's visible label, in DOCUMENT ORDER — which is what "under
 *  Billing" is a claim about. */
const rowLabels = (host: HTMLElement): string[] =>
  Array.from(host.querySelectorAll('[role="menuitem"]'))
    .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim());

const rowFor = (host: HTMLElement, label: string): Element => {
  const row = Array.from(host.querySelectorAll('[role="menuitem"]'))
    .find((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim() === label);
  expect(row, `no menu row labelled "${label}"`).toBeDefined();
  return row!;
};

/* ═══ 11 ═════════════════════════════════════════════════════════════════ */

describe('11 · the profile menu contains Documentation', () => {
  it('\u{1F534} a Documentation row renders, pointing at the live docs site', () => {
    const host = openMenu();
    const row = rowFor(host, 'Documentation');
    expect(row.tagName, 'the Documentation row is not a link').toBe('A');
    expect(row.getAttribute('href'), 'the Documentation row points somewhere else')
      .toBe(DOCS_URL);
  });

  it('\u{1F534} it is there for an admin who cannot reach Billing at all', () => {
    /* NOT GATED — the docs are readable by every admin, so the row must survive
       the absence of every entitlement this menu knows about. A row that only
       appeared for owners would be the docs hidden behind billing. */
    const host = openMenu({ billingAccess: 'no', onOpenSettings: undefined, onOpenBilling: undefined });
    const labels = rowLabels(host);
    expect(labels, 'Documentation is gated on an entitlement').toContain('Documentation');
    expect(labels, 'Billing leaked to an admin who may not reach it')
      .not.toContain('Billing & Payments');
    expect(labels, 'Settings leaked to an admin without the entitlement').not.toContain('Settings');
  });

  it('and while billing is still resolving, it is there too', () => {
    const labels = rowLabels(openMenu({ billingAccess: 'unknown' }));
    expect(labels).toContain('Documentation');
  });
});

/* ═══ 12 ═════════════════════════════════════════════════════════════════ */

describe('12 · it sits BELOW Billing & Payments', () => {
  it('\u{1F534} Documentation comes after Billing, not before it', () => {
    /* The founder said "above or under billing"; this is the answer, asserted
       as an ORDER on rendered markup rather than as a position in the source.
       Billing is a destructive-adjacent destination reached by muscle memory —
       a new row above it moves a target people already know. */
    const labels = rowLabels(openMenu());
    const billing = labels.indexOf('Billing & Payments');
    const docs = labels.indexOf('Documentation');
    expect(billing, 'Billing & Payments did not render').toBeGreaterThan(-1);
    expect(docs, 'Documentation did not render').toBeGreaterThan(-1);
    expect(docs, 'Documentation moved ABOVE Billing & Payments').toBeGreaterThan(billing);
    expect(docs, 'Documentation is not directly under Billing & Payments').toBe(billing + 1);
  });

  it('and it is still under Billing while Billing is the BUSY placeholder', () => {
    const labels = rowLabels(openMenu({ billingAccess: 'unknown' }));
    expect(labels.indexOf('Documentation'))
      .toBeGreaterThan(labels.indexOf('Billing & Payments'));
  });
});

/* ═══ 13 ═════════════════════════════════════════════════════════════════ */

describe('13 · it opens in a new tab with rel="noopener"', () => {
  it('\u{1F534} target and rel are both set', () => {
    const row = rowFor(openMenu(), 'Documentation');
    expect(row.getAttribute('target'), 'the docs link does not open in a new tab').toBe('_blank');
    expect(row.getAttribute('rel') ?? '', 'the docs link has no rel="noopener"').toContain('noopener');
  });

  it('every external link this file renders carries both', () => {
    /* Discovered from the rendered menu rather than asserted on the one row, so
       a second off-site row added later is governed too. */
    const host = openMenu();
    const external = Array.from(host.querySelectorAll('a[href^="http"]'));
    expect(external, 'the menu renders no external link at all').not.toHaveLength(0);
    for (const a of external) {
      expect(a.getAttribute('rel') ?? '', `${a.getAttribute('href')} has no rel="noopener"`)
        .toContain('noopener');
      expect(a.getAttribute('target'), `${a.getAttribute('href')} does not open in a new tab`)
        .toBe('_blank');
    }
  });

  it('\u{1F534} and the navigation is the anchor\'s own, not a handler\'s', () => {
    /* An <a href> keeps middle-click, ctrl-click and "open in new tab" working.
       A <button onClick={() => window.open(...)}> would look identical here and
       break all three, so the element type is asserted, not just the behaviour. */
    const src = code(MENU);
    expect(src, 'the docs row navigates by script instead of by href')
      .not.toMatch(/window\.open\(/);
    expect(src, 'the docs row is not an anchor').toMatch(/<a\b[\s\S]{0,300}href="https:\/\/docs\./);
  });
});

/* ═══ 15 ═════════════════════════════════════════════════════════════════ */

describe('15 · every pre-existing row is still there, in order', () => {
  it('\u{1F534} My Profile · Settings · Billing & Payments · … · Log out, unchanged', () => {
    const labels = rowLabels(openMenu());
    /* The full expected order, written out. `Go to User App` is included
       because it IS a row here — the founder's description of the menu omitted
       it, and a guard written from that description would have quietly accepted
       its removal. */
    expect(labels).toEqual([
      'My Profile',
      'Settings',
      'Billing & Payments',
      'Documentation',
      'Go to User App',
      'Log out',
    ]);
  });

  it('the rows that were buttons are still buttons, and still do what they did', () => {
    const host = openMenu();
    for (const label of ['My Profile', 'Settings', 'Billing & Payments', 'Go to User App', 'Log out']) {
      expect(rowFor(host, label).tagName, `"${label}" stopped being a button`).toBe('BUTTON');
    }
  });

  it('every row still carries w-full, which THE-181\'s guard requires of this file', () => {
    const host = openMenu();
    for (const row of Array.from(host.querySelectorAll('[role="menuitem"]'))) {
      expect(row.getAttribute('class') ?? '', `a row lost w-full: ${row.textContent}`)
        .toMatch(/\bw-full\b/);
    }
  });

  it('the identity header still shows the admin\'s name and email', () => {
    const host = openMenu({ displayName: 'Ada Admin', email: 'ada@example.test' });
    const text = (host.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('Ada Admin');
    expect(text).toContain('ada@example.test');
  });

  it('and both variants still render the same rows', () => {
    // THE-334 gave this component a `rail` variant. A row added to one and not
    // the other would be the defect that split guard exists to prevent.
    expect(rowLabels(openMenu({ variant: 'rail' }))).toEqual(rowLabels(openMenu()));
  });
});

/* ═══ 16 ═════════════════════════════════════════════════════════════════ */

describe('16 · the rail\'s flyouts and the REACH group are untouched', () => {
  it('\u{1F534} this ticket edits neither the rail nor its groups', () => {
    /* ⚠️ ASKED OF THE OWNERSHIP REGISTER, never of the diff — "not in the diff
       against main" is a statement about which branch you are on, and stops
       being true the moment another ticket legitimately lands. The register
       says the same thing about CONTENT and is true on any branch. */
    for (const rel of [
      'src/components/layout/nav-rail.tsx',
      'src/components/layout/nav-rail-groups.ts',
      'src/components/layout/nav-rail-recents.tsx',
      'src/components/AdminDashboard.tsx',
    ]) {
      expect(ownershipFailure(rel), `${rel} is at a digest no ticket recorded`).toBeNull();
    }
  });

  it('the REACH group still exists, still labelled, still unsectioned', () => {
    /* ⚠️ "Still holding its sections" would be WRONG and was corrected here
       after reading nav-rail-groups.ts rather than assuming: REACH deliberately
       has NO entry in DESKTOP_GROUP_SECTIONS, so it renders as ONE block, and
       the file says so. A guard asserting sections existed would have failed on
       correct code — and one asserting nothing would not have noticed an entry
       being added. Both halves are pinned. */
    expect(DESKTOP_GROUP_LABELS.REACH, 'the REACH group lost its label').toBe('Reach');
    expect(DESKTOP_GROUP_SECTIONS.REACH, 'REACH grew a section map it never had').toBeUndefined();
    expect(Object.keys(DESKTOP_GROUP_SECTIONS), 'the section map changed shape').toEqual(['MINISTRY']);
  });

  it('\u{1F534} only ONE flyout can be open, and this ticket did not touch that', () => {
    // The coordination THE-334 lifted into NavRailProvider: one `openGroup` for
    // all four flyouts, so no state exists in which two panels are open.
    const rail = code('src/components/layout/nav-rail.tsx');
    expect(rail, 'the rail no longer holds a single open group').toMatch(/openGroup/);
    expect(code(MENU), 'the account menu reaches into the rail\'s flyout state')
      .not.toMatch(/openGroup|NavRailProvider/);
  });
});

/* ═══ 17-18 ══════════════════════════════════════════════════════════════ */

describe('17 · no colour hardcoded, no emoji, no new token, component or dependency', () => {
  it.each(EDITED_SOURCE)('%s adds no colour literal', (rel) => {
    /* ⚠️ MyAccountMenu carried ONE hex before this ticket — the `GOLD` fallback
       in `var(--brand-color, #B8962E)` — and it still carries exactly that one.
       The budget is asserted as a COUNT rather than as zero, so this ticket
       adding a second would fail while the pre-existing one is not misreported
       as ours. */
    const src = code(rel);
    const hexes = src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    /* TWO, and they are the SAME pre-existing value: the `GOLD` constant's
       `var(--brand-color, #B8962E)` fallback and the identical fallback inside
       the trigger's `focus:ring-[color-mix(...)]`. Both predate this ticket.
       Asserted as a count AND as a set, so adding a second DISTINCT colour
       fails even if one of these were deleted in the same change. */
    expect(hexes.length, `${rel} spells a new raw colour`).toBe(2);
    expect([...new Set(hexes)], `${rel} introduced a second distinct colour`).toHaveLength(1);
    expect((src.match(/\b(?:rgba?|hsla?)\s*\(/g) ?? []).length, `${rel} spells an rgb()/hsl() colour`).toBe(0);
    expect(src, `${rel} spells a raw Tailwind scale`)
      .not.toMatch(/\bdivide-stone-\d|\b(?:bg|text|border)-(?:stone|zinc|slate|neutral|gray)-\d/);
  });

  it.each([...EDITED_SOURCE, ...ADDED_SUITES])('%s renders no emoji', (rel) => {
    /* ⚠️ Comments carry this repo's severity marks; RENDERED copy may not, so
       the source is stripped first. U+FE0F is stripped rather than matched —
       matched, it splits every marker in two. */
    const src = stripComments(read(rel)).replace(/️/g, '');
    expect(src.match(/[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}]/gu) ?? [], `${rel} renders an emoji`)
      .toEqual([]);
  });

  it('\u{1F534} no new token, component or dependency', () => {
    // THE-274 pins the lockfile to an EXACT LENGTH with no append path, so a
    // dependency is not an option even if one were wanted.
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>; devDependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies).length + Object.keys(pkg.devDependencies).length,
      'a dependency was added').toBe(89);
    expect(readdirSync(path.join(ROOT, 'src/components/ui')).filter((f) => f.endsWith('.tsx')),
      'a primitive was installed or removed').toHaveLength(43);
    expect(readdirSync(path.join(ROOT, 'src/components/ui')).includes('accordion.tsx'),
      'accordion appeared').toBe(false);
  });

  it('\u{1F534} the menu is hand-rolled and this ticket did NOT adopt dropdown-menu to change that', () => {
    /* ⚠️ REPORTED RATHER THAN FIXED, and the reason is recorded here because
       the answer is "no".
       `dropdown-menu` IS installed, and this menu does NOT use it: it is a
       plain `<div role="menu">` over `<button role="menuitem">` rows, and it
       predates the primitive. Converting it is a real improvement and it is NOT
       this ticket's: THE-181's guard pins this file's `w-60` panel and `w-full`
       rows, THE-334 pins its two variants and its upward-opening rail
       placement, and Base UI's menu owns its own positioning and class names —
       so the swap would rewrite three landed contracts in a change whose brief
       is "add one row". A new row in the file's own idiom is the smaller,
       honest edit. This assertion exists so the claim cannot rot silently: if
       the menu is ever migrated, it fails and sends the reader to this note. */
    const src = code(MENU);
    expect(src, 'the account menu now imports a primitive — see this test\'s note')
      .not.toMatch(/from '\.\/ui\/dropdown-menu'|from '@\/components\/ui\/dropdown-menu'/);
    // And the primitive really is on disk, so the claim above is about a choice
    // rather than about an absence.
    expect(readdirSync(path.join(ROOT, 'src/components/ui')), 'dropdown-menu is not installed')
      .toContain('dropdown-menu.tsx');
  });
});

describe('18 · this ticket writes no line-number pin, no dated fixture and no branch-diff guard', () => {
  it.each(ADDED_SUITES)('%s pins no line number', (rel) => {
    const src = code(rel);
    /* THE-331 pinned `AdminCommunity.tsx:491`; a deletion shifted it to `:311`
       and the suite would have measured whatever landed there. */
    expect(src, `${rel} pins a source line number`).not.toMatch(/\.tsx?:\d+/);
  });

  it.each(ADDED_SUITES)('%s anchors no fixture near today and installs no fake clock', (rel) => {
    const src = code(rel);
    expect(src, `${rel} anchors a fixture to a date`).not.toMatch(/\b20\d{2}-\d{2}-\d{2}\b/);
    /* 🔴 THE NEEDLE IS ASSEMBLED FROM FRAGMENTS — this assertion is inside the
       file it sweeps, and #496 found TWO guards in this series self-matching. */
    expect(src, `${rel} installs a fake clock`)
      .not.toMatch(new RegExp(['useFake' + 'Timers', 'to' + 'Fake'].join('|')));
  });

  it.each(ADDED_SUITES)('%s asserts nothing about the current branch\'s diff', (rel) => {
    /* The expiring shape #454 sweeps for: "the diff contains X" is TRUE on this
       branch and FALSE for every branch after it merges, so it blocks unrelated
       PRs. Nothing here shells out to git at all. */
    const src = code(rel);
    /* 🔴 THE NEEDLE IS ASSEMBLED FROM FRAGMENTS, because this assertion lives
       INSIDE the set it sweeps — spelled whole, it matched its own source and
       reported this file as the offender. #496 found TWO guards in this series
       failing exactly that way. */
    const shellsOut = new RegExp([
      'git' + '\\s+diff', 'exec' + 'Sync', 'spawn' + 'Sync', 'child_' + 'process',
    ].join('|'));
    expect(src, `${rel} reads the branch's diff`).not.toMatch(shellsOut);
  });
});

/* ═══ 19 ═════════════════════════════════════════════════════════════════ */

describe('19 · firestore.rules, the indexes file, functions/ and layout.tsx are byte-identical', () => {
  it('\u{1F534} firestore.rules — it AUTO-DEPLOYS TO PRODUCTION on merge', () => {
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
  });

  it('firestore.indexes.json', () => {
    expect(sha256(readFileSync(path.join(ROOT, 'firestore.indexes.json'))))
      .toBe('8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0');
  });

  it('functions/ — file for file', () => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'lib' || entry === '.git') continue;
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else out.push(path.relative(ROOT, p));
      }
    };
    walk(path.join(ROOT, 'functions'));
    const files = out.sort();
    expect(files).toHaveLength(5);
    expect(sha256(files.map((f) => `${f}:${sha256(readFileSync(path.join(ROOT, f)))}`).join('\n')))
      .toBe('1a3a1c7f27699263bcdf5bd0320c7cb0803a6f76644952f631000bc9bedef2d7');
  });

  it('src/app/layout.tsx — at a digest a ticket recorded', () => {
    expect(ownershipFailure('src/app/layout.tsx'),
      'layout.tsx is at a digest no ticket recorded').toBeNull();
  });

  it('and nothing this ticket adds or edits mentions them', () => {
    for (const rel of [...EDITED_SOURCE, ...ADDED_SUITES.slice(1)]) {
      /* Fragments again, and for the same reason: this assertion names the very
         files it forbids naming, so a whole spelling would match itself. */
      const reaches = new RegExp(['firestore' + '\\.rules', "['\"]\\.\\.?/" + 'functions/'].join('|'));
      expect(code(rel), `${rel} reaches for the rules file or functions/`).not.toMatch(reaches);
    }
  });

  it('\u{1F534} and this ticket\'s own edit is recorded in the ownership register', () => {
    expect(ownershipFailure(MENU),
      'MyAccountMenu.tsx is at a digest no ticket recorded — append, never substitute').toBeNull();
  });
});
