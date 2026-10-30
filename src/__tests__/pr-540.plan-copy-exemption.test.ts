import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  PLAN_UPGRADE_SECTION,
  PLAN_FEATURES,
  R3_APPROVAL,
  R4_APPROVAL,
  R5_APPROVAL,
  R6_APPROVAL,
  acceptedDigests,
  currentDigest,
  reverseHunks,
  sha256Text,
  undoRecordedChain,
  type RecordedExemption,
} from './__fixtures__/plan-copy-exemption';
import UNTOUCHED from '../components/__tests__/__fixtures__/the-286-untouched.json';

/**
 * PR #540 round 3 — the plan-copy exemption is narrow, and the digest pins were only appended.
 *
 * PlanUpgradeSection.tsx is pinned byte-identical as money path (THE-286, THE-296, THE-300,
 * THE-291) and plan-features.ts by THE-291. Matei approved one edit on 2026-10-21: display copy
 * ("churches" -> "campuses") plus a `compact` prop used only by the settings popup. It is recorded
 * as the digest the file lands on, not as a skip, and these tests prove that:
 *
 *   1. the recorded hunks, undone, give back the original pinned bytes;
 *   2. an edit anywhere else (or inside a hunk) leaves both the accepted set and the hunk proof;
 *   3. the hunks spell no price, plan id, checkout, Dodo, entitlement or billing logic;
 *   4. every digest that was pinned before is still present in the guards.
 *
 * Round 4 is recorded the same way, as a successor on top of round 3: the scheduler on the
 * Ministry plan (one plan cell, its doc comment, and the plan card line derived from it), approved
 * by Matei on 2026-10-21. Round 3's digest, hunks and approval are untouched.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const SUBJECTS: ReadonlyArray<RecordedExemption> = [PLAN_UPGRADE_SECTION, PLAN_FEATURES];

describe.each(SUBJECTS.map((s) => [s.file, s] as const))('%s', (_file, subject) => {
  const current = read(subject.file);

  it('is at the latest recorded digest', () => {
    expect(sha256Text(current)).toBe(currentDigest(subject));
  });

  it('is the original pinned bytes plus exactly the recorded hunks, round by round', () => {
    const undone = undoRecordedChain(current, subject);
    expect(undone, 'a recorded hunk is missing from the file, or a digest in the chain does not hold').not.toBeNull();
    expect(sha256Text(undone!)).toBe(subject.originalDigest);
  });

  it('carries the approval notes', () => {
    expect(subject.approval).toBe(R3_APPROVAL);
    expect(subject.approval).toBe('Matei approved 2026-10-21: display-copy + compact prop only');
    // Round 4 is the first successor on both files. plan-features.ts gained a fifth
    // round (the quarterly term withdrawn, R5_APPROVAL), recorded after it. Round 6, the
    // two-plan repricing (R6_APPROVAL), is the last successor on both files.
    expect(subject.successors, 'rounds 4 and 6 are recorded as successors').toHaveLength(subject === PLAN_FEATURES ? 4 : 2);
    expect(subject.successors![0].approval).toBe(R4_APPROVAL);
    if (subject === PLAN_FEATURES) expect(subject.successors![1].approval).toBe(R5_APPROVAL);
    expect(subject.successors![subject === PLAN_FEATURES ? 2 : 1].approval).toBe(R6_APPROVAL);
    if (subject === PLAN_FEATURES) expect(subject.successors![3].approval).toBe('#557 Free shell entitlements');
    expect(R4_APPROVAL).toContain('Include the scheduler in the Ministry plan');
  });

  it('does not accept the original, round 3 and round 4 as one value', () => {
    const expected = 2 + subject.successors!.length;
    expect(acceptedDigests(subject)).toHaveLength(expected);
    expect(new Set(acceptedDigests(subject)).size).toBe(expected);
    expect(acceptedDigests(subject).slice(0, 2)).toEqual([subject.originalDigest, subject.exemptDigest]);
  });
});

describe('an edit outside the approved lines still fails the pin', () => {
  const plan = read(PLAN_UPGRADE_SECTION.file);
  const features = read(PLAN_FEATURES.file);

  /** The guard's own predicate: the digest must be one of the recorded values. */
  const passesPin = (subject: RecordedExemption, text: string) =>
    acceptedDigests(subject).includes(sha256Text(text));
  /** The exemption's own claim: undoing the recorded rounds must give back the original. */
  const onlyApprovedHunks = (subject: RecordedExemption, text: string) => {
    const undone = undoRecordedChain(text, subject);
    return undone !== null && sha256Text(undone) === subject.originalDigest;
  };

  it('control: the unmutated files pass both', () => {
    expect(passesPin(PLAN_UPGRADE_SECTION, plan)).toBe(true);
    expect(onlyApprovedHunks(PLAN_UPGRADE_SECTION, plan)).toBe(true);
    expect(passesPin(PLAN_FEATURES, features)).toBe(true);
    expect(onlyApprovedHunks(PLAN_FEATURES, features)).toBe(true);
  });

  const outside: ReadonlyArray<readonly [string, (t: string) => string]> = [
    ['a trailing comment', (t) => `${t}\n// x\n`],
    ['the plan-change call', (t) => t.replace('runDodoPlanChange(', 'runDodoPlanChange2(')],
    ['the price formatter', (t) => t.replace('formatPlanPrice(planId, billingPeriod)', 'formatPlanPrice(planId, "monthly")')],
    ['the billing portal route', (t) => t.replace("'/api/stripe/portal'", "'/api/stripe/portal2'")],
    ['the refresh window', (t) => t.replace('armPlanRefresh()', 'void 0')],
    ['the recommended flag', (t) => t.replace("isRecommended = !!meta.recommended", 'isRecommended = false')],
    ['a feature label next to the campus line', (t) => t.replace("label: 'Church Map'", "label: 'Campus Map'")],
  ];

  it.each(outside)('PlanUpgradeSection: %s', (_name, mutate) => {
    const mutated = mutate(plan);
    expect(mutated, 'the mutation did not change the file').not.toBe(plan);
    expect(passesPin(PLAN_UPGRADE_SECTION, mutated), 'the pin accepted an unrecorded edit').toBe(false);
    expect(onlyApprovedHunks(PLAN_UPGRADE_SECTION, mutated), 'the hunk proof accepted an unrecorded edit').toBe(false);
  });

  it.each([
    ['campuses back to churches', (t: string) => t.replace("['campus', 'campuses']", "['church', 'churches']")],
    ['a changed compact style', (t: string) => t.replace("gridTemplateColumns: 'minmax(0, 1fr)'", "gridTemplateColumns: '1fr 1fr'")],
    ['a changed Manage handler', (t: string) => t.replace('onClick={handleManageSubscription}\n              disabled', 'onClick={() => {}}\n              disabled')],
  ])('PlanUpgradeSection: an edit INSIDE an approved hunk also fails (%s)', (_name, mutate) => {
    const mutated = mutate(plan);
    expect(mutated).not.toBe(plan);
    expect(passesPin(PLAN_UPGRADE_SECTION, mutated)).toBe(false);
    expect(onlyApprovedHunks(PLAN_UPGRADE_SECTION, mutated)).toBe(false);
  });

  it.each([
    ['a price', (t: string) => t.replace('monthly: 30,', 'monthly: 31,')],
    ['a trailing comment', (t: string) => `${t}\n// x\n`],
    ['a plan blurb next to the edited one', (t: string) => t.replace("'For a ministry running one community.'", "'For a ministry running one campus.'")],
    ['the Ministry blurb itself', (t: string) => t.replace('For ministries with many communities and campuses.', 'For ministries with many communities.')],
  ])('plan-features: %s', (_name, mutate) => {
    const mutated = mutate(features);
    expect(mutated, 'the mutation did not change the file').not.toBe(features);
    expect(passesPin(PLAN_FEATURES, mutated)).toBe(false);
    expect(onlyApprovedHunks(PLAN_FEATURES, mutated)).toBe(false);
  });
});

describe('round 4 is one plan cell, its doc comment and the card line derived from it', () => {
  const plan = read(PLAN_UPGRADE_SECTION.file);
  const features = read(PLAN_FEATURES.file);
  const passesPin = (subject: RecordedExemption, text: string) =>
    acceptedDigests(subject).includes(sha256Text(text));
  const onlyApprovedHunks = (subject: RecordedExemption, text: string) => {
    const undone = undoRecordedChain(text, subject);
    return undone !== null && sha256Text(undone) === subject.originalDigest;
  };

  it('Ministry has the cell, and no other tier does', () => {
    const ministryRow = features.slice(features.indexOf('  ministry: {'));
    expect(ministryRow).toMatch(/socialScheduler: true,\n\s*\},\n\};/);
    expect(features.match(/socialScheduler: true,/g) ?? [], 'another tier gained the cell').toHaveLength(1);
  });

  it.each([
    ['the cell flipped on another tier', (t: string) => t.replace('socialScheduler: false,', 'socialScheduler: true,')],
    ['a price next to it', (t: string) => t.replace('monthly: 30,', 'monthly: 31,')],
    ['the Ministry cell turned back off', (t: string) => t.replace('socialScheduler: true,', 'socialScheduler: false,')],
  ])('plan-features: %s fails the pin and the chain', (_name, mutate) => {
    const mutated = mutate(features);
    expect(mutated).not.toBe(features);
    expect(passesPin(PLAN_FEATURES, mutated)).toBe(false);
    expect(onlyApprovedHunks(PLAN_FEATURES, mutated)).toBe(false);
  });

  it.each([
    ['the scheduler line relabelled', (t: string) => t.replace("label: 'Social Scheduler'", "label: 'Scheduler'")],
    ['a second new line', (t: string) => t.replace("  { key: 'socialScheduler', label: 'Social Scheduler' },\n", "  { key: 'socialScheduler', label: 'Social Scheduler' },\n  { key: 'aiChat', label: 'x' },\n")],
  ])('PlanUpgradeSection: %s fails the pin and the chain', (_name, mutate) => {
    const mutated = mutate(plan);
    expect(mutated).not.toBe(plan);
    expect(passesPin(PLAN_UPGRADE_SECTION, mutated)).toBe(false);
    expect(onlyApprovedHunks(PLAN_UPGRADE_SECTION, mutated)).toBe(false);
  });

  it('the round-4 hunks name no price, plan id, checkout, Dodo or billing call', () => {
    const money = new RegExp(
      ['\\$\\d', 'PLAN_' + 'PRICING', 'format' + 'PlanPrice', 'run' + 'DodoPlanChange', 'check' + 'out',
        'dod' + 'o', 'stri' + 'pe', 'auth' + 'Fetch', 'fet' + 'ch\\(', 'plan' + 'Id', 'TERM_' + 'MONTHS'].join('|'),
      'i',
    );
    for (const subject of [PLAN_UPGRADE_SECTION, PLAN_FEATURES]) {
      for (const hunk of subject.successors![0].hunks) {
        expect(hunk.after, subject.file).not.toMatch(money);
      }
    }
  });
});

describe('the hunks are display copy and a layout prop, nothing else', () => {
  // Assembled from fragments so this file does not match its own needles.
  const MONEY = new RegExp(
    [
      '\\$\\d',
      'PLAN_' + 'PRICING',
      'format' + 'PlanPrice',
      'format' + 'PlanMonthlyHeadline',
      'run' + 'DodoPlanChange',
      'start' + 'FirstSubscription',
      'check' + 'out',
      'dod' + 'o',
      'stri' + 'pe',
      'auth' + 'Fetch',
      'fet' + 'ch\\(',
      'update' + 'Doc',
      'set' + 'Doc',
      'entit' + 'le',
      'plan' + 'Id',
      'TERM_' + 'MONTHS',
    ].join('|'),
    'i',
  );

  it.each(
    SUBJECTS.flatMap((s) => s.hunks.map((h, i) => [`${path.basename(s.file)} hunk ${i + 1}`, h] as const)),
  )('%s names no price, plan id, checkout, Dodo, entitlement or billing call', (_name, hunk) => {
    // The Manage hunk may name the handler that already existed; it is not a billing line itself.
    const added = hunk.after.split(hunk.before).join('').replace(/handleManageSubscription/g, '');
    expect(added).not.toMatch(MONEY);
  });

  it('plan-features changes one string and one TODO line', () => {
    expect(PLAN_FEATURES.hunks).toHaveLength(1);
    expect(PLAN_FEATURES.hunks[0].after.split('\n')).toHaveLength(2);
  });

  it('PlanUpgradeSection has exactly seven hunks, and the recorded count is part of the proof', () => {
    expect(PLAN_UPGRADE_SECTION.hunks).toHaveLength(7);
  });
});

describe('the guard digests were only appended', () => {
  const sources = {
    'the-291': read('src/__tests__/the-291-client-plan-write.test.ts'),
    'THE-286': read('src/components/__tests__/THE-286.settings-chrome-autosave.test.tsx'),
    'THE-296': read('src/components/__tests__/THE-296.settings-sections.test.tsx'),
    'THE-300': read('src/components/__tests__/THE-300.billing-surface.test.tsx'),
  };

  it('the-291 still lists every plan-features digest it ever pinned, in order, with the new one last', () => {
    const src = sources['the-291'];
    const ORDER = [
      '9b1be3db2c7287216084f46fb1dc15c8caff3d680f0dbb9d53db2ea59d564a92',
      '36f2b6c26662c4a5d95e7de4b15b8482a190c54a134f08c104fc209806352d5c',
      PLAN_FEATURES.originalDigest,
      PLAN_FEATURES.exemptDigest,
      ...(PLAN_FEATURES.successors ?? []).map((x) => x.digest),
    ].map((d) => src.indexOf(`'${d}'`));
    expect(ORDER.every((i) => i > 0), 'a plan-features pin went missing').toBe(true);
    expect([...ORDER].sort((a, b) => a - b)).toEqual(ORDER);
  });

  it('the-291 still lists every PlanUpgradeSection digest it ever accepted, with the new one appended', () => {
    const src = sources['the-291'];
    const ORDER = [
      '47311df03e1ca76cb51e5094360c2ef868e14f1d9bb6c70509a48fdff174a553',
      PLAN_UPGRADE_SECTION.originalDigest,
      PLAN_UPGRADE_SECTION.exemptDigest,
      ...(PLAN_UPGRADE_SECTION.successors ?? []).map((x) => x.digest),
    ].map((d) => src.indexOf(`'${d}'`));
    expect(ORDER.every((i) => i > 0), 'a PlanUpgradeSection pin went missing').toBe(true);
    expect([...ORDER].sort((a, b) => a - b)).toEqual(ORDER);
  });

  it('the-291 records the same digests as the fixture', () => {
    for (const subject of [PLAN_UPGRADE_SECTION, PLAN_FEATURES]) {
      for (const digest of acceptedDigests(subject).slice(1)) {
        expect(sources['the-291']).toContain(`'${digest}'`);
      }
    }
  });

  it('the THE-286 fixture still pins the original PlanUpgradeSection digest, unreplaced', () => {
    expect(UNTOUCHED.otherSettingsSections[PLAN_UPGRADE_SECTION.file as keyof typeof UNTOUCHED.otherSettingsSections])
      .toBe(PLAN_UPGRADE_SECTION.originalDigest);
  });

  it('THE-286 and THE-296 append their entry after the existing ones and still compare by digest', () => {
    const t286 = sources['THE-286'];
    expect(t286.indexOf("'THE-111 src/components/settings/BrandingSection.tsx'"))
      .toBeLessThan(t286.indexOf("'PR-540 src/components/settings/PlanUpgradeSection.tsx'"));
    expect(t286).toContain('if (EXEMPT.includes(rel) && !(rel in SCOPED_DIGESTS)) return;');
    const t296 = sources['THE-296'];
    expect(t296.indexOf("'THE-300 src/components/settings/BillingTermToggle.tsx',\n      'PR-540"))
      .toBeGreaterThan(0);
    expect(t296).toContain('if (file in SCOPED_DIGESTS)');
    expect(sources['THE-300']).toContain('acceptedDigests(PLAN_UPGRADE_SECTION)');
    // Round 4: the scoped checks accept any recorded digest, so round 3's value was not substituted.
    const acceptsAny = /acceptedDigests\(PLAN_UPGRADE_SECTION\)[\s\S]{0,200}\.toContain\(/;
    expect(t286).toMatch(acceptsAny);
    expect(t296).toMatch(acceptsAny);
  });
});
