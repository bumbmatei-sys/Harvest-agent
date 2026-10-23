/**
 * The shapes the palette's content search passes around. No imports, so the
 * matcher and the loaders can be tested without the Firebase SDK or a DOM.
 */

export type ContentTypeId =
  | 'page'
  | 'person'
  | 'subscriber'
  | 'note'
  | 'course'
  | 'lesson'
  | 'event'
  | 'form'
  | 'post'
  | 'service'
  | 'campaign'
  | 'community'
  | 'campus'
  | 'knowledge'
  | 'checkin';

/**
 * One searchable thing: the lightweight fields only. Nothing here is a whole
 * document, and nothing is ever sent anywhere: the index lives in this tab's
 * memory and dies with it.
 */
export interface SearchEntry {
  readonly type: ContentTypeId;
  /** Unique within its type. */
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  /** Milliseconds since the epoch. Only used to break ties between equal matches. */
  readonly updatedAt?: number | null;
  /**
   * Extra text a query may match anywhere: an email, a phone number, a body
   * preview. Matched but never shown on its own.
   */
  readonly extra?: readonly string[];
  /** The id the item's own screen opens by, when that screen can open one. */
  readonly itemId?: string | null;
}

/** An entry with its comparable forms computed once, when the index is built. */
export interface IndexedEntry {
  readonly entry: SearchEntry;
  readonly titleKey: string;
  readonly titleWords: readonly string[];
  readonly extraKeys: readonly string[];
  /** The digit-only form of each extra that has at least three digits (phones). */
  readonly extraDigits: readonly string[];
}

export interface SearchHit {
  readonly entry: SearchEntry;
  /** 5 exact title, 4 title starts with, 3 a title word starts with, 2 title contains, 1 elsewhere. */
  readonly score: number;
}

/** What one source reports back: its entries, and whether its read stopped at the cap. */
export interface SourceResult {
  readonly entries: readonly SearchEntry[];
  /** More documents exist than the read was allowed to load. */
  readonly truncated: boolean;
}
