import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getMessaging, isSupported } from 'firebase/messaging';

// Import the Firebase configuration
import firebaseConfig from './firebase-applet-config.json';

// Initialize Firebase SDK
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export { app };
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Messaging — only in browser, not SSR
export const messaging = typeof window !== 'undefined'
  ? isSupported().then(supported => supported ? getMessaging(app) : null)
  : Promise.resolve(null);

export const VAPID_KEY = 'BLH6NQjAb2uv9n4y66AODEAstP9YdEh4qKEE63mgv2NDlHPIvgxIux-dbnm0CUncj9_BpCjeCUz5HUBkHXi24Yk';
