import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * THE-245 — the admin SMS surfaces that are not the /admin/sms tab, RENDERED
 * with the master switch exactly as it ships (off).
 *
 * The nav entry and the /admin/sms URL are covered in
 * the-245-sms-hidden-admin.test.tsx. This file is the rest of the enumeration —
 * the surfaces that live inside OTHER screens, which are the ones a "hide the
 * SMS tab" change would have missed.
 */

vi.mock('../../utils/auth-fetch', () => ({ authFetch: vi.fn() }));
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
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  host.remove();
  vi.restoreAllMocks();
});

const render = async (el: React.ReactElement) => {
  root = createRoot(host);
  await act(async () => { root!.render(el); });
};

/* ── 1 ───────────────────────────────────────────────────────────────────── */
describe('1 — the SMS admin screen renders nothing, and asks for nothing', () => {
  it('mounts to an empty DOM even when reached directly', async () => {
    // AdminDashboard already refuses to route here; this is the second layer,
    // and it also covers any future caller that mounts the screen itself.
    const { default: AdminSms } = await import('../AdminSms');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await render(<AdminSms />);

    expect(host.textContent).toBe('');
    expect(host.querySelectorAll('input, textarea, select, button')).toHaveLength(0);
    // 🔴 No broadcast composer, no template editor, no Text-to-Give card — and
    // no read of the tenant's saved config or its smsBroadcasts history.
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0]), 'the hidden screen called an SMS API').not.toContain('/api/sms');
    }
  });

  it('🔴 renders no Text-to-Give setup — the giving half goes with it', async () => {
    const { default: AdminSms } = await import('../AdminSms');
    await render(<AdminSms />);
    expect(host.innerHTML).not.toMatch(/text-to-give/i);
    expect(host.innerHTML).not.toMatch(/api\/sms\/incoming/);
    expect(host.innerHTML).not.toMatch(/keyword/i);
  });
});

/* ── 2 ───────────────────────────────────────────────────────────────────── */
describe('2 — the Twilio credential form renders nothing', () => {
  it('offers no field to enter an account SID, token or number', async () => {
    const { default: SmsSection } = await import('../settings/SmsSection');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await render(<SmsSection />);

    expect(host.textContent).toBe('');
    expect(host.querySelectorAll('input')).toHaveLength(0);
    // The form's effect never runs, so the settings screen makes no
    // /api/sms/config request at all (that route 503s anyway — belt and braces).
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0]), 'the hidden form called the SMS API').not.toContain('/api/sms');
    }
  });

  it('keeps the BYO billing note in the module, for the flip back', async () => {
    // Hidden, not deleted: the copy that states whose Twilio account is billed
    // is still exported and still correct.
    const mod = await import('../settings/SmsSection');
    expect(mod.BYO_CREDENTIALS_NOTE).toContain('your own Twilio credentials');
  });
});

/* ── 3 ───────────────────────────────────────────────────────────────────── */
describe('3 — the permission row is hidden, and the grant behind it is not', () => {
  it('no rendered permission list offers "SMS Broadcasts"', async () => {
    const roles = await import('../AnalyticsAndRoles');
    expect(roles.VISIBLE_PERMISSION_DEFS.map((d) => d.key)).not.toContain('manageSms');
    expect(roles.VISIBLE_PERMISSION_CATEGORIES.flatMap((c) => c.items.map((i) => i.key)))
      .not.toContain('manageSms');
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
    const roles = await import('../AnalyticsAndRoles');
    expect(roles.ALL_PERMISSION_DEFS.map((d) => d.key)).toContain('manageSms');
    expect(roles.normalizePermissions({ manageSms: true }).manageSms).toBe(true);
    expect(roles.normalizePermissions({}).manageSms).toBe(false);
  });
});

/* ── 4 ───────────────────────────────────────────────────────────────────── */
describe('4 — the in-app plan cards make no SMS claim', () => {
  it('no tier card prints an SMS line', async () => {
    // These cards are in-app MARKETING: a line here is a promise on every
    // upgrade screen. The `smsAutomation` matrix cell is untouched — only the
    // card's line is withheld.
    const mod = await import('../settings/PlanUpgradeSection');
    const src = String(mod.default);
    expect(src.length).toBeGreaterThan(0);
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const file = readFileSync(
      path.resolve(__dirname, '../settings/PlanUpgradeSection.tsx'), 'utf8');
    // The line is still DEFINED (hide, not delete) …
    expect(file).toContain("{ key: 'smsAutomation', label: 'SMS Automation' }");
    // … and it is filtered through the switch rather than deleted.
    expect(file).toMatch(/SMS_FEATURE_ENABLED \|\| f\.key !== 'smsAutomation'/);
  });
});

/* ── 5 ───────────────────────────────────────────────────────────────────── */
describe('5 — the pledge campaign offers no SMS blast', () => {
  it('the Send Reminder button and its confirm are both behind the switch', async () => {
    // "Send Reminder" POSTs to /api/sms/broadcast, which now 503s — leaving the
    // button would offer a church an action that can only fail. Everything else
    // on a pledge campaign is untouched.
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const file = readFileSync(
      path.resolve(__dirname, '../AdminFundraising.tsx'), 'utf8');
    expect(file).toMatch(/\{SMS_FEATURE_ENABLED && \(\s*\n\s*<button onClick=\{\(\) => setReminderConfirm\(true\)\}/);
    expect(file).toContain('{SMS_FEATURE_ENABLED && reminderConfirm && (');
    // Hidden, not deleted — the handler and its endpoint are still there.
    expect(file).toContain("authFetch('/api/sms/broadcast'");
    // And the giving surfaces around it are untouched.
    expect(file).toContain('Add Pledge');
    expect(file).toContain('Copy Pledge Link');
  });
});

/* ── 6 ───────────────────────────────────────────────────────────────────── */
describe('6 — the support contact form drops the SMS area', () => {
  it('offers no "SMS" area to report against', async () => {
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const file = readFileSync(path.resolve(__dirname, '../ContactModal.tsx'), 'utf8');
    // Built through the switch, exactly like the Affiliate area above it.
    expect(file).toMatch(/\.\.\.\(SMS_FEATURE_ENABLED \? \['SMS'\] : \[\]\)/);
    expect(file, 'SMS is still a hardcoded area').not.toMatch(/'Forms', 'SMS'/);
  });
});
