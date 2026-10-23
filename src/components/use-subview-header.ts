import { useEffect, useRef } from 'react';

import { useAdminHeader } from './AdminScreenHeader';

/**
 * A sub-view (an editor, a detail page) publishes where it is and how to leave it.
 *
 * That is the whole back affordance. The desktop top bar draws it as a breadcrumb
 * whose parent is a link (`Products > Courses > This course`), and the phone header
 * draws it as the back chevron, so a screen no longer carries its own "Back to ..."
 * button. Pass `null` while there is no sub-view open.
 */
export function useSubviewHeader(subview: { title: string; onBack: () => void } | null): void {
  const { setHeaderOverride } = useAdminHeader();
  const backRef = useRef<(() => void) | null>(null);
  backRef.current = subview ? subview.onBack : null;
  const title = subview ? subview.title : null;
  useEffect(() => {
    if (title === null) return;
    // Optional-called: a screen mounted under a partial context (a test, a preview) has no
    // override slot, and it must still render.
    setHeaderOverride?.({ title, onBack: () => backRef.current?.() });
    return () => setHeaderOverride?.(null);
  }, [title, setHeaderOverride]);
}
