/**
 * Search normalisation. Pure, no imports.
 *
 * "Café" must find "cafe", "Ștefan" must find "stefan", and "ŞTEFAN" must find
 * both. NFKD splits an accented letter into the letter plus combining marks, and
 * the mark range is then dropped. A few letters (ß, ø, ł, đ, æ, œ) have no
 * decomposition, so they are folded by hand.
 */

const COMBINING_MARKS = /[̀-ͯ]/g;

const FOLD: Readonly<Record<string, string>> = {
  'ß': 'ss',
  'ø': 'o',
  'ł': 'l',
  'đ': 'd',
  'æ': 'ae',
  'œ': 'oe',
  'ı': 'i',
};

const FOLD_PATTERN = /[ßøłđæœı]/g;

/** Lower-case, accent-free, single-spaced. The only form that is ever compared. */
export function normalizeText(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(FOLD_PATTERN, (ch) => FOLD[ch] ?? ch)
    .replace(/\s+/g, ' ')
    .trim();
}

/** The digits of a phone number, so "+1 (555) 010-2030" matches "5550102030". */
export function digitsOf(input: unknown): string {
  return typeof input === 'string' ? input.replace(/\D+/g, '') : '';
}

/**
 * First `max` characters of a rich-text body as plain text. The slice comes
 * BEFORE the tag strip: a note can hold megabytes of inline images, and the
 * preview needs none of it.
 */
export function plainPreview(html: unknown, max = 300): string {
  if (typeof html !== 'string' || !html) return '';
  return html
    .slice(0, max * 40)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
