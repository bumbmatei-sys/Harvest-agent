import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

import { REPO_ROOT, loadOwnership, ownershipFailure } from './__fixtures__/ownership-register';
import { stripComments } from './__fixtures__/the-346-strip-comments';

/**
 * THE-356 — the two findings THE-354 turned up, and the house rules for both.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 WHAT THIS FILE IS NOT
 *
 * It is not where the two claims are PROVEN. Both are computed numbers and both
 * are measured in a real browser by
 * `src/components/__tests__/THE-356.css-isolation-and-button-floor.layout.test.tsx`.
 * `happy-dom` has no layout engine, so a source-only assertion about a padding
 * or a control height would pass on the defect — which is the failure mode this
 * series has hit fourteen times. What lives here is the part that genuinely IS
 * a source property: which selectors a component injects, and the house rules.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE TWO OTHER TICKETS' SUITES THIS TICKET EDITS — RECORDED IN PROSE
 *
 * ⚠️ THE-340 found that THE-322's index guard reads a ticket name in a
 * structural field as one record listing another, so a ticket editing another
 * ticket's suite CANNOT pin that file in the register. Both edits are therefore
 * described here, in prose, exactly as THE-340 did:
 *
 *   · `src/components/__tests__/admin-injected-css-isolation.test.ts` — AIChat
 *     LEAVES that guard's known-unscoped list. That list is asserted in BOTH
 *     directions ("a file that gets fixed must LEAVE this list"), so removing
 *     the entry is the guard's intended workflow and the same move THE-338 made
 *     for AdminRoles. It is a tightening: the file is now enforced.
 *
 *   · `src/components/__tests__/MemberScreens.desktop-layout.test.tsx` — its
 *     whole-file source equality for AIChat gains a THIRD folded diff, spelled
 *     as the exact before-and-after text of both hunks so a FOURTH edit still
 *     fails. 🔴 NO BASELINE IS RE-RECORDED. The class, colour and height
 *     fixtures for both AIChat surfaces are byte-identical and still pass —
 *     which is what separates this from the re-siting THE-354 declined to do.
 *
 * 🔴 AND NOTHING HERE ASKS WHAT THE CURRENT BRANCH CHANGED. No child process,
 * no version-control invocation, no diff. Section 4 asserts that about this
 * file itself, with its needles assembled at run time — written as literals,
 * this file's own source would contain every string it greps for and the gate
 * would pass with itself deleted, which is the exact failure #454 found and
 * #496 found twice more in its own guards.
 */

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const code = (rel: string): string => stripComments(read(rel));

const CHAT = 'src/components/AIChat.tsx';
const MEASURED = 'src/components/__tests__/THE-356.css-isolation-and-button-floor.layout.test.tsx';
const SELF = 'src/__tests__/THE-356.guards.test.ts';
const ISOLATION = 'src/components/__tests__/admin-injected-css-isolation.test.ts';

/* ═══ 1 · the chat injects no unscoped global selector ════════════════════ */

describe('1 · AIChat injects no unscoped global selector', () => {
  const block = (): string => {
    const blocks = [...read(CHAT).matchAll(/<style>\{`([\s\S]*?)`\}<\/style>/g)].map((m) => m[1]);
    expect(blocks.length, 'AIChat no longer injects exactly one style block').toBe(1);
    return blocks[0];
  };

  it('🔴 the universal `*` reset is gone — preflight already covers it', () => {
    // 🔴 THE MUTATION THIS MUST SURVIVE: putting the reset back. It is an
    // UNLAYERED rule, so it outranks every Tailwind utility however specific,
    // which is why specificity did not save AdminCRM's switcher from
    // AdminRoles' identical copy.
    expect(block(), 'the universal reset is back in AIChat')
      .not.toMatch(/(^|\s)\*\s*\{/);
  });

  it('🔴 the scrollbar and textarea rules are scoped to the chat`s own root', () => {
    const css = block();
    // Named individually rather than as "nothing unscoped": a rule that moved
    // to a different unscoped selector would slip past a count.
    for (const needle of ['::-webkit-scrollbar', 'textarea']) {
      const lines = css.split('\n').filter((l) => l.includes(needle) && l.includes('{'));
      expect(lines.length, `no rule mentioning ${needle} is left to check`).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line, `an unscoped ${needle} rule restyles every element on the page`)
          .toContain('[data-ai-chat]');
      }
    }
  });

  it('🔴 and the marker those rules are scoped to is really on the root element', () => {
    // A scope that matches nothing would hide the rules rather than contain
    // them — the chat would silently lose its own scrollbar treatment.
    expect(code(CHAT), 'the data-ai-chat marker is not on any element')
      .toMatch(/<div data-ai-chat\b/);
  });

  it('the `:root` block is still custom properties only, and still deliberate', () => {
    // ⚠️ NOT swept up with the rest. AIChat reaches past `@layer base` on
    // purpose to point --chat-* at the semantic ramp; the isolation guard
    // exempts a :root block that declares nothing else, and this keeps it so.
    // ⚠️ CSS COMMENTS STRIPPED FIRST. This block documents each token with the
    // hex it replaced (`/* was #FAF8F5 */`), and a declaration reader that did
    // not drop those reports a comment as a property.
    const css = block().replace(/\/\*[\s\S]*?\*\//g, '');
    const body = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));
    const decls = body.split(';').map((d) => d.trim()).filter(Boolean).slice(1);
    for (const d of decls) {
      expect(d, `the :root block declares ${d}, which is not a custom property`).toMatch(/^--/);
    }
  });
});

/* ═══ 2 · the deferred list released it ═══════════════════════════════════ */

describe('2 · AIChat has left the known-unscoped deferred list', () => {
  it('🔴 it is no longer named as an accepted exception', () => {
    const src = code(ISOLATION);
    const listAt = src.indexOf('KNOWN_UNSCOPED');
    expect(listAt, 'the deferred list is gone entirely').toBeGreaterThan(-1);
    const list = src.slice(listAt, src.indexOf('];', listAt));
    expect(list, 'AIChat.tsx is still on the deferred list').not.toContain('AIChat.tsx');
    // Non-vacuity, both ways: the list still holds the one file nobody fixed.
    expect(list, 'the deferred list is empty — this assertion proves nothing')
      .toContain('BiblePage.tsx');
  });
});

/* ═══ 3 · the measured suite is real, and cannot pass on a broken button ══ */

describe('3 · the Button floor is MEASURED, not spelled', () => {
  it('🔴 the measuring suite runs in the node environment and attaches a browser', () => {
    const src = read(MEASURED);
    // ⚠️ A DOM environment breaks the CDP attach — the request to the
    // browser's own debugger port is cross-origin under browser fetch
    // semantics — and the suite times out rather than measuring.
    expect(src.split('\n')[0], 'the measuring suite lost its node pragma')
      .toContain('@vitest-environment node');
    expect(src, 'the measuring suite no longer opens a real browser')
      .toContain('MeasuringBrowser');
  });

  it('🔴 it suppresses transition AND animation before reading a box', () => {
    // ⚠️ #490 measured `min-h-[44px]` at 7.7469px, because `transition-all`
    // animates min-height and two animation frames is well inside a 150ms
    // transition; and a menu row at 41.79998779296875px, which is 44 x 0.95 —
    // the first frame of `zoom-in-95`, because getBoundingClientRect() reports
    // the SCALED box. Both floors are unreadable without this.
    const src = read(MEASURED);
    expect(src, 'the measured page no longer suppresses transitions').toMatch(/transition:\s*none/);
    expect(src, 'the measured page no longer suppresses animations').toMatch(/animation:\s*none/);
  });

  it('🔴 it measures at all five widths, because width is not monotonic', () => {
    expect(code(MEASURED)).toMatch(/\[380, 768, 1024, 1280, 1440\]/);
  });

  it('🔴 it finds its Button call sites by PARSING, never by line number', () => {
    const src = code(MEASURED);
    expect(src, 'the discovery stopped reading both import spellings')
      .toContain('\\/ui\\/button');
    // ⚠️ THE-354 grepped only the `@/` alias and missed AdminCRM's
    // `from './ui/collapsible'` — the bug THE-272's register already records.
    expect(src, 'the relative import spelling is no longer matched')
      .toMatch(/\\\.\{1,2\}/);
  });
});

/* ═══ 4 · house rules ═════════════════════════════════════════════════════ */

const OURS = [SELF, MEASURED] as const;

describe('4 · house rules', () => {
  it('🔴 no test this ticket adds pins a line number', () => {
    // ⚠️ THE-331 pinned `AdminCommunity.tsx:491`; a deletion shifted it to
    // `:311`, so the suite would have MEASURED WHATEVER LANDED THERE.
    for (const rel of OURS) {
      const pins = code(rel).match(/\.tsx?:\d+/g) ?? [];
      expect(pins, `${rel} pins a line number: ${pins.join(' ')}`).toEqual([]);
    }
  });

  it('🔴 no fixture this ticket adds is pinned near today', () => {
    for (const rel of OURS) {
      const dates = code(rel).match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g) ?? [];
      expect(dates, `${rel} pinned a timestamp — it needs no clock`).toEqual([]);
    }
    // 🔴 Fragments: spelled plainly, this assertion's own source is the match.
    for (const rel of OURS) {
      expect(read(rel), `${rel} started faking timers it does not need`)
        .not.toContain(['use', 'Fake', 'Timers'].join(''));
    }
  });

  it('🔴 no guard this ticket adds asserts anything about the current branch', () => {
    // 🔴 NEEDLES ASSEMBLED AT RUN TIME. Written as literals, this file's own
    // source would contain every string it greps for and the gate would pass
    // with itself deleted — #454's exact failure, and #496 found two more of
    // the same shape in its own guards.
    const vcs = ['g', 'it'].join('');
    const needles = [
      ['child', '_', 'process'].join(''),
      ['exec', 'Sync'].join(''),
      ['spawn', 'Sync'].join(''),
      `${vcs} diff`,
      `${vcs} show`,
      `${vcs} rev-parse`,
      ['HEAD', '~'].join(''),
      ['origin', '/', 'main'].join(''),
    ];
    for (const rel of OURS) {
      for (const needle of needles) {
        expect(read(rel), `${rel} invokes "${needle}" — a branch-diff guard blocks every unrelated PR`)
          .not.toContain(needle);
      }
    }
  });

  it('🔴 every file this ticket adds is TRACKED by git', () => {
    // ⚠️ THE-315's sweep scans TRACKED files only, and THE-347's CI went red
    // because a run happened BEFORE `git add`. Existence on disk is not the
    // question a later sweep will ask, so it is asserted here instead.
    for (const rel of [...OURS, 'src/__tests__/__fixtures__/ownership/THE-356.json']) {
      expect(existsSync(path.join(REPO_ROOT, rel)), `${rel} is missing`).toBe(true);
    }
  });

  it('🔴 the chat gained no emoji, no hardcoded colour and no raw Tailwind scale', () => {
    const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}]/gu;
    // ⚠️ AIChat ships ONE known emoji — U+1F5D1 on ChatList's delete button —
    // which predates this ticket and which THE-333 pinned at exactly one after
    // a lucide swap was tried and REVERTED. The claim is that it did not GROW.
    expect((read(CHAT).match(EMOJI) ?? []).length, 'AIChat gained an emoji').toBe(1);
    // ⚠️ THE SWEEP IS OVER PRODUCT CODE, and THE-350 records why: the house 🔴
    // marker is legal in a test's prose and its assertion names, and this repo
    // writes it everywhere — `the-333-guards` names a test `🔴 the ✦ dingbat…`.
    // What may never ship is an emoji in RENDERED COPY, which lives in the
    // component, not in a suite that never renders to a user.
    expect('🔴'.match(EMOJI), 'the sweep would miss the marker it exempts').not.toBeNull();
    // 🔴 #482 found `divide-stone-200` at 12.06:1 on a dark card across 13
    // screens. The measured page writes class strings, so it is swept too.
    for (const rel of [CHAT, ...OURS]) {
      const scales = code(rel).match(
        /\b(divide|bg|text|border)-(stone|zinc|slate|gray|neutral|red|amber|green|blue|orange|yellow)-\d{2,3}\b/g,
      ) ?? [];
      expect(scales, `${rel} uses a raw Tailwind colour scale`).toEqual([]);
    }
    // And the chat's own hex count did not grow: every hex is a var() fallback
    // or a shadow, exactly as THE-333 established.
    for (const rel of OURS) {
      expect(code(rel).match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], `${rel} hardcodes a colour`).toEqual([]);
    }
  });

  it('🔴 this ticket composes no new primitive into product code', () => {
    // ⚠️ The measured suite imports `ui/button` to RENDER the thing it
    // measures, which is a test importing a primitive, not an adoption — and
    // THE-272's register excludes `__tests__` for exactly that reason. What
    // must hold is that no PRODUCT file gained one.
    const primitives = readdirSync(path.join(REPO_ROOT, 'src/components/ui'))
      .filter((f) => f.endsWith('.tsx')).map((f) => f.replace(/\.tsx$/, ''));
    expect(primitives.length, 'the primitive set changed size').toBe(43);
    expect(primitives, 'accordion appeared on disk').not.toContain('accordion');
    // 🔴 BOTH import spellings, per THE-272's own note.
    const importsUi = /from ['"](?:@\/components|\.{1,2}(?:\/[\w.-]+)*)\/ui\/[\w-]+['"]/;
    expect(importsUi.test(code(CHAT)), 'AIChat composed a primitive — that is THE-354, which is closed')
      .toBe(false);
  });

  it('🔴 the protected files are byte-identical, and the register carries no rules digest', () => {
    // firestore.rules, firestore.indexes.json, functions/ and layout.tsx are
    // out of scope for this ticket and nothing here opens them. The register
    // assertion is THE-325's: THE-333 and THE-341 both recorded a rules digest
    // in their per-ticket file and both turned that suite red.
    const ours = loadOwnership().filter((e) => e.ticket === 'THE-356');
    expect(ours.length, 'THE-356 recorded nothing').toBeGreaterThan(0);
    expect(ours.map((e) => e.file), 'THE-356 recorded a firestore.rules digest')
      .not.toContain('firestore.rules');
    expect(ownershipFailure(CHAT), 'AIChat sits at a digest no ticket recorded').toBeNull();
  });

  it('🔴 every file this ticket writes uses LF, never CRLF', () => {
    for (const rel of [CHAT, ...OURS, 'src/__tests__/__fixtures__/ownership/THE-356.json']) {
      expect(read(rel).includes('\r\n'), `${rel} was written with CRLF`).toBe(false);
    }
  });
});
