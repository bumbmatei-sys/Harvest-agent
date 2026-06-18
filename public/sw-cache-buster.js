/**
 * PWA Cache Buster
 * Detects stale service worker caches and forces an update.
 *
 * The PWA's StaleWhileRevalidate strategy serves old JS immediately.
 * This script compares the current build ID against a stored one.
 * On mismatch → clears all caches → reloads once.
 *
 * Uses sessionStorage to prevent reload loops.
 */

(function() {
  'use strict';

  // Skip if not a PWA (standalone display) or no service worker support
  if (!('serviceWorker' in navigator)) return;

  const STORAGE_KEY = 'harvest_build_id';
  const RELOAD_FLAG = 'harvest_sw_reloading';

  // Prevent reload loops — if we just reloaded, don't do it again
  if (sessionStorage.getItem(RELOAD_FLAG)) {
    sessionStorage.removeItem(RELOAD_FLAG);
    return;
  }

  // Read current build ID from Next.js __NEXT_DATA__
  function getCurrentBuildId() {
    try {
      const nextData = document.getElementById('__NEXT_DATA__');
      if (nextData) {
        const parsed = JSON.parse(nextData.textContent || '{}');
        return parsed.buildId || null;
      }
    } catch { /* ignore */ }
    return null;
  }

  function checkAndReload() {
    const currentId = getCurrentBuildId();
    if (!currentId) return;

    const storedId = localStorage.getItem(STORAGE_KEY);

    if (storedId && storedId !== currentId) {
      // New deployment detected — clear caches and reload
      console.log('[PWA] New build detected:', storedId, '→', currentId, '— clearing caches');

      sessionStorage.setItem(RELOAD_FLAG, '1');
      localStorage.setItem(STORAGE_KEY, currentId);

      // Clear all service worker caches
      if ('caches' in window) {
        caches.keys().then(function(names) {
          names.forEach(function(name) {
            caches.delete(name);
          });
          // Reload after caches cleared
          window.location.reload();
        });
      } else {
        window.location.reload();
      }
    } else {
      // Store/update the build ID
      if (currentId) {
        localStorage.setItem(STORAGE_KEY, currentId);
      }
    }
  }

  // Run check after page load (don't block rendering)
  if (document.readyState === 'complete') {
    checkAndReload();
  } else {
    window.addEventListener('load', checkAndReload);
  }
})();
