import { authFetch } from '@/utils/auth-fetch';
import type { Event } from '@/hooks/queries/useEventQueries';

type EventUpdate = Partial<Omit<Event, 'id'>>;
export async function getSeriesEditLock(tenantId: string, eventId: string): Promise<boolean> {
  const response = await authFetch(`/api/events/edit?${new URLSearchParams({ tenantId, eventId })}`);
  const result = await response.json();
  if (!response.ok || typeof result.locked !== 'boolean') throw new Error(result.error || 'Could not check series registrations');
  return result.locked;
}

export async function saveEventEdit(tenantId: string, eventId: string, data: EventUpdate): Promise<void> {
  const serialized: Record<string, unknown> = { ...data };
  for (const key of ['startDate', 'endDate', 'registrationDeadline'] as const) {
    const value = data[key];
    if (value !== undefined) serialized[key] = value === null ? null : value.toDate().toISOString();
  }
  const response = await authFetch('/api/events/edit', {
    method: 'PATCH',
    body: JSON.stringify({ tenantId, eventId, data: serialized }),
  });
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error || 'Could not save event');
  }
}
