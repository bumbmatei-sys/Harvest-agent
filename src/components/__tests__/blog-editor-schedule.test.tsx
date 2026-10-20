import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * Schedule, publish, and take down from the post editor.
 *
 * An empty schedule used to skip the confirm step and leave the secondary
 * button on "Saving…" when the request never returned. Cancelling the native
 * date picker reported an empty value and wiped the chosen time. A stored
 * blank category was replaced in the editor by the first category on the list.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const authFetch = vi.hoisted(() => vi.fn());
const getWriteTenantScope = vi.hoisted(() => vi.fn(async () => 'grace'));
const snapshotDocs = vi.hoisted(() => ({ current: [] as Array<Record<string, unknown>> }));

vi.mock('../../firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'user-1', getIdToken: async () => 'token' } },
}));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  limit: () => ({}),
  doc: () => ({}),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  onSnapshot: (_q: unknown, next: (snap: unknown) => void) => {
    next({ docs: snapshotDocs.current.map((d) => ({ id: d.id as string, data: () => d })) });
    return () => {};
  },
}));
vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => 'grace',
  getWriteTenantScope,
  hasPlatformOverride: () => false,
  PLATFORM_TENANT_ID: 'harvest',
}));
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => ({ tenantPlan: null }) }));
vi.mock('../../utils/auth-fetch', () => ({ authFetch }));
vi.mock('../../utils/notify', () => ({ notifyError: () => {} }));
vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'get', DELETE: 'delete' },
  handleFirestoreError: () => {},
}));
vi.mock('../ImageUpload', () => ({ ImageUpload: () => null }));
vi.mock('../RichTextEditor', () => ({ default: () => null }));

import AdminBlogPostEditor from '../AdminBlogPostEditor';
import AdminBlog from '../AdminBlog';
import { BLOG_SAVE_TIMEOUT_MESSAGE, BLOG_SAVE_TIMEOUT_MS } from '../../lib/blog/visibility';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  authFetch.mockReset();
  getWriteTenantScope.mockResolvedValue('grace');
  snapshotDocs.current = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const livePost = {
  id: 'post-1',
  title: 'Second test',
  category: '',
  status: 'published' as const,
  content: '<p>Hello</p>',
  publishedAt: '2026-01-04T18:00:00.000Z',
  scheduleTimeZone: 'America/Los_Angeles',
};

type EditorPost = {
  id?: string;
  title: string;
  category: string;
  status: 'published' | 'draft' | 'scheduled';
  content: string;
  publishedAt?: string;
  scheduleTimeZone?: string;
};

async function mountEditor(post: EditorPost | null = livePost, categories: string[] = ['Communion', 'News']) {
  const onClose = vi.fn();
  await act(async () => {
    root.render(<AdminBlogPostEditor post={post} onClose={onClose} categories={categories} />);
  });
  return onClose;
}

function buttonByText(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === label);
  if (!found) throw new Error(`no button labelled ${label}`);
  return found as HTMLButtonElement;
}

async function clickLabel(label: string) {
  await act(async () => {
    buttonByText(label).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function chooseIntent(label: 'Publish now' | 'Schedule' | 'Draft') {
  const toggle = host.querySelector(`button[aria-label="${label}"]`);
  if (!toggle) throw new Error(`no intent ${label}`);
  await act(async () => {
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function setClock(value: string) {
  const input = host.querySelector('#blog-schedule-time');
  if (!(input instanceof HTMLInputElement)) throw new Error('schedule input missing');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function jsonResponse(body: unknown, status = 200) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

function textResponse(body: string, status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => {
      throw new SyntaxError('Unexpected token');
    },
  };
}

function previewBody(action: string) {
  return {
    ok: true,
    confirmToken: 'tok-1',
    preview: {
      action,
      church: { name: 'Grace Ministry' },
      time: {
        localLabel: 'Jul 20, 2027, 9:00 AM',
        timeZone: 'America/Los_Angeles',
        publishedAt: '2027-07-20T16:00:00.000Z',
      },
      visibility: action === 'schedule' ? 'hidden_until' : 'public',
    },
  };
}

function sentBodies(): Array<Record<string, unknown>> {
  return authFetch.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)));
}

describe('scheduling from the editor', () => {
  it('shows an inline error for an empty date and does not stay on Saving', async () => {
    const { publishedAt, ...undated } = livePost;
    void publishedAt;
    await mountEditor(undated);
    await chooseIntent('Schedule');
    await clickLabel('Schedule');

    expect(authFetch).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Choose a date and time.');
    expect(buttonByText('Save draft').disabled).toBe(false);
    expect(host.textContent).not.toContain('Saving…');
    expect(buttonByText('Schedule').textContent?.trim()).toBe('Schedule');
  });

  it('refuses a past date before any request', async () => {
    await mountEditor();
    await chooseIntent('Schedule');
    await act(async () => { setClock('2020-01-01T09:00'); });
    await clickLabel('Schedule');

    expect(authFetch).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Scheduled date must be in the future.');
    expect(host.textContent).not.toContain('Saving…');
  });

  it('previews a future schedule only after confirm, and writes on that confirm', async () => {
    authFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { action: string };
      return jsonResponse(previewBody(body.action));
    });
    const onClose = await mountEditor();
    await chooseIntent('Schedule');
    await act(async () => { setClock('2027-07-20T09:00'); });
    await clickLabel('Schedule');

    expect(authFetch).not.toHaveBeenCalled();
    expect(host.querySelector('[data-blog-schedule-preview]')?.textContent).toContain('hidden until');
    expect(buttonByText('Confirm')).toBeTruthy();
    expect(host.textContent).not.toContain('Saving…');

    await clickLabel('Confirm');

    expect(sentBodies()[0]).toMatchObject({ action: 'schedule', mode: 'preview', wallClock: '2027-07-20T09:00' });
    expect(sentBodies()[1]).toMatchObject({ action: 'schedule', mode: 'confirm', confirmToken: 'tok-1' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps the chosen date when the picker reports a cancel', async () => {
    await mountEditor();
    await chooseIntent('Schedule');
    await act(async () => { setClock('2027-07-20T09:00'); });
    const input = host.querySelector('#blog-schedule-time');
    if (!(input instanceof HTMLInputElement)) throw new Error('schedule input missing');
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    await act(async () => { setClock(''); });
    expect(input.value).toBe('2027-07-20T09:00');
  });

  it('unlocks and shows an error when a save never returns', async () => {
    authFetch.mockImplementation((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
    }));
    await mountEditor();
    await clickLabel('Publish now');
    expect(authFetch).not.toHaveBeenCalled();
    expect(buttonByText('Confirm')).toBeTruthy();

    const realSetTimeout = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (ms === BLOG_SAVE_TIMEOUT_MS) {
        return realSetTimeout(() => {
          if (typeof fn === 'function') fn();
        }, 0);
      }
      return realSetTimeout(fn, ms, ...args);
    }) as typeof setTimeout);
    try {
      await act(async () => {
        buttonByText('Confirm').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((resolve) => realSetTimeout(resolve, 30));
      });
    } finally {
      spy.mockRestore();
    }

    expect(host.textContent).toContain(BLOG_SAVE_TIMEOUT_MESSAGE);
    expect(host.textContent).not.toContain('Saving…');
    expect(buttonByText('Publish now').disabled).toBe(false);
    expect(buttonByText('Save draft').textContent?.trim()).toBe('Save draft');
    const signal = (authFetch.mock.calls[0]?.[1] as RequestInit | undefined)?.signal;
    expect(signal?.aborted).toBe(true);
  });

  it('shows the timeout when the request never settles', async () => {
    authFetch.mockImplementation(() => new Promise(() => {}));
    await mountEditor(null, ['Communion']);
    await chooseIntent('Schedule');
    await act(async () => { setClock('2026-12-01T10:00'); });
    await clickLabel('Schedule');
    expect(authFetch).not.toHaveBeenCalled();

    const realSetTimeout = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (ms === BLOG_SAVE_TIMEOUT_MS) {
        return realSetTimeout(() => {
          if (typeof fn === 'function') fn();
        }, 0);
      }
      return realSetTimeout(fn, ms, ...args);
    }) as typeof setTimeout);
    try {
      await act(async () => {
        buttonByText('Confirm').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((resolve) => realSetTimeout(resolve, 30));
      });
    } finally {
      spy.mockRestore();
    }

    expect(host.textContent).toContain(BLOG_SAVE_TIMEOUT_MESSAGE);
    expect(host.textContent).not.toContain('Saving…');
  });

  it('confirms a new untitled draft before creating it', async () => {
    authFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { action: string };
      return jsonResponse(previewBody(body.action));
    });
    await mountEditor(null, ['Communion', 'News']);
    const select = host.querySelector('select');
    if (!(select instanceof HTMLSelectElement)) throw new Error('category select missing');
    expect(select.value).toBe('');

    await chooseIntent('Schedule');
    const input = host.querySelector('#blog-schedule-time');
    if (!(input instanceof HTMLInputElement)) throw new Error('schedule input missing');
    expect(input.value).toBe('');
    await act(async () => { setClock('2026-12-01T10:00'); });
    await clickLabel('Schedule');

    expect(authFetch).toHaveBeenCalledTimes(0);
    expect(host.querySelector('[data-blog-schedule-preview]')?.textContent).toContain('hidden until');
    expect(host.textContent).not.toContain('Saving…');

    await clickLabel('Confirm');

    // Preview mints the token, then the write uses it. Both are after confirm.
    expect(authFetch).toHaveBeenCalledTimes(2);
    expect(sentBodies()[0]).toMatchObject({
      action: 'schedule',
      mode: 'preview',
      postId: null,
      wallClock: '2026-12-01T10:00',
      category: '',
    });
    expect(sentBodies()[1]).toMatchObject({ action: 'schedule', mode: 'confirm', postId: null });
  });

  it('starts a published post schedule empty and still refuses a past date', async () => {
    await mountEditor({
      ...livePost,
      publishedAt: '2026-09-28T16:00:00.000Z',
    });
    await chooseIntent('Schedule');
    const input = host.querySelector('#blog-schedule-time');
    if (!(input instanceof HTMLInputElement)) throw new Error('schedule input missing');
    expect(input.value).toBe('');
    await clickLabel('Schedule');
    expect(authFetch).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Choose a date and time.');

    await act(async () => { setClock('2026-09-28T09:00'); });
    await clickLabel('Schedule');
    expect(authFetch).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Scheduled date must be in the future.');
    expect(host.textContent).not.toContain('Saving…');
  });
});

describe('publish and take down confirm', () => {
  it('publishes only after the confirm step', async () => {
    authFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { action: string; mode?: string };
      if (body.mode === 'confirm') return jsonResponse({ ok: true });
      return jsonResponse(previewBody(body.action));
    });
    const onClose = await mountEditor();
    await clickLabel('Publish now');

    expect(authFetch).not.toHaveBeenCalled();
    expect(host.querySelector('[data-blog-schedule-preview]')?.textContent).toContain('becomes public on the ministry page now');
    expect(onClose).not.toHaveBeenCalled();

    await clickLabel('Confirm');

    expect(sentBodies()[0]).toMatchObject({ action: 'publishNow', mode: 'preview' });
    expect(sentBodies()[1]).toMatchObject({ action: 'publishNow', mode: 'confirm', confirmToken: 'tok-1' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('publishes a new unsaved draft only after confirm', async () => {
    authFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { action: string; mode?: string };
      if (body.mode === 'confirm') return jsonResponse({ ok: true });
      return jsonResponse(previewBody(body.action));
    });
    await mountEditor(null);
    await chooseIntent('Publish now');
    await clickLabel('Publish now');

    expect(authFetch).toHaveBeenCalledTimes(0);
    expect(host.querySelector('[data-blog-schedule-preview]')?.textContent).toContain('becomes public on the ministry page now');

    await clickLabel('Confirm');

    expect(authFetch).toHaveBeenCalledTimes(2);
    expect(sentBodies()[0]).toMatchObject({ action: 'publishNow', mode: 'preview', postId: null });
    expect(sentBodies()[1]).toMatchObject({
      action: 'publishNow',
      mode: 'confirm',
      postId: null,
      confirmToken: 'tok-1',
    });
  });

  it('takes a live post down only after confirm', async () => {
    authFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { action: string; mode?: string };
      if (body.mode === 'confirm') return jsonResponse({ ok: true });
      return jsonResponse(previewBody(body.action));
    });
    const onClose = await mountEditor();
    await chooseIntent('Draft');
    expect(buttonByText('Take down')).toBeTruthy();
    await clickLabel('Take down');

    expect(authFetch).not.toHaveBeenCalled();
    expect(host.querySelector('[data-blog-schedule-preview]')?.textContent).toContain('returns to a draft');
    expect(onClose).not.toHaveBeenCalled();

    await clickLabel('Confirm');

    expect(sentBodies()[0]).toMatchObject({
      action: 'unschedule',
      mode: 'preview',
      title: 'Second test',
      content: '<p>Hello</p>',
    });
    expect(sentBodies()[1]).toMatchObject({ action: 'unschedule', mode: 'confirm', confirmToken: 'tok-1' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('saves a live post as a draft without taking it down', async () => {
    authFetch.mockResolvedValue(jsonResponse({ ok: true, post: { id: 'post-1' } }));
    await mountEditor();
    await clickLabel('Save draft');

    expect(sentBodies()).toEqual([
      expect.objectContaining({ action: 'createDraft' }),
    ]);
    expect(sentBodies()[0].mode).toBeUndefined();
    expect(sentBodies()[0].action).not.toBe('unschedule');
  });
});

describe('a non-JSON save response', () => {
  it('keeps Publish now, Schedule and Draft, and the schedule field', async () => {
    await mountEditor();
    for (const label of ['Publish now', 'Schedule', 'Draft'] as const) {
      expect(host.querySelector(`button[aria-label="${label}"]`)).toBeTruthy();
    }
    const group = host.querySelector('[aria-label="Publish"]');
    expect(group?.className).toContain('flex-col');
    expect(group?.className).toContain('lg:flex-row');
    expect(group?.className).toContain('lg:bg-surface-sunken');
    const choice = host.querySelector('button[aria-label="Publish now"]');
    expect(choice?.className).toContain('data-[pressed]:bg-surface-gold');
    expect(choice?.className).toContain('lg:whitespace-nowrap');
    expect(choice?.className).not.toContain('whitespace-normal');
    expect(choice?.className).toContain('min-h-11');

    await chooseIntent('Schedule');
    const input = host.querySelector('#blog-schedule-time');
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect((input as HTMLInputElement).type).toBe('datetime-local');
    expect((input as HTMLInputElement).className).toContain('bg-surface-raised');
    await chooseIntent('Draft');
    expect(host.querySelector('#blog-schedule-time')).toBeNull();
  });

  it('shows the configuration message for a 503 HTML body, not a parse error', async () => {
    authFetch.mockResolvedValue(textResponse('<html><body>Bad gateway page</body></html>', 503));
    await mountEditor();
    await chooseIntent('Schedule');
    await act(async () => { setClock('2027-07-20T09:00'); });
    await clickLabel('Schedule');
    await clickLabel('Confirm');

    const message = "The server isn't configured to save posts. Nothing was saved.";
    expect(host.textContent).toContain(message);
    expect(host.textContent).not.toContain('Unexpected token');
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(message);
  });

  it('shows the HTTP status when a non-OK body is not JSON', async () => {
    authFetch.mockResolvedValue(textResponse('upstream failed', 502));
    await mountEditor();
    await clickLabel('Publish now');
    await clickLabel('Confirm');

    expect(host.textContent).toContain("Couldn't save the post (HTTP 502). Nothing was saved.");
    expect(host.textContent).not.toContain('Unexpected token');
  });

  it('does not treat an OK non-JSON body as a successful save', async () => {
    authFetch.mockResolvedValue(textResponse('saved, probably', 200));
    const onClose = await mountEditor();
    await clickLabel('Publish now');
    await clickLabel('Confirm');

    expect(host.textContent).toContain('The server sent an unexpected response. Refresh to check whether your changes were saved.');
    expect(host.textContent).not.toContain('Unexpected token');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps a JSON message from the server', async () => {
    authFetch.mockResolvedValue(jsonResponse({ ok: false, message: 'Choose a ministry.' }, 400));
    await mountEditor();
    await clickLabel('Publish now');
    await clickLabel('Confirm');

    expect(host.textContent).toContain('Choose a ministry.');
    expect(host.textContent).not.toContain('HTTP 400');
    expect(host.textContent).not.toContain('Unexpected token');
  });
});

describe('list and editor share a category', () => {
  it('leaves a blank stored category blank in the list and in the editor', async () => {
    snapshotDocs.current = [
      {
        id: 'second',
        title: 'Second test',
        status: 'published',
        content: '<p>Hi</p>',
        authorId: 'admin-1',
        createdAt: '2026-01-04T18:00:00.000Z',
        updatedAt: '2026-01-04T18:00:00.000Z',
      },
      {
        id: 'communion',
        title: 'Sunday',
        category: 'Communion',
        status: 'published',
        content: '<p>Hi</p>',
        authorId: 'admin-1',
        createdAt: '2026-02-04T18:00:00.000Z',
        updatedAt: '2026-02-04T18:00:00.000Z',
      },
    ];
    await act(async () => { root.render(<AdminBlog />); });

    const row = [...host.querySelectorAll('tr')].find((tr) => tr.textContent?.includes('Second test'));
    if (!row) throw new Error('Second test row missing');
    const cells = [...row.querySelectorAll('td')];
    expect(cells[1]?.textContent).toBe('');
    expect(host.textContent).toContain('Communion');

    const edit = row.querySelector('button[title="Edit"]');
    if (!edit) throw new Error('edit button missing');
    await act(async () => {
      edit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const select = host.querySelector('select');
    if (!(select instanceof HTMLSelectElement)) throw new Error('category select missing');
    expect(select.value).toBe('');
    expect([...select.options].some((option) => option.value === 'Communion')).toBe(true);
  });
});
