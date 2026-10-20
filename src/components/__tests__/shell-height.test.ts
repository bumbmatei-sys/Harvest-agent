import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SHELL_CHROME, SHELL_CHROME_REM, SHELL_SCREEN_HEIGHT } from '../layout/shell-height';

/**
 * The full-height admin screens must actually reach the bottom of the shell.
 *
 * ── What went wrong ──────────────────────────────────────────────────────────
 * Notes and Community both spelled `lg:h-[calc(100dvh-140px)]`. Nothing derived
 * 140 — it was a guess, and it was ~37px too big, so both screens stopped short
 * of the bottom of the content area and left a band of empty page under them.
 *
 * ── Why this file exists rather than a comment ───────────────────────────────
 * The replacement is derived (see shell-height.ts), and a derivation is only as
 * good as its premises. Those premises are four Tailwind classes in
 * AdminDashboard.tsx — a file these screens do not own and cannot see. So they
 * are read back here: if the top bar stops being `h-12`, or the content area's
 * padding moves, this fails and names the class that moved, instead of the two
 * screens quietly going short again.
 *
 * ⚠️ This asserts the shell is UNCHANGED. It is not a licence to change it —
 * AdminDashboard.tsx belongs to another ticket. A failure here means the
 * derivation in shell-height.ts needs updating to match the shell, not the
 * other way round.
 */

const SRC = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');
const SHELL = read('components/AdminDashboard.tsx');

/** The className of the first element in the shell matching a marker. */
const classOfLineWith = (marker: string): string => {
  const line = SHELL.split('\n').find((l) => l.includes(marker));
  expect(line, `the shell no longer has an element matching ${marker}`).toBeDefined();
  const m = line!.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/);
  expect(m, `${marker} carries no className`).not.toBeNull();
  return (m![1] ?? m![2]) as string;
};

describe('the shell chrome the full-height screens subtract is still what they think', () => {
  it('the shell has a 100dvh parent and a flex column, so its children have a real height', () => {
    // The provider is the 100dvh row. SidebarInset is the flex column inside it.
    // Without both, `flex-1` on the content area would size to content.
    const provider = classOfLineWith('h-[100dvh] min-h-0 overflow-hidden bg-surface');
    expect(provider).toContain('h-[100dvh]');
    const col = classOfLineWith('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card');
    expect(col).toContain('flex-col');
    expect(col).toContain('flex-1');
  });

  it('the desktop top bar is h-12 and does not shrink', () => {
    const barFile = read('components/admin-shell/AdminContentBar.tsx');
    const line = barFile.split('\n').find((l) => l.includes('h-12 shrink-0'));
    expect(line, 'the content bar no longer spells h-12 shrink-0').toBeDefined();
    const bar = (line!.match(/className="([^"]*)"/) ?? [])[1] ?? '';
    expect(bar, 'the top bar height moved — update SHELL_CHROME.topBar').toContain('h-12');
    expect(bar, 'the top bar must not shrink, or the subtraction is not a constant')
      .toContain('shrink-0');
    expect(bar, 'a border came back — update SHELL_CHROME.topBarBorder').not.toContain('border-b');
    // h-12 is 3rem. Spelled out so the class and the value cannot drift apart.
    expect(SHELL_CHROME.topBar).toBe('3rem');
    expect(SHELL_CHROME.topBarBorder).toBe('0px');
  });

  it('the content area padding is the pair the derivation names', () => {
    // Read from the element itself rather than from a comment above it.
    const line = SHELL.split('\n').find((l) => l.includes('p-0 lg:p-6') && l.includes('flex-1'));
    expect(line, 'the content area no longer spells `p-0 lg:p-6`').toBeDefined();
    expect(line!, 'the content area lost its lg:pb-8').toContain('lg:pb-8');
    // lg:p-6 is 1.5rem; lg:pb-8 is 2rem and wins on the bottom edge.
    expect(SHELL_CHROME.contentPaddingTop).toBe('1.5rem');
    expect(SHELL_CHROME.contentPaddingBottom).toBe('2rem');
  });

  it('the three rem terms sum to what the class actually subtracts', () => {
    const rem = (v: string) => Number(v.replace('rem', ''));
    expect(
      rem(SHELL_CHROME.topBar) + rem(SHELL_CHROME.contentPaddingTop) + rem(SHELL_CHROME.contentPaddingBottom),
      'SHELL_CHROME_REM no longer equals the parts it is the sum of',
    ).toBe(SHELL_CHROME_REM);
    expect(SHELL_SCREEN_HEIGHT).toBe('lg:h-[calc(100dvh-6.5rem)]');
  });

  it('is gated at lg:, because below it the shell scrolls the page normally', () => {
    expect(SHELL_SCREEN_HEIGHT.startsWith('lg:')).toBe(true);
  });
});

describe('both full-height screens spend the shared height and no other', () => {
  const SCREENS = ['components/AdminDocs.tsx', 'components/AdminCommunity.tsx'];

  it.each(SCREENS)('%s takes SHELL_SCREEN_HEIGHT', (f) => {
    expect(read(f), `${f} does not spend the shared height`).toContain('SHELL_SCREEN_HEIGHT');
  });

  it('neither screen spells a viewport height of its own', () => {
    // The exact shape of the defect: a hand-written `calc(100dvh - Npx)` that
    // nothing derived. Comments are stripped first, since the ones in these
    // files explain the old value by quoting it.
    for (const f of SCREENS) {
      const code = read(f).replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, '');
      const invented = [...code.matchAll(/h-\[calc\(100d?vh[^\]]*\)\]/g)].map((m) => m[0]);
      expect(invented, `${f} invents its own viewport height again`).toEqual([]);
    }
  });

  it('nothing else in the app carries the old guessed constant', () => {
    // 140px was in two files and derived from nothing. If it reappears anywhere
    // it is a copy of the bug, not a coincidence.
    const offenders = ['components/AdminDocs.tsx', 'components/AdminCommunity.tsx', 'components/AdminDashboard.tsx']
      .filter((f) => /100d?vh\s*-\s*140px/.test(read(f)));
    expect(offenders, 'the 140px guess is back').toEqual([]);
  });
});
