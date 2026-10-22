import {
  BrainCircuit,
  Building2,
  CalendarCheck,
  Church,
  ClipboardList,
  ContactRound,
  FileText,
  Globe,
  GraduationCap,
  HandCoins,
  Heart,
  Inbox,
  Library,
  Link2,
  ListChecks,
  Mail,
  MessageSquare,
  MessagesSquare,
  Newspaper,
  QrCode,
  Radio,
  Receipt,
  Share2,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';

/**
 * Phase 1 desktop sidebar.
 *
 * Two icon-only sides, matching Eden's workspace / store switch:
 *   people — people, care, giving records
 *   public — page, engage (forms, events, check-in), social, email, products
 *
 * Branding is not in the sidebar. It lives in Settings > Campus & branding.
 *
 * Every real entry is an existing admin tab id. Ministry page and Publish
 * stay out until those screens exist — a row that does not change the URL
 * leaves the header on the previous page. Newsletter and SMS stay out unless
 * the caller passes those tab ids, which is how the hidden-feature switches
 * already decide.
 */

export type ShellSideId = 'people' | 'public';

export type ShellPlaceholderId = 'church-page' | 'publish' | 'send-email';

export interface ShellTabRef {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

export interface ShellItem {
  readonly id: string;
  readonly label: string;
  /** The word entitlement tests already scan for, when the visible label differs. */
  readonly entitlementLabel: string;
  readonly icon: LucideIcon;
  readonly placeholder: ShellPlaceholderId | null;
}

export interface ShellGroup {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly items: readonly ShellItem[];
}

export interface ShellSideMeta {
  readonly id: ShellSideId;
  readonly label: string;
  readonly icon: LucideIcon;
}

export const SHELL_SIDES: readonly ShellSideMeta[] = [
  // ContactRound, not Users: CRM already uses Users, and both sit on screen together.
  { id: 'people', label: 'People', icon: ContactRound },
  { id: 'public', label: 'Public', icon: Globe },
];

interface ItemTemplate {
  readonly id: string;
  readonly label: string;
  readonly entitlementLabel?: string;
  readonly icon: LucideIcon;
  readonly placeholder?: ShellPlaceholderId;
}

interface GroupTemplate {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly items: readonly ItemTemplate[];
}

const PEOPLE_GROUPS: readonly GroupTemplate[] = [
  {
    id: 'people',
    label: 'People',
    icon: Users,
    items: [
      { id: 'crm', label: 'CRM', icon: Users },
      { id: 'signups', label: 'Signups', icon: UserPlus },
      { id: 'churches', label: 'Campuses', icon: Church },
    ],
  },
  {
    id: 'care',
    label: 'Care',
    icon: Heart,
    items: [
      { id: 'community', label: 'Community', icon: MessagesSquare },
      { id: 'services', label: 'Services', icon: ListChecks },
      { id: 'docs', label: 'Notes', icon: FileText },
    ],
  },
  {
    id: 'giving',
    label: 'Giving',
    icon: HandCoins,
    items: [
      { id: 'fundraising', label: 'Fundraising', icon: Heart },
      { id: 'donations', label: 'Donations', icon: HandCoins },
      { id: 'accounting', label: 'Accounting', icon: Receipt },
    ],
  },
  {
    id: 'platform',
    label: 'Platform',
    icon: Building2,
    items: [
      { id: 'library', label: 'Library', icon: Library },
      { id: 'tenants', label: 'Tenants', icon: Building2 },
      { id: 'inbox', label: 'Platform Inbox', entitlementLabel: 'Platform Inbox', icon: Inbox },
      { id: 'affiliate', label: 'Affiliate', icon: Link2 },
    ],
  },
];

const PUBLIC_GROUPS: readonly GroupTemplate[] = [
  {
    id: 'page',
    label: 'Page',
    icon: FileText,
    items: [
      { id: 'blog', label: 'Blog', icon: Newspaper },
      { id: 'ai', label: 'AI Knowledge', icon: BrainCircuit },
    ],
  },
  {
    id: 'engage',
    label: 'Engage',
    icon: CalendarCheck,
    items: [
      { id: 'forms', label: 'Forms', icon: ClipboardList },
      { id: 'events', label: 'Events', icon: CalendarCheck },
      { id: 'checkin', label: 'Check-In', icon: QrCode },
    ],
  },
  {
    id: 'social',
    label: 'Channels',
    icon: Radio,
    items: [
      { id: 'social', label: 'Social', icon: Share2 },
      { id: 'livestream', label: 'Livestream', icon: Radio },
      { id: 'sms', label: 'SMS', icon: MessageSquare },
    ],
  },
  {
    id: 'email',
    label: 'Email',
    icon: Mail,
    items: [{ id: 'newsletter', label: 'Newsletter', icon: Mail }],
  },
  {
    id: 'products',
    label: 'Products',
    icon: GraduationCap,
    items: [{ id: 'courses', label: 'Courses', icon: GraduationCap }],
  },
];

const GROUPS_BY_SIDE: Record<ShellSideId, readonly GroupTemplate[]> = {
  people: PEOPLE_GROUPS,
  public: PUBLIC_GROUPS,
};

const PUBLIC_TAB_IDS = new Set(
  PUBLIC_GROUPS.flatMap((group) => group.items.map((item) => item.id)),
);

const SECTION_BY_TAB = new Map<string, string>(
  [...PEOPLE_GROUPS, ...PUBLIC_GROUPS].flatMap((group) =>
    group.items.map((item) => [item.id, group.label] as const),
  ),
);

/**
 * Sidebar group for a route, used as the breadcrumb section.
 * Home (`dashboard`) is pinned above the groups, so it has no section.
 */
export function sectionForTab(tabId: string): string | null {
  return SECTION_BY_TAB.get(tabId) ?? null;
}

/**
 * Which side a tab belongs on.
 *
 * `dashboard` returns null so opening Home does not yank the sidebar from
 * the side the admin was just using. Home is pinned at the top of both.
 *
 * Social is the same. It is listed on the public side, but the route must
 * not switch the sidebar: a reload of `/admin/social` was reading this map
 * and landing on Blog and Branding. The side changes only when the admin
 * toggles it, or opens a tab that actually belongs to the other side.
 */
export function sideForTab(tabId: string): ShellSideId | null {
  if (tabId === 'dashboard' || tabId === 'social') return null;
  if (PUBLIC_TAB_IDS.has(tabId)) return 'public';
  return 'people';
}

export function groupsForSide(
  side: ShellSideId,
  tabs: ReadonlyMap<string, ShellTabRef>,
): ShellGroup[] {
  const groups: ShellGroup[] = [];
  for (const template of GROUPS_BY_SIDE[side]) {
    const items: ShellItem[] = [];
    for (const item of template.items) {
      if (item.placeholder) {
        items.push({
          id: item.id,
          label: item.label,
          entitlementLabel: item.entitlementLabel ?? item.label,
          icon: item.icon,
          placeholder: item.placeholder,
        });
        continue;
      }
      const tab = tabs.get(item.id);
      if (!tab) continue;
      items.push({
        id: tab.id,
        label: tab.label,
        entitlementLabel: item.entitlementLabel ?? tab.label,
        // The shell owns the glyph. Callers often pass one shared icon, and
        // using that would paint CRM, Campuses, Community and the rest alike.
        icon: item.icon,
        placeholder: null,
      });
    }
    if (items.length > 0) {
      groups.push({ id: template.id, label: template.label, icon: template.icon, items });
    }
  }
  return groups;
}

/** Both sides, for the entitlement catalogue and the command palette. */
export function groupsForAllSides(tabs: ReadonlyMap<string, ShellTabRef>): ShellGroup[] {
  return [...groupsForSide('people', tabs), ...groupsForSide('public', tabs)];
}

export const PLACEHOLDER_COPY: Record<ShellPlaceholderId, { title: string; body: string }> = {
  'church-page': {
    title: 'Ministry page',
    body: 'The public page editor is not in this version. Service times, events, and giving links stay where they already are.',
  },
  publish: {
    title: 'Publish',
    body: 'Scheduling a post is not in this version. Nothing is sent from here.',
  },
  'send-email': {
    title: 'Send an email',
    body: 'Sending email from here is not available. Nothing is sent, and this screen does not open a newsletter.',
  },
};
