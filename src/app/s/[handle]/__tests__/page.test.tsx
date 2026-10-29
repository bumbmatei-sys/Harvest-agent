import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ host: 'theharvest.app', getPage: vi.fn(), notFound: vi.fn(() => { throw new Error('404'); }) }));
vi.mock('next/headers', () => ({ headers: () => ({ get: () => mocks.host }) }));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
vi.mock('@/lib/signup-pages/server', () => ({ getPublicSignupPage: mocks.getPage }));
import SignupPage from '../page';
describe('public sign-up page', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.host = 'theharvest.app'; });
  it('renders an active page on the apex host', async () => {
    const page = { title: 'Join us', message: 'Welcome', fields: {} };
    mocks.getPage.mockResolvedValue(page);
    const result = await SignupPage({ params: { handle: 'join-us' } });
    expect(mocks.getPage).toHaveBeenCalledWith('join-us');
    expect(result.props.children[1].props).toMatchObject({ handle: 'join-us', ...page });
  });
  it('returns 404 for an unknown or inactive page', async () => {
    mocks.getPage.mockResolvedValue(null);
    await expect(SignupPage({ params: { handle: 'missing' } })).rejects.toThrow('404');
  });
  it('rejects tenant hosts before fetching', async () => {
    mocks.host = 'tenant.theharvest.app';
    await expect(SignupPage({ params: { handle: 'join-us' } })).rejects.toThrow('404');
    expect(mocks.getPage).not.toHaveBeenCalled();
  });
  it('propagates read failures instead of returning 404', async () => {
    mocks.getPage.mockRejectedValue(new Error('unavailable'));
    await expect(SignupPage({ params: { handle: 'join-us' } })).rejects.toThrow('unavailable');
  });
});
