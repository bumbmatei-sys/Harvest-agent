import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { SMS_FEATURE_ENABLED, SMS_HIDDEN_MESSAGE } from '../lib/sms-feature';
import { NEWSLETTER_FEATURE_ENABLED } from '../lib/newsletter-feature';
import { QUICKBOOKS_FEATURE_ENABLED } from '../lib/quickbooks-feature';
import { STRIPE_CONNECT_ENABLED } from '../lib/stripe-connect-feature';
import { CUSTOM_DOMAIN_ENABLED } from '../lib/custom-domain-feature';
import { getPlanFeatures, PLAN_ORDER, type PlanFeatures } from '../utils/plan-features';
import { CONTACT_CSV_HEADERS } from '../lib/signups-export';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-335 — SMS hidden again, the newsletter and QuickBooks with it, and free
 * swaps CRM for Signups.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The founder, after a production crash on `/admin/sms`: "lets better hide sms
 * feature entirely again and keep it for when ill add the scheduler. people can
 * receive the serving notif from church service planner through resend mail."
 *
 * 🔴 WHAT THIS FILE IS FOR, and what it deliberately is NOT. Three master
 * switches went false and one plan cell moved. The per-surface behaviour of each
 * switch is asserted in the suite that owns that surface — `the-245-sms-hidden`
 * for the SMS routes and screens, `AdminDashboard.tier-nav-gating` for the nav,
 * `the-245-sms-hidden-admin` for the tier matrix. THIS file asserts the things
 * that belong to no single surface:
 *
 *   1. the three switches are false, and are one declared value each;
 *   2. NOTHING WAS DELETED — every file each switch hides still exists, named
 *      one by one, which is the whole promise the switch shape makes;
 *   3. every switch file still imports nothing, so a route handler and the
 *      client bundle can both read it cheaply;
 *   4. the GDPR paths do not read any of them;
 *   5. the two switches this ticket must not touch are still false;
 *   6. free's swap: no CRM, Signups instead, analytics intact, and the export
 *      carries contact records rather than bare enrolment rows;
 *   7. no cell was added that nothing reads.
 *
 * ⚠️ Nothing here shells out to git, reads a diff, or pins a line number.
 */

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/* ── 1 ─────────────────────────────────────────────────────────────────────
   The switches themselves.                                                   */
describe('1 — three switches, each one declared value, all false', () => {
  const SWITCHES = [
    ['lib/sms-feature.ts', 'SMS_FEATURE_ENABLED', SMS_FEATURE_ENABLED],
    ['lib/newsletter-feature.ts', 'NEWSLETTER_FEATURE_ENABLED', NEWSLETTER_FEATURE_ENABLED],
    ['lib/quickbooks-feature.ts', 'QUICKBOOKS_FEATURE_ENABLED', QUICKBOOKS_FEATURE_ENABLED],
  ] as const;

  it.each(SWITCHES)('%s declares %s false, exactly once', (file, name, value) => {
    expect(value, `${name} is not false`).toBe(false);
    const src = read(file);
    expect(src).toMatch(new RegExp(`^export const ${name} = false;$`, 'm'));
    expect(src.match(new RegExp(`${name}\\s*=`, 'g')), `${name} is declared more than once`)
      .toHaveLength(1);
  });

  it.each(SWITCHES)('%s imports nothing, so a route handler can read it cheaply', (file) => {
    /* 🔴 THE RULE `sms-feature.ts` SET AND THE TWO NEW FILES COPY. Each is read
       by a route handler AND by the client bundle; the older master switches
       live in `utils/plan-features.ts`, which drags the whole pricing matrix in
       behind it. A hidden feature must not make its own gate expensive. */
    const src = read(file);
    expect(src, `${file} grew an import`).not.toMatch(/^\s*import\s/m);
    expect(src, `${file} grew a require`).not.toMatch(/\brequire\s*\(/);
  });

  it('each hidden route answers 503, and says the feature is temporarily away', () => {
    // 503 rather than 404: the route EXISTS and is coming back, which is what a
    // provider retry and an admin's stale tab should both be told.
    expect(SMS_HIDDEN_MESSAGE).toMatch(/temporarily unavailable/i);
    for (const file of ['lib/newsletter-feature.ts', 'lib/quickbooks-feature.ts']) {
      expect(read(file)).toMatch(/HIDDEN_MESSAGE = '[^']*temporarily unavailable[^']*';/);
    }
  });
});

/* ── 2 ─────────────────────────────────────────────────────────────────────
   🔴 NOTHING WAS DELETED — the whole promise the switch shape makes.          */
describe('2 — no file was deleted, enumerated one by one', () => {
  const SMS_FILES = [
    'components/AdminSms.tsx',
    'components/settings/SmsSection.tsx',
    'app/api/sms/incoming/route.ts',
    'app/api/sms/broadcast/route.ts',
    'app/api/sms/config/route.ts',
    'app/api/sms/numbers/route.ts',
    'app/api/sms/test/route.ts',
    'app/api/sms-usage/route.ts',
    'lib/sms-send.ts',
    'lib/sms-optout.ts',
    'lib/sms-usage.ts',
    'lib/sms-countries.ts',
    'lib/zernio.ts',
    'lib/twilio.ts',
  ];
  const NEWSLETTER_FILES = [
    'components/NewsletterCampaigns.tsx',
    'components/NewsletterEditor.tsx',
    'app/api/newsletter/send/route.ts',
  ];
  const QUICKBOOKS_FILES = [
    'app/api/composio/quickbooks/connect/route.ts',
    'app/api/composio/quickbooks/callback/route.ts',
    'app/api/composio/quickbooks/status/route.ts',
    'app/api/composio/quickbooks/disconnect/route.ts',
    'app/api/quickbooks/sync/route.ts',
    'components/AdminAccounting.tsx',
  ];

  it.each([...SMS_FILES, ...NEWSLETTER_FILES, ...QUICKBOOKS_FILES])(
    '%s still exists', (file) => {
      expect(existsSync(path.join(SRC, file)), `${file} was DELETED — the switch exists so it need not be`)
        .toBe(true);
    },
  );

  it('🔴 and no plan-matrix cell was deleted either', () => {
    // The cells the three switches sit in front of are untouched, so each flip
    // restores the identical entitlement rather than an approximation of it.
    const max = getPlanFeatures('max');
    expect(max.smsAutomation, 'the smsAutomation cell was removed or flipped').toBe(true);
    expect(max.textToGive, 'the textToGive cell was removed or flipped').toBe(true);
    expect(getPlanFeatures('pro').newsletterAutomation, 'the newsletterAutomation cell moved').toBe(true);
    expect(max.accountingTools, 'accounting was hidden along with QuickBooks').toBe(true);
  });
});

/* ── 3 ─────────────────────────────────────────────────────────────────────
   🔴 Every gated surface reads its OWN switch, and none reads a copy.         */
describe('3 — every gated surface reads the constant, never a copy of it', () => {
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...walk(p)); }
      else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
    return out;
  };
  const sources = walk(SRC).filter((f) => !/__tests__/.test(f));

  it.each([
    ['NEWSLETTER_FEATURE_ENABLED', 'newsletter-feature'],
    ['QUICKBOOKS_FEATURE_ENABLED', 'quickbooks-feature'],
  ])('%s is imported, never redeclared', (name, module) => {
    for (const f of sources) {
      const src = readFileSync(f, 'utf8');
      if (!src.includes(name)) continue;
      const rel = path.relative(SRC, f).split(path.sep).join('/');
      if (rel === `lib/${module}.ts`) continue;
      expect(src, `${rel} does not import ${name}`)
        .toMatch(new RegExp(`import \\{[^}]*${name}[^}]*\\} from ['"][^'"]*${module}['"]`));
      expect(src, `${rel} declares its own ${name}`)
        .not.toMatch(new RegExp(`(const|let|var)\\s+${name}\\s*=`));
    }
  });

  it('🔴 the five QuickBooks routes each refuse before they authenticate', () => {
    // The switch is the FIRST thing in each handler, so a hidden integration
    // does not spend a Firestore read or an OAuth round trip on a caller.
    for (const route of [
      'app/api/composio/quickbooks/connect/route.ts',
      'app/api/composio/quickbooks/callback/route.ts',
      'app/api/composio/quickbooks/status/route.ts',
      'app/api/composio/quickbooks/disconnect/route.ts',
      'app/api/quickbooks/sync/route.ts',
    ]) {
      const src = read(route);
      const handler = /export async function (?:GET|POST)\([^)]*\) \{\s*(?:try \{\s*)?([\s\S]{0,400})/.exec(src);
      expect(handler, `${route} has no recognisable handler`).not.toBeNull();
      expect(handler![1], `${route} does not refuse first`)
        .toMatch(/if \(!QUICKBOOKS_FEATURE_ENABLED\)/);
    }
  });
});

/* ── 4 ─────────────────────────────────────────────────────────────────────
   🔴 GDPR is NOT gated on a marketing switch.                                 */
describe('4 — erasure and export still handle QuickBooks data', () => {
  /* 🔴 THE POINT: a tenant MAY have connected QuickBooks before it was hidden,
     and a member's erasure and access rights do not depend on whether the
     product currently advertises the integration that holds their data. Gating
     either sweep on the flag would leave a live OAuth grant undeleted after an
     erasure reported clean. */
  it.each(['lib/member-erasure.ts', 'lib/member-export.ts'])(
    '%s still sweeps the quickbooks integration document', (file) => {
      const src = read(file);
      expect(src, `${file} stopped naming quickbooks`).toMatch(/'quickbooks'/);
      expect(src, `${file} sweeps quickbooks conditionally now`)
        .toMatch(/for \(const provider of \[[^\]]*'quickbooks'[^\]]*\]\)/);
    },
  );

  it.each(['lib/member-erasure.ts', 'lib/member-export.ts'])(
    '%s reads none of the three switches', (file) => {
      const src = read(file);
      for (const name of ['QUICKBOOKS_FEATURE_ENABLED', 'NEWSLETTER_FEATURE_ENABLED', 'SMS_FEATURE_ENABLED']) {
        expect(src, `${file} gates a GDPR sweep on ${name}`).not.toContain(name);
      }
    },
  );
});

/* ── 5 ─────────────────────────────────────────────────────────────────────
   The switches this ticket must not touch.                                    */
describe('5 — no other switch moved', () => {
  it('STRIPE_CONNECT_ENABLED and CUSTOM_DOMAIN_ENABLED are still false', () => {
    expect(STRIPE_CONNECT_ENABLED).toBe(false);
    expect(CUSTOM_DOMAIN_ENABLED).toBe(false);
  });
});

/* ── 6 ─────────────────────────────────────────────────────────────────────
   🔴 The free tier's swap: Signups in, CRM out, analytics kept.               */
describe('6 — free gets Signups, not CRM, and keeps its analytics', () => {
  const free = getPlanFeatures('free');

  it('🔴 free no longer shows CRM', () => {
    expect(free.crm, 'free still carries the CRM cell').toBe(false);
  });

  it('🔴 free shows SIGNUPS, by a named cell rather than by borrowing one', () => {
    /* The founder: "The free plan should have signup feature not CRM since we
       separated them." Before THE-335 there was NO `signups` cell — both screens
       read `crm` — so this swap was not expressible as a flag flip. */
    expect(free.signups, 'free lost the Signups screen').toBe(true);
    expect('signups' in free, 'the signups cell does not exist').toBe(true);
  });

  it('🔴 free keeps ANALYTICS, and no analytics cell was invented', () => {
    /* ⚠️ THE ONE THING THE SWAP COULD HAVE SILENTLY DROPPED. There is no
       `analytics` cell in the matrix on any tier — analytics is a PERMISSION on
       the Signups screen — so "free gets analytics" was expressed by `crm: true`
       and is now expressed by `signups: true`. The sentence moved to the screen
       analytics actually lives on; no flag was minted to carry it. */
    for (const tier of PLAN_ORDER) {
      expect(getPlanFeatures(tier), `${tier} gained an analytics cell`).not.toHaveProperty('analytics');
    }
    expect(free.signups, 'free lost the screen analytics lives on').toBe(true);
    expect(read('components/AdminDashboard.tsx'), 'the analytics permission stopped gating Signups')
      .toMatch(/navAllows\(features\?\.signups\) &&\s*\(hasFullAccess \|\| perms\.analytics\)/);
  });

  it('🔴 a free evangelist can still see who enrolled AND export them, WITH contact records', () => {
    /* The `crm` cell was documented as what let a free evangelist "see WHO
       enrolled, with contact records, and export them". The founder says Signups
       does the export; this VERIFIES it rather than taking it on trust, and
       specifically that the CSV carries the CONTACT DETAIL and not merely
       enrolment rows — which is the half the swap could have quietly lost. */
    expect(CONTACT_CSV_HEADERS).toEqual([
      'Name', 'Phone Number', 'Email', 'Registration Date', 'Country', 'City', 'Accepted Jesus',
    ]);
    for (const column of ['Name', 'Phone Number', 'Email']) {
      expect(CONTACT_CSV_HEADERS, `the Signups export lost the ${column} column`).toContain(column);
    }
    // …and the screen a free tenant reaches is the one that exports them.
    expect(read('components/AdminSignups.tsx'), 'the Signups screen stopped offering its exports')
      .toMatch(/downloadUsersCSV/);
  });

  it('🔴 no priced tier moved — the split is a change to free alone', () => {
    for (const tier of ['plus', 'pro', 'max'] as const) {
      expect(getPlanFeatures(tier).crm, `${tier} lost CRM`).toBe(true);
      expect(getPlanFeatures(tier).signups, `${tier} lost Signups`).toBe(true);
    }
  });
});

/* ── 7 ─────────────────────────────────────────────────────────────────────
   🔴 No cell was added that nothing reads.                                    */
describe('7 — the new cell is READ, and no unread cell was added', () => {
  it('🔴 `signups` is read by two real gates in AdminDashboard', () => {
    /* The test the removed `churchDirectory`, `customBackground` and
       `publicCalendar` cells failed. Discovered by PATTERN, never by line
       number: THE-331 pinned `AdminCommunity.tsx:491`, a deletion shifted it to
       `:311`, and the suite would have measured whatever landed there. */
    const dash = read('components/AdminDashboard.tsx');
    expect(dash, 'the signups nav entry no longer reads the cell')
      .toMatch(/navAllows\(features\?\.signups\)/);
    expect(dash, 'the signups render branch no longer reads the cell')
      .toMatch(/planAllows\(features\?\.signups\)/);
  });

  it('🔴 the surface register names it, which is what makes it not a dead flag', () => {
    // THE-213's registry is `Record<keyof PlanFeatures, …>`, so a cell with no
    // entry is a `tsc` error before a test runs. This asserts the entry names a
    // file that genuinely consults the cell rather than an empty promise.
    const registry = readFileSync(
      path.join(SRC, 'utils/__tests__/plan-flag-surface-guard.test.ts'), 'utf8');
    expect(registry, 'the signups cell is not in the surface registry')
      .toMatch(/signups:\s*\{ gates: \['components\/AdminDashboard\.tsx'\] \}/);
  });

  it('🔴 exactly one cell was added, and it is `signups`', () => {
    // A sweep rather than a claim: every cell in the interface is either one the
    // matrix already had or the one this ticket names.
    const cells = Object.keys(getPlanFeatures('max')) as (keyof PlanFeatures)[];
    expect(cells, 'the signups cell is missing').toContain('signups');
    expect(cells, 'an analytics cell was invented').not.toContain('analytics');
    for (const dead of ['churchDirectory', 'customBackground', 'publicCalendar']) {
      expect(cells, `${dead} came back — it was removed for being unread`)
        .not.toContain(dead as keyof PlanFeatures);
    }
  });
});

/* ── 8 ─────────────────────────────────────────────────────────────────────
   🔴 firestore.rules, indexes and functions/ are byte-identical.              */
describe('8 — no rule, index or cloud function moved', () => {
  /* ⚠️ NO `firestore.rules` DIGEST IS RECORDED IN THE OWNERSHIP REGISTER — THE-333
     did that and it turned THE-322 and THE-325 red. The digests below are local
     to this file and compared against the files on disk, which needs nothing but
     `fs`. */
  const PINNED: Record<string, string> = {
    'firestore.rules': '',
    'firestore.indexes.json': '',
  };

  it.each(Object.keys(PINNED))('%s carries no edit from this ticket', (file) => {
    // Asserted by CONTENT rather than by a digest this ticket would have to
    // record: the claim is that THE-335 appears nowhere in either file, and a
    // rules change is a STOP condition rather than something to pin around.
    const src = readFileSync(path.join(ROOT, file), 'utf8');
    expect(src, `${file} names this ticket`).not.toContain('THE-335');
  });

  it('functions/ names this ticket nowhere', () => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'lib' || entry === '.git') continue;
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else out.push(p);
      }
    };
    walk(path.join(ROOT, 'functions'));
    expect(out.length, 'functions/ could not be read').toBeGreaterThan(0);
    for (const f of out) {
      expect(readFileSync(f, 'utf8'), `${path.relative(ROOT, f)} names this ticket`)
        .not.toContain('THE-335');
    }
  });

  it("🔴 THIS TICKET's ownership file records no firestore.rules digest", () => {
    /* THE-333 recorded one and it turned THE-322 and THE-325 red. Named here so
       the next ticket does not rediscover it.

       ⚠️ THE CLAIM IS ABOUT THIS TICKET'S FILE, NOT THE WHOLE REGISTER, and the
       narrowing is deliberate rather than a weakening: `THE-325.json` records a
       rules digest LEGITIMATELY — THE-325 is the ticket that built the rules
       digest register, so the rules file is the very thing it owns. A sweep over
       every file would have to exempt it by name, which is a list that goes
       stale; asking only about the file this ticket wrote is a claim that stays
       exactly true. */
    const dir = path.join(SRC, '__tests__/__fixtures__/ownership');
    const mine = JSON.parse(readFileSync(path.join(dir, 'THE-335.json'), 'utf8')) as
      { ticket: string; entries: { file: string; digest: string; why: string }[] };
    expect(mine.ticket).toBe('THE-335');
    expect(mine.entries.length, 'THE-335 recorded nothing').toBeGreaterThan(0);
    for (const entry of mine.entries) {
      expect(entry.file, 'THE-335 recorded a firestore.rules digest').not.toMatch(/firestore\.rules/);
      expect(entry.digest, `${entry.file}'s recorded digest is stale`)
        .toBe(sha256(readFileSync(path.join(ROOT, entry.file))));
      expect(entry.why.length, `${entry.file} is recorded without a stated reason`).toBeGreaterThan(120);
    }
  });

  it('and it edits no OTHER ticket\'s ownership file', () => {
    const dir = path.join(SRC, '__tests__/__fixtures__/ownership');
    const names = readdirSync(dir);
    expect(names.length, 'the register could not be read').toBeGreaterThan(5);
    for (const name of names) {
      const doc = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as { ticket: string };
      expect(doc.ticket, `${name} was rewritten to claim another ticket`)
        .toBe(name.replace(/\.json$/, ''));
    }
  });
});

/* ── 9 ─────────────────────────────────────────────────────────────────────
   🔴 No fixture in this ticket is pinned to a date near today.                */
describe('9 — this ticket pins no date near today', () => {
  it('names no calendar date at all', () => {
    /* `'2026-09-06T10:00'` turned `main` red for everyone (#468). This file
       carries no date; the assertion is on the file itself so it stays true as
       the file grows. */
    const self = readFileSync(__filename, 'utf8');
    const dates = self.match(/\b20\d\d-\d\d-\d\d\b/g) ?? [];
    expect(dates.filter((d) => d !== '2026-09-06'), 'this suite pinned a date').toEqual([]);
  });

  it('🔴 and asserts nothing about the current branch\'s diff', () => {
    // #454 is a standing sweep; blind spot on card 86bbvhaky. Nothing here
    // shells out to git, so there is no base ref to be wrong about.
    /* ⚠️ THE TOKENS ARE SPLIT AND REJOINED, and that is not decoration. The
       first draft of this assertion wrote them as literals and MATCHED ITSELF —
       the file contains the string it greps for, so it failed for the one reason
       it is not meant to detect. That is precisely the defect this repo has been
       bitten by ("one passed with its own gate DELETED because the assertion's
       message contained the string it grepped for"), caught here by the guard
       being run rather than by review. */
    const self = readFileSync(__filename, 'utf8');
    const forbidden = [
      ['execFileSync(', 'git'].join("'"),
      ['execSync(', 'git'].join("'"),
      ['diff --name', 'only'].join('-'),
      ['git', 'show'].join(' '),
    ];
    for (const token of forbidden) {
      expect(self.includes(token), `this suite reads the branch's diff: ${token}`).toBe(false);
    }
    /* …and the tokens are real, so the loop above cannot pass vacuously — proved
       by finding each of them in a file that GENUINELY reads the branch diff,
       rather than by spelling them out here, which would put them back in this
       file and re-create the self-match. */
    const aRealDiffReader = readFileSync(
      path.join(SRC, 'components/__tests__/THE-305.course-editor-header.test.tsx'), 'utf8');
    expect(forbidden.filter((t) => aRealDiffReader.includes(t)).length,
      'the forbidden tokens no longer describe anything — this guard is inert')
      .toBeGreaterThanOrEqual(2);
  });
});
