import { readFileSync } from 'fs';
import path from 'path';
import { stripComments } from '@/__tests__/__fixtures__/the-346-strip-comments';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { DigitalEditor, DigitalFetchContext, DigitalMemberProducts } from '../DigitalProducts';
vi.mock('@/utils/tenant-scope', () => ({ getWriteTenantScope: vi.fn().mockResolvedValue('tenant1') }));
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
      const picker = vi.spyOn(host.querySelector<HTMLInputElement>('#digital-pdf')!, 'click').mockImplementation(() => {});
      await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Choose a PDF')!.click());
      expect(picker).toHaveBeenCalledOnce();
      const file = new File(['pdf content'], 'guide.pdf', { type: 'application/pdf' });
      const input = host.querySelector<HTMLInputElement>('#digital-pdf')!;
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
      expect(put).toHaveBeenCalledWith('https://upload.example', { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: file });
      expect(host.textContent).not.toContain('Drop a PDF here or choose a file.');
      expect(host.textContent).toContain('guide.pdf');
      expect(host.querySelector('[aria-label="Replace PDF"]')?.textContent).toBe('Replace');
      picker.mockClear();
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

describe('digital product status', () => {
  it.each([
    ['published', 'Save changes', 'published'],
    ['published', 'Unpublish', 'draft'],
    ['draft', 'Save draft', 'draft'],
  ] as const)('%s: %s sends %s', async (status, label, expected) => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host);
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    try {
      await act(async () => root.render(<DigitalFetchContext.Provider value={request}><DigitalEditor initial={{ id: 'product1', title: 'Guide', description: '', coverUrl: '', priceCents: 0, status, objectKey: 'pdf-key' }} onClose={() => {}} /></DigitalFetchContext.Provider>));
      const button = [...host.querySelectorAll('button')].find(b => b.textContent === label)!;
      await act(async () => button.click());
      expect(JSON.parse(request.mock.calls[0][1].body).status).toBe(expected);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it('does not save invalid edits to a published product', async () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host);
    const request = vi.fn();
    try {
      await act(async () => root.render(<DigitalFetchContext.Provider value={request}><DigitalEditor initial={{ id: 'product1', title: '', description: '', coverUrl: '', priceCents: 0, status: 'published', objectKey: 'pdf-key' }} onClose={() => {}} /></DigitalFetchContext.Provider>));
      await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Save changes')!.click());
      expect(request).not.toHaveBeenCalled();
      expect(host.textContent).toContain('Add a title.');
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});

it('uses the shared Input primitive for the PDF picker', () => {
  const source = stripComments(readFileSync(path.resolve(process.cwd(), 'src/components/digital-products/DigitalProducts.tsx'), 'utf8'));
  expect(source).not.toMatch(/<input\b/);
});

it('shows an owned unpublished product with its download action', async () => {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ products: [{ id: 'product1', title: 'Guide', description: '', coverUrl: '', priceCents: 0, status: 'draft', entitled: true }] }) });
  try {
    await act(async () => root.render(<DigitalFetchContext.Provider value={request}><DigitalMemberProducts /></DigitalFetchContext.Provider>));
    expect(host.textContent).toContain('No longer listed');
    expect([...host.querySelectorAll('button')].some(button => button.textContent === 'Download')).toBe(true);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
