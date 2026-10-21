import 'server-only';

import { EmailNotConfiguredError, type EmailProvider } from '@/lib/email/provider';

/**
 * Amazon SES adapter. Not built.
 *
 * TODO(ses): implement `send` with SESv2 SendEmail (raw headers for
 * List-Unsubscribe), and `registerDomain` / `getDomainStatus` with
 * CreateEmailIdentity / GetEmailIdentity (Easy DKIM). Then select it in
 * `getEmailProvider`. Nothing outside src/lib/email needs to change.
 */
export function createSesProvider(): EmailProvider {
  const unavailable = () => {
    throw new EmailNotConfiguredError('Amazon SES is not available yet.');
  };
  return {
    name: 'ses',
    send: async () => unavailable(),
    registerDomain: async () => unavailable(),
    getDomainStatus: async () => unavailable(),
  };
}
