import { randomUUID } from 'crypto';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { adminDb } from '@/lib/firebase-admin';
import { createR2Client, r2Bucket } from '@/lib/r2';
import {
  CHURCH_EXPORT_MAX_AGE_MS,
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

export type ChurchExportStatus = 'running' | 'ready' | 'failed' | 'consumed';

export interface ChurchExportJob {
  id: string;
  status: ChurchExportStatus;
  createdAtMs: number;
  objectKey: string;
  error?: string;
  byteSize?: number;
}

interface JobDoc {
  status?: ChurchExportStatus;
  createdAtMs?: number;
  objectKey?: string;
  error?: string;
  byteSize?: number;
  createdBy?: string;
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
  };
}

function publicExportError(err: unknown): string {
  const message = err instanceof Error ? err.message : 'Export failed';
  if (
    message === 'Export storage is not configured'
    || message === 'Export produced no bytes'
    || message.startsWith('Could not read ')
  ) return message;
  return 'Export failed';
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

export async function runChurchExport(
  tenantId: string,
  uid: string,
): Promise<{ exportId: string; status: 'ready'; files: string[] }> {
  const bucket = r2Bucket();
  if (!bucket) throw new Error('Export storage is not configured');

  const exportId = randomUUID();
  const objectKey = churchExportObjectKey(tenantId, exportId);
  const ref = adminDb.collection('tenants').doc(tenantId).collection(CHURCH_EXPORTS).doc(exportId);
  const createdAtMs = Date.now();
  await ref.set({
    status: 'running',
    createdAtMs,
    createdBy: uid,
    objectKey,
  });

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
      write: async (sink) => {
        const written = await writeChurchExportZip(sources, sink);
        files.push(...written.files);
      },
    });
    await ref.set({
      status: 'ready',
      createdAtMs,
      readyAtMs: Date.now(),
      createdBy: uid,
      objectKey,
      byteSize: bytes,
    });
    return { exportId, status: 'ready', files };
  } catch (err) {
    const message = publicExportError(err);
    await ref.set({
      status: 'failed',
      createdAtMs,
      createdBy: uid,
      objectKey,
      error: message.slice(0, 300),
    }).catch(() => undefined);
    throw new Error(message);
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
  return { deleted: deletedKeys.size, kept, refused };
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

/**
 * R2 listing is the source of truth for bytes. Firestore rows older than the
 * same window are deleted with their object, so a record cannot outlive the
 * file it points at. Both walks are paged.
 */
export async function sweepChurchExports(nowMs: number = Date.now()): Promise<SweepCounts> {
  const bucket = r2Bucket();
  if (!bucket) throw new Error('Export storage is not configured');

  const removed = new Set<string>();
  const counts = await sweepListedObjects(
    listExportObjects(bucket),
    nowMs,
    async (key) => {
      await deleteStoredKey(bucket, key);
      removed.add(key);
    },
  );

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
