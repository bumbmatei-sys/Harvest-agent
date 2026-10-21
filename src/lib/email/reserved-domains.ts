import { HARVEST_SENDER_ADDRESS } from '@/lib/transactional-email';

/**
 * Domains Harvest itself owns. A ministry may not register one for sending, and
 * a settings document that already names one never gets a verified sender.
 * `theharvest.site` is the marketing site, `theharvest.app` the product; the
 * transactional sender's own domain is derived from its address so the two
 * cannot drift apart.
 */
const HARVEST_OWN = ['theharvest.site', 'theharvest.app'] as const;

export function domainOfAddress(value: string | null | undefined): string | null {
  const host = (value ?? '').trim().toLowerCase().replace(/^.*</, '').replace(/>.*$/, '').split('@').pop() ?? '';
  const clean = host.replace(/^https?:\/\//, '').replace(/[/:].*$/, '');
  return clean.includes('.') ? clean : null;
}

/** The built-in list plus any extra Harvest sending domains the deployment is configured with. */
export function harvestDomains(extra: readonly (string | null | undefined)[] = []): readonly string[] {
  const all = [...HARVEST_OWN, domainOfAddress(HARVEST_SENDER_ADDRESS), ...extra.map(domainOfAddress)];
  return [...new Set(all.filter((d): d is string => Boolean(d)))];
}

/**
 * True for a reserved domain, for any subdomain of one (`mail.theharvest.site`),
 * and for a domain whose sending host would land on one: a ministry registering
 * `example.org` sends from `mail.example.org`, so `example.org` is reserved when
 * Harvest sends from `mail.example.org`.
 */
export function isReservedDomain(domain: string, extra: readonly (string | null | undefined)[] = []): boolean {
  const d = domain.trim().toLowerCase().replace(/\.$/, '');
  const hosts = [d, `mail.${d}`];
  return harvestDomains(extra).some((r) => hosts.some((h) => h === r || h.endsWith(`.${r}`)));
}
