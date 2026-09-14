import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import AdminDocs from '../AdminDocs';
import { AdminHeaderContext } from '../AdminScreenHeader';
import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';

/**
 * THE-359 · 🔴 SECTION 7 — THE `← Notes` CONTROL IS **NOT** DEAD, AND IT IS NOT
 * REMOVED. STOP CONDITION 6.
 *
 * THE FOUNDER: "also remove that notes with the back arrow button. it does
 * nothing."
 *
 * The ticket asked to establish FIRST whether it is genuinely dead or merely
 * broken, and to report before removing if it turns out to be load-bearing. It
 * is load-bearing. This suite is that finding, written down as assertions so it
 * cannot quietly stop being true.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 1 · IT HAS A HANDLER AND THE HANDLER RUNS
 *
 * `onClick={closeEditor}` — which flushes the pending auto-save, AWAITS the
 * write, and only then clears `openDoc` and leaves focus mode. It is not a
 * no-op, it is not orphaned, and `AdminDocs.save.test.tsx` has driven it
 * through four cases since THE-275.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 2 · 🔴 THE TICKET'S PREMISE FOR REMOVING IT IS FALSE
 *
 * The ticket's read was: "the breadcrumb's 'Notes' already does this job, so
 * removal is right either way." It does not. `DocsBreadcrumb` renders the word
 * Notes as a bare `<span className="text-faint">` — not a `BreadcrumbLink`, not
 * a button, no handler. The folder crumbs after it are clickable when
 * `onSelectFolder` is passed; the root crumb never is, and this screen does not
 * pass that prop at all.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 3 · 🔴 ON A PHONE IT IS THE ONLY WAY OUT OF THE EDITOR
 *
 * While a note is open the tree is `hidden lg:flex`, so below `lg` it is off
 * screen. The breadcrumb is `hidden sm:block`, and its Notes is inert anyway.
 * In focus mode `AdminDocs` also hides the app header AND the bottom nav — the
 * component's own note says the toolbar row is "still a way back", and this
 * control is that way back. Remove it and a phone user is sealed inside the
 * editor with their work and no exit.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 4 · 🔵 SO WHY DOES IT LOOK LIKE IT DOES NOTHING?
 *
 * Because on the DESKTOP the founder is looking at, there is nowhere to go
 * back TO. From `lg` up the tree sits permanently beside the editor
 * (`hidden lg:flex` → visible either way), so pressing `← Notes` moves nothing:
 * the list does not appear, because it never left. The only visible change is
 * the editor pane swapping to its empty placeholder. The control works exactly
 * as designed and the design has no visible effect at that width — which is a
 * different problem from a dead button, and a much smaller one than trapping
 * every phone user.
 *
 * 🔴 NOTHING IN ADMINDOCS.TSX IS CHANGED BY THIS TICKET. That includes the
 * expand control THE-346 moved to sit immediately right of `← Notes`, whose
 * measured position `THE-346.six-defects.layout.test.tsx` still pins in real
 * Chromium — unchanged, because its neighbour is unchanged.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPEN_DOC = vi.hoisted(() => ({
  id: 'doc-1',
  title: 'Sermon',
  content: '<p>old</p>',
  folderId: null,
  createdBy: 'u1',
  createdAt: null,
  updatedAt: null,
  isPrivate: true,
  sharedWith: [] as string[],
  pinned: false,
}));

vi.mock('../RichTextEditor', () => ({
  default: () => null,
  COMPACT_PROSE_CLASS: 'prose prose-sm',
}));
const updateDoc = vi.hoisted(() => vi.fn(async () => undefined as unknown));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}), query: () => ({}), where: () => ({}),
  addDoc: vi.fn(async () => ({ id: 'created' })),
  updateDoc,
  deleteDoc: vi.fn(async () => {}),
  doc: (_db: unknown, _c: string, id: string) => ({ id }),
  getDoc: vi.fn(async () => ({ data: () => ({ active: false }) })),
  getDocs: vi.fn(async () => ({ docs: [] })),
  serverTimestamp: () => 'SERVER_TS',
  Timestamp: class {},
  arrayUnion: (v: unknown) => v,
  arrayRemove: (v: unknown) => v,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('../../utils/notify', () => ({ notifyError: vi.fn() }));
vi.mock('../../utils/plan-features', () => ({ getPlanFeatures: () => ({ sermonNotes: false }) }));
vi.mock('../../utils/tenant-scope', () => ({ hasPlatformOverride: () => false, PLATFORM_TENANT_ID: 'harvest' }));
vi.mock('../../utils/doc-export', () => ({ exportToPDF: vi.fn(), exportToDOCX: vi.fn(), exportToMarkdown: vi.fn() }));
vi.mock('../../utils/markdown-import', () => ({ markdownToHtml: (s: string) => s, titleFromMarkdown: () => 'Imported' }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: async () => {} }) }));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: () => ({ currentTenantId: 't1', isAuthReady: true, tenantPlan: 'seed', isSuperAdmin: false }),
}));
vi.mock('../../hooks/queries/useDocsQueries', () => ({
  useDocs: () => ({ data: { items: [OPEN_DOC], truncated: false }, isLoading: false }),
  useDocFolders: () => ({ data: { items: [], truncated: false } }),
  useSharedDocs: () => ({ data: { items: [], truncated: false } }),
}));

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const DOCS = 'src/components/AdminDocs.tsx';
const CRUMB = 'src/components/docs/DocsBreadcrumb.tsx';

let container: HTMLDivElement;
let root: Root;
/** What AdminDocs published into the shared header context, last write wins. */
const chrome = { headerHidden: false, navHidden: false };

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

async function mountDocs() {
  chrome.headerHidden = false;
  chrome.navHidden = false;
  await act(async () => {
    root = createRoot(container);
    root.render(
      <AdminHeaderContext.Provider
        value={{
          setHeaderAction: () => {},
          setHeaderHidden: (v: boolean) => { chrome.headerHidden = v; },
          setNavHidden: (v: boolean) => { chrome.navHidden = v; },
        } as never}
      >
        <AdminDocs />
      </AdminHeaderContext.Provider>,
    );
  });
  await flush();
}

async function openEditor() {
  const leaf = container.querySelector(`[data-doc-id="${OPEN_DOC.id}"]`) as HTMLElement;
  if (!leaf) throw new Error('the note tree did not render — every assertion below would be vacuous');
  await act(async () => { leaf.click(); });
  await flush();
}

/** The `← Notes` control, found by its label rather than by position. */
const backControl = () =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Notes') ?? null;

/** The editor is on screen exactly while its title field is. */
const editorIsOpen = () => container.querySelector('input[placeholder="Untitled"]') !== null;

beforeEach(() => {
  vi.clearAllMocks();
  updateDoc.mockImplementation(async () => undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
});

/* ═══ 16 · the control is alive ═══════════════════════════════════════════ */

describe('16 · the `← Notes` control is NOT dead — reported, and kept', () => {
  it('🔴 it exists, it has a handler, and pressing it closes the editor', async () => {
    await mountDocs();
    await openEditor();
    expect(editorIsOpen(), 'the editor never opened').toBe(true);

    const back = backControl();
    expect(back, 'the `← Notes` control is gone').toBeTruthy();

    await act(async () => { back!.click(); });
    await flush();
    expect(editorIsOpen(),
      '🔴 the control really did nothing — pressing it left the editor open').toBe(false);
  });

  it('🔴 and it SAVES on the way out — it is not merely a navigation', async () => {
    await mountDocs();
    await openEditor();
    await act(async () => { backControl()!.click(); });
    await flush();
    expect(updateDoc, 'the note was not written when the editor closed').toHaveBeenCalled();
  });

  it('🔴 a failed save keeps it on screen, which is the behaviour it was given', async () => {
    // THE-275's decision: "Staying put keeps the work on screen and makes
    // 'Notes' a retry button." A press that appears to do nothing HERE is the
    // save refusing, not the control being dead — and the toast says so.
    updateDoc.mockImplementation(async () => { throw new Error('offline'); });
    await mountDocs();
    await openEditor();
    await act(async () => { backControl()!.click(); });
    await flush();
    expect(editorIsOpen(), 'a failed save silently discarded the note').toBe(true);
  });

  it('🔴 the handler is `closeEditor`, wired in the source, not an empty arrow', () => {
    const src = stripComments(read(DOCS));
    expect(src, 'the back control lost its handler').toMatch(/onClick=\{closeEditor\}/);
    expect(src, '`closeEditor` is not defined').toMatch(/const closeEditor = async \(\) => \{/);
    // It really does both things — save, then leave.
    const body = /const closeEditor = async \(\) => \{([\s\S]*?)\n {2}\};/.exec(src);
    expect(body, 'closeEditor could not be found').not.toBeNull();
    expect(body![1]).toContain('await saveDoc');
    expect(body![1]).toContain('setOpenDoc(null)');
  });
});

/* ═══ 🔴 the ticket's premise, checked ════════════════════════════════════ */

describe("the breadcrumb's “Notes” does NOT do this job", () => {
  it('🔴 it is an inert span, not a link and not a button', async () => {
    await mountDocs();
    await openEditor();
    const crumbs = container.querySelector('[data-testid="docs-breadcrumb"]');
    expect(crumbs, 'the breadcrumb did not render').toBeTruthy();

    const rootCrumb = [...crumbs!.querySelectorAll('*')]
      .find((e) => e.children.length === 0 && e.textContent?.trim() === 'Notes');
    expect(rootCrumb, 'the breadcrumb has no Notes crumb at all').toBeTruthy();
    expect(rootCrumb!.tagName, '🔵 the root crumb became clickable — re-open section 7')
      .toBe('SPAN');
    expect(rootCrumb!.closest('a'), 'the root crumb is a link').toBeNull();
    expect(rootCrumb!.closest('button'), 'the root crumb is a button').toBeNull();
  });

  it('🔴 and the source confirms it: no handler is even available to it', () => {
    const src = stripComments(read(CRUMB));
    // The root crumb, spelled exactly as the component renders it.
    expect(src).toContain('<span className="text-faint">Notes</span>');
    // Only the FOLDER crumbs are ever interactive, and only when a caller
    // passes `onSelectFolder` — which this screen does not.
    expect(src).toMatch(/onSelectFolder \? \(/);
    expect(stripComments(read(DOCS)),
      'AdminDocs now passes onSelectFolder — the finding needs re-checking')
      .not.toMatch(/<DocsBreadcrumb[^>]*onSelectFolder/);
  });
});

/* ═══ 🔴 STOP CONDITION 6 — removing it would trap a phone user ═══════════ */

describe('STOP condition 6 · it is the only exit on a phone', () => {
  it('🔴 the tree is off screen below `lg` while a note is open', () => {
    const src = stripComments(read(DOCS));
    // Located by the class string, never by a line number — THE-331 pinned
    // `AdminCommunity.tsx:491` and a deletion shifted it to `:311`.
    expect(src, 'the sidebar no longer hides itself while a note is open')
      .toContain("${openDoc ? 'hidden lg:flex' : 'flex'}");
    // And the breadcrumb — inert anyway — is not even rendered below `sm`.
    expect(src).toContain('<div className="hidden min-w-0 sm:block">');
  });

  it('🔴 in focus mode the app header AND the bottom nav are both hidden', async () => {
    await mountDocs();
    await openEditor();
    expect(chrome.headerHidden).toBe(false);
    expect(chrome.navHidden).toBe(false);

    const expand = container.querySelector('[data-testid="docs-expand-toggle"]') as HTMLElement;
    expect(expand, 'the expand control is gone').toBeTruthy();
    await act(async () => { expand.click(); });
    await flush();

    // Both are now gone, so the editor's own toolbar row is the entire chrome.
    expect(chrome.headerHidden, 'the app header is still on screen in focus mode').toBe(true);
    expect(chrome.navHidden, 'the bottom nav is still on screen in focus mode').toBe(true);

    // 🔴 AND THE BACK CONTROL IS WHAT GIVES THEM BACK.
    await act(async () => { backControl()!.click(); });
    await flush();
    expect(editorIsOpen()).toBe(false);
    expect(chrome.headerHidden, 'the header never came back — a headless trap').toBe(false);
    expect(chrome.navHidden, 'the nav never came back — a trap with no way out').toBe(false);
  });

  it('🔴 the component still documents this control as the way back', () => {
    // The reason lives in the source, where the next person to be asked to
    // delete this button will read it.
    expect(read(DOCS)).toContain('so there is still a way back');
  });
});

/* ═══ 17 · #490 / THE-346's expand control is untouched ═══════════════════ */

describe('17 · the expand control still sits immediately right of `← Notes`', () => {
  it('🔴 it is the very next element sibling, in the same left group', async () => {
    /**
     * ⚠️ THIS IS A DOM-ORDER CLAIM, NOT A LAYOUT ONE. happy-dom has no layout
     * engine — `getBoundingClientRect()` answers zeroes here. The MEASURED
     * position is asserted in `THE-346.six-defects.layout.test.tsx`, in real
     * Chromium with transitions suppressed, and it still passes because this
     * ticket changes no byte of AdminDocs.tsx.
     */
    await mountDocs();
    await openEditor();
    const back = backControl()!;
    const next = back.nextElementSibling;
    expect(next, 'the back control has no sibling — the header row changed shape').toBeTruthy();
    expect(next!.getAttribute('data-testid'),
      '🔴 the expand toggle is no longer immediately right of `Notes` (#490)')
      .toBe('docs-expand-toggle');
    // Same parent — the LEFT group, which is what #490 moved it into.
    expect(next!.parentElement).toBe(back.parentElement);
  });

  it('AdminDocs.tsx is at a digest an EARLIER ticket recorded — THE-359 wrote nothing there', async () => {
    const { ownershipFailure, acceptedFor } =
      await import('../../__tests__/__fixtures__/ownership-register');
    expect(ownershipFailure(DOCS),
      '🔴 THE-359 edited AdminDocs.tsx — it is supposed to touch nothing in this file')
      .toBeNull();
    // 🔴 AND THE TICKET THAT OWNS THAT DIGEST IS NOT THIS ONE. Recording a new
    // digest here would satisfy the line above while having changed the file,
    // which is exactly what "the control stays" must not permit.
    const owners = acceptedFor(DOCS).map(([, source]) => source);
    expect(owners.length, 'no ticket has recorded AdminDocs.tsx').toBeGreaterThan(0);
    for (const source of owners) {
      expect(source, '🔴 THE-359 recorded a digest for AdminDocs.tsx')
        .not.toContain('THE-359');
    }
  });
});
