import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { stripComments } from '@/__tests__/__fixtures__/the-346-strip-comments';

const root = path.resolve(__dirname, '../../../..');
const code = (rel: string) => stripComments(readFileSync(path.join(root, rel), 'utf8'));

describe('lesson content stays behind the guarded collection', () => {
  it('AdminCourses deletes a course through deleteCourse (which takes its lessonContent with it), never a bare deleteDoc', () => {
    const src = code('src/components/AdminCourses.tsx');
    expect(src).toContain('deleteCourse(id)');
    expect(src).not.toMatch(/\bdeleteDoc\b/);
  });

  it('AdminCourses opens the editor only after hydrating the lesson content', () => {
    expect(code('src/components/AdminCourses.tsx')).toMatch(/setEditingCourse\(await hydrateCourse\(/);
  });

  it('the tenant delete route removes courses recursively so lessonContent is not orphaned', () => {
    expect(code('src/app/api/tenants/delete/route.ts')).toMatch(/name:\s*'courses',\s*recursive:\s*true/);
  });

  it('persist writes the course doc from the split outline, never from the raw levels', () => {
    const src = code('src/lib/courses/persist.ts');
    expect(src).toContain('payload.levels = levels');
    expect(src).toContain('splitCourseContent(course.levels');
  });

  it('the member-side content reader never writes', () => {
    expect(code('src/lib/courses/content-client.ts')).not.toMatch(/\b(setDoc|updateDoc|writeBatch|addDoc|deleteDoc)\b/);
  });
});
