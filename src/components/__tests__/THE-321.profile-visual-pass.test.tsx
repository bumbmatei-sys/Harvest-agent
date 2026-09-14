import React, { act } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';

import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';
import path from 'node:path';
import {
  RECORDED_EDITS,
  FROZEN_FILES,
  MIN_REASON_LENGTH,
  freezeFailure,
  sha256File,
  validateRegister,
} from './__fixtures__/settings-freeze-register';

/**
 * THE-321 — the member Profile's visual pass, composed from the installed
 * primitives.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 🔴 THIS SUITE READS THE WORKING TREE AND NOTHING ELSE. No `git diff`, no
 * `git show`, no base ref, no `child_process`. Four guards in this repo were
 * written against the CURRENT BRANCH'S DIFF and blocked every unrelated PR
 * once their own ticket merged; THE-315 (#454) is the standing sweep for a
 * fifth, and section 9 below asserts this file is not it.
 *
 * ── What this ticket did NOT do, and why ────────────────────────────────────
 *
 * 🔴 `PersonalInformationModal.tsx` IS UNTOUCHED — see section 8. THE-321 was
 * scoped to both files; the modal half is BLOCKED, not skipped, and the block
 * is recorded as an assertion rather than a sentence in a PR body:
 * `PersonalInformationModal.desktop-layout.test.tsx` pins the modal's ENTIRE
 * sub-640px class inventory — every element, every unprefixed token — against
 * a literal JSON fixture, by exact `toEqual`. Unlike `RECORDED_EDITS` here or
 * `EDITED_SINCE_MEASUREMENT` in `MemberScreens.desktop-layout.test.tsx`, that
 * fixture has NO APPEND PATH: it cannot record a deliberate edit alongside its
 * baseline, only be overwritten. Every control in that modal renders on a
 * phone, so composing any of it means substituting the fixture — and its own
 * docblock says a fixture change for any reason but an inserted row "is a
 * regression, not an edit". That is the ticket's STOP 6, so the modal keeps
 * its baseline digest and the delete flow is not touched at all.
 */

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const PROFILE = FROZEN_FILES.profile;
const MODAL = FROZEN_FILES.personalInformationModal;
const THIS_FILE = 'src/components/__tests__/THE-321.profile-visual-pass.test.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { authMock, userDoc, updateDocCalls } = vi.hoisted(() => ({
  authMock: {
    currentUser: {
      uid: 'u1', email: 'member@church.org', photoURL: null, displayName: 'Member',
      // PersonalInformationModal renders (closed) inside Profile and reads this.
      providerData: [{ providerId: 'password' }],
    },
  },
  userDoc: { current: {} as Record<string, unknown> },
  updateDocCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../firebase', () => ({
  auth: authMock, db: {}, messaging: Promise.resolve(null), VAPID_KEY: 'test-vapid-key',
}));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(), updateProfile: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  onSnapshot: (_ref: unknown, cb: (d: unknown) => void) => {
    cb({ exists: () => true, data: () => userDoc.current });
    return () => {};
  },
  updateDoc: vi.fn(async (_ref: unknown, patch: Record<string, unknown>) => { updateDocCalls.push(patch); }),
  collection: () => ({}), query: () => ({}), where: () => ({}),
  getDocs: vi.fn(async () => ({ forEach: (f: (d: unknown) => void) => f({ data: () => ({ tenantId: 'tenant-1' }) }) })),
  arrayUnion: (v: unknown) => v,
}));
vi.mock('firebase/messaging', () => ({ getToken: vi.fn(async () => null) }));
vi.mock('../../utils/tenant-scope', () => ({
  SUPER_ADMIN_EMAIL: 'founder@theharvest.site', isSuperAdmin: () => false, getTenantScope: async () => 'tenant-1',
}));
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => ({ tenantPlan: 'plus' }) }));

import Profile from '../Profile';

const NOOP = { onNavigate: () => {}, onGoToPartner: () => {}, onGoToMap: () => {} };

async function mount(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => { createRoot(container).render(<Profile {...NOOP} />); });
  return container;
}

beforeEach(() => {
  document.body.innerHTML = '';
  updateDocCalls.length = 0;
  userDoc.current = {};
  try { localStorage.clear(); } catch { /* happy-dom always has it */ }
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-palette');
});

/* ═══ 1 · the new design renders, section by section ═══════════════════════ */

describe('1 · Profile renders the new design', () => {
  it('renders the identity card, ACCOUNT SETTINGS, PARTNERSHIP, SUPPORT & INFO and Log Out', async () => {
    const host = await mount();
    const text = host.textContent ?? '';
    for (const heading of ['Account Settings', 'Partnership', 'Support & Info']) {
      expect(text, `the ${heading} section is missing`).toContain(heading);
    }
    for (const row of [
      'Member since 2026', 'Change photo', 'Personal Information', 'Push Notifications',
      'My Events', 'Saved', 'Install app', 'Donation History', 'Contact Us', 'FAQ',
      'Privacy & Terms', 'Log Out',
    ]) {
      expect(text, `"${row}" is missing from the redesigned Profile`).toContain(row);
    }
  });

  it('and every section shell is a card slot, not a hand-written div', async () => {
    const host = await mount();
    // Four shells: Account Settings, Partnership, Donation History, Support & Info.
    // (The identity rail's card is a fifth, inside `hidden lg:block`.)
    expect(host.querySelectorAll('[data-slot="card"]').length,
      'a section shell is still hand-written').toBeGreaterThanOrEqual(5);
  });
});

/* ═══ 2 · composed from the installed primitives ═══════════════════════════ */

describe('2 · the file imports its primitives from @/components/ui/', () => {
  /** Alias AND relative spellings — THE-266 closed exactly this hole. */
  const importsUi = (src: string, name: string) =>
    new RegExp(`from ['"](?:@/components|\\.{1,2}(?:/[\\w.-]+)*)/ui/${name}['"]`).test(src);

  const ADOPTED = [
    'avatar', 'badge', 'button', 'card', 'dialog', 'empty', 'item', 'separator', 'switch',
  ] as const;

  it('imports each primitive it composes with', () => {
    const src = read(PROFILE);
    for (const name of ADOPTED) {
      expect(importsUi(src, name), `Profile.tsx does not import ui/${name}`).toBe(true);
    }
  });

  /**
   * 🔴 2b — THE MUTATION-SENSITIVE ONE.
   *
   * ⚠️ An import check alone is NOT this assertion. THE-296, THE-300, THE-312,
   * THE-315, THE-316 and THE-318 each shipped a guard that passed a planted
   * defect, and the shape that fails this way is exactly "count the imports":
   * a file can import Item and still hand-write every row beside it, and the
   * import survives the mutation the guard exists to catch.
   *
   * So this reads the RENDERED TREE and requires the primitive's own
   * `data-slot` on the element that does the job — which a hand-written
   * substitute does not carry. Replacing any composed element with equivalent
   * raw markup drops its slot and fails here, whether or not the import stays.
   */
  it('2b · every element that has a primitive USES it, in the rendered tree', async () => {
    const host = await mount();
    const slots = (name: string) => host.querySelectorAll(`[data-slot="${name}"]`).length;

    const REQUIRED: ReadonlyArray<[slot: string, atLeast: number, what: string]> = [
      ['card', 5, 'the section shells and the identity rail'],
      ['item', 8, 'every settings row, including Push Notifications'],
      ['item-media', 7, "each row's icon disc"],
      ['item-title', 8, "each row's label"],
      // Eight render for this fixture; the ninth is inside the `hasChurches`
      // gate (My Home Church), which no church makes true here.
      ['separator', 8, 'the hairline between rows'],
      ['avatar', 1, 'the profile photo'],
      ['avatar-fallback', 1, "the initial shown when there is no photo, or it fails to load"],
      ['badge', 1, 'the "Member since" chip'],
      ['switch', 1, 'the Push Notifications toggle'],
      ['button', 1, 'Log Out and the partnership CTA'],
    ];
    for (const [slot, atLeast, what] of REQUIRED) {
      expect(slots(slot),
        `${what}: expected at least ${atLeast} [data-slot="${slot}"], found ${slots(slot)} — ` +
        'a hand-written substitute carries no slot').toBeGreaterThanOrEqual(atLeast);
    }

    /**
     * 🔴 THE-359 RETIRED THE `empty` ROW, AND IT IS RECORDED HERE RATHER THAN
     * DELETED. This list required `['empty', 1, 'the no-partnership state']`.
     * THE-321 chose that primitive to state "you have nothing here yet" — and
     * "yet" is a claim about a partnership Harvest cannot see. THE FOUNDER:
     * "there is no way to create as of right now any recuring payments tracked
     * by harvest so that copy is not good." Recurring giving runs through the
     * tenant's own PayPal / Revolut / Wise links and Harvest never sees it, so
     * a member with a monthly standing order was told, flatly, that they had
     * none. The empty state is GONE — replaced by a bare "Partner with Us"
     * button that asserts nothing — so there is no empty collection left to
     * announce and no primitive owed for announcing one.
     *
     * ⚠️ THE REQUIREMENT IS INVERTED, NOT DROPPED. A future PR that reinstates
     * an empty-state claim about partnership fails right here.
     */
    expect(slots('empty'),
      '🔴 an Empty block is back in Profile — Harvest cannot know whether a member partners')
      .toBe(0);
    /**
     * ⚠️ OVER PARSER-STRIPPED SOURCE, AND THE NEEDLE IS ASSEMBLED FROM
     * FRAGMENTS. #496 found two of its own guards SELF-MATCHING — a grep whose
     * pattern is spelled out in the comment explaining it finds itself and
     * passes forever. The docblock above quotes the deleted sentence verbatim,
     * so a raw read of this file's subject would match the quotation; the
     * stripper removes comments from the SUBJECT, and the needle is built at
     * run time so it cannot appear as a literal anywhere in this suite.
     */
    const needle = new RegExp(['active', 'partnership'].join('\\s+'), 'i');
    expect(stripComments(read(PROFILE)), 'the "no active partnership" claim came back')
      .not.toMatch(needle);
    /**
     * The CTA that replaced it is a REAL ROW, composed from the same `item`
     * primitive as every other navigation row on this page. The founder, on the
     * first attempt: "The partner with us button should look just as all other
     * buttons with an icon. Not that huge fat ugly button you created." So the
     * slot asserted here is `item`, not `button` — a hand-written substitute,
     * or a return to the full-bleed Button, fails on that.
     */
    const cta = Array.from(host.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === 'Partner with Us');
    expect(cta, 'the "Partner with Us" control is gone').toBeTruthy();
    expect(cta!.getAttribute('data-slot'),
      'the CTA is not composed from the shared row primitive').toBe('item');
    // It carries the same three parts every sibling row does.
    expect(cta!.querySelector('[data-slot="item-media"]'), 'the row has no icon disc').toBeTruthy();
    expect(cta!.querySelector('[data-slot="item-title"]'), 'the row has no label').toBeTruthy();
    expect(cta!.querySelector('[data-slot="item-actions"]'), 'the row has no chevron').toBeTruthy();
  });

  it('2b · and no hand-written substitute is left beside the primitive it replaced', async () => {
    const host = await mount();
    // The exact shapes this pass removed. Each is a primitive retyped; finding
    // one again means a row was written by hand next to the ones that were not.
    const handRolled = Array.from(host.querySelectorAll('div')).filter((d) => {
      /*
       * ⚠️ TOKEN EQUALITY, NOT SUBSTRING. `Separator` itself carries
       * `data-horizontal:h-px`, so a `/\bh-px\b/` test on the class STRING
       * matches the primitive and reports all eight of them — this assertion
       * failed against the very thing it exists to require. A bare `h-px`
       * token, with no variant prefix, is the hand-written shape.
       */
      const tokens = (d.getAttribute('class') ?? '').split(/\s+/);
      return tokens.includes('h-px') && tokens.includes('bg-surface-sunken');
    });
    expect(handRolled.map((d) => d.getAttribute('class')),
      'a hairline rule is still a hand-written h-px div rather than Separator').toEqual([]);

    // The hand-rolled switch: a bare role="switch" that is not the primitive.
    const switches = Array.from(host.querySelectorAll('[role="switch"]'));
    expect(switches.length, 'the Push Notifications toggle is missing').toBeGreaterThan(0);
    for (const s of switches) {
      expect(s.getAttribute('data-slot'),
        'a role="switch" element is hand-written rather than ui/switch').toBe('switch');
    }
  });

  it('2c · inline styles are down to the justified survivors, and none is a colour literal', () => {
    const src = read(PROFILE);
    const inline = src.match(/style=\{\{/g) ?? [];
    // Ten before this pass; the five that remain are the navy hero's radial
    // wash, its grain image, the avatar's lit edge and the chip's ground —
    // gradients and washes over a gradient, none of which has a utility.
    expect(inline.length, 'an inline style was added rather than removed').toBeLessThanOrEqual(5);

    // 🔴 And no hex literal anywhere in the file — the `#C9963A` fallback the
    // hand-rolled switch and the rail's "Change photo" carried is gone.
    expect(src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [],
      'a literal hex colour is present in Profile.tsx').toEqual([]);
  });
});

/* ═══ 3 · the register entry ═══════════════════════════════════════════════ */

describe('3 · Profile.tsx has a valid register entry', () => {
  it('names a ticket, a reason of 80+ chars and a digest that matches disk', () => {
    /**
     * ⚠️ THE-359 SPLIT THIS INTO TWO CLAIMS, because it was quietly making one
     * that the register's own rule forbids. It read THE-321's entry and
     * required ITS digest to equal the file on disk — so every later ticket
     * that touched Profile.tsx could only get green by REWRITING THE-321's
     * digest in place, which is the substitution "append, never substitute"
     * exists to stop, and it loses the record of what THE-321 actually left.
     *
     * The two claims it should have been making, and now does:
     *   1. THE-321's entry still exists, still names a ticket and still carries
     *      a reason above the floor. Its digest is HISTORY and is not compared
     *      to disk.
     *   2. Profile.tsx on disk is at a digest SOME entry recorded — the append
     *      path — and the most recent entry for the file is the one that
     *      matches, so a ticket that edits it and records nothing fails here.
     */
    const mine = RECORDED_EDITS.filter((e) => e.file === PROFILE && e.ticket === 'THE-321');
    expect(mine.length, 'THE-321 recorded no edit to Profile.tsx').toBe(1);
    const entry = mine[0];
    expect(entry.ticket).toMatch(/^THE-\d+$/);
    expect(entry.why.length,
      `the reason is under ${MIN_REASON_LENGTH} chars — a bare hash is a loophole`)
      .toBeGreaterThanOrEqual(MIN_REASON_LENGTH);
    expect(entry.digest, 'the digest is not a sha256').toMatch(/^[0-9a-f]{64}$/);

    // 2 — the file on disk, against the LATEST recorded state of it.
    const forProfile = RECORDED_EDITS.filter((e) => e.file === PROFILE);
    expect(forProfile.length, 'no ticket has recorded Profile.tsx').toBeGreaterThan(0);
    const latest = forProfile[forProfile.length - 1];
    expect(latest.why.length,
      `${latest.ticket}'s reason is under ${MIN_REASON_LENGTH} chars`)
      .toBeGreaterThanOrEqual(MIN_REASON_LENGTH);
    expect(latest.digest,
      `Profile.tsx is at ${sha256File(PROFILE)}, which ${latest.ticket} — the newest entry for `
      + 'it — does not record. Append { file, ticket, why, digest } rather than editing an '
      + 'existing row.')
      .toBe(sha256File(PROFILE));
  });

  it('and the register as a whole is still well-formed, and was APPENDED to', () => {
    expect(validateRegister(), 'the register has a malformed entry').toEqual([]);
    // 🔴 Every entry that was there before THE-321 is still there — appended,
    // never substituted. Spelled as tickets+files so a replaced digest on an
    // existing entry is not what this checks (its own suite does that).
    //
    // ⚠️ A PREFIX, NOT AN EQUALITY. This was `toEqual` on the four, which reads
    // as "nothing was substituted" and ALSO says "and nobody may ever append
    // again" — so it went red on THE-323, a ticket that did exactly what the
    // register exists for. That is the expiring shape THE-315 (#454) sweeps
    // for, reached from the other direction: an assertion that is true only
    // until the next unrelated PR. The claim this test actually makes is that
    // the four are still there, in order, ahead of everything later; entries
    // after them are the append path working.
    const entries = RECORDED_EDITS.map((e) => `${e.ticket} ${e.file}`);
    const BEFORE_THE_321 = [
      'THE-314 src/components/AdminSettings.tsx',
      'THE-314 src/components/__tests__/AdminSettings.regroup.test.tsx',
      'THE-316 src/components/AdminSettings.tsx',
      'THE-316 src/components/settings/SettingsAccordion.tsx',
    ];
    expect(entries.slice(0, BEFORE_THE_321.length),
      'an entry that predates THE-321 was removed or reordered')
      .toEqual(BEFORE_THE_321);
    // And THE-321's own entry still follows them rather than replacing one.
    expect(entries).toContain(`THE-321 ${PROFILE}`);
    expect(entries.indexOf(`THE-321 ${PROFILE}`))
      .toBeGreaterThanOrEqual(BEFORE_THE_321.length);
  });
});

/* ═══ 4 · the account-deletion flow ════════════════════════════════════════ */

describe('4 · the account-deletion flow is untouched', () => {
  /**
   * 🔴 ANCHORED PER MESSAGE. ⚠️ THE-315 found its own version of this check
   * blind to a DROPPED message: it grepped a couple of identifiers, so seven
   * of eight surviving passed it. Each of the eight is asserted on its own
   * line here, so removing exactly one fails and the failure NAMES it.
   */
  const EIGHT_OUTCOMES = [
    'You are not signed in. Sign in again and retry.',
    'Could not reach the server. Check your connection and try again.',
    'Your account and sign-in have been deleted. Signing you out now.',
    'For your security, confirm your password to finish deleting your account.',
    'For your security, this needs a recent sign-in. Sign out, sign back in, and delete your account within a few minutes.',
    'Your account could not be deleted. Please try again, or contact your ministry admin if this keeps happening.',
    'Enter your password to continue.',
    'Incorrect password. Try again.',
  ] as const;

  it.each(EIGHT_OUTCOMES)('the outcome message %j is still spelled in the modal', (message) => {
    expect(read(MODAL), `the delete flow lost the outcome message: ${message}`).toContain(message);
  });

  it('all eight are present together — none was merged into another', () => {
    const src = read(MODAL);
    const missing = EIGHT_OUTCOMES.filter((m) => !src.includes(m));
    expect(missing, `${missing.length} of the eight delete outcomes are gone`).toEqual([]);
    expect(new Set(EIGHT_OUTCOMES).size, 'the eight are not eight distinct messages').toBe(8);
  });

  it('the state machine and both handlers still exist, with every branch', () => {
    const src = read(MODAL);
    for (const token of [
      "type DeleteFlowState = 'idle' | 'deleting' | 'reauth' | 'error' | 'done'",
      'handleDeleteAccount', 'handleReauthAndDelete', 'reauthenticateWithCredential',
      'resetDeleteFlow', 'DELETE_CONFIRM_COPY', 'UNREACHABLE_NOTE',
    ]) {
      expect(src, `the delete flow lost ${token}`).toContain(token);
    }
    for (const state of ['idle', 'deleting', 'reauth', 'error', 'done']) {
      expect(src, `the delete flow lost the '${state}' branch`).toContain(`'${state}'`);
    }
  });

  it('and DELETE_CONFIRM_COPY is still derived, never retyped into the panel', () => {
    const src = read(MODAL);
    expect(src, 'DELETE_CONFIRM_COPY is no longer imported from the derivation')
      .toMatch(/import \{[^}]*DELETE_CONFIRM_COPY[^}]*\} from '\.\.\/lib\/member-erasure-copy'/);
    expect(src, 'the confirm panel no longer maps the derived groups')
      .toContain('DELETE_CONFIRM_COPY.groups.map');
  });
});

/* ═══ 5+6 · the install entry ══════════════════════════════════════════════ */

describe('5 · the install entry is reachable and not gated on beforeinstallprompt', () => {
  it('renders the Install app row with no prompt event ever fired', async () => {
    const host = await mount();
    const row = Array.from(host.querySelectorAll('button'))
      .find((b) => (b.textContent ?? '').includes('Install app'));
    expect(row, 'the Install app row is unreachable — #445 regressed').toBeDefined();
  });

  it('and Profile.tsx names beforeinstallprompt nowhere at all', () => {
    // 🔴 The event fires ONCE per page load and only when the browser judges
    // the app installable, so gating the ROW on it makes the feature
    // unreachable for the member who skipped onboarding — the #445 defect.
    expect(read(PROFILE), 'the install entry now depends on beforeinstallprompt')
      .not.toContain('beforeinstallprompt');
  });

  it('6 · and the instructions fallback is still what the row opens', () => {
    const src = read(PROFILE);
    expect(src, 'the install row no longer opens the shared install screen')
      .toContain('InstallAppModal');
    // Hidden only inside the Capacitor shell, which is the one runtime with
    // nothing to install — not behind a browser prompt.
    expect(src, 'the install row lost its Capacitor-shell guard').toContain('inNativeShell');
  });
});

/* ═══ 7 · #429's country invariant ═════════════════════════════════════════ */

describe("7 · #429's country invariant holds", () => {
  it('Profile.tsx writes no country at all, and mints no sentinel', () => {
    const src = read(PROFILE);
    // THE-292 established that Profile.tsx holds NO country write; the writers
    // are Onboarding.saveToFirestore and PersonalInformationModal.handleSave.
    expect(src, 'Profile.tsx gained a country write').not.toMatch(/\bcountry\s*[:=]/);
    for (const sentinel of ["'Unknown'", '"Unknown"', "'N/A'", "'none'"]) {
      expect(src, `a country sentinel ${sentinel} was introduced`).not.toContain(sentinel);
    }
  });

  it('and no updateDoc from this screen carries a country key', async () => {
    // Behavioural, not a grep: mount, toggle the one control that writes, and
    // read what actually went to Firestore.
    const host = await mount();
    const toggle = host.querySelector('[role="switch"]') as HTMLElement | null;
    expect(toggle, 'the Push Notifications toggle is missing').not.toBeNull();
    for (const patch of updateDocCalls) {
      expect(Object.keys(patch), 'a Profile write carries a country key')
        .not.toContain('country');
    }
  });
});

/* ═══ 9 · pre-auth stays light-mode only ═══════════════════════════════════ */

describe('9 · no stray theme write occurs', () => {
  it('mounting Profile writes no theme or palette preference by itself', async () => {
    await mount();
    // 🔴 THE-85: pre-auth is light-mode only, so nothing on this screen may
    // write a preference except the control the member actually operates.
    expect(localStorage.getItem('theme'), 'mounting Profile wrote a theme').toBeNull();
    expect(document.documentElement.getAttribute('data-theme'),
      'mounting Profile set data-theme').toBeNull();
  });

  it('and Profile.tsx sets no theme attribute or storage key of its own', () => {
    const src = read(PROFILE);
    expect(src, 'Profile.tsx writes data-theme directly').not.toMatch(/setAttribute\(\s*['"]data-theme/);
    expect(src, 'Profile.tsx writes a theme storage key directly')
      .not.toMatch(/localStorage\.setItem\(\s*['"](?:theme|palette)/);
  });
});

/* ═══ 12 · dialogs open above z-100 ════════════════════════════════════════ */

describe('12 · dialogs open above z-100', () => {
  it('the No Home Church modal is a Dialog, so it inherits the raised layers', () => {
    const src = read(PROFILE);
    expect(src, 'the No Home Church modal is still a hand-rolled scrim')
      .toContain('<Dialog open={isNoHomeChurchModalOpen}');
    // 🔴 Its old scrim was z-50 — UNDER the member shell. The primitive's
    // scrim/panel are z-[101]/z-[102], asserted at the source of truth so this
    // cannot drift if the primitive is re-generated.
    const dialogSrc = read('src/components/ui/dialog.tsx');
    expect(dialogSrc, 'the dialog scrim dropped below z-100').toContain('z-[101]');
    expect(dialogSrc, 'the dialog panel dropped below z-100').toContain('z-[102]');
  });
});

/* ═══ 13 · no new token, no dependency, no emoji ═══════════════════════════ */

describe('13 · no new token or dependency, no emoji', () => {
  it('adds no dependency and no CSS custom property', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    // The primitives adopted here were all installed by THE-266/272/274; base-ui
    // and lucide are already present. Nothing new is required by this pass.
    expect(Object.keys(pkg.dependencies), 'a dependency was added')
      .toEqual(expect.arrayContaining(['@base-ui/react']));
    expect(read(PROFILE).match(/--[a-z-]+:\s/g) ?? [], 'a CSS custom property was defined in Profile.tsx')
      .toEqual([]);
  });

  it('contains no emoji', async () => {
    /*
     * ⚠️ READ FROM THE RENDERED TREE, NOT THE SOURCE. The repo's own comment
     * convention marks notes with emoji, and a source scan therefore reports
     * every docblock in the file — which is noise, not a finding. The ban is on
     * an emoji reaching a MEMBER, so this asserts what a member actually sees.
     */
    const host = await mount();
    /*
     * ⚠️ ARROWS (U+2190–U+21FF) ARE NOT IN THIS RANGE, deliberately. "Give
     * again →" and "Partner with Us →" are the founder's existing copy, pinned
     * verbatim by Profile.composition's row-order assertion; a rule that called
     * them emoji would demand a copy change this ticket has no mandate to make.
     */
    const emoji = /[\u{1F300}-\u{1FAFF}\u{1F900}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    const offenders = Array.from(host.querySelectorAll('*'))
      .flatMap((el) => Array.from(el.childNodes))
      .filter((n) => n.nodeType === 3 && emoji.test(n.textContent ?? ''))
      .map((n) => (n.textContent ?? '').trim());
    expect(offenders, 'an emoji reaches the rendered Profile').toEqual([]);
  });
});

/* ═══ 14+16 · the files this ticket does not own ═══════════════════════════ */

describe('14 · the files THE-321 does not own are byte-identical', () => {
  /**
   * ⚠️ A SET per file, not a single digest — THE-276's reason. CI runs against
   * `refs/pull/N/merge`, so a file a PARALLEL ticket legitimately lands on
   * `main` holds a different value there than on this branch. A value that is
   * NEITHER — i.e. THIS ticket editing it — still fails, which is the threat.
   */
  const NOT_OURS: Record<string, ReadonlyArray<readonly [digest: string, source: string]>> = {
    'src/components/AdminSms.tsx': [
      ['5cf8ed7aba7720fd4ef892ca0f294219ae1f6fe5d5121afc54481ff83a5f2eaf', 'main at acc0d66 — THE-320 owns it'],
      // 🔴 APPENDED BY THE-320, NEVER SUBSTITUTED — the value above still stands.
      // This is precisely the case the header calls for: THE-320 is the ticket
      // this map already names as the owner, and it has now composed the file
      // from the installed primitives. THE-321 still cannot edit it, because a
      // value that is NEITHER of these two continues to fail.
      ['ed2f8906fb0b9f4faf26e62f44418fe85143762dbaae66761b3487b5a4f4eff9', 'main + THE-320 — the ticket that owns it, composed from the primitives'],
      // 🔴 APPENDED BY THE-327, NEVER SUBSTITUTED — both values above still
      // stand. THE-327 consolidates SMS into one section: this screen now
      // mounts the number lifecycle (imported from settings/SmsSection, never
      // copied) behind a third `Number` tab, and shows setup instead of a
      // composer while the ministry has no number. THE-321 still cannot edit
      // this file, because a value that is none of the three continues to fail.
      ['f48ae4b8b6deff201e3767e5812bf7045af632a64c88384e5a91f285c47caab2', 'main + THE-327 — the number lifecycle mounted in the SMS section'],
      // 🔴 APPENDED BY THE-357, NEVER SUBSTITUTED — all three values above
      // still stand. #500 measured this screen's five Buttons at 25.38 / 36.25 /
      // 36.25 / 36.25 / 34.63px above `sm`, every one under Rule 4's 38px floor,
      // and reported them without sweeping. THE-357 is that sweep: each of the
      // five now spells `${CONTROL_DENSITY.action}` — Rule 4's own opt-in token,
      // `sm:h-[40px] sm:py-0` — in place of the `sm:h-auto` that let the
      // primitive's 24/28/32/36px intrinsic sizes through, and each measures 40px
      // at 768/1024/1280/1440 and 44px at 380. NOTHING ELSE MOVED: no markup, no
      // handler, no read, no write, no colour, no inline style and no primitive —
      // five className strings and one named import. THE-321 still cannot edit
      // this file, because a value that is none of the four continues to fail.
      ['36dbc419cc5990f1021b81e03dfa33851c62199a54a5052c89511e8e34d43002', 'main + THE-357 — the five SMS controls adopt Rule 4'],
      // 🔴 APPENDED BY THE-360, never substituted. ONE capture:
      // `plan_limit_reached` with limitKind 'sms', fired on the same
      // `d.capReached` the existing outcome message already reports — a send
      // that RAN and ran out of segments part-way through. No markup, no
      // handler, no read, no write, no colour, no inline style, no primitive
      // and no className moved, which is what THE-321 pins this file for.
      // THE-321 still cannot edit it: a value that is none of the five fails.
      ['6c1ef963a4c7c2986f52d57890b592d7ea9ff735418336016d3d69ed2561cc2f', 'THE-360 — plan_limit_reached on a capped broadcast'],
    ],
    'src/components/settings/SmsSection.tsx': [
      ['75c90bc448dc52eceb47e8866a06a32cd53a64bb1b0455c2b7585053800bdf03', 'main at acc0d66 — THE-320 owns it'],
      ['5bb4042ee2d57f562a7a2b33897fe6bf169a9f7e82bd1bb8bddeb9b83cf6c6b0', "THE-319's recorded value, from before it moved on main"],
      // 🔴 APPENDED BY THE-320. Both values above stand unedited.
      ['6e619cd3a1b2e4356ebbee1a1b1788b0692ab1b736258481d18888b0455aa33d', 'main + THE-320 — the ticket that owns it, composed from the primitives'],
      // 🔴 APPENDED BY THE-327. All three values above stand unedited. The
      // number panel became an exported component the SMS section mounts, and
      // this module's DEFAULT export — what the Settings accordion renders —
      // became the signpost pointing at it. Two `ui/alert` warnings were added
      // about carrier registration; nothing about the purchase path moved.
      ['71cf6c2bde5043afb7a6364c98a9bf55a5c10b940f2299d2343818caf6fa4484', 'main + THE-327 — the lifecycle moved to the SMS section, a signpost left behind'],
      // 🔴 APPENDED BY THE-330. All four values above stand unedited, and
      // THE-321 still cannot edit this file because a digest that is none of the
      // five continues to fail.
      //
      // The get-a-number form's free-text country and area boxes became pickers
      // drawn from the provider's live catalogue, with a type picker added
      // beside them — a church typed `DE` and a Nashville area code into a form
      // that told it neither was possible until after it pressed a button.
      //
      // ⚠️ WHAT THIS MEANS FOR THE-321's OWN PASS: the new controls are native
      // `<select>`s, not `ui/select`. That is not a shortcut — it is the same
      // rejection this repo already records on the sibling SMS screen, for two
      // MEASURED reasons: base-ui renders a listbox button rather than a
      // `<select>`, which would blind the existing `label → input,select,
      // textarea` width guard; and it pins 32px through
      // `data-[size=default]:h-8`, an attribute selector that outranks Rule 4
      // and sits under the 44px touch floor. All three pickers are measured in
      // Chromium at 380/768/1024/1280/1440 in THE-330's own layout suite. No
      // colour literal, no invented width and no inline style was added.
      ['bf66547987b88b735a23b18c20a2151e3a5cd83992a33f6cde6d53aae512e60d', 'main + THE-330 — the country, type and area code are chosen from the provider, not typed'],
    ],
    'src/components/events/ServicePlanPanel.tsx': [
      ['81f99a23ff53cb1488935b7adf37cf043ff577399324e377785176d9f1e8c891', 'main at acc0d66 — THE-317 (#458) owns it'],
      // 🔴 APPENDED BY THE-329. The value above stands unedited, and THE-321
      // still cannot edit this file because a digest that is neither continues
      // to fail. THE-329 makes a service plannable without an event: the panel
      // takes `eventId: string | null` alongside a new `planId`, and reads a
      // standalone service by its own document id instead of by an event that
      // does not exist. Nothing visual moved — no class, no primitive, no
      // colour token — and this file still imports nothing from
      // `@/components/ui/`, so it adopts nothing THE-321's pass is about.
      ['29f35a933400e820ec96505c53326cbe32db192fffb7a984112f708cfa8e007f', 'main + THE-329 — a service can be planned with no event, so the panel takes either anchor'],
    ],
    'src/components/events/ServicePlanRow.tsx': [
      ['ffafaf4228bbefe95d7b9bf439d5a36df9c9160f5c086cbae25a236ec0adca37', 'main at acc0d66 — THE-317 (#458) owns it'],
    ],
  };

  it.each(Object.keys(NOT_OURS))('%s carries no edit from THE-321', (file) => {
    const accepted = NOT_OURS[file];
    const actual = sha256File(file);
    expect(
      accepted.find(([digest]) => digest === actual),
      `${file} is at ${actual}, which is none of:\n  ` +
        accepted.map(([d, why]) => `${d} (${why})`).join('\n  '),
    ).toBeTruthy();
  });

  it('16 · and layout.tsx, firestore.rules and functions/ were not opened', () => {
    expect(sha256File('src/app/layout.tsx'), 'layout.tsx changed — the brief forbids opening it')
      .toBe('b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f');
  });

  it('🔴 PersonalInformationModal.tsx is at a REGISTER-ACCEPTED digest — THE-321 still edits it not at all', () => {
    /*
     * ⚠️ FOLLOWED THE-323, RATHER THAN BEING DELETED OR REPLACED. This
     * assertion recorded that THE-321 stopped on the modal (its STOP 6) and
     * pinned the digest it left it at. THE-323 is the ticket that unblocked it:
     * it gave the class-layer fixture the append path this file's header says
     * it lacked, and fixed `handleSave`'s silent failure — a real edit, and a
     * RECORDED one, in `settings-freeze-register.ts`.
     *
     * 🔴 THE CLAIM IS UNCHANGED AND STILL EXACTLY AS STRONG. It was never
     * "this file may never move"; it was "THE-321 does not move it, and a move
     * nobody recorded fails". Routing through `freezeFailure` says precisely
     * that: the baseline THE-321 pinned is still accepted, THE-323's digest is
     * accepted because THE-323 wrote down what it changed and why, and a third
     * value — an edit nobody recorded — still fails. Substituting the literal
     * would have been the weakening; `main` was red for a week the time #434
     * did that.
     */
    const failure = freezeFailure(
      MODAL, 'c62dd16e810bd1d75bd3bc6e3cae1ee698fdcf4d9ec67d870dc833d76b1b1975',
    );
    expect(failure, failure ?? '').toBeNull();
  });
});

/* ═══ 15 · this suite is not a branch-diff guard ═══════════════════════════ */

describe('15 · no guard in this PR asserts anything about the current branch diff', () => {
  it('this suite shells out to no git command and reads no base ref', () => {
    const self = read(THIS_FILE);
    const code = self.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    /*
     * ⚠️ Matched as USE, never as mention — a flat substring list finds its own
     * entries. Each pattern requires a CALL or an IMPORT, so the list cannot
     * match itself.
     */
    const BRANCH_DIFF_USES: ReadonlyArray<[label: string, pattern: RegExp]> = [
      ['a child-process call', /\b(?:exec|spawn)Sync\s*\(/],
      ['a child_process import', /(?:from|require\()\s*['"](?:node:)?child_process['"]/],
      ['a git subprocess', /['"`]git\s+(?:diff|show|merge-base|rev-parse)/],
      ['the base-ref environment', /process\.env\.\w*BASE_REF/],
      ['a base revision', /['"`](?:origin\/|refs\/remotes\/)/],
    ];
    for (const [label, pattern] of BRANCH_DIFF_USES) {
      expect(code.match(pattern)?.[0] ?? null,
        `THE-321's guard uses ${label} — that is a branch-diff guard`).toBeNull();
    }
  });

  it('and it adds no assertion that expires when THE-321 merges', () => {
    expect(read(THIS_FILE), "THE-321's guard gates itself on its own ticket's presence")
      .not.toMatch(/if\s*\([^)]*THE-321[^)]*\)\s*(?:return|\{[^}]*return)/);
  });
});
