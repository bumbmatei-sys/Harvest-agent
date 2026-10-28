'use client';

import { Node, type NodeViewProps } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { Settings2 } from 'lucide-react';

import { Segmented, TAP, type Option } from '@/components/email/kit';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import {
  BOX_DEFAULTS,
  BOX_TINTS,
  blockText,
  boxAttrs,
  boxTintBase,
  safeBlockUrl,
  type BoxAttrs,
  type BoxTint,
  type BoxVariant,
  type RawBox,
} from '@/lib/email/blocks';
import { resolveTheme, type EmailThemeTokens } from '@/lib/email/themes';
import { boxFillColors, inkOn } from '@/lib/email/theme-contrast';
import { cn } from '@/lib/utils';

/**
 * The tinted Box atom node — same contract as IssueHeader: attributes are
 * exactly `BoxAttrs`, the serialized form is exactly `div[data-hv-block="box"]`
 * with the `data-*` fields render.ts scans for, and both directions go through
 * blocks.ts. A tint is stored as its key so the box re-tints with the theme.
 */

/** The serialized spelling shared with render.ts's block scanner. */
const DATA = {
  label: 'data-label',
  title: 'data-title',
  blurb: 'data-blurb',
  buttonText: 'data-button-text',
  buttonUrl: 'data-button-url',
  tint: 'data-tint',
  variant: 'data-variant',
} as const;

function rawFrom(el: HTMLElement): RawBox {
  return {
    label: el.getAttribute(DATA.label),
    title: el.getAttribute(DATA.title),
    blurb: el.getAttribute(DATA.blurb),
    buttonText: el.getAttribute(DATA.buttonText),
    buttonUrl: el.getAttribute(DATA.buttonUrl),
    tint: el.getAttribute(DATA.tint),
    variant: el.getAttribute(DATA.variant),
  };
}

function boxDataAttrs(attrs: BoxAttrs): Record<string, string> {
  return {
    'data-hv-block': 'box',
    [DATA.label]: attrs.label,
    [DATA.title]: attrs.title,
    [DATA.blurb]: attrs.blurb,
    [DATA.buttonText]: attrs.buttonText,
    [DATA.buttonUrl]: attrs.buttonUrl,
    [DATA.tint]: attrs.tint,
    [DATA.variant]: attrs.variant,
  };
}

/** Raw form of stored node attrs, for round-tripping through the validator. */
function rawFromNode(attrs: Record<string, unknown>): RawBox {
  return {
    label: typeof attrs.label === 'string' ? attrs.label : null,
    title: typeof attrs.title === 'string' ? attrs.title : null,
    blurb: typeof attrs.blurb === 'string' ? attrs.blurb : null,
    buttonText: typeof attrs.buttonText === 'string' ? attrs.buttonText : null,
    buttonUrl: typeof attrs.buttonUrl === 'string' ? attrs.buttonUrl : null,
    tint: typeof attrs.tint === 'string' ? attrs.tint : null,
    variant: typeof attrs.variant === 'string' ? attrs.variant : null,
  };
}

export const BoxNode = Node.create({
  name: 'box',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      label: { default: BOX_DEFAULTS.label },
      title: { default: BOX_DEFAULTS.title },
      blurb: { default: BOX_DEFAULTS.blurb },
      buttonText: { default: BOX_DEFAULTS.buttonText },
      buttonUrl: { default: BOX_DEFAULTS.buttonUrl },
      tint: { default: BOX_DEFAULTS.tint },
      variant: { default: BOX_DEFAULTS.variant },
    };
  },

  parseHTML() {
    return [{
      tag: 'div[data-hv-block="box"]',
      getAttrs: (el) => boxAttrs(rawFrom(el as HTMLElement)) as unknown as Record<string, unknown>,
    }];
  },

  renderHTML({ node }) {
    return ['div', boxDataAttrs(boxAttrs(rawFromNode(node.attrs)))];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BoxView);
  },
});

/**
 * Swatch colours for the editor preview. The stand-in tokens are the Letter
 * preset's — the email itself re-tints against whatever theme is active.
 */
const EDITOR_TOKENS: EmailThemeTokens = resolveTheme({ themeId: 'letter' }).tokens;
const swatchColor = (tint: BoxTint): string => boxTintBase(tint, EDITOR_TOKENS);
/** The Letter stand-in's own button scheme, for the shared Box derivation below. */
const EDITOR_BUTTON = {
  heading: EDITOR_TOKENS.heading,
  ink: EDITOR_TOKENS.text,
  buttonBg: EDITOR_TOKENS.accent,
  buttonInk: inkOn(EDITOR_TOKENS.accent),
} as const;
const VARIANT_OPTIONS: readonly Option<BoxVariant>[] = [
  { value: 'filled', label: 'Filled' },
  { value: 'outline', label: 'Outline' },
];

function BoxView({ node, updateAttributes, selected }: NodeViewProps) {
  const attrs = boxAttrs(rawFromNode(node.attrs));

  const commit = (next: Partial<BoxAttrs>) => {
    updateAttributes(boxAttrs({
      label: next.label ?? attrs.label,
      title: next.title ?? attrs.title,
      blurb: next.blurb ?? attrs.blurb,
      buttonText: next.buttonText ?? attrs.buttonText,
      buttonUrl: next.buttonUrl ?? attrs.buttonUrl,
      tint: next.tint ?? attrs.tint,
      variant: next.variant ?? attrs.variant,
    }) as unknown as Record<string, unknown>);
  };

  const urlOk = attrs.buttonUrl === '' || safeBlockUrl(attrs.buttonUrl) !== '';
  const tint = swatchColor(attrs.tint);
  const filled = attrs.variant === 'filled';
  // The same derivation the email renderer's boxHtml uses (theme-contrast's
  // boxFillColors — one copy of the maths), so a filled Box draws the colours
  // here that the sent email will draw: readable inks against the actual fill,
  // and a chip button when the theme's button ground would vanish into it.
  const box = filled ? boxFillColors(tint, EDITOR_TOKENS.card, EDITOR_BUTTON, true) : null;

  return (
    <NodeViewWrapper className={cn('my-5 rounded-xl', selected && 'ring-2 ring-brand')} data-testid="box-block">
      <div
        className="relative rounded-xl px-5 py-5 sm:px-6 sm:py-6"
        style={box
          ? { background: box.fill, border: `1px solid ${box.border}` }
          : { background: 'transparent', border: `1px solid ${tint}` }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 pr-8">
            {attrs.label && (
              <div
                className={cn('text-[11px] font-semibold uppercase tracking-widest', !box && 'text-faint')}
                style={box ? { color: box.label } : undefined}
              >
                {attrs.label}
              </div>
            )}
            <div
              className={cn('mt-2 font-display text-2xl font-semibold leading-tight tracking-tight', !box && 'text-strong')}
              style={box ? { color: box.title } : undefined}
            >
              {attrs.title || 'Box title'}
            </div>
            {(attrs.blurb || !attrs.title) && (
              <div className={cn('mt-2 text-sm leading-relaxed', !box && 'text-body')} style={box ? { color: box.blurb } : undefined}>
                {attrs.blurb || 'A short line about this.'}
              </div>
            )}
            {attrs.buttonText && (
              <span
                className={cn('mt-4 inline-block rounded-lg px-4 py-2.5 text-xs font-semibold', !box && 'bg-brand text-white')}
                style={box ? { backgroundColor: box.buttonBg, color: box.buttonInk } : undefined}
              >
                {attrs.buttonText}
              </span>
            )}
            {attrs.buttonText && !urlOk && <span className="mt-3 ml-2 text-xs text-danger">Button link needs an https address</span>}
          </div>
          <Popover>
            <PopoverTrigger className={cn('absolute right-2 top-2 flex min-w-11 items-center justify-center rounded-lg border border-line bg-card text-muted hover:bg-surface-gold', TAP)} aria-label="Box options">
              <Settings2 className="size-4" aria-hidden />
            </PopoverTrigger>
            <PopoverContent align="end" className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-4 rounded-xl p-4">
              <BoxFields attrs={attrs} commit={commit} urlOk={urlOk} />
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </NodeViewWrapper>
  );
}

function BoxFields({ attrs, commit, urlOk }: {
  attrs: BoxAttrs;
  commit: (next: Partial<BoxAttrs>) => void;
  urlOk: boolean;
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="box-label">Label</Label>
        <Input id="box-label" value={attrs.label} onChange={(e) => commit({ label: blockText(e.target.value, 120) })} placeholder="Give" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="box-title">Title</Label>
        <Input id="box-title" value={attrs.title} onChange={(e) => commit({ title: blockText(e.target.value) })} placeholder="Sunday supper" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="box-blurb">Blurb</Label>
        <Textarea id="box-blurb" value={attrs.blurb} onChange={(e) => commit({ blurb: blockText(e.target.value, 1000) })} placeholder="Bring a friend." rows={3} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="box-button-text">Button text</Label>
        <Input id="box-button-text" value={attrs.buttonText} onChange={(e) => commit({ buttonText: blockText(e.target.value, 120) })} placeholder="Reserve a seat" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="box-button-url">Button link</Label>
        <Input id="box-button-url" value={attrs.buttonUrl} onChange={(e) => commit({ buttonUrl: blockText(e.target.value, 600) })} placeholder="https://" aria-invalid={!urlOk} />
        {!urlOk && <p className="text-sm text-danger">Use an https:// link.</p>}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Tint</Label>
        <div role="radiogroup" aria-label="Box tint" className="flex flex-wrap gap-2">
          {BOX_TINTS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="radio"
              aria-checked={attrs.tint === t.key}
              aria-label={t.label}
              title={t.label}
              onClick={() => commit({ tint: t.key as BoxTint })}
              className={cn('size-9 rounded-full border-2', TAP, attrs.tint === t.key ? 'border-strong ring-2 ring-brand' : 'border-line')}
              style={{ background: swatchColor(t.key) }}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Style</Label>
        <Segmented value={attrs.variant} onChange={(variant) => commit({ variant })} options={VARIANT_OPTIONS} label="Box style" />
      </div>
    </>
  );
}