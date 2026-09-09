import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { rulesDigestFailure } from '../../__tests__/__fixtures__/firestore-rules-pin';

/* 🔴 THE-335 — THE MASTER SWITCH IS MOCKED ON.
   `SMS_FEATURE_ENABLED` is false on disk again, and `AdminSms` and `SmsSection`
   are one-line wrappers that render `null` while it is — so without this every
   assertion in this file would measure an empty string and the suite would pass
   while proving nothing about the composition it exists to pin. That is the
   failure mode this repo has been bitten by eleven times.

   ⚠️ MOCKED RATHER THAN THE SUITE DELETED OR SKIPPED. The switch's whole design
   is that the feature comes back INTACT; these suites are what proves it is
   still intact, so they have to keep running. `the-245-sms-hidden.test.ts` is
   where "no surface is reachable today" is asserted. */
vi.mock('../../lib/sms-feature', () => ({
  SMS_FEATURE_ENABLED: true,
  SMS_HIDDEN_MESSAGE: 'SMS is temporarily unavailable.',
}));


/**
 * THE-327 — SMS lives in ONE place, and the Library screen is reachable.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The defect, in the founder's words ──────────────────────────────────────
 *
 *   "put all the features of sms in the sms section. not here"
 *   "don't make the user go in 10 different places for one thing"
 *
 * He was right, and it was verifiable in the tree: `AdminSms.tsx` held
 * broadcast and automated messages, while the ENTIRE number lifecycle —
 * country, area code, availability, buy, release, the identity-check link —
 * lived in `settings/SmsSection.tsx`, three levels deep behind Settings →
 * Connected Services → SMS. A church that wanted to text had to buy its number
 * on one screen and send from another.
 *
 * ── 🔴 What this suite exists to catch ──────────────────────────────────────
 *
 * Every assertion below was MUTATION-VERIFIED: the change it describes was
 * planted, the named test was confirmed to fail, and the change reverted. That
 * matters more than usual here, because eight guards in this series passed a
 * planted defect — one of them with its own gate DELETED, because the
 * assertion's own message contained the string it grepped for. So the
 * behavioural claims below are asserted in a RENDERED DOM wherever a rendered
 * DOM can carry them, and the source greps that remain are stripped of
 * comments first (`codeOf`) so a sentence in a docblock can never satisfy one.
 *
 * ⚠️ Nothing here shells out to `git` at assertion time and nothing here reads
 * the current branch's diff (#454's standing sweep) — every claim is about the
 * files as they are on disk.
 */

const SRC = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

/**
 * 🔴 COMMENTS STRIPPED BEFORE EVERY SOURCE GREP.
 *
 * This is the single most important helper in the file. A guard that greps raw
 * source is satisfied by its own explanation: this suite's own docblock names
 * `SmsSection`, `/api/sms/numbers` and `library`, and a naive `toContain` would
 * read those as the thing it was asked to find. Block comments, line comments
 * and JSX comments all go.
 */
const codeOf = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

/**
 * 🔴 CODE WITH ITS STRING AND REGEX *CONTENT* BLANKED — what a sweep over
 * assertions has to read.
 *
 * ⚠️ THIS WAS NOT THEORETICAL. Section 21 below sweeps this suite's own files
 * for `execFileSync`, and on the first run it FAILED — on the regex literal
 * inside its own assertion. That is precisely the recorded failure mode: a
 * guard satisfied by the string it greps for, which is how eight guards in
 * this series passed a planted defect. Blanking the CONTENT (never the
 * delimiters, so the code still parses the same shape) is what makes such a
 * sweep read the program rather than its own text.
 */
const blankLiterals = (code: string) =>
  code
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/\/(?![*/])(?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+\/[gimsuy]*/g, '/./');

/* ═══════════════════════════════════════════════════════════════════════════
   Harness — a real React DOM, with the SMS endpoints answered.
   ═══════════════════════════════════════════════════════════════════════════ */

const json = (body: unknown) => Promise.resolve({
  ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(''),
});

/** Mutable so one test can choose the no-number state and another the live
 *  one. `vi.hoisted` because the mock factory is hoisted above everything. */
const numbersAnswer = vi.hoisted(() => ({
  value: null as null | Record<string, unknown>,
}));

vi.mock('../../utils/auth-fetch', () => ({
  authFetch: vi.fn((url: string) => {
    const u = String(url);
    /**
     * ⚠️ ADDED BY THE-330. The get-a-number form now reads the provider's
     * country catalogue before it can draw a picker. This harness answered every
     * `/api/sms/numbers` URL with `{ number: … }`, which the panel correctly
     * reads as a FAILED catalogue fetch and renders as a failure alert instead
     * of the form — so section 1's "the lifecycle is on the SMS screen" claim
     * would have been asserted against an error state.
     *
     * 🔴 THE FIXTURE IS THE PROVIDER'S SHAPE AND THE TICKET'S HARD CASE: GB,
     * whose country-level `smsAvailable` is FALSE (it mirrors the default type)
     * while its `mobile` type texts, alongside US whose `local` texts and whose
     * `toll_free` does not.
     */
    if (u.includes('countries=1')) {
      return json({
        countries: [
          {
            code: 'US', tier: 1, monthlyCents: 300, needsKyc: false,
            callsAvailable: true, whatsappAvailable: true, smsAvailable: true, inStock: true,
            types: [
              { numberType: 'local', smsAvailable: true, whatsappAvailable: true, callsAvailable: true, monthlyCents: 300, needsKyc: false, fulfilment: 'instant', inStock: true },
              { numberType: 'toll_free', smsAvailable: false, whatsappAvailable: false, callsAvailable: true, monthlyCents: 300, needsKyc: false, fulfilment: 'instant', inStock: true },
            ],
          },
          {
            code: 'GB', tier: 2, monthlyCents: 300, needsKyc: true,
            callsAvailable: true, whatsappAvailable: true, smsAvailable: false, inStock: true,
            types: [
              { numberType: 'local', smsAvailable: false, whatsappAvailable: true, callsAvailable: true, monthlyCents: 300, needsKyc: true, fulfilment: 'instant', inStock: true },
              { numberType: 'mobile', smsAvailable: true, whatsappAvailable: true, callsAvailable: true, monthlyCents: 300, needsKyc: true, fulfilment: 'instant', inStock: true },
            ],
          },
        ],
        fetchedAt: null,
      });
    }
    if (u.includes('areas=1')) return json({ areaOptions: [{ ndc: '615', name: 'Nashville, TN', count: 42 }] });
    if (u.startsWith('/api/sms/numbers')) return json({ number: numbersAnswer.value });
    if (u.startsWith('/api/sms-usage')) {
      return json({ metered: true, source: 'platform', smsSegmentsUsed: 10, smsSegmentsCap: 2000, month: '2026-01' });
    }
    if (u.startsWith('/api/sms/config')) return json({ templates: {}, text2give: { keyword: 'GIVE', enabled: true } });
    return json({});
  }),
}));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: null } }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), query: vi.fn(), orderBy: vi.fn(), limit: vi.fn(),
  onSnapshot: vi.fn(() => () => {}), doc: vi.fn(), getDoc: vi.fn(), Timestamp: {},
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: () => ({ currentTenantId: 'grace', isAuthReady: true, isSuperAdmin: false }),
}));

const LIVE_NUMBER = {
  phoneNumber: '+16155550123', status: 'active', monthlyCostUsd: 3, country: 'US',
  purchasedAt: '2019-03-14T10:00:00.000Z',   // deliberately long past — see section 20
};

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  numbersAnswer.value = null;
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  host.remove();
  vi.restoreAllMocks();
  vi.resetModules();
});

const render = async (el: React.ReactElement) => {
  root = createRoot(host);
  await act(async () => { root!.render(el); });
};

/** Mount the SMS section itself. */
const openSms = async () => {
  const { default: AdminSms } = await import('../AdminSms');
  await render(<AdminSms />);
  return host;
};

const clickTab = async (label: string) => {
  const trigger = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  expect(trigger, `the ${label} tab is missing`).toBeTruthy();
  await act(async () => { trigger!.click(); });
};

/* ═══════════════════════════════════════════════════════════════════════════
   1 · 🔴 The SMS section contains the WHOLE number lifecycle — named per part.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('1 · the SMS section contains the whole number lifecycle', () => {
  /**
   * 🔴 NAMED PER PART, not asserted as "the panel is there". The founder's
   * complaint was about the LIFECYCLE being split, so each stage of it is its
   * own claim and a partial move fails the specific stage it dropped.
   */
  it('get-a-number: country, area code and check-availability are on the SMS screen', async () => {
    await openSms();                       // no number → this is the landing state
    const text = host.textContent || '';
    expect(text, 'the country field left the SMS section').toMatch(/country/i);
    expect(text, 'the area code field left the SMS section').toMatch(/area code/i);
    expect(text, 'check availability left the SMS section').toMatch(/check availability/i);
    expect(text, 'the buy action left the SMS section').toMatch(/buy a number/i);
  });

  it('the number summary — phone number, status and monthly cost — is on the SMS screen', async () => {
    numbersAnswer.value = LIVE_NUMBER;
    await openSms();
    await clickTab('Number');
    const text = host.textContent || '';
    expect(text, 'the number itself is not shown').toContain('+16155550123');
    expect(text, 'the status is not shown').toMatch(/able to send and receive/i);
    expect(text, 'the monthly cost is not shown').toMatch(/\$3\.00 \/ month/);
  });

  it('release — and its irreversibility warning — is on the SMS screen', async () => {
    numbersAnswer.value = LIVE_NUMBER;
    await openSms();
    await clickTab('Number');
    const release = [...host.querySelectorAll('button')]
      .find((b) => /release this number/i.test(b.textContent || ''));
    expect(release, 'release left the SMS section').toBeTruthy();
    // 🔴 Two taps, with the warning between them — asserted by clicking, so a
    // warning that exists in the source but never reaches the screen fails.
    await act(async () => { release!.click(); });
    const { RELEASE_WARNING } = await import('../settings/SmsSection');
    expect(host.textContent, 'the release warning never reaches the screen').toContain(RELEASE_WARNING);
  });

  it('the identity-check link is rendered by the SMS section, as `ui/button`', async () => {
    /* Rendered only after a KYC 202, which needs a live purchase — so this is
       asserted at the call site, on the file the SMS section now mounts. The
       DOM claim it supports (that it is a primitive and not a hand-rolled
       anchor) is THE-318's and is unchanged. */
    const src = read('components/settings/SmsSection.tsx');
    expect(src, 'the identity-check action is no longer a Button').toMatch(
      /<Button[\s\S]{0,400}?render=\{<a[\s\S]{0,200}?href=\{kycUrl\}/,
    );
    expect(codeOf(read('components/AdminSms.tsx')), 'the SMS section does not mount the panel')
      .toContain('SmsNumberPanel');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2 · 🔴 Settings no longer contains the lifecycle — and what remains is named.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('2 · settings no longer contains the number lifecycle', () => {
  /**
   * ⚠️ WHAT REMAINS IS A POINTER ROW, and that was a decision, not an
   * accident. `AdminSettings.regroup.test.tsx` pins the accordion's structure
   * and its row → component mapping; removing the row would break that
   * structure, which is STOP condition 7. An admin who learned to look under
   * Connected Services is also better served by one sentence saying where SMS
   * went than by a row that silently disappeared. What is NOT kept is a row
   * that opens onto nothing — the failure THE-250 named.
   */
  it('🔴 the Settings row renders a signpost, not the purchase controls', async () => {
    const { default: SmsSection } = await import('../settings/SmsSection');
    await render(<SmsSection />);
    const text = host.textContent || '';
    expect(text, 'the get-a-number form is STILL in Settings').not.toMatch(/area code/i);
    expect(text, 'the buy action is STILL in Settings').not.toMatch(/buy a number/i);
    expect(text, 'the release action is STILL in Settings').not.toMatch(/release this number/i);
    expect(text, 'the availability check is STILL in Settings').not.toMatch(/check availability/i);
  });

  it('what remains is named: a sentence and a link to the SMS section', async () => {
    const { default: SmsSection, SMS_MOVED_NOTE } = await import('../settings/SmsSection');
    await render(<SmsSection />);
    expect(host.textContent, 'the row opens onto nothing, which is worse than no row')
      .toContain(SMS_MOVED_NOTE);
    const link = host.querySelector('a[href="/admin/sms"]');
    expect(link, 'the signpost does not actually point anywhere').toBeTruthy();
    expect(link!.getAttribute('data-slot'), 'the link is hand-rolled, not `ui/button`').toBe('button');
  });

  it('🔴 the settings row makes no /api/sms/numbers request of its own', async () => {
    /* The lifecycle moved; the request has to move with it. A Settings row
       still polling the numbers endpoint would mean two owners of one
       document, which is how the two screens drifted in the first place. */
    const { authFetch } = await import('../../utils/auth-fetch');
    vi.mocked(authFetch).mockClear();
    const { default: SmsSection } = await import('../settings/SmsSection');
    await render(<SmsSection />);
    for (const call of vi.mocked(authFetch).mock.calls) {
      expect(String(call[0]), 'Settings still owns a piece of the lifecycle')
        .not.toContain('/api/sms/numbers');
    }
  });

  it('the accordion still mounts SmsSection, so the row itself is not removed', () => {
    const src = read('components/AdminSettings.tsx');
    expect(src, "the SMS row's component was removed rather than repointed").toMatch(/<SmsSection\s*\/>/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2b/2c · 🔴 The Library screen is reachable, and still super-admin only.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('2b · Library appears in the sidebar for a super admin, in BOTH nav arrays', () => {
  /**
   * ⚠️ THE FOUNDER'S REPORT WAS "you deleted it", AND NOTHING WAS DELETED.
   * The screen renders, the nav ENTRY exists, and `admin-sections.ts` maps the
   * slug — so `/admin/library` has always resolved for a super admin. What was
   * missing was any way to CLICK to it: `'library'` appeared in neither group
   * array, so the desktop sidebar (which has no catch-all) never drew it.
   *
   * 🔴 BOTH ARRAYS ARE ASSERTED SEPARATELY, and each failure NAMES WHICH. A
   * section in one array and not the other is a section half the product
   * cannot reach, and a single combined assertion could not tell you which
   * half you broke.
   */
  const dashboard = () => read('components/AdminDashboard.tsx');

  const groupHolding = (source: string, arrayName: string, id: string): string | null => {
    const body = source.slice(source.indexOf(arrayName));
    const end = body.indexOf('];');
    for (const m of body.slice(0, end).matchAll(/\{\s*label:\s*'([A-Z]+)',\s*ids:\s*\[([^\]]*)\]/g)) {
      if (m[2].includes(`'${id}'`)) return m[1];
    }
    return null;
  };

  it("🔴 MORE_GROUPS (mobile drawer) lists 'library'", () => {
    // 🔴 THE-338 changed the GROUP NAME, not the property. THE-327 put
    // `library` in the mobile drawer's `PLATFORM` group; THE-338 folded that
    // group and `MORE` into desktop's single `GROW`, because the founder asked
    // for the drawer's group names and order to match desktop exactly. The id
    // did not move between shells and is still in a group rather than under
    // the bare OTHER catch-all, which is what this test is actually for.
    expect(
      groupHolding(codeOf(dashboard()), 'const MORE_GROUPS', 'library'),
      "'library' is in NO group of MORE_GROUPS — the mobile drawer files it under a bare OTHER heading",
    ).toBe('GROW');
  });

  it("🔴 DESKTOP_NAV_GROUPS (desktop sidebar) lists 'library'", () => {
    expect(
      groupHolding(codeOf(dashboard()), 'const DESKTOP_NAV_GROUPS', 'library'),
      "'library' is in NO group of DESKTOP_NAV_GROUPS — the desktop sidebar has no catch-all, so the screen is unreachable by clicking",
    ).toBe('GROW');
  });

  it('it sits with `tenants`, the surface it is gated with, in both arrays', () => {
    /* 🔴 THE-338 SETTLED THE DISAGREEMENT THIS COMMENT DESCRIBED. The two
       arrays used to differ about where platform surfaces live — mobile had a
       PLATFORM group, desktop filed `tenants`/`inbox` under GROW — and
       Library followed its CO-GATED SIBLING in each rather than picking a
       side. The founder asked for the drawer to match desktop, so mobile
       adopted GROW and both arrays now agree. The property below is unchanged
       and is now trivially satisfied in both: Library appears and disappears
       exactly when `tenants` does. */
    const src = codeOf(dashboard());
    for (const arrayName of ['const MORE_GROUPS', 'const DESKTOP_NAV_GROUPS']) {
      expect(groupHolding(src, arrayName, 'library'), `${arrayName} split library from tenants`)
        .toBe(groupHolding(src, arrayName, 'tenants'));
    }
  });

  it('and the screen it points at is still rendered and still slugged', () => {
    const src = codeOf(dashboard());
    expect(src, 'the Library screen stopped rendering').toMatch(/activeTab === 'library'/);
    expect(src, 'the Library screen stopped being imported').toContain('AdminLibraryCourses');
    expect(codeOf(read('lib/admin-sections.ts')), '/admin/library stopped resolving').toContain("'library'");
  });
});

describe('2c · Library does NOT appear for a church admin', () => {
  /**
   * 🔴 THE GATE HAS TO SURVIVE THE MOVE. Adding an id to a group array makes
   * it DRAWABLE, never PERMITTED — both arrays are filtered against the
   * permitted-tab list — but "the gate is still there" is exactly the sort of
   * claim that rots, so it is asserted rather than assumed.
   */
  it('the nav entry is still isSuperAdmin-gated', () => {
    const src = codeOf(read('components/AdminDashboard.tsx'));
    expect(src, 'the Library nav entry lost its super-admin gate')
      .toMatch(/isSuperAdmin\s*&&\s*\{\s*id:\s*'library'/);
  });

  it("a group resolves to [] and is omitted whole when nothing in it is permitted", async () => {
    /* The emptiness rule this depends on lives in one module, so it is
       exercised rather than described: a PLATFORM group holding only
       super-admin ids resolves to no items for a church admin, and
       `visibleNavGroups` drops the heading rather than drawing it over
       nothing. */
    const { visibleNavGroups } = await import('../layout/nav-groups');
    const churchAdminPermitted = new Set(['crm', 'events']);   // no library, no tenants
    const groups = [
      { label: 'PLATFORM', items: ['library', 'tenants', 'inbox'].filter((i) => churchAdminPermitted.has(i)) },
      { label: 'MINISTRY', items: ['crm'].filter((i) => churchAdminPermitted.has(i)) },
    ];
    const visible = visibleNavGroups(groups);
    expect(visible.map((g) => g.label), 'a church admin was shown a PLATFORM heading').toEqual(['MINISTRY']);
    expect(visible.flatMap((g) => g.items), 'a church admin was offered Library').not.toContain('library');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3 · A church with no number sees setup, not an empty broadcast form.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('3 · a church with no number sees setup, not an empty broadcast form', () => {
  it('🔴 the landing view is the number setup, and the composer is not on screen', async () => {
    await openSms();                                   // numbersAnswer.value === null
    expect(host.textContent, 'the setup state is not what a numberless church lands on')
      .toMatch(/buy a number/i);
    expect(host.querySelector('textarea'), 'an unusable broadcast composer is on screen')
      .toBeNull();
    expect(host.textContent, 'the recipients picker is on screen with nothing to send from')
      .not.toMatch(/all members/i);
  });

  it('and it SAYS why broadcasting is unavailable rather than leaving a dead control', async () => {
    const { NO_NUMBER_YET } = await import('../AdminSms');
    await openSms();
    expect(host.textContent, 'the disabled tabs are unexplained').toContain(NO_NUMBER_YET);
    const broadcast = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Broadcasts');
    expect(broadcast, 'the Broadcasts tab vanished instead of being disabled').toBeTruthy();
    /* base-ui's tab trigger spells the disabled state as `aria-disabled` on
       the button rather than the bare attribute, so BOTH are accepted and the
       claim stays about the state rather than about one spelling of it. */
    const off = broadcast!.hasAttribute('disabled') || broadcast!.getAttribute('aria-disabled') === 'true';
    expect(off, 'a church with no number can open the composer').toBe(true);
  });

  it('a released number is not a number — setup comes back', async () => {
    numbersAnswer.value = { ...LIVE_NUMBER, phoneNumber: null, status: 'released' };
    await openSms();
    expect(host.textContent, 'a released number still counts as having one').toMatch(/buy a number/i);
  });

  it('once a number exists the composer is reachable', async () => {
    numbersAnswer.value = LIVE_NUMBER;
    await openSms();
    await clickTab('Broadcasts');
    expect(host.querySelector('textarea'), 'a church WITH a number cannot broadcast').toBeTruthy();
    expect(host.textContent).toMatch(/all members/i);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4 · SMS is still Ministry-only — named per tier.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('4 · SMS is still Ministry-only', () => {
  /**
   * ⚠️ THE-314 set `smsAutomation` and `textToGive` on `max` ONLY. Moving a
   * screen must not widen a tier, and "named per tier" is the point: a single
   * `expect(max).toBe(true)` would pass with every other tier flipped on.
   */
  it.each([
    ['free', false], ['plus', false], ['pro', false], ['max', true],
  ] as const)('%s · smsAutomation and textToGive are %s', async (plan, expected) => {
    const { getEffectiveFeatures } = await import('../../utils/plan-features');
    const f = getEffectiveFeatures(plan as never, {} as never);
    expect(f.smsAutomation, `smsAutomation changed tier on ${plan}`).toBe(expected);
    expect(f.textToGive, `textToGive changed tier on ${plan}`).toBe(expected);
  });

  it('and the purchase route still refuses on the FEATURE, not on a hardcoded tier', () => {
    const src = codeOf(read('app/api/sms/numbers/route.ts'));
    expect(src, 'the Ministry gate stopped reading effective features').toContain('getEffectiveFeatures');
    expect(src, 'the gate became a hardcoded plan comparison').not.toMatch(/plan\s*===\s*'max'/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   5 · 🔴 STOP still stops — asserted THROUGH isStopKeyword.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('5 · STOP still stops, asserted through isStopKeyword', () => {
  /**
   * 🔴 THE LOUDEST GUARD IN THIS SUITE. STOP handling is carrier-mandated and
   * it is HARVEST'S account that gets blocked, because Harvest resells.
   *
   * ⚠️ THE-318 found the old check was satisfied by the string
   * `'UNSUBSCRIBEX'` — a substring match dressed up as a keyword test — and
   * made it assert BEHAVIOURALLY through `isStopKeyword`. That is kept: every
   * claim below calls the real function.
   */
  it.each(['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'])('%s is still a stop keyword', async (word) => {
    const { isStopKeyword } = await import('../../lib/sms-optout');
    expect(isStopKeyword(word), `${word} stopped opting out`).toBe(true);
    expect(isStopKeyword(word.toLowerCase()), `${word} is case-sensitive`).toBe(true);
    expect(isStopKeyword(`  ${word}  `), `${word} stopped tolerating whitespace`).toBe(true);
  });

  it('🔴 and a keyword with a suffix is NOT one — the exact THE-318 finding', async () => {
    const { isStopKeyword } = await import('../../lib/sms-optout');
    expect(isStopKeyword('UNSUBSCRIBEX'), 'the substring check came back').toBe(false);
    expect(isStopKeyword('STOPPING'), 'the substring check came back').toBe(false);
  });

  it('the send path still consults the opt-out list before spending', () => {
    const src = codeOf(read('lib/sms-send.ts'));
    // A call, not an import — see the note on the metering needles below.
    expect(src, 'the send path stopped checking opt-outs').toMatch(/await isOptedOut\(/);
  });

  it('sms-optout.ts is untouched by this ticket', () => {
    /* Named as its own claim because the instruction is absolute: this ticket
       does not open that file. Section 22 pins it by digest. */
    expect(codeOf(read('lib/sms-optout.ts'))).toContain('STOP_KEYWORDS');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   6 · 🔴 Every send and every number is metered.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('6 · every send is metered into tenants/{id}/usage/{YYYY-MM}', () => {
  it('the meter writes to the month doc under the tenant', () => {
    const src = codeOf(read('lib/sms-usage.ts'));
    expect(src, 'the usage document moved').toMatch(/collection\('tenants'\)[\s\S]{0,120}collection\('usage'\)/);
    expect(src, 'the month key stopped being YYYY-MM').toContain('monthKey');
  });

  /**
   * ⚠️ THESE THREE ARE CALL-SITE CHECKS, NOT WORD COUNTS, and the difference
   * was found the hard way. The first version of this test said
   * `toContain('reserveSmsSegment')`; the reservation was then replaced with
   * `{ allowed: true }` at the call site as a planted defect AND THE TEST
   * PASSED, because the IMPORT LINE still carried the word. So each needle
   * below is an actual invocation, and — far more importantly — the real
   * guard for all of this is behavioural and lives in
   * `src/lib/__tests__/THE-327.send-path-behaviour.test.ts`, which calls
   * `sendSms` and watches whether the provider is reached. That file is what
   * the planted defect fails against; this one is the cheap corroboration.
   */
  it('🔴 the send path reserves BEFORE sending and settles the actual segments after', () => {
    const src = codeOf(read('lib/sms-send.ts'));
    expect(src, 'the pre-send reservation is gone — an unmetered path is money leaking')
      .toMatch(/await reserveSmsSegment\(/);
    expect(src, 'the post-send settle is gone, so multi-segment sends undercount')
      .toMatch(/await settleSmsSegments\(/);
    expect(src, 'a send that never happened no longer refunds its reservation')
      .toMatch(/await refundSmsSegment\(/);
    expect(src, 'the settle stopped using the provider’s own segment count')
      .toMatch(/result\.segments/);
  });

  it('and the behavioural guard for all of this is in the tree', () => {
    /* Named rather than assumed: if that file is ever deleted, the claims
       above quietly weaken back into word counts. */
    expect(read('lib/__tests__/THE-327.send-path-behaviour.test.ts'),
      'the behavioural send-path guard is gone').toContain('a refused gate means the provider is NEVER called');
  });

  it('🔴 the meter BLOCKS, it does not merely count', async () => {
    /* Established rather than assumed, because the founder's decision was a
       HARD STOP and "it counts" and "it blocks" are different code. The gate
       refuses inside the same transaction that reads, so two concurrent sends
       at cap-1 cannot both pass. */
    const src = codeOf(read('lib/sms-usage.ts'));
    expect(src, 'the gate stopped refusing at cap').toMatch(/allowed:\s*false/);
    expect(src, 'the check-and-reserve stopped being atomic').toContain('runTransaction');
    const send = codeOf(read('lib/sms-send.ts'));
    expect(send, 'the send path stopped honouring a refused gate').toMatch(/if\s*\(!gate\.allowed\)/);
  });

  it('and the broadcast route refuses server-side once the cap is reached', () => {
    const src = codeOf(read('app/api/sms/broadcast/route.ts'));
    expect(src, 'the server stopped enforcing the cap — the disabled button is a courtesy, not the control')
      .toMatch(/capReached|SMS_CAP_MESSAGE|reserveSmsSegment/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   7–9 · 🔴 THE-318's four purchase fixes survive.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("7–9 · THE-318's purchase fixes are undisturbed", () => {
  const route = () => codeOf(read('app/api/sms/numbers/route.ts'));

  it('🔴 7 · wantsSms is still requested and connectWhatsapp is still explicitly false', () => {
    /* 🔴 THIS IS THE BUG THAT SHIPPED A MUTE NUMBER. Both live in the vendor
       client's purchase body, so that is where they are asserted. */
    const client = codeOf(read('lib/zernio.ts'));
    expect(client, 'wantsSms was dropped — the vendor may hand back a voice-only number')
      .toMatch(/wantsSms:\s*true/);
    expect(client, 'connectWhatsapp stopped being explicitly false')
      .toMatch(/connectWhatsapp:\s*false/);
  });

  it('🔴 8 · the RETURNED profileId is stored, not the requested one', () => {
    const src = route();
    expect(src, 'the requested tenantId is being stored as the profile again')
      .toMatch(/assignedProfileId\s*=\s*number\.profileId\s*\?\?\s*null/);
    expect(src, 'the stored profile is no longer the assigned one')
      .toMatch(/profileId:\s*assignedProfileId/);
  });

  it('9 · allowMultiple is passed for the 10-minute velocity window', () => {
    expect(route(), 'allowMultiple was dropped — one church now blocks another for ten minutes')
      .toMatch(/allowMultiple:\s*true/);
  });

  it('9 · AREA_CODE_UNAVAILABLE and the KYC 202 are handled DISTINCTLY', () => {
    const src = route();
    expect(src, 'AREA_CODE_UNAVAILABLE collapsed back into a generic 409').toContain('AREA_CODE_UNAVAILABLE');
    expect(src, 'PURCHASE_VELOCITY collapsed back into a generic 409').toContain('PURCHASE_VELOCITY');
    expect(src, 'the KYC answer stopped being a 202').toMatch(/status:\s*202/);
    expect(src, 'a KYC answer records a number that was never bought')
      .toMatch(/kycRequired[\s\S]{0,400}?number:\s*null/);
  });

  it('and the panel still surfaces the KYC address rather than swallowing it', () => {
    const src = codeOf(read('components/settings/SmsSection.tsx'));
    expect(src, 'the identity-check address is discarded again').toContain('kycUrl');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   10 · 🔴 A church must not buy a number that cannot deliver.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('10 · registration status is shown, or the screen warns that US texting needs it', () => {
  /**
   * 🔴 ESTABLISHED, NOT ASSUMED. Registration status is readable PER NUMBER
   * and only AFTER purchase — `zernioGetNumber` reports the live status and
   * the GET route re-reads it on every load, and `zernioEnableSms` answers
   * with a `registrationStatus`. There is NO account-level read: Harvest's
   * client wraps only the REUSE call, so before a ministry owns a number there
   * is nothing to query.
   *
   * ⚠️ So this ticket does both halves of STOP condition 2: it SHOWS the status
   * once there is one, and it WARNS before the money when there is not. It
   * builds no registration flow — the provider's answer on whether one
   * registration covers many unrelated churches is still outstanding, and a
   * flow built on that guess is exactly what the ticket forbids.
   */
  it('🔴 the Buy button is never shown without the registration warning beside it', async () => {
    await openSms();                                   // no number → the buy view
    const { REGISTRATION_WARNING } = await import('../settings/SmsSection');
    expect(host.textContent, 'a church can buy a number with no warning that it may not deliver')
      .toContain(REGISTRATION_WARNING);
    expect(host.textContent, 'the warning is present but the buy action is not — wrong screen')
      .toMatch(/buy a number/i);
    expect(REGISTRATION_WARNING, 'the warning stopped naming carrier registration')
      .toMatch(/registered sender|carrier/i);
  });

  it('🔴 a number that cannot deliver yet SAYS SO on the number itself', async () => {
    numbersAnswer.value = { ...LIVE_NUMBER, status: 'pending_registration' };
    await openSms();
    await clickTab('Number');
    const { CANNOT_DELIVER_YET } = await import('../settings/SmsSection');
    expect(host.textContent, 'an unregistered number looks fine while carriers drop its messages')
      .toContain(CANNOT_DELIVER_YET);
    expect(host.textContent, 'the pending status stopped being spelled out')
      .toMatch(/waiting on carrier registration/i);
  });

  it('and an active number does NOT carry the cannot-deliver banner', async () => {
    /* The other direction, so the banner is a STATUS READOUT and not a
       permanent scare label that an admin learns to ignore. */
    numbersAnswer.value = LIVE_NUMBER;
    await openSms();
    await clickTab('Number');
    const { CANNOT_DELIVER_YET } = await import('../settings/SmsSection');
    expect(host.textContent, 'a working number is told it cannot deliver')
      .not.toContain(CANNOT_DELIVER_YET);
  });

  it('🔴 no registration FLOW was built on a guess', () => {
    /* The provider exposes start / reuse / share. Only REUSE is wrapped, which
       is what THE-314 shipped; start and share would each encode an answer
       nobody has yet about multi-tenant scope. */
    const client = codeOf(read('lib/zernio.ts'));
    expect(client, 'the reuse call disappeared').toContain('zernioReuseRegistration');
    expect(client, 'a registration START flow was invented ahead of the provider’s answer')
      .not.toMatch(/start-sms-registration|startSmsRegistration/i);
    expect(client, 'a registration SHARE flow was invented ahead of the provider’s answer')
      .not.toMatch(/share-sms-registration|shareSmsRegistration/i);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   11–14 · The send path, the switch, the webhook and the historical note.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('11 · only sendTenantSms sends', () => {
  /**
   * 🔴 A SWEEP, not a spot check. THE-324's rota invitations call
   * `sendTenantSms`; a second send path would be an unmetered, un-opt-out-
   * checked way to spend Harvest's money.
   */
  it('no source file outside the SMS library calls the vendor or Twilio directly', async () => {
    const { globSync } = await import('node:fs');
    const files = globSync('**/*.{ts,tsx}', { cwd: SRC })
      .filter((f) => !f.includes('__tests__') && !f.includes('/test/'))
      // The library itself, and the vendor client it is built on, are the one
      // permitted layer — that is what "one interface" means.
      .filter((f) => !['lib/sms-send.ts', 'lib/zernio.ts', 'lib/twilio.ts', 'lib/twilio-platform.ts'].includes(f));
    for (const f of files) {
      const src = codeOf(read(f));
      expect(src, `${f} calls the vendor's send directly, bypassing sendTenantSms`)
        .not.toContain('zernioSendSms');
    }
  });

  it('and sendTenantSms is still the exported interface it was', () => {
    expect(codeOf(read('lib/sms-send.ts'))).toMatch(/export async function sendTenantSms\(/);
  });
});

describe('12 · sms-feature.ts still imports nothing', () => {
  it('🔴 the switch reads from both the client bundle and a route handler', () => {
    /* Deliberate: an import would drag a dependency into whichever side could
       not take it, and the switch has to be readable from both. */
    const src = codeOf(read('lib/sms-feature.ts'));
    expect(src, 'sms-feature.ts grew an import').not.toMatch(/^\s*import\s/m);
    expect(src, 'sms-feature.ts grew a require').not.toMatch(/\brequire\(/);
    expect(src, 'the switch itself is gone').toContain('SMS_FEATURE_ENABLED');
  });
});

describe('13 · the public webhook still rejects an unsigned request', () => {
  it('🔴 the signature check is intact and fails closed', async () => {
    const { verifyZernioSignature } = await import('../../lib/zernio');
    expect(verifyZernioSignature('{}', null, 'secret'), 'a request with no header was accepted').toBe(false);
    expect(verifyZernioSignature('{}', 'deadbeef', null), 'a deployment with no secret accepted anything').toBe(false);
    expect(verifyZernioSignature('{}', 'not-hex', 'secret'), 'a malformed header was accepted').toBe(false);
    expect(verifyZernioSignature('{}', 'ab', 'secret'), 'a length mismatch was accepted').toBe(false);
  });

  it('and the route answers 401 rather than processing an unverified body', () => {
    const src = codeOf(read('app/api/sms/incoming/route.ts'));
    expect(src, 'the incoming webhook stopped verifying its signature').toContain('verifyZernioSignature');
    expect(src, 'an unverified request no longer 401s').toMatch(/status:\s*401/);
  });
});

describe('14 · the "Before Harvest numbers" explanation is unchanged', () => {
  it('🔴 word for word — it is a true statement about historical data', async () => {
    const { LEGACY_BYO_BILLING_NOTE } = await import('../AdminSms');
    expect(LEGACY_BYO_BILLING_NOTE).toBe(
      'These messages were sent before Harvest provided numbers, on an account of your own, so no Harvest plan allotment applied to them. A message over 160 characters counts as more than one segment.',
    );
    expect(read('components/AdminSms.tsx'), 'the section heading was removed')
      .toContain('Before Harvest numbers');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   15 · No client-side entitlement write; no price literal.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('15 · no client-side entitlement write; no price literal', () => {
  const TOUCHED = [
    'components/AdminSms.tsx',
    'components/settings/SmsSection.tsx',
    'components/AdminDashboard.tsx',
  ];

  it.each(TOUCHED)('%s writes no plan, add-on or entitlement from the browser', (rel) => {
    /* ⚠️ The webhook is the SINGLE writer of `plan`. #434 removed a client
       write and THE-259's sweep catches a new one; this is the local claim for
       the three files this ticket opens. */
    const src = codeOf(read(rel));
    expect(src, `${rel} writes a plan from the client`).not.toMatch(/\bplan\s*:\s*['"]/);
    expect(src, `${rel} writes an add-on count from the client`).not.toMatch(/\baddons\s*:\s*[[{]/);
    expect(src, `${rel} writes entitlement to Firestore directly`)
      .not.toMatch(/\b(setDoc|updateDoc|writeBatch|runTransaction)\s*\(/);
  });

  it.each(TOUCHED)('%s contains no price literal — prices go through formatPlanPrice', (rel) => {
    /* 🔴 The cross-repo contract THROWS at the site's prerender if a price is
       spelled anywhere but `formatPlanPrice`. `$3.00 / month` is not a price
       literal: it is a vendor cost read back from the provider and formatted
       from `number.monthlyCostUsd`, which is why the assertion looks for a
       hardcoded DIGIT after the dollar sign rather than for the sign. */
    const src = codeOf(read(rel));
    const literals = [...src.matchAll(/\$\s?\d[\d,]*(?:\.\d{2})?\s*(?:\/|per\s)?\s*(?:mo|month|year|yr)?/g)]
      .map((m) => m[0])
      // Template interpolation of a value read from the server is not a literal.
      .filter((m) => !/\$\{/.test(m));
    expect(literals, `${rel} spells a price instead of calling formatPlanPrice`).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   16 · 🔴 Every element that has a primitive uses it; inline styles stay at 0.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('16 · every element that has a primitive uses it', () => {
  /**
   * 🔴 RENDERED, NOT GREPPED, for the reason THE-320 gives: a hand-written
   * substitute carries no `data-slot`, and an import list alone cannot tell
   * you whether the import is used. The elements below are the ones THIS
   * ticket moved or added.
   */
  const MOVED: { what: string; slot: string; least: number }[] = [
    { what: 'the number-panel shell', slot: 'card', least: 1 },
    { what: 'the country and area-code labels', slot: 'label', least: 2 },
    /**
     * ⚠️ EDITED SINCE MEASUREMENT — THE-330. This row read
     * `{ 'the country and area-code fields', slot: 'input', least: 2 }`, because
     * both were FREE-TEXT BOXES composed from `ui/input`. THE-330 replaced them
     * with pickers — that replacement IS the ticket — so there is no `input` on
     * this form to count any more.
     *
     * 🔴 THE CLAIM IS NOT DROPPED. `ui/select` is rejected for these controls
     * (base-ui renders a listbox button, not a `<select>`, which would blind the
     * width guard; and it pins its own 32px height above Rule 4, under the 44px
     * touch floor), so the pickers are native `<select>`s and carry no
     * `data-slot`. Counting them is therefore section 16's wrong tool, and the
     * assertion below counts them DIRECTLY instead — a stronger pin than the
     * old one, because it fails if either field reverts to a text box.
     */
    { what: 'the registration warning', slot: 'alert', least: 1 },
    { what: 'the check-availability and buy actions', slot: 'button', least: 2 },
    /** THE-330's new primitive adoptions on this same form. */
    { what: 'the per-type capability matrix', slot: 'table', least: 1 },
    { what: 'the capability and price markers', slot: 'badge', least: 1 },
  ];

  it('the moved lifecycle renders each element as its primitive, inside the SMS section', async () => {
    await openSms();                                   // no number → the lifecycle view
    for (const { what, slot, least } of MOVED) {
      expect(
        host.querySelectorAll(`[data-slot="${slot}"]`).length,
        `${what} is not \`${slot}\` — moved markup regressed to hand-rolled`,
      ).toBeGreaterThanOrEqual(least);
    }

    /**
     * 🔴 THE-330 — the two fields the row above used to count, counted as what
     * they now are. A revert to `ui/input` (or to any text box) fails here.
     */
    for (const id of ['sms-country', 'sms-area']) {
      const field = host.querySelector(`#${id}`);
      expect(field, `#${id} left the SMS section`).toBeTruthy();
      expect(field!.tagName, `#${id} is not a picker`).toBe('SELECT');
      expect(host.querySelector(`input#${id}`), `#${id} went back to a free-text box`).toBeNull();
    }
  });

  it('the third tab is a real `tabs-trigger`, not a button pretending to be one', async () => {
    numbersAnswer.value = LIVE_NUMBER;
    await openSms();
    const triggers = [...host.querySelectorAll('[data-slot="tabs-trigger"]')].map((t) => t.textContent?.trim());
    expect(triggers, 'the switcher lost a tab or grew a hand-rolled one')
      .toEqual(['Broadcasts', 'Automated', 'Number']);
    expect(host.querySelectorAll('[data-slot="tabs-list"]').length, 'the strip is not `tabs-list`').toBe(1);
  });

  /**
   * ⚠️ ONE RECORDED REJECTION RESPECTED, NOT REOPENED. `SmsSection.tsx:219`
   * notes that `CardTitle` renders a `<div>` with no `render` escape, so
   * adopting it would demote an `<h3>` to a non-heading. That was read before
   * these headings were touched, and they are unchanged — so the rejection is
   * still true and is still recorded at its call site.
   */
  it('the recorded CardTitle rejection is still stated at its call site', () => {
    expect(read('components/settings/SmsSection.tsx'), 'a rejection outlived the decision that made it')
      .toMatch(/`CardTitle` REJECTED/);
  });

  it('🔴 inline styles stay at zero on the SMS section, and at ONE on the panel', () => {
    /* AdminSms carries none and must keep carrying none. The panel's single
       one is THE-314's bottom-nav clearance, justified at its call site and
       pinned by THE-318 — this ticket did not add a second. */
    expect((codeOf(read('components/AdminSms.tsx')).match(/style=\{\{/g) ?? []).length,
      'an inline style appeared on the SMS section').toBe(0);
    expect((read('components/settings/SmsSection.tsx').match(/style=\{\{/g) ?? []).length,
      'a second inline style appeared on the number panel').toBe(1);
  });

  it('and both files still import the primitives they compose from', () => {
    for (const [rel, names] of [
      ['components/AdminSms.tsx', ['alert', 'button', 'card', 'empty', 'input', 'item', 'label', 'progress', 'tabs', 'textarea']],
      ['components/settings/SmsSection.tsx', ['alert', 'button', 'card', 'input', 'label']],
    ] as const) {
      const src = read(rel);
      for (const n of names) {
        expect(new RegExp(`from ['"](?:@/components|\\.{1,2}(?:/[\\w.-]+)*)/ui/${n}['"]`).test(src),
          `${rel} dropped the \`${n}\` primitive`).toBe(true);
      }
    }
  });

  it('🔴 `accordion` is not installed, so nothing reaches for one', () => {
    const { existsSync } = require('node:fs') as typeof import('node:fs');
    expect(existsSync(path.join(SRC, 'components/ui/accordion.tsx')), 'accordion appeared').toBe(false);
    for (const rel of ['components/AdminSms.tsx', 'components/settings/SmsSection.tsx']) {
      expect(codeOf(read(rel)), `${rel} imports a primitive that does not exist`).not.toMatch(/ui\/accordion/);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   18–19 · The frozen allowlist, the palettes and the emoji rule.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("18 · regroup's 10-class allowlist is unchanged", () => {
  it('🔴 still exactly ten items — frozen by design, worked inside the row', () => {
    /* ⚠️ `AdminSettings.regroup.test.tsx`'s first test allowlists unprefixed
       classes on the page root, region wrappers and headings to a FIXED
       ten-item list. This ticket changed what the SMS row CONTAINS and touched
       neither the root, the wrappers nor the headings. */
    const src = read('components/__tests__/AdminSettings.regroup.test.tsx');
    /* The list is an inline array inside the `expect(...).toContain(cls)` that
       enforces it, found by the sentinel it starts with rather than by a name
       it does not have. */
    const start = src.indexOf("['hidden',");
    expect(start, 'the allowlist could not be found — it was renamed or removed').toBeGreaterThan(-1);
    /* Bracket-matched, not regex-matched: the list itself contains
       `'text-[11px]'`, so a non-greedy `[...]` stops four items early and
       reports a shrunken allowlist that never shrank. */
    let depth = 0, end = start;
    for (let i = start; i < src.length; i++) {
      if (src[i] === '[') depth++;
      else if (src[i] === ']' && --depth === 0) { end = i; break; }
    }
    const items = [...src.slice(start, end).matchAll(/'[^']*'/g)].map((m) => m[0]);
    expect(items, 'the frozen ten-item allowlist changed').toEqual([
      "'hidden'", "'space-y-6'", "'space-y-2.5'", "'px-4'", "'text-[11px]'",
      "'font-semibold'", "'uppercase'", "'tracking-[0.16em]'", "'text-faint'", "'text-danger'",
    ]);
    expect(items, 'the frozen ten-item allowlist changed size').toHaveLength(10);
  });
});

describe('19 · no colour hardcoded, no emoji; both palettes resolve', () => {
  const TOUCHED = ['components/AdminSms.tsx', 'components/settings/SmsSection.tsx', 'components/AdminDashboard.tsx'];

  /**
   * 🔴 Four palettes, and Classic is the DEFAULT since #409 — which is exactly
   * why a hex literal is a defect rather than a fallback: it paints the SAME
   * colour in all four the one moment the token is undefined.
   *
   * ⚠️ `AdminDashboard.tsx` CARRIES NINE `#C9963A` LITERALS ALREADY, in
   * `var(--brand-color, #C9963A)` fallbacks this ticket did not write and may
   * not remove — it is a digest-pinned file this ticket opens for the two nav
   * arrays and nothing else. So the claim is EXACTLY "this ticket added none",
   * pinned to the count on `main`, rather than a zero that would have to be
   * bought by editing a file out of scope. The two SMS files are held at zero,
   * which is where they already were.
   */
  const COLOUR_BUDGET: Record<string, number> = {
    'components/AdminSms.tsx': 0,
    'components/settings/SmsSection.tsx': 0,
    'components/AdminDashboard.tsx': 9,        // pre-existing on main; not this ticket's to change
  };

  /** Same budget, for functional colour notation. Also pre-existing. */
  const FUNCTIONAL_COLOUR_BUDGET: Record<string, number> = {
    'components/AdminSms.tsx': 0,
    'components/settings/SmsSection.tsx': 0,
    'components/AdminDashboard.tsx': 1,
  };

  it.each(TOUCHED)('%s adds no colour literal', (rel) => {
    const src = codeOf(read(rel));
    expect((src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length, `${rel} spells a NEW raw colour`)
      .toBe(COLOUR_BUDGET[rel]);
    expect((src.match(/\b(?:rgba?|hsla?)\s*\(/g) ?? []).length, `${rel} spells a NEW rgb()/hsl() colour`)
      .toBe(FUNCTIONAL_COLOUR_BUDGET[rel]);
  });

  it.each(TOUCHED)('%s contains no emoji in rendered copy', (rel) => {
    /* Comments carry the repo's 🔴/⚠️/✅ convention; RENDERED copy may not, so
       the source is stripped of comments before the sweep. */
    const src = codeOf(read(rel));
    /* ⚠️ `\p{Extended_Pictographic}`, NOT a hand-drawn code-point range. The
       obvious range 2600–27BF also swallows U+2713 CHECK MARK, which this
       screen has always used in its "✓ Saved" confirmations and which is a
       typographic mark rather than an emoji — a range-based sweep reports it
       and sends you to delete working copy. */
    const emoji = src.match(/\p{Extended_Pictographic}/gu) ?? [];
    expect(emoji, `${rel} renders an emoji`).toEqual([]);
  });

  it('🔴 the palette family axis is gone, so the count is two (THE-338)', async () => {
    /* ⚠️ "FOUR PALETTES" WAS TWO FAMILIES × TWO THEMES, never four selectors.
       THE-338 removed the family axis — the second family's 14 overrides were
       promoted into the base pair and its selectors deleted — so the product
       is now one family × two themes, i.e. two. Whether both RESOLVE to real
       colours is still measured in Chromium, in this ticket's layout suite,
       because a stylesheet grep cannot answer it. */
    const theme = await import('../../lib/theme');
    expect('DEFAULT_PALETTE_FAMILY' in theme, 'the family default is back').toBe(false);
    expect('PALETTE_FAMILIES' in theme, 'the family list is back').toBe(false);
    expect(theme.THEME_CHOICES, 'the MODE axis was lost with the family axis').toContain('system');
  });

  it('the moved panel paints from brand tokens, so it follows the palette', () => {
    const src = codeOf(read('components/settings/SmsSection.tsx'));
    expect(src, 'the panel stopped using the brand token utilities').toMatch(/\b(?:bg-gold|text-gold|ring-gold)\b/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   20–21 · Two ways this repo has taken `main` down before.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('20 · no test fixture in this PR is pinned to a date near today', () => {
  /**
   * 🔴 #468 TURNED `main` RED FOR EVERYONE when the clock passed a fixture
   * pinned to `'2026-09-06T10:00'`. So this suite pins no date at all — and
   * says so as an assertion rather than as a promise in a comment.
   */
  const MINE = [
    'components/__tests__/THE-327.sms-consolidation.test.tsx',
    'components/__tests__/THE-327.sms-consolidation.layout.test.tsx',
  ];

  it.each(MINE)('%s pins no date within a year of now', (rel) => {
    /* 🔴 COMMENTS STRIPPED FIRST. The docblock above quotes #468's own
       `'2026-09-06T10:00'` to say what went wrong, and reading it raw makes
       this guard fail on its own explanation — the same self-match that
       section 21 hit. */
    const src = codeOf(read(rel));
    const now = Date.now();
    const YEAR = 365 * 24 * 60 * 60 * 1000;
    for (const m of src.matchAll(/'(\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?)'/g)) {
      const t = Date.parse(m[1]);
      if (Number.isNaN(t)) continue;
      expect(Math.abs(t - now) > YEAR,
        `${rel} pins ${m[1]}, which the clock will pass — this is how #468 took main down`).toBe(true);
    }
  });

  it('and it fakes no timers, so `toFake` cannot be got wrong', () => {
    /* ⚠️ `toFake` is LOAD-BEARING where timers ARE faked — faking `setTimeout`
       timed out 28 of 47 tests. This suite avoids the question by not needing
       fake timers at all. */
    for (const rel of MINE) {
      expect(codeOf(read(rel)), `${rel} fakes timers without naming toFake`)
        .not.toMatch(/useFakeTimers\((?!\s*\{[^}]*toFake)/);
    }
  });
});

describe('21 · no guard in this PR asserts anything about the current branch’s diff', () => {
  /**
   * 🔴 #454 IS A STANDING SWEEP, and `THE-315.branch-diff-guards.test.ts` is
   * the repo-wide detector — including its dataflow version, which follows an
   * identifier ONE HOP from the diff read (card `86bbvhaky`: a detector that
   * saw only the direct binding missed the guard that took CI down).
   *
   * ⚠️ This claim is therefore deliberately NARROW and absolute: the files
   * this ticket adds run `git` at no point, so there is nothing for the
   * dataflow detector to follow. Re-implementing that detector here would be a
   * second, weaker copy of a sweep that already exists.
   */
  it.each([
    'components/__tests__/THE-327.sms-consolidation.test.tsx',
    'components/__tests__/THE-327.sms-consolidation.layout.test.tsx',
  ])('%s reads no diff and shells out to no git', (rel) => {
    /* 🔴 Literals blanked, so this sweep cannot be satisfied by its own regex.
       It failed on exactly that on the first run — see `blankLiterals`. */
    const src = blankLiterals(codeOf(read(rel)));
    expect(src, `${rel} shells out to git`).not.toMatch(/execFileSync|execSync|spawnSync|child_process/);
    expect(src, `${rel} reads the branch diff`).not.toMatch(/\bgit\b/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   22 · The files this ticket must not open are byte-identical.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('22 · the untouchable files are byte-identical', () => {
  /**
   * 🔴 `firestore.rules` AUTO-DEPLOYS TO PRODUCTION on merge, CI runs no
   * emulator tests against it and 46 suites pin its digest. `functions/` is a
   * separate deploy. `sms-optout.ts` is carrier-mandated STOP handling and
   * `layout.tsx` is the app shell. All are out of scope by instruction, and
   * this ticket needed none of them: STOP condition 8 was never reached.
   *
   * ⚠️ Digests, not a diff — nothing here shells out to git.
   */
  const digest = (rel: string) => {
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    return createHash('sha256').update(readFileSync(path.resolve(SRC, '..', rel))).digest('hex');
  };

  const UNTOUCHED: Record<string, string> = {
    'firestore.indexes.json': '8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0',
    'src/lib/sms-optout.ts': 'a92f960897d644ba7832b68c0a8e866c146babbe0c0a800b78cc9d71b49a527c',
    'src/app/layout.tsx': 'b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f',
  };

  /**
   * 🔴 THE-325 · the accepted SET moved to `__fixtures__/ownership/`, the
   * ASSERTION stayed here. This suite still says what it always said: the
   * `firestore.rules` on disk is at a digest some ticket recorded, and so
   * THIS ticket did not touch a file that auto-deploys to production with no
   * emulator test in CI. Only the list of accepted values is now shared, so
   * a legitimate rules change is one new record rather than 50 edits.
   */
  it('firestore.rules is unchanged', () => {
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
  });

  it.each(Object.entries(UNTOUCHED))('%s is unchanged', (rel, expected) => {
    expect(digest(rel), `${rel} was edited — this ticket must not open it`).toBe(expected);
  });

  it('and no file under functions/ was opened', () => {
    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    const root = path.resolve(SRC, '..', 'functions');
    const hash = createHash('sha256');
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir).sort()) {
        if (entry === 'node_modules' || entry === 'lib' || entry === '.git') continue;
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else hash.update(entry).update(readFileSync(p));
      }
    };
    walk(root);
    expect(hash.digest('hex'), 'a file under functions/ was edited — it is a separate deploy').toBe('d14c883cc5fa51f4a7fa3081496a8a46f9d9c93ec4210060df6ff1d242526acd');
  });
});
