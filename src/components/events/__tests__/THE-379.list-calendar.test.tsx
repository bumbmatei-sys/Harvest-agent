import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('@/components/ui/calendar', () => ({
  Calendar: (props: any) => <div>
    <output>{props.modifiers.hasEvents.map((day: Date) => day.getDate()).join(',')}</output>
    <button onClick={() => props.onMonthChange(new Date(2031, 3, 1))}>April</button>
  </div>,
  CalendarDayButton: () => null,
}));
vi.mock('@/firebase', () => ({ db: {} }));

import EventListCalendar, { runsByMonthDay } from '../EventListCalendar';
import { toMonthEvent } from '../month-view';

const weekly = () => toMonthEvent({
  title: 'Weekly', status: 'published', timeZone: 'Asia/Tokyo',
  startDate: { toDate: () => new Date(Date.UTC(2031, 2, 16, 23, 30)) },
  endDate: { toDate: () => new Date(Date.UTC(2031, 2, 17, 0, 30)) },
  recurrence: { freq: 'weekly', count: 4, cancelledRuns: ['2031-03-24'] },
}, 'weekly');

describe('r9.6/7 month dots use all run days in the event zone', () => {
  it('r9.6 marks later runs and updates the bounded expansion when the month changes', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2031, 2, 1));
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      act(() => root.render(<EventListCalendar read={{ kind: 'complete', events: [weekly()], undated: 0 }} onSelect={() => {}} />));
      expect(container.querySelector('output')?.textContent).toBe('17,31');
      act(() => container.querySelector('button')!.click());
      expect(container.querySelector('output')?.textContent).toBe('7');
    } finally { act(() => root.unmount()); vi.useRealTimers(); }
  });
  it('r9.7 buckets the civil day in the event zone and legacy browser zone', () => {
    const keys = [...runsByMonthDay([weekly()], new Date(2031, 2, 1)).keys()];
    expect(keys).toEqual(['2031-03-17', '2031-03-31']);
    const pacific = { ...weekly(), recurrence: null, timeZone: 'America/Los_Angeles', start: new Date(Date.UTC(2031, 2, 17, 1)), end: new Date(Date.UTC(2031, 2, 17, 2)) };
    expect([...runsByMonthDay([pacific], new Date(2031, 2, 1)).keys()]).toEqual(['2031-03-16']);
    const original = Intl.DateTimeFormat.prototype.resolvedOptions;
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...original.call(this), timeZone: 'America/Los_Angeles' };
    });
    try {
      const single = { ...weekly(), timeZone: null, recurrence: null, start: new Date(Date.UTC(2031, 2, 17, 1)) };
      expect([...runsByMonthDay([single], new Date(2031, 2, 1)).keys()]).toEqual(['2031-03-16']);
    } finally { spy.mockRestore(); }
  });
});
