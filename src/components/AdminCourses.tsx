"use client";
import React, { useState, useEffect } from 'react';
import { Plus, Search, Edit2, Trash2, BookOpen } from 'lucide-react';
import { collection, onSnapshot, query, where, deleteDoc, doc, getDoc, limit } from 'firebase/firestore';
import { db, auth } from '../firebase';
import AdminCourseEditor, { Course } from './AdminCourseEditor';
import { useAdminHeader, HeaderActionButton } from './AdminScreenHeader';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope } from '../utils/tenant-scope';
import { sortByTime } from '../utils/query-helpers';



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
     const fetchedCourses = snapshot.docs.map(doc => ({
       id: doc.id,
       ...doc.data()
     })) as Course[];
     setCourses(sortByTime(fetchedCourses, 'createdAt', 'desc'));
     setLoading(false);
   }, (error) => {
     try { handleFirestoreError(error, OperationType.GET, `courses`); } catch (e) { console.error(e); }
     setLoading(false);
   });
 })();

 return () => { if (unsubscribe) unsubscribe(); };
 }, []);

 const filteredCourses = courses.filter(course => {
 const matchesSearch = 
 (course.title?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
 (course.author?.toLowerCase() || '').includes(searchQuery.toLowerCase());
 return matchesSearch;
 });

 const getStatusColor = (status: string) => {
 switch (status) {
 case 'published': return 'bg-green-100 text-green-800 ';
 case 'draft': return 'bg-gray-100 text-gray-800 ';
 default: return 'bg-gray-100 text-gray-800 ';
 }
 };

 const handleNewCourse = () => {
 setEditingCourse(null);
 setIsEditorOpen(true);
 };

 const { setHeaderAction } = useAdminHeader();
 useEffect(() => {
   setHeaderAction(<HeaderActionButton label="New Course" onClick={() => handleNewCourse()} />);
   return () => setHeaderAction(null);
 }, [setHeaderAction]);

 const handleEditCourse = (course: Course) => {
 setEditingCourse(course);
 setIsEditorOpen(true);
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

 return (
 <div className="space-y-6 lg:max-w-5xl lg:mx-auto w-full">
 {errorMessage && (
 <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-medium border border-red-100">
 {errorMessage}
 </div>
 )}
 {isEditorOpen && (
 <AdminCourseEditor 
 course={editingCourse} 
 onClose={() => setIsEditorOpen(false)} 
 />
 )}

 <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
 {/* Filters Bar */}
 <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row gap-4">
 <div className="relative flex-1">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
 <input 
 type="text" 
 placeholder="Search by title or author..." 
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#d4a017] focus:border-transparent outline-none text-gray-900 transition-all"
 />
 </div>
 </div>

 {/* Table */}
 <div className="overflow-x-auto">
 <table className="w-full text-left border-collapse">
 <thead>
 <tr className="bg-gray-50/50 border-b border-gray-100 ">
 <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Title</th>
 <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Author</th>
 <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
 <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">Actions</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-gray-100 ">
 {loading ? (
 <tr>
 <td colSpan={4} className="px-6 py-8 text-center text-gray-500 ">
 <div className="flex items-center justify-center gap-2">
 <div className="w-4 h-4 border-2 border-[#d4a017] border-t-transparent rounded-full animate-spin"></div>
 <span>Loading courses...</span>
 </div>
 </td>
 </tr>
 ) : filteredCourses.length === 0 ? (
 <tr>
 <td colSpan={4} className="px-6 py-12 text-center text-gray-500 ">
 <div className="flex flex-col items-center justify-center gap-2">
 <BookOpen size={32} className="text-gray-300 mb-2" />
 <p className="text-base font-medium text-gray-900 ">No courses found</p>
 <p className="text-sm">Get started by creating a new course.</p>
 </div>
 </td>
 </tr>
 ) : (
 filteredCourses.map((course) => (
 <tr key={course.id} className="hover:bg-gray-50 :bg-[#1a1d27] transition-colors group">
 <td className="px-6 py-4">
 <p className="text-sm font-medium text-gray-900 line-clamp-1">{course.title}</p>
 </td>
 <td className="px-6 py-4">
 <span className="text-sm text-gray-600 ">{course.author}</span>
 </td>
 <td className="px-6 py-4">
 <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium capitalize ${getStatusColor(course.status)}`}>
 {course.status}
 </span>
 </td>
 <td className="px-6 py-4 text-right">
 <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
 <button 
 onClick={() => handleEditCourse(course)}
 className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 :bg-blue-900/30 rounded-lg transition-colors"
 >
 <Edit2 size={16} />
 </button>
 <button 
 onClick={() => setDeleteConfirmId(course.id || null)}
 className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 :bg-red-900/30 rounded-lg transition-colors"
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
 </div>

 {/* Delete Confirmation Modal */}
 {deleteConfirmId && (
 <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
 <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 border border-gray-100 ">
 <h3 className="text-xl font-bold text-gray-900 mb-2">Delete Course</h3>
 <p className="text-gray-500 mb-6">
 Are you sure you want to delete this course? This action cannot be undone.
 </p>
 <div className="flex justify-end gap-3">
 <button
 onClick={() => setDeleteConfirmId(null)}
 className="px-4 py-2 text-gray-600 hover:bg-gray-100 :bg-gray-800 rounded-xl font-medium transition-colors"
 >
 Cancel
 </button>
 <button
 onClick={() => handleDeleteCourse(deleteConfirmId)}
 className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-medium transition-colors"
 >
 Delete
 </button>
 </div>
 </div>
 </div>
 )}
 </div>
 );
};

export default AdminCourses;
