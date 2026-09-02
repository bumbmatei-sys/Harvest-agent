import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { toast } from 'sonner';
import { Toaster } from '../sonner';

/**
 * `<Toaster />` had never been mounted anywhere in the app, so every `toast.*`
 * call in AdminDocs (export / import / share-to-livestream feedback) was a silent
 * no-op — and this wrapper had never rendered either. Two things it got wrong were
 * invisible for exactly that reason:
 *
 *   - it defaulted to `theme: "system"`, which renders DARK toasts over a light UI
 *     on a dark OS.
 *   - its inline style pointed --normal-bg / --normal-text / --normal-border /
 *     --border-radius at shadcn tokens (--popover, --popover-foreground, --border,
 *     --radius) that globals.css did not define. An undefined var makes the custom
 *     property invalid at computed-value time, which drops the declaration that
 *     uses it to `unset` — a transparent, borderless, square-cornered toast.
 *
 * ⚠️ THE-273 CHANGED THE FIRST ONE. The fix at the time was to hard-code `light`,
 * because there genuinely was no dark mode and no theme provider — and this file
 * asserted that. Dark mode has since landed in four palettes, `<Toaster />` is
 * mounted app-wide in layout.tsx, and Classic (whose dark ground is #1C1C1C) is
 * the default family, so a pinned light toast became the same bug pointing the
 * other way. The wrapper now reads Harvest's own theme through
 * `src/lib/use-theme.ts`, whose `theme` is the RESOLVED theme and never the
 * string "system".
 *
 * The theme-following behaviour, all four palettes and the contrast of the toast's
 * own foreground on its own ground live in
 * `src/__tests__/the-273-toast-dark-mode.test.tsx`. What stays here is the wrapper's
 * local contract: it mounts, it renders a body, and its style points only at tokens
 * this app actually defines.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-palette');
  document.documentElement.classList.remove('dark');
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => { toast.dismiss(); });
  await act(async () => { root.unmount(); });
  container.remove();
});

const mountToaster = async () => {
  await act(async () => {
    root = createRoot(container);
    root.render(<Toaster />);
  });
};

/**
 * sonner appends the toast list on a macrotask, not a microtask, so draining the
 * promise queue alone leaves the list empty (intermittently — which is worse).
 */
const showToast = async (message: string) => {
  await act(async () => { toast.success(message); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
};

const toastList = () => container.querySelector('[data-sonner-toaster]');

describe('Toaster', () => {
  it('mounts without a ThemeProvider anywhere in the tree', async () => {
    // Still true, and now for a stronger reason: the hook it reads is a
    // first-party read of the stamp on <html>, so there is no provider to
    // forget to mount and no fallback context to fall into.
    await mountToaster();
    expect(container.querySelector('section[aria-label]')).not.toBeNull();
  });

  it('renders a toast body, so the calls in AdminDocs are no longer no-ops', async () => {
    await mountToaster();
    await showToast('Exported as PDF');
    expect(container.textContent).toContain('Exported as PDF');
  });

  it('follows the app, not the OS — a dark OS on a light page still gets a light toast', async () => {
    // The original "system" bug, re-asserted against the new source of truth.
    // Nothing is stamped on <html>, so the app is rendering light; the OS
    // preference below must not reach the toast.
    const realMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-color-scheme: dark'),
      media: query,
      onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      await mountToaster();
      await showToast('Exported as PDF');
      expect(toastList()!.getAttribute('data-sonner-theme')).toBe('light');
    } finally {
      window.matchMedia = realMatchMedia;
    }
  });

  it('sets every sonner colour var to a token this app actually defines', async () => {
    await mountToaster();
    await showToast('Exported as PDF');
    const style = toastList()!.getAttribute('style') || '';
    // The shadcn tokens globals.css did not define when this wrapper was
    // installed — each one silently disabled the property that consumed it.
    // THE-263/THE-264 have since defined all four, and they now resolve to the
    // very same values; the point of keeping this assertion is that the toast
    // names the tokens the app paints with directly, one hop rather than two.
    for (const undefinedToken of ['--popover', 'var(--border)', 'var(--radius)']) {
      expect(style).not.toContain(undefinedToken);
    }
    for (const realToken of ['--surface-raised', '--text-body', '--border-default']) {
      expect(style).toContain(realToken);
    }
  });
});
