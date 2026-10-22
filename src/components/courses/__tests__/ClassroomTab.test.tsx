import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClassroomTab, CommunityClassroom } from '@/components/courses/ClassroomTab';
import { emptyLesson } from '@/lib/courses/lessons';
import type { ProductCourse } from '@/types/course-product.types';
import type { Lesson } from '@/types/course.types';
import { all, byName, click, flush, mount, need, text, unmount } from '@/components/email/__tests__/dom';

const mocks = vi.hoisted(() => ({ fetchMemberCourses: vi.fn(), uid: 'member-1' as string | null, progress: {} as Record<string, unknown> }));
vi.mock('@/utils/member-courses', () => ({ fetchMemberCourses: mocks.fetchMemberCourses }));
vi.mock('@/firebase', () => ({ db: {}, auth: { get currentUser() { return mocks.uid ? { uid: mocks.uid } : null; } } }));
vi.mock('firebase/firestore', () => ({
  doc: () => ({}),
  getDoc: async () => ({ exists: () => true, data: () => mocks.progress }),
}));

afterEach(async () => { await unmount(); mocks.fetchMemberCourses.mockReset(); mocks.progress = {}; mocks.uid = 'member-1'; });

const lesson = (id: string): Lesson => ({ ...emptyLesson('text'), id, title: id, body: '<p>x</p>' }) as Lesson;
const course = (id: string, over: Partial<ProductCourse> = {}): ProductCourse & { id: string } => ({
  id, title: `Course ${id}`, description: '', category: '', thumbnail: '', featured: false, authorIds: [],
  issueCertificate: true, requireQuiz: false, status: 'published', author: 'Pastor Ana',
  levels: [{ id: 'l', title: 'C', sections: [{ id: 's', title: 'S', lessons: [lesson(`${id}-1`), lesson(`${id}-2`)] }] }],
  ...over,
});
const q = (sel: string) => document.body.querySelector<HTMLElement>(sel);

describe('ClassroomTab', () => {
  it('hands the member\'s communities to the member course list so community-only courses survive its filter', async () => {
    mocks.fetchMemberCourses.mockResolvedValue([]);
    await mount(<CommunityClassroom communityId="c1" memberCommunityIds={['c1', 'c2']} onOpenCourse={() => {}} />);
    expect(mocks.fetchMemberCourses).toHaveBeenCalledWith(['c1', 'c2']);
  });

  it('draws one card per course with progress and a status-aware action', async () => {
    const onOpenCourse = vi.fn();
    await mount(
      <ClassroomTab
        courses={[course('a'), course('b'), course('c')]}
        completed={new Set(['b-1', 'c-1', 'c-2'])}
        onOpenCourse={onOpenCourse}
      />,
    );
    expect(all('[data-classroom-course]').map((c) => c.getAttribute('data-classroom-course'))).toEqual(['a', 'b', 'c']);
    expect(need(q('[data-classroom-course="a"]'), 'a').textContent).toContain('0 of 2 lessons done');
    expect(need(q('[data-classroom-course="a"] [data-open-course]'), 'a open').textContent).toBe('Start course');
    expect(need(q('[data-classroom-course="b"] [data-open-course]'), 'b open').textContent).toBe('Continue');
    expect(need(q('[data-classroom-course="c"] [data-open-course]'), 'c open').textContent).toBe('Review');
    expect(need(q('[data-classroom-course="c"] [data-classroom-status]'), 'c status').textContent).toBe('Done');
    await click(need(q('[data-classroom-course="b"] [data-open-course]'), 'b open'));
    expect(onOpenCourse).toHaveBeenCalledWith('b');
  });

  it('says the Classroom is empty, naming the community', async () => {
    await mount(<ClassroomTab courses={[]} completed={new Set()} onOpenCourse={() => {}} communityName="Young Adults" />);
    expect(need(q('[data-classroom-empty]'), 'empty').textContent).toContain('Young Adults');
  });
});

describe('CommunityClassroom', () => {
  const restricted = (id: string, communityIds: string[], over: Partial<ProductCourse> = {}) =>
    course(id, { accessMode: 'restricted', communityIds, accessUserIds: [], ...over });

  it('lists only the courses attached to this community that the member may open', async () => {
    mocks.fetchMemberCourses.mockResolvedValue([
      restricted('in-c1', ['c1']),
      restricted('in-c2', ['c2']),
      restricted('in-both', ['c1', 'c2']),
      course('legacy-attached', { communityIds: ['c1'] }),
      course('unattached'),
    ]);
    await mount(<CommunityClassroom communityId="c1" memberCommunityIds={['c1']} onOpenCourse={() => {}} />);
    await flush();
    expect(all('[data-classroom-course]').map((c) => c.getAttribute('data-classroom-course'))).toEqual(['in-c1', 'in-both', 'legacy-attached']);
  });

  it('hides a restricted course from someone who is not in the community and is not on its list', async () => {
    mocks.fetchMemberCourses.mockResolvedValue([restricted('in-c1', ['c1'])]);
    await mount(<CommunityClassroom communityId="c1" memberCommunityIds={[]} onOpenCourse={() => {}} />);
    await flush();
    expect(q('[data-classroom-empty]')).not.toBeNull();
  });

  it('reads the member\'s own progress', async () => {
    mocks.progress = { completedLessons: ['in-c1-1'] };
    mocks.fetchMemberCourses.mockResolvedValue([restricted('in-c1', ['c1'])]);
    await mount(<CommunityClassroom communityId="c1" memberCommunityIds={['c1']} onOpenCourse={() => {}} />);
    await flush();
    expect(text()).toContain('1 of 2 lessons done');
  });

  it('says it could not load, and retries, instead of presenting an empty Classroom', async () => {
    mocks.fetchMemberCourses.mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce([restricted('in-c1', ['c1'])]);
    await mount(<CommunityClassroom communityId="c1" memberCommunityIds={['c1']} onOpenCourse={() => {}} />);
    await flush();
    expect(q('[data-classroom-empty]')).toBeNull();
    expect(need(q('[data-classroom-error]'), 'error').textContent).toContain('could not be loaded');
    await click(need(byName('button', 'Try again'), 'retry'));
    await flush();
    expect(q('[data-classroom-course="in-c1"]')).not.toBeNull();
  });
});
