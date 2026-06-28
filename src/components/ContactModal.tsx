"use client";
import React, { useState } from 'react';
import { ArrowLeft, Mail, MapPin, Lightbulb, ChevronDown, ChevronUp } from 'lucide-react';
import { db, auth } from '../firebase';
import { collection, addDoc, doc, getDoc } from 'firebase/firestore';
import { getTenantScope } from '../utils/tenant-scope';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { sendEmail, contactFormNotification } from '../utils/email';


interface ContactModalProps {
 isOpen: boolean;
 onClose: () => void;
}

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

const SubmitButton = ({ children, isSubmitting }: { children: React.ReactNode, isSubmitting?: boolean }) => (
 <button 
 type="submit"
 disabled={isSubmitting}
 className={`w-full bg-gold hover:bg-[#b8860b] text-white font-bold py-3.5 px-4 rounded-xl transition-colors shadow-sm mt-2 flex items-center justify-center gap-2 ${isSubmitting ? 'opacity-70 cursor-not-allowed' : ''}`}
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
 const [churchForm, setChurchForm] = useState({ contactName: '', phone: '', email: '', city: '', country: '', reason: '', website: '', facebook: '', instagram: '' });
 const [featureForm, setFeatureForm] = useState({ title: '', details: '' });

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
 await addDoc(collection(db, 'submissions'), {
   type,
   status: 'pending',
   createdAt: new Date().toISOString(),
   userId: auth.currentUser?.uid || null,
   data,
   tenantId: tenantId || null
 });

 // Fire-and-forget admin notification email
 if (tenantId) {
   try {
     const tenantSnap = await getDoc(doc(db, 'tenants', tenantId));
     if (tenantSnap.exists()) {
       const adminEmails: string[] = tenantSnap.data().adminEmails || [];
       const submitterName = data.name || data.contactName || 'Someone';
       const submitterEmail = data.email || '';
       const message = data.message || data.request || data.details || data.reason || '';
       const ministryName = tenantSnap.data().name || 'Your Ministry';
       adminEmails.forEach((adminEmail: string) => {
         if (adminEmail) {
           const emailData = contactFormNotification(adminEmail, submitterName, submitterEmail, message, ministryName);
           sendEmail(emailData).catch(console.error);
         }
       });
     }
   } catch (emailErr) {
     console.error('Failed to send admin notification:', emailErr);
   }
 }

 setSuccessMessage('Successfully submitted! Thank you.');
 resetForm();
 setTimeout(() => {
 setSuccessMessage('');
 setOpenSection(null);
 }, 3000);
 } catch (error) {
 handleFirestoreError(error, OperationType.WRITE, `submissions`);
 setErrorMessage("Something went wrong. Please try again later.");
 } finally {
 setIsSubmitting(false);
 }
 };

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
 id="church"
 icon={<MapPin size={20} className="text-green-500" />}
 iconBg="bg-green-50 "
 title="Suggest a Church"
 subtitle="Add a local body to the map."
 isOpen={openSection === 'church'}
 onToggle={toggleSection}
 >
 <form onSubmit={(e) => handleSubmit(e, 'church_suggestion', churchForm, () => setChurchForm({ contactName: '', phone: '', email: '', city: '', country: '', reason: '', website: '', facebook: '', instagram: '' }))}>
 <div className="bg-green-50 text-green-700 text-xs p-3 rounded-xl mb-6 leading-relaxed border border-green-100 ">
 Help us connect more people to a local body of believers. Please fill out all relevant details below.
 </div>

 <h5 className="text-[10px] font-bold text-gold tracking-wider uppercase mb-4 mt-6">CONTACT INFO</h5>
 <InputLabel>CONTACT PERSON</InputLabel>
 <InputField required name="contactName" value={churchForm.contactName} onChange={(e: any) => setChurchForm({...churchForm, contactName: e.target.value})} placeholder="Pastor or Admin Name" />
 <div className="flex gap-3">
 <div className="flex-1">
 <InputLabel>PHONE NUMBER</InputLabel>
 <InputField required name="phone" value={churchForm.phone} onChange={(e: any) => setChurchForm({...churchForm, phone: e.target.value})} placeholder="+1 234 567 890" />
 </div>
 <div className="flex-1">
 <InputLabel>EMAIL</InputLabel>
 <InputField required name="email" value={churchForm.email} onChange={(e: any) => setChurchForm({...churchForm, email: e.target.value})} placeholder="contact@church.co" type="email" />
 </div>
 </div>

 <h5 className="text-[10px] font-bold text-gold tracking-wider uppercase mb-4 mt-2">LOCATION</h5>
 <div className="flex gap-3">
 <div className="flex-1">
 <InputLabel>CITY</InputLabel>
 <InputField required name="city" value={churchForm.city} onChange={(e: any) => setChurchForm({...churchForm, city: e.target.value})} placeholder="New York" />
 </div>
 <div className="flex-1">
 <InputLabel>COUNTRY</InputLabel>
 <InputField required name="country" value={churchForm.country} onChange={(e: any) => setChurchForm({...churchForm, country: e.target.value})} placeholder="USA" />
 </div>
 </div>

 <h5 className="text-[10px] font-bold text-gold tracking-wider uppercase mb-4 mt-2">MESSAGE</h5>
 <InputLabel>WHY JOIN HARVEST?</InputLabel>
 <TextAreaField required name="reason" value={churchForm.reason} onChange={(e: any) => setChurchForm({...churchForm, reason: e.target.value})} placeholder="Tell us why you want to be a part of Harvest..." />

 <h5 className="text-[10px] font-bold text-gold tracking-wider uppercase mb-4 mt-2">LINKS</h5>
 <InputLabel>WEBSITE</InputLabel>
 <InputField name="website" value={churchForm.website} onChange={(e: any) => setChurchForm({...churchForm, website: e.target.value})} placeholder="https://mychurch.com" />
 <InputLabel>FACEBOOK</InputLabel>
 <InputField name="facebook" value={churchForm.facebook} onChange={(e: any) => setChurchForm({...churchForm, facebook: e.target.value})} placeholder="https://facebook.com/..." />
 <InputLabel>INSTAGRAM</InputLabel>
 <InputField name="instagram" value={churchForm.instagram} onChange={(e: any) => setChurchForm({...churchForm, instagram: e.target.value})} placeholder="https://instagram.com/..." />

 <SubmitButton isSubmitting={isSubmitting}>Submit Church</SubmitButton>
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

 </div>
 </div>
 );
};

export default ContactModal;