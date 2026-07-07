"use client";
import React, { ErrorInfo, ReactNode } from 'react';

interface Props {
 children?: ReactNode;
}

interface State {
 hasError: boolean;
 error: Error | null;
}

class ErrorBoundary extends React.Component<Props, State> {
 public state: State = {
 hasError: false,
 error: null
 };

 public static getDerivedStateFromError(error: Error): State {
 return { hasError: true, error };
 }

 public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
 try {
 console.error("Uncaught error:", error.message || String(error), errorInfo.componentStack);
 } catch (e) {
 console.error("Uncaught error (could not stringify)");
 }
 }

 public render() {
 if (this.state.hasError) {
 let errorMessage = "An unexpected error occurred.";
 try {
 if (this.state.error?.message) {
 const parsed = JSON.parse(this.state.error.message);
 if (parsed.error) {
 errorMessage = parsed.error;
 }
 }
 } catch (e) {
 errorMessage = this.state.error?.message || errorMessage;
 }

 return (
 <div className="min-h-screen flex items-center justify-center bg-background-dark px-4 py-12">
 <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl overflow-hidden p-8 text-center">
 <span className="material-symbols-outlined text-red-500 text-6xl mb-4">error</span>
 <h1 className="text-2xl font-bold text-gray-900 mb-2 font-display">Something went wrong</h1>
 <p className="text-gray-600 mb-6">{errorMessage}</p>
 <button
 onClick={() => window.location.reload()}
 className="bg-primary text-white font-bold py-3 px-6 rounded-xl hover:bg-yellow-600 transition-all shadow-lg shadow-primary/30"
 >
 Reload Page
 </button>
 </div>
 </div>
 );
 }

 return this.props.children;
 }
}

export default ErrorBoundary;