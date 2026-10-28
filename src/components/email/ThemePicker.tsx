'use client';

import { Check, Trash2 } from 'lucide-react';

import { TAP } from '@/components/email/kit';
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
    <span aria-hidden className="flex h-20 w-full flex-col p-2" style={{ backgroundColor: tokens.page }}>
      <span className="flex flex-1 flex-col gap-1.5 p-2" style={{ backgroundColor: tokens.card, borderRadius: radius }}>
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
        <span className="leading-none" style={{ color: tokens.heading, fontSize: 13, fontWeight: 700 }}>Aa</span>
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
    <div className="relative">
      <button
        type="button"
        role="radio"
        aria-label={name}
        aria-checked={selected}
        onClick={() => onSelect(choice)}
        className={cn(TAP, 'flex w-full flex-col gap-1.5 rounded-lg border p-1.5 text-left', selected ? 'border-primary ring-1 ring-primary' : 'border-line')}
      >
        <span aria-hidden className="relative block overflow-hidden rounded-md border border-line">
          <ThemeThumb tokens={choice.tokens} />
          {selected && (
            <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="size-3" />
            </span>
          )}
        </span>
        <span className="flex items-baseline gap-1.5 px-1 pb-0.5">
          <span className="text-xs font-medium text-strong">{name}</span>
          {defaultTheme && <span className="text-[10px] uppercase tracking-wide text-faint">Default</span>}
        </span>
      </button>
      {onDelete && (
        <button
          type="button"
          aria-label={`Delete ${name}`}
          onClick={onDelete}
          className={cn(TAP, 'absolute left-2.5 top-2.5 flex size-6 items-center justify-center rounded-full border border-line bg-card/90 text-muted hover:text-danger')}
        >
          <Trash2 className="size-3" />
        </button>
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
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
      <p className="text-xs leading-relaxed text-faint">
        {help ?? 'Start from a look you like, then fine-tune anything below. Built-in themes stay as they are; your changes save as your own theme.'}
      </p>
    </div>
  );
}
