import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadSocialMedia } from '../upload-media';

class FakeXhr {
  static last: FakeXhr;
  upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  status = 200;
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  constructor() { FakeXhr.last = this; }
}

afterEach(() => vi.unstubAllGlobals());

describe('uploadSocialMedia', () => {
  it('presigns, sends the file with progress, and returns the public media', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ uploadUrl: 'https://put.example', publicUrl: 'https://cdn.example/file' }) });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const file = new File(['hello'], 'clip.mov', { type: 'video/quicktime' });
    const progress = vi.fn();
    const result = uploadSocialMedia(file, 'token', progress);
    await vi.waitFor(() => expect(FakeXhr.last?.send).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/storage/presign', expect.objectContaining({
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
      body: JSON.stringify({ purpose: 'social', fileName: file.name, contentType: file.type, fileSize: file.size }),
    }));
    const xhr = FakeXhr.last;
    expect(xhr.open).toHaveBeenCalledWith('PUT', 'https://put.example');
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('Content-Type', file.type);
    expect(xhr.send).toHaveBeenCalledWith(file);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 });
    expect(progress).toHaveBeenCalledWith(50);
    xhr.onload?.();
    await expect(result).resolves.toEqual({ url: 'https://cdn.example/file', kind: 'video', mimeType: file.type, name: file.name });
  });
  it('surfaces presign and upload failures', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const file = new File(['a'], 'a.png', { type: 'image/png' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'Too large' }) }));
    await expect(uploadSocialMedia(file, 'token')).rejects.toThrow('Too large');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ uploadUrl: 'https://put.example', publicUrl: 'https://cdn.example/file' }) }));
    const previous = FakeXhr.last;
    const result = uploadSocialMedia(file, 'token');
    await vi.waitFor(() => expect(FakeXhr.last).not.toBe(previous));
    expect(FakeXhr.last.send).toHaveBeenCalled();
    FakeXhr.last.status = 403;
    FakeXhr.last.onload?.();
    await expect(result).rejects.toThrow('Upload failed (403)');
  });
});
