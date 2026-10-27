import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { DigitalEditor } from '../DigitalProducts';
vi.mock('@/utils/auth-fetch', () => ({ authFetch: vi.fn() }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
describe('digital PDF upload', () => {
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
    const file = new File(['x'], 'large.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: 15 * 1024 * 1024 + 1 });
    await select(file);
    expect(host.querySelector('[role=alert]')?.textContent).toContain('15MB');
    await act(async () => root.unmount()); host.remove();
  });
});
