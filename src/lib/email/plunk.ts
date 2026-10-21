import 'server-only';

import {
  EmailProviderError,
  type DnsRecord,
  type DomainState,
  type DomainStatus,
  type EmailProvider,
  type OutboundEmail,
  type SendResult,
} from '@/lib/email/provider';

/**
 * Plunk implementation of EmailProvider. Server-only; the key never reaches a
 * client. `fetchImpl` is injected so tests never touch the network.
 *
 * Shapes below were checked against Plunk's API reference
 * (docs.useplunk.com/api-reference/overview) and its open-source API at
 * github.com/useplunk/plunk, apps/api/src/controllers/{Actions,Domains}.ts,
 * commit cddfbdf (2026-10-18). Nothing here has been run against a live key.
 *
 *  - Base URL `https://next-api.useplunk.com`, `Authorization: Bearer sk_...`.
 *  - POST /v1/send -> 200 { success, data: { emails: [{ contact: { id, email }, email: <id> }], timestamp } }.
 *    Failures are { success: false, error: { code, message, statusCode, requestId } }.
 *  - Domains are per Plunk project, and the project is the API key's:
 *    POST /domains { domain } -> 201 the domain row ({ id, domain, verified, dkimTokens }),
 *    or 400/403 { error } when the domain is already linked;
 *    GET /domains/project/:projectId -> the project's domain rows (the id in the path is ignored);
 *    GET /domains/:id/verify -> { domain, tokens, status: 'Pending'|'Success'|'Failed', verified }.
 *  - The DNS records Plunk asks for are the DKIM CNAMEs derived from the tokens:
 *    `<token>._domainkey.<domain>` -> `<token>.dkim.amazonses.com`.
 */

export const PLUNK_API_BASE = 'https://next-api.useplunk.com';
/** Every request to Plunk gives up after this long, so one hung call cannot hold a send or a request open. */
export const PLUNK_TIMEOUT_MS = 15_000;

export interface PlunkOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const oneLine = (v: string) => v.replace(/[\r\n]+/g, ' ').trim();

/** Plunk's own error envelope, reduced to a code. The message is not passed on: it can name another project. */
async function errorCode(res: Response): Promise<string | null> {
  const body = await res.json().catch(() => null);
  const code = isObject(body) && isObject(body.error) ? body.error.code : null;
  return typeof code === 'string' ? code : null;
}

function recordsOf(tokens: unknown, domain: string): DnsRecord[] {
  if (!Array.isArray(tokens)) return [];
  return tokens
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
    .map((t) => ({ type: 'CNAME', name: `${t}._domainkey.${domain}`, value: `${t}.dkim.amazonses.com` }));
}

function stateOf(row: Json): DomainState {
  if (row.verified === true || row.status === 'Success') return 'verified';
  if (row.status === 'Failed') return 'failed';
  return 'pending';
}

export function createPlunkProvider(options: PlunkOptions): EmailProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = (options.baseUrl ?? PLUNK_API_BASE).replace(/\/$/, '');
  const timeoutMs = options.timeoutMs ?? PLUNK_TIMEOUT_MS;
  const headers = { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' };

  /** The one place a request leaves this file. The signal covers the body read as well as the connect. */
  async function call(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchImpl(`${base}${path}`, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new EmailProviderError(`Plunk did not answer within ${Math.round(timeoutMs / 1000)} seconds.`, 'timeout');
      }
      throw new EmailProviderError(error instanceof Error ? `Could not reach Plunk: ${error.message}` : 'Could not reach Plunk.', 'network');
    }
  }

  async function readJson(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new EmailProviderError(`Plunk did not answer within ${Math.round(timeoutMs / 1000)} seconds.`, 'timeout');
      }
      throw new EmailProviderError('Plunk answered with something that is not JSON.', 'http', res.status);
    }
  }

  async function domainRows(): Promise<Json[]> {
    const res = await call('/domains/project/current', { method: 'GET' });
    if (!res.ok) {
      const code = await errorCode(res);
      throw new EmailProviderError(`Plunk domain request failed (${res.status}${code ? `, ${code}` : ''}).`, 'http', res.status);
    }
    const body = await readJson(res);
    const rows = Array.isArray(body) ? body : isObject(body) && Array.isArray(body.data) ? body.data : null;
    if (!rows) throw new EmailProviderError('Plunk answered the domain list with an unexpected shape.', 'http', res.status);
    return rows.filter(isObject);
  }

  async function findRow(domain: string): Promise<Json | null> {
    return (await domainRows()).find((r) => typeof r.domain === 'string' && r.domain.toLowerCase() === domain.toLowerCase()) ?? null;
  }

  function statusOfRow(row: Json, domain: string): DomainStatus {
    return { domain, state: stateOf(row), records: recordsOf(row.dkimTokens ?? row.tokens, domain) };
  }

  async function verify(row: Json, domain: string): Promise<DomainStatus> {
    const id = typeof row.id === 'string' ? row.id : '';
    if (!id) throw new EmailProviderError('Plunk answered a domain without an id.', 'http');
    const res = await call(`/domains/${encodeURIComponent(id)}/verify`, { method: 'GET' });
    if (!res.ok) throw new EmailProviderError(`Plunk domain check failed (${res.status}).`, 'http', res.status);
    const body = await readJson(res);
    if (!isObject(body)) throw new EmailProviderError('Plunk answered the domain check with an unexpected shape.', 'http', res.status);
    return statusOfRow({ ...row, ...body }, domain);
  }

  async function create(domain: string): Promise<DomainStatus> {
    const res = await call('/domains', { method: 'POST', body: JSON.stringify({ domain }) });
    if (!res.ok) throw new EmailProviderError(`Plunk could not add the domain (${res.status}).`, 'http', res.status);
    const body = await readJson(res);
    if (!isObject(body)) throw new EmailProviderError('Plunk answered the new domain with an unexpected shape.', 'http', res.status);
    return statusOfRow(body, domain);
  }

  return {
    name: 'plunk',

    async send(message: OutboundEmail): Promise<SendResult> {
      let res: Response;
      try {
        res = await call('/v1/send', {
          method: 'POST',
          body: JSON.stringify({
            to: message.to,
            subject: oneLine(message.subject),
            body: message.html,
            from: { name: oneLine(message.fromName), email: message.fromAddress },
            reply: message.replyTo ?? undefined,
            headers: message.headers,
          }),
        });
      } catch (error) {
        const timedOut = error instanceof EmailProviderError && error.kind === 'timeout';
        return { ok: false, error: error instanceof Error ? error.message : 'Network error', retryable: true, ...(timedOut ? { maybeDelivered: true } : {}) };
      }
      if (res.ok) {
        const body = await res.json().catch(() => null);
        const emails = isObject(body) && isObject(body.data) && Array.isArray(body.data.emails) ? body.data.emails : [];
        const first = emails[0];
        const id = isObject(first) && typeof first.email === 'string' ? first.email : null;
        return { ok: true, id };
      }
      const code = await errorCode(res);
      const retryable = res.status === 429 || res.status >= 500;
      return { ok: false, error: `Plunk answered ${res.status}${code ? ` (${code})` : ''}.`, retryable };
    },

    async findDomain(domain: string) {
      const row = await findRow(domain);
      return row ? statusOfRow(row, domain) : null;
    },

    async registerDomain(domain: string) {
      const row = await findRow(domain);
      return row ? verify(row, domain) : create(domain);
    },

    async getDomainStatus(domain: string) {
      const row = await findRow(domain);
      return row ? verify(row, domain) : create(domain);
    },
  };
}
