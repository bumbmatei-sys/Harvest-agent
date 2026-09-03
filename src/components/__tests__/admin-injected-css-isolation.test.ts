import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * A `<style>` block a component injects is GLOBAL, and it is UNLAYERED.
 *
 * ── The defect this exists to stop ───────────────────────────────────────────
 * Four screens opened with the same line:
 *
 *     * { box-sizing: border-box; margin: 0; padding: 0; }
 *
 * That is a page-level CSS reset, of the kind you write once at the top of a
 * standalone document — and these are not standalone documents, they are tabs
 * rendered inside the admin shell. React puts the rule in the real stylesheet
 * for as long as the component is mounted, so it applied to the whole
 * application, the nav rail included.
 *
 * Specificity did not save it, and this is the part that is easy to get wrong.
 * Tailwind v4 puts every utility in `@layer utilities`; an UNLAYERED rule beats
 * every layered rule no matter how specific, so a bare `*` selector with
 * specificity 0,0,0 outranked `p-4`, `px-6`, `gap-5` and every other spacing
 * utility in the app. Opening the AI Knowledge tab visibly moved the admin
 * sidebar, because its padding had been deleted. globals.css documents the same
 * mechanism at the top of the file for the rules that rely on it deliberately.
 *
 * It was also pure dead weight: Tailwind's preflight already sets box-sizing
 * and zeroes margins, so nothing on those screens depended on it.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 * A selector in an injected block must be SCOPED — to a `[data-…]` root, or to
 * a class. Two exceptions, both narrow and both checked:
 *   • an at-rule (`@keyframes`, `@media`, `@import`) — it names no element;
 *   • a `:root` block that declares nothing but custom properties, which is how
 *     AIChat reaches past `@layer base` on purpose.
 */

const COMPONENTS = path.resolve(__dirname, '..');

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    if (name === '__tests__' || name === 'node_modules') return [];
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });

/** Every `<style>{`…`}</style>` body in a file. */
const styleBlocks = (src: string): string[] =>
  [...src.matchAll(/<style>\{`([\s\S]*?)`\}<\/style>/g)].map((m) => m[1]);

/**
 * The top-level selectors in a CSS string, with at-rules and their bodies
 * skipped.
 *
 * Hand-rolled rather than parsed with postcss because these blocks are template
 * literals that may carry `${}` interpolation, which is not CSS and which a
 * parser would reject outright — turning a guard into an error.
 */
const topLevelSelectors = (css: string): string[] => {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  let paren = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (ch === '{') {
      if (depth === 0) {
        const sel = buf.trim();
        if (sel) out.push(sel);
        buf = '';
      }
      depth += 1;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
      if (depth === 0) buf = '';
    } else if (ch === '(' && depth === 0) {
      paren += 1;
      buf += ch;
    } else if (ch === ')' && depth === 0) {
      paren = Math.max(0, paren - 1);
      buf += ch;
    } else if (depth === 0) {
      buf += ch;
      // A statement at-rule (`@import url(…);`) never opens a brace, so `;` is
      // where it ends — EXCEPT inside its parentheses.
      //
      // ⚠️ This guard's first version split on every `;`, and a Google Fonts
      // URL is full of them: `family=Crimson+Pro:ital,wght@0,400;0,600;1,400`
      // came apart into three fragments, two of which do not start with `@`.
      // BiblePage.tsx was reported as injecting three unscoped selectors when
      // its whole block is one `@import`. A guard that invents a violation is
      // worse than no guard, because the exemption it earns is permanent.
      if (ch === ';' && paren === 0) {
        const sel = buf.trim();
        if (sel) out.push(sel);
        buf = '';
      }
    }
  }
  return out;
};

/** The body of the first `:root { … }` block in a CSS string, if any. */
const rootBody = (css: string): string | null => {
  const at = css.indexOf(':root');
  if (at === -1) return null;
  const open = css.indexOf('{', at);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return null;
};

/**
 * Split on `sep`, but not inside parentheses.
 *
 * ⚠️ BOTH callers need this and the first version of neither had it. A selector
 * list is comma-separated and a statement at-rule ends at a `;`, so the naive
 * split looks right — until the thing being split is
 * `@import url('…family=Crimson+Pro:ital,wght@0,400;0,600;1,400…')`, which is
 * one at-rule containing four commas and two semicolons. It came apart into
 * fragments that read as bare element selectors, and BiblePage.tsx was reported
 * as injecting three global selectors when its whole block is that one import.
 *
 * A guard that invents a violation is worse than no guard: the exemption it
 * earns outlives the mistake and quietly covers the next real offender.
 */
const splitTop = (text: string, sep: ',' | ';'): string[] => {
  const out: string[] = [];
  let buf = '';
  let paren = 0;
  for (const ch of text) {
    if (ch === '(') paren += 1;
    else if (ch === ')') paren = Math.max(0, paren - 1);
    if (ch === sep && paren === 0) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  out.push(buf);
  return out;
};

const isScoped = (selector: string): boolean =>
  splitTop(selector, ',')
    .map((s) => s.trim())
    .filter(Boolean)
    .every((s) => s.startsWith('@') || s.includes('[data-') || /(^|\s)\./.test(s) || s.startsWith(':root'));

/**
 * ⚠️ EMPTY, AND THAT IS THE POINT.
 *
 * The pattern was copied into five files. Four carried a real `*` reset —
 * AdminRAG, AdminCourseEditor, AdminRoles and AIChat — and all four are fixed:
 * the reset deleted (Tailwind's preflight already sets box-sizing and zeroes
 * margins, so nothing depended on it) and every remaining selector prefixed
 * with the screen's own `[data-…]` root.
 *
 * The fifth, BiblePage.tsx, never had the defect at all. It was reported by an
 * earlier version of `topLevelSelectors` that split on every `;` — and a Google
 * Fonts URL is full of them, so its single `@import` came apart into three
 * fragments that read as unscoped selectors. The parser is paren-aware now and
 * BiblePage leaves this list because it was never supposed to be on it.
 *
 * The list stays as a MECHANISM rather than being deleted with its last entry:
 * the assertion below pins it to exactly the set still unscoped, in both
 * directions, so an empty list is now a claim the suite makes out loud — and a
 * new offender fails rather than quietly joining a list nobody reads.
 */
const KNOWN_UNSCOPED: ReadonlyArray<{ file: string; why: string }> = [];

const OWNED_ELSEWHERE = KNOWN_UNSCOPED.map((e) => e.file);

const FILES = walk(COMPONENTS).filter((f) => styleBlocks(readFileSync(f, 'utf8')).length > 0);

describe('a component may not inject CSS that reaches past itself', () => {
  it('finds the injected blocks at all — otherwise every assertion below is vacuous', () => {
    expect(FILES.length, 'no <style> blocks found; the scan is broken').toBeGreaterThanOrEqual(5);
  });

  it('the known-unscoped list is exactly the files that are still unscoped', () => {
    // Both directions. A file that gets fixed must LEAVE this list, or the list
    // starts exempting files that no longer need exempting — which is how a
    // guard quietly turns into a no-op.
    const stillUnscoped = FILES
      .filter((f) => styleBlocks(readFileSync(f, 'utf8'))
        .flatMap(topLevelSelectors).some((sel) => !isScoped(sel)))
      .map((f) => path.basename(f))
      .sort();
    expect(stillUnscoped, 'this list is stale — a file was fixed, or a new one broke the rule')
      .toEqual([...OWNED_ELSEWHERE].sort());
    for (const { file, why } of KNOWN_UNSCOPED) {
      expect(why.length, `${file} is listed without a stated reason`).toBeGreaterThan(80);
    }
  });

  it.each(FILES.map((f) => [path.relative(COMPONENTS, f), f] as const))(
    '%s scopes every selector it injects',
    (rel, full) => {
      if (OWNED_ELSEWHERE.includes(path.basename(full))) return;
      const unscoped = styleBlocks(readFileSync(full, 'utf8'))
        .flatMap(topLevelSelectors)
        .filter((s) => !isScoped(s));
      expect(
        unscoped,
        `${rel} injects a global selector — it will apply to the whole admin shell, ` +
          'and being unlayered it will beat every Tailwind utility regardless of specificity',
      ).toEqual([]);
    },
  );

  it('nobody has reintroduced the universal reset', () => {
    const offenders = FILES
      .filter((f) => !OWNED_ELSEWHERE.includes(path.basename(f)))
      .filter((f) => styleBlocks(readFileSync(f, 'utf8')).some((b) => /(^|[\s,{}])\*\s*\{/.test(b)));
    expect(offenders.map((f) => path.relative(COMPONENTS, f)), 'a `*` reset is back').toEqual([]);
  });

  it('none of the four screens behind the reported defect carries it', () => {
    // AI Knowledge and the course builder were the first pair; CRM → Roles and
    // Ask Harvest were reported after, with the identical symptom.
    for (const f of ['AdminRAG.tsx', 'AdminCourseEditor.tsx', 'AdminRoles.tsx', 'AIChat.tsx']) {
      const src = readFileSync(path.join(COMPONENTS, f), 'utf8');
      expect(
        styleBlocks(src).some((b) => /(^|[\s,{}])\*\s*\{/.test(b)),
        `${f} injects a universal reset again — this is what moved the admin sidebar`,
      ).toBe(false);
    }
  });

  it('the one :root block declares nothing but custom properties', () => {
    // AIChat reaches past `@layer base` deliberately. That is fine for a
    // variable — every consumer already opted in by naming it — and is not fine
    // for a property, which would land on <html> for the whole app.
    for (const f of FILES) {
      for (const block of styleBlocks(readFileSync(f, 'utf8'))) {
        const body = block.includes(':root') ? rootBody(block) : null;
        if (body === null) continue;
        const props = [...body.matchAll(/(^|;)\s*([a-zA-Z-]+)\s*:/g)].map((m) => m[2]);
        const nonCustom = props.filter((p) => !p.startsWith('--'));
        expect(nonCustom, `${path.relative(COMPONENTS, f)} sets a real property on :root`).toEqual([]);
      }
    }
  });

  it('each fixed screen still scopes to its own root', () => {
    // Names the fix per screen, so deleting one `[data-…]` prefix fails here
    // with the file and the attribute rather than only as a generic "unscoped
    // selector" somewhere in the sweep above.
    for (const [file, attr] of [
      ['AdminRAG.tsx', 'data-rag-root'],
      ['AdminCourseEditor.tsx', 'data-course-editor-root'],
      ['AdminRoles.tsx', 'data-roles-root'],
      ['AIChat.tsx', 'data-ai-chat-root'],
    ] as const) {
      const src = readFileSync(path.join(COMPONENTS, file), 'utf8');
      expect(src, `${file} lost its scope root`).toContain(`<div ${attr} `);
      for (const block of styleBlocks(src)) {
        for (const sel of topLevelSelectors(block)) {
          // An at-rule names no element; `:root` is the documented exception
          // and is checked for custom-properties-only just above.
          if (sel.startsWith('@') || sel.trim().startsWith(':root')) continue;
          // `.ai-markdown-content …` is already class-scoped to content this
          // screen renders, which is the other way of not reaching past
          // yourself and is what the rule actually asks for.
          if (/(^|\s)\./.test(sel)) continue;
          expect(sel, `${file} injects ${sel} unscoped`).toContain(`[${attr}]`);
        }
      }
    }
  });

  it('Ask Harvest no longer hides every scrollbar in the app', () => {
    // `::-webkit-scrollbar { width: 0 }` was unscoped, so mounting this screen
    // removed the scrollbar from the nav rail and every other scroll container.
    // Named because it is the one rule here whose damage is invisible in a
    // screenshot until you try to scroll something else.
    const src = readFileSync(path.join(COMPONENTS, 'AIChat.tsx'), 'utf8');
    for (const block of styleBlocks(src)) {
      for (const sel of topLevelSelectors(block)) {
        if (!sel.includes('::-webkit-scrollbar')) continue;
        expect(sel, 'the scrollbar rule reaches the whole app again')
          .toContain('[data-ai-chat-root]');
      }
    }
  });

  it.each(['AdminRAG.tsx', 'AIChat.tsx'])('the animations %s defines are its own, not Tailwind\'s', (f) => {
    // `@keyframes` is global whatever else is scoped. AdminRAG used to define
    // `spin` and `pulse`, and AIChat `bounce` — the exact names `animate-spin`,
    // `animate-pulse` and `animate-bounce` resolve to — so every spinner and
    // every bouncing element in the app took this screen's timing while it was
    // mounted.
    const src = readFileSync(path.join(COMPONENTS, f), 'utf8');
    const names = [...src.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) {
      expect(['spin', 'pulse', 'ping', 'bounce'], `@keyframes ${n} shadows a Tailwind animation`)
        .not.toContain(n);
    }
  });
});
