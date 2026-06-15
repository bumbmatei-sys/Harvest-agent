"use client";
import React, { useCallback } from 'react';
import { isSafeUrl } from '../utils/sanitize';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import { 
 Bold, Italic, Underline as UnderlineIcon, Strikethrough, 
 Heading1, Heading2, List, ListOrdered, Link as LinkIcon, 
 Image as ImageIcon, AlignLeft, AlignCenter, AlignRight, AlignJustify 
} from 'lucide-react';

interface RichTextEditorProps {
 content: string;
 onChange: (content: string) => void;
 minHeight?: string;
 placeholder?: string;
}

const MenuBar = ({ editor }: { editor: any }) => {
 const transformImageUrl = (url: string) => {
 if (!url) return url;
 // Transform GitHub blob/raw URLs to raw URLs
 if (url.includes('github.com') && (url.includes('/blob/') || url.includes('/raw/'))) {
 return url.replace('github.com', 'raw.githubusercontent.com')
 .replace('/blob/', '/')
 .replace('/raw/', '/');
 }
 return url;
 };

 const addImage = useCallback(() => {
    if (!editor) return;
    const url = window.prompt('URL');
    if (url && isSafeUrl(url)) {
      editor.chain().focus().setImage({ src: transformImageUrl(url) }).run();
    }
  }, [editor]);

 const setLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('URL', previousUrl);
    if (url === null) {
      return;
    }
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    if (!isSafeUrl(url)) return;
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

 if (!editor) {
 return null;
 }

 return (
 <div className="flex flex-nowrap overflow-x-auto gap-1 p-2 border-b border-gray-200 bg-gray-50 rounded-t-xl [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] [&>button]:shrink-0 [&>div]:shrink-0">
 <button
 onClick={() => editor.chain().focus().toggleBold().run()}
 disabled={!editor.can().chain().focus().toggleBold().run()}
 className={`p-1.5 rounded hover:bg-gray-200 :bg-gray-700 transition-colors ${editor.isActive('bold') ? 'bg-gray-200 text-gray-900 ' : 'text-gray-600 '}`}
 title="Bold"
 >
 <Bold size={18} />
 </button>
 <button
 onClick={() => editor.chain().focus().toggleItalic().run()}
 disabled={!editor.can().chain().focus().toggleItalic().run()}
 className={`p-1.5 rounded hover:bg-gray-200 :bg-gray-700 transition-colors ${editor.isActive('italic') ? 'bg-gray-200 text-gray-900 ' : 'text-gray-600 '}`}
 title="Italic"
 >
 <Italic size={18} />
 </button>
 <button
 onClick={() => editor.chain().focus().toggleUnderline().run()}
 disabled={!editor.can().chain().focus().toggleUnderline().run()}
 className={`p-1.5 rounded hover:bg-gray-200 :bg-gray-700 transition-colors ${editor.isActive('underline') ? 'bg-gray-200 text-gray-900 ' : 'text-gray-600 '}`}
 title="Underline"
 >
 <UnderlineIcon size={18} />
 </button>
 <button
 onClick={() => editor.chain().focus().toggleStrike().run()}
 disabled={!editor.can().chain().focus().toggleStrike().run()}
 className={`p-1.5 rounded hover:bg-gray-200 :bg-gray-700 transition-colors ${editor.isActive('strike') ? 'bg-gray-200 text-gray-900 ' : 'text-gray-600 '}`}
 title="Strikethrough"
 >
 <Strikethrough size={18} />
 </button>
 
 <div className="w-px h-6 bg-gray-300 mx-1 self-center" />
 
 <button
 onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
 className={`p-1.5 rounded hover:bg-gray-200 :bg-gray-700 transition-colors ${editor.isActive('heading', { level: 1 }) ? 'bg-gray-200 text-gray-900 ' : 'text-gray-600 '}`}
 title="Heading 1"
 >
 <Heading1 size={18} />
 </button>
 <button
 onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
 className={`p-1.5 rounded hover:bg-gray-200 :bg-gray-700 transition-colors ${editor.isActive('heading', { level: 2 }) ? 'bg-gray-200 text-gray-900 ' : 'text-gray-600 '}`}
 title="Heading 2"
 >
 <Heading2 size={18} />
 </button>
 
 <div className="w-px h-6 bg-gray-300 mx-1 self-center" />
 
 <button
 onClick={() => editor.chain().focus().toggleBulletList().run()}
 className={`p-1.5 rounded hover:bg-gray-200 :bg-gray-700 transition-colors ${editor.isActive('bulletList') ? 'bg-gray-200 text-gray-900 ' : 'text-gray-600 '}`}
 title="Bullet List"
 >
 <List size={18} />
 </button>
 <button
 onClick={() => editor.chain().focus().toggleOrderedList().run()}
 className={`p-1.5 rounded hover:bg-gray-200 :bg-gray-700 transition-colors ${editor.isActive('orderedList') ? 'bg-gray-200 text-gray-900 ' : 'text-gray-600 '}`}
 title="Numbered List"
 >
 <ListOrdered size={18} />
 </button>
 
 <div className="w-px h-6 bg-gray-300 mx-1 self-center" />
 
 <button
 onClick={() => editor.chain().focus().setTextAlign('left').run()}
 className={`p-1.5 rounded hover:bg-gray-200 :bg-gray-700 transition-colors ${editor.isActive({ textAlign: 'left' }) ? 'bg-gray-200 text-gray-900 ' : 'text-gray-600 '}`}
 title="Align Left"
 >
 <AlignLeft size={18} />
 </button>
 <button
 onClick={() => editor.chain().focus().setTextAlign('center').run()}
 className={`p-1.5 rounded hover:bg-gray-200 :bg-gray-700 transition-colors ${editor.isActive({ textAlign: 'center' }) ? 'bg-gray-200 text-gray-900 ' : 'text-gray-600 '}`}
 title="Align Center"
 >
 <AlignCenter size={18} />
 </button>
 <button
 onClick={() => editor.chain().focus().setTextAlign('right').run()}
 className={`p-1.5 rounded hover:bg-gray-200 :bg-gray-700 transition-colors ${editor.isActive({ textAlign: 'right' }) ? 'bg-gray-200 text-gray-900 ' : 'text-gray-600 '}`}
 title="Align Right"
 >
 <AlignRight size={18} />
 </button>
 
 <div className="w-px h-6 bg-gray-300 mx-1 self-center" />
 
 <button
 onClick={setLink}
 className={`p-1.5 rounded hover:bg-gray-200 :bg-gray-700 transition-colors ${editor.isActive('link') ? 'bg-gray-200 text-gray-900 ' : 'text-gray-600 '}`}
 title="Link"
 >
 <LinkIcon size={18} />
 </button>
 <button
 onClick={addImage}
 className="p-1.5 rounded hover:bg-gray-200 :bg-gray-700 transition-colors text-gray-600 "
 title="Image"
 >
 <ImageIcon size={18} />
 </button>
 </div>
 );
};

const RichTextEditor: React.FC<RichTextEditorProps> = ({ content, onChange, minHeight = '300px', placeholder = 'Write something...' }) => {
 const editor = useEditor({
 extensions: [
 StarterKit,
 Underline,
 Link.configure({
 openOnClick: false,
 }),
 Image.configure({
 HTMLAttributes: {
 referrerPolicy: 'no-referrer',
 },
 }),
 TextAlign.configure({
 types: ['heading', 'paragraph'],
 }),
 Placeholder.configure({
 placeholder,
 }),
 ],
 content,
 onUpdate: ({ editor }) => {
 onChange(editor.getHTML());
 },
 editorProps: {
 attributes: {
 class: `prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none min-h-[${minHeight}] p-4 max-w-none`,
 style: `word-break: normal; overflow-wrap: break-word; white-space: normal; min-height: ${minHeight};`
 },
 },
 });

 return (
 <div className="border border-gray-200 rounded-xl overflow-hidden bg-white ">
 <MenuBar editor={editor} />
 <EditorContent editor={editor} />
 </div>
 );
};

export default RichTextEditor;