import * as admin from 'firebase-admin';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import firebaseConfig from '../firebase-applet-config.json';

/**
 * Thrown when this process cannot build an admin credential.
 * Routes map it to 503. Importing this module must not throw: `next build`
 * evaluates route modules, and a missing service account on Vercel is a
 * runtime configuration failure, not a compile failure.
 */
export class AdminNotConfiguredError extends Error {
  constructor() {
    super('FIREBASE_SERVICE_ACCOUNT is not set; admin Firestore is unavailable.');
    this.name = 'AdminNotConfiguredError';
  }
}

const VERCEL_ADMIN_UNAVAILABLE =
  '[firebase-admin] FIREBASE_SERVICE_ACCOUNT is not set on this Vercel deployment; admin Firestore is unavailable.';

/**
 * Missing, or not a JSON service-account object. The raw value is never
 * logged: an unparseable env var may be a truncated key.
 */
function accountUnusable(raw: string | undefined): boolean {
  if (!raw) return true;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return true;
    const account = parsed as { project_id?: unknown; client_email?: unknown; private_key?: unknown };
    return typeof account.project_id !== 'string'
      || typeof account.client_email !== 'string'
      || typeof account.private_key !== 'string';
  } catch {
    return true;
  }
}

/**
 * On Vercel, application default credentials ask the metadata server and
 * fail with "Could not load the default credentials". That is not a local
 * gcloud session. Skip the fallback and fail on use instead.
 */
const adminBlocked = Boolean(process.env.VERCEL) && accountUnusable(process.env.FIREBASE_SERVICE_ACCOUNT);

if (adminBlocked) {
  console.error(VERCEL_ADMIN_UNAVAILABLE);
}

let app: admin.app.App | undefined;

if (!adminBlocked) {
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
    if (!app) {
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
}

function unavailableAdmin<T extends object>(): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      if (prop === 'then') return undefined;
      throw new AdminNotConfiguredError();
    },
  });
}

export const adminDb: Firestore = app
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : unavailableAdmin<Firestore>();

export const adminAuth: admin.auth.Auth = app
  ? admin.auth()
  : unavailableAdmin<admin.auth.Auth>();

/**
 * Fail before a caller that swallows admin errors (verifyAuth returns null).
 * Throws only when this process is blocked: Vercel with no usable service
 * account. Local dev and the emulator still have an app.
 */
export function assertAdminConfigured(): void {
  if (adminBlocked || !app) throw new AdminNotConfiguredError();
}

// Storage bucket for generated receipts / giving statements (matches functions/).
export const RECEIPTS_BUCKET = 'harvest-receipts-233a1';
export const getReceiptsBucket = () => {
  if (!app) throw new AdminNotConfiguredError();
  return admin.storage().bucket(RECEIPTS_BUCKET);
};
