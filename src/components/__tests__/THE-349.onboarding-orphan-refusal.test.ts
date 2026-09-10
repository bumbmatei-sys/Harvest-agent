import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * THE-349 · onboarding is the SECOND writer of a member's ministry.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `AuthPage` is the creating writer, but it is not the only one. THE-336 gave
 * `Onboarding` a safety net — `writeUserDoc` creates the document when
 * `AuthPage`'s create was refused — and that net carried the SAME defect one
 * layer down: `tenantId: tenantId || null` off `getTenantScope()`, which
 * answers null both for a host where null is correct and for a host whose
 * ministry it simply could not name. Fixing only `AuthPage` would have moved
 * the orphan here rather than removed it.
 *
 * 🔴 AND THE-336's OWN FIX MUST SURVIVE INTACT. Before #479 nobody could
 * create an account at all: both writes were `updateDoc`, which rejects with
 * `not-found` on a document that does not exist, and the last step of
 * onboarding rejected with `No document to update: …/users/<uid>`. This file
 * re-asserts that outcome — the create still happens, and the two branches are
 * still two — alongside the refusal this ticket adds.
 *
 * ⚠️ THE-336's docblock is often read as having predicted this bug. It did not
 * predict it, and saying so precisely matters: it warns against a BARE
 * `setDoc(ref, fields, { merge: true })` creating a document with "no
 * `tenantId`, which is the field that decides which ministry" — an ABSENT
 * field, from a shape THE-336 deliberately did not ship. The document in
 * production has a `tenantId`; it is PRESENT and it is null. Same field, and a
 * different failure: one is a fragment, the other is a confident wrong answer.
 * THE-336's branch is the reason the field is there at all.
 */

const { authMock, setDocMock, updateDocMock, getDocMock, tenantScopeMock, superAdminMock } = vi.hoisted(() => ({
  authMock: { currentUser: { uid: 'u-new', email: 'friend@gmail.test', displayName: null as string | null } },
  setDocMock: vi.fn(async () => {}),
  updateDocMock: vi.fn(async () => {}),
  getDocMock: vi.fn(async (): Promise<{ exists: () => boolean; data?: () => Record<string, unknown> }> => (
    { exists: () => false }
  )),
  tenantScopeMock: vi.fn(async () => null as string | null),
  superAdminMock: vi.fn(() => false),
}));

vi.mock('../../firebase', () => ({
  auth: authMock, db: {}, messaging: Promise.resolve(null), VAPID_KEY: 'vapid',
}));
vi.mock('firebase/messaging', () => ({ getToken: vi.fn(async () => 'tok') }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  setDoc: setDocMock,
  updateDoc: updateDocMock,
  getDoc: getDocMock,
  arrayUnion: (...v: unknown[]) => ({ __arrayUnion: v }),
}));
vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: tenantScopeMock,
  getWriteTenantScope: tenantScopeMock,
  getTenantId: vi.fn(async () => null),
  isSuperAdmin: superAdminMock,
}));
vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'get', WRITE: 'write', UPDATE: 'update' },
  handleFirestoreError: () => {},
}));
vi.mock('motion/react', () => ({
  motion: new Proxy({}, { get: () => 'div' }),
  AnimatePresence: ({ children }: { children: unknown }) => children,
}));

import { TENANT_UNRESOLVED_MESSAGE } from '../../utils/auth-tenant-resolution';

const setURL = (u: string) =>
  (window as unknown as { happyDOM: { setURL: (u: string) => void } }).happyDOM.setURL(u);

const loadOnboarding = async () => import('../Onboarding');
const USER = { uid: 'u-new', email: 'friend@gmail.test', displayName: null };

/** The payload handed to `setDoc` — what Firestore would actually store. */
const createdPayload = () =>
  (setDocMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];

beforeEach(() => {
  vi.clearAllMocks();
  getDocMock.mockResolvedValue({ exists: () => false });
  tenantScopeMock.mockResolvedValue(null);
  superAdminMock.mockReturnValue(false);
  setURL('https://kingdom-living.theharvest.app/onboarding');
});

/* ═════════════════════════════════════════════════════════════════════════════
 * Test 11 — THE-336's fix is intact: a new account can still complete onboarding
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('1 · 🔴 THE-336 — a document that does not exist is CREATED, not rejected', () => {
  it('the create still happens on a tenant host, with the ministry on it', async () => {
    tenantScopeMock.mockResolvedValue('kingdom-living');
    const { writeUserDoc } = await loadOnboarding();

    await expect(writeUserDoc(USER, { onboardingCompleted: true })).resolves.toBeUndefined();

    expect(updateDocMock, 'updateDoc requires the document to exist — this is the #479 bug returning')
      .not.toHaveBeenCalled();
    expect(setDocMock).toHaveBeenCalledTimes(1);
    const payload = createdPayload();
    // The identity block THE-336 insisted the create carries, still whole.
    for (const key of ['uid', 'email', 'displayName', 'createdAt', 'role', 'tenantId']) {
      expect(Object.keys(payload), `a created document without ${key} is a half-created account`)
        .toContain(key);
    }
    expect(payload.tenantId).toBe('kingdom-living');
    expect(payload.onboardingCompleted).toBe(true);
  });

  it('and no consent is invented on the way — THE-73 stands', async () => {
    tenantScopeMock.mockResolvedValue('kingdom-living');
    const { writeUserDoc } = await loadOnboarding();
    await writeUserDoc(USER, { onboardingCompleted: true });
    expect(Object.keys(createdPayload())).not.toContain('termsAccepted');
    expect(Object.keys(createdPayload())).not.toContain('newsletter');
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * Test 12 — the two-branch write is still two branches
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('2 · 🔴 the write is still a BRANCH, not one merge', () => {
  it('an existing document takes updateDoc with the caller’s fields ONLY', async () => {
    // `firestore.rules` refuses a self-edit whose affected keys include `role`
    // or `tenantId`. Sending the identity block on an UPDATE would make every
    // member's own answers un-saveable. THE-336 split the write for this;
    // THE-349 changes only the create side of it.
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ tenantId: 'kingdom-living' }) });
    const { writeUserDoc } = await loadOnboarding();
    await writeUserDoc(USER, { country: 'Kenya', onboardingCompleted: true });

    expect(setDocMock, 'an existing document was re-created').not.toHaveBeenCalled();
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    const payload = (updateDocMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    expect(Object.keys(payload).sort()).toEqual(['country', 'onboardingCompleted']);
    expect(Object.keys(payload), 'the rule refuses a self-edit that touches tenantId').not.toContain('tenantId');
    expect(Object.keys(payload), 'the rule refuses a self-edit that touches role').not.toContain('role');
  });

  it('🔴 and the update branch is NEVER refused, whatever the host', async () => {
    // The member already belongs to a ministry; this ticket must not lock them
    // out of saving their own answers because the host cannot name it.
    setURL('https://kingdomliving.church/onboarding');
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ tenantId: 'kingdom-living' }) });
    const { writeUserDoc } = await loadOnboarding();
    await expect(writeUserDoc(USER, { onboardingCompleted: true })).resolves.toBeUndefined();
    expect(updateDocMock).toHaveBeenCalledTimes(1);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * The defect, one layer down
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('3 · 🔴 the CREATE refuses rather than writing tenantId: null', () => {
  it('a host that names no ministry throws, and writes nothing', async () => {
    setURL('https://kingdomliving.church/onboarding');
    tenantScopeMock.mockResolvedValue(null);
    const { writeUserDoc, TENANT_UNRESOLVED_CODE } = await loadOnboarding();

    await expect(writeUserDoc(USER, { onboardingCompleted: true }))
      .rejects.toMatchObject({ code: TENANT_UNRESOLVED_CODE });
    expect(setDocMock, 'the orphan was created here instead of in AuthPage').not.toHaveBeenCalled();
  });

  it('and the member is told what to do, not "something went wrong"', async () => {
    const { saveFailureMessage, TENANT_UNRESOLVED_CODE } = await loadOnboarding();
    expect(saveFailureMessage({ code: TENANT_UNRESOLVED_CODE })).toBe(TENANT_UNRESOLVED_MESSAGE);
    // The generic branch is untouched for everything else.
    expect(saveFailureMessage({ code: 'unavailable' })).toMatch(/could not reach the server/i);
    expect(saveFailureMessage({ code: 'permission-denied' })).toMatch(/no longer valid/i);
    expect(saveFailureMessage(new Error('who knows'))).toMatch(/press Finish to try again/i);
  });
});

describe('4 · the nulls that are CORRECT still get written', () => {
  it('the apex writes null and does not throw', async () => {
    setURL('https://theharvest.app/onboarding');
    tenantScopeMock.mockResolvedValue(null);
    const { writeUserDoc } = await loadOnboarding();
    await expect(writeUserDoc(USER, { onboardingCompleted: true })).resolves.toBeUndefined();
    expect(createdPayload().tenantId).toBeNull();
  });

  it.each(['www', 'app', 'admin', 'affiliate'])('%s.theharvest.app writes null and does not throw', async (sub) => {
    setURL(`https://${sub}.theharvest.app/onboarding`);
    tenantScopeMock.mockResolvedValue(null);
    const { writeUserDoc } = await loadOnboarding();
    await expect(writeUserDoc(USER, { onboardingCompleted: true })).resolves.toBeUndefined();
    expect(createdPayload().tenantId).toBeNull();
  });

  it('a vercel preview writes null and does not throw', async () => {
    setURL('https://harvest-agent-git-the-349-abc.vercel.app/onboarding');
    tenantScopeMock.mockResolvedValue(null);
    const { writeUserDoc } = await loadOnboarding();
    await expect(writeUserDoc(USER, { onboardingCompleted: true })).resolves.toBeUndefined();
    expect(createdPayload().tenantId).toBeNull();
  });

  it('🔴 a SUPER ADMIN on a host that names no ministry still writes null, unrefused', async () => {
    // They legitimately carry `tenantId: null` — PLATFORM_TENANT_ID stands in
    // on the write paths. Refusing them would be this ticket breaking the very
    // thing its non-negotiables name.
    setURL('https://kingdomliving.church/onboarding');
    tenantScopeMock.mockResolvedValue(null);
    superAdminMock.mockReturnValue(true);
    const { writeUserDoc } = await loadOnboarding();
    await expect(writeUserDoc(USER, { onboardingCompleted: true })).resolves.toBeUndefined();
    expect(createdPayload().tenantId).toBeNull();
  });

  it('and a member whose own document already names a ministry is resolved by it', async () => {
    // getTenantScope's existing fallback chain — host, then super admin, then
    // the user's own doc — is asked FIRST and is unchanged. Only its null is
    // now interrogated further.
    setURL('https://kingdomliving.church/onboarding');
    tenantScopeMock.mockResolvedValue('kingdom-living');
    const { writeUserDoc } = await loadOnboarding();
    await writeUserDoc(USER, { onboardingCompleted: true });
    expect(createdPayload().tenantId).toBe('kingdom-living');
  });
});
