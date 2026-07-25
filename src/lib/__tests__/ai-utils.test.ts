import crypto from 'crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateAccessCode } from '../ai-utils';

describe('generateAccessCode', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  // The 4-char suffix is drawn from a 32-char alphabet, i.e. a 32^4 = 1,048,576
  // code space. A 100-sample draw from that space collides ~0.47% of the time
  // (birthday bound: 100*99 / (2*1,048,576)) — rare but real, which is exactly
  // what flaked once in CI (#224). Stub crypto.randomBytes so each draw is a
  // known, distinct input and uniqueness is asserted deterministically instead
  // of relying on chance.
  it('generates unique codes for distinct random input', () => {
    const spy = vi.spyOn(crypto, 'randomBytes');
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      // Only bytes[4..7] feed the returned suffix (see generateAccessCode);
      // encode i across bytes[6..7] so every draw maps to a distinct code.
      spy.mockReturnValueOnce(Buffer.from([0, 0, 0, 0, 0, 0, Math.floor(i / 32), i % 32]));
      codes.add(generateAccessCode());
    }
    expect(codes.size).toBe(100);
  });
});
