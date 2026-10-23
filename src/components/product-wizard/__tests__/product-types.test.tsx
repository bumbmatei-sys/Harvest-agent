import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NewProductDialog } from '../NewProductDialog';
import { PRODUCT_TYPES, PRODUCT_TYPE_IDS } from '../product-types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('the New product picker offers product types only', () => {
  it('lists Course and Digital download / Ebook, and nothing that has its own section', () => {
    expect(PRODUCT_TYPES.map((t) => t.label)).toEqual(['Course', 'Digital download / Ebook', 'Coaching', 'Bundle']);
    for (const banned of ['fundraising', 'event', 'service', 'form']) {
      expect(PRODUCT_TYPE_IDS).not.toContain(banned);
      expect(PRODUCT_TYPES.map((t) => t.label.toLowerCase())).not.toContain(banned);
    }
  });

  it('Course is the only type that can be picked; the rest are Coming soon', () => {
    expect(PRODUCT_TYPES.filter((t) => t.available).map((t) => t.id)).toEqual(['course']);
  });

  describe('rendered', () => {
    let host: HTMLDivElement;
    let root: Root;
    beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
    afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });

    it('draws one card per type, disables and tags the unavailable ones, and picks Course', async () => {
      const onSelect = vi.fn();
      await act(async () => { root.render(<NewProductDialog open onOpenChange={() => {}} types={PRODUCT_TYPES} onSelect={onSelect} />); });
      const cards = [...document.querySelectorAll<HTMLButtonElement>('[data-product-type]')];
      expect(cards.map((c) => c.getAttribute('data-product-type'))).toEqual(['course', 'digital-download', 'coaching', 'bundle']);
      expect(cards.filter((c) => c.disabled).map((c) => c.getAttribute('data-product-type'))).toEqual(['digital-download', 'coaching', 'bundle']);
      expect(cards.slice(1).every((c) => c.textContent?.includes('Coming soon'))).toBe(true);
      expect(document.body.textContent).not.toMatch(/Fundraising|\bEvent\b|\bService\b|\bForm\b/);
      await act(async () => { cards[0].click(); });
      expect(onSelect).toHaveBeenCalledWith('course');
    });
  });
});
