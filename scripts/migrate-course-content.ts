/**
 * One-time migration: move lesson content out of the tenant-readable course
 * documents into the rules-guarded courses/{id}/lessonContent subcollection.
 *
 * Why: until a course is migrated, its lesson bodies, video links and quiz
 * answers still sit inside the course document, which every member of the same
 * ministry can read. The new rules lock courses/{id}/lessonContent, but only
 * this move (or re-saving the course in the builder) takes the inline copy away.
 *
 * Run it AFTER the code that reads lessonContent is deployed, and after the rules
 * are deployed. Run it before relying on restricted or paid courses.
 *
 * USAGE (Cloud Shell supplies Application Default Credentials)
 *   Dry run (default):  npx --yes tsx scripts/migrate-course-content.ts
 *   One ministry:       npx --yes tsx scripts/migrate-course-content.ts --tenant <tenantId>
 *   Apply:              npx --yes tsx scripts/migrate-course-content.ts --commit
 *   Undo (for a revert): npx --yes tsx scripts/migrate-course-content.ts --restore --commit   (copies lessonContent back inline)
 *   Local emulator:     FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-test npx --yes tsx scripts/migrate-course-content.ts --commit
 *
 * Idempotent and lossless: content is written, read back and compared, and only
 * then is the inline copy stripped. Inline content is authoritative: an existing
 * lessonContent doc (stale after a revert) is overwritten from it. Prints ids and
 * counts, never lesson content.
 */
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { migrateCourseContent, restoreInlineContent } from '../src/lib/courses/migrate-content';

const args = process.argv.slice(2);
const commit = args.includes('--commit');
const tenantFlag = args.indexOf('--tenant');
const tenantId = tenantFlag >= 0 ? args[tenantFlag + 1] : undefined;
if (tenantFlag >= 0 && !tenantId) {
  console.error('--tenant needs a tenant id');
  process.exit(2);
}

if (getApps().length === 0) {
  initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: process.env.GCLOUD_PROJECT } : { credential: applicationDefault() });
}

if (args.includes('--restore')) {
  restoreInlineContent(getFirestore(), { commit, tenantId })
    .then((r) => {
      console.log(`${commit ? 'RESTORED' : 'DRY RUN'} scanned ${r.scanned}, ${commit ? 'restored' : 'would restore'} ${r.restored}, nothing to do ${r.untouched}, failed ${r.failed}`);
      process.exit(r.failed > 0 ? 1 : 0);
    })
    .catch((e) => { console.error(e); process.exit(1); });
} else {
migrateCourseContent(getFirestore(), { commit, tenantId })
  .then((r) => {
    console.log(`${commit ? 'APPLIED' : 'DRY RUN'}${tenantId ? ` for ${tenantId}` : ''}`);
    console.log(`scanned ${r.scanned}, already split ${r.alreadySplit}, ${commit ? `migrated ${r.migrated}` : `would migrate ${r.wouldMigrate}`}, failed ${r.failed}`);
    for (const o of r.outcomes) if (o.status === 'failed') console.error(`FAILED ${o.id}: ${o.error}`);
    process.exit(r.failed > 0 ? 1 : 0);
  })
  .catch((e) => { console.error(e); process.exit(1); });
}
