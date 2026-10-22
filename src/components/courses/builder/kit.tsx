import type { ReactNode } from 'react';

import { Card as UiCard } from '@/components/ui/card';

/** A titled block in a wizard step: a heading, one line of help, then the card(s). */
export function StepSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-strong">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** One labelled row inside a card: the label and its help on the left, the control on the right. */
export function FieldRow({ label, help, htmlFor, children, stacked }: { label: string; help?: string; htmlFor?: string; children: ReactNode; stacked?: boolean }) {
  return (
    <div className={stacked ? 'flex flex-col gap-3 px-4 py-3.5' : 'flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6'}>
      <div className="min-w-0 sm:max-w-[55%]">
        <label htmlFor={htmlFor} className="text-sm font-medium text-strong">{label}</label>
        {help && <p className="mt-0.5 text-xs text-muted">{help}</p>}
      </div>
      <div className={stacked ? '' : 'sm:w-72'}>{children}</div>
    </div>
  );
}

/** The shadcn Card with the spacing a settings list wants: rows own their padding. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <UiCard className={`gap-0 divide-y divide-line py-0 ${className}`}>{children}</UiCard>;
}
