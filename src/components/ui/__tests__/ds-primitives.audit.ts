import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss, { type Root as CssRoot } from 'postcss';
import tailwindcss from 'tailwindcss';
import ts from 'typescript';

import twConfig from '../../../../tailwind.config';

export const REPO_ROOT = path.resolve(__dirname, '../../../..');
export const GLOBALS_CSS = path.join(REPO_ROOT, 'src/app/globals.css');

/**
 * THE-260 — resolving a Tailwind class without a browser and without a build.
 *
 * Tailwind itself is run, in process, over the real `tailwind.config.ts` with
 * the real `src/app/globals.css` as the stylesheet and the files under audit as
 * its `content`. That is the pipeline `next build` runs (postcss.config.mjs),
 * minus autoprefixer — which only adds vendor prefixes and cannot change
 * whether a rule exists. The result is the app's actual stylesheet, so "does
 * this class produce a rule" is answered by the engine that decides it.
 *
 * What was rejected:
 *
 *   • Walking `theme.extend` and deciding for ourselves which key a utility
 *     reads — what src/__tests__/profile-icons.test.ts does for its narrow
 *     `bg|text|border-<hue>-<shade>` case. It does not generalise: it cannot
 *     know that `text-muted` resolves through `textColor` while `bg-muted`
 *     finds nothing, that `ring-3` is a v4 spelling with no v3 rule, or that
 *     `rounded-[min(var(--radius-md),10px)]` emits a declaration that is dead
 *     on arrival. A guard that agrees with a model of Tailwind rather than
 *     with Tailwind would have passed on all thirteen of these files.
 *   • `next build` + grepping the output. Same answer, ~100x the runtime, and
 *     it drags the whole app's content into a test about thirteen files.
 *   • A headless browser / getComputedStyle. Needs a browser, and happy-dom
 *     does not implement invalid-at-computed-value-time anyway — the exact
 *     semantics the sonner bug turns on.
 */

export type Finding =
  | { file: string; className: string; reason: 'no-rule' }
  | { file: string; className: string; reason: 'undefined-var'; property: string };

export interface AuditResult {
  /** Unresolved classes, in file order then source order. */
  findings: Finding[];
  /** Unresolved classes held back by NOT_A_UTILITY, so the list can be audited. */
  exempted: Finding[];
  /** Every class the extractor pulled out of each file, in source order. */
  classesByFile: Map<string, string[]>;
  /** How many distinct classes the built stylesheet carries a rule for. */
  generatedCount: number;
}

/* ── 1. Extraction — read the classes out of the real files ─────────────── */

const CLASS_HELPERS = new Set(['cn', 'clsx', 'twMerge', 'cx']);

/**
 * `group` and `peer` (and their named forms `group/card`, `peer/x`) are
 * Tailwind's two marker classes. They exist to be *referenced* by `group-*:`
 * and `peer-*:` variants and emit no CSS of their own, in v3 and in v4 alike.
 * Asserting they resolve would assert something Tailwind never promised.
 */
const isMarkerClass = (cls: string): boolean => /^(group|peer)(\/.+)?$/.test(cls);

/**
 * Classes in these files that are not Tailwind utilities and never were, with
 * the reason each is here. Deliberately tiny, and it cannot go stale: the
 * audit reports them separately and `every exemption is still needed` fails
 * the moment one of them starts resolving.
 */
export const NOT_A_UTILITY: Record<string, string> = {
  toaster:
    "sonner's own class. `<Sonner className=\"toaster group\">` in sonner.tsx targets the stylesheet the sonner package injects at runtime, not this app's.",
};

/**
 * Every class a primitive spells, read out of the file's own syntax tree.
 *
 * String literals are taken from the positions that carry classes and nowhere
 * else, so `defaultVariants: { variant: "default" }` does not mint a class
 * called `default`:
 *
 *   • a `className` JSX attribute — string, or any string in its expression
 *   • any argument to cn() / clsx() / twMerge() / cx()
 *   • cva()'s base argument
 *   • cva()'s `variants.<group>.<name>` values — every variant, not just the
 *     default one
 *   • cva()'s `compoundVariants[].class` / `.className`
 *
 * This is a reader, not a list. A variant added to a cva() block, or a class
 * added to a base string, is picked up on the next run with nothing to update
 * here — which is the point: a hand-written copy of these class names would be
 * a second enumeration, and second enumerations in this repo drift.
 */
export function extractClassNames(file: string, source?: string): string[] {
  const text = source ?? readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string): void => {
    for (const cls of raw.split(/\s+/)) {
      if (!cls || seen.has(cls) || isMarkerClass(cls)) continue;
      seen.add(cls);
      out.push(cls);
    }
  };

  const calleeName = (call: ts.CallExpression): string =>
    ts.isIdentifier(call.expression) ? call.expression.text : '';

  /**
   * Every string literal under `node` that is in a class position.
   *
   * Calls are the exception. `cn(buttonVariants({ variant: "outline" }), …)`
   * passes a *variant name* to a cva()-built function; the classes that
   * variant stands for live in the cva() call and are read there. Harvesting
   * the call's own arguments would mint a class called `outline`.
   */
  const harvest = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) {
      push(node.text);
      return;
    }
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name === 'cva') visitCva(node);
      else if (CLASS_HELPERS.has(name)) node.arguments.forEach(harvest);
      return;
    }
    node.forEachChild(harvest);
  };

  const nameOf = (node: ts.PropertyAssignment): string =>
    ts.isStringLiteralLike(node.name) ? node.name.text : node.name.getText(sf);

  function visitCva(call: ts.CallExpression): void {
    const [base, config] = call.arguments;
    if (base) harvest(base);
    if (!config || !ts.isObjectLiteralExpression(config)) return;

    for (const prop of config.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const key = nameOf(prop);

      if (key === 'variants' && ts.isObjectLiteralExpression(prop.initializer)) {
        // variants.<group>.<name> — the values only, never the keys.
        for (const group of prop.initializer.properties) {
          if (!ts.isPropertyAssignment(group)) continue;
          if (!ts.isObjectLiteralExpression(group.initializer)) continue;
          for (const variant of group.initializer.properties) {
            if (ts.isPropertyAssignment(variant)) harvest(variant.initializer);
          }
        }
      } else if (key === 'compoundVariants' && ts.isArrayLiteralExpression(prop.initializer)) {
        for (const entry of prop.initializer.elements) {
          if (!ts.isObjectLiteralExpression(entry)) continue;
          for (const p of entry.properties) {
            if (!ts.isPropertyAssignment(p)) continue;
            const k = nameOf(p);
            if (k === 'class' || k === 'className') harvest(p.initializer);
          }
        }
      }
      // `defaultVariants` names variants, not classes — deliberately skipped.
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name === 'cva') {
        visitCva(node);
        node.forEachChild(visit);
        return;
      }
      if (CLASS_HELPERS.has(name)) {
        node.arguments.forEach(harvest);
        node.forEachChild(visit);
        return;
      }
    }

    if (ts.isJsxAttribute(node) && node.name.getText(sf) === 'className' && node.initializer) {
      const init = node.initializer;
      if (ts.isStringLiteral(init)) push(init.text);
      else if (ts.isJsxExpression(init) && init.expression) {
        // cn()/cva() inside re-enter `visit` and keep their own rules; a bare
        // string or template is taken as classes.
        if (ts.isCallExpression(init.expression)) visit(init.expression);
        else harvest(init.expression);
      }
      return;
    }

    node.forEachChild(visit);
  };

  visit(sf);
  return out;
}

/* ── 2. Resolution — ask the built stylesheet ──────────────────────────── */

/**
 * The class names a selector applies to, un-escaped back to how the source
 * spells them. Tailwind escapes `:` `[` `]` `/` `.` `&` and friends, so
 * `.data-\[side\=top\]\:h-auto` is the class `data-[side=top]:h-auto`, while
 * the trailing `:hover` of `.hover\:bg-muted:hover` is a real pseudo-class and
 * ends the name.
 */
export function classesInSelector(selector: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < selector.length) {
    if (selector[i] === '\\') {
      i += 2;
      continue;
    }
    if (selector[i] !== '.') {
      i += 1;
      continue;
    }
    i += 1;
    let name = '';
    while (i < selector.length) {
      const c = selector[i];
      if (c === '\\') {
        const hex = /^\\([0-9a-fA-F]{1,6})[ ]?/.exec(selector.slice(i));
        if (hex) {
          name += String.fromCodePoint(parseInt(hex[1], 16));
          i += hex[0].length;
          continue;
        }
        name += selector[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (/[\s>+~,()[\]:.#*|"'=^$]/.test(c)) break;
      name += c;
      i += 1;
    }
    if (name) out.push(name);
  }
  return out;
}

/**
 * The custom properties a value cannot survive without.
 *
 * `var(--a, fallback)` survives an undefined `--a`; a bare `var(--a)` does not
 * — an undefined name makes the property invalid at computed-value time and
 * the whole declaration is dropped. That is the sonner failure, in one line.
 */
export function requiredVars(value: string): string[] {
  const out: string[] = [];
  const re = /var\(\s*(--[A-Za-z0-9_-]+)\s*(,)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) if (!m[2]) out.push(m[1]);
  return out;
}

/**
 * `--tw-*` is Tailwind's own plumbing, defined and consumed by Tailwind. Some
 * of it is deliberately dangling: `shadow-md` writes `--tw-shadow-colored:
 * … var(--tw-shadow-color) …`, and `--tw-shadow-color` is only defined once a
 * `shadow-<colour>` utility is used. Nothing reads `--tw-shadow-colored` until
 * then, so it is not a broken declaration — it is an unused one.
 */
const isTailwindInternal = (prop: string): boolean => prop.startsWith('--tw-');

interface Stylesheet {
  /** class name → the declaration values whose validity depends on a var */
  valuesByClass: Map<string, string[]>;
  /** every custom property the stylesheet defines, and its value */
  customProps: Map<string, string>;
}

function readStylesheet(root: CssRoot): Stylesheet {
  const valuesByClass = new Map<string, string[]>();
  const customProps = new Map<string, string>();

  root.walkRules((rule) => {
    const classes = new Set(rule.selectors.flatMap(classesInSelector));
    const values: string[] = [];
    rule.walkDecls((decl) => {
      if (decl.prop.startsWith('--')) customProps.set(decl.prop, decl.value);
      if (!isTailwindInternal(decl.prop)) values.push(decl.value);
    });
    for (const cls of classes) {
      const bucket = valuesByClass.get(cls);
      if (bucket) bucket.push(...values);
      else valuesByClass.set(cls, [...values]);
    }
  });

  return { valuesByClass, customProps };
}

let globalsCache: string | undefined;

/**
 * Build the app's stylesheet with `files` as Tailwind's content, then report
 * every class those files spell that the stylesheet does not carry.
 *
 * Two ways to fail, both silent — no error, no warning, no failed build:
 *
 *   • `no-rule`       — the class produced no CSS at all. `bg-surface-gold`
 *                       was this before THE-61; `text-primary-foreground` is
 *                       this today.
 *   • `undefined-var` — a rule exists but names a custom property nothing
 *                       defines, so the declaration is invalid at
 *                       computed-value time and is dropped. This is the
 *                       transparent, borderless, square-cornered toast that
 *                       src/components/ui/sonner.tsx documents.
 */
export async function auditPrimitives(files: string[]): Promise<AuditResult> {
  const sources = files.map((file) => readFileSync(file, 'utf8'));

  const classesByFile = new Map<string, string[]>();
  files.forEach((file, i) => classesByFile.set(file, extractClassNames(file, sources[i])));

  globalsCache ??= readFileSync(GLOBALS_CSS, 'utf8');
  const built = await postcss([
    tailwindcss({ ...twConfig, content: sources.map((raw) => ({ raw, extension: 'tsx' })) }),
  ]).process(globalsCache, { from: GLOBALS_CSS });

  const sheet = readStylesheet(built.root as CssRoot);

  /** Follow `--a: var(--b)` so an indirection cannot hide an undefined name. */
  const firstUndefined = (values: string[]): string | undefined => {
    const queue = values.flatMap(requiredVars);
    const seen = new Set<string>();
    while (queue.length) {
      const name = queue.shift()!;
      if (seen.has(name) || isTailwindInternal(name)) continue;
      seen.add(name);
      const definition = sheet.customProps.get(name);
      if (definition === undefined) return name;
      queue.push(...requiredVars(definition));
    }
    return undefined;
  };

  const findings: Finding[] = [];
  const exempted: Finding[] = [];
  const record = (f: Finding): void => {
    (f.className in NOT_A_UTILITY ? exempted : findings).push(f);
  };

  for (const file of files) {
    for (const className of classesByFile.get(file) ?? []) {
      const values = sheet.valuesByClass.get(className);
      if (!values) {
        record({ file, className, reason: 'no-rule' });
        continue;
      }
      const property = firstUndefined(values);
      if (property) record({ file, className, reason: 'undefined-var', property });
    }
  }

  return { findings, exempted, classesByFile, generatedCount: sheet.valuesByClass.size };
}

/* ── 3. Reporting ──────────────────────────────────────────────────────── */

export const rel = (file: string): string => path.relative(REPO_ROOT, file).split(path.sep).join('/');

export const describeFinding = (f: Finding): string =>
  f.reason === 'no-rule' ? 'no rule generated' : `var(${f.property}) is not defined`;

/**
 * One line per unresolved class, grouped by file, file order then source
 * order. This rendering is Phase 2's specification — keep it readable.
 */
export function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return '';
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    const bucket = byFile.get(f.file);
    if (bucket) bucket.push(f);
    else byFile.set(f.file, [f]);
  }
  const width = Math.max(...findings.map((f) => f.className.length));
  const out: string[] = [];
  for (const [file, group] of byFile) {
    out.push(`${rel(file)}  —  ${group.length} unresolved`);
    for (const f of group) out.push(`  ${f.className.padEnd(width)}  ${describeFinding(f)}`);
    out.push('');
  }
  return `${out.join('\n').trimEnd()}\n`;
}
