import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { EmailNotConfiguredError } from '@/lib/email/provider';

/**
 * Signed, stateless unsubscribe tokens.
 *
 * A token names one tenant and one address and is signed with a server
 * secret, so the public unsubscribe route can act on it without a login and
 * nobody can unsubscribe someone else by guessing. It never expires: an old
 * email must keep working.
 */

export interface UnsubscribePayload {
  readonly tenantId: string;
  readonly email: string;
  readonly broadcastId: string;
}

function secret(env: Readonly<Record<string, string | undefined>>): string {
  const value = (env.EMAIL_UNSUBSCRIBE_SECRET ?? env.PLUNK_API_KEY ?? '').trim();
  if (!value) throw new EmailNotConfiguredError('Unsubscribe signing is not configured.');
  return value;
}

function sign(body: string, env: Readonly<Record<string, string | undefined>>): string {
  return createHmac('sha256', secret(env)).update(body).digest('base64url');
}

export function signUnsubscribe(
  payload: UnsubscribePayload,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const body = Buffer.from(JSON.stringify([payload.tenantId, payload.email, payload.broadcastId])).toString('base64url');
  return `${body}.${sign(body, env)}`;
}

export function verifyUnsubscribe(
  token: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): UnsubscribePayload | null {
  const [body, mac, extra] = token.split('.');
  if (!body || !mac || extra !== undefined) return null;
  const expected = Buffer.from(sign(body, env));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 3 || !parsed.every((v) => typeof v === 'string' && v)) return null;
    return { tenantId: parsed[0], email: parsed[1], broadcastId: parsed[2] };
  } catch {
    return null;
  }
}

export function unsubscribeUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/api/email/unsubscribe?t=${encodeURIComponent(token)}`;
}

/** RFC 2369 + RFC 8058: a visible mailto-free HTTPS link and the one-click marker. */
export function listUnsubscribeHeaders(url: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
