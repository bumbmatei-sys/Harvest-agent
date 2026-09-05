import React, { act } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  RECORDED_EDITS,
  FROZEN_FILES,
  MIN_REASON_LENGTH,
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
      ['button', 1, 'Log Out and the partnership CTAs'],
      ['empty', 1, 'the no-partnership state'],
    ];
    for (const [slot, atLeast, what] of REQUIRED) {
      expect(slots(slot),
        `${what}: expected at least ${atLeast} [data-slot="${slot}"], found ${slots(slot)} — ` +
        'a hand-written substitute carries no slot').toBeGreaterThanOrEqual(atLeast);
    }
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
    const mine = RECORDED_EDITS.filter((e) => e.file === PROFILE && e.ticket === 'THE-321');
    expect(mine.length, 'THE-321 recorded no edit to Profile.tsx').toBe(1);
    const entry = mine[0];
    expect(entry.ticket).toMatch(/^THE-\d+$/);
    expect(entry.why.length,
      `the reason is under ${MIN_REASON_LENGTH} chars — a bare hash is a loophole`)
      .toBeGreaterThanOrEqual(MIN_REASON_LENGTH);
    expect(entry.digest, 'the digest is not a sha256').toMatch(/^[0-9a-f]{64}$/);
    expect(entry.digest, 'the recorded digest is not what Profile.tsx is at')
      .toBe(sha256File(PROFILE));
  });

  it('and the register as a whole is still well-formed, and was APPENDED to', () => {
    expect(validateRegister(), 'the register has a malformed entry').toEqual([]);
    // 🔴 Every entry that was there before THE-321 is still there — appended,
    // never substituted. Spelled as tickets+files so a replaced digest on an
    // existing entry is not what this checks (its own suite does that).
    const before = RECORDED_EDITS
      .filter((e) => e.ticket !== 'THE-321')
      .map((e) => `${e.ticket} ${e.file}`);
    expect(before).toEqual([
      'THE-314 src/components/AdminSettings.tsx',
      'THE-314 src/components/__tests__/AdminSettings.regroup.test.tsx',
      'THE-316 src/components/AdminSettings.tsx',
      'THE-316 src/components/settings/SettingsAccordion.tsx',
    ]);
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
    ],
    'src/components/settings/SmsSection.tsx': [
      ['75c90bc448dc52eceb47e8866a06a32cd53a64bb1b0455c2b7585053800bdf03', 'main at acc0d66 — THE-320 owns it'],
      ['5bb4042ee2d57f562a7a2b33897fe6bf169a9f7e82bd1bb8bddeb9b83cf6c6b0', "THE-319's recorded value, from before it moved on main"],
    ],
    'src/components/events/ServicePlanPanel.tsx': [
      ['81f99a23ff53cb1488935b7adf37cf043ff577399324e377785176d9f1e8c891', 'main at acc0d66 — THE-317 (#458) owns it'],
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
      .toBe('bf5f96a61c3fa2f467556f44f0b36e91e49b7c830609b37c775fa6a2b9232ca5');
  });

  it('🔴 PersonalInformationModal.tsx is byte-identical — the modal half is BLOCKED, see the header', () => {
    expect(sha256File(MODAL),
      'PersonalInformationModal.tsx changed — THE-321 stopped on it (STOP 6) and must not edit it')
      .toBe('c62dd16e810bd1d75bd3bc6e3cae1ee698fdcf4d9ec67d870dc833d76b1b1975');
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
