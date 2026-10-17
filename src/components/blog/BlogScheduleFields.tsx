'use client';

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

export type BlogEditorIntent = 'published' | 'scheduled' | 'draft';

/**
 * Desktop publish control for a blog post.
 * The same block stacks inside the existing editor rail; there is no separate
 * mobile admin layout.
 */
export function BlogScheduleFields({
  intent,
  onIntent,
  wallClock,
  onWallClock,
  timeZone,
  preview,
  fieldLabel,
  fieldInput,
}: {
  intent: BlogEditorIntent;
  onIntent: (intent: BlogEditorIntent) => void;
  wallClock: string;
  onWallClock: (value: string) => void;
  timeZone: string;
  preview: string | null;
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
          className="mt-1.5 w-full"
        >
          <ToggleGroupItem value="published" className="w-full min-h-11 justify-start px-3" aria-label="Publish now">
            Publish now
          </ToggleGroupItem>
          <ToggleGroupItem value="scheduled" className="w-full min-h-11 justify-start px-3" aria-label="Schedule">
            Schedule
          </ToggleGroupItem>
          <ToggleGroupItem value="draft" className="w-full min-h-11 justify-start px-3" aria-label="Draft">
            Draft
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {intent === 'scheduled' && (
        <div>
          <label className={fieldLabel} htmlFor="blog-schedule-time">Publish at</label>
          <input
            id="blog-schedule-time"
            type="datetime-local"
            value={wallClock}
            onChange={(event) => onWallClock(event.target.value)}
            className={fieldInput}
          />
          <p className="mt-1.5 text-xs text-muted">
            Shown in {timeZone}. Stored in UTC. The post stays off the ministry page until this time.
          </p>
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
