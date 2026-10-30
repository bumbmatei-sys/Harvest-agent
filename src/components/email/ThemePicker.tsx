'use client';

import { Check, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

import {
  THEME_PRESETS,
  type CustomTheme,
  type EmailThemeTokens,
} from '@/lib/email/themes';
import { cn } from '@/lib/utils';

/** What a click on a tile hands back: the id plus the tokens to snapshot. */
export interface ThemeChoice {
  readonly id: string;
  readonly tokens: EmailThemeTokens;
}

/**
 * A miniature of the email, drawn from the theme's own tokens: the page ground,
 * a card at the theme's corner radius, a heading "Aa" in the heading colour, two
 * quiet body lines and a button chip in the accent. A preset thumbnail is this
 * widget and nothing else, so Letter reads cream and Midnight reads night
 * without a screenshot of either.
 */
function ThemeThumb({ tokens }: { tokens: EmailThemeTokens }) {
  const flat = tokens.layout === 'flat';
  const radius = flat ? 0 : Math.min(tokens.corners, 32) / 2.5;
  const chipRadius = tokens.buttons.shape === 'square' ? 0 : tokens.buttons.shape === 'pill' ? 999 : 3;
  const outline = tokens.buttons.fill === 'outline';
  return (
    <span aria-hidden className="flex h-[88px] w-full flex-col p-2" style={{ backgroundColor: tokens.page }}>
      <span className="flex flex-1 flex-col gap-1 p-2" style={{ backgroundColor: tokens.card, borderRadius: radius }}>
        {tokens.header !== 'none' && (
          <span
            className="h-1 rounded-full"
            style={{
              backgroundColor: tokens.heading,
              opacity: 0.55,
              width: tokens.header === 'banner' ? '100%' : tokens.header === 'masthead' ? '55%' : '35%',
              alignSelf: tokens.header === 'masthead' ? 'center' : 'flex-start',
            }}
          />
        )}
        <span className="leading-none" style={{ color: tokens.heading, fontSize: 14, fontWeight: 700, fontFamily: tokens.headingFont === 'fraunces' || tokens.headingFont === 'georgia' ? 'Georgia, serif' : 'Arial, sans-serif' }}>Aa</span>
        <span className="h-1 w-full rounded-full" style={{ backgroundColor: tokens.text, opacity: 0.35 }} />
        <span className="h-1 w-4/5 rounded-full" style={{ backgroundColor: tokens.text, opacity: 0.35 }} />
        <span
          className={cn('mt-auto block h-2.5 w-9', tokens.buttons.align === 'center' && 'self-center')}
          style={outline
            ? { border: `1px solid ${tokens.accent}`, borderRadius: chipRadius }
            : { backgroundColor: tokens.accent, borderRadius: chipRadius }}
        />
      </span>
    </span>
  );
}

function ThemeTile({ choice, name, selected, defaultTheme, onSelect, onDelete }: {
  choice: ThemeChoice;
  name: string;
  selected: boolean;
  /** True when this is the theme new emails start with. */
  defaultTheme?: boolean;
  onSelect: (choice: ThemeChoice) => void;
  /** Present on custom themes only: presets cannot be deleted. */
  onDelete?: () => void;
}) {
  return (
    <div className="relative min-w-0">
      <Button
        variant="outline"
        type="button"
        role="radio"
        aria-label={name}
        aria-checked={selected}
        onClick={() => onSelect(choice)}
        className="flex h-auto min-h-11 w-full flex-col gap-2 rounded-xl border border-line bg-card p-1.5 text-left transition-colors hover:border-primary hover:bg-surface-raised focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring aria-checked:border-primary aria-checked:bg-surface-raised aria-checked:ring-1 aria-checked:ring-primary"
      >
        <span aria-hidden className="relative block w-full overflow-hidden rounded-lg border border-line">
          <ThemeThumb tokens={choice.tokens} />
          {selected && (
            <span className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="size-3" />
            </span>
          )}
        </span>
        <span className={cn("flex min-h-11 w-full flex-col justify-center gap-0.5 px-1 sm:min-h-[38px]", onDelete && "pr-11")}>
          <span className="block w-full truncate text-xs font-medium leading-4 text-strong">{name}</span>
          {defaultTheme && <span className="text-[10px] leading-3 text-faint">Default</span>}
        </span>
      </Button>
      {onDelete && (
        <Button
          variant="ghost"
          size="icon"
          type="button"
          aria-label={`Delete ${name}`}
          onClick={onDelete}
          // A dedicated label-row slot keeps the 44px mobile target clear of
          // the thumbnail and the theme's selection badge.
          className="absolute bottom-1.5 right-1.5 flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-sunken hover:text-danger focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:min-h-[38px] sm:min-w-[38px]"
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

/**
 * The grid of looks a writer picks from: the five shipped presets and a
 * ministry's own saved themes after them. Controlled — a click hands the id and
 * the tokens back through `onSelect`, and the caller decides what to snapshot.
 * Presets are immutable here: a tile always shows its own tokens. Custom tiles
 * carry a delete control; the tile for `defaultId` is labelled Default.
 */
export function ThemePicker({ selectedId, onSelect, customThemes = [], defaultId = null, onDelete, label = 'Email theme', help }: {
  selectedId: string | null;
  onSelect: (choice: ThemeChoice) => void;
  /** A ministry's saved themes. */
  customThemes?: readonly CustomTheme[];
  /** The theme new emails start with. Its tile is labelled Default. */
  defaultId?: string | null;
  /** Deleting a saved theme. No handler: nothing to delete from. */
  onDelete?: (id: string) => void;
  label?: string;
  help?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {THEME_PRESETS.map((preset) => (
          <ThemeTile
            key={preset.id}
            choice={{ id: preset.id, tokens: preset.tokens }}
            name={preset.name}
            selected={selectedId === preset.id}
            defaultTheme={defaultId === preset.id}
            onSelect={onSelect}
          />
        ))}
        {customThemes.map((theme) => (
          <ThemeTile
            key={theme.id}
            choice={{ id: theme.id, tokens: theme.tokens }}
            name={theme.name}
            selected={selectedId === theme.id}
            defaultTheme={defaultId === theme.id}
            onSelect={onSelect}
            onDelete={onDelete ? () => onDelete(theme.id) : undefined}
          />
        ))}
      </div>
      <p className="text-[11px] leading-relaxed text-faint">
        {help ?? 'Start from a look you like, then fine-tune anything below. Built-in themes stay as they are; your changes save as your own theme.'}
      </p>
    </div>
  );
}
