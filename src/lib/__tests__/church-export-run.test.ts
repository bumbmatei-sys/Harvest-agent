import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateMultipartUploadCommand } from '@aws-sdk/client-s3';

/**
 * THE-228 — upload, signing, delete-after-download and the 24-hour sweep.
 * Firestore and R2 are fakes. The clock is 2023-11-14, not the day this runs.
 */

const NOW = Date.UTC(2023, 10, 14, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

interface JobDoc {
  status?: string;
  objectKey?: string;
  createdAtMs?: number;
  error?: string;
  createdBy?: string;
}

interface SweepDoc {
  id: string;
  tenantId: string;
  data: JobDoc;
  deleted: boolean;
}

const state = vi.hoisted(() => ({
  bucket: 'exports-bucket' as string | undefined,
  rows: {} as Record<string, { id: string; data: Record<string, unknown> }[] | Error>,
  jobs: new Map<string, JobDoc>(),
  objects: [] as { Key: string; LastModified: Date }[],
  docs: [] as SweepDoc[],
  deletedKeys: [] as string[],
  wheres: [] as string[],
  paths: [] as string[],
  signed: [] as { expiresIn?: number; key?: string }[],
}));

const mockSend = vi.hoisted(() => vi.fn());

const parts = vi.hoisted(() => [] as Buffer[]);

vi.mock('@/lib/r2', () => ({
  createR2Client: () => ({ send: mockSend }),
  r2Bucket: () => state.bucket,
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: async (_client: unknown, command: { input?: { Key?: string } }, opts: { expiresIn?: number }) => {
    state.signed.push({ expiresIn: opts.expiresIn, key: command.input?.Key });
    return 'https://signed.example/church-export';
  },
}));

function pageQuery(source: string) {
  let cursor = 0;
  const query = {
    where(field: string, op: string, value: string) {
      state.wheres.push(`${source} ${field} ${op} ${value}`);
      return query;
    },
    orderBy() { return query; },
    startAfter() { return query; },
    limit(n: number) {
      return {
        get: async () => {
          const rows = state.rows[source] ?? [];
          if (rows instanceof Error) throw rows;
          const slice = rows.slice(cursor, cursor + n);
          cursor += slice.length;
          return {
            empty: slice.length === 0,
            size: slice.length,
            docs: slice.map((row) => ({ id: row.id, data: () => row.data })),
          };
        },
      };
    },
    doc(id: string) {
      return { collection: (name: string) => collection(`${source}/${id}/${name}`) };
    },
  };
  return query;
}

function collection(name: string) {
  if (name === 'users') return pageQuery('users');
  if (!name.startsWith('tenants/')) {
    return {
      doc: (id: string) => ({ collection: (sub: string) => collection(`tenants/${id}/${sub}`) }),
    };
  }
  if (name.endsWith('/churchExports')) {
    const tenantId = name.split('/')[1];
    return {
      doc: (id: string) => ({
        set: async (data: JobDoc) => { state.jobs.set(`${tenantId}/${id}`, data); },
        get: async () => {
          const data = state.jobs.get(`${tenantId}/${id}`);
          return { exists: !!data, id, data: () => data };
        },
      }),
      orderBy: () => ({ limit: () => ({ get: async () => ({ empty: true, size: 0, docs: [] }) }) }),
    };
  }
  const source = name.split('/').pop()!;
  state.paths.push(name);
  return pageQuery(source);
}

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => collection(name),
    collectionGroup: () => ({
      where: (_field: string, _op: string, cutoff: number) => ({
        orderBy: () => ({
          limit: () => ({
            get: async () => {
              const docs = state.docs.filter((doc) => !doc.deleted && (doc.data.createdAtMs ?? 0) <= cutoff);
              return {
                empty: docs.length === 0,
                size: docs.length,
                docs: docs.map((doc) => ({
                  id: doc.id,
                  data: () => doc.data,
                  ref: {
                    parent: { parent: { id: doc.tenantId } },
                    delete: async () => { doc.deleted = true; },
                  },
                })),
              };
            },
          }),
        }),
      }),
    }),
  },
}));

const {
  consumeChurchExport,
  runChurchExport,
  signChurchExportUrl,
  sweepChurchExports,
  sweepListedObjects,
  uploadStreamToR2,
} = await import('../church-export-run');

beforeEach(() => {
  state.bucket = 'exports-bucket';
  state.rows = {};
  state.jobs.clear();
  state.objects = [];
  state.docs = [];
  state.deletedKeys = [];
  state.wheres = [];
  state.paths = [];
  state.signed = [];
  parts.length = 0;
  mockSend.mockClear();
  mockSend.mockImplementation(async (cmd: { constructor: { name: string }; input?: Record<string, unknown> }) => {
    const name = cmd.constructor.name;
    if (name === 'ListObjectsV2Command') return { Contents: state.objects, IsTruncated: false };
    if (name === 'DeleteObjectCommand') {
      state.deletedKeys.push(String(cmd.input?.Key));
      return {};
    }
    if (name === 'CreateMultipartUploadCommand') return { UploadId: 'up-1' };
    if (name === 'UploadPartCommand') {
      const body = cmd.input?.Body;
      if (Buffer.isBuffer(body)) parts.push(body);
      return { ETag: `etag-${cmd.input?.PartNumber}` };
    }
    return {};
  });
});

describe('uploadStreamToR2', () => {
  it('sends a part before the rest of the body is written', async () => {
    const sent: string[] = [];
    let partsBeforeSecond = -1;
    const client = {
      send: async (cmd: { constructor: { name: string }; input?: { Body?: Buffer; PartNumber?: number } }) => {
        sent.push(cmd.constructor.name);
        if (cmd.constructor.name === 'CreateMultipartUploadCommand') return { UploadId: 'up-1' };
        if (cmd.constructor.name === 'UploadPartCommand') return { ETag: `e-${cmd.input?.PartNumber}` };
        return {};
      },
    };
    await uploadStreamToR2({
      client,
      bucket: 'exports-bucket',
      key: 'church-exports/tenant-a/exp-1.zip',
      minPartBytes: 4,
      write: async (sink) => {
        await sink.write(Buffer.from('abcd'));
        partsBeforeSecond = sent.filter((name) => name === 'UploadPartCommand').length;
        await sink.write(Buffer.from('ef'));
      },
    });
    expect(sent[0]).toBe('CreateMultipartUploadCommand');
    expect(partsBeforeSecond).toBe(1);
    expect(sent.at(-1)).toBe('CompleteMultipartUploadCommand');
    expect(sent).not.toContain('AbortMultipartUploadCommand');
  });

  it('aborts the upload when the stream fails and does not complete it', async () => {
    const sent: string[] = [];
    const client = {
      send: async (cmd: { constructor: { name: string } }) => {
        sent.push(cmd.constructor.name);
        if (cmd.constructor.name === 'CreateMultipartUploadCommand') return { UploadId: 'up-1' };
        return {};
      },
    };
    await expect(uploadStreamToR2({
      client,
      bucket: 'exports-bucket',
      key: 'church-exports/tenant-a/exp-1.zip',
      minPartBytes: 4,
      write: async () => { throw new Error('read failed'); },
    })).rejects.toThrow('read failed');
    expect(sent).toContain('AbortMultipartUploadCommand');
    expect(sent).not.toContain('CompleteMultipartUploadCommand');
  });
});

describe('runChurchExport', () => {
  it('streams each collection for that tenant and stores cents as cents', async () => {
    state.rows = {
      users: [{ id: 'mem-1', data: { email: 'member@example.com', password: 'do-not-export' } }],
      contacts: [{ id: 'con-1', data: { firstName: 'Ada', totalDonated: 12, apiKey: 'do-not-export' } }],
      invoices: [{ id: 'inv-1', data: { amount: 105500, currency: 'usd', type: 'donation' } }],
      events: [{ id: 'ev-1', data: { title: 'Gathering' } }],
    };
    const result = await runChurchExport('tenant-a', 'admin-1');
    expect(result.status).toBe('ready');
    expect(result.files).toEqual(['members.csv', 'contacts.csv', 'giving.csv', 'events.csv']);
    expect(state.wheres).toContain('users tenantId == tenant-a');
    expect(state.paths).toEqual([
      'tenants/tenant-a/contacts',
      'tenants/tenant-a/invoices',
      'tenants/tenant-a/events',
    ]);
    const created = mockSend.mock.calls.map((call) => call[0].constructor.name);
    expect(created).toContain('CreateMultipartUploadCommand');
    expect(created).toContain('CompleteMultipartUploadCommand');
    const key = mockSend.mock.calls.find((call) => call[0] instanceof CreateMultipartUploadCommand)?.[0].input.Key;
    expect(key).toBe(`church-exports/tenant-a/${result.exportId}.zip`);
    const zip = Buffer.concat(parts).toString('utf8');
    expect(zip).toContain('amountCents');
    expect(zip).toContain('105500');
    expect(zip).toContain('totalDonatedDollars');
    expect(zip).not.toContain('do-not-export');
    const job = [...state.jobs.values()].find((entry) => entry.status === 'ready');
    expect(job?.objectKey).toBe(key);
    expect(job?.error).toBeUndefined();
  });

  it('surfaces a failed read and does not store the row that failed it', async () => {
    state.rows = { users: new Error('row leaked@example.com') };
    await expect(runChurchExport('tenant-a', 'admin-1')).rejects.toThrow('Could not read members.csv');
    const failed = [...state.jobs.values()].find((entry) => entry.status === 'failed');
    expect(failed?.error).toBe('Could not read members.csv');
    expect(failed?.error).not.toContain('leaked');
    const names = mockSend.mock.calls.map((call) => call[0].constructor.name);
    expect(names).toContain('AbortMultipartUploadCommand');
    expect(names).not.toContain('CompleteMultipartUploadCommand');
  });

  it('refuses to report success when storage is not configured', async () => {
    state.bucket = undefined;
    await expect(runChurchExport('tenant-a', 'admin-1')).rejects.toThrow('Export storage is not configured');
    expect(state.jobs.size).toBe(0);
  });
});

describe('signed url and delete after download', () => {
  it('signs for 15 minutes and only for a church-export key', async () => {
    const url = await signChurchExportUrl('church-exports/tenant-a/exp-1.zip');
    expect(url).toBe('https://signed.example/church-export');
    expect(state.signed).toEqual([{ expiresIn: 900, key: 'church-exports/tenant-a/exp-1.zip' }]);
    await expect(signChurchExportUrl('tenants/tenant-a/uploads/other.bin')).rejects.toThrow(/missing/);
  });

  it('deletes the object and marks the job consumed', async () => {
    const job = {
      id: 'exp-1',
      status: 'ready' as const,
      createdAtMs: NOW,
      objectKey: 'church-exports/tenant-a/exp-1.zip',
    };
    await consumeChurchExport('tenant-a', job);
    expect(state.deletedKeys).toEqual(['church-exports/tenant-a/exp-1.zip']);
    expect(state.jobs.get('tenant-a/exp-1')?.status).toBe('consumed');
  });

  it('does not delete an object the job key does not own', async () => {
    await expect(consumeChurchExport('tenant-a', {
      id: 'exp-1',
      status: 'ready',
      createdAtMs: NOW,
      objectKey: 'tenants/tenant-a/uploads/other.bin',
    })).rejects.toThrow(/missing/);
    expect(state.deletedKeys).toEqual([]);
  });
});

describe('the 24-hour sweep', () => {
  it('drops expired keys, keeps younger ones, and refuses a key that is not an export', async () => {
    const removed: string[] = [];
    const counts = await sweepListedObjects((async function* () {
      yield { key: 'church-exports/tenant-a/old.zip', lastModifiedMs: NOW - 25 * 60 * 60 * 1000 };
      yield { key: 'church-exports/tenant-a/fresh.zip', lastModifiedMs: NOW - 60 * 60 * 1000 };
      yield { key: 'church-exports/tenant-a/exact.zip', lastModifiedMs: NOW - DAY };
      yield { key: 'church-exports/tenant-a/almost.zip', lastModifiedMs: NOW - DAY + 1 };
      yield { key: 'tenants/tenant-a/uploads/other.bin', lastModifiedMs: NOW - 48 * 60 * 60 * 1000 };
    })(), NOW, async (key) => { removed.push(key); });
    expect(removed.sort()).toEqual([
      'church-exports/tenant-a/exact.zip',
      'church-exports/tenant-a/old.zip',
    ]);
    expect(counts).toEqual({ deleted: 2, kept: 2, refused: 1 });
  });

  it('deletes expired objects once, deletes a bad pointer record without deleting the foreign object, and fails closed without a bucket', async () => {
    state.objects = [
      { Key: 'church-exports/tenant-a/oldexport.zip', LastModified: new Date(NOW - DAY - 1000) },
      { Key: 'church-exports/tenant-a/newexport.zip', LastModified: new Date(NOW - 60 * 60 * 1000) },
      { Key: 'church-exports/tenant-a/exact.zip', LastModified: new Date(NOW - DAY) },
      { Key: 'tenants/tenant-a/uploads/nope.bin', LastModified: new Date(NOW - DAY - 1000) },
    ];
    state.docs = [
      {
        id: 'olddoc',
        tenantId: 'tenant-a',
        deleted: false,
        data: { objectKey: 'church-exports/tenant-a/olddoc.zip', createdAtMs: NOW - DAY },
      },
      {
        id: 'baddoc',
        tenantId: 'tenant-a',
        deleted: false,
        data: { objectKey: 'tenants/tenant-a/uploads/secret.bin', createdAtMs: NOW - DAY - 1000 },
      },
      {
        id: 'freshdoc',
        tenantId: 'tenant-a',
        deleted: false,
        data: { objectKey: 'church-exports/tenant-a/freshdoc.zip', createdAtMs: NOW - 1000 },
      },
    ];
    const counts = await sweepChurchExports(NOW);
    expect(state.deletedKeys.sort()).toEqual([
      'church-exports/tenant-a/exact.zip',
      'church-exports/tenant-a/olddoc.zip',
      'church-exports/tenant-a/oldexport.zip',
    ]);
    expect(counts.deleted).toBe(3);
    expect(counts.kept).toBe(1);
    expect(counts.refused).toBe(2);
    expect(state.docs.find((doc) => doc.id === 'baddoc')?.deleted).toBe(true);
    expect(state.docs.find((doc) => doc.id === 'freshdoc')?.deleted).toBe(false);
    expect(state.deletedKeys).not.toContain('tenants/tenant-a/uploads/secret.bin');
    expect(state.deletedKeys).not.toContain('tenants/tenant-a/uploads/nope.bin');

    state.bucket = undefined;
    await expect(sweepChurchExports(NOW)).rejects.toThrow('Export storage is not configured');
  });
});
