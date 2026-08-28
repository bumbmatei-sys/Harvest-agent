import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { getPlanFeatures, PLAN_ORDER, type PlanFeatures } from '../plan-features';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-213 — THE GUARD. "How did four surfaces ship without reading their own
 * flag, and a fifth have no flag at all?"
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Because NOTHING CONNECTED A CELL TO A SURFACE. `PlanFeatures` is 31 cells and
 * the app is ~40 screens; the only thing that ever said which screen a cell
 * governs was a sentence in a doc comment. Adding a cell and never wiring it,
 * or building a screen and never gating it, are both silent — and both have now
 * happened: `newsFeed` did not exist until THE-205 because NewsTab was an
 * unconditional literal, and check-in, the CRM's giving columns and the
 * Profile's Partnership card each had a correct flag that nothing on the screen
 * consulted.
 *
 * 🔴 CAN THE FLAGS BE ENUMERATED AGAINST THEIR SURFACES AUTOMATICALLY? NO, and
 * that answer is the design constraint. A scan for `features.<cell>` misses
 * every real gate written as `getPlanFeatures(plan).sermonNotes`,
 * `ctx?.planFeatures?.taxReceipt`, `tenantFeatures(tenant).newsFeed`,
 * `hasFeature(plan, 'automatedBlog')` or `usePlanGate('community_chat')` — five
 * shapes, all live in this codebase today. Widening the pattern to any `.cell`
 * is worse: `map` matches `.map(`, `docs` matches a Firestore `.docs`, `blog`
 * matches a collection name. Measured on this tree, the wide scan reports 31
 * "readers" for `map` and 14 for `docs`, nearly all of them false. A guard
 * built on grep would be noise on day one and would be disabled by day three.
 *
 * SO THE REGISTRY BELOW IS DECLARED, AND THE TEST CHECKS THE DECLARATION.
 * Every cell must name either the surfaces that gate on it, or a written reason
 * why it gates nothing. Adding a cell fails this file until someone says which.
 *
 * 🔴 AND IT FAILS AT THE TYPE LEVEL FIRST. `Registry` is
 * `Record<keyof PlanFeatures, …>`, so a new cell with no entry is a `tsc`
 * error — "Property 'x' is missing … but required in type 'Registry'" — before
 * a single test runs. That is the strongest half of this guard and it costs one
 * type annotation. The runtime assertions below exist for what a type cannot
 * say: that the named file still exists, and still consults the cell.
 *
 * That is the whole mechanism, and it is deliberately the cheap half:
 *
 *   WHAT THIS BUYS — a cell with no gate cannot be added silently again
 *     (`newsFeed`'s original defect); a gate cannot be deleted without the file
 *     that held it failing here; the "flags that gate nothing" list is written
 *     down and reviewed rather than rediscovered by a founder using the product.
 *
 *   WHAT IT DOES NOT BUY — it cannot prove a gate is CORRECT, only that one
 *     exists. `AdminCheckin` would have passed this file on the day the founder
 *     reached a working check-in, because its client gate was real; the missing
 *     one was the server's. And it cannot find a surface that has no flag at
 *     all, because a surface nobody thought to gate is by definition not in a
 *     registry keyed on cells.
 *
 * 🔴 WHAT THE FULL GUARD WOULD TAKE, in the order it should be built:
 *
 *   1. A REACHABILITY TEST PER CELL, which is where the real value is: mount
 *      the surface on a tenant whose cell is false and assert it does not
 *      render AND opens no query. That is what the four suites this PR adds do
 *      by hand. Generalising it needs one thing this repo does not have — a
 *      declared MOUNT for each surface (component + the props/mocks it needs),
 *      because the screens differ wildly in what they require. Realistically:
 *      a `surfaces.ts` fixture registry of ~30 entries, written once, then a
 *      table-driven test over it. Perhaps 400 lines and a day, and it subsumes
 *      most of what this PR wrote by hand.
 *   2. SERVER REACHABILITY, the half that actually mattered here: for every
 *      route reachable without auth, assert it consults a plan before its first
 *      READ and before its first WRITE. Cheaper than (1) — the route list is
 *      mechanically enumerable from `src/app/api/**` — and it is what would
 *      have caught `/api/checkin/submit`.
 *   3. THE INVERSE DIRECTION, which no registry can give: every public route
 *      and every member/admin nav entry must map to a cell or be declared
 *      flagless with a reason. That is what would have caught the news feed
 *      BEFORE it had a flag, and it is the expensive one, because it means
 *      enumerating surfaces rather than cells.
 *
 * Until (1)–(3) exist, this file is the floor: it makes the gap VISIBLE and
 * makes widening it an edit somebody has to justify in review.
 */

const ROOT = path.resolve(__dirname, '../../..');
const src = (rel: string) => readFileSync(path.join(ROOT, 'src', rel), 'utf8');

type Registry = Record<keyof PlanFeatures, { gates: readonly string[] } | { flagless: string }>;

/**
 * Every `PlanFeatures` cell → the surface(s) that refuse it, or why it refuses
 * nothing. Paths are relative to `src/`.
 *
 * ⚠️ NOT AN EXHAUSTIVE READER LIST. A cell is read in many places that are not
 * gates — the published /api/plans catalogue, the plan-comparison table, an
 * upgrade screen's minimum-plan label. Those are DESCRIPTIONS of a tier. What
 * is named here is the place that says no.
 *
 * ⚠️ `app/api/stripe/**` IS DELIBERATELY ABSENT even though the donate route is
 * a real `fundraising` gate. This file reads every path it names, and that tree
 * is being edited concurrently by another change; naming it would make this
 * suite fail on someone else's in-flight work rather than on a real regression.
 * The gate is real and is covered by its own tests; see the PR body.
 */
const FLAG_SURFACES: Registry = {
  // ─── member app ───────────────────────────────────────────────────────────
  blog:          { gates: ['components/MainApp.tsx', 'components/AdminDashboard.tsx'] },
  newsFeed:      { gates: ['components/MainApp.tsx', 'app/post/[postId]/page.tsx', 'components/SavedItems.tsx'] },
  aiChat:        { gates: ['components/MainApp.tsx'] },
  map:           { gates: ['components/MainApp.tsx'] },
  communityGroups: { gates: ['components/MainApp.tsx', 'components/AdminDashboard.tsx'] },
  fundraising:   { gates: [
    'components/MainApp.tsx',                 // the Give tab AND the Give route
    'components/Profile.tsx',                 // the Partnership section
    'components/AdminCRM.tsx',                // every donor / giving element
    'components/AdminDashboard.tsx',          // the admin Fundraising screen
    'app/campaign/[campaignId]/page.tsx',     // the public donate page
  ] },

  // ─── admin screens ────────────────────────────────────────────────────────
  aiKnowledge:   { gates: ['components/AdminDashboard.tsx'] },
  newsletterAutomation: { gates: ['components/AdminDashboard.tsx', 'app/api/newsletter/send/route.ts'] },
  automatedNewsletter:  { gates: ['components/AdminDashboard.tsx', 'app/api/newsletter/generate/route.ts'] },
  smsAutomation: { gates: ['components/AdminDashboard.tsx'] },
  eventRegistration: { gates: ['components/AdminDashboard.tsx'] },
  docs:          { gates: ['components/AdminDashboard.tsx'] },
  crm:           { gates: ['components/AdminDashboard.tsx'] },
  accountingTools: { gates: ['components/AdminDashboard.tsx', 'components/AdminAccounting.tsx'] },
  taxReceipt:    { gates: ['components/AdminAccounting.tsx'] },
  givingStatements: { gates: ['components/AdminAccounting.tsx', 'components/AdminDashboard.tsx'] },
  customForms:   { gates: ['components/AdminDashboard.tsx'] },
  livestream:    { gates: ['components/AdminDashboard.tsx'] },
  sermonNotes:   { gates: ['components/AdminDocs.tsx'] },
  pledgeCampaigns: { gates: ['components/AdminFundraising.tsx'] },
  automatedBlog: { gates: ['app/api/blog/generate/route.ts', 'app/api/blog/auto-generate/route.ts'] },
  customDomain:  { gates: ['components/settings/DomainSection.tsx', 'app/api/domains/provision/route.ts'] },
  customBranding: { gates: ['components/AdminDashboard.tsx'] },
  aiAssistant:   { gates: ['components/settings/AiAssistantSection.tsx'] },

  // ─── check-in: THE-213's defect 1, client AND server ──────────────────────
  checkInSystem: { gates: [
    'components/AdminCheckin.tsx',
    'app/api/checkin/submit/route.ts',
    'app/api/checkin/get/route.ts',
    'app/checkin/[sessionId]/page.tsx',
  ] },

  // ─── caps ─────────────────────────────────────────────────────────────────
  maxChurches:   { gates: ['components/AdminChurches.tsx'] },
  maxContacts:   { gates: ['utils/contact-capacity.ts'] },
  maxCourses:    { gates: ['utils/course-adoption.ts', 'components/AdminDashboard.tsx'] },
  maxAdmins:     { gates: ['utils/admin-seats.ts', 'components/AnalyticsAndRoles.tsx'] },

  // ─── cells that gate nothing, ON PURPOSE ──────────────────────────────────
  textToGive: {
    flagless:
      'Read by nothing, deliberately — the matrix says so in as many words. ' +
      'Harvest supplies no SMS: whether a tenant can run Text-to-Give is decided ' +
      'by whether they connected their OWN Twilio credentials (src/lib/twilio.ts), ' +
      'never by plan, and a cell gating a capability the plan does not supply ' +
      'gates nothing. Kept rather than deleted because it documents a real ' +
      'shipped feature. ⚠️ FREE CARRIES IT FALSE, unlike the "true on every tier" ' +
      'the interface comment still claims, and it is the one cell this registry ' +
      'declares flagless while some tier has it off. That is covered INDIRECTLY ' +
      'and completely: the only surface is the Text-to-Give panel inside AdminSms, ' +
      'which sits behind `smsAutomation` — false on free for the same stated ' +
      'reason — so a free tenant cannot reach it. If Text-to-Give ever gets a ' +
      'surface of its own, this entry must become a gate list.',
  },
  pwaApp: {
    flagless:
      'True on every tier including free (THE-205, founder-confirmed), so there ' +
      'is no tenant to refuse. The installable shell is the same static bundle ' +
      'every tier already downloads; it renders whatever that tier’s OTHER cells ' +
      'allow and nothing more. If a tier ever carries it false, this entry must ' +
      'become a gate list — which is exactly the edit this file forces.',
  },
};

const CELLS = Object.keys(getPlanFeatures('free')) as (keyof PlanFeatures)[];

/**
 * Does `source` actually consult `cell`? Deliberately loose — the five gate
 * shapes live in this codebase (`features.x`, `ctx?.planFeatures?.x`,
 * `getPlanFeatures(p).x`, `tenantFeatures(t).x`, `hasFeature(p, 'x')`) and a
 * tight pattern would fail on the next one somebody invents. The claim being
 * checked is "this file still mentions this cell", which is weak on its own and
 * strong in combination with the file having to be NAMED here first.
 */
const consults = (source: string, cell: string) =>
  new RegExp(`[.'"\`]${cell}\\b`).test(source);

describe('THE GUARD — every plan flag is mapped to the surface that refuses it', () => {
  it('🔴 covers every cell in the matrix, with nothing extra', () => {
    // The load-bearing assertion. A new cell fails here until someone says
    // which screen it governs — which is the single thing that was missing when
    // the news feed shipped for years with no flag and four surfaces shipped
    // with a flag nothing read.
    expect(Object.keys(FLAG_SURFACES).sort()).toEqual([...CELLS].sort());
  });

  // `?? {}` so a cell missing from the registry reaches the NAMED assertion above
  // rather than crashing this `it.each` at collection time with a raw TypeError.
  it.each(CELLS.filter((c) => 'gates' in (FLAG_SURFACES[c] ?? {})))(
    '%s — every named gate site exists and still consults the cell',
    (cell) => {
      const entry = FLAG_SURFACES[cell] as { gates: readonly string[] };
      expect(entry.gates.length, `${cell} declares an empty gate list`).toBeGreaterThan(0);
      for (const rel of entry.gates) {
        expect(existsSync(path.join(ROOT, 'src', rel)), `${rel} does not exist`).toBe(true);
        expect(consults(src(rel), cell), `${rel} no longer consults ${cell}`).toBe(true);
      }
    },
  );

  it('every flagless cell states WHY, at length', () => {
    // A one-word reason is how "gates nothing" becomes the default answer.
    for (const cell of CELLS) {
      const entry = FLAG_SURFACES[cell] ?? {};
      if (!('flagless' in entry)) continue;
      expect(entry.flagless.length, `${cell}'s reason is too short to be one`).toBeGreaterThan(120);
    }
  });

  it('🔴 names the flagless cells out loud, so the list cannot grow quietly', () => {
    // Two today. A third appearing is a decision somebody has to make in review
    // rather than a consequence of adding a cell and moving on.
    expect(CELLS.filter((c) => 'flagless' in (FLAG_SURFACES[c] ?? {}))).toEqual(['textToGive', 'pwaApp']);
  });

  it('🔴 every cell free carries as false has a gate, or is one of the two pinned exceptions', () => {
    // The sharpest form of the ticket's own question: free is the tier that
    // turns most cells off, so a false cell with no gate is a surface a free
    // tenant can reach. Derived from the matrix, so a later tier's false cell is
    // covered without editing this test.
    //
    // The exception is not a loophole — `flagless` entries are pinned by name in
    // the test above and must carry a written reason, so the only way to land
    // here without a gate is to add a cell to that two-item list in review.
    const free = getPlanFeatures('free');
    const ungated = CELLS.filter((cell) => {
      const off = free[cell] === false || free[cell] === 0;
      return off && !('gates' in (FLAG_SURFACES[cell] ?? {}));
    });
    expect(ungated, 'a cell free turns off can be reached by a free tenant').toEqual(['textToGive']);
  });
});

// ─── test 7 — the effective-features rule ────────────────────────────────────
describe('every gate this PR adds or touches reads effective features', () => {
  const ADDED_OR_TOUCHED = [
    'lib/tenant-features.ts',
    'app/api/checkin/get/route.ts',
    'app/api/checkin/submit/route.ts',
    'app/checkin/[sessionId]/page.tsx',
    'app/campaign/[campaignId]/page.tsx',
    'app/post/[postId]/page.tsx',
    'components/AdminCRM.tsx',
    'components/Profile.tsx',
    'components/SavedItems.tsx',
  ];

  it.each(ADDED_OR_TOUCHED)('%s resolves features through the add-on-aware path', (rel) => {
    const s = src(rel);
    // Either the shared server helper (which IS `getEffectiveFeatures` with the
    // tenant's add-ons layered on), or the context's `planFeatures` (likewise),
    // or `getEffectiveFeatures` directly for the no-context fallback.
    expect(
      /tenantFeatures(ById)?\(|getEffectiveFeatures\(|planFeatures/.test(s),
      `${rel} resolves a gate without going through effective features`,
    ).toBe(true);
  });

  it('none of them gates on the bare tier matrix', () => {
    for (const rel of ADDED_OR_TOUCHED) {
      expect(
        /getPlanFeatures\s*\(/.test(src(rel)),
        `${rel} still calls getPlanFeatures — that answers what a TIER publishes, not what a TENANT holds`,
      ).toBe(false);
    }
  });

  it('the shared helper layers add-ons on and fails an unknown plan closed', () => {
    const s = src('lib/tenant-features.ts');
    expect(s).toContain('getEffectiveFeatures(');
    expect(s).toContain('readTenantAddons(');
    expect(s).toContain('toTenantPlan(');
  });

  it('🔴 the gates that still read the BARE matrix are named, and the list may only shrink', () => {
    /* Honest inventory rather than a claim of completeness. They are listed so
       the debt is visible and so a NEW base-matrix gate has to be added to this
       array in review.

       🔴 THE OLD JUSTIFICATION FOR THIS LIST IS GONE. It used to read "these
       are behaviourally identical TODAY — no add-on lifts a boolean cell".
       THE-253 made that false: the AI Assistant add-on lifts `aiChat` and
       `aiKnowledge`, so any gate on this list reading either cell refuses a
       church that has paid for it. That is no longer visible debt; it is a live
       defect, and the two surfaces that read those cells came OFF the list
       rather than being documented on it:

         · `components/MainApp.tsx`        — gated the Chat tab on `aiChat`
         · `components/AdminDashboard.tsx` — gates the AI Knowledge Base screen
                                             on `aiKnowledge`

       ⚠️ THE ENTRIES THAT REMAIN read only cells no add-on lifts, so they are
       still behaviourally identical. Anything added here in future must be
       checked against the lifted cells, not just the capped ones. */
    const STILL_BARE = [
      'hooks/usePlanGate.ts',          // the seven FeatureKey gates
      'components/AdminDocs.tsx',      // sermonNotes
      'components/AdminChurches.tsx',  // maxChurches
    ];
    for (const rel of STILL_BARE) {
      expect(/getPlanFeatures\s*\(/.test(src(rel)), `${rel} no longer reads the bare matrix — remove it from this list`).toBe(true);
    }
  });
});

// ─── test 8 — no data, no rule ───────────────────────────────────────────────
describe('the gates refuse surfaces and change no data or rule', () => {
  const GATED = [
    'lib/tenant-features.ts',
    'app/api/checkin/get/route.ts',
    'app/api/checkin/submit/route.ts',
    'app/checkin/[sessionId]/page.tsx',
    'app/campaign/[campaignId]/page.tsx',
    'app/post/[postId]/page.tsx',
    'components/SavedItems.tsx',
    'components/Profile.tsx',
  ];

  it.each(GATED)('%s contains no delete or cleanup path', (rel) => {
    // The one thing a plan gate must never grow into. A downgrade that deleted
    // would make the upgrade unable to restore, and "gate the surface, not the
    // data" would stop being true the moment one of these appeared.
    expect(src(rel)).not.toMatch(/deleteDoc|recursiveDelete|\.delete\(|batch\.delete/);
  });

  it('the shared gate helper performs no write of any kind', () => {
    const s = src('lib/tenant-features.ts');
    expect(s).not.toMatch(/\.set\(|\.update\(|\.add\(|\.delete\(|FieldValue/);
  });

  it('🔴 no gate needed a firestore.rules change, because no rule keys off a plan', () => {
    // STOP condition 2, answered from the rules themselves rather than a diff.
    // Every collection this PR gates is scoped in rules by TENANT MEMBERSHIP and
    // PERMISSION, never by tier — which is why a plan gate lives in a route or a
    // component and rules were not touched. (firestore.rules auto-deploys to
    // production; a gate that needed one would have been a STOP, not an edit.)
    const rules = readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    for (const collection of ['checkinSessions', 'campaigns', 'community_posts', 'contacts']) {
      expect(rules.includes(`match /${collection}`), `${collection} lost its rules block`).toBe(true);
    }
    // Asserted on the `allow` STATEMENTS rather than the whole file: the prose
    // above a block may mention fundraising, and `hasPermission('manageFundraising')`
    // is a PERMISSION, which is a different axis from a plan. What must never
    // appear is a CONDITION that reads a tier or a matrix cell.
    const conditions = rules.split('\n').filter((l) => /^\s*allow /.test(l));
    expect(conditions.length, 'the rules file stopped containing allow statements').toBeGreaterThan(50);
    for (const line of conditions) {
      expect(line, 'a firestore rule now reads the tenant plan').not.toMatch(/\.plan\b|'(free|plus|pro|max)'/);
      expect(line, 'a firestore rule now reads a plan matrix cell')
        .not.toMatch(/checkInSystem|newsFeed|planFeatures|fundraising[^\w]/);
    }
  });

  it('the free tier still publishes exactly the cells it did — no flag was retuned', () => {
    // THE-213 is a gating ticket, not a matrix one. If a fix had been made by
    // flipping a cell instead of gating a screen, this is where it would show.
    const free = getPlanFeatures('free');
    expect(free.newsFeed).toBe(false);
    expect(free.checkInSystem).toBe(false);
    expect(free.fundraising).toBe(false);
    expect(free.crm).toBe(true);
  });

  it('and the three priced tiers still publish theirs', () => {
    for (const plan of PLAN_ORDER.filter((p) => p !== 'free')) {
      const f = getPlanFeatures(plan);
      expect(f.newsFeed, `${plan} lost the news feed`).toBe(true);
      expect(f.fundraising, `${plan} lost fundraising`).toBe(true);
      expect(f.crm, `${plan} lost the CRM`).toBe(true);
    }
    // Individual's check-in cell is false and stays false — the gates now
    // enforce it, which is the point, and is asserted per tier in the check-in
    // suites rather than papered over here.
    expect(getPlanFeatures('plus').checkInSystem).toBe(false);
    expect(getPlanFeatures('pro').checkInSystem).toBe(true);
    expect(getPlanFeatures('max').checkInSystem).toBe(true);
  });
});
