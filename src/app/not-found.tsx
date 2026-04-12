"use client";

import React from 'react';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background-dark px-4 py-12">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl overflow-hidden p-8 text-center">
        <span className="material-symbols-outlined text-red-500 text-6xl mb-4">error</span>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">404 - Page Not Found</h1>
        <p className="text-gray-600 mb-6">The page you are looking for does not exist.</p>
        <button
          onClick={() => window.location.href = '/'}
          className="bg-primary text-white font-bold py-3 px-6 rounded-xl hover:bg-yellow-600 transition-all shadow-lg shadow-primary/30"
        >
          Go Home
        </button>
      </div>
    </div>
  );
}
