"use client";
import React, { useState, useEffect, useRef } from 'react';
import { Bell, X } from 'lucide-react';
import { getToken, onMessage } from 'firebase/messaging';
import { doc, updateDoc, arrayUnion, getDoc } from 'firebase/firestore';
import { db, auth, messaging, VAPID_KEY } from '../firebase';
import { getTenantScope } from '../utils/tenant-scope';
import firebaseConfig from '../firebase-applet-config.json';

const STORAGE_KEY = 'harvest_notification_prompt_dismissed';

const NotificationPrompt: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const checkAndShow = async () => {
      if (sessionStorage.getItem(STORAGE_KEY)) return;
      if (typeof window === 'undefined' || !('Notification' in window)) return;
      if (Notification.permission === 'granted' || Notification.permission === 'denied') return;
      if (!auth.currentUser) return;

      try {
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (userDoc.exists() && userDoc.data().fcmTokens?.length > 0) return;
      } catch {
        // If we can't check, still show the prompt
      }

      if (cancelled) return;
      timerRef.current = setTimeout(() => {
        if (!cancelled) setVisible(true);
      }, 3000);
    };

    checkAndShow();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Foreground message listener + send config to service worker
  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | null = null;

    messaging.then(msg => {
      if (!mounted || !msg) return;

      // Send Firebase config to service worker so it can initialize
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(registration => {
          registration.active?.postMessage({
            type: 'FIREBASE_CONFIG',
            config: {
              apiKey: firebaseConfig.apiKey,
              authDomain: firebaseConfig.authDomain,
              projectId: firebaseConfig.projectId,
              storageBucket: firebaseConfig.storageBucket,
              messagingSenderId: firebaseConfig.messagingSenderId,
              appId: firebaseConfig.appId,
            },
          });
        });
      }

      unsubscribe = onMessage(msg, (payload) => {
        if (!mounted || !payload.notification) return;
        if (Notification.permission === 'granted') {
          new Notification(payload.notification.title || 'Harvest', {
            body: payload.notification.body || '',
            icon: '/icons/icon-192x192.png',
          });
        }
      });
    });

    return () => {
      mounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const handleEnable = async () => {
    setRequesting(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setVisible(false);
        sessionStorage.setItem(STORAGE_KEY, '1');
        return;
      }

      const msg = await messaging;
      if (!msg) {
        setVisible(false);
        return;
      }

      const token = await getToken(msg, { vapidKey: VAPID_KEY });
      if (!token) {
        setVisible(false);
        return;
      }

      const user = auth.currentUser;
      if (user) {
        const tenantId = await getTenantScope();
        await updateDoc(doc(db, 'users', user.uid), {
          fcmTokens: arrayUnion(token),
          tenantId: tenantId || null,
        });
      }

      setVisible(false);
      sessionStorage.setItem(STORAGE_KEY, '1');
    } catch (error) {
      console.error('Failed to enable notifications:', error);
      setVisible(false);
    } finally {
      setRequesting(false);
    }
  };

  const handleDismiss = () => {
    setVisible(false);
    sessionStorage.setItem(STORAGE_KEY, '1');
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-20 lg:bottom-6 left-4 right-4 lg:left-auto lg:right-6 lg:w-96 z-[200] animate-in slide-in-from-bottom-4 duration-300">
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-[#fcefc7] flex items-center justify-center flex-shrink-0">
          <Bell size={20} className="text-[#d4a017]" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-bold text-gray-900 text-sm mb-1">Stay updated</h4>
          <p className="text-xs text-gray-500 mb-3">
            Get notified about new posts and announcements from your church.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleEnable}
              disabled={requesting}
              className="px-4 py-1.5 bg-[#e6b325] text-white rounded-lg text-xs font-medium hover:bg-[#d4a017] transition-colors disabled:opacity-50"
            >
              {requesting ? 'Enabling...' : 'Enable'}
            </button>
            <button
              onClick={handleDismiss}
              className="px-4 py-1.5 text-gray-500 hover:text-gray-700 text-xs font-medium transition-colors"
            >
              Not now
            </button>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

export default NotificationPrompt;
