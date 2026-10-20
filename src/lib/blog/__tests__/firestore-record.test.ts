import { describe, expect, it } from 'vitest';

import { readStoredBlogPost } from '@/lib/blog/firestore-store';
import { unreadableRowWouldBePublic } from '@/lib/blog/visibility';

const CREATED = '2026-01-04T18:00:00.000Z';

describe('stored blog posts', () => {
  it('loads a Share-to-blog draft that has no updatedAt', () => {
    const post = readStoredBlogPost('draft-1', {
      title: 'Untitled',
      content: '<p>From a note</p>',
      status: 'draft',
      tenantId: 'sample',
      author: 'Ada',
      createdAt: CREATED,
    });
    expect(post).toMatchObject({
      id: 'draft-1',
      tenantId: 'sample',
      status: 'draft',
      title: 'Untitled',
      category: '',
      createdAt: CREATED,
      updatedAt: CREATED,
      authorId: '',
    });
  });

  it('keeps a real updatedAt and refuses a row with no createdAt', () => {
    const stamp = { toDate: () => new Date('2026-02-02T00:00:00.000Z') };
    expect(readStoredBlogPost('p', {
      title: 'Titled',
      content: '<p>Body</p>',
      status: 'published',
      tenantId: 'sample',
      createdAt: CREATED,
      updatedAt: stamp,
    })?.updatedAt).toBe('2026-02-02T00:00:00.000Z');
    expect(readStoredBlogPost('p', {
      title: 'Titled',
      content: '<p>Body</p>',
      status: 'draft',
      tenantId: 'sample',
    })).toBeNull();
  });

  it('an unreadable draft is not a public miss, and an unreadable published post is', () => {
    const now = Date.parse('2026-07-15T12:00:00.000Z');
    const draft = { status: 'draft', title: 'Legacy', tenantId: 'sample' };
    const live = { status: 'published', title: 'Broken', tenantId: 'sample', publishedAt: '2026-06-01T00:00:00.000Z' };
    const waiting = { status: 'scheduled', publishedAt: '2026-12-01T16:00:00.000Z', tenantId: 'sample' };
    expect(readStoredBlogPost('d', draft)).toBeNull();
    expect(readStoredBlogPost('l', live)).toBeNull();
    expect(unreadableRowWouldBePublic(draft, now)).toBe(false);
    expect(unreadableRowWouldBePublic(waiting, now)).toBe(false);
    expect(unreadableRowWouldBePublic(live, now)).toBe(true);
  });
});
