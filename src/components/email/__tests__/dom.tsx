import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

export async function mount(ui: ReactElement): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(ui); });
}

export async function unmount(): Promise<void> {
  await act(async () => { root?.unmount(); });
  host?.remove();
  document.body.innerHTML = '';
  root = null;
  host = null;
}

export const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

export function all(selector: string): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>(selector)];
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** An element whose accessible name (aria-label or text) matches. */
export function byName(selector: string, name: string | RegExp): HTMLElement | null {
  return all(selector).find((el) => {
    const n = norm(el.getAttribute('aria-label')) || norm(el.textContent);
    return typeof name === 'string' ? n === name : name.test(n);
  }) ?? null;
}

export function need<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`not found: ${what}\n${document.body.innerHTML.slice(0, 1500)}`);
  return value;
}

export async function click(el: HTMLElement): Promise<void> {
  await act(async () => { el.click(); });
}

export async function type(el: HTMLElement, value: string): Promise<void> {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export function text(): string {
  return norm(document.body.textContent);
}
