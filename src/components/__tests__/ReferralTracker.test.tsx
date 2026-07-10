import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ReferralTracker from '../ReferralTracker';

/**
 * ReferralTracker is now mounted at the ROOT layout (src/app/layout.tsx), so a
 * logged-out affiliate visitor's ?ref=CODE is captured on the very first page
 * load — before login/onboarding — and survives (via localStorage) all the way
 * to the checkout call that stamps referrerId into the subscription metadata.
 *
 * Rendered with react-dom directly (not @testing-library/react) to avoid a
 * @testing-library/dom peer dependency the project doesn't install.
 */
// Silences React's "not wrapped in act(...)" environment warning.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function mount() {
  act(() => {
    root = createRoot(container);
    root.render(<ReferralTracker />);
  });
}

describe('ReferralTracker referral capture', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => { root?.unmount(); });
    container.remove();
  });

  it('captures ?ref= into localStorage and strips only the ref param', () => {
    window.history.replaceState({}, '', '/?ref=abc123&signup=church');

    mount();

    const stored = localStorage.getItem('affiliateReferrerId');
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.id).toBe('abc123');
    expect(typeof parsed.ts).toBe('number');
    // ref is cleaned from the URL, but the signup intent the SPA reads survives.
    expect(window.location.search).not.toContain('ref=abc123');
    expect(window.location.search).toContain('signup=church');
  });

  it('trims surrounding whitespace on the captured code', () => {
    window.history.replaceState({}, '', '/?ref=%20spaced%20');

    mount();

    expect(JSON.parse(localStorage.getItem('affiliateReferrerId')!).id).toBe('spaced');
  });

  it('does not overwrite an existing capture when no ?ref= is present', () => {
    localStorage.setItem('affiliateReferrerId', JSON.stringify({ id: 'existing', ts: Date.now() }));
    window.history.replaceState({}, '', '/');

    mount();

    expect(JSON.parse(localStorage.getItem('affiliateReferrerId')!).id).toBe('existing');
  });

  it('expires a capture older than 30 days', () => {
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
    localStorage.setItem('affiliateReferrerId', JSON.stringify({ id: 'stale', ts: old }));
    window.history.replaceState({}, '', '/');

    mount();

    expect(localStorage.getItem('affiliateReferrerId')).toBeNull();
  });

  it('migrates a legacy plain-string capture into the {id,ts} shape', () => {
    localStorage.setItem('affiliateReferrerId', 'legacyCode');
    window.history.replaceState({}, '', '/');

    mount();

    const parsed = JSON.parse(localStorage.getItem('affiliateReferrerId')!);
    expect(parsed.id).toBe('legacyCode');
    expect(typeof parsed.ts).toBe('number');
  });
});
