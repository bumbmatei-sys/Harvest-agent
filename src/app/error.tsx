"use client";

import React, { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background-dark px-4 py-12">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl overflow-hidden p-8 text-center">
        <span className="material-symbols-outlined text-red-500 text-6xl mb-4">error</span>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Something went wrong!</h1>
        <p className="text-gray-600 mb-6">{error.message || "An unexpected error occurred."}</p>
        <button
          onClick={() => reset()}
          className="bg-primary text-white font-bold py-3 px-6 rounded-xl hover:bg-yellow-600 transition-all shadow-lg shadow-primary/30"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
