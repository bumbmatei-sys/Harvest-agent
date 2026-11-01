import { describe, expect, it } from 'vitest';
import {
  STOREFRONT_BLOCK_TYPES, blockIsComplete, emptyStorefront, newStorefrontBlock, readStorefront, safeUrl, storefrontSections, videoEmbedUrl,
} from './storefront';

describe('Storefront: what a page may hold', () => {
  it('starts every block type with copy, and a link, video, picker or testimonial needs filling in', () => {
    for (const type of STOREFRONT_BLOCK_TYPES) {
      const block = newStorefrontBlock(type, `b-${type}`);
      expect(block.type).toBe(type);
      expect(blockIsComplete(block), type).toBe(!['link', 'video', 'bookCall', 'community', 'course', 'form', 'testimonials', 'text'].includes(type));
    }
  });

  it('keeps only http(s) links and drops script, data and garbage', () => {
    expect(safeUrl('instagram.com/grace')).toBe('https://instagram.com/grace');
    expect(safeUrl('https://grace.test/a?b=1')).toBe('https://grace.test/a?b=1');
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl('data:text/html,hi')).toBe('');
    expect(safeUrl('')).toBe('');
  });

  it('reads a stored page, dropping unknown blocks, duplicate ids, bad colours and unsafe photos', () => {
    const page = readStorefront({
      profile: { name: '  Grace Chapel ', bio: 'Hi', photoUrl: 'http://insecure.test/p.png' },
      socials: [{ network: 'instagram', url: 'instagram.com/grace' }, { network: 'instagram', url: 'https://x.test' }, { network: 'myspace', url: 'https://m.test' }],
      look: { template: 'neon', accent: 'red' },
      blocks: [
        { id: 'a', type: 'link', title: 'Site', url: 'javascript:alert(1)' },
        { id: 'a', type: 'text', title: 'dupe' },
        { id: 'b', type: 'popup' },
        { id: 'c', type: 'events', count: 99 },
        { id: '../x', type: 'text', title: 'bad id' },
      ],
      published: 'yes',
    });
    expect(page.profile).toEqual({ name: 'Grace Chapel', bio: 'Hi', photoUrl: '' });
    expect(page.socials).toEqual([{ network: 'instagram', url: 'https://instagram.com/grace' }]);
    expect(page.look).toEqual({ template: 'classic', accent: '#C9963A' });
    expect(page.blocks.map((b) => [b.id, b.type])).toEqual([['a', 'link'], ['c', 'events']]);
    expect(page.blocks[0]).toMatchObject({ url: '' });
    expect(page.blocks[1]).toMatchObject({ count: 6 });
    expect(page.published).toBe(false);
    expect(readStorefront(null, 'Grace')).toEqual(emptyStorefront('Grace'));
  });

  it('groups visible blocks under their categories and leaves out hidden or unfinished ones', () => {
    const blocks = [
      { ...newStorefrontBlock('give', 'g'), title: 'Give' },
      newStorefrontBlock('category', 'c1'),
      { ...newStorefrontBlock('link', 'l1'), url: 'https://a.test' },
      { ...newStorefrontBlock('link', 'l2'), url: 'https://b.test', enabled: false },
      newStorefrontBlock('link', 'l3'),
      { ...newStorefrontBlock('category', 'c2'), title: 'Watch' },
      newStorefrontBlock('category', 'c3'),
    ];
    expect(storefrontSections(blocks).map((s) => [s.category, s.blocks.map((b) => b.id)])).toEqual([[null, ['g']], ['New section', ['l1']]]);
  });

  it('embeds YouTube, Vimeo and Loom, and nothing else', () => {
    expect(videoEmbedUrl('https://www.youtube.com/watch?v=abc123')).toBe('https://www.youtube-nocookie.com/embed/abc123');
    expect(videoEmbedUrl('https://youtu.be/abc123')).toBe('https://www.youtube-nocookie.com/embed/abc123');
    expect(videoEmbedUrl('https://youtube.com/shorts/xyz')).toBe('https://www.youtube-nocookie.com/embed/xyz');
    expect(videoEmbedUrl('https://vimeo.com/12345')).toBe('https://player.vimeo.com/video/12345');
    expect(videoEmbedUrl('https://www.loom.com/share/ab12')).toBe('https://www.loom.com/embed/ab12');
    expect(videoEmbedUrl('https://evil.test/watch?v=1')).toBeNull();
  });
});
