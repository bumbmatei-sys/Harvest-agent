"use client";
import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, GraduationCap, Library, Check } from 'lucide-react';
import { collection, onSnapshot, query, where, deleteDoc, doc, getDoc, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { authFetch } from '../utils/auth-fetch';
import AdminCourseEditor, { Course } from './AdminCourseEditor';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope, getWriteTenantScope } from '../utils/tenant-scope';
import { sortByTime } from '../utils/query-helpers';
import { useTenant } from '@/contexts/TenantContext';
import { LIBRARY_COURSE_COLLECTIONS } from '../utils/library-authoring';
// Course descriptions are HTML from the rich-text editor. This card is a
// two-line clamped summary, so formatting is worthless here — and rendering
// catalogue HTML with dangerouslySetInnerHTML would be a needless XSS surface
// even though the author is a super admin. Existing helper, not a new one.
import { stripHtml } from '../utils/stripHtml';
import {
  resolveCourseLimit, isAtCourseLimit, courseLimitMessage, adoptableCourses,
} from '../utils/course-adoption';
import type { AdoptedCourse, LibraryCourse } from '../types/course.types';
import { AdminPageHeader, AdminPrimaryButton, AdminSearchBar, AdminCard, AdminBadge, statusTone } from './admin/AdminUI';

/**
 * A tenant could not be resolved for a WRITE. Distinct from a generic failure
 * because it is deterministic and reproducible — a configuration fault, not a
 * transient one — so telling the user to "try again" is actively misleading.
 */
class NoTenantScopeError extends Error {
  constructor() {
    super('No tenant scope: could not determine which church to write to.');
    this.name = 'NoTenantScopeError';
  }
}

/** The message the user actually sees. Specific when we know why. */
function describeAdoptionFailure(error: unknown, fallback: string): string {
  if (error instanceof NoTenantScopeError) {
    return 'Could not determine which church to use. Open your church\'s own site and try there.';
  }
  return fallback;
}

/**
 * Do not swallow. The original catch here was `console.error(error)` plus a
 * generic retry message, which turned a deterministic apex-super-admin failure
 * into an unexplained one — invisible in Vercel logs and Sentry alike, because
 * the request never left the browser.
 *
 * NOTE: there is no established client-side Sentry capture pattern in this
 * codebase — `Sentry.captureException` appears in no component or util (the
 * browser SDK IS initialised in instrumentation-client.ts, and
 * money-path-sentry.ts is server-only). Rather than invent one here, this logs
 * with the operation and the real message intact so the cause is legible in the
 * console. Adding a client capture helper is its own change.
 */
function reportAdoptionFailure(op: 'adopt' | 'unadopt', error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[courses:${op}] ${message}`, error);
}

const AdminCourses: React.FC = () => {
  const { tenantPlan } = useTenant();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Browse-and-adopt lives here rather than in its own tab: the plan cap is
  // computed on this screen and only makes sense with both lists in one place.
  const [view, setView] = useState<'own' | 'library'>('own');
  const [libraryCourses, setLibraryCourses] = useState<LibraryCourse[]>([]);
  const [adopted, setAdopted] = useState<AdoptedCourse[]>([]);
  const [adoptingId, setAdoptingId] = useState<string | null>(null);

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Unknown/loading plan falls back to 'plus' (maxCourses: 2) — fail closed on the cap.
  // ADOPTED COURSES COUNT: a church on Individual (2 slots) that adopts two
  // library courses cannot also create one of their own. Deliberate founder call.
  //
  // For ADOPTION this is now presentation only — /api/courses/adopt re-checks the
  // same cap server-side against the plan on the tenant doc and returns 403, and
  // adoptedCourses is no longer client-writable at all. For a tenant's OWN
  // courses the disabled button below is still the only check, exactly as it has
  // been since #228: creation goes straight to /courses from the client. Adoption
  // is enforced; creation is not.
  const maxCourses = resolveCourseLimit(tenantPlan);
  const adoptedIds = new Set(adopted.map((a) => a.libraryCourseId));
  const atLimit = isAtCourseLimit(courses.length, adopted.length, maxCourses);
  const limitMessage = courseLimitMessage(maxCourses);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    (async () => {
      const tenantId = await getTenantScope();
      // Single-field filter only (tenantId); sort client-side to avoid a composite index.
      const q = tenantId
        ? query(collection(db, 'courses'), where('tenantId', '==', tenantId), limit(100))
        : query(collection(db, 'courses'), limit(100));

      unsubscribe = onSnapshot(q, (snapshot) => {
        const fetchedCourses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Course[];
        setCourses(sortByTime(fetchedCourses, 'createdAt', 'desc'));
        setLoading(false);
      }, (error) => {
        try { handleFirestoreError(error, OperationType.GET, `courses`); } catch (e) { console.error(e); }
        setLoading(false);
      });
    })();

    return () => { if (unsubscribe) unsubscribe(); };
  }, []);

  // Catalogue + this tenant's adoptions.
  //
  // Both reads are deliberately UNFILTERED, and that is the opposite of the
  // /courses read above. libraryCourses docs carry no tenantId and their read
  // rule references no document field at all, so no filter is required — or
  // possible to get wrong. adoptedCourses is a subcollection whose tenant comes
  // from the PATH, so it needs no filter either.
  //
  // Draft courses are excluded in JS by adoptableCourses() below, deliberately
  // as the single mechanism: a `status` filter here would duplicate that in a
  // second place, and pushing it into the read rule was considered and rejected
  // (see the libraryCourses comment in firestore.rules).
  useEffect(() => {
    const unsubLibrary = onSnapshot(
      query(collection(db, LIBRARY_COURSE_COLLECTIONS.courses), limit(200)),
      (snap) => {
        const fetched = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as LibraryCourse[];
        setLibraryCourses(sortByTime(fetched, 'createdAt', 'desc'));
      },
      (error) => {
        try { handleFirestoreError(error, OperationType.GET, LIBRARY_COURSE_COLLECTIONS.courses); } catch (e) { console.error(e); }
      },
    );

    let unsubAdopted: (() => void) | null = null;
    (async () => {
      // getWriteTenantScope, NOT getTenantScope. This read addresses a
      // tenant-scoped PATH, so it needs a concrete id — and getTenantScope()
      // returns null for a super admin on the apex, which meant no listener at
      // all: no "Adopted" badge, and adopted.length stuck at 0 so the plan cap
      // undercounted. The adopt fix below is invisible without this one.
      const tenantId = await getWriteTenantScope();
      if (!tenantId) return; // genuinely no tenant to hold adoptions
      unsubAdopted = onSnapshot(
        collection(db, 'tenants', tenantId, 'adoptedCourses'),
        (snap) => {
          setAdopted(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as AdoptedCourse[]);
        },
        (error) => {
          try { handleFirestoreError(error, OperationType.GET, `tenants/${tenantId}/adoptedCourses`); } catch (e) { console.error(e); }
        },
      );
    })();

    return () => { unsubLibrary(); if (unsubAdopted) unsubAdopted(); };
  }, []);

  const filteredCourses = courses.filter(course =>
    (course.title?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
    (course.author?.toLowerCase() || '').includes(searchQuery.toLowerCase())
  );

  const handleNewCourse = () => {
    if (loading) return; // course count not known yet — can't decide the cap
    if (atLimit) {
      setErrorMessage(limitMessage);
      setTimeout(() => setErrorMessage(null), 5000);
      return;
    }
    setEditingCourse(null); setIsEditorOpen(true);
  };
  const handleEditCourse = (course: Course) => { setEditingCourse(course); setIsEditorOpen(true); };

  // Draft courses are neither browsable nor adoptable. This is the ONE place
  // that filter lives on the read path; /api/courses/adopt independently refuses
  // to adopt an unpublished course, which is the check that actually matters.
  const visibleLibrary = adoptableCourses(libraryCourses).filter(course =>
    (course.title?.toLowerCase() || '').includes(searchQuery.toLowerCase())
  );

  const handleAdopt = async (libraryCourse: LibraryCourse) => {
    if (loading) return;                       // counts not known — can't decide the cap
    if (adoptedIds.has(libraryCourse.id)) return;
    if (atLimit) {
      setErrorMessage(limitMessage);
      setTimeout(() => setErrorMessage(null), 5000);
      return;
    }
    setAdoptingId(libraryCourse.id);
    try {
      // getWriteTenantScope, NOT getTenantScope — this is a MUTATION.
      // getTenantScope() returns null by design for a super admin with no host
      // scope (null means "all tenants", correct for a read), so on the apex
      // the old code threw before the request ever left the browser: no Vercel
      // log, no Sentry event, just "please try again", every time.
      const tenantId = await getWriteTenantScope();
      if (!tenantId) throw new NoTenantScopeError();
      // adoptedCourses is server-only now (allow write: if false). The route
      // writes the POINTER after verifying the target exists and is published —
      // a check no Firestore rule can make, since rules cannot read across
      // collections. The listener above picks the new doc up.
      const res = await authFetch('/api/courses/adopt', {
        method: 'POST',
        body: JSON.stringify({ tenantId, libraryCourseId: libraryCourse.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMessage(body?.error || 'Failed to adopt this course. Please try again.');
        setTimeout(() => setErrorMessage(null), 5000);
      }
    } catch (error) {
      reportAdoptionFailure('adopt', error);
      setErrorMessage(describeAdoptionFailure(error, 'Failed to adopt this course. Please try again.'));
      setTimeout(() => setErrorMessage(null), 6000);
    } finally {
      setAdoptingId(null);
    }
  };

  // Un-adopt is a plain delete of the pointer. Members lose the course; their
  // progress records are retained, so re-adopting restores their place.
  const handleUnadopt = async (libraryCourseId: string) => {
    setAdoptingId(libraryCourseId);
    try {
      // Same mutation, same resolver — see handleAdopt. This had the identical
      // apex bug: un-adopt failed for a super admin for exactly the same reason.
      const tenantId = await getWriteTenantScope();
      if (!tenantId) throw new NoTenantScopeError();
      const res = await authFetch('/api/courses/adopt', {
        method: 'DELETE',
        body: JSON.stringify({ tenantId, libraryCourseId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMessage(body?.error || 'Failed to remove this course. Please try again.');
        setTimeout(() => setErrorMessage(null), 5000);
      }
    } catch (error) {
      reportAdoptionFailure('unadopt', error);
      setErrorMessage(describeAdoptionFailure(error, 'Failed to remove this course. Please try again.'));
      setTimeout(() => setErrorMessage(null), 6000);
    } finally {
      setAdoptingId(null);
    }
  };

  const handleDeleteCourse = async (id: string) => {
    try {
      const tenantId = await getTenantScope();
      if (tenantId) {
        const docSnap = await getDoc(doc(db, 'courses', id));
        if (docSnap.exists() && docSnap.data().tenantId && docSnap.data().tenantId !== tenantId) {
          console.error('Tenant mismatch — cannot modify another tenant\'s document');
          return;
        }
      }
      await deleteDoc(doc(db, 'courses', id));
      setDeleteConfirmId(null);
    } catch (error) {
      try { handleFirestoreError(error, OperationType.DELETE, `courses/${id}`); } catch (e) { console.error(e); }
      setErrorMessage("Failed to delete course. Please try again.");
      setTimeout(() => setErrorMessage(null), 3000);
    }
  };

  // The editor is a full in-shell screen; when open it replaces the list.
  if (isEditorOpen) {
    return <AdminCourseEditor course={editingCourse} onClose={() => setIsEditorOpen(false)} />;
  }

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      {errorMessage && (
        <div className="bg-red-50 text-red-600 p-3 rounded-brand text-sm font-medium border border-red-100">
          {errorMessage}
        </div>
      )}

      <AdminPageHeader
        eyebrow="Discipleship"
        title={
          maxCourses === -1
            ? `${courses.length + adopted.length} course${courses.length + adopted.length === 1 ? '' : 's'}`
            : `${courses.length + adopted.length} of ${maxCourses} course${maxCourses === 1 ? '' : 's'} used`
        }
        action={
          view === 'own'
            ? <AdminPrimaryButton onClick={handleNewCourse} icon={<Plus size={16} />} disabled={atLimit} title={atLimit ? limitMessage : undefined}>New course</AdminPrimaryButton>
            : undefined
        }
      />

      {/* Own courses vs the platform library. The count above spans BOTH — an
          adopted course occupies a plan slot exactly like one you authored. */}
      <div className="flex items-center gap-1 border-b border-stone-200">
        {([
          { key: 'own', label: `Your courses (${courses.length})` },
          { key: 'library', label: `Library (${adopted.length} adopted)` },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            className={`px-4 py-2.5 text-sm font-semibold -mb-px border-b-2 transition-colors ${
              view === t.key
                ? 'border-gold text-earth'
                : 'border-transparent text-warm-brown hover:text-earth'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {atLimit && (
        <div className="bg-[var(--surface-gold)] text-earth rounded-brand p-3.5 text-sm border border-stone-200">
          {limitMessage}
        </div>
      )}

      <AdminSearchBar value={searchQuery} onChange={setSearchQuery} placeholder={view === 'own' ? 'Search by title or author…' : 'Search the library…'} />

      {view === 'library' && (
        <div className="space-y-3">
          <p className="text-sm text-warm-brown">
            Courses published by Harvest, free on every plan. Adopting one adds it to your
            church&apos;s courses — you keep it in step automatically, because the course stays
            with its author and any edits reach you. Adopted courses count towards your plan.
          </p>
          {visibleLibrary.length === 0 ? (
            <AdminCard className="px-6 py-14 text-center">
              <div className="flex flex-col items-center justify-center gap-1.5">
                <Library size={30} className="text-stone-300 mb-1" />
                <p className="font-display text-base text-earth">Nothing in the library yet</p>
                <p className="text-sm text-warm-brown">Published courses will appear here.</p>
              </div>
            </AdminCard>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {visibleLibrary.map((course) => {
                const isAdopted = adoptedIds.has(course.id);
                const busy = adoptingId === course.id;
                const blocked = !isAdopted && atLimit;
                const lessonCount = (course.levels || []).reduce(
                  (sum, lv) => sum + (lv.sections || []).reduce((n, sec) => n + (sec.lessons?.length || 0), 0),
                  0,
                );
                return (
                  <AdminCard key={course.id} className="p-4 flex flex-col gap-3">
                    <div className="flex items-start gap-3">
                      <div className="w-[68px] h-[52px] rounded-brand bg-[var(--surface-gold)] text-gold flex items-center justify-center shrink-0 overflow-hidden">
                        {course.thumbnail
                          ? <img src={course.thumbnail} alt="" className="w-full h-full object-cover" />
                          : <Library size={20} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-earth line-clamp-1">{course.title}</span>
                          {isAdopted && <AdminBadge tone="gold">Adopted</AdminBadge>}
                        </div>
                        <p className="text-xs text-[color:var(--text-faint)] mt-1 line-clamp-2">{stripHtml(course.description || '')}</p>
                        <p className="text-xs text-warm-brown mt-1">
                          {[course.category, lessonCount ? `${lessonCount} lesson${lessonCount === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    </div>
                    {isAdopted ? (
                      <button
                        onClick={() => handleUnadopt(course.id)}
                        disabled={busy}
                        className="self-start px-3 py-1.5 rounded-brand text-sm font-medium text-warm-brown hover:text-[#C4553B] hover:bg-[#F7E7E2] transition-colors disabled:opacity-50"
                      >
                        {busy ? 'Removing…' : 'Remove from your courses'}
                      </button>
                    ) : (
                      <AdminPrimaryButton
                        onClick={() => handleAdopt(course)}
                        icon={busy ? undefined : <Check size={16} />}
                        disabled={busy || blocked}
                        title={blocked ? limitMessage : undefined}
                        className="self-start"
                      >
                        {busy ? 'Adopting…' : 'Adopt'}
                      </AdminPrimaryButton>
                    )}
                  </AdminCard>
                );
              })}
            </div>
          )}
        </div>
      )}

      {view === 'own' && (<>

      {/* Mobile list — mockup course-card library: thumbnail (cover, else GraduationCap
          on gold tint), title + status pill, and an author · lesson-count meta line.
          Same loading / filteredCourses data and the same handleEditCourse (tap = open
          the builder) / setDeleteConfirmId handlers as the desktop table below. */}
      <div className="lg:hidden bg-white rounded-brand-xl border border-stone-200 shadow-[var(--ds-sh-sm)] overflow-hidden">
        {loading ? (
          <div className="px-3.5 py-10 flex items-center justify-center gap-2 text-warm-brown">
            <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin"></div>
            <span>Loading courses…</span>
          </div>
        ) : filteredCourses.length === 0 ? (
          <div className="px-3.5 py-14 flex flex-col items-center justify-center gap-1.5 text-center">
            <GraduationCap size={30} className="text-stone-300 mb-1" />
            <p className="font-display text-base text-earth">No courses found</p>
            <p className="text-sm text-warm-brown">Get started by creating a new course.</p>
          </div>
        ) : (
          filteredCourses.map((course, i) => {
            const lessonCount = (course.levels || []).reduce(
              (sum, lv) => sum + (lv.sections || []).reduce((s, sec) => s + (sec.lessons?.length || 0), 0),
              0,
            );
            const meta = [course.author, lessonCount ? `${lessonCount} lesson${lessonCount === 1 ? '' : 's'}` : null]
              .filter(Boolean)
              .join(' · ');
            return (
              <div key={course.id} className={`flex items-center gap-3 px-3.5 py-3 ${i ? 'border-t border-stone-200' : ''}`}>
                <div className="w-[68px] h-[52px] rounded-brand bg-[var(--surface-gold)] text-gold flex items-center justify-center shrink-0 overflow-hidden">
                  {course.thumbnail
                    ? <img src={course.thumbnail} alt="" className="w-full h-full object-cover" />
                    : <GraduationCap size={20} />}
                </div>
                <button onClick={() => handleEditCourse(course)} className="flex-1 min-w-0 text-left">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex-1 min-w-0 text-sm font-semibold text-earth line-clamp-1">{course.title}</span>
                    <AdminBadge tone={statusTone(course.status)} className="shrink-0">{course.status}</AdminBadge>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    {(course as any).featured && <AdminBadge tone="gold">Featured</AdminBadge>}
                    {meta && <span className="text-xs text-[color:var(--text-faint)] truncate">{meta}</span>}
                  </div>
                </button>
                <button
                  onClick={() => setDeleteConfirmId(course.id || null)}
                  className="p-2 rounded-brand text-[color:var(--text-faint)] hover:text-[#C4553B] hover:bg-[#F7E7E2] transition-colors shrink-0"
                  title="Delete"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Desktop table — existing approved layout, unchanged (now lg-only). */}
      <AdminCard className="hidden lg:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-stone-200">
                <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Title</th>
                <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Author</th>
                <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Status</th>
                <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em] text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-warm-brown">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin"></div>
                      <span>Loading courses…</span>
                    </div>
                  </td>
                </tr>
              ) : filteredCourses.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-14 text-center">
                    <div className="flex flex-col items-center justify-center gap-1.5">
                      <GraduationCap size={30} className="text-stone-300 mb-1" />
                      <p className="font-display text-base text-earth">No courses found</p>
                      <p className="text-sm text-warm-brown">Get started by creating a new course.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredCourses.map((course) => (
                  <tr key={course.id} className="hover:bg-stone-100/60 transition-colors group">
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className="w-9 h-9 rounded-brand bg-[color-mix(in_srgb,var(--brand-color)_12%,white)] flex items-center justify-center shrink-0">
                          <GraduationCap size={17} className="text-gold" />
                        </span>
                        <span className="text-sm font-semibold text-earth line-clamp-1">{course.title}</span>
                        {(course as any).featured && <AdminBadge tone="gold">Featured</AdminBadge>}
                      </div>
                    </td>
                    <td className="px-6 py-3.5"><span className="text-sm text-warm-brown">{course.author}</span></td>
                    <td className="px-6 py-3.5"><AdminBadge tone={statusTone(course.status)}>{course.status}</AdminBadge></td>
                    <td className="px-6 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleEditCourse(course)}
                          className="p-2 rounded-brand text-[color:var(--text-faint)] hover:text-gold hover:bg-stone-100 transition-colors"
                          title="Edit"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(course.id || null)}
                          className="p-2 rounded-brand text-[color:var(--text-faint)] hover:text-[#C4553B] hover:bg-[#F7E7E2] transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </AdminCard>
      </>)}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-brand-lg shadow-xl max-w-sm w-full p-6 border border-stone-200">
            <h3 className="font-display text-xl font-semibold text-earth mb-2">Delete course</h3>
            <p className="text-warm-brown mb-6 text-sm">Are you sure you want to delete this course? This action cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConfirmId(null)} className="px-4 py-2 text-warm-brown hover:bg-stone-100 rounded-brand font-medium transition-colors">Cancel</button>
              <button onClick={() => handleDeleteCourse(deleteConfirmId)} className="px-4 py-2 bg-[#C4553B] hover:opacity-90 text-white rounded-brand font-medium transition-opacity">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminCourses;
