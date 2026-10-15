import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateMultipartUploadCommand } from '@aws-sdk/client-s3';
import { CHURCH_EXPORT_COOLDOWN_MS, CHURCH_EXPORT_STUCK_MS, ChurchExportRejected } from '../church-export';

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
  uploadId?: string;
  byteSize?: number;
}

const state = vi.hoisted(() => ({
  bucket: 'exports-bucket' as string | undefined,
  rows: {} as Record<string, { id: string; data: Record<string, unknown> }[] | Error>,
  jobs: new Map<string, JobDoc>(),
  objects: [] as { Key: string; LastModified: Date }[],
  deletedKeys: [] as string[],
  wheres: [] as string[],
  paths: [] as string[],
  signed: [] as { expiresIn?: number; key?: string }[],
  audits: new Map<string, Record<string, unknown>>(),
  gates: new Map<string, Record<string, unknown>>(),
  uploads: [] as { Key: string; UploadId: string; Initiated: Date }[],
  aborted: [] as string[],
  collectionGroupCalls: 0,
  indexedQueries: 0,
  firestoreOps: [] as string[],
  auditError: null as Error | null,
  txTail: Promise.resolve() as Promise<void>,
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
    // A query is not implemented. The sweep must read a document by id. A
    // where/orderBy chain would need an index this repo does not deploy.
    const refuseQuery = () => {
      state.indexedQueries += 1;
      throw new Error('firestore query');
    };
    return {
      doc: (id: string) => ({
        set: async (data: JobDoc, options?: { merge?: boolean }) => {
          for (const value of Object.values(data)) {
            if (value === undefined) throw new Error('undefined firestore value');
          }
          const key = `${tenantId}/${id}`;
          state.firestoreOps.push(`doc set ${name}/${id}`);
          state.jobs.set(key, options?.merge ? { ...state.jobs.get(key), ...data } : data);
        },
        delete: async () => {
          state.firestoreOps.push(`doc delete ${name}/${id}`);
          state.jobs.delete(`${tenantId}/${id}`);
        },
        get: async () => {
          state.firestoreOps.push(`doc get ${name}/${id}`);
          const data = state.jobs.get(`${tenantId}/${id}`);
          return { exists: !!data, id, data: () => data };
        },
      }),
      where: refuseQuery,
      orderBy: refuseQuery,
      limit: refuseQuery,
      startAfter: refuseQuery,
      get: refuseQuery,
    };
  }
  if (name.endsWith('/churchExportAudits')) {
    const tenantId = name.split('/')[1];
    return {
      doc: (id: string) => ({
        get: async () => {
          const data = state.audits.get(`${tenantId}/${id}`);
          return { exists: !!data, id, data: () => data };
        },
        set: async (data: Record<string, unknown>) => {
          if (state.auditError) throw state.auditError;
          state.audits.set(`${tenantId}/${id}`, data);
        },
      }),
    };
  }
  if (name.endsWith('/churchExportGate')) {
    const tenantId = name.split('/')[1];
    return {
      doc: (id: string) => ({
        get: async () => {
          const data = state.gates.get(`${tenantId}/${id}`);
          return { exists: data !== undefined, id, data: () => data };
        },
        set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
          const key = `${tenantId}/${id}`;
          state.gates.set(key, options?.merge ? { ...state.gates.get(key), ...data } : data);
        },
      }),
    };
  }
  const source = name.split('/').pop()!;
  state.paths.push(name);
  return pageQuery(source);
}

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => collection(name),
    collectionGroup: () => {
      state.collectionGroupCalls += 1;
      throw new Error('collection group query');
    },
    runTransaction: async (fn: (tx: {
      get: (ref: { get: () => Promise<unknown> }) => Promise<unknown>;
      set: (ref: { set: (data: unknown) => Promise<void> }, data: unknown) => void;
    }) => Promise<unknown>) => {
      const run = state.txTail.then(async () => {
        const writes: (() => Promise<void>)[] = [];
        const result = await fn({
          get: (ref) => ref.get(),
          set: (ref, data) => { writes.push(() => ref.set(data)); },
        });
        for (const write of writes) await write();
        return result;
      });
      state.txTail = run.then(() => undefined, () => undefined);
      return run;
    },
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
  state.deletedKeys = [];
  state.wheres = [];
  state.paths = [];
  state.signed = [];
  state.audits.clear();
  state.gates.clear();
  state.uploads = [];
  state.aborted = [];
  state.collectionGroupCalls = 0;
  state.indexedQueries = 0;
  state.firestoreOps = [];
  state.auditError = null;
  state.txTail = Promise.resolve();
  parts.length = 0;
  mockSend.mockClear();
  mockSend.mockImplementation(async (cmd: { constructor: { name: string }; input?: Record<string, unknown> }) => {
    const name = cmd.constructor.name;
    if (name === 'ListObjectsV2Command') return { Contents: state.objects, IsTruncated: false };
    if (name === 'ListMultipartUploadsCommand') return { Uploads: state.uploads, IsTruncated: false };
    if (name === 'AbortMultipartUploadCommand') {
      state.aborted.push(String(cmd.input?.UploadId));
      return {};
    }
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
    expect(zip).not.toContain(',extra');
    const job = [...state.jobs.values()].find((entry) => entry.status === 'ready');
    expect(job?.objectKey).toBe(key);
    expect(job?.error).toBeUndefined();
    expect(job?.uploadId).toBe('up-1');
    const audit = state.audits.get(`tenant-a/${result.exportId}`);
    expect(audit).toMatchObject({
      exportId: result.exportId,
      tenantId: 'tenant-a',
      createdBy: 'admin-1',
      status: 'ready',
      rowCounts: {
        'members.csv': 1,
        'contacts.csv': 1,
        'giving.csv': 1,
        'events.csv': 1,
      },
    });
    const allowed = new Set([
      'exportId', 'tenantId', 'createdBy', 'createdAtMs', 'completedAtMs', 'status', 'rowCounts', 'byteSize',
    ]);
    for (const field of Object.keys(audit ?? {})) expect(allowed.has(field)).toBe(true);
    expect(JSON.stringify(audit)).not.toContain('member@example.com');
    expect(JSON.stringify(audit)).not.toContain('Ada');
  });

  it('stores a generic failure and an audit, and does not keep the leaked read', async () => {
    state.rows = { users: new Error('row leaked@example.com') };
    await expect(runChurchExport('tenant-a', 'admin-1')).rejects.toThrow('Could not read members.csv');
    const failed = [...state.jobs.values()].find((entry) => entry.status === 'failed');
    expect(failed?.error).toBe('Export failed');
    expect(JSON.stringify(failed)).not.toContain('leaked');
    const audit = [...state.audits.values()][0];
    expect(audit).toMatchObject({ tenantId: 'tenant-a', createdBy: 'admin-1', status: 'failed' });
    expect(JSON.stringify(audit)).not.toContain('leaked');
    const names = mockSend.mock.calls.map((call) => call[0].constructor.name);
    expect(names).toContain('AbortMultipartUploadCommand');
    expect(names).not.toContain('CompleteMultipartUploadCommand');
  });

  it('logs an audit failure and still rejects with the original read error', async () => {
    state.rows = { users: new Error('row leaked@example.com') };
    state.auditError = new Error('audit blew up');
    const logged: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((msg: unknown, err?: unknown) => {
      const detail = err instanceof Error ? err.message : '';
      logged.push(`${String(msg)} ${detail}`);
    });
    await expect(runChurchExport('tenant-a', 'admin-1')).rejects.toThrow('Could not read members.csv');
    spy.mockRestore();
    expect(logged.some((line) => line.includes('Could not read members.csv'))).toBe(true);
    expect(logged.some((line) => line.includes('audit blew up'))).toBe(true);
  });

  it('allows one running export, then a cooldown, and clears a stuck upload', async () => {
    state.gates.set('tenant-a/lock', {
      status: 'running',
      startedAtMs: NOW - 1000,
      exportId: 'live',
      objectKey: 'church-exports/tenant-a/live.zip',
      createdBy: 'admin-1',
    });
    await expect(runChurchExport('tenant-a', 'admin-1', NOW)).rejects.toBeInstanceOf(ChurchExportRejected);
    await expect(runChurchExport('tenant-a', 'admin-1', NOW)).rejects.toMatchObject({ code: 'active' });
    expect(state.aborted).toEqual([]);

    state.gates.set('tenant-a/lock', {
      status: 'ready',
      startedAtMs: NOW - 1000,
      exportId: 'live',
      objectKey: 'church-exports/tenant-a/live.zip',
      createdBy: 'admin-1',
    });
    await expect(runChurchExport('tenant-a', 'admin-1', NOW)).rejects.toMatchObject({ code: 'cooldown' });
    expect(NOW - (NOW - 1000)).toBeLessThan(CHURCH_EXPORT_COOLDOWN_MS);

    state.gates.set('tenant-a/lock', {
      status: 'running',
      startedAtMs: NOW - CHURCH_EXPORT_STUCK_MS,
      exportId: 'stuck',
      objectKey: 'church-exports/tenant-a/stuck.zip',
      uploadId: 'up-stuck',
      createdBy: 'admin-1',
    });
    const result = await runChurchExport('tenant-a', 'admin-1', NOW);
    expect(result.status).toBe('ready');
    expect(state.aborted).toContain('up-stuck');
    expect(state.jobs.get('tenant-a/stuck')?.status).toBe('failed');
    expect(state.audits.get('tenant-a/stuck')).toMatchObject({
      status: 'failed',
      createdBy: 'admin-1',
      tenantId: 'tenant-a',
      rowCounts: {},
    });
    expect(state.gates.get('tenant-a/lock')).toMatchObject({ status: 'ready', exportId: result.exportId });
  });

  it('does not mark a finished export failed when its lock is stolen', async () => {
    state.gates.set('tenant-a/lock', {
      status: 'running',
      startedAtMs: NOW - CHURCH_EXPORT_STUCK_MS,
      exportId: 'done',
      objectKey: 'church-exports/tenant-a/done.zip',
      uploadId: 'up-done',
      createdBy: 'admin-1',
    });
    state.jobs.set('tenant-a/done', {
      status: 'ready',
      objectKey: 'church-exports/tenant-a/done.zip',
      createdAtMs: NOW - CHURCH_EXPORT_STUCK_MS,
      uploadId: 'up-done',
      createdBy: 'admin-1',
    });
    const result = await runChurchExport('tenant-a', 'admin-1', NOW);
    expect(result.status).toBe('ready');
    expect(state.jobs.get('tenant-a/done')?.status).toBe('ready');
    expect(state.audits.has('tenant-a/done')).toBe(false);
    expect(state.gates.get('tenant-a/lock')).toMatchObject({ status: 'ready', exportId: result.exportId });
  });

  it('lets one of two simultaneous claims start', async () => {
    const settled = await Promise.allSettled([
      runChurchExport('tenant-a', 'admin-1', NOW),
      runChurchExport('tenant-a', 'admin-2', NOW),
    ]);
    const started = settled.filter((result) => result.status === 'fulfilled');
    const refused = settled.filter((result) => result.status === 'rejected');
    expect(started).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'active' });
    const creates = mockSend.mock.calls.filter((call) => call[0] instanceof CreateMultipartUploadCommand);
    expect(creates).toHaveLength(1);
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
    expect(counts).toEqual({ deleted: 2, kept: 2, refused: 1, aborted: 0 });
  });

  it('deletes an expired object and that one job document, and refuses a collection-group query', async () => {
    state.objects = [
      { Key: 'church-exports/tenant-a/oldexport.zip', LastModified: new Date(NOW - DAY - 1000) },
      { Key: 'church-exports/tenant-a/newexport.zip', LastModified: new Date(NOW - 60 * 60 * 1000) },
      { Key: 'church-exports/tenant-a/exact.zip', LastModified: new Date(NOW - DAY) },
      { Key: 'tenants/tenant-a/uploads/nope.bin', LastModified: new Date(NOW - DAY - 1000) },
    ];
    state.jobs.set('tenant-a/oldexport', {
      status: 'ready',
      objectKey: 'church-exports/tenant-a/oldexport.zip',
      createdAtMs: NOW - DAY - 1000,
      createdBy: 'admin-1',
    });
    state.jobs.set('tenant-a/newexport', {
      status: 'ready',
      objectKey: 'church-exports/tenant-a/newexport.zip',
      createdAtMs: NOW - 60 * 60 * 1000,
      createdBy: 'admin-1',
    });
    state.jobs.set('tenant-a/unrelated', {
      status: 'failed',
      objectKey: 'tenants/tenant-a/uploads/secret.bin',
      createdAtMs: NOW - DAY - 1000,
      createdBy: 'admin-1',
    });
    state.audits.set('tenant-a/already', {
      exportId: 'already',
      tenantId: 'tenant-a',
      createdBy: 'admin-1',
      createdAtMs: NOW - 48 * 60 * 60 * 1000,
      status: 'ready',
      rowCounts: { 'members.csv': 3 },
    });
    const counts = await sweepChurchExports(NOW);
    expect(state.deletedKeys.sort()).toEqual([
      'church-exports/tenant-a/exact.zip',
      'church-exports/tenant-a/oldexport.zip',
    ]);
    expect(counts).toMatchObject({ deleted: 2, kept: 1, refused: 1, aborted: 0 });
    expect(state.jobs.has('tenant-a/oldexport')).toBe(false);
    expect(state.jobs.get('tenant-a/newexport')?.status).toBe('ready');
    expect(state.jobs.get('tenant-a/unrelated')?.objectKey).toBe('tenants/tenant-a/uploads/secret.bin');
    expect(state.deletedKeys).not.toContain('tenants/tenant-a/uploads/secret.bin');
    expect(state.deletedKeys).not.toContain('tenants/tenant-a/uploads/nope.bin');
    expect(state.audits.get('tenant-a/already')).toMatchObject({ rowCounts: { 'members.csv': 3 } });
    expect(state.collectionGroupCalls).toBe(0);
    expect(state.indexedQueries).toBe(0);
    expect(state.firestoreOps.every((op) => op.startsWith('doc '))).toBe(true);
    expect(state.firestoreOps).toContain('doc delete tenants/tenant-a/churchExports/oldexport');
    const listed = mockSend.mock.calls.filter((call) => call[0].constructor.name === 'ListObjectsV2Command');
    expect(listed.length).toBeGreaterThan(0);
    expect(listed[0][0].input.Prefix).toBe('church-exports/');

    state.bucket = undefined;
    await expect(sweepChurchExports(NOW)).rejects.toThrow('Export storage is not configured');
  });

  it('aborts an orphaned multipart upload and updates the job that key names', async () => {
    state.uploads = [
      { Key: 'church-exports/tenant-a/old-upload.zip', UploadId: 'up-old', Initiated: new Date(NOW - CHURCH_EXPORT_STUCK_MS) },
      { Key: 'church-exports/tenant-a/live-upload.zip', UploadId: 'up-live', Initiated: new Date(NOW - 1000) },
      { Key: 'tenants/tenant-a/uploads/nope.bin', UploadId: 'up-foreign', Initiated: new Date(NOW - CHURCH_EXPORT_STUCK_MS) },
    ];
    state.jobs.set('tenant-a/old-upload', {
      status: 'running',
      objectKey: 'church-exports/tenant-a/old-upload.zip',
      createdAtMs: NOW - CHURCH_EXPORT_STUCK_MS,
      uploadId: 'up-old',
      createdBy: 'admin-1',
    });
    state.jobs.set('tenant-a/live-upload', {
      status: 'running',
      objectKey: 'church-exports/tenant-a/live-upload.zip',
      createdAtMs: NOW - 1000,
      uploadId: 'up-live',
      createdBy: 'admin-1',
    });
    const counts = await sweepChurchExports(NOW);
    expect(state.aborted).toEqual(['up-old']);
    expect(counts.aborted).toBe(1);
    expect(counts.refused).toBe(1);
    expect(state.jobs.get('tenant-a/old-upload')?.status).toBe('failed');
    expect(state.jobs.get('tenant-a/live-upload')?.status).toBe('running');
    expect(state.audits.get('tenant-a/old-upload')).toMatchObject({
      status: 'failed',
      tenantId: 'tenant-a',
      createdBy: 'admin-1',
    });
    expect(JSON.stringify(state.audits.get('tenant-a/old-upload'))).not.toContain('@');
    expect(state.collectionGroupCalls).toBe(0);
    expect(state.indexedQueries).toBe(0);
    expect(state.firestoreOps).toContain('doc get tenants/tenant-a/churchExports/old-upload');
    expect(state.firestoreOps.every((op) => op.startsWith('doc '))).toBe(true);
    const listed = mockSend.mock.calls.filter((call) => call[0].constructor.name === 'ListMultipartUploadsCommand');
    expect(listed.length).toBeGreaterThan(0);
    expect(listed[0][0].input.Prefix).toBe('church-exports/');
  });
});
