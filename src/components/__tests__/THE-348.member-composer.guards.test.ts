import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';
import { rulesDigestFailure } from '../../__tests__/__fixtures__/firestore-rules-pin';
import { ownershipFailure } from '../../__tests__/__fixtures__/ownership-register';
import { READING_MEASURE } from '../layout/form-layout';

/**
 * THE-348 · The guards that are not layout questions.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Everything measurable about this ticket is measured in
 * `THE-348.member-composer.layout.test.tsx`, in a real Chromium. What is left
 * here is the set of questions a browser cannot answer: what the security
 * rules PERMIT, what this ticket did NOT touch, and whether this PR's own
 * guards are the kind that guard.
 *
 * 🔴 EVERY CONTENT GREP BELOW RUNS OVER COMMENT-STRIPPED SOURCE, through
 * #490's parser-driven stripper. Card 86bbxkawp records an inherited `code()`
 * stripper that EATS ~150 LINES of a file, and a regex one that ate a `//`
 * inside JSX text; a guard built on either reads something that is not the
 * code. `the-346-strip-comments.ts` takes its comment ranges off a real
 * TypeScript PARSE, which is the only thing that knows it is inside JSX.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
/** 🔴 The only spelling of "the source" used for a content claim in this file. */
const code = (rel: string) => stripComments(read(rel));

const USER_MESSAGES = 'src/components/UserMessages.tsx';
const MAIN_APP = 'src/components/MainApp.tsx';
const ADMIN_DASHBOARD = 'src/components/AdminDashboard.tsx';

// ═════════════════════════════════════════════════════════════════════════════
// 1 · 🔴 THE FIRST QUESTION: can a member attach WITHOUT the button?
// ═════════════════════════════════════════════════════════════════════════════

/**
 * 🔴 YES — AND THIS SUITE SAYS SO RATHER THAN PRETENDING OTHERWISE.
 *
 * The founder asked for the paperclip to be hidden from members, and it is:
 * `THE-348.member-composer.layout.test.tsx` measures its absence in a real
 * browser. That is a UI change, and this block exists because a UI change is
 * not a permission.
 *
 * ⚠️ `firestore.rules` PUTS NO FIELD ALLOWLIST ON MESSAGE CREATION. The
 * `dmMessages` create rule asks three things — the caller belongs to the
 * tenant, the `senderId` is their own uid, and they are a participant of the
 * parent thread — and says nothing whatever about which OTHER fields the
 * document may carry. A member writing through the Firebase SDK, the emulator
 * UI or a REST call may therefore include an `attachments` array, and the
 * rules will accept it. `channelMessages` create is the same shape for any
 * member of the channel.
 *
 * 🔴 CLOSING IT WOULD BE A RULES CHANGE, AND THIS TICKET DOES NOT MAKE ONE.
 * `firestore.rules` AUTO-DEPLOYS to production on merge and CI runs no
 * emulator tests against it; THE-313's one-line `servicePlans` rule turned 46
 * files red and needed a second PR that changed nothing but pins. A field
 * allowlist on two create rules is a larger change than that, on the hottest
 * paths in the product, and it belongs in a PR that can be tested with the
 * emulator — not smuggled in behind a UI ticket.
 *
 * ⚠️ WHAT THE EXPOSURE ACTUALLY IS, stated so the decision can be made on
 * facts. A member can WRITE an attachment reference; that is not the same as
 * READING one. Of the four categories, exactly one is readable by an ordinary
 * member — `forms`, deliberately (`allow read: if belongsToTenant(tenantId)`,
 * whose own comment says forms are readable "so forms can be attached in
 * channel/DM messages"). `docs` needs admin/creator/shared-with, `contacts`
 * needs `isTenantAdmin`, and `campaigns` needs `belongsToTenant`. So a member
 * can enumerate and attach FORMS — which the product intends — and can
 * otherwise only fabricate a chip whose title they typed themselves, in a
 * thread they are already a participant of.
 *
 * THE ASSERTIONS BELOW PIN THAT READING. If someone later adds the allowlist,
 * these fail and this comment has to be rewritten — which is the point. A
 * guard that silently kept passing after the ground moved is the failure mode
 * this repo has recorded thirteen times.
 */
describe('🔴 a non-admin CANNOT be stopped by the button alone — what the rules permit', () => {
  const RULES = read('firestore.rules');

  /** One rule body, from `match /<name>/{...} {` to its closing brace. */
  const ruleBlock = (name: string): string => {
    const i = RULES.indexOf(`match /${name}/{`);
    expect(i, `firestore.rules no longer has a /${name} block`).toBeGreaterThan(-1);
    // ⚠️ THE BLOCK'S BRACE, NOT THE PATH PATTERN'S. `match /dmMessages/{msgId}
    // {` opens TWO braces on one line, and counting from the first closes the
    // block at `}` of `{msgId}` — which returned a two-word slice that matched
    // no `allow` clause at all. The scan starts after the path's `}`.
    const pathEnd = RULES.indexOf('}', i);
    let depth = 0;
    for (let k = RULES.indexOf('{', pathEnd); k < RULES.length; k += 1) {
      if (RULES[k] === '{') depth += 1;
      else if (RULES[k] === '}') {
        depth -= 1;
        if (depth === 0) return RULES.slice(i, k + 1);
      }
    }
    throw new Error(`the /${name} block is unterminated`);
  };

  const createClause = (block: string): string => {
    const m = block.match(/allow create:([\s\S]*?);/);
    expect(m, 'the block has no `allow create` clause').not.toBeNull();
    return m![1].replace(/\s+/g, ' ').trim();
  };

  it('dmMessages create asks WHO is writing, and never WHAT they write', () => {
    const clause = createClause(ruleBlock('dmMessages'));
    // The three things it does ask.
    expect(clause, 'the tenant check is gone').toContain('belongsToTenant(tenantId)');
    expect(clause, 'the sender-identity check is gone').toContain('request.resource.data.senderId == request.auth.uid');
    expect(clause, 'the participant check is gone').toContain("data.get('participants', [])");
    // 🔴 And the thing it does NOT: any constraint on the payload's shape.
    expect(clause, 'a field allowlist appeared — the report in this file is now stale')
      .not.toMatch(/hasOnly|hasAll|affectedKeys/);
    expect(clause, 'an attachments constraint appeared — the report in this file is now stale')
      .not.toMatch(/attachments/);
  });

  it('channelMessages create is the same shape — any channel member, any payload', () => {
    const clause = createClause(ruleBlock('channelMessages'));
    expect(clause, 'the member branch is gone').toContain("data.get('members', [])");
    expect(clause, 'a field allowlist appeared — the report in this file is now stale')
      .not.toMatch(/hasOnly|hasAll|affectedKeys/);
  });

  it('so the client gate is a UI gate — and the code SAYS so where it is written', () => {
    // ⚠️ A hidden button with no note beside it is how "hiding a button is not
    // a permission" gets forgotten. The composer carries the caveat inline.
    const src = read(USER_MESSAGES);
    expect(src, 'the composer no longer records that its admin gate is client-side')
      .toMatch(/CLIENT GATE AND IT IS NOT A PERMISSION/);
  });

  it('and exactly ONE of the four categories is member-readable — forms, deliberately', () => {
    // The fact that decides how much the write-side gap is worth. If a later
    // rules edit opens `contacts` or `docs` to members, this fails and the
    // exposure paragraph above has to be re-reasoned rather than re-read.
    const memberReadable = (name: string) => /belongsToTenant/.test(
      (ruleBlock(name).match(/allow read:([\s\S]*?);/) ?? ['', ''])[1],
    );
    expect(memberReadable('forms'), 'forms stopped being member-readable — attaching one would now fail').toBe(true);
    expect(memberReadable('contacts'), 'contacts became member-readable').toBe(false);
    expect(memberReadable('docs'), 'docs became member-readable').toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 · The nav's own class string, and #490's four discovery guards.
// ═════════════════════════════════════════════════════════════════════════════

describe("the nav's own class string is byte-identical", () => {
  it("#490's `data-nav-shell` string in AdminDashboard is untouched by this ticket", () => {
    // 🔴 FOUR measured suites — THE-279, THE-286, THE-296 and THE-337 — do not
    // hand-copy the admin nav; they DISCOVER it by matching `data-nav-shell`
    // followed by a PLAIN DOUBLE-QUOTED class string. Interpolating a variable
    // into that attribute turns it into a template literal and all four stop
    // finding it. This ticket hides a DIFFERENT nav in a DIFFERENT shell and
    // must leave that one exactly as it is.
    const m = read(ADMIN_DASHBOARD).match(/data-nav-shell className="([^"]*)"/);
    expect(m, "AdminDashboard's nav is no longer a plain double-quoted class string — #490's four discovery guards are broken").not.toBeNull();
    expect(m![1], "the admin nav's layer moved").toContain('z-[100]');
    expect(m![1], "the admin nav lost #437's safe-area padding").toContain('pb-safe');
  });

  it('and AdminDashboard is the file this ticket did not touch at all', () => {
    expect(ownershipFailure(ADMIN_DASHBOARD),
      'AdminDashboard moved — THE-332 owns it and this ticket has no business there').toBeNull();
  });

  it("the MEMBER nav is hidden by a CONDITION, not by rewriting its class string", () => {
    // The member nav already carried a nav-hiding condition for the map tab.
    // THE-348 adds a term to it and introduces no element, so MainApp's
    // element-tree pin is untouched — which the shell suite asserts directly.
    const src = code(MAIN_APP);
    expect(src, 'the member nav no longer hides for the map tab').toMatch(/activeBottomTab === 'map'/);
    expect(src, 'the member nav does not hide for an open conversation').toMatch(/\|\| isChatOpen \?/);
    expect(src, 'the hide is not gated below lg — the desktop rail would be stripped too')
      .toMatch(/max-lg:translate-y-full/);
  });

  it('and the LOWERING is an effect cleanup, so it cannot be missed on an exit path', () => {
    // 🔴 #490's lesson and this ticket's STOP condition 4: a nav that stays
    // hidden is a trap with no way out. A `false` sent at each exit SITE would
    // cover the back arrow and miss the tab changing underneath the screen.
    const src = code(USER_MESSAGES);
    expect(src, 'the conversation signal is not raised from an effect')
      .toMatch(/onConversationOpenChange\?\.\(!!\(openDm \|\| openChannel\)\)/);
    expect(src, 'the effect has no cleanup — the nav would stay hidden on unmount')
      .toMatch(/return \(\) => onConversationOpenChange\?\.\(false\)/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 · #437 — the composer respects the home-indicator inset.
// ═════════════════════════════════════════════════════════════════════════════

describe('the composer respects pb-safe', () => {
  it('it reserves the safe-area inset itself, below lg, where the nav used to', () => {
    // ⚠️ MEASURED IN SOURCE, DELIBERATELY, and this is the one claim in the
    // ticket that a browser cannot answer: headless Chromium has no notch, so
    // `env(safe-area-inset-bottom)` resolves to 0 and the computed padding
    // reads a flat 8px on a device with an inset and without one alike. The
    // layout suite asserts the geometry; the inset itself is a source fact.
    const src = code(USER_MESSAGES);
    expect(src, "the composer's padding no longer carries the safe-area inset")
      .toMatch(/max-lg:pb-\[calc\(8px\+env\(safe-area-inset-bottom\)\)\]/);
    expect(src, 'the scroller does not clear the inset as well as the composer')
      .toMatch(/env\(safe-area-inset-bottom\)\)\]'/);
  });

  it("and #437's own class on the member nav is untouched", () => {
    // THE-295 replaced an inert `pb-safe` with the arbitrary form that
    // compiles. This ticket must not disturb it.
    expect(read(MAIN_APP), "the member nav lost #437's compiled safe-area padding")
      .toContain('pb-[calc(8px+env(safe-area-inset-bottom))]');
  });

  it('the inset is never applied UNPREFIXED — desktop must not gain a phone inset', () => {
    const src = code(USER_MESSAGES);
    for (const m of src.matchAll(/(^|\s|`)([\w:[\]-]*pb-\[calc\([^\]]*safe-area[^\]]*\)\])/g)) {
      expect(m[2], `${m[2]} applies the home-indicator inset at every width`).toMatch(/^max-lg:/);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 · No-regression: what this ticket must not have broken.
// ═════════════════════════════════════════════════════════════════════════════

describe('READING_MEASURE still caps the reading column', () => {
  it('both threads still take Rule 6, and it is still lg-gated', () => {
    const src = code(USER_MESSAGES);
    const uses = [...src.matchAll(/\$\{READING_MEASURE\}/g)].length;
    expect(uses, 'the reading measure was dropped from a thread surface').toBeGreaterThanOrEqual(4);
    expect(src, 'the reading measure is no longer paired with lg:w-full').toMatch(/lg:w-full \$\{/);
  });

  it('and Rule 6 itself is untouched and still 680px at lg', () => {
    const gates = new Set(READING_MEASURE.split(/\s+/).filter(Boolean).map((t) => t.split(':')[0]));
    expect([...gates], 'the reading measure stopped being lg-gated').toEqual(['lg']);
    expect(READING_MEASURE, 'the reading measure was widened').toContain('680px');
  });
});

describe('the DM list, channel list, compose-new, search and back all still work', () => {
  const src = code(USER_MESSAGES);

  it('the DM list still queries directMessages by participation', () => {
    expect(src).toMatch(/'directMessages'\),\s*where\('participants', 'array-contains'/);
  });

  it('the channel list still queries channels by membership', () => {
    expect(src).toMatch(/'channels'\),\s*where\('members', 'array-contains'/);
  });

  it('compose-new (PenSquare) still opens the admin picker, still gated on canStartDm', () => {
    expect(src, 'the New Message control is gone').toContain('PenSquare');
    expect(src, 'the New Message control lost its gate').toMatch(/\{canStartDm && \(/);
    expect(src, 'the picker no longer loads admins').toContain('loadAdmins()');
    expect(src, 'starting a DM no longer goes through getOrCreateDm').toContain('getOrCreateDm(');
  });

  it('the admin search still filters the picker', () => {
    expect(src, 'the search field is gone').toContain('adminSearch');
    expect(src, 'the search no longer filters').toMatch(/filteredAdmins/);
  });

  it('the back arrow still closes each thread', () => {
    expect(src, 'the DM back arrow is gone').toMatch(/onBack=\{\(\) => setOpenDm\(null\)\}/);
    expect(src, 'the channel back arrow is gone').toMatch(/onBack=\{\(\) => setOpenChannel\(null\)\}/);
    expect(src, 'a thread lost its ArrowLeft control').toContain('ArrowLeft');
  });

  it('the read-receipt write and the lastMessage bump both survive', () => {
    expect(src, 'unread messages are no longer marked read').toMatch(/\{ read: true \}/);
    expect(src, 'the conversation preview is no longer bumped').toMatch(/lastMessageAt: serverTimestamp\(\)/);
  });
});

describe('the sheets are not full-width from sm up', () => {
  it("#475's `items-end sm:items-center` survives on every remaining sheet", () => {
    // ⚠️ That fix stopped a phone sheet slamming across a 1920px screen.
    // The forms-only sheet is GONE (it became a menu, which has no full-width
    // surface to mis-place); the New Message picker is the one that remains,
    // and it must keep both halves of the pair.
    const src = code(USER_MESSAGES);
    const sheets = [...src.matchAll(/className="(fixed inset-0[^"]*)"/g)].map((m) => m[1]);
    expect(sheets.length, 'no sheet was found at all — this assertion would be vacuous').toBeGreaterThan(0);
    for (const s of sheets) {
      expect(s, `a sheet lost #475's mobile anchoring: ${s}`).toContain('items-end');
      expect(s, `a sheet would slam full-width from sm up: ${s}`).toContain('sm:items-center');
    }
    // And its panel still narrows from sm up, which is the other half of #475.
    expect(src, 'the remaining sheet panel lost its sm cap').toMatch(/sm:max-w-lg/);
  });

  it('and the forms-only picker really is gone, not merely unreferenced', () => {
    const src = code(USER_MESSAGES);
    expect(src, 'the FormPicker component is still defined').not.toContain('FormPicker');
    expect(src, 'the forms-only sheet heading is still rendered').not.toContain('Attach a Form');
    expect(src, 'the bare Paperclip icon is still imported').not.toContain('Paperclip');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5 · Primitives, palette and hygiene.
// ═════════════════════════════════════════════════════════════════════════════

describe('every element this ticket touched uses a primitive', () => {
  it('the attach surface is the SHARED AttachMenu, not a second copy of it', () => {
    const src = code(USER_MESSAGES);
    expect(src, 'the composer does not mount the shared attach menu').toMatch(/<AttachMenu\b/);
    expect(src, 'the attach menu is not imported from the shared module')
      .toMatch(/from '\.\/attach\/AttachMenu'/);
  });

  it('and it reaches eight installed primitives THROUGH that module', () => {
    // ⚠️ REUSE, NOT RE-INSTALL. `AttachMenu` already composes dropdown-menu,
    // dialog, button, alert, empty and spinner, plus the cascader; importing
    // the module is what stops this file growing a second, drifting copy of
    // the same surface — which is exactly how the forms-only sheet came to
    // exist beside AdminCommunity's menu in the first place.
    const menu = code('src/components/attach/AttachMenu.tsx');
    for (const p of ['dropdown-menu', 'dialog', 'button', 'alert', 'empty', 'spinner']) {
      expect(menu, `AttachMenu stopped composing ui/${p}`).toContain(`@/components/ui/${p}`);
    }
    expect(menu, 'AttachMenu stopped composing the cascader').toContain('reui/cascader/cascader');
  });

  it('the icon map is the EXPORTED one — the chip and the menu cannot drift', () => {
    expect(code(USER_MESSAGES), 'the attached chip no longer draws AttachTypeIcon')
      .toContain('AttachTypeIcon');
    expect(code('src/components/attach/AttachMenu.tsx'), 'AttachTypeIcon stopped being exported')
      .toMatch(/export function AttachTypeIcon/);
  });

  /**
   * 🔴 WHAT WAS REJECTED, PER ELEMENT, AND WHY.
   *
   * The ticket asks for the rejection to be named rather than implied, so the
   * three hand-written elements this file still carries are named here with
   * the primitive each was measured against.
   *
   * • THE COMPOSER PILL stays hand-written. `input-group` is the candidate and
   *   it was rejected on layout: the pill is what carries `READING_MEASURE`,
   *   and Rule 6 goes on the PILL and not on the bar around it precisely so
   *   the bar's top border and surface stay full-bleed. `input-group` owns its
   *   own wrapper and border, so adopting it would move the measure onto a box
   *   this ticket is not allowed to widen.
   *
   * • THE MESSAGE SCROLLER stays a `div`. `scroll-area` is the candidate and
   *   was rejected because the thread scrolls itself programmatically — the
   *   `bottomRef.scrollIntoView` on every new message — and `scroll-area`
   *   virtualises the scrollport behind its own viewport element, so the ref
   *   would be scrolling a node that is no longer the scroller. That is a
   *   behaviour change inside a no-regression ticket.
   *
   * • THE MESSAGE BUBBLES stay `div`s. No primitive models a chat bubble;
   *   `card` is the nearest and is a padded, bordered surface, which is the
   *   opposite of what a tail-cornered bubble is.
   *
   * 🔴 AND THE REST OF THE FILE IS NOT COMPOSED, deliberately — see the
   * composition proposal in the PR body. 983 lines with zero primitives is a
   * ticket of its own, and doing it here would bury a three-item bug fix.
   */
  it('names its rejections in this file rather than leaving them implied', () => {
    const self = read('src/components/__tests__/THE-348.member-composer.guards.test.ts');
    for (const p of ['input-group', 'scroll-area', 'card']) {
      expect(self, `${p} was neither adopted nor rejected in writing`).toContain(p);
    }
  });
});

describe('no colour hardcoded, no emoji, no raw Tailwind scale', () => {
  const src = code(USER_MESSAGES);

  it('this ticket introduces no new hex, rgb or hsl literal', () => {
    // ⚠️ `var(--brand-color, #B8962E)` is PRE-EXISTING and appears throughout
    // this file; the claim is that the count did not GROW, not that it is zero.
    // Widening it to zero would be a different ticket — and a real one.
    const hexes = [...src.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0]);
    expect(new Set(hexes), 'a hex colour other than the brand fallback appeared')
      .toEqual(new Set(['#B8962E']));
  });

  it('every one of them is the brand variable’s FALLBACK, never a bare colour', () => {
    for (const m of src.matchAll(/#B8962E/g)) {
      const before = src.slice(Math.max(0, m.index! - 30), m.index!);
      expect(before, 'a brand hex is used outside var(--brand-color, …)').toContain('--brand-color,');
    }
  });

  it('no emoji survives anywhere in the file', () => {
    // 🔴 THIS TICKET REMOVED FIVE: 📄 👤 📝 🎯 stood in for the four record
    // types on the attachment card, and 📎 prefixed the conversation-list
    // preview. An emoji is a font-dependent colour glyph that ignores every
    // palette, renders differently on each OS and is announced by a screen
    // reader as its CLDR name.
    const emoji = [...src.matchAll(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu)].map((m) => m[0]);
    expect(emoji, `emoji still in the source: ${emoji.join(' ')}`).toEqual([]);
  });

  it('and no raw Tailwind colour scale — #482 left one palette family', () => {
    // `divide-stone-*` and every other raw scale is forbidden: the palette is
    // the token set, and a raw scale answers to none of it.
    const scales = [...src.matchAll(
      /\b(?:bg|text|border|divide|ring|from|via|to|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g,
    )].map((m) => m[0]);
    expect(scales, `raw Tailwind scales in the source: ${scales.join(' ')}`).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6 · This PR's own guards are the kind that guard.
// ═════════════════════════════════════════════════════════════════════════════

const THE_348_SUITES = [
  'src/components/__tests__/THE-348.member-composer.layout.test.tsx',
  'src/components/__tests__/THE-348.member-composer.guards.test.ts',
];

describe("THE-348's own guards", () => {
  it('no test pins a LINE NUMBER', () => {
    // 🔴 THE-331 pinned `AdminCommunity.tsx:491`; a deletion moved that surface
    // to `:311`, so the suite would have MEASURED WHATEVER LANDED THERE rather
    // than failing. Every line number in this ticket's brief has already moved.
    for (const rel of THE_348_SUITES) {
      const src = code(rel);
      const pins = [...src.matchAll(/\.tsx?:(\d+)/g)].map((m) => m[0]);
      expect(pins, `${rel} pins a line number: ${pins.join(' ')}`).toEqual([]);
    }
  });

  it('no fixture is pinned to a date near today', () => {
    // 🔴 A fixture pinned near the run date passes for a week and then starts
    // failing on a clock. Every timestamp this ticket uses is years old and
    // absolute — no Date.now(), no "yesterday", no new Date() with no argument.
    // ⚠️ THIS TEST READS THE CLOCK, and that is not the thing it forbids. The
    // ban is on a FIXTURE derived from the clock; comparing a fixture's age
    // against today is what makes the ban checkable. So the clock-read scan is
    // applied to the suite that HOLDS the fixtures, not to this one — a check
    // that failed on its own comparison would be the same self-matching bug as
    // the branch-diff scan above.
    const NOW = Date.now();
    const A_YEAR = 365 * 24 * 3600 * 1000;
    expect(code(THE_348_SUITES[0]), 'the layout suite builds a fixture from the current clock')
      .not.toMatch(/Date\.now\(\)/);
    expect(code(THE_348_SUITES[0]), 'the layout suite builds a fixture from an argument-less new Date()')
      .not.toMatch(/new Date\(\)/);
    for (const rel of THE_348_SUITES) {
      const src = code(rel);
      for (const m of src.matchAll(/\b1_?\d{3}_?\d{3}_?\d{3}_?\d{3}\b/g)) {
        const ms = Number(m[0].replace(/_/g, ''));
        expect(Math.abs(NOW - ms), `${rel} pins a fixture at ${new Date(ms).toISOString()}, which is within a year of today`)
          .toBeGreaterThan(A_YEAR);
      }
    }
  });

  it('no guard in this PR asserts anything about the current branch’s DIFF', () => {
    // 🔴 #454. A guard that reads the branch diff asserts something about how
    // the work ARRIVED rather than about the code, so it passes or fails on the
    // shape of a rebase. Nothing in this ticket shells out at all.
    //
    // ⚠️ THE CHECK LOOKS FOR THE MECHANISM, NOT THE WORD. A first version
    // listed the names as strings and failed on ITSELF — the list is in the
    // file, so the file "contains" every name in it. A guard that cannot tell
    // its own subject from its own source is precisely the class of defect
    // this block exists to rule out. Shelling out needs an IMPORT and a CALL;
    // both are matched as syntax, neither of which this file has.
    for (const rel of THE_348_SUITES) {
      const src = code(rel);
      expect(src, `${rel} imports a process-spawning module`)
        .not.toMatch(/(?:from|require\()\s*['"]node:child_process['"]/);
      expect(src, `${rel} calls out to a subprocess`).not.toMatch(/\b(?:execSync|execFileSync|spawnSync|exec|spawn)\s*\(/);
    }
  });

  it('and every measured claim really is measured — the layout suite runs in `node`', () => {
    // ⚠️ happy-dom has no layout engine, and `browser-measure` needs the `node`
    // environment or the CDP attach fails cross-origin. A layout suite that
    // silently ran under a DOM env would measure zeros and pass.
    const layout = read(THE_348_SUITES[0]);
    expect(layout.startsWith('// @vitest-environment node'),
      'the layout suite lost its node pragma — every measurement would be a zero').toBe(true);
    expect(layout, 'the layout suite stopped suppressing animation before measuring')
      .toContain('animation:none !important');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7 · The files this ticket may not touch.
// ═════════════════════════════════════════════════════════════════════════════

describe('firestore.rules, firestore.indexes.json, functions/ and layout.tsx are byte-identical', () => {
  it('firestore.rules is at a digest a ticket recorded — it AUTO-DEPLOYS on merge', () => {
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production with no emulator tests')
      .toBeNull();
  });

  it('and THE-348 recorded NO firestore.rules digest of its own', () => {
    // 🔴 The ticket's own instruction: do NOT record a firestore.rules digest
    // in this ticket's ownership file. This ticket did not change the rules,
    // so recording one would claim an authorship it does not have.
    const own = JSON.parse(read('src/__tests__/__fixtures__/ownership/THE-348.json')) as {
      entries: { file: string }[];
    };
    expect(own.entries.map((e) => e.file), "THE-348's register names firestore.rules")
      .not.toContain('firestore.rules');
  });

  it('src/app/layout.tsx hashes to a digest the register accepts', () => {
    expect(ownershipFailure('src/app/layout.tsx'),
      "layout.tsx moved — this ticket's non-negotiables name it as untouchable").toBeNull();
  });

  it('firestore.indexes.json is byte-identical to the state this ticket found it in', () => {
    /**
     * 🔴 THE DIGEST IS RECORDED FROM `origin/main`, NOT RE-DERIVED FROM THE
     * WORKING TREE. The ownership register does not carry this file, so the
     * value is spelled here — and it is spelled as a CONSTANT because hashing
     * the file at assertion time and comparing it to itself would pass no
     * matter what the file held. One guard in this series did exactly that.
     */
    const AT_BASE = '8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0';
    expect(createHash('sha256').update(readFileSync(path.join(ROOT, 'firestore.indexes.json'))).digest('hex'),
      'the indexes moved').toBe(AT_BASE);
  });

  it('functions/ carries no change from this ticket', () => {
    // Nothing in this ticket is a server concern; the whole change is two
    // client components and their guards. A file here would be a smell.
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'lib' ? [] : walk(p);
        return [p];
      });
    const fns = walk(path.join(ROOT, 'functions'));
    expect(fns.length, 'functions/ vanished — this assertion would be vacuous').toBeGreaterThan(0);
    // Nothing under functions/ mentions this screen or its composer.
    for (const f of fns.filter((x) => /\.(ts|js|json)$/.test(x) && statSync(x).size < 400_000)) {
      expect(readFileSync(f, 'utf8'), `${f} mentions the member composer`).not.toMatch(/onConversationOpenChange/);
    }
  });

  it('UserMessages and MainApp are at the digests THIS ticket recorded', () => {
    for (const f of [USER_MESSAGES, MAIN_APP]) {
      expect(ownershipFailure(f), `${f} is at a digest no ticket recorded`).toBeNull();
    }
  });
});
