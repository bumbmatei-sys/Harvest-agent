/**
 * Platform course library — authoring helpers (THE-54).
 *
 * The library is a SHARED CATALOGUE authored by super admins and readable by
 * every tenant: `libraryCourses` / `libraryAuthors` / `libraryCategories`. Its
 * Firestore rules deliberately reference NO document field, which is what makes
 * an unfiltered catalogue query legal. See the comment above
 * `match /libraryCourses` in firestore.rules.
 *
 * That design has one hard invariant, and this module exists to hold it:
 *
 *   ⚠️ A LIBRARY DOCUMENT MUST NEVER CARRY A `tenantId`.
 *
 * It is easy to break by accident. `getWriteTenantScope()` returns the PLATFORM
 * tenant (`'harvest'`) for a super admin rather than null — see the comment at
 * AdminCourseEditor's category writer — so reusing the tenant write path for a
 * library save would stamp `tenantId: 'harvest'` onto catalogue documents. That
 * would not break the rule today, but it makes platform content look
 * tenant-scoped, and the next person to read those docs would "fix" the rule to
 * match and silently make the catalogue unqueryable.
 *
 * So the editor routes every write through here, and `resolveWriteTenant` never
 * consults tenant scope at all in library mode.
 */

export interface CourseCollections {
  courses: string;
  authors: string;
  categories: string;
}

/** Per-tenant course collections — each doc carries a `tenantId` field. */
export const TENANT_COURSE_COLLECTIONS: CourseCollections = {
  courses: 'courses',
  authors: 'authors',
  categories: 'categories',
};

/** Platform catalogue collections — no doc carries a `tenantId`. */
export const LIBRARY_COURSE_COLLECTIONS: CourseCollections = {
  courses: 'libraryCourses',
  authors: 'libraryAuthors',
  categories: 'libraryCategories',
};

/** Which set of collections a given editor mode reads and writes. */
export function collectionsFor(isLibrary: boolean): CourseCollections {
  return isLibrary ? LIBRARY_COURSE_COLLECTIONS : TENANT_COURSE_COLLECTIONS;
}

/**
 * The tenant to stamp on a write, or null when there is none.
 *
 * In library mode this returns null WITHOUT calling `getScope` — the platform
 * catalogue has no tenant, and consulting tenant scope is exactly how the
 * `tenantId: 'harvest'` stamp would sneak in. `getScope` is injected so that
 * "never consulted in library mode" is directly testable.
 */
export async function resolveWriteTenant(
  isLibrary: boolean,
  getScope: () => Promise<string | null>,
): Promise<string | null> {
  if (isLibrary) return null;
  return getScope();
}

/**
 * Apply the tenant field to an outgoing document.
 *
 * Library mode DELETES the key rather than setting it to undefined —
 * `'tenantId' in doc` must be false, both because Firestore rejects undefined
 * values by default and because a present-but-empty key reads as "tenant data
 * that lost its tenant" to anyone auditing the collection later.
 *
 * Tenant mode assigns `tenantId` VERBATIM — no `?? undefined` coercion. That
 * matters: `getWriteTenantScope()` returns null for a non-super-admin whose
 * tenant cannot be resolved, and the pre-existing behaviour was to write
 * `tenantId: null` (which the rules then reject). Coercing to undefined would
 * instead make the Firestore SDK throw client-side — a different failure for
 * the same case. Callers that want the coercion pass it in themselves.
 */
export function stampTenant<T extends Record<string, unknown>>(
  isLibrary: boolean,
  data: T,
  tenantId: string | null | undefined,
): T {
  const next = { ...data } as Record<string, unknown>;
  if (isLibrary) {
    delete next.tenantId;
  } else {
    next.tenantId = tenantId;
  }
  return next as T;
}

/**
 * Doc id for a library category.
 *
 * Tenant categories are keyed `${tenantId}__${name}` so two churches can reuse a
 * label without colliding. The catalogue has exactly one namespace, so a library
 * category is keyed by a slug of its name alone — deterministic (renaming to the
 * same label reuses the doc), and carrying no tenant prefix that would imply
 * ownership the doc does not have.
 */
export function librarySlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'category';
}

/** Category doc id for either mode. Tenant mode keeps the existing scheme. */
export function categoryDocIdFor(
  isLibrary: boolean,
  tenantId: string | null | undefined,
  name: string,
): string {
  return isLibrary ? librarySlug(name) : `${tenantId}__${name}`;
}
