import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from '../firebase-applet-config.json';

let app: admin.app.App;

if (!admin.apps.length) {
 try {
 app = admin.initializeApp({
 credential: admin.credential.applicationDefault(),
 projectId: firebaseConfig.projectId,
 });
 } catch (error) {
 console.error('Firebase admin initialization error', error);
 app = admin.initializeApp({
 projectId: firebaseConfig.projectId,
 });
 }
} else {
 app = admin.app();
}

export const adminDb = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const adminAuth = admin.auth();
