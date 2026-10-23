import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { normalizeEmail } from '@/lib/donation-history';
import { isSuppressed, type EmailStatus } from '@/lib/email/audience';

/**
 * The public newsletter subscribe form, with double opt-in.
 *
 * A visitor gives a name and an address. That is NOT consent to be emailed: it
 * only creates a CRM contact with no email status, and mails a confirmation link
 * to that address. The contact becomes `subscribed` when the link is opened, so
 * nobody can enrol somebody else's address, and `resolveAudience` (which only
 * ever reaches `subscribed` contacts) never sends to a pending one.
 *
 * Nothing here reveals whether an address is already on the list. A repeat
 * request, a subscribed address and a suppressed address all answer the same
 * `sent: false` success, and the route turns every success into the same words.
 */

export const CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_NAME_LENGTH = 80;
export const MAX_EMAIL_LENGTH = 200;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface PendingContact {
  readonly status: EmailStatus;
  readonly tokenHash: string | null;
  readonly expiresAt: string | null;
}

export interface SubscribeStore {
  /** The ministry's name, or null when there is no such ministry or it is not taking sign-ups. */
  getTenant(tenantId: string): Promise<{ name: string } | null>;
  /** Every CRM contact of this ministry that carries the (normalised) address. */
  findContacts(tenantId: string, email: string): Promise<readonly { id: string; status: EmailStatus; pending: boolean }[]>;
  createPending(tenantId: string, input: { email: string; firstName: string; lastName: string; tokenHash: string; expiresAt: string; at: string }): Promise<string>;
  refreshPending(tenantId: string, contactId: string, input: { tokenHash: string; expiresAt: string }): Promise<void>;
  getPending(tenantId: string, contactId: string): Promise<PendingContact | null>;
  /** Marks the contact subscribed, source `form`, and clears the token. */
  confirm(tenantId: string, contactId: string, at: string): Promise<void>;
}

export interface SubscribeDeps {
  readonly store: SubscribeStore;
  readonly sendConfirmation: (input: { to: string; tenantName: string; confirmUrl: string }) => Promise<{ ok: boolean; error?: string }>;
  /** Origin the confirmation link points at, no trailing slash. */
  readonly origin: string;
  readonly now?: () => Date;
  readonly newSecret?: () => string;
}

export type SubscribeFailure = 'invalid_name' | 'invalid_email' | 'tenant_unavailable' | 'send_failed';

export type SubscribeResult =
  | { readonly ok: true; readonly sent: boolean }
  | { readonly ok: false; readonly code: SubscribeFailure; readonly message: string };

const FAILURES: Readonly<Record<SubscribeFailure, string>> = {
  invalid_name: 'Please enter your name.',
  invalid_email: 'Please enter a valid email address.',
  tenant_unavailable: 'This ministry is not taking sign-ups right now.',
  send_failed: 'We could not send the confirmation email. Please try again in a little while.',
};

const fail = (code: SubscribeFailure): SubscribeResult => ({ ok: false, code, message: FAILURES[code] });

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function splitName(full: string): { firstName: string; lastName: string } {
  const [first = '', ...rest] = full.trim().split(/\s+/);
  return { firstName: first, lastName: rest.join(' ') };
}

/** `tenantId.contactId.secret`. The first two are not secret; the third is, and only its hash is stored. */
export function buildToken(tenantId: string, contactId: string, secret: string): string {
  return `${tenantId}.${contactId}.${secret}`;
}

export function parseToken(token: unknown): { tenantId: string; contactId: string; secret: string } | null {
  if (typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts.some((p) => !p)) return null;
  return { tenantId: parts[0], contactId: parts[1], secret: parts[2] };
}

function sameHash(stored: string, presentedSecret: string): boolean {
  const a = Buffer.from(stored, 'hex');
  const b = Buffer.from(hashSecret(presentedSecret), 'hex');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export async function requestSubscription(
  deps: SubscribeDeps,
  input: { tenantId: string; name: string; email: string },
): Promise<SubscribeResult> {
  const now = (deps.now ?? (() => new Date()))();
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name || name.length > MAX_NAME_LENGTH) return fail('invalid_name');
  const rawEmail = input.email.trim();
  if (!rawEmail || rawEmail.length > MAX_EMAIL_LENGTH || !EMAIL_SHAPE.test(rawEmail)) return fail('invalid_email');
  const email = normalizeEmail(rawEmail);

  const tenant = await deps.store.getTenant(input.tenantId);
  if (!tenant) return fail('tenant_unavailable');

  const existing = await deps.store.findContacts(input.tenantId, email);
  // Already on the list, or someone who unsubscribed, bounced or reported spam:
  // nothing is sent and nothing changes. A form must not undo an opt-out.
  if (existing.some((c) => c.status === 'subscribed' || isSuppressed(c.status))) return { ok: true, sent: false };

  const secret = (deps.newSecret ?? (() => randomBytes(24).toString('hex')))();
  const tokenHash = hashSecret(secret);
  const expiresAt = new Date(now.getTime() + CONFIRM_TTL_MS).toISOString();
  const at = now.toISOString();

  const pending = existing.find((c) => c.pending);
  let contactId: string;
  if (pending) {
    contactId = pending.id;
    await deps.store.refreshPending(input.tenantId, contactId, { tokenHash, expiresAt });
  } else {
    const { firstName, lastName } = splitName(name);
    contactId = await deps.store.createPending(input.tenantId, { email, firstName, lastName, tokenHash, expiresAt, at });
  }

  const confirmUrl = `${deps.origin}/api/email/subscribe/confirm?token=${encodeURIComponent(buildToken(input.tenantId, contactId, secret))}`;
  const sent = await deps.sendConfirmation({ to: email, tenantName: tenant.name, confirmUrl });
  // A confirmation that did not go out is a failure the visitor is told about:
  // "check your inbox" for a message that was never sent would be a quiet lie.
  if (!sent.ok) {
    console.error('[email-subscribe] confirmation not sent', { tenantId: input.tenantId, error: sent.error });
    return fail('send_failed');
  }
  return { ok: true, sent: true };
}

export type ConfirmResult = 'confirmed' | 'already' | 'expired' | 'invalid';

export async function confirmSubscription(deps: SubscribeDeps, token: unknown): Promise<ConfirmResult> {
  const parsed = parseToken(token);
  if (!parsed) return 'invalid';
  const pending = await deps.store.getPending(parsed.tenantId, parsed.contactId);
  if (!pending) return 'invalid';
  if (isSuppressed(pending.status)) return 'invalid';
  if (pending.status === 'subscribed') return 'already';
  if (!pending.tokenHash || !sameHash(pending.tokenHash, parsed.secret)) return 'invalid';
  const now = (deps.now ?? (() => new Date()))();
  if (!pending.expiresAt || Date.parse(pending.expiresAt) < now.getTime()) return 'expired';
  await deps.store.confirm(parsed.tenantId, parsed.contactId, now.toISOString());
  return 'confirmed';
}
