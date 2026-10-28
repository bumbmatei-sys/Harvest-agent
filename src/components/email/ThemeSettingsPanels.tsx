'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Segmented, TAP } from '@/components/email/kit';
import { ThemeWarning } from '@/components/email/ThemeWarning';
import { readHexColor } from '@/lib/email/design';
import {
  DEFAULT_THEME_TOKENS,
  type EmailThemeButtons,
  type EmailThemeTokens,
  type ThemeFontKind,
  type ThemeHeaderMode,
} from '@/lib/email/themes';
import { cn } from '@/lib/utils';

const FONTS: readonly { value: ThemeFontKind; label: string }[] = [
  { value: 'fraunces', label: 'Fraunces' },
  { value: 'georgia', label: 'Georgia' },
  { value: 'inter', label: 'Inter' },
  { value: 'system', label: 'System' },
];
const FONT_LABEL: Record<ThemeFontKind, string> = { fraunces: 'Fraunces', georgia: 'Georgia', inter: 'Inter', system: 'System' };
const HEADER_LABEL: Record<ThemeHeaderMode, string> = { banner: 'Banner picture', 'logo-name': 'Logo and name', masthead: 'Masthead', none: 'None' };

/**
 * One collapsible of settings. Controlled from the outside so a test (and the
 * dialog) can open exactly one section. Reset restores that section's fields to
 * `defaults` — the look the writer started from — never to a hardcoded palette.
 */
function Section({ title, summary, open, onOpen, onReset, children }: {
  title: string;
  summary: string;
  open: boolean;
  onOpen: (next: boolean) => void;
  onReset: () => void;
  children: React.ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpen} className="border-t border-line">
      <CollapsibleTrigger className={cn(TAP, 'flex w-full items-center gap-2 py-2 text-left')}>
        <span className="flex-1">
          <span className="block text-sm font-medium text-strong">{title}</span>
          <span className="block text-xs text-faint">{summary}</span>
        </span>
        {open ? <ChevronUp className="size-4 text-faint" /> : <ChevronDown className="size-4 text-faint" />}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-4 pb-4 pt-1">
        {children}
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" className="min-h-11 px-2 text-xs text-muted" onClick={onReset}>
            {`Reset ${title.toLowerCase()}`}
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** A colour with a swatch picker, a hex field and a per-row Reset. */
function ColourRow({ label, value, fallback, onChange }: {
  label: string;
  value: string;
  /** What this row's Reset restores. */
  fallback: string;
  onChange: (hex: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium uppercase tracking-wide text-faint">{label}</Label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={`${label} swatch`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-9 w-11 cursor-pointer rounded-md border border-line bg-transparent p-1"
          />
          <Input
            aria-label={`${label} hex`}
            value={draft}
            spellCheck={false}
            maxLength={7}
            onChange={(e) => {
              setDraft(e.target.value);
              const hex = readHexColor(e.target.value);
              if (hex) onChange(hex);
            }}
            className={cn(TAP, 'w-28 font-mono text-xs')}
          />
        </div>
      </div>
      <Button type="button" variant="ghost" size="sm" className="min-h-11 px-2 text-xs text-muted" onClick={() => onChange(fallback)}>
        Reset
      </Button>
    </div>
  );
}

/**
 * Every knob a theme has, as controlled sections over one `EmailThemeTokens`:
 * colours, fonts and text size, header, layout, buttons, dividers and quotes and
 * footer. Nothing here invents a value — each control writes a field the
 * renderer already reads, and Reset restores its own section from `defaults`.
 */
export function ThemeSettingsPanels({ tokens, onChange, defaults = DEFAULT_THEME_TOKENS }: {
  tokens: EmailThemeTokens;
  onChange: (next: EmailThemeTokens) => void;
  /** What the Reset buttons restore to: the look the writer started from. */
  defaults?: EmailThemeTokens;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({ colours: true });
  const toggle = (name: string) => (next: boolean) => setOpen((o) => ({ ...o, [name]: next }));
  const set = <K extends keyof EmailThemeTokens>(key: K, value: EmailThemeTokens[K]) => onChange({ ...tokens, [key]: value });
  const setButton = <K extends keyof EmailThemeButtons>(key: K, value: EmailThemeButtons[K]) =>
    onChange({ ...tokens, buttons: { ...tokens.buttons, [key]: value } });

  return (
    <div className="flex flex-col">
      {/* Above every knob, live: the colours below can make a send unreadable,
          and a fallback nobody is told about is a silent failure. */}
      <ThemeWarning tokens={tokens} className="mb-4" />
      <Section
        title="Colours"
        summary="Page, card, words, headings, links and buttons"
        open={open.colours === true}
        onOpen={toggle('colours')}
        onReset={() => onChange({ ...tokens, page: defaults.page, card: defaults.card, text: defaults.text, heading: defaults.heading, accent: defaults.accent })}
      >
        <ColourRow label="Page" value={tokens.page} fallback={defaults.page} onChange={(hex) => set('page', hex)} />
        <ColourRow label="Card" value={tokens.card} fallback={defaults.card} onChange={(hex) => set('card', hex)} />
        <ColourRow label="Text" value={tokens.text} fallback={defaults.text} onChange={(hex) => set('text', hex)} />
        <ColourRow label="Headings" value={tokens.heading} fallback={defaults.heading} onChange={(hex) => set('heading', hex)} />
        <ColourRow label="Links and buttons" value={tokens.accent} fallback={defaults.accent} onChange={(hex) => set('accent', hex)} />
      </Section>
      <Section
        title="Fonts and text size"
        summary={`${FONT_LABEL[tokens.headingFont]} headings, ${FONT_LABEL[tokens.bodyFont]} words`}
        open={open.fonts === true}
        onOpen={toggle('fonts')}
        onReset={() => onChange({ ...tokens, headingFont: defaults.headingFont, bodyFont: defaults.bodyFont, textSize: defaults.textSize })}
      >
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium uppercase tracking-wide text-faint">Heading font</Label>
          <Segmented label="Heading font" value={tokens.headingFont} onChange={(v) => set('headingFont', v)} options={FONTS} />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium uppercase tracking-wide text-faint">Body font</Label>
          <Segmented label="Body font" value={tokens.bodyFont} onChange={(v) => set('bodyFont', v)} options={FONTS} />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium uppercase tracking-wide text-faint">Text size</Label>
          <Segmented
            label="Text size"
            value={tokens.textSize}
            onChange={(v) => set('textSize', v)}
            options={[{ value: 'small', label: 'Small' }, { value: 'regular', label: 'Regular' }, { value: 'large', label: 'Large' }]}
          />
        </div>
        <p className="text-xs leading-relaxed text-faint">Inboxes that cannot load a web font fall back to a close match, so the text still reads the way you wrote it.</p>
      </Section>
      <Section
        title="Header"
        summary={HEADER_LABEL[tokens.header]}
        open={open.header === true}
        onOpen={toggle('header')}
        onReset={() => onChange({ ...tokens, header: defaults.header, bannerUrl: defaults.bannerUrl })}
      >
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium uppercase tracking-wide text-faint">Top of the email</Label>
          <Segmented
            label="Header"
            value={tokens.header}
            onChange={(v) => set('header', v)}
            options={[
              { value: 'banner', label: 'Banner' },
              { value: 'logo-name', label: 'Logo + name' },
              { value: 'masthead', label: 'Masthead' },
              { value: 'none', label: 'None' },
            ]}
          />
        </div>
        {tokens.header === 'banner' && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="theme-banner-url" className="text-xs font-medium uppercase tracking-wide text-faint">Banner picture URL</Label>
            <Input
              id="theme-banner-url"
              aria-label="Banner picture URL"
              value={tokens.bannerUrl ?? ''}
              onChange={(e) => onChange({ ...tokens, bannerUrl: e.target.value.trim() || undefined })}
              placeholder="https://"
              className={TAP}
            />
            <p className="text-xs leading-relaxed text-faint">A wide picture, around 1200 × 400, sits across the top. With no picture yet, the email falls back to the name line.</p>
          </div>
        )}
      </Section>
      <Section
        title="Layout"
        summary={`${tokens.layout === 'flat' ? 'Flat' : 'Card'}, ${tokens.width} width`}
        open={open.layout === true}
        onOpen={toggle('layout')}
        onReset={() => onChange({ ...tokens, layout: defaults.layout, width: defaults.width, corners: defaults.corners, spacing: defaults.spacing })}
      >
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium uppercase tracking-wide text-faint">Style</Label>
          <Segmented
            label="Layout style"
            value={tokens.layout}
            onChange={(v) => set('layout', v)}
            options={[{ value: 'flat', label: 'Flat' }, { value: 'card', label: 'Card' }]}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium uppercase tracking-wide text-faint">Width</Label>
          <Segmented
            label="Width"
            value={tokens.width}
            onChange={(v) => set('width', v)}
            options={[{ value: 'narrow', label: 'Narrow' }, { value: 'standard', label: 'Standard' }, { value: 'wide', label: 'Wide' }]}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="theme-corners" className="text-xs font-medium uppercase tracking-wide text-faint">Corner radius (px)</Label>
          <Input
            id="theme-corners"
            type="number"
            min={0}
            max={32}
            step={1}
            aria-label="Corner radius in pixels"
            value={tokens.corners}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              if (Number.isFinite(n)) set('corners', Math.min(32, Math.max(0, n)));
            }}
            className={cn(TAP, 'w-28')}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium uppercase tracking-wide text-faint">Space around the content</Label>
          <Segmented
            label="Spacing"
            value={tokens.spacing}
            onChange={(v) => set('spacing', v)}
            options={[{ value: 'compact', label: 'Compact' }, { value: 'cozy', label: 'Cozy' }]}
          />
        </div>
      </Section>
      <Section
        title="Buttons"
        summary={`${tokens.buttons.shape}, ${tokens.buttons.size === 'sm' ? 'small' : 'medium'}`}
        open={open.buttons === true}
        onOpen={toggle('buttons')}
        onReset={() => onChange({ ...tokens, buttons: defaults.buttons })}
      >
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium uppercase tracking-wide text-faint">Style</Label>
          <Segmented
            label="Button style"
            value={tokens.buttons.fill}
            onChange={(v) => setButton('fill', v)}
            options={[{ value: 'filled', label: 'Filled' }, { value: 'outline', label: 'Outline' }]}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium uppercase tracking-wide text-faint">Shape</Label>
          <Segmented
            label="Button shape"
            value={tokens.buttons.shape}
            onChange={(v) => setButton('shape', v)}
            options={[{ value: 'square', label: 'Square' }, { value: 'rounded', label: 'Rounded' }, { value: 'pill', label: 'Pill' }]}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium uppercase tracking-wide text-faint">Size</Label>
          <Segmented
            label="Button size"
            value={tokens.buttons.size}
            onChange={(v) => setButton('size', v)}
            options={[{ value: 'sm', label: 'Small' }, { value: 'md', label: 'Medium' }]}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium uppercase tracking-wide text-faint">Width</Label>
          <Segmented
            label="Button width"
            value={tokens.buttons.width}
            onChange={(v) => setButton('width', v)}
            options={[{ value: 'auto', label: 'Fit the words' }, { value: 'full', label: 'Full' }]}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium uppercase tracking-wide text-faint">Place</Label>
          <Segmented
            label="Button place"
            value={tokens.buttons.align}
            onChange={(v) => setButton('align', v)}
            options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }]}
          />
        </div>
      </Section>
      <Section
        title="Dividers and quotes"
        summary={`${tokens.dividers} dividers, ${tokens.quotes} quotes`}
        open={open.dividers === true}
        onOpen={toggle('dividers')}
        onReset={() => onChange({ ...tokens, dividers: defaults.dividers, quotes: defaults.quotes })}
      >
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium uppercase tracking-wide text-faint">Dividers</Label>
          <Segmented
            label="Dividers"
            value={tokens.dividers}
            onChange={(v) => set('dividers', v)}
            options={[{ value: 'line', label: 'Line' }, { value: 'dots', label: 'Dots' }, { value: 'space', label: 'Space' }]}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium uppercase tracking-wide text-faint">Quotes</Label>
          <Segmented
            label="Quotes"
            value={tokens.quotes}
            onChange={(v) => set('quotes', v)}
            options={[{ value: 'bar', label: 'Bar' }, { value: 'italic', label: 'Italic' }, { value: 'box', label: 'Box' }]}
          />
        </div>
      </Section>
      <Section
        title="Footer"
        summary={`${tokens.footer} footer`}
        open={open.footer === true}
        onOpen={toggle('footer')}
        onReset={() => set('footer', defaults.footer)}
      >
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium uppercase tracking-wide text-faint">Footer style</Label>
          <Segmented
            label="Footer style"
            value={tokens.footer}
            onChange={(v) => set('footer', v)}
            options={[{ value: 'plain', label: 'Plain' }, { value: 'boxed', label: 'Boxed' }]}
          />
        </div>
        <p className="text-xs leading-relaxed text-faint">The unsubscribe link and your mailing address always sit at the bottom.</p>
      </Section>
    </div>
  );
}
