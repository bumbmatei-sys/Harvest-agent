import { mergeContactsWithUsers } from '@/lib/crm-merge';
import type { Contact } from '@/hooks/queries/useCRMQueries';
import { formatFirestoreDate, UNPARSEABLE_DATE } from '@/utils/firestore-date';
import { tsMillis } from '@/utils/query-helpers';

import { plainPreview } from './normalize';
import type { SearchEntry, SourceResult } from './types';

/**
 * Where the palette's content comes from.
 *
 * Every source is a plain read the signed-in admin could already make from the
 * screen that owns the data, so firestore.rules decide what comes back and no
 * rule, index or server route is involved. A source is switched on by the
 * admin tab it belongs to (`access`): the dashboard builds that list from the
 * same permission and plan checks that decide which tabs exist, so an admin who
 * has no Notes tab gets no notes, and a plan that hides Forms hides form
 * results with it.
 *
 * Reads are capped, ordered by document id (an unordered `limit` returns
 * arbitrary rows), and ask for one document more than the cap so the palette can
 * say, exactly, that a list was only partly searched.
 */

/** One Firestore collection read. The path is built per tenant by the source. */
export interface ReadSpec {
  readonly path: readonly string[];
  /**
   * True for a top-level collection that carries a `tenantId` field. Those reads
   * add `where('tenantId', '==', tenant)`; the rules need it to prove the list
   * readable, and the loader drops any document that still disagrees.
   */
  readonly byTenantField: boolean;
  readonly cap: number;
}

export interface RawDoc {
  readonly id: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface ReadResult {
  readonly docs: readonly RawDoc[];
  /** More documents matched than `cap`. */
  readonly truncated: boolean;
}

export type ReadDocs = (spec: ReadSpec, tenantId: string) => Promise<ReadResult>;

export interface LoadContext {
  readonly tenantId: string;
  readonly read: ReadDocs;
}

export interface ContentSource {
  readonly id: string;
  /** Heading used when this source could not be searched. */
  readonly label: string;
  /** Tab ids the viewer holds. The source runs only when this says so. */
  readonly enabled: (access: ReadonlySet<string>) => boolean;
  readonly load: (ctx: LoadContext) => Promise<SourceResult>;
}

/** Documents read per collection on a cold open. The sum of these is the worst case. */
export const READ_CAPS = {
  contacts: 500,
  users: 500,
  docs: 300,
  courses: 200,
  events: 200,
  forms: 200,
  blogPosts: 200,
  servicePlans: 200,
  campaigns: 100,
  channels: 100,
  churches: 100,
  ragSources: 200,
  checkinSessions: 100,
} as const;

// ── Small, total field readers: a malformed document yields '' or null, never a throw ──

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : [];

/** Milliseconds, or null. `tsMillis` answers MAX_SAFE_INTEGER for "no value". */
function millis(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  try {
    const ms = tsMillis(value as never);
    return Number.isFinite(ms) && ms < Number.MAX_SAFE_INTEGER ? ms : null;
  } catch {
    return null;
  }
}

const join = (parts: readonly string[], sep = ' · '): string => parts.filter(Boolean).join(sep);

const day = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const text = formatFirestoreDate(value as never);
  return text === UNPARSEABLE_DATE ? '' : text;
};

/**
 * Documents that belong to `tenantId`. The query already says so; this is the
 * second lock on the same door, so a read that somehow returned another
 * ministry's document (a stale cache, a mis-scoped helper, a rule gap) still
 * cannot put it in the palette.
 */
function ownedBy(tenantId: string, docs: readonly RawDoc[]): RawDoc[] {
  return docs.filter((d) => d.data.tenantId === tenantId);
}

const topLevel = (name: string, cap: number): ReadSpec => ({ path: [name], byTenantField: true, cap });
const underTenant = (tenantId: string, name: string, cap: number): ReadSpec => ({
  path: ['tenants', tenantId, name],
  byTenantField: false,
  cap,
});

const done = (entries: SearchEntry[], truncated: boolean): SourceResult => ({ entries, truncated });

// ── People ──────────────────────────────────────────────────────────────────

function personEntry(c: Contact): SearchEntry {
  const name = join([str(c.firstName), str(c.lastName)], ' ');
  const email = str(c.email);
  const phone = str(c.phone);
  // The first thing a person has is the title; the next one is the subtitle.
  const [first, second] = [name, email, phone].filter(Boolean);
  return {
    type: 'person',
    id: c.id,
    title: first || 'Unnamed person',
    subtitle: second ?? '',
    // Email and phone are matched, never shown beyond the one subtitle. Notes,
    // tags, addresses and giving totals are not read into the index at all.
    extra: [email, phone],
    updatedAt: millis(c.updatedAt),
    itemId: c.id,
  };
}

/** The CRM list, built the way the CRM builds it: contacts, plus app members who have no contact row. */
async function loadPeople({ tenantId, read }: LoadContext): Promise<SourceResult> {
  const [contacts, users] = await Promise.all([
    read(topLevel('contacts', READ_CAPS.contacts), tenantId),
    read(topLevel('users', READ_CAPS.users), tenantId),
  ]);
  const contactRows = ownedBy(tenantId, contacts.docs).map((d) => ({ id: d.id, ...d.data }) as unknown as Contact);
  const userRows = ownedBy(tenantId, users.docs).map((d) => ({ id: d.id, data: d.data as Record<string, unknown> }));
  const merged = mergeContactsWithUsers(contactRows, userRows as never, tenantId);
  return done(merged.map(personEntry), contacts.truncated || users.truncated);
}

/** For a viewer who has the Newsletter tab but not the CRM: only the people who opted in to email. */
async function loadSubscribers({ tenantId, read }: LoadContext): Promise<SourceResult> {
  const contacts = await read(topLevel('contacts', READ_CAPS.contacts), tenantId);
  const entries = ownedBy(tenantId, contacts.docs)
    .filter((d) => d.data.emailStatus === 'subscribed')
    .map((d) => ({ ...personEntry({ id: d.id, ...d.data } as unknown as Contact), type: 'subscriber' as const }));
  return done(entries, contacts.truncated);
}

// ── Notes ───────────────────────────────────────────────────────────────────

async function loadNotes({ tenantId, read }: LoadContext): Promise<SourceResult> {
  const res = await read(topLevel('docs', READ_CAPS.docs), tenantId);
  const entries = ownedBy(tenantId, res.docs).map((d): SearchEntry => {
    const preview = plainPreview(d.data.content, 300);
    return {
      type: 'note',
      id: d.id,
      title: str(d.data.title) || 'Untitled',
      subtitle: preview.slice(0, 90),
      extra: preview ? [preview] : [],
      updatedAt: millis(d.data.updatedAt) ?? millis(d.data.createdAt),
      itemId: d.id,
    };
  });
  return done(entries, res.truncated);
}

// ── Courses and their lessons ───────────────────────────────────────────────

interface OutlineLesson {
  id: string;
  title: string;
}

/** Lesson titles from a course's outline. The course document holds the outline; lesson content lives elsewhere and is never read. */
function outlineLessons(levels: unknown): OutlineLesson[] {
  const out: OutlineLesson[] = [];
  if (!Array.isArray(levels)) return out;
  for (const level of levels) {
    const sections = (level as { sections?: unknown } | null)?.sections;
    if (!Array.isArray(sections)) continue;
    for (const section of sections) {
      const lessons = (section as { lessons?: unknown } | null)?.lessons;
      if (!Array.isArray(lessons)) continue;
      for (const lesson of lessons) {
        const title = str((lesson as { title?: unknown } | null)?.title);
        const id = str((lesson as { id?: unknown } | null)?.id);
        if (title && id) out.push({ id, title });
      }
    }
  }
  return out;
}

async function loadCourses({ tenantId, read }: LoadContext): Promise<SourceResult> {
  const res = await read(topLevel('courses', READ_CAPS.courses), tenantId);
  const entries: SearchEntry[] = [];
  for (const d of ownedBy(tenantId, res.docs)) {
    const title = str(d.data.title) || 'Untitled course';
    const lessons = outlineLessons(d.data.levels);
    const updatedAt = millis(d.data.updatedAt) ?? millis(d.data.createdAt);
    entries.push({
      type: 'course',
      id: d.id,
      title,
      subtitle: join([
        d.data.status === 'published' ? 'Published' : 'Draft',
        lessons.length ? `${lessons.length} ${lessons.length === 1 ? 'lesson' : 'lessons'}` : '',
      ]),
      extra: [str(d.data.tagline), plainPreview(d.data.description, 200)].filter(Boolean),
      updatedAt,
      itemId: d.id,
    });
    for (const lesson of lessons) {
      entries.push({ type: 'lesson', id: `${d.id}/${lesson.id}`, title: lesson.title, subtitle: title, updatedAt, itemId: d.id });
    }
  }
  return done(entries, res.truncated);
}

// ── Events, services, forms, check-in ───────────────────────────────────────

async function loadEvents({ tenantId, read }: LoadContext): Promise<SourceResult> {
  const res = await read(underTenant(tenantId, 'events', READ_CAPS.events), tenantId);
  const entries = res.docs.map((d): SearchEntry => ({
    type: 'event',
    id: d.id,
    title: str(d.data.title) || 'Untitled event',
    subtitle: join([day(d.data.startDate), str(d.data.location)]),
    extra: [str(d.data.location), plainPreview(d.data.description, 200)].filter(Boolean),
    updatedAt: millis(d.data.startDate) ?? millis(d.data.createdAt),
    itemId: d.id,
  }));
  return done(entries, res.truncated);
}

async function loadServices({ tenantId, read }: LoadContext): Promise<SourceResult> {
  const res = await read(underTenant(tenantId, 'servicePlans', READ_CAPS.servicePlans), tenantId);
  const entries = res.docs.map((d): SearchEntry => ({
    type: 'service',
    id: d.id,
    title: str(d.data.name) || 'Untitled service',
    subtitle: d.data.isTemplate === true ? 'Template' : day(d.data.startAt) || 'Service',
    updatedAt: millis(d.data.startAt) ?? millis(d.data.createdAt),
    itemId: d.id,
  }));
  return done(entries, res.truncated);
}

async function loadForms({ tenantId, read }: LoadContext): Promise<SourceResult> {
  const res = await read(underTenant(tenantId, 'forms', READ_CAPS.forms), tenantId);
  const entries = res.docs.map((d): SearchEntry => {
    const description = plainPreview(d.data.description, 200);
    return {
      type: 'form',
      id: d.id,
      title: str(d.data.title) || 'Untitled form',
      subtitle: description.slice(0, 90),
      extra: description ? [description] : [],
      updatedAt: millis(d.data.createdAt),
      itemId: d.id,
    };
  });
  return done(entries, res.truncated);
}

async function loadCheckin({ tenantId, read }: LoadContext): Promise<SourceResult> {
  const res = await read(underTenant(tenantId, 'checkinSessions', READ_CAPS.checkinSessions), tenantId);
  const entries = res.docs.map((d): SearchEntry => ({
    type: 'checkin',
    id: d.id,
    title: str(d.data.name) || 'Check-in session',
    subtitle: join([day(d.data.date), str(d.data.location)]),
    extra: [str(d.data.location)].filter(Boolean),
    updatedAt: millis(d.data.date) ?? millis(d.data.createdAt),
    itemId: d.id,
  }));
  return done(entries, res.truncated);
}

// ── Blog, fundraising, communities, campuses, knowledge ─────────────────────

async function loadPosts({ tenantId, read }: LoadContext): Promise<SourceResult> {
  const res = await read(topLevel('blog_posts', READ_CAPS.blogPosts), tenantId);
  const entries = ownedBy(tenantId, res.docs).map((d): SearchEntry => {
    const status = str(d.data.status);
    const category = str(d.data.category);
    return {
      type: 'post',
      id: d.id,
      title: str(d.data.title) || 'Untitled post',
      subtitle: join([status ? status.charAt(0).toUpperCase() + status.slice(1) : '', category]),
      extra: [category, ...strings(d.data.tags)].filter(Boolean),
      updatedAt: millis(d.data.updatedAt) ?? millis(d.data.createdAt),
      itemId: d.id,
    };
  });
  return done(entries, res.truncated);
}

async function loadCampaigns({ tenantId, read }: LoadContext): Promise<SourceResult> {
  const res = await read(topLevel('campaigns', READ_CAPS.campaigns), tenantId);
  const entries = ownedBy(tenantId, res.docs).map((d): SearchEntry => {
    const description = plainPreview(d.data.description, 200);
    return {
      type: 'campaign',
      id: d.id,
      title: str(d.data.title) || 'Untitled campaign',
      subtitle: join([d.data.campaignType === 'pledge' ? 'Pledge campaign' : 'Fundraising', d.data.isActive === false ? 'Ended' : '']),
      extra: description ? [description] : [],
      updatedAt: millis(d.data.createdAt),
      itemId: d.id,
    };
  });
  return done(entries, res.truncated);
}

async function loadCommunities({ tenantId, read }: LoadContext): Promise<SourceResult> {
  const res = await read(underTenant(tenantId, 'channels', READ_CAPS.channels), tenantId);
  const entries = res.docs.map((d): SearchEntry => ({
    type: 'community',
    id: d.id,
    title: str(d.data.name) || 'Untitled channel',
    subtitle: str(d.data.description).slice(0, 90),
    updatedAt: millis(d.data.lastMessageAt) ?? millis(d.data.createdAt),
    itemId: d.id,
  }));
  return done(entries, res.truncated);
}

async function loadCampuses({ tenantId, read }: LoadContext): Promise<SourceResult> {
  const res = await read(topLevel('churches', READ_CAPS.churches), tenantId);
  const entries = ownedBy(tenantId, res.docs).map((d): SearchEntry => ({
    type: 'campus',
    id: d.id,
    title: str(d.data.name) || 'Unnamed campus',
    subtitle: join([str(d.data.city), str(d.data.country)], ', '),
    extra: [str(d.data.pastor), str(d.data.address)].filter(Boolean),
    updatedAt: millis(d.data.createdAt),
    itemId: d.id,
  }));
  return done(entries, res.truncated);
}

async function loadKnowledge({ tenantId, read }: LoadContext): Promise<SourceResult> {
  const res = await read(topLevel('rag_sources', READ_CAPS.ragSources), tenantId);
  const entries = ownedBy(tenantId, res.docs).map((d): SearchEntry => ({
    type: 'knowledge',
    id: d.id,
    title: str(d.data.title) || 'Untitled source',
    subtitle: str(d.data.type),
    updatedAt: millis(d.data.addedAt),
    itemId: d.id,
  }));
  return done(entries, res.truncated);
}

const has = (tab: string) => (access: ReadonlySet<string>) => access.has(tab);

export const CONTENT_SOURCES: readonly ContentSource[] = [
  { id: 'people', label: 'People', enabled: has('crm'), load: loadPeople },
  {
    id: 'subscribers',
    label: 'Subscribers',
    enabled: (access) => !access.has('crm') && access.has('newsletter'),
    load: loadSubscribers,
  },
  { id: 'notes', label: 'Notes', enabled: has('docs'), load: loadNotes },
  { id: 'courses', label: 'Courses', enabled: has('courses'), load: loadCourses },
  { id: 'events', label: 'Events', enabled: has('events'), load: loadEvents },
  { id: 'forms', label: 'Forms', enabled: has('forms'), load: loadForms },
  { id: 'posts', label: 'Blog posts', enabled: has('blog'), load: loadPosts },
  { id: 'services', label: 'Services', enabled: has('services'), load: loadServices },
  { id: 'campaigns', label: 'Fundraising', enabled: has('fundraising'), load: loadCampaigns },
  { id: 'communities', label: 'Communities', enabled: has('community'), load: loadCommunities },
  { id: 'campuses', label: 'Campuses', enabled: has('churches'), load: loadCampuses },
  { id: 'knowledge', label: 'AI knowledge', enabled: has('ai'), load: loadKnowledge },
  { id: 'checkin', label: 'Check-in', enabled: has('checkin'), load: loadCheckin },
];

/** Every tab id some source reads. The cache key only cares about these. */
export const SEARCHABLE_TABS: ReadonlySet<string> = new Set(['crm', 'newsletter', 'docs', 'courses', 'events', 'forms', 'blog', 'services', 'fundraising', 'community', 'churches', 'ai', 'checkin']);

