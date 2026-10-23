import { useEffect, useState } from 'react';

import {
  ensureContentIndex,
  indexKey,
  isFresh,
  peekContentIndex,
  type ContentIndex,
} from './content-index';
import { readDocsFromFirestore } from './firestore-read';
import type { ReadDocs } from './sources';

export type ContentIndexStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UseContentIndexOptions {
  /** The palette is open. Nothing loads, or reloads, while it is closed. */
  readonly open: boolean;
  /** No tenant, no content: the palette falls back to pages only. */
  readonly tenantId: string | null;
  readonly uid: string | null;
  readonly access: ReadonlySet<string>;
  readonly read?: ReadDocs;
}

export interface UseContentIndex {
  readonly status: ContentIndexStatus;
  /** The held index, possibly stale while a refresh runs. */
  readonly index: ContentIndex | null;
}

/**
 * Loads the content index when the palette opens. A held index that is still
 * fresh is used as it is (no reads); an older one is shown immediately while
 * the refresh runs behind it.
 */
export function useContentIndex({ open, tenantId, uid, access, read = readDocsFromFirestore }: UseContentIndexOptions): UseContentIndex {
  const enabled = open && !!tenantId && !!uid;
  const key = tenantId && uid ? indexKey(tenantId, uid, access) : '';
  const [state, setState] = useState<UseContentIndex & { key: string }>({ key: '', status: 'idle', index: null });

  useEffect(() => {
    if (!enabled || !tenantId) return;
    let cancelled = false;
    const held = peekContentIndex(key);
    if (held && isFresh(held, Date.now())) {
      setState({ key, status: 'ready', index: held });
      return;
    }
    setState({ key, status: 'loading', index: held });
    ensureContentIndex(key, { tenantId, access, read }).then(
      (index) => { if (!cancelled) setState({ key, status: 'ready', index }); },
      () => { if (!cancelled) setState({ key, status: 'error', index: held }); },
    );
    return () => { cancelled = true; };
    // `access` is represented by `key`; a new Set with the same tabs must not reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, tenantId, read]);

  // A different tenant or user must never see the previous one's index, even for a frame.
  if (!enabled) return { status: 'idle', index: null };
  if (state.key !== key) return { status: 'loading', index: null };
  return { status: state.status, index: state.index };
}
