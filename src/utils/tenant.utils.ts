import { db, auth } from '../firebase';
import {
  collection, doc, getDoc, getDocs, deleteDoc,
} from 'firebase/firestore';
import { Tenant, TenantPlan, TenantConfig } from '../types/tenant.types';
import { readCachedRosterAnswer, cacheRosterAnswer } from './roster-cache';

const TENANTS_COLLECTION = 'tenants';

// Tenant create/update go through /api/tenants/save (Admin SDK) rather than
// the client SDK: the adminEmails roster is dual-written to the server-only
// tenant_private/{id} doc, which a client is not allowed to write, and the
// two writes must land in one atomic batch.
async function postTenantSave(body: Record<string, unknown>): Promise<string> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Not signed in.');
  const res = await fetch('/api/tenants/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to save tenant.');
  return data.id as string;
}

/** Outcome of a roster lookup: the roster said yes, said no, or we failed to ask. */
export type RosterAdminStatus = 'admin' | 'not-admin' | 'error';

/**
 * Waits between roster-lookup attempts. Two retries, so a lookup that hits a
 * transient failure costs at most ~1.6s of extra latency before it settles.
 */
const ROSTER_RETRY_BACKOFF_MS = [400, 1200];

/**
 * Total wall-clock the retries may consume. Must stay comfortably BELOW
 * AdminDashboard's ROSTER_LOOKUP_TIMEOUT_MS — that ceiling is what stops a hung
 * lookup stranding an admin on the loading skeleton, and retrying past it would
 * mean the nav gives up while this function is still trying. The invariant is
 * asserted in src/utils/__tests__/roster-lookup-retry.test.ts.
 */
export const ROSTER_RETRY_BUDGET_MS = 4000;

/**
 * Is this HTTP status worth asking again about?
 *
 * 429 is the one that matters here (THE-139): a rate limit is not a denial, it
 * is "ask again in a moment", and it clears on its own. src/lib/webhook-retry.ts
 * classifies webhook failures by exactly this reasoning — "4xx is us; 5xx is
 * them; 429 is a rate limit that clears on its own". 5xx is the server having a
 * bad moment. Every other 4xx (401, 403, 404) is a settled answer about this
 * request and will answer identically forever, so retrying only burns budget.
 */
function isRetryableRosterStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** `Retry-After` in ms. Our limiter sends whole seconds; an HTTP-date is also legal. */
function parseRetryAfterMs(header: string | null | undefined): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * "Is the current user on this tenant's admin roster?", three-state. The roster
 * lives on the server-only tenant_private doc (clients can't read it), so the
 * check goes through /api/tenants/roster-status.
 *
 * A caller that *gates UI* on the answer needs "we could not ask" kept separate
 * from an authoritative "no" — collapsing the two is THE-64, where a roster-only
 * tenant admin's nav was built from a not-yet-answered `false` and the dashboard
 * bounced them back to /admin. Such callers should use this, not the boolean
 * wrapper below, and should also treat "have not asked yet" as its own state.
 *
 * Two things stand between a transient failure and an 'error' (THE-139, where a
 * 429 from the shared `/api/*` limiter took an admin's tabs away):
 *
 *  1. A settled answer is remembered for the session (see ./roster-cache), so a
 *     remount reuses it instead of asking again. This is what keeps the admin
 *     shell from spending the tenant's rate-limit budget re-asking a question
 *     it already has the answer to.
 *  2. A retryable failure — 429, 5xx, or a network-level throw — is retried
 *     with backoff inside a bounded budget rather than reported as 'error' on
 *     the first try.
 *
 * 'error' is still returned, and still means exactly what it meant: we failed to
 * ask. It just now means we failed to ask *repeatedly*, which is what a caller
 * degrading its UI on the answer deserves to be able to assume.
 */
export async function checkRosterAdminStatus(tenantId: string): Promise<RosterAdminStatus> {
  const cached = readCachedRosterAnswer(tenantId);
  if (cached) return cached;

  const { authFetch } = await import('./auth-fetch');
  const deadline = Date.now() + ROSTER_RETRY_BUDGET_MS;

  for (let attempt = 0; ; attempt++) {
    let retryAfterMs: number | null = null;
    try {
      const res = await authFetch(`/api/tenants/roster-status?tenantId=${encodeURIComponent(tenantId)}`);
      if (res.ok) {
        const status: RosterAdminStatus =
          (await res.json()).isRosterAdmin === true ? 'admin' : 'not-admin';
        cacheRosterAnswer(tenantId, status);
        return status;
      }
      // A settled refusal is an answer about this request, not a hiccup.
      if (!isRetryableRosterStatus(res.status)) return 'error';
      retryAfterMs = parseRetryAfterMs(res.headers?.get?.('Retry-After'));
    } catch {
      // Threw before any status came back — a network-level failure, which is
      // transient by nature. Falls through to the same backoff.
    }

    const backoff = ROSTER_RETRY_BACKOFF_MS[attempt];
    if (backoff === undefined) return 'error'; // retries exhausted
    // Honour Retry-After when the limiter names a wait, but never overrun the
    // budget: a window that will not reopen inside it is an 'error' now rather
    // than a nav held hostage to it.
    const wait = Math.max(backoff, retryAfterMs ?? 0);
    if (Date.now() + wait > deadline) return 'error';
    await sleep(wait);
  }
}

/**
 * Boolean form of the roster check. Returns false on any failure — callers
 * treat the roster as a grant, never a denial, so a failed lookup costs the
 * roster bonus but never removes access the user holds via role/permissions.
 */
export async function checkRosterAdmin(tenantId: string): Promise<boolean> {
  return (await checkRosterAdminStatus(tenantId)) === 'admin';
}

/**
 * Create a new tenant.
 * Returns the tenant ID (same as subdomain for easy lookup).
 */
export async function createTenant(data: {
  name: string;
  subdomain: string;
  plan: TenantPlan;
  adminEmails: string[];
  config?: TenantConfig;
}): Promise<string> {
  return postTenantSave({
    name: data.name,
    subdomain: data.subdomain.toLowerCase().trim(),
    plan: data.plan,
    adminEmails: data.adminEmails,
    config: data.config,
  });
}

/**
 * Get a tenant by ID (which is the subdomain).
 */
export async function getTenant(id: string): Promise<Tenant | null> {
  const snap = await getDoc(doc(db, TENANTS_COLLECTION, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Tenant;
}

/**
 * Get all tenants.
 */
export async function getAllTenants(): Promise<Tenant[]> {
  const snap = await getDocs(collection(db, TENANTS_COLLECTION));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Tenant);
}

/**
 * Update a tenant's fields. (`plan` is intentionally not sent — the Stripe
 * webhook is the source of truth for plan changes on live tenants.)
 */
export async function updateTenant(
  id: string,
  data: Partial<Pick<Tenant, 'name' | 'plan' | 'status'>> & { adminEmails?: string[]; config?: Partial<TenantConfig> }
): Promise<void> {
  await postTenantSave({
    id,
    name: data.name,
    status: data.status,
    adminEmails: data.adminEmails,
    config: data.config,
  });
}

/**
 * Delete a tenant.
 */
export async function deleteTenant(id: string): Promise<void> {
  await deleteDoc(doc(db, TENANTS_COLLECTION, id));
}

/**
 * Check if a subdomain is already taken.
 */
export async function isSubdomainAvailable(subdomain: string): Promise<boolean> {
  const snap = await getDoc(doc(db, TENANTS_COLLECTION, subdomain.toLowerCase().trim()));
  return !snap.exists();
}
