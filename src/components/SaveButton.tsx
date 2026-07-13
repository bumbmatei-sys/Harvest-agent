"use client";
import React from 'react';
import { Bookmark } from 'lucide-react';
import { useSavedItems } from '../contexts/SavedItemsContext';
import { SavedEntryInput, keyForEntry } from '../types/saved.types';

interface SaveButtonProps {
  /** The item to save — the composite key is derived from it. */
  entry: SavedEntryInput;
  /**
   * 'pill' — gold pill with a label, sits beside ShareButton (blog / post).
   * 'icon' — compact icon-only toggle for tighter spots (lesson header).
   */
  variant?: 'pill' | 'icon';
  /** Extra classes merged onto the button (layout / spacing overrides). */
  className?: string;
}

/**
 * Reusable bookmark toggle. Reads the current saved state from the shared
 * SavedItemsContext (one Firestore listener app-wide) and toggles a dotted-path
 * write on the user's own users/{uid} doc. The bookmark fills when saved.
 * Optimistic: the icon flips immediately.
 *
 * Styling of the 'pill' variant mirrors ShareButton (ShareButton.tsx) so the
 * two controls read as a pair wherever they sit together.
 */
const SaveButton: React.FC<SaveButtonProps> = ({ entry, variant = 'pill', className }) => {
  const { isSaved, toggleSave } = useSavedItems();
  const key = keyForEntry(entry);
  const saved = isSaved(key);

  const handleClick = (e: React.MouseEvent) => {
    // Save surfaces often sit inside a clickable card (feed post, article row);
    // don't let the toggle bubble up and trigger navigation.
    e.stopPropagation();
    toggleSave(entry);
  };

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-label={saved ? 'Remove from saved' : 'Save'}
        aria-pressed={saved}
        title={saved ? 'Saved' : 'Save'}
        className={`inline-flex items-center justify-center w-9 h-9 rounded-full transition-colors hover:bg-stone-100 ${className || ''}`}
        style={{ color: 'var(--brand-color, #B8962E)' }}
      >
        <Bookmark size={18} strokeWidth={2.5} fill={saved ? 'currentColor' : 'none'} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={saved ? 'Remove from saved' : 'Save'}
      aria-pressed={saved}
      title={saved ? 'Saved' : 'Save'}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-90 ${className || ''}`}
      style={{
        color: 'var(--brand-color, #B8962E)',
        background: 'color-mix(in srgb, var(--brand-color, #B8962E) 12%, white)',
      }}
    >
      <Bookmark size={14} strokeWidth={2.5} fill={saved ? 'currentColor' : 'none'} />
      {saved ? 'Saved' : 'Save'}
    </button>
  );
};

export default SaveButton;
