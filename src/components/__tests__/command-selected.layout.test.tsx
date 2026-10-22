// @vitest-environment node
//
// Node, not happy-dom: happy-dom has no Tailwind cascade, so it cannot tell a
// highlighted row from an unhighlighted one. The rows below are painted by a
// real Chromium against the real compiled stylesheet.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { setUpOrFail } from '../../test/support/suite-setup';
import { buildAppCss } from '../../test/support/tailwind-build';
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '../ui/command';

/**
 * cmdk marks the active row `data-selected="true"` and every other row
 * `data-selected="false"`. Tailwind's bare `data-selected:` variant matches the
 * attribute's presence, so it painted every row; `data-[selected=true]:` matches
 * the value. This renders the real CommandItem and measures what Chromium paints.
 */

const ROWS = ['Dashboard', 'Contacts', 'Events', 'Giving'] as const;
const SELECTED = 1;

type Painted = { label: string; selected: string | null; background: string; shortcut: string };

let browser: MeasuringBrowser;
let painted: Painted[] = [];
let reference = { muted: '', mutedForeground: '', foreground: '' };

setUpOrFail(async () => {
  const css = await buildAppCss();
  const markup = renderToStaticMarkup(
    <Command>
      <CommandList>
        <CommandGroup heading="Go to">
          {ROWS.map((label) => (
            <CommandItem key={label} value={label}>
              {label}
              <CommandShortcut>{label.slice(0, 1)}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>,
  );

  const dir = mkdtempSync(path.join(os.tmpdir(), 'command-selected-'));
  const file = path.join(dir, 'palette.html');
  writeFileSync(
    file,
    `<!doctype html><html><head><style>${css}</style></head><body>${markup}`
      + '<i id="ref-muted" class="bg-muted"></i>'
      + '<i id="ref-muted-fg" class="text-muted-foreground"></i>'
      + '<i id="ref-fg" class="text-foreground"></i></body></html>',
  );

  browser = new MeasuringBrowser();
  await browser.open('file://' + file);

  const result = await browser.evaluateAt<{ painted: Painted[]; reference: typeof reference }>(1280, `(() => {
    const rows = [...document.querySelectorAll('[data-slot="command-item"]')];
    // Server render emits no selection; set it the way cmdk does on the client.
    rows.forEach((row, i) => row.setAttribute('data-selected', String(i === ${SELECTED})));
    const cs = (el, prop) => getComputedStyle(el)[prop];
    return {
      painted: rows.map((row) => ({
        label: row.firstChild.textContent,
        selected: row.getAttribute('data-selected'),
        background: cs(row, 'backgroundColor'),
        shortcut: cs(row.querySelector('[data-slot="command-shortcut"]'), 'color'),
      })),
      reference: {
        muted: cs(document.getElementById('ref-muted'), 'backgroundColor'),
        mutedForeground: cs(document.getElementById('ref-muted-fg'), 'color'),
        foreground: cs(document.getElementById('ref-fg'), 'color'),
      },
    };
  })()`);
  painted = result.painted;
  reference = result.reference;
}, 180_000);

afterAll(async () => { await browser?.close(); });

describe('Command rows are highlighted only when selected', () => {
  it('measured every row, and the probe colours are distinguishable', () => {
    expect(painted.map((p) => p.label)).toEqual([...ROWS]);
    expect(painted.filter((p) => p.selected === 'true')).toHaveLength(1);
    expect(reference.muted).not.toBe('rgba(0, 0, 0, 0)');
    expect(reference.foreground).not.toBe(reference.mutedForeground);
  });

  it('only the selected row gets the bg-muted highlight', () => {
    const highlighted = painted.filter((p) => p.background === reference.muted).map((p) => p.label);
    expect(highlighted).toEqual([ROWS[SELECTED]]);
    for (const p of painted.filter((r) => r.selected === 'false')) {
      expect(p.background, `${p.label} is not selected but is painted`).toBe('rgba(0, 0, 0, 0)');
    }
  });

  it('only the selected row lifts its shortcut to text-foreground', () => {
    const lifted = painted.filter((p) => p.shortcut === reference.foreground).map((p) => p.label);
    expect(lifted).toEqual([ROWS[SELECTED]]);
    for (const p of painted.filter((r) => r.selected === 'false')) {
      expect(p.shortcut, `${p.label} shortcut`).toBe(reference.mutedForeground);
    }
  });
});
