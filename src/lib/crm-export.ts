/**
 * Founder CRM newsletter CSV. Pure — the route streams what this builds.
 * `escapeCsvValue` (signups export) quotes every cell and prefixes `= + - @`.
 * Tab and CR are prefixed here first, because that helper does not cover them
 * (OWASP CSV injection). Do not edit the shared helper: the Signups export
 * is a pinned interface.
 */
import { escapeCsvValue } from './signups-export';
import { newsletterStatusOf, type NewsletterFilter } from './newsletter-consent';
import type { CrmFilterable } from './crm-filter';

export const CRM_EXPORT_HEADERS = [
  'Name',
  'Email',
  'Church',
  'Tenant ID',
  'Role',
  'Signed up',
  'Newsletter',
  'Opt-in updated at',
  'Opt-in source',
] as const;

/** Hard cap after filtering. Over the cap the route returns 413, never a short file. */
export const CRM_EXPORT_ROW_CAP = 50_000;

/** Indirection so a test can lower the cap without building 50,001 rows. */
export function crmExportRowCap(): number {
  return CRM_EXPORT_ROW_CAP;
}

const FILE_SLUG: Record<NewsletterFilter, string> = {
  all: 'all',
  in: 'opted-in',
  out: 'opted-out',
  unknown: 'unknown',
};

export function crmExportFilename(newsletter: NewsletterFilter, now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  return `harvest-crm-newsletter-${FILE_SLUG[newsletter]}-${day}.csv`;
}

export interface CrmExportContact extends CrmFilterable {
  tenantId?: string;
  account?: { role: string; email: string };
  accountProfile?: {
    createdAt: string | null;
    newsletterOptIn: boolean | null;
    newsletterOptInAt: string | null;
    newsletterOptInSource: string | null;
  } | null;
}

export interface CrmExportRecord {
  name: string;
  email: string;
  church: string;
  tenantId: string;
  role: string;
  signedUp: string;
  newsletter: string;
  optInUpdatedAt: string;
  optInSource: string;
}

function newsletterCell(contact: CrmExportContact): string {
  const status = newsletterStatusOf(contact);
  if (status === 'in') return 'opted_in';
  if (status === 'out') return 'opted_out';
  if (status === 'unknown') return 'unknown';
  return '';
}

export function contactToCrmExportRecord(contact: CrmExportContact, church: string): CrmExportRecord {
  return {
    name: `${contact.firstName} ${contact.lastName}`.trim(),
    email: contact.email || '',
    church,
    tenantId: contact.tenantId || '',
    role: contact.account?.role ?? '',
    signedUp: contact.accountProfile?.createdAt ?? '',
    newsletter: newsletterCell(contact),
    optInUpdatedAt: contact.accountProfile?.newsletterOptInAt ?? '',
    optInSource: contact.accountProfile?.newsletterOptInSource ?? '',
  };
}

function recordCells(record: CrmExportRecord): string[] {
  return [
    record.name,
    record.email,
    record.church,
    record.tenantId,
    record.role,
    record.signedUp,
    record.newsletter,
    record.optInUpdatedAt,
    record.optInSource,
  ];
}

/** Prefix tab and CR before the shared escaper, which only covers `= + - @`. */
export function guardCrmCsvCell(value: string): string {
  const str = String(value ?? '');
  const guarded = /^[\t\r]/.test(str) ? `'${str}` : str;
  return escapeCsvValue(guarded);
}

export function renderCrmCsv(records: CrmExportRecord[]): string {
  const header = CRM_EXPORT_HEADERS.map(cell => guardCrmCsvCell(cell)).join(',');
  const lines = records.map(record => recordCells(record).map(guardCrmCsvCell).join(','));
  return [header, ...lines].join('\n') + '\n';
}

const STREAM_ROWS = 200;

/**
 * UTF-8 CSV body, header on the first chunk, BOM on the first bytes so Excel
 * reads names. Callers that are over the row cap must not call this — a
 * stream that stops early would be the truncated file the cap exists to forbid.
 */
export function crmCsvStream(records: CrmExportRecord[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  let started = false;
  return new ReadableStream({
    pull(controller) {
      if (!started) {
        started = true;
        const first = records.slice(0, STREAM_ROWS);
        controller.enqueue(encoder.encode('\uFEFF' + renderCrmCsv(first)));
        index = STREAM_ROWS;
        if (index >= records.length) controller.close();
        return;
      }
      if (index >= records.length) {
        controller.close();
        return;
      }
      const slice = records.slice(index, index + STREAM_ROWS);
      index += STREAM_ROWS;
      const body = slice.map(record => recordCells(record).map(guardCrmCsvCell).join(',')).join('\n') + '\n';
      controller.enqueue(encoder.encode(body));
      if (index >= records.length) controller.close();
    },
  });
}
