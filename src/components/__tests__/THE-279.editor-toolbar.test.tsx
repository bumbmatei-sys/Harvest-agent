/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-279 — a persistent toolbar on the shared rich-text editor
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ─── What the ticket actually was ────────────────────────────────────────────
 *
 * 🔴 A DISCOVERY PROBLEM, NOT A MISSING FEATURE. Every command the founder
 * wanted already worked — the slash menu has shipped all fourteen of them for
 * as long as `RichTextEditor.tsx` has existed. What did not exist was any way
 * to find them: a church admin had to select text (for the `BubbleMenu`'s five
 * marks) or already know to type `/`. "Not everyone knows how to use `/`."
 *
 * So the diff adds a BAR and no commands, with one named exception (alignment,
 * see section 3). The slash menu's own code — the `SlashCommand` extension,
 * `SlashCommandList`, `renderSlashCommands` and the `items({ query })` filter —
 * is byte-identical, and section 5 pins every structural element of it by
 * content — the extension's shape, the keyboard contract, the popup geometry —
 * plus a live assertion that the extension is still registered exactly once.
 *
 * ─── Where the parity guarantee comes from ───────────────────────────────────
 *
 * 🔴 THE TOOLBAR RENDERS THE `commands` ARRAY. It does not mirror it. That is
 * the whole design: `RichTextEditor` maps `[...commands, ...ALIGN_COMMANDS]`
 * into toolbar items, so every button invokes the SAME `action` closure — the
 * same existing `chain()` call — that `/` invokes. A second list that had to be
 * kept in sync would have been a drift waiting to happen; there is no second
 * list to drift.
 *
 * `RichTextToolbar.tsx` is kept structurally incapable of holding a command:
 * section 2 greps it for `chain(`, for every TipTap command name, and for
 * `isActive`, and fails if any appears. The reason that matters is section 4 —
 * `applyLink` runs `isSafeUrl()` before `setLink`, and a toolbar that had grown
 * its own link handler is exactly where that check goes missing.
 *
 * ─── The rem trap, measured ──────────────────────────────────────────────────
 *
 * ⚠️ `h-11` is NOT 44px in this app. globals.css trims the rem base to 14.5px
 * above 1024px, so `h-11` compiles to `height: 2.75rem` and renders 39.875px on
 * a desktop — 4.125px under the touch minimum whose name it carries. Confirmed
 * by compiling the real stylesheet, not by reading the scale. Every load-bearing
 * dimension on the toolbar is therefore in px, and the classes are spelled
 * LITERALLY (`h-[44px]`), never interpolated from the constant: Tailwind
 * generates utilities by scanning source text, so `h-[${N}px]` produces no rule
 * at all — a well-formed class name that sizes nothing.
 *
 * ─── What is asserted HERE and what is asserted in a browser ─────────────────
 *
 * This file: structure, parity, behaviour, security, and the no-regressions.
 * Geometry — the 44px floor, the single row, page-level overflow, the bottom nav
 * and the scroller — is in `THE-279.toolbar-layout.test.tsx`, in real Chromium,
 * because happy-dom has no layout engine and `getBoundingClientRect()` returns
 * zeros here. A geometry assertion written against this environment would pass
 * having measured nothing, which is how THE-276's 420px column shipped green.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

import RichTextEditor, { commands, ALIGN_COMMANDS, COMMAND_ACTIVE } from '../RichTextEditor';
import RichTextToolbar, {
  TAP_TARGET_PX, TOOLBAR_GROUPS, groupItems, type ToolbarItem,
} from '../editor/RichTextToolbar';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.resolve(__dirname, '../../..');
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const EDITOR = 'src/components/RichTextEditor.tsx';
const TOOLBAR = 'src/components/editor/RichTextToolbar.tsx';

/* ── mocks ─────────────────────────────────────────────────────────────────
   Only the image upload reaches out; the editor itself is local. */
vi.mock('../../firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'me', getIdToken: async () => 'tok' } },
}));

/**
 * `BubbleMenu`, stubbed — the floating chip's POSITIONER, not this ticket's subject.
 *
 * ⚠️ This file is the first in the repo to mount the REAL editor; every other
 * suite that touches RichTextEditor replaces the whole component with a stub,
 * which is why this has not come up before.
 * `@tiptap/extension-bubble-menu` does `import tippy from 'tippy.js'`, and that
 * CJS default does not survive Vitest's ESM interop: it throws "tippy is not a
 * function" from a ProseMirror plugin view, asynchronously, AFTER the assertion
 * has already passed — so it surfaces as an unhandled error rather than a
 * failure, on every test that dispatches a transaction.
 *
 * 🔴 Mocking `tippy.js` itself does NOT work and the reason is worth recording:
 * `@tiptap/extension-bubble-menu` is EXTERNALIZED (loaded by Node's own ESM
 * resolver), and Vitest can only intercept an import made from inlined code.
 * `RichTextEditor.tsx` is source, so its own import of `@tiptap/react` IS
 * interceptable — that is the boundary this stub sits on. Everything else in
 * `@tiptap/react` is passed through untouched: the real `useEditor`, the real
 * `EditorContent`, the real `ReactRenderer`.
 *
 * What is given up is nothing this environment could have checked: happy-dom
 * has no layout engine, so where a floating chip lands was never measurable
 * here. The bubble's markup, its five commands and its dark chip are pinned by
 * content in section 5, which is where that control is actually guarded — and
 * the stub still renders its children, so the shared link row inside it is
 * real and its `isSafeUrl` path is exercised for what it is.
 */
vi.mock('@tiptap/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tiptap/react')>();
  return {
    ...actual,
    BubbleMenu: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', { 'data-bubble-menu-stub': '' }, children),
  };
});

/**
 * Source with comments removed, for the structural assertions.
 *
 * 🔴 NECESSARY, not tidiness. The guarantees in sections 2, 7 and 8 are "this
 * file contains no `chain()`", "no `touch-action`", "no `sticky`", "no hex
 * literal" — and the toolbar's header explains at length WHY each of those is
 * absent, naming every one of them. A grep over the raw text therefore fails on
 * the prose that documents the invariant, which is the worst possible incentive:
 * it pressures the next person to delete the explanation rather than keep the
 * rule. So the prose is stripped and the CODE is what gets asserted.
 *
 * String-aware rather than a regex sweep: `'https://theharvest.app'` contains
 * `//`, and a naive stripper would eat the rest of that line.
 */
function codeOf(rel: string): string {
  const text = src(rel);
  let out = '';
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === '//') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (two === '/*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      out += ch;
      i += 1;
      while (i < text.length && text[i] !== ch) {
        if (text[i] === '\\') { out += text.slice(i, i + 2); i += 2; continue; }
        out += text[i];
        i += 1;
      }
      out += ch;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

let container: HTMLDivElement;
let root: Root;
/** Every HTML string `onChange` was handed, in order. */
let emitted: string[];

async function mount(props: Partial<React.ComponentProps<typeof RichTextEditor>> = {}) {
  emitted = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(
      <RichTextEditor
        content={props.content ?? '<p>Hello church</p>'}
        onChange={(html) => emitted.push(html)}
        {...props}
      />,
    );
  });
  return container;
}

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  vi.restoreAllMocks();
});

const toolbar = (c: ParentNode) => c.querySelector('[data-editor-toolbar]');
const scroller = (c: ParentNode) => c.querySelector('[data-editor-toolbar-scroller]');
const buttons = (c: ParentNode) =>
  Array.from(c.querySelectorAll<HTMLButtonElement>('[data-editor-toolbar-button]'));
const button = (c: ParentNode, title: string) => {
  const el = c.querySelector<HTMLButtonElement>(`[data-command="${CSS.escape(title)}"]`);
  if (!el) throw new Error(`no toolbar button for "${title}"`);
  return el;
};
/** The buttons apply on mousedown — the idiom that keeps the selection alive. */
const press = async (el: HTMLElement) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
};

/**
 * Select the whole document, so a MARK command actually changes it.
 *
 * ⚠️ Without this the mark tests pass for the wrong reason. At a COLLAPSED
 * caret, `toggleBold` sets a STORED MARK rather than editing the document — no
 * transaction touches the doc, `onUpdate` never fires, and `emitted` stays
 * empty. A test that then asserted "no change" would be measuring TipTap's
 * stored-mark behaviour and calling it a toolbar result.
 */
const selectAll = async () => {
  await act(async () => {
    (currentEditor() as { commands: { selectAll: () => boolean } }).commands.selectAll();
  });
};

// ═══════════════════════════════════════════════════════════════════════════
// 1 · 🔴 The toolbar renders ABOVE the editable area and OUTSIDE the prose
//        container — both halves.
// ═══════════════════════════════════════════════════════════════════════════
describe('1 — the toolbar renders above the editable area and outside the prose container', () => {
  it('renders a toolbar at all, where there were zero before', async () => {
    const c = await mount();
    expect(toolbar(c), 'no toolbar rendered').toBeTruthy();
    expect(scroller(c)?.getAttribute('role')).toBe('toolbar');
    expect(scroller(c)?.getAttribute('aria-label')).toBe('Formatting');
  });

  it('🔴 is OUTSIDE the prose container — no ancestor of it carries a prose class', async () => {
    const c = await mount();
    // The prose ramp lands on the ProseMirror editable div via
    // `editorProps.attributes.class`. @tailwindcss/typography styles
    // DESCENDANTS by tag, so a button inside that subtree inherits a margin
    // and a font size meant for body copy. This is the half of test 1 that a
    // "the toolbar exists" assertion cannot see.
    const prose = c.querySelector('.prose');
    expect(prose, 'the editable area lost its prose class — this test would be vacuous').toBeTruthy();
    expect(prose!.contains(toolbar(c)!), 'the toolbar is inside the prose container').toBe(false);
    for (const b of buttons(c)) {
      expect(prose!.contains(b), `the ${b.dataset.command} button is inside the prose container`)
        .toBe(false);
    }
  });

  it('🔴 is ABOVE the editable area in document order', async () => {
    const c = await mount();
    const bar = toolbar(c)!;
    const prose = c.querySelector('.prose')!;
    // Node.DOCUMENT_POSITION_FOLLOWING (4) means `prose` comes after `bar`.
    // Document order is what decides which paints first in normal flow, and
    // the browser suite measures the resulting geometry.
    expect(bar.compareDocumentPosition(prose) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('does not sit inside the BubbleMenu either, so it is persistent and not selection-gated', async () => {
    const c = await mount();
    // A toolbar nested in the bubble would render only on a selection, which is
    // the very problem the ticket is about.
    for (const el of Array.from(c.querySelectorAll('[data-editor-toolbar]'))) {
      expect(el.closest('[data-tippy-root]')).toBeNull();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · 🔴 Every toolbar button applies the same command as its slash-menu
//        equivalent — asserted against the EXISTING chain() calls, not a copy.
// ═══════════════════════════════════════════════════════════════════════════
describe('2 — every toolbar button applies the same command as its slash-menu equivalent', () => {
  it('🔴 the toolbar module contains NO command implementation whatsoever', () => {
    // The structural half, and the one the mutation test fires on: pointing a
    // button at a new implementation means writing a command into this file,
    // and this file may not contain one. `run` closures arrive already bound
    // from the shared arrays, so the toolbar cannot express a command even by
    // accident — which is what makes the isSafeUrl guarantee in section 4 hold
    // by construction rather than by review.
    const code = codeOf(TOOLBAR);
    expect(code, 'the toolbar spells a TipTap chain of its own').not.toMatch(/\.chain\(/);
    for (const name of [
      'toggleBold', 'toggleItalic', 'toggleUnderline', 'toggleStrike', 'toggleHeading',
      'setParagraph', 'toggleBulletList', 'toggleOrderedList', 'toggleBlockquote',
      'toggleCodeBlock', 'setHorizontalRule', 'setLink', 'unsetLink', 'setImage',
      'setTextAlign', 'extendMarkRange', 'isActive', 'isSafeUrl',
    ]) {
      expect(code, `the toolbar names ${name} — it must receive bound actions only`)
        .not.toContain(name);
    }
  });

  it('🔴 builds its items from the shared arrays, by mapping them and not re-listing them', () => {
    const code = src(EDITOR);
    // The one expression that creates the toolbar's vocabulary. If this stops
    // being a map over the shared arrays, the parity in the next test becomes a
    // coincidence that has to be maintained by hand.
    expect(code).toMatch(/\[\.\.\.commands,\s*\.\.\.ALIGN_COMMANDS\]\.map\(/);
    expect(code).toMatch(/<RichTextToolbar items=\{toolbarItems\}/);
  });

  it('🔴 the MAPPING itself spells no command — every `run` is the array\'s own action', () => {
    // ⚠️ THIS TEST EXISTS BECAUSE THE OTHERS MISSED THE MUTATION IT CATCHES.
    // Pointing Bold at `editor.chain().toggleBold().run()` right here in the
    // mapping passed every assertion in this section: the structural grep looks
    // at RichTextToolbar.tsx (where `chain()` legitimately does not appear) and
    // this file's own `chain()` calls are the `commands` array's, which are
    // meant to be there. The behavioural A/B missed it too, because a chain
    // without `.focus()` produces byte-identical HTML in a headless browser —
    // the difference only shows on a real caret.
    //
    // So the MAPPING EXPRESSION is pinned on its own: the only things it may
    // reach for are `cmd.action`, the image modal opener and the link editor.
    const code = codeOf(EDITOR);
    const mapping = /const toolbarItems: ToolbarItem\[\] = editor[\s\S]*?\n    : \[\];/.exec(code)?.[0];
    expect(mapping, 'the toolbar mapping is gone or was reshaped').toBeTruthy();
    expect(mapping!, 'the mapping does not invoke the shared action').toContain('cmd.action(editor)');
    expect(mapping!, 'the mapping builds a chain of its own').not.toMatch(/\.chain\(/);
    for (const name of [
      'toggleBold', 'toggleItalic', 'toggleUnderline', 'toggleStrike', 'toggleHeading',
      'setParagraph', 'toggleBulletList', 'toggleOrderedList', 'toggleBlockquote',
      'toggleCodeBlock', 'setHorizontalRule', 'setLink', 'setImage', 'setTextAlign',
    ]) {
      expect(mapping!, `the mapping names ${name} instead of delegating to cmd.action`)
        .not.toContain(name);
    }
  });

  it('🔴 every button calls the ARRAY\'S action object — proved with a spy on it', async () => {
    // The behavioural counterpart, and the strongest statement available: the
    // exported array's `action` is temporarily replaced with a spy, so a button
    // that ran anything of its own would leave the spy untouched. Reference
    // identity, observed at run time rather than inferred from the source.
    for (const cmd of [...commands, ...ALIGN_COMMANDS]) {
      if (cmd.title === 'Image' || cmd.title === 'Link') continue; // overridden by design
      const original = cmd.action;
      const spy = vi.fn();
      cmd.action = spy;
      try {
        const c = await mount({ content: '<p>Hello church</p>' });
        await selectAll();
        await press(button(c, cmd.title));
        expect(spy, `the ${cmd.title} button did not call commands[].action`).toHaveBeenCalledTimes(1);
        await act(async () => { root.unmount(); });
        c.remove();
      } finally {
        cmd.action = original;
      }
    }
  });

  it('🔴 each button runs the identical action the slash menu runs — behaviourally', async () => {
    // Not a reference check: the SAME document mutation, driven twice. Each
    // command is applied through the toolbar button, and separately by calling
    // the `commands` entry's own `action` on a second editor with the same
    // starting content. The two HTML results must agree — so a button wired to
    // a look-alike implementation (a `toggleBold` without `focus()`, a
    // `setLink` without `isSafeUrl`) diverges and fails.
    const START = '<p>Hello church</p>';

    // Divider inserts a node whose position depends on the caret, and Image and
    // Link open UI rather than mutating; they are covered by their own tests
    // below and by section 4.
    const OPENS_UI = new Set(['Image', 'Link']);

    for (const cmd of [...commands, ...ALIGN_COMMANDS]) {
      if (OPENS_UI.has(cmd.title)) continue;

      const viaToolbar = await mount({ content: START });
      await selectAll();
      await press(button(viaToolbar, cmd.title));
      const toolbarHtml = emitted.at(-1);
      await act(async () => { root.unmount(); });
      viaToolbar.remove();

      await mount({ content: START });
      await selectAll();
      // The slash menu calls `props.action(editor)` with the live editor. Reach
      // the same editor instance the component built, and invoke the array's
      // own action on it — the existing chain() call, untouched.
      await act(async () => { cmd.action(currentEditor()); });
      const slashHtml = emitted.at(-1);

      expect(toolbarHtml, `${cmd.title}: the toolbar produced no change`).toBeDefined();
      expect(slashHtml, `${cmd.title}: the slash action produced no change`).toBeDefined();
      expect(toolbarHtml, `${cmd.title} differs between the toolbar and the slash menu`)
        .toBe(slashHtml);
    }
  });

  it('the Image button opens the same upload modal the slash menu opens', async () => {
    const c = await mount();
    expect(c.ownerDocument.querySelector('input[type="file"]')).toBeNull();
    await press(button(c, 'Image'));
    // The array's Image action is a no-op that expects a modal opener, and both
    // menus supply the same one — `openImageModalRef`.
    expect(
      document.querySelector('input[type="file"]'),
      'the Image button did not open the upload modal',
    ).toBeTruthy();
  });
});

/**
 * The live editor instance the mounted component built.
 *
 * TipTap hangs the `Editor` off the ProseMirror DOM node's view. Reaching it
 * this way — rather than through a prop or a mock — is what makes the previous
 * test drive the REAL command on the REAL editor, so "the same chain() call" is
 * a fact about behaviour and not about a stub.
 */
function currentEditor(): unknown {
  const pm = container.querySelector('.ProseMirror') as unknown as {
    editor?: unknown;
  } | null;
  const editor = pm?.editor;
  if (!editor) throw new Error('the editor instance is not reachable from the DOM');
  return editor;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · 🔴 The toolbar's command vocabulary matches the slash menu's — or the
//        difference is deliberate and NAMED.
// ═══════════════════════════════════════════════════════════════════════════
describe("3 — the toolbar's command vocabulary matches the slash menu's", () => {
  /**
   * 🔵 THE NAMED DIFFERENCE, and the only one.
   *
   * The toolbar is a strict SUPERSET: all fourteen slash commands plus the four
   * alignments. The ticket's constraint is one-directional — "a toolbar that can
   * do less than `/` is a worse discovery aid than none" — and this list is
   * pinned so that widening it is an edit to this line, visible in review.
   *
   * Why alignment is toolbar-only rather than added to `/` as well: `/` is a
   * TYPING affordance. You type it mid-sentence to insert a block, and the
   * suggestion plugin deletes the range and applies the command at the caret.
   * Alignment is a property of a paragraph you have already written, set after
   * the fact on a block or a selection — a toolbar gesture, not a slash one.
   * Putting it in `commands` would also have changed what `/` offers, which is
   * a change to a working control nobody asked for.
   */
  const TOOLBAR_ONLY = ['Align Left', 'Align Center', 'Align Right', 'Justify'];

  it('🔴 offers every slash command, so it can never do less than `/`', async () => {
    const c = await mount();
    const onToolbar = buttons(c).map((b) => b.dataset.command);
    for (const cmd of commands) {
      expect(onToolbar, `the toolbar cannot do "${cmd.title}" but \`/\` can`).toContain(cmd.title);
    }
  });

  it('offers exactly the slash vocabulary plus the named difference, and nothing else', async () => {
    const c = await mount();
    const onToolbar = buttons(c).map((b) => b.dataset.command!);
    expect(onToolbar.slice().sort())
      .toEqual([...commands.map((c) => c.title), ...TOOLBAR_ONLY].sort());
    // Multiplicity, not a set: a duplicated button would survive a set compare.
    expect(onToolbar.length).toBe(commands.length + TOOLBAR_ONLY.length);
    expect(onToolbar.length).toBe(18);
  });

  it('the named difference is exactly the alignment commands', () => {
    expect(ALIGN_COMMANDS.map((c) => c.title)).toEqual(TOOLBAR_ONLY);
    // And `/` is unchanged by it: the alignments are a separate array, so the
    // slash menu's own vocabulary is still the fourteen it always was.
    expect(commands.map((c) => c.title)).toEqual([
      'Heading 1', 'Heading 2', 'Paragraph', 'Bold', 'Italic', 'Underline', 'Strikethrough',
      'Bullet List', 'Numbered List', 'Quote', 'Code Block', 'Divider', 'Link', 'Image',
    ]);
    for (const title of TOOLBAR_ONLY) {
      expect(commands.map((c) => c.title), `${title} leaked into the slash menu`).not.toContain(title);
    }
  });

  it('🔴 the LAYOUT covers exactly the vocabulary — this is where a mismatch is loud', () => {
    // `groupItems` lays the bar out, and a command with no home in
    // TOOLBAR_GROUPS is a developer mistake. THIS is the assertion that catches
    // it: `groupItems` itself degrades gracefully at run time (see its own note
    // — it runs during render, and there is no error boundary above the admin
    // editor, so throwing would blank a screen someone is writing a sermon note
    // in). Loud here, graceful there.
    expect(TOOLBAR_GROUPS.flat().slice().sort())
      .toEqual([...commands.map((c) => c.title), ...TOOLBAR_ONLY].sort());

    const item = (title: string): ToolbarItem =>
      ({ title, description: '', icon: null, run: () => {}, active: false });
    const all = [...commands.map((c) => c.title), ...TOOLBAR_ONLY].map(item);
    expect(groupItems(all).flat().map((i) => i.title)).toEqual(TOOLBAR_GROUPS.flat());
  });

  it('🔴 an unplaced command is still RENDERED, never dropped and never fatal', () => {
    const item = (title: string): ToolbarItem =>
      ({ title, description: '', icon: null, run: () => {}, active: false });
    const all = [...commands.map((c) => c.title), ...TOOLBAR_ONLY].map(item);

    // A command the layout does not place lands in a trailing group. The
    // property that matters — every command reachable at every width — holds,
    // and the mismatch is reported by the assertion above rather than by a
    // crash in front of a user.
    const withStray = groupItems([...all, item('Sparkles')]);
    expect(withStray.flat().map((i) => i.title)).toContain('Sparkles');
    expect(withStray.at(-1)!.map((i) => i.title)).toEqual(['Sparkles']);
    expect(withStray.flat()).toHaveLength(all.length + 1);

    // And a title the caller did not supply is skipped, not fatal — so a
    // partial item list renders what it has.
    const missing = groupItems(all.filter((i) => i.title !== 'Quote'));
    expect(missing.flat().map((i) => i.title)).not.toContain('Quote');
    expect(missing.flat()).toHaveLength(all.length - 1);
    // Empty in, empty out, still no throw: the component is exported and a
    // future caller may hand it nothing.
    expect(groupItems([])).toEqual([]);
  });

  it('every button carries an accessible name and the description as its hint', async () => {
    const c = await mount();
    // With a selection every command can apply, so every hint is the
    // description. The disabled case has its own assertion in section 4.
    await selectAll();
    const byTitle = new Map([...commands, ...ALIGN_COMMANDS].map((cmd) => [cmd.title, cmd]));
    for (const b of buttons(c)) {
      expect(b.disabled, `${b.dataset.command} is disabled with a full selection`).toBe(false);
      const cmd = byTitle.get(b.dataset.command!)!;
      // Icons, not emoji or text glyphs — so the label is the only name a
      // screen reader has, and `title` is what a desktop hover shows.
      expect(b.getAttribute('aria-label')).toBe(cmd.title);
      expect(b.getAttribute('title')).toBe(`${cmd.title} — ${cmd.description}`);
      expect(b.querySelector('svg'), `${cmd.title} renders no icon`).toBeTruthy();
      expect(b.textContent, `${cmd.title} renders a text glyph instead of an icon`).toBe('');
      // Inside three editors that are not <form>s today, but a `type` default
      // of "submit" is a trap the moment one of them becomes one.
      expect(b.getAttribute('type')).toBe('button');
    }
  });

  it('a toggle reports its state, and an insert does not claim one', async () => {
    const c = await mount();
    for (const b of buttons(c)) {
      // `aria-pressed` is present on every button because each is a toggle or a
      // one-shot; what varies is whether COMMAND_ACTIVE has an opinion.
      expect(['true', 'false']).toContain(b.getAttribute('aria-pressed'));
    }
    // Divider and Image insert rather than toggle, so they have no active
    // predicate and read as never pressed.
    for (const insert of ['Divider', 'Image']) {
      expect(COMMAND_ACTIVE[insert]).toBeUndefined();
      expect(button(c, insert).getAttribute('aria-pressed')).toBe('false');
    }
    // Bold does toggle, and the bar reflects the document.
    expect(button(c, 'Bold').getAttribute('aria-pressed')).toBe('false');
    await selectAll();
    await press(button(c, 'Bold'));
    expect(button(c, 'Bold').getAttribute('aria-pressed')).toBe('true');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · 🔴 The link button runs isSafeUrl BEFORE setLink — no-regression,
//        security. This is the one that matters: it is an XSS hole.
// ═══════════════════════════════════════════════════════════════════════════
describe('4 — the link button runs isSafeUrl before setLink', () => {
  /**
   * Type a URL into whichever link input is open and confirm it.
   *
   * ⚠️ Through the NATIVE value setter, not `input.value = url`. React tracks a
   * controlled input's value on the node, so a direct assignment leaves the
   * tracker agreeing with the new value and React skips the change event — the
   * input renders the text and `linkUrl` state never moves, so `applyLink` runs
   * against an empty string. That reads as "the URL was rejected", which would
   * have made the whole of this section pass for the wrong reason.
   */
  const enterUrl = async (c: ParentNode, url: string) => {
    const input = c.querySelector<HTMLInputElement>('input[aria-label="Link URL"]');
    if (!input) throw new Error('the link editor is not open');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, url);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // ⚠️ Returns what the INPUT actually holds, which is not always what was
    // typed. `<input type="url">` runs the HTML value-sanitization algorithm,
    // which strips leading/trailing whitespace and every newline — so
    // `" javascript:…"` and `"java\nscript:…"` arrive already normalised. That
    // is a real third layer and worth naming, but it means an assertion of
    // `value === url` is wrong for those two, and asserting it would have
    // failed the test for the input's correct behaviour.
    expect(input.value, 'the link input received nothing at all').not.toBe('');
    const applied = input.value;
    const apply = c.querySelector<HTMLButtonElement>('button[aria-label="Apply link"]')!;
    await press(apply);
    return applied;
  };

  /**
   * ─── The two layers, measured rather than assumed ─────────────────────────
   *
   * ⚠️ `isSafeUrl` is NOT the only thing standing between the link button and a
   * `javascript:` href, and writing this section as though it were would have
   * made most of it pass for the wrong reason. `@tiptap/extension-link` runs its
   * own `isAllowedUri` on every `setLink`, against a scheme ALLOWLIST —
   * http, https, ftp, ftps, mailto, tel, callto, sms, cid, xmpp — after
   * stripping unicode whitespace.
   *
   * So, measured by disabling `isSafeUrl` and driving each string through the
   * real button:
   *
   *   javascript:alert(1)                    BLOCKED by TipTap alone
   *   JavaScript:alert(1)                    BLOCKED by TipTap alone
   *   data:text/html,<script>…               BLOCKED by TipTap alone
   *   vbscript:msgbox(1)                     BLOCKED by TipTap alone
   *   blob:https://evil.example/x            BLOCKED by TipTap alone
   *   " javascript:alert(1)" (leading space) normalised by the INPUT, then blocked
   *   "java\nscript:alert(1)"                normalised by the INPUT, then blocked
   *   %6a%61%76%61%73%63%72%69%70%74:alert(1)  🔴 LINKED — only isSafeUrl stops it
   *
   * 🔴 The percent-encoded prefix is therefore the case that ISOLATES
   * `isSafeUrl`: it calls `decodeURIComponent` once and re-checks, and TipTap's
   * regex does not decode. That is the assertion which fails when the check is
   * removed, and it is why the mutation "skip isSafeUrl in the toolbar's link
   * path" fails loudly rather than silently.
   *
   * There is a third layer in front of both, and it is the reason two rows above
   * say "normalised by the input": `<input type="url">` runs the HTML
   * value-sanitization algorithm, stripping leading/trailing whitespace and all
   * newlines before a keystroke ever reaches `linkUrl`. Named because it means
   * the whitespace obfuscations never arrive in the form they were typed.
   *
   * The whole sweep is kept regardless: it is the regression net for all three
   * layers, and a change to TipTap's allowlist would show up here.
   */
  it('🔴 ISOLATES isSafeUrl — the encoded prefix TipTap\'s allowlist lets through', async () => {
    // 🔴 THE ONE THAT MATTERS. Remove `isSafeUrl` from applyLink and this test,
    // and only this test, goes red — every other unsafe scheme is caught twice.
    const c = await mount({ content: '<p>click me</p>' });
    await selectAll();
    await press(button(c, 'Link'));
    await enterUrl(c, '%6a%61%76%61%73%63%72%69%70%74:alert(1)');
    const html = emitted.at(-1) ?? c.querySelector('.ProseMirror')!.innerHTML;
    expect(html, 'the encoded javascript: prefix was linked — isSafeUrl is not in the path')
      .not.toContain('href');
    expect(c.querySelector('.ProseMirror a')).toBeNull();
  });

  it('🔴 drops a javascript: URL — caught by both layers, so this is the net and not the proof', async () => {
    const c = await mount({ content: '<p>click me</p>' });
    await selectAll();
    await press(button(c, 'Link'));
    await enterUrl(c, 'javascript:alert(document.cookie)');

    const html = emitted.at(-1) ?? c.querySelector('.ProseMirror')!.innerHTML;
    expect(html.toLowerCase(), 'a javascript: href reached the document').not.toContain('javascript:');
    expect(html, 'a link mark was applied for an unsafe URL').not.toContain('href');
    expect(c.querySelector('.ProseMirror a'), 'an anchor was created for a javascript: URL').toBeNull();
  });

  it('🔴 drops every unsafe scheme, whichever layer catches it', async () => {
    // Defence in depth, asserted as such. `isSafeUrl` names javascript:, data:,
    // vbscript: and blob:; TipTap's allowlist covers those plus the whitespace
    // obfuscations. Both are exercised through the real toolbar button.
    for (const bad of [
      'javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)', 'blob:https://evil.example/x', '%6a%61%76%61%73%63%72%69%70%74:alert(1)',
      ' javascript:alert(1)', 'java\nscript:alert(1)',
    ]) {
      const c = await mount({ content: '<p>click me</p>' });
      await selectAll();
      await press(button(c, 'Link'));
      const applied = await enterUrl(c, bad);
      const html = emitted.at(-1) ?? c.querySelector('.ProseMirror')!.innerHTML;
      expect(html, `${JSON.stringify(bad)} (typed as ${JSON.stringify(applied)}) produced a link`)
        .not.toContain('href');
      await act(async () => { root.unmount(); });
      c.remove();
    }
  });

  it('both layers are actually configured, so neither can be removed unnoticed', () => {
    // `isSafeUrl`'s own blocklist, and the fact that Link is configured without
    // widening `protocols` (which is what would re-admit a scheme TipTap
    // currently refuses).
    const sanitize = src('src/utils/sanitize.ts');
    expect(sanitize).toContain("const blocked = ['javascript:', 'data:', 'vbscript:', 'blob:'];");
    expect(sanitize, 'isSafeUrl stopped decoding, so an encoded prefix would pass')
      .toContain('decodeURIComponent(trimmed)');
    expect(src(EDITOR), 'Link gained a protocols option, which widens TipTap\'s allowlist')
      .not.toMatch(/Link\.configure\(\{[\s\S]*?protocols/);
  });

  it('APPLIES a safe URL, so the check is a filter and not a blanket refusal', async () => {
    // The other half. A test that only proves nothing is ever linked would
    // pass against a link button that does nothing at all.
    const c = await mount({ content: '<p>click me</p>' });
    await selectAll();
    await press(button(c, 'Link'));
    await enterUrl(c, 'https://theharvest.app/give');
    const html = emitted.at(-1) ?? c.querySelector('.ProseMirror')!.innerHTML;
    expect(html).toContain('href="https://theharvest.app/give"');
  });

  it('🔴 there is exactly ONE setLink reachable from the toolbar, and isSafeUrl guards it', () => {
    const code = src(EDITOR);
    // Two setLink calls exist in this file: the `commands` array's (the slash
    // menu's window.prompt path) and `applyLink`'s. Both are guarded, and the
    // toolbar routes to applyLink. A third would be a new implementation.
    const setLinks = codeOf(EDITOR).match(/\.setLink\(/g) ?? [];
    expect(setLinks.length, 'a setLink call was added or removed').toBe(2);

    // `applyLink` — the toolbar's path — checks before it sets, in that order.
    const applyLink = /const applyLink = useCallback\(\(\) => \{[\s\S]*?\}, \[editor, linkUrl\]\);/
      .exec(code)?.[0];
    expect(applyLink, 'applyLink is gone or was renamed').toBeTruthy();
    expect(applyLink!).toContain('isSafeUrl(linkUrl.trim())');
    // ⚠️ `.setLink(` and not `setLink`: `unsetLink` CONTAINS that substring, and
    // applyLink's unset branch comes first — so the loose spelling compared the
    // check against the wrong call and read as out of order.
    expect(applyLink!.indexOf('isSafeUrl')).toBeLessThan(applyLink!.indexOf('.setLink('));

    // And the slash menu's own path still checks too — untouched.
    expect(code).toMatch(/if \(url && isSafeUrl\(url\)\) \{\s*\n\s*editor\.chain\(\)\.focus\(\)\.setLink/);
  });

  it('the toolbar reaches the link editor through openLinkEditor, not a handler of its own', async () => {
    const code = src(EDITOR);
    expect(code).toContain("openLinkEditor('toolbar')");
    // One control, two mount points. The bubble and the toolbar render the same
    // component, so there is one input and one apply handler between them.
    expect((code.match(/<LinkEditorRow/g) ?? []).length).toBe(2);
    expect((code.match(/const LinkEditorRow =/g) ?? []).length).toBe(1);

    const c = await mount({ content: '<p>click me</p>' });
    expect(c.querySelector('input[aria-label="Link URL"]')).toBeNull();
    await selectAll();
    await press(button(c, 'Link'));
    const input = c.querySelector('input[aria-label="Link URL"]');
    expect(input, 'the toolbar link button opened nothing').toBeTruthy();
    // 🔴 The input lives in the TOOLBAR, not the bubble — which is the case the
    // bubble cannot serve at all: `BubbleMenu` renders only on a non-empty
    // selection, so a shared boolean would have put this control somewhere
    // unrendered. That is why the open state is tagged with its source.
    expect(toolbar(c)!.contains(input!), 'the toolbar link input is not in the toolbar').toBe(true);
    expect(button(c, 'Link').getAttribute('aria-expanded')).toBe('true');
  });

  it('🔴 refuses the link button when applyLink would silently do nothing', async () => {
    // 🔴 The silent failure this ticket had to avoid rather than introduce.
    // `applyLink` chains `extendMarkRange('link').setLink(...)`, so at a
    // COLLAPSED caret outside a link it applies a mark to a zero-width range
    // and the tap does nothing at all. The bubble never exposed that because it
    // only renders on a selection; a persistent bar can be pressed while
    // typing, so the precondition is shown instead of discovered.
    const c = await mount({ content: '<p>click me</p>' });
    const link = button(c, 'Link');
    expect(link.disabled, 'the link button is live with nothing to link').toBe(true);
    expect(link.getAttribute('title'), 'a blocked button must say why')
      .toBe('Link — select the text you want to link first');
    // Still 44px and still present: dimmed, never dropped or resized.
    expect(link.className).toContain('h-[44px]');
    expect(link.className).toContain('min-w-[44px]');
    expect(link.className).toContain('disabled:opacity-40');
    // And pressing it opens nothing rather than opening an input that cannot work.
    await press(link);
    expect(c.querySelector('input[aria-label="Link URL"]')).toBeNull();

    // A selection makes it live.
    await selectAll();
    expect(button(c, 'Link').disabled).toBe(false);
    expect(button(c, 'Link').getAttribute('title')).toBe('Link — Add a link');
  });

  it('a caret already inside a link is enough — no selection needed to EDIT one', async () => {
    // The other half of the precondition: `extendMarkRange` can widen from a
    // collapsed caret when there IS a link to widen to, so editing an existing
    // link must not require selecting it first.
    const c = await mount({ content: '<p><a href="https://theharvest.app">give</a></p>' });
    await act(async () => {
      const editor = currentEditor() as { commands: { setTextSelection: (p: number) => boolean } };
      editor.commands.setTextSelection(3);
    });
    expect(button(c, 'Link').disabled, 'editing an existing link was blocked').toBe(false);
    await press(button(c, 'Link'));
    // And it pre-fills the href it is about to replace, which is `applyLink`'s
    // own behaviour and the reason the toolbar routes to it rather than to the
    // slash menu's `window.prompt`.
    expect(c.querySelector<HTMLInputElement>('input[aria-label="Link URL"]')?.value)
      .toBe('https://theharvest.app');
  });

  it('an unsafe URL leaves an EXISTING link untouched rather than clearing it', async () => {
    // The failure mode of a check that runs in the wrong place: reject the new
    // href but unset the old one first, silently destroying a good link.
    const c = await mount({ content: '<p><a href="https://theharvest.app">give</a></p>' });
    await selectAll();
    await press(button(c, 'Link'));
    await enterUrl(c, 'javascript:alert(1)');
    const html = c.querySelector('.ProseMirror')!.innerHTML;
    expect(html).toContain('href="https://theharvest.app"');
    expect(html.toLowerCase()).not.toContain('javascript:');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · 🔴 The slash menu still works, unchanged — no-regression.
// ═══════════════════════════════════════════════════════════════════════════
describe('5 — the slash menu still works unchanged', () => {
  /**
   * The four blocks the ticket put out of bounds, pinned by digest.
   *
   * ⚠️ Extracted from the CURRENT file by the same section markers the file has
   * always carried, and compared against digests recorded from the pre-PR
   * revision. Line numbers were not usable: the ticket cited 235/260/321/464 and
   * the file was already 655 lines with those blocks at 263/288/349/493 before
   * this PR touched anything, so a range pin would have been asserting the wrong
   * bytes. Section markers move with the code; the digests do not.
   *
   * 🔴 No `git show` at assertion time — the digests are literals here, the way
   * `admin-data-screens.desktop-layout.test.tsx` learned to record them after a
   * shallow CI clone failed every `git show` in that suite.
   */
  /** The slash-menu machinery, from its opening marker to the next section. */
  const slashMachinery = () => {
    const code = src(EDITOR);
    const start = code.indexOf('// ─── Slash command extension');
    const end = code.indexOf('// ─── Link editor row');
    expect(start, 'the slash-command section marker is gone').toBeGreaterThan(-1);
    expect(end, 'the section after the slash machinery is gone').toBeGreaterThan(start);
    return code.slice(start, end);
  };

  it('🔴 the slash machinery is byte-for-byte what it was — extension, list, renderer', () => {
    const block = slashMachinery();
    // Pinned by CONTENT rather than by a recorded digest, because a digest
    // literal in a first-of-its-kind test is a number nobody can check. Every
    // structural element the ticket named is asserted present and unedited.
    expect(block).toContain("const SlashCommand = Extension.create({\n  name: 'slashCommand',");
    expect(block).toContain("char: '/',");
    expect(block).toContain('editor.chain().deleteRange(range).run();');
    expect(block).toContain('props.action(editor);');
    expect(block).toContain('const SlashCommandList = ({');
    expect(block).toContain('const renderSlashCommands = () => {');
    expect(block).toContain('component = new ReactRenderer(SlashCommandList, {');
    // The keyboard contract: Escape, ArrowUp, ArrowDown, Enter, and the wrap.
    for (const key of ['Escape', 'ArrowUp', 'ArrowDown', 'Enter']) {
      expect(block, `the slash menu stopped handling ${key}`).toContain(`event.key === '${key}'`);
    }
    expect(block).toContain('(selectedIndex + currentItems.length - 1) % currentItems.length');
    expect(block).toContain('(selectedIndex + 1) % currentItems.length');
    // The popup's own flip-and-clamp positioning.
    expect(block).toContain('const POPUP_HEIGHT = 340;');
    expect(block).toContain('const POPUP_WIDTH = 288;');
    expect(block).toContain("popup.style.zIndex = '9999';");
    // 🔴 Nothing this PR added leaked into the protected block.
    for (const added of ['RichTextToolbar', 'ALIGN_COMMANDS', 'COMMAND_ACTIVE', 'linkEditor', 'setTextAlign']) {
      expect(block, `${added} was written into the slash machinery`).not.toContain(added);
    }
  });

  it("🔴 the `items({ query })` filter is unchanged, so `/` filters what it always did", () => {
    const code = src(EDITOR);
    const items = /items: \(\{ query \}: \{ query: string \}\) => \{[\s\S]*?\n          \},/.exec(code)?.[0];
    expect(items, 'the slash filter is gone or was reshaped').toBeTruthy();
    // Maps over `commands`, overrides Image, filters on title OR description.
    expect(items!).toContain('return commands');
    expect(items!).toContain("cmd.title === 'Image'");
    expect(items!).toContain('openImageModalRef.current()');
    expect(items!).toContain('item.title.toLowerCase().includes(query.toLowerCase())');
    expect(items!).toContain('item.description.toLowerCase().includes(query.toLowerCase())');
    // 🔴 It still filters `commands` and NOT the toolbar's superset — the
    // alignments must not appear behind `/`.
    expect(items!, '`/` now offers the toolbar-only commands').not.toContain('ALIGN_COMMANDS');
  });

  it('the extension is still configured on the editor, with the same suggestion options', () => {
    const code = src(EDITOR);
    expect(code).toContain('SlashCommand.configure({');
    expect(code).toContain("allowedPrefixes: [' ', '\\u0000'],");
    expect(code).toContain('render: renderSlashCommands,');
    expect(code).toContain('allowSpaces: false,');
  });

  it('the slash extension is registered exactly once on a real mounted editor', async () => {
    const c = await mount();
    const editor = currentEditor() as { extensionManager: { extensions: { name: string }[] } };
    const names = editor.extensionManager.extensions.map((e) => e.name);
    expect(names.filter((n) => n === 'slashCommand').length, 'the slash extension is not registered once')
      .toBe(1);
    // And the toolbar did not displace anything the editor had.
    for (const required of ['slashCommand', 'link', 'image', 'underline', 'textAlign', 'placeholder']) {
      expect(names, `the editor lost the ${required} extension`).toContain(required);
    }
    expect(c.querySelector('.ProseMirror')).toBeTruthy();
  });

  it('the BubbleMenu is KEPT, with the five commands it always had', async () => {
    // 🔵 The decision, asserted rather than described. See the report: the
    // bubble is retained because it does a different job (retouch at the
    // selection) and because it hosts the link editor the toolbar now shares.
    const code = src(EDITOR);
    expect((code.match(/<BubbleMenu/g) ?? []).length).toBe(1);
    for (const mark of ['toggleBold', 'toggleItalic', 'toggleUnderline', 'toggleStrike']) {
      expect(code, `the bubble lost ${mark}`).toMatch(
        new RegExp(`onMouseDown=\\{\\(e\\) => \\{ e\\.preventDefault\\(\\); editor\\.chain\\(\\)\\.focus\\(\\)\\.${mark}\\(\\)\\.run\\(\\); \\}\\}`),
      );
    }
    expect(code).toContain("openLinkEditor('bubble')");
    // Its own dark chip is untouched, so it still reads as a floating control
    // rather than inheriting the toolbar's ground.
    expect(code).toContain('className="bg-warm-dark rounded-xl shadow-xl"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · onChange still receives HTML — no-regression on the STORED FORMAT.
// ═══════════════════════════════════════════════════════════════════════════
describe('6 — onChange still receives HTML', () => {
  it('🔴 the onUpdate handler is byte-identical', () => {
    // Content is stored as HTML and TipTapReadOnly renders it on the member
    // side. A toolbar changes no stored format, and this is the line that says so.
    expect(src(EDITOR)).toContain(
      'onUpdate: ({ editor }) => {\n      onChange(editor.getHTML());\n    },',
    );
  });

  it('hands onChange an HTML string, not JSON or a doc', async () => {
    const c = await mount({ content: '<p>Hello church</p>' });
    await selectAll();
    await press(button(c, 'Bold'));
    const html = emitted.at(-1)!;
    expect(typeof html).toBe('string');
    expect(html).toMatch(/^<[a-z]/);
    expect(() => JSON.parse(html)).toThrow();
  });

  /**
   * What the editor stores for a given input, RECORDED from the editor itself.
   *
   * ⚠️ These are not round-trips. TipTap normalises against its schema — a bare
   * `<li>` gains the paragraph the list-item node requires, `Link`'s configured
   * HTMLAttributes are re-emitted, a `style` gains its semicolon — and all of
   * that predates this ticket and is the extensions' behaviour, not the bar's.
   * Asserting `in === out` would therefore have failed on TipTap and said
   * nothing about the toolbar. Pinning the ACTUAL output does say something: if
   * the bar ever changed what is stored, one of these six strings moves.
   */
  const STORED: ReadonlyArray<readonly [string, string]> = [
    ['<p>Hello church</p>', '<p>Hello church</p>'],
    [
      '<h1>Sermon</h1><p>Notes with <strong>bold</strong> and <em>italic</em>.</p>',
      '<h1>Sermon</h1><p>Notes with <strong>bold</strong> and <em>italic</em>.</p>',
    ],
    // The list-item schema requires a block child.
    ['<ul><li>one</li><li>two</li></ul>', '<ul><li><p>one</p></li><li><p>two</p></li></ul>'],
    ['<blockquote><p>quoted</p></blockquote>', '<blockquote><p>quoted</p></blockquote>'],
    // Link re-emits its own configured HTMLAttributes.
    [
      '<p><a href="https://theharvest.app" class="text-gold underline cursor-pointer">give</a></p>',
      '<p><a target="_blank" rel="noopener noreferrer nofollow" class="text-gold underline cursor-pointer" href="https://theharvest.app">give</a></p>',
    ],
    // 🔵 Alignment already PARSES on the way in, which is the other half of the
    // extension-text-align decision: content carrying an alignment has always
    // been readable here and there was simply no way to author it.
    ['<p style="text-align: center">centred already</p>', '<p style="text-align: center;">centred already</p>'],
  ];

  it('🔴 MOUNTING the toolbar changes the stored HTML in no way at all (STOP 5)', async () => {
    for (const [content, stored] of STORED) {
      const c = await mount({ content });
      const editor = currentEditor() as { getHTML: () => string };
      expect(editor.getHTML(), `${content} is not stored as recorded`).toBe(stored);
      // 🔴 And rendering the bar wrote NOTHING: no onChange fired from mounting,
      // so opening a note cannot dirty it. This is the half of STOP 5 that a
      // format assertion cannot see — a spurious update would have saved the
      // normalised form back over the stored one on every open.
      expect(emitted, `mounting the toolbar emitted a change for ${content}`).toEqual([]);
      await act(async () => { root.unmount(); });
      c.remove();
    }
  });

  it('🔴 the stored form is a FIXED POINT — feeding it back changes nothing', async () => {
    // The property that matters for a format nobody re-migrates: the editor's
    // own output, put back in, comes out identical. If it did not, every open
    // and save would drift the stored HTML a little further.
    for (const [, stored] of STORED) {
      const c = await mount({ content: stored });
      expect((currentEditor() as { getHTML: () => string }).getHTML(),
        `${stored} is not stable under a second pass`).toBe(stored);
      expect(emitted).toEqual([]);
      await act(async () => { root.unmount(); });
      c.remove();
    }
  });

  it('alignment stores a text-align STYLE, which TipTapReadOnly already renders', async () => {
    // The one command the toolbar adds. It writes HTML like every other
    // command — a `style` on the block — and the read-only renderer has had
    // TextAlign configured all along, so the member side needs no change.
    const c = await mount({ content: '<p>Hello church</p>' });
    await selectAll();
    await press(button(c, 'Align Center'));
    expect(emitted.at(-1)).toContain('text-align: center');
    expect(src('src/components/TipTapReadOnly.tsx'))
      .toContain("TextAlign.configure({ types: ['heading', 'paragraph'] })");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7 · The tap-target constant, the scroller's contract, and the affordance.
//     (The GEOMETRY is measured in THE-279.toolbar-layout.test.tsx.)
// ═══════════════════════════════════════════════════════════════════════════
describe('7 — the tap target and the scroller are stated in px and in classes that exist', () => {
  it('🔴 the tap-target class agrees with TAP_TARGET_PX, and is spelled literally', () => {
    expect(TAP_TARGET_PX).toBe(44);
    const code = codeOf(TOOLBAR);
    // Literal, because Tailwind scans source text: `h-[${N}px]` compiles to
    // nothing and would size no button while looking correct.
    expect(code).toContain(`'h-[${TAP_TARGET_PX}px] min-w-[${TAP_TARGET_PX}px] shrink-0 '`);
    expect(code, 'the tap-target class is interpolated — Tailwind would emit no rule')
      .not.toMatch(/h-\[\$\{/);
  });

  it('🔴 uses px and NOT the rem scale, because h-11 is 39.875px on a desktop', () => {
    const code = codeOf(TOOLBAR);
    // `h-11`/`w-11` are named 44px and render 39.875px above 1024px, where
    // globals.css trims the rem base to 14.5px. Confirmed by compiling the
    // stylesheet; the browser suite measures the result.
    expect(code, 'a rem-scale size is back on the tap target').not.toMatch(/(^|\s|')[hw]-11(\s|'|$)/m);
    expect(src('src/app/globals.css')).toMatch(/@media \(min-width: 1024px\) \{\s*\n\s*:root \{ font-size: 14\.5px; \}/);
  });

  it('🔴 the row can never wrap or reduce: no flex-wrap, no responsive gate', async () => {
    const c = await mount();
    const cls = (scroller(c)!.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    expect(cls).toContain('flex');
    expect(cls).toContain('flex-nowrap');
    expect(cls, 'the row may wrap to a second row').not.toContain('flex-wrap');
    // Every command reachable at every width means no token here may be gated
    // behind a breakpoint — a responsive variant is HOW a set gets reduced.
    for (const t of cls) {
      expect(/^(sm|md|lg|xl|2xl):/.test(t), `${t} makes the row behave differently by width`)
        .toBe(false);
    }
    // And every button holds its size rather than being shaved to fit.
    for (const b of buttons(c)) {
      expect(b.className).toContain('shrink-0');
    }
  });

  it('🔴 scrolls sideways only — overflow-y is pinned so a vertical swipe reaches the PAGE', async () => {
    const c = await mount();
    const cls = (scroller(c)!.getAttribute('class') ?? '').split(/\s+/);
    expect(cls).toContain('overflow-x-auto');
    // ⚠️ Load-bearing and easy to lose: CSS computes an `overflow: visible`
    // axis to `auto` when the other axis is not visible, so `overflow-x-auto`
    // alone would give the row vertical scroll range — and a box with vertical
    // range swallows the swipe that should scroll the page.
    expect(cls, 'without overflow-y-hidden the row eats vertical swipes').toContain('overflow-y-hidden');
    // Contains the horizontal over-scroll (the browser's back-swipe) while
    // leaving the y axis chaining to the page.
    expect(cls).toContain('overscroll-x-contain');
    // 🔴 No touch-action restriction: the default `auto` is what lets the
    // browser pick the dominant axis per gesture. `touch-action: pan-x` would
    // have BLOCKED the vertical pan rather than fixing it.
    expect(codeOf(TOOLBAR), 'a touch-action would fight page scroll')
      .not.toMatch(/touch-action|touch-pan/);
  });

  it("🔴 records WHY `ui/scroll-area` is not used — the fact the decision rests on", () => {
    // 🔵 The ticket asked whether `scroll-area` (THE-274/#419) gives native
    // touch momentum on iOS, or whether plain `overflow-x-auto` is the better
    // answer. It is the second, and the deciding reason is not momentum.
    //
    // 🔴 Base UI's ScrollArea Viewport sets `overflow: 'scroll'` as an INLINE
    // STYLE, on BOTH AXES. An inline style beats a class, so the
    // `overflow-y-hidden` that this toolbar depends on could not be applied
    // over it — the row would keep permanent vertical scroll range and would
    // swallow the vertical swipe that must reach the page. (Being a native
    // overflow box is also why it adds no momentum plain `overflow-x-auto`
    // lacks: momentum is the platform's, not the wrapper's.)
    //
    // Pinned against the INSTALLED package so the decision cannot rot silently:
    // if Base UI ever stops forcing both axes inline, this fails and the
    // trade-off gets re-made deliberately instead of being inherited.
    const viewport = readFileSync(
      path.join(ROOT, 'node_modules/@base-ui/react/scroll-area/viewport/ScrollAreaViewport.js'),
      'utf8',
    );
    expect(viewport, "Base UI's ScrollArea Viewport no longer forces overflow inline — re-decide")
      .toMatch(/style:\s*\{\s*overflow:\s*'scroll'\s*\}/);

    // And this repo's own wrapper emits only a VERTICAL bar, so it could not
    // even render a horizontal scrollbar without editing a shared primitive.
    const wrapper = src('src/components/ui/scroll-area.tsx');
    expect(wrapper).toContain('<ScrollBar />');
    expect(wrapper).toMatch(/orientation = "vertical"/);

    // So the toolbar uses neither the primitive nor the package.
    expect(codeOf(TOOLBAR), 'the toolbar took the scroll-area primitive after all')
      .not.toMatch(/scroll-area|ScrollArea/);
  });

  it('gives an overflow affordance at each end, and only when that end has more', async () => {
    const c = await mount();
    // happy-dom reports zero scroll metrics, so with scrollWidth === clientWidth
    // === 0 the component reads "no overflow" and paints neither fade. That is
    // the correct behaviour for a row that fits, and it is what makes the fade
    // honest: a cue that is always on reads as a truncated toolbar just as much
    // as a truncated toolbar with no cue.
    expect(c.querySelector('[data-editor-toolbar-fade]')).toBeNull();

    const code = codeOf(TOOLBAR);
    // Both ends exist, are decorative, and cannot eat any of the 44px they
    // cover — the button underneath stays fully tappable.
    expect(code).toContain('data-editor-toolbar-fade="start"');
    expect(code).toContain('data-editor-toolbar-fade="end"');
    expect((code.match(/pointer-events-none absolute inset-y-0/g) ?? []).length).toBe(2);
    expect((code.match(/aria-hidden="true"/g) ?? []).length).toBe(2);
    // Measured, not assumed — on scroll and on resize, since the viewport can
    // create or remove the overflow with no scrolling at all.
    expect(code).toContain('onScroll={syncEdges}');
    expect(code).toContain('new ResizeObserver(syncEdges)');
  });

  it('renders the fades once overflow exists, and drops each at its own end', async () => {
    const c = await mount();
    const el = scroller(c) as HTMLElement;
    // happy-dom has no layout, so the metrics are stubbed to model a scroller
    // wider than its box. This tests the COMPONENT'S LOGIC; the real geometry
    // is measured in Chromium next door.
    const set = (scrollLeft: number) => {
      Object.defineProperty(el, 'scrollWidth', { value: 900, configurable: true });
      Object.defineProperty(el, 'clientWidth', { value: 380, configurable: true });
      Object.defineProperty(el, 'scrollLeft', { value: scrollLeft, configurable: true });
    };
    const fades = () =>
      Array.from(c.querySelectorAll('[data-editor-toolbar-fade]'))
        .map((f) => f.getAttribute('data-editor-toolbar-fade'))
        .sort();

    set(0);
    await act(async () => { el.dispatchEvent(new Event('scroll', { bubbles: true })); });
    expect(fades(), 'at the left end, only the right cue belongs').toEqual(['end']);

    set(260);
    await act(async () => { el.dispatchEvent(new Event('scroll', { bubbles: true })); });
    expect(fades(), 'mid-scroll, both ends have more').toEqual(['end', 'start']);

    set(520);
    await act(async () => { el.dispatchEvent(new Event('scroll', { bubbles: true })); });
    expect(fades(), 'at the right end, only the left cue belongs').toEqual(['start']);
  });

  it('🔴 is NOT sticky — a sticky bar inside the card would declare what it cannot do', () => {
    // Measured in Chromium: the editor card carries `overflow-hidden` (it clips
    // the rounded-xl), which makes the card its own scroll container, so a
    // `sticky top-0` child resolves against a box that never scrolls. The bar
    // sat at y=0 before a scroll and y=-500 after one — static behaviour with a
    // sticky declaration. The layout suite re-measures this rather than
    // trusting the note.
    expect(codeOf(TOOLBAR), 'sticky here is a declaration the card cannot honour')
      .not.toMatch(/\bsticky\b|position:\s*sticky/);
    expect(src(EDITOR)).toContain('<div className="bg-surface-raised rounded-xl overflow-hidden">');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8 · Colour — nothing hardcoded, and all four palettes resolve. Classic first.
// ═══════════════════════════════════════════════════════════════════════════
describe('8 — no colour is hardcoded and all four palettes resolve', () => {
  /**
   * Colour-bearing utilities.
   *
   * ⚠️ `border-b` is a border WIDTH — the toolbar's own bottom rule — and the
   * naive `border-[a-z]` spelling flagged it as an unthemed colour. The side and
   * width utilities are excluded by name so the check keeps meaning what it says.
   */
  const NOT_A_COLOUR = /^(?:border-(?:[btlrxy]|[0-9]+|solid|dashed|dotted|none)|text-(?:xs|sm|base|lg|xl|\dxl|left|center|right|justify)|to-transparent)$/;
  const COLOURED = /\b(?:bg|text|border|from|via|to|ring|fill|stroke|divide|placeholder|shadow|accent|caret|decoration|outline)-[a-z[]/;

  it('🔴 spells no raw colour literal — no hex, no rgb(), no hsl()', () => {
    // Comments stripped: the header explains WHY there is no raw colour here,
    // and the explanation must not be what fails the rule it documents.
    const code = codeOf(TOOLBAR);
    expect(code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], 'a hex literal is in the toolbar').toEqual([]);
    expect(code.match(/\b(?:rgba?|hsla?|oklch|lab)\(/g) ?? [], 'a raw colour function is in the toolbar')
      .toEqual([]);
  });

  it('🔴 every colour it spells is a theme token or a CSS variable', async () => {
    const c = await mount();
    const tokens = new Set<string>();
    for (const el of Array.from(toolbar(c)!.querySelectorAll('*'))) {
      for (const t of (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)) tokens.add(t);
    }
    for (const t of (toolbar(c)!.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)) tokens.add(t);

    // Also the active branch, which only renders when a mark is on.
    await press(button(c, 'Bold'));
    for (const t of (button(c, 'Bold').getAttribute('class') ?? '').split(/\s+/)) tokens.add(t);

    /**
     * The semantic families this app themes through, plus `white`.
     *
     * `text-white` sits on `bg-gold` (--brand-color) in the shared link row and
     * is the ink FOR that accent, not a neutral — the same pairing the bubble's
     * apply button has always used. Everything else must name a --var-backed
     * token: surface-*, line-*, and the textColor scale (strong/muted/faint/
     * gold/danger/body).
     */
    const THEMED = /-(surface(-\w+)?|line(-\w+)?|strong|muted|faint|body|gold|danger|white|transparent|current|inherit)$/;
    const offenders = [...tokens]
      .map((t) => ({ token: t, utility: t.replace(/^(?:hover|focus|active|disabled|group-hover|data-\[[^\]]+\]):/, '') }))
      .filter(({ utility }) => COLOURED.test(utility) && !NOT_A_COLOUR.test(utility))
      .map(({ token, utility }) => {
        void token;
        // An arbitrary value is fine when it resolves through a CSS variable —
        // color-mix(in srgb, var(--brand-color) …) is the app's own accent and
        // the idiom SlashCommandList already uses for its selected row.
        if (/^\w+-\[/.test(utility)) return utility.includes('var(--') ? null : utility;
        return THEMED.test(utility) ? null : utility;
      })
      .filter((u): u is string => u !== null);
    expect(offenders, 'these colours are not expressed through a theme token').toEqual([]);
  });

  it('the active state reuses the slash menu\'s own accent, so it mints no colour', () => {
    const toolbarCode = codeOf(TOOLBAR);
    const editorCode = codeOf(EDITOR);
    const accent = 'bg-[color-mix(in_srgb,var(--brand-color)_10%,transparent)]';
    expect(toolbarCode).toContain(accent);
    // The same treatment SlashCommandList already gives its selected row, so
    // the two menus agree on what "current" looks like.
    expect(editorCode).toContain(accent);
  });

  it('Classic is the default palette these tokens are read in first', () => {
    // Classic has been the default since #409; --brand-color is the
    // tenant-overridable accent, so every token above resolves per palette
    // rather than per component.
    const globals = src('src/app/globals.css');
    expect(globals).toMatch(/--brand-color:\s*#C9963A;/);
    expect(globals).toContain('--surface-raised:');
    expect(globals).toContain('--border-default:');
    expect(src('src/__tests__/the-265-classic-default.test.ts')).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9 · One component, three surfaces — Notes, Course Builder and Blog.
// ═══════════════════════════════════════════════════════════════════════════
describe('9 — the toolbar appears in Notes, Course Builder and Blog', () => {
  const SURFACES = {
    Notes: 'src/components/AdminDocs.tsx',
    'Course Builder': 'src/components/AdminCourseEditor.tsx',
    Blog: 'src/components/AdminBlogPostEditor.tsx',
  } as const;

  it('🔴 all three render the SHARED editor, and none forks it', () => {
    for (const [surface, file] of Object.entries(SURFACES)) {
      const code = src(file);
      expect(code, `${surface} does not import the shared editor`)
        .toMatch(/import RichTextEditor(?:, \{[^}]*\})? from '\.\/RichTextEditor'/);
      expect(code, `${surface} renders no editor`).toContain('<RichTextEditor');
      // A per-surface toolbar would be the fork the ticket forbids.
      expect(code, `${surface} grew a toolbar of its own`).not.toContain('RichTextToolbar');
    }
  });

  it('🔴 the toolbar reaches all three by living in the shared component, mounted once', () => {
    const code = src(EDITOR);
    expect((code.match(/<RichTextToolbar/g) ?? []).length, 'the toolbar is mounted more than once').toBe(1);
    // No prop turns it off, so no surface can opt out and drift.
    expect(code, 'the toolbar became optional').not.toMatch(/showToolbar|hideToolbar|withToolbar/);
    const props = /interface RichTextEditorProps \{[\s\S]*?\n\}/.exec(code)?.[0] ?? '';
    expect(props).not.toMatch(/toolbar/i);
  });

  it('renders for every prop shape the three surfaces actually pass', async () => {
    // The real call sites: a compact notes pane, three course fields at 60-120px,
    // and the blog's 46vh. The toolbar must appear in all of them.
    for (const props of [
      { minHeight: 'calc(100vh - 320px)', proseClass: 'prose prose-sm' },
      { minHeight: '80px' },
      { minHeight: '60px' },
      { minHeight: '120px' },
      { minHeight: '46vh' },
    ]) {
      const c = await mount(props);
      expect(toolbar(c), `no toolbar at minHeight ${props.minHeight}`).toBeTruthy();
      expect(buttons(c).length, `a command was dropped at minHeight ${props.minHeight}`).toBe(18);
      await act(async () => { root.unmount(); });
      c.remove();
    }
  });

  it('🔵 NewsletterEditor and CanvasEditor are separate editors and get no toolbar', () => {
    // Reported, not migrated — that is its own ticket. Both are standalone
    // TipTap/Excalidraw surfaces that never imported this component, and
    // NewsletterEditor is digest-guarded by
    // admin-data-screens.desktop-layout.test.tsx, so touching it here would
    // trip a guard for work that is not this ticket's.
    for (const file of ['src/components/NewsletterEditor.tsx', 'src/components/CanvasEditor.tsx']) {
      const code = src(file);
      expect(code, `${file} imports the shared editor`).not.toContain("from './RichTextEditor'");
      expect(code, `${file} was given a toolbar by this PR`).not.toContain('RichTextToolbar');
    }
    expect(src('src/components/__tests__/admin-data-screens.desktop-layout.test.tsx'))
      .toContain("'NewsletterEditor.tsx',");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10 · firestore.rules and functions/ are byte-identical.
// ═══════════════════════════════════════════════════════════════════════════
describe('10 — firestore.rules and functions/ are untouched', () => {
  /**
   * Digests recorded as literals, never read from git at assertion time.
   *
   * ⚠️ Two separate reasons, both already paid for in this repo:
   *  · `git show <rev>` fails in CI, where `actions/checkout` fetches a single
   *    commit — "fatal: invalid object name" — which is what
   *    `admin-data-screens.desktop-layout.test.tsx` had to be rewritten for.
   *  · A squash-merge breaks a revision pin a second way.
   *
   * Both values were computed from this PR's base (c0d98c2) and hold because
   * the PR opens neither path. A change to either fails HERE, loudly.
   */
  it('🔴 firestore.rules is byte-identical', () => {
    // 🔴 It AUTO-DEPLOYS to production on merge — deploy-rules.yml fires on any
    // push to main touching it — and CI runs no emulator rules tests, so
    // nothing else in the pipeline would catch an edit.
    expect(sha256(src('firestore.rules')))
      // ⚠️ REGENERATED ONCE, by THE-313 (#462), which added the `servicePlans` rule
      // inside `match /tenants/{tenantId}` beside `events`: `allow read: if
      // belongsToTenant(tenantId)` and `allow write: if hasPermission('manageEvents',
      // tenantId)`. Purely additive — no existing rule's text moved and it names no new
      // helper, so every other claim this pin carries is unchanged.
      // Was: a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499
      .toBe('4973c3c94c5a3be8d478f4373326b23fbd9de447d3ac6a5b8173f723dfd62075');
  });

  it('🔴 nothing under functions/ moved — every file, not just the entry point', () => {
    // Digested as a TREE (path + content, sorted), so an added or deleted file
    // fails too. A per-file digest on index.ts alone would have missed both.
    // functions/ does NOT deploy on merge, so a change here is silently
    // unshipped — and a rich-text toolbar has no business in a Cloud Function.
    const files = [
      'functions/.gcloudignore',
      'functions/package-lock.json',
      'functions/package.json',
      'functions/src/index.ts',
      'functions/tsconfig.json',
    ];
    // The listing is pinned too, so a NEW file cannot slip past the digest by
    // simply not being in the list.
    // A plain walk rather than `readdirSync(..., { recursive: true })`: the
    // Dirent property that carries the parent directory was renamed between
    // Node majors (`path` → `parentPath`), and this repo pins engines to 24
    // while a runner may serve another.
    const walk = (dir: string, prefix: string): string[] =>
      readdirSync(path.join(ROOT, dir), { withFileTypes: true })
        .filter((e) => e.name !== 'node_modules')
        .flatMap((e) =>
          e.isDirectory() ? walk(`${dir}/${e.name}`, `${prefix}${e.name}/`) : [`${prefix}${e.name}`]);
    expect(walk('functions', 'functions/').sort(), 'a file was added to or removed from functions/')
      .toEqual(files);

    const tree = files.map((f) => `${sha256(src(f))}  ${f}`).join('\n') + '\n';
    expect(sha256(tree))
      .toBe('d46fab72e0edeb990cdf04a79e35aa68545dbc732bd8fd34483177c2f4b18865');
  });
});
