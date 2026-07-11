// ─────────────────────────────────────────────
// HARVEST — YouTube URL + duration helpers (pure, server-safe)
//
// Shared by /api/youtube-meta (video duration/title) and /api/lesson-generate
// (Gemini video input). No Firebase, no secrets — just parsing, so it's unit
// tested directly.
// ─────────────────────────────────────────────

/**
 * Extract an 11-char YouTube video id from any common URL form
 * (`watch?v=`, `youtu.be/`, `/shorts/`, `/embed/`, `/live/`, `/v/`) or a bare
 * id. Returns null when nothing id-shaped is found.
 */
export function extractYouTubeId(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  const s = input.trim();

  // Already a bare id.
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;

  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();

    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }

    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (u.pathname === '/watch') {
        const id = u.searchParams.get('v') || '';
        return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
      }
      const m = u.pathname.match(/^\/(?:shorts|embed|v|live)\/([a-zA-Z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch {
    // Not a parseable URL — fall through to loose matching.
  }

  // Last resort: a `v=` param or an id-shaped token anywhere in the string.
  const vMatch = s.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (vMatch) return vMatch[1];
  const loose = s.match(/(?:youtu\.be\/|shorts\/|embed\/|live\/|\/v\/)([a-zA-Z0-9_-]{11})/);
  if (loose) return loose[1];

  return null;
}

/** Canonical watch URL for an id — the clean form we hand to Gemini. */
export function canonicalYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Turn an ISO-8601 duration (YouTube `contentDetails.duration`, e.g.
 * `PT34M12S`, `PT1H2M`, `PT48S`) into a short human string for the lesson's
 * duration field:
 *   PT34M12S → "34 min"   (seconds dropped, matching how lessons are labelled)
 *   PT1H2M   → "1 hr 2 min"
 *   PT1H     → "1 hr"
 *   PT48S    → "48 sec"
 * Returns "" for an unparseable / empty input.
 */
export function formatIsoDuration(iso: string): string {
  if (!iso || typeof iso !== 'string') return '';
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso.trim());
  if (!m) return '';

  const days = parseInt(m[1] || '0', 10);
  const hours = parseInt(m[2] || '0', 10) + days * 24;
  const mins = parseInt(m[3] || '0', 10);
  const secs = parseInt(m[4] || '0', 10);

  if (hours === 0 && mins === 0) {
    return secs > 0 ? `${secs} sec` : '';
  }
  if (hours === 0) {
    return `${mins} min`;
  }
  return mins > 0 ? `${hours} hr ${mins} min` : `${hours} hr`;
}
