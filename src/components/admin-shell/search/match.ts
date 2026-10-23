import { digitsOf, normalizeText } from './normalize';
import type { ContentTypeId, IndexedEntry, SearchEntry, SearchHit } from './types';

/** Build the comparable form of an entry. Done once per load, never per keystroke. */
export function indexEntry(entry: SearchEntry): IndexedEntry {
  const titleKey = normalizeText(entry.title);
  const extraKeys: string[] = [];
  const extraDigits: string[] = [];
  for (const raw of entry.extra ?? []) {
    const key = normalizeText(raw);
    if (!key) continue;
    extraKeys.push(key);
    const digits = digitsOf(raw);
    if (digits.length >= 3) extraDigits.push(digits);
  }
  // The subtitle is matched too: "Grace Church" finds the campus whose subtitle says so.
  const subtitleKey = normalizeText(entry.subtitle);
  if (subtitleKey) extraKeys.push(subtitleKey);
  return { entry, titleKey, titleWords: titleKey.split(' ').filter(Boolean), extraKeys, extraDigits };
}

export function indexEntries(entries: readonly SearchEntry[]): IndexedEntry[] {
  return entries.map(indexEntry);
}

/** A term that is only digits and phone punctuation, with three or more digits. */
function phoneLikeDigits(term: string): string | null {
  if (!/^[\d\s()+\-.]+$/.test(term)) return null;
  const digits = digitsOf(term);
  return digits.length >= 3 ? digits : null;
}

/**
 * 0 when the entry does not match, else a tier:
 *   5 the title is the query          4 the title starts with it
 *   3 every term starts a title word  2 the title contains every term
 *   1 every term is found somewhere (title, subtitle, email, phone, body preview)
 * Every term has to be found. "joh smi" finds "John Smith"; "john zzz" finds nothing.
 */
export function scoreIndexed(item: IndexedEntry, query: string): number {
  if (!query) return 0;
  const terms = query.split(' ').filter(Boolean);
  if (terms.length === 0) return 0;

  if (item.titleKey === query) return 5;
  if (item.titleKey.startsWith(query)) return 4;
  if (terms.every((t) => item.titleWords.some((w) => w.startsWith(t)))) return 3;
  if (terms.every((t) => item.titleKey.includes(t))) return 2;

  const found = terms.every((t) => {
    if (item.titleKey.includes(t)) return true;
    if (item.extraKeys.some((x) => x.includes(t))) return true;
    const digits = phoneLikeDigits(t);
    return digits !== null && item.extraDigits.some((d) => d.includes(digits));
  });
  return found ? 1 : 0;
}

const byTitle = (a: SearchEntry, b: SearchEntry) =>
  a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });

/** Matching entries, best tier first, then most recently touched, then A to Z. */
export function searchIndexed(items: readonly IndexedEntry[], rawQuery: string): SearchHit[] {
  const query = normalizeText(rawQuery);
  if (!query) return [];
  const hits: SearchHit[] = [];
  for (const item of items) {
    const score = scoreIndexed(item, query);
    if (score > 0) hits.push({ entry: item.entry, score });
  }
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      (b.entry.updatedAt ?? 0) - (a.entry.updatedAt ?? 0) ||
      byTitle(a.entry, b.entry),
  );
  return hits;
}

export interface HitGroup {
  readonly type: ContentTypeId;
  /** Every match of this type, not just the ones shown. */
  readonly total: number;
  readonly shown: readonly SearchHit[];
}

/** Maximum rows a group shows before it offers "See all". */
export const GROUP_LIMIT = 5;

/** Groups ranked hits by type, in the order given, `limit` rows each. Empty groups are dropped. */
export function groupHits(
  hits: readonly SearchHit[],
  order: readonly ContentTypeId[],
  limit: number = GROUP_LIMIT,
): HitGroup[] {
  const byType = new Map<ContentTypeId, SearchHit[]>();
  for (const hit of hits) {
    const list = byType.get(hit.entry.type);
    if (list) list.push(hit);
    else byType.set(hit.entry.type, [hit]);
  }
  const groups: HitGroup[] = [];
  for (const type of order) {
    const list = byType.get(type);
    if (list && list.length > 0) groups.push({ type, total: list.length, shown: list.slice(0, limit) });
  }
  return groups;
}
