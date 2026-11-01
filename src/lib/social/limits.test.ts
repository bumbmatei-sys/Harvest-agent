import { describe, expect, it } from 'vitest';
import { characterCount, platformCounts, strictestLimit } from './limits';

describe("the composer's character counts (#581)", () => {
  it('counts what a reader sees: one per emoji or accented letter', () => {
    expect(characterCount('Amen 🙏')).toBe(6);
    expect(characterCount('café')).toBe(4);
  });
  it('reports each network against its own limit and flags going over', () => {
    expect(platformCounts('x'.repeat(501), ['threads', 'instagram'])).toEqual([
      { platform: 'threads', used: 501, limit: 500, over: true },
      { platform: 'instagram', used: 501, limit: 2200, over: false },
    ]);
  });
  it('takes the tightest limit among the chosen networks', () => {
    expect(strictestLimit(['facebook', 'threads', 'youtube'])).toBe(500);
    expect(strictestLimit([])).toBeNull();
  });
});
