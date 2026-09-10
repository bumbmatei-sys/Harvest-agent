import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import React from 'react';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { rulesDigestFailure } from './__fixtures__/firestore-rules-pin';
import { ownershipFailure } from './__fixtures__/ownership-register';

/**
 * THE-346 · the guards — the map, the primitives, and the house rules.
 *
 * The two files beside this one carry the rest of the ticket:
 *   · `THE-346.six-defects.layout.test.tsx` — every LAYOUT claim, measured in a
 *     real Chromium over CDP at 380 / 768 / 1024 / 1280 / 1440.
 *   · `THE-346.notes-menu-and-nav.test.tsx` — the menu OPENED through the real
 *     `AdminDocs`, its eight rows enumerated, and the bottom nav's three exits.
 *   · `lib/__tests__/the-346-public-note.test.ts` — "Share on web": the link
 *     fetched after revoke, which is the one item here that can leak a note.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

/** Every file this ticket adds or edits. Nothing here is derived from a diff. */
const TOUCHED = [
  'src/components/AdminDocs.tsx',
  'src/components/AdminDashboard.tsx',
  'src/components/AdminScreenHeader.tsx',
  'src/components/AdminCommunity.tsx',
  'src/components/AdminEvents.tsx',
  'src/components/NewsTab.tsx',
  'src/components/ChurchMap.tsx',
  'src/hooks/queries/useDocsQueries.ts',
  'src/lib/public-note.ts',
  'src/lib/analytics/routes.ts',
  'src/app/api/docs/public-share/route.ts',
  'src/app/n/[token]/page.tsx',
] as const;

const MAP = 'src/components/ChurchMap.tsx';

/**
 * Source with its comments removed.
 *
 * EVERY CONTENT GREP IN THIS FILE RUNS OVER THIS, and the reason is written up
 * in `__fixtures__/the-346-strip-comments.ts`, where the implementation lives,
 * and it is checked against TypeScript's own parser in
 * `THE-346.notes-menu-and-nav.test.tsx` rather than trusted — card 86bbxkawp
 * records an inherited stripper that eats ~150 lines of a file. One
 * implementation, checked once.
 */
import { stripComments } from './__fixtures__/the-346-strip-comments';

const code = (rel: string) => stripComments(read(rel));

// ═════════════════════════════════════════════════════════════════════════════
// 12 + 13 · THE MAP — driven, not grepped.
// ═════════════════════════════════════════════════════════════════════════════

/** Props the mocked react-leaflet saw. */
const leaflet = vi.hoisted(() => ({
  mapContainer: null as null | Record<string, unknown>,
  tileLayer: null as null | Record<string, unknown>,
}));

/** A fake Leaflet map, recording what the screen does to it. */
const fakeMap = vi.hoisted(() => ({
  minZoom: 0,
  zoom: 2,
  /** What `getBoundsZoom` will answer — the "what fits this container" value. */
  fits: 0,
  boundsAsked: null as unknown,
  insideAsked: null as unknown,
  handlers: {} as Record<string, () => void>,
  setMinZoom(v: number) { this.minZoom = v; },
  getZoom() { return this.zoom; },
  setZoom(v: number) { this.zoom = v; },
  getBoundsZoom(b: unknown, inside: unknown) { this.boundsAsked = b; this.insideAsked = inside; return this.fits; },
  on(ev: string, fn: () => void) { this.handlers[ev] = fn; },
  off(ev: string) { delete this.handlers[ev]; },
}));

vi.mock('react-leaflet', () => ({
  MapContainer: (props: Record<string, unknown>) => {
    leaflet.mapContainer = props;
    return React.createElement('div', { 'data-map': '' }, props.children as React.ReactNode);
  },
  TileLayer: (props: Record<string, unknown>) => {
    leaflet.tileLayer = props;
    return React.createElement('div', { 'data-tiles': '' });
  },
  Marker: (props: Record<string, unknown>) =>
    React.createElement('div', { 'data-marker': '' }, props.children as React.ReactNode),
  Popup: (props: Record<string, unknown>) =>
    React.createElement('div', {}, props.children as React.ReactNode),
  useMap: () => fakeMap,
}));

vi.mock('leaflet', () => ({
  default: {
    divIcon: (o: Record<string, unknown>) => ({ __icon: o }),
    // The screen patches Leaflet's default marker icon at module scope, so the
    // stub has to carry the shape that patch reaches for.
    Icon: { Default: { prototype: {}, mergeOptions: () => {} } },
  },
}));
vi.mock('leaflet/dist/leaflet.css', () => ({}));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/lib/use-resolved-theme', () => ({ useResolvedTheme: () => 'light' }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}), query: () => ({}), where: () => ({}),
}));
vi.mock('../firebase', () => ({ db: {}, auth: { currentUser: null } }));
vi.mock('../utils/bounded-list-read', () => ({
  readBoundedList: async () => ({ items: [], total: 0, truncated: false }),
  truncationNotice: () => null,
}));
vi.mock('../utils/tenant-scope', () => ({ getTenantScope: async () => 't1' }));
vi.mock('../components/ChurchDetailsModal', () => ({ default: () => null }));
vi.mock('@/utils/placeholder', () => ({ getPlaceholderImage: () => '' }));

const ChurchMap = (await import('../components/ChurchMap')).default;

let container: HTMLDivElement;
let root: Root;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

async function mountMap() {
  await act(async () => {
    root = createRoot(container);
    root.render(<ChurchMap onBack={() => {}} onMapInteraction={() => {}} />);
  });
  await flush();
}

beforeEach(() => {
  leaflet.mapContainer = null;
  leaflet.tileLayer = null;
  fakeMap.minZoom = 0;
  fakeMap.zoom = 2;
  fakeMap.fits = 0;
  fakeMap.handlers = {};
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
  document.body.innerHTML = '';
});

describe('the map cannot zoom out past one world', () => {
  it('declares a `minZoom` floor on the MapContainer itself', async () => {
    // The founder: "In map I should not be able to zoom out this much." His
    // screenshot shows the world three times across with grey void above and
    // below — the void is what zooming out past a single world looks like.
    await mountMap();
    expect(leaflet.mapContainer, 'the map did not mount').toBeTruthy();
    expect(leaflet.mapContainer!.minZoom, 'the map has no zoom floor').toBe(2);
    // `zoom` is only where the map STARTS. A ticket that set the start and
    // called it a floor is the mistake this asserts against.
    expect(leaflet.mapContainer!.zoom).toBe(2);
  });

  it('and RAISES that floor to whatever fits the container, on mount', async () => {
    // 256·2^2 = 1024px of world covers a 380px phone four times over and falls
    // 416px short of a 1440px desktop. A single constant cannot be right at
    // both, and the ticket warns that width is not monotonic — so the floor is
    // asked of Leaflet rather than indexed by breakpoint.
    fakeMap.fits = 3.4;
    await mountMap();
    expect(fakeMap.minZoom, 'the container-fitting floor was never applied').toBe(4);
    expect(fakeMap.insideAsked, 'getBoundsZoom was not asked for the INSIDE fit').toBe(true);
  });

  it('it only ever RAISES — a tiny container cannot talk the map below 2', async () => {
    fakeMap.fits = -3;
    await mountMap();
    expect(fakeMap.minZoom, 'the declared floor was undercut').toBe(2);
  });

  it('and walks the CURRENT view up when the floor rises above it', async () => {
    // A floor that is not enforced on the view you are already looking at only
    // applies to the next gesture, which is not a floor.
    fakeMap.fits = 4.2;
    fakeMap.zoom = 2;
    await mountMap();
    expect(fakeMap.zoom, 'the map was left below its own new floor').toBe(5);
  });

  it('re-applies on resize, because a rotated phone changes the answer', async () => {
    fakeMap.fits = 1.2;
    await mountMap();
    expect(fakeMap.minZoom).toBe(2);
    expect(Object.keys(fakeMap.handlers), 'nothing listens for a resize').toContain('resize');

    fakeMap.fits = 4.9;
    await act(async () => { fakeMap.handlers.resize(); });
    expect(fakeMap.minZoom, 'the floor did not follow the container').toBe(5);
  });

  it('a non-finite answer from Leaflet is ignored rather than applied', async () => {
    fakeMap.fits = Number.NaN;
    await mountMap();
    expect(fakeMap.minZoom, 'NaN reached setMinZoom').toBe(0);
  });
});

describe('the world does not repeat horizontally', () => {
  it('the TILE LAYER is `noWrap` — that is the mechanism, named', async () => {
    // Web Mercator tiles wrap in x by default: once the container is wider than
    // 256·2^z the SAME tiles are re-requested for the next copy, and the same
    // church is drawn in each one. `noWrap` is what stops it.
    await mountMap();
    expect(leaflet.tileLayer, 'the tile layer did not mount').toBeTruthy();
    expect(leaflet.tileLayer!.noWrap, 'the tiles still wrap').toBe(true);
  });

  it('`worldCopyJump` is NOT the lever, and is not pretended to be', async () => {
    // It changes what PANNING does across the seam, not whether the seam
    // exists. Setting it would have looked like a fix and changed nothing.
    await mountMap();
    expect(leaflet.mapContainer!.worldCopyJump).toBeUndefined();
  });

  it('and the map is bounded to one world, so panning cannot reach the void', async () => {
    await mountMap();
    const bounds = leaflet.mapContainer!.maxBounds as [[number, number], [number, number]];
    expect(bounds, 'the map has no maxBounds').toBeTruthy();
    // ±85.05112878, not ±90: Web Mercator is cut at the latitude that makes the
    // world square, and that is the edge tiles exist up to. ±90 would ask
    // Leaflet to fit a strip of map that has no tiles, and `getBoundsZoom`
    // would then answer with a floor one step too low — the void again.
    expect(bounds[0][0]).toBeCloseTo(-85.05112878, 6);
    expect(bounds[1][0]).toBeCloseTo(85.05112878, 6);
    expect(bounds[0][1]).toBe(-180);
    expect(bounds[1][1]).toBe(180);
    expect(leaflet.mapContainer!.maxBoundsViscosity, 'the bounds are soft').toBe(1);
    // The same box is what the zoom floor is derived from, so the two cannot
    // drift apart.
    expect(fakeMap.boundsAsked).toEqual(bounds);
  });
});

describe("#476's map work and THE-342's read are intact", () => {
  it('the tile layer still remounts on a theme toggle — `key={mapTheme}`', () => {
    // react-leaflet creates the underlying L.TileLayer once on mount and does
    // NOT re-issue tiles when the url changes, so the layer must remount or the
    // map stays light until a full reload.
    expect(code(MAP), 'the theme key is gone — the map will not follow a toggle')
      .toMatch(/key=\{mapTheme\}/);
  });

  it('the OSM attribution is byte-identical, and attributionControl is not false', () => {
    // OSM's tile policy requires visible credit. #476 turned
    // `attributionControl={false}` off for exactly that reason.
    expect(read(MAP)).toContain(
      `attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'`,
    );
    expect(code(MAP), 'attribution was switched off again').not.toMatch(/attributionControl=\{false\}/);
    expect(code(MAP), 'the tile host changed').toContain('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  });

  it('the gold and blue markers are untouched', async () => {
    await mountMap();
    // The divIcon template HTML predates this ticket; changing marker colour
    // would be a palette change, not a zoom fix.
    expect(code(MAP)).toContain('#d4a017');
    expect(code(MAP)).toContain('harvest-tiles-dark');
  });

  it("THE-342's bounded read is untouched, and no zoom reaches it", () => {
    // Checked rather than assumed: a zoom floor changes what is DRAWN, not what
    // is FETCHED, so the two do not interact. The read must not have learned
    // about the map's zoom or bounds.
    const src = code(MAP);
    expect(src, 'the bounded read was removed').toMatch(/readBoundedList/);
    expect(src, 'the churches read is unchanged').toMatch(/truncationNotice/);
    const fetchBody = src.slice(src.indexOf('const fetchChurches'), src.indexOf('const fetchChurches') + 2500);
    expect(fetchBody, 'the read started reading the map').not.toMatch(/getZoom|getBounds|minZoom|mapRef/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// "Share on web" — the rules file, and the collection with no rule.
// ═════════════════════════════════════════════════════════════════════════════

describe('Share on web needed no firestore.rules change, and made none', () => {
  it('firestore.rules is at a digest a prior ticket recorded', () => {
    // `firestore.rules` AUTO-DEPLOYS on merge with no emulator tests, and
    // THE-313's one-line change turned 46 files red. This ticket asks the
    // shared register the same question every other pinner does, and records
    // NO digest of its own — THE-333 and THE-341 each spelling one is what
    // turned THE-325 red, twice.
    expect(rulesDigestFailure()).toBeNull();
  });

  it('the share collection has NO rule, which is what makes it server-only', () => {
    const rules = read('firestore.rules');
    expect(rules, 'publicNotes acquired a rule — it must stay unreachable from a browser')
      .not.toMatch(/publicNotes/);
    // And there is no catch-all, so an unruled top-level collection is
    // default-deny rather than default-open. This is the assumption the whole
    // design rests on, so it is asserted rather than believed.
    expect(rules, 'a catch-all match appeared').not.toMatch(/match\s+\/\{document=\*\*\}/);
  });

  it('and /docs/{docId} still requires authentication — the line NOT widened', () => {
    // This is the line a "public link" is naively assumed to need widening, and
    // widening it would expose every note in the collection rather than the one
    // being shared.
    const rules = read('firestore.rules');
    const block = rules.slice(rules.indexOf('match /docs/{docId}'), rules.indexOf('match /docFolders'));
    expect(block).toMatch(/allow read: if isAuthenticated\(\)/);
    expect(block, 'the docs read was opened up').not.toMatch(/allow read: if true/);
  });

  it('every path to a share record goes through the Admin SDK', () => {
    // A client-side Firestore call to `publicNotes` would silently fail closed
    // in production, which is a feature that does not work rather than a leak —
    // but it would also mean the token was never checked anywhere.
    expect(code('src/lib/public-note.ts')).toMatch(/from '@\/lib\/firebase-admin'/);
    for (const rel of ['src/components/AdminDocs.tsx']) {
      expect(code(rel), `${rel} reaches publicNotes from the browser`)
        .not.toMatch(/collection\(db,\s*'publicNotes'/);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 17 · every element that has a primitive uses it.
// ═════════════════════════════════════════════════════════════════════════════

describe('every element this ticket touches uses its primitive', () => {
  it('the 43 installed primitives are enumerated from disk, not from a list', () => {
    // The ticket's own lists have been wrong repeatedly, so this is read.
    const dir = path.join(ROOT, 'src/components/ui');
    const installed = readdirSync(dir)
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => f.replace(/\.tsx$/, ''))
      .sort();
    expect(installed.length, 'the primitive count moved').toBe(43);
    expect(installed, 'accordion is the one absent primitive').not.toContain('accordion');
    for (const needed of ['dropdown-menu', 'tabs', 'toggle-group', 'button-group', 'switch', 'dialog', 'sheet', 'popover', 'alert']) {
      expect(installed, `${needed} is missing`).toContain(needed);
    }
  });

  it('the note menu is `dropdown-menu`, with the Export submenu as `DropdownMenuSub`', () => {
    const src = code('src/components/AdminDocs.tsx');
    for (const part of [
      'DropdownMenu', 'DropdownMenuTrigger', 'DropdownMenuContent',
      'DropdownMenuItem', 'DropdownMenuSeparator',
      'DropdownMenuSub', 'DropdownMenuSubTrigger', 'DropdownMenuSubContent',
    ]) {
      expect(src, `${part} is not used — the menu is hand-rolled again`).toContain(part);
    }
  });

  it('and the hand-rolled menu it replaced is GONE, not merely unused', () => {
    const src = code('src/components/AdminDocs.tsx');
    // The old menu was a `relative` div with an absolutely-positioned panel and
    // its own outside-click listener. Any of those coming back means a second,
    // hand-written menu on this screen.
    expect(src, 'the hand-rolled dropdown panel came back')
      .not.toMatch(/absolute right-0 top-full[^"]*w-48/);
    expect(src, 'the hand-rolled outside-click listener came back')
      .not.toMatch(/addEventListener\('mousedown'/);
    expect(src, 'the labelled Export trigger came back').not.toMatch(/triggerLabel/);
  });

  /**
   * PER ELEMENT, THE PRIMITIVE REJECTED AND WHY. "It did not fit" is not an
   * answer, so each entry names the primitive and the property that rules it
   * out. This is a record, and the test is that it stays a complete one: every
   * element this ticket shipped has a row.
   */
  const PRIMITIVE_DECISIONS: Record<string, string> = {
    'the note menu':
      'ADOPTED `dropdown-menu`. REJECTED `popover`, which has no roving focus, no ' +
      'typeahead and no `menuitem` roles, so a keyboard user would tab through the ' +
      'page behind it — the exact defect the hand-rolled version had. REJECTED ' +
      '`sheet`, which is a phone surface and would put a bottom sheet on a desktop ' +
      'toolbar. REJECTED `context-menu`, whose trigger is a right-click and this ' +
      'one is a tapped button. REJECTED `command`, which is a search palette over ' +
      'many items and this is eight fixed rows.',
    'the Export submenu':
      'ADOPTED `DropdownMenuSub`, the same shape AttachMenu uses for its four ' +
      'category flyouts — the founder asked for "something like the paperclip from ' +
      'chat" by name. REJECTED `collapsible`, which expands IN PLACE and would push ' +
      'the five rows below it down the screen every time Export was touched. ' +
      'REJECTED `dialog`, which would interrupt the note to ask a question with ' +
      'three answers.',
    'the Share on web toggle':
      'REJECTED `switch`, and this is the one worth spelling out: a switch is a ' +
      'form control whose state you set and submit, and this row PERFORMS an action ' +
      'that reaches the open web. It also reads as reversible in a way this is not ' +
      '— revoking mints a new token, so the old link never comes back. A menu row ' +
      'whose LABEL says which way it goes ("Stop sharing on web") says that; a tick ' +
      'beside "Share on web" does not. REJECTED `checkbox` for the same reason.',
    'the List/Month control':
      'KEPT `tabs`, which THE-308 already adopted here and which is correct: two ' +
      'mutually exclusive views of the same collection, each with a panel. ' +
      'REJECTED `toggle-group`, which has no panel relationship and would leave the ' +
      'month grid mounted beside a control that only looked like tabs. REJECTED ' +
      '`button-group`, which is a row of independent actions, not a selection. ' +
      'REJECTED `select`, which hides the alternative behind a tap and whose height ' +
      'is set by an attribute selector that OUTRANKS Rule 4 at 32px.',
    'the expand toggle':
      'REJECTED `toggle`, whose pressed state is a filled background — on a header ' +
      'that already carries a gold back-link and a menu trigger, a third visual ' +
      'weight for a control that changes nothing about the note. It is a `button` ' +
      'with `aria-pressed`, which is what `toggle` renders underneath. REJECTED ' +
      '`switch`, which is a form control.',
    'the chat composer':
      'NO PRIMITIVE. The fix is one negative margin cancelling an ancestor\'s ' +
      'padding; there is no component here to adopt, and `input-group` would ' +
      'restyle a composer the founder did not complain about.',
    'the news composer action row':
      'NO PRIMITIVE. The fix is the removal of one padding class. `button-group` ' +
      'was REJECTED: it would visually join the paperclip, Pin and Post into one ' +
      'segmented control, and Post is a submit while the other two are toggles.',
    'the map controls':
      'NO PRIMITIVE. Leaflet owns the map surface and its controls are its own DOM, ' +
      'outside React\'s tree. The fix is configuration — a zoom floor and a ' +
      'non-wrapping tile layer — and no primitive renders either.',
    'the bottom nav':
      'NO PRIMITIVE. `sidebar` is REJECTED: it is installed and it is a different ' +
      'component with its own provider, trigger and state, and the shell\'s nav rail ' +
      'is THE-332\'s and not this ticket\'s to compose. The change is one wrapper ' +
      'whose only job is `display`.',
  };

  it('names a primitive decision for every element this ticket shipped', () => {
    for (const [element, why] of Object.entries(PRIMITIVE_DECISIONS)) {
      expect(why.length, `${element}: the reason is too short to be one`).toBeGreaterThan(120);
      expect(
        /REJECTED|NO PRIMITIVE/.test(why),
        `${element}: no primitive is named as rejected`,
      ).toBe(true);
      expect(why, `${element}: "it did not fit" is not an answer`).not.toMatch(/did not fit/i);
    }
    expect(Object.keys(PRIMITIVE_DECISIONS).length).toBe(9);
  });

  it('and every primitive named as adopted is one that exists on disk', () => {
    const installed = new Set(
      readdirSync(path.join(ROOT, 'src/components/ui'))
        .filter((f) => f.endsWith('.tsx'))
        .map((f) => f.replace(/\.tsx$/, '')),
    );
    for (const name of ['dropdown-menu', 'tabs', 'popover', 'sheet', 'context-menu', 'command', 'collapsible', 'dialog', 'switch', 'checkbox', 'toggle-group', 'button-group', 'select', 'toggle', 'input-group', 'sidebar']) {
      expect(installed, `${name} is named in a decision but is not installed`).toContain(name);
    }
  });
});

/** This ticket's own suites. */
const OWN_SUITES = [
  'src/__tests__/the-346-guards.test.tsx',
  'src/components/__tests__/THE-346.six-defects.layout.test.tsx',
  'src/components/__tests__/THE-346.notes-menu-and-nav.test.tsx',
  'src/lib/__tests__/the-346-public-note.test.ts',
] as const;

// ═════════════════════════════════════════════════════════════════════════════
// 19 · no colour hardcoded, no emoji, no raw Tailwind scale.
// ═════════════════════════════════════════════════════════════════════════════

describe('no colour hardcoded, no emoji, no raw Tailwind scale', () => {
  /**
   * A CLOSED RECORD PER FILE, NOT "none", and the shape is THE-345's for the
   * same reason: every one of these files except the three this ticket ADDED
   * already carried colour literals before it, so a blanket ban would fail on
   * somebody else's work while proving nothing about this ticket's. The lists
   * are what each file spells TODAY, so a literal that arrives later - from
   * this ticket or any other - appears here and fails, which is the property
   * that matters. No branch diff is consulted to establish it.
   *
   * The three files this ticket ADDED are recorded at ZERO, which is the
   * stronger claim and the one it can actually make.
   */
  const RECORDED_COLOUR_LITERALS: Record<string, readonly string[]> = {
    // ADDED by this ticket — none, and none allowed.
    'src/lib/public-note.ts': [],
    'src/app/api/docs/public-share/route.ts': [],
    'src/app/n/[token]/page.tsx': [],
    'src/hooks/queries/useDocsQueries.ts': [],
    // EDITED. Pre-existing `var(--brand-color, #d4a017)` fallbacks, six of
    // them, on the create/move buttons, the folder glyph and the spinner. This
    // ticket REMOVED two literals from this file — the delete row's
    // `text-red-600 hover:bg-red-50` — and added none.
    'src/components/AdminDocs.tsx': ['#d4a017', '#d4a017', '#d4a017', '#d4a017', '#d4a017', '#d4a017'],
    // Pre-existing: the shared header's own brand fallback.
    'src/components/AdminScreenHeader.tsx': ['#B8962E'],
    // Pre-existing: five brand/status fallbacks and one THE-345 green.
    'src/components/AdminEvents.tsx': ['#d4a017', '#d4a017', '#d4a017', '#d4a017', '#d4a017', '#6E8E52', '#d4a017'],
    // Pre-existing and #476's: the gold and blue divIcon marker templates and
    // the three shadow rgba()s inside them. Marker colour is a palette change,
    // not a zoom fix, so this ticket leaves them and reports them.
    'src/components/ChurchMap.tsx': ['#d4a017', 'rgba(', '#3b82f6', 'rgba(', 'rgba('],
  };

  const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g;

  it('introduces no colour literal', () => {
    for (const [rel, allowed] of Object.entries(RECORDED_COLOUR_LITERALS)) {
      expect(code(rel).match(LITERAL) ?? [], `${rel} mints a colour literal`).toEqual(allowed);
    }
  });

  /**
   * The same shape for the raw Tailwind scale. `divide-stone-*` and every
   * sibling is forbidden, and three of these files carried some before this
   * ticket — AdminEvents' status pills, AdminCommunity's avatars, NewsTab's
   * delete confirmations. They are recorded rather than swept up: rewriting
   * another ticket's status pills is a palette change and not this ticket's.
   */
  const RECORDED_SCALE: Record<string, readonly string[]> = {
    'src/lib/public-note.ts': [],
    'src/app/api/docs/public-share/route.ts': [],
    'src/app/n/[token]/page.tsx': [],
    'src/hooks/queries/useDocsQueries.ts': [],
    'src/components/AdminScreenHeader.tsx': [],
    'src/components/ChurchMap.tsx': [],
    // ONE, on the delete modal's confirm button, and it PREDATES this ticket.
    // The two this ticket found on the note menu's delete ROW —
    // `text-red-600 hover:bg-red-50` — are gone, replaced by the primitive's
    // own destructive variant, which reads the theme.
    'src/components/AdminDocs.tsx': ['bg-red-500'],
  };

  it('adds no raw Tailwind colour scale — `divide-stone-*` and every sibling', () => {
    const SCALE = /\b(?:text|bg|border|divide|ring|from|via|to|fill|stroke|shadow|outline|accent|caret|decoration|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;
    for (const [rel, allowed] of Object.entries(RECORDED_SCALE)) {
      expect(code(rel).match(SCALE) ?? [], `${rel} uses a raw Tailwind scale`).toEqual(allowed);
    }
  });

  it('and the destructive row goes through the primitive rather than a red', () => {
    const src = code('src/components/AdminDocs.tsx');
    expect(src, 'the delete row stopped using the primitive variant').toMatch(/variant="destructive"/);
    expect(src, 'the hardcoded red came back').not.toMatch(/text-red-600|hover:bg-red-50/);
  });

  it('ships no emoji, in code or in comments', () => {
    // Files this ticket ADDED must carry none at all; the EDITED ones are swept
    // by their own tickets' guards, and several carried some before this one.
    const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{FE0F}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu;
    const ADDED = [
      'src/lib/public-note.ts',
      'src/app/api/docs/public-share/route.ts',
      'src/app/n/[token]/page.tsx',
      'src/__tests__/__fixtures__/the-346-strip-comments.ts',
      // ChurchMap carried none before this ticket and must still carry none —
      // the-333 and THE-342 both sweep its RAW source, comments included.
      'src/components/ChurchMap.tsx',
    ];
    for (const rel of ADDED) {
      expect(read(rel).match(EMOJI) ?? [], `${rel} ships an emoji`).toEqual([]);
    }
    // Non-vacuity: the pattern really does catch what it claims to.
    expect('a \u{1F534} b'.match(EMOJI) ?? []).toHaveLength(1);
    expect('a \u26A0\uFE0F b'.match(EMOJI) ?? []).not.toEqual([]);
  });

  it('and writes LF, never CRLF', () => {
    for (const rel of [...TOUCHED, ...OWN_SUITES, 'src/__tests__/__fixtures__/the-346-strip-comments.ts']) {
      expect(read(rel).includes('\r\n'), `${rel} contains a CRLF line ending`).toBe(false);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 20-22 · the house rules about the guards themselves.
// ═════════════════════════════════════════════════════════════════════════════


describe('no test in this PR pins a line number', () => {
  it('every surface is discovered by pattern', () => {
    // THE-331 pinned `AdminCommunity.tsx:491`; a deletion shifted it to `:311`,
    // so the suite would have MEASURED WHATEVER LANDED THERE rather than
    // failing. Comments may still discuss line numbers; code may not use one.
    // SAME-LINE, not `\s*`: a multi-line array of file paths would otherwise
    // read as `…tsx',` followed by whatever number began the next line.
    const COORDINATE = /\.tsx?['"]?[ \t]*[,:][ \t]*\d+/;
    const BY_LINE_INDEX = /split\([`'"]\\n[`'"]\)[ \t]*\[[ \t]*\d+/;
    for (const rel of OWN_SUITES) {
      const src = stripComments(read(rel));
      expect(src, `${rel} pins a source coordinate`).not.toMatch(COORDINATE);
      expect(src, `${rel} slices a file by line index`).not.toMatch(BY_LINE_INDEX);
    }
  });
});

describe('no fixture is pinned to a date near today', () => {
  it('and no suite here reads the wall clock without freezing it', () => {
    for (const rel of OWN_SUITES) {
      const src = stripComments(read(rel));
      // A fixture dated near the run date passes today and fails in a month.
      expect(src, `${rel} builds a fixture from the current date`)
        .not.toMatch(/new Date\(\)|Date\.now\(\)/);
      // And if a later edit needs time, `toFake` is load-bearing: without it
      // `useFakeTimers` leaves `Date` real and the freeze does nothing.
      const fake = src.match(/useFakeTimers\(([^)]*)\)/g) ?? [];
      for (const call of fake) {
        expect(call, `${rel}: useFakeTimers without toFake — Date is not frozen`)
          .toMatch(/toFake/);
      }
    }
  });
});

describe('no guard in this PR asserts anything about the current branch\'s diff', () => {
  it('nothing shells out to git, and nothing compares against a revision', () => {
    // A guard that reads the branch's own diff passes on any change it made and
    // proves nothing about the file. Every baseline here is a literal or is
    // discovered from the file as it stands.
    // ASSEMBLED FROM FRAGMENTS so that naming them here does not make this
    // file trip its own sweep. A list spelled verbatim would fail on itself,
    // and the usual escape — exempting this file — would exempt the very file
    // most able to break the rule.
    const FORBIDDEN = [
      'exec' + 'FileSync',
      'exec' + 'Sync',
      'spawn' + 'Sync',
      'child' + '_process',
      'git ' + 'diff',
      'git ' + 'show',
      'origin' + '/main',
      'HEAD' + '~',
    ];
    for (const rel of OWN_SUITES) {
      const src = stripComments(read(rel));
      for (const forbidden of FORBIDDEN) {
        expect(src, `${rel} consults the branch: ${forbidden}`).not.toContain(forbidden);
      }
    }
    // Non-vacuity: the sweep really does catch what it claims to. The probe is
    // assembled the same way, for the same reason.
    const probe = `const x = ${'exec' + 'FileSync'}('git');`;
    expect(FORBIDDEN.some((f) => probe.includes(f)), 'the sweep would miss a real call').toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 23 · the files this ticket must not touch.
// ═════════════════════════════════════════════════════════════════════════════

describe('firestore.indexes.json, functions/ and layout.tsx are byte-identical', () => {
  it('firestore.indexes.json is unchanged', () => {
    // It does NOT deploy on merge — `deploy-rules.yml` runs
    // `firestore:rules,storage` only — so an index added there is inert and the
    // query that needed it throws `failed-precondition` in production. The
    // share lookup is a `get()` by primary key and needs none.
    expect(sha256(readFileSync(path.join(ROOT, 'firestore.indexes.json'))))
      .toBe('8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0');
  });

  it('layout.tsx is unchanged', () => {
    expect(sha256(readFileSync(path.join(ROOT, 'src/app/layout.tsx'))))
      .toBe('b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f');
  });

  it('functions/ is unchanged', () => {
    expect(functionsDigest()).toBe('4016dc6b342dcbbf44b94994d35d01781c015035205616d4798c142199a1b5bf');
  });
});

/** Every file under `functions/`, hashed as one, so an addition shows too. */
function functionsDigest(): string {
  const dir = path.join(ROOT, 'functions');
  if (!existsSync(dir)) return 'ABSENT';
  const files: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d).sort()) {
      if (entry === 'node_modules' || entry === '.git') continue;
      const full = path.join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(dir);
  const h = createHash('sha256');
  for (const f of files) {
    h.update(path.relative(ROOT, f));
    h.update(readFileSync(f));
  }
  return h.digest('hex');
}

// ═════════════════════════════════════════════════════════════════════════════
// The ownership register — this ticket records what it owns.
// ═════════════════════════════════════════════════════════════════════════════

describe('THE-346 records what it owns, and appends rather than substitutes', () => {
  it.each(TOUCHED.filter((f) => f.startsWith('src/components/')))(
    '%s is at a recorded digest',
    (rel) => {
      expect(ownershipFailure(rel)).toBeNull();
    },
  );
});
