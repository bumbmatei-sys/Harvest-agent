'use client';

import type { ComponentType } from 'react';

import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar';

export interface MemberSidebarItem {
  id: string;
  label: string;
  icon: ComponentType;
  isActive: boolean;
  onClick: () => void;
}

/** The icon rail plus the section card; the 8px either side is the inset margin. */
export const MEMBER_SIDEBAR_WIDTH = '372px';

/** Collapsed, only the rail stays. */
export const MEMBER_SIDEBAR_ICON_WIDTH = '88px';

/**
 * The admin rail's entry (AdminDesktopSidebar's MENU_BUTTON): 30px tall, 14px
 * label, 17px icons at stroke 1.7. Pixels, not rem, for the same trimmed root.
 */
const MENU_BUTTON = 'h-[30px] min-h-0 gap-2 rounded-lg py-0 pr-3 pl-2 text-[14px] font-normal text-sidebar-foreground data-active:font-normal [&_svg]:size-[17px] [&_svg]:stroke-[1.7]';

/** Eden's rail tile: icon over an 11px label, 64px wide, accent when active. */
const RAIL_TILE = 'h-auto min-h-11 w-16 flex-col gap-1 rounded-xl px-0 py-2 text-[11px] font-normal text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground sm:min-h-0 [&_svg]:size-5 [&_svg]:stroke-[1.7]';

const ICON_BUTTON = 'size-8 min-h-11 shrink-0 text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-accent-foreground sm:min-h-0 [&_svg]:size-[17px] [&_svg]:stroke-[1.7]';

function Rows({ items }: { items: MemberSidebarItem[] }) {
  return (
    <SidebarMenu className="gap-px">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <SidebarMenuItem key={item.id}>
            <SidebarMenuButton
              isActive={item.isActive}
              className={MENU_BUTTON}
              data-member-nav={item.id}
              onClick={item.onClick}
            >
              <Icon />
              <span>{item.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

/**
 * The member shell's desktop sidebar, after Eden's community screens: an icon
 * rail (sections that span communities, the current community, the member)
 * beside a card holding this community's own sections. Drawn with the admin's
 * inset Sidebar primitives so a community and its admin read as one product;
 * the page sits in the SidebarInset card. Collapsing keeps only the rail.
 */
export function MemberDesktopSidebar({
  name,
  logo,
  showHarvestDot,
  rail,
  groups,
  memberName,
  photo,
  initial,
  onProfile,
}: {
  name: string;
  logo: string;
  /** The gold period belongs to the "Harvest." lockup only. */
  showHarvestDot: boolean;
  /** Rail tiles: Events, Discover and Communities. */
  rail: MemberSidebarItem[];
  groups: { label: string; items: MemberSidebarItem[] }[];
  memberName: string;
  photo: string | null | undefined;
  initial: string;
  onProfile: () => void;
}) {
  return (
    <Sidebar variant="inset" collapsible="icon" data-member-sidebar className="p-[8px] text-sidebar-foreground">
      <div className="flex min-h-0 flex-1 gap-2">
        <nav aria-label="Member rail" data-member-rail className="flex w-16 shrink-0 flex-col items-center gap-1 py-1">
          {rail.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                key={item.id}
                type="button"
                variant="ghost"
                data-member-nav={item.id}
                data-active={item.isActive}
                aria-current={item.isActive ? 'page' : undefined}
                className={RAIL_TILE}
                onClick={item.onClick}
              >
                <Icon />
                <span>{item.label}</span>
              </Button>
            );
          })}
          <div className="my-2 h-px w-8 bg-sidebar-border" />
          {/* The community the member is in, marked like Eden's switcher. */}
          <div className="relative flex w-16 justify-center" title={name}>
            <span className="absolute top-1/2 left-0 h-6 w-1 -translate-y-1/2 rounded-r-full bg-sidebar-accent-foreground" />
            <img src={logo} alt="" className="logo-plate size-10 rounded-xl object-contain" />
          </div>
          <div className="mt-auto flex flex-col items-center gap-2 pb-1">
            <SidebarTrigger className={ICON_BUTTON} />
            <Button
              type="button"
              variant="ghost"
              onClick={onProfile}
              title="My Profile"
              aria-label={`My Profile, ${memberName}`}
              data-testid="member-sidebar-profile"
              className="size-9 min-h-11 min-w-11 overflow-hidden rounded-full bg-surface-sunken p-0 text-[13px] font-bold text-muted hover:opacity-90 sm:min-h-0 sm:min-w-0"
            >
              {photo ? <img src={photo} alt="" className="size-full object-cover" referrerPolicy="no-referrer" /> : <span>{initial}</span>}
            </Button>
          </div>
        </nav>

        <div data-member-sections className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-sidebar-border bg-card group-data-[collapsible=icon]:hidden">
          <SidebarHeader className="p-0">
            <div className="flex h-[56px] items-center gap-2 px-4">
              <img src={logo} alt={name} className="logo-plate size-7 shrink-0 rounded-lg object-contain" />
              <span className="min-w-0 flex-1 truncate font-display text-[17px] font-semibold text-sidebar-accent-foreground">
                {name}
                {showHarvestDot && <span style={{ color: 'var(--brand-color, #C9963A)' }}>.</span>}
              </span>
            </div>
          </SidebarHeader>
          <SidebarContent className="pt-1">
            {groups.map((group, index) => (
              // `data-nav-group` lets a test enumerate the groups the sidebar drew, by name.
              <SidebarGroup
                key={group.label}
                data-nav-group={group.label}
                className={`px-[13px] py-0 ${index > 0 ? 'mt-6' : ''}`}
              >
                {/* The admin's sentence-case heading, drawn in CSS so the label stays the group's name. */}
                <SidebarGroupLabel className="block h-6 px-2 text-[12px] leading-6 font-normal lowercase text-sidebar-foreground/70 first-letter:uppercase">
                  {group.label}
                </SidebarGroupLabel>
                <SidebarGroupContent><Rows items={group.items} /></SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>
        </div>
      </div>
      <SidebarRail />
    </Sidebar>
  );
}
