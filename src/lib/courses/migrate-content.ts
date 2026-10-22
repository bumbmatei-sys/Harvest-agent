import type { Firestore } from 'firebase-admin/firestore';
import { LESSON_CONTENT_COLLECTION, hasInlineContent, mergeCourseContent, splitCourseContent, type ContentByLesson } from '@/lib/courses/content';
import type { Level } from '@/types/course.types';

export interface MigrateOptions {
  /** Without this nothing is written; the report says what WOULD change. */
  commit: boolean;
  /** Restrict to one ministry. Omitted means every course. */
  tenantId?: string;
}

export type CourseOutcome =
  | { id: string; status: 'already-split' }
  | { id: string; status: 'would-migrate'; lessons: number }
  | { id: string; status: 'migrated'; lessons: number; contentWritten: number }
  | { id: string; status: 'failed'; error: string };

export interface MigrateReport {
  scanned: number;
  alreadySplit: number;
  migrated: number;
  wouldMigrate: number;
  failed: number;
  outcomes: CourseOutcome[];
}

const PAGE = 100;
const BATCH = 400;

/**
 * One-time move of lesson content out of the tenant-readable course document
 * into courses/{id}/lessonContent. Safe to re-run: a course already in the split
 * layout is skipped, and a content document that already exists is never
 * overwritten (at read time content wins over inline, so keeping it changes
 * nothing for readers).
 *
 * Order is what makes it lossless: content is written first, READ BACK, and only
 * then is the inline copy stripped from the course document. A failure at any
 * step leaves the course document untouched and still readable by the player's
 * inline fallback. Content is never logged, only ids and counts.
 */
export async function migrateCourseContent(db: Firestore, opts: MigrateOptions): Promise<MigrateReport> {
  const report: MigrateReport = { scanned: 0, alreadySplit: 0, migrated: 0, wouldMigrate: 0, failed: 0, outcomes: [] };
  const base = opts.tenantId ? db.collection('courses').where('tenantId', '==', opts.tenantId) : db.collection('courses');

  let cursor: string | undefined;
  for (;;) {
    let q = base.orderBy('__name__').limit(PAGE);
    if (cursor) q = q.startAfter(cursor);
    const page = await q.get();
    if (page.empty) break;
    for (const snap of page.docs) {
      report.scanned += 1;
      const outcome = await migrateOne(db, snap.id, (snap.data().levels ?? []) as Level[], opts.commit);
      report.outcomes.push(outcome);
      if (outcome.status === 'already-split') report.alreadySplit += 1;
      else if (outcome.status === 'would-migrate') report.wouldMigrate += 1;
      else if (outcome.status === 'migrated') report.migrated += 1;
      else report.failed += 1;
    }
    cursor = page.docs[page.docs.length - 1].id;
    if (page.size < PAGE) break;
  }
  return report;
}

async function migrateOne(db: Firestore, id: string, levels: Level[], commit: boolean): Promise<CourseOutcome> {
  try {
    if (!hasInlineContent(levels)) return { id, status: 'already-split' };
    const { levels: outline, content } = splitCourseContent(levels);
    const lessonIds = Object.keys(content);
    if (!commit) return { id, status: 'would-migrate', lessons: lessonIds.length };

    const col = db.collection('courses').doc(id).collection(LESSON_CONTENT_COLLECTION);
    const refs = lessonIds.map((lessonId) => col.doc(lessonId));
    const existing = refs.length ? await db.getAll(...refs) : [];
    const toWrite = lessonIds.filter((lessonId, i) => !existing[i].exists && Object.keys(content[lessonId]).length > 0);

    for (let i = 0; i < toWrite.length; i += BATCH) {
      const batch = db.batch();
      toWrite.slice(i, i + BATCH).forEach((lessonId) => batch.set(col.doc(lessonId), content[lessonId]));
      await batch.commit();
    }

    const written = toWrite.length ? await db.getAll(...toWrite.map((lessonId) => col.doc(lessonId))) : [];
    const missing = written.filter((d) => !d.exists).length;
    if (missing > 0) throw new Error(`${missing} content documents did not read back; course document left untouched`);

    await db.collection('courses').doc(id).update({ levels: outline });
    return { id, status: 'migrated', lessons: lessonIds.length, contentWritten: toWrite.length };
  } catch (e) {
    return { id, status: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}

export interface RestoreReport {
  scanned: number;
  restored: number;
  untouched: number;
  failed: number;
}

/**
 * The way back, for a revert of the lesson-content lock: copies each course's
 * lessonContent over its outline, inline, so the previous release (which reads
 * lessons off the course document) sees full lessons again. Content documents
 * are left in place, so running the forward migration again afterwards is safe.
 * Without --commit nothing is written.
 */
export async function restoreInlineContent(db: Firestore, opts: MigrateOptions): Promise<RestoreReport> {
  const report: RestoreReport = { scanned: 0, restored: 0, untouched: 0, failed: 0 };
  const base = opts.tenantId ? db.collection('courses').where('tenantId', '==', opts.tenantId) : db.collection('courses');
  let cursor: string | undefined;
  for (;;) {
    let q = base.orderBy('__name__').limit(PAGE);
    if (cursor) q = q.startAfter(cursor);
    const page = await q.get();
    if (page.empty) break;
    for (const snap of page.docs) {
      report.scanned += 1;
      try {
        const content: ContentByLesson = {};
        (await snap.ref.collection(LESSON_CONTENT_COLLECTION).get()).forEach((d) => { content[d.id] = d.data(); });
        if (Object.keys(content).length === 0) { report.untouched += 1; continue; }
        if (opts.commit) {
          const merged = mergeCourseContent({ levels: (snap.data().levels ?? []) as Level[] }, content);
          await snap.ref.update({ levels: merged.levels });
        }
        report.restored += 1;
      } catch {
        report.failed += 1;
      }
    }
    cursor = page.docs[page.docs.length - 1].id;
    if (page.size < PAGE) break;
  }
  return report;
}
