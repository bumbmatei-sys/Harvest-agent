'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ExternalLink, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

import { openAdminSearch } from './admin-search';

/**
 * Desktop content toolbar: Breadcrumb on the left; screen actions on the right.
 * The sidebar collapse button lives in the sidebar footer only. It sits in the
 * content card. Mobile keeps AdminScreenHeader.
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
        <SearchPill />
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

/**
 * Same height as "Open member app" (`h-8`, 44px floor below `sm`). Full pill
 * with "Search…" and the platform shortcut from `sm` up; a round icon button
 * on smaller screens. There is no shadcn `Kbd` in this tree, so the hint is a
 * native `<kbd>` on the existing token classes.
 */
function SearchPill() {
  const [hint, setHint] = useState('Ctrl K');
  useEffect(() => {
    setHint(/Mac|iPhone|iPad|iPod/.test(navigator.platform) ? '⌘K' : 'Ctrl K');
  }, []);
  return (
    <Button
      type="button"
      variant="outline"
      onClick={openAdminSearch}
      aria-label="Search"
      data-admin-search-pill
      className="h-8 min-h-[44px] min-w-[44px] gap-2 rounded-full px-0 font-normal text-muted-foreground sm:min-h-0 sm:min-w-0 sm:px-3"
    >
      <Search />
      <span className="hidden sm:inline">Search…</span>
      <kbd
        data-slot="kbd"
        className="pointer-events-none hidden h-5 select-none items-center rounded-md border border-border bg-muted px-1.5 font-sans text-[10px] font-medium text-muted-foreground sm:inline-flex"
      >
        {hint}
      </kbd>
    </Button>
  );
}
