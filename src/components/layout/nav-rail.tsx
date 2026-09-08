"use client";

import * as React from 'react';
import { X } from 'lucide-react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

/**
 * THE-334 — ONE flyout at a time, and the panel takes ClickUp's shape.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * THE-332 gave every `NavRailFlyout` its OWN `open` and `pinned` state. Four
 * instances, nothing coordinating them. Press CONTENT — it pins. Hover
 * MINISTRY — it opens, and CONTENT's pin explicitly survived the hover-close
 * (`if (pinned && reason === 'trigger-hover') return`). Both panels were then
 * open, both anchored to rail buttons at different vertical offsets, so they
 * overlapped and CONTENT's single row was clipped under MINISTRY's panel. The
 * founder's screenshot is that state.
 *
 * ── How it is coordinated, and why not a primitive ──────────────────────────
 * 🔴 BASE UI HAS NO COORDINATION PRIMITIVE FOR THIS. The installed
 * `@base-ui/react/popover` ships exactly these parts — root, trigger,
 * positioner, popup, portal, arrow, backdrop, title, description, close,
 * viewport, store — and no group/roving/"only one open" wrapper of any kind.
 * So the open group is LIFTED into `NavRailProvider` above all four instances,
 * and the fix is STRUCTURAL: there is no state in which two panels are on
 * screen, whether the first was hovered or pinned.
 *
 * ── HOVER PREVIEWS, CLICK COMMITS ───────────────────────────────────────────
 * 🔴 The state is TWO slots, not one, and that is the founder's own answer to
 * two requirements that pulled against each other: "if im clicking on one, it
 * should stick there until i press on the close button or click on another
 * one" AND "if one tab is opened, i can hover over others". A single slot
 * cannot honour both — hovering would drop the pin.
 *
 *   • `pinned`  — what a CLICK committed. Survives the pointer going anywhere.
 *   • `hovered` — what the pointer is previewing right now.
 *
 * The panel on screen is `hovered ?? pinned`, so hovering a second group shows
 * it WITHOUT disturbing the pin, and the pinned panel comes BACK when the
 * pointer leaves. Still at most one visible, which is the whole ticket.
 *
 * ── What closes it ──────────────────────────────────────────────────────────
 * 🔴 A CLOSE BUTTON, or clicking another rail entry. An outside press does NOT
 * close a pinned panel, and neither does Escape — the founder was shown that
 * this drops a behaviour the ticket called non-negotiable ("Escape, an outside
 * press and focus-out all close AND unpin") and chose "close button only",
 * because the panel kept vanishing while he clicked into the page. ⚠️ THE
 * ACCESSIBILITY COST IS REAL AND IS RECORDED HERE: Escape is the standard way
 * out of a popup. It is mitigated rather than ignored — the popover is
 * NON-MODAL, so focus is never trapped and Tab still leaves the panel, and the
 * close button is a real focusable <button> with an accessible name, so there
 * IS a keyboard path out. A HOVERED (unpinned) panel still closes on
 * pointer-leave exactly as before.
 *
 * ── Why the panel is still `Popover` and not `sheet` ────────────────────────
 * 🔴 `sheet` is edge-anchored and full-height by design, and it was REJECTED,
 * because it is Base UI's DIALOG: `Dialog.Trigger` has no `openOnHover` at all,
 * so hover could only come back as the hand-rolled pointer listeners Popover
 * exists to make unnecessary — and `SheetContent` mounts a backdrop, making the
 * nav modal and the page behind it inert, which is the exact opposite of a
 * panel you keep open while you work.
 *
 * ── Why the parts, and not `PopoverContent` ─────────────────────────────────
 * ⚠️ `PopoverContent` hardcodes its Positioner (`className="isolate z-50"`, no
 * `anchor`, no arrow slot, no `collisionPadding`) and
 * `src/components/ui/popover.tsx` is DIGEST-PINNED byte-for-byte by THE-308's
 * guard, so it cannot be extended. This composes the SAME Base UI popover one
 * level down — `Portal` / `Positioner` / `Popup` / `Arrow` — while `Popover`
 * and `PopoverTrigger` are still the repo's own wrappers. Nothing here
 * positions itself and there is no `createPortal`.
 *
 * 🔴 THE ARROW IS BASE UI'S OWN PART — `Popover.Arrow`, which `ui/popover.tsx`
 * does not re-export (this ticket's STOP 6c). It is anchored to the TRIGGER, so
 * it points out of the rail entry the panel belongs to, which is the founder's
 * "look at that arrow in the clickup. it shows which tab is open".
 *
 * ── The geometry, which is all founder-specified ────────────────────────────
 * "it should not go over the header" · "there is no space between the sidebar
 * and the opened one" · "it looks like the open sidebar is coming from under
 * the first one" · "clickup sidebar has a side space in the left because its
 * actually floating".
 *
 * So the panel is inset on every side by real gaps: `collisionPadding` reserves
 * the top bar plus a float gap above, and a matching gap below and to the
 * right, while `sideOffset` is the gap between the RAIL and the panel — the
 * one whose absence made the panel look like it slid out from under the rail.
 * The popup's height is exactly the padded region, so the only placement that
 * fits is the one that clears the header and floats between the two gaps; this
 * file still computes no coordinate.
 */

/**
 * 🔴 The panel's inset, in pixels, and the ONE place these numbers live.
 *
 * `TOP` clears the desktop top bar (`h-14`, which the trimmed 14.5px desktop
 * rem base renders at 50.75px) and adds the float gap above it. `EDGE` is that
 * same float gap on the other three sides. They are exported because the
 * measured guard asserts against THEM rather than against numbers retyped in a
 * test — a changed inset moves the assertion with it instead of going stale.
 */
export const RAIL_PANEL_INSET_TOP_PX = 68;
export const RAIL_PANEL_INSET_EDGE_PX = 12;

/** Where a flyout may open on hover. Three conditions, not just a width:
 *  on a touch screen `:hover` fires on tap AND THEN STICKS, so a hover-opened
 *  panel on a phone is one the user cannot dismiss. Below `lg` the rail does
 *  not render at all. UNCHANGED by THE-334. */
export const RAIL_HOVER_QUERY =
  '(min-width: 1024px) and (hover: hover) and (pointer: fine)';

/**
 * True only where a flyout may open on hover. Starts FALSE and is raised in an
 * effect, so the server render and the first client render agree (a media query
 * has no answer during SSR) and so a touch device never gets a hover binding
 * even for one frame. UNCHANGED by THE-334.
 */
export function useRailHoverEnabled(): boolean {
  const [enabled, setEnabled] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(RAIL_HOVER_QUERY);
    const onChange = () => setEnabled(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return enabled;
}

/**
 * The state four flyouts share. TWO slots, for the reason in the docblock: a
 * click COMMITS to `pinned`, a pointer PREVIEWS into `hovered`, and the panel
 * on screen is `hovered ?? pinned` — so hovering never destroys a pin, and at
 * most one panel is ever visible.
 */
type RailOpenState = { pinned: string | null; hovered: string | null };

type NavRailContextValue = {
  /** The group whose panel is on screen, or null. AT MOST ONE. */
  visible: string | null;
  /** The group a click committed to, or null. */
  pinned: string | null;
  openGroup: (label: string, reason: string | undefined) => void;
  closeGroup: (label: string, reason: string | undefined) => void;
  /** The close button, and a rail entry dismissing its own pinned panel. */
  dismiss: () => void;
};

/** Undefined OUTSIDE a provider, which `useNavRail` turns into a throw rather
 *  than a silent fallback: a flyout rendered outside the provider would get
 *  private state again and quietly restore the exact defect this fixes. */
const NavRailContext = React.createContext<NavRailContextValue | undefined>(undefined);

function useNavRail(): NavRailContextValue {
  const ctx = React.useContext(NavRailContext);
  if (!ctx) {
    throw new Error(
      'NavRailFlyout must be rendered inside <NavRailProvider>. Without it each ' +
        'flyout would hold private open state and two could be open at once — THE-334.',
    );
  }
  return ctx;
}

/** The group whose panel a click committed to, or null. Read by the shell so
 *  the CONTENT can be pushed aside rather than covered. */
export function useNavRailPinned(): string | null {
  return useNavRail().pinned;
}

export type NavRailProviderProps = { children: React.ReactNode };

/**
 * Holds the single visible group for every flyout beneath it.
 *
 * 🔴 A press REPLACES `pinned` outright, so a pinned CONTENT cannot survive
 * MINISTRY being clicked — that is THE-334's test 2, the exact founder-visible
 * case. A hover only ever writes `hovered`, so it can never destroy a pin.
 */
export function NavRailProvider({ children }: NavRailProviderProps) {
  const [state, setState] = React.useState<RailOpenState>({ pinned: null, hovered: null });

  const openGroup = React.useCallback((label: string, reason: string | undefined) => {
    setState((prev) => {
      if (reason === 'trigger-press') {
        // Clicking the entry whose panel is already pinned closes it; clicking
        // a different one switches the pin to that group.
        const pinned = prev.pinned === label ? null : label;
        return { pinned, hovered: null };
      }
      // A hover (or a focus arriving by Tab) PREVIEWS. The pin is untouched.
      return { ...prev, hovered: label };
    });
  }, []);

  const closeGroup = React.useCallback((label: string, reason: string | undefined) => {
    setState((prev) => {
      // A SECOND PRESS on the entry whose panel is pinned closes it. Base UI
      // reports the toggle as a CLOSE with reason 'trigger-press', so this is
      // where "click it again to put it away" lives.
      if (reason === 'trigger-press') {
        if (prev.pinned === label) return { pinned: null, hovered: null };
        return prev.hovered === label ? { ...prev, hovered: null } : prev;
      }
      // The pointer leaving a previewed group returns the pinned one to screen.
      if (reason === 'trigger-hover') {
        return prev.hovered === label ? { ...prev, hovered: null } : prev;
      }
      // 🔴 EVERYTHING ELSE — Escape, an outside press, focus-out — does NOT
      // close a PINNED panel. The founder chose "close button only" after being
      // shown that this drops a behaviour the ticket called non-negotiable,
      // because the panel kept vanishing while he clicked into the page. A mere
      // PREVIEW is still cleared, so a hovered panel never outlives its
      // interaction.
      if (prev.pinned === label) return prev;
      return prev.hovered === label ? { ...prev, hovered: null } : prev;
    });
  }, []);

  const dismiss = React.useCallback(() => setState({ pinned: null, hovered: null }), []);

  const visible = state.hovered ?? state.pinned;

  const value = React.useMemo(
    () => ({ visible, pinned: state.pinned, openGroup, closeGroup, dismiss }),
    [visible, state.pinned, openGroup, closeGroup, dismiss],
  );

  return <NavRailContext.Provider value={value}>{children}</NavRailContext.Provider>;
}

/**
 * The gap the shell leaves for a PINNED panel, so the content is pushed aside
 * rather than covered — "if i click on it, it should push the content to the
 * right, not overlap it".
 *
 * 🔴 Only a PIN pushes. A hover preview floats ABOVE the content, because
 * reflowing the page under the pointer every time it crosses the rail would be
 * unusable. `w-64` + `mx-3` is the panel's own width plus the same float gap it
 * is inset by on each side, so the content starts exactly one gap past it.
 */
export function NavRailContentGap() {
  const pinned = useNavRailPinned();
  if (!pinned) return null;
  return (
    <div
      data-nav-rail-gap={pinned}
      aria-hidden
      className="hidden lg:block shrink-0 w-64 mx-3"
    />
  );
}

export type NavRailFlyoutProps = {
  /**
   * The group's IDENTITY — `CONTENT`, `MINISTRY`, `BROADCASTING`, `GROW` — as
   * `DESKTOP_NAV_GROUPS` spells it. It keys the shared open state and every
   * `data-nav-rail-*` attribute, and it is deliberately NOT what the admin
   * reads: seven pre-existing entitlement guards scan the nav by these names,
   * so renaming them to fit the rail would have been a permission-shaped edit
   * to make a typographic change.
   */
  label: string;
  /**
   * What the admin actually READS — the short word under the rail icon and the
   * panel's title. Separate from `label` for the reason above.
   */
  title: string;
  /** The rail button's contents — icon and its now-VISIBLE text label. */
  trigger: React.ReactNode;
  /** The flyout's contents — this group's permitted tabs, already rendered. */
  children: React.ReactNode;
  /** Marks the rail button when the active tab lives inside this group. */
  isActive?: boolean;
  triggerClassName?: string;
  /**
   * The pinned bottom block, rendered under a separator at the panel's floor.
   *
   * ⚠️ The founder asked for "the recent things like in clickup — latest notes,
   * latest forms". ClickUp's own footer in his reference is "Brain AI uses /
   * Credits left", which he ruled out himself ("it's their AI, we don't have
   * such thing yet"), so this slot holds the RECENTS instead of an invented
   * usage meter — real data, always at the floor, never scrolled away.
   *
   * 🔴 A NODE rather than a data prop, so whatever fetches it mounts INSIDE the
   * popup and therefore only runs while a panel is actually open. A group with
   * no recency source (GROW) passes nothing and gets no footer and no
   * separator, rather than a footer that has to invent something to say.
   */
  footer?: React.ReactNode;
};

/**
 * One rail entry and its flyout.
 *
 * Open state is READ FROM THE PROVIDER, not held here. That is the fix: this
 * component no longer owns whether it is open, so it cannot disagree with its
 * three siblings about how many panels are on screen.
 */
export function NavRailFlyout({
  label,
  title,
  trigger,
  children,
  isActive = false,
  triggerClassName = '',
  footer,
}: NavRailFlyoutProps) {
  const hoverEnabled = useRailHoverEnabled();
  const { visible, pinned, openGroup, closeGroup, dismiss } = useNavRail();
  const open = visible === label;
  const isPinned = pinned === label;

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen, eventDetails) => {
        const reason = eventDetails?.reason;
        if (nextOpen) openGroup(label, reason);
        else closeGroup(label, reason);
      }}
    >
      <PopoverTrigger
        openOnHover={hoverEnabled}
        delay={120}
        closeDelay={200}
        aria-label={title}
        data-nav-rail-group={label}
        data-pinned={isPinned ? 'true' : undefined}
        className={triggerClassName}
        data-active={isActive ? 'true' : undefined}
      >
        {trigger}
      </PopoverTrigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          side="right"
          align="center"
          /* 🔴 THE GAP BETWEEN THE RAIL AND THE PANEL — the one whose absence
             made the panel look like it slid out from under the rail. */
          sideOffset={RAIL_PANEL_INSET_EDGE_PX}
          /* 🔴 Reserves the top bar plus a float gap ABOVE the panel, and the
             same gap on the other three sides, so it never goes over the
             header and reads as floating rather than butted against an edge. */
          collisionPadding={{
            top: RAIL_PANEL_INSET_TOP_PX,
            bottom: RAIL_PANEL_INSET_EDGE_PX,
            left: RAIL_PANEL_INSET_EDGE_PX,
            right: RAIL_PANEL_INSET_EDGE_PX,
          }}
          className="isolate z-50"
        >
          <PopoverPrimitive.Popup
            data-slot="popover-content"
            data-nav-rail-flyout={label}
            data-nav-rail-pinned={isPinned ? 'true' : undefined}
            /* `w-64` is sidebar.tsx's own SIDEBAR_WIDTH of 16rem — the width the
               EXPANDED sidebar always had, unchanged by this ticket. The HEIGHT
               is exactly the region the collision padding leaves, so the only
               placement that fits is the one that clears the header and floats
               between the gaps. ⚠️ NOT `overflow-hidden`: that clipped the arrow
               against the panel's own edge, which is why the founder could not
               see it. The scroller inside does its own clipping instead. */
            className="w-64 h-[calc(100dvh-80px)] flex flex-col rounded-xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-hidden"
          >
            {/* 🔴 Base UI's OWN arrow part, anchored to the trigger, so it
                points out of the rail entry this panel belongs to.
                ⚠️ It draws an SVG TRIANGLE, not a rotated square. The square
                carried `ring-1` on all four sides, so its two inner edges drew a
                line straight across the panel and it read as a diamond with a
                seam through it — "the arrow looks weird". The triangle fills
                with the panel's own surface and strokes only its two SLANTED
                edges, so the panel's ring runs into the point and stops. It
                overlaps the panel's edge by 1px (`-left-[9px]` against a 10px
                box) so no seam shows where the two meet. */}
            <PopoverPrimitive.Arrow
              data-nav-rail-arrow={label}
              className="z-[1] data-[side=right]:-left-[9px]"
            >
              <svg width="10" height="20" viewBox="0 0 10 20" fill="none" aria-hidden="true">
                <path d="M10 0 L0 10 L10 20 Z" className="fill-popover" />
                <path
                  d="M10 0 L0 10 L10 20"
                  className="stroke-foreground/10"
                  strokeWidth="1"
                  fill="none"
                />
              </svg>
            </PopoverPrimitive.Arrow>

            {/* 🔴 THE TITLE ROW, with the CLOSE BUTTON the founder asked for —
                "it should stick there until i press on the close button". */}
            <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2 shrink-0">
              <PopoverPrimitive.Title
                data-nav-rail-title={label}
                className="text-base font-semibold text-strong truncate"
              >
                {title}
              </PopoverPrimitive.Title>
              <button
                type="button"
                onClick={dismiss}
                aria-label={`Close ${title}`}
                data-nav-rail-close={label}
                /* 🔴 A real focusable <button> with an accessible name. With
                   Escape no longer closing a pinned panel, this IS the keyboard
                   path out, so it may not become an icon with no name. */
                className="shrink-0 flex items-center justify-center rounded-lg size-7 text-muted hover:text-strong hover:bg-surface-sunken transition-all"
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>

            <Separator data-nav-rail-separator="title" className="shrink-0" />

            {/* The sections. `flex-1 min-h-0` + `ScrollArea` is what makes a
                nine-tab group (MINISTRY) survive a short viewport: the list
                scrolls INSIDE the full-height panel instead of clipping. */}
            <ScrollArea className="flex-1 min-h-0">
              <div data-nav-rail-sections={label} className="flex flex-col gap-0.5 p-2">
                {children}
              </div>
            </ScrollArea>

            {footer && (
              <>
                <Separator data-nav-rail-separator="footer" className="shrink-0" />
                {/* 🔴 PINNED TO THE BOTTOM — `shrink-0`, and OUTSIDE the
                    ScrollArea above, so however long the section list grows this
                    block stays at the panel's floor instead of scrolling away. */}
                <div data-nav-rail-footer={label} className="shrink-0 p-2 pt-1.5">
                  {footer}
                </div>
              </>
            )}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </Popover>
  );
}
