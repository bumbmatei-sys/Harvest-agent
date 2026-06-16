import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from '../firebase-applet-config.json';

let app: admin.app.App;

if (!admin.apps.length) {
  // Prefer service account from env var (works on Vercel)
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccountJson) {
    try {
      const serviceAccount = JSON.parse(serviceAccountJson);
      app = admin.initializeApp({
        credential: admin.credential.cert({
          projectId: serviceAccount.project_id,
          clientEmail: serviceAccount.client_email,
          privateKey: serviceAccount.private_key,
        }),
        projectId: firebaseConfig.projectId,
      });
    } catch (error) {
      console.error('Firebase admin cert initialization error:', error);
      // Fall through to applicationDefault
    }
  }

  // Fallback: applicationDefault (works locally with gcloud)
  if (!app!) {
    try {
      app = admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: firebaseConfig.projectId,
      });
    } catch (error) {
      console.error('Firebase admin applicationDefault error:', error);
      // Last resort: no credential (limited functionality)
      app = admin.initializeApp({
        projectId: firebaseConfig.projectId,
      });
    }
  }
} else {
  app = admin.app();
}

export const adminDb = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const adminAuth = admin.auth();
