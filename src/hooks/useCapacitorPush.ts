'use client';
import { useEffect } from 'react';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, auth } from '../firebase';

// Dynamically imported so the bundle doesn't break in browsers where Capacitor isn't available.
async function registerNativePush() {
  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) return;

  const { PushNotifications } = await import('@capacitor/push-notifications');

  const perms = await PushNotifications.requestPermissions();
  if (perms.receive !== 'granted') return;

  await PushNotifications.register();

  PushNotifications.addListener('registration', async ({ value: token }) => {
    const user = auth.currentUser;
    if (!user || !token) return;
    try {
      // fcmTokens only — users.tenantId is locked to self-edits by
      // firestore.rules (server-authority; bundling it here used to make the
      // whole write fail whenever the scope differed).
      await updateDoc(doc(db, 'users', user.uid), {
        fcmTokens: arrayUnion(token),
      });
    } catch {
      // Non-fatal — user is logged in but token save failed
    }
  });

  PushNotifications.addListener('pushNotificationReceived', (notification) => {
    // Foreground notifications are handled by the OS on native; nothing to do.
    console.debug('[Harvest] foreground push:', notification.title);
  });
}

export function useCapacitorPush() {
  useEffect(() => {
    if (!auth.currentUser) return;
    registerNativePush();
  }, []);
}
