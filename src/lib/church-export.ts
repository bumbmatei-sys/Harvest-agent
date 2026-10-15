import { FieldPath, type Query } from 'firebase-admin/firestore';

/**
 * THE-228 — a whole-church export, as streamed CSV files inside one zip.
 *
 * This is not a subject-access export and not an erasure. `member-export.ts`
 * is one member taking their own data. `member-erasure.ts` deletes one member.
 * A church downloading everyone it holds is a third operation, with a different
 * authority (a tenant admin, not `manageCRM`) and a different destination
 * (object storage, not the HTTP response). Nothing here imports either module.
 *
 * Memory: one Firestore page and one upload part are in memory at a time.
 * The zip writer emits each CSV line as its own chunk and keeps only the
 * central-directory index (names and sizes), which is not the church.
 */

/** Same lifetime as the receipt download's `SIGNED_URL_TTL_MS`. */
export const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

export const SIGNED_URL_TTL_SECONDS = SIGNED_URL_TTL_MS / 1000;

/** An export nobody downloaded must not sit in storage past this. */
export const CHURCH_EXPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * One export at a time, and a finished one holds the slot briefly so a
 * retry loop cannot start the next church-sized read immediately.
 */
export const CHURCH_EXPORT_COOLDOWN_MS = 60 * 1000;

/**
 * The start route's `maxDuration` is 300s. An upload still open after this
 * is not a live request: the function has already been killed. The extra
 * minute is so the sweep does not abort a request that is still inside its
 * own limit.
 */
export const CHURCH_EXPORT_STUCK_MS = 6 * 60 * 1000;

/** A start the rate limit refused. The message is the one the admin sees. */
export class ChurchExportRejected extends Error {
  readonly code: 'active' | 'cooldown';

  constructor(code: 'active' | 'cooldown') {
    super(code === 'active'
      ? 'An export is already in progress'
      : 'An export was requested too recently');
    this.name = 'ChurchExportRejected';
    this.code = code;
  }
}

/**
 * Documents per Firestore read. Small enough that a page is not the church,
 * large enough that a few hundred members are not hundreds of round trips.
 */
export const EXPORT_PAGE = 200;

/** Minimum S3/R2 part size except the last part. Overridable in tests. */
export const R2_MIN_PART_BYTES = 5 * 1024 * 1024;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;

export function isSafeExportId(value: string): boolean {
  return SAFE_ID.test(value);
}

/** Tenant ids are subdomain labels. A slash or `..` must never reach an object key. */
export function isSafeTenantId(value: string): boolean {
  return SAFE_ID.test(value);
}

export function churchExportObjectKey(tenantId: string, exportId: string): string {
  if (!isSafeTenantId(tenantId) || !isSafeExportId(exportId)) {
    throw new Error('Unsafe export key');
  }
  return `church-exports/${tenantId}/${exportId}.zip`;
}

const KEY_RE = /^church-exports\/([A-Za-z0-9][A-Za-z0-9_-]{0,80})\/([A-Za-z0-9][A-Za-z0-9_-]{0,80})\.zip$/;

export function parseChurchExportKey(key: string): { tenantId: string; exportId: string } | null {
  const match = KEY_RE.exec(key);
  if (!match) return null;
  return { tenantId: match[1], exportId: match[2] };
}

/** True when `createdAtMs` is at least {@link CHURCH_EXPORT_MAX_AGE_MS} before `nowMs`. */
export function exportExpired(createdAtMs: number, nowMs: number): boolean {
  return nowMs - createdAtMs >= CHURCH_EXPORT_MAX_AGE_MS;
}

export interface ExportColumn {
  header: string;
  /** Document field. Absent on the id column. */
  field?: string;
  /**
   * Read this document field instead of `field`. Giving stores cents in
   * `amount`; the column is named `amountCents` so a later sum cannot treat
   * it as dollars.
   */
  from?: string;
}

export interface ChurchExportSpec {
  filename: string;
  /** Firestore subcollection under `tenants/{id}`, or `users` for members. */
  source: 'users' | 'contacts' | 'invoices' | 'events';
  columns: readonly ExportColumn[];
}

/**
 * The main collections a church operates. Giving is `invoices` — that document
 * is the money record. Contact activities are not included, because a gift
 * recorded there points at the invoice and summing both would count it twice.
 */
export const CHURCH_EXPORT_SPECS: readonly ChurchExportSpec[] = [
  {
    filename: 'members.csv',
    source: 'users',
    columns: [
      { header: 'id' },
      { header: 'email', field: 'email' },
      { header: 'displayName', field: 'displayName' },
      { header: 'phone', field: 'phone' },
      { header: 'role', field: 'role' },
      { header: 'createdAt', field: 'createdAt' },
    ],
  },
  {
    filename: 'contacts.csv',
    source: 'contacts',
    columns: [
      { header: 'id' },
      { header: 'firstName', field: 'firstName' },
      { header: 'lastName', field: 'lastName' },
      { header: 'email', field: 'email' },
      { header: 'phone', field: 'phone' },
      { header: 'type', field: 'type' },
      { header: 'totalDonatedDollars', field: 'totalDonated' },
      { header: 'userId', field: 'userId' },
      { header: 'createdAt', field: 'createdAt' },
    ],
  },
  {
    filename: 'giving.csv',
    source: 'invoices',
    columns: [
      { header: 'id' },
      { header: 'type', field: 'type' },
      { header: 'amountCents', from: 'amount' },
      { header: 'currency', field: 'currency' },
      { header: 'recipientEmail', field: 'recipientEmail' },
      { header: 'recipientName', field: 'recipientName' },
      { header: 'status', field: 'status' },
      { header: 'createdAt', field: 'createdAt' },
    ],
  },
  {
    filename: 'events.csv',
    source: 'events',
    columns: [
      { header: 'id' },
      { header: 'title', field: 'title' },
      { header: 'description', field: 'description' },
      { header: 'startDate', field: 'startDate' },
      { header: 'endDate', field: 'endDate' },
      { header: 'location', field: 'location' },
      { header: 'createdAt', field: 'createdAt' },
    ],
  },
];

const SECRET_KEY = /token|secret|password|apikey|api_key|privatekey|credential/i;

/** Drop credential-shaped keys anywhere in a document before it is written. */
export function sanitizeExportValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeExportValue);
  if (!value || typeof value !== 'object') return value;
  if ('toDate' in value || '_seconds' in value) return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] = sanitizeExportValue(inner);
  }
  return out;
}

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (typeof value === 'string') text = value;
  else if (typeof value === 'number') text = Number.isFinite(value) ? String(value) : '';
  else if (typeof value === 'boolean') text = value ? 'true' : 'false';
  else if (value instanceof Date) text = value.toISOString();
  else if (typeof value === 'object' && value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const date = (value as { toDate: () => Date }).toDate();
    text = date instanceof Date ? date.toISOString() : String(date);
  } else if (typeof value === 'object' && value && typeof (value as { _seconds?: unknown })._seconds === 'number') {
    text = new Date((value as { _seconds: number })._seconds * 1000).toISOString();
  } else text = JSON.stringify(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function csvLine(cells: readonly unknown[]): string {
  return `${cells.map(csvCell).join(',')}\n`;
}

/**
 * One cell per allowlisted column, in column order. A field that is not a
 * column is not exported: payment ids, card brand, last4, addresses, notes,
 * IPs and permission maps stay in Firestore.
 */
export function rowToCells(spec: ChurchExportSpec, id: string, data: Record<string, unknown>): unknown[] {
  const clean = sanitizeExportValue(data) as Record<string, unknown>;
  const cells: unknown[] = [];
  for (const column of spec.columns) {
    if (!column.field && !column.from) {
      cells.push(id);
      continue;
    }
    cells.push(clean[column.from || column.field!]);
  }
  return cells;
}

export interface ExportRow {
  id: string;
  data: Record<string, unknown>;
}

export interface PageSnapshot {
  empty: boolean;
  size: number;
  docs: ReadonlyArray<{ id: string; data: () => Record<string, unknown> }>;
}

/**
 * `limit` returns the page that is actually read. The query itself is not a
 * page, so it has no `get` — calling `get` without `limit` would be the
 * unordered full collection this export refuses to load.
 */
export interface PageQuery {
  startAfter(cursor: unknown): PageQuery;
  limit(n: number): { get(): Promise<PageSnapshot> };
}

/**
 * Cursor-page a query that is already ordered. `limit` is applied here, on
 * each page, so the caller cannot hand in an unordered ceiling.
 */
export async function* iterateQuery(query: PageQuery, pageSize: number = EXPORT_PAGE): AsyncGenerator<ExportRow[]> {
  let cursor: unknown;
  for (;;) {
    const page = cursor ? query.startAfter(cursor).limit(pageSize) : query.limit(pageSize);
    const snap = await page.get();
    if (snap.empty) return;
    const docs = snap.docs;
    yield docs.map((doc) => ({ id: doc.id, data: doc.data() ?? {} }));
    if (snap.size < pageSize) return;
    cursor = docs[docs.length - 1];
  }
}

export interface ByteSink {
  write(chunk: Buffer): void | Promise<void>;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

class RunningCrc {
  private c = 0xffffffff;
  update(buf: Buffer) {
    for (let i = 0; i < buf.length; i++) this.c = CRC_TABLE[(this.c ^ buf[i]) & 0xff] ^ (this.c >>> 8);
  }
  digest(): number {
    return (this.c ^ 0xffffffff) >>> 0;
  }
}

/** 2020-01-01 00:00. Fixed so archive bytes do not depend on the clock. */
function dosStamp(): { time: number; date: number } {
  const year = 2020 - 1980;
  return { time: 0, date: (year << 9) | (1 << 5) | 1 };
}

interface ZipEntry {
  name: string;
  crc: number;
  size: number;
  offset: number;
}

/**
 * STORE-method zip. Each file is streamed: local header, then bytes, then a
 * data descriptor. Only the central directory (one small record per file) is
 * held until the end.
 */
export class StoreZipWriter {
  private offset = 0;
  private entries: ZipEntry[] = [];
  private current: { name: string; crc: RunningCrc; size: number; offset: number } | null = null;

  constructor(private readonly sink: ByteSink) {}

  async startFile(name: string): Promise<void> {
    if (this.current) await this.endFile();
    const stamp = dosStamp();
    const nameBuf = Buffer.from(name, 'utf8');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0808, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(stamp.time, 10);
    header.writeUInt16LE(stamp.date, 12);
    header.writeUInt32LE(0, 14);
    header.writeUInt32LE(0, 18);
    header.writeUInt32LE(0, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);
    const offset = this.offset;
    await this.emit(Buffer.concat([header, nameBuf]));
    this.current = { name, crc: new RunningCrc(), size: 0, offset };
  }

  async write(chunk: Buffer): Promise<void> {
    if (!this.current) throw new Error('No file is open');
    this.current.crc.update(chunk);
    this.current.size += chunk.length;
    await this.emit(chunk);
  }

  async endFile(): Promise<void> {
    const current = this.current;
    if (!current) return;
    const crc = current.crc.digest();
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(current.size, 8);
    descriptor.writeUInt32LE(current.size, 12);
    await this.emit(descriptor);
    this.entries.push({ name: current.name, crc, size: current.size, offset: current.offset });
    this.current = null;
  }

  async finish(): Promise<void> {
    await this.endFile();
    const stamp = dosStamp();
    const cdOffset = this.offset;
    for (const entry of this.entries) {
      const nameBuf = Buffer.from(entry.name, 'utf8');
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(20, 6);
      header.writeUInt16LE(0x0808, 8);
      header.writeUInt16LE(0, 10);
      header.writeUInt16LE(stamp.time, 12);
      header.writeUInt16LE(stamp.date, 14);
      header.writeUInt32LE(entry.crc, 16);
      header.writeUInt32LE(entry.size, 20);
      header.writeUInt32LE(entry.size, 24);
      header.writeUInt16LE(nameBuf.length, 28);
      header.writeUInt16LE(0, 30);
      header.writeUInt16LE(0, 32);
      header.writeUInt16LE(0, 34);
      header.writeUInt16LE(0, 36);
      header.writeUInt32LE(0, 38);
      header.writeUInt32LE(entry.offset, 42);
      await this.emit(Buffer.concat([header, nameBuf]));
    }
    const cdSize = this.offset - cdOffset;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(cdSize, 12);
    end.writeUInt32LE(cdOffset, 16);
    end.writeUInt16LE(0, 20);
    await this.emit(end);
  }

  private async emit(chunk: Buffer): Promise<void> {
    this.offset += chunk.length;
    await this.sink.write(chunk);
  }
}

export interface ExportSource {
  spec: ChurchExportSpec;
  pages: AsyncIterable<ExportRow[]>;
}

/** Stream every source into one zip. Pages are pulled one at a time. */
export async function writeChurchExportZip(
  sources: readonly ExportSource[],
  sink: ByteSink,
): Promise<{ files: string[]; rows: number; rowCounts: Record<string, number> }> {
  const zip = new StoreZipWriter(sink);
  const files: string[] = [];
  const rowCounts: Record<string, number> = {};
  let rows = 0;
  for (const source of sources) {
    await zip.startFile(source.spec.filename);
    files.push(source.spec.filename);
    const headers = source.spec.columns.map((column) => column.header);
    await zip.write(Buffer.from(csvLine(headers), 'utf8'));
    let fileRows = 0;
    for await (const page of source.pages) {
      for (const row of page) {
        await zip.write(Buffer.from(csvLine(rowToCells(source.spec, row.id, row.data)), 'utf8'));
        rows += 1;
        fileRows += 1;
      }
    }
    rowCounts[source.spec.filename] = fileRows;
    await zip.endFile();
  }
  await zip.finish();
  return { files, rows, rowCounts };
}

interface QueryChain {
  where(field: string, op: string, value: string): QueryChain;
  orderBy(field: unknown): QueryChain;
  doc(id: string): { collection(name: string): QueryChain };
}

interface QueryDb {
  collection(name: string): QueryChain;
}

export interface BuiltExportQuery {
  spec: ChurchExportSpec;
  query: PageQuery;
}

/**
 * One ordered query per main collection, every one constrained to `tenantId`.
 *
 * Members live on the top-level `users` collection, so the constraint is a
 * `where` on `tenantId`. The other three are already under `tenants/{id}`.
 * `orderBy(documentId())` plus an equality filter is a prefix of the automatic
 * single-field index — no composite index, and `firestore.indexes.json` is
 * not a deploy path anyway.
 */
export function buildExportQueries(db: QueryDb, tenantId: string): BuiltExportQuery[] {
  if (!isSafeTenantId(tenantId)) throw new Error('Unsafe tenant id');
  const byId = FieldPath.documentId();
  const spec = (source: ChurchExportSpec['source']) => {
    const found = CHURCH_EXPORT_SPECS.find((entry) => entry.source === source);
    if (!found) throw new Error(`Missing export spec for ${source}`);
    return found;
  };
  return [
    {
      spec: spec('users'),
      query: db.collection('users').where('tenantId', '==', tenantId).orderBy(byId) as unknown as PageQuery,
    },
    {
      spec: spec('contacts'),
      query: db.collection('tenants').doc(tenantId).collection('contacts').orderBy(byId) as unknown as PageQuery,
    },
    {
      spec: spec('invoices'),
      query: db.collection('tenants').doc(tenantId).collection('invoices').orderBy(byId) as unknown as PageQuery,
    },
    {
      spec: spec('events'),
      query: db.collection('tenants').doc(tenantId).collection('events').orderBy(byId) as unknown as PageQuery,
    },
  ];
}

/** The real Admin SDK query type satisfies {@link PageQuery}. */
export type FirestorePageQuery = Query & PageQuery;
