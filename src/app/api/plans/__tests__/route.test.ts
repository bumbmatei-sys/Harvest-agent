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

  it('still REPORTS the RAG capabilities: the chat is false on every plan, the knowledge base is Ministry only', async () => {
    /* WAS 'still advertises the RAG capabilities (aiChat + aiKnowledge)',
       asserting Ministry carried both true — the flags THE-224 was careful not
       to withdraw along with the Telegram add-on.
     *
     * 🔴 THE-253 TOOK THEM OFF EVERY PLAN. This catalog answers the TIER
       question ("what does this plan include"), so false everywhere is now the
       TRUE answer — the chat is an add-on. The flags are still PUBLISHED, and
       that is the half worth keeping: a consumer reading `features.aiChat` gets
       a boolean rather than `undefined`, so a stale marketing surface reads
       "no" instead of crashing or defaulting to yes. */
    const res = await GET();
    const body = await res.json();
    const ministry = body.plans.find((p: any) => p.id === 'ministry');
    expect(ministry).toBeDefined();
    // The two-plan repricing lists the AI knowledge base under Ministry, so that
    // one cell is true there. The chat that answers from it stays an add-on.
    expect(ministry.features.aiChat).toBe(false);
    expect(ministry.features.aiKnowledge).toBe(true);
    for (const plan of body.plans) {
      expect(typeof plan.features.aiChat, plan.id).toBe('boolean');
      expect(typeof plan.features.aiKnowledge, plan.id).toBe('boolean');
      expect(plan.features.aiChat, `${plan.id} still claims the chat`).toBe(false);
      expect(plan.features.aiKnowledge, `${plan.id} KB claim`).toBe(plan.id === 'ministry');
    }
  });
});
