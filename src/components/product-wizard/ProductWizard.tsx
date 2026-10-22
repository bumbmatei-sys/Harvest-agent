'use client';

import type { ReactNode } from 'react';
import { ArrowLeft, Check } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';

export interface WizardStep {
  id: string;
  label: string;
  /** The step's own work is finished. Drawn as a check in the rail. */
  done?: boolean;
}

export interface ProductWizardProps {
  /** "Course", "Event", "Fundraiser"... shown under the title. */
  productLabel: string;
  title: string;
  /** Shown while the title is empty. */
  untitledLabel: string;
  status: 'draft' | 'published';
  /** Who owns it, e.g. the ministry name. */
  ownerLabel?: string;
  steps: readonly WizardStep[];
  activeStepId: string;
  onStepChange: (id: string) => void;
  onBack?: () => void;
  backLabel?: string;
  /** Buttons beside the title, e.g. "Preview as member". */
  headerActions?: ReactNode;
  /** The live preview pane. Hidden below xl, where the step takes the width. */
  preview?: ReactNode;
  saving?: boolean;
  error?: string | null;
  /** True once the last save landed and nothing has changed since. */
  saved?: boolean;
  onSaveDraft: () => void;
  onPublish: () => void;
  /** When set, the final action is disabled and this says why. */
  publishBlockedReason?: string | null;
  publishLabel?: string;
  /** The save button's words. A published product saves changes rather than a draft. */
  saveLabel?: string;
  /** The active step's body. */
  children: ReactNode;
}

/**
 * The one shell every product is built in: a step rail, the active step, an
 * optional live preview, and a footer of save and continue actions. A product
 * supplies its own steps and their bodies and nothing else, so Fundraising,
 * Events, Services and Forms reuse this and change only the type-specific step.
 */
export function ProductWizard({
  productLabel, title, untitledLabel, status, ownerLabel, steps, activeStepId, onStepChange,
  onBack, backLabel = 'Back', headerActions, preview, saving, error, saved, onSaveDraft, onPublish,
  publishBlockedReason, publishLabel = 'Publish', saveLabel = 'Save draft', children,
}: ProductWizardProps) {
  const index = Math.max(0, steps.findIndex((s) => s.id === activeStepId));
  const isLast = index === steps.length - 1;
  const doneCount = steps.filter((s) => s.done).length;
  const progress = steps.length ? Math.round((doneCount / steps.length) * 100) : 0;
  const next = steps[index + 1];
  const previous = steps[index - 1];

  return (
    <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-6 px-4 pt-6 lg:px-0" data-product-wizard>
      <header className="flex flex-col gap-3">
        {onBack && (
          <Button type="button" variant="ghost" size="sm" className="min-h-11 -ml-2 w-fit gap-1.5 px-2 text-muted" onClick={onBack}>
            <ArrowLeft aria-hidden />
            {backLabel}
          </Button>
        )}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-3xl font-semibold tracking-tight text-strong break-words" data-wizard-title>
                {title.trim() || untitledLabel}
              </h1>
              <Badge variant="secondary" data-wizard-status={status}>{status === 'published' ? 'Published' : 'Draft'}</Badge>
            </div>
            <p className="mt-1.5 text-sm text-muted">
              {productLabel}{ownerLabel ? ` · ${ownerLabel}` : ''}
            </p>
          </div>
          {headerActions && <div className="flex flex-wrap items-center gap-2">{headerActions}</div>}
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_380px]">
        <nav aria-label={`${productLabel} steps`} className="flex flex-col gap-3 lg:sticky lg:top-6 lg:self-start">
          <div className="hidden flex-col gap-2 lg:flex">
            <p className="text-xs font-medium text-muted" data-wizard-progress-label>{doneCount} of {steps.length} steps done</p>
            <Progress value={progress} aria-label="Setup progress" />
          </div>
          <ol className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {steps.map((step, i) => (
              <li key={step.id} className="shrink-0 lg:shrink">
                <Button
                  type="button"
                  variant="ghost"
                  data-step={step.id}
                  data-active={step.id === activeStepId ? 'true' : 'false'}
                  aria-current={step.id === activeStepId ? 'step' : undefined}
                  onClick={() => onStepChange(step.id)}
                  className="min-h-11 w-full justify-start gap-2.5 px-3 text-sm font-normal text-muted data-[active=true]:bg-surface-sunken data-[active=true]:font-semibold data-[active=true]:text-strong"
                >
                  <span
                    aria-hidden
                    className="flex size-5 shrink-0 items-center justify-center rounded-full text-xs"
                    data-done={step.done ? 'true' : 'false'}
                  >
                    {step.done ? <Check className="size-4 text-field-600" /> : i + 1}
                  </span>
                  {step.label}
                  {step.done && <span className="sr-only"> (done)</span>}
                </Button>
              </li>
            ))}
          </ol>
          <Separator className="hidden lg:block" />
        </nav>

        <main className="flex min-w-0 flex-col gap-8" data-wizard-step={activeStepId}>
          {error && (
            <div role="alert" className="rounded-lg border border-line bg-surface-raised px-3 py-2.5 text-sm text-danger">{error}</div>
          )}
          {children}
        </main>

        {preview && (
          <aside aria-label="Live preview" className="hidden xl:block">
            <div className="sticky top-6 flex flex-col gap-3">
              <p className="text-xs font-medium text-muted">Live preview</p>
              <div className="max-h-[calc(100vh-8rem)] overflow-y-auto rounded-brand-lg border border-line bg-surface shadow-[var(--ds-sh-sm)]">{preview}</div>
            </div>
          </aside>
        )}
      </div>

      {/* Sticky insets are measured from the scroller's content box, and the admin scroller keeps
          lg:pb-8 below its content, so bottom-0 would leave the bar 32px short with the page
          showing through underneath. lg:-bottom-8 pins it flush with the viewport edge. */}
      <footer className="sticky bottom-0 z-30 -mx-4 lg:-bottom-8 border-t border-line bg-surface-raised lg:mx-0" data-wizard-footer>
        <div className="flex w-full items-center justify-between gap-3 px-4 py-3 lg:px-0">
          <div className="flex items-center gap-2">
            {previous && (
              <Button type="button" variant="ghost" className="min-h-11" onClick={() => onStepChange(previous.id)}>Back</Button>
            )}
            <span className="hidden text-xs text-muted sm:inline" role="status" data-wizard-save-state>
              {saving ? 'Saving…' : saved ? 'Saved' : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {publishBlockedReason && isLast && (
              <span className="hidden max-w-xs text-right text-xs text-muted md:inline" data-wizard-blocked>{publishBlockedReason}</span>
            )}
            <Button type="button" variant="ghost" className="min-h-11" disabled={saving} onClick={onSaveDraft}>{saveLabel}</Button>
            {isLast ? (
              <Button type="button" className="min-h-11 px-5" disabled={saving || Boolean(publishBlockedReason)} onClick={onPublish} data-wizard-primary="publish">
                {publishLabel}
              </Button>
            ) : (
              <Button type="button" className="min-h-11 px-5" onClick={() => next && onStepChange(next.id)} data-wizard-primary="next">
                Continue
              </Button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
