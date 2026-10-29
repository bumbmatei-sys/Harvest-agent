'use client';

import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { Extension, type Range } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion';
import {
  Bold, Braces, Box as BoxIcon, Heading1, Heading2, Heading3, Image as ImageIcon, Italic, Link2, List, ListOrdered,
  MousePointerClick, Newspaper, Quote, Strikethrough, Type,
} from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Command, CommandItem, CommandList } from '@/components/ui/command';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { IssueHeaderNode } from '@/components/email/blocks/IssueHeader';
import { BoxNode } from '@/components/email/blocks/Box';
import { TAP } from '@/components/email/kit';
import { BOX_DEFAULTS, ISSUE_HEADER_DEFAULTS } from '@/lib/email/blocks';
import { cn } from '@/lib/utils';

/** A link that renders as a button in the email. The server's sanitizer keeps `data-button`. */
const EmailLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      'data-button': {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-button'),
        renderHTML: (attrs: Record<string, unknown>) => (attrs['data-button'] ? { 'data-button': 'true' } : {}),
      },
    };
  },
});

const FILL_INS = [
  { label: 'First name', tag: '{{first_name}}' },
  { label: 'Your name', tag: '{{sender_name}}' },
] as const;

function isHttps(url: string): boolean {
  try { return new URL(url).protocol === 'https:'; } catch { return false; }
}

/* ── Slash menu ──────────────────────────────────────────────────────────── */

interface SlashItem {
  readonly key: string;
  readonly title: string;
  readonly icon: typeof Type;
  readonly run: (editor: Editor, range: Range, hooks: SlashHooks) => void;
}

/** What a slash item needs from the editor shell (opening the URL popovers). */
interface SlashHooks {
  openPopover: (kind: 'button' | 'image') => void;
}

type OpenPopover = 'button' | 'image' | null;

/** Everything the toolbar can insert at block level, plus the two email blocks. */
const SLASH_ITEMS: readonly SlashItem[] = [
  { key: 'text', title: 'Text', icon: Type, run: (e, range) => e.chain().focus().deleteRange(range).setParagraph().run() },
  { key: 'h1', title: 'Heading 1', icon: Heading1, run: (e, range) => e.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run() },
  { key: 'h2', title: 'Heading 2', icon: Heading2, run: (e, range) => e.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run() },
  { key: 'h3', title: 'Heading 3', icon: Heading3, run: (e, range) => e.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run() },
  { key: 'bulleted', title: 'Bulleted list', icon: List, run: (e, range) => e.chain().focus().deleteRange(range).toggleBulletList().run() },
  { key: 'numbered', title: 'Numbered list', icon: ListOrdered, run: (e, range) => e.chain().focus().deleteRange(range).toggleOrderedList().run() },
  { key: 'quote', title: 'Quote', icon: Quote, run: (e, range) => e.chain().focus().deleteRange(range).toggleBlockquote().run() },
  {
    key: 'button',
    title: 'Button',
    icon: MousePointerClick,
    run: (e, range, hooks) => { e.chain().focus().deleteRange(range).run(); hooks.openPopover('button'); },
  },
  {
    key: 'image',
    title: 'Image',
    icon: ImageIcon,
    run: (e, range, hooks) => { e.chain().focus().deleteRange(range).run(); hooks.openPopover('image'); },
  },
  {
    key: 'issue-header',
    title: 'Issue header',
    icon: Newspaper,
    run: (e, range) => e.chain().focus().deleteRange(range).insertContent({ type: IssueHeaderNode.name, attrs: { ...ISSUE_HEADER_DEFAULTS } }).run(),
  },
  {
    key: 'box',
    title: 'Box',
    icon: BoxIcon,
    run: (e, range) => e.chain().focus().deleteRange(range).insertContent({ type: BoxNode.name, attrs: { ...BOX_DEFAULTS } }).run(),
  },
];

/** Live state of the open menu; the plugin writes it, React renders it. */
interface SlashState {
  items: SlashItem[];
  index: number;
  rect: DOMRect | null;
  run: (item: SlashItem) => void;
}

function createSlashExtension(ctrl: { current: SlashState | null }, sync: (state: SlashState | null) => void, hooks: SlashHooks) {
  // Escape dismisses the suggestion, not just its React menu. A fresh slash
  // key re-arms it; query edits, cursor moves and backspace do not.
  let dismissed = false;
  return Extension.create({
    name: 'slashMenu',
    addKeyboardShortcuts() {
      return {
        '/': () => { dismissed = false; return false; },
      };
    },
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem>({
          editor: this.editor,
          char: '/',
          allow: () => !dismissed,
          items: ({ query }) => {
            const q = query.trim().toLowerCase();
            return SLASH_ITEMS.filter((i) => i.title.toLowerCase().includes(q));
          },
          command: ({ editor, range, props }) => props.run(editor, range, hooks),
          render: () => {
            const update = (props: SuggestionProps<SlashItem>) => {
              if (dismissed) return;
              const state: SlashState = {
                items: props.items,
                index: 0,
                rect: props.clientRect ? props.clientRect() : null,
                run: (item) => props.command(item),
              };
              ctrl.current = state;
              sync(state);
            };
            return {
              onStart: update,
              onUpdate: update,
              onKeyDown: ({ event }: SuggestionKeyDownProps) => {
                if (event.key === 'Escape' && ctrl.current) dismissed = true;
                return handleSlashKey(event, ctrl, sync);
              },
              onExit: () => {
                ctrl.current = null;
                sync(null);
              },
            };
          },
        }),
      ];
    },
  });
}

function handleSlashKey(event: KeyboardEvent, ctrl: { current: SlashState | null }, sync: (state: SlashState | null) => void): boolean {
  const state = ctrl.current;
  if (!state) return false;
  if (event.key === 'Escape') {
    ctrl.current = null;
    sync(null);
    return true;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!state.items.length) return true;
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const next = { ...state, index: (state.index + delta + state.items.length) % state.items.length };
    ctrl.current = next;
    sync(next);
    return true;
  }
  if (event.key === 'Enter' || event.key === 'Tab') {
    const item = state.items[state.index];
    if (!item) return false;
    state.run(item);
    return true;
  }
  return false;
}

function ToolButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={label} aria-pressed={active ?? false} onClick={onClick} className="min-h-11 aria-pressed:bg-accent aria-pressed:text-strong">
      {children}
    </Button>
  );
}

function UrlPopover({ label, icon, withLabel, onSubmit, disabled, open: openProp, onOpenChange }: {
  label: string;
  icon: React.ReactNode;
  withLabel?: boolean;
  onSubmit: (url: string, text: string) => void;
  disabled?: boolean;
  /** Controlled opening (the "/" menu opens these); uncontrolled when absent. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const [url, setUrl] = useState('https://');
  const [text, setText] = useState('');
  const ok = isHttps(url) && (!withLabel || text.trim() !== '');
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger disabled={disabled} aria-label={label} className={cn(buttonVariants({ variant: 'ghost', size: withLabel ? 'sm' : 'icon-sm' }), TAP, 'sm:min-h-0')}>
        {icon}{withLabel && <span>{label}</span>}
      </PopoverTrigger>
      <PopoverContent className="flex w-72 flex-col gap-3">
        {withLabel && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${label}-text`}>Button text</Label>
            <Input id={`${label}-text`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Reserve your seat" />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${label}-url`}>Web address</Label>
          <Input id={`${label}-url`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" aria-invalid={url !== 'https://' && !isHttps(url)} />
          {url !== 'https://' && !isHttps(url) && <p className="text-xs text-danger">Use a full https:// address.</p>}
        </div>
        <Button type="button" className="min-h-11" disabled={!ok} onClick={() => { onSubmit(url, text); setOpen(false); setUrl('https://'); setText(''); }}>Add</Button>
      </PopoverContent>
    </Popover>
  );
}

function Toolbar({ editor, popover, setPopover }: {
  editor: Editor;
  popover: OpenPopover;
  setPopover: (next: OpenPopover) => void;
}) {
  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 border-b border-line px-5 py-2">
      <ToolButton label="Paragraph" active={editor.isActive('paragraph')} onClick={() => editor.chain().focus().setParagraph().run()}><Type /></ToolButton>
      <ToolButton label="Heading 1" active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 /></ToolButton>
      <ToolButton label="Heading 2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 /></ToolButton>
      <ToolButton label="Heading 3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 /></ToolButton>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ToolButton label="Bulleted list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List /></ToolButton>
      <ToolButton label="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered /></ToolButton>
      <ToolButton label="Quote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote /></ToolButton>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ToolButton label="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold /></ToolButton>
      <ToolButton label="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic /></ToolButton>
      <ToolButton label="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough /></ToolButton>
      <UrlPopover label="Link" icon={<Link2 />} onSubmit={(url) => editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()} />
      <Separator orientation="vertical" className="mx-1 h-5" />
      <UrlPopover
        label="Button"
        icon={<MousePointerClick />}
        withLabel
        open={popover === 'button'}
        onOpenChange={(next) => setPopover(next ? 'button' : null)}
        onSubmit={(url, text) => editor.chain().focus().insertContent(`<p><a href="${url}" data-button="true">${text.replace(/[<>&"]/g, '')}</a></p>`).run()}
      />
      <UrlPopover
        label="Image"
        icon={<ImageIcon />}
        open={popover === 'image'}
        onOpenChange={(next) => setPopover(next ? 'image' : null)}
        onSubmit={(url) => editor.chain().focus().setImage({ src: url }).run()}
      />
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="Add a fill-in" className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), TAP, 'sm:min-h-0')}>
          <Braces />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {FILL_INS.map((f) => (
            <DropdownMenuItem key={f.tag} onClick={() => editor.chain().focus().insertContent(f.tag).run()}>{f.label}</DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function BodyEditor({ html, onChange }: { html: string; onChange: (html: string) => void }) {
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [popover, setPopover] = useState<OpenPopover>(null);
  const slashCtrl = useRef<SlashState | null>(null);
  const slashExtension = useRef(createSlashExtension(slashCtrl, setSlash, { openPopover: setPopover })).current;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      EmailLink.configure({ openOnClick: false, autolink: false }),
      Image,
      IssueHeaderNode,
      BoxNode,
      slashExtension,
      Placeholder.configure({ placeholder: 'Write your email…' }),
    ],
    content: html,
    editorProps: { attributes: { class: 'prose prose-sm max-w-none min-h-56 px-5 py-4 text-strong outline-hidden', 'aria-label': 'Email body' } },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });

  // A template or a duplicate swaps the body from outside; typing never reaches this branch.
  useEffect(() => {
    if (editor && html !== editor.getHTML()) editor.commands.setContent(html, false);
  }, [html, editor]);

  if (!editor) return <div className="min-h-72" aria-busy />;
  return (
    <div>
      <Toolbar editor={editor} popover={popover} setPopover={setPopover} />
      <EditorContent editor={editor} />
      {slash && slash.items.length > 0 && (
        <SlashMenu
          state={slash}
          onPick={(item) => slash.run(item)}
          onHover={(index) => {
            const next = { ...slash, index };
            slashCtrl.current = next;
            setSlash(next);
          }}
        />
      )}
    </div>
  );
}

/** The "/" menu: a shadcn command list pinned under the typed slash. */
function SlashMenu({ state, onPick, onHover }: {
  state: SlashState;
  onPick: (item: SlashItem) => void;
  onHover: (index: number) => void;
}) {
  const top = state.rect ? state.rect.bottom + 6 : 0;
  const left = state.rect ? state.rect.left : 0;
  return (
    <div className="fixed z-50 max-w-[calc(100vw-2rem)]" style={{ left, top }} role="listbox" aria-label="Insert block">
      <Command className="w-64 max-w-full rounded-xl border border-line bg-card p-1.5 shadow-lg" shouldFilter={false}>
        <CommandList className="max-h-72 scroll-py-1">
          {state.items.map((item, index) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.key}
                value={item.title}
                aria-selected={index === state.index}
                onMouseMove={() => onHover(index)}
                onSelect={() => onPick(item)}
                className={cn('min-h-11 gap-3 rounded-lg px-2.5 py-2 text-xs text-body sm:min-h-[38px]', index === state.index && 'bg-surface-sunken text-strong')}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-card text-muted"><Icon className="size-3.5" aria-hidden /></span>
                <span className="font-medium">{item.title}</span>
              </CommandItem>
            );
          })}
        </CommandList>
      </Command>
    </div>
  );
}
