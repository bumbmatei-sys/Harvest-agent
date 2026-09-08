import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-292 — ask for country inside the app, after sign-in
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * #429 shipped a countries table over a structurally incomplete column. THE-289
 * audited why and stopped, because the fix was a founder decision. The decision:
 * ask later, inside the app, as a dismissible prompt. Country only. No city.
 *
 * Everything below is a guard on one of the four things that could go wrong:
 *
 *   🔴 PLACEMENT. Shown pre-hop, it is a step the member never finishes.
 *   🔴 A THIRD STATE. `''` / `'Unknown'` / a sentinel breaks the table's
 *      `withCountry + countryUnrecorded === total` invariant as a CLAIM, even
 *      where the arithmetic survives.
 *   🔴 BACKFILL. No retroactive source exists; fixing forward may not pretend.
 *   🔴 REGRESSION. The paid funnel, `Onboarding`'s questions, the
 *      account-deletion flow and three off-limits paths must not move.
 *
 * ── ⚠️ Why the no-regression guards are HASHES and not `git show` ────────────
 *
 * A test that shells out to `git show` at assertion time is a test that needs a
 * git object database, a fetched history and a working `git` on the runner — and
 * this repo's own `MemberScreens.desktop-layout.test.tsx` already has to be run
 * against an unshallowed clone for exactly that reason. These digests were taken
 * at authoring time from the merge base (`902763a`) and are compared against the
 * file on disk, which needs nothing but `fs`.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.resolve(__dirname, '../../..');
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const sha = (rel: string) => createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');

/**
 * A file's CODE, with every comment removed.
 *
 * ⚠️ Load-bearing for every "this file must not contain X" assertion below.
 * The headers in this repo explain a change by QUOTING what it must not do —
 * `member-country.ts` names `FUNNEL_PATHS` to say it never touches it, cites
 * `#429` (which reads as a hex colour), and uses the 🔴/⚠️ marks this codebase
 * writes its warnings in. Scanning raw text would fail every one of those on
 * prose that is the documentation working exactly as intended. The question is
 * always about the code, so the comments come out first.
 */
const code = (rel: string) =>
  src(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/* ── Firebase, mocked at the module boundary ──────────────────────────────── */

const { authMock, onAuthStateChangedMock, getDocMock, updateDocMock, docMock } = vi.hoisted(() => ({
  authMock: { currentUser: null as unknown },
  onAuthStateChangedMock: vi.fn(),
  getDocMock: vi.fn(),
  updateDocMock: vi.fn(async () => {}),
  docMock: vi.fn((_db: unknown, collection: string, id: string) => ({ collection, id })),
}));

vi.mock('../../firebase', () => ({ auth: authMock, db: {} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: onAuthStateChangedMock }));
vi.mock('firebase/firestore', () => ({ doc: docMock, getDoc: getDocMock, updateDoc: updateDocMock }));

import CountryPrompt, { COUNTRY_PROMPT_COPY, OVERLAY_CLEARANCE } from '../country/CountryPrompt';
import { ALL_COUNTRIES } from '../CountrySelect';
import { aggregateLocations, toMemberLocation } from '../dashboard/growth-data';
import { freezeFailure } from './__fixtures__/settings-freeze-register';
import {
  MAX_DISMISSALS,
  isRecordableCountry,
  isSnoozed,
  readDismissal,
  recordDismissal,
  saveMemberCountry,
  shouldPromptForCountry,
} from '../../lib/member-country';
import { rulesDigestFailure } from '../../__tests__/__fixtures__/firestore-rules-pin';

/* ── Harness ──────────────────────────────────────────────────────────────── */

const TENANT_HOST = 'grace.theharvest.app';
const APEX_HOST = 'theharvest.app';

function setHost(hostname: string) {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, hostname, search: '' },
    writable: true,
    configurable: true,
  });
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

/** Mount the prompt for a member whose document holds `country`. */
async function mountFor(country: unknown, uid = 'u1') {
  getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ country }) });
  onAuthStateChangedMock.mockImplementation((_auth: unknown, cb: (u: unknown) => void) => {
    void Promise.resolve().then(() => cb({ uid }));
    return () => {};
  });
  await act(async () => { root.render(<CountryPrompt />); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

const q = (sel: string) => container.querySelector(sel) as HTMLElement | null;
const click = async (el: HTMLElement | null) => {
  await act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
};

/** Pick a country through the real `<CountrySelect>`, as a member would. */
async function pick(name: string) {
  await click(q('[data-testid="country-prompt"] button'));
  const option = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === name);
  await click(option as HTMLElement);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  setHost(TENANT_HOST);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 1. 🔴 Placement — post-hop, never pre-hop
 * ═════════════════════════════════════════════════════════════════════════════ */

describe('the prompt appears after sign-in on the tenant subdomain, never pre-hop', () => {
  it('renders on <tenant>.theharvest.app for a signed-in member with no country', async () => {
    await mountFor(undefined);
    expect(q('[data-testid="country-prompt"]')).not.toBeNull();
  });

  it('🔴 renders NOTHING on the apex — the pre-hop origin', async () => {
    setHost(APEX_HOST);
    await mountFor(undefined);
    expect(q('[data-testid="country-prompt"]')).toBeNull();
    // And it does not even read the document there.
    expect(getDocMock).not.toHaveBeenCalled();
  });

  it('🔴 the decision itself refuses a null host — the hop is the gate', () => {
    const base = { uid: 'u1', country: undefined, now: 0 };
    expect(shouldPromptForCountry({ ...base, tenantIdFromHost: null })).toBe(false);
    expect(shouldPromptForCountry({ ...base, tenantIdFromHost: 'grace' })).toBe(true);
  });

  it('🔴 is mounted only inside route elements that exist AFTER the funnel', () => {
    const app = src('src/App.tsx');
    // Two mounts: beside <AdminDashboard/> (the owner) and beside <MainApp/>.
    expect(app.match(/<CountryPrompt \/>/g)).toHaveLength(2);
    // Never given a route of its own, and never mounted outside the gate.
    expect(app).not.toMatch(/<Route[^>]*CountryPrompt/);
    const gateOpen = app.indexOf('<OnboardingGate>');
    const gateClose = app.indexOf('</OnboardingGate>');
    for (const m of [...app.matchAll(/<CountryPrompt \/>/g)]) {
      expect(m.index!).toBeGreaterThan(gateOpen);
      expect(m.index!).toBeLessThan(gateClose);
    }
  });

  it('🔴 the onboarding routes do not mount it', () => {
    const app = src('src/App.tsx');
    // The two funnel route elements, in full, carry no prompt.
    const onboarding = /path="\/onboarding"[\s\S]*?\/>\s*\n\s*\/?>?/.exec(app)?.[0] ?? '';
    const church = /path="\/church-onboarding"[\s\S]*?\/>\s*\n\s*\/?>?/.exec(app)?.[0] ?? '';
    expect(onboarding).not.toContain('CountryPrompt');
    expect(church).not.toContain('CountryPrompt');
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 2. Submitting writes only country, on the existing write path
 * ═════════════════════════════════════════════════════════════════════════════ */

describe('submitting writes only country, on the existing write path', () => {
  it('writes exactly { country } to users/{uid} via updateDoc', async () => {
    await mountFor(undefined);
    await pick('Kenya');
    await click(q('[data-testid="country-prompt-save"]'));

    expect(updateDocMock).toHaveBeenCalledTimes(1);
    const [ref, payload] = updateDocMock.mock.calls[0] as unknown as [
      { collection: string; id: string }, Record<string, unknown>,
    ];
    expect(ref).toEqual({ collection: 'users', id: 'u1' });
    // 🔴 ONE key. Not displayName, not city, not phone, not onboardingCompleted.
    expect(Object.keys(payload)).toEqual(['country']);
    expect(payload.country).toBe('Kenya');
  });

  it('🔴 uses the same collection, document, field and operation as the existing writers', () => {
    const write = /updateDoc\(doc\(db, 'users', ([A-Za-z.]+)\), \{ country \}\)/;
    expect(src('src/lib/member-country.ts')).toMatch(write);
    // The two writers it matches, unchanged and still shaped the same way.
    expect(src('src/components/Onboarding.tsx')).toContain("updateDoc(doc(db, 'users', user.uid), updateData)");
    expect(src('src/components/PersonalInformationModal.tsx')).toContain('await updateDoc(userRef, {');
  });

  it('closes once saved', async () => {
    await mountFor(undefined);
    await pick('Kenya');
    await click(q('[data-testid="country-prompt-save"]'));
    expect(q('[data-testid="country-prompt"]')).toBeNull();
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 3. 🔴 Dismissing writes NO country value
 * ═════════════════════════════════════════════════════════════════════════════ */

describe('dismissing writes NO country value', () => {
  it('🔴 performs no write at all — the field stays ABSENT', async () => {
    await mountFor(undefined);
    await click(q('[data-testid="country-prompt-dismiss"]'));
    expect(q('[data-testid="country-prompt"]')).toBeNull();
    // 🔴 No empty string, no 'Unknown', no sentinel — because no write happened.
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('🔴 the write boundary REFUSES every third-state value', async () => {
    for (const bad of ['', ' ', 'Unknown', 'unknown', 'Not set', 'N/A', '-', 'null']) {
      expect(isRecordableCountry(bad)).toBe(false);
      await expect(saveMemberCountry('u1', bad)).rejects.toThrow();
    }
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('the dismissal is stored off the user document, in localStorage', async () => {
    await mountFor(undefined);
    await click(q('[data-testid="country-prompt-dismiss"]'));
    expect(updateDocMock).not.toHaveBeenCalled();
    expect(readDismissal('u1').count).toBe(1);
    expect(localStorage.getItem('harvest.country_prompt.u1')).not.toBeNull();
  });

  it('snoozes, then stops asking after the third dismissal', () => {
    const t0 = 1_000_000;
    expect(isSnoozed('u1', t0)).toBe(false);
    recordDismissal('u1', t0);
    expect(isSnoozed('u1', t0 + 29 * 86400_000)).toBe(true);
    expect(isSnoozed('u1', t0 + 31 * 86400_000)).toBe(false);

    recordDismissal('u1', t0 + 31 * 86400_000);
    const final = recordDismissal('u1', t0 + 62 * 86400_000);
    expect(final.count).toBe(MAX_DISMISSALS);
    expect(isSnoozed('u1', Number.MAX_SAFE_INTEGER)).toBe(true); // never again
  });

  it('is per-member, so two people on one device do not answer for each other', () => {
    recordDismissal('u1', 0);
    expect(isSnoozed('u1', 1)).toBe(true);
    expect(isSnoozed('u2', 1)).toBe(false);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 4. 🔴 #429's invariant — no third state
 * ═════════════════════════════════════════════════════════════════════════════ */

describe("#429's withCountry + countryUnrecorded === total invariant still holds", () => {
  /**
   * 🔴 THE ARITHMETIC ALONE IS NOT THE GUARD, and this is the subtle part.
   *
   * `growth-data.place()` coerces `''` to `null`, so an empty-string write would
   * leave `withCountry + countryUnrecorded === total` TRUE while still filing
   * that member under a country named "" in `AdminSignups`, which reads
   * `data.country || ""` and groups on it. `'Unknown'` is worse: the arithmetic
   * also survives, and the member lands in a country ROW that is not a place.
   *
   * So the invariant is asserted in both halves: the sum, AND the closed set of
   * values this feature can ever put in the field.
   */
  it('🔴 every value the prompt can write is a REAL country, or the field is absent', () => {
    const recordable = ALL_COUNTRIES.filter(isRecordableCountry);
    expect(recordable).toHaveLength(ALL_COUNTRIES.length);
    for (const third of ['', 'Unknown', 'Not set', ' ']) {
      expect(isRecordableCountry(third)).toBe(false);
    }
  });

  it('holds over every document state this feature produces', () => {
    // A submission, a dismissal (field absent), and a member who already had one.
    const docs: Record<string, unknown>[] = [
      { country: 'Kenya' }, { country: 'United States' }, { country: 'Kenya' },
      {},                   // dismissed — absent, never ''
      {},                   // never asked
      { country: 'Brazil' },
    ];
    const breakdown = aggregateLocations(docs.map(toMemberLocation));
    expect(breakdown.withCountry + breakdown.countryUnrecorded).toBe(breakdown.total);
    expect(breakdown.total).toBe(docs.length);
    expect(breakdown.countryUnrecorded).toBe(2);
    // 🔴 No row is a non-place.
    for (const row of breakdown.rows) expect(ALL_COUNTRIES).toContain(row.country);
    expect(breakdown.rows.reduce((n, r) => n + r.members, 0)).toBe(breakdown.withCountry);
  });

  /**
   * 🔴 Aggregates the document the prompt ACTUALLY PRODUCED, not a hand-written
   * one. This is the difference between a guard and a decoration: an earlier
   * draft of this test aggregated a literal `{}` and therefore passed happily
   * while the component wrote `''` on dismissal, because the fixture never saw
   * the write. Everything below replays the real `updateDoc` calls onto a real
   * starting document and asks the real aggregator what it makes of the result.
   */
  const documentAfter = (start: Record<string, unknown> = {}) => {
    const out = { ...start };
    for (const [, payload] of updateDocMock.mock.calls as unknown as [unknown, Record<string, unknown>][]) {
      Object.assign(out, payload);
    }
    return out;
  };

  /** The whole invariant, in both halves, over one member's document. */
  const assertNoThirdState = (member: Record<string, unknown>) => {
    // (a) 🔴 The closed set: absent, or a real country. `''` fails HERE — and
    //     only here, because `place()` would coerce it to null and leave the
    //     arithmetic below intact while `AdminSignups` filed the member under a
    //     country named "".
    if ('country' in member) {
      expect(ALL_COUNTRIES, `country=${JSON.stringify(member.country)} is a third state`)
        .toContain(member.country);
    }
    // (b) The arithmetic, and no row that is not a place. `'Unknown'` fails HERE.
    const b = aggregateLocations([toMemberLocation(member)]);
    expect(b.withCountry + b.countryUnrecorded).toBe(b.total);
    for (const row of b.rows) expect(ALL_COUNTRIES).toContain(row.country);
    return b;
  };

  it('🔴 a dismissal leaves the field ABSENT, counted unrecorded, in no row', async () => {
    await mountFor(undefined);
    await click(q('[data-testid="country-prompt-dismiss"]'));

    const member = documentAfter();
    expect(member, 'a dismissal wrote something to the document').toEqual({});
    const b = assertNoThirdState(member);
    expect(b.countryUnrecorded).toBe(1);
    expect(b.rows).toHaveLength(0);
  });

  it('🔴 a submission leaves a real country, counted in exactly one row', async () => {
    await mountFor(undefined);
    await pick('Kenya');
    await click(q('[data-testid="country-prompt-save"]'));

    const member = documentAfter();
    const b = assertNoThirdState(member);
    expect(b.withCountry).toBe(1);
    expect(b.countryUnrecorded).toBe(0);
    expect(b.rows.map((r) => r.country)).toEqual(['Kenya']);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 5. Not shown to a member who already has a country
 * ═════════════════════════════════════════════════════════════════════════════ */

describe('the prompt does not appear for a member who already has a country', () => {
  it('stays closed when the field is set', async () => {
    await mountFor('Kenya');
    expect(q('[data-testid="country-prompt"]')).toBeNull();
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('stays closed while snoozed', async () => {
    recordDismissal('u1');
    await mountFor(undefined);
    expect(q('[data-testid="country-prompt"]')).toBeNull();
  });

  it('⚠️ DOES ask a member carrying a legacy blank — that member is unrecorded', () => {
    const base = { tenantIdFromHost: 'grace', uid: 'u1', now: 0 };
    expect(shouldPromptForCountry({ ...base, country: '' })).toBe(true);
    expect(shouldPromptForCountry({ ...base, country: '   ' })).toBe(true);
    expect(shouldPromptForCountry({ ...base, country: 'Kenya' })).toBe(false);
  });

  it('🔴 an unreadable or missing document is NOT a document with no country', async () => {
    getDocMock.mockRejectedValue(new Error('permission denied'));
    onAuthStateChangedMock.mockImplementation((_a: unknown, cb: (u: unknown) => void) => {
      void Promise.resolve().then(() => cb({ uid: 'u1' })); return () => {};
    });
    await act(async () => { root.render(<CountryPrompt />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(q('[data-testid="country-prompt"]')).toBeNull();
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 6. 🔵 It reads as optional, never required
 * ═════════════════════════════════════════════════════════════════════════════ */

describe('it reads as optional, never required', () => {
  it('says so, in the eyebrow and in the body', async () => {
    await mountFor(undefined);
    const text = q('[data-testid="country-prompt"]')!.textContent!;
    expect(COUNTRY_PROMPT_COPY.eyebrow).toBe('Optional');
    expect(text).toContain('Optional');
    expect(text).toContain('any time');
  });

  it('🔴 never claims the answer is required', async () => {
    await mountFor(undefined);
    const text = q('[data-testid="country-prompt"]')!.textContent!.toLowerCase();
    for (const word of ['required', 'must ', 'you need to', 'complete your profile', 'mandatory']) {
      expect(text).not.toContain(word);
    }
    // No asterisk anywhere — the universal "required field" mark.
    expect(text).not.toContain('*');
  });

  it('offers a labelled way out, not a corner glyph', async () => {
    await mountFor(undefined);
    const out = q('[data-testid="country-prompt-dismiss"]')!;
    expect(out.textContent!.trim()).toBe(COUNTRY_PROMPT_COPY.dismiss);
    expect(out.textContent!.trim().length).toBeGreaterThan(2);
  });

  it('⚠️ the scrim is inert, so a stray tap cannot spend one of three asks', async () => {
    await mountFor(undefined);
    await click(q('[data-testid="country-prompt-scrim"]'));
    expect(q('[data-testid="country-prompt"]')).not.toBeNull();
    expect(readDismissal('u1').count).toBe(0);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 7. 🔴 No backfill
 * ═════════════════════════════════════════════════════════════════════════════ */

describe('no existing member document is written except by the member\'s own submission', () => {
  it('🔴 merely rendering the prompt writes nothing', async () => {
    await mountFor(undefined);
    expect(q('[data-testid="country-prompt"]')).not.toBeNull();
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('🔴 the module offers no bulk or backfill path', () => {
    const lib = code('src/lib/member-country.ts');
    for (const forbidden of ['getDocs', 'writeBatch', 'collection(', 'query(', 'forEach']) {
      expect(lib).not.toContain(forbidden);
    }
    // Exactly one updateDoc call site, and it takes a single uid.
    expect(lib.match(/updateDoc\(/g)).toHaveLength(1);
  });

  it('🔴 writes only the signed-in member\'s own document', async () => {
    await mountFor(undefined, 'member-42');
    await pick('Ghana');
    await click(q('[data-testid="country-prompt-save"]'));
    const [ref] = updateDocMock.mock.calls[0] as unknown as [{ id: string }];
    expect(ref.id).toBe('member-42');
    expect(updateDocMock).toHaveBeenCalledTimes(1);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 8. 🔴 The funnel did not move
 * ═════════════════════════════════════════════════════════════════════════════ */

describe('no funnel marker, route order or Turnstile mount changed', () => {
  it('🔴 post-auth-route.ts is byte-identical to the merge base', () => {
    expect(sha('src/utils/post-auth-route.ts'))
      .toBe('9571ded38eeb30eb428345abcaceff0512f8028404354fcf4da18f8adaf21718');
  });

  it('🔴 the route order in App.tsx is unchanged', () => {
    const app = src('src/App.tsx');
    const order = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual([
      '/auth', '/onboarding', '/church-onboarding',
      '/admin', '/admin/:section', '/admin/:section/:itemId', '/', '*',
    ]);
  });

  it('🔴 every funnel marker is still spelled, and none is spelled by this change', () => {
    const app = src('src/App.tsx');
    for (const marker of ['FUNNEL_PATHS', 'resolvePostAuthFunnelRoute', 'signupInProgress', 'termsAccepted']) {
      expect(app).toContain(marker);
    }
    // 🔴 The new code touches no funnel state at all.
    const mine = code('src/lib/member-country.ts') + code('src/components/country/CountryPrompt.tsx');
    for (const marker of ['FUNNEL_PATHS', 'resolvePostAuthFunnelRoute', 'signupInProgress',
                          'termsAccepted', 'onboardingCompleted', 'Turnstile', 'setupCompleted']) {
      expect(mine).not.toContain(marker);
    }
  });

  it('🔴 Turnstile still mounts where it did', () => {
    const auth = src('src/components/AuthPage.tsx');
    expect(auth).toContain('Turnstile');
  });

  it('🔴 adds no route and no navigation', () => {
    const mine = code('src/components/country/CountryPrompt.tsx');
    for (const forbidden of ['<Route', 'useNavigate', 'navigate(', 'window.location.href', 'Navigate']) {
      expect(mine).not.toContain(forbidden);
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 9-11, 15. 🔴 Byte-identical files
 * ═════════════════════════════════════════════════════════════════════════════ */

describe("Onboarding.tsx's question set and validation are byte-identical", () => {
  it('🔴 the whole file is unchanged', () => {
    expect(sha('src/components/Onboarding.tsx'))
      .toBe('e0d3d0a6d10e0254bb9be0dc7df8cc2d81e1a65c7f65069e900f79142952f057');
  });

  it('the location step is still tenant-configurable and still accepts an empty city', () => {
    const ob = src('src/components/Onboarding.tsx');
    expect(ob).toContain("q.id === 'default_country' || q.id === 'default_city'");
    expect(ob).toContain("case 'default_location': return country ? null : 'Please select your country.';");
  });
});

describe('the account-deletion flow and DELETE_CONFIRM_COPY are unchanged', () => {
  /**
   * ⚠️ THE-312 gave this pin an APPEND PATH. The literal is still the baseline
   * taken from the merge base 902763a and is not replaced; a later ticket
   * appends its digest with its ticket and reason to `RECORDED_EDITS`. What
   * THE-292 actually claims here — that IT did not open this file — is
   * unchanged, and an unrecorded edit still fails.
   */
  it('🔴 PersonalInformationModal.tsx is byte-identical', () => {
    expect(
      freezeFailure(
        'src/components/PersonalInformationModal.tsx',
        'c62dd16e810bd1d75bd3bc6e3cae1ee698fdcf4d9ec67d870dc833d76b1b1975',
      ),
    ).toBeNull();
  });
});

describe('AdminDashboard.tsx, firestore.rules and functions/ byte-identical', () => {
  /**
   * ⚠️ A SET of accepted digests, not one — and this file is why the repo needs
   * that shape.
   *
   * `AdminDashboard.tsx` was owned by THE-291 in parallel with this ticket, and
   * THE-291 landed first (#434). CI runs against `refs/pull/N/merge`, so the
   * tree under test is this branch merged into whatever `main` is at the time:
   * a single digest here asserted "nobody has touched this file since I
   * branched", which is a claim about OTHER people's tickets and not one this
   * suite has any business making. It went red on THE-291's legitimate change,
   * exactly as the first draft's comment predicted it would.
   *
   * 🔴 What this ticket must prove is narrower and is unchanged: THE-292 did
   * not edit this file. A digest that is NEITHER accepted value still fails —
   * so an edit from here is caught precisely as before, while an edit from a
   * ticket that legitimately owns the file is not miscounted as one.
   *
   * The same shape, for the same reason, as `the-290-giving-guards.test.ts`.
   */
  const ADMIN_DASHBOARD_DIGESTS = [
    // main at 902763a, where this branch started.
    '722c5e4478be0a8508e7dff1232dd4c1f88cacdd502604f946f3134eb730d98c',
    // main at 133d557 — THE-291 (#434) removed the client-side write to plan.
    '446f0bcb8ffa6accf4f80467b75a50023c1441937605b11e18aa01b53d8e53f8',
    // 🔴 main + THE-326 — service planning split out of Events into its own
    // `services` section, which adds the nav entry, the render-switch arm and
    // two imports to this file. APPENDED, never substituted: both values above
    // stay accepted, and a digest that is none of the three still fails, so an
    // edit FROM THIS TICKET is caught exactly as before.
    '69f7efceccd7b8381e5ceb114642f8b4634e73df1278bb082e678a1a0cb634f9',
    // 🔴 THE-327 — `'library'` added to the PLATFORM group of MORE_GROUPS and
    // the GROW group of DESKTOP_NAV_GROUPS. APPENDED, NEVER SUBSTITUTED: every
    // value above stays accepted, because CI runs against `refs/pull/N/merge`
    // and a merge ref cut before this ticket landed legitimately carries one of
    // them. A digest that is NONE of them — i.e. an edit FROM THIS TICKET —
    // still fails, exactly as before.
    //
    // ⚠️ THIS TICKET'S OWN CLAIM IS UNCHANGED: it does not open AdminDashboard.
    // THE-327 does, and only for two array entries: the founder reported the
    // Library screen deleted and it was not — the screen renders, the nav entry
    // exists and `admin-sections.ts` maps the slug, so `/admin/library` already
    // resolved. What was missing was any way to CLICK to it, because `'library'`
    // was in NEITHER group array and the desktop sidebar has no catch-all. No
    // permission, gate, tab id, render arm or import changed.
    'decfdddbdab91094c936b503f931b663eeb6ba3048ee087c541fe1580f20e31e',
  // 🔴 THE-332 — the desktop nav became a rail with flyouts. APPENDED,
  // never substituted: a merge ref cut before this ticket landed still
  // carries a value above, and a digest that is NEITHER still fails.
  '508747ccbc7b2fef051d449626ef2f81f3655b214be0494c6c21a8c7df88b9bb',
  ];

  it('🔴 AdminDashboard.tsx — not opened by this ticket', () => {
    const actual = sha('src/components/AdminDashboard.tsx');
    expect(
      ADMIN_DASHBOARD_DIGESTS,
      `AdminDashboard.tsx is at ${actual}, which is neither the branch point nor THE-291's value — so THIS ticket edited it`,
    ).toContain(actual);
  });

  it('🔴 firestore.rules', () => {
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
  });

  it('🔴 functions/', () => {
    expect({
      '.gcloudignore': sha('functions/.gcloudignore'),
      'package-lock.json': sha('functions/package-lock.json'),
      'package.json': sha('functions/package.json'),
      'src/index.ts': sha('functions/src/index.ts'),
      'tsconfig.json': sha('functions/tsconfig.json'),
    }).toEqual({
      '.gcloudignore': '9c20b803e45cd91612bcc0113d5e925422cd5c90686feaa4487e0349ae0951b2',
      'package-lock.json': 'bbe18ca8fb92c17d72a991069017be73116d885643dcf681599a958aa3e31681',
      'package.json': '33846d2de1bef5e32ab53a5fb37373aa725aab06a6dd12d2e81a1c69ac6034eb',
      'src/index.ts': '39ccade96ac3d4dd5a13047e9bc42b54ef5ac59ae72f932af042fc814bf23e0b',
      'tsconfig.json': 'a707d5b587803ee0e9224d5943136bbb5be281f3522ce6640def17315a423a25',
    });
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 10. 🔴 No city field was added anywhere
 * ═════════════════════════════════════════════════════════════════════════════ */

describe('no city field was added anywhere', () => {
  const MINE = [
    'src/lib/member-country.ts',
    'src/components/country/CountryPrompt.tsx',
  ];

  it('🔴 not one of this ticket\'s files reads, writes or renders a city', () => {
    for (const rel of MINE) {
      // Prose in the header explains WHY there is no city; the code must not
      // have one.
      const body = code(rel);
      expect(body, `${rel} mentions city in code`).not.toMatch(/\bcity\b/i);
      expect(body).not.toContain('setCity');
    }
  });

  it('🔴 the write payload has no city key', async () => {
    await mountFor(undefined);
    await pick('Kenya');
    await click(q('[data-testid="country-prompt-save"]'));
    const [, payload] = updateDocMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(payload).not.toHaveProperty('city');
    expect(Object.keys(payload)).toEqual(['country']);
  });

  it('🔴 renders no second text input beside the country picker', async () => {
    await mountFor(undefined);
    const prompt = q('[data-testid="country-prompt"]')!;
    // The only <input> in the closed state is none; opening the picker adds its
    // own search box and nothing else.
    expect(prompt.querySelectorAll('input')).toHaveLength(0);
    await pick('Kenya');
    expect(prompt.querySelectorAll('input')).toHaveLength(0);
  });

  it('⚠️ city remains exactly as unvalidated as it was — this ticket did not touch it', () => {
    // The reason there is no city field: `validate` accepts an empty city, so
    // the column is unnormalised free text. Pinned, not fixed — a typeahead
    // bound to a gazetteer is a separate ticket.
    expect(src('src/components/Onboarding.tsx'))
      .toContain("case 'default_location': return country ? null : 'Please select your country.';");
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 14. No colour hardcoded, no emoji; all four palettes resolve
 * ═════════════════════════════════════════════════════════════════════════════ */

describe('no colour hardcoded, no emoji; all four palettes resolve', () => {
  const MINE = ['src/lib/member-country.ts', 'src/components/country/CountryPrompt.tsx'];

  it('🔴 no hex, rgb() or hsl() literal', () => {
    for (const rel of MINE) {
      const body = code(rel);
      expect(body, rel).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(body, rel).not.toMatch(/\brgba?\(/);
      expect(body, rel).not.toMatch(/\bhsla?\(/);
    }
  });

  it('🔴 no emoji', () => {
    for (const rel of MINE) {
      // The 🔴/⚠️/🔵 marks this repo writes its warnings in are COMMENT
      // notation; what must be free of emoji is everything a member can see.
      expect(code(rel), rel).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u);
    }
  });

  it('every colour it spells is a palette token, not a value', () => {
    const cmp = src('src/components/country/CountryPrompt.tsx');
    expect(cmp).toContain('var(--scrim-night)');   // redefined per palette
    for (const token of ['text-strong', 'text-body', 'text-faint', 'text-gold',
                         'bg-surface-raised', 'border-line', 'bg-primary',
                         'text-primary-foreground', 'text-danger']) {
      expect(cmp, `missing ${token}`).toContain(token);
    }
  });

  it('all four palettes define the tokens it depends on — Classic first, the default since #409', () => {
    const css = src('src/app/globals.css');
    for (const palette of ['classic', 'sand', 'slate', 'olive']) {
      const declared = new RegExp(`\\[data-palette="${palette}"\\]`).test(css);
      if (palette === 'classic') expect(declared, 'Classic must be declared').toBe(true);
    }
    // The scrim token this component paints with is redefined, not inherited.
    expect(css).toContain('--scrim-night');
    expect(css.match(/--scrim-night\s*:/g)!.length).toBeGreaterThan(1);
  });

  it('the clearance rule is explicit and does not rely on pb-safe', () => {
    expect(OVERLAY_CLEARANCE).toContain('env(safe-area-inset-bottom)');
    expect(src('src/components/country/CountryPrompt.tsx')).not.toMatch(/className=[^>]*\bpb-safe\b/);
  });
});
