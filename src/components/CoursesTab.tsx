"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { BookOpen, Clock, ChevronRight } from 'lucide-react';
import { Course } from './AdminCourseEditor';


enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo?: any[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
      isAnonymous: auth?.currentUser?.isAnonymous,
      tenantId: auth?.currentUser?.tenantId,
      providerInfo: auth?.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface CoursesTabProps {
 onOpenCourse?: (course: Course) => void;
}

const CoursesTab: React.FC<CoursesTabProps> = ({ onOpenCourse }) => {
 const [courses, setCourses] = useState<Course[]>([]);
 const [loading, setLoading] = useState(true);

 useEffect(() => {
 const fetchCourses = async () => {
 try {
 const q = query(
 collection(db, 'courses'),
 where('status', '==', 'published'),
 orderBy('createdAt', 'desc'),
 limit(50)
 );
 const querySnapshot = await getDocs(q);
 const fetchedCourses: Course[] = [];
 querySnapshot.forEach((doc) => {
 fetchedCourses.push({ id: doc.id, ...doc.data() } as Course);
 });
 setCourses(fetchedCourses);
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
 <div className="w-8 h-8 border-4 border-[#d4a017] border-t-transparent rounded-full animate-spin"></div>
 <p className="mt-4 text-gray-500 font-medium">Loading courses...</p>
 </div>
 );
 }

 if (courses.length === 0) {
 return (
 <div className="flex flex-col items-center justify-center h-64 text-center px-4">
 <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
 <BookOpen size={32} className="text-gray-400 " />
 </div>
 <h3 className="text-lg font-bold text-gray-900 mb-2">No Courses Available</h3>
 <p className="text-gray-500 text-sm max-w-xs">
 Check back later for new educational content and courses.
 </p>
 </div>
 );
 }

 return (
 <div className="space-y-6 pb-24 lg:max-w-5xl lg:mx-auto w-full">
 <div className="flex justify-between items-end mb-2">
 <div>
 <h2 className="text-2xl font-bold text-gray-900 ">Available Courses</h2>
 <p className="text-sm text-gray-500 mt-1">Expand your knowledge and faith.</p>
 </div>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 {courses.map((course) => (
 <div 
 key={course.id}
 onClick={() => onOpenCourse && onOpenCourse(course)}
 className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 cursor-pointer hover:shadow-md transition-shadow group flex flex-col"
 >
 <div className="relative h-48 w-full bg-gray-200 overflow-hidden">
 <Image 
 src={course.coverImage || `https://picsum.photos/seed/${course.id}/600/400`} 
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
 <h3 className="text-lg font-bold text-gray-900 mb-2 line-clamp-2 group-hover:text-[#d4a017] transition-colors">
 {course.title}
 </h3>
 
 <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
 <span className="font-medium text-gray-700 ">{course.author}</span>
 </div>
 
 <div className="mt-auto pt-4 border-t border-gray-100 flex items-center justify-between">
 <div className="flex items-center gap-1.5 text-[#d4a017] text-sm font-bold">
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
