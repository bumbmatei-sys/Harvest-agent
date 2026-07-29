import { describe, it, expect } from 'vitest';
import { sanitizeHtml, isSafeUrl, stripHtml } from '../sanitize';

describe('sanitizeHtml', () => {
  it('returns content from safe HTML', () => {
    const result = sanitizeHtml('<p>Hello <strong>world</strong></p>');
    expect(result).toContain('Hello');
    expect(result).toContain('world');
  });

  it('strips event handlers', () => {
    const result = sanitizeHtml('<img src="x" onerror="alert(1)">');
    expect(result).not.toContain('onerror');
  });

  it('blocks javascript: URLs in href', () => {
    const result = sanitizeHtml('<a href="javascript:alert(1)">Link</a>');
    expect(result).not.toContain('javascript:');
  });

  it('handles empty string', () => {
    expect(sanitizeHtml('')).toBe('');
  });

  it('preserves text content', () => {
    const result = sanitizeHtml('<div>Hello World</div>');
    expect(result).toContain('Hello World');
  });

  it('blocks disallowed tags', () => {
    const result = sanitizeHtml('<iframe src="evil.com">content</iframe>');
    expect(result).not.toContain('iframe');
  });
});

describe('isSafeUrl', () => {
  it('allows http and https URLs', () => {
    expect(isSafeUrl('https://example.com')).toBe(true);
    expect(isSafeUrl('http://example.com')).toBe(true);
  });

  it('blocks javascript: URLs', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
  });

  it('blocks data: URLs', () => {
    expect(isSafeUrl('data:text/html,<h1>hi</h1>')).toBe(false);
  });

  it('blocks vbscript: URLs', () => {
    expect(isSafeUrl('vbscript:msgbox')).toBe(false);
  });

  it('blocks encoded javascript: URLs', () => {
    expect(isSafeUrl('java%73cript:alert(1)')).toBe(false);
  });

  it('handles whitespace', () => {
    expect(isSafeUrl('  https://example.com  ')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isSafeUrl('JavaScript:alert(1)')).toBe(false);
    expect(isSafeUrl('HTTPS://example.com')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// stripHtml — re-exported from sanitize.ts, used wherever rich-text content is
// shown as a plain single-line summary (CourseOverview's meta line, and the
// library course card in AdminCourses, which rendered raw `<p>Test</p>` before).
// ─────────────────────────────────────────────────────────────────────────────
describe('stripHtml', () => {
  it('strips a simple tag wrapper', () => {
    expect(stripHtml('<p>Test</p>')).toBe('Test');
  });

  it('strips nested tags and keeps the text', () => {
    expect(stripHtml('<div><p>Hello <strong>there</strong></p></div>')).toBe('Hello there');
  });

  it('decodes the common entities the editor emits', () => {
    expect(stripHtml('<p>Tom&#39;s &amp; Jerry&nbsp;show</p>')).toBe("Tom's & Jerry show");
    expect(stripHtml('<p>&lt;not a tag&gt;</p>')).toBe('<not a tag>');
    expect(stripHtml('<p>&quot;quoted&quot;</p>')).toBe('"quoted"');
  });

  it('collapses a multi-paragraph description to one clean line', () => {
    expect(stripHtml('<p>First para.</p>\n\n<p>Second   para.</p>')).toBe('First para. Second para.');
  });

  it('handles empty and tag-only input', () => {
    expect(stripHtml('')).toBe('');
    expect(stripHtml('<p></p>')).toBe('');
    expect(stripHtml(undefined as unknown as string)).toBe('');
  });

  it('leaves plain text untouched', () => {
    expect(stripHtml('Already plain')).toBe('Already plain');
  });
});
