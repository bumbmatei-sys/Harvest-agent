"use client";

import * as React from 'react';
import { useDocs } from '@/hooks/queries/useDocsQueries';
import { useContacts } from '@/hooks/queries/useCRMQueries';
import { useEvents } from '@/hooks/queries/useEventQueries';
import { sortByTime } from '@/utils/query-helpers';

/**
 * THE-334 — the "Recent" block pinned to the bottom of a nav-rail flyout.
 *
 * The founder, after seeing the panel take ClickUp's shape: "also under the
 * list show the recent things like in clickup. Latest notes, latest forms,
 * latest etc." ClickUp's own reference panel puts a headed "Recent Chats" group
 * under a separator, and pins a footer under THAT — but its footer is "Brain AI
 * uses / Credits left", which the founder ruled out himself ("it's their AI, we
 * don't have such thing yet"). So the RECENTS take the pinned-footer slot: real
 * data the product already has, held at the floor of the panel where a long
 * section list cannot scroll it away, instead of an invented usage meter.
 *
 * ── 🔴 Why there is no Firestore index here, and why that is the point ───────
 * The obvious build is `orderBy('updatedAt', 'desc').limit(5)` per collection.
 * ⚠️ THAT WOULD SHIP BROKEN. A composite `where(tenant) + orderBy(updatedAt)`
 * needs an index in `firestore.indexes.json`, and `.github/workflows/
 * deploy-rules.yml` triggers only on `firestore.rules`, `storage.rules` and
 * `firebase.json` and runs `firebase deploy --only firestore:rules,storage` —
 * it NEVER deploys `firestore:indexes`. An index added there is INERT, the
 * query fails, and `useDocsQueries` records that the failure is SILENT, so the
 * block would simply render empty in production with nothing in the logs. The
 * founder was shown this and chose the index-free path.
 *
 * So every source here is a query the app ALREADY makes, needing no new index:
 * `useDocs` is tenant-scoped with NO `orderBy` and is already returned
 * `updatedAt`-descending in memory; `useContacts` is the same read, re-sorted
 * here because it arrives alphabetical; `useEvents` is a single-field
 * `orderBy('startDate')` on a subcollection, which Firestore indexes
 * automatically. Nothing new is read from Firestore that some screen did not
 * already read, and React Query dedupes the key when that screen is open.
 *
 * ── Why this is a component and not a hook in the shell ─────────────────────
 * 🔴 It mounts INSIDE the popup, and Base UI unmounts a closed popup. So the
 * query runs when a panel is actually opened and not before — an admin who
 * never opens CONTENT never reads `docs`. Hoisting this into `AdminDashboard`
 * would have made every admin fetch notes, contacts and events on every page
 * load to populate three panels they may never open.
 *
 * ── Which groups get one, and why not all four ──────────────────────────────
 * ⚠️ CONTENT, MINISTRY and BROADCASTING have a real recency source. GROW —
 * affiliate, branding, library, tenants, inbox — has NO per-item recency to
 * show, and inventing one (or listing its tabs again under a "Recent" heading)
 * would be a footer that lies. It gets no footer, which is why the block is
 * rendered only for the groups in `RAIL_RECENT_GROUPS`.
 */

/** How many recents a panel shows. Small deliberately: this is a pinned footer
 *  competing for height with the section list above it, not a second nav. */
export const RAIL_RECENTS_LIMIT = 4;

/** The groups with a genuine recency source. GROW is absent on purpose. */
export const RAIL_RECENT_GROUPS: readonly string[] = ['CONTENT', 'MINISTRY', 'BROADCASTING'];

/** What each group's block is called, and which tab a row opens. */
const SOURCE: Record<string, { heading: string; tab: string }> = {
  CONTENT: { heading: 'Recent notes', tab: 'docs' },
  MINISTRY: { heading: 'Recent people', tab: 'crm' },
  BROADCASTING: { heading: 'Recent events', tab: 'events' },
};

export type NavRailRecentsProps = {
  /** The group whose panel this is — `CONTENT`, `MINISTRY`, `BROADCASTING`. */
  group: string;
  tenantId: string | null | undefined;
  isAuthReady: boolean;
  /**
   * Opens a tab, deep-linking to the item when the screen accepts one.
   * `AdminDocs` takes `initialDocId` and `AdminCRM` takes `initialContactId`,
   * so a note and a person open ON the thing you picked. ⚠️ No events screen
   * consumes `:itemId`, so an event row opens the Events tab and stops there
   * rather than pushing a URL nothing reads.
   */
  onOpenItem: (tab: string, itemId?: string) => void;
};

export function NavRailRecents({ group, tenantId, isAuthReady, onOpenItem }: NavRailRecentsProps) {
  const source = SOURCE[group];

  /* 🔴 All three hooks are called unconditionally — rules of hooks — and all but
     the one this panel needs is DISABLED through the `isAuthReady` flag each
     already takes as its `enabled`. No new query shape is introduced. */
  const wantsDocs = group === 'CONTENT';
  const wantsContacts = group === 'MINISTRY';
  const wantsEvents = group === 'BROADCASTING';

  const docs = useDocs(tenantId, isAuthReady && wantsDocs);
  const contacts = useContacts(tenantId, isAuthReady && wantsContacts);
  const events = useEvents(tenantId, isAuthReady && wantsEvents);

  const { items, loading } = React.useMemo(() => {
    if (wantsDocs) {
      // Already `updatedAt`-descending: `useDocs` sorts in memory on read.
      const rows = (docs.data?.items ?? []).slice(0, RAIL_RECENTS_LIMIT);
      return {
        loading: docs.isLoading,
        items: rows.map((d) => ({ id: d.id, label: d.title?.trim() || 'Untitled note' })),
      };
    }
    if (wantsContacts) {
      // Arrives sorted by surname, so recency is applied here with the same
      // shared helper `useDocs` uses rather than a second sort written by hand.
      const rows = sortByTime([...(contacts.data ?? [])], 'updatedAt', 'desc')
        .slice(0, RAIL_RECENTS_LIMIT);
      return {
        loading: contacts.isLoading,
        items: rows.map((c) => ({
          id: c.id,
          label: `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || c.email || 'Unnamed contact',
        })),
      };
    }
    if (wantsEvents) {
      // Already `startDate`-descending from the query itself.
      const rows = (events.data ?? []).slice(0, RAIL_RECENTS_LIMIT);
      return {
        loading: events.isLoading,
        items: rows.map((e) => ({ id: e.id, label: e.title?.trim() || 'Untitled event' })),
      };
    }
    return { loading: false, items: [] as { id: string; label: string }[] };
  }, [wantsDocs, wantsContacts, wantsEvents, docs.data, docs.isLoading, contacts.data, contacts.isLoading, events.data, events.isLoading]);

  if (!source) return null;

  return (
    <div data-nav-rail-recents={group}>
      <div className="px-3 pb-1 text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">
        {source.heading}
      </div>
      {loading ? (
        <div className="px-3 py-2 text-[13px] text-faint">Loading…</div>
      ) : items.length === 0 ? (
        <div className="px-3 py-2 text-[13px] text-faint">Nothing yet</div>
      ) : (
        items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpenItem(source.tab, wantsEvents ? undefined : item.id)}
            data-nav-rail-recent={item.id}
            /* `min-h-11` is 44px — a flyout row is a tap target, and this one is
               measured by THE-334's guard on both axes alongside the rail
               entries and the section rows. */
            className="w-full flex items-center gap-3 px-3 min-h-11 rounded-xl text-left text-muted hover:text-strong hover:bg-surface-sunken transition-all"
          >
            <span className="text-[13px] font-medium truncate">{item.label}</span>
          </button>
        ))
      )}
    </div>
  );
}
