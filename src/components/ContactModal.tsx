"use client";
import React, { useState } from 'react';
import { ArrowLeft, Mail, MapPin, Lightbulb, HeartHandshake, ChevronDown, ChevronUp } from 'lucide-react';
import { db, auth } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';

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
    className="w-full bg-[#f8f9fa] dark:bg-[#1a1d27] rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-[#d4a017]/20 mb-4 placeholder-gray-400 border border-transparent dark:border-gray-800"
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
    className="w-full bg-[#f8f9fa] dark:bg-[#1a1d27] rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-[#d4a017]/20 mb-4 placeholder-gray-400 resize-none border border-transparent dark:border-gray-800"
  />
);

const SubmitButton = ({ children, isSubmitting }: { children: React.ReactNode, isSubmitting?: boolean }) => (
  <button 
    type="submit"
    disabled={isSubmitting}
    className={`w-full bg-[#d4a017] hover:bg-[#b8860b] text-white font-bold py-3.5 px-4 rounded-xl transition-colors shadow-sm mt-2 flex items-center justify-center gap-2 ${isSubmitting ? 'opacity-70 cursor-not-allowed' : ''}`}
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
    <div className="bg-white dark:bg-[#252a36] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 overflow-hidden mb-4 transition-all duration-300">
      <button 
        onClick={() => onToggle(id)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${iconBg}`}>
            {icon}
          </div>
          <div>
            <h4 className="text-sm font-bold text-gray-900 dark:text-white">{title}</h4>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>
          </div>
        </div>
        {isOpen ? (
          <ChevronUp size={20} className="text-gray-400" />
        ) : (
          <ChevronDown size={20} className="text-gray-400" />
        )}
      </button>
      
      {isOpen && (
        <div className="p-4 border-t border-gray-50 dark:border-gray-800 animate-in slide-in-from-top-2 duration-200">
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
  const [prayerForm, setPrayerForm] = useState({ name: '', email: '', request: '' });

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
      await addDoc(collection(db, 'submissions'), {
        type,
        status: 'pending',
        createdAt: new Date().toISOString(),
        userId: auth.currentUser?.uid || null,
        data
      });
      setSuccessMessage('Successfully submitted! Thank you.');
      resetForm();
      setTimeout(() => {
        setSuccessMessage('');
        setOpenSection(null);
      }, 3000);
    } catch (error) {
      console.error("Submission error", error);
      setErrorMessage("Something went wrong. Please try again later.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#f8f9fa] dark:bg-[#1a1d27] animate-in slide-in-from-bottom-full duration-300 overflow-hidden">
      {/* Header */}
      <div className="flex items-center px-4 py-4 bg-white dark:bg-[#1a1d27] border-b border-gray-100 dark:border-gray-800 sticky top-0 z-10">
        <button onClick={onClose} className="p-2 -ml-2 text-gray-600 dark:text-gray-300">
          <ArrowLeft size={24} />
        </button>
        <h2 className="text-lg font-bold text-gray-900 dark:text-white flex-1 text-center pr-8">Contact</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 pb-12">
        <div className="text-center mb-8 mt-4">
          <h2 className="text-2xl font-bold text-[#1a202c] dark:text-white mb-2">How can we help?</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm">We are here to serve you.</p>
        </div>

        {successMessage && (
          <div className="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm p-4 rounded-xl mb-6 text-center font-medium border border-green-100 dark:border-green-900/30">
            {successMessage}
          </div>
        )}

        {errorMessage && (
          <div className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm p-4 rounded-xl mb-6 text-center font-medium border border-red-100 dark:border-red-900/30">
            {errorMessage}
          </div>
        )}

        <AccordionItem
          id="support"
          icon={<Mail size={20} className="text-blue-500" />}
          iconBg="bg-blue-50 dark:bg-blue-900/30"
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
          iconBg="bg-green-50 dark:bg-green-900/30"
          title="Suggest a Church"
          subtitle="Add a local body to the map."
          isOpen={openSection === 'church'}
          onToggle={toggleSection}
        >
          <form onSubmit={(e) => handleSubmit(e, 'church_suggestion', churchForm, () => setChurchForm({ contactName: '', phone: '', email: '', city: '', country: '', reason: '', website: '', facebook: '', instagram: '' }))}>
            <div className="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-xs p-3 rounded-xl mb-6 leading-relaxed border border-green-100 dark:border-green-900/30">
              Help us connect more people to a local body of believers. Please fill out all relevant details below.
            </div>

            <h5 className="text-[10px] font-bold text-[#d4a017] tracking-wider uppercase mb-4 mt-6">CONTACT INFO</h5>
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

            <h5 className="text-[10px] font-bold text-[#d4a017] tracking-wider uppercase mb-4 mt-2">LOCATION</h5>
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

            <h5 className="text-[10px] font-bold text-[#d4a017] tracking-wider uppercase mb-4 mt-2">MESSAGE</h5>
            <InputLabel>WHY JOIN HARVEST?</InputLabel>
            <TextAreaField required name="reason" value={churchForm.reason} onChange={(e: any) => setChurchForm({...churchForm, reason: e.target.value})} placeholder="Tell us why you want to be a part of Harvest..." />

            <h5 className="text-[10px] font-bold text-[#d4a017] tracking-wider uppercase mb-4 mt-2">LINKS</h5>
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
          iconBg="bg-purple-50 dark:bg-purple-900/30"
          title="Suggest a Feature"
          subtitle="Help us improve the app."
          isOpen={openSection === 'feature'}
          onToggle={toggleSection}
        >
          <form onSubmit={(e) => handleSubmit(e, 'feature', featureForm, () => setFeatureForm({ title: '', details: '' }))}>
            <div className="bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 text-xs p-3 rounded-xl mb-6 leading-relaxed border border-purple-100 dark:border-purple-900/30">
              Have an idea to make Harvest better? We'd love to hear about it!
            </div>

            <InputLabel>FEATURE TITLE</InputLabel>
            <InputField required name="title" value={featureForm.title} onChange={(e: any) => setFeatureForm({...featureForm, title: e.target.value})} placeholder="e.g. Dark Mode for Maps" />
            
            <InputLabel>DETAILS</InputLabel>
            <TextAreaField required name="details" value={featureForm.details} onChange={(e: any) => setFeatureForm({...featureForm, details: e.target.value})} placeholder="Describe your idea..." />
            
            <SubmitButton isSubmitting={isSubmitting}>Submit Suggestion</SubmitButton>
          </form>
        </AccordionItem>

        <AccordionItem
          id="prayer"
          icon={<HeartHandshake size={20} className="text-orange-500" />}
          iconBg="bg-orange-50 dark:bg-orange-900/30"
          title="Prayer Request"
          subtitle="Let us stand with you in faith."
          isOpen={openSection === 'prayer'}
          onToggle={toggleSection}
        >
          <form onSubmit={(e) => handleSubmit(e, 'prayer', prayerForm, () => setPrayerForm({ name: '', email: '', request: '' }))}>
            <div className="bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 text-xs p-3 rounded-xl mb-6 leading-relaxed border border-orange-100 dark:border-orange-900/30">
              We believe in the power of prayer. Share your request, and our team will stand in faith with you.
            </div>

            <InputLabel>YOUR NAME</InputLabel>
            <InputField required name="name" value={prayerForm.name} onChange={(e: any) => setPrayerForm({...prayerForm, name: e.target.value})} placeholder="Your Name" />
            
            <InputLabel>EMAIL</InputLabel>
            <InputField name="email" value={prayerForm.email} onChange={(e: any) => setPrayerForm({...prayerForm, email: e.target.value})} placeholder="Email (Optional)" type="email" />
            
            <InputLabel>PRAYER REQUEST</InputLabel>
            <TextAreaField required name="request" value={prayerForm.request} onChange={(e: any) => setPrayerForm({...prayerForm, request: e.target.value})} placeholder="How can we pray for you?" />
            
            <SubmitButton isSubmitting={isSubmitting}>Send Request</SubmitButton>
          </form>
        </AccordionItem>

      </div>
    </div>
  );
};

export default ContactModal;