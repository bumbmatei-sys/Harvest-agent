/**
 * Mounting the five admin ministry screens — Community, Events, Fundraising,
 * Forms and Check-In.
 *
 * Every lookup goes through a visible LABEL (a button's text, a field's
 * placeholder, a section heading) or a `data-` handle that NAMES the thing —
 * never through a class pattern. A test that found the ticket-price field by
 * matching `sm:max-w-[160px]` would pass whichever input it landed on, and
 * would keep passing with the rule applied to the wrong control.
 *
 * The caller registers the module mocks: `vi.mock` is per-file and hoisted, so
 * it cannot live here.
 */
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

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

/** Let queued effects and microtasks settle after an interaction. */
export async function settle(): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/** Every element whose trimmed text is exactly `text`. */
export function byText(root: ParentNode, tag: string, text: string): HTMLElement[] {
  return Array.from(root.querySelectorAll(tag))
    .filter((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim() === text) as HTMLElement[];
}

/** The one button whose visible label is exactly `label`. */
export function buttonByLabel(root: ParentNode, label: string): HTMLButtonElement {
  const matches = byText(root, 'button', label);
  if (matches.length === 0) throw new Error(`no button labelled "${label}" — the markup changed`);
  if (matches.length > 1) throw new Error(`button "${label}" is ambiguous (${matches.length})`);
  return matches[0] as HTMLButtonElement;
}

/** The first button whose visible label starts with `prefix`. */
export function buttonStartingWith(root: ParentNode, prefix: string): HTMLButtonElement {
  const match = Array.from(root.querySelectorAll('button'))
    .find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim().startsWith(prefix));
  if (!match) throw new Error(`no button starting "${prefix}" — the markup changed`);
  return match as HTMLButtonElement;
}

/** Click and settle. */
export async function click(el: HTMLElement): Promise<void> {
  await act(async () => { el.dispatchEvent(new Event('click', { bubbles: true })); await Promise.resolve(); });
  await settle();
}

/** The one control (input/textarea/select) whose placeholder starts with `text`. */
export function controlByPlaceholder(root: ParentNode, text: string): HTMLElement {
  const matches = Array.from(root.querySelectorAll('input, textarea'))
    .filter((i) => (i.getAttribute('placeholder') ?? '').startsWith(text));
  if (matches.length === 0) throw new Error(`no control placeheld "${text}…" — the markup changed`);
  return matches[0] as HTMLElement;
}

/**
 * The control a label names — the field wrapper's control, found by walking
 * from the label's own parent. Labels here are siblings of their control
 * rather than `htmlFor`-bound, which is what the markup actually does.
 */
export function controlNamedBy(root: ParentNode, labelText: string): HTMLElement {
  const label = Array.from(root.querySelectorAll('label'))
    .find((l) => (l.textContent ?? '').replace(/\s+/g, ' ').trim().startsWith(labelText));
  if (!label) throw new Error(`no label "${labelText}" — the markup changed`);
  const scope = label.parentElement;
  if (!scope) throw new Error(`label "${labelText}" has no parent`);
  const control = scope.querySelector('input, textarea, select');
  if (!control) throw new Error(`label "${labelText}" names no control`);
  return control as HTMLElement;
}

/** The field WRAPPER a label names — the element the width rule goes on. */
export function fieldNamedBy(root: ParentNode, labelText: string): HTMLElement {
  const label = Array.from(root.querySelectorAll('label'))
    .find((l) => (l.textContent ?? '').replace(/\s+/g, ' ').trim().startsWith(labelText));
  if (!label) throw new Error(`no label "${labelText}" — the markup changed`);
  const wrapper = label.parentElement;
  if (!wrapper) throw new Error(`label "${labelText}" has no wrapper`);
  return wrapper;
}

/** A named region of a screen, by its `data-` handle. */
export function region(root: ParentNode, name: string): HTMLElement {
  const el = root.querySelector(`[${name}]`);
  if (!el) throw new Error(`no region [${name}] — it was renamed or removed`);
  return el as HTMLElement;
}
