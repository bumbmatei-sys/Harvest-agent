"use client";
import { useEffect, useState } from 'react';
import type { ResolvedTheme } from './theme';

/**
 * The theme currently stamped on <html>, kept live.
 *
 * The toggle and the pre-paint script both write `data-theme` on the root
 * element, so this observes that attribute rather than re-reading storage. That
 * matters for anything whose styling is NOT CSS — a Leaflet tile URL, a canvas,
 * a chart — because those cannot react to a CSS variable changing and have to
 * be told in JS.
 *
 * Returns 'light' during SSR and the first client render so markup is stable;
 * the effect corrects it before paint-relevant work happens.
 */
export function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>('light');

  useEffect(() => {
    const read = (): ResolvedTheme =>
      document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';

    setTheme(read());

    // The toggle stamps the attribute directly rather than going through React,
    // so an observer is the only way to hear about it. Watching `class` too
    // covers anything that flips the `.dark` hook instead.
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}
