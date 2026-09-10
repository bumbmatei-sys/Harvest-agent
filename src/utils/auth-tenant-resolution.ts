import { isNonTenantSubdomain } from './non-tenant-subdomains';

/**
 * THE-349 — the tenant a signup belongs to, as THREE answers rather than two.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The bug this exists for ─────────────────────────────────────────────────
 *
 * `AuthPage` derived a tenant slug from the hostname into a `string | null`
 * and wrote it as `tenantId: tenantId || null` on both of its create paths.
 * That one operator is the Silent-Failure Rule in a single character: it
 * cannot tell
 *
 *   "this account legitimately belongs to no ministry" — a super admin, a
 *   signup on the apex, a platform alias like `www` — from
 *
 *   "this account belongs to a ministry and I could not work out which one",
 *
 * and it writes the SAME value for both. The second one creates an orphan: a
 * `users` document with `tenantId: null` on a host that serves exactly one
 * ministry. `firestore.rules` gates every piece of tenant content on the
 * `tenantId` CLAIM, and `set-custom-claims.ts` mints that claim from this very
 * field — so a null here means no claim, and no claim means the person cannot
 * be seen by their church's dashboard or CRM (`allow read` on `users` needs
 * `isTenantAdmin(resource.data.tenantId)`), cannot post a prayer request
 * (`requestHasCorrectTenant()`), and cannot read the ministry's posts. They
 * are signed in, and signed in to nothing. It is silent, it is permanent, and
 * a member cannot repair it themselves: the `users` update rule refuses a
 * self-edit whose `affectedKeys()` include `tenantId`, and refuses it for a
 * tenant admin too.
 *
 * 🔴 SO THE THIRD ANSWER IS THE WHOLE POINT. `unresolved` is not a nicer
 * spelling of null; it is the answer that must never be WRITTEN at all. A
 * caller that gets it must refuse the signup and say so, because an error a
 * person can act on beats an account that silently does nothing.
 *
 * ── What each host shape answers, and why ───────────────────────────────────
 *
 * `tenant`      `<slug>.theharvest.app` — the authoritative tenant boundary,
 *               and a custom domain whose tenant the middleware cookie names.
 * `platform`    the apex, the `www`/`app`/`admin`/`affiliate` aliases, a
 *               `*.vercel.app` preview and localhost. 🔴 NULL IS CORRECT HERE
 *               and this ticket does not touch that: super admins live on the
 *               apex with `tenantId: null` (`PLATFORM_TENANT_ID` is their
 *               write-side fallback), `memberCapRefusal` reads null as "no cap
 *               applies", and the four aliases are platform surfaces, not
 *               ministries. A preview host resolves to platform for the reason
 *               `getTenantIdFromHost` already gives: its single label
 *               (`harvest-agent-git-…`) would otherwise be read as a bogus
 *               tenant.
 * `unresolved`  a host that is none of the above — a CUSTOM DOMAIN, which
 *               serves exactly one ministry and names it nowhere in the host.
 *
 * ⚠️ THE COOKIE IS NOT A FIX ON ITS OWN, and this is measured rather than
 * assumed. `AuthPage` has always read a `tenantId=` cookie "set server-side by
 * middleware via resolve-domain" — but `src/middleware.ts` rate-limits
 * `/api/*` and does nothing else: it calls no resolver and sets no cookie, and
 * its own `config.matcher` never even runs it on a page request. (The repo
 * already carries the same finding one file over, in the switch module for
 * custom domains, which notes that `api/resolve-domain`'s docblock claims
 * middleware calls it and that middleware has not done so for some time.) So
 * on a live custom domain the cookie is absent, the fallback yields null, and
 * every signup there was an orphan. That is the reproducible instance of this
 * defect, and it is why the third answer had to exist before any hop could be
 * blamed.
 *
 * ── Kept in step with the other four resolvers ──────────────────────────────
 *
 * `non-tenant-subdomains.ts` names four places that resolve a
 * `*.theharvest.app` host and says a disagreement between them is a bug class.
 * This function agrees with `getTenantIdFromHost()` on EVERY host: wherever
 * that returns a slug this returns `tenant` with the same slug, and wherever
 * it returns null this returns `platform` or `unresolved` — never a different
 * slug. It closes one standing disagreement: `AuthPage`'s own derivation used
 * to accept `*.vercel.app` and stamp the preview's first label as a tenant,
 * so a signup on a preview URL was written into a ministry that does not
 * exist while every read resolver said null.
 */

/** Why a host answered the way it did. Named so a message can name the cause. */
export type AuthTenantReason =
  | 'tenant-subdomain'
  | 'custom-domain-cookie'
  | 'apex'
  | 'platform-subdomain'
  | 'preview-host'
  | 'local'
  | 'custom-domain'
  | 'no-hostname'
  /** Not from the host at all — the signed-in member's own `users` document. */
  | 'signed-in-user'
  /** Not from the host at all — a super admin, who legitimately has no tenant. */
  | 'super-admin';

/**
 * The tenant a `users` document created on this host must carry.
 *
 * 🔴 Three cases, and the third is not a null. `tenant` writes the slug;
 * `platform` writes null and that is CORRECT; `unresolved` writes NOTHING —
 * the caller refuses.
 */
export type AuthTenantResolution =
  | { readonly kind: 'tenant'; readonly tenantId: string; readonly reason: AuthTenantReason }
  | { readonly kind: 'platform'; readonly reason: AuthTenantReason }
  | { readonly kind: 'unresolved'; readonly reason: AuthTenantReason };

/** Hosts that are a developer's own machine — platform, never a ministry. */
function isLocalHostname(host: string): boolean {
  return (
    host === 'localhost'
    || host === '127.0.0.1'
    || host === '::1'
    || host === '[::1]'
    || host.endsWith('.localhost')
  );
}

/**
 * Classify `hostname` — and, for a custom domain only, the middleware cookie.
 *
 * Pure: reads nothing but its two arguments, so it is valid on the server and
 * testable without a DOM. `cookieTenantId` is consulted ONLY where the host
 * itself cannot answer, which is the same precedence
 * `resolveTenantIdFromHostname()` uses — the host is not spoofable by the
 * client and the cookie is, so the host wins wherever it speaks.
 */
export function resolveAuthTenant(
  hostname: string | null | undefined,
  cookieTenantId: string | null,
): AuthTenantResolution {
  const host = (hostname ?? '').trim().toLowerCase();
  if (!host) return { kind: 'unresolved', reason: 'no-hostname' };
  if (isLocalHostname(host)) return { kind: 'platform', reason: 'local' };
  if (host === 'theharvest.app') return { kind: 'platform', reason: 'apex' };

  const parts = host.split('.');
  if (parts.length >= 3 && host.endsWith('.theharvest.app')) {
    const sub = parts[0];
    // `www`, `app`, `admin`, `affiliate` are platform aliases, not ministries.
    if (!sub || isNonTenantSubdomain(sub)) return { kind: 'platform', reason: 'platform-subdomain' };
    return { kind: 'tenant', tenantId: sub, reason: 'tenant-subdomain' };
  }

  // Preview/staging. Deliberately platform — see the docblock above.
  if (host === 'vercel.app' || host.endsWith('.vercel.app')) {
    return { kind: 'platform', reason: 'preview-host' };
  }

  const cookie = (cookieTenantId ?? '').trim();
  if (cookie) return { kind: 'tenant', tenantId: cookie, reason: 'custom-domain-cookie' };

  // A custom domain with nothing to name its ministry. NOT a null.
  return { kind: 'unresolved', reason: 'custom-domain' };
}

/**
 * The `tenantId=` cookie, or null. Split out so the browser read and the
 * classification can be tested apart from one another.
 */
export function readTenantCookie(cookieHeader: string | null | undefined): string | null {
  const jar = cookieHeader ?? '';
  if (!jar) return null;
  const found = jar.split(';').find((c) => c.trim().startsWith('tenantId='));
  if (!found) return null;
  const value = found.split('=').slice(1).join('=').trim();
  return value || null;
}

/**
 * The same classification, for the browser this screen is running in.
 *
 * Safe off the browser: with no `window` it answers `unresolved`, which is the
 * honest answer for "there is no host to read" and, being the answer nothing
 * may write, cannot orphan anybody by being wrong.
 */
export function readAuthTenantFromBrowser(): AuthTenantResolution {
  if (typeof window === 'undefined') return { kind: 'unresolved', reason: 'no-hostname' };
  const cookie = typeof document === 'undefined' ? null : readTenantCookie(document.cookie);
  return resolveAuthTenant(window.location.hostname, cookie);
}

/**
 * The slug to write, or null when null is the CORRECT answer.
 *
 * 🔴 Deliberately throws on `unresolved` rather than returning null. A helper
 * that quietly turned the third answer back into the second would restore the
 * exact bug this module exists to remove, so the type system and the runtime
 * both refuse it: callers must handle `unresolved` before they get here.
 */
export function tenantIdToWrite(resolution: AuthTenantResolution): string | null {
  if (resolution.kind === 'tenant') return resolution.tenantId;
  if (resolution.kind === 'platform') return null;
  throw new Error(
    'tenantIdToWrite called with an unresolved tenant — refuse the signup instead of writing null',
  );
}

/** Heading for the refusal. Written for a member, not for whoever built this. */
export const TENANT_UNRESOLVED_TITLE = 'We could not tell which ministry this is';

/**
 * What the person is told instead of being given an account that does nothing.
 *
 * ⚠️ Every clause names something they can act on: nothing was created, where
 * the right address comes from, and who to ask. It names no error code, no
 * cookie and no middleware — none of which a visitor can do anything about.
 */
export const TENANT_UNRESOLVED_MESSAGE =
  'This web address is not one we can match to a ministry, so an account created here would '
  + 'belong to no church — invisible to its dashboard, unable to post a prayer request or read '
  + 'its posts. Nothing has been created. Open your ministry’s own address, which ends in '
  + '.theharvest.app, and sign up there — or ask whoever invited you to send you that link.';
