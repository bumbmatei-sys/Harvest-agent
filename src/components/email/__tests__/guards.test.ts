import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { stripComments } from '@/__tests__/__fixtures__/the-346-strip-comments';

const DIR = path.resolve(__dirname, '..');
const files = () => readdirSync(DIR).filter((f) => /\.tsx?$/.test(f));
const code = (f: string) => stripComments(readFileSync(path.join(DIR, f), 'utf8'));

// Needles are assembled from fragments so this file never contains what it greps for.
const RENDER_BUTTON = new RegExp(['render=\\{\\s*<', 'Button'].join(''));
const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/;
const RAW_SCALE = new RegExp(`\\b(?:bg|text|border|ring|from|to|via|fill|stroke)-(?:${['red', 'blue', 'green', 'gray', 'grey', 'slate', 'zinc', 'neutral', 'stone', 'amber', 'yellow', 'orange', 'emerald', 'indigo', 'violet', 'purple', 'pink', 'rose', 'sky', 'teal', 'cyan'].join('|')})-\\d{2,3}\\b`);

describe('the email UI follows the house rules', () => {
  it('sweeps a non-empty set of files (the guard cannot pass vacuously)', () => {
    expect(files().filter((f) => f.endsWith('.tsx')).length).toBeGreaterThan(10);
  });

  it.each(files())('%s: no Button passed through a render prop (it drops the anchor ref, THE-337)', (f) => {
    expect(code(f)).not.toMatch(RENDER_BUTTON);
  });

  it.each(files())('%s: theme tokens only, no hardcoded hex and no raw Tailwind colour scale', (f) => {
    const src = code(f);
    expect(src, `${f} hardcodes a hex colour`).not.toMatch(HEX);
    expect(src, `${f} uses a raw Tailwind colour scale`).not.toMatch(RAW_SCALE);
  });

  it('the guards can fail: planted violations are caught', () => {
    expect('<Popover render={<Button />}>').toMatch(RENDER_BUTTON);
    expect('const c = "#C9963A";').toMatch(HEX);
    expect('className="bg-blue-500"').toMatch(RAW_SCALE);
    expect('className="bg-surface-gold text-strong"').not.toMatch(RAW_SCALE);
  });
});
