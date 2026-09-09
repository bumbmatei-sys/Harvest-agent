import { describe, it, expect, vi, beforeAll } from 'vitest';
import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * THE-338 — the two CRM defects and the two navigation asks the founder
 * reported alongside the palette removal.
 *
 * Four separate complaints, in his words:
 *
 *   1. "In CRM if I press on roles the button switch appears very small."
 *   2. "Make that disclaimer in CRM collapsible."
 *   3. "both desktop and mobile forms should go into reach section."
 *   4. "reorganize the more drawer from mobile to have the same names and
 *      order from desktop."
 *
 * 🔴 (3) IS NOT BUILT, AND ITS ABSENCE IS ASSERTED HERE RATHER THAN LEFT
 * SILENT — see the last section. There is no REACH group in either array and
 * no way to tell from the request which of the four existing groups it renames
 * or which other tabs belong in it, so guessing would have shuffled the whole
 * ministry cluster on an assumption.
 */

vi.mock('../../lib/firebase', () => ({ db: {}, auth: {}, storage: {} }));

const SRC = path.resolve(__dirname, '..');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');
const DASHBOARD = read('AdminDashboard.tsx');
const CRM = read('AdminCRM.tsx');
const ROLES = read('AdminRoles.tsx');

// ═══════════════════════════════════════════════════════════════════════════
// 1 · 🔴 The Contacts / Roles switcher — the founder's "very small" report
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 🔴 THE CAUSE WAS OUTSIDE AdminCRM.tsx, AND THE TICKET'S PREMISE FOR IT WAS
 * WRONG — which is exactly why this section asserts the mechanism rather than
 * the symptom.
 *
 * The brief supposed the switcher was "rendered inside a different wrapper on
 * each branch" of AdminCRM's `crmSubView` check. It is not: the control is ONE
 * element, built once into a `subTabBar` variable and rendered from six return
 * paths, and the Roles branch and the Contacts branch open with the identical
 * `<div ref={scrollRef} className={`w-full ${FORM_CONTAINER}`}>`. Nothing in
 * AdminCRM.tsx could have produced the difference.
 *
 * What produced it was AdminRoles.tsx, a SIBLING rendered below the switcher.
 * It injected a `<style>` block whose first rule was:
 *
 *     * { box-sizing: border-box; margin: 0; padding: 0; }
 *
 * A <style> element paints the whole DOCUMENT wherever it is mounted, so while
 * the Roles sub-view was open that rule zeroed the padding of every element on
 * the page — including the switcher's `p-1` container and each pill's `px-4
 * py-1.5`, and the `mb-5` that separated the bar from the header. The pill pair
 * collapsed to bare text at the top-left, clipped by the header. That is the
 * report, exactly.
 *
 * ⚠️ THE REPO ALREADY KNEW. `admin-injected-css-isolation.test.ts` listed
 * AdminRoles.tsx as a known-unscoped file — "a third admin tab with the same
 * user-visible bug… reported rather than fixed here" — and the defect then
 * reached the founder. That guard is bidirectional, so fixing the file is what
 * removes it from the list.
 */
describe('1 — the Contacts / Roles switcher is identical on both tabs', () => {
  it('🔴 the switcher is ONE element, not one per branch', () => {
    // ⚠️ Counting `const subTabBar = (` alone is NOT enough, and that was
    // found by mutation: introducing a SECOND variable (`subTabBarRoles`) and
    // rendering it on the Roles branch leaves this count at one and passes.
    // So the check is on every switcher-shaped binding in the file.
    const bindings = [...CRM.matchAll(/const (subTabBar\w*)\s*=/g)].map((m) => m[1]);
    expect(bindings, 'a second switcher variable exists — the branches can diverge')
      .toEqual(['subTabBar']);
    // …and it is rendered from every return path by reference, never re-spelled.
    expect((CRM.match(/\{subTabBar\}/g) ?? []).length, 'the switcher is rendered nowhere')
      .toBeGreaterThan(1);
  });

  it('🔴 the Roles branch renders THAT switcher, and nothing else in its place', () => {
    // The founder's report was about the Roles tab specifically, so the Roles
    // branch is read directly rather than inferred from the count above.
    const start = CRM.indexOf("if (crmSubView === 'roles') {");
    expect(start, 'the Roles branch was not found').toBeGreaterThan(-1);
    const branch = CRM.slice(start, CRM.indexOf('<AdminRoles', start));
    expect(branch, 'the Roles branch stopped rendering the shared switcher')
      .toContain('{subTabBar}');
    // And renders no switcher of its own alongside it.
    expect(branch, 'the Roles branch renders a second switcher')
      .not.toMatch(/\{subTabBar\w+\}/);
  });

  it('🔴 the Roles branch and the Contacts branch open the same wrapper', () => {
    // Discovered by pattern, never by line number: this file's line numbers
    // moved in this very PR.
    const wrappers = CRM.match(/<div ref=\{scrollRef\} className=\{`w-full \$\{FORM_(?:CONTAINER|MEASURE)\}`\}>/g) ?? [];
    expect(wrappers.length, 'the branch wrappers were not found').toBeGreaterThan(1);
    // Both measures are form-layout's own; neither branch invents a width.
    for (const w of wrappers) expect(w).toMatch(/FORM_CONTAINER|FORM_MEASURE/);
  });

  it('🔴 AdminRoles injects no unscoped rule — this is the actual fix', () => {
    const blocks = ROLES.match(/<style>\{`([\s\S]*?)`\}<\/style>/g) ?? [];
    expect(blocks, 'the injected style block was not found — this test would be vacuous')
      .toHaveLength(1);
    const css = blocks[0] as string;

    // 🔴 The universal reset is GONE, not merely scoped. That is the fix
    // `admin-injected-css-isolation.test.ts` prescribes and the one AdminRAG
    // and AdminCourseEditor already took: Tailwind's preflight already sets
    // box-sizing everywhere and zeroes margin and padding on the form elements
    // and lists this tree uses, so nothing depended on it.
    expect(css, 'the universal reset is back — it would zero the switcher again')
      .not.toMatch(/(^|[\s,{}])\*\s*\{/);

    // And every surviving rule is scoped to this component's own subtree.
    const inner = css.slice(css.indexOf('`') + 1, css.lastIndexOf('`'));
    const selectors = [...inner.matchAll(/(?:^|\n)\s*([^\n{@]+)\{/g)]
      .map((m) => m[1].trim())
      .filter(Boolean);
    expect(selectors.length, 'no selectors were parsed out').toBeGreaterThan(0);
    for (const sel of selectors) {
      expect(sel, `${sel} reaches past AdminRoles`).toContain('[data-admin-roles]');
    }
  });

  it('the scoping hook is actually on the component root', () => {
    // A scoped selector that matches nothing would be the same bug, silently.
    expect(ROLES, 'the [data-admin-roles] root is missing').toMatch(/<div style=\{pageStyle\} data-admin-roles="">/);
  });

  it('🔴 the pills carry their own padding, which is what the reset removed', () => {
    const bar = CRM.slice(CRM.indexOf('const subTabBar = ('), CRM.indexOf('if (crmSubView === '));
    expect(bar, 'the container lost its padding').toMatch(/bg-surface-sunken rounded-xl p-1/);
    expect(bar, 'the pills lost their padding').toMatch(/px-4 py-1\.5/);
    // 🔴 And the 44px tap target, on BOTH axes. `px-4 py-1.5 text-xs` renders
    // at about 28px tall; THE-308 found a tab that cleared the floor on height
    // while measuring 35.6px wide, which is why width is checked too.
    expect(bar, 'the switcher lost its height floor below sm').toMatch(/min-h-11/);
    expect(bar, 'the switcher lost its width floor below sm').toMatch(/min-w-11/);
    // Released from `sm:` up under Rule 4, so it does not sprawl on desktop.
    expect(bar, 'the floor is not released above the phone band').toMatch(/sm:min-h-0 sm:min-w-0/);
    // Both pills carry it — a floor on one is a switcher that is still wrong.
    expect((bar.match(/min-h-11 min-w-11 sm:min-h-0 sm:min-w-0/g) ?? []).length,
      'only one pill carries the tap-target floor').toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · 🔴 The payment-links disclaimer collapses — and says the same thing
// ═══════════════════════════════════════════════════════════════════════════

describe('2 — the payment-links disclaimer collapses, unedited', () => {
  const block = CRM.slice(
    CRM.indexOf('data-testid="crm-manual-giving"'),
    CRM.indexOf('{/* Coverage line'),
  );

  it('the block was found — otherwise everything below is vacuous', () => {
    expect(block.length).toBeGreaterThan(200);
  });

  it('🔴 it is a Collapsible, from the installed primitive', () => {
    expect(CRM).toContain("from './ui/collapsible'");
    expect(block).toContain('<CollapsibleTrigger');
    expect(block).toContain('<CollapsibleContent');
  });

  it("🔴 THE-249's text is unchanged — collapsing is not editing", () => {
    // Every clause, word for word. The summary moved to the trigger and the
    // explanation to the panel; nothing was shortened, softened or dropped.
    const text = block.replace(/\s+/g, ' ');
    expect(text).toContain('Gifts sent through your own payment links are not counted here.');
    expect(text).toContain('Harvest never sees a {GIVING_PROVIDER_NAMES_OR} gift, so the member who sent');
    expect(text).toContain('one stays at $0 total given, with no last gift and the Member stage. To record it,');
    expect(text).toContain('open their contact, press Add Activity, choose Donation and enter the amount.');
  });

  it('🔴 the full text is in the DOM whether or not the fold is open', () => {
    // `keepMounted`, so the explanation is findable and reaches assistive tech
    // rather than being conjured on expand.
    expect(block).toMatch(/<CollapsibleContent keepMounted/);
  });

  it('🔴 the gate is untouched — a church with no payment links still never sees it', () => {
    // The answer to "should it show at all when there are none": it never has.
    // THE-249 made it conditional on the church actually publishing links, and
    // THE-338 collapsed it without touching that.
    expect(CRM).toContain('{showGiving && hasManualGivingLinks && (');
  });

  it('the trigger is a 44px tap target below sm', () => {
    const trigger = block.slice(block.indexOf('<CollapsibleTrigger'), block.indexOf('</CollapsibleTrigger>'));
    expect(trigger, 'the trigger is not a tap target below sm').toMatch(/min-h-11 sm:min-h-0/);
    // Rule 4: released from `sm:` up, so it does not sprawl on desktop.
    expect(trigger).toContain('sm:min-h-0');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · 🔴 The mobile drawer matches desktop — names, order, ids
// ═══════════════════════════════════════════════════════════════════════════

/** Parse a `{ label, ids }[]` array literal out of the source. */
function navGroups(name: string): { label: string; ids: string[] }[] {
  const start = DASHBOARD.indexOf(`const ${name}: { label: string; ids: string[] }[] = [`);
  expect(start, `${name} was not found`).toBeGreaterThan(-1);
  const body = DASHBOARD.slice(start, DASHBOARD.indexOf('\n];', start));
  return [...body.matchAll(/\{\s*label:\s*'([A-Z]+)',\s*ids:\s*\[([^\]]*)\]/g)].map((m) => ({
    label: m[1],
    ids: [...m[2].matchAll(/'([a-z]+)'/g)].map((x) => x[1]),
  }));
}

describe('3 — the mobile drawer and the desktop sidebar are identical', () => {
  const mobile = navGroups('MORE_GROUPS');
  const desktop = navGroups('DESKTOP_NAV_GROUPS');

  it('both arrays parsed — otherwise everything below is vacuous', () => {
    expect(mobile.length, 'MORE_GROUPS parsed empty').toBeGreaterThan(3);
    expect(desktop.length, 'DESKTOP_NAV_GROUPS parsed empty').toBeGreaterThan(3);
  });

  it('🔴 the group NAMES are identical, in the same ORDER', () => {
    expect(mobile.map((g) => g.label)).toEqual(desktop.map((g) => g.label));
  });

  it('🔴 every group holds the same ids, in the same order', () => {
    expect(mobile).toEqual(desktop);
  });

  it('🔴 enumerated, so a silent divergence in either direction fails', () => {
    // Pinned whole rather than only compared to each other: two arrays that
    // drifted TOGETHER would satisfy the comparison above and nothing else.
    expect(desktop).toEqual([
      { label: 'CONTENT', ids: ['blog', 'courses', 'newsletter', 'ai', 'docs'] },
      {
        // ⚠️ THE-341 moved `forms` out of here and into REACH. Everything else
        // in this block is THE-338's own order, unchanged.
        label: 'MINISTRY',
        ids: ['churches', 'crm', 'signups', 'services', 'community', 'fundraising', 'donations', 'accounting'],
      },
      // ⚠️ THE-341 renamed BROADCASTING to REACH and gave it `forms`.
      { label: 'REACH', ids: ['events', 'checkin', 'forms', 'sms', 'livestream'] },
      { label: 'GROW', ids: ['affiliate', 'branding', 'library', 'tenants', 'inbox'] },
    ]);
  });

  it('🔴 all 23 tabs are reachable on BOTH shells — enumerated by id', () => {
    const ALL = [
      'accounting', 'affiliate', 'ai', 'blog', 'branding', 'checkin', 'churches',
      'community', 'courses', 'crm', 'docs', 'donations', 'events', 'forms',
      'fundraising', 'inbox', 'library', 'livestream', 'newsletter', 'services',
      'signups', 'sms', 'tenants',
    ];
    expect(ALL).toHaveLength(23);
    for (const arr of [mobile, desktop]) {
      const flat = arr.flatMap((g) => g.ids);
      expect([...flat].sort(), 'a tab was orphaned or duplicated').toEqual([...ALL].sort());
    }
  });

  it('🔴 no id moved between the shells — the SET is what it was', () => {
    // The re-cut merged two mobile groups into desktop's one and adopted
    // desktop's MINISTRY order. It moved no tab from one shell to the other,
    // which is the difference between a reorganisation and a nav change.
    expect(mobile.flatMap((g) => g.ids).sort()).toEqual(desktop.flatMap((g) => g.ids).sort());
  });

  it('🔴 every permission gate is unchanged — library is still super-admin only', () => {
    // The gates live on the TAB entries, never on the groups, which is why a
    // regroup cannot move one. Asserted rather than reasoned.
    expect(DASHBOARD).toMatch(/isSuperAdmin && \{ id: 'library'/);
    expect(DASHBOARD).toMatch(/isSuperAdmin && \{ id: 'tenants'/);
    expect(DASHBOARD).toMatch(/perms\.uploadRag\) && \{ id: 'ai'/);
    expect(DASHBOARD).toMatch(/perms\.manageAffiliate\) && \{ id: 'affiliate'/);
    expect(DASHBOARD).toMatch(/canBranding && \{ id: 'branding'/);
  });

  it('🔴 a group with no permitted tabs is still omitted whole', () => {
    // What keeps a church admin from seeing an empty GROW heading where the
    // super-admin surfaces would be.
    expect(DASHBOARD).toMatch(/if \(groupTabs\.length === 0\) return null;/);
  });

  it('the five bottom-nav tabs are a separate mechanism and were not touched', () => {
    // Confirming the reading the brief asked for: the drawer's groups and the
    // bottom bar's primary tabs are different things. The bar is built from
    // `primaryTabs`, which this ticket does not mention.
    expect(DASHBOARD).toContain('primaryTabs');
    expect(navGroups('MORE_GROUPS').flatMap((g) => g.ids)).not.toContain('dashboard');
    expect(navGroups('MORE_GROUPS').flatMap((g) => g.ids)).not.toContain('settings');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · 🔴 REACH — reported, not guessed
// ═══════════════════════════════════════════════════════════════════════════

describe('4 — the REACH question THE-338 held open was ANSWERED in THE-341', () => {
  /**
   * 🔴 THIS SECTION IS INVERTED ON PURPOSE, AND THAT IS THE ONLY HONEST MOVE.
   *
   * THE-338 was asked for "forms should go into reach section" and reported
   * that no REACH group existed and that the request did not say whether it
   * meant a RENAME of an existing group or a NEW one — two nav changes with
   * very different blast radii. Rather than guess, it PINNED the status quo:
   * `forms` in MINISTRY, and no REACH group on either shell.
   *
   * The founder then answered the question in one word — "renames" — and
   * THE-341 built it. A guard whose whole subject was "the question is still
   * open" cannot stay green once the question is closed, and silently deleting
   * it would erase the record of why the wait happened. So it is REVERSED, with
   * its own history above it: the two assertions below are the exact negations
   * of the two THE-338 wrote, and they now fail if anyone puts `forms` back or
   * un-renames the group.
   *
   * ⚠️ This is NOT a weakening. THE-338's claim was "nothing moved while we did
   * not know"; the claim now is "exactly what the founder specified moved, and
   * nothing else" — which section 3 above pins whole, both shells, enumerated.
   */
  it('forms is in REACH, not MINISTRY, on both shells', () => {
    for (const name of ['MORE_GROUPS', 'DESKTOP_NAV_GROUPS']) {
      const groups = navGroups(name);
      const ministry = groups.find((g) => g.label === 'MINISTRY');
      const reach = groups.find((g) => g.label === 'REACH');
      expect(ministry, `${name} has no MINISTRY group`).toBeDefined();
      expect(reach, `${name} has no REACH group — the rename did not land here`).toBeDefined();
      expect(reach!.ids, `${name}: forms is not in REACH`).toContain('forms');
      expect(ministry!.ids, `${name}: forms is still in MINISTRY`).not.toContain('forms');
    }
  });

  it('the group is named REACH and no BROADCASTING group is left on either shell', () => {
    for (const name of ['MORE_GROUPS', 'DESKTOP_NAV_GROUPS']) {
      const labels = navGroups(name).map((g) => g.label);
      expect(labels, `${name} still carries a BROADCASTING group`).not.toContain('BROADCASTING');
      expect(labels, `${name} has no REACH group`).toContain('REACH');
    }
  });
});
