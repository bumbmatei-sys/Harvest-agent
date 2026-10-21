"use client";

import React from 'react';
import ThemeToggle from '../ThemeToggle';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from '@/components/ui/item';

/**
 * Palette + light/dark row. Same control AdminSettings already mounted in the
 * Appearance accordion — extracted so the desktop popup can reuse it without
 * a second stamping path.
 */
export default function AppearanceRow() {
  return (
    <Item className="flex-wrap justify-between gap-3 p-0">
      <ItemContent className="flex-none">
        <ItemTitle className="text-sm font-semibold text-strong">Colour theme</ItemTitle>
        <ItemDescription className="text-sm text-muted">
          Palette and light/dark, for your account on this device. System follows your device setting.
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <ThemeToggle variant="row" />
      </ItemActions>
    </Item>
  );
}
