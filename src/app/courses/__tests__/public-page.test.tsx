import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const h = vi.hoisted(() => ({
  host: { current: 'grace.theharvest.app' },
  tenants: {} as Record<string, { id: string; name: string } | null>,
  courses: {} as Record<string, Record<string, unknown>>,
  reads: [] as string[],
}));

vi.mock('next/headers', () => ({ headers: async () => ({ get: () => h.host.current }) }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
vi.mock('@/lib/server-tenant', () => ({
  getTenantFromHostOrId: async (host: string, idHint?: string) => h.tenants[host] ?? (idHint ? h.tenants[`id:${idHint}`] ?? null : null),
}));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          h.reads.push(`${name}/${id}`);
          const data = h.courses[id];
          return { exists: !!data, id, data: () => data };
        },
      }),
    }),
  },
}));
vi.mock('@/components/PublicRouteAnalytics', () => ({ default: () => null }));

import CoursePublicPage, { generateMetadata } from '../[id]/page';

const levels = [{
  id: 'l1', title: 'Foundations',
  sections: [{ id: 's1', title: 'Start here', lessons: [{ id: 'a', title: 'Lesson A' }, { id: 'b', title: 'Lesson B' }] }],
}];
const course = (over: Record<string, unknown> = {}) => ({
  title: 'Prayer basics', description: 'Learn to pray', tenantId: 'grace', status: 'published', levels, ...over,
});

const page = async (id = 'c1', t?: string) => renderToStaticMarkup(await CoursePublicPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ t }) }));
const meta = (id = 'c1', t?: string) => generateMetadata({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ t }) });

beforeEach(() => {
  h.host.current = 'grace.theharvest.app';
  h.tenants = { 'grace.theharvest.app': { id: 'grace', name: 'Grace Church' }, 'hope.theharvest.app': { id: 'hope', name: 'Hope Church' } };
  h.courses = { c1: course() };
  h.reads = [];
});

describe('public course page: hostless tenant (no subdomain)', () => {
  it('falls back to the ?t= tenant id when the host resolves nobody', async () => {
    h.host.current = 'theharvest.app';
    h.tenants['id:free-1'] = { id: 'free-1', name: 'Free Church' };
    h.courses.c1 = course({ tenantId: 'free-1' });
    const html = await page('c1', 'free-1');
    expect(html).toContain('Prayer basics');
    expect(html).toContain('Back to Free Church');
  });
});

describe('public course page: host tenant', () => {
  it('shows a published course of the host ministry', async () => {
    const html = await page();
    expect(html).toContain('Prayer basics');
    expect(html).toContain('Back to Grace Church');
  });

  it('404s a course that belongs to another ministry, in both the page and its metadata', async () => {
    h.host.current = 'hope.theharvest.app';
    await expect(page()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(await meta()).toEqual({ title: 'Course Not Found' });
  });

  it('404s on a host that resolves to no ministry, without reading the course', async () => {
    h.host.current = 'www.theharvest.app';
    await expect(page()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(h.reads).toEqual([]);
  });

  it('404s a course with no tenantId', async () => {
    h.courses.c1 = course({ tenantId: undefined });
    await expect(page()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('404s an unknown course', async () => {
    await expect(page('nope')).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('public course page: only status published is public', () => {
  it.each([['draft', 'draft'], ['missing', undefined], ['typo', 'Published'], ['empty', '']])(
    'a %s course is a 404 and leaks no title through metadata',
    async (_n, status) => {
      h.courses.c1 = course({ status });
      await expect(page()).rejects.toThrow('NEXT_NOT_FOUND');
      expect(await meta()).toEqual({ title: 'Course Not Found' });
    },
  );
});

describe('public course page: restricted courses', () => {
  it('shows an open course with lesson counts', async () => {
    const html = await page();
    expect(html).toContain('2 lessons');
    expect(html).toContain('Start Learning');
    expect(html).toContain('Free to access');
  });

  it.each([['restricted', 'restricted'], ['unknown mode', 'Private']])(
    'a %s course shows titles only: no lesson counts, no "free" claim',
    async (_n, accessMode) => {
      h.courses.c1 = course({ accessMode });
      const html = await page();
      expect(html).toContain('Prayer basics');
      expect(html).toContain('Foundations');
      expect(html).toContain('Start here');
      expect(html).not.toMatch(/\d+ lessons?/);
      expect(html).not.toContain('Lesson A');
      expect(html).not.toContain('Free to access');
      expect(html).not.toContain('Start Learning');
      expect(html).toContain('Open in the app');
    },
  );

  it('an explicit everyone course is treated as open', async () => {
    h.courses.c1 = course({ accessMode: 'everyone' });
    expect(await page()).toContain('2 lessons');
  });
});
