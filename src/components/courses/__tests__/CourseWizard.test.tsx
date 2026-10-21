import { afterEach, describe, expect, it, vi } from 'vitest';

import { CourseWizard, newCourse } from '@/components/courses/builder/CourseWizard';
import { emptyLesson } from '@/lib/courses/lessons';
import type { MemberList } from '@/lib/courses/members';
import type { ProductCourse } from '@/types/course-product.types';
import type { Lesson } from '@/types/course.types';
import { all, byName, click, flush, mount, need, text, type as typeInto, unmount } from '@/components/email/__tests__/dom';

// TipTap needs a layout engine for its selection handling; the editor itself is
// not what these flows are about, so it is a plain textarea here.
vi.mock('@/components/courses/builder/LessonBodyEditor', () => ({
  LessonBodyEditor: ({ html, onChange }: { html: string; onChange: (h: string) => void }) => (
    <textarea aria-label="Lesson text" value={html} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock('@/components/ImageUpload', () => ({ ImageUpload: () => <div data-image-upload /> }));
vi.mock('@/lib/courses/members', () => ({ loadTenantMembers: async () => ({ members: [], total: 0, truncated: false }) }));

afterEach(unmount);

const members: MemberList = {
  members: [
    { uid: 'u1', name: 'Ana Rivera', email: 'ana@example.org' },
    { uid: 'u2', name: 'Ben Okafor', email: 'ben@example.org' },
  ],
  total: 2,
  truncated: false,
};

const textCourse = (extra: Partial<ProductCourse> = {}): ProductCourse => ({
  ...newCourse(),
  id: 'c1',
  title: 'Prayer basics',
  levels: [{ id: 'l1', title: 'Course', sections: [{ id: 's1', title: 'Start here', lessons: [{ ...emptyLesson('text'), id: 'a', title: 'Why we pray', body: '<h2>Why</h2><p>Because.</p>' } as Lesson] }] }],
  ...extra,
});

const q = (sel: string) => document.body.querySelector<HTMLElement>(sel);
const step = (id: string) => need(q(`[data-step="${id}"]`), `step ${id}`);

function wizard(over: Partial<Parameters<typeof CourseWizard>[0]> = {}) {
  const save = vi.fn(async () => 'new-id');
  const ui = (
    <CourseWizard
      course={null}
      onClose={() => {}}
      save={save}
      loadMembers={async () => members}
      origin="https://app.example.org"
      {...over}
    />
  );
  return { ui, save };
}

describe('CourseWizard — the shared product flow with a course step', () => {
  it('walks Offer, Lessons, Page, Publish and starts as an untitled draft', async () => {
    await mount(wizard().ui);
    expect(all('[data-step]').map((b) => b.textContent?.replace(/\s*\(done\)/, '').trim().replace(/^\d+/, ''))).toEqual(['Offer', 'Lessons', 'Page', 'Publish']);
    expect(q('[data-wizard-title]')?.textContent).toBe('Untitled course');
    expect(q('[data-wizard-status]')?.textContent).toBe('Draft');
  });

  it('cannot publish an empty course and names what is missing, but can save a draft', async () => {
    const { ui, save } = wizard();
    await mount(ui);
    await click(step('publish'));
    const publish = need(q('[data-wizard-primary="publish"]'), 'publish');
    expect(publish.hasAttribute('disabled')).toBe(true);
    expect(text()).toContain('name your course');
    expect(text()).toContain('add at least one lesson');
    await click(need(byName('button', 'Save draft'), 'save draft'));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: '' }), 'draft');
  });

  it('PUBLISHES A COURSE OF TEXT LESSONS ONLY — no video anywhere', async () => {
    const { ui, save } = wizard({ course: textCourse() });
    await mount(ui);
    await click(step('publish'));
    const items = all('[data-check]');
    expect(items.filter((i) => i.getAttribute('data-done') === 'false' && i.getAttribute('data-check') !== 'access')).toEqual([]);
    expect(text().toLowerCase()).not.toContain('video');
    const publish = need(q('[data-wizard-primary="publish"]'), 'publish');
    expect(publish.hasAttribute('disabled')).toBe(false);
    await click(publish);
    expect(save).toHaveBeenCalledTimes(1);
    const [saved, status] = save.mock.calls[0] as unknown as [ProductCourse, string];
    expect(status).toBe('published');
    expect(JSON.stringify(saved.levels)).not.toMatch(/youtube/i);
  });

  it('shows a save failure instead of swallowing it', async () => {
    const save = vi.fn(async () => { throw new Error('Permission denied.'); });
    await mount(wizard({ course: textCourse(), save }).ui);
    await click(need(byName('button', 'Save draft'), 'save'));
    await flush();
    expect(need(q('[role="alert"]'), 'alert').textContent).toContain('Permission denied.');
  });

  it('warns without blocking when a restricted course has nobody who can open it', async () => {
    await mount(wizard({ course: textCourse({ accessMode: 'restricted', accessUserIds: [], communityIds: [] }) }).ui);
    await click(step('publish'));
    const access = need(q('[data-check="access"]'), 'access');
    expect(access.getAttribute('data-done')).toBe('false');
    expect(access.textContent).toContain('Recommended');
    expect(need(q('[data-wizard-primary="publish"]'), 'publish').hasAttribute('disabled')).toBe(false);
  });
});

describe('Offer step — price and access', () => {
  it('lets a price be set but says paid checkout is coming later, and makes no payment call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await mount(wizard({ course: textCourse() }).ui);
    expect(q('[data-checkout-later]')).toBeNull();
    await click(need(byName('button', 'One-time'), 'one-time'));
    expect(need(q('[data-checkout-later]'), 'note').textContent).toContain('Paid checkout is coming later');
    await typeInto(need(q('#course-price'), 'price'), '25');
    expect(q('[data-landing-price]')?.textContent).toBe('$25');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('adds and removes people on the access list from the member search', async () => {
    await mount(wizard({ course: textCourse({ accessMode: 'restricted', accessUserIds: [] }) }).ui);
    await flush();
    expect(q('[data-no-people]')).not.toBeNull();
    await typeInto(need(q('#access-search'), 'search'), 'ana');
    await click(need(byName('[aria-label="Matching members"] button', 'Add'), 'add'));
    expect(need(q('[data-access-person="u1"]'), 'chip').textContent).toContain('Ana Rivera');
    await click(need(q('[aria-label="Remove Ana Rivera"]'), 'remove'));
    expect(q('[data-access-person="u1"]')).toBeNull();
  });

  it('says so when the member list cannot load, and offers a retry', async () => {
    const loadMembers = vi.fn<() => Promise<MemberList>>()
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce(members);
    await mount(wizard({ course: textCourse({ accessMode: 'restricted' }), loadMembers }).ui);
    await flush();
    expect(text()).toContain('The member list could not be loaded');
    await click(need(byName('button', 'Try again'), 'retry'));
    await flush();
    expect(q('#access-search')).not.toBeNull();
  });

  it('attaches a course to several communities and detaches one', async () => {
    const onSaved = vi.fn();
    const communities = [{ id: 'c-a', name: 'Young Adults' }, { id: 'c-b', name: 'Prayer Team' }];
    const { ui } = wizard({ course: textCourse(), communities, onSaved });
    await mount(ui);
    const a = need(q('#community-c-a'), 'a');
    const b = need(q('#community-c-b'), 'b');
    await click(a);
    await click(b);
    await click(need(byName('button', 'Save draft'), 'save'));
    await flush();
    expect(onSaved.mock.calls[0][0].communityIds).toEqual(['c-a', 'c-b']);
    await click(need(q('#community-c-a'), 'a'));
    await click(need(byName('button', 'Save changes') ?? byName('button', 'Save draft'), 'save'));
    await flush();
    expect(onSaved.mock.calls[1][0].communityIds).toEqual(['c-b']);
  });

  it('shows the no-communities explanation when there are none yet', async () => {
    await mount(wizard({ course: textCourse() }).ui);
    expect(q('[data-no-communities]')).not.toBeNull();
  });
});

describe('Lessons step — lesson types', () => {
  it('a Text lesson asks for words and never for a video; Video asks for a link', async () => {
    await mount(wizard({ course: textCourse() }).ui);
    await click(step('lessons'));
    await click(need(q('[data-lesson-row="a"] button'), 'row'));
    const sheet = need(q('[data-lesson-sheet]'), 'sheet');
    expect(sheet.querySelector('#lesson-video')).toBeNull();
    expect(sheet.querySelector('[aria-label="Lesson text"]')).not.toBeNull();
    await click(need(byName('[data-lesson-sheet] button', 'Video'), 'video'));
    expect(need(q('[data-lesson-sheet] #lesson-video'), 'video field')).not.toBeNull();
    expect(q('[data-lesson-sheet] [aria-label="Lesson text"]')).toBeNull();
    await click(need(byName('[data-lesson-sheet] button', 'Video + text'), 'both'));
    expect(q('[data-lesson-sheet] #lesson-video')).not.toBeNull();
    expect(q('[data-lesson-sheet] [aria-label="Lesson text"]')).not.toBeNull();
  });

  it('edits a text lesson and keeps the change on Done, but discards it on Cancel', async () => {
    await mount(wizard({ course: textCourse() }).ui);
    await click(step('lessons'));
    await click(need(q('[data-lesson-row="a"] button'), 'row'));
    await typeInto(need(q('#lesson-title'), 'title'), 'Why we really pray');
    await click(need(byName('[data-lesson-sheet] button', 'Cancel'), 'cancel'));
    expect(text()).toContain('Why we pray');
    await click(need(q('[data-lesson-row="a"] button'), 'row'));
    await typeInto(need(q('#lesson-title'), 'title'), 'Why we really pray');
    await click(need(byName('[data-lesson-sheet] button', 'Done'), 'done'));
    expect(need(q('[data-lesson-row="a"]'), 'row').textContent).toContain('Why we really pray');
  });

  it('flags a lesson that is not ready in its own row, in plain words', async () => {
    const empty = { ...emptyLesson('text'), id: 'z', title: 'Empty one', body: '<p></p>' };
    await mount(wizard({ course: textCourse({ levels: [{ id: 'l', title: 'C', sections: [{ id: 's', title: 'S', lessons: [empty] }] }] }) }).ui);
    await click(step('lessons'));
    expect(need(q('[data-lesson-row="z"]'), 'row').textContent).toContain('needs some text');
  });

  it('shows ghosted example lessons on an empty course and drops them once there is a lesson', async () => {
    await mount(wizard().ui);
    await click(step('lessons'));
    expect(q('[data-example-lessons]')).not.toBeNull();
    await unmount();
    await mount(wizard({ course: textCourse() }).ui);
    await click(step('lessons'));
    expect(q('[data-example-lessons]')).toBeNull();
  });
});

describe('leaving', () => {
  it('asks before discarding unsaved edits and not otherwise', async () => {
    const onClose = vi.fn();
    await mount(wizard({ course: textCourse(), onClose }).ui);
    await click(need(byName('button', 'Courses'), 'back'));
    expect(onClose).toHaveBeenCalledTimes(1);
    await typeInto(need(q('#course-title'), 'title'), 'Changed');
    await click(need(byName('button', 'Courses'), 'back'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(q('[data-leave-dialog]')).not.toBeNull();
    await click(need(byName('[data-leave-dialog] button', 'Leave'), 'leave'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
