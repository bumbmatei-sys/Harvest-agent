import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * THE-269 — the affiliate commission rate is 30%, not 15%.
 *
 * Founder decision, 2026-09-01. This changes ONE number and the prose that
 * quotes it. It does not enable the programme, does not touch a plan price, and
 * does not migrate a single stored commission.
 *
 * ─── Where the rate actually lives ───────────────────────────────────────────
 *
 * ONE multiplier, in ONE file: `AFFILIATE_RATE` in
 * `src/app/api/stripe/webhook/route.ts`, applied at exactly two call sites — the
 * initial commission (checkout) and the recurring commission (invoice paid).
 * `affiliate-payout.ts` and `affiliate-referrer.ts` carry NO rate: the payout
 * paths read the STORED `commission` field, which is what makes a legacy 20% row
 * still pay 20%.
 *
 * A second, non-multiplying occurrence lives in `AdminAffiliates.tsx`, where the
 * super-admin view flags rows whose effective rate is not today's standard. It
 * has to track this constant or every new 30% row would render as "off-rate".
 *
 * ─── The cross-repo half ─────────────────────────────────────────────────────
 *
 * The site (harvest-presentation-site) advertises this rate on its affiliate
 * surfaces. The two repos cannot share code, so they use the mechanism the nine
 * plan prices already use: EACH REPO CARRIES THE NUMBER AS ITS OWN LITERAL, and
 * each side pins what the other is expected to publish. A one-sided edit fails
 * here or there. `SITE_ADVERTISED_PERCENT` below is the app's transcription of
 * the site's `AFFILIATE_COMMISSION_RATE_PERCENT`
 * (harvest-presentation-site src/content/affiliate-rate.ts) — update the two
 * together, in the same change.
 *
 * ⚠️ NO `git show`, and no reaching into the other repo's filesystem: this suite
 * works on a shallow clone and a rebased branch, the rule
 * `the-256-stripe-connect-hidden.test.ts` already sets.
 */

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

/** The app's half of the rate. */
const WEBHOOK = read('app/api/stripe/webhook/route.ts');

/**
 * The site's half, transcribed. NOTHING READS THIS AT RUNTIME — it is one half
 * of a two-sided contract, exactly like `EXPECTED_PLAN_PRICES` on the site is
 * the app's PLAN_PRICING transcribed. See the header.
 */
const SITE_ADVERTISED_PERCENT = 30;

/* ═════════════════════════════════════════════════════════════════════════
   1 — the app-side rate is 30%.
   ═════════════════════════════════════════════════════════════════════════ */
describe('1 — the app-side rate is 30%', () => {
  it('AFFILIATE_RATE is 0.30, defined exactly once', () => {
    expect(WEBHOOK).toMatch(/^const AFFILIATE_RATE = 0\.30;$/m);
    // One definition. A second would be the per-plan ladder coming back.
    expect(WEBHOOK.match(/AFFILIATE_RATE\s*=/g)).toHaveLength(1);
  });

  it('is applied at both commission paths and nowhere else', () => {
    // Two multiplications: the initial commission and the recurring one. The
    // count is asserted so a third money path cannot appear unreviewed.
    const uses = WEBHOOK.match(/\*\s*AFFILIATE_RATE/g);
    expect(uses).toHaveLength(2);
    expect(WEBHOOK).toContain('Math.round((amountTotal || 0) * AFFILIATE_RATE)');
    expect(WEBHOOK).toContain("Math.round((invoice.amount_paid || 0) * AFFILIATE_RATE)");
  });

  it('computes 30% of a real charge, not 15%', () => {
    const rate = Number(WEBHOOK.match(/const AFFILIATE_RATE = ([\d.]+);/)![1]);
    expect(Math.round(11900 * rate)).toBe(3570);   // $119 → $35.70, was $17.85
    expect(Math.round(29900 * rate)).toBe(8970);   // $299 → $89.70, was $44.85
    expect(Math.round(34900 * rate)).toBe(10470);  // $349 → $104.70, was $52.35
  });

  it('the super-admin off-rate chip tracks the same standard', () => {
    // Not a multiplier — it decides which stored rows render as "off-rate".
    // Left at 0.15 it would flag every NEW row and clear every legacy one.
    expect(read('components/AdminAffiliates.tsx'))
      .toContain('a.commissionRates.some(r => r.rate !== 0.30)');
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   2 — no app surface claims 15%, and every affiliate surface claims 30%.
   ═════════════════════════════════════════════════════════════════════════ */
describe('2 — the affiliate surfaces claim 30%', () => {
  it.each([
    ['components/AffiliateSection.tsx', '>30% for {windowMonths} months<'],
    ['lib/affiliate-commission-window.ts',
     'an affiliate earns 30% of what each referred church pays'],
    ['app/api/stripe/webhook/route.ts',
     'Flat affiliate/referral commission rate — 30% for every plan'],
    ['components/ChurchOnboarding.tsx',
     'an affiliate commission is 30% of what'],
  ])('%s states the new rate', (file, claim) => {
    expect(read(file)).toContain(claim);
  });

  it('🔴 NO file in the repo still claims a 15% commission — repo-wide sweep', () => {
    // A hand-listed sweep is only as good as the list, and the first version of
    // this test had three files in it and missed four real claims (the Dodo
    // first-subscription route, plan-change.ts, plan-features.ts and a stale
    // cross-reference in webhook.test.ts). So this walks the whole tree.
    //
    // A bare "15%" grep is useless here — `color-mix(… 15%, transparent)`,
    // `at 85% 15%` and `rgba(…,0.15)` are everywhere. What is swept for is a
    // 15% that sits in a COMMISSION SENTENCE: the two within a few words of
    // each other.
    const COMMISSION_15 =
      /(commission|affiliate|refer(?:ral|red|s)?|earns?|pays? you)[^.\n]{0,80}\b15%|\b15%[^.\n]{0,80}(commission|of what|of subscription|of revenue|recurring)/i;

    // The allowed exceptions, each one justified in suite 5 below.
    const ALLOWED = new Set([
      // the retired per-plan ladder, named as history
      'app/api/stripe/webhook/route.ts',
      // Stripe's real stored history: rows genuinely banked at 15%
      'app/api/admin/affiliates/__tests__/route.test.ts',
      // this file, which quotes the old rate to describe the change
      'lib/__tests__/the-269-affiliate-rate.test.ts',
    ]);

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(abs); continue; }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        const rel = path.relative(SRC, abs);
        if (ALLOWED.has(rel)) continue;
        for (const line of readFileSync(abs, 'utf8').split('\n')) {
          if (COMMISSION_15.test(line)) offenders.push(`${rel}: ${line.trim().slice(0, 100)}`);
        }
      }
    };
    walk(SRC);
    expect(offenders, `these still claim a 15% commission:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the webhook prose carries no live 15% claim', () => {
    // The one surviving "15%" in this file is the RETIRED per-plan ladder
    // (ultra 20% / max 15% / …), named as history in the same sentence that
    // says it was replaced. That is the only one allowed.
    const fifteens = WEBHOOK.match(/\b15%/g) ?? [];
    expect(fifteens).toHaveLength(1);
    expect(WEBHOOK).toContain('Intentionally replaces the old per-plan ladder (ultra 20% / max 15%');
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   3 — the site and the app agree on the rate.
   ═════════════════════════════════════════════════════════════════════════ */
describe('3 — the two repos agree', () => {
  it('the app rate expressed as a percentage is what the site advertises', () => {
    const rate = Number(WEBHOOK.match(/const AFFILIATE_RATE = ([\d.]+);/)![1]);
    expect(rate * 100).toBe(SITE_ADVERTISED_PERCENT);
  });

  it('names the site file a reader has to change with it', () => {
    // The failure above is only actionable if the reader is told where the
    // other half lives, the same way planPriceContract names plan-features.ts.
    const self = readFileSync(__filename, 'utf8');
    expect(self).toContain('harvest-presentation-site src/content/affiliate-rate.ts');
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   4 — no-regression: the flag, the stored rows, the plan prices.
   ═════════════════════════════════════════════════════════════════════════ */
describe('4 — what this change must NOT have moved', () => {
  it('AFFILIATE_PROGRAM_ENABLED is still false', async () => {
    const mod = await import('@/utils/plan-features');
    expect(mod.AFFILIATE_PROGRAM_ENABLED).toBe(false);
    expect(read('utils/plan-features.ts'))
      .toMatch(/^export const AFFILIATE_PROGRAM_ENABLED = false;$/m);
  });

  it('STRIPE_CONNECT_ENABLED is still false', async () => {
    const mod = await import('../stripe-connect-feature');
    expect(mod.STRIPE_CONNECT_ENABLED).toBe(false);
  });

  it('no stored commission is recomputed, rescaled or migrated', () => {
    // The payout paths move an amount that is already on the row. If either of
    // these ever multiplies by a rate, a legacy 20% row silently becomes a 30%
    // one and history is rewritten.
    const payout = read('lib/affiliate-payout.ts');
    expect(payout).toContain('Number(doc.data().commission)');
    expect(payout).not.toMatch(/0\.\d+/);
    expect(payout).not.toContain('AFFILIATE_RATE');

    const referrer = read('lib/affiliate-referrer.ts');
    expect(referrer).not.toMatch(/0\.\d+/);
    expect(referrer).not.toContain('AFFILIATE_RATE');

    // The admin read is the other place a rate could creep in.
    expect(read('app/api/admin/affiliates/route.ts'))
      .toContain('THE STORED `commission` FIELD IS THE TRUTH');
  });

  it('the window module still refuses to touch a stored amount', () => {
    const win = read('lib/affiliate-commission-window.ts');
    expect(win).toContain('recomputes a stored `commission` amount. A legacy 20% row still pays 20%.');
  });

  it('the nine plan prices are unchanged', async () => {
    const { PLAN_PRICING } = await import('@/utils/plan-features');
    expect(PLAN_PRICING).toEqual({
      plus: { monthly: 20, quarterly: 54,  yearly: 190 },
      pro:  { monthly: 40, quarterly: 108, yearly: 380 },
      // ⚠️ THE-343 repriced Ministry; the affiliate RATE is what this file
      // guards and it did not move with it.
      max:  { monthly: 80, quarterly: 216, yearly: 752 },
    });
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   5 — the 0.15s that are NOT the commission, pinned.
   ═════════════════════════════════════════════════════════════════════════ */
describe('5 — every 0.15 left alone, and why', () => {
  it('the donation platform fee is untouched', () => {
    // The REAL map is 0 on every tier — the "0% platform fee" the site sells.
    expect(read('lib/stripe-connect.ts'))
      .toContain('export const PLATFORM_FEE_MAP: Record<string, number> = {\n  plus: 0,\n  pro: 0,\n  max: 0,\n};');
    // The one 0.15 in the donation area is a MOCK fee ladder in the donate
    // route's test. It is a donation platform fee, not affiliate commission,
    // and a rate sweep must never eat it.
    expect(read('app/api/stripe/__tests__/donate-route.test.ts'))
      .toContain('PLATFORM_FEE_MAP: { plus: 0, pro: 0.1, max: 0.15, ultra: 0.2 }');
  });

  it('the retired per-plan ladder stays described as history', () => {
    // "ultra 20% / max 15% / pro 10% / plus 10%" records what the rate USED to
    // be. Rewriting it to 30% would invent a ladder that never existed.
    expect(WEBHOOK).toContain('old per-plan ladder (ultra 20% / max 15% /');
    expect(WEBHOOK).toContain('pro 10% / plus 10%)');
  });

  it('the stored historical commission rows keep their original rates', () => {
    // These fixtures are Stripe's real 16-transfer history. The 0.15 and 0.2
    // rate chips are DERIVED from stored rows (commission ÷ amount), so they
    // must stay exactly as they are — that is the no-migration invariant made
    // visible.
    const t = read('app/api/admin/affiliates/__tests__/route.test.ts');
    expect(t).toContain('amount: 11900, commission: 1785');
    expect(t).toContain('amount: 29900, commission: 4485');
    expect(t).toContain('amount: 47900, commission: 9580');
    expect(t).toContain('{ rate: 0.15, count: 1 }, { rate: 0.2, count: 1 }');
  });

  it('the legacy 20% sweep case still pays 20%', () => {
    const t = read('app/api/stripe/__tests__/webhook-affiliate-12-month-window.test.ts');
    expect(t).toContain('const legacyCommission = Math.round(AMOUNT * 0.2); // 2380');
    expect(t).toContain('the legacy 20% row still pays 20%');
  });

  it('CSS transition and shadow alphas are untouched', () => {
    // `transition: "background 0.15s"` and `rgba(0,0,0,0.15)` are timings and
    // alphas. A blind find-and-replace changes a shadow nobody notices.
    expect(read('components/AdminRAG.tsx')).toContain('transition:"background 0.15s"');
    expect(read('components/BiblePage.tsx')).toContain('rgba(0,0,0,0.15)');
  });
});
