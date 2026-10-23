import { indexEntries } from './match';
import { CONTENT_SOURCES, SEARCHABLE_TABS, type ContentSource, type ReadDocs } from './sources';
import type { IndexedEntry, SearchEntry } from './types';

/**
 * The palette's in-memory index of the current tenant's content.
 *
 * Loaded lazily the first time the palette opens, kept for the session, and
 * refreshed on the next open once it is older than `INDEX_TTL_MS`. It is a
 * module-level, single-slot cache: the slot is keyed by tenant, user and the
 * tabs that user holds, and a different key evicts the old one, so one person's
 * content is never served to the next person who signs in on the same tab.
 *
 * Nothing here logs, reports or sends what it holds. Failures are reduced to a
 * list label and a coarse reason before they leave this module.
 */

/** How long an index is served without a refresh on reopen. */
export const INDEX_TTL_MS = 5 * 60 * 1000;

export interface SourceFailure {
  readonly source: string;
  readonly label: string;
  readonly reason: 'denied' | 'failed';
}

export interface SourceTruncation {
  readonly label: string;
}

export interface ContentIndex {
  readonly items: readonly IndexedEntry[];
  readonly failures: readonly SourceFailure[];
  /** Lists whose read stopped at the cap: only part of them was searched. */
  readonly truncated: readonly SourceTruncation[];
  readonly loadedAt: number;
}

export interface BuildOptions {
  readonly tenantId: string;
  readonly access: ReadonlySet<string>;
  readonly read: ReadDocs;
  readonly sources?: readonly ContentSource[];
  readonly now?: () => number;
}

function failureReason(error: unknown): 'denied' | 'failed' {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'permission-denied' ? 'denied' : 'failed';
}

/** Run every source the viewer's tabs switch on, in parallel. One failing list does not stop the others. */
export async function buildContentIndex(options: BuildOptions): Promise<ContentIndex> {
  const { tenantId, access, read, sources = CONTENT_SOURCES, now = Date.now } = options;
  const active = sources.filter((s) => s.enabled(access));
  const settled = await Promise.allSettled(active.map((s) => s.load({ tenantId, read })));

  const entries: SearchEntry[] = [];
  const failures: SourceFailure[] = [];
  const truncated: SourceTruncation[] = [];
  settled.forEach((result, i) => {
    const source = active[i];
    if (result.status === 'fulfilled') {
      entries.push(...result.value.entries);
      if (result.value.truncated) truncated.push({ label: source.label });
    } else {
      failures.push({ source: source.id, label: source.label, reason: failureReason(result.reason) });
    }
  });
  return { items: indexEntries(entries), failures, truncated, loadedAt: now() };
}

/** The cache key. Only tabs some source reads count, so unrelated nav changes do not evict. */
export function indexKey(tenantId: string, uid: string, access: ReadonlySet<string>): string {
  const tabs = [...access].filter((t) => SEARCHABLE_TABS.has(t)).sort();
  return `${tenantId}|${uid}|${tabs.join(',')}`;
}

interface Slot {
  key: string;
  index: ContentIndex | null;
  inflight: Promise<ContentIndex> | null;
}

let slot: Slot | null = null;

/** Drop everything held. Used by tests and on sign-out. */
export function clearContentIndex(): void {
  slot = null;
}

/** The held index for this key, whatever its age, or null. */
export function peekContentIndex(key: string): ContentIndex | null {
  return slot && slot.key === key ? slot.index : null;
}

/** A held index is fresh while it is young AND every list loaded. A list that failed is retried on the next open. */
export function isFresh(index: ContentIndex, now: number): boolean {
  return index.failures.length === 0 && now - index.loadedAt < INDEX_TTL_MS;
}

/**
 * The index for this key: the held one if fresh, else a new load. Concurrent
 * callers share one load. A load that throws outright leaves the slot as it was.
 */
export function ensureContentIndex(key: string, options: BuildOptions): Promise<ContentIndex> {
  const now = (options.now ?? Date.now)();
  if (slot && slot.key !== key) slot = null;
  if (slot?.index && isFresh(slot.index, now)) return Promise.resolve(slot.index);
  if (slot?.inflight) return slot.inflight;

  const current: Slot = slot ?? { key, index: null, inflight: null };
  slot = current;
  const load = buildContentIndex(options).then(
    (index) => {
      if (slot === current) {
        current.index = index;
        current.inflight = null;
      }
      return index;
    },
    (error) => {
      if (slot === current) current.inflight = null;
      throw error;
    },
  );
  current.inflight = load;
  return load;
}
