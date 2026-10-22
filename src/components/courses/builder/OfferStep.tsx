'use client';

import { useState } from 'react';

import { ImageUpload } from '@/components/ImageUpload';
import { Input } from '@/components/ui/input';
import { Segmented, type Option } from '@/components/email/kit';
import { AccessSection } from '@/components/courses/builder/AccessSection';
import { Card, FieldRow, StepSection } from '@/components/courses/builder/kit';
import { PAID_COMING_LATER } from '@/lib/courses/page';
import type { MemberList } from '@/lib/courses/members';
import type { CommunityRef, CoursePriceMode, ProductCourse } from '@/types/course-product.types';

const PRICE_OPTIONS: readonly Option<CoursePriceMode>[] = [
  { value: 'free', label: 'Free' },
  { value: 'one-time', label: 'One-time' },
  { value: 'membership', label: 'Membership' },
];

const toAmount = (raw: string): number | undefined => {
  const n = Number(raw);
  return raw.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** Keeps what was typed ("19." on the way to "19.99") while handing the parent only the parsed amount. */
function AmountInput({ id, value, onChange, placeholder }: {
  id: string;
  value: number | undefined;
  onChange: (amount: number | undefined) => void;
  placeholder: string;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  return (
    <Input
      id={id}
      inputMode="decimal"
      value={raw !== null && toAmount(raw) === value ? raw : (value ?? '')}
      onChange={(e) => { setRaw(e.target.value); onChange(toAmount(e.target.value)); }}
      onBlur={() => setRaw(null)}
      placeholder={placeholder}
    />
  );
}

/** Offer: what it is called, what it costs (stored, never charged), and who gets in. */
export function OfferStep({ course, onChange, communities, loadMembers }: {
  course: ProductCourse;
  onChange: (patch: Partial<ProductCourse>) => void;
  communities: readonly CommunityRef[];
  loadMembers: () => Promise<MemberList>;
}) {
  const price = course.price ?? { mode: 'free' as const };
  const paid = price.mode !== 'free';
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

      <StepSection title="Price" description="Free today. You can set a price now and it will be ready when paid checkout arrives.">
        <Card>
          <FieldRow label="How people pay" help="One payment for lasting access, or a membership that bills on a schedule.">
            <Segmented
              label="How people pay"
              value={price.mode}
              options={PRICE_OPTIONS}
              onChange={(mode) => onChange({ price: mode === 'free' ? { mode } : { ...price, mode } })}
            />
          </FieldRow>
          {paid && (
            <>
              <FieldRow label="Price in USD" htmlFor="course-price">
                <AmountInput
                  id="course-price"
                  value={price.amountUsd}
                  onChange={(amountUsd) => onChange({ price: { ...price, amountUsd } })}
                  placeholder="25"
                />
              </FieldRow>
              <FieldRow label="Was price" help="Optional. Shown crossed out beside the price." htmlFor="course-was-price">
                <AmountInput
                  id="course-was-price"
                  value={price.wasAmountUsd}
                  onChange={(wasAmountUsd) => onChange({ price: { ...price, wasAmountUsd } })}
                  placeholder="None"
                />
              </FieldRow>
              <p role="status" className="bg-surface-gold px-4 py-3 text-sm text-strong" data-checkout-later>{PAID_COMING_LATER}</p>
            </>
          )}
        </Card>
      </StepSection>

      <AccessSection course={course} onChange={onChange} communities={communities} loadMembers={loadMembers} />
    </>
  );
}
