import React, { act } from 'react';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import postcss from 'postcss';

/**
 * THE-181 batch 2 — EnterpriseContactModal.
 *
 * Named the worst-labelled case in the brief: PR 336 tagged it with
 * `data-modal-container="dialog-panel"` and restyled nothing, and it has zero
 * importers anywhere in src (modal-content-surface.test.tsx already pins
 * this — `CONTAINER_EXEMPT` — and its own test below does the same check
 * independently). This PR applies the same four form-layout rules the other
 * three files in the batch get, for vocabulary consistency should it ever
 * become reachable, but does NOT wire it up: no new importer, no route, no
 * button that opens it.
 *
 * Its outer panel (`sm:w-[500px]`) already had a real, deliberate desktop
 * constraint — the founder's report was never about this modal — so
 * FORM_CONTAINER/FORM_MEASURE are not applied to the panel: doing so would
 * either be inert (500px is already narrower than 940px) or blow up a
 * compact dialog that was correctly sized for its five short fields. What
 * this PR applies is FIELD_WIDTH (long for Name/Email/Church, short for the
 * numeric Number of Churches — the only field here that was oversized for
 * its content even inside the already-narrow panel) and CONTROL_DENSITY
 * (38/40px, `sm:`-gated) on the single-line inputs and submit button.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../firebase', () => ({ auth: { currentUser: { uid: 'u1', email: 'member@church.org' } } }));

import EnterpriseContactModal from '../EnterpriseContactModal';
import { buildUtilityCss } from '../../test/support/tailwind-build';
const { mobileLayer, isResponsive, allTokens } = await import('../../test/support/class-inventory');
const { FIELD_WIDTH, ACTION_BUTTON, CONTROL_DENSITY, FIELD_WIDTHS, CONTROL_DENSITY_TOKENS } = await import('../layout/form-layout');

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');
const GLOBALS = path.join(ROOT, 'src/app/globals.css');
const MOBILE_FIXTURE = JSON.parse(
  readFileSync(path.join(__dirname, '__fixtures__/EnterpriseContactModal.mobile-layer.json'), 'utf8'),
) as string[];

function mount(el: React.ReactElement): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { createRoot(container).render(el); });
  return container;
}
const classesOf = (el: Element): string[] => (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);

function fieldBoxByLabel(root: HTMLElement, label: string): HTMLElement {
  const el = Array.from(root.querySelectorAll('label')).find((l) => (l.textContent ?? '').trim().startsWith(label));
  expect(el, `no label starting "${label}"`).toBeDefined();
  return el!.parentElement as HTMLElement;
}

interface Emitted { cls: string; minWidth: number; decls: Record<string, string> }
let emitted: Emitted[] = [];
let rootPx: Array<{ minWidth: number; size: number }> = [];

beforeAll(async () => {
  const css = readFileSync(GLOBALS, 'utf8');
  rootPx = [{ minWidth: 0, size: 16 }];
  postcss.parse(css).walkAtRules('media', (at) => {
    const mq = at.params.match(/min-width:\s*([\d.]+)px/);
    if (!mq) return;
    at.walkRules((r) => {
      if (r.selector.trim() !== ':root') return;
      r.walkDecls('font-size', (d) => {
        const v = d.value.trim().match(/^([\d.]+)px$/);
        if (v) rootPx.push({ minWidth: Number(mq[1]), size: Number(v[1]) });
      });
    });
  });
  rootPx.sort((a, b) => a.minWidth - b.minWidth);

  const host = mount(<EnterpriseContactModal isOpen onClose={() => {}} />);
  const raw = Array.from(host.querySelectorAll('*')).map((el) => el.getAttribute('class') || '').join(' ');
  document.body.innerHTML = '';

  // v4 emits the same utilities wrapped in `@layer utilities` and with theme
  // values referenced rather than inlined; buildUtilityCss undoes exactly
  // those two representational changes, so the walker below is unchanged.
  const out = { css: await buildUtilityCss(raw) };

  const unescape = (sel: string) =>
    sel.replace(/^\./, '').replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16))).replace(/\\/g, '');
  const collect = (node: postcss.Rule, minWidth: number) => {
    const decls: Record<string, string> = {};
    node.walkDecls((d) => { decls[d.prop] = d.value.trim(); });
    emitted.push({ cls: unescape(node.selector), minWidth, decls });
  };
  postcss.parse(out.css).each((node) => {
    if (node.type === 'rule') collect(node, 0);
    if (node.type === 'atrule' && node.name === 'media') {
      const m = node.params.match(/min-width:\s*([\d.]+)px/);
      if (!m) return;
      node.walkRules((r) => collect(r, Number(m[1])));
    }
  });
  expect(emitted.length).toBeGreaterThan(0);
}, 120_000);

function effective(classes: string[], viewport: number): Record<string, string> {
  const wanted = new Set(classes);
  const out: Record<string, string> = {};
  for (const rule of emitted) {
    if (!wanted.has(rule.cls) || rule.minWidth > viewport) continue;
    Object.assign(out, rule.decls);
  }
  return out;
}
const rootSizeAt = (viewport: number): number => rootPx.filter((r) => r.minWidth <= viewport).slice(-1)[0].size;
function px(value: string | undefined, viewport: number): number | null {
  if (!value) return null;
  const rem = value.match(/^(-?[\d.]+)rem$/);
  if (rem) return Number(rem[1]) * rootSizeAt(viewport);
  const p = value.match(/^(-?[\d.]+)px$/);
  if (p) return Number(p[1]);
  return null;
}

const PHONE = 380;
const DESKTOP = 1440;

it('the sub-640px rendering is exactly what it was', () => {
  const host = mount(<EnterpriseContactModal isOpen onClose={() => {}} />);
  expect(mobileLayer(host)).toEqual(MOBILE_FIXTURE);
});

it('the layout rules never appear unprefixed', () => {
  const host = mount(<EnterpriseContactModal isOpen onClose={() => {}} />);
  const bad = allTokens(host).filter((t) => /^(max-w-\[|flex-none$|h-\[|py-0$)/.test(t) && !isResponsive(t));
  expect(bad).toEqual([]);
});

it('mobile touch targets stay at least 44px tall', () => {
  const host = mount(<EnterpriseContactModal isOpen onClose={() => {}} />);
  const inputs = Array.from(host.querySelectorAll('input, textarea, button[type="submit"]')) as HTMLElement[];
  expect(inputs.length).toBeGreaterThan(0);
  for (const el of inputs) {
    const decls = effective(classesOf(el), PHONE);
    expect(decls.height, `${el.tagName} carries a fixed mobile height`).toBeUndefined();
    const padY = (px(decls['padding-top'], PHONE) ?? px(decls.padding, PHONE) ?? 0) +
      (px(decls['padding-bottom'], PHONE) ?? px(decls.padding, PHONE) ?? 0);
    expect(padY, `${el.tagName} mobile vertical padding shrank below the pre-PR py-3`).toBeGreaterThanOrEqual(24);
  }
});

it('Number of Churches (short) is narrower than Your Name (long) at desktop', () => {
  const host = mount(<EnterpriseContactModal isOpen onClose={() => {}} />);
  const nameBox = fieldBoxByLabel(host, 'Your Name');
  const countBox = fieldBoxByLabel(host, 'Number of Churches');
  expect(classesOf(nameBox).join(' ')).toContain(FIELD_WIDTH.long);
  expect(classesOf(countBox).join(' ')).toContain(FIELD_WIDTH.short);
  const nameCap = Number(FIELD_WIDTH.long.match(/\[(\d+)px\]/)![1]);
  const countCap = Number(FIELD_WIDTH.short.match(/\[(\d+)px\]/)![1]);
  expect(countCap).toBeLessThan(nameCap);
});

it('the submit button carries the shared action-button and control-density tokens', () => {
  const host = mount(<EnterpriseContactModal isOpen onClose={() => {}} />);
  const button = host.querySelector('button[type="submit"]')!;
  const tokens = classesOf(button).join(' ');
  for (const t of ACTION_BUTTON.split(' ')) expect(tokens).toContain(t);
  for (const t of CONTROL_DENSITY.action.split(' ')) expect(tokens).toContain(t);
});

it('every arbitrary desktop width/height on the file is one of form-layout’s named values', () => {
  const src = readFileSync(path.join(SRC, 'components/EnterpriseContactModal.tsx'), 'utf8');
  const arbitrary = [...src.matchAll(/sm:(?:max-w|h)-\[[^\]]+\]/g)].map((m) => m[0]);
  const known = new Set([...FIELD_WIDTHS, ...CONTROL_DENSITY_TOKENS].flatMap((r) => r.split(/\s+/)));
  // sm:w-[500px] is the panel's own pre-existing, protected constraint (see
  // modal-content-surface.test.tsx's CONTAINER_EXEMPT) — not a value this PR
  // introduced, so it is excluded rather than required to match the module.
  const unknown = arbitrary.filter((t) => !known.has(t) && t !== 'sm:w-[500px]');
  expect(unknown).toEqual([]);
});

it('no literal colour was introduced by this PR — the count is exactly what HEAD had', () => {
  // EnterpriseContactModal already carries two pre-existing hex literals
  // (#0b1121 / #1a2744) sharing lines with the tokens this PR added; a
  // per-line scan would flag those as this PR's doing. Diffing the count
  // against unmodified HEAD isolates what actually changed.
  const src = readFileSync(path.join(SRC, 'components/EnterpriseContactModal.tsx'), 'utf8');
  const before = execSync('git show HEAD:src/components/EnterpriseContactModal.tsx', { cwd: ROOT, encoding: 'utf8' });
  const hexCount = (s: string) => (s.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length;
  const rgbCount = (s: string) => (s.match(/\b(?:rgba?|hsla?)\(/g) ?? []).length;
  expect(hexCount(src), 'a new hex colour literal was introduced').toBe(hexCount(before));
  expect(rgbCount(src), 'a new rgb()/hsl() colour literal was introduced').toBe(rgbCount(before));
});

it('the four palettes resolve — :root and dark both define real values', () => {
  const css = readFileSync(GLOBALS, 'utf8');
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  postcss.parse(css).walkRules((rule) => {
    const inDark = /\.dark|\[data-theme="dark"\]/.test(rule.selector);
    const inRoot = rule.selector.trim() === ':root';
    if (!inDark && !inRoot) return;
    rule.walkDecls((d) => { if (d.prop.startsWith('--')) (inDark ? dark : light)[d.prop] = d.value.trim(); });
  });
  expect(Object.keys(light).length).toBeGreaterThan(0);
  expect(Object.keys(dark).length).toBeGreaterThan(0);
});

it('still has zero importers anywhere in src — this PR does not revive it', () => {
  const importers = execSync(
    "grep -rl \"EnterpriseContactModal\" src --include=*.tsx --include=*.ts || true",
    { encoding: 'utf8' },
  ).split('\n').filter(Boolean).sort();
  const nonSelf = importers.filter(
    (f) => !f.endsWith('EnterpriseContactModal.tsx') && !f.includes('__tests__'),
  );
  expect(nonSelf, 'EnterpriseContactModal gained a real importer — it is no longer unreachable').toEqual([]);
});

it('the contact form still submits the same required trio to /api/enterprise-lead', async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const realFetch = global.fetch;
  global.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(init.body as string) });
    return { ok: true, json: async () => ({}) } as Response;
  }) as typeof fetch;
  try {
    const host = mount(<EnterpriseContactModal isOpen onClose={() => {}} />);
    const set = (label: string, value: string) => {
      const box = fieldBoxByLabel(host, label);
      const input = box.querySelector('input') as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value')!.set!;
      act(() => {
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    set('Your Name', 'Pastor Ada');
    set('Email', 'ada@church.org');
    set('Church / Organization Name', 'Grace Church');
    const form = host.querySelector('form')!;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/enterprise-lead');
    expect(calls[0].body).toMatchObject({ name: 'Pastor Ada', email: 'ada@church.org', churchName: 'Grace Church' });
  } finally {
    global.fetch = realFetch;
  }
});

describe('the shared modal-content-surface exemption is untouched', () => {
  it('modal-content-surface.test.tsx already lists this file as CONTAINER_EXEMPT', () => {
    const testSrc = readFileSync(path.join(SRC, 'components/__tests__/modal-content-surface.test.tsx'), 'utf8');
    expect(testSrc).toMatch(/CONTAINER_EXEMPT = \['EnterpriseContactModal'\]/);
  });
});

