"use client";
import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, GraduationCap } from 'lucide-react';
import { collection, onSnapshot, query, where, deleteDoc, doc, getDoc, limit } from 'firebase/firestore';
import { db } from '../firebase';
import AdminCourseEditor, { Course } from './AdminCourseEditor';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope } from '../utils/tenant-scope';
import { sortByTime } from '../utils/query-helpers';
import { AdminPageHeader, AdminPrimaryButton, AdminSearchBar, AdminCard, AdminBadge, statusTone } from './admin/AdminUI';

const AdminCourses: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  const filteredCourses = courses.filter(course =>
    (course.title?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
    (course.author?.toLowerCase() || '').includes(searchQuery.toLowerCase())
  );

  const handleNewCourse = () => { setEditingCourse(null); setIsEditorOpen(true); };
  const handleEditCourse = (course: Course) => { setEditingCourse(course); setIsEditorOpen(true); };

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
        title={`${courses.length} course${courses.length === 1 ? '' : 's'}`}
        action={<AdminPrimaryButton onClick={handleNewCourse} icon={<Plus size={16} />}>New course</AdminPrimaryButton>}
      />

      <AdminSearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search by title or author…" />

      <AdminCard>
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
