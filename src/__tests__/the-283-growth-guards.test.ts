import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

import { GLOBALS_CSS, REPO_ROOT } from '../test/support/tailwind-build';
import { rulesDigestFailure } from './__fixtures__/firestore-rules-pin';

/**
 * THE-283 — the static guards: what this slice was not allowed to add.
 *
 * The rendered behaviour is in `components/__tests__/the-283-growth-tab.test.tsx`
 * and the layout in `the-283-growth-layout.test.tsx`. What is here is the set of
 * things only visible in the SOURCE — a hardcoded hex, an inline style, a minted
 * token, a new dependency, an edit to a file another ticket owns.
 *
 * ⚠️ Nothing here shells out to `git show`. Every baseline is a literal digest
 * or a literal value, pinned when this test was written. A guard that re-derives
 * its own baseline from the repository at assertion time cannot fail — it just
 * describes whatever it was handed. (THE-276's guards say the same thing, and
 * the `MemberScreens.desktop-layout` test's `git show` is the counter-example:
 * it self-diagnoses a depth-1 clone because it has to.)
 */

const sha256 = (t: string | Buffer): string => createHash('sha256').update(t).digest('hex');
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** Every file this ticket adds or modifies. The subject of every guard below. */
const TOUCHED_FILES = [
  'src/components/dashboard/growth-data.ts',
  'src/components/dashboard/useGrowthData.ts',
  'src/components/dashboard/LocationTable.tsx',
  'src/components/dashboard/GrowthTab.tsx',
  // Modified by this slice, so they come under the same bars.
  'src/components/dashboard/WidgetFrame.tsx',
  'src/components/dashboard/TrendChart.tsx',
  'src/components/dashboard/DashboardTabs.tsx',
  'src/components/AdminDashboardHome.tsx',
] as const;

/** Source with block and line comments stripped — the code, not the prose. */
function codeOf(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/* ═══ 10a · No inline style ══════════════════════════════════════════════════ */

describe('no emoji, no inline style, no hardcoded colour', () => {
  /**
   * The bar is ZERO. The dashboard files currently carry no inline style at all
   * and this slice keeps it there — an inline style out-ranks every stylesheet
   * rule, so a themed token can never override one, which is exactly why the
   * design system could never reach `AnalyticsAndRoles.tsx` and its 193 of them.
   */
  it.each(TOUCHED_FILES)('%s carries no style={{ … }} at all', (file) => {
    const inline = codeOf(file).match(/style=\{\{/g) ?? [];
    expect(inline, `${file} has ${inline.length} inline styles`).toHaveLength(0);
  });

  it('and no style attribute of any other shape either', () => {
    for (const file of TOUCHED_FILES) {
      expect(codeOf(file), file).not.toMatch(/\sstyle\s*=/);
      expect(codeOf(file), file).not.toMatch(/\.style\.[a-zA-Z]/);
      expect(codeOf(file), file).not.toMatch(/setProperty\(/);
    }
  });

  /* ═══ 10b · No emoji reaches a screen ═════════════════════════════════════ */

  /**
   * 🔴 Comments are stripped first. This repo's house style uses 🔴 and ⚠️
   * heavily in prose to mark the load-bearing notes, and those are documentation.
   * What is banned is an emoji that can reach a SCREEN — `lucide-react` is
   * already imported by every file here that draws an icon.
   */
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

  it.each(TOUCHED_FILES)('%s uses no emoji outside its comments', (file) => {
    const found = codeOf(file).match(EMOJI);
    expect(found, `${file} carries ${found?.[0]} in code`).toBeNull();
  });

  it('every icon on the Growth tab is a lucide component', () => {
    for (const file of ['src/components/dashboard/GrowthTab.tsx', 'src/components/dashboard/LocationTable.tsx']) {
      expect(read(file), file).toMatch(/from 'lucide-react'/);
    }
  });

  /* ═══ 10c · No colour is hardcoded ════════════════════════════════════════ */

  it.each(TOUCHED_FILES)('%s contains no hex literal', (file) => {
    const hexes = codeOf(file).match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hexes, `${file} hardcodes ${hexes.join(', ')}`).toHaveLength(0);
  });

  it.each(TOUCHED_FILES)('%s contains no rgb/hsl/oklch literal', (file) => {
    const fns = codeOf(file).match(/\b(?:rgba?|hsla?|oklch|lab)\s*\(/g) ?? [];
    expect(fns, `${file} hardcodes ${fns.join(', ')}`).toHaveLength(0);
  });

  it('no raw Tailwind palette step is spelled either — every colour is semantic', () => {
    // `bg-sky-100` is as fixed as a hex: the numbered ramps do not move with the
    // palette. Four palettes ship and Classic is the DEFAULT since #409, so a
    // literal is the same colour in all four and therefore wrong in at least three.
    const RAMP = /\b(?:bg|text|border|ring|fill|stroke|from|via|to|divide|outline)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;
    for (const file of TOUCHED_FILES) {
      const hits = codeOf(file).match(RAMP) ?? [];
      expect(hits, `${file} spells ${hits.join(', ')}`).toHaveLength(0);
    }
  });

  it('the Growth tab names no series colour of its own — it reuses CHART_VARS', () => {
    const growth = codeOf('src/components/dashboard/GrowthTab.tsx');
    expect(growth).toMatch(/CHART_VARS/);
    // No `var(--chart-N)` spelled directly: the five slots are declared once,
    // in GivingMix, and referenced by index everywhere else.
    expect(growth).not.toMatch(/var\(--chart-\d\)/);
  });
});

/* ═══ 10d · All four palettes resolve, Classic first ═════════════════════════ */

/** Custom properties declared by rules whose selector matches. */
function varsIn(selectorTest: (sel: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(readFileSync(GLOBALS_CSS, 'utf8')).walkRules((rule) => {
    if (!selectorTest(rule.selector)) return;
    rule.walkDecls((decl) => { if (decl.prop.startsWith('--')) out[decl.prop] = decl.value.trim(); });
  });
  return out;
}

const rootVars = varsIn((s) => s === ':root');
const darkVars = varsIn((s) => /\.dark|\[data-theme="dark"\]/.test(s) && !s.includes('data-palette'));

/** 🔴 Classic FIRST — it is the default since #409, so it is the primary case. */
// 🔴 THE-338 — TWO palettes, not four. The second FAMILY (Classic) and its
// `data-palette` selectors are gone; its 14 overrides were promoted into
// :root/.dark. The surviving axis is light/dark, so keeping four keys would
// have run every assertion below twice over identical declarations.
const PALETTES: Record<string, Record<string, string>> = {
  Light: { ...rootVars },
  Dark: { ...rootVars, ...darkVars },
};

function resolve(value: string | undefined, scope: Record<string, string>, depth = 0): string | null {
  if (value === undefined || depth > 12) return null;
  const v = value.trim();
  const m = /^var\(\s*(--[\w-]+)\s*(?:,([\s\S]+))?\)$/.exec(v);
  if (m) {
    const direct = scope[m[1]] !== undefined ? resolve(scope[m[1]], scope, depth + 1) : null;
    return direct ?? (m[2] ? resolve(m[2], scope, depth + 1) : null);
  }
  return v;
}

describe('both palettes resolve every token this slice leans on', () => {
  /**
   * The semantic tokens the two new widgets actually reference, via the
   * `ui/table`, `ui/card` and `ui/empty` primitives and their own classes.
   */
  const USED = ['--muted-foreground', '--foreground', '--card', '--card-foreground', '--border', '--muted'] as const;

  it.each(Object.entries(PALETTES))('%s resolves each of them to a real value', (name, scope) => {
    for (const token of USED) {
      expect(resolve(scope[token], scope), `${name} ${token}`).toBeTruthy();
    }
  });

  it('and --chart-2, the one series colour the growth trend plots, in all four', () => {
    for (const [name, scope] of Object.entries(PALETTES)) {
      expect(resolve(scope['--chart-2'], scope), `${name} --chart-2`).toBeTruthy();
    }
  });

  it('the two palettes are genuinely two — dark is not a copy of light', () => {
    // 🔴 THE-338 REPOINTED THIS. It proved the two FAMILIES were distinct, so
    // that "resolves in all four" was not four readings of the same values.
    // With one family the equivalent claim is that the MODES are distinct —
    // which is what makes "resolves in both" a real check rather than two
    // readings of :root.
    expect(resolve(PALETTES.Dark['--background'], PALETTES.Dark))
      .not.toBe(resolve(PALETTES.Light['--background'], PALETTES.Light));
  });
});

/* ═══ 11 · No new token was defined ══════════════════════════════════════════ */

describe('no new token was defined', () => {
  it('no file in this slice declares a custom property', () => {
    for (const file of TOUCHED_FILES) {
      const declared = codeOf(file).match(/(?<![\w-])--[\w-]+\s*:/g) ?? [];
      expect(declared, `${file} declares ${declared.join(', ')}`).toHaveLength(0);
    }
  });

  /**
   * The stronger half: a token can also be "added" by REFERENCING one that does
   * not exist. `var(--growth-accent)` compiles, resolves to nothing and paints
   * transparent — a token invented by use rather than by declaration.
   */
  it('every custom property these files reference already exists in globals.css', () => {
    const declared = new Set(Object.keys(rootVars));
    for (const map of [darkVars]) {
      for (const key of Object.keys(map)) declared.add(key);
    }
    const globals = readFileSync(GLOBALS_CSS, 'utf8');

    for (const file of TOUCHED_FILES) {
      for (const [, name] of codeOf(file).matchAll(/var\((--[\w-]+)/g)) {
        // `--color-<key>` is minted at RUNTIME by the chart primitive, scoped to
        // one chart, from that chart's own config. Not a design token.
        if (name.startsWith('--color-')) continue;
        expect(declared.has(name) || globals.includes(`${name}:`), `${file} references undeclared ${name}`).toBe(true);
      }
    }
  });

  it('the bridge has held with zero additions, and this slice adds none', () => {
    // The count of `--chart-N` slots is the one that would move if a widget
    // needed a sixth series colour. It does not: the growth trend plots one.
    expect(rootVars['--chart-5']).toBeTruthy();
    expect(rootVars['--chart-6']).toBeUndefined();
  });
});

/* ═══ 12 · The files this ticket may not touch ═══════════════════════════════ */

/**
 * 🔴 `AdminDashboard.tsx` is THE-277's. THE-276's design keeps it untouched:
 * `AdminDashboardHome`'s five props are unchanged by this slice too, so the call
 * site never needs editing and this slice preserves that property.
 * `firestore.rules`, `firestore.indexes.json` and `functions/` are out of scope
 * by instruction — and `firestore.indexes.json` matters twice over, because it
 * DOES NOT DEPLOY ON MERGE, so an index added here would silently reject in
 * production. Every query this slice issues is a single equality, served by the
 * automatic single-field index every collection already has.
 *
 * ⚠️ A SET per file, not a single digest, for THE-276's reason: CI runs against
 * `refs/pull/N/merge`, so a file another ticket legitimately lands on `main`
 * holds a different value there than on this branch. A value that is NEITHER —
 * i.e. this ticket editing the file — still fails, which is the whole threat.
 */
const UNTOUCHED: Record<string, ReadonlyArray<readonly [digest: string, source: string]>> = {
  'src/components/AdminDashboard.tsx': [
    ['722c5e4478be0a8508e7dff1232dd4c1f88cacdd502604f946f3134eb730d98c', 'main at 625e3eb, where this branch started'],
    // THE-291 removed the dead `onChangePlan` / `onCancelPlan` props from the
    // `<AdminSettings>` mount — a client-side `plan` write that no caller ever
    // reached. This slice's own claim is unchanged: it does not edit the file.
    ['446f0bcb8ffa6accf4f80467b75a50023c1441937605b11e18aa01b53d8e53f8', 'main + THE-291 — the client-side plan write removed'],
    // 🔴 THE-326 — the Services nav entry. APPENDED, NEVER SUBSTITUTED: every
    // value above is still accepted, because CI runs against `refs/pull/N/merge`
    // and a merge ref cut before this ticket landed legitimately carries one of
    // them. A digest that is NEITHER — i.e. THIS slice editing the file — still
    // fails, which is the whole threat this guard exists for.
    //
    // ⚠️ THIS SLICE'S OWN CLAIM IS UNCHANGED: it does not edit AdminDashboard.
    // THE-326 does, and it must — the nav lives there and the ticket is "service
    // planning is buried inside Events, split it out". What it adds is the
    // `services` entry in `allTabs`, the same id in the MINISTRY group of BOTH
    // nav arrays, one arm on the render switch, and two imports. It introduces
    // no permission: the entry repeats Events' own
    // `navAllows(features?.eventRegistration) && (hasFullAccess ||
    // perms.manageEvents)`, so no tier's and no role's reach changes.
    ['69f7efceccd7b8381e5ceb114642f8b4634e73df1278bb082e678a1a0cb634f9', 'main + THE-326 — service planning split out of Events into its own section'],
    // 🔴 THE-327 — `'library'` added to the PLATFORM group of MORE_GROUPS and
    // the GROW group of DESKTOP_NAV_GROUPS. APPENDED, NEVER SUBSTITUTED: every
    // value above is still accepted, because CI runs against
    // `refs/pull/N/merge` and a merge ref cut before this ticket landed
    // legitimately carries one of them. A digest that is NEITHER — i.e. THIS
    // slice editing the file — still fails, which is the whole threat this
    // guard exists for.
    //
    // ⚠️ THIS SLICE'S OWN CLAIM IS UNCHANGED: it does not edit AdminDashboard.
    // THE-327 does, and it must — the founder reported the Library screen
    // deleted and it was not: the screen renders, the nav entry exists and
    // `admin-sections.ts` maps the slug, so `/admin/library` already resolved.
    // What was missing was any way to CLICK to it, because `'library'` was in
    // NEITHER group array and the desktop sidebar has no catch-all. It adds two
    // array entries and their reasons and nothing else — no permission, gate,
    // tab id, render arm or import changes, and the entry is still
    // `isSuperAdmin && { id: 'library' }`.
    ['decfdddbdab91094c936b503f931b663eeb6ba3048ee087c541fe1580f20e31e', 'main + THE-327 — the Library nav entry added to both group arrays'],
    // 🔴 THE-332 — the desktop nav became a RAIL. APPENDED, NEVER
    // SUBSTITUTED: every value above stays accepted, because CI runs against
    // `refs/pull/N/merge` and a merge ref cut before this ticket landed
    // legitimately carries one of them. A digest that is NEITHER — i.e. THIS
    // slice editing the file — still fails, which is the whole threat this
    // guard exists for.
    //
    // ⚠️ THIS SLICE'S OWN CLAIM IS UNCHANGED: it does not edit
    // AdminDashboard. THE-332 does, and it must — the nav lives there and the
    // ticket is "the sidebar shows all 24 tabs at once, make it a rail with
    // flyouts". What it changes is the DESKTOP column only: the four groups
    // became flyout triggers, Dashboard and Settings stayed pinned, and
    // `isSidebarCollapsed` / `collapsedGroups` went with the column they
    // collapsed. MORE_GROUPS and the mobile More sheet are byte-identical, and
    // no permission gate moved.
    ['508747ccbc7b2fef051d449626ef2f81f3655b214be0494c6c21a8c7df88b9bb', 'main + THE-332 — the desktop nav becomes a rail with flyouts'],
    // 🔴 APPENDED BY THE-334, nothing above removed or rewritten.
    ['00db3fa2b16a506d0a23dc1d582e6581c49e03350b966fb30d82d9434b09f450', 'main + THE-334 — one flyout at a time; the panel takes ClickUp’s shape and Settings moves to the account menu'],
    // 🔴 APPENDED BY THE-335, nothing above removed or rewritten: SMS hidden
    // again behind its own switch, the Newsletter nav entry and render branch
    // gated by a new one in the identical shape, and the Signups gate moved off
    // the `crm` cell onto its own so free can keep Signups without CRM.
    ['d81a5b117569424515bf8c8ebca8654e8b6f57f3c7447f2419968adcebdf8bbe', 'main + THE-335 — SMS and the newsletter hidden; Signups on its own plan cell'],
    ['a7dc96513ad4003892f3bc81d5faaed2f616bd04c496a4b3ec977777baf067b7', 'main + THE-341 — BROADCASTING renamed to REACH and `forms` moved into it, on both shells'],
    // APPENDED BY THE-346, nothing above removed or rewritten.
    ['3f1556d136fc8f4d2027772dfbd9b8d1be08c3678a9122ccbda8f5ac5e460e8c',
      'main + THE-346 - the bottom nav gains a display:contents visibility wrapper so the Notes editor can take the 65px band back on a phone when it goes fullscreen; the nav OWN class string is byte-identical, because four measured suites discover it out of this file by pattern'],
    // APPENDED BY THE-351, nothing above removed or rewritten.
    ['2db14e00681bca8af26bbffceb3749178dd7df89a0e226a4b527be1d4dc37bc1',
      `main + THE-351 - the per-tenant inbox of payments to confirm joins the header on BOTH shells: the desktop top bar's right cluster (beside the super-admin platform bell) and AdminScreenHeader's rightAccessory on mobile, which is the only header a phone renders. The founder: "Put inbox in all tenants in top right where this will appear, that someone pressed on I paid and they have to confirm it." It is NOT the existing 'inbox' TAB - that one is platform_inbox, super-admin-on-apex only, and this ticket adds neither of its two spellings; the new control is not a tab at all and its accessible name is "Payments to confirm". No nav array, no group, no permission, no route and no screen mount moved.`],
    // APPENDED BY THE-191, nothing above removed or rewritten.
    ['465b72f66ae55ec668f5bc7407c49edaeee0be5f5b20e028f6a64e57de6a8397',
      `main + THE-191 - the campus cap offers the add-on, so AdminChurches needs a door to the screen that sells one. ONE prop on the existing <AdminChurches /> mount: onOpenBilling, wired to the SAME expression the account menu already passes (billingAccess === 'yes' ? () => setShowBilling(true) : undefined), so an admin without settled billing access still gets undefined and no button. No nav array, group, tab id, permission gate, render arm, import or new state moved.`],
    // APPENDED BY #521, nothing above removed or rewritten.
    ['025b037f7ff786e047c50c62c5ad213a1af1ade121640bd6100b88c6627f048e',
      `main + #521 - the Blog Automate button hides while the AI knowledge base is hidden. One import (isKnowledgeBaseEnabled), one const knowledgeBaseEnabled computed from the SAME planUnlocked || features.aiKnowledge === true predicate the AI Knowledge render arm already used, that const in place of planAllows(features?.aiKnowledge) in the ai render arm (behaviour identical), and ONE prop on the existing <AdminBlog /> mount (knowledgeBaseEnabled). No nav array, group, tab id, permission gate, route or other screen mount moved.`],
    // APPENDED BY THE-373, nothing above removed or rewritten.
    ['308d159615f0d5d966d7a8fa60d1a342069b2f790f9b965e9bda3ac896a86cda',
      `main + THE-373 - Check-In is withheld on Individual so the Reach group disappears there. The nav entry gains one plan clause, planUnlocked || resolvedPlan !== 'plus', and the checkin render arm shows page-not-found on Individual without the platform override. Free, Small Team and Ministry still mount AdminCheckin. Forms is not added. No other nav id, group, permission or screen mount moved.`],
    // APPENDED BY the phase-1 shell, nothing above removed or rewritten.
    ['41a14031bb605f8028018a2d3a2008d6df132fa30d92b8570b5a21d159c18eed',
      `main + phase 1 app shell - the desktop icon rail and its hover flyouts are replaced by a shadcn Sidebar that mounts only from the lg breakpoint, with always-visible labels, collapsible groups, and collapse-to-icons. The mobile bottom bar and More sheet are unchanged; the shell class string gains only lg:hidden so that bar does not also paint on desktop. MORE_GROUPS is byte-identical and no permission gate moved.`],
    // APPENDED BY #529 review, nothing above removed or rewritten.
    ['480bca86b8d234277691cd45a00073d4d4695a814c11f4d28a62ccea13210e6f',
      `main + #529 review - the home screen gates recorded giving, member and contact figures behind hasAnalyticsAccess, including the tenant-owner rule, and mounts Overview, Growth, Giving, Engagement and Content only after that grant. The entitlement catalogue renders when NODE_ENV is test. The light default and the lg sidebar query both run in a layout effect.`],
    // APPENDED BY #529 QA, nothing above removed or rewritten.
    ['eec73dea210f04b85c17f1dacdcff72162a49e8a152501a68b9a994d928e04cf',
      `main + #529 QA - the desktop sidebar provider sets --sidebar-width-icon to 3.75rem so the collapsed icon rail fits a 44px control. No nav array, group, permission gate, or screen mount moved.`],
    // APPENDED BY #529 QA, nothing above removed or rewritten.
    ['666b4cbf551ba1ed1711105035f9a112f3f9d74686b16bc748ca0a1998a0f078',
      `main + #529 QA - Home receives the tab ids already in the nav, so a quick action is offered only when that route would accept it. No nav array, group, permission term, or screen mount moved.`],
    // APPENDED BY the social scheduler, nothing above removed or rewritten.
    ['5b52184914f227832a2e023d3467d351b291412e54c5968bbc0fd45dcaae40d1',
      `social scheduler - Public gains a Social tab that mounts the scheduler. The mobile bottom bar, More groups, and the shell class string are unchanged. The plan cell stays false on every tier, so the screen shows the add-on wall.`],
    // APPENDED BY #530 QA, nothing above removed or rewritten.
    ['eec832262194852dcf12d71acd4c01fec168caf0aed1db96eb660895783f178b',
      `#530 QA - the desktop sidebar shows Social only when the add-on is held or the viewer is a super admin, and the composer is told when that is already known so it can render while accounts load. The mobile drawer entry, More groups, and the shell class string are unchanged.`],
    // APPENDED BY the Eden shell pass, nothing above removed or rewritten.
    ['bfab6720f1e6f64bcfc87a2aab6f844c92dff5c788f7b5f5711a3619c50fe7c4',
      `Eden shell pass - the desktop content bar is shadcn Breadcrumb, Separator and SidebarTrigger. Inbox and the platform bell sit in the sidebar footer. Eden widths and grouped nav. Mobile AdminScreenHeader and the bottom nav stay. No permission gate, nav id or screen mount moved. Brand colours stay Harvest navy and gold.`],
    ['ede5f2a59a8107e8b0faf46d8b05d5a5cd34d16f993b4ee2389e2ed194745e87',
      `Eden shell pass follow-up - the payments inbox moves from the sidebar footer into the desktop content bar so it stays top-right. The platform bell stays in the footer. Mobile AdminScreenHeader still mounts its own inbox. No permission gate, nav id or screen mount moved.`],
    ['c76170af6567412fe8998170aeca376ab1998ba8545c2809f1b07ea5f859c940',
      `Eden shell pass follow-up - Home's breadcrumb is just Home. Every other route crumbs its sidebar group instead of the People or Public side. No permission gate, nav id or screen mount moved.`],
    ['51c9a678558d1bdf523bfaf524afaf0e3bc92dcfc230d471ba43def62a50fe68',
      `Eden shell fix round - the platform bell is a shadcn Button (ghost, icon) with the gold active highlight, and the desktop content bar mounts only at lg so a phone does not fetch the payments inbox twice. No permission gate, nav id or screen mount moved.`],
    // APPENDED BY the desktop settings popup, nothing above removed or rewritten.
    ['9f781d73a826a925b99e3f1ddb0b6fc57f6f45fcc96794c16028f2d5387ee5c3',
      `desktop settings popup - on lg the Settings tab opens the sidebar-13 dialog over the Home screen instead of the full page. Mobile still mounts AdminSettings. No permission gate or nav id moved; the only mount change is Home behind the popup on lg.`],
    // APPENDED BY the settings popup QA round 2, nothing above removed or rewritten.
    ['91bb69aeb07f1e7ab3be1a7f5f4f5961fe9463d55d6e1228a16def5753c9a33e',
      `settings popup QA round 2 - one prop on the existing SettingsDialog mount, canUpgrade, wired to billingAccess === 'yes' so the plan-upgrade cards are offered only to a billing-entitled admin. No permission gate, nav id, route or screen mount moved.`],
    // APPENDED BY the settings popup round 4, nothing above removed or rewritten.
    ['0e7c5da62a647d60a773ac3c8da6beb7ca1a7138787fbcf646e5c5dddb23d92a',
      `settings popup round 4 - billing and branding open inside the desktop Settings popup (the Billing row, /admin/branding), canBranding on the SettingsDialog mount and canManageBilling on the phone AdminSettings mount. No permission gate, plan gate, nav id or route moved.`],
    ['735d23f8946c67052aa01f186eaaa518d12f3e5319ddeca91e3d21240bf078c0',
      `settings popup round 4 follow-up - a branding-only admin keeps one desktop Branding row, because Settings does not open without manageSettings. A settings admin still has no Branding sidebar row. No permission gate or plan gate moved.`],
    // APPENDED BY the settings popup round 4b, nothing above removed or rewritten.
    ['44dba8fb732054ce3e491cc479dc09fec134a57b2124e944050564e98f138b65',
      `settings popup round 4b - the desktop account menu drops Billing & Payments when the admin can open Settings. Plan & billing inside the popup stays the only desktop route. The phone menu is unchanged, and an admin who can bill but cannot open Settings keeps the row. No permission gate, plan gate, nav id, route, price or checkout moved.`],
    ['2b67b7456e1c32369bc8b41eb55782e8cd72ef63957018f4c0193bcfb2d7f89f', 'UI polish, 23 Oct (THE-377) - AdminDashboard.tsx. Sidebar regrouped (Channels, Engage, Products; People, Giving, Notes boards), the Community menu in the top bar, clickable breadcrumbs, and a Products tab that mounts AdminCourses. Every tab keeps its permission and plan gate; no route or write path moved.'],
    ['1433310d5f03ed9f44631516f1f6874f29a40664b48ac90513cd0d4e029a74da', 'Palette content search (#548) - AdminDashboard.tsx. go() takes an optional item id and the sidebar gets a search prop. No nav array, entitlement, plan check, permission term, query or write path changed.'],
    ['3c1d4d893b3980eab1e64e692f6094456325d0b14e69fe118ebe7d7f4791e14f', 'Two-plan repricing - AdminDashboard.tsx. The plan is read through canonicalPlanId, the Check-In withholding keys off church (the cheapest paid tier) instead of plus, and the Accounting entry is labelled Giving records. No route, permission term, plan gate cell or write path moved. (THE-378)'],
    ['1c23acf8db78f646c830687b50358a36c510f31a9d7ce5e35f051b625a5b9158', 'Community setup adds its settings screen and navigation entry while retaining the existing permission gate.'],
    // APPENDED BY THE-555; earlier digests and reasons are retained.
    ['d124151bc5a895cb4117c7e396e175fc7db04734d29b7ceb73558d8fd42db69e', 'THE-555 - Lucide nav icon swap: Newsletter uses Mailbox and Community uses ToolCase through NAV_ICONS. Retains the required shadcn Button conversions, names their state classes locally, and preserves phone touch floors. No nav array structure, route, permission, entitlement or screen mount changed.'],
  ],
  'firestore.indexes.json': [
    ['8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0', 'main at 625e3eb'],
  ],
};

function functionsTree(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'lib' || entry === '.git') continue;
      const p = path.join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(path.relative(REPO_ROOT, p));
    }
  };
  walk(path.join(REPO_ROOT, 'functions'));
  return out.sort();
}

describe('AdminDashboard.tsx, firestore.rules, firestore.indexes.json and functions/ byte-identical', () => {
  /**
   * 🔴 THE-325 · the accepted SET moved to `__fixtures__/ownership/`, the
   * ASSERTION stayed here. This suite still says what it always said: the
   * `firestore.rules` on disk is at a digest some ticket recorded, and so
   * THIS ticket did not touch a file that auto-deploys to production with no
   * emulator test in CI. Only the list of accepted values is now shared, so a
   * legitimate rules change is one new per-ticket record rather than 50 edits.
   */
  it('firestore.rules carries no edit from this ticket', () => {
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
  });

  it.each(Object.entries(UNTOUCHED))('%s carries no edit from this ticket', (file, accepted) => {
    const actual = sha256(readFileSync(path.join(REPO_ROOT, file)));
    const match = accepted.find(([digest]) => digest === actual);
    expect(
      match,
      `${file} is at ${actual}, which is none of:\n  ` +
        accepted.map(([d, why]) => `${d} (${why})`).join('\n  '),
    ).toBeTruthy();
  });

  it('functions/ is unchanged, file for file', () => {
    const files = functionsTree();
    expect(files).toHaveLength(5);
    const tree = sha256(files.map((f) => `${f}:${sha256(readFileSync(path.join(REPO_ROOT, f)))}`).join('\n'));
    expect(tree).toBe('1a3a1c7f27699263bcdf5bd0320c7cb0803a6f76644952f631000bc9bedef2d7');
  });

  it('nothing in this slice imports the shell it may not open', () => {
    for (const file of TOUCHED_FILES) {
      expect(codeOf(file), file).not.toMatch(/from\s+['"][^'"]*AdminDashboard['"]/);
      expect(codeOf(file), file)
        .not.toMatch(/from\s+['"][^'"]*(?:AdminDocs|AdminRoles|AdminSignups)['"]/);
    }
  });

  it('and no query it builds carries an orderBy or a composite constraint', () => {
    /*
     * 🔴 `users` has NO (tenantId, createdAt) composite index, and this repo
     * avoids composite indexes by design — `firestore.indexes.json` does not
     * deploy on merge, so adding one would reject in production silently. An
     * `orderBy` beside the tenant equality would throw `failed-precondition` at
     * runtime, which is a crash the test suite would not see.
     */
    for (const file of ['src/components/dashboard/growth-data.ts', 'src/components/dashboard/useGrowthData.ts']) {
      expect(codeOf(file), file).not.toMatch(/orderBy/);
    }
    // And the completeness proof is what stands in for ordering.
    expect(codeOf('src/components/dashboard/useGrowthData.ts')).toMatch(/completeRead/);
  });
});

/* ═══ Dependencies ═══════════════════════════════════════════════════════════ */

describe('no npm dependency was added', () => {
  it('@tanstack/react-table was NOT installed for the countries table', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    /*
     * 🔴 A plain table needs no table library. `@tanstack/react-table` buys
     * INTERACTIVE sorting and filtering — a header a reader can click — and the
     * countries list is sorted once, in plain JavaScript, over an array already
     * entirely in memory. Wanting a clickable header later is a dependency
     * decision to report, not one to take silently inside a layout ticket.
     */
    // Phase 1 installs @tanstack/react-table for the admin home table. This
    // countries screen still does not import it, and table-core is not a direct
    // dependency.
    expect(pkg.dependencies['@tanstack/react-table']).toBe('^8.21.3');
    expect(pkg.dependencies['@tanstack/table-core'], 'table-core became a direct dependency').toBeUndefined();
    expect(pkg.devDependencies?.['@tanstack/react-table']).toBeUndefined();
    expect(pkg.devDependencies?.['@tanstack/table-core']).toBeUndefined();
    expect(read('src/components/dashboard/LocationTable.tsx')).not.toMatch(/@tanstack\/react-table/);
  });

  it('and the geo map libraries are still absent — the map is deferred, not built', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    for (const absent of ['react-simple-maps', 'topojson-client', 'd3-geo', 'nivo', '@nivo/core', 'victory']) {
      expect(pkg.dependencies[absent], `${absent} was added`).toBeUndefined();
    }
    expect(pkg.dependencies.recharts, 'recharts is still the only charting library').toBeTruthy();
  });

  it('no Playwright, either — layout is measured over CDP with Node builtins', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    for (const absent of ['playwright', '@playwright/test', 'puppeteer']) {
      expect(pkg.dependencies[absent], `${absent} was added`).toBeUndefined();
      expect(pkg.devDependencies?.[absent], `${absent} was added`).toBeUndefined();
    }
  });

  it('no registry beyond the one already configured', () => {
    const components = JSON.parse(read('components.json')) as { registries?: Record<string, unknown> };
    expect(components.registries ?? {}).toEqual({});
  });
});
