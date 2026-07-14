"use client";
import React, { useState, useEffect } from 'react';
import { Users, GraduationCap, Inbox, Building2, ArrowRight } from 'lucide-react';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db, auth } from '../firebase';

interface AdminDashboardHomeProps {
  tenantId: string | null;
  tenantName?: string;
  isSuperAdmin: boolean;
  unreadCount: number;
  onNavigate: (tabId: string) => void;
}

interface MemberRow { id: string; name: string; createdAt: number | null }

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
};

const AdminDashboardHome: React.FC<AdminDashboardHomeProps> = ({ tenantId, tenantName, isSuperAdmin, unreadCount, onNavigate }) => {
  const [state, setState] = useState<'loading' | 'loaded'>('loading');
  const [memberCount, setMemberCount] = useState(0);
  const [newThisWeek, setNewThisWeek] = useState(0);
  const [courseCount, setCourseCount] = useState(0);
  const [tenantCount, setTenantCount] = useState(0);
  const [recentMembers, setRecentMembers] = useState<MemberRow[]>([]);

  const adminName = (auth.currentUser?.displayName || '').split(' ')[0] || 'there';
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const ministryLabel = (tenantName || 'Harvest').trim();

  useEffect(() => {
    let cancelled = false;

    const scoped = (name: string) =>
      tenantId
        ? query(collection(db, name), where('tenantId', '==', tenantId), limit(500))
        : query(collection(db, name), limit(500));

    (async () => {
      try {
        const [usersSnap, coursesSnap] = await Promise.all([
          getDocs(scoped('users')),
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
        // Real, derived signal: members whose createdAt is within the last 7 days.
        const cutoff = Date.now() - WEEK_MS;
        setNewThisWeek(members.filter((m) => m.createdAt != null && m.createdAt >= cutoff).length);

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
        { label: 'Inbox', value: unreadCount, icon: Inbox, tab: 'inbox' },
      ]
    : [
        { label: 'Members', value: memberCount, icon: Users, tab: 'crm' },
        { label: 'Courses', value: courseCount, icon: GraduationCap, tab: 'courses' },
      ];
  const statColsClass = stats.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3';

  const quickActions = [
    { label: 'New Course', tab: 'courses' },
    ...(isPlatform ? [{ label: 'View Inbox', tab: 'inbox' }] : []),
    { label: 'View Members', tab: 'crm' },
  ];

  const cutoff = Date.now() - WEEK_MS;

  if (state === 'loading') {
    return (
      <div className="w-full max-w-6xl mx-auto space-y-6 p-4 lg:p-0">
        <div className="h-9 w-72 bg-stone-100 rounded animate-pulse" />
        <div className={`grid grid-cols-2 ${statColsClass} gap-4`}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 bg-stone-100 rounded-brand-lg animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-stone-100 rounded-brand-lg animate-pulse" />
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6 p-4 lg:p-0">
      {/* Greeting hero */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold mb-2">
          {ministryLabel} <span className="text-[color:var(--text-faint)]">·</span> {today}
        </p>
        <h1 className="font-display text-[2rem] lg:text-[2.4rem] leading-[1.1] font-light tracking-[-0.02em] text-earth">
          {greeting()}, {adminName}.
        </h1>
        <p className="text-[15px] text-warm-brown mt-2">
          {newThisWeek > 0
            ? <>Your ministry gained <span className="font-semibold text-earth">{newThisWeek} new member{newThisWeek === 1 ? '' : 's'}</span> this week.</>
            : <>Here&apos;s your ministry at a glance.</>}
        </p>
      </div>

      {/* Stat cards — real counts only */}
      <div className={`grid grid-cols-2 ${statColsClass} gap-4`}>
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.label}
              onClick={() => onNavigate(s.tab)}
              className="bg-white rounded-brand-lg border border-stone-200 shadow-[var(--ds-sh-sm)] p-4 lg:p-5 text-left hover:border-[color-mix(in_srgb,var(--brand-color)_40%,var(--stone-200,#E8E2D9))] transition-colors group"
            >
              {/* Mockup stat card: gold icon disc, serif value, label below. */}
              <div className="flex items-center justify-between mb-3">
                <span className="w-9 h-9 rounded-brand bg-[var(--surface-gold)] text-gold flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <Icon size={17} />
                </span>
              </div>
              <div className="font-display text-[1.9rem] lg:text-[2.1rem] leading-none font-light text-earth">
                {s.value.toLocaleString()}
              </div>
              <div className="text-[11.5px] text-warm-brown mt-1.5">{s.label}</div>
            </button>
          );
        })}
      </div>

      {/* Recent Members */}
      <div className="bg-white rounded-brand-lg border border-stone-200 shadow-[var(--ds-sh-sm)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold">Recent Members</h3>
          <button
            onClick={() => onNavigate('crm')}
            className="flex items-center gap-1 text-xs font-semibold text-gold hover:opacity-80 transition-opacity"
          >
            View all <ArrowRight size={13} />
          </button>
        </div>
        <div className="px-5">
          {recentMembers.length === 0 ? (
            <p className="text-sm text-warm-brown py-6">No members yet.</p>
          ) : (
            recentMembers.map((m) => {
              const isNew = m.createdAt != null && m.createdAt >= cutoff;
              return (
                <div key={m.id} className="flex items-center gap-3 py-3 border-b border-stone-200 last:border-0">
                  <div className="w-9 h-9 rounded-full bg-stone-100 flex items-center justify-center text-xs font-bold text-warm-brown shrink-0">
                    {initials(m.name)}
                  </div>
                  <span className="text-sm font-semibold text-earth flex-1 truncate">{m.name}</span>
                  {isNew && (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-sky-700 bg-sky-100 rounded-full px-2 py-0.5 shrink-0">New</span>
                  )}
                  <span className="text-xs text-[color:var(--text-faint)] shrink-0 w-14 text-right">{joinedLabel(m.createdAt)}</span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold mb-3">Quick Actions</h3>
        <div className="flex flex-wrap gap-2.5">
          {quickActions.map((a) => (
            <button
              key={a.label}
              onClick={() => onNavigate(a.tab)}
              className="px-4 py-2 rounded-brand border border-stone-200 bg-white text-[13px] font-semibold text-earth hover:bg-stone-100 hover:border-[color-mix(in_srgb,var(--brand-color)_40%,var(--stone-200,#E8E2D9))] transition-colors"
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
