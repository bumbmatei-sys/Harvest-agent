'use client';

import { Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, FieldRow, StepSection } from '@/components/courses/builder/kit';
import { DEFAULT_INCLUDED, descriptionBlocks } from '@/lib/courses/page';
import { stripHtml } from '@/utils/stripHtml';
import type { ProductCourse } from '@/types/course-product.types';

/** Page: the words on the course page. Colours and type come from the ministry's brand, so there is nothing to pick. */
export function PageStep({ course, onChange }: { course: ProductCourse; onChange: (patch: Partial<ProductCourse>) => void }) {
  const included = course.included ?? [...DEFAULT_INCLUDED];
  const legacyHtml = descriptionBlocks(course.description) && 'html' in (descriptionBlocks(course.description) ?? {});
  const setIncluded = (next: string[]) => onChange({ included: next });
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

      <StepSection title="What's included" description="The checklist beside the button.">
        <Card>
          <ul className="flex flex-col divide-y divide-line" aria-label="What is included">
            {included.map((item, i) => (
              <li key={i} className="flex items-center gap-2 px-4 py-2">
                <Input
                  aria-label={`Included item ${i + 1}`}
                  value={item}
                  onChange={(e) => setIncluded(included.map((x, j) => (j === i ? e.target.value : x)))}
                />
                <Button type="button" variant="ghost" size="icon-sm" className="min-h-11 min-w-11" aria-label={`Remove included item ${i + 1}`} onClick={() => setIncluded(included.filter((_, j) => j !== i))}>
                  <X />
                </Button>
              </li>
            ))}
          </ul>
          <div className="px-2 py-1">
            <Button type="button" variant="ghost" size="sm" className="min-h-11 gap-1.5 px-2" onClick={() => setIncluded([...included, ''])}>
              <Plus aria-hidden />Add a line
            </Button>
          </div>
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
