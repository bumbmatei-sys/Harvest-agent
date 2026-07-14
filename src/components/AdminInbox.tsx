"use client";
import React, { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
import { collection, query, where, onSnapshot, doc, getDoc, updateDoc, deleteDoc, limit } from 'firebase/firestore';
import { Mail, MapPin, Lightbulb, HeartHandshake, Church, CheckCircle, Trash2, Clock, ChevronDown, ChevronUp, Inbox } from 'lucide-react';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope } from '../utils/tenant-scope';
import { sortByTime } from '../utils/query-helpers';



const AdminInbox = () => {
 const [submissions, setSubmissions] = useState<any[]>([]);
 const [loading, setLoading] = useState(true);
 const [expandedId, setExpandedId] = useState<string | null>(null);
 const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
 const [filterType, setFilterType] = useState<string>('all');

 useEffect(() => {
 let unsubscribe: (() => void) | null = null;

 (async () => {
   const tenantId = await getTenantScope();
   // Single-field filter only (tenantId); sort client-side to avoid a composite index.
   const q = tenantId
     ? query(collection(db, 'submissions'), where('tenantId', '==', tenantId), limit(200))
     : query(collection(db, 'submissions'), limit(200));

   unsubscribe = onSnapshot(q, (snapshot) => {
     const subs: any[] = [];
     snapshot.forEach((doc) => {
       subs.push({ id: doc.id, ...doc.data() });
     });
     setSubmissions(sortByTime(subs, 'createdAt', 'desc'));
     setLoading(false);
   }, (error) => {
     try { handleFirestoreError(error, OperationType.GET, `submissions`); } catch (e) { console.error(e); }
     setLoading(false);
   });
 })();

 return () => { if (unsubscribe) unsubscribe(); };
 }, []);

 const handleStatusChange = async (id: string, newStatus: string) => {
 try {
   const tenantId = await getTenantScope();
   if (tenantId) {
     const docSnap = await getDoc(doc(db, 'submissions', id));
     if (docSnap.exists() && docSnap.data().tenantId && docSnap.data().tenantId !== tenantId) {
       console.error('Tenant mismatch — cannot modify another tenant\'s document');
       return;
     }
   }
   await updateDoc(doc(db, 'submissions', id), {
     status: newStatus
 });
 } catch (error) {
 try { handleFirestoreError(error, OperationType.UPDATE, `submissions/${id}`); } catch (e) { console.error(e); }
 }
 };

 const handleDelete = async (id: string) => {
 try {
   const tenantId = await getTenantScope();
   if (tenantId) {
     const docSnap = await getDoc(doc(db, 'submissions', id));
     if (docSnap.exists() && docSnap.data().tenantId && docSnap.data().tenantId !== tenantId) {
       console.error('Tenant mismatch — cannot modify another tenant\'s document');
       return;
     }
   }
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
 case 'contact': return <Mail size={20} className="text-sky-500" />;
 case 'church_suggestion': return <MapPin size={20} className="text-field-500" />;
 case 'feature': return <Lightbulb size={20} className="text-navy-500" />;
 case 'prayer': return <HeartHandshake size={20} className="text-wheat-600" />;
 case 'enrollment': return <Church size={20} className="text-gold" />;
 default: return <Mail size={20} className="text-warm-brown" />;
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
 <div className="w-8 h-8 border-4 border-[color-mix(in_srgb,var(--brand-color)_30%,transparent)] border-t-gold rounded-full animate-spin"></div>
 </div>
 );
 }

 return (
 <div className="space-y-4">
 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
 <div className="flex overflow-x-auto gap-2 pb-2 sm:pb-0 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
 {['all', 'general', 'prayer', 'feature', 'church_suggestion'].map((type) => (
 <button
 key={type}
 onClick={() => setFilterType(type)}
 className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
 filterType === type
 ? 'bg-gold text-white'
 : 'bg-white text-warm-brown border border-stone-200 hover:border-gold :border-gold'
 }`}
 >
 {type === 'church_suggestion' ? 'Church Suggestion' : type.charAt(0).toUpperCase() + type.slice(1)}
 </button>
 ))}
 </div>
 </div>
 
 {submissions.length === 0 ? (
 <div className="flex flex-col items-center justify-center py-12 text-[color:var(--text-faint)] bg-white rounded-2xl border border-stone-200 ">
 <Inbox size={48} className="mb-4 opacity-50" />
 <p className="font-display text-lg font-medium">No submissions yet.</p>
 </div>
 ) : filteredSubmissions.length === 0 ? (
 <div className="flex flex-col items-center justify-center py-12 text-[color:var(--text-faint)] bg-white rounded-2xl border border-stone-200 ">
 <Inbox size={48} className="mb-4 opacity-50" />
 <p className="font-display text-lg font-medium">No submissions found.</p>
 </div>
 ) : (
 filteredSubmissions.map((sub) => {
 const isExpanded = expandedId === sub.id;
 const isPending = sub.status === 'pending';

 return (
 <React.Fragment key={sub.id}>
 {/* Mobile card — mockup inbox row: neutral disc + type-colored icon, title,
     submitter label, time, gold unread dot, chevron; expands to the same data
     entries and the same Delete / Mark resolved·pending actions. Reuses
     getIconForType, getTitleForType, formatDate, toggleExpand, handleDelete,
     handleStatusChange, setDeleteConfirmId — no wiring changed. */}
 <div className={`lg:hidden bg-white rounded-brand-xl shadow-[var(--ds-sh-sm)] overflow-hidden border ${isPending ? 'border-[color-mix(in_srgb,var(--brand-color)_30%,transparent)]' : 'border-stone-200'}`}>
 <button
 onClick={() => toggleExpand(sub.id)}
 className="w-full flex items-start gap-3 p-3.5 text-left"
 >
 <span className="w-9 h-9 shrink-0 rounded-brand bg-[var(--surface-sunken)] flex items-center justify-center">
 {getIconForType(sub.type)}
 </span>
 <span className="flex-1 min-w-0">
 <span className="flex items-center justify-between gap-2">
 <span className={`min-w-0 truncate text-[13px] font-bold ${isPending ? 'text-earth' : 'text-warm-brown'}`}>{getTitleForType(sub.type)}</span>
 <span className="shrink-0 text-[11px] text-[color:var(--text-faint)]">{formatDate(sub.createdAt)}</span>
 </span>
 <span className="block truncate text-xs text-warm-brown mt-0.5">{sub.data.name || sub.data.churchName || sub.data.title || 'Anonymous'}</span>
 </span>
 <span className="flex items-center gap-2 shrink-0">
 {isPending && <span className="w-2 h-2 rounded-full bg-gold" />}
 {isExpanded ? <ChevronUp size={16} className="text-[color:var(--text-faint)]" /> : <ChevronDown size={16} className="text-[color:var(--text-faint)]" />}
 </span>
 </button>
 {isExpanded && (
 <div className="p-3.5 border-t border-stone-200 bg-[var(--surface-sunken)]">
 <div className="space-y-3 mb-3.5">
 {Object.entries(sub.data).map(([key, value]) => {
 if (!value) return null;
 return (
 <div key={key}>
 <span className="block text-[10px] font-bold text-[color:var(--text-faint)] tracking-wider uppercase mb-1">
 {key.replace(/([A-Z])/g, ' $1').trim()}
 </span>
 <p className="text-sm text-earth whitespace-pre-wrap leading-relaxed">
 {String(value)}
 </p>
 </div>
 );
 })}
 </div>
 <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-stone-200">
 {deleteConfirmId === sub.id ? (
 <div className="flex items-center gap-2">
 <span className="text-xs text-warm-brown">Are you sure?</span>
 <button
 onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(null); }}
 className="px-3 py-1.5 text-xs font-semibold text-warm-brown bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors"
 >
 Cancel
 </button>
 <button
 onClick={(e) => { e.stopPropagation(); handleDelete(sub.id); }}
 className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
 >
 Yes, Delete
 </button>
 </div>
 ) : (
 <button
 onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(sub.id); }}
 className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg transition-colors"
 >
 <Trash2 size={14} />
 Delete
 </button>
 )}
 {isPending ? (
 <button
 onClick={(e) => { e.stopPropagation(); handleStatusChange(sub.id, 'resolved'); }}
 className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-field-600 bg-field-100 hover:bg-field-200 rounded-lg transition-colors"
 >
 <CheckCircle size={14} />
 Mark Resolved
 </button>
 ) : (
 <button
 onClick={(e) => { e.stopPropagation(); handleStatusChange(sub.id, 'pending'); }}
 className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-warm-brown bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors"
 >
 <Clock size={14} />
 Mark Pending
 </button>
 )}
 </div>
 </div>
 )}
 </div>

 {/* Desktop card — existing approved layout, unchanged (now lg-only). */}
 <div className={`hidden lg:block bg-white rounded-2xl shadow-sm border ${isPending ? 'border-[color-mix(in_srgb,var(--brand-color)_30%,transparent)] ' : 'border-stone-200 '} overflow-hidden transition-all duration-300`}>
 <div 
 onClick={() => toggleExpand(sub.id)}
 className="p-4 flex items-start gap-4 cursor-pointer hover:bg-stone-100 :bg-gray-800/50 transition-colors"
 >
 <div className="mt-1">
 {getIconForType(sub.type)}
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center justify-between gap-2 mb-1">
 <h3 className={`text-sm font-bold truncate ${isPending ? 'text-earth ' : 'text-warm-brown '}`}>
 {getTitleForType(sub.type)}
 </h3>
 <span className="text-xs text-[color:var(--text-faint)] whitespace-nowrap flex items-center gap-1">
 <Clock size={12} />
 {formatDate(sub.createdAt)}
 </span>
 </div>
 
 <p className="text-sm text-warm-brown truncate">
 {sub.data.name || sub.data.churchName || sub.data.title || 'Anonymous'}
 </p>
 </div>
 
 <div className="flex items-center gap-2">
 {isPending && (
 <span className="w-2 h-2 rounded-full bg-gold"></span>
 )}
 {isExpanded ? <ChevronUp size={20} className="text-[color:var(--text-faint)]" /> : <ChevronDown size={20} className="text-[color:var(--text-faint)]" />}
 </div>
 </div>

 {isExpanded && (
 <div className="p-4 border-t border-stone-200 bg-stone-100/50 animate-in slide-in-from-top-2 duration-200">
 <div className="space-y-3 mb-6">
 {Object.entries(sub.data).map(([key, value]) => {
 if (!value) return null;
 return (
 <div key={key}>
 <span className="text-[10px] font-bold text-[color:var(--text-faint)] tracking-wider uppercase block mb-1">
 {key.replace(/([A-Z])/g, ' $1').trim()}
 </span>
 <p className="text-sm text-earth whitespace-pre-wrap">
 {String(value)}
 </p>
 </div>
 );
 })}
 </div>

 <div className="flex items-center justify-end gap-3 pt-4 border-t border-stone-200 ">
 {deleteConfirmId === sub.id ? (
 <div className="flex items-center gap-2">
 <span className="text-sm text-warm-brown ">Are you sure?</span>
 <button
 onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(null); }}
 className="px-3 py-1.5 text-sm font-medium text-warm-brown bg-stone-100 hover:bg-stone-200 :bg-gray-700 rounded-lg transition-colors"
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
 className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-field-600 bg-field-100 hover:bg-field-200 :bg-green-900/40 rounded-lg transition-colors"
 >
 <CheckCircle size={16} />
 Mark Resolved
 </button>
 ) : (
 <button
 onClick={(e) => { e.stopPropagation(); handleStatusChange(sub.id, 'pending'); }}
 className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-warm-brown bg-stone-100 hover:bg-stone-200 :bg-gray-700 rounded-lg transition-colors"
 >
 <Clock size={16} />
 Mark Pending
 </button>
 )}
 </div>
 </div>
 )}
 </div>
 </React.Fragment>
 );
 }))}
 </div>
 );
};

export default AdminInbox;
