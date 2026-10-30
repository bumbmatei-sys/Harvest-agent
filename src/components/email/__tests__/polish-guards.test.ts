import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { stripComments } from '@/__tests__/__fixtures__/the-346-strip-comments';

const DIR = path.resolve(__dirname, '..');
const files = () => readdirSync(DIR).filter((f) => /\.tsx?$/.test(f));
const code = (f: string) => stripComments(readFileSync(path.join(DIR, f), 'utf8'));

// Needles are assembled from fragments so this file never contains what it greps for.
const FOOTER_OPEN = new RegExp(['<Dialog', 'Footer\\b[^>]*>'].join(''), 'g');
// In the dark theme --muted is near-black (the recessed fill), so a SELECTED state painted with it is a black block.
const SELECTED_AS_MUTED = new RegExp(['(?:aria-pressed|data-\\[pressed\\]|data-pressed|data-active|data-\\[state=on\\])', ':bg-(?:muted|surface-sunken)\\b'].join(''));
const RAW_BUTTON = new RegExp(['<', 'button\\b'].join(''));
const RAW_INPUT = new RegExp(['<', 'input\\b'].join(''));

describe('dark mode: the polish items hold', () => {
  it('sweeps a non-empty set of files', () => {
    expect(files().length).toBeGreaterThan(20);
  });

  it('every dialog footer in the email UI sets its own border colour (the primitive draws a bright one)', () => {
    let seen = 0;
    for (const f of files()) {
      for (const tag of code(f).match(FOOTER_OPEN) ?? []) {
        seen += 1;
        expect(tag, `${f}: ${tag} has no border-line`).toMatch(/border-line/);
      }
    }
    expect(seen, 'no dialog footer was found, so the guard checked nothing').toBeGreaterThanOrEqual(6);
  });

  it.each(files())('%s: a selected toggle is never painted with the dark-mode black fill', (f) => {
    expect(code(f)).not.toMatch(SELECTED_AS_MUTED);
  });

  it('the segmented pill uses the shell track and active tokens, which are lifted in dark', () => {
    const kit = code('kit.tsx');
    expect(kit).toContain('bg-seg-track');
    expect(kit).toContain('aria-pressed:bg-seg-active');
    expect(kit).not.toMatch(/rounded-lg bg-surface-sunken/);
  });

  it('the composer toolbar marks the active tool with the raised chip token', () => {
    expect(code('BodyEditor.tsx')).toContain('aria-pressed:bg-accent');
  });

  it('the picker has no raw button', () => {
    expect(code('TemplatesDialog.tsx')).not.toMatch(RAW_BUTTON);
  });

  // PR #560 review: these controls must stay on the installed primitives.
  it.each(['ThemePicker.tsx', 'ThemeSettingsPanels.tsx', 'blocks/Box.tsx', 'kit.tsx'])(
    '%s: theme controls use primitives rather than native controls', (file) => {
      expect(code(file)).not.toMatch(RAW_BUTTON);
      expect(code(file)).not.toMatch(RAW_INPUT);
    },
  );

  it('the guards can fail: planted violations are caught', () => {
    expect('<button type="button" />').toMatch(RAW_BUTTON);
    expect('<input type="color" />').toMatch(RAW_INPUT);
    expect('<Button />').not.toMatch(RAW_BUTTON);
    expect('<Input type="color" />').not.toMatch(RAW_INPUT);
    expect('className="aria-pressed:bg-muted"').toMatch(SELECTED_AS_MUTED);
    expect('className="data-[pressed]:bg-surface-sunken"').toMatch(SELECTED_AS_MUTED);
    expect('className="aria-pressed:bg-accent hover:bg-muted"').not.toMatch(SELECTED_AS_MUTED);
    expect('<DialogFooter className="x">'.match(FOOTER_OPEN)?.[0]).not.toMatch(/border-line/);
    expect('<DialogFooter className="border-line">'.match(FOOTER_OPEN)?.[0]).toMatch(/border-line/);
  });
});
