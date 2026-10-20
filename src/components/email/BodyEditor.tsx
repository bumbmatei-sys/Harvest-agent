'use client';

import { useEffect, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold, Braces, Heading1, Heading2, Heading3, Image as ImageIcon, Italic, Link2, List, ListOrdered,
  MousePointerClick, Quote, Strikethrough, Type,
} from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { TAP } from '@/components/email/kit';
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

function ToolButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={label} aria-pressed={active ?? false} onClick={onClick} className={cn(TAP, 'sm:min-h-0', active && 'bg-muted text-strong')}>
      {children}
    </Button>
  );
}

function UrlPopover({ label, icon, withLabel, onSubmit, disabled }: {
  label: string;
  icon: React.ReactNode;
  withLabel?: boolean;
  onSubmit: (url: string, text: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
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
        <Button type="button" disabled={!ok} onClick={() => { onSubmit(url, text); setOpen(false); setUrl('https://'); setText(''); }}>Add</Button>
      </PopoverContent>
    </Popover>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
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
        onSubmit={(url, text) => editor.chain().focus().insertContent(`<p><a href="${url}" data-button="true">${text.replace(/[<>&"]/g, '')}</a></p>`).run()}
      />
      <UrlPopover label="Image" icon={<ImageIcon />} onSubmit={(url) => editor.chain().focus().setImage({ src: url }).run()} />
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
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      EmailLink.configure({ openOnClick: false, autolink: false }),
      Image,
      Placeholder.configure({ placeholder: 'Write your email…' }),
    ],
    content: html,
    editorProps: { attributes: { class: 'prose prose-sm max-w-none min-h-56 px-5 py-4 text-strong outline-none', 'aria-label': 'Email body' } },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });

  // A template or a duplicate swaps the body from outside; typing never reaches this branch.
  useEffect(() => {
    if (editor && html !== editor.getHTML()) editor.commands.setContent(html, false);
  }, [html, editor]);

  if (!editor) return <div className="min-h-72" aria-busy />;
  return (
    <div>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
