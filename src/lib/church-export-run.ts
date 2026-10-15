import { randomUUID } from 'crypto';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { adminDb } from '@/lib/firebase-admin';
import { createR2Client, r2Bucket } from '@/lib/r2';
import {
  CHURCH_EXPORT_MAX_AGE_MS,
  CHURCH_EXPORT_STUCK_MS,
  CHURCH_EXPORT_COOLDOWN_MS,
  ChurchExportRejected,
  EXPORT_PAGE,
  R2_MIN_PART_BYTES,
  SIGNED_URL_TTL_SECONDS,
  buildExportQueries,
  churchExportObjectKey,
  exportExpired,
  iterateQuery,
  parseChurchExportKey,
  writeChurchExportZip,
  type ByteSink,
} from '@/lib/church-export';

export const CHURCH_EXPORTS = 'churchExports';

/** Survives the 24-hour object sweep. Not a `churchExports` document. */
export const CHURCH_EXPORT_AUDITS = 'churchExportAudits';

const PUBLIC_EXPORT_ERROR = 'Export failed';

export type ChurchExportStatus = 'running' | 'ready' | 'failed' | 'consumed';

export interface ChurchExportJob {
  id: string;
  status: ChurchExportStatus;
  createdAtMs: number;
  objectKey: string;
  error?: string;
  byteSize?: number;
  uploadId?: string;
  createdBy?: string;
}

interface JobDoc {
  status?: ChurchExportStatus;
  createdAtMs?: number;
  objectKey?: string;
  error?: string;
  byteSize?: number;
  createdBy?: string;
  uploadId?: string;
}

export interface ChurchExportAudit {
  exportId: string;
  tenantId: string;
  createdBy: string;
  createdAtMs: number;
  completedAtMs: number;
  status: 'ready' | 'failed';
  rowCounts: Record<string, number>;
  byteSize?: number;
}

function jobFrom(id: string, data: JobDoc | undefined): ChurchExportJob | null {
  if (!data || typeof data.createdAtMs !== 'number' || typeof data.objectKey !== 'string' || !data.status) {
    return null;
  }
  return {
    id,
    status: data.status,
    createdAtMs: data.createdAtMs,
    objectKey: data.objectKey,
    error: typeof data.error === 'string' ? data.error : undefined,
    byteSize: typeof data.byteSize === 'number' ? data.byteSize : undefined,
    uploadId: typeof data.uploadId === 'string' ? data.uploadId : undefined,
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : undefined,
  };
}

function safeRowCounts(counts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, count] of Object.entries(counts)) {
    if (!name.endsWith('.csv') || !Number.isInteger(count) || count < 0) continue;
    out[name] = count;
  }
  return out;
}

async function writeAudit(audit: ChurchExportAudit): Promise<void> {
  const ref = adminDb.collection('tenants').doc(audit.tenantId).collection(CHURCH_EXPORT_AUDITS).doc(audit.exportId);
  const existing = await ref.get();
  if (existing.exists) return;
  const doc: ChurchExportAudit = {
    exportId: audit.exportId,
    tenantId: audit.tenantId,
    createdBy: audit.createdBy,
    createdAtMs: audit.createdAtMs,
    completedAtMs: audit.completedAtMs,
    status: audit.status,
    rowCounts: safeRowCounts(audit.rowCounts),
  };
  if (typeof audit.byteSize === 'number') doc.byteSize = audit.byteSize;
  await ref.set(doc);
}

export interface PartUploadClient {
  send(command: unknown): Promise<{ UploadId?: string; ETag?: string }>;
}

export async function uploadStreamToR2(options: {
  client: PartUploadClient;
  bucket: string;
  key: string;
  minPartBytes?: number;
  write: (sink: ByteSink) => Promise<void>;
  onCreated?: (uploadId: string) => Promise<void>;
}): Promise<number> {
  const minPart = options.minPartBytes ?? R2_MIN_PART_BYTES;
  const created = await options.client.send(new CreateMultipartUploadCommand({
    Bucket: options.bucket,
    Key: options.key,
    ContentType: 'application/zip',
    ContentDisposition: 'attachment; filename="church-export.zip"',
  }));
  const uploadId = created.UploadId;
  if (!uploadId) throw new Error('Export storage did not start the upload');
  if (options.onCreated) await options.onCreated(uploadId);

  const parts: { ETag: string; PartNumber: number }[] = [];
  let partNumber = 1;
  let buffered: Buffer[] = [];
  let bufferedBytes = 0;
  let total = 0;

  async function flush(force: boolean): Promise<void> {
    if (bufferedBytes === 0) return;
    if (!force && bufferedBytes < minPart) return;
    const body = Buffer.concat(buffered, bufferedBytes);
    buffered = [];
    bufferedBytes = 0;
    const uploaded = await options.client.send(new UploadPartCommand({
      Bucket: options.bucket,
      Key: options.key,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: body,
    }));
    if (!uploaded.ETag) throw new Error('Export storage part did not return an ETag');
    parts.push({ ETag: uploaded.ETag, PartNumber: partNumber });
    partNumber += 1;
    total += body.length;
  }

  try {
    await options.write({
      write: async (chunk) => {
        buffered.push(chunk);
        bufferedBytes += chunk.length;
        if (bufferedBytes >= minPart) await flush(false);
      },
    });
    await flush(true);
    if (parts.length === 0) throw new Error('Export produced no bytes');
    await options.client.send(new CompleteMultipartUploadCommand({
      Bucket: options.bucket,
      Key: options.key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    }));
    return total;
  } catch (err) {
    await options.client.send(new AbortMultipartUploadCommand({
      Bucket: options.bucket,
      Key: options.key,
      UploadId: uploadId,
    })).catch(() => undefined);
    throw err;
  }
}

async function abortUpload(bucket: string, key: string, uploadId: string): Promise<void> {
  try {
    await createR2Client().send(new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
    }));
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === 'NoSuchUpload' || name === 'NotFound') return;
    throw err;
  }
}

async function failStuckJob(tenantId: string, job: ChurchExportJob, nowMs: number): Promise<void> {
  await adminDb.collection('tenants').doc(tenantId).collection(CHURCH_EXPORTS).doc(job.id).set({
    status: 'failed',
    createdAtMs: job.createdAtMs,
    createdBy: job.createdBy,
    objectKey: job.objectKey,
    uploadId: job.uploadId,
    error: PUBLIC_EXPORT_ERROR,
  });
  await writeAudit({
    exportId: job.id,
    tenantId,
    createdBy: job.createdBy ?? '',
    createdAtMs: job.createdAtMs,
    completedAtMs: nowMs,
    status: 'failed',
    rowCounts: {},
  });
}

/**
 * One running export per tenant. A job still running past
 * {@link CHURCH_EXPORT_STUCK_MS} is failed and its upload aborted, so a
 * killed request cannot hold the slot. Anything newer than the cooldown,
 * running or not, refuses another start.
 */
async function claimExportSlot(tenantId: string, nowMs: number, bucket: string): Promise<void> {
  const latest = await latestChurchExport(tenantId);
  if (!latest) return;
  const age = nowMs - latest.createdAtMs;
  if (latest.status === 'running' && age >= CHURCH_EXPORT_STUCK_MS) {
    if (latest.uploadId) await abortUpload(bucket, latest.objectKey, latest.uploadId);
    await failStuckJob(tenantId, latest, nowMs);
    return;
  }
  if (latest.status === 'running') throw new ChurchExportRejected('active');
  if (age < CHURCH_EXPORT_COOLDOWN_MS) throw new ChurchExportRejected('cooldown');
}

export async function runChurchExport(
  tenantId: string,
  uid: string,
  nowMs: number = Date.now(),
): Promise<{ exportId: string; status: 'ready'; files: string[] }> {
  const bucket = r2Bucket();
  if (!bucket) throw new Error('Export storage is not configured');
  await claimExportSlot(tenantId, nowMs, bucket);

  const exportId = randomUUID();
  const objectKey = churchExportObjectKey(tenantId, exportId);
  const ref = adminDb.collection('tenants').doc(tenantId).collection(CHURCH_EXPORTS).doc(exportId);
  const createdAtMs = nowMs;
  let uploadId: string | undefined;
  await ref.set({
    status: 'running',
    createdAtMs,
    createdBy: uid,
    objectKey,
  });

  const rowCounts: Record<string, number> = {};
  try {
    const sources = buildExportQueries(adminDb as never, tenantId).map((built) => ({
      spec: built.spec,
      pages: (async function* pages() {
        try {
          yield* iterateQuery(built.query, EXPORT_PAGE);
        } catch (err) {
          console.error(`[church-export] read ${built.spec.filename} failed`, err);
          throw new Error(`Could not read ${built.spec.filename}`);
        }
      })(),
    }));
    const files: string[] = [];
    const bytes = await uploadStreamToR2({
      client: createR2Client() as unknown as PartUploadClient,
      bucket,
      key: objectKey,
      onCreated: async (id) => {
        uploadId = id;
        await ref.set({ uploadId: id }, { merge: true });
      },
      write: async (sink) => {
        const written = await writeChurchExportZip(sources, sink);
        files.push(...written.files);
        Object.assign(rowCounts, written.rowCounts);
      },
    });
    await ref.set({
      status: 'ready',
      createdAtMs,
      readyAtMs: Date.now(),
      createdBy: uid,
      objectKey,
      uploadId,
      byteSize: bytes,
    });
    await writeAudit({
      exportId,
      tenantId,
      createdBy: uid,
      createdAtMs,
      completedAtMs: Date.now(),
      status: 'ready',
      rowCounts,
      byteSize: bytes,
    });
    return { exportId, status: 'ready', files };
  } catch (err) {
    console.error('[church-export] failed', err);
    await ref.set({
      status: 'failed',
      createdAtMs,
      createdBy: uid,
      objectKey,
      uploadId,
      error: PUBLIC_EXPORT_ERROR,
    }).catch((setErr) => {
      console.error('[church-export] could not record the failure', setErr);
    });
    await writeAudit({
      exportId,
      tenantId,
      createdBy: uid,
      createdAtMs,
      completedAtMs: Date.now(),
      status: 'failed',
      rowCounts,
    });
    throw new Error(PUBLIC_EXPORT_ERROR);
  }
}

export async function latestChurchExport(tenantId: string): Promise<ChurchExportJob | null> {
  const snap = await adminDb.collection('tenants').doc(tenantId).collection(CHURCH_EXPORTS)
    .orderBy('createdAtMs', 'desc')
    .limit(1)
    .get();
  const doc = snap.docs[0];
  if (!doc) return null;
  return jobFrom(doc.id, doc.data() as JobDoc);
}

export async function getChurchExport(tenantId: string, exportId: string): Promise<ChurchExportJob | null> {
  const snap = await adminDb.collection('tenants').doc(tenantId).collection(CHURCH_EXPORTS).doc(exportId).get();
  if (!snap.exists) return null;
  return jobFrom(snap.id, snap.data() as JobDoc);
}

export async function signChurchExportUrl(key: string): Promise<string> {
  const parsed = parseChurchExportKey(key);
  if (!parsed) throw new Error('Export file is missing');
  const bucket = r2Bucket();
  if (!bucket) throw new Error('Export storage is not configured');
  return getSignedUrl(
    createR2Client(),
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: 'attachment; filename="church-export.zip"',
    }),
    { expiresIn: SIGNED_URL_TTL_SECONDS },
  );
}

export async function consumeChurchExport(tenantId: string, job: ChurchExportJob): Promise<void> {
  const parsed = parseChurchExportKey(job.objectKey);
  if (!parsed || parsed.tenantId !== tenantId || parsed.exportId !== job.id) {
    throw new Error('Export file is missing');
  }
  const bucket = r2Bucket();
  if (!bucket) throw new Error('Export storage is not configured');
  await createR2Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: job.objectKey }));
  await adminDb.collection('tenants').doc(tenantId).collection(CHURCH_EXPORTS).doc(job.id).set({
    status: 'consumed',
    createdAtMs: job.createdAtMs,
    objectKey: job.objectKey,
    consumedAtMs: Date.now(),
  });
}

export interface ListedExportObject {
  key: string;
  lastModifiedMs: number;
}

export interface SweepCounts {
  deleted: number;
  kept: number;
  refused: number;
  /** Incomplete multipart uploads aborted because they outlived a live request. */
  aborted: number;
}

/**
 * Delete stored exports whose age is at least 24 hours. Keys that are not a
 * church-export object are refused and not deleted — a bad pointer must not
 * become a delete of some other object. `remove` is called once per deleted key.
 */
export async function sweepListedObjects(
  objects: AsyncIterable<ListedExportObject>,
  nowMs: number,
  remove: (key: string) => Promise<void>,
): Promise<SweepCounts> {
  const deletedKeys = new Set<string>();
  let kept = 0;
  let refused = 0;
  for await (const object of objects) {
    const parsed = parseChurchExportKey(object.key);
    if (!parsed) {
      refused += 1;
      continue;
    }
    if (!exportExpired(object.lastModifiedMs, nowMs)) {
      kept += 1;
      continue;
    }
    if (!deletedKeys.has(object.key)) {
      await remove(object.key);
      deletedKeys.add(object.key);
    }
  }
  return { deleted: deletedKeys.size, kept, refused, aborted: 0 };
}

async function* listExportObjects(bucket: string): AsyncGenerator<ListedExportObject> {
  const client = createR2Client();
  let token: string | undefined;
  for (;;) {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: 'church-exports/',
      ContinuationToken: token,
      MaxKeys: 200,
    }));
    for (const item of page.Contents ?? []) {
      if (!item.Key || !item.LastModified) continue;
      yield { key: item.Key, lastModifiedMs: item.LastModified.getTime() };
    }
    if (!page.IsTruncated || !page.NextContinuationToken) return;
    token = page.NextContinuationToken;
  }
}

async function deleteStoredKey(bucket: string, key: string): Promise<void> {
  await createR2Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

interface OpenUpload {
  key: string;
  uploadId: string;
  initiatedMs: number;
}

/**
 * Incomplete uploads under the export prefix. Paged. A key that is not an
 * export object is skipped by the caller and not aborted.
 */
async function* listOpenUploads(bucket: string): AsyncGenerator<OpenUpload> {
  const client = createR2Client();
  let keyMarker: string | undefined;
  let uploadIdMarker: string | undefined;
  for (;;) {
    const page = await client.send(new ListMultipartUploadsCommand({
      Bucket: bucket,
      Prefix: 'church-exports/',
      KeyMarker: keyMarker,
      UploadIdMarker: uploadIdMarker,
      MaxUploads: 200,
    }));
    for (const upload of page.Uploads ?? []) {
      if (!upload.Key || !upload.UploadId || !upload.Initiated) continue;
      yield { key: upload.Key, uploadId: upload.UploadId, initiatedMs: upload.Initiated.getTime() };
    }
    if (!page.IsTruncated || !page.NextKeyMarker) return;
    keyMarker = page.NextKeyMarker;
    uploadIdMarker = page.NextUploadIdMarker;
  }
}

/**
 * R2 listing is the source of truth for bytes. Firestore rows older than the
 * same window are deleted with their object, so a record cannot outlive the
 * file it points at. Audit documents live in `churchExportAudits` and this
 * sweep never reads them.
 *
 * A running job older than {@link CHURCH_EXPORT_STUCK_MS}, and any incomplete
 * multipart upload under `church-exports/` of that age, is aborted. The
 * `status == running` read is a single-field query with no `limit`, so it
 * does not need a composite index. Running exports are one per tenant.
 *
 * R2 lifecycle is a bucket setting this repo cannot write. Set one anyway:
 * abort incomplete multipart uploads after 1 day. The cron is the path that
 * runs when the app is up; the lifecycle rule is what still runs when it is not.
 */
export async function sweepChurchExports(nowMs: number = Date.now()): Promise<SweepCounts> {
  const bucket = r2Bucket();
  if (!bucket) throw new Error('Export storage is not configured');

  const abortedIds = new Set<string>();
  let aborted = 0;
  for await (const upload of listOpenUploads(bucket)) {
    if (!parseChurchExportKey(upload.key)) continue;
    if (nowMs - upload.initiatedMs < CHURCH_EXPORT_STUCK_MS) continue;
    if (abortedIds.has(upload.uploadId)) continue;
    await abortUpload(bucket, upload.key, upload.uploadId);
    abortedIds.add(upload.uploadId);
    aborted += 1;
  }

  const running = await adminDb.collectionGroup(CHURCH_EXPORTS).where('status', '==', 'running').get();
  for (const doc of running.docs) {
    const job = jobFrom(doc.id, doc.data() as JobDoc);
    const pathTenant = doc.ref.parent.parent?.id;
    if (!job || !pathTenant || job.status !== 'running') continue;
    if (nowMs - job.createdAtMs < CHURCH_EXPORT_STUCK_MS) continue;
    if (job.uploadId && !abortedIds.has(job.uploadId)) {
      const parsed = parseChurchExportKey(job.objectKey);
      if (parsed && parsed.tenantId === pathTenant) {
        await abortUpload(bucket, job.objectKey, job.uploadId);
        abortedIds.add(job.uploadId);
        aborted += 1;
      }
    }
    await failStuckJob(pathTenant, job, nowMs);
  }

  const removed = new Set<string>();
  const counts = await sweepListedObjects(
    listExportObjects(bucket),
    nowMs,
    async (key) => {
      await deleteStoredKey(bucket, key);
      removed.add(key);
    },
  );
  counts.aborted = aborted;

  const cutoff = nowMs - CHURCH_EXPORT_MAX_AGE_MS;
  for (;;) {
    const snap = await adminDb.collectionGroup(CHURCH_EXPORTS)
      .where('createdAtMs', '<=', cutoff)
      .orderBy('createdAtMs', 'asc')
      .limit(200)
      .get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const data = doc.data() as JobDoc;
      const key = typeof data.objectKey === 'string' ? data.objectKey : '';
      const parsed = parseChurchExportKey(key);
      const pathTenant = doc.ref.parent.parent?.id;
      if (!parsed || parsed.tenantId !== pathTenant) {
        counts.refused += 1;
      } else if (!removed.has(key)) {
        await deleteStoredKey(bucket, key);
        removed.add(key);
      }
      await doc.ref.delete();
    }
    if (snap.size < 200) break;
  }
  counts.deleted = removed.size;
  return counts;
}
