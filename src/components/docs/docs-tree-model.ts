import type { Doc, DocFolder } from '../../hooks/queries/useDocsQueries';
import { sortByTime } from '../../utils/query-helpers';

/**
 * The shape of the notes tree, as data.
 *
 * Every function here is pure and takes the arrays the hooks already return, so
 * the tree's structure can be asserted without rendering anything and the
 * component is left with nothing to decide. The persisted shape of `Doc` and
 * `DocFolder` is READ here and never written: THE-275 changes how the tree is
 * presented, not what is stored.
 */

/**
 * How many notes the Recents group shows.
 *
 * Three, because that is the number that was asked for. It is a constant rather
 * than a literal at the call site so "Recents shows exactly 3" is one fact in
 * one place, and the test can assert the rendered count against it.
 */
export const RECENTS_COUNT = 3;

/**
 * The most recently edited notes, newest first.
 *
 * Sorted here rather than trusted from `useDocs` — that hook happens to sort by
 * `updatedAt` today, but Recents is the one place where the order IS the
 * feature, so it does not ride on another module's incidental ordering.
 *
 * `sortByTime` sends a null `updatedAt` to the top of a descending sort
 * (`tsMillis` maps null to MAX_SAFE_INTEGER). That is the right answer here and
 * not an accident to work around: a note created seconds ago carries a
 * `serverTimestamp()` that has not resolved yet, and it is genuinely the most
 * recent thing the user touched.
 */
export const recentDocs = (docs: Doc[], count: number = RECENTS_COUNT): Doc[] =>
  sortByTime(docs, 'updatedAt', 'desc').slice(0, count);

/** Folders directly inside `parentId` (`null` for the roots), in `order`. */
export const childFolders = (folders: DocFolder[], parentId: string | null): DocFolder[] =>
  folders.filter(f => (f.parentId ?? null) === parentId);

/**
 * The notes filed directly in `folderId` (`null` for the root), pinned first.
 *
 * The pinned-first comparator is the one this screen already used for its root
 * list and its folder list; it is moved here rather than restated so the tree
 * and the quick switcher cannot drift apart.
 */
export const docsInFolder = (docs: Doc[], folderId: string | null): Doc[] =>
  docs
    .filter(d => (d.folderId ?? null) === folderId)
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

/**
 * The chain of folders from the root down to `folderId`, inclusive.
 *
 * Cycle-safe on purpose. `parentId` is a free-form string on a document
 * anybody's client can write, so a chain that points back at itself is a
 * possible state of the DATA, not a hypothetical — and the honest failure for
 * one is a short breadcrumb, not a hung tab. A missing parent ends the walk the
 * same way, which is what a folder deleted out from under its children leaves
 * behind.
 */
export const folderPath = (
  folderId: string | null | undefined,
  folders: DocFolder[],
): DocFolder[] => {
  const byId = new Map(folders.map(f => [f.id, f]));
  const seen = new Set<string>();
  const chain: DocFolder[] = [];
  let id = folderId ?? null;
  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = byId.get(id);
    if (!folder) break;
    chain.unshift(folder);
    id = folder.parentId ?? null;
  }
  return chain;
};

/**
 * Every folder id on the path to `folderId`, so the tree can reveal a note's
 * folder without the caller walking the chain a second time.
 */
export const folderPathIds = (
  folderId: string | null | undefined,
  folders: DocFolder[],
): string[] => folderPath(folderId, folders).map(f => f.id);
