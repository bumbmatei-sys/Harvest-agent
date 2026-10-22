'use client';

import { useState } from 'react';
import { Check, Circle, Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, StepSection } from '@/components/courses/builder/kit';
import { publishReadiness } from '@/lib/courses/lessons';
import type { ProductCourse } from '@/types/course-product.types';

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4" data-share-row>
      <span className="text-sm font-medium text-strong sm:w-40">{label}</span>
      <Input readOnly value={value} aria-label={label} className="flex-1" onFocus={(e) => e.currentTarget.select()} />
      <Button
        type="button"
        variant="outline"
        className="min-h-11 gap-1.5"
        onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }, () => {}); }}
      >
        <Copy aria-hidden />{copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

/** Publish: the checklist the Publish button obeys, then where to share it. */
export function PublishStep({ course, origin }: { course: ProductCourse; origin: string }) {
  const { items } = publishReadiness(course);
  const saved = Boolean(course.id);
  return (
    <>
      <StepSection title="Before you publish" description="Everything marked required has to be done. The rest is worth a look.">
        <Card>
          <ul aria-label="Publish checklist" className="flex flex-col divide-y divide-line">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-3 px-4 py-3.5" data-check={item.id} data-done={item.done ? 'true' : 'false'}>
                <span aria-hidden className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
                  {item.done ? <Check className="size-5 text-field-600" /> : <Circle className="size-5 text-muted" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-strong">
                    {item.label}
                    {!item.blocking && <span className="ml-2 text-xs font-normal text-muted">Recommended</span>}
                  </span>
                  {!item.done && item.detail && <span className="mt-0.5 block text-xs text-muted">{item.detail}</span>}
                  <span className="sr-only">{item.done ? 'Done' : 'Not done'}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </StepSection>

      <StepSection title="Share" description={saved ? 'Only people who have access can open the course, whichever link they use.' : 'Save the course to get its links.'}>
        <Card>
          {saved ? (
            <>
              <CopyRow label="Course page" value={`${origin}/courses/${course.id}`} />
            </>
          ) : (
            <p className="px-4 py-3.5 text-sm text-muted" data-share-unsaved>Links appear after the first save.</p>
          )}
        </Card>
      </StepSection>
    </>
  );
}
