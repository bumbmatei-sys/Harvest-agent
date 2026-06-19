import { describe, it, expect } from 'vitest';
import { generateAccessCode } from '../ai-utils';

describe('generateAccessCode', () => {
  it('returns string starting with HARV-', () => {
    expect(generateAccessCode()).toMatch(/^HARV-/);
  });

  it('has correct total length (HARV- + 4 chars = 9)', () => {
    expect(generateAccessCode().length).toBe(9);
  });

  it('only contains non-ambiguous characters', () => {
    const allowed = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let i = 0; i < 50; i++) {
      const suffix = generateAccessCode().replace('HARV-', '');
      for (const ch of suffix) {
        expect(allowed).toContain(ch);
      }
    }
  });

  it('does not contain ambiguous characters (I, O, 0, 1)', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateAccessCode()).not.toMatch(/[IO01]/);
    }
  });

  it('generates unique codes', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateAccessCode()));
    expect(codes.size).toBe(100);
  });
});
