import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { PublicSignupForm } from '../PublicSignupForm';
import { defaultFields } from '../SignupPageBuilder';
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.unstubAllGlobals(); });
async function mount(ok: boolean) {
  const fetcher = vi.fn().mockResolvedValue({ ok }); vi.stubGlobal('fetch', fetcher);
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  await act(async () => { root.render(<PublicSignupForm handle="join-us" title="Join us" message="Welcome" fields={defaultFields} />); });
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  return fetcher;
}
it('submits and shows success', async () => {
  const fetcher = await mount(true);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ handle: 'join-us', website: '', answers: {} });
  expect(container.textContent).toContain('Thank you for signing up.');
});
it('shows a submission failure and keeps the form', async () => {
  await mount(false);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not submit');
  expect(container.querySelector('form')).not.toBeNull();
});
