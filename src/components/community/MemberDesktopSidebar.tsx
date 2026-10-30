'use client';

import type { ComponentType } from 'react';

import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
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

/**
 * The admin rail's entry (AdminDesktopSidebar's MENU_BUTTON): 30px tall, 14px
 * label, 17px icons at stroke 1.7. Pixels, not rem, for the same trimmed root.
 */
const MENU_BUTTON = 'h-[30px] min-h-0 gap-2 rounded-lg py-0 pr-3 pl-2 text-[14px] font-normal text-sidebar-foreground data-active:font-normal [&_svg]:size-[17px] [&_svg]:stroke-[1.7] group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!';

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
              tooltip={item.label}
              className={MENU_BUTTON}
              data-member-nav={item.id}
              onClick={item.onClick}
            >
              <Icon />
              <span className="group-data-[collapsible=icon]:sr-only">{item.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

/**
 * The member shell's desktop sidebar, drawn with the same inset Sidebar
 * primitives as the admin dashboard so a community and its admin read as one
 * product. The page beside it sits in the SidebarInset card.
 */
export function MemberDesktopSidebar({
  name,
  logo,
  showHarvestDot,
  top,
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
  /** Communities and Discover: across every community the member belongs to. */
  top: MemberSidebarItem[];
  groups: { label: string; items: MemberSidebarItem[] }[];
  memberName: string;
  photo: string | null | undefined;
  initial: string;
  onProfile: () => void;
}) {
  return (
    <Sidebar variant="inset" collapsible="icon" data-member-sidebar className="p-[8px] text-sidebar-foreground">
      <SidebarHeader className="gap-1.5 p-0 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:py-2">
        <div className="flex h-[52px] items-center gap-1.5 pr-3 pl-4 group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:px-0">
          <img src={logo} alt={name} className="logo-plate size-6 shrink-0 object-contain" />
          <span className="min-w-0 flex-1 truncate font-display text-[17px] font-semibold text-sidebar-accent-foreground group-data-[collapsible=icon]:sr-only">
            {name}
            {showHarvestDot && <span style={{ color: 'var(--brand-color, #C9963A)' }}>.</span>}
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent className="pt-1">
        <SidebarGroup className="px-[13px] py-0 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
          <SidebarGroupContent><Rows items={top} /></SidebarGroupContent>
        </SidebarGroup>
        {groups.map((group) => (
          // `data-nav-group` lets a test enumerate the groups the sidebar drew, by name.
          <SidebarGroup
            key={group.label}
            data-nav-group={group.label}
            className="mt-6 px-[13px] py-0 group-data-[collapsible=icon]:mt-3 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0"
          >
            {/* The admin's sentence-case heading, drawn in CSS so the label stays the group's name. */}
            <SidebarGroupLabel className="block h-6 px-2 text-[12px] leading-6 font-normal lowercase text-sidebar-foreground/70 first-letter:uppercase group-data-[collapsible=icon]:hidden">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent><Rows items={group.items} /></SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="gap-1 p-0 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:py-2">
        <div className="flex h-[52px] items-center gap-2 pr-3 pl-4 group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:px-0">
          <Button
            type="button"
            variant="ghost"
            onClick={onProfile}
            title="My Profile"
            data-testid="member-sidebar-profile"
            className="h-auto min-h-11 min-w-0 flex-1 justify-start gap-2 rounded-lg p-0 text-left hover:bg-transparent sm:min-h-0 group-data-[collapsible=icon]:flex-none"
          >
            <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-sunken text-[13px] font-bold text-muted">
              {photo ? <img src={photo} alt="" className="size-full object-cover" referrerPolicy="no-referrer" /> : initial}
            </span>
            <span className="min-w-0 truncate text-[13px] font-medium text-sidebar-accent-foreground group-data-[collapsible=icon]:sr-only">
              {memberName}
            </span>
          </Button>
          <SidebarTrigger className={ICON_BUTTON} />
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
