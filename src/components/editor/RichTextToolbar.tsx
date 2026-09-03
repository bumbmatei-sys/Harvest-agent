"use client";
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Separator } from '@/components/ui/separator';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * The persistent formatting toolbar for RichTextEditor (THE-279)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ─── What this file deliberately does NOT contain ──────────────────────────
 *
 * 🔴 NO COMMAND IMPLEMENTATION. Not one `chain()`, not one TipTap command
 * name, not one `isActive()` query. Every button here is handed a `run`
 * closure and an `active` boolean that were built in RichTextEditor.tsx from
 * the SAME `commands` array the slash menu filters. That is not a stylistic
 * preference — it is the guarantee that the toolbar cannot drift from `/`, and
 * it is asserted structurally: the suite greps this file for TipTap vocabulary
 * and fails if any appears. A second implementation of `setLink` that skipped
 * `isSafeUrl` is an XSS hole, and the cheapest way to make that impossible is
 * for this file to be incapable of expressing a command at all.
 *
 * ─── Why the sizes are in px and not rem ───────────────────────────────────
 *
 * globals.css trims the rem base to 14.5px above 1024px, so `h-11` — whose
 * name says 44px — compiles to `height: 2.75rem` and renders **39.875px on a
 * desktop**, 4.125px under the touch minimum it is named for. Measured, not
 * assumed: see the probe recorded in the test file's header. The tap target is
 * therefore `h-[44px] min-w-[44px]`, and {@link TAP_TARGET_PX} is the number as
 * a plain integer so a test asserts it rather than re-parsing the class.
 *
 * This is the same reasoning `layout/form-layout.ts` states for every width it
 * owns, and this 44px is deliberately NOT one of that module's values: Rule 4
 * caps a desktop FORM CONTROL at `DESKTOP_CONTROL_MAX_PX = 40`, and every
 * token in that module is `sm:`-gated so nothing it exports can reach a phone.
 * A touch target is the opposite kind of number — a floor, unprefixed, applying
 * at every viewport — and 44px is a platform constant (Apple HIG, WCAG 2.5.5),
 * not a Harvest layout decision. Spelling it here mints no competing measure.
 *
 * ─── One row, scrolling sideways, never wrapping ───────────────────────────
 *
 * 🔴 DECIDED BY THE FOUNDER: "not 3 rows but just swipe left and right to see
 * all of it." So: `flex` with no `flex-wrap`, every child `shrink-0`, and the
 * row itself `overflow-x-auto`. No overflow menu, no reduced set on mobile —
 * all 18 commands are reachable at 380px and at 1440px alike.
 *
 * ⚠️ `overflow-y-hidden` is load-bearing and easy to lose. CSS computes an
 * `overflow: visible` axis to `auto` when the other axis is not visible, so
 * `overflow-x-auto` ALONE would make this row vertically scrollable too — and a
 * box with vertical scroll range swallows the vertical swipe that should scroll
 * the PAGE. Pinning y to `hidden` leaves the row zero vertical range, so the
 * browser propagates the gesture to the page, which is exactly the behaviour
 * the ticket requires. For the same reason there is no `touch-action` here: the
 * default `auto` is what lets the browser pick the dominant axis per gesture,
 * and a `touch-action: pan-x` would have BLOCKED vertical panning on the
 * toolbar rather than fixing it.
 *
 * `overscroll-behavior-x: contain` stops a horizontal over-scroll at the ends
 * from turning into the browser's back-swipe. It names the x axis only, so the
 * y axis keeps chaining to the page.
 *
 * ─── Why not `ui/scroll-area` ──────────────────────────────────────────────
 *
 * 🔴 IT WOULD BREAK THE GESTURE RULE ABOVE, AND FROM AN INLINE STYLE THAT
 * CANNOT BE OVERRIDDEN. `scroll-area` (installed by THE-274/#419) wraps Base
 * UI's ScrollArea, and its Viewport sets `style={{ overflow: 'scroll' }}` —
 * BOTH AXES, inline (`@base-ui/react/scroll-area/viewport`, in the `props`
 * object it spreads onto the element). An inline style beats a class, so an
 * `overflow-y-hidden` at the call site could not take it back: the row would
 * carry permanent vertical scroll range and would swallow the vertical swipe
 * that has to reach the page. That is not a cost worth paying for a rail.
 * `editor-toolbar.test.tsx` pins this fact about the installed primitive, so
 * the decision fails loudly rather than rotting if Base UI changes it.
 *
 * The rest was already reason enough. Because that Viewport IS a native
 * `overflow` box, it adds no iOS momentum that plain `overflow-x-auto` does not
 * already have — momentum comes from the platform, not from the wrapper. What
 * it DOES add is a custom 10px scrollbar rail below a 44px row that a thumb
 * never grabs, two DOM levels, and the JS that sizes the thumb; and this repo's
 * wrapper hardcodes `<ScrollBar />` at its default VERTICAL orientation, so it
 * emits no horizontal bar at all without editing a shared primitive to serve
 * one toolbar. #422 measured plain `overflow-x-auto` clipping inside its own
 * card at 380/768/1024 with the page body never moving, and that is the pattern
 * followed here.
 *
 * The desktop scrollbar is hidden (`scrollbar-width: none` and the WebKit
 * pseudo-element) because the fade edges below are the overflow cue, and a
 * 10px gutter under the icons would read as a second, thinner toolbar.
 *
 * ─── Why the toolbar is STATIC and not sticky ──────────────────────────────
 *
 * 🔴 Measured, and it is the reason. RichTextEditor's card carries
 * `overflow-hidden` (it clips the `rounded-xl`), and `overflow: hidden` makes
 * that card its OWN scroll container — so a `sticky top-0` child resolves
 * against a box that never scrolls. In headless Chromium against the real
 * compiled stylesheet, a `sticky top-0` bar inside that card sat at y=0 before
 * scrolling and y=-500 after a 500px scroll: it declares stickiness and
 * delivers static behaviour. Shipping that would be markup that lies. Making
 * it genuinely sticky means removing the card's clipping on three surfaces,
 * which is a restyle nobody asked for.
 *
 * Static also settles the bottom nav by construction rather than by luck. The
 * admin nav is `fixed bottom-0` at `z-[100]` with `pb-safe` below `lg`; this
 * toolbar is in normal flow at the TOP of the editor card, so it cannot overlap
 * something anchored to the bottom of the viewport, and it displaces the
 * editable area DOWNWARD inside the card rather than pushing it under the nav.
 * A bottom-anchored toolbar — the iOS keyboard-accessory pattern — is the one
 * that would have had to fight for that space.
 */

/**
 * The touch-target floor, in px, as a number rather than a class string.
 *
 * 44px is Apple's HIG minimum and WCAG 2.5.5's; it is a floor for BOTH axes.
 * Read by the suite so the assertion is not a re-parse of the class it checks.
 */
export const TAP_TARGET_PX = 44;

/**
 * The visual grouping, by command title.
 *
 * Titles, not TipTap command names — this is a layout decision about which
 * icons sit beside which, and the strings are the labels the slash menu already
 * shows. `groupItems` below resolves them against the items it is handed and
 * FAILS LOUDLY on a title it cannot place, so a renamed or dropped command
 * cannot silently vanish from the bar.
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
 * One button's worth of toolbar: a label, an icon, a bound action, and whether
 * the caret currently sits inside what it applies.
 *
 * `run` is already bound to the editor by the caller. Nothing in this module
 * knows what it does, which is the point.
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
   * True when the command cannot apply to the current selection.
   *
   * 🔴 There is exactly one such command today — Link — and this exists so the
   * bar cannot offer an action that would do nothing. `applyLink` chains
   * `extendMarkRange('link').setLink(...)`, which needs either a non-empty
   * selection or a caret already inside a link; with neither, it applies a mark
   * to a zero-width range and the click is silently swallowed. A button that
   * looks live and does nothing is precisely the "loud failure turned into a
   * quiet lie" this codebase has a rule about — so the precondition is shown
   * rather than discovered.
   */
  disabled?: boolean;
  /** Why it is disabled, shown in place of the hint so the block is learnable. */
  disabledReason?: string;
}

/**
 * Partition items into {@link TOOLBAR_GROUPS}, in that order.
 *
 * ─── Loud in the suite, graceful on the screen ─────────────────────────────
 *
 * A command that reaches this function without a home in `TOOLBAR_GROUPS` is a
 * developer mistake — adding to `commands` without adding to the layout — and
 * the first version of this THREW on it, on the reasoning that a bar quietly
 * rendering 17 of 18 buttons is the silent failure this repo has a rule about.
 *
 * 🔴 That was the wrong place to be loud. This runs during React's render, and
 * there is NO error boundary above the admin editor (`ErrorBoundary` is mounted
 * in `MainApp`, the member app; `AdminDashboard` and `AdminDocs` do not use
 * it). So the throw would blank the screen a church admin is writing a sermon
 * note in — losing whatever the auto-save had not yet written — to report a
 * mistake that cannot reach production anyway, because
 * `THE-279.editor-toolbar.test.tsx` pins `TOOLBAR_GROUPS.flat()` against
 * `commands` + `ALIGN_COMMANDS` and goes red first.
 *
 * So: an unplaced command is APPENDED in its own trailing group rather than
 * dropped, which keeps it reachable at every width — the property that actually
 * mattered — and a title with no matching item is skipped rather than fatal.
 * Nothing is ever silently lost, nothing ever crashes an editor, and the strict
 * correspondence is asserted where an assertion belongs.
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
   * Which fade edges to paint.
   *
   * ⚠️ A cue that is always on is as misleading as no cue: a permanent right
   * fade on a row with nothing to its right reads as a truncated toolbar just
   * as much as a truncated toolbar with no fade does. So both ends are measured
   * rather than assumed, on scroll and on mount.
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
      // 🔴 A SIBLING of <EditorContent>, never a child. `editorProps.attributes
      // .class` puts `prose prose-sm sm:prose lg:prose-lg xl:prose-2xl` on the
      // editable area, and @tailwindcss/typography styles descendants by tag —
      // a button rendered inside it inherits margins and a font size meant for
      // body copy. Rendering above and outside that container is the whole
      // reason this is a separate element rather than a TipTap FloatingMenu.
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
        // ⚠️ Every token here is unprefixed: the row behaves the same at 380px
        // and at 1440px, because "every command reachable at every width" is
        // the requirement and a responsive variant is how a set gets reduced.
        className={
          'flex items-center gap-0.5 px-1.5 py-1 ' +
          // ONE row. No `flex-wrap`, and the children below are `shrink-0`.
          'flex-nowrap ' +
          // Scrolls sideways only; see the header on why y must be hidden.
          'overflow-x-auto overflow-y-hidden overscroll-x-contain ' +
          // The fades are the cue, so the desktop gutter is not needed.
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden ' +
          '[-webkit-overflow-scrolling:touch]'
        }
      >
        {groups.map((group, groupIndex) => (
          // Keyed by the group's OWN titles, not by TOOLBAR_GROUPS[groupIndex]:
          // an unplaced command lands in a trailing group that has no entry
          // there, and indexing past the end would throw the very crash the
          // graceful fallback in `groupItems` exists to avoid.
          <React.Fragment key={group.map((i) => i.title).join('|')}>
            {groupIndex > 0 && (
              <Separator
                orientation="vertical"
                // `self-stretch` would run the rule the full 52px of the row;
                // 24px reads as a divider between icons rather than a border.
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
                // The hint becomes the REASON when the command cannot apply, so
                // a blocked button teaches its precondition instead of just
                // refusing. `aria-label` stays the plain command name.
                title={
                  item.disabled && item.disabledReason
                    ? `${item.title} — ${item.disabledReason}`
                    : `${item.title} — ${item.description}`
                }
                // `onMouseDown` + `preventDefault` is this file's existing
                // idiom (the bubble menu's five buttons do the same): it keeps
                // the editor selection alive, which a focus change would drop
                // before the command could see it.
                onMouseDown={(e) => {
                  e.preventDefault();
                  // `disabled` already suppresses click, but this handler is on
                  // mousedown, which fires on a disabled button in some engines.
                  if (item.disabled) return;
                  item.run();
                }}
                className={
                  // 🔴 44px on BOTH axes, in px, at every width. `min-w-` rather
                  // than `w-` so a future wider control can grow; the floor is
                  // what matters. `shrink-0` is what stops flex from shaving a
                  // button below the floor to fit the row.
                  //
                  // ⚠️ SPELLED LITERALLY, never interpolated from
                  // TAP_TARGET_PX. Tailwind generates utilities by scanning
                  // source text, so `h-[${N}px]` produces NO RULE — a
                  // well-formed class name that silently sizes nothing, which
                  // is the failure mode `bg-surface-gold` already cost this
                  // repo once (see the note in tailwind.config.ts). The
                  // constant and these two classes are pinned to each other by
                  // "the tap-target class agrees with TAP_TARGET_PX".
                  'h-[44px] min-w-[44px] shrink-0 ' +
                  'flex items-center justify-center rounded-lg transition-colors ' +
                  // ⚠️ Dimmed, never resized or removed: the touch floor and the
                  // "every command reachable at every width" rule both hold for
                  // a disabled button, and a button that vanished would change
                  // the bar's contents as the selection moved.
                  'disabled:opacity-40 disabled:cursor-not-allowed ' +
                  (item.active
                    // The same active treatment SlashCommandList already uses
                    // for its selected row, so the two menus agree on what
                    // "current" looks like and no new colour is introduced.
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
        The overflow affordance. `pointer-events-none` so the partially covered
        button underneath stays fully tappable — the fade is a cue, not a
        control, and it must not eat any of the 44px it sits over. Colour comes
        from --surface-raised, the card's own token, so all four palettes fade
        to the right ground.
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
