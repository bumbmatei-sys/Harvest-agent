'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Spinner } from '@/components/ui/spinner';

import { CONTENT_TYPES, CONTENT_TYPE_ORDER } from './content-types';
import { groupHits, indexEntries, searchIndexed, type HitGroup } from './match';
import { useContentIndex } from './use-content-index';
import type { ReadDocs } from './sources';
import type { ContentTypeId, SearchEntry } from './types';

/** A section of the admin, as the palette lists it. */
export interface PalettePage {
  readonly key: string;
  readonly label: string;
  /** The heading it sits under while the search box is empty. */
  readonly group: string;
  readonly icon?: LucideIcon;
  readonly onSelect: () => void;
}

/** Where a content hit goes: a tab, and the item inside it when that screen can open one. */
export interface PaletteTarget {
  readonly tab: string;
  readonly itemId?: string | null;
}

export interface PaletteSearchConfig {
  /** Null (a platform admin with no tenant in context) turns content search off; pages still work. */
  readonly tenantId: string | null;
  readonly uid: string | null;
  /** The admin tab ids this viewer holds. Built from the same checks that build the sidebar. */
  readonly access: ReadonlySet<string>;
  readonly onOpenItem: (target: PaletteTarget) => void;
  /** Replaces the Firestore read. Tests only. */
  readonly read?: ReadDocs;
}

const NO_ACCESS: ReadonlySet<string> = new Set();

/**
 * The selected row is the one Enter opens, and the primitive's own muted tint is
 * close to the popover on a bright screen. A thin brand-colour edge makes the
 * row Enter will open obvious without a second palette.
 */
const ROW_CLASS = 'data-[selected=true]:ring-1 data-[selected=true]:ring-inset data-[selected=true]:ring-action/40';

/** Typing settles for this long before the (in-memory) match re-runs. No Firestore read ever happens per keystroke. */
export const SEARCH_DEBOUNCE_MS = 120;

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

function GroupHeading({ type }: { type: ContentTypeId }) {
  const { icon: Icon, label } = CONTENT_TYPES[type];
  return (
    <span className="flex items-center gap-1.5" data-search-group-heading={type}>
      <Icon className="size-3.5 text-action" aria-hidden />
      {label}
    </span>
  );
}

export function AdminSearchPalette({
  open,
  onOpenChange,
  pages,
  search,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pages: readonly PalettePage[];
  search?: PaletteSearchConfig;
}) {
  const [query, setQuery] = useState('');
  const settled = useDebounced(query, SEARCH_DEBOUNCE_MS).trim();
  // The first character is matched at once; later keystrokes wait for typing to settle.
  const term = query.trim() ? settled || query.trim() : '';
  const contentSearch = !!search?.tenantId && !!search.uid;

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const { status, index } = useContentIndex({
    open,
    tenantId: search?.tenantId ?? null,
    uid: search?.uid ?? null,
    access: search?.access ?? NO_ACCESS,
    read: search?.read,
  });

  const pageItems = useMemo(
    () => indexEntries(pages.map((p): SearchEntry => ({ type: 'page', id: p.key, title: p.label }))),
    [pages],
  );
  const pageByKey = useMemo(() => new Map(pages.map((p) => [p.key, p])), [pages]);

  const groups = useMemo<HitGroup[]>(() => {
    if (!term) return [];
    const hits = searchIndexed([...pageItems, ...(index?.items ?? [])], term);
    return groupHits(hits, CONTENT_TYPE_ORDER);
  }, [term, pageItems, index]);

  const close = () => onOpenChange(false);

  const openEntry = (entry: SearchEntry) => {
    if (entry.type === 'page') {
      pageByKey.get(entry.id)?.onSelect();
      return;
    }
    const meta = CONTENT_TYPES[entry.type];
    close();
    search?.onOpenItem({ tab: meta.tab, itemId: meta.deepLink ? entry.itemId : null });
  };

  const loading = contentSearch && status === 'loading';
  const failures = index?.failures ?? [];
  const truncated = index?.truncated ?? [];

  // Home and the sections, as they were before there was anything to search: grouped under their headings.
  const browse = () => {
    const byGroup = new Map<string, PalettePage[]>();
    for (const page of pages) {
      const list = byGroup.get(page.group);
      if (list) list.push(page);
      else byGroup.set(page.group, [page]);
    }
    return [...byGroup.entries()].map(([heading, items]) => (
      <CommandGroup key={heading} heading={heading}>
        {items.map((page) => (
          <CommandItem key={page.key} value={`page:${page.key}`} onSelect={page.onSelect}>
            {page.icon ? <page.icon /> : null}
            {page.label}
          </CommandItem>
        ))}
      </CommandGroup>
    ));
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description={contentSearch ? 'Search pages, people, notes, courses and more' : 'Jump to a section'}
      className="sm:max-w-xl"
    >
      <Command shouldFilter={false} loop data-admin-search-palette>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={contentSearch ? 'Search pages, people, notes, courses…' : 'Search sections'}
        />
        <CommandList className="max-h-[min(24rem,60vh)]">
          {term ? (
            <>
              {groups.length === 0 && !loading ? (
                <CommandEmpty>No results for “{term}”</CommandEmpty>
              ) : null}
              {groups.map((group) => {
                const meta = CONTENT_TYPES[group.type];
                return (
                  <CommandGroup key={group.type} heading={<GroupHeading type={group.type} />}>
                    {group.shown.map(({ entry }) => {
                      const Icon = meta.icon;
                      return (
                        <CommandItem
                          key={`${entry.type}:${entry.id}`}
                          value={`${entry.type}:${entry.id}`}
                          data-search-result={entry.type}
                          className={ROW_CLASS}
                          onSelect={() => openEntry(entry)}
                        >
                          <Icon aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                          {entry.subtitle ? (
                            <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">
                              {entry.subtitle}
                            </span>
                          ) : null}
                        </CommandItem>
                      );
                    })}
                    {group.type !== 'page' && group.total > group.shown.length ? (
                      <CommandItem
                        value={`see-all:${group.type}`}
                        data-search-see-all={group.type}
                        className={ROW_CLASS}
                        onSelect={() => {
                          close();
                          search?.onOpenItem({ tab: meta.tab });
                        }}
                      >
                        <ChevronRight aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          See all {group.total} {meta.plural}
                        </span>
                      </CommandItem>
                    ) : null}
                  </CommandGroup>
                );
              })}
            </>
          ) : (
            browse()
          )}
        </CommandList>
        {contentSearch && (loading || failures.length > 0 || (term && truncated.length > 0) || status === 'error') ? (
          <div
            data-search-notes
            role="status"
            className="flex flex-col gap-1 border-t border-border px-3 py-2 text-xs text-muted-foreground"
          >
            {loading ? (
              <span className="flex items-center gap-2" data-search-loading>
                <Spinner className="size-3.5" />
                Loading your content…
              </span>
            ) : null}
            {status === 'error' ? <span>Your content could not be searched. Pages still work.</span> : null}
            {failures.length > 0 ? (
              <span>
                {joinLabels(failures.map((f) => f.label))} could not be searched
                {failures.every((f) => f.reason === 'denied') ? ': access was refused.' : '. Reopen search to try again.'}
              </span>
            ) : null}
            {term && truncated.length > 0 ? (
              <span>
                {joinLabels(truncated.map((t) => t.label))} {truncated.length === 1 ? 'is' : 'are'} only partly searched.
                Open the list to search all of it.
              </span>
            ) : null}
          </div>
        ) : null}
      </Command>
    </CommandDialog>
  );
}
