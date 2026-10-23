'use client';

import { Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, StepSection } from '@/components/courses/builder/kit';
import { DEFAULT_INCLUDED } from '@/lib/courses/page';
import type { ProductCourse } from '@/types/course-product.types';

/** What's included: the checklist beside the button on the course page. It is part of the offer, so it lives on the Offer step. */
export function IncludedSection({ course, onChange }: { course: ProductCourse; onChange: (patch: Partial<ProductCourse>) => void }) {
  const included = course.included ?? [...DEFAULT_INCLUDED];
  const setIncluded = (next: string[]) => onChange({ included: next });
  return (
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
  );
}
