import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * THE REMOVED CLAIMS MUST NOT COME BACK ANYWHERE IN `src/`.
 *
 * ⚠️ THIS IS A WIDENING OF AN EXISTING GUARD, AND THE WIDENING IS THE POINT.
 *
 * `src/lib/__tests__/member-faqs.test.ts` (#286) bans a set of false product
 * claims — but only within `MEMBER_FAQS`, its own data. That guard was written
 * on the assumption that the FAQ was the only place the claims lived. It was
 * not: `src/components/AboutUsModal.tsx` carried the same copy — "the
 * infrastructure for a Billion Soul Harvest", a "structured curriculum",
 * "theologically sound AI guidance" — and was untouched by #286 because it is
 * a different file. A guard scoped to one file cannot see a second copy.
 *
 * So this one is scoped to the DIRECTORY. Three of the banned phrases are
 * asserted absent from every file under `src/`, not from one module's data:
 *
 *   "Billion Soul"    — named a donor-funded free-access model that does not exist
 *   "Partner Portal"  — a church-enrolment portal that was never built
 *   "locally trained" — the assistant is retrieval over the tenant's own
 *                       uploads; nothing is trained or fine-tuned, locally or
 *                       otherwise
 *
 * The other three phrases member-faqs.test.ts bans ("free", "improve the
 * accuracy", and the pricing vocabulary) are deliberately NOT widened here.
 * "free" and pricing words are banned from MEMBER copy because a member has no
 * subscription — they are entirely correct on an admin's billing screen, and
 * banning them repo-wide would fail on the plan matrix itself. These three are
 * different: they are false about the product on ANY screen, so there is no
 * surface where they belong.
 */

const SRC = path.resolve(__dirname, '..');

interface BannedPhrase {
  /** Named in the failure message — a regression must say WHAT it reintroduced. */
  name: string;
  pattern: RegExp;
  /** Why it is banned, so a future reader can tell a rule from a preference. */
  because: string;
}

const BANNED: readonly BannedPhrase[] = [
  {
    name: '"Billion Soul"',
    pattern: /billion\s+soul/i,
    because: 'Named a funding model — donor partners underwriting free access — that does not exist.',
  },
  {
    name: '"Partner Portal"',
    pattern: /partner\s+portal/i,
    because: 'A church-enrolment portal that was never built. Ministries are onboarded by an admin, not through a public portal.',
  },
  {
    name: '"locally trained"',
    pattern: /locally\s+trained/i,
    because:
      "The assistant is retrieval over the tenant's own uploads — Gemini embeddings, MiMo completions. Nothing is trained or fine-tuned locally or otherwise.",
  },
];

/**
 * The only files allowed to contain the phrases, because naming them is their
 * entire job. Both are guards; neither ships to a user.
 *
 * ⚠️ This is a list of GUARDS, not a list of exceptions. Adding a component or
 * a copy file here defeats the test — if a claim needs to come back, the
 * decision belongs in a commit message, not in this array.
 */
const GUARD_FILES: readonly string[] = [
  'src/__tests__/removed-claims.test.ts', // this file — it quotes the phrases to ban them
  'src/lib/__tests__/member-faqs.test.ts', // #286's guard, plus the removed answers as fixtures
];

/** Extensions worth scanning. Anything a claim could be written in. */
const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.css', '.scss', '.md', '.mdx', '.html', '.txt', '.svg',
]);

/** Every scannable file under `src/`, as repo-relative POSIX paths. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (TEXT_EXT.has(path.extname(entry))) {
      out.push(path.relative(path.resolve(SRC, '..'), full).split(path.sep).join('/'));
    }
  }
  return out;
}

/**
 * Source with comments removed: block comments (which covers `{/* … *​/}` in
 * JSX) and whole-line `//` comments.
 *
 * Comments are exempt so that a file may explain WHY a claim was removed —
 * `src/lib/member-faqs.ts` opens with exactly that history, and it should not
 * have to be allowlisted (which would blanket-exempt its actual copy too) just
 * to keep the explanation.
 *
 * Deliberately NOT exempt: JSX text, string literals, object values — every
 * form a claim can reach a screen in. A trailing `//` comment is also left in
 * (stripping it would have to reason about `https://` inside strings), so a
 * phrase hidden in one still fails. That is the safe direction to be wrong in.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ');
}

/** Every banned phrase found in `text`, named. Empty array = clean. */
function scan(text: string): string[] {
  return BANNED.filter((r) => r.pattern.test(text)).map((r) => r.name);
}

const SCANNED = walk(SRC).filter((f) => !GUARD_FILES.includes(f));

describe('removed claims — banned from every file in src/', () => {
  it('actually scans a meaningful number of files', () => {
    // Guards the walker itself: a broken path or a too-narrow extension set
    // would make every assertion below pass vacuously.
    expect(SCANNED.length).toBeGreaterThan(200);
  });

  it('has no stale guard-file entries', () => {
    // A renamed guard would silently become a scanned file (fine) while
    // leaving a dead allowlist entry that hides the NEXT file of that name.
    for (const f of GUARD_FILES) {
      expect(existsSync(path.resolve(SRC, '..', f)), `allowlisted file does not exist: ${f}`).toBe(true);
    }
  });

  for (const rule of BANNED) {
    it(`no file in src/ contains ${rule.name} — ${rule.because}`, () => {
      const offenders = SCANNED.filter((f) =>
        rule.pattern.test(stripComments(readFileSync(path.resolve(SRC, '..', f), 'utf8'))),
      );
      expect(offenders, `${rule.name} appeared in: ${offenders.join(' | ')}`).toEqual([]);
    });
  }
});

/**
 * AboutUsModal was DELETED, not rewritten.
 *
 * It was never reachable: no file in the repo has ever imported it — not
 * Profile, not a route, not a lazy import (`git log -S AboutUsModal` finds only
 * the commit that added it). It shipped as dead code carrying live claims,
 * which is the worst combination — invisible to a reader auditing the app's
 * screens, and one import away from being visible to a member.
 */
describe('AboutUsModal is gone', () => {
  it('the component file no longer exists', () => {
    expect(existsSync(path.resolve(SRC, 'components/AboutUsModal.tsx'))).toBe(false);
  });

  it('nothing in src/ references it', () => {
    const offenders = SCANNED.filter((f) =>
      /AboutUsModal/.test(readFileSync(path.resolve(SRC, '..', f), 'utf8')),
    );
    expect(offenders, `AboutUsModal referenced in: ${offenders.join(' | ')}`).toEqual([]);
  });
});

/**
 * 🔴 THE MUTATION TEST.
 *
 * The guard above only earns its keep if it fires. This feeds it the real
 * paragraph that was deleted from AboutUsModal and asserts it is caught BY
 * NAME — so a future edit that narrows a pattern (say, to `/Billion Soul
 * Harvest/`) fails here instead of quietly letting the next copy through.
 */
describe('removed claims — the guard catches the copy it was built for', () => {
  const DELETED_ABOUT_US =
    'Our mission is to provide the infrastructure for a Billion Soul Harvest and beyond. ' +
    'Through structured curriculum, theologically sound AI guidance, and direct connection ' +
    'to local church bodies, we are ensuring that no one has to walk their new life alone.';

  it('flags the deleted About Us paragraph by name', () => {
    expect(scan(DELETED_ABOUT_US)).toContain('"Billion Soul"');
  });

  it('catches the phrases across a line break and odd spacing', () => {
    expect(scan('the Billion\n  Soul harvest')).toContain('"Billion Soul"');
    expect(scan('our church PARTNER   PORTAL')).toContain('"Partner Portal"');
    expect(scan('an AI that is Locally\tTrained')).toContain('"locally trained"');
  });

  it('catches a claim written as JSX text, not just as a string', () => {
    // The shape the deleted component actually used: prose between tags.
    expect(scan(stripComments('<p>infrastructure for a Billion Soul Harvest</p>'))).toContain(
      '"Billion Soul"',
    );
  });

  it('exempts a comment explaining the removal', () => {
    expect(scan(stripComments('// the old copy said "Billion Soul" — removed'))).toEqual([]);
    expect(scan(stripComments('/* a "Partner Portal" that never existed */'))).toEqual([]);
  });

  it('passes clean copy', () => {
    expect(scan('Harvest helps ministries disciple their members.')).toEqual([]);
  });
});
