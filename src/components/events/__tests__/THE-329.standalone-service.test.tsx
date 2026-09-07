import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
  isTemplateShape,
  itemsFromTemplate,
  planFromTemplate,
  planKind,
  servicePlanFields,
  templateFromPlan,
  type ServicePlan,
  type ServicePlanItem,
} from '../service-plan';
import {
  rotaEvent,
  rotaPlan,
  rotaServices,
  rotaWeeks,
  overlapWarnings,
  type RotaService,
} from '../volunteer-rota';
import ServiceCreateForm, { NO_EVENT, NO_TEMPLATE } from '../ServiceCreateForm';

/**
 * THE-329 — A CHURCH CAN CREATE A SERVICE WITHOUT CREATING AN EVENT FIRST.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE DEFECT, IN THE FOUNDER'S WORDS
 *
 *   "If I have no event created, I cannot create any service, which is stupid.
 *    I need to be able to create services from the service tab. Right now, the
 *    only service that I can schedule is the event that I created in the event
 *    tab, which is another feature."
 *
 * He is right, and the code admitted it in its own docblock: `AdminServices.tsx`
 * carried "⚠️ The known cost, stated rather than hidden: a church must still
 * create an event before it can plan the service."
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ⚠️ THE CLOCK IS FROZEN AND EVERY FIXTURE DATE IS FAR FROM TODAY — #468's fuse.
 *
 * A fixture pinned to `'2026-09-06T10:00'` turned `main` red for everyone the
 * moment the clock passed it. Every date here is derived from {@link NOW}, a
 * frozen instant in 2031 constructed from NUMBERS rather than from an ISO
 * literal — an ISO literal without an offset is parsed in the RUNNER'S
 * timezone, so a window boundary derived from one encodes the runner. Where a
 * timer is faked it is `vi.useFakeTimers({ toFake: ['Date'] })`: `toFake` is
 * LOAD-BEARING, because faking `setTimeout` timed 28 of 47 tests out and took a
 * run from 4s to 141s.
 */

/** Wed 7 May 2031, 09:00 local. Five years out; no clock reaches it. */
const NOW = new Date(2031, 4, 7, 9, 0, 0);
const SUN_11 = new Date(2031, 4, 11, 10, 0, 0);
const SUN_18 = new Date(2031, 4, 18, 10, 0, 0);

/**
 * A `Timestamp` stand-in: `toDate` is the whole of the contract this code uses.
 *
 * ⚠️ `NonNullable`, so a fixture can go where an anchor requires a real
 * Timestamp. `readPlan` rejects anything WITHOUT a `toDate` — section 11 proves
 * that with an ISO string and an epoch number — so a duck that quacks is
 * precisely as much of a Timestamp as this code ever asks for.
 */
const ts = (d: Date) =>
  ({ toDate: () => d } as unknown as NonNullable<ServicePlan['startAt']>);

const item = (
  id: string, title: string, minutes: number, order: number, personId: string | null = null,
): ServicePlanItem => ({
  id, title, minutes, order, personId, personName: personId ? `Person ${personId}` : null, note: null,
});

const SUNDAY = [
  item('a', 'Welcome and call to worship', 3, 0),
  item('b', 'Worship set', 22, 1),
  item('c', 'Sermon', 31, 2),
];

/* ═══════════════════════════════════════════════════════════════════════════
   1 · 🔴 A SERVICE CAN BE CREATED WITH NO EVENT. THE WHOLE TICKET.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('1 · a service can be created from the Services section with no event', () => {
  /**
   * 🔴 THE MUTATION THAT MUST FAIL THIS: "require an event before a service can
   * be created". Restore `servicePlanFields` to demand an `eventId` — or
   * restore the form's `ready` to require an event — and both halves below go
   * red: the shape half because a standalone anchor stops being expressible, and
   * the rendered half because the form stops submitting without one.
   */
  it('🔴 the SHAPE of a service with a date and no event exists, and is not a template', () => {
    const fields = servicePlanFields('t1', 'Sunday Morning', SUNDAY, {
      kind: 'standalone', startAt: ts(SUN_11),
    });

    expect(fields.eventId, 'a standalone service was given an event').toBeNull();
    expect(fields.startAt, 'a standalone service has no date of its own').not.toBeNull();
    expect(fields.startAt?.toDate()).toEqual(SUN_11);

    // 🔴 THE INVARIANT THAT HAD TO CHANGE. Before this ticket, `eventId: null`
    // meant TEMPLATE and this document could not have existed.
    expect(planKind(fields), 'a dated service with no event is not a standalone service')
      .toBe('standalone');
    expect(fields.isTemplate, 'a standalone service is flagged as a template').toBe(false);
    expect(isTemplateShape(fields), 'the invariant rejects a standalone service').toBe(true);
  });

  it('🔴 and the FORM submits one — a name and a date, no event chosen', () => {
    const drafts: unknown[] = [];
    const { root, host } = mount(
      <ServiceCreateForm
        events={[]}
        templates={[]}
        formatDay={(d) => d.toDateString()}
        busy={false}
        onCreate={(draft) => drafts.push(draft)}
      />,
    );

    try {
      const name = host.querySelector<HTMLInputElement>('[data-service-name]');
      const start = host.querySelector<HTMLInputElement>('[data-service-start]');
      const submit = host.querySelector<HTMLButtonElement>('[data-service-submit]');
      expect(name, 'the create form has no name field').not.toBeNull();
      expect(start, 'the create form has no date field').not.toBeNull();
      expect(submit, 'the create form has no submit').not.toBeNull();

      // ⚠️ THERE IS NO EVENT TO PICK AT ALL — `events` is empty, which is the
      // exact state the founder is in. The form must still submit.
      expect(submit!.disabled, 'the submit is enabled before anything is typed').toBe(true);

      setValue(name!, 'Sunday Morning');
      setValue(start!, '2031-05-11T10:00');
      act(() => { submit!.click(); });

      expect(drafts, 'the form refused to create a service without an event').toHaveLength(1);
      expect(drafts[0]).toMatchObject({
        name: 'Sunday Morning',
        startsAtLocal: '2031-05-11T10:00',
        eventId: null,
        templateId: null,
      });
    } finally { unmount(root, host); }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2 · 🔴 THE EMPTY STATE NO LONGER SENDS ANYBODY TO EVENTS.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('2 · the empty state no longer tells the user to go to Events', () => {
  /**
   * 🔴 THE COPY IS NAMED, both the sentence that is gone and the one that
   * replaced it, because "the empty state changed" is not a claim anybody can
   * check. THE-326 shipped, verbatim:
   *
   *   "A service needs a dated event before it can be planned. Create one on
   *    the Events screen and it will appear here."
   *
   * ⚠️ THE MUTATION: put that sentence back and this fails on the first
   * assertion. Its replacement is asserted too, so DELETING the empty state
   * rather than fixing it does not pass either.
   */
  const source = () => sourceOf('src/components/AdminServices.tsx');

  it('🔴 the "create one on the Events screen" sentence is gone', () => {
    const code = source();
    expect(code, 'the empty state still sends a church to another section')
      .not.toMatch(/A service needs a dated event before it can be planned/);
    expect(code, 'the empty state still points at the Events screen')
      .not.toMatch(/Create one on\s*\n?\s*\*?\s*the Events screen/);
  });

  it('and it points at the form on this screen instead', () => {
    const code = source();
    expect(code, 'the empty state does not exist at all any more')
      .toContain('data-services-empty');
    expect(code, 'the empty state does not tell a church what to do here')
      .toContain('Create one above with a name and a date');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3 · A SERVICE CAN STILL BE ATTACHED TO AN EVENT.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('3 · a service can still be attached to an event when a church wants both', () => {
  /**
   * 🔴 THE MECHANISM, NAMED: the create form's "Attach to an event" `select`.
   * Its default is {@link NO_EVENT}; choosing a dated event instead makes the
   * draft carry that event id, and `servicePlanFields` turns that into an
   * EVENT-ANCHORED plan — the same document THE-313 has always written.
   *
   * ⚠️ A church running a Christmas carol service genuinely wants it both
   * planned AND advertised. The event link was DEMOTED, not deleted.
   */
  it('the create form offers the event picker, defaulted to no event', () => {
    const { root, host } = mount(
      <ServiceCreateForm
        events={[{ id: 'e1', title: 'Carols by Candlelight', startsAt: SUN_18 }]}
        templates={[]}
        formatDay={(d) => d.toDateString()}
        busy={false}
        onCreate={() => {}}
      />,
    );
    try {
      const trigger = host.querySelector('[data-service-event]');
      expect(trigger, 'there is no way to attach a service to an event').not.toBeNull();
      expect(host.textContent, 'the default is not "no event"')
        .toContain('No event — a service of its own');
    } finally { unmount(root, host); }
  });

  it('🔴 and an event anchor produces the SAME document THE-313 has always written', () => {
    const attached = servicePlanFields('t1', 'Carols by Candlelight', SUNDAY, {
      kind: 'event', eventId: 'e1',
    });
    expect(attached.eventId).toBe('e1');
    // 🔴 NO SECOND COPY OF THE START. An event-anchored plan takes the event's
    // clock, exactly as before — two copies of one start would disagree the
    // first time somebody moved the service by half an hour.
    expect(attached.startAt, 'an event-anchored plan grew a start of its own').toBeNull();
    expect(planKind(attached)).toBe('event');
    expect(isTemplateShape(attached)).toBe(true);
  });

  it('and the screen still hands an event down — the demotion is not a deletion', () => {
    const code = sourceOf('src/components/AdminServices.tsx');
    expect(code, 'the section can no longer plan against an event').toContain('eventId={');
    expect(code, 'the section cannot plan a service with no event').toContain('planId={');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4 · 🔴 TEMPLATES STILL WORK, AND ARE STILL DISTINGUISHABLE.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('4 · templates still work, and a template is still distinguishable', () => {
  /**
   * 🔴 THE INVARIANT THAT HAD TO CHANGE, AND THE FEATURE IT PROTECTS.
   *
   * Part 1's templates are why the null-event invariant existed: a church builds
   * "Sunday Morning" once and reuses it. The rule was
   * `isTemplate === (eventId === null)`; it is now
   * `isTemplate === (planKind(plan) === 'template')` over THREE kinds, and the
   * date is what tells a template from a standalone service.
   *
   * ⚠️ THE MUTATION: break the distinction — make `planKind` return 'template'
   * whenever `eventId` is null, which is the OLD rule — and the first test below
   * fails, because a standalone service starts being called a template.
   */
  it('🔴 a template is a plan with NEITHER anchor, and still answers the invariant', () => {
    const template = templateFromPlan({ items: SUNDAY }, 'Sunday Morning', 't1');
    expect(template.eventId, 'a template gained an event').toBeNull();
    expect(template.startAt, 'a template gained a date').toBeNull();
    expect(template.isTemplate).toBe(true);
    expect(planKind(template)).toBe('template');
    expect(isTemplateShape(template), 'the invariant rejects a template').toBe(true);
  });

  it('🔴 a TEMPLATE and a STANDALONE SERVICE are told apart, and both by one rule', () => {
    const template = templateFromPlan({ items: SUNDAY }, 'Sunday Morning', 't1');
    const standalone = servicePlanFields('t1', 'Sunday Morning', SUNDAY, {
      kind: 'standalone', startAt: ts(SUN_11),
    });

    // Both have NO EVENT — which under the old two-way rule made them the same
    // thing. The date is the whole of the difference.
    expect(template.eventId).toBeNull();
    expect(standalone.eventId).toBeNull();
    expect(planKind(template)).toBe('template');
    expect(planKind(standalone)).toBe('standalone');
    expect(template.isTemplate).toBe(true);
    expect(standalone.isTemplate).toBe(false);
  });

  it('a document whose stored flag disagrees with its anchors still fails the invariant', () => {
    // 🔴 The rule is not decoration: it must still REJECT. Three ways to lie
    // about a plan, and all three are caught.
    expect(isTemplateShape({ eventId: null, startAt: ts(SUN_11), isTemplate: true }),
      'a dated service claiming to be a template passed').toBe(false);
    expect(isTemplateShape({ eventId: null, startAt: null, isTemplate: false }),
      'an anchorless plan claiming not to be a template passed').toBe(false);
    expect(isTemplateShape({ eventId: 'e1', startAt: null, isTemplate: true }),
      'an event-anchored plan claiming to be a template passed').toBe(false);
  });

  it('the three kinds are exhaustive, and an event wins over a date of its own', () => {
    // ⚠️ The ORDER of the two tests inside `planKind` is a decision: a plan
    // carrying both takes the EVENT's clock, which keeps THE-313's "a plan
    // carries no start of its own" true for every plan that has an event.
    expect(planKind({ eventId: 'e1', startAt: ts(SUN_11) })).toBe('event');
    expect(planKind({ eventId: 'e1', startAt: null })).toBe('event');
    expect(planKind({ eventId: null, startAt: ts(SUN_11) })).toBe('standalone');
    expect(planKind({ eventId: null, startAt: null })).toBe('template');
  });

  it('🔴 and a service can still be STARTED from a template, both ways', () => {
    const template = templateFromPlan(
      { items: [item('x', 'Welcome', 3, 0, 'u1')] }, 'Sunday Morning', 't1',
    );
    // People are stripped, ids are fresh — part 1's total function, unchanged.
    expect(template.items[0].personId, 'a template carried a person').toBeNull();
    expect(template.items[0].id, 'a template reused the plan item id').not.toBe('x');

    // The event-anchored path: THE-313's own signature, untouched.
    const anchored = planFromTemplate({ name: 'Sunday Morning', items: template.items }, 'e1', 't1');
    expect(anchored.eventId).toBe('e1');
    expect(anchored.isTemplate).toBe(false);

    // The standalone path: the same stripping, a date instead of an event.
    const free = servicePlanFields('t1', template.name, itemsFromTemplate(template.items), {
      kind: 'standalone', startAt: ts(SUN_11),
    });
    expect(free.items.map((i) => i.title)).toEqual(anchored.items.map((i) => i.title));
    expect(free.items.every((i) => i.personId === null),
      'a service started from a template carried a person').toBe(true);
    expect(planKind(free)).toBe('standalone');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   5 · 🔴 AN EXISTING EVENT-ANCHORED PLAN STILL LOADS AND STILL PLANS.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('5 · an EXISTING event-anchored plan still loads and still plans', () => {
  /**
   * 🔴 THIS IS THE NO-MIGRATION CLAIM, ASSERTED RATHER THAN ASSERTED-ABOUT.
   *
   * A document written by THE-313 or THE-326 has NO `startAt` FIELD AT ALL —
   * not null, absent. The fixtures below are RAW Firestore-shaped objects with
   * the field missing, exactly as they sit in a church's database today, and
   * they are put through the same functions the app puts them through.
   *
   * ⚠️ THE MUTATION: break an existing event-anchored plan — make `planKind`
   * consult `startAt` first, so a plan whose event has a date but whose own
   * `startAt` is absent falls through to 'template' — and this section fails.
   */
  const legacyPlan = { id: 'p1', tenantId: 't1', eventId: 'e1', name: 'Order of service' };
  const legacyTemplate = { id: 'p2', tenantId: 't1', eventId: null, name: 'Sunday Morning' };

  it('🔴 a plan written before this ticket is still an EVENT-ANCHORED service', () => {
    const asRead = { ...legacyPlan, startAt: null };   // what `readPlan` produces
    expect('startAt' in legacyPlan, 'the fixture is not a legacy document').toBe(false);
    expect(planKind(asRead)).toBe('event');
    expect(isTemplateShape({ ...asRead, isTemplate: false })).toBe(true);
  });

  it('🔴 and a template written before this ticket is still a TEMPLATE', () => {
    const asRead = { ...legacyTemplate, startAt: null };
    expect('startAt' in legacyTemplate, 'the fixture is not a legacy document').toBe(false);
    expect(planKind(asRead)).toBe('template');
    expect(isTemplateShape({ ...asRead, isTemplate: true })).toBe(true);
  });

  it('an existing plan still joins to its event and still carries its items', () => {
    const events = [{ id: 'e1', title: 'Sunday Worship', startDate: { toDate: () => SUN_11 } }]
      .map(rotaEvent);
    const joined = rotaServices(events, [
      rotaPlan({ ...legacyPlan, startAt: null, items: SUNDAY }),
    ]);
    expect(joined).toHaveLength(1);
    expect(joined[0].eventId).toBe('e1');
    expect(joined[0].planId).toBe('p1');
    expect(joined[0].startsAt, 'the plan lost its event\'s clock').toEqual(SUN_11);
    expect(joined[0].items.map((i) => i.title)).toEqual(SUNDAY.map((i) => i.title));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   6 · THE ROTA STILL SPANS WEEKS, OVER BOTH KINDS.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('6 · the rota still spans weeks over standalone services', () => {
  const events = [{ id: 'e1', title: 'Sunday Worship', startDate: { toDate: () => SUN_11 } }]
    .map(rotaEvent);
  const plans = [
    rotaPlan({ id: 'p1', eventId: 'e1', startAt: null, name: 'Order of service', items: SUNDAY }),
    // 🔴 A STANDALONE SERVICE: no event, a date of its own.
    rotaPlan({
      id: 'p2', eventId: null, startAt: { toDate: () => SUN_18 },
      name: 'Sunday Morning', items: SUNDAY,
    }),
    // A template: no event, NO date. It must never reach a rota.
    rotaPlan({ id: 'p3', eventId: null, startAt: null, name: 'Template', items: SUNDAY }),
  ];

  it('🔴 a standalone service appears on the rota, and a template never does', () => {
    const services = rotaServices(events, plans);
    expect(services.map((s) => s.planId), 'the template reached the rota, or the standalone service did not')
      .toEqual(['p1', 'p2']);
    expect(services[1].eventId, 'a standalone service was given an event').toBeNull();
    expect(services[1].eventTitle, 'a standalone service has no name on the rota')
      .toBe('Sunday Morning');
  });

  it('and it lands in the right WEEK — two weeks, one service each', () => {
    const weeks = rotaWeeks(rotaServices(events, plans), NOW, 3);
    const byWeek = weeks.map((w) => w.services.map((s) => s.planId));
    expect(byWeek.flat()).toEqual(['p1', 'p2']);
    // ⚠️ Every week is returned including the empty ones — part 2's rule, and
    // it must still hold with a standalone service in the mix.
    expect(weeks, 'the rota stopped returning every week').toHaveLength(3);
    expect(byWeek.filter((w) => w.length === 0).length).toBe(1);
  });

  it('a plan is never joined twice — once through its event and once as itself', () => {
    const services = rotaServices(events, plans);
    expect(services.filter((s) => s.planId === 'p1'), 'the event-anchored plan was double-counted')
      .toHaveLength(1);
  });

  it('and the double-booking warning still works across the two kinds', () => {
    // The same person on two OVERLAPPING clocks in two DIFFERENT plans, one
    // event-anchored and one standalone.
    const clash: RotaService[] = [
      {
        eventId: 'e1', eventTitle: 'Sunday Worship', startsAt: SUN_11,
        planId: 'p1', planName: 'x', items: [item('a', 'Lead', 60, 0, 'ben')],
      },
      {
        eventId: null, eventTitle: 'Sunday Morning', startsAt: new Date(SUN_11.getTime() + 30 * 60_000),
        planId: 'p2', planName: 'y', items: [item('b', 'Read', 60, 0, 'ben')],
      },
    ];
    const warnings = overlapWarnings(clash);
    expect(warnings, 'a clash spanning a standalone service is not warned about').toHaveLength(1);
    expect(warnings[0].personId).toBe('ben');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   7 · INVITATIONS AND THE ACCEPT LINK — SAME URL SHAPE, SAME SCOPE.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('7 · invitations and the accept link still work, same URL shape and scope', () => {
  /**
   * 🔴 THE MUTATION: change the accept link's scope — let the respond route
   * write anything but `status` and `respondedAt` — and the last test fails.
   */
  const respond = () => sourceOf('src/app/api/rota/respond/route.ts');
  const invite = () => sourceOf('src/app/api/rota/invitations/route.ts');
  const page = () => sourceOf('src/app/rota/[token]/page.tsx');

  it('the accept link is still `/rota/[token]` and still needs no sign-in', () => {
    expect(page(), 'the accept page moved').toContain('token');
    // ⚠️ The route file's PATH is the URL shape; this ticket adds no route and
    // renames none, and section 20 of the guards pins the whole route tree.
    expect(sourceExists('src/app/rota/[token]/page.tsx')).toBe(true);
  });

  it('🔴 and the accept route still authorises ONLY `status` and `respondedAt`', () => {
    const code = respond();
    expect(code, 'the accept route stopped setting a status').toContain('status');
    expect(code, 'the accept route stopped stamping a response').toContain('respondedAt');
    // The scope is a whitelist, not a spread: a widened scope would show here.
    expect(code, 'the accept route now writes a spread of caller-supplied fields')
      .not.toMatch(/\.(?:set|update)\(\s*\{\s*\.\.\./);
  });

  it('an invitation still carries the fields part 3 persists, unchanged', () => {
    const fields = sourceOf('src/components/events/rota-invitations.ts');
    const iface = fields.slice(fields.indexOf('export interface RotaInvitation'));
    const body = iface.slice(0, iface.indexOf('\n}'));
    for (const field of ['planId', 'itemId', 'eventId', 'personId', 'startsAt', 'status']) {
      expect(body, `RotaInvitation lost ${field}`).toContain(field);
    }
  });

  it('🔴 and the invite route derives its service from the event OR the plan, never invents one', () => {
    const code = invite();
    // The event branch is unchanged and still first — every invitation ever
    // sent is derived from exactly the document it was derived from before.
    expect(code, 'the invite route stopped reading the event').toContain('eventFor(tenantId, eventId)');
    // The standalone branch reads the plan's own `startAt`, and REFUSES anything
    // that is not a Timestamp rather than parsing a second date representation.
    expect(code, 'the invite route cannot invite to a standalone service')
      .toContain('standaloneServiceFor');
    expect(code, 'the invite route accepts a non-Timestamp date')
      .toMatch(/start instanceof Timestamp/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   11 · ONE TIMESTAMP REPRESENTATION.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('11 · only one timestamp representation is written', () => {
  /**
   * 🔴 `invoices.issuedAt` and `contactActivities.createdAt` each hold BOTH ISO
   * strings and Timestamps in this database, and Firestore sorts across types by
   * TYPE FIRST — so a collection carrying both is not untidy, it is unsortable.
   * The new field must not become a third instance.
   */
  it('🔴 `readPlan` refuses anything but a Timestamp in `startAt`', async () => {
    const { readPlan } = await import('../../../hooks/queries/useServicePlanQueries');
    const iso = readPlan('p1', { tenantId: 't1', eventId: null, name: 'x', startAt: '2031-05-11T10:00:00Z' });
    expect(iso.startAt, 'an ISO string was accepted as a date').toBeNull();
    expect(iso.isTemplate, 'a plan with an unreadable date is not a template').toBe(true);

    const epoch = readPlan('p2', { tenantId: 't1', eventId: null, name: 'x', startAt: SUN_11.getTime() });
    expect(epoch.startAt, 'an epoch number was accepted as a date').toBeNull();

    const good = readPlan('p3', { tenantId: 't1', eventId: null, name: 'x', startAt: { toDate: () => SUN_11 } });
    expect(good.startAt, 'a Timestamp was rejected').not.toBeNull();
    expect(good.isTemplate, 'a dated service was read as a template').toBe(false);
  });

  it('and nothing in the feature turns a date into a string or a number for a document', () => {
    for (const file of [
      'src/components/events/service-plan.ts',
      'src/components/events/ServiceCreateForm.tsx',
      'src/hooks/queries/useServicePlanQueries.ts',
    ]) {
      const code = codeOf(file);
      expect(code, `${file} writes an ISO string`).not.toMatch(/toISOString\s*\(/);
      expect(code, `${file} writes an epoch`).not.toMatch(/Date\.now\s*\(\)/);
      expect(code, `${file} writes a date's own getTime`).not.toMatch(/startAt[^\n]*getTime\s*\(\)/);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   The mount helpers, and the source reader.
   ═══════════════════════════════════════════════════════════════════════════ */

function mount(node: React.ReactElement): { root: Root; host: HTMLElement } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(node); });
  return { root, host };
}

function unmount(root: Root, host: HTMLElement): void {
  act(() => { root.unmount(); });
  host.remove();
}

/**
 * ⚠️ A CONTROLLED INPUT NEEDS THE NATIVE SETTER. React installs its own value
 * descriptor on the element, so assigning `el.value` is invisible to it and the
 * change event carries the OLD value.
 */
function setValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/**
 * 🔴 THE SOURCE IS READ FROM DISK, AND NOTHING HERE SHELLS OUT TO GIT.
 *
 * ⚠️ There is no child-process import, no version-control invocation and no diff
 * of the current branch anywhere in this file — #454 is the standing sweep and
 * four such guards have blocked every unrelated PR in this repo.
 * `the-329-guards.test.ts` section 19 asserts it, with needles assembled at run
 * time so its own source does not contain what it forbids. Every claim here is
 * made against the file on disk, which needs nothing but `fs`.
 */
function sourceOf(rel: string): string {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  return readFileSync(path.join(process.cwd(), rel), 'utf8');
}

function sourceExists(rel: string): boolean {
  const { existsSync } = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  return existsSync(path.join(process.cwd(), rel));
}

/** Source with comments stripped — the code, not the prose about it. */
const codeOf = (rel: string): string =>
  sourceOf(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/* Keep the sentinels honest: the form's defaults are what section 1 relies on. */
describe('the form\'s sentinels are the ones the parent maps back', () => {
  it('a sentinel is never the empty string — Radix refuses to render one', () => {
    expect(NO_EVENT).not.toBe('');
    expect(NO_TEMPLATE).not.toBe('');
    expect(NO_EVENT).not.toBe(NO_TEMPLATE);
  });
});

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });
