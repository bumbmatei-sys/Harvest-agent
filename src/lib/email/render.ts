import sanitizeHtml from 'sanitize-html';

/**
 * Email HTML. Pure, so the Preview dialog and the sender produce the same
 * markup. Email clients cannot read CSS variables, so the literal colours live
 * here and nowhere in the app UI.
 *
 * Since themes landed, the markup is driven by resolved `EmailThemeTokens`
 * (themes.ts): colours, fonts with web-safe fallbacks, text size, header mode,
 * layout, width, corners, spacing, buttons, dividers, quotes and footer all
 * come from the tokens `resolveTheme()` hands back. A broadcast saved before
 * themes carries only an `EmailDesign`; `tokensFromDesign()` maps its settings
 * and `legacyPalette()` keeps its exact historic colours, quirks and all, so
 * its output is byte-identical to what it rendered before this refactor. The
 * legacy body is left untouched; theme bodies gain the block styling.
 *
 * Everything is table HTML with inline styles — no classes, no CSS variables,
 * no web-font imports. Where a theme's own colours would fall below 4.5:1 the
 * renderer substitutes a readable colour and reports it in `adjustments`,
 * never silently and never in legacy output.
 */

import {
  boxAttrs,
  boxTintBase,
  issueHeaderAttrs,
  safeBlockUrl,
  type BoxAttrs,
  type IssueHeaderAttrs,
  type RawBox,
  type RawIssueHeader,
} from '@/lib/email/blocks';
import { DEFAULT_EMAIL_DESIGN, type EmailAccent, type EmailDesign } from '@/lib/email/design';
import { boxFillColors, inkOn, mixHex, readableTextOn, type BoxFillColors } from '@/lib/email/theme-contrast';
import {
  buttonPadding,
  buttonRadius,
  fontStack,
  legacyPalette,
  resolveTheme,
  spacingScale,
  textScale,
  widthPx,
  SOCIAL_PLATFORM_LABELS,
  type CustomTheme,
  type EmailThemeTokens,
  type LegacyPalette,
  type SocialLink,
  type ThemeContrastAdjustment,
  NAVY,
  GOLD,
  NAVY_600,
  NIGHT_CARD,
  NIGHT_PAGE,
} from '@/lib/email/themes';

export { DEFAULT_EMAIL_DESIGN };
export type { EmailDesign, EmailAccent };
export { accentHex } from '@/lib/email/themes';
/** White or near-black, whichever reads on `hex`. Re-exported for old callers. */
export { inkOn } from '@/lib/email/theme-contrast';

/**
 * The brand scale for the one page outside the app that has no stylesheet to
 * read the theme from: the public unsubscribe page. Same values as above and as
 * globals.css (--navy-*, --wheat-*); spelled in themes.ts so no other file
 * spells them.
 */
export const BRAND_PALETTE = Object.freeze({
  navy950: '#080F1D',
  navy900: NAVY,
  navy800: NIGHT_CARD,
  navy600: NAVY_600,
  gold500: GOLD,
  gold100: '#F5EDE0',
  gold50: '#FBF4E6',
});

export const MERGE_TAGS = ['first_name', 'sender_name'] as const;

export function fillMergeTags(
  text: string,
  values: { firstName: string; senderName: string },
  options: { html?: boolean } = {},
): string {
  const clean = (value: string) => (options.html ? esc(value) : value);
  const first = clean(values.firstName.trim() || 'friend');
  const sender = clean(values.senderName.trim());
  return text.replace(/\{\{\s*(first_name|sender_name)\s*\}\}/g, (_match, tag: string) => (tag === 'first_name' ? first : sender));
}

const ALLOWED_TAGS = ['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'strong', 'em', 's', 'a', 'br', 'img', 'hr', 'div'];

/**
 * The exact `data-*` attributes the two slash-menu blocks travel in — the
 * Issue header and the Box. Everything else on a `div` is stripped. A `div`
 * WITHOUT a `data-hv-block` marker is transformed to `span`, which is not an
 * allowed tag, so it unwraps and keeps its children: byte-identical to the
 * days when `div` was not allowed at all.
 */
const BLOCK_MARKER_ATTRS = [
  'data-hv-block', 'data-title', 'data-subtitle', 'data-size', 'data-align', 'data-reading', 'data-read-online',
  'data-label', 'data-blurb', 'data-button-text', 'data-button-url', 'data-tint', 'data-variant',
];

export function sanitizeEmailBody(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ['href', 'data-button'], img: ['src', 'alt'], div: BLOCK_MARKER_ATTRS },
    allowedSchemes: ['https', 'mailto'],
    allowedSchemesByTag: { img: ['https'] },
    transformTags: {
      div: (tagName, attribs) =>
        attribs['data-hv-block'] === 'issue-header' || attribs['data-hv-block'] === 'box'
          ? { tagName, attribs }
          : { tagName: 'span', attribs: {} },
    },
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
  /** A preset or CustomTheme id. When absent the legacy `design` drives output. */
  readonly themeId?: string | null;
  /** The token snapshot saved on the broadcast. Wins over the theme's own tokens. */
  readonly themeTokens?: EmailThemeTokens | null;
  readonly customThemes?: readonly CustomTheme[];
  /** Shared brand logo, drawn beside the name in the logo-name header modes. */
  readonly logoUrl?: string | null;
  /** Shared brand footer note — a sign-off or line about the ministry, in every theme's footer. */
  readonly footerNote?: string | null;
  /** Shared social links, drawn as a row of platform names in every theme's footer. */
  readonly socialLinks?: readonly SocialLink[] | null;
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** What the assembly draws with. `LegacyPalette` plus the theme heading ink. */
interface Palette extends LegacyPalette {
  readonly heading: string;
}

/**
 * The palette a theme's own tokens produce. Below 4.5:1 the renderer walks the
 * offending colour toward a readable one (`readableTextOn`) and records every
 * substitution in `adjustments` so the preview can say out loud what changed —
 * a fallback nobody is told about is a silent failure.
 */
function themePalette(tokens: EmailThemeTokens, dark: boolean): { palette: Palette; adjustments: ThemeContrastAdjustment[] } {
  const adjustments: ThemeContrastAdjustment[] = [];
  const page = dark ? NIGHT_PAGE : tokens.page;
  const card = dark ? NIGHT_CARD : tokens.card;
  // The historic navy-in-dark look: a navy accent previews its buttons in the
  // night palette. A theme is free to pick a non-navy accent and keep it.
  const navyNight = dark && tokens.accent === NAVY;
  const keep = (pair: ThemeContrastAdjustment['pair'], preferred: string): string => {
    const readable = readableTextOn(card, preferred);
    if (readable !== preferred) adjustments.push({ pair, from: preferred, to: readable });
    return readable;
  };
  const ink = dark ? '#F5F5F5' : keep('text', tokens.text);
  const heading = dark ? '#FFFFFF' : keep('heading', tokens.heading);
  const accent = navyNight ? GOLD : keep('accent', tokens.accent);
  const quiet = dark ? '#a3a3a3' : readableTextOn(card, mixHex(tokens.text, card, 0.45));
  const family = fontStack(tokens.bodyFont);

  const filled = tokens.buttons.fill === 'filled';
  let buttonBg = filled ? (navyNight ? '#F5F5F5' : tokens.accent) : 'transparent';
  let buttonInk = filled ? (navyNight ? '#0C1526' : inkOn(buttonBg)) : (navyNight ? '#F5F5F5' : tokens.accent);
  const readableButtonInk = readableTextOn(filled ? buttonBg : card, buttonInk);
  if (readableButtonInk !== buttonInk) adjustments.push({ pair: 'button', from: buttonInk, to: readableButtonInk });
  buttonInk = readableButtonInk;
  const buttonBorder = filled ? buttonBg : buttonInk;
  return { palette: { page, card, ink, heading, quiet, accent, family, buttonBg, buttonInk, buttonBorder }, adjustments };
}

/** The inline style on a `data-button` link. Legacy tokens reproduce the exact historic string. */
function buttonStyle(
  tokens: EmailThemeTokens,
  palette: Palette,
  colors: Pick<BoxFillColors, 'buttonBg' | 'buttonInk' | 'buttonBorder'> = palette,
): string {
  const b = tokens.buttons;
  const display = b.width === 'full' ? 'block' : 'inline-block';
  const extra = b.width === 'full' ? `;width:100%${b.align === 'center' ? ';text-align:center' : ''}` : '';
  return `display:${display};padding:${buttonPadding(b.size)};border-radius:${buttonRadius(b.shape)}px`
    + `;text-decoration:none;font-weight:600;background:${colors.buttonBg};color:${colors.buttonInk}`
    + `;border:1.5px solid ${colors.buttonBorder}${extra}`;
}

/**
 * Give the body's blocks the theme's fonts, colours, divider and quote styles.
 * Only theme bodies get this — a legacy body is left exactly as it always was.
 * The sanitizer strips every style attribute and id/class upstream, so these
 * replacements can never collide with author-supplied styles.
 */
function styleBodyBlocks(html: string, tokens: EmailThemeTokens, palette: Palette): string {
  const headingStack = fontStack(tokens.headingFont);
  const tint = mixHex(palette.card, palette.accent, 0.08);
  const hairline = mixHex(palette.ink, palette.card, 0.8);
  let out = html.replace(
    /<h([1-3])([^>]*)>/g,
    `<h$1$2 style="font-family:${headingStack};color:${palette.heading};line-height:1.25;margin:1em 0 0.4em">`,
  );
  const quoteStyle = tokens.quotes === 'italic'
    ? `margin:16px 0;padding-left:12px;border-left:none;font-style:italic;color:${palette.quiet}`
    : tokens.quotes === 'box'
      ? `margin:16px 0;padding:16px;background:${tint};border-left:3px solid ${palette.accent};color:${palette.ink}`
      : `margin:16px 0;padding-left:16px;border-left:3px solid ${palette.accent};color:${palette.ink}`;
  out = out.replace(/<blockquote([^>]*)>/g, `<blockquote$1 style="${quoteStyle}">`);
  const hr = tokens.dividers === 'dots'
    ? `<div style="text-align:center;padding:8px 0;font-size:13px;line-height:1;color:${palette.quiet}">&middot; &middot; &middot;</div>`
    : tokens.dividers === 'space'
      ? `<div style="height:18px;line-height:18px;font-size:0">&nbsp;</div>`
      : `<hr style="border:none;border-top:1px solid ${hairline};margin:20px 0">`;
  return out.replace(/<hr\s*\/?>/g, hr);
}

/* ── Slash-menu blocks: Issue header and Box ─────────────────────────────── */

/** Attribute values in sanitized HTML are entity-escaped; decode once before use. */
function decodeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function attrOf(openTag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(openTag);
  return m ? decodeAttr(m[1]) : null;
}

interface BlockMarker {
  readonly kind: 'issue-header' | 'box';
  readonly start: number;
  readonly end: number;
  readonly raw: RawIssueHeader & RawBox;
}

const BLOCK_OPEN = /<div\b[^>]*\bdata-hv-block="(issue-header|box)"[^>]*>/g;
const BLOCK_FIELDS = ['title', 'subtitle', 'size', 'align', 'reading', 'readOnline', 'label', 'blurb', 'buttonText', 'buttonUrl', 'tint', 'variant'];

/**
 * Locate every block marker in sanitized body HTML, element span included. The
 * blocks the editor writes are empty `div`s, but the scanner balances nested
 * `div`s anyway so a hand-authored marker with children is replaced wholesale
 * (a block is an atom; inner markup is never forwarded into the email).
 */
function findBlockMarkers(html: string): BlockMarker[] {
  const found: BlockMarker[] = [];
  BLOCK_OPEN.lastIndex = 0;
  let open: RegExpExecArray | null;
  while ((open = BLOCK_OPEN.exec(html))) {
    const start = open.index;
    const TAGS = /<div\b|<\/div>/g;
    TAGS.lastIndex = start + open[0].length;
    let end = -1;
    let depth = 1;
    let tag: RegExpExecArray | null;
    while ((tag = TAGS.exec(html))) {
      depth += tag[0] === '</div>' ? -1 : 1;
      if (depth === 0) { end = tag.index + tag[0].length; break; }
    }
    if (end < 0) break; // malformed tail: leave the rest untouched
    const raw: Record<string, string | null> = {};
    for (const name of BLOCK_FIELDS) {
      raw[name] = attrOf(open[0], `data-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
    }
    found.push({ kind: open[1] as BlockMarker['kind'], start, end, raw: raw as RawIssueHeader & RawBox });
    BLOCK_OPEN.lastIndex = end;
  }
  return found;
}

const SIZE_PX = { s: 22, m: 28, l: 34 } as const;

/** The Issue header: title, subtitle line, reading time and a read-online link. */
function issueHeaderHtml(attrs: IssueHeaderAttrs, tokens: EmailThemeTokens, palette: Palette, minutes: number): string {
  const rows: string[] = [];
  if (attrs.title) {
    rows.push(`<div style="font-family:${fontStack(tokens.headingFont)};font-size:${SIZE_PX[attrs.size]}px;line-height:1.2;font-weight:700;color:${palette.heading};margin:0">${esc(attrs.title)}</div>`);
  }
  if (attrs.subtitle) rows.push(`<div style="font-size:15px;line-height:1.5;color:${palette.quiet};margin:6px 0 0">${esc(attrs.subtitle)}</div>`);
  if (attrs.readingTime) rows.push(`<div style="font-size:11px;line-height:1.4;letter-spacing:0.12em;font-weight:600;color:${palette.quiet};margin:14px 0 0">${minutes} MIN READ</div>`);
  const url = safeBlockUrl(attrs.readOnline);
  if (url) rows.push(`<div style="margin:10px 0 0"><a href="${esc(url)}" style="color:${palette.accent};text-decoration:underline;font-size:12px">Read this issue online</a></div>`);
  if (!rows.length) return '';
  const align = attrs.align === 'center' ? 'center' : 'left';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:18px 0"><tr><td align="${align}" style="text-align:${align};padding:0">${rows.join('')}</td></tr></table>`;
}

/** The tinted Box: label, title, blurb and an optional button. */
function boxHtml(attrs: BoxAttrs, tokens: EmailThemeTokens, palette: Palette): string {
  const base = boxTintBase(attrs.tint, tokens);
  // One shared derivation with the editor's Box node view: every ink below is
  // readable against the actual fill, and a filled Box's button is chip-coloured
  // when the theme's own button ground would vanish into that fill.
  const box = boxFillColors(base, palette.card, palette, attrs.variant === 'filled');
  const parts: string[] = [];
  if (attrs.label) parts.push(`<div style="font-size:11px;line-height:1.4;letter-spacing:0.12em;font-weight:600;color:${box.label};margin:0 0 6px">${esc(attrs.label.toUpperCase())}</div>`);
  if (attrs.title) parts.push(`<div style="font-family:${fontStack(tokens.headingFont)};font-size:20px;line-height:1.3;font-weight:700;color:${box.title};margin:0">${esc(attrs.title)}</div>`);
  if (attrs.blurb) parts.push(`<div style="font-size:15px;line-height:1.55;color:${box.blurb};margin:${attrs.title ? 8 : 0}px 0 0">${esc(attrs.blurb)}</div>`);
  const url = safeBlockUrl(attrs.buttonUrl);
  if (attrs.buttonText && url) parts.push(`<div style="margin:16px 0 0"><a href="${esc(url)}" style="${buttonStyle(tokens, palette, box)}">${esc(attrs.buttonText)}</a></div>`);
  if (!parts.length) return '';
  const corners = tokens.layout === 'flat' ? 0 : tokens.corners;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:20px 0"><tr><td style="background:${box.fill};border:1px solid ${box.border};border-radius:${corners}px;padding:20px">${parts.join('')}</td></tr></table>`;
}

/** Block markers become email-safe tables. No marker in, byte-identical string out. */
function renderBlockMarkup(html: string, tokens: EmailThemeTokens, palette: Palette, minutes: number): string {
  const markers = findBlockMarkers(html);
  if (!markers.length) return html;
  let out = '';
  let cursor = 0;
  for (const marker of markers) {
    out += html.slice(cursor, marker.start);
    out += marker.kind === 'issue-header'
      ? issueHeaderHtml(issueHeaderAttrs(marker.raw), tokens, palette, minutes)
      : boxHtml(boxAttrs(marker.raw), tokens, palette);
    cursor = marker.end;
  }
  return out + html.slice(cursor);
}

/** The plain-text part carries the blocks' words, like every other line of the body. */
function renderBlockText(html: string, minutes: number): string {
  const markers = findBlockMarkers(html);
  if (!markers.length) return html;
  let out = '';
  let cursor = 0;
  for (const marker of markers) {
    out += html.slice(cursor, marker.start);
    if (marker.kind === 'issue-header') {
      const a = issueHeaderAttrs(marker.raw);
      const url = safeBlockUrl(a.readOnline);
      out += [a.title, a.subtitle, a.readingTime ? `${minutes} min read` : '', url ? `Read this issue online: ${url}` : ''].filter(Boolean).join('\n');
    } else {
      const a = boxAttrs(marker.raw);
      const url = safeBlockUrl(a.buttonUrl);
      out += [a.label, a.title, a.blurb, a.buttonText && url ? `${a.buttonText}: ${url}` : ''].filter(Boolean).join('\n');
    }
    cursor = marker.end;
  }
  return out + html.slice(cursor);
}

/**
 * The header block above the body. `masthead` is the big name in the accent,
 * `logo-name` the plain name line (with the shared logo when one is set), and
 * `banner` a full-width image that falls back to the name line when the theme
 * carries no banner URL. Legacy designs map to the first two and reproduce the
 * historic name line byte for byte.
 */
function headerHtml(input: RenderInput, tokens: EmailThemeTokens, palette: Palette): string {
  const pad = spacingScale(tokens.spacing).header;
  const name = esc(input.churchName);
  if (tokens.header === 'none') return '';
  if (tokens.header === 'banner' && tokens.bannerUrl) {
    return `<img src="${esc(tokens.bannerUrl)}" alt="${name}" width="${widthPx(tokens.width)}" style="display:block;width:100%;height:auto">`;
  }
  const size = tokens.header === 'masthead' ? 22 : 15;
  const color = tokens.header === 'masthead' ? palette.accent : palette.ink;
  const logo = input.logoUrl ? `<img src="${esc(input.logoUrl)}" alt="" style="display:block;height:30px;width:auto;margin:0 0 10px">` : '';
  if (!logo) return `<div style="padding:${pad};font-size:${size}px;font-weight:700;color:${color}">${name}</div>`;
  return `<div style="padding:${pad}">${logo}<div style="font-size:${size}px;font-weight:700;color:${color}">${name}</div></div>`;
}

/**
 * Render one email. Pure: the Preview dialog and the Plunk send both land here
 * and get the same markup. The output is table HTML with inline styles and
 * web-safe font fallback stacks only.
 *
 * The tokens come from `resolveTheme()`: a theme snapshot/id when the broadcast
 * has one, otherwise the legacy `EmailDesign` mapped through `tokensFromDesign`
 * — whose palette keeps the historic output byte-identical. The contrast
 * substitutions made for a theme are returned in `adjustments`; a legacy render
 * reports none because it never changes what it always drew.
 */
export function renderEmail(input: RenderInput): { html: string; text: string; adjustments: readonly ThemeContrastAdjustment[] } {
  const dark = input.dark === true;
  const resolved = resolveTheme({
    themeId: input.themeId,
    themeTokens: input.themeTokens,
    design: input.design,
    customThemes: input.customThemes,
    dark,
  });
  const legacy = resolved.source === 'legacy';
  const tokens = resolved.tokens;
  const { palette, adjustments } = legacy
    ? {
        palette: { ...legacyPalette(input.design, dark), heading: legacyPalette(input.design, dark).ink },
        adjustments: [] as ThemeContrastAdjustment[],
      }
    : themePalette(tokens, dark);
  const sp = spacingScale(tokens.spacing);
  const scale = textScale(tokens.textSize);
  const corners = tokens.layout === 'flat' ? 0 : tokens.corners;

  let body = fillMergeTags(sanitizeEmailBody(input.bodyHtml), input, { html: true });
  // Reading time for the Issue header block: whole-body words at 200 wpm.
  const minutes = Math.max(1, Math.round(htmlToText(input.bodyHtml).split(/\s+/).filter(Boolean).length / 200));
  body = renderBlockMarkup(body, tokens, palette, minutes);
  if (!legacy) body = styleBodyBlocks(body, tokens, palette);
  body = body.replace(
    /<a ([^>]*?)data-button="true"([^>]*)>/g,
    `<a $1$2 style="${buttonStyle(tokens, palette)}">`,
  );
  const header = headerHtml(input, tokens, palette);
  const pre = input.preheader.trim()
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(fillMergeTags(input.preheader, input))}</div>`
    : '';
  // Brand footer note and social links ride every theme (and legacy output):
  // set once in Email settings, drawn in the footer below the per-email note.
  const brandNote = (input.footerNote ?? '').trim();
  const social = (input.socialLinks ?? []).filter((l) => l && l.url.trim());
  const socialHtml = social
    .map((l) => `<a href="${esc(l.url.trim())}" style="color:${palette.quiet};text-decoration:underline">${SOCIAL_PLATFORM_LABELS[l.platform]}</a>`)
    .join('&nbsp;&middot;&nbsp;');
  const footerLines = [input.design.footerText.trim(), brandNote].filter(Boolean).map(esc)
    .concat(socialHtml ? [socialHtml] : [], input.mailingAddress.trim() ? [esc(input.mailingAddress.trim())] : [])
    .join('<br>');
  const hairline = mixHex(palette.ink, palette.card, 0.8);
  const footerExtra = tokens.footer === 'boxed' ? `;border-top:1px solid ${hairline};background:${mixHex(palette.card, palette.accent, 0.05)}` : '';

  const html = `<!doctype html><html><body style="margin:0;background:${palette.page};font-family:${palette.family};color:${palette.ink}">${pre}`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${palette.page}"><tr><td align="center" style="padding:${sp.outer}">`
    + `<div style="max-width:${widthPx(tokens.width)}px;margin:0 auto;background:${palette.card};border-radius:${corners}px;text-align:left">`
    + `${header}<div style="padding:${sp.body};font-size:${scale.fontSize}px;line-height:${scale.lineHeight}">${body}</div>`
    + `<div style="padding:${sp.footer};font-size:12px;line-height:1.5;color:${palette.quiet}${footerExtra}">${footerLines ? `${footerLines}<br>` : ''}`
    + `<a href="${esc(input.unsubscribeUrl)}" style="color:${palette.quiet}">Unsubscribe</a></div></div></td></tr></table></body></html>`;

  const text = [
    htmlToText(renderBlockText(fillMergeTags(input.bodyHtml, input), minutes)),
    '',
    input.design.footerText.trim(),
    brandNote,
    ...social.map((l) => `${SOCIAL_PLATFORM_LABELS[l.platform]}: ${l.url.trim()}`),
    input.mailingAddress.trim(),
    `Unsubscribe: ${input.unsubscribeUrl}`,
  ].filter((line, i, all) => line !== '' || all[i - 1] !== '').join('\n');
  return { html, text, adjustments };
}
