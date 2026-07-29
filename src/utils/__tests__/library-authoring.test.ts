import { describe, it, expect, vi } from 'vitest';
import {
  TENANT_COURSE_COLLECTIONS,
  LIBRARY_COURSE_COLLECTIONS,
  collectionsFor,
  resolveWriteTenant,
  stampTenant,
  librarySlug,
  categoryDocIdFor,
} from '../library-authoring';

/**
 * The platform course library's one hard invariant: a library document must
 * never carry a `tenantId`.
 *
 * It is easy to break because `getWriteTenantScope()` returns the PLATFORM
 * tenant ('harvest') for a super admin rather than null — so reusing the tenant
 * write path for a library save silently stamps `tenantId: 'harvest'` onto
 * catalogue docs. These tests assert on the object handed to Firestore, which is
 * where that stamp would appear.
 *
 * The last block is the Option-1 regression guard: AdminCourseEditor now serves
 * both modes, so the TENANT path must be provably unchanged.
 */
describe('library authoring helpers', () => {
  describe('collection selection', () => {
    it('library mode targets the platform catalogue collections', () => {
      expect(collectionsFor(true)).toEqual({
        courses: 'libraryCourses',
        authors: 'libraryAuthors',
        categories: 'libraryCategories',
      });
      expect(collectionsFor(true)).toEqual(LIBRARY_COURSE_COLLECTIONS);
    });

    it('tenant mode targets the existing per-tenant collections', () => {
      expect(collectionsFor(false)).toEqual({
        courses: 'courses',
        authors: 'authors',
        categories: 'categories',
      });
      expect(collectionsFor(false)).toEqual(TENANT_COURSE_COLLECTIONS);
    });
  });

  describe('resolveWriteTenant', () => {
    it('NEVER consults tenant scope in library mode', async () => {
      // The core of the trap: getWriteTenantScope() would hand back 'harvest'.
      // Library mode must not even ask.
      const getScope = vi.fn().mockResolvedValue('harvest');
      await expect(resolveWriteTenant(true, getScope)).resolves.toBeNull();
      expect(getScope).not.toHaveBeenCalled();
    });

    it('consults tenant scope in tenant mode and returns it', async () => {
      const getScope = vi.fn().mockResolvedValue('tenant-a');
      await expect(resolveWriteTenant(false, getScope)).resolves.toBe('tenant-a');
      expect(getScope).toHaveBeenCalledTimes(1);
    });

    it('passes through a null tenant scope in tenant mode', async () => {
      const getScope = vi.fn().mockResolvedValue(null);
      await expect(resolveWriteTenant(false, getScope)).resolves.toBeNull();
    });
  });

  describe('stampTenant — the payload actually written', () => {
    it('a library course payload has NO tenantId key at all', () => {
      const payload = stampTenant(true, {
        title: 'Foundations of Faith',
        status: 'published',
        authorIds: ['lib-author-1'],
        levels: [],
      }, null);

      expect('tenantId' in payload).toBe(false);
      expect(Object.keys(payload)).not.toContain('tenantId');
    });

    it('strips a tenantId that leaked into the payload upstream', () => {
      // Defence in depth: even if a caller hands over a doc already carrying
      // the platform tenant, it must not reach the catalogue.
      const payload = stampTenant(true, {
        title: 'Prayer',
        tenantId: 'harvest',
      }, 'harvest');

      expect('tenantId' in payload).toBe(false);
    });

    it('a library author payload has no tenantId', () => {
      const payload = stampTenant(true, { id: 'a1', name: 'Platform Teacher', tenantId: undefined }, null);
      expect('tenantId' in payload).toBe(false);
    });

    it('a library category payload has no tenantId', () => {
      const payload = stampTenant(true, { name: 'Discipleship' }, null);
      expect(payload).toEqual({ name: 'Discipleship' });
    });

    it('does not mutate the input object', () => {
      const input = { title: 'X', tenantId: 'harvest' };
      stampTenant(true, input, 'harvest');
      expect(input.tenantId).toBe('harvest');
    });
  });

  describe('librarySlug', () => {
    it('slugs a category name with no tenant prefix', () => {
      expect(librarySlug('Discipleship')).toBe('discipleship');
      expect(librarySlug('Prayer & Fasting')).toBe('prayer-fasting');
      expect(librarySlug('  Old Testament  ')).toBe('old-testament');
    });

    it('is deterministic — the same label always keys the same doc', () => {
      expect(librarySlug('Discipleship')).toBe(librarySlug('discipleship'));
    });

    it('never produces an empty doc id', () => {
      expect(librarySlug('!!!')).toBe('category');
      expect(librarySlug('')).toBe('category');
    });
  });

  describe('categoryDocIdFor', () => {
    it('library category ids carry NO tenant prefix', () => {
      const id = categoryDocIdFor(true, null, 'Discipleship');
      expect(id).toBe('discipleship');
      expect(id).not.toContain('__');
      expect(id).not.toContain('harvest');
    });

    it('a library id is unchanged even if a tenant is passed in', () => {
      expect(categoryDocIdFor(true, 'harvest', 'Discipleship')).toBe('discipleship');
    });
  });

  // ── Option-1 regression guard ─────────────────────────────────────────
  // AdminCourseEditor now serves both modes off one component. Everything the
  // tenant path relied on must behave exactly as it did before.
  describe('the tenant path is unchanged', () => {
    it('still stamps the tenantId on a course payload', () => {
      const payload = stampTenant(false, { title: 'Tenant Course' }, 'tenant-a');
      expect(payload).toEqual({ title: 'Tenant Course', tenantId: 'tenant-a' });
    });

    it('still keys categories `${tenantId}__${name}`', () => {
      expect(categoryDocIdFor(false, 'tenant-a', 'Discipleship')).toBe('tenant-a__Discipleship');
    });

    it('still stamps the platform tenant for a super admin on the apex', () => {
      // getWriteTenantScope() resolves 'harvest' there; tenant mode keeps that
      // behaviour so a super admin's tenant course is never orphaned.
      const payload = stampTenant(false, { title: 'Apex Course' }, 'harvest');
      expect(payload.tenantId).toBe('harvest');
    });

    it('writes tenantId VERBATIM — a null scope stays null, not undefined', () => {
      // getWriteTenantScope() returns null for a non-super-admin whose tenant
      // cannot be resolved. The pre-existing behaviour wrote `tenantId: null`
      // (which the rules then reject). Coercing to undefined would instead make
      // the Firestore SDK throw client-side — a different failure for the same
      // case, and a silent behaviour change on the tenant path.
      const payload = stampTenant(false, { title: 'Orphan' }, null);
      expect(payload.tenantId).toBeNull();
      expect('tenantId' in payload).toBe(true);
    });

    it('still targets courses/authors/categories', () => {
      expect(collectionsFor(false).courses).toBe('courses');
      expect(collectionsFor(false).authors).toBe('authors');
      expect(collectionsFor(false).categories).toBe('categories');
    });
  });
});
