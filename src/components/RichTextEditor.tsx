"use client";
import React, { useEffect, useRef } from 'react';
import { isSafeUrl } from '../utils/sanitize';
import { useEditor, EditorContent, ReactRenderer } from '@tiptap/react';
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
  Type, Strikethrough, Underline as UnderlineIcon
} from 'lucide-react';

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
  action: (editor: any) => void;
}

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
      const url = window.prompt('URL');
      if (url && isSafeUrl(url)) {
        editor.chain().focus().setLink({ href: url }).run();
      }
    },
  },
  {
    title: 'Image',
    description: 'Add an image by URL',
    icon: <ImageIcon size={18} />,
    action: (editor) => {
      const url = window.prompt('Image URL');
      if (url && isSafeUrl(url)) {
        let finalUrl = url;
        if (url.includes('github.com') && (url.includes('/blob/') || url.includes('/raw/'))) {
          finalUrl = url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/').replace('/raw/', '/');
        }
        editor.chain().focus().setImage({ src: finalUrl }).run();
      }
    },
  },
];

// Slash command extension — triggers on "/" at the start of an empty line or after a space
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
// Keyboard navigation is handled entirely in the render config's onKeyDown.
// This component only renders the list and handles mouse clicks.

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

  // Auto-scroll selected item into view
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
            // Use onMouseDown + preventDefault to keep editor focus
            // onClick would blur the editor first, breaking the suggestion lifecycle
            onMouseDown={(e) => {
              e.preventDefault();
              command(item);
            }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
              index === selectedIndex
                ? 'bg-[#d4a017]/10 text-gray-900'
                : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
            <div
              className={`flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border ${
                index === selectedIndex
                  ? 'border-[#d4a017] bg-[#d4a017]/5 text-[#d4a017]'
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
// All keyboard navigation lives here (onKeyDown), NOT in the React component.
// Selection state is managed in closure variables, not React state.

const renderSlashCommands = () => {
  let component: ReactRenderer | null = null;
  let popup: HTMLElement | null = null;
  let selectedIndex = 0;
  let currentItems: CommandItem[] = [];
  let currentCommand: ((item: CommandItem) => void) | null = null;

  // Position popup with viewport boundary checks
  const positionPopup = (el: HTMLElement, rect: DOMRect) => {
    const POPUP_HEIGHT = 340;
    const POPUP_WIDTH = 288; // w-72 = 18rem = 288px

    // Vertical: flip above cursor if not enough space below
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < POPUP_HEIGHT && rect.top > POPUP_HEIGHT) {
      el.style.top = `${rect.top - 8}px`;
      el.style.transform = 'translateY(-100%)';
    } else {
      el.style.top = `${rect.bottom + 8}px`;
      el.style.transform = 'none';
    }

    // Horizontal: clamp to viewport
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

      // Close on Escape
      if (event.key === 'Escape') {
        popup?.remove();
        popup = null;
        component?.destroy();
        component = null;
        return true;
      }

      // Navigate up
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (currentItems.length > 0) {
          updateSelection((selectedIndex + currentItems.length - 1) % currentItems.length);
        }
        return true;
      }

      // Navigate down
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (currentItems.length > 0) {
          updateSelection((selectedIndex + 1) % currentItems.length);
        }
        return true;
      }

      // Select command
      if (event.key === 'Enter') {
        event.preventDefault();
        if (currentItems[selectedIndex] && currentCommand) {
          currentCommand(currentItems[selectedIndex]);
        }
        return true;
      }

      // All other keys: let tiptap handle (typing to filter, backspace, etc.)
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
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      Link.configure({ openOnClick: false }),
      Image.configure({ HTMLAttributes: { referrerPolicy: 'no-referrer' } }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder }),
      SlashCommand.configure({
        suggestion: {
          char: '/',
          // \u0000 = null char (start of content), ' ' = after a space
          allowedPrefixes: [' ', '\u0000'],
          items: ({ query }: { query: string }) => {
            return commands.filter(
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

  return (
    <div className="bg-white rounded-xl overflow-hidden">
      <EditorContent editor={editor} />
    </div>
  );
};

export default RichTextEditor;
