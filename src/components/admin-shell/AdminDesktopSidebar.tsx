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

const MENU_BUTTON = 'min-h-11 group-data-[collapsible=icon]:size-11!';

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
    <Sidebar variant="inset" collapsible="icon" data-shell-side={side}>
      <SidebarHeader className="gap-3">
        <div className="flex items-center gap-2 px-1 group-data-[collapsible=icon]:justify-center">
          <img src={logoUrl} alt="" className="size-8 shrink-0 object-contain" />
          <span className="truncate font-display text-base font-semibold text-sidebar-foreground group-data-[collapsible=icon]:hidden">
            {tenantName}
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full justify-start gap-2 px-3 group-data-[collapsible=icon]:size-11 group-data-[collapsible=icon]:px-0"
          onClick={() => setPaletteOpen(true)}
          aria-label="Search"
        >
          <Search />
          <span className="group-data-[collapsible=icon]:hidden">Search</span>
        </Button>
        <ToggleGroup
          value={[side]}
          onValueChange={(next) => {
            const picked = next[0];
            if (picked === 'people' || picked === 'public') onSide(picked);
          }}
          spacing={0}
          className="w-full justify-center"
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
                <span>Home</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {groups.map((group) => {
          const live = group.items.filter((item) => !item.placeholder);
          return (
          <Collapsible key={group.id} defaultOpen className="group/collapsible">
            <SidebarGroup
              {...(live.length > 0 ? {
                'data-nav-group': group.id,
                'data-nav-group-tabs': live.map((item) => item.id).join(','),
                'data-nav-group-labels': live.map((item) => item.entitlementLabel).join('|'),
              } : {})}
            >
              <SidebarGroupLabel
                render={<CollapsibleTrigger className="min-h-11" />}
              >
                <span>{group.label}</span>
                <ChevronRight className="ml-auto transition-transform group-data-open/collapsible:rotate-90" />
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
                            <span>{item.label}</span>
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

      <SidebarFooter>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full justify-start gap-2"
          onClick={toggle}
          aria-label={resolved === 'dark' ? 'Switch to light' : 'Switch to dark'}
          data-shell-theme={resolved}
        >
          {resolved === 'dark' ? <Sun /> : <Moon />}
          <span className="group-data-[collapsible=icon]:hidden">
            {resolved === 'dark' ? 'Light' : 'Dark'}
          </span>
        </Button>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">{accountMenu}</div>
          <SidebarTrigger className="min-h-11 min-w-11" />
        </div>
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
