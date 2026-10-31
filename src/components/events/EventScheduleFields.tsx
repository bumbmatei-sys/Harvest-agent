'use client';
import type { ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  durationChoiceOf, durationLabel, endFor, EVENT_DURATIONS, timeLabel, timeSlots, withDate, withTime, type DurationChoice,
} from '@/lib/events/schedule-fields';

const DURATION_CHOICES: DurationChoice[] = [...EVENT_DURATIONS.map(m => `${m}` as DurationChoice), 'none', 'custom'];

const label = 'text-xs font-semibold text-body mb-1.5 block';

/**
 * Eden's Date · Time · How long · Time zone block (docs/prd/screenshots/07-events,
 * "New event"). A locked series keeps its day and lets only the time move,
 * as EventStartField did.
 */
export function EventScheduleFields({ start, end, locked, today, fieldClass, timeZoneField, onChange }: {
  start: string; end: string; locked: boolean; today: string; fieldClass: string;
  timeZoneField: ReactNode;
  onChange: (next: { start: string; end: string }) => void;
}) {
  const choice = durationChoiceOf(start, end);
  // Moving the start keeps the length the admin picked.
  const move = (nextStart: string) => {
    if (choice === 'none' || choice === 'custom') onChange({ start: nextStart, end });
    else onChange({ start: nextStart, end: endFor(nextStart, Number(choice)) });
  };
  const time = start.slice(11, 16);
  return <div data-event-schedule data-start={start} data-end={end} className="grid grid-cols-2 gap-x-4 gap-y-4">
    <div>
      <label className={label} htmlFor="event-date">Date</label>
      <Input id="event-date" aria-label="Date" type="date" disabled={locked} value={start.slice(0, 10)}
        onChange={event => move(withDate(start, event.target.value))} className={`h-auto min-h-11 sm:min-h-0 ${fieldClass}`} />
    </div>
    <div>
      <label className={label}>Time</label>
      <Select value={time || null} onValueChange={(value: unknown) => { if (typeof value === 'string') move(withTime(start, value, today)); }}>
        <SelectTrigger aria-label="Time" className={`w-full min-h-11 sm:min-h-0 ${fieldClass}`}>
          <SelectValue>{() => (time ? timeLabel(time) : 'Pick a time')}</SelectValue>
        </SelectTrigger>
        <SelectContent>{timeSlots(start).map(slot => <SelectItem key={slot} value={slot}>{timeLabel(slot)}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    <div>
      <label className={label}>How long</label>
      <Select value={choice} onValueChange={(value: unknown) => {
        if (value === 'none') onChange({ start, end: '' });
        else if (value === 'custom') onChange({ start, end: end || endFor(start, 60) });
        else if (typeof value === 'string') onChange({ start, end: endFor(start, Number(value)) });
      }}>
        <SelectTrigger aria-label="How long" className={`w-full min-h-11 sm:min-h-0 ${fieldClass}`}>
          <SelectValue>{() => durationLabel(choice)}</SelectValue>
        </SelectTrigger>
        <SelectContent>{DURATION_CHOICES.map(c => <SelectItem key={c} value={c}>{durationLabel(c)}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    <div>{timeZoneField}</div>
    {choice === 'custom' && <div className="col-span-2">
      <label className={label} htmlFor="event-ends">Ends</label>
      <Input id="event-ends" aria-label="Ends" type="datetime-local" value={end}
        onChange={event => onChange({ start, end: event.target.value })} className={`h-auto min-h-11 sm:min-h-0 ${fieldClass}`} />
    </div>}
  </div>;
}
