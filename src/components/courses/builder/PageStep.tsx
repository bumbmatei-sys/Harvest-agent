'use client';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, FieldRow, StepSection } from '@/components/courses/builder/kit';
import { descriptionBlocks } from '@/lib/courses/page';
import { stripHtml } from '@/utils/stripHtml';
import type { ProductCourse } from '@/types/course-product.types';

/** Page: the words on the course page. Colours and type come from the ministry's brand, so there is nothing to pick. */
export function PageStep({ course, onChange }: { course: ProductCourse; onChange: (patch: Partial<ProductCourse>) => void }) {
  const legacyHtml = descriptionBlocks(course.description) && 'html' in (descriptionBlocks(course.description) ?? {});
  return (
    <>
      <StepSection title="Where people land" description="The course page people see first. Its look follows your ministry's colours and type.">
        <Card>
          <FieldRow label="Description" help="A few sentences on what this course is and who it is for." htmlFor="course-description" stacked>
            <Textarea
              id="course-description"
              rows={6}
              value={legacyHtml ? stripHtml(course.description) : course.description}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder="In seven short lessons you will…"
            />
          </FieldRow>
          <FieldRow label="Button text" help="Empty means “Get it free” or the price." htmlFor="course-button">
            <Input id="course-button" value={course.buttonText ?? ''} onChange={(e) => onChange({ buttonText: e.target.value })} placeholder="Get it free" />
          </FieldRow>
        </Card>
      </StepSection>

      <StepSection title="Sign-off" description="A closing line at the foot of the page.">
        <Card>
          <FieldRow label="Sign-off" htmlFor="course-signoff">
            <Input id="course-signoff" value={course.signOff ?? ''} onChange={(e) => onChange({ signOff: e.target.value })} placeholder="Made with love, for your walk." />
          </FieldRow>
        </Card>
      </StepSection>
    </>
  );
}
