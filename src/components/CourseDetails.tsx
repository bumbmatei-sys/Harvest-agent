"use client";
import React from 'react';
import { sanitizeHtml } from '../utils/sanitize';
import Image from 'next/image';
import { ArrowLeft, Clock, User, BookOpen, PlayCircle, CheckCircle2 } from 'lucide-react';
import { getPlaceholderImage } from '@/utils/placeholder';
import { Course } from './AdminCourseEditor';

interface CourseDetailsProps {
 course: Course;
 onBack: () => void;
}

const CourseDetails: React.FC<CourseDetailsProps> = ({ course, onBack }) => {
 return (
 <div className="fixed inset-0 z-50 bg-cream overflow-y-auto flex flex-col animate-fade-in">
 {/* Header Image */}
 <div className="relative h-64 sm:h-80 w-full flex-shrink-0">
 <Image 
 src={course.coverImage || getPlaceholderImage(course.id, 1200, 600)} 
 alt={course.title}
 fill
 sizes="100vw"
 className="object-cover"
 referrerPolicy="no-referrer"
 />
 <div className="absolute inset-0 bg-gradient-to-t from-[#1a1d27] via-[#1a1d27]/60 to-transparent" />
 
 <button 
 onClick={onBack}
 className="absolute top-4 left-4 z-10 w-10 h-10 bg-black/20 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-black/40 transition-colors"
 >
 <ArrowLeft size={20} />
 </button>

 <div className="absolute bottom-6 left-0 w-full px-4 sm:px-8 text-white">
 <span className="inline-block bg-gold text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider mb-3">
 {course.category}
 </span>
 <h1 className="text-3xl sm:text-4xl font-bold mb-2 leading-tight font-display">{course.title}</h1>
 <div className="flex items-center gap-4 text-sm text-stone-300">
 <div className="flex items-center gap-1.5">
 <User size={16} />
 <span>{course.author}</span>
 </div>
 </div>
 </div>
 </div>

 {/* Content */}
 <div className="flex-1 px-4 sm:px-8 py-6 max-w-4xl mx-auto w-full">
 <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
 
 {/* Main Column */}
 <div className="lg:col-span-2 space-y-8">
 {/* About this course */}
 <section>
 <h2 className="text-xl font-bold text-earth mb-4 font-display">About this course</h2>
 <div className="prose max-w-none text-warm-brown ">
 <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(course.description) }} />
 </div>
 </section>

 {/* Curriculum Placeholder */}
 <section>
 <h2 className="text-xl font-bold text-earth mb-4 flex items-center gap-2 font-display">
 <BookOpen size={20} className="text-gold" />
 Curriculum
 </h2>
 <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
 <div className="p-4 border-b border-stone-200 flex items-center justify-between">
 <div>
 <h3 className="font-bold text-earth ">Module 1: Introduction</h3>
 <p className="text-sm text-warm-brown ">Getting started with the basics</p>
 </div>
 </div>
 <div className="divide-y divide-gray-50 ">
 {[1, 2, 3].map((lesson) => (
 <div key={lesson} className="p-4 flex items-center gap-4 hover:bg-stone-100 :bg-gray-800/50 transition-colors cursor-pointer group">
 <div className="w-8 h-8 rounded-full bg-stone-100 flex items-center justify-center text-warm-brown group-hover:bg-gold group-hover:text-white transition-colors">
 <PlayCircle size={16} />
 </div>
 <div className="flex-1">
 <h4 className="text-sm font-medium text-earth ">Lesson {lesson}: Foundation</h4>
 <p className="text-xs text-warm-brown ">10:00 mins</p>
 </div>
 </div>
 ))}
 </div>
 </div>
 </section>
 </div>

 {/* Sidebar */}
 <div className="lg:col-span-1">
 <div className="bg-white rounded-2xl p-6 border border-stone-200 sticky top-6">
 <h3 className="font-bold text-earth mb-4 font-display">Course Features</h3>
 <ul className="space-y-4">
 <li className="flex items-start gap-3 text-sm text-warm-brown ">
 <CheckCircle2 size={18} className="text-gold flex-shrink-0 mt-0.5" />
 <span>Self-paced learning</span>
 </li>
 <li className="flex items-start gap-3 text-sm text-warm-brown ">
 <CheckCircle2 size={18} className="text-gold flex-shrink-0 mt-0.5" />
 <span>Access on mobile and desktop</span>
 </li>
 <li className="flex items-start gap-3 text-sm text-warm-brown ">
 <CheckCircle2 size={18} className="text-gold flex-shrink-0 mt-0.5" />
 <span>Certificate of completion</span>
 </li>
 </ul>

 <button className="w-full mt-8 bg-gold hover:bg-[color-mix(in_srgb,var(--brand-color)_85%,black)] text-white font-bold py-3.5 rounded-xl transition-colors shadow-md flex items-center justify-center gap-2">
 <PlayCircle size={20} />
 Start Course
 </button>
 </div>
 </div>

 </div>
 </div>
 </div>
 );
};

export default CourseDetails;
