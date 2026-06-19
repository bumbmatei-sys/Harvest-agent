/**
 * Generate a deterministic placeholder image for a given seed.
 * Uses the Harvest golden color (#D4AF37) with a wheat stalk icon.
 * Zero external dependency — works offline.
 */

function hashToHue(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

/**
 * Returns a data URI SVG placeholder with wheat stalk and golden gradient.
 * Use as img src: getPlaceholderImage(id, 400, 300)
 */
export function getPlaceholderImage(seed: string, width = 400, height = 300): string {
  const hue = hashToHue(seed);
  // Golden range: 40-50 (warm gold tones)
  const goldHue = 42 + (hue % 8);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="hsl(${goldHue}, 60%, 92%)"/>
        <stop offset="100%" stop-color="hsl(${goldHue}, 50%, 82%)"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#bg)"/>
    <g transform="translate(${width / 2}, ${height / 2}) scale(${Math.min(width, height) / 120})" fill="none" stroke="#D4AF37" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.6">
      <path d="M0 25 C0 25 0 -5 0 -5 M0 -5 C-8 -15 -3 -25 0 -20 C3 -25 8 -15 0 -5 M0 5 C-10 -2 -6 -15 0 -10 C6 -15 10 -2 0 5 M0 15 C-12 8 -8 -5 0 0 C8 -5 12 8 0 15"/>
    </g>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Returns a CSS gradient background for placeholder divs.
 * Use with `style={{ background: getPlaceholderGradient(id) }}`
 */
export function getPlaceholderGradient(seed: string): string {
  const hue = hashToHue(seed);
  const goldHue = 42 + (hue % 8);
  return `linear-gradient(135deg, hsl(${goldHue}, 60%, 92%) 0%, hsl(${goldHue}, 50%, 82%) 100%)`;
}
