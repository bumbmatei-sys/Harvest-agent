'use client';

import { useSubviewHeader } from '@/components/AdminScreenHeader';
import { useCallback, useMemo, useState } from 'react';
import { Eye } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ProductWizard, type WizardStep } from '@/components/product-wizard';
import { CourseLanding } from '@/components/courses/CourseLanding';
import { LessonsStep } from '@/components/courses/builder/LessonsStep';
import { OfferStep } from '@/components/courses/builder/OfferStep';
import { PageStep } from '@/components/courses/builder/PageStep';
import { PublishStep } from '@/components/courses/builder/PublishStep';
import { DEFAULT_INCLUDED } from '@/lib/courses/page';
import { emptyCourseLevels, publishReadiness } from '@/lib/courses/lessons';
import { loadTenantMembers, type MemberList } from '@/lib/courses/members';
import { saveCourse, type SaveStatus } from '@/lib/courses/persist';
import type { CommunityRef, ProductCourse } from '@/types/course-product.types';

export type CourseStepId = 'offer' | 'lessons' | 'page' | 'publish';

/** A course nobody has saved yet. It starts restricted: a new product is its own, with its own list. */
export function newCourse(): ProductCourse {
  return {
    title: '',
    description: '',
    category: '',
    thumbnail: '',
    featured: false,
    authorIds: [],
    levels: emptyCourseLevels(),
    issueCertificate: true,
    requireQuiz: false,
    status: 'draft',
    accessMode: 'restricted',
    accessUserIds: [],
    communityIds: [],
    price: { mode: 'free' },
    included: [...DEFAULT_INCLUDED],
  };
}

const errorText = (e: unknown): string => (e instanceof Error && e.message ? e.message : 'The course could not be saved. Please try again.');

/**
 * The course builder: the shared product wizard with the course's own steps.
 * Offer, Lessons, Page, Publish — the same four every product has, with Lessons
 * as the only step that is specific to a course.
 */
export function CourseWizard({
  course: initial, onClose, onSaved, communities = [], loadMembers = loadTenantMembers, ownerLabel, initialStep = 'offer',
  save = saveCourse, origin,
}: {
  course: ProductCourse | null;
  onClose: () => void;
  onSaved?: (course: ProductCourse) => void;
  communities?: readonly CommunityRef[];
  loadMembers?: () => Promise<MemberList>;
  ownerLabel?: string;
  initialStep?: CourseStepId;
  save?: (course: ProductCourse, status: SaveStatus) => Promise<string>;
  origin?: string;
}) {
  const [course, setCourse] = useState<ProductCourse>(() => initial ?? newCourse());
  const [step, setStep] = useState<CourseStepId>(initialStep);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const patch = useCallback((p: Partial<ProductCourse>) => { setCourse((c) => ({ ...c, ...p })); setDirty(true); }, []);
  const readiness = useMemo(() => publishReadiness(course), [course]);
  const published = course.status === 'published';

  const persist = async (status: SaveStatus) => {
    setSaving(true);
    setError(null);
    try {
      const id = await save(course, status);
      const next = { ...course, id, status };
      setCourse(next);
      setDirty(false);
      onSaved?.(next);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const steps: WizardStep[] = [
    { id: 'offer', label: 'Offer', done: course.title.trim().length > 0 },
    { id: 'lessons', label: 'Lessons', done: readiness.items.filter((i) => i.id !== 'title' && i.id !== 'access').every((i) => i.done) },
    { id: 'page', label: 'Page', done: course.description.trim().length > 0 },
    { id: 'publish', label: 'Publish', done: published },
  ];

  const blockedReason = readiness.ready
    ? null
    : `Still to do: ${readiness.items.filter((i) => i.blocking && !i.done).map((i) => i.label.toLowerCase()).join(', ')}.`;

  const goBack = () => { if (dirty && !saving) setLeaving(true); else onClose(); };
  // The way back is the top bar's breadcrumb (Products > Courses > this course), which still
  // asks first when there are unsaved changes.
  useSubviewHeader({ title: course.title.trim() || 'New course', onBack: goBack });

  return (
    <>
      <ProductWizard
        productLabel="Course"
        title={course.title}
        untitledLabel="Untitled course"
        status={published ? 'published' : 'draft'}
        ownerLabel={ownerLabel}
        steps={steps}
        activeStepId={step}
        onStepChange={(id) => setStep(id as CourseStepId)}
        saving={saving}
        saved={!dirty && Boolean(course.id)}
        error={error}
        saveLabel={published ? 'Save changes' : 'Save draft'}
        onSaveDraft={() => void persist(published ? 'published' : 'draft')}
        onPublish={() => void persist('published')}
        publishLabel={published ? 'Update course' : 'Publish'}
        publishBlockedReason={blockedReason}
        headerActions={(
          <>
            <Button type="button" variant="outline" className="min-h-11 gap-1.5" onClick={() => setPreviewing(true)} data-preview-as-member>
              <Eye aria-hidden />Preview as member
            </Button>
            {published && (
              <Button type="button" variant="ghost" className="min-h-11" disabled={saving} onClick={() => void persist('draft')}>Unpublish</Button>
            )}
          </>
        )}
        preview={<CourseLanding course={course} mode="preview" />}
      >
        {step === 'offer' && <OfferStep course={course} onChange={patch} communities={communities} loadMembers={loadMembers} />}
        {step === 'lessons' && <LessonsStep course={course} onChange={patch} />}
        {step === 'page' && <PageStep course={course} onChange={patch} />}
        {step === 'publish' && <PublishStep course={course} origin={origin ?? (typeof window === 'undefined' ? '' : window.location.origin)} />}
      </ProductWizard>

      <Dialog open={previewing} onOpenChange={setPreviewing}>
        <DialogContent className="max-h-[90vh] overflow-y-auto p-0 sm:max-w-3xl" data-preview-dialog>
          <DialogHeader className="sr-only">
            <DialogTitle>Preview as member</DialogTitle>
            <DialogDescription>How the course page looks to a member.</DialogDescription>
          </DialogHeader>
          <CourseLanding course={course} mode="preview" />
        </DialogContent>
      </Dialog>

      <Dialog open={leaving} onOpenChange={setLeaving}>
        <DialogContent data-leave-dialog>
          <DialogHeader>
            <DialogTitle>Leave without saving?</DialogTitle>
            <DialogDescription>You have changes that are not saved yet.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" className="min-h-11" onClick={() => setLeaving(false)}>Keep editing</Button>
            <Button type="button" variant="destructive" className="min-h-11" onClick={onClose}>Leave</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
