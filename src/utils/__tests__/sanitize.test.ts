import { describe, it, expect } from 'vitest';
import { sanitizeHtml, isSafeUrl } from '../sanitize';

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
