export type EmailTheme = 'letter' | 'plain' | 'bold';
export type EmailAccent = 'navy' | 'gold' | 'harbor';
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
  navy: 'Harvest navy',
  gold: 'Wheat gold',
  harbor: 'Harbor blue',
});


export const THEME_LABELS: Readonly<Record<EmailTheme, string>> = Object.freeze({
  letter: 'Letter',
  plain: 'Plain',
  bold: 'Bold',
});
