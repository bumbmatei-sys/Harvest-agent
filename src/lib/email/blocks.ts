/**
 * The two editor blocks the slash menu inserts: an Issue header and a tinted
 * Box. This module is the one place that names their fields and validates them.
 * The TipTap nodes (src/components/email/blocks/) read and write attributes
 * through these helpers; the renderer (render.ts) reads the same attributes out
 * of the stored HTML and turns them into email-safe tables. Both sides must
 * agree, so both sides import from here and neither re-spells a field name.
 *
 * Block text is untrusted. Nothing here renders it: every consumer escapes it
 * at output, and `safeBlockUrl` is the only way a link out of these blocks
 * reaches an href.
 */

import { GOLD, NAVY, type EmailThemeTokens } from '@/lib/email/themes';

export type IssueSize = 's' | 'm' | 'l';
export type IssueAlign = 'left' | 'center';
export type BoxVariant = 'filled' | 'outline';

/**
 * Box tints: the theme's own accent plus a few fixed neutrals. A tint is
 * stored as its key, never as a colour, so a box redraws in the active
 * theme's accent when the ministry changes theme.
 */
export type BoxTint = 'accent' | 'gold' | 'navy' | 'warm' | 'mist' | 'ink';

export const BOX_TINTS: readonly { key: BoxTint; label: string }[] = Object.freeze([
  { key: 'accent', label: 'Theme accent' },
  { key: 'gold', label: 'Gold' },
  { key: 'navy', label: 'Navy' },
  { key: 'warm', label: 'Warm' },
  { key: 'mist', label: 'Mist' },
  { key: 'ink', label: 'Ink' },
]);

/** Fixed neutrals beside the theme-derived accent. Six-digit hex, like the tokens. */
const NEUTRAL_TINTS: Readonly<Record<BoxTint, string>> = Object.freeze({
  accent: GOLD, // stand-in; resolved against tokens below
  gold: GOLD,
  navy: NAVY,
  warm: '#F1E7D4',
  mist: '#E7ECF3',
  ink: '#2B313C',
});

/** The colour a tint chip is painted with in the editor and in the block preview. */
export function boxTintBase(tint: BoxTint, tokens: EmailThemeTokens): string {
  return tint === 'accent' ? tokens.accent : NEUTRAL_TINTS[tint];
}

export interface IssueHeaderAttrs {
  readonly title: string;
  readonly subtitle: string;
  readonly size: IssueSize;
  readonly align: IssueAlign;
  readonly readingTime: boolean;
  readonly readOnline: string;
}

export interface BoxAttrs {
  readonly label: string;
  readonly title: string;
  readonly blurb: string;
  readonly buttonText: string;
  readonly buttonUrl: string;
  readonly tint: BoxTint;
  readonly variant: BoxVariant;
}

export const ISSUE_HEADER_DEFAULTS: IssueHeaderAttrs = Object.freeze({
  title: '',
  subtitle: '',
  size: 'm',
  align: 'center',
  readingTime: true,
  readOnline: '',
});

export const BOX_DEFAULTS: BoxAttrs = Object.freeze({
  label: '',
  title: '',
  blurb: '',
  buttonText: '',
  buttonUrl: '',
  tint: 'accent',
  variant: 'filled',
});

const oneOf = <T extends string>(value: string | null | undefined, options: readonly T[], fallback: T): T =>
  typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback;

/** Trimmed text, or ''. Everything a block stores is a string; nulls collapse. */
export function blockText(value: string | null | undefined, maxLength = 400): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

/**
 * The only links a block may carry: `https:` or `mailto:`, and nothing else.
 * Returns the trimmed URL when it passes, '' when it does not — a caller that
 * renders '' draws no link at all, never a link with the scheme stripped.
 */
export function safeBlockUrl(url: string | null | undefined): string {
  const value = blockText(url, 600);
  if (!value) return '';
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'mailto:' ? value : '';
  } catch {
    return '';
  }
}

/** Raw `data-*` strings, straight out of the HTML or the node's DOM element. */
export interface RawIssueHeader {
  title?: string | null;
  subtitle?: string | null;
  size?: string | null;
  align?: string | null;
  reading?: string | null;
  readOnline?: string | null;
}

export interface RawBox {
  label?: string | null;
  title?: string | null;
  blurb?: string | null;
  buttonText?: string | null;
  buttonUrl?: string | null;
  tint?: string | null;
  variant?: string | null;
}

export function issueHeaderAttrs(raw: RawIssueHeader): IssueHeaderAttrs {
  return Object.freeze({
    title: blockText(raw.title),
    subtitle: blockText(raw.subtitle, 600),
    size: oneOf(raw.size, ['s', 'm', 'l'] as const, ISSUE_HEADER_DEFAULTS.size),
    align: oneOf(raw.align, ['left', 'center'] as const, ISSUE_HEADER_DEFAULTS.align),
    readingTime: raw.reading === 'true',
    // Stored raw and validated at render: a hostile URL here must not vanish
    // from the editor, only from the sent email.
    readOnline: blockText(raw.readOnline, 600),
  });
}

export function boxAttrs(raw: RawBox): BoxAttrs {
  return Object.freeze({
    label: blockText(raw.label, 120),
    title: blockText(raw.title),
    blurb: blockText(raw.blurb, 1000),
    buttonText: blockText(raw.buttonText, 120),
    buttonUrl: blockText(raw.buttonUrl, 600),
    tint: oneOf(raw.tint, BOX_TINTS.map((t) => t.key) as BoxTint[], BOX_DEFAULTS.tint),
    variant: oneOf(raw.variant, ['filled', 'outline'] as const, BOX_DEFAULTS.variant),
  });
}
