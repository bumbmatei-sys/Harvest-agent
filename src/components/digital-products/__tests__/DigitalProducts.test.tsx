import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { DigitalEditor, DigitalFetchContext } from '../DigitalProducts';
vi.mock('@/utils/auth-fetch', () => ({ authFetch: vi.fn() }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
describe('digital PDF upload', () => {
  it('shows the attached PDF and restores the prompt when removed', async () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host);
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ uploadUrl: 'https://upload.example', key: 'pdf-key' }) });
    const put = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);
    try {
      await act(async () => root.render(<DigitalFetchContext.Provider value={request}><DigitalEditor initial={{ id: 'product1', title: 'Guide', description: '', coverUrl: '', priceCents: 0, status: 'draft' }} onClose={() => {}} /></DigitalFetchContext.Provider>));
      await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent?.includes('PDF'))!.click());
      expect(host.textContent).toContain('Drop a PDF here or choose a file.');
      const file = new File(['pdf content'], 'guide.pdf', { type: 'application/pdf' });
      const input = host.querySelector<HTMLInputElement>('#digital-pdf')!;
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
      expect(put).toHaveBeenCalledWith('https://upload.example', { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: file });
      expect(host.textContent).not.toContain('Drop a PDF here or choose a file.');
      expect(host.textContent).toContain('guide.pdf');
      expect(host.querySelector('[aria-label="Replace PDF"]')?.textContent).toBe('Replace');
      const picker = vi.spyOn(input, 'click').mockImplementation(() => {});
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Replace PDF"]')!.click());
      expect(picker).toHaveBeenCalledOnce();
      const remove = host.querySelector<HTMLButtonElement>('[aria-label="Remove PDF"]')!;
      expect(remove.textContent).toBe('Remove');
      await act(async () => remove.click());
      expect(host.textContent).toContain('Drop a PDF here or choose a file.');
      expect(host.textContent).not.toContain('guide.pdf');
      await act(async () => host.querySelector<HTMLButtonElement>('[data-step="price"]')!.click());
      expect(host.textContent).toContain('Upload a PDF.');
      expect(host.querySelector<HTMLButtonElement>('[data-wizard-primary="publish"]')?.disabled).toBe(true);
    } finally {
      await act(async () => root.unmount()); host.remove(); put.mockRestore();
    }
  });
  it('shows validation errors for non-PDF and oversized files', async () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<DigitalEditor onClose={() => {}} />));
    const step = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('PDF'))!;
    await act(async () => step.click());
    const input = host.querySelector<HTMLInputElement>('#digital-pdf')!;
    const select = async (file: File) => { Object.defineProperty(input, 'files', { configurable: true, value: [file] }); await act(async () => input.dispatchEvent(new Event('change', { bubbles: true }))); };
    await select(new File(['x'], 'photo.png', { type: 'image/png' }));
    expect(host.querySelector('[role=alert]')?.textContent).toContain('Choose a PDF');
    expect(host.querySelectorAll('[role=alert]')).toHaveLength(1);
    const file = new File(['x'], 'large.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: 15 * 1024 * 1024 + 1 });
    await select(file);
    expect(host.querySelector('[role=alert]')?.textContent).toContain('15MB');
    expect(host.querySelectorAll('[role=alert]')).toHaveLength(1);
    await act(async () => root.unmount()); host.remove();
  });
});
