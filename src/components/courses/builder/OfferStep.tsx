'use client';

import { ImageUpload } from '@/components/ImageUpload';
import { Input } from '@/components/ui/input';
import { AccessSection } from '@/components/courses/builder/AccessSection';
import { IncludedSection } from '@/components/courses/builder/IncludedSection';
import { Card, FieldRow, StepSection } from '@/components/courses/builder/kit';
import type { MemberList } from '@/lib/courses/members';
import type { CommunityRef, ProductCourse } from '@/types/course-product.types';

/**
 * Offer: what it is called, what is included, and who gets in.
 *
 * There is no price here. Courses are free until checkout exists, so the price
 * fields are not drawn; `course.price` stays in the data model untouched, and a
 * course that already carries one keeps it.
 */
export function OfferStep({ course, onChange, communities, loadMembers }: {
  course: ProductCourse;
  onChange: (patch: Partial<ProductCourse>) => void;
  communities: readonly CommunityRef[];
  loadMembers: () => Promise<MemberList>;
}) {
  return (
    <>
      <StepSection title="Name" description="What people see first.">
        <Card>
          <FieldRow label="Cover" help="A wide picture at the top of the course page.">
            <div className="max-w-xs">
              <ImageUpload
                value={course.coverImage ?? course.thumbnail ?? ''}
                onChange={(url) => onChange({ coverImage: url, thumbnail: url })}
                label="Add a cover"
              />
            </div>
          </FieldRow>
          <FieldRow label="Title" help="Name the result, not the topic. A few words people would say out loud." htmlFor="course-title">
            <Input id="course-title" value={course.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Walking with Jesus, week by week" />
          </FieldRow>
          <FieldRow label="Tagline" help="One short line under the title." htmlFor="course-tagline">
            <Input id="course-tagline" value={course.tagline ?? ''} onChange={(e) => onChange({ tagline: e.target.value })} placeholder="Seven days to a steadier prayer life" />
          </FieldRow>
          <FieldRow label="Taught by" help="Shown as “By …” on the course page." htmlFor="course-author">
            <Input id="course-author" value={course.author ?? ''} onChange={(e) => onChange({ author: e.target.value })} placeholder="Pastor Ana" />
          </FieldRow>
        </Card>
      </StepSection>

      <IncludedSection course={course} onChange={onChange} />

      <AccessSection course={course} onChange={onChange} communities={communities} loadMembers={loadMembers} />
    </>
  );
}
