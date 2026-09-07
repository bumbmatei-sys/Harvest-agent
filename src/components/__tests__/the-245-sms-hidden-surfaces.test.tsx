import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * THE-245 / THE-314 — the admin SMS surfaces that are not the /admin/sms tab.
 *
 * 🔴 REVERSED BY THE-314, NOT DELETED. THE-245 rendered each of these with the
 * master switch off and asserted an empty DOM. The switch is now ON, so each
 * one is asserted BACK — and the OFF direction is still proved, by mocking the
 * flag false rather than by trusting the docblock.
 *
 * This is the enumeration that matters most: these surfaces live inside OTHER
 * screens, so they are exactly the ones a "hide the SMS tab" change would have
 * missed on the way out, and a "show the SMS tab" change would miss on the way
 * back in.
 *
 * The nav entry and the /admin/sms URL are covered in
 * the-245-sms-hidden-admin.test.tsx.
 */

const json = (body: unknown) => Promise.resolve({
  ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(''),
});

/**
 * ⚠️ THE-327 — `/api/sms/numbers` NOW ANSWERS WITH A LIVE NUMBER, and it has to.
 *
 * The SMS screen shows setup instead of a composer while the ministry has no
 * number (a church with none cannot broadcast at all), so a bare `{}` would
 * leave the Broadcasts/Automated switcher off the screen and the Text-to-Give
 * assertion below would fail by never reaching it. Answering with a number is
 * what puts this suite back on the surface it is actually about. The
 * no-number state is asserted directly in THE-327's own suite.
 */
const numbersAnswer = vi.hoisted(() => ({
  value: null as null | { phoneNumber: string; status: string; monthlyCostUsd: number; country: string },
}));

/**
 * ⚠️ THE CATALOGUE BRANCH ADDED BY THE-330. The panel now reads the provider's
 * country catalogue before it can draw a picker, and this mock answered every
 * `/api/sms/numbers` URL — `?countries=1` included — with `{ number: … }`, which
 * the panel correctly reads as a FAILED fetch and renders as a failure alert
 * rather than the purchase controls. Section 2 would then have asserted against
 * an error state.
 */
vi.mock('../../utils/auth-fetch', () => ({
  authFetch: vi.fn((url: string) => {
    const u = String(url);
    if (u.includes('countries=1')) {
      return json({
        countries: [
          {
            code: 'US', tier: 1, monthlyCents: 300, needsKyc: false,
            callsAvailable: true, whatsappAvailable: true, smsAvailable: true, inStock: true,
            types: [{
              numberType: 'local', smsAvailable: true, whatsappAvailable: true, callsAvailable: true,
              monthlyCents: 300, needsKyc: false, fulfilment: 'instant', inStock: true,
            }],
          },
        ],
        fetchedAt: null,
      });
    }
    if (u.includes('areas=1')) return json({ areaOptions: [] });
    return u.startsWith('/api/sms/numbers') ? json({ number: numbersAnswer.value }) : json({});
  }),
}));

/** The SMS SCREEN needs a number (without one it shows setup, not the
 *  switcher); the number PANEL needs none (with one it shows the summary, not
 *  country/area/buy). Each test says which state it is asserting. */
const withNumber = () => {
  numbersAnswer.value = { phoneNumber: '+16155550123', status: 'active', monthlyCostUsd: 3, country: 'US' };
};
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: null } }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), query: vi.fn(), orderBy: vi.fn(), limit: vi.fn(),
  onSnapshot: vi.fn(() => () => {}), doc: vi.fn(), getDoc: vi.fn(),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: () => ({ currentTenantId: 'grace', isAuthReady: true, isSuperAdmin: false }),
}));

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
  vi.doUnmock('../../lib/sms-feature');
  vi.resetModules();
});

const render = async (el: React.ReactElement) => {
  root = createRoot(host);
  await act(async () => { root!.render(el); });
};

/** Mock the master switch OFF for one module graph, so the gate is exercised
 *  rather than merely described. */
const withSwitchOff = () => {
  vi.resetModules();
  vi.doMock('../../lib/sms-feature', () => ({
    SMS_FEATURE_ENABLED: false,
    SMS_HIDDEN_MESSAGE: 'SMS is temporarily unavailable.',
  }));
};

/* ── 1 ───────────────────────────────────────────────────────────────────── */
describe('1 — the SMS admin screen is back, and asks for its config again', () => {
  it('🔴 mounts its real UI', async () => {
    const { default: AdminSms } = await import('../AdminSms');
    await render(<AdminSms />);

    expect(host.textContent).not.toBe('');
    expect(host.querySelectorAll('input, textarea, select, button').length).toBeGreaterThan(0);
  });

  it('🔴 renders the Text-to-Give setup — the giving half comes back with it', async () => {
    // ⚠️ THE-327 — the switcher is only drawn once a number exists, because a
    // ministry with none cannot broadcast and is shown setup instead. Without
    // this the Automated tab is genuinely absent and the assertion below would
    // report a deleted panel when nothing was deleted.
    withNumber();
    const { default: AdminSms } = await import('../AdminSms');
    await render(<AdminSms />);

    // Text-to-Give lives on the Automated tab, so the tab is opened rather than
    // asserted on the default view — a test that only read the landing tab
    // would pass with the whole panel deleted.
    const automated = [...host.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Automated');
    expect(automated, 'the Automated tab is gone').toBeTruthy();
    await act(async () => { automated!.click(); });

    expect(host.innerHTML).toMatch(/text-to-give/i);
    expect(host.innerHTML).toMatch(/keyword/i);
  });

  it('still mounts to an empty DOM with the switch mocked off', async () => {
    // The other direction, so the gate is live code rather than a claim in a
    // comment. AdminDashboard already refuses to route here; this is the second
    // layer, and it also covers any future caller that mounts the screen itself.
    withSwitchOff();
    const { default: AdminSms } = await import('../AdminSms');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await render(<AdminSms />);

    expect(host.textContent).toBe('');
    expect(host.querySelectorAll('input, textarea, select, button')).toHaveLength(0);
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0]), 'the hidden screen called an SMS API').not.toContain('/api/sms');
    }
  });
});

/* ── 2 ───────────────────────────────────────────────────────────────────── */
describe('2 — the number panel replaced the credential form', () => {
  it('🔴 offers NO field for an account SID, auth token or from-number', async () => {
    // ⚠️ THE ASSERTION SURVIVED THE FLIP UNCHANGED, and that is the finding.
    // THE-245 wanted these fields absent because the panel was hidden. They are
    // absent now because Harvest RESELLS: a church holds no vendor credential,
    // so there is nothing here to type and nothing here to leak.
    const { default: SmsSection } = await import('../settings/SmsSection');
    await render(<SmsSection />);

    const labels = host.textContent || '';
    expect(labels).not.toMatch(/account sid/i);
    expect(labels).not.toMatch(/auth token/i);
    expect(host.innerHTML).not.toMatch(/twilio/i);
  });

  it('offers the purchase controls instead — country, area code, buy', async () => {
    // ⚠️ THE-327 — mounted as `SmsNumberPanel`, which is where the lifecycle
    // now lives. The default export is the Settings SIGNPOST since the panel
    // moved into the SMS section; the controls themselves are unchanged, and
    // asserting them on the component that renders them is the point.
    const { SmsNumberPanel } = await import('../settings/SmsSection');
    await render(<SmsNumberPanel />);

    expect(host.textContent).toMatch(/country/i);
    expect(host.textContent).toMatch(/area code/i);
    expect(host.textContent).toMatch(/buy a number/i);
    /**
     * ⚠️ EDITED SINCE MEASUREMENT — THE-330. This asserted
     * `querySelectorAll('input').length > 0`, because the country and area code
     * were free-text boxes. THE-330 replaced both with pickers — that is the
     * ticket — so the panel offers controls, not text inputs.
     *
     * 🔴 THE CLAIM ("it offers CONTROLS, not a credential form") IS KEPT AND
     * SHARPENED: the two fields are asserted to exist AND to be pickers, so a
     * revert to a free-text country box fails here rather than passing.
     */
    expect(host.querySelectorAll('select').length).toBeGreaterThan(0);
    for (const id of ['sms-country', 'sms-area']) {
      const field = host.querySelector(`#${id}`);
      expect(field, `#${id} is missing from the purchase controls`).toBeTruthy();
      expect(field!.tagName, `#${id} is not a picker`).toBe('SELECT');
    }
  });

  it('still renders nothing with the switch mocked off, and asks for nothing', async () => {
    withSwitchOff();
    const { default: SmsSection } = await import('../settings/SmsSection');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await render(<SmsSection />);

    expect(host.textContent).toBe('');
    expect(host.querySelectorAll('input')).toHaveLength(0);
    // The panel's effect never runs, so the settings screen makes no
    // /api/sms/numbers request at all (that route 503s anyway — belt and braces).
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0]), 'the hidden panel called the SMS API').not.toContain('/api/sms');
    }
  });

  it('🔴 states who is billed, and that a release cannot be undone', async () => {
    // The copy that made THE-245's version safe to hide is the copy that makes
    // this one safe to SHOW: it names whose money is spent, and it warns before
    // an irreversible action rather than after it.
    const mod = await import('../settings/SmsSection');
    expect(mod.RESOLD_NUMBER_NOTE).toMatch(/Harvest buys and holds this number/i);
    expect(mod.RESOLD_NUMBER_NOTE).not.toMatch(/twilio/i);
    expect(mod.RELEASE_WARNING).toMatch(/cannot be recovered/i);
  });
});

/* ── 3 ───────────────────────────────────────────────────────────────────── */
describe('3 — the permission row comes back, and the grant behind it never left', () => {
  it('🔴 the rendered permission list offers "SMS Broadcasts" again', async () => {
    const roles = await import('../AdminRoles');
    expect(roles.VISIBLE_PERMISSION_DEFS.map((d) => d.key)).toContain('manageSms');
    expect(roles.VISIBLE_PERMISSION_CATEGORIES.flatMap((c) => c.items.map((i) => i.key)))
      .toContain('manageSms');
  });

  it('no rendered permission list offers it with the switch mocked off', async () => {
    withSwitchOff();
    const roles = await import('../AdminRoles');
    expect(roles.VISIBLE_PERMISSION_DEFS.map((d) => d.key)).not.toContain('manageSms');
    // Nothing left in the visible catalog mentions SMS or Text-to-Give at all —
    // the Settings & Integrations row's description named SMS too.
    for (const d of roles.VISIBLE_PERMISSION_DEFS) {
      expect(`${d.label} ${d.desc}`, `"${d.label}" still names SMS`)
        .not.toMatch(/sms|text-to-give/i);
    }
  });

  it('🔴 the DATA model keeps manageSms either way', async () => {
    // Display only. Filtering the catalog itself would silently strip the flag
    // off every admin doc that round-trips through the Roles screen.
    const roles = await import('../AdminRoles');
    expect(roles.ALL_PERMISSION_DEFS.map((d) => d.key)).toContain('manageSms');
    expect(roles.normalizePermissions({ manageSms: true }).manageSms).toBe(true);
    expect(roles.normalizePermissions({}).manageSms).toBe(false);
  });
});

/* ── 4 ───────────────────────────────────────────────────────────────────── */
describe('4 — the in-app plan cards make their SMS claim again', () => {
  it('the line is defined, and filtered through the switch rather than deleted', async () => {
    // These cards are in-app MARKETING: a line here is a promise on every
    // upgrade screen. With the switch on it prints — and because the card reads
    // the tier's own `smsAutomation` cell, it prints on Ministry alone, which is
    // the same claim the marketing site makes.
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const file = readFileSync(
      path.resolve(__dirname, '../settings/PlanUpgradeSection.tsx'), 'utf8');
    expect(file).toContain("{ key: 'smsAutomation', label: 'SMS Automation' }");
    expect(file).toMatch(/SMS_FEATURE_ENABLED \|\| f\.key !== 'smsAutomation'/);
  });
});

/* ── 5 ───────────────────────────────────────────────────────────────────── */
describe('5 — the pledge campaign offers its SMS blast again', () => {
  it('the Send Reminder button and its confirm are both behind the switch', async () => {
    // "Send Reminder" POSTs to /api/sms/broadcast. While the switch was off that
    // route 503'd and leaving the button would have offered a church an action
    // that could only fail; with it on, both come back together.
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const file = readFileSync(
      path.resolve(__dirname, '../AdminFundraising.tsx'), 'utf8');
    expect(file).toMatch(/\{SMS_FEATURE_ENABLED && \(\s*\n\s*<button onClick=\{\(\) => setReminderConfirm\(true\)\}/);
    expect(file).toContain('{SMS_FEATURE_ENABLED && reminderConfirm && (');
    // The handler and its endpoint never left.
    expect(file).toContain("authFetch('/api/sms/broadcast'");
    // And the giving surfaces around it are untouched.
    expect(file).toContain('Add Pledge');
    expect(file).toContain('Copy Pledge Link');
  });
});

/* ── 6 ───────────────────────────────────────────────────────────────────── */
describe('6 — the support contact form offers the SMS area again', () => {
  it('is built through the switch, not hardcoded either way', async () => {
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const file = readFileSync(path.resolve(__dirname, '../ContactModal.tsx'), 'utf8');
    // Built through the switch, exactly like the Affiliate area above it.
    expect(file).toMatch(/\.\.\.\(SMS_FEATURE_ENABLED \? \['SMS'\] : \[\]\)/);
    expect(file, 'SMS is a hardcoded area again').not.toMatch(/'Forms', 'SMS'/);
    const mod = await import('../ContactModal');
    expect(mod).toBeTruthy();
  });
});
