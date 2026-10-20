'use client';

import type { ComponentProps } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

/**
 * Eden's segmented pill, built on shadcn Tabs.
 * Track is black 4.5% (a theme token), 12px radius, 4px padding.
 * The active tab is the raised card with the 1px shadow token.
 * Restyle is className only — the elements are the Tabs primitives.
 */
export const SEGMENTED_LIST_CLASS =
  'h-auto w-fit gap-0.5 rounded-xl bg-seg-track p-1 group-data-[orientation=horizontal]/tabs:h-auto';

export const SEGMENTED_TRIGGER_CLASS =
  'h-8 min-w-0 flex-none rounded-lg border-transparent px-3 text-[13px] font-medium text-muted-foreground shadow-none data-active:bg-seg-active data-active:text-foreground data-active:shadow-seg dark:data-active:border-transparent dark:data-active:bg-seg-active';

export function SegmentedTabs(props: ComponentProps<typeof Tabs>) {
  return <Tabs {...props} />;
}

export function SegmentedTabsList({ className, ...props }: ComponentProps<typeof TabsList>) {
  return <TabsList className={cn(SEGMENTED_LIST_CLASS, className)} {...props} />;
}

export function SegmentedTabsTrigger({ className, ...props }: ComponentProps<typeof TabsTrigger>) {
  return <TabsTrigger className={cn(SEGMENTED_TRIGGER_CLASS, className)} {...props} />;
}

export { TabsContent as SegmentedTabsContent };
