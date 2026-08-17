/**
 * THE-74 — CSV member-list import for the CRM.
 *
 * A church that signs up already has its people somewhere: a spreadsheet, a
 * Breeze export, a Planning Center export, an Excel file. Until now the only
 * way in was typing them one at a time. This module is the parsing, mapping,
 * de-duplication and batch-planning half of the answer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 PURE, AND DELIBERATELY SO. No Firestore, no React, no network, no `File`.
 *
 * Everything here is a function from strings to data. That is what lets the
 * parser's genuinely hard cases (quoted commas, quoted newlines, escaped
 * quotes, BOM, CRLF) be pinned as plain unit tests, and it is what keeps the
 * WRITE path — which is the part that can lose or duplicate a church's people —
 * a small, readable block in AdminCRM rather than something buried in here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ WHERE THE PARSING HAPPENS: IN THE BROWSER. THAT IS THE POINT.
 *
 * A church's member list is personal data — names, email addresses, phone
 * numbers, and in the case of a giving export, who gives. Parsing it here means
 * the file's bytes never leave the device. The only thing that crosses the wire
 * is the contact documents themselves, written by the same authenticated client
 * SDK call the manual add already makes (AdminCRM's `addDoc`, gated by
 * `hasPermission('manageCRM', …)` in firestore.rules).
 *
 * Uploading the raw file to an API route instead would put a donor list in
 * transit, in server memory, in request logs, and — this app runs Sentry, and
 * the CRM read path already reports handled errors to it — potentially inside a
 * crash report the moment a malformed row throws. None of that is worth a
 * server-side parse that buys nothing: the write is a client write either way.
 *
 * Not sending the file also means no new API route, so `contacts` keeps ONE
 * writer. A route for import alone would make two write paths for one
 * collection, which is the duplicated-writer shape this project keeps paying
 * for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ NO CSV DEPENDENCY, AND THAT IS ALSO A DECISION.
 *
 * Hand-rolling CSV is a known trap, so the trap is named explicitly and each
 * jaw of it is a test: a comma inside a quoted field, a NEWLINE inside a quoted
 * field, a doubled `""` escape, a UTF-8 BOM (Excel writes one), and CRLF line
 * endings (Excel writes those too). `parseCsv` below is a character-level state
 * machine — the only shape that gets those right — rather than the `split(',')`
 * that does not.
 *
 * The alternative was papaparse (+ its types). It was declined because the
 * failure modes above are enumerable, they are pinned in
 * `src/utils/__tests__/csv-import.test.ts`, and a scoped RFC 4180 reader is
 * ~50 lines. A dependency would add supply-chain surface and bundle weight to
 * an admin screen for a problem whose whole surface is under test here. If a
 * church ever brings a dialect this cannot read (semicolon separators, a
 * non-UTF-8 encoding), that is the moment to revisit — not before.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * 1. THE PARSER
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * RFC 4180 reader. Returns the file as rows of raw cell strings — no trimming,
 * no header handling, no interpretation. `readCsvTable` does that part.
 *
 * The five cases that make this a state machine rather than a `split`:
 *
 *   `a,"b,c",d`        a comma INSIDE a quoted field is data, not a separator
 *   `a,"line1\nline2"` a newline inside a quoted field does not end the record
 *   `a,"say ""hi"""`   a doubled quote inside a quoted field is one literal `"`
 *   `﻿a,b`        Excel writes a UTF-8 BOM; unstripped it corrupts the
 *                      first header, so `First Name` never matches anything
 *   `a,b\r\nc,d`       Excel writes CRLF; a lone `\n` split leaves a `\r` glued
 *                      to the last cell of every row
 *
 * A `\r\n` inside a quoted field is normalised to `\n` so a multi-line value
 * (an address, a note) never carries a stray carriage return into Firestore.
 * Everything else inside quotes is preserved byte for byte.
 *
 * Lenient in one place, on purpose: a `"` that appears after a field has
 * already started (`Sm"ith`) is treated as a literal character rather than an
 * error. A parser that throws on a church's real export helps nobody.
 */
export function parseCsv(input: string): string[][] {
  // The BOM is a single code unit at position 0 and nowhere else.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  // True while the PENDING field was opened with a quote. It is what tells an
  // empty trailing `""` apart from no field at all, so `a,""` keeps two cells.
  let pendingQuoted = false;

  const endField = (): void => {
    row.push(field);
    field = '';
    pendingQuoted = false;
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }  // `""` → `"`
        inQuotes = false; i += 1; continue;                            // closing quote
      }
      if (ch === '\r' && text[i + 1] === '\n') { field += '\n'; i += 2; continue; }
      field += ch; i += 1; continue;
    }

    // A quote only OPENS a field at its very start; elsewhere it is literal.
    if (ch === '"' && field === '' && !pendingQuoted) {
      inQuotes = true; pendingQuoted = true; i += 1; continue;
    }
    if (ch === ',') { endField(); i += 1; continue; }
    if (ch === '\r' && text[i + 1] === '\n') { endRow(); i += 2; continue; }
    if (ch === '\n' || ch === '\r') { endRow(); i += 1; continue; }
    field += ch; i += 1;
  }

  // Flush a final record that ended at EOF rather than at a newline. The three
  // conditions are what stop a file ending in a newline from gaining a phantom
  // empty row while `a,""` at EOF still keeps its second cell.
  if (field !== '' || pendingQuoted || row.length > 0) endRow();

  return rows;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2. THE TABLE
 * ──────────────────────────────────────────────────────────────────────────*/

export interface CsvTable {
  /** Row 1 of the file, trimmed. May contain blanks — see `columnLabel`. */
  headers: string[];
  /** Every row under the header, with fully-blank rows dropped. */
  rows: string[][];
  /**
   * File line number for `rows[i]`, so every message this import produces can
   * name the line the admin sees in their spreadsheet. Kept alongside rather
   * than derived as `i + 2`, because blank rows are dropped and that arithmetic
   * would quietly start pointing at the wrong person.
   */
  lines: number[];
}

export type CsvReadResult =
  | { ok: true; table: CsvTable }
  | { ok: false; error: string };

/** Said plainly, and said about the FILE — not "parse error". */
export const CSV_EMPTY_MESSAGE =
  'That file has nothing in it. Export your members again and upload the new file.';
export const CSV_HEADER_ONLY_MESSAGE =
  'That file has column headings but no people underneath them. There is nobody to import.';

/** A blank header still has to be pickable in the mapping UI. */
export const columnLabel = (header: string, index: number): string =>
  header.trim() || `Column ${index + 1}`;

/**
 * Split a parsed file into headers + body, rejecting the two shapes that cannot
 * produce a single contact.
 *
 * Both rejections are their own message. "Empty file" and "header row only" are
 * different mistakes with different fixes, and an admin who exported the wrong
 * view of their database needs to be told which one they made.
 */
export function readCsvTable(text: string): CsvReadResult {
  const parsed = parseCsv(text);
  const isBlank = (r: string[]): boolean => r.every(cell => cell.trim() === '');

  // Blank lines anywhere are noise (trailing newlines, spacer rows). Their file
  // line numbers still have to be right for everything after them, so the
  // filtering carries the original 1-based line with it.
  const numbered = parsed
    .map((cells, idx) => ({ cells, line: idx + 1 }))
    .filter(r => !isBlank(r.cells));

  if (numbered.length === 0) return { ok: false, error: CSV_EMPTY_MESSAGE };

  const [head, ...body] = numbered;
  if (body.length === 0) return { ok: false, error: CSV_HEADER_ONLY_MESSAGE };

  return {
    ok: true,
    table: {
      headers: head.cells.map(h => h.trim()),
      rows: body.map(r => r.cells),
      lines: body.map(r => r.line),
    },
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3. COLUMN MAPPING
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * The fields an import can fill. Deliberately the SAME set the manual add form
 * writes and no more: an importer that could set fields the form cannot would
 * be a second, wider write path for one collection.
 *
 * `totalDonated` is absent on purpose. Giving is written by the donation
 * webhook and by the CRM's own donation activity, and the pipeline stage is
 * derived from it — letting a spreadsheet stamp a total would fabricate giving
 * history that no donation ever produced.
 */
export const IMPORT_FIELDS = [
  'firstName', 'lastName', 'email', 'phone', 'type',
  'street', 'city', 'state', 'zip', 'country', 'notes',
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Human labels for the mapping UI. */
export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Phone',
  type: 'Type',
  street: 'Street address',
  city: 'City',
  state: 'State',
  zip: 'ZIP',
  country: 'Country',
  notes: 'Notes',
};

/**
 * 🔴 THE ONLY REQUIRED FIELD, and it is the manual form's required field.
 *
 * `handleSave` in AdminCRM refuses on `!form.firstName.trim()`. An import that
 * accepted nameless rows would put people in the CRM that the manual path
 * would have refused.
 */
export const REQUIRED_IMPORT_FIELD: ImportField = 'firstName';

/**
 * Which column index feeds which field. Chosen BY THE USER.
 *
 * There is deliberately no header-name inference here — no `First Name` →
 * `firstName` guess table. Churches export with arbitrary headings (`Primary
 * Email`, `Email Address`, `Home Phone`, `Given Name`, headings in another
 * language, no headings at all), and a guess that is right nine times out of
 * ten is worse than no guess: the tenth church silently imports its phone
 * numbers into the notes field and finds out later.
 */
export type ColumnMapping = Partial<Record<ImportField, number>>;

export const hasRequiredMapping = (mapping: ColumnMapping): boolean =>
  typeof mapping[REQUIRED_IMPORT_FIELD] === 'number';

/* ────────────────────────────────────────────────────────────────────────────
 * 4. MAPPED ROWS
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * Where a row's `type` came from. Rendered per row in the preview, because
 * "this came out of your file" and "this is the value you picked" are different
 * claims and the church is entitled to see which one it is looking at.
 */
export type TypeSource = 'file' | 'chosen';

export interface MappedRow<T extends string = string> {
  /** 1-based line in the uploaded file, as the admin's spreadsheet numbers it. */
  line: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** 🔴 ALWAYS SET. Never inferred — see `mapRows`. */
  type: T;
  typeSource: TypeSource;
  address: { street: string; city: string; state: string; zip: string; country: string };
  notes: string;
}

const cell = (row: string[], index: number | undefined): string =>
  typeof index === 'number' ? (row[index] ?? '').trim() : '';

/**
 * Turn the raw table into rows ready to write.
 *
 * 🔴 `type` IS NEVER ASSUMED. THE-150 proved an unset `type` renders a blank
 * badge, and `functions/upsertContact`'s update branch never repairs a missing
 * one — so a row that reaches Firestore without a type is a defect that
 * survives. There are exactly two ways a row gets one here:
 *
 *   'file'   — the admin mapped a Type column AND that cell holds a value from
 *              `allowedTypes` (matched case-insensitively; `Donor`, `donor` and
 *              ` DONOR ` are the same answer).
 *   'chosen' — the admin picked one explicitly, in a control with no
 *              pre-selection. It is passed in as `chosenType`.
 *
 * There is no third branch, and in particular no `?? 'member'`. AdminCRM's
 * `emptyContact` defaults a NEW contact to member, which is a fair choice about
 * a record an admin is typing in front of them; carrying that default into a
 * file the church exported would label hundreds of people as members when the
 * file never said so.
 *
 * A Type cell holding something outside the union (`Volunteer`, `Guest`, an
 * empty cell) falls back to `chosenType` and is reported as 'chosen', so the
 * preview shows the value that will actually be written rather than the one in
 * the file.
 *
 * `allowedTypes` is passed IN rather than declared here so this module never
 * holds a second copy of the contact `type` union. AdminCRM derives it from
 * `TYPE_LABELS`, which is a `Record<Contact['type'], string>` — if the union
 * ever changes, that map must change with it and the importer follows.
 */
export function mapRows<T extends string>(
  table: CsvTable,
  mapping: ColumnMapping,
  chosenType: T,
  allowedTypes: readonly T[],
): MappedRow<T>[] {
  const byLowerValue = new Map<string, T>(allowedTypes.map(t => [t.toLowerCase(), t]));

  return table.rows.map((row, i) => {
    const rawType = cell(row, mapping.type).toLowerCase();
    const fromFile = byLowerValue.get(rawType);

    return {
      line: table.lines[i],
      firstName: cell(row, mapping.firstName),
      lastName: cell(row, mapping.lastName),
      email: cell(row, mapping.email),
      phone: cell(row, mapping.phone),
      type: fromFile ?? chosenType,
      typeSource: fromFile ? 'file' : 'chosen',
      address: {
        street: cell(row, mapping.street),
        city: cell(row, mapping.city),
        state: cell(row, mapping.state),
        zip: cell(row, mapping.zip),
        country: cell(row, mapping.country),
      },
      notes: cell(row, mapping.notes),
    };
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * 5. DE-DUPLICATION
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * The match key: a normalised email address.
 *
 * Identical rule to `normEmail` in useCRMQueries, which is what
 * `mergeContactsWithUsers` already uses to fold a `users` row into its
 * `contacts` row. Using the same normalisation is the point — if the importer
 * matched more loosely or more strictly than the merge does, a contact could be
 * "not a duplicate" at import time and then collapse into an existing row on
 * the next read, or vice versa.
 *
 * Returns '' for anything unusable, which every caller treats as "no key".
 */
export const normalizeEmailKey = (value: unknown): string =>
  String(value ?? '').trim().toLowerCase();

export type SkipReason =
  /** Someone in the CRM already holds this email address. */
  | 'duplicate-in-crm'
  /** An earlier row of THIS file already claimed this email address. */
  | 'duplicate-in-file'
  /** No first name — the one field the manual add also refuses without. */
  | 'no-name';

export interface SkippedRow<T extends string = string> {
  row: MappedRow<T>;
  reason: SkipReason;
}

export interface ImportPlan<T extends string = string> {
  toWrite: MappedRow<T>[];
  skipped: SkippedRow<T>[];
  /**
   * Rows that will be written but could NOT be checked for duplicates, because
   * they carry no email address. Surfaced separately so the preview can say so:
   * these are the rows that WILL double if the same file is uploaded twice.
   */
  unmatchable: MappedRow<T>[];
}

/**
 * Decide what actually gets written.
 *
 * 🔴 A MATCH IS SKIPPED, NOT UPDATED. Importing the same file twice must not
 * double a church's contacts — that is the failure that makes a church stop
 * trusting the product — but "don't duplicate" has two possible answers and
 * only one of them is safe.
 *
 * Updating would let a stale spreadsheet overwrite what the church has curated
 * IN the CRM since the last export: admin notes, tags, the type an admin
 * corrected by hand. The spreadsheet is not the system of record; the CRM is.
 * And an update is not reversible — an overwritten note is gone, whereas a
 * skipped row can be re-imported the moment the admin decides they want it.
 *
 * There is a second, sharper reason. THE-150 established that
 * `functions/upsertContact`'s UPDATE branch never repairs a missing `type`. An
 * import that took the update path would run rows through exactly the branch
 * known not to fix the field this card exists to guarantee.
 *
 * ⚠️ ROWS WITH NO EMAIL CANNOT BE MATCHED, and they are imported anyway. A
 * church legitimately has members with no email address, and refusing them
 * would lose real people. Falling back to a name match was considered and
 * rejected: two different "John Smith"s in one congregation is ordinary, and
 * silently dropping the second one loses a person with no trace. So they are
 * written, counted in `unmatchable`, and the preview says out loud that these
 * are the rows a second upload would duplicate.
 *
 * `existingEmailKeys` comes from the CRM list the screen has ALREADY loaded —
 * which is the merged list, so it covers both `contacts` rows and people who
 * exist only as a `users` account. No new Firestore query, no composite index,
 * and nothing that could fail silently against the rules.
 */
export function planImport<T extends string>(
  rows: readonly MappedRow<T>[],
  existingEmailKeys: ReadonlySet<string>,
): ImportPlan<T> {
  const toWrite: MappedRow<T>[] = [];
  const skipped: SkippedRow<T>[] = [];
  const unmatchable: MappedRow<T>[] = [];
  const claimedInFile = new Set<string>();

  for (const row of rows) {
    if (!row.firstName.trim()) { skipped.push({ row, reason: 'no-name' }); continue; }

    const key = normalizeEmailKey(row.email);
    if (!key) { toWrite.push(row); unmatchable.push(row); continue; }

    if (existingEmailKeys.has(key)) { skipped.push({ row, reason: 'duplicate-in-crm' }); continue; }
    // A file that lists one address twice must not import it twice either.
    if (claimedInFile.has(key)) { skipped.push({ row, reason: 'duplicate-in-file' }); continue; }

    claimedInFile.add(key);
    toWrite.push(row);
  }

  return { toWrite, skipped, unmatchable };
}

/** Count skips by reason, for the summary line. */
export const countSkips = <T extends string>(
  skipped: readonly SkippedRow<T>[],
  reason: SkipReason,
): number => skipped.filter(s => s.reason === reason).length;

/* ────────────────────────────────────────────────────────────────────────────
 * 6. BATCHING
 * ──────────────────────────────────────────────────────────────────────────*/

/** Firestore's hard ceiling on operations in one `writeBatch`. */
export const FIRESTORE_BATCH_LIMIT = 500;

/**
 * Rows per committed batch.
 *
 * Under the 500 ceiling rather than at it. Each imported contact is exactly one
 * `set` — one operation — so 500 would in principle fit, but sitting on the
 * documented maximum leaves no room for a future field that costs a second
 * operation, and the failure mode there is an import that dies at exactly 500
 * rows for reasons nobody can see from the error.
 *
 * A 2,000-row import is therefore 5 batches: 450, 450, 450, 450, 200.
 */
export const IMPORT_CHUNK_SIZE = 450;

/**
 * Split the write list into batch-sized chunks.
 *
 * 🔴 The chunks are also the unit of REPORTING. A Firestore batch is atomic:
 * it commits entirely or not at all. So when a chunk fails, the rows that
 * reached Firestore are exactly the rows in the chunks that already committed —
 * which is what makes "a 300-row import that fails at row 200 reports what
 * actually wrote" an exact answer rather than an estimate.
 */
export function chunkForBatches<T>(
  items: readonly T[],
  size: number = IMPORT_CHUNK_SIZE,
): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 7. REPORTING
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * What an import actually did.
 *
 * ⚠️ Shaped after the SMS broadcast's partial-send report (THE-29), which
 * already settled how this app tells someone that an operation half-succeeded:
 * a count of what worked, then one clause per way it fell short, joined with
 * ` • `, plus an `ok` flag that is false whenever anything was less than clean.
 * A second, differently-shaped partial report would mean two vocabularies for
 * one idea.
 */
export interface ImportOutcome {
  /** Rows Firestore confirmed. Never an estimate — see `chunkForBatches`. */
  imported: number;
  /** Already in the CRM, matched by email. */
  duplicates: number;
  /**
   * Listed more than once inside the uploaded file itself. Counted apart from
   * `duplicates` because they are a different fact with a different fix: one
   * says the CRM already has this person, the other says the spreadsheet does.
   * Folding them together would tell a church its file matched rows that were
   * never in the CRM at all.
   */
  repeatedInFile: number;
  /** Refused for the same reason the manual add refuses them. */
  noName: number;
  /**
   * Set only when a batch failed. `notWritten` is every row that did NOT reach
   * Firestore — the failed chunk plus everything after it, none of which was
   * attempted.
   */
  failure: {
    notWritten: number;
    /** Last file line confirmed written, or null if the FIRST batch failed. */
    lastWrittenLine: number | null;
    /** First file line that did not make it. */
    firstUnwrittenLine: number;
    message: string;
  } | null;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/**
 * The one line the admin reads when it is over.
 *
 * Silence after a half-finished import is the worst available outcome, so this
 * never returns an empty string and never omits a shortfall. Every count that
 * is non-zero gets a clause; a failure additionally names the exact line the
 * import reached, because "some of them went in" is not something a church can
 * act on and "everything through line 199 was saved" is.
 */
export function importSummary(outcome: ImportOutcome): { ok: boolean; text: string } {
  const { imported, duplicates, repeatedInFile, noName, failure } = outcome;

  const parts: string[] = [
    `Imported ${imported.toLocaleString()} ${plural(imported, 'contact', 'contacts')}`,
  ];
  if (duplicates > 0) {
    parts.push(
      `${duplicates.toLocaleString()} already in your CRM — ` +
      `${plural(duplicates, 'that row was', 'those rows were')} left as ${plural(duplicates, 'it is', 'they are')}`,
    );
  }
  if (repeatedInFile > 0) {
    parts.push(`${repeatedInFile.toLocaleString()} listed more than once in your file — imported once`);
  }
  if (noName > 0) {
    parts.push(`${noName.toLocaleString()} skipped — no first name`);
  }
  if (failure) {
    parts.push(`${failure.notWritten.toLocaleString()} not imported — ${failure.message}`);
  }

  let text = `${parts.join(' • ')}.`;
  if (failure) {
    text += failure.lastWrittenLine === null
      ? ' Nothing was saved. Your CRM is exactly as it was.'
      : ` Everything through line ${failure.lastWrittenLine} was saved; nothing from line ${failure.firstUnwrittenLine} on. Re-uploading the same file is safe — the rows already in are matched by email and skipped.`;
  }

  return {
    ok: !failure && duplicates === 0 && repeatedInFile === 0 && noName === 0,
    text,
  };
}
