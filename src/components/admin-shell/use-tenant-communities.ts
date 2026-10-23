import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';

import { db } from '../../firebase';

export interface TenantCommunity {
  readonly id: string;
  readonly name: string;
}

export interface TenantCommunities {
  readonly items: readonly TenantCommunity[];
  /** False until the first snapshot (or error) arrives, so "none yet" is never shown early. */
  readonly loaded: boolean;
  /** A failed read, kept apart from an empty list. */
  readonly error: string | null;
}

/** The most communities the top-bar menu lists. */
export const COMMUNITY_MENU_LIMIT = 50;

/**
 * The tenant's current communities for the top-bar menu. A community is a
 * channel under `tenants/{id}/channels`, the same collection the Community
 * screen manages, so the menu and the screen cannot disagree about what exists.
 * Pass `null` to skip the read (no Community access, or no tenant yet).
 */
export function useTenantCommunities(tenantId: string | null | undefined, enabled = true): TenantCommunities {
  const [state, setState] = useState<TenantCommunities>({ items: [], loaded: false, error: null });

  useEffect(() => {
    if (!tenantId || !enabled) {
      setState({ items: [], loaded: false, error: null });
      return;
    }
    try {
      const q = query(
        collection(db, 'tenants', tenantId, 'channels'),
        orderBy('createdAt', 'desc'),
        limit(COMMUNITY_MENU_LIMIT),
      );
      return onSnapshot(
        q,
        (snap) => {
          setState({
            items: snap.docs.map((d) => ({ id: d.id, name: String(d.data().name ?? 'Untitled community') })),
            loaded: true,
            error: null,
          });
        },
        (err) => {
          console.error('[admin-shell] communities could not be read', err);
          setState({ items: [], loaded: true, error: 'Communities could not be loaded.' });
        },
      );
    } catch (err) {
      // Building the query can throw too (a bad tenant id, a client that is not ready).
      // That is the same failure to the person using the menu, and it is shown, not swallowed.
      console.error('[admin-shell] communities could not be read', err);
      setState({ items: [], loaded: true, error: 'Communities could not be loaded.' });
    }
  }, [tenantId, enabled]);

  return state;
}
