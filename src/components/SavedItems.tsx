"use client";
import React from 'react';
import { ArrowLeft, FileText, GraduationCap, MessageSquare, BookOpen, Bookmark, Trash2, ChevronRight } from 'lucide-react';
import { useSavedItems } from '../contexts/SavedItemsContext';
import {
  SavedEntry,
  SavedBlog,
  SavedLesson,
  SavedPost,
  SavedVerse,
  SavedType,
  keyForEntry,
} from '../types/saved.types';

const BRAND = 'var(--brand-color, #B8962E)';

interface SavedItemsProps {
  onBack: () => void;
  /** Open a saved blog article by id (resolves the live doc). */
  onOpenBlog: (postId: string) => void;
  /** Open a saved course lesson by courseId + lessonId. */
  onOpenLesson: (courseId: string, lessonId: string) => void;
  /** Open the feed for a saved post. */
  onOpenPost: (postId: string) => void;
}

// Group ordering + labels + icons. Verses render their text inline (see note in
// the verse row) rather than deep-linking the Bible — value-based, no doc lookup.
const GROUPS: { type: SavedType; label: string; empty: string; Icon: any }[] = [
  { type: 'blog', label: 'Articles', empty: 'No saved articles yet', Icon: FileText },
  { type: 'lesson', label: 'Lessons', empty: 'No saved lessons yet', Icon: GraduationCap },
  { type: 'post', label: 'Posts', empty: 'No saved posts yet', Icon: MessageSquare },
  { type: 'verse', label: 'Verses', empty: 'No saved verses yet', Icon: BookOpen },
];

const SavedItems: React.FC<SavedItemsProps> = ({ onBack, onOpenBlog, onOpenLesson, onOpenPost }) => {
  const { savedItems, ready, removeSave } = useSavedItems();

  // Newest first within each group.
  const entries = Object.values(savedItems).sort(
    (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
  );
  const byType = (type: SavedType) => entries.filter((e) => e.type === type);

  const rowShell = (
    key: string,
    Icon: any,
    onClick: (() => void) | null,
    body: React.ReactNode
  ) => (
    <div
      key={key}
      className="flex items-start gap-3 bg-white rounded-2xl border border-stone-200 p-3.5"
    >
      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: 'color-mix(in srgb, var(--brand-color, #B8962E) 12%, white)' }}>
        <Icon size={16} style={{ color: BRAND }} />
      </div>
      <button
        type="button"
        onClick={onClick ?? undefined}
        disabled={!onClick}
        className={`flex-1 min-w-0 text-left ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
      >
        {body}
      </button>
      <div className="flex items-center gap-1 shrink-0">
        {onClick && <ChevronRight size={16} className="text-[color:var(--text-faint)] mt-0.5" />}
        <button
          type="button"
          onClick={() => removeSave(key)}
          aria-label="Remove from saved"
          title="Remove"
          className="p-1.5 rounded-lg text-[color:var(--text-faint)] hover:text-red-500 hover:bg-red-50 transition-colors"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );

  const renderRow = (entry: SavedEntry, Icon: any) => {
    switch (entry.type) {
      case 'blog': {
        const e = entry as SavedBlog;
        return rowShell(keyForEntry(e), Icon, () => onOpenBlog(e.id), (
          <>
            <div className="text-[14px] font-bold text-earth line-clamp-2">{e.title}</div>
            {e.snippet && <div className="text-xs text-warm-brown line-clamp-2 mt-0.5">{e.snippet}</div>}
          </>
        ));
      }
      case 'lesson': {
        const e = entry as SavedLesson;
        return rowShell(keyForEntry(e), Icon, () => onOpenLesson(e.courseId, e.lessonId), (
          <>
            <div className="text-[14px] font-bold text-earth line-clamp-2">{e.title}</div>
            {e.courseTitle && <div className="text-xs text-warm-brown line-clamp-1 mt-0.5">{e.courseTitle}</div>}
          </>
        ));
      }
      case 'post': {
        const e = entry as SavedPost;
        return rowShell(keyForEntry(e), Icon, () => onOpenPost(e.id), (
          <>
            <div className="text-[14px] font-bold text-earth line-clamp-1">
              {e.authorName ? `${e.authorName}'s post` : 'Community post'}
            </div>
            {e.snippet && <div className="text-xs text-warm-brown line-clamp-2 mt-0.5">{e.snippet}</div>}
          </>
        ));
      }
      case 'verse': {
        const e = entry as SavedVerse;
        // Verses are value-based (not Firestore docs), so we render the saved
        // text + reference directly in a card — no navigation / no doc lookup.
        return rowShell(keyForEntry(e), Icon, null, (
          <>
            <div className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: BRAND }}>
              {e.reference} · {e.translation}
            </div>
            <div className="text-[13px] leading-relaxed text-earth" style={{ fontFamily: "'Crimson Pro', Georgia, serif" }}>
              {e.text}
            </div>
          </>
        ));
      }
    }
  };

  return (
    <div className="flex flex-col min-h-full h-full bg-[#F7F6F3] overflow-y-auto">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100">
        <div className="flex items-center gap-3 px-4 py-4 lg:max-w-[760px] lg:mx-auto">
          <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100">
            <ArrowLeft size={18} className="text-gray-600" />
          </button>
          <h2 className="font-display text-lg font-normal tracking-[-0.01em] text-earth">Saved</h2>
        </div>
      </div>

      <div className="flex-1 p-4 lg:max-w-[760px] lg:mx-auto lg:w-full">
        {!ready ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: BRAND, borderTopColor: 'transparent' }} />
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Bookmark size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium text-earth">Nothing saved yet</p>
            <p className="text-sm mt-1">Bookmark articles, lessons, posts and verses to find them here.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {GROUPS.map(({ type, label, empty, Icon }) => {
              const items = byType(type);
              return (
                <div key={type}>
                  <h4 className="text-[10px] font-bold text-[color:var(--text-faint)] tracking-wider uppercase mb-3 ml-1">
                    {label}
                  </h4>
                  {items.length === 0 ? (
                    <p className="text-sm text-[color:var(--text-faint)] ml-1">{empty}</p>
                  ) : (
                    <div className="space-y-2.5">
                      {items.map((entry) => renderRow(entry, Icon))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default SavedItems;
