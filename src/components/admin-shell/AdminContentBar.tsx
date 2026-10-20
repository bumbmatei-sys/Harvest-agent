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
}: {
  section: string;
  title: string;
  onBack?: () => void;
  onOpenApp?: () => void;
  actions?: ReactNode;
}) {
  return (
    <header
      data-admin-content-bar
      className="flex h-12 shrink-0 items-center gap-2 px-3"
    >
      <SidebarTrigger className="size-8 text-muted-foreground hover:bg-muted" />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
      {onBack ? (
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          aria-label="Back"
          className="h-8 px-2 text-[13px] font-medium"
        >
          <ChevronLeft />
          Back
        </Button>
      ) : (
        <Breadcrumb>
          <BreadcrumbList className="flex-nowrap text-[13px]">
            <BreadcrumbItem className="hidden sm:inline-flex">
              <BreadcrumbLink render={<span />} className="text-muted-foreground">
                {section}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden sm:inline-flex" />
            <BreadcrumbItem>
              <BreadcrumbPage className="max-w-[40vw] truncate font-medium text-foreground">
                {title}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {actions}
        {onOpenApp && (
          <Button type="button" variant="secondary" onClick={onOpenApp} className="h-8">
            Open member app
            <ExternalLink />
          </Button>
        )}
      </div>
    </header>
  );
}
