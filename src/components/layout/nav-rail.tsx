"use client";

import * as React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * THE-332 — the desktop admin nav becomes a RAIL WITH FLYOUTS.
 *
 * The defect: `AdminDashboard.tsx` rendered all 23 permitted tabs at once, in
 * four collapsible headings inside one column that scrolled internally. The
 * founder asked for ClickUp's shape instead — "instead of having all of the
 * features in the sidebar, lets put the categories and when hovering over, to
 * appear like in the screenshots attached" — and, asked whether that meant
 * hover or click, answered "both".
 *
 * ── Why Popover and not hover-card ───────────────────────────────────────────
 * This repo's primitives are BASE UI (@base-ui/react), not Radix, and Base UI's
 * Popover already ships the exact combination this ticket needs, so none of it
 * is hand-rolled:
 *
 *   • `openOnHover` on the TRIGGER (with `delay` / `closeDelay`) gives hover.
 *   • The trigger is a real <button>, so Enter and Space open it as a press,
 *     and Base UI moves focus into the popup, keeps Tab inside it, and returns
 *     focus to the trigger on Escape. That is the whole keyboard path, and it
 *     is the primitive's, not ours.
 *   • `onOpenChange` reports WHY it changed — 'trigger-hover' vs
 *     'trigger-press' — which is what lets a click PIN a flyout that a hover
 *     would have closed. Without that reason we would be diffing pointer
 *     events by hand to tell the two apart.
 *
 * Rejected, with reasons rather than "it did not fit":
 *   • `hover-card` — purpose-built for hover, but it has no press semantics and
 *     therefore nothing to pin: a click on its trigger is not an open reason it
 *     reports, so requirement "click opens it too, and pins it" cannot be built
 *     on it without adding the very hand-rolled listeners Popover makes
 *     unnecessary. It is also documented for non-interactive preview content,
 *     and these flyouts are the ONLY way to reach 21 of the 23 tabs.
 *   • `dropdown-menu` — its items are `menuitem`s with roving focus and
 *     typeahead. That would swallow single-letter keys and give every nav
 *     destination menu semantics it does not have (these are tabs in a nav, not
 *     commands in a menu), and it closes on pointer-leave with no pin.
 *   • `tooltip` — non-interactive by role. That is precisely the defect being
 *     fixed: collapsed today means a `title` attribute, which no keyboard and
 *     no touch device can open.
 *
 * ── Why hover is gated, and on what ──────────────────────────────────────────
 * On a touch screen `:hover` fires on tap AND THEN STICKS, so a hover-opened
 * flyout on a phone is a panel the user cannot dismiss. The gate is therefore
 * three conditions, not just a width: at least `lg`, a device that really
 * hovers, and a fine pointer. Below `lg` the rail does not render at all — the
 * mobile bottom nav and its More sheet are untouched by this ticket — so the
 * width term is belt and braces for a desktop browser resized down.
 */
export const RAIL_HOVER_QUERY =
  '(min-width: 1024px) and (hover: hover) and (pointer: fine)';

/**
 * True only where a flyout may open on hover. Starts FALSE and is raised in an
 * effect, so the server render and the first client render agree (a media query
 * has no answer during SSR) and so a touch device never gets a hover binding
 * even for one frame.
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

export type NavRailFlyoutProps = {
  /** The group heading this rail entry stands for (CONTENT, MINISTRY, …). */
  label: string;
  /** The rail button's contents — icon, and the visually hidden label. */
  trigger: React.ReactNode;
  /** The flyout's contents — this group's permitted tabs, already rendered. */
  children: React.ReactNode;
  /** Marks the rail button when the active tab lives inside this group. */
  isActive?: boolean;
  triggerClassName?: string;
};

/**
 * One rail entry and its flyout.
 *
 * Open state is controlled here rather than left to the primitive ONLY because
 * of pinning: a hover-close must be ignored while pinned, and every other close
 * reason (Escape, an outside press, focus leaving) must both close and unpin.
 */
export function NavRailFlyout({
  label,
  trigger,
  children,
  isActive = false,
  triggerClassName = '',
}: NavRailFlyoutProps) {
  const hoverEnabled = useRailHoverEnabled();
  const [open, setOpen] = React.useState(false);
  const [pinned, setPinned] = React.useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen, eventDetails) => {
        const reason = eventDetails?.reason;
        if (nextOpen) {
          // A press pins; a hover (or a focus arriving by Tab) does not.
          if (reason === 'trigger-press') setPinned(true);
          setOpen(true);
          return;
        }
        // Pinned flyouts survive the pointer leaving. They do NOT survive
        // Escape, an outside press, focus-out, or a second press on the
        // trigger — all of which arrive here with a different reason.
        if (pinned && reason === 'trigger-hover') return;
        setPinned(false);
        setOpen(false);
      }}
    >
      <PopoverTrigger
        openOnHover={hoverEnabled}
        delay={120}
        closeDelay={200}
        aria-label={label}
        data-nav-rail-group={label}
        data-pinned={pinned ? 'true' : undefined}
        className={triggerClassName}
        data-active={isActive ? 'true' : undefined}
      >
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        data-nav-rail-flyout={label}
        // The flyout is exactly the width the EXPANDED sidebar was — `w-64`,
        // i.e. sidebar.tsx's own SIDEBAR_WIDTH of 16rem. No width is invented
        // here: the rows inside it are the same rows, at the same measure, that
        // this nav has always drawn.
        className="w-64 flex flex-col gap-0.5 p-2"
      >
        <div className="px-3 pb-1 text-[10px] font-bold tracking-[0.14em] text-faint uppercase">
          {label}
        </div>
        {children}
      </PopoverContent>
    </Popover>
  );
}
