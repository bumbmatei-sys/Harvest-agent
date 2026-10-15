import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  CHURCH_EXPORT_MAX_AGE_MS,
  CHURCH_EXPORT_SPECS,
  SIGNED_URL_TTL_MS,
  SIGNED_URL_TTL_SECONDS,
  buildExportQueries,
  churchExportObjectKey,
  crc32,
  csvCell,
  exportExpired,
  isSafeExportId,
  isSafeTenantId,
  iterateQuery,
  parseChurchExportKey,
  rowToCells,
  writeChurchExportZip,
  type ExportRow,
  type PageQuery,
} from '../church-export';

/**
 * THE-228 — the streamed church export, without Firestore or R2.
 *
 * A fixed clock (2023-11-14) so nothing here is pinned near the day the suite
 * runs. The zip reader below is the test's, not the writer's: it trusts the
 * central directory, which is the part a streaming writer could get wrong.
 */

const NOW = Date.UTC(2023, 10, 14, 12, 0, 0);

function unzipStore(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  expect(eocd, 'zip has no end record').toBeGreaterThanOrEqual(0);
  const count = buf.readUInt16LE(eocd + 8);
  let cursor = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    expect(buf.readUInt32LE(cursor)).toBe(0x02014b50);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const size = buf.readUInt32LE(cursor + 20);
    const crc = buf.readUInt32LE(cursor + 16);
    const local = buf.readUInt32LE(cursor + 42);
    const name = buf.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8');
    const localNameLen = buf.readUInt16LE(local + 26);
    const localExtra = buf.readUInt16LE(local + 28);
    const start = local + 30 + localNameLen + localExtra;
    const bytes = buf.subarray(start, start + size);
    expect(crc32(bytes), `${name} crc`).toBe(crc);
    out.set(name, bytes);
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe('church export keys and lifetime', () => {
  it('scopes the object to the tenant and refuses a key that could point elsewhere', () => {
    expect(churchExportObjectKey('tenant-a', 'exp-1')).toBe('church-exports/tenant-a/exp-1.zip');
    expect(parseChurchExportKey('church-exports/tenant-a/exp-1.zip')).toEqual({
      tenantId: 'tenant-a',
      exportId: 'exp-1',
    });
    expect(parseChurchExportKey('tenants/tenant-a/uploads/other.bin')).toBeNull();
    expect(parseChurchExportKey('church-exports/../tenant-a/exp-1.zip')).toBeNull();
    expect(() => churchExportObjectKey('../tenant-a', 'exp-1')).toThrow(/Unsafe export key/);
    expect(() => churchExportObjectKey('tenant-a', 'exp/1')).toThrow(/Unsafe export key/);
    expect(isSafeTenantId('tenant-a')).toBe(true);
    expect(isSafeExportId('a/b')).toBe(false);
  });

  it('expires at 24 hours and not one millisecond earlier', () => {
    expect(exportExpired(NOW - CHURCH_EXPORT_MAX_AGE_MS, NOW)).toBe(true);
    expect(exportExpired(NOW - CHURCH_EXPORT_MAX_AGE_MS - 1, NOW)).toBe(true);
    expect(exportExpired(NOW - CHURCH_EXPORT_MAX_AGE_MS + 1, NOW)).toBe(false);
    expect(CHURCH_EXPORT_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('uses the same 15-minute signed-url lifetime as the receipt download', () => {
    const root = process.cwd();
    const here = readFileSync(path.join(root, 'src/lib/church-export.ts'), 'utf8');
    const receipt = readFileSync(path.join(root, 'src/app/api/donation-history/download/route.ts'), 'utf8');
    const rhs = (src: string) => src.match(/SIGNED_URL_TTL_MS = ([^;]+);/)?.[1];
    expect(rhs(here)).toBe(rhs(receipt));
    expect(SIGNED_URL_TTL_MS).toBe(15 * 60 * 1000);
    expect(SIGNED_URL_TTL_SECONDS).toBe(900);
  });
});

describe('church export csv', () => {
  const giving = CHURCH_EXPORT_SPECS.find((spec) => spec.filename === 'giving.csv')!;
  const members = CHURCH_EXPORT_SPECS.find((spec) => spec.filename === 'members.csv')!;

  it('names giving cents as cents and drops credential-shaped keys', () => {
    expect(CHURCH_EXPORT_SPECS.map((spec) => spec.filename)).toEqual([
      'members.csv', 'contacts.csv', 'giving.csv', 'events.csv',
    ]);
    expect(CHURCH_EXPORT_SPECS.map((spec) => spec.source)).not.toContain('contactActivities');
    const cells = rowToCells(giving, 'inv-1', {
      amount: 105500,
      currency: 'usd',
      type: 'donation',
      password: 'do-not-export',
      note: 'general',
    });
    expect(cells[0]).toBe('inv-1');
    const headers = giving.columns.map((column) => column.header);
    expect(headers).toContain('amountCents');
    expect(headers).not.toContain('amount');
    expect(cells[headers.indexOf('amountCents')]).toBe(105500);
    const extra = cells[cells.length - 1] as Record<string, unknown>;
    expect(extra).toEqual({ note: 'general' });
    expect(JSON.stringify(extra)).not.toContain('do-not-export');
  });

  it('prefixes a formula and quotes a comma', () => {
    expect(csvCell('=cmd')).toBe("'=cmd");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('keeps a timestamp and does not turn it into a blank', () => {
    const cells = rowToCells(members, 'mem-1', {
      email: 'member@example.com',
      createdAt: { _seconds: 1_600_000_000 },
    });
    const created = members.columns.findIndex((column) => column.header === 'createdAt');
    expect(csvCell(cells[created])).toBe('2020-09-13T12:26:40.000Z');
  });
});

describe('church export streaming', () => {
  it('asks for the next page only after the current page has been written', async () => {
    const chunks: Buffer[] = [];
    let writesBeforeSecondPage = -1;
    async function* pages(): AsyncGenerator<ExportRow[]> {
      yield [{ id: 'row-1', data: { email: 'one@example.com' } }];
      writesBeforeSecondPage = chunks.length;
      yield [{ id: 'row-2', data: { email: 'two@example.com' } }];
    }
    const spec = CHURCH_EXPORT_SPECS[0];
    await writeChurchExportZip(
      [{ spec, pages: pages() }],
      { write: (chunk) => { chunks.push(chunk); } },
    );
    expect(writesBeforeSecondPage).toBeGreaterThanOrEqual(3);
    const zip = unzipStore(Buffer.concat(chunks));
    const csv = zip.get('members.csv')!.toString('utf8');
    expect(csv).toContain('one@example.com');
    expect(csv).toContain('two@example.com');
  });

  it('pages a query and does not fetch page two before page one is consumed', async () => {
    const rows = ['a', 'b', 'c'];
    let offset = 0;
    let gets = 0;
    const query: PageQuery = {
      startAfter() { return query; },
      limit(n: number) {
        const start = offset;
        return {
          async get() {
            gets += 1;
            const slice = rows.slice(start, start + n);
            offset = start + slice.length;
            return {
              empty: slice.length === 0,
              size: slice.length,
              docs: slice.map((id) => ({ id, data: () => ({ email: `${id}@example.com` }) })),
            };
          },
        };
      },
    };
    const iter = iterateQuery(query, 2);
    const first = await iter.next();
    expect(gets).toBe(1);
    expect(first.value?.map((row: ExportRow) => row.id)).toEqual(['a', 'b']);
    const second = await iter.next();
    expect(gets).toBe(2);
    expect(second.value?.map((row: ExportRow) => row.id)).toEqual(['c']);
    const done = await iter.next();
    expect(done.done).toBe(true);
  });
});

describe('church export queries are tenant scoped', () => {
  it('constrains members with where and reads the other collections under the tenant', () => {
    const calls: string[] = [];
    const chain = (label: string) => {
      const query = {
        where(field: string, op: string, value: string) {
          calls.push(`${label} where ${field} ${op} ${value}`);
          return query;
        },
        orderBy() {
          calls.push(`${label} orderBy id`);
          return query;
        },
        doc(id: string) {
          return { collection: (name: string) => chain(`${label}/${id}/${name}`) };
        },
      };
      return query;
    };
    const built = buildExportQueries({ collection: (name) => chain(name) }, 'tenant-a');
    expect(built.map((entry) => entry.spec.filename)).toEqual([
      'members.csv', 'contacts.csv', 'giving.csv', 'events.csv',
    ]);
    expect(calls).toContain('users where tenantId == tenant-a');
    expect(calls).toContain('users orderBy id');
    expect(calls).toContain('tenants/tenant-a/contacts orderBy id');
    expect(calls).toContain('tenants/tenant-a/invoices orderBy id');
    expect(calls).toContain('tenants/tenant-a/events orderBy id');
    expect(() => buildExportQueries({ collection: (name) => chain(name) }, '../other')).toThrow(/Unsafe tenant/);
  });
});

describe('church export stays off the member access and erasure paths', () => {
  it('does not import either module', () => {
    const root = process.cwd();
    const files = [
      'src/lib/church-export.ts',
      'src/lib/church-export-auth.ts',
      'src/lib/church-export-run.ts',
      'src/app/api/church-export/route.ts',
      'src/app/api/church-export/url/route.ts',
      'src/app/api/church-export/complete/route.ts',
      'src/app/api/church-export/sweep/route.ts',
      'src/components/settings/ChurchDataExportPanel.tsx',
    ];
    const member = ['member', 'export'].join('-');
    const erasure = ['member', 'erasure'].join('-');
    for (const file of files) {
      const src = readFileSync(path.join(root, file), 'utf8');
      expect(src, file).not.toMatch(new RegExp(`from ['"][^'"]*${member}`));
      expect(src, file).not.toMatch(new RegExp(`from ['"][^'"]*${erasure}`));
    }
  });
});
