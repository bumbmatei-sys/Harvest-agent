import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  PLAN_UPGRADE_SECTION,
  PLAN_FEATURES,
  R3_APPROVAL,
  acceptedDigests,
  reverseHunks,
  sha256Text,
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
 */

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const SUBJECTS: ReadonlyArray<RecordedExemption> = [PLAN_UPGRADE_SECTION, PLAN_FEATURES];

describe.each(SUBJECTS.map((s) => [s.file, s] as const))('%s', (_file, subject) => {
  const current = read(subject.file);

  it('is at the recorded digest', () => {
    expect(sha256Text(current)).toBe(subject.exemptDigest);
  });

  it('is the original pinned bytes plus exactly the recorded hunks', () => {
    const undone = reverseHunks(current, subject.hunks);
    expect(undone, 'a recorded hunk is missing from the file').not.toBeNull();
    expect(sha256Text(undone!)).toBe(subject.originalDigest);
  });

  it('carries the approval note', () => {
    expect(subject.approval).toBe(R3_APPROVAL);
    expect(subject.approval).toBe('Matei approved 2026-10-21: display-copy + compact prop only');
  });

  it('does not accept the original and the exempt digest as one value', () => {
    expect(new Set(acceptedDigests(subject)).size).toBe(2);
  });
});

describe('an edit outside the approved lines still fails the pin', () => {
  const plan = read(PLAN_UPGRADE_SECTION.file);
  const features = read(PLAN_FEATURES.file);

  /** The guard's own predicate: the digest must be one of the recorded values. */
  const passesPin = (subject: RecordedExemption, text: string) =>
    acceptedDigests(subject).includes(sha256Text(text));
  /** The exemption's own claim: undoing the hunks must give back the original. */
  const onlyApprovedHunks = (subject: RecordedExemption, text: string) => {
    const undone = reverseHunks(text, subject.hunks);
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
    ['a price', (t: string) => t.replace('monthly: 20,', 'monthly: 21,')],
    ['a trailing comment', (t: string) => `${t}\n// x\n`],
    ['a plan blurb next to the edited one', (t: string) => t.replace("'For small ministries growing as a team.'", "'For small campuses growing as a team.'")],
    ['the edited blurb itself', (t: string) => t.replace('For established campuses going deeper.', 'For established ministries going deeper.')],
  ])('plan-features: %s', (_name, mutate) => {
    const mutated = mutate(features);
    expect(mutated, 'the mutation did not change the file').not.toBe(features);
    expect(passesPin(PLAN_FEATURES, mutated)).toBe(false);
    expect(onlyApprovedHunks(PLAN_FEATURES, mutated)).toBe(false);
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
    ].map((d) => src.indexOf(`'${d}'`));
    expect(ORDER.every((i) => i > 0), 'a PlanUpgradeSection pin went missing').toBe(true);
    expect([...ORDER].sort((a, b) => a - b)).toEqual(ORDER);
  });

  it('the-291 records the same digests as the fixture', () => {
    expect(sources['the-291']).toContain(`'${PLAN_UPGRADE_SECTION.exemptDigest}'`);
    expect(sources['the-291']).toContain(`'${PLAN_FEATURES.exemptDigest}'`);
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
  });
});
