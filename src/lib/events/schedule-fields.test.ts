import { describe, expect, it } from 'vitest';
import { durationChoiceOf, durationLabel, endFor, timeLabel, timeSlots, withDate, withTime } from './schedule-fields';

describe("Eden's Date · Time · How long (#579)", () => {
  it('reads a start and end as a How long choice', () => {
    expect(durationChoiceOf('2031-03-16T18:00', '2031-03-16T19:00')).toBe('60');
    expect(durationChoiceOf('2031-03-16T18:00', '2031-03-16T19:30')).toBe('90');
    expect(durationChoiceOf('2031-03-16T23:30', '2031-03-17T00:15')).toBe('45');
    expect(durationChoiceOf('2031-03-16T18:00', '')).toBe('none');
    expect(durationChoiceOf('2031-03-16T18:00', '2031-03-16T18:50')).toBe('custom');
    expect(durationChoiceOf('2031-03-16T18:00:27', '2031-03-16T19:00:43')).toBe('custom');
    expect(durationChoiceOf('', '2031-03-16T19:00')).toBe('custom');
  });
  it('labels each choice', () => {
    expect(['15', '60', '90', '480', 'none', 'custom'].map(c => durationLabel(c as Parameters<typeof durationLabel>[0])))
      .toEqual(['15 minutes', '1 hour', '1.5 hours', '8 hours', 'No end time', 'Custom']);
  });
  it('adds a length on the wall clock, across midnight', () => {
    expect(endFor('2031-03-16T23:30', 60)).toBe('2031-03-17T00:30');
    expect(endFor('nonsense', 60)).toBe('');
  });
  it('replaces the day or the time and keeps the rest, including seconds', () => {
    expect(withDate('2031-03-16T18:00:27', '2031-04-01')).toBe('2031-04-01T18:00:27');
    expect(withDate('', '2031-04-01')).toBe('2031-04-01T18:00');
    expect(withDate('2031-03-16T18:00', '')).toBe('2031-03-16T18:00');
    expect(withTime('2031-03-16T18:00', '09:15', '2031-01-01')).toBe('2031-03-16T09:15');
    expect(withTime('', '09:15', '2031-01-01')).toBe('2031-01-01T09:15');
    expect(withTime('2031-03-16T18:00', 'bad', '2031-01-01')).toBe('2031-03-16T18:00');
  });
  it('offers every quarter hour, plus the start time when it is off the grid', () => {
    expect(timeSlots('')).toHaveLength(96);
    expect(timeSlots('')[0]).toBe('00:00');
    expect(timeSlots('2031-03-16T18:07')).toContain('18:07');
    expect(timeSlots('2031-03-16T18:07')).toHaveLength(97);
    expect(timeSlots('2031-03-16T18:15')).toHaveLength(96);
  });
  it('shows times the way Eden does', () => {
    expect(['00:00', '09:05', '12:00', '18:30'].map(timeLabel)).toEqual(['12:00 AM', '9:05 AM', '12:00 PM', '6:30 PM']);
  });
});
