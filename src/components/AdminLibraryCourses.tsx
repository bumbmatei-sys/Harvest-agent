"use client";
import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Library } from 'lucide-react';
import { collection, onSnapshot, deleteDoc, doc, limit, query } from 'firebase/firestore';
import { db } from '../firebase';
import AdminCourseEditor, { Course } from './AdminCourseEditor';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { sortByTime } from '../utils/query-helpers';
import { LIBRARY_COURSE_COLLECTIONS } from '../utils/library-authoring';
import { AdminPageHeader, AdminPrimaryButton, AdminSearchBar, AdminCard, AdminBadge, statusTone } from './admin/AdminUI';

/**
 * Platform course library — super-admin authoring screen (THE-54).
 *
 * Mirrors AdminCourses, with two deliberate differences:
 *
 *  1. NO `maxCourses` CAP. That cap is a tenant plan limit on how many courses a
 *     church may hold; the platform catalogue a super admin authors is
 *     unlimited. The cap applies to tenant ADOPTION of these courses, which is a
 *     later change — not here.
 *
 *  2. The query is UNFILTERED. libraryCourses docs carry no tenantId and their
 *     read rule references no document field, so `where('tenantId', …)` would
 *     match nothing. This is the intended shape, not an oversight.
 *
 * Writes are gated by the Firestore rules on isSuperAdmin(); this screen is only
 * reachable from the super-admin-only dashboard tab.
 */
const AdminLibraryCourses: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    // Unfiltered by design — see the note above. Sorted client-side so no
    // composite index is needed (the house convention).
    const q = query(collection(db, LIBRARY_COURSE_COLLECTIONS.courses), limit(200));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as Course[];
      setCourses(sortByTime(fetched, 'createdAt', 'desc'));
      setLoading(false);
    }, (error) => {
      try { handleFirestoreError(error, OperationType.GET, LIBRARY_COURSE_COLLECTIONS.courses); } catch (e) { console.error(e); }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const filteredCourses = courses.filter(course =>
    (course.title?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
    (course.author?.toLowerCase() || '').includes(searchQuery.toLowerCase())
  );

  const handleNewCourse = () => { setEditingCourse(null); setIsEditorOpen(true); };
  const handleEditCourse = (course: Course) => { setEditingCourse(course); setIsEditorOpen(true); };

  const handleDeleteCourse = async (id: string) => {
    try {
      // No tenant-ownership pre-check: catalogue docs have no tenantId to
      // compare. The rules allow the delete only for a super admin.
      await deleteDoc(doc(db, LIBRARY_COURSE_COLLECTIONS.courses, id));
      setDeleteConfirmId(null);
    } catch (error) {
      try { handleFirestoreError(error, OperationType.DELETE, `${LIBRARY_COURSE_COLLECTIONS.courses}/${id}`); } catch (e) { console.error(e); }
      setErrorMessage('Failed to delete course. Please try again.');
      setTimeout(() => setErrorMessage(null), 3000);
    }
  };

  if (isEditorOpen) {
    return <AdminCourseEditor course={editingCourse} onClose={() => setIsEditorOpen(false)} library />;
  }

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      {errorMessage && (
        <div className="bg-red-50 text-red-600 p-3 rounded-brand text-sm font-medium border border-red-100">
          {errorMessage}
        </div>
      )}

      <AdminPageHeader
        eyebrow="Platform library"
        title={`${courses.length} library course${courses.length === 1 ? '' : 's'}`}
        action={<AdminPrimaryButton onClick={handleNewCourse} icon={<Plus size={16} />}>New library course</AdminPrimaryButton>}
      />

      <div className="bg-[var(--surface-gold)] text-strong rounded-brand p-3.5 text-sm border border-line">
        Courses here are authored once for the whole platform. Every church can browse and
        adopt them free of charge, and edits you make reach every church that adopted the
        course. Nothing is uploaded — lessons embed video from the speaker&apos;s own YouTube channel.
      </div>

      <AdminSearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search by title or author…" />

      {/* Mobile list */}
      <div className="lg:hidden bg-surface-raised rounded-brand-xl border border-line shadow-[var(--ds-sh-sm)] overflow-hidden">
        {loading ? (
          <div className="px-3.5 py-10 flex items-center justify-center gap-2 text-muted">
            <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin"></div>
            <span>Loading library…</span>
          </div>
        ) : filteredCourses.length === 0 ? (
          <div className="px-3.5 py-14 flex flex-col items-center justify-center gap-1.5 text-center">
            <Library size={30} className="text-stone-300 mb-1" />
            <p className="font-display text-base text-strong">No library courses yet</p>
            <p className="text-sm text-muted">Author one and every church can adopt it.</p>
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
              <div key={course.id} className={`flex items-center gap-3 px-3.5 py-3 ${i ? 'border-t border-line' : ''}`}>
                <div className="w-[68px] h-[52px] rounded-brand bg-[var(--surface-gold)] text-gold flex items-center justify-center shrink-0 overflow-hidden">
                  {course.thumbnail
                    ? <img src={course.thumbnail} alt="" className="w-full h-full object-cover" />
                    : <Library size={20} />}
                </div>
                <button onClick={() => handleEditCourse(course)} className="flex-1 min-w-0 text-left">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex-1 min-w-0 text-sm font-semibold text-strong line-clamp-1">{course.title}</span>
                    <AdminBadge tone={statusTone(course.status)} className="shrink-0">{course.status}</AdminBadge>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    {course.featured && <AdminBadge tone="gold">Featured</AdminBadge>}
                    {meta && <span className="text-xs text-faint truncate">{meta}</span>}
                  </div>
                </button>
                <button
                  onClick={() => setDeleteConfirmId(course.id || null)}
                  className="p-2 rounded-brand text-faint hover:text-danger hover:bg-danger-tint transition-colors shrink-0"
                  title="Delete"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Desktop table */}
      <AdminCard className="hidden lg:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Title</th>
                <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Author</th>
                <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Status</th>
                <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em] text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-muted">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin"></div>
                      <span>Loading library…</span>
                    </div>
                  </td>
                </tr>
              ) : filteredCourses.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-14 text-center">
                    <div className="flex flex-col items-center justify-center gap-1.5">
                      <Library size={30} className="text-stone-300 mb-1" />
                      <p className="font-display text-base text-strong">No library courses yet</p>
                      <p className="text-sm text-muted">Author one and every church can adopt it.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredCourses.map((course) => (
                  <tr key={course.id} className="hover:bg-[color-mix(in_srgb,var(--surface-sunken)_60%,transparent)] transition-colors group">
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className="w-9 h-9 rounded-brand bg-[color-mix(in_srgb,var(--brand-color)_12%,transparent)] flex items-center justify-center shrink-0">
                          <Library size={17} className="text-gold" />
                        </span>
                        <span className="text-sm font-semibold text-strong line-clamp-1">{course.title}</span>
                        {course.featured && <AdminBadge tone="gold">Featured</AdminBadge>}
                      </div>
                    </td>
                    <td className="px-6 py-3.5"><span className="text-sm text-muted">{course.author}</span></td>
                    <td className="px-6 py-3.5"><AdminBadge tone={statusTone(course.status)}>{course.status}</AdminBadge></td>
                    <td className="px-6 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleEditCourse(course)}
                          className="p-2 rounded-brand text-faint hover:text-gold hover:bg-surface-sunken transition-colors"
                          title="Edit"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(course.id || null)}
                          className="p-2 rounded-brand text-faint hover:text-danger hover:bg-danger-tint transition-colors"
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

      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-surface-raised rounded-brand-lg shadow-xl max-w-sm w-full p-6 border border-line">
            <h3 className="font-display text-xl font-semibold text-strong mb-2">Delete library course</h3>
            <p className="text-muted mb-6 text-sm">
              This removes the course from the platform catalogue for every church. Churches
              that already adopted it will lose access to it. This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConfirmId(null)} className="px-4 py-2 text-muted hover:bg-surface-sunken rounded-brand font-medium transition-colors">Cancel</button>
              <button onClick={() => handleDeleteCourse(deleteConfirmId)} className="px-4 py-2 bg-danger hover:opacity-90 text-white rounded-brand font-medium transition-opacity">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminLibraryCourses;
