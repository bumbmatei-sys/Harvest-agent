"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { X, Search, FileText, HeartHandshake, Calendar as CalendarIcon } from 'lucide-react';
import type { EmbedType } from './EmbedCard';

export interface PickerItem {
  id: string;
  title: string;
  subtitle?: string;
  image?: string;
}

const TITLES: Record<EmbedType, string> = {
  blog: 'Attach an article',
  fundraising: 'Attach a fundraiser',
  event: 'Attach an event',
};

const ICONS: Record<EmbedType, React.ComponentType<{ size?: number; className?: string }>> = {
  blog: FileText,
  fundraising: HeartHandshake,
  event: CalendarIcon,
};

/**
 * Searchable, tenant-scoped picker for choosing the single item to embed. The
 * caller supplies an already tenant-scoped `items` list, so this component never
 * queries across tenants. On pick it returns the chosen id and closes.
 */
const EmbedPicker: React.FC<{
  type: EmbedType;
  items: PickerItem[];
  loading: boolean;
  onPick: (id: string) => void;
  onClose: () => void;
}> = ({ type, items, loading, onPick, onClose }) => {
  const [q, setQ] = useState('');
  const Icon = ICONS[type];
  const needle = q.trim().toLowerCase();
  const filtered = needle ? items.filter((i) => i.title.toLowerCase().includes(needle)) : items;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      // Centered on every breakpoint (was items-end on mobile, which stuck the
      // sheet to the bottom behind the mobile nav bar — the list opened off-screen).
      // p-4 keeps it off the edges and the max-height caps it so the search box +
      // first items are visible immediately without scrolling the page.
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={TITLES[type]}
    >
      <div
        className="bg-white w-full sm:max-w-md rounded-2xl shadow-xl max-h-[75vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-200">
          <Icon size={18} className="text-gold" />
          <h3 className="font-bold text-earth text-base flex-1 font-display">{TITLES[type]}</h3>
          <button onClick={onClose} aria-label="Close" className="p-1 text-warm-brown hover:bg-stone-100 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-3 border-b border-stone-200">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
              placeholder="Search…"
              className="w-full pl-9 pr-3 py-2 bg-stone-100 border border-stone-200 rounded-xl text-sm text-earth focus:ring-1 focus:ring-gold outline-none"
            />
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-2">
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-sm text-warm-brown py-10">
              {items.length === 0 ? 'Nothing to attach yet.' : 'No matches.'}
            </p>
          ) : (
            filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onPick(item.id)}
                className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-stone-100 transition-colors text-left"
              >
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-stone-100 shrink-0 relative flex items-center justify-center">
                  {item.image ? (
                    <Image src={item.image} alt="" fill sizes="48px" className="object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <Icon size={18} className="text-stone-300" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-earth truncate">{item.title}</p>
                  {item.subtitle && <p className="text-xs text-warm-brown truncate">{item.subtitle}</p>}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default EmbedPicker;
