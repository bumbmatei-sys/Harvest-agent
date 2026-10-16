'use client';

import { useEffect, useState } from 'react';

/** The admin's existing desktop breakpoint (`lg`, 1024px). */
const QUERY = '(min-width: 1024px)';

/**
 * True at the width the new sidebar is allowed to mount.
 *
 * Below `lg` the component stays unmounted, so the shadcn Sidebar never
 * takes its mobile Sheet path. The bottom nav is unchanged.
 */
export function useLgUp(): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(QUERY);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, []);

  return matches;
}
