import { afterEach, describe, expect, it, vi } from 'vitest';

const adminState = vi.hoisted(() => ({
  apps: [] as unknown[],
  applicationDefault: vi.fn(() => ({ kind: 'adc' })),
  cert: vi.fn(() => ({ kind: 'cert' })),
  initializeApp: vi.fn(() => ({ name: '[DEFAULT]' })),
  app: vi.fn(() => ({ name: '[DEFAULT]' })),
  auth: vi.fn(() => ({ kind: 'auth' })),
  storage: vi.fn(() => ({ bucket: vi.fn(() => ({ kind: 'bucket' })) })),
}));

const getFirestore = vi.hoisted(() => vi.fn(() => ({ kind: 'db' })));

vi.mock('firebase-admin', () => {
  const api = {
    get apps() {
      return adminState.apps;
    },
    credential: {
      applicationDefault: adminState.applicationDefault,
      cert: adminState.cert,
    },
    initializeApp: adminState.initializeApp,
    app: adminState.app,
    auth: adminState.auth,
    storage: adminState.storage,
  };
  return { ...api, default: api };
});

vi.mock('firebase-admin/firestore', () => ({ getFirestore }));

const savedVercel = process.env.VERCEL;
const savedAccount = process.env.FIREBASE_SERVICE_ACCOUNT;

const UNAVAILABLE =
  '[firebase-admin] FIREBASE_SERVICE_ACCOUNT is not set on this Vercel deployment; admin Firestore is unavailable.';

function restoreEnv() {
  if (savedVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = savedVercel;
  if (savedAccount === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT;
  else process.env.FIREBASE_SERVICE_ACCOUNT = savedAccount;
}

async function loadAdmin() {
  vi.resetModules();
  return import('@/lib/firebase-admin');
}

afterEach(() => {
  restoreEnv();
  adminState.apps.length = 0;
  adminState.applicationDefault.mockClear();
  adminState.cert.mockClear();
  adminState.initializeApp.mockClear();
  adminState.auth.mockClear();
  getFirestore.mockClear();
  vi.restoreAllMocks();
});

describe('firebase-admin on Vercel without a service account', () => {
  it('does not call applicationDefault, logs once, and throws on use', async () => {
    process.env.VERCEL = '1';
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const mod = await loadAdmin();

    expect(adminState.applicationDefault).not.toHaveBeenCalled();
    expect(adminState.initializeApp).not.toHaveBeenCalled();
    expect(getFirestore).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]).toEqual([UNAVAILABLE]);

    expect(() => mod.adminDb.collection('blog_posts')).toThrow(mod.AdminNotConfiguredError);
    expect(() => mod.getReceiptsBucket()).toThrow(mod.AdminNotConfiguredError);
    expect(() => mod.assertAdminConfigured()).toThrow(mod.AdminNotConfiguredError);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('treats an unparseable service account the same way and does not log the value', async () => {
    process.env.VERCEL = '1';
    process.env.FIREBASE_SERVICE_ACCOUNT = 'not-json';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const mod = await loadAdmin();

    expect(adminState.applicationDefault).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toBe(UNAVAILABLE);
    expect(String(errorSpy.mock.calls[0]?.[0])).not.toContain('not-json');
    expect(() => {
      void mod.adminAuth.verifyIdToken;
    }).toThrow(mod.AdminNotConfiguredError);
    expect(() => mod.assertAdminConfigured()).toThrow(mod.AdminNotConfiguredError);
  });

  it('still uses the service account when it is set', async () => {
    process.env.VERCEL = '1';
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
      project_id: 'demo-project',
      client_email: 'demo@demo.iam.gserviceaccount.com',
      private_key: 'not-a-real-key',
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const mod = await loadAdmin();

    expect(adminState.applicationDefault).not.toHaveBeenCalled();
    expect(adminState.cert).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'demo-project',
      clientEmail: 'demo@demo.iam.gserviceaccount.com',
    }));
    expect(getFirestore).toHaveBeenCalledOnce();
    expect(mod.adminDb).toEqual({ kind: 'db' });
    expect(() => mod.assertAdminConfigured()).not.toThrow();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('firebase-admin outside Vercel', () => {
  it('still falls back to applicationDefault when no service account is set', async () => {
    delete process.env.VERCEL;
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const mod = await loadAdmin();

    expect(adminState.applicationDefault).toHaveBeenCalledOnce();
    expect(adminState.initializeApp).toHaveBeenCalledOnce();
    expect(mod.adminDb).toEqual({ kind: 'db' });
    expect(() => mod.assertAdminConfigured()).not.toThrow();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
