"use client";
import React, { useCallback, useEffect, useState } from 'react';
import { Wheat, Square } from 'lucide-react';
import { FAMILY_STORAGE_KEY, type PaletteFamily } from '@/lib/theme';
import { applyTheme, readStoredChoice, readStoredFamily } from '@/lib/theme-runtime';

/**
 * The Harvest / Classic palette-family control.
 *
 * Sibling to ThemeToggle rather than a mode of it: family and mode are
 * orthogonal preferences (see theme.ts), so this is its own tiny radiogroup
 * rather than a third value threaded through ThemeToggle's ThemeChoice type.
 * It deliberately mirrors ThemeToggle's row-variant markup (same pill
 * container, same button shape, same compact sizing) rather than inventing a
 * different control style — the two are meant to read as one system sitting
 * side by side in the Profile row.
 *
 * Only ever rendered at row size: unlike ThemeToggle, nothing else in the app
 * shows a family control today (admin settings only exposes mode), so there
 * is no second call site to size for.
 */

const OPTIONS: ReadonlyArray<{ value: PaletteFamily; label: string; Icon: typeof Wheat }> = [
  { value: 'harvest', label: 'Harvest', Icon: Wheat },
  { value: 'classic', label: 'Classic', Icon: Square },
];

const PaletteFamilyToggle: React.FC = () => {
  // Same SSR/first-paint story as ThemeToggle: default to 'harvest' so markup
  // is stable, then correct from storage in an effect. <html> is already
  // correct either way — the pre-paint script did that.
  const [family, setFamily] = useState<PaletteFamily>('harvest');

  useEffect(() => {
    setFamily(readStoredFamily());
  }, []);

  const select = useCallback((next: PaletteFamily) => {
    setFamily(next);
    try {
      localStorage.setItem(FAMILY_STORAGE_KEY, next);
    } catch {
      // A blocked localStorage must not stop the family from applying for
      // this session — it only means the choice will not survive a reload.
    }
    // Mode is untouched by this control — re-apply whatever mode is already
    // current rather than assuming light, exactly the mirror image of how
    // ThemeToggle's own select() leaves family to applyTheme's default.
    applyTheme(readStoredChoice(), next);
  }, []);

  return (
    <div
      role="radiogroup"
      aria-label="Palette family"
      className="flex items-center gap-0.5 bg-surface-sunken rounded-brand p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = family === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            data-palette-choice={value}
            onClick={() => select(value)}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
              active
                ? 'bg-surface-raised text-strong shadow-[var(--ds-sh-sm)]'
                : 'text-muted hover:text-strong'
            }`}
          >
            <Icon size={12} />
            {label}
          </button>
        );
      })}
    </div>
  );
};

export default PaletteFamilyToggle;
