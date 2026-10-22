import { describe, it, expect, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Command, CommandItem, CommandList, CommandShortcut } from '../ui/command';

/**
 * The premise `command-selected.layout.test.tsx` paints: real cmdk marks exactly
 * one row `data-selected="true"` and the rest `data-selected="false"`. Both
 * values are present on the attribute, so only a value-matching variant can
 * tell them apart.
 */

const ROWS = ['Dashboard', 'Contacts', 'Events', 'Giving'];

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <Command>
        <CommandList>
          {ROWS.map((label) => (
            <CommandItem key={label} value={label}>
              {label}
              <CommandShortcut>{label[0]}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandList>
      </Command>,
    );
  });
  return { container: host };
}

describe('Command row selection markup', () => {
  it('cmdk selects exactly one row and writes "false" on the others', () => {
    const { container } = mount();
    const rows = [...container.querySelectorAll('[data-slot="command-item"]')];
    expect(rows).toHaveLength(ROWS.length);
    expect(rows.map((r) => r.getAttribute('data-selected'))).toEqual(['true', 'false', 'false', 'false']);
  });

  it('every row styles selection by VALUE, never by the attribute being present', () => {
    const { container } = mount();
    const rows = [...container.querySelectorAll('[data-slot="command-item"]')];
    for (const row of rows) {
      const classes = row.className.split(/\s+/);
      expect(classes).toContain('data-[selected=true]:bg-muted');
      expect(classes).toContain('data-[selected=true]:text-foreground');
      expect(classes).toContain('data-[selected=true]:*:[svg]:text-foreground');
      expect(classes.filter((c) => c.startsWith('data-selected:'))).toEqual([]);
    }
    const shortcut = container.querySelector('[data-slot="command-shortcut"]')!;
    expect(shortcut.className.split(/\s+/)).toContain('group-data-[selected=true]/command-item:text-foreground');
    expect(shortcut.className).not.toMatch(/group-data-selected\//);
  });
});
