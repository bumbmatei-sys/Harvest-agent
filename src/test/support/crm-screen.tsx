/**
 * Mounting the three CRM tabs — Contacts, Analytics and Roles.
 *
 * Every lookup a test does goes through a visible LABEL (a button's text, a
 * field's placeholder, a section heading) or through a `data-` handle that
 * NAMES the thing. Never through a class pattern: a test that found the
 * Analytics search button by matching `sm:px-8` would pass no matter which
 * button it landed on, and would still pass if the rule were applied to the
 * wrong control.
 *
 * The caller registers the module mocks — `vi.mock` is per-file and hoisted, so
 * it cannot live here.
 */
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

export type CrmTab = 'Contacts' | 'Analytics' | 'Roles';

export interface MountedScreen {
  container: HTMLDivElement;
  root: Root;
  unmount: () => void;
}

/** Mount a component into a detached container and settle its effects. */
export async function mountScreen(element: React.ReactElement): Promise<MountedScreen> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root!: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(element);
    await Promise.resolve();
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return {
    container,
    root,
    unmount: () => { act(() => root.unmount()); container.remove(); },
  };
}

/** The sub-view pill with this exact label. Throws rather than returning null. */
export function tabButton(root: ParentNode, label: CrmTab): HTMLButtonElement {
  const match = Array.from(root.querySelectorAll('button'))
    .find((b) => (b.textContent ?? '').trim() === label);
  if (!match) throw new Error(`no CRM sub-tab labelled "${label}" — the tab bar changed`);
  return match as HTMLButtonElement;
}

/** Click a sub-tab and settle. */
export async function openTab(root: ParentNode, label: CrmTab): Promise<void> {
  const btn = tabButton(root, label);
  await act(async () => { btn.click(); await Promise.resolve(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/** The one button whose visible label is exactly `label`. */
export function buttonByLabel(root: ParentNode, label: string): HTMLButtonElement {
  const matches = Array.from(root.querySelectorAll('button'))
    .filter((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === label);
  if (matches.length === 0) throw new Error(`no button labelled "${label}"`);
  if (matches.length > 1) throw new Error(`button "${label}" is ambiguous (${matches.length})`);
  return matches[0] as HTMLButtonElement;
}

/** The input whose placeholder begins with `text`. */
export function inputByPlaceholder(root: ParentNode, text: string): HTMLInputElement {
  const matches = Array.from(root.querySelectorAll('input'))
    .filter((i) => (i.getAttribute('placeholder') ?? '').startsWith(text));
  if (matches.length === 0) throw new Error(`no input placeheld "${text}…"`);
  if (matches.length > 1) throw new Error(`placeholder "${text}" is ambiguous (${matches.length})`);
  return matches[0] as HTMLInputElement;
}

/** A named region of a tab. */
export function region(root: ParentNode, name: string): HTMLElement {
  const el = root.querySelector(`[${name}]`);
  if (!el) throw new Error(`no region [${name}] — it was renamed or removed`);
  return el as HTMLElement;
}

/** Class tokens of an element. */
export const tokensOf = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

/** True when an element carries every token of a rule, exactly as spelled. */
export const carries = (el: Element, rule: string) =>
  rule.split(/\s+/).every((t) => tokensOf(el).includes(t));

/**
 * Every INLINE style declaration in a subtree, as `prop:value` strings.
 *
 * AnalyticsAndRoles styles itself with `style={{…}}` objects rather than
 * classes, so the class inventory alone cannot see what it renders. A colour
 * check that only read class tokens would report that screen as clean.
 */
export function inlineStyles(root: ParentNode): string[] {
  const out: string[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[style]'))) {
    const s = el.getAttribute('style') ?? '';
    for (const decl of s.split(';')) {
      const t = decl.trim();
      if (t) out.push(t);
    }
  }
  return out;
}
