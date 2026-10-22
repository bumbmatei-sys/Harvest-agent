'use client';

import { useEffect, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold, Heading2, Heading3, Image as ImageIcon, Italic, Link2, List, ListOrdered, Quote, Type,
} from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

const isHttps = (url: string): boolean => {
  try { return new URL(url).protocol === 'https:'; } catch { return false; }
};

function ToolButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={label} aria-pressed={active ?? false} onClick={onClick} className="min-h-11 aria-pressed:bg-accent aria-pressed:text-strong">
      {children}
    </Button>
  );
}

function UrlPopover({ label, icon, onSubmit }: { label: string; icon: React.ReactNode; onSubmit: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('https://');
  const bad = url !== 'https://' && !isHttps(url);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger aria-label={label} className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'min-h-11')}>
        {icon}
      </PopoverTrigger>
      <PopoverContent className="flex w-72 flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`lesson-${label}-url`}>Web address</Label>
          <Input id={`lesson-${label}-url`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" aria-invalid={bad} />
          {bad && <p className="text-xs text-danger">Use a full https:// address.</p>}
        </div>
        <Button type="button" className="min-h-11" disabled={!isHttps(url)} onClick={() => { onSubmit(url); setOpen(false); setUrl('https://'); }}>Add</Button>
      </PopoverContent>
    </Popover>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 border-b border-line px-3 py-1.5">
      <ToolButton label="Paragraph" active={editor.isActive('paragraph')} onClick={() => editor.chain().focus().setParagraph().run()}><Type /></ToolButton>
      <ToolButton label="Heading" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 /></ToolButton>
      <ToolButton label="Subheading" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 /></ToolButton>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ToolButton label="Bulleted list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List /></ToolButton>
      <ToolButton label="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered /></ToolButton>
      <ToolButton label="Quote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote /></ToolButton>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ToolButton label="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold /></ToolButton>
      <ToolButton label="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic /></ToolButton>
      <UrlPopover label="Link" icon={<Link2 />} onSubmit={(url) => editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()} />
      <UrlPopover label="Image" icon={<ImageIcon />} onSubmit={(url) => editor.chain().focus().setImage({ src: url }).run()} />
    </div>
  );
}

/** The lesson's written body: headings, lists, quotes, links and images, stored as HTML. */
export function LessonBodyEditor({ html, onChange }: { html: string; onChange: (html: string) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Link.configure({ openOnClick: false, autolink: false }),
      Image,
      Placeholder.configure({ placeholder: 'Write your lesson…' }),
    ],
    content: html,
    editorProps: { attributes: { class: 'prose max-w-none min-h-56 px-4 py-3 text-body outline-hidden', 'aria-label': 'Lesson text' } },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });

  useEffect(() => {
    if (editor && html !== editor.getHTML()) editor.commands.setContent(html, false);
  }, [html, editor]);

  if (!editor) return <div className="min-h-72" aria-busy />;
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface-raised">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
