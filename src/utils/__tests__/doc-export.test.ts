import { describe, it, expect } from 'vitest';
import { parseHTMLToBlocks, htmlToMarkdown } from '../doc-export';

describe('parseHTMLToBlocks', () => {
  it('parses h1', () => {
    const blocks = parseHTMLToBlocks('<h1>Hello</h1>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('h1');
    expect(blocks[0].text).toBe('Hello');
  });

  it('parses h2', () => {
    const blocks = parseHTMLToBlocks('<h2>Sub</h2>');
    expect(blocks[0].type).toBe('h2');
    expect(blocks[0].text).toBe('Sub');
  });

  it('parses h3', () => {
    const blocks = parseHTMLToBlocks('<h3>Deep</h3>');
    expect(blocks[0].type).toBe('h3');
  });

  it('parses paragraph', () => {
    const blocks = parseHTMLToBlocks('<p>Hello world</p>');
    expect(blocks[0].type).toBe('p');
    expect(blocks[0].text).toBe('Hello world');
  });

  it('parses blank paragraph as blank', () => {
    const blocks = parseHTMLToBlocks('<p></p>');
    expect(blocks[0].type).toBe('blank');
  });

  it('parses hr', () => {
    const blocks = parseHTMLToBlocks('<hr>');
    expect(blocks[0].type).toBe('hr');
  });

  it('parses unordered list items', () => {
    const blocks = parseHTMLToBlocks('<ul><li>A</li><li>B</li></ul>');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('li');
    expect(blocks[0].text).toBe('A');
    expect(blocks[1].type).toBe('li');
    expect(blocks[1].text).toBe('B');
  });

  it('parses ordered list with index', () => {
    const blocks = parseHTMLToBlocks('<ol><li>First</li><li>Second</li></ol>');
    expect(blocks[0].type).toBe('li-ordered');
    expect(blocks[0].index).toBe(1);
    expect(blocks[1].type).toBe('li-ordered');
    expect(blocks[1].index).toBe(2);
    expect(blocks[1].text).toBe('Second');
  });

  it('parses bold runs', () => {
    const blocks = parseHTMLToBlocks('<p><strong>Bold</strong> text</p>');
    expect(blocks[0].runs).toBeDefined();
    const boldRun = blocks[0].runs!.find(r => r.bold);
    expect(boldRun?.text).toBe('Bold');
  });

  it('parses italic runs', () => {
    const blocks = parseHTMLToBlocks('<p><em>Italic</em></p>');
    const italicRun = blocks[0].runs!.find(r => r.italic);
    expect(italicRun).toBeDefined();
    expect(italicRun?.text).toBe('Italic');
  });

  it('returns empty array for empty html', () => {
    expect(parseHTMLToBlocks('')).toEqual([]);
  });
});

describe('htmlToMarkdown', () => {
  it('returns empty string for empty input', () => {
    expect(htmlToMarkdown('')).toBe('');
  });

  it('converts h1', () => {
    expect(htmlToMarkdown('<h1>Title</h1>')).toBe('# Title');
  });

  it('converts h2', () => {
    expect(htmlToMarkdown('<h2>Sub</h2>')).toContain('## Sub');
  });

  it('converts h3', () => {
    expect(htmlToMarkdown('<h3>Deep</h3>')).toContain('### Deep');
  });

  it('converts bold text', () => {
    const md = htmlToMarkdown('<p><strong>Bold</strong></p>');
    expect(md).toContain('**Bold**');
  });

  it('converts italic text', () => {
    const md = htmlToMarkdown('<p><em>Italic</em></p>');
    expect(md).toContain('*Italic*');
  });

  it('converts bold and italic', () => {
    const md = htmlToMarkdown('<p><strong><em>Both</em></strong></p>');
    expect(md).toContain('***Both***');
  });

  it('converts unordered list', () => {
    const md = htmlToMarkdown('<ul><li>Item</li></ul>');
    expect(md).toContain('- Item');
  });

  it('converts ordered list', () => {
    const md = htmlToMarkdown('<ol><li>One</li><li>Two</li></ol>');
    expect(md).toContain('1. One');
    expect(md).toContain('2. Two');
  });

  it('converts hr to ---', () => {
    const md = htmlToMarkdown('<hr>');
    expect(md).toContain('---');
  });

  it('converts multiple block types', () => {
    const md = htmlToMarkdown('<h1>Title</h1><p>Body</p><ul><li>Item</li></ul>');
    expect(md).toContain('# Title');
    expect(md).toContain('Body');
    expect(md).toContain('- Item');
  });
});
