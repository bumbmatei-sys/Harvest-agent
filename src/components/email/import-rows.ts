import { readCsvTable } from '@/utils/csv-import';
import type { ImportRowInput } from '@/components/email/email-api';

export type ReadImport =
  | { ok: true; rows: ImportRowInput[]; columns: { email: string; name: string | null; tags: string | null } }
  | { ok: false; error: string };

const find = (headers: string[], test: RegExp): number => headers.findIndex((h) => test.test(h.trim()));

/**
 * A spreadsheet export (Mailchimp, Substack, a church database) to rows the
 * server can merge into the CRM. Columns are found by their headings; the file
 * must have an email column, and nothing else is required.
 */
export function readImportRows(text: string): ReadImport {
  const read = readCsvTable(text);
  if (!read.ok) return read;
  const { headers, rows } = read.table;
  const email = find(headers, /^e-?mail( address)?$/i) >= 0 ? find(headers, /^e-?mail( address)?$/i) : find(headers, /e-?mail/i);
  if (email < 0) return { ok: false, error: 'That file has no email column. Add a column headed "Email" and try again.' };
  const full = find(headers, /^(full )?name$/i);
  const first = find(headers, /^first( name)?$/i);
  const last = find(headers, /^last( name)?$/i);
  const tags = find(headers, /^tags?$/i);
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  const out = rows.map((r) => ({
    email: cell(r, email),
    name: full >= 0 ? cell(r, full) : [cell(r, first), cell(r, last)].filter(Boolean).join(' '),
    tags: cell(r, tags).split(/[;,|]/).map((t) => t.trim()).filter(Boolean),
  }));
  return {
    ok: true,
    rows: out,
    columns: { email: headers[email], name: full >= 0 ? headers[full] : first >= 0 ? headers[first] : null, tags: tags >= 0 ? headers[tags] : null },
  };
}
