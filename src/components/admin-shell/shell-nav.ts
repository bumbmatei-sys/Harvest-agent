import {
  Building2,
  CalendarCheck,
  FileText,
  Globe,
  GraduationCap,
  HandCoins,
  Heart,
  Mail,
  QrCode,
  Radio,
  Users,
  type LucideIcon,
} from 'lucide-react';

/**
 * Phase 1 desktop sidebar.
 *
 * Two icon-only sides, matching Eden's workspace / store switch:
 *   people — people, care, events, check-in, giving records
 *   public — page, social, email, products
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
  { id: 'people', label: 'People', icon: Users },
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
      { id: 'signups', label: 'Signups', icon: Users },
      { id: 'churches', label: 'Campuses', icon: Building2 },
    ],
  },
  {
    id: 'care',
    label: 'Care',
    icon: Heart,
    items: [
      { id: 'community', label: 'Community', icon: Heart },
      { id: 'services', label: 'Services', icon: Heart },
      { id: 'docs', label: 'Notes', icon: FileText },
      { id: 'forms', label: 'Forms', icon: FileText },
    ],
  },
  {
    id: 'events',
    label: 'Events',
    icon: CalendarCheck,
    items: [{ id: 'events', label: 'Events', icon: CalendarCheck }],
  },
  {
    id: 'check-in',
    label: 'Check-in',
    icon: QrCode,
    items: [{ id: 'checkin', label: 'Check-In', icon: QrCode }],
  },
  {
    id: 'giving',
    label: 'Giving',
    icon: HandCoins,
    items: [
      { id: 'fundraising', label: 'Fundraising', icon: Heart },
      { id: 'donations', label: 'Donations', icon: HandCoins },
      { id: 'accounting', label: 'Accounting', icon: HandCoins },
    ],
  },
  {
    id: 'platform',
    label: 'Platform',
    icon: Building2,
    items: [
      { id: 'library', label: 'Library', icon: Building2 },
      { id: 'tenants', label: 'Tenants', icon: Building2 },
      { id: 'inbox', label: 'Platform Inbox', entitlementLabel: 'Platform Inbox', icon: Building2 },
      { id: 'affiliate', label: 'Affiliate', icon: Building2 },
    ],
  },
];

const PUBLIC_GROUPS: readonly GroupTemplate[] = [
  {
    id: 'page',
    label: 'Page',
    icon: FileText,
    items: [
      { id: 'blog', label: 'Blog', icon: FileText },
      { id: 'branding', label: 'Branding', icon: FileText },
      { id: 'ai', label: 'AI Knowledge', icon: FileText },
    ],
  },
  {
    id: 'social',
    label: 'Social',
    icon: Radio,
    items: [
      { id: 'social', label: 'Social', icon: Radio },
      { id: 'livestream', label: 'Livestream', icon: Radio },
      { id: 'sms', label: 'SMS', icon: Radio },
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

/**
 * Which side a tab belongs on.
 *
 * `dashboard` returns null so opening Home does not yank the sidebar from
 * the side the admin was just using. Home is pinned at the top of both.
 */
export function sideForTab(tabId: string): ShellSideId | null {
  if (tabId === 'dashboard') return null;
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
        icon: tab.icon,
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
