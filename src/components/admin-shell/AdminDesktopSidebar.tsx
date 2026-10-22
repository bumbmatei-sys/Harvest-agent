'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  ChevronRight,
  Home,
  Moon,
  Share2,
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
  SidebarRail,
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
import { isAdminSearchHotkeyClaimed, subscribeAdminSearch } from './admin-search';
import { useShellTheme } from './use-shell-theme';

/** Collapsed card is this wide plus the 8px margins; a 36px icon sits inside with room to spare. */
export const SIDEBAR_ICON_WIDTH = '52px';

/** The full card is 260px plus the 8px margin either side, which is what the primitive's width var counts. */
export const SIDEBAR_WIDTH = '276px';

/**
 * Eden's entry: 30px tall, 8px left / 12px right, an 8px icon gap, 14px label at weight 400
 * in neutral-600, 17px icons at stroke 1.7. Pixels, not rem: the desktop root is trimmed to
 * 14.5px, which would turn a 14px label into 12.7px.
 */
const MENU_BUTTON = 'h-[30px] min-h-0 gap-2 rounded-lg py-0 pr-3 pl-2 text-[14px] font-normal text-sidebar-foreground data-active:font-normal [&_svg]:size-[17px] [&_svg]:stroke-[1.7] group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!';

const ICON_BUTTON = 'size-8 min-h-11 shrink-0 text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-accent-foreground sm:min-h-0 [&_svg]:size-[17px] [&_svg]:stroke-[1.7]';

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
  accountLabel,
  footerExtra,
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
  /** Name beside the avatar. Hidden when the rail is collapsed to icons. */
  accountLabel?: string;
  /** Desktop-only footer icons (inbox, theme stays separate). */
  footerExtra?: ReactNode;
}) {
  const groups = groupsForSide(side, tabs);
  const social = tabs.get('social');
  const socialInGroups = groups.some((group) => group.items.some((item) => item.id === 'social'));
  // Branding is not a sidebar group: Settings owns it. The row appears only
  // when the tab is still in the map, which is the branding-only admin who
  // cannot open Settings.
  const branding = tabs.get('branding');
  const brandingInGroups = groups.some((group) => group.items.some((item) => item.id === 'branding'));
  const BrandingIcon = branding?.icon;
  const { resolved, toggle } = useShellTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const open = () => setPaletteOpen(true);
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        if (isAdminSearchHotkeyClaimed()) return;
        event.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    const unsub = subscribeAdminSearch(open);
    return () => {
      window.removeEventListener('keydown', onKey);
      unsub();
    };
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
      className="p-[8px] text-sidebar-foreground"
    >
      <SidebarHeader className="gap-1.5 p-0 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:py-2">
        <div className="flex h-[52px] items-center gap-1.5 pr-3 pl-4 group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:px-0">
          <img src={logoUrl} alt="" className="size-6 shrink-0 object-contain" />
          <span className="min-w-0 flex-1 truncate font-display text-[17px] font-semibold text-sidebar-accent-foreground group-data-[collapsible=icon]:sr-only">
            {tenantName}
          </span>
          <ToggleGroup
            value={[side]}
            onValueChange={(next) => {
              const picked = next[0];
              if (picked === 'people' || picked === 'public') onSide(picked);
            }}
            spacing={0}
            className="h-8 w-[70px] shrink-0 gap-0 rounded-lg bg-seg-track p-0.5 group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:w-9 group-data-[collapsible=icon]:flex-col"
            aria-label="Sidebar side"
          >
            {SHELL_SIDES.map((meta) => {
              const Icon = meta.icon;
              return (
                <Tooltip key={meta.id}>
                  <TooltipTrigger render={<span className="inline-flex flex-1" />}>
                    <ToggleGroupItem
                      value={meta.id}
                      aria-label={meta.label}
                      className="h-7 min-h-0 min-w-0 flex-1 rounded-md px-0 text-sidebar-foreground aria-pressed:bg-seg-active aria-pressed:text-sidebar-accent-foreground aria-pressed:shadow-seg data-pressed:bg-seg-active data-pressed:text-sidebar-accent-foreground data-pressed:shadow-seg [&_svg]:size-[15px] [&_svg]:stroke-[1.7]"
                    >
                      <Icon />
                    </ToggleGroupItem>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{meta.label}</TooltipContent>
                </Tooltip>
              );
            })}
          </ToggleGroup>
        </div>
      </SidebarHeader>

      <SidebarContent className="pt-1">
        <SidebarGroup className="px-[13px] py-0 group-data-[collapsible=icon]:px-0">
          <SidebarMenu className="gap-px">
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
            {social && !socialInGroups && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeTab === 'social' && placeholder === null}
                  tooltip="Social"
                  className={MENU_BUTTON}
                  data-nav-tab="social"
                  onClick={() => onNavigate('social')}
                >
                  <Share2 />
                  <span className="group-data-[collapsible=icon]:sr-only">Social</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            {BrandingIcon && branding && !brandingInGroups && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeTab === 'branding' && placeholder === null}
                  tooltip={branding.label}
                  className={MENU_BUTTON}
                  data-nav-tab="branding"
                  onClick={() => onNavigate('branding')}
                >
                  <BrandingIcon />
                  <span className="group-data-[collapsible=icon]:sr-only">{branding.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarGroup>

        {groups.map((group) => {
          const live = group.items.filter((item) => !item.placeholder);
          return (
          <Collapsible key={group.id} defaultOpen className="group/collapsible">
            <SidebarGroup
              className="mt-6 px-[13px] py-0 group-data-[collapsible=icon]:mt-3 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0"
              {...(live.length > 0 ? {
                'data-nav-group': group.id,
                'data-nav-group-tabs': live.map((item) => item.id).join(','),
                'data-nav-group-labels': live.map((item) => item.entitlementLabel).join('|'),
              } : {})}
            >
              <SidebarGroupLabel
                className="h-6 gap-1 px-2 text-[12px] font-normal text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden"
                render={<CollapsibleTrigger className="group-data-[collapsible=icon]:hidden" />}
              >
                <span>{group.label}</span>
                <ChevronRight className="size-[11px]! transition-transform group-data-open/collapsible:rotate-90 group-data-[collapsible=icon]:hidden" />
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu className="gap-px">
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

      <SidebarFooter className="gap-1 p-0 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:py-2">
        <div className="flex h-[52px] items-center gap-1 pr-3 pl-4 group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:px-0">
          <div className="flex min-w-0 flex-1 items-center gap-2 group-data-[collapsible=icon]:flex-none [&_[data-nav-rail-account]>button]:size-8 [&_[role=menu]]:bottom-8! [&_[data-shell-account-label]]:truncate group-data-[collapsible=icon]:[&_[data-shell-account-label]]:sr-only">
            {accountMenu}
            {accountLabel ? (
              <span data-shell-account-label className="min-w-0 truncate text-[13px] font-medium text-sidebar-accent-foreground">
                {accountLabel}
              </span>
            ) : null}
          </div>
          {footerExtra}
          <div className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col">
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={ICON_BUTTON}
                  onClick={toggle}
                  aria-label={resolved === 'dark' ? 'Switch to light' : 'Switch to dark'}
                  data-shell-theme={resolved}
                >
                  {resolved === 'dark' ? <Sun /> : <Moon />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{resolved === 'dark' ? 'Light' : 'Dark'}</TooltipContent>
            </Tooltip>
            <SidebarTrigger className={ICON_BUTTON} />
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />

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
