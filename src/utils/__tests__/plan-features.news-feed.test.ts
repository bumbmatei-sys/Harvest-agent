import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  getPlanFeatures,
  getMinPlanForFeatureCell,
  hasFeature,
  crmLabel,
  PLAN_ORDER,
  PRICED_PLAN_ORDER,
  type PlanFeatures,
} from '../plan-features';
import type { PricedPlan, TenantPlan } from '../../types/tenant.types';

/**
 * THE-205 — the matrix half of the news-feed gate, and the CRM label.
 *
 * MainApp.news-feed-gate.test.tsx asserts what a member SEES. This file asserts
 * the cell behind it, the tiers it must not have moved, and — the part a
 * rendered test cannot reach — that gating the feed changed no `/community_posts`
 * DATA and no Firestore RULE. A tenant that upgrades off free must get its feed
 * back with its history intact, so the gate is on the surface and nowhere else.
 */

const ROOT = path.resolve(__dirname, '../../..');
const readRoot = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

// ─── 1. the cell ─────────────────────────────────────────────────────────────
describe('newsFeed is false on free and true on every tier that pays', () => {
  it('answers per tier', () => {
    expect(getPlanFeatures('free').newsFeed).toBe(false);
    expect(getPlanFeatures('plus').newsFeed).toBe(true);
    expect(getPlanFeatures('pro').newsFeed).toBe(true);
    expect(getPlanFeatures('max').newsFeed).toBe(true);
  });

  it('unlocks at Individual, so an upgrade screen names the cheapest tier that has it', () => {
    // Derived, not written: `getMinPlanForFeatureCell` walks PLAN_ORDER. The
    // answer must be the cheapest PAID tier — naming Ministry here would sell
    // the $159 plan for something $39 carries, which is the #242 defect class.
    expect(getMinPlanForFeatureCell('newsFeed')).toBe('plus');
  });

  it('is monotonic up the ladder — no tier below the floor also has it', () => {
    const min = getMinPlanForFeatureCell('newsFeed')!;
    for (const cheaper of PLAN_ORDER.slice(0, PLAN_ORDER.indexOf(min))) {
      expect(hasFeature(cheaper, 'newsFeed'), `${cheaper} is below ${min} and still has the feed`).toBe(false);
    }
    for (const atOrAbove of PLAN_ORDER.slice(PLAN_ORDER.indexOf(min))) {
      expect(hasFeature(atOrAbove, 'newsFeed'), `${atOrAbove} is at or above ${min} and lost the feed`).toBe(true);
    }
  });

  it('🔴 is a DIFFERENT cell from communityGroups and from blog', () => {
    // The three products that share the word "community". If any two of these
    // rows were equal the gate would be indistinguishable from the flag it is
    // most often confused with — and PR 332 and THE-164 each had to correct a
    // version of that confusion, in opposite directions.
    const row = (k: keyof PlanFeatures) => PLAN_ORDER.map((p) => getPlanFeatures(p)[k]);
    expect(row('newsFeed')).toEqual([false, true, true, true]);
    expect(row('communityGroups')).toEqual([false, false, false, true]);
    expect(row('blog')).toEqual([false, true, true, true]);
    // newsFeed and blog agree per tier BY COINCIDENCE of where their floors sit,
    // not by construction — so they are pinned separately above rather than one
    // being derived from the other.
    expect(row('newsFeed')).not.toEqual(row('communityGroups'));
  });
});

// ─── 2. 🔴 the three priced tiers are untouched ──────────────────────────────
describe('THE-205 moved no cell on any tier a church pays for', () => {
  /**
   * Every priced tier's full row, transcribed from the matrix as it stood at
   * f3aeecb8 — the commit this work branched from — with `newsFeed: true` added
   * because at f3aeecb8 the feed had no cell AND no gate: every tier had it.
   * `true` is therefore the faithful transcription of that state, not a grant.
   *
   * Written out rather than read back from `getPlanFeatures`, which would
   * compare the subject with itself.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * ⚠️ AMENDED BY THE-253, AND ONLY ON THE THREE CELLS IT MOVED.
   *
   * What this block proved: THE-205 (free loses the news feed) moved NO cell on
   * any tier a church pays for. That is still what it proves — the snapshot is
   * the whole row, so any cell drifting for any reason fails here.
   *
   * THE-253 moved exactly three, and each is transcribed rather than relaxed:
   *   · `aiChat`      true → false on pro and max
   *   · `aiKnowledge` true → false on pro and max
   *   · `aiAssistant` REMOVED — the retired Telegram assistant's count
   *
   * 🔴 THE KEY-SET TEST BELOW IS WHY THE THIRD IS A DELETION, NOT A ZERO.
   * Writing `aiAssistant: 0` here would keep the snapshot compiling and quietly
   * stop asserting that the cell is gone. Removing the key makes
   * `Object.keys(...)` fail if it ever comes back.
   */
  const BEFORE: Record<PricedPlan, PlanFeatures> = {
    plus: {
      newsFeed: true, blog: true, aiChat: false, aiKnowledge: false, map: false,
      maxChurches: 1, maxContacts: 150, maxCourses: 2, maxAdmins: 2,
      customDomain: false, customBranding: false,
      newsletterAutomation: false, automatedNewsletter: false,
      // 🔴 THE-314 — SMS is Ministry-only. plus and pro LOST these two cells.
      smsAutomation: false, fundraising: true,
      eventRegistration: false, docs: false, crm: true,
      accountingTools: false, taxReceipt: false, communityGroups: false,
      customForms: false, checkInSystem: false, livestream: false,
      sermonNotes: false, automatedBlog: false, givingStatements: false,
      pledgeCampaigns: false, textToGive: false, pwaApp: true,
    },
    pro: {
      newsFeed: true, blog: true, aiChat: false, aiKnowledge: false, map: true,
      maxChurches: 1, maxContacts: 500, maxCourses: 5, maxAdmins: 5,
      customDomain: false, customBranding: false,
      newsletterAutomation: true, automatedNewsletter: false,
      // 🔴 THE-314 — SMS is Ministry-only. plus and pro LOST these two cells.
      smsAutomation: false, fundraising: true,
      eventRegistration: false, docs: true, crm: true,
      accountingTools: false, taxReceipt: false, communityGroups: false,
      customForms: false, checkInSystem: true, livestream: true,
      sermonNotes: true, automatedBlog: false, givingStatements: false,
      pledgeCampaigns: false, textToGive: false, pwaApp: true,
    },
    max: {
      newsFeed: true, blog: true, aiChat: false, aiKnowledge: false, map: true,
      maxChurches: 1, maxContacts: 2_000, maxCourses: 15, maxAdmins: 15,
      customDomain: true, customBranding: true,
      newsletterAutomation: true, automatedNewsletter: true,
      smsAutomation: true, fundraising: true,
      eventRegistration: true, docs: true, crm: true,
      accountingTools: true, taxReceipt: true, communityGroups: true,
      customForms: true, checkInSystem: true, livestream: true,
      sermonNotes: true, automatedBlog: true, givingStatements: true,
      pledgeCampaigns: true, textToGive: true, pwaApp: true,
    },
  };

  for (const plan of PRICED_PLAN_ORDER) {
    it(`${plan} is cell-for-cell what it was`, () => {
      expect(getPlanFeatures(plan)).toEqual(BEFORE[plan]);
    });
  }

  it('names every cell, so a new one cannot slip past the three rows above', () => {
    // `toEqual` on a Record already fails on an extra key, but this states the
    // guard directly: if a later ticket adds a cell without transcribing it,
    // that is the failure — not a silently half-checked row.
    for (const plan of PRICED_PLAN_ORDER) {
      expect(Object.keys(getPlanFeatures(plan)).sort()).toEqual(Object.keys(BEFORE[plan]).sort());
    }
  });

  it('🔴 free is the only tier this ticket changed', () => {
    // The free row's ONE difference from f3aeecb8 is `newsFeed`. Everything
    // else free carries is exactly what THE-200/THE-203 left.
    const free = getPlanFeatures('free');
    expect(free.newsFeed).toBe(false);
    expect(free.blog).toBe(false);
    expect(free.crm).toBe(true);
    expect(free.pwaApp).toBe(true);
    expect(free.fundraising).toBe(false);
    expect(free.communityGroups).toBe(false);
    expect(free.maxContacts).toBe(500);
    expect(free.maxCourses).toBe(1);
    expect(free.maxAdmins).toBe(1);
  });
});

// ─── 3. the CRM label, derived per tier ──────────────────────────────────────
describe('the CRM label names donors only where a donor can exist', () => {
  it('🔴 free names MEMBERS ONLY — it has no donate page, so it has no donors', () => {
    expect(crmLabel(getPlanFeatures('free'))).toBe('CRM (Members)');
    expect(crmLabel(getPlanFeatures('free'))).not.toContain('Donors');
  });

  it('🔴 every priced tier still says "CRM (Donors & Members)"', () => {
    for (const plan of PRICED_PLAN_ORDER) {
      expect(crmLabel(getPlanFeatures(plan)), `${plan}'s CRM label moved`).toBe('CRM (Donors & Members)');
    }
  });

  it('is derived from `fundraising`, not from a per-tier literal', () => {
    // The label follows the cell rather than a hand-written map, so a tier that
    // gains or loses the donate page cannot keep the wrong noun. Proven by
    // feeding it a synthetic feature set rather than a real tier.
    expect(crmLabel({ fundraising: true })).toBe('CRM (Donors & Members)');
    expect(crmLabel({ fundraising: false })).toBe('CRM (Members)');
    // And the two answers really do differ — a constant would pass both above.
    expect(crmLabel({ fundraising: true })).not.toBe(crmLabel({ fundraising: false }));
  });

  it('answers for every tier in the ladder, with no tier left undefined', () => {
    for (const plan of PLAN_ORDER as readonly TenantPlan[]) {
      expect(crmLabel(getPlanFeatures(plan))).toMatch(/^CRM \((?:Donors & )?Members\)$/);
    }
  });

  it('the app has exactly ONE definition of these two strings', () => {
    // The defect this avoids is a second copy of the feature vocabulary. The
    // literals live in `crmLabel` and nowhere else; the card table imports it.
    const card = readRoot('src/components/settings/PlanUpgradeSection.tsx');
    expect(card, 'PlanUpgradeSection re-writes the CRM label as a literal')
      .not.toMatch(/label: 'CRM \(/);
    expect(card).toContain('labelFor: crmLabel');
  });
});

// ─── 4. 🔴 the gate is on the SURFACE — no data and no rule moved ────────────
describe('no /community_posts data or rule changed', () => {
  const RULES = readRoot('firestore.rules');

  it('firestore.rules still carries the /community_posts block, verbatim', () => {
    // Transcribed rather than diffed: this repo's rules AUTO-DEPLOY TO
    // PRODUCTION, so "the gate must not need a rule change" is a hard
    // constraint, and the proof has to be readable in the test rather than
    // hidden behind a revision lookup.
    const block = RULES.slice(
      RULES.indexOf('match /community_posts/{postId} {'),
      RULES.indexOf('// ─── Prayer Requests'),
    );
    expect(block, 'the /community_posts rules block is gone').not.toBe('');

    for (const clause of [
      "allow read: if isAuthenticated() && belongsToTenant(resource.data.get('tenantId', ''));",
      'request.resource.data.authorId == request.auth.uid &&',
      "hasPermission('createPosts', resource.data.tenantId)",
      "request.resource.data.content.size() <= 280 &&",
      'allow update: if false;',
    ]) {
      expect(block, `a /community_posts rule clause changed: ${clause}`).toContain(clause);
    }
  });

  it('🔴 no rule anywhere in firestore.rules consults a plan', () => {
    // The STOP condition made concrete. If gating the feed had needed a rule,
    // the word would be here — and the change would auto-deploy.
    expect(RULES).not.toMatch(/\bnewsFeed\b/);
    expect(RULES).not.toMatch(/\bplan\s*==/);
  });

  it('keeps the community_posts composite index the feed queries need', () => {
    // Dropping the index would break the feed for the three tiers that keep it
    // — the same overshoot as dropping the data, one layer down.
    const idx = JSON.parse(readRoot('firestore.indexes.json')) as {
      indexes: { collectionGroup: string; fields: { fieldPath: string }[] }[];
    };
    const feed = idx.indexes.filter((i) => i.collectionGroup === 'community_posts');
    expect(feed, 'the community_posts index was removed').toHaveLength(1);
    expect(feed[0].fields.map((f) => f.fieldPath)).toEqual(['tenantId', 'createdAt']);
  });

  it('deletes no post: the erasure and tenant-delete paths still own that data', () => {
    // `/community_posts` is still swept by account erasure and tenant deletion,
    // and by nothing else. A gate that "cleaned up" a free tenant's feed would
    // show up as a new writer here.
    expect(readRoot('src/lib/member-erasure.ts')).toContain("collection: 'community_posts'");
    expect(readRoot('src/app/api/tenants/delete/route.ts')).toContain("{ name: 'community_posts', recursive: true }");
  });
});

// ─── 5. the server-side gate ─────────────────────────────────────────────────
describe('the public post permalink refuses a free tenant server-side', () => {
  const PAGE = readRoot('src/app/post/[postId]/page.tsx');

  it('🔴 checks the plan BEFORE reading the post document', () => {
    // A hidden nav item is not a gate (THE-193). This page is force-dynamic,
    // unauthenticated, indexable and reads through the Admin SDK, which
    // bypasses firestore.rules entirely — so the client gate cannot reach it.
    const gate = PAGE.indexOf('.newsFeed === false');
    const read = PAGE.indexOf("adminDb.collection('community_posts')");
    expect(gate, 'the permalink has no plan gate').toBeGreaterThan(-1);
    expect(read, 'the permalink stopped reading the post').toBeGreaterThan(-1);
    expect(gate, "the plan is checked AFTER the post is fetched — the feed is read anyway")
      .toBeLessThan(read);
  });

  it('derives the refusal from the matrix rather than naming the free tier', () => {
    // `plan === 'free'` would be a second copy of the matrix: a later tier
    // without a feed would silently keep the permalink.
    //
    // THE-213 moved the call from `getPlanFeatures(toTenantPlan(tenant.plan))`
    // — the TIER's published matrix — to `tenantFeatures(tenant)`, the shared
    // server helper that resolves the TENANT's effective set with its add-ons
    // layered on. Same derivation, same answer today (no add-on lifts a boolean
    // cell); what changed is that every server gate now asks the same question.
    expect(PAGE).toContain('tenantFeatures(tenant).newsFeed === false');
    expect(PAGE).toContain("import { tenantFeatures } from '@/lib/tenant-features'");
    expect(PAGE).not.toMatch(/plan\s*===\s*'free'/);
  });

  it('refuses by returning null, which both callers already turn into a 404', () => {
    // Not an explanatory error: the reader is an anonymous visitor and a
    // church's tier is not theirs to be told — the same reasoning the donate
    // route's refusal carries.
    expect(PAGE).toMatch(/\.newsFeed === false\) return null;/);
    expect(PAGE).toContain('notFound()');
    expect(PAGE).toContain("return { title: 'Post Not Found' }");
  });

  it('🔴 refuses the SURFACE only — it deletes nothing and writes nothing', () => {
    const verbs = PAGE.match(/\.(?:delete|set|update|add)\(/g) ?? [];
    expect(verbs, 'the permalink gained a write path').toEqual([]);
  });
});
