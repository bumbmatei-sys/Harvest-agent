import { describe, it, expect } from 'vitest';
import {
  parseCsv, readCsvTable, columnLabel, hasRequiredMapping,
  mapRows, planImport, countSkips, chunkForBatches, importSummary,
  normalizeEmailKey,
  CSV_EMPTY_MESSAGE, CSV_HEADER_ONLY_MESSAGE,
  IMPORT_FIELDS, IMPORT_CHUNK_SIZE, FIRESTORE_BATCH_LIMIT, REQUIRED_IMPORT_FIELD,
  type CsvTable, type ColumnMapping,
} from '../csv-import';

/**
 * THE-74 — the parsing, mapping, de-duplication and batching half of CSV
 * import, tested where it is pure.
 *
 * The write itself is pinned in AdminCRM.csvImport.test.tsx. Everything here is
 * a function from strings to data, which is what makes the parser's genuinely
 * hard cases — a comma inside quotes, a NEWLINE inside quotes, a doubled quote,
 * a BOM, CRLF — testable one at a time rather than only through a UI.
 */

/** The contact type union, as the screen supplies it (derived from TYPE_LABELS). */
const TYPES = ['donor', 'member', 'both'] as const;
type T = (typeof TYPES)[number];

const tableOf = (text: string): CsvTable => {
  const result = readCsvTable(text);
  if (!result.ok) throw new Error(`expected a readable table, got: ${result.error}`);
  return result.table;
};

// ── 11 ── THE PARSER TRAPS ───────────────────────────────────────────────────
//
// Each of these is a reason `split(',')` is not a CSV parser, and together they
// are the argument for not taking a dependency: the surface is enumerable and
// it is all right here.
describe('a CSV with quoted commas, quoted newlines and CRLF parses correctly', () => {
  it('a comma inside a quoted field is data, not a separator', () => {
    expect(parseCsv('Name,Email\n"Smith, John",j@church.org'))
      .toEqual([['Name', 'Email'], ['Smith, John', 'j@church.org']]);
  });

  it('a newline inside a quoted field does not end the record', () => {
    expect(parseCsv('Name,Notes\nRuth,"first line\nsecond line"'))
      .toEqual([['Name', 'Notes'], ['Ruth', 'first line\nsecond line']]);
  });

  it('a CRLF newline inside a quoted field is kept as one line break', () => {
    expect(parseCsv('Name,Notes\r\nRuth,"first line\r\nsecond line"'))
      .toEqual([['Name', 'Notes'], ['Ruth', 'first line\nsecond line']]);
  });

  it('a doubled quote inside a quoted field is one literal quote', () => {
    expect(parseCsv('Name\n"She said ""welcome"""'))
      .toEqual([['Name'], ['She said "welcome"']]);
  });

  it('CRLF line endings do not leave a carriage return glued to the last cell', () => {
    expect(parseCsv('First,Last\r\nRuth,Boaz\r\nNaomi,Elimelech\r\n'))
      .toEqual([['First', 'Last'], ['Ruth', 'Boaz'], ['Naomi', 'Elimelech']]);
  });

  it('a UTF-8 BOM is stripped, so the first heading is still matchable', () => {
    // Excel writes one. Unstripped it corrupts the first header and the admin
    // sees a column called "﻿First Name" they cannot line anything up with.
    const table = tableOf('﻿First Name,Email\r\nRuth,ruth@church.org\r\n');
    expect(table.headers[0]).toBe('First Name');
  });

  it('all five traps at once, in one file', () => {
    const file = '﻿Name,Email,Notes\r\n'
      + '"Smith, John",j@church.org,"said ""yes""\r\nlast Sunday"\r\n'
      + 'Ruth,ruth@church.org,\r\n';
    expect(parseCsv(file)).toEqual([
      ['Name', 'Email', 'Notes'],
      ['Smith, John', 'j@church.org', 'said "yes"\nlast Sunday'],
      ['Ruth', 'ruth@church.org', ''],
    ]);
  });

  it('keeps an empty quoted trailing field rather than dropping the cell', () => {
    expect(parseCsv('a,b\n1,""')).toEqual([['a', 'b'], ['1', '']]);
  });

  it('a trailing newline does not invent an extra empty record', () => {
    expect(parseCsv('a,b\nc,d\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('a lone CR (classic Mac export) still separates records', () => {
    expect(parseCsv('a,b\rc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });
});

// ── 12 ── THE TWO FILES THAT CANNOT PRODUCE A CONTACT ────────────────────────
describe('an empty file and a header-only file are rejected with a readable message', () => {
  it.each([
    ['completely empty', ''],
    ['only whitespace and newlines', '\r\n \r\n'],
    ['only empty cells', ',,\n,,\n'],
  ])('rejects a file that is %s', (_label, text) => {
    const result = readCsvTable(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(CSV_EMPTY_MESSAGE);
  });

  it('rejects a header row with nobody underneath it', () => {
    const result = readCsvTable('First Name,Email\r\n');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(CSV_HEADER_ONLY_MESSAGE);
  });

  it('the two messages are different — they are different mistakes', () => {
    expect(CSV_EMPTY_MESSAGE).not.toBe(CSV_HEADER_ONLY_MESSAGE);
  });

  it('says what to do, and never says "parse error"', () => {
    for (const message of [CSV_EMPTY_MESSAGE, CSV_HEADER_ONLY_MESSAGE]) {
      expect(message).not.toMatch(/parse|malformed|invalid|exception|token/i);
      expect(message.length).toBeGreaterThan(20);
    }
  });

  it('a blank line between people is skipped, and the line numbers stay true', () => {
    const table = tableOf('First,Email\nRuth,r@church.org\n\nNaomi,n@church.org\n');
    expect(table.rows).toHaveLength(2);
    // Naomi is on line 4 of the file even though she is the 2nd person.
    expect(table.lines).toEqual([2, 4]);
  });
});

// ── 2 ── THE USER MAPS. NOTHING IS INFERRED. ─────────────────────────────────
describe('columns are mapped by the user, not inferred from header names', () => {
  // Headings that a naive inference table would get right…
  const friendly = 'First Name,Last Name,Email\nRuth,Boaz,ruth@church.org\n';
  // …and headings from a real export, which it would not.
  const hostile = 'Given,Surname,Primary Email\nRuth,Boaz,ruth@church.org\n';

  it('an unmapped file produces no field values at all, however obvious the headings', () => {
    const rows = mapRows(tableOf(friendly), {}, 'member', TYPES);
    expect(rows).toHaveLength(1);
    // `First Name` was NOT read as firstName. Nothing is guessed.
    expect(rows[0].firstName).toBe('');
    expect(rows[0].lastName).toBe('');
    expect(rows[0].email).toBe('');
  });

  it('the same file with the same mapping reads identically whatever the headings say', () => {
    const mapping: ColumnMapping = { firstName: 0, lastName: 1, email: 2 };
    const fromFriendly = mapRows(tableOf(friendly), mapping, 'member', TYPES)[0];
    const fromHostile = mapRows(tableOf(hostile), mapping, 'member', TYPES)[0];
    expect(fromHostile.firstName).toBe(fromFriendly.firstName);
    expect(fromHostile.email).toBe(fromFriendly.email);
    expect(fromHostile.firstName).toBe('Ruth');
  });

  it('a mapping the user deliberately crosses over is honoured, not corrected', () => {
    // If the admin points firstName at the Email column, that is what happens.
    // A parser that "knew better" would be a parser that cannot be trusted when
    // the headings are wrong, which is the case that matters.
    const rows = mapRows(tableOf(friendly), { firstName: 2, email: 0 }, 'member', TYPES);
    expect(rows[0].firstName).toBe('ruth@church.org');
    expect(rows[0].email).toBe('Ruth');
  });

  it('a column left unmapped writes an empty string, never the neighbouring column', () => {
    const rows = mapRows(tableOf(friendly), { firstName: 0 }, 'member', TYPES);
    expect(rows[0].phone).toBe('');
    expect(rows[0].notes).toBe('');
    expect(rows[0].address).toEqual({ street: '', city: '', state: '', zip: '', country: '' });
  });

  it('a blank heading is still pickable, by position', () => {
    expect(columnLabel('', 2)).toBe('Column 3');
    expect(columnLabel('  ', 0)).toBe('Column 1');
    expect(columnLabel('Email Address', 1)).toBe('Email Address');
  });

  it('first name is the required mapping — the manual add refuses without it too', () => {
    expect(REQUIRED_IMPORT_FIELD).toBe('firstName');
    expect(hasRequiredMapping({})).toBe(false);
    expect(hasRequiredMapping({ email: 1 })).toBe(false);
    // Column 0 is a real answer, so a falsy-check bug here would be invisible.
    expect(hasRequiredMapping({ firstName: 0 })).toBe(true);
  });

  it('offers only the fields the manual add form itself writes', () => {
    // An importer that could set fields the form cannot would be a second,
    // wider write path for one collection. Giving is notably absent: it is
    // written by the donation webhook, and the pipeline stage derives from it.
    expect([...IMPORT_FIELDS]).toEqual([
      'firstName', 'lastName', 'email', 'phone', 'type',
      'street', 'city', 'state', 'zip', 'country', 'notes',
    ]);
    expect(IMPORT_FIELDS).not.toContain('totalDonated');
    expect(IMPORT_FIELDS).not.toContain('stage');
  });

  it('trims each cell, so a padded export does not carry whitespace into Firestore', () => {
    const rows = mapRows(
      tableOf('a,b\n"  Ruth  ","  ruth@church.org  "\n'),
      { firstName: 0, email: 1 }, 'member', TYPES,
    );
    expect(rows[0].firstName).toBe('Ruth');
    expect(rows[0].email).toBe('ruth@church.org');
  });
});

// ── 5 + 6 ── TYPE IS EXPLICIT, ALWAYS, AND NEVER INVENTED ────────────────────
describe('every imported contact has an explicit type', () => {
  const file = 'First,Email\nRuth,ruth@church.org\nNaomi,naomi@church.org\n';

  it('every mapped row carries a type from the union', () => {
    const rows = mapRows(tableOf(file), { firstName: 0, email: 1 }, 'donor', TYPES);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.type).toBeDefined();
      expect(TYPES).toContain(row.type);
    }
  });

  it('the type the admin chose is what every row gets — not a built-in default', () => {
    // 'donor' in, 'donor' out. If anything here fell back to a hardcoded
    // 'member', this is where it would show.
    const rows = mapRows(tableOf(file), { firstName: 0, email: 1 }, 'donor', TYPES);
    expect(rows.map(r => r.type)).toEqual(['donor', 'donor']);
    expect(rows.map(r => r.typeSource)).toEqual(['chosen', 'chosen']);
  });

  it.each(TYPES)('carries %s through unchanged when that is the chosen type', (chosen) => {
    const rows = mapRows(tableOf(file), { firstName: 0 }, chosen, TYPES);
    expect(rows.every(r => r.type === chosen)).toBe(true);
  });
});

describe('no imported contact is labelled with a type the file did not state', () => {
  it('a type the file DOES state is read from the file and marked as such', () => {
    const rows = mapRows(
      tableOf('First,Kind\nRuth,donor\nNaomi,both\n'),
      { firstName: 0, type: 1 }, 'member', TYPES,
    );
    expect(rows.map(r => r.type)).toEqual(['donor', 'both']);
    expect(rows.map(r => r.typeSource)).toEqual(['file', 'file']);
  });

  it('matches the file’s value case- and whitespace-insensitively', () => {
    const rows = mapRows(
      tableOf('First,Kind\nRuth,  DONOR  \nNaomi,Both\n'),
      { firstName: 0, type: 1 }, 'member', TYPES,
    );
    expect(rows.map(r => r.type)).toEqual(['donor', 'both']);
    expect(rows.map(r => r.typeSource)).toEqual(['file', 'file']);
  });

  it('a value outside the union is NOT coerced into it — it falls to the admin’s choice, and says so', () => {
    // 'Volunteer' is not a contact type. Silently reading it as 'member' would
    // assert something the church never said; reporting the source as 'chosen'
    // is what puts that on screen in the preview.
    const rows = mapRows(
      tableOf('First,Kind\nRuth,Volunteer\nNaomi,\n'),
      { firstName: 0, type: 1 }, 'donor', TYPES,
    );
    expect(rows.map(r => r.type)).toEqual(['donor', 'donor']);
    expect(rows.map(r => r.typeSource)).toEqual(['chosen', 'chosen']);
  });

  it('with no Type column mapped, no row is ever marked as having come from the file', () => {
    const rows = mapRows(
      tableOf('First,Email\nRuth,r@church.org\n'),
      { firstName: 0, email: 1 }, 'member', TYPES,
    );
    expect(rows[0].typeSource).toBe('chosen');
  });

  it('the allowed values are supplied by the caller — this module holds no copy of the union', () => {
    // The screen derives them from TYPE_LABELS, a Record<Contact['type'], …>,
    // so the union cannot drift away from what the importer accepts. Proving it
    // by passing a DIFFERENT set: if the union were hardcoded here, 'donor'
    // would still be read out of the file.
    const rows = mapRows(
      tableOf('First,Kind\nRuth,donor\n'),
      { firstName: 0, type: 1 }, 'member', ['member'] as const,
    );
    expect(rows[0].type).toBe('member');
    expect(rows[0].typeSource).toBe('chosen');
  });
});

// ── 4 ── THE TRUST TEST ──────────────────────────────────────────────────────
describe('re-importing the same file does not duplicate contacts', () => {
  const file = 'First,Email\nRuth,ruth@church.org\nNaomi,naomi@church.org\n';
  const mapping: ColumnMapping = { firstName: 0, email: 1 };
  const rowsOf = () => mapRows(tableOf(file), mapping, 'member', TYPES);

  it('the first import writes everybody', () => {
    const plan = planImport(rowsOf(), new Set<string>());
    expect(plan.toWrite).toHaveLength(2);
    expect(plan.skipped).toHaveLength(0);
  });

  it('the second import of the same file writes nobody', () => {
    // The CRM now holds what the first import put there.
    const already = new Set(['ruth@church.org', 'naomi@church.org']);
    const plan = planImport(rowsOf(), already);
    expect(plan.toWrite).toHaveLength(0);
    expect(countSkips(plan.skipped, 'duplicate-in-crm')).toBe(2);
  });

  it('matches on email regardless of case or surrounding whitespace', () => {
    const messy = tableOf('First,Email\nRuth,"  RUTH@Church.org "\n');
    const plan = planImport(
      mapRows(messy, mapping, 'member', TYPES),
      new Set(['ruth@church.org']),
    );
    expect(plan.toWrite).toHaveLength(0);
    expect(countSkips(plan.skipped, 'duplicate-in-crm')).toBe(1);
  });

  it('uses the same normalisation the contacts/users merge uses', () => {
    expect(normalizeEmailKey('  RUTH@Church.org ')).toBe('ruth@church.org');
    expect(normalizeEmailKey(null)).toBe('');
    expect(normalizeEmailKey(undefined)).toBe('');
    expect(normalizeEmailKey('   ')).toBe('');
  });

  it('a match is SKIPPED, never updated — the spreadsheet does not overwrite the CRM', () => {
    // The row exists in the plan's `skipped` list and nowhere else. Nothing in
    // this module can produce a write against an existing contact, so a stale
    // export cannot clear an admin's notes or a hand-corrected type.
    const plan = planImport(rowsOf(), new Set(['ruth@church.org']));
    expect(plan.toWrite.map(r => r.email)).toEqual(['naomi@church.org']);
    expect(plan.skipped).toEqual([
      expect.objectContaining({ reason: 'duplicate-in-crm' }),
    ]);
  });

  it('one file listing the same address twice imports that person once', () => {
    const twice = tableOf('First,Email\nRuth,ruth@church.org\nRuthie,RUTH@church.org\n');
    const plan = planImport(mapRows(twice, mapping, 'member', TYPES), new Set<string>());
    expect(plan.toWrite).toHaveLength(1);
    expect(plan.toWrite[0].firstName).toBe('Ruth');       // first occurrence wins
    expect(countSkips(plan.skipped, 'duplicate-in-file')).toBe(1);
    expect(countSkips(plan.skipped, 'duplicate-in-crm')).toBe(0);
  });

  it('a partial re-import — some already in, some new — writes only the new ones', () => {
    const grown = tableOf(
      'First,Email\nRuth,ruth@church.org\nNaomi,naomi@church.org\nBoaz,boaz@church.org\n',
    );
    const plan = planImport(
      mapRows(grown, mapping, 'member', TYPES),
      new Set(['ruth@church.org', 'naomi@church.org']),
    );
    expect(plan.toWrite.map(r => r.firstName)).toEqual(['Boaz']);
    expect(countSkips(plan.skipped, 'duplicate-in-crm')).toBe(2);
  });

  it('a row with no email is imported but reported as unmatchable', () => {
    // Refusing them would lose real people; matching them by name would merge
    // two different John Smiths. So: import, and say what that means.
    const noEmail = tableOf('First,Email\nRuth,\nNaomi,naomi@church.org\n');
    const plan = planImport(mapRows(noEmail, mapping, 'member', TYPES), new Set<string>());
    expect(plan.toWrite).toHaveLength(2);
    expect(plan.unmatchable.map(r => r.firstName)).toEqual(['Ruth']);
  });

  it('rows with no first name are skipped, exactly as the manual add refuses them', () => {
    const nameless = tableOf('First,Email\n,ghost@church.org\nRuth,ruth@church.org\n');
    const plan = planImport(mapRows(nameless, mapping, 'member', TYPES), new Set<string>());
    expect(plan.toWrite.map(r => r.firstName)).toEqual(['Ruth']);
    expect(countSkips(plan.skipped, 'no-name')).toBe(1);
  });
});

// ── 10 ── CHUNKING ───────────────────────────────────────────────────────────
describe('an import larger than one Firestore batch is chunked', () => {
  it('stays under Firestore’s 500-operation ceiling', () => {
    expect(FIRESTORE_BATCH_LIMIT).toBe(500);
    expect(IMPORT_CHUNK_SIZE).toBeLessThan(FIRESTORE_BATCH_LIMIT);
  });

  it('a 2,000-row import becomes 5 batches, none over the ceiling', () => {
    const chunks = chunkForBatches(Array.from({ length: 2000 }, (_, i) => i));
    expect(chunks).toHaveLength(5);
    expect(chunks.map(c => c.length)).toEqual([450, 450, 450, 450, 200]);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(FIRESTORE_BATCH_LIMIT);
  });

  it('keeps every row, exactly once and in file order', () => {
    const items = Array.from({ length: 1001 }, (_, i) => i);
    expect(chunkForBatches(items).flat()).toEqual(items);
  });

  it('a row count at exactly the chunk size is one batch, not two', () => {
    expect(chunkForBatches(Array.from({ length: IMPORT_CHUNK_SIZE }, (_, i) => i))).toHaveLength(1);
    expect(chunkForBatches(Array.from({ length: IMPORT_CHUNK_SIZE + 1 }, (_, i) => i))).toHaveLength(2);
  });

  it('an empty list produces no batches at all', () => {
    expect(chunkForBatches([])).toEqual([]);
  });
});

// ── 9 ── PARTIAL FAILURE, REPORTED PRECISELY ─────────────────────────────────
//
// The reporting shape is the SMS broadcast's (THE-29): a count of what worked,
// then one clause per shortfall, joined with ` • `, plus an `ok` flag.
describe('a failure partway through reports exactly which rows were written', () => {
  it('a clean import says so and reports ok', () => {
    const { ok, text } = importSummary({
      imported: 42, duplicates: 0, repeatedInFile: 0, noName: 0, failure: null,
    });
    expect(ok).toBe(true);
    expect(text).toBe('Imported 42 contacts.');
  });

  it('names the exact line the import reached, and the first line it did not', () => {
    const { ok, text } = importSummary({
      imported: 198, duplicates: 0, repeatedInFile: 0, noName: 0,
      failure: {
        notWritten: 102, lastWrittenLine: 199, firstUnwrittenLine: 200,
        message: 'the connection dropped',
      },
    });
    expect(ok).toBe(false);
    expect(text).toContain('Imported 198 contacts');
    expect(text).toContain('102 not imported');
    expect(text).toContain('the connection dropped');
    expect(text).toContain('through line 199 was saved');
    expect(text).toContain('nothing from line 200 on');
  });

  it('a failure in the very first batch says plainly that nothing was saved', () => {
    const { text } = importSummary({
      imported: 0, duplicates: 0, repeatedInFile: 0, noName: 0,
      failure: {
        notWritten: 300, lastWrittenLine: null, firstUnwrittenLine: 2,
        message: 'permission denied',
      },
    });
    expect(text).toContain('Nothing was saved');
    expect(text).toContain('exactly as it was');
    // And it must not claim a line was written when none was.
    expect(text).not.toMatch(/through line \d/);
  });

  it('tells the admin the safe next move after a partial import', () => {
    const { text } = importSummary({
      imported: 5, duplicates: 0, repeatedInFile: 0, noName: 0,
      failure: { notWritten: 5, lastWrittenLine: 6, firstUnwrittenLine: 7, message: 'quota' },
    });
    expect(text).toMatch(/re-uploading the same file is safe/i);
  });

  it('reports duplicates, file repeats and nameless rows as separate facts', () => {
    const { ok, text } = importSummary({
      imported: 10, duplicates: 3, repeatedInFile: 2, noName: 1, failure: null,
    });
    expect(ok).toBe(false);
    expect(text).toContain('3 already in your CRM');
    expect(text).toContain('2 listed more than once in your file');
    expect(text).toContain('1 skipped — no first name');
    // Joined the way the SMS broadcast joins its partial-send clauses.
    expect(text.split(' • ')).toHaveLength(4);
  });

  it('never returns an empty report — silence after an import is the worst outcome', () => {
    const outcomes = [
      { imported: 0, duplicates: 0, repeatedInFile: 0, noName: 0, failure: null },
      { imported: 0, duplicates: 9, repeatedInFile: 0, noName: 0, failure: null },
    ];
    for (const outcome of outcomes) {
      expect(importSummary(outcome).text.trim().length).toBeGreaterThan(0);
    }
    expect(importSummary(outcomes[0]).text).toBe('Imported 0 contacts.');
  });

  it('counts singular and plural honestly', () => {
    expect(importSummary({
      imported: 1, duplicates: 0, repeatedInFile: 0, noName: 0, failure: null,
    }).text).toBe('Imported 1 contact.');
  });

  it('an import that only skipped is not reported as ok', () => {
    expect(importSummary({
      imported: 0, duplicates: 4, repeatedInFile: 0, noName: 0, failure: null,
    }).ok).toBe(false);
  });
});

// ── 1 ── THE WHOLE PIPELINE, ON A REAL-SHAPED EXPORT ─────────────────────────
describe('a valid CSV imports every row', () => {
  // A Breeze-shaped export: arbitrary headings, CRLF, a BOM, a quoted comma,
  // and a column the church does not want imported.
  const file = '﻿Given,Surname,Primary Email,Home Phone,Street,Internal ID\r\n'
    + 'Ruth,Boaz,ruth@church.org,+1 555 0100,"12 Field Rd, Apt 2",A-1\r\n'
    + 'Naomi,Elimelech,naomi@church.org,+1 555 0101,3 Bethlehem Way,A-2\r\n'
    + 'Boaz,Salmon,boaz@church.org,,,A-3\r\n';

  const mapping: ColumnMapping = { firstName: 0, lastName: 1, email: 2, phone: 3, street: 4 };

  it('reads every person under the header', () => {
    expect(tableOf(file).rows).toHaveLength(3);
  });

  it('maps every row, and none is dropped on the way to the write list', () => {
    const plan = planImport(mapRows(tableOf(file), mapping, 'member', TYPES), new Set<string>());
    expect(plan.toWrite).toHaveLength(3);
    expect(plan.skipped).toHaveLength(0);
    expect(plan.toWrite.map(r => r.firstName)).toEqual(['Ruth', 'Naomi', 'Boaz']);
  });

  it('carries every mapped value through intact, quoted comma and all', () => {
    const [ruth] = planImport(
      mapRows(tableOf(file), mapping, 'member', TYPES), new Set<string>(),
    ).toWrite;
    expect(ruth).toMatchObject({
      firstName: 'Ruth', lastName: 'Boaz',
      email: 'ruth@church.org', phone: '+1 555 0100',
      type: 'member', typeSource: 'chosen',
      address: { street: '12 Field Rd, Apt 2', city: '', state: '', zip: '', country: '' },
      notes: '',
    });
  });

  it('leaves the unmapped column out entirely — the internal id goes nowhere', () => {
    const [ruth] = planImport(
      mapRows(tableOf(file), mapping, 'member', TYPES), new Set<string>(),
    ).toWrite;
    expect(JSON.stringify(ruth)).not.toContain('A-1');
  });

  it('numbers each row by its line in the file, so every message can name it', () => {
    const rows = mapRows(tableOf(file), mapping, 'member', TYPES);
    expect(rows.map(r => r.line)).toEqual([2, 3, 4]);
  });

  it('a 600-row file survives the whole pipeline and chunks into two batches', () => {
    const big = 'First,Email\n'
      + Array.from({ length: 600 }, (_, i) => `Person${i},person${i}@church.org`).join('\n');
    const plan = planImport(
      mapRows(tableOf(big), { firstName: 0, email: 1 }, 'member', TYPES),
      new Set<string>(),
    );
    expect(plan.toWrite).toHaveLength(600);
    expect(chunkForBatches(plan.toWrite).map(c => c.length)).toEqual([450, 150]);
  });
});
