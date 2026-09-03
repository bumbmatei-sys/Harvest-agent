"use client";
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Separator } from '@/components/ui/separator';

/**
 * The persistent formatting toolbar for RichTextEditor (THE-279).
 *
 * 🔴 NO COMMAND IMPLEMENTATION LIVES HERE — not one `chain()`, TipTap command
 * name or `isActive()` query. Every button is handed a bound `run` closure and
 * an `active` boolean built in RichTextEditor.tsx from the SAME `commands`
 * array the slash menu filters, so the toolbar cannot drift from `/`. The suite
 * greps this file for TipTap vocabulary and fails if any appears: a second
 * `setLink` that skipped `isSafeUrl` would be an XSS hole, and the cheapest way
 * to prevent one is for this file to be unable to express a command at all.
 *
 * One row, scrolling sideways, never wrapping — the founder's call: "not 3 rows
 * but just swipe left and right to see all of it." No overflow menu and no
 * reduced set on mobile; all 18 commands are reachable at every width.
 *
 * ─── Four measured facts this file is built on ─────────────────────────────
 *
 * 1. 🔴 `h-11` IS NOT 44px HERE. globals.css trims the rem base to 14.5px above
 *    1024px, so `h-11` compiles to `2.75rem` and renders 39.875px on a desktop
 *    — 4.125px under the touch minimum its name claims. Hence `h-[44px]
 *    min-w-[44px]`, spelled LITERALLY: Tailwind generates utilities by scanning
 *    source text, so `h-[${'${N}'}px]` produces no rule at all.
 *
 * 2. ⚠️ `overflow-y-hidden` IS LOAD-BEARING. CSS computes an `overflow: visible`
 *    axis to `auto` when the other axis is not visible, so `overflow-x-auto`
 *    alone would give this row vertical scroll range — and a box with vertical
 *    range swallows the swipe that should scroll the PAGE. Pinning y to `hidden`
 *    leaves zero range, so the gesture propagates. Same reason there is no
 *    `touch-action`: the default `auto` lets the browser pick the axis per
 *    gesture, where `pan-x` would have BLOCKED vertical panning.
 *
 * 3. 🔴 `ui/scroll-area` WOULD BREAK (2), FROM AN INLINE STYLE. Base UI's
 *    ScrollAreaViewport sets `style={{ overflow: 'scroll' }}` — both axes,
 *    inline — and an inline style beats a class, so `overflow-y-hidden` could
 *    not take it back. Being a native overflow box is also why it adds no iOS
 *    momentum that plain `overflow-x-auto` lacks: momentum is the platform's.
 *    Its 10px rail under a 44px row, and this repo's wrapper hardcoding
 *    `<ScrollBar />` vertical, were the lesser reasons. The suite pins this fact
 *    about the installed package so the decision fails rather than rots.
 *
 * 4. 🔴 A STICKY BAR HERE WOULD NOT STICK. The editor card is `overflow-hidden`
 *    (it clips its `rounded-xl`), which makes it its own scroll container, so a
 *    `sticky top-0` child resolves against a box that never scrolls: measured
 *    at y=0 before a 500px scroll and y=-500 after. Static instead — which also
 *    settles the `fixed bottom-0` nav by construction, since a bar at the TOP in
 *    normal flow cannot overlap something anchored to the viewport's bottom.
 *
 * `overscroll-behavior-x: contain` keeps a horizontal over-scroll from becoming
 * the browser's back-swipe; it names x only, so y still chains to the page. The
 * desktop scrollbar is hidden because the fade edges are the cue and a 10px
 * gutter would read as a second, thinner toolbar.
 */

/**
 * The touch-target floor for BOTH axes (Apple HIG, WCAG 2.5.5), as a number so
 * the suite asserts it rather than re-parsing the class it checks. See fact 1.
 */
export const TAP_TARGET_PX = 44;

/**
 * The visual grouping, by command title — a layout decision, so these are the
 * slash menu's own labels and not TipTap command names.
 */
export const TOOLBAR_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  ['Paragraph', 'Heading 1', 'Heading 2'],
  ['Bold', 'Italic', 'Underline', 'Strikethrough'],
  ['Bullet List', 'Numbered List'],
  ['Quote', 'Code Block', 'Divider'],
  ['Link', 'Image'],
  ['Align Left', 'Align Center', 'Align Right', 'Justify'],
];

/**
 * One button: a label, an icon, an action already bound to the editor by the
 * caller, and whether the caret sits inside what it applies. Nothing here knows
 * what `run` does, which is the point.
 */
export interface ToolbarItem {
  /** Matches a `commands` entry's `title`, or an alignment's. */
  title: string;
  /** The one-line description the slash menu shows; used as the button's hint. */
  description: string;
  icon: React.ReactNode;
  /** The bound command. Built from the slash menu's own `action`. */
  run: () => void;
  /** True when the selection already carries what this button applies. */
  active: boolean;
  /** Set on a button that opens an input rather than applying immediately. */
  expanded?: boolean;
  /**
   * True when the command cannot apply to the current selection — Link is the
   * only one today. `applyLink` needs a non-empty selection or a caret already
   * in a link; with neither it marks a zero-width range and the tap is silently
   * swallowed, so the precondition is shown rather than discovered.
   */
  disabled?: boolean;
  /** Why it is disabled, shown in place of the hint so the block is learnable. */
  disabledReason?: string;
}

/**
 * Partition items into {@link TOOLBAR_GROUPS}, in that order.
 *
 * 🔴 Loud in the suite, graceful on the screen. An unplaced command is a
 * developer mistake, and this THREW on it at first — but it runs during React's
 * render and there is NO error boundary above the admin editor (`ErrorBoundary`
 * is mounted in `MainApp`, the member app), so the throw would blank the screen
 * someone is writing a sermon note in, losing whatever auto-save had not
 * written. So an unplaced command is appended in a trailing group and a title
 * with no item is skipped: nothing silently lost, nothing crashed. The strict
 * correspondence is asserted in the suite, which goes red first.
 */
export function groupItems(items: readonly ToolbarItem[]): ToolbarItem[][] {
  const byTitle = new Map(items.map((i) => [i.title, i]));
  const groups = TOOLBAR_GROUPS
    .map((group) =>
      group
        .map((title) => {
          const item = byTitle.get(title);
          if (item) byTitle.delete(title);
          return item;
        })
        .filter((item): item is ToolbarItem => item !== undefined))
    .filter((group) => group.length > 0);
  // Anything the layout does not place still gets rendered, at the end.
  return byTitle.size > 0 ? [...groups, [...byTitle.values()]] : groups;
}

/** How close to an end counts as being at it, in px. Sub-pixel scroll offsets. */
const END_EPSILON = 1;

interface RichTextToolbarProps {
  items: readonly ToolbarItem[];
  /** The link input, rendered under the row when the link button is open. */
  children?: React.ReactNode;
}

const RichTextToolbar: React.FC<RichTextToolbarProps> = ({ items, children }) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Both true until measured: with no overflow BOTH ends are current, and that
  // is also the honest initial state for a row that fits.
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  /**
   * Which fade edges to paint. Both ends are measured rather than assumed: a
   * permanent right fade on a row with nothing to its right is as misleading as
   * no cue at all.
   */
  const syncEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setAtStart(el.scrollLeft <= END_EPSILON);
    setAtEnd(el.scrollLeft >= max - END_EPSILON);
  }, []);

  useEffect(() => {
    syncEdges();
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // The row's overflow depends on the viewport, so a resize can create or
    // remove it without any scrolling happening.
    const observer = new ResizeObserver(syncEdges);
    observer.observe(el);
    return () => observer.disconnect();
  }, [syncEdges, items.length]);

  const groups = groupItems(items);

  return (
    <div
      // 🔴 A SIBLING of <EditorContent>, never a child: the prose ramp lands on
      // the editable area and @tailwindcss/typography styles descendants by
      // tag, so a button inside it would inherit body-copy type.
      data-editor-toolbar
      className="relative border-b border-line bg-surface-raised"
    >
      <div
        ref={scrollerRef}
        onScroll={syncEdges}
        data-editor-toolbar-scroller
        role="toolbar"
        aria-label="Formatting"
        aria-orientation="horizontal"
        // ⚠️ Every token unprefixed: a responsive variant is how a set gets
        // reduced, and every command must be reachable at every width.
        className={
          'flex items-center gap-0.5 px-1.5 py-1 ' +
          // ONE row — no `flex-wrap`, and the children are `shrink-0`.
          'flex-nowrap ' +
          // Sideways only. See fact 2 on why y must be hidden.
          'overflow-x-auto overflow-y-hidden overscroll-x-contain ' +
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden ' +
          '[-webkit-overflow-scrolling:touch]'
        }
      >
        {groups.map((group, groupIndex) => (
          // Keyed by the group's OWN titles: an unplaced command lands in a
          // trailing group with no TOOLBAR_GROUPS entry, and indexing past the
          // end would throw the crash `groupItems` exists to avoid.
          <React.Fragment key={group.map((i) => i.title).join('|')}>
            {groupIndex > 0 && (
              <Separator
                orientation="vertical"
                // 24px, not `self-stretch`: a divider between icons rather
                // than a rule down the full 52px of the row.
                className="mx-1 h-6 shrink-0 bg-line"
              />
            )}
            {group.map((item) => (
              <button
                key={item.title}
                type="button"
                data-editor-toolbar-button
                data-command={item.title}
                aria-label={item.title}
                aria-pressed={item.active}
                disabled={item.disabled ?? false}
                {...(item.expanded === undefined ? {} : { 'aria-expanded': item.expanded })}
                // The hint becomes the REASON when blocked, so the button
                // teaches its precondition. `aria-label` stays the name.
                title={
                  item.disabled && item.disabledReason
                    ? `${item.title} — ${item.disabledReason}`
                    : `${item.title} — ${item.description}`
                }
                // `onMouseDown` + `preventDefault` is the bubble menu's own
                // idiom: it keeps the selection alive, which a focus change
                // would drop before the command could see it. The guard is
                // because mousedown fires on a disabled button in some engines.
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (item.disabled) return;
                  item.run();
                }}
                className={
                  // 🔴 44px on both axes, in px, at every width — see fact 1,
                  // including why these two classes are spelled literally and
                  // never interpolated from TAP_TARGET_PX. `min-w-` so a wider
                  // control could grow; `shrink-0` so flex cannot shave a
                  // button below the floor to fit the row.
                  'h-[44px] min-w-[44px] shrink-0 ' +
                  'flex items-center justify-center rounded-lg transition-colors ' +
                  // ⚠️ Dimmed, never resized or removed — a button that
                  // vanished would change the bar as the selection moved.
                  'disabled:opacity-40 disabled:cursor-not-allowed ' +
                  (item.active
                    // SlashCommandList's own treatment for its selected row,
                    // so both menus agree on "current" and no colour is minted.
                    ? 'bg-[color-mix(in_srgb,var(--brand-color)_10%,transparent)] text-gold'
                    : 'text-muted hover:bg-surface-tint hover:text-strong')
                }
              >
                {item.icon}
              </button>
            ))}
          </React.Fragment>
        ))}
      </div>

      {/*
        The overflow cue. `pointer-events-none` so the button underneath stays
        fully tappable — it must not eat any of the 44px it covers. Colour is
        --surface-raised, so all four palettes fade to the right ground.
      */}
      {!atStart && (
        <div
          aria-hidden="true"
          data-editor-toolbar-fade="start"
          className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-surface-raised to-transparent"
        />
      )}
      {!atEnd && (
        <div
          aria-hidden="true"
          data-editor-toolbar-fade="end"
          className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface-raised to-transparent"
        />
      )}

      {children}
    </div>
  );
};

export default RichTextToolbar;
