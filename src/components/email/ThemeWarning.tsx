'use client';

import { Contrast } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AA_CONTRAST,
  contrastRatio,
  inkOn,
  readableTextOn,
} from '@/lib/email/theme-contrast';
import type { EmailThemeTokens } from '@/lib/email/themes';
import { cn } from '@/lib/utils';

/** One ink-on-a-ground pairing the renderer can be forced to re-colour. */
export interface ThemeContrastPair {
  readonly key: 'text' | 'heading' | 'links' | 'buttons';
  readonly label: string;
  readonly ink: string;
  readonly ground: string;
}

export interface ThemeContrastReport {
  readonly pairs: readonly ThemeContrastPair[];
  /** Pairs where the theme's own colours fall below AA. */
  readonly low: readonly ThemeContrastPair[];
  /** True when the readable-ink fallback substitutes at least one colour. */
  readonly adjusted: boolean;
}

/**
 * What the shared contrast helpers say about one theme's colours: body text,
 * headings, links and buttons, each against the ground the renderer draws it
 * on. The pairs mirror `themePalette()`'s light path in render.ts (the night
 * canvas has its own fixed inks), so a banner built from this report can never
 * disagree with what a send actually does. All the maths is the one
 * theme-contrast module's — nothing is reimplemented here.
 */
export function themeContrastReport(tokens: EmailThemeTokens): ThemeContrastReport {
  const card = tokens.card;
  const filled = tokens.buttons.fill === 'filled';
  const pairs: readonly ThemeContrastPair[] = [
    { key: 'text', label: 'Body text', ink: tokens.text, ground: card },
    { key: 'heading', label: 'Headings', ink: tokens.heading, ground: card },
    { key: 'links', label: 'Links', ink: tokens.accent, ground: card },
    {
      key: 'buttons',
      label: 'Buttons',
      ink: filled ? inkOn(tokens.accent) : tokens.accent,
      ground: filled ? tokens.accent : card,
    },
  ];
  const low = pairs.filter((p) => contrastRatio(p.ink, p.ground) < AA_CONTRAST);
  const adjusted = pairs.some((p) => readableTextOn(p.ground, p.ink) !== p.ink);
  return { pairs, low, adjusted };
}

function joinLabels(low: readonly ThemeContrastPair[]): string {
  const names = low.map((p) => p.label);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The calm banner over a preview and over the theme panels when a theme's own
 * colours would be hard to read in an inbox. Quiet substitution is the bug this
 * exists against: when the renderer's readable-ink fallback fires, the banner
 * says so in plain words instead of letting a send recolour itself unheard.
 *
 * A null `tokens` (the classic look) draws nothing: the legacy renderer never
 * changes the colours it always drew, so there is no substitution to report.
 */
export function ThemeWarning({ tokens, className }: {
  tokens: EmailThemeTokens | null;
  className?: string;
}) {
  if (!tokens) return null;
  const report = themeContrastReport(tokens);
  if (report.low.length === 0) return null;
  return (
    <Alert role="status" className={cn('border-line bg-surface-gold text-strong', className)}>
      <Contrast aria-hidden />
      <AlertTitle>Some colours may be hard to read</AlertTitle>
      <AlertDescription className="text-strong">
        <p>
          {joinLabels(report.low)} {report.low.length === 1 ? 'sits' : 'sit'} too close to the background colour in this theme. Pick darker or lighter colours so the words stay clear in every inbox.
        </p>
        {report.adjusted && <p className="font-medium">We adjusted the words so they stay readable</p>}
      </AlertDescription>
    </Alert>
  );
}
