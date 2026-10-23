import {
  BookOpen,
  BrainCircuit,
  CalendarCheck,
  Church,
  Compass,
  ClipboardList,
  FileText,
  GraduationCap,
  Heart,
  ListChecks,
  Mail,
  MessageSquare,
  Newspaper,
  QrCode,
  Users,
  type LucideIcon,
} from 'lucide-react';

import type { ContentTypeId } from './types';

export interface ContentTypeMeta {
  /** The group heading. */
  readonly label: string;
  /** Lower-case plural, for "See all 12 notes". */
  readonly plural: string;
  readonly icon: LucideIcon;
  /** The admin tab that lists this type. Also the permission and plan gate: no tab, no results. */
  readonly tab: string;
  /**
   * True when the tab's screen opens one item from `/admin/<slug>/<id>`. The
   * other screens open from their own list state and ignore an id, so a hit of
   * those types lands on the list page rather than on a URL that would only
   * look deep.
   */
  readonly deepLink: boolean;
}

export const CONTENT_TYPES: Readonly<Record<ContentTypeId, ContentTypeMeta>> = {
  // Pages are the admin's own sections, not content: they open by tab and are never read from Firestore.
  page: { label: 'Pages', plural: 'pages', icon: Compass, tab: 'dashboard', deepLink: false },
  person: { label: 'People', plural: 'people', icon: Users, tab: 'crm', deepLink: true },
  subscriber: { label: 'Subscribers', plural: 'subscribers', icon: Mail, tab: 'newsletter', deepLink: false },
  note: { label: 'Notes', plural: 'notes', icon: FileText, tab: 'docs', deepLink: true },
  course: { label: 'Courses', plural: 'courses', icon: GraduationCap, tab: 'courses', deepLink: false },
  lesson: { label: 'Lessons', plural: 'lessons', icon: BookOpen, tab: 'courses', deepLink: false },
  event: { label: 'Events', plural: 'events', icon: CalendarCheck, tab: 'events', deepLink: false },
  form: { label: 'Forms', plural: 'forms', icon: ClipboardList, tab: 'forms', deepLink: false },
  post: { label: 'Blog posts', plural: 'blog posts', icon: Newspaper, tab: 'blog', deepLink: false },
  service: { label: 'Services', plural: 'services', icon: ListChecks, tab: 'services', deepLink: false },
  campaign: { label: 'Fundraising', plural: 'campaigns', icon: Heart, tab: 'fundraising', deepLink: true },
  community: { label: 'Communities', plural: 'communities', icon: MessageSquare, tab: 'community', deepLink: false },
  campus: { label: 'Campuses', plural: 'campuses', icon: Church, tab: 'churches', deepLink: false },
  knowledge: { label: 'AI knowledge', plural: 'knowledge sources', icon: BrainCircuit, tab: 'ai', deepLink: false },
  checkin: { label: 'Check-in', plural: 'check-in sessions', icon: QrCode, tab: 'checkin', deepLink: false },
};

/** Group order in the palette. Pages first, then content. */
export const CONTENT_TYPE_ORDER: readonly ContentTypeId[] = [
  'page',
  'person',
  'subscriber',
  'note',
  'course',
  'lesson',
  'event',
  'form',
  'post',
  'service',
  'campaign',
  'community',
  'campus',
  'knowledge',
  'checkin',
];
