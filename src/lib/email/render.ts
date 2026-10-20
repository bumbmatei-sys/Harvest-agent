import sanitizeHtml from 'sanitize-html';

/**
 * Email HTML. Pure, so the Preview dialog and the sender produce the same
 * markup. Email clients cannot read CSS variables, so the literal colours live
 * here and nowhere in the app UI.
 */

export type EmailTheme = 'letter' | 'plain' | 'bold';
export type EmailAccent = 'navy' | 'gold' | 'harbor';
export type EmailFont = 'sans' | 'serif';
export type EmailHeader = 'name' | 'logo' | 'none';
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

/**
 * Email clients cannot read CSS variables, so the Harvest brand scale
 * (globals.css: --navy-900, --wheat-500, --navy-600) is spelled out here and
 * nowhere else in this feature. The app UI itself uses theme tokens only.
 */
const ACCENT_HEX: Readonly<Record<EmailAccent, string>> = Object.freeze({
  navy: '#0C1526',
  gold: '#C9963A',
  harbor: '#274067',
});
const NIGHT_PAGE = '#0C1526';
const NIGHT_CARD = '#12203B';

export const MERGE_TAGS = ['first_name', 'sender_name'] as const;

export function fillMergeTags(
  text: string,
  values: { firstName: string; senderName: string },
): string {
  return text
    .replace(/\{\{\s*first_name\s*\}\}/g, values.firstName.trim() || 'friend')
    .replace(/\{\{\s*sender_name\s*\}\}/g, values.senderName.trim());
}

const ALLOWED_TAGS = ['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'strong', 'em', 's', 'a', 'br', 'img', 'hr'];

export function sanitizeEmailBody(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ['href', 'data-button'], img: ['src', 'alt'] },
    allowedSchemes: ['https', 'mailto'],
    allowedSchemesByTag: { img: ['https'] },
  });
}

export function htmlToText(html: string): string {
  return sanitizeHtml(html.replace(/<\/(p|h1|h2|h3|li|blockquote)>/g, '\n\n').replace(/<br\s*\/?>/g, '\n'), {
    allowedTags: [],
    allowedAttributes: {},
  }).replace(/\n{3,}/g, '\n\n').trim();
}

export interface RenderInput {
  readonly design: EmailDesign;
  readonly bodyHtml: string;
  readonly preheader: string;
  readonly churchName: string;
  readonly senderName: string;
  readonly firstName: string;
  readonly mailingAddress: string;
  readonly unsubscribeUrl: string;
  readonly dark?: boolean;
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderEmail(input: RenderInput): { html: string; text: string } {
  const { design } = input;
  const dark0 = input.dark === true;
  const accent = dark0 && design.accent === 'navy' ? ACCENT_HEX.gold : ACCENT_HEX[design.accent];
  const dark = input.dark === true;
  const page = dark ? NIGHT_PAGE : design.theme === 'plain' ? '#ffffff' : '#FAF8F5';
  const card = dark ? NIGHT_CARD : '#ffffff';
  const ink = dark ? '#F5F5F5' : '#1A1A1A';
  const quiet = dark ? '#a3a3a3' : '#6b6b6b';
  const family = design.font === 'serif' ? 'Georgia, "Times New Roman", serif' : '-apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
  const buttonBg = design.buttons === 'filled' ? (dark && design.accent === 'navy' ? '#F5F5F5' : accent) : 'transparent';
  const buttonInk = design.buttons === 'filled' ? (dark && design.accent === 'navy' ? '#0C1526' : '#ffffff') : (dark && design.accent === 'navy' ? '#F5F5F5' : accent);
  const buttonBorder = design.buttons === 'filled' ? buttonBg : buttonInk;

  const filled = fillMergeTags(sanitizeEmailBody(input.bodyHtml), input);
  const body = filled.replace(
    /<a ([^>]*?)data-button="true"([^>]*)>/g,
    `<a $1$2 style="display:inline-block;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;background:${buttonBg};color:${buttonInk};border:1.5px solid ${buttonBorder}">`,
  );
  const header = design.header === 'none'
    ? ''
    : `<div style="padding:28px 32px 0;font-size:${design.theme === 'bold' ? 22 : 15}px;font-weight:700;color:${design.theme === 'bold' ? accent : ink}">${esc(input.churchName)}</div>`;
  const pre = input.preheader.trim()
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(fillMergeTags(input.preheader, input))}</div>`
    : '';
  const footerLines = [design.footerText.trim(), input.mailingAddress.trim()].filter(Boolean).map(esc).join('<br>');

  const html = `<!doctype html><html><body style="margin:0;background:${page};font-family:${family};color:${ink}">${pre}`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${page}"><tr><td align="center" style="padding:24px 12px">`
    + `<div style="max-width:560px;margin:0 auto;background:${card};border-radius:${design.theme === 'plain' ? 0 : 12}px;text-align:left">`
    + `${header}<div style="padding:20px 32px 8px;font-size:16px;line-height:1.6">${body}</div>`
    + `<div style="padding:16px 32px 28px;font-size:12px;line-height:1.5;color:${quiet}">${footerLines ? `${footerLines}<br>` : ''}`
    + `<a href="${esc(input.unsubscribeUrl)}" style="color:${quiet}">Unsubscribe</a></div></div></td></tr></table></body></html>`;

  const text = [
    htmlToText(fillMergeTags(input.bodyHtml, input)),
    '',
    design.footerText.trim(),
    input.mailingAddress.trim(),
    `Unsubscribe: ${input.unsubscribeUrl}`,
  ].filter((line, i, all) => line !== '' || all[i - 1] !== '').join('\n');
  return { html, text };
}
