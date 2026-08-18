/**
 * Mounting the Add Church form, and finding its fields BY LABEL.
 *
 * Every lookup here goes through the visible label text — never a `name`
 * attribute and never a class pattern. A test that found the zipcode input by
 * matching `max-w-[10rem]` would pass no matter which field it landed on; one
 * that finds it under the label "Zipcode" fails loudly the day that field is
 * renamed, which is exactly what test "no field was added, removed, reordered
 * or renamed" is for.
 *
 * The caller registers the module mocks (firebase, tenant scope, the Maps
 * widget, ImageUpload) — vi.mock is per-file and hoisted, so it cannot live here.
 */
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

export interface MountedForm {
  container: HTMLDivElement;
  root: Root;
  unmount: () => void;
}

/** Mount a component into a detached container and settle its effects. */
export async function mountForm(element: React.ReactElement): Promise<MountedForm> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root!: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(element);
    await Promise.resolve();
  });
  return {
    container,
    root,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/**
 * The `<label>` whose visible text begins with `label`. Required fields render
 * a trailing `*` and optional ones a trailing "(Optional)", so the match is on
 * the leading text rather than the whole string.
 */
export function labelElement(root: ParentNode, label: string): HTMLLabelElement {
  const matches = Array.from(root.querySelectorAll('label')).filter((el) =>
    normalise(el.textContent ?? '').startsWith(normalise(label)),
  );
  if (matches.length === 0) {
    throw new Error(`no label starting with "${label}" — the form markup changed, test needs updating`);
  }
  if (matches.length > 1) {
    throw new Error(`label "${label}" is ambiguous (${matches.length} matches) — name it more precisely`);
  }
  return matches[0] as HTMLLabelElement;
}

/** The control a label introduces: the first input/select/textarea beside it. */
export function fieldByLabel(root: ParentNode, label: string): HTMLElement {
  const el = labelElement(root, label);
  const control = el.parentElement?.querySelector('input, select, textarea');
  if (!control) {
    throw new Error(`label "${label}" introduces no control — the form markup changed, test needs updating`);
  }
  return control as HTMLElement;
}

/**
 * The element that carries a field's width: the wrapper the label and its
 * control share. The width cap goes here rather than on the input because
 * several fields wrap their input in a positioning div for a leading icon —
 * capping the wrapper constrains those uniformly, and the input keeps `w-full`.
 */
export function fieldBoxByLabel(root: ParentNode, label: string): HTMLElement {
  const parent = labelElement(root, label).parentElement;
  if (!parent) throw new Error(`label "${label}" has no wrapper — the form markup changed, test needs updating`);
  return parent as HTMLElement;
}

/** Every field label in the form, in document order. */
export function fieldLabels(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll('label')).map((el) => normalise(el.textContent ?? ''));
}

/** The form's submit button. */
export function submitButton(root: ParentNode): HTMLButtonElement {
  const el = root.querySelector('button[type="submit"]');
  if (!el) throw new Error('no submit button — the form markup changed, test needs updating');
  return el as HTMLButtonElement;
}

/** Collapse whitespace so `Church Name  *` and `Church Name *` compare equal. */
export function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
