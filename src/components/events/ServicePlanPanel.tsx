"use client";
/**
 * THE-313 — the order of service, rendered against an event.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE REORDER. DRAG IS #413's MECHANISM, VERBATIM. KEYBOARD IS ITS EQUAL.
 *
 * ── The drag half ────────────────────────────────────────────────────────────
 *
 * ⚠️ THERE IS NO `onDragOver` AND NO `onDrop` HERE, AND THAT IS DELIBERATE.
 * `AdminCourseEditor.tsx` settled this shape in #413 (THE-186) and this file
 * does not invent a second one:
 *
 *   · `onDragStart` — `stopPropagation()`, and record the index being dragged.
 *   · `onDragEnter`  — deliberately does NOT stop propagation. An ancestor
 *     legitimately needs to see a `dragenter` fired inside its descendants, so
 *     instead each depth ignores an enter it did not start, via
 *     `dragging.current === null`. Stopping this one outright is what broke
 *     level reordering there and would break nothing here today only because
 *     this list is not nested YET — part 2 adds a second depth to exactly these
 *     rows, so the rule is followed now rather than rediscovered later.
 *   · `onDragEnd`   — `stopPropagation()`, and COMMIT. The commit rides on
 *     `dragend`, not on `drop`.
 *
 * 🔴 And the commit goes through the UPDATER FORM — `setItems(prev => …)` —
 * so it resolves against the live value at flush time rather than a closure
 * snapshot taken when this render ran. That is #413's second half, and it is
 * why a reorder cannot be silently reverted by a stale write.
 *
 * ⚠️ `@dnd-kit` is NOT used. See the report: it IS listed in `package.json`
 * (`@dnd-kit/core`, `/sortable`, `/utilities`) — the ticket's premise that it
 * is absent is wrong — and `AdminNavCustomizer.tsx` imports it. It is still not
 * used here, because #413's mechanism is the one this repo has debugged, and
 * adopting a second reorder idiom for the second list in the admin app is how a
 * codebase ends up with two.
 *
 * ── The keyboard half, which is not a fallback ───────────────────────────────
 *
 * 🔴 THE PATH: Tab reaches every item's reorder handle, which is a real
 * `<button>` in document order carrying `aria-label="Move <title>"` and
 * `aria-keyshortcuts="ArrowUp ArrowDown"`. ArrowUp moves the item one position
 * earlier, ArrowDown one later, both `preventDefault()`ed so the page does not
 * scroll under the user. Focus SURVIVES the move because every row is keyed by
 * `item.id` — React relocates the existing DOM node rather than rebuilding it,
 * so the focused button is the same element after the reorder and a held key
 * keeps walking the item down the list. First-item-up and last-item-down are
 * no-ops rather than wraps.
 *
 * A drag-only reorder is unusable on this product's primary platform: an admin
 * doing this on a phone at the side of a stage has no drag affordance worth the
 * name, and a keyboard user has none at all.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 TAP TARGETS, AND THE 44/38 SPLIT THAT IS NOT A CONTRADICTION.
 *
 * Below `sm` every control here is `min-h-[44px]` / `min-w-[44px]` — the handle
 * and the remove button included, because a drag handle nobody can hit is a
 * drag handle nobody can use. From `sm` up, Rule 4 (`form-layout.ts`) fixes a
 * control at 38px and `DENSITY_PX.control < 44` is asserted there ON PURPOSE:
 * a pointer at a desktop is not a thumb. So every control carries
 * `min-h-[44px] sm:min-h-0` next to `CONTROL_DENSITY.control`, which is the two
 * rules agreeing rather than fighting.
 *
 * 🔴 BOTTOM-NAV CLEARANCE, MADE EXPLICIT. The admin shell's nav is
 * `fixed bottom-0 w-full z-[100]` (`AdminDashboard.tsx`) and the safe-area
 * padding class it carries COMPILES TO NOTHING — neither `globals.css` nor the
 * Tailwind config defines it, and #437 fixed that for the MEMBER shell only.
 * The admin shell still carries the inert class. So the clearance below the
 * last item is spelled here: `pb-[120px] lg:pb-0`, the same 120px
 * `AdminForms.tsx` already uses for the same nav, on top of the shell's own
 * `pb-24`. It is vertical padding, not a width — `form-layout.ts` owns widths
 * and control density and has nothing to say about it.
 *
 * ⚠️ The class is deliberately NOT NAMED by its literal here, and THE-295's
 * register is why: that guard enumerates every file spelling it, and THE-300
 * found that quoting it in a LIVE component's prose puts that component into
 * the register for what is only a comment. It said the same thing without the
 * literal instead, and so does this. `THE-313.service-plan.layout.test.tsx`
 * carries the literal, because it replicates the nav to measure against.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ⚠️ NO NEW PRIMITIVE IS ADOPTED. This panel spells plain elements with the
 * same Tailwind vocabulary `AdminEvents.tsx` already uses (205 `className` to
 * 7 inline styles), and imports NOTHING from `src/components/ui/`. So no
 * adopter list moves: THE-272's closed lists for `chart` / `table` /
 * `pagination` / `progress` and THE-274's `RECORDED_ADOPTERS` are untouched,
 * and the guards in `the-313-guards.test.ts` assert that this file adopts none.
 * Appending an unneeded entry to a closed list would be a claim that is not
 * true, which is worse than a list that does not mention this ticket.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, ListOrdered, Plus, Share2, Trash2 } from 'lucide-react';

import { notifyError } from '../../utils/notify';
import { FIELD_WIDTH } from '../layout/form-layout';
import { CONTROL_BASE, ItemRow, NAV_CLEARANCE, TEXT_BUTTON } from './ServicePlanRow';
import {
  DEFAULT_ITEM_MINUTES,
  MAX_PLAN_ITEMS,
  buildRunSheetText,
  emptyItem,
  fmtClock,
  fmtDuration,
  itemClockTimes,
  moveItem,
  orderedItems,
  planEndsAt,
  planTotalMinutes,
  renumber,
  planFromTemplate,
  reorderItems,
  templateFromPlan,
  type ServicePlanItem,
} from './service-plan';
import {
  createServicePlan,
  deleteServicePlan,
  saveServicePlanItems,
  useInvalidateServicePlans,
  useServicePeople,
  useServicePlan,
  useServicePlanTemplates,
} from '../../hooks/queries/useServicePlanQueries';

export interface ServicePlanPanelProps {
  tenantId: string | null;
  eventId: string;
  eventTitle: string;
  /** The EVENT's start. A plan carries no start of its own — see `service-plan.ts`. */
  startsAt: Date | null;
}

const ServicePlanPanel: React.FC<ServicePlanPanelProps> = ({
  tenantId, eventId, eventTitle, startsAt,
}) => {
  const { data: plan = null, isLoading, error } = useServicePlan(tenantId, eventId);
  const { data: templates = [] } = useServicePlanTemplates(tenantId);
  const { data: people = [] } = useServicePeople(tenantId);
  const invalidate = useInvalidateServicePlans();

  const [items, setItems] = useState<ServicePlanItem[]>([]);
  const [name, setName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [templateId, setTemplateId] = useState('');

  /* `navigator.share` is read in an effect, never during render — the same
   * reason `GivingShareSheet.tsx` gives: it is absent on the server and a
   * render-time read makes the first client paint disagree with the markup. */
  useEffect(() => {
    setCanNativeShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  useEffect(() => {
    if (!plan) { setItems([]); setName(''); setDirty(false); return; }
    setItems(orderedItems(plan.items));
    setName(plan.name);
    setDirty(false);
  }, [plan]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  /** Every commit goes through this, so `dirty` cannot be forgotten. */
  const commit = useCallback((next: (prev: ServicePlanItem[]) => ServicePlanItem[]) => {
    setItems((prev) => next(prev));
    setDirty(true);
  }, []);

  /* ── #413's drag mechanism. No onDragOver, no onDrop. ───────────────────── */
  const dragging = useRef<number | null>(null);
  const dragOver = useRef<number | null>(null);

  const onDragEnd = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (dragging.current === null || dragOver.current === null) return;
    const from = dragging.current;
    const to = dragOver.current;
    dragging.current = null;
    dragOver.current = null;
    if (from === to) return;
    // The updater form: resolved against the live list at flush time.
    commit((prev) => reorderItems(prev, from, to));
  }, [commit]);

  const clocks = useMemo(() => itemClockTimes(items, startsAt), [items, startsAt]);
  const totalMinutes = planTotalMinutes(items);
  const endsAt = planEndsAt(items, startsAt);
  const runSheet = useMemo(
    () => buildRunSheetText(name || eventTitle, items, startsAt),
    [name, eventTitle, items, startsAt],
  );

  const startPlan = async (fromTemplateId: string) => {
    if (!tenantId) { notifyError('Unable to determine your tenant. Please refresh.', null); return; }
    setBusy(true);
    try {
      const template = templates.find((t) => t.id === fromTemplateId);
      const fields = template
        ? planFromTemplate(template, eventId, tenantId)
        : {
            tenantId,
            eventId,
            name: eventTitle || 'Order of service',
            isTemplate: false,
            items: [emptyItem(0)],
          };
      await createServicePlan(tenantId, fields);
      await invalidate(tenantId, eventId);
    } catch (e) { notifyError('Failed to start the order of service', e); }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (!tenantId || !plan) return;
    setBusy(true);
    try {
      await saveServicePlanItems(tenantId, plan.id, name || eventTitle, items);
      await invalidate(tenantId, eventId);
      setDirty(false);
    } catch (e) { notifyError('Failed to save the order of service', e); }
    finally { setBusy(false); }
  };

  const saveAsTemplate = async () => {
    if (!tenantId || !plan) return;
    setBusy(true);
    try {
      // 🔴 `templateFromPlan` strips every person and sets `eventId: null`.
      await createServicePlan(tenantId, templateFromPlan({ items }, name || eventTitle, tenantId));
      await invalidate(tenantId, eventId);
    } catch (e) { notifyError('Failed to save the template', e); }
    finally { setBusy(false); }
  };

  const removePlan = async () => {
    if (!tenantId || !plan) return;
    setBusy(true);
    try {
      await deleteServicePlan(tenantId, plan.id);
      await invalidate(tenantId, eventId);
    } catch (e) { notifyError('Failed to remove the order of service', e); }
    finally { setBusy(false); }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(runSheet);
      setCopied(true);
    } catch (e) { notifyError('Failed to copy the run sheet', e); }
  };

  const nativeShare = async () => {
    try {
      // 🔴 No `url`. The payload is the sheet itself — see `buildRunSheetText`.
      await navigator.share({ title: name || eventTitle, text: runSheet });
    } catch {
      /* A dismissed share sheet rejects. That is not an error to report. */
    }
  };

  const header = (
    <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
      <h3 className="text-sm font-bold text-body flex items-center gap-1.5 font-display">
        <ListOrdered size={14} /> Order of service
      </h3>
      {plan ? (
        <span data-plan-total className="text-xs text-muted tabular-nums">
          {fmtDuration(totalMinutes)}{endsAt ? ` · ends ${fmtClock(endsAt)}` : ''}
        </span>
      ) : null}
    </div>
  );

  if (error) {
    return (
      <div data-service-plan className="bg-surface-raised rounded-2xl p-5 border border-line shadow-xs mb-5">
        {header}
        <p className="text-xs text-red-700">
          The order of service could not be loaded. This church may not have access to it yet.
        </p>
      </div>
    );
  }

  return (
    <div
      data-service-plan
      className={`bg-surface-raised rounded-2xl p-5 border border-line shadow-xs mb-5 ${NAV_CLEARANCE}`}
    >
      {header}

      {isLoading ? (
        <p className="text-xs text-muted">Loading the order of service…</p>
      ) : !plan ? (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            Nothing planned yet. Start from scratch, or from a template your church has saved.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              data-plan-template-picker
              aria-label="Start from a template"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className={`${CONTROL_BASE} ${FIELD_WIDTH.medium}`}
            >
              <option value="">Start from scratch</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <button
              type="button"
              data-plan-start
              disabled={busy}
              onClick={() => startPlan(templateId)}
              className={TEXT_BUTTON}
            >
              <Plus size={12} /> Start the order of service
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <input
            data-plan-name
            value={name}
            aria-label="Name of this order of service"
            placeholder="Sunday Morning"
            onChange={(e) => { setName(e.target.value); setDirty(true); }}
            className={`${CONTROL_BASE} ${FIELD_WIDTH.long}`}
          />

          <div data-plan-items className="space-y-1.5">
            {clocks.map(({ item, startsAt: at, offsetMinutes }, i) => (
              <ItemRow
                key={item.id}
                item={item}
                index={i}
                clock={at ? fmtClock(at) : `+${offsetMinutes}`}
                people={people}
                onChange={(next) => commit((prev) => prev.map((x) => (x.id === next.id ? next : x)))}
                onRemove={() => commit((prev) => renumber(prev.filter((x) => x.id !== item.id)))}
                onMove={(delta) => commit((prev) => moveItem(prev, i, delta))}
                onDragStart={(e) => { e.stopPropagation(); dragging.current = i; }}
                onDragEnter={() => { if (dragging.current === null) return; dragOver.current = i; }}
                onDragEnd={onDragEnd}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-plan-add
              disabled={items.length >= MAX_PLAN_ITEMS}
              onClick={() => commit((prev) => renumber([...orderedItems(prev), emptyItem(prev.length)]))}
              className={TEXT_BUTTON}
            >
              <Plus size={12} /> Add item
            </button>
            <span className="text-[10px] text-muted">
              {items.length} of {MAX_PLAN_ITEMS} · {DEFAULT_ITEM_MINUTES} min default
            </span>
          </div>

          <p className="text-[10px] text-muted">
            Drag an item to reorder it, or focus its handle and press the up and down arrow keys.
            Every time below is worked out from the service start and the durations above it, so
            changing one duration moves everything after it.
          </p>

          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-line">
            <button type="button" data-plan-save disabled={busy || !dirty} onClick={save} className={TEXT_BUTTON}>
              {dirty ? 'Save changes' : 'Saved'}
            </button>
            <button type="button" data-plan-copy onClick={copy} className={TEXT_BUTTON}>
              {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy run sheet'}
            </button>
            {canNativeShare ? (
              <button type="button" data-plan-share onClick={nativeShare} className={TEXT_BUTTON}>
                <Share2 size={12} /> Share
              </button>
            ) : null}
            <button type="button" data-plan-template disabled={busy} onClick={saveAsTemplate} className={TEXT_BUTTON}>
              Save as template
            </button>
            <button
              type="button"
              data-plan-delete
              disabled={busy}
              onClick={removePlan}
              className={`${TEXT_BUTTON} hover:text-red-600`}
            >
              <Trash2 size={12} /> Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ServicePlanPanel;
