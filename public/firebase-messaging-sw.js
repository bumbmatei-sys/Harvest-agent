// Firebase Messaging Service Worker
// Config is posted by the main app after initialization.
// This avoids hardcoding credentials in the SW file.

let firebaseInitialized = false;

function initFirebase(config) {
  if (firebaseInitialized) return;
  importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
  firebase.initializeApp(config);
  firebaseInitialized = true;

  const messaging = firebase.messaging();

  // Only handle data-only background messages.
  // Messages with a `notification` payload are auto-displayed by FCM.
  messaging.onBackgroundMessage((payload) => {
    if (!payload.notification) {
      self.registration.showNotification(
        payload.data?.title || 'Harvest',
        {
          body: payload.data?.body || '',
          icon: '/icons/icon-192x192.png',
          badge: '/icons/icon-192x192.png',
          data: payload.data || {},
        }
      );
    }
  });
}

// Listen for config message from the main app
self.addEventListener('message', (event) => {
  if (event.data?.type === 'FIREBASE_CONFIG') {
    initFirebase(event.data.config);
  }
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow('/');
    })
  );
});
