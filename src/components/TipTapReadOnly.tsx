"use client";
import React, { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';

interface Props {
  /**
   * The note body as an HTML string (Harvest docs are stored as TipTap HTML,
   * the output of RichTextEditor's editor.getHTML()).
   */
  contentHtml: string;
}

/**
 * Read-only renderer for a shared sermon note. Uses the same extensions as the
 * authoring editor so formatting (headings, lists, links, images, alignment,
 * underline) renders faithfully. `editable: false` means no edit controls and
 * the content is display-only.
 */
const TipTapReadOnly: React.FC<Props> = ({ contentHtml }) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Link.configure({ openOnClick: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
      Image.configure({ HTMLAttributes: { referrerPolicy: 'no-referrer' } }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: contentHtml || '',
    editable: false,
    immediatelyRender: false,
  });

  // Keep the rendered content in sync if the shared note is updated live.
  useEffect(() => {
    if (editor && contentHtml !== editor.getHTML()) {
      editor.commands.setContent(contentHtml || '', false);
    }
  }, [contentHtml, editor]);

  return (
    <div className="prose prose-sm prose-invert max-w-none">
      <EditorContent editor={editor} />
    </div>
  );
};

export default TipTapReadOnly;
