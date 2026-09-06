/**
 * THE-308 — the month view's read, as a query.
 *
 * A NEW hook rather than a change to {@link useEvents}: the list's read is
 * ordered and truncated on purpose, THE-317 pins both halves of it, and the
 * rota's completeness proof depends on its limit. The two reads answer
 * different questions and keep different guarantees — see `month-view.ts`.
 */
import { useQuery } from '@tanstack/react-query';

import { readMonthEvents, type MonthRead } from '../../components/events/month-view';

export const useMonthEvents = (tenantId: string | null | undefined, isAuthReady = true) =>
  useQuery({
    queryKey: ['eventsMonth', tenantId],
    queryFn: async (): Promise<MonthRead> => {
      if (!tenantId) return { kind: 'unavailable', reason: 'No church selected' };
      return readMonthEvents(tenantId);
    },
    enabled: isAuthReady && !!tenantId,
    staleTime: 1000 * 60 * 5,
  });
