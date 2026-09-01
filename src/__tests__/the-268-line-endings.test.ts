import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * THE-268 — `.gitattributes`, because a Windows clone breaks 187 tests.
 *
 * ⚠️ WHAT THIS FILE IS ACTUALLY GUARDING.
 * This repo pins dozens of files by `sha256(readFileSync(path, 'utf8'))`.
 * Those digests were recorded from LF content. Git's `core.autocrlf` defaults
 * to `true` on Windows, so a Windows clone lands CRLF in the WORKING TREE
 * while the committed blobs stay LF. Every line then differs by one byte and
 * every digest pin fails at once — measured at 187 failures on a clean
 * checkout, and reproduced here on Linux at 846 of 875 text files rewritten.
 *
 * ⚠️ THE FAILURE MODE THIS FILE EXISTS TO PREVENT.
 * The breakage is loud but deeply misleading: it presents as "the 13 shadcn
 * primitives have all drifted", which is a STOP condition in several tickets.
 * An agent that trusts it stops on a phantom; an agent that "fixes" it by
 * re-recording the digests commits CRLF-derived hashes and breaks Linux and
 * CI for everyone. If a digest fails, the line endings are wrong — not the
 * hash. Test 4 below is the standing no-regression check on exactly that.
 *
 * ⚠️ NO GIT AT ASSERTION TIME.
 * `git ls-files` in a test is the pattern this repo has been burned by twice,
 * so nothing here shells out. The file set is produced by walking the working
 * tree (`walkWorkingTree`) with an explicit skip list for the build outputs
 * `.gitignore` already excludes. That walk was validated against
 * `git ls-files` at development time: 888 files, zero drift, both ways.
 *
 * Walking the tree is not merely an acceptable substitute here — it is the
 * *more* correct check. The defect is a working-tree condition, and the
 * working tree is precisely what `readFileSync` hands the digest pins.
 */

const REPO_ROOT = path.resolve(__dirname, '../..');
const GITATTRIBUTES = path.join(REPO_ROOT, '.gitattributes');

const sha256 = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');

/* ── Working-tree enumeration, without git ────────────────────────────────── */

/** Build outputs and vendor trees `.gitignore` excludes; never tracked. */
const SKIP_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  '.next',
  'coverage',
  'build',
  'dist',
  'out',
  '.vercel',
  '.turbo',
]);

/** Ignored by path rather than by directory name. */
const SKIP_REL_DIRS = new Set(['functions/lib']);

/** Generated or secret files `.gitignore` excludes but which may sit on disk. */
const skipFile = (rel: string): boolean =>
  rel.endsWith('.tsbuildinfo') ||
  rel.endsWith('.log') ||
  rel.endsWith('.DS_Store') ||
  rel === 'service-account.json' ||
  (/(^|\/)\.env($|\.)/.test(rel) && rel !== '.env.example');

function walkWorkingTree(dir: string = REPO_ROOT, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(REPO_ROOT, abs).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name) || SKIP_REL_DIRS.has(rel)) continue;
      walkWorkingTree(abs, acc);
    } else if (entry.isFile()) {
      if (skipFile(rel)) continue;
      acc.push(rel);
    }
  }
  return acc;
}

const FILES: readonly string[] = walkWorkingTree().sort();
const bytesOf = (rel: string): Buffer => readFileSync(path.join(REPO_ROOT, rel));

/**
 * Git's own binary heuristic: a NUL anywhere in the first 8000 bytes.
 *
 * The window matters. `src/components/donations/__tests__/giving-providers.test.ts`
 * carries a deliberate NUL at offset 33334 — a control character fed to a
 * sanitiser under test — and git correctly reads it as text because the byte
 * falls outside the window. Matching git's rule exactly keeps this file on the
 * text side here too, so it stays inside the CR sweep rather than being
 * quietly excused from it.
 */
const looksBinaryToGit = (buf: Buffer): boolean => buf.subarray(0, 8000).includes(0);

/* ── .gitattributes parsing ───────────────────────────────────────────────── */

/**
 * Read tolerantly. If `.gitattributes` is missing entirely the interesting
 * assertion is "it exists", reported by name — not an ENOENT at import time
 * that takes the whole file down and reports nothing useful.
 */
const ATTRS_TEXT = existsSync(GITATTRIBUTES) ? readFileSync(GITATTRIBUTES, 'utf8') : '';

const ATTR_RULES: ReadonlyArray<{ pattern: string; attrs: string[] }> = ATTRS_TEXT.split('\n')
  .map((l) => l.trim())
  .filter((l) => l !== '' && !l.startsWith('#'))
  .map((l) => {
    const [pattern, ...attrs] = l.split(/\s+/);
    return { pattern, attrs };
  });

/** Extensions declared `binary`, read off .gitattributes rather than hardcoded. */
const BINARY_EXTENSIONS: readonly string[] = ATTR_RULES.filter(
  (r) => r.attrs.includes('binary') && /^\*\.[A-Za-z0-9]+$/.test(r.pattern),
).map((r) => r.pattern.slice(1).toLowerCase());

const isDeclaredBinary = (rel: string): boolean =>
  BINARY_EXTENSIONS.includes(path.extname(rel).toLowerCase());

/* ── 0. The sweep actually swept something ────────────────────────────────── */

/**
 * A suite that goes green because it looked at nothing proves nothing. These
 * anchors are the fixed points: if the walk ever silently collapses, this
 * fails before the interesting assertions get a chance to pass vacuously.
 */
describe('the working-tree sweep is real', () => {
  it('walks the whole repo, not a fragment of it', () => {
    expect(FILES.length).toBeGreaterThan(800);
  });

  it('includes the anchors the digest pins and this ticket care about', () => {
    for (const anchor of [
      '.gitattributes',
      'package-lock.json',
      'firestore.rules',
      'src/app/layout.tsx',
      'public/icons/icon-512x512.png',
      'scripts/q.mjs',
    ]) {
      expect(FILES).toContain(anchor);
    }
  });
});

/* ── 1. The rule exists and is the one that actually fixes this ───────────── */

describe('.gitattributes exists and normalises text files to LF', () => {
  it('is committed at the repo root', () => {
    expect(existsSync(GITATTRIBUTES), '.gitattributes is missing').toBe(true);
    expect(statSync(GITATTRIBUTES).isFile()).toBe(true);
  });

  it('normalises every text file with `* text=auto`', () => {
    const star = ATTR_RULES.find((r) => r.pattern === '*');
    expect(star, '.gitattributes has no `*` rule').toBeDefined();
    expect(star!.attrs).toContain('text=auto');
  });

  /**
   * `eol=lf` is the load-bearing half and is NOT stylistic. Plain `text=auto`
   * normalises the blob but leaves checkout to `core.eol`, whose default is
   * `native` — i.e. still CRLF on Windows, and the digest pins would still
   * fail. `eol=lf` forces LF in the working tree on every platform.
   */
  it('forces LF in the working tree on every platform with `eol=lf`', () => {
    const star = ATTR_RULES.find((r) => r.pattern === '*');
    expect(star, '.gitattributes has no `*` rule').toBeDefined();
    expect(star!.attrs).toContain('eol=lf');
  });
});

/* ── 2. The property itself, checked against bytes ────────────────────────── */

/**
 * ⚠️ This asserts CONTENT, not configuration. Reading `core.autocrlf` back, or
 * re-reading the `eol=lf` line asserted above, would pass on a CRLF checkout —
 * the config can be right while the bytes on disk are wrong, and it is the
 * bytes that `readFileSync` feeds to sha256. So: open every text file and look
 * for the byte.
 */
describe('no tracked text file contains a CR byte', () => {
  it('every text file in the working tree is pure LF', () => {
    const offenders = FILES.filter((rel) => {
      const buf = bytesOf(rel);
      if (isDeclaredBinary(rel) || looksBinaryToGit(buf)) return false;
      return buf.includes(0x0d);
    });
    expect(offenders, `CRLF found in:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('sweeps the overwhelming majority of the repo as text', () => {
    const text = FILES.filter((rel) => !isDeclaredBinary(rel));
    expect(text.length).toBeGreaterThan(800);
  });
});

/* ── 3. Binaries stay binary ──────────────────────────────────────────────── */

/**
 * `text=auto` would very probably classify these correctly on its own — all 13
 * carry a NUL at offset 8, well inside git's window. They are declared
 * `binary` explicitly anyway, because the heuristic only inspects the first
 * 8000 bytes and a corrupted binary is a far worse outcome than a failing
 * digest. This test pins that the declaration and reality agree in BOTH
 * directions: nothing binary is left to the heuristic, and nothing text is
 * wrongly excused from the CR sweep above.
 */
describe('binaries are not treated as text', () => {
  it('declares binary extensions in .gitattributes', () => {
    expect(BINARY_EXTENSIONS).toContain('.png');
  });

  it('every genuinely binary file is declared binary', () => {
    const undeclared = FILES.filter((rel) => looksBinaryToGit(bytesOf(rel)) && !isDeclaredBinary(rel));
    expect(undeclared, `binary but not declared:\n${undeclared.join('\n')}`).toEqual([]);
  });

  it('the binary set is exactly the 13 PNGs this repo tracks', () => {
    const binaries = FILES.filter((rel) => isDeclaredBinary(rel));
    expect(binaries).toEqual([
      'mockups/screenshot-canvas.png',
      'mockups/screenshot-integrations.png',
      'mockups/screenshot-newsletter.png',
      'mockups/screenshot-option-a.png',
      'mockups/screenshot-option-b.png',
      'mockups/screenshot-option-c.png',
      'public/icons/icon-144x144.png',
      'public/icons/icon-192x192.png',
      'public/icons/icon-384x384.png',
      'public/icons/icon-48x48.png',
      'public/icons/icon-512x512.png',
      'public/icons/icon-72x72.png',
      'public/icons/icon-96x96.png',
    ]);
  });

  it('every declared binary is still a structurally valid PNG', () => {
    const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (const rel of FILES.filter(isDeclaredBinary)) {
      const buf = bytesOf(rel);
      // The magic itself embeds a CRLF at bytes 4-5 precisely so that a
      // line-ending-mangling transfer corrupts it detectably. That is the
      // canary: if `eol=lf` ever leaked past `binary`, it dies here first.
      expect(buf.subarray(0, 8), `${rel} has a damaged PNG signature`).toEqual(PNG_MAGIC);
      expect(buf.subarray(buf.length - 8).toString('latin1')).toContain('IEND');
    }
  });
});

/* ── 4. The point of the ticket: nothing was re-recorded ──────────────────── */

/**
 * 🔴 No-regression, and the whole reason THE-268 exists. These digests are
 * read from the repo's own fixture and re-verified against file bytes. They
 * are NOT re-recorded here — a regenerated digest is the exact disaster this
 * ticket prevents. If this fails, fix the line endings, not the hash.
 */
describe('every existing digest pin still passes', () => {
  const DIGESTS: Record<string, string> = JSON.parse(
    readFileSync(
      path.join(REPO_ROOT, 'src/components/ui/__tests__/__fixtures__/primitive-digests.json'),
      'utf8',
    ),
  );

  it('pins a non-trivial number of files', () => {
    expect(Object.keys(DIGESTS).length).toBeGreaterThanOrEqual(17);
  });

  it('every pinned primitive still hashes to its recorded digest', () => {
    const actual = Object.fromEntries(
      Object.keys(DIGESTS).map((rel) => [
        rel,
        sha256(readFileSync(path.join(REPO_ROOT, rel), 'utf8')),
      ]),
    );
    expect(actual).toEqual(DIGESTS);
  });

  it('no pinned file carries a CR — the failure mode joined up', () => {
    for (const rel of Object.keys(DIGESTS)) {
      expect(bytesOf(rel).includes(0x0d), `${rel} contains CR`).toBe(false);
    }
  });
});

/* ── 5. scripts/ ──────────────────────────────────────────────────────────── */

/**
 * These are Node maintenance scripts (.mjs/.js) rather than shell scripts —
 * this repo tracks no `.sh` and no shebangs — but they are executed directly
 * and must stay LF regardless, which the blanket `* text=auto eol=lf` gives
 * them. Asserted separately so a future exception rule cannot quietly carve
 * them out.
 */
describe('scripts/ files are LF', () => {
  const SCRIPTS = FILES.filter((rel) => rel.startsWith('scripts/'));

  it('finds the scripts', () => {
    expect(SCRIPTS.length).toBeGreaterThanOrEqual(10);
  });

  it('every file under scripts/ is pure LF and non-empty', () => {
    for (const rel of SCRIPTS) {
      const buf = bytesOf(rel);
      expect(buf.length, `${rel} is empty`).toBeGreaterThan(0);
      expect(buf.includes(0x0d), `${rel} contains CR`).toBe(false);
    }
  });

  it('tracks no shell script or shebang that a CRLF checkout would break', () => {
    const shells = FILES.filter((rel) => rel.endsWith('.sh'));
    expect(shells).toEqual([]);
  });
});
