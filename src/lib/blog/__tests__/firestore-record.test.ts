import { describe, expect, it } from 'vitest';

import { readStoredBlogPost } from '@/lib/blog/firestore-store';

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
});
