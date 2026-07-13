import React, { useState, useRef } from 'react';
import { Image as ImageIcon, X, RefreshCw, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { auth } from '../firebase';

interface ImageUploadProps {
  value: string;
  onChange: (url: string) => void;
  placeholder?: string;      // kept for backward-compat; no longer renders a URL field
  className?: string;
  rounded?: boolean;         // round thumbnail for avatars (default false)
  label?: string;            // empty-state primary text, e.g. "Add thumbnail" (default "Add image")
}

export function ImageUpload({ value, onChange, className = '', rounded = false, label }: ImageUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError(null);

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        setError('You must be signed in to upload images.');
        return;
      }

      // 1. Ask our API for a short-lived presigned R2 PUT URL. A thrown fetch
      // here means the request never reached our server (offline / DNS), which
      // is a different failure than the server rejecting the file — say so.
      let presignRes: Response;
      try {
        presignRes = await fetch('/api/storage/presign', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            fileName: file.name,
            contentType: file.type,
            fileSize: file.size,
          }),
        });
      } catch {
        throw new Error("Couldn't reach the server. Check your connection and try again.");
      }

      if (!presignRes.ok) {
        // Surface the ACTUAL reason the server gave (e.g. "Image exceeds the
        // 4MB limit", "Only image uploads are allowed") instead of a generic
        // message, so the user knows whether it's a too-large file or a real error.
        const data = await presignRes.json().catch(() => ({}));
        throw new Error(data?.error || `Upload could not be prepared (error ${presignRes.status}).`);
      }

      const { uploadUrl, publicUrl } = await presignRes.json();

      // 2. Upload the file bytes directly to R2. Distinguish a network failure
      // reaching R2 from R2 rejecting the request.
      let putRes: Response;
      try {
        putRes = await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type },
        });
      } catch {
        throw new Error("Couldn't reach the storage server to upload the image. Please try again.");
      }

      if (!putRes.ok) {
        throw new Error(`The storage server rejected the upload (error ${putRes.status}).`);
      }

      // 3. Save the public URL.
      onChange(publicUrl);
    } catch (err: any) {
      console.error('Error uploading image:', err);
      setError(err?.message || 'Failed to upload image. Please try again.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className={`w-full space-y-3 ${className}`}>
      {error && (
        <div className="text-red-500 text-sm bg-red-50 p-2 rounded-md">
          {error}
        </div>
      )}

      {isUploading ? (
        /* ── Uploading ── */
        <div className="flex items-center gap-3 w-full px-3 py-2.5 border border-gray-200 rounded-xl bg-white">
          <div className="w-10 h-10 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-gold shrink-0">
            <Loader2 size={20} className="animate-spin" />
          </div>
          <span className="text-sm font-medium text-gray-600">Uploading…</span>
        </div>
      ) : value ? (
        /* ── Filled: compact thumbnail ── */
        <div className="flex items-center gap-3 w-full p-2 border border-gray-200 rounded-xl bg-white">
          <Image
            src={value}
            alt="Preview"
            width={56}
            height={56}
            className={`w-14 h-14 object-cover shrink-0 ${rounded ? 'rounded-full' : 'rounded-lg'}`}
            referrerPolicy="no-referrer"
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-700 truncate">Image attached</div>
            <div className="text-xs text-gray-400 truncate">Tap replace to change it</div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-[34px] h-[34px] flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
              title="Replace image"
            >
              <RefreshCw size={16} />
            </button>
            <button
              type="button"
              onClick={() => onChange('')}
              className="w-[34px] h-[34px] flex items-center justify-center rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors"
              title="Remove image"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      ) : (
        /* ── Empty: compact attach control ── */
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-3 w-full px-3 py-2.5 border border-dashed border-gray-300 rounded-xl bg-gray-50 hover:border-gold hover:bg-white transition-colors text-left"
        >
          <div className="w-10 h-10 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-gray-400 shrink-0">
            <ImageIcon size={20} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-700">{label ?? 'Add image'}</div>
            <div className="text-xs text-gray-400">PNG, JPG, GIF up to 4MB</div>
          </div>
        </button>
      )}

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleUpload}
        accept="image/*"
        className="hidden"
      />
    </div>
  );
}
