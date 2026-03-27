"use client";
import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Plus } from 'lucide-react';
import { collection, addDoc, updateDoc, doc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import RichTextEditor from './RichTextEditor';

export interface Course {
  id?: string;
  title: string;
  author: string;
  category: string;
  description: string;
  coverImage: string;
  status: 'published' | 'draft';
  createdAt?: string;
}

interface AdminCourseEditorProps {
  course?: Course | null;
  onClose: () => void;
}

const AdminCourseEditor: React.FC<AdminCourseEditorProps> = ({ course, onClose }) => {
  const [title, setTitle] = useState(course?.title || '');
  const [author, setAuthor] = useState(course?.author || '');
  const [category, setCategory] = useState(course?.category || 'Agronomy');
  const [description, setDescription] = useState(course?.description || '');
  const [coverImage, setCoverImage] = useState(course?.coverImage || '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const categories = ['Agronomy', 'Theology', 'Leadership', 'Music', 'Technology'];

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    if (!author.trim()) {
      setError('Author is required');
      return;
    }
    if (!category) {
      setError('Category is required');
      return;
    }
    
    setIsSaving(true);
    setError('');

    try {
      const courseData = {
        title: title.trim(),
        author: author.trim(),
        category,
        description,
        coverImage: coverImage.trim(),
        status: course?.status || 'draft',
        updatedAt: new Date().toISOString(),
      };

      if (course?.id) {
        await updateDoc(doc(db, 'courses', course.id), courseData);
      } else {
        await addDoc(collection(db, 'courses'), {
          ...courseData,
          createdAt: new Date().toISOString(),
        });
      }
      onClose();
    } catch (err: any) {
      console.error('Error saving course:', err);
      setError(err.message || 'Failed to save course');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#f8f9fa] dark:bg-[#1a1d27]">
      {/* Header */}
      <div className="bg-white dark:bg-[#252a36] px-4 py-4 flex items-center shadow-sm z-10">
        <button 
          onClick={onClose}
          className="p-2 -ml-2 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 mr-2"
        >
          <ArrowLeft size={24} />
        </button>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">
          {course ? 'Edit Course' : 'Create New Course'}
        </h1>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
        <div className="max-w-3xl mx-auto bg-white dark:bg-[#252a36] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-6 sm:p-8 space-y-8">
          
          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm font-medium">
              {error}
            </div>
          )}

          {/* Title */}
          <div className="space-y-2">
            <label className="block text-xs font-bold tracking-wider text-gray-900 dark:text-white uppercase">Course Title</label>
            <input 
              type="text" 
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Sustainable Harvesting 101"
              className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1d27] border border-transparent rounded-xl text-gray-900 dark:text-white focus:bg-white dark:focus:bg-[#252a36] focus:ring-2 focus:ring-[#d4a017] focus:border-transparent outline-none transition-all text-base"
            />
          </div>

          {/* Author */}
          <div className="space-y-2">
            <label className="block text-xs font-bold tracking-wider text-gray-900 dark:text-white uppercase">Author</label>
            <div className="flex gap-2">
              <input 
                type="text" 
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Course Author"
                className="flex-1 px-4 py-3 bg-gray-50 dark:bg-[#1a1d27] border border-transparent rounded-xl text-gray-900 dark:text-white focus:bg-white dark:focus:bg-[#252a36] focus:ring-2 focus:ring-[#d4a017] focus:border-transparent outline-none transition-all text-base"
              />
              <button 
                type="button"
                className="w-12 h-12 flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                <Plus size={20} />
              </button>
            </div>
          </div>

          {/* Category */}
          <div className="space-y-2">
            <label className="block text-xs font-bold tracking-wider text-gray-900 dark:text-white uppercase">Category</label>
            <div className="relative">
              <select 
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1d27] border border-transparent rounded-xl text-gray-900 dark:text-white focus:bg-white dark:focus:bg-[#252a36] focus:ring-2 focus:ring-[#d4a017] focus:border-transparent outline-none transition-all text-base appearance-none"
              >
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6"/>
                </svg>
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="block text-xs font-bold tracking-wider text-gray-900 dark:text-white uppercase">Description</label>
            <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
              <RichTextEditor content={description} onChange={setDescription} />
            </div>
          </div>

          {/* Cover Image */}
          <div className="space-y-2">
            <label className="block text-xs font-bold tracking-wider text-gray-900 dark:text-white uppercase">Course Cover Image URL</label>
            <input 
              type="text" 
              value={coverImage}
              onChange={(e) => setCoverImage(e.target.value)}
              placeholder="https://example.com/image.jpg"
              className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1a1d27] border border-transparent rounded-xl text-gray-900 dark:text-white focus:bg-white dark:focus:bg-[#252a36] focus:ring-2 focus:ring-[#d4a017] focus:border-transparent outline-none transition-all text-base"
            />
            {coverImage && (
              <div className="mt-4 relative rounded-xl overflow-hidden h-48 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                <img 
                  src={coverImage} 
                  alt="Cover preview" 
                  className="w-full h-full object-cover" 
                  referrerPolicy="no-referrer" 
                  onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/600x400?text=Invalid+Image+URL'; }} 
                />
              </div>
            )}
          </div>

          {/* Action Button */}
          <div className="pt-6">
            <button 
              onClick={handleSave}
              disabled={isSaving}
              className="w-full py-4 bg-[#d4a017] hover:bg-[#b8860b] text-white rounded-xl font-bold tracking-wider uppercase flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-md"
            >
              <span>Next: Curriculum</span>
              <ArrowRight size={20} />
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};

export default AdminCourseEditor;
