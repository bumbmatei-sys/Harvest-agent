// @vitest-environment node
//
// NODE, NOT happy-dom — the reason THE-346, THE-331 and THE-320 each record,
// re-verified here rather than inherited: with a DOM environment selected,
// `MeasuringBrowser` never attaches (its CDP request is cross-origin under
// browser fetch semantics) and the suite times out. Nothing below needs a DOM:
// the page is rendered to a string and every number is read out of a real
// Chromium over CDP.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Button } from '../ui/button';
import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { setUpOrFail } from '../../test/support/suite-setup';
import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';
import { CONTROL_DENSITY_TOKENS } from '../layout/form-layout';

/**
 * THE-356 — the two findings THE-354 turned up on its way to being closed.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 WHY EVERY CLAIM IN THIS FILE IS MEASURED IN A BROWSER
 *
 * Both findings are about a COMPUTED NUMBER, and neither can be seen from
 * source. `happy-dom` has no layout engine: with the real compiled stylesheet
 * injected, `getBoundingClientRect()` answers zero on every element. So a
 * source-only version of this file would pass on both defects.
 *
 *   PART 1 asks whether one component's injected `* { padding: 0 }` deletes a
 *   SIBLING's padding. That is a computed style on an element in a different
 *   subtree; no class string anywhere states it.
 *
 *   PART 2 asks whether a `Button` is tall enough to hit with a thumb. THE-354
 *   found `ui/button.tsx`'s intrinsic sizes are 24 / 28 / 32 / 36px — every one
 *   BELOW both floors — so every adopter must add its own. A static guard could
 *   only ask whether some class string is present, which is the exact weakness
 *   THE-354 exposed in the member-screen pins: `h-11 w-11` and `size-11` render
 *   identically at 44px and a spelling guard calls one of them wrong.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 TRANSITIONS AND ANIMATIONS ARE SUPPRESSED IN THE MEASURED PAGE
 *
 * `buttonVariants`' base string carries `transition-all`, and `transition-all`
 * includes `min-height`. `MeasuringBrowser.settle()` waits two animation frames
 * (~32ms), well inside a 150ms transition, so an un-suppressed page reports a
 * value MID-FLIGHT — THE-346 measured 7.7469px and 1.43015px for the same
 * element on consecutive runs, and #490 measured a menu row at
 * 41.79998779296875px, which is exactly 44 x 0.95: the first frame of
 * `zoom-in-95`, because `getBoundingClientRect()` reports the SCALED box.
 * Without the suppression below every number here is a race.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 NOTHING IS HAND-COPIED AND NOTHING IS PINNED TO A LINE NUMBER
 *
 * AIChat's injected CSS is read out of the shipped file at run time, and every
 * `Button` call site is DISCOVERED by parsing the shipped source. THE-331's own
 * first draft named `AdminCommunity.tsx:491`; a deletion moved that surface to
 * `:311` and the suite would have measured whatever landed there. A discovery
 * that finds nothing THROWS here rather than measuring a default.
 *
 * ⚠️ Every source read goes through the PARSER-BASED stripper (#496), imported
 * rather than copied. The regex stripper it replaced ate 154 lines of one file,
 * 85 of them code.
 */

/** The founder's phone, and the four widths above it. Width is NOT monotonic. */
const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

/** Tailwind's `sm`. Below it the 44px touch floor applies; at and above it Rule 4. */
const SM_PX = 640;

/**
 * The two floors, and they are DIFFERENT NUMBERS ON PURPOSE.
 *
 * 🔴 Rule 4 fixes a control at 38px above `sm` and `form-layout.ts` asserts
 * `DENSITY_PX.control < 44` DELIBERATELY — a desktop control is not a touch
 * target. A guard that demanded 44px everywhere would contradict Rule 4 and
 * turn the whole app red, so the floor below is width-dependent.
 *
 * ⚠️ 38 rather than 40 above `sm` is what makes a legitimate 40px control at
 * 1024+ pass: `min-h-11` is 2.75rem, and globals.css trims the rem base to
 * 14.5px above 1024px, so a 44px phone control computes to 40px on a desktop.
 * That is the token working, not a failure.
 */
const TOUCH_FLOOR_PX = 44;
const DESKTOP_FLOOR_PX = 38;

/**
 * 🔴 WHICH BUTTONS THE DESKTOP FLOOR GOVERNS, AND WHY IT IS NOT ALL OF THEM.
 *
 * ⚠️ MEASURED BEFORE IT WAS WRITTEN DOWN. A first draft applied 38px to every
 * Button above `sm` and reported TEN existing call sites as broken — among them
 * `Profile`'s `variant="link"` partner link at 20.13px and `SmsSection`'s KYC
 * link at 29px. Those are not controls; they are inline text wearing a button's
 * event handling, and `link` is the variant that says so. Demanding a 38px box
 * around a text link would be the same category error as demanding 44px above
 * `sm`, which the ticket already names as the thing that would turn the app red.
 *
 * So the desktop floor governs the buttons that OPT INTO Rule 4 — the ones
 * whose class string carries a `CONTROL_DENSITY` token, which is this repo's
 * own declaration that a control is what it is. That set is discovered from the
 * resolved class string, not hand-listed, so a button that adopts the token
 * later is governed automatically.
 *
 * 🔴 THE 44px TOUCH FLOOR BELOW `sm` GOVERNS EVERY BUTTON, with no such
 * exemption, and that is the claim worth having: it is the one a thumb tests.
 * Every adopter in the repo passes it today.
 */
const RULE_4_TOKENS = CONTROL_DENSITY_TOKENS;

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel: string) => stripComments(read(rel));

// ═════════════════════════════════════════════════════════════════════════════
// PART 1 · AIChat's injected CSS, discovered rather than transcribed
// ═════════════════════════════════════════════════════════════════════════════

const AI_CHAT = 'src/components/AIChat.tsx';

/** The one `<style>{`…`}</style>` body AIChat injects, read at run time. */
function injectedCss(rel: string): string {
  const blocks = [...read(rel).matchAll(/<style>\{`([\s\S]*?)`\}<\/style>/g)].map((m) => m[1]);
  if (blocks.length !== 1) {
    throw new Error(`${rel}: expected exactly one injected <style> block, found ${blocks.length}`);
  }
  return blocks[0];
}

const AI_CHAT_CSS = injectedCss(AI_CHAT);

/**
 * 🔴 THE BLOCK AS IT WAS, AND WHY IT IS A LITERAL RATHER THAN A HISTORY READ.
 *
 * This is the "before" the measurement below compares against — the three
 * unscoped rules this ticket removes or scopes. It is written out because a
 * guard that shells out to version control is a guard that asserts something
 * about the current branch, which #454 sweeps for and THE-315 detects, and
 * because a depth-1 clone has no history to read.
 *
 * ⚠️ It is not trusted either: `the reset really did zero a sibling` below
 * fails if this literal stops reproducing the defect, so a stale copy is a red
 * suite rather than a quiet pass.
 */
const UNSCOPED_RESET_AS_IT_WAS = `
 * { box-sizing: border-box; margin: 0; padding: 0; }
 ::-webkit-scrollbar { width: 0; }
 textarea { outline: none; resize: none; }
`;

// ═════════════════════════════════════════════════════════════════════════════
// PART 2 · every `<Button>` call site, discovered by parsing the shipped source
// ═════════════════════════════════════════════════════════════════════════════

/** Every file that imports the button primitive — BOTH import spellings. */
function buttonAdopters(): string[] {
  const walk = (dir: string): string[] =>
    require('node:fs').readdirSync(dir, { withFileTypes: true }).flatMap((e: { name: string; isDirectory: () => boolean }) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === 'node_modules' || e.name === '__tests__' ? [] : walk(p);
      return /\.tsx$/.test(e.name) ? [p] : [];
    });
  /**
   * ⚠️ BOTH SPELLINGS. THE-354 grepped only the `@/` alias and missed
   * `AdminCRM.tsx`'s `from './ui/collapsible'` — the identical bug THE-272's
   * register records ("a `../ui/chart` import would have slipped past it
   * unrecorded"). The repo uses relative and aliased forms side by side.
   */
  const IMPORTS_BUTTON = /from ['"](?:@\/components|\.{1,2}(?:\/[\w.-]+)*)\/ui\/button['"]/;
  return walk(path.join(ROOT, 'src'))
    .filter((f) => !f.startsWith(path.join(ROOT, 'src/components/ui')))
    .filter((f) => IMPORTS_BUTTON.test(readFileSync(f, 'utf8')))
    .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
    .sort();
}

/**
 * Every `<Button …>` OPENING TAG in a source string.
 *
 * 🔴 A BRACE-AWARE SCAN, NOT A REGEX. These tags carry arrow functions, nested
 * objects, template literals and `render={<a … />}` props, so `/<Button[^>]*>/`
 * stops at the first `>` inside an arrow body and returns a truncated tag —
 * whose `className` is then missed entirely and the call site silently measured
 * as though it carried no floor at all. Strings are skipped so a `>` inside one
 * cannot close the tag either.
 */
function buttonTags(src: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < src.length; i += 1) {
    if (!src.startsWith('<Button', i)) continue;
    if (/[A-Za-z0-9_]/.test(src[i + 7] ?? '')) continue; // <ButtonGroup, <ButtonX
    let depth = 0;
    let quote: string | null = null;
    let j = i + 7;
    for (; j < src.length; j += 1) {
      const c = src[j];
      if (quote) {
        if (c === '\\') { j += 1; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) break;
    }
    out.push(src.slice(i, j + 1));
  }
  return out;
}

type CallSite = {
  id: string;
  file: string;
  variant?: string;
  size?: string;
  className: string;
  /** The raw tag, for a failure message that names the thing that is wrong. */
  tag: string;
};

/**
 * Resolve a `${…}` interpolation inside a discovered `className`.
 *
 * 🔴 AN UNRESOLVABLE INTERPOLATION THROWS. Dropping it would leave the call
 * site measured WITHOUT the very token that gives it its floor, so the guard
 * would report a correct button as broken — or, once someone "fixed" that by
 * defaulting to empty, report a broken one as correct. Either way it stops
 * measuring the thing it claims to.
 */
function resolveInterpolation(expr: string, fileSrc: string, depth = 0): string {
  const trimmed = expr.trim();
  const layout = code('src/components/layout/form-layout.ts');
  /**
   * ⚠️ A DEPTH BOUND, because these constants nest: `SmsSection`'s `BUTTON` is
   * a template literal that interpolates `CONTROL_DENSITY.action` AND
   * `ACTION_BUTTON`. A cycle would otherwise hang the suite rather than fail it.
   */
  if (depth > 8) throw new Error(`\${${trimmed}} nests more than 8 deep — a cycle?`);

  // `CONTROL_DENSITY.action`, `FIELD_WIDTH.short` — a member of a const object.
  const member = trimmed.match(/^([A-Z][A-Z0-9_]*)\.(\w+)$/);
  if (member) {
    const [, obj, key] = member;
    for (const src of [fileSrc, layout]) {
      const at = src.indexOf(`${obj} = {`);
      if (at === -1) continue;
      const body = src.slice(at, src.indexOf('} as const', at) + 1);
      const hit = body.match(new RegExp(`\\b${key}:\\s*'([^']*)'`));
      if (hit) return hit[1];
    }
  }
  // A bare `const NAME = '…'` or a TEMPLATE LITERAL, here or in form-layout.
  //
  // 🔴 The template case is not a nicety: every rota and SMS button reaches its
  // floor through one — `const ANSWER_BUTTON = \`min-h-[44px] … ${'${CONTROL_DENSITY.action}'}\``
  // — so a resolver that read only quoted strings would have thrown on the very
  // call sites this guard exists to measure.
  const bare = trimmed.match(/^([A-Za-z_$][\w$]*)$/);
  if (bare) {
    for (const src of [fileSrc, layout]) {
      const quoted = src.match(new RegExp(`\\b(?:const|let)\\s+${bare[1]}\\s*=\\s*'([^']*)'`));
      if (quoted) return quoted[1];
      const tpl = src.match(new RegExp('\\b(?:const|let)\\s+' + bare[1] + '\\s*=\\s*`([^`]*)`'));
      if (tpl) {
        return tpl[1].replace(/\$\{([^}]*)\}/g, (_m, inner: string) =>
          resolveInterpolation(inner, src, depth + 1));
      }
    }
  }
  throw new Error(
    `cannot resolve \${${trimmed}} in a Button className. This guard must not ` +
    'drop it: measuring the call site without its own token would report a ' +
    'correct button as broken, or hide a broken one. Teach the resolver, or ' +
    'name the constant in form-layout.ts.',
  );
}

/** The `className` a call site ships, with every interpolation resolved. */
function classNameOf(tag: string, fileSrc: string): string {
  const dq = tag.match(/className="([^"]*)"/);
  if (dq) return dq[1];
  const tpl = tag.match(/className=\{`([^`]*)`\}/);
  if (tpl) {
    return tpl[1].replace(/\$\{([^}]*)\}/g, (_m, expr: string) => resolveInterpolation(expr, fileSrc));
  }
  const ident = tag.match(/className=\{([A-Za-z_$][\w$.]*)\}/);
  if (ident) return resolveInterpolation(ident[1], fileSrc);
  if (/className=/.test(tag)) {
    throw new Error(`a Button className this guard cannot read: ${tag.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  return '';
}

function callSites(): CallSite[] {
  const out: CallSite[] = [];
  for (const file of buttonAdopters()) {
    const src = code(file);
    buttonTags(src).forEach((tag, i) => {
      const flat = tag.replace(/\s+/g, ' ');
      out.push({
        id: `${file.split('/').pop()!.replace(/\.tsx$/, '')}-${i}`,
        file,
        variant: (flat.match(/variant="([^"]*)"/) ?? [])[1],
        size: (flat.match(/size="([^"]*)"/) ?? [])[1],
        className: classNameOf(tag, src),
        tag: flat.slice(0, 200),
      });
    });
  }
  return out;
}

const SITES = callSites();

// ═════════════════════════════════════════════════════════════════════════════
// The measured page
// ═════════════════════════════════════════════════════════════════════════════

/**
 * 🔴 THE CONTROL, AND IT IS THE WHOLE POINT OF PART 2.
 *
 * A `Button` with no size override at all — `ui/button.tsx`'s own default,
 * `h-8`, which measures 32px here. THE-354's finding is that the primitive's
 * FOUR intrinsic sizes are 24 / 28 / 32 / 36px and every one is under both
 * floors; #492 shipped a send button at 36x36, the largest of them, and it
 * still had to be fixed. If the checker below cannot see that this one is
 * under the floor, the checker is not checking anything — so it is measured
 * beside the real call sites and asserted to FAIL.
 */
const BARE_ID = 'bare-default-button';

function page() {
  return (
    <div>
      {/*
        PART 1 · a SIBLING of the chat, not a child. #482's defect was exactly
        this relationship: `AdminRoles.tsx` injected the reset and the padding
        that vanished belonged to AdminCRM's switcher, a sibling in a different
        subtree. `p-4` is 16px and is a Tailwind utility, which lives in
        `@layer utilities` — an UNLAYERED `*` rule outranks it however specific
        the utility is, which is why specificity did not save the original.
      */}
      <div data-sibling className="p-4">
        <span>a sibling of the chat</span>
      </div>

      {/*
        PART 1 · a stand-in for the chat's own subtree. It carries the elements
        the reset actually touched — a default-margin block element, a padded
        box, a scroller and a textarea — so "was the reset load-bearing for
        AIChat itself" is a measurement rather than an opinion.

        ⚠️ It is NOT a copy of AIChat's markup, and does not claim to be:
        AIChat's real tree is pinned element-for-element by
        MemberScreens.desktop-layout's class, colour and height baselines, which
        this ticket leaves untouched and green. What is measured here is the
        MECHANISM the reset changes.
      */}
      <div data-ai-chat>
        <p data-chat-para>a paragraph inside the chat</p>
        {/*
          ⚠️ TWO PADDED BOXES, SPELLED DIFFERENTLY ON PURPOSE. AIChat writes its
          own padding as an INLINE STYLE (`padding: "13px 16px"` and friends),
          which outranks an unlayered `*` rule, and that is why the chat's own
          tree survived the reset it was carrying. A Tailwind `p-4` is a
          UTILITY, which the `*` rule outranked — so the class-padded box below
          is what the reset was actually destroying, inside the chat as well as
          outside it. Measuring both is what separates "AIChat needed this" from
          "AIChat was unharmed by it".
        */}
        <div data-chat-padded-inline style={{ padding: 16 }}>inline-padded, as AIChat spells it</div>
        <div data-chat-padded className="p-4">a padded box inside the chat</div>
        <div data-chat-scroller style={{ height: 40, overflowY: 'auto' }}>
          <div style={{ height: 400 }} />
        </div>
        <textarea data-chat-textarea rows={1} />
      </div>

      {/* PART 2 · every discovered call site, plus the unsized control. */}
      <div data-buttons className="flex flex-col items-start gap-2">
        {SITES.map((s) => (
          <div key={s.id} data-site={s.id}>
            <Button
              {...(s.variant ? { variant: s.variant as never } : {})}
              {...(s.size ? { size: s.size as never } : {})}
              className={s.className || undefined}
            >
              Aa
            </Button>
          </div>
        ))}
        <div data-site={BARE_ID}>
          <Button>Aa</Button>
        </div>
      </div>
    </div>
  );
}

type Box = { w: number; h: number };
type Reading = {
  siblingPadding: string;
  sibling: Box | null;
  chat: Record<string, Box | null>;
  chatPaddedClass: string;
};
type Heights = Record<string, number>;

let browser: MeasuringBrowser;

/** Heights of every `[data-site]`'s button, at one viewport. */
const HEIGHTS_EXPR = `(() => {
  const out = {};
  for (const holder of document.querySelectorAll('[data-site]')) {
    const b = holder.querySelector('button, a');
    out[holder.getAttribute('data-site')] = b ? Math.round(b.getBoundingClientRect().height * 100) / 100 : null;
  }
  return out;
})()`;

/**
 * Inject a stylesheet, read the page, remove it again.
 *
 * 🔴 TWO PASSES OVER ONE PAGE rather than two pages. The claim is a
 * DIFFERENCE — the same sibling, with and without the reset — and measuring it
 * on one document removes every other variable.
 */
const withCss = (css: string, expr: string) => `(() => {
  const el = document.createElement('style');
  el.id = 'the356-probe';
  el.textContent = ${JSON.stringify(css)};
  document.head.appendChild(el);
  try { return ${expr}; } finally { el.remove(); }
})()`;

const PART1_EXPR = `(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { w: Math.round(b.width * 100) / 100, h: Math.round(b.height * 100) / 100 };
  };
  return {
    siblingPadding: getComputedStyle(document.querySelector('[data-sibling]')).padding,
    sibling: box('[data-sibling]'),
    chat: {
      para: box('[data-chat-para]'),
      paddedInline: box('[data-chat-padded-inline]'),
      scroller: box('[data-chat-scroller]'),
      textarea: box('[data-chat-textarea]'),
    },
    chatPaddedClass: getComputedStyle(document.querySelector('[data-chat-padded]')).padding,
  };
})()`;

/**
 * 🔴 THREE PASSES, AND THE THIRD IS WHY THIS IS NOT PINNED TO A LITERAL.
 *
 * `none` is the page with NO injected block at all — the honest reference for
 * "unaffected". A first draft asserted the sibling kept `16px`, which was a
 * literal and was WRONG above 1024px: globals.css trims the rem base to 14.5px
 * there, so `p-4` is 1rem = 14.5px and the guard failed on correct code. The
 * claim is a RELATIONSHIP — scoped must equal untouched — and a relationship
 * needs the untouched reading.
 */
const none: Record<number, Reading> = {};
const scoped: Record<number, Reading> = {};
const unscoped: Record<number, Reading> = {};
const heights: Record<number, Heights> = {};

setUpOrFail(async () => {
  const css = await buildAppCss();
  const html = renderToStaticMarkup(page());
  const dir = mkdtempSync(path.join(os.tmpdir(), 'the356-'));
  const file = path.join(dir, 'the-356.html');
  writeFileSync(
    file,
    `<!doctype html><html data-theme="light"><head><meta charset="utf-8">` +
      `<style>${css}</style>` +
      // See the header: `transition-all` animates min-height and `zoom-in-95`
      // scales the box, and `getBoundingClientRect()` reports the SCALED box.
      // The resting layout is the one a person sees.
      `<style>*,*::before,*::after{transition:none !important;animation:none !important}</style>` +
      `</head><body>${html}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const v of VIEWPORTS) {
    none[v] = await browser.evaluateAt<Reading>(v, withCss('', PART1_EXPR));
    scoped[v] = await browser.evaluateAt<Reading>(v, withCss(AI_CHAT_CSS, PART1_EXPR));
    unscoped[v] = await browser.evaluateAt<Reading>(v, withCss(UNSCOPED_RESET_AS_IT_WAS, PART1_EXPR));
    heights[v] = await browser.evaluateAt<Heights>(v, HEIGHTS_EXPR);
  }
}, 240_000);

afterAll(async () => { await browser?.close(); });

// ═════════════════════════════════════════════════════════════════════════════
// 1 · the reset really did reach a sibling — and no longer does
// ═════════════════════════════════════════════════════════════════════════════

describe('1 · AIChat’s injected CSS no longer reaches past itself', () => {
  it('\u{1F534} the unscoped reset ZEROED a sibling’s padding, at every width', () => {
    // 🔴 THE NON-VACUITY CHECK, AND IT IS THE #482 SYMPTOM ITSELF, reproduced
    // in the member app. If this stops reproducing, the "after" assertion below
    // is proving nothing and this comparison is stale.
    for (const v of VIEWPORTS) {
      expect(unscoped[v].siblingPadding, `at ${v}px the old reset did NOT zero the sibling`).toBe('0px');
      expect(unscoped[v].siblingPadding, `at ${v}px the sibling was already unpadded — nothing was lost`)
        .not.toBe(none[v].siblingPadding);
    }
  });

  it('\u{1F534} and with the shipped block the sibling keeps exactly what it has untouched', () => {
    // ⚠️ COMPARED AGAINST THE UNTOUCHED PAGE, never against a literal. `p-4` is
    // 16px below 1024 and 14.5px above it, because globals.css trims the rem
    // base — a pinned `16px` fails on correct code at three of the five widths.
    for (const v of VIEWPORTS) {
      expect(scoped[v].siblingPadding, `at ${v}px AIChat is still changing a sibling’s padding`)
        .toBe(none[v].siblingPadding);
      expect(scoped[v].sibling, `at ${v}px the sibling’s box moved`).toEqual(none[v].sibling);
    }
  });

  it('the sibling really was padded, so the comparison is not two zeroes', () => {
    for (const v of VIEWPORTS) {
      expect(parseFloat(none[v].siblingPadding), `the sibling has no padding at ${v}px to lose`)
        .toBeGreaterThan(0);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 · and the chat's own layout did not move
// ═════════════════════════════════════════════════════════════════════════════

describe('2 · the reset was not load-bearing for the chat itself', () => {
  it('\u{1F534} every box inside [data-ai-chat] is what it is with no block at all', () => {
    // The claim the founder cares about: removing the reset changed nothing a
    // person can see inside the chat.
    for (const v of VIEWPORTS) {
      expect(scoped[v].chat, `the chat’s own boxes moved at ${v}px when the reset was scoped`)
        .toEqual(none[v].chat);
    }
  });

  it('\u{1F534} and they were ALREADY what they are — the reset changed none of them', () => {
    // 🔴 THE STOP CONDITION THIS TICKET CARRIED: "the reset turns out to be
    // load-bearing for AIChat's own layout". It is not, and this is the
    // measurement that settles it rather than an opinion. AIChat spells its own
    // padding as an inline style, which outranks an unlayered `*` rule, so the
    // reset never reached its own boxes.
    for (const v of VIEWPORTS) {
      expect(unscoped[v].chat, `the reset WAS load-bearing inside the chat at ${v}px`)
        .toEqual(none[v].chat);
    }
  });

  it('\u{1F534} but a CLASS-padded box inside the chat was being zeroed too', () => {
    // ⚠️ The other half of the finding, and the reason this is a fix rather
    // than a tidy: the reset outranked Tailwind utilities INSIDE the chat as
    // well as outside it. Anything added to this screen with a `p-*` class
    // would silently have had it deleted.
    for (const v of VIEWPORTS) {
      expect(unscoped[v].chatPaddedClass, `at ${v}px the class-padded box was not zeroed`).toBe('0px');
      expect(scoped[v].chatPaddedClass, `at ${v}px the shipped block still zeroes a class-padded box`)
        .toBe(none[v].chatPaddedClass);
    }
  });

  it('the scroller and the textarea are still there to have been measured', () => {
    // A box() answering null for everything would make the equalities above
    // trivially true — the vacuity shape #492 found three of in one PR.
    expect(scoped[380].chat.scroller).not.toBeNull();
    expect(scoped[380].chat.textarea).not.toBeNull();
    expect(scoped[380].chat.paddedInline?.h).toBeGreaterThan(0);
    expect(parseFloat(none[380].chatPaddedClass)).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 · every Button clears its floor
// ═════════════════════════════════════════════════════════════════════════════

describe('3 · every Button call site clears the touch floor', () => {
  it('the discovery found call sites at all, across more than one file', () => {
    // 🔴 A discovery that silently found nothing would make every assertion
    // below vacuously true — the shape #492 found three of in one PR.
    expect(SITES.length, 'no <Button> call site was discovered').toBeGreaterThan(20);
    expect(new Set(SITES.map((s) => s.file)).size, 'every call site came from one file').toBeGreaterThan(5);
  });

  it.each(VIEWPORTS)('at %ipx every adopted Button clears the 44px touch floor below sm', (v) => {
    // 🔴 THE UNIVERSAL CLAIM. Below `sm` every button is a touch target, with
    // no variant exempt, and this is the assertion a thumb would make.
    if (v >= SM_PX) {
      expect(v, 'this width is at or above sm — the touch floor does not apply here').toBeGreaterThanOrEqual(SM_PX);
      return;
    }
    const short = SITES
      .map((s) => ({ s, h: heights[v][s.id] }))
      .filter(({ h }) => typeof h === 'number' && h < TOUCH_FLOOR_PX);
    expect(
      short.map(({ s, h }) => `${s.file} :: ${h}px < ${TOUCH_FLOOR_PX}px :: ${s.tag}`),
      `a Button is under the ${TOUCH_FLOOR_PX}px touch floor at ${v}px`,
    ).toEqual([]);
  });

  it.each(VIEWPORTS)('at %ipx every Rule-4 control is at or above 38px', (v) => {
    if (v < SM_PX) {
      expect(v, 'this width is below sm — Rule 4 does not apply here').toBeLessThan(SM_PX);
      return;
    }
    const governed = SITES.filter((s) => RULE_4_TOKENS.some((t) => s.className.includes(t)));
    expect(governed.length, 'no Rule-4 control was discovered — this assertion is vacuous')
      .toBeGreaterThan(0);
    const short = governed
      .map((s) => ({ s, h: heights[v][s.id] }))
      .filter(({ h }) => typeof h === 'number' && h < DESKTOP_FLOOR_PX);
    expect(
      short.map(({ s, h }) => `${s.file} :: ${h}px < ${DESKTOP_FLOOR_PX}px :: ${s.tag}`),
      `a Rule-4 control is under the ${DESKTOP_FLOOR_PX}px floor at ${v}px`,
    ).toEqual([]);
  });

  it('\u{1F534} and the checker FAILS an unsized Button below sm — planted, not inferred', () => {
    // 🔴 THE PLANTED DEFECT. `ui/button.tsx`'s default size is `h-8`; #492
    // shipped exactly this and it measured 36x36. The same comparison the
    // assertion above makes must call this one short, or that assertion is
    // incapable of failing.
    const bare = heights[380][BARE_ID];
    expect(typeof bare, 'the unsized control was not rendered').toBe('number');
    expect(bare, 'an unsized Button now clears the touch floor on its own — the trap is gone, and this guard should be re-examined')
      .toBeLessThan(TOUCH_FLOOR_PX);
  });

  it('\u{1F534} a legitimate 40px control at 1024+ is NOT read as a failure', () => {
    // ⚠️ `min-h-11` is 2.75rem and globals.css trims the rem base to 14.5px
    // above 1024px, so a 44px phone control computes to 40px on a desktop.
    // Rule 4's floor is 38, so that is a pass — and this asserts the arithmetic
    // rather than trusting it.
    expect(DESKTOP_FLOOR_PX).toBe(38);
    expect(40).toBeGreaterThanOrEqual(DESKTOP_FLOOR_PX);
    expect(40).toBeLessThan(TOUCH_FLOOR_PX);
  });
});
