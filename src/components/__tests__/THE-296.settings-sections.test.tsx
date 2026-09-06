import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { AUTOSAVE_ERROR_TOAST_ID, AUTOSAVE_SAVED_TOAST_ID, AUTOSAVE_EXCLUDED } from '../settings/autosave';
import UNTOUCHED from './__fixtures__/the-286-untouched.json';
import { freezeFailure } from './__fixtures__/settings-freeze-register';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-296 — the remaining settings sections, onto THE-286's chrome
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ─── 🔴 WHAT THE BRIEF ASKED FOR, AND WHAT IS ACTUALLY THERE ────────────────
 *
 * The brief lists ten files in `src/components/settings/` and asks for "the
 * remaining sections" to be converted onto the shared chrome, as one slice.
 * That premise does not survive reading the mount sites, and the reason is the
 * single most important fact about this directory:
 *
 *   🔴 `settings/` IS NOT ONE SCREEN. `SettingsAccordion` is mounted by exactly
 *      ONE component in the entire repo — `AdminSettings` — and SIX of the ten
 *      files the brief names are never inside it:
 *
 *        BrandingSection      → AdminBranding, FirstRunSetup
 *        DomainSection        → AdminBranding, FirstRunSetup
 *        AddOnsSection        → BillingAndPayments
 *        PlanUpgradeSection   → BillingAndPayments
 *        BillingTermToggle    → AdminUpgradePage, PlanUpgradeSection
 *        PaymentSection       → AdminDonations, AdminFundraising
 *
 * "Convert onto the shared chrome" means one concrete thing — stop drawing your
 * own card inside an accordion row that already draws one. For a section that
 * renders on AdminBranding or BillingAndPayments there IS no accordion row, so
 * its own card is the only card it has; deleting it would leave the content
 * floating on an unstyled page. The instruction states nothing about those six,
 * and applying it anyway would be a restyle of four OTHER screens smuggled in
 * under a settings ticket.
 *
 * So the slice is the accordion, and it is complete: `AdminSettings` mounts
 * four sections, THE-286 converted one (GivingStatements), `SmsSection` renders
 * `null` while SMS is off and can prove nothing, and this ticket converts the
 * remaining two. AFTER THIS PR EVERY SECTION THE SETTINGS SCREEN RENDERS IS ON
 * THE SHARED CHROME — which is a claim worth making, and a better boundary than
 * "two of ten files".
 *
 * ─── Where the split falls, and why by risk rather than by size ─────────────
 *
 * The brief asks for grouping by risk. That is what the mount site gives, for
 * free and without judgement:
 *
 *   · this PR      — the accordion. OnboardingSection + IntegrationsSection.
 *                    No money path, one screen, one container.
 *   · a next slice — the billing screen. AddOnsSection, PlanUpgradeSection,
 *                    BillingTermToggle: all money path, all in AUTOSAVE_EXCLUDED,
 *                    all on BillingAndPayments/AdminUpgradePage.
 *   · a third      — the branding screen. BrandingSection + DomainSection, which
 *                    are ALSO mounted by FirstRunSetup, so any edit there lands
 *                    in first-run onboarding as well. THE-286 named this as the
 *                    reason it declined BrandingSection as its proof section.
 *
 * PaymentSection and SmsSection convert to nothing in any slice: both are behind
 * master switches that are off, and what they render is a static message or
 * `null`. See test 7.
 *
 * ─── Where the geometry lives ────────────────────────────────────────────────
 *
 * Tests 10, 11 and 12 are NOT here. happy-dom has no layout engine, so they are
 * asked over CDP in real Chromium by `THE-296.settings-sections.layout.test.tsx`.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.resolve(__dirname, '../../..');
const readSrc = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const ONBOARDING = 'src/components/settings/OnboardingSection.tsx';
const INTEGRATIONS = 'src/components/settings/IntegrationsSection.tsx';
/** The two sections this slice converts, named per section for tests 1 and 13. */
const CONVERTED = [ONBOARDING, INTEGRATIONS] as const;

/**
 * Source with every comment removed — block, line and JSX.
 *
 * ⚠️ Load-bearing, and THE-286 learned it the same way: these files DISCUSS what
 * they no longer do. OnboardingSection's header quotes the `alert()` it removed
 * and the `text-green-600` it stopped spelling, in order to explain why. A raw
 * grep would fail on the documentation and pass on the defect.
 */
function code(rel: string): string {
  return readSrc(rel)
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ');
}

/* ── Firestore / firebase / sonner doubles ────────────────────────────────── */

type DocRef = { path: string };
type Snapshot = { exists: () => boolean; data: () => Record<string, unknown> };

const updateDoc = vi.hoisted(() =>
  vi.fn(async (_ref: DocRef, _data: Record<string, unknown>): Promise<void> => undefined));
const getDoc = vi.hoisted(() => vi.fn(async (_ref: DocRef): Promise<Snapshot> => ({
  exists: () => true, data: () => ({ tenantId: 't1', config: {} }),
})));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...rest: string[]) => ({ path: rest.join('/') }),
  getDoc,
  updateDoc,
}));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1', email: 'a@b.org' } } }));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

/* ── mounting ─────────────────────────────────────────────────────────────── */

let host: HTMLDivElement;
let root: Root;

/** A tenant that has already initialised, with two questions in a known order. */
const TENANT_DOC: Snapshot = {
  exists: () => true,
  data: () => ({
    tenantId: 't1',
    config: {
      onboardingInitialized: true,
      onboardingQuestions: [
        { id: 'q_a', label: 'First', type: 'text', required: false, order: 0 },
        { id: 'q_b', label: 'Second', type: 'text', required: false, order: 1 },
      ],
    },
  }),
};

beforeEach(() => {
  vi.clearAllMocks();
  getDoc.mockResolvedValue(TENANT_DOC);
  updateDoc.mockResolvedValue(undefined);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function mountOnboarding() {
  const Section = (await import('../settings/OnboardingSection')).default;
  await act(async () => { root.render(<Section />); });
  // The loader is a chain of dynamic imports; let the microtask queue turn.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  return host;
}

const rows = () => [...host.querySelectorAll<HTMLElement>('[data-question]')];
const buttonNamed = (re: RegExp, scope: ParentNode = host) =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')]
    .find((b) => re.test((b.getAttribute('aria-label') || b.textContent || '').trim()))!;
const click = async (el: Element) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
};

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 — each converted section renders through the shared chrome
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('1 · each converted section renders through the shared chrome without its own styling', () => {
  /**
   * The accordion row already draws `bg-surface-raised rounded-brand border
   * border-line shadow-[…]` and pads its panel `px-5 py-4`. A section that draws
   * the same card again is two cards, two radii and two borders for one panel —
   * which is what THE-286 removed from GivingStatementsSection, and the single
   * concrete meaning of "inherits the chrome".
   */
  const PANEL_CARD = /bg-surface-raised\s+rounded-(?:2xl|brand|xl)\s+border/;

  it.each(CONVERTED)('%s draws no second panel card of its own', (rel) => {
    expect(code(rel), `${rel} draws its own panel card inside the accordion row's card`)
      .not.toMatch(PANEL_CARD);
  });

  it.each(CONVERTED)('%s spells no field chrome of its own', (rel) => {
    // The three spellings the unconverted sections repeated by hand. Chrome now
    // comes from the `field`/`input` primitives or from nothing at all.
    for (const spelling of [/focus:ring-gold/, /focus:ring-2\s+focus:ring-gold/, /px-4\s+py-2\.5\s+border/]) {
      expect(code(rel), `${rel} re-spells its own input chrome`).not.toMatch(spelling);
    }
  });

  it.each(CONVERTED)('%s takes its density from form-layout rather than inventing one', (rel) => {
    expect(code(rel), `${rel} no longer reads CONTROL_DENSITY`).toContain('CONTROL_DENSITY');
    expect(code(rel), `${rel} imports from the shared layout module`)
      .toMatch(/from\s+['"]\.\.\/layout\/form-layout['"]/);
  });

  it.each(CONVERTED)('%s takes the shared nav clearance rather than minting a number', (rel) => {
    expect(code(rel), `${rel} stopped importing NAV_CLEARANCE`).toContain('NAV_CLEARANCE');
    // 🔴 And it does NOT rely on `pb-safe`, which compiles to nothing.
    expect(code(rel), `${rel} depends on pb-safe, which this repo does not define`)
      .not.toContain('pb-safe');
  });

  /**
   * ⚠️ THE-312 gave this pin an APPEND PATH. The baseline is still
   * `UNTOUCHED.chrome`, untouched and unreplaced; a deliberate edit to the
   * chrome is recorded in `RECORDED_EDITS` with its ticket, its reason and its
   * digest, and `freezeFailure` accepts that value and nothing else. An edit
   * nobody recorded fails exactly as it did before.
   */
  it('the accordion row it inherits from is itself untouched', () => {
    for (const [rel, digest] of Object.entries(UNTOUCHED.chrome)) {
      expect(freezeFailure(rel, digest),
        `${rel} changed — the chrome shipped in THE-183 and this slice reuses it`).toBeNull();
    }
  });

  it('OnboardingSection actually renders its rows when mounted', async () => {
    await mountOnboarding();
    expect(rows()).toHaveLength(2);
    expect(host.textContent).toContain('First');
    expect(host.textContent).toContain('Second');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2 — preference fields autosave, with a toast
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('2 · read-only and preference fields autosave with a toast', () => {
  it('🔴 the Save button is GONE, not hidden', async () => {
    await mountOnboarding();
    const save = [...host.querySelectorAll('button')]
      .find((b) => /save questions|^save$/i.test((b.textContent || '').trim()));
    expect(save, 'a manual Save control is back — autosave is the decided model').toBeUndefined();
    // And no footer bar of any kind was put in its place.
    expect(code(ONBOARDING), 'a save bar came back').not.toMatch(/sticky\s+bottom-0|fixed\s+bottom-0/);
  });

  it('a reorder writes on its own and confirms with the shared toast', async () => {
    await mountOnboarding();
    await click(buttonNamed(/Move Second up/));
    expect(updateDoc).toHaveBeenCalledTimes(1);
    const payload = updateDoc.mock.calls[0][1] as Record<string, unknown>;
    const written = payload['config.onboardingQuestions'] as Array<{ id: string; order: number }>;
    expect(written.map((q) => q.id), 'the reorder did not reach the write').toEqual(['q_b', 'q_a']);
    expect(written.map((q) => q.order), 'order was not renumbered').toEqual([0, 1]);
    expect(payload['config.onboardingInitialized']).toBe(true);
    expect(toast.success).toHaveBeenCalledWith('Saved', { id: AUTOSAVE_SAVED_TOAST_ID });
  });

  it('adding a question writes on its own', async () => {
    await mountOnboarding();
    await click(buttonNamed(/Add Question/));
    const input = host.querySelector<HTMLInputElement>('#oq-label')!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, 'Favourite verse');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(buttonNamed(/^Done$/));
    expect(updateDoc).toHaveBeenCalledTimes(1);
    const written = (updateDoc.mock.calls[0][1] as Record<string, unknown>)['config.onboardingQuestions'] as Array<{ label: string }>;
    expect(written.map((q) => q.label)).toEqual(['First', 'Second', 'Favourite verse']);
  });

  it('🔴 merely OPENING the panel writes nothing — the baseline is primed, not saved', async () => {
    await mountOnboarding();
    // Without `prime`, the first commit would treat the loaded list as a change
    // and spend a write echoing it straight back — and on a tenant that had
    // never initialised, it would silently persist the defaults as a choice.
    expect(updateDoc).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3 — 🔴 a FAILED autosave is visible and discards nothing
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('3 · a FAILED autosave surfaces visibly and does not silently discard the edit', () => {
  beforeEach(() => { updateDoc.mockRejectedValue(new Error('offline')); });

  it('🔴 the edit survives on screen — nothing is reverted', async () => {
    await mountOnboarding();
    await click(buttonNamed(/Move Second up/));
    // The reordered list is still what the person is looking at. The hook does
    // not own this state and cannot put the old value back — deliberate shape,
    // not an omission.
    expect(rows().map((r) => r.getAttribute('data-question'))).toEqual(['q_b', 'q_a']);
  });

  it('🔴 a toast fires, on the shared error id', async () => {
    await mountOnboarding();
    await click(buttonNamed(/Move Second up/));
    expect(toast.error).toHaveBeenCalledTimes(1);
    const [message, opts] = toast.error.mock.calls[0] as [string, { id: string }];
    expect(opts.id, 'a failure toast stacks instead of replacing').toBe(AUTOSAVE_ERROR_TOAST_ID);
    // The copy has to make the promise the behaviour keeps.
    expect(message).toMatch(/still here/i);
    expect(toast.success, 'a failure was reported as a success').not.toHaveBeenCalled();
  });

  it('🔴 …AND a durable record stays in the panel, because a toast fades', async () => {
    await mountOnboarding();
    await click(buttonNamed(/Move Second up/));
    const alerts = [...host.querySelectorAll('[role="alert"]')]
      .filter((n) => /not saved/i.test(n.textContent || ''));
    expect(alerts.length, 'the failure left no record once the toast fades').toBeGreaterThan(0);
    expect(alerts[0].textContent).toMatch(/still here/i);
    // With a retry a person can actually reach.
    expect(buttonNamed(/Retry/), 'the failure offers no way to try again').toBeTruthy();
  });

  it('🔴 Retry re-issues the write, and success clears the record', async () => {
    await mountOnboarding();
    await click(buttonNamed(/Move Second up/));
    expect(updateDoc).toHaveBeenCalledTimes(1);
    updateDoc.mockResolvedValue(undefined);
    await click(buttonNamed(/Retry/));
    expect(updateDoc).toHaveBeenCalledTimes(2);
    // The retried write carries the CURRENT list, not a stale closure over the
    // array as it stood when the failure happened.
    const retried = (updateDoc.mock.calls[1][1] as Record<string, unknown>)['config.onboardingQuestions'] as Array<{ id: string }>;
    expect(retried.map((q) => q.id)).toEqual(['q_b', 'q_a']);
    expect([...host.querySelectorAll('[role="alert"]')]
      .filter((n) => /not saved/i.test(n.textContent || ''))).toHaveLength(0);
  });

  it('🔴 no-regression on THE-286: the failure is never an alert() again', () => {
    // A blocking browser alert is dismissed and then leaves NOTHING — the
    // silent discard this whole mechanism exists to prevent, and the class of
    // bug PersonalInformationModal's deleteState machine was written against.
    expect(code(ONBOARDING), 'a failed save reports through alert() again')
      .not.toMatch(/\balert\(/);
    expect(code('src/components/settings/GivingStatementsSection.tsx'),
      "THE-286's own section grew an alert()").not.toMatch(/\balert\(/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4 — 🔴 money-path fields do NOT autosave
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('4 · money-path fields do NOT autosave', () => {
  /** file → the field name the exclusion list must carry for it. */
  const MONEY_PATH: ReadonlyArray<readonly [name: string, file: string, needle: RegExp]> = [
    ['plan', 'src/components/settings/PlanUpgradeSection.tsx', /plan choice/i],
    ['add-ons', 'src/components/settings/AddOnsSection.tsx', /add-on/i],
    ['billing term', 'src/components/settings/BillingTermToggle.tsx', /term toggle/i],
  ];

  it.each(MONEY_PATH)('the %s field is excluded by name, with a reason', (_name, file, needle) => {
    const entries = AUTOSAVE_EXCLUDED.filter((e) => e.file === file);
    expect(entries.length, `${file} is not on the autosave exclusion list`).toBeGreaterThan(0);
    expect(entries.some((e) => needle.test(e.field)), `${file} is listed but not for this field`).toBe(true);
    for (const e of entries) expect(e.why.length).toBeGreaterThan(60);
  });

  it.each(MONEY_PATH)('…and the %s file imports no autosave at all', (_name, file) => {
    // 🔴 A SOURCE SWEEP, not a spot check: this fails whether or not anybody
    // remembers to update the list.
    const src = readSrc(file);
    expect(src, `${file} imports the autosave hook`).not.toMatch(/from ['"][^'"]*settings\/autosave['"]/);
    expect(src, `${file} calls useAutosaveField`).not.toContain('useAutosaveField');
  });

  /**
   * 🔴 THE-300 CONVERTED TWO OF THESE THREE, so blanket byte-identity across the
   * money path no longer states something true — and the honest fix is the one
   * THE-286's own suite already uses for exactly this situation, not a quieter
   * assertion.
   *
   * ⚠️ THE DIGESTS IN THE FIXTURE ARE NOT REGENERATED AND NOT SUBSTITUTED. The
   * two files THE-300 edited are exempted from ONE assertion — this digest — and
   * from nothing else; PlanUpgradeSection stays hard-pinned against the value
   * recorded at THE-286's PR time. An exempted file MUST actually differ (below),
   * so an entry cannot outlive the edit that justified it, and the list is
   * compared WHOLE so widening it is an edit to a literal a reviewer sees.
   *
   * What THE-296 was really claiming here — that ITS slice did not rewire the
   * money path — is unchanged and is now carried by the sweep above (no file
   * imports the autosave hook) plus THE-300's own suite, both of which are
   * stronger than a digest because they survive a legitimate edit.
   */
  const MONEY_PATH_EDITED_SINCE: ReadonlyArray<{ file: string; ticket: string }> = [
    { file: 'src/components/settings/AddOnsSection.tsx', ticket: 'THE-300' },
    { file: 'src/components/settings/BillingTermToggle.tsx', ticket: 'THE-300' },
  ];

  it('the digest exemption list is exactly the edits that justify it', async () => {
    const { createHash } = await import('node:crypto');
    expect(MONEY_PATH_EDITED_SINCE.map((e) => `${e.ticket} ${e.file}`)).toEqual([
      'THE-300 src/components/settings/AddOnsSection.tsx',
      'THE-300 src/components/settings/BillingTermToggle.tsx',
    ]);
    for (const { file } of MONEY_PATH_EDITED_SINCE) {
      const now = createHash('sha256').update(readFileSync(path.join(ROOT, file))).digest('hex');
      expect(now, `${file} is exempted but unchanged — drop it from the list`)
        .not.toBe(UNTOUCHED.otherSettingsSections[file as keyof typeof UNTOUCHED.otherSettingsSections]);
    }
  });

  it('the money-path files are byte-identical — this slice did not touch them', async () => {
    const { createHash } = await import('node:crypto');
    const exempt = MONEY_PATH_EDITED_SINCE.map((e) => e.file);
    for (const file of ['src/components/settings/PlanUpgradeSection.tsx',
                        'src/components/settings/AddOnsSection.tsx',
                        'src/components/settings/BillingTermToggle.tsx']) {
      if (exempt.includes(file)) continue;
      const now = createHash('sha256').update(readFileSync(path.join(ROOT, file))).digest('hex');
      expect(now, `${file} changed — the money path is out of scope for this slice`)
        .toBe(UNTOUCHED.otherSettingsSections[file as keyof typeof UNTOUCHED.otherSettingsSections]);
    }
  });

  it('the plan change is still explicit and confirmed, and still arms the refresh window', () => {
    const plan = readSrc('src/components/settings/PlanUpgradeSection.tsx');
    expect(plan, 'the plan change no longer runs through runDodoPlanChange').toContain('runDodoPlanChange');
    expect(plan, 'the THE-217 refresh window is no longer armed').toContain('armPlanRefresh()');
    expect(plan, 'a plan change became a field change').not.toMatch(/onChange=\{[^}]*runDodoPlanChange/);
  });

  it('🔴 and the section this slice DID convert excludes its own non-preference controls', () => {
    // IntegrationsSection autosaves nothing, and that is deliberate: Connect
    // opens a real OAuth grant and Disconnect revokes one. It is on the list.
    const entry = AUTOSAVE_EXCLUDED.find((e) => e.file === INTEGRATIONS);
    expect(entry, 'IntegrationsSection is not on the autosave exclusion list').toBeTruthy();
    expect(entry!.why.length).toBeGreaterThan(60);
    expect(readSrc(INTEGRATIONS), 'IntegrationsSection grew an autosave')
      .not.toMatch(/from ['"][^'"]*settings\/autosave['"]/);
  });

  it('🔴 DELETE stays a confirmed action even in the section that DOES autosave', async () => {
    // The Save button used to be the accident-brake on delete. Removing it
    // without replacing that brake would make this conversion a regression in
    // safety, so one tap arms and a second commits.
    await mountOnboarding();
    await click(buttonNamed(/^Delete First$/));
    expect(updateDoc, 'the first tap already deleted the question').not.toHaveBeenCalled();
    expect(rows(), 'the row went away before it was confirmed').toHaveLength(2);

    const confirm = host.querySelector<HTMLButtonElement>('[data-confirm-delete="q_a"]')!;
    expect(confirm, 'no confirm appeared').toBeTruthy();
    await click(confirm);
    expect(updateDoc).toHaveBeenCalledTimes(1);
    const written = (updateDoc.mock.calls[0][1] as Record<string, unknown>)['config.onboardingQuestions'] as Array<{ id: string }>;
    expect(written.map((q) => q.id)).toEqual(['q_b']);
  });

  it('…and the arming can be backed out of without writing anything', async () => {
    await mountOnboarding();
    await click(buttonNamed(/^Delete First$/));
    await click(buttonNamed(/^Cancel$/));
    expect(host.querySelector('[data-confirm-delete="q_a"]')).toBeNull();
    expect(updateDoc).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(2);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5 — 🔴 nothing writes plan from the client
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('5 · nothing writes plan from the client', () => {
  /**
   * 🔴 No-regression on #434, which REMOVED a client-side `plan` write from
   * AdminDashboard and widened THE-259's sweep to catch it. The webhook is the
   * single writer of `plan`. This slice must not add a second one — and the
   * sweep is over the whole client tree, not over the two files it edited,
   * because a guard that only looks where the author already looked guards
   * nothing.
   */
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p, out);
      else if (/\.tsx?$/.test(entry.name)) out.push(p);
    }
    return out;
  };

  it('no client component writes a plan field to Firestore', () => {
    const offenders: string[] = [];
    for (const abs of walk(path.join(ROOT, 'src/components'))) {
      const body = code(path.relative(ROOT, abs));
      // `updateDoc`/`setDoc` payloads naming `plan` as a written key. The
      // webhook writes it server-side; a client that does is the defect.
      //
      // ⚠️ A FIXED WINDOW after the call, NOT a paren match. The first draft of
      // this guard read `updateDoc\s*\([\s\S]{0,400}?\)` and matched only up to
      // the first `)` — which in `updateDoc(doc(db, 'tenants', id), { plan: … })`
      // closes `doc(`, so the payload was never examined and the sweep passed a
      // deliberately planted plan write. Caught by mutation, not by review.
      for (const m of body.matchAll(/\b(?:updateDoc|setDoc)\s*\(/g)) {
        const window_ = body.slice(m.index!, m.index! + 400);
        if (/[{,]\s*['"]?plan['"]?\s*:/.test(window_)) {
          offenders.push(`${path.relative(ROOT, abs)}: ${window_.replace(/\s+/g, ' ').slice(0, 90)}`);
        }
      }
    }
    expect(offenders, 'a client-side plan write is back — #434 removed one').toEqual([]);
  });

  it('and the two sections this slice converted write only what they own', () => {
    for (const rel of CONVERTED) {
      const body = code(rel);
      expect(body, `${rel} writes plan from the client`).not.toMatch(/['"]?plan['"]?\s*:/);
      expect(body, `${rel} reaches the plan-change path`).not.toContain('runDodoPlanChange');
      expect(body, `${rel} arms the plan refresh window`).not.toContain('armPlanRefresh');
    }
    // OnboardingSection writes exactly the two config keys it owns, and nothing else.
    const writes = [...code(ONBOARDING).matchAll(/'(config\.[A-Za-z.]+)'/g)].map((m) => m[1]);
    expect([...new Set(writes)].sort())
      .toEqual(['config.onboardingInitialized', 'config.onboardingQuestions']);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6 — no price literal
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('6 · no price literal appears; prices go through formatPlanPrice', () => {
  it('no settings section spells a money literal', () => {
    const dir = path.join(ROOT, 'src/components/settings');
    const offenders: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (!/\.tsx?$/.test(entry)) continue;
      const body = code(`src/components/settings/${entry}`);
      for (const m of body.matchAll(/\$\d[\d,]*(?:\.\d+)?/g)) offenders.push(`${entry}: ${m[0]}`);
    }
    expect(offenders, 'a price literal is back in settings/').toEqual([]);
  });

  it('the plan card still renders through formatPlanPrice', () => {
    // ⚠️ The bug shipped once already: monthlyPrice/yearlyPrice literals
    // rendered while formatPlanPrice sat imported and unused two lines away.
    expect(readSrc('src/components/settings/PlanUpgradeSection.tsx'))
      .toContain('formatPlanPrice(planId, billingPeriod)');
  });

  it('and neither converted section renders a price at all', () => {
    for (const rel of CONVERTED) {
      expect(code(rel), `${rel} started rendering a price`).not.toContain('formatPlanPrice');
      expect(code(rel), `${rel} spells a money literal`).not.toMatch(/\$\d/);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7 — 🔴 the three switched-off sections are still off
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('7 · PaymentSection still renders unavailable, DomainSection is still hidden, SmsSection is still off', () => {
  it('🔴 the Stripe Connect UI is NOT restored (THE-256)', () => {
    const src = readSrc('src/components/settings/PaymentSection.tsx');
    expect(src, 'PaymentSection no longer reads the Stripe Connect master switch')
      .toContain('STRIPE_CONNECT_ENABLED');
    expect(src, 'the unavailable state left PaymentSection').toContain('STRIPE_CONNECT_HIDDEN_MESSAGE');
    expect(src, 'the unavailable branch lost its handle').toContain('data-testid="stripe-connect-hidden"');
    // 🔴 The SWITCH must be what chooses, not merely be mentioned. Asserted as
    // the ternary rather than as the word: a mutation that restored the Connect
    // UI while leaving the import in place passed a `toContain` check.
    expect(src, 'the Connect UI is no longer gated on the master switch')
      .toMatch(/STRIPE_CONNECT_ENABLED\s*\?\s*<StripeConnectPanel\s*\/>\s*:/);
    // ⚠️ The platform account is closed as rejected.fraud. The switch is off.
    expect(readSrc('src/lib/stripe-connect-feature.ts'))
      .toMatch(/STRIPE_CONNECT_ENABLED\s*=\s*false/);
  });

  it('🔴 the custom-domain panel is NOT un-hidden (#428)', () => {
    const src = readSrc('src/components/settings/DomainSection.tsx');
    expect(src, 'DomainSection no longer reads the custom-domain master switch')
      .toContain('CUSTOM_DOMAIN_ENABLED');
    expect(src, 'the hidden branch lost its handle').toContain('data-testid="custom-domain-hidden"');
    // Same strengthening as PaymentSection below: the switch must be what
    // chooses the branch, read BEFORE the plan (THE-280), not merely imported.
    expect(src, 'the custom-domain panel is no longer gated on the master switch')
      .toMatch(/!CUSTOM_DOMAIN_ENABLED\s*\?/);
    expect(readSrc('src/lib/custom-domain-feature.ts'))
      .toMatch(/CUSTOM_DOMAIN_ENABLED\s*=\s*false/);
    // ⚠️ ACCURACY, not pedantry: the brief and THE-286's exclusion list both say
    // "the section is hidden entirely". It is not — the section renders, showing
    // the read-only `.theharvest.app` subdomain, and only the CUSTOM DOMAIN
    // sub-panel is switched off. Recorded so the next slice does not go looking
    // for a section that is supposedly absent.
    expect(src, 'DomainSection stopped rendering the subdomain it still shows')
      .toContain('.theharvest.app');
  });

  it('🔴 SMS is ON now (THE-314), and still behind the one switch', () => {
    // ⚠️ REVERSED, NOT LOOSENED. THE-296 pinned SMS as OFF because it was one of
    // three switched-off sections it must not convert. THE-314 flipped the
    // switch and rewrote the panel from a Twilio credential form into the number
    // purchase panel. What THE-296 actually cares about is unchanged and still
    // asserted: the section reads the ONE master switch and renders through it,
    // and the settings ROW goes with the panel rather than opening onto nothing.
    const src = readSrc('src/components/settings/SmsSection.tsx');
    expect(src, 'SmsSection no longer reads the SMS master switch').toContain('SMS_FEATURE_ENABLED');
    expect(src, 'SmsSection stopped rendering through the switch')
      // ⚠️ THE-327 — the component behind the switch is now the settings
      // SIGNPOST: the number lifecycle moved into the SMS section, and
      // `SmsNumberPanel` is mounted there. What this guard is actually
      // about — that the section renders through the ONE master switch and
      // renders `null` when it is off — is unchanged and still asserted.
      .toMatch(/SMS_FEATURE_ENABLED\s*\?\s*<SmsSettingsPointer\s*\/>\s*:\s*null/);
    expect(readSrc('src/lib/sms-feature.ts')).toMatch(/SMS_FEATURE_ENABLED\s*=\s*true/);
    // And the settings row stays hidden with it, so the label does not open
    // onto an empty panel (THE-250).
    expect(readSrc('src/components/AdminSettings.tsx'))
      .toMatch(/hidden:\s*!SMS_FEATURE_ENABLED/);
  });

  it('the two STILL-OFF files are byte-identical — this slice converted none of them', async () => {
    // ⚠️ SmsSection LEFT THIS LIST — THE-314 rewrote it, and its entry is
    // recorded on THE-286's exemption list, which is where a settings-section
    // rewrite is registered. The list is NARROWED rather than repinned: the
    // claim "a switched-off section is not convertible" stays exactly true of
    // the two sections that are still switched off, and re-recording
    // SmsSection's digest here would have substituted the value this guard
    // measures instead of removing a file that no longer qualifies.
    const { createHash } = await import('node:crypto');
    for (const file of ['src/components/settings/PaymentSection.tsx',
                        'src/components/settings/DomainSection.tsx']) {
      const now = createHash('sha256').update(readFileSync(path.join(ROOT, file))).digest('hex');
      expect(now, `${file} changed — a switched-off section is not convertible`)
        .toBe(UNTOUCHED.otherSettingsSections[file as keyof typeof UNTOUCHED.otherSettingsSections]);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8 — 🔴 Harvest must never be able to read an inbox
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('8 · assertSendOnlyGmailScopes still fails closed', () => {
  it('🔴 the guard exists, is imported by the connect route, and THROWS', async () => {
    const lib = readSrc('src/lib/gmail-scopes.ts');
    const route = readSrc('src/app/api/composio/gmail/connect/route.ts');
    expect(route, 'the connect route no longer asserts the scopes').toContain('assertSendOnlyGmailScopes');
    expect(lib, 'the scope guard stopped throwing').toMatch(/throw\s+new\s+GmailScopeError/);
  });

  it('🔴 …and it really refuses a read scope, RUN rather than read', async () => {
    const { assertSendOnlyGmailScopes, GmailScopeError, GMAIL_SEND_SCOPE } =
      await import('../../lib/gmail-scopes');
    const cfg = (scopes: string[] | null) =>
      ({ toolkitSlug: 'gmail', isComposioManaged: true, scopes });

    // Send-only is accepted, and the send scope really is what comes back.
    expect(assertSendOnlyGmailScopes(cfg([GMAIL_SEND_SCOPE]))).toEqual([GMAIL_SEND_SCOPE]);
    // Identity scopes carry no mailbox access and stay allowed alongside it.
    expect(() => assertSendOnlyGmailScopes(cfg([GMAIL_SEND_SCOPE, 'openid']))).not.toThrow();

    // 🔴 Anything that can READ a church's mail is refused — by name, not by a
    // generic throw, so a future refactor that threw for a different reason
    // would not be mistaken for the guard still working.
    for (const scope of [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.metadata',
      'https://mail.google.com/',
      'https://www.googleapis.com/auth/contacts',
    ]) {
      let thrown: unknown;
      try { assertSendOnlyGmailScopes(cfg([GMAIL_SEND_SCOPE, scope])); } catch (e) { thrown = e; }
      expect(thrown, `${scope} was accepted — Harvest could read a church's inbox`)
        .toBeInstanceOf(GmailScopeError);
      expect((thrown as Error).message, `${scope} was refused for the wrong reason`)
        .toContain('beyond send-only');
    }
  });

  it('🔴 …and FAILS CLOSED when it cannot tell', async () => {
    const { assertSendOnlyGmailScopes, GmailScopeError } = await import('../../lib/gmail-scopes');
    // ⚠️ "No scopes configured" is exactly the case where Composio falls back to
    // its broad defaults — full mailbox read/write. A guard that shrugged here
    // would open on its own failure, which is the shape THE-216 removed
    // elsewhere in this repo.
    for (const scopes of [null, [] as string[]]) {
      let thrown: unknown;
      try {
        assertSendOnlyGmailScopes({ toolkitSlug: 'gmail', isComposioManaged: true, scopes });
      } catch (e) { thrown = e; }
      expect(thrown, 'the scope guard opened on an unreadable config').toBeInstanceOf(GmailScopeError);
      expect((thrown as Error).message).toContain('declares no OAuth scopes');
    }
    // And an identity-only config is refused too: it would connect and then fail
    // every send, which is a silent half-working state.
    expect(() => assertSendOnlyGmailScopes({
      toolkitSlug: 'gmail', isComposioManaged: true,
      scopes: ['https://www.googleapis.com/auth/userinfo.email'],
    })).toThrow(GmailScopeError);
  });

  it('the converted section states the send-only promise and touches no scope', () => {
    const src = readSrc(INTEGRATIONS);
    expect(src, 'the send-only copy left the Gmail card').toMatch(/never read your inbox/i);
    // The section must not be where scopes are decided — that is the route's job.
    expect(code(INTEGRATIONS), 'the section started naming Gmail scopes')
      .not.toMatch(/gmail\.(readonly|modify|compose)|mail\.google\.com/);
  });

  it('gmail-scopes.ts and the connect route are byte-identical', async () => {
    const { createHash } = await import('node:crypto');
    // Recorded here rather than in a fixture because these two are not in
    // THE-286's set and this slice is the first to make a claim about them.
    for (const rel of ['src/lib/gmail-scopes.ts', 'src/app/api/composio/gmail/connect/route.ts']) {
      const now = createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');
      expect(now, `${rel} changed — this slice must not touch the scope path`)
        .toBe(GMAIL_PATH_DIGESTS[rel]);
    }
  });
});

/**
 * sha256 of the two files that decide what Gmail scope Harvest may hold,
 * recorded at PR time from origin/main at 133d557. Read from a constant rather
 * than derived with `git show` at assertion time: a depth-1 clone has no base
 * revision to show, and a test that shells out to git fails for reasons that
 * are not about the code.
 */
const GMAIL_PATH_DIGESTS: Record<string, string> = {
  'src/lib/gmail-scopes.ts': 'c32ba5516b09a10e2b9f1fe83ca5f1657a04661a5676f35d4ce2a0f0ba827b10',
  'src/app/api/composio/gmail/connect/route.ts': 'e06e576687bfac84d2b9e1a900a66b0735ec4cdcaba3e0d79552184e85b728e4',
};

/* ═══════════════════════════════════════════════════════════════════════════
 * 9 — 🔴 the add-on entitlement lift is still `||`
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('9 · the add-on entitlement lift is still `||`, never assignment', () => {
  it('🔴 aiChat lifts by OR against the owned add-on, and is never assigned', () => {
    // No-regression on THE-253: `base.aiChat || owned.aiAssistant > 0` GRANTS
    // when the add-on is held and never takes away what the plan already gave.
    // An assignment would hand the add-on's answer to a tenant whose plan
    // already said yes — and, worse, take it away from one whose plan said yes
    // and who holds no add-on.
    const files = ['src/utils/plan-features.ts', 'src/utils/entitlements.ts', 'src/lib/entitlements.ts']
      .filter((rel) => { try { readSrc(rel); return true; } catch { return false; } });
    const lift = files.map((rel) => [rel, code(rel)] as const)
      .find(([, body]) => /aiChat/.test(body) && /aiAssistant/.test(body));
    expect(lift, 'the aiChat entitlement lift could not be located').toBeTruthy();
    const [, body] = lift!;
    expect(body, 'the aiChat lift is no longer an OR').toMatch(/aiChat\s*:\s*[^,;]*\|\|[^,;]*aiAssistant/);
    // 🔴 And never an assignment to the flag.
    expect(body, 'the aiChat entitlement is assigned rather than lifted')
      .not.toMatch(/\baiChat\s*=(?!=)/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 13 — colour, emoji, palettes
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('13 · no colour hardcoded, no emoji; all four palettes resolve — Classic first', () => {
  it.each(CONVERTED)('%s hardcodes no colour', (rel) => {
    expect(code(rel), `${rel} hardcodes a colour`)
      .not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d|hsla?\(\s*\d/);
  });

  it.each(CONVERTED)('%s spells no literal palette class', (rel) => {
    // The numbered scales ARE remapped to per-palette variables in
    // tailwind.config.ts, so they do resolve — but THE-286 settled that a
    // converted section names the SEMANTIC token instead, and these two files
    // between them spelled eighteen of them (text-green-600, text-yellow-600,
    // border-red-200, bg-red-50, hover:bg-yellow-50, text-blue-500 …).
    expect(code(rel), `${rel} spells a literal palette colour`)
      .not.toMatch(/\b(?:text|bg|border|ring)-(?:red|green|blue|yellow|amber|emerald|slate|gray|grey|zinc)-\d{2,3}\b/);
  });

  it.each(CONVERTED)('🔴 %s uses no emoji as UI', (rel) => {
    // OnboardingSection rendered ▲ ▼ for reorder, 🔍 for the country picker
    // hint and ✓ for the save confirmation — dingbats standing in for icons,
    // which is what "no emoji as UI" forbids. lucide-react is already imported.
    const EMOJI = /[←-⇿⌀-➿⬀-⯿️\u{1F000}-\u{1FAFF}]/u;
    const found = code(rel).match(EMOJI);
    expect(found, `${rel} renders ${found?.[0]} as UI`).toBeNull();
    expect(readSrc(rel), `${rel} draws no icon from lucide-react`).toContain("from 'lucide-react'");
  });

  it('every colour they do spell is a token the four palettes define — Classic first', () => {
    const globals = readSrc('src/app/globals.css');
    // Classic is the default since #409, so it is asserted first.
    for (const p of ['classic', 'harvest', 'light', 'dark']) {
      expect(globals.toLowerCase(), `the ${p} palette is gone`).toContain(p);
    }
    // The tokens these two files actually name. Every one already exists —
    // this slice defines none, which is STOP condition 7.
    for (const token of ['--text-faint', '--text-muted', '--text-strong', '--text-body',
                         '--surface-raised', '--surface-sunken', '--surface-chip', '--surface-tint',
                         '--border-default', '--border-subtle',
                         '--ink-danger-strong', '--c-danger-tint', '--surface-gold']) {
      expect(globals, `${token} is not defined — this slice must not define it`).toContain(token);
    }
  });

  it('and no new token or component was minted', async () => {
    const { createHash } = await import('node:crypto');
    // globals.css and tailwind.config.ts are untouched, so "no new token" is a
    // fact about the tree rather than a promise in a comment.
    for (const rel of ['src/app/globals.css', 'tailwind.config.ts']) {
      expect(createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex'),
        `${rel} changed — this slice must mint no token`).toBe(TOKEN_SOURCE_DIGESTS[rel]);
    }
    // And settings/ gained no component file.
    const files = readdirSync(path.join(ROOT, 'src/components/settings')).filter((f) => /\.tsx?$/.test(f));
    expect(files.sort(), 'settings/ gained or lost a file').toEqual([
      'AddOnsSection.tsx', 'BillingTermToggle.tsx', 'BrandingSection.tsx', 'DomainSection.tsx',
      'GivingStatementsSection.tsx', 'IntegrationsSection.tsx', 'OnboardingSection.tsx',
      'PaymentSection.tsx', 'PlanUpgradeSection.tsx', 'SectionHeading.tsx', 'SettingsAccordion.tsx',
      'SmsSection.tsx', 'autosave.ts', 'integration-providers.ts', 'useStripeReturn.ts',
      'useTenantId.ts',
    ]);
  });
});

/** sha256 of the two files that define the design tokens, at origin/main 133d557. */
const TOKEN_SOURCE_DIGESTS: Record<string, string> = {
  'src/app/globals.css': '772c79af681c2b97c496b91be4f2573415f2a65802dfac078dbc72e8a8fd3741',
  'tailwind.config.ts': '32af690fa7f32c4e568deb8b66ff827ffbace309a07a83ff0d4582dd2cd15749',
};

/* ═══════════════════════════════════════════════════════════════════════════
 * 14 & 15 — the blast radius
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('14 · AdminSettings.regroup.test.tsx\'s structural assertions still hold', () => {
  it('the accordion still mounts every section on the same row ids, in order', () => {
    const src = readSrc('src/components/AdminSettings.tsx');
    const rowOf = (id: string) => src.match(new RegExp(`id: '${id}',[\\s\\S]{0,400}?content: <(\\w+)`))?.[1] ?? null;
    expect(rowOf('onboarding'), 'the Onboarding row stopped mounting OnboardingSection').toBe('OnboardingSection');
    expect(rowOf('giving-statements')).toBe('GivingStatementsSection');
    expect(rowOf('sms')).toBe('SmsSection');
    expect(rowOf('integrations')).toBe('IntegrationsSection');
  });

  /**
   * ⚠️ THE-312 gave this pin an APPEND PATH. The literal below is still the
   * baseline recorded from origin/main at 133d557 and is NOT replaced when a
   * later ticket edits the screen — that ticket appends its own digest, ticket
   * and reason to `RECORDED_EDITS`. An unrecorded edit still fails.
   */
  it('🔴 AdminSettings.tsx itself is untouched — the rows and their gates did not move', () => {
    expect(
      freezeFailure(
        'src/components/AdminSettings.tsx',
        'fa75caa9825fd36b1d12ae3472405e005469abe282bd2e26b1177ae6bd7885d9',
      ),
      'AdminSettings.tsx changed — this slice converts sections, not the screen',
    ).toBeNull();
  });

  it('every Composio endpoint IntegrationsSection owns is still called from it', () => {
    const src = readSrc(INTEGRATIONS);
    for (const endpoint of [
      '/api/composio/instagram/status', '/api/composio/instagram/connect', '/api/composio/instagram/disconnect',
      '/api/composio/mailchimp/status', '/api/composio/mailchimp/connect', '/api/composio/mailchimp/disconnect',
      '/api/composio/gmail/status', '/api/composio/gmail/connect', '/api/composio/gmail/disconnect',
      '/api/composio/gmail/address',
    ]) {
      expect(src, `${endpoint} is no longer called from IntegrationsSection`).toContain(endpoint);
    }
    expect(src).toContain('primaryInstagramAdmin');
    expect(src).toContain('primaryMailchimpAdmin');
    expect(src, 'Gmail grew a tenant-wide primary').not.toMatch(/primaryGmail/i);
  });
});

describe('15 · layout.tsx, firestore.rules and functions/ are byte-identical', () => {
  it.each(Object.entries(UNTOUCHED.rulesAndFunctions))('%s is unchanged', async (rel, digest) => {
    const { createHash } = await import('node:crypto');
    expect(createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex'),
      `${rel} changed — it is out of bounds for this slice`).toBe(digest);
  });

  it('🔴 src/app/layout.tsx is unchanged — the brief forbids opening it', async () => {
    const { createHash } = await import('node:crypto');
    expect(createHash('sha256').update(readFileSync(path.join(ROOT, 'src/app/layout.tsx'))).digest('hex'),
      'layout.tsx changed — the brief forbids opening it').toBe('bf5f96a61c3fa2f467556f44f0b36e91e49b7c830609b37c775fa6a2b9232ca5');
  });

  /**
   * ⚠️ THE-312 gave this pin an APPEND PATH, and note what it does NOT touch:
   * the account-deletion flow is asserted BEHAVIOURALLY elsewhere — the
   * `deleteState` machine, all eight outcome messages, the silent-failure fix,
   * the re-auth path and `DELETE_CONFIRM_COPY` deep-equal to the live
   * `MEMBER_DATA_MAP` derivation. Those assertions are what protect the flow;
   * this digest only records that it did not move unannounced.
   */
  it('and the protected delete flow is unchanged', () => {
    for (const [rel, digest] of Object.entries(UNTOUCHED.protectedFlows)) {
      expect(freezeFailure(rel, digest),
        `${rel} changed — the member erasure flow is out of bounds`).toBeNull();
    }
  });
});
