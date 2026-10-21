import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Plunk's bounce and complaint feedback. Plunk does not sign webhook requests.
 * A workflow's webhook step sends whatever headers its owner configures, so the
 * authentication is a shared secret in `Authorization: Bearer <secret>`, set on
 * that step and compared here in constant time. The secret is the
 * `PLUNK_WEBHOOK_SECRET` environment variable; with it unset the route refuses
 * every request rather than accepting unauthenticated ones.
 */

export const WEBHOOK_SECRET_ENV = 'PLUNK_WEBHOOK_SECRET';

const digest = (value: string) => createHash('sha256').update(value).digest();

export function verifyWebhookSecret(authorization: string | null, secret: string): boolean {
  if (!secret || !authorization) return false;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!match) return false;
  // Both sides are hashed first so the comparison is over equal-length buffers whatever was sent.
  return timingSafeEqual(digest(match[1].trim()), digest(secret));
}

export type FeedbackKind = 'bounce' | 'complaint';

export interface PlunkFeedback {
  readonly email: string;
  readonly from: string;
  readonly emailId: string | null;
  readonly bounceType: string | null;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Reads Plunk's default webhook body (`contact.email`, `event.from`,
 * `event.emailId`, `event.bounceType`) and also a flat body with the same names,
 * for a step whose owner wrote a custom body.
 */
export function parseFeedback(raw: unknown): PlunkFeedback | null {
  const body = obj(raw);
  const event = obj(body.event);
  const email = text(obj(body.contact).email) ?? text(body.email);
  const from = text(event.from) ?? text(body.from);
  if (!email || !from) return null;
  return {
    email,
    from,
    emailId: text(event.emailId) ?? text(body.emailId),
    bounceType: text(event.bounceType) ?? text(body.bounceType),
  };
}

/** A soft bounce (full mailbox, out of office) is neither suppressed nor counted. Unknown types are treated as permanent, as Plunk does. */
export function isTransientBounce(bounceType: string | null): boolean {
  return (bounceType ?? '').toLowerCase() === 'transient';
}

/** Identifies one provider event, so a redelivery counts once. Without an email id, one address counts once a month. */
export function feedbackEventKey(feedback: PlunkFeedback, month: string): string {
  return feedback.emailId ?? `${month}:${digest(feedback.email.toLowerCase()).toString('hex')}`;
}
