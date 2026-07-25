import type { TwilioConfig } from './twilio';

/**
 * HARVEST'S OWN Twilio account — the shared account a tenant sends on when it
 * has not entered credentials of its own. Sends on it are billed to HARVEST, so
 * they are the sends the per-plan segment cap exists to bound.
 *
 * IT DOES NOT EXIST YET. There is no Twilio account, no purchased number and no
 * A2P 10DLC registration, so this returns null, every tenant resolves to `byo`,
 * and nothing is capped. That is correct rather than a gap: while Harvest pays
 * nothing for SMS, a cap would only limit churches spending their own money on
 * their own credentials.
 *
 * This is its own module for two reasons: enabling the platform account later
 * is then a change to THIS FILE ONLY, and tests can substitute it to exercise
 * the platform path that no environment can produce yet.
 *
 * TO ENABLE — all configuration, no change to the send path:
 *   1. Create the Twilio account, buy a number, and complete A2P 10DLC brand +
 *      campaign registration (external, multi-week).
 *   2. Add the three server-only env vars below — as secrets in
 *      apphosting.yaml and as documented (empty) keys in .env.example. Never
 *      NEXT_PUBLIC_*: the auth token is a secret and this module is server-only.
 *        TWILIO_ACCOUNT_SID
 *        TWILIO_AUTH_TOKEN
 *        TWILIO_FROM_NUMBER
 *   3. Replace the body below with:
 *        const accountSid = process.env.TWILIO_ACCOUNT_SID;
 *        const authToken = process.env.TWILIO_AUTH_TOKEN;
 *        const fromNumber = process.env.TWILIO_FROM_NUMBER;
 *        if (!accountSid || !authToken || !fromNumber) return null;
 *        return { accountSid, authToken, fromNumber };
 *      All three or nothing — a half-configured account must resolve to null
 *      rather than produce sends that fail at Twilio.
 *
 * From that moment tenants without their own credentials resolve to
 * `source: 'platform'` and the per-tier cap binds automatically. Nothing else
 * changes: sendSms, every call site, /api/sms-usage and the admin UI already
 * branch on the source.
 *
 * ONE LOOSE END for that day, deliberately not pre-solved here: the settings
 * "Test Connection" button (api/sms/test, mode 'connection') validates whatever
 * getTwilioConfig returned. For a tenant with no credentials of its own that
 * would validate HARVEST'S account and report success on a screen where the
 * admin is testing THEIRS. Scope that check to `source === 'byo'` — or say which
 * account it checked — when the fallback goes live.
 */
export function getPlatformTwilioConfig(): TwilioConfig | null {
  return null;
}
