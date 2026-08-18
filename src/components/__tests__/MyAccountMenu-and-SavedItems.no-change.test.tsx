import React, { act } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * THE-181 batch 2 — MyAccountMenu.tsx and SavedItems.tsx, the other two files
 * in scope. Neither gets a form-layout.ts import; this file states why rather
 * than leaving the absence silent.
 *
 * MyAccountMenu — STOP condition 6. It is a fixed `w-60` (240px) dropdown, not
 * a form: `w-full` here means "fill this 240px menu", which is correct, not
 * the unbounded-stretch defect the four rules exist for. None of
 * FORM_CONTAINER/FORM_MEASURE (both far wider than 240px), FIELD_WIDTH (no
 * fields), ACTION_BUTTON (no submit action), or CONTROL_DENSITY (no
 * text-entry control) has anything to bind to here.
 *
 * SavedItems — "small" per the brief, and correctly so: there are no fields,
 * inputs, or buttons wider than their content — it is a list of read-only
 * cards. It already carries its own desktop constraint
 * (`lg:max-w-[760px] lg:mx-auto lg:w-full`), which is untouched: rebuilding it
 * on FORM_MEASURE (940px, `sm:`-gated) would both widen it (760 -> 940) and
 * move its breakpoint (lg -> sm) for a screen that was never reported broken.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC = path.resolve(__dirname, '..');

function mount(el: React.ReactElement): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { createRoot(container).render(el); });
  return container;
}

describe('MyAccountMenu — a dropdown, not a form surface', () => {
  it('imports no rule from form-layout.ts', () => {
    const src = readFileSync(path.join(SRC, 'MyAccountMenu.tsx'), 'utf8');
    expect(src).not.toMatch(/from '\.\/layout\/form-layout'/);
  });

  it('the open menu panel is a fixed 240px (w-60), not a growing container', async () => {
    const MyAccountMenu = (await import('../MyAccountMenu')).default;
    const host = mount(
      <MyAccountMenu
        billingAccess="no"
        onOpenProfile={() => {}}
        onGoToUserApp={() => {}}
        onLogout={() => {}}
      />,
    );
    const trigger = host.querySelector('button[aria-label="My account"]') as HTMLButtonElement;
    act(() => { trigger.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const panel = host.querySelector('[role="menu"]');
    expect(panel).not.toBeNull();
    expect((panel!.getAttribute('class') ?? '').split(/\s+/)).toContain('w-60');
  });

  it('every menu row is w-full of that 240px menu by design, not stretched-field debt', async () => {
    const MyAccountMenu = (await import('../MyAccountMenu')).default;
    const host = mount(
      <MyAccountMenu
        billingAccess="yes"
        onOpenProfile={() => {}}
        onOpenSettings={() => {}}
        onOpenBilling={() => {}}
        onGoToUserApp={() => {}}
        onLogout={() => {}}
      />,
    );
    const trigger = host.querySelector('button[aria-label="My account"]') as HTMLButtonElement;
    act(() => { trigger.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const rows = Array.from(host.querySelectorAll('[role="menuitem"]'));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect((row.getAttribute('class') ?? '')).toMatch(/\bw-full\b/);
    }
  });
});

describe('SavedItems — a list surface, already constrained', () => {
  it('imports no rule from form-layout.ts', () => {
    const src = readFileSync(path.join(SRC, 'SavedItems.tsx'), 'utf8');
    expect(src).not.toMatch(/from '\.\/layout\/form-layout'/);
  });

  it('carries no field, input, or submit button that could be oversized', () => {
    const src = readFileSync(path.join(SRC, 'SavedItems.tsx'), 'utf8');
    expect(src).not.toMatch(/<input\b/);
    expect(src).not.toMatch(/<textarea\b/);
    expect(src).not.toMatch(/type=["']submit["']/);
  });

  it('keeps its own pre-existing desktop constraint on both the header and the list', () => {
    const src = readFileSync(path.join(SRC, 'SavedItems.tsx'), 'utf8');
    const matches = [...src.matchAll(/lg:max-w-\[760px\] lg:mx-auto/g)];
    expect(matches.length).toBe(2);
  });
});
