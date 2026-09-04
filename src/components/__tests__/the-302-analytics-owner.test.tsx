import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * THE-302 part 1 — a paying tenant owner can see their own dashboard.
 *
 * ─── The production report, and what it actually was ─────────────────────────
 *
 * "I bought a ministry plan. I cannot see any of the dashboards. It says I have
 * to contact an admin for it." The tenant document was correct — `plan: 'max'`,
 * `status: 'active'`, `setupCompleted: true`, `ownerId === createdBy` — so this
 * was neither a plan problem nor a provisioning problem. The purchase landed and
 * the gate refused anyway.
 *
 * 🔴 The cause is an ABSENT FIELD, not a wrong one. No provisioning path — free,
 * Dodo or Stripe — writes `users/{uid}.permissions` at all; all three write
 * `{ tenantId, role, plan, onboardingCompleted, signupInProgress, updatedAt }`
 * and stop. The gate's three terms are `super_admin`, `permissions.fullAccess`
 * and `permissions.analytics`, so the buyer satisfied none of them.
 *
 * ─── What these tests defend, in one sentence ────────────────────────────────
 *
 * That the fix reaches EXACTLY ONE uid per tenant. The docblock on
 * `analytics-permission.ts` refuses to mirror firestore.rules' `hasPermission`
 * because that helper grants to the tenant owner AND to every address on
 * `tenant_private.adminEmails` — which would make the Analytics checkbox in the
 * permission matrix decorative. So the interesting assertion here is not "the
 * owner is granted"; it is the PAIR below, where two admins on one tenant carry
 * byte-identical user documents apart from their uid, and only the one matching
 * `tenants/grace.ownerId` gets in.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type BuiltQuery = { path: string[]; where: Array<[string, string, unknown]>; limit: number | null };

const { built, counts, docsFor, docReads, authState, rosterCalls } = vi.hoisted(() => ({
  built: [] as BuiltQuery[],
  counts: new Map<string, number | Error>(),
  docsFor: new Map<string, Array<Record<string, unknown>>>(),
  docReads: new Map<string, Record<string, unknown> | null>(),
  authState: { currentUser: null as { uid: string; email: string; displayName?: string } | null },
  /** Every URL the gate fetches. Expected to stay empty — see below. */
  rosterCalls: [] as string[],
}));

/**
 * 🔴 A ROSTER THAT ANSWERS YES TO EVERYONE.
 *
 * GET /api/tenants/roster-status is the ONLY way a browser can learn whether an
 * address is on `tenant_private.adminEmails` — the doc itself is
 * `allow read, write: if false`. So this stub is the mutation "grant every
 * invited admin" made available: if the gate ever reaches for the roster, it
 * gets a grant, and the invited admin below is let in. It must never be called.
 */
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
  rosterCalls.push(String(input));
  return { ok: true, status: 200, json: async () => ({ isRosterAdmin: true }) } as Response;
});

vi.mock('../../firebase', () => ({
  db: {},
  get auth() { return authState; },
}));

/**
 * ⚠️ `super-admins` is deliberately NOT mocked, for the reason THE-276's suite
 * gives: its list must stay identical to firestore.rules, and a mock would let
 * the super-admin arm pass against an address the real platform does not know.
 * Every email below is outside it except the one case that names itself.
 */
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ __path: segments }),
  where: (field: string, op: string, value: unknown) => ({ __where: [field, op, value] as [string, string, unknown] }),
  limit: (n: number) => ({ __limit: n }),
  orderBy: (field: string, dir: string) => ({ __orderBy: [field, dir] }),
  doc: (_db: unknown, ...segments: string[]) => ({ __doc: segments.join('/') }),
  query: (base: { __path: string[] }, ...constraints: Array<Record<string, unknown>>) => {
    const q: BuiltQuery = {
      path: base.__path,
      where: constraints.filter((c) => '__where' in c).map((c) => c.__where as [string, string, unknown]),
      limit: (constraints.find((c) => '__limit' in c)?.__limit as number) ?? null,
    };
    built.push(q);
    return q;
  },
  getCountFromServer: async (q: BuiltQuery) => {
    const answer = counts.get(q.path.join('/'));
    if (answer instanceof Error) throw answer;
    return { data: () => ({ count: answer ?? 0 }) };
  },
  getDocs: async (q: BuiltQuery) => {
    const rows = docsFor.get(q.path.join('/')) ?? [];
    return { docs: rows.map((data, i) => ({ id: `doc-${i}`, data: () => data })) };
  },
  getDoc: async (ref: { __doc: string }) => {
    const data = docReads.get(ref.__doc) ?? null;
    return { exists: () => data !== null, data: () => data ?? undefined };
  },
}));

const AdminDashboardHome = (await import('../AdminDashboardHome')).default;
const { canViewAnalytics, hasAnalyticsAccess } = await import('../dashboard/analytics-permission');
const { getPlanFeatures, PLAN_ORDER, PLAN_DISPLAY_NAMES, FREE_PLAN } = await import('../../utils/plan-features');
const { PROVISIONED_TENANT_OWNER_ROLE } = await import('../../lib/roles');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const GATE_SRC = readFileSync(path.join(REPO_ROOT, 'src/components/dashboard/analytics-permission.ts'), 'utf8');

/* ── Mounting ─────────────────────────────────────────────────────────────── */

let container: HTMLDivElement;
let root: Root | null = null;

async function mount(node: React.ReactElement): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(node);
  });
  // The gate resolves across two awaited reads (`users/{uid}`, then
  // `tenants/{id}`), so one flush is not enough to leave the pending state.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return container;
}

const screen = () =>
  mount(<AdminDashboardHome tenantId="grace" tenantName="Grace Chapel" isSuperAdmin={false} unreadCount={0} onNavigate={() => {}} />);

const granted = (c: HTMLElement) => !!c.querySelector('[data-dashboard-tabs]');
const denied = (c: HTMLElement) => !!c.querySelector('[data-analytics-denied]');

/**
 * The buyer, exactly as provisioning leaves them.
 *
 * 🔴 NO `permissions` KEY. Not `permissions: {}` — absent. That is the shape all
 * three provisioning paths write, and writing an empty map here instead would
 * quietly test a document the product never creates.
 */
function provisionedOwner(tenantId: string) {
  return { tenantId, role: PROVISIONED_TENANT_OWNER_ROLE, plan: 'max', onboardingCompleted: true, signupInProgress: false };
}

beforeEach(() => {
  built.length = 0;
  counts.clear();
  docsFor.clear();
  docReads.clear();
  rosterCalls.length = 0;
  authState.currentUser = null;
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  container?.remove();
});

/* ═══ 1 · The owner, on every paid tier ══════════════════════════════════════ */

describe('a tenant owner on any paid plan can see the dashboard', () => {
  const PAID_TIERS = PLAN_ORDER.filter((p) => p !== FREE_PLAN);

  it('there are three paid tiers, and they are the ones named below', () => {
    // Guards the loop: a fifth tier added to PLAN_ORDER must be named here
    // before it can be silently left untested.
    expect([...PAID_TIERS]).toEqual(['plus', 'pro', 'max']);
  });

  it.each(PAID_TIERS)(
    'the owner of a %s tenant is granted, with no permissions map at all',
    async (tier) => {
      authState.currentUser = { uid: 'owner1', email: 'pastor@grace.org', displayName: 'Ada Grace' };
      docReads.set('users/owner1', { ...provisionedOwner('grace'), plan: tier });
      docReads.set('tenants/grace', { plan: tier, status: 'active', ownerId: 'owner1', createdBy: 'owner1' });

      const c = await screen();
      expect(granted(c), `${PLAN_DISPLAY_NAMES[tier]} owner was refused their own dashboard`).toBe(true);
      expect(denied(c)).toBe(false);
    },
  );

  it('the free tier\'s owner is granted too — the grant is ownership, not tier', async () => {
    // The gate carries no plan clause and must not grow one: "free gets
    // analytics" is expressed by `crm: true` in the plan matrix and nowhere
    // else. A tier-shaped grant here would be a second, disagreeing matrix.
    authState.currentUser = { uid: 'owner1', email: 'pastor@grace.org' };
    docReads.set('users/owner1', { ...provisionedOwner('grace'), plan: 'free' });
    docReads.set('tenants/grace', { plan: 'free', status: 'active', ownerId: 'owner1' });

    expect(granted(await screen())).toBe(true);
  });

  it('and the pure expression says so without any Firestore at all', () => {
    expect(canViewAnalytics(PROVISIONED_TENANT_OWNER_ROLE, undefined, true)).toBe(true);
    expect(canViewAnalytics(PROVISIONED_TENANT_OWNER_ROLE, null, true)).toBe(true);
    // 🔴 The mutation this line exists for: delete the owner term and this is
    // the assertion that goes red.
    expect(canViewAnalytics(PROVISIONED_TENANT_OWNER_ROLE, undefined, false)).toBe(false);
  });
});

/* ═══ 2 · The property the gate exists for ═══════════════════════════════════ */

describe('an invited admin with Analytics unchecked still cannot', () => {
  /**
   * 🔴 THE PAIR. Two admins, one tenant, identical documents apart from the uid
   * — and `grace.ownerId` names only the first. If the fix were "mirror the
   * rules helper" or "grant everyone on `tenant_private.adminEmails`", both of
   * these would be granted and this case would go red, which is the entire
   * reason it is written as a pair rather than as one denial.
   */
  it('two admins on one tenant, identical but for the uid — only the owner gets in', async () => {
    const userDoc = { tenantId: 'grace', role: PROVISIONED_TENANT_OWNER_ROLE, plan: 'max', onboardingCompleted: true };
    docReads.set('tenants/grace', { plan: 'max', status: 'active', ownerId: 'owner1' });
    docReads.set('users/owner1', { ...userDoc });
    docReads.set('users/helper1', { ...userDoc });

    authState.currentUser = { uid: 'owner1', email: 'pastor@grace.org' };
    expect(granted(await screen())).toBe(true);

    if (root) await act(async () => { root!.unmount(); });
    root = null;
    container.remove();

    authState.currentUser = { uid: 'helper1', email: 'helper@grace.org' };
    const c = await screen();
    expect(granted(c), 'an invited admin was granted analytics they were never given').toBe(false);
    expect(denied(c)).toBe(true);
    // And they were refused without the roster being consulted at all — the
    // stub above would have said yes.
    expect(rosterCalls, `the gate called ${rosterCalls.join(', ')}`).toEqual([]);
  });

  it('the refusal survives the invited admin holding every OTHER permission', async () => {
    authState.currentUser = { uid: 'helper1', email: 'helper@grace.org' };
    docReads.set('tenants/grace', { plan: 'max', ownerId: 'owner1' });
    docReads.set('users/helper1', {
      tenantId: 'grace',
      role: PROVISIONED_TENANT_OWNER_ROLE,
      permissions: { manageCRM: true, manageAdmins: true, manageForms: true, manageBranding: true, analytics: false },
    });

    expect(denied(await screen())).toBe(true);
  });

  /**
   * ⚠️ The roster is a SERVER-ONLY document (`tenant_private` is
   * `allow read, write: if false`), so the only way this module could grant on
   * it is by calling GET /api/tenants/roster-status. There is nothing to observe
   * behaviourally when the call is simply never made — so the absence is pinned
   * in the source, the way THE-276's own guards pin what this slice may not do.
   */
  it('the gate never asks the roster, in any spelling', () => {
    // Belt to the stub's braces: the stub catches a roster lookup at runtime,
    // this catches one written in a shape no test happens to reach.
    expect(GATE_SRC.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/adminEmails|roster|fetch\(/i);
    // `ownerId` is the discriminator, and it is read off the world-readable
    // tenant doc — one uid, never a list.
    expect(GATE_SRC).toContain('ownerId');
  });
});

/* ═══ 3 · The checkbox still works ═══════════════════════════════════════════ */

describe('an invited admin with Analytics checked can', () => {
  it('is granted, and the tenant document is never even read for them', async () => {
    authState.currentUser = { uid: 'helper1', email: 'helper@grace.org' };
    docReads.set('users/helper1', { tenantId: 'grace', role: 'admin', permissions: { analytics: true } });
    // 🔴 No `tenants/grace` entry on purpose: an admin the checkbox already
    // grants must not depend on a second read that could fail.
    expect(granted(await screen())).toBe(true);
  });

  it('and fullAccess grants the same way it always did', async () => {
    authState.currentUser = { uid: 'helper2', email: 'deputy@grace.org' };
    docReads.set('users/helper2', { tenantId: 'grace', role: 'admin', permissions: { fullAccess: true } });
    expect(granted(await screen())).toBe(true);
  });
});

/* ═══ 4 · No regression ══════════════════════════════════════════════════════ */

describe('a super admin still can', () => {
  it('is granted by email, before any document is read', async () => {
    const { SUPER_ADMIN_EMAILS } = await import('../../utils/super-admins');
    authState.currentUser = { uid: 'sa1', email: SUPER_ADMIN_EMAILS[0] };
    // No user document and no tenant document: the email arm answers first.
    expect(await hasAnalyticsAccess()).toBe(true);
  });

  it('and the role arm is untouched by the new term', () => {
    expect(canViewAnalytics('super_admin', {})).toBe(true);
    expect(canViewAnalytics('super_admin', null, false)).toBe(true);
  });

  /**
   * 🔴 THE-299's GUARD, ASSERTED AS BEHAVIOUR RATHER THAN AS A HASH.
   *
   * `the-299-retention-guards` pins this module's digest to prove the Platform
   * tab's removal left the super-admin concept alone. THE-302 legitimately moves
   * that digest — it adds the owner term — so the fingerprint alone would go
   * from "the concept is intact" to "the file is whatever THE-302 left". These
   * three cases restate the claim in a form a hash cannot make: the super-admin
   * path is exercised, not merely unchanged.
   */
  it('the super admin resolves granted with NO documents and ownership false', async () => {
    const { SUPER_ADMIN_EMAILS } = await import('../../utils/super-admins');
    authState.currentUser = { uid: 'sa1', email: SUPER_ADMIN_EMAILS[0] };
    // Nothing in the store: no `users/sa1`, and a tenant owned by someone else.
    docReads.set('tenants/grace', { plan: 'max', ownerId: 'someone-else' });

    const c = await screen();
    expect(granted(c), 'the super admin lost the dashboard').toBe(true);
    expect(denied(c)).toBe(false);
    // The email arm answers before the read, so the owner term never runs — the
    // new code path cannot be what is carrying them.
    expect(rosterCalls).toEqual([]);
  });

  it('the super_admin ROLE grants on a tenant it does not own', async () => {
    authState.currentUser = { uid: 'sa2', email: 'staff@grace.org' };
    docReads.set('users/sa2', { tenantId: 'grace', role: 'super_admin', permissions: {} });
    docReads.set('tenants/grace', { plan: 'max', ownerId: 'owner1' });

    expect(granted(await screen()), 'the super_admin role arm stopped granting').toBe(true);
    // Stated as the property, not just the outcome: the role decides on its own,
    // with ownership false.
    expect(canViewAnalytics('super_admin', {}, false)).toBe(true);
  });

  it('and the apex answer THE-299 pins is still the apex answer', async () => {
    // The other half of that guard's claim, from the module that owns the
    // string rather than from a grep of it.
    const { REASON } = await import('../dashboard/dashboard-data');
    expect(REASON.noTenant).toBe('No ministry is in scope, so this cannot be read.');
  });

  it('a signed-out visitor is still refused, and reads nothing', async () => {
    const c = await screen();
    expect(denied(c)).toBe(true);
    expect(built).toHaveLength(0);
  });

  it('an unreadable tenant document denies rather than grants', async () => {
    // Fail CLOSED, both reads. A tenant doc that cannot be read is not evidence
    // of ownership.
    authState.currentUser = { uid: 'owner1', email: 'pastor@grace.org' };
    docReads.set('users/owner1', provisionedOwner('grace'));
    expect(denied(await screen())).toBe(true);
  });

  it('a user document with no tenantId denies rather than grants', async () => {
    authState.currentUser = { uid: 'orphan', email: 'orphan@grace.org' };
    docReads.set('users/orphan', { role: 'admin' });
    docReads.set('tenants/grace', { ownerId: 'orphan' });
    expect(denied(await screen())).toBe(true);
  });
});

/* ═══ 5 · The plan clause ════════════════════════════════════════════════════ */

describe('the plan clause is satisfied on every paid tier', () => {
  /**
   * The shell gates the Signups entry on `navAllows(features?.crm)` alongside
   * the permission, so "the dashboard should be available in all paid plans"
   * has a second half: `crm` must be true wherever a paid owner looks. It is —
   * on all four tiers, free included — so the founder's premise holds and there
   * is no second bug to report. A tier that ever loses the cell fails HERE,
   * named, rather than silently hiding the tab from the people who paid.
   */
  it.each(PLAN_ORDER)('%s carries crm', (tier) => {
    expect(getPlanFeatures(tier).crm, `${PLAN_DISPLAY_NAMES[tier]} (${tier}) has no crm cell`).toBe(true);
  });

  it('names every tier that is missing it, rather than just failing', () => {
    const missing = PLAN_ORDER.filter((p) => !getPlanFeatures(p).crm);
    expect(missing, `tiers without crm: ${missing.join(', ') || 'none'}`).toEqual([]);
  });

  it('and there is still no analytics cell in the plan matrix', () => {
    // Inventing one would be a flag nothing reads — the defect that removed
    // `churchDirectory`, `customBackground` and `publicCalendar`.
    for (const tier of PLAN_ORDER) {
      expect(getPlanFeatures(tier)).not.toHaveProperty('analytics');
    }
  });
});
