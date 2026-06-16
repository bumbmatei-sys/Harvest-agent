"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { auth, db } from '../firebase';
import { signInWithPopup, GoogleAuthProvider, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { useTenant } from '../contexts/TenantContext';


interface AuthPageProps {
 onNavigate: (page: string) => void;
}

const AuthPage: React.FC<AuthPageProps> = ({ onNavigate }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newsletter, setNewsletter] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [isChurchSignup, setIsChurchSignup] = useState(false);
  const { branding, tenantId: ctxTenantId, tenantName, tenantPlan } = useTenant();
  const isSubdomain = !!ctxTenantId;
  const hasCustomBranding = tenantPlan === 'max' || tenantPlan === 'ultra' || tenantPlan === 'enterprise';
  
  const [legalModalContent, setLegalModalContent] = useState<'terms' | 'privacy' | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Read tenantId from cookie (set by middleware)
    const cookies = document.cookie.split(';');
    const tenantCookie = cookies.find(c => c.trim().startsWith('tenantId='));
    if (tenantCookie) {
      setTenantId(tenantCookie.split('=')[1].trim());
    }
    // Check if arriving from presentation site "Start Ministry" button
    const params = new URLSearchParams(window.location.search);
    if (params.get('signup') === 'church') {
      setIsChurchSignup(true);
    }
  }, []);

 const handleGoogleSignIn = async () => {
 try {
 setLoading(true);
 setError('');
 
 
 
 const provider = new GoogleAuthProvider();
 const result = await signInWithPopup(auth, provider);
 
 // Store user in Firestore
 const userRef = doc(db, 'users', result.user.uid);
 let userSnap;
 try {
 userSnap = await getDoc(userRef);
 } catch (err) {
 try { handleFirestoreError(err, OperationType.GET, `users/${result.user.uid}`); } catch (e) { console.error(e); }
 return;
 }
 
 if (!userSnap.exists()) {
 try {
 const userData: any = {
   uid: result.user.uid,
   email: result.user.email,
   createdAt: new Date().toISOString(),
   role: 'user',
   tenantId: tenantId || null,
   newsletter: newsletter,
   termsAccepted: true
 };
 if (result.user.displayName) userData.displayName = result.user.displayName;
 if (result.user.photoURL) userData.photoURL = result.user.photoURL;

 await setDoc(userRef, userData);
 } catch (err) {
 try { handleFirestoreError(err, OperationType.WRITE, `users/${result.user.uid}`); } catch (e) { console.error(e); }
 return;
 }
 } else {
 // Update termsAccepted and newsletter for existing users
 try {
 await updateDoc(userRef, {
 termsAccepted: true,
 newsletter: newsletter
 });
 } catch (err) {
 try { handleFirestoreError(err, OperationType.UPDATE, `users/${result.user.uid}`); } catch (e) { console.error(e); }
 return;
 }
 }
 
 // For now don't do anything after connection, just maybe show a success state or stay here
 // The user said "after they get connected, for now dont do anything"
 // We could navigate to home or just show a message.
 } catch (err: any) {
 console.error(err);
 if (err.code === 'auth/popup-closed-by-user') {
 setError('Sign-in was cancelled.');
 } else {
 setError(err.message || 'Failed to sign in with Google.');
 }
 } finally {
 setLoading(false);
 }
 };

 const handleEmailAuth = async (e: React.FormEvent) => {
 e.preventDefault();
 try {
 setLoading(true);
 setError('');
 setSuccess('');
 
 
 
 if (isLogin) {
 const userCredential = await signInWithEmailAndPassword(auth, email, password);
 
 // Update termsAccepted and newsletter for existing users
 try {
 const userRef = doc(db, 'users', userCredential.user.uid);
 await updateDoc(userRef, {
 termsAccepted: true,
 newsletter: newsletter
 });
 } catch (err) {
 try { handleFirestoreError(err, OperationType.UPDATE, `users/${userCredential.user.uid}`); } catch (e) { console.error(e); }
 return;
 }
 } else {
 if (password !== confirmPassword) {
 setError('Passwords do not match.');
 setLoading(false);
 return;
 }
 
 const passwordRegex = /^(?=.*[A-Z])(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{10,}$/;
 if (!passwordRegex.test(password)) {
 setError('Password must be at least 10 characters long, contain at least 1 capital letter, and 1 symbol.');
 setLoading(false);
 return;
 }

 const result = await createUserWithEmailAndPassword(auth, email, password);

 // Store user in Firestore
 try {
 await setDoc(doc(db, 'users', result.user.uid), {
   uid: result.user.uid,
   email: result.user.email,
   displayName: email.split('@')[0],
   createdAt: new Date().toISOString(),
   role: 'user',
   tenantId: tenantId || null,
   newsletter: newsletter,
   termsAccepted: true
 });
 } catch (err) {
 try { handleFirestoreError(err, OperationType.WRITE, `users/${result.user.uid}`); } catch (e) { console.error(e); }
 return;
 }

 setSuccess('Account created successfully!');
 }
 } catch (err: any) {
 console.error(err);
 if (err.code === 'auth/operation-not-allowed') {
 setError('Email/Password sign-in is not enabled. Please enable it in the Firebase Console.');
 } else {
 setError(err.message || 'Authentication failed.');
 }
 } finally {
 setLoading(false);
 }
 };

 return (
 <div className="min-h-screen flex items-center justify-center bg-background-dark px-4 py-12 relative overflow-hidden">
 {/* Background Image & Overlay */}
 <div className="absolute inset-0 z-0">
 <Image 
 src={hasCustomBranding && branding.backgroundImage ? branding.backgroundImage : 'https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/No_people_just_2k_202512231746.jpeg'}
 alt="Harvest Background" 
 fill
 sizes="100vw"
 priority
 className="object-cover"
 />
 <div className="absolute inset-0 bg-gradient-to-b from-background-dark/80 via-background-dark/60 to-background-dark/95 mix-blend-multiply"></div>
 <div className="absolute inset-0 bg-black/40"></div>
 </div>

 {/* Background Ambience */}
 <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vw] h-[80vw] bg-primary/10 blur-[150px] rounded-full pointer-events-none mix-blend-overlay z-0"></div>

 <div className="max-w-md w-full bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl shadow-2xl overflow-hidden z-10 relative">
 <div className="p-8 sm:p-12">
 <div className="text-center mb-10">
 <div className="flex justify-center mb-6">
 <Image 
 src={hasCustomBranding && branding.logo ? branding.logo : 'https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png'}
 alt="Harvest Logo" 
 width={128}
 height={128}
 className="h-32 w-auto drop-shadow-2xl"
 />
 </div>
 <h2 className="text-2xl font-medium text-white/80">
   {isChurchSignup ? 'Set up your' : 'Welcome to'}
 </h2>
 <h1 className="text-4xl font-black text-white mt-1">
   {isChurchSignup ? 'Ministry' : (isSubdomain && tenantName ? tenantName : 'Harvest')}
 </h1>
 {isChurchSignup && (
   <p className="text-white/70 text-sm mt-2">
     Create your account to set up your church&apos;s app
   </p>
 )}
 </div>

 {error && (
 <div className="mb-6 p-4 bg-red-500/20 border-l-4 border-red-500 text-red-100 text-sm rounded backdrop-blur-sm">
 {error}
 </div>
 )}
 {success && (
 <div className="mb-6 p-4 bg-green-500/20 border-l-4 border-green-500 text-green-100 text-sm rounded backdrop-blur-sm">
 {success}
 </div>
 )}

 <button
 onClick={handleGoogleSignIn}
 disabled={loading}
 className="w-full flex items-center justify-center gap-3 bg-white/10 border text-white font-bold py-3 px-4 rounded-xl hover:bg-white/20 transition-all duration-100 mb-4 disabled:opacity-50"
 style={hasCustomBranding && branding.primaryColor ? { borderColor: branding.primaryColor + '40' } : { borderColor: 'rgba(255,255,255,0.3)' }}
 >
 <Image src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" width={24} height={24} className="w-6 h-6" />
 Continue with Google
 </button>

 {!showEmailForm ? (
 <button
 onClick={() => setShowEmailForm(true)}
 className="w-full flex items-center justify-center gap-3 bg-white/5 border text-white font-bold py-3 px-4 rounded-xl hover:bg-white/10 transition-all duration-100 mb-6"
 style={hasCustomBranding && branding.primaryColor ? { borderColor: branding.primaryColor + '30' } : { borderColor: 'rgba(255,255,255,0.2)' }}
 >
 <span className="material-symbols-outlined">mail</span>
 Continue with Email
 </button>
 ) : (
 <div className="animate-fade-in-up">
 <div className="flex items-center mb-6">
 <button 
 onClick={() => setShowEmailForm(false)}
 className="text-white/60 hover:text-white transition-colors flex items-center gap-1 text-sm"
 >
 <span className="material-symbols-outlined text-sm">arrow_back</span>
 Back
 </button>
 </div>
 <form onSubmit={handleEmailAuth} className="space-y-5">
 <div>
 <label className="block text-sm font-bold text-white mb-1">Email Address</label>
 <input
 type="email"
 required
 value={email}
 onChange={(e) => setEmail(e.target.value)}
 className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
 placeholder="you@example.com"
 />
 </div>
 <div>
 <label className="block text-sm font-bold text-white mb-1">Password</label>
 <input
 type="password"
 required
 value={password}
 onChange={(e) => setPassword(e.target.value)}
 className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
 placeholder="••••••••"
 />
 {!isLogin && (
 <p className="text-xs text-white/60 mt-2">
 Must be at least 10 characters, 1 capital letter, and 1 symbol.
 </p>
 )}
 </div>

 {!isLogin && (
 <div>
 <label className="block text-sm font-bold text-white mb-1">Confirm Password</label>
 <input
 type="password"
 required
 value={confirmPassword}
 onChange={(e) => setConfirmPassword(e.target.value)}
 className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white placeholder-gray-400 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
 placeholder="••••••••"
 />
 </div>
 )}

 {!isLogin && (
 <div className="space-y-4 mt-4">
 <label className="flex items-start gap-3 cursor-pointer group">
 <div className="relative flex items-center pt-0.5">
 <input
 type="checkbox"
 checked={newsletter}
 onChange={(e) => setNewsletter(e.target.checked)}
 className="w-5 h-5 rounded border-white/30 bg-white/10 text-primary focus:ring-primary focus:ring-offset-0 transition-all cursor-pointer"
 />
 </div>
 <span className="text-sm text-white/80 group-hover:text-white transition-colors">
 Sign up for the Harvest newsletter to receive updates and news.
 </span>
 </label>
 </div>
 )}

 <button
 type="submit"
 disabled={loading}
 className="w-full text-white font-bold py-3 px-4 rounded-xl transition-all duration-100 shadow-lg disabled:opacity-50"
 style={hasCustomBranding && branding.primaryColor ? { backgroundColor: branding.primaryColor, boxShadow: `0 10px 15px -3px ${branding.primaryColor}4D` } : {}}
 >
 {loading ? 'Please wait...' : (isLogin ? 'Sign In' : 'Create Account')}
 </button>
 </form>

 <div className="mt-8 text-center">
 <p className="text-white/80 text-sm">
 {isLogin ? "Don't have an account?" : "Already have an account?"}{' '}
 <button 
 onClick={() => setIsLogin(!isLogin)}
 className="text-primary font-bold hover:text-yellow-400 hover:underline transition-colors"
 >
 {isLogin ? 'Sign up' : 'Log in'}
 </button>
 </p>
 </div>
 </div>
 )}

 <div className="mt-6 text-center">
 <p className="text-xs text-white/60">
 By registering you accept the{' '}
 <button 
 type="button" 
 onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLegalModalContent('terms'); }} 
 className="text-primary hover:text-yellow-400 hover:underline transition-colors"
 >
 Terms of Use
 </button>
 {' '}and{' '}
 <button 
 type="button" 
 onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLegalModalContent('privacy'); }} 
 className="text-primary hover:text-yellow-400 hover:underline transition-colors"
 >
 Privacy Policy
 </button>
 .
 </p>
 </div>
 </div>
 </div>

 {legalModalContent && (
 <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
 <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden animate-fade-in-up">
 <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
 <h3 className="text-2xl font-bold text-gray-900">
 {legalModalContent === 'terms' ? 'Terms of Use' : 'Privacy Policy'}
 </h3>
 <button onClick={() => setLegalModalContent(null)} className="text-gray-400 hover:text-gray-600 transition-colors">
 <span className="material-symbols-outlined">close</span>
 </button>
 </div>
 <div className="p-6 overflow-y-auto text-gray-600 space-y-4">
 {legalModalContent === 'terms' ? (
 <>
 <p><strong>1. Acceptance of Terms</strong><br/>By accessing and using the Harvest App, you accept and agree to be bound by the terms and provision of this agreement.</p>
 <p><strong>2. Description of Service</strong><br/>Harvest provides users with access to a rich collection of resources, including various communications tools, forums, shopping services, and personalized content.</p>
 <p><strong>3. User Conduct</strong><br/>You agree to use the service only for lawful purposes and in a way that does not infringe the rights of, restrict or inhibit anyone else&apos;s use and enjoyment of the website.</p>
 <p><strong>4. Intellectual Property</strong><br/>All content included on this site, such as text, graphics, logos, button icons, images, audio clips, digital downloads, data compilations, and software, is the property of Harvest or its content suppliers.</p>
 </>
 ) : (
 <>
 <p><strong>1. Information We Collect</strong><br/>We collect information to provide better services to all our users. We collect information in the following ways: information you give us, and information we get from your use of our services.</p>
 <p><strong>2. How We Use Information</strong><br/>We use the information we collect from all our services to provide, maintain, protect and improve them, to develop new ones, and to protect Harvest and our users.</p>
 <p><strong>3. Information We Share</strong><br/>We do not share personal information with companies, organizations and individuals outside of Harvest unless one of the following circumstances applies: with your consent, for external processing, or for legal reasons.</p>
 <p><strong>4. Data Security</strong><br/>We work hard to protect Harvest and our users from unauthorized access to or unauthorized alteration, disclosure or destruction of information we hold.</p>
 </>
 )}
 </div>
 <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end">
 <button 
 onClick={() => setLegalModalContent(null)}
 className="px-6 py-2 bg-primary text-white font-bold rounded-xl hover:bg-yellow-600 transition-colors"
 >
 Close
 </button>
 </div>
 </div>
 </div>
 )}
 </div>
 );
};

export default AuthPage;
