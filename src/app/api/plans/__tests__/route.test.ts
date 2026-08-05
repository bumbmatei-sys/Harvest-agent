import { describe, it, expect } from 'vitest';
import { GET } from '../route';

// The plans catalog feeds the marketing site (theharvest.site). While the AI
// (Telegram) Assistant add-on is retired (AI_TELEGRAM_ASSISTANT_ENABLED === false)
// it must not be advertised anywhere in the response — no add-on entry, no
// per-plan capability row — so no client can render a purchase option. The RAG
// capabilities (aiChat / aiKnowledge) are a SEPARATE feature and must remain.

describe('GET /api/plans — retired AI Assistant add-on', () => {
  it('does not advertise the AI Assistant add-on in the addons catalog', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.addons).toBeDefined();
    expect(body.addons.aiAssistant).toBeUndefined();
  });

  it('omits the aiAssistant capability row from every plan', async () => {
    const res = await GET();
    const body = await res.json();
    for (const plan of body.plans) {
      expect('aiAssistant' in plan.features).toBe(false);
    }
  });

  it('still advertises the RAG capabilities (aiChat + aiKnowledge)', async () => {
    const res = await GET();
    const body = await res.json();
    // Ministry (ultra) has RAG chat + knowledge base on; those flags must survive.
    const ultra = body.plans.find((p: any) => p.id === 'ultra');
    expect(ultra).toBeDefined();
    expect(ultra.features.aiChat).toBe(true);
    expect(ultra.features.aiKnowledge).toBe(true);
    // And every plan still reports both RAG flags (as booleans).
    for (const plan of body.plans) {
      expect(typeof plan.features.aiChat).toBe('boolean');
      expect(typeof plan.features.aiKnowledge).toBe('boolean');
    }
  });
});

describe('GET /api/plans — freemium catalog', () => {
  it('serves platformFeePct (4 / 2 / 1 / 0) and no longer serves donationRetentionPct', async () => {
    // BREAKING for any external consumer that read `donationRetentionPct` —
    // deliberately. Retention was the `100 - fee * 100` complement of the fee:
    // two numbers for one fact, which is what let the app advertise one rate
    // while charging another (THE-51). The marketing site must render the FEE,
    // phrased as a cost, and never "your church keeps X%".
    const body = await (await GET()).json();
    const byId = Object.fromEntries(body.plans.map((p: any) => [p.id, p]));

    expect(byId.plus.platformFeePct).toBe(4);
    expect(byId.pro.platformFeePct).toBe(2);
    expect(byId.max.platformFeePct).toBe(1);
    expect(byId.ultra.platformFeePct).toBe(0);

    for (const plan of body.plans) {
      expect('donationRetentionPct' in plan, `${plan.id} still serves retention`).toBe(false);
      expect(Number.isInteger(plan.platformFeePct)).toBe(true);
    }
  });

  it('serves the new names and prices', async () => {
    const body = await (await GET()).json();
    expect(body.plans.map((p: any) => p.name)).toEqual(['Seed', 'Root', 'Grove', 'Harvest']);
    expect(body.plans.map((p: any) => p.pricing.monthlyUsd)).toEqual([0, 99, 179, 299]);
    expect(body.plans.map((p: any) => p.pricing.yearlyUsd)).toEqual([0, 990, 1790, 2990]);
  });

  it('serves every limit, including the new maxMembers', async () => {
    const body = await (await GET()).json();
    expect(body.plans.map((p: any) => p.features.maxChurches)).toEqual([2, 4, 6, 8]);
    expect(body.plans.map((p: any) => p.features.maxCourses)).toEqual([2, 5, 10, -1]);
    expect(body.plans.map((p: any) => p.features.maxAdmins)).toEqual([3, 9, 15, -1]);
    expect(body.plans.map((p: any) => p.features.maxMembers)).toEqual([250, 1000, 5000, -1]);
  });
});
