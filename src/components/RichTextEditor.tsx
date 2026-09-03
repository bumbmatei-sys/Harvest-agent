"use client";
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { isSafeUrl } from '../utils/sanitize';
import { useEditor, EditorContent, ReactRenderer, BubbleMenu } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import Suggestion from '@tiptap/suggestion';
import { Extension } from '@tiptap/core';
import {
  Heading1, Heading2, List, ListOrdered, Quote, Code,
  Minus, Bold, Italic, Link as LinkIcon, Image as ImageIcon,
  Type, Strikethrough, Underline as UnderlineIcon,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Upload, X, Loader2
} from 'lucide-react';
import { auth } from '../firebase';
import RichTextToolbar, { type ToolbarItem } from './editor/RichTextToolbar';

/**
 * The prose ramp every editor in the app has had, unchanged.
 *
 * `xl:prose-2xl` is a 1.5rem base above 1280px, which is a deliberate reading
 * size for long-form writing and the wrong one for a dense screen. Named so the
 * default is a value with a reason rather than a string nobody can question.
 */
export const DEFAULT_PROSE_CLASS = 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl';

/**
 * A document-sized body, for screens that are not documents.
 *
 * Flat — no responsive step — because the reason the ramp exists (a line of
 * prose growing with the window) does not apply to a pane beside a tree. 13px
 * at `prose-sm`'s 0.875rem against the 14.5px desktop rem base.
 */
export const COMPACT_PROSE_CLASS = 'prose prose-sm';

interface RichTextEditorProps {
  content: string;
  onChange: (content: string) => void;
  minHeight?: string;
  placeholder?: string;
  /**
   * The prose classes on the editor body.
   *
   * Defaults to the responsive ramp every caller has always had. That ramp ends
   * at `xl:prose-2xl`, whose base is 1.5rem — fine for a blog post being written
   * at reading size, far too big for a notes app, where it rendered the body and
   * its placeholder at 24px on any monitor. A caller whose measure is not a
   * document's passes its own instead of every screen inheriting one screen's.
   */
  proseClass?: string;
}

interface CommandItem {
  title: string;
  description: string;
  icon: React.ReactNode;
  action: (editor: any, showModal?: () => void) => void;
}

// ─── Inline Image Upload Modal ────────────────────────────────────

const ImageUploadModal = ({
  onClose,
  onInsert,
}: {
  onClose: () => void;
  onInsert: (url: string) => void;
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        setError('You must be signed in to upload images.');
        return;
      }

      // 1. Ask our API for a short-lived presigned R2 PUT URL.
      const presignRes = await fetch('/api/storage/presign', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
          fileSize: file.size,
        }),
      });
      if (!presignRes.ok) {
        const data = await presignRes.json().catch(() => ({}));
        throw new Error(data.error || 'Upload failed');
      }
      const { uploadUrl, publicUrl } = await presignRes.json();

      // 2. Upload the file bytes directly to R2.
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });
      if (!putRes.ok) throw new Error('Upload failed');

      // 3. Insert the public URL.
      onInsert(publicUrl);
    } catch (err: any) {
      setError(err?.message || 'Upload failed. Try again.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-surface-raised rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 pb-8 sm:pb-5 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-bold text-strong">Add Image</h3>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-surface-sunken text-faint hover:text-body">
            <X size={18} />
          </button>
        </div>

        {error && <div className="bg-red-50 text-red-600 p-2.5 rounded-lg text-sm">{error}</div>}

        <div>
          <div
            onClick={() => !isUploading && fileInputRef.current?.click()}
            className="w-full h-40 rounded-xl border-2 border-dashed border-line-strong bg-surface-tint flex flex-col items-center justify-center text-muted hover:bg-surface-sunken hover:border-gold transition-colors cursor-pointer"
          >
            {isUploading ? (
              <>
                <Loader2 size={28} className="animate-spin mb-2 text-gold" />
                <span className="text-sm font-medium text-body">Uploading...</span>
              </>
            ) : (
              <>
                <Upload size={28} className="mb-2" />
                <span className="text-sm font-medium">Tap to upload</span>
                <span className="text-xs text-faint mt-1">PNG, JPG, GIF up to 4MB</span>
              </>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUpload} className="hidden" />
        </div>
      </div>
    </div>
  );
};

// ─── Command definitions ──────────────────────────────────────────

/**
 * The command vocabulary, shared by BOTH menus.
 *
 * 🔴 `export` is the ONLY thing THE-279 changed here — every entry below is
 * byte-identical. The toolbar RENDERS this array rather than mirroring it,
 * which is what makes "the toolbar can never do less than `/`" structural
 * instead of a promise two lists have to keep.
 */
export const commands: CommandItem[] = [
  {
    title: 'Heading 1',
    description: 'Large heading',
    icon: <Heading1 size={18} />,
    action: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    title: 'Heading 2',
    description: 'Medium heading',
    icon: <Heading2 size={18} />,
    action: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    title: 'Paragraph',
    description: 'Normal text',
    icon: <Type size={18} />,
    action: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    title: 'Bold',
    description: 'Bold text',
    icon: <Bold size={18} />,
    action: (editor) => editor.chain().focus().toggleBold().run(),
  },
  {
    title: 'Italic',
    description: 'Italic text',
    icon: <Italic size={18} />,
    action: (editor) => editor.chain().focus().toggleItalic().run(),
  },
  {
    title: 'Underline',
    description: 'Underline text',
    icon: <UnderlineIcon size={18} />,
    action: (editor) => editor.chain().focus().toggleUnderline().run(),
  },
  {
    title: 'Strikethrough',
    description: 'Strikethrough text',
    icon: <Strikethrough size={18} />,
    action: (editor) => editor.chain().focus().toggleStrike().run(),
  },
  {
    title: 'Bullet List',
    description: 'Unordered list',
    icon: <List size={18} />,
    action: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    title: 'Numbered List',
    description: 'Ordered list',
    icon: <ListOrdered size={18} />,
    action: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    title: 'Quote',
    description: 'Blockquote',
    icon: <Quote size={18} />,
    action: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    title: 'Code Block',
    description: 'Code snippet',
    icon: <Code size={18} />,
    action: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    title: 'Divider',
    description: 'Horizontal line',
    icon: <Minus size={18} />,
    action: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    title: 'Link',
    description: 'Add a link',
    icon: <LinkIcon size={18} />,
    action: (editor) => {
      const url = window.prompt('Enter URL');
      if (url && isSafeUrl(url)) {
        editor.chain().focus().setLink({ href: url }).run();
      }
    },
  },
  {
    title: 'Image',
    description: 'Upload an image',
    icon: <ImageIcon size={18} />,
    action: (_editor: any, openModal?: () => void) => {
      openModal?.();
    },
  },
];

/**
 * Alignment — the one command the toolbar adds.
 *
 * 🔴 REPORTED AS REQUIRED (STOP 2): the only toolbar command with no
 * pre-existing `chain()` call. `@tiptap/extension-text-align` has been a
 * dependency all along, configured in THREE files (here, NewsletterEditor,
 * TipTapReadOnly), while `setTextAlign` appeared ZERO times in `src/`.
 *
 * ⚠️ The read-only renderer decided it, not the dependency. TipTapReadOnly's own
 * comment promises alignment "renders faithfully" on the member side — true of
 * the renderer, unreachable in practice, since nothing could author it.
 * Removing it (#418's `next-themes` treatment) meant deleting it from that
 * renderer too and making the promise false for content that already carries
 * alignment. Opposite call from #418 for the opposite reason: that was a second
 * theme system competing with the app's own; this is a capability with no
 * competitor and no UI. All four defaults are wired, because offering three of
 * a configured four is the same small lie.
 */
export const ALIGN_COMMANDS: CommandItem[] = [
  {
    title: 'Align Left',
    description: 'Align text left',
    icon: <AlignLeft size={18} />,
    action: (editor) => editor.chain().focus().setTextAlign('left').run(),
  },
  {
    title: 'Align Center',
    description: 'Centre text',
    icon: <AlignCenter size={18} />,
    action: (editor) => editor.chain().focus().setTextAlign('center').run(),
  },
  {
    title: 'Align Right',
    description: 'Align text right',
    icon: <AlignRight size={18} />,
    action: (editor) => editor.chain().focus().setTextAlign('right').run(),
  },
  {
    title: 'Justify',
    description: 'Justify text',
    icon: <AlignJustify size={18} />,
    action: (editor) => editor.chain().focus().setTextAlign('justify').run(),
  },
];

/**
 * Whether a command CAN apply to the current selection, by title.
 *
 * 🔴 One entry, and it removes a silent failure rather than adding a feature.
 * `applyLink` needs a selection or a caret already in a link; with neither it
 * marks a zero-width range and the tap does nothing. Invisible before, because
 * the only way in was the `BubbleMenu`, which renders ONLY on a selection.
 *
 * ⚠️ A state query like COMMAND_ACTIVE, NOT a new command — `applyLink` is
 * byte-identical. (`/link` has the same constraint and no guard; pre-existing,
 * unreachable from the toolbar, reported rather than changed here.)
 */
export const COMMAND_ENABLED: Record<string, (editor: any) => boolean> = {
  Link: (e) => !e.state.selection.empty || e.isActive('link'),
};

/** Shown in place of the hint when COMMAND_ENABLED says no. */
export const DISABLED_REASON: Record<string, string> = {
  Link: 'select the text you want to link first',
};

/**
 * Whether the caret already sits inside what a command applies, by title.
 *
 * STATE QUERIES, not commands — `isActive` mutates nothing. They live here
 * rather than in the toolbar so RichTextToolbar.tsx stays free of every TipTap
 * name and cannot hold a second implementation of one. Same call the bubble
 * menu has made inline since it was written, named once per command.
 *
 * A title with no entry has no active state, which is right for the ones that
 * INSERT rather than toggle (Divider, Image).
 */
export const COMMAND_ACTIVE: Record<string, (editor: any) => boolean> = {
  'Heading 1': (e) => e.isActive('heading', { level: 1 }),
  'Heading 2': (e) => e.isActive('heading', { level: 2 }),
  Paragraph: (e) => e.isActive('paragraph'),
  Bold: (e) => e.isActive('bold'),
  Italic: (e) => e.isActive('italic'),
  Underline: (e) => e.isActive('underline'),
  Strikethrough: (e) => e.isActive('strike'),
  'Bullet List': (e) => e.isActive('bulletList'),
  'Numbered List': (e) => e.isActive('orderedList'),
  Quote: (e) => e.isActive('blockquote'),
  'Code Block': (e) => e.isActive('codeBlock'),
  Link: (e) => e.isActive('link'),
  'Align Left': (e) => e.isActive({ textAlign: 'left' }),
  'Align Center': (e) => e.isActive({ textAlign: 'center' }),
  'Align Right': (e) => e.isActive({ textAlign: 'right' }),
  Justify: (e) => e.isActive({ textAlign: 'justify' }),
};

// ─── Slash command extension ──────────────────────────────────────

const SlashCommand = Extension.create({
  name: 'slashCommand',
  addOptions() {
    return {
      suggestion: {
        char: '/',
        command: ({ editor, range, props }: any) => {
          editor.chain().deleteRange(range).run();
          props.action(editor);
        },
      },
    };
  },
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});

// ─── Slash Command Menu (pure display component) ──────────────────

const SlashCommandList = ({
  items,
  command,
  selectedIndex = 0,
}: {
  items: CommandItem[];
  command: (item: CommandItem) => void;
  selectedIndex?: number;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current?.children[selectedIndex] as HTMLElement;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (items.length === 0) {
    return <div className="p-3 text-sm text-faint">No commands found</div>;
  }

  return (
    <div
      ref={containerRef}
      className="bg-surface-raised rounded-xl shadow-xl border border-line overflow-hidden max-h-[320px] overflow-y-auto w-72"
    >
      <div className="p-1.5">
        {items.map((item, index) => (
          <button
            key={item.title}
            onMouseDown={(e) => {
              e.preventDefault();
              command(item);
            }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
              index === selectedIndex
                ? 'bg-[color-mix(in_srgb,var(--brand-color)_10%,transparent)] text-strong'
                : 'text-body hover:bg-surface-tint'
            }`}
          >
            <div
              className={`flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border ${
                index === selectedIndex
                  ? 'border-gold bg-[color-mix(in_srgb,var(--brand-color)_5%,transparent)] text-gold'
                  : 'border-line bg-surface-tint text-muted'
              }`}
            >
              {item.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{item.title}</div>
              <div className="text-xs text-faint">{item.description}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

// ─── Suggestion render config ─────────────────────────────────────

const renderSlashCommands = () => {
  let component: ReactRenderer | null = null;
  let popup: HTMLElement | null = null;
  let selectedIndex = 0;
  let currentItems: CommandItem[] = [];
  let currentCommand: ((item: CommandItem) => void) | null = null;

  const positionPopup = (el: HTMLElement, rect: DOMRect) => {
    const POPUP_HEIGHT = 340;
    const POPUP_WIDTH = 288;
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < POPUP_HEIGHT && rect.top > POPUP_HEIGHT) {
      el.style.top = `${rect.top - 8}px`;
      el.style.transform = 'translateY(-100%)';
    } else {
      el.style.top = `${rect.bottom + 8}px`;
      el.style.transform = 'none';
    }
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - POPUP_WIDTH - 8);
    el.style.left = `${left}px`;
  };

  const updateSelection = (index: number) => {
    selectedIndex = index;
    component?.updateProps({
      items: currentItems,
      command: currentCommand,
      selectedIndex,
    });
  };

  return {
    onStart: (props: any) => {
      selectedIndex = 0;
      currentItems = props.items || [];
      currentCommand = props.command;

      component = new ReactRenderer(SlashCommandList, {
        props: {
          items: currentItems,
          command: currentCommand,
          selectedIndex,
        },
        editor: props.editor,
      });

      popup = document.createElement('div');
      popup.style.position = 'fixed';
      popup.style.zIndex = '9999';
      document.body.appendChild(popup);
      popup.appendChild(component.element);

      const rect = props.clientRect?.();
      if (rect) positionPopup(popup, rect);
    },

    onUpdate: (props: any) => {
      currentItems = props.items || [];
      currentCommand = props.command;
      component?.updateProps({
        items: currentItems,
        command: currentCommand,
        selectedIndex,
      });
      const rect = props.clientRect?.();
      if (rect && popup) positionPopup(popup, rect);
    },

    onKeyDown: (props: any) => {
      const { event } = props;
      if (event.key === 'Escape') {
        popup?.remove();
        popup = null;
        component?.destroy();
        component = null;
        return true;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (currentItems.length > 0) {
          updateSelection((selectedIndex + currentItems.length - 1) % currentItems.length);
        }
        return true;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (currentItems.length > 0) {
          updateSelection((selectedIndex + 1) % currentItems.length);
        }
        return true;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (currentItems[selectedIndex] && currentCommand) {
          currentCommand(currentItems[selectedIndex]);
        }
        return true;
      }
      return false;
    },

    onExit: () => {
      popup?.remove();
      popup = null;
      component?.destroy();
      component = null;
    },
  };
};

// ─── Link editor row (one implementation, two surfaces) ───────────

/**
 * The inline link editor, so the bubble menu and the toolbar mount the SAME
 * control rather than each growing one.
 *
 * 🔴 THE SECURITY-RELEVANT PATH, and why this is a component and not a copy.
 * `applyLink` — passed in, never reimplemented — runs `isSafeUrl()` before
 * `setLink`. A toolbar with its own input would have grown its own apply
 * handler, which is exactly where the check goes missing.
 *
 * ⚠️ The ground-dependent classes are PROPS, not a tone lookup:
 * `theming-colour-maps.test.ts` rightly refused that shape (THE-136). Listing
 * it in its `SURFACES` was the cheap remedy, not the right one — those are
 * badges whose contrast is computed against the card, and the dark branch here
 * sits on the bubble's chip. So each call site spells its own ground.
 */
const LinkEditorRow = ({
  inputClass,
  removeClass,
  inputRef,
  linkUrl,
  setLinkUrl,
  applyLink,
  removeLink,
  onCancel,
  showRemove,
}: {
  /** Fill and ink for the URL field, chosen by the ground this row sits on. */
  inputClass: string;
  /** Ink for the destructive "remove link" control, likewise. */
  removeClass: string;
  inputRef: React.RefObject<HTMLInputElement>;
  linkUrl: string;
  setLinkUrl: (v: string) => void;
  applyLink: () => void;
  removeLink: () => void;
  onCancel: () => void;
  showRemove: boolean;
}) => (
  <div className="flex items-center gap-1.5 p-1.5">
    <input
      ref={inputRef}
      type="url"
      value={linkUrl}
      onChange={(e) => setLinkUrl(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
        if (e.key === 'Escape') { onCancel(); }
      }}
      placeholder="https://..."
      aria-label="Link URL"
      className={`w-40 sm:w-56 px-2.5 py-1.5 text-sm border-0 rounded-lg focus:ring-2 focus:ring-gold outline-hidden ${inputClass}`}
    />
    <button
      type="button"
      aria-label="Apply link"
      onMouseDown={(e) => { e.preventDefault(); applyLink(); }}
      className="px-2.5 py-1.5 bg-gold text-white text-sm font-medium rounded-lg hover:bg-[color-mix(in_srgb,var(--brand-color)_85%,black)]"
    >
      ✓
    </button>
    {showRemove && (
      <button
        type="button"
        aria-label="Remove link"
        onMouseDown={(e) => { e.preventDefault(); removeLink(); }}
        className={`px-2 py-1.5 rounded-lg ${removeClass}`}
      >
        <X size={14} />
      </button>
    )}
  </div>
);

// ─── Main Editor Component ────────────────────────────────────────

const RichTextEditor: React.FC<RichTextEditorProps> = ({
  content,
  onChange,
  minHeight = '300px',
  placeholder = 'Write something...',
  proseClass = DEFAULT_PROSE_CLASS,
}) => {
  const [showImageModal, setShowImageModal] = useState(false);
  /**
   * WHICH surface opened the link editor, or null when closed.
   *
   * A boolean while the bubble was the only entry point. The bubble renders
   * only on a non-empty selection, so a shared boolean would have put the
   * toolbar's input somewhere unrendered. Tagging the source lets each surface
   * render only the control it opened.
   */
  const [linkEditor, setLinkEditor] = useState<'bubble' | 'toolbar' | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const linkInputRef = useRef<HTMLInputElement>(null);
  // Ref so the Image command can open the modal without prop threading
  const openImageModalRef = useRef<() => void>(() => {});
  openImageModalRef.current = () => setShowImageModal(true);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'text-gold underline cursor-pointer' },
      }),
      Image.configure({ HTMLAttributes: { referrerPolicy: 'no-referrer' } }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder }),
      SlashCommand.configure({
        suggestion: {
          char: '/',
          allowedPrefixes: [' ', '\u0000'],
          items: ({ query }: { query: string }) => {
            return commands
              .map((cmd) =>
                cmd.title === 'Image'
                  ? { ...cmd, action: () => openImageModalRef.current() }
                  : cmd
              )
              .filter(
                (item) =>
                  item.title.toLowerCase().includes(query.toLowerCase()) ||
                  item.description.toLowerCase().includes(query.toLowerCase())
              );
          },
          render: renderSlashCommands,
          allowSpaces: false,
        },
      }),
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: `${proseClass} mx-auto focus:outline-hidden p-4 max-w-none`,
        style: `word-break: normal; overflow-wrap: break-word; white-space: normal; min-height: ${minHeight};`,
      },
    },
  });

  const handleImageInsert = useCallback((url: string) => {
    if (editor) {
      editor.chain().focus().setImage({ src: url }).run();
    }
    setShowImageModal(false);
  }, [editor]);

  const openLinkEditor = useCallback((source: 'bubble' | 'toolbar') => {
    if (!editor) return;
    const existingHref = editor.getAttributes('link').href || '';
    setLinkUrl(existingHref);
    setLinkEditor(source);
    setTimeout(() => linkInputRef.current?.focus(), 50);
  }, [editor]);

  const applyLink = useCallback(() => {
    if (!editor) return;
    if (!linkUrl.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else if (isSafeUrl(linkUrl.trim())) {
      editor.chain().focus().extendMarkRange('link').setLink({ href: linkUrl.trim() }).run();
    }
    setLinkEditor(null);
  }, [editor, linkUrl]);

  /**
   * The toolbar's buttons, built from `commands` + `ALIGN_COMMANDS`.
   *
   * 🔴 PARITY IS STRUCTURAL: this MAPS the shared arrays, it does not re-list
   * them, so a command added or removed moves both menus at once and every
   * button runs the same `action` — the existing `chain()` call. Two entries
   * are overridden here, the idiom `items({ query })` already set for Image:
   * Image to the upload modal, and Link to the inline editor rather than the
   * array's `window.prompt`. Both run `isSafeUrl` before `setLink`, so Link is
   * a better affordance for the same command, not a second implementation.
   */
  /*
   * ⚠️ NOT memoised, deliberately. `active` reads the CURRENT document, so the
   * real dependency is the editor state — which changes every transaction, and
   * which the linter cannot see through `COMMAND_ACTIVE` (it calls the
   * dependency unnecessary). A `useMemo` here is a stale-highlight bug waiting
   * for someone to trim the array. `useEditor` already re-renders on every
   * transaction, which is exactly when these must be recomputed.
   */
  const toolbarItems: ToolbarItem[] = editor
    ? [...commands, ...ALIGN_COMMANDS].map((cmd) => ({
        title: cmd.title,
        description: cmd.description,
        icon: cmd.icon,
        active: COMMAND_ACTIVE[cmd.title]?.(editor) ?? false,
        disabled: !(COMMAND_ENABLED[cmd.title]?.(editor) ?? true),
        disabledReason: DISABLED_REASON[cmd.title],
        expanded: cmd.title === 'Link' ? linkEditor === 'toolbar' : undefined,
        run:
          cmd.title === 'Image'
            ? () => openImageModalRef.current()
            : cmd.title === 'Link'
              ? () => openLinkEditor('toolbar')
              : () => cmd.action(editor),
      }))
    : [];

  const removeLink = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setLinkEditor(null);
  }, [editor]);

  return (
    <div className="bg-surface-raised rounded-xl overflow-hidden">
      {/* Bubble menu: appears when text is selected */}
      {editor && (
        <BubbleMenu
          editor={editor}
          tippyOptions={{ duration: 100, placement: 'top' }}
          className="bg-warm-dark rounded-xl shadow-xl"
        >
          {linkEditor === 'bubble' ? (
            /* ── Inline link editor — now the shared row, same markup ── */
            <LinkEditorRow
              /* The bubble's dark chip, byte-identical to before this ticket —
                 `text-red-400` included, a raw shade this PR deliberately does
                 not restyle on a working control. */
              inputClass="bg-surface-raised text-strong"
              removeClass="text-red-400 hover:text-red-300"
              inputRef={linkInputRef}
              linkUrl={linkUrl}
              setLinkUrl={setLinkUrl}
              applyLink={applyLink}
              removeLink={removeLink}
              onCancel={() => setLinkEditor(null)}
              showRemove={editor.isActive('link')}
            />
          ) : (
            /* ── Formatting toolbar ── */
            <div className="flex items-center gap-0.5 p-1">
              <button
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}
                className={`p-2 rounded-lg transition-colors ${
                  editor.isActive('bold') ? 'bg-white/20 text-white' : 'text-stone-300 hover:text-white hover:bg-white/10'
                }`}
              >
                <Bold size={16} />
              </button>
              <button
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}
                className={`p-2 rounded-lg transition-colors ${
                  editor.isActive('italic') ? 'bg-white/20 text-white' : 'text-stone-300 hover:text-white hover:bg-white/10'
                }`}
              >
                <Italic size={16} />
              </button>
              <button
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleUnderline().run(); }}
                className={`p-2 rounded-lg transition-colors ${
                  editor.isActive('underline') ? 'bg-white/20 text-white' : 'text-stone-300 hover:text-white hover:bg-white/10'
                }`}
              >
                <UnderlineIcon size={16} />
              </button>
              <button
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleStrike().run(); }}
                className={`p-2 rounded-lg transition-colors ${
                  editor.isActive('strike') ? 'bg-white/20 text-white' : 'text-stone-300 hover:text-white hover:bg-white/10'
                }`}
              >
                <Strikethrough size={16} />
              </button>
              <div className="w-px h-5 bg-white/20 mx-0.5" />
              <button
                onMouseDown={(e) => { e.preventDefault(); openLinkEditor('bubble'); }}
                className={`p-2 rounded-lg transition-colors ${
                  editor.isActive('link') ? 'bg-white/20 text-white' : 'text-stone-300 hover:text-white hover:bg-white/10'
                }`}
              >
                <LinkIcon size={16} />
              </button>
            </div>
          )}
        </BubbleMenu>
      )}

      {/*
        🔴 A SIBLING of <EditorContent>, above it, so it is OUTSIDE the prose
        container: the ramp lands on the editable area <EditorContent> renders,
        and @tailwindcss/typography styles descendants by tag.

        One component, three surfaces — Notes, Course Builder and Blog all
        render this editor, so the bar reaches all three and is forked into none.
      */}
      {editor && (
        <RichTextToolbar items={toolbarItems}>
          {linkEditor === 'toolbar' && (
            <div className="border-t border-line">
              <LinkEditorRow
                /* The toolbar's raised card. Every token themed, so all four
                   palettes resolve — `text-danger`, not the bubble's raw shade,
                   since this row is new. */
                inputClass="bg-surface-tint text-strong border border-line"
                removeClass="text-danger hover:bg-surface-tint"
                inputRef={linkInputRef}
                linkUrl={linkUrl}
                setLinkUrl={setLinkUrl}
                applyLink={applyLink}
                removeLink={removeLink}
                onCancel={() => setLinkEditor(null)}
                showRemove={editor.isActive('link')}
              />
            </div>
          )}
        </RichTextToolbar>
      )}

      <EditorContent editor={editor} />

      {/* Image upload modal */}
      {showImageModal && (
        <ImageUploadModal
          onClose={() => setShowImageModal(false)}
          onInsert={handleImageInsert}
        />
      )}
    </div>
  );
};

export default RichTextEditor;
