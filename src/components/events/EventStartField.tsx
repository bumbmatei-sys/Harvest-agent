import { Input } from '@/components/ui/input';

/** Split a locked civil day from its editable time without relying on disabled datetime inputs. */
export function EventStartField({ value, locked, onValueChange, className }: {
  value: string; locked: boolean; onValueChange: (value: string) => void; className: string;
}) {
  if (!locked) return <Input aria-label="Start date and time" type="datetime-local" value={value}
    onChange={event => onValueChange(event.target.value)} className={`h-auto min-h-11 sm:min-h-0 ${className}`} />;
  return (
    <div className="space-y-2">
      <Input aria-label="Start date" type="date" disabled value={value.slice(0, 10)} className={`h-auto min-h-11 sm:min-h-0 ${className}`} />
      <Input aria-label="Start time" type="time" value={value.slice(11)}
        onChange={event => onValueChange(`${value.slice(0, 10)}T${event.target.value}`)} className={`h-auto min-h-11 sm:min-h-0 ${className}`} />
    </div>
  );
}
