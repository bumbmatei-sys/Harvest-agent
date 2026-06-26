import { describe, it, expect } from 'vitest';
import { markdownToHtml, titleFromMarkdown } from '../markdown-import';

describe('markdownToHtml', () => {
  it('converts headings of all three levels', () => {
    expect(markdownToHtml('# One')).toBe('<h1>One</h1>');
    expect(markdownToHtml('## Two')).toBe('<h2>Two</h2>');
    expect(markdownToHtml('### Three')).toBe('<h3>Three</h3>');
  });

  it('converts bold and italic inline marks', () => {
    expect(markdownToHtml('**bold**')).toContain('<strong>bold</strong>');
    expect(markdownToHtml('*italic*')).toContain('<em>italic</em>');
  });

  it('converts bullet lists', () => {
    expect(markdownToHtml('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(markdownToHtml('* a\n* b')).toBe('<ul><li>a</li><li>b</li></ul>');
  });

  it('converts ordered lists', () => {
    expect(markdownToHtml('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
  });

  it('converts horizontal rule', () => {
    expect(markdownToHtml('---')).toBe('<hr>');
  });

  it('converts blockquotes', () => {
    expect(markdownToHtml('> quoted')).toBe('<blockquote><p>quoted</p></blockquote>');
  });

  it('wraps plain text in a paragraph', () => {
    expect(markdownToHtml('hello world')).toBe('<p>hello world</p>');
  });

  it('escapes raw HTML to prevent injection', () => {
    expect(markdownToHtml('<script>alert(1)</script>')).not.toContain('<script>');
  });

  it('converts a mixed document and switches list types', () => {
    const md = '# Title\n\nIntro paragraph.\n\n- one\n- two\n\n1. first\n2. second';
    const html = markdownToHtml(md);
    expect(html).toBe(
      '<h1>Title</h1><p>Intro paragraph.</p><ul><li>one</li><li>two</li></ul><ol><li>first</li><li>second</li></ol>'
    );
  });

  it('only allows safe link protocols', () => {
    expect(markdownToHtml('[ok](https://a.com)')).toContain('href="https://a.com"');
    expect(markdownToHtml('[bad](javascript:alert(1))')).toContain('href="#"');
  });
});

describe('titleFromMarkdown', () => {
  it('uses the first H1 when present', () => {
    expect(titleFromMarkdown('# My Note\n\nbody', 'file.md')).toBe('My Note');
  });

  it('falls back to the filename without extension', () => {
    expect(titleFromMarkdown('no heading here', 'meeting-notes.md')).toBe('meeting-notes');
  });
});
