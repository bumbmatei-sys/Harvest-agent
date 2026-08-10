import React, { act } from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';

import FAQModal from '../FAQModal';
import { MEMBER_FAQS } from '../../lib/member-faqs';

/**
 * The answers moved from inline JSX to plain strings in `member-faqs.ts`, so
 * the modal now renders a `string[]` per entry rather than a ReactNode. That
 * is exactly the kind of change that typechecks while rendering nothing — a
 * mapped array that silently produces no paragraphs looks identical to a
 * collapsed accordion. These tests pin that the copy actually reaches the DOM.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;

async function render(isOpen: boolean) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<FAQModal isOpen={isOpen} onClose={() => {}} />);
  });
  return root;
}

/** Click the question header for the entry at `index`. */
async function openEntry(index: number) {
  const headers = Array.from(container.querySelectorAll('button')).filter((b) =>
    MEMBER_FAQS.some((f) => b.textContent?.includes(f.question)),
  );
  await act(async () => {
    headers[index].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('FAQModal', () => {
  it('renders nothing when closed', async () => {
    await render(false);
    expect(container.textContent).toBe('');
  });

  it('lists every member question', async () => {
    await render(true);
    for (const faq of MEMBER_FAQS) {
      expect(container.textContent, `missing question: ${faq.question}`).toContain(faq.question);
    }
  });

  it('keeps answers collapsed until their question is clicked', async () => {
    await render(true);
    // First paragraph of the first entry must not be on screen yet.
    expect(container.textContent).not.toContain(MEMBER_FAQS[0].answer[0]);
  });

  it('renders every paragraph of an opened answer', async () => {
    await render(true);
    for (let i = 0; i < MEMBER_FAQS.length; i++) {
      await openEntry(i);
      for (const paragraph of MEMBER_FAQS[i].answer) {
        expect(
          container.textContent,
          `entry "${MEMBER_FAQS[i].question}" did not render: ${paragraph.slice(0, 40)}…`,
        ).toContain(paragraph);
      }
      // Each paragraph is its own <p>, not one run-together block.
      const paragraphs = container.querySelectorAll('p');
      expect(paragraphs.length).toBeGreaterThanOrEqual(MEMBER_FAQS[i].answer.length);
      await openEntry(i); // collapse again
    }
  });
});
