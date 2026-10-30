import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { DiscoverCard, DiscoverView } from '@/components/community/DiscoveryViews';
import { PublicSignupForm } from '@/components/signup-pages/PublicSignupForm';
import { defaultFields } from '@/components/signup-pages/SignupPageBuilder';
import PublicForm from '@/components/PublicForm';
vi.mock('@/lib/analytics/client', () => ({ trackProductEvent: vi.fn() }));

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

const listing = { tenantId: 'a', slug: 'grace', name: 'Grace community', shortDescription: 'Join us this week', logoUrl: '', memberCount: 12 };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it.each(['signup', 'form'])('%s success renders the actual shared Discover card and Join link', async kind => {
  const discover = render(<DiscoverView state={{ status: 'ready', data: [listing] }} />);
  const discoverContent = discover.container.querySelector('[data-slot="card-content"]')!.innerHTML;
  discover.unmount();
  const expected = render(<DiscoverCard listing={listing} action={{ href: 'https://grace.theharvest.app', label: 'Join' }} />);
  const expectedCard = expected.container.innerHTML;
  expect(expected.container.querySelector('[data-slot="card-content"]')!.innerHTML).toBe(discoverContent);
  expected.unmount();
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: true, json: async () => ({ item: { type: 'community', id: 'a', listing, href: 'https://grace.theharvest.app' } }) });
  vi.stubGlobal('fetch', fetcher);
  const view = render(kind === 'signup' ? <PublicSignupForm handle="hello" title="Hello" message="" fields={defaultFields} /> : <PublicForm tenantId="a" tenantName="Grace" logo={null} primaryColor="var(--brand-color)" formId="form" title="Hello" description="" successMessage="Saved" fields={[]} />);
  expect(view.container.textContent).not.toContain('Grace community');
  await submit(view.container.querySelector('form')!);
  const join = byText('a', 'Join');
  expect(join.getAttribute('href')).toBe('https://grace.theharvest.app');
  expect(join.closest('[data-slot="card"]')!.outerHTML).toBe(expectedCard);
  expect(fetcher.mock.calls[1][0]).toBe(kind === 'signup' ? '/api/form-follow-up?handle=hello' : '/api/form-follow-up?tenantId=a&formId=form');
});
it('renders a product with View and reports a follow-up read failure after saving', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Try later.' }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ item: { type: 'product', id: 'course', listing: { ...listing, name: 'Welcome course' }, href: 'https://grace.theharvest.app/courses/course' } }) });
  vi.stubGlobal('fetch', fetcher);
  const view = render(<PublicSignupForm handle="hello" title="Hello" message="" fields={defaultFields} />);
  await submit(view.container.querySelector('form')!);
  expect((document.querySelector('[role="alert"]')!).textContent).toContain('Your response was saved. Try later.');
  await click(byText('button', 'Retry next steps'));
  expect((byText('a', 'View')).getAttribute('href')).toBe('https://grace.theharvest.app/courses/course');
  expect(view.container.textContent).not.toContain('12 members');
});
