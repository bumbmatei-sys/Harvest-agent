'use client';

import { useLayoutEffect, useState } from 'react';

/** The admin's existing desktop breakpoint (`lg`, 1024px). */
const QUERY = '(min-width: 1024px)';

/**
 * True at the width the new sidebar is allowed to mount.
 *
 * Below `lg` the component stays unmounted, so the shadcn Sidebar never
 * takes its mobile Sheet path. The bottom nav is unchanged.
 */
function readLg(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia(QUERY).matches;
  } catch {
    return false;
  }
}

export function useLgUp(): boolean {
  const [matches, setMatches] = useState(readLg);

  useLayoutEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia(QUERY);
    } catch {
      return;
    }
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, []);

  return matches;
}
