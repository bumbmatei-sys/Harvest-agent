'use client';

import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react';
import { Edit2, FileText, GraduationCap, Trash2, User } from 'lucide-react';

import {
  AdminBadge,
  AdminCard,
  AdminPageHeader,
  AdminPrimaryButton,
  AdminSecondaryButton,
  AdminSectionLabel,
  statusTone,
} from '@/components/admin/AdminUI';
import { AdminDesktopSidebar, SIDEBAR_ICON_WIDTH } from '@/components/admin-shell/AdminDesktopSidebar';
import { useLgUp } from '@/components/admin-shell/use-lg';
import type { ShellTabRef } from '@/components/admin-shell/shell-nav';
import { BlogScheduleFields } from '@/components/blog/BlogScheduleFields';
import { MinistryPosts } from '@/components/public/MinistryPosts';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { blogListKind, blogStatusLabel, isBlogPostPublic } from '@/lib/blog/visibility';
import { applyTheme } from '@/lib/theme-runtime';
import { THEME_STORAGE_KEY } from '@/lib/theme';
import { formatFirestoreDate } from '@/utils/firestore-date';

const LOGO = 'https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png';
const CHURCH = 'Sample Ministry';
const ZONE = 'America/Los_Angeles';
const LIST_NOW = Date.parse('2026-06-01T15:00:00.000Z');
const AFTER_NOW = Date.parse('2026-07-21T12:00:00.000Z');
const SCHEDULED_AT = '2026-07-20T16:00:00.000Z';
const PUBLISHED_AT = '2026-01-04T18:00:00.000Z';

const FIELD_LABEL = 'block text-xs font-semibold text-body mb-1.5';
const FIELD_INPUT = 'w-full px-3 py-2.5 bg-surface-raised border border-line rounded-brand text-sm text-strong outline-hidden';

const TABS = new Map<string, ShellTabRef>([
  ['blog', { id: 'blog', label: 'Blog', icon: FileText }],
  ['branding', { id: 'branding', label: 'Branding', icon: FileText }],
  ['ai', { id: 'ai', label: 'AI Knowledge', icon: FileText }],
  ['livestream', { id: 'livestream', label: 'Livestream', icon: FileText }],
  ['courses', { id: 'courses', label: 'Courses', icon: GraduationCap }],
]);

interface SamplePost {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly status: 'draft' | 'scheduled' | 'published';
  readonly publishedAt: string | null;
  readonly scheduleTimeZone: string | null;
  readonly createdAt: string;
  readonly excerpt: string;
}

const SAMPLE_POSTS: readonly SamplePost[] = [
  {
    id: 'welcome',
    title: 'Welcome',
    category: 'News',
    status: 'published',
    publishedAt: PUBLISHED_AT,
    scheduleTimeZone: ZONE,
    createdAt: PUBLISHED_AT,
    excerpt: 'A short note from Sample Ministry.',
  },
  {
    id: 'reflection',
    title: 'Sunday reflection',
    category: 'Teaching',
    status: 'scheduled',
    publishedAt: SCHEDULED_AT,
    scheduleTimeZone: ZONE,
    createdAt: '2026-06-01T15:00:00.000Z',
    excerpt: 'This note waits until its scheduled time.',
  },
  {
    id: 'draft',
    title: 'A quiet draft',
    category: 'News',
    status: 'draft',
    publishedAt: null,
    scheduleTimeZone: null,
    createdAt: '2026-05-02T15:00:00.000Z',
    excerpt: 'Not on the ministry page.',
  },
];

type PreviewView = 'editor' | 'list' | 'before' | 'after' | 'publish' | 'takedown';

function readBoot(): { view: PreviewView; theme: 'light' | 'dark' } {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('view');
  const view: PreviewView = raw === 'list' || raw === 'before' || raw === 'after' || raw === 'editor' || raw === 'publish' || raw === 'takedown'
    ? raw
    : 'editor';
  return { view, theme: params.get('theme') === 'dark' ? 'dark' : 'light' };
}

function shortStatus(post: SamplePost): string {
  const kind = blogListKind(post, LIST_NOW);
  if (kind === 'draft') return 'Draft';
  if (kind === 'scheduled') return 'Scheduled';
  return 'Published';
}

function EditorShot({ step }: { step: 'schedule' | 'publish' | 'takedown' }) {
  const preview = step === 'publish'
    ? `${CHURCH}: this post becomes public on the ministry page now.`
    : step === 'takedown'
      ? `${CHURCH}: this post returns to a draft and leaves the ministry page.`
      : null;
  const primary = preview ? 'Confirm' : step === 'takedown' ? 'Take down' : step === 'publish' ? 'Publish now' : 'Schedule';
  return (
    <div className="w-full min-w-0 max-w-full pb-10" data-blog-shot="editor" data-blog-confirm={preview ? step : undefined}>
      <div className="flex items-center justify-between gap-4 mb-6">
        <span className="text-[13px] font-semibold text-gold">Blog</span>
        <div className="flex items-center gap-2.5">
          <AdminSecondaryButton type="button">Save draft</AdminSecondaryButton>
          <AdminPrimaryButton type="button">{primary}</AdminPrimaryButton>
        </div>
      </div>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(220px,340px)] lg:gap-6 space-y-6 lg:space-y-0 items-start">
        <AdminCard>
          <p className="w-full px-6 pt-6 pb-5 font-display text-[1.9rem] font-normal text-strong leading-tight">
            Sunday reflection
          </p>
          <div className="border-t border-line px-6 py-5 text-sm text-body">
            A sample article for the schedule control. Nothing here is a live ministry.
          </div>
        </AdminCard>
        <AdminCard className="p-5 space-y-4">
          <AdminSectionLabel>Post settings</AdminSectionLabel>
          <BlogScheduleFields
            intent={step === 'publish' ? 'published' : step === 'takedown' ? 'draft' : 'scheduled'}
            onIntent={() => {}}
            wallClock="2026-07-20T09:00"
            onWallClock={() => {}}
            timeZone={ZONE}
            preview={preview}
            fieldLabel={FIELD_LABEL}
            fieldInput={FIELD_INPUT}
          />
        </AdminCard>
      </div>
    </div>
  );
}

function ListShot() {
  return (
    <div className="w-full space-y-6" data-blog-shot="list">
      <AdminPageHeader eyebrow="Content" title={`${SAMPLE_POSTS.length} posts`} />
      <div className="lg:hidden bg-surface-raised rounded-brand-xl border border-line shadow-[var(--ds-sh-sm)] overflow-hidden">
        {SAMPLE_POSTS.map((post, i) => (
          <div key={post.id} className={`flex items-center gap-3 px-3.5 py-3 ${i ? 'border-t border-line' : ''}`}>
            <div className="w-11 h-11 rounded-brand bg-[var(--surface-gold)] flex items-center justify-center text-muted shrink-0">
              <FileText size={17} />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-semibold text-strong leading-snug line-clamp-1">{post.title}</span>
              <div className="flex items-center gap-2 mt-1">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-surface-sunken text-muted text-[11px] font-medium">{post.category}</span>
                <span className="text-[11px] text-faint whitespace-nowrap">{formatFirestoreDate(post.createdAt)}</span>
              </div>
            </div>
            <AdminBadge tone={statusTone(blogListKind(post, LIST_NOW))} className="shrink-0">{shortStatus(post)}</AdminBadge>
          </div>
        ))}
      </div>
      <AdminCard className="hidden lg:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Title</th>
                <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Category</th>
                <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Status</th>
                <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Date</th>
                <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em] text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {SAMPLE_POSTS.map((post) => (
                <tr key={post.id}>
                  <td className="px-6 py-3.5"><span className="text-sm font-semibold text-strong line-clamp-1">{post.title}</span></td>
                  <td className="px-6 py-3.5"><span className="text-sm text-muted">{post.category}</span></td>
                  <td className="px-6 py-3.5">
                    <AdminBadge tone={statusTone(blogListKind(post, LIST_NOW))}>
                      {blogStatusLabel(post, LIST_NOW, ZONE)}
                    </AdminBadge>
                  </td>
                  <td className="px-6 py-3.5"><span className="text-sm text-muted whitespace-nowrap">{formatFirestoreDate(post.createdAt)}</span></td>
                  <td className="px-6 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" className="p-2 rounded-brand text-faint" title="Edit"><Edit2 size={16} /></button>
                      <button type="button" className="p-2 rounded-brand text-faint" title="Delete"><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminCard>
    </div>
  );
}

function PageShot({ nowMs }: { nowMs: number }) {
  const posts = SAMPLE_POSTS.filter((post) => isBlogPostPublic(post, nowMs)).map((post) => ({
    id: post.id,
    title: post.title,
    excerpt: post.excerpt,
    publishedAt: post.publishedAt,
    timeZone: post.scheduleTimeZone || 'UTC',
  }));
  return (
    <div data-blog-shot="page">
      <MinistryPosts churchName={CHURCH} posts={posts} skipped={0} />
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const lgUp = useLgUp();
  return (
    <TooltipProvider>
      <SidebarProvider
        className="h-[100dvh] min-h-0 bg-surface"
        style={{ '--sidebar-width-icon': SIDEBAR_ICON_WIDTH } as CSSProperties}
      >
        {lgUp && (
          <AdminDesktopSidebar
            side="public"
            onSide={() => {}}
            activeTab="blog"
            placeholder={null}
            tabs={TABS}
            tenantName={CHURCH}
            logoUrl={LOGO}
            onNavigate={() => {}}
            onPlaceholder={() => {}}
            accountMenu={(
              <button
                type="button"
                aria-label="My account"
                className="flex size-11 items-center justify-center rounded-full border border-sidebar-border bg-sidebar text-sidebar-foreground"
              >
                <User />
              </button>
            )}
          />
        )}
        <SidebarInset
          className="min-w-0 overflow-y-auto bg-surface p-6 pb-24"
          style={{ background: 'var(--surface)', color: 'var(--text-strong)' }}
        >
          {children}
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

export function BlogSchedulePreview() {
  const [boot, setBoot] = useState<{ view: PreviewView; theme: 'light' | 'dark' } | null>(null);

  useEffect(() => {
    setBoot(readBoot());
  }, []);

  useLayoutEffect(() => {
    if (!boot) return;
    try { localStorage.setItem(THEME_STORAGE_KEY, boot.theme); } catch { /* private mode */ }
    applyTheme(boot.theme);
    document.body.style.background = 'var(--surface)';
    document.documentElement.dataset.previewTheme = boot.theme;
  }, [boot]);

  if (!boot) return null;

  const body = boot.view === 'list'
    ? <ListShot />
    : boot.view === 'before'
      ? <PageShot nowMs={LIST_NOW} />
      : boot.view === 'after'
        ? <PageShot nowMs={AFTER_NOW} />
        : boot.view === 'publish'
          ? <EditorShot step="publish" />
          : boot.view === 'takedown'
            ? <EditorShot step="takedown" />
            : <EditorShot step="schedule" />;

  return (
    <div data-blog-preview={boot.view}>
      {boot.view === 'before' || boot.view === 'after' ? body : <Shell>{body}</Shell>}
    </div>
  );
}
