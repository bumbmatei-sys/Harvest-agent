"use client";
import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, onSnapshot, doc, updateDoc, deleteDoc, limit } from 'firebase/firestore';
import { Mail, Lightbulb, Bug, CheckCircle, Trash2, Clock, ChevronDown, ChevronUp, Inbox, Building2, User } from 'lucide-react';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { sortByTime } from '../utils/query-helpers';

/**
 * PlatformInbox — the super-admin-only inbox for platform reports.
 *
 * Unlike the old tenant AdminInbox (which read `submissions` scoped to one
 * tenant), this reads the top-level `platform_inbox` collection with NO tenant
 * filter: the platform owner sees Contact / Feature / Bug reports from EVERY
 * tenant. Each row surfaces which tenant it came from (`fromTenantId`).
 */
const PlatformInbox = () => {
 const [reports, setReports] = useState<any[]>([]);
 const [loading, setLoading] = useState(true);
 const [expandedId, setExpandedId] = useState<string | null>(null);
 const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
 const [filterType, setFilterType] = useState<string>('all');

 useEffect(() => {
 // No tenant filter — the platform owner sees all reports. Sort newest-first
 // client-side to avoid an index requirement.
 const q = query(collection(db, 'platform_inbox'), limit(300));
 const unsubscribe = onSnapshot(q, (snapshot) => {
   const docs: any[] = [];
   snapshot.forEach((d) => { docs.push({ id: d.id, ...d.data() }); });
   setReports(sortByTime(docs, 'createdAt', 'desc'));
   setLoading(false);
 }, (error) => {
   try { handleFirestoreError(error, OperationType.GET, `platform_inbox`); } catch (e) { console.error(e); }
   setLoading(false);
 });
 return () => unsubscribe();
 }, []);

 const handleStatusChange = async (id: string, newStatus: string) => {
 try {
   await updateDoc(doc(db, 'platform_inbox', id), { status: newStatus });
 } catch (error) {
 try { handleFirestoreError(error, OperationType.UPDATE, `platform_inbox/${id}`); } catch (e) { console.error(e); }
 }
 };

 const handleDelete = async (id: string) => {
 try {
   await deleteDoc(doc(db, 'platform_inbox', id));
   setDeleteConfirmId(null);
 } catch (error) {
 try { handleFirestoreError(error, OperationType.DELETE, `platform_inbox/${id}`); } catch (e) { console.error(e); }
 }
 };

 const toggleExpand = (id: string) => {
 setExpandedId(expandedId === id ? null : id);
 };

 const getIconForType = (type: string) => {
 switch (type) {
 case 'contact': return <Mail size={20} className="text-blue-500" />;
 case 'feature': return <Lightbulb size={20} className="text-purple-500" />;
 case 'bug': return <Bug size={20} className="text-red-500" />;
 default: return <Mail size={20} className="text-warm-brown" />;
 }
 };

 const getTitleForType = (type: string) => {
 switch (type) {
 case 'contact': return 'Contact Support';
 case 'feature': return 'Feature Request';
 case 'bug': return 'Bug Report';
 default: return 'Report';
 }
 };

 // Best-effort one-line subject for the collapsed row.
 const getSubject = (r: any) => {
 const d = r.data || {};
 if (r.type === 'contact') return d.subject || d.name || 'Contact';
 if (r.type === 'feature') return d.title || 'Feature request';
 if (r.type === 'bug') return d.title || 'Bug report';
 return d.subject || d.title || 'Report';
 };

 const formatDate = (isoString: string) => {
 const date = new Date(isoString);
 return new Intl.DateTimeFormat('en-US', {
 month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
 }).format(date);
 };

 const Field = ({ label, value }: { label: string; value: any }) => {
 if (value === undefined || value === null || value === '') return null;
 return (
 <div>
 <span className="text-[10px] font-bold text-[color:var(--text-faint)] tracking-wider uppercase block mb-1">{label}</span>
 <p className="text-sm text-earth whitespace-pre-wrap break-words">{String(value)}</p>
 </div>
 );
 };

 const renderBody = (r: any) => {
 const d = r.data || {};
 if (r.type === 'contact') {
 return (
 <div className="space-y-3">
 <Field label="Name" value={d.name} />
 <Field label="Email" value={d.email} />
 <Field label="Subject" value={d.subject} />
 <Field label="Message" value={d.message} />
 <Field label="From tenant" value={r.fromTenantId} />
 </div>
 );
 }
 if (r.type === 'feature') {
 return (
 <div className="space-y-3">
 <Field label="Title" value={d.title} />
 <Field label="Details" value={d.details} />
 <Field label="Submitter" value={r.userEmail} />
 <Field label="From tenant" value={r.fromTenantId} />
 </div>
 );
 }
 if (r.type === 'bug') {
 // Show EVERYTHING captured so the owner can reproduce without back-and-forth.
 return (
 <div className="space-y-3">
 <Field label="Reporter role" value={d.role === 'admin' ? 'Admin' : 'Member / User'} />
 <Field label="What went wrong" value={d.title} />
 <Field label="Where (area)" value={d.area === 'Other' ? (d.areaOther || 'Other') : d.area} />
 <Field label="Steps to reproduce" value={d.steps} />
 <Field label="Expected behavior" value={d.expected} />
 <Field label="Device / browser" value={d.device} />
 <Field label="Page URL" value={r.pageUrl} />
 <Field label="Submitter email" value={r.userEmail || d.email} />
 <Field label="From tenant" value={r.fromTenantId} />
 </div>
 );
 }
 // Fallback: dump everything in data.
 return (
 <div className="space-y-3">
 {Object.entries(d).map(([key, value]) => (
 <Field key={key} label={key.replace(/([A-Z])/g, ' $1').trim()} value={value} />
 ))}
 <Field label="Submitter" value={r.userEmail} />
 <Field label="From tenant" value={r.fromTenantId} />
 </div>
 );
 };

 const filteredReports = reports.filter((r) => filterType === 'all' || r.type === filterType);

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
 {['all', 'contact', 'feature', 'bug'].map((type) => (
 <button
 key={type}
 onClick={() => setFilterType(type)}
 className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
 filterType === type
 ? 'bg-gold text-white'
 : 'bg-white text-warm-brown border border-stone-200 hover:border-gold :border-gold'
 }`}
 >
 {type.charAt(0).toUpperCase() + type.slice(1)}
 </button>
 ))}
 </div>
 </div>

 {reports.length === 0 ? (
 <div className="flex flex-col items-center justify-center py-12 text-[color:var(--text-faint)] bg-white rounded-2xl border border-stone-200 ">
 <Inbox size={48} className="mb-4 opacity-50" />
 <p className="text-lg font-medium font-display">No reports yet.</p>
 </div>
 ) : filteredReports.length === 0 ? (
 <div className="flex flex-col items-center justify-center py-12 text-[color:var(--text-faint)] bg-white rounded-2xl border border-stone-200 ">
 <Inbox size={48} className="mb-4 opacity-50" />
 <p className="text-lg font-medium font-display">No reports found.</p>
 </div>
 ) : (
 filteredReports.map((r) => {
 const isExpanded = expandedId === r.id;
 const isPending = r.status === 'pending';

 return (
 <div key={r.id} className={`bg-white rounded-2xl shadow-sm border ${isPending ? 'border-[color-mix(in_srgb,var(--brand-color)_30%,transparent)] ' : 'border-stone-200 '} overflow-hidden transition-all duration-300`}>
 <div
 onClick={() => toggleExpand(r.id)}
 className="p-4 flex items-start gap-4 cursor-pointer hover:bg-stone-100 :bg-gray-800/50 transition-colors"
 >
 <div className="mt-1">
 {getIconForType(r.type)}
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center justify-between gap-2 mb-1">
 <h3 className={`text-sm font-bold truncate ${isPending ? 'text-earth ' : 'text-warm-brown '}`}>
 {getTitleForType(r.type)}
 </h3>
 <span className="text-xs text-[color:var(--text-faint)] whitespace-nowrap flex items-center gap-1">
 <Clock size={12} />
 {formatDate(r.createdAt)}
 </span>
 </div>

 <p className="text-sm text-warm-brown truncate">{getSubject(r)}</p>

 <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-[color:var(--text-faint)]">
 {(r.userEmail || r.data?.email) && (
 <span className="flex items-center gap-1 min-w-0">
 <User size={11} className="shrink-0" />
 <span className="truncate">{r.userEmail || r.data?.email}</span>
 </span>
 )}
 {r.fromTenantId && (
 <span className="flex items-center gap-1">
 <Building2 size={11} className="shrink-0" />
 {r.fromTenantId}
 </span>
 )}
 </div>
 </div>

 <div className="flex items-center gap-2">
 {isPending && (
 <span className="w-2 h-2 rounded-full bg-gold"></span>
 )}
 {isExpanded ? <ChevronUp size={20} className="text-[color:var(--text-faint)]" /> : <ChevronDown size={20} className="text-[color:var(--text-faint)]" />}
 </div>
 </div>

 {isExpanded && (
 <div className="p-4 border-t border-gray-50 bg-stone-100/50 animate-in slide-in-from-top-2 duration-200">
 <div className="mb-6">
 {renderBody(r)}
 </div>

 <div className="flex items-center justify-end gap-3 pt-4 border-t border-stone-200 ">
 {deleteConfirmId === r.id ? (
 <div className="flex items-center gap-2">
 <span className="text-sm text-warm-brown ">Are you sure?</span>
 <button
 onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(null); }}
 className="px-3 py-1.5 text-sm font-medium text-warm-brown bg-stone-100 hover:bg-stone-200 :bg-gray-700 rounded-lg transition-colors"
 >
 Cancel
 </button>
 <button
 onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}
 className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
 >
 Yes, Delete
 </button>
 </div>
 ) : (
 <button
 onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(r.id); }}
 className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 :bg-red-900/20 rounded-lg transition-colors"
 >
 <Trash2 size={16} />
 Delete
 </button>
 )}

 {isPending ? (
 <button
 onClick={(e) => { e.stopPropagation(); handleStatusChange(r.id, 'resolved'); }}
 className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-green-600 bg-green-50 hover:bg-green-100 :bg-green-900/40 rounded-lg transition-colors"
 >
 <CheckCircle size={16} />
 Mark Read
 </button>
 ) : (
 <button
 onClick={(e) => { e.stopPropagation(); handleStatusChange(r.id, 'pending'); }}
 className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-warm-brown bg-stone-100 hover:bg-stone-200 :bg-gray-700 rounded-lg transition-colors"
 >
 <Clock size={16} />
 Mark Unread
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

export default PlatformInbox;
