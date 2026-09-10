import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * THE-323 — the unlock, and the silent failure it was blocking.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What THE-321 found, and what this ticket did about it ───────────────────
 *
 * THE-321 composed `Profile.tsx` and then STOPPED on `PersonalInformationModal
 * .tsx`, reporting that its layout suite "pins the entire sub-640px class
 * inventory against a literal JSON fixture by exact equality … that fixture has
 * no append path — only overwrite."
 *
 * 🔴 THAT READ IS CORRECT, and it was checked rather than taken. The assertion
 * was `expect(mobileLayer(host)).toEqual(MOBILE_FIXTURE)` against a 68-line
 * JSON array. `toEqual` has exactly one escape — replace the fixture — and
 * replacing it destroys the record it is. Unlike `RECORDED_EDITS` (THE-312) or
 * `EDITED_SINCE_MEASUREMENT`, there was nowhere to say "this move WAS
 * deliberate". Section 1 below is the append path that gives it one, and
 * section 2 is the proof it is a register and not a hole.
 *
 * ── The two bugs THE-321 reported in the same file ──────────────────────────
 *
 * 🔴 `handleSave` FAILED SILENTLY, and section 3 asserts the fix behaviourally
 * — by making the write reject and reading what the member is shown, not by
 * grepping for a string. This is the Silent-Failure class AGENTS.md:6 names,
 * on the button beside the delete flow that was fixed for exactly it.
 *
 * ⚠️ `ui/input` is `h-8` (32px) and trips this screen's own 44px floor. It is
 * NOT changed — it is a shadcn primitive under the ds-primitives digest guard
 * with many consumers — and section 10 pins it byte-identical. THE-298's
 * pattern (lift your OWN control, never the primitive) is what a later ticket
 * composing this file must use, and THE-323 composes nothing, so it lifts
 * nothing.
 *
 * ── What THE-323 deliberately does NOT do ───────────────────────────────────
 *
 * The visual pass — composing this modal from the installed primitives — is
 * SPLIT OUT and is not in this PR. See the PR body for where the seam is. The
 * one primitive adopted here (`alert`) is adopted because the silent-failure
 * fix has nowhere to render without it, not as a first instalment of the pass.
 *
 * ⚠️ NOTHING HERE ASSERTS ANYTHING ABOUT THE CURRENT BRANCH'S DIFF, and nothing
 * shells out to git at all — not at assertion time and not at import time.
 * THE-315 (#454) is a standing sweep for exactly the shape four guards in this
 * repo shipped and then blocked every unrelated PR with. Every pin below reads
 * a file from disk and compares it to a literal, which gets MORE true when this
 * ticket merges rather than less.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const sha256File = (rel: string) => sha256(readFileSync(path.join(ROOT, rel)));

const MODAL = 'src/components/PersonalInformationModal.tsx';

/* ── the component, with a write that can be made to reject ───────────────── */

const { updateDocMock, updateProfileMock } = vi.hoisted(() => ({
  updateDocMock: vi.fn(async (_ref: unknown, _patch: Record<string, unknown>) => {}),
  updateProfileMock: vi.fn(async (_user: unknown, _patch: Record<string, unknown>) => {}),
}));

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
  updateProfile: updateProfileMock,
  updatePassword: vi.fn(),
  signOut: vi.fn(),
  EmailAuthProvider: { credential: vi.fn() },
  reauthenticateWithCredential: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  updateDoc: updateDocMock,
}));
vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'GET', UPDATE: 'UPDATE' },
  // 🔴 The REAL shape of the helper the bug depended on: it LOGS AND DOES NOT
  // THROW. That is why `handleSave`'s Firestore branch could `return` bare and
  // leave the screen untouched, and a mock that threw would hide the defect
  // this file exists to keep fixed.
  handleFirestoreError: vi.fn(() => {}),
}));
vi.mock('../../utils/auth-fetch', () => ({ authFetch: async () => ({ ok: true, json: async () => ({}) }) }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('../CountrySelect', () => ({
  default: (props: { buttonClassName?: string }) => <button className={props.buttonClassName} />,
}));

import PersonalInformationModal from '../PersonalInformationModal';
import {
  MIN_REASON_LENGTH,
  PINNED_LAYERS,
  acceptedFor,
  baselineLayer,
  layerDigest,
  layerFailureFor,
  loadRegister,
  validateRegister,
  type RecordedLayer,
} from './__fixtures__/mobile-layer-register';
import { rulesDigestFailure } from '../../__tests__/__fixtures__/firestore-rules-pin';
const { mobileLayer } = await import('../../test/support/class-inventory');

function mount(el: React.ReactElement): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { createRoot(container).render(el); });
  return container;
}

beforeEach(() => {
  document.body.innerHTML = '';
  updateDocMock.mockReset();
  updateDocMock.mockImplementation(async () => {});
  updateProfileMock.mockReset();
  updateProfileMock.mockImplementation(async () => {});
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 · the layout fixture has a documented append path
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('1 · the layout fixture has a documented append path', () => {
  it('the modal is a component the register can record, and its baseline is the fixture', () => {
    expect(Object.keys(PINNED_LAYERS)).toContain(MODAL);
    // The baseline is the fixture ON DISK, unchanged — not a copy, not a
    // literal in this file. Overwriting it is still what the append path exists
    // to make unnecessary.
    expect(PINNED_LAYERS[MODAL])
      .toBe('src/components/__tests__/__fixtures__/PersonalInformationModal.mobile-layer.json');
    expect(baselineLayer(MODAL).length).toBeGreaterThan(0);
    expect(baselineLayer(MODAL)).toEqual(
      JSON.parse(read(PINNED_LAYERS[MODAL])) as string[],
    );
  });

  it('the pinned suite routes its layer through the register rather than a bare toEqual', () => {
    const suite = read('src/components/__tests__/PersonalInformationModal.desktop-layout.test.tsx');
    expect(suite, 'the suite no longer imports the register — its pin has no append path')
      .toContain("from './__fixtures__/mobile-layer-register'");
    expect(suite, 'the suite stopped calling layerFailureFor').toContain('layerFailureFor(');
  });

  it('the register documents how to append, in the file a blocked ticket will open', () => {
    const reg = read('src/components/__tests__/__fixtures__/mobile-layer-register.ts');
    for (const marker of [
      'How a future ticket records a layer change',
      'validateRegister',
      'IT IS NOT A LOOSENING',
      'THE RECORDED LAYER IS STORED IN FULL',
    ]) {
      expect(reg, `the register stopped documenting "${marker}"`).toContain(marker);
    }
    // And the directory a ticket adds its file to is checked in, so the append
    // path is reachable rather than something the next ticket has to invent.
    expect(readdirSync(path.join(ROOT, 'src/components/__tests__/__fixtures__/mobile-layer')))
      .toContain('README.md');
  });

  const DIGEST = 'a'.repeat(64);
  const REASON = 'x'.repeat(MIN_REASON_LENGTH + 1);
  const LAYER = ['0\tdiv\tflex', '1\tspan\ttext-sm'];
  const good: RecordedLayer = {
    file: MODAL, ticket: 'THE-999', why: REASON,
    digest: layerDigest(LAYER), layer: LAYER, source: 'THE-999.json',
  };

  it('the register as checked in is valid', () => {
    expect(validateRegister(), validateRegister().join('\n')).toEqual([]);
  });

  it('a complete entry is accepted', () => {
    expect(validateRegister([good])).toEqual([]);
  });

  it('an entry with no ticket is refused', () => {
    expect(validateRegister([{ ...good, ticket: '' }]).join(' ')).toMatch(/no ticket/);
    expect(validateRegister([{ ...good, ticket: 'because' }]).join(' ')).toMatch(/no ticket/);
  });

  it('an entry with a reason under 80 characters — a bare hash — is refused', () => {
    expect(validateRegister([{ ...good, why: '' }]).join(' ')).toMatch(/no reason/);
    expect(validateRegister([{ ...good, why: 'cleanup' }]).join(' ')).toMatch(/no reason/);
    expect(validateRegister([{ ...good, why: 'x'.repeat(MIN_REASON_LENGTH - 1) }]).join(' '))
      .toMatch(/no reason/);
    // The floor is the one THE-312 already set, not a new number.
    expect(MIN_REASON_LENGTH).toBe(80);
  });

  it('🔴 an entry with no digest is refused — that would exempt the layer entirely', () => {
    expect(validateRegister([{ ...good, digest: '' }]).join(' ')).toMatch(/no sha256 digest/);
    expect(validateRegister([{ ...good, digest: 'deadbeef' }]).join(' ')).toMatch(/no sha256 digest/);
  });

  it('🔴 an entry whose digest does not match its own layer is refused', () => {
    // The half a bare-digest register cannot have: the record and the classes
    // beside it cannot drift apart, so review reads the real thing.
    expect(validateRegister([{ ...good, digest: DIGEST }]).join(' '))
      .toMatch(/does not match the layer recorded beside it/);
    expect(validateRegister([{ ...good, layer: [] }]).join(' '))
      .toMatch(/a digest with no layer beside it/);
  });

  it('an entry naming a component whose layer no suite pins is refused', () => {
    expect(validateRegister([{ ...good, file: 'src/components/AdminDashboard.tsx' }]).join(' '))
      .toMatch(/not one of the components whose layer is pinned/);
  });

  it('🔴 the register records NOTHING on THE-323, and that is correct', () => {
    // THE-312 shipped its register empty for the same reason: THE-323 moves no
    // phone rendering, so it has no layer to record. An entry added "in
    // advance" is dead weight a later reader has to disprove.
    expect(loadRegister()).toEqual([]);
    expect(read('src/components/__tests__/__fixtures__/mobile-layer/README.md'))
      .toContain('Do not add an entry in');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2 · 🔴 an UNRECORDED change to the modal still fails
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('2 · an UNRECORDED change to the modal still fails', () => {
  /**
   * 🔴 THE TEST THAT PROVES THIS IS A REGISTER AND NOT A HOLE.
   *
   * It takes the modal's REAL rendered layer, plants a change in it, and asks
   * the register what it makes of the result. Rejection is the only acceptable
   * answer. Nothing is written to disk: `layerFailureFor` is pure, so the proof
   * does not need to vandalise the tree to run in CI. (The same edits were also
   * planted on disk during development and this test went red exactly as it
   * does here — see the PR body's mutation table.)
   */
  const planted = (mutate: (layer: string[]) => string[]) => {
    const host = mount(<PersonalInformationModal isOpen onClose={() => {}} />);
    return mutate([...mobileLayer(host)]);
  };

  const MUTATIONS: ReadonlyArray<readonly [string, (l: string[]) => string[]]> = [
    ['a class added to an element below sm', (l) => { l[26] = `${l[26]} rounded-xl`; return l; }],
    ['a class removed from an element below sm', (l) => { l[29] = l[29].replace(' font-bold', ''); return l; }],
    ['an element inserted', (l) => { l.splice(15, 0, '15\tdiv\tp-4'); return l; }],
    ['an element removed', (l) => { l.splice(20, 1); return l; }],
    ['hand-written markup swapped for a primitive without recording it',
      (l) => l.map((line) => line.replace('bg-surface-raised border border-line p-2 rounded-3xl shadow-xs', 'bg-card rounded-xl border py-6 shadow-sm'))],
  ];

  it.each(MUTATIONS)('%s is rejected', (label, mutate) => {
    const actual = planted(mutate);
    const failure = layerFailureFor(MODAL, baselineLayer(MODAL), actual);
    expect(failure, `🔴 an unrecorded change (${label}) PASSED — that is a loophole, not a register`)
      .not.toBeNull();
    expect(failure!, 'the failure does not name the component').toContain(MODAL);
    expect(failure!, 'the failure does not say how to record the change')
      .toContain('mobile-layer/THE-nnn.json');
    // And it hands the reader the layer to record, so the append path is
    // actionable from the failure rather than from a doc nobody opens.
    expect(failure!).toContain('The layer it is at, to record');
  });

  it('🔴 an entry for the WRONG component does not unlock this one', () => {
    const actual = planted((l) => { l[26] = `${l[26]} rounded-xl`; return l; });
    const other: RecordedLayer = {
      file: 'src/components/Profile.tsx', ticket: 'THE-999',
      why: 'x'.repeat(MIN_REASON_LENGTH + 1),
      digest: layerDigest(actual), layer: actual, source: 'THE-999.json',
    };
    expect(layerFailureFor(MODAL, baselineLayer(MODAL), actual, [other])).not.toBeNull();
  });

  it('🔴 the baseline is never replaced — a recorded layer is an ADDITIONAL accepted value', () => {
    const moved = planted((l) => { l[26] = `${l[26]} rounded-xl`; return l; });
    const recorded: RecordedLayer = {
      file: MODAL, ticket: 'THE-999', why: 'x'.repeat(MIN_REASON_LENGTH + 1),
      digest: layerDigest(moved), layer: moved, source: 'THE-999.json',
    };
    const base = baselineLayer(MODAL);
    // The recorded layer is accepted …
    expect(layerFailureFor(MODAL, base, moved, [recorded])).toBeNull();
    // … and so is the baseline, still, with that entry in place.
    expect(layerFailureFor(MODAL, base, [...base], [recorded])).toBeNull();
    // … and a THIRD layer nobody recorded is not.
    expect(layerFailureFor(MODAL, base, [...moved, '99\tdiv\tflex'], [recorded])).not.toBeNull();
    expect(acceptedFor(MODAL, base, [recorded])).toHaveLength(2);
  });

  it('and the modal as it stands renders the BASELINE layer — THE-323 moved no phone rendering', () => {
    const host = mount(<PersonalInformationModal isOpen onClose={() => {}} />);
    expect(mobileLayer(host)).toEqual(baselineLayer(MODAL));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3 · 🔴 a failed handleSave surfaces VISIBLY and does not discard the edit
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('3 · a failed handleSave surfaces VISIBLY and does not silently discard the edit', () => {
  const TYPED = 'Sarah Whitfield-Okonkwo';

  /** Type into Full Name, then press one of the two Save buttons. */
  async function editAndSave(host: HTMLElement, which: 'Save' | 'Save changes') {
    const nameInput = Array.from(host.querySelectorAll('input'))
      .find((i) => i.type === 'text') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        nameInput.constructor.prototype, 'value',
      )!.set!;
      setter.call(nameInput, TYPED);
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const button = Array.from(host.querySelectorAll('button'))
      .find((b) => (b.textContent ?? '').trim() === which)!;
    expect(button, `no "${which}" button`).toBeDefined();
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    return nameInput;
  }

  const errorBanner = (host: HTMLElement) =>
    host.querySelector('[data-save-error]') as HTMLElement | null;

  it.each(['Save', 'Save changes'] as const)(
    '🔴 a REJECTED Firestore write is shown to the member — %s',
    async (which) => {
      // The write rejects the way Firestore really rejects: a thrown error,
      // through a `handleFirestoreError` that logs and does not re-throw.
      updateDocMock.mockRejectedValue(
        Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }),
      );
      const onClose = vi.fn();
      const host = mount(<PersonalInformationModal isOpen onClose={onClose} />);
      const nameInput = await editAndSave(host, which);

      const banner = errorBanner(host);
      expect(banner, '🔴 the save failed and NOTHING was rendered — the silent failure is back')
        .not.toBeNull();
      expect(banner!.textContent, 'the banner does not say the save failed')
        .toMatch(/not saved/i);
      expect(banner!.textContent!.length, 'the banner is empty — a blank failure state is the bug')
        .toBeGreaterThan(20);
      // 🔴 Announced, not merely painted. This is the reader with the least
      // chance of noticing that a modal simply did not close.
      expect(banner!.getAttribute('role')).toBe('alert');

      // 🔴 THE EDIT SURVIVES. The modal stays open and the typed value is
      // still in the field, so a failed write loses no work.
      expect(onClose, 'the modal closed on a FAILED save — the edit is gone').not.toHaveBeenCalled();
      expect(nameInput.value, 'the typed value was discarded by a failed save').toBe(TYPED);

      // And the member can try again — Save is not stuck disabled.
      const save = Array.from(host.querySelectorAll('button'))
        .find((b) => (b.textContent ?? '').trim() === which) as HTMLButtonElement;
      expect(save.disabled, 'Save is stuck disabled after a failure — retry is impossible')
        .toBe(false);
    },
  );

  it('🔴 a REJECTED Auth profile write is shown too, and stops before the document write', async () => {
    updateProfileMock.mockRejectedValue(new Error('auth/network-request-failed'));
    const onClose = vi.fn();
    const host = mount(<PersonalInformationModal isOpen onClose={onClose} />);
    await editAndSave(host, 'Save');

    expect(errorBanner(host), 'the Auth write failed silently').not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    // A half-write must never read as success: the document write is not
    // attempted once the Auth write has failed.
    expect(updateDocMock, 'the document was written after the Auth write failed')
      .not.toHaveBeenCalled();
  });

  it('a SUCCESSFUL save still writes the same five fields and still closes', async () => {
    const onClose = vi.fn();
    const host = mount(<PersonalInformationModal isOpen onClose={onClose} />);
    await editAndSave(host, 'Save');
    expect(errorBanner(host), 'a successful save rendered a failure banner').toBeNull();
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(updateDocMock.mock.calls[0][1]).sort())
      .toEqual(['acceptedJesus', 'city', 'country', 'displayName', 'phone']);
    expect(onClose).toHaveBeenCalled();
  });

  it('🔴 no failure branch of handleSave ends in console alone', () => {
    // The source-level companion to the behavioural assertions above: the two
    // branches that used to end in `console.error` and in a bare `return` now
    // each set the state that renders. A branch that stops logging and starts
    // returning silently would pass a grep for `console.error` and fail here.
    const src = read(MODAL);
    const body = src.slice(src.indexOf('const handleSave'), src.indexOf('const handlePhotoClick'));
    const returns = (body.match(/\breturn;/g) ?? []).length;
    const surfaced = (body.match(/setSaveState\('error'\)/g) ?? []).length;
    expect(returns, 'handleSave gained an early return').toBe(3);
    expect(surfaced, `handleSave has ${returns} early returns but only ${surfaced} render a failure`)
      .toBe(returns);
    expect(body, 'the failed-save message is not rendered from state').toContain('setSaveMessage(');
  });

  it('the failure is an `alert` primitive, not hand-written markup', () => {
    const src = read(MODAL);
    expect(src).toContain("from '@/components/ui/alert'");
    expect(src, 'the banner is not the primitive').toMatch(/<Alert\b/);
    const host = mount(<PersonalInformationModal isOpen onClose={() => {}} />);
    // …and it is not rendered at rest, which is why the phone layer is
    // unchanged (section 2's last test).
    expect(host.querySelector('[data-slot="alert"]')).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4 · 🔴 the account-deletion flow is byte-identical
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('4 · the account-deletion flow is byte-identical', () => {
  /**
   * 🔴 ALL EIGHT, ANCHORED ONE BY ONE. THE-315 found its own version of this
   * check BLIND to a dropped message because it grepped for two identifiers and
   * called that the flow. Each message below is its own `it`, so dropping one
   * fails by NAME rather than by a count going from 8 to 7 somewhere.
   */
  const OUTCOMES = [
    'You are not signed in. Sign in again and retry.',
    'Could not reach the server. Check your connection and try again.',
    'Your account and sign-in have been deleted. Signing you out now.',
    'For your security, confirm your password to finish deleting your account.',
    'For your security, this needs a recent sign-in. Sign out, sign back in, and delete your account within a few minutes.',
    'Your account could not be deleted. Please try again, or contact your ministry admin if this keeps happening.',
    'Enter your password to continue.',
    'Incorrect password. Try again.',
  ] as const;

  it.each(OUTCOMES)('the outcome message "%s" is still there, verbatim', (message) => {
    expect(read(MODAL), `the delete-flow outcome "${message}" is gone`).toContain(message);
  });

  it('and there are exactly eight of them — a NINTH is a change to the flow too', () => {
    expect(OUTCOMES).toHaveLength(8);
    expect(new Set(OUTCOMES).size, 'a duplicate is padding the count').toBe(8);
    const src = read(MODAL);
    // 8 outcomes + 2 clears, the count THE-312 and THE-322 already spell.
    expect((src.match(/setDeleteMessage\(/g) ?? []).length).toBe(10); // 8 outcomes + 2 clears
  });

  it('🔴 the delete flow is byte-identical, from handleDeleteAccount to resetDeleteFlow', () => {
    // The whole region, digested — so a branch reordered, a condition flipped
    // or a comment reworded inside it fails even though every message survives.
    const src = read(MODAL);
    const from = src.indexOf('  const handleDeleteAccount = async () => {');
    const to = src.indexOf(' const handleVerifyCurrentPassword = async () => {');
    expect(from, 'handleDeleteAccount is gone').toBeGreaterThan(-1);
    expect(to, 'the region end marker moved').toBeGreaterThan(from);
    expect(sha256(src.slice(from, to)), 'the delete flow moved — every word of it is frozen')
      .toBe('70c4ba18d8c8ac81498ec2790ec28334679b727f5f897160efbe28f0cea0a62b');
  });

  it('🔴 the silent-failure fix that is the MODEL for handleSave survives untouched', () => {
    const src = read(MODAL);
    // The docblock that records why every delete outcome renders. It is the
    // reason `handleSave` now looks the way it does, and it must not be edited
    // in the pass that copies it.
    for (const line of [
      'Delete the account, and SAY WHAT HAPPENED.',
      'This used to be the silent failure',
      'member tapped Delete and the screen did not move',
      'every outcome below ends in something rendered',
      'BOTH DELETIONS NOW HAPPEN ON THE SERVER, IN ORDER',
      'There is no longer any',
    ]) {
      expect(src, `the delete flow's silent-failure record lost "${line}"`).toContain(line);
    }
    // And the state machine it documents, in full.
    expect(src).toContain("type DeleteFlowState = 'idle' | 'deleting' | 'reauth' | 'error' | 'done';");
    for (const state of ['deleting', 'reauth', 'error', 'done']) {
      expect(src, `deleteState no longer reaches '${state}'`).toContain(`setDeleteState('${state}')`);
    }
  });

  it('DELETE_CONFIRM_COPY is still rendered from the live derivation, not retyped', () => {
    const src = read(MODAL);
    expect(src).toContain("import { DELETE_CONFIRM_COPY, UNREACHABLE_NOTE } from '../lib/member-erasure-copy';");
    expect(src).toContain('DELETE_CONFIRM_COPY.groups.map(');
    expect(src).toContain('DELETE_CONFIRM_COPY.unreachable');
    expect(src).toContain('{UNREACHABLE_NOTE}');
    // The suite that proves it deep-equals `deriveErasureCopy(MEMBER_DATA_MAP)`
    // is still there to prove it.
    expect(read('src/components/__tests__/PersonalInformationModal.delete-copy.test.tsx'))
      .toContain('deriveErasureCopy(MEMBER_DATA_MAP)');
  });

  it('the re-auth path is untouched', () => {
    const src = read(MODAL);
    expect(src).toContain('const handleReauthAndDelete = async () => {');
    expect(src).toContain('EmailAuthProvider.credential(auth.currentUser.email, deletePassword)');
    expect(src).toContain('await reauthenticateWithCredential(auth.currentUser, credential);');
    expect(src).toContain('await auth.currentUser.getIdToken(true);');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6 · what `min-h-11` actually is — the premise, corrected
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('6 · `min-h-11` — the premise THE-323 was given, corrected', () => {
  /**
   * 🔴 THE TICKET'S PREMISE IS WRONG AND IT IS REPORTED, NOT WORKED AROUND.
   *
   * THE-323 was told: "`min-h-11` is INERT — it compiles to
   * `calc(var(--spacing) * 11)` and measured 7.63px. Use the repo's explicit
   * `min-h-[44px]`. Anything relying on `min-h-11` was never protected."
   *
   * It does compile to `calc(var(--spacing) * 11)`. `--spacing: 0.25rem` IS
   * defined — by Tailwind v4's own theme layer, in the stylesheet the app
   * ships, which is what `buildAppCss()` builds and what the browser gets. It
   * is NOT in `globals.css`, which is the likeliest source of the "defined
   * nowhere" reading. So the calc resolves to 2.75rem = 44px at the 16px
   * mobile root, and `THE-323.personal-information-measure` reads exactly
   * 44.0px off a bare probe div in Chromium, with `min-height: 44px` computed.
   *
   * ⚠️ 7.63px is a REAL number from a DIFFERENT bug. THE-321's measure suite
   * records it against `Button`'s `transition-all` animating min-height from 0
   * after layout — "7.63px, then 7.69px, then 7.75px on three consecutive runs
   * — a DRIFTING value, which is the tell". A drifting value is a timing
   * artefact by that suite's own reasoning, and it diagnosed it as one. The
   * number then travelled into this ticket attached to the class rather than to
   * the timing.
   *
   * 🔴 THE CONSEQUENCE, WHICH IS THE POINT OF REPORTING IT: the sweep this
   * ticket asked for would have condemned `AdminSettings.tsx`'s
   * `TOUCH_FLOOR = 'min-h-11 sm:min-h-0'` — THE-316's touch floor, on a frozen
   * file THE-323 does not own — as a screen whose 44px floor "was never
   * protected". It is protected. Writing that sweep would have reported a
   * working control as broken and, worse, invited an edit to a frozen file to
   * "fix" it.
   *
   * ── What IS true, and why the explicit spelling is still right ──────────────
   *
   * `min-h-11` is REM-RELATIVE; `min-h-[44px]` is absolute. globals.css trims
   * the root to 14.5px at `lg`+ ("trim the rem base ~9% for lg+ only"), so
   * above 1024px they diverge: 39.875px against 44px, measured. Below `sm`,
   * the only band where the 44px TOUCH FLOOR applies, the root is 16px and they
   * are identical — so both spellings are correct for a phone-only floor, and
   * `min-h-11 sm:min-h-0` is one. The explicit form stays this repo's idiom
   * because it says the number it means at every width; that is a reason to
   * prefer it, not evidence that the other never worked.
   */

  it('the sweep is recorded rather than written, and names every file that uses the class', () => {
    const users = walkSrc()
      .filter((f) => /\bmin-h-11\b/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f))
      .sort();
    // Files, and they are different KINDS of mention — pinned so a new one is
    // visible in review and so the prose above cannot rot silently.
    //
    // 🔴 APPENDED BY THE-324, NEITHER OF THE TWO ABOVE REMOVED OR REWRITTEN.
    // This list did exactly what it is for: THE-324 shipped with the 7.63px
    // premise written into two file headers as fact, and the sweep surfaced it.
    // The prose there is now CORRECTED to what THE-323 measured — it records
    // that `min-h-11` is a working 44px floor below `sm`, that the 7.63px figure
    // belongs to `transition-all` timing, and that the explicit form still ships
    // only because it is absolute where `min-h-11` is rem-relative and diverges
    // above `lg`. So both new entries are COMMENT-ONLY mentions of the class,
    // the same kind as Profile.tsx: neither view spells it in a className, which
    // `the-324-guards.test.ts` asserts on the stripped source.
    expect(users).toEqual([
      // 🔴 APPENDED BY THE-338, NOTHING BELOW REMOVED OR REWRITTEN. It sits
      // FIRST for the same reason THE-334's entry does: this list is the
      // sweep's own sorted order, not the order tickets arrived in.
      // ⚠️ It USES the class, in the Rule-4 form — `min-h-11 sm:min-h-0`. The
      // founder asked for THE-249's payment-links disclaimer in the CRM to
      // collapse; a disclosure trigger is a tap target, so it takes the 44px
      // floor below `sm` and releases it from `sm:` up, which is exactly the
      // band Rule 4 governs. The disclaimer's TEXT is unchanged — the fold is
      // the whole edit.
      'src/components/AdminCRM.tsx',
      // APPENDED BY THE-345, NOTHING BELOW REMOVED OR REWRITTEN. It sits second
      // because this list is the sweep's own sorted order, not the order tickets
      // arrived in.
      // It USES the class, in the Rule-4 form - `min-h-11 sm:min-h-0`, paired
      // with the shared `CONTROL_DENSITY.action` 40px token above `sm`. THE-345
      // fixes a course count that spent a plan slot on an adoption whose library
      // course no longer exists, and the notice announcing that gives the church
      // a button to clear the leftover record. The button sits inside an
      // `AlertDescription`, whose type scale would otherwise leave it near 28px
      // on a phone, so the 44px floor here is load-bearing rather than
      // decorative - `min-h-11` is NOT inert on this element, which is the
      // premise this section exists to keep honest.
      'src/components/AdminCourses.tsx',
      // 🔴 APPENDED BY THE-334, NOTHING BELOW REMOVED OR REWRITTEN. It sits
      // FIRST because this list is the sweep's own sorted order, not the order
      // tickets arrived in.
      // ⚠️ It USES the class, ungated — `min-h-11` with no `sm:min-h-0`. That is
      // deliberate and it does NOT fight Rule 4. The entries taking the floor are
      // the NAV RAIL's buttons, and the rail is `lg:`-gated: it does not render
      // below 1024px at all, so the sub-`sm` half of `min-h-11 sm:min-h-0` would
      // never apply and the `sm:` half would be the only live rule. Rule 4's
      // 38px band governs FORM CONTROLS — inputs, selects, submit buttons — so a
      // form does not sprawl; a rail entry that stacks an icon over a visible
      // text label is not one, and the founder asked for exactly that label.
      // Measured, the entry is 48.125 × 50.75px at every desktop width, which
      // clears the 44px floor on BOTH axes where THE-332's icon-only 39.875px
      // box never did. THE-332's own measured suite asserts that band.
      'src/components/AdminDashboard.tsx',
      // APPENDED BY THE-346, NOTHING BELOW REMOVED OR REWRITTEN. Both entries
      // USE the class, in the Rule-4 form - `min-h-11 sm:min-h-0`.
      //
      // AdminDocs: every row of the note's three-dot menu, its submenu rows and
      // the expand toggle beside "Notes". The menu was a hand-rolled div of
      // plain buttons and the toggle was `p-1.5` around a 16px glyph - 27px,
      // which is not a tap target on a phone.
      //
      // AdminEvents: the List/Month triggers, RESPELLED from THE-308's
      // `min-h-[44px]` rather than newly floored. Below `sm`, the only band
      // where the floor applies, the root is 16px and the two spellings are
      // identical - which is exactly what the prose above records, and is why
      // the respelling changes no measured height. The absolute form is right
      // where a number must hold at every width; this floor is phone-only, so
      // the scale form says the same thing on the scale everything else uses.
      'src/components/AdminDocs.tsx',
      'src/components/AdminEvents.tsx',
      'src/components/AdminSettings.tsx',   // uses it: THE-316's TOUCH_FLOOR
      'src/components/Profile.tsx',         // names it in a comment, does not use it
      // 🔴 APPENDED BY THE-348, NOTHING AROUND IT REMOVED OR REWRITTEN. It sits
      // here because this list is the sweep's own sorted order, not the order
      // tickets arrived in.
      // ⚠️ It USES the class, in the Rule-4 form — `min-h-11 min-w-11
      // sm:min-h-0 sm:min-w-0`, on BOTH axes. The member chat's send button
      // measured 36 × 36 at 380px in Chromium, beside an attach trigger that
      // already cleared 44 through `AttachMenu`'s own pair — so two controls in
      // one composer pill disagreed about the phone floor. `min-h-11` is NOT
      // inert on this element: the button is `w-9 h-9`, so the floor is what
      // takes it to 44 below `sm`, and releasing it from `sm:` up is what keeps
      // it out of Rule 4's way at desktop widths. Measured both ways in
      // `THE-348.member-composer.layout.test.tsx`, at five widths.
      'src/components/UserMessages.tsx',
      // 🔴 APPENDED BY THE-331, NOTHING ABOVE OR BELOW REMOVED OR REWRITTEN.
      // ⚠️ NOT a comment-only mention — this one USES the class, which makes it
      // the same KIND as AdminSettings.tsx and only the second such entry in
      // this list. The attach picker replaced a hand-rolled sheet with a
      // dropdown, and a menu row and a cascader row are both TAP TARGETS, so
      // both take a 44px floor below `sm`: `min-h-11 sm:min-h-0` on the menu
      // rows, and the same rule reached through the list as
      // `[&_[role=option]]:min-h-11` on the cascader rows, because CascaderItems
      // takes no className and hand-rendering rows would mean owning the
      // explicit `index` Base UI needs once windowing engages.
      // 🔴 `sm:min-h-0` is load-bearing and is why this is not a flat
      // `min-h-11`: Rule 4 fixes controls at 38px from `sm` up and a test
      // asserts DENSITY_PX.control < 44 deliberately, so an ungated floor would
      // fight it at every desktop width. The rem-relative/absolute divergence
      // the prose above records is exactly why that gating is safe here — the
      // class is only ever allowed to bind below `sm`, the one band where the
      // root is 16px and `min-h-11` and `min-h-[44px]` are identical.
      'src/components/attach/AttachMenu.tsx',        // THE-331: USES it, as a phone-only 44px tap floor
      'src/components/events/RotaInviteView.tsx',   // THE-324: names it in a comment, does not use it
      'src/components/events/RotaRespondView.tsx',
      // 🔴 APPENDED BY THE-334, for the same reason and of the same KIND as
      // AdminDashboard.tsx above: the flyout's "Recent" rows are nav targets in
      // the same `lg:`-only panel, so they take the same ungated 44px floor.
      'src/components/layout/nav-rail-recents.tsx',  // THE-324: names it in a comment, does not use it
      // 🔴 APPENDED BY THE-330, NOTHING ABOVE REMOVED OR REWRITTEN. Another
      // COMMENT-ONLY mention, the same kind as the two THE-324 entries: the
      // ticket adds two native `<select>` pickers and records, at their call
      // site, why `ui/select` was rejected for them — it pins its own height
      // through `data-[size=default]:h-8`, an attribute selector that outranks
      // Rule 4, and `min-h-11` does not win against it. The panel's own floor is
      // spelled `min-h-[44px]`, this repo's absolute idiom, so the class reaches
      // no className here; the test below asserts exactly that.
      'src/components/settings/SmsSection.tsx',      // THE-330: names it in a comment, does not use it
    ]);
  });

  it('🔴 and the two THE-324 entries really are comment-only — the class reaches no className', () => {
    // ⚠️ What makes appending to the list above honest rather than a way past
    // it: a file that only NAMES the class is a different fact from one that
    // USES it, and the distinction is asserted rather than asserted-in-a-comment.
    for (const file of [
      'src/components/events/RotaInviteView.tsx',
      'src/components/events/RotaRespondView.tsx',
      // ⚠️ THE-334's two entries are deliberately NOT here: both USE the class
      // in a className, which is the other KIND, and this list is only for
      // files that merely name it.
      // 🔴 APPENDED BY THE-330 — its entry above is held to the same standard,
      // so "it is only a comment" is asserted rather than claimed.
      'src/components/settings/SmsSection.tsx',
    ]) {
      const src = read(file);
      expect(src, `${file} is recorded as a comment-only mention but does not mention it`)
        .toMatch(/min-h-11/);
      for (const [, value] of src.matchAll(/className=\{?[`"']([^`"']*)[`"']/g)) {
        expect(value, `${file} SPELLS min-h-11 in a className`).not.toMatch(/\bmin-h-11\b/);
      }
    }
  });

  it("AdminSettings' floor uses it, and is a phone-only floor — which is where it is 44px", () => {
    const admin = read('src/components/AdminSettings.tsx');
    expect(admin).toContain("const TOUCH_FLOOR = 'min-h-11 sm:min-h-0';");
    // 🔴 `sm:min-h-0` is what makes the rem-relative form safe here: the class
    // is only ever in force below 640px, where the root is 16px.
    expect(admin, "the floor lost its sm: hand-back — min-h-11 would now reach the trimmed rem base")
      .toMatch(/min-h-11 sm:min-h-0/);
  });

  it('and the measured proof lives beside this, not in prose', () => {
    const measure = read('src/components/__tests__/THE-323.personal-information-measure.test.tsx');
    expect(measure, 'the measured refutation is gone').toContain('it is NOT inert, and it is not 7.63px');
    expect(measure).toContain("expect(probe.minHeight).toBe('44px');");
    expect(measure, 'the divergence above lg is no longer measured')
      .toContain('they DIVERGE above lg');
  });

  it('THE-323 itself spells no min-h-11, and reaches for no tap floor at all', () => {
    // It composes nothing and lifts nothing — the four controls under the floor
    // on this screen are recorded, measured, and left to the composition
    // ticket. See KNOWN_UNDER_FLOOR in the measure suite.
    expect(read(MODAL)).not.toMatch(/\bmin-h-11\b/);
    expect(read(MODAL)).not.toMatch(/min-h-\[44px\]/);
  });

  function walkSrc(): string[] {
    const out: string[] = [];
    const go = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name === '__tests__') continue;
          go(p);
        } else if (/\.tsx?$/.test(e.name) && statSync(p).isFile()) out.push(p);
      }
    };
    go(path.join(ROOT, 'src'));
    return out;
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8 · 🔴 PR 429's country invariant holds
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("8 · PR 429's country invariant holds — no '', no 'Unknown', no sentinel", () => {
  it('this file writes `country` through, with no default and no substitute', async () => {
    const src = read(MODAL);
    const body = src.slice(src.indexOf('const handleSave'), src.indexOf('const handlePhotoClick'));
    // The write is the bare identifier — not `country || ''`, not `?? 'Unknown'`.
    expect(body).toMatch(/\n\s*country,\s*\n/);
    expect(body, "a fallback was introduced for country").not.toMatch(
      /country\s*(?:\|\||\?\?)/,
    );
    expect(body, 'a sentinel was written for an unset country').not.toMatch(/'Unknown'|"Unknown"/);
  });

  it('and an UNSET country is written as the empty state, counted as unrecorded', async () => {
    const host = mount(<PersonalInformationModal isOpen onClose={() => {}} />);
    const save = Array.from(host.querySelectorAll('button'))
      .find((b) => (b.textContent ?? '').trim() === 'Save')!;
    await act(async () => { save.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const patch = updateDocMock.mock.calls[0][1];
    // 🔴 The invariant is `withCountry + countryUnrecorded === total`. It reads
    // a two-state field. Anything that is neither "a country" nor "unrecorded"
    // — a literal 'Unknown', a 'N/A', a null — is the third state that breaks
    // it. The empty string IS the unrecorded state and always has been.
    expect(patch.country).toBe('');
    expect(patch.country).not.toBe('Unknown');
    expect(patch.country).not.toBeNull();
    expect(patch.country).not.toBeUndefined();
  });

  it('and the set of files that write `country` is closed — it cannot quietly widen', () => {
    /*
     * ⚠️ THE TICKET SAYS "one of TWO writers of `country`" AND THE DETECTOR
     * FINDS FOUR. Reported rather than worked around, and the difference is
     * the question being asked, not a contradiction: this file and Onboarding
     * are the two that write a member's OWN country onto `users/{uid}`;
     * ChurchEnrollment writes a CHURCH's country and AdminCRM writes it on a
     * record an admin is editing. Those are different documents, and PR 429's
     * invariant is counted over member profiles.
     *
     * 🔴 So the guard is the closed SET rather than the number 2. A fifth file
     * writing `country` — including a second path in this one — is an edit to
     * this list and visible in review, which is the property the "two writers"
     * sentence was reaching for.
     */
    const writers = walkAllSrc()
      .filter((f) => /\bcountry,?\s*$/m.test(readFileSync(f, 'utf8')))
      .filter((f) => /updateDoc\(|setDoc\(/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f))
      .sort();
    expect(writers).toEqual([
      'src/components/AdminCRM.tsx',
      'src/components/ChurchEnrollment.tsx',
      'src/components/Onboarding.tsx',
      'src/components/PersonalInformationModal.tsx',
    ]);
  });

  function walkAllSrc(): string[] {
    const out: string[] = [];
    const go = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name === '__tests__') continue;
          go(p);
        } else if (/\.tsx?$/.test(e.name)) out.push(p);
      }
    };
    go(path.join(ROOT, 'src'));
    return out;
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 9 · Profile.tsx's props to this modal are unchanged
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("9 · Profile.tsx's props to this modal are unchanged", () => {
  it('the call site THE-321 composed still passes exactly isOpen and onClose', () => {
    const profile = read('src/components/Profile.tsx');
    expect(profile).toContain("import PersonalInformationModal from './PersonalInformationModal';");
    const call = profile.slice(
      profile.indexOf('<PersonalInformationModal'),
      profile.indexOf('/>', profile.indexOf('<PersonalInformationModal')) + 2,
    );
    expect(call.replace(/\s+/g, ' ').trim()).toBe(
      '<PersonalInformationModal isOpen={isPersonalInfoOpen} onClose={() => setIsPersonalInfoOpen(false)} />',
    );
  });

  it("and the modal's own prop interface still accepts exactly those two", () => {
    const src = read(MODAL);
    const iface = src.slice(
      src.indexOf('interface PersonalInformationModalProps'),
      src.indexOf('}', src.indexOf('interface PersonalInformationModalProps')) + 1,
    );
    expect(iface).toContain('isOpen: boolean;');
    expect(iface).toContain('onClose: () => void;');
    // A third prop would be a change Profile.tsx has to follow, and THE-321's
    // composed Profile is a no-regression surface for this ticket.
    expect((iface.match(/:/g) ?? []).length, 'a prop was added or removed').toBe(2);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 10 / 13 · the files this ticket must not touch
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('10 / 13 · the files this ticket must not touch are byte-identical', () => {
  it('🔴 ui/input.tsx is byte-identical — its h-8 was reported, never worked around', () => {
    expect(sha256File('src/components/ui/input.tsx'), 'ui/input.tsx was edited')
      .toBe('f7d6ecff9a4d631feeaf401c02bb87e26ddb38131c55d15a43b9290747390847');
    // And it really is the 32px the ticket reports, so the pin is on the file
    // the report is about.
    expect(read('src/components/ui/input.tsx')).toContain('h-8');
  });

  it('firestore.rules is byte-identical', () => {
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
  });

  it('src/app/layout.tsx is byte-identical', () => {
    expect(sha256File('src/app/layout.tsx'))
      .toBe('b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f');
  });

  it('functions/ is byte-identical, file for file', () => {
    // Walked rather than listed, so a file ADDED changes the digest too.
    const files: string[] = [];
    const go = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name === 'lib') continue;
          go(p);
        } else if (statSync(p).isFile()) files.push(p);
      }
    };
    go(path.join(ROOT, 'functions'));
    const digest = sha256(
      files.sort()
        .map((f) => `${path.relative(ROOT, f)} ${sha256(readFileSync(f, 'utf8'))}`)
        .join('\n'),
    );
    expect(files.length, 'functions/ lost or gained a file').toBe(5);
    expect(digest, 'run `git status functions/` to see what moved')
      .toBe('ec5906416bd88b42c7e19e317722db6508831414874a3a1bda6606f78983e3d7');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 11 · no new token or dependency; no colour; no emoji; four palettes
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('11 · no new token or dependency, no colour hardcoded, no emoji', () => {
  it('package.json gained no dependency', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>; devDependencies: Record<string, string>;
    };
    // The count is the assertion: a new runtime or dev dependency moves it, and
    // `alert` is an already-installed FILE in this repo, not a package.
    expect(Object.keys(pkg.dependencies)).toHaveLength(69);
    expect(Object.keys(pkg.devDependencies)).toHaveLength(20);
  });

  it('globals.css gained no token', () => {
    const vars = new Set((read('src/app/globals.css').match(/^\s*--[\w-]+(?=\s*:)/gm) ?? [])
      .map((v) => v.trim()));
    expect(vars.size, 'a CSS custom property was added or removed').toBe(TOKEN_COUNT);
    // 🔴 And the token THE-319 built its `ui/card` rejection on STILL does not
    // exist — it appears only inside that ticket's own justification string.
    expect(vars.has('--radius-brand-xl'), '--radius-brand-xl was invented').toBe(false);
  });

  it('the modal hardcodes no NEW colour and carries no emoji', () => {
    const src = read(MODAL);
    // One pre-existing hex: the desktop Save button's `var(--brand-color,
    // #C9963A)` inline fallback. THE-323 adds none — the fix that could have
    // (a red failure banner) is the `alert` primitive on `--destructive`.
    expect((src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []), 'a hex colour literal was added')
      .toEqual(['#C9963A']);
    expect((src.match(/\b(?:rgba?|hsla?)\(/g) ?? []), 'an rgb()/hsl() literal was added')
      .toEqual([]);
    /*
     * 🔴 PINNED AS A LITERAL TALLY, NOT READ BACK FROM THE SAME FILE. A first
     * version of this computed the "expected" list by running the same regex
     * over the same source — `x === x`, a guard that could not fail. These are
     * the six palette classes the modal carried before THE-323 and still
     * carries; the numbers are what make it a pin rather than a set membership
     * test, so a SEVENTH use of an existing class fails here too.
     */
    const tally: Record<string, number> = {};
    for (const c of src.match(/\b(?:text|bg|border|ring)-(?:red|green|blue|amber|yellow|slate|gray|grey)-\d{2,3}\b/g) ?? []) {
      tally[c] = (tally[c] ?? 0) + 1;
    }
    expect(tally, 'a literal palette class was added, removed or reused').toEqual({
      'bg-red-100': 1,
      'bg-red-50': 3,
      'bg-red-600': 2,
      'text-green-600': 5,
      'text-green-700': 1,
      'text-red-600': 9,
    });
    // 🔴 NO EMOJI IN WHAT SHIPS. Scanned with the block comments stripped:
    // this repo's docblocks are full of 🔴 and ⚠️ by house style — every file
    // above does it — and the rule is about what a member sees, not about how
    // the reasoning beside it is punctuated.
    const shipped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(shipped.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu) ?? [],
      'an emoji reaches the rendered modal').toEqual([]);
  });

  it('the failure banner resolves in both palettes — Classic first', () => {
    const css = read('src/app/globals.css');
    // `alert` variant="destructive" paints `text-destructive` on `bg-card`,
    // and AlertTitle/Description read `--card-foreground` / `--muted-fore
    // ground`. Each must resolve under every palette, Classic being the
    // default since #409 and therefore the one a member sees.
    for (const family of PALETTES) {
      for (const token of ['--destructive', '--card', '--card-foreground', '--border']) {
        const scope = paletteScope(css, family);
        expect(scope, `${family} defines no ${token} — the banner would paint nothing`)
          .toMatch(new RegExp(`${token}\\s*:`));
      }
    }
  });

  const PALETTES = ['classic', 'dark'] as const;
  /** The declarations in force for a palette: its own block plus `:root`. */
  function paletteScope(css: string, family: string): string {
    const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, sel]) =>
        family === 'classic'
          ? /^\s*:root\s*$/.test(sel)
          : /\.dark|\[data-theme="dark"\]/.test(sel) || /^\s*:root\s*$/.test(sel))
      .map(([, , body]) => body);
    return blocks.join('\n');
  }

  const TOKEN_COUNT = new Set((readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8')
    .match(/^\s*--[\w-]+(?=\s*:)/gm) ?? []).map((v) => v.trim())).size;
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 12 · 🔴 no guard in this PR asserts anything about the current branch's diff
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("12 · no guard THE-323 adds asserts anything about the current branch's diff", () => {
  const MINE = [
    'src/components/__tests__/THE-323.personal-information-unlock.test.tsx',
    'src/components/__tests__/THE-323.personal-information-measure.test.tsx',
    'src/components/__tests__/__fixtures__/mobile-layer-register.ts',
  ];

  /**
   * 🔴 MATCHED AS CALLS AND IMPORTS, NEVER AS MENTIONS — because this file is
   * one of the files it checks, and a guard that flags its own description of
   * what it forbids is a guard nobody can write. A call is `execSync` FOLLOWED
   * BY AN OPEN PAREN; the bare name inside this list is not, which is why the
   * samples in the next test are split across concatenations.
   */
  const BANNED: ReadonlyArray<readonly [name: string, pattern: RegExp]> = [
    ['a child_process import', /from ['"](?:node:)?child_process['"]|require\((?:['"])(?:node:)?child_process/],
    ['a synchronous exec call', /\b(?:exec|execFile|spawn)Sync\s*\(/],
    ['a git subcommand string', /['"`]git\s+(?:diff|show|rev-parse|log|cat-file|merge-base)/],
  ];

  it.each(MINE)('%s shells out to git for nothing at all', (file) => {
    const src = read(file);
    // 🔴 Not "no non-empty diff assertion" — NO GIT AT ALL. Four guards in this
    // repo blocked every unrelated PR with an assertion that was true only
    // while their own ticket was unmerged, and THE-315 (#454) is the standing
    // sweep for that shape. The simplest way to be outside it is to need no
    // object database: every pin here reads a file from disk and compares it to
    // a literal, which gets MORE true when this ticket merges rather than less.
    for (const [what, pattern] of BANNED) {
      expect(pattern.test(src), `${file} contains ${what}`).toBe(false);
    }
  });

  it('the detector really does catch the shape it claims to', () => {
    // 🔴 The mutation, in-process: a guard that cannot fail is worse than the
    // failure it replaces. Each pattern is shown rejecting a real line of the
    // kind THE-315 exists for.
    /*
     * ⚠️ SPLIT ACROSS CONCATENATIONS ON PURPOSE. Written whole, these samples
     * are matched by the very patterns they exercise — and this file is one of
     * the files those patterns are run over, so a literal sample would fail the
     * test above. The alternative, exempting this file from its own sweep, is
     * the exemption that makes a sweep stop sweeping.
     */
    const samples = [
      "import { execSync } from 'node:child" + "_process';",
      "const out = execFile" + "Sync('git', ['diff', '--name-only', base]);",
      "const changed = run('git " + "diff --name-only origin/main');",
    ];
    for (const sample of samples) {
      expect(BANNED.some(([, p]) => p.test(sample)), `not caught: ${sample}`).toBe(true);
    }
    // And a plain read, which is what this file does, is not flagged.
    expect(BANNED.some(([, p]) => p.test("const src = readFileSync(file, 'utf8');"))).toBe(false);
  });

  it('the suite THE-323 edits keeps its own git usage and gains none', () => {
    /*
     * ⚠️ `PersonalInformationModal.desktop-layout.test.tsx` ALREADY shells out
     * to a HEAD read of this component in its "no literal colour was introduced
     * by this PR" assertion, and THE-323 neither added that nor removed it —
     * touching it
     * would be an unrelated change to a suite this ticket only rewires at one
     * line. It is recorded here so the next reader knows it was seen: it is a
     * HEAD comparison rather than a base-ref diff, so it is inert once
     * committed rather than expiring, and it is not one of THE-315's shape.
     */
    const suite = read('src/components/__tests__/PersonalInformationModal.desktop-layout.test.tsx');
    const call = new RegExp('exec' + 'Sync\\(', 'g');
    expect((suite.match(call) ?? []).length, 'THE-323 added a git call to this suite').toBe(1);
    expect(suite).toContain("show HEAD:src/components/PersonalInformationModal.tsx");
  });
});
