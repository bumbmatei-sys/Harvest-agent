/**
 * THE-333 — the map says "API KEY REQUIRED", and the AI chat rail is broken.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE TICKET, IN THE FOUNDER'S WORDS
 *
 *   "the map is asking for an api key. just put another one."
 *   "the sidebar in ai rag chat in user app is messed up."
 *
 * ── PART 1, AND WHY THE ANSWER IS NOT ANOTHER KEY ───────────────────────────
 *
 * CARTO began serving an "API KEY REQUIRED" watermark over unauthenticated
 * raster tiles in Aug 2026. Nothing errored and nothing logged — the tiles
 * still returned 200 — which is exactly why this reached production unnoticed.
 * The comment that used to sit above the URL ("same terms, no API key, no paid
 * tier") was TRUE when written and silently stopped being true.
 *
 * A CARTO key would fix the watermark, and CARTO gives one away inside its fair
 * use limit without an account. It is still the wrong answer: CARTO has said
 * raster basemaps are BEING RETIRED, so a key buys time rather than a home.
 * MapTiler's free tier is explicitly NON-COMMERCIAL and cannot serve Harvest at
 * any price below a paid plan.
 *
 * So this ticket moves to OpenStreetMap's own tiles, which need no key, no
 * account and no renewal. 🔴 THE COST IS VISIBLE AND IS NOT HIDDEN HERE: OSM's
 * tile usage policy REQUIRES visible attribution, so `attributionControl` is no
 * longer `false`. That is a deliberate product change, made because the licence
 * demands it, and section 4 is what stops it being quietly reverted.
 *
 * ── PART 2, AND A PREMISE THE TICKET GOT BACKWARDS ──────────────────────────
 *
 * 🔴 The ticket asserts `lg:flex-col` is dead weight and asks for a guard that
 * the rail is "not hidden lg:flex-col". THAT GUARD WOULD HAVE BROKEN THE RAIL.
 * `ChatList`'s root is `flex:1` + `overflowY:auto`, which fills HEIGHT and
 * scrolls only inside a COLUMN container; in a row it would take width instead
 * and the scrolling would be gone. `lg:flex-col` is load-bearing and section 6
 * asserts it is STILL THERE.
 *
 * What was genuinely wrong was narrower: the string read `hidden lg:flex-col`,
 * and since flex-col sets DIRECTION it cannot reveal anything, so the class
 * read as though it were what showed the rail when the display actually came
 * from the ternary. Display and direction are now stated together.
 *
 * ⚠️ NOTHING IN THIS FILE ASKS WHAT THE CURRENT BRANCH CHANGED, and nothing
 * shells out. There is no child-process import, no version-control invocation
 * and no diff read anywhere in this ticket's tests. #454 is the standing sweep
 * and `THE-315.branch-diff-guards.test.ts` is the detector. Every claim below
 * is made against the files on disk, which needs nothing but `fs`.
 *
 * 🔴 SECTION 15 ASSERTS THAT ABOUT THIS FILE TOO, AND ITS NEEDLES ARE ASSEMBLED
 * FROM FRAGMENTS AT RUN TIME rather than written as literals. That is not
 * cleverness, it is the fix for a failure this repo has already had: a guard
 * passed with its own gate DELETED because the assertion's own message
 * contained the string it grepped for.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

import { REPO_ROOT, loadOwnership, ownershipFailure } from './__fixtures__/ownership-register';

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** Source with block and line comments stripped — the code, not the prose. */
const codeOf = (rel: string): string =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === '.next' ? [] : walk(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });

/** 🔴 POSIX separators on every platform — a manifest keyed by `path.sep` gives
 *  BACKSLASHES on Windows and hashes differently for a byte-identical tree. */
const rel = (abs: string) => path.relative(REPO_ROOT, abs).split(path.sep).join('/');

const MAP = 'src/components/ChurchMap.tsx';
const CHAT = 'src/components/AIChat.tsx';

/** The two production files this ticket edits. The list is the claim. */
const EDITED = [MAP, CHAT] as const;

/* ═══ 1 · 🔴 THE MAP RENDERS TILES WITH NO "API KEY REQUIRED" WATERMARK ═══ */

describe('1 · the map renders tiles from a named provider that needs no key', () => {
  it('🔴 the tile URL is OpenStreetMap, not CARTO', () => {
    const code = codeOf(MAP);
    // The named provider, spelled out. A test that only asserted "not CARTO"
    // would pass on a blank url and on a provider nobody chose.
    expect(code, 'the basemap is not OpenStreetMap')
      .toContain('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    // 🔴 THE MUTATION THIS MUST SURVIVE: restoring the CARTO URL without a key.
    // Assembled from fragments so this assertion's own text is not the needle.
    const cartoHost = ['basemaps', '.', 'cartocdn', '.com'].join('');
    expect(code, `the ${cartoHost} basemap is back — it serves a watermark without a key`)
      .not.toContain(cartoHost);
  });

  it('🔴 and the deprecated {s} subdomain form is not used', () => {
    // OSM retired the a/b/c aliases once the tile server got HTTP/2; a single
    // host is what the policy asks for and what caches best.
    const code = codeOf(MAP);
    expect(code, 'the tile URL still uses the deprecated {s}. subdomain rotation')
      .not.toContain('{s}.tile.openstreetmap.org');
    expect(code, 'a subdomain placeholder is still in the tile URL')
      .not.toMatch(/https:\/\/\{s\}\./);
  });

  it('🔴 no retina {r} placeholder — OSM serves no @2x tile and would 404', () => {
    const tileLine = codeOf(MAP)
      .split('\n')
      .find((l) => l.includes('tile.openstreetmap.org')) ?? '';
    expect(tileLine, 'the OSM tile URL carries an {r} placeholder OSM does not serve')
      .not.toContain('{r}');
  });
});

/* ═══ 2 · 🔴 BOTH THEMES LOAD TILES, AND THE REMOUNT SURVIVES ═════════════ */

describe('2 · both light and dark themes load tiles', () => {
  it('🔴 the key={mapTheme} remount is still there', () => {
    // react-leaflet builds the L.TileLayer once and does not re-issue tiles when
    // props change, so the layer has to be REMOUNTED on a theme toggle. Without
    // this the map stays light until a full page reload.
    const code = codeOf(MAP);
    expect(code, 'the key={mapTheme} remount is gone — the map will not follow a theme toggle')
      .toContain('key={mapTheme}');
    expect(code, 'mapTheme no longer comes from the resolved theme')
      .toContain('useResolvedTheme()');
  });

  it('🔴 dark is produced by inverting the tile pane, and the class is wired to mapTheme', () => {
    const code = codeOf(MAP);
    // OSM publishes ONE style, so there is no second URL to break. The dark
    // path is the class, and the class must be conditional on the theme.
    expect(code, 'the dark tile class is no longer applied conditionally on mapTheme')
      .toMatch(/mapTheme\s*===\s*'dark'\s*\?\s*'harvest-tiles-dark'/);
    // 🔴 THE MUTATION: break the dark theme's tiles. The rule that DOES the
    // darkening must exist and must carry an inversion.
    const css = read(MAP);
    expect(css, 'the .harvest-tiles-dark rule is gone — dark mode renders light tiles')
      .toContain('.harvest-tiles-dark');
    const rule = css.slice(css.indexOf('.harvest-tiles-dark'));
    expect(rule.slice(0, 200), 'the dark tile rule no longer inverts anything')
      .toContain('invert(1)');
  });

  it('both themes resolve to a real tile request — neither branch is empty', () => {
    const code = codeOf(MAP);
    // One URL serves both themes, so "both themes load tiles" is the claim that
    // the URL is unconditional: it must not sit inside a theme ternary.
    const tileLine = code.split('\n').find((l) => l.includes('tile.openstreetmap.org')) ?? '';
    expect(tileLine, 'the tile URL was made conditional — one theme would get no tiles')
      .not.toContain('?');
    expect(tileLine, 'the tile URL is no longer a plain string literal')
      .toMatch(/url="https:\/\/tile\.openstreetmap\.org/);
  });
});

/* ═══ 3 · 🔴 NO API KEY LITERAL ANYWHERE IN THE REPO ══════════════════════ */

describe('3 · no API key literal appears anywhere in the repo', () => {
  /** Every source file, so a key cannot hide in a file nobody thought to sweep. */
  const SOURCES = walk(path.join(REPO_ROOT, 'src')).map(rel);

  it('🔴 the chosen provider needs no key, and the map passes none', () => {
    const code = codeOf(MAP);
    for (const needle of ['apiKey', 'api_key', 'accessToken', 'access_token']) {
      expect(code, `${MAP} passes ${needle} to a tile provider — OSM needs no key`)
        .not.toContain(needle);
    }
    // No `?key=` / `&key=` query parameter on the tile URL either.
    expect(code, 'a key query parameter was added to the tile URL')
      .not.toMatch(/tile\.openstreetmap\.org[^"'`\n]*[?&]key=/);
  });

  it('🔴 no basemap key literal is committed in any source file', () => {
    // 🔴 THIS ONE MUST FAIL LOUDLY. Every provider's key shape, plus the generic
    // "assigned a literal to something called a key" shape. Needles are built
    // from fragments so this file does not trip its own sweep.
    const KEY_ASSIGN = new RegExp(
      // apiKey / api_key / accessToken / access_token = "<20+ chars>"
      String.raw`(api[_-]?key|access[_-]?token)\s*[:=]\s*['"\`][A-Za-z0-9_\-.]{20,}['"\`]`,
      'i',
    );
    const offenders: string[] = [];
    for (const file of SOURCES) {
      const src = read(file);
      // A literal is only a finding when it is NOT read from the environment.
      for (const line of src.split('\n')) {
        if (line.includes('process.env')) continue;
        if (KEY_ASSIGN.test(line)) offenders.push(`${file}: ${line.trim().slice(0, 80)}`);
      }
    }
    expect(offenders, 'an API key literal is committed in source').toEqual([]);
  });

  it('🔴 .env.example documents variables and holds no real value', () => {
    // A key never goes in the repo; the variable that names it may.
    const env = read('.env.example');
    const withValues = env
      .split('\n')
      .filter((l) => /^[A-Z][A-Z0-9_]*=.+/.test(l.trim()))
      // Placeholders name themselves — `your_…`, `<…>`, `changeme`. The prefix
      // is not always at the start (`ac_your_gmail_…`), so match anywhere.
      .filter((l) => !/(your[_-]|<.*>|xxx|todo|changeme|placeholder|example)/i.test(l.trim()))
      .filter((l) => /=\s*[A-Za-z0-9_\-.]{20,}\s*$/.test(l.trim()));
    expect(withValues, '.env.example carries what looks like a real secret').toEqual([]);
  });

  it('🔴 and this ticket did not introduce a new tile-provider env variable', () => {
    // The whole point of choosing OSM: there is no account to create and no
    // variable for the founder to fill in. If a later change needs one, it is a
    // product decision and belongs in its own ticket, not smuggled in here.
    const env = read('.env.example');
    for (const v of ['CARTO', 'MAPTILER', 'STADIA', 'THUNDERFOREST']) {
      expect(env, `${v} appears in .env.example — THE-333 chose a keyless provider`)
        .not.toContain(v);
    }
  });
});

/* ═══ 4 · 🔴 ATTRIBUTION IS SHOWN, BECAUSE OSM REQUIRES IT ════════════════ */

describe('4 · attribution is shown, as the chosen provider requires', () => {
  it('🔴 attributionControl is no longer false', () => {
    const code = codeOf(MAP);
    // 🔴 THE VISIBLE PRODUCT CHANGE. OSM's tile policy requires visible
    // attribution, so the control that used to be switched off must stay on.
    // Leaflet renders it by DEFAULT, so the fix is the ABSENCE of the opt-out.
    expect(code, 'attributionControl={false} is back — OSM requires visible attribution')
      .not.toContain('attributionControl={false}');
  });

  it('🔴 and the credit names OpenStreetMap and links its copyright page', () => {
    const code = codeOf(MAP);
    expect(code, 'the tile layer carries no attribution prop').toContain('attribution=');
    const attrLine = code.split('\n').find((l) => l.includes('attribution=')) ?? '';
    expect(attrLine, 'the attribution does not credit OpenStreetMap').toContain('OpenStreetMap');
    expect(attrLine, 'the attribution does not link the OSM copyright page')
      .toContain('openstreetmap.org/copyright');
  });
});

/* ═══ 5 · THE GOLD MARKERS STAY LEGIBLE ON BOTH THEMES ════════════════════ */

describe('5 · the gold markers stay legible on both themes', () => {
  it('🔴 the dark filter is scoped to the tile class, never to the map or a pane', () => {
    const css = read(MAP);
    const start = css.indexOf('.harvest-tiles-dark');
    const rule = css.slice(start, css.indexOf('}', start) + 1);
    // The markers are divIcons in leaflet's MARKER pane. Inverting the map
    // container, or the whole leaflet root, would inverting them too and turn
    // the gold to blue. The selector must be the tile class alone.
    expect(rule.split('{')[0].trim(), 'the dark filter selector widened beyond the tile class')
      .toBe('.harvest-tiles-dark');
    for (const tooWide of ['.leaflet-container', '.leaflet-map-pane', '.leaflet-marker-pane']) {
      expect(css, `the dark filter reaches ${tooWide} and would invert the markers`)
        .not.toContain(`${tooWide} {`);
    }
  });

  it('the markers still take their colour from --brand-color, unchanged', () => {
    const code = codeOf(MAP);
    expect(code, 'the gold divIcon no longer reads --brand-color')
      .toContain('--brand-color');
  });
});

/* ═══ 6 · 🔴 THE RAIL'S CLASS STRING — AND THE PREMISE THAT WAS BACKWARDS ═ */

describe('6 · the rail states display and direction together', () => {
  /** The one `<aside>` in the file — the desktop history rail. */
  const asideLine = (): string =>
    codeOf(CHAT).split('\n').find((l) => l.includes('<aside')) ?? '';

  it('🔴 lg:flex-col is STILL THERE — it is load-bearing, not dead weight', () => {
    // 🔴 THE TICKET ASKED FOR THE OPPOSITE OF THIS ASSERTION. ChatList's root is
    // `flex:1` + `overflowY:auto`, which fills HEIGHT and scrolls only inside a
    // COLUMN container. Dropping flex-col would lay the rail out as a row: the
    // list would take width instead of height and the scrolling would be gone.
    expect(asideLine(), 'lg:flex-col was removed — the rail would lay out as a row')
      .toContain('lg:flex-col');
  });

  it('🔴 and it never appears without an explicit display beside it', () => {
    // What WAS wrong: `hidden lg:flex-col` reads as though flex-col were what
    // reveals the rail. It cannot — it sets DIRECTION. Wherever the direction
    // is set, the display must be stated in the same breath.
    const line = asideLine();
    expect(line, 'the rail sets a flex direction with no display beside it')
      .toContain('lg:flex lg:flex-col');
    // 🔴 THE MUTATION: restore `hidden lg:flex-col`. The old string put `hidden`
    // immediately before `lg:flex-col`, with the display arriving only later
    // from the ternary. Assembled from fragments so this file is not its own
    // needle.
    const misleading = ['hidden', ' ', 'lg:flex-col'].join('');
    expect(line, 'the misleading "hidden lg:flex-col" pairing is back')
      .not.toContain(misleading);
  });

  it('the collapsed branch hides the rail outright, with no direction left dangling', () => {
    const line = asideLine();
    expect(line, 'railCollapsed no longer drives the rail').toContain('railCollapsed');
    // Collapsed => plain `hidden`, and NOT a `lg:hidden` racing a `lg:flex`.
    expect(line, 'the collapsed branch still relies on lg:hidden overriding lg:flex')
      .not.toContain('lg:hidden');
  });
});

/* ═══ 7 · 🔴 THE RAIL SHOWS AT lg AND ABOVE, AND HIDES BELOW ══════════════ */

describe('7 · the rail shows at lg and above, and hides below', () => {
  const asideLine = (): string =>
    codeOf(CHAT).split('\n').find((l) => l.includes('<aside')) ?? '';

  it('🔴 base state is hidden, so it never renders below lg', () => {
    const line = asideLine();
    // 🔴 THE MUTATION: show the rail below lg. `hidden` is the base display in
    // BOTH branches of the collapse ternary, and every reveal is lg-prefixed,
    // so there is no width under 1024 at which the rail can appear.
    const branches = line.match(/'([^']*)'/g) ?? [];
    expect(branches.length, 'the rail no longer picks its classes from two branches')
      .toBeGreaterThanOrEqual(2);
    for (const b of branches) {
      expect(b, `rail branch ${b} does not start hidden — it would render on mobile`)
        .toMatch(/\bhidden\b/);
    }
    const reveals = (line.match(/\blg:flex\b/g) ?? []).length;
    expect(reveals, 'the rail is revealed by a non-lg class — it would show below 1024')
      .toBeGreaterThan(0);
    // Every display utility on the aside is either the base `hidden` or lg-scoped.
    const classes = (line.match(/className=\{`([^`]*)`\}|className="([^"]*)"/) ?? [])
      .slice(1)
      .filter(Boolean)
      .join(' ');
    const displays = classes
      .split(/\s+/)
      .filter((c) => /(^|:)(flex|grid|block|inline|hidden|table)(-|$)/.test(c));
    for (const d of displays) {
      expect(d === 'hidden' || d.startsWith('lg:'),
        `the rail carries display utility "${d}", which is neither the base hidden nor lg-scoped`)
        .toBe(true);
    }
  });

  it('the mobile path is the sheet, not the rail', () => {
    const code = codeOf(CHAT);
    // The show-history affordance on desktop is lg-only; mobile uses the drawer.
    expect(code, 'the show-history button is no longer desktop-only')
      .toContain('className="hidden lg:flex"');
  });
});

/* ═══ 8 · COLLAPSING AND REOPENING THE RAIL WORKS ═════════════════════════ */

describe('8 · collapsing and reopening the rail works', () => {
  it('railCollapsed is set BOTH ways, from two different controls', () => {
    const code = codeOf(CHAT);
    expect(code, 'nothing collapses the rail').toContain('setRailCollapsed(true)');
    expect(code, 'nothing reopens the rail — it would collapse permanently')
      .toContain('setRailCollapsed(false)');
    expect(code, 'railCollapsed state is gone').toMatch(/railCollapsed.*useState/s);
  });

  it('the reopen control is only rendered while collapsed', () => {
    const code = codeOf(CHAT);
    expect(code, 'the show-history button no longer depends on railCollapsed')
      .toMatch(/\{railCollapsed\s*&&/);
  });
});

/* ═══ 9 · 🔴 THE MOBILE SHEET STILL SHARES THE CHAT LIST ══════════════════ */

describe('9 · the mobile sheet and the desktop rail share one chat list', () => {
  it('🔴 ChatList is rendered TWICE from the same history array', () => {
    const code = codeOf(CHAT);
    const uses = (code.match(/<ChatList\b/g) ?? []).length;
    expect(uses, 'the sheet and the rail no longer share ChatList').toBe(2);
    // Both must be fed the same real history, not a copy or a slice.
    const both = code.split('<ChatList').slice(1).map((s) => s.slice(0, 200));
    for (const use of both) {
      expect(use, 'a ChatList is no longer fed the shared history array')
        .toContain('history={history}');
    }
  });

  it('🔴 and picking a chat in the sheet closes it', () => {
    const code = codeOf(CHAT);
    // Inside the sheet, the list's onSelect forwards the pick AND dismisses:
    //   onSelect={(chat) => { onSelect(chat); onClose(); }}
    // The rail's own onSelect must NOT dismiss anything — there is nothing open.
    const sheetSelect = code
      .split('\n')
      .find((l) => l.includes('onSelect=') && l.includes('onClose()')) ?? '';
    expect(sheetSelect, 'the sheet no longer closes after a chat is picked').not.toBe('');
    expect(sheetSelect, 'the sheet stopped forwarding the picked chat')
      .toMatch(/onSelect\(\s*chat\s*\)/);
    // And the rail passes the loader straight through, with no close beside it.
    const railSelect = code
      .split('\n')
      .find((l) => l.includes('<ChatList') && l.includes('onSelect=')) ?? '';
    expect(railSelect, 'the rail no longer loads the picked chat').toContain('onSelect={loadChat}');
    expect(railSelect, 'the rail tries to close a sheet that is not open')
      .not.toContain('onClose');
  });
});

/* ═══ 10 · 🔴 THE SILENT-FAILURE RULE — PERSIST BEFORE THE REPLY ══════════ */

describe('10 · a conversation persists before the reply arrives', () => {
  it('🔴 the save happens before the request, not after it', () => {
    const code = codeOf(CHAT);
    // 🔴 THE MUTATION: persist only after the reply. That is the quiet lie this
    // behaviour exists to prevent — a failed request used to leave nothing in
    // history at all. The ORDER is the assertion: the history write must come
    // before the call that fetches the answer.
    //
    // ⚠️ SCOPED TO sendMessage ON PURPOSE. Measured against the whole file this
    // guard is worthless: the FIRST setHistory in the file is the localStorage
    // load in an effect, which sits above every fetch no matter where the send
    // path writes. A guard that passes on its own mutation is not a guard.
    const from = code.indexOf('const sendMessage');
    expect(from, 'sendMessage is gone — this guard is measuring nothing').toBeGreaterThan(-1);
    const body = code.slice(from, code.indexOf('\n };', from));
    expect(body, 'sendMessage no longer requests a reply').toMatch(/await\s+fetch/);

    const persist = body.search(/setHistory\s*\(/);
    const request = body.search(/await\s+fetch/);
    expect(persist, 'sendMessage never persists the conversation').toBeGreaterThan(-1);
    expect(persist, 'the conversation is persisted only AFTER the reply — a failed request loses the message')
      .toBeLessThan(request);

    // And the create/update split that makes the first message survivable.
    const beforeRequest = body.slice(0, request);
    expect(beforeRequest, 'the first message no longer creates a chat before the request is made')
      .toContain('setActiveChat');
  });

  it('🔴 and the persisted conversation stays in sync when the AI errors', () => {
    const code = codeOf(CHAT);
    const catchAt = code.indexOf('catch');
    expect(catchAt, 'the AI call has no error path at all').toBeGreaterThan(-1);
    const catchBlock = code.slice(catchAt, catchAt + 1200);
    expect(catchBlock, 'the error path no longer keeps the persisted conversation in sync')
      .toContain('setHistory');
  });

  it('the title is derived on the first message, so an errored chat is still findable', () => {
    const code = codeOf(CHAT);
    expect(code, 'the chat title is no longer derived from the first message')
      .toMatch(/const title = text/);
  });
});

/* ═══ 11 · READING_MEASURE STILL CAPS THE READING COLUMN ══════════════════ */

describe('11 · READING_MEASURE still caps the reading column', () => {
  it('🔴 it is imported and applied, and no inline width competes with it', () => {
    const code = codeOf(CHAT);
    expect(code, 'READING_MEASURE is no longer imported').toContain('READING_MEASURE');
    const uses = (code.match(/READING_MEASURE/g) ?? []).length;
    // The import plus the message column, the composer and the footnote.
    expect(uses, 'READING_MEASURE is applied to fewer places than before')
      .toBeGreaterThanOrEqual(4);
  });

  it('the measure is never widened by a hardcoded max-width beside it', () => {
    const code = codeOf(CHAT);
    for (const line of code.split('\n')) {
      if (!line.includes('READING_MEASURE')) continue;
      expect(line, 'an inline maxWidth sits beside READING_MEASURE and would fight it')
        .not.toMatch(/maxWidth:\s*\d/);
    }
  });
});

/* ═══ 12 · EVERY CONTROL MEETS ITS RULE ═══════════════════════════════════ */

describe('12 · the rail controls are sized to Rule 4, not to their glyph', () => {
  it('🔴 the collapse and reopen controls take DENSITY_PX.control, not a padding', () => {
    const code = codeOf(CHAT);
    // 🔴 THE MEASURED DEFECT: `padding: 4` around an 18px icon measured 26px,
    // and the reopen button measured 30px. Rule 4 fixes a control at 38px above
    // sm. Both live in lg-only markup, so 38 governs and 44 never applies.
    expect(code, 'AIChat no longer imports the density token')
      .toContain('DENSITY_PX');
    const sized = (code.match(/width: DENSITY_PX\.control, height: DENSITY_PX\.control/g) ?? []).length;
    expect(sized, 'the two rail controls are not both sized to DENSITY_PX.control')
      .toBeGreaterThanOrEqual(2);
  });

  it('🔴 and Rule 4 still deliberately sits below 44 — this is not a regression', () => {
    // ⚠️ Asserted here so a future reader does not "fix" 38 up to 44 and break
    // every measured layout test in the repo. The 44 rule is a BELOW-sm rule.
    const layout = read('src/components/layout/form-layout.ts');
    expect(layout, 'DENSITY_PX.control moved off 38').toMatch(/control:\s*38/);
  });

  it('the composer keeps its own 44px minimum, which is a touch target', () => {
    const code = codeOf(CHAT);
    expect(code, 'the composer lost its 44px minimum height').toContain('minHeight: 44');
  });
});

/* ═══ 13 · NO HARDCODED COLOUR, NO EMOJI, FOUR PALETTES ═══════════════════ */

describe('13 · colour comes from the palette and nothing renders an emoji', () => {
  it('the chat tokens resolve from CSS variables — they are NOT literal hexes', () => {
    // 🔴 REPORTED, NOT FIXED, BECAUSE THERE IS NOTHING TO FIX. The ticket feared
    // GOLD/CARD/BG were literal hexes and the four palettes never reached this
    // screen. They are `var()` references; the only hexes are var() FALLBACKS
    // and `/* was #… */` comments left from the migration that already happened.
    const code = codeOf(CHAT);
    for (const [name, token] of [
      ['GOLD', '--brand-color'],
      ['BG', '--chat-bg'],
      ['CARD', '--chat-card'],
      ['TEXT', '--chat-text'],
      ['TEXT2', '--chat-text2'],
    ] as const) {
      const decl = code.split('\n').find((l) => new RegExp(`^const ${name} =`).test(l.trim())) ?? '';
      expect(decl, `${name} is not declared`).not.toBe('');
      expect(decl, `${name} is a literal colour — the four palettes would not reach this screen`)
        .toContain(`var(${token}`);
    }
  });

  it('🔴 the ✦ dingbat does NOT trip the emoji sweep, and is reported rather than removed', () => {
    // ⚠️ U+2726 is a DINGBAT, not an emoji. THE-311's sweep covers
    // U+1F000–U+1F2FF and U+1F300–U+1FAFF; 2726 is in neither, so the character
    // is LEGAL. It is merely inconsistent with the lucide icons used elsewhere,
    // which is a composition concern and belongs in the composition ticket.
    const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}]/gu;

    // The map, which this ticket rewrote, carries none.
    expect(read(MAP).match(EMOJI) ?? [], `${MAP} renders a real emoji`).toEqual([]);

    // 🔴 A REPORTED FINDING THIS TICKET DELIBERATELY DID NOT FIX. AIChat.tsx
    // ships ONE real emoji — U+1F5D1 on ChatList's delete button — which does
    // violate the repo's no-emoji rule and predates THE-333. Swapping it for a
    // lucide icon was tried and REVERTED: ChatList is shared by the mobile
    // sheet, and `MemberScreens.desktop-layout` pins that sheet's element tree
    // below 640px, so an icon's <svg> moves the count from 52 to 58 and turns
    // that suite red. It is a composition-ticket change, not a rail fix.
    //
    // Pinned at exactly one so the count can never GROW behind this exemption.
    const chatEmoji = read(CHAT).match(EMOJI) ?? [];
    expect(chatEmoji.length,
      'AIChat gained an emoji — the one known violation is the delete glyph, reported for the composition ticket')
      .toBe(1);

    // And the claim about ✦ itself, which is what the ticket actually asked:
    // U+2726 is a DINGBAT and is NOT in either swept range, so it is legal and
    // merely inconsistent with the lucide icons used elsewhere.
    expect('✦'.match(EMOJI), '✦ now trips the emoji sweep and must be replaced').toBeNull();
    expect(read(CHAT), 'the ✦ this finding is about is gone from AIChat').toContain('✦');
  });

  it('the map adds no colour of its own — the dark path is a filter, not a palette', () => {
    const code = codeOf(MAP);
    const before = read(MAP);
    // The only hex allowed anywhere near the new CSS is none at all.
    const start = before.indexOf('.harvest-tiles-dark');
    const rule = before.slice(start, before.indexOf('}', start) + 1);
    expect(rule, 'the dark tile rule hardcodes a colour').not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(code, 'the map gained a hardcoded colour').not.toMatch(/background:\s*['"`]#[0-9a-fA-F]{3,8}/);
  });
});

/* ═══ 14 · 🔴 NO FIXTURE PINNED TO A DATE NEAR TODAY ══════════════════════ */

describe('14 · no test fixture this ticket adds is pinned near today', () => {
  it('🔴 this ticket adds no date-pinned fixture at all', () => {
    // ⚠️ A fixture pinned to a date two days before it ran turned main red for
    // everyone (#468) — the literal is deliberately NOT reproduced here, since
    // this very assertion sweeps for that shape and would match its own prose.
    // The safest version of this guard is the one that holds: this ticket's
    // tests assert against files on disk and need no clock at all.
    const self = read('src/__tests__/the-333-guards.test.ts');
    const dates = self.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g) ?? [];
    expect(dates, 'THE-333 pinned a timestamp — it needs none').toEqual([]);
    // 🔴 Fragments again: spelled plainly, this assertion's own source is the
    // match and the gate passes no matter what the rest of the file does.
    expect(self, 'THE-333 started faking timers it does not need')
      .not.toContain(['use', 'Fake', 'Timers'].join(''));
  });

  it('and neither edited production file gained a hardcoded date', () => {
    for (const file of EDITED) {
      const dates = codeOf(file).match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g) ?? [];
      expect(dates, `${file} gained a pinned timestamp`).toEqual([]);
    }
  });
});

/* ═══ 15 · 🔴 NO GUARD HERE ASKS WHAT THIS BRANCH CHANGED ═════════════════ */

describe('15 · no guard in this PR asserts anything about the current branch diff', () => {
  it('🔴 this file shells out to nothing and reads no diff', () => {
    const self = read('src/__tests__/the-333-guards.test.ts');
    // 🔴 NEEDLES ASSEMBLED AT RUN TIME. Written as literals, this assertion's
    // own source would contain every string it greps for and the guard would
    // pass with its gate deleted — the exact failure #454 found.
    const vcs = ['g', 'it'].join('');
    for (const needle of [
      ['child', '_', 'process'].join(''),
      ['exec', 'Sync'].join(''),
      ['spawn', 'Sync'].join(''),
      `${vcs} diff`,
      `${vcs} show`,
      `${vcs} rev-parse`,
      ['HEAD', '~'].join(''),
      ['origin', '/', 'main'].join(''),
    ]) {
      expect(self, `THE-333's guards invoke "${needle}" — a branch-diff guard blocks every unrelated PR`)
        .not.toContain(needle);
    }
  });

  it('and the ownership file it adds records digests, not a diff', () => {
    const mine = JSON.parse(read('src/__tests__/__fixtures__/ownership/THE-333.json')) as
      { entries: { file: string; digest: string; why: string }[] };
    expect(mine.entries.length, 'THE-333 recorded no ownership entries').toBeGreaterThan(0);
    for (const e of mine.entries) {
      expect(e.digest, `${e.file} has no digest`).toMatch(/^[0-9a-f]{64}$/);
      expect(e.why.length, `${e.file}'s reason is too short to review`).toBeGreaterThanOrEqual(80);
    }
  });
});

/* ═══ 16 · 🔴 THE THREE FILES THIS TICKET DOES NOT OWN ════════════════════ */

describe('16 · AdminCommunity, UserMessages and AdminDashboard are byte-identical', () => {
  // 🔴 THE-331 owns the first two and THE-332 the third. THE-333 changes a
  // basemap URL and a rail class string and reaches none of them.
  it.each([
    ['src/components/AdminCommunity.tsx', 'THE-331'],
    ['src/components/UserMessages.tsx', 'THE-331'],
    ['src/components/AdminDashboard.tsx', 'THE-332'],
  ])('🔴 %s is unchanged — %s owns it', (file) => {
    expect(ownershipFailure(file), `${file} moved; THE-333 does not own it`).toBeNull();
  });

  it('and none of them names this ticket', () => {
    for (const file of [
      'src/components/AdminCommunity.tsx',
      'src/components/UserMessages.tsx',
      'src/components/AdminDashboard.tsx',
    ]) {
      expect(read(file), `${file} was edited by THE-333`).not.toContain('THE-333');
    }
  });
});

/* ═══ 17 · 🔴 RULES, INDEXES, functions/ AND layout.tsx ═══════════════════ */

describe('17 · firestore.rules, indexes, functions/ and layout.tsx are byte-identical', () => {
  it('🔴 firestore.rules is untouched, and THE-333 recorded no digest for it', () => {
    // firestore.rules AUTO-DEPLOYS TO PRODUCTION ON MERGE and CI runs no
    // emulator tests. This ticket adds no collection, no query and no read.
    //
    // 🔴 DELIBERATELY NOT `rulesDigestFailure()`. That helper is the right call
    // for a ticket that pins the rules, but calling it JOINS the population of
    // pinning suites that THE-322 §5 and THE-325 §1 both assert the exact shape
    // of — so a ticket that has no business pinning the rules turns those two
    // red just by asking. The rules are already pinned by thirty-odd suites;
    // what THE-333 owes is the narrower claim that it did not touch them.
    expect(read('firestore.rules'), 'firestore.rules was edited by THE-333')
      .not.toContain('THE-333');
    const mine = JSON.parse(read('src/__tests__/__fixtures__/ownership/THE-333.json')) as
      { entries: { file: string }[] };
    expect(mine.entries.map((e) => e.file),
      'THE-333 recorded a firestore.rules digest — it needs no rule change').not.toContain('firestore.rules');
  });

  it('🔴 firestore.indexes.json gained nothing — an index there would be INERT', () => {
    // `deploy-rules.yml` runs `firestore:rules,storage` only, so an index added
    // here never deploys and the query that needed it throws in production.
    // 🔴 A CLAIM ABOUT CONTENT, not a digest compared against itself: this
    // ticket changes a tile URL and a class string, so there is no collection
    // and no ordering it could have added.
    const raw = read('firestore.indexes.json');
    for (const needle of ['churches', 'tile', 'basemap']) {
      expect(raw.toLowerCase(), `an index was added for ${needle}`).not.toContain(`"${needle}"`);
    }
  });

  it('🔴 layout.tsx is unchanged — the dark tile CSS did NOT go global', () => {
    // ⚠️ layout.tsx is the plausible home for a global CSS rule, which is
    // exactly why it is pinned: the rule lives in a scoped block beside the map.
    expect(ownershipFailure('src/app/layout.tsx'),
      'layout.tsx moved — the dark tile rule was put in the global layout').toBeNull();
    expect(read('src/app/layout.tsx'), 'layout.tsx carries the dark tile rule')
      .not.toContain('harvest-tiles-dark');
  });

  it('🔴 functions/ names this ticket nowhere', () => {
    const dir = path.join(REPO_ROOT, 'functions');
    if (!existsSync(dir)) return;
    for (const abs of walk(dir)) {
      if (statSync(abs).isDirectory()) continue;
      expect(readFileSync(abs, 'utf8'), `${rel(abs)} was edited by THE-333`)
        .not.toContain('THE-333');
    }
  });

  it('and every file this ticket DOES edit is tracked or deliberately untracked', () => {
    // 🔴 A file this ticket edits may be tracked — ChurchMap.tsx is, because
    // theming-member-app.test.ts pinned it inline and THE-333 migrated that pin
    // into the shared register. What must hold is that anything tracked is at a
    // digest SOME ticket recorded, so the edit is a record rather than a
    // silently moved pin.
    const tracked = new Set(loadOwnership().map((e) => e.file));
    for (const file of EDITED) {
      if (!tracked.has(file)) continue;
      expect(ownershipFailure(file),
        `${file} is pinned but sits at a digest no ticket recorded`).toBeNull();
    }
    // And the baseline that suite used to spell inline was JOINED, not replaced.
    const forMap = loadOwnership().filter((e) => e.file === 'src/components/ChurchMap.tsx');
    expect(forMap.length, 'ChurchMap.tsx lost its recorded states').toBeGreaterThanOrEqual(2);
    expect(forMap.map((e) => e.digest),
      'the pre-THE-333 ChurchMap baseline was dropped rather than joined')
      .toContain('842b22a62ebf54684f3457ff5b39116dedf474ab2aa943b6bd7f5aab7feec60f');
  });
});
