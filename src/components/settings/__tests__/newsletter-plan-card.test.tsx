import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../firebase', () => ({ auth: { currentUser: null }, db: {} }));
vi.mock('../../../utils/auth-fetch', () => ({ authFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })) }));
vi.mock('../../../utils/plan-change', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/plan-change')>();
  return {
    ...actual,
    runDodoPlanChange: vi.fn(async () => ({ ok: true, message: 'Plan changed' })),
    fetchBillingProcessor: vi.fn(async () => 'dodo' as const),
  };
});
vi.mock('../useTenantId', () => ({ getTenantId: async () => 'grace' }));

import PlanUpgradeSection from '../PlanUpgradeSection';
import { PRICED_PLAN_ORDER, PLAN_DISPLAY_NAMES } from '../../../utils/plan-features';

let container: HTMLDivElement;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
});

function cardLines(): Record<string, string[]> {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    root.render(<PlanUpgradeSection tenantId="grace" currentPlan="free" processor="dodo" />);
  });
  const out: Record<string, string[]> = {};
  // Keyed by render order, not by searching the text: the Ministry card says
  // "Everything in Church", so a text search files it under the wrong tier.
  [...container.querySelectorAll('.snap-center')].forEach((card, i) => {
    out[PLAN_DISPLAY_NAMES[PRICED_PLAN_ORDER[i]]] = [...card.querySelectorAll('li')].map((li) => li.textContent ?? '');
  });
  return out;
}

describe('in-app plan cards — the Newsletter line', () => {
  it('prints Newsletter on Ministry, the tier that owns it, and not on Church', () => {
    const lines = cardLines();
    expect(Object.keys(lines), 'a priced card did not render').toEqual(
      PRICED_PLAN_ORDER.map((p) => PLAN_DISPLAY_NAMES[p]),
    );
    expect(lines['Ministry'], 'Ministry lost its Newsletter line').toContain('Newsletter');
    expect(lines['Church'], 'Church was shown a Newsletter line').not.toContain('Newsletter');
  });

  it('never mentions Mailchimp or Instagram', () => {
    const all = Object.values(cardLines()).flat().join(' | ');
    expect(all).not.toMatch(/mailchimp|instagram/i);
  });
});
