'use client';

import { useEffect, useState } from 'react';
import { Select as SelectPrimitive } from '@base-ui/react/select';
import { ChevronDown, ChevronUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Segmented, TAP, type Option } from '@/components/email/kit';
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

/** The shadcn select parts, positioned above the design dialog's z-[102] panel. */
function ThemeSelect<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <Select value={value} onValueChange={(next) => { if (next !== null) onChange(next as T); }}>
      <SelectTrigger aria-label={label} className="min-h-11 w-36 text-xs">
        <SelectValue>{() => options.find((option) => option.value === value)?.label}</SelectValue>
      </SelectTrigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner align="end" sideOffset={6} alignItemWithTrigger={false} className="z-[103]">
          <SelectPrimitive.Popup className="min-w-36 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
            <SelectPrimitive.List>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value} className="min-h-11 px-3 text-xs sm:min-h-[38px]">{option.label}</SelectItem>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </Select>
  );
}

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
    <Collapsible open={open} onOpenChange={onOpen} className="border-t border-line first:border-t-0">
      <CollapsibleTrigger className={cn(TAP, 'flex w-full items-center gap-3 rounded-md py-3 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring')}>
        <span className="flex-1">
          <span className="block text-[13px] font-semibold leading-5 text-strong">{title}</span>
          {!open && <span className="mt-0.5 block text-[11px] leading-4 text-faint">{summary}</span>}
        </span>
        {open ? <ChevronUp className="size-4 text-faint" /> : <ChevronDown className="size-4 text-faint" />}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 pb-3 pt-1">
        {children}
        <div className="flex justify-end pt-1">
          <Button type="button" variant="ghost" size="sm" className="min-h-11 px-2 text-[11px] font-normal text-faint hover:text-strong" onClick={onReset}>
            {`Reset ${title.toLowerCase()}`}
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** A quiet label on the left, with its control aligned on the right. */
function SettingRow({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <Label htmlFor={htmlFor} className="min-w-0 flex-1 text-xs font-normal leading-5 text-body">{label}</Label>
      <div className="flex max-w-[72%] shrink-0 items-center justify-end">{children}</div>
    </div>
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
    <div className="flex min-h-11 items-center justify-between gap-2">
      <Label className="min-w-0 flex-1 text-xs font-normal leading-5 text-body">{label}</Label>
      <Button type="button" variant="ghost" size="sm" className="min-h-11 px-2 text-[11px] font-normal text-faint hover:text-strong" onClick={() => onChange(fallback)}>
        Reset
      </Button>
      <div className="relative flex w-32 shrink-0 items-center rounded-lg border border-line bg-card focus-within:ring-2 focus-within:ring-ring">
        <Input
          type="color"
          aria-label={`${label} swatch`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute left-0 size-11 w-11 min-h-11 cursor-pointer border-0 bg-transparent p-2.5 sm:min-h-[38px] [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-line"
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
          className="min-h-11 w-full border-0 bg-transparent pl-11 pr-2 font-mono text-[11px] shadow-none focus-visible:ring-0"
        />
      </div>
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
    <div className="flex flex-col [&_[data-slot=toggle-group-item]]:px-2 [&_[data-slot=toggle-group-item]]:text-xs">
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
        <SettingRow label="Heading font">
          <ThemeSelect label="Heading font" value={tokens.headingFont} onChange={(v) => set('headingFont', v)} options={FONTS} />
        </SettingRow>
        <SettingRow label="Body font">
          <ThemeSelect label="Body font" value={tokens.bodyFont} onChange={(v) => set('bodyFont', v)} options={FONTS} />
        </SettingRow>
        <SettingRow label="Text size">
          <Segmented
            label="Text size"
            value={tokens.textSize}
            onChange={(v) => set('textSize', v)}
            options={[{ value: 'small', label: 'Small' }, { value: 'regular', label: 'Regular' }, { value: 'large', label: 'Large' }]}
          />
        </SettingRow>
        <p className="py-1 text-[11px] leading-relaxed text-faint">Inboxes that cannot load a web font fall back to a close match, so the text still reads the way you wrote it.</p>
      </Section>
      <Section
        title="Header"
        summary={HEADER_LABEL[tokens.header]}
        open={open.header === true}
        onOpen={toggle('header')}
        onReset={() => onChange({ ...tokens, header: defaults.header, bannerUrl: defaults.bannerUrl })}
      >
        <SettingRow label="Top of the email">
          <ThemeSelect
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
        </SettingRow>
        {tokens.header === 'banner' && (
          <div className="flex flex-col gap-2 py-2">
            <Label htmlFor="theme-banner-url" className="text-xs font-normal text-body">Banner picture URL</Label>
            <Input
              id="theme-banner-url"
              aria-label="Banner picture URL"
              value={tokens.bannerUrl ?? ''}
              onChange={(e) => onChange({ ...tokens, bannerUrl: e.target.value.trim() || undefined })}
              placeholder="https://"
              className={TAP}
            />
            <p className="py-1 text-[11px] leading-relaxed text-faint">A wide picture, around 1200 × 400, sits across the top. With no picture yet, the email falls back to the name line.</p>
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
        <SettingRow label="Style">
          <Segmented
            label="Layout style"
            value={tokens.layout}
            onChange={(v) => set('layout', v)}
            options={[{ value: 'flat', label: 'Flat' }, { value: 'card', label: 'Card' }]}
          />
        </SettingRow>
        <SettingRow label="Width">
          <ThemeSelect
            label="Width"
            value={tokens.width}
            onChange={(v) => set('width', v)}
            options={[{ value: 'narrow', label: 'Narrow' }, { value: 'standard', label: 'Standard' }, { value: 'wide', label: 'Wide' }]}
          />
        </SettingRow>
        <SettingRow label="Corner radius (px)" htmlFor="theme-corners">
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
            className="min-h-11 w-20 text-xs"
          />
        </SettingRow>
        <SettingRow label="Space around the content">
          <Segmented
            label="Spacing"
            value={tokens.spacing}
            onChange={(v) => set('spacing', v)}
            options={[{ value: 'compact', label: 'Compact' }, { value: 'cozy', label: 'Cozy' }]}
          />
        </SettingRow>
      </Section>
      <Section
        title="Buttons"
        summary={`${tokens.buttons.shape}, ${tokens.buttons.size === 'sm' ? 'small' : 'medium'}`}
        open={open.buttons === true}
        onOpen={toggle('buttons')}
        onReset={() => onChange({ ...tokens, buttons: defaults.buttons })}
      >
        <SettingRow label="Style">
          <Segmented
            label="Button style"
            value={tokens.buttons.fill}
            onChange={(v) => setButton('fill', v)}
            options={[{ value: 'filled', label: 'Filled' }, { value: 'outline', label: 'Outline' }]}
          />
        </SettingRow>
        <SettingRow label="Shape">
          <ThemeSelect
            label="Button shape"
            value={tokens.buttons.shape}
            onChange={(v) => setButton('shape', v)}
            options={[{ value: 'square', label: 'Square' }, { value: 'rounded', label: 'Rounded' }, { value: 'pill', label: 'Pill' }]}
          />
        </SettingRow>
        <SettingRow label="Size">
          <Segmented
            label="Button size"
            value={tokens.buttons.size}
            onChange={(v) => setButton('size', v)}
            options={[{ value: 'sm', label: 'Small' }, { value: 'md', label: 'Medium' }]}
          />
        </SettingRow>
        <SettingRow label="Width">
          <Segmented
            label="Button width"
            value={tokens.buttons.width}
            onChange={(v) => setButton('width', v)}
            options={[{ value: 'auto', label: 'Fit the words' }, { value: 'full', label: 'Full' }]}
          />
        </SettingRow>
        <SettingRow label="Place">
          <Segmented
            label="Button place"
            value={tokens.buttons.align}
            onChange={(v) => setButton('align', v)}
            options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }]}
          />
        </SettingRow>
      </Section>
      <Section
        title="Dividers and quotes"
        summary={`${tokens.dividers} dividers, ${tokens.quotes} quotes`}
        open={open.dividers === true}
        onOpen={toggle('dividers')}
        onReset={() => onChange({ ...tokens, dividers: defaults.dividers, quotes: defaults.quotes })}
      >
        <SettingRow label="Dividers">
          <Segmented
            label="Dividers"
            value={tokens.dividers}
            onChange={(v) => set('dividers', v)}
            options={[{ value: 'line', label: 'Line' }, { value: 'dots', label: 'Dots' }, { value: 'space', label: 'Space' }]}
          />
        </SettingRow>
        <SettingRow label="Quotes">
          <Segmented
            label="Quotes"
            value={tokens.quotes}
            onChange={(v) => set('quotes', v)}
            options={[{ value: 'bar', label: 'Bar' }, { value: 'italic', label: 'Italic' }, { value: 'box', label: 'Box' }]}
          />
        </SettingRow>
      </Section>
      <Section
        title="Footer"
        summary={`${tokens.footer} footer`}
        open={open.footer === true}
        onOpen={toggle('footer')}
        onReset={() => set('footer', defaults.footer)}
      >
        <SettingRow label="Footer style">
          <Segmented
            label="Footer style"
            value={tokens.footer}
            onChange={(v) => set('footer', v)}
            options={[{ value: 'plain', label: 'Plain' }, { value: 'boxed', label: 'Boxed' }]}
          />
        </SettingRow>
        <p className="py-1 text-[11px] leading-relaxed text-faint">The unsubscribe link and your mailing address always sit at the bottom.</p>
      </Section>
    </div>
  );
}
