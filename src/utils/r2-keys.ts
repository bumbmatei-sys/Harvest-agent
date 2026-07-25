/**
 * R2 object keys for tenant uploads — built and validated in one place.
 *
 * The producer (/api/storage/presign) and the validator (/api/rag/extract)
 * MUST agree on the shape of a key, because the second one is the tenant
 * boundary: /api/rag/extract receives a key from the browser and has to decide,
 * from the caller's token alone, whether that key is theirs to read. If the two
 * definitions ever drift, that check silently weakens. So they share these
 * functions.
 */

/**
 * Keep the object key filesystem/URL-safe: strip path separators, whitespace,
 * and anything outside a conservative allow-list — same spirit as the
 * `path.includes('..')` guard in signed-url/route.ts.
 */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '');
  return cleaned || 'upload';
}

/** Every uploaded object for a tenant lives under this prefix. Nothing else. */
export function tenantUploadPrefix(tenantId: string): string {
  return `tenants/${tenantId}/uploads/`;
}

/** `tenants/{tenant}/uploads/{uuid}-{safe-name}` — the only shape we ever mint. */
export function tenantUploadKey(tenantId: string, id: string, fileName: string): string {
  return `${tenantUploadPrefix(tenantId)}${id}-${sanitizeFileName(fileName)}`;
}

/**
 * The complete set of characters `randomUUID()` + `sanitizeFileName()` can
 * produce. Notably it excludes `/`, which is what stops a key like
 * `tenants/a/uploads/../../b/secret.pdf` from passing a bare prefix check.
 */
const SAFE_OBJECT_NAME = /^[A-Za-z0-9._-]+$/;

/**
 * Does `key` name an object inside `tenantId`'s own uploads prefix?
 *
 * `tenantId` must come from the caller's verified token — never from the
 * request body. Anything this returns false for must be refused with 403
 * before any storage call is made.
 */
export function isTenantUploadKey(key: unknown, tenantId: string): key is string {
  if (typeof key !== 'string' || !key) return false;
  if (!tenantId || typeof tenantId !== 'string') return false;

  const prefix = tenantUploadPrefix(tenantId);
  if (!key.startsWith(prefix)) return false;

  // Reject nested paths and traversal: a real key has exactly one segment after
  // the prefix, and that segment can't contain a slash.
  return SAFE_OBJECT_NAME.test(key.slice(prefix.length));
}
