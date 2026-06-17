import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getMessaging, isSupported } from 'firebase/messaging';

// Import the Firebase configuration
import firebaseConfig from './firebase-applet-config.json';

// Initialize Firebase SDK
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Messaging — only in browser, not SSR
export const messaging = typeof window !== 'undefined'
  ? isSupported().then(supported => supported ? getMessaging(app) : null)
  : Promise.resolve(null);

export const VAPID_KEY = 'BKI8dvU_2JyDvGWU4MxU49ujgFQeIajDArjcDnkDrAViiEtI8sTz4K0ZKjn83E2hVvVfMtx_Fls-omeEg5CljOY';
