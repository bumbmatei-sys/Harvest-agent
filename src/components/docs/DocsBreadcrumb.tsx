"use client";
import React from 'react';
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from '../ui/breadcrumb';
import { folderPath } from './docs-tree-model';
import type { DocFolder } from '../../hooks/queries/useDocsQueries';

/**
 * Where the open note lives — the folder chain above the editor.
 *
 * The old screen answered this with a single "All docs / <name>" row that only
 * ever knew about ROOT folders, so a note three levels down showed nothing
 * useful. This walks the real `parentId` chain (see `folderPath`, which is
 * cycle-safe), so the depth on screen is the depth in the data.
 *
 * A note at the root renders "Notes" alone rather than an empty strip, so the
 * header does not change height when you move between a filed note and an
 * unfiled one.
 */

export interface DocsBreadcrumbProps {
  folderId: string | null | undefined;
  folders: DocFolder[];
  /** The note's own title, shown as the current page at the end of the chain. */
  title: string;
  /** Reveal a folder in the tree. Omitted makes the crumbs plain text. */
  onSelectFolder?: (folderId: string) => void;
}

const DocsBreadcrumb: React.FC<DocsBreadcrumbProps> = ({ folderId, folders, title, onSelectFolder }) => {
  const chain = folderPath(folderId, folders);

  return (
    <Breadcrumb data-testid="docs-breadcrumb">
      <BreadcrumbList className="flex-nowrap gap-1 sm:gap-1.5">
        <BreadcrumbItem>
          <span className="text-faint">Notes</span>
        </BreadcrumbItem>
        {chain.map(f => (
          <React.Fragment key={f.id}>
            <BreadcrumbSeparator />
            <BreadcrumbItem className="min-w-0">
              {onSelectFolder ? (
                <BreadcrumbLink
                  render={<button type="button" onClick={() => onSelectFolder(f.id)} />}
                  className="truncate"
                >
                  {f.name}
                </BreadcrumbLink>
              ) : (
                <span className="truncate">{f.name}</span>
              )}
            </BreadcrumbItem>
          </React.Fragment>
        ))}
        <BreadcrumbSeparator />
        <BreadcrumbItem className="min-w-0">
          <BreadcrumbPage className="truncate">{title || 'Untitled'}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
};

export default DocsBreadcrumb;
