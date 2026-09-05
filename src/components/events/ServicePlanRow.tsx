"use client";
/**
 * THE-313 — ONE ROW of the order of service, and the four class strings the
 * whole panel is spelled from.
 *
 * ⚠️ SPLIT OUT OF `ServicePlanPanel.tsx` FOR A REASON, and the reason is the
 * one `THE-304.form-options-layout.test.tsx` opens by lamenting: a layout suite
 * that renders a REPLICA of the screen can only measure the replica, so it
 * needs a second assertion pinning the replica's class strings against the real
 * file and it drifts the moment somebody edits one and not the other. This
 * module imports NO Firestore, NO react-query and NO app store — only React,
 * lucide icons and `form-layout.ts` — so both the behaviour suite and the
 * Chromium layout suite mount THE REAL COMPONENT and measure what ships.
 *
 * Nothing else in the app imports it; `ServicePlanPanel` is the only consumer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 TAP TARGETS: 44px BELOW `sm`, RULE 4's 38px ABOVE, AND THAT IS NOT A
 * CONTRADICTION.
 *
 * Below `sm` every control here is `min-h-[44px]` and every icon control is
 * `min-w-[44px]` too — the drag handle included, because a handle nobody can
 * hit is a handle nobody can use. From `sm` up, Rule 4 (`form-layout.ts`) fixes
 * a control at 38px and `DENSITY_PX.control < 44` is asserted there ON PURPOSE:
 * a pointer at a desktop is not a thumb. So `min-h-[44px] sm:min-h-0` sits next
 * to `CONTROL_DENSITY.control` on every control, which is the two rules
 * agreeing rather than fighting.
 *
 * ⚠️ AND EVERY CONTROL IS `basis-full sm:basis-auto`. At 380px the row has
 * about 348px of content box; a handle, a clock, a title, a duration, a person
 * and a remove button on one line would leave the title under 150px and push
 * the card past the viewport. So below `sm` each control takes its own line at
 * full width — which is also what guarantees the 44px height without inventing
 * a width, since `form-layout.ts` owns every width in this app and has no
 * sub-`sm` spelling by design.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 THE DRAG IS #413's MECHANISM AND THE HANDLERS COME FROM THE PANEL.
 *
 * This component only WIRES `onDragStart` / `onDragEnter` / `onDragEnd` onto
 * the row — there is no `onDragOver` and no `onDrop` to wire, because #413
 * (THE-186) established that the commit rides on `dragend` and that
 * `stopPropagation` is split by event type. The refs and the commit live in
 * `ServicePlanPanel.tsx`, which is where that note is.
 *
 * 🔴 THE KEYBOARD REORDER LIVES HERE, on the handle, and it is not a fallback:
 * a reorder that only works by mouse is unusable on this product's primary
 * platform. ArrowUp / ArrowDown, `preventDefault`ed so the page does not scroll
 * away from the item being moved.
 */
import React from 'react';
import { GripVertical, Trash2 } from 'lucide-react';

import { FIELD_WIDTH, CONTROL_DENSITY } from '../layout/form-layout';
import { clampMinutes, type ServicePlanItem } from './service-plan';
import type { ServicePerson } from '../../hooks/queries/useServicePlanQueries';

/**
 * Below `sm` a control takes its own line, so it is full width and at least
 * 44px tall. From `sm` it sits inline under Rule 2's cap and Rule 4's height.
 * Spelled once so the four control kinds cannot drift apart.
 */
export const CONTROL_BASE =
  'basis-full sm:basis-auto min-w-0 px-3 py-2 border border-line rounded-lg text-sm ' +
  `bg-surface-raised text-body focus:outline-hidden focus:border-gold min-h-[44px] sm:min-h-0 ${CONTROL_DENSITY.control}`;

/**
 * An icon-only control — the drag handle and the remove button.
 *
 * 44px square below `sm`. From `sm` the WIDTH collapses to the icon plus its
 * padding, but the HEIGHT takes `CONTROL_DENSITY.control` — Rule 4's named
 * 38px — rather than collapsing with it. ⚠️ Measured: without that token these
 * came out 23.25px tall beside 38px inputs on the same row, which is a third
 * height in a module whose whole point is that there is one. `form-layout.ts`
 * gives a height and no width, so this spells no number of its own.
 */
export const ICON_CONTROL =
  'shrink-0 inline-flex items-center justify-center min-h-[44px] min-w-[44px] ' +
  `sm:min-h-0 sm:min-w-0 sm:p-1 rounded-lg ${CONTROL_DENSITY.control}`;

/** An inline text button — add, share, copy, save as template. */
export const TEXT_BUTTON =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-line ' +
  `text-body hover:bg-surface-sunken min-h-[44px] sm:min-h-0 disabled:opacity-40 ${CONTROL_DENSITY.action}`;

/**
 * 🔴 The clearance the admin shell's safe-area padding class does not provide —
 * it compiles to no rule in this app. See ServicePlanPanel.tsx's header.
 */
export const NAV_CLEARANCE = 'pb-[120px] lg:pb-0';

export interface RowProps {
  item: ServicePlanItem;
  index: number;
  clock: string;
  people: ServicePerson[];
  onChange: (next: ServicePlanItem) => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnter: () => void;
  onDragEnd: (e: React.DragEvent<HTMLDivElement>) => void;
}

export const ItemRow: React.FC<RowProps> = ({
  item, index, clock, people,
  onChange, onRemove, onMove, onDragStart, onDragEnter, onDragEnd,
}) => {
  const label = item.title.trim() || `item ${index + 1}`;

  /**
   * 🔴 The keyboard reorder. ArrowUp / ArrowDown, `preventDefault`ed so the
   * page does not scroll away from the item the user is moving.
   */
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    onMove(e.key === 'ArrowUp' ? -1 : 1);
  };

  return (
    <div
      data-plan-row={index}
      draggable
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragEnd={onDragEnd}
      className="flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-surface-raised p-2"
    >
      <button
        type="button"
        data-plan-handle={index}
        aria-label={`Move ${label}`}
        aria-keyshortcuts="ArrowUp ArrowDown"
        onKeyDown={onKeyDown}
        className={`${ICON_CONTROL} cursor-grab text-faint hover:text-body hover:bg-surface-sunken`}
      >
        <GripVertical size={16} />
      </button>

      <span data-plan-clock={index} className="shrink-0 text-xs font-semibold tabular-nums text-muted">
        {clock}
      </span>

      <input
        data-plan-title={index}
        value={item.title}
        aria-label={`Title of item ${index + 1}`}
        placeholder="What happens here"
        onChange={(e) => onChange({ ...item, title: e.target.value })}
        className={`${CONTROL_BASE} sm:flex-1 ${FIELD_WIDTH.long}`}
      />

      <input
        data-plan-minutes={index}
        type="number"
        min={0}
        inputMode="numeric"
        value={item.minutes}
        aria-label={`Minutes for ${label}`}
        onChange={(e) => onChange({ ...item, minutes: clampMinutes(e.target.value) })}
        className={`${CONTROL_BASE} ${FIELD_WIDTH.short}`}
      />

      <select
        data-plan-person={index}
        value={item.personId ?? ''}
        aria-label={`Person for ${label}`}
        onChange={(e) => {
          const id = e.target.value || null;
          const person = people.find((p) => p.id === id);
          onChange({ ...item, personId: id, personName: person ? person.name : null });
        }}
        className={`${CONTROL_BASE} ${FIELD_WIDTH.medium}`}
      >
        <option value="">Nobody yet</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>

      <button
        type="button"
        data-plan-remove={index}
        aria-label={`Remove ${label}`}
        onClick={onRemove}
        className={`${ICON_CONTROL} text-faint hover:text-red-600 hover:bg-surface-sunken`}
      >
        <Trash2 size={15} />
      </button>

      <input
        data-plan-note={index}
        value={item.note ?? ''}
        aria-label={`Note for ${label}`}
        placeholder="Note (optional)"
        onChange={(e) => onChange({ ...item, note: e.target.value || null })}
        className={`${CONTROL_BASE} basis-full sm:basis-full`}
      />
    </div>
  );
};
