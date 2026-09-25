import { describe, it, expect } from 'vitest';
import {
  CRM_EXPORT_HEADERS,
  CRM_EXPORT_ROW_CAP,
  contactToCrmExportRecord,
  crmExportFilename,
  crmExportRowCap,
  exportTenantIdOf,
  guardCrmCsvCell,
  renderCrmCsv,
  type CrmExportContact,
  type CrmExportRecord,
} from '../crm-export';

const blank = (over: Partial<CrmExportRecord> = {}): CrmExportRecord => ({
  name: 'Ada',
  email: 'ada@example.com',
  church: 'Grace',
  tenantId: 'grace',
  role: 'user',
  signedUp: '2020-06-15T08:30:00.000Z',
  newsletter: 'opted_in',
  optInUpdatedAt: '2020-06-15T08:30:00.000Z',
  optInSource: 'signup-email',
  ...over,
});

const contact = (over: Partial<CrmExportContact> = {}): CrmExportContact => ({
  firstName: 'Ada',
  lastName: 'In',
  email: 'ada@example.com',
  type: 'member',
  tenantId: 'grace',
  ...over,
});

const unquote = (cell: string) => cell.slice(1, -1);

describe('CRM newsletter CSV', () => {
  it("names the ACCOUNT's church for a platform contact that folded a member", () => {
    // A platform `contacts` row carries tenantId 'harvest'; the member it folded
    // belongs to 'hope'. The export must say 'hope', or every folded member of
    // a church reads as a Harvest-platform person.
    const folded = contact({
      tenantId: 'harvest',
      account: { role: 'user', email: 'ada@example.com' },
      accountProfile: {
        tenantId: 'hope',
        createdAt: null, newsletterOptIn: true, newsletterOptInAt: null, newsletterOptInSource: null,
      },
    });
    expect(exportTenantIdOf(folded)).toBe('hope');
    expect(contactToCrmExportRecord(folded, 'Hope').tenantId).toBe('hope');
    // A donor-only row has no account, so its own tenant stands.
    expect(exportTenantIdOf(contact({ tenantId: 'harvest', type: 'donor' }))).toBe('harvest');
  });

  it('writes the header in order', () => {
    const header = renderCrmCsv([]).split('\n')[0];
    expect(header.split(',').map(unquote)).toEqual([...CRM_EXPORT_HEADERS]);
    expect(header).toBe(CRM_EXPORT_HEADERS.map(guardCrmCsvCell).join(','));
  });

  it('maps opted in, opted out, unknown, and a donor-only blank', () => {
    const inRow = contactToCrmExportRecord(contact({
      account: { role: 'user', email: 'ada@example.com' },
      accountProfile: {
        createdAt: '2020-06-15T08:30:00.000Z',
        newsletterOptIn: true,
        newsletterOptInAt: '2020-06-15T08:30:00.000Z',
        newsletterOptInSource: 'signup-email',
      },
    }), 'Grace Church');
    expect(inRow).toMatchObject({
      name: 'Ada In',
      email: 'ada@example.com',
      church: 'Grace Church',
      tenantId: 'grace',
      role: 'user',
      signedUp: '2020-06-15T08:30:00.000Z',
      newsletter: 'opted_in',
      optInUpdatedAt: '2020-06-15T08:30:00.000Z',
      optInSource: 'signup-email',
    });

    const outRow = contactToCrmExportRecord(contact({
      firstName: 'Bob', lastName: 'Out',
      account: { role: 'admin', email: 'bob@example.com' },
      accountProfile: {
        createdAt: null, newsletterOptIn: false, newsletterOptInAt: null, newsletterOptInSource: 'signup-google',
      },
    }), '');
    expect(outRow.newsletter).toBe('opted_out');
    expect(outRow.role).toBe('admin');

    const unknownContact = contact({
      account: { role: '', email: 'cara@example.com' },
      accountProfile: {
        createdAt: null, newsletterOptIn: null, newsletterOptInAt: null, newsletterOptInSource: null,
      },
    });
    const unknown = contactToCrmExportRecord(
      Object.assign(unknownContact, { newsletter: true, newsletterOptIn: true }),
      'Harvest',
    );
    expect(unknown.newsletter).toBe('unknown');

    const donor = contactToCrmExportRecord(
      Object.assign(contact({
        firstName: 'Dan', lastName: 'Donor', type: 'donor', email: 'dan@example.com',
      }), { newsletterOptIn: true }),
      '',
    );
    expect(donor.newsletter).toBe('');
    expect(donor.role).toBe('');
    expect(donor.signedUp).toBe('');
    expect(donor.optInSource).toBe('');
  });

  it('escapes formula prefixes and doubles quotes', () => {
    const csv = renderCrmCsv([
      blank({ name: '=cmd' }),
      blank({ name: '+cmd' }),
      blank({ name: '-cmd' }),
      blank({ name: '@cmd' }),
      blank({ name: '\tcmd' }),
      blank({ name: '\rcmd' }),
      blank({ name: 'Say "hi"' }),
    ]);
    const lines = csv.trimEnd().split('\n').slice(1);
    const nameOf = (line: string) => line.split(',')[0];
    expect(nameOf(lines[0])).toBe(`"'=cmd"`);
    expect(nameOf(lines[1])).toBe(`"'+cmd"`);
    expect(nameOf(lines[2])).toBe(`"'-cmd"`);
    expect(nameOf(lines[3])).toBe(`"'@cmd"`);
    expect(nameOf(lines[4])).toBe(`"'\tcmd"`);
    expect(nameOf(lines[5])).toBe(`"'\rcmd"`);
    expect(nameOf(lines[6])).toBe(`"Say ""hi"""`);
  });

  it('names the file from the filter and a UTC day, and publishes the cap', () => {
    const day = new Date('2020-01-15T23:30:00.000Z');
    expect(crmExportFilename('all', day)).toBe('harvest-crm-newsletter-all-2020-01-15.csv');
    expect(crmExportFilename('in', day)).toBe('harvest-crm-newsletter-opted-in-2020-01-15.csv');
    expect(crmExportFilename('out', day)).toBe('harvest-crm-newsletter-opted-out-2020-01-15.csv');
    expect(crmExportFilename('unknown', day)).toBe('harvest-crm-newsletter-unknown-2020-01-15.csv');
    expect(crmExportRowCap()).toBe(CRM_EXPORT_ROW_CAP);
    expect(CRM_EXPORT_ROW_CAP).toBe(50_000);
  });
});
