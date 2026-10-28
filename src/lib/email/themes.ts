/**
 * Email themes — token model, the five shipped presets, and the mapping from
 * the legacy `EmailDesign` every old broadcast still carries.
 *
 * An `EmailThemeTokens` object is the whole look of an email: colours, fonts
 * with email-safe fallback stacks, text size, header mode, layout, width,
 * corners, spacing, buttons, dividers, quotes and footer. Nothing outside this
 * file invents theme values — `resolveTheme()` is the one place a stored
 * `themeId` / `themeTokens` snapshot / legacy `design` becomes tokens, and the
 * renderer draws from the tokens it is handed.
 *
 * Email clients cannot read CSS variables, so the Harvest brand scale
 * (globals.css: --navy-900, --wheat-500, --navy-600) is spelled in this file
 * and nowhere else in this feature; render.ts re-exports BRAND_PALETTE from it.
 *
 * Legacy note: a broadcast saved before themes carried only `EmailDesign`.
 * `tokensFromDesign()` maps one to tokens, and the renderer's legacy palette
 * keeps the exact historic output — byte-identical, quirks and all (a navy
 * design previews its buttons in the night palette). Those quirks live in
 * `legacyPalette()` and are deliberately NOT inherited by new themes.
 */
import { DEFAULT_EMAIL_DESIGN, readHexColor, type EmailDesign } from '@/lib/email/design';
import { inkOn } from '@/lib/email/theme-contrast';

/** The Harvest brand scale, spelled for email clients. */
export const NAVY = '#0C1526';
export const GOLD = '#C9963A';
export const NAVY_600 = '#274067';
export const NIGHT_PAGE = '#0C1526';
export const NIGHT_CARD = '#12203B';

export type ThemeFontKind = 'fraunces' | 'georgia' | 'inter' | 'system';
export type ThemeTextSize = 'small' | 'regular' | 'large';
export type ThemeHeaderMode = 'banner' | 'logo-name' | 'masthead' | 'none';
export type ThemeLayout = 'flat' | 'card';
export type ThemeWidth = 'narrow' | 'standard' | 'wide';
export type ThemeSpacing = 'compact' | 'cozy';
export type ThemeButtonShape = 'square' | 'rounded' | 'pill';
export type ThemeButtonSize = 'sm' | 'md';
export type ThemeButtonWidth = 'auto' | 'full';
export type ThemeButtonAlign = 'left' | 'center';
export type ThemeButtonFill = 'filled' | 'outline';
export type ThemeDividers = 'line' | 'dots' | 'space';
export type ThemeQuotes = 'bar' | 'italic' | 'box';
export type ThemeFooter = 'plain' | 'boxed';

export interface EmailThemeButtons {
  readonly shape: ThemeButtonShape;
  readonly size: ThemeButtonSize;
  readonly width: ThemeButtonWidth;
  readonly align: ThemeButtonAlign;
  /**
   * The legacy `EmailDesign.buttons` value. The picker's four button controls
   * are shape/size/width/align, but a resolved theme must decide the button's
   * colour scheme on its own, so the fill travels with the rest of the tokens.
   */
  readonly fill: ThemeButtonFill;
}

export interface EmailThemeTokens {
  /** Page ground behind the card. Six-digit hex throughout. */
  readonly page: string;
  readonly card: string;
  readonly text: string;
  readonly heading: string;
  /** Links and buttons. */
  readonly accent: string;
  readonly headingFont: ThemeFontKind;
  readonly bodyFont: ThemeFontKind;
  readonly textSize: ThemeTextSize;
  readonly header: ThemeHeaderMode;
  /** Full-width header image for `header: 'banner'`; ignored otherwise. */
  readonly bannerUrl?: string;
  /** `flat` runs the content straight on the page ground; `card` floats one. */
  readonly layout: ThemeLayout;
  readonly width: ThemeWidth;
  /** Card corner radius in px. `layout: 'flat'` always renders square. */
  readonly corners: number;
  readonly spacing: ThemeSpacing;
  readonly buttons: EmailThemeButtons;
  readonly dividers: ThemeDividers;
  readonly quotes: ThemeQuotes;
  readonly footer: ThemeFooter;
}

export type ThemePresetId = 'letter' | 'essay' | 'card' | 'midnight' | 'minimal';

export interface EmailThemePreset {
  readonly id: ThemePresetId;
  readonly name: string;
  readonly tokens: EmailThemeTokens;
}

/** A ministry's own named copy of a token set. Stored server-side only. */
export interface CustomTheme {
  readonly id: string;
  readonly name: string;
  readonly tokens: EmailThemeTokens;
  readonly createdAt: string;
}

/**
 * Where a resolution came from. `legacy` means the tokens were mapped from an
 * old `EmailDesign`; only that source carries the historic rendering quirks.
 */
export type ThemeSource = 'preset' | 'custom' | 'legacy';

export interface ThemeResolution {
  readonly tokens: EmailThemeTokens;
  readonly source: ThemeSource;
  readonly themeId: string | null;
}

/** A pair the renderer had to re-colour to stay readable; surfaced in preview. */
export interface ThemeContrastAdjustment {
  readonly pair: 'text' | 'heading' | 'accent' | 'button';
  readonly from: string;
  readonly to: string;
}

/**
 * The colour an email draws its accent in. `custom` uses the hex the design
 * carries, and falls back to gold when that is missing or malformed. Anything
 * else, including a `harbor` saved by an older version, reads as navy.
 */
export function accentHex(design: Pick<EmailDesign, 'accent' | 'customColor'>): string {
  if (design.accent === 'gold') return GOLD;
  if (design.accent === 'custom') return readHexColor(design.customColor) ?? GOLD;
  return NAVY;
}

/**
 * Web-safe fallback stacks. A web font is named first — Gmail and Outlook fall
 * back to the rest of the stack and never fetch it, which is exactly the point:
 * the email must look right with only the fallbacks installed.
 */
const FONT_STACKS: Readonly<Record<ThemeFontKind, string>> = Object.freeze({
  fraunces: 'Fraunces, Georgia, "Times New Roman", serif',
  georgia: 'Georgia, "Times New Roman", serif',
  inter: 'Inter, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
  system: '-apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
});

export function fontStack(kind: ThemeFontKind): string {
  return FONT_STACKS[kind];
}

/** Body size and line height per text-size setting. */
export function textScale(size: ThemeTextSize): { fontSize: number; lineHeight: number } {
  if (size === 'small') return { fontSize: 14, lineHeight: 1.65 };
  if (size === 'large') return { fontSize: 18, lineHeight: 1.7 };
  return { fontSize: 16, lineHeight: 1.6 };
}

/** Card width in px. `standard` is the width every pre-theme email rendered. */
export function widthPx(width: ThemeWidth): number {
  if (width === 'narrow') return 480;
  if (width === 'wide') return 640;
  return 560;
}

export function buttonRadius(shape: ThemeButtonShape): number {
  return shape === 'square' ? 0 : shape === 'pill' ? 999 : 8;
}

export function buttonPadding(size: ThemeButtonSize): string {
  return size === 'sm' ? '8px 16px' : '12px 22px';
}

export interface SpacingScale {
  readonly outer: string;
  readonly header: string;
  readonly body: string;
  readonly footer: string;
}

/** The four paddings around the chrome. `cozy` is the historic set. */
export function spacingScale(spacing: ThemeSpacing): SpacingScale {
  return spacing === 'compact'
    ? { outer: '12px 8px', header: '16px 20px 0', body: '12px 20px 4px', footer: '12px 20px 16px' }
    : { outer: '24px 12px', header: '28px 32px 0', body: '20px 32px 8px', footer: '16px 32px 28px' };
}

const freeze = (tokens: EmailThemeTokens): EmailThemeTokens =>
  Object.freeze({ ...tokens, buttons: Object.freeze({ ...tokens.buttons }) });

/**
 * The five shipped looks. Immutable code constants: a preset cannot be edited
 * from the app, only copied into a CustomTheme. Every colour is a six-digit
 * hex an email client can read; every font has a web-safe fallback stack.
 */
export const THEME_PRESETS: readonly EmailThemePreset[] = Object.freeze([
  Object.freeze({
    id: 'letter' as const,
    name: 'Letter',
    // A warm cream page and a white card, Fraunces headings: a note from the pastor.
    tokens: freeze({
      page: '#FAF8F5',
      card: '#FFFFFF',
      text: '#3A352E',
      heading: NAVY,
      accent: NAVY,
      headingFont: 'fraunces',
      bodyFont: 'inter',
      textSize: 'regular',
      header: 'masthead',
      layout: 'card',
      width: 'standard',
      corners: 12,
      spacing: 'cozy',
      buttons: { shape: 'rounded', size: 'md', width: 'auto', align: 'left', fill: 'filled' },
      dividers: 'line',
      quotes: 'bar',
      footer: 'plain',
    }),
  }),
  Object.freeze({
    id: 'essay' as const,
    name: 'Essay',
    // Flat and narrow with generous leading, for long-form reading.
    tokens: freeze({
      page: '#FFFFFF',
      card: '#FFFFFF',
      text: '#2E2A26',
      heading: NAVY,
      accent: NAVY_600,
      headingFont: 'fraunces',
      bodyFont: 'georgia',
      textSize: 'large',
      header: 'logo-name',
      layout: 'flat',
      width: 'narrow',
      corners: 0,
      spacing: 'cozy',
      buttons: { shape: 'rounded', size: 'sm', width: 'auto', align: 'left', fill: 'outline' },
      dividers: 'space',
      quotes: 'italic',
      footer: 'plain',
    }),
  }),
  Object.freeze({
    id: 'card' as const,
    name: 'Card',
    // A pale card on a white page, bold sans headings and boxed quotes.
    tokens: freeze({
      page: '#FFFFFF',
      card: '#FAF8F5',
      text: '#33302B',
      heading: NAVY,
      accent: '#8A6222',
      headingFont: 'inter',
      bodyFont: 'inter',
      textSize: 'regular',
      header: 'masthead',
      layout: 'card',
      width: 'standard',
      corners: 12,
      spacing: 'cozy',
      buttons: { shape: 'rounded', size: 'sm', width: 'full', align: 'center', fill: 'filled' },
      dividers: 'space',
      quotes: 'box',
      footer: 'boxed',
    }),
  }),
  Object.freeze({
    id: 'midnight' as const,
    name: 'Midnight',
    // Dark navy page and card, light words, gold accent (the NIGHT_* values).
    tokens: freeze({
      page: NIGHT_PAGE,
      card: NIGHT_CARD,
      text: '#F5F5F5',
      heading: '#FFFFFF',
      accent: GOLD,
      headingFont: 'fraunces',
      bodyFont: 'inter',
      textSize: 'regular',
      header: 'logo-name',
      layout: 'card',
      width: 'standard',
      corners: 12,
      spacing: 'cozy',
      buttons: { shape: 'pill', size: 'md', width: 'auto', align: 'left', fill: 'outline' },
      dividers: 'line',
      quotes: 'bar',
      footer: 'plain',
    }),
  }),
  Object.freeze({
    id: 'minimal' as const,
    name: 'Minimal',
    // Flat white, hairline dividers, quiet footer, no ornament.
    tokens: freeze({
      page: '#FFFFFF',
      card: '#FFFFFF',
      text: '#2A2A2A',
      heading: '#1A1A1A',
      accent: NAVY_600,
      headingFont: 'system',
      bodyFont: 'system',
      textSize: 'small',
      header: 'none',
      layout: 'flat',
      width: 'standard',
      corners: 0,
      spacing: 'compact',
      buttons: { shape: 'square', size: 'sm', width: 'auto', align: 'left', fill: 'outline' },
      dividers: 'line',
      quotes: 'bar',
      footer: 'plain',
    }),
  }),
]);

export const THEME_PRESET_IDS: readonly ThemePresetId[] = Object.freeze(THEME_PRESETS.map((p) => p.id));

export const DEFAULT_THEME_ID: ThemePresetId = 'letter';

export function getThemePreset(id: string | null | undefined): EmailThemePreset | null {
  return THEME_PRESETS.find((p) => p.id === id) ?? null;
}

export function getCustomTheme(themes: readonly CustomTheme[], id: string | null | undefined): CustomTheme | null {
  return themes.find((t) => t.id === id) ?? null;
}

export const DEFAULT_THEME_TOKENS: EmailThemeTokens = getThemePreset(DEFAULT_THEME_ID)!.tokens;

/**
 * The exact colour arithmetic every pre-theme email rendered with, quirks and
 * all: a navy (or `harbor`) design previews its buttons in the night palette,
 * and `plain` runs white-on-white. This is a compatibility surface — new themes
 * derive their palette from their own tokens and inherit none of it. Kept
 * verbatim so legacy output stays byte-identical.
 */
export interface LegacyPalette {
  readonly page: string;
  readonly card: string;
  readonly ink: string;
  readonly quiet: string;
  readonly accent: string;
  readonly family: string;
  readonly buttonBg: string;
  readonly buttonInk: string;
  readonly buttonBorder: string;
}

export function legacyPalette(design: EmailDesign, dark: boolean): LegacyPalette {
  const isNavy = design.accent !== 'gold' && design.accent !== 'custom';
  const accent = dark && isNavy ? GOLD : accentHex(design);
  const page = dark ? NIGHT_PAGE : design.theme === 'plain' ? '#ffffff' : '#FAF8F5';
  const card = dark ? NIGHT_CARD : '#ffffff';
  const ink = dark ? '#F5F5F5' : '#1A1A1A';
  const quiet = dark ? '#a3a3a3' : '#6b6b6b';
  const family = design.font === 'serif' ? fontStack('georgia') : fontStack('system');
  const buttonBg = design.buttons === 'filled' ? (dark && isNavy ? '#F5F5F5' : accent) : 'transparent';
  const buttonInk = design.buttons === 'filled' ? (dark && isNavy ? '#0C1526' : inkOn(accent)) : (dark && isNavy ? '#F5F5F5' : accent);
  const buttonBorder = design.buttons === 'filled' ? buttonBg : buttonInk;
  return { page, card, ink, quiet, accent, family, buttonBg, buttonInk, buttonBorder };
}

/**
 * Map a legacy `EmailDesign` onto theme tokens so an old draft can be shown,
 * previewed and re-rendered through the token path. Colours come from
 * `legacyPalette()` (one copy of the legacy arithmetic); the rest is the
 * design's settings placed on the nearest token. `dark` folds the night
 * preview canvas into the colour fields; the historic button quirk cannot be
 * expressed in tokens and lives only in `legacyPalette()`.
 */
export function tokensFromDesign(design: EmailDesign, dark = false): EmailThemeTokens {
  const palette = legacyPalette(design, dark);
  return freeze({
    page: palette.page,
    card: palette.card,
    text: palette.ink,
    heading: palette.ink,
    accent: palette.accent,
    headingFont: design.font === 'serif' ? 'georgia' : 'system',
    bodyFont: design.font === 'serif' ? 'georgia' : 'system',
    textSize: 'regular',
    header: design.header === 'none' ? 'none' : design.theme === 'bold' ? 'masthead' : 'logo-name',
    layout: design.theme === 'plain' ? 'flat' : 'card',
    width: 'standard',
    corners: design.theme === 'plain' ? 0 : 12,
    spacing: 'cozy',
    buttons: {
      shape: 'rounded',
      size: 'md',
      width: 'auto',
      align: 'left',
      fill: design.buttons === 'outline' ? 'outline' : 'filled',
    },
    dividers: 'line',
    quotes: 'bar',
    footer: 'plain',
  });
}

const isOneOf = <T extends string>(value: unknown, options: readonly T[]): value is T =>
  typeof value === 'string' && (options as readonly string[]).includes(value);

/**
 * Read a token set out of untrusted storage (a broadcast snapshot or a custom
 * theme document). Every field is validated; a malformed field falls back to
 * the matching field of `base`, and colours only ever pass through
 * `readHexColor`, so nothing but a six-digit hex reaches a style attribute.
 */
export function readThemeTokens(value: unknown, base: EmailThemeTokens): EmailThemeTokens {
  const v = (value ?? {}) as Record<string, unknown>;
  const b = (v.buttons ?? {}) as Record<string, unknown>;
  const hex = (key: keyof EmailThemeTokens) => readHexColor(v[key]) ?? (base[key] as string);
  const bannerUrl = typeof v.bannerUrl === 'string' && v.bannerUrl.trim() ? v.bannerUrl.trim() : undefined;
  return freeze({
    page: hex('page'),
    card: hex('card'),
    text: hex('text'),
    heading: hex('heading'),
    accent: hex('accent'),
    headingFont: isOneOf(v.headingFont, ['fraunces', 'georgia', 'inter', 'system'] as const) ? v.headingFont : base.headingFont,
    bodyFont: isOneOf(v.bodyFont, ['fraunces', 'georgia', 'inter', 'system'] as const) ? v.bodyFont : base.bodyFont,
    textSize: isOneOf(v.textSize, ['small', 'regular', 'large'] as const) ? v.textSize : base.textSize,
    header: isOneOf(v.header, ['banner', 'logo-name', 'masthead', 'none'] as const) ? v.header : base.header,
    ...(bannerUrl ? { bannerUrl } : {}),
    layout: isOneOf(v.layout, ['flat', 'card'] as const) ? v.layout : base.layout,
    width: isOneOf(v.width, ['narrow', 'standard', 'wide'] as const) ? v.width : base.width,
    corners: typeof v.corners === 'number' && Number.isFinite(v.corners) ? Math.min(32, Math.max(0, Math.round(v.corners))) : base.corners,
    spacing: isOneOf(v.spacing, ['compact', 'cozy'] as const) ? v.spacing : base.spacing,
    buttons: Object.freeze({
      shape: isOneOf(b.shape, ['square', 'rounded', 'pill'] as const) ? b.shape : base.buttons.shape,
      size: isOneOf(b.size, ['sm', 'md'] as const) ? b.size : base.buttons.size,
      width: isOneOf(b.width, ['auto', 'full'] as const) ? b.width : base.buttons.width,
      align: isOneOf(b.align, ['left', 'center'] as const) ? b.align : base.buttons.align,
      fill: isOneOf(b.fill, ['filled', 'outline'] as const) ? b.fill : base.buttons.fill,
    }),
    dividers: isOneOf(v.dividers, ['line', 'dots', 'space'] as const) ? v.dividers : base.dividers,
    quotes: isOneOf(v.quotes, ['bar', 'italic', 'box'] as const) ? v.quotes : base.quotes,
    footer: isOneOf(v.footer, ['plain', 'boxed'] as const) ? v.footer : base.footer,
  });
}

export interface ResolveThemeInput {
  /** A preset id or a CustomTheme id. */
  readonly themeId?: string | null;
  /** The token snapshot saved on the broadcast. Wins over the id's own tokens. */
  readonly themeTokens?: unknown;
  /** The legacy design; used when no theme is attached. */
  readonly design?: EmailDesign | null;
  readonly customThemes?: readonly CustomTheme[];
  /** Night preview canvas, folded into a legacy mapping's colours. */
  readonly dark?: boolean;
}

/**
 * The one way a stored `themeId` / `themeTokens` / legacy `design` becomes
 * tokens. Precedence: an explicit token snapshot (validated against the theme
 * it was snapshotted from, else the default preset), then the named preset or
 * custom theme, then the legacy design, then the default preset. An unknown id
 * falls through to the legacy design rather than inventing a look.
 */
export function resolveTheme(input: ResolveThemeInput): ThemeResolution {
  const named = getThemePreset(input.themeId) ?? getCustomTheme(input.customThemes ?? [], input.themeId);
  const source: ThemeSource = named ? (getThemePreset(input.themeId) ? 'preset' : 'custom') : 'custom';
  if (input.themeTokens != null) {
    return {
      tokens: readThemeTokens(input.themeTokens, named ? named.tokens : DEFAULT_THEME_TOKENS),
      source: named ? source : 'custom',
      themeId: input.themeId ?? null,
    };
  }
  if (named) {
    return { tokens: named.tokens, source, themeId: named.id };
  }
  return {
    tokens: tokensFromDesign(input.design ?? DEFAULT_EMAIL_DESIGN, input.dark === true),
    source: 'legacy',
    themeId: null,
  };
}

/* ------------------------------------------------------------------ *
 * Shared brand settings — the ministry's identity, set once in Email
 * settings and drawn by every theme: the logo (header) and these social
 * links (footer). The footer note lives on EmailSettings beside them.
 * ------------------------------------------------------------------ */

export type SocialPlatform = 'facebook' | 'instagram' | 'youtube' | 'x' | 'tiktok' | 'linkedin' | 'website';

export interface SocialLink {
  readonly platform: SocialPlatform;
  /** A full https:// address. Nothing else is ever rendered into an href. */
  readonly url: string;
}

export const SOCIAL_PLATFORMS: readonly SocialPlatform[] = Object.freeze([
  'facebook', 'instagram', 'youtube', 'x', 'tiktok', 'linkedin', 'website',
]);

export const SOCIAL_PLATFORM_LABELS: Readonly<Record<SocialPlatform, string>> = Object.freeze({
  facebook: 'Facebook',
  instagram: 'Instagram',
  youtube: 'YouTube',
  x: 'X',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  website: 'Website',
});

/** The email footer keeps the row short. The settings screen enforces the same number. */
export const MAX_SOCIAL_LINKS = 6;

/**
 * Read social links out of untrusted storage. Entries without a known
 * platform or a full https:// address are dropped — the caller compares
 * lengths when it needs to reject a save loudly (service.saveSettings).
 */
export function readSocialLinks(value: unknown): readonly SocialLink[] {
  if (!Array.isArray(value)) return [];
  const out: SocialLink[] = [];
  for (const raw of value) {
    const v = (raw ?? {}) as Record<string, unknown>;
    const platform = isOneOf(v.platform, SOCIAL_PLATFORMS) ? v.platform : null;
    const url = typeof v.url === 'string' ? v.url.trim() : '';
    if (!platform || !/^https:\/\//i.test(url)) continue;
    if (out.length >= MAX_SOCIAL_LINKS) continue;
    out.push(Object.freeze({ platform, url }));
  }
  return out;
}

/** The most saved themes a ministry may keep. Enforced in `service.saveTheme`. */
export const MAX_CUSTOM_THEMES = 10;

/**
 * Read one CustomTheme out of untrusted storage. Returns null rather than a
 * half-built theme: the service layer is where a save is rejected loudly, and
 * a document that cannot produce name + tokens has no business rendering.
 */
export function readCustomTheme(value: unknown): CustomTheme | null {
  const v = (value ?? {}) as Record<string, unknown>;
  const id = typeof v.id === 'string' ? v.id.trim() : '';
  const name = typeof v.name === 'string' ? v.name.trim() : '';
  if (!id || !name || typeof v.tokens !== 'object' || v.tokens === null) return null;
  return Object.freeze({
    id,
    name,
    tokens: readThemeTokens(v.tokens, DEFAULT_THEME_TOKENS),
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : '',
  });
}