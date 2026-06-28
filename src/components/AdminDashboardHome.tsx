"use client";
import React, { useState, useEffect } from 'react';
import { Users, Rss, GraduationCap, Inbox, Building2 } from 'lucide-react';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db, auth } from '../firebase';

interface AdminDashboardHomeProps {
  tenantId: string | null;
  isSuperAdmin: boolean;
  unreadCount: number;
  onNavigate: (tabId: string) => void;
}

interface MemberRow { id: string; name: string; createdAt: number | null }
interface PostRow { id: string; title: string; createdAt: number | null }

/** Best-effort parse of the various createdAt shapes used across the app. */
const toMillis = (v: any): number | null => {
  if (!v) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const t = Date.parse(v); return isNaN(t) ? null : t; }
  if (typeof v?.toMillis === 'function') return v.toMillis();
  if (typeof v?.seconds === 'number') return v.seconds * 1000;
  return null;
};

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';

const joinedLabel = (ms: number | null) => {
  if (!ms) return 'Joined recently';
  return `Joined ${new Date(ms).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`;
};

const relativeLabel = (ms: number | null) => {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
};

const AdminDashboardHome: React.FC<AdminDashboardHomeProps> = ({ tenantId, isSuperAdmin, unreadCount, onNavigate }) => {
  const [state, setState] = useState<'loading' | 'loaded'>('loading');
  const [memberCount, setMemberCount] = useState(0);
  const [postCount, setPostCount] = useState(0);
  const [courseCount, setCourseCount] = useState(0);
  const [tenantCount, setTenantCount] = useState(0);
  const [recentMembers, setRecentMembers] = useState<MemberRow[]>([]);
  const [recentPosts, setRecentPosts] = useState<PostRow[]>([]);

  const adminName = (auth.currentUser?.displayName || '').split(' ')[0] || 'there';

  useEffect(() => {
    let cancelled = false;

    const scoped = (name: string) =>
      tenantId
        ? query(collection(db, name), where('tenantId', '==', tenantId), limit(500))
        : query(collection(db, name), limit(500));

    (async () => {
      try {
        const [usersSnap, postsSnap, coursesSnap] = await Promise.all([
          getDocs(scoped('users')),
          getDocs(scoped('community_posts')),
          getDocs(scoped('courses')),
        ]);
        if (cancelled) return;

        // Members
        const members: MemberRow[] = usersSnap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            name: data.displayName || data.name || data.email || 'Member',
            createdAt: toMillis(data.createdAt),
          };
        });
        members.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
        setMemberCount(members.length);
        setRecentMembers(members.slice(0, 5));

        // Posts — community_posts store `content` (and `eventDetails.title` for
        // event posts); there is no top-level `title`. Derive a short label.
        const posts: PostRow[] = postsSnap.docs.map((d) => {
          const data = d.data();
          const raw = data.eventDetails?.title || (typeof data.content === 'string' ? data.content : '') || '';
          return { id: d.id, title: raw.trim().slice(0, 60) || 'Untitled post', createdAt: toMillis(data.createdAt) };
        });
        posts.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
        setPostCount(posts.length);
        setRecentPosts(posts.slice(0, 3));

        // Published courses
        setCourseCount(coursesSnap.docs.filter((d) => d.data().status === 'published').length);

        // Super admin: platform-wide tenant count
        if (isSuperAdmin && !tenantId) {
          const tenantsSnap = await getDocs(query(collection(db, 'tenants'), limit(500)));
          if (!cancelled) setTenantCount(tenantsSnap.size);
        }
      } catch (e) {
        console.error('Failed to load dashboard:', e);
      } finally {
        if (!cancelled) setState('loaded');
      }
    })();

    return () => { cancelled = true; };
  }, [tenantId, isSuperAdmin]);

  // Platform context = super admin on the apex domain. The Platform Inbox only
  // exists there; tenant admins no longer have an inbox, so we don't surface it.
  const isPlatform = isSuperAdmin && !tenantId;
  const stats = isPlatform
    ? [
        { label: 'Tenants', value: tenantCount, icon: Building2, tab: 'tenants' },
        { label: 'Members', value: memberCount, icon: Users, tab: 'crm' },
        { label: 'Posts', value: postCount, icon: Rss, tab: 'posts' },
        { label: 'Inbox', value: unreadCount, icon: Inbox, tab: 'inbox' },
      ]
    : [
        { label: 'Members', value: memberCount, icon: Users, tab: 'crm' },
        { label: 'Posts', value: postCount, icon: Rss, tab: 'posts' },
        { label: 'Courses', value: courseCount, icon: GraduationCap, tab: 'courses' },
      ];

  const quickActions = [
    { label: '+ New Post', tab: 'posts' },
    { label: '+ New Course', tab: 'courses' },
    // Inbox is platform-only now — only surface it for the platform owner.
    ...(isPlatform ? [{ label: 'View Inbox', tab: 'inbox' }] : []),
    { label: 'View Members (CRM)', tab: 'crm' },
  ];

  if (state === 'loading') {
    return (
      <div className="max-w-4xl mx-auto space-y-6 p-4">
        <div className="h-6 w-48 bg-gray-100 rounded animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" style={{ width: `${80 - i * 12}%` }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-4">
      {/* Greeting */}
      <h2 className="text-base font-semibold text-gray-900">
        {greeting()}, {adminName} 👋
      </h2>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.label}
              onClick={() => onNavigate(s.tab)}
              className="bg-white rounded-xl border border-gray-100 p-4 text-left hover:border-gray-200 transition-colors"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-2xl font-bold text-gray-900">{s.value}</span>
                <Icon size={16} className="text-gray-300" />
              </div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">{s.label}</p>
            </button>
          );
        })}
      </div>

      {/* Recent Members */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Recent Members</h3>
        <div className="bg-white rounded-xl border border-gray-100 px-4">
          {recentMembers.length === 0 ? (
            <p className="text-sm text-gray-400 py-4">No members yet.</p>
          ) : (
            recentMembers.map((m) => (
              <div key={m.id} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-semibold text-gray-500 shrink-0">
                  {initials(m.name)}
                </div>
                <span className="text-sm font-medium text-gray-800 flex-1 truncate">{m.name}</span>
                <span className="text-xs text-gray-400 shrink-0">{joinedLabel(m.createdAt)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Recent Posts */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Recent Posts</h3>
        <div className="bg-white rounded-xl border border-gray-100 px-4">
          {recentPosts.length === 0 ? (
            <p className="text-sm text-gray-400 py-4">No posts yet.</p>
          ) : (
            recentPosts.map((p) => (
              <button
                key={p.id}
                onClick={() => onNavigate('posts')}
                className="w-full flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0 text-left hover:bg-gray-50 transition-colors -mx-4 px-4"
              >
                <span className="text-sm font-medium text-gray-800 flex-1 truncate">{p.title}</span>
                <span className="text-xs text-gray-400 shrink-0">{relativeLabel(p.createdAt)}</span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Quick Actions</h3>
        <div className="flex flex-wrap gap-2">
          {quickActions.map((a) => (
            <button
              key={a.label}
              onClick={() => onNavigate(a.tab)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AdminDashboardHome;
