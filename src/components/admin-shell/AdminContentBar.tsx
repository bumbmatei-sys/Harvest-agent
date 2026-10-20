'use client';

import type { ReactNode } from 'react';
import { ChevronLeft, ExternalLink } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';

/**
 * Desktop content toolbar, in the sidebar-07 header pattern:
 * SidebarTrigger, Separator, Breadcrumb on the left; screen actions on the right.
 * It sits in the content card. Mobile keeps AdminScreenHeader.
 */
export function AdminContentBar({
  section,
  title,
  onBack,
  onOpenApp,
  actions,
  trailing,
}: {
  section: string;
  title: string;
  onBack?: () => void;
  onOpenApp?: () => void;
  actions?: ReactNode;
  /** Desktop-only extras in the right cluster, such as the payments inbox. */
  trailing?: ReactNode;
}) {
  return (
    <header
      data-admin-content-bar
      className="flex h-12 shrink-0 items-center gap-2 px-3"
    >
      <SidebarTrigger className="size-8 text-muted-foreground hover:bg-muted" />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
      <div className="flex min-w-0 items-center gap-1">
        {onBack ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onBack}
            aria-label="Back"
            className="h-8 min-h-[44px] shrink-0 px-2 text-[13px] font-medium sm:min-h-0"
          >
            <ChevronLeft />
            Back
          </Button>
        ) : null}
        <Breadcrumb>
          <BreadcrumbList className="flex-nowrap text-[13px]">
            {section ? (
              <>
                <BreadcrumbItem className="hidden sm:inline-flex">
                  <BreadcrumbLink render={<span />} className="text-muted-foreground">
                    {section}
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden sm:inline-flex" />
              </>
            ) : null}
            <BreadcrumbItem>
              <BreadcrumbPage className="max-w-[40vw] truncate font-medium text-foreground">
                {title}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      {/* Right: screen action · search · notifications · account */}
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {actions}
        {trailing}
        {onOpenApp && (
          <Button type="button" variant="secondary" onClick={onOpenApp} className="h-8 min-h-[44px] sm:min-h-0">
            Open member app
            <ExternalLink />
          </Button>
        )}
      </div>
    </header>
  );
}
