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
