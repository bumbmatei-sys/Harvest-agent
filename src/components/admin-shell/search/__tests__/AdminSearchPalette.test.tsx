import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Church, Home } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminSearchPalette, SEARCH_DEBOUNCE_MS, type PalettePage, type PaletteSearchConfig, type PaletteTarget } from '../AdminSearchPalette';
import { clearContentIndex } from '../content-index';
import type { RawDoc, ReadDocs, ReadSpec } from '../sources';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const doc = (id: string, data: Record<string, unknown>): RawDoc => ({ id, data });

const ALL = ['crm', 'docs', 'courses', 'events', 'forms'];

const DATA: Record<string, RawDoc[]> = {
  contacts: [
    doc('c1', { tenantId: 'grace', firstName: 'Anna', lastName: 'Popescu', email: 'anna@grace.org', phone: '+40 722 111 222' }),
    doc('c2', { tenantId: 'grace', firstName: 'Ștefan', lastName: 'Ionescu', email: 'stefan@grace.org' }),
    doc('cx', { tenantId: 'rival', firstName: 'Anna', lastName: 'Rival', email: 'anna@rival.org' }),
  ],
  users: [],
  docs: [
    ...Array.from({ length: 7 }, (_, i) => doc(`n${i}`, { tenantId: 'grace', title: `Grace sermon notes ${i}`, content: '<p>body</p>' })),
    doc('nx', { tenantId: 'rival', title: 'Grace secret plan of the rival' }),
  ],
  courses: [
    doc('k1', {
      tenantId: 'grace',
      title: 'Grace foundations',
      status: 'published',
      levels: [{ id: 'l', title: 'L', sections: [{ id: 's', title: 'S', lessons: [{ id: 'a', title: 'Grace and faith' }] }] }],
    }),
  ],
  'tenants/grace/events': [doc('e1', { title: 'Grace Sunday lunch', location: 'Hall' })],
  'tenants/grace/forms': [],
};

function fakeRead(overrides: Record<string, () => Promise<never>> = {}) {
  const calls: ReadSpec[] = [];
  const read: ReadDocs = vi.fn(async (spec: ReadSpec) => {
    calls.push(spec);
    const key = spec.path.join('/');
    if (overrides[key]) return overrides[key]();
    return { docs: DATA[key] ?? [], truncated: false };
  });
  return { read, calls };
}

const pages = (select: (key: string) => void = () => {}): PalettePage[] => [
  { key: 'dashboard', label: 'Home', group: 'Home', icon: Home, onSelect: () => select('dashboard') },
  { key: 'people:crm', label: 'CRM', group: 'People', icon: Church, onSelect: () => select('crm') },
  { key: 'products:courses', label: 'Courses', group: 'Products', icon: Church, onSelect: () => select('courses') },
];

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => clearContentIndex());
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

interface MountOptions {
  access?: string[];
  tenantId?: string | null;
  read?: ReadDocs;
  onOpenItem?: (target: PaletteTarget) => void;
  select?: (key: string) => void;
  noSearch?: boolean;
}

async function mount(options: MountOptions = {}) {
  const onOpenChange = vi.fn();
  const onOpenItem = vi.fn<(target: PaletteTarget) => void>(options.onOpenItem);
  const { read } = options.read ? { read: options.read } : fakeRead();
  const search: PaletteSearchConfig | undefined = options.noSearch
    ? undefined
    : { tenantId: options.tenantId === undefined ? 'grace' : options.tenantId, uid: 'u1', access: new Set(options.access ?? ALL), onOpenItem, read };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const render = (open: boolean) =>
    act(async () => {
      root!.render(<AdminSearchPalette open={open} onOpenChange={onOpenChange} pages={pages(options.select)} search={search} />);
    });
  await render(true);
  await settle();
  return { onOpenChange, onOpenItem, read, render };
}

/** Let promises, effects and the debounce timer run. */
const settle = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

const input = () => document.querySelector('[data-slot="command-input"]') as HTMLInputElement;

async function type(text: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input(), text);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle(SEARCH_DEBOUNCE_MS + 40);
}

async function press(key: string) {
  await act(async () => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

const headings = () => [...document.querySelectorAll('[data-search-group-heading]')].map((el) => el.textContent);
const rows = (type?: string) =>
  [...document.querySelectorAll(type ? `[data-search-result="${type}"]` : '[data-search-result]')].map((el) => el.textContent ?? '');
const selectedRow = () => document.querySelector('[data-slot="command-item"][data-selected="true"]');

describe('content search in the palette', () => {
  it('groups results by type, each with a heading, in a fixed order', async () => {
    await mount();
    await type('grace');
    // "grace" is in no page label, and it is in Anna's email, so she is a (weaker) match.
    expect(headings()).toEqual(['People', 'Notes', 'Courses', 'Lessons', 'Events']);
    await type('cours');
    expect(headings()).toEqual(['Pages']);
  });

  it('caps a group at five rows and offers "See all N" with the true total', async () => {
    await mount();
    await type('grace sermon');
    expect(rows('note')).toHaveLength(5);
    const seeAll = document.querySelector('[data-search-see-all="note"]');
    expect(seeAll?.textContent).toBe('See all 7 notes');
    // A group that fits has no See all row.
    await type('grace foundations');
    expect(document.querySelector('[data-search-see-all]')).toBeNull();
  });

  it('opens a person on their CRM record when Enter is pressed on the first result', async () => {
    const { onOpenItem, onOpenChange } = await mount();
    await type('anna pop');
    expect(rows()).toEqual([expect.stringContaining('Anna Popescu')]);
    expect(selectedRow()?.textContent).toContain('Anna Popescu');
    await press('Enter');
    expect(onOpenItem).toHaveBeenCalledWith({ tab: 'crm', itemId: 'c1' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('moves with the arrow keys and Enter opens the row that is highlighted', async () => {
    const { onOpenItem } = await mount();
    await type('grace sermon');
    const first = selectedRow()?.textContent ?? '';
    expect(first).toContain('Grace sermon notes');
    await press('ArrowDown');
    expect(selectedRow()?.textContent).not.toBe(first);
    await press('ArrowUp');
    expect(selectedRow()?.textContent).toBe(first);
    await press('Enter');
    expect(onOpenItem).toHaveBeenCalledTimes(1);
    expect(onOpenItem.mock.calls[0][0]).toMatchObject({ tab: 'docs' });
  });

  it('opens a note on its own URL, but a course on its list page, because only some screens open one item', async () => {
    const { onOpenItem } = await mount();
    await type('grace sermon notes 3');
    await press('Enter');
    expect(onOpenItem).toHaveBeenLastCalledWith({ tab: 'docs', itemId: 'n3' });
    await type('grace foundations');
    await press('Enter');
    expect(onOpenItem).toHaveBeenLastCalledWith({ tab: 'courses', itemId: null });
  });

  it('finds a lesson and sends it to the courses screen', async () => {
    const { onOpenItem } = await mount();
    await type('faith');
    expect(rows('lesson')).toEqual([expect.stringContaining('Grace and faith')]);
    await press('Enter');
    expect(onOpenItem).toHaveBeenLastCalledWith({ tab: 'courses', itemId: null });
  });

  it('"See all" opens the list page, not an item', async () => {
    const { onOpenItem } = await mount();
    await type('grace sermon');
    const seeAll = document.querySelector('[data-search-see-all="note"]') as HTMLElement;
    await act(async () => { seeAll.click(); });
    expect(onOpenItem).toHaveBeenLastCalledWith({ tab: 'docs' });
  });

  it('keeps the pages, and runs a page through the callback it already had', async () => {
    const select = vi.fn();
    const { onOpenItem } = await mount({ select });
    await type('crm');
    expect(headings()).toContain('Pages');
    await press('Enter');
    expect(select).toHaveBeenCalledWith('crm');
    expect(onOpenItem).not.toHaveBeenCalled();
  });

  it('shows the sections under their headings while the box is empty, as before', async () => {
    await mount();
    const groupHeadings = [...document.querySelectorAll('[cmdk-group-heading]')].map((el) => el.textContent);
    expect(groupHeadings).toEqual(['Home', 'People', 'Products']);
    expect(rows()).toEqual([]);
  });

  it('ignores accents and case: "stefan" finds Ștefan', async () => {
    await mount();
    await type('STEFAN');
    expect(rows('person')).toEqual([expect.stringContaining('Ștefan Ionescu')]);
  });

  it('says "No results for" the query when nothing matches', async () => {
    await mount();
    await type('zzzxq');
    expect(document.querySelector('[data-slot="command-empty"]')?.textContent).toBe('No results for “zzzxq”');
    expect(rows()).toEqual([]);
  });

  it('shows a loading state, not "No results", while the content is still loading, and pages stay searchable', async () => {
    const never = new Promise<never>(() => {});
    const { read } = fakeRead({ contacts: () => never, users: () => never, docs: () => never });
    await mount({ read });
    expect(document.querySelector('[data-search-loading]')?.textContent).toContain('Loading your content');
    await type('zzzxq');
    expect(document.querySelector('[data-slot="command-empty"]')).toBeNull();
    await type('crm');
    expect(rows('page')).toEqual([expect.stringContaining('CRM')]);
  });

  it('never shows another ministry\'s content', async () => {
    await mount();
    await type('rival');
    expect(rows()).toEqual([]);
    expect(document.body.textContent).not.toContain('secret plan');
    await type('grace secret');
    expect(document.body.textContent).not.toContain('secret plan');
  });

  it('shows nothing from a tab the viewer does not have, and does not read it', async () => {
    const fs = fakeRead();
    await mount({ access: ['events'], read: fs.read });
    await type('grace');
    expect(headings()).toEqual(['Events']);
    expect(rows('note')).toEqual([]);
    expect(fs.calls.map((c) => c.path.join('/'))).toEqual(['tenants/grace/events']);
  });

  it('says which list could not be searched instead of silently showing fewer results', async () => {
    const denied = Object.assign(new Error('x'), { code: 'permission-denied' });
    const { read } = fakeRead({ docs: () => Promise.reject(denied) });
    await mount({ read });
    await type('grace');
    expect(rows('note')).toEqual([]);
    expect(rows('course')).not.toEqual([]);
    expect(document.querySelector('[data-search-notes]')?.textContent).toContain('Notes could not be searched');
  });

  it('turns content search off with no tenant: pages only, and no read', async () => {
    const fs = fakeRead();
    await mount({ tenantId: null, read: fs.read });
    expect(input().placeholder).toBe('Search sections');
    await type('grace');
    expect(fs.calls).toHaveLength(0);
    expect(rows()).toEqual([]);
  });

  it('turns content search off without a search config at all', async () => {
    await mount({ noSearch: true });
    await type('crm');
    expect(rows('page')).toEqual([expect.stringContaining('CRM')]);
  });
});

describe('reads', () => {
  it('reads when the palette opens and not per keystroke', async () => {
    const fs = fakeRead();
    await mount({ read: fs.read });
    const afterOpen = fs.calls.length;
    expect(afterOpen).toBeGreaterThan(0);
    for (const text of ['g', 'gr', 'gra', 'grac', 'grace', 'grace s']) await type(text);
    expect(fs.calls.length).toBe(afterOpen);
  });

  it('serves a reopen from the session cache without reading again', async () => {
    const fs = fakeRead();
    const { render } = await mount({ read: fs.read });
    const afterOpen = fs.calls.length;
    await render(false);
    await render(true);
    await settle();
    expect(fs.calls.length).toBe(afterOpen);
    await type('anna');
    expect(rows('person')).not.toEqual([]);
  });

  it('starts empty each time it opens', async () => {
    const { render } = await mount();
    await type('grace');
    await render(false);
    await render(true);
    expect(input().value).toBe('');
  });
});
