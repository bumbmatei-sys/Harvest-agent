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
  Upload, X, Loader2
} from 'lucide-react';
import { auth } from '../firebase';

interface RichTextEditorProps {
  content: string;
  onChange: (content: string) => void;
  minHeight?: string;
  placeholder?: string;
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
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 pb-8 sm:pb-5 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-bold text-gray-900">Add Image</h3>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>

        {error && <div className="bg-red-50 text-red-600 p-2.5 rounded-lg text-sm">{error}</div>}

        <div>
          <div
            onClick={() => !isUploading && fileInputRef.current?.click()}
            className="w-full h-40 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 flex flex-col items-center justify-center text-gray-500 hover:bg-gray-100 hover:border-gold transition-colors cursor-pointer"
          >
            {isUploading ? (
              <>
                <Loader2 size={28} className="animate-spin mb-2 text-gold" />
                <span className="text-sm font-medium text-gray-600">Uploading...</span>
              </>
            ) : (
              <>
                <Upload size={28} className="mb-2" />
                <span className="text-sm font-medium">Tap to upload</span>
                <span className="text-xs text-gray-400 mt-1">PNG, JPG, GIF up to 4MB</span>
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

const commands: CommandItem[] = [
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
    return <div className="p-3 text-sm text-gray-400">No commands found</div>;
  }

  return (
    <div
      ref={containerRef}
      className="bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden max-h-[320px] overflow-y-auto w-72"
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
                ? 'bg-[color-mix(in_srgb,var(--brand-color)_10%,transparent)] text-gray-900'
                : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
            <div
              className={`flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border ${
                index === selectedIndex
                  ? 'border-gold bg-[color-mix(in_srgb,var(--brand-color)_5%,transparent)] text-gold'
                  : 'border-gray-200 bg-gray-50 text-gray-500'
              }`}
            >
              {item.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{item.title}</div>
              <div className="text-xs text-gray-400">{item.description}</div>
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

// ─── Main Editor Component ────────────────────────────────────────

const RichTextEditor: React.FC<RichTextEditorProps> = ({
  content,
  onChange,
  minHeight = '300px',
  placeholder = 'Write something...',
}) => {
  const [showImageModal, setShowImageModal] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
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
        class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none p-4 max-w-none',
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

  const openLinkEditor = useCallback(() => {
    if (!editor) return;
    const existingHref = editor.getAttributes('link').href || '';
    setLinkUrl(existingHref);
    setShowLinkInput(true);
    setTimeout(() => linkInputRef.current?.focus(), 50);
  }, [editor]);

  const applyLink = useCallback(() => {
    if (!editor) return;
    if (!linkUrl.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else if (isSafeUrl(linkUrl.trim())) {
      editor.chain().focus().extendMarkRange('link').setLink({ href: linkUrl.trim() }).run();
    }
    setShowLinkInput(false);
  }, [editor, linkUrl]);

  const removeLink = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setShowLinkInput(false);
  }, [editor]);

  return (
    <div className="bg-white rounded-xl overflow-hidden">
      {/* Bubble menu: appears when text is selected */}
      {editor && (
        <BubbleMenu
          editor={editor}
          tippyOptions={{ duration: 100, placement: 'top' }}
          className="bg-gray-900 rounded-xl shadow-xl"
        >
          {showLinkInput ? (
            /* ── Inline link editor ── */
            <div className="flex items-center gap-1.5 p-1.5">
              <input
                ref={linkInputRef}
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
                  if (e.key === 'Escape') { setShowLinkInput(false); }
                }}
                placeholder="https://..."
                className="w-40 sm:w-56 px-2.5 py-1.5 text-sm bg-white text-gray-900 border-0 rounded-lg focus:ring-2 focus:ring-gold outline-none"
              />
              <button
                onMouseDown={(e) => { e.preventDefault(); applyLink(); }}
                className="px-2.5 py-1.5 bg-gold text-white text-sm font-medium rounded-lg hover:bg-[color-mix(in_srgb,var(--brand-color)_85%,black)]"
              >
                ✓
              </button>
              {editor.isActive('link') && (
                <button
                  onMouseDown={(e) => { e.preventDefault(); removeLink(); }}
                  className="px-2 py-1.5 text-red-400 hover:text-red-300 rounded-lg"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ) : (
            /* ── Formatting toolbar ── */
            <div className="flex items-center gap-0.5 p-1">
              <button
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}
                className={`p-2 rounded-lg transition-colors ${
                  editor.isActive('bold') ? 'bg-white/20 text-white' : 'text-gray-300 hover:text-white hover:bg-white/10'
                }`}
              >
                <Bold size={16} />
              </button>
              <button
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}
                className={`p-2 rounded-lg transition-colors ${
                  editor.isActive('italic') ? 'bg-white/20 text-white' : 'text-gray-300 hover:text-white hover:bg-white/10'
                }`}
              >
                <Italic size={16} />
              </button>
              <button
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleUnderline().run(); }}
                className={`p-2 rounded-lg transition-colors ${
                  editor.isActive('underline') ? 'bg-white/20 text-white' : 'text-gray-300 hover:text-white hover:bg-white/10'
                }`}
              >
                <UnderlineIcon size={16} />
              </button>
              <button
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleStrike().run(); }}
                className={`p-2 rounded-lg transition-colors ${
                  editor.isActive('strike') ? 'bg-white/20 text-white' : 'text-gray-300 hover:text-white hover:bg-white/10'
                }`}
              >
                <Strikethrough size={16} />
              </button>
              <div className="w-px h-5 bg-white/20 mx-0.5" />
              <button
                onMouseDown={(e) => { e.preventDefault(); openLinkEditor(); }}
                className={`p-2 rounded-lg transition-colors ${
                  editor.isActive('link') ? 'bg-white/20 text-white' : 'text-gray-300 hover:text-white hover:bg-white/10'
                }`}
              >
                <LinkIcon size={16} />
              </button>
            </div>
          )}
        </BubbleMenu>
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
