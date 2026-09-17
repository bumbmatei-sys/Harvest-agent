import { describe, it, expect } from 'vitest';
import { readFileSync, lstatSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { stripComments } from './__fixtures__/the-346-strip-comments';
import {
  PLAN_PRICING,
  PLAN_ORDER,
  NO_ADDONS,
  getPlanFeatures,
} from '../utils/plan-features';

/**
 * THE-371 — the three context documents, and the guard that keeps them honest.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS FILE IS FOR
 *
 * `AGENTS.md` is the canonical project context. `CLAUDE.md` points at it because
 * Claude Code looks for that filename. `README.md` is what a human sees first.
 * All three are prose, and prose is the one artefact in this repository that
 * nothing executable has ever held. That is exactly how the previous `AGENTS.md`
 * came to advertise three tiers at prices none of which existed, a Stripe
 * revenue-share that had been deleted, a newsletter that is switched off, and a
 * test count off by a factor of seven.
 *
 * 🔴 THE RULE THE DOCUMENTS ARE WRITTEN TO, AND THAT THIS FILE ENFORCES:
 * a figure a test already pins does not get restated in prose. The document
 * NAMES the source and stops. So most of what follows asserts an ABSENCE — that
 * the docs do not carry a price, a contact cap or an add-on price — rather than
 * asserting that a restated number is currently correct. A correct restatement
 * is still a restatement, and it is the thing that goes stale.
 *
 * ⚠️ WHAT IT DELIBERATELY DOES NOT CLAIM. Sections 4's phrase sweep is a
 * regex over English, and no regex reads English. It catches the shapes a
 * sentence actually takes when somebody writes "SMS is live", which is the
 * mutation this ticket was asked to prove; it cannot catch a paragraph that
 * implies availability without saying so. The STRUCTURAL half of section 4 —
 * every switch that is `false` in the tree must be named in the hidden-features
 * section — is the part that holds without reading comprehension, and it is why
 * the phrase sweep is not carrying this alone.
 *
 * ⚠️ NOTHING HERE READS A DIFF, SHELLS OUT TO GIT, OR PINS A DATE. See
 * `THE-315.branch-diff-guards.test.ts` for why the first of those expires the
 * moment this ticket merges.
 *
 * ⚠️ EVERY GREP OF TYPESCRIPT SOURCE BELOW RUNS OVER `stripComments`, IMPORTED
 * from `__fixtures__/the-346-strip-comments`. This repo's comments quote the
 * rules while explaining them — `plan-features.ts` spells "$200" inside a
 * docblock about why $200 must never be written down again — so a sweep that
 * reads raw source reads the explanation and calls it the code. The marketing
 * site failed a build on exactly that shape.
 */

const REPO_ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** The three documents this ticket owns. */
const AGENTS = 'AGENTS.md';
const CLAUDE = 'CLAUDE.md';
const README = 'README.md';
const DOCS = [AGENTS, CLAUDE, README] as const;

/** Every `## ` heading in a markdown file, normalised for comparison. */
const headings = (md: string): string[] =>
  [...md.matchAll(/^#{2,3}\s+(.+?)\s*$/gm)].map((m) => m[1].toLowerCase());

/**
 * Markdown has no TypeScript parser to strip, so the analogue of "read the code,
 * not the commentary" here is: a fenced block is an EXAMPLE, and the directory
 * tree in `AGENTS.md` is full of filenames. Section 3's money sweep deliberately
 * runs over the WHOLE document including fences — a stale price is a stale price
 * wherever it is written — while the prose sweeps in 4 and 5 drop fences, so a
 * filename cannot be mistaken for a claim.
 */
const withoutFences = (md: string): string => md.replace(/^```[\s\S]*?^```/gm, '');

/* ── 1 ──────────────────────────────────────────────────────────────────────
   CLAUDE.md exists and resolves to the canonical context.

   THE NAMED MECHANISM IS A POINTER FILE. Not a symlink and not a copy, and the
   assertions below are the difference:

     · a symlink is rejected by `lstat`, because Git on Windows materialises one
       as a plain text file holding the target path unless `core.symlinks` is on.
       A Windows checkout would hand an agent nine bytes as its whole context.
     · a copy is rejected by the heading comparison. Two files describing one
       project is the defect this repo has corrected six times on the site.      */
describe('1 — CLAUDE.md exists and resolves to the canonical context', () => {
  it('exists, is a real file, and is not a symlink', () => {
    const st = lstatSync(path.join(REPO_ROOT, CLAUDE));
    expect(st.isSymbolicLink(), 'CLAUDE.md is a symlink — it will not survive a Windows checkout')
      .toBe(false);
    expect(st.isFile(), 'CLAUDE.md is not a regular file').toBe(true);
  });

  it('names AGENTS.md, and AGENTS.md is really there and substantial', () => {
    expect(read(CLAUDE), 'CLAUDE.md does not point anywhere').toContain(AGENTS);
    expect(statSync(path.join(REPO_ROOT, AGENTS)).size,
      'AGENTS.md is too small to be the canonical context').toBeGreaterThan(5_000);
  });

  it('🔴 is a POINTER, not a second copy — it shares no section with AGENTS.md', () => {
    const shared = headings(read(CLAUDE)).filter((h) => headings(read(AGENTS)).includes(h));
    expect(shared, 'CLAUDE.md has started duplicating AGENTS.md sections').toEqual([]);
  });

  it('🔴 and it does not restate the rule AGENTS.md opens with', () => {
    // Assembled from fragments: a guard that greps for a phrase it spells finds
    // itself the moment anything reads this file as text.
    const needle = ['A default value that hides', 'an error is a bug'].join(' ');
    expect(read(AGENTS), 'the Silent-Failure Rule left AGENTS.md').toContain(needle);
    expect(read(CLAUDE), 'CLAUDE.md is copying AGENTS.md rather than pointing at it')
      .not.toContain(needle);
  });

  it('🔴 stays short enough to be a pointer', () => {
    const claudeLines = read(CLAUDE).split('\n').length;
    const agentsLines = read(AGENTS).split('\n').length;
    expect(claudeLines, 'CLAUDE.md has grown into a second context file')
      .toBeLessThan(agentsLines / 4);
  });
});

/* ── 2 ──────────────────────────────────────────────────────────────────────
   README.md is not empty. It was 0 bytes.                                     */
describe('2 — README.md is not empty', () => {
  it('has real content, not a placeholder', () => {
    expect(statSync(path.join(REPO_ROOT, README)).size,
      'README.md is empty again').toBeGreaterThan(500);
  });

  it('🔴 tells a human the three things a README has to tell them', () => {
    const md = read(README);
    expect(md, 'the README does not say what Harvest is').toMatch(/multi-tenant/i);
    expect(md, 'the README does not say how to run it').toMatch(/npm (ci|run dev|test)/);
    expect(md, 'the README does not say where the agent context lives').toContain(AGENTS);
  });
});

/* ── 3 ──────────────────────────────────────────────────────────────────────
   No factual claim in the docs contradicts a pinned value.

   🔴 THE FORM THIS TAKES IS "THE DOCS QUOTE NO PRICE AT ALL", and that is
   stronger than "the docs quote the right price". A correct price in prose is
   one repricing away from being a wrong one, and `PLAN_PRICING` is already
   contract-pinned against the marketing site — the site's build throws at
   prerender if the tables disagree. Prose cannot join that contract, so it must
   stay out of the argument entirely.

   Three independent arms, because a price is written three different ways:
     a. with a period attached      — "$49/mo"
     b. as a live PLAN_PRICING value — "$20"
     c. beside a tier or add-on name — "Individual is $49", "Admin Seat $10"     */
describe('3 — no factual claim in the docs contradicts a pinned test value', () => {
  /** Every `$1,234` token in a document, as { raw, value, line }. */
  const moneyTokens = (md: string) =>
    md.split('\n').flatMap((line, i) =>
      [...line.matchAll(/\$\s?([\d,]+(?:\.\d+)?)/g)].map((m) => ({
        raw: m[0],
        value: Number(m[1].replace(/,/g, '')),
        line,
        lineNo: i + 1,
      })),
    );

  const PERIOD = /^\s*(?:\/|\s+(?:a|per)\s+)(?:mo|month|monthly|yr|year|yearly|quarter|quarterly)\b/i;

  it.each(DOCS)('%s quotes no price with a billing period attached', (doc) => {
    const md = read(doc);
    const offenders = moneyTokens(md)
      .filter((t) => PERIOD.test(md.slice(md.indexOf(t.raw) + t.raw.length, md.indexOf(t.raw) + t.raw.length + 16)))
      .map((t) => `${doc}:${t.lineNo} ${t.raw}`);
    expect(offenders, 'a plan price was written into prose; point at PLAN_PRICING instead')
      .toEqual([]);
  });

  it('🔴 no document spells any of the nine live PLAN_PRICING figures as money', () => {
    const pinned = new Set(
      PLAN_ORDER.filter((p): p is keyof typeof PLAN_PRICING => p in PLAN_PRICING)
        .flatMap((p) => Object.values(PLAN_PRICING[p])),
    );
    // A non-empty needle set is what makes this assertion able to fail at all;
    // two guards in this repo were vacuous because the set they walked was empty.
    expect(pinned.size, 'PLAN_PRICING produced no figures to look for').toBeGreaterThan(0);

    const offenders = DOCS.flatMap((doc) =>
      moneyTokens(read(doc))
        .filter((t) => pinned.has(t.value))
        .map((t) => `${doc}:${t.lineNo} ${t.raw}`),
    );
    expect(offenders, 'a document restates a price PLAN_PRICING owns').toEqual([]);
  });

  it('🔴 no money figure sits on a line that names a tier or an add-on', () => {
    const NAMED = /\b(Forever Free|Individual|Small Team|Ministry|AI Assistant|Admin Seats?|Unlimited Contacts)\b/;
    const offenders = DOCS.flatMap((doc) =>
      moneyTokens(withoutFences(read(doc)))
        .filter((t) => NAMED.test(t.line))
        .map((t) => `${doc}:${t.lineNo} ${t.raw} — ${t.line.trim().slice(0, 70)}`),
    );
    expect(offenders, 'a document prices a tier or an add-on in prose').toEqual([]);
  });

  it('🔴 and the add-on price this repo refuses to carry is still not carried', () => {
    // `plan-features.ts` argues at length that the live add-on price must not be
    // copied into this repo. Read over STRIPPED source, because the argument
    // itself spells the retired $200 figure it is arguing about.
    const code = stripComments(read('src/utils/plan-features.ts'));
    expect(code.match(/\$\d/g) ?? [], 'a money literal reached plan-features.ts code')
      .toEqual([]);
  });
});

/* ── 4 ──────────────────────────────────────────────────────────────────────
   The docs name no feature that is behind a disabled flag as available.        */
describe('4 — the docs name no feature behind a disabled flag as available', () => {
  /**
   * Every `export const X_ENABLED = <bool>;` the tree declares, read off
   * STRIPPED source so a switch discussed in a docblock is not counted as one.
   */
  const declaredSwitches = (): Array<{ file: string; name: string; value: boolean }> => {
    const out: Array<{ file: string; name: string; value: boolean }> = [];
    const files = readdirSync(path.join(REPO_ROOT, 'src/lib'))
      .filter((f) => f.endsWith('-feature.ts'))
      .map((f) => `src/lib/${f}`)
      .concat('src/utils/plan-features.ts');
    for (const rel of files) {
      const code = stripComments(read(rel));
      for (const m of code.matchAll(/^export const (\w+_ENABLED) = (true|false);$/gm)) {
        out.push({ file: rel, name: m[1], value: m[2] === 'true' });
      }
    }
    return out;
  };

  it('🔴 every switch that is OFF in the tree is named in the docs', () => {
    const off = declaredSwitches().filter((s) => !s.value);
    expect(off.length, 'no disabled switch was found — the discovery is broken')
      .toBeGreaterThan(3);
    const agents = read(AGENTS);
    const missing = off.filter((s) => !agents.includes(s.name)).map((s) => `${s.name} (${s.file})`);
    expect(missing, 'a hidden feature is not documented as hidden').toEqual([]);
  });

  it('🔴 and every switch the docs name as OFF really is off', () => {
    const agents = read(AGENTS);
    const lying = declaredSwitches()
      .filter((s) => s.value && agents.includes(s.name) && !agents.includes(`${s.name}\` in`))
      .filter((s) => new RegExp(`${s.name}[^\\n]{0,80}\\bfalse\\b`).test(agents))
      .map((s) => s.name);
    expect(lying, 'the docs call a live switch disabled').toEqual([]);
  });

  /**
   * The phrase sweep. Its limits are stated in this file's header: it reads the
   * shapes an availability claim actually takes, not English.
   */
  const HIDDEN_FEATURE =
    '(SMS(?: automation)?|text-to-give|newsletters?|automated newsletter|custom domains?|Gmail(?: connection)?|QuickBooks|in-app card giving|card giving|Stripe Connect|affiliate programme|affiliate program|paid-event charging|Ask Harvest)';
  const AVAILABLE = '(live|available|enabled|supported|shipped|working|in production)';

  const CLAIMS: RegExp[] = [
    new RegExp(`\\b${HIDDEN_FEATURE}\\b[^.\\n]{0,40}\\b(?:is|are)\\s+${AVAILABLE}\\b`, 'i'),
    new RegExp(`\\b${AVAILABLE}\\b[^.\\n]{0,30}\\b${HIDDEN_FEATURE}\\b`, 'i'),
    new RegExp(`\\bHarvest\\s+(?:offers|supports|provides|sends|processes)\\b[^.\\n]{0,40}\\b${HIDDEN_FEATURE}\\b`, 'i'),
    new RegExp(`\\b${HIDDEN_FEATURE}\\b[^.\\n]{0,30}\\b(?:ships|works)\\s+(?:today|now)\\b`, 'i'),
  ];

  it.each(DOCS)('%s makes no availability claim about a hidden feature', (doc) => {
    const prose = withoutFences(read(doc));
    const hits = CLAIMS.flatMap((re) => {
      const m = prose.match(re);
      return m ? [`${doc}: ${m[0]}`] : [];
    });
    expect(hits, 'a hidden feature is described as available').toEqual([]);
  });

  it('🔴 the sweep can fail — the same shapes are caught in a planted sentence', () => {
    // Without this, a typo in the alternation would make every assertion above
    // pass forever. Built from fragments so the needle is not this file's text.
    const planted = ['SMS automation', 'is', 'live on Ministry.'].join(' ');
    expect(CLAIMS.some((re) => re.test(planted)),
      'the availability sweep no longer detects its own worked example').toBe(true);
  });

  it('🔴 Ask Harvest is an add-on: aiChat is false on every tier, including the top one', () => {
    const on = PLAN_ORDER.filter((p) => getPlanFeatures(p).aiChat);
    expect(on, 'a tier now includes AI chat — the docs say it is an add-on').toEqual([]);
  });
});

/* ── 5 ──────────────────────────────────────────────────────────────────────
   Contact caps and the add-on list: POINTED AT, not restated.                  */
describe('5 — the contact caps and add-on list point at plan-features.ts', () => {
  it('AGENTS.md names the source of truth rather than copying it', () => {
    const agents = read(AGENTS);
    for (const needle of ['plan-features.ts', 'PLAN_FEATURES', 'PLAN_PRICING']) {
      expect(agents, `AGENTS.md does not point at ${needle}`).toContain(needle);
    }
  });

  it('🔴 no document restates a contact cap', () => {
    const caps = new Set(PLAN_ORDER.map((p) => getPlanFeatures(p).maxContacts));
    expect(caps.size, 'no contact caps were read — the assertion would be vacuous')
      .toBeGreaterThan(1);

    const offenders: string[] = [];
    for (const doc of DOCS) {
      const prose = withoutFences(read(doc));
      for (const cap of caps) {
        if (cap <= 0) continue;
        // Both spellings a cap is written in, and only when the word "contact"
        // is within reach — a bare integer is not a claim about anything.
        const spellings = [String(cap), cap.toLocaleString('en-US')];
        for (const s of spellings) {
          const near = new RegExp(`(contacts?[^.\\n]{0,40}\\b${s}\\b|\\b${s}\\b[^.\\n]{0,40}contacts?)`, 'i');
          const m = prose.match(near);
          if (m) offenders.push(`${doc}: ${m[0]}`);
        }
      }
    }
    expect(offenders, 'a document restates a contact cap plan-features.ts owns').toEqual([]);
  });

  it('🔴 the add-on COUNT the docs state is the count the type declares', () => {
    const keys = Object.keys(NO_ADDONS).sort();
    expect(keys, 'the add-on set moved').toEqual(['adminSeats', 'aiAssistant', 'unlimitedContacts']);

    const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
    const stated = WORDS[keys.length];
    expect(stated, 'more add-ons than this guard can spell').toBeTruthy();
    expect(read(AGENTS), `AGENTS.md does not say there are exactly ${stated} add-ons`)
      .toMatch(new RegExp(`exactly ${stated} add-ons`, 'i'));
  });

  it('🔴 and the two retired add-ons are named as retired, not as purchasable', () => {
    const agents = read(AGENTS);
    for (const retired of ['contactPacks', 'campuses']) {
      expect(Object.keys(NO_ADDONS), `${retired} is back in TenantAddons`).not.toContain(retired);
    }
    // Whitespace-tolerant: the sentence wraps across a line in AGENTS.md, and a
    // guard that breaks on reflowing prose teaches people to delete the guard.
    expect(agents.replace(/\s+/g, ' '),
      'AGENTS.md does not record that the two add-ons were retired')
      .toMatch(/`contactPacks` and `campuses` were retired/);
  });
});

/* ── 6 ──────────────────────────────────────────────────────────────────────
   Every repository path the documents name really exists.

   🔴 THIS IS THE SECTION THAT CATCHES ORDINARY ROT. The rules above stop a
   document asserting a number; this one stops it pointing at a file that has
   been renamed out from under it. `AGENTS.md`'s whole design is "name the source
   and stop", which is only an improvement on restating the figure for as long as
   the name still resolves. A dangling pointer is a restated figure with extra
   steps.

   ⚠️ SCOPED TO THINGS THAT ARE ACTUALLY PATHS IN THIS TREE, by prefix. The docs
   also spell Firestore document paths (`tenants/{id}.config.givingLinks`), HTTP
   routes (`/api/storage/presign`) and git refs (`refs/pull/N/merge`) inside
   backticks, and none of those is a file. Matching by prefix rather than by
   "looks like a path" is what keeps this from failing on prose.                 */
describe('6 — every repository path the docs name exists', () => {
  const TREE_PREFIX = /^(?:src|functions|scripts|tests|docs|\.github)\//;
  const ROOT_FILES = new Set([
    'package.json', 'package-lock.json', 'next.config.mjs', 'tailwind.config.ts',
    'firestore.rules', 'firestore.indexes.json', 'storage.rules', 'firebase.json',
    '.gitattributes', '.env.example', 'AGENTS.md', 'CLAUDE.md', 'README.md',
  ]);

  /** Every backticked token in a document that names something in this tree. */
  const referencedPaths = (md: string): string[] =>
    [...md.matchAll(/`([^`\n]+)`/g)]
      .map((m) => m[1].trim())
      .filter((t) => TREE_PREFIX.test(t) || ROOT_FILES.has(t))
      // A trailing slash is how the docs write a directory; strip it to stat.
      .map((t) => t.replace(/\/$/, ''))
      // Drop globs and templates. `__fixtures__/ownership/THE-nnn.json` is the
      // shape a ticket is told to create, not a file that exists — and this
      // filter was written because the sweep found it, which is the guard
      // working rather than the guard being loosened.
      .filter((t) => !/[*{}<>]/.test(t) && !/\bnnn\b|THE-nnn/i.test(t));

  it.each(DOCS)('%s names only paths that resolve', (doc) => {
    const refs = [...new Set(referencedPaths(read(doc)))];
    const missing = refs.filter((rel) => {
      try {
        statSync(path.join(REPO_ROOT, rel));
        return false;
      } catch {
        return true;
      }
    });
    expect(missing, `${doc} points at a path that does not exist`).toEqual([]);
  });

  it('🔴 and AGENTS.md names enough of them for that check to mean something', () => {
    // Two guards in this repo were vacuous because an empty set made them
    // trivially true. If the extraction ever stops matching, this fails first.
    expect(referencedPaths(read(AGENTS)).length,
      'no repository paths were extracted from AGENTS.md — the sweep is vacuous')
      .toBeGreaterThan(20);
  });
});

/* ── 7 ──────────────────────────────────────────────────────────────────────
   The repo's own rules apply to its own documents.                             */
describe('7 — no emoji, LF line endings', () => {
  it.each(DOCS)('%s spells no emoji', (doc) => {
    const found = read(doc).match(/\p{Extended_Pictographic}/gu) ?? [];
    expect(found, `${doc} carries an emoji`).toEqual([]);
  });

  it.each(DOCS)('%s is LF, never CRLF', (doc) => {
    expect(read(doc).includes('\r'), `${doc} carries a carriage return`).toBe(false);
  });

  it.each(DOCS)('%s ends with exactly one trailing newline', (doc) => {
    const raw = read(doc);
    expect(raw.endsWith('\n'), `${doc} has no trailing newline`).toBe(true);
    expect(raw.endsWith('\n\n'), `${doc} ends with a blank line`).toBe(false);
  });
});
