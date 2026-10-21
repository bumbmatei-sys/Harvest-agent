'use client';

import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

/** Below `sm` a control is at least 44px tall; the 38px floor above it is a global rule. */
export const TAP = 'min-h-11';

export function PageHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-strong">{title}</h1>
        <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

/** The soft gold strip Eden uses for "finish setup" nudges. */
export function SetupBanner({ children, actionLabel, onAction }: { children: ReactNode; actionLabel: string; onAction: () => void }) {
  return (
    <div role="status" className="flex items-center justify-between gap-3 rounded-lg bg-surface-gold px-4 py-3 text-sm text-strong">
      <span>{children}</span>
      <Button variant="ghost" size="sm" className="min-h-11 font-semibold" onClick={onAction}>{actionLabel}</Button>
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-line bg-surface-raised px-3 py-2.5 text-sm text-danger">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function senderReady(s: { fromName: string; replyTo: string; mailingAddress: string; domainState: string }): boolean {
  return Boolean(s.fromName.trim() && s.replyTo.trim() && s.mailingAddress.trim() && s.domainState === 'verified');
}

export interface Option<T extends string> { readonly value: T; readonly label: string }

/** A Select that prints its label (Select.Value alone would print the raw value). */
export function Pick<T extends string>({ value, onChange, options, label, className, placeholder }: {
  value: T | '';
  onChange: (next: T) => void;
  options: readonly Option<T>[];
  label: string;
  className?: string;
  placeholder?: string;
}) {
  const current = options.find((o) => o.value === value)?.label ?? placeholder ?? '';
  return (
    <Select value={value} onValueChange={(v: unknown) => onChange(String(v) as T)}>
      <SelectTrigger aria-label={label} className={cn(TAP, 'w-full', className)}>
        <SelectValue>{() => current}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** Eden's quiet pill switch: Now / Pick a time, 7 / 30 / 90 days. */
export function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T;
  onChange: (next: T) => void;
  options: readonly Option<T>[];
  label: string;
}) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(next) => { const picked = next[0]; if (picked) onChange(picked as T); }}
      spacing={0}
      aria-label={label}
      className="rounded-lg bg-surface-sunken p-0.5"
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className={cn(TAP, 'px-3 text-sm data-[pressed]:bg-surface-raised data-[pressed]:text-strong data-[pressed]:shadow-xs')}>
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
