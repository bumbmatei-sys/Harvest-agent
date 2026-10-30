import { isSafeUrl } from '../../utils/sanitize';

/** Online meeting links must be absolute HTTPS URLs, including legacy reads. */
export function isSafeOnlineLink(value: string): boolean {
  try {
    return isSafeUrl(value) && new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
