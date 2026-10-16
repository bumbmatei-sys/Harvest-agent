'use client';

import { useEffect, useState } from 'react';

import type { DateLike } from '@/utils/format-date';
import type { Figure, Series } from '../dashboard/dashboard-data';

export const READ_FAILED = 'This read did not complete, so no figure can be shown.';
export const NO_TENANT = 'No ministry is in scope, so this cannot be read.';
import {
  HOME_KPI_ORDER,
  HOME_KPI_SOURCES,
  centsByDay,
  countDatedInWindow,
  sumCentsInWindow,
  type DatedCents,
  type HomeKpiId,
  type HomePeriod,
} from './home-kpis';

export interface HomeKpiCard {
  readonly id: HomeKpiId;
  readonly label: string;
  readonly collection: string;
  readonly field: string;
  readonly figure: Figure;
}

export interface HomeKpiState {
  readonly loading: boolean;
  readonly cards: readonly HomeKpiCard[];
  readonly givingByDay: Series;
}

const unavailable = (reason: string): { kind: 'unavailable'; reason: string } => ({ kind: 'unavailable', reason });

function pendingCards(): HomeKpiCard[] {
  return HOME_KPI_ORDER.map((id) => {
    const source = HOME_KPI_SOURCES[id];
    return {
      id,
      label: source.label,
      collection: source.collection,
      field: source.field,
      figure: unavailable(''),
    };
  });
}

const PENDING: HomeKpiState = {
  loading: true,
  cards: pendingCards(),
  givingByDay: unavailable(''),
};

function refused(reason: string): HomeKpiState {
  return {
    loading: false,
    cards: HOME_KPI_ORDER.map((id) => {
      const source = HOME_KPI_SOURCES[id];
      return {
        id,
        label: source.label,
        collection: source.collection,
        field: source.field,
        figure: unavailable(reason),
      };
    }),
    givingByDay: { kind: 'unavailable', reason },
  };
}

/**
 * Loads the four Home cards from the existing complete-read helpers.
 * No new collection and no unordered limit. A failed or partial read stays
 * `unavailable` — it is never shown as zero.
 */
export function useHomeKpis(tenantId: string | null, days: HomePeriod): HomeKpiState {
  const [readAt] = useState(() => Date.now());
  const [state, setState] = useState<HomeKpiState>(PENDING);

  useEffect(() => {
    let cancelled = false;
    setState(PENDING);

    if (!tenantId) {
      setState(refused(NO_TENANT));
      return;
    }

    (async () => {
      const {
        boundedInvoicesQuery,
        boundedScopedQuery,
        completeRead,
        invoicesQuery,
        readableReceipts,
        scopedQuery,
        toDatedRow,
        toInvoiceRow,
      } = await import('../dashboard/dashboard-data');
      const { boundedCheckinSessionsQuery, checkinSessionsQuery } = await import(
        '../dashboard/engagement-data'
      );

      const [members, contacts, invoices, sessions] = await Promise.all([
        completeRead(scopedQuery('users', tenantId), boundedScopedQuery('users', tenantId), toDatedRow),
        completeRead(scopedQuery('contacts', tenantId), boundedScopedQuery('contacts', tenantId), toDatedRow),
        completeRead(invoicesQuery(tenantId), boundedInvoicesQuery(tenantId), toInvoiceRow),
        completeRead(
          checkinSessionsQuery(tenantId),
          boundedCheckinSessionsQuery(tenantId),
          (data): { createdAt: DateLike } => ({ createdAt: (data.createdAt ?? null) as DateLike }),
        ),
      ]);

      if (cancelled) return;

      const memberFigure = members.kind === 'complete'
        ? countDatedInWindow(members.rows.map((row) => row.createdAt), readAt, days)
        : unavailable(members.reason);
      const contactFigure = contacts.kind === 'complete'
        ? countDatedInWindow(contacts.rows.map((row) => row.createdAt), readAt, days)
        : unavailable(contacts.reason);

      let givingFigure: Figure = unavailable(READ_FAILED);
      let givingByDay: Series = { kind: 'unavailable', reason: READ_FAILED };
      if (invoices.kind !== 'complete') {
        givingFigure = unavailable(invoices.reason);
        givingByDay = { kind: 'unavailable', reason: invoices.reason };
      } else {
        const money = readableReceipts(invoices.rows);
        if (money.kind !== 'complete') {
          givingFigure = unavailable(money.reason);
          givingByDay = { kind: 'unavailable', reason: money.reason };
        } else {
          const dated: DatedCents[] = money.rows.map((row) => ({
            amountCents: row.amountCents,
            at: row.issuedAt,
          }));
          givingFigure = sumCentsInWindow(dated, readAt, days);
          givingByDay = centsByDay(dated, readAt, days);
        }
      }

      const sessionFigure = sessions.kind === 'complete'
        ? countDatedInWindow(sessions.rows.map((row) => row.createdAt), readAt, days)
        : unavailable(sessions.reason);

      const byId: Record<HomeKpiId, Figure> = {
        newMembers: memberFigure,
        recordedGiving: givingFigure,
        newContacts: contactFigure,
        checkinSessions: sessionFigure,
      };

      setState({
        loading: false,
        cards: HOME_KPI_ORDER.map((id) => {
          const source = HOME_KPI_SOURCES[id];
          return {
            id,
            label: source.label,
            collection: source.collection,
            field: source.field,
            figure: byId[id],
          };
        }),
        givingByDay,
      });
    })().catch(() => {
      if (!cancelled) setState(refused(READ_FAILED));
    });

    return () => {
      cancelled = true;
    };
  }, [tenantId, days, readAt]);

  return state;
}
