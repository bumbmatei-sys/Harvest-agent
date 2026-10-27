import { SOCIAL_MEDIA_MIME_TYPES, validateSocialMedia } from './media-rules';
import type { SocialMedia } from './types';

/** Upload directly to R2; the token is sent only to our presign endpoint. */
export async function uploadSocialMedia(
  file: File,
  token: string,
  onProgress?: (percent: number) => void,
): Promise<SocialMedia & { url: string; mimeType: string }> {
  const kind = (SOCIAL_MEDIA_MIME_TYPES.image as readonly string[]).includes(file.type) ? 'image'
    : (SOCIAL_MEDIA_MIME_TYPES.video as readonly string[]).includes(file.type) ? 'video' : null;
  if (!kind || validateSocialMedia([{ kind, mimeType: file.type, size: file.size }], [])) {
    throw new Error('Unsupported media type or file size.');
  }
  const response = await fetch('/api/storage/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ purpose: 'social', fileName: file.name, contentType: file.type, fileSize: file.size }),
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : `Upload could not be prepared (${response.status}).`;
    throw new Error(message);
  }
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('uploadUrl' in data) || typeof data.uploadUrl !== 'string' || !data.uploadUrl ||
    !('publicUrl' in data) || typeof data.publicUrl !== 'string' || !data.publicUrl) {
    throw new Error('Invalid upload response.');
  }
  const { uploadUrl, publicUrl } = data;
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 100));
    };
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}).`));
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
    xhr.onabort = () => reject(new Error('Upload was cancelled.'));
    xhr.send(file);
  });
  return { url: publicUrl, kind, mimeType: file.type, name: file.name };
}
