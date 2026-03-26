"use client";
import React, { useState } from 'react';
import { db, auth } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';

interface ContactSupportProps {
    onBack: () => void;
}

const ContactSupport: React.FC<ContactSupportProps> = ({ onBack }) => {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        subject: '',
        message: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError(null);

        try {
            await addDoc(collection(db, 'submissions'), {
                type: 'contact',
                status: 'pending',
                createdAt: new Date().toISOString(),
                userId: auth.currentUser?.uid || null,
                data: formData
            });
            setIsSuccess(true);
            window.scrollTo(0, 0);
        } catch (err) {
            console.error("Submission error", err);
            setError("Something went wrong. Please try again later.");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isSuccess) {
        return (
            <div className="min-h-screen bg-background-light pt-32 pb-16">
                <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
                    <button
                        onClick={onBack}
                        className="flex items-center gap-2 text-gray-600 hover:text-primary transition-colors mb-8 font-medium"
                    >
                        <span className="material-symbols-outlined">arrow_back</span>
                        Back to Home
                    </button>
                    <div className="bg-white p-12 rounded-2xl shadow-lg border border-gray-100 text-center animate-fade-in-up">
                        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                            <span className="material-symbols-outlined text-green-600 text-4xl">check_circle</span>
                        </div>
                        <h2 className="text-3xl font-black text-background-dark mb-4">Message Sent!</h2>
                        <p className="text-xl text-gray-600 mb-8 max-w-lg mx-auto">
                            Thank you for contacting us. We have received your message and will get back to you shortly.
                        </p>
                        <button
                            onClick={onBack}
                            className="bg-primary text-white font-bold py-3 px-8 rounded-xl hover:bg-yellow-600 transition-colors shadow-lg shadow-primary/20"
                        >
                            Back to Home
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background-light pt-32 pb-16">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
                <button 
                    onClick={onBack}
                    className="flex items-center gap-2 text-gray-600 hover:text-primary transition-colors mb-8 font-medium"
                >
                    <span className="material-symbols-outlined">arrow_back</span>
                    Back to Home
                </button>
                
                <h1 className="text-4xl sm:text-5xl font-black text-background-dark mb-6">Contact Support</h1>
                <p className="text-xl text-gray-600 leading-relaxed mb-12">
                    Have a question or need assistance? Our team is here to help you. Fill out the form below and we'll get back to you as soon as possible.
                </p>

                <div className="bg-white p-8 rounded-2xl shadow-lg border border-gray-100">
                    {error && (
                        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center gap-3">
                            <span className="material-symbols-outlined">error</span>
                            <p>{error}</p>
                        </div>
                    )}
                    <form className="space-y-6" onSubmit={handleSubmit}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">Name</label>
                                <input 
                                    required
                                    type="text" 
                                    name="name"
                                    value={formData.name}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
                                    placeholder="Your Name" 
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">Email Address</label>
                                <input 
                                    required
                                    type="email" 
                                    name="email"
                                    value={formData.email}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
                                    placeholder="email@example.com" 
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-2">Subject</label>
                            <input 
                                required
                                type="text" 
                                name="subject"
                                value={formData.subject}
                                onChange={handleChange}
                                className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
                                placeholder="How can we help?" 
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-2">Message</label>
                            <textarea 
                                required
                                rows={5} 
                                name="message"
                                value={formData.message}
                                onChange={handleChange}
                                className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors" 
                                placeholder="Please describe your issue or question..."
                            ></textarea>
                        </div>

                        <button 
                            type="submit" 
                            disabled={isSubmitting}
                            className={`w-full bg-primary text-white font-bold py-4 rounded-xl hover:bg-yellow-600 transition-colors shadow-lg shadow-primary/20 flex items-center justify-center gap-2 ${isSubmitting ? 'opacity-70 cursor-not-allowed' : ''}`}
                        >
                            {isSubmitting ? (
                                <>
                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                    Sending...
                                </>
                            ) : (
                                <>
                                    Send Message
                                    <span className="material-symbols-outlined">send</span>
                                </>
                            )}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default ContactSupport;