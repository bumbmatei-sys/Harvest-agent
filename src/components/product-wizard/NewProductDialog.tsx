'use client';

import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface ProductTypeOption {
  id: string;
  label: string;
  description: string;
  /** The "Members get" line. A placeholder card has none. */
  membersGet?: string;
  icon: ReactNode;
  /** A small tag beside the name, e.g. "Start here". */
  tag?: string;
  /** A card that is not a type at all (the "more coming soon" note): no badge, never picked. */
  placeholder?: boolean;
  /** Types that are not built yet are listed so the roadmap is visible, and cannot be picked. */
  available: boolean;
  /** Explains a temporary plan or loading restriction on an otherwise available type. */
  blockedReason?: string;
}

/**
 * The first step of every product: what are you making? Picking an available
 * type starts that product's wizard; the rest are listed as coming soon.
 */
export function NewProductDialog({ open, onOpenChange, types, onSelect, title = 'What do you want to create?', subtitle = 'Start with one. Add the rest as you grow.' }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  types: readonly ProductTypeOption[];
  onSelect: (id: string) => void;
  title?: string;
  subtitle?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-5 overflow-y-auto sm:max-w-3xl" data-product-type-picker>
        <DialogHeader>
          <DialogTitle className="font-display text-xl text-strong">{title}</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-3 sm:grid-cols-2">
          {types.map((t) => (
            <li key={t.id}>
              <Button
                type="button"
                variant="outline"
                disabled={!t.available || !!t.blockedReason}
                title={t.blockedReason}
                data-product-type={t.id}
                onClick={() => onSelect(t.id)}
                className="h-auto min-h-11 w-full flex-col items-start gap-3 whitespace-normal rounded-brand-lg p-4 text-left font-normal"
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="flex items-center gap-2.5 text-base font-semibold text-strong">
                    <span aria-hidden className="flex size-9 items-center justify-center rounded-full bg-surface-gold text-wheat-800 [&_svg]:size-4">{t.icon}</span>
                    {t.label}
                  </span>
                  {t.available
                    ? t.tag && <Badge variant="secondary">{t.tag}</Badge>
                    : t.placeholder ? null : <Badge variant="outline">Coming soon</Badge>}
                </span>
                <span className="text-sm text-muted">{t.description}</span>
                {t.blockedReason && <span className="text-sm text-muted">{t.blockedReason}</span>}
                {t.membersGet ? <span className="text-sm text-strong"><span className="text-muted">Members get: </span>{t.membersGet}</span> : null}
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
