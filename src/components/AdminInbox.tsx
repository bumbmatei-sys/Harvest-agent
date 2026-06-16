"use client";
import React, { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc, deleteDoc, limit } from 'firebase/firestore';
import { Mail, MapPin, Lightbulb, HeartHandshake, Church, CheckCircle, Trash2, Clock, ChevronDown, ChevronUp, Inbox } from 'lucide-react';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope } from '../utils/tenant-scope';



const AdminInbox = () => {
 const [submissions, setSubmissions] = useState<any[]>([]);
 const [loading, setLoading] = useState(true);
 const [expandedId, setExpandedId] = useState<string | null>(null);
 const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
 const [filterType, setFilterType] = useState<string>('all');

 useEffect(() => {
 let unsubscribe: (() => void) | null = null;

 const loadSubmissions = async () => {
   const tenantId = await getTenantScope();
   const q = tenantId
     ? query(collection(db, 'submissions'), where('tenantId', '==', tenantId), orderBy('createdAt', 'desc'), limit(50))
     : query(collection(db, 'submissions'), orderBy('createdAt', 'desc'), limit(50));

   unsubscribe = onSnapshot(q, (snapshot) => {
     const subs: any[] = [];
     snapshot.forEach((doc) => {
       subs.push({ id: doc.id, ...doc.data() });
 });
 setSubmissions(subs);
 setLoading(false);
 }, (error) => {
 try { handleFirestoreError(error, OperationType.GET, `submissions`); } catch (e) { console.error(e); }
 setLoading(false);
 if (error instanceof Error && error.message.includes('offline')) {
 alert("You are offline. Please check your connection.");
 }
 });

 loadSubmissions();
 return () => { if (unsubscribe) unsubscribe(); };
 }, []);

 const handleStatusChange = async (id: string, newStatus: string) => {
 try {
 await updateDoc(doc(db, 'submissions', id), {
 status: newStatus
 });
 } catch (error) {
 try { handleFirestoreError(error, OperationType.UPDATE, `submissions/${id}`); } catch (e) { console.error(e); }
 }
 };

 const handleDelete = async (id: string) => {
 try {
 await deleteDoc(doc(db, 'submissions', id));
 setDeleteConfirmId(null);
 } catch (error) {
 try { handleFirestoreError(error, OperationType.DELETE, `submissions/${id}`); } catch (e) { console.error(e); }
 }
 };

 const toggleExpand = (id: string) => {
 setExpandedId(expandedId === id ? null : id);
 };

 const getIconForType = (type: string) => {
 switch (type) {
 case 'contact': return <Mail size={20} className="text-blue-500" />;
 case 'church_suggestion': return <MapPin size={20} className="text-green-500" />;
 case 'feature': return <Lightbulb size={20} className="text-purple-500" />;
 case 'prayer': return <HeartHandshake size={20} className="text-orange-500" />;
 case 'enrollment': return <Church size={20} className="text-[#d4a017]" />;
 default: return <Mail size={20} className="text-gray-500" />;
 }
 };

 const getTitleForType = (type: string) => {
 switch (type) {
 case 'contact': return 'Contact Support';
 case 'church_suggestion': return 'Church Suggestion';
 case 'feature': return 'Feature Request';
 case 'prayer': return 'Prayer Request';
 case 'enrollment': return 'Church Enrollment';
 default: return 'Submission';
 }
 };

 const formatDate = (isoString: string) => {
 const date = new Date(isoString);
 return new Intl.DateTimeFormat('en-US', {
 month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
 }).format(date);
 };

 const filteredSubmissions = submissions.filter(sub => {
 if (filterType === 'all') return true;
 if (filterType === 'general') return sub.type === 'contact';
 return sub.type === filterType;
 });

 if (loading) {
 return (
 <div className="flex items-center justify-center h-full">
 <div className="w-8 h-8 border-4 border-[#d4a017]/30 border-t-[#d4a017] rounded-full animate-spin"></div>
 </div>
 );
 }

 return (
 <div className="space-y-4">
 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
 <h2 className="text-2xl font-bold text-gray-900 ">Inbox</h2>
 
 <div className="flex overflow-x-auto gap-2 pb-2 sm:pb-0 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
 {['all', 'general', 'prayer', 'feature', 'church_suggestion'].map((type) => (
 <button
 key={type}
 onClick={() => setFilterType(type)}
 className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
 filterType === type
 ? 'bg-[#d4a017] text-white'
 : 'bg-white text-gray-600 border border-gray-200 hover:border-[#d4a017] :border-[#d4a017]'
 }`}
 >
 {type === 'church_suggestion' ? 'Church Suggestion' : type.charAt(0).toUpperCase() + type.slice(1)}
 </button>
 ))}
 </div>
 </div>
 
 {submissions.length === 0 ? (
 <div className="flex flex-col items-center justify-center py-12 text-gray-400 bg-white rounded-2xl border border-gray-100 ">
 <Inbox size={48} className="mb-4 opacity-50" />
 <p className="text-lg font-medium">No submissions yet.</p>
 </div>
 ) : filteredSubmissions.length === 0 ? (
 <div className="flex flex-col items-center justify-center py-12 text-gray-400 bg-white rounded-2xl border border-gray-100 ">
 <Inbox size={48} className="mb-4 opacity-50" />
 <p className="text-lg font-medium">No submissions found.</p>
 </div>
 ) : (
 filteredSubmissions.map((sub) => {
 const isExpanded = expandedId === sub.id;
 const isPending = sub.status === 'pending';

 return (
 <div key={sub.id} className={`bg-white rounded-2xl shadow-sm border ${isPending ? 'border-[#d4a017]/30 ' : 'border-gray-100 '} overflow-hidden transition-all duration-300`}>
 <div 
 onClick={() => toggleExpand(sub.id)}
 className="p-4 flex items-start gap-4 cursor-pointer hover:bg-gray-50 :bg-gray-800/50 transition-colors"
 >
 <div className="mt-1">
 {getIconForType(sub.type)}
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center justify-between gap-2 mb-1">
 <h3 className={`text-sm font-bold truncate ${isPending ? 'text-gray-900 ' : 'text-gray-600 '}`}>
 {getTitleForType(sub.type)}
 </h3>
 <span className="text-xs text-gray-400 whitespace-nowrap flex items-center gap-1">
 <Clock size={12} />
 {formatDate(sub.createdAt)}
 </span>
 </div>
 
 <p className="text-sm text-gray-500 truncate">
 {sub.data.name || sub.data.churchName || sub.data.title || 'Anonymous'}
 </p>
 </div>
 
 <div className="flex items-center gap-2">
 {isPending && (
 <span className="w-2 h-2 rounded-full bg-[#d4a017]"></span>
 )}
 {isExpanded ? <ChevronUp size={20} className="text-gray-400" /> : <ChevronDown size={20} className="text-gray-400" />}
 </div>
 </div>

 {isExpanded && (
 <div className="p-4 border-t border-gray-50 bg-gray-50/50 animate-in slide-in-from-top-2 duration-200">
 <div className="space-y-3 mb-6">
 {Object.entries(sub.data).map(([key, value]) => {
 if (!value) return null;
 return (
 <div key={key}>
 <span className="text-[10px] font-bold text-gray-400 tracking-wider uppercase block mb-1">
 {key.replace(/([A-Z])/g, ' $1').trim()}
 </span>
 <p className="text-sm text-gray-900 whitespace-pre-wrap">
 {String(value)}
 </p>
 </div>
 );
 })}
 </div>

 <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100 ">
 {deleteConfirmId === sub.id ? (
 <div className="flex items-center gap-2">
 <span className="text-sm text-gray-500 ">Are you sure?</span>
 <button
 onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(null); }}
 className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 :bg-gray-700 rounded-lg transition-colors"
 >
 Cancel
 </button>
 <button
 onClick={(e) => { e.stopPropagation(); handleDelete(sub.id); }}
 className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
 >
 Yes, Delete
 </button>
 </div>
 ) : (
 <button
 onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(sub.id); }}
 className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 :bg-red-900/20 rounded-lg transition-colors"
 >
 <Trash2 size={16} />
 Delete
 </button>
 )}
 
 {isPending ? (
 <button
 onClick={(e) => { e.stopPropagation(); handleStatusChange(sub.id, 'resolved'); }}
 className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-green-600 bg-green-50 hover:bg-green-100 :bg-green-900/40 rounded-lg transition-colors"
 >
 <CheckCircle size={16} />
 Mark Resolved
 </button>
 ) : (
 <button
 onClick={(e) => { e.stopPropagation(); handleStatusChange(sub.id, 'pending'); }}
 className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 :bg-gray-700 rounded-lg transition-colors"
 >
 <Clock size={16} />
 Mark Pending
 </button>
 )}
 </div>
 </div>
 )}
 </div>
 );
 }))}
 </div>
 );
};

export default AdminInbox;
