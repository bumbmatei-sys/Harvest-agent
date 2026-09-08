"use client";

import * as React from 'react';
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
 * founder's screenshot is that state. The `delay={120}` / `closeDelay={200}`
 * pair is a real second-order overlap, but on its own it flickers; the PIN is
 * what made it persist long enough to screenshot.
 *
 * ── How it is coordinated, and why not a primitive ──────────────────────────
 * 🔴 BASE UI HAS NO COORDINATION PRIMITIVE FOR THIS. The installed
 * `@base-ui/react/popover` ships exactly these parts — root, trigger,
 * positioner, popup, portal, arrow, backdrop, title, description, close,
 * viewport, store — and no group/roving/"only one open" wrapper of any kind
 * (Base UI has `Menu` groups, but those group ITEMS inside one menu, not
 * sibling popovers). So the open group is LIFTED into one `openGroup:
 * string | null` here, held by `NavRailProvider` above all four instances.
 *
 * 🔴 That makes the fix STRUCTURAL, not a race to win: `openGroup` holds one
 * value, so opening a second group closes the first BY CONSTRUCTION — there is
 * no state in which two are open, whether the first was hovered or pinned.
 * Restoring per-instance state is what THE-334's test 1 fails on.
 *
 * Two ordering hazards the single value has to survive, both handled in
 * `closeGroup`:
 *   • A STALE CLOSE. Hovering MINISTRY opens it, and CONTENT's popover then
 *     fires its own close AFTER. A close from a group that is no longer the
 *     open one is ignored, or it would blank the panel that just opened.
 *   • THE PIN. A pinned group survives the POINTER LEAVING ('trigger-hover')
 *     and nothing else — Escape, an outside press, focus-out and a second
 *     press all arrive with a different reason and both close AND unpin.
 *
 * ── Why the panel is still `Popover` and not `sheet` ────────────────────────
 * 🔴 `sheet` is edge-anchored and full-height by design, and it was REJECTED,
 * because it is Base UI's DIALOG: `Dialog.Trigger` has no `openOnHover` at all,
 * so hover could only come back as the hand-rolled pointer listeners Popover
 * exists to make unnecessary — and `SheetContent` mounts a `SheetOverlay`
 * backdrop, making the nav modal and the page behind it inert. Hover, press and
 * pin are requirements, so the primitive that reports `trigger-press` vs
 * `trigger-hover` stays. Everything below is a SHAPE change on the same
 * mechanism; not one line of the open/close contract moved to get it.
 *
 * ── Why the parts, and not `PopoverContent` ─────────────────────────────────
 * ⚠️ `PopoverContent` hardcodes its Positioner (`className="isolate z-50"`,
 * no `anchor`, no arrow slot) and `src/components/ui/popover.tsx` is DIGEST-
 * PINNED byte-for-byte by THE-308's guard, so it cannot be extended to expose
 * them. A full-height panel with a pointer therefore composes the SAME Base UI
 * popover one level down — `Portal` / `Positioner` / `Popup` / `Arrow` — while
 * `Popover` and `PopoverTrigger` are still the repo's own wrappers (both are
 * pass-throughs, so nothing is lost by keeping them). This is the same library
 * the wrapper wraps, not hand-written markup: nothing here positions itself,
 * there is no `createPortal`, and `src/components/reui/cascader/*` already
 * composes Base UI at this level.
 *
 * 🔴 THE ARROW IS BASE UI'S OWN PART, not a drawn triangle — `Popover.Arrow`,
 * which the repo's `ui/popover.tsx` does not re-export (reported as THE-334's
 * STOP 6c). It is anchored to the TRIGGER, so it points out of the rail entry
 * the panel belongs to, and Base UI keeps it on the anchor when the popup
 * shifts.
 *
 * ── How it is full height without inventing a measure ───────────────────────
 * The popup asks for the viewport's own height less the collision padding at
 * top and bottom. Base UI's default `collisionAvoidance` shifts along the
 * ALIGNMENT axis (vertical, for `side="right"`), and for a popup that tall
 * exactly one placement satisfies the viewport — so it settles floor to
 * ceiling deterministically, at every rail entry, without this file computing
 * a single coordinate. The WIDTH is untouched at `w-64`: sidebar.tsx's own
 * SIDEBAR_WIDTH of 16rem, as THE-332 recorded. No width is invented here.
 */

/** Where a flyout may open on hover. Three conditions, not just a width:
 *  on a touch screen `:hover` fires on tap AND THEN STICKS, so a hover-opened
 *  panel on a phone is one the user cannot dismiss. Below `lg` the rail does
 *  not render at all, so the width term is belt and braces for a desktop
 *  browser resized down. UNCHANGED by THE-334. */
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

/** The one piece of state four flyouts share. `open` is the group whose panel
 *  is on screen — AT MOST ONE, which is the whole ticket — and `pinned` is that
 *  same group when a PRESS opened it, or null. `pinned` can never name a group
 *  that is not `open`, because both are written together. */
type RailOpenState = { open: string | null; pinned: string | null };

type NavRailContextValue = {
  openState: RailOpenState;
  openGroup: (label: string, reason: string | undefined) => void;
  closeGroup: (label: string, reason: string | undefined) => void;
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

export type NavRailProviderProps = { children: React.ReactNode };

/**
 * Holds the single open group for every flyout beneath it.
 *
 * 🔴 `openGroup` REPLACES the whole state rather than merging into it, so a
 * press-pinned CONTENT cannot survive MINISTRY opening: the new group's label
 * and its own pin status are written together, and there is no second slot for
 * the old one to sit in. That is THE-334's test 2 — the exact founder-visible
 * case — and it holds for hover and press alike.
 */
export function NavRailProvider({ children }: NavRailProviderProps) {
  const [openState, setOpenState] = React.useState<RailOpenState>({ open: null, pinned: null });

  const openGroup = React.useCallback((label: string, reason: string | undefined) => {
    // A press pins; a hover (or a focus arriving by Tab) does not.
    setOpenState({ open: label, pinned: reason === 'trigger-press' ? label : null });
  }, []);

  const closeGroup = React.useCallback((label: string, reason: string | undefined) => {
    setOpenState((prev) => {
      // A close from a group that is no longer the open one is STALE — it is
      // the previous panel reacting to a pointer that has already moved on —
      // and applying it would blank the panel that just opened.
      if (prev.open !== label) return prev;
      // Pinned panels survive the POINTER LEAVING and nothing else. Escape, an
      // outside press, focus-out and a second press on the trigger all arrive
      // with a different reason, and each both closes AND unpins.
      if (prev.pinned === label && reason === 'trigger-hover') return prev;
      return { open: null, pinned: null };
    });
  }, []);

  const value = React.useMemo(
    () => ({ openState, openGroup, closeGroup }),
    [openState, openGroup, closeGroup],
  );

  return <NavRailContext.Provider value={value}>{children}</NavRailContext.Provider>;
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
  const { openState, openGroup, closeGroup } = useNavRail();
  const open = openState.open === label;
  const pinned = openState.pinned === label;

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
        data-pinned={pinned ? 'true' : undefined}
        className={triggerClassName}
        data-active={isActive ? 'true' : undefined}
      >
        {trigger}
      </PopoverTrigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          side="right"
          align="center"
          sideOffset={12}
          collisionPadding={12}
          className="isolate z-50"
        >
          <PopoverPrimitive.Popup
            data-slot="popover-content"
            data-nav-rail-flyout={label}
            /* `w-64` is sidebar.tsx's own SIDEBAR_WIDTH of 16rem — the width the
               EXPANDED sidebar always had, unchanged by this ticket, so the rows
               inside keep their measure. The HEIGHT is the viewport's own, less
               the collision padding at each end: the panel is floor to ceiling
               at every rail entry, and this file computes no coordinate to get
               there. `rounded-xl`, the ring and the shadow are what make it read
               as a FLOATING panel, detached from both rail and page. */
            className="w-64 h-[calc(100dvh-1.5rem)] flex flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-hidden"
          >
            {/* 🔴 Base UI's OWN arrow part, anchored to the trigger, so it
                points out of the rail entry this panel belongs to. */}
            <PopoverPrimitive.Arrow
              data-nav-rail-arrow={label}
              className="data-[side=right]:-left-[7px] size-3.5 rotate-45 rounded-[2px] bg-popover ring-1 ring-foreground/10"
            />

            {/* 🔴 THE TITLE ROW. THE-332 drew a 10px uppercase micro-label, and
                the founder's complaint is that it does not read as a title. This
                is Base UI's own `Title` part at text-base/semibold — the same
                size and weight `SheetTitle` gives a panel heading — so it reads
                as the name of the place you are in. */}
            <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2 shrink-0">
              <PopoverPrimitive.Title
                data-nav-rail-title={label}
                className="text-base font-semibold text-strong truncate"
              >
                {title}
              </PopoverPrimitive.Title>
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
                    block stays at the panel's floor instead of scrolling away.
                    That is the "settings is too low" complaint's real shape: a
                    thing you always want is not a thing you scroll to. */}
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
