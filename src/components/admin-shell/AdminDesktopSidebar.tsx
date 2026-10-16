'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  ChevronRight,
  Home,
  Moon,
  Search,
  Sun,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import {
  groupsForAllSides,
  groupsForSide,
  SHELL_SIDES,
  type ShellPlaceholderId,
  type ShellSideId,
  type ShellTabRef,
} from './shell-nav';
import { useShellTheme } from './use-shell-theme';

/** Wide enough for a 44px icon with the inset padding, at the 14.5px desktop root. */
export const SIDEBAR_ICON_WIDTH = '3.75rem';

const MENU_BUTTON = 'min-h-11 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-11! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!';

export function AdminDesktopSidebar({
  side,
  onSide,
  activeTab,
  placeholder,
  tabs,
  tenantName,
  logoUrl,
  onNavigate,
  onPlaceholder,
  accountMenu,
}: {
  side: ShellSideId;
  onSide: (side: ShellSideId) => void;
  activeTab: string;
  placeholder: ShellPlaceholderId | null;
  tabs: ReadonlyMap<string, ShellTabRef>;
  tenantName: string;
  logoUrl: string;
  onNavigate: (id: string) => void;
  onPlaceholder: (id: ShellPlaceholderId) => void;
  accountMenu: ReactNode;
}) {
  const groups = groupsForSide(side, tabs);
  const { resolved, toggle } = useShellTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openItem = (id: string, next: ShellPlaceholderId | null) => {
    setPaletteOpen(false);
    if (next) onPlaceholder(next);
    else onNavigate(id);
  };

  return (
    <Sidebar
      variant="inset"
      collapsible="icon"
      data-shell-side={side}
      className="bg-sidebar text-sidebar-foreground group-data-[collapsible=icon]:overflow-hidden group-data-[collapsible=icon]:p-1!"
    >
      <SidebarHeader className="gap-3 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
        <div className="flex items-center gap-2 px-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:px-0">
          <img src={logoUrl} alt="" className="size-8 shrink-0 object-contain" />
          <span className="min-w-0 flex-1 truncate font-display text-base font-semibold text-sidebar-foreground group-data-[collapsible=icon]:sr-only">
            {tenantName}
          </span>
          <SidebarTrigger className="relative z-20 ml-auto min-h-11 min-w-11 shrink-0 group-data-[collapsible=icon]:ml-0" />
        </div>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full justify-start gap-2 border-sidebar-border bg-sidebar px-3 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:size-11 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          onClick={() => setPaletteOpen(true)}
          aria-label="Search"
        >
          <Search />
          <span className="group-data-[collapsible=icon]:sr-only">Search</span>
        </Button>
        <ToggleGroup
          value={[side]}
          onValueChange={(next) => {
            const picked = next[0];
            if (picked === 'people' || picked === 'public') onSide(picked);
          }}
          spacing={0}
          className="w-full justify-center group-data-[collapsible=icon]:flex-col"
          aria-label="Sidebar side"
        >
          {SHELL_SIDES.map((meta) => {
            const Icon = meta.icon;
            return (
              <Tooltip key={meta.id}>
                <TooltipTrigger render={<span className="inline-flex" />}>
                  <ToggleGroupItem
                    value={meta.id}
                    aria-label={meta.label}
                    className="min-h-11 min-w-11"
                  >
                    <Icon />
                  </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent side="bottom">{meta.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </ToggleGroup>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={activeTab === 'dashboard' && placeholder === null}
                tooltip="Home"
                className={MENU_BUTTON}
                data-nav-tab="dashboard"
                onClick={() => onNavigate('dashboard')}
              >
                <Home />
                <span className="group-data-[collapsible=icon]:sr-only">Home</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {groups.map((group) => {
          const live = group.items.filter((item) => !item.placeholder);
          return (
          <Collapsible key={group.id} defaultOpen className="group/collapsible">
            <SidebarGroup
              className="group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0"
              {...(live.length > 0 ? {
                'data-nav-group': group.id,
                'data-nav-group-tabs': live.map((item) => item.id).join(','),
                'data-nav-group-labels': live.map((item) => item.entitlementLabel).join('|'),
              } : {})}
            >
              <SidebarGroupLabel
                className="group-data-[collapsible=icon]:hidden"
                render={<CollapsibleTrigger className="min-h-11 group-data-[collapsible=icon]:hidden" />}
              >
                <span>{group.label}</span>
                <ChevronRight className="ml-auto transition-transform group-data-open/collapsible:rotate-90 group-data-[collapsible=icon]:hidden" />
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = item.placeholder
                        ? placeholder === item.placeholder
                        : placeholder === null && activeTab === item.id;
                      return (
                        <SidebarMenuItem key={item.id}>
                          <SidebarMenuButton
                            isActive={isActive}
                            tooltip={item.label}
                            className={MENU_BUTTON}
                            data-nav-tab={item.placeholder ? undefined : item.id}
                            onClick={() => openItem(item.id, item.placeholder)}
                          >
                            <Icon />
                            <span className="group-data-[collapsible=icon]:sr-only">{item.label}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
          );
        })}
      </SidebarContent>

      <SidebarFooter className="group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full justify-start gap-2 border-sidebar-border bg-sidebar text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:size-11 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          onClick={toggle}
          aria-label={resolved === 'dark' ? 'Switch to light' : 'Switch to dark'}
          data-shell-theme={resolved}
        >
          {resolved === 'dark' ? <Sun /> : <Moon />}
          <span className="group-data-[collapsible=icon]:sr-only">
            {resolved === 'dark' ? 'Light' : 'Dark'}
          </span>
        </Button>
        <div className="flex w-full items-center group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:[&_[data-shell-account-label]]:sr-only">{accountMenu}</div>
      </SidebarFooter>

      <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen} title="Search" description="Jump to a section">
        <Command>
          <CommandInput placeholder="Search sections" />
          <CommandList>
            <CommandEmpty>No matching section.</CommandEmpty>
            <CommandGroup heading="Home">
              <CommandItem onSelect={() => openItem('dashboard', null)}>Home</CommandItem>
            </CommandGroup>
            {groupsForAllSides(tabs).map((group) => (
              <CommandGroup key={group.id} heading={group.label}>
                {group.items.map((item) => (
                  <CommandItem key={item.id} onSelect={() => openItem(item.id, item.placeholder)}>
                    {item.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </Sidebar>
  );
}
