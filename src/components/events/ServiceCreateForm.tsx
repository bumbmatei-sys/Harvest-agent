'use client';

/**
 * THE-329 — CREATING A SERVICE, WITH NO EVENT REQUIRED.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE DEFECT THIS FORM EXISTS TO FIX, IN THE FOUNDER'S WORDS
 *
 *   "If I have no event created, I cannot create any service, which is stupid.
 *    I need to be able to create services from the service tab. Right now, the
 *    only service that I can schedule is the event that I created in the event
 *    tab, which is another feature."
 *
 * THE-326 shipped the Services section reading the church's EVENTS and planning
 * against them, and recorded the cost in its own docblock rather than hiding it:
 * "a church must still create an event before it can plan the service". That was
 * the wrong call. A Sunday service is the week's rhythm, not something a church
 * advertises; requiring a public event record first is backwards.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 WHY THIS IS ITS OWN FILE AND NOT A BLOCK INSIDE `AdminServices.tsx`
 *
 * ⚠️ Exactly `ServicePlanRow.tsx`'s reason, and it is a TESTING property rather
 * than a tidiness one: this file imports NO Firestore, NO react-query and NO app
 * store, so the Chromium measurement suite mounts the REAL component instead of
 * a replica of it. A replica is a file that can pass while the shipped one
 * fails. Every write this form causes is made by its parent, from the values it
 * hands up through {@link ServiceCreateFormProps.onCreate}.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE PRIMITIVE PER ELEMENT, AND WHAT WAS REJECTED FOR EACH
 *
 *   the form's frame ......... `card`   — Card / CardHeader / CardTitle /
 *                              CardDescription / CardContent. The section's own
 *                              vocabulary already; a bare `<section>` with a
 *                              hand-rolled border would be the defect the
 *                              "use the installed primitives" rule names.
 *                              REJECTED: `dialog` and `sheet` — creating a
 *                              service is the PRIMARY act of this screen, and
 *                              putting the primary act behind a button that
 *                              opens a layer is the shape the founder is
 *                              complaining about ("buried two clicks deep").
 *                              REJECTED: `collapsible` — same objection, and a
 *                              collapsed create form on an EMPTY screen shows a
 *                              church nothing to do.
 *
 *   each labelled control .... `field`  — Field / FieldLabel / FieldDescription.
 *                              REJECTED: a bare `label` + `input` pair, which is
 *                              what the rest of `AdminEvents` spells; `field`
 *                              exists precisely to stop that being re-spelled,
 *                              carries the label/control association without a
 *                              hand-written `htmlFor`, and this is a new form
 *                              rather than an edit to an old one.
 *
 *   the name ................. `input`  — a text input.
 *                              REJECTED: `textarea` — a service name is one
 *                              line ("Sunday Morning"), and a box that accepts
 *                              paragraphs invites them.
 *
 *   the date and time ........ `input`, `type="datetime-local"`.
 *                              🔴 REJECTED: `calendar`, deliberately, and this
 *                              is the one rejection worth reading. `calendar` is
 *                              installed and THE-308 composed it for the month
 *                              view — but it picks a DAY, and a service needs a
 *                              day AND a clock time, because every time on the
 *                              run sheet is `itemClockTimes(items, start)`. So
 *                              `calendar` would need a SECOND control beside it
 *                              carrying the time, and the two would have to be
 *                              reconciled into one value. `datetime-local` is
 *                              one control for one fact, opens the platform's
 *                              own wheel picker on the phone this product is
 *                              primarily used on, and is EXACTLY how
 *                              `AdminEvents.tsx` already spells the start of a
 *                              dated thing (three of them) — so the two screens
 *                              agree about how a start is typed instead of
 *                              disagreeing.
 *
 *   the optional event ....... `select`  — Select / SelectTrigger / SelectValue /
 *                              SelectContent / SelectItem.
 *                              REJECTED: `checkbox`/`switch` + a second control,
 *                              which is two decisions for one; and
 *                              `dropdown-menu`, which is a MENU OF ACTIONS and
 *                              carries no form value.
 *
 *   the optional template .... `select`, for the same reasons.
 *
 *   the submit ............... `button`.
 *                              REJECTED: `button-group` — there is one action.
 *
 *   the disabled reason ...... `FieldDescription`, rendered as text.
 *                              REJECTED: `tooltip` — unreachable on a phone;
 *                              and `alert`, which is for a condition rather than
 *                              for the instruction on how to finish a form.
 *
 * ⚠️ NO NEW PRIMITIVE IS INSTALLED and no dependency is added. `accordion` does
 * not exist in this repo and is not reached for.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 EVERY TAPPABLE TARGET IS ≥44px BELOW `sm`, AND RULE 4's 38/40px HOLDS ABOVE
 *
 * ⚠️ `input` carries `h-8` and `select` sets its height with
 * `data-[size=default]:h-9` — an ATTRIBUTE selector that OUTRANKS a plain
 * `sm:h-[38px]`, which is why {@link CONTROL} answers it at the same
 * specificity. `min-h-[44px]` carries the phone floor and beats a leaked `h-`
 * outright because `min-height` is a different property; `sm:min-h-0` releases
 * it so Rule 4's density is what applies from 640px up. Measured in Chromium at
 * 380 / 768 / 1024 / 1280 / 1440 by `THE-329.services.layout.test.tsx`, on BOTH
 * axes — a control 44px tall and 35px wide is still a miss.
 */
import React, { useMemo, useState } from 'react';

import { CONTROL_DENSITY, FIELD_WIDTH } from '../layout/form-layout';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * A text-entry control: the phone floor below `sm`, Rule 4's 38px above it.
 *
 * ⚠️ Copied in SPELLING from `AdminServices`' own constant and for its reason,
 * not by preference — see this file's header on the attribute selector.
 */
export const CONTROL =
  `min-h-[44px] sm:min-h-0 ${CONTROL_DENSITY.control} sm:data-[size=default]:h-[38px]`;

/** The action button: the same floor, and Rule 4's 40px action height above it. */
export const ACTION = `min-h-[44px] sm:min-h-0 ${CONTROL_DENSITY.action}`;

/**
 * 🔴 THE SENTINEL FOR "NO EVENT", AND WHY IT IS NOT THE EMPTY STRING.
 *
 * Radix's `Select` treats `value=""` as "nothing is selected" and refuses to
 * render an item carrying it, so an empty-string option would be a row a church
 * could see and never choose. This is a value the parent maps back to `null` in
 * exactly one place — {@link ServiceCreateFormProps.onCreate}'s `eventId`.
 */
export const NO_EVENT = '__none__';

/** The same sentinel for the template picker: a service from a blank sheet. */
export const NO_TEMPLATE = '__blank__';

/** An event this service could be attached to. Dated events only — see the parent. */
export interface AttachableEvent {
  id: string;
  title: string;
  startsAt: Date;
}

/** A template this service could be started from. */
export interface StartableTemplate {
  id: string;
  name: string;
}

/** What the form hands up. The parent turns it into one document. */
export interface NewServiceDraft {
  name: string;
  /**
   * 🔴 THE LOCAL `datetime-local` STRING, NOT A `Date` AND NOT AN EPOCH.
   *
   * ⚠️ The parent converts it, once, exactly as `AdminEvents.tsx` already does
   * (`Timestamp.fromDate(new Date(v))`). Converting here would put a second
   * date-to-document path in the codebase, and this feature has ONE.
   */
  startsAtLocal: string;
  /** The event to attach to, or null for a service of its own. */
  eventId: string | null;
  /** The template to start from, or null for a blank run sheet. */
  templateId: string | null;
}

export interface ServiceCreateFormProps {
  /** Dated events a church may attach this service to. May be empty — that is the point. */
  events: readonly AttachableEvent[];
  /** Templates the church has saved. May be empty. */
  templates: readonly StartableTemplate[];
  /** How a date is written on this screen. The section's own formatter, passed in. */
  formatDay: (d: Date) => string;
  busy: boolean;
  onCreate: (draft: NewServiceDraft) => void;
}

const ServiceCreateForm: React.FC<ServiceCreateFormProps> = ({
  events, templates, formatDay, busy, onCreate,
}) => {
  const [name, setName] = useState('');
  const [startsAtLocal, setStartsAtLocal] = useState('');
  const [eventId, setEventId] = useState<string>(NO_EVENT);
  const [templateId, setTemplateId] = useState<string>(NO_TEMPLATE);

  /**
   * 🔴 A NAME AND A DATE, AND NOTHING ELSE IS REQUIRED. That is the whole of the
   * ticket: no event, no template, no registration, no public page.
   */
  const ready = name.trim().length > 0 && startsAtLocal.length > 0;

  const eventLabel = useMemo(() => {
    const found = events.find((e) => e.id === eventId);
    return found ? `${formatDay(found.startsAt)} · ${found.title}` : 'No event — a service of its own';
  }, [events, eventId, formatDay]);

  const templateLabel = useMemo(() => {
    const found = templates.find((t) => t.id === templateId);
    return found ? found.name : 'Blank run sheet';
  }, [templates, templateId]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    onCreate({
      name: name.trim(),
      startsAtLocal,
      eventId: eventId === NO_EVENT ? null : eventId,
      templateId: templateId === NO_TEMPLATE ? null : templateId,
    });
    setName('');
    setStartsAtLocal('');
    setEventId(NO_EVENT);
    setTemplateId(NO_TEMPLATE);
  };

  return (
    <Card className="w-full min-w-0" data-service-create>
      <CardHeader>
        <CardTitle>Create a service</CardTitle>
        <CardDescription>
          Give it a name and a date. Nothing else is needed — a service is the week&apos;s
          rhythm, not something the church has to advertise first.
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0">
        <form onSubmit={submit} className={`space-y-4 ${CONTROL_DENSITY.fieldGap}`} noValidate>
          <Field className={`${FIELD_WIDTH.long} ${CONTROL_DENSITY.labelGap}`}>
            <FieldLabel htmlFor="service-name">Service name</FieldLabel>
            <Input
              id="service-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sunday Morning"
              className={CONTROL}
              data-service-name
            />
          </Field>

          <Field className={`${FIELD_WIDTH.medium} ${CONTROL_DENSITY.labelGap}`}>
            <FieldLabel htmlFor="service-start">Date and time</FieldLabel>
            <Input
              id="service-start"
              type="datetime-local"
              value={startsAtLocal}
              onChange={(e) => setStartsAtLocal(e.target.value)}
              className={CONTROL}
              data-service-start
            />
            <FieldDescription>
              Every time on the run sheet is counted from here.
            </FieldDescription>
          </Field>

          {templates.length > 0 && (
            <Field className={`${FIELD_WIDTH.long} ${CONTROL_DENSITY.labelGap}`}>
              <FieldLabel htmlFor="service-template">Start from a template</FieldLabel>
              <Select value={templateId} onValueChange={(v: unknown) => setTemplateId(String(v))}>
                <SelectTrigger
                  id="service-template"
                  className={`w-[260px] max-w-full ${CONTROL}`}
                  aria-label="Start from a template"
                  data-service-template
                >
                  {/* 🔴 The trigger formats its own value — THE-326's finding.
                      `Select.Value` with no children prints the VALUE, and a
                      value is an id, not a label. */}
                  <SelectValue>{() => templateLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TEMPLATE}>Blank run sheet</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          <Field className={`${FIELD_WIDTH.long} ${CONTROL_DENSITY.labelGap}`}>
            <FieldLabel htmlFor="service-event">Attach to an event</FieldLabel>
            <Select value={eventId} onValueChange={(v: unknown) => setEventId(String(v))}>
              <SelectTrigger
                id="service-event"
                className={`w-[260px] max-w-full ${CONTROL}`}
                aria-label="Attach to an event"
                data-service-event
              >
                <SelectValue>{() => eventLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_EVENT}>No event — a service of its own</SelectItem>
                {events.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {formatDay(e.startsAt)} · {e.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              {/* 🔴 THE ANSWER TO "how does a church still get both?", WHERE A
                  CHURCH WILL READ IT rather than only in a docblock. */}
              Optional. Attach one when the church wants the service planned here and
              advertised on the Events screen too — a carol service, say.
            </FieldDescription>
          </Field>

          <Button
            type="submit"
            disabled={!ready || busy}
            className={ACTION}
            data-service-submit
          >
            Create service
          </Button>
          {!ready && (
            <FieldDescription data-service-hint>
              A name and a date are all that is needed.
            </FieldDescription>
          )}
        </form>
      </CardContent>
    </Card>
  );
};

export default ServiceCreateForm;
