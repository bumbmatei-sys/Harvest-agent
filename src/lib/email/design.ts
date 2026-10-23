export type EmailTheme = 'letter' | 'plain' | 'bold';
/**
 * `custom` is the ministry's own branding colour, copied into `customColor` when
 * the writer picks it. An email client cannot read the app's CSS variables, so
 * the hex has to travel with the design. A design saved before this change may
 * still say `harbor`; it reads as navy.
 */
export type EmailAccent = 'navy' | 'gold' | 'custom';
export type EmailFont = 'sans' | 'serif';
export type EmailHeader = 'name' | 'none';
export type EmailButtons = 'filled' | 'outline';

export interface EmailDesign {
  readonly theme: EmailTheme;
  readonly accent: EmailAccent;
  readonly font: EmailFont;
  readonly header: EmailHeader;
  readonly buttons: EmailButtons;
  readonly footerText: string;
  /** The hex `accent: 'custom'` draws with. Ignored for the other accents. */
  readonly customColor?: string;
}

export const DEFAULT_EMAIL_DESIGN: EmailDesign = Object.freeze({
  theme: 'letter',
  accent: 'navy',
  font: 'sans',
  header: 'name',
  buttons: 'filled',
  footerText: '',
});

export const ACCENT_LABELS: Readonly<Record<EmailAccent, string>> = Object.freeze({
  navy: 'Navy',
  gold: 'Gold',
  custom: 'Custom',
});

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** A six-digit hex, or null. Nothing else is ever written into an email's style attribute. */
export function readHexColor(value: unknown): string | null {
  return typeof value === 'string' && HEX_COLOR.test(value.trim()) ? value.trim() : null;
}


export const THEME_LABELS: Readonly<Record<EmailTheme, string>> = Object.freeze({
  letter: 'Letter',
  plain: 'Plain',
  bold: 'Bold',
});
