import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { FreeMemberShell } from '@/components/community/FreeMemberShell';
import { QrCodeDialog } from './QrCodeDialog';
import { getPlanFeatures } from '@/utils/plan-features';

const mounts: { container: HTMLDivElement; root: ReturnType<typeof createRoot> }[] = [];
function render(element: React.ReactElement) {
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container); mounts.push({ container, root });
  act(() => root.render(element));
  return { container, unmount: () => { act(() => root.render(null)); } };
}
function cleanup() { for (const { root, container } of mounts.splice(0)) { act(() => root.unmount()); container.remove(); } }
function byText(selector: string, name: string) {
  const element = [...document.querySelectorAll<HTMLElement>(selector)].find(item => (item.getAttribute('aria-label') || item.textContent?.trim()) === name);
  if (!element) throw new Error(`Missing ${selector}: ${name}`);
  return element;
}
async function click(element: HTMLElement) { await act(async () => { element.click(); }); }
async function submit(form: HTMLFormElement) { await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }

const codes = vi.hoisted(() => ({ png: vi.fn(), svg: vi.fn() }));
vi.mock('qrcode', () => ({ default: { toDataURL: codes.png, toString: codes.svg } }));
vi.mock('@/components/community/DiscoveryData', () => ({ DiscoverData: () => <div>Discover</div>, CommunitiesData: () => <div>Communities</div> }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('makes QR and both download formats available through the real Free Sign-ups screen', async () => {
  const plan = getPlanFeatures('free');
  expect(plan.adminDashboard).toBe(false);
  expect(plan.signups).toBe(true);
  codes.png.mockResolvedValue('data:image/png;base64,AA=='); codes.svg.mockResolvedValue('<svg/>');
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ pages: [{ id: 'page', handle: 'hello', title: 'Hello', message: '', active: true, fields: ['name', 'email', 'phone', 'prayerRequest'].map(key => ({ key, enabled: true, required: false })) }] }) });
  render(<FreeMemberShell canCreateCommunity={plan.createCommunity} request={request} />);
  await click(byText('button', 'Sign-ups'));
  await click(byText('button', 'QR code'));
  expect((document.querySelector('img[alt="QR code for hello"]')!).getAttribute('src')).toBe('data:image/png;base64,AA==');
  expect(codes.png).toHaveBeenCalledWith('https://theharvest.app/s/hello', expect.anything());
  expect(codes.svg).toHaveBeenCalledWith('https://theharvest.app/s/hello', expect.objectContaining({ type: 'svg' }));
  const downloads: { href: string; name: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push({ href: this.href, name: this.download }); });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:svg');
  await click(byText('button', 'Download PNG'));
  await click(byText('button', 'Download SVG'));
  expect(downloads).toEqual([{ href: 'data:image/png;base64,AA==', name: 'hello-qr.png' }, { href: 'blob:svg', name: 'hello-qr.svg' }]);
});
it('shows generation errors and supports retry', async () => {
  codes.png.mockRejectedValueOnce(new Error('failed')).mockResolvedValue('data:image/png;base64,AA=='); codes.svg.mockResolvedValue('<svg/>');
  render(<QrCodeDialog url="https://grace.theharvest.app/form/form" name="Form" />);
  await click(byText('button', 'QR code'));
  expect((document.querySelector('[role="alert"]')!).textContent).toContain('Could not generate');
  await click(byText('button', 'Retry'));
  expect(byText('button', 'Download SVG')).toBeTruthy();
});

it('retains an existing follow-up when saving an editor and allows selecting None', async () => {
  const { SignupPageBuilder, defaultFields } = await import('@/components/signup-pages/SignupPageBuilder');
  const saved = vi.fn();
  const request = vi.fn().mockImplementation(async (path: string) => ({ ok: true, json: async () => path.startsWith('/api/form-follow-up/options') ? { options: [{ type: 'community', id: 'a', name: 'Grace' }] } : { ok: true } }));
  const view = render(<SignupPageBuilder request={request} page={{ id: 'page', handle: 'hello', title: 'Hello', message: '', active: true, fields: defaultFields, followUp: { type: 'community', id: 'a' } }} onSaved={saved} onCancel={() => {}} />);
  await act(async () => {});
  expect(view.container.textContent).toContain('Community: Grace');
  await submit(view.container.querySelector('form')!);
  const firstSave = request.mock.calls.find(([path]) => path === '/api/signup-pages');
  expect(JSON.parse(firstSave![1].body).followUp).toEqual({ type: 'community', id: 'a' });
  await click(view.container.querySelector<HTMLElement>('[role="combobox"]')!);
  await click(byText('[role="option"]', 'None'));
  await submit(view.container.querySelector('form')!);
  const saves = request.mock.calls.filter(([path]) => path === '/api/signup-pages');
  expect(JSON.parse(saves.at(-1)![1].body).followUp).toBeNull();
  expect(saved).toHaveBeenCalledTimes(2);
});
