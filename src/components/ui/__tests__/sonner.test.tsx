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
 *   - it defaulted to `theme: "system"`. There is no ThemeProvider in the tree, so
 *     next-themes hands back its empty fallback context and `theme` is undefined;
 *     "system" then renders DARK toasts over a light-only UI on a dark OS.
 *   - its inline style pointed --normal-bg / --normal-text / --normal-border /
 *     --border-radius at shadcn tokens (--popover, --popover-foreground, --border,
 *     --radius) that globals.css does not define. An undefined var makes the custom
 *     property invalid at computed-value time, which drops the declaration that
 *     uses it to `unset` — a transparent, borderless, square-cornered toast.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
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
    await mountToaster();
    expect(container.querySelector('section[aria-label]')).not.toBeNull();
  });

  it('renders a toast body, so the calls in AdminDocs are no longer no-ops', async () => {
    await mountToaster();
    await showToast('Exported as PDF');
    expect(container.textContent).toContain('Exported as PDF');
  });

  it('stays light on a dark-mode OS, because the app itself is light-only', async () => {
    // With no ThemeProvider `useTheme()` gives back next-themes' empty fallback,
    // so a "system" default would hand sonner the OS preference — dark toasts on
    // a UI that has no dark mode.
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
    // The shadcn tokens globals.css never defined — each one silently disabled
    // the property that consumed it.
    for (const undefinedToken of ['--popover', 'var(--border)', 'var(--radius)']) {
      expect(style).not.toContain(undefinedToken);
    }
    for (const realToken of ['--surface-raised', '--text-body', '--border-default']) {
      expect(style).toContain(realToken);
    }
  });
});
