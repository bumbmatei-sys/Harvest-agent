"use client";
import React, { useEffect } from 'react';
import { FileText, Share2 } from 'lucide-react';
import {
  Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '../ui/command';
import { folderPath } from './docs-tree-model';
import { SHARED_GROUP_LABEL } from './DocsTree';
import type { Doc, DocFolder } from '../../hooks/queries/useDocsQueries';

/**
 * ⌘K — jump to a note by name.
 *
 * This screen had NO search of any kind before THE-275; a note you could not
 * see in the tree could only be found by opening folders until it appeared.
 *
 * ── Why the two groups are separate here too ─────────────────────────────────
 * The same boundary the tree draws: `docs` is tenant-scoped and `sharedDocs` is
 * viewer-scoped (`sharedWith array-contains uid`, no tenant constraint), so the
 * second set can contain a note from another church. Merging them into one
 * result list would present a foreign note as one of this church's, and the
 * folder path shown beneath it would be resolved against THIS church's folders —
 * a path that is not the note's. Shared notes are listed under their own
 * heading and carry no path.
 *
 * ── The `<Command>` wrapper is load-bearing ──────────────────────────────────
 * This repo's `CommandDialog` renders `Dialog > DialogContent > children` and
 * does NOT wrap its children in `<Command>` the way the upstream shadcn one
 * does. Without it every `CommandItem` renders outside cmdk's store and throws
 * ("Cannot read properties of undefined (reading 'subscribe')"). Keep it.
 */

export interface DocsQuickSwitcherProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docs: Doc[];
  folders: DocFolder[];
  sharedDocs: Doc[];
  onOpenDoc: (d: Doc) => void;
}

/**
 * Bind ⌘K / Ctrl-K.
 *
 * Exported so the shortcut can be asserted on its own. `keydown` on `window`
 * rather than on a node inside the screen, because the switcher's whole job is
 * to be reachable when focus is in the editor body — which is a contenteditable
 * that swallows key handling below it.
 */
export const useQuickSwitcherShortcut = (onOpen: () => void) => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key?.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      onOpen();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onOpen]);
};

const DocsQuickSwitcher: React.FC<DocsQuickSwitcherProps> = ({
  open, onOpenChange, docs, folders, sharedDocs, onOpenDoc,
}) => {
  const choose = (d: Doc) => {
    onOpenChange(false);
    onOpenDoc(d);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search notes"
      description="Jump to a note by name.">
      <Command>
        <CommandInput placeholder="Search notes…" data-testid="docs-switcher-input" />
        <CommandList>
          <CommandEmpty>No notes found.</CommandEmpty>
          {docs.length > 0 && (
            <CommandGroup heading="Notes">
              {docs.map(d => {
                const path = folderPath(d.folderId, folders).map(f => f.name).join(' / ');
                return (
                  <CommandItem
                    key={d.id}
                    // cmdk matches on `value`; the folder path is in it so
                    // "budget" and "Finance" both reach the same note.
                    value={`${d.title || 'Untitled'} ${path}`}
                    data-switcher-doc-id={d.id}
                    onSelect={() => choose(d)}
                  >
                    <FileText />
                    <span className="truncate">{d.title || 'Untitled'}</span>
                    {path && <span className="ms-auto truncate text-xs text-faint">{path}</span>}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}
          {sharedDocs.length > 0 && (
            <CommandGroup heading={SHARED_GROUP_LABEL}>
              {sharedDocs.map(d => (
                <CommandItem
                  key={d.id}
                  value={d.title || 'Untitled'}
                  data-switcher-shared-id={d.id}
                  onSelect={() => choose(d)}
                >
                  <Share2 />
                  <span className="truncate">{d.title || 'Untitled'}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
};

export default DocsQuickSwitcher;
