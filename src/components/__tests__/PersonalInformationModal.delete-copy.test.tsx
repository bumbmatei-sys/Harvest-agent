import React, { act } from 'react';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

/**
 * 🔴 THE-230 — THE DELETE CONFIRMATION TOLD MEMBERS A FALSEHOOD.
 *
 * At the irreversible tap, the confirm panel said:
 *
 *   "This deletes your profile and your sign-in. Records your ministry holds —
 *    giving history, event registrations, check-ins, prayer requests and
 *    community posts — stay in their records; ask an admin to remove those."
 *
 * Four of those five are `disposition: 'delete'` in MEMBER_DATA_MAP. The copy
 * promised RETENTION for data that is DESTROYED — the direction of that lie
 * that cannot be taken back, because a member who wanted their posts to stay
 * for the church, and accepted deletion on that basis, has already lost them.
 *
 * It was true when written: the route removed `users/{uid}` and the Auth
 * account and nothing else. PR 354 made the route run `eraseMemberData` across
 * the whole map and nobody walked back down to the sentence — which is what a
 * hand-written list beside a machine-read map does, every time.
 *
 * ⚠️ THE ASSERTIONS THAT ENCODE THE DEFECT, each failing BY NAME:
 *   - 'the copy claims nothing stays that the map deletes' — the exact defect.
 *     Restoring the old sentence, or moving any deleted collection's wording
 *     under a "kept" heading, fails THAT test by the collection's name.
 *   - 'adding an entry to the map without wording it fails by name' — the
 *     recurrence guard. A new sweep with no member-facing words cannot ship.
 *   - 'flipping a disposition in the map moves its wording to another heading'
 *     — the copy follows the map with no edit to the copy.
 *   - 'the shipped copy is exactly what the map derives' — the constant the
 *     client renders is a cache of the derivation, and is proven so in-process.
 *
 * Nothing here re-derives the map from source text and nothing shells out; the
 * real MEMBER_DATA_MAP is imported and read.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../firebase', () => ({
  auth: {
    currentUser: {
      uid: 'u1', email: 'member@church.org', displayName: 'Sarah Whitfield', photoURL: null,
      providerData: [{ providerId: 'password' }],
    },
  },
  db: {},
}));
vi.mock('firebase/auth', () => ({
  updateProfile: vi.fn(async () => {}),
  updatePassword: vi.fn(),
  signOut: vi.fn(),
  EmailAuthProvider: { credential: vi.fn() },
  reauthenticateWithCredential: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  updateDoc: vi.fn(async () => {}),
}));
vi.mock('../../utils/firestore-errors', () => ({ OperationType: { GET: 'GET', UPDATE: 'UPDATE' }, handleFirestoreError: () => {} }));
vi.mock('../../utils/auth-fetch', () => ({ authFetch: async () => ({ ok: true, json: async () => ({}) }) }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('../CountrySelect', () => ({
  default: (props: { buttonClassName?: string }) => <button className={props.buttonClassName} />,
}));

// The map is server-side (firebase-admin at import time), so it is mocked the
// same way member-erasure.test.ts mocks it — the MAP itself is the real one.
vi.mock('@/lib/firebase-admin', async () => {
  const m = await import('@/test/mocks/firestore-tree');
  return { adminDb: m.adminDb, adminAuth: m.adminAuth, getReceiptsBucket: m.getReceiptsBucket };
});
vi.mock('firebase-admin/firestore', async () => {
  const m = await import('@/test/mocks/firestore-tree');
  return { FieldValue: m.FieldValue };
});

import PersonalInformationModal from '../PersonalInformationModal';
const { MEMBER_DATA_MAP } = await import('@/lib/member-erasure');
type MapEntry = (typeof MEMBER_DATA_MAP)[number];
const {
  MEMBER_COPY_LABELS, DELETE_CONFIRM_COPY, ERASURE_CATEGORIES, UNREACHABLE_NOTE,
  deriveErasureCopy, assertCopyCoversMap, copyLabelFor,
} = await import('@/lib/member-erasure-copy');

const ROOT = path.resolve(__dirname, '../../..');
const GLOBALS = path.join(ROOT, 'src/app/globals.css');
const MODAL_SRC = readFileSync(path.join(__dirname, '../PersonalInformationModal.tsx'), 'utf8');

/**
 * Derived lazily and memoised. ⚠️ NOT a module-level constant: `deriveErasureCopy`
 * throws by name when the map and the wording disagree, and at module level that
 * throw takes the whole file down — including the no-regression tests that say
 * whether the map itself moved. Behind a function, the same throw surfaces as a
 * named test failure and everything else still reports.
 */
let memo: ReturnType<typeof deriveErasureCopy> | null = null;
const derived = (): ReturnType<typeof deriveErasureCopy> => (memo ??= deriveErasureCopy(MEMBER_DATA_MAP));
const groupFor = (d: string) => {
  const g = derived().groups.find((x) => x.disposition === d);
  expect(g, `the derivation produced no ${d} group`).toBeDefined();
  return g!;
};
const labelsWithDisposition = (d: string) =>
  [...new Set(MEMBER_DATA_MAP.filter((e) => e.disposition === d).map(copyLabelFor))];

// ═══════════════════════════════════════════════════════════════════════════
// 1-3 · every collection the map acts on is covered by its own category
// ═══════════════════════════════════════════════════════════════════════════

describe('the three categories cover the map, derived rather than hand-listed', () => {
  it('every collection the map deletes is covered by the deleted category', () => {
    const deleted = MEMBER_DATA_MAP.filter((e) => e.disposition === 'delete');
    expect(deleted.length, 'the map deletes nothing — the scan is broken').toBeGreaterThan(0);
    const items = groupFor('delete').items;
    for (const entry of deleted) {
      expect(items, `${entry.collection} is deleted and the DELETED list does not cover it`)
        .toContain(copyLabelFor(entry));
    }
  });

  it('every collection the map anonymises is covered by the anonymised category', () => {
    const anonymised = MEMBER_DATA_MAP.filter((e) => e.disposition === 'anonymise');
    expect(anonymised.length, 'the map anonymises nothing — the scan is broken').toBeGreaterThan(0);
    const items = groupFor('anonymise').items;
    for (const entry of anonymised) {
      expect(items, `${entry.collection} is anonymised and the ANONYMISED list does not cover it`)
        .toContain(copyLabelFor(entry));
    }
  });

  it('every collection the map retains is covered by the retained category', () => {
    const retained = MEMBER_DATA_MAP.filter((e) => e.disposition === 'retain');
    expect(retained.length, 'the map retains nothing — the scan is broken').toBeGreaterThan(0);
    const items = groupFor('retain').items;
    for (const entry of retained) {
      expect(items, `${entry.collection} is retained and the RETAINED list does not cover it`)
        .toContain(copyLabelFor(entry));
    }
  });

  it('the shipped copy is exactly what the map derives', () => {
    // DELETE_CONFIRM_COPY is a cache, because the client cannot import a module
    // that pulls firebase-admin. This is what stops it being a second list.
    expect(
      DELETE_CONFIRM_COPY,
      'DELETE_CONFIRM_COPY has drifted from the map. Replace it with the derived value printed above.',
    ).toEqual(derived());
  });

  it('the wording table is exactly the map, in both directions', () => {
    expect(() => assertCopyCoversMap(MEMBER_DATA_MAP)).not.toThrow();
    expect(new Set(Object.keys(MEMBER_COPY_LABELS))).toEqual(new Set(MEMBER_DATA_MAP.map((e) => e.collection)));
  });

  it('30 map entries are grouped into three readable categories, not thirty rows', () => {
    expect(MEMBER_DATA_MAP.length).toBe(30);
    expect(derived().groups.map((g) => g.disposition)).toEqual(['delete', 'anonymise', 'retain']);
    // Deduping is what makes this readable: 19 delete entries, far fewer phrases.
    expect(groupFor('delete').items.length).toBeLessThan(
      MEMBER_DATA_MAP.filter((e) => e.disposition === 'delete').length,
    );
    for (const group of derived().groups) {
      expect(new Set(group.items).size, `${group.disposition} repeats a phrase`).toBe(group.items.length);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · THE EXACT DEFECT
// ═══════════════════════════════════════════════════════════════════════════

describe('the copy claims nothing stays that the map deletes', () => {
  /** The five things the old sentence named as staying. Four were deleted. */
  const OLD_SENTENCE_CLAIMED_KEPT = [
    'giving history', 'event registrations', 'check-ins', 'prayer requests', 'community posts',
  ];

  it('no phrase for a deleted collection appears under a heading that says it is kept', () => {
    const deletedPhrases = new Set(labelsWithDisposition('delete'));
    expect(deletedPhrases.size, 'no deleted phrases — the scan is broken').toBeGreaterThan(0);
    for (const group of derived().groups) {
      if (group.disposition === 'delete') continue;
      for (const item of group.items) {
        expect(
          deletedPhrases.has(item),
          `"${item}" is printed under "${group.heading}" but the map DELETES the collection it stands for`,
        ).toBe(false);
      }
    }
  });

  it('the rendered panel puts every deleted phrase under DELETED and under no other heading', () => {
    const sections = renderedSections();
    const deleted = sections.get(groupFor('delete').heading);
    expect(deleted, 'the DELETED section did not render').toBeDefined();
    for (const phrase of labelsWithDisposition('delete')) {
      expect(deleted!, `"${phrase}" is deleted but is missing from the DELETED section`).toContain(phrase);
      for (const [heading, text] of sections) {
        if (heading === groupFor('delete').heading) continue;
        expect(text, `"${phrase}" is deleted but also appears under "${heading}"`).not.toContain(phrase);
      }
    }
  });

  it('the old sentence cannot come back — nothing rendered says the deleted five stay', () => {
    const text = renderedPanelText();
    expect(text).not.toContain('stay in their records');
    expect(text).not.toContain('ask an admin to remove those');
    // Each of the four the old sentence got wrong must now read as deleted.
    const deletedSection = renderedSections().get(groupFor('delete').heading)!;
    for (const subject of ['event registrations', 'check-ins', 'prayer requests', 'posts']) {
      expect(
        deletedSection,
        `the old sentence said "${subject}" stays; the map deletes it, so it must appear under DELETED`,
      ).toContain(subject);
    }
    // Giving history is the one the old sentence got right in direction and
    // wrong in kind: it is anonymised, not simply "kept in their records".
    expect(OLD_SENTENCE_CLAIMED_KEPT).toHaveLength(5);
    const anonymised = renderedSections().get(groupFor('anonymise').heading)!;
    expect(anonymised).toContain('giving history');
  });

  it('"anonymised" reads as neither of the other two', () => {
    const category = ERASURE_CATEGORIES.find((c) => c.disposition === 'anonymise')!;
    const said = `${category.heading} ${category.blurb}`.toLowerCase();
    // Not "deleted": it must state survival.
    expect(said).toMatch(/kept|still exist/);
    expect(category.heading.toLowerCase()).not.toMatch(/\bdeleted\b|\berased\b|\bremoved\b/);
    // Not "kept about you": it must state that the identity is gone.
    expect(said).toMatch(/name/);
    expect(said).toMatch(/no longer point to you|taken off|replaced/);
    // And it must not be confusable with the retain blurb.
    const retain = ERASURE_CATEGORIES.find((c) => c.disposition === 'retain')!;
    expect(category.heading).not.toBe(retain.heading);
    expect(category.blurb).not.toBe(retain.blurb);
  });

  it('the gap collections are declared, not quietly filed under "kept"', () => {
    // THE-188's unkeyed entries: retained by FORCE, not by choice. A member told
    // to "ask an admin" about them would be sent on an errand that cannot work.
    const unkeyed = MEMBER_DATA_MAP.filter((e) => e.unkeyed && e.unkeyed.length > 0);
    expect(unkeyed.length, 'the map declares no gaps — THE-188 regressed').toBe(2);
    expect(derived().unreachable).toEqual(unkeyed.map(copyLabelFor));
    const text = renderedPanelText();
    expect(text).toContain(UNREACHABLE_NOTE);
    for (const entry of unkeyed) {
      expect(text, `${entry.collection} is unreachable and the panel does not say so`)
        .toContain(copyLabelFor(entry));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5-6 · mutation — the tests that stop the recurrence
// ═══════════════════════════════════════════════════════════════════════════

describe('the copy cannot fall behind the map', () => {
  it('adding an entry to the map without wording it fails by name', () => {
    const mutated: MapEntry[] = [
      ...MEMBER_DATA_MAP,
      {
        collection: 'tenants/{t}/smallGroupAttendance',
        disposition: 'delete',
        holds: 'uid, name, email',
        reason: 'A collection added after the copy was written.',
      },
    ];
    expect(() => assertCopyCoversMap(mutated)).toThrowError(/tenants\/\{t\}\/smallGroupAttendance/);
    expect(() => deriveErasureCopy(mutated)).toThrowError(/no wording for 1 collection/);
  });

  it('removing wording for a collection the map still acts on fails by name', () => {
    const victim = 'tenants/{t}/registrations';
    const saved = MEMBER_COPY_LABELS[victim];
    delete MEMBER_COPY_LABELS[victim];
    try {
      expect(() => assertCopyCoversMap(MEMBER_DATA_MAP)).toThrowError(new RegExp(victim.replace(/[{}/]/g, '\\$&')));
    } finally {
      MEMBER_COPY_LABELS[victim] = saved;
    }
    expect(() => assertCopyCoversMap(MEMBER_DATA_MAP)).not.toThrow();
  });

  it('wording a collection the map does not enumerate fails by name', () => {
    MEMBER_COPY_LABELS['tenants/{t}/inventedCollection'] = 'something nobody sweeps';
    try {
      expect(() => assertCopyCoversMap(MEMBER_DATA_MAP)).toThrowError(/inventedCollection/);
    } finally {
      delete MEMBER_COPY_LABELS['tenants/{t}/inventedCollection'];
    }
  });

  it('flipping a disposition in the map moves its wording to another heading', () => {
    const victim = 'community_posts';
    const before = deriveErasureCopy(MEMBER_DATA_MAP);
    const phrase = copyLabelFor(MEMBER_DATA_MAP.find((e) => e.collection === victim)!);
    expect(before.groups.find((g) => g.disposition === 'delete')!.items).toContain(phrase);

    // Flip delete -> retain. The other three collections sharing the phrase keep
    // their own disposition, so the phrase must now print under BOTH headings —
    // which assertCopyCoversMap refuses, because a member cannot tell those two
    // apart. Either way the copy cannot stay as it is.
    const mutated: MapEntry[] = MEMBER_DATA_MAP.map((e) =>
      e.collection === victim ? { ...e, disposition: 'retain' as const } : e,
    );
    expect(() => deriveErasureCopy(mutated)).toThrowError(/more than one heading/);

    // And with a phrase used by exactly one collection, the move is silent and
    // complete: it leaves DELETED and arrives in RETAINED, with no edit here.
    const soloVictim = 'certificates';
    const soloPhrase = copyLabelFor(MEMBER_DATA_MAP.find((e) => e.collection === soloVictim)!);
    const solo = deriveErasureCopy(
      MEMBER_DATA_MAP.map((e) => (e.collection === soloVictim ? { ...e, disposition: 'retain' as const } : e)),
    );
    expect(solo.groups.find((g) => g.disposition === 'delete')!.items).not.toContain(soloPhrase);
    expect(solo.groups.find((g) => g.disposition === 'retain')!.items).toContain(soloPhrase);
    expect(solo).not.toEqual(before);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7-8 · no-regression: the map and the delete flow are untouched
// ═══════════════════════════════════════════════════════════════════════════

describe('this ticket changed what the product says, not what it does', () => {
  /**
   * The map as it stands on main, pinned in-process. Nothing here shells out to
   * `git show`: a test that reads the repository at assertion time is testing
   * git, and cannot run on a checkout that has no history.
   */
  const MAP_PIN: ReadonlyArray<[string, string, boolean, readonly string[] | null]> = [
    ['community_posts', 'delete', true, null],
    ['community_posts/{id}/comments', 'delete', true, null],
    ['prayer_requests', 'delete', true, null],
    ['community_posts.eventDetails', 'delete', true, null],
    ['community_posts.likes', 'delete', true, null],
    ['prayer_requests.prayedBy', 'delete', true, null],
    ['certificates', 'delete', true, null],
    ['chat_usage', 'delete', true, null],
    ['platform_inbox', 'delete', true, null],
    ['contacts', 'delete', true, null],
    ['contactActivities', 'delete', true, null],
    ['tenants/{t}/registrations', 'delete', true, null],
    ['tenants/{t}/checkinSessions/{id}/attendees', 'delete', true, null],
    ['tenants/{t}/forms/{id}/submissions', 'delete', true, null],
    ['tenants/{t}/livestreamSessions/{id}/comments', 'delete', true, null],
    ['tenants/{t}/dmMessages + channelMessages', 'delete', true, null],
    ['tenants/{t}/channels.members', 'delete', true, null],
    ['tenants/{t}/integrations', 'delete', true, null],
    // ⚠️ `users` is the one acted-on entry with NO sweep: the route deletes it
    // itself, after every sweep above reports clean.
    ['users', 'delete', false, null],
    ['tenants/{t}/invoices', 'anonymise', true, null],
    ['tenants/{t}/givingStatements', 'anonymise', true, null],
    ['tenants/{t}/pledges', 'anonymise', true, null],
    ['tenants/{t}/directMessages', 'anonymise', true, null],
    ['tenants/{t}/canvases', 'anonymise', true, null],
    ['churches', 'anonymise', true, null],
    ['contactActivities (type: donation)', 'retain', false, null],
    ['affiliate_commissions', 'retain', false, null],
    ['blog_posts / courses / docs / docFolders / campaigns / events / newsletters / adoptedCourses', 'retain', false, null],
    ['tenants/{t}/livestreamSessions/{id}/prayers', 'retain', false, ['tenants/{t}/livestreamSessions/{id}/prayers']],
    ['tenants/{t}/smsLogs + smsBroadcasts/{id}/logs', 'retain', false, ['tenants/{t}/smsLogs', 'tenants/{t}/smsBroadcasts/{id}/logs']],
  ];

  it('no disposition, sweep or map entry changed', () => {
    const actual = MEMBER_DATA_MAP.map((e) => [
      e.collection, e.disposition, typeof e.sweep === 'function', e.unkeyed ?? null,
    ]);
    expect(actual).toEqual(MAP_PIN.map((r) => [r[0], r[1], r[2], r[3]]));
  });

  it('the copy module is safe to import from the browser', () => {
    const src = readFileSync(path.join(ROOT, 'src/lib/member-erasure-copy.ts'), 'utf8');
    // 🔴 ITS ONLY IMPORT IS A TYPE. `import type` is erased at build; a value
    // import from member-erasure.ts would drag firebase-admin — which calls
    // initializeApp with a service-account key at module scope — into the
    // client bundle of a `"use client"` component.
    const imports = src.match(/^\s*import[\s{].*$/gm) ?? [];
    expect(imports).toEqual(["import type { Disposition, MemberDataEntry } from '@/lib/member-erasure';"]);
    expect(src, 'a require() would defeat the type-only import').not.toMatch(/\brequire\s*\(/);
    // It decides words, never writes. (`Map.prototype.set` is not a write to
    // anything — the Firestore surface is what must be absent.)
    for (const forbidden of [
      /\badminDb\b/, /\bFieldValue\b/, /\bdeleteByQuery\b/, /\banonymiseByQuery\b/,
      /\.collection\(/, /\.doc\(/, /\bbatch\(/,
    ]) {
      expect(src, `member-erasure-copy.ts must not reference ${forbidden.source}`).not.toMatch(forbidden);
    }
  });

  it("the delete flow's outcome messages are unchanged", () => {
    const OUTCOMES = [
      'You are not signed in. Sign in again and retry.',
      'Could not reach the server. Check your connection and try again.',
      'Your account and sign-in have been deleted. Signing you out now.',
      'For your security, confirm your password to finish deleting your account.',
      'For your security, this needs a recent sign-in. Sign out, sign back in, and delete your account within a few minutes.',
      'Your account could not be deleted. Please try again, or contact your ministry admin if this keeps happening.',
      'Enter your password to continue.',
      'Incorrect password. Try again.',
    ];
    for (const message of OUTCOMES) {
      expect(MODAL_SRC, `the silent-failure fix lost an outcome message: ${message}`).toContain(message);
    }
    // The flow itself, and the states it moves through.
    for (const symbol of [
      'handleDeleteAccount', 'handleReauthAndDelete', 'resetDeleteFlow',
      "setDeleteState('reauth')", "setDeleteState('deleting')", "setDeleteState('done')", "setDeleteState('error')",
      'role="alert"', 'aria-label="Password"',
    ]) {
      expect(MODAL_SRC, `the delete flow lost ${symbol}`).toContain(symbol);
    }
    // Every message is still RENDERED — the whole point of the fix.
    expect(MODAL_SRC).toContain('{deleteMessage}');
  });

  it('the copy is rendered from the derivation, never typed into the component', () => {
    expect(MODAL_SRC).toContain('DELETE_CONFIRM_COPY.groups.map');
    // No literal phrase from the copy may be spelled in the component.
    for (const group of derived().groups) {
      // Word-bounded: "Deleted" is a substring of the `documentDeleted` field
      // on the route's response, which is the delete FLOW and not the copy.
      const asWords = new RegExp(`\\b${group.heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      expect(MODAL_SRC, `"${group.heading}" is typed into the component instead of derived`)
        .not.toMatch(asWords);
      for (const item of group.items) {
        expect(MODAL_SRC, `"${item}" is typed into the component instead of derived`).not.toContain(item);
      }
    }
    expect(MODAL_SRC).not.toContain(UNREACHABLE_NOTE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9-10 · it has to render, in four palettes and on a 380px phone
// ═══════════════════════════════════════════════════════════════════════════

function mount(el: React.ReactElement): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { createRoot(container).render(el); });
  return container;
}

/** Open the confirm panel — the copy only exists once the member taps Delete. */
function openConfirm(): HTMLElement {
  const host = mount(<PersonalInformationModal isOpen onClose={() => {}} />);
  const trigger = Array.from(host.querySelectorAll('button'))
    .find((b) => (b.textContent ?? '').trim() === 'Delete Account');
  expect(trigger, 'no Delete Account button').toBeDefined();
  act(() => { trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  return host;
}

/** The confirm panel's element — the red card holding the derived copy. */
function panel(host: HTMLElement): HTMLElement {
  const el = Array.from(host.querySelectorAll('div'))
    .find((d) => (d.textContent ?? '').includes('Are you sure? This cannot be undone.')
      && d.className.includes('rounded-2xl'));
  expect(el, 'the confirm panel did not open').toBeDefined();
  return el!;
}

/** The derived copy block inside it. */
function copyBlock(host: HTMLElement): HTMLElement {
  const el = Array.from(panel(host).querySelectorAll('div'))
    .find((d) => (d.textContent ?? '').includes(derived().groups[0].heading) && d.className.includes('flex-col'));
  expect(el, 'the derived copy block did not render').toBeDefined();
  return el!;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
function renderedPanelText(): string {
  const host = openConfirm();
  const text = norm(panel(host).textContent ?? '');
  document.body.innerHTML = '';
  return text;
}
/** Each heading mapped to the text of its own group, so a phrase can be placed. */
function renderedSections(): Map<string, string> {
  const host = openConfirm();
  const out = new Map<string, string>();
  for (const child of Array.from(copyBlock(host).children)) {
    const heading = child.querySelector('span');
    if (!heading) continue;
    const name = norm(heading.textContent ?? '');
    if (!derived().groups.some((g) => g.heading === name)) continue;
    out.set(name, norm(child.textContent ?? ''));
  }
  document.body.innerHTML = '';
  expect(out.size, 'no headings rendered').toBe(derived().groups.length);
  return out;
}

// ── real globals.css, all four palettes ────────────────────────────────────

function varsIn(css: string, selectorTest: (sel: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(css).walkRules((rule) => {
    if (!selectorTest(rule.selector)) return;
    rule.walkDecls((decl) => { if (decl.prop.startsWith('--')) out[decl.prop] = decl.value.trim(); });
  });
  return out;
}

let emitted: Array<{ cls: string; minWidth: number; decls: Record<string, string> }> = [];
let rootPx: Array<{ minWidth: number; size: number }> = [];
let PALETTES: Record<string, Record<string, string>> = {};

beforeAll(async () => {
  const css = readFileSync(GLOBALS, 'utf8');
  const rootVars = varsIn(css, (s) => s.trim() === ':root');
  const harvestDark = varsIn(css, (s) => /\.dark|\[data-theme="dark"\]/.test(s) && !s.includes('data-palette'));
  const classicLight = varsIn(css, (s) => s.includes('data-palette="classic"') && s.includes('data-theme="light"'));
  const classicDark = varsIn(css, (s) => s.includes('data-palette="classic"') && (s.includes('.dark') || s.includes('data-theme="dark"')));
  PALETTES = {
    'harvest light': rootVars,
    'harvest dark': { ...rootVars, ...harvestDark },
    'classic light': { ...rootVars, ...classicLight },
    'classic dark': { ...rootVars, ...harvestDark, ...classicDark },
  };

  rootPx = [{ minWidth: 0, size: 16 }];
  postcss.parse(css).walkAtRules('media', (at) => {
    const mq = at.params.match(/min-width:\s*([\d.]+)px/);
    if (!mq) return;
    at.walkRules((r) => {
      if (r.selector.trim() !== ':root') return;
      r.walkDecls('font-size', (d) => {
        const v = d.value.trim().match(/^([\d.]+)px$/);
        if (v) rootPx.push({ minWidth: Number(mq[1]), size: Number(v[1]) });
      });
    });
  });
  rootPx.sort((a, b) => a.minWidth - b.minWidth);

  const host = openConfirm();
  const raw = Array.from(host.querySelectorAll('*')).map((el) => el.getAttribute('class') || '').join(' ');
  document.body.innerHTML = '';

  const tailwind = (await import('tailwindcss')).default;
  const base = (await import('../../../tailwind.config')).default;
  const out = await postcss([tailwind({ ...base, content: [{ raw, extension: 'html' }] } as never)])
    .process('@tailwind utilities;', { from: undefined });

  const unescape = (sel: string) =>
    sel.replace(/^\./, '').replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16))).replace(/\\/g, '');
  const collect = (node: postcss.Rule, minWidth: number) => {
    const decls: Record<string, string> = {};
    node.walkDecls((d) => { decls[d.prop] = d.value.trim(); });
    emitted.push({ cls: unescape(node.selector), minWidth, decls });
  };
  postcss.parse(out.css).each((node) => {
    if (node.type === 'rule') collect(node, 0);
    if (node.type === 'atrule' && node.name === 'media') {
      const m = node.params.match(/min-width:\s*([\d.]+)px/);
      if (!m) return;
      node.walkRules((r) => collect(r, Number(m[1])));
    }
  });
  expect(emitted.length, 'Tailwind produced no rules for the rendered classes').toBeGreaterThan(0);
}, 120_000);

const classesOf = (el: Element): string[] => (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
function effective(classes: string[], viewport: number): Record<string, string> {
  const wanted = new Set(classes);
  const out: Record<string, string> = {};
  for (const rule of emitted) {
    if (!wanted.has(rule.cls) || rule.minWidth > viewport) continue;
    Object.assign(out, rule.decls);
  }
  return out;
}
const rootSizeAt = (v: number): number => rootPx.filter((r) => r.minWidth <= v).slice(-1)[0].size;
function px(value: string | undefined, viewport: number): number | null {
  if (!value) return null;
  const rem = value.match(/^(-?[\d.]+)rem$/);
  if (rem) return Number(rem[1]) * rootSizeAt(viewport);
  const p = value.match(/^(-?[\d.]+)px$/);
  if (p) return Number(p[1]);
  return null;
}
function padX(el: Element, viewport: number): number {
  const d = effective(classesOf(el), viewport);
  return (px(d['padding-left'], viewport) ?? px(d.padding, viewport) ?? 0)
    + (px(d['padding-right'], viewport) ?? px(d.padding, viewport) ?? 0);
}
/** The rendered box width of an element, given the width its parent hands it. */
function boxWidth(el: Element, available: number, viewport: number): number {
  const d = effective(classesOf(el), viewport);
  let w = available;
  if (d.width !== '100%') {
    const explicit = px(d.width, viewport);
    if (explicit !== null) w = explicit;
  }
  const cap = px(d['max-width'], viewport);
  return cap !== null ? Math.min(w, cap) : w;
}
/**
 * The content width an element actually gets, by walking the real chain from
 * the modal's scroll container down to it — the same descent
 * PersonalInformationModal.desktop-layout.test.tsx makes to a field column.
 */
function contentWidth(el: Element, host: HTMLElement, viewport: number): number {
  const outer = host.querySelector('.flex-1.overflow-y-auto') as HTMLElement;
  expect(outer, 'the modal scroll container moved').not.toBeNull();
  const chain: Element[] = [];
  for (let n: Element | null = el; n && n !== outer; n = n.parentElement) chain.unshift(n);
  let avail = boxWidth(outer, viewport, viewport) - padX(outer, viewport);
  for (const node of chain) {
    const d = effective(classesOf(node), viewport);
    avail = boxWidth(node, avail, viewport) - padX(node, viewport);
    if (d['grid-template-columns']) {
      // `lg:grid-cols-[300px_1fr]` — the nav rail, then the content column.
      avail -= 300 + (px(d['column-gap'] ?? d.gap, viewport) ?? 0);
    }
  }
  return avail;
}

describe('it renders in every palette and on the narrowest phone', () => {
  const tokensNamed = (expr: string) => [...expr.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]);

  it('no colour is hardcoded and all four palettes resolve', () => {
    const host = openConfirm();
    const block = copyBlock(host);
    const els = [block, ...Array.from(block.querySelectorAll('*'))];

    // 1. Nothing in the new markup spells a literal colour.
    const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\b(?:white|black)\b/;
    for (const el of els) {
      for (const cls of classesOf(el)) {
        expect(LITERAL.test(cls), `${cls} hardcodes a colour`).toBe(false);
      }
      expect(el.getAttribute('style'), 'the copy block sets an inline style').toBeNull();
    }

    // 2. Every colour it DOES set is a token, and that token has a value in
    //    all four palettes.
    const tokens = new Set<string>();
    let colourProps = 0;
    for (const el of els) {
      const decls = effective(classesOf(el), 380);
      for (const [prop, value] of Object.entries(decls)) {
        if (!/^(color|background-color|border-.*color)$/.test(prop)) continue;
        colourProps += 1;
        expect(LITERAL.test(value), `${prop}: ${value} is a literal, not a token`).toBe(false);
        for (const t of tokensNamed(value)) tokens.add(t);
      }
    }
    expect(colourProps, 'the copy block sets no colour at all — the scan is broken').toBeGreaterThan(0);
    expect(tokens.size, 'no tokens found — the scan is broken').toBeGreaterThan(0);

    const resolve = (token: string, vars: Record<string, string>, seen = new Set<string>()): string | null => {
      if (seen.has(token)) return null;
      seen.add(token);
      const raw = vars[token];
      if (!raw) return null;
      const nested = tokensNamed(raw);
      if (nested.length === 0) return raw;
      return nested.every((n) => resolve(n, vars, seen) !== null) ? raw : null;
    };
    for (const [name, vars] of Object.entries(PALETTES)) {
      for (const token of tokens) {
        expect(resolve(token, vars), `${token} does not resolve in the ${name} palette`).not.toBeNull();
      }
    }
    document.body.innerHTML = '';
  });

  /**
   * ⚠️ Width is not monotonic in viewport here. The Actions column takes
   * FIELD_WIDTH.long (`sm:max-w-[440px]`) from 640px up, so the panel is WIDER
   * on a 380px phone's full-bleed column than it is at 768px and above. Both
   * ends are measured.
   */
  const VIEWPORTS = [380, 768, 1024, 1280, 1440];

  it('readable at 380px — no overflow, no clipping', () => {
    const host = openConfirm();
    const block = copyBlock(host);
    const els = [block, ...Array.from(block.querySelectorAll('*'))];

    for (const viewport of VIEWPORTS) {
      for (const el of els) {
        const decls = effective(classesOf(el), viewport);
        // Nothing may set a fixed width, a minimum width, or a height: each is
        // a way for prose that grew to spill out of its box.
        for (const prop of ['width', 'min-width', 'height', 'max-height']) {
          const value = decls[prop];
          if (value === undefined || value === '100%' || value === 'auto') continue;
          expect.fail(`at ${viewport}px, ${el.tagName.toLowerCase()}.${classesOf(el).join('.')} sets ${prop}: ${value}`);
        }
        // Nothing may clip or truncate: every word of this is load-bearing.
        for (const prop of ['overflow', 'overflow-x', 'overflow-y', 'text-overflow', '-webkit-line-clamp']) {
          expect(decls[prop], `${prop} on the copy block would clip the copy at ${viewport}px`).toBeUndefined();
        }
        expect(decls['white-space'], `white-space would stop the copy wrapping at ${viewport}px`).not.toBe('nowrap');
      }
    }

    // The copy block's own content box, measured by walking the real chain from
    // the modal's scroll container down to it, rather than by arithmetic on
    // class names.
    const measured = Object.fromEntries(VIEWPORTS.map((v) => [v, contentWidth(block, host, v)]));

    const words = norm(block.textContent ?? '').split(/[\s\u2014]+/).filter(Boolean);
    const longest = words.reduce((a, b) => (b.length > a.length ? b : a), '');
    // text-xs is 0.75rem. Below 1024px the rem base is 16px (12px type); at and
    // above it globals.css trims to 14.5px (10.875px type), so the narrow
    // viewports carry the LARGER type. 0.75em per character is a deliberate
    // over-estimate, so this is a bound rather than a fitted number.
    const typePx = (v: number) => 0.75 * rootSizeAt(v);

    for (const viewport of VIEWPORTS) {
      const content = measured[viewport];
      expect(content, `the copy has no room at all at ${viewport}px`).toBeGreaterThan(0);
      expect(
        longest.length * typePx(viewport) * 0.75,
        `"${longest}" (${longest.length} chars) does not fit the ${content}px column at ${viewport}px`,
      ).toBeLessThanOrEqual(content);
      // Two words to a line at the very least, or this is a column of syllables.
      expect(content, `${viewport}px leaves a ${content}px column — too narrow to read`)
        .toBeGreaterThanOrEqual(2 * longest.length * typePx(viewport) * 0.5);
    }

    /**
     * ⚠️ MEASURED, NOT ASSUMED — the content width of this block, walking the
     * real chain at each of the five viewports the brief names:
     *
     *   380px   284.0px    full-bleed; only the modal's and the panel's padding
     *   768px   392.0px    the Actions column caps at FIELD_WIDTH.long (440px)
     *   1024px  396.5px    same cap, but globals.css trims the rem base to
     *   1280px  396.5px    14.5px, so the three `p-4`s in the chain shrink and
     *   1440px  396.5px    the content box GROWS by 4.5px crossing 1024px
     *
     * So this block's narrowest rendering is the phone, and the desktop ladder
     * steps UP once at 1024px rather than down — the rem trim, not a layout
     * rule, is what moves it. That step is why the ladder is asserted as a
     * shape rather than as one flat number: pinning equality across 768-1440
     * would be pinning a bug that is not there.
     */
    expect(measured[380]).toBeLessThan(measured[768]);
    expect(measured[768]).toBeLessThan(measured[1024]);
    expect(measured[1024]).toBe(measured[1280]);
    expect(measured[1280]).toBe(measured[1440]);
    document.body.innerHTML = '';
  });

  it('no touch target shrank — the buttons are the ones that were there', () => {
    const host = openConfirm();
    const buttons = Array.from(panel(host).querySelectorAll('button')).map((b) => norm(b.textContent ?? ''));
    expect(buttons).toEqual(['Cancel', 'Delete']);
    for (const button of Array.from(panel(host).querySelectorAll('button'))) {
      const classes = classesOf(button);
      expect(classes, `${norm(button.textContent ?? '')} lost its vertical padding`).toContain('py-2');
      expect(classes).toContain('flex-1');
    }
    document.body.innerHTML = '';
  });
});
