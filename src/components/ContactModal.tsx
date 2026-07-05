"use client";
import React, { useState } from 'react';
import { ArrowLeft, Mail, Lightbulb, Bug, ChevronDown, ChevronUp } from 'lucide-react';
import { db, auth } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';
import { getTenantScope } from '../utils/tenant-scope';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';


interface ContactModalProps {
 isOpen: boolean;
 onClose: () => void;
}

// Bug-report "Where did it happen?" options — swapped based on the reporter's
// role so the report is categorized against the area they actually saw.
const ADMIN_AREAS = [
 'Dashboard', 'Posts', 'Blog', 'Courses', 'Newsletter', 'AI Knowledge', 'CRM',
 'Fundraising', 'Events', 'Check-In', 'Forms', 'SMS', 'Accounting', 'Affiliate',
 'Livestream', 'Branding', 'Settings', 'Other',
];
const USER_AREAS = [
 'Home/News', 'Prayer', 'Blog', 'Courses', 'Messages', 'Partner with Us',
 'Bible', 'Chat', 'Map', 'Profile', 'Other',
];

const InputLabel = ({ children }: { children: React.ReactNode }) => (
 <label className="text-[10px] font-bold text-gray-400 tracking-wider uppercase mb-2 block">
 {children}
 </label>
);

const InputField = ({ placeholder, type = "text", name, value, onChange, required }: any) => (
 <input
 type={type}
 name={name}
 value={value}
 onChange={onChange}
 required={required}
 placeholder={placeholder}
 className="w-full bg-[#f8f9fa] rounded-xl px-4 py-3 text-sm text-gray-900 font-medium focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_20%,transparent)] mb-4 placeholder-gray-400 border border-transparent "
 />
);

const TextAreaField = ({ placeholder, name, value, onChange, required }: any) => (
 <textarea
 placeholder={placeholder}
 name={name}
 value={value}
 onChange={onChange}
 required={required}
 rows={4}
 className="w-full bg-[#f8f9fa] rounded-xl px-4 py-3 text-sm text-gray-900 font-medium focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_20%,transparent)] mb-4 placeholder-gray-400 resize-none border border-transparent "
 />
);

const SubmitButton = ({ children, isSubmitting, disabled }: { children: React.ReactNode, isSubmitting?: boolean, disabled?: boolean }) => (
 <button
 type="submit"
 disabled={isSubmitting || disabled}
 className={`w-full bg-gold hover:bg-[color-mix(in_srgb,var(--brand-color)_85%,black)] text-white font-bold py-3.5 px-4 rounded-xl transition-colors shadow-sm mt-2 flex items-center justify-center gap-2 ${(isSubmitting || disabled) ? 'opacity-70 cursor-not-allowed' : ''}`}
 >
 {isSubmitting ? (
 <>
 <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
 Submitting...
 </>
 ) : children}
 </button>
);

const AccordionItem = ({
 id,
 icon,
 iconBg,
 title,
 subtitle,
 isOpen,
 onToggle,
 children
}: any) => {
 return (
 <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-4 transition-all duration-300">
 <button
 onClick={() => onToggle(id)}
 className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 :bg-gray-800/50 transition-colors"
 >
 <div className="flex items-center gap-4">
 <div className={`w-10 h-10 rounded-full flex items-center justify-center ${iconBg}`}>
 {icon}
 </div>
 <div>
 <h4 className="text-sm font-bold text-gray-900 ">{title}</h4>
 <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
 </div>
 </div>
 {isOpen ? (
 <ChevronUp size={20} className="text-gray-400" />
 ) : (
 <ChevronDown size={20} className="text-gray-400" />
 )}
 </button>

 {isOpen && (
 <div className="p-4 border-t border-gray-50 animate-in slide-in-from-top-2 duration-200">
 {children}
 </div>
 )}
 </div>
 );
};

const ContactModal: React.FC<ContactModalProps> = ({ isOpen, onClose }) => {
 const [openSection, setOpenSection] = useState<string | null>(null);
 const [isSubmitting, setIsSubmitting] = useState(false);
 const [successMessage, setSuccessMessage] = useState('');
 const [errorMessage, setErrorMessage] = useState('');

 // Form states
 const [supportForm, setSupportForm] = useState({ name: '', email: '', subject: '', message: '' });
 const [featureForm, setFeatureForm] = useState({ title: '', details: '' });
 const [bugForm, setBugForm] = useState({
   role: 'user',          // 'admin' | 'user'
   title: '',
   area: '',
   areaOther: '',
   steps: '',
   expected: '',
   device: typeof navigator !== 'undefined' ? navigator.userAgent : '',
 });

 if (!isOpen) return null;

 const toggleSection = (section: string) => {
 if (openSection === section) {
 setOpenSection(null);
 } else {
 setOpenSection(section);
 setSuccessMessage('');
 setErrorMessage('');
 }
 };

 const handleSubmit = async (e: React.FormEvent, type: string, data: any, resetForm: () => void) => {
 e.preventDefault();
 setIsSubmitting(true);
 setSuccessMessage('');
 setErrorMessage('');

 try {
 const tenantId = await getTenantScope();
 // Contact Support, Feature, and Bug always go to the PLATFORM owner —
 // never to tenant admins — on every plan. We still record which tenant
 // the report came from (for context) but it lands in platform_inbox.
 await addDoc(collection(db, 'platform_inbox'), {
   type,                       // 'contact' | 'feature' | 'bug'
   status: 'pending',
   createdAt: new Date().toISOString(),
   userId: auth.currentUser?.uid || null,
   userEmail: auth.currentUser?.email || null,
   data,
   fromTenantId: tenantId || null,   // context only, NOT a scoping key
   // For bug reports, capture where the reporter was. (device is already in
   // data via the form's auto-prefill; pageUrl is added here.)
   ...(type === 'bug' ? { pageUrl: typeof window !== 'undefined' ? window.location.href : null } : {}),
 });

 // Notify the platform owner (super admin) only — never tenant admins.
 // (Optional) a server route could email PLATFORM_OWNER_EMAIL here,
 // fire-and-forget. Intentionally kept simple.

 setSuccessMessage('Successfully submitted! Thank you.');
 resetForm();
 setTimeout(() => {
 setSuccessMessage('');
 setOpenSection(null);
 }, 3000);
 } catch (error) {
 handleFirestoreError(error, OperationType.WRITE, `platform_inbox`);
 setErrorMessage("Something went wrong. Please try again later.");
 } finally {
 setIsSubmitting(false);
 }
 };

 // Bug report is only submittable once the reproduction-critical fields are filled.
 const bugValid = !!(
   bugForm.role &&
   bugForm.title.trim() &&
   bugForm.area &&
   (bugForm.area !== 'Other' || bugForm.areaOther.trim()) &&
   bugForm.steps.trim()
 );

 return (
 <div className="fixed inset-0 z-50 flex flex-col bg-[#f8f9fa] animate-in slide-in-from-bottom-full duration-300 overflow-hidden">
 {/* Header */}
 <div className="flex items-center px-4 py-4 bg-white border-b border-gray-100 sticky top-0 z-10">
 <button onClick={onClose} className="p-2 -ml-2 text-gray-600 ">
 <ArrowLeft size={24} />
 </button>
 <h2 className="text-lg font-bold text-gray-900 flex-1 text-center pr-8">Contact</h2>
 </div>

 <div className="flex-1 overflow-y-auto p-4 pb-12">
 <div className="text-center mb-8 mt-4">
 <h2 className="text-2xl font-bold text-[#1a202c] mb-2">How can we help?</h2>
 <p className="text-gray-500 text-sm">We are here to serve you.</p>
 </div>

 {successMessage && (
 <div className="bg-green-50 text-green-700 text-sm p-4 rounded-xl mb-6 text-center font-medium border border-green-100 ">
 {successMessage}
 </div>
 )}

 {errorMessage && (
 <div className="bg-red-50 text-red-700 text-sm p-4 rounded-xl mb-6 text-center font-medium border border-red-100 ">
 {errorMessage}
 </div>
 )}

 <AccordionItem
 id="support"
 icon={<Mail size={20} className="text-blue-500" />}
 iconBg="bg-blue-50 "
 title="Contact Support"
 subtitle="General inquiries and help."
 isOpen={openSection === 'support'}
 onToggle={toggleSection}
 >
 <form onSubmit={(e) => handleSubmit(e, 'contact', supportForm, () => setSupportForm({ name: '', email: '', subject: '', message: '' }))}>
 <InputLabel>YOUR NAME</InputLabel>
 <InputField required name="name" value={supportForm.name} onChange={(e: any) => setSupportForm({...supportForm, name: e.target.value})} placeholder="John Doe" />

 <InputLabel>EMAIL</InputLabel>
 <InputField required name="email" value={supportForm.email} onChange={(e: any) => setSupportForm({...supportForm, email: e.target.value})} placeholder="john@example.com" type="email" />

 <InputLabel>SUBJECT</InputLabel>
 <InputField required name="subject" value={supportForm.subject} onChange={(e: any) => setSupportForm({...supportForm, subject: e.target.value})} placeholder="Topic of your message" />

 <InputLabel>MESSAGE</InputLabel>
 <TextAreaField required name="message" value={supportForm.message} onChange={(e: any) => setSupportForm({...supportForm, message: e.target.value})} placeholder="How can we help you?" />

 <SubmitButton isSubmitting={isSubmitting}>Send Message</SubmitButton>
 </form>
 </AccordionItem>

 <AccordionItem
 id="feature"
 icon={<Lightbulb size={20} className="text-purple-500" />}
 iconBg="bg-purple-50 "
 title="Suggest a Feature"
 subtitle="Help us improve the app."
 isOpen={openSection === 'feature'}
 onToggle={toggleSection}
 >
 <form onSubmit={(e) => handleSubmit(e, 'feature', featureForm, () => setFeatureForm({ title: '', details: '' }))}>
 <div className="bg-purple-50 text-purple-700 text-xs p-3 rounded-xl mb-6 leading-relaxed border border-purple-100 ">
 Have an idea to make Harvest better? We&apos;d love to hear about it!
 </div>

 <InputLabel>FEATURE TITLE</InputLabel>
 <InputField required name="title" value={featureForm.title} onChange={(e: any) => setFeatureForm({...featureForm, title: e.target.value})} placeholder="e.g. Dark Mode for Maps" />

 <InputLabel>DETAILS</InputLabel>
 <TextAreaField required name="details" value={featureForm.details} onChange={(e: any) => setFeatureForm({...featureForm, details: e.target.value})} placeholder="Describe your idea..." />

 <SubmitButton isSubmitting={isSubmitting}>Submit Suggestion</SubmitButton>
 </form>
 </AccordionItem>

 <AccordionItem
 id="bug"
 icon={<Bug size={20} className="text-red-500" />}
 iconBg="bg-red-50 "
 title="Report a Bug"
 subtitle="Tell us what broke, and where."
 isOpen={openSection === 'bug'}
 onToggle={toggleSection}
 >
 <form onSubmit={(e) => handleSubmit(e, 'bug', bugForm, () => setBugForm({ role: 'user', title: '', area: '', areaOther: '', steps: '', expected: '', device: typeof navigator !== 'undefined' ? navigator.userAgent : '' }))}>
 <div className="bg-red-50 text-red-700 text-xs p-3 rounded-xl mb-6 leading-relaxed border border-red-100 ">
 Found something broken? Give us as much detail as you can so we can reproduce and fix it fast.
 </div>

 <InputLabel>WHO ARE YOU?</InputLabel>
 <div className="flex gap-2 mb-4">
 {[{ v: 'admin', l: 'Admin' }, { v: 'user', l: 'Member / User' }].map((opt) => (
 <button
 type="button"
 key={opt.v}
 onClick={() => setBugForm({ ...bugForm, role: opt.v, area: '', areaOther: '' })}
 className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-colors ${
 bugForm.role === opt.v
 ? 'bg-gold text-white border-gold'
 : 'bg-white text-gray-600 border-gray-200 hover:border-gold'
 }`}
 >
 {opt.l}
 </button>
 ))}
 </div>

 <InputLabel>WHAT WENT WRONG?</InputLabel>
 <InputField required name="title" value={bugForm.title} onChange={(e: any) => setBugForm({ ...bugForm, title: e.target.value })} placeholder="e.g. Create button does nothing on the Events page" />

 <InputLabel>WHERE DID IT HAPPEN?</InputLabel>
 <select
 name="area"
 value={bugForm.area}
 onChange={(e) => setBugForm({ ...bugForm, area: e.target.value, areaOther: e.target.value === 'Other' ? bugForm.areaOther : '' })}
 required
 className="w-full bg-[#f8f9fa] rounded-xl px-4 py-3 text-sm text-gray-900 font-medium focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_20%,transparent)] mb-4 border border-transparent"
 >
 <option value="" disabled>Select an area…</option>
 {(bugForm.role === 'admin' ? ADMIN_AREAS : USER_AREAS).map((a) => (
 <option key={a} value={a}>{a}</option>
 ))}
 </select>
 {bugForm.area === 'Other' && (
 <InputField required name="areaOther" value={bugForm.areaOther} onChange={(e: any) => setBugForm({ ...bugForm, areaOther: e.target.value })} placeholder="Describe where it happened" />
 )}

 <InputLabel>WHAT WERE YOU DOING WHEN IT HAPPENED?</InputLabel>
 <TextAreaField required name="steps" value={bugForm.steps} onChange={(e: any) => setBugForm({ ...bugForm, steps: e.target.value })} placeholder="Step by step, what did you click / tap right before the bug? e.g. 1) Opened Events 2) Tapped Create 3) Nothing happened" />

 <InputLabel>WHAT DID YOU EXPECT TO HAPPEN?</InputLabel>
 <TextAreaField name="expected" value={bugForm.expected} onChange={(e: any) => setBugForm({ ...bugForm, expected: e.target.value })} placeholder="What should have happened instead?" />

 <InputLabel>DEVICE / BROWSER (AUTO-DETECTED, EDIT IF NEEDED)</InputLabel>
 <InputField name="device" value={bugForm.device} onChange={(e: any) => setBugForm({ ...bugForm, device: e.target.value })} placeholder="Device / browser" />

 <SubmitButton isSubmitting={isSubmitting} disabled={!bugValid}>Submit Bug Report</SubmitButton>
 </form>
 </AccordionItem>

 </div>
 </div>
 );
};

export default ContactModal;
