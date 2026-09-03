import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * A `<style>` block a component injects is GLOBAL, and it is UNLAYERED.
 *
 * ── The defect this exists to stop ───────────────────────────────────────────
 * Three admin screens opened with the same six lines:
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
    } else if (depth === 0) {
      buf += ch;
      // A statement at-rule (`@import url(…);`) never opens a brace.
      if (ch === ';') {
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

const isScoped = (selector: string): boolean =>
  selector
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .every((s) => s.startsWith('@') || s.includes('[data-') || /(^|\s)\./.test(s) || s.startsWith(':root'));

/**
 * ⚠️ THE FILES THAT STILL DO THIS — named, with why each was not fixed here.
 *
 * The pattern was copied into five files. Two are fixed (AdminRAG,
 * AdminCourseEditor: the screens behind the reported "opening AI Knowledge
 * moves the sidebar"). Three are not, and a list is the honest way to carry
 * that: it keeps the rule live for every other file, it keeps these three
 * visible instead of forgotten, and — because each entry is asserted to still
 * be true below — it cannot outlive the defect it describes.
 *
 * The fix in each case is the same two steps applied to the two that are done:
 * delete the `*` reset (Tailwind's preflight already sets box-sizing and zeroes
 * margins, so nothing depends on it) and prefix the rest with a `[data-…]` root
 * on the component's own outermost element.
 */
const KNOWN_UNSCOPED: ReadonlyArray<{ file: string; why: string }> = [
  {
    // THE-277 renamed this from AnalyticsAndRoles.tsx when it split Signups out.
    // The rename carried the defect across unchanged.
    file: 'AdminRoles.tsx',
    why:
      'Identical `*` reset and identical unscoped input::placeholder / ' +
      '::-webkit-scrollbar / button:disabled rules — a third admin tab with the ' +
      'same user-visible bug. THE-277 owns this file and has just landed it; ' +
      'reported rather than fixed here so a notes ticket does not reopen a file ' +
      'whose own suite pins it, on the same day it merged.',
  },
  {
    file: 'AIChat.tsx',
    why:
      'Carries the `*` reset too, plus unscoped ::-webkit-scrollbar rules. It is ' +
      'a MEMBER-app surface rather than an admin tab, so it is not behind the ' +
      'reported defect and was left alone rather than changed on a notes ticket. ' +
      'Its unlayered `:root` block is separate and deliberate — see the assertion ' +
      'below that keeps it to custom properties.',
  },
  {
    file: 'BiblePage.tsx',
    why:
      'Unscoped selectors in its injected block, including a Google Fonts ' +
      '@import. Member-app surface, same reasoning as AIChat: out of the path of ' +
      'the reported defect, and not worth changing blind on this ticket.',
  },
];

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

  it('the two screens behind the reported defect no longer carry it', () => {
    for (const f of ['AdminRAG.tsx', 'AdminCourseEditor.tsx']) {
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

  it('the two screens that were fixed still scope to their own root', () => {
    // Names the fix, so deleting the `[data-…]` prefix fails here with a reason
    // rather than only as a generic "unscoped selector" somewhere.
    for (const [file, attr] of [
      ['AdminRAG.tsx', 'data-rag-root'],
      ['AdminCourseEditor.tsx', 'data-course-editor-root'],
    ] as const) {
      const src = readFileSync(path.join(COMPONENTS, file), 'utf8');
      expect(src, `${file} lost its scope root`).toContain(`<div ${attr} `);
      for (const block of styleBlocks(src)) {
        for (const sel of topLevelSelectors(block)) {
          if (sel.startsWith('@')) continue;
          expect(sel, `${file} injects ${sel} unscoped`).toContain(`[${attr}]`);
        }
      }
    }
  });

  it('the animations AdminRAG defines are its own, not Tailwind\'s', () => {
    // `@keyframes` is global whatever else is scoped, and this block used to
    // define `spin` and `pulse` — the exact names `animate-spin` and
    // `animate-pulse` resolve to, so every spinner in the app changed timing
    // while this tab was open.
    const src = readFileSync(path.join(COMPONENTS, 'AdminRAG.tsx'), 'utf8');
    const names = [...src.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) {
      expect(['spin', 'pulse', 'ping', 'bounce'], `@keyframes ${n} shadows a Tailwind animation`)
        .not.toContain(n);
    }
  });
});
