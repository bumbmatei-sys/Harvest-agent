import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { DODO_BILLING_ENABLED } from '@/utils/plan-features';

/**
 * Test 7 — DODO_BILLING_ENABLED is false, and NO production code path reads it.
 *
 * This is the proof that the whole pull request changes nothing a real user
 * experiences. Everything else here — the catalogue, the provider, the webhook —
 * is inert precisely because nothing consults this switch and nothing calls into
 * the Dodo module. Signup still posts to /api/stripe/checkout and the Stripe
 * webhook is still the only thing that creates a tenant.
 *
 * Both halves are load-bearing, and they fail differently:
 *
 *  • `=== false` catches the flip.
 *  • The source scan catches something worse: a flag left false while a code path
 *    reads it anyway. That is how a "disabled" feature ships half-on, and it
 *    would mean this PR's inertness depended on a boolean rather than on nothing
 *    being wired up.
 */

const SRC = resolve(__dirname, '../../..');
const FLAG = 'DODO_BILLING_ENABLED';

/** Every .ts/.tsx file under src/. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
      continue;
    }
    if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const isTestFile = (path: string) => /__tests__|\.test\.tsx?$/.test(path);

describe('DODO_BILLING_ENABLED is off', () => {
  it('is false', () => {
    expect(DODO_BILLING_ENABLED).toBe(false);
  });

  it('is a literal `false` in plan-features.ts, not a computed or env-driven value', () => {
    // A switch derived from an environment variable is a switch that can be
    // flipped without a code review, which defeats the point of it being here.
    const source = readFileSync(join(SRC, 'utils/plan-features.ts'), 'utf8');
    expect(source).toMatch(/export const DODO_BILLING_ENABLED = false;/);
  });

  it('sits alongside the two flags it mirrors', () => {
    const source = readFileSync(join(SRC, 'utils/plan-features.ts'), 'utf8');
    for (const sibling of ['AI_TELEGRAM_ASSISTANT_ENABLED', 'AFFILIATE_PROGRAM_ENABLED']) {
      expect(source).toContain(`export const ${sibling} = false;`);
    }
  });
});

describe('no production code path reads DODO_BILLING_ENABLED', () => {
  it('is referenced only by its own declaration and by tests', () => {
    const readers = sourceFiles(SRC)
      .filter((file) => !isTestFile(file))
      .filter((file) => file !== join(SRC, 'utils/plan-features.ts'))
      .filter((file) => readFileSync(file, 'utf8').includes(FLAG))
      .map((file) => file.slice(SRC.length + 1));

    expect(
      readers,
      `${FLAG} is read by production code: ${readers.join(', ')}. Nothing may branch on ` +
        'it in this PR — the flag exists so the cutover (REP-4 PR 2) is one line, and a ' +
        'reader here means the module is already wired into a live path.',
    ).toEqual([]);
  });

  it('is not imported anywhere outside tests', () => {
    const importers = sourceFiles(SRC)
      .filter((file) => !isTestFile(file))
      .filter((file) => file !== join(SRC, 'utils/plan-features.ts'))
      .filter((file) => new RegExp(`import[^;]*\\b${FLAG}\\b[^;]*from`, 's').test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SRC.length + 1));

    expect(importers).toEqual([]);
  });
});

describe('the Dodo module is not wired into any live path', () => {
  it('is imported by nothing outside src/lib/dodo, /api/dodo and tests', () => {
    // The stronger claim behind the flag: even if someone flipped the boolean,
    // there is no call site for it to switch on. This is what makes the PR safe,
    // rather than the flag itself.
    const dodoLib = join(SRC, 'lib/dodo');
    const dodoRoute = join(SRC, 'app/api/dodo');

    const outsiders = sourceFiles(SRC)
      .filter((file) => !isTestFile(file))
      .filter((file) => !file.startsWith(dodoLib) && !file.startsWith(dodoRoute))
      .filter((file) => /from\s+['"](@\/lib\/dodo\/|\.\.?\/dodo\/)/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SRC.length + 1));

    expect(outsiders).toEqual([]);
  });

  it('leaves ChurchOnboarding posting to the Stripe checkout route', () => {
    // The tenant-creation constraint, restated where a Dodo change would break
    // it: the Stripe webhook is still the only thing that creates a tenant.
    const onboarding = readFileSync(join(SRC, 'components/ChurchOnboarding.tsx'), 'utf8');
    expect(onboarding).toContain("'/api/stripe/checkout'");
    expect(onboarding).not.toContain('/api/dodo');
    expect(onboarding).not.toMatch(/from\s+['"][^'"]*\/dodo\//);
  });
});
