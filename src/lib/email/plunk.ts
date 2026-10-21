import 'server-only';

import type {
  DnsRecord,
  DomainState,
  DomainStatus,
  EmailProvider,
  OutboundEmail,
  SendResult,
} from '@/lib/email/provider';

/**
 * Plunk implementation of EmailProvider. Server-only; the key never reaches a
 * client. `fetchImpl` is injected so tests never touch the network.
 *
 * TODO(plunk-docs): the send endpoint follows Plunk's public `POST /v1/send`.
 * The domain endpoints below are the shape Plunk's dashboard uses; confirm the
 * paths and the DNS record fields against the live API reference before the
 * first real domain is verified. Every field read here is defensive on purpose.
 */

export const PLUNK_API_BASE = 'https://api.useplunk.com';

export interface PlunkOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

function stateOf(raw: unknown): DomainState {
  if (raw === true || raw === 'verified' || raw === 'success') return 'verified';
  if (raw === 'failed' || raw === 'error') return 'failed';
  return 'pending';
}

function recordsOf(raw: unknown): DnsRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: DnsRecord[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    const type = typeof r.type === 'string' ? r.type : '';
    const name = typeof r.name === 'string' ? r.name : '';
    const value = typeof r.value === 'string' ? r.value : '';
    if (type && name && value) out.push({ type, name, value });
  }
  return out;
}

export function createPlunkProvider(options: PlunkOptions): EmailProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = (options.baseUrl ?? PLUNK_API_BASE).replace(/\/$/, '');
  const auth = { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' };

  async function domainCall(path: string, init: RequestInit, domain: string): Promise<DomainStatus> {
    const res = await fetchImpl(`${base}${path}`, { ...init, headers: auth });
    if (!res.ok) throw new Error(`Plunk domain request failed (${res.status}).`);
    const data = (await res.json()) as Record<string, unknown>;
    const body = (data.data && typeof data.data === 'object' ? data.data : data) as Record<string, unknown>;
    return { domain, state: stateOf(body.verified ?? body.status), records: recordsOf(body.dnsRecords ?? body.records) };
  }

  return {
    name: 'plunk',

    async send(message: OutboundEmail): Promise<SendResult> {
      let res: Response;
      try {
        res = await fetchImpl(`${base}/v1/send`, {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({
            to: message.to,
            subject: message.subject,
            body: message.html,
            subscribed: true,
            name: message.fromName,
            from: message.fromAddress,
            reply: message.replyTo ?? undefined,
            headers: message.headers,
          }),
        });
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Network error', retryable: true };
      }
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const id = typeof data.id === 'string' ? data.id : null;
        return { ok: true, id };
      }
      const retryable = res.status === 429 || res.status >= 500;
      return { ok: false, error: `Plunk answered ${res.status}.`, retryable };
    },

    registerDomain(domain: string) {
      return domainCall('/domains', { method: 'POST', body: JSON.stringify({ domain }) }, domain);
    },

    getDomainStatus(domain: string) {
      return domainCall(`/domains?domain=${encodeURIComponent(domain)}`, { method: 'GET' }, domain);
    },
  };
}
