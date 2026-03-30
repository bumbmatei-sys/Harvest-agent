"use client";
import React from 'react';
import Image from 'next/image';
import { ArrowLeft, Clock, User, BookOpen, PlayCircle, CheckCircle2 } from 'lucide-react';
import { Course } from './AdminCourseEditor';

interface CourseDetailsProps {
  course: Course;
  onBack: () => void;
}

const CourseDetails: React.FC<CourseDetailsProps> = ({ course, onBack }) => {
  return (
    <div className="fixed inset-0 z-50 bg-[#f8f9fa] dark:bg-[#1a1d27] overflow-y-auto flex flex-col animate-fade-in">
      {/* Header Image */}
      <div className="relative h-64 sm:h-80 w-full flex-shrink-0">
        <Image 
          src={course.coverImage || `https://picsum.photos/seed/${course.id}/1200/600`} 
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
          <span className="inline-block bg-[#d4a017] text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider mb-3">
            {course.category}
          </span>
          <h1 className="text-3xl sm:text-4xl font-bold mb-2 leading-tight">{course.title}</h1>
          <div className="flex items-center gap-4 text-sm text-gray-300">
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
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">About this course</h2>
              <div className="prose dark:prose-invert max-w-none text-gray-600 dark:text-gray-300">
                <div dangerouslySetInnerHTML={{ __html: course.description }} />
              </div>
            </section>

            {/* Curriculum Placeholder */}
            <section>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <BookOpen size={20} className="text-[#d4a017]" />
                Curriculum
              </h2>
              <div className="bg-white dark:bg-[#252a36] rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-gray-900 dark:text-white">Module 1: Introduction</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Getting started with the basics</p>
                  </div>
                </div>
                <div className="divide-y divide-gray-50 dark:divide-gray-800/50">
                  {[1, 2, 3].map((lesson) => (
                    <div key={lesson} className="p-4 flex items-center gap-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer group">
                      <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 dark:text-gray-400 group-hover:bg-[#d4a017] group-hover:text-white transition-colors">
                        <PlayCircle size={16} />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-sm font-medium text-gray-900 dark:text-white">Lesson {lesson}: Foundation</h4>
                        <p className="text-xs text-gray-500 dark:text-gray-400">10:00 mins</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-white dark:bg-[#252a36] rounded-2xl p-6 border border-gray-100 dark:border-gray-800 sticky top-6">
              <h3 className="font-bold text-gray-900 dark:text-white mb-4">Course Features</h3>
              <ul className="space-y-4">
                <li className="flex items-start gap-3 text-sm text-gray-600 dark:text-gray-300">
                  <CheckCircle2 size={18} className="text-[#d4a017] flex-shrink-0 mt-0.5" />
                  <span>Self-paced learning</span>
                </li>
                <li className="flex items-start gap-3 text-sm text-gray-600 dark:text-gray-300">
                  <CheckCircle2 size={18} className="text-[#d4a017] flex-shrink-0 mt-0.5" />
                  <span>Access on mobile and desktop</span>
                </li>
                <li className="flex items-start gap-3 text-sm text-gray-600 dark:text-gray-300">
                  <CheckCircle2 size={18} className="text-[#d4a017] flex-shrink-0 mt-0.5" />
                  <span>Certificate of completion</span>
                </li>
              </ul>

              <button className="w-full mt-8 bg-[#d4a017] hover:bg-[#b8860b] text-white font-bold py-3.5 rounded-xl transition-colors shadow-md flex items-center justify-center gap-2">
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
