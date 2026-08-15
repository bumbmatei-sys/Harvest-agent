"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { getPlaceholderImage } from '@/utils/placeholder';
import { BookOpen, Clock, ChevronRight } from 'lucide-react';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { fetchMemberCourses, type MemberCourse } from '../utils/member-courses';


interface CoursesTabProps {
 onOpenCourse?: (course: MemberCourse) => void;
}

/**
 * The member course list: the church's own published courses AND the library
 * courses it has adopted (THE-140).
 *
 * The read, the published/adoptable filter and the merge all live in
 * utils/member-courses — the same call MainApp's Courses-tab gate makes, so the
 * tab cannot be shown over an empty list or hidden over a full one. Reading
 * /courses here directly is exactly how adopted courses came to be invisible.
 */
const CoursesTab: React.FC<CoursesTabProps> = ({ onOpenCourse }) => {
 const [courses, setCourses] = useState<MemberCourse[]>([]);
 const [loading, setLoading] = useState(true);

 useEffect(() => {
 const fetchCourses = async () => {
 try {
 setCourses(await fetchMemberCourses());
 } catch (error) {
 handleFirestoreError(error, OperationType.GET, `courses`);
 } finally {
 setLoading(false);
 }
 };

 fetchCourses();
 }, []);

 if (loading) {
 return (
 <div className="flex flex-col items-center justify-center h-64">
 <div className="w-8 h-8 border-4 border-gold border-t-transparent rounded-full animate-spin"></div>
 <p className="mt-4 text-muted font-medium">Loading courses...</p>
 </div>
 );
 }

 if (courses.length === 0) {
 return (
 <div className="flex flex-col items-center justify-center h-64 text-center px-4">
 <div className="w-16 h-16 bg-surface-sunken rounded-full flex items-center justify-center mb-4">
 <BookOpen size={32} className="text-faint " />
 </div>
 <h3 className="text-lg font-bold text-strong mb-2 font-display">No Courses Available</h3>
 <p className="text-muted text-sm max-w-xs">
 Check back later for new educational content and courses.
 </p>
 </div>
 );
 }

 return (
 <div className="space-y-6 pb-24 lg:max-w-5xl lg:mx-auto w-full">
 <div className="flex justify-between items-end mb-2">
 <div>
 <h2 className="text-2xl font-bold text-strong font-display">Available Courses</h2>
 <p className="text-sm text-muted mt-1">Expand your knowledge and faith.</p>
 </div>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 {courses.map((course) => (
 <div 
 key={course.id}
 onClick={() => onOpenCourse && onOpenCourse(course)}
 className="bg-surface-raised rounded-2xl overflow-hidden shadow-sm border border-line cursor-pointer hover:shadow-md transition-shadow group flex flex-col"
 >
 <div className="relative h-48 w-full bg-surface-chip overflow-hidden">
 <Image 
 src={course.coverImage || getPlaceholderImage(course.id ?? '', 600, 400)} 
 alt={course.title}
 fill
 sizes="(max-width: 768px) 100vw, 50vw"
 className="object-cover group-hover:scale-105 transition-transform duration-500"
 referrerPolicy="no-referrer"
 />
 <div className="absolute top-3 left-3">
 <span className="bg-black/60 backdrop-blur-md text-white text-xs font-bold px-3 py-1.5 rounded-full uppercase tracking-wider">
 {course.category}
 </span>
 </div>
 </div>
 
 <div className="p-5 flex flex-col flex-1">
 <h3 className="text-lg font-bold text-strong mb-2 line-clamp-2 group-hover:text-gold transition-colors">
 {course.title}
 </h3>
 
 <div className="flex items-center gap-2 text-sm text-muted mb-4">
 <span className="font-medium text-body ">{course.author}</span>
 </div>
 
 <div className="mt-auto pt-4 border-t border-line flex items-center justify-between">
 <div className="flex items-center gap-1.5 text-gold text-sm font-bold">
 <span>View Course</span>
 <ChevronRight size={16} />
 </div>
 </div>
 </div>
 </div>
 ))}
 </div>
 </div>
 );
};

export default CoursesTab;
