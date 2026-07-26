/**
 * Gmail send-only scope policy.
 *
 * Harvest lets an admin send a one-off email to a CRM contact from their own
 * Gmail account. It must NEVER be able to read a church's inbox: this product
 * holds pastoral correspondence, and an OAuth grant that can list threads is
 * not recoverable after the fact — the church has already clicked "Allow".
 *
 * Composio's Gmail toolkit ships 61 tools (fetch emails, list threads, get
 * contacts, delete message, read settings…). Composio's own comparison table
 * describes a Composio-managed Gmail connection as granting "Full read and
 * write (managed authentication)". Its default scopes therefore cover reading
 * mail. Send-only IS reachable — `credentials.scopes` on an auth config is
 * honoured for both managed and custom (bring-your-own-OAuth-client) configs —
 * but ONLY if whoever creates the auth config sets it explicitly.
 *
 * "Set it explicitly in a dashboard" is not a guarantee. So the connect route
 * proves it in code, before the admin is ever redirected to Google:
 * `assertSendOnlyGmailScopes` re-reads the configured auth config from Composio
 * and refuses to start the OAuth flow unless the scopes it will request are a
 * subset of the allowlist below.
 *
 * The check FAILS CLOSED. An auth config that reports no scopes is refused,
 * because "no scopes configured" is precisely the case where Composio falls
 * back to its broad defaults.
 */

/** The only Gmail capability Harvest is allowed to ask for. */
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

/**
 * Scopes an auth config may request. `gmail.send` is the capability; the two
 * identity scopes carry no mailbox access and are what lets the callback record
 * WHICH address an admin connected, so the UI can show it and two admins in one
 * church can tell their connections apart.
 *
 * Anything not on this list — `gmail.readonly`, `gmail.modify`, `gmail.metadata`,
 * `mail.google.com/`, `contacts*` — is a refusal, not a warning.
 */
export const GMAIL_ALLOWED_SCOPES: readonly string[] = [
  GMAIL_SEND_SCOPE,
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'openid',
];

/** Thrown when an auth config would request more than send-only access. */
export class GmailScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GmailScopeError';
  }
}

interface AuthConfigLike {
  toolkitSlug: string;
  isComposioManaged: boolean;
  scopes: string[] | null;
}

/**
 * Verify an auth config is send-only. Throws `GmailScopeError` if not.
 *
 * Returns the (normalised) scopes it approved so the caller can record exactly
 * what was granted alongside the connection.
 */
export function assertSendOnlyGmailScopes(cfg: AuthConfigLike): string[] {
  if (cfg.toolkitSlug && cfg.toolkitSlug.toLowerCase() !== 'gmail') {
    throw new GmailScopeError(
      `Auth config is for toolkit "${cfg.toolkitSlug}", not gmail`
    );
  }

  // Fail closed: no declared scopes means Composio's defaults, which read mail.
  if (!cfg.scopes || cfg.scopes.length === 0) {
    throw new GmailScopeError(
      'Auth config declares no OAuth scopes, so Composio would request its ' +
      'default Gmail scopes (full mailbox read/write). Set credentials.scopes ' +
      `to exactly ["${GMAIL_SEND_SCOPE}"].`
    );
  }

  const allowed = new Set(GMAIL_ALLOWED_SCOPES);
  const disallowed = cfg.scopes.filter(s => !allowed.has(s));
  if (disallowed.length > 0) {
    throw new GmailScopeError(
      `Auth config requests scopes beyond send-only: ${disallowed.join(', ')}. ` +
      'Harvest must not be able to read a church mailbox.'
    );
  }

  // Send-only means the send scope is actually present — an auth config that
  // only asked for identity scopes would connect and then fail every send.
  if (!cfg.scopes.includes(GMAIL_SEND_SCOPE)) {
    throw new GmailScopeError(
      `Auth config is missing the ${GMAIL_SEND_SCOPE} scope, so no email could be sent.`
    );
  }

  return cfg.scopes;
}
