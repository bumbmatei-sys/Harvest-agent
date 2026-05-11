import React, { useState, useRef } from 'react';
import { Upload, X, Loader2 } from 'lucide-react';
import Image from 'next/image';

interface ImageUploadProps {
  value: string;
  onChange: (url: string) => void;
  placeholder?: string;
  className?: string;
}

export function ImageUpload({ value, onChange, placeholder, className = '' }: ImageUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', 'Harvest'); // The unsigned preset name provided by the user

    try {
      // The cloud name provided by the user is 'dvpohwjor'
      const response = await fetch('https://api.cloudinary.com/v1_1/dvpohwjor/image/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const data = await response.json();
      onChange(data.secure_url);
    } catch (err: any) {
      console.error('Error uploading image to Cloudinary:', err);
      setError('Failed to upload image. Please try again.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className={`w-full space-y-4 ${className}`}>
      {error && (
        <div className="text-red-500 text-sm bg-red-50 p-2 rounded-md">
          {error}
        </div>
      )}
      
      <div className="w-full space-y-2">
        {value ? (
          <div className="relative w-full h-48 rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
              <Image 
                src={value} 
                alt="Preview" 
                fill 
                sizes="(max-width: 768px) 100vw, 400px" 
                className="object-contain" 
                referrerPolicy="no-referrer"
              />
              <button
                type="button"
                onClick={() => onChange('')}
                className="absolute top-2 right-2 bg-white/90 p-1.5 rounded-full shadow-sm hover:bg-white text-gray-700 hover:text-red-600 transition-colors"
                title="Remove image"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="w-full h-48 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 flex flex-col items-center justify-center text-gray-500 hover:bg-gray-100 hover:border-gray-400 transition-colors cursor-pointer"
            >
              <Upload size={24} className="mb-2" />
              <span className="text-sm font-medium">Click to upload image</span>
              <span className="text-xs text-gray-400 mt-1">PNG, JPG, GIF up to 10MB</span>
            </div>
          )}
          
          <div className="flex gap-2 w-full">
            <input
              type="text"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder || "Or paste image URL here"}
              className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
              disabled={isUploading}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="px-4 py-2 bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200 font-medium text-sm flex items-center justify-center min-w-[100px]"
            >
              {isUploading ? (
                <>
                  <Loader2 size={16} className="animate-spin mr-2" />
                  Uploading
                </>
              ) : (
                'Upload'
              )}
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleUpload}
              accept="image/*"
              className="hidden"
            />
          </div>
      </div>
    </div>
  );
}
