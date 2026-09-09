/**
 * THE-341 — the rail's flyout behaviour SURVIVES the group rename.
 *
 * ─── Why this file exists at all ─────────────────────────────────────────────
 * 🔴 The ticket's fifth stop condition is "the rail's flyout behaviour breaks on
 * a renamed group". THE-334's coordination suite already walks EVERY group it
 * parses out of `DESKTOP_NAV_GROUPS`, so it covers REACH the moment the array
 * says REACH — which is real coverage and is why this file does not restate it.
 *
 * What THE-334's suite cannot do is FAIL FOR THIS TICKET'S REASON. It is
 * group-agnostic by construction: rename the group back and it still walks
 * whatever it finds and still passes. So the guarantee is re-proved here
 * against the renamed group BY NAME, through the real `NavRailProvider` and two
 * real `NavRailFlyout`s — the components that hold the one-open-at-a-time
 * invariant — so that "REACH lost its flyout" is a sentence a test can say.
 *
 * ⚠️ Deliberately NOT the full shell. THE-332's and THE-334's harnesses mount
 * `AdminDashboard` behind ~30 module mocks; a third copy of that is a third
 * thing to keep in step. The invariant under test lives entirely in the
 * provider and the flyout, so those are what is mounted.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  NavRailFlyout,
  NavRailProvider,
  RAIL_HOVER_QUERY,
  useRailHoverEnabled,
} from '../layout/nav-rail';
import { DESKTOP_GROUP_ICONS, DESKTOP_GROUP_LABELS } from '../layout/nav-rail-groups';
import { RAIL_RECENT_GROUPS } from '../layout/nav-rail-recents';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.resolve(__dirname, '../../..');
const DASHBOARD = readFileSync(path.join(ROOT, 'src/components/AdminDashboard.tsx'), 'utf8');

/** The desktop groups, read from the source rather than restated. */
function desktopGroups(): { label: string; ids: string[] }[] {
  const block = DASHBOARD.split('const DESKTOP_NAV_GROUPS')[1];
  expect(block, 'DESKTOP_NAV_GROUPS is no longer declared under that name').toBeTruthy();
  const body = block.slice(0, block.indexOf('\n];'));
  const out: { label: string; ids: string[] }[] = [];
  const re = /\{\s*label:\s*'([^']+)',\s*ids:\s*\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    out.push({ label: m[1], ids: [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]) });
  }
  expect(out.length, 'DESKTOP_NAV_GROUPS parsed to nothing').toBeGreaterThan(1);
  return out;
}

let host: HTMLDivElement;
let root: Root;

const flush = async () => { await act(async () => { await Promise.resolve(); }); };

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Every flyout panel currently in the document, by the group it belongs to. */
const openFlyouts = () =>
  [...document.querySelectorAll('[data-nav-rail-flyout]')]
    .map((el) => el.getAttribute('data-nav-rail-flyout')!)
    .sort();

const trigger = (label: string) =>
  document.querySelector<HTMLElement>(`[data-nav-rail-group="${label}"]`);

const press = async (label: string) => {
  const t = trigger(label);
  expect(t, `there is no rail entry for ${label} to press`).toBeTruthy();
  await act(async () => { t!.click(); });
  await flush();
};

/** Two real flyouts under one real provider — the shape the rail renders. */
async function mountPair(a: string, b: string) {
  await act(async () => {
    root.render(
      <NavRailProvider>
        {[a, b].map((label) => (
          <NavRailFlyout
            key={label}
            label={label}
            title={DESKTOP_GROUP_LABELS[label] ?? label}
            trigger={<span>{DESKTOP_GROUP_LABELS[label] ?? label}</span>}
          >
            <button type="button">a row in {label}</button>
          </NavRailFlyout>
        ))}
      </NavRailProvider>,
    );
  });
  await flush();
}

describe('THE-341 · REACH is a real group with a real flyout', () => {
  it('🔴 the renamed group is what the arrays actually hold', () => {
    const labels = desktopGroups().map((g) => g.label);
    expect(labels, 'there is no REACH group to test the rail against').toContain('REACH');
    expect(labels, 'BROADCASTING is still a group').not.toContain('BROADCASTING');
  });

  it('🔴 REACH has an icon, a readable title and a recents source', () => {
    expect(DESKTOP_GROUP_ICONS.REACH, "REACH's rail button would be iconless").toBeTruthy();
    expect(DESKTOP_GROUP_LABELS.REACH, 'the rail would print the raw identity').toBe('Reach');
    expect(RAIL_RECENT_GROUPS, "REACH lost its pinned footer").toContain('REACH');
  });

  it("🔴 opening REACH's flyout opens exactly one panel", async () => {
    await mountPair('REACH', 'MINISTRY');
    expect(openFlyouts(), 'a panel was open before anything was pressed').toEqual([]);
    await press('REACH');
    expect(openFlyouts(), 'REACH did not open, or opened beside something else')
      .toEqual(['REACH']);
  });

  it('🔴 a PINNED panel closes when another group is opened — either direction', async () => {
    await mountPair('REACH', 'MINISTRY');

    await press('REACH');
    expect(trigger('REACH')!.getAttribute('data-pinned'), 'the press did not pin REACH')
      .toBe('true');

    /* 🔴 The founder's screenshot was two panels overlapping. Pressing the
       second must leave exactly one on screen — and it must be the second. */
    await press('MINISTRY');
    expect(openFlyouts(), 'REACH survived MINISTRY opening').toEqual(['MINISTRY']);
    expect(trigger('REACH')!.getAttribute('data-pinned'), 'REACH kept its pin')
      .toBeNull();

    /* And back the other way, so the guard is not one-directional. */
    await press('REACH');
    expect(openFlyouts(), 'MINISTRY survived REACH opening').toEqual(['REACH']);
    expect(trigger('MINISTRY')!.getAttribute('data-pinned')).toBeNull();
  });

  it('a second press on REACH closes and unpins it', async () => {
    await mountPair('REACH', 'MINISTRY');
    await press('REACH');
    await press('REACH');
    expect(openFlyouts(), 'REACH would not put itself away').toEqual([]);
    expect(trigger('REACH')!.getAttribute('data-pinned')).toBeNull();
  });
});

describe('THE-341 · the hover gate is untouched by the rename', () => {
  /** 🔴 THREE conditions, not just a width: on touch `:hover` fires on tap AND
   *  STICKS, so a hover-opened panel on a phone cannot be dismissed. */
  it('🔴 hover is gated on width, hover AND pointer', () => {
    const terms = RAIL_HOVER_QUERY.split(' and ').map((t) => t.trim()).filter(Boolean);
    expect(terms, 'the hover query lost a condition').toHaveLength(3);
    expect(RAIL_HOVER_QUERY).toContain('(min-width: 1024px)');
    expect(RAIL_HOVER_QUERY).toContain('(hover: hover)');
    expect(RAIL_HOVER_QUERY).toContain('(pointer: fine)');
  });

  it('🔴 hover starts FALSE, so SSR and the first client render agree', async () => {
    const seen: boolean[] = [];
    function Probe() {
      seen.push(useRailHoverEnabled());
      return null;
    }
    await act(async () => { root.render(<Probe />); });
    expect(seen.length, 'the probe never rendered').toBeGreaterThan(0);
    expect(seen[0], 'hover was enabled on the very first render').toBe(false);
  });
});

describe('THE-341 · the mobile bottom bar was not in scope and did not move', () => {
  /** ⚠️ The bar is FOUR permitted tabs plus the More trigger — five cells, not
   *  five tabs. Its ids come from `primaryTabs`, which no group array feeds. */
  it('the bar still takes the first four permitted tabs, plus More', () => {
    expect(DASHBOARD, 'the bottom bar no longer derives from primaryTabs')
      .toMatch(/\{primaryTabs\.map\(\(tab\) => \{/);
    expect(DASHBOARD, 'the default bar is no longer the first four permitted tabs')
      .toMatch(/primaryTabs = allTabs\.slice\(0, 4\);/);
    expect(DASHBOARD, 'a saved custom order no longer caps the bar at four')
      .toMatch(/\.slice\(0, 4\) as typeof allTabs;/);
    expect(DASHBOARD, 'the More trigger left the bar')
      .toMatch(/setShowMoreSheet\(!showMoreSheet\)/);
  });

  it('neither group array feeds the bar', () => {
    for (const name of ['MORE_GROUPS', 'DESKTOP_NAV_GROUPS']) {
      expect(DASHBOARD, `${name} is not supposed to reach primaryTabs`)
        .not.toMatch(new RegExp(`primaryTabs[^;]*${name}`));
    }
  });
});
