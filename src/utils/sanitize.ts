import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'a', 'img', 'blockquote',
  'strong', 'em', 'br', 'div', 'span',
];

const ALLOWED_ATTR = ['href', 'src', 'alt', 'title', 'class', 'style', 'target', 'rel'];

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):)/i,
  });
}

export function isSafeUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  return !trimmed.startsWith('javascript:');
}
