'use client';

import { CalendarClock, FileText, Send } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Input } from '@/components/ui/input';
import { wallClockAfterPickerChange } from '@/lib/blog/visibility';

export type BlogEditorIntent = 'published' | 'scheduled' | 'draft';

/**
 * Publish control for a blog post.
 * Below `lg` it stays the stacked rail. From `lg` the same ToggleGroup is a
 * horizontal segmented pill. Orientation stays vertical because the prop
 * cannot change with the viewport; the row is a flex direction only.
 *
 * Base UI Toggle sets `aria-pressed` and, when on, `data-pressed`. It does
 * not set `data-state=on` (that selector is the Radix one on the primitive).
 * The raised shadow is `shadow-xs`, the subtle elevation token in app code.
 * The active fill is `bg-surface-gold`, not raised: raised is pure white in
 * light. The edge is `--border-gold` (there is no utility for that token;
 * `border-gold` is the solid brand colour). In dark the fill is a 16% accent
 * mix and the 52% gold edge is what separates it from the sunken track.
 * Inactive segments carry a transparent border so the 1px edge does not
 * change their height.
 */
const intentItem = [
  'h-auto w-full min-h-11 justify-start px-3',
  'lg:w-auto lg:min-w-0! lg:flex-1 lg:shrink! lg:justify-center lg:gap-1 lg:px-1! lg:text-[13px] lg:whitespace-nowrap lg:rounded-md!',
  'lg:border lg:border-transparent! lg:bg-transparent! lg:text-muted! lg:hover:bg-transparent! lg:hover:text-body!',
  'lg:aria-pressed:border-[color:var(--border-gold)]! lg:aria-pressed:bg-surface-gold! lg:aria-pressed:text-strong! lg:aria-pressed:font-semibold! lg:aria-pressed:shadow-xs!',
  'lg:aria-pressed:hover:border-[color:var(--border-gold)]! lg:aria-pressed:hover:bg-surface-gold! lg:aria-pressed:hover:text-strong!',
  'lg:data-[pressed]:border-[color:var(--border-gold)]! lg:data-[pressed]:bg-surface-gold! lg:data-[pressed]:text-strong! lg:data-[pressed]:font-semibold! lg:data-[pressed]:shadow-xs!',
  'lg:data-[pressed]:hover:border-[color:var(--border-gold)]! lg:data-[pressed]:hover:bg-surface-gold! lg:data-[pressed]:hover:text-strong!',
].join(' ');

export function BlogScheduleFields({
  intent,
  onIntent,
  wallClock,
  onWallClock,
  timeZone,
  preview,
  scheduleError,
  fieldLabel,
  fieldInput,
}: {
  intent: BlogEditorIntent;
  onIntent: (intent: BlogEditorIntent) => void;
  wallClock: string;
  onWallClock: (value: string) => void;
  timeZone: string;
  preview: string | null;
  scheduleError?: string | null;
  fieldLabel: string;
  fieldInput: string;
}) {
  return (
    <div className="space-y-3">
      <div>
        <span className={fieldLabel}>Publish</span>
        <ToggleGroup
          value={[intent]}
          onValueChange={(next) => {
            const picked = next[0];
            if (picked === 'published' || picked === 'scheduled' || picked === 'draft') onIntent(picked);
          }}
          spacing={0}
          orientation="vertical"
          aria-label="Publish"
          className="mt-1.5 w-full flex-col items-stretch lg:flex-row lg:rounded-brand lg:border lg:border-line lg:bg-surface-sunken lg:p-1"
        >
          <ToggleGroupItem value="published" className={intentItem} aria-label="Publish now">
            <Send aria-hidden className="hidden size-3.5 lg:inline" />
            Publish now
          </ToggleGroupItem>
          <ToggleGroupItem value="scheduled" className={intentItem} aria-label="Schedule">
            <CalendarClock aria-hidden className="hidden size-3.5 lg:inline" />
            Schedule
          </ToggleGroupItem>
          <ToggleGroupItem value="draft" className={intentItem} aria-label="Draft">
            <FileText aria-hidden className="hidden size-3.5 lg:inline" />
            Draft
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {intent === 'scheduled' && (
        <div>
          <label className={fieldLabel} htmlFor="blog-schedule-time">Publish at</label>
          <Input
            id="blog-schedule-time"
            type="datetime-local"
            value={wallClock}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.value = wallClock;
            }}
            onChange={(event) => {
              const next = wallClockAfterPickerChange(wallClock, event.target.value);
              if (next !== event.target.value) event.target.value = next;
              if (next !== wallClock) onWallClock(next);
            }}
            className={`${fieldInput} h-auto dark:bg-surface-raised!`}
          />
          {scheduleError ? (
            <p className="mt-1.5 text-sm text-danger" role="alert">{scheduleError}</p>
          ) : (
            <p className="mt-1.5 text-xs text-muted">
              Shown in {timeZone}. Stored in UTC. The post stays off the ministry page until this time.
            </p>
          )}
        </div>
      )}
      {preview && (
        <p className="text-sm text-body" data-blog-schedule-preview="">
          {preview}
        </p>
      )}
    </div>
  );
}

export function schedulePreviewSentence(effect: {
  church: { name: string };
  time: { localLabel: string; timeZone: string; publishedAt: string | null };
  visibility: string;
  action: string;
}): string {
  const church = effect.church.name;
  if (effect.action === 'publishNow') {
    return `${church}: this post becomes public on the ministry page now.`;
  }
  if (effect.action === 'schedule') {
    return `${church}: hidden until ${effect.time.localLabel} (${effect.time.timeZone}), then public on the ministry page.`;
  }
  if (effect.action === 'unschedule') {
    return `${church}: this post returns to a draft and leaves the ministry page.`;
  }
  return `${church}: this post will be removed.`;
}
