import 'server-only';

/**
 * The only seam between Harvest's newsletter and an email vendor.
 *
 * The UI, the service and the routes depend on this interface and never on a
 * vendor. Plunk is the live implementation (`plunk.ts`); SES is a stub
 * (`ses.ts`) so the swap is a new file, not a rewrite.
 */

export interface OutboundEmail {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly fromName: string;
  readonly fromAddress: string;
  readonly replyTo: string | null;
  /** Always carries List-Unsubscribe and List-Unsubscribe-Post for a broadcast. */
  readonly headers: Readonly<Record<string, string>>;
}

export type SendResult =
  | { readonly ok: true; readonly id: string | null }
  | { readonly ok: false; readonly error: string; readonly retryable: boolean };

export interface DnsRecord {
  readonly type: string;
  readonly name: string;
  readonly value: string;
}

export type DomainState = 'pending' | 'verified' | 'failed';

export interface DomainStatus {
  readonly domain: string;
  readonly state: DomainState;
  readonly records: readonly DnsRecord[];
}

export interface EmailProvider {
  readonly name: 'plunk' | 'ses';
  send(message: OutboundEmail): Promise<SendResult>;
  /** The domain as the vendor knows it, or null if the vendor has never seen it. Registers nothing. */
  findDomain(domain: string): Promise<DomainStatus | null>;
  /** Idempotent: a domain the vendor already holds is returned, not duplicated. */
  registerDomain(domain: string): Promise<DomainStatus>;
  getDomainStatus(domain: string): Promise<DomainStatus>;
}

/** The vendor did not answer, or answered with a failure. Routes turn this into a 502, never a 500. */
export class EmailProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'network' | 'http',
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'EmailProviderError';
  }
}

export function isEmailProviderError(error: unknown): error is EmailProviderError {
  return error instanceof EmailProviderError || (error instanceof Error && error.name === 'EmailProviderError');
}

/** Missing credentials. Routes turn this into a 503, never a 500. */
export class EmailNotConfiguredError extends Error {
  constructor(message = 'Email sending is not configured on this server.') {
    super(message);
    this.name = 'EmailNotConfiguredError';
  }
}

export function isEmailNotConfigured(error: unknown): boolean {
  return error instanceof EmailNotConfiguredError
    || (error instanceof Error && error.name === 'EmailNotConfiguredError');
}

/**
 * Resolves the live provider from the environment. Dynamic import keeps the
 * vendor module out of anything that only needs the types.
 */
export async function getEmailProvider(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<EmailProvider> {
  const key = (env.PLUNK_API_KEY ?? '').trim();
  if (!key) throw new EmailNotConfiguredError();
  const { createPlunkProvider } = await import('@/lib/email/plunk');
  return createPlunkProvider({ apiKey: key });
}
