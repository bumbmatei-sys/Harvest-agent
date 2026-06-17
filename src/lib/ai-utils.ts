import crypto from 'crypto';

/**
 * Generate a unique access code for AI assistant.
 * Format: HARV-XXXX (8 chars, uppercase alphanumeric, no ambiguous chars)
 */
export function generateAccessCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1 (ambiguous)
  let code = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    if (i === 4) code += '-';
    code += chars[bytes[i] % chars.length];
  }
  return `HARV-${code.substring(5)}`;
}
