'use client';

import { Node, type NodeViewProps } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { Clock, Settings2 } from 'lucide-react';

import { Segmented, TAP, type Option } from '@/components/email/kit';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import {
  ISSUE_HEADER_DEFAULTS,
  blockText,
  issueHeaderAttrs,
  safeBlockUrl,
  type IssueAlign,
  type IssueHeaderAttrs,
  type IssueSize,
  type RawIssueHeader,
} from '@/lib/email/blocks';
import { cn } from '@/lib/utils';

/**
 * The Issue header atom node. Its attributes are exactly `IssueHeaderAttrs` and
 * its serialized form is exactly the marker `render.ts` scans for
 * (`div[data-hv-block="issue-header"]` with the `data-*` fields below) — the
 * spelling lives once, here, and both directions go through blocks.ts so the
 * editor and the renderer can never disagree about a field.
 */

/** The serialized spelling shared with render.ts's block scanner. */
const DATA = {
  title: 'data-title',
  subtitle: 'data-subtitle',
  size: 'data-size',
  align: 'data-align',
  reading: 'data-reading',
  readOnline: 'data-read-online',
} as const;

function rawFrom(el: HTMLElement): RawIssueHeader {
  return {
    title: el.getAttribute(DATA.title),
    subtitle: el.getAttribute(DATA.subtitle),
    size: el.getAttribute(DATA.size),
    align: el.getAttribute(DATA.align),
    reading: el.getAttribute(DATA.reading),
    readOnline: el.getAttribute(DATA.readOnline),
  };
}

function issueDataAttrs(attrs: IssueHeaderAttrs): Record<string, string> {
  return {
    'data-hv-block': 'issue-header',
    [DATA.title]: attrs.title,
    [DATA.subtitle]: attrs.subtitle,
    [DATA.size]: attrs.size,
    [DATA.align]: attrs.align,
    [DATA.reading]: String(attrs.readingTime),
    [DATA.readOnline]: attrs.readOnline,
  };
}

/** Raw form of stored node attrs, for round-tripping through the validator. */
function rawFromNode(attrs: Record<string, unknown>): RawIssueHeader {
  return {
    title: typeof attrs.title === 'string' ? attrs.title : null,
    subtitle: typeof attrs.subtitle === 'string' ? attrs.subtitle : null,
    size: typeof attrs.size === 'string' ? attrs.size : null,
    align: typeof attrs.align === 'string' ? attrs.align : null,
    reading: attrs.readingTime ? 'true' : 'false',
    readOnline: typeof attrs.readOnline === 'string' ? attrs.readOnline : null,
  };
}

export const IssueHeaderNode = Node.create({
  name: 'issueHeader',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      title: { default: ISSUE_HEADER_DEFAULTS.title },
      subtitle: { default: ISSUE_HEADER_DEFAULTS.subtitle },
      size: { default: ISSUE_HEADER_DEFAULTS.size },
      align: { default: ISSUE_HEADER_DEFAULTS.align },
      readingTime: { default: ISSUE_HEADER_DEFAULTS.readingTime },
      readOnline: { default: ISSUE_HEADER_DEFAULTS.readOnline },
    };
  },

  parseHTML() {
    return [{
      tag: 'div[data-hv-block="issue-header"]',
      getAttrs: (el) => issueHeaderAttrs(rawFrom(el as HTMLElement)) as unknown as Record<string, unknown>,
    }];
  },

  renderHTML({ node }) {
    return ['div', issueDataAttrs(issueHeaderAttrs(rawFromNode(node.attrs)))];
  },

  addNodeView() {
    return ReactNodeViewRenderer(IssueHeaderView);
  },
});

const SIZE_PREVIEW_PX: Record<IssueSize, number> = { s: 18, m: 23, l: 28 };
const SIZE_OPTIONS: readonly Option<IssueSize>[] = [
  { value: 's', label: 'Small' },
  { value: 'm', label: 'Medium' },
  { value: 'l', label: 'Large' },
];
const ALIGN_OPTIONS: readonly Option<IssueAlign>[] = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
];

function IssueHeaderView({ node, updateAttributes, selected }: NodeViewProps) {
  const attrs = issueHeaderAttrs(rawFromNode(node.attrs));

  const commit = (next: Partial<IssueHeaderAttrs>) => {
    updateAttributes(issueHeaderAttrs({
      title: next.title ?? attrs.title,
      subtitle: next.subtitle ?? attrs.subtitle,
      size: next.size ?? attrs.size,
      align: next.align ?? attrs.align,
      reading: (next.readingTime ?? attrs.readingTime) ? 'true' : 'false',
      readOnline: next.readOnline ?? attrs.readOnline,
    }) as unknown as Record<string, unknown>);
  };

  const urlOk = attrs.readOnline === '' || safeBlockUrl(attrs.readOnline) !== '';

  return (
    <NodeViewWrapper className={cn('my-3', selected && 'ring-2 ring-brand rounded-lg')} data-testid="issue-header-block">
      <div className="rounded-lg border border-line bg-surface-raised px-5 py-4" style={{ textAlign: attrs.align }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div
              className="font-display font-semibold text-strong"
              style={{ fontSize: SIZE_PREVIEW_PX[attrs.size], lineHeight: 1.2 }}
            >
              {attrs.title || 'Issue title'}
            </div>
            {(attrs.subtitle || !attrs.title) && (
              <div className="mt-1 text-sm text-body">{attrs.subtitle || 'One line about this issue'}</div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1" style={{ justifyContent: attrs.align === 'center' ? 'center' : 'flex-start' }}>
              {attrs.readingTime && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-widest text-faint">
                  <Clock className="size-3" aria-hidden /> 1 min read
                </span>
              )}
              {attrs.readOnline !== '' && (
                <span className="text-xs text-brand underline">{urlOk ? 'Read this issue online' : 'Link needs an https address'}</span>
              )}
            </div>
          </div>
          <Popover>
            <PopoverTrigger className={cn('shrink-0 rounded-md border border-line bg-surface p-2 text-muted hover:bg-surface-gold', TAP)} aria-label="Issue header options">
              <Settings2 className="size-4" aria-hidden />
            </PopoverTrigger>
            <PopoverContent align="end" className="flex w-80 flex-col gap-3">
              <IssueHeaderFields attrs={attrs} commit={commit} urlOk={urlOk} />
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </NodeViewWrapper>
  );
}

function IssueHeaderFields({ attrs, commit, urlOk }: {
  attrs: IssueHeaderAttrs;
  commit: (next: Partial<IssueHeaderAttrs>) => void;
  urlOk: boolean;
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="issue-title">Title</Label>
        <Input id="issue-title" value={attrs.title} onChange={(e) => commit({ title: blockText(e.target.value) })} placeholder="This Sunday" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="issue-subtitle">Subtitle</Label>
        <Input id="issue-subtitle" value={attrs.subtitle} onChange={(e) => commit({ subtitle: blockText(e.target.value, 600) })} placeholder="Why we gather" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Size</Label>
          <Segmented value={attrs.size} onChange={(size) => commit({ size })} options={SIZE_OPTIONS} label="Title size" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Align</Label>
          <Segmented value={attrs.align} onChange={(align) => commit({ align })} options={ALIGN_OPTIONS} label="Alignment" />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="issue-reading">Show reading time</Label>
        <Switch id="issue-reading" checked={attrs.readingTime} onCheckedChange={(v) => commit({ readingTime: v })} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="issue-online">Read online link</Label>
        <Switch id="issue-online" checked={attrs.readOnline !== ''} onCheckedChange={(v) => commit({ readOnline: v ? 'https://' : '' })} />
      </div>
      {attrs.readOnline !== '' && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="issue-online-url">Web address</Label>
          <Input id="issue-online-url" value={attrs.readOnline} onChange={(e) => commit({ readOnline: blockText(e.target.value, 600) })} placeholder="https://" aria-invalid={!urlOk} />
          {!urlOk && <p className="text-sm text-danger">Use an https:// link.</p>}
        </div>
      )}
    </>
  );
}