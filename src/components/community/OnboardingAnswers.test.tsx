import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { OnboardingAnswers } from './OnboardingAnswers';
import { defaultCommunitySettings } from '@/lib/community/settings';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, ...path: string[]) => path.join('/'), getDoc: mock.get }));
describe('onboarding answers', () => {
  it('shows saved answers with their question and exposes read failures', async () => {
    const settings = defaultCommunitySettings();
    settings.questions.items = [{ id: 'q', label: 'Your goal', type: 'short', options: [], required: true }];
    mock.get.mockImplementation(async (path: string) => ({ exists: () => true, data: () => path.endsWith('/community') ? settings : { answers: { q: 'Learn' } } }));
    const host = document.createElement('div'); const root = createRoot(host);
    await act(async () => root.render(<OnboardingAnswers tenantId="a" uid="u" />));
    expect(host.textContent).toContain('Your goal'); expect(host.textContent).toContain('Learn');
    mock.get.mockRejectedValue(new Error('denied'));
    await act(async () => root.render(<OnboardingAnswers tenantId="a" uid="v" />));
    expect(host.querySelector('[role=alert]')?.textContent).toContain('Could not load');
    await act(async () => root.unmount());
  });
});
