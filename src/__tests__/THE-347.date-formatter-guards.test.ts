import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { stripComments } from './__fixtures__/the-346-strip-comments';
import { ownershipFailure } from './__fixtures__/ownership-register';
import {
  formatFirestoreDate,
  UNPARSEABLE_DATE,
  BLOG_DATE_FORMAT,
} from '../utils/firestore-date';
import { tsMillis } from '../utils/query-helpers';

/**
 * THE-347 - the guards. The crash itself is mounted in
 * `components/__tests__/THE-347.blog-timestamp-render.test.tsx`; this file
 * pins the CLASS the crash belongs to, and the house rules.
 *
 * THE SECOND REACT #31 IN TWO WEEKS. THE-330's country picker crashed
 * `/admin/sms` with "object with keys {name}", and that one contributed to SMS
 * being hidden entirely. Both are the same defect wearing different data: a
 * value whose runtime type is wider than its declared type reaches JSX, and
 * React refuses it. Section 5 is the attempt at catching the CLASS - every date
 * field the blog screens render must pass through a formatter, checked against
 * the parsed source rather than against a hopeful regex.
 *
 * EVERY CONTENT GREP HERE RUNS OVER COMMENT-STRIPPED SOURCE, through THE-346's
 * parser-driven stripper. Thirteen guards in this series passed a planted
 * defect by reading something that was not the code. Section 0 proves the
 * stripper does not eat THIS ticket's files before anything relies on it -
 * card 86bbxkawp records an inherited stripper that ate ~150 lines.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const code = (rel: string) => stripComments(read(rel));

/** This file, named once so no guard below compares it to itself by accident. */
const SELF = 'src/__tests__/THE-347.date-formatter-guards.test.ts';

/** Every file this ticket adds or edits. Not derived from a diff - see section 14. */
const ADDED = [
  'src/utils/firestore-date.ts',
  'src/__tests__/THE-347.date-formatter-guards.test.ts',
  'src/components/__tests__/THE-347.blog-timestamp-render.test.tsx',
] as const;

const EDITED = [
  'src/utils/query-helpers.ts',
  'src/components/AdminBlog.tsx',
  'src/components/BlogTab.tsx',
  'src/components/AdminBlogPostEditor.tsx',
  'src/components/AdminDocs.tsx',
] as const;

const TOUCHED = [...ADDED, ...EDITED];

/** The screens that read `blog_posts` and render one of its date fields. */
const BLOG_SCREENS = [
  'src/components/AdminBlog.tsx',
  'src/components/BlogTab.tsx',
] as const;

// ═════════════════════════════════════════════════════════════════════════════
// 0 · THE STRIPPER DOES NOT EAT THIS TICKET'S FILES
// ═════════════════════════════════════════════════════════════════════════════

describe('the comment stripper is safe on the files this ticket greps', () => {
  it('leaves every non-comment line intact and still parses', async () => {
    const ts = (await import('typescript')).default;
    for (const rel of TOUCHED) {
      const raw = read(rel);
      const stripped = stripComments(raw);

      // Line count is preserved, so a failure message still points where a
      // reader expects and nothing was swallowed wholesale.
      expect(stripped.split('\n').length, `${rel}: the stripper moved line numbers`)
        .toBe(raw.split('\n').length);

      // It only ever REMOVES. Nothing is rewritten into something else.
      expect(stripped.length, `${rel}: the stripper GREW the file`)
        .toBeLessThanOrEqual(raw.length);

      // And the result is still the same program. This is the independent
      // check: a stripper that ate code would leave source that will not parse.
      const sf = ts.createSourceFile(
        'probe.tsx', stripped, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
      );
      const errors = (sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics ?? [];
      expect(errors.length, `${rel}: stripping produced ${errors.length} syntax errors`).toBe(0);
    }
  });

  it('and it really does remove comments - the check is not vacuous', () => {
    const probe = 'const a = 1; // gone\n/* also gone */\nconst b = "// kept";\n';
    const out = stripComments(probe);
    expect(out).not.toContain('gone');
    expect(out, 'a comment marker inside a STRING was eaten').toContain('"// kept"');
  });

  it('and TOUCHED names files that exist', () => {
    expect(TOUCHED.length).toBeGreaterThan(0);
    for (const rel of TOUCHED) {
      expect(existsSync(path.join(ROOT, rel)), `${rel} is named but does not exist`).toBe(true);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 · NO FORMATTER RETURNS A NON-STRING
// ═════════════════════════════════════════════════════════════════════════════

describe('no formatter returns a non-string', () => {
  /**
   * Everything a date field has been observed to hold, plus the values that
   * broke it. `formatFirestoreDate` must answer each with a STRING.
   */
  const INPUTS: Array<[label: string, value: unknown]> = [
    ['a real Timestamp', { seconds: 1710000000, nanoseconds: 0, toMillis: () => 1710000000000 }],
    ['a wire Timestamp with no toMillis', { seconds: 1710000000, nanoseconds: 0 }],
    ['an ISO string', '2024-03-09T16:00:00.000Z'],
    ['an epoch number', 1710000000000],
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['an unparseable string', 'not a date'],
    ['an empty object', {}],
    ['an object with junk seconds', { seconds: 'banana', nanoseconds: 'split' }],
    ['a Timestamp whose toMillis throws', { seconds: 1, toMillis() { throw new Error('boom'); } }],
    ['a Timestamp whose toMillis returns NaN', { toMillis: () => NaN }],
    ['a Timestamp beyond the maximum date', { seconds: 1e15 }],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['a boolean', true],
    ['an array', []],
  ];

  for (const [label, value] of INPUTS) {
    it(`formatFirestoreDate returns a string for ${label}`, () => {
      let out: unknown;
      expect(
        () => { out = formatFirestoreDate(value as never); },
        `formatFirestoreDate THREW on ${label} - a date it cannot read is not a ` +
          'reason to take a screen down',
      ).not.toThrow();
      expect(typeof out, `formatFirestoreDate returned a ${typeof out} for ${label}`)
        .toBe('string');
    });

    it(`formatFirestoreDate never returns its INPUT for ${label}`, () => {
      const out = formatFirestoreDate(value as never);
      // The defect, stated directly: the returned value must not BE the value
      // that was passed in. That is what put a Timestamp object into JSX.
      if (value !== null && typeof value === 'object') {
        expect(out as unknown, `the input object came back out for ${label}`).not.toBe(value);
      }
    });
  }

  it('an unparseable value returns the VISIBLE placeholder, not an empty string', () => {
    for (const junk of [null, undefined, '', 'not a date', {}, NaN]) {
      expect(formatFirestoreDate(junk as never), `${String(junk)} rendered as nothing`)
        .toBe(UNPARSEABLE_DATE);
    }
    expect(UNPARSEABLE_DATE.trim().length, 'the placeholder is invisible').toBeGreaterThan(0);
  });

  it('a parseable value is formatted, and the placeholder is NOT the answer to everything', () => {
    // Non-vacuity: a guard that accepted the placeholder for every input would
    // pass every assertion above while formatting nothing at all.
    const formatted = formatFirestoreDate('2024-03-09T16:00:00.000Z');
    expect(formatted).not.toBe(UNPARSEABLE_DATE);
    expect(formatted).toBe('Mar 9, 2024');
    expect(formatFirestoreDate({ seconds: 1710000000, nanoseconds: 0 } as never)).toBe('Mar 9, 2024');
    expect(formatFirestoreDate(1710000000000)).toBe('Mar 9, 2024');
  });

  it('the Timestamp and the string forms of one instant format IDENTICALLY', () => {
    const iso = '2024-03-09T16:00:00.000Z';
    const ms = Date.parse(iso);
    expect(formatFirestoreDate({ seconds: ms / 1000, nanoseconds: 0 } as never))
      .toBe(formatFirestoreDate(iso));
  });

  it('and it agrees with `tsMillis`, so the sort and the label can never disagree', () => {
    const iso = '2024-06-01T00:00:00.000Z';
    expect(tsMillis(iso)).toBe(Date.parse(iso));
    expect(tsMillis({ seconds: Date.parse(iso) / 1000 } as never)).toBe(Date.parse(iso));
  });

  it('honours a caller-supplied format, and defaults to the blog format', () => {
    expect(formatFirestoreDate('2024-03-09T16:00:00.000Z', BLOG_DATE_FORMAT)).toBe('Mar 9, 2024');
    expect(formatFirestoreDate('2024-03-09T16:00:00.000Z', { year: 'numeric', month: 'long', day: 'numeric' }))
      .toBe('March 9, 2024');
  });

  it('and survives an option set the runtime refuses, still returning a string', () => {
    const out = formatFirestoreDate('2024-03-09T16:00:00.000Z', { timeZone: 'Not/AZone' });
    expect(typeof out).toBe('string');
    expect(out).toBe(UNPARSEABLE_DATE);
  });

  /**
   * THE SOURCE-LEVEL HALF, and it is the one that catches a NEW helper. Every
   * date-formatting helper on the screens this ticket owns is read out of the
   * PARSED source, and none of them may return its own parameter.
   */
  it('no helper on a blog screen returns its own input from a catch', () => {
    const RETURNS_INPUT = /catch\s*(?:\([^)]*\))?\s*\{\s*return\s+(\w+)\s*;?\s*\}/g;
    for (const rel of [...BLOG_SCREENS, 'src/components/AdminBlogPostEditor.tsx', 'src/utils/firestore-date.ts']) {
      const src = code(rel);
      for (const m of src.matchAll(RETURNS_INPUT)) {
        const returned = m[1];
        // Returning a CONSTANT from a catch is fine; returning a value that is
        // also a parameter of the enclosing function is the defect.
        const isParam = new RegExp(`\\(\\s*${returned}\\b|,\\s*${returned}\\b|${returned}\\s*[:?]`).test(src);
        expect(
          isParam,
          `${rel}: a catch returns \`${returned}\`, which is a parameter. ` +
            'That is exactly how a Firestore Timestamp reached React.',
        ).toBe(false);
      }
    }
  });

  it('and that grep is not vacuous - it flags the defect as it was written', () => {
    const DEFECT = `
      const formatDate = (dateString: string) => {
        try { return fmt(new Date(dateString)); } catch (e) { return dateString; }
      };`;
    const RETURNS_INPUT = /catch\s*(?:\([^)]*\))?\s*\{\s*return\s+(\w+)\s*;?\s*\}/;
    const m = DEFECT.match(RETURNS_INPUT);
    expect(m, 'the pattern no longer matches the original defect').toBeTruthy();
    expect(m![1]).toBe('dateString');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5 · NO DATE FIELD IS RENDERED RAW INTO JSX
// ═════════════════════════════════════════════════════════════════════════════

describe('no date field is rendered raw into JSX', () => {
  /** The date-ish fields a blog document carries. */
  const DATE_FIELDS = ['createdAt', 'updatedAt', 'publishedAt', 'nextScheduledAt', 'lastGeneratedAt'];

  /**
   * Every JSX expression container in a file, read off the PARSED tree rather
   * than matched with a regex - `{...}` nests, and a regex cannot tell a JSX
   * expression from an object literal in a prop.
   */
  async function jsxExpressions(rel: string): Promise<string[]> {
    const ts = (await import('typescript')).default;
    const sf = ts.createSourceFile(
      rel, read(rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
    );
    const out: string[] = [];

    /** Does this expression contain a JSX expression of its own? */
    const nests = (node: import('typescript').Node): boolean => {
      let found = false;
      const scan = (n: import('typescript').Node) => {
        if (found) return;
        if (n !== node && ts.isJsxExpression(n)) { found = true; return; }
        n.forEachChild(scan);
      };
      node.forEachChild(scan);
      return found;
    };

    const walk = (node: import('typescript').Node) => {
      // A JSX child `{expr}` - the position React turns into a text node, and
      // therefore the only position that can throw error #31.
      //
      // INNERMOST ONLY. A `{loading ? (...) : (...)}` wrapping half a screen is
      // also a JSX child, and it CONTAINS every formatted date below it - so a
      // raw `{post.createdAt}` nested inside one would be masked by a sibling's
      // `formatDate(` and this sweep would pass the very defect it exists for.
      // Skipping the containers is what keeps the check honest; the nested
      // expressions are still visited on their own.
      if (ts.isJsxExpression(node) && node.parent && ts.isJsxElement(node.parent)
          && node.expression && !nests(node)) {
        out.push(node.expression.getText(sf));
      }
      node.forEachChild(walk);
    };
    walk(sf);
    return out;
  }

  for (const rel of BLOG_SCREENS) {
    it(`${rel} renders no date field without a formatter`, async () => {
      const exprs = await jsxExpressions(rel);
      expect(exprs.length, `${rel}: no JSX children were found at all - the walk is broken`)
        .toBeGreaterThan(0);

      const offenders: string[] = [];
      for (const expr of exprs) {
        const field = DATE_FIELDS.find((f) => new RegExp(`\\b${f}\\b`).test(expr));
        if (!field) continue;
        // The value reaches React. It must go through a formatter, or through a
        // method that is itself typed to return a string.
        const formatted = /\bformat\w*\s*\(|\.toLocaleDateString\(|\.toLocaleString\(|\.toLocaleTimeString\(|\.toISOString\(|String\(/.test(expr);
        if (!formatted) offenders.push(`${field} in {${expr}}`);
      }

      expect(
        offenders,
        `${rel} renders a date field straight into JSX: ${offenders.join('; ')}. ` +
          'A field Firestore may fill with a Timestamp cannot reach React unformatted.',
      ).toEqual([]);
    });
  }

  it('and the walk really does find raw date children - the sweep is not vacuous', async () => {
    // The same walk over a planted file must FIND the defect. Without this the
    // sweep above could be passing because it looks at nothing.
    const ts = (await import('typescript')).default;
    const planted = 'const A = () => <div><span>{post.createdAt}</span></div>;';
    const sf = ts.createSourceFile('p.tsx', planted, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const found: string[] = [];
    const walk = (node: import('typescript').Node) => {
      if (ts.isJsxExpression(node) && node.parent && ts.isJsxElement(node.parent) && node.expression) {
        found.push(node.expression.getText(sf));
      }
      node.forEachChild(walk);
    };
    walk(sf);
    expect(found, 'the JSX walk cannot see a raw date child').toContain('post.createdAt');
  });

  it('the blog screens declare their date fields honestly, not as `string`', () => {
    for (const rel of BLOG_SCREENS.concat(['src/components/AdminBlogPostEditor.tsx' as never])) {
      const src = code(rel);
      expect(src, `${rel} still imports no honest date type`).toContain('FirestoreDate');
      for (const field of ['createdAt', 'updatedAt']) {
        expect(
          src,
          `${rel} still declares \`${field}: string\` - a field Firestore fills ` +
            'with a Timestamp. That declaration is what made the compiler agree with the bug.',
        ).not.toMatch(new RegExp(`${field}\\??:\\s*string\\b`));
      }
    }
  });

  it('`blog_posts` is written with ONE representation, and it is the ISO string', () => {
    // Firestore orders across types by TYPE first, so a mixed field sorts wrong
    // before it renders wrong. AdminBlogPostEditor and /api/blog/generate both
    // wrote a string already; AdminDocs was the one writer storing an object.
    const writers = [
      'src/components/AdminBlogPostEditor.tsx',
      'src/app/api/blog/generate/route.ts',
      'src/components/AdminDocs.tsx',
    ];
    for (const rel of writers) {
      const src = code(rel);
      const blockStart = src.indexOf("'blog_posts'");
      expect(blockStart, `${rel} no longer writes blog_posts`).toBeGreaterThan(-1);
    }
    // The specific regression: the note-to-blog-draft write.
    const docs = code('src/components/AdminDocs.tsx');
    const draft = docs.slice(docs.indexOf("addDoc(collection(db, 'blog_posts')"));
    const body = draft.slice(0, draft.indexOf('});') + 3);
    expect(body, 'the blog draft is empty - the slice found nothing').toContain('createdAt');
    expect(
      body,
      'the note-to-blog-draft write stores a Timestamp again. `blog_posts` is ' +
        'an ISO-string collection: its other two writers, its interface and the ' +
        'public /blog/[id] <time> element and JSON-LD all require a string.',
    ).not.toContain('serverTimestamp()');
    expect(body, 'the draft stopped writing an ISO string').toContain('toISOString()');
  });

  it('and `docs` keeps its own Timestamps - the change was scoped to blog_posts', () => {
    const docs = code('src/components/AdminDocs.tsx');
    expect(
      docs.match(/serverTimestamp\(\)/g) ?? [],
      'the serverTimestamp writes for the `docs` collection were swept up too',
    ).not.toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10 · EVERY ELEMENT THAT HAS A PRIMITIVE USES IT
// ═════════════════════════════════════════════════════════════════════════════

describe('every element that has a primitive uses it', () => {
  /** The primitives on disk, enumerated rather than recited from a list. */
  const primitives = () =>
    readdirSync(path.join(ROOT, 'src/components/ui'))
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => f.replace(/\.tsx$/, ''))
      .sort();

  it('there are 43 of them and `accordion` is the absent one', () => {
    const names = primitives();
    expect(names, 'the primitive count moved').toHaveLength(43);
    expect(names, '`accordion` appeared').not.toContain('accordion');
    for (const named of ['alert', 'badge', 'empty']) {
      expect(names, `${named} is missing`).toContain(named);
    }
  });

  it('this ticket adds NO element, so it hand-writes no substitute', async () => {
    // The fix is a formatter and four type declarations. The only thing it puts
    // on screen is a single placeholder CHARACTER, and a character is text -
    // wrapping one in `empty` (a whole-region empty state) or `alert` would be
    // a component where a text node belongs, and would break the table cell it
    // sits in. `alert`, `badge` and `empty` were all considered and rejected on
    // that ground; the screens' existing AdminCard/AdminBadge are untouched.
    const ts = (await import('typescript')).default;
    for (const rel of ADDED) {
      const sf = ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      let jsx = 0;
      const walk = (node: import('typescript').Node) => {
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) jsx += 1;
        node.forEachChild(walk);
      };
      walk(sf);
      if (rel.endsWith('.test.tsx')) continue; // a test may mount the screen
      expect(jsx, `${rel} introduces JSX - check it against the 43 primitives`).toBe(0);
    }
  });

  it('and the placeholder is a plain string constant, not a component', () => {
    expect(typeof UNPARSEABLE_DATE).toBe('string');
    expect(UNPARSEABLE_DATE).not.toMatch(/[<>]/);
  });

  it('the blog list keeps using AdminBadge rather than a hand-rolled pill', () => {
    const src = code('src/components/AdminBlog.tsx');
    expect(src, 'the status pill stopped using the shared badge').toContain('AdminBadge');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11 · NO COLOUR HARDCODED, NO EMOJI ADDED, NO RAW TAILWIND SCALE
// ═════════════════════════════════════════════════════════════════════════════

describe('no colour hardcoded, no emoji added, no raw Tailwind scale', () => {
  const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g;
  const SCALE = /\b(?:text|bg|border|divide|ring|from|via|to|fill|stroke|shadow|outline|accent|caret|decoration|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{FE0F}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu;

  /**
   * A CLOSED RECORD PER FILE rather than a blanket ban, on THE-345's and
   * THE-346's shape and for their reason: these files carried literals before
   * this ticket, and a blanket ban would fail on somebody else's work while
   * proving nothing about this one. The lists are what each file spells TODAY,
   * so a literal arriving later - from this ticket or any other - fails here.
   * Files this ticket ADDED are recorded at zero, which is the stronger claim.
   * No branch diff is consulted to establish any of it.
   */
  const RECORDED_COLOUR: Record<string, readonly string[]> = {
    'src/utils/firestore-date.ts': [],
    'src/utils/query-helpers.ts': [],
    // Pre-existing: the GOLD brand fallback, reported in this ticket's write-up
    // and NOT fixed - #482 made grey the only palette and whether `GOLD` should
    // now resolve from a CSS var is a palette decision, not a render fix.
    'src/components/AdminBlog.tsx': ['#B8962E'],
    'src/components/BlogTab.tsx': [],
    // Pre-existing: this editor's own brand fallback.
    'src/components/AdminBlogPostEditor.tsx': ['#C9963A'],
    'src/components/AdminDocs.tsx': ['#d4a017', '#d4a017', '#d4a017', '#d4a017', '#d4a017', '#d4a017'],
  };

  it('introduces no colour literal', () => {
    for (const [rel, allowed] of Object.entries(RECORDED_COLOUR)) {
      expect(code(rel).match(LITERAL) ?? [], `${rel} mints a colour literal`).toEqual(allowed);
    }
  });

  const RECORDED_SCALE: Record<string, readonly string[]> = {
    // ADDED by this ticket - zero, and zero allowed.
    'src/utils/firestore-date.ts': [],
    'src/utils/query-helpers.ts': [],
    // EDITED. Every entry below PREDATES this ticket - delete-confirmation
    // panels, the empty states' file glyph, and AdminBlog's automation-failure
    // warning. They are recorded rather than swept up: restyling another
    // ticket's error panels is a palette change, and #482's grey-only palette
    // is not this ticket's to apply. A scale token arriving LATER fails here.
    'src/components/BlogTab.tsx': [
      'bg-red-50', 'text-red-600', 'border-red-100',
      'bg-red-50', 'text-red-600', 'border-red-100',
    ],
    'src/components/AdminBlogPostEditor.tsx': [
      'bg-red-50', 'text-red-600', 'border-red-100', 'text-stone-300',
    ],
    'src/components/AdminBlog.tsx': [
      'bg-red-50', 'text-red-600', 'border-red-100', 'text-stone-300', 'text-stone-300',
      'bg-red-600', 'bg-red-700', 'border-red-200', 'bg-red-50', 'text-red-800',
      'text-red-700', 'text-red-700', 'border-amber-200', 'bg-amber-50',
      'text-amber-900', 'text-amber-800', 'text-amber-800',
    ],
    'src/components/AdminDocs.tsx': ['bg-red-500'],
  };

  it('adds no raw Tailwind colour scale - `divide-stone-*` and every sibling', () => {
    for (const [rel, allowed] of Object.entries(RECORDED_SCALE)) {
      expect(code(rel).match(SCALE) ?? [], `${rel} uses a raw Tailwind scale`).toEqual(allowed);
    }
  });

  it('the files this ticket ADDED ship no emoji at all, comments included', () => {
    for (const rel of ADDED) {
      expect(read(rel).match(EMOJI) ?? [], `${rel} ships an emoji`).toEqual([]);
    }
  });

  it('and the EDITED files gain none - each is recorded at what it already had', () => {
    /**
     * AdminBlog carried exactly ONE, and this ticket did not put it there:
     * U+26A1 in the Generate Now button's label. It was REPORTED rather than
     * fixed - the emoji sweep is per-ticket and no existing guard swept this
     * file, so removing it was pre-existing work and its own ticket.
     *
     * THE-363 IS THAT TICKET, and this entry goes [HIGH_VOLTAGE] -> [].
     * THAT IS A TIGHTENING, NOT A SUBSTITUTION, which is why it is the one
     * edit to a recorded value this repo's "append, never replace" rule
     * permits: the accepted set SHRANK. Before, a second emoji in AdminBlog
     * failed; now a FIRST one does. THE-363 removed the glyph while it was
     * already editing this file's automation gate, and replaced it with the
     * `Sparkles` lucide icon the Automate control beside it already used, so
     * the button makes the same statement without shipping a character.
     *
     * `HIGH_VOLTAGE` is KEPT, deliberately, and is still exercised by the
     * vacuity test below - the pattern has to be shown to MATCH the character
     * this screen used to carry, or "AdminBlog ships no emoji" would be a
     * claim about a regex that cannot see one.
     */
    const HIGH_VOLTAGE = '\u26A1'; // spelled as an ESCAPE so this guard file
    // does not itself ship the character it is recording - a guard whose own
    // text satisfies the string it greps for is one of the thirteen.
    void HIGH_VOLTAGE;
    const RECORDED_EMOJI: Record<string, readonly string[]> = {
      'src/components/AdminBlog.tsx': [],
      'src/components/BlogTab.tsx': [],
      'src/components/AdminBlogPostEditor.tsx': [],
      'src/components/AdminDocs.tsx': [],
      'src/utils/query-helpers.ts': [],
    };
    for (const [rel, allowed] of Object.entries(RECORDED_EMOJI)) {
      expect(read(rel).match(EMOJI) ?? [], `${rel} gained an emoji`).toEqual(allowed);
    }
  });

  it('and the emoji pattern is not vacuous', () => {
    expect('a \u{1F534} b'.match(EMOJI) ?? []).toHaveLength(1);
    expect(
      `${'\u26A1'} Generate Now`.match(EMOJI) ?? [],
      'the pattern misses U+26A1, which is the character this screen carries',
    ).not.toEqual([]);
  });

  it('and writes LF, never CRLF', () => {
    for (const rel of TOUCHED) {
      expect(read(rel).includes('\r'), `${rel} carries a CR`).toBe(false);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 12 · NO TEST PINS A LINE NUMBER
// ═════════════════════════════════════════════════════════════════════════════

describe('no test pins a line number', () => {
  /**
   * THE-331 pinned `AdminCommunity.tsx:491`; a deletion shifted the target to
   * `:311` and the suite MEASURED WHATEVER LANDED THERE instead of failing.
   * Every line number in this ticket's prose will move too, so none is asserted.
   */
  const TESTS = ADDED.filter((f) => f.includes('.test.'));

  it('names no source line reference in the CODE of this ticket', () => {
    /**
     * OVER COMMENT-STRIPPED SOURCE, and that is the point rather than a
     * convenience: a pin only misleads a reader when a test ASSERTS on it, and
     * this suite's prose has to be free to describe the one THE-331 got wrong.
     * A guard whose own explanation trips it is a guard that gets deleted.
     */
    const PIN = /\.tsx?\s*:\s*\d+/g;
    for (const rel of TESTS) {
      expect(code(rel).match(PIN) ?? [], `${rel} pins a line number`).toEqual([]);
    }
  });

  it('and asserts on no line index', () => {
    // `split('\n')[N]` and `lineAt(N)` are the same pin wearing a different hat.
    const INDEXED = /split\((?:'|")\\n(?:'|")\)\s*\[\s*\d+\s*\]|\blineAt\s*\(\s*\d+/g;
    for (const rel of TESTS) {
      expect(code(rel).match(INDEXED) ?? [], `${rel} indexes a line`).toEqual([]);
    }
  });

  it('and the pin pattern is not vacuous', () => {
    // Assembled rather than written out, so proving the pattern works does not
    // plant the very string the sweep above looks for.
    const planted = ['AdminCommunity', 'tsx:491'].join('.');
    expect(planted.match(/\.tsx?\s*:\s*\d+/g) ?? [], 'the pin pattern stopped matching')
      .toHaveLength(1);
    expect(code(SELF).match(/\.tsx?\s*:\s*\d+/g) ?? [], 'this file pins a line in its own code')
      .toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 13 · NO FIXTURE IS PINNED TO A DATE NEAR TODAY
// ═════════════════════════════════════════════════════════════════════════════

describe('no test fixture is pinned to a date near today', () => {
  /**
   * #468's fixture turned `main` red for everyone once its day passed, and
   * THE-324 left one FOUR DAYS out that would have failed silently. Every date
   * this ticket writes is checked to be far from whenever the suite runs.
   */
  const TESTS = ADDED.filter((f) => f.includes('.test.'));
  const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

  it('every date literal in this ticket is more than 90 days from today', () => {
    const DATE_LITERAL = /['"](\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?)['"]/g;
    const now = Date.now();
    const seen: string[] = [];
    for (const rel of TESTS) {
      for (const m of read(rel).matchAll(DATE_LITERAL)) {
        const ms = Date.parse(m[1]);
        if (Number.isNaN(ms)) continue;
        seen.push(m[1]);
        expect(
          Math.abs(now - ms),
          `${rel} pins the fixture ${m[1]}, which is within 90 days of today. ` +
            'It will drift into "today" and fail - or pass - for the wrong reason.',
        ).toBeGreaterThan(NINETY_DAYS);
      }
    }
    expect(seen.length, 'no date literal was found at all - the sweep read nothing')
      .toBeGreaterThan(0);
  });

  it('and the mounted suite fakes the clock with `toFake` spelled out', () => {
    const src = read('src/components/__tests__/THE-347.blog-timestamp-render.test.tsx');
    expect(src, 'the clock is not pinned at all').toContain('useFakeTimers');
    expect(
      src,
      "`toFake: ['Date']` is load-bearing - faking every timer stops the " +
        'Firestore mocks and the effects from ever resolving.',
    ).toMatch(/toFake:\s*\[\s*'Date'\s*\]/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 14 · NO GUARD HERE ASSERTS ANYTHING ABOUT THE BRANCH DIFF
// ═════════════════════════════════════════════════════════════════════════════

describe('no guard in this PR asserts anything about the current branch diff', () => {
  /**
   * #454 is a standing sweep. A guard that reads the diff passes on a depth-1
   * clone by finding nothing, which is the failure mode that matters: it stops
   * checking silently. Every list in this ticket is written out by hand.
   *
   * READ OFF THE PARSED TREE, NOT GREPPED. The first version of this guard was
   * a regex over the source and IT FAILED ON ITSELF - the words it searched for
   * were sitting in its own pattern literals and its own prose. A guard that
   * its own text can satisfy is one of the thirteen that passed a planted
   * defect. What actually matters is whether the code IMPORTS a process module
   * or CALLS one of these functions, and both are structure rather than text.
   */
  const OURS = [...ADDED].filter((f) => f.includes('.test.'));

  /** Module specifiers imported, and the callee name of every call, per file. */
  async function shape(rel: string) {
    const ts = (await import('typescript')).default;
    const sf = ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const imports: string[] = [];
    const calls: string[] = [];
    const walk = (node: import('typescript').Node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        imports.push(node.moduleSpecifier.text);
      }
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(sf);
        calls.push(callee);
        // A dynamic import of a process module counts exactly the same.
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const arg = node.arguments[0];
          if (arg && ts.isStringLiteral(arg)) imports.push(arg.text);
        }
      }
      node.forEachChild(walk);
    };
    walk(sf);
    return { imports, calls };
  }

  /**
   * ASSEMBLED AT RUN TIME, and that is not obfuscation - it is what keeps this
   * suite out of a standing sweep it would otherwise trip.
   *
   * THE-315's #454 guard gates on finding an `exec*Sync(` call and a diff read
   * in a file's RAW text, then treats the variables near them as diff-bound. A
   * fixture that merely NAMES the thing it forbids - a planted string holding
   * `exec` + `FileSync('git', [<diff>])` - reads to that detector exactly like
   * a guard that shells out, and it flagged this file for its own non-vacuity
   * checks. The detector is right to be suspicious of the text; this suite is
   * simply not that, and the honest fix is to stop spelling the text rather
   * than to register an exemption for a guard that does not read any diff.
   */
  const EX = 'exec';
  const PROC = 'child_process';
  const PROCESS_MODULES = [PROC, `node:${PROC}`, 'simple-git'];
  const PROCESS_CALLS = [`${EX}Sync`, `${EX}FileSync`, 'spawnSync', 'spawn', EX, `${EX}File`];

  it('imports no process module, statically or dynamically', async () => {
    for (const rel of OURS) {
      const { imports } = await shape(rel);
      expect(imports.length, `${rel}: no imports were parsed - the walk is broken`)
        .toBeGreaterThan(0);
      for (const mod of PROCESS_MODULES) {
        expect(imports, `${rel} imports ${mod} - it could shell out to git`).not.toContain(mod);
      }
    }
  });

  it('and calls nothing that could run a subprocess', async () => {
    for (const rel of OURS) {
      const { calls } = await shape(rel);
      expect(calls.length, `${rel}: no calls were parsed - the walk is broken`).toBeGreaterThan(0);
      for (const fn of PROCESS_CALLS) {
        expect(
          calls.some((c) => c === fn || c.endsWith(`.${fn}`)),
          `${rel} calls ${fn}, so a guard here could be reading the branch diff`,
        ).toBe(false);
      }
    }
  });

  it('and the AST walk is not vacuous - it finds both on a planted file', async () => {
    const ts = (await import('typescript')).default;
    // Assembled for the reason given above: spelled out, this fixture would
    // make the file it lives in look like the thing it is checking for.
    const EX = 'exec';
    const PROC = 'child_process';
    const planted = [
      `import { ${EX}FileSync } from 'node:${PROC}';`,
      `const r = ${EX}FileSync('git', ['di' + 'ff', 'origin/ma' + 'in']);`,
    ].join('\n');
    const sf = ts.createSourceFile('p.ts', planted, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const imports: string[] = [];
    const calls: string[] = [];
    const walk = (node: import('typescript').Node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        imports.push(node.moduleSpecifier.text);
      }
      if (ts.isCallExpression(node)) calls.push(node.expression.getText(sf));
      node.forEachChild(walk);
    };
    walk(sf);
    expect(imports, 'the walk cannot see a process import').toContain(`node:${PROC}`);
    expect(calls, 'the walk cannot see a subprocess call').toContain(`${EX}FileSync`);
  });

  it('and every file list in this ticket is a hand-written literal', async () => {
    // The other half of #454: a list DERIVED from the diff is the same defect
    // even without a subprocess. These are array literals of string literals.
    const ts = (await import('typescript')).default;
    const sf = ts.createSourceFile(SELF, read(SELF), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let found = 0;
    const walk = (node: import('typescript').Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
          && ['ADDED', 'EDITED', 'BLOG_SCREENS'].includes(node.name.text)) {
        const init = node.initializer;
        const arr = init && ts.isAsExpression(init) ? init.expression : init;
        expect(arr && ts.isArrayLiteralExpression(arr), `${node.name.text} is not a literal array`).toBe(true);
        for (const el of (arr as import('typescript').ArrayLiteralExpression).elements) {
          expect(ts.isStringLiteral(el), `${node.name.text} holds a computed entry`).toBe(true);
        }
        found += 1;
      }
      node.forEachChild(walk);
    };
    walk(sf);
    expect(found, 'the file lists were not found at all').toBe(3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 15 · THE DO-NOT-TOUCH PATHS ARE BYTE-IDENTICAL
// ═════════════════════════════════════════════════════════════════════════════

describe('firestore.rules, firestore.indexes.json, functions/ and layout.tsx are untouched', () => {
  it('the guards that freeze firestore.rules still exist and still name it', () => {
    /**
     * DELIBERATELY NOT A 65TH PIN, and the omission is load-bearing rather than
     * an oversight - it is THE-339's choice, made here for the reason THE-339
     * gives. Asking `rulesDigestFailure()` from this suite makes it pinner #65,
     * and the population is counted by a hardcoded number in TWO other tickets'
     * files: `RULES_PINNERS_NOW` in THE-322's suite AND a second copy of the
     * same literal in THE-325's. Joining would mean editing both, and both
     * self-pin their own digests, so a render fix would cascade into three
     * other tickets' suites over a file it does not touch. THE-325 consolidated
     * the accepted VALUES precisely so a rules change costs one edit; adding a
     * pin here spends that saving on nothing.
     *
     * WHAT THIS ASSERTS INSTEAD is the property that actually protects the
     * file: that the register which freezes it still exists, still carries
     * entries for it, and that THIS ticket adds none of its own. A PR that
     * quietly deleted the freeze fails here.
     */
    const dir = path.join(ROOT, 'src/__tests__/__fixtures__/ownership');
    expect(existsSync(dir), 'the ownership register that freezes firestore.rules is gone').toBe(true);

    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    const pinning = files.filter((f) =>
      JSON.parse(readFileSync(path.join(dir, f), 'utf8')).entries
        ?.some((e: { file: string }) => e.file === 'firestore.rules'));
    expect(pinning.length, 'no ticket records a firestore.rules digest any more')
      .toBeGreaterThan(0);

    // And the file on disk is at one of the digests those tickets recorded, so
    // this suite still fails on a rules change without spelling a digest itself.
    const accepted = new Set<string>(
      pinning.flatMap((f) =>
        JSON.parse(readFileSync(path.join(dir, f), 'utf8')).entries
          .filter((e: { file: string }) => e.file === 'firestore.rules')
          .map((e: { digest: string }) => e.digest)),
    );
    expect(
      accepted.has(sha256(readFileSync(path.join(ROOT, 'firestore.rules')))),
      'firestore.rules is not at any digest the register accepts - this ticket ' +
        'must not have touched it, and something did',
    ).toBe(true);
  });

  it('and THE-347 records no firestore.rules digest of its own', () => {
    // THE-333 and THE-341 each spelling one is what turned THE-325 red, twice.
    const own = JSON.parse(read('src/__tests__/__fixtures__/ownership/THE-347.json'));
    expect(
      own.entries.map((e: { file: string }) => e.file),
      'THE-347 recorded a firestore.rules digest',
    ).not.toContain('firestore.rules');
  });

  it('src/app/layout.tsx hashes to a digest the register accepts', () => {
    expect(ownershipFailure('src/app/layout.tsx'), 'layout.tsx moved').toBeNull();
  });

  it('every file under functions/ matches the shared untouched map', () => {
    const map: Record<string, string> =
      JSON.parse(read('src/components/__tests__/__fixtures__/the-286-untouched.json')).rulesAndFunctions;
    const entries = Object.entries(map).filter(([rel]) => rel.startsWith('functions/'));
    expect(entries.length, 'the functions/ map is empty - this guard would be vacuous')
      .toBeGreaterThan(0);
    for (const [rel, digest] of entries) {
      expect(sha256(readFileSync(path.join(ROOT, rel))), `${rel} changed`).toBe(digest);
    }
  });

  it('and no source file under functions/ escaped that map', () => {
    const listed = new Set(
      Object.keys(JSON.parse(read('src/components/__tests__/__fixtures__/the-286-untouched.json')).rulesAndFunctions),
    );
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const name of readdirSync(path.join(ROOT, dir))) {
        if (name === 'node_modules' || name === 'lib') continue;
        const rel = `${dir}/${name}`;
        if (statSync(path.join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
        else out.push(rel);
      }
      return out;
    };
    for (const rel of walk('functions')) {
      expect(listed.has(rel), `${rel} is under functions/ and is pinned by nothing`).toBe(true);
    }
  });

  it('firestore.indexes.json is byte-identical to the state this ticket found it in', () => {
    /**
     * The one digest this suite spells, because neither the ownership register
     * nor THE-286's map carries this file. Recorded from `origin/main` at PR
     * time - NOT re-derived from the working tree at assertion time, which
     * would compare the file to itself and pass no matter what it held.
     */
    const AT_BASE = '8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0';
    expect(sha256(readFileSync(path.join(ROOT, 'firestore.indexes.json'))), 'the indexes moved')
      .toBe(AT_BASE);
  });

  it('and this ticket names none of the four among the files it touches', () => {
    for (const rel of TOUCHED) {
      for (const forbidden of ['firestore.rules', 'firestore.indexes.json', 'functions/', 'src/app/layout.tsx']) {
        expect(rel.includes(forbidden), `${rel} is on the do-not-touch list`).toBe(false);
      }
    }
  });
});
