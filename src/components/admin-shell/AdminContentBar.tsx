'use client';

import { NAV_ICONS } from '@/components/layout/nav-icons';

import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ExternalLink, Plus, Search } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { openAdminSearch } from './admin-search';

/** One step of the top bar's trail. A step with `onClick` is a link; the last step is the current page. */
export interface Crumb {
  readonly label: string;
  readonly onClick?: () => void;
}

/**
 * Desktop content toolbar: a clickable breadcrumb trail on the left; screen
 * actions, search and the Community menu on the right. There is no back
 * button: every parent in the trail is a link back to it. The sidebar collapse
 * button lives in the sidebar footer only. Mobile keeps AdminScreenHeader.
 */
export function AdminContentBar({
  crumbs,
  community,
  actions,
  trailing,
}: {
  crumbs: readonly Crumb[];
  /** The Community menu. */
  community?: ReactNode;
  actions?: ReactNode;
  /** Desktop-only extras in the right cluster, such as the payments inbox. */
  trailing?: ReactNode;
}) {
  const visible = crumbs.filter((crumb) => crumb.label);
  const lastIndex = visible.length - 1;
  return (
    <header
      data-admin-content-bar
      className="flex h-12 shrink-0 items-center gap-2 px-3"
    >
      <div className="flex min-w-0 items-center gap-1">
        <Breadcrumb>
          <BreadcrumbList className="flex-nowrap text-[13px]">
            {visible.map((crumb, index) => {
              const current = index === lastIndex;
              return (
                <Fragment key={`${index}-${crumb.label}`}>
                  <BreadcrumbItem className={current ? undefined : 'hidden sm:inline-flex'}>
                    {current ? (
                      <BreadcrumbPage className="max-w-[40vw] truncate font-medium text-foreground">
                        {crumb.label}
                      </BreadcrumbPage>
                    ) : crumb.onClick ? (
                      <BreadcrumbLink
                        render={<Button variant="link" type="button" onClick={crumb.onClick} />}
                        className="cursor-pointer text-muted-foreground"
                      >
                        {crumb.label}
                      </BreadcrumbLink>
                    ) : (
                      <span className="text-muted-foreground">{crumb.label}</span>
                    )}
                  </BreadcrumbItem>
                  {current ? null : <BreadcrumbSeparator className="hidden sm:inline-flex" />}
                </Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      {/* Right: screen action · search · notifications · account */}
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {actions}
        {trailing}
        <SearchPill />
        {community}
      </div>
    </header>
  );
}

/**
 * The Community menu. There is one community today, the ministry's default one,
 * and it is the member app: choosing it opens the app. New communities are a
 * product type that is not built yet, so "Create new community" is listed but
 * cannot be picked, the same way the product picker lists it as coming soon.
 *
 * ⚠️ The trigger is the native button Base UI renders, dressed with `buttonVariants`.
 * `render={<Button />}` hands `Menu.Positioner` a null ref on React 18, so the menu
 * opens at the page's top-left corner at `opacity: 0` and nobody can see it (THE-337's
 * paperclip had the same fault).
 */
export function CommunityMenu({ onOpenDefault }: { onOpenDefault: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-community-menu
        className={cn(buttonVariants({ variant: 'secondary' }), 'h-8 min-h-[44px] sm:min-h-0')}
      >
        <NAV_ICONS.communities />
        Community
        <ChevronDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Your communities</DropdownMenuLabel>
          <DropdownMenuItem data-community-default onClick={onOpenDefault}>
            <NAV_ICONS.communities />
            Default community
            <ExternalLink className="ml-auto" />
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled data-community-create>
          <Plus />
          Create new community
          <span className="ml-auto text-xs text-muted-foreground">Soon</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Same height as the Community button (`h-8`, 44px floor below `sm`). Full pill
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
