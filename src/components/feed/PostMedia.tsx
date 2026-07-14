"use client";
import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Full-screen, uncropped image viewer. Feed thumbnails are cropped
 * (object-cover); this shows the whole image (object-contain) so nothing is
 * cut off. Supports paging when a post has multiple images — arrows on desktop,
 * swipe on touch, Esc/backdrop/X to close.
 */
export const ImageLightbox: React.FC<{ images: string[]; index: number; onClose: () => void }> = ({ images, index, onClose }) => {
  const [current, setCurrent] = useState(index);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => { setCurrent(index); }, [index]);

  const go = React.useCallback((delta: number) => {
    setCurrent(c => {
      const next = c + delta;
      if (next < 0) return images.length - 1;
      if (next >= images.length) return 0;
      return next;
    });
  }, [images.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    document.addEventListener('keydown', onKey);
    // Lock background scroll while open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [go, onClose]);

  const handleTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(delta) > 50 && images.length > 1) go(delta < 0 ? 1 : -1);
    touchStartX.current = null;
  };

  const src = images[current];
  if (!src) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
    >
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close image viewer"
        className="absolute top-4 right-4 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
      >
        <X size={22} />
      </button>

      {images.length > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); go(-1); }}
          aria-label="Previous image"
          className="absolute left-2 sm:left-4 z-10 w-11 h-11 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
        >
          <ChevronLeft size={26} />
        </button>
      )}

      <div
        className="relative w-full h-full flex items-center justify-center p-4 sm:p-10"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Plain <img> (not next/image) so the full, uncropped picture fits the
            viewport via object-contain without layout/fill constraints. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={`Image ${current + 1} of ${images.length}`}
          className="max-w-full max-h-full object-contain select-none"
          referrerPolicy="no-referrer"
          draggable={false}
        />
      </div>

      {images.length > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); go(1); }}
          aria-label="Next image"
          className="absolute right-2 sm:right-4 z-10 w-11 h-11 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
        >
          <ChevronRight size={26} />
        </button>
      )}

      {images.length > 1 && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-2 z-10">
          {images.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === current ? 'w-5 bg-white' : 'w-1.5 bg-white/40'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Feed image grid. Thumbnails are cropped (object-cover) into a 1/2/3-up
 * layout; each is tappable and opens the uncropped lightbox at that index.
 */
export const PostImageGrid: React.FC<{ images: string[]; priority?: boolean; onOpen: (index: number) => void }> = ({ images, priority = false, onOpen }) => {
  if (images.length === 0) return null;

  const cell = (src: string, i: number, extra = '') => (
    <button
      key={i}
      type="button"
      onClick={() => onOpen(i)}
      className={`relative bg-stone-100 overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-gold ${extra}`}
      aria-label={`Open image ${i + 1}`}
    >
      <Image src={src} alt={`Post image ${i + 1}`} fill sizes="(max-width: 768px) 100vw, 800px" priority={priority && i === 0} className="object-cover" referrerPolicy="no-referrer" />
    </button>
  );

  if (images.length === 1) {
    return (
      <div className="rounded-xl overflow-hidden mb-3 h-72 sm:h-80">
        {cell(images[0], 0, 'w-full h-full')}
      </div>
    );
  }

  if (images.length === 2) {
    return (
      <div className="grid grid-cols-2 gap-1 rounded-xl overflow-hidden mb-3 h-64">
        {images.map((src, i) => cell(src, i, 'w-full h-full'))}
      </div>
    );
  }

  // 3 images → one big on the left, two stacked on the right.
  return (
    <div className="grid grid-cols-2 grid-rows-2 gap-1 rounded-xl overflow-hidden mb-3 h-80">
      {cell(images[0], 0, 'row-span-2 w-full h-full')}
      {cell(images[1], 1, 'w-full h-full')}
      {cell(images[2], 2, 'w-full h-full')}
    </div>
  );
};

/** Resolve a post's renderable image list: prefer imageUrls, fall back to the legacy single imageUrl. */
export const postImages = (post: { imageUrls?: string[]; imageUrl?: string }): string[] => {
  if (post.imageUrls && post.imageUrls.length > 0) return post.imageUrls.slice(0, 3);
  if (post.imageUrl) return [post.imageUrl];
  return [];
};
