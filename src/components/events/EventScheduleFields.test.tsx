import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventScheduleFields } from './EventScheduleFields';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
afterEach(async () => { await act(async () => root.render(null)); document.querySelectorAll('[role="listbox"]').forEach(n => n.remove()); });

async function render(start: string, end: string, onChange = vi.fn(), locked = false) {
  await act(async () => root.render(<EventScheduleFields start={start} end={end} locked={locked} today="2031-01-01" fieldClass="" timeZoneField={<p>zone</p>} onChange={onChange} />));
  return onChange;
}
async function pick(trigger: string, option: string) {
  await act(async () => { (host.querySelector(`[aria-label="${trigger}"]`) as HTMLElement).click(); });
  const choice = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(e => e.textContent === option)!;
  expect(choice, option).toBeTruthy();
  await act(async () => { choice.focus(); choice.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
}
async function typeDate(value: string) {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Date"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('EventScheduleFields (#579)', () => {
  it('shows the day, the time, the length and the zone', async () => {
    await render('2031-03-16T18:00', '2031-03-16T19:30');
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Date"]')!.value).toBe('2031-03-16');
    expect(host.querySelector('[aria-label="Time"]')!.textContent).toContain('6:00 PM');
    expect(host.querySelector('[aria-label="How long"]')!.textContent).toContain('1.5 hours');
    expect(host.textContent).toContain('zone');
    expect(host.querySelector('input[aria-label="Ends"]')).toBeNull();
  });
  it('keeps the chosen length when the day or the time moves', async () => {
    const onChange = await render('2031-03-16T18:00', '2031-03-16T19:30');
    await typeDate('2031-04-02');
    expect(onChange).toHaveBeenLastCalledWith({ start: '2031-04-02T18:00', end: '2031-04-02T19:30' });
    await pick('Time', '11:15 PM');
    expect(onChange).toHaveBeenLastCalledWith({ start: '2031-03-16T23:15', end: '2031-03-17T00:45' });
  });
  it('sets the end from the length, clears it for no end, and shows an end field for custom', async () => {
    const onChange = await render('2031-03-16T18:00', '2031-03-16T19:00');
    await pick('How long', '3 hours');
    expect(onChange).toHaveBeenLastCalledWith({ start: '2031-03-16T18:00', end: '2031-03-16T21:00' });
    await pick('How long', 'No end time');
    expect(onChange).toHaveBeenLastCalledWith({ start: '2031-03-16T18:00', end: '' });
    // Custom starts from the end already set, not a fresh hour.
    await render('2031-03-16T18:00', '2031-03-16T21:00', onChange);
    await pick('How long', 'Custom');
    expect(onChange).toHaveBeenLastCalledWith({ start: '2031-03-16T18:00', end: '2031-03-16T21:00' });
    await render('2031-03-16T18:00', '2031-03-16T18:50', onChange);
    expect(host.querySelector('[aria-label="How long"]')!.textContent).toContain('Custom');
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Ends"]')!.value).toBe('2031-03-16T18:50');
    // A custom end stays put when the start moves.
    await typeDate('2031-03-17');
    expect(onChange).toHaveBeenLastCalledWith({ start: '2031-03-17T18:00', end: '2031-03-16T18:50' });
  });
  it('locks the day of a registered series but not its time', async () => {
    await render('2031-03-16T18:00', '2031-03-16T19:00', vi.fn(), true);
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Date"]')!.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Time"]')!.disabled).toBe(false);
  });
});
