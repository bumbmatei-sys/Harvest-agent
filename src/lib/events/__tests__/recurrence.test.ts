import { describe, it, expect, vi } from 'vitest';
import { expandRuns, registrationMatchesRun, parseEventDateTime, formatEventDateTime } from '../recurrence';

const FAR_PAST = new Date('2000-01-01T00:00:00.000Z');
const FAR_FUTURE = new Date('2100-01-01T00:00:00.000Z');

describe('expandRuns — non-recurring', () => {
  it('produces exactly one run when recurrence is absent', () => {
    const runs = expandRuns(
      {
        startDate: new Date('2027-05-10T17:00:00.000Z'),
        endDate: new Date('2027-05-10T19:00:00.000Z'),
      },
      FAR_PAST,
      FAR_FUTURE,
    );
    expect(runs).toHaveLength(1);
    expect(runs[0].runDate).toBe('2027-05-10');
    expect(runs[0].start.toISOString()).toBe('2027-05-10T17:00:00.000Z');
    expect(runs[0].end.toISOString()).toBe('2027-05-10T19:00:00.000Z');
  });

  it('omits the single run when it does not overlap the window', () => {
    const runs = expandRuns(
      {
        startDate: new Date('2027-05-10T17:00:00.000Z'),
        endDate: new Date('2027-05-10T19:00:00.000Z'),
      },
      new Date('2027-06-01T00:00:00.000Z'),
      FAR_FUTURE,
    );
    expect(runs).toHaveLength(0);
  });
});

describe('expandRuns — weekly', () => {
  const base = {
    startDate: new Date('2027-01-04T10:00:00.000Z'), // Monday
    endDate: new Date('2027-01-04T11:00:00.000Z'),
  };

  it('generates N weekly runs 7 days apart, honouring count', () => {
    const runs = expandRuns({ ...base, recurrence: { freq: 'weekly', count: 4 } }, FAR_PAST, FAR_FUTURE);
    expect(runs.map((r) => r.runDate)).toEqual(['2027-01-04', '2027-01-11', '2027-01-18', '2027-01-25']);
    runs.forEach((r) => expect(r.end.getTime() - r.start.getTime()).toBe(60 * 60 * 1000));
  });

  it('stops at `until`, inclusive', () => {
    const runs = expandRuns(
      { ...base, recurrence: { freq: 'weekly', until: '2027-01-18' } },
      FAR_PAST,
      FAR_FUTURE,
    );
    expect(runs.map((r) => r.runDate)).toEqual(['2027-01-04', '2027-01-11', '2027-01-18']);
  });

  it('drops a cancelled run but keeps generating the rest', () => {
    const runs = expandRuns(
      { ...base, recurrence: { freq: 'weekly', count: 4, cancelledRuns: ['2027-01-11'] } },
      FAR_PAST,
      FAR_FUTURE,
    );
    expect(runs.map((r) => r.runDate)).toEqual(['2027-01-04', '2027-01-18', '2027-01-25']);
  });

  it('filters to runs overlapping an arbitrary [from, to] window', () => {
    const runs = expandRuns(
      { ...base, recurrence: { freq: 'weekly', count: 10 } },
      new Date('2027-01-10T00:00:00.000Z'),
      new Date('2027-01-20T00:00:00.000Z'),
    );
    expect(runs.map((r) => r.runDate)).toEqual(['2027-01-11', '2027-01-18']);
  });
});

describe('expandRuns — every 2 weeks', () => {
  it('generates runs 14 days apart', () => {
    const runs = expandRuns(
      {
        startDate: new Date('2027-02-01T18:00:00.000Z'),
        endDate: new Date('2027-02-01T20:00:00.000Z'),
        recurrence: { freq: 'every_2_weeks', count: 3 },
      },
      FAR_PAST,
      FAR_FUTURE,
    );
    expect(runs.map((r) => r.runDate)).toEqual(['2027-02-01', '2027-02-15', '2027-03-01']);
  });
});

describe('expandRuns — monthly (day-of-month, skipping short months)', () => {
  it('keeps the 31st and skips any month that has no 31st, without clamping', () => {
    const runs = expandRuns(
      {
        startDate: new Date('2027-01-31T15:00:00.000Z'),
        endDate: new Date('2027-01-31T16:00:00.000Z'),
        recurrence: { freq: 'monthly', count: 5 },
      },
      FAR_PAST,
      FAR_FUTURE,
    );
    // Feb(28), Apr(30), Jun(30), Sep(30), Nov(30) have no 31st and are skipped
    // outright — Aug follows Jul directly because both have 31 days.
    expect(runs.map((r) => r.runDate)).toEqual([
      '2027-01-31',
      '2027-03-31',
      '2027-05-31',
      '2027-07-31',
      '2027-08-31',
    ]);
  });

  it('a plain day-of-month (15th) runs every month with no skips', () => {
    const runs = expandRuns(
      {
        startDate: new Date('2027-01-15T15:00:00.000Z'),
        endDate: new Date('2027-01-15T16:00:00.000Z'),
        recurrence: { freq: 'monthly', count: 3 },
      },
      FAR_PAST,
      FAR_FUTURE,
    );
    expect(runs.map((r) => r.runDate)).toEqual(['2027-01-15', '2027-02-15', '2027-03-15']);
  });

  it('respects a cancelled run inside a monthly series', () => {
    const runs = expandRuns(
      {
        startDate: new Date('2027-01-31T15:00:00.000Z'),
        endDate: new Date('2027-01-31T16:00:00.000Z'),
        recurrence: { freq: 'monthly', count: 3, cancelledRuns: ['2027-03-31'] },
      },
      FAR_PAST,
      FAR_FUTURE,
    );
    expect(runs.map((r) => r.runDate)).toEqual(['2027-01-31', '2027-05-31']);
  });
});

describe('expandRuns — DST safety (Europe/Berlin)', () => {
  it('keeps the same 19:00 local wall-clock time across the March 2027 spring-forward', () => {
    // Berlin DST 2027 begins Sun 28 Mar (clocks jump 02:00 CET -> 03:00 CEST).
    // 21 Mar is still CET (UTC+1); 28 Mar and 4 Apr are CEST (UTC+2).
    const runs = expandRuns(
      {
        startDate: new Date('2027-03-21T18:00:00.000Z'), // 19:00 CET
        endDate: new Date('2027-03-21T19:30:00.000Z'),
        timeZone: 'Europe/Berlin',
        recurrence: { freq: 'weekly', count: 3 },
      },
      FAR_PAST,
      FAR_FUTURE,
    );
    expect(runs.map((r) => r.runDate)).toEqual(['2027-03-21', '2027-03-28', '2027-04-04']);
    expect(runs[0].start.toISOString()).toBe('2027-03-21T18:00:00.000Z'); // 19:00 CET
    expect(runs[1].start.toISOString()).toBe('2027-03-28T17:00:00.000Z'); // 19:00 CEST
    expect(runs[2].start.toISOString()).toBe('2027-04-04T17:00:00.000Z'); // 19:00 CEST
    runs.forEach((r) => expect(r.end.getTime() - r.start.getTime()).toBe(90 * 60 * 1000));
  });

  it('keeps the same local wall-clock time across the October 2027 fall-back', () => {
    // Berlin DST 2027 ends Sun 31 Oct (clocks fall back 03:00 CEST -> 02:00 CET).
    const runs = expandRuns(
      {
        startDate: new Date('2027-10-24T17:00:00.000Z'), // 19:00 CEST
        endDate: new Date('2027-10-24T18:00:00.000Z'),
        timeZone: 'Europe/Berlin',
        recurrence: { freq: 'weekly', count: 3 },
      },
      FAR_PAST,
      FAR_FUTURE,
    );
    expect(runs[0].start.toISOString()).toBe('2027-10-24T17:00:00.000Z'); // 19:00 CEST
    expect(runs[1].start.toISOString()).toBe('2027-10-31T18:00:00.000Z'); // 19:00 CET
    expect(runs[2].start.toISOString()).toBe('2027-11-07T18:00:00.000Z'); // 19:00 CET
  });
});

describe('registrationMatchesRun', () => {
  it('matches a registration with no runDate against a non-recurring target', () => {
    expect(registrationMatchesRun(undefined, null)).toBe(true);
    expect(registrationMatchesRun(null, undefined)).toBe(true);
  });

  it('does not match a registration with no runDate against a specific run', () => {
    expect(registrationMatchesRun(undefined, '2027-01-04')).toBe(false);
  });

  it('matches only the exact runDate', () => {
    expect(registrationMatchesRun('2027-01-04', '2027-01-04')).toBe(true);
    expect(registrationMatchesRun('2027-01-11', '2027-01-04')).toBe(false);
  });
});


describe('THE-379 — event time-zone date inputs', () => {
  it.each([
    ['2031-03-16T19:00', '2031-03-16T18:00:00.000Z'],
    ['2031-03-30T19:00', '2031-03-30T17:00:00.000Z'],
    ['2031-10-19T19:00', '2031-10-19T17:00:00.000Z'],
    ['2031-10-26T19:00', '2031-10-26T18:00:00.000Z'],
    ['2031-10-26T02:30', '2031-10-26T00:30:00.000Z'],
  ])('round-trips %s in Berlin with deterministic DST disambiguation', (wall, iso) => {
    const instant = parseEventDateTime(wall, 'Europe/Berlin');
    expect(instant.toISOString()).toBe(iso);
    expect(formatEventDateTime(instant, 'Europe/Berlin')).toBe(wall);
  });
  it('rejects a missing hour during spring-forward', () => {
    expect(() => parseEventDateTime('2031-03-30T02:30', 'Europe/Berlin')).toThrow('does not exist');
  });
  it('supports fractional offsets independent of the browser zone', () => {
    expect(parseEventDateTime('2031-03-30T19:00', 'Asia/Kathmandu').toISOString()).toBe('2031-03-30T13:15:00.000Z');
  });
});

describe('r9.8 bounded run expansion', () => {
  it('converts only the bounded next/last runs to instants for an old unending series', async () => {
    const real = Intl.DateTimeFormat;
    const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      return new real(...args);
    } as typeof Intl.DateTimeFormat);
    try {
      const { listEventRuns } = await import('../list-runs');
      const runs = listEventRuns({ startDate: new Date(Date.UTC(2031, 0, 6, 19)), endDate: new Date(Date.UTC(2031, 0, 6, 20)), timeZone: 'Europe/Berlin', recurrence: { freq: 'weekly' } }, new Date(Date.UTC(2040, 0, 1)));
      expect(runs).toHaveLength(4);
      expect(spy.mock.calls.length).toBeLessThan(25);
    } finally { spy.mockRestore(); }
  });
});
