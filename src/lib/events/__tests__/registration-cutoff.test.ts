import { describe, expect, it } from 'vitest';
import { registrationClosed, registrationCutoffHours, runRegistrationOpen } from '../registration-cutoff';
import { expandRuns } from '../recurrence';

const stamp = (iso: string) => ({ toDate: () => new Date(iso) });
describe('per-run registration cutoff', () => {
  const event = { startDate: stamp('2031-03-23T09:00:00Z'), endDate: stamp('2031-03-23T10:00:00Z'),
    timeZone: 'Europe/Berlin', recurrence: { freq: 'weekly' as const, count: 3 } };
  it.each([
    ['2031-03-23', '2031-03-23T07:00:00Z'],
    ['2031-03-30', '2031-03-30T06:00:00Z'],
    ['2031-04-06', '2031-04-06T06:00:00Z'],
  ])('defaults to 2 elapsed hours for %s across spring DST', (runDate, cutoff) => {
    expect(registrationClosed(event, runDate, new Date(Date.parse(cutoff) - 1))).toBe(false);
    expect(registrationClosed(event, runDate, new Date(cutoff))).toBe(true);
    expect(registrationClosed(event, runDate, new Date(Date.parse(cutoff) + 1))).toBe(true);
  });
  it.each([
    ['2031-10-19', '2031-10-18T23:30:00Z'],
    ['2031-10-26', '2031-10-26T00:30:00Z'],
  ])('subtracts real hours through autumn DST for %s', (runDate, cutoff) => {
    const autumn = { ...event, startDate: stamp('2031-10-19T01:30:00Z'), endDate: stamp('2031-10-19T02:30:00Z') };
    expect(registrationClosed(autumn, runDate, new Date(Date.parse(cutoff) - 1))).toBe(false);
    expect(registrationClosed(autumn, runDate, new Date(cutoff))).toBe(true);
  });
  it('ignores the retired series-wide deadline and applies the admin offset independently to later runs', () => {
    const edited = { ...event, registrationCutoffHours: 4.5, registrationDeadline: stamp('2030-01-01T00:00:00Z') };
    expect(registrationClosed(edited, '2031-03-30', new Date('2031-03-30T03:29:59.999Z'))).toBe(false);
    expect(registrationClosed(edited, '2031-03-30', new Date('2031-03-30T03:30:00Z'))).toBe(true);
    expect(registrationClosed(edited, '2031-04-06', new Date('2031-03-30T09:00:00Z'))).toBe(false);
  });
  it('the picker predicate agrees with the server for each resolved run', () => {
    const runs = expandRuns({ ...event, startDate: event.startDate.toDate(), endDate: event.endDate.toDate() },
      new Date('2031-03-01'), new Date('2031-04-10'));
    expect(runs).toHaveLength(3);
    for (const run of runs) {
      const cutoff = new Date(run.start.getTime() - 2 * 3600000);
      for (const delta of [-1, 0, 1]) {
        const now = new Date(cutoff.getTime() + delta);
        expect(runRegistrationOpen(run.start, undefined, now)).toBe(!registrationClosed(event, run.runDate, now));
      }
    }
  });
  it('fails closed for invalid, missing and cancelled runs', () => {
    for (const date of [null, 'not-a-date', '2031-03-24']) expect(registrationClosed(event, date, new Date('2030-01-01'))).toBe(true);
    expect(registrationClosed({ ...event, recurrence: { ...event.recurrence, cancelledRuns: ['2031-03-30'] } }, '2031-03-30', new Date('2030-01-01'))).toBe(true);
  });
  it('keeps optional one-off deadlines and the existing inclusive boundary', () => {
    const single = { registrationDeadline: stamp('2031-03-23T07:00:00Z') };
    expect(registrationClosed({}, null)).toBe(false);
    expect(registrationClosed(single, null, new Date('2031-03-23T07:00:00Z'))).toBe(false);
    expect(registrationClosed(single, null, new Date('2031-03-23T07:00:00.001Z'))).toBe(true);
  });
  it.each([-1, NaN, Infinity, '2'])('refuses invalid configured offsets: %s', value => {
    expect(() => registrationCutoffHours(value)).toThrow();
  });
});
