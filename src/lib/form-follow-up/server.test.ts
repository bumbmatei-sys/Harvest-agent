import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const state = vi.hoisted(() => ({ docs: {} as Record<string, any>, writes: [] as any[], failure: false, denied: false, legacyPermission: false, superAdmin: false, permissionChecks: [] as string[], reads: [] as string[] }));
vi.mock('@/lib/api-auth', () => ({
  requireAuth: async () => ({ uid: 'owner', tenantId: 'a', isSuperAdmin: state.superAdmin }),
  requireTenantPermission: async (_request: unknown, _tenantId: string, permission: string) => {
    state.permissionChecks.push(permission);
    return state.denied || (state.legacyPermission && permission !== 'seeFormsInbox') ? NextResponse.json({}, { status: 403 }) : { uid: 'owner', tenantId: 'a' };
  },
}));
vi.mock('@/lib/firebase-admin', () => {
  const collection = (path: string): any => ({
    get: async () => ({ docs: Object.entries(state.docs).filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')).map(([key, value]) => ({ id: key.slice(path.length + 1), data: () => value })) }),
    where: (field: string, _operator: string, value: unknown) => ({ get: async () => ({ docs: Object.entries(state.docs).filter(([key, data]) => key.startsWith(`${path}/`) && data[field] === value).map(([key, data]) => ({ id: key.slice(path.length + 1), data: () => data })) }) }),
    doc: (id = 'new') => ({
      id, collection: (name: string) => collection(`${path}/${id}/${name}`),
      get: async () => { state.reads.push(`${path}/${id}`); if (state.failure) throw new Error('Read failed'); return { exists: !!state.docs[`${path}/${id}`], data: () => state.docs[`${path}/${id}`] }; },
      update: async (data: any) => state.writes.push(data), create: async (data: any) => state.writes.push(data),
    }),
  });
  return { adminDb: { collection, runTransaction: async (fn: any) => fn({ get: (ref: any) => ref.get(), create: (_ref: any, data: any) => state.writes.push(data), update: (_ref: any, data: any) => state.writes.push(data) }) } };
});
import { InvalidFollowUp, validateFollowUp } from './server';
import { parseFollowUp } from './model';
import { POST as saveForm } from '@/app/api/forms/save/route';
import { POST as saveSignup, PATCH as updateSignup } from '@/app/api/signup-pages/route';
import { GET as options } from '@/app/api/form-follow-up/options/route';
import { GET as publicFollowUp } from '@/app/api/form-follow-up/route';
const listing = { tenantId: 'a', slug: 'grace', name: 'Grace', logoUrl: '', shortDescription: 'Welcome', memberCount: 12, isPublic: true };
beforeEach(() => {
  state.failure = false; state.denied = false; state.writes = []; state.legacyPermission = false; state.superAdmin = false; state.permissionChecks = []; state.reads = [];
  state.docs = { 'discovery_listings/a': listing, 'tenants/a/settings/community': { isPublic: true }, 'tenants/a': { ownerId: 'owner', subdomain: 'grace' }, 'users/owner': { tenantId: 'a' }, 'tenants/a/digitalProducts/download': { status: 'published', title: 'Welcome PDF', description: 'Read together', coverUrl: '' }, 'tenants/b/digitalProducts/foreign': { status: 'published', title: 'Foreign PDF', description: 'Foreign' }, 'courses/course': { tenantId: 'a', status: 'published', title: 'Welcome course', description: 'Learn together' }, 'tenants/a/forms/form': { active: true, followUp: { type: 'community', id: 'a' } }, 'signup_pages/page': { tenantId: 'a', ownerUid: 'owner', handle: 'hello', active: true } };
});
const request = (path: string, body: any, method = 'POST') => new NextRequest(`https://theharvest.app${path}`, { method, body: JSON.stringify(body) });
const fields = Object.fromEntries(['name', 'email', 'phone', 'prayerRequest'].map(key => [key, { enabled: true, required: false }]));
const formInput = () => ({ tenantId: 'a', formId: null as string | null, title: 'Form', description: '', fields: [] as any[], followUp: null });
const formField = () => ({ id: 'field', type: 'short_text', label: 'Your name', order: 0 });
describe('server follow-up validation', () => {
  it.each(['b', undefined])('denies stale tenant A claims with current user tenant %s before permission checks or writes', async tenantId => {
    if (tenantId) state.docs['users/owner'].tenantId = tenantId;
    else delete state.docs['users/owner'];
    for (const formId of [null, 'form']) {
      expect((await saveForm(request('/api/forms/save', { ...formInput(), formId }))).status).toBe(403);
    }
    expect((await options(new NextRequest('https://theharvest.app/api/form-follow-up/options?tenantId=a'))).status).toBe(403);
    expect(state.permissionChecks).toEqual([]);
    expect(state.reads).toEqual(['users/owner', 'users/owner', 'users/owner']);
    expect(state.writes).toEqual([]);
  });
  it('preserves the super admin membership exception', async () => {
    state.superAdmin = true;
    delete state.docs['users/owner'];
    expect((await saveForm(request('/api/forms/save', formInput()))).status).toBe(200);
    expect((await options(new NextRequest('https://theharvest.app/api/form-follow-up/options?tenantId=a'))).status).toBe(200);
  });
  it('lets legacy seeFormsInbox admins save and load follow-up choices', async () => {
    state.legacyPermission = true;
    expect((await saveForm(request('/api/forms/save', formInput()))).status).toBe(200);
    expect(state.writes).toHaveLength(1);
    expect((await options(new NextRequest('https://theharvest.app/api/form-follow-up/options?tenantId=a'))).status).toBe(200);
    expect(state.permissionChecks).toEqual(['manageForms', 'seeFormsInbox', 'manageForms', 'seeFormsInbox']);
  });
  it('returns a visible failure if membership cannot be read', async () => {
    state.failure = true;
    expect((await saveForm(request('/api/forms/save', formInput()))).status).toBe(503);
    expect((await options(new NextRequest('https://theharvest.app/api/form-follow-up/options?tenantId=a'))).status).toBe(503);
    expect(state.permissionChecks).toEqual([]);
    expect(state.writes).toEqual([]);
  });
  it.each([
    { title: 'x'.repeat(201) }, { description: 'x'.repeat(10001) },
    { fields: Array.from({ length: 101 }, (_, i) => ({ ...formField(), id: `f${i}`, order: i })) },
    ...['label', 'placeholder', 'scaleMinLabel', 'scaleMaxLabel'].map(key => ({ fields: [{ ...formField(), [key]: 'x'.repeat(501) }] })),
    { fields: [{ ...formField(), type: 'dropdown', options: Array(101).fill('Option') }] },
    { fields: [{ ...formField(), type: 'dropdown', options: ['x'.repeat(501)] }] },
    { fields: [null] }, { fields: [{ ...formField(), type: 'unknown' }] },
    { fields: [{ ...formField(), required: 'true' }] }, { fields: [{ ...formField(), options: [42] }] },
    { fields: [{ ...formField(), extra: { nested: 'data' } }] }, { fields: [{ ...formField(), order: -1 }] },
    { fields: [{ ...formField(), type: 'scale', scaleMin: 10, scaleMax: 1 }] },
    { fields: [{ ...formField(), type: 'scale', scaleMax: 11 }] },
    { fields: [{ ...formField(), type: 'scale', scaleMin: 1.5 }] },
    { fields: [formField(), formField()] },
  ])('rejects oversized or malformed form content before writing (%#)', async patch => {
    expect((await saveForm(request('/api/forms/save', { ...formInput(), ...patch }))).status).toBe(400);
    expect(state.writes).toEqual([]);
  });
  it('caps the complete request by UTF-8 bytes even without Content-Length', async () => {
    const body = { ...formInput(), fields: Array.from({ length: 100 }, (_, i) => ({ ...formField(), id: `f${i}`, order: i, options: Array(100).fill('é'.repeat(500)) })) };
    expect((await saveForm(request('/api/forms/save', body))).status).toBe(413);
    expect(state.writes).toEqual([]);
  });
  it('accepts bounded content and preserves supported field types and scale settings', async () => {
    const body = { ...formInput(), title: 'x'.repeat(200), description: 'x'.repeat(10000), fields: ['short_text', 'long_text', 'email', 'phone', 'number', 'dropdown', 'radio', 'checkbox', 'date', 'rating', 'scale'].map((type, order) => ({ id: `f${order}`, type, label: 'x'.repeat(500), placeholder: 'x'.repeat(500), required: true, order, ...(type === 'scale' ? { scaleMin: 0, scaleMax: 10, scaleMinLabel: 'x'.repeat(500), scaleMaxLabel: 'x'.repeat(500) } : {}), ...(type === 'dropdown' ? { options: Array(100).fill('x'.repeat(500)) } : {}) })) };
    expect((await saveForm(request('/api/forms/save', body))).status).toBe(200);
    expect(state.writes[0].fields).toEqual(body.fields);
  });
  it('allows Free tenants to choose a same-tenant public community or published product', async () => {
    state.docs['tenants/a'].plan = 'free';
    const choices = [{ type: 'community', id: 'a' }, { type: 'product', id: 'course' }, { type: 'product', productKind: 'digital', id: 'download' }];
    for (const followUp of choices) {
      expect((await saveForm(request('/api/forms/save', { ...formInput(), followUp }))).status).toBe(200);
      expect(state.writes.at(-1).followUp).toEqual(followUp);
      expect((await saveSignup(request('/api/signup-pages', { title: 'Signup', message: '', handle: 'fresh', fields, followUp }))).status).toBe(201);
    }
    const result = await options(new NextRequest('https://theharvest.app/api/form-follow-up/options?tenantId=a'));
    expect((await result.json()).options).toHaveLength(3);
    state.docs['courses/course'].tenantId = 'b';
    await expect(validateFollowUp('a', choices[1])).rejects.toBeInstanceOf(InvalidFollowUp);
    state.docs['tenants/a/settings/community'].isPublic = false;
    await expect(validateFollowUp('a', choices[0])).rejects.toBeInstanceOf(InvalidFollowUp);
  });
  it.each(['bad.slug', 'evil/path', 'app', '-invalid', 'a'.repeat(64)])('rejects invalid community host slug %s even when tenant and listing agree', async slug => {
    state.docs['discovery_listings/a'] = { ...listing, slug };
    state.docs['tenants/a'].subdomain = slug;
    await expect(validateFollowUp('a', { type: 'community', id: 'a' })).rejects.toBeInstanceOf(InvalidFollowUp);
  });
  it.each(['restricted', 'unknown', null])('excludes restricted courses (%s) from choices and rejects saved references', async accessMode => {
    state.docs['courses/course'].accessMode = accessMode;
    await expect(validateFollowUp('a', { type: 'product', id: 'course' })).rejects.toBeInstanceOf(InvalidFollowUp);
    const response = await options(new NextRequest('https://theharvest.app/api/form-follow-up/options?tenantId=a'));
    expect((await response.json()).options.map((item: any) => item.id)).not.toContain('course');
    expect((await saveForm(request('/api/forms/save', { ...formInput(), followUp: { type: 'product', id: 'course' } }))).status).toBe(400);
    expect(state.writes).toEqual([]);
  });
  it('accepts None and rejects malformed selections', async () => {
    expect(await validateFollowUp('a', null)).toBeNull();
    for (const value of [{ type: 'community', id: '../a' }, { type: 'other', id: 'a' }, { type: 'product', id: 'course', tenantId: 'a' }]) expect(() => parseFollowUp(value)).toThrow();
  });
  it('accepts the same tenant public community and published product with public URLs', async () => {
    expect(await validateFollowUp('a', { type: 'community', id: 'a' })).toMatchObject({ href: 'https://grace.theharvest.app', listing });
    expect(await validateFollowUp('a', { type: 'product', id: 'course' })).toMatchObject({ href: 'https://grace.theharvest.app/courses/course', listing: { name: 'Welcome course' } });
  });
  it('rejects a cross-tenant community or product id', async () => {
    state.docs['courses/course'].tenantId = 'b';
    await expect(validateFollowUp('a', { type: 'community', id: 'b' })).rejects.toBeInstanceOf(InvalidFollowUp);
    await expect(validateFollowUp('a', { type: 'product', id: 'course' })).rejects.toBeInstanceOf(InvalidFollowUp);
  });
  it('validates digital products in the tenant path and excludes unpublished downloads', async () => {
    expect(await validateFollowUp('a', { type: 'product', productKind: 'digital', id: 'download' })).toMatchObject({ href: 'https://grace.theharvest.app/products/download', listing: { name: 'Welcome PDF' } });
    await expect(validateFollowUp('a', { type: 'product', productKind: 'digital', id: 'foreign' })).rejects.toBeInstanceOf(InvalidFollowUp);
    state.docs['tenants/a/digitalProducts/download'].status = 'draft';
    await expect(validateFollowUp('a', { type: 'product', productKind: 'digital', id: 'download' })).rejects.toBeInstanceOf(InvalidFollowUp);
  });
  it('rejects private, deleted and unpublished targets', async () => {
    state.docs['tenants/a/settings/community'].isPublic = false;
    await expect(validateFollowUp('a', { type: 'community', id: 'a' })).rejects.toThrow('no longer public');
    for (const status of ['draft', undefined]) {
      state.docs['courses/course'].status = status;
      await expect(validateFollowUp('a', { type: 'product', id: 'course' })).rejects.toBeInstanceOf(InvalidFollowUp);
    }
    await expect(validateFollowUp('a', { type: 'product', id: 'missing' })).rejects.toBeInstanceOf(InvalidFollowUp);
  });
  it('propagates read failures instead of turning them into None', async () => {
    state.failure = true;
    await expect(validateFollowUp('a', { type: 'product', id: 'course' })).rejects.toThrow('Read failed');
  });
  it('rejects cross-tenant targets before either form or signup writes', async () => {
    const followUp = { type: 'product', id: 'course' };
    state.docs['courses/course'].tenantId = 'b';
    expect((await saveForm(request('/api/forms/save', { tenantId: 'a', formId: null, title: 'Form', description: '', fields: [], followUp }))).status).toBe(400);
    expect((await saveSignup(request('/api/signup-pages', { title: 'Signup', message: '', handle: 'hello', fields, followUp }))).status).toBe(400);
    expect((await updateSignup(request('/api/signup-pages', { pageId: 'page', active: true, title: 'Signup', message: '', handle: 'hello', fields, followUp }, 'PATCH'))).status).toBe(400);
    expect(state.writes).toEqual([]);
  });
  it('stores validated follow-ups on both signup create and update', async () => {
    const input = { title: 'Signup', message: '', handle: 'fresh', fields, followUp: { type: 'community', id: 'a' } };
    expect((await saveSignup(request('/api/signup-pages', input))).status).toBe(201);
    expect(state.writes.at(-1).followUp).toEqual(input.followUp);
    expect((await updateSignup(request('/api/signup-pages', { ...input, handle: 'hello', pageId: 'page', active: true }, 'PATCH'))).status).toBe(200);
    expect(state.writes.at(-1).followUp).toEqual(input.followUp);
  });
  it('lists only public or published same-tenant choices and enforces permission', async () => {
    state.docs['courses/foreign'] = { tenantId: 'b', status: 'published', title: 'Foreign', description: '' };
    state.docs['courses/draft'] = { tenantId: 'a', status: 'draft', title: 'Draft', description: '' };
    const req = () => new NextRequest('https://theharvest.app/api/form-follow-up/options?tenantId=a');
    const response = await options(req());
    expect(response.status).toBe(200);
    expect((await response.json()).options).toEqual([{ type: 'community', id: 'a', name: 'Grace' }, { type: 'product', id: 'course', name: 'Welcome course' }, { type: 'product', productKind: 'digital', id: 'download', name: 'Welcome PDF' }]);
    state.denied = true;
    expect((await options(req())).status).toBe(403);
  });
  it('saves a validated reference and denies missing forms permissions', async () => {
    const body = { tenantId: 'a', formId: null, title: 'Form', description: '', fields: [], followUp: { type: 'community', id: 'a' } };
    expect((await saveForm(request('/api/forms/save', body))).status).toBe(200);
    expect(state.writes[0].followUp).toEqual(body.followUp);
    state.denied = true; state.writes = [];
    expect((await saveForm(request('/api/forms/save', body))).status).toBe(403);
    expect(state.writes).toEqual([]);
  });
  it('rechecks public visibility and distinguishes no selection from failed reads', async () => {
    const req = () => new NextRequest('https://theharvest.app/api/form-follow-up?tenantId=a&formId=form');
    expect((await (await publicFollowUp(req())).json()).item.listing.name).toBe('Grace');
    state.docs['tenants/a/settings/community'].isPublic = false;
    expect((await publicFollowUp(req())).status).toBe(410);
    state.docs['tenants/a/forms/form'].followUp = null;
    expect(await (await publicFollowUp(req())).json()).toEqual({ item: null });
    state.failure = true;
    expect((await publicFollowUp(req())).status).toBe(503);
  });
});
